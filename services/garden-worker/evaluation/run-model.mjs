// Runs the synthetic evaluation corpus through a candidate model so humans can
// score it blind. It never runs in CI, never touches real writing, and refuses
// to start without an explicit owner approval flag (AI activation runbook 1.1:
// provider terms reviewed, dedicated account, spend limit set).
//
// The one command that produces the runbook 0.4 receipt for a candidate
// configuration (the key comes from the environment of the terminal it is run
// in and is never written anywhere):
//
//   OPENAI_API_KEY=... node services/garden-worker/evaluation/run-model.mjs \
//     --owner-approved --workflow tend-connect-v3 \
//     --model <dated-model-snapshot> [--reasoning-effort low] \
//     [--run-dir artifacts/generated/evaluation/<name>] [--limit 5]
//
// It writes run.json, outputs.jsonl, review.csv, review-key.json and
// receipt.json into the run directory, which must be under the ignored
// artifacts/generated/ folder. The receipt starts as no-go: blind scores and
// the owner's acceptance are filled in afterwards (see receipt.mjs).
// Requests are built by the same code the worker uses and sent one at a time
// over the synchronous Responses endpoint with store:false.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseBatchLine,
  parseTendConnect,
  requestFor,
  requestsFor,
} from "../../../supabase/functions/_shared/garden-runtime.mjs";
import { corpus } from "./corpus.mjs";
import { corpusV3 } from "./corpus-v3.mjs";
import { currentHashes, writeReceipt } from "./receipt.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const model = arg("--model");
const workflow = arg("--workflow") ?? "tend-connect-v3";
const limit = Number(arg("--limit") ?? Infinity);
const effort = arg("--reasoning-effort");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = arg("--run-dir") ?? arg("--out") ?? `artifacts/generated/evaluation/${stamp}`;
const approved = process.argv.includes("--owner-approved");
const apiKey = process.env.OPENAI_API_KEY;

if (!approved || !model || !apiKey) {
  console.error(
    "Refusing to run: needs --owner-approved, --model <pinned snapshot>, and OPENAI_API_KEY.\n" +
      "This sends the synthetic corpus to an external provider; record the approval in the runbook first.",
  );
  process.exit(2);
}
if (!["tend-connect-v3", "connect-v2"].includes(workflow)) {
  console.error("--workflow must be tend-connect-v3 or connect-v2");
  process.exit(2);
}
if (!outDir.startsWith("artifacts/generated/")) {
  console.error("The run directory must be under the ignored artifacts/generated/ folder.");
  process.exit(2);
}

const v3 = workflow === "tend-connect-v3";
const cases = (v3 ? corpusV3 : corpus).slice(0, limit);
const jobFor = (c) =>
  v3
    ? { id: c.id, model, workflow_version: workflow, reasoning_effort: effort, snapshot: c.sources, corrections: [], context: { tiers: c.tiers, index: [] } }
    : { id: c.id, model, workflow_version: workflow, reasoning_effort: effort, snapshot: c.sources, corrections: c.corrections ?? [] };

async function respond(body) {
  // Synchronous Responses call: the same request body either worker transport sends.
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    // Error bodies are not kept.
    return { status_code: response.status, body: response.ok ? await response.json() : null };
  } catch {
    return { status_code: 0, body: null };
  }
}

await mkdir(outDir, { recursive: true });
const run = {
  run_id: stamp,
  started_at: new Date().toISOString(),
  owner_approved: true,
  provider: "openai-responses",
  transport: "sync",
  model,
  reasoning_effort: effort ?? null,
  workflow,
  cases: cases.length,
  hashes: await currentHashes(),
};
await writeFile(join(outDir, "run.json"), JSON.stringify(run, null, 2) + "\n");
const lines = [];
for (const c of cases) {
  const job = jobFor(c);
  const requests = v3 ? requestsFor(job) : [requestFor(job)];
  const results = [];
  for (const request of requests) results.push({ custom_id: request.custom_id, response: await respond(request.body) });
  const text = results.map((r) => JSON.stringify(r)).join("\n");
  let outcome;
  try {
    const parsed = v3 ? parseTendConnect(text, job) : parseBatchLine(text, job);
    outcome = { ok: true, stages: parsed.stages ?? null, result: parsed.result, usage: [parsed.inputTokens, parsed.outputTokens] };
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : "invalid" };
  }
  lines.push(JSON.stringify({ case: c.id, family: c.family, workflow, model, outcome }));
  console.log(`${c.id}: ${outcome.ok ? "validated" : `refused (${outcome.error})`}`);
}
const file = join(outDir, "outputs.jsonl");
await writeFile(file, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} synthetic results to ${file}.`);
if (v3) {
  const receipt = await writeReceipt(outDir);
  console.log(
    `Receipt: ${join(outDir, "receipt.json")} (${receipt.verdict}). Fill verdict/clinical in ${join(outDir, "review.csv")}, then run\n` +
      `  node services/garden-worker/evaluation/receipt.mjs ${outDir} --accept-return-format --accepted-by "<name>" --basis "<what was reviewed>"`,
  );
} else {
  console.log("connect-v2 has no automated receipt: score it against the five baselines in EVALUATION_ARCHITECTURE.");
}
