import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

// Fork-only list of threads a scheduled task started, for the sidebar's hide toggle.
// See CUSTOM_DEVELOPMENT.md.

export const ScheduledThreadsInput = Schema.Struct({});
export type ScheduledThreadsInput = typeof ScheduledThreadsInput.Type;

export const ScheduledThreadsResult = Schema.Struct({
  threadIds: Schema.Array(ThreadId),
});
export type ScheduledThreadsResult = typeof ScheduledThreadsResult.Type;

export class ScheduledThreadsError extends Schema.TaggedError<ScheduledThreadsError>()(
  "ScheduledThreadsError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
