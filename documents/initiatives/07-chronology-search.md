# Feature brief: Chronology lens and bounded search with excerpts

- Horizon and phase: H2 web dogfood · [September 2026 initiative wave](../operations/INITIATIVE_WAVE_2026-09.md), initiative 7 (P1)
- Status: Implemented, pending review; acceptance evidence recorded below
- Owner: Kyle (wave owner); implementation by an independent agent

## User problem

A person who has written for a few weeks cannot answer "when did I last write about
the river?" or "what did I write last Tuesday?" without opening thoughts one at a time.
The garden search was a client-side substring filter over thought titles and bodies
that only narrowed the plant grid; it showed no excerpt, could not reach archived
writing, and had no dated view. The brief names chronology and bounded search as
secondary lenses that make the no-AI garden worth returning to.

## Why delay or accumulation matters

Slow Garden accumulates dated entries on named thoughts over months. Chronology only
becomes meaningful once there is a past to look back on, and search only matters once
a person has forgotten where a phrase lives. Both lenses read what the person already
wrote and add nothing: no suggestions, no ranking by engagement, no nudges to return.
The spatial overview stays primary; these are quiet ways to find one's own words.

## Proposed capability

- **Timeline lens (`view=timeline`).** A URL-backed view, parallel to the existing
  `view=archive`, listing saved entries grouped by calendar day (in the reader's time
  zone), newest day first, across the whole garden or a single topic
  (`?garden=…&topic=…&view=timeline`). Each row shows time, topic, thought title, and
  the first 200 characters of the entry, and opens the entry at its anchor in its
  thought. Thirty days render at a time with a "Show earlier days" button. An
  "Include archived" toggle adds archived entries, thoughts, and topics, labelled.
- **Bounded search with excerpts.** The search field on the garden overview and topic
  pages searches thought titles and entry bodies in the current scope. Results show
  the thought title and a bounded excerpt (about 140 characters around the first match)
  with every query term highlighted. Titles rank above bodies; an intact phrase ranks
  above scattered terms; ties fall to the most recent writing. At most 30 results are
  shown, and a query needs at least two characters. An "Include archived" toggle widens
  the scope; inside the Archive view it is implicit. A "Timeline" link beside the field
  opens the timeline lens for the same scope.

## Trust and agency

- Reads only the tenant's own thoughts and entries already loaded for the workspace;
  no new server route, query, or storage.
- Nothing is inferred, remembered, or proposed. No query is stored or sent anywhere;
  ranking uses only where and how recently the person's own words appear.
- Archived material is hidden by default and always labelled "archived" when shown.
- No AI-derived material appears in either lens; blooms remain in the returns surface.
- `GARDEN_AI_ENABLED` is untouched.

## States and failure modes

- Empty garden or topic: timeline shows a single sentence pointing to writing or the
  archived toggle; search shows "Nothing matches these words in this view."
- Query under two characters: a status line explains the minimum; no results render.
- Over 30 matches: the status line says the closest 30 are shown.
- Archived garden: everything is archived; the toggle is implicit in the Archive view.
- Unknown topic in the URL: the existing "nearest available parent" behaviour applies
  and the timeline shows the garden.
- Server render vs browser time zone: the first render groups by UTC and the hydrated
  render regroups in the local zone, using the same `useSyncExternalStore` pattern as
  `EntryTime`, so there is no hydration mismatch.
- Offline or stale data: both lenses are pure functions over the already-loaded page
  data; they never fetch, so they cannot fail independently of the page.

## Acceptance evidence

- Unit tests for tokenising, ranking (title > body, phrase bonus, all-terms-required,
  recency tiebreak), archive scoping (entry, thought, topic, garden), bounding (min
  query length, result limit, excerpt window), excerpt highlighting (casing preserved,
  accents matched, overlapping terms, whitespace collapsing), and day grouping across
  time zones. See `applications/web/src/lib/garden/search.test.mjs`.
- Keyboard: search input → ArrowDown moves to the first result; ArrowDown/ArrowUp move
  between results, Home/End jump, Enter opens, Escape returns focus to the input, and a
  second Escape clears the query. The archived toggle is a native checkbox reachable by
  Tab. Timeline rows use the same arrow-key model. All controls are native buttons and
  inputs with visible focus rings; excerpts use `<mark>` for highlights; the result
  count is a polite live region.
- Privacy: no network calls, no stored queries, no engagement metrics.
- Lint, type check, and production build pass.

## Dependencies and non-goals

- Depends on the existing workspace data shape (`GardenData`) and URL scheme
  (`garden`, `topic`, `thought`, `view`).
- Non-goals: server-side or full-text database search, fuzzy matching, search across
  gardens, revision-history search, calendar heat maps, streaks or "days written"
  counts, saved searches, and any AI-assisted retrieval.

## Implementation receipt

Built (branch `devin/…-chronology-search`, PR titled `[Initiative 07] …`):

- `applications/web/src/lib/garden/search.ts` — pure helpers: `normalize`,
  `tokenize`, `searchGarden`, `excerpt`, `isArchivedSeed`/`isArchivedEntry`,
  `timelineEntries`, `groupEntriesByDay`, `dayKey`, plus the bounds
  `MIN_QUERY_LENGTH = 2`, `DEFAULT_RESULT_LIMIT = 30`, `EXCERPT_RADIUS = 70`.
- `applications/web/src/lib/garden/search.test.mjs` — 13 `node --test` cases (Node 22
  type stripping imports the `.ts` module directly; no new dependency).
- `applications/web/src/app/garden/chronology.tsx` — `GardenSearch` and
  `ChronologyLens` client components, a shared roving-focus hook, and the
  `LensNavigate`/`LensView` types.
- `applications/web/src/app/garden/chronology.css` — component styles, imported by
  `chronology.tsx` only; `globals.css` untouched.
- `applications/web/src/app/garden/workspace.tsx` — hook points only: import; `view`
  derived from `?view=`; `navigate()` now takes a `LensView` instead of a boolean (two
  call sites updated); `GardenSearch` replaces the inline search input; the plant grid
  and "All thoughts" heading hide while a query is active; `ChronologyLens` renders in
  place of the overview when `view=timeline` and no thought is open. Rail topic links
  preserve the timeline lens for that topic.

Verified (Node 22.23.2, `applications/web`):

- `npm ci` — clean.
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeded.
- `node --test src/lib/garden/search.test.mjs` — 13 passed, 0 failed.
- `node --test services/garden-worker/runtime.test.mjs` (repo root) — see PR body.
- Keyboard receipt: both components were mounted in a throwaway local page (not
  committed) with synthetic fixtures under `next dev`, and driven with Playwright over
  CDP in Chromium. Observed: typing "river light" gave 3 matches with the title hit
  first and `river`/`light` marked in each body excerpt; ArrowDown from the input
  focused the first result; ArrowDown/End/Home/ArrowUp moved focus as specified and
  stopped at the ends; Enter called `onNavigate("p1","s1","")` for the title hit;
  Escape returned focus to the input and a second Escape cleared it; Tab reached the
  archived checkbox and Space toggled it, raising the result count from 5 to 6 with the
  extra hit labelled "archived"; the timeline grouped entries under
  "Tuesday, September 1, 2026" and arrow keys moved between rows.

Not verified:

- The integrated workspace against a real Supabase session (no local stack in this
  environment); the hook points in `workspace.tsx` were checked by type check and
  production build only.
- Screen-reader announcement order, 390 px layout, and dark mode for the new
  components (initiative 8 owns the global tokens the CSS relies on).
- Behaviour with several thousand entries; the helpers are linear scans over
  already-loaded data, which matches the current page-load cost.

## Follow-ups

- Decision: whether the timeline should become the default lens for the Archive view,
  replacing its plant grid, once people have used both.
- Decision: whether to search revision history and bloom responses; excluded here to
  keep user-authored and AI-derived material visibly separate.
- Proposed (not applied) migration: none. If gardens outgrow the loaded page data,
  a Postgres `tsvector` on `entry_revisions.body` scoped by RLS would be the next step
  and needs its own decision record.
- Once initiative 1 lands Vitest, move `search.test.mjs` into the shared harness and
  add component tests for the keyboard model recorded above.
- Rail topic links keep `view=timeline`; the "Back to garden overview" button inside
  the lens and the Archive header button leave it. Confirm this feels right in use.
