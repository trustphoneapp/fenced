# B02 public contracts v1

## Scope

B02 defines a local, provider-neutral, content-safe contract boundary. Its
identity has two inseparable sources: JSON Schema 2020-12 files in
`packages/contracts/schemas/v1/` define structure, while
`packages/contracts/semantics/v1/semantic-profile.json` defines dependent
correlation and applicability. The generated TypeScript catalog embeds both
and one deterministic SHA-256 identity; semantic drift therefore changes
catalog identity even when schema bytes do not.

The contract layer grants no runtime authority. It does not connect to a
provider, database, queue, tool, MCP server, credential, network, or private
project. A structurally valid contract is data, not authorization, current
truth, proof of execution, or permission to perform an effect.

## Closed family set

| Family | B02 meaning |
| --- | --- |
| `api` | Disjoint untrusted-ingress, server-admitted-request, and server-response metadata |
| `event` | Immutable event identity, revision, provenance, and erasable payload reference |
| `policy` | Disjoint pre-retrieval and pre-transmission decision metadata |
| `provider` | Disjoint denial and primary-provider result metadata whose output remains untrusted data |
| `receipt` | `continuity.receipt/3` logical fields plus its detached signature envelope |
| `task` | Disjoint public command and status metadata, not queue or worker authority |
| `registry` | Exact seven-family schema catalog manifest, not a provider/tool/learning registry |

`envelope.schema.json` is the sole shared definition file. References are local,
bounded, resolved only into its `$defs`, and checked for cycles. The verifier
allows exactly the eight checked-in schema filenames and exact schema IDs.

## Fail-closed invariants

- Every object, including nested receipt and registry objects, rejects unknown
  properties.
- All identifiers and erasable references are canonical lowercase 192-bit hex
  strings. Generated TypeScript types brand each ID by field, preventing
  accidental cross-field substitution.
- Caller-requested purpose and server-resolved purpose are separate required
  fields. Equality is not inferred by schema validation.
- Versions are exact named revisions. `latest`, ranges, and unversioned provider
  or model names are invalid.
- Signed and unsigned 64-bit values use canonical decimal strings, avoiding
  JavaScript number precision loss.
- Date-times use an exact millisecond UTC representation and must round-trip as
  real calendar instants.
- Arrays and inputs are bounded. Validation reports at most 64 bounded failures.
- Array own names must be exactly indices `0..length-1` plus `length`; holes,
  symbols, extra or hidden names, and accessor indices fail before
  descriptor-value recursion or canonicalization.
- Constant semantic and structural array-length caps are checked before any
  index-name construction or enumeration, so attacker-sized sparse lengths
  cannot trigger proportional allocation.
- Oversized arrays fail before member canonicalization or uniqueness work.
  Cyclic, accessor-bearing, sparse, excessively deep, and non-JSON direct
  values fail boundedly.
- JSON text is scanned for duplicate and prototype-pollution keys before
  materialization. No coercion, defaults, unknown-field removal, or fallback is
  performed.
- Required fields must be enumerable own properties. Custom prototypes,
  inherited or non-enumerable values, symbol keys, excessive properties,
  excessive nesting, and exhausted node budgets fail closed.
- Event, provider, task, and receipt metadata cannot carry prompts, raw content,
  secrets, model output, or payload bodies. Sensitive material is represented
  only by opaque, separately erasable references.
- Outcomes preserve `unknown` and `partial` where the family permits them.
  Receipt state follows A10 and specifically forbids `pending` and `partial`.
- Provider role is fixed to primary, failover is disabled, provider output is
  untrusted data, and policy contracts cannot validate effectful tools,
  learning, or export as enabled.
- Family-specific semantic tables bind API outcome/error/content, policy
  allow/deny reason classes, provider decision/outcome/input/output/error, and
  task state/outcome/checkpoint/error. The same profile supplies explicit
  receipt type/semantic-class/decision/outcome/state tuples with independent
  authorization and dispatch applicability, closed AS0-AS4 external-attempt
  facts, registry mapping, and exact external-tuple source selectors. Exactly
  one applicability pair exists per executable five-field key.
- API, policy, provider, task, and registry semantics exhaust their executable
  schema domains with exact keys, tuple arities, unique alternatives, and
  position-specific directive vocabularies. No extra token is ignored.
- Set-valued reason/error arrays are lexicographically ordered, unique,
  disjoint across branches, and exhaustive. Receipt rule rows are ordered by
  their canonical five-field key and outputs; reordering is invalid.
- Event semantics is exactly `closed_metadata_only`. Its profile contains the
  complete allowed-property and required-property sets plus exact const, enum,
  and local-reference bindings. Runtime/catalog initialization compares every
  one of those bindings against an immutable reviewed vocabulary in the trusted
  validator. The three binding classes are disjoint and their union is exactly
  the allowed-property set; every property schema is exactly its complete
  binding object. Both `subjectRef` and `payloadRef` use the reviewed 192-bit
  lowercase-hex opaque-reference definition. A raw `payloadRef`, added
  `messageBody`, or coordinated schema/profile expansion is rejected.
- Provider outcomes are compared independently inside the `denied` and
  `result` discriminator branches, as are their exact error-code sets. Denial
  error partitions are disjoint and exhaustive; result tuple error members,
  including the typed-none `PROVIDER_NONE` representation, exhaust only the
  result branch. A denied request can be `denied` or `unknown`; `failed` belongs
  only to an invoked result and is structurally unreachable from the denied
  branch.
- Receipt checks bind wrapper scope to logical scope, bind the detached envelope
  to the logical receipt, keep important identities distinct, enforce the
  sequence-one/later-predecessor partition, require canonical ordered lists,
  and reject dispatched external tuples that differ from authorization.

## Deterministic pipeline

`scripts/verify-contracts.mjs` uses Node built-ins only. It rejects duplicate
schema keys, remote or unresolved references, unsupported dialect keywords,
wrong keyword value types, any expression outside the reviewed anchored
linear-time regular-expression set, contradictory
type/constant/enum/bound/pattern relationships, unknown types, open or
unbounded structures, content-bearing fields, schema cycles, excessive
nesting, semantic-profile identity gaps, and stale generated output.
The semantic profile must itself be finite bounded plain JSON: non-finite
numbers, accessors, custom prototypes, cycles, sparse arrays, pollution keys,
and unbounded metadata fail closed.
One shared validator and schema cross-validator initialize runtime semantics,
gate both compatibility directions, and gate deterministic catalog generation;
all compare the same validated canonical profile bytes.

To deliberately regenerate after editing a schema:

```text
node scripts/verify-contracts.mjs --write
```

Normal and canonical verification is read-only:

```text
node scripts/verify-contracts.mjs
node scripts/safe-verify.mjs
```

The safe verifier invokes the contract check as a fixed local stage before
compilation and tests. `checkSameVersionCompatibility` enforces same-ID
immutability across mandatory previous/candidate schema and semantic-profile
inputs; omitted semantics or semantic drift under an unchanged contract
version fails. `checkOldProducerToNewConsumerCompatibility` is the separately
named directional check and allows only an immediately successive root schema
ID of the same family. Every other structural assertion must be identical;
even an optional field addition is rejected. Both schemas pass the exact
canonical restricted-dialect and local-reference resolver used during catalog
generation before comparison. Exact previous and candidate semantic profiles
are mandatory, closing authority-bearing `admin`, `access`, or `grant`
additions without relying on a safe-addition proof.

## Honest limitations

B02 validates logical JSON contracts and the A10 mapping documented in
`receipt-contract-conformance-v1.md`. It does not implement A10 deterministic CBOR canonical bytes,
domain separation, digest construction, signature issuance or verification,
key custody, sequence allocation, checkpoint verification, replay/fork storage,
or current-status reconstruction. The detached signature envelope is a typed
definition only.

The local validator implements the checked-in restricted dialect, not all of
JSON Schema 2020-12. It is not a hostile-code sandbox. It does not prove
authorization, provider execution, persistence, erasure, delivery, deployment,
or control effectiveness. Cross-record sequence continuity and uniqueness
require later canonical persistence and verification work.
