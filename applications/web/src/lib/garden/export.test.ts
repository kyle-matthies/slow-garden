import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExportDocument,
  exportFilename,
  filterSnapshotByGarden,
  formatExportMarkdown,
  type ExportSnapshot,
  // @ts-expect-error node --test strips types and needs the explicit extension
} from "./export.ts";
// @ts-expect-error node --test strips types and needs the explicit extension
import { parseImportFile } from "./import.ts";

const G1 = "11111111-1111-8111-8111-111111111111";
const G2 = "22222222-2222-8222-8222-222222222222";
const P1 = "33333333-3333-8333-8333-333333333333";
const P2 = "44444444-4444-8444-8444-444444444444";
const S1 = "55555555-5555-8555-8555-555555555555";
const E1 = "66666666-6666-8666-8666-666666666666";
const R1 = "77777777-7777-8777-8777-777777777777";
const PASS1 = "88888888-8888-8888-8888-888888888888";
const B1 = "99999999-9999-8999-8999-999999999999";
const B2 = "aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa";
const RESP1 = "bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb";
const TENANT = "cccccccc-cccc-8ccc-8ccc-cccccccccccc";

function fixture(): ExportSnapshot {
  return {
    exported_at: "2024-06-01T00:00:00.000Z",
    gardens: [
      {
        id: G1,
        tenant_id: TENANT,
        name: "First garden",
        status: "active",
        archived_at: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
      },
      {
        id: G2,
        tenant_id: TENANT,
        name: "Second garden",
        status: "active",
        archived_at: null,
        created_at: "2024-01-02T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
      },
    ],
    plots: [
      {
        id: P1,
        tenant_id: TENANT,
        garden_id: G1,
        name: "Topic one",
        ai_enabled: true,
        cross_pollinate: false,
        archived_at: null,
        permission_version: 1,
        created_at: "2024-01-01T00:00:00.000Z",
      },
      {
        id: P2,
        tenant_id: TENANT,
        garden_id: G2,
        name: "Topic two",
        ai_enabled: false,
        cross_pollinate: false,
        archived_at: null,
        permission_version: 1,
        created_at: "2024-01-02T00:00:00.000Z",
      },
    ],
    seeds: [
      {
        id: S1,
        tenant_id: TENANT,
        garden_id: G1,
        plot_id: P1,
        title: "A kept thought",
        status: "active",
        archived_at: null,
        position_x: 0,
        position_y: 0,
        created_at: "2024-02-01T00:00:00.000Z",
        updated_at: "2024-02-01T00:00:00.000Z",
      },
    ],
    entries: [
      {
        id: E1,
        tenant_id: TENANT,
        garden_id: G1,
        seed_id: S1,
        archived_at: null,
        created_at: "2024-03-05T12:00:00.000Z",
      },
    ],
    revisions: [
      {
        id: R1,
        tenant_id: TENANT,
        garden_id: G1,
        seed_id: S1,
        entry_id: E1,
        body: "The revision body.",
        revision_number: 1,
        created_by: "user",
        created_at: "2024-03-05T12:00:00.000Z",
      },
    ],
    passes: [
      {
        id: PASS1,
        tenant_id: TENANT,
        garden_id: G1,
        plot_ids: [P1],
        status: "finished",
        finished_at: "2024-04-01T00:00:00.000Z",
        no_output_reason: null,
        created_at: "2024-04-01T00:00:00.000Z",
      },
    ],
    blooms: [
      {
        id: B1,
        tenant_id: TENANT,
        garden_id: G1,
        pass_id: PASS1,
        ordinal: 1,
        kind: "pattern",
        interpretation: "A recurring theme appears.",
        evidence: [{ revision_id: R1 }],
        created_at: "2024-04-01T00:01:00.000Z",
      },
      {
        id: B2,
        tenant_id: TENANT,
        garden_id: G2,
        pass_id: PASS1,
        ordinal: 2,
        kind: "question",
        interpretation: "An open question from another garden.",
        evidence: [],
        created_at: "2024-04-01T00:02:00.000Z",
      },
    ],
    responses: [
      {
        id: RESP1,
        tenant_id: TENANT,
        bloom_id: B1,
        response: "correct",
        correction: "It is not a theme; it is a worry.",
        created_at: "2024-04-02T00:00:00.000Z",
      },
      {
        id: "dddddddd-dddd-8ddd-8ddd-dddddddddddd",
        tenant_id: TENANT,
        bloom_id: B2,
        response: "keep",
        correction: null,
        created_at: "2024-04-02T00:01:00.000Z",
      },
    ],
  };
}

test("buildExportDocument keeps blooms under derived with authorship", () => {
  const doc = buildExportDocument(fixture());
  assert.equal(doc.schema, "slow-garden-export-v2");
  assert.equal(doc.source.authorship, "user");
  assert.equal(doc.derived.blooms.authorship, "ai-derived");
  assert.equal(doc.derived.responses.authorship, "user");
  assert.equal(doc.derived.blooms.rows.length, 2);
  assert.ok(!("blooms" in doc.source));
});

test("filterSnapshotByGarden drops other gardens and dangling responses", () => {
  const f = filterSnapshotByGarden(fixture(), G1);
  assert.deepEqual(
    f.gardens.map((g) => g.id),
    [G1],
  );
  assert.deepEqual(
    f.plots.map((p) => p.id),
    [P1],
  );
  assert.equal(f.blooms.length, 1);
  assert.deepEqual(
    f.responses.map((r) => r.bloom_id),
    [B1],
  );
  assert.equal(f.revisions.length, 1);
});

test("JSON round trip preserves the document", () => {
  const f = fixture();
  const doc = buildExportDocument(f);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
  assert.deepEqual(doc.source.revisions, f.revisions);
});

test("markdown labels derived material after source sections", () => {
  const md = formatExportMarkdown(fixture());
  const source = md.lastIndexOf("##### Entry");
  const derived = md.indexOf("## Derived material (AI)");
  assert.ok(source > 0 && derived > source);
  assert.match(md, /#### Bloom 1 · pattern · AI-derived/);
  assert.match(md, /Response · correct · 2024-04-02T00:00:00\.000Z/);
  assert.match(
    md,
    /Correction \(author\): It is not a theme; it is a worry\./,
  );
});

test("markdown without passes says there is no derived material", () => {
  const f = { ...fixture(), passes: [], blooms: [], responses: [] };
  assert.match(formatExportMarkdown(f), /No derived material\./);
});

test("exportFilename slugifies garden names", () => {
  assert.equal(exportFilename("json"), "slow-garden-export.json");
  assert.equal(
    exportFilename("md", "First Garden!"),
    "slow-garden-export-first-garden.md",
  );
});

test("exported markdown of a thought re-imports with the same text", async () => {
  const f = fixture();
  const seed = f.seeds[0];
  const md = `# ${seed.title}\n\n## 2024-03-05\n${f.revisions[0].body}`;
  const thought = await parseImportFile({ name: "export.md", text: md });
  assert.equal(thought.title, seed.title);
  assert.equal(thought.entries.length, 1);
  assert.equal(thought.entries[0].date, "2024-03-05");
  assert.equal(thought.entries[0].body, f.revisions[0].body);
});
