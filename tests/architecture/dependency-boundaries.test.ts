import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  copyFileSync,
  cpSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ownDataEntries, readOwnData } from "../../scripts/safe-own-data.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const b03Policy = JSON.parse(
  readFileSync(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
);
const checker = path.join(repositoryRoot, "scripts", "check-dependencies.mjs");
const fixtures = path.join(repositoryRoot, "tests", "architecture", "fixtures");
const canonicalClosureLine =
  "dependency-boundary: PASS (10 layers; status=POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_CLOSURE_PASS; limitations=FULL_TRUST_ANCHOR_RUNTIME_CLOSURE_UNPROVEN,PHASE0_PREEXECUTION_TRUST_UNPROVEN)\n";
const canonicalFinalizerState = () => {
  const provenance = b03Policy.currentProvenance;
  if (
    typeof b03Policy.provenancePath !== "string" ||
    provenance?.path !== b03Policy.provenancePath ||
    typeof provenance.recordId !== "string" ||
    typeof provenance.taskId !== "string" ||
    typeof provenance.actor !== "string" ||
    typeof provenance.predicateType !== "string"
  )
    throw new Error("canonical finalizer provenance target invalid");
  const target = path.join(repositoryRoot, b03Policy.provenancePath);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "preseal";
    throw error;
  }
  const record = JSON.parse(readFileSync(target, "utf8"));
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o644 ||
    stat.nlink !== 1 ||
    realpathSync(target) !== target ||
    record.record_id !== provenance.recordId ||
    record.task_id !== provenance.taskId ||
    record.operational_actor?.public_id !== provenance.actor ||
    record.predicate?.predicate_type !== provenance.predicateType
  )
    throw new Error("canonical finalizer state differs");
  return "postseal";
};
const bootstrapNodePaths = [
  "bounded-typescript-ast.mjs",
  "check-dependencies.mjs",
  "check-manifests.mjs",
  "check-tsconfig-paths.mjs",
  "lexical-bindings.mjs",
  "path-safety.mjs",
  "repository-operation-lock.mjs",
  "safe-own-data.mjs",
  "verify-source-security.mjs",
  "verify-trust-preflight.mjs",
] as const;

function run(root: string, allowSynthetic = false) {
  return spawnSync(process.execPath, [checker, root], {
    encoding: "utf8",
    env: allowSynthetic ? { TMPDIR: tmpdir(), ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" } : {},
  });
}

type BootstrapEdit = {
  readonly path: string;
  readonly transform: (source: string) => string;
};

function runBootstrapSetup(setup: (root: string) => void) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-bootstrap-n1-")));
  try {
    cpSync(path.join(repositoryRoot, "scripts"), path.join(root, "scripts"), { recursive: true });
    setup(root);
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const checker=await import("./scripts/check-dependencies.mjs");const summary=await checker.derivePostPreflightValidatorBootstrapTopology(process.argv.at(-1));console.log(summary.status);',
        root,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { TMPDIR: tmpdir(), ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" },
      },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function runBootstrapEdits(edits: readonly BootstrapEdit[]) {
  return runBootstrapSetup((root) => {
    for (const edit of edits) {
      const target = path.join(root, edit.path);
      writeFileSync(target, edit.transform(readFileSync(target, "utf8")), "utf8");
    }
  });
}

function runBootstrapTrustEdit(edit: BootstrapEdit) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-bootstrap-trust-")));
  try {
    cpSync(path.join(repositoryRoot, "scripts"), path.join(root, "scripts"), { recursive: true });
    symlinkSync(path.join(repositoryRoot, "node_modules"), path.join(root, "node_modules"), "dir");
    const target = path.join(root, edit.path);
    writeFileSync(target, edit.transform(readFileSync(target, "utf8")), "utf8");
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const checker=await import("./scripts/check-dependencies.mjs");const summary=await checker.derivePostPreflightValidatorBootstrapTopology(process.cwd());console.log(summary.status);',
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { TMPDIR: tmpdir(), ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" },
      },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const appendBootstrap = (path: string, suffix: string): BootstrapEdit => ({
  path,
  transform: (source) => `${source}${suffix}\n`,
});
const replaceBootstrap = (path: string, from: string, to: string): BootstrapEdit => ({
  path,
  transform: (source) => {
    if (!source.includes(from)) throw new Error(`bootstrap fixture token missing: ${from}`);
    return source.replace(from, to);
  },
});

function writeSizedSource(filename: string, size: number) {
  const source = readFileSync(filename, "utf8");
  const padding = size - Buffer.byteLength(source) - 5;
  if (padding < 0) throw new Error("bootstrap size target is too small");
  writeFileSync(filename, `${source}/*${"x".repeat(padding)}*/\n`, "utf8");
}

type BootstrapRacePhase = "BEFORE_OPEN" | "BEFORE_READ";

async function runBootstrapRace(phase: BootstrapRacePhase) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-bootstrap-n2b-")));
  const target = path.join(root, "scripts", "path-safety.mjs");
  const preload = path.join(root, "barrier.cjs");
  let child: ReturnType<typeof spawn> | undefined;
  let closePromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  const bounded = async <T>(promise: Promise<T>, label: string) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`N2b ${phase} ${label} timeout`)), 5_000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  try {
    cpSync(path.join(repositoryRoot, "scripts"), path.join(root, "scripts"), { recursive: true });
    writeFileSync(
      preload,
      `const fs = require("node:fs/promises");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const originalOpen = fs.open;
const target = path.resolve(process.env.ZC_RACE_TARGET);
const phase = process.env.ZC_RACE_PHASE;
let opens = 0;
const barrier = () => new Promise((resolve) => {
  process.once("message", (message) => { if (message === "CONTINUE") resolve(); });
  process.send({ count: opens, phase, target, type: "READY" });
});
fs.open = async function patchedOpen(filename, ...arguments_) {
  const selected = path.resolve(String(filename)) === target && ++opens === 2;
  if (selected && phase === "BEFORE_OPEN") await barrier();
  const handle = await originalOpen.call(this, filename, ...arguments_);
  if (selected && phase === "BEFORE_READ") {
    const originalRead = handle.read.bind(handle);
    let reads = 0;
    handle.read = async (...readArguments) => {
      if (++reads === 1) await barrier();
      return originalRead(...readArguments);
    };
  }
  return handle;
};
syncBuiltinESMExports();
`,
      "utf8",
    );
    child = spawn(
      process.execPath,
      [
        "--require",
        preload,
        "--input-type=module",
        "--eval",
        'const checker=await import("./scripts/check-dependencies.mjs");await checker.derivePostPreflightValidatorBootstrapTopology(process.argv.at(-1));',
        root,
      ],
      {
        cwd: repositoryRoot,
        env: {
          TMPDIR: tmpdir(),
          ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1",
          ZC_RACE_PHASE: phase,
          ZC_RACE_TARGET: target,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    closePromise = new Promise((resolve) => {
      child?.once("close", (code, signal) => resolve({ code, signal }));
    });
    const readyPromise = new Promise<void>((resolve, reject) => {
      child?.once("message", (message) => {
        if (
          !message ||
          typeof message !== "object" ||
          JSON.stringify(message) !== JSON.stringify({ count: 2, phase, target, type: "READY" })
        ) {
          reject(new Error(`N2b ${phase} invalid READY message`));
          return;
        }
        resolve();
      });
    });
    await bounded(
      Promise.race([
        readyPromise,
        closePromise.then(({ code, signal }) => {
          throw new Error(`N2b ${phase} exited before READY: ${code}/${signal}`);
        }),
      ]),
      "READY",
    );
    const before = statSync(target);
    expect(before.mode & 0o7777).toBe(0o644);
    expect(before.nlink).toBe(1);
    if (phase === "BEFORE_OPEN") {
      const replacement = path.join(root, "path-safety-replacement.mjs");
      copyFileSync(target, replacement);
      chmodSync(replacement, 0o644);
      const replacementStat = statSync(replacement);
      expect(readFileSync(replacement)).toEqual(readFileSync(target));
      expect(replacementStat.ino).not.toBe(before.ino);
      renameSync(replacement, target);
    } else {
      const source = readFileSync(target, "utf8");
      const variant = source.replace("path escapes", "path escaper");
      expect(variant).not.toBe(source);
      expect(Buffer.byteLength(variant)).toBe(before.size);
      writeFileSync(target, variant, "utf8");
      expect(readFileSync(target)).not.toEqual(Buffer.from(source));
      expect(variant.endsWith("\n") && !variant.includes("\r")).toBe(true);
    }
    const after = statSync(target);
    expect({ dev: after.dev, mode: after.mode, nlink: after.nlink, size: after.size }).toEqual({
      dev: before.dev,
      mode: before.mode,
      nlink: 1,
      size: before.size,
    });
    expect(after.ino === before.ino).toBe(phase === "BEFORE_READ");
    child.send("CONTINUE");
    const result = await bounded(closePromise, "exit");
    return { ...result, stderr, stdout };
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      if (closePromise) {
        try {
          await bounded(closePromise, "cleanup");
        } catch {
          // Cleanup timeout is not admissible evidence; the original failure is preserved.
        }
      }
    }
    rmSync(root, { force: true, recursive: true });
  }
}

type CanonicalSentinelMode = "ORDER" | "FINAL_OPEN_FAIL" | "CONFIG_FAIL";

function runCanonicalSentinel(mode: CanonicalSentinelMode) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-c2b-order-")));
  const preload = path.join(root, "order.cjs");
  try {
    writeFileSync(
      preload,
      `const fs = require("node:fs/promises");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const root = process.env.ZC_SENTINEL_ROOT;
const nodes = new Set(JSON.parse(process.env.ZC_SENTINEL_NODES).map((node) => path.join(root, "scripts", node)));
const mode = process.env.ZC_SENTINEL_MODE;
const counts = new Map(Array.from(nodes, (node) => [node, 0]));
let preflight = false;
const originalOpen = fs.open;
const originalReadFile = fs.readFile;
fs.open = async (filename, ...arguments_) => {
  const selected = path.resolve(String(filename));
  if (nodes.has(selected)) {
    if (!preflight) throw new Error("DERIVE_BEFORE_PREFLIGHT_SENTINEL");
    const count = counts.get(selected) + 1;
    counts.set(selected, count);
    if (mode === "FINAL_OPEN_FAIL" && selected.endsWith("/path-safety.mjs") && count === 2) {
      throw new Error("FINAL_OPEN_RECHECK_SENTINEL");
    }
  }
  return originalOpen(filename, ...arguments_);
};
fs.readFile = async (filename, ...arguments_) => {
  const selected = path.resolve(String(filename));
  if (selected === path.join(root, "ci", "trust-baseline.json")) preflight = true;
  if (selected === path.join(root, "architecture-boundaries.json")) {
    if (!preflight) throw new Error("CONFIG_BEFORE_PREFLIGHT_SENTINEL");
    if (!Array.from(counts.values()).every((count) => count === 2)) {
      throw new Error("CONFIG_BEFORE_FINAL_RECHECK_SENTINEL");
    }
    if (mode === "FINAL_OPEN_FAIL") throw new Error("CONFIG_REACHED_AFTER_FINAL_OPEN_FAILURE_SENTINEL");
    if (mode === "CONFIG_FAIL") throw new Error("POST_CLOSURE_CONFIG_READ_SENTINEL");
  }
  return originalReadFile(filename, ...arguments_);
};
syncBuiltinESMExports();
`,
      "utf8",
    );
    return spawnSync(process.execPath, ["--require", preload, checker], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ZC_SENTINEL_NODES: JSON.stringify(bootstrapNodePaths),
        ZC_SENTINEL_MODE: mode,
        ZC_SENTINEL_ROOT: repositoryRoot,
      },
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function runCapabilityMutation(suffix: string) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-capability-")));
  try {
    cpSync(path.join(fixtures, "node-util-capability-positive"), root, { recursive: true });
    const source = path.join(
      root,
      "packages",
      "adapters-local",
      "src",
      "local-synthetic-fixture.ts",
    );
    writeFileSync(source, `${readFileSync(source, "utf8")}\n${suffix}\n`, "utf8");
    return run(root, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function runLayerMutation(layer: string, sourceText: string) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-layer-authority-")));
  try {
    const layers = {
      application: { allow: [], kind: "application", path: "application" },
      core: { allow: [], kind: "core", path: "core" },
      generic_adapter: { allow: [], kind: "adapter", path: "generic-adapter" },
      web: { allow: [], kind: "ui", path: "web" },
    };
    for (const [, definition] of ownDataEntries(layers)) {
      cpSync(path.join(fixtures, "ast-benign", "core"), path.join(root, definition.path), {
        recursive: true,
      });
    }
    const selectedLayer = readOwnData<{ readonly path: string }>(layers, String(layer));
    if (!selectedLayer) throw new Error("missing test layer");
    writeFileSync(
      path.join(root, selectedLayer.path, "src", "authority.ts"),
      `${sourceText}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(root, "architecture-boundaries.json"),
      `${JSON.stringify({ layers }, undefined, 2)}\n`,
      "utf8",
    );
    return run(root, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function runCurrentProfile(setup: (root: string) => void = () => undefined) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-current-boundaries-")));
  try {
    for (const entry of ["apps", "packages", "infrastructure"])
      cpSync(path.join(repositoryRoot, entry), path.join(root, entry), { recursive: true });
    copyFileSync(
      path.join(repositoryRoot, "architecture-boundaries.json"),
      path.join(root, "architecture-boundaries.json"),
    );
    setup(root);
    return run(root, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("dependency boundaries", () => {
  it("derives the reviewed post-preflight validator bootstrap topology without executing it", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const checker=await import("./scripts/check-dependencies.mjs");const summary=await checker.derivePostPreflightValidatorBootstrapTopology(process.cwd());const frozen=Object.isFrozen(summary)&&Object.isFrozen(summary.limitations);console.log(JSON.stringify({closureAbsent:!("closurePassLabel" in summary),frozen,summary}));',
      ],
      { cwd: repositoryRoot, encoding: "utf8", env: {} },
    );
    expect(result.status, result.stderr).toBe(0);
    const { closureAbsent, frozen, summary } = JSON.parse(result.stdout);

    expect(Object.keys(summary).sort()).toEqual([
      "edgeCount",
      "edgeJsonBytes",
      "edgeSha256",
      "limitations",
      "nodeCount",
      "profileId",
      "profileRevision",
      "rootCount",
      "status",
    ]);
    expect(summary).toMatchObject({
      edgeCount: 15,
      edgeJsonBytes: 2149,
      nodeCount: 10,
      profileId: "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_V1",
      profileRevision: 18,
      rootCount: 5,
      status: "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_DERIVATION_MATCH",
    });
    expect(summary.edgeSha256).toBe(
      "4be5f6dc5bcb4d3bea8206bd338f021be2da3e1080d9011504fa4faebe1093b6",
    );
    expect(summary.limitations).toEqual([
      "FULL_TRUST_ANCHOR_RUNTIME_CLOSURE_UNPROVEN",
      "PHASE0_PREEXECUTION_TRUST_UNPROVEN",
    ]);
    expect({ closureAbsent, frozen }).toEqual({ closureAbsent: true, frozen: true });
  });

  it("leaves the fixed topology unchanged when trust adds an unrelated anchor", () => {
    const result = runBootstrapTrustEdit(
      replaceBootstrap(
        "scripts/verify-trust-preflight.mjs",
        '  "tests/architecture/cleanroom-boundaries.test.ts",\n]);',
        '  "tests/architecture/cleanroom-boundaries.test.ts",\n  "tests/architecture/dependency-boundaries.test.ts",\n]);',
      ),
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_DERIVATION_MATCH\n");
  });

  it("denies when trust removes an anchor required by a topology node", () => {
    const result = runBootstrapTrustEdit(
      replaceBootstrap("scripts/verify-trust-preflight.mjs", '  "scripts/path-safety.mjs",\n', ""),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "bootstrap topology node is not reviewed and anchored: scripts/path-safety.mjs",
    );
  });

  it.each([
    [
      "missing fixed topology node",
      [
        replaceBootstrap(
          "scripts/check-dependencies.mjs",
          'import { createLexicalBindings, isNameOnlyIdentifier } from "./lexical-bindings.mjs";\n',
          "",
        ),
        replaceBootstrap(
          "scripts/verify-source-security.mjs",
          'import { createLexicalBindings, isNameOnlyIdentifier } from "./lexical-bindings.mjs";\n',
          "",
        ),
      ],
      "nodes differ from the fixed profile",
    ],
    [
      "unreviewed local target",
      [
        replaceBootstrap(
          "scripts/check-dependencies.mjs",
          '"./path-safety.mjs"',
          '"./missing.mjs"',
        ),
      ],
      "outside the fixed profile",
    ],
    [
      "wrong local grammar",
      [
        replaceBootstrap(
          "scripts/check-dependencies.mjs",
          '"./path-safety.mjs"',
          '"../scripts/path-safety.mjs"',
        ),
      ],
      "route is not exact",
    ],
    [
      "repository escape",
      [replaceBootstrap("scripts/check-dependencies.mjs", '"./path-safety.mjs"', '"../../x.mjs"')],
      "route is not exact",
    ],
    [
      "extra reviewed edge",
      [appendBootstrap("scripts/check-manifests.mjs", 'import "./path-safety.mjs";')],
      "does not match the exact R5 derivation profile",
    ],
    [
      "topology cycle",
      [appendBootstrap("scripts/safe-own-data.mjs", 'import "./check-dependencies.mjs";')],
      "contains a cycle",
    ],
    [
      "export star",
      [appendBootstrap("scripts/check-manifests.mjs", 'export * from "./path-safety.mjs";')],
      "route is not static",
    ],
    [
      "dynamic literal import",
      [appendBootstrap("scripts/check-manifests.mjs", 'void import("./path-safety.mjs");')],
      "route is not static",
    ],
    [
      "dynamic nonliteral import",
      [appendBootstrap("scripts/check-manifests.mjs", "void import(process.argv[0]);")],
      "non-literal or computed dynamic module specifier",
    ],
    [
      "import equals",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import alias = require("./path-safety.mjs");',
        ),
      ],
      "route is not static",
    ],
    [
      "require literal",
      [appendBootstrap("scripts/check-manifests.mjs", 'void require("./path-safety.mjs");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "require computed",
      [appendBootstrap("scripts/check-manifests.mjs", "void require(process.argv[0]);")],
      "non-literal or computed dynamic module specifier",
    ],
    [
      "require resolve literal",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'void require.resolve("./path-safety.mjs");',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "require resolve computed",
      [appendBootstrap("scripts/check-manifests.mjs", "void require.resolve(process.argv[0]);")],
      "non-literal or computed dynamic module specifier",
    ],
    [
      "createRequire direct",
      [appendBootstrap("scripts/check-manifests.mjs", 'createRequire("x");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "getBuiltinModule direct",
      [appendBootstrap("scripts/check-manifests.mjs", 'process.getBuiltinModule("node:fs");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "register direct",
      [appendBootstrap("scripts/check-manifests.mjs", 'register("x");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "registerHooks direct",
      [appendBootstrap("scripts/check-manifests.mjs", "registerHooks({});")],
      "prohibited bootstrap loader authority",
    ],
    [
      "process computed optional",
      [appendBootstrap("scripts/check-manifests.mjs", "process?.[process.argv[0]];")],
      "prohibited bootstrap loader authority",
    ],
    [
      "process alias",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          "const processAlias = process; void processAlias;",
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "process destructuring",
      [appendBootstrap("scripts/check-manifests.mjs", "const { env } = process; void env;")],
      "prohibited bootstrap loader authority",
    ],
    [
      "process reflection",
      [appendBootstrap("scripts/check-manifests.mjs", 'Reflect.get(process, "getBuiltinModule");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "import meta computed",
      [appendBootstrap("scripts/check-manifests.mjs", "import.meta[process.argv[0]];")],
      "prohibited bootstrap loader authority",
    ],
    [
      "import meta resolve",
      [appendBootstrap("scripts/check-manifests.mjs", 'import.meta.resolve("x");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "computed getBuiltinModule",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'process["get" + "BuiltinModule"]("node:fs");',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "computed register",
      [appendBootstrap("scripts/check-manifests.mjs", 'module["reg" + "ister"]("x");')],
      "prohibited bootstrap loader authority",
    ],
    [
      "computed registerHooks",
      [appendBootstrap("scripts/check-manifests.mjs", 'module["register" + "Hooks"]({});')],
      "prohibited bootstrap loader authority",
    ],
    [
      "ambient global",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'globalThis.process[process.argv[0]]("node:fs");',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "ambient module",
      [appendBootstrap("scripts/check-manifests.mjs", "module[process.argv[0]];")],
      "prohibited bootstrap loader authority",
    ],
    [
      "node module namespace",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import * as moduleApi from "node:module"; moduleApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "node module default",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import moduleApi from "node:module"; moduleApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "node module computed createRequire",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import * as moduleApi from "node:module"; moduleApi["create" + "Require"]("x");',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "module default",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import moduleApi from "module"; moduleApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "module namespace",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import * as moduleApi from "module"; moduleApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "process namespace",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import * as processApi from "process"; processApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "node process namespace",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import * as processApi from "node:process"; processApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
    [
      "process default",
      [
        appendBootstrap(
          "scripts/check-manifests.mjs",
          'import processApi from "process"; processApi[process.argv[0]];',
        ),
      ],
      "prohibited bootstrap loader authority",
    ],
  ])("rejects bootstrap N1 %s", (_name, edits, message) => {
    const result = runBootstrapEdits(edits as readonly BootstrapEdit[]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it("accepts inert loader text and reviewed safe runtime members", () => {
    const result = runBootstrapEdits([
      appendBootstrap(
        "scripts/check-manifests.mjs",
        '// globalThis.process[process.argv[0]]("node:fs")\nvoid "require.resolve(unknown)";\nvoid `import(process.argv[0])`;\nfunction safeConstructor() { return new.target; }\nvoid safeConstructor;\nvoid process.env; void process.argv; void process.stdout; void import.meta.url;',
      ),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_DERIVATION_MATCH");
  });

  it.each([
    [
      "absent fixed file",
      (root: string) => rmSync(path.join(root, "scripts", "path-safety.mjs")),
      "ENOENT",
    ],
    [
      "leaf symlink",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        rmSync(target);
        symlinkSync("safe-own-data.mjs", target);
      },
      "symbolic link is not allowed",
    ],
    [
      "symlinked out-of-root path component",
      (root: string) => {
        const scripts = path.join(root, "scripts");
        renameSync(scripts, path.join(root, "scripts-real"));
        symlinkSync(path.join(repositoryRoot, "scripts"), scripts, "dir");
      },
      "symbolic link is not allowed",
    ],
    [
      "directory replacement",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        rmSync(target);
        mkdirSync(target);
      },
      "invalid file identity: scripts/path-safety.mjs",
    ],
    [
      "empty file",
      (root: string) => writeFileSync(path.join(root, "scripts", "path-safety.mjs"), ""),
      "invalid file identity: scripts/path-safety.mjs",
    ],
    [
      "hardlink replacement",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        const witness = path.join(root, "path-safety-hardlink-witness.mjs");
        linkSync(target, witness);
        expect(statSync(target).nlink).toBe(2);
        expect(statSync(witness).nlink).toBe(2);
      },
      "invalid file identity: scripts/path-safety.mjs",
    ],
    [
      "wrong ordinary mode",
      (root: string) => chmodSync(path.join(root, "scripts", "path-safety.mjs"), 0o600),
      "invalid file identity: scripts/path-safety.mjs",
    ],
    ...([0o4644, 0o2644, 0o1644] as const).map((mode) => [
      `high mode ${mode.toString(8)}`,
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        if (mode === 0o2644) chownSync(target, userInfo().uid, userInfo().gid);
        chmodSync(target, mode);
        expect(statSync(target).mode & 0o7777).toBe(mode);
      },
      "invalid file identity: scripts/path-safety.mjs",
    ]),
    [
      "single node byte cap",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        writeSizedSource(target, 131_073);
        writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from([0xff, 0x0a])]));
      },
      "invalid file identity: scripts/path-safety.mjs",
    ],
    [
      "aggregate byte cap before crossing read",
      (root: string) => {
        const crossing = path.join(root, "scripts", "check-dependencies.mjs");
        writeSizedSource(crossing, 100_000);
        writeFileSync(crossing, Buffer.concat([readFileSync(crossing), Buffer.from([0xff, 0x0a])]));
        const sizes = bootstrapNodePaths.map(
          (node) => readFileSync(path.join(root, "scripts", node)).byteLength,
        );
        expect(Math.max(...sizes)).toBeLessThanOrEqual(131_072);
        expect(sizes.reduce((total, size) => total + size, 0)).toBeGreaterThan(262_144);
      },
      "invalid file identity: scripts/check-dependencies.mjs",
    ],
    [
      "UTF-8 BOM",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        writeFileSync(
          target,
          Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(target)]),
        );
      },
      "violates the source encoding profile: scripts/path-safety.mjs",
    ],
    [
      "invalid UTF-8",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from([0xff, 0x0a])]));
      },
      "not strict UTF-8: scripts/path-safety.mjs",
    ],
    [
      "lone carriage return",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        writeFileSync(target, readFileSync(target, "utf8").replace("\n", "\r"));
      },
      "violates the source encoding profile: scripts/path-safety.mjs",
    ],
    [
      "CRLF",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        writeFileSync(target, readFileSync(target, "utf8").replace("\n", "\r\n"));
      },
      "violates the source encoding profile: scripts/path-safety.mjs",
    ],
    [
      "missing final LF",
      (root: string) => {
        const target = path.join(root, "scripts", "path-safety.mjs");
        const source = readFileSync(target, "utf8");
        writeFileSync(target, source.slice(0, -1));
      },
      "violates the source encoding profile: scripts/path-safety.mjs",
    ],
  ])("rejects bootstrap N2a %s", (_name, setup, message) => {
    const result = runBootstrapSetup(setup as (root: string) => void);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it("keeps the scanner bounded with one shared capability mapper", () => {
    const source = readFileSync(
      path.join(repositoryRoot, "scripts/verify-source-security.mjs"),
      "utf8",
    );
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(131_072);
    expect(source.match(/switch \(capability\)/gu)).toHaveLength(1);
    expect(source).toContain("capabilityEntries(capability)?.includes(relative) === true");
  });

  it("accepts an exact max-node source while the aggregate remains within budget", () => {
    const result = runBootstrapSetup((root) => {
      writeFileSync(
        path.join(root, "scripts", "verify-source-security.mjs"),
        'import "./bounded-typescript-ast.mjs";\nimport "./lexical-bindings.mjs";\n',
      );
      writeSizedSource(path.join(root, "scripts", "path-safety.mjs"), 131_072);
      const sizes = bootstrapNodePaths.map(
        (node) => readFileSync(path.join(root, "scripts", node)).byteLength,
      );
      expect(Math.max(...sizes)).toBe(131_072);
      expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(262_144);
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_DERIVATION_MATCH");
  });

  it.each([
    ["BEFORE_OPEN", "Error: bootstrap topology node changed before read: scripts/path-safety.mjs"],
    [
      "BEFORE_READ",
      "Error: bootstrap topology node changed during derivation: scripts/path-safety.mjs",
    ],
  ] as const)("rejects deterministic bootstrap N2b %s mutation", async (phase, message) => {
    const result = await runBootstrapRace(phase);
    expect({ code: result.code, signal: result.signal }).toEqual({ code: 1, signal: null });
    expect(result.stderr.match(/^Error: .*$/gmu)).toEqual([message]);
    expect(result.stderr).not.toMatch(/N2b|PRELOAD|DERIVATION_MATCH|PASS/u);
    expect(result.stdout).toBe("");
  });

  it.each([
    ["default", [], {}],
    ["dot", ["."], {}],
    ["absolute", [repositoryRoot], {}],
    ["normalized", [path.join(repositoryRoot, "scripts", "..")], {}],
    ["synthetic environment cannot skip", [repositoryRoot], { ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" }],
  ])("accepts canonical C2b %s form only after limited closure", (_name, arguments_, environment) => {
    const result = spawnSync(process.execPath, [checker, ...arguments_], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(canonicalClosureLine);
  });

  it.each([
    ["ORDER", 0, canonicalClosureLine, ""],
    ["FINAL_OPEN_FAIL", 1, "", "dependency-boundary: FINAL_OPEN_RECHECK_SENTINEL\n"],
    ["CONFIG_FAIL", 1, "", "dependency-boundary: POST_CLOSURE_CONFIG_READ_SENTINEL\n"],
  ] as const)("enforces canonical C2b %s ordering and output", (mode, status, stdout, stderr) => {
    const result = runCanonicalSentinel(mode);
    expect(result.status).toBe(status);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
  });

  it("rejects a temporary symlink masquerading as the canonical C2b root", () => {
    const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), "zc-c2b-root-link-")));
    const link = path.join(temporary, "continuity-link");
    try {
      symlinkSync(repositoryRoot, link, "dir");
      const result = spawnSync(process.execPath, [checker, link], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" },
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`dependency-boundary: symbolic link is not allowed: ${link}\n`);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it.each([
    ["forbidden inward dependency", "forbidden-inward", "cannot depend"],
    ["cycle", "cycle", "cycle detected"],
    ["repository escape", "repo-escape", "escapes the checked repository"],
    ["unowned root-local import", "unowned-root-import", "outside every declared layer source"],
  ])("rejects %s", (_case, fixture, message) => {
    const result = run(path.join(fixtures, fixture));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it("rejects AST-level core authority and computed module access", () => {
    const result = run(path.join(fixtures, "ast-adversarial"));

    expect(result.status).not.toBe(0);
    for (const filename of [
      "process-env.ts",
      "process-builtin.ts",
      "aliased-fetch.ts",
      "require-fs.ts",
      "import-equals.ts",
      "computed-import.ts",
      "function-constructor.ts",
      "indirect-eval.ts",
      "aliased-function.ts",
      "async-constructor-chain.ts",
      "computed-constructor.ts",
    ]) {
      expect(result.stderr).toContain(filename);
    }
  });

  it("does not treat comments or normal strings as executable authority", () => {
    const result = run(path.join(fixtures, "ast-benign"));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "dependency-boundary: PASS (1 layers; status=NOT_APPLICABLE_NONCANONICAL_FIXTURE)\n",
    );
    expect(result.stdout).not.toContain("POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_CLOSURE_PASS");
  });

  it("allows only the reviewed node:util proxy capability and ambient declaration", () => {
    const result = run(path.join(fixtures, "node-util-capability-positive"));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("dependency-boundary: PASS");
  });

  it("accepts the exact current path-scoped authority profile", () => {
    const result = runCurrentProfile();
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects removal of a current exact import contract", () => {
    const result = runCurrentProfile((root) => {
      const configPath = path.join(root, "architecture-boundaries.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.imports["apps/api/src/index.ts"] = [];
      writeFileSync(configPath, `${JSON.stringify(config, undefined, 2)}\n`);
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exact source import contracts differ");
  });

  it("rejects an extra use of the exact web global capability", () => {
    const result = runCurrentProfile((root) => {
      const source = path.join(root, "apps/web/src/main.tsx");
      writeFileSync(source, `${readFileSync(source, "utf8")}\nvoid fetch;\n`);
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("reviewed global fetch capability");
  });

  it("rejects expansion of a path-scoped builtin binding", () => {
    const result = runCurrentProfile((root) => {
      const source = path.join(root, "apps/api/src/image-entry.ts");
      writeFileSync(
        source,
        readFileSync(source, "utf8").replace(
          'import { spawn } from "node:child_process";',
          'import { exec, spawn } from "node:child_process";',
        ),
      );
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("expanded or reordered reviewed bindings");
  });

  it("rejects pg from an unreviewed adapters source", () => {
    const result = runCurrentProfile((root) => {
      writeFileSync(
        path.join(root, "packages/adapters-local/src/unreviewed-pg.ts"),
        'import { Pool } from "pg";\nexport { Pool };\n',
      );
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("imports forbidden external package: pg");
  });

  it.each([
    [
      "local substitution",
      (source: string) =>
        `${source.replace(", postDemo }", " }")}\nfunction postDemo() { return Promise.resolve({ kind: "network" }); }\n`,
    ],
    ["removal", (source: string) => source.replace(", postDemo }", " }")],
    [
      "alias escape",
      (source: string) =>
        source
          .replace(", postDemo }", ", postDemo as invoke }")
          .replace("await postDemo(next, fetch", "await invoke(next, fetch"),
    ],
  ])("rejects web postDemo import %s", (_case, mutate) => {
    const result = runCurrentProfile((root) => {
      const sourcePath = path.join(root, "apps/web/src/main.tsx");
      writeFileSync(sourcePath, mutate(readFileSync(sourcePath, "utf8")));
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("reviewed ./api.js postDemo import binding");
  });

  it.each([
    ["absence", "node-util-capability-absent", "lacks the exact reviewed capability import"],
    ["binding expansion", "node-util-capability-expansion", "escapes or mutates"],
    ["declaration absence", "node-util-declaration-absent", "capability declaration is absent"],
    [
      "declaration mutation",
      "node-util-declaration-mutation",
      "prohibited ambient external module",
    ],
  ])("rejects reviewed capability %s", (_case, fixture, message) => {
    const result = run(path.join(fixtures, fixture));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it.each([
    ["dynamic import", 'void import("node:util");', "exactly one module reference"],
    ["re-export", 'export * from "node:util";', "exactly one module reference"],
    [
      "second dynamic member use",
      'void import("node:util").then(({ types }) => types.isProxy({}));',
      "exactly one module reference",
    ],
    [
      "duplicate import",
      'import { types as duplicateNodeUtilTypes } from "node:util";',
      "exactly one module reference",
    ],
    ["alternate alias", "const alternateNodeUtilTypes = nodeUtilTypes;", "escapes or mutates"],
    ["destructure", "const { isProxy } = nodeUtilTypes;", "escapes or mutates"],
    ["computed access", 'void nodeUtilTypes["isProxy"]({});', "escapes or mutates"],
    [
      "member call outside review function",
      "void nodeUtilTypes.isProxy({});",
      "escapes or mutates",
    ],
    ["require", 'void require("node:util");', "exactly one module reference"],
    [
      "import equals",
      'import alternateNodeUtilTypes = require("node:util");',
      "exactly one module reference",
    ],
    ["direct eval import", "void eval('import(\"node:util\")');", "prohibited core authority eval"],
    [
      "Function import",
      "void Function('return import(\"node:util\")')();",
      "prohibited core authority Function",
    ],
    [
      "global eval import",
      "void globalThis.eval('import(\"node:util\")');",
      "prohibited global authority property eval",
    ],
    [
      "computed global eval import",
      'const evalKey = "eval"; void globalThis[evalKey](\'import("node:util")\');',
      "prohibited global authority property eval",
    ],
    [
      "indirect eval import",
      "const indirectEval = eval; void indirectEval('import(\"node:util\")');",
      "prohibited core authority eval",
    ],
    [
      "destructured global eval",
      "const { eval: carriedEval } = globalThis; void carriedEval('import(\"node:util\")');",
      "prohibited",
    ],
    [
      "Function alias",
      "const DynamicFunction = Function; void DynamicFunction('return import(\"node:util\")')();",
      "prohibited core authority Function",
    ],
    [
      "computed global Function",
      'void globalThis["Function"](\'return import("node:util")\')();',
      "prohibited global authority property Function",
    ],
    [
      "process builtin loader",
      'void process.getBuiltinModule("node:module");',
      "prohibited core authority process",
    ],
    [
      "createRequire loader",
      'import { createRequire } from "node:module"; void createRequire(import.meta.url);',
      "imports prohibited builtin",
    ],
    ["template eval import", 'void eval(`import("node:util")`);', "prohibited core authority eval"],
    [
      "unicode eval import",
      "void \\u0065val('import(\"node:util\")');",
      "prohibited core authority eval",
    ],
  ])("rejects capability source %s bypass", (_case, suffix, message) => {
    const result = runCapabilityMutation(suffix);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it.each([
    [
      "core Function constructor",
      "core",
      'void (() => {})["con" + "structor"]("return process")();',
    ],
    [
      "application AsyncFunction constructor",
      "application",
      'const middle = "struc"; void (async () => {})[`con$' + '{middle}tor`]("return process")();',
    ],
    [
      "generic adapter GeneratorFunction constructor",
      "generic_adapter",
      'const left = "con"; const key = (left + "structor") as string; void (function* () {})[key]("return process")();',
    ],
    [
      "web AsyncGeneratorFunction constructor",
      "web",
      'const key = ("constructor" satisfies string)!; void (async function* () {})[key]("return process")();',
    ],
  ])("rejects computed constructor acquisition in %s", (_case, layer, source) => {
    const result = runLayerMutation(layer, source);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("authority-bearing property constructor");
  });

  it.each([
    [
      "nearest conflicting scope",
      '{ const key = "safe"; void key; } { const key = "constructor"; void (() => {})[key]("return process")(); }',
    ],
    [
      "outer key survives inner shadow",
      'const key = "constructor"; { const key = "safe"; void key; } void (() => {})[key]("return process")();',
    ],
    [
      "mutable key reassignment",
      'let key = "safe"; key = "constructor"; void (() => {})[key]("return process")();',
    ],
    [
      "object key carrier",
      'const carrier = { key: "constructor" }; void (() => {})[carrier.key]("return process")();',
    ],
    [
      "array key carrier",
      'const carrier = ["constructor"]; void (() => {})[carrier[0]]("return process")();',
    ],
    [
      "descriptor constructor",
      'void Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor")!.value("return process")();',
    ],
    [
      "prototype computed constructor",
      'void Object.getPrototypeOf(() => {})["con" + "structor"]("return process")();',
    ],
    ["__proto__ constructor", 'void (() => {}).__proto__["con" + "structor"]("return process")();'],
    ["bound constructor", 'void (() => {}).bind(null)["con" + "structor"]("return process")();'],
    ["call constructor", 'void (() => {}).call["con" + "structor"]("return process")();'],
    ["apply constructor", 'void (() => {}).apply["con" + "structor"]("return process")();'],
    ["tagged constructor", '((() => {})["con" + "structor"])`return process`;'],
    ["new computed constructor", 'void new ((() => {})["con" + "structor"])("return process");'],
    [
      "unknown computed call",
      "declare const objectValue: Record<string, unknown>; declare const key: string; void objectValue[key]();",
    ],
    ["Reflect get", 'void Reflect.get(() => {}, "constructor");'],
  ])("rejects capability source %s authority route", (_case, suffix) => {
    const result = runCapabilityMutation(suffix);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /authority-bearing property|unknown computed property|Object\.getOwnPropertyDescriptor|Reflect authority route/,
    );
  });

  it("allows harmless lexical authority-name shadows and React-shaped rendering", () => {
    const result = runLayerMutation(
      "web",
      `
const React = {
  createElement: (name: string, properties: object, child: string) => ({ child, name, properties }),
};
export function render(
  fetch: (value: string) => string,
  Function: (value: string) => string,
  process: { readonly label: string },
) {
  return React.createElement("span", {}, fetch(Function(process.label)));
}`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("dependency-boundary: PASS");
  });

  it("keeps catch bindings scoped and permits harmless aliased destructuring names", () => {
    const escapedAmbient = runLayerMutation(
      "core",
      "try { throw 1; } catch (process) { void process; } void process.env;",
    );
    const harmlessAlias = runLayerMutation(
      "core",
      `
const source = { safe: (value: string) => value };
const { safe: Function } = source;
export const value = Function("data");
`,
    );

    expect(escapedAmbient.status).not.toBe(0);
    expect(escapedAmbient.stderr).toContain("prohibited core authority process");
    expect(harmlessAlias.status, harmlessAlias.stderr).toBe(0);
  });

  it("terminates for conflicting scoped constant names without weakening the capability", () => {
    const result = runCapabilityMutation(`
{
  const repeatedName = "safe-a";
  void repeatedName;
}
{
  const repeatedName = "safe-b";
  void repeatedName;
}`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("dependency-boundary: PASS");
  });

  it("rejects every TypeScript triple-slash and AMD dependency directive", () => {
    const result = run(path.join(fixtures, "ast-directives"));

    expect(result.status).not.toBe(0);
    for (const message of [
      "triple-slash path directive",
      "triple-slash types directive",
      "triple-slash lib directive",
      "AMD dependency",
    ]) {
      expect(result.stderr).toContain(message);
    }
  });
});
