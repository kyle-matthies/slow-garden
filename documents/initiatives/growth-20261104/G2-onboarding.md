# G2 — Recover the first entry

Status: Integrated; independent review, regression tests and synthetic browser recovery pass. Release tracked in the [delivery plan](../../operations/GROWTH_DELIVERY_2026-11-04.md).
Date: November 4, 2026

## Product bet

A first visit currently asks the person to create a garden, topic and thought before
writing. A reload after saving the garden can bypass the remaining setup, and a
reload during writing loses the body. Reliable continuation should improve the
chance that a new person reaches a first saved entry. This is a hypothesis, not a
measured conversion gain; this change adds no tracking or engagement pressure.

## Delivered

- Back up names, current step, successful entity IDs, request IDs and first-entry
  writing through the existing tenant-scoped draft backend: IndexedDB, with the
  existing per-tab session-storage fallback. No new storage vendor or schema.
- Persist generated IDs before network calls. An ambiguous failure/reload can
  replay the existing idempotent server actions rather than creating duplicates.
- Restore the checkpoint before enabling inputs. If recovery storage cannot be
  read, do not overwrite its existing checkpoint; explain the limited backup state.
- Existing sign-out cleanup clears this record through the normal draft backend.
  Tombstones and the existing cross-tab clear broadcast block deferred writes;
  an in-flight write is conditionally removed if sign-out happened while it waited.
- Isolate component sessions by tenant. Prefer the current tab's saved state and
  do not automatically copy a live foreign tab. Recovery from an inactive tab is a
  copy: the source is never deleted. A content-free completion marker applies only
  to its own tab, so B finishing cannot hide or delete A's unfinished writing.
- Keep progress and backup/recovery state visible and announced. Focus the active
  field after recovery/step changes. Input remains quiet and source text unchanged.

## Workspace integration

The workspace decides whether FirstRun mounts. Its prior test only checked whether
the server had any gardens, which misses a checkpoint after the first garden saved.
The workspace now imports `loadOnboardingDraft` and has a mount effect keyed by
`data.tenantId`. A recovered checkpoint sets `firstRun=true`. Cancellation on
unmount/tenant change and a completion ref set by `onDone` prevent a delayed read
from reopening a completed flow. No data/schema change was needed.

The helper returns `Promise<{state: OnboardingDraft; record: DraftRecord} | null>`.
Its optional backend/strict/tab arguments support bounded tests. The component
itself has a tenant-keyed inner session; callers need no extra `key` prop.

## Evidence

Node 22.23.4:

- Twelve focused helper/component tests pass. Cases include failed-save/remount
  request-ID replay, first-entry body/entry/revision recovery, completion, tenant
  isolation, unreadable storage, queued/in-flight sign-out races, newest-record
  ordering and an unchanged live A draft surviving B's independent completion and
  A's reload.
- Full Vitest suite, lint and production build pass in this lane.
- Combined release: 99 Vitest tests. The production-build browser harness verifies
  real IndexedDB backup/reload and a synthetic step-four checkpoint reopening even
  with an existing garden, at 390/1280 in light/dark mode.
- Independent peer review identified a first implementation's unsafe foreign-tab
  checkpoint deletion/global completion suppression. Both were removed before
  integration; the explicit two-tab regression now covers the reported failure.

## Limits

No physical-phone acceptance or production conversion experiment is claimed.
When all browser storage is unavailable, the session remains usable with a warning
and unload protection, but cannot promise reload recovery. Existing completed source
records are authoritative. Inactive cross-tab recovery intentionally keeps its
source copy rather than risking another tab's writing; an old copy can therefore
be offered again in a different new tab. An explicit cross-tab discard/transfer UI
is a separate refinement. No note content enters telemetry or public receipts.
