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
  type IssueTrackerThreadRow,
  parseIssueReference,
} from "@t3tools/contracts";
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
/** Written by the first, Linear-only version of this feature. */
const LEGACY_LINEAR_LINKS_FILE = "linear-links.json";

const ThreadLinkEntry = Schema.Struct({
  key: Schema.optional(IssueKey),
  dismissed: Schema.optional(Schema.Array(IssueKey)),
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
  const key = detected.find((candidate) => !dismissed.includes(candidate));
  return key === undefined ? null : { key, source: "detected" };
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
          const issue = yield* fetchIssue(tracker, link.key);
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
    return { rows };
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

  return IssueTrackerService.of({ getThreadIssues, search, getConnections, mutate });
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
