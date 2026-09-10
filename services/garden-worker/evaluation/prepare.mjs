import { mkdir, writeFile } from "node:fs/promises";
import { corpus } from "./corpus.mjs";
import { evaluateCorpus, thresholds } from "./evaluate.mjs";

export const baselines = [
  "no-ai",
  "immediate-reflection",
  "weekly-summary",
  "connect-v2",
  "negative-control",
];
export const reviewColumns =
  "case_id,variant,faithfulness,accumulation_dependence,useful_surprise,agency,boundedness,voice_preservation,uncertainty,continuation_value,overreach,notes";

// Every artifact is a pure function of the corpus and runtime; no clock, no randomness.
export function buildPacket(cases = corpus) {
  const report = evaluateCorpus(cases);
  const manifest = {
    status:
      report.status === "packet-valid"
        ? "awaiting-generation-and-human-review"
        : "packet-invalid",
    cases: report.cases,
    corpus_sha256: report.corpus_sha256,
    prompt_sha256: report.prompt_sha256,
    schema_sha256: report.schema_sha256,
    baselines,
    thresholds,
  };
  return {
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
    "report.json": JSON.stringify(report, null, 2) + "\n",
    "cases.jsonl": cases.map((c) => JSON.stringify(c)).join("\n") + "\n",
    "review.csv":
      reviewColumns +
      "\n" +
      cases
        .flatMap((c) => baselines.map((v) => `${c.id},${v},,,,,,,,,,`))
        .join("\n") +
      "\n",
  };
}

export async function writePacket(folder, cases = corpus) {
  if (!folder.startsWith("artifacts/generated/"))
    throw Error("Use the ignored artifacts/generated/ namespace.");
  await mkdir(folder, { recursive: true });
  const files = buildPacket(cases);
  for (const [name, text] of Object.entries(files))
    await writeFile(`${folder}/${name}`, text);
  return files;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const folder = process.argv[2];
  if (!folder)
    throw Error(
      "Provide an output folder under artifacts/generated; no provider calls are made.",
    );
  const files = await writePacket(folder);
  const report = JSON.parse(files["report.json"]);
  console.log(
    JSON.stringify({
      status: report.status,
      cases: report.cases,
      corpus_sha256: report.corpus_sha256,
      problems: report.problems.length,
    }),
  );
  if (report.status !== "packet-valid") process.exitCode = 1;
}
