import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { withRepositoryOperationLock } from "./repository-operation-lock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

export const buildOutputRoots = Object.freeze([
  "apps/api/dist",
  "apps/web/dist",
  "apps/web/dist-types",
  "apps/worker/dist",
  "dist-tools",
  "infrastructure/dist",
  "packages/adapters-local/dist",
  "packages/application/dist",
  "packages/contracts/dist",
  "packages/domain/dist",
  "packages/foundation/dist",
  "packages/policy/dist",
]);

export const removedR3OutputPaths = Object.freeze([
  "packages/adapters-local/dist/unexpected-native-promise-sink.d.ts",
  "packages/adapters-local/dist/unexpected-native-promise-sink.d.ts.map",
  "packages/adapters-local/dist/unexpected-native-promise-sink.js",
]);

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function assertRealDirectoryTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error("build output contains a symbolic link");
    if (stat.isDirectory()) await assertRealDirectoryTree(candidate);
  }
}

async function validateParentChain(root, candidate) {
  let current = root;
  const parent = path.dirname(candidate);
  for (const component of path.relative(root, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("build output parent is not a real directory");
    }
  }
}

export async function cleanBuildOutputs() {
  const canonicalRoot = await realpath(repositoryRoot);
  if (canonicalRoot !== repositoryRoot) throw new Error("repository root must be canonical");

  for (const relative of buildOutputRoots) {
    const candidate = path.resolve(canonicalRoot, relative);
    if (!inside(canonicalRoot, candidate)) throw new Error("build output root escapes repository");
    await validateParentChain(canonicalRoot, candidate);
    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("build output root is not a real directory");
      }
      await assertRealDirectoryTree(candidate);
      await rm(candidate, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error("build-output cleaner accepts no arguments");
  await withRepositoryOperationLock(repositoryRoot, cleanBuildOutputs);
  process.stdout.write(`build-output-clean: PASS (${String(buildOutputRoots.length)} roots)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `build-output-clean: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
