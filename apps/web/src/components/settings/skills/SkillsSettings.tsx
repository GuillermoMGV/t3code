import {
  SKILL_TOOL_LABELS,
  type EnvironmentId,
  type SkillEntry,
  type SkillTool,
  type SkillsInventory,
  type SkillsMutation,
  type TrashedSkill,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ChevronRightIcon,
  CopyIcon,
  Link2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import { skillsEnvironment } from "../../../state/skills";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Spinner } from "../../ui/spinner";
import { toastManager } from "../../ui/toast";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { useSettingsScope } from "../SettingsScopeContext";
import { searchableSetting } from "../settingsSearch";
import { SettingsPageContainer, SettingsSection } from "../settingsLayout";
import { SkillDetailDialog } from "./SkillDetailDialog";
import {
  filterSkills,
  formatDate,
  groupProjectSkills,
  groupUserSkills,
  skillCopies,
  summarizeSkills,
  type SkillCopy,
  type SkillsFilter,
  type SkillsView,
} from "./skillsInventory.logic";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md.
export function SkillsSettingsPanel() {
  const { environment } = useSettingsScope();
  if (environment?.connection.phase !== "connected") {
    return (
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("skills-user")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect an environment to see the skills on its machine.
          </p>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  return (
    <SkillsInventoryView
      key={environment.environmentId}
      environmentId={environment.environmentId}
      availableEditors={environment.serverConfig?.availableEditors ?? []}
    />
  );
}

const TOOL_OPTIONS = Object.keys(SKILL_TOOL_LABELS) as ReadonlyArray<SkillTool>;

type PendingAction =
  | { readonly kind: "delete"; readonly skill: SkillEntry }
  | { readonly kind: "purge"; readonly item: TrashedSkill };

function SkillsInventoryView({
  environmentId,
  availableEditors,
}: {
  environmentId: EnvironmentId;
  availableEditors: Parameters<typeof SkillDetailDialog>[0]["availableEditors"];
}) {
  const query = useEnvironmentQuery(skillsEnvironment.inventory({ environmentId, input: {} }));
  const mutate = useAtomCommand(skillsEnvironment.mutate, { reportFailure: false });
  const [filter, setFilter] = useState<SkillsFilter>({ query: "", tool: "all", view: "all" });
  const [openDirectory, setOpenDirectory] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (input: SkillsMutation, success: string) => {
    setRunning(true);
    const result = await mutate({ environmentId, input });
    setRunning(false);
    if (result._tag === "Success") {
      query.refresh();
      toastManager.add({ type: "success", title: success });
      return true;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Skills",
        description: failure instanceof Error ? failure.message : "The server did not answer.",
      });
    }
    return false;
  };

  const data = query.data;
  if (data === null) {
    return (
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("skills-user")}>
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            {query.error ?? (
              <>
                <Spinner size="xs" aria-label="Loading" /> Looking for skills…
              </>
            )}
          </div>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  const copies = skillCopies(data.skills);
  const visible = filterSkills(data.skills, filter, copies);
  const summary = summarizeSkills(data.skills, copies);
  const userGroups = groupUserSkills(visible);
  const projectGroups = groupProjectSkills(data.projects, visible);
  const openSkill = data.skills.find((skill) => skill.directory === openDirectory) ?? null;
  const rowProps = {
    copies,
    onOpen: (skill: SkillEntry) => setOpenDirectory(skill.directory),
    onDelete: (skill: SkillEntry) => setPending({ kind: "delete", skill }),
  };
  const filtering = filter.query.trim() !== "" || filter.tool !== "all" || filter.view !== "all";

  return (
    <SettingsPageContainer>
      <SkillsOverview
        inventory={data}
        summary={summary}
        filter={filter}
        refreshing={query.isPending}
        onFilterChange={setFilter}
        onRefresh={() => query.refresh()}
      />

      <SettingsSection {...searchableSetting("skills-user")}>
        {userGroups.length === 0 ? (
          <EmptyRow>{filtering ? "No user skill matches." : "No user skills."}</EmptyRow>
        ) : (
          userGroups.map((group) => (
            <div key={group.key}>
              <GroupHeading label={group.label} count={group.skills.length} />
              {group.skills.map((skill) => (
                <SkillRow key={skill.directory} skill={skill} {...rowProps} />
              ))}
            </div>
          ))
        )}
      </SettingsSection>

      <SettingsSection {...searchableSetting("skills-projects")}>
        {projectGroups.withSkills.length === 0 ? (
          <EmptyRow>
            {filtering ? "No project skill matches." : "No project has its own skills."}
          </EmptyRow>
        ) : (
          projectGroups.withSkills.map(({ project, skills }) => (
            <Collapsible key={project.id} defaultOpen>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/40">
                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
                <span className="truncate font-medium text-sm">{project.title}</span>
                <span className="text-muted-foreground text-xs">{skills.length}</span>
                <span className="ml-auto truncate font-mono text-muted-foreground text-xs">
                  {project.workspaceRoot}
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                {skills.map((skill) => (
                  <SkillRow key={skill.directory} skill={skill} showTool {...rowProps} />
                ))}
              </CollapsiblePanel>
            </Collapsible>
          ))
        )}
        {projectGroups.withoutSkills > 0 && !filtering ? (
          <p className="px-4 py-2.5 text-muted-foreground text-xs">
            {projectGroups.withoutSkills} other{" "}
            {projectGroups.withoutSkills === 1 ? "project has" : "projects have"} no skills.
          </p>
        ) : null}
      </SettingsSection>

      {data.trash.length > 0 ? (
        <SettingsSection {...searchableSetting("skills-trash")}>
          {data.trash.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{item.name}</span>
                  <Badge variant="outline" size="sm">
                    {SKILL_TOOL_LABELS[item.tool]}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {item.projectTitle ?? "User"} · deleted {formatDate(item.deletedAt)}
                  </span>
                </div>
                <p className="truncate font-mono text-muted-foreground text-xs">
                  {item.originalDirectory}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={running}
                onClick={() => void run({ type: "restore", id: item.id }, `Restored ${item.name}`)}
              >
                <RotateCcwIcon />
                Restore
              </Button>
              <Button
                size="icon-sm"
                variant="ghost-destructive"
                aria-label={`Delete ${item.name} for good`}
                disabled={running}
                onClick={() => setPending({ kind: "purge", item })}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </SettingsSection>
      ) : null}

      {openSkill ? (
        <SkillDetailDialog
          environmentId={environmentId}
          availableEditors={availableEditors}
          skill={openSkill}
          copies={copies.get(openSkill.directory) ?? []}
          projects={data.projects}
          onOpenChange={(open) => {
            if (!open) setOpenDirectory(null);
          }}
          onOpenSkill={(skill) => setOpenDirectory(skill.directory)}
          onDelete={(skill) => setPending({ kind: "delete", skill })}
        />
      ) : null}

      <ConfirmDialog
        pending={pending}
        running={running}
        onCancel={() => setPending(null)}
        onConfirm={async (action) => {
          const done =
            action.kind === "delete"
              ? await run(
                  { type: "delete", directory: action.skill.directory },
                  `Moved ${action.skill.name} to Recently deleted`,
                )
              : await run({ type: "purge", id: action.item.id }, `Deleted ${action.item.name}`);
          if (done) {
            setPending(null);
            if (action.kind === "delete") setOpenDirectory(null);
          }
        }}
      />
    </SettingsPageContainer>
  );
}

function SkillsOverview({
  inventory,
  summary,
  filter,
  refreshing,
  onFilterChange,
  onRefresh,
}: {
  inventory: SkillsInventory;
  summary: ReturnType<typeof summarizeSkills>;
  filter: SkillsFilter;
  refreshing: boolean;
  onFilterChange: (filter: SkillsFilter) => void;
  onRefresh: () => void;
}) {
  const stats = [
    `${summary.total} skills`,
    `${summary.user} user`,
    `${summary.project} in projects`,
    ...(summary.duplicatedNames > 0 ? [`${summary.duplicatedNames} repeated names`] : []),
    ...(summary.withProblems > 0 ? [`${summary.withProblems} with problems`] : []),
  ];
  return (
    <SettingsSection
      {...searchableSetting("skills-overview")}
      headerAction={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Scan again"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? <Spinner size="xs" /> : <RefreshCwIcon />}
              </Button>
            }
          />
          <TooltipPopup side="top">Scanned {formatDate(inventory.scannedAt)}</TooltipPopup>
        </Tooltip>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="text-sm">{stats.join(" · ")}</p>
        {summary.userTokensByTool.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Every new session loads the descriptions of its agent's user skills:{" "}
            {summary.userTokensByTool
              .map(({ tool, tokens }) => `${SKILL_TOOL_LABELS[tool]} ~${tokens} tokens`)
              .join(", ")}
            . Project skills add theirs inside their project.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1">
            <Input
              type="search"
              aria-label="Search skills"
              placeholder="Search name, description or path"
              value={filter.query}
              onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
            />
          </div>
          <Select
            value={filter.tool}
            onValueChange={(value) =>
              onFilterChange({ ...filter, tool: (value ?? "all") as SkillTool | "all" })
            }
          >
            <SelectTrigger aria-label="Agent" size="sm" className="w-40">
              <SelectValue>
                {filter.tool === "all" ? "All agents" : SKILL_TOOL_LABELS[filter.tool]}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">All agents</SelectItem>
              {TOOL_OPTIONS.map((tool) => (
                <SelectItem key={tool} value={tool}>
                  {SKILL_TOOL_LABELS[tool]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <ToggleGroup
            aria-label="Show"
            variant="segmented"
            value={[filter.view]}
            onValueChange={(next) => {
              const view = next[0];
              if (view === "all" || view === "duplicates" || view === "problems") {
                onFilterChange({ ...filter, view: view satisfies SkillsView });
              }
            }}
          >
            <Toggle value="all">All</Toggle>
            <Toggle value="duplicates">Repeated</Toggle>
            <Toggle value="problems">Problems</Toggle>
          </ToggleGroup>
        </div>
      </div>
    </SettingsSection>
  );
}

function SkillRow({
  skill,
  copies,
  showTool = false,
  onOpen,
  onDelete,
}: {
  skill: SkillEntry;
  copies: ReadonlyMap<string, ReadonlyArray<SkillCopy>>;
  showTool?: boolean;
  onOpen: (skill: SkillEntry) => void;
  onDelete: (skill: SkillEntry) => void;
}) {
  const others = copies.get(skill.directory) ?? [];
  return (
    <div className="group/skill flex items-center gap-3 px-4 py-2 hover:bg-accent/30">
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => onOpen(skill)}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-sm">{skill.name}</span>
          {showTool ? (
            <Badge variant="outline" size="sm">
              {SKILL_TOOL_LABELS[skill.tool]}
            </Badge>
          ) : null}
          {skill.linkTarget ? (
            <Link2Icon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {others.length > 0 ? <CopiesBadge copies={others} /> : null}
          {skill.issues.length > 0 ? (
            <Badge variant="warning" size="sm">
              <TriangleAlertIcon />
              {skill.issues.length === 1 ? "1 problem" : `${skill.issues.length} problems`}
            </Badge>
          ) : null}
        </div>
        <p className="line-clamp-1 text-muted-foreground text-xs">
          {skill.description ?? "No description"}
        </p>
      </button>
      {skill.source === "local" ? (
        <Button
          size="icon-xs"
          variant="ghost-destructive"
          aria-label={`Delete ${skill.name}`}
          onClick={() => onDelete(skill)}
        >
          <Trash2Icon />
        </Button>
      ) : null}
    </div>
  );
}

function CopiesBadge({ copies }: { copies: ReadonlyArray<SkillCopy> }) {
  const different = copies.some((copy) => copy.kind === "different");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={different ? "warning" : "info"} size="sm">
            <CopyIcon />×{copies.length + 1}
          </Badge>
        }
      />
      <TooltipPopup side="top">
        {different
          ? "Same name elsewhere, with different content"
          : "Same name elsewhere, same content"}
      </TooltipPopup>
    </Tooltip>
  );
}

function ConfirmDialog({
  pending,
  running,
  onCancel,
  onConfirm,
}: {
  pending: PendingAction | null;
  running: boolean;
  onCancel: () => void;
  onConfirm: (action: PendingAction) => Promise<void>;
}) {
  const title =
    pending?.kind === "purge"
      ? `Delete “${pending.item.name}” for good?`
      : `Delete “${pending?.skill.name ?? ""}”?`;
  const description =
    pending === null
      ? ""
      : pending.kind === "purge"
        ? "Its files are removed from disk. This cannot be undone."
        : pending.skill.linkTarget
          ? `Only the link is removed. The skill it points to stays at ${pending.skill.linkTarget}. You can restore the link from Recently deleted.`
          : "Its folder moves to Recently deleted, where you can restore it. Agents stop loading it in new sessions.";
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !running) onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {pending?.kind === "delete" ? (
            <p className="break-all font-mono text-muted-foreground text-xs">
              {pending.skill.directory}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={running} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={running || pending === null}
            onClick={() => {
              if (pending) void onConfirm(pending);
            }}
          >
            {pending?.kind === "purge" ? "Delete for good" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 bg-muted/30 px-4 py-1.5 text-muted-foreground text-xs">
      <span className="font-medium">{label}</span>
      <span>{count}</span>
    </div>
  );
}

function EmptyRow({ children }: { children: string }) {
  return <p className="px-4 py-3 text-muted-foreground text-sm">{children}</p>;
}
