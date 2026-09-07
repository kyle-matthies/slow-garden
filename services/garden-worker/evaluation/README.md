# Evaluation packet

Prepare the 48-case synthetic packet with `prepare.mjs`. No private inputs or provider
calls occur. Cases cover sparse, connections, changed thinking, tension, unrelated
material, correction, injection, stale context, and overreach.

These initial variants intentionally reuse scenario structures. They are a starter
corpus, not 48 independent observations or proof of broad coverage. Before release,
replace repetitive variants with distinct examples and add real timestamp/revision
supersession, multi-plot exclusion, and correction-history fixtures. Keep real personal
material outside Git, under an explicit private study flag.

Run the same snapshots against the five specified baselines. Blind the variant labels
for human review. Record the prompt and schema hashes produced by prepare.mjs along
with model snapshot, generation settings, source commit and provider usage receipts.
Apply all thresholds in documents/architecture/EVALUATION_ARCHITECTURE.md.

No score or release approval is inferred from deterministic schema/evidence checks.
