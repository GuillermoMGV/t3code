import type { EnvironmentId, SalesforceOrg } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  ListIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuSearchInput, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SalesforceLoginDialog } from "./SalesforceLoginDialog";
import {
  SalesforceConfirmDialog,
  SalesforceStatusDot,
  SalesforceTypeBadge,
  useSalesforce,
} from "./SalesforceOrgParts";
import { SalesforceOrgsDialog } from "./SalesforceOrgsDialog";
import {
  currentSalesforceOrg,
  filterSalesforceOrgs,
  isProductionOrg,
  salesforceOrgName,
} from "./salesforceOrgs.logic";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md.

type Confirmation =
  | { readonly kind: "production"; readonly org: SalesforceOrg }
  | { readonly kind: "logout"; readonly org: SalesforceOrg };

/** The workspace's Salesforce default org, for Salesforce DX projects only. */
/** Renders its own section, so a folder that is not a DX project leaves no empty block. */
export function ThreadDetailsSalesforceRow({
  environmentId,
  cwd,
  separated,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  separated: boolean;
}) {
  const salesforce = useSalesforce(environmentId, cwd);
  const [query, setQuery] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [login, setLogin] = useState<{ reauth: SalesforceOrg | null } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const state = salesforce.state;
  if (state === null || !state.isDxProject) return null;

  const run = salesforce.run;
  const setDefault = (org: SalesforceOrg) =>
    void run(
      { type: "setDefault", cwd, target: org.alias ?? org.username },
      "Could not switch org",
    );
  const chooseDefault = (org: SalesforceOrg) => {
    if (org.isDefault) return;
    if (isProductionOrg(org)) setConfirmation({ kind: "production", org });
    else setDefault(org);
  };
  const openOrg = (org: SalesforceOrg) => {
    toastManager.add({ type: "info", title: `Opening ${salesforceOrgName(org)} in the browser…` });
    void run({ type: "open", cwd, target: org.alias ?? org.username }, "Could not open the org");
  };
  const refresh = () => void run({ type: "refresh", cwd, checkStatus: true }, "Could not refresh");

  const section = (children: ReactNode) => (
    <ThreadDetailsSection
      headingId="thread-details-salesforce-heading"
      title="Salesforce"
      showHeading={false}
      separated={separated}
    >
      <div className="flex flex-col">{children}</div>
    </ThreadDetailsSection>
  );

  if (state.cli !== null && !state.cli.installed) {
    return section(
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl type="button" variant="ghost" size="sm" part="row" tone="muted" />
          }
        >
          <TriangleAlertIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span
            className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
          >
            Salesforce CLI not found
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top" className="max-w-72">
          Install the Salesforce CLI to manage orgs here: npm install --global @salesforce/cli, or
          the installer from developer.salesforce.com/tools/salesforcecli. Then restart T3 Code.
        </TooltipPopup>
      </Tooltip>,
    );
  }

  const current = currentSalesforceOrg(state);
  const label =
    current !== null
      ? salesforceOrgName(current)
      : state.defaultOrg !== null
        ? state.defaultOrg
        : state.loading
          ? "Loading Salesforce orgs…"
          : "No default org";
  const orgs = filterSalesforceOrgs(state.orgs, query);

  return section(
    <>
      <Menu onOpenChange={(open) => !open && setQuery("")}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <ThreadDetailsControl
                    type="button"
                    variant="ghost"
                    size="sm"
                    part="row"
                    aria-label={`Salesforce default org: ${label}`}
                  />
                }
              />
            }
          >
            <CloudIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span
              className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
            >
              {label}
            </span>
            {current ? <SalesforceTypeBadge type={current.type} /> : null}
            {current ? <SalesforceStatusDot org={current} /> : null}
            <ChevronDownIcon aria-hidden className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
          </TooltipTrigger>
          <TooltipPopup side="top" className="max-w-72">
            {current
              ? `Agents in this thread run sf commands against ${salesforceOrgName(current)} (${current.username}).`
              : "Salesforce default org for this workspace."}
          </TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" className="w-80">
          <MenuSearchInput
            autoFocus
            busy={state.loading}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Switch org"
            aria-label="Search Salesforce orgs"
          />
          <div className="max-h-72 overflow-y-auto">
            {orgs.map((org) => (
              <MenuItem key={org.username} onClick={() => chooseDefault(org)}>
                <SalesforceStatusDot org={org} />
                <span className="min-w-0 flex-1 truncate">{salesforceOrgName(org)}</span>
                <SalesforceTypeBadge type={org.type} />
                {org.isDefault ? <CheckIcon aria-hidden /> : null}
              </MenuItem>
            ))}
          </div>
          <MenuSeparator />
          {state.login ? (
            <MenuItem onClick={() => void run({ type: "cancelLogin", cwd }, "Could not cancel")}>
              <XIcon aria-hidden />
              Cancel login to {state.login.alias}
            </MenuItem>
          ) : (
            <MenuItem onClick={() => setLogin({ reauth: null })}>
              <PlusIcon aria-hidden />
              Add org…
            </MenuItem>
          )}
          <MenuItem onClick={() => setManageOpen(true)}>
            <ListIcon aria-hidden />
            Manage orgs…
          </MenuItem>
          <MenuItem onClick={refresh}>
            <RefreshCwIcon aria-hidden />
            {state.checkingStatus ? "Checking statuses…" : "Check org statuses"}
          </MenuItem>
        </MenuPopup>
      </Menu>

      <SalesforceOrgsDialog
        open={manageOpen}
        state={state}
        onOpenChange={setManageOpen}
        onSetDefault={chooseDefault}
        onOpenOrg={openOrg}
        onReauth={(org) => setLogin({ reauth: org })}
        onLogout={(org) => setConfirmation({ kind: "logout", org })}
        onAddOrg={() => setLogin({ reauth: null })}
        onRefresh={refresh}
      />
      <SalesforceLoginDialog
        open={login !== null || state.login !== null}
        environmentId={environmentId}
        cwd={cwd}
        state={state}
        reauth={login?.reauth ?? null}
        run={run}
        onOpenChange={(open) => {
          if (!open) setLogin(null);
        }}
      />
      <SalesforceConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
        title={
          confirmation?.kind === "production"
            ? "You're about to target PRODUCTION"
            : `Log out of ${confirmation ? salesforceOrgName(confirmation.org) : "the org"}?`
        }
        description={
          confirmation?.kind === "production"
            ? `${salesforceOrgName(confirmation.org)} is a production org. Agents in this workspace will run sf commands against real data. Switch only if you mean to.`
            : "This removes the org's saved credentials from the Salesforce CLI on this machine, for T3 Code, VS Code and the terminal. You can log in again later."
        }
        confirmLabel={confirmation?.kind === "production" ? "Target production" : "Log out"}
        onConfirm={() => {
          if (confirmation === null) return;
          if (confirmation.kind === "production") setDefault(confirmation.org);
          else
            void run(
              { type: "logout", cwd, target: confirmation.org.alias ?? confirmation.org.username },
              "Could not log out",
            );
        }}
      />
    </>,
  );
}
