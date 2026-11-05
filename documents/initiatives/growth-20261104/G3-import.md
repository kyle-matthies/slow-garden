# G3 — A trustworthy existing-note import

Status: Implemented and locally verified; parent integration and browser QA pending
Date: 2026-11-04

## Product decision

Existing notes are a useful starting point for a private garden. Improve completion
and confidence by making local preview, explicit saving, partial failure and safe
retry visible. Keep source dates and existing deterministic import identities intact.

## Observed problems

- A file-read rejection aborts preview without recovery; competing selections can
  allow a slow, older selection to overwrite the newest preview.
- The form reports done even when imports fail. Successful files remain selected,
  making a retry reprocess successful work instead of only the failures.
- Topic, garden, title and file selection remain editable during an import.
  Changing a partially imported file's title or destination changes its identity,
  so an apparent retry can create a second thought.
- Imported thoughts have no direct continuation link.

## Bounded plan and acceptance

1. Isolate file-read failures, handle duplicate file metadata, and ignore stale
   preview work. Say explicitly that preview stays in the browser until confirmation.
2. Lock each attempted import's destination and title, distinguish successful and
   failed files, and retry only selected unsuccessful files using identical input.
3. Report actual completion and offer direct links to successfully imported thoughts.
4. Add component regression tests covering partial success/retry, rejected actions,
   read failure and preview races. Run lint, tests and production build.

No schema, model, parser, source-date, analytics or provider changes are planned.
No real journal files are used in tests.

## Delivered

The preview isolates unreadable files, ignores stale selections, and gives duplicate
file metadata independent controls. It explicitly explains that previews stay local
and abbreviate long entries while imports preserve full text. Invalid titles and
stale topic selections cannot be submitted.

Each import attempt freezes its title and destination to preserve deterministic
identity through partial failure. Completed files are not retried; thrown requests
and returned failures remain eligible for a safe retry. Completion reports actual
saved/failed counts and links directly to successful thoughts. A deliberate new
import releases the destination and starts a clean preview.

## Evidence

Node 22.23.4, synthetic fixtures only:

- Seven component regression cases pass: partial completion/identical retry, thrown
  request, pending-control locks/new import, unreadable file isolation, preview
  race, duplicate metadata/stale topic recovery, and invalid title correction.
- Full Vitest suite: 68 tests passed across 16 files.
- Node suite: 75 tests passed, including the unchanged import-core date/replay tests.
- ESLint and production build passed. The final component tests and build were
  repeated after adding explicit stale-topic selection recovery.

Growth hypothesis: making import failures recoverable and completion truthful helps
people reach a useful garden with their existing writing. No conversion improvement
is claimed without observed use. An integrated browser check should upload two
synthetic files, confirm no request before saving, simulate a failed action, and
verify that the preview survives and retry uses the same destination/title.

Limit: preview/retry state is held in the open tab, not persisted to disk. Reloading
requires selecting the original files again; previously saved writing remains in
the garden and the deterministic server import skips it on an identical retry.
