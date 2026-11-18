// @effect-diagnostics nodeBuiltinImport:off -- the fixture needs a junction, as the service does.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeFSP from "node:fs/promises";

import * as ServerConfig from "../config.ts";
import { parseSkillMarkdown } from "./skillsDiscovery.ts";
import * as SkillsService from "./SkillsService.ts";

const skillMarkdown = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

describe("parseSkillMarkdown", () => {
  it("reads the name and description and reports what keeps a skill from loading", () => {
    expect(parseSkillMarkdown(skillMarkdown("alpha", "Does alpha"), "alpha")).toEqual({
      name: "alpha",
      description: "Does alpha",
      issues: [],
    });
    expect(parseSkillMarkdown("# No frontmatter", "beta")).toEqual({
      name: "beta",
      description: null,
      issues: ["noFrontmatter", "noDescription"],
    });
    expect(parseSkillMarkdown("---\nname: [unclosed\n---\n", "gamma").issues).toEqual([
      "malformedFrontmatter",
    ]);
    expect(parseSkillMarkdown("---\nname: other\n---\n", "delta")).toEqual({
      name: "other",
      description: null,
      issues: ["noDescription", "nameMismatch"],
    });
  });
});

describe("SkillsService", () => {
  it.effect("lists user, system and project skills and restores what it deletes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-skills-" });
      const home = path.join(root, "home");
      const project = path.join(root, "project");
      const write = (directory: string, contents: string) =>
        fs
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(path.join(directory, "SKILL.md"), contents)));
      const userAlpha = path.join(home, ".claude", "skills", "alpha");
      yield* write(userAlpha, skillMarkdown("alpha", "Does alpha"));
      yield* write(path.join(home, ".claude", "skills", ".trash", "old"), "ignored");
      yield* write(path.join(home, ".codex", "skills", ".system", "imagegen"), "# Bundled");
      yield* fs.makeDirectory(path.join(home, ".codex", "skills"), { recursive: true });
      const codexLink = path.join(home, ".codex", "skills", "alpha");
      yield* Effect.promise(() => NodeFSP.symlink(userAlpha, codexLink, "junction"));
      const projectAlpha = path.join(project, ".agents", "skills", "alpha");
      yield* write(projectAlpha, skillMarkdown("alpha", "Does alpha"));
      yield* write(path.join(root, "archived", ".claude", "skills", "hidden"), "# Hidden");

      const shells = [
        {
          id: ProjectId.make("project"),
          title: "Project",
          workspaceRoot: project,
          archivedAt: null,
        },
        {
          id: ProjectId.make("archived"),
          title: "Archived",
          workspaceRoot: path.join(root, "archived"),
          archivedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      yield* Effect.gen(function* () {
        const service = yield* SkillsService.make.pipe(
          Effect.provide(ServerConfig.ServerConfig.layerTest(root, { prefix: "t3-skills-state-" })),
        );

        const inventory = yield* service.list(shells);
        const summary = inventory.skills.map((skill) => [skill.tool, skill.source, skill.scope]);
        expect(summary).toEqual([
          ["claude", "local", "user"],
          ["codex", "local", "user"],
          ["codex", "system", "user"],
          ["agents", "local", "project"],
        ]);
        const [claudeAlpha, codexAlpha, imagegen, agentsAlpha] = inventory.skills;
        expect(codexAlpha?.linkTarget).toBe(userAlpha);
        expect(agentsAlpha?.contentHash).toBe(claudeAlpha?.contentHash);
        expect(imagegen?.issues).toEqual(["noFrontmatter", "noDescription"]);
        expect(inventory.projects.map((entry) => entry.title)).toEqual(["Project"]);

        const readOnly = yield* service
          .mutate({ type: "delete", directory: imagegen!.directory }, shells)
          .pipe(Effect.flip);
        expect(readOnly.reason).toBe("readOnly");

        yield* service.mutate({ type: "delete", directory: projectAlpha }, shells);
        expect(yield* fs.exists(projectAlpha)).toBe(false);
        // Deleting a link leaves the folder it points to.
        yield* service.mutate({ type: "delete", directory: codexLink }, shells);
        expect(yield* fs.exists(codexLink)).toBe(false);
        expect(yield* fs.exists(path.join(userAlpha, "SKILL.md"))).toBe(true);

        const afterDelete = yield* service.list(shells);
        expect(afterDelete.skills).toHaveLength(2);
        expect(afterDelete.trash.map((item) => [item.tool, item.projectTitle])).toEqual([
          ["codex", null],
          ["agents", "Project"],
        ]);

        for (const item of afterDelete.trash) {
          yield* service.mutate({ type: "restore", id: item.id }, shells);
        }
        const restored = yield* service.list(shells);
        expect(restored.trash).toEqual([]);
        expect(restored.skills.find((skill) => skill.directory === codexLink)?.linkTarget).toBe(
          userAlpha,
        );
        expect(yield* fs.readFileString(path.join(projectAlpha, "SKILL.md"))).toContain("alpha");

        yield* service.mutate({ type: "delete", directory: projectAlpha }, shells);
        const [trashed] = (yield* service.list(shells)).trash;
        yield* service.mutate({ type: "purge", id: trashed!.id }, shells);
        expect((yield* service.list(shells)).trash).toEqual([]);
        const missing = yield* service
          .mutate({ type: "restore", id: trashed!.id }, shells)
          .pipe(Effect.flip);
        expect(missing.reason).toBe("notFound");
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, home));
    }).pipe(
      Effect.provideService(HostProcess.HomeDirectory, ""),
      Effect.provide(NodeServices.layer),
    ),
  );
});
