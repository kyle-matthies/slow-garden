import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = JSON.parse(await readFile(new URL("./v1/domain.schema.json", import.meta.url), "utf8"));
const fixture = JSON.parse(await readFile(new URL("./v1/fixtures/local-return.json", import.meta.url), "utf8"));

function validateLocalReturn(value) {
  const gardenStatuses = schema.$defs.garden.properties.status.enum;
  const passStatuses = schema.$defs.gardenPass.properties.status.enum;
  const bloomStatuses = schema.$defs.bloom.properties.status.enum;
  assert.ok(gardenStatuses.includes(value.garden.status), "unknown garden status");
  assert.ok(value.pass === null || passStatuses.includes(value.pass.status), "unknown pass status");
  assert.ok(value.blooms.length <= schema.properties.blooms.maxItems, "more than three blooms");
  const gardenID = value.garden.id;
  assert.ok(value.seeds.every((seed) => seed.garden_id === gardenID), "cross-garden seed");
  if (value.pass) {
    assert.equal(value.pass.garden_id, gardenID, "cross-garden pass");
    assert.equal(value.pass.snapshot_items.length, 3, "fixture pass must freeze three revisions");
  }
  const snapshotRevisionIDs = new Set(value.pass?.snapshot_items.map((item) => item.seed_revision_id) ?? []);
  for (const bloom of value.blooms) {
    assert.equal(bloom.garden_id, gardenID, "cross-garden bloom");
    assert.ok(bloomStatuses.includes(bloom.status), "unknown bloom status");
    assert.equal(bloom.evidence.length, 3, "fixture bloom must cite three revisions");
    assert.equal(new Set(bloom.evidence.map((item) => item.seed_revision_id)).size, 3, "duplicate evidence revision");
    assert.ok(bloom.evidence.every((item) => snapshotRevisionIDs.has(item.seed_revision_id)), "evidence not in frozen snapshot");
  }
  assert.ok(value.outbox.every((item) => !Object.hasOwn(item, "text")), "outbox metadata contains source text");
}

validateLocalReturn(fixture);

assert.throws(() => validateLocalReturn({ ...fixture, garden: { ...fixture.garden, status: "unknown" } }), /unknown garden status/);
assert.throws(() => validateLocalReturn({ ...fixture, blooms: [...fixture.blooms, ...fixture.blooms, ...fixture.blooms, ...fixture.blooms] }), /more than three blooms/);

console.log("Contract checks passed: enums, garden boundary, frozen snapshot, exact evidence, max-three blooms, metadata-only outbox");
