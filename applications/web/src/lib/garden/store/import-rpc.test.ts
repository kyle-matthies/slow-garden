import { describe, expect, it } from "vitest";
import { importThoughtWith } from "./import-rpc";
import type { Db } from "./queries";
import * as rules from "./rules";

const TENANT = "00000000-0000-4000-8000-000000000001";
const input = {
  plotId: "00000000-0000-4000-8000-000000000002",
  title: "A thought",
  entries: [{ body: "One line.", date: null }],
};

/** A database whose import call answers with the given error. */
function dbAnswering(error: unknown): Db {
  return { rpc: async () => ({ data: null, error }) } as unknown as Db;
}

const neverLegacy = async () => {
  throw new Error("the legacy path must not run");
};

describe("import outcome when the call fails", () => {
  it("says nothing was saved only when the database reported the refusal", async () => {
    const result = await importThoughtWith(
      dbAnswering({ code: "23514", message: "check violation" }),
      TENANT,
      input,
      neverLegacy,
    );
    expect(result).toEqual({ ok: false, message: rules.IMPORT_NOT_SAVED });
  });

  it("is uncertain when the error carries no code, as a dropped response does", async () => {
    for (const error of [
      { code: "", message: "TypeError: fetch failed" },
      { message: "network error" },
      {},
    ]) {
      const result = await importThoughtWith(dbAnswering(error), TENANT, input, neverLegacy);
      expect(result, JSON.stringify(error)).toEqual({
        ok: false,
        message: rules.IMPORT_UNCERTAIN,
      });
    }
  });
});
