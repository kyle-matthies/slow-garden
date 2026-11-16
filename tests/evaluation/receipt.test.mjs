// Offline self-test of the evaluation receipt tooling (runbook 0.4).
// The "model outputs" are recorded synthetic outputs: the corpus's own
// hand-written reference answers. No model is called and no network is used.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedKinds } from "../../supabase/functions/_shared/garden-runtime.mjs";
import { corpusV3 } from "../../services/garden-worker/evaluation/corpus-v3.mjs";
import {
  buildReceipt,
  currentHashes,
  parseCsv,
  readScores,
  reviewItems,
  reviewSheet,
  thresholds,
  writeReceipt,
} from "../../services/garden-worker/evaluation/receipt.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const recorded = (c) => ({
  case: c.id,
  family: c.family,
  workflow: "tend-connect-v3",
  model: "recorded-synthetic-reference",
  outcome: {
    ok: true,
    stages: { tend: "ok", ...(allowedKinds(c.tiers).length ? { connect: "ok" } : {}) },
    result: { blooms: c.reference.connect?.blooms ?? [], marks: c.reference.tend.marks, no_output_reason: null },
    usage: [800, 120],
  },
});
const outputs = () => corpusV3.map(recorded);
const runFor = async (extra = {}) => ({
  run_id: "self-test",
  started_at: "2026-11-16T00:00:00.000Z",
  owner_approved: true,
  self_test: true,
  provider: "recorded",
  transport: "sync",
  model: "recorded-synthetic-reference",
  reasoning_effort: "low",
  workflow: "tend-connect-v3",
  hashes: await currentHashes(),
  ...extra,
});
const allYes = (items) => new Map(items.map((i) => [i.item_id, { verdict: true, clinical: false }]));
const accepted = { return_format_accepted: true, accepted_by: "self-test", accepted_at: "2026-11-16T00:00:00.000Z", basis: "self-test" };
const find = (receipt, id) => Object.values(receipt.tiers).flatMap((t) => t.thresholds).find((t) => t.id === id);

test("a fresh run produces a complete, content-free receipt that is no-go until scored and accepted", async () => {
  const receipt = await buildReceipt({ run: await runFor({ self_test: false }), outputs: outputs() });
  assert.equal(receipt.verdict, "no-go");
  assert.equal(receipt.run.model_snapshot, "recorded-synthetic-reference");
  assert.equal(receipt.run.reasoning_effort, "low");
  assert.equal(receipt.run.workflow_version, "tend-connect-v3");
  assert.equal(receipt.corpus.cases, corpusV3.length);
  assert.equal(receipt.hashes.current, true);
  for (const key of ["corpus_sha256", "tend_prompt_sha256", "connect_prompt_sha256", "tend_schema_sha256", "connect_schema_sha256", "runtime_sha256"])
    assert.match(receipt.hashes.now[key], /^[0-9a-f]{64}$/, key);
  assert.deepEqual(Object.keys(receipt.tiers), ["all_tiers", "tier_1", "tier_2", "tier_3"]);
  assert.equal(Object.values(receipt.tiers).flatMap((t) => t.thresholds).length, thresholds.length);
  assert.equal(receipt.tiers.all_tiers.status, "pass", "deterministic thresholds pass on the reference outputs");
  assert.equal(find(receipt, "label_faithfulness").status, "awaiting-blind-score");
  assert.equal(find(receipt, "label_faithfulness").value, null, "an unscored slot is empty, never assumed");
  assert.equal(receipt.owner_acceptance.return_format_accepted, null);
  assert.ok(receipt.open.includes("owner acceptance of the small return format not recorded"));
  const text = JSON.stringify(receipt);
  for (const c of corpusV3) for (const s of c.sources) assert.equal(text.includes(s.body), false, "no corpus text");
  for (const c of corpusV3) for (const b of c.reference.connect?.blooms ?? []) assert.equal(text.includes(b.interpretation), false, "no output text");
});

test("blind scores and acceptance fill their slots; a real run would then be go", async () => {
  const lines = outputs();
  const receipt = await buildReceipt({ run: await runFor({ self_test: false }), outputs: lines, scores: allYes(reviewItems(lines)), acceptance: accepted });
  assert.deepEqual(receipt.open, []);
  assert.equal(receipt.verdict, "go");
  assert.equal(find(receipt, "label_faithfulness").value, 1);
  assert.equal(find(receipt, "clinical_labels").value, 0);
  assert.equal(receipt.owner_acceptance.accepted_by, "self-test");
});

test("a self-test run can never be a go", async () => {
  const lines = outputs();
  const receipt = await buildReceipt({ run: await runFor(), outputs: lines, scores: allYes(reviewItems(lines)), acceptance: accepted });
  assert.equal(receipt.kind, "self-test");
  assert.equal(receipt.verdict, "self-test-only");
});

test("failures are reported against the right threshold", async () => {
  const lines = outputs();
  const items = reviewItems(lines);
  const scores = allYes(items);
  // One in four theme labels judged unfaithful, one judged clinical.
  items.filter((i) => i.kind === "theme").forEach((i, n) => {
    if (n % 4 === 0) scores.set(i.item_id, { verdict: false, clinical: n === 0 });
  });
  // The model missed every unfinished thought, dropped a mark, and offered a locked kind.
  for (const line of lines) line.outcome.result.marks = line.outcome.result.marks.filter((m) => m.kind !== "unfinished");
  lines[0].outcome.stages.tend = "ok_dropped_1";
  const locked = lines.find((l) => !allowedKinds(corpusV3.find((c) => c.id === l.case).tiers).length);
  locked.outcome.result.blooms = [{ kind: "pattern", interpretation: "A synthetic locked pattern.", evidence: [] }];
  const receipt = await buildReceipt({ run: await runFor({ self_test: false }), outputs: lines, scores, acceptance: accepted });
  assert.equal(receipt.verdict, "no-go");
  assert.equal(find(receipt, "label_faithfulness").status, "fail");
  assert.equal(find(receipt, "clinical_labels").status, "fail");
  assert.equal(find(receipt, "unfinished_recall").status, "fail");
  assert.equal(find(receipt, "valid_evidence").status, "fail");
  assert.equal(find(receipt, "tier_lock").status, "fail");
  assert.equal(receipt.tiers.tier_1.status, "fail");
});

test("a changed prompt, schema, corpus or runtime makes the receipt stale", async () => {
  const run = await runFor({ self_test: false });
  run.hashes.tend_prompt_sha256 = "0".repeat(64);
  const lines = outputs();
  const receipt = await buildReceipt({ run, outputs: lines, scores: allYes(reviewItems(lines)), acceptance: accepted });
  assert.equal(receipt.hashes.current, false);
  assert.equal(receipt.verdict, "no-go");
  assert.ok(receipt.open[0].includes("tend_prompt_sha256"));
});

test("missing cases and a run that was not owner-approved are open items", async () => {
  const receipt = await buildReceipt({ run: await runFor({ self_test: false, owner_approved: false }), outputs: outputs().slice(0, 5) });
  assert.ok(receipt.open.some((line) => line.includes("corpus case(s) have no output")));
  assert.ok(receipt.open.includes("run was not marked owner-approved"));
});

test("the blind sheet hides case, family and expectation, and survives a round trip", () => {
  const items = reviewItems(outputs());
  const sheet = reviewSheet(items);
  const [header, ...rows] = parseCsv(sheet);
  assert.deepEqual(header, ["item_id", "kind", "returned", "quoted_evidence", "cited_passages", "verdict", "clinical", "notes"]);
  assert.equal(rows.length, items.length);
  for (const c of corpusV3) assert.equal(sheet.includes(c.id), false, "case ids are not shown");
  for (const c of corpusV3) assert.equal(sheet.includes(c.expectation), false, "expectations are not shown");
  const filled = sheet.replace(/,,,\n/g, ",y,n,\n").replace(",y,n,\n", ",n,,\n");
  const scores = readScores(filled);
  assert.equal([...scores.values()].filter((s) => s.verdict === true).length, items.length - 1);
  assert.equal([...scores.values()].filter((s) => s.verdict === false).length, 1);
});

test("a run directory becomes one receipt.json, and a started review sheet is not overwritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "garden-receipt-"));
  try {
    await writeFile(join(dir, "run.json"), JSON.stringify(await runFor()));
    await writeFile(join(dir, "outputs.jsonl"), outputs().map((l) => JSON.stringify(l)).join("\n") + "\n");
    const first = await writeReceipt(dir);
    assert.equal(first.verdict, "self-test-only");
    const sheet = await readFile(join(dir, "review.csv"), "utf8");
    await writeFile(join(dir, "review.csv"), sheet.replace(/,,,\n/g, ",y,n,\n"));
    const second = await writeReceipt(dir, { acceptance: accepted });
    assert.deepEqual(second.open, []);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "receipt.json"), "utf8")).tiers.tier_1.status, "pass");
    assert.ok(existsSync(join(dir, "review-key.json")) && existsSync(join(dir, "acceptance.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the one-command run writes the whole run directory (provider replaced by recorded outputs)", async () => {
  const name = `self-test-${process.pid}`;
  const runDir = `artifacts/generated/evaluation/${name}`;
  const stubDir = await mkdtemp(join(tmpdir(), "garden-stub-"));
  // Replaces fetch before the script starts: any request is answered from the corpus reference.
  const stub = join(stubDir, "stub.mjs");
  await writeFile(
    stub,
    `import { corpusV3 } from ${JSON.stringify(join(root, "services/garden-worker/evaluation/corpus-v3.mjs"))};
globalThis.fetch = async (url, options) => {
  if (String(url) !== "https://api.openai.com/v1/responses" || options.headers.Authorization !== "Bearer synthetic-not-a-key") throw new Error("unexpected request");
  const body = JSON.parse(options.body);
  if (body.store !== false || body.reasoning?.effort !== "low" || body.tools) throw new Error("unexpected body");
  const sent = JSON.parse(body.input[1].content);
  const c = corpusV3.find((x) => x.sources[0].revision_id === sent.sources[0].revision_id);
  const value = body.text.format.name === "garden_tend" ? c.reference.tend : c.reference.connect;
  return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }], usage: { input_tokens: 500, output_tokens: 60 } }), { status: 200 });
};
`,
  );
  try {
    const refused = spawnSync(process.execPath, ["services/garden-worker/evaluation/run-model.mjs", "--model", "m"], { cwd: root, env: { PATH: process.env.PATH } });
    assert.equal(refused.status, 2, "refuses without owner approval and a key");
    const outside = spawnSync(process.execPath, ["services/garden-worker/evaluation/run-model.mjs", "--owner-approved", "--model", "m", "--run-dir", "documents/leak"], { cwd: root, env: { PATH: process.env.PATH, OPENAI_API_KEY: "synthetic-not-a-key" } });
    assert.equal(outside.status, 2, "refuses to write outside the ignored folder");
    const ran = spawnSync(
      process.execPath,
      ["--import", stub, "services/garden-worker/evaluation/run-model.mjs", "--owner-approved", "--workflow", "tend-connect-v3", "--model", "recorded-synthetic-reference", "--reasoning-effort", "low", "--run-dir", runDir],
      { cwd: root, env: { PATH: process.env.PATH, OPENAI_API_KEY: "synthetic-not-a-key" }, encoding: "utf8" },
    );
    assert.equal(ran.status, 0, ran.stderr);
    for (const file of ["run.json", "outputs.jsonl", "review.csv", "review-key.json", "receipt.json"])
      assert.ok(existsSync(join(root, runDir, file)), file);
    const receipt = JSON.parse(await readFile(join(root, runDir, "receipt.json"), "utf8"));
    assert.equal(receipt.verdict, "no-go");
    assert.equal(receipt.run.model_snapshot, "recorded-synthetic-reference");
    assert.equal(receipt.run.reasoning_effort, "low");
    assert.equal(receipt.corpus.missing, 0);
    assert.equal(receipt.tiers.all_tiers.status, "pass");
    assert.equal(receipt.usage.input_tokens > 0, true);
    for (const file of ["run.json", "receipt.json"])
      assert.equal((await readFile(join(root, runDir, file), "utf8")).includes("synthetic-not-a-key"), false, "the key is never written");
  } finally {
    await rm(join(root, runDir), { recursive: true, force: true });
    await rm(stubDir, { recursive: true, force: true });
  }
});
