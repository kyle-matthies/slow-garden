# Security review — September 2026

Status: Receipted for headers, dependency audit, and database authorization tests; hosted verification pending
Date: 2026-09-10
Scope: the deployed web application (`applications/web`), its CI, and the committed Supabase schema and tests, reviewed against threats T-01–T-13 in the [threat model](../architecture/PRIVACY_SECURITY_THREAT_MODEL.md)
Initiative: [09 · Security hardening](../initiatives/09-security-hardening.md)

This review records what is verified by an automated or witnessed check, what is
verified only by code inspection, and what has no receipt. Nothing here changes
hosted configuration; every receipt below was produced on a local build or local
database.

## 1. Response headers

`applications/web/next.config.ts` applies one static header set to every route
(`source: "/(.*)"`), including `/_next/static` assets and `/api/*`.

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | see below | XSS, clickjacking, exfiltration limits |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | TLS only |
| `X-Frame-Options` | `DENY` | legacy clickjacking control (superseded by `frame-ancestors`) |
| `Referrer-Policy` | `no-referrer` | garden and entry identifiers never leave in a referrer |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()` | disable unused powerful features and ad-topic APIs |
| `X-Content-Type-Options` | `nosniff` | MIME confusion |
| `Cross-Origin-Opener-Policy` | `same-origin` | isolates the browsing context from cross-origin openers |
| `Cross-Origin-Resource-Policy` | `same-origin` | first-party assets cannot be embedded elsewhere |
| `X-DNS-Prefetch-Control` | `off` | no speculative DNS to third parties |
| `X-Powered-By` | removed (`poweredByHeader: false`) | framework fingerprint |

### Content Security Policy

Production value (with `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co`):

```text
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co;
object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'; frame-src 'none';
worker-src 'self' blob:; manifest-src 'self';
upgrade-insecure-requests
```

Decisions:

- **Enforced, not report-only.** The policy is enforced because every directive
  was checked against what the app actually loads: `next/font/google` self-hosts
  fonts under `/_next/static/media`, the meadow background is a first-party PNG,
  there are no third-party scripts, images, iframes, or analytics, and the only
  cross-origin traffic is the Supabase project (`fetch` for Auth/PostgREST, plus
  the `wss:` origin in case Realtime is used later). Development adds
  `'unsafe-eval'` to `script-src` because React's development build evaluates
  code for error-stack reconstruction; production does not.
- **`'unsafe-inline'` remains on `script-src` and `style-src`.** The App Router
  emits inline bootstrap scripts (`self.__next_f.push(...)`) and inline style
  attributes. A nonce-based strict policy requires generating a nonce per request
  in `src/proxy.ts`, forcing dynamic rendering for currently static pages (`/`,
  `/login`), and threading the nonce through every route. `proxy.ts` is outside
  this initiative's ownership and the change forces a rendering-model decision, so
  it is recorded as follow-up F-1 rather than shipped as a report-only header
  that would fire on every page load without a reporting endpoint.
- **Supabase origin comes from the build environment.** `connect-src` includes the
  origin derived from `NEXT_PUBLIC_SUPABASE_URL` at build time. A build without the
  variable produces `connect-src 'self'`, which is correct for the unconfigured
  local build (the app redirects to `/login` and never calls Supabase). Vercel
  preview and production builds must keep the variable set for the environment
  they target; a mismatch would block Auth requests in the browser rather than
  leak anything.

### Receipt — headers on a local production build

Build and start: `NEXT_PUBLIC_SUPABASE_URL=https://example-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<synthetic> npm run build && npm run start -p 3123`
(Next.js 16.3.4, Node 22.23.2). `curl -sI` against `/`, `/login`, `/api/health`,
`/garden`, and `/_next/static/chunks/<hash>.css`:

| Route | CSP | HSTS | XFO | Referrer | Permissions | nosniff | COOP | X-Powered-By |
|---|---|---|---|---|---|---|---|---|
| `/` | present | present | present | present | present | present | present | absent |
| `/login` | present | present | present | present | present | present | present | absent |
| `/api/health` | present | present | present | present | present | present | present | absent |
| `/garden` | present | present | present | present | present | present | present | absent |
| `/_next/static/...css` | present | present | present | present | present | present | present | absent |

The CSP value matched the production string above with the synthetic origin
substituted. `/` and `/login` returned HTTP 200 with rendered HTML.

Not verified: browser-console absence of CSP violations on the authenticated
garden workspace (requires a local or synthetic Supabase project with Auth
running; see follow-up F-2), and headers as served through Vercel's edge (Vercel
forwards `headers()` from `next.config.ts` unchanged, but the hosted origin was not
curl-tested by this initiative).

## 2. Dependency audit

CI (`.github/workflows/ci.yml`, `web` job) now runs `npm audit --audit-level=high`
immediately after `npm ci`, so a high or critical advisory against
`applications/web/package-lock.json` fails the pull request.

Receipt (local, 2026-09-10, lockfile at this commit): `npm audit --audit-level=high`
→ `found 0 vulnerabilities` across 358 audited packages. No findings to fix or
document.

Not covered: the Edge Function (`supabase/functions/garden-worker`) imports Deno
modules with no lockfile-based audit; the worker evaluation scripts under
`services/garden-worker` have no third-party dependencies. See follow-up F-3.

## 3. Database authorization tests

`supabase/tests/personal_tenant_rls.sql` (14 assertions) and
`supabase/tests/thinking_garden.sql` (39 assertions) were run locally with the
Supabase CLI 2.109.1 against a database replayed from `supabase/migrations`:

```text
supabase/tests/personal_tenant_rls.sql .. ok
supabase/tests/thinking_garden.sql ...... ok
Files=2, Tests=53, Result: PASS
supabase db lint --local --schema public,private --level warning --fail-on error → No schema errors found
```

The same two commands run in the CI `database` job on every pull request.

## 4. Threat receipts T-01–T-13

Legend — **Receipt:** automated or witnessed evidence exists in this repository.
**Inspection:** the control is present in committed code but has no automated
negative test. **Gap:** no control or no verification; a follow-up is listed.

| ID | Threat | Status | Evidence | Gap / follow-up |
|---|---|---|---|---|
| T-01 | Broken object authorization | Receipt (partial) | pgTAP with two synthetic users: Bob cannot read Alice's `gardens`, `accounts`, `plots`, `current_entries`, `garden_passes`; cannot insert into Alice's tenant (`42501`), cannot update her garden (empty `RETURNING`), cannot link cross-tenant graph rows (`23503`), cannot call `save_entry` on her seed (`seed unavailable`); `anon` has no `select` on `gardens`. Revocation withdraws completed blooms from the owner's view. | No negative test yet for `seeds`, `seed_revisions` reads, `blooms`, `bloom_responses`, or `garden_history`/export paths as Bob; the threat model asks for every table/RPC. F-4. |
| T-02 | Service credential reaches browser or logs | Inspection | Web runtime reads only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `SUPABASE_SERVICE_ROLE_KEY` appears only in `supabase/functions/garden-worker/index.ts` (Deno env). Worker RPCs are `REVOKE`d from `anon`/`authenticated` and granted to `service_role` only. `X-Powered-By` removed. | No built-bundle scan and no CI secret scanner. F-5. |
| T-03 | Note text in analytics, errors, traces, queue | Inspection | `next.config.ts` sets `logging: false` (Server Function argument tracing off); no analytics or error-reporting SDK in `applications/web`; `Referrer-Policy: no-referrer`; the pass queue lives in the `private` schema (`private.pass_inputs.snapshot` holds source content by design, unreadable by `anon`/`authenticated`); `pass_inputs` cascades on pass deletion. | No negative-control canary test asserting content strings are absent from captured logs. F-6. |
| T-04 | Prompt injection changes workflow or tools | Receipt (runtime, offline) | `services/garden-worker/runtime.test.mjs` (14 tests) covers schema validation and evidence checks; `finish_garden_pass` rejects evidence outside the snapshot (`invalid source evidence`). Provider is not activated (`GARDEN_AI_ENABLED=false`; pgTAP `AI activation is closed by default`). | Adversarial corpus and zero-tool-call gate belong to initiative 4/5; not re-verified here. |
| T-05 | Cross-garden content leaks into one request | Receipt (partial) | pgTAP: cross-plot pass denied when either plot opts out; permission revocation cancels queued work and withdraws output; snapshot evidence must resolve inside the pass. | No mixed-owner integration test at the worker layer. F-4. |
| T-06 | Model invents evidence or diagnosis | Receipt (database boundary) | `finish_garden_pass` rejects unknown `revision_id`; zero-bloom result completes rather than fails; at most three blooms enforced by `ordinal` uniqueness and validation. | Faithfulness/prohibited-claim gate is corpus work (initiative 4). |
| T-07 | Duplicate delivery | Receipt | pgTAP: identical `save_entry` retry does not duplicate; mismatched replay of a request id rejected (`22023`); bloom insert `on conflict(pass_id, ordinal) do nothing`; `unique(id,tenant_id,garden_id)` on passes. | Concurrency (parallel claim) not tested. Expired/duplicate provider results are initiative 5. |
| T-08 | Stale output presented as current | Receipt | pgTAP: stale edit rejected (`40001`); `invalidate_source_passes` and `invalidate_plot_passes` triggers cancel or withdraw passes when sources change. | Reveal-time head comparison in the UI is initiative 3. |
| T-09 | Offline plaintext outside device boundary | Gap (web) | The web app keeps drafts in tab `sessionStorage` only (no IndexedDB outbox yet). | Initiative 2 introduces IndexedDB drafts; the threat model requires a non-exportable WebCrypto key and sign-out erasure before that store holds plaintext. Proposed decision F-7. |
| T-10 | Session usable after revocation | Inspection | `proxy.ts` refreshes and validates the session on every non-asset request; `/garden` and `/garden/export` call `auth.getClaims()` and redirect/deny without a valid subject. | No revoked-session test against export/history; no recent-authentication requirement on export. F-8. |
| T-11 | Storage object bypasses row authorization | Not applicable (receipt) | No Storage bucket exists in any migration; the web app has no attachment upload. `img-src` excludes Supabase Storage. | Re-review when attachments are introduced; add bucket policies and pgTAP then. |
| T-12 | Backup restores but attachments are lost | Not applicable / Gap | No attachments; database backups are provider-managed. | No restore drill receipt exists. Hosted operation; out of scope for this initiative. F-9. |
| T-13 | Deletion misses revisions, provider files, indexes, backups | Receipt (partial) | pgTAP: deleting the `auth.users` row cascades through `seed_revisions` for that tenant. Cancelled passes set `cleanup_pending`; worker cleanup path exists. | No test that `blooms`, `bloom_responses`, `garden_passes`, and `private.pass_inputs` are all removed; provider-file deletion receipt and backup-expiry disclosure pending (initiative 5 / activation runbook). F-10. |

Summary: 13 threats reviewed; 7 have automated receipts (some partial), 3 are
verified by inspection only, 2 are not applicable to the current web app with no
Storage, and 1 (T-09) is an explicit gap owned by the durable-writing work.

## 5. Follow-ups

- **F-1 · Nonce-based strict CSP.** Generate a per-request nonce in `src/proxy.ts`,
  emit `script-src 'self' 'nonce-…' 'strict-dynamic'` and `style-src 'self' 'nonce-…'`,
  and accept dynamic rendering for `/` and `/login`. Proposed decision for the
  decision log: static landing page vs. strict CSP.
- **F-2 · Authenticated CSP receipt.** Run the garden workspace against a local
  Supabase stack with Auth enabled and confirm zero CSP violations in the console
  while writing, exporting, and viewing history.
- **F-3 · Edge Function dependency audit.** Add `deno.lock` for
  `supabase/functions` and a CI check, or record why it is deferred.
- **F-4 · Complete the T-01/T-05 negative matrix.** Extend
  `personal_tenant_rls.sql` so Bob is denied on every exposed relation, view, and
  RPC (`seeds`, `seed_revisions`, `blooms`, `bloom_responses`, `create_seed`,
  history, export queries). Author with two synthetic users; run under
  `supabase test db`.
- **F-5 · Bundle and secret scanning.** Add a CI step that greps the built
  `.next` output for `service_role`/`SUPABASE_SERVICE_ROLE_KEY` and a secret
  scanner (for example gitleaks) over the repository.
- **F-6 · Content-free logging canary.** Seed a canary string through a synthetic
  entry and assert it is absent from captured server logs and error payloads.
- **F-7 · Decision: encrypted web draft store.** Before initiative 2's IndexedDB
  drafts hold plaintext, decide whether the WebCrypto key requirement from the
  threat model applies to drafts or only to the future sync outbox.
- **F-8 · Recent-session requirement for export.** Enforce a maximum session age
  (or re-authentication) for `/garden/export` and add a revoked-session test.
- **F-9 · Backup/restore drill.** Hosted operation for the alpha privacy gate; not
  a repository change.
- **F-10 · Deletion graph test.** Extend the erasure assertion to all tenant
  tables and `private.pass_inputs`, and record the provider-file cleanup receipt
  once a provider exists.

No migration is proposed by this review; F-4 and F-10 are test-only changes.
