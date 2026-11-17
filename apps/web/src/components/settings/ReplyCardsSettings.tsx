import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

// Fork-only cards under agent replies; see CUSTOM_DEVELOPMENT.md.

const ROWS = [
  {
    id: "reply-cards-issues",
    setting: "replyCardsIssues",
    label: "issue cards",
    description: "Show Linear and Jira issues a finished reply mentions as cards below it.",
  },
  {
    id: "reply-cards-pull-requests",
    setting: "replyCardsPullRequests",
    label: "pull request cards",
    description: "Show pull requests a finished reply mentions as cards below it.",
  },
] as const;

export function ReplyCardsSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection id="reply-cards" title="Reply cards">
      {ROWS.map((row) => {
        const { title } = searchableSetting(row.id);
        const defaultValue = DEFAULT_UNIFIED_SETTINGS[row.setting];
        return (
          <SettingsRow
            key={row.id}
            {...searchableSetting(row.id)}
            description={row.description}
            resetAction={
              settings[row.setting] !== defaultValue ? (
                <SettingResetButton
                  label={row.label}
                  onClick={() => updateSettings({ [row.setting]: defaultValue })}
                />
              ) : null
            }
            control={
              <Switch
                checked={settings[row.setting]}
                onCheckedChange={(checked) => updateSettings({ [row.setting]: Boolean(checked) })}
                aria-label={title}
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}
