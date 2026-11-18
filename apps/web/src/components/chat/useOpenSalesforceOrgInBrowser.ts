import type { SalesforceOrg, ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { resolveBrowserDefaults } from "~/browser/browserDefaults";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import { readLocalApi } from "~/localApi";
import { applyPreviewServerSnapshot } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { salesforceEnvironment } from "~/state/salesforce";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";
import { salesforceOrgName } from "./salesforceOrgs.logic";

// Fork-only Salesforce org manager; see CUSTOM_DEVELOPMENT.md.

/**
 * Opens the org, already logged in, in the thread's built-in browser. The login URL carries a
 * session, so it skips the recent-URL and history stores that `openUrlInPreview` writes to.
 */
export function useOpenSalesforceOrgInBrowser(threadRef: ScopedThreadRef, cwd: string) {
  const mutate = useAtomCommand(salesforceEnvironment.mutate, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });

  const fail = (title: string, error: unknown) =>
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "The Salesforce CLI did not answer.",
    });

  return async (org: SalesforceOrg) => {
    const login = await mutate({
      environmentId: threadRef.environmentId,
      input: { type: "open", cwd, target: org.alias ?? org.username, urlOnly: true },
    });
    if (login._tag === "Failure") {
      if (!isAtomCommandInterrupted(login)) {
        fail(`Could not open ${salesforceOrgName(org)}`, squashAtomCommandFailure(login));
      }
      return;
    }
    const url = login.value.url;
    if (url === undefined) return;

    if (isPreviewAvailableFor(threadRef.environmentId)) {
      const defaults = await resolveBrowserDefaults();
      const runtime = previewRuntimeFor(threadRef.environmentId);
      const result = await openPreview({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          url,
          viewport: defaults.viewport,
          profileId: defaults.profileId,
          ...(runtime === undefined
            ? {}
            : { runtime, zoomFactor: defaults.zoomFactor, colorScheme: defaults.appearance }),
        },
      });
      if (result._tag === "Success") {
        applyPreviewServerSnapshot(threadRef, result.value);
        useRightPanelStore.getState().openBrowser(threadRef, result.value.tabId);
        return;
      }
      if (isAtomCommandInterrupted(result)) return;
      console.error(result.cause);
    }
    const api = readLocalApi();
    if (api) await api.shell.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
}
