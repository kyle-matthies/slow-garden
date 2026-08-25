# ADR-004: Pinned model adapter with evidence-first release gates

- Status: Accepted
- Date: 2026-08-25
- Owner: Kyle
- Roadmap phase: 1.3 and 2.1

## Context

Model speed and prose quality do not prove the product thesis. A changing alias also makes regressions and corrected reruns impossible to interpret.

## Decision

Use a provider-neutral adapter, pinned model snapshot, strict structured output, no tools in Tend/Connect, stored prompt/schema/policy hashes, and a versioned evaluation corpus. Model selection is made by the release rubric, not by “latest” status. Plan costs using a conservative mini-model ceiling and block at the database budget gate.

## Evidence and rationale

Current OpenAI documentation confirms Batch lifecycle, usage reporting, model snapshots, and structured-output support. The local cost spike shows expected and stress scenarios below the proposed cap, while a runaway schedule exceeds it.

## Consequences

Changing prompts, policy, schema, adapter, or model creates a workflow version and full regression. Real private cases are excluded from CI by default. Explore tools remain a separate later workflow.

## Verification and rollback

The 48-case corpus and comparative baseline must pass all thresholds in `EVALUATION_ARCHITECTURE.md`. Rollback moves the active workflow pointer to the prior accepted version; historical pass metadata remains unchanged.

