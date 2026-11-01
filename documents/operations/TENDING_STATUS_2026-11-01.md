# Hosted tending status — November 1, 2026

Operator: Codex, under Kyle's instruction to review progress, make needed Supabase
changes, enable overnight tending, and reconcile the repository. No journal bodies,
bloom prose, emails or secrets were retrieved. This receipt contains structural state.

## Verified cause

Two active plots had `ai_enabled=true` and `cross_pollinate=true`; two other active
plots had both disabled. These plot permissions alone never enabled background AI.
The hosted database had no tending migration, account overnight setting, or garden
passes. `private.ai_runtime` was disabled with model null, approval null and workflow
`connect-v2-unapproved`. The project had no Edge Functions, function secrets, `pg_cron`
or `pg_net`. Overnight tending had never been operational.

## Applied and verified

- Applied the exact merged migration `20261010004736_tending_tiers.sql` using
  `supabase db push --linked --yes` to project `sskrghiigqimvxcileqb`. Its migration
  ledger entry was read back; the subsequent dry run reports the database up to date.
- Set the existing sole account's `tend_overnight=true` and timezone to
  `America/Los_Angeles`, matching Kyle's timezone. Readback confirmed both values.
  Plot permissions were preserved, including the two plots that did not opt in.
- Verified RLS on both new tending tables. Anonymous clients cannot finalize passes;
  authenticated users cannot claim jobs; the service role can claim jobs.
- A rollback-only hosted two-user synthetic canary exercised pass preparation,
  rejection of a locked connection tier, completion with one valid catalogue mark,
  owner visibility and second-tenant isolation. The runtime was enabled only inside
  that transaction with a synthetic model and no provider calls. After rollback,
  independent readback confirmed zero synthetic users, zero passes, and runtime off.
- Security advisors before and after show the same pre-existing leaked-password
  protection warning; no new database security warning appeared.
- Current worker runtime: 30 tests passed. Main's latest web/database CI run
  `39065498712` succeeded for `1645ef6`. Docker is stopped locally, so this session
  did not rerun local pgTAP or database lint. The migration's post-apply catalog and
  privilege checks are hosted checks, not a claim of full hosted canary acceptance.
- The CLI reported a local pg-delta cache warning because Docker is stopped. Hosted
  migration application succeeded and was independently verified through the ledger.

## Remaining activation sequence

The account preference is enabled; overnight processing is **not yet operational**.
No real journal was queued or sent to a provider in this session.

1. Configure the dedicated provider project and budget; review retention terms and
   supply its key through a secure worker configuration path. Do not paste keys into
   chat or commit them. No provider key is currently installed in the hosted project.
2. Run and score the synthetic `tend-connect-v3` evaluation, record the approved pinned
   model, hashes, rates and acceptance of the small return (runbook phase 0.4).
3. Install worker-only secrets, deploy the worker while disabled, and complete the
   deployed synthetic lifecycle canaries. Resolve or explicitly accept the documented
   account-deletion cleanup and hosted-restore risks before real-note activation.
4. Pin the evaluated runtime configuration, activate the runtime and verify a real
   manual pass. Confirm the deployed web environment flag as part of this phase.
5. Create and review the scheduling migration described in phase 4b, configure Vault,
   install the hourly nightly-enqueue job and five-minute worker tick, then observe
   an actual night. No scheduling migration currently exists in the repository.

The provider credential is the immediate external prerequisite. Do not flip the
global runtime flag as a substitute for these missing components.

## Development and product follow-ups

All implementation PRs #20–#26 are merged. Local and remote main initially matched
`1645ef6`, with a clean checkout and no open PRs. A recreated remote hardening branch
contains two later commits; its focused-plant and cancelled-turn behavior is already
present on main through the release fixes. Preserve that branch's history while
reconciling it; do not replace main's tested implementation with the older variant.

Physical-phone performance acceptance and prompt-pack image production remain open.
Four-week dogfood, diary/interview research and blind quality study are later evidence
gates. Explore mode, native iOS and team features remain deferred.

## Dependency gate discovered during this review

The first November 1 PR workflow passed database lint, generated-type comparison
and all 109 database assertions, but failed the web dependency audit on newly
published Next.js critical/high advisories and high advisories in Vite and Zod.
Updated Next.js and its ESLint configuration from 16.3.8 to 16.4.3 and refreshed
compatible transitive dependencies (including Vite 7.3.7 and Zod 4.6.7). The existing
audit policy was preserved. The local gate now reports no unexcepted high/critical
advisories; moderate development-tool advisories remain outside that blocking policy.
