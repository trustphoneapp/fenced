import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ownDataKeys, readOwnData, writeOwnData } from "./safe-own-data.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const trustAnchorPaths = Object.freeze([
  "ci/b03-policy.json",
  "ci/c01-cleanroom-policy-r9.json",
  "ci/c02-cleanroom-policy-r2.json",
  "ci/c03-cleanroom-policy-r1.json",
  "ci/c03-cleanroom-policy-r2.json",
  "ci/c03-cleanroom-policy-r3.json",
  "ci/c03-cleanroom-policy-r4.json",
  "ci/c04-cleanroom-policy-r3.json",
  "ci/c05-cleanroom-policy-r1.json",
  "ci/c05-cleanroom-policy-r10.json",
  "ci/c05-cleanroom-policy-r2.json",
  "ci/c05-cleanroom-policy-r3.json",
  "ci/c05-cleanroom-policy-r4.json",
  "ci/c05-cleanroom-policy-r5.json",
  "ci/c05-cleanroom-policy-r6.json",
  "ci/c05-cleanroom-policy-r7.json",
  "ci/c05-cleanroom-policy-r8.json",
  "ci/c05-cleanroom-policy-r9.json",
  "ci/h01-cleanroom-policy-r1.json",
  "ci/h01-cleanroom-policy-r2.json",
  "ci/h02c-cleanroom-policy-r1.json",
  "ci/h11b-cleanroom-policy-r10.json",
  "ci/h11b-cleanroom-policy-r11.json",
  "ci/h11b-cleanroom-policy-r12.json",
  "ci/h11b-cleanroom-policy-r13.json",
  "ci/h11b-cleanroom-policy-r14.json",
  "ci/h11b-cleanroom-policy-r15.json",
  "ci/h11b-cleanroom-policy-r16.json",
  "ci/h11b-cleanroom-policy-r17.json",
  "ci/h11b-cleanroom-policy-r18.json",
  "ci/h11b-cleanroom-policy-r19.json",
  "ci/h11b-cleanroom-policy-r2.json",
  "ci/h11b-cleanroom-policy-r20.json",
  "ci/h11b-cleanroom-policy-r21.json",
  "ci/h11b-cleanroom-policy-r28.json",
  "ci/h11b-cleanroom-policy-r29.json",
  "ci/h11b-cleanroom-policy-r3.json",
  "ci/h11b-cleanroom-policy-r30.json",
  "ci/h11b-cleanroom-policy-r31.json",
  "ci/h11b-cleanroom-policy-r32.json",
  "ci/h11b-cleanroom-policy-r34.json",
  "ci/h11b-cleanroom-policy-r35.json",
  "ci/h11b-cleanroom-policy-r36.json",
  "ci/h11b-cleanroom-policy-r37.json",
  "ci/h11b-cleanroom-policy-r38.json",
  "ci/h11b-cleanroom-policy-r39.json",
  "ci/h11b-cleanroom-policy-r4.json",
  "ci/h11b-cleanroom-policy-r40.json",
  "ci/h11b-cleanroom-policy-r41.json",
  "ci/h11b-cleanroom-policy-r42.json",
  "ci/h11b-cleanroom-policy-r43.json",
  "ci/h11b-cleanroom-policy-r44.json",
  "ci/h11b-cleanroom-policy-r45.json",
  "ci/h11b-cleanroom-policy-r46.json",
  "ci/h11b-cleanroom-policy-r48.json",
  "ci/h11b-cleanroom-policy-r49.json",
  "ci/h11b-cleanroom-policy-r5.json",
  "ci/h11b-cleanroom-policy-r6.json",
  "ci/h11b-cleanroom-policy-r7.json",
  "ci/h11b-cleanroom-policy-r8.json",
  "ci/h11b-cleanroom-policy-r9.json",
  "ci/installed-license-evidence.json",
  "ci/tool-payload-inventory.json",
  "docs/architecture/b05-clean-room-enforcement.md",
  "pnpm-lock.yaml",
  "scripts/bounded-typescript-ast.mjs",
  "scripts/check-dependencies.mjs",
  "scripts/check-manifests.mjs",
  "scripts/check-tsconfig-paths.mjs",
  "scripts/clean-build-outputs.mjs",
  "scripts/generate-b03-local-evidence.mjs",
  "scripts/lexical-bindings.mjs",
  "scripts/path-safety.mjs",
  "scripts/repository-operation-lock.mjs",
  "scripts/safe-build.mjs",
  "scripts/safe-evidence-writer.mjs",
  "scripts/safe-own-data.mjs",
  "scripts/safe-pnpm-install.mjs",
  "scripts/safe-verify.mjs",
  "scripts/verify-c03-schema.mjs",
  "scripts/verify-cleanroom.mjs",
  "scripts/verify-contracts.mjs",
  "scripts/verify-reproducibility.mjs",
  "scripts/verify-source-security.mjs",
  "scripts/verify-supply-chain.mjs",
  "scripts/verify-trust-preflight.mjs",
  "tests/architecture/cleanroom-boundaries.test.ts",
]);
const presealTrustAnchorPaths = trustAnchorPaths;
export const postPreflightValidatorBootstrapProfile = Object.freeze({
  closurePassLabel: "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_CLOSURE_PASS",
  derivationMatchLabel: "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_DERIVATION_MATCH",
  edgeCount: 15,
  edgeDigestPrefix: "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_V1\0EDGE_TOPOLOGY_V1\0",
  edgeDigestPrefixBytes: 55,
  edgeDigestVersion: "EDGE_TOPOLOGY_V1",
  edgeJsonBytes: 2149,
  edgeSha256: "4be5f6dc5bcb4d3bea8206bd338f021be2da3e1080d9011504fa4faebe1093b6",
  fileIdentityProfile: "CANONICAL_REGULAR_0644_NLINK1_UNIQUE_DEV_INO_V1",
  limitations: Object.freeze([
    "FULL_TRUST_ANCHOR_RUNTIME_CLOSURE_UNPROVEN",
    "PHASE0_PREEXECUTION_TRUST_UNPROVEN",
  ]),
  maxNodeBytes: 131_072,
  maxTotalNodeBytes: 262_144,
  nodes: Object.freeze([
    "scripts/bounded-typescript-ast.mjs",
    "scripts/check-dependencies.mjs",
    "scripts/check-manifests.mjs",
    "scripts/check-tsconfig-paths.mjs",
    "scripts/lexical-bindings.mjs",
    "scripts/path-safety.mjs",
    "scripts/repository-operation-lock.mjs",
    "scripts/safe-own-data.mjs",
    "scripts/verify-source-security.mjs",
    "scripts/verify-trust-preflight.mjs",
  ]),
  profileId: "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_V1",
  profileRevision: 18,
  roots: Object.freeze([
    "scripts/check-dependencies.mjs",
    "scripts/check-manifests.mjs",
    "scripts/check-tsconfig-paths.mjs",
    "scripts/verify-source-security.mjs",
    "scripts/verify-trust-preflight.mjs",
  ]),
  sourceEncodingProfile: "STRICT_UTF8_NO_BOM_LF_FINAL_V1",
});
export function utf8Order(left, right) {
  const byteOrder = Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
  if (byteOrder !== 0 || left === right) return byteOrder;
  return left < right ? -1 : 1;
}

export function requireStrictUtf8Order(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (utf8Order(readOwnData(values, String(index - 1)), readOwnData(values, String(index))) >= 0)
      throw new Error(`${label} must use strict deterministic UTF-8 byte order`);
  }
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === "object") {
    const result = Object.create(null);
    const keys = ownDataKeys(value).slice().sort(utf8Order);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys.at(index);
      writeOwnData(result, key, deepSort(readOwnData(value, String(key))));
    }
    return result;
  }
  return value;
}

export const canonicalTrustJson = (value) => `${JSON.stringify(deepSort(value), null, 2)}\n`;

function safeRelative(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    path.normalize(value) !== value
  )
    throw new Error("trust path is not exact repository-relative");
  return value;
}

async function canonicalFile(root, relative) {
  safeRelative(relative);
  const candidate = path.join(root, relative);
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile() || (await realpath(candidate)) !== candidate)
    throw new Error(`trust anchor is not canonical: ${relative}`);
  return readFile(candidate);
}

async function pathExecutable(name, environment) {
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    try {
      const resolved = await realpath(path.join(directory, name));
      const stat = await lstat(resolved);
      if (!stat.isSymbolicLink() && stat.isFile()) return resolved;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("reviewed host executable is unavailable");
}

async function collectTree(root, specification, limits, totals) {
  safeRelative(specification.root);
  const treeRoot = path.join(root, specification.root);
  const rootStat = await lstat(treeRoot);
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    (await realpath(treeRoot)) !== treeRoot
  )
    throw new Error(`tool payload root is not canonical: ${specification.id}`);
  const files = [];
  const walk = async (candidate) => {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new Error(`tool payload tree is not symlink-free: ${specification.id}`);
    if (stat.isDirectory()) {
      const entries = (await readdir(candidate)).sort(utf8Order);
      for (const entry of entries) await walk(path.join(candidate, entry));
      return;
    }
    const bytes = await readFile(candidate);
    totals.files += 1;
    totals.bytes += bytes.length;
    if (totals.files > limits.maxFiles || totals.bytes > limits.maxTotalBytes)
      throw new Error("tool payload inventory exceeds reviewed resource limits");
    files.push({
      path: path.relative(treeRoot, candidate).split(path.sep).join("/"),
      mode: (stat.mode & 0o777).toString(8).padStart(4, "0"),
      bytes: bytes.length,
      sha256: digest(bytes),
    });
  };
  await walk(treeRoot);
  files.sort((left, right) => utf8Order(left.path, right.path));
  const treeDigest = digest(
    Buffer.concat([
      Buffer.from("zintus-continuity-tool-tree-v1\0", "utf8"),
      Buffer.from(canonicalTrustJson(files), "utf8"),
    ]),
  );
  return {
    id: specification.id,
    package: specification.package,
    version: specification.version,
    root: specification.root,
    files,
    treeDigest,
  };
}

export async function collectToolPayloadInventory(
  root,
  policy,
  policyBytes,
  providedLicenseEvidence,
) {
  const configuration = policy.toolPayloadInventory;
  if (
    configuration.schemaVersion !== 4 ||
    configuration.inventoryId !== "zintus-continuity-tool-payloads@21" ||
    configuration.maxTrees !== 139 ||
    configuration.maxFiles !== 4371 ||
    configuration.maxTotalBytes < 1 ||
    configuration.includeAllExpectedPresentLockPackages !== true
  )
    throw new Error("tool payload inventory configuration is invalid");
  const licenseEvidenceBytes = providedLicenseEvidence
    ? Buffer.from(canonicalTrustJson(providedLicenseEvidence), "utf8")
    : await canonicalFile(root, policy.installedLicenseEvidence.path);
  const licenseEvidence = providedLicenseEvidence ?? JSON.parse(licenseEvidenceBytes);
  const treeSpecifications = Array.from(configuration.trees);
  const roots = new Set(treeSpecifications.map(({ root: relative }) => relative));
  for (const record of licenseEvidence.records) {
    if (!record.state.startsWith("PRESENT_") || roots.has(record.packageRoot)) continue;
    roots.add(record.packageRoot);
    treeSpecifications.push({
      id: `lock:${record.lockIdentity}`,
      package: record.package,
      version: record.version,
      root: record.packageRoot,
    });
  }
  treeSpecifications.sort((left, right) => utf8Order(left.id, right.id));
  if (treeSpecifications.length !== configuration.maxTrees)
    throw new Error("tool payload inventory differs from exact reviewed tree count");
  const ids = treeSpecifications.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(Array.from(new Set(ids)).sort(utf8Order)))
    throw new Error("tool payload tree identities are not canonical");
  const totals = { bytes: 0, files: 0 };
  const trees = [];
  for (const specification of treeSpecifications)
    trees.push(await collectTree(root, specification, configuration, totals));
  const entrypoints = configuration.entrypoints
    .map((entrypoint) => {
      safeRelative(entrypoint.path);
      const tree = trees.find(({ id }) => id === entrypoint.tree);
      if (
        !tree ||
        !tree.files.some(
          ({ path: relative }) => path.posix.join(tree.root, relative) === entrypoint.path,
        )
      )
        throw new Error(`tool entrypoint is outside its reviewed tree: ${entrypoint.name}`);
      return entrypoint;
    })
    .sort(
      (left, right) =>
        utf8Order(left.name, right.name) ||
        utf8Order(left.tree, right.tree) ||
        utf8Order(left.path, right.path),
    );
  const aggregate = digest(
    Buffer.concat([
      Buffer.from("zintus-continuity-tool-payload-inventory-v1\0", "utf8"),
      Buffer.from(canonicalTrustJson({ entrypoints, trees }), "utf8"),
    ]),
  );
  return deepSort({
    schemaVersion: 4,
    inventoryId: configuration.inventoryId,
    baselineId: "zintus-continuity-local-trust@65",
    policy: {
      path: "ci/b03-policy.json",
      bytes: policyBytes.length,
      sha256: digest(policyBytes),
    },
    lockfile: policy.lockfile,
    installedLicenseEvidence: {
      path: policy.installedLicenseEvidence.path,
      bytes: licenseEvidenceBytes.length,
      sha256: digest(licenseEvidenceBytes),
    },
    limits: {
      maxTrees: configuration.maxTrees,
      maxFiles: configuration.maxFiles,
      maxTotalBytes: configuration.maxTotalBytes,
    },
    observed: { trees: trees.length, files: totals.files, bytes: totals.bytes },
    entrypoints,
    trees,
    aggregate,
    limitation: "LOCAL_INSTALLED_PAYLOAD_IDENTITY_ONLY_NOT_VENDOR_AUTHENTICITY",
  });
}

export async function collectTrustBaseline(root, environment, fileOverrides = new Map()) {
  if (
    !(fileOverrides instanceof Map) ||
    Array.from(fileOverrides.keys()).some(
      (relative) =>
        !["ci/installed-license-evidence.json", "ci/tool-payload-inventory.json"].includes(
          relative,
        ),
    )
  )
    throw new Error("trust anchor render overrides differ");
  requireStrictUtf8Order(trustAnchorPaths, "trust anchor paths");
  const trustAnchors = [];
  for (const relative of trustAnchorPaths) {
    const bytes = fileOverrides.has(relative)
      ? Buffer.from(fileOverrides.get(relative))
      : await canonicalFile(root, relative);
    trustAnchors.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
  }
  const node = await realpath(process.execPath);
  const pnpm = await pathExecutable("pnpm", environment);
  const hostToolIdentity = {};
  for (const [name, executable] of [
    ["node", node],
    ["pnpm", pnpm],
  ]) {
    const bytes = await readFile(executable);
    writeOwnData(hostToolIdentity, name, {
      version: name === "node" ? process.version : "11.9.0",
      executableSha256: digest(bytes),
    });
  }
  return deepSort({
    schemaVersion: 23,
    baselineId: "zintus-continuity-local-trust@65",
    trustAnchors,
    hostToolIdentity,
    limitations: [
      "REVIEWED_LOCAL_IDENTITY_RECORD_NOT_SELF_AUTHENTICATING",
      "HOST_TOOL_HASHES_ARE_IDENTITY_EVIDENCE_ONLY",
      "COMPLETE_LOCAL_TOOL_TREE_HASHES_ARE_NOT_VENDOR_AUTHENTICITY",
      "NO_SIGNATURE_EXTERNAL_ATTESTATION_OR_CROSS_HOST_CLAIM",
    ],
  });
}

export function validateTrustBaselineIdentity(baseline, phase = "postseal") {
  const expectedPaths = phase === "preseal" ? presealTrustAnchorPaths : trustAnchorPaths;
  const paths = baseline?.trustAnchors?.map(({ path: relative }) => relative);
  if (
    baseline?.schemaVersion !== 23 ||
    baseline?.baselineId !== "zintus-continuity-local-trust@65" ||
    !["preseal", "postseal"].includes(phase) ||
    JSON.stringify(paths) !== JSON.stringify(expectedPaths) ||
    JSON.stringify(paths) !== JSON.stringify(Array.from(new Set(paths)).sort(utf8Order))
  )
    throw new Error("trust baseline identity or ordering is invalid");
}

export async function verifyTrustPreflight(root, environment) {
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== path.resolve(root)) throw new Error("trust root must be canonical");
  const baseline = JSON.parse(
    (await canonicalFile(canonicalRoot, "ci/trust-baseline.json")).toString("utf8"),
  );
  const policy = JSON.parse(
    (await canonicalFile(canonicalRoot, "ci/b03-policy.json")).toString("utf8"),
  );
  const phase = await lstat(path.join(canonicalRoot, policy.provenancePath))
    .then(() => "postseal")
    .catch((error) => {
      if (error?.code === "ENOENT") return "preseal";
      throw error;
    });
  validateTrustBaselineIdentity(baseline, phase);
  if (phase === "preseal") return { baseline, phase };
  for (const anchor of baseline.trustAnchors) {
    const bytes = await canonicalFile(canonicalRoot, anchor.path);
    if (bytes.length !== anchor.bytes || digest(bytes) !== anchor.sha256)
      throw new Error(`trust anchor differs: ${anchor.path}`);
  }
  const actualBaseline = await collectTrustBaseline(canonicalRoot, environment);
  for (const name of ["node", "pnpm"]) {
    if (
      readOwnData(actualBaseline.hostToolIdentity, String(name)).executableSha256 !==
      readOwnData(baseline.hostToolIdentity, String(name)).executableSha256
    )
      throw new Error(`host ${name} identity differs`);
  }
  if (canonicalTrustJson(actualBaseline) !== canonicalTrustJson(baseline))
    throw new Error("trust baseline differs from deterministic local identity evidence");
  const policyBytes = await canonicalFile(canonicalRoot, "ci/b03-policy.json");
  const inventoryBytes = await canonicalFile(canonicalRoot, policy.toolPayloadInventory.path);
  const expectedInventory = JSON.parse(inventoryBytes);
  const actualInventory = await collectToolPayloadInventory(canonicalRoot, policy, policyBytes);
  if (canonicalTrustJson(actualInventory) !== canonicalTrustJson(expectedInventory))
    throw new Error("reviewed complete tool payload inventory differs");
  const node = await realpath(process.execPath);
  const pnpm = await pathExecutable("pnpm", environment);
  return { baseline, inventory: expectedInventory, node, phase, pnpm };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  verifyTrustPreflight(repositoryRoot, process.env)
    .then(({ phase }) =>
      process.stdout.write(
        phase === "preseal"
          ? "trust-preflight: PASS (sealed predecessor prestate)\n"
          : "trust-preflight: PASS (complete local identity evidence)\n",
      ),
    )
    .catch((error) => {
      process.stderr.write(
        `trust-preflight: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
