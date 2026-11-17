import type { Element, ElementContent, Root, RootContent, Text } from "hast";

// Fork-only clickable Salesforce record IDs in chat messages; see CUSTOM_DEVELOPMENT.md.

const CHECKSUM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

/** The 3-character suffix that turns a 15-character ID into its case-insensitive 18-character form. */
export function salesforceIdChecksum(id15: string): string {
  let suffix = "";
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let index = 0; index < 5; index++) {
      const char = id15.charCodeAt(chunk * 5 + index);
      if (char >= 65 && char <= 90) bits |= 1 << index;
    }
    suffix += CHECKSUM_ALPHABET[bits];
  }
  return suffix;
}

// Key prefixes start with a digit (standard objects) or a lowercase letter (custom objects `a`,
// custom metadata `m`, ...). Characters 6-8 are the reserved digit and the top of the record
// number, which stay `0` in practice; without a checksum, that is what tells a 15-character ID
// from a hash or a word.
const ID_15 = /^[0-9a-z][0-9A-Za-z]{4}000[0-9A-Za-z]{7}$/;
const ID_18_PREFIX = /^[0-9a-z][0-9A-Za-z]{14}[A-Z0-5]{3}$/;
// Hex-only text (git SHAs, digests) and all-digit numbers are never treated as 15-character IDs.
const NOT_HEX = /[g-zA-Z]/;

/** Whether `value` is a Salesforce record ID: 15 characters, or 18 with a valid checksum. */
export function isSalesforceRecordId(value: string): boolean {
  if (value.length === 15) return ID_15.test(value) && NOT_HEX.test(value);
  if (value.length === 18) {
    return ID_18_PREFIX.test(value) && salesforceIdChecksum(value) === value.slice(15);
  }
  return false;
}

const CANDIDATE = /(?<![0-9A-Za-z_-])[0-9A-Za-z]{15}(?:[0-9A-Za-z]{3})?(?![0-9A-Za-z_-])/g;

export interface SalesforceRecordIdMatch {
  readonly id: string;
  readonly index: number;
}

/** Every record ID in plain text, as whole words. */
export function findSalesforceRecordIds(text: string): SalesforceRecordIdMatch[] {
  if (text.length < 15) return [];
  const matches: SalesforceRecordIdMatch[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    if (isSalesforceRecordId(match[0])) matches.push({ id: match[0], index: match.index });
  }
  return matches;
}

export const SALESFORCE_RECORD_ID_TAG = "salesforce-record-id";

function recordIdElement(id: string, children: ElementContent[]): Element {
  return {
    type: "element",
    tagName: SALESFORCE_RECORD_ID_TAG,
    properties: { dataRecordId: id },
    children,
  };
}

function splitText(node: Text): ElementContent[] | null {
  const matches = findSalesforceRecordIds(node.value);
  if (matches.length === 0) return null;
  const parts: ElementContent[] = [];
  let offset = 0;
  for (const { id, index } of matches) {
    if (index > offset) parts.push({ type: "text", value: node.value.slice(offset, index) });
    parts.push(recordIdElement(id, [{ type: "text", value: id }]));
    offset = index + id.length;
  }
  if (offset < node.value.length) parts.push({ type: "text", value: node.value.slice(offset) });
  return parts;
}

// Code blocks are copied as code, and links and buttons already do something on click.
const SKIPPED_TAGS = new Set(["pre", "a", "button", "script", "style", "svg", "math"]);

function inlineCodeId(element: Element): string | null {
  const only = element.children.length === 1 ? element.children[0] : undefined;
  if (only?.type !== "text") return null;
  const value = only.value.trim();
  return isSalesforceRecordId(value) ? value : null;
}

function linkify(parent: Root | Element) {
  const children = parent.children as Array<RootContent | ElementContent>;
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (child.type === "text") {
      const parts = splitText(child);
      if (parts === null) continue;
      children.splice(index, 1, ...parts);
      index += parts.length - 1;
    } else if (child.type === "element" && !SKIPPED_TAGS.has(child.tagName)) {
      // Outside `pre`, `code` is inline code: linked only when it holds one ID and nothing else.
      if (child.tagName === "code") {
        const id = inlineCodeId(child);
        if (id !== null) children[index] = recordIdElement(id, [child]);
      } else {
        linkify(child);
      }
    }
  }
}

/** Wraps record IDs in prose and in inline code with a `salesforce-record-id` element. */
export function rehypeSalesforceRecordIds() {
  return (tree: Root) => linkify(tree);
}
