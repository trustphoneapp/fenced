import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { utf8Order } from "./verify-trust-preflight.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function exactRelative(relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => part === "" || part === "." || part === "..") ||
    path.normalize(relative) !== relative
  )
    throw new Error("reproducibility namespace is not exact repository-relative");
  return relative;
}

async function validateTool(candidate) {
  const lexical = path.resolve(candidate);
  const tree = path.join(repositoryRoot, ".zc-pnpm-store", "virtual-store");
  const resolved = await realpath(lexical);
  const stat = await lstat(resolved);
  if (!inside(tree, resolved) || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("reproducibility tool is outside reviewed dependency tree");
  }
  return resolved;
}

async function outputManifest(namespaces) {
  const entries = [];
  const walk = async (root, candidate) => {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error("reproducibility output symlink is prohibited");
    if (stat.isDirectory()) {
      for (const entry of await readdir(candidate)) await walk(root, path.join(candidate, entry));
      return;
    }
    if (!stat.isFile()) throw new Error("reproducibility special output is prohibited");
    const bytes = await readFile(candidate);
    entries.push({
      path: path.relative(repositoryRoot, candidate),
      bytes: bytes.length,
      mode: (stat.mode & 0o777).toString(8).padStart(4, "0"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  };
  for (const relative of namespaces) {
    exactRelative(relative);
    const root = path.join(repositoryRoot, relative);
    await walk(root, root);
  }
  return entries.sort((left, right) => utf8Order(left.path, right.path));
}

function runTool(entrypoint, args, cwd, environment, label) {
  const result = spawnSync(process.execPath, [entrypoint].concat(args), {
    cwd,
    env: environment,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed`);
}

async function clean(namespaces) {
  for (const relative of namespaces) {
    exactRelative(relative);
    const candidate = path.resolve(repositoryRoot, relative);
    if (!inside(repositoryRoot, candidate) || candidate === repositoryRoot) {
      throw new Error("reproducibility output namespace escapes");
    }
    await rm(candidate, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.length !== 6 || process.argv[2] !== "--tsc" || process.argv[4] !== "--vite") {
    throw new Error("expected exact --tsc <entrypoint> --vite <entrypoint> arguments");
  }
  const tsc = await validateTool(process.argv[3]);
  const vite = await validateTool(process.argv[5]);
  const policy = JSON.parse(
    await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"),
  );
  const namespaces = policy.reproducibility.outputNamespaces;
  const build = async () => {
    await clean(namespaces);
    runTool(tsc, ["-b", "--pretty", "false", "--force"], repositoryRoot, process.env, "tsc build");
    runTool(vite, ["build"], path.join(repositoryRoot, "apps/web"), process.env, "vite build");
    return outputManifest(namespaces);
  };
  const first = await build();
  const second = await build();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("same-host build outputs differ");
  }
  process.stdout.write(
    `reproducibility: PASS (${first.length} outputs; SAME_HOST_TWO_BUILD_ONLY)\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `reproducibility: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
