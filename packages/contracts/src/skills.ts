import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// Fork-only Skills inventory: every agent skill on the server's machine, by user and project.
// See CUSTOM_DEVELOPMENT.md.

/** The agent whose skills folder holds the skill; `agents` is the shared `.agents/skills`. */
export const SkillTool = Schema.Literals([
  "claude",
  "codex",
  "agents",
  "cursor",
  "gemini",
  "opencode",
]);
export type SkillTool = typeof SkillTool.Type;

export const SKILL_TOOL_LABELS: Readonly<Record<SkillTool, string>> = {
  claude: "Claude",
  codex: "Codex",
  agents: "Shared (.agents)",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export const SkillScope = Schema.Literals(["user", "project"]);
export type SkillScope = typeof SkillScope.Type;

/**
 * `local` skills live in a skills folder and can be deleted here. The others are managed by
 * their agent: Codex's bundled `.system` skills, skills synced from a claude.ai account, and
 * skills installed by Claude plugins.
 */
export const SkillSource = Schema.Literals(["local", "system", "synced", "plugin"]);
export type SkillSource = typeof SkillSource.Type;

export const SkillIssue = Schema.Literals([
  "noFrontmatter",
  "malformedFrontmatter",
  "noDescription",
  "nameMismatch",
]);
export type SkillIssue = typeof SkillIssue.Type;

export const SkillEntry = Schema.Struct({
  /** The skill folder; also its id. */
  directory: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  scope: SkillScope,
  tool: SkillTool,
  source: SkillSource,
  /** The plugin that installed it, for `plugin` skills. */
  plugin: Schema.NullOr(Schema.String),
  /** The T3 project whose folder holds it, for project skills. */
  projectId: Schema.NullOr(Schema.String),
  /** Where the folder points when it is a symbolic link. */
  linkTarget: Schema.NullOr(Schema.String),
  /** SHA-256 of SKILL.md, to tell identical copies from diverging ones. */
  contentHash: Schema.String,
  modifiedAt: Schema.NullOr(Schema.String),
  issues: Schema.Array(SkillIssue),
});
export type SkillEntry = typeof SkillEntry.Type;

export const SkillProject = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  workspaceRoot: Schema.String,
});
export type SkillProject = typeof SkillProject.Type;

export const TrashedSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  originalDirectory: Schema.String,
  scope: SkillScope,
  tool: SkillTool,
  projectTitle: Schema.NullOr(Schema.String),
  deletedAt: Schema.String,
});
export type TrashedSkill = typeof TrashedSkill.Type;

export const SkillsInventoryInput = Schema.Struct({});

export const SkillsInventory = Schema.Struct({
  skills: Schema.Array(SkillEntry),
  projects: Schema.Array(SkillProject),
  trash: Schema.Array(TrashedSkill),
  scannedAt: Schema.String,
});
export type SkillsInventory = typeof SkillsInventory.Type;

export const SkillDetailInput = Schema.Struct({ directory: TrimmedNonEmptyString });
export type SkillDetailInput = typeof SkillDetailInput.Type;

export const SkillFile = Schema.Struct({ path: Schema.String, size: Schema.Number });

export const SkillDetail = Schema.Struct({
  directory: Schema.String,
  /** SKILL.md as written, frontmatter included. */
  content: Schema.String,
  files: Schema.Array(SkillFile),
  /** More files than the list holds. */
  filesTruncated: Schema.Boolean,
});
export type SkillDetail = typeof SkillDetail.Type;

export const SkillsMutation = Schema.Union([
  /** Moves a local skill's folder (or the link to it) into T3 Code's skills trash. */
  Schema.Struct({ type: Schema.Literal("delete"), directory: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("restore"), id: TrimmedNonEmptyString }),
  /** Deletes a trashed skill for good. */
  Schema.Struct({ type: Schema.Literal("purge"), id: TrimmedNonEmptyString }),
]);
export type SkillsMutation = typeof SkillsMutation.Type;

export const SkillsMutationResult = Schema.Struct({});

export class SkillsError extends Schema.TaggedError<SkillsError>()("SkillsError", {
  reason: Schema.Literals(["notFound", "readOnly", "conflict", "storage"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Rough tokens a description costs: agents load every skill description into each session. */
export function estimateSkillTokens(description: string | null): number {
  return Math.ceil((description?.length ?? 0) / 4);
}
