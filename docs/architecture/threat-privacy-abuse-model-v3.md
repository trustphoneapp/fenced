# A12 Threat, Privacy-Risk, and Abuse Model — Architecture v3

## 1. State, authority, and reading rules

This is A12 revision `R5`. It is public design evidence only. It does not
implement, execute, validate at runtime, certify, approve, deploy, release, or
freeze anything. Architecture v3 remains unfrozen. HG-5 and HG-6 remain
pending. The current task state remains A12 `pending`; this artifact cannot
complete A12, change the manifest, make A13 ready or selected, or create an
automatic successor. A later separately reviewed completion-only governance
transaction may establish `DESIGN_BASELINE_COMPLETE_WITH_OPEN_RUNTIME_RISKS`;
R5 does not establish that state.

Failed R1 is immutable history at `{size_bytes: 45782, lines: 361 including
terminal LF, sha256:
995d7147b75de5b3396d8cd20c468be77466469bf150f10b95fe935887818151,
mode: 0644}`. It stopped at Worker HIGH `CONTRADICTION-01`; Terra, Security,
Lean, and Chief were not reached. No R1 role, result, PASS, finding
disposition, text, hash, review position, or authority carries into R5.

Failed R2 is immutable history at `{size_bytes: 50160, lines: 422 including
terminal LF, sha256:
cd9f3926cf7bc95bab575869a0b594ec1b389a44d4ae88f2ee2e6db7700de287,
mode: 0644}`. R2 received Worker `DESIGN_REVIEW_PASS`, then independent Terra
PASS with zero findings, then stopped at independent Security MEDIUM
`A12-R2-SEC-01`; Lean and Chief were not reached. No R2 role, result, PASS,
finding disposition, text, hash, review position, or authority carries into
R5.

Failed R3 is immutable history at `{size_bytes: 51619, lines: 438 including
terminal LF, sha256:
7209f3de06351afc54ff547ef5d906f3e60577a68fd4a0b37f99d86a5fe208d0,
mode: 0644}`. R3 received Worker `DESIGN_REVIEW_PASS`, then stopped at
independent Terra MEDIUM `A12-R3-TERRA-01`; Security, Lean, and Chief were not
reached. No R3 role, result, PASS, finding disposition, text, hash, review
position, or authority carries into R5.

Reviewed R4 is immutable history at `{size_bytes: 52603, lines: 451 including
terminal LF, sha256:
f012883977c1dc4c06c362a43f24745c254b727477b61d6fbbdb9356284426ce,
mode: 0644}`. R4 completed fresh Worker `DESIGN_REVIEW_PASS` → independent
Terra PASS with zero findings → independent Security PASS with zero findings →
independent Lean PASS with zero findings → final Chief PASS on that one
unchanged hash. No R4 role, result, PASS, finding disposition, text, hash,
review position, or authority carries into R5.

Normative words `MUST`, `MUST NOT`, `REQUIRED`, and `DENY` describe future
controls and future evidence requirements. A proposed control is not evidence
that the control exists. An unexecuted negative test is not runtime evidence.
Only `UNRESOLVED` and `EVIDENCE_CLOSED` are valid closure states.

Two verdicts are deliberately separate:

- `DESIGN_REVIEW_PASS` judges only structural completeness, internal
  consistency, exact source traceability, honest classification, separate
  prevention/detection/recovery controls, evidence gaps, residual risk,
  planned negative/adversarial validation, owners, dependencies, closure
  states, and required blocks.
- `RISK_CLOSURE_PASS` requires actual admissible evidence and closure of every
  blocking risk. Design text, proposed controls, planned or unexecuted tests,
  and `DESIGN_ONLY_UNEXECUTED` evidence cannot satisfy it.
- Artifact `PASS` in the R5 review chain means only `DESIGN_REVIEW_PASS`. It
  never means risk closure, control effectiveness, executed-test or runtime
  evidence, operational readiness, A12 completion, A13
  readiness/selection/completion, Architecture freeze, implementation,
  deployment, release, or production readiness.

The fail-closed risk rule is absolute:

1. inherent and residual severity use exactly `CRITICAL`, `HIGH`, `MEDIUM`, or
   `LOW`;
2. missing, unknown, ambiguous, conflicting, malformed, unmapped, or
   unsupported classification becomes `CLASSIFICATION_REQUIRED`, which is not
   a fifth severity;
3. `CLASSIFICATION_REQUIRED`, unresolved `CRITICAL`, and unresolved `HIGH`
   block exactly `RISK_CLOSURE_PASS`, S04 closure, operational activation,
   deployment, release, production, A13 readiness, A13 selection, and A13
   completion;
4. closure cannot override that block; and
5. there is no waiver, alias, number, default, fallback, threshold, weight,
   row-local rubric, or pressure-based downgrade.

An honestly unresolved `CRITICAL` or `HIGH` item can receive
`DESIGN_REVIEW_PASS` only when every mandatory field is structurally complete
and the classification/rationale, uncertainty, evidence gap/status, planned
validation, residual risk, owner, dependencies, `UNRESOLVED` closure, and
every downstream block are explicit. A `CLASSIFICATION_REQUIRED` item can
receive `DESIGN_REVIEW_PASS` only when the artifact schema is valid, the
uncertainty or evidence deficiency is explicit, no normalization/conversion or
downgrade occurs, and all blocks remain active. Either state still prevents
`RISK_CLOSURE_PASS`.

Design review fails on a missing or malformed mandatory field, orphan or
duplicate ID, unresolved internal contradiction, concealed gap, invented or
unsupported evidence, silent normalization, prohibited conversion or
downgrade, missing closure/block, missing mandatory downstream block, or false
claim that design evidence proves effectiveness.

## 2. Exact protected source register

Every source is read-only. `SRC-*` is the exact citation namespace for this
artifact. A row citation such as `SRC-07:RQ-A12` binds the path, SHA-256, and
named source location below.

| ID | Protected source | SHA-256 | Bound material |
| --- | --- | --- | --- |
| `SRC-01` | [AGENTS.md](../../AGENTS.md) | `b63f5852b6ffa3f3ed6286de27d3258ebc22b73e65276d9f6683a5d1562f0063` | public-only boundary; review order; no implementation before architecture |
| `SRC-02` | [SECURITY.md](../../SECURITY.md) | `618b2479ff8b859eb27485d3a3a2f150a94fb10c0b92b64df1586cfd2af36ed7` | vulnerability and fail-closed security expectations |
| `SRC-03` | [goal.md](../implementation/goal.md) | `4d7056f7c35b5ef9c0930486109b700f54aaf9d65e741f990f54960c7593a685` | A12, F06, S01, S04, and nonauthority scope |
| `SRC-04` | [task-manifest.yaml](../implementation/task-manifest.yaml) | `526b92ba9a74f0a52847fa753bd36d6ffa2857fe13c8baf3a5099be218025e54` | A12 dependencies/gates/state and A13/downstream graph |
| `SRC-05` | [status.md](../implementation/status.md) | `60a4cf617f1837f59879e3855ccf47f5e35980f63f38c679f00104b0efd62cb3` | accepted E-0056 R2 current state, exact owner authorization scope, retained nine-block set, failed E-0056 R1 history, and explicit nonauthority; source provenance only, not current R5 identity |
| `SRC-06` | [evidence-ledger.md](../implementation/evidence-ledger.md) | `1b1db5956fdb42b91692d15638906d079ca85bf80074fcfef0cb4018b6ffb1cb` | accepted E-0056 R2 owner source and amendment semantics, retained nine-block set, failed E-0056 R1 review chain, and nonauthorities; current R5 uses that accepted governance contract without inheriting an old revision identity |
| `SRC-07` | [requirements-traceability-v3.md](./requirements-traceability-v3.md) | `6f2672bdaabe8dd3fa07cbdc7f6d26e6cfcd12f9c7040927db83ede8d2cc1c6d` | `RQ-A12`, threat-to-test requirement |
| `SRC-08` | [system-trust-boundaries-v3.md](./system-trust-boundaries-v3.md) | `9ac203dd631bd070605e33ae904ad5441ce0d7962524cfbda9abfc384c3805fc` | `TB-*`, `DC-*`, `AP-*`, crossings, A12 boundary threats |
| `SRC-09` | [data-deletion-lifecycle-v3.md](./data-deletion-lifecycle-v3.md) | `a2a65f9132f1683242943732d483eb1cd0e80c57a8e68db6090b3d953e9ad3d8` | lifecycle, races, holds, restore, `LTH-*` |
| `SRC-10` | [governed-decision-path-v3.md](./governed-decision-path-v3.md) | `a013ba4886c77f401afc028f4ff2c99f19ec181541de58d65bd94fee798877af` | governed ordering, TOCTOU, provider/tool/result separation |
| `SRC-11` | [experimental-learning-promotion-v3.md](./experimental-learning-promotion-v3.md) | `e64c03ecaa7a4d875e021e8711fc4ed2397eb5a50e22e8405c5be7c1e50718d8` | inert learning, isolation, promotion, rollback |
| `SRC-12` | [independent-system-boundary-v3.md](./independent-system-boundary-v3.md) | `d0c90e13d59324b706db00376c8661a89d5dd4aed053dff3a8d80691b7fe8d4a` | public/private dependency direction and no reverse egress |
| `SRC-13` | [erasable-payload-adr-v3.md](./erasable-payload-adr-v3.md) | `d1e5f2a4b5e49b604273ebab7cd70520040b33ba55ebb87e5472a77e2903c0c1` | erasability, key lifecycle, restore, threat/control register |
| `SRC-14` | [tenant-isolation-adr-v3.md](./tenant-isolation-adr-v3.md) | `5e79d1ff11774c18d9e3b5175e76c72add2c473bbde035ded41c785aed3ce8ce` | tenant planes, `TI-*`, isolation threats and evidence |
| `SRC-15` | [policy-order-and-tool-authorization-adr-v3.md](./policy-order-and-tool-authorization-adr-v3.md) | `479efdd7668aa78db0397b1b8778232fe39e1564b8c0aaf4de6dbd9fe157c4ae` | `A09-TH*`, provider, SSRF, tool, MCP, policy order |
| `SRC-16` | [versioning-and-receipt-adr-v3.md](./versioning-and-receipt-adr-v3.md) | `9b777af8ac3a1b03ca69110233204dab78218eca8ff0588d85e4552b31da0718` | version tuple, receipt chain, replay, key roles |
| `SRC-17` | [core-semantic-adr-set-v3.md](./core-semantic-adr-set-v3.md) | `ea9c9ec2b1dd81d5d8f656f5dc3b349c32882a7dc8c53af2f8fb7a3a5b557b97` | core semantic, adapter, serverless, causal, experimental, MCP contracts |
| `SRC-18` | [ownership-and-provenance.md](../governance/ownership-and-provenance.md) | `329f7265cda4bfb351b2c9f0b9986e972fc9ee2f1cbee3b614b0f1f365d14156` | public provenance and ownership limits |
| `SRC-19` | [hg1-human-decision-packet.md](../governance/hg1-human-decision-packet.md) | `0f7d48b0fa265f5442a615213ea7eb6271334040fe4f8a2004c24c445084ed71` | exact R5/HG1-RP01, `HG1-D15-A`, `HG1-D16-A`, all-A, `NONE` |
| `SRC-20` | [hg2-human-decision-packet.md](../governance/hg2-human-decision-packet.md) | `2b2d92363d66dd264e0b5beba08d7710e3b52550b75c6e28b37b54048c58da14` | exact R7/HG2-RP01, synthetic-only, deletion/privacy, learning/export disabled |
| `SRC-21` | [hg3-human-decision-packet.md](../governance/hg3-human-decision-packet.md) | `efb28005a11cb3244e2014db23a49d97d7675de22d6f427010dbd41e4ff54c13` | exact HG3-RP01 provider/tool/MCP limits |
| `SRC-22` | [hg4-human-decision-packet.md](../governance/hg4-human-decision-packet.md) | `20c05b92db9e8a6c91b03e539d41f0c7d3c6b715e6e5ea47ebdd4b487c39b8df` | exact HG4-RP01 design-only/nonoperational limits |

## 3. Closed schemas and fixed rating rubric

### 3.1 Stable ID namespaces

| Object | Closed pattern | Meaning |
| --- | --- | --- |
| Threat | `TH-01`…`TH-18` | hostile or accidental condition |
| Privacy risk | `PR-01`…`PR-18` | privacy/linkage/purpose consequence |
| Abuse case | `AB-01`…`AB-18` | actor-capability scenario |
| Security invariant | `INV-01`…`INV-16` | required system truth |
| Control | `CTL-nn-P`, `CTL-nn-D`, `CTL-nn-R` | prevention, detection, recovery |
| Residual risk | `RR-01`…`RR-18` | risk after proposed controls |
| Validation | `VAL-01`…`VAL-18`, `SF-*`, `AT-*` | negative/adversarial evidence design |
| Asset/actor/etc. | `AST-*`, `ACT-*`, `IDN-*`, `DAT-*`, `ZN-*`, `EP-*`, `OP-*`, `BND-*`, `FLW-*` | scope registers below |

An ID is defined exactly once. A reference to an undefined or duplicate ID is
invalid and blocks.

### 3.2 Fixed severity calculation

Severity values are exactly:

| Value | Fixed impact rule |
| --- | --- |
| `CRITICAL` | credible cross-tenant compromise; authority/effect escape; irreversible or broad secret/key exposure; systemic deletion defeat; or production/experimental boundary escape |
| `HIGH` | material single-tenant confidentiality/integrity/availability/privacy loss; durable policy/receipt corruption; privileged abuse; or bounded external exfiltration |
| `MEDIUM` | bounded, recoverable degradation or low-volume disclosure without authority expansion, durable corruption, or cross-tenant effect |
| `LOW` | negligible content-free impact, promptly recoverable, with no sensitive inference or authority consequence |

Likelihood is exactly `LIKELY`, `POSSIBLE`, or `REMOTE`. Uncertainty is exactly
`HIGH`, `MEDIUM`, or `LOW`. The severity calculation takes the highest
applicable fixed impact rule; likelihood never lowers impact severity.
Uncertainty raises evidence requirements and never lowers severity.

Inherent and residual severity are calculated independently. A downgrade
requires independent evidence, the fixed calculation, prior and resulting
severity, rationale, reviewer, and exact evidence trace. No runtime evidence
exists in R5, so no row is downgraded. Proposed controls do not alter residual
severity.

### 3.3 Classification defects and closure

Each of missing, unknown, ambiguous, conflicting, malformed, unmapped, and
unsupported severity is `CLASSIFICATION_REQUIRED`, remains `UNRESOLVED`, and
blocks as critical/high for both inherent and residual analysis. Closure is
not a conversion. `EVIDENCE_CLOSED` requires independently verified evidence
for prevention, detection, recovery, and the negative validation result.

## 4. Scope registers

### 4.1 Assets

| ID | Asset |
| --- | --- |
| `AST-01` | identity, membership, role, delegation, workload capability, and tenant authority |
| `AST-02` | purpose, policy, approval, lifecycle, revision, deletion, and authorization epochs |
| `AST-03` | canonical events, observations, beliefs, memory, tasks, results, receipts, and status |
| `AST-04` | erasable payloads, keys, wrapped keys, tombstones, and deletion evidence |
| `AST-05` | vectors, graphs, caches, contexts, candidates, and embeddings |
| `AST-06` | provider request/output, model/region/destination binding, and transmission authority |
| `AST-07` | tool intent, arguments, credentials, effect latch, outcome, and reconciliation |
| `AST-08` | Managed MCP templates, cursor, bounded result, and SELECT-only identity |
| `AST-09` | queues, claims, leases, fences, attempts, idempotency, outbox/inbox, and DLQ |
| `AST-10` | experimental export, sandbox, inert registry, evaluation, promotion, canary, and rollback |
| `AST-11` | source, dependency, build, signature, provenance, and review evidence |
| `AST-12` | availability, quotas, telemetry, budgets, recovery, backup, and restore |

### 4.2 Zones, actors, and identities

| Zone | Actors | Identity/authority rule |
| --- | --- | --- |
| `ZN-00` untrusted client | `ACT-01` public client, `ACT-02` attacker | `IDN-01` client/token is input, never tenant authority |
| `ZN-01` identity/ingress | `ACT-03` Cognito, `ACT-04` API | `IDN-02` authenticated principal proves identity only |
| `ZN-02` production control | `ACT-05` tenant resolver/policy/orchestrator | `IDN-03` server tenant plus immutable subject mode owns admission |
| `ZN-03` canonical/derived | `ACT-06` CRDB, `ACT-07` DVI/cache | `IDN-04` tenant-qualified DB role; derived state grants no authority |
| `ZN-04` async compute | `ACT-08` Lambda/SQS worker | `IDN-05` workload/capability plus immutable origin; queue is not authority |
| `ZN-05` key/secret | `ACT-09` KMS/secret custodian | `IDN-06` operation- and key-scoped identity; no plaintext custody claim |
| `ZN-06` external processing | `ACT-10` Bedrock adapter/service | `IDN-07` class/destination-scoped adapter; output untrusted |
| `ZN-07` tools | `ACT-11` authorizer/executor/target | `IDN-08` exact tool capsule; effectful catalogue is empty |
| `ZN-08` MCP | `ACT-12` Steward/Managed MCP | `IDN-09` authenticated same-synthetic-tenant purpose-bound SELECT-only design |
| `ZN-09` privileged delivery | `ACT-13` operator, `ACT-14` CI/reviewer, `ACT-15` key custodian | `IDN-10` separate least-privilege identities; no implicit content access |
| `ZN-X` experimental | `ACT-16` sandbox/evaluator/promoter | `IDN-11` physically isolated design identity; no production-write/reverse route |

Insider capability variants are `CAP-MALICIOUS`, `CAP-COERCED`,
`CAP-NEGLIGENT`, and `CAP-COMPROMISED`. Collusion is an explicit prerequisite,
not an assumed role merger.

### 4.3 Data, entry points, protected operations, boundaries, and flows

| ID | Definition |
| --- | --- |
| `DAT-01` | credentials, tokens, keys, wrapped keys, secrets (`DC-A`, `DC-G`) |
| `DAT-02` | client/payload/provider/tool/MCP content (`DC-B`, `DC-H`, `DC-I`, `DC-J`, `DC-O`) |
| `DAT-03` | content-free tenant/purpose/version/fence/control metadata (`DC-C`, `DC-M`, safe `DC-N`) |
| `DAT-04` | canonical facts/results and erasable bodies (`DC-D`) |
| `DAT-05` | ID-only durable work (`DC-E`) |
| `DAT-06` | derived vectors/contexts/candidates (`DC-F`) |
| `DAT-07` | code/config/provenance (`DC-K`) |
| `DAT-08` | minimized experimental export (`DC-L`) |
| `EP-01` | public API request; `EP-02` queue/retry/DLQ; `EP-03` DB/vector/cache query |
| `EP-04` | provider/embedding send; `EP-05` tool intent/target; `EP-06` MCP template/cursor |
| `EP-07` | operator/CI/key action; `EP-08` deletion/correction/restore; `EP-09` learning import/promotion |
| `OP-01` | authenticate and resolve tenant/purpose/mode; `OP-02` search/retrieve/compile |
| `OP-03` | decrypt/release/persist; `OP-04` provider transmit/admit; `OP-05` tool reserve/execute/reconcile |
| `OP-06` | MCP read; `OP-07` delete/correct/hold/purge; `OP-08` backup/restore/reingest |
| `OP-09` | key use/rotate/revoke/destroy; `OP-10` export/import/evaluate/promote/rollback |
| `OP-11` | issue/verify/reconstruct receipt; `OP-12` operate/recover/review |
| `BND-01` | client→Cognito/API; `BND-02` API→server authority; `BND-03` compute→canonical/derived state |
| `BND-04` | compute→KMS; `BND-05` policy→provider; `BND-06` tool authorization→executor/target |
| `BND-07` | Steward→Managed MCP; `BND-08` production→experimental; `BND-09` operator/CI→control plane |
| `FLW-01` | request/admission; `FLW-02` canonical transaction/outbox; `FLW-03` async claim/retry/result |
| `FLW-04` | authorized retrieval/context; `FLW-05` provider transmission/result; `FLW-06` tool effect/outcome |
| `FLW-07` | deletion/purge/restore; `FLW-08` MCP read/pagination; `FLW-09` export/import/promotion |

Tenant is exactly `SERVER_TENANT`; purpose is exactly a server-authorized
purpose; operation is one `OP-*`. A row saying `cross-tenant` or
`cross-purpose` describes the attack, never permitted scope.

## 5. Security invariant register

| ID | Required invariant | Primary sources |
| --- | --- | --- |
| `INV-01` | tenant, purpose, mode, origin, principal, workload, capability, and epochs are server-bound and conjunctive | `SRC-08:AP-04/AP-05`; `SRC-14:TI-AT-01/02` |
| `INV-02` | pre-search authorization precedes retrieval; fresh authorization precedes transmission and every sensitive effect | `SRC-10:ordering`; `SRC-15:A09-INV/A09-TH18` |
| `INV-03` | canonical state owns authority; vector/cache/context/model output never does | `SRC-08:TB-05/TB-06`; `SRC-17:core semantics` |
| `INV-04` | queue/retry/takeover preserves immutable origin and cannot refresh authority | `SRC-08:DC-E`; `SRC-14:TI-AT-06/11` |
| `INV-05` | deletion/correction/key/policy epochs monotonically fence every release, send, effect, reuse, and restore | `SRC-09:LTH-05/06/07/08/11`; `SRC-13` |
| `INV-06` | immutable facts are content-free; sensitive bodies and derivatives are erasable | `SRC-09`; `SRC-13`; `SRC-16` |
| `INV-07` | KMS ambiguity/outage/timeout/throttle/revocation fails closed with no recovery fallback | `SRC-09:LTH-02`; `SRC-13` |
| `INV-08` | external destination, DNS result, redirect, class, model, region, credential, and egress are exact and independently rechecked | `SRC-08:TB-08/TB-09`; `SRC-15:A09-TH05/07/08` |
| `INV-09` | provider output, tool result, MCP result, imported artifact, and model text are untrusted and non-authoritative | `SRC-10`; `SRC-15`; `SRC-17` |
| `INV-10` | second provider/failover/racing/hedging/retry and all effectful tools are disabled | `SRC-15:A09-TH10/12`; `SRC-21:HG3-RP01` |
| `INV-11` | MCP is limited to three approved summaries, exact tenant/purpose/template/cursor, bounded redaction, and SELECT-only design | `SRC-15:MCP contract`; `SRC-21:HG3-RP01` |
| `INV-12` | learning/export is disabled; experimental plane has no reverse/production-write path; imports remain inert | `SRC-11`; `SRC-20:HG2-RP01`; `SRC-22:HG4-RP01` |
| `INV-13` | receipts bind exact versions, sequence, predecessor, domain, attempt, tenant, purpose, and current limitations | `SRC-16` |
| `INV-14` | operators, service identities, reviewers, and key custodians are separate, least-privilege, audited, and cannot self-close | `SRC-08:TB-15`; `SRC-19:HG1-D18-A`; `SRC-20` |
| `INV-15` | provenance/signature/dependency/revision ambiguity blocks import, promotion, review carry, and release | `SRC-01`; `SRC-11`; `SRC-18` |
| `INV-16` | unknown, unavailable, conflicting, partial, or stale control state denies without oracle or optimistic success | all sources; especially `SRC-14:TI-F-16` |

## 6. Complete risk-case register

### 6.1 Row schema

Every `CASE-*` row below defines, in order:

- stable threat/privacy/abuse/residual/validation IDs and taxonomy;
- actor, capability, prerequisites, and concrete scenario;
- asset, data class, tenant, purpose, operation, zone, boundary, and flow;
- inherent severity, likelihood, uncertainty, fixed-rubric rationale;
- separately identified prevention, detection, and recovery controls;
- negative test/evaluation, expected fail-closed result, evidence, evidence
  status;
- residual severity, owner, dependencies, closure, downstream block; and
- exact source citations.

Evidence status is `DESIGN_ONLY_UNEXECUTED` unless stated otherwise. This is
not runtime evidence and cannot produce `EVIDENCE_CLOSED`.

The mandatory downstream-block value for every row is `BLOCK-ALL`, defined
exactly as the nine-member set: `RISK_CLOSURE_PASS`, S04 closure, operational
activation, deployment, release, production, A13 readiness, A13 selection, and
A13 completion. Each row's literal `blocks` (including `blocks all named
gates`) is its explicit `BLOCK-ALL` value. No partial block, row-local
exception, or design-PASS conversion exists. Removing A12 completion and
Architecture design-freeze from `BLOCK-ALL` does not complete A12, freeze the
architecture, remove an A13 block, or create operational authority.

### 6.2 Detailed rows

| Case and taxonomy | Actor/capability/prerequisites/scenario | Scope: asset; data; tenant; purpose; operation; zone; boundary; flow | Rating and rationale | Separate controls | Negative validation and evidence | Residual, owner, dependencies, closure/block, citations |
| --- | --- | --- | --- | --- | --- | --- |
| `CASE-01`; `TH-01`; `PR-01`; `AB-01`; STRIDE S/E, purpose/privacy | `ACT-02` or compromised `ACT-08`; forged tenant/mode/delegation; stale or caller-selected authority enters search/write/effect as another tenant or purpose | `AST-01/02/03`; `DAT-03/04`; cross-tenant tenant scope; cross-purpose purpose scope; `OP-01/02/03`; `ZN-00/02/04`; `BND-01/02/03`; `FLW-01/02/04` | inherent `CRITICAL`; `POSSIBLE`; uncertainty `MEDIUM`; fixed rule: cross-tenant authority and content compromise | `CTL-01-P`: `INV-01/02` server binding and structural tenant keys; `CTL-01-D`: audit exact mode/epoch mismatches without oracle; `CTL-01-R`: revoke origin, fence tenant, quarantine affected work | `VAL-01`: forge every tenant/mode/principal/workload/purpose combination and race revocation; expected DENY/zero read/write/effect/uniform error; evidence: future S01/TI tests; `DESIGN_ONLY_UNEXECUTED` | `RR-01` `CRITICAL`; owner A08/C02/S01; deps A02/A04/A08/A09; `UNRESOLVED`; blocks all named gates; `SRC-07:RQ-A12`, `SRC-08:AP-04/05`, `SRC-14:TI-AT-01..04` |
| `CASE-02`; `TH-02`; `PR-02`; `AB-02`; STRIDE E/S, insider | malicious/coerced/negligent/compromised `ACT-13/14/15` or service identity, alone or colluding; excess role/key/reviewer authority bypasses policy or self-closes evidence | `AST-01/04/11`; `DAT-01/03/07`; server tenant; security/review purpose only; `OP-09/12`; `ZN-09`; `BND-09/04`; `FLW-02/07` | inherent `CRITICAL`; `POSSIBLE`; `HIGH`; privileged authority/key/provenance compromise can defeat isolation and deletion | `CTL-02-P`: `INV-14` separation, least privilege, dual control, no self-review; `CTL-02-D`: independent audit/immutable content-free receipts; `CTL-02-R`: revoke identities/keys, freeze actions, independent re-review | `VAL-02`: fixtures for each insider capability and operator/service/reviewer/custodian collusion; expected zero unauthorized access/key use/closure; evidence future IAM/KMS/review tests; `DESIGN_ONLY_UNEXECUTED` | `RR-02` `CRITICAL`; owners A01/A10/HG-5/S04; deps operational identities and keys; `UNRESOLVED`; blocks; `SRC-08:TB-15`, `SRC-16:key roles`, `SRC-19:HG1-D18-A`, `SRC-20:HG2-D14` |
| `CASE-03`; `TH-03`; `PR-03`; `AB-03`; STRIDE T/R | attacker replays, splices, rolls back, truncates, forks, or grafts request/receipt/approval/attempt bytes across tenant, purpose, chain, provider, tool, or version | `AST-02/03/06/07`; `DAT-03/04`; cross-tenant tenant scope; cross-purpose purpose scope; `OP-04/05/11`; `ZN-02/06/07`; `BND-05/06`; `FLW-05/06` | inherent `HIGH`; `POSSIBLE`; `LOW`; durable integrity and repudiation failure | `CTL-03-P`: `INV-02/13` exact version/domain/sequence/predecessor/attempt; `CTL-03-D`: deterministic verifier and fork/gap detection; `CTL-03-R`: invalidate/supersede and append limitation without rewriting history | `VAL-03`: replay/splice/rollback/fork vectors across every bound field; expected INVALID/UNKNOWN and zero send/effect/current-success; evidence future A10/E08; `DESIGN_ONLY_UNEXECUTED` | `RR-03` `HIGH`; owner A10/E08; deps crypto/canonicalization/HG-5; `UNRESOLVED`; blocks; `SRC-16:§6/8/10`, `SRC-19:HG1-D08-A..D14-A` |
| `CASE-04`; `TH-04`; `PR-04`; `AB-04`; STRIDE T/I, deletion/privacy | worker/provider/tool/cache races deletion, correction, authorization, key, policy, revision, or epoch; stale allow releases/sends/effects or recreation reuses old identity | `AST-02/04/05/06/07/09`; `DAT-02/03/04/06`; server tenant; approved purpose; `OP-02..09`; `ZN-02..08`; `BND-03..07`; `FLW-02..08` | inherent `CRITICAL`; `LIKELY`; `MEDIUM`; systemic deletion/authority defeat | `CTL-04-P`: `INV-05` same-transaction and immediately-before-use fence rechecks; `CTL-04-D`: stale-attempt conflict and reconciliation obligations; `CTL-04-R`: tombstone, revoke, purge, supersede, quarantine | `VAL-04`: change each epoch before/concurrent/after every release/send/effect/commit; expected change-first zero action, action-first honest possible outcome plus purge; evidence future LTH/TI/A09 races; `DESIGN_ONLY_UNEXECUTED` | `RR-04` `CRITICAL`; owners A03/A07/A09/R01-R03/S01; deps implementation/restore evidence; `UNRESOLVED`; blocks; `SRC-07:RQ-A12`, `SRC-09:LTH-05..08/12/15/17`, `SRC-15:A09-TH18` |
| `CASE-05`; `TH-05`; `PR-05`; `AB-05`; STRIDE T/I, resurrection/retention | backup-local or RPO-gapped state, stale keys, replay, re-ingestion, or identifier recreation resurrects deleted/corrected content or lineage | `AST-04/12`; `DAT-03/04`; server tenant; restore/recovery purpose; `OP-07/08`; `ZN-03/05/09`; `BND-03/04/09`; `FLW-07` | inherent `CRITICAL`; `POSSIBLE`; `HIGH`; deletion defeat and durable privacy harm | `CTL-05-P`: global current journal, tombstone/key currency, quarantine-before-release, old-ID denial; `CTL-05-D`: restore reconciliation and completeness evidence; `CTL-05-R`: re-delete, revoke key, quarantine restore, append limitation | `VAL-05`: stale/RPO-gap/missing-crossing/reingestion fixtures; expected quarantine and no release; evidence future R03/S07; `DESIGN_ONLY_UNEXECUTED` | `RR-05` `CRITICAL`; owner C10/R03/HG-5; deps backup/RPO/KMS unresolved; `UNRESOLVED`; blocks; `SRC-09:LTH-11`, `SRC-13:restore`, `SRC-20:HG2-D12/D13` |
| `CASE-06`; `TH-06`; `PR-06`; `AB-06`; STRIDE D/I, KMS/availability | KMS outage, partial result, timeout, throttle, stale key state, unavailable revocation, ambiguous commit, or recovery pressure triggers plaintext/static-key/stale-key/fail-open fallback | `AST-04/12`; `DAT-01/04`; server tenant; decrypt/delete/recovery purpose; `OP-03/09`; `ZN-03/05`; `BND-04`; `FLW-02/07` | inherent `CRITICAL`; `POSSIBLE`; `HIGH`; secret exposure or unverifiable deletion | `CTL-06-P`: `INV-07` deny all ambiguous/unavailable outcomes and forbid alternate key/plaintext path; `CTL-06-D`: content-free KMS outcome and reconciliation alarm; `CTL-06-R`: quarantine, resolve KMS outcome, rotate/revoke under dual control | `VAL-06`: outage/partial/timeout/throttle/stale/revocation-unavailable/ambiguous fixtures; expected no plaintext, no success, no fallback; evidence future C05/C10/HG-5; `DESIGN_ONLY_UNEXECUTED` | `RR-06` `CRITICAL`; owner A07/C05/C10/HG-5; operational KMS absent; `UNRESOLVED`; blocks; `SRC-07:RQ-A12`, `SRC-09:LTH-02`, `SRC-13`, `SRC-20:HG2-PD10` |
| `CASE-07`; `TH-07`; `PR-07`; `AB-07`; STRIDE I/E, SSRF | prompt/tool/provider/import input coerces fetch to metadata, loopback, link-local, private address; uses redirects, DNS rebinding, alternate encoding, resolver race, proxy or egress bypass | `AST-01/06/07/12`; `DAT-01/02`; server tenant; exact external-processing/tool purpose; `OP-04/05`; `ZN-02/06/07`; `BND-05/06`; `FLW-05/06` | inherent `CRITICAL`; `POSSIBLE`; `MEDIUM`; credential/control-plane exfiltration and pivot | `CTL-07-P`: `INV-08` fixed destination/class, canonical DNS/IP validation at connect, redirect deny, private/metadata/loopback/link-local deny, egress allowlist, no generic fetch; `CTL-07-D`: zero-content denial counters and destination-policy drift alarm; `CTL-07-R`: stop adapter, revoke credential, isolate workload | `VAL-07`: explicit fixtures for every destination and bypass subcase, DNS answer change and encoding; expected zero egress/credential release/uniform denial; evidence future A09-AT10/S01; `DESIGN_ONLY_UNEXECUTED` | `RR-07` `CRITICAL`; owner A09/E07/F06/S01; network/IAM implementation absent; `UNRESOLVED`; blocks; `SRC-03:A12/F06/S01`, `SRC-07:RQ-A12`, `SRC-15:A09-TH07/A09-AT10` |
| `CASE-08`; `TH-08`; `PR-08`; `AB-08`; STRIDE I, exfiltration | sensitive prompt/memory/context/secret/credential/ref/detector material reaches provider, embedding, error, log, receipt, telemetry, or correlation field | `AST-03/04/05/06`; `DAT-01/02/04/06`; server tenant/purpose; `OP-02/04/11`; `ZN-02/06/09`; `BND-05/09`; `FLW-04/05` | inherent `HIGH`; `POSSIBLE`; `MEDIUM`; bounded external or durable disclosure | `CTL-08-P`: pre-search minimization, AP-11 final DLP, exhaustive forbidden fields, adapter-local auth; `CTL-08-D`: content-oracle/redaction scans; `CTL-08-R`: stop send, revoke, purge erasable derivatives, record limitation | `VAL-08`: canary secrets in every forbidden field/error/log/receipt path; expected deny/drop and no copied/digested rejected bytes; evidence future E02/E07/S03; `DESIGN_ONLY_UNEXECUTED` | `RR-08` `HIGH`; owner A09/E07/A10/S03; deps DLP/telemetry implementation; `UNRESOLVED`; blocks; `SRC-08:DC-H/O/TB-16`, `SRC-09:LTH-03/14`, `SRC-15:A09-TH05/08/19` |
| `CASE-09`; `TH-09`; `PR-09`; `AB-09`; STRIDE T/E, prompt injection | tenant/retrieved/provider/MCP text instructs policy bypass, authority cast, secret/tool use, false evidence, or cross-purpose retrieval; model output is treated as authorization | `AST-02/03/05/06/07`; `DAT-02/06`; server tenant/purpose; `OP-02/04/05`; `ZN-00/02/06/07/08`; `BND-02/05/06/07`; `FLW-04/05/06/08` | inherent `CRITICAL`; `LIKELY`; `LOW`; model-driven authority/effect escape | `CTL-09-P`: `INV-02/03/09`, typed non-castable authority, source labeling, deterministic compiler, separate tool authorization; `CTL-09-D`: injection corpus and policy-decision trace; `CTL-09-R`: discard output, invalidate context, quarantine source | `VAL-09`: direct/indirect/multilingual/encoded/context/tool/MCP injections; expected output non-authority, zero policy cast/send/effect; evidence future D11/S01; `DESIGN_ONLY_UNEXECUTED` | `RR-09` `CRITICAL`; owner D10/D11/A09/S01; implementation absent; `UNRESOLVED`; blocks; `SRC-03:A12/S01`, `SRC-10`, `SRC-15:A09-TH11`, `SRC-17` |
| `CASE-10`; `TH-10`; `PR-10`; `AB-10`; STRIDE E/I/D, tool/MCP | caller/model/provider forges tool capability or approval, injects credential/ref, registers implicit tool, issues arbitrary MCP SQL, tampers/replays cursor, enumerates counts/timing, or exhausts pagination | `AST-07/08/12`; `DAT-01/02/03`; server tenant/purpose; `OP-05/06`; `ZN-07/08`; `BND-06/07`; `FLW-06/08` | inherent `CRITICAL`; `POSSIBLE`; `LOW`; unauthorized effect or cross-tenant read | `CTL-10-P`: `INV-10/11`, empty effectful catalogue, exact capsule, three templates, SELECT-only, cursor scope/expiry/bounds; `CTL-10-D`: approval/cursor/template mismatch audit and quota counters; `CTL-10-R`: burn attempt/cursor, stop executor/template | `VAL-10`: forged/expired/mismatched approval, implicit tool, arbitrary SQL, mutation, cross-tenant cursor, timing/count/export fixtures; expected zero effect/query and uniform denial; evidence future F06/R04/S01; `DESIGN_ONLY_UNEXECUTED` | `RR-10` `CRITICAL`; owners A09/F06/R04; effect/MCP runtime disabled; `UNRESOLVED`; blocks; `SRC-15:A09-TH12..17`, `SRC-21:HG3-RP01` |
| `CASE-11`; `TH-11`; `PR-11`; `AB-11`; STRIDE T/E, poisoning/import | untrusted, poisoned, malformed, oversized, cyclic, schema-confused or executable import; bad provenance/signature; rollback; dependency confusion; promotion bypass; candidate becomes authority | `AST-05/10/11`; `DAT-06/07/08`; server synthetic tenant; evaluation purpose only; `OP-10`; `ZN-X/09`; `BND-08/09`; `FLW-09` | inherent `CRITICAL`; `POSSIBLE`; `HIGH`; durable semantic/registry/supply-chain compromise | `CTL-11-P`: `INV-09/12/15`, inert declarative schema, exact source/signature/version, sandbox, no executable hooks, signed promotion and no reverse path; `CTL-11-D`: poison/schema/provenance/rollback/dependency scans; `CTL-11-R`: reject/quarantine/revoke candidate and rollback under separate authority | `VAL-11`: every unsafe-import category plus candidate-authority/promotion-bypass fixtures; expected inert rejection, no production write/promotion; evidence future X07/S01/S04; `DESIGN_ONLY_UNEXECUTED` | `RR-11` `CRITICAL`; owners A05/A11/HG-4/X07; learning/export disabled; `UNRESOLVED`; blocks; `SRC-07:RQ-A12`, `SRC-11`, `SRC-17`, `SRC-22:HG4-RP01` |
| `CASE-12`; `TH-12`; `PR-12`; `AB-12`; STRIDE T/R, supply chain | malicious dependency/build/plugin/generated file, unsigned or stale artifact, source substitution, review carry, license/provenance gap, or CI identity compromise enters release | `AST-11`; `DAT-07`; public-workspace tenant scope only; build/review purpose; `OP-12`; `ZN-09`; `BND-09`; `FLW-02` | inherent `HIGH`; `POSSIBLE`; `MEDIUM`; code/provenance compromise | `CTL-12-P`: exact source allowlist/hash, dependency direction, signed provenance, clean review restart, no private import; `CTL-12-D`: SBOM/license/secret/SAST/hash/inventory scans; `CTL-12-R`: quarantine artifact, revoke CI identity, rebuild/re-review from exact sources | `VAL-12`: substitution, lock drift, dependency confusion, generated-file, signature, review-carry fixtures; expected build/review stop; evidence future B03/B05; `DESIGN_ONLY_UNEXECUTED` | `RR-12` `HIGH`; owners A01/B03/B05; CI not implemented; `UNRESOLVED`; blocks; `SRC-01`, `SRC-12`, `SRC-18` |
| `CASE-13`; `TH-13`; `PR-13`; `AB-13`; STRIDE D, availability | attacker or buggy client causes request/queue/vector/graph/MCP/provider/tool/KMS storms, pathological traversal/context, retry amplification, hot tenant, storage growth, or budget exhaustion | `AST-05/08/09/12`; `DAT-02/03/05/06`; server tenant/purpose; `OP-01/02/04/05/06/09`; `ZN-00..09`; `BND-01..09`; `FLW-01..09` | inherent `HIGH`; `LIKELY`; `MEDIUM`; material availability and cost impact | `CTL-13-P`: bounded sizes/depth/rows/time/concurrency/retry, tenant quotas/budgets, admission/backpressure, no ambiguous retry; `CTL-13-D`: per-tenant content-free saturation/cost/queue alarms; `CTL-13-R`: isolate tenant/class, drain/quarantine, reconcile attempts | `VAL-13`: limit+1, cyclic graph, pagination storm, timeout/lost-ack, KMS throttle, queue poison fixtures; expected bounded denial/no amplification; evidence future S01/S03/S07; `DESIGN_ONLY_UNEXECUTED` | `RR-13` `HIGH`; owners B04/C09/S03/HG-5; budgets/SLOs absent; `UNRESOLVED`; blocks; `SRC-03:S03/S07`, `SRC-14:TI-TH resource`, `SRC-15:A09-TH17` |
| `CASE-14`; `TH-14`; `PR-14`; `AB-14`; STRIDE I, privacy inference/linkage | attacker enumerates opaque IDs, tenant/resource existence, counts, timing, similarity, cache hits, vector neighborhoods, MCP pages, telemetry correlation or deletion status; links identities/purposes | `AST-03/05/08/12`; `DAT-03/06`; cross-tenant/purpose; `OP-02/06/11`; `ZN-00/03/08/09`; `BND-01/03/07/09`; `FLW-04/08` | inherent `HIGH`; `LIKELY`; `HIGH`; tenant/content/linkage privacy disclosure | `CTL-14-P`: structural scope, opaque random IDs, uniform errors/timing classes, bounded counts/redaction, no negative cache oracle; `CTL-14-D`: enumeration/rate/correlation detection with content-free telemetry; `CTL-14-R`: revoke cursor/cache, rotate opaque handles, tighten bounds | `VAL-14`: existent/nonexistent/cross-tenant timing/count/similarity/cursor/correlation fixtures; expected indistinguishable bounded denial; evidence future A08/R04/S01; `DESIGN_ONLY_UNEXECUTED` | `RR-14` `HIGH`; owners A08/R04/S03; quantitative privacy evidence absent; `UNRESOLVED`; blocks; `SRC-14:TI-AT-09/14/15/21`, `SRC-15:A09-TH15..17`, `SRC-20` |
| `CASE-15`; `TH-15`; `PR-15`; `AB-15`; STRIDE I/T, retention/deletion | raw or reversible content, digest/fingerprint/equality oracle, detector match, free-form reason, prompt/output, or rejected bytes persist in immutable event/receipt/log/telemetry/backup beyond purpose | `AST-03/04/12`; `DAT-02/03/04`; server tenant/purpose; `OP-03/07/08/11`; `ZN-03/09`; `BND-03/09`; `FLW-02/07` | inherent `HIGH`; `POSSIBLE`; `MEDIUM`; durable privacy and deletion failure | `CTL-15-P`: `INV-06` closed immutable allowlists, separate encrypted erasable bodies, no payload backup, content-free rejection; `CTL-15-D`: forbidden-field/oracle/entropy scans and lifecycle inventory; `CTL-15-R`: purge erasable copies, destroy key, append limitation without false universal erasure | `VAL-15`: canary content in every immutable/log/error/backup field and equality probes; expected rejection/no durable oracle; evidence future A07/A10/R02/S03; `DESIGN_ONLY_UNEXECUTED` | `RR-15` `HIGH`; owners A03/A07/A10/R02; physical copies/backup evidence absent; `UNRESOLVED`; blocks; `SRC-09:LTH-03/14`, `SRC-13`, `SRC-16:§5`, `SRC-20:HG2-D07..13` |
| `CASE-16`; `TH-16`; `PR-16`; `AB-16`; STRIDE E/I, disabled external path | retry/timeout/model/operator silently enables second provider, failover, racing, hedging, effectful tool, learning export, real/personal data, or unapproved MCP query | `AST-06/07/08/10`; `DAT-02/08`; synthetic tenant only; exact RP01 purpose; `OP-04/05/06/10`; `ZN-06/07/08/X`; `BND-05..08`; `FLW-05/06/08/09` | inherent `CRITICAL`; `POSSIBLE`; `LOW`; disabled-path activation/external disclosure/effect | `CTL-16-P`: no route/credential/catalogue/queue/fallback, exact profile/class allowlist, tighten-only gates; `CTL-16-D`: startup/config/path inventory and denied-attempt counters; `CTL-16-R`: kill class, revoke identity, quarantine output | `VAL-16`: invoke every disabled class, ambiguity/retry/failover, real/mixed data and learning export; expected structurally unreachable or DENY; evidence future configuration/security tests; `DESIGN_ONLY_UNEXECUTED` | `RR-16` `CRITICAL`; owners HG-2/HG-3/HG-4/HG-5; operational evidence absent; `UNRESOLVED`; blocks; `SRC-20:HG2-RP01`, `SRC-21:HG3-RP01`, `SRC-22:HG4-RP01` |
| `CASE-17`; `TH-17`; `PR-17`; `AB-17`; STRIDE S/T/E, concurrency | forged queue, duplicate/reordered message, stale lease/fence, takeover, DLQ replay, claim-owner/workload substitution, lost acknowledgement, ambiguous provider/tool outcome causes duplicate work or effect | `AST-01/02/07/09`; `DAT-03/05`; server tenant/purpose; `OP-03/04/05`; `ZN-04/06/07`; `BND-03/05/06`; `FLW-02/03/05/06` | inherent `CRITICAL`; `POSSIBLE`; `MEDIUM`; duplicate external effect or authority replay | `CTL-17-P`: `INV-04`, ID-only work, atomic single-winner claim/fence, exact attempt/idempotency, no ambiguous retry; `CTL-17-D`: duplicate/reorder/stale/lost-ack reconciliation; `CTL-17-R`: burn attempt, quarantine unknown outcome, reconcile without claiming no effect | `VAL-17`: concurrency schedules for enqueue/claim/takeover/dispatch/result and lost ack; expected one winner, stale zero mutation, honest unknown; evidence future C07-C09/F09/S01; `DESIGN_ONLY_UNEXECUTED` | `RR-17` `CRITICAL`; owners C07-C09/F09; executable transactional evidence absent; `UNRESOLVED`; blocks; `SRC-08:DC-E/AP-06`, `SRC-09:LTH-04/17`, `SRC-14:TI-AT-06/11` |
| `CASE-18`; `TH-18`; `PR-18`; `AB-18`; STRIDE R/T, assurance | author/reviewer/model/operator marks proposed control or unexecuted test as closed, downgrades under pressure, hides a contradiction, claims compliance/certification/runtime proof, auto-completes A12, removes an A13 block, or claims design freeze without the separate exact owner decision and amendment | `AST-02/11`; `DAT-03/07`; public-governance tenant scope; governance purpose; `OP-12`; `ZN-09`; `BND-09`; `FLW-02` | inherent `HIGH`; `LIKELY`; `LOW`; governance/assurance corruption and premature freeze | `CTL-18-P`: closed severity/closure schema, exact hashes/citations, independent ordered review, no carry, exact nine-block set, no automatic successor, completion, or freeze; `CTL-18-D`: orphan/duplicate/contradiction/unsupported/normalization/block-set scanners; `CTL-18-R`: fail review, retain prior effective state, next revision full chain | `VAL-18`: classification defects, closure conversion, downgrade pressure, source mismatch, review carry, block-set drift, false compliance/completion/freeze fixtures; expected `CLASSIFICATION_REQUIRED` for defective fixtures or `UNRESOLVED` for open evidence, with exact `BLOCK-ALL`; `DESIGN_ONLY_UNEXECUTED` | `RR-18` `HIGH`; owner A12/Security/Chief; dependencies: accepted E-0056 R2 owner-authorized nine-block amendment as the satisfied governance prerequisite, independent Security exact-revision verification, future S01/S04 executed harness and red-team evidence per `HG1-D15-A`/`HG1-D16-A`, and evidence-backed closure review of the severity/closure schema, no-carry rule, contradiction handling, exact block set, and no-automatic-successor rule; the verification, execution, and closure-evidence dependencies remain outstanding and `BLOCK-ALL` continues until admissible evidence; `UNRESOLVED`; blocks; `SRC-01`, `SRC-05`, `SRC-06`, `SRC-19:HG1-D15-A/D16-A`, `SRC-22` |

## 7. Taxonomy and orphan-proof coverage

| Required class | Explicit rows |
| --- | --- |
| STRIDE Spoofing | `TH-01`, `TH-02`, `TH-17` |
| STRIDE Tampering | `TH-03`, `TH-04`, `TH-11`, `TH-12`, `TH-17`, `TH-18` |
| STRIDE Repudiation | `TH-03`, `TH-12`, `TH-18` |
| STRIDE Information disclosure | `TH-04`…`TH-10`, `TH-14`…`TH-16` |
| STRIDE Denial of service | `TH-06`, `TH-10`, `TH-13`, `TH-17` |
| STRIDE Elevation of privilege | `TH-01`, `TH-02`, `TH-09`…`TH-11`, `TH-16`, `TH-17` |
| privacy/purpose/retention/deletion | `PR-01`, `PR-04`…`PR-06`, `PR-14`…`PR-16` |
| linkage/inference/enumeration | `PR-14`; supporting `PR-10` |
| learning/promotion | `PR-11`, `PR-16` |
| insider/collusion | `PR-02`; assurance insider row `PR-18` |
| availability/resource exhaustion | `PR-06`, `PR-13`, `PR-17` |
| assurance/provenance/supply chain | `PR-03`, `PR-11`, `PR-12`, `PR-18` |
| SSRF all required variants | `TH-07` / `AB-07` / `VAL-07` |
| deletion/epoch/recreation/concurrency/replay/restore | `TH-04`, `TH-05`, `TH-17` |
| KMS all required failure modes | `TH-06` / `AB-06` / `VAL-06` |
| unsafe import all required modes | `TH-11` / `AB-11` / `VAL-11` |

Each `TH-nn` has exactly one `PR-nn`, `AB-nn`, `RR-nn`, and `VAL-nn` in the
same `CASE-nn` row. Each case has prevention/detection/recovery IDs
`CTL-nn-P/D/R`. No risk row is orphaned.

## 8. Severity defect negative fixtures

These fixtures apply separately to inherent and residual severity. The expected
result is always `CLASSIFICATION_REQUIRED`, `UNRESOLVED`, and exact
`BLOCK-ALL`: `RISK_CLOSURE_PASS`, S04 closure, operational activation,
deployment, release, production, A13 readiness, A13 selection, and A13
completion. An explicit,
schema-valid fixture record may support `DESIGN_REVIEW_PASS`; hiding,
normalizing, converting, downgrading, or omitting its deficiency or block
fails design review.

| Fixture | Defect input | Forbidden conversion |
| --- | --- | --- |
| `SF-MISSING-I`, `SF-MISSING-R` | field absent | default to `LOW` or inherit the other severity |
| `SF-UNKNOWN-I`, `SF-UNKNOWN-R` | `UNKNOWN` | treat as a fifth severity |
| `SF-AMBIG-I`, `SF-AMBIG-R` | `HIGH/MEDIUM` | choose lower or average |
| `SF-CONFLICT-I`, `SF-CONFLICT-R` | two sources disagree | latest/prose/reviewer-wins |
| `SF-MALFORMED-I`, `SF-MALFORMED-R` | `high`, `H`, `5`, `0.8` | alias or numeric mapping |
| `SF-UNMAPPED-I`, `SF-UNMAPPED-R` | rubric has no applicable rule | row-local threshold/weight/fallback |
| `SF-UNSUPPORTED-I`, `SF-UNSUPPORTED-R` | no evidence/rationale/trace | pressure or proposed-control downgrade |
| `SF-CLOSURE-I`, `SF-CLOSURE-R` | `EVIDENCE_CLOSED` with defective severity | closure conversion |

`AT-SEV-01` verifies only the four values are accepted. `AT-SEV-02` verifies
every fixture produces the exact nine-member block and cannot yield
`RISK_CLOSURE_PASS`, S04 closure, operational activation, deployment, release,
production, or any A13 readiness/selection/completion.
`AT-SEV-03` verifies a downgrade requires independent evidence, fixed
calculation, prior/resulting severity, rationale, reviewer, and exact evidence
trace. `AT-SEV-04` runs all rules independently for inherent and residual
severity. `AT-SEV-05` verifies that concealment, normalization, invented
evidence, prohibited conversion/downgrade, or a missing closure or block cannot
yield `DESIGN_REVIEW_PASS`. `AT-SEV-06` verifies that
`DESIGN_REVIEW_PASS` cannot be converted into risk closure, effectiveness, S04
closure, operational activation, deployment, release, production, or any A13
readiness, selection, or completion. It also cannot itself complete A12 or
freeze Architecture v3.

## 9. Gate/profile, disabled-path, and nonauthority register

| ID | Exact preserved state |
| --- | --- |
| `GATE-01` | HG-1 is limited to exact R5/HG1-RP01, `HG1-D01-A`…`HG1-D20-A`, exceptions `NONE`; `HG1-D15-A` and `HG1-D16-A` require complete taxonomy and threat→control/owner/test/evidence/residual/closure trace |
| `GATE-02` | HG-2 is limited to exact R7/HG2-RP01, `HG2-D01-B`, `HG2-D02-A`…`HG2-D19-A`, exceptions `NONE`; synthetic-only; learning/export, real/personal/high-risk/unknown/mixed data, hold broadening, federation, break-glass, and informal exceptions are disabled |
| `GATE-03` | HG3-RP01 permits only Bedrock generation and embedding as design classes; concrete invocation is denied pending HG-5/implementation; second provider/failover disabled; effectful tool catalogue empty; Managed MCP only the three approved authenticated same-synthetic-tenant purpose-bound summaries |
| `GATE-04` | HG4-RP01 is design-only/nonoperational; evaluation, export, import, promotion, canary, rollback, runtime, and cloud execution are not evidenced |
| `GATE-05` | HG-5 and HG-6 pending; credentials, IAM, keys, networks, budgets, cloud, runtime, deployment, release, production, and operations unauthorized |

This artifact grants no private Zintus access/integration, Git mutation,
implementation, schema/API/SDK/test/IaC work, provider/tool/MCP execution,
credentials, runtime, cloud, deployment, release, production, Architecture
freeze, A13 readiness/selection, compliance, certification, universal-erasure
claim, or automatic successor. A prospective frozen state is unreachable
unless a later separate exact owner decision and governance amendment first
authorize it; R5 supplies neither and every A13 block remains active.

## 10. Validation register

| ID | Mechanical or review assertion | R5 result |
| --- | --- | --- |
| `AT-01` | all 22 source links resolve and exact hashes match | `PASS` for the exact E-0056 R2-protected sources |
| `AT-02` | source namespace, all stable ID namespaces, and definitions are unique | `PASS_DESIGN_CHECK` |
| `AT-03` | `TH-01..18`, `PR-01..18`, `AB-01..18`, `RR-01..18`, `VAL-01..18` are one-to-one and no orphan exists | `PASS_DESIGN_CHECK` |
| `AT-04` | every row has actor/capability/prerequisite/scenario and asset/data/tenant/purpose/op/zone/boundary/flow | `PASS_DESIGN_CHECK` |
| `AT-05` | every row has inherent/residual severity, likelihood, uncertainty, fixed-rubric rationale, separate P/D/R controls, negative test, expected result, evidence/status, residual, owner, explicit dependencies, closure/block, citations | `PASS_DESIGN_CHECK`; all 18 explicit dependency fields were recomputed; evidence remains unexecuted |
| `AT-06` | complete STRIDE plus privacy/linkage/learning/insider/availability/assurance and every mandatory subcase has explicit coverage | `PASS_DESIGN_CHECK` |
| `AT-07` | all SSRF, insider, deletion-race, KMS, unsafe-import, replay, poisoning, exfiltration, DoS, receipt/key, concurrency, supply-chain cases and citations are present | `PASS_DESIGN_CHECK` |
| `AT-08` | closed severity schema and all `SF-*` negative fixtures preserve classification, risk-closure, and downstream blocks without normalization/conversion/downgrade | `PASS_DESIGN_CHECK`; fixtures are designs, not executed evidence |
| `AT-09` | every unresolved critical/high/classification-required row retains exact `BLOCK-ALL` without bypass while a structurally complete and honest row may design-pass | `PASS_DESIGN_CHECK`; every one of the nine blocks remains active |
| `AT-10` | exact A12 dependency and HG-1/HG-2 seals match | `PASS` for available file hashes; no runtime inference |
| `AT-11` | contradictions are explicit and never normalized | `PASS_DESIGN_CHECK`: the two-verdict model closes contract-level `CONTRADICTION-01` without closing or weakening an underlying risk |
| `AT-12` | R5 is the sole changed artifact; inventory remains 30 regular files, zero symlinks, modes `0644`, staging empty | external Worker validation required |
| `AT-13` | UTF-8, terminal LF, no NUL/trailing whitespace, relative links, no secret/private path | external Worker validation required |
| `AT-14` | exact failed R1-R3 identities/chains and reviewed R4 identity/full chain are recorded with no carry, and exact current R5 byte size, LF count, SHA-256, and mode are sealed | external Worker seal required |
| `AT-15` | Worker→Terra→Security→Lean→Chief use one hash; any edit restarts at Worker | pending |
| `AT-16` | missing/malformed/concealed/invented/normalized/converted/downgraded evidence or fields and missing blocks fail design review | `PASS_DESIGN_CHECK`; fixtures are not runtime evidence |
| `AT-17` | artifact PASS means only design review; it cannot satisfy risk closure, effectiveness, completion, readiness, selection, freeze, implementation, deployment, release, or production | `PASS_DESIGN_CHECK` |

## 11. Residual-risk and closure summary

| State | Cases | Consequence |
| --- | --- | --- |
| unresolved `CRITICAL` | `RR-01`, `RR-02`, `RR-04`…`RR-07`, `RR-09`…`RR-11`, `RR-16`, `RR-17` | exact `BLOCK-ALL`: risk-closure, S04, operational, deployment, release, production, and all three A13 blocks |
| unresolved `HIGH` | `RR-03`, `RR-08`, `RR-12`…`RR-15`, `RR-18` | same exact nine-member block |
| `CLASSIFICATION_REQUIRED` | no current R5 risk row; all `SF-*` defect fixtures | any triggered fixture creates the same exact block; closure cannot override |
| `EVIDENCE_CLOSED` | none | design/proposed controls and unexecuted tests cannot close |

The absence of runtime evidence is not a defect hidden by this document; it is
the current truth. E-0055 resolved the review-contract circularity by
distinguishing complete, honest design review from actual risk closure, and
accepted E-0056 R2 authorized the exact nine-block amendment used by R5.
`CONTRADICTION-01` is therefore closed at the contract level: unresolved
high/critical risks do not prevent `DESIGN_REVIEW_PASS` when every required
field, gap, planned validation, residual risk, owner, dependency, closure, and
block is explicit. They still retain exact `BLOCK-ALL`: `RISK_CLOSURE_PASS`,
S04 closure, operational activation, deployment, release, production, A13
readiness, A13 selection, and A13 completion. This is no waiver, acceptance,
downgrade, normalization, implementation evidence, or claim of control
effectiveness. R3 attempted to address `A12-R2-SEC-01` by making CASE-18's
dependencies explicit but stopped at `A12-R3-TERRA-01`; no R3 finding closure
or PASS carries. Reviewed R4 addressed both `A12-R2-SEC-01` and
`A12-R3-TERRA-01` through the explicit CASE-18 dependency field plus
exhaustive revision identity classification and completed its fresh full
review chain; no R4 result carries into R5. Current R5 preserves that
correction and applies the accepted E-0056 R2 exact block amendment. CASE-18's
verification, execution, and closure-evidence
dependencies remain outstanding, `RR-18` remains `HIGH` and `UNRESOLVED`, and
`BLOCK-ALL` remains the exact nine-member set.

A later separately reviewed completion-only governance transaction may make
A12 `DESIGN_BASELINE_COMPLETE_WITH_OPEN_RUNTIME_RISKS`; R5 does not complete
A12 or change the manifest. Architecture v3 remains unfrozen. The prospective
frozen label remains unreachable unless a later separate exact owner decision
and governance amendment authorize it, followed by a separately selected and
reviewed A13 process. R5 grants no A13 or operational authority.

## 12. Worker R5 disposition

`WORKER_R5_RESULT`: **`DESIGN_REVIEW_PASS` / PASS with zero findings.**

Basis:

1. all 18 cases were recomputed and remain honestly `UNRESOLVED` at
   inherent/residual `CRITICAL` or `HIGH`, with complete fields, gaps, planned
   fail-closed validations, residuals, owners, explicit dependencies, closure
   states, citations, and blocks;
2. CASE-18 retains its single explicit dependencies field; reviewed R4
   addressed `A12-R2-SEC-01` and `A12-R3-TERRA-01`, current R5 retains the
   correction without review carry, and `RR-18` remains `HIGH`, `UNRESOLVED`,
   and exact nine-member `BLOCK-ALL`;
3. `CONTRADICTION-01` remains closed only through the approved two-verdict
   model;
4. all unresolved-risk and classification-defect blocks remain active as the
   exact nine-member set; removing A12 completion and Architecture
   design-freeze from that set does not complete or freeze either state; and
5. no design check or unexecuted test is represented as runtime evidence or
   control effectiveness.

R5 now requires fresh independent Terra → Security → Lean → final Chief review
on one unchanged R5 hash; no R1, R2, R3, or R4 role or result carries. This
design PASS is not `RISK_CLOSURE_PASS`, A12 completion, implementation/runtime
evidence, A13 authority, or Architecture freeze.
