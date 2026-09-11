import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, mkdir, mkdtemp } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  corpus,
  requiredFamilies,
  requiredFixtures,
} from "../../services/garden-worker/evaluation/corpus.mjs";
import { evaluateCorpus } from "../../services/garden-worker/evaluation/evaluate.mjs";
import { buildPacket } from "../../services/garden-worker/evaluation/prepare.mjs";
import { validateReturn } from "../../supabase/functions/_shared/garden-runtime.mjs";

const root = resolve(import.meta.dirname, "../..");
const report = evaluateCorpus(corpus);

test("packet is valid with exactly 48 cases", () => {
  assert.equal(report.status, "packet-valid", report.problems.join("\n"));
  assert.equal(corpus.length, 48);
  assert.deepEqual(report.problems, []);
  assert.equal(
    Object.values(requiredFamilies).reduce((a, b) => a + b, 0),
    48,
  );
});

test("every required family is covered at its required count", () => {
  for (const [family, required] of Object.entries(requiredFamilies))
    assert.equal(report.families[family].actual, required, family);
});

test("supersession, cross-plot exclusion, correction-history and injection fixtures exist", () => {
  for (const [key, required] of Object.entries(requiredFixtures))
    assert.ok(report.fixtures[key].actual >= required, `${key} ${report.fixtures[key].actual} < ${required}`);
  assert.ok(corpus.some((c) => c.corrections.length >= 2), "a multi-round correction history");
  assert.ok(
    corpus.some((c) => c.superseded_revisions.length >= 2),
    "an entry revised more than once",
  );
  assert.equal(corpus.filter((c) => c.family === "injection").length, 8);
  assert.ok(
    corpus.some((c) => c.family === "injection" && c.excluded_sources.length),
    "an injection case that tries to exfiltrate another plot",
  );
});

test("cases are distinct: unique ids and no source body reused across cases", () => {
  const ids = new Set(corpus.map((c) => c.id));
  assert.equal(ids.size, corpus.length);
  const owners = new Map();
  for (const c of corpus)
    for (const s of c.sources) {
      const key = s.body.toLowerCase().replace(/\s+/g, " ").trim();
      assert.ok(!owners.has(key) || owners.get(key) === c.id, `${c.id} reuses body from ${owners.get(key)}`);
      owners.set(key, c.id);
    }
});

test("reference returns cite exact excerpts of in-scope revisions only", () => {
  for (const c of corpus) {
    assert.doesNotThrow(() => validateReturn(c.reference_return, c.sources), c.id);
    const bodies = new Map(c.sources.map((s) => [s.revision_id, s.body]));
    for (const b of c.reference_return.blooms) {
      assert.ok(b.evidence.length >= 1);
      for (const e of b.evidence)
        assert.ok(bodies.get(e.revision_id)?.includes(e.excerpt), `${c.id}: ${e.excerpt}`);
    }
    assert.ok(c.reference_return.blooms.length <= 3);
    if (c.expected_output === "none") assert.equal(c.reference_return.blooms.length, 0);
    if (c.expected_output === "bloom") assert.ok(c.reference_return.blooms.length > 0);
  }
});

test("superseded and excluded revisions are outside the snapshot and refused as evidence", () => {
  for (const c of corpus) {
    const snapshot = new Set(c.sources.map((s) => s.revision_id));
    for (const r of c.superseded_revisions) {
      assert.ok(!snapshot.has(r.revision_id));
      assert.ok(snapshot.has(r.superseded_by), `${c.id}: ${r.superseded_by}`);
    }
    for (const x of c.excluded_sources) {
      assert.ok(!snapshot.has(x.revision_id));
      assert.notEqual(x.plot_id, c.plot_id);
    }
    for (const rejected of c.rejected_returns)
      assert.throws(() => validateReturn(rejected, c.sources), c.id);
  }
});

test("corrections are ordered feedback about in-scope revisions", () => {
  for (const c of corpus) {
    let prev = "";
    for (const k of c.corrections) {
      assert.ok(k.created_at >= prev, c.id);
      prev = k.created_at;
      assert.ok(["correct", "coincidence"].includes(k.action));
      assert.ok(k.disputed_interpretation && k.note);
      for (const id of k.revision_ids)
        assert.ok(c.sources.some((s) => s.revision_id === id), `${c.id}: ${id}`);
    }
  }
});

test("report and packet are deterministic in-process", () => {
  assert.deepEqual(evaluateCorpus(corpus), report);
  assert.deepEqual(buildPacket(corpus), buildPacket(corpus));
  assert.match(report.corpus_sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.evidence_excerpts > 0, true);
});

test("evaluator flags a corrupted packet", () => {
  const broken = structuredClone(corpus);
  broken[7].reference_return.blooms[0].evidence[0].excerpt = "not in the source";
  broken[1].sources[0].body = broken[0].sources[0].body;
  broken.pop();
  const r = evaluateCorpus(broken);
  assert.equal(r.status, "packet-invalid");
  assert.ok(r.problems.some((p) => p.includes("reference_return_invalid:invalid_evidence")));
  assert.ok(r.problems.some((p) => p.includes("body_reused_from")));
  assert.notEqual(r.corpus_sha256, report.corpus_sha256);
});

test("evaluator reports structurally malformed cases instead of throwing", () => {
  const broken = structuredClone(corpus);
  delete broken[2].reference_return.blooms;
  broken[3].sources = null;
  broken[4].corrections = [{ id: "k", created_at: "2026-01-01" }];
  broken[5].sources[0] = { revision_id: "r", plot_id: broken[5].plot_id };
  const r = evaluateCorpus([...broken, { id: "", family: "nope" }]);
  assert.equal(r.status, "packet-invalid");
  for (const marker of [
    "reference_return_invalid",
    "malformed_field:sources",
    "malformed_correction",
    "malformed_source",
    "missing_case_id",
    "unknown_family",
  ])
    assert.ok(r.problems.some((p) => p.includes(marker)), marker);
});

test("evaluator reports null cases and null sources instead of throwing", () => {
  const nullCase = evaluateCorpus([null]);
  assert.equal(nullCase.status, "packet-invalid");
  assert.ok(nullCase.problems.some((p) => p.includes("malformed_case")));

  const withNullSource = structuredClone(corpus[6]);
  withNullSource.sources = [null, ...withNullSource.sources];
  withNullSource.superseded_revisions = [null];
  withNullSource.excluded_sources = [null];
  const r = evaluateCorpus([withNullSource]);
  assert.equal(r.status, "packet-invalid");
  for (const marker of [
    "malformed_source",
    "malformed_superseded_revision",
    "malformed_excluded_source",
  ])
    assert.ok(r.problems.some((p) => p.includes(marker)), marker);
  assert.equal(r.results[0].reference_valid, true);

  assert.equal(evaluateCorpus(null).status, "packet-invalid");
});

test("prepare.mjs output is byte-stable across two separate runs", async () => {
  const run = promisify(execFile);
  const dirs = [];
  try {
    await mkdir(resolve(root, "artifacts/generated"), { recursive: true });
    for (let i = 0; i < 2; i++) {
      const dir = await mkdtemp(resolve(root, "artifacts/generated/eval-test-"));
      dirs.push(dir);
      const { stdout } = await run(
        process.execPath,
        ["services/garden-worker/evaluation/prepare.mjs", relative(root, dir)],
        { cwd: root },
      );
      assert.equal(JSON.parse(stdout).status, "packet-valid");
    }
    for (const name of ["manifest.json", "report.json", "cases.jsonl", "review.csv"]) {
      const [a, b] = await Promise.all(dirs.map((d) => readFile(`${d}/${name}`)));
      assert.ok(a.equals(b), `${name} differs between runs`);
      assert.ok(a.length > 0);
    }
    const manifest = JSON.parse(await readFile(`${dirs[0]}/manifest.json`, "utf8"));
    assert.equal(manifest.cases, 48);
    assert.equal(manifest.corpus_sha256, report.corpus_sha256);
    assert.equal(manifest.thresholds.source, "documents/architecture/EVALUATION_ARCHITECTURE.md");
    const lines = (await readFile(`${dirs[0]}/review.csv`, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1 + 48 * manifest.baselines.length);
  } finally {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  }
});

test("no source body resembles a real identifier or contact", () => {
  for (const c of corpus)
    for (const s of [...c.sources, ...c.superseded_revisions, ...c.excluded_sources]) {
      assert.doesNotMatch(s.body, /@(?!example\.test)[\w.-]+\.\w+/, c.id);
      assert.doesNotMatch(s.body, /\bhttps?:\/\//, c.id);
    }
});
