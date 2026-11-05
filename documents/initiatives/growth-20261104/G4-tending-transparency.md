# G4 — Trustworthy tending status

Hypothesis: people can trust and interpret tending when permission, app availability
and observed processing are described separately. Saved opt-in is not delivery proof.

Implemented a garden-scoped, authenticated RLS read of the five latest pass states
and timestamps. No snapshots, provider identifiers or output prose are read for the
status panel. A failure is shown as unavailable, not as “no runs.” Completed passes
and catalogue-only returns are explained without claiming an active scheduler.

Preference saves now say “preference saved” rather than “tending is on,” restore
the last confirmed state after failure, and retain valid stored timezone aliases
that the browser's canonical timezone list may omit. Existing derived marks remain
available even when the app's AI request controls are disabled.

Acceptance: tests cover scoped/bounded metadata reads, empty versus failed history,
catalogue-only completed passes, failed update/network rollback, and timezone aliases.
No hosted configuration, runtime gate, schema, source writing or scheduling changed.
Business conversion/retention impact is a hypothesis; no new tracking is installed.
