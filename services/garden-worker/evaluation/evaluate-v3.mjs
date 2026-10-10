// Deterministic checks of the tend-connect-v3 evaluation packet (ADR-008).
// Like evaluate.mjs, this validates the corpus and validators, not any model.
// Usage: node services/garden-worker/evaluation/evaluate-v3.mjs [--out path]
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  connectPromptV3,
  connectSchema,
  allowedKinds,
  tendPrompt,
  tendSchema,
  validateConnect,
  validateTend,
} from "../../../supabase/functions/_shared/garden-runtime.mjs";
import { corpusV3, requiredV3Families } from "./corpus-v3.mjs";

const sha = (value) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const jobFor = (c) => ({
  id: c.id,
  workflow_version: "tend-connect-v3",
  snapshot: c.sources,
  context: { tiers: c.tiers },
});

function checkCase(c) {
  const problems = [];
  const job = jobFor(c);
  try {
    const tended = validateTend(c.reference.tend, job);
    if (tended.dropped) problems.push(`reference tend dropped ${tended.dropped} mark(s)`);
    if ((c.expected.marks === "none") !== (tended.marks.length === 0))
      problems.push("reference tend disagrees with expected marks");
  } catch (error) {
    problems.push(`reference tend invalid: ${error.message}`);
  }
  const kinds = allowedKinds(c.tiers);
  if (c.reference.connect === null) {
    if (kinds.length) problems.push("connect stage is unlocked but has no reference");
  } else {
    try {
      const connected = validateConnect(c.reference.connect, job);
      if (c.expected.blooms === "none" && connected.blooms.length)
        problems.push("reference blooms where none are expected");
      if (c.expected.blooms === "bloom" && !connected.blooms.length)
        problems.push("no reference bloom where one is expected");
    } catch (error) {
      problems.push(`reference connect invalid: ${error.message}`);
    }
  }
  const rejections = c.rejected.map((r) => {
    let refused;
    if (r.stage === "tend") {
      try {
        const kept = validateTend(r.value, job).marks.length;
        refused = kept <= (r.keep ?? 0);
      } catch {
        refused = true;
      }
    } else {
      try {
        validateConnect(r.value, job);
        refused = false;
      } catch {
        refused = true;
      }
    }
    const shouldRefuse = r.validatorRejects !== false;
    if (refused !== shouldRefuse)
      problems.push(
        shouldRefuse
          ? `rejected ${r.stage} output was accepted: ${r.reason}`
          : `human-review fixture was refused by validators: ${r.reason}`,
      );
    return { stage: r.stage, reason: r.reason, refused_by_validator: refused, human_review: !shouldRefuse };
  });
  return { id: c.id, family: c.family, tiers: c.tiers, expected: c.expected, rejections, problems };
}

export function evaluateV3() {
  const results = corpusV3.map(checkCase);
  const families = {};
  for (const c of corpusV3) families[c.family] = (families[c.family] ?? 0) + 1;
  const coverage = Object.entries(requiredV3Families).map(([family, required]) => ({
    family,
    required,
    actual: families[family] ?? 0,
    ok: (families[family] ?? 0) >= required,
  }));
  const ids = new Set();
  const bodies = new Map();
  const integrity = [];
  for (const c of corpusV3) {
    if (ids.has(c.id)) integrity.push(`duplicate case id ${c.id}`);
    ids.add(c.id);
    for (const s of c.sources) {
      const owner = bodies.get(s.body);
      if (owner && owner !== c.id) integrity.push(`body reused in ${owner} and ${c.id}`);
      bodies.set(s.body, c.id);
    }
  }
  const humanReview = results.flatMap((r) => r.rejections.filter((x) => x.human_review).map((x) => `${r.id}: ${x.reason}`));
  const ok = results.every((r) => !r.problems.length) && coverage.every((c) => c.ok) && !integrity.length;
  return {
    workflow: "tend-connect-v3",
    content_free_note: "Synthetic corpus only; no journal content.",
    hashes: {
      corpus: sha(corpusV3),
      tend_prompt: sha(tendPrompt),
      connect_prompt: sha(connectPromptV3),
      tend_schema: sha(tendSchema),
      connect_schema_all_kinds: sha(connectSchema(allowedKinds({ notice: true, resurface: true }))),
    },
    totals: {
      cases: results.length,
      rejected_outputs: results.reduce((n, r) => n + r.rejections.length, 0),
      validator_refusals: results.reduce((n, r) => n + r.rejections.filter((x) => x.refused_by_validator).length, 0),
      human_review_only: humanReview.length,
    },
    coverage,
    integrity,
    human_review_fixtures: humanReview,
    cases: results,
    ok,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = evaluateV3();
  const out = process.argv.indexOf("--out");
  if (out >= 0) {
    await mkdir(dirname(process.argv[out + 1]), { recursive: true });
    await writeFile(process.argv[out + 1], JSON.stringify(report, null, 2) + "\n");
  }
  for (const r of report.cases) for (const p of r.problems) console.error(`${r.id}: ${p}`);
  for (const p of report.integrity) console.error(p);
  console.log(
    `tend-connect-v3 packet: ${report.totals.cases} cases, ${report.totals.validator_refusals}/${report.totals.rejected_outputs} rejected outputs refused by validators, ${report.totals.human_review_only} left to human review — ${report.ok ? "ok" : "PROBLEMS"}`,
  );
  process.exitCode = report.ok ? 0 : 1;
}
