# Slow Garden agent contract

## Project state

This repository is planning-first. Do not install a framework, create cloud resources, apply database migrations, or choose a production vendor unless the corresponding roadmap gate and architecture decision record are complete.

## Product invariants

- Protect uninterrupted human thinking. Do not introduce chat, autocomplete, live critique, or automatic rearrangement into the capture experience without an explicit product decision.
- Preserve authorship. User-authored source and AI-derived interpretation must be distinguishable in storage and UI.
- Preserve provenance. Every derived claim must be traceable to source revisions and, when used, external research.
- Prepare before acting. Background processing may generate private insights and proposals; consequential project, code, communication, publication, or external-system actions require explicit approval.
- Earn the reveal. Sparse or unchanged input should produce no fabricated insight.
- Keep the return small. Default to no more than three blooms per processing cycle until research supports another limit.

## Repository rules

- Keep canonical planning records under `documents/`.
- Record durable product or architecture choices in `documents/DECISION_LOG.md` or a dedicated architecture decision record.
- Keep private journal data, credentials, exported personal records, and generated private artifacts out of Git.
- Put disposable work in `prototypes/`; do not quietly promote prototype code to production architecture.
- Add implementation directories only after their owning architecture task is decided.
- Use `/Users/kylematthies/Code/bin/workspace-guard` before repository changes and preserve any dirty work.
- Treat committed files under `supabase/migrations/` as the only durable authority for hosted schema changes. Create migrations with `supabase migration new`, exercise them locally, and apply the reviewed file to the project; never leave direct experimental DDL only in hosted state.
- The root `.mcp.json` deliberately scopes compatible coding agents to the Slow Garden project and to database, debugging, development, and documentation tools. It contains no credential; authenticate interactively and keep tool-call approval enabled.
- Production MCP reads are catalog, policy, count, or synthetic-canary reads by default. Never retrieve private note bodies, bloom prose, email addresses, or other tenant content for agent context without explicit authorization for that exact diagnostic.
