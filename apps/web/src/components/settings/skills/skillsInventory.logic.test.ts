import type { SkillEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterSkills,
  groupProjectSkills,
  groupUserSkills,
  skillCopies,
  splitSkillMarkdown,
  summarizeSkills,
} from "./skillsInventory.logic";

const skill = (overrides: Partial<SkillEntry> & Pick<SkillEntry, "directory" | "name">) =>
  ({
    description: "Does things",
    scope: "user",
    tool: "claude",
    source: "local",
    plugin: null,
    projectId: null,
    linkTarget: null,
    contentHash: "a",
    modifiedAt: null,
    issues: [],
    ...overrides,
  }) satisfies SkillEntry;

const claudeReview = skill({ directory: "/h/.claude/skills/review", name: "review" });
const codexReview = skill({
  directory: "/h/.codex/skills/review",
  name: "review",
  tool: "codex",
  linkTarget: "/h/.claude/skills/review",
});
const projectReview = skill({
  directory: "/p/.agents/skills/review",
  name: "Review",
  tool: "agents",
  scope: "project",
  projectId: "p1",
  contentHash: "b",
});
const pluginReview = skill({
  directory: "/h/.claude/plugins/x/skills/review",
  name: "engineering:review",
  source: "plugin",
  plugin: "engineering",
});
const broken = skill({
  directory: "/h/.claude/skills/broken",
  name: "broken",
  description: null,
  issues: ["noFrontmatter", "noDescription"],
});
const skills = [claudeReview, codexReview, projectReview, pluginReview, broken];

describe("skillCopies", () => {
  it("relates skills by name across agents, scopes and plugin namespaces", () => {
    const copies = skillCopies(skills);
    expect(copies.has(broken.directory)).toBe(false);
    expect(
      copies.get(claudeReview.directory)?.map((copy) => [copy.skill.directory, copy.kind]),
    ).toEqual([
      [codexReview.directory, "link"],
      [projectReview.directory, "different"],
      [pluginReview.directory, "identical"],
    ]);
  });
});

describe("filterSkills", () => {
  it("combines agent, view and every search term", () => {
    const copies = skillCopies(skills);
    const filter = { query: "", tool: "all", view: "all" } as const;
    expect(filterSkills(skills, { ...filter, view: "problems" }, copies)).toEqual([broken]);
    expect(filterSkills(skills, { ...filter, view: "duplicates" }, copies)).toHaveLength(4);
    expect(filterSkills(skills, { ...filter, tool: "codex" }, copies)).toEqual([codexReview]);
    expect(filterSkills(skills, { ...filter, query: "REVIEW agents" }, copies)).toEqual([
      projectReview,
    ]);
  });
});

describe("grouping and summary", () => {
  it("groups user skills by agent and source and projects by title", () => {
    expect(groupUserSkills(skills).map((group) => [group.label, group.skills.length])).toEqual([
      ["Claude", 2],
      ["Claude · plugins", 1],
      ["Codex", 1],
    ]);
    const projects = [
      { id: "p2", title: "Empty", workspaceRoot: "/e" },
      { id: "p1", title: "App", workspaceRoot: "/p" },
    ];
    const grouped = groupProjectSkills(projects, skills);
    expect(grouped.withSkills.map((group) => group.project.title)).toEqual(["App"]);
    expect(grouped.withoutSkills).toBe(1);

    expect(summarizeSkills(skills, skillCopies(skills))).toMatchObject({
      total: 5,
      user: 4,
      project: 1,
      duplicatedNames: 1,
      withProblems: 1,
      userTokensByTool: [
        { tool: "claude", tokens: 6 },
        { tool: "codex", tokens: 3 },
      ],
    });
  });

  it("splits the YAML header from the body", () => {
    expect(splitSkillMarkdown("---\nname: a\n---\n# Body")).toEqual({
      frontmatter: "name: a",
      body: "# Body",
    });
    expect(splitSkillMarkdown("# Only body")).toEqual({ frontmatter: null, body: "# Only body" });
  });
});
