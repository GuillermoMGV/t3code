import type { SalesforceOrg, SalesforceState } from "@t3tools/contracts";
import {
  CopyIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LogOutIcon,
  PlusIcon,
  RefreshCwIcon,
  StarIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SalesforceStatusDot, SalesforceTypeBadge } from "./SalesforceOrgParts";
import {
  favoritesFirst,
  filterSalesforceOrgs,
  salesforceOrgHealth,
  salesforceOrgName,
  salesforceStatusLabel,
} from "./salesforceOrgs.logic";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md.

interface SalesforceOrgsDialogProps {
  open: boolean;
  state: SalesforceState;
  /** Username of the org being set as default, while the CLI switches. */
  switchingTo: string | null;
  onOpenChange: (open: boolean) => void;
  onSetDefault: (org: SalesforceOrg) => void;
  onSetFavorite: (org: SalesforceOrg, favorite: boolean) => void;
  onOpenOrg: (org: SalesforceOrg) => void;
  onReauth: (org: SalesforceOrg) => void;
  onLogout: (org: SalesforceOrg) => void;
  onAddOrg: () => void;
  onRefresh: () => void;
}

export function SalesforceOrgsDialog(props: SalesforceOrgsDialogProps) {
  const [query, setQuery] = useState("");
  const { state } = props;
  const orgs = favoritesFirst(filterSalesforceOrgs(state.orgs, query), state.favorites);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Salesforce orgs</DialogTitle>
          <DialogDescription>
            Orgs authenticated in the Salesforce CLI on this machine. The default org is the one
            agents in this workspace run sf commands against.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                placeholder="Search by alias, username or URL"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button type="button" size="sm" variant="outline" onClick={props.onRefresh}>
                {state.checkingStatus ? (
                  <Spinner size="xs" aria-label="Checking statuses" />
                ) : (
                  <RefreshCwIcon aria-hidden />
                )}
                Check statuses
              </Button>
              <Button type="button" size="sm" onClick={props.onAddOrg}>
                <PlusIcon aria-hidden />
                Add org
              </Button>
            </div>
            {state.error ? <p className="text-destructive text-xs">{state.error}</p> : null}
            <div className="-mx-1 flex max-h-[28rem] flex-col overflow-y-auto">
              {state.loading && state.orgs.length === 0 ? (
                <p className="flex items-center gap-2 px-2 py-3 text-muted-foreground text-sm">
                  <Spinner size="xs" aria-label="Loading orgs" /> Loading orgs from the Salesforce
                  CLI…
                </p>
              ) : null}
              {orgs.map((org) => (
                <OrgRow
                  key={org.username}
                  org={org}
                  favorite={state.favorites.includes(org.username)}
                  {...props}
                />
              ))}
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function OrgRow({
  org,
  favorite,
  switchingTo,
  onSetDefault,
  onSetFavorite,
  onOpenOrg,
  onReauth,
  onLogout,
}: { org: SalesforceOrg; favorite: boolean } & Pick<
  SalesforceOrgsDialogProps,
  "switchingTo" | "onSetDefault" | "onSetFavorite" | "onOpenOrg" | "onReauth" | "onLogout"
>) {
  const health = salesforceOrgHealth(org);
  const connecting = org.username === switchingTo;
  const action = (label: string, icon: ReactNode, onClick: () => void) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-md pr-2",
        org.isDefault ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-md py-1.5 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          org.isDefault || switchingTo !== null ? "cursor-default" : "cursor-pointer",
        )}
        aria-label={
          org.isDefault
            ? `${salesforceOrgName(org)} is the default org`
            : `Set ${salesforceOrgName(org)} as the default org`
        }
        aria-pressed={org.isDefault}
        aria-busy={connecting}
        disabled={switchingTo !== null}
        onClick={() => onSetDefault(org)}
      >
        {connecting ? (
          <Spinner size="xs" tone="muted" aria-label="Connecting" />
        ) : (
          <SalesforceStatusDot org={org} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-medium">{salesforceOrgName(org)}</span>
            <SalesforceTypeBadge type={org.type} />
            {connecting ? (
              <span className="text-muted-foreground text-xs">Connecting…</span>
            ) : org.isDefault ? (
              <span className="text-muted-foreground text-xs">Default</span>
            ) : null}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {org.username}
            {org.instanceUrl ? ` · ${org.instanceUrl.replace(/^https:\/\//, "")}` : ""}
          </span>
          <span
            className={cn(
              "truncate text-xs",
              health === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {salesforceStatusLabel(org)}
            {org.lastUsed ? ` · last used ${new Date(org.lastUsed).toLocaleDateString()}` : ""}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {action(
          favorite ? "Remove from favorites" : "Add to favorites",
          <StarIcon aria-hidden className={cn(favorite && "fill-current text-warning")} />,
          () => onSetFavorite(org, !favorite),
        )}
        {action("Open in browser", <ExternalLinkIcon aria-hidden />, () => onOpenOrg(org))}
        {health !== "connected"
          ? action("Re-authenticate", <KeyRoundIcon aria-hidden />, () => onReauth(org))
          : null}
        {action(
          "Copy username",
          <CopyIcon aria-hidden />,
          () =>
            void writeTextToClipboard(org.username).then(() =>
              toastManager.add({ type: "success", title: "Username copied" }),
            ),
        )}
        {action("Log out", <LogOutIcon aria-hidden />, () => onLogout(org))}
      </div>
    </div>
  );
}
