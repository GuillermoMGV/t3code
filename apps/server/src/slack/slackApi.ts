import { SlackError } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import { SlackSearchMatch } from "./slackMentions.ts";

// Fork-only Slack reviewer reminders; see CUSTOM_DEVELOPMENT.md.

const SLACK_API_URL = "https://slack.com/api";
const USER_PAGES = 10;

const Envelope = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  needed: Schema.optional(Schema.String),
});
const decodeEnvelope = Schema.decodeUnknownEffect(Envelope);

const SlackUser = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  real_name: Schema.optional(Schema.String),
  deleted: Schema.optional(Schema.Boolean),
  is_bot: Schema.optional(Schema.Boolean),
  profile: Schema.optional(
    Schema.Struct({
      display_name: Schema.optional(Schema.String),
      real_name: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
    }),
  ),
});
export type SlackUser = typeof SlackUser.Type;

const AuthTest = Schema.Struct({
  user: Schema.String,
  team: Schema.String,
  user_id: Schema.optional(Schema.String),
  team_id: Schema.optional(Schema.String),
});
const SearchData = Schema.Struct({
  messages: Schema.Struct({ matches: Schema.optional(Schema.Array(Schema.Unknown)) }),
});
// One match at a time, so an odd message type cannot fail the whole list.
const decodeSearchMatch = Schema.decodeUnknownOption(SlackSearchMatch);
const UserData = Schema.Struct({ user: SlackUser });
const UserList = Schema.Struct({
  members: Schema.Array(SlackUser),
  response_metadata: Schema.optional(
    Schema.Struct({ next_cursor: Schema.optional(Schema.String) }),
  ),
});
const OpenData = Schema.Struct({ channel: Schema.Struct({ id: Schema.String }) });

const slackError = (reason: SlackError["reason"], detail: string, cause?: unknown) =>
  new SlackError({ reason, detail, cause });

const invalidResponse = (cause: unknown) =>
  slackError("invalidResponse", "Slack returned a response T3 Code could not read.", cause);

const UNAUTHORIZED = new Set(["invalid_auth", "not_authed", "token_revoked", "account_inactive"]);

/** Turns Slack's `{ ok: false, error }` answer into a SlackError a person can act on. */
function slackFailure(error: string, needed: string | undefined): SlackError {
  if (UNAUTHORIZED.has(error)) {
    return slackError(
      "unauthorized",
      "Slack rejected the token. Connect Slack again in Settings → Issue trackers.",
    );
  }
  // Apps with token rotation issue user tokens that last 12 hours; T3 Code cannot refresh them.
  if (error === "token_expired") {
    return slackError(
      "unauthorized",
      "The Slack token expired because the Slack app has token rotation on. Use an app without token rotation and connect Slack again in Settings → Issue trackers.",
    );
  }
  if (error === "missing_scope") {
    return slackError(
      "rejected",
      `The Slack token is missing the ${needed ?? "required"} scope. Add it to the Slack app and reinstall it.`,
    );
  }
  if (error === "ratelimited") return slackError("rejected", "Slack is rate limiting. Try again.");
  return slackError("rejected", `Slack answered: ${error}.`);
}

export const makeSlackApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  // Lets local tests point the server at a mock; unset in normal use.
  const baseUrl = yield* Config.String("T3CODE_SLACK_API_URL").pipe(
    Config.withDefault(SLACK_API_URL),
    Effect.orElseSucceed(() => SLACK_API_URL),
  );

  /** Calls a Web API method; `null` data means Slack answered with the `allowed` error. */
  const call = Effect.fn("SlackApi.call")(function* <A, I>(
    token: string,
    method: string,
    params: Record<string, string>,
    schema: Schema.Codec<A, I>,
    allowed?: string,
  ) {
    const response = yield* client
      .execute(
        HttpClientRequest.post(`${baseUrl.replace(/\/+$/, "")}/${method}`).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.bodyUrlParams(params),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) =>
          slackError(
            "network",
            "Could not reach Slack. Check the connection and try again.",
            cause,
          ),
        ),
      );
    if (response.status === 429) return yield* slackFailure("ratelimited", undefined);
    const body = yield* response.json.pipe(Effect.mapError(invalidResponse));
    const envelope = yield* decodeEnvelope(body).pipe(Effect.mapError(invalidResponse));
    if (!envelope.ok) {
      if (allowed !== undefined && envelope.error === allowed) return Option.none<A>();
      return yield* slackFailure(envelope.error ?? "unknown_error", envelope.needed);
    }
    return Option.some(
      yield* Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError(invalidResponse)),
    );
  });

  const required = <A>(value: Option.Option<A>) =>
    Effect.fromOption(value).pipe(Effect.mapError(() => invalidResponse("empty answer")));

  /** `name · workspace` of the token's owner. */
  const account = Effect.fn("SlackApi.account")(function* (token: string) {
    const auth = yield* call(token, "auth.test", {}, AuthTest).pipe(Effect.flatMap(required));
    return `${auth.user} · ${auth.team}`;
  });

  /** The token owner's member and workspace ids. */
  const identity = Effect.fn("SlackApi.identity")(function* (token: string) {
    const auth = yield* call(token, "auth.test", {}, AuthTest).pipe(Effect.flatMap(required));
    if (auth.user_id === undefined) return yield* invalidResponse("auth.test without user_id");
    return { userId: auth.user_id, teamId: auth.team_id ?? auth.team };
  });

  /** Newest messages that mention the user; needs the `search:read` user scope. */
  const searchMentions = Effect.fn("SlackApi.searchMentions")(function* (
    token: string,
    userId: string,
  ) {
    const data = yield* call(
      token,
      "search.messages",
      { query: `<@${userId}>`, sort: "timestamp", sort_dir: "desc", count: "50" },
      SearchData,
    ).pipe(Effect.flatMap(required));
    return (data.messages.matches ?? []).flatMap((raw) => {
      const match = decodeSearchMatch(raw);
      return Option.isSome(match) ? [match.value] : [];
    });
  });

  const userByEmail = Effect.fn("SlackApi.userByEmail")(function* (token: string, email: string) {
    const found = yield* call(token, "users.lookupByEmail", { email }, UserData, "users_not_found");
    return Option.map(found, (data) => data.user);
  });

  const userById = Effect.fn("SlackApi.userById")(function* (token: string, id: string) {
    const found = yield* call(token, "users.info", { user: id }, UserData, "user_not_found");
    return Option.map(found, (data) => data.user);
  });

  const listUsers = Effect.fn("SlackApi.listUsers")(function* (token: string) {
    const users: SlackUser[] = [];
    let cursor = "";
    for (let page = 0; page < USER_PAGES; page++) {
      const data = yield* call(
        token,
        "users.list",
        { limit: "200", ...(cursor === "" ? {} : { cursor }) },
        UserList,
      ).pipe(Effect.flatMap(required));
      users.push(...data.members);
      cursor = data.response_metadata?.next_cursor ?? "";
      if (cursor === "") break;
    }
    return users;
  });

  /** Opens (or reuses) the direct message with the user and posts the text as the token owner. */
  const sendDirectMessage = Effect.fn("SlackApi.sendDirectMessage")(function* (
    token: string,
    userId: string,
    text: string,
  ) {
    const open = yield* call(token, "conversations.open", { users: userId }, OpenData).pipe(
      Effect.flatMap(required),
    );
    yield* call(token, "chat.postMessage", { channel: open.channel.id, text }, Envelope);
  });

  return {
    account,
    identity,
    searchMentions,
    userByEmail,
    userById,
    listUsers,
    sendDirectMessage,
  };
});

export type SlackApi = Effect.Success<typeof makeSlackApi>;
