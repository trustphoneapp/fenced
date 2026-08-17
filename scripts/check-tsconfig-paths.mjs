import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertPathChain, establishTrustedRoot, inside } from "./path-safety.mjs";
import { validateRepositoryOperationLockNamespace } from "./repository-operation-lock.mjs";
import { ownDataEntries, readOwnData } from "./safe-own-data.mjs";
import { utf8Order } from "./verify-trust-preflight.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const canonicalRepository = path.resolve(scriptDirectory, "..");
const requestedRoot = process.argv[2];
const ignoredDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "dist-tools",
  "dist-types",
  "node_modules",
]);
const globCharacters = /[*?[{]/u;
const protocolOrRemote = /^(?:[a-z][a-z0-9+.-]*:|git@)/iu;
const moduleName = /^(?:@[^/\\\s]+\/)?[^./\\\s][^\\\s]*$/u;

function fail(message) {
  process.stderr.write(`tsconfig-paths: FAIL: ${message}\n`);
  process.exitCode = 1;
}

function hasParentSegment(value) {
  return value.split("/").includes("..");
}

function validateLexicalPath(value, label, configDirectory, trustedRoot) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.includes("\\") ||
    protocolOrRemote.test(value)
  ) {
    throw new Error(`${label} must be a repository-contained relative path: ${value}`);
  }

  const resolved = path.resolve(configDirectory, value);
  if (!inside(trustedRoot, resolved)) {
    throw new Error(`${label} escapes the trusted repository: ${value}`);
  }
  return resolved;
}

async function assertExistingPath(trustedRoot, candidate, label, expectedKind) {
  let proof;
  try {
    proof = await assertPathChain(trustedRoot, candidate);
  } catch (error) {
    throw new Error(`${label} is not a safe existing path: ${error.message}`);
  }
  if (expectedKind === "file" && !proof.stat.isFile()) {
    throw new Error(`${label} must resolve to a regular file: ${candidate}`);
  }
  if (expectedKind === "directory" && !proof.stat.isDirectory()) {
    throw new Error(`${label} must resolve to a directory: ${candidate}`);
  }
  return proof;
}

async function assertExistingPrefix(trustedRoot, candidate, label) {
  const relative = path.relative(trustedRoot, candidate);
  let current = trustedRoot;
  for (const component of relative === "" ? [] : relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`symbolic link is not allowed: ${current}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw new Error(`${label} has an unsafe path component: ${error.message}`);
    }
  }
}

function fixedGlobPrefix(value) {
  const components = value.split("/");
  const firstGlob = components.findIndex((component) => globCharacters.test(component));
  if (firstGlob === -1) {
    return value;
  }
  const prefix = components.slice(0, firstGlob).join("/");
  return prefix === "" ? "." : prefix;
}

async function validateGlob(value, label, configDirectory, trustedRoot) {
  validateLexicalPath(value, label, configDirectory, trustedRoot);
  const prefix = fixedGlobPrefix(value);
  const resolvedPrefix = validateLexicalPath(
    prefix,
    `${label} prefix`,
    configDirectory,
    trustedRoot,
  );
  await assertExistingPrefix(trustedRoot, resolvedPrefix, label);
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function validateModuleSpecifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.includes("\\") ||
    protocolOrRemote.test(value) ||
    hasParentSegment(value) ||
    !moduleName.test(value)
  ) {
    throw new Error(`${label} must be a package-style module name: ${String(value)}`);
  }
}

export async function discoverConfigs(
  directory,
  trustedRoot,
  configs,
  beforeEntryStat = async () => {},
) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (directory === trustedRoot && entry.name === ".zc-bootstrap") {
      continue;
    }
    await beforeEntryStat(candidate);
    const stat = await lstat(candidate);
    if (directory === trustedRoot && entry.name === ".worktrees") {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("worktrees directory must be a canonical regular directory");
      }
      continue;
    }
    if (stat.isSymbolicLink()) {
      if (/^tsconfig(?:\..+)?\.json$/u.test(entry.name)) {
        throw new Error(`configuration symbolic link is prohibited: ${candidate}`);
      }
      continue;
    }
    if (stat.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await discoverConfigs(candidate, trustedRoot, configs, beforeEntryStat);
      }
      continue;
    }
    if (stat.isFile() && /^tsconfig(?:\..+)?\.json$/u.test(entry.name)) {
      if (!inside(trustedRoot, candidate)) {
        throw new Error(`discovered configuration escapes trusted root: ${candidate}`);
      }
      configs.add(candidate);
    }
  }
}

async function resolveConfigReference(value, label, configDirectory, trustedRoot) {
  let candidate = validateLexicalPath(value, label, configDirectory, trustedRoot);
  let stat;
  try {
    stat = (await assertPathChain(trustedRoot, candidate)).stat;
  } catch (error) {
    if (path.extname(candidate) === "") {
      candidate = `${candidate}.json`;
      await assertExistingPath(trustedRoot, candidate, label, "file");
      return candidate;
    }
    throw new Error(`${label} is unresolved or unsafe: ${error.message}`);
  }
  if (stat.isDirectory()) {
    candidate = path.join(candidate, "tsconfig.json");
    await assertExistingPath(trustedRoot, candidate, label, "file");
    return candidate;
  }
  if (!stat.isFile()) {
    throw new Error(`${label} must resolve to a config file or project directory`);
  }
  return candidate;
}

async function validateCompilerOptions(options, configPath, trustedRoot) {
  if (options === undefined) {
    return;
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error(`${configPath} compilerOptions must be an object`);
  }
  const directory = path.dirname(configPath);

  if (readOwnData(options, "plugins") !== undefined) {
    throw new Error(`${configPath} compilerOptions.plugins is prohibited`);
  }
  if (readOwnData(options, "moduleSuffixes") !== undefined) {
    throw new Error(`${configPath} compilerOptions.moduleSuffixes is prohibited`);
  }

  for (const field of ["baseUrl", "rootDir"]) {
    if (readOwnData(options, String(field)) !== undefined) {
      const candidate = validateLexicalPath(
        readOwnData(options, String(field)),
        `${configPath} compilerOptions.${field}`,
        directory,
        trustedRoot,
      );
      await assertExistingPath(
        trustedRoot,
        candidate,
        `${configPath} compilerOptions.${field}`,
        "directory",
      );
    }
  }

  for (const field of [
    "declarationDir",
    "mapRoot",
    "outDir",
    "outFile",
    "sourceRoot",
    "tsBuildInfoFile",
  ]) {
    if (readOwnData(options, String(field)) !== undefined) {
      const candidate = validateLexicalPath(
        readOwnData(options, String(field)),
        `${configPath} compilerOptions.${field}`,
        directory,
        trustedRoot,
      );
      await assertExistingPrefix(trustedRoot, candidate, `${configPath} compilerOptions.${field}`);
    }
  }

  for (const field of ["rootDirs", "typeRoots"]) {
    if (readOwnData(options, String(field)) !== undefined) {
      for (const [index, value] of requireStringArray(
        readOwnData(options, String(field)),
        `${configPath} compilerOptions.${field}`,
      ).entries()) {
        const label = `${configPath} compilerOptions.${field}[${index}]`;
        const candidate = validateLexicalPath(value, label, directory, trustedRoot);
        await assertExistingPath(trustedRoot, candidate, label, "directory");
      }
    }
  }

  const configuredPaths = readOwnData(options, "paths");
  if (configuredPaths !== undefined) {
    if (
      configuredPaths === null ||
      typeof configuredPaths !== "object" ||
      Array.isArray(configuredPaths)
    ) {
      throw new Error(`${configPath} compilerOptions.paths must be an object`);
    }
    for (const [alias, values] of ownDataEntries(configuredPaths)) {
      validateModuleSpecifier(
        alias.replaceAll("*", "x"),
        `${configPath} compilerOptions.paths key`,
      );
      for (const [index, value] of requireStringArray(
        values,
        `${configPath} compilerOptions.paths.${alias}`,
      ).entries()) {
        await validateGlob(
          value,
          `${configPath} compilerOptions.paths.${alias}[${index}]`,
          directory,
          trustedRoot,
        );
      }
    }
  }

  const configuredTypes = readOwnData(options, "types");
  if (configuredTypes !== undefined) {
    for (const [index, value] of requireStringArray(
      configuredTypes,
      `${configPath} compilerOptions.types`,
    ).entries()) {
      validateModuleSpecifier(value, `${configPath} compilerOptions.types[${index}]`);
    }
  }
  const jsxImportSource = readOwnData(options, "jsxImportSource");
  if (jsxImportSource !== undefined) {
    validateModuleSpecifier(jsxImportSource, `${configPath} compilerOptions.jsxImportSource`);
  }
}

async function validateConfig(configPath, trustedRoot, state) {
  if (state.validated.has(configPath)) {
    return;
  }
  if (state.visiting.has(configPath)) {
    throw new Error(`extends/reference cycle detected at ${configPath}`);
  }
  state.visiting.add(configPath);

  await assertExistingPath(trustedRoot, configPath, `configuration ${configPath}`, "file");
  const text = await readFile(configPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(configPath, text);
  if (parsed.error) {
    throw new Error(
      `${configPath} is not valid TypeScript JSON: ${ts.flattenDiagnosticMessageText(
        parsed.error.messageText,
        "\n",
      )}`,
    );
  }
  const config = parsed.config;
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${configPath} must contain an object`);
  }
  const directory = path.dirname(configPath);

  if (readOwnData(config, "typeAcquisition") !== undefined) {
    throw new Error(`${configPath} typeAcquisition is prohibited`);
  }
  const compileOnSave = readOwnData(config, "compileOnSave");
  if (compileOnSave !== undefined && compileOnSave !== false) {
    throw new Error(`${configPath} compileOnSave must be absent or false`);
  }

  const configuredExtends = readOwnData(config, "extends");
  if (configuredExtends !== undefined) {
    const values = Array.isArray(configuredExtends) ? configuredExtends : [configuredExtends];
    for (const [index, value] of values.entries()) {
      const target = await resolveConfigReference(
        value,
        `${configPath} extends[${index}]`,
        directory,
        trustedRoot,
      );
      await validateConfig(target, trustedRoot, state);
    }
  }

  for (const field of ["include", "exclude"]) {
    if (readOwnData(config, String(field)) !== undefined) {
      for (const [index, value] of requireStringArray(
        readOwnData(config, String(field)),
        `${configPath} ${field}`,
      ).entries()) {
        await validateGlob(value, `${configPath} ${field}[${index}]`, directory, trustedRoot);
      }
    }
  }

  const configuredFiles = readOwnData(config, "files");
  if (configuredFiles !== undefined) {
    for (const [index, value] of requireStringArray(
      configuredFiles,
      `${configPath} files`,
    ).entries()) {
      const label = `${configPath} files[${index}]`;
      if (globCharacters.test(value)) {
        throw new Error(`${label} may not contain a glob`);
      }
      const target = validateLexicalPath(value, label, directory, trustedRoot);
      await assertExistingPath(trustedRoot, target, label, "file");
    }
  }

  const configuredReferences = readOwnData(config, "references");
  if (configuredReferences !== undefined) {
    if (!Array.isArray(configuredReferences)) {
      throw new Error(`${configPath} references must be an array`);
    }
    for (const [index, reference] of configuredReferences.entries()) {
      if (
        reference === null ||
        typeof reference !== "object" ||
        Array.isArray(reference) ||
        typeof reference.path !== "string"
      ) {
        throw new Error(`${configPath} references[${index}] must contain a string path`);
      }
      const target = await resolveConfigReference(
        reference.path,
        `${configPath} references[${index}].path`,
        directory,
        trustedRoot,
      );
      await validateConfig(target, trustedRoot, state);
    }
  }

  await validateCompilerOptions(config.compilerOptions, configPath, trustedRoot);
  state.visiting.delete(configPath);
  state.validated.add(configPath);
}

async function main() {
  const trustedRoot = await establishTrustedRoot(requestedRoot, canonicalRepository);
  await validateRepositoryOperationLockNamespace(trustedRoot);
  const configs = new Set();
  await discoverConfigs(trustedRoot, trustedRoot, configs);
  if (configs.size === 0) {
    throw new Error(`no tsconfig files found under ${trustedRoot}`);
  }
  const state = { validated: new Set(), visiting: new Set() };
  for (const configPath of Array.from(configs).sort(utf8Order)) {
    await validateConfig(configPath, trustedRoot, state);
  }
  process.stdout.write(`tsconfig-paths: PASS (${configs.size} configs)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
