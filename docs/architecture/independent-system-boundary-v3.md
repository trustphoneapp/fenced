# A06 Independent-System Boundary ADR

**Status:** proposed A06 design evidence under review.
**Task:** A06 — independent-system boundary.
**Scope:** independent Continuity and future public interfaces only; no private Zintus integration or access is authorized.

## Decision

Continuity MUST be independently authored, built, tested, deployed, and evidenced. private Zintus is not an input, dependency, fixture, oracle, build/deploy source, or provenance source. Dependency is one-way only: a future separately authorized private Zintus client may consume the documented generic public Continuity API/SDK like every external client; Continuity never depends on private Zintus.

Future inbound external-client use requires separately authenticated/authorized identity, tenant/purpose scope, versioning, rate limits, idempotency where required, and applicable receipts. The client receives no special lane/trust, reverse access, tenant authority, privilege, compatibility exception, or credential inheritance. V07/V08 and `separate_future_authorization` can authorize private Zintus only as an ordinary inbound external consumer of the generic public API/SDK; they cannot authorize Continuity-initiated callback, tool, route, shim, private-network, or other reverse egress. This ADR is the A06 design destination for [RQ-A06](requirements-traceability-v3.md#3-requirement-matrix), the [permanent map](requirements-traceability-v3.md#2-permanent-boundary-map), and open [DC-09/DC-10](requirements-traceability-v3.md#8-dependency-contradiction-register--directions-only); it changes none.

## Authority and restricted-or-unknown inputs

Declared reviewable inputs: [goal](../implementation/goal.md), [A00 traceability](requirements-traceability-v3.md), [A01 ownership](../governance/ownership-and-provenance.md), [A01 disclosure](../hackathon/preexisting-code-disclosure.md), [A02 trust boundaries](system-trust-boundaries-v3.md), [manifest](../implementation/task-manifest.yaml), [status](../implementation/status.md), [ledger](../implementation/evidence-ledger.md), [AGENTS](../../AGENTS.md), and [SECURITY](../../SECURITY.md). These establish requirements, not proof of future controls.

A02 remains authoritative, not redefined: the [TB-00 actor/zone entry](system-trust-boundaries-v3.md#3-actor-and-zone-inventory) treats the future client as untrusted; the [F04/F14 crossing entries](system-trust-boundaries-v3.md#5-trust-boundary-crossing-register) are limited to exactly one client-initiated F04 request and exactly one finite terminal F14 response under ISB-R07 and grant no callback, tool, route, or reverse egress; [section 6.4](system-trust-boundaries-v3.md#64-publicprivate-system-direction) is the direction rule; the [BT-13 threat entry](system-trust-boundaries-v3.md#7-prospective-boundary-threat-register-for-a12) addresses privileged/reverse access.

Unknown origin, authority, permission, public availability, or relationship to private Zintus is **restricted-or-unknown** and fails closed: do not inspect, acquire, use, retain, transform, hash, summarize, or make it a decision input. A clean scan is limited negative evidence, not proof of absence, clean-room status, originality, ownership, or license clearance.

Do not import, copy, summarize, fingerprint, or derive from private source/tests/Git/patches/artifacts/packages/filenames/filesystem structure/docs/schemas/data/fixtures/prompts/completions/screens/logs/telemetry/config/secrets/keys/tokens/certs/URLs/identity/database/table/queue/bucket/cache/vector/index/deploy/infra/undocumented endpoint/protocol/event/route/behavior/contract material. Never inspect private Zintus for comparison, scanning, or negative proof. Never hash restricted material.

Permitted authoring inputs are only declared user conceptual requirements, reviewable Continuity artifacts, governed public sources/dependencies, and recorded generated-untrusted input. Generated output is untrusted and cannot cleanse origin. Authorized future runtime public-API data is governed client data, never authoring provenance.

## Normative boundary register

| ID | Requirement |
| --- | --- |
| ISB-R01 | Continuity authorship, ownership records, build, test, deployment, and release evidence MUST be independent of private Zintus. |
| ISB-R02 | No person, agent, tool, or workflow may inspect private Zintus, including comparison, scanning, discovery, or negative proof. |
| ISB-R03 | Every listed private material class MUST be excluded from authoring, provenance, fixtures, generators, and oracles. |
| ISB-R04 | Only declared conceptual requirements, reviewable Continuity artifacts, governed public sources/dependencies, and recorded generated-untrusted input may be considered. |
| ISB-R05 | Restricted-or-unknown origin/authority/permission/relationship MUST fail closed; a clean scan is not affirmative proof. |
| ISB-R06 | Build/test/generator/CI/scan/release/demo/deploy inputs MUST exclude private checkout, credential, artifact, data, and config. |
| ISB-R07 | Dependency direction is one-way: Continuity MUST NOT depend on private Zintus or initiate egress to it. A future client may initiate exactly one F04 request and receive exactly one finite terminal F14 response, immutably one-to-one bound to that exact request, authenticated principal/session, server-resolved tenant/purpose, operation, contract version, authorization version, and unique request identity. F14 permits only finite bounded request-scoped token/content chunks plus one terminal outcome. Before every content release, Continuity MUST freshly validate live principal/session authorization and authorization version, server-resolved tenant/purpose, expiry, and deletion/revision fence; revocation, expiry, mismatch, change, stale, unknown, or uncertain state emits no further content and terminates. Autonomous events, commands, tool requests, subscriptions, SSE, WebSocket or other upgrades, long-poll, reconnect/resume, multiplexing, replay, cross-request or tenant swap, and post-terminal data are forbidden. |
| ISB-R08 | Future private Zintus consumption is allowed only as an ordinary inbound external consumer of a reviewed versioned public API/SDK; private imports/vendoring/submodules/symlinks/path dependencies/workspace refs/private registries/copied generated clients and every Continuity-initiated callback/tool/route/shim/private-network/other egress are forbidden. |
| ISB-R09 | External-client parity forbids special lane/trust/tenant authority/privilege/compatibility exception/private-specific promise. |
| ISB-R10 | A future client has separate identity/authentication/authorization and inherits no secret/KMS/IAM/service account/session/trust root/credential. |
| ISB-R11 | No shared private/internal data, control, credential, operations, database, queue, bucket, cache, vector, filesystem, deployment, mutable-state, routing, or network plane is allowed; public transport is limited to the single F04 request and immutable ISB-R07-bound finite F14 response, and no Continuity-initiated or out-of-band reverse egress is allowed. |
| ISB-R12 | B02 owns public schemas/compatibility; reviewed version/deprecation/schema/conformance governance contains no private-derived requirement. |
| ISB-R13 | Authorized runtime client data MUST NOT become authoring provenance, fixture, oracle, or design source. |
| ISB-R14 | Generated material is untrusted, needs recorded inputs/review, and cannot introduce private dependency/provenance. |
| ISB-R15 | B03/B05/V01/V06 own future scans/provenance/clean-clone/reconciliation/release; this ADR does not claim they ran. |
| ISB-R16 | Ambiguity, contradiction, unavailable gate, undocumented route, or conflict denies and escalates outside A06. |

## Decision matrix

| ID | scenario/source | current or future | disposition | required task/gate/control | rationale/nonclaim |
| --- | --- | --- | --- | --- | --- |
| ISB-D01 | private inspection | current/future | denied | ISB-R02/ISB-R05; B05/V01 | No comparison/scan/negative-proof exception. |
| ISB-D02 | private source/package | current/future | denied | ISB-R03/ISB-R06/ISB-R08; B03/B05/V01/V06 | Includes direct/transitive/generated/registry/path/vendor/workspace forms. |
| ISB-D03 | private data/fixture | current/future | denied | ISB-R03/ISB-R06/ISB-R13; B05 | Not oracle/training/fixture/provenance. |
| ISB-D04 | declared conceptual input | current | allowed | declared input; A01 | Concept only; no asserted implementation origin. |
| ISB-D05 | public dependency | current | allowed | A01; future B03/B05/SBOM | Public status does not waive license/origin/security review. |
| ISB-D06 | reviewable Continuity source | current | allowed | A01 review/provenance | Not completion or ownership certification. |
| ISB-D07 | generated untrusted | current | conditional | recorded input; ISB-R14; future B03/B05 | Cannot cleanse restricted-or-unknown origin. |
| ISB-D08 | future private Zintus API | future | conditional inbound consumption only | V08 after V07/S09; `separate_future_authorization`; V07 requires A06/B02/E08/S09 and HG-0/HG-3 | Exactly one client-initiated F04 request and exactly one finite terminal F14 response under ISB-R07; no reverse egress. |
| ISB-D09 | future private Zintus SDK | future | conditional inbound consumption only | V08 after V07/S09; `separate_future_authorization`; B02/V07 | Versioned public SDK parity only; no private-derived client or reverse egress. |
| ISB-D10 | authorized runtime API data | future | conditional inbound consumption only | V08 after V07/S09; `separate_future_authorization`; E08 | Inbound runtime request data is governed client data only, never authoring provenance or reverse authority. |
| ISB-D11 | shared state/credential/network | current/future | denied | ISB-R10/ISB-R11; B05/V01/S09 | No shared store/secret/identity/routing/deploy/private network. |
| ISB-D12 | reverse integration or egress | current/future | denied | ISB-R07/ISB-R08/ISB-R11/ISB-R16; separately authorized and fully reviewed A06 boundary revision required for any proposed change | No callback/tool/webhook/event delivery/route/shim/private network/protocol/other egress, even if generic; V07/V08 cannot authorize it. |

## Public-contract governance

B02 owns schemas and compatibility; E08 owns receipts; S09 remains the production gate. V07 owns the generic public integration contract and, under the current manifest, depends on A06/B02/E08/S09 and gates HG-0/HG-3. V08 owns any actual later private-Zintus external-client integration and depends on V07/S09 plus `separate_future_authorization`, solely for private Zintus as an ordinary inbound external consumer. Neither V07, V08, their gates, nor separate authorization can authorize reverse egress. A06 activates none.

Before any future client use, review version, deprecation, schema compatibility, conformance, identity, tenant/purpose scope, rate limits, operation idempotency requirement, receipt behavior, immutable one-to-one request/principal/session/tenant/purpose/operation/contract-version/authorization-version/unique-request-identity binding, finite response and chunk caps, and live authorization/expiry/deletion/revision fences before every content release. No undocumented/private-specific promise/schema/identity/behavior/requirement and no callback/tool/webhook/event/route/shim/private network/protocol/egress surface is permitted.

The client initiates exactly one F04 request and receives exactly one finite terminal F14 response under ISB-R07 only. Autonomous events, commands, tool requests, subscriptions, SSE, WebSocket or other upgrades, long-poll, reconnect/resume, multiplexing, replay, cross-request or tenant swap, post-terminal data, callbacks, webhooks, event delivery, routes, shims, private networks, protocols, and all other Continuity-initiated or out-of-band reverse egress are forbidden, even if described as generic. Any proposed change requires explicit A06 reopening and the full review chain before V07/V08; V07/V08 alone cannot change this boundary. CI/build/test/scan/release/demo/deploy receive no private checkout/credential/artifact/data/config. A client receives no control/operations plane or tenant-selection authority.

## Invariants

| ID | Invariant |
| --- | --- |
| ISB-IN01 | Authoring provenance has no private input edge. |
| ISB-IN02 | No workflow inspects private material, even to prove a negative. |
| ISB-IN03 | Restricted-or-unknown input has no read/hash/transform/retention path. |
| ISB-IN04 | Build/test/generator/release inputs are independently declared/reviewable. |
| ISB-IN05 | The dependency and egress graph has no Continuity-to-private dependency, callback, tool, route, shim, private-network, or initiated-egress edge, direct or transitive. |
| ISB-IN06 | The untrusted future client has exactly one immutable one-to-one finite terminal F04/F14 pair under ISB-R07; no out-of-band or Continuity-initiated egress exists. |
| ISB-IN07 | Client parity prevents private-specific authority/lane/schema/compatibility exception. |
| ISB-IN08 | Identity, tenant authority, credential, and trust roots are not inherited/shared. |
| ISB-IN09 | State/control/data/network/deploy/operations planes remain separate, and a generic label cannot create reverse authority. |
| ISB-IN10 | Public contracts are versioned/compatible/documented/no-private-derived requirements. |
| ISB-IN11 | Runtime client data and authoring provenance are distinct classifications. |
| ISB-IN12 | Ambiguity/contradiction/failed-unavailable gate denies, never broadens access. |

## Threat register

| ID | Threat and prevention |
| --- | --- |
| ISB-TH01 | Copy/paraphrase contamination; prohibit inspection/derivation. |
| ISB-TH02 | Hidden build/generator dependency; isolate/record every input. |
| ISB-TH03 | Symlink/submodule/archive/path/worktree escape; reject it. |
| ISB-TH04 | Generated-context contamination; untrusted marking and declared inputs. |
| ISB-TH05 | Credential leak; reject private credentials/config/trust roots. |
| ISB-TH06 | Shared planes/reverse authority; prohibit shared stores/state/ops. |
| ISB-TH07 | Privileged client/special lane; parity and separate authorization. |
| ISB-TH08 | Contract drift/private-specific behavior; versioned schemas/conformance. |
| ISB-TH09 | Hidden reverse callback/tool/webhook/event/route/shim/private network/protocol; autonomous event/command/tool request; subscription; SSE/WebSocket/other upgrade; long-poll; reconnect/resume; multiplexing; replay; cross-request/tenant swap; post-terminal data; or generic-contract relabeling; deny every Continuity-initiated or out-of-band path and require the bounded live-fence ISB-R07 contract. |
| ISB-TH10 | Transitive private dependency; future declared dependency/origin evidence. |
| ISB-TH11 | Evidence/log disclosure; synthetic/redacted/un-hashed evidence. |
| ISB-TH12 | Release contamination; block release pending provenance/exclusion gates. |

## Synthetic future acceptance tests

These are designs only, not executed tests; they use synthetic markers/secrets and never acquire or reproduce private material.

| ID | Synthetic acceptance test |
| --- | --- |
| ISB-AT01 | Dependency/import graph rejects prohibited direct/transitive source relation. |
| ISB-AT02 | Lockfile/SBOM/source-origin reconcile to declared public dependencies. |
| ISB-AT03 | Submodule/symlink/archive/path/workspace/repository-escape checks fail closed. |
| ISB-AT04 | Remotes/worktrees/build/generator/release inputs are declared/acceptable. |
| ISB-AT05 | Synthetic restricted markers/credential-shaped values are excluded/redacted. |
| ISB-AT06 | CI/build/test/scan/demo/deploy reject private credential/config/network/state/checkout/artifact. |
| ISB-AT07 | Anonymous clean clone has only declared public inputs/no hidden local dependency. |
| ISB-AT08 | Generic public API conformance/version/deprecation compatibility. |
| ISB-AT09 | Generic public SDK conformance/compatibility. |
| ISB-AT10 | Synthetic external client cannot gain special authority/privilege/lane/exception. |
| ISB-AT11 | Positive and negative exact-tuple binding tests cover request, authenticated principal/session, server-resolved tenant/purpose, operation, contract version, authorization version, and unique request identity; reject missing, mismatch, replay, stale, expired, or revoked values; enforce bounded request-scoped chunks plus exactly one terminal outcome and revalidate live authorization/expiry/deletion/revision fences before every chunk. |
| ISB-AT12 | Negative tests deny or terminate autonomous events/commands/tool requests, subscriptions, SSE/WebSocket/other upgrades, long-poll, reconnect/resume, multiplexing, replay, cross-request/tenant swap, post-terminal data, callback/tool/webhook/event delivery/route/shim/private network/protocol/other reverse egress, and credential inheritance, even through a generic contract, V07/V08, or separate authorization; emit no further content and preserve only the single ISB-R07 request/response pair. |
| ISB-AT13 | Runtime API data remains governed client data, outside authoring provenance. |
| ISB-AT14 | Generated-untrusted input cannot bypass origin/dependency/clean-room controls. |
| ISB-AT15 | Provenance-release byte reconciliation/manifests required for eligibility. |
| ISB-AT16 | Release excludes synthetic private markers/origin gaps/path-symlink-submodule/clean-clone findings. |

Future test ownership is planned, not executed: B03 owns supply-chain/provenance evidence for ISB-AT02, ISB-AT04, and ISB-AT15; B05 owns exclusion enforcement for ISB-AT01, ISB-AT03, ISB-AT05, ISB-AT06, ISB-AT14, and ISB-AT16; V01 owns ISB-AT07; B02/V07 own ISB-AT08 and ISB-AT09; and V07/V08 with E08/S09 own ISB-AT10 through ISB-AT13. Later reviewed task scope remains authoritative.

## Rule-to-invariant/threat/test crosswalk

| Rule | Invariant(s) | Threat(s) | Test(s) |
| --- | --- | --- | --- |
| ISB-R01 | ISB-IN01, ISB-IN04 | ISB-TH01, ISB-TH12 | ISB-AT04, ISB-AT15 |
| ISB-R02 | ISB-IN02 | ISB-TH01, ISB-TH11 | ISB-AT05, ISB-AT16 |
| ISB-R03 | ISB-IN01, ISB-IN03 | ISB-TH01, ISB-TH03, ISB-TH10 | ISB-AT01, ISB-AT03, ISB-AT16 |
| ISB-R04 | ISB-IN01, ISB-IN04 | ISB-TH02, ISB-TH04 | ISB-AT02, ISB-AT04, ISB-AT14 |
| ISB-R05 | ISB-IN03, ISB-IN12 | ISB-TH01, ISB-TH11 | ISB-AT05, ISB-AT16 |
| ISB-R06 | ISB-IN04 | ISB-TH02, ISB-TH03, ISB-TH05, ISB-TH12 | ISB-AT03, ISB-AT04, ISB-AT06, ISB-AT07 |
| ISB-R07 | ISB-IN05, ISB-IN06 | ISB-TH02, ISB-TH09, ISB-TH10 | ISB-AT01, ISB-AT02, ISB-AT07, ISB-AT11, ISB-AT12 |
| ISB-R08 | ISB-IN05, ISB-IN06 | ISB-TH03, ISB-TH08, ISB-TH09, ISB-TH10 | ISB-AT01, ISB-AT03, ISB-AT09, ISB-AT12 |
| ISB-R09 | ISB-IN06, ISB-IN07 | ISB-TH07, ISB-TH08 | ISB-AT08, ISB-AT10 |
| ISB-R10 | ISB-IN08 | ISB-TH05, ISB-TH07, ISB-TH09 | ISB-AT06, ISB-AT11, ISB-AT12 |
| ISB-R11 | ISB-IN09 | ISB-TH05, ISB-TH06, ISB-TH09 | ISB-AT06, ISB-AT12 |
| ISB-R12 | ISB-IN07, ISB-IN10 | ISB-TH07, ISB-TH08 | ISB-AT08, ISB-AT09, ISB-AT10 |
| ISB-R13 | ISB-IN11 | ISB-TH01, ISB-TH04, ISB-TH11 | ISB-AT05, ISB-AT13 |
| ISB-R14 | ISB-IN01, ISB-IN04 | ISB-TH02, ISB-TH04 | ISB-AT04, ISB-AT14 |
| ISB-R15 | ISB-IN04, ISB-IN05 | ISB-TH10, ISB-TH12 | ISB-AT02, ISB-AT07, ISB-AT15, ISB-AT16 |
| ISB-R16 | ISB-IN12 | ISB-TH07, ISB-TH08, ISB-TH09 | ISB-AT10, ISB-AT11, ISB-AT12 |

## Release/provenance handoff

A future record cites only the declared repository inputs above and recorded generated-untrusted input; it fabricates no submitting authority, accepted provenance, clean-room audit, legal authorship, ownership, non-infringement, or license-clearance proof.

Release remains blocked until A01/B03/B05/V01/V06 controls exist, legacy absolute paths are separately remediated, generated provenance is complete, release bytes exactly reconcile to provenance, and dependency/license/NOTICE/SBOM/secret/private-marker/origin/path/symlink/submodule/clean-clone checks pass. Negative scan evidence is limited and never hashes restricted/private material.

## DC-09 and DC-10 remain open

DC-09/DC-10 remain open/unchanged. A06 does not edit/resolve README, goal, manifest, status, A00, contradiction register, Architecture v1, or workflow wording. Conflict gives no exception: deny and escalate to separately reviewed resolution outside A06.

## Nonclaims and review handoff

No current private integration/access or reverse-egress authorization; API/SDK implementation; code/schema/infra/test/deploy/demo/remote/release/prod activity; incident, runtime, or production validation; clean-room audit/cert/originality/ownership/non-infringement/license clearance; HG1-6 beyond HG0; A13/V07/V08/DC resolution; architecture freeze; or legacy path/provenance remediation is claimed. V07/V08 and separate authorization grant no callback/tool/route/shim/private-network/reverse-egress exception.

This is proposed A06 design evidence only. The full Terra → Security → Lean → Chief review chain is required; every byte change restarts Terra. It authorizes no stage, commit, network/cloud action, private-material access, or private-material hash.
