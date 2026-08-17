import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const validator = path.join(repositoryRoot, "scripts", "check-manifests.mjs");

function earliestChildEnvironment(source) {
  const environment = Object.create(null);
  const copyTextDescriptor = (property, descriptor) => {
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return;
    const definition = { enumerable: true, value: descriptor.value };
    switch (property) {
      case "LANG":
        Object.defineProperty(environment, "LANG", definition);
        break;
      case "LC_ALL":
        Object.defineProperty(environment, "LC_ALL", definition);
        break;
      case "PATH":
        Object.defineProperty(environment, "PATH", definition);
        break;
      case "SystemRoot":
        Object.defineProperty(environment, "SystemRoot", definition);
        break;
      default:
        throw new Error("earliest child environment key is invalid");
    }
  };
  copyTextDescriptor("LANG", Object.getOwnPropertyDescriptor(source, "LANG"));
  copyTextDescriptor("LC_ALL", Object.getOwnPropertyDescriptor(source, "LC_ALL"));
  copyTextDescriptor("PATH", Object.getOwnPropertyDescriptor(source, "PATH"));
  copyTextDescriptor("SystemRoot", Object.getOwnPropertyDescriptor(source, "SystemRoot"));
  return environment;
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function checkedDirectory(root, candidate, create = false) {
  if (!inside(root, candidate)) throw new Error(`authorized path escapes repository: ${candidate}`);
  if (create) await mkdir(candidate, { mode: 0o700, recursive: true });
  let current = root;
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || (await realpath(root)) !== root) {
    throw new Error("repository root must be a canonical real directory");
  }
  for (const component of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`authorized path component must be a real directory: ${current}`);
    }
  }
  if ((await realpath(candidate)) !== candidate) {
    throw new Error(`authorized path must remain canonical inside repository: ${candidate}`);
  }
}

async function checkedLocalScript(root, candidate) {
  const scriptsRoot = path.join(root, "scripts");
  if (!inside(scriptsRoot, candidate)) throw new Error("local guard must remain inside scripts/");
  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink())
      throw new Error(`local guard symbolic link is prohibited: ${current}`);
  }
  const stat = await lstat(candidate);
  if (!stat.isFile() || (await realpath(candidate)) !== candidate) {
    throw new Error("local guard must be a canonical regular file");
  }
}

export async function prepareAuthorizedPaths(root) {
  const canonical = path.resolve(root);
  await checkedDirectory(canonical, canonical);
  const bootstrap = path.join(canonical, ".zc-bootstrap");
  const storeRoot = path.join(canonical, ".zc-pnpm-store");
  await checkedDirectory(canonical, bootstrap, true);
  await checkedDirectory(canonical, storeRoot, true);
  const runRoot = await mkdtemp(path.join(bootstrap, "run-"));
  await checkedDirectory(canonical, runRoot);
  const paths = {
    bootstrap,
    cache: path.join(storeRoot, "cache"),
    config: path.join(runRoot, "config"),
    data: path.join(runRoot, "data"),
    globalConfig: path.join(runRoot, "config", "global.npmrc"),
    home: path.join(runRoot, "home"),
    runRoot,
    state: path.join(storeRoot, "state"),
    store: path.join(storeRoot, "store"),
    temporary: path.join(runRoot, "tmp"),
    userConfig: path.join(runRoot, "config", "user.npmrc"),
    virtualStore: path.join(storeRoot, "virtual-store"),
  };
  for (const directory of [
    paths.cache,
    paths.config,
    paths.data,
    paths.home,
    paths.state,
    paths.store,
    paths.temporary,
    paths.virtualStore,
  ]) {
    await checkedDirectory(canonical, directory, true);
  }
  await writeFile(paths.userConfig, "", { mode: 0o600, flag: "wx" });
  await writeFile(paths.globalConfig, "", { mode: 0o600, flag: "wx" });
  return paths;
}

export async function sanitizeEnvironment(source, paths, safeOwnDataPromise) {
  const { mergeOwnDataRecords, readOwnData, writeOwnData } = await safeOwnDataPromise;
  const clean = {};
  for (const key of ["LANG", "LC_ALL", "PATH", "SystemRoot"]) {
    const value = readOwnData(source, String(key));
    if (typeof value === "string") writeOwnData(clean, key, value);
  }
  return mergeOwnDataRecords(clean, {
    CI: "true",
    HOME: paths.home,
    TEMP: paths.temporary,
    TMP: paths.temporary,
    TMPDIR: paths.temporary,
    XDG_CACHE_HOME: paths.cache,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    npm_config_cache: paths.cache,
    npm_config_globalconfig: paths.globalConfig,
    npm_config_ignore_pnpmfile: "true",
    npm_config_ignore_scripts: "true",
    npm_config_store_dir: paths.store,
    npm_config_strict_dep_builds: "false",
    npm_config_userconfig: paths.userConfig,
    npm_config_virtual_store_dir: paths.virtualStore,
  });
}

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with status ${String(result.status)}`);
}

async function main() {
  if (
    process.argv.length > 3 ||
    (process.argv[2] !== undefined && process.argv[2] !== "--offline")
  ) {
    throw new Error("only the optional --offline argument is accepted");
  }
  const trustPreflight = path.join(repositoryRoot, "scripts", "verify-trust-preflight.mjs");
  const preflightEnvironment = earliestChildEnvironment(process.env);
  run(process.execPath, [trustPreflight], preflightEnvironment);
  const safeOwnDataPromise = import("./safe-own-data.mjs");
  const [{ verifyTrustPreflight }, { withRepositoryOperationLock }] = await Promise.all([
    import("./verify-trust-preflight.mjs"),
    import("./repository-operation-lock.mjs"),
    safeOwnDataPromise,
  ]);
  const { pnpm } = await verifyTrustPreflight(repositoryRoot, preflightEnvironment);
  await withRepositoryOperationLock(repositoryRoot, async () => {
    await checkedDirectory(repositoryRoot, repositoryRoot);
    await checkedLocalScript(repositoryRoot, validator);
    run(process.execPath, [validator], {});
    const paths = await prepareAuthorizedPaths(repositoryRoot);
    try {
      const environment = await sanitizeEnvironment(process.env, paths, safeOwnDataPromise);
      const version = spawnSync(pnpm, ["--version"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: environment,
      });
      if (version.status !== 0 || version.stdout.trim() !== "11.9.0") {
        throw new Error("trusted pnpm binary must report exactly 11.9.0");
      }
      const args = [
        "install",
        "--force",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        `--store-dir=${paths.store}`,
        `--virtual-store-dir=${paths.virtualStore}`,
      ];
      if (process.argv[2] === "--offline") args.push("--offline");
      run(pnpm, args, environment);
    } finally {
      await rm(paths.runRoot, { force: true, recursive: true });
    }
    run(process.execPath, [validator], {});
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `safe-pnpm-install: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
