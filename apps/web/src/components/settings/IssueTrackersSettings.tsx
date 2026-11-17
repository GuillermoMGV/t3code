import {
  ISSUE_TRACKER_LABELS,
  type EnvironmentId,
  type IssueTrackerConnection,
  type IssueTrackerKind,
  type IssueTrackerMutation,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState, type ReactNode } from "react";

import { issueTrackerEnvironment } from "../../state/issueTrackers";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

// Fork-only Linear and Jira integration; see CUSTOM_DEVELOPMENT.md.
export function IssueTrackersSettingsPanel() {
  const { environment } = useSettingsScope();
  if (environment?.connection.phase !== "connected") {
    return (
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("issue-trackers-linear")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect an environment to link its threads to Linear and Jira issues.
          </p>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  return (
    <IssueTrackerConnections
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}

function IssueTrackerConnections({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(
    issueTrackerEnvironment.connections({ environmentId, input: {} }),
  );
  const connectionOf = (tracker: IssueTrackerKind) =>
    query.data?.trackers.find((connection) => connection.tracker === tracker) ?? null;
  const sectionProps = {
    environmentId,
    loading: query.data === null && query.isPending,
    loadError: query.error,
    onChanged: () => query.refresh(),
  };
  return (
    <SettingsPageContainer>
      <TrackerSection
        {...sectionProps}
        tracker="linear"
        connection={connectionOf("linear")}
        help={
          <>
            In Linear, open Settings → Security &amp; access → Personal API keys and create a key.
          </>
        }
        fields={[{ name: "apiKey", label: "API key", placeholder: "lin_api_...", secret: true }]}
        toMutation={(values) => ({ type: "connectLinear", apiKey: values.apiKey ?? "" })}
      />
      <TrackerSection
        {...sectionProps}
        tracker="jira"
        connection={connectionOf("jira")}
        help={
          <>
            Jira Cloud only. Create an API token without scopes at{" "}
            <a
              className="underline underline-offset-2"
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              id.atlassian.com
            </a>{" "}
            and use the email of that Atlassian account.
          </>
        }
        fields={[
          { name: "siteUrl", label: "Site", placeholder: "your-team.atlassian.net" },
          { name: "email", label: "Email", placeholder: "you@example.com" },
          { name: "apiToken", label: "API token", placeholder: "ATATT...", secret: true },
        ]}
        toMutation={(values) => ({
          type: "connectJira",
          siteUrl: values.siteUrl ?? "",
          email: values.email ?? "",
          apiToken: values.apiToken ?? "",
        })}
      />
    </SettingsPageContainer>
  );
}

interface TrackerField {
  readonly name: string;
  readonly label: string;
  readonly placeholder: string;
  readonly secret?: boolean;
}

function TrackerSection({
  tracker,
  environmentId,
  connection,
  loading,
  loadError,
  help,
  fields,
  toMutation,
  onChanged,
}: {
  tracker: IssueTrackerKind;
  environmentId: EnvironmentId;
  connection: IssueTrackerConnection | null;
  loading: boolean;
  loadError: string | null;
  help: ReactNode;
  fields: ReadonlyArray<TrackerField>;
  toMutation: (values: Readonly<Record<string, string>>) => IssueTrackerMutation;
  onChanged: () => void;
}) {
  const label = ISSUE_TRACKER_LABELS[tracker];
  const mutate = useAtomCommand(issueTrackerEnvironment.mutate, { reportFailure: false });
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = fields.every((field) => (values[field.name] ?? "").trim().length > 0);

  const run = async (input: IssueTrackerMutation) => {
    setPending(true);
    setError(null);
    const result = await mutate({ environmentId, input });
    setPending(false);
    if (result._tag === "Success") {
      setValues({});
      onChanged();
      return result.value;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : `${label} did not answer. Try again.`);
    }
    return null;
  };

  const connect = async () => {
    if (!complete || pending) return;
    const result = await run(toMutation(values));
    if (result === null) return;
    toastManager.add({
      type: "success",
      title: result.account
        ? `Connected to ${label} as ${result.account}`
        : `Connected to ${label}`,
    });
  };

  const sectionProps = searchableSetting(
    tracker === "linear" ? "issue-trackers-linear" : "issue-trackers-jira",
  );

  if (loading || connection === null) {
    return (
      <SettingsSection {...sectionProps}>
        <SettingsRow
          title="Connection"
          description={loadError ?? "Checking the connection…"}
          control={loadError === null ? <Spinner size="xs" aria-label="Loading" /> : undefined}
        />
      </SettingsSection>
    );
  }

  if (connection.connected) {
    const description = connection.error
      ? connection.error
      : [connection.account ? `Connected as ${connection.account}` : "Connected", connection.site]
          .filter(Boolean)
          .join(" · ");
    return (
      <SettingsSection {...sectionProps}>
        <SettingsRow
          title={connection.error ? "Connection problem" : "Connected"}
          description={
            <span className={connection.error ? "text-destructive" : undefined}>{description}</span>
          }
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void run({ type: "disconnect", tracker })}
            >
              Disconnect
            </Button>
          }
        />
        {error ? <p className="px-4 pb-3 text-destructive text-xs">{error}</p> : null}
      </SettingsSection>
    );
  }

  return (
    <SettingsSection {...sectionProps}>
      <SettingsRow
        title="Not connected"
        description={
          <>
            Shows the {label} issue linked to each thread in its details panel. {help}
          </>
        }
      />
      <form
        className="flex flex-col gap-2 px-4 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        {fields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {field.label}
            <Input
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
              }
            />
          </label>
        ))}
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        <div>
          <Button type="submit" size="sm" disabled={!complete || pending}>
            {pending ? "Checking..." : `Connect ${label}`}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
