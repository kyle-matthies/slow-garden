# Feature brief: Cabinet-style return reveal and provenance inspection

- Horizon and phase: September 2026 initiative wave · Initiative 3 · P1
- Status: In progress (pull request open; acceptance evidence below)
- Owner: web returns surface (`applications/web/src/app/garden/returns*.{tsx,ts,css}`)

## User problem

A writer who invited a reflection returns to the garden and sees a flat list: a status word, a
sentence of interpretation, and three buttons. They cannot tell which of their exact words the
interpretation rests on, whether those words have since been edited or archived, or what they
already said about this bloom last week. Without that, the return is either accepted on faith or
ignored, and neither builds trust in a system that must stay distinguishable from the writer.

## Why delay or accumulation matters

Returns arrive hours after the invitation and rest on entries written days apart. The value is in
the accumulation: two entries a week apart that the writer never held side by side. A Cabinet view
(D-015, `documents/design/MEADOW_AND_CABINET.md`) exists precisely to inspect that accumulated
evidence slowly, with sources visible, rather than to react to a notification.

## Proposed capability

Rebuild the returns surface as a Cabinet panel:

- Each pass is a drawer labelled with its state (Waiting, Tending, Returned · N blooms / Nothing
  new to offer, Did not return, Cancelled, Withdrawn) and invitation date. Zero blooms renders as a
  complete return, not an error.
- Each bloom is a specimen card: a textual kind label (Possible connection, Tension, Change,
  Open question) marked "AI-derived", the interpretation, then a "Why this appeared" region
  listing every exact clipping the worker cited.
- Each clipping is a `<figure>` with the quoted text as a `<blockquote>` labelled "Your words", a
  link to its exact entry anchor (`/garden?garden=…&topic=…&thought=…#entry-<entry_id>`), and its
  source state: current, superseded (the entry has a newer revision), archived, or unlinked.
- Prior Keep / Correct / Prune responses render inline with their dates; the latest is the active
  `aria-pressed` state and older ones collapse under "Earlier response (n)".
- "Continue this thought" pre-fills the new-entry draft for the clipping's seed with a Markdown
  blockquote of the writer's own words followed by a bracketed attribution that names the AI's
  role: `[Clipping chosen by AI · <kind>. The quote above is yours; the choice to surface it is not.]`
  The text is queued under a tab-local handoff key (`slow-garden:continue:v1:<tenant>:<seed>`,
  `lib/garden/continuation.ts`) rather than written into any editor's draft storage; the next
  new-entry editor for that thought takes the queue and appends it to whatever draft it already
  holds, so a durable draft (initiative 2) never hides a requested continuation and a
  continuation never replaces waiting writing.
- A development-only fixture preview (`/garden/returns-preview?scene=<slug>`) renders every pass
  and bloom state from synthetic data with no provider, database, or sign-in.

## Trust and agency

- Reads: the existing `readReturns` action (passes, blooms, responses, current revisions) plus a
  new `locateRevisions` action that fetches only `id, entry_id, seed_id, revision_number,
  created_at` for cited revisions that are no longer current. No revision bodies are fetched for
  stale citations; the clipping text shown is what the worker stored in bloom evidence.
- Infers: nothing new. The panel resolves anchors and states; it adds no interpretation.
- Remembers: Keep / Correct / Prune via the existing `respondToBloom` action. Corrections are
  stored as the writer's own words and displayed under "Your words".
- Proposes: the continuation draft only. It goes into the existing session-storage draft slot and
  appends to any unsaved draft rather than replacing it; nothing is saved until the writer saves.
- Executes: nothing. AI remains disabled (`GARDEN_AI_ENABLED` unchanged); invitations and
  cancellations still go through the existing gated server actions.

## States and failure modes

| State | Rendering |
|---|---|
| No passes | "No returns yet" copy plus invitation control (unchanged behavior) |
| Queued / processing | Drawer with waiting copy and Cancel control |
| Complete, 0 blooms | "Nothing new to offer" · "No new reflection this time" |
| Complete, 1–3 blooms | Specimen cards; heading announces the count |
| Failed | "Did not return" with reason if recorded |
| Cancelled / withdrawn | Labelled drawers; withdrawn blooms remain readable but marked |
| Clipping current | "Sources unchanged" |
| Clipping superseded | "Source revised since" badge; link still targets the entry |
| Clipping archived | "Source archived" badge; link carries `view=archive` so it lands in the archive view |
| Clipping unlinked | "Source unavailable"; no dead link rendered |
| Prior responses | Latest shown as pressed; history collapsible |
| Provider unavailable / AI disabled | Unchanged: invitation action reports the gate |

## Acceptance evidence

Required by the wave plan: all pass and bloom states render from synthetic fixtures; keyboard and
screen-reader pass documented; lint, type, and build pass. See the implementation receipt.

## Dependencies and non-goals

Depends on D-015, `MEADOW_AND_CABINET.md`, and the existing passes/blooms/responses schema
(`supabase/migrations/20260907004656_manual_garden_passes.sql`). Excluded: enabling AI, schema
changes, notifications, any change to `globals.css`, and any change to how the worker chooses
clippings.

## Implementation receipt

### Built

| File | Role |
|---|---|
| `applications/web/src/app/garden/returns.tsx` | Container: loads returns, resolves stale revisions, persists responses, hands continuation to the workspace |
| `applications/web/src/app/garden/returns-cabinet.tsx` | Pure presentation: `ReturnCabinet`, `PassDrawer`, `BloomSpecimen`, `ClippingCard`, `makeClippingResolver` |
| `applications/web/src/app/garden/returns-continue.tsx` | `buildContinuation` (quoted clipping + attribution); the handoff itself lives in `lib/garden/continuation.ts` (`queueContinuation`, `takeContinuation`, `appendContinuation`) |
| `applications/web/src/app/garden/returns-lookup.ts` | `locateRevisions` server action (metadata only, auth via `getClaims`) |
| `applications/web/src/app/garden/returns-fixtures.tsx` | Synthetic garden, revisions, passes, blooms, responses, and eight scenes |
| `applications/web/src/app/garden/returns.css` | Component-imported styles; ivory paper, coral "derived" cue, blue "evidence" cue, focus rings, reduced motion, 390px layout |
| `applications/web/src/app/garden/returns-preview/page.tsx`, `preview.tsx` | Dev-only fixture browser |
| `applications/web/src/app/garden/workspace.tsx` | Hook point: `editorGeneration` counter so the new-entry editor remounts after `onContinue`; the editor takes the queued continuation on mount |

### Verified

Run with Node 22 on the branch at PR time:

- `npm --prefix applications/web ci` — exit 0
- `npm --prefix applications/web run lint` — exit 0
- `cd applications/web && npx tsc --noEmit` — exit 0
- `npm --prefix applications/web run build` — exit 0; `/garden/returns-preview` listed as static
- `node --test services/garden-worker/runtime.test.mjs` — 14 pass, 0 fail
- Dev server: all eight scenes (`all`, `empty`, `waiting`, `nothing-new`, `one-bloom`,
  `three-blooms`, `not-returned`, `withdrawn`) returned 200 and rendered the fixture banner, kind
  labels, `#entry-<id>` anchors, and `aria-pressed` states.
- Production server (`next build` + `next start`): `/garden/returns-preview` renders the app's
  not-found UI with `<meta name="robots" content="noindex">`; the body contains no fixture text.

Keyboard and screen-reader pass (Playwright against Chromium, `scene=all` and `scene=three-blooms`):

- Landmarks: `region "Returns"` labelled by its heading; each pass is an `article` named by its
  `h3` (state · date · bloom count); each bloom is an `article` named "<kind>, <n> clippings,
  <source state>, <response state>"; "Why this appeared" and "Your response" are labelled regions.
- Heading outline: h2 Returns → h3 per pass → h4 per bloom region. No skipped levels.
- Tab order (37 stops on `scene=all`): scene links → Cancel buttons → per bloom: entry link,
  Continue this thought, Keep, Correct, Prune, "Earlier response" summary. No focus traps; no
  unnamed links or buttons.
- Keep via Enter: `aria-pressed` flips to `true`; `role=status` announces "Kept."
- Correct via Enter: `aria-expanded` becomes `true`; textarea labelled "Your correction, in your
  own words"; next Tab stop is "Save correction"; saving announces "Correction saved in your
  words." and moves the prior response under "Earlier response (1)".
- Continue this thought via Enter: preview shows the blockquote and attribution line.
- Withdrawn scene: bloom named "…, withdrawn, awaiting your response".
- The only unlabelled `svg` on the page belongs to the Next.js dev-tools indicator, not the panel.

### Not verified

- Real Supabase data path (`readReturns`, `locateRevisions`, `respondToBloom`) against a database;
  no Supabase env is available locally and no AI provider is enabled.
- The continuation flow end-to-end in the signed-in workspace (draft prefill → editor remount);
  verified only via the fixture preview's continuation text and by type-checking the workspace hook.
- A real screen reader (VoiceOver/NVDA); evidence is from the accessibility tree and roles/names.
- A hard HTTP 404 status for the preview route in production (see follow-ups).

## Follow-ups

- **Gap — soft 404 only.** Because `applications/web/src/app/loading.tsx` streams a shell for every
  route, `notFound()` in the preview page yields the not-found UI with status 200 + `noindex`
  (documented Next 16 behavior in `not-found.md`). A hard 404 needs a check before streaming, i.e. a
  `proxy` rule for `/garden/returns-preview` in production. That file is outside this initiative's
  ownership; proposed for Initiative 9 (security hardening) or a small shared follow-up.
- **Proposed decision.** Record the continuation attribution format (`[Clipping chosen by AI ·
  <kind>. …]`) in the decision log so import/export (Initiative 6) and evaluation corpus
  (Initiative 4) treat it as a stable marker of AI-selected quotation inside user text.
- **Proposed decision.** Whether superseded citations should also fetch the revision body to show
  a diff against the current text. Deliberately not done here to avoid a second body read.
- **No migrations proposed.** The panel uses existing tables only.
- Unit tests for `buildContinuation` and `makeClippingResolver` once Initiative 1 lands a web
  test runner; both are pure functions written to be testable without React.
