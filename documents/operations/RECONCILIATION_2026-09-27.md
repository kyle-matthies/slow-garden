# September implementation reconciliation

Status date: 2026-09-27. Scope: repository and planning reconciliation, not new product acceptance.

## Verified integration evidence

- [Integration PR #6](https://github.com/kyle-matthies/slow-garden/pull/6) merged on September 11 as `db83d5a073c8e2f588df44a8d58c32f5359e46f3`.
- GitHub reports all PRs #1–#16 merged. All eleven retained feature branch tips are ancestors of that main commit; there is no feature branch awaiting integration.
- [Main CI](https://github.com/kyle-matthies/slow-garden/actions/runs/34618501566) passed for that commit. Its web job includes dependency audit, worker runtime tests, lint, Vitest, Node suites, and build; its database job includes lint, database tests, and generated-type comparison.
- The [final combined-tree review](FINAL_WAVE_REVIEW_2026-09-11.md) records local synthetic browser and accessibility checks. Those are historical local receipts, not physical-device or current hosted verification.
- Existing deployment receipts retain their original dates and scope. This reconciliation does not independently establish the current production revision or close hosted gates.

## Residual local work

The old integration merge `c1c4bcd` contributes no unique resolution: both parents are already in main and its remerge diff is empty. The two old review worktrees contain the same 22 changed screenshot receipts, plus reproducible build/dependency output. Screenshot comparisons show integrated editor/search controls, login copy changes, and rendering differences. They are preserved locally with branch history, binary patches, hashes, and restoration instructions. Their exact capture conditions are not established well enough to replace committed acceptance receipts. No residual code needs merging.

## Prioritized remaining roadmap

These priorities are a reconciliation recommendation within the accepted web-first plan. They do not authorize activation, migrations, or an external pilot.

| Priority | Work and why | Dependencies / next action | Completion evidence |
|---|---|---|---|
| 1 | Protect writing across first run, draft recovery, and session changes. Loss of writing blocks dogfood. | Review first-run textarea persistence and remaining component tests; run synthetic reload, tab-close, restart, concurrent-tab, save, and sign-out journeys against the integrated revision. | Revision-linked browser receipts; recovery preserves newer writing; explicit K-015 disposition. |
| 2 | Close device and accessibility gaps. Emulated width does not prove usable phone or screen-reader behavior. | Check keyboard focus after navigation, physical Safari/iOS, VoiceOver, zoom, and reduced motion. Reconcile historical axe follow-ups before adding CI coverage. | Physical-device and assistive-technology receipts; corrected failures; repeatable accessibility checks. |
| 3 | Establish whether the no-AI garden earns voluntary return. This is the next product question in WEB_DOGFOOD_DELIVERY.md. | Use two or three real thought areas; record friction privately and fix the largest observed problem. Validate import/export with synthetic sources and separate real-use observations from test data. | Four-week learning record, examples of clearer thinking, explicit desirability decision; no frequency or streak proxy. |
| 4 | Evaluate manual reflections before provider activation. A deterministic corpus is not evidence of useful model output. | Resolve reviewer rules for either/no-output cases; prepare blinded human scoring and comparison with plain summaries under separately approved provider/data scope. | Threshold scores, provenance/correction review, and explicit activation decision. |
| 5 | Close lifecycle/security gates before AI or external pilot. Deletion, cleanup, restore, and tenant isolation require operational evidence. | Resolve orphan-provider cleanup design and proposed migration through its own approval; exercise hosted restore and synthetic-only canaries; review CSP, draft protection, and export-auth decisions. | Runbook go/no-go receipts, cleanup/restore and isolation evidence, approved decisions. |

Scheduled tending, native iOS expansion, botanical scrapbook, Explore mode, and team features remain deferred. A merged implementation does not close these product gates.

## Historical follow-up reconciliation

- Evaluation corpus Node tests already run through `npm run test:node` in CI; do not add a duplicate step solely because the original wave plan suggested it.
- The final review records the labelled plant section and integrated axe run. Navigation focus and physical-device acceptance still require their own evidence.
- Other historical follow-ups must be checked against current source before implementation; their presence is not proof that code is absent.
