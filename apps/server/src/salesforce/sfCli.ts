import { SalesforceError, type SalesforceOrg, type SalesforceOrgType } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

// Keeps errors on stdout as JSON and update notices out of it.
const SF_ENV = {
  SF_JSON_TO_STDOUT: "true",
  SF_DISABLE_AUTOUPDATE: "true",
  SF_HIDE_RELEASE_NOTES: "true",
  SF_HIDE_RELEASE_NOTES_FOOTER: "true",
  SF_SKIP_NEW_VERSION_CHECK: "true",
};

const SfJson = Schema.Struct({
  status: Schema.Number,
  result: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
type SfJson = typeof SfJson.Type;
const decodeSfJson = Schema.decodeUnknownOption(Schema.fromJsonString(SfJson));

/** The `--json` envelope in the output, skipping any warning printed before it. */
export function parseSfJson(stdout: string): SfJson | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return Option.getOrNull(decodeSfJson(stdout.slice(start, end + 1)));
}

// Only these fields leave this module: `sf org list` also returns access tokens.
const RawOrg = Schema.Struct({
  username: Schema.String,
  alias: Schema.optional(Schema.NullOr(Schema.String)),
  orgId: Schema.optional(Schema.NullOr(Schema.String)),
  instanceUrl: Schema.optional(Schema.NullOr(Schema.String)),
  isSandbox: Schema.optional(Schema.NullOr(Schema.Boolean)),
  isScratch: Schema.optional(Schema.NullOr(Schema.Boolean)),
  isDevHub: Schema.optional(Schema.NullOr(Schema.Boolean)),
  isDefaultUsername: Schema.optional(Schema.NullOr(Schema.Boolean)),
  connectedStatus: Schema.optional(Schema.NullOr(Schema.String)),
  lastUsed: Schema.optional(Schema.NullOr(Schema.String)),
});
type RawOrg = typeof RawOrg.Type;
const decodeRawOrg = Schema.decodeUnknownOption(RawOrg);

const ORG_LISTS = ["nonScratchOrgs", "sandboxes", "other", "devHubs", "scratchOrgs"] as const;

function orgType(org: RawOrg): SalesforceOrgType {
  if (org.isScratch) return "scratch";
  if (org.isSandbox) return "sandbox";
  return org.isDevHub ? "devhub" : "production";
}

/** Every org in `sf org list --json`'s result, once per username, without secrets. */
export function parseOrgList(result: unknown): SalesforceOrg[] {
  if (typeof result !== "object" || result === null) return [];
  const byUsername = new Map<string, SalesforceOrg>();
  for (const list of ORG_LISTS) {
    const items = (result as Record<string, unknown>)[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const raw = Option.getOrNull(decodeRawOrg(item));
      if (raw === null) continue;
      const previous = byUsername.get(raw.username);
      byUsername.set(raw.username, {
        alias: raw.alias ?? previous?.alias ?? null,
        username: raw.username,
        orgId: raw.orgId ?? previous?.orgId ?? null,
        instanceUrl: raw.instanceUrl ?? previous?.instanceUrl ?? null,
        type: orgType(raw),
        isDefault: (raw.isDefaultUsername ?? false) || (previous?.isDefault ?? false),
        connectedStatus: raw.connectedStatus ?? previous?.connectedStatus ?? null,
        lastUsed: raw.lastUsed ?? previous?.lastUsed ?? null,
      });
    }
  }
  return [...byUsername.values()].sort((a, b) =>
    (a.alias ?? a.username).localeCompare(b.alias ?? b.username, undefined, {
      sensitivity: "base",
    }),
  );
}

/** `2.151.7` from `@salesforce/cli/2.151.7 win32-x64 node-v24.20.0`. */
export function parseSfVersion(output: string): string | null {
  return /@salesforce\/cli\/(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

/** A readable failure from the envelope, without the CLI's stack or tips. */
export function describeSfFailure(json: SfJson | null, fallback: string): string {
  const message = json?.message?.trim();
  if (!message) return fallback;
  return /EADDRINUSE|1717/i.test(message)
    ? "Port 1717 is busy, so the Salesforce login callback cannot start. Close the other login (or the app using the port) and try again."
    : message;
}

export const makeSfCli = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;

  /** Runs `sf <args> --json` in `cwd`; a missing CLI fails with `cliMissing`. */
  const run = Effect.fn("SfCli.run")(function* (
    cwd: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input = "3 minutes",
  ) {
    const output = yield* runner
      .run({
        command: "sf",
        args: [...args, "--json"],
        cwd,
        env: SF_ENV,
        timeout,
        maxOutputBytes: 16 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SalesforceError({
              reason: cause._tag === "ProcessSpawnError" ? "cliMissing" : "command",
              detail:
                cause._tag === "ProcessSpawnError"
                  ? "The Salesforce CLI (sf) is not installed or not on PATH."
                  : cause._tag === "ProcessTimeoutError"
                    ? `sf ${args.slice(0, 2).join(" ")} took too long.`
                    : `sf ${args.slice(0, 2).join(" ")} failed.`,
              cause,
            }),
        ),
      );
    // A shell that cannot find `sf` exits 1 (cmd.exe: 9009) without JSON.
    const json = parseSfJson(output.stdout);
    if (json === null && /not recognized|not found|9009/i.test(`${output.stderr} ${output.code}`)) {
      return yield* new SalesforceError({
        reason: "cliMissing",
        detail: "The Salesforce CLI (sf) is not installed or not on PATH.",
      });
    }
    return json;
  });

  /** The installed CLI version, or null when `sf` cannot run. */
  const version = (cwd: string) =>
    runner.run({ command: "sf", args: ["--version"], cwd, env: SF_ENV, timeout: "1 minute" }).pipe(
      Effect.map((output) => parseSfVersion(output.stdout)),
      Effect.orElseSucceed(() => null),
    );

  return { run, version };
});

export type SfCli = Effect.Success<typeof makeSfCli>;
