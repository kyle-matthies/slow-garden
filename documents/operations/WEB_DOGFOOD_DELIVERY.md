# Web-first delivery and learning record

Status: writing release deployed; AI activation, dogfood study and pilot remain gated
Owner: Kyle
Decision: ADR-006; implementation authorized 2026-09-06

## Baseline reconciliation

Remote main was d2f6fe2 with successful CI and deployment evidence. Local main has
023f991 (business review), plus unrelated active native/decision-log changes.
Those changes remain untouched in the original checkout. This work is isolated on
codex/web-thinking-garden. Review includes the business-review commit already in its base.
Native development ownership is not established by commit authorship; coordinate before
merging overlapping decision-log changes. Do not reset or absorb the working tree.

## Delivery gates

- Source foundation: additive plots and entries; legacy IDs and revisions preserved;
  latest-entry view; idempotent save and stale-edit rejection.
- Writing: garden/plot selection, evolving named thoughts, revision history,
  tab-local drafts, archive/restore, search, full source exports.
- Manual return: permissioned snapshots, isolated source context, ledger and worker,
  separate review. Provider activation remains closed pending evaluation.
- Scheduled tending: deferred until manual value has been observed, not a launch checkbox.
- External invitation: deferred pending lifecycle, restore, privacy and real-use gates.

## Four-week learning record (starts when the writing slice is usable)

Week 1: two or three real thought areas; AI off initially. Record friction after writing,
not as a required form inside the editor. Does this space earn a voluntary return?
Week 2: only after evaluation, try explicit manual reflections; compare a few permitted
snapshots against plain summaries. Record useful, obvious, intrusive, incorrect, or
helped-me-continue judgments. Keep private examples outside Git.
Weeks 3–4: fix the largest observed friction first. Enable scheduling only if wanted.
Identify concrete examples of clearer thinking. Frequency is not a growth score.

At the review, decide separately whether the garden is desirable without AI and whether
AI adds value. Only then invite 5–8 people. Pilot free; a later $12/month continuation
is a hypothesis, not validated pricing. Rebuild economics for web delivery and invoices.

## Rollback

Deploy the writing release with GARDEN_AI_ENABLED=false. Disable ai_runtime.enabled
before rolling back AI code; keep cleanup reconciliation available. Roll application
code back without destructive down-migrations. Additive source tables remain available
for forward fixes. Never discard real entries to restore an old schema.

## Local verification receipt — 2026-09-06

- 53 database assertions passed, including completed-output withdrawal after revocation.
- 14 worker tests passed. These use injected provider responses, not a live model.
- A legacy upgrade fixture preserved all 30 revision IDs, timestamps and body bytes;
  latest-entry selection and a full source export passed after replaying both migrations.
- Web lint, TypeScript and optimized build passed.
- Browser: fresh signup code, garden/plot/seed creation, save, revision history,
  tab-local draft return, archive/restore, and 390px phone layout inspected.
- HTTP canary: OTP single-use, tenant-scoped JSON/Markdown exports with exact UTF-8
  bodies, history, anonymous export denial, and global refresh-token revocation passed.
- Disabled default Next development argument tracing to prevent note-body logging.
- Local and hosted confirmation emails now provide the code requested by the signup UI.
  Hosted subject and token template were saved and reloaded in the Supabase dashboard;
  a fresh production inbox delivery was not sent in this implementation session.
- No OpenAI API key was available in this execution environment. No real provider
  requests, quality scores, overnight scheduler, or private pilot were activated.

## Hosted release receipt — 2026-09-06

- PR #1 merged as `36a5e11841a80b77d59291afcccd2c4d06f8639a` after web and database CI passed.
- Vercel production deployment `6300263055` reported success for that exact commit.
  The custom domain returned the updated landing copy and health 200; anonymous source
  export returned 401.
- All three additive migrations were independently listed in hosted Supabase; a subsequent
  dry run reported the remote database up to date.
- Rollback-only hosted synthetic canary passed source revision/idempotency/export,
  AI defaults, and cross-tenant read/write rejection. Zero canary identities remained.
- Hosted AI runtime readback: disabled, no model, no approval timestamp. Worker and
  scheduler are not deployed. Provider evaluations and lifecycle gates remain required.
- Supabase security advisor reports only the existing leaked-password-protection warning.
  This release uses email OTP. Review [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
  before adding password authentication.
- Original checkout retains eight modified native files, its separate decision-log edits,
  and the untracked living-ecology document. They were not reset or folded into this release.
  The previously unpublished business-model commit is now included in remote main.
