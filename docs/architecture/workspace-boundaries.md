# B01 workspace boundaries

## Scope

This workspace is a buildable dependency skeleton. It defines package direction,
composition roots, local enforcement, and an empty infrastructure shell. It does
not define public schemas, runtime integrations, persistence, identity, queues,
providers, vectors, tools, MCP execution, or cloud resources.

## Dependency direction

```text
foundation
  ↑
domain     contracts
  ↑          ↑
policy ──────┘
  ↑
application
  ↑
adapters-local
  ↑
api / worker composition roots

contracts → web composition root
```

The checked-in `architecture-boundaries.json` is executable policy:

- core packages may use only explicitly listed inward workspace dependencies;
- core packages may not import Node built-ins, environment state, network
  functions, provider SDKs, or undeclared external packages;
- adapters stay outside application and policy;
- API and worker packages are composition roots;
- web may consume only public contracts plus React;
- relative imports must remain inside this repository;
- relative imports must resolve to an existing, symlink-free file owned by a
  declared layer source boundary;
- the complete import graph must remain acyclic.

`check-dependencies.mjs` enforces these graph, import, and exact static
capability-shape rules. The root `pnpm lint:deps` command composes that checker
with the B03 semantic source-security scanner, so the command passes only when
both controls pass. The root build runs the same composed gate after cleaning
build outputs and before compilation. Architecture tests include intentionally
invalid fixtures for an inward dependency, a cycle, and a repository escape.
Additional tests reject an unowned root-local import, a root-level symlink, a
generated-output symlink, and a requested root that is itself a symlink. Escape
and symlink checks reject the path before reading or following its target.
TypeScript compiler-AST checks cover static imports/exports, import-equals,
dynamic import, `require`, `require.resolve`, computed module specifiers, Node
built-ins, provider SDKs, and direct, computed, or aliased core authority access.
Triple-slash path, types, and lib references plus AMD dependency/module
directives are rejected before any referenced target can be read.
Comments, normal strings, and type-only syntax do not create executable authority.

The dependency checker is trusted-source architecture lint and a supply-chain
guard; it does not own general semantic authority-flow proof. B03 owns the
bounded semantic tag model for computed, aliased, reflected, stored, returned,
or later-invoked authority. The composed gate is not a security sandbox and
does not claim complete JavaScript semantics or that B01/B03 alone prevents
malicious checked-in source from executing. Runtime compartments, capability
isolation, least-authority execution, and hostile-code containment remain later
reviewed security tasks.

`pnpm verify:cleanroom` checks repository-local paths and dependency boundaries
across the whole repository namespace. `.git`, `node_modules`, and generated
output directories are excluded from recursion only after `lstat` proves each is
a real directory. The check does not read, inspect, hash, scan, or otherwise
access the private project.

`pnpm verify:paths` is a pre-compiler trusted-build-path guard. It parses every
checked-in `tsconfig*.json` as TypeScript JSON without asking the compiler to
resolve inputs first. It validates `extends`, files, globs, project references,
compiler input/output directories, build-info paths, aliases, type roots, root
directories, and module-loading options. Absolute, URL, Git-style, external,
unresolved required, and symlinked paths fail closed. Internal `..` segments are
accepted only after canonical containment and every existing path component are
proved inside this repository. Plugins, automatic type acquisition, and module
suffix search are prohibited. Extends/reference cycles are rejected.
Discovery excludes only the exact repository-root `.zc-bootstrap` ephemeral
namespace before per-entry stat traversal, after the owning lock/path guard has
validated that namespace. Bootstrap create/delete churn therefore cannot race
configuration discovery. Similarly named or nested directories remain scanned,
and `ENOENT` or other traversal races everywhere outside that exact namespace
remain failures.

The bootstrap trust sequence starts outside package-manager scripts:

```text
node scripts/check-manifests.mjs
node scripts/safe-pnpm-install.mjs --offline
node scripts/check-manifests.mjs
node scripts/safe-verify.mjs
```

`check-manifests.mjs` plus its two static local imports,
`repository-operation-lock.mjs` and `verify-trust-preflight.mjs`, is the first
externally exact-tuple-bound local trust-anchor graph in this documented
bootstrap sequence. It is not a built-in-only or self-authenticating preflight
root: those local bytes require external exact review binding and remain local
identity evidence. The safe entry scripts `safe-pnpm-install.mjs` and
`safe-verify.mjs` separately own a built-in-only static bootstrap and run the
verified preflight before dynamic downstream imports. The
`check-manifests.mjs` manifest scan covers the root manifest and the ten exact
workspace/layer manifests after component-wise symlink checks.
It enforces names, paths, privacy, pinned dependency sources, workspace-only
internal references, package-contained build/resolution targets, an exact
workspace importer set, lock/package-manager coherence, and a safe `.npmrc`.
Every root and workspace script name and command is pinned to an exact
per-package allowlist; packages without approved scripts must have none.
Install/publish lifecycle hooks and implicit pre/post hooks are prohibited. Absolute, protocol, Git,
file, alias, backslash, parent-traversal, unknown conditional, and symlinked
manifest targets fail before target content can be read. `typesVersions` is
prohibited so TypeScript cannot introduce a second unchecked declaration
resolution map. The package `verify`
script is only an alias to `node scripts/safe-verify.mjs`,
but package scripts remain noncanonical because pnpm may act before the script
starts. Canonical CI must invoke
`node scripts/check-manifests.mjs` directly before invoking any package-manager
script and must invoke `node scripts/safe-verify.mjs` directly for verification.
The safe verifier accepts no arguments, reuses repository-local isolated state,
resolves exact reviewed tool identities and entrypoints inside the installed
dependency tree, and executes only the fixed verification stages without shell
shims or package-manager re-entry.

The reviewed `.npmrc` is byte-exact and permits only
`ignore-pnpmfile=true`, `ignore-scripts=true`, `save-exact=true`, and
`strict-peer-dependencies=true`. Additional repository `.npmrc`, pnpmfile, and
pnpm hook/config files are rejected without execution. The lockfile is bound to
the reviewed B01 SHA-256, byte count, and LF count; dependency changes require a
deliberate baseline update and review.

`safe-pnpm-install.mjs` accepts only optional `--offline`, validates before and
after installation, requires pnpm `11.9.0`, strips npm/pnpm/Corepack/Node config
override environment variables, and never preserves ambient home, temp, or XDG
paths. It creates an atomic run directory under the checked real
`.zc-bootstrap/` parent and uses the checked real `.zc-pnpm-store/` for its
cache, store, state, and virtual store. All installer paths are canonical,
repository-contained, and component-wise free of symlinks. It supplies isolated
empty user/global configs and invokes only fixed
frozen/no-scripts/no-pnpmfile/store/config arguments. Run directories are
removed automatically; the two ignored repository-local roots may be removed
when no installer is active and recreated by the wrapper. The
host Node and pnpm binaries remain trusted B01 toolchain inputs; binary
provenance and attestation are deferred to B03.

Both `safe-pnpm-install.mjs` and `safe-verify.mjs` acquire the same atomic,
repository-scoped `.zc-bootstrap/repository-operation.lock` before any shared
store, reviewed tool, compiler, test, or build access. A concurrent invocation
fails immediately with a bounded content-free error; it does not wait, inspect
the active owner token, or touch shared state. Release verifies the exact
random 192-bit owner token and removes only that owned token and now-empty lock
directory. A preexisting, replaced, malformed, or symlinked lock is never
deleted. Clean-room and manifest guards recognize only this exact ephemeral
lock name and shape. Deterministic child-process tests use a readiness/release
handshake (not timing sleeps) to prove contention, release, and reacquisition.

This local exclusion guard prevents overlapping Continuity bootstrap and
verification processes from racing shared repository state. B03 still owns CI
runner isolation, cancellation policy, stale-lock operational recovery,
cross-host coordination, provenance, and attestation; this B02/B01-local guard
does not claim those controls.

The directly invoked `check-manifests.mjs`, `safe-pnpm-install.mjs`,
`safe-verify.mjs`, and their imported `repository-operation-lock.mjs` bytes are
B01 trust anchors. Their exact reviewed hashes must be bound in evidence. These
controls validate downstream repository paths and tools; they do not
self-protect if an initially loaded trust-anchor byte is replaced before
execution.
