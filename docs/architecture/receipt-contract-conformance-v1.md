# A10 receipt contract conformance

## Status and boundary

`receipt.schema.json` is the public JSON representation of the complete logical
field vocabulary defined by A10 `continuity.receipt/3`. It is not the A10
canonical byte representation. A JSON value that passes this contract still
has no signature, authority, current-status, execution, or persistence meaning
until later canonicalization and verification stages succeed.

The mapping preserves every logical BIND field:

- `A10-BIND01..A10-BIND42` map one-to-one to the same snake-case property
  names in `logicalReceipt`;
- canonical keys 43 through 48 remain absent and forbidden in
  `logicalReceipt`;
- `A10-BIND43..A10-BIND48` map one-to-one to `signatureEnvelope`, which
  remains detached;
- `A10-BIND59..A10-BIND68` map one-to-one to properties 49 through 58 in
  `logicalReceipt`.

The `version_tuple` object maps `A10-VER01..A10-VER29` in register order:

```text
tenant_scope
purpose_scope
object_versions
source_versions
evidence_versions
schema_versions
receipt_format_version
policy_versions
configuration_versions
compiler_version
retrieval_version
provider_model_version
embedding_version
cache_version
index_version
simulation_version
operation_version
attempt_version
algorithm_version
key_version
lifecycle_version
environment_version
chain_version
verifier_policy_version
request_version
active_memory_version
intent_approval_version
key_governance_version
attempt_stage_version
```

`attempt_version` has exactly the six `A10-VER18` members.
`attempt_stage_version` has exactly the six `A10-VER29` members and the five
closed stage discriminators plus two closed idempotency modes from Section 4.4.

Keys 57 and 58 use the complete ordered 33-member Section 4.1 external tuple.
The shared definition is structural reuse only; authorization and dispatch
instances must be field-for-field equal across all 33 members when dispatch is
present. Every duplicated scope, identity, attempt/stage, lifecycle,
source/evidence, memory, tool, approval, request, and version fact is also bound
to its logical receipt source. Source and evidence sets use exact
ID-plus-revision pairs, so two distinct records may lawfully share one revision
without collapsing. Adapter, provider, model, destination, parameter bundle,
credential selector, and no-effect reservation applicability each have
distinct authoritative fields in `provider_model_version`; none is inferred
from another field.

## JSON-to-logical-type mapping

The public JSON contract uses lossless display forms:

| A10 logical type | Public JSON representation |
| --- | --- |
| 192-bit opaque bytes | exactly 48 lowercase hexadecimal characters, branded by field in TypeScript |
| unsigned/signed 64-bit integer | canonical decimal string with explicit range validation |
| 32-byte SHA-256 value | exactly 64 lowercase hexadecimal characters |
| signature bytes | unpadded base64url with suite-specific length |
| typed null | JSON `null`, only in explicitly enumerated applicability branches |
| canonical CBOR map/array | closed JSON object/array with the same logical members |

These display values must later be decoded into the exact A10 CBOR logical
types. JSON text, JSON property order, hexadecimal spelling, and decimal
strings never enter an A10 signing preimage.

## Enforced applicability

The B02 validator enforces:

- wrapper-to-logical tenant, purpose, operation, and attempt binding;
- exact `operation_type@revision` equality with `VER17`;
- top-level, `VER18`, `VER29`, and external-tuple attempt equality;
- the disjoint AS0 through AS4 claim/lease/effect-fence partition;
- idempotency-required versus schema-inapplicable partition;
- genesis versus predecessor-required sequence partition;
- request, environment, profile, operation, chain, lifecycle, key,
  active-memory, source, and evidence version bindings;
- exact bidirectional logical-ref to VER04/VER05 ID-plus-revision coverage,
  with no extra, missing, or duplicate projected entry;
- canonical ordering and uniqueness of logical sets;
- exact request-commitment and erasable-body structures;
- exact required/not-required approval variants;
- non-tool versus selected read-only Managed MCP intent applicability;
- key-lifecycle timestamp applicability;
- active-only issuance, exact BIND65 lifecycle-generation and BIND66 issuance
  view binding to VER28, issuance/key validity intervals, and separation of the
  signing-key owner from issuer, principal, verifier, custodian, and policy
  owner;
- signature-suite agreement and canonical base64url decoding with
  suite-specific exact byte lengths;
- exact lowercase commitment display forms;
- explicit closed receipt type/semantic-class/decision/outcome/state rules with
  separate key-57 authorization and key-58 dispatch applicability;
- exactly one pre-transmission policy source and zero or one unambiguous
  configuration source whenever key 57 or 58 is present;
- authorized/dispatched full-tuple equality and authorization-state presence;
- dispatched-tuple presence for transmitting, provisional-streaming, and
  completed states;
- pre-AS3 receipts may retain key 58 as typed null where their exact rule
  permits it; AS3 and AS4 universally require key 58. A rule that forbids
  dispatch cannot claim AS3/AS4. The exact `dispatch_attempt` evidence class
  is also a closed external-attempt fact and therefore requires key 58,
  never from generic runtime evidence or an outcome-code heuristic;
- `merkle_sha256_v1` checkpoint shape and range order.

## Deferred A10 mechanisms

B02 does not implement deterministic CBOR encoding, domain-separated signing
preimages, signature verification, trust stores, key custody, atomic sequence
allocation, checkpoint calculation, fork/replay storage, body cryptography, or
current-status reconstruction. Those cannot be inferred from contract
validation and remain fail-closed later tasks.
