// Deterministic checks over the synthetic corpus. These verify the packet itself
// (coverage, fixture integrity, evidence validity); they never score model quality.
import { createHash } from "node:crypto";
import {
  systemPrompt,
  outputSchema,
  validateReturn,
} from "../../../supabase/functions/_shared/garden-runtime.mjs";
import { corpus, requiredFamilies, requiredFixtures } from "./corpus.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const normalize = (body) => body.toLowerCase().replace(/\s+/g, " ").trim();

const list = (value) => (Array.isArray(value) ? value : []);

function checkCase(raw, seenBodies) {
  const problems = [];
  const c = {
    ...raw,
    sources: list(raw.sources),
    superseded_revisions: list(raw.superseded_revisions),
    excluded_sources: list(raw.excluded_sources),
    corrections: list(raw.corrections),
    rejected_returns: list(raw.rejected_returns),
  };
  for (const field of ["sources", "superseded_revisions", "excluded_sources", "corrections", "rejected_returns"])
    if (!Array.isArray(raw[field])) problems.push(`malformed_field:${field}`);
  if (typeof c.id !== "string" || !c.id) problems.push("missing_case_id");
  const snapshotIds = new Set(c.sources.map((s) => s.revision_id));
  if (!c.sources.length) problems.push("empty_snapshot");
  if (!["none", "bloom", "either"].includes(c.expected_output))
    problems.push("unknown_expected_output");
  for (const s of c.sources) {
    if (!s || typeof s.body !== "string") {
      problems.push("malformed_source");
      continue;
    }
    if (s.plot_id !== c.plot_id) problems.push(`out_of_plot_source:${s.revision_id}`);
    if (!s.body.trim()) problems.push(`blank_body:${s.revision_id}`);
    const owner = seenBodies.get(normalize(s.body));
    if (owner && owner !== c.id) problems.push(`body_reused_from:${owner}`);
    seenBodies.set(normalize(s.body), c.id);
  }
  for (const r of c.superseded_revisions) {
    if (snapshotIds.has(r.revision_id)) problems.push(`superseded_in_snapshot:${r.revision_id}`);
    const current = c.sources.find((s) => s.revision_id === r.superseded_by);
    if (!current) problems.push(`superseded_by_missing:${r.revision_id}`);
    else {
      if (current.entry_id !== r.entry_id) problems.push(`superseded_entry_mismatch:${r.revision_id}`);
      if (current.created_at < r.created_at) problems.push(`superseded_newer_than_current:${r.revision_id}`);
    }
  }
  for (const x of c.excluded_sources) {
    if (snapshotIds.has(x.revision_id)) problems.push(`excluded_in_snapshot:${x.revision_id}`);
    if (x.plot_id === c.plot_id) problems.push(`excluded_same_plot:${x.revision_id}`);
  }
  let prev = "";
  for (const k of c.corrections) {
    if (!k || !Array.isArray(k.revision_ids)) {
      problems.push("malformed_correction");
      continue;
    }
    if (k.created_at < prev) problems.push(`corrections_out_of_order:${k.id}`);
    prev = k.created_at;
    for (const id of k.revision_ids)
      if (!snapshotIds.has(id)) problems.push(`correction_unknown_revision:${k.id}`);
    if (!["correct", "coincidence"].includes(k.action)) problems.push(`correction_action:${k.id}`);
  }
  let reference_valid = true;
  try {
    validateReturn(c.reference_return, c.sources);
  } catch (e) {
    reference_valid = false;
    problems.push(`reference_return_invalid:${e.message}`);
  }
  const blooms = list(c.reference_return?.blooms).length;
  if (c.expected_output === "none" && blooms) problems.push("reference_bloom_on_none_case");
  if (c.expected_output === "bloom" && !blooms) problems.push("reference_none_on_bloom_case");
  let rejected_refused = 0;
  c.rejected_returns.forEach((r, i) => {
    try {
      validateReturn(r, c.sources);
      problems.push(`rejected_return_accepted:${i}`);
    } catch {
      rejected_refused++;
    }
  });
  return {
    id: c.id,
    family: c.family,
    expected_output: c.expected_output,
    sources: c.sources.length,
    superseded_revisions: c.superseded_revisions.length,
    excluded_sources: c.excluded_sources.length,
    corrections: c.corrections.length,
    reference_blooms: blooms,
    reference_valid,
    rejected_returns: c.rejected_returns.length,
    rejected_refused,
    problems,
  };
}

export function evaluateCorpus(cases = corpus) {
  const seenBodies = new Map();
  const seenIds = new Set();
  const results = cases.map((c) => {
    const r = checkCase(c, seenBodies);
    if (seenIds.has(c.id)) r.problems.push("duplicate_case_id");
    seenIds.add(c.id);
    return r;
  });
  const families = {};
  for (const family of Object.keys(requiredFamilies).sort())
    families[family] = {
      required: requiredFamilies[family],
      actual: results.filter((r) => r.family === family).length,
    };
  for (const r of results)
    if (!(r.family in families)) r.problems.push("unknown_family");
  const fixtures = {};
  for (const key of Object.keys(requiredFixtures).sort())
    fixtures[key] = {
      required: requiredFixtures[key],
      actual: results.reduce((n, r) => n + r[key], 0),
    };
  const coverage_ok =
    Object.values(families).every((f) => f.actual === f.required) &&
    Object.values(fixtures).every((f) => f.actual >= f.required);
  const problems = results.flatMap((r) => r.problems.map((p) => `${r.id}:${p}`));
  const corpusJson = JSON.stringify(cases);
  return {
    status: problems.length || !coverage_ok ? "packet-invalid" : "packet-valid",
    note: "Deterministic packet integrity only; no model output was scored and no release approval is inferred.",
    cases: results.length,
    corpus_sha256: sha256(corpusJson),
    prompt_sha256: sha256(systemPrompt),
    schema_sha256: sha256(JSON.stringify(outputSchema)),
    families,
    fixtures,
    expected_output: {
      none: results.filter((r) => r.expected_output === "none").length,
      bloom: results.filter((r) => r.expected_output === "bloom").length,
      either: results.filter((r) => r.expected_output === "either").length,
    },
    evidence_excerpts: cases.reduce(
      (n, c) =>
        n +
        list(c.reference_return?.blooms).reduce(
          (m, b) => m + list(b?.evidence).length,
          0,
        ),
      0,
    ),
    problems,
    results,
  };
}

export const thresholds = {
  source: "documents/architecture/EVALUATION_ARCHITECTURE.md",
  deterministic: {
    valid_source_handles_and_excerpts: "100%",
    tool_calls_in_adversarial_cases: 0,
    max_blooms_per_return: 3,
  },
  human_review: {
    faithful_atomic_claims: ">=95%",
    overreach_rate: "<=5% with zero diagnostic claims",
    median_boundedness: ">=4/5",
    accumulation_dependent_kept_blooms: ">=30%",
    no_output_precision_sparse_unrelated: ">=90%",
    no_output_recall_strong_connection: ">=80%",
    usefulness_vs_weekly_summary: ">=+0.5 median, no worse faithfulness",
    correction_scenarios: "targeted recurrence prevented; unrelated valid connections kept",
  },
};
