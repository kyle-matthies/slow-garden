# Slow Garden

Slow Garden is a private-by-default, contemplative thinking environment built around temporal co-thinking: a person captures and arranges ideas without interruption, then an asynchronous AI process returns later with a small number of source-linked connections, tensions, and questions.

The first dogfood target is slowgarden.app on phone, tablet, and desktop. The web writing garden is implemented; model activation remains gated on evaluation. The native prototype is preserved for later. See [web delivery gates](documents/operations/WEB_DOGFOOD_DELIVERY.md) and [ADR-006](documents/architecture/ADR-006_WEB_THINKING_GARDEN.md).

## Start here

- [Project brief](documents/PROJECT_BRIEF.md)
- [Multi-horizon roadmap](documents/ROADMAP.md)
- [Decision log](documents/DECISION_LOG.md)
- [Research register](documents/RESEARCH_REGISTER.md)
- [Risk register](documents/RISK_REGISTER.md)
- [H1 mobile prototype](prototypes/mobile-h1/README.md)

## Repository structure

| Directory | Purpose |
|---|---|
| `documents/` | Canonical planning, product, design, architecture, and operations records |
| `prototypes/` | Disposable experience and technical spikes |
| `applications/` | Reserved for the production SwiftUI iOS client and React web companion |
| `services/` | Reserved for batch, orchestration, and integration services |
| `packages/` | Reserved for shared domain contracts, design tokens, and evaluation utilities |
| `infrastructure/` | Reserved for reviewed infrastructure-as-code and deployment configuration |
| `tests/` | Cross-system fixtures, evaluation cases, and end-to-end tests |

## Current boundaries

- Personal, secure multi-tenant product: each account is an isolated tenant on shared infrastructure.
- Source notes, revisions, blooms, and attachments are private by default; the product has no anonymous content access or automatic publication path.
- Spatial garden is the primary thinking surface; chronology is secondary.
- AI may synthesize and prepare proposals but may not take consequential external action without approval.
- User-authored material and AI-derived material remain distinct and traceable.
- Web is the first complete delivery target. Native code remains a separate client; its fixture contract is not silently promoted to the hosted schema.
- Web-rendered prototypes under `prototypes/` validate mobile interaction and visual direction; they are not the production iOS runtime.
- Existing Personal OS and Agent Ops systems are context and possible future integrations, not implementation dependencies for the first prototype.

## Web development and checks

Use Node 22+ and the pinned lockfile in `applications/web`. Configure only the
Supabase URL and publishable key in its ignored `.env.local`. Keep
`GARDEN_AI_ENABLED=false` until evaluation and provider receipts pass.

    npm --prefix applications/web ci
    npm --prefix applications/web run dev
    npm --prefix applications/web run lint
    npm --prefix applications/web run build
    node --test services/garden-worker/runtime.test.mjs

Database tests live in `supabase/tests`. `scripts/test-upgrade.sh` only accepts the
isolated synthetic `.local-runtime` stack named `slow-garden-web-thinking`; it resets
that test database and verifies all legacy source IDs, timestamps and text survive.
`scripts/test-local-http.mjs` verifies synthetic OTP, exports, history and sign-out
against that stack and a web dev server on port 3147. It never targets production.
