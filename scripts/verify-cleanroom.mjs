import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const capturedGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const capturedObjectValues = Object.values;
const capturedHasOwn = Object.hasOwn;
// Captured native identities constrain post-entry validation; they do not attest pre-entry state.
const nativeEnvironmentPrototype = Object.getPrototypeOf(process.env);
const nativeObjectPrototype = Object.prototype;
const reviewedObjectPrototypeNames = Object.freeze([
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "hasOwnProperty",
  "__lookupGetter__",
  "__lookupSetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "__proto__",
  "toLocaleString",
]);
const policyPath = path.join(repositoryRoot, "ci/h11b-cleanroom-policy-r52.json");
const policySemanticSha256 = "3477fabde775d8e1b6721bb4e95818db4325c850c7dac19735af0642c60e064a";
const quarantinedHistoricalSubject = Object.freeze({
  path: ".c06-e0085-r45-preimage-capture-662b9ffcfe0c01bb0661da805e090bb57928fdb422c7499b310385dd25461981.bin",
  bytes: 617075,
  sha256: "31e3271246b376a825e7ea4e68700fcfbdcaac72e902179589de2cc8a65d23ea",
  mode: "0644",
  nlink: 1,
  kind: "canonical-regular-file-nonsymlink",
  gitIndexMode: "100644",
  gitBlob: "64aa3877a7a138ae2ae27aae9213983c24e8837c",
  firstTrackedCommit: "00d8c0d27127eb6cd7151f8b759b8043a450c95c",
  classification: "quarantined-opaque-historical-subject",
  contentUse: "PROHIBITED_EXCEPT_BOUNDED_IDENTITY_HASH",
  execution: "PROHIBITED",
  import: "PROHIBITED",
  parsing: "PROHIBITED",
  publicExport: "PROHIBITED",
  runtime: "PROHIBITED",
});
const syntheticQuarantineDescriptor = Object.freeze({
  ...quarantinedHistoricalSubject,
  bytes: 29,
  sha256: "03c4bb02d610244774d1e507d13099cc3b24fb40418d12be96102cf6e4e60f66",
  mode: "0600",
});
const limits = Object.freeze({
  maxBytes: 134217728,
  maxDepth: 32,
  maxFiles: 8192,
  maxPathBytes: 512,
  maxReadBytes: 2097152,
});
const knownRules = new Set([
  "AMBIENT_ENV_PROHIBITED",
  "B03_IDENTITY_MISMATCH",
  "BINARY_OR_ARCHIVE_PROHIBITED",
  "CASEFOLD_COLLISION",
  "CLI_OVERRIDE_PROHIBITED",
  "EXECUTABLE_PROHIBITED",
  "GENERATED_MISSING",
  "GENERATED_NAMESPACE_PROHIBITED",
  "GENERATED_UNDOCUMENTED",
  "HARDLINK_PROHIBITED",
  "LEGACY_BOUNDARY_MISSING",
  "LIMIT_BYTES",
  "LIMIT_DEPTH",
  "LIMIT_FILES",
  "LIMIT_PATH_BYTES",
  "LIMIT_READ_BYTES",
  "OPAQUE_NODE_MODULES_UNREGISTERED",
  "PATH_DEVICE_INVALID",
  "PATH_DUPLICATE",
  "PATH_ENCODING_INVALID",
  "PATH_INVALID",
  "PATH_PORTABILITY_INVALID",
  "PATH_TRAILING_INVALID",
  "POLICY_INVALID",
  "PRIVATE_MARKER_CONTEXT",
  "ROOT_NOT_CANONICAL",
  "SAFE_VERIFY_ENV_REQUIRED",
  "SPECIAL_FILE",
  "SYMLINK_PROHIBITED",
  "TOP_LEVEL_PROHIBITED",
  "TOP_LEVEL_REQUIRED",
  "TOP_LEVEL_SHAPE_INVALID",
]);
const archiveExtensions = new Set([
  ".7z",
  ".a",
  ".ar",
  ".bz2",
  ".cpio",
  ".dll",
  ".dylib",
  ".exe",
  ".gz",
  ".jar",
  ".o",
  ".pdf",
  ".rar",
  ".so",
  ".tar",
  ".tgz",
  ".wasm",
  ".xz",
  ".zip",
  ".bin",
]);
const privateMarker = ["synthetic-private", "boundary-marker:v1"].join("-");
const utf8Order = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fail(relative, rule) {
  throw new Error(`${relative || "<root>"}:${rule}`);
}

export function validatePolicy(policy) {
  let encoded;
  try {
    encoded = JSON.stringify(policy);
  } catch {
    fail("<policy>", "POLICY_INVALID");
  }
  if (sha256(encoded) !== policySemanticSha256) fail("<policy>", "POLICY_INVALID");
  return true;
}

export function validatePortablePaths(paths, configuredLimits = limits) {
  if (!Array.isArray(paths)) fail("<paths>", "PATH_INVALID");
  const exact = new Set();
  const folded = new Set();
  const allowedDots = new Set([".env.example", ".gitignore", ".npmrc", ".gitkeep"]);
  const devices = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  for (const relative of paths) {
    if (typeof relative !== "string" || relative.length === 0 || relative.includes("\\"))
      fail(String(relative), "PATH_INVALID");
    if (Buffer.byteLength(relative, "utf8") > configuredLimits.maxPathBytes)
      fail(relative, "LIMIT_PATH_BYTES");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional boundary validation
    if (relative !== relative.normalize("NFC") || /[\u0000-\u001f\u007f]/u.test(relative))
      fail(relative, "PATH_ENCODING_INVALID");
    if (/[^\u0020-\u007e]/u.test(relative) || /[%:\ufffd]/u.test(relative))
      fail(relative, "PATH_PORTABILITY_INVALID");
    if (
      path.posix.isAbsolute(relative) ||
      path.posix.normalize(relative) !== relative ||
      relative.split("/").some((part) => part === "" || part === "." || part === "..")
    )
      fail(relative, "PATH_INVALID");
    const parts = relative.split("/");
    if (parts.length > configuredLimits.maxDepth) fail(relative, "LIMIT_DEPTH");
    for (const part of parts) {
      if (/[. ]$/u.test(part)) fail(relative, "PATH_TRAILING_INVALID");
      if (devices.test(part)) fail(relative, "PATH_DEVICE_INVALID");
      if (part.startsWith(".") && !allowedDots.has(part))
        fail(relative, "PATH_PORTABILITY_INVALID");
    }
    if (exact.has(relative)) fail(relative, "PATH_DUPLICATE");
    const lower = relative.toLowerCase();
    if (folded.has(lower)) fail(relative, "CASEFOLD_COLLISION");
    exact.add(relative);
    folded.add(lower);
  }
  return true;
}

export function validateResourceLimits(observed, configuredLimits = limits) {
  const checks = [
    [observed.files, configuredLimits.maxFiles, "LIMIT_FILES"],
    [observed.bytes, configuredLimits.maxBytes, "LIMIT_BYTES"],
    [observed.readBytes, configuredLimits.maxReadBytes, "LIMIT_READ_BYTES"],
  ];
  for (const [value, maximum, rule] of checks) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) fail("<limits>", rule);
    if (value > maximum) fail("<limits>", rule);
  }
  return true;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function canonicalRoot(root) {
  if (typeof root !== "string" || root !== path.resolve(root)) fail("<root>", "ROOT_NOT_CANONICAL");
  let actual;
  try {
    actual = await realpath(root);
  } catch {
    fail("<root>", "ROOT_NOT_CANONICAL");
  }
  if (actual !== root) fail("<root>", "ROOT_NOT_CANONICAL");
  return actual;
}

function sameStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function guardedRead(root, candidate, relative, maximum) {
  if (!inside(root, candidate)) fail(relative, "PATH_INVALID");
  const listed = await lstat(candidate, { bigint: true });
  if (listed.isSymbolicLink()) fail(relative, "SYMLINK_PROHIBITED");
  if (!listed.isFile()) fail(relative, "SPECIAL_FILE");
  if (listed.nlink !== 1n) fail(relative, "HARDLINK_PROHIBITED");
  if ((listed.mode & 0o111n) !== 0n) fail(relative, "EXECUTABLE_PROHIBITED");
  if (listed.size > BigInt(maximum)) fail(relative, "LIMIT_READ_BYTES");
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!sameStat(listed, before)) fail(relative, "SPECIAL_FILE");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameStat(before, after) || BigInt(bytes.length) !== before.size)
      fail(relative, "SPECIAL_FILE");
    return bytes;
  } finally {
    await handle.close();
  }
}

function requireQuarantinedHistoricalSubjectPolicy(policy) {
  const observed = policy?.quarantinedHistoricalSubject;
  if (
    !observed ||
    JSON.stringify(Object.keys(observed)) !==
      JSON.stringify(Object.keys(quarantinedHistoricalSubject)) ||
    JSON.stringify(observed) !== JSON.stringify(quarantinedHistoricalSubject)
  )
    fail("<policy>", "POLICY_INVALID");
  return observed;
}

async function readQuarantinedHistoricalSubjectIdentityCore(root, policy, descriptor, readBudget) {
  requireQuarantinedHistoricalSubjectPolicy(policy);
  const candidate = path.join(root, descriptor.path);
  if (!inside(root, candidate)) fail(descriptor.path, "PATH_INVALID");
  let listed;
  try {
    listed = await lstat(candidate, { bigint: true });
  } catch {
    fail(descriptor.path, "SPECIAL_FILE");
  }
  if (listed.isSymbolicLink() || !listed.isFile()) fail(descriptor.path, "SPECIAL_FILE");
  if (
    (listed.mode & 0o777n).toString(8).padStart(4, "0") !== descriptor.mode ||
    listed.nlink !== BigInt(descriptor.nlink) ||
    listed.size !== BigInt(descriptor.bytes)
  )
    fail(descriptor.path, "SPECIAL_FILE");
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    fail(descriptor.path, "SPECIAL_FILE");
  }
  if (resolved !== candidate) fail(descriptor.path, "SPECIAL_FILE");
  if (readBudget.remainingFullReads !== 1 || readBudget.completedFullReads !== 0)
    fail(descriptor.path, "POLICY_INVALID");
  readBudget.remainingFullReads = 0;
  let content;
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameStat(listed, before)) fail(descriptor.path, "SPECIAL_FILE");
    content = Buffer.alloc(descriptor.bytes);
    const { bytesRead } = await handle.read(content, 0, descriptor.bytes, 0);
    if (bytesRead !== descriptor.bytes) fail(descriptor.path, "SPECIAL_FILE");
    readBudget.completedFullReads = 1;
    const after = await handle.stat({ bigint: true });
    if (!sameStat(before, after) || sha256(content) !== descriptor.sha256)
      fail(descriptor.path, "SPECIAL_FILE");
    return {
      path: descriptor.path,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      mode: descriptor.mode,
      nlink: descriptor.nlink,
      kind: descriptor.kind,
    };
  } finally {
    content?.fill(0);
    await handle.close();
  }
}

export async function readQuarantinedHistoricalSubjectIdentity(root, policy) {
  validatePolicy(policy);
  const canonical = await canonicalRoot(root);
  const readBudget = { remainingFullReads: 1, completedFullReads: 0 };
  return readQuarantinedHistoricalSubjectIdentityCore(
    canonical,
    policy,
    quarantinedHistoricalSubject,
    readBudget,
  );
}

function startsAt(bytes, signature, offset = 0) {
  if (offset + signature.length > bytes.length) return false;
  return signature.every((byte, index) => bytes.at(offset + index) === byte);
}

function containsSignature(bytes, signature) {
  for (let offset = 0; offset + signature.length <= bytes.length; offset += 1) {
    if (startsAt(bytes, signature, offset)) return true;
  }
  return false;
}

function validTarAt(bytes, offset) {
  if (!startsAt(bytes, [0x75, 0x73, 0x74, 0x61, 0x72], offset + 257)) return false;
  const stored = Buffer.from(bytes.subarray(offset + 148, offset + 154))
    .toString("ascii")
    .trim();
  if (!/^[0-7]{1,6}$/u.test(stored)) return false;
  let sum = 0;
  for (let index = 0; index < 512; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : bytes.at(offset + index);
  }
  return Number.parseInt(stored, 8) === sum;
}

function structurallyArchived(bytes) {
  const anywhere = [
    [0x50, 0x4b, 0x03, 0x04],
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  ];
  const leading = [
    [0x1f, 0x8b, 0x08],
    [0x42, 0x5a, 0x68],
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
    [0x7f, 0x45, 0x4c, 0x46],
    [0xcf, 0xfa, 0xed, 0xfe],
    [0xca, 0xfe, 0xba, 0xbe],
    [0x4d, 0x5a],
    [0x00, 0x61, 0x73, 0x6d],
  ];
  if (
    anywhere.some((signature) => containsSignature(bytes, signature)) ||
    leading.some((signature) => startsAt(bytes, signature))
  )
    return true;
  for (let offset = 0; offset + 512 <= bytes.length; offset += 512) {
    if (validTarAt(bytes, offset)) return true;
  }
  if (
    startsAt(bytes, [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]) &&
    bytes.length >= 68 &&
    startsAt(bytes, [0x60, 0x0a], 66)
  )
    return true;
  if (
    startsAt(bytes, [0x30, 0x37, 0x30, 0x37, 0x30, 0x31]) ||
    startsAt(bytes, [0x30, 0x37, 0x30, 0x37, 0x30, 0x32])
  ) {
    if (
      bytes.length >= 110 &&
      /^[0-9a-f]{104}$/iu.test(Buffer.from(bytes.subarray(6, 110)).toString("ascii"))
    ) {
      const nameSize = Number.parseInt(Buffer.from(bytes.subarray(94, 102)).toString("ascii"), 16);
      if (nameSize > 0 && 110 + nameSize <= bytes.length && bytes.at(109 + nameSize) === 0)
        return true;
    }
  }
  const pdf = Buffer.from(bytes).indexOf("%PDF-");
  return pdf >= 0 && pdf <= 1024 && Buffer.from(bytes).indexOf("%%EOF", pdf + 5) >= 0;
}

function decodeText(bytes, relative) {
  if (structurallyArchived(bytes)) fail(relative, "BINARY_OR_ARCHIVE_PROHIBITED");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(relative, "BINARY_OR_ARCHIVE_PROHIBITED");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional boundary validation
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    fail(relative, "BINARY_OR_ARCHIVE_PROHIBITED");
  return text;
}

const token = (word) => word.split("").join("[._-]*");
const separator = "[\\x20\\t._-]+";
const generated = token("generated");
const by = token("by");
const declarationEnd = `(?:$|[!,:;]|${separator}${by}(?:${separator}|$))`;
const declarationPatterns = [
  new RegExp(`@${generated}(?:$|[^a-z0-9])`, "iu"),
  new RegExp(`^${generated}${declarationEnd}`, "iu"),
  new RegExp(`^${token("code")}${separator}${generated}${declarationEnd}`, "iu"),
  new RegExp(
    `^(?:${token("auto")}|${token("automatic")}|${token("automatically")}|${token("machine")})${separator}${generated}${declarationEnd}`,
    "iu",
  ),
  new RegExp(
    `^${token("this")}${separator}(?:${token("code")}|${token("file")}|${token("source")}${separator}${token("file")})${separator}(?:${token("is")}|${token("was")})${separator}${generated}${declarationEnd}`,
    "iu",
  ),
  new RegExp(
    `^${token("do")}${separator}${token("not")}${separator}(?:${token("edit")}|${token("modify")})${separator}(?:${token("auto")}|${token("machine")})${separator}${generated}(?:$|[^a-z0-9])`,
    "iu",
  ),
];
const partialDeclarations = [
  "codegenerated",
  "codegeneratedby",
  "generated",
  "generatedby",
  "machinegenerated",
  "machinegeneratedby",
  "autogenerated",
  "automaticgenerated",
  "automaticallygenerated",
  "thiscodeisgenerated",
  "thiscodewasgenerated",
  "thisfileisgenerated",
  "thisfilewasgenerated",
  "thissourcefileisgenerated",
  "thissourcefilewasgenerated",
];

function originDeclaration(body, unterminated = false) {
  const cleaned = body
    .split("\n")
    .map((line) => line.replace(/^[\x20\t]*\**[\x20\t]*/u, ""))
    .join(" ")
    .replace(/^[\x20\t!*;#-]*/u, "")
    .replace(/[\x20\t*]+$/u, "")
    .trimEnd();
  if (declarationPatterns.some((pattern) => pattern.test(cleaned))) return true;
  if (!unterminated) return false;
  const compact = cleaned.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return compact.length > 0 && partialDeclarations.some((value) => value.startsWith(compact));
}

function commentBodies(text, relative) {
  const comments = [];
  let tokens = 0;
  const add = (body, unterminated, lines) => {
    tokens += 1;
    if (tokens > 4096 || lines > 256 || /^\*{65}/u.test(body))
      fail(relative, "GENERATED_UNDOCUMENTED");
    comments.push({ body, unterminated });
  };
  const block =
    /(?:^|(?:\*\/|-->))[\x20\t]*(\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|<!--[\s\S]*?(?:-->|(?![\s\S])))/gmu;
  for (const match of text.matchAll(block)) {
    const comment = match[1];
    const html = comment.startsWith("<!--");
    const closed = comment.endsWith(html ? "-->" : "*/");
    const start = html ? 4 : 2;
    const end = closed ? (html ? -3 : -2) : undefined;
    add(comment.slice(start, end), !closed, comment.split("\n").length);
  }
  const adjacentBlock = /(?:\*\/|-->)[\x20\t]*(\/\*|<!--)/gu;
  for (const match of text.matchAll(adjacentBlock)) {
    const marker = match[1];
    const startAt = match.index + match[0].lastIndexOf(marker);
    const close = marker === "<!--" ? "-->" : "*/";
    const closeAt = text.indexOf(close, startAt + marker.length);
    const endAt = closeAt < 0 ? text.length : closeAt;
    const body = text.slice(startAt + marker.length, endAt);
    add(body, closeAt < 0, body.split("\n").length);
  }
  const groups = [];
  let current;
  for (const line of text.split("\n")) {
    const match = /^[\x20\t]*(\/\/|#|;|--)(.*)$/u.exec(line);
    if (!match) {
      current = undefined;
      continue;
    }
    tokens += 1;
    if (tokens > 4096) fail(relative, "GENERATED_UNDOCUMENTED");
    if (current?.marker === match[1]) {
      current.body += ` ${match[2]}`;
      current.lines += 1;
      if (current.lines > 256) fail(relative, "GENERATED_UNDOCUMENTED");
    } else {
      current = { body: match[2], lines: 1, marker: match[1] };
      groups.push(current);
    }
    comments.push({ body: match[2], unterminated: false });
  }
  for (const group of groups) comments.push({ body: group.body, unterminated: false });
  const remainder = /(?:\*\/|-->)[\x20\t]*(\/\/|#|;|--)([^\n]*)/gu;
  for (const match of text.matchAll(remainder)) add(match[2], false, 1);
  return comments;
}

function generatedNamespace(relative, persistent, ephemeral) {
  if (
    persistent.has(relative) ||
    Array.from(persistent).some((item) => item.startsWith(`${relative}/`)) ||
    ephemeral.some((root) => relative === root || relative.startsWith(`${root}/`))
  )
    return false;
  const denied = new Set([
    "auto-gen",
    "auto-generated",
    "build-artifacts",
    "build-output",
    "code-generated",
    "code-generation",
    "codegen",
    "dist",
    "dist-output",
    "distfiles",
    "gen",
    "generated",
    "generated-code",
    "generated-files",
    "generated-sources",
    "out",
  ]);
  return relative.split("/").some((part) => denied.has(part.toLowerCase().replace(/[._]/gu, "-")));
}

async function bindB03(root, policy) {
  const hasLegacyOutputs =
    !policy.ephemeralOutputs?.b03Policy ||
    !policy.ephemeralOutputs?.bytes ||
    !policy.ephemeralOutputs?.sha256;
  const relative = hasLegacyOutputs ? "ci/b03-policy.json" : policy.ephemeralOutputs.b03Policy;
  const bytes = await guardedRead(root, path.join(root, relative), relative, limits.maxReadBytes);
  let b03;
  try {
    b03 = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(relative, "B03_IDENTITY_MISMATCH");
  }
  if (!hasLegacyOutputs) {
    if (
      bytes.length !== policy.ephemeralOutputs.bytes ||
      sha256(bytes) !== policy.ephemeralOutputs.sha256
    )
      fail(relative, "B03_IDENTITY_MISMATCH");
    if (
      b03.schemaVersion !== 4 ||
      b03.policyId !== "zintus-continuity-local-ci@65" ||
      JSON.stringify(b03.reproducibility?.outputNamespaces) !==
        JSON.stringify(policy.ephemeralOutputs.outputNamespaces) ||
      JSON.stringify(
        b03.sourceSecurity?.excludedPaths?.filter((value) =>
          policy.ephemeralOutputs.excludedNodeModules.includes(value),
        ),
      ) !== JSON.stringify(policy.ephemeralOutputs.excludedNodeModules)
    )
      fail(relative, "B03_IDENTITY_MISMATCH");
    return b03;
  }
  if (b03.schemaVersion !== 4 || b03.policyId !== "zintus-continuity-local-ci@65")
    fail(relative, "B03_IDENTITY_MISMATCH");
  return b03;
}

async function discoverSupplyChainInputsWithDescriptor(root, policy, quarantineDescriptor) {
  validatePolicy(policy);
  const canonical = await canonicalRoot(root);
  const b03 = await bindB03(canonical, policy);
  const readBudget = { remainingFullReads: 1, completedFullReads: 0 };
  const quarantine = await readQuarantinedHistoricalSubjectIdentityCore(
    canonical,
    policy,
    quarantineDescriptor,
    readBudget,
  );
  const allowedTop = new Set([
    ...policy.governedTopLevel,
    ...policy.opaqueLocalOnlyRoots,
    ...policy.topLevelShape.map((entry) => entry.path),
    quarantine.path,
  ]);
  const topEntries = await readdir(canonical);
  for (const relative of policy.legacyLocalBoundary) {
    try {
      const stat = await lstat(path.join(canonical, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) fail(relative, "LEGACY_BOUNDARY_MISSING");
    } catch {
      fail(relative, "LEGACY_BOUNDARY_MISSING");
    }
  }
  for (const entry of topEntries) if (!allowedTop.has(entry)) fail(entry, "TOP_LEVEL_PROHIBITED");
  for (const entry of policy.topLevelShape) {
    const candidate = path.join(canonical, entry.path);
    let stat;
    try {
      stat = await lstat(candidate);
    } catch (error) {
      if (!entry.required && error?.code === "ENOENT") continue;
      if (policy.legacyLocalBoundary.includes(entry.path))
        fail(entry.path, "LEGACY_BOUNDARY_MISSING");
      fail(entry.path, "TOP_LEVEL_REQUIRED");
    }
    if (stat.isSymbolicLink()) fail(entry.path, "SYMLINK_PROHIBITED");
    const validShape =
      entry.kind === "opaque-directory-or-file"
        ? entry.path === ".git" &&
          (await realpath(candidate)) === candidate &&
          (stat.isDirectory() ||
            (stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o644))
        : entry.kind === "file"
          ? stat.isFile()
          : entry.kind === "directory" && stat.isDirectory();
    if (!validShape) fail(entry.path, "TOP_LEVEL_SHAPE_INVALID");
  }
  const excludedNodeModules =
    policy.ephemeralOutputs?.excludedNodeModules ??
    b03.sourceSecurity?.excludedPaths?.filter(
      (value) => value === "node_modules" || value.endsWith("/node_modules"),
    ) ??
    [];
  const ephemeral =
    policy.ephemeralOutputs?.outputNamespaces ?? policy.reproducibility?.outputNamespaces ?? [];
  const opaque = new Set(policy.opaqueLocalOnlyRoots.concat(excludedNodeModules));
  const currentOutput = policy.identityBinding?.currentProvenancePath || policy.provenancePath;
  const acceptedPredecessor =
    policy.identityBinding?.acceptedPredecessor.path || policy.acceptedProvenancePredecessor.path;
  const includesAcceptedPredecessor = policy.schemaVersion >= 4;
  const persistent = new Set(policy.persistentGenerated.map((entry) => entry.path));
  const absentFailedPredecessors = policy.persistentGenerated.filter(
    ({ disposition, input }) =>
      disposition === "immutable-failed-current-task-candidate" &&
      [
        "H11B-FINALIZER-R40",
        "H11B-FINALIZER-R41",
        "H11B-FINALIZER-R44",
        "H11B-FINALIZER-R46",
        "H11B-FINALIZER-R47",
        "H11B-FINALIZER-R48",
      ].includes(input),
  );
  if (absentFailedPredecessors.length !== 6) fail("<policy>", "POLICY_INVALID");
  const permittedAbsentPersistent = new Set([
    currentOutput,
    ...absentFailedPredecessors.map(({ path: entryPath }) => entryPath),
  ]);
  const discovered = [quarantine.path];
  let files = 1;
  let bytes = quarantine.bytes;
  validateResourceLimits({ files, bytes }, policy.limits);
  const pending = policy.governedTopLevel.slice().sort(utf8Order).reverse();
  while (pending.length > 0) {
    const relative = pending.pop();
    if (
      relative === undefined ||
      opaque.has(relative) ||
      ephemeral.some((item) => relative === item || relative.startsWith(`${item}/`))
    )
      continue;
    const candidate = path.join(canonical, relative);
    if (!inside(canonical, candidate)) fail(relative, "PATH_INVALID");
    const stat = await lstat(candidate, { bigint: true });
    if (stat.isSymbolicLink()) fail(relative, "SYMLINK_PROHIBITED");
    const basename = path.posix.basename(relative);
    if (basename === ".git" || basename === ".gitmodules")
      fail(relative, "PATH_PORTABILITY_INVALID");
    if (stat.isDirectory()) {
      if (relative.endsWith("/node_modules")) fail(relative, "OPAQUE_NODE_MODULES_UNREGISTERED");
      if (generatedNamespace(relative, persistent, ephemeral))
        fail(relative, "GENERATED_NAMESPACE_PROHIBITED");
      const entries = (await readdir(candidate)).sort(utf8Order).reverse();
      for (const entry of entries) pending.push(`${relative}/${entry}`);
      continue;
    }
    if (!stat.isFile()) fail(relative, "SPECIAL_FILE");
    files += 1;
    bytes += Number(stat.size);
    validateResourceLimits({ files, bytes }, policy.limits);
    validatePortablePaths([relative], policy.limits);
    if (archiveExtensions.has(path.extname(relative).toLowerCase()))
      fail(relative, "BINARY_OR_ARCHIVE_PROHIBITED");
    if (generatedNamespace(relative, persistent, ephemeral))
      fail(relative, "GENERATED_NAMESPACE_PROHIBITED");
    const content = await guardedRead(canonical, candidate, relative, policy.limits.maxReadBytes);
    const text = decodeText(content, relative);
    if (text.includes(privateMarker) && !policy.legacyLocalBoundary.includes(relative))
      fail(relative, "PRIVATE_MARKER_CONTEXT");
    const reviewedNotice = relative === b03.notice?.path && sha256(content) === b03.notice?.sha256;
    if (!persistent.has(relative) && !reviewedNotice) {
      for (const comment of commentBodies(text, relative)) {
        if (originDeclaration(comment.body, comment.unterminated))
          fail(relative, "GENERATED_UNDOCUMENTED");
      }
    }
    if (
      !permittedAbsentPersistent.has(relative) &&
      (includesAcceptedPredecessor || relative !== acceptedPredecessor)
    )
      discovered.push(relative);
  }
  validatePortablePaths(
    discovered.filter((relative) => relative !== quarantine.path),
    policy.limits,
  );
  for (const relative of policy.legacyLocalBoundary) {
    if (!discovered.includes(relative)) fail(relative, "LEGACY_BOUNDARY_MISSING");
  }
  for (const relative of persistent) {
    if (
      !permittedAbsentPersistent.has(relative) &&
      (includesAcceptedPredecessor || relative !== acceptedPredecessor) &&
      !discovered.includes(relative)
    )
      fail(relative, "GENERATED_MISSING");
  }
  if (
    canonical === repositoryRoot &&
    JSON.stringify(discovered) !== JSON.stringify(b03.provenanceSubjects)
  )
    fail("ci/b03-policy.json", "B03_IDENTITY_MISMATCH");
  if (readBudget.remainingFullReads !== 0 || readBudget.completedFullReads !== 1)
    fail(quarantineDescriptor.path, "POLICY_INVALID");
  return {
    discoveredSubjects: discovered,
    quarantinedIdentity: quarantine,
    quarantineReadEvidence: {
      allowedFullReads: 1,
      completedFullReads: 1,
      remainingFullReads: 0,
      source: "discoverSupplyChainInputsWithDescriptor",
    },
  };
}

export async function discoverSupplyChainInputs(root, policy) {
  return discoverSupplyChainInputsWithDescriptor(root, policy, quarantinedHistoricalSubject);
}

export async function discoverGovernedFiles(root, policy) {
  return (await discoverSupplyChainInputs(root, policy)).discoveredSubjects;
}

function requiredEnvironmentText(descriptor) {
  if (
    !descriptor ||
    !descriptor.enumerable ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string"
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  return descriptor.value;
}

function validateObjectPrototype(prototype) {
  if (
    isProxy(prototype) ||
    JSON.stringify(Object.getOwnPropertyNames(prototype)) !==
      JSON.stringify(reviewedObjectPrototypeNames) ||
    Object.getOwnPropertySymbols(prototype).length !== 0 ||
    Object.values(Object.getOwnPropertyDescriptors(prototype)).some(
      ({ enumerable }) => enumerable,
    ) ||
    Object.getPrototypeOf(prototype) !== null
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
}

function validateNativeEnvironmentPrototype(prototype) {
  if (
    isProxy(prototype) ||
    JSON.stringify(Object.getOwnPropertyNames(prototype)) !== JSON.stringify(["constructor"]) ||
    Object.getOwnPropertySymbols(prototype).length !== 0
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  const nativeDescriptors = Object.values(Object.getOwnPropertyDescriptors(prototype));
  const constructorDescriptor = nativeDescriptors.at(0);
  if (
    nativeDescriptors.length !== 1 ||
    !constructorDescriptor ||
    constructorDescriptor.enumerable ||
    !("value" in constructorDescriptor) ||
    Object.getPrototypeOf(prototype) !== nativeObjectPrototype
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  validateObjectPrototype(nativeObjectPrototype);
}

export function validateSafeVerifyEnvironment(environment, root) {
  if (environment === null || typeof environment !== "object" || isProxy(environment))
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  const prototype = Object.getPrototypeOf(environment);
  if (
    prototype !== null &&
    prototype !== nativeObjectPrototype &&
    prototype !== nativeEnvironmentPrototype
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  if (prototype === nativeObjectPrototype) validateObjectPrototype(prototype);
  if (prototype === nativeEnvironmentPrototype) validateNativeEnvironmentPrototype(prototype);
  const ownKeys = Reflect.ownKeys(environment);
  const ownDescriptors = Object.getOwnPropertyDescriptors(environment);
  const platformEncoding = ownDescriptors.__CF_USER_TEXT_ENCODING;
  if (
    platformEncoding &&
    (!platformEncoding.enumerable ||
      !("value" in platformEncoding) ||
      typeof platformEncoding.value !== "string" ||
      !/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/iu.test(platformEncoding.value))
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  const optionalKeys = new Set(["LANG", "LC_ALL", "PATH", "SystemRoot"]);
  const optionalDescriptors = [
    ownDescriptors.LANG,
    ownDescriptors.LC_ALL,
    ownDescriptors.PATH,
    ownDescriptors.SystemRoot,
  ];
  for (const descriptor of optionalDescriptors) {
    if (
      descriptor &&
      (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string")
    )
      fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  }
  const keys = ownKeys
    .filter((key) => typeof key === "string")
    .filter((key) => key !== "__CF_USER_TEXT_ENCODING" && !optionalKeys.has(key))
    .sort(utf8Order);
  const expectedKeys = [
    "CI",
    "HOME",
    "TEMP",
    "TMP",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "npm_config_cache",
    "npm_config_globalconfig",
    "npm_config_ignore_pnpmfile",
    "npm_config_ignore_scripts",
    "npm_config_store_dir",
    "npm_config_strict_dep_builds",
    "npm_config_userconfig",
    "npm_config_virtual_store_dir",
  ].sort(utf8Order);
  const ciDescriptor = ownDescriptors.CI;
  const homeDescriptor = ownDescriptors.HOME;
  const tempDescriptor = ownDescriptors.TEMP;
  const tmpDescriptor = ownDescriptors.TMP;
  const tmpdirDescriptor = ownDescriptors.TMPDIR;
  const cacheHomeDescriptor = ownDescriptors.XDG_CACHE_HOME;
  const configHomeDescriptor = ownDescriptors.XDG_CONFIG_HOME;
  const dataHomeDescriptor = ownDescriptors.XDG_DATA_HOME;
  const stateHomeDescriptor = ownDescriptors.XDG_STATE_HOME;
  const npmCacheDescriptor = ownDescriptors.npm_config_cache;
  const npmGlobalConfigDescriptor = ownDescriptors.npm_config_globalconfig;
  const npmIgnorePnpmfileDescriptor = ownDescriptors.npm_config_ignore_pnpmfile;
  const npmIgnoreScriptsDescriptor = ownDescriptors.npm_config_ignore_scripts;
  const npmStoreDescriptor = ownDescriptors.npm_config_store_dir;
  const npmStrictBuildsDescriptor = ownDescriptors.npm_config_strict_dep_builds;
  const npmUserConfigDescriptor = ownDescriptors.npm_config_userconfig;
  const npmVirtualStoreDescriptor = ownDescriptors.npm_config_virtual_store_dir;
  const ci = requiredEnvironmentText(ciDescriptor);
  const home = requiredEnvironmentText(homeDescriptor);
  const temp = requiredEnvironmentText(tempDescriptor);
  const tmp = requiredEnvironmentText(tmpDescriptor);
  const tmpdir = requiredEnvironmentText(tmpdirDescriptor);
  const cacheHome = requiredEnvironmentText(cacheHomeDescriptor);
  const configHome = requiredEnvironmentText(configHomeDescriptor);
  const dataHome = requiredEnvironmentText(dataHomeDescriptor);
  const stateHome = requiredEnvironmentText(stateHomeDescriptor);
  const npmCache = requiredEnvironmentText(npmCacheDescriptor);
  const npmGlobalConfig = requiredEnvironmentText(npmGlobalConfigDescriptor);
  const npmIgnorePnpmfile = requiredEnvironmentText(npmIgnorePnpmfileDescriptor);
  const npmIgnoreScripts = requiredEnvironmentText(npmIgnoreScriptsDescriptor);
  const npmStore = requiredEnvironmentText(npmStoreDescriptor);
  const npmStrictBuilds = requiredEnvironmentText(npmStrictBuildsDescriptor);
  const npmUserConfig = requiredEnvironmentText(npmUserConfigDescriptor);
  const npmVirtualStore = requiredEnvironmentText(npmVirtualStoreDescriptor);
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    JSON.stringify(keys) !== JSON.stringify(expectedKeys)
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  const runRoot = typeof home === "string" && home.endsWith("/home") ? home.slice(0, -5) : "";
  const bootstrap = path.join(root, ".zc-bootstrap");
  const store = path.join(root, ".zc-pnpm-store");
  if (!runRoot.startsWith(`${bootstrap}${path.sep}run-`) || !inside(bootstrap, runRoot))
    fail("<environment>", "SAFE_VERIFY_ENV_REQUIRED");
  if (
    ci !== "true" ||
    home !== path.join(runRoot, "home") ||
    temp !== path.join(runRoot, "tmp") ||
    tmp !== path.join(runRoot, "tmp") ||
    tmpdir !== path.join(runRoot, "tmp") ||
    cacheHome !== path.join(store, "cache") ||
    configHome !== path.join(runRoot, "config") ||
    dataHome !== path.join(runRoot, "data") ||
    stateHome !== path.join(store, "state") ||
    npmCache !== path.join(store, "cache") ||
    npmGlobalConfig !== path.join(runRoot, "config", "global.npmrc") ||
    npmIgnorePnpmfile !== "true" ||
    npmIgnoreScripts !== "true" ||
    npmStore !== path.join(store, "store") ||
    npmStrictBuilds !== "false" ||
    npmUserConfig !== path.join(runRoot, "config", "user.npmrc") ||
    npmVirtualStore !== path.join(store, "virtual-store")
  )
    fail("<environment>", "SAFE_VERIFY_ENV_REQUIRED");
  return true;
}

async function verifyCleanroomWithDescriptor(root, policy, profile, descriptor) {
  validatePolicy(policy);
  if (!policy.profiles.includes(profile)) fail("<profile>", "POLICY_INVALID");
  const { discoveredSubjects, quarantineReadEvidence } =
    await discoverSupplyChainInputsWithDescriptor(root, policy, descriptor);
  return {
    files: discoveredSubjects.length,
    outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    profile,
    publicBlocks: [
      "LEGACY_LOCAL_BOUNDARY",
      "LOCAL_UNSIGNED_PROVENANCE",
      "QUARANTINED_TRACKED_HISTORICAL_SUBJECT",
      "OPAQUE_LOCAL_WORKTREE_ROOT_UNVERIFIED",
    ],
    publicReady: "PUBLIC_READY_BLOCKED",
    quarantineReadEvidence,
  };
}

export async function verifyCleanroom(root, policy, profile = "local-development") {
  const { quarantineReadEvidence: _readEvidence, ...result } = await verifyCleanroomWithDescriptor(
    root,
    policy,
    profile,
    quarantinedHistoricalSubject,
  );
  return result;
}

export async function verifyCleanroomSyntheticFixture(root, policy, profile) {
  if (path.resolve(root) === repositoryRoot) fail("<root>", "ROOT_NOT_CANONICAL");
  return verifyCleanroomWithDescriptor(root, policy, profile, syntheticQuarantineDescriptor);
}

export function formatCleanroomDiagnostic(error) {
  const match = error instanceof Error ? /:([A-Z][A-Z0-9_]*)$/u.exec(error.message) : undefined;
  const rule = match && knownRules.has(match[1]) ? match[1] : "INTERNAL_FAILURE";
  return `cleanroom-error: <redacted>:${rule}\n`;
}

function buildCliEnvironmentSnapshot(environment, execArgv, root) {
  if (
    environment === null ||
    typeof environment !== "object" ||
    isProxy(environment) ||
    !Array.isArray(execArgv) ||
    execArgv.length !== 0
  )
    fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  const defineProperty = Object.defineProperty;
  const ownKeys = Reflect.ownKeys(environment);
  const descriptorMap = capturedGetOwnPropertyDescriptors(environment);
  const descriptorValues = capturedObjectValues(descriptorMap);
  if (descriptorValues.length !== ownKeys.length) fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  for (const descriptor of descriptorValues) {
    if (
      descriptor === null ||
      typeof descriptor !== "object" ||
      isProxy(descriptor) ||
      Object.getPrototypeOf(descriptor) !== nativeObjectPrototype ||
      !descriptor.enumerable ||
      !capturedHasOwn(descriptor, "value") ||
      typeof descriptor.value !== "string" ||
      capturedHasOwn(descriptor, "get") ||
      capturedHasOwn(descriptor, "set")
    )
      fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  }
  const prohibitedKeys = new Set([
    "ACCESS_TOKEN",
    "API_KEY",
    "AUTH_TOKEN",
    "BEARER_TOKEN",
    "CI_JOB_JWT",
    "CI_JOB_TOKEN",
    "CLIENT_SECRET",
    "DATABASE_URL",
    "GITHUB_TOKEN",
    "GITLAB_TOKEN",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_REPL_EXTERNAL_MODULE",
    "NPM_TOKEN",
    "PASSWORD",
    "SECRET",
    "TOKEN",
  ]);
  const prohibitedPrefixes = [
    "ANTHROPIC_",
    "AWS_",
    "AZURE_",
    "BEDROCK_",
    "DYLD_",
    "GCP_",
    "GOOGLE_",
    "OPENAI_",
  ];
  const freshDataDescriptor = (value) => {
    const descriptor = Object.create(null);
    descriptor.configurable = true;
    descriptor.enumerable = true;
    descriptor.value = value;
    descriptor.writable = true;
    return descriptor;
  };
  const snapshot = Object.create(null);
  for (const key of ownKeys) {
    if (typeof key !== "string") fail("<environment>", "AMBIENT_ENV_PROHIBITED");
    if (
      key === "LD_PRELOAD" ||
      prohibitedKeys.has(key) ||
      prohibitedPrefixes.some((prefix) => key.startsWith(prefix))
    )
      fail("<environment>", "AMBIENT_ENV_PROHIBITED");
  }
  if (capturedHasOwn(descriptorMap, "LANG"))
    defineProperty(snapshot, "LANG", freshDataDescriptor(descriptorMap.LANG.value));
  if (capturedHasOwn(descriptorMap, "LC_ALL"))
    defineProperty(snapshot, "LC_ALL", freshDataDescriptor(descriptorMap.LC_ALL.value));
  if (capturedHasOwn(descriptorMap, "PATH"))
    defineProperty(snapshot, "PATH", freshDataDescriptor(descriptorMap.PATH.value));
  if (capturedHasOwn(descriptorMap, "SystemRoot"))
    defineProperty(snapshot, "SystemRoot", freshDataDescriptor(descriptorMap.SystemRoot.value));
  const runRoot = path.join(root, ".zc-bootstrap", "run-h02c-direct-cleanroom");
  const store = path.join(root, ".zc-pnpm-store");
  defineProperty(snapshot, "CI", freshDataDescriptor("true"));
  defineProperty(snapshot, "HOME", freshDataDescriptor(path.join(runRoot, "home")));
  defineProperty(snapshot, "TEMP", freshDataDescriptor(path.join(runRoot, "tmp")));
  defineProperty(snapshot, "TMP", freshDataDescriptor(path.join(runRoot, "tmp")));
  defineProperty(snapshot, "TMPDIR", freshDataDescriptor(path.join(runRoot, "tmp")));
  defineProperty(snapshot, "XDG_CACHE_HOME", freshDataDescriptor(path.join(store, "cache")));
  defineProperty(snapshot, "XDG_CONFIG_HOME", freshDataDescriptor(path.join(runRoot, "config")));
  defineProperty(snapshot, "XDG_DATA_HOME", freshDataDescriptor(path.join(runRoot, "data")));
  defineProperty(snapshot, "XDG_STATE_HOME", freshDataDescriptor(path.join(store, "state")));
  defineProperty(snapshot, "npm_config_cache", freshDataDescriptor(path.join(store, "cache")));
  defineProperty(
    snapshot,
    "npm_config_globalconfig",
    freshDataDescriptor(path.join(runRoot, "config", "global.npmrc")),
  );
  defineProperty(snapshot, "npm_config_ignore_pnpmfile", freshDataDescriptor("true"));
  defineProperty(snapshot, "npm_config_ignore_scripts", freshDataDescriptor("true"));
  defineProperty(snapshot, "npm_config_store_dir", freshDataDescriptor(path.join(store, "store")));
  defineProperty(snapshot, "npm_config_strict_dep_builds", freshDataDescriptor("false"));
  defineProperty(
    snapshot,
    "npm_config_userconfig",
    freshDataDescriptor(path.join(runRoot, "config", "user.npmrc")),
  );
  defineProperty(
    snapshot,
    "npm_config_virtual_store_dir",
    freshDataDescriptor(path.join(store, "virtual-store")),
  );
  validateSafeVerifyEnvironment(snapshot, root);
  return snapshot;
}

async function main() {
  if (process.argv.length !== 2) fail("<cli>", "CLI_OVERRIDE_PROHIBITED");
  buildCliEnvironmentSnapshot(process.env, process.execArgv, repositoryRoot);
  const bytes = await readFile(policyPath);
  let policy;
  try {
    policy = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("ci/h11b-cleanroom-policy-r52.json", "POLICY_INVALID");
  }
  await verifyCleanroom(repositoryRoot, policy, "local-development");
  process.stdout.write(
    "cleanroom: SAFE_VERIFY_BOUND_LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS; PUBLIC_READY_BLOCKED\n",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(formatCleanroomDiagnostic(error));
    process.exitCode = 1;
  });
}
