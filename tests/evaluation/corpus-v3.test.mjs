import test from "node:test";
import assert from "node:assert/strict";
import { evaluateV3 } from "../../services/garden-worker/evaluation/evaluate-v3.mjs";
import { corpusV3, requiredV3Families } from "../../services/garden-worker/evaluation/corpus-v3.mjs";

test("tend-connect-v3 packet is complete and internally consistent", () => {
  const report = evaluateV3();
  for (const r of report.cases) assert.deepEqual(r.problems, [], r.id);
  assert.deepEqual(report.integrity, []);
  for (const c of report.coverage) assert.ok(c.ok, `${c.family}: ${c.actual}/${c.required}`);
  assert.equal(report.ok, true);
});

test("every family has negative fixtures, and human-review-only cases are named", () => {
  const report = evaluateV3();
  for (const family of Object.keys(requiredV3Families))
    assert.ok(
      corpusV3.filter((c) => c.family === family).every((c) => c.rejected.length > 0),
      family,
    );
  assert.ok(report.totals.validator_refusals >= 20);
  assert.ok(report.human_review_fixtures.every((line) => line.includes(":")));
});

test("corpus is synthetic: no email addresses, URLs or phone-like numbers", () => {
  const text = JSON.stringify(corpusV3);
  assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]/i);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /\b\d{3}[- ]?\d{3}[- ]?\d{4}\b/);
});
