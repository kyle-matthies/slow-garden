# Feature brief: Import existing notes; export v2 with separated derived material

- Horizon and phase: H1 web dogfood · September 2026 initiative wave, initiative 6 (`import-portability`)
- Status: Implemented, pending review (a merged pull request is intermediate state)
- Owner: Kyle

## User problem

People arrive with years of notes in Markdown or plain text and have no way to bring them into a garden, so the garden starts empty and does not earn a return. Exports contain only user-authored sources; blooms and the author's responses to them are missing, so a full account picture is not portable.

## Why delay or accumulation matters

Slow Garden's value comes from a body of writing accumulating over time. Without import, the accumulation restarts from zero. Without derived material in exports, the record of what the garden inferred and how the author corrected it cannot leave the system, which weakens the provenance and correction story.

## Proposed capability

- `/garden/import`: choose a garden and an active topic, pick up to 50 Markdown or plain-text files (≤200 KB each), review a preview, then confirm. One file becomes one thought; headings that are dates (`## 2024-03-05`, `## March 5, 2024`, `## 5 March 2024`, with optional trailing note) split the file into dated entries; a file without dated headings becomes one entry dated from the file's modification date. Text before the first dated heading becomes an entry dated by the file. Sections over 20,000 characters are split at paragraph breaks. Titles are editable in the preview.
- Import is idempotent by content hash: thought, entry, and revision identifiers are derived deterministically from tenant, topic, and text (entry and revision ids also fold in the entry's date and its occurrence ordinal within the file, so identical words written on different days, or twice under one day, stay separate entries), and writes go through the existing `save_entry` RPC, which treats a replayed revision id with identical body as a no-op. Importing the same file twice adds nothing; the result reports entries added versus already present.
- Export v2 (`/garden/export`, `?format=md`, optional `?garden=<id>`): JSON schema `slow-garden-export-v2` with `source` (authorship `user`: gardens, plots, seeds, entries, revisions) and `derived` (passes; blooms with authorship `ai-derived`; bloom responses with authorship `user`). Markdown keeps the previous source layout and appends a `## Derived material (AI)` section with each bloom labelled `AI-derived`, its evidence, and any author response or correction. A per-garden export filters every table by garden and names the file after the garden.
- Settings & export in the workspace gains "Export this garden" (JSON, Markdown) and "Import notes".

## Trust and agency

The system reads only files the person chooses and saves nothing until they confirm. No AI runs; `GARDEN_AI_ENABLED` is untouched. Imported text is stored verbatim as user-authored revisions. Exports keep AI-derived blooms structurally and visually separate from user words, and responses remain attributed to the author. Entries created by import have `created_at` set to the parsed date (noon UTC) so chronology reflects the source; revisions keep their real save time, so the import moment stays traceable.

## States and failure modes

- Empty file: preview shows "No text found." and the file cannot be selected.
- Oversized file or too many files: skipped with a notice; nothing is saved.
- Archived or missing topic: "Choose an active topic."; no writes.
- Duplicate import: every entry reported as already present; no new rows.
- Repeated text under different dates, or repeated within a day: kept as distinct entries.
- Impossible calendar date (e.g. `2026-02-30`): the whole request is rejected before any write.
- Date stamping fails after `save_entry`: the import reports failure instead of silently leaving the entry at import time; the date stamp is applied whether or not the revision already existed, so a retry re-applies it to the same deterministic ids.
- Switching gardens on the import page remounts the form, so the topic list and selection always belong to the garden shown.
- Partial failure: files import sequentially; each shows its own result, and a failed file leaves the others' results visible. Because ids are deterministic, retrying is safe.
- Signed out mid-import: quiet error, files remain in the browser.
- Export with unknown garden id: 404; malformed id: 400; database failure: 503 with no partial export.

## Acceptance evidence

- Unit tests for parsing (titles, every accepted date form, non-date headings, preamble, CRLF/BOM, empty file, long-section splitting) and for hash and id stability.
- Unit tests for export: blooms only under `derived` with authorship labels; per-garden filtering drops other gardens and dangling responses; JSON round trip preserves the document; Markdown places derived material after all sources; a Markdown thought round-trips through `parseImportFile`.
- Lint, type-check, and production build pass.

## Dependencies and non-goals

Depends on ADR-006 (web-first) and the existing `save_entry` RPC and RLS. Non-goals: importing other formats (Evernote, Apple Notes, HTML), merging into existing thoughts, importing blooms or responses, changing the database schema, scheduled or automatic import.

## Implementation receipt

Built (branch `devin/1789018577-import-portability`):

- `applications/web/src/lib/garden/import.ts`: `parseImportFile`, `parseDateHeading`, `sha256Hex`, `deterministicId`, `IMPORT_LIMITS` (pure; runs in browser and Node).
- `applications/web/src/app/garden/import/`: `page.tsx` (auth + `loadGarden`), `import-form.tsx` (preview and confirm), `actions.ts` (`importThought` server action: auth and a Supabase adapter over `ImportDb`), `import-core.ts` (`runImport`: validation, active-topic check, deterministic ids, `save_entry`, created/skipped counts, entry back-dating — pure, tested against a fake db), `import.css`.
- `applications/web/src/lib/garden/export.ts`: `ExportSnapshot`, `filterSnapshotByGarden`, `buildExportDocument`, `formatExportMarkdown`, `exportFilename`; `export/route.ts` now loads passes, blooms, and responses with `allRows` and honours `?garden=`.
- `workspace.tsx`: three links in the settings section and one sentence of copy.

Verified locally on Node 22:

- `node --test src/lib/garden/import.test.mjs src/lib/garden/export.test.mjs src/app/garden/import/import-core.test.mjs`: 26 passing, including a fake-db regression test that a failed date stamp is re-applied on retry (Node 22 type stripping; `.mjs` keeps them out of the Vitest glob).
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: pass (`/garden/import` registered as a dynamic route).
- `node --test services/garden-worker/runtime.test.mjs`: 14 passing.

Not verified:

- End-to-end import against a running Supabase stack (local or hosted); `save_entry` replay behaviour is taken from the migration source, not exercised here.
- The import page was not rendered in a browser; accessibility and 390px layout are unchecked.
- `scripts/verify-web-export.mjs` does not exist in the repository; the round trip is covered by the unit test instead.

## Follow-ups

- Run `scripts/test-web-journeys.mjs`-style coverage for import and per-garden export against the disposable local stack and record a receipt.
- Decision: whether back-dating `entries.created_at` on import is the right chronology signal, or whether an explicit `imported_at`/`source_date` column (proposed migration, not applied) should carry it.
- Proposed migration (not applied): a `save_entry` overload with `p_created_at timestamptz default null` so entry creation and source-date stamping happen in one statement; today the stamp is a second write that is re-applied on retry.
- Decision: whether the import should offer merging into an existing thought rather than always creating one.
- The tests use `node:test` and `node:assert/strict` in `.test.mjs` files so `npm test` (Vitest, `*.test.ts`) does not try to bundle `node:test`; port to Vitest later if desired.
- Consider a `scripts/verify-web-export.mjs` that round-trips a fixture through the JSON and Markdown exporters and the importer.
