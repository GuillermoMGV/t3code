import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledThreadsService from "./ScheduledThreadsService.ts";

const layer = ScheduledThreadsService.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

describe("ScheduledThreadsService", () => {
  it.effect("lists only threads whose first message a scheduled task sent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const insert = (messageId: string, threadId: string, createdAt: string) =>
        sql`INSERT INTO orchestration_v2_projection_messages
          (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
          VALUES (${messageId}, ${threadId}, NULL, NULL, 'user', 0, ${createdAt}, ${createdAt}, '{}')`;

      // Launched by a task, then continued by it and by a person.
      yield* insert(
        "scheduled-task-message:scheduled-task:a:1:scheduled",
        "thread:launched",
        "2026-01-01T00:00:00Z",
      );
      yield* insert("message:reply", "thread:launched", "2026-01-01T00:01:00Z");
      yield* insert(
        "scheduled-task-message:scheduled-task:a:2:scheduled",
        "thread:launched",
        "2026-01-02T00:00:00Z",
      );
      // A person's thread that a task was bound to later.
      yield* insert("message:first", "thread:bound", "2026-01-01T00:00:00Z");
      yield* insert(
        "scheduled-task-message:scheduled-task:b:1:scheduled",
        "thread:bound",
        "2026-01-02T00:00:00Z",
      );
      // A person's thread only.
      yield* insert("message:other", "thread:manual", "2026-01-01T00:00:00Z");

      const service = yield* ScheduledThreadsService.ScheduledThreadsService;
      const result = yield* service.list;
      expect(result.threadIds).toEqual(["thread:launched"]);
    }).pipe(Effect.provide(layer)),
  );
});
