import { ScheduledThreadsError, type ScheduledThreadsResult, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

// Fork-only list of threads a scheduled task started; see CUSTOM_DEVELOPMENT.md.

/**
 * `ScheduledTaskService` names every message it sends `scheduled-task-message:<fire key>`.
 * A thread whose first message has that id was launched by the task, not by a person.
 */
const SCHEDULED_MESSAGE_PREFIX = "scheduled-task-message:";
// The next code point after ":", so the range below scans the primary key index only.
const SCHEDULED_MESSAGE_PREFIX_END = "scheduled-task-message;";

export class ScheduledThreadsService extends Context.Service<
  ScheduledThreadsService,
  {
    readonly list: Effect.Effect<ScheduledThreadsResult, ScheduledThreadsError>;
  }
>()("t3/scheduledThreads/ScheduledThreadsService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list = Effect.fn("ScheduledThreadsService.list")(function* () {
    const rows = yield* sql<{ thread_id: string }>`
      SELECT DISTINCT scheduled.thread_id
      FROM orchestration_v2_projection_messages AS scheduled
      WHERE scheduled.message_id >= ${SCHEDULED_MESSAGE_PREFIX}
        AND scheduled.message_id < ${SCHEDULED_MESSAGE_PREFIX_END}
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_messages AS earlier
          WHERE earlier.thread_id = scheduled.thread_id
            AND earlier.created_at < scheduled.created_at
        )
    `.pipe(
      Effect.mapError(
        (cause) =>
          new ScheduledThreadsError({ detail: "Could not read the scheduled threads.", cause }),
      ),
    );
    return { threadIds: rows.map((row) => ThreadId.make(row.thread_id)) };
  });

  return ScheduledThreadsService.of({ list: list() });
});

export const layer = Layer.effect(ScheduledThreadsService, make);
