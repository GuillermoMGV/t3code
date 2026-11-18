import {
  estimateSkillTokens,
  SKILL_TOOL_LABELS,
  type SkillEntry,
  type SkillIssue,
  type SkillProject,
  type SkillTool,
} from "@t3tools/contracts";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md.

export type SkillsView = "all" | "duplicates" | "problems";

export interface SkillsFilter {
  readonly query: string;
  readonly tool: SkillTool | "all";
  readonly view: SkillsView;
}

/** How another skill with the same name relates to this one. */
export type SkillCopyKind = "link" | "identical" | "different";

export interface SkillCopy {
  readonly skill: SkillEntry;
  readonly kind: SkillCopyKind;
}

export const SKILL_ISSUE_LABELS: Readonly<Record<SkillIssue, string>> = {
  noFrontmatter: "No frontmatter: agents may not load it",
  malformedFrontmatter: "Frontmatter is not valid YAML: agents skip it",
  noDescription: "No description: agents cannot tell when to use it",
  nameMismatch: "Its name field differs from its folder name",
};

const normalize = (value: string) => value.trim().toLowerCase();

/** Duplicates are matched by name, ignoring a plugin's namespace and letter case. */
function skillMatchKey(skill: Pick<SkillEntry, "name">): string {
  const separator = skill.name.indexOf(":");
  return normalize(separator > 0 ? skill.name.slice(separator + 1) : skill.name);
}

function copyKind(skill: SkillEntry, other: SkillEntry): SkillCopyKind {
  if (skill.linkTarget === other.directory || other.linkTarget === skill.directory) return "link";
  if (skill.linkTarget !== null && skill.linkTarget === other.linkTarget) return "link";
  return skill.contentHash === other.contentHash ? "identical" : "different";
}

/** Every other skill sharing a skill's name, keyed by the skill's folder. */
export function skillCopies(
  skills: ReadonlyArray<SkillEntry>,
): ReadonlyMap<string, ReadonlyArray<SkillCopy>> {
  const byKey = new Map<string, Array<SkillEntry>>();
  for (const skill of skills) {
    const key = skillMatchKey(skill);
    const group = byKey.get(key);
    if (group) group.push(skill);
    else byKey.set(key, [skill]);
  }
  const copies = new Map<string, ReadonlyArray<SkillCopy>>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const skill of group) {
      copies.set(
        skill.directory,
        group
          .filter((other) => other !== skill)
          .map((other) => ({ skill: other, kind: copyKind(skill, other) })),
      );
    }
  }
  return copies;
}

export function filterSkills(
  skills: ReadonlyArray<SkillEntry>,
  filter: SkillsFilter,
  copies: ReadonlyMap<string, ReadonlyArray<SkillCopy>>,
): ReadonlyArray<SkillEntry> {
  const terms = normalize(filter.query).split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    if (filter.tool !== "all" && skill.tool !== filter.tool) return false;
    if (filter.view === "duplicates" && !copies.has(skill.directory)) return false;
    if (filter.view === "problems" && skill.issues.length === 0) return false;
    if (terms.length === 0) return true;
    const haystack = normalize(`${skill.name} ${skill.description ?? ""} ${skill.directory}`);
    return terms.every((term) => haystack.includes(term));
  });
}

const byName = (left: SkillEntry, right: SkillEntry) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

export interface SkillGroup {
  readonly key: string;
  readonly label: string;
  readonly skills: ReadonlyArray<SkillEntry>;
}

const TOOL_ORDER: ReadonlyArray<SkillTool> = [
  "claude",
  "codex",
  "agents",
  "cursor",
  "gemini",
  "opencode",
];

/** User skills by agent, managed ones (system, synced, plugins) after the agent's own. */
export function groupUserSkills(skills: ReadonlyArray<SkillEntry>): ReadonlyArray<SkillGroup> {
  const groups: Array<SkillGroup> = [];
  for (const tool of TOOL_ORDER) {
    const own = skills.filter((skill) => skill.scope === "user" && skill.tool === tool);
    for (const [source, suffix] of [
      ["local", ""],
      ["system", " · built in"],
      ["synced", " · synced from claude.ai"],
      ["plugin", " · plugins"],
    ] as const) {
      const matching = own.filter((skill) => skill.source === source).toSorted(byName);
      if (matching.length > 0) {
        groups.push({
          key: `${tool}-${source}`,
          label: `${SKILL_TOOL_LABELS[tool]}${suffix}`,
          skills: matching,
        });
      }
    }
  }
  return groups;
}

export interface ProjectSkillGroup {
  readonly project: SkillProject;
  readonly skills: ReadonlyArray<SkillEntry>;
}

/** Projects with skills first, by title; the rest only count. */
export function groupProjectSkills(
  projects: ReadonlyArray<SkillProject>,
  skills: ReadonlyArray<SkillEntry>,
): { readonly withSkills: ReadonlyArray<ProjectSkillGroup>; readonly withoutSkills: number } {
  const withSkills: Array<ProjectSkillGroup> = [];
  let withoutSkills = 0;
  for (const project of projects) {
    const own = skills
      .filter((skill) => skill.scope === "project" && skill.projectId === project.id)
      .toSorted(
        (left, right) =>
          TOOL_ORDER.indexOf(left.tool) - TOOL_ORDER.indexOf(right.tool) || byName(left, right),
      );
    if (own.length === 0) withoutSkills += 1;
    else withSkills.push({ project, skills: own });
  }
  withSkills.sort((left, right) =>
    left.project.title.localeCompare(right.project.title, undefined, { sensitivity: "base" }),
  );
  return { withSkills, withoutSkills };
}

export interface SkillsSummary {
  readonly total: number;
  readonly user: number;
  readonly project: number;
  readonly duplicatedNames: number;
  readonly withProblems: number;
  /** Description tokens every session of each agent loads from user skills. */
  readonly userTokensByTool: ReadonlyArray<{ readonly tool: SkillTool; readonly tokens: number }>;
}

export function summarizeSkills(
  skills: ReadonlyArray<SkillEntry>,
  copies: ReadonlyMap<string, ReadonlyArray<SkillCopy>>,
): SkillsSummary {
  const duplicated = new Set<string>();
  for (const skill of skills) if (copies.has(skill.directory)) duplicated.add(skillMatchKey(skill));
  const tokens = new Map<SkillTool, number>();
  for (const skill of skills) {
    if (skill.scope !== "user") continue;
    tokens.set(skill.tool, (tokens.get(skill.tool) ?? 0) + estimateSkillTokens(skill.description));
  }
  return {
    total: skills.length,
    user: skills.filter((skill) => skill.scope === "user").length,
    project: skills.filter((skill) => skill.scope === "project").length,
    duplicatedNames: duplicated.size,
    withProblems: skills.filter((skill) => skill.issues.length > 0).length,
    userTokensByTool: TOOL_ORDER.flatMap((tool) => {
      const value = tokens.get(tool) ?? 0;
      return value > 0 ? [{ tool, tokens: value }] : [];
    }),
  };
}

const FRONTMATTER_PATTERN = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** SKILL.md split into its YAML header and its body. */
export function splitSkillMarkdown(content: string): {
  readonly frontmatter: string | null;
  readonly body: string;
} {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1] ?? "", body: content.slice(match[0].length) };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
