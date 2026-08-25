# Cost and capacity model

Status: Accepted planning envelope; rates must be refreshed before provider activation
Date: 2026-08-25
Currency: USD

## Planning scenarios

| Scenario | Gardens | Passes/month | Input tokens/pass | Output tokens/pass | Storage | Purpose |
|---|---:|---:|---:|---:|---:|---|
| Kyle expected | 5 | 22 | 15,000 | 2,000 | under 2 GB | Normal private alpha |
| Alpha stress | 20 | 87 | 50,000 | 4,000 | under 8 GB DB / 20 GB objects | Capacity and budget test |
| Runaway negative control | 20 | 1,000 | 100,000 | 8,000 | unchanged | Prove hard caps stop dispatch |

Snapshots above 100,000 input tokens are rejected before provider dispatch. Attachment extraction is not included in the initial token allowance and must declare a separate budget.

## Formula

```text
monthly model cost = passes * ((input_tokens / 1,000,000) * input_rate
                             + (output_tokens / 1,000,000) * output_rate)

monthly platform cost = base plan + compute/storage/egress overage
                      + observability + backup add-ons
```

The executable model is in `spikes/cost-model/cost-model.mjs`.

## Current rate evidence and conservative assumptions

- Supabase [Pro pricing](https://supabase.com/pricing) currently starts at $25/month and includes one Micro-equivalent compute credit, 8 GB database disk, 100 GB file storage, daily database backups retained seven days, and a spend cap enabled by default.
- The OpenAI [Batch API](https://developers.openai.com/api/reference/resources/batches) is asynchronous with a 24-hour window. Current model prices vary and can change.
- For planning, use the currently listed [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) text rates of $0.75/M input and $4.50/M output. Treat those as refreshable assumptions and verify the Batch invoice before activating real passes. Pin a model snapshot only after quality evaluation.

At those conservative rates:

- Kyle expected inference: about $0.45/month.
- Alpha stress inference: about $4.83/month.
- Supabase Pro baseline: $25/month before optional backup/observability additions.

The expected private-alpha operating target is **under $35/month**. The model-cost soft cap is $10/month and hard cap is $15/month. Crossing the soft cap pauses new automatic passes and requests review; crossing the hard cap blocks all provider dispatch, including manual passes, until Kyle changes the cap explicitly.

## Whole-system planning range

| Component | Expected/month | Stress planning/month | Notes |
|---|---:|---:|---|
| Supabase Pro and included Micro compute | $25 | $25 | Current published baseline; spend cap remains enabled |
| Model inference | $0.45 | $4.83 | Conservative mini-model token rates from executable spike |
| Static web hosting | $0 | $0-20 | Private static PWA; select host only when preview workflow is built |
| Metadata observability | $0 | $0-5 | Use included logs/metrics first; no paid content log drain |
| Attachment backup | $0 before activation | $0-10 target | Real attachments blocked until S5 selects and prices a mechanism |
| Email delivery | $0 at alpha volume | $0-5 | Custom SMTP may be selected for reliable one-time codes |
| **Total** | **about $25.45** | **target below $70** | Optional services require their own cap and receipt |

The under-$35 target applies to the expected text-first private alpha. Attachment backup or paid hosting can raise the envelope only through a recorded activation decision; they are not hidden inside the inference estimate.

## Cost allocation per pass

Before dispatch, reserve estimated cents based on serialized token count plus 25% output/overhead margin. On terminal provider receipt, replace the reservation with actual usage and release the remainder. A retry consumes a new reservation and remains linked to the originating pass. The UI shows pass-level estimated/actual cost in settings, not on the quiet garden surface.

## No-run gates

Do not dispatch when any condition is true:

- monthly hard cap reached or reservation would exceed it;
- owner/garden concurrency limit reached;
- snapshot exceeds token or attachment budget;
- provider rate/configuration is missing or stale;
- garden paused, permission revoked, or workflow disabled;
- duplicate idempotency key already exists;
- an automatic pass produced no changed eligible evidence since the previous snapshot.

## Cost alarms

- Daily alert at 50%, 80%, and 100% of monthly model hard cap.
- Alert on any single pass above $1 estimated or actual during alpha.
- Alert when retry cost exceeds the original attempt.
- Weekly content-free report: passes attempted/completed/no-output/failed, tokens, storage, and cost.
- Supabase spend cap remains on. Do not enable overages without a recorded decision.

## Storage and backup caveat

Database backups and Storage recovery are separate. The $25 baseline does not prove attachment disaster recovery. The attachment backup spike must price and select either a second encrypted object copy or an automated encrypted export before real attachments are accepted.
