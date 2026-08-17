import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const epoch = new Date("2000-01-01T00:00:00.000Z");
const esbuild = path.join(
  root,
  "node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/bin/esbuild",
);
const esbuildNative = path.join(
  root,
  "node_modules/.pnpm/@esbuild+darwin-arm64@0.27.7/node_modules/@esbuild/darwin-arm64/bin/esbuild",
);
const toolHashes = Object.freeze({
  [esbuild]: "1195709c01a2d1b9a3dfa83cb14e2541c027a7c14da4ab13cb94543ed3f1a6c3",
  [esbuildNative]: "b82c6243eb58d520d0bc55cddcf6993dd0f5572f3ab8dc2ba6d77058be043e62",
});
const expectedFiles = Object.freeze(["index.js", "package.json"]);
const maximumBytes = 50 * 1024 * 1024;
const forbiddenText =
  /(?:\/Users\/|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|postgresql:\/\/[^\s:@]+:[^\s@]+@)/u;

function run(command, args, cwd = root, input) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/local/bin", TZ: "UTC" },
    input,
    shell: false,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("pack_command_failed");
  return result.stdout.trim();
}

const gitState = () => ({
  head: run("/usr/bin/git", ["rev-parse", "HEAD"]),
  state: run("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=all"]),
});
const inside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(directory, prefix = "") {
  const output = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error("pack_symlink");
    if (metadata.isDirectory()) output.push(...(await files(absolute, relative)));
    else if (metadata.isFile()) output.push({ absolute, metadata, relative });
    else throw new Error("pack_special_file");
  }
  return output;
}

async function validate(directory) {
  const resolved = await realpath(directory);
  const inventory = await files(resolved);
  if (JSON.stringify(inventory.map(({ relative }) => relative)) !== JSON.stringify(expectedFiles))
    throw new Error("pack_inventory");
  let total = 0;
  for (const file of inventory) {
    const canonical = await realpath(file.absolute);
    if (!inside(canonical, resolved) || file.metadata.nlink !== 1) throw new Error("pack_path");
    total += file.metadata.size;
    if (total > maximumBytes) throw new Error("pack_size");
    const content = await readFile(file.absolute);
    if (forbiddenText.test(content.toString("utf8"))) throw new Error("pack_content");
    await chmod(file.absolute, 0o644);
    await utimes(file.absolute, epoch, epoch);
  }
  return expectedFiles;
}

async function importHandler(directory) {
  const entry = pathToFileURL(path.join(directory, "index.js")).href;
  const expected = JSON.stringify({
    body: '{"outcome":"denied"}',
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
    statusCode: 503,
  });
  const script = `import(${JSON.stringify(entry)}).then(async m=>{if(typeof m.handler!=="function"||JSON.stringify(await m.handler({}))!==${JSON.stringify(expected)})process.exit(2)})`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/local/bin", TZ: "UTC" },
    shell: false,
    stdio: "ignore",
  });
  if (result.status !== 0) throw new Error("pack_import");
}

async function verifyToolchain() {
  for (const [tool, expected] of Object.entries(toolHashes)) {
    if ((await realpath(tool)) !== tool || !(await stat(tool)).isFile())
      throw new Error("pack_toolchain");
    if (hash(await readFile(tool)) !== expected) throw new Error("pack_toolchain");
  }
}

export async function packageHackathonLambda() {
  if (process.argv.length > 2) throw new Error("pack_arguments");
  const before = gitState();
  if (before.state) throw new Error("pack_dirty_repository");
  const work = await mkdtemp(path.join(tmpdir(), "zc-lambda-work-"));
  const output = await mkdtemp(path.join(tmpdir(), "zc-lambda-artifact-"));
  try {
    await verifyToolchain();
    const stage = path.join(work, "stage");
    await mkdir(stage);
    run(esbuild, [
      path.join(root, "apps/api/src/index.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--target=node24",
      `--outfile=${path.join(stage, "index.js")}`,
    ]);
    await writeFile(path.join(stage, "package.json"), '{"type":"module"}\n', { mode: 0o644 });
    const inventory = await validate(stage);
    await importHandler(stage);
    const zipPath = path.join(output, "zintus-continuity-lambda.zip");
    run("/usr/bin/zip", ["-X", "-q", zipPath, "-@"], stage, `${inventory.join("\n")}\n`);
    const extracted = path.join(work, "extracted");
    await mkdir(extracted);
    run("/usr/bin/unzip", ["-qq", zipPath, "-d", extracted]);
    await validate(extracted);
    await importHandler(extracted);
    const after = gitState();
    if (after.state || after.head !== before.head) throw new Error("pack_repository_changed");
    const archive = await readFile(zipPath);
    return Object.freeze({
      path: zipPath,
      sha256: hash(archive),
      sizeBytes: archive.length,
      status: "LOCAL_ARTIFACT_ONLY",
    });
  } catch (error) {
    await rm(output, { force: true, recursive: true });
    throw error;
  } finally {
    await rm(work, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  packageHackathonLambda()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write("lambda-package: FAIL\n");
      process.exitCode = 1;
    });
