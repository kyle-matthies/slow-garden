# Privacy, security, and threat model

Status: Accepted alpha controls; live verification pending
Date: 2026-08-25
Data classification: Private, with source content and derived interpretation treated as highest-sensitivity application data

## Assets

- Source note bodies, revisions, attachments, and spatial context.
- Derived blooms, corrections, and inferred relationships.
- Identity, sessions, recovery channels, and device identifiers.
- Model prompts, provider files, workflow versions, and usage receipts.
- Exports, backups, logs, evaluation corpora, and deletion receipts.
- Service credentials and provider API keys.

Research URLs may be public, but their association with a private garden is private. Telemetry is metadata-only and still private.

## Actors and boundaries

- Kyle as the sole authorized alpha owner.
- Browser/device and any person or software with local access.
- Static web host, Supabase, and model provider as processors.
- Slow Garden Edge Functions as privileged server code.
- Future integrations as untrusted until separately approved.

## Threat register

| ID | Threat | Impact | Required control | Verification |
|---|---|---|---|---|
| T-01 | Broken object authorization exposes another owner or garden | Catastrophic private-data breach | owner ID on every exposed relation; RLS; user JWT, not service key, for normal APIs | pgTAP negative tests across two synthetic users for every table/RPC/storage policy |
| T-02 | Service credential reaches browser or logs | Full backend compromise | publishable key only in client; secrets in function environment; secret scanning | built bundle scan and CI secret scanner |
| T-03 | Note text appears in analytics, errors, traces, or queue | Silent secondary disclosure | IDs-only queue/events; structured error classes; logger rejects content fields | negative-control canary strings absent from captured logs |
| T-04 | Prompt injection inside a note changes workflow or invokes tools | False output or external action | notes delimited as untrusted data; no tools in Tend/Connect; strict schema and evidence validation | adversarial corpus; zero tool calls; unsupported instructions ignored |
| T-05 | Cross-garden content leaks into one request or bloom | Severe trust breach | snapshot transaction scoped by owner/garden; opaque per-request handles; claim handles must resolve within snapshot | mixed-owner and mixed-garden integration tests |
| T-06 | Model invents evidence or personal diagnosis | Interpretive harm | exact revision handles, excerpt verification, non-clinical policy, reject unsupported claims | corpus faithfulness and prohibited-claim gate |
| T-07 | Duplicate delivery creates duplicate pass, bloom, or promotion | Confusion or external double write | database unique keys and idempotent transactions | ledger spike and concurrency integration tests |
| T-08 | Stale output presented as current | Misleading interpretation | snapshot lineage and reveal-time head comparison | edit-during-pass test marks stale and blocks promotion |
| T-09 | Offline plaintext persists after sync or sign-out | Device disclosure | WebCrypto-encrypted outbox, erase after acknowledged sync, erase key on sign-out | Safari/Chrome storage inspection and lost-device drill |
| T-10 | Session remains usable after account/session revocation | Unauthorized access | short access-token lifetime, revoke sessions before user deletion, validate active session for export/delete/promotion | revoked-session test against sensitive endpoints |
| T-11 | Storage object bypasses row authorization | Attachment disclosure | private bucket, owner-prefixed paths, signed short-lived URLs, storage RLS, no public CDN | cross-user object tests and expired-link test |
| T-12 | Database backup restores but attachments are lost | Incomplete recovery | independent object manifest and encrypted attachment backup; restore drill | sampled checksum restore and full quarterly drill |
| T-13 | Deletion misses revisions, provider files, indexes, or backups | Broken privacy promise | deletion graph, provider cleanup receipt, backup expiry schedule, tombstone audit | seeded deletion canaries absent from all queryable stores |
| T-14 | Export is intercepted or incompletely represents lineage | Disclosure or lock-in | authenticated recent session, encrypted ZIP option, checksums, schema manifest | round-trip import verifier and wrong-password test |
| T-15 | Dependency or Edge Function compromise | Content/key theft | pinned dependencies/lockfile, minimal functions, scanning, rotation runbook | CI audit and credential rotation drill |
| T-16 | Operator/admin browses private content | Insider exposure | least-privilege project roles, no content in dashboards, audited break-glass procedure | role review and quarterly access receipt |
| T-17 | Notification leaks private meaning | Shoulder-surfing disclosure | content-free notification previews by default | device notification snapshot test |
| T-18 | Cost attack or runaway schedule repeatedly sends content | Financial and privacy exposure | per-owner concurrency, monthly caps, cadence dedupe, kill switch | budget spike and forced duplicate-trigger test |

## Supabase-specific controls

- RLS is enabled on every table in exposed schemas. Policies combine `TO authenticated` with an owner predicate; authentication alone is not authorization.
- Authorization never trusts user-editable user metadata. The canonical owner UUID is stored in protected application data; any role claim uses server-controlled app metadata and is not the sole ownership check.
- Views use `security_invoker = true` or live in an unexposed schema with revoked access.
- User-facing mutations avoid `SECURITY DEFINER`. Any exceptional privileged function lives in a private schema, checks the actor explicitly, sets a safe search path, and revokes default public execution.
- UPDATE policies include both `USING` and `WITH CHECK`, plus required SELECT policy.
- Queue schemas are server-only; the browser never receives queue read/send permissions.
- The service-role key is restricted to Edge Functions and never used for ordinary user reads/writes.
- Storage upsert policies include required insert/select/update permissions, but immutable attachment keys are preferred over upsert.
- Run database advisors, RLS tests, and dependency checks before each production migration.

## Authentication and recovery

- Alpha registration is closed. Only the predeclared Kyle owner identity can complete first sign-in.
- Use a Supabase [email one-time code](https://supabase.com/docs/guides/auth/auth-email-passwordless) rather than a GET-consumed magic link. Configure a ten-minute expiry, `shouldCreateUser: false`, and rate limits; verify single-use behavior in A1.
- Sensitive operations—full export, account deletion, key rotation, and future promotion—require a recent authenticated session.
- Sign-out clears the local encryption key and offline cache. Account deletion first revokes sessions, then starts the deletion workflow.
- Recovery depends on the secured email account during alpha. Before external beta, add passkey/MFA and a tested recovery-code process.

## Encryption and keys

- TLS for all network transport; HSTS on the web origin.
- Provider-managed encryption at rest for database and Storage in alpha.
- Device offline outbox encrypted with a non-exportable WebCrypto key. It is a convenience queue, not a permanent local archive.
- Provider API keys and server secrets live only in managed function secrets. Rotate after any suspected exposure.
- Application-layer envelope encryption is deferred because it would either move decryption keys into the browser or require all content through a decryption service. Reconsider before multi-user beta or if the managed-operator threat becomes unacceptable.

## Retention and deletion baseline

| Data | Active retention | After user deletion request |
|---|---|---|
| Source, revisions, layout, blooms, corrections | Until explicit deletion | Tombstone immediately; hard-delete after 30-day recovery window |
| Trash | 30 days | Included in deletion workflow |
| Provider input/output files | Only until validated ingestion | Request deletion immediately after receipt; verify provider behavior during spike |
| Quarantined invalid output | 7 days maximum | Delete immediately |
| Metadata audit events | 90 days for alpha | Remove owner link after deletion except minimal deletion receipt |
| Application logs | 7 days, content-free | Natural expiry |
| Database backups | Provider plan window | Expire on provider schedule; document maximum residual window |
| Attachment backups | Defined by selected backup mechanism | Cryptographic erasure or physical deletion within disclosed window |

No content is used for model training, public examples, or product analytics without an explicit, named opt-in. Current provider data-use and retention terms must be reviewed and recorded before sending real journal material.

## Incident priorities

1. Disable processing and external provider dispatch through a server-side kill switch.
2. Revoke exposed credentials and active sessions.
3. Preserve content-free operational evidence without copying private content.
4. Determine affected gardens, revisions, providers, and time range from IDs and receipts.
5. Notify Kyle plainly with known impact, uncertainty, containment, and required action.
6. Restore only after negative authorization and canary-log tests pass.

## Alpha privacy gate

Real private notes cannot enter the system until T-01 through T-13 have automated or witnessed verification receipts, provider terms are accepted, export/deletion complete on synthetic canaries, and a backup/restore drill covers both database and Storage.
