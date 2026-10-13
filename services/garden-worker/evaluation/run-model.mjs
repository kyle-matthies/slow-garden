// Runs the synthetic evaluation corpus through a candidate model so humans can
// score it blind. It never runs in CI, never touches real writing, and refuses
// to start without an explicit owner approval flag (AI activation runbook 1.1:
// provider terms reviewed, dedicated account, spend limit set).
//
//   OPENAI_API_KEY=... node services/garden-worker/evaluation/run-model.mjs \
//     --model <pinned-model-snapshot> --workflow tend-connect-v3 --owner-approved \
//     [--limit 5] [--out artifacts/generated/model-runs]
//
// Outputs go to an ignored folder. Each line records the case, stage, the
// model's synthetic output and the deterministic validator outcome. Scoring
// happens afterwards in review.csv-style blind review, not here.
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

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const model = arg("--model");
const workflow = arg("--workflow") ?? "tend-connect-v3";
const limit = Number(arg("--limit") ?? Infinity);
const outDir = arg("--out") ?? "artifacts/generated/model-runs";
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

const v3 = workflow === "tend-connect-v3";
const cases = (v3 ? corpusV3 : corpus).slice(0, limit);
const jobFor = (c) =>
  v3
    ? { id: c.id, model, workflow_version: workflow, snapshot: c.sources, corrections: [], context: { tiers: c.tiers, index: [] } }
    : { id: c.id, model, workflow_version: workflow, snapshot: c.sources, corrections: c.corrections ?? [] };

async function respond(body) {
  // Synchronous Responses call for review runs; production uses Batch.
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const json = await response.json();
  return { status_code: response.status, body: json };
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await mkdir(outDir, { recursive: true });
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
const file = join(outDir, `${workflow}-${model.replace(/[^a-z0-9.-]/gi, "_")}-${stamp}.jsonl`);
await writeFile(file, lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} synthetic results to ${file}. Score them blind before any activation decision.`);
