import type { ContextMenuItem, ThreadPullRequestLink } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

// Fork-only "Go to ticket" and "Open PR" thread menu entries; see CUSTOM_DEVELOPMENT.md.

export type PullRequestMenuId = "open-prs" | `open-pr:${number}`;

export interface PullRequestMenuTarget {
  readonly url: string;
  readonly label: string;
}

/** Each linked pull request named by its target branch, with the number only when two share one. */
export function pullRequestMenuTargets(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<PullRequestMenuTarget> {
  const visible = visibleThreadPullRequests(links);
  const bases = visible.map((link) => link.snapshot?.baseBranch ?? null);
  return visible.map((link, index) => {
    const base = bases[index];
    if (base == null) return { url: link.url, label: `PR #${link.number}` };
    const shared = bases.filter((other) => other === base).length > 1;
    return { url: link.url, label: shared ? `PR to ${base} (#${link.number})` : `PR to ${base}` };
  });
}

export function buildPullRequestMenuItems(
  targets: ReadonlyArray<PullRequestMenuTarget>,
): ReadonlyArray<ContextMenuItem<PullRequestMenuId>> {
  if (targets.length === 0) return [];
  if (targets.length === 1)
    return [{ id: "open-pr:0", label: "Open PR", icon: "git-pull-request" }];
  return [
    {
      id: "open-prs",
      label: "Open PRs",
      icon: "git-pull-request",
      children: targets.map((target, index) => ({
        id: `open-pr:${index}` as const,
        label: target.label,
        icon: "git-pull-request",
      })),
    },
  ];
}

/** The URL behind a clicked `open-pr:<index>` entry, or null for any other entry. */
export function pullRequestMenuUrl(
  targets: ReadonlyArray<PullRequestMenuTarget>,
  action: string,
): string | null {
  if (!action.startsWith("open-pr:")) return null;
  return targets[Number(action.slice("open-pr:".length))]?.url ?? null;
}
