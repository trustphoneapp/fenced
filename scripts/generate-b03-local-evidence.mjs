import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { safeCreateEvidence } from "./safe-evidence-writer.mjs";
import {
  buildSupplyChainArtifacts,
  collectInstalledLicenseEvidence,
  lockComponents,
  runH02cCiInventory,
  validatePolicyRelativePath,
} from "./verify-supply-chain.mjs";
import {
  canonicalTrustJson,
  collectToolPayloadInventory,
  collectTrustBaseline,
} from "./verify-trust-preflight.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const predecessorTargets = Object.freeze([
  Object.freeze({
    path: "ci/installed-license-evidence.json",
    bytes: 173583,
    sha256: "e9aa99a2cc7030d08685f57fed969880808dd5220488bd0dd77eeb877d6aa860",
  }),
  Object.freeze({
    path: "ci/tool-payload-inventory.json",
    bytes: 1010685,
    sha256: "6c2b0767675295f5a9d91b89cd5987eea0bd251680bbacf52b289b6ac0e97c97",
  }),
  Object.freeze({
    path: "ci/trust-baseline.json",
    bytes: 15260,
    sha256: "e4fae929da7f75ddf02bba4f46857be6c5a6812be68c2dbb46ae002dc6e6e417",
  }),
  Object.freeze({
    path: "ci/generated/sbom.cdx.json",
    bytes: 434708,
    sha256: "6ca1a287410c200cbb3cd76a38a459d15527febadecdab5943eb414f4a855c03",
  }),
]);
export const provenanceTarget = "ci/generated/provenance/H11B-PROV-R51-001.json";
const overwriteTargets = new Set(predecessorTargets.map(({ path: relative }) => relative));
const createTargets = new Set([provenanceTarget]);
const stablePaths = Object.freeze([
  "ci/b03-policy.json",
  "pnpm-lock.yaml",
  "scripts/generate-b03-local-evidence.mjs",
]);

const fileIdentity = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  nlink: stat.nlink,
  size: stat.size,
  type: stat.isFile() ? "regular" : stat.isDirectory() ? "directory" : "other",
});

export const sameBoundIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.type === right.type;

async function canonicalHeldParents(root, relative) {
  const parents = [];
  try {
    let candidate = root;
    for (const component of path.dirname(relative).split("/")) {
      if (component === ".") continue;
      candidate = path.join(candidate, component);
      const listed = await lstat(candidate, { bigint: true });
      if (
        !listed.isDirectory() ||
        listed.isSymbolicLink() ||
        (await realpath(candidate)) !== candidate
      )
        throw new Error("evidence parent must be a canonical directory");
      const handle = await open(
        candidate,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const held = await handle.stat({ bigint: true });
      const identity = fileIdentity(listed);
      if (!sameBoundIdentity(identity, fileIdentity(held))) {
        await handle.close();
        throw new Error("evidence parent handle identity differs");
      }
      parents.push({ candidate, handle, identity });
    }
    return parents;
  } catch (error) {
    await Promise.all(parents.map(({ handle }) => handle.close().catch(() => {})));
    throw error;
  }
}

async function revalidateParents(parents) {
  for (const parent of parents) {
    const listed = await lstat(parent.candidate, { bigint: true });
    const held = await parent.handle.stat({ bigint: true });
    if (
      listed.isSymbolicLink() ||
      !listed.isDirectory() ||
      (await realpath(parent.candidate)) !== parent.candidate ||
      !sameBoundIdentity(parent.identity, fileIdentity(listed)) ||
      !sameBoundIdentity(parent.identity, fileIdentity(held))
    )
      throw new Error("evidence parent identity changed");
  }
}

async function writeCompletely(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (bytesWritten < 1) throw new Error("evidence write made no progress");
    offset += bytesWritten;
  }
}

async function readCompletely(handle, length) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (bytesRead < 1) break;
    offset += bytesRead;
  }
  if (offset !== length) throw new Error("evidence verification read is incomplete");
  return bytes;
}

export async function writeEvidenceInPlace(root, relative, content, allowlist = overwriteTargets) {
  validatePolicyRelativePath(relative);
  if (!(allowlist instanceof Set) || !allowlist.has(relative) || allowlist.size !== 4)
    throw new Error("local evidence target is not exactly authorized");
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== path.resolve(root)) throw new Error("repository root must be canonical");
  const target = path.join(canonicalRoot, relative);
  const parents = await canonicalHeldParents(canonicalRoot, relative);
  let handle;
  try {
    const listed = await lstat(target, { bigint: true });
    const initial = fileIdentity(listed);
    if (
      listed.isSymbolicLink() ||
      initial.type !== "regular" ||
      (initial.mode & 0o777n) !== 0o644n ||
      initial.nlink !== 1n ||
      (await realpath(target)) !== target
    )
      throw new Error("local evidence target is not a canonical 0644 singly linked file");
    handle = await open(target, constants.O_NOFOLLOW | constants.O_RDWR);
    const held = fileIdentity(await handle.stat({ bigint: true }));
    await revalidateParents(parents);
    const rebound = await lstat(target, { bigint: true });
    if (
      rebound.isSymbolicLink() ||
      (await realpath(target)) !== target ||
      !sameBoundIdentity(initial, held) ||
      !sameBoundIdentity(initial, fileIdentity(rebound))
    )
      throw new Error("local evidence identity changed before write");
    const expected = Buffer.from(content);
    await handle.truncate(expected.length);
    await writeCompletely(handle, expected);
    await handle.sync();
    const finalHandle = fileIdentity(await handle.stat({ bigint: true }));
    const finalPath = await lstat(target, { bigint: true });
    const expectedIdentity = { ...initial, size: BigInt(expected.length) };
    await revalidateParents(parents);
    if (
      finalPath.isSymbolicLink() ||
      (await realpath(target)) !== target ||
      !sameBoundIdentity(expectedIdentity, finalHandle) ||
      !sameBoundIdentity(expectedIdentity, fileIdentity(finalPath)) ||
      !(await readCompletely(handle, expected.length)).equals(expected)
    )
      throw new Error("local evidence post-write verification failed");
  } finally {
    if (handle) await handle.close().catch(() => {});
    await Promise.all(parents.map(({ handle: parent }) => parent.close().catch(() => {})));
  }
}

async function readCanonicalFile(root, relative) {
  validatePolicyRelativePath(relative);
  const candidate = path.join(root, relative);
  const stat = await lstat(candidate, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1n ||
    (stat.mode & 0o777n) !== 0o644n ||
    (await realpath(candidate)) !== candidate
  )
    throw new Error("finalizer input is not an exact canonical file");
  const bytes = await readFile(candidate);
  if (bytes.length !== Number(stat.size)) throw new Error("finalizer input size changed");
  return { bytes, identity: fileIdentity(stat) };
}

async function captureStableInputs(root) {
  return new Map(
    await Promise.all(
      stablePaths.map(async (relative) => [relative, await readCanonicalFile(root, relative)]),
    ),
  );
}

async function requireStableInputs(root, captured) {
  for (const [relative, expected] of captured) {
    const observed = await readCanonicalFile(root, relative);
    if (
      !sameBoundIdentity(expected.identity, observed.identity) ||
      !expected.bytes.equals(observed.bytes)
    )
      throw new Error("finalizer stable input changed");
  }
}

export async function requireFinalizerPrestate(root) {
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== path.resolve(root)) throw new Error("repository root must be canonical");
  for (const expected of predecessorTargets) {
    const observed = await readCanonicalFile(canonicalRoot, expected.path);
    if (observed.bytes.length !== expected.bytes || digest(observed.bytes) !== expected.sha256)
      throw new Error("finalizer predecessor target differs");
  }
  try {
    await lstat(path.join(canonicalRoot, provenanceTarget));
    throw new Error("finalizer create target is not absent");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const basename = path.basename(provenanceTarget);
  const remnants = (await readdir(path.dirname(path.join(canonicalRoot, provenanceTarget)))).filter(
    (name) => name.startsWith(`.${basename}.zc-create-`) && name.endsWith(".tmp"),
  );
  if (remnants.length !== 0) throw new Error("finalizer create target has a remnant");
}

const defaultOperations = Object.freeze({
  buildArtifacts: buildSupplyChainArtifacts,
  captureInventory: () => runH02cCiInventory(Buffer.alloc(0), "h11b"),
  compareInventory: (captured) => runH02cCiInventory(captured, "h11b"),
  create: (root, relative, bytes) => safeCreateEvidence(root, relative, bytes, createTargets),
  write: writeEvidenceInPlace,
});

export async function finalizeB03LocalEvidence({
  root = repositoryRoot,
  environment = process.env,
  operations = {},
} = {}) {
  const canonicalRoot = await realpath(root);
  const perform = { ...defaultOperations, ...operations };
  await requireFinalizerPrestate(canonicalRoot);
  const stable = await captureStableInputs(canonicalRoot);
  const inventoryBefore = await perform.captureInventory();
  const policyBytes = stable.get("ci/b03-policy.json").bytes;
  const policy = JSON.parse(policyBytes);
  const lockBytes = stable.get("pnpm-lock.yaml").bytes;
  const locked = lockComponents(lockBytes.toString("utf8"));
  const license = await (perform.collectLicense ?? collectInstalledLicenseEvidence)(
    canonicalRoot,
    policy,
    policyBytes,
    locked,
  );
  const licenseBytes = Buffer.from(canonicalTrustJson(license), "utf8");
  const tool = await (perform.collectTool ?? collectToolPayloadInventory)(
    canonicalRoot,
    policy,
    policyBytes,
    license,
  );
  const toolBytes = Buffer.from(canonicalTrustJson(tool), "utf8");
  const trust = await (perform.collectTrust ?? collectTrustBaseline)(
    canonicalRoot,
    environment,
    new Map([
      [policy.installedLicenseEvidence.path, licenseBytes],
      [policy.toolPayloadInventory.path, toolBytes],
    ]),
  );
  const firstThree = [
    [policy.installedLicenseEvidence.path, licenseBytes],
    [policy.toolPayloadInventory.path, toolBytes],
    [policy.trustBaselinePath, Buffer.from(canonicalTrustJson(trust), "utf8")],
  ];
  for (const [index, [relative, bytes]] of firstThree.entries()) {
    await requireStableInputs(canonicalRoot, stable);
    await perform.write(canonicalRoot, relative, bytes, overwriteTargets);
    await perform.afterStep?.(relative, index);
  }
  await requireStableInputs(canonicalRoot, stable);
  const { sbom, provenance } = await perform.buildArtifacts();
  const sbomBytes = Buffer.from(canonicalTrustJson(sbom), "utf8");
  const provenanceBytes = Buffer.from(canonicalTrustJson(provenance), "utf8");
  await perform.write(canonicalRoot, policy.sbomPath, sbomBytes, overwriteTargets);
  await perform.afterStep?.(policy.sbomPath, 3);
  await requireStableInputs(canonicalRoot, stable);
  await perform.create(canonicalRoot, policy.provenancePath, provenanceBytes, createTargets);
  await perform.afterStep?.(policy.provenancePath, 4);
  await requireStableInputs(canonicalRoot, stable);
  const rebuilt = await perform.buildArtifacts();
  if (
    !Buffer.from(canonicalTrustJson(rebuilt.sbom), "utf8").equals(sbomBytes) ||
    !Buffer.from(canonicalTrustJson(rebuilt.provenance), "utf8").equals(provenanceBytes)
  )
    throw new Error("finalizer read-only rebuild differs");
  for (const [relative, expected] of [
    ...firstThree,
    [policy.sbomPath, sbomBytes],
    [policy.provenancePath, provenanceBytes],
  ]) {
    if (!(await readCanonicalFile(canonicalRoot, relative)).bytes.equals(expected))
      throw new Error("finalizer published bytes differ");
  }
  const inventoryAfter = JSON.parse(await perform.compareInventory(inventoryBefore));
  const expectedChanged = [
    policy.sbomPath,
    policy.provenancePath,
    policy.installedLicenseEvidence.path,
    policy.toolPayloadInventory.path,
    policy.trustBaselinePath,
  ].sort();
  if (JSON.stringify(inventoryAfter.changedTargets) !== JSON.stringify(expectedChanged))
    throw new Error("finalizer inventory transition differs");
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--write")
    throw new Error("exactly --write is required");
  await finalizeB03LocalEvidence();
  process.stdout.write("b03-local-evidence: WROTE and VERIFIED 4 replacements and 1 create\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stderr.write("b03-local-evidence: FAIL: FINALIZER_DENIED\n");
    process.exitCode = 1;
  });
}
