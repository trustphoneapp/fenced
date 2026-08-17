import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  utimes,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = "56fe92662e3cb6c93b42ff96a0babd240f675be56a786fb1e7038381ac487470";
const EXPECTED_BLOBS = "e7a69ec489e3206f0cb0a50b01be099a34e023c6017fd0e895192997aed9381b";
const EXPECTED_AGGREGATE = "93911d8e17dab87907998dbc63c945d3b66978b134779089fee44070d4d5d642";
const ROOTS = ["apps/", "packages/", "database/", "infrastructure/"];
const META = new Set([
  ".gitignore",
  ".npmrc",
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "tsconfig.tools.json",
  "biome.json",
  "architecture-boundaries.json",
  "vitest.config.ts",
]);
const SCRIPTS = new Set([
  "scripts/safe-own-data.d.mts",
  "scripts/safe-own-data.mjs",
  "scripts/synthetic-test-data.d.mts",
  "scripts/synthetic-test-data.mjs",
  "scripts/h2-crdb-apply-0008.mjs",
  "scripts/h2-crdb-apply-0009.mjs",
  "scripts/h2-crdb-live-attest.mjs",
  "scripts/h2-crdb-live-probe.mjs",
  "scripts/h2-crdb-migrate.mjs",
  "scripts/h2-crdb-provider-control.mjs",
  "scripts/h2-crdb-smoke.mjs",
  "scripts/package-hackathon-image.mjs",
  "scripts/package-hackathon-lambda.mjs",
  "scripts/package-migrations.mjs",
  "scripts/verify-c03-schema.mjs",
  "scripts/verify-c04-purpose-keys.mjs",
  "scripts/verify-c04-role-session.mjs",
  "scripts/verify-c05-payload-storage.mjs",
  "scripts/verify-c06-event-ledger.mjs",
  "scripts/verify-h18-managed-mcp.mjs",
  "scripts/verify-h2-agent-memory.mjs",
  "scripts/verify-hackathon-live-schema.mjs",
]);
const DOCS = new Set([
  "docs/hackathon/architecture-diagram.md",
  "docs/hackathon/demo-video-script.md",
  "docs/hackathon/devpost-submission-draft.md",
  "docs/hackathon/submission-checklist.md",
  "docs/hackathon/managed-mcp-queries.json",
]);
const EPOCH = new Date("2000-01-01T00:00:00Z");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const restrictedFixture = "Internal budget ceiling is nine units — restricted synthetic";
const restrictedFiles = new Map([
  ["apps/api/src/index.ts", "7e748a561a237c3e3745407b5c11316ceb6eeaf3cbe854c376841e5f860c5fb9"],
  [
    "apps/api/src/live-runtime.ts",
    "4725abbcdcf49abde8de81fee5d935a2bd2aacb796b2753b61d4f060ae9361e6",
  ],
  [
    "packages/adapters-local/src/h2-demo-dataset.ts",
    "1a40d118390a99720e1c96cbfe3c8f65541c0a56889a83e36b13fa93bff19208",
  ],
  [
    "packages/application/src/hackathon-live.ts",
    "113a204c3715eb3df8ba6c81931efc23dbd784d30013d63ddb56d09352c8598d",
  ],
  [
    "tests/hackathon/h16b-live-runtime.test.mjs",
    "6b42a4901bf139e5375d812691838c15755b4909d3fbe969bc83f307c13b457e",
  ],
  [
    "tests/hackathon/hackathon-live.test.mjs",
    "44f07faee2b761e31d7f256fc82908ee5323d4985a095beaad8fd23655cd2b55",
  ],
  [
    "tests/hackathon/live-api.test.mjs",
    "315ffc741f2e05fabff12441f6b86633e69918cb899128fcf606394825ed699b",
  ],
  [
    "tests/database/h2-crdb-apply-0008.test.mjs",
    "3e4630810f0aa1c80f783c3e45d9ac04eac56c589f4848c0ae0b9cc6e11dfa8e",
  ],
  [
    "tests/database/h2-crdb-apply-0009.test.mjs",
    "bbf4f2e4d1007a5a595406d13c533e68f3f888cf672f307551e32665b9108793",
  ],
  [
    "tests/database/h2-crdb-live-attest.test.mjs",
    "b5f4c2be6aace01299fcf119d69cdb25d1b3cb347e9ab7fea69e7f7d1ec55475",
  ],
  [
    "tests/database/h2-crdb-live-probe.test.mjs",
    "91a1d329749561c0894d78584afa7153d6a46ea7474729caf50f717b30c1f4f7",
  ],
  [
    "tests/database/h2-crdb-provider-control.test.mjs",
    "485fe430ac6715ca6ec914b07550c2691b34042f80b382a645b145e4e8423042",
  ],
  [
    "tests/hackathon/h16c-production-runtime.test.mjs",
    "ea7c3053a047b94aa6b1a1c0f7fea75f04259675bbc12d389ee18efb5a0dbc17",
  ],
  [
    "tests/hackathon/h16d-image-entry.test.mjs",
    "b0a6309265c3eb4c19b89cf465a82755fe9d8d69f34f2379f2c5193d3f9252c1",
  ],
]);
const gitEnvironment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  HOME: "/tmp",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: null,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0 || result.error) throw new Error("public export command failed");
  return result.stdout;
}
const git = (args) => run("/usr/bin/git", args, { env: gitEnvironment });

export function resolvePublicNoticeBytes(headBytes, candidateBytes, noticeOverlay) {
  if (
    !Buffer.isBuffer(headBytes) ||
    !Buffer.isBuffer(candidateBytes) ||
    noticeOverlay !== undefined ||
    !candidateBytes.equals(headBytes)
  )
    throw new Error("public NOTICE differs from source");
  return candidateBytes;
}

export function selectedPaths(paths) {
  return paths
    .filter(
      (path) =>
        (ROOTS.some((root) => path.startsWith(root)) ||
          META.has(path) ||
          DOCS.has(path) ||
          SCRIPTS.has(path) ||
          (/^tests\/(?:contracts|database|foundation|hackathon|identity|local-harness)\//u.test(
            path,
          ) &&
            ![
              "tests/contracts/schema-verifier.test.mjs",
              "tests/hackathon/h01-security-baseline.test.ts",
              "tests/hackathon/h20-public-export.test.mjs",
            ].includes(path))) &&
        !path.endsWith("demo-beat.json"),
    )
    .sort();
}

function portable(path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))
  )
    throw new Error("invalid public path");
}

const overlays = {
  "biome.json": `${JSON.stringify(
    {
      $schema: "https://biomejs.dev/schemas/2.3.15/schema.json",
      files: { includes: ["**", "!**/dist", "!**/coverage", "!**/node_modules"] },
      formatter: { enabled: true, indentStyle: "space", lineWidth: 100 },
      linter: { enabled: true, rules: { recommended: true } },
      javascript: {
        formatter: { quoteStyle: "double", semicolons: "always", trailingCommas: "all" },
      },
    },
    null,
    2,
  )}\n`,
  "README.md": `# Zintus Continuity\n\nA synthetic-only continuity demo whose local implementation models CockroachDB evidence storage, bounded retrieval, pre-Bedrock policy checks, and content-free receipts.\n\nThis archive is a local public-export candidate, not a deployed or production system. See the [architecture](docs/hackathon/architecture-diagram.md), [demo script](docs/hackathon/demo-video-script.md), [submission draft](docs/hackathon/devpost-submission-draft.md), and [checklist](docs/hackathon/submission-checklist.md).\n\nInstall with \`corepack pnpm install --offline --frozen-lockfile --ignore-scripts\`, then run \`corepack pnpm run typecheck\` and \`corepack pnpm run build:web\`. The optional inert Lambda artifact rebuild requires a clean Git clone on macOS arm64 and remains local-only. Licensed under Apache-2.0.\n`,
  "SECURITY.md":
    "# Security\n\nReport vulnerabilities privately to the repository owner. Do not include credentials or personal data. This synthetic demo is not approved for production data.\n",
  "CONTRIBUTING.md":
    "# Contributing\n\nUse synthetic data, keep changes scoped, run type checking and the web build, and never commit credentials or personal information. Contributions are accepted under Apache-2.0.\n",
  "database/README.md":
    "# Database migrations\n\nThis local public candidate contains forward-only migrations 0001 through 0009 and their static verifiers. They define content-free payload anchors, scoped memory, receipts, erasable response material, and the rolling 24-hour public-session quota repair. Migrations 0008 and 0009 remain unexecuted against the live CockroachDB cluster, and their apply, attestation, and probe evidence remains pending; source presence and owner authorization are not execution or deployment proof.\n",
};

async function put(root, path, bytes) {
  portable(path);
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, "wx", 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o644);
  } finally {
    await handle.close();
  }
  await utimes(target, EPOCH, EPOCH);
}

async function inventory(root) {
  const files = [];
  const markdown = [];
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const absolute = join(dir, name);
      const info = await lstat(absolute, { bigint: true });
      const path = relative(root, absolute);
      portable(path);
      if (info.isDirectory()) await walk(absolute);
      else {
        if (!info.isFile() || info.nlink !== 1n || (Number(info.mode) & 0o777) !== 0o644)
          throw new Error("invalid public file");
        const bytes = await readFile(absolute);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const fixture = restrictedFiles.get(path) === sha(bytes);
        if (text.includes(restrictedFixture) && restrictedFiles.get(path) !== sha(bytes))
          throw new Error("unreviewed restricted fixture");
        if (
          /\/Users\/|\/var\/folders\/|file:\/\/|[A-Z]:\\Users\\|A(?:KI|SI)A[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@|\bBearer\s+[A-Za-z0-9._-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\barn:aws:[^:\s]+:[^:\s]*:\d{12}:/u.test(
            text,
          ) &&
          !fixture
        )
          throw new Error(`sensitive public bytes:${path}`);
        files.push({ path, sizeBytes: bytes.length, sha256: sha(bytes) });
        if (path.endsWith(".md")) markdown.push([path, text]);
      }
    }
  }
  await walk(root);
  const folded = new Set();
  for (const file of files) {
    const key = file.path.normalize("NFC").toLowerCase();
    if (folded.has(key)) throw new Error("public path collision");
    folded.add(key);
  }
  const names = new Set(files.map(({ path }) => path));
  for (const [path, text] of markdown) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)#]+)(?:#[^)]+)?\)/gu)) {
      if (/^[a-z]+:/iu.test(match[1])) throw new Error("external public link");
      const target = relative(root, resolve(root, dirname(path), match[1]));
      portable(target);
      if (!names.has(target)) throw new Error("broken public link");
    }
    if (/^\[[^\]]+\]:\s*\S+/mu.test(text)) throw new Error("reference public link");
  }
  if (files.length > 500 || files.reduce((sum, file) => sum + file.sizeBytes, 0) > 8_000_000)
    throw new Error("public export bounds exceeded");
  return files;
}

async function makeArchive(tree, archive, paths) {
  const result = spawnSync("/usr/bin/zip", ["-X", "-q", archive, "-@"], {
    cwd: tree,
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TZ: "UTC" },
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || result.error) throw new Error("public archive failed");
}

export async function exportPublicCandidate({ verifyBuild = true } = {}) {
  if (process.argv.length > 2 || git(["status", "--porcelain=v1", "--untracked-files=all"]).length)
    throw new Error("public export requires clean state");
  const head = git(["rev-parse", "HEAD"]).toString().trim();
  const records = git(["ls-tree", "-r", "-z", head]).toString().split("\0").filter(Boolean);
  const entries = records.map((record) => {
    const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(record);
    if (!match || match[1] !== "100644") throw new Error("invalid git tree");
    return { blob: match[2], path: match[3] };
  });
  const paths = selectedPaths(entries.map(({ path }) => path));
  const included = new Set(paths);
  if (
    sha(`${paths.map((path) => `+${path}`).join("\n")}\n`) !== EXPECTED ||
    sha(
      entries
        .filter(({ path }) => included.has(path))
        .map(({ blob, path }) => `${path}\0${blob}\n`)
        .join(""),
    ) !== EXPECTED_BLOBS
  )
    throw new Error("public inventory review required");
  const output = await mkdtemp("/tmp/zintus-public-");
  try {
    const tree = join(output, "tree");
    const extracted = join(output, "extracted");
    await mkdir(tree);
    for (const path of paths) {
      const headBytes = git(["show", `${head}:${path}`]);
      let bytes = overlays[path] ? Buffer.from(overlays[path]) : headBytes;
      if (path === "NOTICE") bytes = resolvePublicNoticeBytes(headBytes, bytes, overlays.NOTICE);
      if (path === "package.json") {
        const value = JSON.parse(bytes);
        value.scripts = {
          typecheck: "tsc -b --pretty false",
          test: "vitest run --exclude tests/hackathon/h19-lambda-package.test.mjs --exclude tests/hackathon/h19b-image-package.test.mjs",
          "build:web": "pnpm --filter @zintus-continuity/web build",
        };
        bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      }
      await put(tree, path, bytes);
    }
    const files = await inventory(tree);
    const aggregate = sha(files.map(({ path, sha256 }) => `${path}\0${sha256}\n`).join(""));
    if (aggregate !== EXPECTED_AGGREGATE) throw new Error("public overlay review required");
    const manifest = {
      schemaVersion: 1,
      sourceHead: head,
      status: "LOCAL_PUBLIC_EXPORT_CANDIDATE_NO_GO",
      aggregate,
      files,
    };
    await put(
      tree,
      "PUBLIC_EXPORT_MANIFEST.json",
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    );
    const finalFiles = await inventory(tree);
    const archive = join(output, "zintus-continuity-public.zip");
    await makeArchive(
      tree,
      archive,
      finalFiles.map(({ path }) => path),
    );
    await mkdir(extracted);
    run("/usr/bin/unzip", ["-qq", archive, "-d", extracted]);
    const extractedFiles = await inventory(extracted);
    if (JSON.stringify(finalFiles) !== JSON.stringify(extractedFiles))
      throw new Error("public archive mismatch");
    if (verifyBuild) {
      const hostHome = process.env.HOME;
      if (!hostHome || !hostHome.startsWith("/Users/")) throw new Error("invalid package cache");
      const packageEnvironment = {
        COREPACK_HOME: await realpath(join(hostHome, ".cache/node/corepack")),
        HOME: join(output, "home"),
        LANG: "C",
        LC_ALL: "C",
        NPM_CONFIG_USERCONFIG: "/dev/null",
        PATH: "/usr/bin:/bin:/usr/local/bin",
        XDG_CONFIG_HOME: join(output, "config"),
      };
      await mkdir(packageEnvironment.HOME);
      const store = await realpath(join(hostHome, "Library/pnpm/store/v11"));
      run(
        "/usr/local/bin/corepack",
        [
          "pnpm",
          "install",
          "--offline",
          "--frozen-lockfile",
          "--ignore-scripts",
          `--store-dir=${store}`,
        ],
        {
          cwd: extracted,
          env: packageEnvironment,
        },
      );
      run("/usr/local/bin/corepack", ["pnpm", "run", "typecheck"], {
        cwd: extracted,
        env: packageEnvironment,
      });
      run("/usr/local/bin/corepack", ["pnpm", "run", "test"], {
        cwd: extracted,
        env: packageEnvironment,
      });
      run("/usr/local/bin/corepack", ["pnpm", "run", "build:web"], {
        cwd: extracted,
        env: packageEnvironment,
      });
    }
    if (
      git(["rev-parse", "HEAD"]).toString().trim() !== head ||
      git(["status", "--porcelain=v1", "--untracked-files=all"]).length
    )
      throw new Error("source changed during public export");
    const archiveBytes = await readFile(archive);
    const archiveSha256 = sha(archiveBytes);
    await put(
      output,
      "manifest.json",
      Buffer.from(
        `${JSON.stringify({ ...manifest, archiveSha256, archiveSizeBytes: archiveBytes.length }, null, 2)}\n`,
      ),
    );
    await rm(extracted, { recursive: true, force: true });
    await rm(join(output, "home"), { recursive: true, force: true });
    await rm(join(output, "config"), { recursive: true, force: true });
    if (
      JSON.stringify((await readdir(output)).sort()) !==
      JSON.stringify(["manifest.json", "tree", "zintus-continuity-public.zip"])
    )
      throw new Error("unexpected public output");
    return {
      path: archive,
      sha256: archiveSha256,
      aggregate,
      status: "LOCAL_PUBLIC_EXPORT_CANDIDATE_NO_GO",
    };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw new Error(error instanceof Error ? error.message : "public export failed");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  exportPublicCandidate()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write("public export failed\n");
      process.exitCode = 1;
    });
}
