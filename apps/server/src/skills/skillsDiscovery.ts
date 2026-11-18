import type {
  SkillEntry,
  SkillIssue,
  SkillProject,
  SkillScope,
  SkillSource,
  SkillTool,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md.

export interface SkillRoot {
  readonly directory: string;
  readonly scope: SkillScope;
  readonly tool: SkillTool;
  readonly source: SkillSource;
  readonly projectId: string | null;
}

const USER_ROOTS: ReadonlyArray<readonly [ReadonlyArray<string>, SkillTool]> = [
  [[".claude", "skills"], "claude"],
  [[".codex", "skills"], "codex"],
  [[".agents", "skills"], "agents"],
  [[".cursor", "skills"], "cursor"],
  [[".gemini", "skills"], "gemini"],
  [[".config", "opencode", "skills"], "opencode"],
];

// Codex reads repository skills from `.agents/skills`, so it has no project folder of its own.
const PROJECT_ROOTS: ReadonlyArray<readonly [ReadonlyArray<string>, SkillTool]> = [
  [[".claude", "skills"], "claude"],
  [[".agents", "skills"], "agents"],
  [[".cursor", "skills"], "cursor"],
  [[".gemini", "skills"], "gemini"],
  [[".opencode", "skills"], "opencode"],
];

/** Every skills folder to scan, user folders first so they win a shared path. */
export const skillRoots = Effect.fn("skillRoots")(function* (
  home: string,
  projects: ReadonlyArray<SkillProject>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const roots: Array<SkillRoot> = USER_ROOTS.map(([segments, tool]) => ({
    directory: path.join(home, ...segments),
    scope: "user",
    tool,
    source: "local",
    projectId: null,
  }));
  roots.push({
    directory: path.join(home, ".codex", "skills", ".system"),
    scope: "user",
    tool: "codex",
    source: "system",
    projectId: null,
  });
  // Claude keeps skills synced from a claude.ai account in the bucket a `.bucket-<id>` file marks.
  const syncedPath = path.join(home, ".claude", "skills", "synced");
  const syncedEntries = yield* fileSystem
    .readDirectory(syncedPath)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  for (const entry of syncedEntries) {
    if (!entry.startsWith(".bucket-")) continue;
    roots.push({
      directory: path.join(syncedPath, entry.slice(".bucket-".length)),
      scope: "user",
      tool: "claude",
      source: "synced",
      projectId: null,
    });
  }
  for (const project of projects) {
    for (const [segments, tool] of PROJECT_ROOTS) {
      roots.push({
        directory: path.join(project.workspaceRoot, ...segments),
        scope: "project",
        tool,
        source: "local",
        projectId: project.id,
      });
    }
  }
  return roots;
});

const FRONTMATTER_PATTERN = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface ParsedSkillMarkdown {
  readonly name: string;
  readonly description: string | null;
  readonly issues: ReadonlyArray<SkillIssue>;
}

/** The skill's name (its `name` field, else its folder) and what keeps an agent from loading it. */
export function parseSkillMarkdown(contents: string, folderName: string): ParsedSkillMarkdown {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { name: folderName, description: null, issues: ["noFrontmatter", "noDescription"] };
  }
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { name: folderName, description: null, issues: ["malformedFrontmatter"] };
  }
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const issues: Array<SkillIssue> = [];
  if (!description) issues.push("noDescription");
  if (name && name !== folderName) issues.push("nameMismatch");
  return { name: name || folderName, description: description || null, issues };
}

/** A fast 53-bit hash (cyrb53); it only tells identical copies from different ones. */
export function hashSkillContent(contents: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < contents.length; index++) {
    const code = contents.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** One skill folder, or none when it has no readable SKILL.md. */
export const readSkill = Effect.fn("readSkill")(function* (
  root: Pick<SkillRoot, "scope" | "tool" | "source" | "projectId">,
  directory: string,
  plugin: string | null = null,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillFile = path.join(directory, "SKILL.md");
  const contents = yield* fileSystem
    .readFileString(skillFile)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (contents === undefined) return Option.none<SkillEntry>();
  const folderName = path.basename(directory);
  const parsed = parseSkillMarkdown(contents, folderName);
  const linkTarget = yield* fileSystem
    .readLink(directory)
    .pipe(Effect.orElseSucceed((): string | null => null));
  const modified = yield* fileSystem.stat(skillFile).pipe(
    Effect.map((info) => Option.getOrNull(info.mtime)),
    Effect.orElseSucceed(() => null),
  );
  return Option.some<SkillEntry>({
    directory,
    name: plugin ? `${plugin}:${folderName}` : parsed.name,
    description: parsed.description,
    scope: root.scope,
    tool: root.tool,
    source: root.source,
    plugin,
    projectId: root.projectId,
    linkTarget: linkTarget === null ? null : path.resolve(path.dirname(directory), linkTarget),
    contentHash: hashSkillContent(contents),
    modifiedAt: modified === null ? null : modified.toISOString(),
    issues: parsed.issues,
  });
});

/** The skills directly inside a skills folder; dot folders hold agent internals. */
export const scanSkillRoot = Effect.fn("scanSkillRoot")(function* (root: SkillRoot) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem
    .readDirectory(root.directory)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const skills: Array<SkillEntry> = [];
  for (const entry of [...entries].sort()) {
    if (entry.startsWith(".")) continue;
    const skill = yield* readSkill(root, path.join(root.directory, entry));
    if (Option.isSome(skill)) skills.push(skill.value);
  }
  return skills;
});

const MAX_DETAIL_FILES = 300;

/** The files inside a skill folder, relative to it, largest folders cut at a fixed count. */
export const listSkillFiles = Effect.fn("listSkillFiles")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem
    .readDirectory(directory, { recursive: true })
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const files: Array<{ path: string; size: number }> = [];
  for (const entry of [...entries].sort()) {
    if (files.length >= MAX_DETAIL_FILES) break;
    const info = yield* fileSystem
      .stat(path.join(directory, entry))
      .pipe(Effect.orElseSucceed(() => null));
    if (info?.type !== "File") continue;
    files.push({ path: entry.split(path.sep).join("/"), size: Number(info.size) });
  }
  return { files, truncated: entries.length > files.length && files.length >= MAX_DETAIL_FILES };
});
