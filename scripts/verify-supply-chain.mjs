import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ownDataEntries, ownDataKeys, readOwnData, writeOwnData } from "./safe-own-data.mjs";
import { discoverSupplyChainInputs } from "./verify-cleanroom.mjs";
import { requireStrictUtf8Order, utf8Order } from "./verify-trust-preflight.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => `${JSON.stringify(deepSort(value), null, 2)}\n`;
const noticeDecision =
  "PINNED_INSTALLED_NOTICE_BODIES_COPIED_FOR_ATTRIBUTION_COMPLETENESS_LOCAL_EVIDENCE_NOT_LEGAL_CLEARANCE_OR_COMPLETENESS";
export const reviewedNoticeAllowlist = Object.freeze([
  Object.freeze({
    identity: "tslib@2.8.1",
    sourceFilename: "CopyrightNotice.txt",
    bytes: 822,
    sha256: "da16ddb65f8ca390998fb99223d0112498b56b45784d00afd77ff8ce1ac4de8b",
  }),
  Object.freeze({
    identity: "typescript@5.9.3",
    sourceFilename: "ThirdPartyNoticeText.txt",
    bytes: 37824,
    sha256: "1af3c68039c57e539422da82a4faada506ce6d0ea6f90e0b699d02dbcdb7a90c",
  }),
]);
const reviewedLicenseDecision = Object.freeze({
  version: "b03-license-notice-review@5",
  evidence: Object.freeze([
    "pnpm-lock.yaml exact package name/version/integrity identities",
    "locally installed exact package manifests where present",
    "reviewed platform-package family identity only where the optional package is not installed",
    "manifest-only without license file: @aws-sdk/credential-provider-http@3.972.69, @aws-sdk/credential-provider-login@3.972.74, @aws-sdk/nested-clients@3.997.41, pg-types@2.2.0, pgpass@1.0.5",
    "TypeScript 5.9.3 ThirdPartyNoticeText.txt and tslib 2.8.1 CopyrightNotice.txt exact installed bytes copied to root NOTICE",
  ]),
  limitation:
    "LOCAL_REVIEW_EVIDENCE_NOT_LEGAL_CLEARANCE_OR_ONLINE_REGISTRY_VERIFICATION; PINNED_NOTICE_BODY_COPY_DOES_NOT_ESTABLISH_ATTRIBUTION_OR_NOTICE_COMPLETENESS",
});
const noticeDocumentPrefix = Buffer.from(
  "Zintus Continuity\n" +
    "Copyright 2026 Zintus Continuity contributors\n\n" +
    "This product includes software developed by Zintus Continuity contributors.\n\n" +
    "The following installed vendor notice bodies are copied byte-for-byte for attribution\n" +
    "completeness and local evidence. Their inclusion is not legal clearance and does not\n" +
    "establish that third-party attribution or NOTICE obligations are complete.\n\n",
  "utf8",
);
const inventoryLimits = Object.freeze({
  source: 65536,
  stdin: 1048576,
  stdout: 1048576,
  stderr: 65536,
  timeout: 30000,
});
const inventoryLimitations = Object.freeze([
  "LOCAL_UNSIGNED_UNAUTHENTICATED_BUILD_EVIDENCE_ONLY",
  "HOSTILE_LOCAL_ACTOR_RISK_OPEN",
  "FABRICATED_STRUCTURALLY_VALID_STDIN_MAY_PASS",
  "PREIMAGE_CAPTURE_SESSION_AUTHENTICITY_UNPROVEN",
]);
const h11bPath = "ci/generated/provenance/H11B-PROV-R51-001.json";
const inventoryProfiles = Object.freeze({
  h02c: Object.freeze({
    replaced: Object.freeze([
      "ci/installed-license-evidence.json",
      "ci/tool-payload-inventory.json",
      "ci/trust-baseline.json",
    ]),
  }),
  h11b: Object.freeze({
    replaced: Object.freeze([
      "ci/generated/sbom.cdx.json",
      "ci/installed-license-evidence.json",
      "ci/tool-payload-inventory.json",
      "ci/trust-baseline.json",
    ]),
    created: h11bPath,
  }),
});
const pinnedLauncher = Object.freeze({
  path: "/usr/bin/env",
  type: "regular",
  mode: "0755",
  nlink: "1",
  size: "102368",
  dev: "16777234",
  ino: "1152921500312562231",
  sha256: "540f3b55630775d9b2a3aa08cbbe87928ea62c615cd4d13c11f68e2b4571aebc",
});
const pinnedInterpreter = Object.freeze({
  path: "/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9",
  type: "regular",
  mode: "0755",
  nlink: "1",
  size: "102352",
  dev: "16777234",
  ino: "45065594",
  sha256: "271143990bc83af0fb2404a255038f5faafb96df1584ed7f085e5018c0f33ffb",
});

const bigintIdentity = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  nlink: stat.nlink,
  size: stat.size,
  mtimeNs: stat.mtimeNs,
  ctimeNs: stat.ctimeNs,
  type: stat.isFile() ? "regular" : stat.isDirectory() ? "directory" : "other",
});
const sameBigintIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs &&
  left.type === right.type;

async function holdCanonicalFile(absolute, maximum) {
  const parent = path.dirname(absolute);
  if ((await realpath(parent)) !== parent)
    throw new Error("inventory file parent is not canonical");
  const parentListed = await lstat(parent, { bigint: true });
  if (parentListed.isSymbolicLink() || !parentListed.isDirectory())
    throw new Error("inventory file parent is not a directory");
  const parentHandle = await open(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  let handle;
  try {
    const parentIdentity = bigintIdentity(parentListed);
    if (
      !sameBigintIdentity(parentIdentity, bigintIdentity(await parentHandle.stat({ bigint: true })))
    )
      throw new Error("inventory file parent identity differs");
    const listed = await lstat(absolute, { bigint: true });
    if (
      listed.isSymbolicLink() ||
      !listed.isFile() ||
      listed.nlink !== 1n ||
      listed.size > BigInt(maximum) ||
      (await realpath(absolute)) !== absolute
    )
      throw new Error("inventory file is not an exact bounded regular file");
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = bigintIdentity(await handle.stat({ bigint: true }));
    if (!sameBigintIdentity(before, bigintIdentity(listed)))
      throw new Error("inventory file handle identity differs");
    const bytes = await handle.readFile();
    const after = bigintIdentity(await handle.stat({ bigint: true }));
    const rebound = bigintIdentity(await lstat(absolute, { bigint: true }));
    if (
      bytes.length !== Number(before.size) ||
      !sameBigintIdentity(before, after) ||
      !sameBigintIdentity(before, rebound) ||
      !sameBigintIdentity(
        parentIdentity,
        bigintIdentity(await parentHandle.stat({ bigint: true })),
      ) ||
      !sameBigintIdentity(parentIdentity, bigintIdentity(await lstat(parent, { bigint: true })))
    )
      throw new Error("inventory file identity changed during read");
    return { absolute, before, bytes, handle, parent, parentHandle, parentIdentity };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await parentHandle.close().catch(() => {});
    throw error;
  }
}

async function revalidateHeldFile(held) {
  const current = bigintIdentity(await held.handle.stat({ bigint: true }));
  const rebound = bigintIdentity(await lstat(held.absolute, { bigint: true }));
  const parentHeld = bigintIdentity(await held.parentHandle.stat({ bigint: true }));
  const parentPath = bigintIdentity(await lstat(held.parent, { bigint: true }));
  if (
    !sameBigintIdentity(held.before, current) ||
    !sameBigintIdentity(held.before, rebound) ||
    !sameBigintIdentity(held.parentIdentity, parentHeld) ||
    !sameBigintIdentity(held.parentIdentity, parentPath) ||
    (await realpath(held.absolute)) !== held.absolute
  )
    throw new Error("inventory held file identity changed");
}

async function closeHeldFile(held) {
  await held.handle.close().catch(() => {});
  await held.parentHandle.close().catch(() => {});
}

async function requirePinnedExecutable(expected) {
  const held = await holdCanonicalFile(expected.path, 131072);
  try {
    const observed = {
      path: expected.path,
      type: held.before.type,
      mode: Number(held.before.mode & 0o777n)
        .toString(8)
        .padStart(4, "0"),
      nlink: held.before.nlink.toString(),
      size: held.before.size.toString(),
      dev: held.before.dev.toString(),
      ino: held.before.ino.toString(),
      sha256: digest(held.bytes),
    };
    if (JSON.stringify(observed) !== JSON.stringify(expected))
      throw new Error(`inventory pinned executable differs: ${expected.path}`);
    await revalidateHeldFile(held);
  } finally {
    await closeHeldFile(held);
  }
}

async function boundedStandardInput() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > inventoryLimits.stdin) throw new Error("inventory stdin limit exceeded");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

export function requireExactInventoryTransition(before, after, profile = "h02c") {
  const recordKeys = [
    "path",
    "type",
    "dev",
    "ino",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
    "sha256",
  ];
  const specification = readOwnData(inventoryProfiles, profile);
  if (!specification) throw new Error("inventory profile differs");
  const expectedTargets = [
    ...specification.replaced,
    ...(specification.created ? [specification.created] : []),
  ].sort(utf8Order);
  const left = before.records;
  const right = after.records;
  requireStrictUtf8Order(
    left.map(({ path: relative }) => relative),
    "inventory before records",
  );
  requireStrictUtf8Order(
    right.map(({ path: relative }) => relative),
    "inventory after records",
  );
  if (
    before.count + (specification.created ? 1 : 0) !== after.count ||
    left.length + (specification.created ? 1 : 0) !== right.length
  )
    throw new Error("inventory cardinality differs");
  const changed = [];
  const currentByPath = new Map(right.map((record) => [record.path, record]));
  for (const prior of left) {
    const current = currentByPath.get(prior.path);
    if (
      JSON.stringify(Object.keys(prior)) !== JSON.stringify(recordKeys) ||
      !current ||
      JSON.stringify(Object.keys(current)) !== JSON.stringify(recordKeys) ||
      prior.path !== current.path
    )
      throw new Error("inventory record structure differs");
    if (specification.replaced.includes(prior.path)) {
      if (
        prior.type !== "regular" ||
        current.type !== "regular" ||
        prior.path !== current.path ||
        prior.dev !== current.dev ||
        prior.ino !== current.ino ||
        prior.mode !== current.mode ||
        prior.nlink !== current.nlink
      )
        throw new Error("inventory target identity differs");
      if (JSON.stringify(prior) !== JSON.stringify(current)) changed.push(prior.path);
    } else if (profile === "h11b" && prior.path === "ci/generated/provenance") {
      if (
        prior.type !== "directory" ||
        current.type !== prior.type ||
        prior.dev !== current.dev ||
        prior.ino !== current.ino ||
        prior.mode !== current.mode ||
        prior.sha256 !== current.sha256 ||
        BigInt(current.nlink) !== BigInt(prior.nlink) + 1n ||
        BigInt(current.size) !== BigInt(prior.size) + 32n ||
        current.mtimeNs === prior.mtimeNs ||
        current.ctimeNs === prior.ctimeNs
      )
        throw new Error("inventory create parent identity differs");
    } else if (JSON.stringify(prior) !== JSON.stringify(current)) {
      throw new Error("inventory non-target differs");
    }
  }
  if (specification.created) {
    const created = currentByPath.get(specification.created);
    if (
      !created ||
      JSON.stringify(Object.keys(created)) !== JSON.stringify(recordKeys) ||
      created.type !== "regular" ||
      created.mode !== "0644" ||
      created.nlink !== "1"
    )
      throw new Error("inventory created target differs");
    changed.push(specification.created);
  }
  changed.sort(utf8Order);
  if (JSON.stringify(changed) !== JSON.stringify(expectedTargets))
    throw new Error("inventory exact target delta differs");
  return changed;
}

function validateInventoryEnvelope(bytes, sourceSha256, expectedMode, captured, profile) {
  let text;
  let value;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new Error("inventory output is not strict JSON UTF-8");
  }
  if (!Buffer.from(JSON.stringify(value), "utf8").equals(bytes))
    throw new Error("inventory output is not compact canonical JSON");
  const expectedKeys =
    expectedMode === "capture"
      ? ["schema", "profile", "heldSourceSha256", "mode", "limitations", "inventory"]
      : [
          "schema",
          "profile",
          "heldSourceSha256",
          "mode",
          "limitations",
          "changedTargets",
          "inventory",
        ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(expectedKeys) ||
    value.schema !== "H02C_CI_INVENTORY_V1" ||
    value.profile !== profile ||
    value.heldSourceSha256 !== sourceSha256 ||
    value.mode !== expectedMode ||
    JSON.stringify(value.limitations) !== JSON.stringify(inventoryLimitations)
  )
    throw new Error("inventory output envelope differs");
  const inventory = value.inventory;
  if (
    !inventory ||
    JSON.stringify(Object.keys(inventory)) !== JSON.stringify(["records", "count", "aggregate"]) ||
    !Array.isArray(inventory.records) ||
    inventory.count !== inventory.records.length ||
    !/^[0-9a-f]{64}$/u.test(inventory.aggregate) ||
    digest(Buffer.from(JSON.stringify(inventory.records), "utf8")) !== inventory.aggregate
  )
    throw new Error("inventory output aggregate differs");
  if (expectedMode === "compare") {
    const specification = readOwnData(inventoryProfiles, profile);
    const expectedTargets = [
      ...specification.replaced,
      ...(specification.created ? [specification.created] : []),
    ].sort(utf8Order);
    if (
      !captured ||
      JSON.stringify(value.changedTargets) !== JSON.stringify(expectedTargets) ||
      JSON.stringify(requireExactInventoryTransition(captured.inventory, inventory, profile)) !==
        JSON.stringify(expectedTargets)
    )
      throw new Error("inventory changed-target result differs");
  }
  return value;
}

export async function runH02cCiInventory(input = Buffer.alloc(0), profile = "h02c") {
  if (!Buffer.isBuffer(input) || input.length > inventoryLimits.stdin)
    throw new Error("inventory input must be a bounded Buffer");
  if (!readOwnData(inventoryProfiles, profile)) throw new Error("inventory profile differs");
  const policy = JSON.parse(
    await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"),
  );
  const singleton = policy.sourceSecurity?.pythonSingleton;
  if (
    !singleton ||
    JSON.stringify(Object.keys(singleton)) !== JSON.stringify(["path", "sha256"]) ||
    singleton.path !== "scripts/h02c-ci-inventory.py" ||
    !/^[0-9a-f]{64}$/u.test(singleton.sha256)
  )
    throw new Error("inventory Python singleton policy differs");
  const sourcePath = path.join(repositoryRoot, singleton.path);
  const held = await holdCanonicalFile(sourcePath, inventoryLimits.source);
  try {
    const sourceSha256 = digest(held.bytes);
    const mode = Number(held.before.mode & 0o777n)
      .toString(8)
      .padStart(4, "0");
    if (mode !== "0644" || sourceSha256 !== singleton.sha256 || held.bytes.includes(0))
      throw new Error("inventory held Python source differs");
    const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(held.bytes);
    if (!Buffer.from(sourceText, "utf8").equals(held.bytes))
      throw new Error("inventory held Python source is not exact UTF-8");
    const captured =
      input.length > 0
        ? validateInventoryEnvelope(input, sourceSha256, "capture", undefined, profile)
        : undefined;
    await requirePinnedExecutable(pinnedLauncher);
    await requirePinnedExecutable(pinnedInterpreter);
    await revalidateHeldFile(held);
    const arguments_ = [
      "-i",
      "PATH=/usr/bin:/bin",
      "LANG=C",
      "LC_ALL=C",
      "TZ=UTC",
      "__CF_USER_TEXT_ENCODING=0x1F5:0x0:0x0",
      pinnedInterpreter.path,
      "-I",
      "-B",
      "-c",
      sourceText,
      "--",
      sourceSha256,
      profile,
    ];
    const child = spawn(pinnedLauncher.path, arguments_, {
      cwd: repositoryRoot,
      env: {},
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > inventoryLimits.stdout) {
        overflow = new Error("inventory stdout limit exceeded");
        child.kill("SIGKILL");
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > inventoryLimits.stderr) {
        overflow = new Error("inventory stderr limit exceeded");
        child.kill("SIGKILL");
      } else stderr.push(chunk);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, inventoryLimits.timeout);
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timeout));
    await revalidateHeldFile(held);
    await requirePinnedExecutable(pinnedLauncher);
    await requirePinnedExecutable(pinnedInterpreter);
    if (
      timedOut ||
      overflow ||
      result.signal !== null ||
      result.code !== 0 ||
      stderrBytes !== 0 ||
      Buffer.concat(stderr, stderrBytes).length !== 0
    )
      throw overflow ?? new Error("inventory child execution failed");
    const output = Buffer.concat(stdout, stdoutBytes);
    validateInventoryEnvelope(
      output,
      sourceSha256,
      input.length === 0 ? "capture" : "compare",
      captured,
      profile,
    );
    return output;
  } finally {
    await closeHeldFile(held);
  }
}

async function h02cCiInventory() {
  process.stdout.write(await runH02cCiInventory(await boundedStandardInput()));
}
export const acceptedR12 = Object.freeze({
  path: "ci/generated/local-provenance.json",
  recordId: "B03-PROV-R12-001",
  bytes: 34356,
  mode: "0644",
  sha256: "a72aae3906021d814c20c2a94fe6f7a6801d4e6cb7da65129c1b1aee9d7d7a83",
  aggregate: "ba76ba580131fafb627b74215248055ac086d7f5433063a3b42b4afd11269aa9",
});
export const acceptedSbomMetadata = Object.freeze({
  acceptanceLabel: "H11B_FINALIZER_LOCAL_SYNTHETIC_UNSIGNED_PROVENANCE_PENDING_EXTERNAL_REVIEW",
  acceptanceState: "PUBLIC_READY_BLOCKED_PENDING_EXTERNAL_REVIEW",
});
export const acceptedB05Predecessor = Object.freeze({
  path: "ci/generated/provenance/B05-PROV-R1-001.json",
  recordId: "B05-PROV-R1-001",
  bytes: 268156,
  mode: "0644",
  sha256: "bf45cd1f366d6dd1124ac28fabb8a05fa1f2f97a32e365415b570d14fdd21620",
  aggregate: "d5c01b870e1ad5778827839718438a56129172eb2369b8587d627328486e70eb",
});
export const acceptedC01R9 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R9-001.json",
  recordId: "C01-PROV-R9-001",
  bytes: 324604,
  mode: "0644",
  sha256: "0057280c063d4ea68f6765324cfd90ace9a0e5738c9343ec87c5f972fd1343fc",
  aggregate: "ec934d558e058cb484a4ff845da02a31801995b80c4de0434ba3624ae8d3c194",
});
export const acceptedC02R2 = Object.freeze({
  path: "ci/generated/provenance/C02-PROV-R2-001.json",
  recordId: "C02-PROV-R2-001",
  bytes: 341378,
  mode: "0644",
  sha256: "f77ed59df325cd2f48454c5b868596f1c65b8c57d6e1cbabeff139b914211fe5",
  aggregate: "841ca14d2c62ac99129bfee94114643acae1fd4fd891cbd004b6858eccc62e0a",
});
export const failedC02R1 = Object.freeze({
  path: "ci/generated/provenance/C02-PROV-R1-001.json",
  recordId: "C02-PROV-R1-001",
  bytes: 337435,
  mode: "0644",
  sha256: "96c0b479574ebedec611f0c57d840b538fd9527976a4da139287c69b26cd2203",
  aggregate: "21c3303aeec24c0aeb4d377097df95b3a141266336344e60be64798753ce3437",
});
export const failedC03R1 = Object.freeze({
  path: "ci/generated/provenance/C03-PROV-R1-001.json",
  recordId: "C03-PROV-R1-001",
  bytes: 350201,
  mode: "0644",
  sha256: "33a24ee5e9c778e63922de6e54c9949dbf6f4d70fae63fc22708bae416b75dda",
  aggregate: "9fb3be28301d61ceab5f58e5d609f1315b4020f11e07abf7089bdffaae38cea1",
});
export const acceptedC03R2 = Object.freeze({
  path: "ci/generated/provenance/C03-PROV-R2-001.json",
  recordId: "C03-PROV-R2-001",
  bytes: 353458,
  mode: "0644",
  sha256: "104235a90c9b762a6e54a4c0436b159e41566fc0dc8d22ac319d5ff9456cf46b",
  aggregate: "6e985e9e72a271bc79d0a7d9d25779b46583963a0a9067faf02cd72a7047e90a",
});
export const acceptedC03R3 = Object.freeze({
  path: "ci/generated/provenance/C03-PROV-R3-001.json",
  recordId: "C03-PROV-R3-001",
  bytes: 356441,
  mode: "0644",
  sha256: "c3095a25514ce96f60248cea6dbdb7afcfe0ee2e3bd7256411ac66b9fe642db6",
  aggregate: "c322309606fca0b66ec5b7c0c739e6b540f1520f3aeabd98938c4a02ac47b753",
});
export const acceptedC03R4 = Object.freeze({
  path: "ci/generated/provenance/C03-PROV-R4-001.json",
  recordId: "C03-PROV-R4-001",
  bytes: 359672,
  mode: "0644",
  sha256: "d96d19f037c6519560d136720d238f7b4388fcbba9177ecabd7ea630955a7c0d",
  aggregate: "6485d723333ef846171807cf3dbcd09286e617f133de2c565c706a19c1c30c5d",
});
export const acceptedC04R1 = Object.freeze({
  path: "ci/generated/provenance/C04-PROV-R1-001.json",
  recordId: "C04-PROV-R1-001",
  bytes: 366987,
  mode: "0644",
  sha256: "b32448ac17362f3b58f58d39afc9652a720f3ae5daa09953faf9926af1c20309",
  aggregate: "190b40e94d766699137938a38c51d9bbbfc5954e1fefdea3b2395d27133bc0f6",
});
export const acceptedC04R2 = Object.freeze({
  path: "ci/generated/provenance/C04-PROV-R2-001.json",
  recordId: "C04-PROV-R2-001",
  bytes: 382721,
  mode: "0644",
  sha256: "451caa69a71bd5474bba635186248dcc08b5a07958c3671e0750009186cc2599",
  aggregate: "b9244f3252018dd21decffc472e98784fb209036286edcc4e0a699a46eaed28b",
});
export const acceptedC04R3 = Object.freeze({
  path: "ci/generated/provenance/C04-PROV-R3-001.json",
  recordId: "C04-PROV-R3-001",
  bytes: 389063,
  mode: "0644",
  sha256: "cb0fa8178d29b7433f18bc3a61f62e347c90d2a7fca7e7b149e28702d7d68148",
  aggregate: "8eb8c073825ad338cf6b09af8b0733bd16a8f1e67a0f587c7a0c75746349302f",
});
export const burnedC05R1Policy = Object.freeze({
  path: "ci/c05-cleanroom-policy-r1.json",
  bytes: 13594,
  mode: "0644",
  sha256: "12891deca70f8941a6163890bc9c2c100feb844a0fc330b5f556d5435d89acbf",
  disposition: "immutable-burned-failed-policy-history",
});
export const burnedC05R2Policy = Object.freeze({
  path: "ci/c05-cleanroom-policy-r2.json",
  bytes: 13863,
  mode: "0644",
  sha256: "c40052d5b5dfaa24ca5b3b3cdbf69ed97fff79062eb4e8d6995e6d925ecb3728",
  disposition: "immutable-burned-failed-policy-history",
});
export const acceptedC04Point3FunctionalReview = Object.freeze({
  contract_id: "C04.3-ROLE-SESSION-R1",
  acceptance: "CHIEF_ACCEPTED_UNCHANGED_LOCAL_SYNTHETIC_STATIC_TUPLE",
  review_chain: Object.freeze(["Worker", "Terra", "Security", "Lean", "Chief"]),
  files: Object.freeze([
    Object.freeze([
      "ci/b03-policy.json",
      43472,
      1186,
      "64bfed006c4638266928026019bb9d4199e538aa661c282dedb8cba56fe05e65",
    ]),
    Object.freeze([
      "database/README.md",
      13463,
      85,
      "788f106848941f1703d445bea88e8e1fd6716efed85b822f5198fed7db0dc367",
    ]),
    Object.freeze([
      "database/migrations/0003_role_session_isolation.sql",
      2354,
      63,
      "39ee63b2f49294a4dd9e8fad0e437ab7cbba8e0e06bb9634842c80f65abf6359",
    ]),
    Object.freeze([
      "scripts/verify-c03-schema.mjs",
      20906,
      515,
      "3735f47a737fe60fd01da3449a829a0653d6514d872825527b490a6e0fd6266c",
    ]),
    Object.freeze([
      "scripts/verify-c04-purpose-keys.mjs",
      7533,
      197,
      "22bedfa994dcf15c4c7c8ba5cf6ef294b23317585bed7e3dbc29b1c1edcd989d",
    ]),
    Object.freeze([
      "scripts/verify-c04-role-session.mjs",
      8533,
      226,
      "dba60a0dbc8b79326b6ca75b4d9475417d0ac21bb2eac5de2b5123cda97d332d",
    ]),
    Object.freeze([
      "tests/architecture/b03-source-security.test.mjs",
      97518,
      2238,
      "20eba21b1c9d45859163ddec0cbdaedf1597ca17955e4422c7c280ef6dbc4fee",
    ]),
    Object.freeze([
      "tests/database/c04-role-session.test.mjs",
      14432,
      333,
      "4db59dec4631e350f23fa5860d1e389da8755e690b97eba61cba6589030708ad",
    ]),
  ]),
  terra_finding: Object.freeze({
    id: "C04.3-TF01",
    predecessor: Object.freeze([
      "tests/database/c04-role-session.test.mjs",
      10920,
      253,
      "3288f1c4021f61580830674318996ced94748b09abc532b0cc763ee9fd8a8d12",
    ]),
    resolution: "EXPLICIT_NEGATIVE_CASES_ADDED",
    carry: "ZERO_FINDING_RESULT_REVIEW_POSITION_OR_AUTHORITY_CARRY",
  }),
  limitations: Object.freeze([
    "STATIC_ONLY_NO_COCKROACHDB_EXECUTION_OR_COMPATIBILITY_EVIDENCE",
    "NO_CONNECTION_BOOTSTRAP_SESSION_SETTER_POOL_ROLE_OWNERSHIP_MIGRATION_PRINCIPAL_DEPLOYMENT_OR_RUNTIME_ISOLATION_EVIDENCE",
    "EXECUTOR_REMAINS_INERT_C04_INCOMPLETE_C05_BLOCKED",
  ]),
});
export const acceptedC04Point2FunctionalReview = Object.freeze({
  contract_id: "C04.2-PURPOSE-KEYS-R1",
  acceptance: "CHIEF_ACCEPTED_UNCHANGED_LOCAL_SYNTHETIC_STATIC_TUPLE",
  review_chain: Object.freeze(["Worker", "Terra", "Security", "Lean", "Chief"]),
  files: Object.freeze(
    [
      [
        "ci/b03-policy.json",
        42979,
        1176,
        "10a42851be9fa4a64875d95f64fb62aa34c03d6c37c7c6b57b741c9a78923509",
      ],
      [
        "database/README.md",
        12820,
        76,
        "f2340814823425df3921d43e7e70cfa4cd1efee79ef619abd2d13f6ddf94b3d3",
      ],
      [
        "database/migrations/0002_purpose_qualified_tenant_keys.sql",
        1353,
        43,
        "8dcc5604ce1dbb6316f9aa3c4f1422e009ffcc1b75d4961df4f7d3ee1babf9af",
      ],
      [
        "scripts/verify-c03-schema.mjs",
        20800,
        511,
        "d4bd67012d18f6744b378912c46ae3216aece90b85b4e2079f64e758e24a9416",
      ],
      [
        "scripts/verify-c04-purpose-keys.mjs",
        7496,
        196,
        "7ec8d840f1e29a4c7e4e5179c9357c00481fc6431c48ed0b0fed35cfa5463edf",
      ],
      [
        "tests/architecture/b03-source-security.test.mjs",
        97423,
        2236,
        "9c8fbc9b830f737d0f759f6bb29b9fd9ef19118be83ab68598fc0c616637a28e",
      ],
      [
        "tests/database/c04-purpose-qualified-keys.test.mjs",
        8820,
        224,
        "d1289a7bf8014e0e3624d6202bdb94f0d31669e902b7a8a62acbcb4558c0d6da",
      ],
    ].map(([path, bytes, lines, sha256]) =>
      Object.freeze({ path, bytes, lines, mode: "0644", sha256 }),
    ),
  ),
  limitations: Object.freeze([
    "NO_DATABASE_EXECUTION_OR_COCKROACH_COMPATIBILITY_EVIDENCE",
    "NO_DATABASE_ROLE_SESSION_ENFORCEMENT_EVIDENCE",
  ]),
});
export const h01SourceBaseline = Object.freeze({
  contract_id: "H01-SOURCE-SECURITY-R1",
  acceptance: "CHIEF_ACCEPTED_UNCHANGED_LOCAL_SYNTHETIC_SOURCE_BASELINE",
  local_commit: "fee213a036b32562cc6ae6af1327dde13925f1d2",
  review_chain: Object.freeze(["Worker", "Terra", "Security", "Lean", "Chief"]),
  limitations: Object.freeze([
    "LOCAL_SYNTHETIC_SOURCE_SECURITY_AND_FOCUSED_TEST_EVIDENCE_ONLY",
    "SUPPLY_CHAIN_CLEANROOM_FULL_SUITE_REPRODUCIBILITY_AND_RUNTIME_WERE_DEFERRED",
  ]),
});
export const failedC01R1 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R1-001.json",
  recordId: "C01-PROV-R1-001",
  bytes: 298190,
  mode: "0644",
  sha256: "409d6f72992892e2303e9b7c10c74fe5ce16f6b2af38f46fc491d2cb8efd4f83",
  aggregate: "0bce2f223ad2142eb924ce310484cd33170bcb76a0991da00f045e19fbb51b24",
});
export const failedC01R2 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R2-001.json",
  recordId: "C01-PROV-R2-001",
  bytes: 301708,
  mode: "0644",
  sha256: "1947e773fe4092908e2f9a70ef89286c3919892321f52178305ab19cb6c582be",
  aggregate: "bb2daa4d20e228c81713cb4ffe3c1ff2104806abe3f9883649e152badb2c2ac8",
});
export const failedC01R3 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R3-001.json",
  recordId: "C01-PROV-R3-001",
  bytes: 304948,
  mode: "0644",
  sha256: "96240bbaa9a53eb23ccfd662aa6418ac60148dc33aa408d8b7182c68ffbb7627",
  aggregate: "40e4efd2b3a9ccd1dda1e788a978c649aa7ab268aa29af8bac626a354a474796",
});
export const failedC01R4 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R4-001.json",
  recordId: "C01-PROV-R4-001",
  bytes: 308185,
  mode: "0644",
  sha256: "d52f27bd57b9d3c40b51a8ed35ee62ee4337509ae34dd3bf2ff6de0c876f4d81",
  aggregate: "efe908ad45649032c9f69215a8b545356dad7887ae6ac0fa26cf1d172c17ae2a",
});
export const acceptedC01R5 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R5-001.json",
  recordId: "C01-PROV-R5-001",
  bytes: 311423,
  mode: "0644",
  sha256: "d5949e8334362e83abf62e8eec6432f5e530151ec6e0f096f7469ac857aaf063",
  aggregate: "47185b9c6af2ff6f54928b077998e25e98ee7e9d182663bdf450907e6e3e9291",
});
export const failedC01R6 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R6-001.json",
  recordId: "C01-PROV-R6-001",
  bytes: 314339,
  mode: "0644",
  sha256: "a61c3e810b3f576e88bb61dbe02d69b2d33065910afff1bb3fc08fbe92045daf",
  aggregate: "1955aa4c527b23489c74b5ee99647b36873d190e0d59853a74d72b80691b189c",
});
export const failedC01R7 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R7-001.json",
  recordId: "C01-PROV-R7-001",
  bytes: 318107,
  mode: "0644",
  sha256: "ae518d016524379fa04ed8bdd68d3d7bb587d759ffd15043d3836ab68ff78adc",
  aggregate: "07df2d0790d8e03e68b05958511f41cce03a02d210c9c9253f2d82dd2f072c79",
});
export const failedC01R8 = Object.freeze({
  path: "ci/generated/provenance/C01-PROV-R8-001.json",
  recordId: "C01-PROV-R8-001",
  bytes: 321345,
  mode: "0644",
  sha256: "8899b45edcaf17663357eb68f4c84ce6cd6962e4e7e6959d25a80c6a9f94385c",
  aggregate: "bd6605c829755990531eca36ba613e9f36181ba4f0f50d5664d27f19309abac0",
});
export const failedC05R9 = Object.freeze({
  path: "ci/generated/provenance/C05-PROV-R9-001.json",
  recordId: "C05-PROV-R9-001",
  bytes: 411346,
  mode: "0644",
  sha256: "6734d1dca9f7bce8d73d88b342b19fe13f04467d8654f31c4be74d0b293d12c6",
  aggregate: "ba5356e4b864cb0f068bf23c42f25dbf4986d6bc55654f3fdb6916a44ab28a0d",
});
export const immutableC05R10 = Object.freeze({
  path: "ci/generated/provenance/C05-PROV-R10-001.json",
  recordId: "C05-PROV-R10-001",
  bytes: 414689,
  mode: "0644",
  sha256: "2e8fa4a683141ea50d03d23eb224702e5b5d9a06a09bd8f3b13c029cc6a907f6",
  aggregate: "71c0526a5ce540283780c51c702811584b0af5a708b6aa397a21d21790355b9e",
});
export const failedH01R1 = Object.freeze({
  path: "ci/generated/provenance/H01-PROV-R1-001.json",
  recordId: "H01-PROV-R1-001",
  bytes: 452319,
  mode: "0644",
  sha256: "40eaab7aa43f585b50bf281c803cd9e6a9967784d97d421820d0f3bbf80691fc",
  aggregate: "cfaadfab203667b69efd9545b3d5ccbaa77613f4776a7b9d8b284bffd4788b93",
});
export const acceptedH01R2 = Object.freeze({
  path: "ci/generated/provenance/H01-PROV-R2-001.json",
  recordId: "H01-PROV-R2-001",
  bytes: 458973,
  mode: "0644",
  sha256: "b51efc1816cf38778d11278e9ad9199f4a4b3dd6ee7f8721ac755b96a156d221",
  aggregate: "9acfbbecbc623906846d97d72e91b8c115b9496feb50b85a9d99709ec0905f24",
});
const burnedH02CR1 = Object.freeze({
  path: "ci/generated/provenance/H02C-PROV-R1-001.json",
  bytes: 0,
  mode: "0644",
  nlink: 1,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
});
export const failedH02CR2 = Object.freeze({
  path: "ci/generated/provenance/H02C-PROV-R2-001.json",
  recordId: "H02C-PROV-R2-001",
  bytes: 529209,
  mode: "0644",
  sha256: "0884ab5f806127665ecb018ca0683954fcd8c206b8c5d0f1b2590e5875bd5a64",
  aggregate: "d7a3b84556bba8c5a9329f779dc99e6c6afabeefb1021cdd979888973c2522c7",
});
export const failedH02CR3 = Object.freeze({
  path: "ci/generated/provenance/H02C-PROV-R3-001.json",
  recordId: "H02C-PROV-R3-001",
  bytes: 531187,
  mode: "0644",
  sha256: "034cf9ad18b669ea65b084fd234cce48593f9502ec9c0680bef9249a9b718767",
  aggregate: "c0e14eddd5aded750336d3872deab450dcd7ab3451ec11e8c00d0a9be7d0f0ac",
});
export const acceptedH02CR4 = Object.freeze({
  path: "ci/generated/provenance/H02C-PROV-R4-001.json",
  recordId: "H02C-PROV-R4-001",
  bytes: 533175,
  mode: "0644",
  sha256: "b9e87ce510c2822b4293c4637078d1160ba9e50a3a6d0e10aceb7a992acb8d5a",
  aggregate: "46bdad207c47d0b46b70574a47ea14646049b847e43d7b9b5ffee3cde71dd58c",
});
export const failedH02CR5 = Object.freeze({
  path: "ci/generated/provenance/H02C-PROV-R5-001.json",
  recordId: "H02C-PROV-R5-001",
  bytes: 535402,
  mode: "0644",
  sha256: "0b4e6bb4443439751a19000d07343c6728c706a3cd7f363276419edc40774008",
  aggregate: "eadc443dd7329197c1a02bbcd11b7683122208cca52dc4616663ba4e486eb770",
});
export const predecessorH02CR6 = Object.freeze({
  path: "ci/generated/provenance/H02C-PROV-R6-001.json",
  recordId: "H02C-PROV-R6-001",
  bytes: 537498,
  mode: "0644",
  sha256: "59b7960eca4ca6613c088f61a3513307b7ce26a40d6381f362f9872c081acbdc",
  aggregate: "a3406edf0e102ba15531f9ac64a27ef95cef06152616e23a765a276cee83ab3a",
});
const sealedH11b = (revision, bytes, sha256, aggregate) =>
  Object.freeze({
    path: `ci/generated/provenance/H11B-PROV-R${revision}-001.json`,
    recordId: `H11B-PROV-R${revision}-001`,
    bytes,
    mode: "0644",
    sha256,
    aggregate,
  });
export const sealedH11bR3 = sealedH11b(
  3,
  672380,
  "8575d324951349975cbd09aba7d2cf39a2941a56da66fd5339f9a9d24ae0d62a",
  "0c3b50c8a50abb4a3e986f49cbb0a2c39cdd3d26d4a013ffb845307f1d29499d",
);
export const sealedH11bR4 = sealedH11b(
  4,
  675970,
  "431ac5dad7b53732e895dfd7329ccc7b3b52aed8cea693dcff6e636e0471d4c0",
  "915b9e05e5490fcd658446c8ef400e2cb08665ebd02779016afac34e153cd7d2",
);
export const sealedH11bR5 = sealedH11b(
  5,
  679078,
  "740be99b882c703e3a60beadbd330065fe0d683ed944782058e0a1e099b6fba5",
  "5537652ec9715bcfa99d30194db6c9c246415178bf466203d018db5b666d1420",
);
export const sealedH11bR6 = sealedH11b(
  6,
  682184,
  "8ca2b5c3a6a5b441de183429c918782e29619faed75c9315e0d84a709dd1f49f",
  "aeba4eb5175a346e187e4a1805c543b8516cbd8c2f0c95a47b3fbc87dee63618",
);
export const sealedH11bR7 = sealedH11b(
  7,
  685289,
  "4e40d46d0b5fc602b8d1f1b5c91cb481890987269cb70b6d78ed4f036879d2d0",
  "a7fa5455f2213941d7139183f20976dfff29eb9ebc7f578ce2bffd4458d2e116",
);
export const sealedH11bR8 = sealedH11b(
  8,
  688394,
  "0f6ac9d43bf4d860408e94edc2bfadc15263b223e6826c95dd5b13d04078fbf8",
  "d2e480fc29ffa0f9354b0c35d354f29bd15e1f7b92d53106f797e6c9ac830b04",
);
export const sealedH11bR9 = sealedH11b(
  9,
  691432,
  "6b36c72a055b9b5e213d81947a98e371d3af955bdd6bc748b2d02a058d0f0f95",
  "c14f11db12f7d840f489590e9d30d7a8193d5997da8ec957a7ec6639c2f1867e",
);
export const sealedH11bR10 = sealedH11b(
  10,
  694542,
  "8788b1df7e5f9fd65568498a3fc6cc6d220e0dda71b025dc631564464c8c413b",
  "0d23027b076cd36820a3ff6c6e18dc84a68515c01542a1bd5ef9e8507a9e14a1",
);
export const sealedH11bR12 = sealedH11b(
  12,
  701149,
  "d5ca37781cb71e58c674044e45550e7b83834ad288fc5b8496c093e23dde5cae",
  "5fff5dbbbd60be74afc77fa2f7e5e1401c3ef7b7158b7baedfbf92ebba4cc7a2",
);
export const sealedH11bR13 = sealedH11b(
  13,
  704260,
  "69ab07dea1bcbab63a1fc9d1fb9024609554bd707dd9ad73b0205c42c5c1eadf",
  "472c90e6114639018214d85ce95fea0352e645ce4f83c3ce965dff0c3d356380",
);
export const sealedH11bR14 = sealedH11b(
  14,
  707367,
  "b3835f200adfc15e81123918ed8df315c74d3371665194820a345a6d0e438011",
  "070e2870c9ee344f6c983375323e20f1ec0cbfcfba71d30241210ad604695d59",
);
export const sealedH11bR15 = sealedH11b(
  15,
  710470,
  "89c533be40a899b33a9547893802ee58aee9a654f32674a97027704bd50eeb3c",
  "8f6d5a8136f20eda901242ccc2fdce2783969c41704c532bad5cb0dfbd1aa349",
);
export const sealedH11bR16 = sealedH11b(
  16,
  713574,
  "00ea5aa33a01d781723b81632d53c4e4c1c56d8ae44b43bb57e5c7d2922838fb",
  "eedbff1f8c3f29eaa75684957aa52e7840620a7b5a3bef63f47c8fd969f0f137",
);
export const sealedH11bR17 = sealedH11b(
  17,
  716677,
  "20c1a98ae9ae958f14f07a3f39bbe8ee37c012dbcf65e1a0788b43a215d16142",
  "17f34fe5d2b10fdadfa501a3271a16b25fba67d4c741747d5bb6d1889d5369e4",
);
export const sealedH11bR19 = sealedH11b(
  19,
  721375,
  "3c9e8a7505a0ca567e1ec5a9bbe3624cfb2f6c51937404cf8d63df1470a1f641",
  "4be2e4f35e6afabae0a262f701100f6755f3a455751d040d55e70c93694ad410",
);
export const sealedH11bR20 = sealedH11b(
  20,
  725998,
  "bdd0efaa61d60f11b3a3d6358e443d3a1f63cca83ad62599a9616007ee8b1b9c",
  "94022a0bbdcff7506ee9ff386786d00e6c571b713c0a5ed130cac439163bc9f4",
);
export const sealedH11bR23 = sealedH11b(
  23,
  734083,
  "94e7aa2ca29718a1af6ee4a94549b1d78f84a555800aa453c10b966b7c006976",
  "439052f6685c23f2c4f209d87d5a32c8e923493481f4f7d70a0d24d910aa2de7",
);
export const failedH11bR11 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R11-001.json",
  recordId: "H11B-PROV-R11-001",
  bytes: 697647,
  mode: "0644",
  sha256: "59fb3c5e785272a1ced78f218a831eb9c382ba01357e82a06fb291efea885f6b",
  aggregate: "6c608647752c67bb813601ea4026deef324a577c89be0846d0e420726639e49f",
});
export const failedH11bR21 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R21-001.json",
  recordId: "H11B-PROV-R21-001",
  bytes: 729106,
  mode: "0644",
  sha256: "d6e32f1442d109bc069df139e446b25b630aed15305d65cada3edb6d91a0a4cc",
  aggregate: "8e3d4076bf1a5be978a20d37566acb6e9b65789ada1999f89207d682343289df",
});
export const failedH11bR24 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R24-001.json",
  recordId: "H11B-PROV-R24-001",
  bytes: 737186,
  mode: "0644",
  sha256: "f9b925661d9cac13589da5374508287aa1195e2b8f86310301efa6301aa912d7",
  aggregate: "b05f7c1fc6fa4e13177ef27122f344716f4d28d052e571b4967b94a9d4d435b3",
});
export const failedH11bR28 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R28-001.json",
  recordId: "H11B-PROV-R28-001",
  bytes: 745299,
  mode: "0644",
  sha256: "02a0487d9f9509c79cf5c23d7cc4e08e5d9ae3cc0c7e553848b740d74c6e5880",
  aggregate: "be73e211c9573e8e17b64b40d1c6599b575a0cedae17ae28c520ea7bd6b5d217",
});
export const failedH11bR30 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R30-001.json",
  recordId: "H11B-PROV-R30-001",
  bytes: 750276,
  mode: "0644",
  sha256: "487eea222b8f19b691ed7f777f604dc019dd9d7365ce740c96b848989395be1e",
  aggregate: "ec1ff44bb4a6bba81d5f01f68700fd2995917e83ddc47258f9c12be09139e8cf",
});
export const failedH11bR32 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R32-001.json",
  recordId: "H11B-PROV-R32-001",
  bytes: 755253,
  mode: "0644",
  sha256: "bfb287f217c3220349ee2cf13874ae41eb3f1858a6b1d22893dd80f9a710a1fa",
  aggregate: "19d6c6ee3f7aed36a75beb959ff36b28f36f077582b61b5e19f88e392b4a8f53",
});
export const failedH11bR34 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R34-001.json",
  recordId: "H11B-PROV-R34-001",
  bytes: 760232,
  mode: "0644",
  sha256: "f59039d8756a82b7a627f41f8388d29ef2d77893bc64c7fcf034277320c10eb9",
  aggregate: "c4e2ae90429d4646e13b1b8dce2fe263dccc5fb72a25f58a037427d47dbfa835",
});
export const failedH11bR38 = Object.freeze({
  path: "ci/generated/provenance/H11B-PROV-R38-001.json",
  recordId: "H11B-PROV-R38-001",
  bytes: 769834,
  mode: "0644",
  sha256: "939beec13e878e8ce16c1e349004057b443e1454530598d0005aae25fffbb826",
  aggregate: "a8b996bdc6b2b0af3d4034273c99d125eaed7e072678bb7916c312644f203d85",
});
const sealedH11bHistory = [
  sealedH11bR3,
  sealedH11bR4,
  sealedH11bR5,
  sealedH11bR6,
  sealedH11bR7,
  sealedH11bR8,
  sealedH11bR9,
  sealedH11bR10,
  sealedH11bR12,
  sealedH11bR13,
  sealedH11bR14,
  sealedH11bR15,
  sealedH11bR16,
  sealedH11bR17,
  sealedH11bR19,
  sealedH11bR20,
];
const sealedH11bHistoryPaths = new Set(sealedH11bHistory.map(({ path: relative }) => relative));
const persistentH11b = (relative, revision, disposition) => ({
  path: relative,
  producer: "scripts/generate-b03-local-evidence.mjs",
  config: "ci/b03-policy.json",
  input: `H11B-FINALIZER-R${revision}`,
  disposition,
});
const failedCandidateHistory = Object.freeze([
  failedC01R1,
  failedC01R2,
  failedC01R3,
  failedC01R4,
  failedC01R6,
  failedC01R7,
  failedC01R8,
  failedC02R1,
  failedC03R1,
  failedC05R9,
  failedH01R1,
  failedH02CR2,
  failedH02CR3,
  failedH02CR5,
  failedH11bR11,
  failedH11bR21,
  failedH11bR24,
  failedH11bR28,
  failedH11bR30,
  failedH11bR32,
  failedH11bR34,
  failedH11bR38,
]);
export const candidateHistory = Object.freeze([
  Object.freeze({
    path: "ci/generated/provenance/B04-PROV-R1-001.json",
    recordId: "B04-PROV-R1-001",
    bytes: 73978,
    mode: "0644",
    sha256: "f97afa2c9fce81fc99bb90931f2e2aaa964f9980e056981fdeecfe4dca9b42e0",
    aggregate: "50f41f7a14cb3c0dd1be29b23dc9a47142ef507b34f0eab7317b318996710fd1",
  }),
  Object.freeze({
    path: "ci/generated/provenance/B04-PROV-R2-001.json",
    recordId: "B04-PROV-R2-001",
    bytes: 73978,
    mode: "0644",
    sha256: "62fc36eedf27640a8e6eeaecb560325c1ee6786ea658277b8bc38ba8700ce971",
    aggregate: "bac3a3a41f67bba623ebaf71515604b8bcf41be276e2be5f548781a08e044f3d",
  }),
  Object.freeze({
    path: "ci/generated/provenance/B04-PROV-R3-001.json",
    recordId: "B04-PROV-R3-001",
    bytes: 73978,
    mode: "0644",
    sha256: "e5fc09603d74abcb7cb3c823e682a39e1f89e14c736de08e4a09fe325cf0726e",
    aggregate: "1d48bd465b709611a1fd239f7daebc9971891dedaed97300ada19e999b8aaccc",
  }),
  Object.freeze({
    path: "ci/generated/provenance/B04-PROV-R4-001.json",
    recordId: "B04-PROV-R4-001",
    bytes: 74378,
    mode: "0644",
    sha256: "924be05b0e72e44305b497183d7cccdb1475a15c8f535d551864567bc7f58cd6",
    aggregate: "1d5b48f1a124a2e05c85d64b099cdd41bcd473dd0d4a092a1c556c153f70c835",
  }),
  Object.freeze({
    path: "ci/generated/provenance/B04-PROV-R5-001.json",
    recordId: "B04-PROV-R5-001",
    bytes: 75799,
    mode: "0644",
    sha256: "d4922a9bb253ef25ab8706b715b639417ff34dbeb658157ea5d6aebf57409d36",
    aggregate: "d1c1f490cd3145ceca214658c9b34f0e071f64c6f72e174f8b6b94f1cb36b599",
  }),
  ...failedCandidateHistory,
]);
export const provenanceOutputAllowlist = Object.freeze([h11bPath]);
export const sbomOutputAllowlist = Object.freeze([
  "ci/generated/sbom.cdx.json",
  "ci/installed-license-evidence.json",
  "ci/tool-payload-inventory.json",
  "ci/trust-baseline.json",
]);
const createOutputAllowlist = () => new Set(provenanceOutputAllowlist);
const exactC01PolicyKeys = Object.freeze(
  [
    "acceptanceLabel",
    "acceptanceState",
    "acceptedProvenancePredecessor",
    "acceptedProvenanceAnchors",
    "candidateHistory",
    "currentProvenance",
    "historicalProvenancePredecessor",
    "installedLicenseEvidence",
    "licenseDecision",
    "licenseRules",
    "limitations",
    "lockfile",
    "notice",
    "policyId",
    "provenancePath",
    "provenancePredecessor",
    "provenanceSubjects",
    "registrySource",
    "reproducibility",
    "sbomPath",
    "schemaVersion",
    "sealedProvenancePredecessor",
    "sourceSecurity",
    "toolPayloadInventory",
    "trustBaselinePath",
    "vulnerabilityStatus",
    "workspaceManifests",
  ].sort(utf8Order),
);

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

export function validatePolicyRelativePath(relative) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => part === "" || part === "." || part === "..") ||
    path.normalize(relative) !== relative
  )
    throw new Error("policy path is not exact repository-relative");
  return relative;
}

async function safeFile(relative) {
  validatePolicyRelativePath(relative);
  const candidate = path.join(repositoryRoot, relative);
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile() || (await realpath(candidate)) !== candidate) {
    throw new Error(`${relative} must be a canonical regular file`);
  }
  return readFile(candidate);
}

async function requireCreateTargetAvailable(relative) {
  try {
    validatePolicyRelativePath(relative);
  } catch {
    throw createFailure("AUTH");
  }
  const parent = path.join(repositoryRoot, path.posix.dirname(relative));
  const basename = path.posix.basename(relative);
  const entries = await createSite("TARGET_AVAILABILITY", () => readdir(parent));
  if (entries.includes(basename)) throw createFailure("TARGET_PREEXISTING");
  const prefix = `.${basename}.zc-create-`;
  if (entries.some((entry) => entry.startsWith(prefix) && entry.endsWith(".tmp")))
    throw createFailure("TARGET_REMNANT");
}

const fileIdentity = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  nlink: stat.nlink,
  size: stat.size,
  type: stat.isFile() ? "regular" : stat.isDirectory() ? "directory" : "other",
});

const sameFileIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.type === right.type;
const validEmptyCreatedIdentity = (identity) =>
  identity.type === "regular" && identity.nlink === 1n && identity.size === 0n;

const sameDirectoryIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  (left.mode & 0o7777n) === (right.mode & 0o7777n) &&
  left.type === "directory" &&
  right.type === "directory";

const createFailureCodes = Object.freeze([
  "AUTH",
  "ROOT_CANONICAL",
  "PARENT_CANONICAL",
  "TARGET_AVAILABILITY",
  "TARGET_PREEXISTING",
  "TARGET_REMNANT",
  "PARENT_OPEN",
  "PARENT_REVALIDATE_PRE_OPEN",
  "EXCLUSIVE_OPEN",
  "PARENT_REVALIDATE_POST_OPEN",
  "CHMOD",
  "HANDLE_IDENTITY",
  "PATH_LSTAT_1",
  "PARENT_REVALIDATE_POST_LSTAT_1",
  "REALPATH",
  "PARENT_REVALIDATE_POST_REALPATH",
  "PATH_LSTAT_2",
  "PARENT_REVALIDATE_POST_LSTAT_2",
  "TARGET_CROSS_OBSERVATION",
  "PARENT_REVALIDATE_PRE_WRITE",
  "WRITE",
  "WRITE_NO_PROGRESS",
  "FILE_SYNC",
  "PARENT_SYNC",
  "PARENT_REVALIDATE_POST_SYNC",
  "POST_VERIFY",
  "POST_READ",
  "TARGET_CLOSE_FAILED",
  "PARENT_CLOSE_FAILED",
  "INTERNAL",
]);
const createFailureCodeSet = new Set(createFailureCodes);
const createFailure = (code) => Object.freeze({ h02cCreateCode: code });
const createCode = (error) =>
  createFailureCodeSet.has(error?.h02cCreateCode) ? error.h02cCreateCode : "INTERNAL";
const createSite = async (code, operation) => {
  try {
    return await operation();
  } catch (error) {
    if (createFailureCodeSet.has(error?.h02cCreateCode)) throw error;
    throw createFailure(code);
  }
};

async function revalidateCreateParent(parent, parentHandle, expected, code) {
  await createSite(code, async () => {
    const held = fileIdentity(await parentHandle.stat({ bigint: true }));
    const observed = fileIdentity(await lstat(parent, { bigint: true }));
    if (
      !sameDirectoryIdentity(expected, held) ||
      !sameDirectoryIdentity(expected, observed) ||
      (await realpath(parent)) !== parent
    )
      throw createFailure(code);
  });
}

async function writeCompletely(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await createSite("WRITE", () =>
      handle.write(bytes, offset, bytes.length - offset, offset),
    );
    if (bytesWritten < 1) throw createFailure("WRITE_NO_PROGRESS");
    offset += bytesWritten;
  }
}

async function readCompletely(handle, length) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await createSite("POST_READ", () =>
      handle.read(bytes, offset, bytes.length - offset, offset),
    );
    if (bytesRead < 1) break;
    offset += bytesRead;
  }
  if (offset !== length) throw createFailure("POST_READ");
  return bytes;
}

async function closeCreateHandles(state, handles, primary) {
  const closeFailures = [];
  if (state === "PARENT_AND_TARGET") {
    try {
      await handles.target.close();
    } catch {
      closeFailures.push("TARGET_CLOSE_FAILED");
    }
  }
  if (state === "PARENT" || state === "PARENT_AND_TARGET") {
    try {
      await handles.parent.close();
    } catch {
      closeFailures.push("PARENT_CLOSE_FAILED");
    }
  }
  return Object.freeze({
    burned: primary !== undefined || closeFailures.length !== 0,
    code: primary ?? closeFailures.at(0),
    closeFailures: Object.freeze(closeFailures),
  });
}

async function createProvenanceOnce(relative, content, allowedTargets) {
  let state = "NONE";
  const handles = { parent: undefined, target: undefined };
  let primary;
  try {
    await createSite("AUTH", async () => {
      validatePolicyRelativePath(relative);
      if (
        !(allowedTargets instanceof Set) ||
        allowedTargets.size !== 1 ||
        !allowedTargets.has(relative)
      )
        throw createFailure("AUTH");
    });
    const root = await createSite("ROOT_CANONICAL", () => realpath(repositoryRoot));
    if (root !== repositoryRoot) throw createFailure("ROOT_CANONICAL");
    const target = path.join(root, relative);
    const parent = path.dirname(target);
    const listedParent = await createSite("PARENT_CANONICAL", () =>
      lstat(parent, { bigint: true }),
    );
    if (
      listedParent.isSymbolicLink() ||
      !listedParent.isDirectory() ||
      (await createSite("PARENT_CANONICAL", () => realpath(parent))) !== parent
    )
      throw createFailure("PARENT_CANONICAL");
    const expectedParent = fileIdentity(listedParent);
    handles.parent = await createSite("PARENT_OPEN", () =>
      open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW),
    );
    state = "PARENT";
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_PRE_OPEN",
    );
    const expected = Buffer.from(content);
    handles.target = await createSite("EXCLUSIVE_OPEN", () =>
      open(
        target,
        constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR,
        0o644,
      ),
    );
    state = "PARENT_AND_TARGET";
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_POST_OPEN",
    );
    await createSite("CHMOD", () => handles.target.chmod(0o644));
    const created = await createSite("HANDLE_IDENTITY", async () =>
      fileIdentity(await handles.target.stat({ bigint: true })),
    );
    if (!validEmptyCreatedIdentity(created) || (created.mode & 0o777n) !== 0o644n)
      throw createFailure("HANDLE_IDENTITY");
    const pathStat1 = await createSite("PATH_LSTAT_1", async () =>
      fileIdentity(await lstat(target, { bigint: true })),
    );
    if (!validEmptyCreatedIdentity(pathStat1)) throw createFailure("PATH_LSTAT_1");
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_POST_LSTAT_1",
    );
    if ((await createSite("REALPATH", () => realpath(target))) !== target)
      throw createFailure("REALPATH");
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_POST_REALPATH",
    );
    const pathStat2 = await createSite("PATH_LSTAT_2", async () =>
      fileIdentity(await lstat(target, { bigint: true })),
    );
    if (!validEmptyCreatedIdentity(pathStat2)) throw createFailure("PATH_LSTAT_2");
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_POST_LSTAT_2",
    );
    if (
      !sameFileIdentity(created, pathStat1) ||
      !sameFileIdentity(created, pathStat2) ||
      !sameFileIdentity(pathStat1, pathStat2)
    )
      throw createFailure("TARGET_CROSS_OBSERVATION");
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_PRE_WRITE",
    );
    await writeCompletely(handles.target, expected);
    await createSite("FILE_SYNC", () => handles.target.sync());
    await createSite("PARENT_SYNC", () => handles.parent.sync());
    await revalidateCreateParent(
      parent,
      handles.parent,
      expectedParent,
      "PARENT_REVALIDATE_POST_SYNC",
    );
    const expectedIdentity = { ...created, size: BigInt(expected.length) };
    const finalHandle = await createSite("POST_VERIFY", async () =>
      fileIdentity(await handles.target.stat({ bigint: true })),
    );
    const finalPathStat = await createSite("POST_VERIFY", () => lstat(target, { bigint: true }));
    const finalPath = fileIdentity(finalPathStat);
    if (
      finalPathStat.isSymbolicLink() ||
      (await createSite("POST_VERIFY", () => realpath(target))) !== target ||
      !sameFileIdentity(expectedIdentity, finalHandle) ||
      !sameFileIdentity(expectedIdentity, finalPath) ||
      !(await readCompletely(handles.target, expected.length)).equals(expected)
    )
      throw createFailure("POST_VERIFY");
  } catch (error) {
    primary = createCode(error);
  }
  const outcome = await closeCreateHandles(state, handles, primary);
  if (outcome.burned) throw createFailure(outcome.code);
}

export async function validateAcceptedR12(policy) {
  if (
    !Array.isArray(policy.acceptedProvenanceAnchors) ||
    policy.acceptedProvenanceAnchors.length !== 1 ||
    JSON.stringify(policy.acceptedProvenanceAnchors[0]) !== JSON.stringify(acceptedR12)
  )
    throw new Error("accepted R12 provenance anchor tuple is invalid");
  const bytes = await safeFile(acceptedR12.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedR12.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedR12.mode ||
    bytes.length !== acceptedR12.bytes ||
    digest(bytes) !== acceptedR12.sha256
  )
    throw new Error("accepted R12 provenance anchor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedR12.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedR12.aggregate
  )
    throw new Error("accepted R12 provenance record binding differs");
}

export async function validateHistoricalB05Predecessor(policy) {
  if (
    JSON.stringify(policy.historicalProvenancePredecessor) !==
    JSON.stringify(acceptedB05Predecessor)
  ) {
    throw new Error("historical B05 provenance predecessor tuple is invalid");
  }
  if (
    acceptedB05Predecessor.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(acceptedB05Predecessor.path)
  ) {
    throw new Error("historical B05 provenance predecessor is writable or current");
  }
  const bytes = await safeFile(acceptedB05Predecessor.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedB05Predecessor.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedB05Predecessor.mode ||
    bytes.length !== acceptedB05Predecessor.bytes ||
    digest(bytes) !== acceptedB05Predecessor.sha256
  ) {
    throw new Error("historical B05 provenance predecessor differs");
  }
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedB05Predecessor.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedB05Predecessor.aggregate
  ) {
    throw new Error("historical B05 provenance predecessor bind differs");
  }
}

export async function validateAcceptedC01R5(policy) {
  if (
    acceptedC01R5.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(acceptedC01R5.path)
  ) {
    throw new Error("C01 R5 predecessor invalid");
  }
  const bytes = await safeFile(acceptedC01R5.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedC01R5.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedC01R5.mode ||
    bytes.length !== acceptedC01R5.bytes ||
    digest(bytes) !== acceptedC01R5.sha256
  ) {
    throw new Error("accepted C01 R5 predecessor differs");
  }
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedC01R5.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedC01R5.aggregate
  ) {
    throw new Error("C01 R5 predecessor bind");
  }
}

export async function validateFailedC01R6(policy) {
  const bytes = await safeFile(failedC01R6.path);
  const stat = await lstat(path.join(repositoryRoot, failedC01R6.path));
  if (
    failedC01R6.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedC01R6.path) ||
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedC01R6.mode ||
    bytes.length !== failedC01R6.bytes ||
    digest(bytes) !== failedC01R6.sha256
  ) {
    throw new Error("failed C01 R6 predecessor differs");
  }
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedC01R6.recordId ||
    record.batch_integrity?.aggregate_digest !== failedC01R6.aggregate
  ) {
    throw new Error("C01 R6 predecessor bind");
  }
}

export async function validateFailedC01R7(policy) {
  const bytes = await safeFile(failedC01R7.path);
  const stat = await lstat(path.join(repositoryRoot, failedC01R7.path));
  if (
    failedC01R7.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedC01R7.path) ||
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedC01R7.mode ||
    bytes.length !== failedC01R7.bytes ||
    digest(bytes) !== failedC01R7.sha256
  ) {
    throw new Error("failed C01 R7 predecessor differs");
  }
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedC01R7.recordId ||
    record.batch_integrity?.aggregate_digest !== failedC01R7.aggregate
  ) {
    throw new Error("C01 R7 predecessor bind");
  }
}

export async function validateFailedC01R8(policy) {
  const bytes = await safeFile(failedC01R8.path);
  const stat = await lstat(path.join(repositoryRoot, failedC01R8.path));
  if (
    failedC01R8.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedC01R8.path) ||
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedC01R8.mode ||
    bytes.length !== failedC01R8.bytes ||
    digest(bytes) !== failedC01R8.sha256
  ) {
    throw new Error("failed C01 R8 predecessor differs");
  }
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedC01R8.recordId ||
    record.batch_integrity?.aggregate_digest !== failedC01R8.aggregate
  ) {
    throw new Error("C01 R8 predecessor bind");
  }
}

export async function validateAcceptedC01R9(policy) {
  if (
    acceptedC01R9.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(acceptedC01R9.path)
  )
    throw new Error("accepted C01 R9 predecessor invalid");
  const bytes = await safeFile(acceptedC01R9.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedC01R9.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedC01R9.mode ||
    bytes.length !== acceptedC01R9.bytes ||
    digest(bytes) !== acceptedC01R9.sha256
  )
    throw new Error("accepted C01 R9 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedC01R9.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedC01R9.aggregate
  )
    throw new Error("C01 R9 predecessor bind");
}

export async function validateFailedC02R1(policy) {
  if (
    failedC02R1.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedC02R1.path)
  )
    throw new Error("failed C02 R1 predecessor invalid");
  const bytes = await safeFile(failedC02R1.path);
  const stat = await lstat(path.join(repositoryRoot, failedC02R1.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedC02R1.mode ||
    bytes.length !== failedC02R1.bytes ||
    digest(bytes) !== failedC02R1.sha256
  )
    throw new Error("failed C02 R1 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedC02R1.recordId ||
    record.batch_integrity?.aggregate_digest !== failedC02R1.aggregate
  )
    throw new Error("C02 R1 predecessor bind");
}

export async function validateAcceptedC02R2(policy) {
  if (
    acceptedC02R2.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(acceptedC02R2.path)
  )
    throw new Error("accepted C02 R2 predecessor invalid");
  const bytes = await safeFile(acceptedC02R2.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedC02R2.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedC02R2.mode ||
    bytes.length !== acceptedC02R2.bytes ||
    digest(bytes) !== acceptedC02R2.sha256
  )
    throw new Error("accepted C02 R2 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedC02R2.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedC02R2.aggregate
  )
    throw new Error("C02 R2 predecessor bind");
}

export const validateAcceptedC03R2 = (policy) =>
  validateExactPredecessor(policy, acceptedC03R2, "accepted C03 R2 predecessor");
export const validateAcceptedC03R3 = (policy) =>
  validateExactPredecessor(policy, acceptedC03R3, "accepted C03 R3 predecessor");
export const validateAcceptedC03R4 = (policy) =>
  validateExactPredecessor(policy, acceptedC03R4, "accepted C03 R4 predecessor");

async function validateExactPredecessor(policy, entry, label) {
  if (entry.path === policy.provenancePath || provenanceOutputAllowlist.includes(entry.path))
    throw new Error(`${label} tuple is invalid or writable`);
  const bytes = await safeFile(entry.path);
  const stat = await lstat(path.join(repositoryRoot, entry.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== entry.mode ||
    stat.nlink !== 1 ||
    bytes.length !== entry.bytes ||
    digest(bytes) !== entry.sha256
  )
    throw new Error(`${label} differs`);
  const record = JSON.parse(bytes);
  if (
    record.record_id !== entry.recordId ||
    record.batch_integrity?.aggregate_digest !== entry.aggregate
  )
    throw new Error(`${label} binding differs`);
}

export const validateAcceptedC04R1 = (policy) =>
  validateExactPredecessor(policy, acceptedC04R1, "accepted C04 R1 predecessor");
export const validateAcceptedC04R2 = (policy) =>
  validateExactPredecessor(policy, acceptedC04R2, "accepted C04 R2 predecessor");
export const validateAcceptedC04R3 = (policy) =>
  validateExactPredecessor(policy, acceptedC04R3, "accepted C04 R3 predecessor");

export async function validateSealedH11bHistory(policy) {
  for (const entry of sealedH11bHistory)
    await validateExactPredecessor(policy, entry, `sealed ${entry.recordId} history`);
}
export async function validateImmutableC05R10(policy) {
  if (
    immutableC05R10.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(immutableC05R10.path) ||
    sbomOutputAllowlist.includes(immutableC05R10.path) ||
    policy.candidateHistory.some(
      ({ path: candidatePath }) => candidatePath === immutableC05R10.path,
    )
  )
    throw new Error("C05 R10 predecessor invalid");
  const bytes = await safeFile(immutableC05R10.path);
  const stat = await lstat(path.join(repositoryRoot, immutableC05R10.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== immutableC05R10.mode ||
    bytes.length !== immutableC05R10.bytes ||
    digest(bytes) !== immutableC05R10.sha256
  )
    throw new Error("immutable C05 R10 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== immutableC05R10.recordId ||
    record.batch_integrity?.aggregate_digest !== immutableC05R10.aggregate
  )
    throw new Error("C05 R10 predecessor bind");
}

export async function validateFailedH01R1(policy) {
  if (
    failedH01R1.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedH01R1.path)
  )
    throw new Error("H01 R1 predecessor invalid");
  const bytes = await safeFile(failedH01R1.path);
  const stat = await lstat(path.join(repositoryRoot, failedH01R1.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedH01R1.mode ||
    stat.nlink !== 1 ||
    bytes.length !== failedH01R1.bytes ||
    digest(bytes) !== failedH01R1.sha256
  )
    throw new Error("failed H01 R1 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedH01R1.recordId ||
    record.batch_integrity?.aggregate_digest !== failedH01R1.aggregate
  )
    throw new Error("H01 R1 predecessor bind");
}

export async function validateAcceptedH01R2(policy) {
  if (
    acceptedH01R2.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(acceptedH01R2.path)
  )
    throw new Error("H01 R2 predecessor invalid");
  const bytes = await safeFile(acceptedH01R2.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedH01R2.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedH01R2.mode ||
    stat.nlink !== 1 ||
    bytes.length !== acceptedH01R2.bytes ||
    digest(bytes) !== acceptedH01R2.sha256
  )
    throw new Error("accepted H01 R2 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedH01R2.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedH01R2.aggregate
  )
    throw new Error("H01 R2 predecessor bind");
}

export async function validateAcceptedH02CR4(policy) {
  if (
    JSON.stringify(policy.acceptedProvenancePredecessor) !== JSON.stringify(acceptedH02CR4) ||
    acceptedH02CR4.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(acceptedH02CR4.path)
  )
    throw new Error("H02C R4 predecessor invalid");
  const bytes = await safeFile(acceptedH02CR4.path);
  const stat = await lstat(path.join(repositoryRoot, acceptedH02CR4.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== acceptedH02CR4.mode ||
    stat.nlink !== 1 ||
    bytes.length !== acceptedH02CR4.bytes ||
    digest(bytes) !== acceptedH02CR4.sha256
  )
    throw new Error("accepted H02C R4 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== acceptedH02CR4.recordId ||
    record.batch_integrity?.aggregate_digest !== acceptedH02CR4.aggregate ||
    record.artifacts?.length !== 337
  )
    throw new Error("H02C R4 predecessor bind");
}

export async function validateFailedH02CR5(policy) {
  if (
    failedH02CR5.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedH02CR5.path)
  )
    throw new Error("H02C R5 predecessor invalid");
  const bytes = await safeFile(failedH02CR5.path);
  const stat = await lstat(path.join(repositoryRoot, failedH02CR5.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedH02CR5.mode ||
    stat.nlink !== 1 ||
    bytes.length !== failedH02CR5.bytes ||
    digest(bytes) !== failedH02CR5.sha256
  )
    throw new Error("failed H02C R5 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedH02CR5.recordId ||
    record.batch_integrity?.aggregate_digest !== failedH02CR5.aggregate ||
    record.artifacts?.length !== 338
  )
    throw new Error("H02C R5 predecessor bind");
}

export async function validatePredecessorH02CR6(policy) {
  if (
    JSON.stringify(policy.provenancePredecessor) !== JSON.stringify(predecessorH02CR6) ||
    predecessorH02CR6.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(predecessorH02CR6.path)
  )
    throw new Error("H02C R6 predecessor invalid");
  const bytes = await safeFile(predecessorH02CR6.path);
  const stat = await lstat(path.join(repositoryRoot, predecessorH02CR6.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== predecessorH02CR6.mode ||
    stat.nlink !== 1 ||
    bytes.length !== predecessorH02CR6.bytes ||
    digest(bytes) !== predecessorH02CR6.sha256
  )
    throw new Error("H02C R6 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== predecessorH02CR6.recordId ||
    record.batch_integrity?.aggregate_digest !== predecessorH02CR6.aggregate
  )
    throw new Error("H02C R6 predecessor bind differs");
}

async function validateBurnedH02CR1(policy) {
  const bytes = await safeFile(burnedH02CR1.path);
  const stat = await lstat(path.join(repositoryRoot, burnedH02CR1.path));
  if (
    burnedH02CR1.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(burnedH02CR1.path) ||
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== burnedH02CR1.mode ||
    stat.nlink !== burnedH02CR1.nlink ||
    bytes.length !== burnedH02CR1.bytes ||
    digest(bytes) !== burnedH02CR1.sha256
  )
    throw new Error("H02C R1 history invalid");
}

export async function validateFailedC03R1(policy) {
  if (
    failedC03R1.path === policy.provenancePath ||
    provenanceOutputAllowlist.includes(failedC03R1.path)
  )
    throw new Error("failed C03 R1 predecessor invalid");
  const bytes = await safeFile(failedC03R1.path);
  const stat = await lstat(path.join(repositoryRoot, failedC03R1.path));
  if (
    (stat.mode & 0o777).toString(8).padStart(4, "0") !== failedC03R1.mode ||
    bytes.length !== failedC03R1.bytes ||
    digest(bytes) !== failedC03R1.sha256
  )
    throw new Error("failed C03 R1 predecessor differs");
  const record = JSON.parse(bytes);
  if (
    record.record_id !== failedC03R1.recordId ||
    record.batch_integrity?.aggregate_digest !== failedC03R1.aggregate
  )
    throw new Error("C03 R1 predecessor bind");
}

export async function validateCandidateHistory(policy) {
  if (JSON.stringify(policy.candidateHistory) !== JSON.stringify(candidateHistory))
    throw new Error("candidate history tuple is invalid");
  const paths = policy.candidateHistory.map(({ path: entryPath }) => entryPath);
  const records = policy.candidateHistory.map(({ recordId }) => recordId);
  if (
    new Set(paths).size !== candidateHistory.length ||
    new Set(records).size !== candidateHistory.length ||
    policy.candidateHistory
      .slice(0, 5)
      .some(
        ({ path: entryPath, recordId }, index) =>
          entryPath !== `ci/generated/provenance/B04-PROV-R${index + 1}-001.json` ||
          recordId !== `B04-PROV-R${index + 1}-001`,
      ) ||
    JSON.stringify(policy.candidateHistory.slice(5)) !== JSON.stringify(failedCandidateHistory)
  )
    throw new Error("candidate history invalid");
  if (
    paths.includes(policy.provenancePath) ||
    paths.some((entryPath) => provenanceOutputAllowlist.includes(entryPath))
  )
    throw new Error("candidate entry invalid");
  for (const entry of candidateHistory) {
    const bytes = await safeFile(entry.path);
    const stat = await lstat(path.join(repositoryRoot, entry.path));
    if (
      (stat.mode & 0o777).toString(8).padStart(4, "0") !== entry.mode ||
      bytes.length !== entry.bytes ||
      digest(bytes) !== entry.sha256
    )
      throw new Error(`candidate history entry differs: ${entry.recordId}`);
    const record = JSON.parse(bytes);
    if (
      record.record_id !== entry.recordId ||
      record.batch_integrity?.aggregate_digest !== entry.aggregate
    )
      throw new Error(`candidate history binding differs: ${entry.recordId}`);
  }
}

export function validateH02CProvenancePolicy(policy) {
  const current = {
    path: h11bPath,
    recordId: "H11B-PROV-R51-001",
    taskId: "H11B",
    actor: "codex-h11b-finalizer-r51-worker",
    predicateType: "zintus-continuity.local-unsigned-provenance@85",
    recordedAt: "2026-08-17T08:00:00.000Z",
  };
  if (
    JSON.stringify(Array.from(ownDataKeys(policy)).sort(utf8Order)) !==
      JSON.stringify(exactC01PolicyKeys) ||
    policy.schemaVersion !== 4 ||
    policy.policyId !== "zintus-continuity-local-ci@65" ||
    policy.acceptanceLabel !==
      "H11B_FINALIZER_LOCAL_SYNTHETIC_UNSIGNED_PROVENANCE_PENDING_EXTERNAL_REVIEW" ||
    policy.acceptanceState !== "PUBLIC_READY_BLOCKED_PENDING_EXTERNAL_REVIEW" ||
    policy.provenancePath !== current.path ||
    JSON.stringify(policy.currentProvenance) !== JSON.stringify(current) ||
    JSON.stringify(policy.sealedProvenancePredecessor) !== JSON.stringify(sealedH11bR23) ||
    policy.provenancePath === acceptedR12.path
  )
    throw new Error("H11B successor provenance policy identity is invalid");
  const excludedPaths = policy.sourceSecurity?.excludedPaths;
  if (
    !Array.isArray(excludedPaths) ||
    excludedPaths.filter((entry) => entry === ".worktrees").length !== 1 ||
    readOwnData(excludedPaths, String(excludedPaths.indexOf(".git") + 1)) !== ".worktrees"
  )
    throw new Error("H11B worktree exclusion invalid");
  requireStrictUtf8Order(policy.provenanceSubjects, "provenance subjects");
  const subjects = new Set(policy.provenanceSubjects);
  const hasExactlyOneSubject = (relative) =>
    policy.provenanceSubjects.filter((entry) => entry === relative).length === 1;
  if (
    policy.provenanceSubjects.length !== 505 ||
    subjects.size !== policy.provenanceSubjects.length ||
    subjects.has(policy.provenancePath) ||
    !subjects.has(policy.sbomPath) ||
    !subjects.has(acceptedR12.path) ||
    !subjects.has(acceptedB05Predecessor.path) ||
    !subjects.has(failedC01R1.path) ||
    !subjects.has(failedC01R2.path) ||
    !subjects.has(failedC01R3.path) ||
    !subjects.has(failedC01R4.path) ||
    !subjects.has(acceptedC01R5.path) ||
    !subjects.has(failedC01R6.path) ||
    !subjects.has(failedC01R7.path) ||
    !subjects.has(failedC01R8.path) ||
    !subjects.has(acceptedC01R9.path) ||
    !subjects.has(failedC02R1.path) ||
    !subjects.has(acceptedC02R2.path) ||
    !subjects.has(failedC03R1.path) ||
    !subjects.has(acceptedC03R2.path) ||
    !subjects.has(acceptedC03R3.path) ||
    !subjects.has(acceptedC03R4.path) ||
    !subjects.has(acceptedC04R1.path) ||
    !subjects.has(acceptedC04R2.path) ||
    !subjects.has(acceptedC04R3.path) ||
    !subjects.has("ci/c04-cleanroom-policy-r3.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r1.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r2.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r3.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r4.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r5.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r6.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r7.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r8.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r9.json") ||
    !subjects.has("ci/c05-cleanroom-policy-r10.json") ||
    !subjects.has("ci/h01-cleanroom-policy-r1.json") ||
    !subjects.has("ci/h01-cleanroom-policy-r2.json") ||
    !subjects.has(failedH01R1.path) ||
    !subjects.has(acceptedH01R2.path) ||
    !subjects.has(burnedH02CR1.path) ||
    !subjects.has(failedH02CR2.path) ||
    !subjects.has(failedH02CR3.path) ||
    !subjects.has(acceptedH02CR4.path) ||
    !subjects.has(failedH02CR5.path) ||
    !sealedH11bHistory.every(({ path: relative }) => subjects.has(relative)) ||
    !subjects.has(sealedH11bR16.path) ||
    !subjects.has(sealedH11bR20.path) ||
    !subjects.has(sealedH11bR23.path) ||
    !subjects.has(failedH11bR11.path) ||
    !subjects.has(failedH11bR21.path) ||
    !subjects.has(failedH11bR24.path) ||
    !subjects.has(failedH11bR28.path) ||
    !subjects.has(failedH11bR30.path) ||
    !subjects.has(failedH11bR32.path) ||
    !subjects.has(failedH11bR34.path) ||
    !subjects.has("ci/h02c-cleanroom-policy-r1.json") ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].every((revision) =>
      subjects.has(`ci/h11b-cleanroom-policy-r${revision}.json`),
    ) ||
    !subjects.has("ci/generated/provenance/H11B-PROV-R3-001.json") ||
    !subjects.has("ci/generated/provenance/H02C-PROV-R6-001.json") ||
    !subjects.has("docs/hackathon/evidence/h02c-c06-closure.json") ||
    !subjects.has("docs/hackathon/h02b-c06-closure-contract.md") ||
    !subjects.has("docs/hackathon/h02b-c06-closure-contract-r2.md") ||
    !subjects.has("docs/hackathon/h02b-c06-executable-checkpoint-contract-r3.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r2.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r3.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r4.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r5.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r6.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r7.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r8.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r9.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r10.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r11.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r12.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r13.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r14.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r15.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r16.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r17.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r18.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r19.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r20.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r21.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r22.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r23.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r24.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r25.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r26.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r27.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r28.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r29.md") ||
    !subjects.has("docs/hackathon/h02c-c06-provenance-and-transition-contract-r30.md") ||
    !subjects.has("scripts/h02c-ci-inventory.py") ||
    !subjects.has("docs/hackathon/h02a-empty-worktree-container-amendment.md") ||
    !subjects.has("docs/hackathon/h02a-r8-single-quarantine-read-successor.md") ||
    !subjects.has("docs/hackathon/h02a-r9-minimal-single-read-successor.md") ||
    !subjects.has("docs/hackathon/h02a-read-budget-successor.md") ||
    !subjects.has("docs/hackathon/h02a-safe-index-access-successor.md") ||
    !subjects.has("docs/hackathon/h02a-streaming-ledger-hash-successor.md") ||
    !subjects.has("docs/hackathon/h02a-test-types-successor.md") ||
    !subjects.has("docs/hackathon/h02a-worktree-reference-successor.md") ||
    !subjects.has(immutableC05R10.path) ||
    candidateHistory.some(({ path: entryPath }) => !subjects.has(entryPath)) ||
    !hasExactlyOneSubject(acceptedR12.path) ||
    !hasExactlyOneSubject(acceptedB05Predecessor.path) ||
    !hasExactlyOneSubject(failedC01R1.path) ||
    !hasExactlyOneSubject(failedC01R2.path) ||
    !hasExactlyOneSubject(failedC01R3.path) ||
    !hasExactlyOneSubject(failedC01R4.path) ||
    !hasExactlyOneSubject(acceptedC01R5.path) ||
    !hasExactlyOneSubject(failedC01R6.path) ||
    !hasExactlyOneSubject(failedC01R7.path) ||
    !hasExactlyOneSubject(failedC01R8.path) ||
    !hasExactlyOneSubject(acceptedC01R9.path) ||
    !hasExactlyOneSubject(failedC02R1.path) ||
    !hasExactlyOneSubject(acceptedC02R2.path) ||
    !hasExactlyOneSubject(failedC03R1.path) ||
    !hasExactlyOneSubject(acceptedC03R2.path) ||
    !hasExactlyOneSubject(acceptedC03R3.path) ||
    !hasExactlyOneSubject(acceptedC03R4.path) ||
    !hasExactlyOneSubject(acceptedC04R1.path) ||
    !hasExactlyOneSubject(failedH01R1.path) ||
    !hasExactlyOneSubject(acceptedH01R2.path) ||
    !hasExactlyOneSubject(burnedH02CR1.path) ||
    !hasExactlyOneSubject(failedH02CR2.path) ||
    !hasExactlyOneSubject(failedH02CR3.path) ||
    !hasExactlyOneSubject(acceptedH02CR4.path) ||
    !hasExactlyOneSubject(failedH02CR5.path) ||
    !hasExactlyOneSubject(immutableC05R10.path) ||
    !hasExactlyOneSubject(policy.sbomPath)
  )
    throw new Error("H11B subject graph invalid");
  for (const relative of policy.provenanceSubjects) validatePolicyRelativePath(relative);
  if (
    policy.installedLicenseEvidence.evidenceId !==
      "zintus-continuity-installed-license-evidence@15" ||
    policy.toolPayloadInventory.schemaVersion !== 4 ||
    policy.toolPayloadInventory.inventoryId !== "zintus-continuity-tool-payloads@21" ||
    policy.toolPayloadInventory.maxTrees !== 139 ||
    policy.toolPayloadInventory.maxFiles !== 4371
  )
    throw new Error("H11B evidence identity invalid");
  const requiredLimitations = [
    "H11B_FINALIZER_LOCAL_SYNTHETIC_UNSIGNED_PROVENANCE_PENDING_EXTERNAL_REVIEW",
    "PHASE0_PREEXECUTION_TRUST_UNPROVEN",
    "VERIFIED_MODULE_LOAD_TOCTOU_UNPROVEN",
    "NO_CROSS_HOST_OR_CLEAN_CLONE_REPRODUCIBILITY",
    "NO_SIGNATURE_OR_EXTERNAL_ATTESTATION",
    "NO_VENDOR_AUTHENTICITY_OR_LEGAL_CLEARANCE",
    "NO_HOSTED_CI_OR_ADVISORY_SNAPSHOT",
    "NO_RUNTIME_CLOUD_DEPLOYMENT_RELEASE_PRODUCTION_CLAIM",
    "NO_DATABASE_EXECUTION_OR_COCKROACH_COMPATIBILITY_EVIDENCE",
    "NO_KMS_KEY_GENERATION_ENCRYPTION_DECRYPTION_OR_KEY_DESTRUCTION_EVIDENCE",
    "NO_RETENTION_SWEEP_PAYLOAD_ERASURE_BACKUP_RESTORE_OR_CASCADE_EXECUTION_EVIDENCE",
    "NO_RUNTIME_TENANT_ROLE_SESSION_ENFORCEMENT_EVIDENCE",
    "RAW_TSC_REGENERATED_IGNORED_BUILDINFO_PRIOR_BYTES_UNAVAILABLE_NO_EXACT_RESTORATION_CLAIM",
    "QUARANTINED_TRACKED_HISTORICAL_SUBJECT_CONTENT_UNTRUSTED",
    "QUARANTINED_TRACKED_HISTORICAL_SUBJECT_PUBLIC_EXPORT_PROHIBITED",
    "QUARANTINED_TRACKED_HISTORICAL_SUBJECT_RUNTIME_PROHIBITED",
    "RECOVERY_BASELINE_COMMITTED_ARTIFACT_CONTRARY_TO_PRIOR_NO_GIT_GOVERNANCE",
    "OPAQUE_LOCAL_WORKTREE_ROOT_UNVERIFIED_NOT_PROVENANCE_SUBJECT",
    "H02C_R1_IMMUTABLE_BURNED_ZERO_BYTE_NON_PROVENANCE_HISTORY",
    "H02C_R5_IMMUTABLE_FAILED_REVIEW_IMMEDIATE_PREDECESSOR_HISTORY",
    "FINALIZER_SEQUENTIAL_FOUR_REPLACEMENT_ONE_CREATE_PUBLICATION_IS_NOT_ATOMIC_AND_HAS_NO_ROLLBACK_OR_RETRY",
    "H11B_CREATE_ONCE_ASSUMES_QUIESCED_NON_HOSTILE_LOCAL_WORKSPACE",
  ];
  if (
    JSON.stringify(policy.limitations) !== JSON.stringify(requiredLimitations) ||
    policy.limitations.some((entry) => entry.includes("RENAME_TOCTOU"))
  ) {
    throw new Error("H11B limitations invalid");
  }
}

export function validatePredecessorMeanings(policy, cleanroomPolicy) {
  const binding = cleanroomPolicy?.identityBinding;
  const policyPredecessor = {
    path: "ci/h11b-cleanroom-policy-r51.json",
    bytes: 52214,
    mode: "0644",
    sha256: "96677d77de8d09f76253a858b1addc0e188eef2fd494a0b43a1363be14fd5b03",
    disposition: "immutable-failed-current-task-policy-history",
  };
  const persistentTail = cleanroomPolicy.persistentGenerated?.slice(-27);
  if (
    cleanroomPolicy.policyId !== "zintus-continuity-h11b-cleanroom@52" ||
    binding?.trustBaselineId !== "zintus-continuity-local-trust@65" ||
    binding?.toolPayloadInventoryId !== "zintus-continuity-tool-payloads@21" ||
    binding?.currentProvenancePath !== policy.provenancePath ||
    binding?.currentProvenanceRecordId !== policy.currentProvenance.recordId ||
    binding?.predicateType !== policy.currentProvenance.predicateType ||
    binding?.acceptanceLabel !== policy.acceptanceLabel ||
    binding?.acceptanceState !== policy.acceptanceState ||
    JSON.stringify(binding?.sealedProvenancePredecessor) !== JSON.stringify(sealedH11bR23) ||
    JSON.stringify(binding?.policyPredecessor) !== JSON.stringify(policyPredecessor) ||
    digest(Buffer.from(JSON.stringify(binding?.failedPolicyHistory))) !==
      "63a29763cfcf1bcb71863afe14469f3de535107154fdd24b76613ca329bb0387" ||
    digest(Buffer.from(JSON.stringify(binding?.failedPartialOutputHistory))) !==
      "b39936a8760cf0584f4f81d2098ae19413a042c25b478bd08c52df98fe7684cd" ||
    JSON.stringify(binding?.immediatePredecessor) !== JSON.stringify(predecessorH02CR6) ||
    JSON.stringify(binding?.acceptedPredecessor) !== JSON.stringify(acceptedH02CR4) ||
    JSON.stringify(binding?.priorAcceptedPredecessor) !== JSON.stringify(acceptedH01R2) ||
    JSON.stringify(binding?.historicalPredecessor) !== JSON.stringify(acceptedB05Predecessor) ||
    JSON.stringify(policy.provenancePredecessor) !== JSON.stringify(predecessorH02CR6) ||
    JSON.stringify(policy.acceptedProvenancePredecessor) !== JSON.stringify(acceptedH02CR4) ||
    JSON.stringify(policy.historicalProvenancePredecessor) !==
      JSON.stringify(acceptedB05Predecessor) ||
    JSON.stringify(persistentTail) !==
      JSON.stringify([
        persistentH11b(sealedH11bR12.path, 12, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR13.path, 13, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR14.path, 14, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR15.path, 15, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR16.path, 16, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR17.path, 17, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR19.path, 19, "immutable-sealed-local-provenance-history"),
        persistentH11b(sealedH11bR20.path, 20, "immutable-sealed-local-provenance-history"),
        persistentH11b(failedH11bR21.path, 21, "immutable-failed-current-task-candidate"),
        persistentH11b(sealedH11bR23.path, 23, "immutable-sealed-local-provenance-predecessor"),
        persistentH11b(failedH11bR24.path, 24, "immutable-failed-current-task-candidate"),
        persistentH11b(failedH11bR28.path, 28, "immutable-failed-current-task-candidate"),
        persistentH11b(failedH11bR30.path, 30, "immutable-failed-current-task-candidate"),
        persistentH11b(failedH11bR32.path, 32, "immutable-failed-current-task-candidate"),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R34-001.json",
          34,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R37-001.json",
          37,
          "immutable-sealed-local-provenance-history",
        ),
        persistentH11b(failedH11bR38.path, 38, "immutable-failed-current-task-candidate"),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R40-001.json",
          40,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R41-001.json",
          41,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R42-001.json",
          42,
          "immutable-sealed-local-provenance-history",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R43-001.json",
          43,
          "immutable-sealed-local-provenance-history",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R44-001.json",
          44,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R46-001.json",
          46,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R47-001.json",
          47,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R48-001.json",
          48,
          "immutable-failed-current-task-candidate",
        ),
        persistentH11b(
          "ci/generated/provenance/H11B-PROV-R49-001.json",
          49,
          "immutable-sealed-local-provenance-history",
        ),
        persistentH11b(policy.provenancePath, 51, "current-provenance"),
      ]) ||
    cleanroomPolicy.persistentGenerated.filter(
      ({ disposition }) => disposition === "current-provenance",
    ).length !== 1 ||
    [
      acceptedH01R2.path,
      acceptedB05Predecessor.path,
      burnedH02CR1.path,
      failedH02CR2.path,
      failedH02CR3.path,
      acceptedH02CR4.path,
      failedH02CR5.path,
      predecessorH02CR6.path,
    ].includes(policy.provenancePath) ||
    [
      acceptedH01R2.path,
      acceptedH02CR4.path,
      failedH02CR5.path,
      predecessorH02CR6.path,
      acceptedB05Predecessor.path,
    ].some((entry) => provenanceOutputAllowlist.includes(entry))
  )
    throw new Error("H11B predecessor meanings differ");
}

export function validateGovernedUniverse(policy, discovered, artifacts = discovered) {
  for (const [label, values] of [
    ["discovered governed files", discovered],
    ["provenance artifact paths", artifacts],
  ]) {
    if (!Array.isArray(values) || new Set(values).size !== values.length)
      throw new Error(`${label} must be unique`);
    requireStrictUtf8Order(values, label);
    for (const relative of values) validatePolicyRelativePath(relative);
  }
  if (
    policy.provenanceSubjects.includes(policy.provenancePath) ||
    discovered.includes(policy.provenancePath) ||
    artifacts.includes(policy.provenancePath) ||
    JSON.stringify(policy.provenanceSubjects) !== JSON.stringify(discovered) ||
    JSON.stringify(discovered) !== JSON.stringify(artifacts)
  )
    throw new Error("C03 governed provenance universe differs");
}

export function lockIdentities(text) {
  const section = text.match(/\npackages:\n([\s\S]*?)\nsnapshots:\n/u)?.[1];
  if (!section) throw new Error("lockfile packages section is missing");
  return Array.from(section.matchAll(/^ {2}(.+):\n {4}resolution:/gmu))
    .map((match) => match[1].replace(/^'|'$/gu, ""))
    .sort(utf8Order);
}

export function lockComponents(text) {
  const identities = lockIdentities(text);
  const section = text.match(/\npackages:\n([\s\S]*?)\nsnapshots:\n/u)?.[1];
  const matches = Array.from(
    section.matchAll(
      /^ {2}(.+):\n {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/]+={0,2})\}$/gmu,
    ),
  );
  if (matches.length !== identities.length)
    throw new Error("lock component strict SRI identity is invalid");
  return matches
    .map((match) => ({
      identity: match[1].replace(/^'|'$/gu, ""),
      integrity: match[2],
    }))
    .sort((left, right) => utf8Order(left.identity, right.identity));
}

function splitIdentity(identity) {
  const bare = identity.replace(/\(.*/u, "");
  const index = bare.lastIndexOf("@");
  if (index <= 0) throw new Error("lock dependency identity is malformed");
  return { name: bare.slice(0, index), version: bare.slice(index + 1) };
}

function purl(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

export function licenseFor(name, rules, version) {
  const matches = rules.filter((rule) => {
    if (rule.kind === "exact") return name === rule.value;
    if (rule.kind === "prefix") return name.startsWith(rule.value);
    if (rule.kind === "identity") return `${name}@${version}` === rule.value;
    throw new Error("dependency license rule kind is invalid");
  });
  if (matches.length !== 1)
    throw new Error(`dependency license rule coverage is not exact: ${name}`);
  return matches[0];
}

export function validateLicenseRules(locked, rules, noticeAllowlist = reviewedNoticeAllowlist) {
  if (!Array.isArray(locked) || !Array.isArray(rules))
    throw new Error("dependency license rules are invalid");
  validateNoticeAllowlist(noticeAllowlist);
  const noticeIdentities = new Set(noticeAllowlist.map(({ identity }) => identity));
  const kindRank = (kind) => {
    if (kind === "prefix") return 0;
    if (kind === "exact") return 1;
    if (kind === "identity") return 2;
    throw new Error("dependency license rule kind is invalid");
  };
  const licenses = new Set([
    "0BSD",
    "Apache-2.0",
    "BSD-3-Clause",
    "ISC",
    "MIT",
    "MIT OR Apache-2.0",
  ]);
  let priorKind = -1;
  let priorValue = "";
  const signatures = new Set();
  for (const rule of rules) {
    const rank = kindRank(rule?.kind);
    if (
      !rule ||
      typeof rule !== "object" ||
      JSON.stringify(ownDataKeys(rule).slice().sort(utf8Order)) !==
        JSON.stringify(["kind", "license", "noticeRequired", "value"]) ||
      typeof rule.value !== "string" ||
      rule.value.length === 0 ||
      !licenses.has(rule.license) ||
      typeof rule.noticeRequired !== "boolean" ||
      rank < priorKind ||
      (rank === priorKind && utf8Order(priorValue, rule.value) >= 0) ||
      signatures.has(`${rule.kind}\0${rule.value}`)
    )
      throw new Error("dependency license rules are invalid");
    if (rank !== priorKind) priorValue = "";
    priorKind = rank;
    priorValue = rule.value;
    signatures.add(`${rule.kind}\0${rule.value}`);
  }
  const used = new Set();
  for (const { identity } of locked) {
    const { name, version } = splitIdentity(identity);
    const rule = licenseFor(name, rules, version);
    if (rule.noticeRequired !== noticeIdentities.has(identity.replace(/\(.*/u, "")))
      throw new Error("dependency NOTICE mapping differs");
    used.add(rule);
  }
  if (
    digest(Buffer.from(JSON.stringify(locked))) !==
      "d90d31de1c4c94f186753d7eb2978d92aa1bf6e4d784e33175ea62f41fa20ba5" ||
    used.size !== rules.length ||
    rules.length !== 139 ||
    digest(Buffer.from(JSON.stringify(rules.filter(({ kind }) => kind === "identity")))) !==
      "de806312b5d5ddfdefbe3a41c9266ed2b79ca9e2f0a2aaca65c8117f456d783e"
  )
    throw new Error("reviewed dependency license mapping differs");
}

export function validateNoticeAllowlist(noticeAllowlist) {
  if (JSON.stringify(noticeAllowlist) !== JSON.stringify(reviewedNoticeAllowlist))
    throw new Error("reviewed installed NOTICE allowlist differs");
}

export function validateLicenseDecision(decision) {
  if (JSON.stringify(decision) !== JSON.stringify(reviewedLicenseDecision))
    throw new Error("reviewed dependency license and NOTICE decision differs");
}

function noticeMarker(kind, { identity, sourceFilename }) {
  return Buffer.from(`----- ${kind} INSTALLED NOTICE: ${identity}/${sourceFilename} -----\n`);
}

export function validateNoticeDocument(noticeBytes, noticePolicy) {
  if (
    !Buffer.isBuffer(noticeBytes) ||
    JSON.stringify(
      ownDataKeys(noticePolicy ?? {})
        .slice()
        .sort(utf8Order),
    ) !== JSON.stringify(["allowlist", "decision", "path", "sha256"]) ||
    noticePolicy.path !== "NOTICE" ||
    noticePolicy.sha256 !== "0d3b1e8b737d1de52a88d3a79b872022ee6bf4b1d0381d477725044331f6ccf7" ||
    noticePolicy.decision !== noticeDecision ||
    digest(noticeBytes) !== noticePolicy.sha256 ||
    !noticeBytes.subarray(0, noticeDocumentPrefix.length).equals(noticeDocumentPrefix)
  )
    throw new Error("root NOTICE differs from attribution evidence");
  validateNoticeAllowlist(noticePolicy.allowlist);
  for (const entry of noticePolicy.allowlist) {
    const begin = noticeMarker("BEGIN", entry);
    const end = noticeMarker("END", entry);
    const beginAt = noticeBytes.indexOf(begin);
    const endAt = noticeBytes.indexOf(end);
    if (
      beginAt < noticeDocumentPrefix.length ||
      beginAt !== noticeBytes.lastIndexOf(begin) ||
      endAt <= beginAt + begin.length ||
      endAt !== noticeBytes.lastIndexOf(end)
    )
      throw new Error("root NOTICE delimiter differs from attribution evidence");
    const body = noticeBytes.subarray(beginAt + begin.length, endAt);
    if (
      body.length !== entry.bytes ||
      digest(body) !== entry.sha256 ||
      noticeBytes.indexOf(body) !== noticeBytes.lastIndexOf(body)
    )
      throw new Error("root NOTICE vendor body differs from reviewed installed evidence");
  }
}

function externalDependencies(manifest) {
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (field) =>
      ownDataEntries(readOwnData(manifest, String(field)) ?? {})
        .filter(([, version]) => version !== "workspace:*")
        .map(([name, version]) => `${name}@${version}`),
  );
}

async function canonicalInstalledPackageIndex(root) {
  const virtualStore = path.join(root, ".zc-pnpm-store", "virtual-store");
  const index = new Map();
  for (const virtualEntry of (await readdir(virtualStore)).sort(utf8Order)) {
    const modules = path.join(virtualStore, virtualEntry, "node_modules");
    let names;
    try {
      names = await readdir(modules);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const candidates = [];
    for (const name of names.sort(utf8Order)) {
      if (name.startsWith("@")) {
        for (const scoped of (await readdir(path.join(modules, name))).sort(utf8Order))
          candidates.push(path.join(modules, name, scoped));
      } else {
        candidates.push(path.join(modules, name));
      }
    }
    for (const candidate of candidates) {
      const packageStat = await lstat(candidate);
      if (packageStat.isSymbolicLink()) continue;
      if (!packageStat.isDirectory() || (await realpath(candidate)) !== candidate)
        throw new Error("installed package evidence root is not canonical");
      const manifestPath = path.join(candidate, "package.json");
      let manifestStat;
      try {
        manifestStat = await lstat(manifestPath);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (
        manifestStat.isSymbolicLink() ||
        !manifestStat.isFile() ||
        (await realpath(manifestPath)) !== manifestPath
      )
        throw new Error("installed package manifest is not canonical");
      const manifestBytes = await readFile(manifestPath);
      const manifest = JSON.parse(manifestBytes);
      const identity = `${manifest.name}@${manifest.version}`;
      if (index.has(identity))
        throw new Error(`installed package identity is ambiguous: ${identity}`);
      const { licenseFiles, noticeFiles } = await scanInstalledPackageTextEvidence(
        root,
        candidate,
        identity,
      );
      index.set(identity, {
        root: path.relative(root, candidate).split(path.sep).join("/"),
        manifest,
        manifestPath: path.relative(root, manifestPath).split(path.sep).join("/"),
        manifestBytes,
        licenseFiles,
        noticeFiles,
      });
    }
  }
  return index;
}

export async function scanInstalledPackageTextEvidence(root, candidate, identity) {
  const licenseFiles = [];
  const noticeFiles = [];
  for (const filename of (await readdir(candidate)).sort(utf8Order)) {
    const normalizedFilename = filename.toLowerCase().replace(/[^a-z]/gu, "");
    const evidence = /^(?:licen[sc]e|copying)(?:[.-].*)?$/iu.test(filename)
      ? licenseFiles
      : ["notice", "thirdpartynotice", "copyrightnotice"].some((prefix) =>
            normalizedFilename.startsWith(prefix),
          )
        ? noticeFiles
        : undefined;
    if (!evidence) continue;
    const evidencePath = path.join(candidate, filename);
    const stat = await lstat(evidencePath);
    if (stat.isSymbolicLink() || !stat.isFile() || (await realpath(evidencePath)) !== evidencePath)
      throw new Error(`installed package text evidence is not canonical: ${identity}`);
    const bytes = await readFile(evidencePath);
    evidence.push({
      path: path.relative(root, evidencePath).split(path.sep).join("/"),
      bytes: bytes.length,
      sha256: digest(bytes),
    });
  }
  return { licenseFiles, noticeFiles };
}

export function requireAllowedInstalledNotices(
  noticeFiles,
  identity,
  noticeAllowlist,
  packageRoot,
) {
  validateNoticeAllowlist(noticeAllowlist);
  const bareIdentity = identity.replace(/\(.*/u, "");
  const expected = noticeAllowlist
    .filter((entry) => entry.identity === bareIdentity)
    .map(({ sourceFilename, bytes, sha256 }) => ({
      path: `${packageRoot}/${sourceFilename}`,
      bytes,
      sha256,
    }));
  if (!Array.isArray(noticeFiles) || JSON.stringify(noticeFiles) !== JSON.stringify(expected))
    throw new Error(`installed NOTICE evidence differs from reviewed allowlist: ${bareIdentity}`);
}

export async function collectInstalledLicenseEvidence(
  root,
  policy,
  policyBytes,
  locked,
  evidencePolicy = {
    path: "ci/b03-policy.json",
    bytes: policyBytes.length,
    sha256: digest(policyBytes),
  },
) {
  validateLicenseDecision(policy.licenseDecision);
  validateLicenseRules(locked, policy.licenseRules, policy.notice.allowlist);
  validateNoticeDocument(await readFile(path.join(root, policy.notice.path)), policy.notice);
  const index = await canonicalInstalledPackageIndex(root);
  const records = [];
  for (const { identity } of locked) {
    const bareIdentity = identity.replace(/\(.*/u, "");
    const { name, version } = splitIdentity(identity);
    const rule = licenseFor(name, policy.licenseRules, version);
    const installed = index.get(bareIdentity);
    if (!installed) {
      if (rule.kind === "identity" || rule.noticeRequired)
        throw new Error(`required installed package evidence is missing: ${identity}`);
      records.push({
        lockIdentity: identity,
        package: name,
        version,
        state: "ABSENT_OPTIONAL_PLATFORM_LOCK_METADATA_ONLY",
        manifestEvidence: "UNAVAILABLE_NOT_INSTALLED_ON_THIS_HOST",
        licenseFileEvidence: "UNAVAILABLE_NOT_INSTALLED_ON_THIS_HOST",
        noticeFileEvidence: "UNAVAILABLE_NOT_INSTALLED_ON_THIS_HOST",
        conclusionSource: "LOCK_METADATA_AND_VERSIONED_POLICY_ONLY",
        reviewedConclusion: rule.license,
      });
      continue;
    }
    if (installed.manifest.name !== name || installed.manifest.version !== version)
      throw new Error(`installed manifest identity drift: ${identity}`);
    if (installed.manifest.license !== rule.license)
      throw new Error(`installed manifest license differs from reviewed policy: ${identity}`);
    requireAllowedInstalledNotices(
      installed.noticeFiles,
      identity,
      policy.notice.allowlist,
      installed.root,
    );
    records.push({
      lockIdentity: identity,
      package: name,
      version,
      state:
        installed.licenseFiles.length === 0
          ? "PRESENT_MANIFEST_ONLY_NO_LICENSE_FILE"
          : "PRESENT_MANIFEST_AND_LICENSE_FILES",
      packageRoot: installed.root,
      manifestEvidence: {
        path: installed.manifestPath,
        bytes: installed.manifestBytes.length,
        sha256: digest(installed.manifestBytes),
        declaredLicense: installed.manifest.license,
      },
      licenseFileEvidence: installed.licenseFiles,
      noticeFileEvidence: installed.noticeFiles,
      conclusionSource: "INSTALLED_MANIFEST_LICENSE_FIELD_AND_VERSIONED_POLICY",
      reviewedConclusion: rule.license,
    });
  }
  const present = records.filter(({ state }) => state.startsWith("PRESENT_")).length;
  if (records.length !== 195 || present !== 139 || records.length - present !== 56)
    throw new Error("installed evidence counts differ");
  return deepSort({
    schemaVersion: 1,
    evidenceId: "zintus-continuity-installed-license-evidence@15",
    baselineId: "zintus-continuity-local-trust@65",
    policy: evidencePolicy,
    lockfile: policy.lockfile,
    observed: { locked: records.length, present, absent: records.length - present },
    records,
    limitation:
      "LOCAL_MANIFEST_AND_LICENSE_IDENTITY_EVIDENCE_ONLY_NOT_LEGAL_CLEARANCE_OR_REGISTRY_VERIFICATION",
  });
}

export async function buildSupplyChainArtifacts() {
  const policyBytes = await safeFile("ci/b03-policy.json");
  const policy = JSON.parse(policyBytes);
  validateH02CProvenancePolicy(policy);
  await validateAcceptedR12(policy);
  await validateHistoricalB05Predecessor(policy);
  await validateAcceptedC01R5(policy);
  await validateFailedC01R6(policy);
  await validateFailedC01R7(policy);
  await validateFailedC01R8(policy);
  await validateAcceptedC01R9(policy);
  await validateFailedC02R1(policy);
  await validateAcceptedC02R2(policy);
  await validateFailedC03R1(policy);
  await validateAcceptedC03R2(policy);
  await validateAcceptedC03R3(policy);
  await validateAcceptedC03R4(policy);
  await validateAcceptedC04R1(policy);
  await validateAcceptedC04R2(policy);
  await validateAcceptedC04R3(policy);
  await validateSealedH11bHistory(policy);
  await validateExactPredecessor(policy, sealedH11bR23, "sealed H11B R23 predecessor");
  await validateImmutableC05R10(policy);
  await validateFailedH01R1(policy);
  await validateAcceptedH01R2(policy);
  await validateAcceptedH02CR4(policy);
  await validateFailedH02CR5(policy);
  await validatePredecessorH02CR6(policy);
  await validateBurnedH02CR1(policy);
  await validateCandidateHistory(policy);
  const cleanroomPolicy = JSON.parse(
    (await safeFile("ci/h11b-cleanroom-policy-r52.json")).toString("utf8"),
  );
  validatePredecessorMeanings(policy, cleanroomPolicy);
  const failedPolicyHistory = cleanroomPolicy.identityBinding.failedPolicyHistory;
  const failedPolicyArtifactTypes = new Map(
    failedPolicyHistory.map(({ disposition, path: entryPath }) => {
      const artifactType =
        disposition === "immutable-burned-failed-policy-history"
          ? "burned-failed-prior-task-policy-history"
          : disposition === "immutable-failed-prior-task-policy-history"
            ? "failed-prior-task-policy-history"
            : disposition === "immutable-failed-current-task-policy-history"
              ? "failed-current-task-policy-history"
              : undefined;
      if (!artifactType) throw new Error("failed policy disposition invalid");
      return [entryPath, artifactType];
    }),
  );
  if (failedPolicyArtifactTypes.size !== failedPolicyHistory.length)
    throw new Error("failed policy history paths are not unique");
  const failedPolicyArtifactCounts = new Map();
  for (const artifactType of failedPolicyArtifactTypes.values())
    failedPolicyArtifactCounts.set(
      artifactType,
      (failedPolicyArtifactCounts.get(artifactType) ?? 0) + 1,
    );
  const { discoveredSubjects, quarantinedIdentity, quarantineReadEvidence } =
    await discoverSupplyChainInputs(repositoryRoot, cleanroomPolicy);
  if (
    JSON.stringify(quarantineReadEvidence) !==
    JSON.stringify({
      allowedFullReads: 1,
      completedFullReads: 1,
      remainingFullReads: 0,
      source: "discoverSupplyChainInputsWithDescriptor",
    })
  )
    throw new Error("quarantine single-read evidence differs");
  if (
    policy.provenanceSubjects.filter((relative) => relative === quarantinedIdentity.path).length !==
    1
  )
    throw new Error("quarantine subject invalid");
  validateGovernedUniverse(policy, Array.from(discoveredSubjects));
  requireStrictUtf8Order(policy.workspaceManifests, "workspace manifests");
  const lockBytes = await safeFile(policy.lockfile.path);
  if (lockBytes.length !== policy.lockfile.bytes || digest(lockBytes) !== policy.lockfile.sha256) {
    throw new Error("lockfile differs from reviewed B03 identity");
  }
  const locked = lockComponents(lockBytes.toString("utf8"));
  validateLicenseDecision(policy.licenseDecision);
  validateLicenseRules(locked, policy.licenseRules, policy.notice.allowlist);
  const reviewedEvidence = JSON.parse(
    (await safeFile(policy.installedLicenseEvidence.path)).toString("utf8"),
  );
  if (
    JSON.stringify(ownDataKeys(reviewedEvidence.policy).slice().sort(utf8Order)) !==
      JSON.stringify(["bytes", "path", "sha256"]) ||
    reviewedEvidence.policy.path !== "ci/b03-policy.json" ||
    reviewedEvidence.policy.bytes !== policyBytes.length ||
    reviewedEvidence.policy.sha256 !== digest(policyBytes)
  )
    throw new Error("evidence policy anchor differs");
  const actualEvidence = await collectInstalledLicenseEvidence(
    repositoryRoot,
    policy,
    policyBytes,
    locked,
  );
  if (canonical(reviewedEvidence) !== canonical(actualEvidence))
    throw new Error("evidence baseline differs");
  const evidenceByIdentity = new Map(
    actualEvidence.records.map((record) => [record.lockIdentity, record]),
  );
  const identities = locked.map(({ identity }) => identity);
  const bareIdentities = new Set(identities.map((identity) => identity.replace(/\(.*/u, "")));
  const direct = [];
  const workspaces = [];
  for (const manifestPath of policy.workspaceManifests) {
    const manifest = JSON.parse((await safeFile(manifestPath)).toString("utf8"));
    for (const dependency of externalDependencies(manifest)) direct.push(dependency);
    const dependencies = ownDataEntries(manifest.dependencies ?? {})
      .concat(ownDataEntries(manifest.devDependencies ?? {}))
      .map(([name, version]) =>
        version === "workspace:*" ? `workspace:${name}@0.0.0` : `pkg:${name}@${version}`,
      )
      .sort(utf8Order);
    workspaces.push({
      type: "application",
      name: manifest.name,
      version: manifest.version,
      "bom-ref": `workspace:${manifest.name}@${manifest.version}`,
      properties: [{ name: "zintus-continuity:manifest", value: manifestPath }],
      dependencies,
    });
  }
  workspaces.sort((left, right) => utf8Order(left["bom-ref"], right["bom-ref"]));
  for (const identity of new Set(direct)) {
    if (!bareIdentities.has(identity))
      throw new Error(`manifest dependency is absent from lockfile`);
  }
  const components = locked.map(({ identity, integrity }) => {
    const { name, version } = splitIdentity(identity);
    const rule = licenseFor(name, policy.licenseRules, version);
    const evidence = evidenceByIdentity.get(identity);
    if (!evidence) throw new Error(`license evidence is missing: ${identity}`);
    const noticeEvidencePresent =
      Array.isArray(evidence.noticeFileEvidence) && evidence.noticeFileEvidence.length > 0;
    if (rule.noticeRequired !== noticeEvidencePresent)
      throw new Error("SBOM NOTICE evidence decision differs");
    return {
      type: "library",
      name,
      version,
      licenses: [{ expression: rule.license }],
      hashes: [
        {
          alg: "SHA-512",
          content: Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex"),
        },
      ],
      externalReferences: [{ type: "distribution", url: policy.registrySource }],
      properties: [
        { name: "zintus-continuity:lock-identity", value: identity },
        { name: "zintus-continuity:sri", value: integrity },
        { name: "zintus-continuity:license-decision", value: policy.licenseDecision.version },
        { name: "zintus-continuity:local-license-evidence-state", value: evidence.state },
        {
          name: "zintus-continuity:local-license-conclusion-source",
          value: evidence.conclusionSource,
        },
        {
          name: "zintus-continuity:local-manifest-evidence",
          value:
            typeof evidence.manifestEvidence === "string"
              ? evidence.manifestEvidence
              : canonical(evidence.manifestEvidence).trim(),
        },
        {
          name: "zintus-continuity:local-license-file-evidence",
          value:
            typeof evidence.licenseFileEvidence === "string"
              ? evidence.licenseFileEvidence
              : canonical(evidence.licenseFileEvidence).trim(),
        },
        {
          name: "zintus-continuity:notice-required",
          value: rule.noticeRequired ? "yes" : "no",
        },
        {
          name: "zintus-continuity:local-notice-file-evidence",
          value:
            typeof evidence.noticeFileEvidence === "string"
              ? evidence.noticeFileEvidence
              : canonical(evidence.noticeFileEvidence).trim(),
        },
      ],
      "bom-ref": purl(name, version),
    };
  });
  const notice = await safeFile(policy.notice.path);
  validateNoticeDocument(notice, policy.notice);
  const trust = JSON.parse((await safeFile(policy.trustBaselinePath)).toString("utf8"));
  if (
    trust.schemaVersion !== 23 ||
    trust.baselineId !== "zintus-continuity-local-trust@65" ||
    !Array.isArray(trust.trustAnchors) ||
    trust.trustAnchors.length !== 87
  ) {
    throw new Error("trust baseline identity is invalid");
  }
  for (const anchor of trust.trustAnchors) {
    const bytes = await safeFile(anchor.path);
    if (bytes.length !== anchor.bytes || digest(bytes) !== anchor.sha256) {
      throw new Error(`trust anchor differs: ${anchor.path}`);
    }
  }
  const sbom = deepSort({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: { type: "application", name: "zintus-continuity", version: "0.0.0" },
      properties: [
        {
          name: "zintus-continuity:acceptance-label",
          value: acceptedSbomMetadata.acceptanceLabel,
        },
        {
          name: "zintus-continuity:acceptance-state",
          value: acceptedSbomMetadata.acceptanceState,
        },
        { name: "zintus-continuity:vulnerability-status", value: policy.vulnerabilityStatus },
        { name: "zintus-continuity:notice-decision", value: policy.notice.decision },
        {
          name: "zintus-continuity:quarantined-historical-subject-count",
          value: "1",
        },
        {
          name: "zintus-continuity:quarantined-historical-subject-state",
          value: "PUBLIC_EXPORT_BLOCKED_QUARANTINED_TRACKED_HISTORICAL_SUBJECT",
        },
        {
          name: "zintus-continuity:opaque-local-worktree-root-state",
          value: "EXCLUDED_UNVERIFIED_PUBLIC_EXPORT_BLOCKED",
        },
      ],
    },
    components: workspaces
      .map((workspace) => ({
        type: workspace.type,
        name: workspace.name,
        version: workspace.version,
        "bom-ref": workspace["bom-ref"],
        properties: workspace.properties,
      }))
      .concat(components),
    dependencies: workspaces.map((workspace) => ({
      ref: workspace["bom-ref"],
      dependsOn: workspace.dependencies.map((entry) => {
        if (entry.startsWith("workspace:")) return entry;
        const identity = entry.slice(4);
        const { name, version } = splitIdentity(identity);
        return purl(name, version);
      }),
    })),
  });
  if (sbom.components.length !== 206 || sbom.dependencies.length !== 11)
    throw new Error("SBOM exact component or dependency count differs");
  const expectedSbomProperties = [
    {
      name: "zintus-continuity:acceptance-label",
      value: "H11B_FINALIZER_LOCAL_SYNTHETIC_UNSIGNED_PROVENANCE_PENDING_EXTERNAL_REVIEW",
    },
    {
      name: "zintus-continuity:acceptance-state",
      value: "PUBLIC_READY_BLOCKED_PENDING_EXTERNAL_REVIEW",
    },
    {
      name: "zintus-continuity:vulnerability-status",
      value: "UNKNOWN/NOT_EXECUTED_NO_ADVISORY_SNAPSHOT",
    },
    {
      name: "zintus-continuity:notice-decision",
      value: noticeDecision,
    },
    {
      name: "zintus-continuity:quarantined-historical-subject-count",
      value: "1",
    },
    {
      name: "zintus-continuity:quarantined-historical-subject-state",
      value: "PUBLIC_EXPORT_BLOCKED_QUARANTINED_TRACKED_HISTORICAL_SUBJECT",
    },
    {
      name: "zintus-continuity:opaque-local-worktree-root-state",
      value: "EXCLUDED_UNVERIFIED_PUBLIC_EXPORT_BLOCKED",
    },
  ];
  if (JSON.stringify(sbom.metadata.properties) !== JSON.stringify(expectedSbomProperties))
    throw new Error("SBOM quarantine disclosure differs");
  const acceptedHistoryPaths = new Set(
    [
      acceptedC01R5,
      acceptedC01R9,
      acceptedC02R2,
      acceptedC03R2,
      acceptedC03R3,
      acceptedC03R4,
      acceptedC04R1,
      acceptedC04R2,
      acceptedC04R3,
    ].map(({ path: relative }) => relative),
  );
  const artifactEntries = [];
  for (const relative of policy.provenanceSubjects) {
    if (relative === quarantinedIdentity.path) {
      artifactEntries.push({
        repository_relative_path: quarantinedIdentity.path,
        artifact_type: "quarantined-opaque-historical-subject",
        byte_length: quarantinedIdentity.bytes,
        digest: {
          algorithm: "sha256",
          encoding: "lowercase-hex",
          scope: "exact raw file bytes",
          value: quarantinedIdentity.sha256,
        },
        file_mode: quarantinedIdentity.mode,
      });
      continue;
    }
    const bytes =
      relative === policy.sbomPath
        ? Buffer.from(canonical(sbom), "utf8")
        : await safeFile(relative);
    const stat = await lstat(path.join(repositoryRoot, relative));
    artifactEntries.push({
      repository_relative_path: relative,
      artifact_type:
        relative === acceptedR12.path
          ? "accepted-provenance-anchor"
          : relative === acceptedB05Predecessor.path
            ? "historical-provenance-predecessor"
            : relative === immutableC05R10.path
              ? "immutable-prior-predecessor-history"
              : relative === acceptedH02CR4.path
                ? "accepted-provenance-predecessor"
                : relative === acceptedH01R2.path
                  ? "prior-accepted-provenance-predecessor"
                  : sealedH11bHistoryPaths.has(relative)
                    ? "immutable-sealed-local-provenance-history"
                    : relative === sealedH11bR23.path
                      ? "immutable-sealed-local-provenance-predecessor"
                      : failedPolicyArtifactTypes.has(relative)
                        ? failedPolicyArtifactTypes.get(relative)
                        : relative === burnedH02CR1.path
                          ? "immutable-burned-non-provenance-history"
                          : acceptedHistoryPaths.has(relative)
                            ? "immutable-accepted-provenance-history"
                            : relative === failedH02CR2.path ||
                                relative === failedH02CR3.path ||
                                relative === failedH02CR5.path
                              ? "failed-prior-task-candidate-history"
                              : relative === predecessorH02CR6.path
                                ? "immutable-immediate-provenance-predecessor"
                                : relative === failedH11bR30.path ||
                                    relative === failedH11bR32.path ||
                                    relative === failedH11bR34.path
                                  ? "failed-current-task-candidate-history"
                                  : candidateHistory.some(
                                        ({ path: entryPath }) => entryPath === relative,
                                      )
                                    ? "failed-prior-task-candidate-history"
                                    : relative.endsWith(".md")
                                      ? "documentation"
                                      : relative === policy.sbomPath
                                        ? "generated"
                                        : "source",
      file_mode: (stat.mode & 0o777).toString(8).padStart(4, "0"),
      byte_length: bytes.length,
      digest: {
        algorithm: "sha256",
        encoding: "lowercase-hex",
        scope: "exact raw file bytes",
        value: digest(bytes),
      },
      origin_categories: ["generated-untrusted-input", "project-reviewable-source"],
      authoring_method: "agent-generated from declared in-repository inputs",
      source_references: ["ci/b03-policy.json", "docs/governance/ownership-and-provenance.md"],
      generation: {
        generator_identity: "codex-agent",
        generator_version: "UNAUTHENTICATED_LOCAL_SESSION_IDENTITY",
        configuration_identity: policy.policyId,
        declared_input_references: [
          "H02B accepted local synthetic C06 executable checkpoint at aggregate 5963bbe979a31a9d9616f4ded5bbb42348126d749cb15cca0e631e076a0d88d7",
          "reviewable repository files",
        ],
      },
      license: "Apache-2.0 subject to submitting-party authority",
      third_party_attribution: {
        dependency: "none for first-party artifact",
        license_reference: "LICENSE",
        notice_required: "no",
      },
      private_boundary_attestation:
        "Excluded source classes were prohibited; this is an operation boundary, not forensic proof.",
    });
  }
  artifactEntries.sort((left, right) =>
    utf8Order(left.repository_relative_path, right.repository_relative_path),
  );
  validateGovernedUniverse(
    policy,
    Array.from(discoveredSubjects),
    artifactEntries.map(({ repository_relative_path }) => repository_relative_path),
  );
  const aggregate = digest(
    Buffer.concat([
      Buffer.from("zintus-continuity-provenance-batch-v1\0", "utf8"),
      Buffer.from(canonical(artifactEntries), "utf8"),
    ]),
  );
  const provenance = deepSort({
    schemaVersion: 1,
    record_id: policy.currentProvenance.recordId,
    recorded_at: policy.currentProvenance.recordedAt,
    task_id: policy.currentProvenance.taskId,
    operational_actor: { role: "worker", public_id: policy.currentProvenance.actor },
    submitting_party: { public_id: "unknown", license_authority_basis: "unknown" },
    artifacts: artifactEntries,
    batch_integrity: {
      manifest_schema_version: "a01-provenance-artifact-list@1",
      manifest_order: "lexicographic by exact UTF-8 repository-relative path bytes",
      manifest_digest_algorithm: "sha256",
      manifest_digest_encoding: "lowercase-hex",
      aggregate_domain: "zintus-continuity-provenance-batch-v1",
      aggregate_digest: aggregate,
    },
    review_chain_evidence: ["Terra", "Security", "Lean", "Chief"].map((role) => ({
      task_id: policy.currentProvenance.taskId,
      reviewed_record_id: policy.currentProvenance.recordId,
      reviewed_batch_aggregate: aggregate,
      verdict: "pending",
      reviewer_role: role,
      reviewer_public_id: "pending",
      reviewed_at: "pending",
      binding_state: "DETACHED_SLOT_NOT_EXECUTED",
    })),
    predicate: {
      predicate_type: policy.currentProvenance.predicateType,
      unsigned: true,
      self_digest: "PROHIBITED_ENVELOPE_EXCLUDED_FROM_SUBJECT_SET",
      external_exact_review_binding: "REQUIRED",
      acceptance_label: policy.acceptanceLabel,
      acceptance_state: policy.acceptanceState,
      policy_identity: { path: "ci/b03-policy.json", sha256: digest(policyBytes) },
      host_tool_identity: trust.hostToolIdentity,
      host_tool_identity_meaning: "IDENTITY_EVIDENCE_ONLY",
      vulnerability_status: policy.vulnerabilityStatus,
      recovery_incidents: [
        "H01_R2_REMAINS_EXACT_PRIOR_ACCEPTED_PROVENANCE_HISTORY",
        "H02C_R1_IS_IMMUTABLE_BURNED_ZERO_BYTE_NON_PROVENANCE_HISTORY",
        "H02C_R2_IS_IMMUTABLE_FAILED_REVIEW_PREDECESSOR",
        "H02C_R3_IS_IMMUTABLE_FAILED_REGRESSION_PREDECESSOR",
        "H02C_R4_REMAINS_THE_EXACT_ACCEPTED_PREDECESSOR",
        "H02C_R5_REMAINS_IMMUTABLE_FAILED_REVIEW_HISTORY",
        "H02C_R6_IS_THE_EXACT_IMMUTABLE_LOCAL_UNSIGNED_IMMEDIATE_PREDECESSOR",
      ],
      source_baseline: h01SourceBaseline,
    },
    limitations: policy.limitations.concat(
      "RECORDED_AT_IS_DETERMINISTIC_DECLARED_VALUE_NOT_AUTHENTICATED_TIMESTAMP",
      "NO_RETROACTIVE_A00_TO_B02_PROVENANCE_COMPLETENESS_CLAIM",
    ),
    candidate_history: candidateHistory.map((entry) => ({
      record_id: entry.recordId,
      path: entry.path,
      byte_length: entry.bytes,
      file_mode: entry.mode,
      raw_sha256: entry.sha256,
      batch_aggregate: entry.aggregate,
    })),
    supersession: {
      sealed_local_predecessor: {
        record_id: sealedH11bR23.recordId,
        path: sealedH11bR23.path,
        byte_length: sealedH11bR23.bytes,
        file_mode: sealedH11bR23.mode,
        raw_sha256: sealedH11bR23.sha256,
        batch_aggregate: sealedH11bR23.aggregate,
        disposition: "IMMUTABLE_SEALED_LOCAL_PROVENANCE_PREDECESSOR",
      },
      immediate_predecessor: {
        record_id: predecessorH02CR6.recordId,
        path: predecessorH02CR6.path,
        byte_length: predecessorH02CR6.bytes,
        file_mode: predecessorH02CR6.mode,
        raw_sha256: predecessorH02CR6.sha256,
        batch_aggregate: predecessorH02CR6.aggregate,
        disposition: "IMMUTABLE_LOCAL_UNSIGNED_IMMEDIATE_PREDECESSOR",
      },
      accepted_predecessor: {
        record_id: acceptedH02CR4.recordId,
        path: acceptedH02CR4.path,
        byte_length: acceptedH02CR4.bytes,
        file_mode: acceptedH02CR4.mode,
        raw_sha256: acceptedH02CR4.sha256,
        batch_aggregate: acceptedH02CR4.aggregate,
      },
      prior_accepted_predecessor: {
        record_id: acceptedH01R2.recordId,
        path: acceptedH01R2.path,
        byte_length: acceptedH01R2.bytes,
        file_mode: acceptedH01R2.mode,
        raw_sha256: acceptedH01R2.sha256,
        batch_aggregate: acceptedH01R2.aggregate,
      },
      historical_predecessor: {
        record_id: acceptedB05Predecessor.recordId,
        path: acceptedB05Predecessor.path,
        byte_length: acceptedB05Predecessor.bytes,
        file_mode: acceptedB05Predecessor.mode,
        raw_sha256: acceptedB05Predecessor.sha256,
        batch_aggregate: acceptedB05Predecessor.aggregate,
      },
      accepted_root: {
        record_id: acceptedR12.recordId,
        path: acceptedR12.path,
        byte_length: acceptedR12.bytes,
        file_mode: acceptedR12.mode,
        raw_sha256: acceptedR12.sha256,
        batch_aggregate: acceptedR12.aggregate,
      },
      burned_current_task_history: {
        path: burnedH02CR1.path,
        byte_length: burnedH02CR1.bytes,
        file_mode: burnedH02CR1.mode,
        raw_sha256: burnedH02CR1.sha256,
        disposition: "IMMUTABLE_BURNED_NON_PROVENANCE_HISTORY",
      },
      no_rewrite_reason:
        "H11B R1 failed; R2 uncommitted; R3-R10, R12-R17, R19, and R20 sealed locally; R11 failed exact local review; R18 burned after partial finalizer without provenance; R1-R28 policies immutable; H02C R6 predecessor; R21 create-once pending external review.",
    },
  });
  const expectedQuarantinedArtifact = deepSort({
    repository_relative_path: quarantinedIdentity.path,
    artifact_type: "quarantined-opaque-historical-subject",
    byte_length: quarantinedIdentity.bytes,
    digest: {
      algorithm: "sha256",
      encoding: "lowercase-hex",
      scope: "exact raw file bytes",
      value: quarantinedIdentity.sha256,
    },
    file_mode: quarantinedIdentity.mode,
  });
  const quarantinedArtifacts = provenance.artifacts.filter(
    ({ repository_relative_path }) => repository_relative_path === quarantinedIdentity.path,
  );
  if (
    provenance.artifacts.some(
      ({ repository_relative_path }) => repository_relative_path === policy.provenancePath,
    ) ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "failed-current-task-candidate-history",
    ).length !== 3 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === failedC03R1.path &&
        artifact_type === "failed-prior-task-candidate-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === failedC05R9.path &&
        artifact_type === "failed-prior-task-candidate-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === failedH01R1.path &&
        artifact_type === "failed-prior-task-candidate-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "failed-prior-task-candidate-history",
    ).length !== 24 ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "failed-current-task-policy-history",
    ).length !== (failedPolicyArtifactCounts.get("failed-current-task-policy-history") ?? 0) ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "burned-failed-prior-task-policy-history",
    ).length !== (failedPolicyArtifactCounts.get("burned-failed-prior-task-policy-history") ?? 0) ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "failed-prior-task-policy-history",
    ).length !== (failedPolicyArtifactCounts.get("failed-prior-task-policy-history") ?? 0) ||
    Array.from(failedPolicyArtifactTypes).some(
      ([entryPath, artifactType]) =>
        provenance.artifacts.filter(
          ({ repository_relative_path, artifact_type }) =>
            repository_relative_path === entryPath && artifact_type === artifactType,
        ).length !== 1,
    ) ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === failedH02CR2.path &&
        artifact_type === "failed-prior-task-candidate-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === failedH02CR3.path &&
        artifact_type === "failed-prior-task-candidate-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === failedH02CR5.path &&
        artifact_type === "failed-prior-task-candidate-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "immutable-sealed-local-provenance-history",
    ).length !== 16 ||
    provenance.artifacts.filter(
      ({ artifact_type }) => artifact_type === "immutable-sealed-local-provenance-predecessor",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === predecessorH02CR6.path &&
        artifact_type === "immutable-immediate-provenance-predecessor",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === acceptedR12.path &&
        artifact_type === "accepted-provenance-anchor",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === acceptedB05Predecessor.path &&
        artifact_type === "historical-provenance-predecessor",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === immutableC05R10.path &&
        artifact_type === "immutable-prior-predecessor-history",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === acceptedH02CR4.path &&
        artifact_type === "accepted-provenance-predecessor",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === acceptedH01R2.path &&
        artifact_type === "prior-accepted-provenance-predecessor",
    ).length !== 1 ||
    provenance.artifacts.filter(
      ({ repository_relative_path, artifact_type }) =>
        repository_relative_path === burnedH02CR1.path &&
        artifact_type === "immutable-burned-non-provenance-history",
    ).length !== 1 ||
    quarantinedArtifacts.length !== 1 ||
    JSON.stringify(quarantinedArtifacts[0]) !== JSON.stringify(expectedQuarantinedArtifact)
  )
    throw new Error("H02C provenance graph contains a self-subject or invalid anchor");
  return { policy, sbom, provenance, quarantineReadEvidence };
}

export function parseSupplyChainOperation(argv) {
  const operation = argv[2];
  if (
    argv.length !== 3 ||
    !["--create-provenance", "--h02c-ci-inventory", "--verify", "--verify-sbom"].includes(operation)
  ) {
    throw new Error(
      "exactly one of --verify, --verify-sbom, --create-provenance, or --h02c-ci-inventory is accepted",
    );
  }
  return operation;
}

async function main() {
  const operation = parseSupplyChainOperation(process.argv);
  if (operation === "--h02c-ci-inventory") {
    await h02cCiInventory();
    return;
  }
  if (operation === "--create-provenance") await requireCreateTargetAvailable(h11bPath);
  let artifacts;
  try {
    artifacts = await buildSupplyChainArtifacts();
  } catch (error) {
    if (operation === "--create-provenance") throw createFailure("AUTH");
    throw error;
  }
  const { policy, sbom, provenance } = artifacts;
  const renderedSbom = canonical(sbom);
  const renderedProvenance = canonical(provenance);
  const createTargets = createOutputAllowlist();
  if (operation === "--create-provenance")
    await createSite("AUTH", async () => {
      validatePolicyRelativePath(policy.provenancePath);
      validatePolicyRelativePath(policy.sbomPath);
    });
  else {
    validatePolicyRelativePath(policy.provenancePath);
    validatePolicyRelativePath(policy.sbomPath);
  }
  if (
    !createTargets.has(policy.provenancePath) ||
    createTargets.has(policy.sbomPath) ||
    createTargets.size !== 1 ||
    JSON.stringify(sbomOutputAllowlist) !==
      JSON.stringify([
        "ci/generated/sbom.cdx.json",
        "ci/installed-license-evidence.json",
        "ci/tool-payload-inventory.json",
        "ci/trust-baseline.json",
      ]) ||
    createTargets.has(immutableC05R10.path) ||
    createTargets.has(failedH01R1.path)
  )
    throw operation === "--create-provenance"
      ? createFailure("AUTH")
      : new Error("generated targets are outside disjoint exact H11B allowlists");
  if (operation === "--create-provenance") {
    if (
      (await createSite("AUTH", () => safeFile(policy.sbomPath))).toString("utf8") !== renderedSbom
    )
      throw createFailure("AUTH");
    await requireCreateTargetAvailable(policy.provenancePath);
    await createProvenanceOnce(policy.provenancePath, renderedProvenance, createTargets);
  } else if (operation === "--verify-sbom") {
    if ((await safeFile(policy.sbomPath)).toString("utf8") !== renderedSbom) {
      throw new Error(`${policy.sbomPath} is stale`);
    }
  } else {
    for (const [relative, rendered] of [
      [policy.provenancePath, renderedProvenance],
      [policy.sbomPath, renderedSbom],
    ]) {
      if ((await safeFile(relative)).toString("utf8") === rendered) continue;
      throw new Error(`${relative} is stale`);
    }
  }
  process.stdout.write(
    `supply-chain: PASS (${sbom.components.length} SBOM components, 195 locked; ${policy.vulnerabilityStatus})\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    if (process.argv.length === 3 && process.argv[2] === "--create-provenance")
      process.stderr.write(`H11B_CREATE_R4_FAILED:${createCode(error)}`);
    else
      process.stderr.write(
        `supply-chain: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    process.exitCode = 1;
  });
}
