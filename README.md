# Slow Garden

Slow Garden is a private-by-default, contemplative thinking environment built around temporal co-thinking: a person captures and arranges ideas without interruption, then an asynchronous AI process returns later with a small number of source-linked connections, tensions, and questions.

The project is moving from planning into an instrumented mobile prototype. The production direction is native iOS first with a web companion, backed by shared platform-neutral contracts and a managed asynchronous control plane.

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
- Native iOS is the primary product; the Next.js web companion runs on Vercel and reuses backend contracts and semantics without forcing shared UI code.
- Web-rendered prototypes under `prototypes/` validate mobile interaction and visual direction; they are not the production iOS runtime.
- Existing Personal OS and Agent Ops systems are context and possible future integrations, not implementation dependencies for the first prototype.
