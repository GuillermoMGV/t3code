import {
  SlackError,
  type SlackMutation,
  type SlackMutationResult,
  type SlackState,
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
import { makeSlackApi, type SlackUser } from "./slackApi.ts";

// Fork-only Slack reviewer reminders; see CUSTOM_DEVELOPMENT.md.

const TOKEN_SECRET = "slack-user-token";
const MAPPINGS_FILE = "slack-reviewers.json";
const ACCOUNT_CACHE_MS = 10 * 60_000;
const USERS_CACHE_MS = 10 * 60_000;

const MappingsFile = Schema.fromJsonString(
  Schema.Struct({ mappings: Schema.Record(Schema.String, Schema.String) }),
);
type MappingsFile = typeof MappingsFile.Type;
const decodeMappings = Schema.decodeEffect(MappingsFile);
const encodeMappings = Schema.encodeEffect(MappingsFile);

const SLACK_ID = /^[UW][A-Z0-9]{2,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a mapping names a Slack member ID or an email; null for anything else. */
export function slackUserReferenceKind(reference: string): "id" | "email" | null {
  const value = reference.trim();
  if (SLACK_ID.test(value)) return "id";
  if (EMAIL.test(value)) return "email";
  return null;
}

const normalize = (value: string | undefined) =>
  (value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();

/**
 * The one active Slack member whose handle equals the login or whose name equals the reviewer's
 * display name. Null when nobody or several people match, so a guess never reaches the wrong DM.
 */
export function matchSlackUser(
  users: ReadonlyArray<SlackUser>,
  reviewer: { readonly login: string; readonly name: string | null },
): SlackUser | null {
  const login = normalize(reviewer.login);
  const name = normalize(reviewer.name ?? undefined);
  const active = users.filter((user) => user.deleted !== true && user.is_bot !== true);
  const byLogin = active.filter((user) => normalize(user.name) === login);
  if (byLogin.length === 1) return byLogin[0]!;
  if (name.length === 0) return null;
  const byName = active.filter((user) =>
    [user.real_name, user.profile?.real_name, user.profile?.display_name].some(
      (candidate) => normalize(candidate) === name,
    ),
  );
  return byName.length === 1 ? byName[0]! : null;
}

const slackUserLabel = (user: SlackUser) =>
  user.profile?.display_name || user.real_name || user.profile?.real_name || user.name || user.id;

const storageError = (detail: string) => (cause: unknown) =>
  new SlackError({ reason: "storage", detail, cause });

export class SlackService extends Context.Service<
  SlackService,
  {
    readonly getState: Effect.Effect<SlackState, SlackError>;
    readonly mutate: (input: SlackMutation) => Effect.Effect<SlackMutationResult, SlackError>;
  }
>()("t3/slack/SlackService") {}

const make = Effect.gen(function* () {
  const api = yield* makeSlackApi;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const mappingsPath = path.join(stateDir, MAPPINGS_FILE);
  const writeLock = yield* Semaphore.make(1);
  let accountCache: { token: string; account: string; at: number } | null = null;
  let usersCache: { token: string; users: ReadonlyArray<SlackUser>; at: number } | null = null;

  const readToken = secrets
    .get(TOKEN_SECRET)
    .pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())),
      Effect.map(Option.filter((value) => value.length > 0)),
      Effect.mapError(storageError("Could not read the saved Slack token.")),
    );

  const requireToken = readToken.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new SlackError({
              reason: "notConnected",
              detail: "Connect Slack in Settings → Issue trackers.",
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

  const readMappings: Effect.Effect<MappingsFile["mappings"], SlackError> = Effect.gen(
    function* () {
      const json = yield* fileSystem.readFileString(mappingsPath).pipe(
        Effect.asSome,
        Effect.catchIf(
          (cause) => cause.reason._tag === "NotFound",
          () => Effect.succeedNone,
        ),
      );
      if (Option.isNone(json)) return {};
      return (yield* decodeMappings(json.value)).mappings;
    },
  ).pipe(Effect.mapError(storageError("Could not read the Slack reviewer mappings.")));

  // Writes run under writeLock, so one temporary name is enough.
  const updateMappings = (change: (mappings: Record<string, string>) => void) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const mappings = { ...(yield* readMappings) };
        change(mappings);
        const json = yield* encodeMappings({ mappings }).pipe(
          Effect.mapError(storageError("Could not save the Slack reviewer mappings.")),
        );
        const tempPath = `${mappingsPath}.tmp`;
        yield* fileSystem
          .writeFileString(tempPath, `${json}\n`)
          .pipe(
            Effect.andThen(fileSystem.rename(tempPath, mappingsPath)),
            Effect.mapError(storageError("Could not save the Slack reviewer mappings.")),
          );
      }),
    );

  const cachedAccount = Effect.fn("SlackService.cachedAccount")(function* (token: string) {
    const now = yield* Clock.currentTimeMillis;
    if (accountCache?.token === token && now - accountCache.at < ACCOUNT_CACHE_MS) {
      return accountCache.account;
    }
    const account = yield* api.account(token);
    accountCache = { token, account, at: now };
    return account;
  });

  const cachedUsers = Effect.fn("SlackService.cachedUsers")(function* (token: string) {
    const now = yield* Clock.currentTimeMillis;
    if (usersCache?.token === token && now - usersCache.at < USERS_CACHE_MS) {
      return usersCache.users;
    }
    const users = yield* api.listUsers(token);
    usersCache = { token, users, at: now };
    return users;
  });

  const getState = Effect.gen(function* () {
    const mappings = Object.entries(yield* readMappings).map(([login, slackUser]) => ({
      login,
      slackUser,
    }));
    const token = yield* readToken;
    if (Option.isNone(token)) return { connected: false, account: null, error: null, mappings };
    return yield* cachedAccount(token.value).pipe(
      Effect.map((account) => ({ connected: true, account, error: null, mappings })),
      Effect.catch((error: SlackError) =>
        Effect.succeed({ connected: true, account: null, error: error.message, mappings }),
      ),
    );
  }).pipe(Effect.withSpan("SlackService.getState"));

  const resolveReference = Effect.fn("SlackService.resolveReference")(function* (
    token: string,
    reference: string,
  ) {
    const kind = slackUserReferenceKind(reference);
    if (kind === null) {
      return yield* new SlackError({
        reason: "invalidInput",
        detail: "Enter the reviewer's Slack email or member ID (U…).",
      });
    }
    const found =
      kind === "id"
        ? yield* api.userById(token, reference.trim())
        : yield* api.userByEmail(token, reference.trim());
    if (Option.isNone(found)) {
      return yield* new SlackError({
        reason: "userNotFound",
        detail: `No Slack member found for ${reference.trim()}.`,
      });
    }
    return found.value;
  });

  const resolveReviewer = Effect.fn("SlackService.resolveReviewer")(function* (
    token: string,
    reviewer: { readonly login: string; readonly name: string | null },
    explicit: string | undefined,
  ) {
    if (explicit !== undefined) return yield* resolveReference(token, explicit);
    const mapped = (yield* readMappings)[reviewer.login.toLowerCase()];
    if (mapped !== undefined) return yield* resolveReference(token, mapped);
    const match = matchSlackUser(yield* cachedUsers(token), reviewer);
    if (match !== null) return match;
    return yield* new SlackError({
      reason: "userNotFound",
      detail: `Could not tell who @${reviewer.login} is in Slack. Enter their Slack email.`,
    });
  });

  const mutate = Effect.fn("SlackService.mutate")(function* (input: SlackMutation) {
    switch (input.type) {
      case "connect": {
        // Saving only a token Slack accepts keeps a typo from looking connected.
        const account = yield* api.account(input.token);
        yield* secrets
          .set(TOKEN_SECRET, new TextEncoder().encode(input.token))
          .pipe(Effect.mapError(storageError("Could not save the Slack token.")));
        accountCache = null;
        usersCache = null;
        return { account };
      }
      case "disconnect":
        yield* secrets
          .remove(TOKEN_SECRET)
          .pipe(Effect.mapError(storageError("Could not remove the Slack token.")));
        accountCache = null;
        usersCache = null;
        return {};
      case "setMapping": {
        const { slackUser } = input;
        if (slackUser !== null && slackUserReferenceKind(slackUser) === null) {
          return yield* new SlackError({
            reason: "invalidInput",
            detail: "Enter a Slack email or member ID (U…).",
          });
        }
        const login = input.login.toLowerCase();
        yield* updateMappings((mappings) => {
          if (slackUser === null) delete mappings[login];
          else mappings[login] = slackUser;
        });
        return {};
      }
      case "remindReviewer": {
        const token = yield* requireToken;
        const user = yield* resolveReviewer(token, input, input.slackUser);
        yield* api.sendDirectMessage(token, user.id, input.text);
        const { slackUser } = input;
        if (slackUser !== undefined) {
          yield* updateMappings((mappings) => {
            mappings[input.login.toLowerCase()] = slackUser;
          });
        }
        return { recipient: slackUserLabel(user) };
      }
    }
  });

  return SlackService.of({ getState, mutate });
});

export const layer = Layer.effect(SlackService, make);
