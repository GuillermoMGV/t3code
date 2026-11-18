// Fork-only: tags every GitHub call with its repository so GitHubCredentials can route it to the
// gh account that reaches it; see CUSTOM_DEVELOPMENT.md.
import type {
  ProviderChangeRequestStat,
  PullRequestProviderApi,
} from "@t3tools/source-control-core/server/PullRequestProvider";
import type { SourceControlDriverInstance } from "@t3tools/source-control-core/server/driver";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as GitHubAccountRouting from "./GitHubAccountRouting.ts";
import { GH_PROCESS_CONCURRENCY } from "./GitHubCredentials.ts";
import { resolveGitHubRepository } from "./gitHubRepositoryResolution.ts";

type RepositoryOf = (input: unknown) => Effect.Effect<string | null>;

const field = (input: unknown, name: string): unknown =>
  typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)[name]
    : undefined;

// The proxy only adds a service with a default, so each method keeps its own error and context.
type AnyEffect = Effect.Effect<unknown>;
type AnyStream = Stream.Stream<unknown>;
const isAnyEffect = (value: unknown): value is AnyEffect => Effect.isEffect(value);
const isAnyStream = (value: unknown): value is AnyStream => Stream.isStream(value);

/** Wraps each method so the Effect or Stream it returns runs tagged with its input's repository. */
export function routeMethods<T extends object>(target: T, repositoryOf: RepositoryOf): T {
  const tag = <A>(
    repository: string | null,
    value: A,
    provide: (value: A, repository: string) => A,
  ) => (repository === null ? value : provide(value, repository));
  return Object.fromEntries(
    Object.entries(target).map(([name, value]) => {
      if (typeof value !== "function") return [name, value];
      const method = value as (...args: ReadonlyArray<unknown>) => unknown;
      return [
        name,
        (...args: ReadonlyArray<unknown>) => {
          const result = method(...args);
          if (isAnyEffect(result)) {
            return repositoryOf(args[0]).pipe(
              Effect.flatMap((repository) =>
                tag(repository, result, (effect, value) =>
                  Effect.provideService(
                    effect,
                    GitHubAccountRouting.GitHubRequestRepository,
                    value,
                  ),
                ),
              ),
            );
          }
          if (isAnyStream(result)) {
            return Stream.unwrap(
              repositoryOf(args[0]).pipe(
                Effect.map((repository) =>
                  tag(repository, result, (stream, value) =>
                    Stream.provideService(
                      stream,
                      GitHubAccountRouting.GitHubRequestRepository,
                      value,
                    ),
                  ),
                ),
              ),
            );
          }
          return result;
        },
      ];
    }),
  ) as T;
}

function routePullRequests(
  api: PullRequestProviderApi,
  repositoryOf: RepositoryOf,
): PullRequestProviderApi {
  // One cross-repository search runs under one token, which cannot see every account's repositories.
  const { listChangeRequestsAcross: _across, ...rest } = api;
  const routed = routeMethods(rest, repositoryOf);
  const listChangeRequestStats = api.listChangeRequestStats;
  return {
    ...routed,
    // The account behind each repository decides who "me" is in its searches.
    listChangeRequests: (input) =>
      rest.getViewer({ cwd: input.cwd, host: input.host }).pipe(
        Effect.provideService(GitHubAccountRouting.GitHubRequestRepository, input.repository),
        Effect.orElseSucceed(() => input.viewer),
        Effect.flatMap((viewer) => routed.listChangeRequests({ ...input, viewer })),
      ),
    ...(listChangeRequestStats === undefined
      ? {}
      : {
          listChangeRequestStats: (input) => {
            const byOwner = new Map<string, Array<(typeof input.changeRequests)[number]>>();
            for (const changeRequest of input.changeRequests) {
              const owner = changeRequest.repository.split("/")[0]!.toLowerCase();
              byOwner.set(owner, [...(byOwner.get(owner) ?? []), changeRequest]);
            }
            return Effect.forEach(
              [...byOwner.values()],
              (changeRequests) =>
                listChangeRequestStats({ ...input, changeRequests }).pipe(
                  Effect.provideService(
                    GitHubAccountRouting.GitHubRequestRepository,
                    GitHubAccountRouting.repositoryPath(changeRequests[0]!.repository),
                  ),
                ),
              { concurrency: "unbounded" },
            ).pipe(Effect.map((pages): ReadonlyArray<ProviderChangeRequestStat> => pages.flat()));
          },
        }),
  };
}

/**
 * Routes the instance's GitHub calls per repository when `gh` holds several accounts for a host.
 * With one account per host the instance is returned untouched, so upstream behaviour is kept.
 */
export const withAccountRouting = Effect.fn("GitHubAccountRouting.withAccountRouting")(function* (
  instance: SourceControlDriverInstance,
) {
  const host = yield* SourceControlHost.SourceControlHost;
  const workingDirectory = yield* HostProcess.WorkingDirectory;
  const run = (operation: string, command: string, args: ReadonlyArray<string>, cwd: string) =>
    host.process.run({
      operation,
      command,
      args,
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 10_000,
      ...(command === "gh"
        ? {
            env: { GH_DEBUG: "", GH_PROMPT_DISABLED: "1" },
            concurrency: GH_PROCESS_CONCURRENCY,
          }
        : {}),
    });

  const accounts = yield* run(
    "GitHubAccountRouting.accounts",
    "gh",
    ["auth", "status", "--json", "hosts"],
    workingDirectory,
  ).pipe(
    Effect.map((output) => GitHubAccountRouting.parseGhAccounts(output.stdout)),
    Effect.orElseSucceed(() => ({})),
  );
  if (!Object.values(accounts).some((held) => held.length > 1)) return instance;

  const checkouts = yield* Cache.makeWith(
    (cwd: string) =>
      Effect.all([
        run("GitHubAccountRouting.remotes", "git", ["remote", "-v"], cwd),
        run(
          "GitHubAccountRouting.remotes",
          "git",
          ["config", "--get-regexp", "^remote\\..*\\.gh-resolved$"],
          cwd,
        ),
      ]).pipe(
        Effect.map(([remotes, resolved]) => {
          const { locator } = resolveGitHubRepository({
            remotes: remotes.exitCode === 0 ? remotes.stdout : "",
            resolved: resolved.exitCode === 0 ? resolved.stdout : "",
            hostHint: undefined,
            defaultHost: "github.com",
          });
          return locator === null ? null : `${locator.owner}/${locator.name}`;
        }),
        Effect.orElseSucceed(() => null),
      ),
    { capacity: 256, timeToLive: () => Duration.minutes(5) },
  );

  const repositoryOf: RepositoryOf = (input) => {
    const named = GitHubAccountRouting.repositoryPath(field(input, "repository"));
    if (named !== null) return Effect.succeed(named);
    const cwd = field(input, "cwd");
    return typeof cwd === "string" && cwd !== "" ? Cache.get(checkouts, cwd) : Effect.succeed(null);
  };

  return {
    ...instance,
    sourceControl: routeMethods(instance.sourceControl, repositoryOf),
    pullRequests:
      instance.pullRequests === null
        ? null
        : routePullRequests(instance.pullRequests, repositoryOf),
    ...(instance.fetchMedia === undefined
      ? {}
      : { fetchMedia: routeMethods({ fetchMedia: instance.fetchMedia }, repositoryOf).fetchMedia }),
  } satisfies SourceControlDriverInstance;
});
