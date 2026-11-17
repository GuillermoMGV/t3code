import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { matchSlackUser, slackUserReferenceKind } from "./SlackService.ts";
import { makeSlackApi, type SlackUser } from "./slackApi.ts";

const user = (id: string, fields: Partial<SlackUser> = {}): SlackUser => ({ id, ...fields });

describe("matchSlackUser", () => {
  const ada = user("U1", { name: "ada", real_name: "Ada Lovelace" });
  const grace = user("U2", { name: "grace.h", profile: { display_name: "Grace Hopper" } });
  const people = [ada, grace];

  it.each([
    ["the handle equal to the login", { login: "ADA", name: null }, "U1"],
    ["the display name equal to the reviewer's name", { login: "gh", name: "grace hopper" }, "U2"],
    ["accents ignored in names", { login: "x", name: "Adá Lovelace" }, "U1"],
    ["nobody when nothing matches", { login: "linus", name: "Linus" }, null],
  ])("finds %s", (_label, reviewer, expected) => {
    expect(matchSlackUser(people, reviewer)?.id ?? null).toBe(expected);
  });

  it("refuses to guess between namesakes and skips deactivated members", () => {
    const twins = [user("U3", { real_name: "Sam Lee" }), user("U4", { real_name: "Sam Lee" })];
    expect(matchSlackUser(twins, { login: "sam", name: "Sam Lee" })).toBeNull();
    expect(
      matchSlackUser([{ ...ada, deleted: true }, grace], { login: "ada", name: null }),
    ).toBeNull();
  });
});

describe("slackUserReferenceKind", () => {
  it.each([
    ["U012ABCDEF", "id"],
    ["W0ABC", "id"],
    ["ada@example.com", "email"],
    ["ada", null],
    ["u012abc", null],
  ])("reads %s as %s", (reference, kind) => {
    expect(slackUserReferenceKind(reference)).toBe(kind);
  });
});

function httpAnswering(answer: (method: string) => unknown) {
  const requests: Array<{ method: string; authorization: string | undefined; body: string }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const method = new URL(request.url).pathname.split("/").at(-1) ?? "";
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      requests.push({ method, authorization: request.headers.authorization, body });
      return HttpClientResponse.fromWeb(request, Response.json(answer(method)));
    }),
  );
  return { requests, http };
}

describe("makeSlackApi", () => {
  it.effect("opens the direct message and posts the text as the token owner", () =>
    Effect.gen(function* () {
      const { requests, http } = httpAnswering((method) =>
        method === "conversations.open" ? { ok: true, channel: { id: "D1" } } : { ok: true },
      );
      const api = yield* makeSlackApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      yield* api.sendDirectMessage("xoxp-1", "U1", "Hey, a quick look?");
      expect(requests.map((request) => request.method)).toEqual([
        "conversations.open",
        "chat.postMessage",
      ]);
      expect(requests[0]?.authorization).toBe("Bearer xoxp-1");
      expect(new URLSearchParams(requests[1]?.body).get("channel")).toBe("D1");
      expect(new URLSearchParams(requests[1]?.body).get("text")).toBe("Hey, a quick look?");
    }),
  );

  it.effect("reads an unknown email as nobody and a revoked token as unauthorized", () =>
    Effect.gen(function* () {
      const { http } = httpAnswering((method) =>
        method === "users.lookupByEmail"
          ? { ok: false, error: "users_not_found" }
          : { ok: false, error: "token_revoked" },
      );
      const api = yield* makeSlackApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      expect((yield* api.userByEmail("xoxp-1", "nobody@example.com"))._tag).toBe("None");
      const error = yield* api.account("xoxp-1").pipe(Effect.flip);
      expect(error.reason).toBe("unauthorized");
    }),
  );

  it.effect("names the missing scope", () =>
    Effect.gen(function* () {
      const { http } = httpAnswering(() => ({
        ok: false,
        error: "missing_scope",
        needed: "im:write",
      }));
      const api = yield* makeSlackApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const error = yield* api.sendDirectMessage("xoxp-1", "U1", "Hi").pipe(Effect.flip);
      expect(error.message).toContain("im:write");
    }),
  );
});
