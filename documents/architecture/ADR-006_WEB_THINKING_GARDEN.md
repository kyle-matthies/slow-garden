# ADR-006: Web thinking garden and permissioned returns

Status: Accepted for implementation by Kyle on 2026-09-06

The first complete dogfood target is slowgarden.app on phone, tablet, and desktop.
This supersedes native-first delivery sequencing, while preserving the native prototype.
Garden → plot → named seed → dated entry → immutable revision is the shared model.
A new entry is not a revision of the preceding entry. Existing seed histories become
one entry per seed in an Unsorted plot, preserving all source identifiers and bytes.

AI tending and cross-pollination are independent plot permissions, both off by default.
AI-on/cross-off material can inform only its own plot. Cross-plot passes require explicit
participation by every plot and never span gardens or tenants. Permission changes
invalidate queued or processing work and withdraw affected cross-plot returns.

Manual invitations come first. Validated returns appear quietly when ready, with no
artificial delay and no guaranteed overnight delivery. Zero blooms is a valid result.
Model activation requires the existing synthetic evaluation and private study gates.
Scheduling stays disabled until manual returns earn use. Capture works without AI.

Database migrations are additive. The original seed/revision API remains compatible.
The hosted v2 contract is distinct from the native v1 fixture contract. Queue payloads
contain IDs; frozen source revisions and derived output remain inside tenant storage.
The production provider adapter uses Batch over Responses, pinned workflow/model,
strict evidence validation, durable reconciliation, and server-side budget reservations.

Release separately: source foundation and writing UI; manual return runtime;
evaluated provider activation; optional schedule. Never claim the four-week diary or
private pilot complete from code, tests, or a deployment. Keep journal content out of
logs, CI, agent context, and public artifacts.
