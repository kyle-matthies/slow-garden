# G5 · Resume recent writing

Status: Integrated; independent review, regression tests and synthetic browser journeys pass. Release tracked in the [delivery plan](../../operations/GROWTH_DELIVERY_2026-11-04.md).

## Problem and hypothesis

The primary scene does not offer a small route straight back to a recently saved
entry. The older list-only Recent entries section ranks by creation time and can
repeat the same thought. Hypothesis: a quiet, optional resume surface will make
return visits useful without introducing reminders, streaks or pressure to write.

## Delivered slice and integration contract

`RecentWriting` is a collapsed native disclosure titled Continue writing. It shows
at most three distinct thoughts, each with its topic, title, saved timestamp and
an Open saved entry action. Recent edits count as writing activity. No note body
or AI prose appears in the compact surface; no browser persistence or extra data
query is added.

```tsx
<RecentWriting
  data={data}
  plotId={plotId}
  onNavigate={(topicId, thoughtId, entryId) => navigate(topicId, thoughtId, "", entryId)}
/>
```

The workspace renders it outside the `GardenScene` pointer/keyboard gesture region,
only in the active garden/topic overview and while plant focus is closed. The
existing list-only Recent entries remains available in the alternate List view.
The component returns null when no eligible saved entry exists; it never creates
an empty disclosure or a button without a valid destination.

The pure helper uses only the already-loaded garden data. It excludes unknown or
archived gardens, topics, thoughts and entries, as well as mismatched/dangling
parents. An optional topic filter stays within the current garden. One exact
entry per thought is selected by the latest creation/revision instant; timestamp
ties are stable, invalid timestamps are handled, and input arrays are not mutated.

## Acceptance

Tests cover current-garden/topic scope, every archival level, distinct-thought cap,
edited-entry ranking, timestamp offsets, malformed dates, stable ties, exact
navigation callbacks, accessible native disclosure/labels, and no-body rendering.
Production-build browser checks pass at 390/1280 in light/dark: keyboard expansion,
three distinct saved thoughts and exact-entry navigation with a visible target.
No retention lift or physical-phone acceptance is claimed.

Node 22 local validation passed: nine focused helper/component tests, ESLint,
production compilation and TypeScript. No workspace, scene, global stylesheet,
domain type, hosted service or dependency file was changed by this lane.
