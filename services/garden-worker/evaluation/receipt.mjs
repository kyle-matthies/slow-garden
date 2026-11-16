// Evaluation receipt for tend-connect-v3 (AI activation runbook 0.4, ADR-004,
// EVALUATION_ARCHITECTURE "tend-connect-v3 additions").
//
// Turns one run directory into one receipt:
//
//   <run-dir>/run.json        written by run-model.mjs: model snapshot, reasoning
//                             effort, workflow, transport, hashes at run time
//   <run-dir>/outputs.jsonl   written by run-model.mjs: one validated outcome per case
//   <run-dir>/review.csv      written here; the owner fills `verdict` (and `clinical`
//                             for labels) without seeing case, family or expectation
//   <run-dir>/review-key.json written here; maps blind item ids back to cases
//   <run-dir>/receipt.json    written here: the single receipt artefact
//
// The receipt holds identifiers, hashes, counts, rates and verdicts only: no
// corpus text and no model output. It is safe to copy into documents/operations.
// This file never calls a model and never reads real writing.
//
//   node services/garden-worker/evaluation/receipt.mjs <run-dir>
//   node services/garden-worker/evaluation/receipt.mjs <run-dir> \
//     --accept-return-format --accepted-by "<name>" --basis "<what was reviewed>"
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedKinds } from "../../../supabase/functions/_shared/garden-runtime.mjs";
import { corpusV3 } from "./corpus-v3.mjs";
import { evaluateV3 } from "./evaluate-v3.mjs";

export const RECEIPT_VERSION = 1;
export const CORPUS_VERSION = "tend-connect-v3-corpus";
const runtimePath = fileURLToPath(new URL("../../../supabase/functions/_shared/garden-runtime.mjs", import.meta.url));
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Hashes of everything that shapes a request: prompts, schemas, corpus and the runtime file itself. */
export async function currentHashes() {
  const { hashes, totals } = evaluateV3();
  return {
    corpus_version: CORPUS_VERSION,
    corpus_cases: totals.cases,
    corpus_sha256: hashes.corpus,
    tend_prompt_sha256: hashes.tend_prompt,
    connect_prompt_sha256: hashes.connect_prompt,
    tend_schema_sha256: hashes.tend_schema,
    connect_schema_sha256: hashes.connect_schema_all_kinds,
    runtime_sha256: sha(await readFile(runtimePath, "utf8")),
  };
}

// Thresholds copied from EVALUATION_ARCHITECTURE.md. `source` says how each is measured:
//   deterministic  recomputed here from the stored outputs
//   reference      compared with the corpus's hand-written reference (a proxy; confirm blind)
//   blind          from the owner's blind scores in review.csv
export const thresholds = [
  { id: "valid_evidence", tier: "all", min: 1, source: "deterministic", text: "100% valid source handles and excerpt matches: no stage refused and no mark dropped" },
  { id: "brevity", tier: "all", min: 1, source: "deterministic", text: "100% of blooms one sentence of at most 280 characters, at most three per return; at most one question of at most 160 characters" },
  { id: "tier_lock", tier: "all", min: 1, source: "deterministic", text: "zero blooms of a kind the tiers had not unlocked" },
  { id: "label_faithfulness", tier: "1", min: 0.95, source: "blind", kinds: ["theme"], text: "theme labels name what the cited passage is about" },
  { id: "clinical_labels", tier: "1", max: 0, source: "blind", kinds: ["theme"], text: "zero clinical, mood or worth labels" },
  { id: "open_questions", tier: "1", min: 1, source: "blind", kinds: ["open_question"], text: "100% exact quotes of a question the person left open" },
  { id: "unfinished_recall", tier: "1", min: 0.9, source: "reference", text: "at least 90% on writing that visibly stops mid-thought" },
  { id: "unfinished_precision", tier: "1", min: 0.9, source: "blind", kinds: ["unfinished"], text: "unfinished marks sit on writing that visibly stops mid-thought" },
  { id: "pattern_precision", tier: "2", min: 0.85, source: "blind", kinds: ["pattern"], text: "pattern precision on recurrence cases" },
  { id: "pattern_negative_controls", tier: "2", min: 1, source: "reference", text: "on the shared-word negative controls, no pattern is offered" },
  { id: "claim_faithfulness", tier: "2", min: 0.95, source: "blind", kinds: ["connection", "tension", "change"], text: "at least 95% of atomic claims rated faithful" },
  { id: "echo_precision", tier: "3", min: 0.8, source: "blind", kinds: ["echo"], text: "the older passage bears on the new writing, not only shared words" },
  { id: "question_grounding", tier: "3", min: 1, source: "blind", kinds: ["question"], text: "questions grounded in the person's words with no invented premise" },
];

/**
 * Whether the corpus's own reference answers contain something for every
 * threshold to measure. A threshold the corpus cannot exercise is reported as
 * missing, and a receipt built on such a corpus cannot be go.
 */
export function corpusCoverage(cases = corpusV3) {
  const marks = cases.flatMap((c) => c.reference.tend.marks.map((m) => m.kind));
  const blooms = cases.flatMap((c) => (c.reference.connect?.blooms ?? []).map((b) => b.kind));
  const count = (list, kinds) => list.filter((k) => kinds.includes(k)).length;
  const counts = {
    valid_evidence: cases.length,
    brevity: blooms.length,
    tier_lock: cases.filter((c) => allowedKinds(c.tiers).length < 6).length,
    unfinished_recall: count(marks, ["unfinished"]),
    pattern_negative_controls: cases.filter((c) => c.family === "recurrence" && c.expected.blooms === "none" && allowedKinds(c.tiers).length).length,
  };
  for (const t of thresholds.filter((x) => x.source === "blind")) counts[t.id] = count(t.kinds.some((k) => ["theme", "open_question", "unfinished"].includes(k)) ? marks : blooms, t.kinds);
  return { reference_items: counts, missing: thresholds.map((t) => t.id).filter((id) => !counts[id]) };
}

const oneSentence = (text) => !/[.!?]["')\]]?\s+\S/.test(text.trim());
const round = (n) => (n === null ? null : Math.round(n * 10000) / 10000);
const rate = (pass, total) => (total ? round(pass / total) : null);

// ---- CSV (RFC 4180, enough for the review sheet) ----------------------------
const cell = (value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), (i += 1);
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      (row = []), (field = "");
    } else field += ch;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows;
}

// ---- Blind review sheet ------------------------------------------------------
export const reviewColumns = ["item_id", "kind", "returned", "quoted_evidence", "cited_passages", "verdict", "clinical", "notes"];

/** Every returned mark and bloom, as blind review items in a stable shuffled order. */
export function reviewItems(outputs) {
  const cases = new Map(corpusV3.map((c) => [c.id, c]));
  const items = [];
  for (const line of outputs) {
    const c = cases.get(line.case);
    if (!c || !line.outcome?.ok) continue;
    const bodies = new Map(c.sources.map((s) => [s.revision_id, s.body]));
    const add = (kind, returned, evidence, index) => {
      items.push({
        item_id: sha(`${line.case}|${kind}|${index}|${returned}`).slice(0, 12),
        case: line.case,
        family: c.family,
        kind,
        returned,
        quoted_evidence: evidence.map((e) => e.excerpt).join(" | "),
        cited_passages: [...new Set(evidence.map((e) => bodies.get(e.revision_id) ?? ""))].join(" | "),
      });
    };
    (line.outcome.result?.marks ?? []).forEach((m, i) => add(m.kind, m.label, m.evidence, `m${i}`));
    (line.outcome.result?.blooms ?? []).forEach((b, i) => add(b.kind, b.interpretation, b.evidence, `b${i}`));
  }
  // Order by the opaque id so neighbouring rows are not from the same case.
  return items.sort((a, b) => a.item_id.localeCompare(b.item_id));
}
export function reviewSheet(items) {
  return (
    [reviewColumns.join(","), ...items.map((i) => [i.item_id, i.kind, i.returned, i.quoted_evidence, i.cited_passages, "", "", ""].map(cell).join(","))].join("\n") + "\n"
  );
}
/** Reads the filled sheet: item_id -> { verdict: true|false|null, clinical: true|false|null }. */
export function readScores(csvText) {
  const [header, ...rows] = parseCsv(csvText);
  const at = (name) => header.indexOf(name);
  const yn = (value) => {
    const v = (value ?? "").trim().toLowerCase();
    return ["y", "yes", "1", "true"].includes(v) ? true : ["n", "no", "0", "false"].includes(v) ? false : null;
  };
  return new Map(rows.map((r) => [r[at("item_id")], { verdict: yn(r[at("verdict")]), clinical: yn(r[at("clinical")]) }]));
}

// ---- Receipt -------------------------------------------------------------------
export async function buildReceipt({ run, outputs, scores = new Map(), acceptance = null, now = () => new Date() }) {
  if (run.workflow !== "tend-connect-v3")
    throw Error("receipt.mjs scores tend-connect-v3 only; connect-v2 needs the five-baseline comparison in EVALUATION_ARCHITECTURE");
  const hashes = await currentHashes();
  const stale = Object.keys(hashes).filter((key) => run.hashes?.[key] !== hashes[key]);
  const cases = new Map(corpusV3.map((c) => [c.id, c]));
  const seen = new Map(outputs.map((line) => [line.case, line]));
  const missing = corpusV3.filter((c) => !seen.has(c.id)).map((c) => c.id);
  const unknown = outputs.filter((line) => !cases.has(line.case)).map((line) => line.case);

  // Deterministic, recomputed from the stored outputs rather than trusted from the run.
  let stages = 0;
  let cleanStages = 0;
  let blooms = 0;
  let briefBlooms = 0;
  let lockedBlooms = 0;
  let refusedCases = 0;
  let briefReturns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const unfinished = { expected: 0, found: 0 };
  const controls = { cases: 0, quiet: 0 };
  const quiet = { cases: 0, quiet: 0 };
  for (const c of corpusV3) {
    const line = seen.get(c.id);
    const kinds = allowedKinds(c.tiers);
    const expectedStages = kinds.length ? ["tend", "connect"] : ["tend"];
    stages += expectedStages.length;
    const result = line?.outcome?.ok ? line.outcome.result : { blooms: [], marks: [] };
    if (!line?.outcome?.ok) refusedCases += 1;
    else cleanStages += expectedStages.filter((s) => line.outcome.stages?.[s] === "ok").length;
    inputTokens += line?.outcome?.usage?.[0] ?? 0;
    outputTokens += line?.outcome?.usage?.[1] ?? 0;
    const returned = result.blooms ?? [];
    blooms += returned.length;
    briefBlooms += returned.filter(
      (b) => oneSentence(b.interpretation) && b.interpretation.length <= (b.kind === "question" ? 160 : 280),
    ).length;
    lockedBlooms += returned.filter((b) => !kinds.includes(b.kind)).length;
    if (returned.length <= 3 && returned.filter((b) => b.kind === "question").length <= 1) briefReturns += 1;
    for (const m of c.reference.tend.marks.filter((x) => x.kind === "unfinished")) {
      unfinished.expected += 1;
      if ((result.marks ?? []).some((x) => x.kind === "unfinished" && x.seed_id === m.seed_id)) unfinished.found += 1;
    }
    if (c.expected.blooms === "none" && kinds.length) {
      quiet.cases += 1;
      if (!returned.length) quiet.quiet += 1;
      if (c.family === "recurrence") {
        controls.cases += 1;
        if (!returned.some((b) => b.kind === "pattern")) controls.quiet += 1;
      }
    }
  }

  // Blind scores, aggregated by the kind of item.
  const items = reviewItems(outputs);
  const byKind = (kinds) => items.filter((i) => kinds.includes(i.kind));
  const blind = (kinds, field = "verdict") => {
    const rows = byKind(kinds);
    const scored = rows.filter((i) => typeof scores.get(i.item_id)?.[field] === "boolean");
    return { items: rows.length, scored: scored.length, yes: scored.filter((i) => scores.get(i.item_id)[field]).length };
  };

  const measured = {
    valid_evidence: { value: rate(cleanStages, stages), detail: { stages, clean_stages: cleanStages, cases_refused: refusedCases } },
    brevity: { value: blooms || briefReturns ? rate(briefBlooms + briefReturns, blooms + corpusV3.length) : null, detail: { blooms, brief_blooms: briefBlooms, returns_within_caps: briefReturns } },
    tier_lock: { value: lockedBlooms === 0 ? 1 : 0, detail: { locked_kind_blooms: lockedBlooms } },
    unfinished_recall: { value: rate(unfinished.found, unfinished.expected), detail: unfinished },
    pattern_negative_controls: { value: rate(controls.quiet, controls.cases), detail: controls },
  };
  const results = thresholds.map((t) => {
    if (t.source !== "blind") {
      const m = measured[t.id];
      const status = m.value === null ? "not-measured" : m.value >= t.min ? "pass" : "fail";
      return { id: t.id, tier: t.tier, source: t.source, threshold: t.text, required: t.min, value: m.value, detail: m.detail, status };
    }
    const b = blind(t.kinds, t.id === "clinical_labels" ? "clinical" : "verdict");
    const complete = b.scored === b.items;
    const value = t.max !== undefined ? b.yes : rate(b.yes, b.scored);
    // Three outcomes, never two: measured and met, measured and missed, not measured.
    // A threshold with nothing to score (the run returned no item of that kind) was
    // not measured, and that is never a pass.
    const status =
      b.items === 0
        ? "not-measured"
        : !complete
          ? "awaiting-blind-score"
          : t.max !== undefined
            ? b.yes <= t.max ? "pass" : "fail"
            : value >= t.min ? "pass" : "fail";
    return { id: t.id, tier: t.tier, source: "blind", threshold: t.text, required: t.max !== undefined ? `at most ${t.max}` : t.min, value: status === "pass" || status === "fail" ? value : null, detail: b, status };
  });

  const coverage = corpusCoverage();
  const accepted = acceptance?.return_format_accepted === true;
  const open = [
    ...(stale.length ? [`hashes changed since the run: ${stale.join(", ")}`] : []),
    ...(missing.length ? [`${missing.length} corpus case(s) have no output`] : []),
    ...(unknown.length ? [`${unknown.length} output(s) are not corpus cases`] : []),
    ...coverage.missing.map((id) => `corpus has no case that exercises ${id}`),
    ...results.filter((r) => r.status === "fail").map((r) => `${r.id} below threshold`),
    ...results.filter((r) => r.status === "not-measured").map((r) => `${r.id} not measured`),
    ...results.filter((r) => r.status === "awaiting-blind-score").map((r) => `${r.id} awaiting blind score`),
    ...(accepted ? [] : ["owner acceptance of the small return format not recorded"]),
    ...(run.owner_approved === true ? [] : ["run was not marked owner-approved"]),
  ];
  const tiers = Object.fromEntries(
    ["all", "1", "2", "3"].map((tier) => {
      const rows = results.filter((r) => r.tier === tier);
      const status = rows.some((r) => r.status === "fail")
        ? "fail"
        : rows.some((r) => ["awaiting-blind-score", "not-measured"].includes(r.status))
          ? "incomplete"
          : "pass";
      return [tier === "all" ? "all_tiers" : `tier_${tier}`, { status, thresholds: rows }];
    }),
  );
  const receipt = {
    receipt_version: RECEIPT_VERSION,
    kind: run.self_test === true ? "self-test" : "evaluation",
    generated_at: now().toISOString(),
    run: {
      run_id: run.run_id ?? null,
      started_at: run.started_at ?? null,
      owner_approved: run.owner_approved === true,
      provider: run.provider ?? null,
      model_snapshot: run.model ?? null,
      reasoning_effort: run.reasoning_effort ?? null,
      workflow_version: run.workflow ?? null,
      transport: run.transport ?? null,
    },
    hashes: { at_run: run.hashes ?? null, now: hashes, current: stale.length === 0 },
    corpus: { version: hashes.corpus_version, cases: hashes.corpus_cases, sha256: hashes.corpus_sha256, outputs: outputs.length, missing: missing.length },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      mean_input_tokens_per_case: outputs.length ? Math.round(inputTokens / outputs.length) : null,
      mean_output_tokens_per_case: outputs.length ? Math.round(outputTokens / outputs.length) : null,
    },
    informational: { quiet_when_no_bloom_expected: { ...quiet, value: rate(quiet.quiet, quiet.cases) }, blind_items: items.length },
    tiers,
    // Required thresholds this run did not measure. Any entry here means no-go.
    not_measured: results.filter((r) => r.status === "not-measured").map((r) => r.id),
    corpus_coverage: coverage,
    owner_acceptance: {
      requirement: "Kyle accepts the small return format (EVALUATION_ARCHITECTURE: a blinded Wizard-of-Oz study; desk review cannot satisfy that gate)",
      return_format_accepted: acceptance?.return_format_accepted ?? null,
      accepted_by: acceptance?.accepted_by ?? null,
      accepted_at: acceptance?.accepted_at ?? null,
      basis: acceptance?.basis ?? null,
    },
    open,
    // A self-test can never be a go: its "outputs" are the corpus's own reference answers.
    verdict: run.self_test === true ? "self-test-only" : open.length ? "no-go" : "go",
  };
  // The receipt must stay free of corpus text and model output.
  const serialized = JSON.stringify(receipt);
  const leaks = [
    ...corpusV3.flatMap((c) => c.sources.map((s) => s.body)),
    ...items.filter((i) => i.returned.length >= 24).map((i) => i.returned),
  ].filter((text) => serialized.includes(text));
  if (leaks.length) throw Error("receipt would contain corpus or output text");
  return receipt;
}

/** Writes review.csv (once), review-key.json and receipt.json for a run directory. */
export async function writeReceipt(dir, { acceptance = null, now } = {}) {
  const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
  const outputs = (await readFile(join(dir, "outputs.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const items = reviewItems(outputs);
  const sheet = join(dir, "review.csv");
  // Never overwrite a sheet the owner may have started to fill in.
  if (!existsSync(sheet)) await writeFile(sheet, reviewSheet(items));
  await writeFile(
    join(dir, "review-key.json"),
    JSON.stringify(items.map(({ item_id, case: id, family, kind }) => ({ item_id, case: id, family, kind })), null, 2) + "\n",
  );
  const acceptancePath = join(dir, "acceptance.json");
  if (acceptance) await writeFile(acceptancePath, JSON.stringify(acceptance, null, 2) + "\n");
  const recorded = acceptance ?? (existsSync(acceptancePath) ? JSON.parse(await readFile(acceptancePath, "utf8")) : null);
  const receipt = await buildReceipt({ run, outputs, scores: readScores(await readFile(sheet, "utf8")), acceptance: recorded, now });
  await writeFile(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = process.argv[2];
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  if (!dir || dir.startsWith("--")) {
    console.error("Usage: node services/garden-worker/evaluation/receipt.mjs <run-dir> [--accept-return-format --accepted-by <name> --basis <text>]");
    process.exit(2);
  }
  let acceptance = null;
  if (process.argv.includes("--accept-return-format")) {
    if (!arg("--accepted-by") || !arg("--basis")) {
      console.error("--accept-return-format needs --accepted-by <name> and --basis <what was reviewed>");
      process.exit(2);
    }
    acceptance = { return_format_accepted: true, accepted_by: arg("--accepted-by"), accepted_at: new Date().toISOString(), basis: arg("--basis") };
  }
  const receipt = await writeReceipt(dir, { acceptance });
  for (const [name, tier] of Object.entries(receipt.tiers)) console.log(`${name}: ${tier.status}`);
  for (const line of receipt.open) console.log(`open: ${line}`);
  console.log(`verdict: ${receipt.verdict} (${join(dir, "receipt.json")})`);
  process.exitCode = receipt.verdict === "go" ? 0 : 1;
}
