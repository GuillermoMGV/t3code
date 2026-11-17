import { IssueKey } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

// Fork-only Linear and Jira badges on pull requests; see CUSTOM_DEVELOPMENT.md.

const isIssueKey = Schema.is(IssueKey);
// Keys stand alone: `fix(PRO-12): …`, `PRO-12 …`, `feat/pro-12-thing`, but not `abcPRO-12`.
const KEY_IN_TEXT = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_]{1,19}-[1-9]\d{0,6})(?![A-Za-z0-9])/;

function keyIn(text: string, anyCase: boolean): IssueKey | null {
  const match = KEY_IN_TEXT.exec(text)?.[1];
  if (match === undefined) return null;
  if (!anyCase && match !== match.toUpperCase()) return null;
  const key = match.toUpperCase();
  return isIssueKey(key) ? key : null;
}

/** The issue a pull request names: in its title (upper case), else in its source branch. */
export function pullRequestIssueKey(entry: {
  readonly title: string;
  readonly headBranch: string;
}): IssueKey | null {
  return keyIn(entry.title, false) ?? keyIn(entry.headBranch, true);
}
