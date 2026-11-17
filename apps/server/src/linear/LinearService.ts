import {
  LinearIssueIdentifier,
  LinearRequestError,
  type LinearMutation,
  type LinearMutationResult,
  type LinearSearchIssuesInput,
  type LinearSearchIssuesResult,
  type LinearThreadIssueInput,
  type LinearThreadIssueResult,
  type LinearThreadLinkSource,
  parseLinearIssueReference,
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
import { makeLinearApi } from "./linearApi.ts";

const API_KEY_SECRET = "linear-api-key";
const LINKS_FILE = "linear-links.json";

const ThreadLinkEntry = Schema.Struct({
  identifier: Schema.optional(LinearIssueIdentifier),
  dismissed: Schema.optional(Schema.Array(LinearIssueIdentifier)),
});
type ThreadLinkEntry = typeof ThreadLinkEntry.Type;

const LinksFile = Schema.Struct({
  threads: Schema.Record(Schema.String, ThreadLinkEntry),
});
type LinksFile = typeof LinksFile.Type;
const decodeLinksFile = Schema.decodeUnknownEffect(Schema.fromJsonString(LinksFile));
const encodeLinksFile = Schema.encodeEffect(Schema.fromJsonString(LinksFile));

/** A manual link wins; otherwise the oldest detected issue the user has not dismissed. */
export function resolveThreadLink(
  entry: ThreadLinkEntry | undefined,
  detected: ReadonlyArray<LinearIssueIdentifier>,
): { identifier: LinearIssueIdentifier; source: LinearThreadLinkSource } | null {
  if (entry?.identifier !== undefined) return { identifier: entry.identifier, source: "manual" };
  const dismissed = entry?.dismissed ?? [];
  const identifier = detected.find((candidate) => !dismissed.includes(candidate));
  return identifier === undefined ? null : { identifier, source: "detected" };
}

/** The entry after a mutation, or undefined when nothing is left to remember. */
export function applyThreadLinkMutation(
  entry: ThreadLinkEntry | undefined,
  mutation: Extract<LinearMutation, { type: "link" | "unlink" }>,
): ThreadLinkEntry | undefined {
  const dismissed = entry?.dismissed ?? [];
  if (mutation.type === "link") {
    const rest = dismissed.filter((identifier) => identifier !== mutation.identifier);
    return rest.length > 0
      ? { identifier: mutation.identifier, dismissed: rest }
      : { identifier: mutation.identifier };
  }
  const next = [...new Set([...dismissed, ...mutation.dismissIdentifiers])];
  return next.length > 0 ? { dismissed: next } : undefined;
}

const storageError = (detail: string) => (cause: unknown) =>
  new LinearRequestError({ reason: "storage", detail, cause });

export class LinearService extends Context.Service<
  LinearService,
  {
    readonly getThreadIssue: (
      input: LinearThreadIssueInput,
    ) => Effect.Effect<LinearThreadIssueResult, LinearRequestError>;
    readonly searchIssues: (
      input: LinearSearchIssuesInput,
    ) => Effect.Effect<LinearSearchIssuesResult, LinearRequestError>;
    readonly mutate: (
      input: LinearMutation,
    ) => Effect.Effect<LinearMutationResult, LinearRequestError>;
  }
>()("t3/linear/LinearService") {}

const make = Effect.gen(function* () {
  const api = yield* makeLinearApi;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const linksPath = path.join(stateDir, LINKS_FILE);
  const writeLock = yield* Semaphore.make(1);

  const readApiKey = secrets
    .get(API_KEY_SECRET)
    .pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())),
      Effect.map(Option.filter((key) => key.length > 0)),
      Effect.mapError(storageError("Could not read the saved Linear key.")),
    );

  const requireApiKey = readApiKey.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new LinearRequestError({ reason: "notConnected", detail: "Connect Linear first." }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

  const readLinks: Effect.Effect<LinksFile, LinearRequestError> = fileSystem
    .readFileString(linksPath)
    .pipe(
      Effect.asSome,
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeedNone,
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed<LinksFile>({ threads: {} }),
          onSome: decodeLinksFile,
        }),
      ),
      Effect.mapError(storageError("Could not read the Linear thread links.")),
    );

  // Writes run under writeLock, so one temporary name is enough.
  const writeLinks = Effect.fn("LinearService.writeLinks")(
    function* (links: LinksFile) {
      const tempPath = `${linksPath}.tmp`;
      yield* fileSystem.writeFileString(tempPath, `${yield* encodeLinksFile(links)}\n`);
      yield* fileSystem.rename(tempPath, linksPath);
    },
    Effect.mapError(storageError("Could not save the Linear thread links.")),
  );

  const getThreadIssue = Effect.fn("LinearService.getThreadIssue")(function* (
    input: LinearThreadIssueInput,
  ) {
    const links = yield* readLinks;
    const link = resolveThreadLink(links.threads[input.threadId], input.detectedIdentifiers);
    const apiKey = yield* readApiKey;
    if (Option.isNone(apiKey)) return { connected: false, link, issue: null };
    const issue = link === null ? null : yield* api.issue(apiKey.value, link.identifier);
    return { connected: true, link, issue };
  });

  const searchIssues = Effect.fn("LinearService.searchIssues")(function* (
    input: LinearSearchIssuesInput,
  ) {
    const apiKey = yield* requireApiKey;
    const query = input.query.trim();
    if (query.length === 0) return { issues: yield* api.assignedOpenIssues(apiKey) };
    const identifier = parseLinearIssueReference(query);
    if (identifier !== null) {
      const issue = yield* api.issue(apiKey, identifier);
      return { issues: issue === null ? [] : [issue] };
    }
    return { issues: yield* api.search(apiKey, query) };
  });

  const mutate = Effect.fn("LinearService.mutate")(function* (input: LinearMutation) {
    switch (input.type) {
      case "connect": {
        // Saving only a key Linear accepts keeps a typo from looking connected.
        const viewerName = yield* api.viewerName(input.apiKey);
        yield* secrets
          .set(API_KEY_SECRET, new TextEncoder().encode(input.apiKey))
          .pipe(Effect.mapError(storageError("Could not save the Linear key.")));
        return { viewerName };
      }
      case "disconnect":
        yield* secrets
          .remove(API_KEY_SECRET)
          .pipe(Effect.mapError(storageError("Could not remove the Linear key.")));
        return {};
      case "link":
      case "unlink":
        yield* writeLock.withPermits(1)(
          Effect.gen(function* () {
            const links = yield* readLinks;
            const { [input.threadId]: previous, ...others } = links.threads;
            const next = applyThreadLinkMutation(previous, input);
            yield* writeLinks({
              threads: next === undefined ? others : { ...others, [input.threadId]: next },
            });
          }),
        );
        return {};
    }
  });

  return LinearService.of({ getThreadIssue, searchIssues, mutate });
});

export const layer = Layer.effect(LinearService, make);
