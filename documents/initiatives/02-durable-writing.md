# Feature brief: Durable drafts and quiet keyboard-first writing

- Horizon and phase: Web dogfood · September 2026 initiative wave, initiative 2 (P0)
- Status: Implemented, pending merge and hosted receipt
- Owner: Kyle (wave owner); implementation by Devin

## User problem

A person writing in the garden loses unsaved text when the tab closes, the browser
crashes or restarts, or they return in a different tab: drafts were kept only in
tab-local `sessionStorage`. The writing surface also lacked quiet conveniences that
keyboard-first writers expect: a keyboard save, a textarea that grows with the text,
and a way to hide the navigation rail while writing. K-015 is open for this.

## Why delay or accumulation matters

Slow Garden asks for unhurried, returnable thinking. If returning risks loss, the person
either rushes to save half-formed text or stops trusting the page. Durable drafts let
writing be left unfinished safely, which is the product's promise.

## Proposed capability

- Drafts are persisted per tenant, thought, and entry (`<tenant>:<seed>:<entry|new>`)
  in IndexedDB (`slow-garden-drafts`), with `sessionStorage` as a fallback and an
  honest "cannot retain drafts" note when neither works.
- A draft written in the same tab is restored silently, as before. A draft from another
  tab, a closed tab, or a previous browser session is not auto-applied; a quiet notice
  "Unsaved draft from <time>" offers **Restore draft** / **Discard draft**.
- Existing tab drafts under the v2 `sessionStorage` key are migrated once into the store.
- Stale-edit protection is unchanged: a restored revision draft keeps the
  `expectedRevisionId` it started with, and the server rejects saving over a newer
  revision. The notice says so when the entry has changed since.
- Ctrl+Enter (⌘+Enter on Mac) saves; the textarea auto-grows; a **Quiet page** toggle
  hides the garden rail while writing and resets on navigation.
- Sign-out clears the tenant's drafts from the store (and any legacy keys).

No autocomplete, word counters, streaks, or AI in capture.

## Trust and agency

The store reads and writes only the person's own draft text in their own browser; nothing
leaves the device until they save. Drafts are tagged with the writing tab, the base text
they started from, and a timestamp so recovery is explicit and reversible (discard). No
inference, proposal, or automatic action occurs.

## States and failure modes

- Empty: no record, fresh draft.
- Clean record (body equals base or blank): removed silently.
- Same-tab dirty record: restored silently.
- Other-tab / restarted-browser dirty record: notice with restore/discard.
- Stale revision draft: restorable, but the notice warns the save will be rejected until
  the current version is revised (server `expectedRevisionId` check unchanged).
- IndexedDB unavailable or failing: falls back to `sessionStorage`; if that also fails the
  footer says drafts cannot be retained.
- Write failure mid-session: footer switches to the cannot-retain note; typing continues.
- Offline save: "Connection interrupted. Your draft is still here." unchanged.
- Duplicate tabs writing the same thought: last write wins; the other tab sees a notice on
  its next load.

## Acceptance evidence

- Unit tests for the draft store (`applications/web/src/lib/garden/drafts.test.mjs`).
- Manual receipt of reload, tab close, and browser restart in Chromium.
- Lint, type-check, and build pass.

## Dependencies and non-goals

Depends on ADR-006 and D-021. Non-goals: cross-device sync of drafts (would need a
server-side table; see follow-ups), autosave to the server, autocomplete, counters,
streaks, AI.

## Implementation receipt

Built:

- `applications/web/src/lib/garden/drafts.ts`: `DraftRecord`, `DraftBackend`,
  `createStorageBackend`, `openIndexedDbBackend`, `openDraftStore` (IndexedDB →
  sessionStorage → null), legacy v2 read/clear, `getTabId`, `describeDraftTime`,
  `isDirtyDraft`.
- `applications/web/src/app/garden/entry-editor.tsx` + `entry-editor.css`: `EntryEditor`
  extracted from `workspace.tsx`; debounced (300 ms) durable persistence with flush on
  `pagehide`/unmount; recovery notice; Ctrl/⌘+Enter save; auto-grow; quiet page toggle.
- `workspace.tsx`: import hook, `quietPage` state and `.garden-frame.quiet-page` class,
  sign-out clears the store, copy updated; the sessionStorage-scanning `beforeunload`
  guard was removed (the editor still guards its own dirty state).

Verified (Node 22.23):

- `node --test src/lib/garden/drafts.test.mjs`: 6 test groups, all pass (storage backend,
  IndexedDB backend against an in-memory fake, fallback order, legacy migration, time
  description, dirty check, tab id).
- `npm --prefix applications/web ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`,
  `node --test services/garden-worker/runtime.test.mjs` (14/14): pass.
- Manual receipt, Chromium (Google Chrome headless via Playwright, persistent profile) on
  a static harness page importing the compiled `drafts.ts` with a synthetic tenant/seed:
  1. reload → draft recovered, same tab;
  2. close tab, open new tab → recovered, flagged as another tab;
  3. close browser, relaunch with the same profile → recovered, flagged as another tab.
  Backend reported: `indexeddb`.

Not verified:

- The editor UI itself (notice rendering, restore/discard, Ctrl+Enter, auto-grow, quiet
  page) against a running garden: this session has no non-production Supabase
  environment for sign-in. The receipt above covers the persistence layer only.
- Behaviour in Safari/Firefox private modes beyond the coded fallback path.
- Hosted deploy.

## Follow-ups

- Run the editor receipt against a synthetic-data preview once one is available and
  attach screenshots to this record; then close K-015.
- Decision: whether drafts should sync across devices (would require a server-side
  `entry_drafts` table with RLS; proposed migration, not applied).
- Decision: whether "quiet page" should persist per person (localStorage) rather than
  resetting on navigation.
- When initiative 1 lands Vitest, convert `drafts.test.mjs` to the shared runner and add
  component tests for the recovery notice.
- The `node --test` run prints Node's `MODULE_TYPELESS_PACKAGE_JSON` warning; adding
  `"type": "module"` to `applications/web/package.json` is left to initiative 1.
