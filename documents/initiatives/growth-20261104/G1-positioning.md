# G1 · Public positioning and first-use intent

Status: Implemented and validated locally; ready for integration review.
Owner: positioning lane, coordinated by the November 4 growth wave.

## Problem and hypothesis

The current public page leads with an abstract promise and an unlabeled seed/bloom
illustration. A new visitor cannot easily tell what they will do after signing in,
why to return to a thought, or whether AI is already running. Hypothesis: explaining
the writing-and-return loop and letting visitors explore a clearly illustrative
example will improve qualified starts without promising outcomes that are not live.

## Delivered slice

- Concrete positioning for journal entries, ongoing work and open questions.
- A local interactive example with three use cases: a question, a work idea and a
  reading note. It shows two entries in the same thought. Its synthetic nature and
  lack of saving/AI requests are explicit.
- One consistent acquisition CTA into the existing email-code flow, plus an early
  sign-in route for returning people. Existing authenticated `/garden` redirect is
  preserved. No development-only preview is linked from the public page.
- A three-step Write / return / revisit explanation that shows immediate non-AI
  value and acknowledges lists and search as ways back.
- Plain-language permissions, history and export information, with a separate
  truthful disclosure that optional AI is being tested and automatic overnight
  delivery is not generally active.
- Scoped responsive styles using existing light/dark tokens; no new imagery,
  tracking, pricing, claims of traction, external services or dependencies.

## Verification and acceptance

Verified on Node 22: the three focused component tests passed, ESLint passed, and
the production build (including TypeScript) passed. Production browser smoke at
390 and 1280, each in light and dark, switched examples successfully, found no
horizontal overflow or browser errors, and checked both acquisition CTAs route
to `/login`. The authenticated redirect is covered by a mocked claims result;
no real account was read. The 390 light screenshot was inspected visually.

Local screenshots from this check: `/tmp/slow-garden-G1-<width>-<scheme>.png`.
These are disposable QA evidence, not committed product assets or proof of
physical-phone acceptance. The parent coordinator owns integrated QA and release
checks after merging this lane.

No conversion lift is claimed. This wave adds no analytics collection. Later
measurement can compare landing comprehension and sign-in-to-first-entry success
in an approved study; deployment or clicks alone do not establish product demand.

## Boundaries

This change does not activate AI, advertise an open pilot, or modify auth, account
creation, data permissions or product pricing. The example is an explanation of
the existing dated-entry model, not a saved starter garden or a model-quality demo.
