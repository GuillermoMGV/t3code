import type { EnvironmentId, SalesforceOrg, SalesforceState } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, StarIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentQuerySelector } from "~/state/query";
import { salesforceEnvironment } from "~/state/salesforce";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { SalesforceStatusDot, SalesforceTypeBadge, useSalesforce } from "./SalesforceOrgParts";
import { favoritesFirst, filterSalesforceOrgs, salesforceOrgName } from "./salesforceOrgs.logic";
import { SALESFORCE_RECORD_ID_TAG } from "./salesforceRecordIds.logic";

// Fork-only clickable Salesforce record IDs in chat messages; see CUSTOM_DEVELOPMENT.md.

export interface SalesforceRecordTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

/** The workspace's default org first, then favorites, then the rest. */
function recordOrgOrder(state: SalesforceState, query: string): SalesforceOrg[] {
  const orgs = favoritesFirst(filterSalesforceOrgs(state.orgs, query), state.favorites);
  return [...orgs.filter((org) => org.isDefault), ...orgs.filter((org) => !org.isDefault)];
}

function RecordOrgMenu({ recordId, target }: { recordId: string; target: SalesforceRecordTarget }) {
  // The popup unmounts when closed, so the org list polls only while the menu is open.
  const salesforce = useSalesforce(target.environmentId, target.cwd);
  const [query, setQuery] = useState("");
  const state = salesforce.state;
  const orgs = state === null ? [] : recordOrgOrder(state, query);

  const openIn = (org: SalesforceOrg) => {
    toastManager.add({
      type: "info",
      title: `Opening ${recordId} in ${salesforceOrgName(org)}…`,
    });
    void salesforce.run(
      { type: "open", cwd: target.cwd, target: org.alias ?? org.username, recordId },
      "Could not open the record",
    );
  };
  const copyId = () => {
    void writeTextToClipboard(recordId).then(
      () => toastManager.add({ type: "success", title: "Record ID copied" }),
      () => toastManager.add({ type: "error", title: "Could not copy the record ID" }),
    );
  };

  return (
    <>
      <MenuSearchInput
        autoFocus
        busy={state === null || state.loading}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder="Open in org"
        aria-label="Search Salesforce orgs"
      />
      <MenuGroup>
        <MenuGroupLabel>Open {recordId} in</MenuGroupLabel>
        <div className="max-h-72 overflow-y-auto">
          {orgs.map((org) => (
            <MenuItem key={org.username} onClick={() => openIn(org)}>
              <SalesforceStatusDot org={org} />
              <span className="min-w-0 flex-1 truncate">{salesforceOrgName(org)}</span>
              {state?.favorites.includes(org.username) ? (
                <StarIcon aria-label="Favorite" className="fill-current text-warning" />
              ) : null}
              <SalesforceTypeBadge type={org.type} />
              {org.isDefault ? <CheckIcon aria-label="Workspace default org" /> : null}
            </MenuItem>
          ))}
          {orgs.length === 0 ? (
            <MenuItem disabled>
              {state === null || state.loading
                ? "Loading Salesforce orgs…"
                : query.trim()
                  ? "No org matches"
                  : "No authenticated orgs"}
            </MenuItem>
          ) : null}
        </div>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem onClick={copyId}>
        <CopyIcon aria-hidden />
        Copy ID
      </MenuItem>
    </>
  );
}

const canOpenRecords = (state: SalesforceState) =>
  state.isDxProject && state.cli !== null && state.cli.installed;

/** A record ID as a menu of orgs to open it in; plain text outside Salesforce DX workspaces. */
function SalesforceRecordId({
  recordId,
  target,
  children,
}: {
  recordId: string;
  target: SalesforceRecordTarget | null;
  children: ReactNode;
}) {
  const enabled = useEnvironmentQuerySelector(
    target === null
      ? null
      : salesforceEnvironment.recordLinks({
          environmentId: target.environmentId,
          input: { cwd: target.cwd },
        }),
    (result) => result._tag === "Success" && canOpenRecords(result.value),
  );
  if (target === null || !enabled) return <>{children}</>;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Salesforce record ${recordId}: open in an org`}
            className="cursor-pointer rounded-sm text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
          />
        }
      >
        {children}
      </MenuTrigger>
      <MenuPopup align="start" className="w-80">
        <RecordOrgMenu recordId={recordId} target={target} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * Markdown components for the elements `rehypeSalesforceRecordIds` adds. `useTarget` reads the
 * message's workspace from the renderer, or null where records should stay plain text.
 */
export function salesforceRecordIdComponents(useTarget: () => SalesforceRecordTarget | null) {
  return {
    [SALESFORCE_RECORD_ID_TAG]: function MarkdownSalesforceRecordId({
      children,
      "data-record-id": recordId,
    }: {
      children?: ReactNode;
      "data-record-id"?: string;
    }) {
      const target = useTarget();
      if (typeof recordId !== "string") return <>{children}</>;
      return (
        <SalesforceRecordId recordId={recordId} target={target}>
          {children}
        </SalesforceRecordId>
      );
    },
  };
}
