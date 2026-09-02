# Architecture baseline

Status: Accepted for the H2 personal multi-tenant foundation; provider choices remain reversible
Date: 2026-09-02
Scope: Personal secure multi-tenant product, native iOS primary client, and web companion

## Decision summary

Slow Garden will begin with a native SwiftUI iOS client as the primary product and a React web companion for desktop review and curation. Each client owns a platform-appropriate encrypted local outbox and consumes the same versioned service contracts. A managed Supabase backend uses short-lived Edge Functions around a durable Postgres job ledger and queue. AI garden passes use the OpenAI Responses endpoint through the Batch API when the return may arrive within 24 hours. Slow Garden—not the model provider, queue, scheduler, or client platform—owns eligibility, snapshots, idempotency, lifecycle, budgets, provenance, correction, and reveal.

This is intentionally not a general agent platform. Connect passes have no tools and cannot write outside Slow Garden.

## Verified provider facts

Current as of 2026-08-25; recheck before implementation.

- Supabase provides full Postgres, Auth, Storage, Edge Functions, Cron-compatible Postgres extensions, and a Postgres-native [durable queue](https://supabase.com/docs/guides/queues). Queue messages can be archived and have a visibility window.
- Supabase recommends short-lived, idempotent Edge Functions and moving long-running work into background workers; its [queue consumer pattern](https://supabase.com/docs/guides/queues/consuming-messages-with-edge-functions) leaves failed messages available for another read.
- Supabase managed database backups do not include Storage objects, according to its [database overview](https://supabase.com/docs/guides/database/overview). Attachment recovery therefore needs its own control.
- The OpenAI [Batch API](https://developers.openai.com/api/reference/resources/batches) runs asynchronous batches, exposes validation/processing/finalization/completion/failure/expiry/cancellation states, and reports request counts and usage. The current completion window is 24 hours.
- Current OpenAI model pages list Batch support and structured outputs. Model and price are configuration, not domain logic; the initial candidate is a pinned mini-model snapshot and must pass the evaluation gate before use.

## System context

```text
Person on iPhone                       Person on desktop
        |                                      |
        v                                      v
SwiftUI app -- encrypted local outbox   React companion -- IndexedDB outbox
        |                                      |
        +------------- shared HTTPS contracts-+
                               |
                               | Supabase Auth JWT
                               v
Typed Edge API -----------------------------+
        |                                    |
        v                                    v
Postgres + RLS                         Private Storage
sources, revisions, snapshots,         attachments + manifests
passes, blooms, provenance, ledger
        |
        | IDs-only durable queue + Cron
        v
Short-lived dispatcher/reconciler Edge Functions
        |
        | one garden snapshot, no tools
        v
OpenAI Batch / Responses
        |
        v
schema validation -> evidence validation -> 0-3 reviewable blooms

Explicit acceptance only
        |
        +----> future projection into Kyle Knowledge with receipt

Never direct
        X----> Agent Ops, code, messages, publishing, or external mutation
```

## Trust boundaries

1. **Device boundary:** plaintext exists in the rendered client and briefly in a device-encrypted offline outbox. Device compromise is outside server controls.
2. **Client application boundary:** iOS Keychain/protected files and browser storage hold only scoped client credentials and local drafts. No service or model credentials ship to either client.
3. **Data boundary:** every exposed row is owner-scoped with RLS; worker-only tables and queue schemas are not client-exposed.
4. **Processing boundary:** only exact snapshot revisions and bounded metadata leave the database for a model pass.
5. **Provider boundary:** provider request and output files are transient processing artifacts, deleted after ingestion and audit receipt subject to verified provider behavior.
6. **Authority boundary:** derived blooms cannot become accepted knowledge or external action without a separate approval receipt.

## Selected component model

| Concern | H1/H2 choice | Why | Reversal seam |
|---|---|---|---|
| Primary client | Native SwiftUI iOS | One-handed capture, protected local data, dictation/share sheet, offline reliability, and platform-quality motion are core | Versioned HTTP contracts isolate the client from backend implementation |
| Web companion | Next.js App Router on Vercel | Desktop review, curation, search, and secure server-rendered account surfaces benefit from a larger surface | Domain and API schemas contain no Next.js dependency |
| Spatial rendering | SwiftUI views plus Canvas paths on iOS; accessible DOM nodes plus a non-semantic path layer on web; both use viewport culling | Source text remains selectable/reachable while paths stay decorative | Replace each platform's path/background renderer independently if the 1,000-node spike fails |
| Offline | iOS encrypted local store/outbox; IndexedDB outbox for web | Fast capture survives connectivity loss on the primary device; companion uses the same conflict semantics | Sync protocol and idempotency contract are transport-neutral |
| Authority store | Managed Supabase Postgres | Transactions, constraints, RLS, full-text search, queue proximity | SQL schema and export format remain ordinary Postgres/JSON |
| Identity | Supabase Auth with email one-time code initially; each Auth UUID is one personal tenant | Avoids password storage while giving every account an independent authorization root | Apple/passkey providers can be added without changing tenant IDs through identity linking |
| Attachments | Private Supabase Storage with database manifests | Signed access and owner policies | Object interface hides provider paths |
| Server logic | Supabase Edge Functions, TypeScript | Same language, short-lived APIs and orchestration | Functions use standard HTTP and Postgres contracts |
| Schedule | Supabase Cron invokes eligibility and reconciliation functions | Cadence near the authoritative ledger | Manual endpoint or another scheduler can emit the same events |
| Work queue | Logged Supabase Queue; server-only | Durable IDs-only work delivery and archival | Queue adapter maps to the job event contract |
| Model API | OpenAI Batch over Responses, pinned snapshot | Delayed return fits 24-hour processing and structured output | Provider adapter and stored request manifest prevent domain coupling |
| Observability | Structured metadata logs plus database operations views; no content | Personal material must not leak through telemetry as account volume grows | OpenTelemetry-compatible event schema later |

## Storage comparison

| Option | Offline quality | Provenance/transactions | Operational load | Privacy control | Decision |
|---|---:|---:|---:|---:|---|
| Managed Postgres only | Weak | Strong | Low | RLS and managed controls | Rejected because capture must survive offline use |
| Full local-first database and sync engine | Strong | Medium until conflict semantics mature | High | Strong device control, harder server processing | Deferred; too much sync machinery before the loop is validated |
| Managed Postgres plus local outbox | Strong for capture | Strong server authority | Moderate | Clear device/server boundary | Selected for alpha |
| Local-only application | Strong | Strong on one device | Moderate | Highest cloud privacy | Rejected for alpha because cross-device return and background processing are core |

## Monorepo boundary

```text
applications/
  ios/                 production SwiftUI primary client
  web/                 React desktop companion
packages/
  contracts/           platform-neutral OpenAPI/JSON Schema/event definitions
  web-domain/          generated TypeScript types and web state machines
  ui-tokens/           semantic visual tokens exported for Swift and web
  evaluation/          corpus schemas, scorers, regression runner
supabase/
  migrations/          ordered, reversible schema changes
  functions/           authenticated API, dispatcher, reconciler, export/delete
  tests/               pgTAP RLS and data-invariant tests
spikes/                 disposable, evidence-producing technical probes
prototypes/
  mobile-h1/            disposable mobile interaction prototype; not production runtime
```

Keep the Swift package/Xcode project and web workspace independently reproducible. Generate client types from one versioned contract source, but do not share UI code. The mobile interaction prototype is intentionally isolated from both production clients.

## Capacity envelope

Per-tenant design target for the personal beta:

| Dimension | Expected | Test ceiling | Hard product limit before review |
|---|---:|---:|---:|
| Active gardens | 3-8 | 20 | 25 |
| Seeds per garden | 25-250 | 1,000 | 2,000 |
| Average text per seed | 300 characters | 4,000 characters | 20,000 characters |
| Attachments | fewer than 50 | 1,000 manifests | 25 MB each, 2 GB total |
| Snapshot input | 5k-30k tokens | 100k tokens | refuse and request a bounded selection |
| Concurrent garden passes | 1 | 5 | 5 per owner |
| Pass completion | weekly, within 24h | 24h plus 30m reconciliation | mark expired and require retry |
| Blooms per pass | 0-3 | 3 | schema rejects more than 3 |

## Canvas and offline decision rules

- The initial iOS renderer uses SwiftUI seed/flower views and Canvas paths; the web companion uses DOM note cards and a non-semantic path layer. Both render only the viewport neighborhood plus an overscan band.
- Pass if desktop-web pan/zoom maintains p95 frame time under 20 ms at 1,000 logical nodes and native iPhone p95 stays under 33 ms, with input latency under 100 ms at 250 visible/logical nodes.
- If paths dominate cost, replace only the platform path layer while keeping source notes, focus, and accessibility semantics in native views or DOM.
- If semantic views dominate after culling, cap the visible neighborhood and use a structured-list lens; do not sacrifice accessibility for a decorative infinite canvas.
- Offline text mutations carry `base_revision_id`. Divergent text produces an explicit conflict; it never silently chooses last write.
- Layout mutations merge per seed and retain the superseded position for undo. Concurrent edits to the same seed position produce a non-blocking conflict marker.

## Environments and deployment

- **Local:** local Supabase stack, synthetic corpus only, fake provider adapter by default.
- **Preview:** isolated Supabase branch/project with synthetic data; no production provider key.
- **Production:** one managed Supabase project with strict tenant RLS, self-serve accounts, spend controls, and a pinned model configuration. The web companion is a separately configured Vercel project.
- Production data never refreshes preview. Migrations move forward local -> preview -> production after tests and backup receipt.
- Web hosting is replaceable. Vercel handles server rendering and encrypted auth cookies; private source content remains authoritative in Supabase and must not enter shared CDN caches.

## Architecture gates still requiring runtime evidence

The decisions above are complete enough to implement, but the following issue gates cannot be marked validated from documents:

- DOM/canvas performance on Kyle’s target desktop and iPhone.
- iOS protected local storage, offline conflict, background refresh, and interrupted-sync behavior.
- IndexedDB encryption and offline-conflict behavior for the web companion on Safari and Chromium.
- RLS and deletion behavior against a real local Supabase stack.
- Batch provider retention, cancellation, structured-output conformance, and 24-hour expiry behavior with an API key.
- Attachment backup and restore outside database backups.

Each is represented as a bounded backlog item with a fallback decision, so an implementer does not need to invent the response to failure.
