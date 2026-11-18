import {
  SKILL_TOOL_LABELS,
  type EditorId,
  type EnvironmentId,
  type SkillEntry,
  type SkillProject,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CopyIcon, ExternalLinkIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";

import { useOpenInPreferredEditor } from "../../../editorPreferences";
import { writeTextToClipboard } from "../../../hooks/useCopyToClipboard";
import { skillsEnvironment } from "../../../state/skills";
import { useEnvironmentQuery } from "../../../state/query";
import ChatMarkdown from "../../ChatMarkdown";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Spinner } from "../../ui/spinner";
import { toastManager } from "../../ui/toast";
import {
  formatDate,
  formatFileSize,
  SKILL_ISSUE_LABELS,
  splitSkillMarkdown,
  type SkillCopy,
} from "./skillsInventory.logic";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md.

const SOURCE_LABELS: Readonly<Record<SkillEntry["source"], string | null>> = {
  local: null,
  system: "Built in",
  synced: "Synced from claude.ai",
  plugin: "Plugin",
};

const COPY_LABELS: Readonly<Record<SkillCopy["kind"], string>> = {
  link: "Same files (link)",
  identical: "Identical copy",
  different: "Different content",
};

export function SkillDetailDialog({
  environmentId,
  availableEditors,
  skill,
  copies,
  projects,
  onOpenChange,
  onOpenSkill,
  onDelete,
}: {
  environmentId: EnvironmentId;
  availableEditors: readonly EditorId[];
  skill: SkillEntry;
  copies: ReadonlyArray<SkillCopy>;
  projects: ReadonlyArray<SkillProject>;
  onOpenChange: (open: boolean) => void;
  onOpenSkill: (skill: SkillEntry) => void;
  onDelete: (skill: SkillEntry) => void;
}) {
  const detail = useEnvironmentQuery(
    skillsEnvironment.detail({ environmentId, input: { directory: skill.directory } }),
  );
  const openInEditor = useOpenInPreferredEditor(environmentId, availableEditors);
  const projectTitle = (projectId: string | null) =>
    projects.find((project) => project.id === projectId)?.title ?? null;
  const where = (entry: SkillEntry) =>
    entry.scope === "user"
      ? `User · ${SKILL_TOOL_LABELS[entry.tool]}`
      : `${projectTitle(entry.projectId) ?? "Project"} · ${SKILL_TOOL_LABELS[entry.tool]}`;

  const openFile = async (filePath: string) => {
    const result = await openInEditor(filePath);
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Could not open the skill",
      description: error instanceof Error ? error.message : undefined,
    });
  };

  const markdown = detail.data ? splitSkillMarkdown(detail.data.content) : null;
  const sourceLabel = SOURCE_LABELS[skill.source];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{skill.name}</DialogTitle>
            <Badge variant="outline">{where(skill)}</Badge>
            {sourceLabel ? <Badge variant="secondary">{sourceLabel}</Badge> : null}
          </div>
          <DialogDescription>{skill.description ?? "No description."}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Folder</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="break-all font-mono">{skill.directory}</span>
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label="Copy folder path"
                  onClick={() => void writeTextToClipboard(skill.directory, "path")}
                >
                  <CopyIcon />
                </Button>
              </dd>
              {skill.linkTarget ? (
                <>
                  <dt className="text-muted-foreground">Links to</dt>
                  <dd className="break-all font-mono">{skill.linkTarget}</dd>
                </>
              ) : null}
              {skill.modifiedAt ? (
                <>
                  <dt className="text-muted-foreground">Modified</dt>
                  <dd>{formatDate(skill.modifiedAt)}</dd>
                </>
              ) : null}
            </dl>

            {skill.issues.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-lg bg-warning/8 px-3 py-2 text-warning-foreground text-xs">
                {skill.issues.map((issue) => (
                  <li key={issue} className="flex items-center gap-1.5">
                    <TriangleAlertIcon className="size-3.5 shrink-0" />
                    {SKILL_ISSUE_LABELS[issue]}
                  </li>
                ))}
              </ul>
            ) : null}

            {copies.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-medium text-xs">Same name elsewhere</h3>
                <ul className="flex flex-col rounded-lg border border-border/60">
                  {copies.map((copy) => (
                    <li key={copy.skill.directory} className="not-first:border-t">
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40"
                        onClick={() => onOpenSkill(copy.skill)}
                      >
                        <span className="shrink-0">{where(copy.skill)}</span>
                        <Badge
                          variant={copy.kind === "different" ? "warning" : "secondary"}
                          size="sm"
                        >
                          {COPY_LABELS[copy.kind]}
                        </Badge>
                        <span className="ml-auto truncate font-mono text-muted-foreground">
                          {copy.skill.directory}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {detail.data === null ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                {detail.error ?? (
                  <>
                    <Spinner size="xs" aria-label="Loading" /> Reading SKILL.md…
                  </>
                )}
              </div>
            ) : (
              <>
                <section className="flex flex-col gap-1.5">
                  <h3 className="font-medium text-xs">
                    Files ({detail.data.files.length}
                    {detail.data.filesTruncated ? "+" : ""})
                  </h3>
                  <ul className="max-h-40 overflow-y-auto rounded-lg border border-border/60 font-mono text-xs">
                    {detail.data.files.map((file) => (
                      <li key={file.path} className="flex gap-2 px-3 py-1 not-first:border-t">
                        <span className="truncate">{file.path}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {formatFileSize(file.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="flex flex-col gap-1.5">
                  <h3 className="font-medium text-xs">SKILL.md</h3>
                  <div className="rounded-lg border border-border/60 px-4 py-3">
                    <ChatMarkdown
                      text={
                        markdown?.frontmatter
                          ? `\`\`\`yaml\n${markdown.frontmatter}\n\`\`\`\n\n${markdown.body}`
                          : (markdown?.body ?? "")
                      }
                      cwd={skill.directory}
                      environmentId={environmentId}
                    />
                  </div>
                </section>
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          {skill.source === "local" ? (
            <Button variant="destructive-outline" size="sm" onClick={() => onDelete(skill)}>
              <Trash2Icon />
              Delete
            </Button>
          ) : (
            <p className="mr-auto self-center text-muted-foreground text-xs">
              Managed by its {skill.source === "plugin" ? "plugin" : "agent"}; remove it there.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openFile(`${skill.directory}/SKILL.md`)}
          >
            <ExternalLinkIcon />
            Open in editor
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
