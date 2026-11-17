import type { Element, Root } from "hast";
import { describe, expect, it } from "vite-plus/test";

import {
  findSalesforceRecordIds,
  isSalesforceRecordId,
  rehypeSalesforceRecordIds,
  salesforceIdChecksum,
} from "./salesforceRecordIds.logic";

describe("isSalesforceRecordId", () => {
  it("computes the 18-character checksum", () => {
    expect(salesforceIdChecksum("001D000000IqhSL")).toBe("IAZ");
    expect(salesforceIdChecksum("a0B3h000009XyZ1")).toBe("EAK");
  });

  it.each([
    ["001D000000IqhSL", true],
    ["001D000000IqhSLIAZ", true],
    ["a0B3h000009XyZ1EAK", true],
    ["0055e000004Tq8t", true],
    // Wrong checksum, or a lowercase suffix the CLI never prints.
    ["001D000000IqhSLIAA", false],
    ["001D000000IqhSLiaz", false],
    // Hex hashes and plain numbers, even when shaped like an ID.
    ["3f9a2000b1e7d4c", false],
    ["123450000000001", false],
    // Words, and prefixes that start with an uppercase letter.
    ["implementations", false],
    ["Implementations", false],
    ["ABCDE000000IqhS", false],
    // Without the reserved zeros a 15-character token is not trusted.
    ["001D5g1234IqhSL", false],
    ["001D000000IqhSLX", false],
  ])("%s is %s", (value, expected) => {
    expect(isSalesforceRecordId(value)).toBe(expected);
  });
});

describe("findSalesforceRecordIds", () => {
  it("finds whole-word IDs in prose", () => {
    expect(
      findSalesforceRecordIds("Account 001D000000IqhSL was updated (see /a0B3h000009XyZ1EAK)."),
    ).toEqual([
      { id: "001D000000IqhSL", index: 8 },
      { id: "a0B3h000009XyZ1EAK", index: 42 },
    ]);
  });

  it("ignores IDs glued to identifiers, longer tokens and git SHAs", () => {
    expect(
      findSalesforceRecordIds(
        "foo_001D000000IqhSL 001D000000IqhSL-x 001D000000IqhSLIAZZ e2d1b73eb3f0a9c4d5e6f7a8b9c0d1e2f3a4b5c6",
      ),
    ).toEqual([]);
  });
});

describe("rehypeSalesforceRecordIds", () => {
  const text = (value: string) => ({ type: "text" as const, value });
  const element = (tagName: string, children: Element["children"]): Element => ({
    type: "element",
    tagName,
    properties: {},
    children,
  });

  it("wraps IDs in prose and whole inline code, and leaves code blocks and links alone", () => {
    const inlineCode = element("code", [text("001D000000IqhSLIAZ")]);
    const tree: Root = {
      type: "root",
      children: [
        element("p", [
          text("Open 001D000000IqhSL now"),
          inlineCode,
          element("code", [text("id 001D000000IqhSL")]),
          element("a", [text("001D000000IqhSL")]),
        ]),
        element("pre", [element("code", [text("001D000000IqhSL")])]),
      ],
    };
    rehypeSalesforceRecordIds()(tree);

    const [paragraph, pre] = tree.children as Element[];
    const recordId = (id: string, children: Element["children"]): Element => ({
      ...element("salesforce-record-id", children),
      properties: { dataRecordId: id },
    });
    expect(paragraph!.children).toEqual([
      text("Open "),
      recordId("001D000000IqhSL", [text("001D000000IqhSL")]),
      text(" now"),
      recordId("001D000000IqhSLIAZ", [inlineCode]),
      element("code", [text("id 001D000000IqhSL")]),
      element("a", [text("001D000000IqhSL")]),
    ]);
    expect(pre).toEqual(element("pre", [element("code", [text("001D000000IqhSL")])]));
  });
});
