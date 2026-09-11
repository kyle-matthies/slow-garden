import { test } from "node:test";
import assert from "node:assert/strict";
import { runImport } from "./import-core.ts";

const TENANT = "cccccccc-cccc-8ccc-8ccc-cccccccccccc";
const PLOT = "33333333-3333-8333-8333-333333333333";

function fakeDb({ archived = false } = {}) {
  const seeds = new Map();
  const entries = new Map();
  const revisions = new Map();
  const db = {
    seeds,
    entries,
    revisions,
    failNextSetEntryDate: false,
    async readPlot() {
      return {
        garden_id: "11111111-1111-8111-8111-111111111111",
        archived_at: archived ? "2024-01-01T00:00:00.000Z" : null,
      };
    },
    async seedExists(id) {
      return seeds.has(id);
    },
    async insertSeed(row) {
      seeds.set(row.id, row);
    },
    async revisionExists(id) {
      return revisions.has(id);
    },
    async saveEntry({ entryId, revisionId, body }) {
      if (!entries.has(entryId))
        entries.set(entryId, { id: entryId, created_at: "IMPORT_TIME" });
      if (!revisions.has(revisionId)) revisions.set(revisionId, body);
    },
    async setEntryDate(entryId, createdAt) {
      if (db.failNextSetEntryDate) {
        db.failNextSetEntryDate = false;
        throw new Error("date update failed");
      }
      entries.get(entryId).created_at = createdAt;
    },
  };
  return db;
}

test("a failed date stamp is re-applied on retry", async () => {
  const db = fakeDb();
  const input = {
    plotId: PLOT,
    title: "Imported",
    entries: [{ body: "First day.", date: "2024-03-05" }],
  };
  db.failNextSetEntryDate = true;
  await assert.rejects(runImport(db, TENANT, input));
  const retry = await runImport(db, TENANT, input);
  assert.deepEqual(retry, {
    ok: true,
    id: retry.id,
    created: 0,
    skipped: 1,
  });
  assert.equal(db.entries.size, 1);
  assert.equal(db.revisions.size, 1);
  assert.equal(
    [...db.entries.values()][0].created_at,
    "2024-03-05T12:00:00.000Z",
  );
});

test("happy path creates and replay skips", async () => {
  const db = fakeDb();
  const input = {
    plotId: PLOT,
    title: "Imported",
    entries: [
      { body: "Day one.", date: "2024-03-05" },
      { body: "Day two.", date: null },
    ],
  };
  const first = await runImport(db, TENANT, input);
  assert.equal(first.ok, true);
  assert.equal(first.created, 2);
  assert.equal(first.skipped, 0);
  const second = await runImport(db, TENANT, input);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 2);
  assert.equal(db.entries.size, 2);
  assert.equal(db.revisions.size, 2);
});

test("archived plot rejects before writing", async () => {
  const db = fakeDb({ archived: true });
  const result = await runImport(db, TENANT, {
    plotId: PLOT,
    title: "Imported",
    entries: [{ body: "Text.", date: null }],
  });
  assert.deepEqual(result, { ok: false, message: "Choose an active topic." });
  assert.equal(db.seeds.size, 0);
});

test("impossible date is rejected", async () => {
  const db = fakeDb();
  const result = await runImport(db, TENANT, {
    plotId: PLOT,
    title: "Imported",
    entries: [{ body: "Text.", date: "2026-02-30" }],
  });
  assert.equal(result.ok, false);
  assert.equal(db.seeds.size, 0);
});
