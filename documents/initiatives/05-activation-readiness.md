# Feature brief: Worker release-gate receipts and synthetic canary dry run

- Horizon and phase: H1 web dogfood; activation-readiness (initiative 5 of the September 2026 wave)
- Status: Implemented offline; hosted receipts outstanding
- Owner: Kyle (delivered by an initiative agent)

## User problem

The manual reflection runtime is executable scaffolding behind closed gates. Its README
named gates with no receipts: provider retry/idempotency, expired provider jobs, account
deletion with pending provider work, and a hosted restore. Without receipts, nobody can
say whether turning the runtime on would leak files at the provider, charge for work the
person no longer wants, or settle a pass twice. The person writing in the garden never
sees any of this, which is exactly why it must be proven before activation.

## Why delay or accumulation matters

The runtime is asynchronous by design: a pass is submitted, waits up to a day at the
provider, and returns later. Every failure mode of interest (expiry, cancellation while
in flight, duplicate delivery, a worker losing its lease mid-completion) exists only
because of that delay. A synchronous chat product would not have these gates; Slow Garden
must earn the return by handling them quietly and cleaning up after itself.

## Proposed capability

No user-visible behavior changes. The runtime gains explicit handling for expired jobs and
duplicate results, an offline canary proves the control flow end to end against a fake
provider, and an activation runbook lists every go/no-go check with the evidence required.

## Trust and agency

- The runtime reads only frozen snapshots supplied by the ledger and writes only through
  the four service-role RPCs. It never contacts a browser and never logs provider bodies.
- The canary uses synthetic text and an in-memory provider; no network, no env vars, no
  secrets. Its report contains states and counts only, with a self-check that no fixture
  text leaked into the output.
- The runbook forbids real gardens as canaries and requires every receipt to be free of
  note bodies, bloom prose, and addresses.
- `GARDEN_AI_ENABLED` and `private.ai_runtime.enabled` remain `false`. Nothing here
  activates a provider.

## States and failure modes

| Case | Runtime behavior |
|---|---|
| Deadline expiry (pass older than 30 h) | Cancel the provider batch if still running, fail the pass, never download the result; cleanup later deletes files |
| Provider expiry (batch reports `expired`) | Fail the pass; cleanup deletes any partial output and error files |
| Cancelled in flight | Request provider cancellation, wait for terminal evidence, then delete files and settle; a batch already `cancelling` is not re-cancelled |
| Duplicate result lines in the output file | Reject as `duplicate_provider_result`, fail the pass, store nothing |
| Settled pass claimed again | Cleanup only; never re-downloaded or re-finished |
| Lost lease during completion or on the failure path | Return `lease_lost` with no further writes; the ledger's idempotent `finish_garden_pass` guarantees one settlement |
| Retryable provider error | Release the lease up to five attempts, then fail |
| Budget stop | Enforced by the ledger at pass creation (`AI budget reached`); runtime disabled → active passes idle, cleanup continues |
| Account deletion with pending work | **Gap**: `pass_inputs` cascades on delete and provider ids are lost (proposed migration below) |
| Hosted restore | **Gap**: never exercised |

## Acceptance evidence

- `node --test services/garden-worker/runtime.test.mjs` covers each gate above.
- `node scripts/canary-dry-run.mjs` completes offline with `ok: true`, zero provider files
  remaining, and a content-free report.
- `documents/operations/AI_ACTIVATION_RUNBOOK.md` has explicit go/no-go checks for every
  phase, including the gaps that cannot yet be receipted.

## Dependencies and non-goals

Depends on the evaluation corpus (initiative 4) and security review (initiative 9) for
their own receipts; this initiative only references them from the runbook. Non-goals:
activating any provider, creating cloud resources, applying migrations, scheduled tending,
changing the web UI.

## Implementation receipt

Built:

- `supabase/functions/_shared/garden-runtime.mjs`: `runOne` accepts an injectable `now`;
  deadline expiry cancels a live provider batch before failing; provider `expired` returns
  `{state:"expired", reason:"provider"}`; batches already `cancelling` are not re-cancelled;
  ledger errors are tagged and the failure path returns `lease_lost` instead of throwing or
  writing; `parseBatchLine` rejects multi-line output as `duplicate_provider_result` and
  tolerates a trailing blank line. `passDeadlineMs` is exported.
- `services/garden-worker/runtime.test.mjs`: tests for deadline expiry with and without a
  provider batch, expiry against terminal/cancelling batches, provider expiry, cleanup
  after expiry, duplicate result lines, settled-pass cleanup, lost lease during completion
  and on the failure path, retry budget, and cancelling-batch cleanup.
- `scripts/canary-dry-run.mjs`: offline canary with an in-memory ledger that mirrors the
  RPC semantics in `20260907004656_manual_garden_passes.sql` (leases, idempotent finish,
  reservations, cleanup queue, hard cap) and a fake provider; scenarios for submit and
  complete, cancel in flight, deadline expiry, provider expiry, budget stop and disabled
  runtime, duplicate result, and lost lease; content-free JSON report with a leak self-check.
- `documents/operations/AI_ACTIVATION_RUNBOOK.md`: phased go/no-go checks and rollback.
- `services/garden-worker/README.md`: lifecycle rules and canary instructions.

Verified locally on Node 22 (2026-09-10):

- `node --test services/garden-worker/runtime.test.mjs`: 25 tests, 25 pass (14 existing,
  11 new). One new test found a real defect while writing it: a retryable error at the
  fifth attempt was finished as failed in the ledger but reported `retry_scheduled`; fixed.
- `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json`: exit 0,
  7 scenarios passed, 0 failed, `files_remaining: 0`, content-free self-check passed.
- `npm --prefix applications/web ci`, `npm --prefix applications/web run lint`,
  `npx tsc --noEmit`, `npm --prefix applications/web run build`: pass (no web code
  changed; run as the wave requires).

Observed but not changed: cleanup may call `deleteFile` twice for the same output file id
(once from the batch record, once from the ledger record). The provider client treats a
404 on delete as success, so this is idempotent; the test asserts the deleted set.

Not verified:

- Anything hosted: provider idempotency, real batch cancellation latency, real costs,
  function deployment, scheduler, logs, restore. The canary's fake provider encodes
  assumptions about provider behavior that only the hosted canaries in the runbook can
  confirm.
- The fake ledger is a model of the SQL functions, not the SQL itself; the database tests
  under `supabase/tests` remain the authority for ledger behavior and were not extended.
- Account deletion with pending provider work (no runtime path exists yet).

## Follow-ups

- **Proposed migration (not applied):** `private.provider_orphans(pass_id uuid,
  provider_id text, input_file_id text, output_file_id text, queued_at timestamptz)`
  populated by a `before delete` trigger on `private.pass_inputs` when `cleanup_pending`
  is true, plus a `claim_provider_orphan` / `finish_provider_orphan` RPC pair and a worker
  branch that drains it. Content-free by construction; unblocks runbook check 3.9.
- **Proposed decision:** whether a deadline-expired pass whose batch has already
  completed should consume the result (charging actual cost) or discard it (current
  behavior: discard, charge full reservation).
- **Proposed decision:** accept or reject the residual risk of unverified provider
  `Idempotency-Key` support before Phase 3 canaries; if rejected, add a ledger-side
  guard that records a "batch creation attempted" marker before `createBatch`.
- Extend `supabase/tests/thinking_garden.sql` with a duplicate `finish_garden_pass` call
  and a cleanup-after-expiry sequence so the SQL matches the fake ledger's model.
- Hosted restore exercise on a Supabase branch (runbook 3.10).
- Roadmap note for the wave owner: initiative 5 is complete offline; hosted receipts are
  a separate gate that requires Phase 1–3 of the runbook.
