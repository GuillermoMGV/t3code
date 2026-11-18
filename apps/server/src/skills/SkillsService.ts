// @effect-diagnostics nodeBuiltinImport:off -- Effect's symlink cannot make a Windows junction, which needs no privileges.
import {
  type OrchestrationProjectShell,
  SkillsError,
  TrashedSkill,
  type SkillDetail,
  type SkillDetailInput,
  type SkillEntry,
  type SkillProject,
  type SkillsInventory,
  type SkillsMutation,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as NodeFSP from "node:fs/promises";

import * as ServerConfig from "../config.ts";
import { discoverClaudeSkills } from "../provider/Drivers/ClaudeSkills.ts";
import {
  hashSkillContent,
  listSkillFiles,
  readSkill,
  scanSkillRoot,
  skillRoots,
} from "./skillsDiscovery.ts";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md. Deleting moves a skill into
// `<stateDir>/skills-trash/` so it can be restored; only purging removes it for good.

const TRASH_DIRECTORY = "skills-trash";
const TRASH_MANIFEST = "skills-trash.json";
const MAX_SKILL_CONTENT = 256 * 1024;

const TrashRecord = Schema.Struct({
  ...TrashedSkill.fields,
  /** The moved folder; null for a symbolic link, which is recreated from `linkTarget`. */
  trashPath: Schema.NullOr(Schema.String),
  linkTarget: Schema.NullOr(Schema.String),
});
type TrashRecord = typeof TrashRecord.Type;

const TrashManifest = Schema.fromJsonString(Schema.Struct({ items: Schema.Array(TrashRecord) }));
const decodeTrashManifest = Schema.decodeUnknownOption(TrashManifest);
const encodeTrashManifest = Schema.encodeEffect(TrashManifest);

/** The T3 projects whose folders are scanned; the RPC handler reads them. */
export type SkillsProjectShells = ReadonlyArray<
  Pick<OrchestrationProjectShell, "id" | "title" | "workspaceRoot" | "archivedAt">
>;

export class SkillsService extends Context.Service<
  SkillsService,
  {
    readonly list: (shells: SkillsProjectShells) => Effect.Effect<SkillsInventory, SkillsError>;
    readonly read: (
      input: SkillDetailInput,
      shells: SkillsProjectShells,
    ) => Effect.Effect<SkillDetail, SkillsError>;
    readonly mutate: (
      input: SkillsMutation,
      shells: SkillsProjectShells,
    ) => Effect.Effect<{}, SkillsError>;
  }
>()("t3/skills/SkillsService") {}

const storageError = (detail: string) => (cause: unknown) =>
  new SkillsError({ reason: "storage", detail, cause });

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const trashDirectory = path.join(stateDir, TRASH_DIRECTORY);
  const manifestPath = path.join(stateDir, TRASH_MANIFEST);
  const trashLock = yield* Semaphore.make(1);
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  const readTrash = fileSystem.readFileString(manifestPath).pipe(
    Effect.map((json) =>
      decodeTrashManifest(json).pipe(
        Option.map((manifest) => manifest.items),
        Option.getOrElse((): ReadonlyArray<TrashRecord> => []),
      ),
    ),
    Effect.orElseSucceed((): ReadonlyArray<TrashRecord> => []),
  );

  const writeTrash = Effect.fn("SkillsService.writeTrash")(
    function* (items: ReadonlyArray<TrashRecord>) {
      const json = yield* encodeTrashManifest({ items });
      const tempPath = `${manifestPath}.tmp`;
      yield* fileSystem.writeFileString(tempPath, `${json}\n`);
      yield* fileSystem.rename(tempPath, manifestPath);
    },
    Effect.mapError(storageError("Could not save the skills trash.")),
  );

  const toProjects = (shells: SkillsProjectShells) => {
    const projects: Array<SkillProject> = [];
    const seen = new Set<string>();
    for (const shell of shells) {
      if (shell.archivedAt) continue;
      const root = path.resolve(shell.workspaceRoot);
      if (seen.has(root)) continue;
      seen.add(root);
      projects.push({ id: shell.id, title: shell.title, workspaceRoot: root });
    }
    return projects;
  };

  // Plugin skills come from Claude's own discovery; the `:` marks a plugin's namespace.
  const pluginSkills = Effect.gen(function* () {
    const discovered = yield* discoverClaudeSkills({ homePath: "" });
    const skills: Array<SkillEntry> = [];
    for (const skill of discovered) {
      const separator = skill.name.indexOf(":");
      if (separator <= 0) continue;
      const entry = yield* readSkill(
        { scope: "user", tool: "claude", source: "plugin", projectId: null },
        path.dirname(skill.path),
        skill.name.slice(0, separator),
      );
      if (Option.isSome(entry)) skills.push({ ...entry.value, name: skill.name });
    }
    return skills;
  });

  const scan = Effect.fn("SkillsService.scan")(function* (shells: SkillsProjectShells) {
    const projects = toProjects(shells);
    const roots = yield* skillRoots(home, projects);
    const skills: Array<SkillEntry> = [];
    const seen = new Set<string>();
    const add = (entries: ReadonlyArray<SkillEntry>) => {
      for (const entry of entries) {
        const key = path.resolve(entry.directory);
        if (seen.has(key)) continue;
        seen.add(key);
        skills.push(entry);
      }
    };
    for (const root of roots) add(yield* scanSkillRoot(root));
    add(yield* pluginSkills);
    return { projects, skills };
  }, Effect.provide(services));

  const findSkill = Effect.fn("SkillsService.findSkill")(function* (
    directory: string,
    shells: SkillsProjectShells,
  ) {
    const { skills, projects } = yield* scan(shells);
    const wanted = path.resolve(directory);
    const skill = skills.find((entry) => path.resolve(entry.directory) === wanted);
    if (skill === undefined) {
      return yield* new SkillsError({
        reason: "notFound",
        detail: "That skill is no longer there. Refresh the list.",
      });
    }
    return { skill, projects };
  });

  // A rename cannot cross drives; a copy then a delete can.
  const move = (from: string, to: string) =>
    fileSystem
      .rename(from, to)
      .pipe(
        Effect.catch(() =>
          fileSystem
            .copy(from, to)
            .pipe(Effect.andThen(fileSystem.remove(from, { recursive: true }))),
        ),
      );

  const list: SkillsService["Service"]["list"] = Effect.fn("SkillsService.list")(
    function* (shells) {
      const { projects, skills } = yield* scan(shells);
      const trash = yield* readTrash;
      return {
        skills,
        projects,
        trash: trash.map(({ trashPath: _trashPath, linkTarget: _linkTarget, ...item }) => item),
        scannedAt: DateTime.formatIso(yield* DateTime.now),
      };
    },
  );

  const read: SkillsService["Service"]["read"] = Effect.fn("SkillsService.read")(
    function* (input, shells) {
      const { skill } = yield* findSkill(input.directory, shells);
      const content = yield* fileSystem
        .readFileString(path.join(skill.directory, "SKILL.md"))
        .pipe(Effect.mapError(storageError("Could not read SKILL.md.")));
      const { files, truncated } = yield* listSkillFiles(skill.directory).pipe(
        Effect.provide(services),
      );
      return {
        directory: skill.directory,
        content: content.length > MAX_SKILL_CONTENT ? content.slice(0, MAX_SKILL_CONTENT) : content,
        files,
        filesTruncated: truncated,
      };
    },
  );

  const remove = Effect.fn("SkillsService.delete")(function* (
    directory: string,
    shells: SkillsProjectShells,
  ) {
    const { skill, projects } = yield* findSkill(directory, shells);
    if (skill.source !== "local") {
      return yield* new SkillsError({
        reason: "readOnly",
        detail: "This skill is managed by its agent or plugin and cannot be deleted here.",
      });
    }
    const id = `${DateTime.toEpochMillis(yield* DateTime.now)}-${hashSkillContent(skill.directory)}`;
    const deletedAt = DateTime.formatIso(yield* DateTime.now);
    let trashPath: string | null = null;
    if (skill.linkTarget !== null) {
      // Only the link goes; the folder it points to stays where it is.
      yield* fileSystem
        .remove(skill.directory)
        .pipe(Effect.mapError(storageError("Could not remove the skill link.")));
    } else {
      trashPath = path.join(trashDirectory, id);
      yield* fileSystem
        .makeDirectory(trashDirectory, { recursive: true })
        .pipe(
          Effect.andThen(move(skill.directory, trashPath)),
          Effect.mapError(storageError("Could not move the skill to the trash.")),
        );
    }
    const record: TrashRecord = {
      id,
      name: skill.name,
      originalDirectory: skill.directory,
      scope: skill.scope,
      tool: skill.tool,
      projectTitle: projects.find((project) => project.id === skill.projectId)?.title ?? null,
      deletedAt,
      trashPath,
      linkTarget: skill.linkTarget,
    };
    yield* writeTrash([record, ...(yield* readTrash)]);
  });

  const findTrashed = Effect.fn("SkillsService.findTrashed")(function* (id: string) {
    const items = yield* readTrash;
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) {
      return yield* new SkillsError({
        reason: "notFound",
        detail: "That skill is not in the trash.",
      });
    }
    return { item, rest: items.filter((candidate) => candidate.id !== id) };
  });

  const restore = Effect.fn("SkillsService.restore")(function* (id: string) {
    const { item, rest } = yield* findTrashed(id);
    const occupied = yield* fileSystem
      .exists(item.originalDirectory)
      .pipe(Effect.orElseSucceed(() => false));
    if (occupied) {
      return yield* new SkillsError({
        reason: "conflict",
        detail: `A skill already exists at ${item.originalDirectory}.`,
      });
    }
    yield* fileSystem
      .makeDirectory(path.dirname(item.originalDirectory), { recursive: true })
      .pipe(Effect.mapError(storageError("Could not recreate the skills folder.")));
    if (item.linkTarget !== null) {
      const target = item.linkTarget;
      // A junction needs no privileges on Windows; other systems ignore the type.
      yield* Effect.tryPromise({
        try: () => NodeFSP.symlink(target, item.originalDirectory, "junction"),
        catch: storageError("Could not recreate the skill link."),
      });
    } else if (item.trashPath !== null) {
      yield* move(item.trashPath, item.originalDirectory).pipe(
        Effect.mapError(storageError("Could not move the skill back.")),
      );
    }
    yield* writeTrash(rest);
  });

  const purge = Effect.fn("SkillsService.purge")(function* (id: string) {
    const { item, rest } = yield* findTrashed(id);
    if (item.trashPath !== null) {
      yield* fileSystem
        .remove(item.trashPath, { recursive: true })
        .pipe(Effect.mapError(storageError("Could not delete the skill.")));
    }
    yield* writeTrash(rest);
  });

  const mutate: SkillsService["Service"]["mutate"] = (input, shells) =>
    trashLock.withPermits(1)(
      (input.type === "delete"
        ? remove(input.directory, shells)
        : input.type === "restore"
          ? restore(input.id)
          : purge(input.id)
      ).pipe(Effect.as({})),
    );

  return SkillsService.of({ list, read, mutate });
});

export const layer = Layer.effect(SkillsService, make);
