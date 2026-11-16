import { describe, expect, it } from "vitest";
import * as rules from "./rules";

const ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

describe("identifiers", () => {
  it("accepts only canonical UUIDs for deletion and export", () => {
    expect(rules.isUuid(ID)).toBe(true);
    expect(rules.isUuid(ID.toUpperCase())).toBe(true);
    for (const bad of ["", "1 or 1=1", ID.slice(1), `${ID} `, "------------------------------------", null, 7])
      expect(rules.isUuid(bad), String(bad)).toBe(false);
  });
  it("keeps the looser 36-character shape the history route accepts", () => {
    expect(rules.isLooseUuid(ID)).toBe(true);
    expect(rules.isLooseUuid("------------------------------------")).toBe(true);
    expect(rules.isLooseUuid("not-an-entry")).toBe(false);
    expect(rules.isLooseUuid(undefined)).toBe(false);
  });
  it("dedupes, filters and caps revision lookups at 200", () => {
    const many = Array.from({ length: 250 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    expect(rules.revisionLookupIds([ID, ID, "junk"])).toEqual([ID]);
    expect(rules.revisionLookupIds(many)).toHaveLength(200);
    expect(rules.revisionLookupIds([])).toEqual([]);
  });
});

describe("areas and archiving", () => {
  it("maps each kind to its table", () => {
    expect(rules.areaTable("garden")).toBe("gardens");
    expect(rules.areaTable("plot")).toBe("plots");
    expect(rules.areaTable("seed")).toBe("seeds");
    expect(rules.archivableTable("entry")).toBe("entries");
    expect(rules.archivableTable("seed")).toBe("seeds");
  });
  it("sets status with the timestamp for gardens and thoughts only", () => {
    const now = new Date("2026-11-16T12:00:00.000Z");
    expect(rules.archivePatch("garden", true, now)).toEqual({ status: "archived", archived_at: now.toISOString() });
    expect(rules.archivePatch("seed", false, now)).toEqual({ status: "active", archived_at: null });
    expect(rules.archivePatch("plot", true, now)).toEqual({ archived_at: now.toISOString() });
    expect(rules.archivePatch("entry", false, now)).toEqual({ archived_at: null });
  });
});

describe("session and returns", () => {
  it("allows only local or global sign-out", () => {
    expect(() => rules.assertSignOutScope("local")).not.toThrow();
    expect(() => rules.assertSignOutScope("global")).not.toThrow();
    for (const bad of ["others", "", undefined, null])
      expect(() => rules.assertSignOutScope(bad)).toThrow("Invalid sign-out scope");
  });
  it("allows only keep or prune for a mark", () => {
    expect(rules.validateMarkResponse("keep")).toBeNull();
    expect(rules.validateMarkResponse("prune")).toBeNull();
    expect(rules.validateMarkResponse("correct")).toBe("Choose keep or prune.");
    expect(rules.validateMarkResponse(undefined)).toBe("Choose keep or prune.");
  });
  it("stores a correction only with a correct response", () => {
    expect(rules.bloomCorrection("correct", "mine")).toBe("mine");
    expect(rules.bloomCorrection("keep", "mine")).toBeNull();
    expect(rules.bloomCorrection("prune", "mine")).toBeNull();
  });
  it("distinguishes the gate refusal from a scope refusal", () => {
    expect(rules.passRequestRefusal({ code: "55000" })).toMatchObject({ ok: false, message: expect.stringMatching(/already pending/) });
    for (const error of [{ code: "42501" }, { code: "22023" }, {}, null])
      expect(rules.passRequestRefusal(error)).toEqual({
        ok: false,
        message: "Check the selected topics and their tending settings before retrying.",
      });
  });
});

describe("deletion", () => {
  it("accepts an account preview without an id and nothing else without one", () => {
    expect(rules.isPreviewTarget("account", "")).toBe(true);
    expect(rules.isPreviewTarget("entry", ID)).toBe(true);
    expect(rules.isPreviewTarget("entry", "")).toBe(false);
    expect(rules.isPreviewTarget("everything", ID)).toBe(false);
  });
  it("never accepts the account scope for item deletion", () => {
    for (const kind of ["entry", "seed", "plot", "garden"]) expect(rules.isDeleteItemTarget(kind, ID)).toBe(true);
    expect(rules.isDeleteItemTarget("account", ID)).toBe(false);
    expect(rules.isDeleteItemTarget("entry", "1 or 1=1")).toBe(false);
    expect(rules.isDeleteItemTarget(undefined, ID)).toBe(false);
  });
  it("reads counts defensively", () => {
    expect(rules.deletionCounts(null)).toBeNull();
    expect(rules.deletionCounts("x")).toBeNull();
    expect(rules.deletionCounts({ entries: 2, versions: "3", extra: 9 })).toEqual({
      gardens: 0, topics: 0, thoughts: 0, entries: 2, versions: 0, returns: 0, responses: 0, marks: 0,
    });
  });
  it("maps database errors to plain refusals", () => {
    expect(rules.deletionMissing({ code: "PGRST202" })).toBe(true);
    expect(rules.deletionMissing({ code: "42883" })).toBe(true);
    expect(rules.deletionMissing({ code: "42501" })).toBe(false);
    expect(rules.deletionFailure({ code: "PGRST202" })).toEqual({ ok: false, message: rules.DELETION_UNAVAILABLE });
    expect(rules.deletionFailure({ code: "22023" })).toMatchObject({ message: expect.stringMatching(/does not match/) });
    expect(rules.deletionFailure({ code: "40P01" })).toMatchObject({ message: expect.stringMatching(/busy/) });
    expect(rules.deletionFailure({ code: "55P03" })).toMatchObject({ message: expect.stringMatching(/busy/) });
    expect(rules.deletionFailure({})).toEqual({ ok: false, message: rules.DELETION_FAILED });
    expect(rules.deletionPreviewFailure({ code: "42883" })).toEqual({ ok: false, message: rules.DELETION_UNAVAILABLE });
    expect(rules.deletionPreviewFailure({ code: "57014" })).toEqual({ ok: false, message: rules.DELETION_COUNT_FAILED });
  });
  it("asks for a fresh sign-in only on the database's own signal", () => {
    expect(rules.accountDeletionFailure({ code: "SGA01" })).toMatchObject({ ok: false, reauth: true });
    expect(rules.accountDeletionFailure({ code: "22023" })).toEqual({
      ok: false,
      message: "What you typed does not match. Nothing was erased.",
    });
    expect(rules.accountDeletionFailure({ code: "55000" })).toEqual({ ok: false, message: rules.DELETION_FAILED });
    expect(rules.accountDeletionFailure({ code: "55000" })).not.toHaveProperty("reauth");
  });
  it("derives the phrase to type and the preview arguments", () => {
    expect(rules.accountConfirmPhrase(" ada@example.test ")).toBe("ada@example.test");
    expect(rules.accountConfirmPhrase("")).toBe("delete my account");
    expect(rules.accountConfirmPhrase(undefined)).toBe("delete my account");
    expect(rules.deletionPreviewArgs("account", "ignored")).toEqual({ p_kind: "account" });
    expect(rules.deletionPreviewArgs("plot", ID)).toEqual({ p_kind: "plot", p_id: ID });
  });
});

describe("export", () => {
  it("treats only an absent relation as optional", () => {
    expect(rules.isAbsentRelation({ code: "PGRST205" })).toBe(true);
    expect(rules.isAbsentRelation({ code: "42P01" })).toBe(true);
    for (const error of [{ code: "42501" }, { code: "57014" }, {}, null]) expect(rules.isAbsentRelation(error)).toBe(false);
  });
  it("names the content type per format", () => {
    expect(rules.exportMimeType("md")).toBe("text/markdown; charset=utf-8");
    expect(rules.exportMimeType("json")).toBe("application/json");
  });
});
