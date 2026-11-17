import type {
  EnvironmentId,
  SalesforceMutation,
  SalesforceOrg,
  SalesforceOrgType,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { salesforceEnvironment } from "~/state/salesforce";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  SALESFORCE_TYPE_LABELS,
  salesforceOrgHealth,
  salesforceStatusLabel,
} from "./salesforceOrgs.logic";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md.

const TYPE_VARIANTS = {
  production: "error",
  devhub: "warning",
  sandbox: "info",
  scratch: "secondary",
} as const satisfies Record<SalesforceOrgType, string>;

export function SalesforceTypeBadge({ type }: { type: SalesforceOrgType }) {
  return (
    <Badge variant={TYPE_VARIANTS[type]} size="sm">
      {SALESFORCE_TYPE_LABELS[type]}
    </Badge>
  );
}

const HEALTH_CLASSES = {
  connected: "bg-success",
  error: "bg-destructive",
  unknown: "bg-muted-foreground/40",
} as const;

export function SalesforceStatusDot({ org }: { org: Pick<SalesforceOrg, "connectedStatus"> }) {
  return (
    <span
      role="img"
      aria-label={salesforceStatusLabel(org)}
      className={cn("size-2 shrink-0 rounded-full", HEALTH_CLASSES[salesforceOrgHealth(org)])}
    />
  );
}

/** Runs a Salesforce action; resolves to whether it succeeded, after a toast on failure. */
export type SalesforceRun = (input: SalesforceMutation, failureTitle: string) => Promise<boolean>;

/** The Salesforce state for a workspace and a runner for its actions, with error toasts. */
export function useSalesforce(environmentId: EnvironmentId, cwd: string | null) {
  const query = useEnvironmentQuery(
    cwd === null ? null : salesforceEnvironment.state({ environmentId, input: { cwd } }),
  );
  const mutate = useAtomCommand(salesforceEnvironment.mutate, { reportFailure: false });
  const [pending, setPending] = useState(false);

  /** Resolves to whether the command succeeded. */
  const run: SalesforceRun = async (input, failureTitle) => {
    setPending(true);
    const result = await mutate({ environmentId, input });
    setPending(false);
    query.refresh();
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: failureTitle,
        description: error instanceof Error ? error.message : "The Salesforce CLI did not answer.",
      });
    }
    return false;
  };

  return { state: query.data, error: query.error, refresh: query.refresh, run, pending };
}

export function SalesforceConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
