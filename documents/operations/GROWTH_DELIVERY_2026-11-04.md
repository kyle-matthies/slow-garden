# Slow Garden growth delivery — November 4, 2026

Owner: Kyle. Execution: Codex with parallel specialist agents.
Base: `1337002`. Goal: deliver at least five useful growth/product changes, reviewed
and tested, with clean synchronized main and a dated delivery record.

## Product and GTM decision

The near-term customer is a reflective writer with scattered ongoing questions,
not a team buying a knowledge platform. The wedge is a quiet private place that is
useful before AI: capture an unfinished thought, return to it, and inspect small
source-linked tending when available. The primary growth constraint is trustworthy
activation and repeat value, rather than a shortage of acquisition channels.

Evidence: the public landing page uses abstract seed/bloom language; first-run setup
keeps its progress and writing only in React state; import has no exception recovery
around a multi-file run; recent writing exists mainly in the alternate list view;
overnight preferences and AI availability are easily mistaken for a working schedule.
The November 2 supervised pass produced catalogue marks without connection blooms;
automatic nightly processing remains a separate activation gate.

Hypotheses below are product judgments, not measured conversion or retention gains.
No analytics vendor, advertising campaign, pricing, outreach or public-note sharing
is authorized by this wave. No activation gate is bypassed.

## Selected workstreams

| ID | User outcome / growth mechanism | Scope and owner | Acceptance | State |
|---|---|---|---|---|
| G1 | Understand the product and take a credible first step | Landing positioning and concrete product walkthrough; positioning agent | Clear writing-first proposition, one primary CTA, truthful AI/privacy claims; responsive and accessible | Implemented; reviewed and tested |
| G2 | Reach a first saved entry without losing setup work | Recoverable first-run flow; onboarding agent | Tenant-scoped recovery, stable request IDs, no duplicate area creation, no lost first draft, accessible steps | Implementing |
| G3 | Bring existing writing in with confidence | Import preview, target and retry reliability; import agent | Failures retain preview and selections; correct garden/topic; retry is safe and success is accurately reported | Implemented; reviewed and tested |
| G4 | Know what tending actually did and what is only a preference | Settings status and read-only pass history; root | Saved opt-in, app availability and observed pass status are distinct; history failure is not “no runs”; no automatic-delivery promise | Implemented; independent review passed |
| G5 | Resume earlier writing directly from the primary garden | Bounded recent-writing surface; positioning agent, second lane | Exact entry links, current garden/topic scope, archive exclusion, empty state, keyboard/mobile access; no nagging or engagement ranking | Implementing |

The four-agent runtime limit means overlapping batches, not five simultaneously
running agents. Each lane has an isolated Code-rooted worktree and owns distinct
files. Root owns integration changes to workspace/types/data and this plan.

## Engineering review and risk controls

- Reuse the existing Next.js, Supabase/RLS, action, draft, import and navigation
  contracts. No new framework, provider, table, schema migration or billing surface.
- Preserve all user source and dirty work. Do not read real private journal bodies
  for development or copy production content into tests or screenshots.
- Onboarding storage must isolate tenants and respect sign-out clearing/tombstones.
  Import must not silently retry uncertain writes or call a failed batch “done.”
- Pass history uses authenticated RLS and minimal operational fields. Do not infer
  an active scheduler from an opt-in, UI flag, trigger label or completed manual pass.
- Recent-writing navigation uses stable identifiers; archived thoughts/topics must
  not leak into active recommendations. No notification, streak, guilt or ranking
  by engagement. Draft/editor behavior stays unchanged.
- No speculative external spend, automatic real-note processing, email, publication
  of private content or research recruitment is part of this wave.

## Validation and rollout

1. Each lane writes a short record under `documents/initiatives/growth-20261104/`,
   implements meaningful regression coverage, and reports its commit and checks.
2. Root reviews each diff and its failure paths before merging it into integration;
   cross-review by another available specialist for consequential state changes.
3. Run Node 22 worker, web/node/component tests, lint and production build. Use
   synthetic browser fixtures for mobile/desktop, keyboard, navigation, reload and
   failure states. Keep visual evidence content-free or synthetic.
4. Open reviewable PRs in integration-safe batches, require green CI and preview,
   merge when ready, verify production identity/health and synchronize local main.
5. Record shipped commits/PRs, actual evidence, remaining human/device gates and
   rollback. No invented claims of measured commercial impact.

## Measurement plan

Evaluate the release first through deterministic journey success: landing-to-entry
path clarity, recoverable setup, recoverable import, correct tending state and
exact-entry resume. During later authorized dogfood, measure first saved entry,
repeat voluntary writing, import completion and helpful returns from content-free
counts plus user interviews. Do not add tracking or treat clicks/keep rates alone
as proof of reflective value. Four-week dogfood and blind quality research remain
separate evidence gates.

## Rollback and next phases

All changes are additive UI/behavior changes and can be reverted by lane commit.
There is no hosted schema or runtime mutation to undo. Stop the release if source
recovery, tenant isolation, import idempotency or exact-entry navigation regresses.
Later phases remain automatic tending activation, real-device performance,
artwork, dogfood and qualitative research. Broad launch and pricing wait for that
evidence.

## Delivery log

- Planning: five workstreams selected from source inspection; three specialists
  started concurrently, with root implementing G4 and owning integration.
- First integration batch: G1, G3 and G4 pass 78 component/unit tests, 75 node tests,
  31 worker tests, lint and production build. G1 also passed synthetic browser
  checks at 390/1280 in light/dark. G4 passed independent review by the import agent.
  Full axe/contrast/overflow harness is running on the combined branch. G2 is
  receiving an independent draft-isolation review before integration.
