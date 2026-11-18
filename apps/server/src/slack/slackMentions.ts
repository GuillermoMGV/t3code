import type { TrackerNotification } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import type { SlackUser } from "./slackApi.ts";

// Fork-only Slack mentions in the notifications bell; see CUSTOM_DEVELOPMENT.md. Pure parts.

const TEXT_LIMIT = 400;
/** Mentions older than this drop out of the bell. */
const SLACK_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** One `search.messages` match; decoded leniently, Slack omits fields for some message types. */
export const SlackSearchMatch = Schema.Struct({
  ts: Schema.String,
  text: Schema.optional(Schema.String),
  user: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  permalink: Schema.optional(Schema.String),
  channel: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      is_im: Schema.optional(Schema.Boolean),
      is_mpim: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type SlackSearchMatch = typeof SlackSearchMatch.Type;

export const slackDisplayName = (user: SlackUser): string =>
  user.profile?.display_name || user.real_name || user.profile?.real_name || user.name || user.id;

const ENTITIES: Readonly<Record<string, string>> = { "&lt;": "<", "&gt;": ">", "&amp;": "&" };

/** Slack's markup (`<@U1>`, `<#C1|name>`, `<url|label>`, `<!here>`) as plain readable text. */
export function slackPlainText(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .replace(/<([^<>]+)>/g, (_match, inner: string) => {
      const [target = "", label] = inner.split("|", 2);
      if (target.startsWith("@")) return `@${label ?? names.get(target.slice(1)) ?? "someone"}`;
      if (target.startsWith("#")) return `#${label ?? "channel"}`;
      if (target.startsWith("!subteam^")) return label ?? "@team";
      if (target.startsWith("!")) return `@${target.slice(1)}`;
      return label ?? target;
    })
    .replace(/&(lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

const shorten = (text: string): string | null => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > TEXT_LIMIT ? `${trimmed.slice(0, TEXT_LIMIT - 1)}…` : trimmed;
};

const channelLabel = (channel: SlackSearchMatch["channel"]): string => {
  if (channel?.is_im === true) return "Direct message";
  if (channel?.is_mpim === true) return "Group message";
  return channel?.name ? `#${channel.name}` : "Slack";
};

/** Mentions of the user, newest first, without the user's own messages or ones past the window. */
export function toSlackMentions(
  matches: ReadonlyArray<SlackSearchMatch>,
  options: {
    readonly userId: string;
    readonly names: ReadonlyMap<string, string>;
    readonly nowMs: number;
  },
): TrackerNotification[] {
  const seen = new Set<string>();
  const items: TrackerNotification[] = [];
  for (const match of matches) {
    const ms = Number(match.ts) * 1000;
    if (!Number.isFinite(ms) || options.nowMs - ms > SLACK_WINDOW_MS) continue;
    if (match.user === options.userId || match.permalink === undefined) continue;
    const id = `slack:${match.channel?.id ?? "unknown"}:${match.ts}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      tracker: "slack",
      kind: "mention",
      issue: { key: channelLabel(match.channel), title: "", url: match.permalink },
      actor: (match.user && options.names.get(match.user)) || match.username || null,
      text: shorten(slackPlainText(match.text ?? "", options.names)),
      detail: null,
      createdAt: DateTime.formatIso(DateTime.makeUnsafe(ms)),
      read: false,
    });
  }
  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
