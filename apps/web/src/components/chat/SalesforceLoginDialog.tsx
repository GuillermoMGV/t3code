import {
  normalizeSalesforceLoginUrl,
  SALESFORCE_LOGIN_URLS,
  type EnvironmentId,
  type SalesforceOrg,
  type SalesforceState,
} from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import type { SalesforceRun } from "./SalesforceOrgParts";
import { salesforceAliasProblem, salesforceOrgName } from "./salesforceOrgs.logic";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md.

type LoginKind = "production" | "sandbox" | "custom";

const KIND_LABELS: Readonly<Record<LoginKind, string>> = {
  production: "Production / Developer",
  sandbox: "Sandbox",
  custom: "Custom URL",
};

interface SalesforceLoginDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  cwd: string;
  state: SalesforceState;
  /** Re-authenticates this org instead of adding a new one. */
  reauth: SalesforceOrg | null;
  run: SalesforceRun;
  onOpenChange: (open: boolean) => void;
}

export function SalesforceLoginDialog(props: SalesforceLoginDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-lg">
        {props.open ? <SalesforceLoginForm {...props} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function SalesforceLoginForm({
  cwd,
  state,
  reauth,
  run,
  onOpenChange,
}: SalesforceLoginDialogProps) {
  const [alias, setAlias] = useState(reauth?.alias ?? "");
  const [kind, setKind] = useState<LoginKind>(reauth ? "custom" : "sandbox");
  const [customUrl, setCustomUrl] = useState(reauth?.instanceUrl ?? "");
  const [setDefault, setSetDefault] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loginUrl =
    kind === "custom" ? normalizeSalesforceLoginUrl(customUrl) : SALESFORCE_LOGIN_URLS[kind];
  const aliasProblem = reauth ? null : salesforceAliasProblem(alias, state.orgs);
  const waiting = state.login !== null;
  // The result of the login this dialog started, once the server reports it.
  const result =
    startedAt !== null && state.lastLogin !== null && state.lastLogin.finishedAt >= startedAt
      ? state.lastLogin
      : null;

  const start = async () => {
    if (aliasProblem !== null || loginUrl === null) return;
    setSubmitError(null);
    const at = new Date(Date.now() - 1_000).toISOString();
    const ok = await run(
      {
        type: "login",
        cwd,
        alias: (reauth?.alias ?? alias).trim(),
        instanceUrl: loginUrl,
        setDefault,
      },
      "Could not start the Salesforce login",
    );
    if (ok) setStartedAt(at);
    else setSubmitError("The login did not start. Check the alias and URL.");
  };

  const cancel = () => void run({ type: "cancelLogin", cwd }, "Could not cancel the login");

  if (result?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{result.message}</DialogTitle>
          <DialogDescription>
            The org is ready in T3 Code, VS Code and the terminal.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (waiting) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Waiting for login in the browser…</DialogTitle>
          <DialogDescription>
            Log in to {state.login?.alias} in the browser window the Salesforce CLI opened (
            {state.login?.instanceUrl}). This dialog updates when the login finishes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner size="sm" aria-label="Waiting for login" />
            Waiting for Salesforce…
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={cancel}>
            Cancel login
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {reauth ? `Re-authenticate ${salesforceOrgName(reauth)}` : "Add Salesforce org"}
        </DialogTitle>
        <DialogDescription>
          The Salesforce CLI opens your browser to log in. The org is then available here, in VS
          Code and in the terminal.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            Alias
            <Input
              autoFocus={!reauth}
              disabled={reauth !== null}
              placeholder="Properti DEV"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
            />
          </label>
          {alias.length > 0 && aliasProblem ? (
            <p className="text-destructive text-xs">{aliasProblem}</p>
          ) : null}
          <div className="flex flex-col gap-1 text-muted-foreground text-xs">
            Login URL
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(KIND_LABELS) as LoginKind[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={kind === option ? "default" : "outline"}
                  onClick={() => setKind(option)}
                >
                  {KIND_LABELS[option]}
                </Button>
              ))}
            </div>
          </div>
          {kind === "custom" ? (
            <Input
              placeholder="https://your-domain--sandbox.sandbox.my.salesforce.com"
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
            />
          ) : (
            <p className="text-muted-foreground text-xs">{loginUrl}</p>
          )}
          {kind === "custom" && customUrl.length > 0 && loginUrl === null ? (
            <p className="text-destructive text-xs">Enter an https URL.</p>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={setDefault}
              onCheckedChange={(checked) => setSetDefault(checked === true)}
            />
            Set as default org for this workspace
          </label>
          {(submitError ?? (result && !result.ok ? result.message : null)) ? (
            <p className="text-destructive text-xs">
              {submitError ?? (result && !result.ok ? result.message : null)}
            </p>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={aliasProblem !== null || loginUrl === null}
          onClick={() => void start()}
        >
          Log in with browser
        </Button>
      </DialogFooter>
    </>
  );
}
