# Architecture baseline

Status: Accepted for H1 implementation planning; provider choices remain reversible
Date: 2026-08-25
Scope: Kyle-first responsive web prototype and private alpha

## Decision summary

Slow Garden will begin as a TypeScript monorepo with a private React progressive web app, a managed Supabase backend, a local IndexedDB outbox for offline capture, and short-lived Supabase Edge Functions around a durable Postgres job ledger and queue. AI garden passes use the OpenAI Responses endpoint through the Batch API when the return may arrive within 24 hours. Slow Garden—not the model provider, queue, or scheduler—owns eligibility, snapshots, idempotency, lifecycle, budgets, provenance, correction, and reveal.

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
Kyle on desktop/iPhone
        |
        v
React PWA ---- IndexedDB encrypted outbox
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
2. **Public application boundary:** the browser receives only a publishable Supabase key and user session. No service or model credentials ship to the client.
3. **Data boundary:** every exposed row is owner-scoped with RLS; worker-only tables and queue schemas are not client-exposed.
4. **Processing boundary:** only exact snapshot revisions and bounded metadata leave the database for a model pass.
5. **Provider boundary:** provider request and output files are transient processing artifacts, deleted after ingestion and audit receipt subject to verified provider behavior.
6. **Authority boundary:** derived blooms cannot become accepted knowledge or external action without a separate approval receipt.

## Selected component model

| Concern | H1/H2 choice | Why | Reversal seam |
|---|---|---|---|
| Web client | React + TypeScript + Vite PWA | Private app needs rich client interaction, not public SSR | Domain and API packages contain no Vite dependency |
| Spatial rendering | Accessible DOM nodes with viewport culling; paths on a non-semantic rendering layer | Text remains selectable and screen-reader structure is possible | Replace only path/background renderer if the 1,000-node spike fails |
| Offline | IndexedDB mutation outbox; service worker app shell | Fast capture survives connectivity loss | Sync protocol is transport-neutral |
| Authority store | Managed Supabase Postgres | Transactions, constraints, RLS, full-text search, queue proximity | SQL schema and export format remain ordinary Postgres/JSON |
| Identity | Supabase [email one-time code](https://supabase.com/docs/guides/auth/auth-email-passwordless), allowlisted Kyle account | Avoids password storage and prefetch-sensitive magic-link consumption | OIDC/passkey provider can replace auth without changing owner IDs through identity mapping |
| Attachments | Private Supabase Storage with database manifests | Signed access and owner policies | Object interface hides provider paths |
| Server logic | Supabase Edge Functions, TypeScript | Same language, short-lived APIs and orchestration | Functions use standard HTTP and Postgres contracts |
| Schedule | Supabase Cron invokes eligibility and reconciliation functions | Cadence near the authoritative ledger | Manual endpoint or another scheduler can emit the same events |
| Work queue | Logged Supabase Queue; server-only | Durable IDs-only work delivery and archival | Queue adapter maps to the job event contract |
| Model API | OpenAI Batch over Responses, pinned snapshot | Delayed return fits 24-hour processing and structured output | Provider adapter and stored request manifest prevent domain coupling |
| Observability | Structured metadata logs plus database operations views; no content | Small private alpha does not justify a log drain | OpenTelemetry-compatible event schema later |

## Storage comparison

| Option | Offline quality | Provenance/transactions | Operational load | Privacy control | Decision |
|---|---:|---:|---:|---:|---|
| Managed Postgres only | Weak | Strong | Low | RLS and managed controls | Rejected because capture must survive offline use |
| Full local-first database and sync engine | Strong | Medium until conflict semantics mature | High | Strong device control, harder server processing | Deferred; too much sync machinery before the loop is validated |
| Managed Postgres plus local outbox | Strong for capture | Strong server authority | Moderate | Clear device/server boundary | Selected for alpha |
| Local-only application | Strong | Strong on one device | Moderate | Highest cloud privacy | Rejected for alpha because cross-device return and background processing are core |

## Monorepo boundary

```text
apps/
  web/                 private PWA and visual prototype
packages/
  domain/              state machines and invariant types
  contracts/           versioned API and event schemas
  ui/                  selected visual tokens and accessible primitives
  evaluation/          corpus schemas, scorers, regression runner
supabase/
  migrations/          ordered, reversible schema changes
  functions/           authenticated API, dispatcher, reconciler, export/delete
  tests/               pgTAP RLS and data-invariant tests
spikes/                 disposable, evidence-producing technical probes
```

Use pnpm workspaces with pinned package versions and a committed lockfile. Native iOS is not added until the web loop validates; it consumes the same HTTP contracts rather than sharing UI code.

## Capacity envelope

Design target for the private alpha, deliberately above expected Kyle use:

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

- Initial renderer uses DOM note cards and renders only nodes intersecting the viewport plus an overscan band.
- Pass if desktop pan/zoom maintains p95 frame time under 20 ms at 1,000 nodes and iPhone p95 under 33 ms at 1,000 nodes, with input latency under 100 ms at 250 visible/logical nodes.
- If paths dominate cost, move paths to Canvas/WebGL while keeping notes, focus, and semantics in DOM.
- If note DOM dominates after culling, cap the visible neighborhood and use a structured-list lens; do not sacrifice accessibility for a decorative infinite canvas.
- Offline text mutations carry `base_revision_id`. Divergent text produces an explicit conflict; it never silently chooses last write.
- Layout mutations merge per seed and retain the superseded position for undo. Concurrent edits to the same seed position produce a non-blocking conflict marker.

## Environments and deployment

- **Local:** local Supabase stack, synthetic corpus only, fake provider adapter by default.
- **Preview:** isolated Supabase branch/project with synthetic data; no production provider key.
- **Private alpha:** one production Supabase Pro project, one allowlisted owner, spend cap enabled, pinned model configuration.
- Production data never refreshes preview. Migrations move forward local -> preview -> production after tests and backup receipt.
- Web hosting is static and replaceable. No server-side app session or private content is cached by the web host.

## Architecture gates still requiring runtime evidence

The decisions above are complete enough to implement, but the following issue gates cannot be marked validated from documents:

- DOM/canvas performance on Kyle’s target desktop and iPhone.
- IndexedDB encryption, offline conflict, and background-sync behavior on Safari.
- RLS and deletion behavior against a real local Supabase stack.
- Batch provider retention, cancellation, structured-output conformance, and 24-hour expiry behavior with an API key.
- Attachment backup and restore outside database backups.

Each is represented as a bounded backlog item with a fallback decision, so an implementer does not need to invent the response to failure.
