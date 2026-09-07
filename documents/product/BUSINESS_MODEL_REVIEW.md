---
owner: codex
status: draft-for-kyle-review
privacy: private
created: 2026-09-05
source_commit: de84e78e70264f2af99edbebbc2b1e8f9a5bb180
persona: independent CFO and skeptical seed investor
scope: business model, pricing, unit economics, and capital-allocation review
---

# Business model review

## Purpose and conclusion

This is a durable record of the September 2026 independent CFO/seed-investor review. It is analysis, not an accepted product or funding decision. It preserves the distinction between observed repository evidence, external pricing facts, and planning assumptions so that a later decision does not mistake a modeled outcome for traction.

**Verdict:** Slow Garden is a credible bootstrapped personal-product experiment, not presently a venture-backed business case. The product’s interaction thesis is distinct enough to test: quiet spatial capture, delayed cross-entry interpretation, exact provenance, correction, and a scarce return of zero to three blooms. Its cost-control design is also unusually explicit for an early AI product. Neither establishes that a buyer will pay, retain, or be acquired economically.

The next investment should buy evidence, not growth: prove that the delayed return beats a journal plus a periodic prompt; establish willingness to pay; then measure retention, support burden, and actual provider receipts. Do not use the narrow recurring-infrastructure threshold below as operating break-even or business validation.

## Evidence from the repository

The initial buyer is an individual who wants private, interruption-free reflection, decision incubation, creative problem solving, or research gardening. The product explicitly excludes a chat-first interface, clinical claims, public sharing, team collaboration, engagement loops, and automatic external action. See [product framing](PRODUCT_FRAMING.md), [project brief](../PROJECT_BRIEF.md), and [trust contract](TRUST_AND_APPROVAL_CONTRACT.md).

The differentiated wedge is not simply an AI journal or an AI canvas. It requires six conditions together: useful capture before AI, silent capture, revisioned accumulation, visible delay, at most three source-linked and correctable blooms, and preparation without execution. Its strongest substitute is explicitly recognized as a private journal plus a periodic Codex prompt. See [competitive research](COMPETITIVE_RESEARCH.md).

Current product status is materially earlier than a commercial launch claim. The web companion supports authenticated private gardens and seed capture. The local native slice uses a deterministic fixture bloom generator; it is not a production provider result. The roadmap still requires a diary study, 5–8 reflective-worker interviews, a delayed-versus-immediate comparative study, a 48-case evaluation corpus, full native runtime evidence, and a four-week dogfood before the product thesis is validated. See [roadmap](../ROADMAP.md), [evaluation architecture](../architecture/EVALUATION_ARCHITECTURE.md), and [alpha backlog](../operations/ALPHA_IMPLEMENTATION_BACKLOG.md).

The accepted architecture protects the commercial premise rather than only technical correctness: personal tenants are isolated, originals remain append-only, model output is traceable, no content is logged as telemetry, and a pass can return no bloom. A trust or privacy failure would be a direct economic failure because it destroys the reason to choose the product over an existing notes tool. See [personal multi-tenant ADR](../architecture/ADR-005_PERSONAL_MULTI_TENANT.md) and [cost and capacity model](../architecture/COST_AND_CAPACITY.md).

## Buyer, budget, and model recommendation

**Recommendation, not evidence:** start with a simple iOS-first personal subscription. The hypothesized buyer is a privacy-sensitive knowledge worker who has unfinished material across time and values a cautious return enough to spend from a discretionary personal-software budget. A $12/month test price is a planning input, not a validated willingness-to-pay result.

Avoid per-bloom, credit, or token pricing. Those models give the person an incentive to generate content and pressure the product to emit more interpretations, which conflicts with the quiet-foreground principle and the validity of no output. Early annual plans should also wait: annual cash is not twelve months of earned revenue and can conceal poor monthly retention.

Suggested sequence:

1. Invite-only evaluation after product-quality gates pass.
2. One cancellable monthly offer at $12, without feature tiers that complicate learning.
3. Small sequential price tests at $8, $12, and $15 with the same product and explicit conversion behavior, not survey preference.
4. Annual pricing only once monthly retention and cancellation reasons are known.

A team or innovation-management edition is a different future business. It would need a named economic buyer, an existing funded workflow, shared authorization, consent/revocation, audit requirements, and willingness to pay above personal-software levels. The current private personal product does not prove that market and should not inherit its complexity.

## External pricing facts and model assumptions

The following external rates were checked on 2026-09-05 and must be refreshed before provider activation or public pricing.

- Apple states that the Small Business Program has a 15% commission on paid apps and in-app purchases for qualifying developers; the Apple Developer Program costs $99 per membership year. Eligibility, taxes, storefront terms, and alternative-payment rules remain separate checks. [Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/) and [Apple Developer Program](https://developer.apple.com/programs/enroll/).
- OpenAI’s current GPT-5.4 mini model page explicitly labels the following as **Batch API price** per one million text tokens: $0.75 input, $0.075 cached input, and $4.50 output. The page lists the Batch endpoint. This is a rate fact, not a forecast of a user’s monthly model cost. [OpenAI GPT-5.4 mini pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
- Supabase currently lists Pro from $25/month, with stated included capacity and overage terms. [Supabase pricing](https://supabase.com/pricing).

The repository’s current expected scenario of 22 passes/month, 15,000 input tokens/pass, and 2,000 output tokens/pass reconciles to $0.4455/month at the stated Batch rates. Its stress scenario reconciles to $4.8285/month. This supports the existing $0.45 and $4.83 planning estimates, but it does not prove actual workload, quality, cache use, retry behavior, model selection, or invoice outcome. Retain **$0.50 per active user/month** only as an explicit AI-cost planning assumption until protected synthetic canaries and provider receipts establish a measured range.

The illustrative unit model below uses these assumptions, all of which are adjustable and unvalidated except where external sources are cited:

| Input | Planning value | Meaning |
|---|---:|---|
| Monthly subscription price | $12.00 | Test price, not confirmed willingness to pay |
| Refund/credit allowance | 3% of billings | Placeholder for planning; actual policy and behavior unknown |
| App Store commission | 15% | Assumes qualifying Small Business Program participation |
| AI variable cost | $0.50/user/month | Planning allowance; validate from Batch receipts |
| Support variable cost | $0.80/user/month | Placeholder for human support, not a measured service level |
| Incremental storage/operations | $0.25/user/month | Placeholder beyond base platform costs |
| Founder development | 15 hours/month at $100/hour | Opportunity cost, not necessarily cash compensation |

## Contribution calculation and correction

```text
net cash proceeds/user/month
  = price × (1 - refund allowance) × (1 - App Store commission)
  = $12.00 × 0.97 × 0.85
  = $9.894

variable cost/user/month
  = AI $0.50 + support $0.80 + incremental operations $0.25
  = $1.55

contribution/user/month
  = $9.894 - $1.55
  = $8.344
```

An earlier analysis described roughly nine paying users as break-even using a narrow $68.25/month recurring-infrastructure allowance. That description is corrected here: **nine users cover only the modeled recurring platform allowance after the stated per-user assumptions. It is not operating break-even, cash-flow break-even for the company, or proof of viability.**

It excludes initial build, realistic support escalation, acquisition, payment/billing administration, legal and privacy work, accounting, taxes, insurance, refunds beyond the 3% placeholder, hardware/device testing, incident response, and founder labor. A full operating model must include those categories and distinguish one-time launch cost, fixed recurring cost, variable cost, customer-acquisition cost, and cash timing.

Under the same illustrative assumptions, adding $1,500/month in founder-development opportunity cost requires about 188 average paying users to cover only the modeled platform and founder time. That is still not a full operating model because the excluded categories remain material.

## Twelve-month scenario framing

These are bottom-up sensitivity cases, not forecasts or evidence of customers. They assume monthly subscriptions, no paid acquisition, a $12 price, the contribution math above, and an illustrative $819 annual fixed platform allowance. Gross ARR means end-month gross subscription run-rate multiplied by 12. It is not revenue recognized during the year or cash collected during the year.

| Scenario | Quarterly average paid users | Year-one gross billings | Modeled cash proceeds | Modeled contribution after variable and fixed cost | End-month gross ARR |
|---|---:|---:|---:|---:|---:|
| Prove | 10 / 25 / 50 / 75 | $5,760 | about $4,749 | about $3,186 | $10,800 |
| Bootstrap | 30 / 75 / 150 / 250 | $18,180 | about $14,989 | about $11,822 | $36,000 |
| Early signal | 100 / 300 / 650 / 1,000 | $73,800 | about $60,848 | about $50,497 | $144,000 |

Subtracting the $18,000 annual founder-development opportunity-cost input makes the first two scenarios economically negative. The third would be positive under these deliberately narrow assumptions, but it still would not establish venture scale, repeatable acquisition, durable retention, or defensibility.

For financial reporting, track four separate values: gross billings, refunds/credits, platform proceeds actually remitted, and revenue recognized for service delivered. Annual subscription cash should be recognized over the subscription term, not immediately. Accounting presentation of App Store commission should be reviewed with an accountant rather than inferred from this planning model.

## Defensibility, experiments, and capital gates

No present moat exists in asynchronous processing, a garden visual metaphor, or access to a foundation model. Potential defensibility must be earned through durable trust, source-linked correction, longitudinal evidence of useful delayed returns, and retention arising from a calmer interaction model. Private material must never become generic training or marketing evidence without separate authorization.

Fund only the following gates, in order:

1. **Quality gate:** compare no AI, immediate reflection, weekly summary, and Slow Garden on the established corpus. Continue only if it meets the stated faithfulness, no-output, overreach, usefulness, and accumulation-dependence thresholds.
2. **Willingness-to-pay gate:** after quality passes, run a defined private cohort. Continue only if people choose paid continuation and can identify an accumulation-dependent benefit; survey enthusiasm is insufficient.
3. **Retention and support gate:** measure second-month use, cancellation reasons, correction rates, privacy/support incidents, and actual per-user support time. High keep rate alone is not quality evidence.
4. **Economic gate:** replace all AI, storage, support, refund, and platform assumptions with observed receipts before spending on acquisition.
5. **Venture gate:** consider institutional capital only after repeatable acquisition, durable retention, and a credible path to materially higher contribution dollars per customer or a separately validated organizational buyer.

Do not fund paid acquisition, Android, attachment processing, enterprise compliance, team collaboration, or fundraising before these gates. The correct immediate allocation is evaluation, native/private-alpha reliability, carefully bounded pricing research, and measured retention.
