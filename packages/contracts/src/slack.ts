import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// Fork-only Slack reviewer reminders from the Pull Requests page; see CUSTOM_DEVELOPMENT.md.

const SlackLogin = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
/** A Slack member ID (`U012ABC`) or the email of their Slack account. */
const SlackUserReference = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const SlackReviewerMapping = Schema.Struct({
  /** The reviewer's source control login, such as a GitHub username. */
  login: SlackLogin,
  slackUser: SlackUserReference,
});
export type SlackReviewerMapping = typeof SlackReviewerMapping.Type;

export const SlackStateInput = Schema.Struct({});
export const SlackState = Schema.Struct({
  connected: Schema.Boolean,
  /** `name · workspace` of the saved token, when Slack confirmed it. */
  account: Schema.NullOr(Schema.String),
  /** Why the saved token could not be checked just now. */
  error: Schema.NullOr(Schema.String),
  mappings: Schema.Array(SlackReviewerMapping),
});
export type SlackState = typeof SlackState.Type;

export const SlackMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("connect"), token: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("disconnect") }),
  Schema.Struct({
    type: Schema.Literal("setMapping"),
    login: SlackLogin,
    /** Null removes the mapping. */
    slackUser: Schema.NullOr(SlackUserReference),
  }),
  Schema.Struct({
    type: Schema.Literal("remindReviewer"),
    login: SlackLogin,
    /** The reviewer's display name, used to find them in Slack when nothing is mapped. */
    name: Schema.NullOr(Schema.String),
    /** Saved as the reviewer's mapping once the message is sent. */
    slackUser: Schema.optional(SlackUserReference),
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  }),
]);
export type SlackMutation = typeof SlackMutation.Type;

export const SlackMutationResult = Schema.Struct({
  /** The account the new token belongs to, after connecting. */
  account: Schema.optional(Schema.String),
  /** Who received the reminder. */
  recipient: Schema.optional(Schema.String),
});
export type SlackMutationResult = typeof SlackMutationResult.Type;

export class SlackError extends Schema.TaggedError<SlackError>()("SlackError", {
  reason: Schema.Literals([
    "notConnected",
    "unauthorized",
    "userNotFound",
    "invalidInput",
    "network",
    "invalidResponse",
    "rejected",
    "storage",
  ]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
