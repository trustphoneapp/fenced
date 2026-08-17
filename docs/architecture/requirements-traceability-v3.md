# Architecture v3 Requirements Traceability

**Status:** draft traceability baseline; not an architecture freeze, implementation claim, or human-gate approval.
**Task:** A00 — Requirements traceability.
**Scope:** the independent public `zintus-continuity` repository only.

## 1. Product boundary and normative language

Continuity is a public, independent platform for **enterprise software delivery and AI operations**. It may help an authorized organization preserve evidence, reason over project state, plan bounded work, and execute approved actions with receipts. It does **not** claim healthcare, finance, safety-regulated, regulatory-certification, or generic-AGI status. Those uses require separately designed controls, evidence, contracts, and human approval.

The private Zintus project is not a source dependency, design input, test fixture, or artifact source. It remains strictly read-only. If Zintus uses Continuity later, it does so only as an external client through a documented public API/SDK and separately authorized credentials. This document therefore names no private package, file, schema, data set, credential, or internal contract.

In this document, **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative requirements. A requirement is not satisfied merely because a design document, mock, local test, deployment shell, or demo exists. Status and evidence remain governed by [the implementation status](../implementation/status.md), [task manifest](../implementation/task-manifest.yaml), and [evidence ledger](../implementation/evidence-ledger.md).

## 2. Permanent-boundary map

| Boundary | Normative requirement | Source/provenance | Planned enforcing tasks | Acceptance evidence / human gate |
| --- | --- | --- | --- | --- |
| Independent repository | The private Zintus repository MUST stay read-only; Continuity MUST NOT import private code, history, data, credentials, artifacts, or undocumented contracts. | [goal: permanent boundaries](../implementation/goal.md), [AGENTS](../../AGENTS.md), [SECURITY](../../SECURITY.md) | A01, A06, B05, V01, V07, V08 | clean-room scan and anonymous clone; HG-0; V08 requires separate future authorization |
| Public-client-only later integration | Any later Zintus integration MUST use only public Continuity interfaces and separate authorization. | [goal: permanent boundaries](../implementation/goal.md), [SECURITY](../../SECURITY.md) | A06, B02, V07, V08 | public contract/SDK evidence; HG-0/HG-3; no implied private integration |
| Canonical versus derived state | CockroachDB MUST be canonical for events, beliefs, tasks, receipts, outbox/inbox, registries, and deletion state; vectors, caches, contexts, simulations, and model output are derived and revocable. | [goal: permanent boundaries](../implementation/goal.md), [AGENTS](../../AGENTS.md) | C03, C06, C07, C09, D07, D10, F03, R02 | schema, recovery, and deletion tests; HG-2/HG-5 |
| Erasable sensitive content | Content-bearing payloads MUST be erasable separately from immutable metadata; immutable metadata MUST be content-free. | [goal: permanent boundaries](../implementation/goal.md), [AGENTS](../../AGENTS.md), [SECURITY](../../SECURITY.md) | A03, A07, C05, C06, R02, R03 | synthetic plaintext-leak, crypto-erasure, derivative purge, restore tests; HG-2 |
| Separate non-bypassable control planes | Authentication, tenant authorization, pre-search policy, pre-transmission policy, tool authorization, and human approval MUST be distinct controls. | [goal: permanent boundaries](../implementation/goal.md), [AGENTS](../../AGENTS.md), [SECURITY](../../SECURITY.md) | A04, A08, A09, C02, E01, E02, E07, E09, F06, S01 | false-allow and bypass-negative tests; HG-2/HG-3 |
| Untrusted inputs | Retrieved memory, provider output, MCP output, and experimental artifacts MUST remain untrusted data and MUST NOT gain system authority. | [goal: permanent boundaries](../implementation/goal.md), [AGENTS](../../AGENTS.md), [SECURITY](../../SECURITY.md) | D03, D04, D10, D11, E10, X03-X08, R04, S01 | injection/poisoning/authority-escalation tests; HG-3/HG-4 |
| Experimental isolation | Experimental identities MUST have no production write path. | [goal: permanent boundaries](../implementation/goal.md) | A05, X01-X10, S04-S07 | cross-plane deny tests and promotion evidence; HG-4/HG-5 |
| Durable external effects | Every durable external effect MUST have idempotency, reconciliation, and a versioned receipt. | [goal: permanent boundaries](../implementation/goal.md), [AGENTS](../../AGENTS.md), [SECURITY](../../SECURITY.md) | C07, C09, E08, F05-F09, R07, S01 | replay/failure/reconciliation tests; HG-3/HG-5 |
| Versioned vectors | Embeddings MUST belong to an explicit, versioned embedding space and only same-space, tenant-authorized comparisons are permitted. | [AGENTS](../../AGENTS.md) | A10, D05-D08, R01-R03 | cross-space and cross-tenant negative tests; HG-2/HG-3 |
| Hackathon MCP restriction | Managed MCP MUST be read-only for the hackathon and only serve curated authorized queries. | [AGENTS](../../AGENTS.md), [SECURITY](../../SECURITY.md) | A11, R04, S01, V04 | write-attempt denial and redacted audit evidence; HG-3 |
| Queue privacy | Queue messages MUST contain identifiers and bounded metadata, never sensitive memory bodies. | [AGENTS](../../AGENTS.md) | A03, C07, C08, S01 | queue fixture inspection and DLQ negative test; HG-2/HG-5 |
| Logging and release safety | Ordinary logs MUST exclude secrets, prompts, memory values, and tool payloads; release is blocked by the security-policy failures named in `SECURITY.md`. | [SECURITY](../../SECURITY.md) | A12, B03, C05, S01, S03, S04, S08, S09 | log allowlist, secret scan, red-team and release checklist; HG-2 through HG-6 |

### 2.1 Cryptographic deletion and epoch-fencing contract

`A03`, `A07`, `A09`, and `A12` MUST jointly define and test the following contract. Each erasable payload uses envelope encryption with a payload DEK and approved KMS/KEK wrapping. The unresolved HG-2/HG-5 decision specifies DEK granularity (per payload, class, tenant, or another explicit bounded unit); no implementation may silently choose a weaker granularity. AEAD additional authenticated data MUST bind the tenant ID, opaque payload ID, payload version, and sensitivity/classification so ciphertext cannot be replayed across tenant, payload, version, or class.

KMS/KEK unavailability during encryption, unwrap, decrypt, rotation, or rewrap MUST fail closed: no plaintext is emitted, no unsafe fallback key is used, and no affected external egress proceeds. Rotation MUST support auditable KEK rewrap and DEK/key destruction evidence without claiming a provider has deleted data it cannot prove. Backup ciphertext, wrapped-key custody, retention, legal hold, and restoration behavior are explicit human inputs; a legal hold may change deletion disposition only through policy and must be receipted. The receipt records provider retention/deletion capability, requested deletion, and any unknown or limited assurance as facts, never as an unsupported external-deletion success claim.

A monotonic deletion/revision epoch and fence token MUST be rechecked immediately before: decrypt; retrieval/vector return; context compilation; every external egress; tool reservation and execution; experimental export; and promotion/import. Active lease, stale worker, stale retry, cache race, or epoch mismatch MUST deny the operation and require reconciliation. Restore MUST replay tombstones before content becomes retrievable. Required synthetic evidence includes AEAD cross-tenant/version/class substitution denial; KMS outage; rotation/rewrap; destruction/custody audit; stale-lease/retry/cache race; pre-egress deletion race; vector/context purge; restore tombstone replay; and provider-retention limitation receipt tests.

## 3. Requirement matrix

The matrix records a **proposed delivery classification** for architecture review. P0/P1/P2 values are not manifest truth, a manifest amendment, or task-readiness authorization until Sol and the human owner review them and a separate manifest update is accepted. `P2/future` means governed future work, not approved implementation. The “Relevant downstream decision gate(s)” column identifies decisions that eventually affect the requirement; it does not control readiness. Only the current manifest dependencies and gates control task readiness. Any proposed gate or dependency change belongs in the contradiction register until separately reviewed. Architecture destinations are logical subjects to consolidate, not a promised file/ADR per row.

| Requirement ID | Normative requirement | Source / provenance | Proposed delivery classification | Applicable lane | Manifest task IDs | Architecture / ADR destination | Security invariant | Acceptance evidence | Relevant downstream decision gate(s) | Unresolved input |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RQ-A00 | Trace every capability to implementation, security, evaluation, UI, and demo evidence. | goal A00 | P0 | all | A00 | this document | evidence is not completion | complete ID coverage and review | HG-1 | final traceability owner |
| RQ-A01 | Freeze public ownership, Apache-2.0, provenance, NOTICE, and clean-room constraints. | goal A01 | P0 | all | A01 | ADR: provenance and ownership | no private provenance | license/provenance review | HG-0 | public remote/owner |
| RQ-A02 | Model trust zones, egress, providers, tools, MCP, and production/experimental separation. | goal A02 | P0 | all | A02 | architecture: system trust diagram | explicit trust boundaries | reviewed diagram and threat tests | HG-1 | deployment topology |
| RQ-A03 | Define atomic event/payload/outbox write and correction/deletion/restore lifecycle, including envelope encryption, KMS outage failure, epoch fences, backup custody, and tombstone replay. | goal A03; security contract 2.1 | P0 | all | A03 | architecture: lifecycle diagram | AEAD tenant/payload/version/class binding; ID-only queue | lifecycle/KMS/restore-race tests | HG-2 | retention/RPO/RTO/key custody |
| RQ-A04 | Freeze governed ordering from identity through outcome and receipt. | goal A04 | P0 | all | A04 | architecture: decision path | no policy or receipt bypass | ordered state-machine tests | HG-1/HG-3 | policy owners |
| RQ-A05 | Define sanitised experimental export through signed promotion and rollback, with a production-owned quarantine importer for only safe inert artifacts. | goal A05; security contract 10 | P1 | async learning | A05 | architecture: learning/promotion | experimental isolation; no executable import | cross-plane/importer deny evidence | HG-4 | promotion authority/artifact formats |
| RQ-A06 | Keep the system independent; allow only future public API consumption. | goal A06; permanent boundaries | P0 | all | A06 | ADR: independent-system boundary | no private import | clean-room checks | HG-0 | public API governance |
| RQ-A07 | Store sensitive content in erasable envelope-encrypted payloads with AEAD tenant/payload/version/class binding, DEK/KEK lifecycle, crypto-erasure, backup custody, and content-free immutable metadata. | goal A07; SECURITY; security contract 2.1 | P0 | all | A07 | ADR: erasable payloads | crypto-erasure and derivative deletion | KMS/rotation/destruction/deletion proof | HG-2 | DEK granularity/key custody/legal hold |
| RQ-A08 | Enforce tenant isolation structurally at every boundary. | goal A08; SECURITY | P0 | all | A08 | ADR: tenant isolation | server-resolved tenant and composite keys | cross-tenant negative suite | HG-2 | tenancy model |
| RQ-A09 | Require pre-search, pre-transmission/failover, independent tool authorization, approval binding, and deletion/revision epoch fence rechecks immediately before every sensitive operation. | goal A09; SECURITY; security contract 2.1 | P0 | memory/action | A09 | ADR: policy order | fail closed at each control and epoch mismatch | policy-stage/epoch-race negative tests | HG-3 | policy language/owners |
| RQ-A10 | Version every material decision input and receipt identity; define canonical receipt crypto, ordering, domain separation, and verifier lifecycle. | goal A10; security contract 5 | P0 | all | A10 | ADR: versioning and receipts | canonical signed receipt | splice/tamper/replay reconstruction tests | HG-1 | algorithm/key/canonicalization |
| RQ-A11 | Freeze core semantic, adapter, transaction, causal, isolation, MCP, and inert-importer boundaries. | goal A11; security contract 10 | P0 | all | A11 | ADR set: core semantics | untrusted data never gains authority or executable import path | ADR/importer contract tests | HG-1/HG-3/HG-4 | semantic vocabulary/artifact formats |
| RQ-A12 | Trace injection, poisoning, replay, SSRF, confused deputy, deletion/epoch race, KMS outage, unsafe import, insider, and supply-chain threats. | goal A12; SECURITY; security contract 2.1/10 | P0 | all | A12 | architecture: threat/privacy model | high-risk abuse has a test/control | threat-to-test matrix | HG-1/HG-2 | risk appetite |
| RQ-A13 | Freeze contradictions only after explicit HG-1; do not treat task start as freeze approval. | goal A13 | P0 | all | A13 | architecture: freeze record | no premature implementation | signed gate record | HG-1 | all A decisions |
| RQ-B01 | Provide a buildable provider-neutral workspace with enforced dependency direction. | goal B01 | P0 | all | B01 | workspace ADR | core excludes provider SDK types | dependency graph check | HG-1 | language/toolchain |
| RQ-B02 | P0 proposal: publish the compatibility/versioning envelope and only contracts consumed by delivered P0 behavior; add P1 provider/tool/registry contracts compatibly together with their consumers. | goal B02; Lean implementation-shape input | P0 core/P1 extensions proposed | all | B02 | cohesive contracts architecture | no unused authority-bearing contract; compatibility and tenant scope | current-consumer acceptance plus compatibility tests | HG-1 | API/versioning and reviewed scope split |
| RQ-B03 | Gate quality, security, SBOM, provenance, reproducible build, and secret scanning. | goal B03; SECURITY | P0 | all | B03 | CI/provenance architecture | supply-chain trust roots | CI artifacts | HG-0/HG-5 | CI provider/attestations |
| RQ-B04 | Offer deterministic local production-contract substitutes. | goal B04 | P0 | all | B04 | local-harness ADR | no false authorization shortcut | parity/negative tests | HG-1 | local service choices |
| RQ-B05 | Reject private paths/names/remotes/artifacts and provenance gaps. | goal B05; AGENTS | P0 | all | B05 | clean-room enforcement ADR | private content exclusion | scan in CI | HG-0 | allowed dependencies |
| RQ-C01 | Verify Cognito issuer/audience/identity/membership/roles/assurance/revocation. | goal C01 | P0 | all | C01 | identity ADR | server-verifiable identity | token negative tests | HG-2 | Cognito/federation config |
| RQ-C02 | Resolve tenant and immutable principal/purpose/trace/decision context server-side. | goal C02; SECURITY | P0 | all | C02 | tenant-context ADR | client cannot select tenant | spoofing negative tests | HG-2 | membership resolution |
| RQ-C03 | Document logical future ownership, but create physical P0 tables/migrations only for delivered behavior; do not add empty registry/experimental schema before its consumer exists. | goal C03; Lean implementation-shape input | P0 delivered schema/P1 additive schema proposed | all | C03 | cohesive data architecture | canonical/derived distinction; no speculative authority surface | migration plus current-consumer tests; empty-schema absence check | HG-2 | region/tenancy/backups and reviewed scope split |
| RQ-C04 | Use tenant-qualified keys, foreign keys, roles, repositories, and negative isolation tests. | goal C04 | P0 | all | C04 | data isolation ADR | structural tenant composite keys | cross-tenant denial test | HG-2 | DB role design |
| RQ-C05 | Use encrypted erasable payload storage with rotation, crypto-erasure, and plaintext-leak detection. | goal C05; SECURITY | P0 | all | C05 | payload-storage ADR | no payload in metadata/logs | encryption/deletion tests | HG-2 | KMS/backup custody |
| RQ-C06 | Append content-free events and linked corrections/retractions. | goal C06 | P0 | all | C06 | event-ledger ADR | immutable metadata allowlist | mutation/retraction tests | HG-2 | event field policy |
| RQ-C07 | Use serializable domain-plus-outbox, inbox dedupe, ordering, retries, and ID-only DLQs. | goal C07; AGENTS | P0 | all | C07 | durable-message ADR | at-least-once with idempotency | duplicate/order/DLQ tests | HG-5 | queue parameters |
| RQ-C08 | Process opaque versioned commands with bounded concurrency and no belief-write bypass. | goal C08 | P0 | async ingestion | C08 | ingestion ADR | deletion/policy check before write | retry/concurrency tests | HG-5 | Lambda/SQS limits |
| RQ-C09 | Make tasks lease-, fence-, heartbeat-, cancellation-, deadline-, and reconciliation-safe. | goal C09 | P0 | planning/action/async | C09 | durable-task ADR | no duplicate effect after worker loss | crash/reclaim tests | HG-5 | task SLOs |
| RQ-C10 | Specify restore, backup expiry, payload-key custody, tombstones, and deletion survival. | goal C10 | P1 | async deletion | C10 | backup/restore ADR | restore cannot resurrect content | restore drill | HG-2/HG-5 | RPO/RTO/key custody |
| RQ-D01 | Distinguish observations, candidates, beliefs, conflicts, unknowns, goals, episodes, entities, causal claims, lessons, procedures, skills, predictions, outcomes. | goal D01 | P0 | memory/planning | D01 | ontology ADR | uncertainty is representable | type/schema tests | HG-1 | ontology stewardship |
| RQ-D02 | Store a tenant-scoped bitemporal multi-graph with provenance and retraction. | goal D02 | P0 | memory/planning | D02 | temporal-graph ADR | tenant/provenance/time enforcement | temporal/cross-tenant tests | HG-2 | graph scale |
| RQ-D03 | Transform observations into candidates without granting them authority. | goal D03 | P0 | async ingestion | D03 | curator ADR | no model-authorized memory | candidate activation denial test | HG-3 | curator sources |
| RQ-D04 | Verify authority, freshness, conflicts, lineage, deletion, and write policy before belief activation. | goal D04 | P0 | memory/planning | D04 | belief-policy ADR | retracted/deleted evidence blocked | conflict/deletion tests | HG-3 | authority policy |
| RQ-D05 | Give every embedding space model/revision/dimension/preprocess/chunking/metric/epoch identity. | goal D05 | P0 | memory | D05 | embedding-space ADR | no cross-space comparison | space-mismatch tests | HG-1 | model/dimension |
| RQ-D06 | Create policy-authorized, sourced, tenant-scoped, deletion-lineaged idempotent embeddings. | goal D06 | P0 | async ingestion | D06 | embedding-job ADR | external embedding has exact authorization | egress/deletion/replay tests | HG-3 | embedding provider/retention |
| RQ-D07 | Perform tenant/space-scoped vector upsert, delete, rebuild, health, and version checks. | goal D07 | P0 | memory | D07 | vector-index ADR | structural scope; no shared search | index boundary tests | HG-2/HG-5 | Cockroach index settings |
| RQ-D08 | P0 proposal: execute two reviewed views—semantic and temporal—behind one retrieval planner; explicitly deny entity, causal, episodic, and procedural view requests until delivered. All six views remain the v3 target subject to later Sol/human and manifest acceptance. | goal D08; Lean implementation-shape input | P0 two-view core/P1 remaining views proposed | memory/planning | D08 | cohesive retrieval architecture | pre-search policy before retrieval; unsupported views fail closed | semantic/temporal tests plus four unsupported-view denial tests | HG-3 | reviewed scope split/view selection criteria |
| RQ-D09 | Fuse evidence accounting for lineage, conflicts, freshness, authority, missingness, and abstention. | goal D09 | P0 | memory/planning | D09 | fusion ADR | no invented certainty | conflict/abstention evaluations | HG-4 | calibration threshold |
| RQ-D10 | Compile bounded typed versioned context with provenance, sensitivity, uncertainty, truncation, and untrusted-data boundaries. | goal D10 | P0 | memory/planning/action | D10 | context-compiler ADR | no instruction authority from context | deterministic/redaction tests | HG-1/HG-3 | context budgets |
| RQ-D11 | Prevent memory, provider, MCP, and tool content from poisoning instructions or bypassing verification. | goal D11; SECURITY | P0 | all | D11 | poisoning-defense ADR | untrusted-content segregation | prompt-injection suite | HG-3 | adversarial corpus |
| RQ-E01 | Enforce a fail-closed policy state machine with distinct stages. | goal E01 | P0 | all | E01 | policy-contract ADR | no skipped control stage | transition negative tests | HG-3 | policy engine |
| RQ-E02 | Authorize views/resources/entities/time/spaces/sensitivity/purpose/limits before search. | goal E02 | P0 | memory/planning | E02 | pre-search policy ADR | retrieve only permitted scope | scope policy tests | HG-3 | policy rules |
| RQ-E03 | Use provider-neutral streaming/usage/safety/error/cancel/capability/idempotency contracts. | goal E03 | P0 | all provider lanes | E03 | provider-contract ADR | provider output untrusted | adapter contract tests | HG-3 | contract version |
| RQ-E04 | Implement Bedrock with explicit model/region/IAM/timeouts/quotas/safety/retention. | goal E04 | P0 | fast/memory/planning/action | E04 | Bedrock adapter ADR | authorized egress only | exact destination tests | HG-3/HG-5 | model/region/terms |
| RQ-E05 | Implement a distinct second-provider adapter and contract tests. | goal E05 | P1 | provider lanes | E05 | second-provider ADR | separate egress/credentials | provider contract tests | HG-3/HG-5 | provider identity/terms |
| RQ-E06 | Select/fail over only by policy and explicitly authorize every attempt. | goal E06 | P1 | provider lanes | E06 | routing/failover ADR | no silent fallback or race | failover denial tests | HG-3 | routing/cost policy |
| RQ-E07 | Apply DLP to the exact outbound request/destination immediately before every provider attempt. | goal E07; SECURITY | P0 | provider lanes | E07 | transmission-policy ADR | provider/failover reauthorization | destination/payload tests | HG-3 | classification/DLP rules |
| RQ-E08 | Store canonical, domain-separated, sequenced, signed/hash-linked receipts using erasable references and explicit partial/unknown states. | goal E08; security contract 5 | P0 | all | E08 | receipt-store ADR | receipt integrity and no immutable content | tamper/truncation/replay/splice tests | HG-1 | signing keys/canonical form |
| RQ-E09 | Bind human approvals to authority, action digest, destination, model/tool, arguments, policy, scope, nonce, expiry. | goal E09 | P1 | action | E09 | approval ADR | no generic/reusable approval | replay/expiry tests | HG-3 | approval roles |
| RQ-E10 | Orchestrate governed inference with untrusted outputs and reconstructable success/failure receipts. | goal E10 | P0 | fast/memory/planning | E10 | inference-orchestrator ADR | durable intent before egress | failure/cancel receipt tests | HG-3 | timeout/retry policy |
| RQ-F01 | Compile versioned world state with evidence coverage, assumptions, conflicts, and unknowns. | goal F01 | P0 | planning/action | F01 | world-state ADR | unknowns cannot disappear | determinism/coverage tests | HG-4 | world-state schema |
| RQ-F02 | Label causal edges by evidence strength and invalidity. | goal F02 | P1 | planning/action | F02 | causal-validation ADR | no causal claim without basis | causal validity evaluation | HG-4 | causal standard |
| RQ-F03 | Persist bounded counterfactual intervention, horizon, assumptions, predictions, uncertainty, and invalidity conditions. | goal F03 | P0 | planning | F03 | simulation ADR | no unbounded scenario generation | scenario-bound tests | HG-4 | simulation method |
| RQ-F04 | Rank plans by utility, uncertainty, downside, reversibility, evidence, cost, latency, privacy, approval. | goal F04 | P0 | planning/action | F04 | plan-scoring ADR | high downside forces escalation | scoring evaluation | HG-3/HG-4 | safety-loss weights |
| RQ-F05 | Define typed tool capability, arguments, scope, effects, idempotency, compensation, risk class. | goal F05 | P1 | action | F05 | tool-intent ADR | exact intent before effect | capability/schema tests | HG-3 | tool catalog |
| RQ-F06 | Independently authorize tools; prevent SSRF/confused deputy; bind approval; reserve effects; use tenant/purpose-bound credentials and revalidated allowlisted egress. | goal F06; SECURITY; security contract 8 | P1 | action | F06 | tool-executor ADR | no model/user-selected host, credential, headers, or transport | IPv4/IPv6/DNS/redirect/deputy/replay tests | HG-3 | credentials/destinations/proxy |
| RQ-F07 | Capture requested/accepted/executed/uncertain/reconciled/failed/compensated/observed effects. | goal F07 | P1 | action | F07 | outcome-capture ADR | uncertain effect is not success | effect-state tests | HG-3 | reconciliation source |
| RQ-F08 | Compare predictions and outcomes with horizon, uncertainty, missingness, attribution limits. | goal F08 | P1 | async learning | F08 | prediction-error ADR | no fabricated learning signal | evaluation fixtures | HG-4 | outcome quality |
| RQ-F09 | Make approvals, providers, simulations, tools, outcomes, and reconciliation durable across worker failure. | goal F09 | P1 | planning/action | F09 | predictive-orchestration ADR | fenced idempotent recovery | crash/replay tests | HG-5 | lease/retry limits |
| RQ-X01 | Physically isolate experimental identity/network/store/queue/key/provider/log/budget/promotion authority. | goal X01 | P1 | async learning | X01 | experimental-isolation ADR | no production write route | cross-plane deny test | HG-4/HG-5 | account/network design |
| RQ-X02 | Export only consented, minimized, de-identified, expiring, deletion-aware data. | goal X02 | P1 | async learning | X02 | learning-export ADR | deletion propagates to export | export/deletion tests | HG-2/HG-4 | consent/retention |
| RQ-X03 | Produce untrusted candidate lessons and competing hypotheses with evidence/uncertainty. | goal X03 | P1 | async learning | X03 | reflection ADR | candidate cannot self-promote | registry admission tests | HG-4 | evaluation method |
| RQ-X04 | Store inert immutable lesson/causal versions with lineage and deletion links. | goal X04 | P1 | async learning | X04 | lesson-registry ADR | no active lesson without promotion | immutability/eval tests | HG-4 | registry owner |
| RQ-X05 | Store bounded signed declarative skills without code, credentials, or policy bypass. | goal X05 | P1 | async learning | X05 | skill-registry ADR | template-only, no executable authority | forbidden-content tests | HG-3/HG-4 | skill format |
| RQ-X06 | Store immutable world-model artifacts with lineage, calibration, limits, compatibility. | goal X06 | P1 | async learning | X06 | world-model-registry ADR | artifact provenance | registry integrity tests | HG-4 | artifact policy |
| RQ-X07 | Evaluate safety, privacy, causal, calibration, robustness, tools, policy, regression, provenance in sandbox. | goal X07 | P1 | async learning | X07 | sandbox-evaluation ADR | promotion cannot skip evaluation | gate suite | HG-4 | thresholds |
| RQ-X08 | Require signed dual-approved promotion with digest, compatibility, scope, receipts. | goal X08 | P1 | async learning | X08 | promotion ADR | approval is bound and auditable | promotion replay tests | HG-4 | approvers |
| RQ-X09 | Use bounded canary, metrics, holds, kill switch, automatic stop, tested rollback. | goal X09 | P1 | async learning | X09 | canary/rollback ADR | no irreversible promotion | stop/rollback drill | HG-4/HG-5 | canary thresholds |
| RQ-X10 | Quarantine/retract/retrain learning artifacts after correction/deletion. | goal X10 | P1 | async learning | X10 | learning-deletion ADR | deletion lineage reaches experiments | derivative purge tests | HG-2/HG-4 | retraining standard |
| RQ-R01 | Propagate correction through candidates, beliefs, graph, vectors, contexts, state, predictions, plans. | goal R01 | P0 | memory/planning | R01 | correction ADR | stale/corrected derivatives blocked | propagation tests | HG-2 | correction authority |
| RQ-R02 | Tombstone, block work, erase payload/key, purge derivatives, verify, and receipt deletion. | goal R02; SECURITY | P0 | all | R02 | deletion-coordinator ADR | synchronous retrieval revocation | deletion end-to-end test | HG-2 | deletion SLA/legal hold |
| RQ-R03 | Ensure restores replay tombstones and cannot resurrect content. | goal R03 | P1 | async deletion | R03 | restore-safe deletion ADR | backup resurrection prevention | restore drill | HG-2/HG-5 | backup retention |
| RQ-R04 | Provide curated tenant-qualified views/templates through a dedicated least-privilege SELECT identity; MCP is bounded, redacted, audited, and read-only. | goal R04; AGENTS; security contract 9 | P0 | memory | R04 | MCP-steward ADR | deny arbitrary SQL/DDL/mutation/metadata enumeration | query/token/resource-exhaustion denial tests | HG-3 | MCP audience/catalog/export limits |
| RQ-R05 | P0 proposal: provide a minimal redacted receipt/evidence/task read model; add tool, approval, experiment, canary, and advanced operator panels only with their delivered P1 capabilities. | goal R05; Lean implementation-shape input | P0 minimal read model/P1 panels proposed | all | R05 | cohesive UI/read-model architecture | UI does not expose erased content or imply absent capability | authorization/redaction tests plus absent-panel checks | HG-2/HG-3 | personas/accessibility and reviewed scope split |
| RQ-R06 | Reconstruct receipt control flow without leaking erasable or withheld content. | goal R06 | P1 | all | R06 | receipt-explorer ADR | redacted evidence only | receipt visibility tests | HG-2 | redaction rules |
| RQ-R07 | Implement scoped, expiring, dual-controlled, audited kill switches/break glass. | goal R07 | P1 | action/operations | R07 | kill-switch ADR | independent stop planes | expiry/audit drills | HG-5 | break-glass owners |
| RQ-S01 | Test tenant escape, replay, injection, SSRF, bypass, receipt tampering, queue forgery, deletion, provider leakage, experimental escape. | goal S01; SECURITY | P0 | all | S01 | adversarial-harness ADR | release-blocking invariant suite | adversarial results | HG-3 | test environments |
| RQ-S02 | Measure retrieval, temporal accuracy, calibration, abstention, causal validity, simulation error, policy precision/recall, harm. | goal S02 | P0 | memory/planning | S02 | evaluation ADR | evaluation includes abstention/harm | synthetic evaluation reports | HG-4 | thresholds/data |
| RQ-S03 | Trace latency, retry, queue, policy, index, provider, tool, deletion, canary, calibration, cost without raw payloads. | goal S03; SECURITY | P0 | all | S03 | telemetry/SLO ADR | telemetry allowlist only | log inspection/SLO tests | HG-5 | SLO/cost budgets |
| RQ-S04 | Red-team security/privacy; close criticals, retest highs, document residual risk. | goal S04; SECURITY | P1 | all | S04 | red-team report | no unresolved critical release finding | signed report | HG-2/HG-3/HG-4 | risk acceptance |
| RQ-S05 | Define AWS/Cockroach IaC for identity, egress, keys, queues, telemetry, providers, experiments. | goal S05 | P0 | operations | S05 | infrastructure ADR | least privilege/segmented egress | plan/deny tests | HG-5 | accounts/regions/network |
| RQ-S06 | Deploy isolated development environment with budgets, scopes, TLS, denial tests. | goal S06 | P0 | operations | S06 | development-deploy ADR | nonproduction isolation | deployment evidence | HG-5 | cloud accounts |
| RQ-S07 | Qualify staging through load, chaos, restore, deletion, provider outage, canary, rollback, incident drills. | goal S07 | P0 | operations | S07 | staging-qualification ADR | failure behavior verified | staged drill reports | HG-5 | test budget/SLOs |
| RQ-S08 | Document incident and operational runbooks. | goal S08 | P1 | operations | S08 | operations/runbooks | accountable recovery paths | tabletop/drill evidence | HG-5 | on-call owners |
| RQ-S09 | Gate production on accounts/domains/policy/terms/budgets/SLOs/on-call/privacy/deletion/rollback. | goal S09 | P1 | operations | S09 | production-gate ADR | no unsupported production claim | gate record | HG-5/HG-6 | all production inputs |
| RQ-V01 | Prove anonymous clean-clone build/test/migrate/launch with checksums/SBOM/provenance. | goal V01 | P0 | operations | V01 | reproducibility proof | no hidden/private dependency | independent clone evidence | HG-0 | public remote/commands |
| RQ-V02 | Provide licensed synthetic deterministic resettable judge fixture/environment. | goal V02 | P0 | demo | V02 | judge-fixture ADR | no private/real data | reset/repeat evidence | HG-6 | demo data license |
| RQ-V03 | Demonstrate core governed predictive path, correction/deletion, and failure handling. | goal V03 | P0 | all | V03 | core-scenario script | no success without receipts | recorded synthetic evidence | HG-6 | judge environment |
| RQ-V04 | Demonstrate advanced failover, tools, learning/promotion, canary, MCP, recovery, restore-safe deletion. | goal V04 | P1 | all | V04 | advanced-scenarios script | unsafe paths denied | scenario evidence | HG-6 | advanced scope |
| RQ-V05 | Produce accurate accessible video, transcript, visuals, and rights review. | goal V05 | P0 | demo | V05 | demo/video plan | claims match evidence | rights/accessibility review | HG-6 | media owner |
| RQ-V06 | Assemble release/source/checksum/SBOM/provenance/docs/video/submission evidence. | goal V06 | P0 | demo/operations | V06 | release/submission checklist | release evidence integrity | release artifact review | HG-6 | submission rules |
| RQ-V07 | Provide a public, versioned external Zintus integration contract only after production gate. | goal V07; permanent boundaries | P1 | integration | V07 | public-API/SDK ADR | no private contract dependency | contract/security test | HG-0/HG-3 | SDK/API design |
| RQ-V08 | Keep later private Zintus external-client integration outside Continuity until separate authorization. | goal V08 | P2/future | integration | V08 | future integration record | private boundary remains intact | separate authorization only | separate future authorization | external-client scope |

### 3.1 Proposed implementation-shape guardrail

For `A11`, `B01`, `B02`, and `C03`, the proposed implementation shape is a modular codebase with an API runtime, worker runtime, minimal web app, infrastructure tree, and cohesive domain modules. There MUST be no service, package, class, ADR, file, endpoint, table, schema, export, or configuration item per manifest task. Architecture destinations in the matrix are logical subjects that SHOULD be consolidated into cohesive ADRs; only an actual durable choice with alternatives and tradeoffs creates an ADR.

Provider and tool boundaries remain ports/adapters, and experimental isolation remains physically separate even when that costs more code. An export, endpoint, configuration key, contract/schema, or table is added only with a current delivered consumer and an acceptance test. The incremental shapes for `B02`, `C03`, `D08`, and `R05` above preserve the complete v3 target while avoiding speculative surface area. These are Lean recommendations for later Sol/human and manifest review, not accepted manifest changes or dependency waivers.

## 4. Normative execution lanes and latency budgets

The system MUST select one lane before provider work. A lane determines allowed computation, admission limits, required policy stages, timeout behavior, receipt semantics, and escalation rules. These are SLO targets to validate by measurement, not vendor latency guarantees.

| Lane | Normal entry | Required work | p50 target | p95 target | Mandatory exit/escalation |
| --- | --- | --- | --- | --- | --- |
| Fast conversation | Current-turn, bounded question; project history/state is not material; no causal, predictive, tool, or sensitive-transmission claim. | authentication, tenant/purpose resolution, bounded current-turn context, pre-transmission policy, provider stream, receipt. | TTFT ≤1.5s; complete ≤5s | TTFT ≤4s; complete ≤15s | escalate to memory or planning when entry conditions fail; fail/persist durable task at timeout; never silently drop receipt. |
| Memory-rich answer | Project history, active state, prior evidence, task status, or bounded factual retrieval is material. | fast controls plus pre-search policy, query embedding if authorized, at most two retrieval views by default, fusion when needed, context compiler, second exact egress check. | TTFT ≤2.5s; complete ≤8s | TTFT ≤7s; complete ≤25s | abstain or escalate on insufficient/conflicting/stale/deletion-pending evidence; do not broaden views without a new policy decision. |
| Predictive planning | User requests plan/forecast/comparison, or material downside/reversibility requires scenario reasoning. | memory controls plus world state, causal-validity classification, bounded simulation, scoring, explicit uncertainty, proposal-only outcome. | preview ≤6s; final ≤15s | preview ≤20s; final ≤45s | maximum 60s synchronous; afterward persist a durable task; invalid causal basis or insufficient evidence causes abstention, not a prediction. |
| Governed action | A request can cause an external effect, including tool call, export, mutation, or irreversible communication. | planning/proposal as required; exact tool intent; independent tool authorization; bound approval when required; effect reservation, idempotency, reconciliation, receipts. | proposal ≤8s; post-approval dispatch ≤0.8s | proposal ≤30s; post-approval dispatch ≤3s | tools expected to take >30s MUST be durable tasks; human and external-tool wait time is measured separately; unknown effects remain unknown until reconciled. |

Experimental learning, reflection, evaluation, promotion, and canary work are **never synchronous request work**. They belong only to an isolated, budgeted asynchronous plane.

### 4.1 Deterministic selective-computation rules

1. Fast conversation MUST use only bounded current-turn material. It MUST NOT search tenant memory, simulate futures, call tools, or make a causal claim.
2. Memory-rich retrieval MUST be selected only when project history or current durable state materially changes the answer. The request policy MUST name allowed data classes, resources, entities, time ranges, views, embedding spaces, and limits before retrieval.
3. The default retrieval cap is **two views**. Under the proposed incremental P0 shape, those implemented views are semantic and temporal behind one retrieval planner; entity, causal, episodic, and procedural/skill requests are explicitly unsupported and denied until their capabilities and acceptance tests are delivered. All six remain the total v3 target pending later Sol/human and manifest acceptance. A selected delivered view MUST have a declared reason:
   - **Semantic:** a concept or similar prior evidence is material.
   - **Temporal:** ordering, validity period, recency, schedule, or historical state is material.
   - **Entity:** a named service, repository, owner, component, or relation is material.
   - **Causal:** an explicitly labelled causal hypothesis is material and its evidence class permits consultation.
   - **Episodic:** a bounded prior incident, decision, or execution episode is material.
   - **Procedural/skill:** an approved bounded procedure is material; an untrusted learned skill is never directly executable.
4. More than two views require a policy decision recording the materiality reason, predicted cost, and lane budget. When more than one source/view contributes, fusion MUST account for lineage dependence, conflict, freshness, authority, missingness, and uncertainty.
5. Simulation MUST occur only for a material plan or forecast. It MUST be bounded to baseline, adverse case, and **at most one** alternative. The simulator MUST record intervention, horizon, assumptions, uncertainty, and invalidity conditions. Invalid causal support or inadequate evidence requires abstention.
6. All external effects MUST enter the governed-action lane. A model proposal, retrieved procedure, provider output, or MCP response cannot cause an effect by itself.

### 4.2 Forced-slower conditions

The engine MUST leave fast mode and choose a stricter lane or abstain when any condition below applies:

- tenant, membership, purpose, or resource scope is ambiguous;
- a sensitive payload may leave the system, including embedding, reranking, moderation, provider transmission, failover, tool, or export;
- evidence is stale, conflicting, corrected, retracted, or deletion-pending;
- the response contains a causal or predictive claim;
- provider failover is considered;
- downside is material, reversibility is low, or a plan/action has non-trivial cost;
- an approval, tool, export, or external durable effect is requested;
- an admission quota, cost reserve, concurrency budget, timeout, or output cap would be exceeded;
- policy, retrieval, compiler, embedding-space, provider/model, tool, or configuration version changes during the decision.

## 5. Receipt and effect contract

Every decision has one receipt ID allocated before any provider/tool egress. The receipt state machine is:

```text
accepted → authorized → transmitting → [streaming] → completed | cancelled | failed | unknown
```

- `accepted`: durable, content-free decision intent and receipt ID were committed before egress.
- `authorized`: authentication, tenant/purpose, lane admission, and applicable pre-search/pre-transmission decisions passed.
- `transmitting`: the exact provider/tool destination and redacted request digest were authorized immediately before the attempt.
- `streaming`: an optional provider-output state; it may be shown as provisional, is untrusted, and is not a terminal success. Tools and non-streaming providers transition from `transmitting` directly to a terminal state.
- `completed`: terminal receipt persistence succeeded and contains the actual version identities, outcome, and permitted usage metadata.
- `cancelled`: a user/system cancellation was durably recorded; downstream uncertainty is retained if an attempt may have escaped.
- `failed`: a known failure occurred before a confirmed external effect or response completion.
- `unknown`: timeout, disconnect, crash, lost acknowledgement, or provider/tool ambiguity leaves the effect uncertain; reconciliation is required.

`pending` is not a receipt state. Before `accepted`, the system has no accepted decision and MUST fail closed: a failure to persist the content-free decision intent, receipt ID, idempotency key, or required authorization record results in a rejected local request with **zero** provider, embedding, reranking, moderation, tool, export, or other external egress. No transition to `transmitting` is permitted until the durable `accepted` record and required authorization are present. After an external attempt, terminal-persistence failure MUST result in `unknown`, never `pending`: success is withheld, no duplicate non-idempotent retry is allowed, and durable reconciliation MUST repair or create the `unknown` record before any new attempt.

The terminal receipt MUST be durably persisted before the client is told the decision succeeded. Terminal persistence targets are p50 under 250ms and p95 under 1s. Each receipt MUST carry content-free identities for the tenant, principal, purpose, lane, request digest, policy version, context-compiler version, retrieval-configuration version, embedding-space version, provider and model, and the complete active-memory-revision-ID set (an explicitly empty set when no memory was active). It MUST also carry applicable schema/configuration, simulation, tool-intent, approval, deletion-epoch, idempotency, and attempt identities. Immutable receipt/event fields use a field allowlist and contain no prompt, response, tool argument, payload, low-entropy token, or low-entropy “hash” that can function as retained content. Content references are opaque, erasable references only.

`A10` and `E08` MUST choose and version a canonical serialization format, signature/hash algorithm, and verifier protocol. Receipt signing/digest input MUST include domain separation by tenant and receipt type, predecessor receipt ID/hash, and monotonic per-decision sequence so truncation, replay, reordering, and cross-tenant splicing are detectable. A receipt stores the signing/keyed-digest algorithm, format version, key ID, key owner, rotation/revocation state, and verifier identity. Any stored request/content digest MUST be either a safe domain-separated keyed digest or a digest of high-entropy ciphertext; a low-entropy plaintext hash is forbidden. Acceptance evidence MUST include synthetic tests that assert every required identity is present, version-consistent with the decision, content-free, and tamper-evident for every lane and external attempt, including canonicalization, partial-stream, truncation, tamper, replay, and cross-tenant splice cases.

| Failure case | Required behavior |
| --- | --- |
| Decision-intent or pre-transmission persistence failure | before `accepted`/`transmitting`, fail closed with zero external egress; return a local rejection and leave no unreceipted execution to reconcile. |
| Client disconnect while streaming | Continue only if policy and durable task rules permit; record disconnect; finalize `completed`, `cancelled`, `failed`, or `unknown`; do not assume delivery. |
| User cancellation before egress | persist `cancelled`; no provider/tool attempt. |
| User cancellation after provider/tool attempt | cancel downstream if supported; retain `unknown` until acknowledgement/reconciliation determines outcome. |
| Provider timeout/lost acknowledgement | never silently fail over; mark attempt `unknown`; reconcile before retrying a non-idempotent request or showing success. |
| Terminal receipt persistence failure after output | hide terminal success; transition to `unknown` through durable recovery before any retry; reconcile receipt/outcome through durable work. |
| Partial stream or non-stream provider/tool | record the optional `streaming` state only when bytes/tokens were received; otherwise transition from `transmitting` to the factually correct terminal state and test partial-output preservation without terminal success. |
| Tool request | persist exact typed intent and idempotency key before execution; bind authorization/approval to exact destination and arguments digest. |
| Tool timeout/lost acknowledgement | preserve `unknown-effect`; block duplicate non-idempotent effect; reconcile with the authoritative external system. |
| Worker crash/retry | use outbox/inbox idempotency, leases/fencing, and effect reservation; retries cannot produce duplicate durable effects. |

There is no `pending` receipt state, no unreceipted mode, no “fast mode” exemption, and no immutable stream-content retention.

## 6. Cost admission and operational quotas

Before work begins, the system MUST calculate a conservative reserve for the lane, selected views, provider/model, maximum output, simulations, tools, and expected retries. Quotas apply at **principal**, **tenant**, and **project** scopes:

- input, output, and total provider tokens;
- retrieval count, selected views, candidate limits, context bytes, and embedding requests;
- simulation count, branches, horizon, and model-call budget;
- provider attempts, failovers, tool attempts, exports, and reconciliation work;
- concurrent streams, queue backlog, durable tasks, and long-running actions;
- daily and monthly spend/reserves, including experimental-plane spend.

The concrete dollar limits, per-tenant allocations, burst rules, and action reserve size remain **unresolved human input** under HG-5. Until approved, defaults MUST be deny/conservative and must not be represented as production policy.

Admission MUST enforce lane-specific maxima, reserve then settle observed cost, release unused reserve, fail closed when a hard limit is reached, and surface an explainable quota denial. It MUST include circuit breakers, bounded retries, reserved action capacity, version-scoped caches, and a separately capped experimental budget. Cache keys MUST include tenant, authorization scope, policy version, retrieval configuration, compiler version, embedding space, and deletion epoch. Cache invalidation MUST occur on correction, deletion, policy revocation, authorization change, and relevant version change.

## 7. Forbidden latency “optimizations”

The following are prohibited even if they reduce apparent latency or expense:

- skipping authentication, policy, policy reauthorization, approval, or receipt stages;
- post-filter-only tenancy or a tenant-global vector search;
- comparing vectors from different embedding spaces or epochs without an explicit evaluated migration path;
- silent provider failover, speculative provider racing, or unrecorded alternate egress;
- streaming externally before durable intent/receipt ID exists;
- reporting success before terminal receipt persistence;
- generic/reusable approval, speculative tool calls, direct model-to-tool execution, or retrying non-idempotent actions after unknown acknowledgement;
- using stale/corrected/deletion-pending state without a visible versioned decision and policy permission;
- suppressing uncertainty, conflicts, missingness, causal invalidity, or deletion status;
- raw prompt, response, memory, secret, tool-argument, or low-entropy fingerprint telemetry;
- synchronous reflection, learning, evaluation, promotion, or canary work;
- using a shared cache, shared retrieval corpus, or cross-tenant “optimization” that can infer another tenant’s existence or content.

## 8. Dependency contradiction register — directions only

This register identifies graph tensions to resolve during architecture review. It does not edit the manifest, waive dependencies, or claim a resolution.

| Register ID | Observed dependency tension | Risk | Proposed direction for Sol review | Required evidence before closure |
| --- | --- | --- | --- | --- |
| DC-01 | `E10 → E06 → E05`: the P0 inference orchestrator depends on a P1 second provider. | P0 cannot be independently delivered. | Split the contract/selection seam from operational failover, or explicitly raise the dependency; preserve reauthorization. | revised manifest and scope decision; HG-3 |
| DC-02 | `E10 → E09`: P0 inference waits on P1 bound human approvals. | fast/memory path can be blocked by action-only approval. | Separate non-action inference authorization from action approval; retain strict approval for all external effects. | state-machine/manifest decision; HG-3 |
| DC-03 | `E07 → E06 → E05`: P0 pre-transmission DLP depends on P1 failover/second provider. | safe primary-provider path becomes unavailable. | Define a primary-attempt DLP seam independently; add per-attempt reauthorization when failover arrives. | policy ADR and test plan; HG-3 |
| DC-04 | `R05 → F09` chain: UI depends on durable predictive orchestration, which depends on action/outcome work. | P0 evidence UI may be delayed by P1 action complexity. | Separate a minimal receipt/evidence UI read model from predictive/action operations without weakening redaction. | task/acceptance split; HG-2/HG-3 |
| DC-05 | `V01 → S07 → X09`: clean-clone proof requires staging, which requires canary/rollback experimental work. | P0 reproducibility blocked by P1 learning. | Define a P0 non-learning staging proof or make scope/dependency explicit; never run experimental work synchronously. | manifest revision and staging plan; HG-4/HG-5 |
| DC-06 | `S01 → F06`: core security harness waits on P1 tool executor. | security evidence for P0 data/provider paths is delayed. | Split a P0 adversarial harness from tool-specific extension; retain tool tests as a required later module. | test architecture/manifest decision; HG-3 |
| DC-07 | `A13` depends on all A tasks, whose chain carries HG-0, HG-1, HG-2, HG-3, and HG-4 decision concerns, while HG-1 is also described as architecture freeze. | Treating every downstream decision concern as a readiness gate can deadlock the architecture phase or falsely infer approval. | Distinguish provisional design review from actual human approval/freeze. A00 completion or goal start cannot grant any HG approval; only current manifest readiness applies until a separately reviewed gate/dependency revision. | explicit gate semantics, human decision records, and reviewed manifest update |
| DC-08 | `S05/S06/S04` coupling to `X` through `X01`/`X09` makes infrastructure and development deployment depend on full experimental promotion. | expensive/deep P1 learning blocks P0 platform validation. | Separate a physically isolated, inert experimental-plane foundation from promotion/canary operationalization; preserve no-production-write proof. | Lean/Security review and manifest decision; HG-4/HG-5 |
| DC-09 | README Architecture v1 material may not match the approved Architecture v3 hierarchy, lanes, and governance vocabulary. | public documentation can describe the wrong system or overstate readiness. | Perform a later reviewed governance/documentation update; do not silently rewrite baseline material in this traceability task. | reviewed README/architecture reconciliation and provenance evidence; HG-1/HG-6 |
| DC-10 | Legacy `goal.md`, task manifest, and status agent-workflow/role wording can conflict with the now-authorized Worker → Terra → Security → Lean → Chief hierarchy. | an agent may follow obsolete authority or update memory prematurely. | Perform a later reviewed governance update that reconciles role authority and records the transition; do not silently edit those baseline files here. | reviewed governance update and independent workflow verification; HG-1 |
| DC-11 | Proposed incremental shapes for `B02`, `C03`, `D08`, and `R05` differ from the current all-capability wording/dependencies. | code may create speculative contracts/tables/views/UI or may silently treat the proposal as accepted scope. | Split acceptance/scope only through later Sol/human review and a separate manifest/governance update; otherwise accept the current tasks remain blocked as written. | approved scope decision, updated manifest, and consumer-backed acceptance tests |

### 8.1 Complete proposed P0/P1 direct-edge audit

This is a mechanical audit of every direct edge where this document’s proposed delivery classifications label the dependent P0 and its dependency P1. It is not manifest truth, an implicit waiver, or a dependency edit. Each direction requires later Sol/human review and a separately reviewed manifest update; absent that update, the dependent remains blocked under the current manifest.

| Explicit direct edge(s) | Proposed direction | No-silent-waiver outcome |
| --- | --- | --- |
| `A11 <- A05`; `A12 <- A05`; `A13 <- A05` | Split acceptance/scope: P0 architecture/threat work defines isolation, deny-by-default, and inert-import contracts; P1 supplies the full learning/promotion diagram and operational evidence. Later review must revise dependencies or re-tier A05. | Until revised, A11/A12/A13 remain blocked by A05. |
| `E07 <- E06` | Split acceptance/scope: P0 transmission policy covers an explicitly selected primary attempt; P1 extends it to routing/failover, with fresh authorization per attempt. Later review must revise the dependency. | Until revised, E07 remains blocked by E06. |
| `E10 <- E06`; `E10 <- E09` | Split acceptance/scope: P0 orchestrates non-action primary-provider inference; P1 adds provider routing/failover and approval-bound actions. Later review must revise dependencies. | Until revised, E10 remains blocked by E06 and E09. |
| `F03 <- F02` | Re-tier the minimum causal-validity classification needed by P0 simulation into a P0 slice of F02, leaving advanced causal validation P1. | Without re-tier/revision, F03 remains blocked by F02. |
| `S02 <- F02` | Split acceptance/scope: P0 evaluates delivered epistemic/retrieval/simulation behavior; causal-validity evaluation arrives with the delivered F02 capability. | Until revised, S02 remains blocked by F02. |
| `R05 <- F09` | Split acceptance/scope: P0 is the minimal redacted receipt/evidence/task read model; predictive/action panels arrive with P1 F09. Later review must revise the dependency. | Until revised, R05 remains blocked by F09. |
| `S03 <- F09` | Split acceptance/scope: P0 telemetry covers delivered lanes and durable ingestion/tasks; P1 adds predictive/action orchestration telemetry with F09. | Until revised, S03 remains blocked by F09. |
| `S01 <- F06` | Split acceptance/scope: P0 adversarial tests cover identity/data/retrieval/provider/receipt paths; P1 tool-specific tests arrive with F06. | Until revised, S01 remains blocked by F06. |
| `S05 <- C10`; `S05 <- X01` | Split acceptance/scope: P0 IaC covers delivered runtime/data/security resources; backup/restore and experimental-plane modules arrive with C10/X01. Later review must revise dependencies. | Until revised, S05 remains blocked by C10 and X01. |
| `S06 <- S04` | Split acceptance/scope or re-tier: require a P0 scoped pre-deployment security review, while the full cross-capability red team remains P1. | Without reviewed split/re-tier, S06 remains blocked by S04. |
| `S07 <- X09`; `S07 <- R03`; `S07 <- R07` | Split acceptance/scope: P0 staging qualifies delivered core load/failure/deletion paths; canary, restore-safe deletion, and kill-switch drills arrive with the corresponding P1 capabilities. | Until revised, S07 remains blocked by X09, R03, and R07. |
| `V05 <- V04` | Split acceptance/scope: P0 video covers only verified core scenario V03; advanced footage is added only after V04. | Until revised, V05 remains blocked by V04. |
| `V06 <- V04`; `V06 <- S08` | Split acceptance/scope: distinguish a hackathon P0 submission package from a P1 production release/runbook package. | Until revised, V06 remains blocked by V04 and S08. |

## 9. Luna reconciliation appendix — input and evidence gap

No inspectable Luna report, file, issue, or signed finding is available in this repository or in the task context supplied to this worker. The following are therefore **reconciliation inputs/evidence gaps**, not formal closure claims:

1. The architecture must avoid representing the full cognition graph as mandatory synchronous work; the four lanes and selective-computation rules above are the traceability response.
2. The dependency graph contains P0/P1 tensions recorded in the contradiction register; the register is not a manifest amendment.
3. The UI, receipt, deletion, and action semantics need dedicated data-flow/edge-case verification before implementation claims can be made.
4. Any later Luna findings must be attached by stable reference, mapped to a requirement ID, assigned an owner, given testable acceptance evidence, and independently closed by the stated review workflow.

## 10. Security contracts for all implementation batches from B onward

Each batch beginning with B MUST define measurable, synthetic, inspectable acceptance evidence for the relevant contracts below. A green happy-path test is insufficient.

| Contract | Normative control | Minimum evidence |
| --- | --- | --- |
| Authorized external processing | External embedding, reranking, moderation, generation, failover, tools, exports, and any new egress MUST receive exact pre-transmission authorization for source class, destination, purpose, version, and bounded request. | allow/deny tests plus a redacted receipt assertion per egress class |
| Tenant structure | Tenant context MUST be server-resolved; persistent keys and vector/index lookups MUST include tenant scope structurally rather than relying on application post-filtering. | forged-tenant, cross-tenant read/write/vector/cache/queue negative tests |
| Immutable metadata | Immutable event/receipt metadata MUST use an explicit field allowlist; no payload, prompt, response, tool arguments, secret, or low-entropy hash/fingerprint is permitted. | schema allowlist test plus synthetic leakage scan |
| Keys and deletion | Envelope encryption MUST use approved DEK granularity and KMS/KEK wrapping with AEAD tenant/payload/version/class binding; KMS outage fails closed; rotation/rewrap/destruction and backup ciphertext/key custody are auditable. A deletion/revision epoch/fence is rechecked immediately before decrypt, retrieve/vector return, context compile, egress, tool reservation/execution, export, and promotion; revocation blocks retrieval synchronously and cleanup/reconciliation asynchronously. | AEAD substitution, KMS outage, rotation/rewrap/destruction, stale lease/retry/cache, pre-egress, crypto-erasure, provider-retention-limitation, tombstone/vector/context/restore tests |
| Receipt integrity | Receipts MUST use a versioned canonical serialization format; tenant/receipt-type domain separation; predecessor/sequence binding; declared signature/hash algorithm, key ID/owner/rotation/revocation/verifier; safe keyed or high-entropy-ciphertext digest; partial/unknown-effect states; and idempotency/reconciliation correlation. | canonicalization, tamper, truncation, replay, cross-tenant splice, partial-stream, crash, and unknown-outcome tests |
| At-least-once work | Queue consumers MUST use inbox/outbox idempotency, ordering/version checks, leases, fencing, and bounded retries. | duplicate, reorder, crash, stale-worker, and DLQ tests |
| Tool safety | Tool execution MUST deny loopback, private, link-local, metadata, and multicast IPv4/IPv6 ranges; resolve DNS and validate the resulting IP immediately before connect; prevent rebinding; disable redirects or fully reauthorize/revalidate every hop. Egress uses an allowlisted proxy; model/user input cannot choose host, credential, auth headers, or raw transport; credentials are tenant/purpose-bound; response size/time limits apply. | IPv4/IPv6/private/metadata/multicast, redirect, DNS-rebinding, credential-forwarding, scope-escalation, timeout/size tests |
| Experimental promotion | Only a production-owned quarantine importer MAY accept a reviewed, signed experimental artifact; experimental identities have no production write credential. The importer allows only non-executable allowlisted formats and enforces strict size, structure, and schema scanning; it rejects unsafe deserialization, pickle, arbitrary archives, scripts, dynamic imports, credentials, and network callbacks. It binds provenance, evaluation digest, and approvals. | cross-plane denial, malformed/oversize/schema/unsafe-format, provenance/evaluation/approval, sandbox-importer-only tests |
| MCP | Managed MCP MUST use a dedicated least-privilege SELECT identity and curated tenant-qualified views/templates, with tenant/purpose authorization, redaction, receipts, and hackathon read-only scope. It MUST deny arbitrary SQL, DDL, mutation, metadata enumeration, and unrestricted EXPLAIN; bound rows/page/time/concurrency/export; bind pagination tokens to tenant/query/policy/version; and protect against inference/minimum-result disclosure. | raw-query/write/metadata/EXPLAIN, token replay/cross-tenant, timeout/concurrency/export/resource-exhaustion, minimum-result inference denial tests |
| Telemetry | Telemetry MUST follow a field allowlist and use secret/payload scanners; raw sensitive content is never an observability fallback. | log fixture inspection and scanner evidence |
| Supply chain | Builds MUST have declared trust roots, pinned/reviewed dependencies, license/SBOM/provenance evidence, and clean-room checks. | CI artifact, dependency/secret/license scan, anonymous-clone test |
| Denial of wallet | Lane admission, token/output caps, retrieval/simulation limits, concurrency controls, retry budgets, and circuit breakers MUST prevent unbounded spend. | quota, retry-storm, simulation-burst, and circuit-breaker tests |

## 11. Agent authority and mandatory memory-update workflow

**Provenance:** the human owner explicitly authorized this Worker → Terra → Security → Lean → Chief hierarchy in the current task/session. That authorization establishes review workflow only; it grants no HG-0 through HG-6 approval and does not silently amend repository governance. The stale repository wording remains an open reconciliation item under DC-10 until a reviewed governance update occurs.

Every coding batch, including A00, MUST follow this ordered chain without a direct fan-out:

```text
Worker → independent Terra → Security Lead → Lean-Code Lead → Chief Architect → durable memory/status update
```

1. The Worker implements only the assigned scope and sends change/test/risk evidence to Terra.
2. Terra independently checks the requirement, tests, data flow, scope, and regression risk. A Terra failure returns only to the Worker for correction. A Terra PASS goes **only** to the Security Lead.
3. The Security Lead performs adversarial review. A security finding returns to the Worker; any security fix returns through Terra and then Security again. A Security PASS goes only to the Lean-Code Lead.
4. The Lean-Code Lead is mandatory for coding work and reviews unnecessary complexity, duplication, generated boilerplate, and maintainability without removing safety. A Lean change returns through Terra; if safety-affecting, it returns through both Terra and Security. A Lean PASS goes only to the Chief Architect.
5. The Chief Architect may perform final technical closure recommendation only after the preceding PASS records. The Chief Architect MUST NOT self-verify its own implementation or convert human gates into approval.
6. Durable architecture memory, status, and evidence may be updated only after the Chief Architect has accepted the complete chain. Those records must not claim a human gate that the human did not grant.

Architecture/document-only batches use the same chain by default. A Chief Architect may omit a non-coding review only by recording a concrete risk-based exception before that review; **A00 has no such exception and MUST use every gate above.**

| Role | May do | Must not do | Mandatory handoff |
| --- | --- | --- | --- |
| Worker | Implement one bounded task and report changed files, tests, risks, limitations. | Approve work, update memory/status, change scope, or bypass review. | Worker → Terra |
| Terra verifier | Independently verify requirement, tests, data flow, scope, and regressions. | Treat happy-path tests as sufficient or send a PASS directly to multiple reviewers. | PASS: Terra → Security; failure: Terra → Worker |
| Security Lead (Sol High) | Adversarially review and block vulnerabilities; propose fixes. | Approve its own security fix without renewed Terra verification. | PASS: Security → Lean; finding: Security → Worker → Terra → Security |
| Lean-Code Lead (Sol High) | Review coding work for unnecessary complexity/duplication while preserving controls. | Remove safety/privacy/policy/receipt/recovery controls to reduce lines. | PASS: Lean → Chief; change: Lean → Terra, then Security when safety-affecting |
| Chief Architect (Sol High) | Own architecture, resolve contradictions, and make final technical closure recommendation. | Self-verify implementation or silently grant human approval. | PASS: Chief → durable memory/status update |
| Durable project memory | Record supported architecture/status/evidence in the designated public repository documents. | Record secrets/private content, unsupported completion, or ungranted gates. | final step only |

## 12. Manual scenario traceability table

This table is a review checklist, not execution evidence.

| Scenario | Lane / admission decision | Required controls | Expected terminal state | Evidence needed before a completion claim |
| --- | --- | --- | --- | --- |
| Current-turn bounded question | Fast; only if no durable state is material. | identity, server tenant/purpose, bounded input, pre-transmission policy, receipt. | completed/failed/cancelled/unknown. | state ordering and latency measurement with synthetic data. |
| Project-state question | Memory; select no more than two authorized views. | pre-search authorization, same-space vector scope, fusion, compiler, exact egress check. | completed or abstained/failed; never fabricated certainty. | cross-tenant/cross-space and stale/conflict tests. |
| Sensitive external egress: embedding, reranking, moderation, or generation | Forced slower; authorize the exact data class, redacted request, purpose, destination, provider/model, and budget before each egress attempt. | durable receipt/intent, pre-search policy where applicable, exact pre-transmission policy, data minimization/DLP, egress allowlist, version identities, and deletion/revision epoch fence immediately before egress. | completed/failed/unknown; decision-intent persistence failure is rejected before `accepted` with zero egress; provider retention/deletion assurance is recorded honestly. | synthetic egress allow/deny and pre-egress epoch-race tests for every external processing class plus receipt-identity/retention-limitation assertions. |
| Provider failover considered after a primary failure | Forced slower; provider-lane routing only after explicit reauthorization for the alternate destination. | preserve primary attempt receipt, classify known versus unknown failure, re-run exact transmission policy, reserve cost, no silent race/fallback. | failed or unknown for primary; a separately receipted alternate attempt only when allowed. | injected provider outage/lost-acknowledgement tests proving no unauthorized alternate egress. |
| Stale, conflicting, corrected, retracted, or deletion-pending evidence | Memory or planning only; fast mode is forbidden. | freshness/conflict/lineage/deletion checks, bounded authorized retrieval, fusion, visible uncertainty, correction/tombstone cache invalidation. | abstained, failed/denied, or a qualified result with the evidence state visible; never unqualified success from blocked evidence. | synthetic stale/conflict/correction/deletion-pending retrieval and cache tests. |
| Deletion/revision epoch changes during an active lease, stale retry, cache hit, or restore | Deny/escalate; no lane may reuse pre-fence authorization. | AEAD-bound payload identity, KMS fail-closed behavior, epoch/fence recheck immediately before decrypt/retrieval/vector return/context compile/egress/tool reservation/execution/export/promotion, tombstone replay before restore exposure. | denied or `unknown` when an earlier external attempt is ambiguous; no stale content/effect is released. | KMS outage, stale worker/retry/cache race, vector/context purge, tool fence, backup-custody, crypto-erasure, and restore-tombstone replay tests. |
| Release-risk plan | Planning; bounded simulation only if causal basis/evidence is sufficient. | world state, causal class, baseline/adverse/one alternative, scoring, uncertainty. | proposal completed or abstained; a >60s run becomes durable. | calibration/abstention and durable-task tests. |
| Deploy/change request | Governed action. | exact intent, independent tool authorization, bound approval if required, reserve, idempotency, reconciliation. | completed effect, failed, or unknown-effect; never inferred success. | tool safety/replay/reconciliation tests. |
| Tool use/action escalation from an otherwise conversational or planning request | Escalate to governed action before any external effect; no inherited fast/memory approval is valid. | exact typed intent, destination/argument digest, independent tool authorization, bound human approval when policy requires, idempotency/effect reservation, epoch fence, tenant/purpose credential selection, allowlisted proxy, DNS/IP/redirect revalidation, and least-privilege egress. | proposal, denied, failed, completed effect, or unknown-effect; never a direct model/tool success. | escalation, generic-approval, SSRF/confused-deputy, IPv4/IPv6/private/metadata/DNS-rebinding/redirect, retry, and unknown-effect reconciliation tests. |
| Managed MCP Steward query | Memory lane only after tenant/purpose authorization; no arbitrary query capability. | dedicated SELECT identity, curated tenant-qualified template, bounded page/rows/time/concurrency/export, version-bound pagination token, redaction, minimum-result protection, audit receipt. | bounded redacted read or denied; never a mutation, metadata enumeration, or cross-tenant result. | arbitrary-SQL/DDL/mutation/metadata/EXPLAIN, token replay/cross-tenant, timeout/concurrency/export/resource-exhaustion, and inference-denial tests. |
| Tenant or purpose ambiguity | Forced slower/deny. | do not retrieve, transmit, or tool-call until server resolution. | failed/denied with receipt. | forged context test. |
| Decision-intent persistence failure before egress | Any lane; reject before `accepted`. | fail closed, no stream, no provider/tool/embedding/reranking/moderation/export request, local error telemetry only. | no receipt-state transition and zero external effect. | injected receipt-store outage with network/adapter spy proving zero egress. |
| Terminal receipt persistence failure | Any lane after an external attempt; cannot report terminal success. | durable recovery to `unknown`, no duplicate non-idempotent retry, reconciliation. | unknown until reconciled. | injected database failure and unknown-state recovery test. |
| Client disconnect during stream | Any provider lane. | durable receipt, cancellation protocol, delivery ambiguity record. | completed/cancelled/unknown based on facts. | disconnect test. |
| Unknown tool acknowledgement | Governed action. | effect reservation, no duplicate retry, external reconciliation. | unknown-effect then reconciled outcome. | lost-acknowledgement test. |
| Reflection/promotion request | Async learning only; never joins a user latency path. | isolated identity/network/store/budget, allowlisted non-executable artifact format, strict structure/schema/size scan, provenance/evaluation/approval binding, production-owned quarantine importer, sandbox evaluation, signed promotion. | inert candidate, promoted only through gates, or rejected; unsafe import is denied. | cross-plane deny, unsafe-deserialization/archive/script/dynamic-import/credential/network-callback, malformed/oversize, and importer-only promotion tests. |

## 13. Open decisions and non-claims

The following remain unresolved human inputs and MUST be decided through the listed gates before relevant implementation/deployment claims: AWS accounts/regions/network and budgets (HG-5); CockroachDB organization/regions/backups/RPO/RTO (HG-2/HG-5); Cognito federation/MFA/break-glass (HG-2); controller/processor roles, deletion SLA, retention, legal hold, residency, learning consent (HG-2); Bedrock model/region and second provider terms/retention (HG-3/HG-5); KMS key granularity and backup-key custody (HG-2/HG-5); policy/approval/tool owners and prohibited destinations (HG-3); causal/evaluation/calibration thresholds (HG-4); promotion/canary/rollback authorities (HG-4/HG-5); MCP audience and query catalog (HG-3); UI personas, accessibility, audit exports, SLO/load/cost ceilings, incident channels (HG-5/HG-6); and public remote/demo/submission authority (HG-0/HG-6).

No item in this document claims that a control has been implemented, tested, deployed, demonstrated, certified, or approved.
