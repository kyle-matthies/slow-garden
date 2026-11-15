# Go-to-market

- Status: Draft for owner review. Analysis and hypotheses, not accepted decisions.
- Date: 2026-11-15
- Owner: Kyle (decisions); drafted by workstream E of the [market readiness plan](MARKET_READINESS_PLAN.md)
- Scope: positioning, audience, pricing hypothesis and launch sequence. This document opens no gate: it activates no model, selects no vendor, and adds no tracking or billing.

Evidence labels: **[repo]** from this repository; **[web]** from a web search on 2026-11-15 (mostly third-party pages, not confirmed on the vendor's own pricing page unless stated); **[assumption]** unverified. No market size, user count or customer quote is claimed anywhere below.

## 1. Positioning

**Statement.** For people who think by writing, Slow Garden is a private journal that leaves you alone while you write and tends your pages overnight, returning at most three blooms that quote your own words. Unlike chat-first AI journals, it never answers while you are thinking, and it returns nothing when nothing has been earned.

**Promise.** Write by day. Wake to a bloom.

**Category.** Recommended public category: **thinking garden**, always paired with the plain descriptor "a private journal that is tended overnight". "Temporal co-thinking" stays internal; [PRODUCT_FRAMING](PRODUCT_FRAMING.md) already records it as abstract.

**Single differentiator.** The return is **asynchronous, bounded and source-linked**: it arrives later, it is capped at three, and each bloom shows the exact passages it came from and can be corrected. Privacy, the meadow and export are supporting proof, not the lead.

## 2. Audience

| | Who | Why |
|---|---|---|
| **Beachhead** | Solo writers of long-running work (essayists, newsletter authors, researchers drafting over months) who already journal or keep working notes and distrust AI that writes for them | Their material accumulates, so delayed cross-entry returns have something to work on; authorship is the thing they protect; they are reachable through writing itself |
| Adjacent 1 | Founders and independent professionals incubating a decision | "Decision incubation" job in PRODUCT_FRAMING |
| Adjacent 2 | Existing Obsidian or Day One users who want patterns across time without plugins or chat | Already pay for a notes habit; import (G3) lowers the switch |

The roadmap (Phase 4.1) says the audience should be chosen from Kyle-first evidence. The beachhead above is therefore a hypothesis **[assumption]** to confirm in the pilot, not a finding.

**Not for:** people who want a conversational companion or immediate feedback; anyone seeking therapy, diagnosis or crisis support (K-012); teams and shared workspaces; task and automation users; people who want AI to draft their prose.

## 3. Competitive map

Placement is a judgment from public product material **[assumption]**, consistent with the hands-on caveat in [COMPETITIVE_RESEARCH](COMPETITIVE_RESEARCH.md). Prices are **[web]** and must be re-checked on first-party pages before any public comparison.

| Product | AI interrupts ↔ waits | Summary ↔ source-linked | Price found (2026-11-15) |
|---|---|---|---|
| Rosebud | Interrupts: conversational prompts during entry; weekly report | Summary | Bloom $12.99/mo; one review reports no free plan since 2026-09-30 [1] |
| Day One (Gold) | On demand inside the entry: Daily Chat, Go Deeper | Summary (Multi-Entry Summary, Entry Highlights) | Silver $49.99/yr, Gold $74.99/yr [2][3] |
| Stoic | Prompted, in-session reflections | Summary | App Store snapshots show about $40/yr premium and $70–100/yr AI tier; snapshots conflict and are undated for 2026 [4] |
| Reflect | On demand in the editor | Partial (backlinks to notes) | About $10/mo, no free tier [5] |
| Mem | Chat-first and proactive | Partial | Free; Pro about $12/mo; a $99/mo proactive tier reported July 2026; sources conflict [5][6] |
| Notion AI | On demand; scheduled agents that can act | Partial (page references) | Bundled in Business, $20/member/mo annual [7] |
| Obsidian + AI plugins | On demand; related notes while writing | Source-linked (to notes) | Sync about $4–5/mo; Copilot plugin free with own key [8][9] |
| Journal + periodic prompt | Waits (manual) | Variable | Cost of an existing AI subscription |
| **Slow Garden** | **Waits: silent capture, overnight pass** | **Source-linked quotes, max three, correctable** | See section 4 |

Reading: the "waits + source-linked" corner is occupied only by the do-it-yourself substitute. That is the strongest competitor (K-001) and the one every launch asset must answer.

## 4. Pricing hypothesis

**Unit cost [repo].** [COST_AND_CAPACITY](../architecture/COST_AND_CAPACITY.md) plans 15,000 input and 2,000 output tokens per pass at $0.75/M and $4.50/M, which is about $0.02 per pass: $0.45/month at 22 passes, about $0.61/month if a pass ran every night (30). Rates date from 2026-08-25 and must be refreshed and replaced by provider receipts before pricing is published. A writing-only account has no model cost.

| Tier | Includes | Boundary |
|---|---|---|
| **Free: the journal** | Unlimited writing, Meadow and Pages, revision history, import, export, deletion | No tending. Marginal cost is storage only |
| **Trial: 28 nights** | Full nightly tending, no card | Matches the four-week study; modelled AI cost about $0.61 per trial |
| **Paid: tended, $12/month** | Nightly tending, max three blooms, cross-topic connection if enabled | Monthly, cancellable, no tiers, no credits, no annual plan yet (per [BUSINESS_MODEL_REVIEW](BUSINESS_MODEL_REVIEW.md)) |

At $12 on the web, modelled contribution is roughly $9.50/user/month after about $0.65 card fees **[assumption]** and the review's $1.55 variable-cost placeholders **[assumption]**. No per-bloom pricing: it would reward manufactured output and break "earn the reveal". $12 sits beside Rosebud and Mem and above Day One Gold's annual-equivalent, so the method, not the price, has to carry the difference.

**Confirming test.** At trial end in the paid beta, offer real paid continuation (charged, not surveyed), sequentially at $8, $12 and $15 as the review proposes. Confirm if (a) a pre-registered share of trial completers who received at least one kept bloom pay at $12, (b) payers can name an accumulation-dependent benefit, and (c) month-two retention holds. **Kill or rework** if conversion at $8 is no better than at $12 (price is not the problem; value is), or if payers describe the value as "a nice summary". The threshold in (a) is an owner decision; no benchmark is asserted here.

## 5. Launch sequence

| Stage | Entry | Exit | Metric |
|---|---|---|---|
| 0. Wave 1 (now) | Plan active | Wave 1 exit criteria in the readiness plan | Five-second comprehension of landing and levels |
| 1. Activation | Runbook Phases 0–3 go; model pinned (ADR-004); owner go/no-go | Phase 4 and 4b receipts; two weeks supervised tending on the owner's garden; weekly go/no-go clean; costs under the $10 soft cap | Every bloom traced to exact revisions; zero fabricated returns on sparse nights |
| 2. Private pilot (10–20 invited writers, four weeks) | Stage 1 exit; deletion-with-pending-work (3.9) and restore (3.10) receipted or accepted; consent and privacy explanation ready; external-pilot gate opened by owner | All seven conditions of the PROJECT_BRIEF success definition | **At least one bloom per active week kept, extended or discussed**, plus: capture useful without AI, relationships not obvious at entry time, every retained claim traceable and correctable, no manufactured meaning in sparse periods, return feels bounded, originals unchanged |
| 3. Paid beta | Stage 2 exit; billing vendor decided by ADR; support and deletion flows exercised | Pricing test in section 4 read out; support time and receipts replace placeholders | Paid continuation at trial end; month-two retention |
| 4. Public | Stage 3 exit; economic gate in the business model review | Owner decision | Qualified starts reaching a first kept bloom |

Until Stage 1 exits, public copy must state that overnight tending is not generally active, and demonstrations use labelled synthetic examples.

## 6. Channels and first ten assets

Channels, in order: founder writing; direct invitations to named writers; newsletters and podcasts about writing and note-taking; Obsidian and Day One communities (as a guest, with import as the offer); a single launch-day post on Hacker News and Product Hunt at Stage 4. No paid acquisition before the economic gate.

1. Landing page stating the method above the fold (workstream D).
2. Waitlist page with one question: "What are you writing over months?" (needs an owner decision on collecting email before the pilot gate).
3. Founding essay: "AI that waits".
4. Sixty-second demo film. Outline: a day of writing with nothing on screen but words; night; morning, three gold blooms; one opened to its quoted sources; one corrected; one morning with no bloom. Synthetic garden, labelled.
5. "How a bloom is made" explainer: snapshot, pass, quote check, cap of three.
6. Plain-language privacy and data page: what leaves the account, to whom, deletion.
7. Annotated sample garden visitors can explore (extends G1's example).
8. Comparison page: Slow Garden versus a journal plus a weekly prompt.
9. Pilot invitation and consent pack, with the four-week study protocol.
10. Press and screenshot kit: three levels, one return, one honest empty morning.

## 7. Top launch risks

| Risk | Mitigation | Register |
|---|---|---|
| It reads as a prettier weekly summary; DIY prompt is good enough | Lead every asset with source-linked quotes; publish the baseline comparison; kill criterion in section 4 | K-001 |
| Privacy incident or provider-retention discomfort ends trust | No pilot before deletion and restore receipts; privacy page before waitlist; terms review | K-003, K-017 |
| Claims outrun reality: "wake to a bloom" while tending is off, or read as a nightly guarantee when sparse nights correctly return nothing | Activation-state copy rule; show the empty morning in the film; consider "wake to at most three" in body copy | K-002, K-014; propose a new register entry |
| Journaling audience expects therapy | Non-clinical language, crisis boundary, writers as beachhead rather than wellness | K-012 |
| Only the owner values it; unit cost grows with corpus size | Pilot is the transfer study; bounded snapshots and cost caps; refresh rates before pricing | K-013, K-007 |

## 8. Open decisions for the owner

1. Go/no-go on activation (runbook 0.4 to 4b) and the pinned model. Everything after Stage 0 waits on this.
2. Open the external-pilot gate: who the 10–20 writers are, and consent terms.
3. Whether to collect waitlist emails now, before the pilot gate.
4. Beachhead: confirm long-form writers or name another segment.
5. Public category wording, and whether the promise needs softening for bloom-less mornings.
6. Price and free boundary: $12 test price, 28-night trial, and the conversion threshold that confirms or kills.
7. Billing vendor and web-only launch versus waiting for iOS (the brief still says iOS first; ADR-006 authorises web first).
8. Whether launch assets may show the owner's real garden. Default assumed here: synthetic only.

## Sources (accessed 2026-11-15)

1. Rosebud review, dated 2026-10-22, third party: https://blog.mylifenote.ai/rosebud-review/
2. Day One subscription FAQ, first party: https://dayoneapp.com/premium/faq
3. 9to5Mac on Day One Gold, 2026-04-08: https://9to5mac.com/2026/04/08/day-one-journaling-app-introduces-gold-plan-with-ai-summaries-and-daily-chat/
4. Stoic App Store listing (US): https://apps.apple.com/us/app/stoic/id1312926037
5. Mem versus Reflect pricing, third party: https://costbench.com/compare/mem-vs-reflect/
6. Mem proactive tier note, 2026-07-14, third party: https://www.usagepricing.com/blueprint/activity/mem-2026-07-14-proactive-tier-launch
7. Notion AI pricing guide citing Notion's page as of 2026-10-19, third party: https://www.sentra.app/articles/notion-ai-pricing
8. Obsidian pricing, third party citing obsidian.md/pricing: https://toolradar.com/tools/obsidian/pricing
9. Obsidian Copilot plugin listing: https://community.obsidian.md/plugins/copilot
