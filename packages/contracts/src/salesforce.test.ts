import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { SalesforceMutation } from "./salesforce.ts";

const decodeMutation = Schema.decodeUnknownExit(SalesforceMutation);
const open = (recordId: string) => ({ type: "open", cwd: "/repo", target: "DEV", recordId });

describe("SalesforceMutation open", () => {
  it("accepts 15- and 18-character record IDs", () => {
    expect(decodeMutation(open("001D000000IqhSL"))._tag).toBe("Success");
    expect(decodeMutation(open("001D000000IqhSLIAZ"))._tag).toBe("Success");
  });

  // The ID becomes `--path /<id>` on the sf command line.
  it("rejects anything that could act as another CLI argument or path", () => {
    for (const recordId of ["--url-only", "001D000000IqhSL --json", "../setup/home", "001D00"]) {
      expect(decodeMutation(open(recordId))._tag).toBe("Failure");
    }
  });
});
