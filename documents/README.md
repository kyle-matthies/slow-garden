# Planning index

This directory is the canonical product-planning corpus for Slow Garden.

## Core records

| Record | Purpose | Update trigger |
|---|---|---|
| [Project brief](PROJECT_BRIEF.md) | Stable product thesis, audience, loop, and boundaries | Product thesis or target user changes |
| [Roadmap](ROADMAP.md) | Multi-horizon work, phase gates, dependencies, and feature sequencing | A gate passes, fails, or changes |
| [Decision log](DECISION_LOG.md) | Accepted and provisional product decisions | A durable choice is made or reversed |
| [Research register](RESEARCH_REGISTER.md) | Questions, methods, evidence, and study queue | Research begins or evidence arrives |
| [Risk register](RISK_REGISTER.md) | Product, safety, privacy, delivery, and business risks | Risk exposure or mitigation changes |
| [H1 build-package audit](H1_BUILD_PACKAGE_AUDIT.md) | Requirement-by-requirement evidence and remaining gate | Package evidence or gate changes |

## Working areas

- `product/`: product requirements, feature briefs, journey maps, and pricing or positioning work.
- `design/`: interaction model, visual language, motion, accessibility, and prototype reviews.
- `architecture/`: system context, data contracts, AI pipeline, privacy, security, and architecture decisions.
- `operations/`: environments, deployment, observability, incident response, cost controls, and release gates.
- `templates/`: lightweight formats for repeatable decisions and experiments.

## Current H0 and H1 working records

- [Product framing and differentiated wedge](product/PRODUCT_FRAMING.md)
- [Competitive and substitute research](product/COMPETITIVE_RESEARCH.md)
- [Trust and approval contract](product/TRUST_AND_APPROVAL_CONTRACT.md)
- [Journeys and state model](design/JOURNEYS_AND_STATE_MODEL.md)
- [Visual directions brief](design/VISUAL_DIRECTIONS_BRIEF.md)
- [Visual directions evaluation](design/VISUAL_DIRECTIONS_EVALUATION.md)
- [Architecture baseline](architecture/ARCHITECTURE_BASELINE.md)
- [Data and provenance contract](architecture/DATA_AND_PROVENANCE.md)
- [Asynchronous processing architecture](architecture/ASYNC_PROCESSING.md)
- [Privacy, security, and threat model](architecture/PRIVACY_SECURITY_THREAT_MODEL.md)
- [Cost and capacity model](architecture/COST_AND_CAPACITY.md)
- [Evaluation architecture](architecture/EVALUATION_ARCHITECTURE.md)
- [Private-alpha implementation backlog](operations/ALPHA_IMPLEMENTATION_BACKLOG.md)

## Status language

- **Proposed:** documented but not yet accepted.
- **Accepted:** current direction; may still be reversed through a new decision.
- **In progress:** active work with an owner and evidence target.
- **Validated:** exit criteria passed with recorded evidence.
- **Rejected:** tested or reviewed and intentionally not continuing.
- **Deferred:** valuable but intentionally outside the current horizon.
