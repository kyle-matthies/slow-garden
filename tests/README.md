# Cross-system tests and evaluations

Reserved for fixtures and tests that cross application or service boundaries, including:

- Privacy-safe seed and garden-pass corpora.
- Source-faithfulness and useful-surprise evaluations.
- Prompt-injection, overreach, contradiction, stale-result, and no-output cases.
- End-to-end web and future iOS journeys.
- Export, deletion, backup, restore, and provider-failure tests.

Private journal material must not be committed as a fixture.

## Web navigation and session regression journeys

`scripts/test-local-http.mjs` and `scripts/test-web-journeys.mjs` refuse any database
URL except the dedicated disposable stack at `http://127.0.0.1:55321`. They create
synthetic identities and remove their own identities in `finally`; no hosted or
personal content is used. Browser profiles and screenshots stay in ignored
`.local-runtime/`. The browser runner uses the existing Playwright dependency in
`prototypes/mobile-h1` and requires its Chromium browser to be installed.

Prepare an isolated copy of `supabase/config.toml`, templates, and migrations under
`.local-runtime/supabase`: set project ID `slow-garden-ux-test` and change every
543xx port to its 553xx equivalent. Start that stack with `supabase start --workdir
.local-runtime`. Save `supabase status --workdir .local-runtime -o json` privately
to `.local-runtime/status.json`; it contains local test credentials, never commit it.
Run the database suite with an absolute path to `supabase/tests`.

Build `applications/web` with NEXT_PUBLIC_SUPABASE_URL and
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from that local status file, and
GARDEN_AI_ENABLED=false. Start the production build on port 3148, then run from
repository root:

```sh
node scripts/test-local-http.mjs
node scripts/test-web-journeys.mjs
```

Use a production build: Next development mode changes response cache headers.
For the optional availability/consent matrix, start the same build on port 3149
with GARDEN_AI_ENABLED=true and run `TEST_AI_UI=true node
scripts/test-web-journeys.mjs`. This checks controls only; it never invites a
reflection and does not change the database's closed runtime gate.

Coverage includes expired-token refresh through redirects, persistent cookies,
real Chromium profile restart, local/global sign-out scope, authenticated entry
routes, garden/topic/thought navigation, Back/reload, save/revision/newest-first
history, tab-local drafts, nested archive/restore, parent write controls, recent
entry links, creation forms, invalid locations, mobile overflow, and keyboard entry.
