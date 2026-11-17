import {
  IssueKey,
  IssueTrackerError,
  type IssueTrackerConnection,
  type IssueTrackerConnectionsResult,
  type IssueTrackerKind,
  type IssueTrackerLinkSource,
  type IssueTrackerMutation,
  type IssueTrackerMutationResult,
  type IssueTrackerSearchInput,
  type IssueTrackerSearchResult,
  type IssueTrackerThreadInput,
  type IssueTrackerThreadResult,
  type IssueTrackerSummariesResult,
  type IssueTrackerIssuesInput,
  type IssueTrackerIssuesResult,
  type IssueTrackerThreadRow,
  type TrackerIssue,
  parseIssueReference,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { type JiraCredentials, makeJiraApi, normalizeJiraSiteUrl } from "./jiraApi.ts";
import { makeLinearApi } from "./linearApi.ts";

const TRACKERS = ["linear", "jira"] as const satisfies ReadonlyArray<IssueTrackerKind>;
const LINEAR_KEY_SECRET = "linear-api-key";
const JIRA_SECRET = "jira-credentials";
const LINKS_FILE = "issue-tracker-links.json";
const ISSUE_CACHE_MS = 60_000;
const MISSING_KEY_CACHE_MS = 30 * 60_000;
/** Written by the first, Linear-only version of this feature. */
const LEGACY_LINEAR_LINKS_FILE = "linear-links.json";

const ThreadLinkEntry = Schema.Struct({
  key: Schema.optional(IssueKey),
  dismissed: Schema.optional(Schema.Array(IssueKey)),
  /** The issue last detected in the thread's messages, so the thread list can show it. */
  detected: Schema.optional(IssueKey),
});
type ThreadLinkEntry = typeof ThreadLinkEntry.Type;

const ThreadLinks = Schema.Struct({
  linear: Schema.optional(ThreadLinkEntry),
  jira: Schema.optional(ThreadLinkEntry),
});
type ThreadLinks = typeof ThreadLinks.Type;

const LinksFile = Schema.Struct({ threads: Schema.Record(Schema.String, ThreadLinks) });
type LinksFile = typeof LinksFile.Type;
const LinksFileJson = Schema.fromJsonString(LinksFile);

const LegacyLinksFile = Schema.fromJsonString(
  Schema.Struct({
    threads: Schema.Record(
      Schema.String,
      Schema.Struct({
        identifier: Schema.optional(IssueKey),
        dismissed: Schema.optional(Schema.Array(IssueKey)),
      }),
    ),
  }),
);

const StoredJiraCredentials = Schema.fromJsonString(
  Schema.Struct({ siteUrl: Schema.String, email: Schema.String, apiToken: Schema.String }),
);

const decodeLinksFile = Schema.decodeEffect(LinksFileJson);
const encodeLinksFile = Schema.encodeEffect(LinksFileJson);
const decodeLegacyLinksFile = Schema.decodeEffect(LegacyLinksFile);
const decodeJiraCredentials = Schema.decodeEffect(StoredJiraCredentials);
const encodeJiraCredentials = Schema.encodeEffect(StoredJiraCredentials);

/** A manual link wins; otherwise the oldest detected issue the user has not dismissed. */
export function resolveThreadLink(
  entry: ThreadLinkEntry | undefined,
  detected: ReadonlyArray<IssueKey>,
): { key: IssueKey; source: IssueTrackerLinkSource } | null {
  if (entry?.key !== undefined) return { key: entry.key, source: "manual" };
  const dismissed = entry?.dismissed ?? [];
  // The remembered detection covers a client that has not loaded the messages yet.
  const candidates = entry?.detected === undefined ? detected : [...detected, entry.detected];
  const key = candidates.find((candidate) => !dismissed.includes(candidate));
  return key === undefined ? null : { key, source: "detected" };
}

/** The issue the thread list shows for a tracker: the manual link, else the remembered detection. */
export function summaryKey(entry: ThreadLinkEntry | undefined): IssueKey | null {
  if (entry?.key !== undefined) return entry.key;
  const detected = entry?.detected;
  return detected !== undefined && !(entry?.dismissed ?? []).includes(detected) ? detected : null;
}

/** The entry remembering a newly detected issue, or undefined when nothing changes. */
export function rememberDetectedLink(
  entry: ThreadLinkEntry | undefined,
  link: { key: IssueKey; source: IssueTrackerLinkSource } | null,
): ThreadLinkEntry | undefined {
  if (link?.source !== "detected" || entry?.detected === link.key) return undefined;
  return { ...entry, detected: link.key };
}

/** The entry after a mutation, or undefined when nothing is left to remember. */
export function applyThreadLinkMutation(
  entry: ThreadLinkEntry | undefined,
  mutation: Extract<IssueTrackerMutation, { type: "link" | "unlink" }>,
): ThreadLinkEntry | undefined {
  const dismissed = entry?.dismissed ?? [];
  if (mutation.type === "link") {
    const rest = dismissed.filter((key) => key !== mutation.key);
    return rest.length > 0 ? { key: mutation.key, dismissed: rest } : { key: mutation.key };
  }
  const next = [...new Set([...dismissed, ...mutation.dismissKeys])];
  return next.length > 0 ? { dismissed: next } : undefined;
}

const storageError =
  (tracker: IssueTrackerKind, detail: string) =>
  (cause: unknown): IssueTrackerError =>
    new IssueTrackerError({ tracker, reason: "storage", detail, cause });

export class IssueTrackerService extends Context.Service<
  IssueTrackerService,
  {
    readonly getThreadIssues: (
      input: IssueTrackerThreadInput,
    ) => Effect.Effect<IssueTrackerThreadResult, IssueTrackerError>;
    readonly search: (
      input: IssueTrackerSearchInput,
    ) => Effect.Effect<IssueTrackerSearchResult, IssueTrackerError>;
    readonly getConnections: Effect.Effect<IssueTrackerConnectionsResult, IssueTrackerError>;
    readonly getThreadSummaries: Effect.Effect<IssueTrackerSummariesResult, IssueTrackerError>;
    readonly getIssues: (
      input: IssueTrackerIssuesInput,
    ) => Effect.Effect<IssueTrackerIssuesResult, IssueTrackerError>;
    readonly mutate: (
      input: IssueTrackerMutation,
    ) => Effect.Effect<IssueTrackerMutationResult, IssueTrackerError>;
  }
>()("t3/issueTrackers/IssueTrackerService") {}

const make = Effect.gen(function* () {
  const linear = yield* makeLinearApi;
  const jira = yield* makeJiraApi;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const linksPath = path.join(stateDir, LINKS_FILE);
  const legacyLinksPath = path.join(stateDir, LEGACY_LINEAR_LINKS_FILE);
  const writeLock = yield* Semaphore.make(1);

  const readSecret = (tracker: IssueTrackerKind, name: string) =>
    secrets
      .get(name)
      .pipe(
        Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())),
        Effect.map(Option.filter((value) => value.length > 0)),
        Effect.mapError(storageError(tracker, "Could not read the saved credentials.")),
      );

  const readLinearKey = readSecret("linear", LINEAR_KEY_SECRET);

  const readJiraCredentials = readSecret("jira", JIRA_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (json) =>
          decodeJiraCredentials(json).pipe(
            Effect.map(Option.some<JiraCredentials>),
            Effect.mapError(storageError("jira", "Could not read the saved Jira credentials.")),
          ),
      }),
    ),
  );

  const readOptionalFile = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeedNone,
      ),
    );

  const readLinks: Effect.Effect<LinksFile, IssueTrackerError> = Effect.gen(function* () {
    const current = yield* readOptionalFile(linksPath);
    if (Option.isSome(current)) return yield* decodeLinksFile(current.value);
    const legacy = yield* readOptionalFile(legacyLinksPath);
    if (Option.isNone(legacy)) return { threads: {} };
    const { threads } = yield* decodeLegacyLinksFile(legacy.value);
    return {
      threads: Object.fromEntries(
        Object.entries(threads).map(([threadId, entry]) => [
          threadId,
          {
            linear: {
              ...(entry.identifier === undefined ? {} : { key: entry.identifier }),
              ...(entry.dismissed === undefined ? {} : { dismissed: entry.dismissed }),
            },
          },
        ]),
      ),
    };
  }).pipe(Effect.mapError(storageError("linear", "Could not read the issue tracker links.")));

  // Writes run under writeLock, so one temporary name is enough.
  const writeLinks = Effect.fn("IssueTrackerService.writeLinks")(
    function* (links: LinksFile) {
      const tempPath = `${linksPath}.tmp`;
      const json = yield* encodeLinksFile(links);
      yield* fileSystem.writeFileString(tempPath, `${json}\n`);
      yield* fileSystem.rename(tempPath, linksPath);
    },
    Effect.mapError(storageError("linear", "Could not save the issue tracker links.")),
  );

  /** Fetches one issue with whichever credentials the tracker has. */
  const fetchIssue = (tracker: IssueTrackerKind, key: IssueKey) =>
    tracker === "linear"
      ? readLinearKey.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: (apiKey) => linear.issue(apiKey, key).pipe(Effect.asSome),
            }),
          ),
        )
      : readJiraCredentials.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: (credentials) => jira.issue(credentials, key).pipe(Effect.asSome),
            }),
          ),
        );

  // The thread list asks for every linked thread at once; this keeps it to one read per issue a minute.
  const issueCache = new Map<
    string,
    { readonly issue: TrackerIssue | null; readonly at: number }
  >();
  const fetchAndCache = (tracker: IssueTrackerKind, key: IssueKey) =>
    fetchIssue(tracker, key).pipe(
      Effect.tap((issue) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((at) =>
            Option.isSome(issue)
              ? issueCache.set(`${tracker}:${key}`, { issue: issue.value, at })
              : undefined,
          ),
        ),
      ),
    );

  const isConnected = (tracker: IssueTrackerKind) =>
    tracker === "linear"
      ? readLinearKey.pipe(Effect.map(Option.isSome))
      : readJiraCredentials.pipe(Effect.map(Option.isSome));

  const getThreadIssues = Effect.fn("IssueTrackerService.getThreadIssues")(function* (
    input: IssueTrackerThreadInput,
  ) {
    const links = yield* readLinks;
    const threadLinks = links.threads[input.threadId] ?? {};
    const rows = yield* Effect.forEach(
      TRACKERS,
      (tracker) => {
        const link = resolveThreadLink(
          threadLinks[tracker],
          input.detected.filter((ref) => ref.tracker === tracker).map((ref) => ref.key),
        );
        return Effect.gen(function* () {
          const connected = yield* isConnected(tracker);
          if (!connected || link === null) {
            return { tracker, connected, link, issue: null, error: null };
          }
          const issue = yield* fetchAndCache(tracker, link.key);
          return { tracker, connected, link, issue: Option.getOrNull(issue), error: null };
        }).pipe(
          // One tracker failing must not hide the other's row.
          Effect.catch((error) =>
            Effect.succeed<IssueTrackerThreadRow>({
              tracker,
              connected: true,
              link,
              issue: null,
              error: error.message,
            }),
          ),
        );
      },
      { concurrency: "unbounded" },
    );
    const detectedNow = rows.flatMap((row) =>
      rememberDetectedLink(threadLinks[row.tracker], row.link) === undefined || row.link === null
        ? []
        : [{ tracker: row.tracker, key: row.link.key }],
    );
    if (detectedNow.length > 0) {
      yield* writeLock
        .withPermits(1)(
          Effect.gen(function* () {
            const latest = yield* readLinks;
            const current = latest.threads[input.threadId] ?? {};
            const next: ThreadLinks = Object.assign(
              { ...current },
              ...detectedNow.map(({ tracker, key }) => ({
                [tracker]: { ...current[tracker], detected: key },
              })),
            );
            yield* writeLinks({ threads: { ...latest.threads, [input.threadId]: next } });
          }),
        )
        // Remembering the detection only helps the thread list; the panel answer stands without it.
        .pipe(Effect.ignore);
    }
    return { rows };
  });

  const getThreadSummaries = Effect.gen(function* () {
    const links = yield* readLinks;
    const [linearConnected, jiraConnected] = yield* Effect.all([
      isConnected("linear"),
      isConnected("jira"),
    ]);
    const connected = { linear: linearConnected, jira: jiraConnected };
    const wanted = Object.entries(links.threads).flatMap(([threadId, threadLinks]) =>
      TRACKERS.flatMap((tracker) => {
        const key = summaryKey(threadLinks[tracker]);
        return key !== null && connected[tracker] ? [{ threadId, tracker, key }] : [];
      }),
    );
    const now = yield* Clock.currentTimeMillis;
    const uniqueIssues = [...new Map(wanted.map((item) => [`${item.tracker}:${item.key}`, item]))];
    const fetched = yield* Effect.forEach(
      uniqueIssues,
      ([id, { tracker, key }]) => {
        const cached = issueCache.get(id);
        if (cached !== undefined && now - cached.at < ISSUE_CACHE_MS) {
          return Effect.succeed([id, cached.issue] as const);
        }
        return fetchAndCache(tracker, key).pipe(
          Effect.map((issue) => [id, Option.getOrNull(issue)] as const),
          // A tracker that fails leaves its badges out; the list must still load.
          Effect.orElseSucceed(() => [id, null] as const),
        );
      },
      { concurrency: 4 },
    );
    const issueById = new Map(fetched);
    const byThread = new Map<string, TrackerIssue[]>();
    for (const { threadId, tracker, key } of wanted) {
      const issue = issueById.get(`${tracker}:${key}`) ?? null;
      if (issue === null) continue;
      byThread.set(threadId, [...(byThread.get(threadId) ?? []), issue]);
    }
    return {
      threads: [...byThread].map(([threadId, issues]) => ({
        threadId: threadId as IssueTrackerThreadInput["threadId"],
        issues,
      })),
    };
  }).pipe(Effect.withSpan("IssueTrackerService.getThreadSummaries"));

  // Keys come from pull request titles and branches, so many are not issues at all (`UTF-8`).
  // Misses stay cached longer, so a long list does not spend the trackers' rate limits on them.
  const keyCache = new Map<string, { readonly issue: TrackerIssue | null; readonly at: number }>();
  const lookupKey = Effect.fn("IssueTrackerService.lookupKey")(function* (
    key: IssueKey,
    connected: Readonly<Record<IssueTrackerKind, boolean>>,
  ) {
    for (const tracker of TRACKERS) {
      if (!connected[tracker]) continue;
      // A failing tracker must not hide the other's issue; the key just shows no badge.
      const issue = yield* fetchIssue(tracker, key).pipe(Effect.orElseSucceed(Option.none));
      if (Option.isSome(issue)) return issue.value;
    }
    return null;
  });

  const getIssues = Effect.fn("IssueTrackerService.getIssues")(function* (
    input: IssueTrackerIssuesInput,
  ) {
    const [linearConnected, jiraConnected] = yield* Effect.all([
      isConnected("linear"),
      isConnected("jira"),
    ]);
    if (!linearConnected && !jiraConnected) return { issues: [] };
    const connected = { linear: linearConnected, jira: jiraConnected };
    const now = yield* Clock.currentTimeMillis;
    const found = yield* Effect.forEach(
      [...new Set(input.keys)],
      (key) => {
        const cached = keyCache.get(key);
        const maxAge = cached?.issue === null ? MISSING_KEY_CACHE_MS : ISSUE_CACHE_MS;
        if (cached !== undefined && now - cached.at < maxAge) {
          return Effect.succeed(cached.issue);
        }
        return lookupKey(key, connected).pipe(
          Effect.tap((issue) => Effect.sync(() => keyCache.set(key, { issue, at: now }))),
        );
      },
      { concurrency: 4 },
    );
    return { issues: found.filter((issue) => issue !== null) };
  });

  const search = Effect.fn("IssueTrackerService.search")(function* (
    input: IssueTrackerSearchInput,
  ) {
    const query = input.query.trim();
    const key = query.length === 0 ? null : parseIssueReference(query, input.tracker);
    if (input.tracker === "linear") {
      const apiKey = yield* readLinearKey;
      if (Option.isNone(apiKey)) return yield* notConnected("linear");
      if (query.length === 0) return { issues: yield* linear.assignedOpenIssues(apiKey.value) };
      if (key !== null) {
        const issue = yield* linear.issue(apiKey.value, key);
        return { issues: issue === null ? [] : [issue] };
      }
      return { issues: yield* linear.search(apiKey.value, query) };
    }
    const credentials = yield* readJiraCredentials;
    if (Option.isNone(credentials)) return yield* notConnected("jira");
    if (query.length === 0) return { issues: yield* jira.assignedOpenIssues(credentials.value) };
    if (key !== null) {
      const issue = yield* jira.issue(credentials.value, key);
      return { issues: issue === null ? [] : [issue] };
    }
    return { issues: yield* jira.search(credentials.value, query) };
  });

  const connection = Effect.fn("IssueTrackerService.connection")(function* (
    tracker: IssueTrackerKind,
  ) {
    if (tracker === "linear") {
      const apiKey = yield* readLinearKey;
      if (Option.isNone(apiKey)) return disconnectedConnection("linear");
      return yield* linear.viewerName(apiKey.value).pipe(
        Effect.map((account) => connectedConnection("linear", account, null, null)),
        Effect.catch((error) =>
          Effect.succeed(connectedConnection("linear", null, null, error.message)),
        ),
      );
    }
    const credentials = yield* readJiraCredentials;
    if (Option.isNone(credentials)) return disconnectedConnection("jira");
    const site = credentials.value.siteUrl;
    return yield* jira.myself(credentials.value).pipe(
      Effect.map((account) => connectedConnection("jira", account, site, null)),
      Effect.catch((error) =>
        Effect.succeed(connectedConnection("jira", null, site, error.message)),
      ),
    );
  });

  const getConnections = Effect.forEach(TRACKERS, connection, { concurrency: "unbounded" }).pipe(
    Effect.map((trackers) => ({ trackers })),
    Effect.withSpan("IssueTrackerService.getConnections"),
  );

  const mutate = Effect.fn("IssueTrackerService.mutate")(function* (input: IssueTrackerMutation) {
    switch (input.type) {
      case "connectLinear": {
        // Saving only credentials the tracker accepts keeps a typo from looking connected.
        const account = yield* linear.viewerName(input.apiKey);
        yield* secrets
          .set(LINEAR_KEY_SECRET, new TextEncoder().encode(input.apiKey))
          .pipe(Effect.mapError(storageError("linear", "Could not save the Linear key.")));
        return { account };
      }
      case "connectJira": {
        const siteUrl = normalizeJiraSiteUrl(input.siteUrl);
        if (siteUrl === null) {
          return yield* new IssueTrackerError({
            tracker: "jira",
            reason: "invalidInput",
            detail: "Enter your Jira site, such as https://your-team.atlassian.net.",
          });
        }
        const credentials = { siteUrl, email: input.email, apiToken: input.apiToken };
        const account = yield* jira.myself(credentials);
        const json = yield* encodeJiraCredentials(credentials).pipe(
          Effect.mapError(storageError("jira", "Could not save the Jira credentials.")),
        );
        yield* secrets
          .set(JIRA_SECRET, new TextEncoder().encode(json))
          .pipe(Effect.mapError(storageError("jira", "Could not save the Jira credentials.")));
        return { account };
      }
      case "disconnect":
        yield* secrets
          .remove(input.tracker === "linear" ? LINEAR_KEY_SECRET : JIRA_SECRET)
          .pipe(Effect.mapError(storageError(input.tracker, "Could not remove the credentials.")));
        return {};
      case "refreshIssues":
        issueCache.clear();
        keyCache.clear();
        return {};
      case "link":
      case "unlink":
        yield* writeLock.withPermits(1)(
          Effect.gen(function* () {
            const links = yield* readLinks;
            const { [input.threadId]: previous = {}, ...others } = links.threads;
            const { [input.tracker]: entry, ...otherTrackers } = previous;
            const next = applyThreadLinkMutation(entry, input);
            const threadLinks: ThreadLinks =
              next === undefined ? otherTrackers : { ...otherTrackers, [input.tracker]: next };
            yield* writeLinks({
              threads:
                Object.keys(threadLinks).length === 0
                  ? others
                  : { ...others, [input.threadId]: threadLinks },
            });
          }),
        );
        return {};
    }
  });

  return IssueTrackerService.of({
    getThreadIssues,
    search,
    getConnections,
    getThreadSummaries,
    getIssues,
    mutate,
  });
});

const notConnected = (tracker: IssueTrackerKind) =>
  Effect.fail(
    new IssueTrackerError({
      tracker,
      reason: "notConnected",
      detail: `Connect ${tracker === "linear" ? "Linear" : "Jira"} in Settings → Issue trackers.`,
    }),
  );

const disconnectedConnection = (tracker: IssueTrackerKind): IssueTrackerConnection => ({
  tracker,
  connected: false,
  account: null,
  site: null,
  error: null,
});

const connectedConnection = (
  tracker: IssueTrackerKind,
  account: string | null,
  site: string | null,
  error: string | null,
): IssueTrackerConnection => ({ tracker, connected: true, account, site, error });

export const layer = Layer.effect(IssueTrackerService, make);
