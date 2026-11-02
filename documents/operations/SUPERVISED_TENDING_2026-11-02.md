# Supervised tending receipt — November 2, 2026

Kyle explicitly requested a manual overnight-style run after saving and testing the
OpenAI key. This was a one-time supervised pass, not automatic nightly activation.
No source bodies, real model prose, account identifiers or credentials were returned
to the operator or committed here.

## Result

One cross-pollination scope covering the two opted-in plots and three source
revisions completed. Both Tend and Connect validated successfully. The database
stored four catalogue marks and zero blooms. Zero blooms is a valid small return.

Model: `gpt-6.1-sol`, reasoning effort `low`, Responses with `store:false` and no tools.
Workflow: `tend-connect-v3-supervised-sync-20261102`. Standard synchronous requests
were used for immediate completion, rather than submitting an overnight Batch job.
The pass still used the existing frozen snapshot, permissions, lease, budget
reservation, JS validators and database finalizer. Only this preselected pass could
be processed by the temporary authenticated function.

Usage: 2,062 input tokens and 468 output tokens. The database charged 0.8804 cents
at standard rates of $2/$10 per million input/output tokens. No provider files were
created. Final readback showed `complete`, four marks, zero blooms, and no pending
cleanup. The global runtime was restored to its original disabled/unapproved
configuration after the pass, and the temporary function was deleted.

## Integration fixes discovered

- The catalogue prompt explicitly requires source role `changed`, but its request
  builder omitted that field. A stricter model returned empty catalogue results.
  Including the role restored catalogue output in synthetic checks. A regression
  assertion now checks every Tend source carries the required role.
- Responses may contain reasoning metadata beside the message. The v3 parser now
  ignores that metadata while still rejecting tool calls and all other unexpected
  output. A regression test covers both acceptance and tool-call rejection.

## Synthetic checks and limitations

The nano and mini candidates produced structurally valid but semantically poor
results, including invented question/unfinished labels and shared-word connections.
They were not used for real writing. An initial Sol trial exposed the role mismatch;
that trial was diagnostic and crossed a deployment change, so it is not treated as
a controlled acceptance run.

After the fixes, a stable 30-case Sol run produced a valid result for every case;
all requested stages were accepted, with two invalid catalogue marks dropped by the
existing validator. The operator inspected the synthetic outputs: explicit questions
were quoted exactly, negative shared-word controls produced no blooms, and sparse
controls returned nothing. Recall was conservative: some expected labels and a
half-finished resurfacing example yielded no return. This is a supervised synthetic
review, not blinded human scoring or a claim that all alpha quality gates are met.

Worker tests: 31 passed. Deterministic v3 packet: 30 cases passed. Synthetic output
artifacts are preserved privately under the dated local Codex evidence directory;
they contain synthetic content only. Real output remains in the tenant-protected
application database for Kyle to inspect.

## Still pending

Automatic nightly tending remains off. The permanent scheduler/worker deployment,
provider lifecycle canaries, blinded quality acceptance, and documented residual
risks still follow the activation runbook. This manual receipt does not satisfy
Batch cancellation, idempotency, provider-file cleanup, restore or recurring-night
acceptance. The account overnight preference and plot permissions remain saved.
