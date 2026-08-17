import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateRepositoryOperationLockNamespace } from "./repository-operation-lock.mjs";
import { ownDataEntries, ownDataKeys, readOwnData } from "./safe-own-data.mjs";
import { utf8Order } from "./verify-trust-preflight.mjs";

const canonicalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = new Map([
  [".", "zintus-continuity"],
  ["packages/foundation", "@zintus-continuity/foundation"],
  ["packages/domain", "@zintus-continuity/domain"],
  ["packages/contracts", "@zintus-continuity/contracts"],
  ["packages/policy", "@zintus-continuity/policy"],
  ["packages/application", "@zintus-continuity/application"],
  ["packages/adapters-local", "@zintus-continuity/adapters-local"],
  ["apps/api", "@zintus-continuity/api"],
  ["apps/worker", "@zintus-continuity/worker"],
  ["apps/web", "@zintus-continuity/web"],
  ["infrastructure", "@zintus-continuity/infrastructure"],
]);
const internalNames = new Set(expected.values());
internalNames.delete("zintus-continuity");
const expectedScripts = new Map([
  [
    ".",
    {
      build: "node scripts/safe-build.mjs",
      "clean:build": "node scripts/safe-build.mjs --clean-only",
      "crdb:migrate:apply": "node --env-file=.env scripts/h2-crdb-migrate.mjs --apply",
      "crdb:migrate:resume-0001":
        "node --env-file=.env scripts/h2-crdb-migrate.mjs --resume-from-0001",
      "crdb:migrate:status": "node --env-file=.env scripts/h2-crdb-migrate.mjs --status",
      "crdb:migration:status":
        "node --env-file=.env scripts/h2-crdb-migrate.mjs --migration-status",
      "crdb:smoke": "node --env-file=.env scripts/h2-crdb-smoke.mjs",
      format: "biome format --write .",
      "format:check": "biome format .",
      lint: "biome lint .",
      "lint:deps":
        "node scripts/check-dependencies.mjs && node scripts/verify-source-security.mjs --staged-source",
      test: "vitest run",
      typecheck: "tsc -b --pretty false",
      verify: "node scripts/safe-verify.mjs",
      "verify:cleanroom": "node scripts/verify-cleanroom.mjs && pnpm lint:deps",
      "verify:manifests": "node scripts/check-manifests.mjs",
      "verify:paths": "node scripts/check-tsconfig-paths.mjs",
      "verify:source-security": "node scripts/verify-source-security.mjs",
      "verify:source-security:staged": "node scripts/verify-source-security.mjs --staged-source",
      "verify:supply-chain": "node scripts/verify-supply-chain.mjs --verify",
    },
  ],
  ["apps/web", { build: "vite build" }],
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const lifecycleScripts = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "preprepare",
  "postprepare",
  "prepack",
  "postpack",
  "prepublish",
  "prepublishOnly",
  "publish",
  "postpublish",
]);
const pathFields = ["types", "typings", "main", "module"];
const allowedConditions = new Set([
  "browser",
  "default",
  "development",
  "import",
  "node",
  "production",
  "require",
  "types",
]);
const protocol = /^(?:[a-z][a-z0-9+.-]*:|git@)/iu;
const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const exactNpmrc =
  "ignore-pnpmfile=true\nignore-scripts=true\nsave-exact=true\nstrict-peer-dependencies=true\n";
const reviewedLock = {
  bytes: 66_199,
  lines: 2_047,
  sha256: "8026e907e291eb182e0552438d5bc74cb5bf818ce3cf177f243b0063180735eb",
};
const ignoredScanDirectories = new Set([
  ".git",
  ".zc-bootstrap",
  ".zc-pnpm-store",
  "coverage",
  "dist",
  "dist-tools",
  "dist-types",
  "node_modules",
]);
const forbiddenPnpmConfigName =
  /^(?:\.npmrc|\.?pnpmfile\.(?:c?js|mjs)|pnpm-config\.(?:json|c?js|mjs))$/u;

function isIgnoredScanDirectory(root, candidate, name) {
  return ignoredScanDirectories.has(name) || path.relative(root, candidate) === ".worktrees";
}

async function firstGuard(root, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const stat = await lstat(candidate);
    const relative = path.relative(root, candidate);
    if (stat.isSymbolicLink())
      throw new Error(`repository symbolic link is prohibited: ${relative}`);
    if (stat.isDirectory()) {
      if (!isIgnoredScanDirectory(root, candidate, entry.name)) await firstGuard(root, candidate);
      continue;
    }
    if (!stat.isFile()) throw new Error(`repository special file is prohibited: ${relative}`);
  }
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function safeRoot(requested) {
  const candidate = path.resolve(requested ?? canonicalRoot);
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("root must be a real directory");
  const resolved = await realpath(candidate);
  if (resolved !== (await realpath(canonicalRoot))) {
    const temporary = await realpath(tmpdir());
    if (process.env.ZC_ALLOW_SYNTHETIC_TEST_ROOT !== "1" || !inside(temporary, resolved)) {
      throw new Error("synthetic root is not authorized");
    }
  }
  return resolved;
}

async function safeExistingComponents(root, candidate, label) {
  if (!inside(root, candidate)) throw new Error(`${label} escapes package/repository boundary`);
  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link`);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function readSafeFile(root, filename, label) {
  const candidate = path.join(root, filename);
  await safeExistingComponents(root, candidate, label);
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  return readFile(candidate, "utf8");
}

async function validateWorkspaceDirectories(root) {
  const actual = new Set([".", "infrastructure"]);
  for (const parent of ["packages", "apps"]) {
    const parentPath = path.join(root, parent);
    await safeExistingComponents(root, parentPath, `${parent} workspace directory`);
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      const candidate = path.join(parentPath, entry.name);
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink())
        throw new Error(`workspace entry is a symbolic link: ${parent}/${entry.name}`);
      if (stat.isDirectory()) actual.add(`${parent}/${entry.name}`);
    }
  }
  if (
    JSON.stringify(Array.from(actual).sort(utf8Order)) !==
    JSON.stringify(Array.from(expected.keys()).sort(utf8Order))
  ) {
    throw new Error("workspace directories differ from the exact package allowlist");
  }
}

async function rejectRepositoryPnpmOverrides(root, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) {
      if (forbiddenPnpmConfigName.test(entry.name)) {
        throw new Error(
          `pnpm config symbolic link is prohibited: ${path.relative(root, candidate)}`,
        );
      }
      continue;
    }
    if (stat.isDirectory()) {
      if (!isIgnoredScanDirectory(root, candidate, entry.name)) {
        await rejectRepositoryPnpmOverrides(root, candidate);
      }
      continue;
    }
    if (forbiddenPnpmConfigName.test(entry.name) && path.relative(root, candidate) !== ".npmrc") {
      throw new Error(
        `additional pnpm config/hook is prohibited: ${path.relative(root, candidate)}`,
      );
    }
  }
}

async function validateTarget(packageRoot, value, label, allowPattern = false) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.includes("\\") ||
    protocol.test(value) ||
    value.split("/").includes("..") ||
    (!allowPattern && /[*?[{]/u.test(value))
  ) {
    throw new Error(`${label} must be a package-contained relative target`);
  }
  const stripped = value.startsWith("./") ? value.slice(2) : value;
  const fixed = stripped
    .split("/")
    .filter((part) => !/[*?[{]/u.test(part))
    .join("/");
  await safeExistingComponents(packageRoot, path.resolve(packageRoot, fixed || "."), label);
}

async function validateConditional(packageRoot, value, label, mode) {
  if (typeof value === "string") {
    if (!value.startsWith("./")) throw new Error(`${label} target must begin with ./`);
    await validateTarget(packageRoot, value, label);
    return;
  }
  if (value === null) return;
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`${label} may not be an empty fallback array`);
    for (const [index, entry] of value.entries()) {
      await validateConditional(packageRoot, entry, `${label}[${index}]`, mode);
    }
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} has an unknown conditional shape`);
  const entries = ownDataEntries(value);
  if (entries.length === 0) throw new Error(`${label} may not be empty`);
  const subpathMode = entries.every(([key]) => key.startsWith(mode === "imports" ? "#" : "."));
  const conditionMode = entries.every(([key]) => allowedConditions.has(key));
  if (!subpathMode && !conditionMode) throw new Error(`${label} mixes or uses unknown conditions`);
  for (const [key, entry] of entries) {
    await validateConditional(packageRoot, entry, `${label}.${key}`, mode);
  }
}

async function validateManifest(root, relative, expectedName) {
  const packageRoot = path.resolve(root, relative);
  await safeExistingComponents(root, packageRoot, `package ${relative}`);
  const text = await readSafeFile(packageRoot, "package.json", `package ${relative}`);
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error(`package ${relative} is invalid JSON`);
  }
  if (manifest.name !== expectedName) throw new Error(`package ${relative} has unexpected name`);
  if (manifest.private !== true) throw new Error(`package ${relative} must be private`);
  if (manifest.version !== "0.0.0") throw new Error(`package ${relative} version must be 0.0.0`);
  if (manifest.type !== "module") throw new Error(`package ${relative} type must be module`);

  for (const field of pathFields) {
    if (readOwnData(manifest, String(field)) !== undefined)
      await validateTarget(
        packageRoot,
        readOwnData(manifest, String(field)),
        `${relative}.${field}`,
      );
  }
  for (const field of ["exports", "imports"]) {
    if (readOwnData(manifest, String(field)) !== undefined) {
      await validateConditional(
        packageRoot,
        readOwnData(manifest, String(field)),
        `${relative}.${field}`,
        field,
      );
    }
  }
  const browser = readOwnData(manifest, "browser");
  if (browser !== undefined) {
    if (typeof browser === "string") {
      await validateTarget(packageRoot, browser, `${relative}.browser`);
    } else if (browser && typeof browser === "object" && !Array.isArray(browser)) {
      for (const [key, value] of ownDataEntries(browser)) {
        await validateTarget(packageRoot, key, `${relative}.browser key`);
        if (value !== false) await validateTarget(packageRoot, value, `${relative}.browser.${key}`);
      }
    } else throw new Error(`${relative}.browser has an unknown shape`);
  }
  const bin = readOwnData(manifest, "bin");
  if (bin !== undefined) {
    const values =
      typeof bin === "string" ? [bin] : ownDataEntries(bin ?? {}).map(([, value]) => value);
    for (const value of values) await validateTarget(packageRoot, value, `${relative}.bin`);
  }
  const files = readOwnData(manifest, "files");
  if (files !== undefined) {
    if (!Array.isArray(files)) throw new Error(`${relative}.files must be an array`);
    for (const value of files) {
      await validateTarget(packageRoot, value, `${relative}.files`, true);
    }
  }
  for (const denied of [
    "bundledDependencies",
    "bundleDependencies",
    "config",
    "directories",
    "man",
    "publishConfig",
    "pnpm",
    "typesVersions",
    "workspaces",
  ]) {
    if (readOwnData(manifest, String(denied)) !== undefined)
      throw new Error(`${relative}.${denied} is prohibited`);
  }
  const scripts = manifest.scripts ?? {};
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new Error(`${relative}.scripts must be an object`);
  }
  for (const script of ownDataKeys(scripts)) {
    if (lifecycleScripts.has(script))
      throw new Error(`${relative} lifecycle script ${script} is prohibited`);
  }
  const allowedScripts = expectedScripts.get(relative) ?? {};
  const actualScriptEntries = ownDataEntries(scripts)
    .slice()
    .sort(([left], [right]) => utf8Order(left, right));
  const allowedScriptEntries = ownDataEntries(allowedScripts)
    .slice()
    .sort(([left], [right]) => utf8Order(left, right));
  if (JSON.stringify(actualScriptEntries) !== JSON.stringify(allowedScriptEntries)) {
    throw new Error(`${relative}.scripts differs from the exact command allowlist`);
  }
  for (const field of dependencyFields) {
    const dependencies = readOwnData(manifest, String(field)) ?? {};
    if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error(`${relative}.${field} must be an object`);
    }
    for (const [name, source] of ownDataEntries(dependencies)) {
      if (internalNames.has(name)) {
        if (source !== "workspace:*")
          throw new Error(`${relative}.${field}.${name} must use workspace:*`);
      } else if (typeof source !== "string" || !exactVersion.test(source)) {
        throw new Error(`${relative}.${field}.${name} must use an exact registry version`);
      }
    }
  }
  return manifest;
}

function importerNames(lockText) {
  const section = lockText.match(/\nimporters:\n([\s\S]*?)\npackages:\n/u)?.[1];
  if (!section) throw new Error("lockfile importers section is missing");
  return Array.from(section.matchAll(/^ {2}([^ ].*):(?: \{\})?$/gmu)).map((match) =>
    match[1].replace(/^['"]|['"]$/gu, ""),
  );
}

try {
  const root = await safeRoot(process.argv[2]);
  await validateRepositoryOperationLockNamespace(root);
  await firstGuard(root);
  await rejectRepositoryPnpmOverrides(root);
  await validateWorkspaceDirectories(root);
  const manifests = new Map();
  const names = new Set();
  for (const [relative, name] of expected) {
    const manifest = await validateManifest(root, relative, name);
    if (names.has(manifest.name)) throw new Error(`duplicate package name: ${manifest.name}`);
    names.add(manifest.name);
    manifests.set(relative, manifest);
  }
  const workspace = await readSafeFile(root, "pnpm-workspace.yaml", "workspace policy");
  const expectedWorkspace = "packages:\n  - packages/*\n  - apps/*\n  - infrastructure\n";
  if (workspace !== expectedWorkspace)
    throw new Error("pnpm workspace policy differs from the exact allowlist");
  const npmrc = await readSafeFile(root, ".npmrc", "npm policy");
  if (npmrc !== exactNpmrc) throw new Error(".npmrc bytes differ from the exact reviewed policy");
  if (manifests.get(".").packageManager !== "pnpm@11.9.0") {
    throw new Error("root packageManager must be pnpm@11.9.0");
  }
  const lock = await readSafeFile(root, "pnpm-lock.yaml", "lockfile");
  const lockBytes = Buffer.byteLength(lock);
  const lockLines = lock.match(/\n/gu)?.length ?? 0;
  const lockDigest = createHash("sha256").update(lock).digest("hex");
  if (
    lockBytes !== reviewedLock.bytes ||
    lockLines !== reviewedLock.lines ||
    lockDigest !== reviewedLock.sha256
  ) {
    throw new Error("lockfile bytes differ from the exact current reviewed lock");
  }
  if (!/^lockfileVersion: '9\.0'$/mu.test(lock)) throw new Error("lockfileVersion must be 9.0");
  const actualImporters = importerNames(lock).sort(utf8Order);
  const expectedImporters = Array.from(expected.keys()).sort(utf8Order);
  if (JSON.stringify(actualImporters) !== JSON.stringify(expectedImporters)) {
    throw new Error("lockfile importers differ from the exact workspace allowlist");
  }
  for (const manifest of manifests.values()) {
    for (const field of dependencyFields) {
      for (const [name, version] of ownDataEntries(readOwnData(manifest, String(field)) ?? {})) {
        if (
          !lock.includes(`      ${JSON.stringify(name).replaceAll('"', "'")}:\n`) &&
          !lock.includes(`      ${name}:\n`)
        ) {
          throw new Error(`lockfile is missing dependency ${name}`);
        }
        if (!lock.includes(`        specifier: ${version}\n`)) {
          throw new Error(`lockfile does not pin ${name} to ${version}`);
        }
      }
    }
  }
  process.stdout.write(`manifests: PASS (${manifests.size} exact packages)\n`);
} catch (error) {
  process.stderr.write(
    `manifests: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
