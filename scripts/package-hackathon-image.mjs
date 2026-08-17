import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const epoch = new Date("2000-01-01T00:00:00.000Z");
const pluginRoot = path.join(
  userInfo().homedir,
  ".codex/plugins/cache/agent-toolkit-for-aws/aws-core/1.1.0",
);
const asmExecSource = path.join(root, "third_party/asm-exec");
const pluginManifestSource = path.join(pluginRoot, ".codex-plugin/plugin.json");
const esbuild = path.join(
  root,
  "node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/bin/esbuild",
);
const esbuildNative = path.join(
  root,
  "node_modules/.pnpm/@esbuild+darwin-arm64@0.27.7/node_modules/@esbuild/darwin-arm64/bin/esbuild",
);
const pinned = Object.freeze({
  asmExec: Object.freeze({
    bytes: 17_320,
    sha256: "359417b7dda3382a1fa601b4a6c0cb07fc370290b340fd1c6affa739897e1607",
  }),
  esbuild: "1195709c01a2d1b9a3dfa83cb14e2541c027a7c14da4ab13cb94543ed3f1a6c3",
  esbuildNative: "b82c6243eb58d520d0bc55cddcf6993dd0f5572f3ab8dc2ba6d77058be043e62",
  license: "bea5bf29332706dd85d3718418c14fbc70615fd434c2ada4614b31d588d183aa",
  pluginManifest: Object.freeze({
    bytes: 4_217,
    sha256: "71f45fc56da35444e887525b710709e71d4af674fb3d1b16c9a1ba5f1f01fbb5",
  }),
});
const baseImages = Object.freeze({
  node: "public.ecr.aws/lambda/nodejs@sha256:e9e3a91b772514a6a1cac26f89785d89182ae31c97c5ec1a119d8c70c49ac00e",
  python:
    "public.ecr.aws/lambda/python@sha256:ca6a04dd52f69be3fdf09ae9c97701742710154fa326440aea549bf709ce30c9",
});
const expectedFiles = Object.freeze([
  "Dockerfile",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "asm-exec",
  "asm-exec.provenance.json",
  "aws-core-plugin.json",
  "index.js",
  "one-request-worker.cjs",
  "package.json",
]);
const maximumBytes = 50 * 1024 * 1024;
const forbiddenText =
  /(?:\/Users\/|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|postgresql:\/\/[^\s:@]+:[^\s@]+@)/u;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);

function run(command, arguments_, cwd = root, input) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/local/bin", TZ: "UTC" },
    input,
    shell: false,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("image_pack_command_failed");
  return result.stdout;
}

async function fixedFile(source, expected, executable = false) {
  const metadata = await lstat(source);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o777) !== 0o644 ||
    (await realpath(source)) !== source
  )
    throw new Error("image_pack_tool_identity");
  const bytes = await readFile(source);
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)
    throw new Error("image_pack_tool_identity");
  if (executable && (metadata.mode & 0o111) === 0) throw new Error("image_pack_tool_mode");
  return bytes;
}

async function verifyToolchain() {
  for (const [tool, expected] of [
    [esbuild, pinned.esbuild],
    [esbuildNative, pinned.esbuildNative],
  ]) {
    if ((await realpath(tool)) !== tool || !(await stat(tool)).isFile())
      throw new Error("image_pack_toolchain");
    if (hash(await readFile(tool)) !== expected) throw new Error("image_pack_toolchain");
  }
}

function dockerfile() {
  return `# Official AWS Lambda arm64 images pinned from public ECR on 2026-08-13.\nFROM ${baseImages.python} AS python\nFROM ${baseImages.node}\nCOPY --from=python /var/lang/ /opt/python/\nCOPY --from=python /lib64/libssl.so.3 /lib64/libssl.so.3.5.7 /lib64/libcrypto.so.3 /lib64/libcrypto.so.3.5.7 /opt/python/lib/\nENV LD_LIBRARY_PATH=/opt/python/lib\nRUN ["/bin/rm", "-rf", "/var/lang/lib/node_modules/npm", "/opt/python/lib/python3.13/site-packages"]\nRUN ["/opt/python/bin/python3.13", "-I", "-S", "-B", "-c", "import ssl,urllib.request"]\nCOPY --chmod=0555 asm-exec /opt/zc/asm-exec\nCOPY LICENSE THIRD_PARTY_NOTICES.txt asm-exec.provenance.json aws-core-plugin.json /opt/zc/licenses/\nCOPY --chmod=0444 index.js one-request-worker.cjs package.json \${LAMBDA_TASK_ROOT}/\nCMD ["index.handler"]\n`;
}

function provenance() {
  return `${JSON.stringify(
    {
      artifact: "asm-exec",
      artifactBytes: pinned.asmExec.bytes,
      artifactSha256: pinned.asmExec.sha256,
      author: "Amazon Web Services",
      continuityPatch: "direct-secretsmanager-https-fallback",
      license: "Apache-2.0",
      plugin: "aws-core",
      pluginManifestBytes: pinned.pluginManifest.bytes,
      pluginManifestSha256: pinned.pluginManifest.sha256,
      pluginVersion: "1.1.0",
      repository: "https://github.com/aws/agent-toolkit-for-aws",
      sourcePath: "third_party/asm-exec",
      upstreamSourcePath: "skills/aws-secrets-manager/references/asm-exec",
    },
    null,
    2,
  )}\n`;
}

function notices() {
  return `This image includes asm-exec derived from the AWS Agent Toolkit aws-core plugin 1.1.0,\nwith a Continuity-owned direct Secrets Manager HTTPS fallback for Lambda.\nUpstream author: Amazon Web Services\nUpstream source: https://github.com/aws/agent-toolkit-for-aws\nLicense: Apache-2.0 (see LICENSE)\nThe installed plugin package contained no separate NOTICE file.\n`;
}

async function validatePlugin() {
  const manifestBytes = await fixedFile(pluginManifestSource, pinned.pluginManifest);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest.name !== "aws-core" ||
    manifest.version !== "1.1.0" ||
    manifest.author?.name !== "Amazon Web Services" ||
    manifest.repository !== "https://github.com/aws/agent-toolkit-for-aws" ||
    manifest.license !== "Apache-2.0"
  )
    throw new Error("image_pack_plugin_metadata");
}

function verifyDisabledSmaProbe(source) {
  const program =
    'import os,runpy,sys;os.environ["AWS_SECRETS_MANAGER_AGENT_ENDPOINT"]="disabled://not-configured";m=runpy.run_path(sys.argv[1],run_name="asm_exec_test");raise SystemExit(0 if m["_check_sma"]() is False else 1)';
  run("/usr/bin/python3", ["-I", "-S", "-B", "-c", program, source]);
}

function verifyDirectSecretsManagerFallback(source) {
  const program = `import json, runpy, sys
m = runpy.run_path(sys.argv[1], run_name="asm_exec_test")
class Response:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return b'{"SecretString":"synthetic-value"}'
def urlopen(request, timeout):
    assert request.full_url == "https://secretsmanager.us-east-1.amazonaws.com/"
    assert json.loads(request.data) == {"SecretId":"synthetic-secret","VersionStage":"AWSCURRENT"}
    assert request.get_header("X-amz-target") == "secretsmanager.GetSecretValue"
    assert "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target" in request.get_header("Authorization")
    return Response()
g = m["_resolve_via_secretsmanager_api"].__globals__
g["_get_aws_credentials"] = lambda: {"access_key":"synthetic-key","secret_key":"synthetic-secret"}
g["urllib"].request.urlopen = urlopen
g["MCP_ENDPOINT"] = "disabled://not-configured"
assert m["_resolve_via_mcp"]("synthetic-secret", "AWSCURRENT", "us-east-1") is None
assert m["_resolve_via_secretsmanager_api"]("synthetic-secret", "AWSCURRENT", "us-east-1") == "synthetic-value"
`;
  run("/usr/bin/python3", ["-I", "-S", "-B", "-c", program, source]);
}

async function inventory(directory, prefix = "") {
  const output = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error("image_pack_symlink");
    if (metadata.isDirectory()) output.push(...(await inventory(absolute, relative)));
    else if (metadata.isFile()) output.push({ absolute, metadata, relative });
    else throw new Error("image_pack_special_file");
  }
  return output;
}

async function validate(directory) {
  const resolved = await realpath(directory);
  const files = await inventory(resolved);
  if (JSON.stringify(files.map(({ relative }) => relative)) !== JSON.stringify(expectedFiles))
    throw new Error("image_pack_inventory");
  let total = 0;
  const identities = [];
  for (const file of files) {
    const canonical = await realpath(file.absolute);
    if (!inside(canonical, resolved) || file.metadata.nlink !== 1)
      throw new Error("image_pack_path");
    total += file.metadata.size;
    if (total > maximumBytes) throw new Error("image_pack_size");
    const content = await readFile(file.absolute);
    if (forbiddenText.test(content.toString("utf8"))) throw new Error("image_pack_content");
    await chmod(file.absolute, file.relative === "asm-exec" ? 0o555 : 0o444);
    await utimes(file.absolute, epoch, epoch);
    identities.push(`${file.relative}:${content.length}:${hash(content)}`);
  }
  return Object.freeze({
    aggregateSha256: hash(Buffer.from(`${identities.join("\n")}\n`, "utf8")),
    files: Object.freeze(files.map(({ relative }) => relative)),
    sizeBytes: total,
  });
}

async function verifyImageEntry(directory) {
  const entry = pathToFileURL(path.join(directory, "index.js")).href;
  const script = `import(${JSON.stringify(entry)}).then(async m=>{const h={body:undefined,isBase64Encoded:false,rawPath:"/api/health",rawQueryString:"",requestContext:{http:{method:"GET",path:"/api/health"}}};const b={body:"{",cookies:[],isBase64Encoded:false,rawPath:"/api/demo",rawQueryString:"",requestContext:{http:{method:"POST",path:"/api/demo"}}};if(typeof m.handler!=="function"||(await m.handler(h)).statusCode!==200||(await m.handler(b)).statusCode!==400)process.exit(2)})`;
  run(process.execPath, ["--input-type=module", "--eval", script], directory);
}

function verifyWorker(directory) {
  const result = run(
    process.execPath,
    [path.join(directory, "one-request-worker.cjs")],
    directory,
    JSON.stringify({ sessionDigest: "a".repeat(64), step: "latest_receipt" }),
  );
  if (result !== '{"outcome":"unknown"}') throw new Error("image_pack_worker");
}

export async function packageHackathonImageContext() {
  if (process.argv.length > 2) throw new Error("image_pack_arguments");
  const output = await mkdtemp(path.join(tmpdir(), "zc-image-context-"));
  try {
    await verifyToolchain();
    await validatePlugin();
    const asmBytes = await fixedFile(asmExecSource, pinned.asmExec);
    const manifestBytes = await fixedFile(pluginManifestSource, pinned.pluginManifest);
    verifyDisabledSmaProbe(asmExecSource);
    verifyDirectSecretsManagerFallback(asmExecSource);
    run(esbuild, [
      path.join(root, "apps/api/src/image-entry.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--target=node24",
      `--outfile=${path.join(output, "index.js")}`,
    ]);
    run(esbuild, [
      path.join(root, "apps/api/src/image-worker.ts"),
      "--bundle",
      "--format=cjs",
      "--platform=node",
      "--target=node24",
      `--outfile=${path.join(output, "one-request-worker.cjs")}`,
    ]);
    const license = await readFile(path.join(root, "LICENSE"));
    if (hash(license) !== pinned.license) throw new Error("image_pack_license");
    await Promise.all([
      writeFile(path.join(output, "Dockerfile"), dockerfile(), { mode: 0o444 }),
      writeFile(path.join(output, "LICENSE"), license, { mode: 0o444 }),
      writeFile(path.join(output, "THIRD_PARTY_NOTICES.txt"), notices(), { mode: 0o444 }),
      writeFile(path.join(output, "asm-exec"), asmBytes, { mode: 0o555 }),
      writeFile(path.join(output, "asm-exec.provenance.json"), provenance(), { mode: 0o444 }),
      writeFile(path.join(output, "aws-core-plugin.json"), manifestBytes, { mode: 0o444 }),
      writeFile(path.join(output, "package.json"), '{"type":"module"}\n', { mode: 0o444 }),
    ]);
    await verifyImageEntry(output);
    verifyWorker(output);
    const result = await validate(output);
    return Object.freeze({ path: output, status: "LOCAL_IMAGE_CONTEXT_ONLY", ...result });
  } catch (error) {
    await rm(output, { force: true, recursive: true });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  packageHackathonImageContext()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write("image-package: FAIL\n");
      process.exitCode = 1;
    });
