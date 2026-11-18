import { createFileRoute } from "@tanstack/react-router";

import { SkillsSettingsPanel } from "../components/settings/skills/SkillsSettings";

// Fork-only Skills inventory; see CUSTOM_DEVELOPMENT.md.
export const Route = createFileRoute("/_chat/settings/skills")({
  component: SkillsSettingsPanel,
});
