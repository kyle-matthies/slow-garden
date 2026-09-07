import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { corpus } from "./corpus.mjs";
import {
  systemPrompt,
  outputSchema,
} from "../../../supabase/functions/_shared/garden-runtime.mjs";
const folder = process.argv[2];
if (!folder)
  throw Error(
    "Provide an output folder under artifacts/generated; no provider calls are made.",
  );
if (!folder.startsWith("artifacts/generated/"))
  throw Error("Use the ignored artifacts/generated/ namespace.");
await mkdir(folder, { recursive: true });
const manifest = {
  status: "awaiting-generation-and-human-review",
  cases: corpus.length,
  prompt_sha256: createHash("sha256").update(systemPrompt).digest("hex"),
  schema_sha256: createHash("sha256")
    .update(JSON.stringify(outputSchema))
    .digest("hex"),
  baselines: [
    "no-ai",
    "immediate-reflection",
    "weekly-summary",
    "connect-v2",
    "negative-control",
  ],
  thresholds: "documents/architecture/EVALUATION_ARCHITECTURE.md",
};
await writeFile(`${folder}/manifest.json`, JSON.stringify(manifest, null, 2));
await writeFile(
  `${folder}/cases.jsonl`,
  corpus.map((c) => JSON.stringify(c)).join("\n") + "\n",
);
await writeFile(
  `${folder}/review.csv`,
  "case_id,variant,faithfulness,accumulation_dependence,useful_surprise,agency,boundedness,voice_preservation,uncertainty,continuation_value,overreach,notes\n" +
    corpus
      .flatMap((c) => manifest.baselines.map((v) => `${c.id},${v},,,,,,,,,,`))
      .join("\n") +
    "\n",
);
console.log(JSON.stringify(manifest));
