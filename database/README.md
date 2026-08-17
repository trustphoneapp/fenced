# Canonical database schema

`migrations/0001_tenant_event_ledger.sql` is the accepted first forward-only
Continuity schema migration. Its exact SHA-256 remains
`9179c8575d6b9cb2a6ef82db2e73409a96b0de5b8bcf3d213ec12768e7d325f2`.
`migrations/0002_purpose_qualified_tenant_keys.sql` additively replaces only the
payload and event key constraints so server purpose is part of every identity
and optional payload relationship. `migrations/0003_role_session_isolation.sql`
statically defines two inert non-login roles, removes PUBLIC access, grants the
reader only schema usage and SELECT on the current three tables, and enables
and forces exact tenant and server-purpose row policies. The executor receives
no membership or privileges. `migrations/0004_erasable_payload_storage.sql`
adds the four C05.1 payload key-anchor and separately erasable material tables,
revokes PUBLIC access, and enables forced RLS without granting a runtime role.
`migrations/0005_immutable_event_links.sql` adds the internal-only append-only
`event_revision_requests` table for inert correction and retraction requests;
it leaves the public v1 `events` enum unchanged. The eight physical tables include content-free payload anchors and content-free
key anchors. B02 pre-write validation preserves the exact
UTC-millisecond lexical form before the database stores a calendar-valid
`TIMESTAMPTZ`. Runtime encryption, decryption, rotation, erasure, outbox state,
receipts, and task state belong to later bounded tasks. A malicious local writer that acts after
verification is outside this static proof.

## Logical CockroachDB design catalog

Only `continuity.tenants`, `continuity.payload_anchors`, `continuity.events`,
`continuity.payload_key_anchors`, `continuity.payload_revision_material`,
`continuity.payload_wrapped_keys`, and
`continuity.payload_superseded_wrapped_keys`, and `continuity.event_revision_requests` exist today. The remaining canonical names are
non-executable logical designs: a future owner must supply a reviewed additive
migration and consumer tests before creating them.

| Category and canonical logical name | Minimum key, reference, and record semantics | Future owner |
| --- | --- | --- |
| Tenants — `continuity.tenants` | PK `(tenant_id)` remains unchanged; tenant root for every tenant-qualified FK | C04 |
| Payloads — `continuity.payload_anchors`, `continuity.payload_revision_material`, `continuity.payload_key_anchors`, `continuity.payload_wrapped_keys`, `continuity.payload_superseded_wrapped_keys` | Existing payload-anchor PK is `(tenant_id, server_purpose, payload_ref, payload_revision)` with candidate key `(tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)`. Revision-material and current/superseded wrapped-key rows are erasable children: ciphertext, nonce, authentication tag, wrapped DEK and internal body locator may exist only there. A separate stable content-free key anchor survives purge with no sensitive bytes, locator, wrapped material, digest, fingerprint or equality token. Under HG2-RP01, every material/key row binds `sensitivity_class`, `crypto_domain_version`, `created_at`, mandatory `expires_at`, and the exact A07 AAD/KMS context, with `created_at < expires_at <= created_at + INTERVAL '24 hours'`; absent, unparsable, unknown, expired-on-arrival, or excessive retention denies persistence. Every current or superseded revision-material or wrapped-key child binds one immutable payload-revision `retention_origin_created_at` and fixed `retention_expires_at`; each child `expires_at` equals or precedes that fixed expiry. Rewrap, rotation, and supersession cannot reset the origin or reset, replace, or extend the fixed expiry. Under RP01, fixed `retention_expires_at <= retention_origin_created_at + INTERVAL '24 hours'`; any absent, inconsistent, unknown, or later value fails closed and denies persistence. Any future nullable or different-profile retention rule requires a separately reviewed exact profile/applicability/version rule and is never the RP01 or default rule. Wrapped-key children also bind one exact payload revision and per-revision key scope, KEK reference/version, wrapped-key CAS version, envelope/algorithm/nonce/format versions, lifecycle state, and exact derivative-inventory and deletion-obligation revisions | C05, C10, R02 |
| Events — `continuity.events`, `continuity.event_revision_requests` | `events` remains public-v1 metadata with its original enum. Internal request rows are append-only inert LT-16 correction or retraction requests keyed by tenant, server purpose, request ID and positive revision; each binds one exact target event candidate key and optional purpose-qualified payload anchor | C06 |
| Durable messaging — `continuity.outbox_messages`, `continuity.outbox_deliveries`, `continuity.inbox_receipts` | PKs bind tenant, purpose, message revision and consumer; a single-successor key prevents revision branches. Claims have expiry leases, receipts are recorded before acknowledgement, and executor writes use constrained security-definer routines rather than direct delivery updates. Queue bodies remain ID-only references. | C07 |
| Tasks — `continuity.task_revisions`, `continuity.task_attempts` | PKs `(tenant_id, task_id, task_revision)` and `(tenant_id, task_id, task_revision, attempt_id, attempt_revision)`; exact task FK with state, lease, fencing, deadline, cancellation, idempotency, and optional erasable body reference | C09 |
| Beliefs — `continuity.belief_revisions`, `continuity.belief_heads` | Revision PK `(tenant_id, belief_id, belief_revision)` with exact source-event and derivation revisions, authority, confidence, valid/system time, retraction and lifecycle fences; head points to one exact revision | D01-D04 |
| Graphs — `continuity.graph_node_revisions`, `continuity.graph_edge_revisions` | Tenant-qualified node/edge revision PKs; edge endpoints and all provenance bind exact node/source revisions, with graph kind, valid/system time, confidence, retraction and lifecycle fences | D01-D04 |
| Embeddings — `continuity.embedding_spaces`, `continuity.embedding_revisions` | Space PK `(tenant_id, embedding_space_id, embedding_space_revision)`; embedding PK `(tenant_id, embedding_id, embedding_revision)` with exact space and source-revision FKs; vector material is an erasable body reference, never inline authority | D05-D07 |
| Operations and stage decisions — `continuity.operation_revisions`, `continuity.capsule_revisions`, `continuity.policy_decision_revisions`, `continuity.policy_decision_heads` | Purpose-qualified operation/capsule keys bind tenant, requested/server purpose, principal or system workload, operation and attempt, policy/configuration, lane/stage, destination/resource, exact input snapshot, deletion/revision epochs and lifecycle fences. Each decision additionally binds disposition, closed content-free reason code/class or erasable reason-body reference, absolute expiry, exact receipt IDs, and exact evidence revisions. A decision is historical evidence for only that bound stage and attempt, never reusable authorization; its head is a projection | E01, E02, E07, E10 |
| Policies — `continuity.policy_revisions`, `continuity.policy_heads` | Revision PK `(tenant_id, policy_id, policy_revision)` with stage, server-purpose scope, configuration version, provenance and lifecycle fences; head is a projection over one exact reviewed revision | E01, E02, E07 |
| Receipts — `continuity.receipts`, `continuity.receipt_signature_envelopes`, `continuity.receipt_verification_revisions`, `continuity.receipt_verification_heads` | Immutable receipt PK `(tenant_id, server_purpose, receipt_id)` has no receipt revision; later facts use a new successor receipt ID. Unique `(tenant_id, server_purpose, chain_id, sequence)` binds predecessor receipt ID/signature commitment, canonical content-free signed bytes and A10 commitments. Issuer, verifier-policy revision, signing-key owner, and issuance key-lifecycle snapshot/view are canonical signed receipt fields. The detached one-to-one envelope exact-FKs that receipt and contains only A10-BIND43–48: envelope version, byte-equal receipt ID, byte-equal signature suite, byte-equal signing-key ID/version, canonical-byte length, and fixed-size suite signature bytes. Separately revisioned verification facts bind the exact receipt/envelope, verification time, independently supplied current-view ID/revision, verification-policy revision, key owner, exact signing-key ID/version, lifecycle policy/version and lifecycle state, rotation and revocation generations, compromise-effective time, and trust-anchor and revocation views with their freshness. Each revision records separate `authentic_at_issuance` and current `active|verification_only|revoked|destroyed|unknown` conclusions. The verification head remains a non-authoritative current view | E08 |
| Production tool registry — `continuity.tool_registry_revisions`, `continuity.tool_registry_heads` | Purpose-qualified revision key with exact provenance/configuration revisions and optional erasable declarative body reference; entries are inert data and grant no code, tool, model, credential or execution authority | F05 |
| Experimental registries — logical-only `continuity_experimental.lesson_registry_revisions`, `continuity_experimental.causal_rule_registry_revisions`, `continuity_experimental.skill_registry_revisions`, `continuity_experimental.world_model_registry_revisions` | Lesson, causal-rule, skill and world-model registries exist only in the experimental logical plane and grant no production authority. Any production artifact requires a separately reviewed, production-owned quarantine/pull/promotion path; the path permits no experimental return write into production | X04-X06 |
| Experiments — logical-only `continuity_experimental.experiment_revisions`, `continuity_experimental.experiment_artifact_revisions` | Purpose-qualified experiment/artifact revision keys bind exact input, policy, model, world-state, source and lifecycle fences. The namespace name is logical only and proves no isolation. X01 must separately establish distinct identity, network, store, queue, keys, providers, logs, budgets and credentials plus a verified zero production-write route before any physical use | F03, X01-X10 |
| Corrections — `continuity.correction_revisions`, `continuity.retraction_revisions` | Purpose-qualified revision keys; each typed target must use a future concrete purpose-qualified restrictive FK to one exact target revision, never an unchecked polymorphic head. Records retain closed content-free reason code/class or erasable reason-body reference, source event, supersession and lifecycle fences; no free-form durable reason metadata | R01 |
| Deletion — `continuity.deletion_requests`, `continuity.deletion_tombstones`, `continuity.hold_revisions`, `continuity.restore_fences`, `continuity.deletion_derivative_inventory`, `continuity.deletion_obligations`, `continuity.deletion_work_accounting` | Purpose-qualified versioned request/tombstone/hold/fence/inventory/obligation/accounting keys bind exact typed targets, derivative IDs/revisions, disposition, restore generation, evidence, key-destruction state, obligation version and work-accounting version. One transaction must bind request, tombstone, monotonically raised deletion/revision epoch, synchronous denial/fence, complete derivative inventory, and complete ID-only purge/cancel/backup/reconciliation obligations all-or-none. Missing, incomplete, conflicting or ambiguous input commits no partial deletion-authority state; sensitive request bodies remain erasable | R02, R03, C10 |

All future applicable canonical identity, revision, work, receipt, fence and
verification PKs/unique keys/FKs are structurally keyed first by
`(tenant_id, server_purpose, ...)`; externally requested purpose is retained as
a bound fact but never substitutes for server-resolved purpose. Every lookup is
scope-first by tenant and server purpose, and every applicable target is
purpose-qualified before exact-revision resolution. Opaque identity/reference
columns use lowercase 48-hex values, and revisions use positive uint64-range
`DECIMAL(20, 0)`. FKs are exact-revision and restrictive (`ON DELETE RESTRICT
ON UPDATE RESTRICT`), never cascade or set-null. Sensitive or derived body bytes
live only behind erasable payload references. Metadata contains no plaintext,
reversible representation, or unauthorized sensitive/body-derived digest,
fingerprint, commitment, or equality oracle. This restriction does not exclude
the A10-governed content-free commitments required for receipt chaining,
canonical signing, and verification.
Sources, supersession, retraction, deletion epochs, and lifecycle fences bind
exact revisions rather than mutable heads. Every `*_heads` relation is a
rebuildable lookup projection and is never authority, evidence, or a substitute
for the referenced revision.

The B02 schema registry remains a schema-catalog manifest only: it owns no DDL,
runtime enforcement, executable registry entry, receipt authority, or table
creation. No logical design above may become physical before its future owner
provides a separately reviewed additive migration plus consumer and negative
tests.

This catalog does not prove CockroachDB syntax or compatibility and performs no
database execution. The 0003 role and RLS statements are unexecuted static
contracts: they prove no connection/bootstrap path, session-variable setter,
transaction-pool behavior, role ownership, migration principal, deployment
compatibility, or runtime isolation. C04 remains incomplete. C04-C10,
D01-D07, E01/E02/E07/E08, F03/F05, X01-X10, and R01-R03 retain all tenant
isolation, encryption, append enforcement, queue,
task, cognition, vector, policy, receipt, registry, experiment, correction,
deletion, backup, restore, key-destruction, runtime, and operational work.

The migrations are intentionally static-checked by
`scripts/verify-c03-schema.mjs` and
`scripts/verify-c04-purpose-keys.mjs`, with the role/session migration separately
checked by `scripts/verify-c04-role-session.mjs`; these checks do not connect to a
CockroachDB instance and make no CockroachDB compatibility claim.
