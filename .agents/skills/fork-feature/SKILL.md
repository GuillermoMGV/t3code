---
name: fork-feature
description: Implement a new feature or change in GuillermoMGV's personal T3 Code fork end to end - study the architecture, plan, build it fork-friendly, test, verify in the real app, document, run checks, commit to `custom`, push to the fork and install the Windows build. Use whenever the user asks to implement, add, change or improve something in this fork.
---

# Implement a feature in the personal fork

This fork tracks `pingdotgg/t3code` and keeps its own work on `custom`. Every feature must
survive future upstream merges, so the main rule is: **new code in new files, the fewest
possible lines in official files**. Read `CUSTOM_DEVELOPMENT.md` ("Para agentes de IA" and
"Personalizaciones del fork") before starting; it has the git rules, scripts and the list of
fork-owned files.

Work through the steps in order. Keep the user's task list updated, report progress in short
sentences, and never claim something works without having run it.

## 1. Start clean on `custom`

```powershell
git status --short          # must be clean; ask before touching uncommitted work
git switch custom
git switch -c feature/<short-name>   # optional for larger work; merge back with --no-ff
```

Every new PowerShell needs `. ./docs/personal/custom-env.ps1` before `vp`, `node` or `pnpm`.
Scripts in `docs/personal/` load it themselves.

## 2. Study the architecture before designing

Find the existing pattern for each part and reuse it; do not invent a parallel mechanism.
Where things already live:

| Need                 | Pattern to copy                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ↔ server call | Contract in `packages/contracts/src/<feature>.ts`, `Rpc.make` + `WS_METHODS` + `WsRpcGroup` in `rpc.ts`, handler in `apps/server/src/ws.ts`    |
| Server logic         | `Context.Service` + `Layer.effect(…, make)` in `apps/server/src/<feature>/`, registered in `server.ts`                                         |
| Client state         | `createEnvironmentRpcQueryAtomFamily` / `createEnvironmentRpcCommand` in `apps/web/src/state/<feature>.ts` (no need to touch `client-runtime`) |
| Thread side panel    | `ThreadDetailsPanel.tsx` + an item in `threadDetailsItems.ts`; rows use `ThreadDetailsControl`                                                 |
| Settings page        | Route file, `settingsSearch.ts` (path type, label, group, scope, search items), `SettingsSidebarNav.tsx` icon, `_chat.settings.tsx` scope      |
| Thread list row      | `components/sidebar/SidebarThreadRow.tsx` meta line                                                                                            |
| External HTTP        | `HttpClient` from `effect/http` (see `apps/server/src/issueTrackers/*Api.ts`)                                                                  |
| External processes   | `ProcessRunner` (resolves `.cmd` shims on Windows, logs only the command name)                                                                 |
| Secrets              | `ServerSecretStore` (`userdata/secrets/*.bin`)                                                                                                 |
| Fork-only data       | A JSON file in `ServerConfig.stateDir`, written atomically under a `Semaphore`                                                                 |
| File watching        | `FileSystem.watch` + `Stream.debounce`, forked into a scope (see `SalesforceService.ts`)                                                       |
| Background work      | `Scope.make` + `Effect.addFinalizer` + `Effect.forkIn(scope)`                                                                                  |

If the user asked for a plan, or the feature is large or ambiguous, write a short plan (new
files, touch points, UI) before coding. Verify external APIs against official docs or schemas
(a `web-fetch` agent works) instead of guessing.

## 3. Build it fork-friendly

- Put the feature in new files. In official files add only registration lines, and list each
  one later in the docs table.
- Do not extend the orchestration thread schema, event store or numbered migrations: upstream
  changes them constantly. Keep fork state in its own JSON file keyed by thread or folder.
- Group related RPCs (one query plus one `mutate` with a discriminated union) to keep the
  registration lines few. Every RPC needs entries in `rpc.ts`, `RpcAuthorization.ts`,
  `RpcInstrumentation.ts`, `ws.ts` and a `Layer.mock` in `ws.test.ts`.
- Mark fork files with a comment such as `// Fork-only ...; see CUSTOM_DEVELOPMENT.md.`

Rules the repo's lint and typecheck enforce, learned the hard way:

- Reusable Effects use `Effect.fn("Service.name")`; hoist `Schema.decode*/encode*` to module
  constants; no `JSON.parse`/`JSON.stringify` inside Effect code (use
  `Schema.fromJsonString`); prefer `Effect.asSome`, `Effect.catchIf`, `Effect.ignore`,
  `Effect.orElseSucceed` over hand-written equivalents.
- No `process.env`, `process.pid` or `Buffer` in server code; use `Config`, `HostProcess`,
  `effect/encoding/Base64`.
- Contracts are shared with React Native (Hermes): no `Array#toSorted`.
- React: no `useMemo`/`useCallback` (the React Compiler memoizes), no `useEffect` for derived
  state (use `useDebouncedValue` from `state/queries` for debouncing), no native `title`
  tooltips (use `Tooltip`), no `className` restyling of `components/ui` (pick a variant), no
  arbitrary values such as `text-[8px]` (use the token scale).
- Node built-ins are imported as namespaces: `import * as NodeHttp from "node:http"`.
- Never return, log or display secrets. When a CLI or API answers with tokens, decode through a
  field allowlist and add a test that the token does not survive.

## 4. Test at the lowest layer

- Put pure logic in `*.logic.ts` next to the component, with a `*.logic.test.ts`
  (`vite-plus/test`). Server tests use `@effect/vitest`; mock HTTP with
  `HttpClient.make(...)` + `HttpClientResponse.fromWeb`.
- Run them: `vp test run <files>`.
- Per package while iterating: `vp lint <files>`, then `vp run typecheck` inside
  `packages/contracts`, `apps/server` and `apps/web` (exit code 0 = clean).

## 5. Verify in the real app

Run long-lived things as background tasks (never with a trailing `&`) and stop them by task
when done.

```powershell
. ./docs/personal/custom-env.ps1
vp run dev --home-dir .t3 --no-seed      # background task; dev data stays in .t3
# when ports 13773/5733 answer, mint a pairing URL from apps/server:
node src/bin.ts pair --base-dir ../../.t3 --ttl 1h
```

- Open `http://localhost:5733/pair#token=…` in the built-in browser, resize to 1440×900, and
  exercise every state: empty, loading, error, success, and each action. The `Replay (dev)`
  provider runs free agent turns. Screenshots can lag behind a dialog's animation; confirm
  with `read_page`/JavaScript.
- External services: add or extend a mock in `docs/personal/` (see
  `mock-issue-trackers.mjs`) and point the server at it with an env override or a local URL.
  Use test values only. Never type real credentials.
- Real user data (for example the Salesforce project) only within what the user allowed;
  restore anything you change, never target production, never log out of real accounts.
- Never start a server against `~/.t3/userdata` (the installed app's real data).
- Dev on this machine sometimes restarts or drops the server (502); the installed app does
  not. Wait, or restart `vp run dev`, and re-check rather than assuming a code bug, but do
  confirm with the trace in `.t3/userdata/logs/server.trace.ndjson`.
- Finish by stopping dev and mocks, checking no process for the checkout is left, and resetting
  the browser viewport.

## 6. Document

In `CUSTOM_DEVELOPMENT.md` → "Personalizaciones del fork", add a subsection with: what it
does and how to use it, a table of new files, a table of every official file touched and what
was added, how to test it (mocks, commands) and its limitations. Update the scripts table or
"Problemas conocidos" when relevant. Keep it in Spanish, like the rest of the guide.

## 7. Full check, commit, push

```powershell
vp run check:changed --concurrency 2    # ~6 min, background; everything must pass
git add -A
git commit -m "feat(web): <what users get>" -m "Co-Authored-By: ..."
git push origin custom                  # only origin; upstream push is disabled
```

The pre-commit hook runs format, lint and knip. Browser tests need Playwright's Chromium
(`pnpm exec playwright install chromium-headless-shell` from `apps/web` if missing). Never use
`--force`, `reset --hard` or PRs against `pingdotgg/t3code`.

## 8. Install the new build

```powershell
./docs/personal/build-and-install.ps1   # ~8 min; closes T3 Code, backs up userdata, installs
```

Then confirm the installed app is running (`%LOCALAPPDATA%\Programs\t3code`).

## 9. Report

Tell the user what changed, how to use it, what was verified (and how) and what was not, plus
anything they must do (connect an account, try with real credentials). Keep it short.
