// Fork-only: picks the gh account per repository when one host has several; see CUSTOM_DEVELOPMENT.md.
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `owner/name` of the repository the current GitHub request is for, when the caller knows it. */
export const GitHubRequestRepository = Context.Reference<string | null>(
  "@t3tools/source-control-github/server/GitHubAccountRouting/GitHubRequestRepository",
  { defaultValue: () => null },
);

export interface GhAccount {
  readonly login: string;
  readonly active: boolean;
}

export type RepositoryAccess = "push" | "read" | "none";

const GhAuthStatus = Schema.Struct({
  hosts: Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        login: Schema.optional(Schema.String),
        active: Schema.optional(Schema.Boolean),
        state: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const decodeGhAuthStatus = Schema.decodeUnknownOption(Schema.fromJsonString(GhAuthStatus));

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/u;

/** `owner/name`, or null for anything that could not be a GitHub repository path. */
export function repositoryPath(value: unknown): string | null {
  if (typeof value !== "string" || !REPOSITORY.test(value)) return null;
  return value.split("/").some((segment) => segment === "." || segment === "..") ? null : value;
}

/** Signed-in accounts per host from `gh auth status --json hosts`, the active one first. */
export function parseGhAccounts(
  stdout: string,
): Readonly<Record<string, ReadonlyArray<GhAccount>>> {
  return Option.match(decodeGhAuthStatus(stdout), {
    onNone: () => ({}),
    onSome: ({ hosts }) =>
      Object.fromEntries(
        Object.entries(hosts).map(([host, entries]) => {
          const accounts = entries.flatMap((entry) =>
            entry.login !== undefined && entry.login !== "" && entry.state === "success"
              ? [{ login: entry.login, active: entry.active === true }]
              : [],
          );
          return [
            host.toLowerCase(),
            [...accounts.filter((a) => a.active), ...accounts.filter((a) => !a.active)],
          ] as const;
        }),
      ),
  });
}

/** The account named like the repository's owner, as for a personal repository. */
function accountNamedLikeOwner(
  accounts: ReadonlyArray<GhAccount>,
  repository: string,
): string | undefined {
  const owner = repository.split("/")[0]!.toLowerCase();
  return accounts.find((account) => account.login.toLowerCase() === owner)?.login;
}

/** The first account that can push, else the first that can read; probes run in account order. */
function pickAccount(
  probes: ReadonlyArray<{ readonly login: string; readonly access: RepositoryAccess }>,
): string | undefined {
  return (
    probes.find((probe) => probe.access === "push")?.login ??
    probes.find((probe) => probe.access === "read")?.login
  );
}

export interface AccountRouterInput<E> {
  /** Accounts `gh` holds for `host`, active first. */
  readonly accounts: (host: string) => Effect.Effect<ReadonlyArray<GhAccount>, E>;
  /** What `login` may do in `repository`, read with that account's own token. */
  readonly access: (
    host: string,
    login: string,
    repository: string,
  ) => Effect.Effect<RepositoryAccess, E>;
}

/**
 * The gh account to use for `repository` on `host`, or undefined to keep the host's default. Only
 * hosts with more than one account are routed, so a single-account setup never probes.
 */
export const makeAccountRouter = Effect.fn("GitHubAccountRouting.makeAccountRouter")(function* <E>(
  input: AccountRouterInput<E>,
) {
  const accounts = yield* Cache.makeWith(
    (host: string) => input.accounts(host).pipe(Effect.orElseSucceed(() => [])),
    { capacity: 16, timeToLive: () => Duration.minutes(5) },
  );
  const routes = yield* Cache.makeWith(
    Effect.fn("GitHubAccountRouting.route")(function* (key: string) {
      const [host = "", repository = ""] = key.split("\u0000");
      const held = yield* Cache.get(accounts, host);
      if (held.length < 2) return undefined;
      const named = accountNamedLikeOwner(held, repository);
      if (named !== undefined) return named;
      const probes = [];
      for (const account of held) {
        const access = yield* input
          .access(host, account.login, repository)
          .pipe(Effect.orElseSucceed((): RepositoryAccess => "none"));
        if (access === "push") return account.login;
        probes.push({ login: account.login, access });
      }
      return pickAccount(probes);
    }),
    {
      capacity: 256,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value !== undefined ? Duration.hours(1) : Duration.minutes(1),
    },
  );
  return (host: string, repository: string): Effect.Effect<string | undefined> => {
    const path = repositoryPath(repository);
    return path === null
      ? Effect.undefined
      : Cache.get(routes, `${host}\u0000${path.toLowerCase()}`);
  };
});
