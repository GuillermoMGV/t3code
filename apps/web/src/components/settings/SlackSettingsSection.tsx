import type { EnvironmentId, SlackMutation } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { slackEnvironment } from "../../state/slack";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

// Fork-only Slack reviewer reminders; see CUSTOM_DEVELOPMENT.md.

const SCOPES = "chat:write, im:write, users:read, users:read.email";

/** Connects a Slack user token and maps reviewers whose Slack account T3 Code cannot guess. */
export function SlackSettingsSection({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(slackEnvironment.state({ environmentId, input: {} }));
  const mutate = useAtomCommand(slackEnvironment.mutate, { reportFailure: false });
  const [token, setToken] = useState("");
  const [login, setLogin] = useState("");
  const [slackUser, setSlackUser] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = query.data;

  const run = async (input: SlackMutation) => {
    setPending(true);
    setError(null);
    const result = await mutate({ environmentId, input });
    setPending(false);
    if (result._tag === "Success") {
      query.refresh();
      return result.value;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Slack did not answer. Try again.");
    }
    return null;
  };

  const sectionProps = searchableSetting("issue-trackers-slack");

  if (state === null) {
    return (
      <SettingsSection {...sectionProps}>
        <SettingsRow
          title="Connection"
          description={query.error ?? "Checking the connection…"}
          control={query.error === null ? <Spinner size="xs" aria-label="Loading" /> : undefined}
        />
      </SettingsSection>
    );
  }

  if (!state.connected) {
    return (
      <SettingsSection {...sectionProps}>
        <SettingsRow
          title="Not connected"
          description={
            <>
              Sends reviewers Slack reminders from your account. Create an app at{" "}
              <a
                className="underline underline-offset-2"
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noreferrer"
              >
                api.slack.com/apps
              </a>
              , add the user token scopes {SCOPES}, install it to your workspace and paste its User
              OAuth Token.
            </>
          }
        />
        <form
          className="flex flex-col gap-2 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim().length === 0 || pending) return;
            void run({ type: "connect", token: token.trim() }).then((result) => {
              if (result === null) return;
              setToken("");
              toastManager.add({
                type: "success",
                title: result.account ? `Connected to Slack as ${result.account}` : "Connected",
              });
            });
          }}
        >
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            User OAuth Token
            <Input
              type="password"
              autoComplete="off"
              placeholder="xoxp-..."
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <div>
            <Button type="submit" size="sm" disabled={token.trim().length === 0 || pending}>
              {pending ? "Checking..." : "Connect Slack"}
            </Button>
          </div>
        </form>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection {...sectionProps}>
      <SettingsRow
        title={state.error ? "Connection problem" : "Connected"}
        description={
          <span className={state.error ? "text-destructive" : undefined}>
            {state.error ?? (state.account ? `Connected as ${state.account}` : "Connected")}
          </span>
        }
        control={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void run({ type: "disconnect" })}
          >
            Disconnect
          </Button>
        }
      />
      <SettingsRow
        title="Reviewers"
        description="Reviewers are found by Slack handle or name. Map the rest here; an email entered when sending a reminder is saved too."
      />
      <div className="flex flex-col gap-2 px-4 pb-4">
        {state.mappings.map((mapping) => (
          <div key={mapping.login} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">
              @{mapping.login} → {mapping.slackUser}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={pending}
              onClick={() =>
                void run({ type: "setMapping", login: mapping.login, slackUser: null })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (login.trim().length === 0 || slackUser.trim().length === 0 || pending) return;
            void run({
              type: "setMapping",
              login: login.trim().replace(/^@/, ""),
              slackUser: slackUser.trim(),
            }).then((result) => {
              if (result === null) return;
              setLogin("");
              setSlackUser("");
            });
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-muted-foreground text-xs">
            GitHub login
            <Input
              autoComplete="off"
              placeholder="octocat"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-muted-foreground text-xs">
            Slack email or member ID
            <Input
              autoComplete="off"
              placeholder="name@company.com"
              value={slackUser}
              onChange={(event) => setSlackUser(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={login.trim().length === 0 || slackUser.trim().length === 0 || pending}
          >
            Add
          </Button>
        </form>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>
    </SettingsSection>
  );
}
