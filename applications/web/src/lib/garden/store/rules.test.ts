import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateAreaName,
  validateBloomResponse,
  validateEntryBody,
} from "../validation";
import { validateImportInput } from "@/app/garden/import/import-core";
import * as rules from "./rules";

const MIGRATION = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20261116041903_browser_path_rules.sql"),
  "utf8",
);

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

describe("blank text and length: the same definition on the server path and in the database", () => {
  const blank = new Set(Array.from(rules.BLANK_CHARACTERS, (c) => c.codePointAt(0)!));

  it("lists exactly the characters trim() removes, for every code point", () => {
    expect(blank.size).toBe(25);
    const disagree: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const trimmed = String.fromCodePoint(cp).trim() === "";
      if (trimmed !== blank.has(cp)) disagree.push(cp.toString(16));
    }
    expect(disagree).toEqual([]);
  });

  it("matches the literal in private.trim_text", () => {
    const literal = /select btrim\(v, E'([^']+)'\);/.exec(MIGRATION)?.[1] ?? "";
    const sql = Array.from(literal.matchAll(/\\u([0-9A-Fa-f]{4})/g), (m) => parseInt(m[1], 16));
    expect(literal.replace(/\\u[0-9A-Fa-f]{4}/g, "")).toBe("");
    expect(sql.sort((a, b) => a - b)).toEqual(Array.from(blank).sort((a, b) => a - b));
  });

  it("treats the edge characters the way the validation rules do", () => {
    for (const ws of ["", " ", "\t\n", "\u00A0", "\u202F", "\uFEFF", "\u3000\u2028", rules.BLANK_CHARACTERS]) {
      expect(rules.isBlank(ws), JSON.stringify(ws)).toBe(true);
      expect(validateAreaName("garden", ws)).not.toBeNull();
      expect(validateEntryBody(ws)).not.toBeNull();
      expect(validateBloomResponse("correct", ws)).not.toBeNull();
    }
    for (const kept of ["\u200B", "\u200C", "\u200D", "\u2060", "\u180E", "\u0085", "\u001C"]) {
      expect(rules.isBlank(kept), JSON.stringify(kept)).toBe(false);
      expect(validateAreaName("garden", kept)).toBeNull();
      expect(validateEntryBody(kept)).toBeNull();
      expect(validateBloomResponse("correct", kept)).toBeNull();
    }
  });

  it("holds the limits the validation rules enforce, in UTF-16 units", () => {
    const at = (n: number) => "a".repeat(n);
    expect(validateAreaName("garden", at(rules.TEXT_LIMITS.gardenName))).toBeNull();
    expect(validateAreaName("garden", at(rules.TEXT_LIMITS.gardenName + 1))).not.toBeNull();
    expect(validateAreaName("plot", at(rules.TEXT_LIMITS.topicName))).toBeNull();
    expect(validateAreaName("plot", at(rules.TEXT_LIMITS.topicName + 1))).not.toBeNull();
    expect(validateAreaName("seed", at(rules.TEXT_LIMITS.thoughtTitle))).toBeNull();
    expect(validateAreaName("seed", at(rules.TEXT_LIMITS.thoughtTitle + 1))).not.toBeNull();
    expect(validateEntryBody(at(rules.TEXT_LIMITS.entryBody))).toBeNull();
    expect(validateEntryBody(at(rules.TEXT_LIMITS.entryBody + 1))).not.toBeNull();
    // An emoji is two units: 60 fit in a 120-unit name, 61 do not.
    expect(validateAreaName("garden", "\u{1F331}".repeat(60))).toBeNull();
    expect(validateAreaName("garden", "\u{1F331}".repeat(61))).not.toBeNull();
  });

  it("states the same numbers as the migration", () => {
    expect(MIGRATION).toContain(`private.utf16_length(name)<=${rules.TEXT_LIMITS.gardenName}) not valid`);
    expect(MIGRATION).toContain(`private.utf16_length(title)<=${rules.TEXT_LIMITS.thoughtTitle}) not valid`);
    expect(MIGRATION).toContain(`private.utf16_length(body)<=${rules.TEXT_LIMITS.entryBody}) not valid`);
    expect(MIGRATION).toContain(`char_length(timezone)<=${rules.TEXT_LIMITS.timezone}`);
    expect(MIGRATION).toContain(`jsonb_array_length(p_entries) not between 1 and ${rules.IMPORT_MAX_ENTRIES}`);
    expect(MIGRATION).toContain(`octet_length(p_title)>${rules.IMPORT_MAX_BYTES}`);
    expect(MIGRATION).toContain(`errcode='${rules.TOPIC_UNAVAILABLE}'`);
    expect(MIGRATION).toContain(`errcode='${rules.DELETION_SWITCHED_OFF}'`);
  });
});

describe("capabilities", () => {
  it("enables only on a literal true", () => {
    expect(rules.gardenCapabilities({ tending: true, deletion: true })).toEqual({ tending: true, deletion: true });
    expect(rules.gardenCapabilities({ tending: "true", deletion: 1 })).toEqual({ tending: false, deletion: false });
    for (const odd of [null, undefined, "x", 7, [], {}])
      expect(rules.gardenCapabilities(odd)).toEqual({ tending: false, deletion: false });
  });

  it("combines flags and database switches: both must allow", () => {
    const on = { aiAvailable: true, deletionAvailable: true };
    const off = rules.NOTHING_AVAILABLE;
    const yes = { tending: true, deletion: true };
    const no = { tending: false, deletion: false };
    expect(rules.availability(on, yes)).toEqual(on);
    expect(rules.availability(on, no)).toEqual(off);
    expect(rules.availability(off, yes)).toEqual(off);
    expect(rules.availability(on, { tending: true, deletion: false })).toEqual({ aiAvailable: true, deletionAvailable: false });
    expect(rules.availability({ aiAvailable: false, deletionAvailable: true }, yes)).toEqual({ aiAvailable: false, deletionAvailable: true });
    // No flags supplied: the database decides alone.
    expect(rules.availability(undefined, yes)).toEqual(on);
    expect(rules.availability(undefined, no)).toEqual(off);
    // A database without the RPC: flags as before; with none, nothing.
    expect(rules.availability(on, null)).toEqual(on);
    expect(rules.availability(off, null)).toEqual(off);
    expect(rules.availability(undefined, null)).toEqual(off);
  });

  it("recognises a missing function and the deletion switch", () => {
    expect(rules.rpcMissing({ code: "PGRST202" })).toBe(true);
    expect(rules.rpcMissing({ code: "42883" })).toBe(true);
    expect(rules.rpcMissing({ code: "SGA03" })).toBe(false);
    expect(rules.deletionMissing({ code: "SGA03" })).toBe(true);
    expect(rules.deletionMissing({ code: "PGRST202" })).toBe(true);
    expect(rules.deletionMissing({ code: "22023" })).toBe(false);
    expect(rules.deletionFailure({ code: "SGA03" })).toEqual({ ok: false, message: rules.DELETION_UNAVAILABLE });
    expect(rules.deletionPreviewFailure({ code: "SGA03" })).toEqual({ ok: false, message: rules.DELETION_UNAVAILABLE });
    expect(rules.accountDeletionFailure({ code: "SGA03" })).toEqual({ ok: false, message: rules.DELETION_UNAVAILABLE });
  });
});

describe("import limits", () => {
  it("counts title and bodies in UTF-8 bytes", () => {
    expect(rules.importBytes({ title: "T", entries: [] })).toBe(1);
    expect(rules.importBytes({ title: "", entries: [{ body: "abc" }, { body: "\u4e2d" }, { body: "\u{1F331}" }] })).toBe(10);
  });

  it("keeps the entry cap the import rules enforce", () => {
    const entries = (n: number) => Array.from({ length: n }, () => ({ body: "x", date: null }));
    const input = { plotId: ID, title: "T" };
    expect(validateImportInput({ ...input, entries: entries(rules.IMPORT_MAX_ENTRIES) })).toBeNull();
    expect(validateImportInput({ ...input, entries: entries(rules.IMPORT_MAX_ENTRIES + 1) })).not.toBeNull();
  });

  it("reads an import receipt strictly", () => {
    expect(rules.importReceipt({ id: ID, created: 2, skipped: 1, extra: true })).toEqual({ id: ID, created: 2, skipped: 1 });
    for (const odd of [null, "x", {}, { id: ID }, { id: 7, created: 1, skipped: 0 }, { id: ID, created: "1", skipped: 0 }])
      expect(rules.importReceipt(odd)).toBeNull();
  });
});
