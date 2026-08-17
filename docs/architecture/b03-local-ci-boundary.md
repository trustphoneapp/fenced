# B03 local CI, supply-chain, and provenance boundary

**Current successor label:** `B05_CLEANROOM_PROVENANCE_PENDING_EXTERNAL_REVIEW`

**Acceptance state:** `CANDIDATE_CANNOT_BECOME_ACCEPTED_COMPLETION_UNTIL_UNCHANGED_TERRA_SECURITY_LEAN_CHIEF_AND_GOVERNANCE_TRANSITION`

This baseline is local and synthetic. One canonical machine policy at
`ci/b03-policy.json` binds the reviewed lockfile, workspace manifests, exact
license rules, NOTICE decision, source-security budgets, reproducibility output
namespaces, artifact paths, and honest limitations. The policy is a reviewed
identity record; it is not self-authenticating.
This exact candidate cannot become an accepted completion label until its
unchanged bytes pass Terra, then Security, then Lean, then Chief review and a
separate governance transition records that result. All detached provenance
review slots remain pending and unpopulated.

All B03 canonical key, path, subject, dependency, and finding order uses one
shared comparator over exact UTF-8 bytes. It uses deterministic tie handling
for byte-equivalent JavaScript strings and compares compound keys one field at
a time. No locale-sensitive ordering participates in generated evidence.

The built-in-Node supply-chain verifier requires a registry source and
SHA-512 SRI for every locked package, closes every external manifest dependency
into that exact lock set, maps every locked component to exactly one versioned
license/NOTICE rule, and checks a deterministic CycloneDX SBOM with SPDX
expressions, valid scoped-package purls, and workspace dependency edges.
For all 109 locked components it also validates a mechanically generated local
evidence record: 53 expected-present packages bind canonical manifest bytes,
declared license fields, and every available top-level license file, while 56
non-host optional platform packages explicitly remain
`ABSENT_OPTIONAL_PLATFORM_LOCK_METADATA_ONLY`. Four present packages have no
top-level license file and are honestly manifest-only. This local identity
evidence is not legal clearance or online registry verification.
Vulnerability status is exactly
`UNKNOWN/NOT_EXECUTED_NO_ADVISORY_SNAPSHOT`. No hosted advisory scan or action
pin is claimed.

The A01-shaped provenance envelope records exact per-artifact identities,
a canonical aggregate, predecessor/supersession facts, and empty detached
Terra, Security, Lean, and Chief review slots. It deliberately has no digest of
itself and does not invent review evidence. It states that external exact-review
binding is required and records bounded input identities. The current B05
successor preserves exact B03 R12 and B04 R1-R5 history, excludes its own
envelope from the subject set, and binds every other regular file discovered
through the B05 governed topology. Policy subjects, discovered files, and
artifact entries must be byte-order-identical sets.
The schema-5 trust baseline binds exact local trust-anchor bytes. Before tool use, its
bounded payload inventory re-walks all 53 expected-present locked package trees
as canonical and symlink-free—including Biome JavaScript and native payloads,
TypeScript `lib`, Vite `dist`, and Vitest `dist`—and verifies every regular
file's path, mode, size, and SHA-256 plus tree and aggregate digests.
Host Node, pnpm, and package-tree hashes are local identity evidence only: they
are not signatures, provenance attestations, vendor authenticity, or
cross-host proof.

Both evidence generators use one dependency-free safe writer. It resolves and
checks the real repository root, accepts only each generator's exact
repository-relative target allowlist, and component-wise rejects missing,
symlinked, special, noncanonical, or replaced parents and targets. A write uses
an unpredictable same-directory `wx` temporary regular file, forces mode
`0644`, fully writes, syncs, and closes it, then revalidates parent and target
identity immediately before atomic rename. Failure cleanup removes only the
temporary file whose device and inode were created by that writer; it never
deletes the destination. This control assumes a non-malicious local runner.
The final revalidation-to-rename interval remains a bounded TOCTOU limitation;
it is not a defense against an attacker concurrently mutating the filesystem.

The source-security verifier scans all bounded first-party executable source,
test, and root configuration files with exact exclusions, extensions, file
counts, and byte budgets. It performs content-free secret checks and
TypeScript-AST capability checks for child processes, filesystem effects,
network access, dynamic imports/code, environment reads, import-equals,
require/authority aliases, destructured globals, computed authority access,
and indirect evaluation against exact least-capability allowlists. A shared
lexical-binding resolver gives the direct checker and semantic scanner the same
source, function, block, catch, case, loop, class, and module scope identities,
including function/`var` hoisting, block-scoped declarations, parameters,
imports, destructuring, mutation, and nearest-binding lookup. Semantic tags and
tracked properties are keyed by those binding identities, so a same-spelled
inner binding cannot erase an outer binding's authority. Unsupported computed
or aliased authority use fails closed.

The root boundary is deliberately composed rather than duplicated.
`check-dependencies.mjs` owns layer direction, imports, cycles, exact reviewed
static capability shape, and bounded direct syntax rejections.
`verify-source-security.mjs` owns semantic authority tags and their transport.
`pnpm lint:deps` runs both controls in that order, and the root build runs this
composed gate after exact build-output cleanup and before TypeScript
compilation. Safe verification continues to invoke both reviewed local stages
separately under its operation lock.
Failures expose only repository-relative paths and rule identifiers—never
matched content or a content digest. Every visited entry is `lstat`-checked
before an excluded directory is skipped; symlinks and special files fail
closed.

This is a conservative, bounded syntactic capability gate, not a complete
JavaScript semantic or interprocedural dataflow proof. It tags sensitive
globals, module loaders, privileged module values, callable objects,
descriptor/prototype results, unresolved reflection results, and authority
containers. Tags propagate through recognized aliases, assignments,
containers, returns, exports, conditionals, logical/comma expressions, and
TypeScript expression wrappers. Call, construction, and template-tag sinks
fail closed for unresolved transported authority. Ordinary untagged data
indexing and reflection used for runtime validation remain untagged; reflection
becomes authority-bearing when an input is already tagged as callable,
prototype, descriptor, reflection, global, loader, network, process, or another
protected authority. A tagged value or
protected authority name crossing an unresolved call, return, container,
computed access, destructuring, or reflective operation fails closed unless
the exact file has the applicable reviewed capability allowance. The narrow
`unsupported_authority` allowlist is reserved for verifier/test machinery that
intentionally transports protected names as inert review data; adversarial
fixtures use empty allowlists.

Exact `constructor` property access is dynamic-code acquisition regardless of
receiver; the other reviewed prototype-chain properties fail closed as
unsupported authority. The same spellings carried as ordinary string data use
a distinct inert property-name tag: JSON serialization, ordinary argument
transport, and ordinary returns remain safe, while using that tag as a computed
or reflective property key activates the applicable property rule. Re-exports
of builtin authority are categorized, local tagged exports fail closed, and
ordinary relative or type-only exports remain safe.

Before TypeScript parsing, a policy-bound lexical pass caps tokens and delimiter
nesting. After parsing and before semantic resolution, iterative checks cap AST
nodes and depth; semantic resolution has a per-file step cap. Exceeding any cap
returns only the repository-relative path and
`SOURCE_SECURITY_AST_BUDGET_EXCEEDED`. These controls bound accepted input and
the repository's own traversal work, but TypeScript's parser remains an
upstream in-process dependency: the token and nesting precheck reduces its
input risk without proving a hard parser CPU or memory bound. Parser
implementation defects and parser work within the admitted lexical limits
remain an explicit residual.

The checked-in capability policy contains exact live capability/path pairs. Its
liveness test copies only those allowlisted source files into an isolated
synthetic root, first proves the full policy clean, then removes each pair
individually and requires the exact path/capability finding. Dead entries are
removed rather than justified with synthetic authority fixtures.

Network detection is explicitly bounded to Node built-in `http`, `https`,
`net`, `tls`, `dns`, and `dgram` imports/loads—including recognized
`getBuiltinModule` and `createRequire` paths—and these browser forms:
direct/window/globalThis `fetch`, `XMLHttpRequest` construction plus tracked
`open`/`send`, `EventSource`, `WebSocket`, and `navigator.sendBeacon`.
Property/element authority assignments and parameter defaults fail closed and
remain tagged where their syntax can be tracked. This list does not claim to
cover every conceivable egress API, host extension, native binding, or
semantically constructed transport.

Executable `.html` build inputs participate in the same file/byte budgets and
content-free secret scan. A separate policy-bound lexical gate—not a full HTML
parser—handles ASCII case/whitespace, selected common entities, bounded
repeated percent decoding, ASCII control folding, and backslash rejection. It
fails closed on inline script bodies, inline event handlers, `srcdoc`,
`javascript:` or `data:text/html` active URLs, malformed/ambiguous active
constructs, and nonlocal active resources for scripts, frames, objects,
embeds, stylesheet links, images/sources, audio/video, and forms. Local asset
references must be normalized, scheme-free, non-protocol-relative,
backslash-free, traversal-free paths contained by the exact document asset
root. Within an opening tag, `/` is accepted only as the terminal
self-closing marker followed solely by allowed ASCII whitespace; slash-based
attribute-prefix ambiguity fails closed. Opening-tag edge handling removes
only exact ASCII whitespace and preserves the raw attribute suffix for slash
validation, so non-ASCII whitespace after `/` is unsupported. A stylesheet link's `rel` value uses
the same bounded entity and percent decoding, rejects ambiguous encodings and
controls, then applies ASCII case-folded whitespace tokenization before its
`href` is classified. This conservative lexical control does not claim
browser-equivalent parsing, DOM mutation analysis, CSS URL analysis, or
coverage of every HTML execution or loading mechanism.

The dependency-free bootstrap portion of each safe entry script is externally
tuple-bound review material. It statically imports built-ins only, executes the
preflight before loading any other repository module, and only then dynamically
loads the verified operation lock and downstream helpers. The preflight and
bootstrap cannot authenticate themselves; the baseline is a checked downstream
identity record whose meaning depends on independent exact-tuple review.

After the preflight, the existing repository operation lock remains the sole
orchestrator lock. Verification invokes pnpm only through its resolved,
hash-bound absolute path, deletes only exact generated output namespaces,
builds twice on the same host, and compares path, mode, length, and SHA-256 for
every output. This is
`SAME_HOST_TWO_BUILD_ONLY`.

This successor does not claim hosted CI, an advisory snapshot, action pinning,
signed or external provenance, malicious-runner resistance, cross-host or
clean-clone reproducibility, release-byte reconciliation, a clean-room audit,
deployment, submission, or production readiness. B05 remains pending external
exact review; V01, V06, and later
hosted/operational work retain those responsibilities.
