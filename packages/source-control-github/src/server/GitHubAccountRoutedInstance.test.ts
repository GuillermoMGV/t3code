import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { GitHubRequestRepository } from "./GitHubAccountRouting.ts";
import { routeMethods } from "./GitHubAccountRoutedInstance.ts";

describe("routeMethods", () => {
  const target = {
    kind: "github",
    read: (_input: { readonly cwd: string }) => Effect.service(GitHubRequestRepository),
    watch: (_input: { readonly repository: string }) =>
      Stream.fromEffect(Effect.service(GitHubRequestRepository)),
    label: (name: string) => `pr ${name}`,
  };
  const routed = routeMethods(target, (input) =>
    Effect.succeed(
      typeof input === "object" && input !== null && "repository" in input
        ? String(input.repository)
        : "acme/from-cwd",
    ),
  );

  it.effect("tags Effects and Streams with their repository and leaves the rest alone", () =>
    Effect.gen(function* () {
      expect(yield* routed.read({ cwd: "/work/app" })).toBe("acme/from-cwd");
      expect(yield* Stream.runCollect(routed.watch({ repository: "me/side" }))).toEqual([
        "me/side",
      ]);
      expect(routed.label("1")).toBe("pr 1");
      expect(routed.kind).toBe("github");
      expect(yield* target.read({ cwd: "/work/app" })).toBeNull();
    }),
  );
});
