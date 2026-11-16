# Privacy architecture options

Status: Research for owner decision. No vendor, provider, or architecture is chosen by this document.
Date: 2026-11-16
Scope: how private writing can be protected while the overnight AI pass still works
Related: [threat model](PRIVACY_SECURITY_THREAT_MODEL.md), [ADR-003](ADR-003_DATA_AND_TRUST_BOUNDARY.md), [ADR-004](ADR-004_MODEL_AND_EVALUATION.md), [ADR-005](ADR-005_PERSONAL_MULTI_TENANT.md), [data contract](DATA_AND_PROVENANCE.md), [security review](../operations/SECURITY_REVIEW_2026-09.md), [activation runbook](../operations/AI_ACTIVATION_RUNBOOK.md) Phase 1, risk K-017 in the [risk register](../RISK_REGISTER.md)

## How to read the evidence

Every external claim carries a source number (see [Sources](#sources)) and a grade. All sources were accessed 2026-11-16.

| Grade | Meaning |
|---|---|
| **[D]** | First-party documentation, full page text read (Supabase docs only, through the Supabase documentation search tool). |
| **[S]** | First-party page, read only as a search-engine summary. Direct page fetches were blocked in the research session, so the exact wording was not seen. Re-read the page before relying on it. |
| **[3P]** | Third-party source only. Treat as a lead, not a fact. |
| **[A]** | Assumption or engineering judgement of this document. Not verified against any vendor. |

Research limitation that matters: apart from Supabase docs, nothing here was read in full. Before any of this becomes a public promise or a contract position, the cited first-party pages need a direct read and the result recorded with a date, as runbook step 1.1 already requires. Vercel's data handling was not researched.

---

## One-page summary

### The three questions

**How do journaling and document companies handle this?** They fall into three camps.

1. Server-readable with contractual limits (Notion, Mem, Rosebud). The company can technically read the content; AI is full-featured; protection is policy, contracts with AI providers, and audits.
2. End-to-end encrypted with no cloud AI, or AI only on the device (Obsidian Sync, Standard Notes, Proton Docs, Apple Journal, Stoic's storage). The company cannot read stored content; AI is absent, limited, or runs on the user's hardware.
3. End-to-end encrypted at rest, with an opt-in exception for AI (Day One, reportedly Reflect). Day One's own documentation says content from encrypted journals is "temporarily not end-to-end encrypted while being processed with AI" [S-1]. This is the only pattern found that combines client-held keys with cloud AI, and it is honest about the gap.

No product was found that runs a cloud model over journal text that stays encrypted throughout. A model has to see plaintext somewhere: on the device, in a provider's memory, or inside attested hardware.

**Does Supabase support a private cloud, and what does that mean?** Not in the sense of "nobody but us can reach the data."

- Every hosted project already gets its own Postgres database, encrypted at rest [S-11][S-12]. Supabase staff access is described as role-limited and logged, not impossible [S-12].
- Network privacy options exist (IP restrictions, SSL enforcement, AWS PrivateLink in beta on Team and Enterprise). PrivateLink covers direct database connections only, not the API, Auth, Storage, or Realtime [D-8].
- A "bring your own cloud" offering (Supabase running inside the customer's AWS account) has an early-access page [S-13]. A pricing tracker reports it was removed from the Enterprise plan list in late August 2026 [3P-14]. Its current status is unknown and is a sales question.
- No first-party statement of customer-managed encryption keys was found [A].
- Self-hosting is possible, but then the founder is the security team, and Supabase's docs say its HIPAA controls are not supported out of the box when self-hosted [D-6].

None of these changes what someone who gets into the database can read. That is decided by application-layer encryption, which Supabase does not provide as a turnkey feature (its column-encryption extension is being deprecated and is not recommended for new use [D-10]).

**Can it be secure from attack and still support AI inference?** Yes, with a defined and disclosable exposure window instead of a permanent one. The realistic ladder is:

| Step | What an attacker who steals the database gets | What the AI pass costs you |
|---|---|---|
| A. Today, hardened | Everything, in plaintext | Nothing |
| B. Per-user keys held outside the database | Ciphertext | Small: one extra service in the path |
| C. Client-held keys, device seals a time-boxed "tending envelope" | Ciphertext, plus at most one pending envelope per user that only the worker key can open | The pass covers what the device last sealed; lost key means lost journal |
| D. On-device or attested-hardware inference | Ciphertext | A weaker or different model; re-run of the evaluation gates |
| E. Dedicated or self-hosted data plane | Same as whichever of A to D runs on it | Money or operations burden, not secrecy |

### Recommendation by stage

| Stage | Recommended posture | Trigger to move on |
|---|---|---|
| Now: supervised, owner's own journal | **A, hardened**, with the provider retention question closed first | The first real entry written by anyone other than the owner |
| Private pilot | **B**: per-user envelope encryption, key destruction on account deletion, provider retention contract or explicit disclosure, design kept compatible with C | Open sign-up, payment, any marketing claim about privacy, or any pilot incident |
| Public launch | **C** as the target (sealed journal plus tending envelope), with **D (attested inference)** adopted only if a model passes the ADR-004 gates | Not applicable |

E is not recommended at any stage unless a regulator or enterprise customer requires it.

### Two things that change today's plan

1. **The Batch path is the wrong shape for zero retention.** The worker uploads a file and creates a batch. OpenAI's help center says Zero Data Retention does not apply to the Batch API, and the developer docs list the Files endpoint as not eligible [S-17][S-16]. Anthropic's batch API is likewise not eligible and has a published 29-day retention [S-20]. `store: false` in the request body does not change this. A synchronous call to `/v1/responses` is the eligible route. Runbook step 1.1 cannot be passed honestly as "zero retention" while the design is Batch.
2. **Deletion is slower than the product says until keys are per-user.** Supabase backups keep deleted rows restorable for 7 to 30 days depending on plan, or 7 to 28 days with point-in-time recovery [D-9]. Option B fixes this by destroying the user's key.

---

## 1. What leaves the database today

Read from `supabase/functions/garden-worker/index.ts` and `supabase/functions/_shared/garden-runtime.mjs` on 2026-11-16.

| Item | Observed in code |
|---|---|
| Who calls the provider | A Supabase Edge Function holding `OPENAI_API_KEY` and the Supabase service-role key. It talks to the database only through RPCs. |
| What is sent | For each source in the snapshot: `revision_id`, `seed_id`, `title`, full `body`, `created_at`, `role`; plus the user's correction texts, a prior index, the system prompt, and the JSON schema. No email or account ID is in the payload. `pass_id` is sent as batch metadata and inside `custom_id`. |
| How it is sent | One JSONL file uploaded to `/v1/files` with purpose `batch`, then a batch created against `/v1/responses` with a 24-hour window. Each line sets `store: false`. |
| Cleanup | The worker deletes input, output, and error files after ingestion or cancellation. No expiry is set on the uploaded file, so a crashed worker leaves the file at the provider until something deletes it. |
| A second plaintext copy | `private.pass_inputs.snapshot` holds the source bodies for the pass inside Postgres (service-role only). |
| Tools | None. The prompt forbids tools and research. |

Consequences for this document: the journal body exists in plaintext in at least four places during a pass (source tables, `pass_inputs`, the provider file, the provider's processing and abuse-monitoring systems) and in database backups afterwards.

---

## 2. How comparable products protect private writing

"Who can read plaintext" means technically able, not permitted.

| Product | At-rest model | Who can read plaintext | Where AI inference runs | Stated provider retention and training terms | Deletion and export | Grade |
|---|---|---|---|---|---|---|
| **Day One** | End-to-end encryption on by default for new journals; older "standard" journals have keys held by Day One [S-2] | E2EE journals: the user only. Standard journals: Day One staff hold keys [S-2] | Opt-in. Content from E2EE journals is "temporarily not end-to-end encrypted while being processed with AI"; queries go to third-party AI services; on-device models used where available [S-1] | Says queries are not stored on its servers or the providers' and are not used for training [S-1] | Lost key with no backup means permanent loss [S-2]. Plain-text and JSON exports are not encrypted [S-2] | S |
| **Apple Journal** | End-to-end encrypted in iCloud when two-factor authentication and a passcode are set [S-3] | The user; Apple says it cannot read entries [S-3] | Journaling suggestions are computed on-device [S-3]. No Apple source was found tying Journal to Private Cloud Compute [A] | Not applicable (no third-party provider found) | Not researched | S |
| **Notion AI** | Server-side encryption; not E2EE [A, absence of any E2EE claim] | Notion and its subprocessors | Third-party LLM providers, named as Anthropic and OpenAI [S-4] | Contractual ban on training. Zero retention at LLM providers for Enterprise workspaces; up to 30 days for other plans. Embeddings deleted within 60 days of page deletion [S-4] | Not researched | S |
| **Obsidian** | Local files, not encrypted locally. Sync offers E2EE with a user password, or a "managed" option where Obsidian stores the password [S-5] | With E2EE: the user only. Local vault: anyone with the device [S-5] | No first-party AI finding either way [A] | Not applicable | Forgotten E2EE password means the remote data is unusable forever [S-5]. Files are plain Markdown on disk | S |
| **Reflect** | Marketed as end-to-end encrypted with a user password [S-6, 3P-7] | The user; plus OpenAI during AI use [3P-7] | OpenAI, when the user turns AI on [3P-7] | Not verified | Not verified | 3P |
| **Mem** | Encrypted in transit and at rest; not E2EE [S-8] | Mem (says access only with explicit permission for troubleshooting) [S-8] | OpenAI API [S-8] | Says its OpenAI API calls are not used for training [S-8]. Retention not found | Not verified | S |
| **Rosebud** | Described as encrypted in transit and at rest. Its marketing also uses "end-to-end", which conflicts [S-9, 3P] | Unclear; treat as server-readable [A] | OpenAI, Anthropic, Google, AWS, Groq [S-9] | Says it holds BAAs and Zero Data Retention agreements with these providers [S-9]. A competitor claims its terms allow de-identified data use; unverified [3P] | Not verified | S / 3P |
| **Stoic** | On the device, optionally the user's own iCloud. Says it has no servers of its own [S-10] | The user; Apple under standard iCloud protection unless Advanced Data Protection is on [S-10] | AI features are opt-in [S-10]. Provider and retention not found [A] | Not found | Local data, so user-controlled | S |
| **Standard Notes** | End-to-end encrypted [3P-21] | The user only | No AI assistant shipped [3P-21] | Not applicable | Not verified | 3P |
| **Proton Docs** | End-to-end encrypted [3P-22] | The user and people they share with | No finding that AI runs inside Docs [A]. Proton's separate assistant, Lumo, runs open models on Proton-controlled servers and says it keeps no logs and does not train on chats [3P-22] | Proton operates the models itself [3P-22] | Not verified | 3P |
| **Small on-device AI journals** (CortexOS, Weave, Reflectr and similar) | Local or E2EE, per their own listings [3P-23] | The user | A small model on the phone [3P-23] | Not applicable | Unverified marketing claims | 3P |

What this costs them in AI features:

- Camp 2 products either ship no AI or keep it to tasks a phone model can do in a few thousand tokens.
- Day One shows the price of camp 3: AI is opt-in, per journal, and its documentation has to say plainly that encryption is suspended during processing.
- Camp 1 gets every AI feature and carries the full breach and insider risk, mitigated by contracts. Notion reserves zero retention for its Enterprise tier, which suggests it is a cost or negotiation item, not a default [S-4].

---

## 3. Supabase: what the options really are

| Option | What "private" means here | What it does not mean | Cost or requirement | Grade |
|---|---|---|---|---|
| **Shared platform, any paid plan** (today) | Your own Postgres database per project. AES-256 at rest for data and backups; keys generated per project and protected by hardware security modules. TLS in transit [S-11][S-12] | Supabase staff access is role-limited and logged, not removed [S-12]. Anyone with the service-role key, a database password, or a dashboard login reads everything | Already in use | S |
| **Larger or dedicated compute add-ons** | More resources for the same project | No additional confidentiality found [A] | Small compute is required for point-in-time recovery [D-9] | D / A |
| **Network restrictions and SSL enforcement** | Only listed IP ranges can open direct Postgres connections; connections must use TLS [D-7] | Does not restrict the HTTPS data API that the web app and worker use [A, from D-7 and D-8 wording] | Generally available [D-7] | D |
| **PrivateLink** | Private AWS network path to the database; public database connectivity can then be turned off by support [D-8] | Database and pooler connections only. API, Storage, Auth, Realtime stay on the public internet [D-8]. Slow Garden's worker uses the API, so it gains nothing as built | Beta; Team or Enterprise plan; an AWS VPC in the same region [D-8] | D |
| **SOC 2 Type 2, ISO 27001** | Audited controls. The SOC 2 report is available to Team and Enterprise customers [S-12][S-15] | An audit is evidence of process, not a technical barrier | Team plan listed "from $599/month" [S-15] | S |
| **HIPAA add-on with a BAA** | Supabase signs as a business associate; projects marked "High Compliance" get continuous configuration checks; requires point-in-time recovery, SSL enforcement, network restrictions, and organisation MFA [D-6] | Not a different storage system. Docs say data is encrypted at rest and in transit and that "you can consider encrypting the data at your application layer" [D-6]. Only relevant if Slow Garden is legally a covered entity or business associate (lawyer question) | Team plan or above, plus the add-on. A third-party figure of $350/month is unverified [3P-15] | D / 3P |
| **Bring your own cloud** | Supabase deployed in the customer's AWS account, operated by Supabase [S-13] | Supabase still operates it, so it presumably keeps access [A]. Reported removed from the Enterprise plan list in August 2026 [3P-14] | Early access, sales-led; status unknown | S / 3P |
| **Self-hosting** | You run the open-source stack on your own machines | You own patching, backups, monitoring, and incident response. Point-in-time recovery needs your own tooling; several platform features are unavailable [D-7]. HIPAA controls are "not supported out of the box" [D-6] | Infrastructure plus the founder's time | D |
| **Customer-managed keys** | Not found in first-party material | One third-party page claims Enterprise BYOK; unverified [3P] | Sales question | A |
| **Vault** | Secrets encrypted in the database with a key Supabase stores outside it, so a database dump or backup shows only ciphertext [D-10] | The decrypted view is readable by any role granted access, and Supabase manages the key [D-10]. It is built for secrets such as API keys, not for bulk journal text [A]. Status: public alpha [D-7] | Included | D |
| **Column encryption (pgsodium)** | Was offered as transparent column encryption | Supabase "does not recommend any new usage"; pending deprecation, citing operational complexity and misconfiguration risk [D-10] | Do not build on it | D |

Backups and deletion:

- Daily backups are kept 7 days on Pro, 14 on Team, up to 30 on Enterprise. Point-in-time recovery replaces daily backups and can be set to 7, 14, or 28 days at roughly $100, $200, or $400 a month [D-9].
- A row deleted today can therefore be restored from backup until that window passes [A, direct consequence of D-9]. The public deletion promise must state this window.
- Deleting the whole project removes its backups permanently [D-9].
- Database backups do not include Storage objects [D-9], which matters when attachments arrive (threat T-12).

Regions: the list of available regions was not retrieved [A]. Edge Function log retention was not found separately from plan-level log retention (reported as 28 days on Team [S-15]).

---

## 4. AI inference: what each option really guarantees

| Option | Default handling | Strongest available setting | Catch for Slow Garden | Grade |
|---|---|---|---|---|
| **OpenAI API** | Abuse-monitoring logs for all API usage, kept up to 30 days unless law requires longer [S-16]. Not used for training by default [3P-16] | Zero Data Retention or Modified Abuse Monitoring, by prior approval, on eligible endpoints only [S-16] | The help center says ZDR does not apply to the Batch API [S-17]. A newer snippet says ZDR organisations can run batches but batch files and artifacts are kept under batch and file retention policies [S-17]. Files are listed as not eligible and are kept until deleted or until an `expires_after` time [S-16, 3P]. Batch output files default to 30 days unless a shorter expiry is set [S-17] | S |
| **OpenAI Private Safety Processing** | Previewed 2026-08-19 as cross-session misuse detection that keeps zero retention; rollout and a white paper were planned for September 2026 [3P-18] | Unknown until the white paper is read | Availability to a small account is unknown | 3P |
| **Anthropic API** | Inputs and outputs deleted within 30 days, with exceptions [S-19] | ZDR by arrangement with sales, per organisation [S-20] | Batches are not ZDR-eligible (29-day retention); the Files API is not eligible [S-20]. The newest models (Claude Fable 5, Mythos 5) are reported to require 30-day retention with no ZDR [S-20, non-English copy of the page] | S |
| **AWS Bedrock** | AWS says it does not store or log prompts and completions, does not train on them, and model providers have no access [S-24] | A `data_retention_mode` of `none` blocks any model that requires retention instead of silently retaining [S-24] | Claude Fable 5 and 5.1 traffic is retained up to 30 days for abuse detection, with possible human review of flagged traffic [S-24]. Batch inputs and outputs live in the customer's own S3 bucket [S-24]; service-side batch retention not confirmed [A] | S |
| **Azure OpenAI** | Older first-party text: prompts and outputs stored up to 30 days for abuse monitoring; newer text is reported to have changed [S-25, 3P] | Modified abuse monitoring for approved customers: prompts and completions not stored [S-25] | Approval is limited to eligible, managed customers [3P-25]. Batch handling not found | S / 3P |
| **Google Vertex AI** | In-memory caching by default; prompt logging for abuse monitoring applies to some billing arrangements [S-26] | Zero retention by disabling durable caching and, where it applies, obtaining an abuse-logging exception [S-26] | Batch handling not found. Product naming is changing [S-26] | S |
| **Attested-hardware (TEE) inference** | Prompts are decrypted only inside a hardware enclave whose software the client can verify by remote attestation. Vendors include Tinfoil and Phala, each with an OpenAI-compatible API [S-27][3P-28] | The operator and cloud host cannot read memory, if the attested software is what it claims | Mostly open-weight models [A]. Attestation proves what was launched, not everything that happens at runtime [S-27]. Young vendors. The 48-case evaluation corpus would have to be re-run on a different model (ADR-004) | S / 3P |
| **Apple Private Cloud Compute** | Apple's attested server model | Not confirmed as callable by third-party apps today [A, 3P-29] | Wait for Apple documentation | 3P |
| **Self-hosted open-weight model** | You run the model; no third party sees prompts | Full control | You become the provider: GPU cost, patching, and a plaintext-processing server of your own to defend [A] | A |
| **On-device model on iPhone** | Apple's on-device model has a 4,096-token context window per session, shared between input and output [S-29] | Text never leaves the phone | Months of journal text do not fit. Cross-entry reasoning would need staged summarising on the phone, with unknown quality against the evaluation gates [A]. The web app has no equivalent | S / A |

Reading across the table:

- Zero retention and batch processing do not go together at OpenAI or Anthropic. Zero retention is a negotiated contract, not a request flag.
- "Not used for training" is the common default for paid APIs. Retention for abuse monitoring is the real variable.
- The newest frontier models are moving towards mandatory 30-day retention at one major provider [S-20][S-24]. Pinning an older or different model to keep zero retention is a legitimate product decision under ADR-004.
- No offering was found that lets a frontier closed model run where the provider itself cannot see the prompt [A].

---

## 5. Architecture options for Slow Garden

Effort and cost entries in this section are this document's judgement [A].

### Who can read what

"Reads" means journal bodies and bloom prose. "Window" means only content inside an in-flight pass.

| Compromise | A. Today, hardened | B. Per-user envelope keys in a KMS | C. Client-held keys plus tending envelope | D. On-device or attested inference | E. Dedicated or self-hosted |
|---|---|---|---|---|---|
| **Database** (stolen backup, SQL injection, RLS mistake, service-role key leak, database-level insider) | Everything, all users, all history | Ciphertext only. Deleted accounts are unrecoverable once their key is destroyed | Ciphertext, plus pending envelopes that only the worker's key can open | Ciphertext | Same as the option it hosts; fewer outside insiders, more reliance on the founder |
| **Worker or key service** (Edge Function secrets, KMS credentials) | Everything | Everything the key service will release; rate limits and audit logs bound the speed and make it visible | Window only: envelopes submitted during the compromise | On-device: nothing. TEE: nothing if attestation holds | Same as the option it hosts |
| **Web server** (Vercel deployment or build pipeline) | Content of users who sign in while compromised | Same | Same, and worse in one respect: malicious JavaScript can take the user's key in the browser. The native app is not exposed this way | Same as C for the web client | Same |
| **AI provider** (breach or insider) | Window, plus whatever the provider retains: up to 30 days by default, files until deleted | Same as A | Same as A, limited to what the user sealed for tending | On-device: nothing. TEE: nothing readable if the enclave holds | Self-hosted model: you are the provider |
| **Developer's laptop** (dashboard session, access tokens, MCP connection, `.env` files) | Everything | Ciphertext, unless the laptop also holds key-service credentials. Keep them off it | Ciphertext. A stolen deploy credential still enables the web-server attack above | Same as C | Usually worse: self-hosting concentrates more credentials on the founder's machine |

### What each option does to the product

| | A | B | C | D | E |
|---|---|---|---|---|---|
| **Overnight pass** | Unchanged | Unchanged; the worker asks the key service to decrypt the snapshot | The device seals the snapshot when the user finishes for the day; the server holds it encrypted until the pass runs, then deletes it. Nothing is tended that the device did not seal | On-device: runs when the phone is idle and charging, small context. TEE: as C, with a different model | Unchanged |
| **Search** | Server-side, simple | Server-side search needs a decrypted index or decrypt-then-scan; client-side search is an alternative | Client-side only | Client-side only | As hosted option |
| **Export** | Server builds the ZIP | Server builds it through the key service | Built on the device | Built on the device | As hosted option |
| **Account recovery** | Email code (today), passkey later | Same as A; the user holds no key | Recovery key or second device is mandatory. Lost key means the journal is gone, as Day One and Obsidian both state [S-2][S-5] | Same as C | As hosted option |
| **Multi-device** | Sign in anywhere | Sign in anywhere | New devices need the key transferred or the recovery key entered | Same as C; on-device blooms must sync encrypted | As hosted option |
| **Provenance and validation** (ADR-003) | Unchanged | Unchanged | Excerpt validation moves into the worker's short plaintext window, or onto the device | On-device validation, or inside the enclave | Unchanged |
| **Build effort** | Days | Weeks: key service, encrypt and decrypt on every content path, migration of existing rows, rotation and destruction | Months: client cryptography on web and iOS, key backup and recovery flows, envelope protocol, client-side search and export | On-device: months and a research risk. TEE: weeks on top of C, plus a full evaluation re-run | BYOC: sales-led. Self-host: weeks to stand up, permanent to operate |
| **Running cost** | Lowest | Slightly higher: KMS calls | Similar to B; less server work, more support load from lost keys | On-device: lowest provider bill. TEE: provider-dependent | Higher: Team or Enterprise pricing, or your own infrastructure and time |

### Notes on each option

**A. Today's design, hardened.** Controls that close known gaps without changing the architecture:

- Decide Batch versus synchronous calls against the retention finding, and record the provider's written terms (runbook 1.1).
- Request Zero Data Retention or Modified Abuse Monitoring, or accept and disclose the default window.
- Set an expiry on uploaded provider files as a backstop for the delete step; close the account-deletion orphan gap already listed as runbook 3.9.
- Remove `private.pass_inputs.snapshot` content once a pass reaches a terminal state.
- Run the content-free logging canary (review item F-6) on the hosted worker.
- Require MFA and least-privilege tokens for Supabase, Vercel, the AI provider, and GitHub; keep the service-role key off the laptop.
- Write down the backup window that deletion is subject to.

**B. Per-user envelope encryption.** Each account gets its own data key. Journal bodies, bloom prose, and pass snapshots are encrypted with it in application code. The data key is itself encrypted by a master key in a key management service outside Supabase, which releases it only to an authenticated worker identity and logs every release.

- What it buys: stolen backups, SQL injection, a policy mistake, and database-level insiders yield ciphertext. Account deletion becomes real on the day the key is destroyed, backups included.
- What it does not buy: Slow Garden's own server code can still decrypt, so "we can't read your journal" stays false.
- Design point: ordinary reading in the app also needs decryption. Either a server function decrypts per request for the signed-in user, or the device also holds a copy of the key. The second choice is the first half of option C, so B can be built as a step towards C. The threat model's "Encryption and keys" section already flagged this trade-off.
- Supabase Vault is not the right home for these keys: it is managed by the same platform and aimed at secrets [D-10][A].

**C. Client-held keys with a time-boxed tending envelope.** The device generates the key and encrypts everything before upload. For tending, the device builds the snapshot, encrypts it to the worker's public key, and uploads it with an expiry. The worker decrypts in memory, calls the provider, validates, encrypts the blooms back to the user's key, and deletes the envelope.

- Precedent: this is Day One's pattern, stated in its documentation [S-1].
- It fits Slow Garden's existing rule that a pass processes one frozen snapshot. The change is who freezes it.
- Limits: a browser cannot be relied on to run in the background, and iOS background work is opportunistic [A], so "overnight" means "what you sealed when you last closed the garden."
- Web caveat: any browser-based end-to-end scheme trusts the server that delivers the JavaScript [A]. This must be said in the security notes, and the native app is the stronger client.
- The AI provider still sees plaintext for the retention window. C reduces what is stored, not what is processed.

**D. On-device or attested-hardware inference.**

- On-device: strongest privacy, weakest model. The 4,096-token window [S-29] means a months-long garden needs staged summarising, and nothing shows that passes the evidence-first gates. iPhone only.
- Attested hardware: the envelope from C is encrypted to an enclave whose identity the client verifies, so neither Slow Garden's worker nor the host sees plaintext. This is the only route found to "nobody but you and verified hardware can read it." It depends on young vendors and open-weight models [A], and on the model passing ADR-004.

**E. Dedicated or self-hosted data plane.** Changes who operates the database, not what the database holds. Worth it only for a contractual or regulatory requirement, or to remove a specific named insider. For a solo founder, self-hosting trades a vendor's audited security team for one person's evenings.

---

## 6. Recommendation by stage

### Now: supervised single-user stage

Posture: **Option A, hardened.** The only real journal in the system is the owner's, the owner is also the operator, and the global runtime is off between supervised runs.

Do before the next supervised run with real entries:

1. Close runbook 1.1 with first-party text read directly, covering the endpoints actually used (Responses, Batch, Files).
2. Decide whether Batch is still the right transport. The trade is Batch pricing against eligibility for zero retention.
3. Apply the A hardening list above.

Honest wording this stage supports:

- Can say: "Encrypted in transit and at rest." "Other accounts cannot see your garden." "For the overnight pass, the entries in that pass are sent to [provider], which keeps them for up to [N] days and does not use them to train models." (Fill N and the training clause from the recorded terms.) "Deleted content can persist in backups for up to [N] days."
- Cannot say: "end-to-end encrypted", "zero-knowledge", "we can't read your journal", "your writing never leaves your device", "zero data retention" (unless a signed agreement covers every endpoint in use), "private cloud", "HIPAA compliant", "deleted immediately".

### Private pilot

Posture: **Option B**, built so the device can later hold the key (the path to C).

Trigger to enter: the first real entry by anyone who is not the owner. Before that entry:

- Per-user envelope encryption live for bodies, bloom prose, and pass snapshots, with a key-destruction test in the deletion drill.
- Provider retention settled in writing, or the default window disclosed on the consent screen that names the provider.
- Data processing agreements signed with each processor; a published list of them.
- Passkey or MFA and a tested recovery process (already required by the threat model before external beta).
- T-01 to T-13 receipts complete on the hosted project (existing alpha privacy gate).

Honest wording this stage supports:

- Can add: "Each account's journal is encrypted with its own key, stored separately from the database." "When you delete your account we destroy that key, which makes backup copies unreadable." "Staff do not read journals. Access is technically possible for the operator in an emergency, is logged, and you will be told."
- Still cannot say: "end-to-end encrypted", "we can't read your journal", "zero-knowledge".

### Public launch

Posture: **Option C as the target**, with attested inference (D) adopted if and when a model passes the ADR-004 gates. If C is not ready at launch, launch on B and say so; do not borrow C's wording early.

Triggers to enter: open sign-up, payment, any public privacy claim, or any pilot incident involving content exposure. A trigger to revisit sooner: a provider changes retention terms for the pinned model.

Honest wording this stage supports:

- Can say with C: "Your stored journal is end-to-end encrypted. We cannot read it." This sentence must travel with: "For tending, your device sends the entries in that pass to our AI service, where they are readable during processing and for up to [N] at [provider]." And: "If you lose your recovery key, we cannot recover your journal."
- Can say with C plus attested inference, only if the client verifies attestation and the verification code is open to inspection: "Tending runs inside verified hardware that neither we nor the hosting company can read."
- Cannot say even then: "nobody can ever read your journal", "the AI never sees your writing", "mathematically impossible to access".

### Decisions this document asks the owner to make

1. Batch or synchronous transport, given the retention finding.
2. Whether zero retention is a requirement or a preference for the pilot.
3. Whether loss of the journal on a lost key is acceptable for launch users (the price of C).
4. Whether the web app or the native app is the primary client for a sealed journal.

Each is a durable choice and belongs in `documents/DECISION_LOG.md` or an ADR once made.

---

## 7. Open questions

For a lawyer:

1. Does journal text that includes health, sexuality, or belief content trigger special-category or consumer-health-data duties in the launch jurisdictions, and does any of it make Slow Garden a HIPAA-regulated party?
2. What must the privacy notice and consent screen say about the AI provider, its retention window, and backup residency?
3. What are the breach-notification duties for a solo-operated product, and do they differ if stolen data was encrypted with keys held elsewhere?
4. How should a subpoena or court order for a user's journal be handled under A, B, and C, and can a provider legal hold override a zero-retention agreement?
5. Is the wording in section 6 defensible as advertising in the launch jurisdictions?

For Supabase sales or support:

6. Is bring-your-own-cloud still offered, on what plan and minimum spend, and what access does Supabase keep in that mode?
7. Are customer-managed keys available, and can staff access be disabled or made approval-gated?
8. What is the maximum time a deleted row survives in daily backups and point-in-time recovery, and are Edge Function invocation logs ever content-bearing?
9. What is the HIPAA add-on price and does it change anything technical beyond the listed checks?

For the AI provider's sales team:

10. Will a small single-developer organisation be approved for Zero Data Retention or Modified Abuse Monitoring, and what is the minimum commitment?
11. Exactly which endpoints and models are covered, and what is retained for Batch and Files under such an agreement?
12. Is the batch discount available on any transport that is also eligible for zero retention?

For attested-inference vendors:

13. Which models are offered, what does attestation cover at runtime, who has audited it, and what are the retention and logging terms outside the enclave?

---

## Sources

All accessed 2026-11-16. Grades as defined at the top.

| # | Source | Grade |
|---|---|---|
| 1 | Day One, AI features guides: https://dayoneapp.com/guides/labs/ai-features/ and https://dayoneapp.com/guides/ai-features/daily-chat/ | S |
| 2 | Day One, End-to-End Encryption FAQ and lost-key guide: https://dayoneapp.com/guides/security/end-to-end-encryption/ , https://dayoneapp.com/guides/troubleshooting/finding-a-lost-encryption-key/ , https://dayoneapp.com/privacy-faqs/ | S |
| 3 | Apple, Journaling Suggestions & Privacy: https://www.apple.com/legal/privacy/data/en/journaling-suggestions ; Apple Newsroom, Journal launch: https://www.apple.com/newsroom/2023/12/apple-launches-journal-app-a-new-app-for-reflecting-on-everyday-moments/ | S |
| 4 | Notion, AI security and privacy practices: https://www.notion.com/help/notion-ai-security-practices ; Notion trust center: https://trust.notion.com/ | S |
| 5 | Obsidian, Sync security: https://obsidian.md/help/sync/security | S |
| 6 | Reflect, Security and encryption: https://team-reflect.notion.site/Security-and-encryption-89450e351e724893b72898d9acc663fe | S (excerpt only) |
| 7 | Product Hunt, Reflect AI Search: https://www.producthunt.com/p/reflect-notes/reflect-ai-search ; competitor comparison: https://nemos-landing.pages.dev/compare/nemos-vs-reflect | 3P |
| 8 | Mem, security page: https://get.mem.ai/security ; help article on training: https://support.mem.ai/article/146-is-my-data-used-to-train-ai-models | S |
| 9 | Rosebud, privacy policy (updated 2026-09-08): https://help.rosebud.app/about-us/privacy-policy ; competitor claim: https://blog.mylifenote.ai/rosebud-review/ | S / 3P |
| 10 | Stoic help center, privacy and security: https://help.getstoic.com/privacy--security/i65nxnVdxPXQfGZJXynaYu/where-your-data-is-kept/6f9eBdDY7m3fVtcX2B5Mv5 | S |
| 11 | Supabase, Data Residency and Transfers FAQ: https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq | S |
| 12 | Supabase, Security: https://supabase.com/security ; SOC 2 announcement: https://supabase.com/blog/supabase-soc2 | S |
| 13 | Supabase, BYOC early access: https://supabase.com/go/byoc-early-access | S |
| 14 | PricingSaaS tracker, "Enterprise plan drops BYO Cloud support": https://pricingsaas.com/companies/supabase/diffs/2026W36 | 3P |
| 15 | Supabase pricing: https://supabase.com/pricing ; third-party HIPAA add-on figure: https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/ | S / 3P |
| 16 | OpenAI, Your data: https://developers.openai.com/api/docs/guides/your-data | S |
| 17 | OpenAI Help Center, Batch API FAQ: https://help.openai.com/en/articles/9197833-batch-api-faq ; Batch guide: https://developers.openai.com/api/docs/guides/batch | S |
| 18 | OpenAI, Private Safety Processing guide: https://developers.openai.com/api/docs/guides/private-safety-processing ; coverage: https://axios.com/2026/08/19/openai-previews-zero-retention-safety-system-as-anthropic-requires-data-logs , https://www.helpnetsecurity.com/2026/08/20/openai-private-safety-processing-zdr/ | 3P (guide not read) |
| 19 | Anthropic privacy center, organisation data retention: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data | S |
| 20 | Anthropic, API and data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention ; ZDR scope article: https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to | S |
| 21 | Standard Notes and encrypted-notes comparison: https://calmara.app/blog/why-ai-note-apps-arent-end-to-end-encrypted ; Proton acquisition: https://techradar.com/pro/security/proton-has-acquired-encrypted-note-taking-app-standard-notes | 3P |
| 22 | Proton, Docs in Proton Drive: https://proton.me/blog/docs-proton-drive (search summary of translated copies) ; Lumo coverage: https://www.pcworld.com/article/2857918/protons-new-encrypted-ai-chatbot-lumo-puts-your-privacy-first.html | 3P |
| 23 | App listings for small on-device journals, for example: https://apps.apple.com/us/app/id6759070325 | 3P |
| 24 | AWS, Bedrock data protection: https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html ; data retention: https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.md ; batch inference data: https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-data.md ; zero-retention blog: https://aws.amazon.com/blogs/security/enforce-zero-data-retention-on-amazon-bedrock-with-bedrock-projects-and-service-control-policies/ | S |
| 25 | Microsoft, Data, privacy, and security for Azure OpenAI: https://learn.microsoft.com/legal/cognitive-services/openai/data-privacy ; Microsoft Q&A thread: https://learn.microsoft.com/en-us/answers/questions/5780766/question-regarding-azure-direct-models-abuse-monit | S / 3P |
| 26 | Google Cloud, Vertex AI and zero data retention: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance ; Gemini API ZDR: https://ai.google.dev/gemini-api/docs/zdr.md.txt | S |
| 27 | Tinfoil, technology: https://tinfoil.sh/technology ; model identity post: https://tinfoil.sh/blog/2026-02-03-proving-model-identity | S |
| 28 | Phala, confidential AI inference: https://docs.phala.network/confidential-ai-inference/getting-started ; OpenPcc paper: https://arxiv.org/html/2606.11145v1 | 3P |
| 29 | Apple, Managing the on-device foundation model's context window (TN3193): https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window ; forum post on a 32K server model: https://developer.apple.com/forums/thread/833642 | S / 3P |

Supabase documentation read in full through the documentation search tool:

| # | Page | Grade |
|---|---|---|
| D-6 | HIPAA Projects: https://supabase.com/docs/guides/platform/hipaa-projects ; Shared Responsibility Model: https://supabase.com/docs/guides/deployment/shared-responsibility-model ; HIPAA Compliance and Supabase: https://supabase.com/docs/guides/security/hipaa-compliance | D |
| D-7 | Secure configuration of Supabase platform: https://supabase.com/docs/guides/security/platform-security ; Features and feature status: https://supabase.com/docs/guides/getting-started/features | D |
| D-8 | PrivateLink: https://supabase.com/docs/guides/platform/privatelink | D |
| D-9 | Database Backups: https://supabase.com/docs/guides/platform/backups ; Manage Point-in-Time Recovery usage: https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery | D |
| D-10 | Vault: https://supabase.com/docs/guides/database/vault ; pgsodium (pending deprecation): https://supabase.com/docs/guides/database/extensions/pgsodium | D |
