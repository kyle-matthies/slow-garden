# Provenance-validator spike

Status: Passed as a deterministic contract probe on 2026-08-25

Question: Can the pre-persistence boundary reject more than three blooms, claims without evidence, unknown snapshot handles, mismatched excerpts, and Explore-only research inside Connect?

Run:

```bash
node spikes/provenance-validator/provenance-validator.mjs
```

The probe uses a deliberately small handwritten validator. Production code will use a strict JSON Schema before the same semantic checks. This receipt proves the rules are executable, not that the final parser is secure.

