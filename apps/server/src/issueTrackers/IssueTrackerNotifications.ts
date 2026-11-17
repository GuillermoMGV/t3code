import {
  IssueTrackerError,
  type IssueTrackerKind,
  type IssueTrackerNotificationsMutation,
  type IssueTrackerNotificationsResult,
  type TrackerNotification,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { type JiraCredentials, makeJiraApi } from "./jiraApi.ts";
import { makeLinearApi } from "./linearApi.ts";
import {
  applyJiraReadState,
  deriveJiraNotifications,
  initialJiraReadIds,
  JIRA_WINDOW_MS,
  JiraNotificationIssue,
  LinearNotificationNode,
  mergeNotifications,
  toLinearNotification,
} from "./notificationEvents.ts";

// Fork-only notifications bell for Linear and Jira; see CUSTOM_DEVELOPMENT.md.
// One server-side poll serves every client, so several open clients never multiply the
// trackers' rate-limit use.

const POLL_INTERVAL = "5 minutes";
// Same secret names as IssueTrackerService.ts, which owns connecting and disconnecting.
const LINEAR_KEY_SECRET = "linear-api-key";
const JIRA_SECRET = "jira-credentials";
const STATE_FILE = "issue-tracker-notifications.json";

const LINEAR_QUERY = `query Notifications {
  notifications(first: 50, orderBy: createdAt) {
    nodes {
      id type readAt createdAt snoozedUntilAt
      actor { name }
      ... on IssueNotification {
        issue { identifier title url state { name } }
        comment { body }
      }
    }
  }
}`;

// `assignee WAS` keeps issues just reassigned away from the user, so "unassigned" shows.
const JIRA_JQL =
  "(assignee WAS currentUser() OR reporter = currentUser() OR watcher = currentUser()) " +
  "AND updated >= -3d ORDER BY updated DESC";

const LinearNotificationsData = Schema.Struct({
  notifications: Schema.Struct({ nodes: Schema.Array(Schema.Unknown) }),
});
const decodeLinearData = Schema.decodeUnknownEffect(LinearNotificationsData);
// One node at a time, so a notification kind Linear adds later cannot fail the whole list.
const decodeLinearNode = Schema.decodeUnknownOption(LinearNotificationNode);
const decodeJiraSearch = Schema.decodeUnknownEffect(
  Schema.Struct({ issues: Schema.optional(Schema.Array(JiraNotificationIssue)) }),
);
const decodeJiraMyself = Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }));

const StoredJiraCredentials = Schema.fromJsonString(
  Schema.Struct({ siteUrl: Schema.String, email: Schema.String, apiToken: Schema.String }),
);
const decodeJiraCredentials = Schema.decodeEffect(StoredJiraCredentials);

/** Only read state and the last check; the items themselves are fetched again after a restart. */
const StateFile = Schema.fromJsonString(
  Schema.Struct({
    checkedAt: Schema.optional(Schema.String),
    jira: Schema.optional(
      Schema.Struct({
        /** The site the read ids belong to; another site starts over. */
        site: Schema.String,
        readIds: Schema.Array(Schema.String),
      }),
    ),
  }),
);
type StateFile = typeof StateFile.Type;
const decodeStateFile = Schema.decodeEffect(StateFile);
const encodeStateFile = Schema.encodeEffect(StateFile);

const trackerError =
  (tracker: IssueTrackerKind, reason: IssueTrackerError["reason"], detail: string) =>
  (cause: unknown): IssueTrackerError =>
    new IssueTrackerError({ tracker, reason, detail, cause });

export class IssueTrackerNotifications extends Context.Service<
  IssueTrackerNotifications,
  {
    readonly get: Effect.Effect<IssueTrackerNotificationsResult, IssueTrackerError>;
    readonly mutate: (
      input: IssueTrackerNotificationsMutation,
    ) => Effect.Effect<IssueTrackerNotificationsResult, IssueTrackerError>;
  }
>()("t3/issueTrackers/IssueTrackerNotifications") {}

const make = Effect.gen(function* () {
  const linear = yield* makeLinearApi;
  const jira = yield* makeJiraApi;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const statePath = path.join(stateDir, STATE_FILE);
  const pollLock = yield* Semaphore.make(1);

  let linearItems: TrackerNotification[] = [];
  let jiraEvents: TrackerNotification[] = [];
  let jiraReadIds = new Set<string>();
  let jiraSite: string | null = null;
  let checkedAt: string | null = null;
  const polled = new Set<IssueTrackerKind>();
  const errors = new Map<IssueTrackerKind, string>();
  let jiraAccount: { readonly key: string; readonly accountId: string } | null = null;

  const readSecret = (tracker: IssueTrackerKind, name: string) =>
    secrets
      .get(name)
      .pipe(
        Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())),
        Effect.map(Option.filter((value) => value.length > 0)),
        Effect.mapError(trackerError(tracker, "storage", "Could not read the saved credentials.")),
      );
  const readLinearKey = readSecret("linear", LINEAR_KEY_SECRET);
  const readJiraCredentials = readSecret("jira", JIRA_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (json) =>
          decodeJiraCredentials(json).pipe(
            Effect.map(Option.some<JiraCredentials>),
            Effect.mapError(
              trackerError("jira", "storage", "Could not read the saved Jira credentials."),
            ),
          ),
      }),
    ),
  );

  const connectedTrackers = Effect.all([readLinearKey, readJiraCredentials]).pipe(
    Effect.map(([linearKey, jiraCredentials]) => [
      ...(Option.isSome(linearKey) ? (["linear"] as const) : []),
      ...(Option.isSome(jiraCredentials) ? (["jira"] as const) : []),
    ]),
  );

  const loadState = fileSystem.readFileString(statePath).pipe(
    Effect.flatMap(decodeStateFile),
    Effect.orElseSucceed((): StateFile => ({})),
  );
  const saveState = Effect.gen(function* () {
    const json = yield* encodeStateFile({
      ...(checkedAt === null ? {} : { checkedAt }),
      ...(jiraSite === null ? {} : { jira: { site: jiraSite, readIds: [...jiraReadIds] } }),
    });
    const tempPath = `${statePath}.tmp`;
    yield* fileSystem.writeFileString(tempPath, `${json}\n`);
    yield* fileSystem.rename(tempPath, statePath);
  }).pipe(
    Effect.mapError(trackerError("jira", "storage", "Could not save the notification state.")),
  );

  const initial = yield* loadState;
  checkedAt = initial.checkedAt ?? null;
  if (initial.jira !== undefined) {
    jiraSite = initial.jira.site;
    jiraReadIds = new Set(initial.jira.readIds);
  }

  const fetchLinear = Effect.fn("IssueTrackerNotifications.fetchLinear")(function* (
    apiKey: string,
  ) {
    const result = yield* linear.graphql(apiKey, LINEAR_QUERY, {});
    if (result._tag === "errors") {
      return yield* new IssueTrackerError({
        tracker: "linear",
        reason: "invalidResponse",
        detail: `Linear did not return notifications: ${result.message}`,
      });
    }
    const data = yield* decodeLinearData(result.data).pipe(
      Effect.mapError(
        trackerError(
          "linear",
          "invalidResponse",
          "Linear returned notifications T3 Code could not read.",
        ),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    return data.notifications.nodes.flatMap((raw) =>
      Option.match(decodeLinearNode(raw), {
        onNone: () => [],
        onSome: (node) => toLinearNotification(node, now) ?? [],
      }),
    );
  });

  const jiraAccountId = Effect.fn("IssueTrackerNotifications.jiraAccountId")(function* (
    credentials: JiraCredentials,
  ) {
    const key = `${credentials.siteUrl}\u0000${credentials.email}`;
    if (jiraAccount?.key === key) return jiraAccount.accountId;
    const response = yield* jira.request(credentials, "/rest/api/3/myself");
    const json = yield* jira.readJson(response);
    const { accountId } = yield* decodeJiraMyself(json).pipe(
      Effect.mapError(trackerError("jira", "invalidResponse", "Jira did not return your account.")),
    );
    jiraAccount = { key, accountId };
    return accountId;
  });

  const fetchJira = Effect.fn("IssueTrackerNotifications.fetchJira")(function* (
    credentials: JiraCredentials,
  ) {
    const accountId = yield* jiraAccountId(credentials);
    const response = yield* jira.request(credentials, "/rest/api/3/search/jql", {
      jql: JIRA_JQL,
      fields: ["summary", "comment"],
      expand: "changelog",
      maxResults: 50,
    });
    const json = yield* jira.readJson(response);
    const { issues } = yield* decodeJiraSearch(json).pipe(
      Effect.mapError(
        trackerError("jira", "invalidResponse", "Jira returned issues T3 Code could not read."),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    return deriveJiraNotifications(issues ?? [], {
      accountId,
      siteUrl: credentials.siteUrl,
      sinceMs: now - JIRA_WINDOW_MS,
    });
  });

  const recordError = Effect.fn("IssueTrackerNotifications.recordError")(function* (
    tracker: IssueTrackerKind,
    error: IssueTrackerError,
  ) {
    // Logged once per new message, so a tracker that stays down does not fill the log.
    if (errors.get(tracker) !== error.message) {
      yield* Effect.logWarning("Issue tracker notifications check failed", {
        tracker,
        reason: error.reason,
      });
    }
    errors.set(tracker, error.message);
  });

  const poll = pollLock
    .withPermits(1)(
      Effect.gen(function* () {
        const [linearKey, jiraCredentials] = yield* Effect.all([
          readLinearKey,
          readJiraCredentials,
        ]);
        if (Option.isNone(linearKey) && Option.isNone(jiraCredentials)) {
          linearItems = [];
          jiraEvents = [];
          errors.clear();
          polled.clear();
          return;
        }
        const now = yield* Clock.currentTimeMillis;

        if (Option.isSome(linearKey)) {
          yield* fetchLinear(linearKey.value).pipe(
            Effect.matchEffect({
              onFailure: (error) => recordError("linear", error),
              onSuccess: (items) =>
                Effect.sync(() => {
                  linearItems = items;
                  errors.delete("linear");
                }),
            }),
          );
          polled.add("linear");
        } else {
          linearItems = [];
          errors.delete("linear");
          polled.delete("linear");
        }

        if (Option.isSome(jiraCredentials)) {
          const site = jiraCredentials.value.siteUrl;
          yield* fetchJira(jiraCredentials.value).pipe(
            Effect.matchEffect({
              onFailure: (error) => recordError("jira", error),
              onSuccess: (events) =>
                Effect.sync(() => {
                  if (jiraSite !== site) {
                    jiraSite = site;
                    jiraReadIds = new Set(initialJiraReadIds(events, now));
                  } else {
                    // Ids that left the window are no longer needed.
                    const present = new Set(events.map((event) => event.id));
                    jiraReadIds = new Set([...jiraReadIds].filter((id) => present.has(id)));
                  }
                  jiraEvents = events;
                  errors.delete("jira");
                }),
            }),
          );
          polled.add("jira");
        } else {
          jiraEvents = [];
          errors.delete("jira");
          polled.delete("jira");
        }

        checkedAt = DateTime.formatIso(DateTime.makeUnsafe(now));
        yield* saveState.pipe(Effect.ignore);
      }),
    )
    .pipe(Effect.withSpan("IssueTrackerNotifications.poll"));

  // Without credentials a tick only reads the secret store, so nothing reaches the trackers.
  // A failed tick must not end the schedule; errors are already kept per tracker.
  yield* poll.pipe(Effect.ignore, Effect.repeat(Schedule.spaced(POLL_INTERVAL)), Effect.forkScoped);

  const snapshot = Effect.gen(function* () {
    const connected = yield* connectedTrackers;
    for (const tracker of polled) if (!connected.includes(tracker)) polled.delete(tracker);
    // A tracker connected since the last tick is checked now, before answering, so the bell
    // does not sit empty until the next tick or the client's next read.
    if (connected.some((tracker) => !polled.has(tracker))) {
      yield* poll.pipe(Effect.ignore);
    }
    const notifications = mergeNotifications(
      connected.includes("linear") ? linearItems : [],
      connected.includes("jira") ? applyJiraReadState(jiraEvents, jiraReadIds) : [],
    );
    return {
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
      connected,
      checkedAt,
      errors: connected.flatMap((tracker) => {
        const message = errors.get(tracker);
        return message === undefined ? [] : [{ tracker, message }];
      }),
    } satisfies IssueTrackerNotificationsResult;
  });

  const setLinearRead = Effect.fn("IssueTrackerNotifications.setLinearRead")(function* (
    ids: ReadonlyArray<string>,
    read: boolean,
  ) {
    if (ids.length === 0) return;
    const apiKey = yield* readLinearKey;
    if (Option.isNone(apiKey)) return;
    const variables: Record<string, unknown> = {
      readAt: read ? DateTime.formatIso(yield* DateTime.now) : null,
    };
    const fields = ids.map((id, index) => {
      variables[`id${index}`] = id.slice("linear:".length);
      return `n${index}: notificationUpdate(id: $id${index}, input: { readAt: $readAt }) { success }`;
    });
    const declarations = ids.map((_, index) => `$id${index}: String!`).join(", ");
    const result = yield* linear.graphql(
      apiKey.value,
      `mutation Mark($readAt: DateTime, ${declarations}) { ${fields.join(" ")} }`,
      variables,
    );
    if (result._tag === "errors") {
      return yield* new IssueTrackerError({
        tracker: "linear",
        reason: "invalidResponse",
        detail: `Linear did not update the notifications: ${result.message}`,
      });
    }
    const changed = new Set(ids);
    linearItems = linearItems.map((item) => (changed.has(item.id) ? { ...item, read } : item));
  });

  const setRead = Effect.fn("IssueTrackerNotifications.setRead")(function* (
    ids: ReadonlyArray<string>,
    read: boolean,
  ) {
    const wanted = new Set(ids);
    const linearIds = linearItems
      .filter((item) => wanted.has(item.id) && item.read !== read)
      .map((item) => item.id);
    yield* setLinearRead(linearIds, read);
    const jiraIds = jiraEvents.filter((event) => wanted.has(event.id)).map((event) => event.id);
    if (jiraIds.length === 0) return;
    for (const id of jiraIds) {
      if (read) jiraReadIds.add(id);
      else jiraReadIds.delete(id);
    }
    yield* saveState;
  });

  const mutate = Effect.fn("IssueTrackerNotifications.mutate")(function* (
    input: IssueTrackerNotificationsMutation,
  ) {
    switch (input.type) {
      case "markRead":
        yield* setRead(input.ids, true);
        break;
      case "markUnread":
        yield* setRead(input.ids, false);
        break;
      case "markAllRead": {
        const current = yield* snapshot;
        const unread = current.notifications.filter((item) => !item.read).map((item) => item.id);
        yield* setRead(unread, true);
        break;
      }
      case "refresh":
        yield* poll;
        break;
    }
    return yield* snapshot;
  });

  return IssueTrackerNotifications.of({
    get: snapshot.pipe(Effect.withSpan("IssueTrackerNotifications.get")),
    mutate,
  });
});

export const layer = Layer.effect(IssueTrackerNotifications, make);
