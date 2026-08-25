# Journeys and state model

Status: Prototype interaction contract
Date: 2026-08-25

## Core journey

```text
Enter quiet garden -> plant or revise seeds -> arrange if useful -> leave
       -> cadence reaches threshold -> snapshot freezes -> garden pass runs
       -> return reveals 0-3 blooms -> inspect evidence -> respond
       -> keep/correct/prune/promote -> continue thinking
```

The garden is fully usable before and between passes. Processing never blocks capture.

## Journey map

| Moment | User intent | Primary surface | System behavior | Failure-safe outcome |
|---|---|---|---|---|
| First seed | Put down an unfinished thought quickly | Empty Garden with one calm insertion point | Save source and initial revision silently | Local draft survives; no onboarding funnel blocks capture |
| Ongoing capture | Add fragments without entering dialogue | Garden | Save revisions; no inline completion or response | Explicit offline state and retry queue |
| Arrange | Express a tentative relationship | Spatial Garden | Preserve position and optional path as user-authored context | Undo and history; never infer that proximity equals truth |
| Let grow | Decide this material can be processed later | Pass control | Show cadence and depth separately; estimate eligible snapshot | Material remains private and unprocessed if declined |
| Wait | Leave without managing a job | Garden or closed app | Snapshot only at the declared trigger; process in background | Clear queued/failed state without urgency notification |
| Return | See whether anything was earned | Garden Return | Reveal at most three blooms or a calm no-bloom receipt | No fabricated result, no pressure to add content |
| Review | Understand a possible connection | Bloom Detail | Show claim, class, uncertainty, exact evidence, and research separately | Sources remain accessible if generation failed partially |
| Correct | Restore agency after a bad interpretation | Bloom Detail | Record correction against derived artifact and future garden rule | Original sources unchanged; correction reversible |
| Archive | Remove old material from active attention | Garden archive | Preserve exportable history and lineage | Restoration available within retention promise |
| Promote | Turn a useful interpretation into owned knowledge | Bloom Detail | Create preview and receipt for explicit destination approval | No destination mutation on cancel or failure |

## Domain glossary

- **Garden:** a bounded thinking space with its own sources, cadence, processing depth, and correction memory.
- **Seed:** user-owned source material: text, question, link, image, or attachment.
- **Revision:** immutable version of a seed’s content and metadata.
- **Bed:** optional user-authored region that gathers seeds without requiring a taxonomy.
- **Cluster:** a temporary visual grouping; whether user-authored or system-suggested must be explicit.
- **Path:** a user-authored relationship between seeds. System suggestions remain separate until accepted.
- **Snapshot:** immutable list of exact seed revisions and layout context eligible for one pass.
- **Garden pass:** asynchronous processing of one snapshot under a named mode and policy version.
- **Bloom:** bounded derived interpretation with evidence, uncertainty, and lifecycle.
- **Evidence link:** relation from a bloom claim to an exact source revision or dated external source.
- **Response:** user judgment on a bloom, including corrections and recurrence preferences.
- **Workflow proposal:** non-executing preview of possible work for a later horizon.

## Source behavior

- Creating a seed commits an initial revision after a short local debounce; an explicit saved indicator is available but not celebratory.
- Editing creates a new immutable revision. Passes already snapshotting retain the prior revision and visibly disclose it.
- Deleting moves a seed to recoverable trash and excludes it from future snapshots. Existing bloom provenance records that the cited source was later deleted without resurrecting its content into the active garden.
- Restoring creates a restoration event and preserves revision history.
- Attachments have upload, local-only, processing-eligible, excluded, failed, and deleted states.
- Spatial movement is versioned separately from content so a drag does not create a textual revision.

## Garden-pass state machine

```text
eligible -> queued -> snapshotting -> processing -> complete
              |           |              |           |
              v           v              v           v
          cancelled     failed     partially_complete stale
                                           |
                                           v
                                      resumed/complete

Any newer eligible snapshot may mark an older unreviewed result superseded.
```

- **Eligible:** cadence, minimum evidence, and permissions permit a pass.
- **Queued:** trigger recorded; cancellation still prevents provider dispatch.
- **Snapshotting:** exact revisions and policy version are being frozen.
- **Processing:** bounded workflow is running; capture continues against newer revisions.
- **Partially complete:** one stage failed; only independently supported finished blooms may be shown.
- **Complete:** processing receipt exists, including a valid zero-bloom outcome.
- **Failed:** no trustworthy return can be shown; retry uses the same snapshot unless the user chooses latest.
- **Cancelled:** dispatch stopped where possible; provider cancellation limits are disclosed.
- **Superseded:** a newer pass replaces the result as the default return, while history remains inspectable.
- **Stale:** cited sources changed materially before review; bloom remains historical and cannot be promoted without revalidation.

## Bloom lifecycle

```text
new -> viewed -> kept -> promoted
          |        |          |
          +-> corrected ------+
          +-> pruned
          +-> superseded
```

Promoting creates a new user-owned artifact with an acceptance receipt; it does not convert or overwrite the system bloom. Corrected and pruned blooms stay available in history for evaluation unless deleted under the retention policy.

## Canvas contract

### Desktop pointer

- Click empty space to create; drag a dedicated handle to move; text selection never drags a seed.
- Wheel or trackpad pans by default only when focus is not inside text. Zoom remains bounded and visible.
- Lasso and multi-select are progressive features, not required for first capture.

### Keyboard

- A global new-seed shortcut works whenever it will not steal text input.
- Tab order follows a stable logical order independent of arbitrary x/y placement.
- Arrow-key movement is available in an explicit arrange mode with announced position changes.
- Every pointer action has a keyboard route; provenance and correction never require hover.

### Touch and small screens

- Tap creates or opens; long-press enters arrange mode so scrolling remains reliable.
- iPhone defaults to a focused neighborhood or structured outline, not a miniaturized infinite canvas.
- Source capture, return review, provenance, and correction remain complete on small screens; large-scale arrangement may be simplified.

### Accessibility and motion

- Structure is exposed as a list/tree alternative with user-authored beds and paths.
- Source, inference, research, and status never rely on color alone.
- Reduced motion replaces travel, swirl, and growth with opacity, focus, and discrete state changes.
- Large text reflows bloom details into a single column without truncating evidence.

## Secondary lenses

Chronology, search, filters, tags, and project context are ways to locate or temporarily view material. They do not become the home surface. Search results open back into the relevant garden neighborhood. Tags remain optional; the first seed never requires classification.

## Meadow and Cabinet views

The Garden has two task postures over the same objects:

- **Meadow:** source-forward capture, spatial exploration, and sparse living blooms with collapsed evidence.
- **Cabinet:** one selected bloom, its exact source clippings, uncertainty, provenance, and response controls.

“Review clipping” opens Cabinet without creating a new bloom or snapshot. “Return to meadow” restores viewport, selection, and focus. Keep, Correct, or Prune updates the same bloom lifecycle from either route; the alpha presents those controls in Cabinet to protect Meadow’s quiet foreground. See [the visual-system contract](MEADOW_AND_CABINET.md).

## Cadence and depth

Two independent controls prevent “more aggressive AI” from becoming ambiguous:

- **Cadence:** manual, weekly default, or a future explicit schedule.
- **Depth:** Tend, Connect, or Explore.

“Let this grow” requests one manual pass from the latest eligible snapshot. It does not enable a recurring schedule or increase depth.

## Notifications

- Notify only when a user-enabled pass has a reviewable outcome, fails in a way requiring a decision, or cannot proceed because a permission changed.
- Never use urgency, emotional personalization, or streak language.
- A zero-bloom pass may appear quietly in the garden history without a push notification.
- Notification previews contain no private note or bloom content by default.

## Required prototype states

- Empty first garden and empty existing garden.
- Local draft, saving, saved, offline, reconnecting, and conflict.
- Queued, snapshotting, processing, partial, failed, cancelled, stale, superseded, and zero-bloom pass.
- New, kept, corrected, pruned, promoted, and stale bloom.
- Contradictory evidence with no system resolution.
- Missing/deleted source and unavailable external citation.
- Reduced-motion, keyboard-only, large-text, and structured-list alternatives.
