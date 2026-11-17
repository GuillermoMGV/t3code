import {
  matchesSalesforceTarget,
  normalizeSalesforceLoginUrl,
  SalesforceError,
  type SalesforceMutation,
  type SalesforceOrg,
  type SalesforceState,
  type SalesforceStateInput,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { describeSfFailure, makeSfCli, parseOrgList } from "./sfCli.ts";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md. The `sf` CLI owns every file
// here: this service reads `target-org` to show it quickly, and runs `sf` for everything else.

const TargetOrgConfig = Schema.fromJsonString(
  Schema.Struct({ "target-org": Schema.optional(Schema.String) }),
);
const LegacyTargetOrgConfig = Schema.fromJsonString(
  Schema.Struct({ defaultusername: Schema.optional(Schema.String) }),
);
const decodeTargetOrgConfig = Schema.decodeUnknownOption(TargetOrgConfig);
const decodeLegacyTargetOrgConfig = Schema.decodeUnknownOption(LegacyTargetOrgConfig);

const WATCH_DEBOUNCE = "750 millis";

/** Orgs with their `isDefault` flag recomputed for a `target-org` value. */
export function markDefaultOrg(
  orgs: ReadonlyArray<SalesforceOrg>,
  target: string | null,
): SalesforceOrg[] {
  return orgs.map((org) => ({
    ...org,
    isDefault: target !== null && matchesSalesforceTarget(org, target),
  }));
}

/** A fresh list keeps the statuses the previous full check found for the same orgs. */
export function keepKnownStatuses(
  next: ReadonlyArray<SalesforceOrg>,
  previous: ReadonlyArray<SalesforceOrg>,
): SalesforceOrg[] {
  const known = new Map(previous.map((org) => [org.username, org.connectedStatus]));
  return next.map((org) =>
    org.connectedStatus === null
      ? { ...org, connectedStatus: known.get(org.username) ?? null }
      : org,
  );
}

interface Entry {
  state: SalesforceState;
  loginFiber: Fiber.Fiber<unknown, unknown> | null;
}

const emptyState = (isDxProject: boolean): SalesforceState => ({
  cli: null,
  isDxProject,
  defaultOrg: null,
  orgs: [],
  loading: isDxProject,
  checkingStatus: false,
  updatedAt: null,
  error: null,
  login: null,
  lastLogin: null,
});

export class SalesforceService extends Context.Service<
  SalesforceService,
  {
    readonly getState: (
      input: SalesforceStateInput,
    ) => Effect.Effect<SalesforceState, SalesforceError>;
    readonly mutate: (input: SalesforceMutation) => Effect.Effect<{}, SalesforceError>;
  }
>()("t3/salesforce/SalesforceService") {}

const make = Effect.gen(function* () {
  const sf = yield* makeSfCli;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const scope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const writeLock = yield* Semaphore.make(1);
  const listLock = yield* Semaphore.make(1);
  const entries = new Map<string, Entry>();
  let cli: SalesforceState["cli"] = null;
  let globalWatchStarted = false;

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const update = (cwd: string, patch: Partial<SalesforceState>) =>
    Effect.sync(() => {
      const entry = entries.get(cwd);
      if (entry !== undefined) entry.state = { ...entry.state, ...patch };
    });
  const stateOf = (cwd: string) => entries.get(cwd)?.state ?? emptyState(false);

  const readJsonFile = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(Effect.option);

  /** The workspace's `target-org`: local config, the legacy copy, then the global config. */
  const readTargetOrg = Effect.fn("SalesforceService.readTargetOrg")(function* (cwd: string) {
    const local = yield* readJsonFile(path.join(cwd, ".sf", "config.json"));
    const fromLocal = Option.flatMap(local, decodeTargetOrgConfig).pipe(
      Option.flatMap((config) => Option.fromNullishOr(config["target-org"])),
    );
    if (Option.isSome(fromLocal)) return fromLocal.value;
    const legacy = yield* readJsonFile(path.join(cwd, ".sfdx", "sfdx-config.json"));
    const fromLegacy = Option.flatMap(legacy, decodeLegacyTargetOrgConfig).pipe(
      Option.flatMap((config) => Option.fromNullishOr(config.defaultusername)),
    );
    if (Option.isSome(fromLegacy)) return fromLegacy.value;
    const global = yield* readJsonFile(path.join(home, ".sf", "config.json"));
    return Option.flatMap(global, decodeTargetOrgConfig).pipe(
      Option.flatMap((config) => Option.fromNullishOr(config["target-org"])),
      Option.getOrNull,
    );
  });

  /** Re-reads the default org from disk; instant, so external switches show quickly. */
  const refreshDefault = Effect.fn("SalesforceService.refreshDefault")(function* (cwd: string) {
    const target = yield* readTargetOrg(cwd);
    const state = stateOf(cwd);
    yield* update(cwd, { defaultOrg: target, orgs: markDefaultOrg(state.orgs, target) });
  });

  /** Lists orgs: quickly without network, or with each org's connection status. */
  const loadOrgs = (cwd: string, checkStatus: boolean) =>
    listLock.withPermits(1)(
      Effect.gen(function* () {
        yield* update(cwd, checkStatus ? { checkingStatus: true } : { loading: true });
        const json = yield* sf.run(
          cwd,
          checkStatus ? ["org", "list"] : ["org", "list", "--skip-connection-status"],
        );
        if (json === null || json.status !== 0) {
          return yield* update(cwd, {
            error: describeSfFailure(json, "sf org list returned no result."),
          });
        }
        const target = yield* readTargetOrg(cwd);
        const listed = parseOrgList(json.result);
        const orgs = checkStatus ? listed : keepKnownStatuses(listed, stateOf(cwd).orgs);
        yield* update(cwd, {
          orgs: markDefaultOrg(orgs, target),
          defaultOrg: target,
          error: null,
          updatedAt: yield* now,
        });
      }).pipe(
        Effect.catch((error) => update(cwd, { error: error.message })),
        Effect.ensuring(update(cwd, checkStatus ? { checkingStatus: false } : { loading: false })),
      ),
    );

  const forkBackground = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.ignore, Effect.forkIn(scope));

  /** Watches a directory and runs `onChange` after the burst of events settles. */
  const watchDirectory = (directory: string, onChange: Effect.Effect<void>) =>
    fileSystem.exists(directory).pipe(
      Effect.orElseSucceed(() => false),
      Effect.flatMap((exists) =>
        exists
          ? fileSystem.watch(directory).pipe(
              Stream.debounce(WATCH_DEBOUNCE),
              Stream.runForEach(() => onChange),
              forkBackground,
            )
          : Effect.void,
      ),
    );

  const dxEntries = () => [...entries].filter(([, entry]) => entry.state.isDxProject);

  const startGlobalWatch = Effect.gen(function* () {
    if (globalWatchStarted) return;
    globalWatchStarted = true;
    // Orgs and aliases: a login or logout from VS Code or the terminal changes the list.
    yield* watchDirectory(
      path.join(home, ".sfdx"),
      Effect.forEach(dxEntries(), ([cwd]) => loadOrgs(cwd, false), { discard: true }),
    );
    // A global `target-org` applies where the project sets none.
    yield* watchDirectory(
      path.join(home, ".sf"),
      Effect.forEach(dxEntries(), ([cwd]) => refreshDefault(cwd), { discard: true }),
    );
  });

  const initialize = Effect.fn("SalesforceService.initialize")(function* (cwd: string) {
    // Reading the config file is instant, so the default org shows before any sf command.
    yield* refreshDefault(cwd);
    if (cli === null) {
      const version = yield* sf.version(cwd);
      cli = { installed: version !== null, version };
    }
    yield* update(cwd, { cli });
    if (!cli.installed) return yield* update(cwd, { loading: false });
    yield* startGlobalWatch;
    yield* watchDirectory(path.join(cwd, ".sf"), refreshDefault(cwd));
    // Creating `.sf` for the first time shows up only in the project folder itself.
    yield* watchDirectory(cwd, refreshDefault(cwd));
    yield* loadOrgs(cwd, false);
    yield* loadOrgs(cwd, true);
  });

  const ensureEntry = Effect.fn("SalesforceService.ensureEntry")(function* (cwd: string) {
    const existing = entries.get(cwd);
    if (existing !== undefined) return existing;
    const isDxProject = yield* fileSystem
      .exists(path.join(cwd, "sfdx-project.json"))
      .pipe(Effect.orElseSucceed(() => false));
    const entry: Entry = { state: emptyState(isDxProject), loginFiber: null };
    entries.set(cwd, entry);
    if (isDxProject) yield* forkBackground(initialize(cwd));
    return entry;
  });

  const getState = Effect.fn("SalesforceService.getState")(function* (input: SalesforceStateInput) {
    return (yield* ensureEntry(input.cwd)).state;
  });

  /** Runs a write command; `sf` decides, and its JSON error becomes the message. */
  const runWrite = (cwd: string, args: ReadonlyArray<string>, fallback: string) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const json = yield* sf.run(cwd, args);
        if (json === null || json.status !== 0) {
          return yield* new SalesforceError({
            reason: "command",
            detail: describeSfFailure(json, fallback),
          });
        }
      }),
    );

  const requireDxProject = Effect.fn("SalesforceService.requireDxProject")(function* (cwd: string) {
    const entry = yield* ensureEntry(cwd);
    if (!entry.state.isDxProject) {
      return yield* new SalesforceError({
        reason: "invalidInput",
        detail: "This folder is not a Salesforce DX project.",
      });
    }
    return entry;
  });

  const mutate = Effect.fn("SalesforceService.mutate")(function* (input: SalesforceMutation) {
    const entry = yield* requireDxProject(input.cwd);
    const cwd = input.cwd;
    switch (input.type) {
      case "refresh":
        yield* forkBackground(input.checkStatus ? loadOrgs(cwd, true) : loadOrgs(cwd, false));
        return {};
      case "setDefault":
        yield* runWrite(
          cwd,
          ["config", "set", "target-org", input.target],
          "Could not set the org.",
        );
        yield* refreshDefault(cwd);
        return {};
      case "open":
        // Without --url-only the CLI opens the browser itself, so no session URL reaches us.
        yield* runWrite(
          cwd,
          ["org", "open", "--target-org", input.target],
          "Could not open the org.",
        );
        return {};
      case "logout":
        yield* runWrite(
          cwd,
          ["org", "logout", "--target-org", input.target, "--no-prompt"],
          "Could not log out of the org.",
        );
        yield* forkBackground(loadOrgs(cwd, false));
        return {};
      case "cancelLogin": {
        const fiber = entry.loginFiber;
        if (fiber !== null) yield* Fiber.interrupt(fiber);
        return {};
      }
      case "login": {
        if (entry.loginFiber !== null) {
          return yield* new SalesforceError({
            reason: "busy",
            detail: "A Salesforce login is already waiting in the browser.",
          });
        }
        const instanceUrl = normalizeSalesforceLoginUrl(input.instanceUrl);
        if (instanceUrl === null) {
          return yield* new SalesforceError({
            reason: "invalidInput",
            detail: "Enter an https login URL, such as https://test.salesforce.com.",
          });
        }
        const alias = input.alias;
        const args = [
          "org",
          "login",
          "web",
          "--alias",
          alias,
          "--instance-url",
          instanceUrl,
          ...(input.setDefault ? ["--set-default"] : []),
        ];
        const finish = Effect.fn("SalesforceService.finishLogin")(function* (
          ok: boolean,
          message: string,
        ) {
          entry.loginFiber = null;
          yield* update(cwd, {
            login: null,
            lastLogin: { alias, ok, message, finishedAt: yield* now },
          });
        });
        yield* update(cwd, { login: { alias, instanceUrl, startedAt: yield* now } });
        // The CLI waits for the browser callback, so this runs outside the write lock.
        const fiber = yield* sf.run(cwd, args, "10 minutes").pipe(
          Effect.flatMap((json) =>
            json !== null && json.status === 0
              ? finish(true, `Logged in to ${alias}.`).pipe(
                  Effect.andThen(refreshDefault(cwd)),
                  Effect.andThen(loadOrgs(cwd, true)),
                )
              : finish(false, describeSfFailure(json, "The login did not finish.")),
          ),
          Effect.catch((error) => finish(false, error.message)),
          Effect.onInterrupt(() => finish(false, "Login cancelled.")),
          Effect.forkIn(scope),
        );
        entry.loginFiber = fiber;
        return {};
      }
    }
  });

  return SalesforceService.of({ getState, mutate });
});

export const layer = Layer.effect(SalesforceService, make);
