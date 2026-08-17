# C01 identity and claims boundary

## Scope and authority

C01.1 authenticates principal identity only. Cognito at TB-01 never selects, resolves, implies, or authorizes a tenant, purpose, role, operation, origin mode, workload, membership, or policy scope. The authenticated result contains exactly a Cognito provider marker, subject, issuer, client ID, and issued, expiry, and authentication times. It contains no credential, bearer, token ID, raw claims, email, profile, groups, custom claims, tenant, purpose, role, scope, membership, workload, operation, or authorization field.

This is a local/synthetic contract and adapter under exact HG2-RP01. The profile's single synthetic tenant remains outside authentication output. C01.1 performs no Cognito, AWS, JWT parsing, signature verification, JWKS lookup, SDK, network, credential, hosted runtime, cloud, or real-data activity.

## Primitive trust boundaries

```text
adapter/composition settles verification and server time outside application
  -> primitive canonical projection string or undefined
  -> primitive server-owned epoch seconds
  -> pure application validator
  -> typeof string and 1,090-byte bound before JSON.parse
  -> exact canonical allowlisted projection
  -> issuer/client/access-use/time checks
  -> deeply frozen principal-only result or content-free denial
```

The application service constructor captures only server-owned expected issuer, expected client ID, and clock skew after primitive validation. Each call receives exactly two data values: `verifiedProjection: unknown` and `serverNowEpochSeconds: unknown`. The service invokes no verifier, clock, Promise sink, callback, thenable, adapter, or other external code. It performs no asynchronous work. `undefined` projection maps to `VERIFICATION_FAILED`; any other non-string projection maps to `MALFORMED_PROJECTION` by `typeof` before reflection, iteration, cloning, property access, coercion, or Promise handling. A nonnumber, non-safe-integer, negative, or overflow-unsafe current time maps to `INVALID_SERVER_CONFIGURATION`.

Passing an already rejected Promise, Promise subclass, poisoned constructor/species object, proxy-wrapped Promise, custom thenable, or executable function is caller behavior created outside this validator. The validator rejects those objects by `typeof` with zero property or trap execution. It cannot and does not claim to settle, await, cancel, observe, or suppress arbitrary detached executable behavior or unhandled rejections created by its caller. Composition must settle and handle those operations before calling the validator.

The settled projection remains untrusted data. Before parsing, the application computes bounded UTF-8 length with early exit. JSON parsing creates a local inert graph; only then may exact fields be read.

## Projection contract and time semantics

- Expected issuer: visible ASCII, 1 through 512 bytes.
- Expected client ID: visible ASCII, 1 through 128 bytes.
- Subject: visible ASCII, 1 through 256 bytes.
- Projection JSON: 1 through 1,090 UTF-8 bytes before parsing.
- Current, issued, expiry, and authentication times: finite non-negative safe-integer Unix seconds.
- Clock skew: a non-negative safe integer from 0 through 300 seconds.
- Exact projection keys and fixed serialization order: `authenticatedAtSeconds`, `clientId`, `expiresAtSeconds`, `issuedAtSeconds`, `issuer`, `provider`, `subject`, `tokenUse`.
- `provider` must be `cognito`; `tokenUse` must be `access`. ID tokens deny.
- Time order is `authenticatedAtSeconds <= issuedAtSeconds < expiresAtSeconds`.
- Not-yet-active means issued or authentication time is greater than `now + skew`.
- Expired means `expiresAtSeconds <= now - skew`; equality is denied.

After structural and primitive validation, the application serializes a fresh fixed-key object and requires byte equality with the input. Duplicate keys, unknown keys, reordered keys, whitespace, alternate escapes, and noncanonical number encodings therefore deny. Validation order is server-time primitive validation, settled-verification failure, projection primitive and byte bound, parse, exact canonical projection, provider, issuer, client ID, token use, time order, future bound, then expiration.

Closed denials are `INVALID_SERVER_CONFIGURATION`, `VERIFICATION_FAILED`, `MALFORMED_PROJECTION`, `ISSUER_MISMATCH`, `CLIENT_ID_MISMATCH`, `TOKEN_USE_MISMATCH`, `NOT_YET_ACTIVE`, and `EXPIRED`. They are frozen, stable, and never echo input.

## Canonical synthetic fixture boundary

`createLocalCognitoShapedSyntheticVerifier` accepts one `unknown` value. It rejects anything except a primitive string using `typeof`, so caller proxies, getters, functions, symbols, bigints, and object graphs are never inspected. The string is bounded to 16,384 UTF-8 bytes before `JSON.parse`. The parsed local graph must have canonical recursively key-sorted JSON bytes and exact top-level shape:

```text
{"fixtures":[{"credentialRef":"...","rawClaims":{...}}]}
```

Exact exported limits are: 8 credentials; 128 bytes per credential reference; 16 properties per object; 16 entries per array; 160 total JSON nodes including every primitive; depth 7; 256 UTF-8 bytes per string or key; and, independently for each raw-claims subtree, 2,048 canonical bytes, 128 nodes, and depth 4. The factory rejects duplicates and any canonical reserialization mismatch. It traverses only `JSON.parse` output and never clones raw claims.

Only the fixed allowlisted projection is serialized and retained for each opaque fixture credential. Ignored adversarial claims such as tenant, role, purpose, groups, scope, email, profile, or custom values remain fixture-local and are never returned.

## Tenant-claim nonauthority and future adapter

Even a future cryptographically valid token's tenant-like or authorization-like claims have no tenant-selection, membership, purpose, role, operation, or authorization meaning at TB-01. Later server-owned tenant and purpose resolution belongs to separate C01/C02 contracts and policy checks.

The local adapter is intentionally named Cognito-shaped and synthetic. It must never be called a real Cognito verifier. A future real adapter requires a separate task and authority for cryptographic JWT verification, pinned algorithms and key use, bounded JWKS retrieval and caching, key rotation, Cognito client and token-use rules, timeout/failure policy, non-leaking telemetry, and executed AWS evidence. None is implemented or inferred here.

## Composed static enforcement

C01 does not assign semantic authority-flow responsibility to the dependency
graph checker. The root `pnpm lint:deps` gate requires both the layer/import
checker and the B03 content-free semantic source-security scanner. The root
build runs that composed gate before compilation. B03 carries recognized
dynamic-code, global, reflection, descriptor, prototype, loader, network, and
other protected authority tags through bounded aliases, assignments,
containers, returns, exports, and expression wrappers, and fails closed at
unresolved call, construction, or template-tag sinks. Its strict synthetic
corpus covers the R5/R6 constructor, catch-scope, reflection, carrier,
assignment, return, and wrapper families. This remains conservative static
analysis, not complete JavaScript semantics or a runtime sandbox.

R10 extends that gate across `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`,
`.mts`, and `.cts`, including declaration files, with fail-closed parse,
token, nesting, node, resolution-step, directory, entry, file, and byte
budgets. It classifies computed property reflection, descriptor operations,
enumeration, assignment, spread/rest, and `for-in` implicit reads. Three tiny
reviewed helper modules receive only computed/implicit/unsupported-authority
privilege through exact LF, no-BOM, raw-byte SHA-256 pins. A path, byte,
capability, guard, argument, or body change removes that privilege. The
scanner bootstrap has no static or dynamic path to those helpers before it
checks their bytes.

All exported foundation reflection helpers require caller-validated,
non-`Proxy` plain JSON objects or arrays. ECMAScript provides no portable,
side-effect-free `Proxy` predicate. These helpers therefore do not establish
caller provenance and must not be used directly on arbitrary external
objects. Product ingress must first establish the local plain-data boundary;
the Node-local synthetic harness separately uses `node:util.types.isProxy`.
