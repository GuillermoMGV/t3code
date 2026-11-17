// Fork-only target branch filter for the pull requests list; see CUSTOM_DEVELOPMENT.md.
// It filters the loaded rows on the client, so the host query and its cache stay official.

interface BranchGroup {
  readonly entries: ReadonlyArray<{ readonly baseBranch: string }>;
}

/** Target branches of the loaded pull requests, plus the selected one, sorted by name. */
export function pullRequestTargetBranches(
  groups: ReadonlyArray<BranchGroup>,
  selected: string | undefined,
): string[] {
  const branches = new Set(
    groups.flatMap((group) => group.entries.map((entry) => entry.baseBranch)),
  );
  if (selected !== undefined) branches.add(selected);
  return [...branches].toSorted((left, right) => left.localeCompare(right));
}

/** Where a target branch sits: the released line, the shared integration line, or anything else. */
export function targetBranchKind(base: string): "production" | "integration" | "other" {
  const name = base.toLowerCase();
  if (name === "main" || name === "master" || name === "production") return "production";
  if (name === "develop" || name === "development" || name === "dev") return "integration";
  return "other";
}

/** Keeps only the pull requests that merge into `base`; every group when it is undefined. */
export function filterByTargetBranch<Group extends BranchGroup>(
  groups: ReadonlyArray<Group>,
  base: string | undefined,
): ReadonlyArray<Group> {
  if (base === undefined) return groups;
  return groups.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => entry.baseBranch === base),
  }));
}
