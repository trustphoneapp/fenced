# B04 deterministic local-harness boundary

## Purpose

B04 supplies a dependency-free, in-memory **local synthetic fixture** for
later work. It gives tests deterministic substitutes for identity authority,
tenant-and-purpose-qualified state, an ID-only queue, vector search, a fixture
provider, and a deny-only tool catalogue. It is neither a production runtime
nor a compatibility implementation for Amazon Bedrock, Cognito, SQS,
CockroachDB, MCP, or any other vendor.

## Deliberate limits

- Setup has a fixed, whole-fixture-validated server-owned identity registry.
  Runtime can only resolve an opaque credential reference and authorize its
  configured purpose; it cannot register identities, tenants, roles, or
  purposes. A separate controller capability resets the fixture only when no
  live queue lease exists. Reset restores initial time, sequence, faults,
  identities, provider fixtures, and empty data while advancing the private
  generation, making every old identity, scope, and delivery stale.
  Only `identities` is required. Omitted optional setup and explicitly
  `undefined` optional setup are equivalent: faults and provider fixtures are
  empty, initial time is `0`, queue lease is `10` milliseconds, queue maximum
  attempts is `3`, and vector dimension is `3`.
- State, queue, vectors, and provider fixtures are isolated by server-issued
  tenant-and-purpose scopes. State writes use a revision CAS and a
  tenant-and-purpose-local idempotency key.
- Queue payloads are identifiers only. Claim order and tie-breaking use explicit
  UTF-8 byte ordering. Redelivery and dead lettering progress only through the
  manual clock; no timer is created. Queue sequence, fault ordinals, journals,
  seen-message commitments, and delivery handles are tenant-and-purpose scoped.
  Fault rules bind an exact `tenantId` and `purpose`; journals require a current
  issued scope and expose only content-free action/operation/ordinal entries.
  A message ID and commitment remains terminal after active, leased,
  acknowledged, lost-ack, or dead-letter states until controller reset: the exact
  commitment replays as a no-op, while a different commitment conflicts.
  The per-scope terminal commitment registry is bounded at exactly `64` IDs;
  replay and conflict checks occur before capacity, and the bound survives all
  terminal queue outcomes until reset.
- Vectors use an exact brute-force finite dot product with fixed dimension and
  bounded non-negative-zero coordinates; each product and sum is checked for
  finite safe-range arithmetic.
  Query results are ID-and-score only and never add score perturbations.
- Provider fixtures return preconfigured output references tagged
  `untrusted_data`; they have no network, retry, credential, or egress path.
  The tool catalogue is empty and execution always denies without effects.
- Inputs are bounded plain JSON-like data. Arrays must have only exact numeric
  own data fields plus non-enumerable `length`; objects must have only own
  enumerable data fields. Cycles, accessors, symbols, prototype anomalies,
  non-finite or negative-zero numbers, invalid strings, and capacity/byte
  overflows fail with a content-free error code before mutation. Returned data
  is descriptor-read, deep-copied, and frozen.
- This Node-local test adapter rejects JavaScript `Proxy` values through the
  reviewed, narrowly architecture-bound `node:util` proxy detector before any
  reflection or descriptor operation. That is not a portable application-port
  guarantee and does not claim protection from a hostile process or runtime.
- Provider fixture lookup is exact across tenant, purpose, operation, attempt,
  request, provider, model, policy, and compiler. All misses have the same
  denial shape; output references remain untrusted data.

## Deferred work

Real identity claims, durable transactions/outbox behavior, vendor queues,
CockroachDB vector semantics, provider policy/transmission, public contracts,
receipts, cryptography, tools, integrations, cloud activity, and production
operations remain separate later tasks. B04 makes no vendor, latency,
durability, or operational-security claim.
