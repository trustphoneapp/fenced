import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const validator = path.join(repositoryRoot, "scripts", "check-manifests.mjs");
const trustPreflight = path.join(repositoryRoot, "scripts", "verify-trust-preflight.mjs");
const reviewedTools = {
  biome: {
    bin: "biome",
    name: "@biomejs/biome",
    packagePath: "@biomejs/biome",
    virtualStorePackage: "@biomejs+biome@2.3.15",
    version: "2.3.15",
  },
  tsc: {
    bin: "tsc",
    name: "typescript",
    packagePath: "typescript",
    virtualStorePackage: "typescript@5.9.3",
    version: "5.9.3",
  },
  vite: {
    bin: "vite",
    name: "vite",
    packagePath: "vite",
    virtualStorePackage: "vite@7.3.2_@types+node@24.13.2",
    version: "7.3.2",
  },
  vitest: {
    bin: "vitest",
    name: "vitest",
    packagePath: "vitest",
    virtualStorePackage: "vitest@4.1.10_@types+node@24.13.2_vite@7.3.2_@types+node@24.13.2_",
    version: "4.1.10",
  },
};

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

export async function validateLocalStage(root, candidate) {
  const canonicalRoot = await realpath(root);
  const scriptsRoot = path.join(canonicalRoot, "scripts");
  const lexical = path.resolve(candidate);
  if (!inside(canonicalRoot, lexical) || !inside(scriptsRoot, lexical)) {
    throw new Error("local stage must remain inside scripts/");
  }
  let current = canonicalRoot;
  for (const component of path.relative(canonicalRoot, lexical).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink())
      throw new Error(`local stage symbolic link is prohibited: ${current}`);
  }
  const stat = await lstat(lexical);
  if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(lexical)) !== lexical) {
    throw new Error("local stage must be a canonical regular file");
  }
  return lexical;
}

export function runFixedProcess(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${options.label} failed with status ${String(result.status)}`);
  }
  return result;
}

export async function resolveReviewedTool(root, specification, safeOwnDataPromise) {
  const { readOwnData } = await safeOwnDataPromise;
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== path.resolve(root)) throw new Error("tool root must be canonical");
  const dependencyTree = path.join(canonicalRoot, ".zc-pnpm-store", "virtual-store");
  const manifestReal = await realpath(
    path.join(
      dependencyTree,
      specification.virtualStorePackage,
      "node_modules",
      specification.packagePath,
      "package.json",
    ),
  );
  if (!inside(dependencyTree, manifestReal)) {
    throw new Error(
      `${specification.name} manifest escapes the reviewed installed dependency tree`,
    );
  }
  const manifestStat = await lstat(manifestReal);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`${specification.name} manifest must be a real file`);
  }
  const manifest = JSON.parse(await readFile(manifestReal, "utf8"));
  if (
    manifest.name !== specification.name ||
    manifest.version !== specification.version ||
    (manifest.bin == null ? undefined : readOwnData(manifest.bin, String(specification.bin))) ===
      undefined
  ) {
    throw new Error(
      `${specification.name} installed manifest differs from the reviewed tool identity`,
    );
  }
  const packageRoot = path.dirname(manifestReal);
  const entrypoint = await realpath(
    path.resolve(packageRoot, readOwnData(manifest.bin, String(specification.bin))),
  );
  if (!inside(packageRoot, entrypoint) || !inside(dependencyTree, entrypoint)) {
    throw new Error(`${specification.name} entrypoint escapes its reviewed package`);
  }
  const entryStat = await lstat(entrypoint);
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
    throw new Error(`${specification.name} entrypoint must be a real file`);
  }
  return entrypoint;
}

async function main() {
  if (process.argv.length !== 2) throw new Error("safe verification accepts no arguments");
  const preflightEnvironment = earliestChildEnvironment(process.env);
  runFixedProcess(process.execPath, [trustPreflight], {
    cwd: repositoryRoot,
    env: preflightEnvironment,
    label: "earliest trust preflight",
  });
  const safeOwnDataPromise = import("./safe-own-data.mjs");
  const [{ verifyTrustPreflight }, { withRepositoryOperationLock }, safeOwnData] =
    await Promise.all([
      import("./verify-trust-preflight.mjs"),
      import("./repository-operation-lock.mjs"),
      safeOwnDataPromise,
    ]);
  await verifyTrustPreflight(repositoryRoot, preflightEnvironment);
  const { ownDataEntries, writeOwnData } = safeOwnData;
  await withRepositoryOperationLock(repositoryRoot, async () => {
    const localStages = {
      cleanroom: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "verify-cleanroom.mjs"),
      ),
      dependencies: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "check-dependencies.mjs"),
      ),
      contracts: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "verify-contracts.mjs"),
      ),
      c03Schema: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "verify-c03-schema.mjs"),
      ),
      installer: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "safe-pnpm-install.mjs"),
      ),
      manifests: await validateLocalStage(repositoryRoot, validator),
      reproducibility: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "verify-reproducibility.mjs"),
      ),
      sourceSecurity: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "verify-source-security.mjs"),
      ),
      supplyChain: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "verify-supply-chain.mjs"),
      ),
      tsconfig: await validateLocalStage(
        repositoryRoot,
        path.join(repositoryRoot, "scripts", "check-tsconfig-paths.mjs"),
      ),
      trust: await validateLocalStage(repositoryRoot, trustPreflight),
    };
    runFixedProcess(process.execPath, [validator], {
      cwd: repositoryRoot,
      env: {},
      label: "pre-verification manifest validation",
    });
    const { prepareAuthorizedPaths, sanitizeEnvironment } = await import("./safe-pnpm-install.mjs");
    const paths = await prepareAuthorizedPaths(repositoryRoot);
    try {
      const environment = await sanitizeEnvironment(process.env, paths, safeOwnDataPromise);
      runFixedProcess(process.execPath, [localStages.cleanroom], {
        cwd: repositoryRoot,
        env: environment,
        label: "clean-room validation",
      });
      const tools = {};
      for (const [name, specification] of ownDataEntries(reviewedTools)) {
        writeOwnData(
          tools,
          name,
          await resolveReviewedTool(repositoryRoot, specification, safeOwnDataPromise),
        );
      }
      const stage = (label, entrypoint, args, cwd = repositoryRoot) =>
        runFixedProcess(process.execPath, [entrypoint].concat(args), {
          cwd,
          env: environment,
          label,
        });
      stage("Biome format", tools.biome, ["format", "."]);
      stage("Biome lint", tools.biome, ["lint", "."]);
      stage("dependency validation", localStages.dependencies, []);
      stage("C03 schema validation", localStages.c03Schema, []);
      stage("TypeScript config validation", localStages.tsconfig, []);
      stage("staged source security validation", localStages.sourceSecurity, ["--staged-source"]);
      stage("supply-chain validation", localStages.supplyChain, ["--verify"]);
      stage("same-host reproducibility", localStages.reproducibility, [
        "--tsc",
        tools.tsc,
        "--vite",
        tools.vite,
      ]);
      stage("contract schema validation", localStages.contracts, []);
      stage("final source and build security validation", localStages.sourceSecurity, []);
      stage("Vitest", tools.vitest, ["run"]);
      runFixedProcess(
        process.execPath,
        ["--test", path.join(repositoryRoot, "tests", "hackathon", "h20-public-export.test.mjs")],
        {
          cwd: repositoryRoot,
          env: environment,
          label: "H20 public export",
        },
      );
      stage("post-test supply-chain validation", localStages.supplyChain, ["--verify"]);
      stage("post-verification manifest validation", localStages.manifests, []);
    } finally {
      await rm(paths.runRoot, { force: true, recursive: true });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `safe-verify: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
