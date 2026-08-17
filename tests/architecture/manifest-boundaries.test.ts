import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ownDataEntries, writeOwnData } from "../../scripts/safe-own-data.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const checker = path.join(repositoryRoot, "scripts", "check-manifests.mjs");
const imagePacker = path.join(repositoryRoot, "scripts", "package-hackathon-image.mjs");
const safeInstaller = path.join(repositoryRoot, "scripts", "safe-pnpm-install.mjs");
const safeVerifier = path.join(repositoryRoot, "scripts", "safe-verify.mjs");
const packagePaths = [
  ".",
  "packages/foundation",
  "packages/domain",
  "packages/contracts",
  "packages/policy",
  "packages/application",
  "packages/adapters-local",
  "apps/api",
  "apps/worker",
  "apps/web",
  "infrastructure",
];
const temporaryRoots: string[] = [];
type Manifest = Record<string, unknown>;
type MutationCase = [string, (manifest: Manifest) => void];

async function syntheticRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "zc-manifest-security-"));
  temporaryRoots.push(root);
  for (const relative of packagePaths) {
    const directory = path.resolve(root, relative);
    await mkdir(directory, { recursive: true });
    const source = path.resolve(repositoryRoot, relative, "package.json");
    await writeFile(path.join(directory, "package.json"), await readFile(source, "utf8"), "utf8");
  }
  for (const filename of [".npmrc", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    await writeFile(
      path.join(root, filename),
      await readFile(path.join(repositoryRoot, filename), "utf8"),
    );
  }
  return root;
}

async function mutate(root: string, relative: string, change: (manifest: Manifest) => void) {
  const filename = path.resolve(root, relative, "package.json");
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  change(manifest);
  await writeFile(filename, JSON.stringify(manifest), "utf8");
}

async function failingPreflightFixture(filename: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-entrypoint-ordering-")));
  temporaryRoots.push(root);
  const scripts = path.join(root, "scripts");
  await mkdir(scripts);
  await writeFile(
    path.join(scripts, filename),
    await readFile(path.join(repositoryRoot, "scripts", filename), "utf8"),
  );
  const observedEnvironment = path.join(root, "observed-environment.json");
  await writeFile(
    path.join(scripts, "verify-trust-preflight.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(observedEnvironment)}, JSON.stringify(process.env));`,
      'process.stderr.write("SYNTHETIC_PREFLIGHT_FAIL\\n");',
      "process.exitCode = 9;",
    ].join("\n"),
  );
  const localEffect = path.join(root, "LOCAL_MODULE_OR_EFFECT_REACHED");
  const trap = [
    'import { writeFileSync } from "node:fs";',
    `writeFileSync(${JSON.stringify(localEffect)}, "reached");`,
  ].join("\n");
  for (const local of [
    "safe-own-data.mjs",
    "repository-operation-lock.mjs",
    "check-manifests.mjs",
  ]) {
    await writeFile(path.join(scripts, local), trap);
  }
  return { entrypoint: path.join(scripts, filename), localEffect, observedEnvironment, root };
}

function run(root: string) {
  return spawnSync(process.execPath, [checker, root], {
    encoding: "utf8",
    env: { TMPDIR: tmpdir(), ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((entry) => rm(entry, { force: true, recursive: true })),
  );
});

describe("package manifest supply-chain boundaries", () => {
  it("accepts the exact checked-in workspace manifests", () => {
    const result = run(repositoryRoot);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("manifests: PASS (11 exact packages)");
  });

  it("accepts only the exact ephemeral repository-operation lock", async () => {
    const valid = await syntheticRepository();
    const lock = path.join(valid, ".zc-bootstrap", "repository-operation.lock");
    await mkdir(lock, { recursive: true });
    await writeFile(path.join(lock, "owner-token"), "b".repeat(48), "utf8");
    expect(run(valid).status).toBe(0);

    const malformed = await syntheticRepository();
    const malformedLock = path.join(malformed, ".zc-bootstrap", "repository-operation.lock");
    await mkdir(malformedLock, { recursive: true });
    await writeFile(path.join(malformedLock, "unexpected"), "ignored", "utf8");
    const result = run(malformed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unrecognized shape");
  });

  const escapingCases: MutationCase[] = [
    ["types", (manifest) => (manifest.types = "../canary")],
    [
      "exports.types",
      (manifest) => {
        const exports = manifest.exports as Record<string, Record<string, unknown>>;
        const rootExport = exports["."];
        if (!rootExport) throw new Error("fixture root export is missing");
        rootExport.types = "../canary";
      },
    ],
    ["imports", (manifest) => (manifest.imports = { "#unsafe": "../canary" })],
    ["bin", (manifest) => (manifest.bin = "../canary")],
    ["files", (manifest) => (manifest.files = ["../canary"])],
  ];

  it.each(escapingCases)("rejects escaping %s before reading its target", async (_case, change) => {
    const root = await syntheticRepository();
    await writeFile(path.join(path.dirname(root), "canary"), "DO_NOT_READ_CANARY", "utf8");
    await mutate(root, "packages/foundation", change);

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("target");
    expect(`${result.stdout}${result.stderr}`).not.toContain("DO_NOT_READ_CANARY");
  });

  const identityCases: MutationCase[] = [
    ["substituted name", (manifest) => (manifest.name = "@attacker/substitute")],
    ["duplicate name", (manifest) => (manifest.name = "@zintus-continuity/domain")],
  ];

  it.each(identityCases)("rejects %s", async (_case, change) => {
    const root = await syntheticRepository();
    await mutate(root, "packages/foundation", change);
    expect(run(root).status).not.toBe(0);
  });

  it("rejects typesVersions before TypeScript can resolve an external declaration", async () => {
    const root = await syntheticRepository();
    await mutate(root, "packages/foundation", (manifest) => {
      manifest.typesVersions = { "*": { "*": ["../../../canary.d.ts"] } };
    });

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("typesVersions is prohibited");
  });

  it.each([
    "file:../canary",
    "https://example.invalid/archive.tgz",
    "npm:react@19.2.8",
  ])("rejects unsafe dependency source %s", async (source) => {
    const root = await syntheticRepository();
    await mutate(root, "packages/foundation", (manifest) => {
      manifest.dependencies = { attacker: source };
    });
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exact registry version");
  });

  it("rejects an install hook without executing it", async () => {
    const root = await syntheticRepository();
    const canary = path.join(root, "HOOK_EXECUTED");
    await mutate(root, "packages/foundation", (manifest) => {
      manifest.scripts = {
        install: `node -e "require('node:fs').writeFileSync('${canary}', 'bad')"`,
      };
    });

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("lifecycle script install is prohibited");
    await expect(access(canary)).rejects.toThrow();
  });

  it.each([
    [".", "verify", "substituted verify"],
    [".", "preverify", "preverify hook"],
    ["apps/web", "prebuild", "leaf prebuild hook"],
    ["apps/web", "build", "leaf build mutation"],
  ])("rejects %s %s (%s) without executing it", async (relative, script, _case) => {
    const root = await syntheticRepository();
    const canary = path.join(root, `SCRIPT_EXECUTED_${script}`);
    await mutate(root, relative, (manifest) => {
      const scripts = (manifest.scripts ?? {}) as Record<string, string>;
      writeOwnData(
        scripts,
        script,
        `node -e "require('node:fs').writeFileSync('${canary}', 'bad')"`,
      );
      manifest.scripts = scripts;
    });

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("scripts differs from the exact command allowlist");
    await expect(access(canary)).rejects.toThrow();
  });

  it.each([
    [
      "unknown",
      "ignore-pnpmfile=true\nignore-scripts=true\nsave-exact=true\nstrict-peer-dependencies=true\nregistry=https://example.invalid\n",
    ],
    [
      "duplicate",
      "ignore-pnpmfile=true\nignore-scripts=true\nignore-scripts=true\nsave-exact=true\nstrict-peer-dependencies=true\n",
    ],
    [
      "poisoned",
      "ignore-pnpmfile=false\nignore-scripts=true\nsave-exact=true\nstrict-peer-dependencies=true\n",
    ],
  ])("rejects %s root .npmrc bytes", async (_case, content) => {
    const root = await syntheticRepository();
    await writeFile(path.join(root, ".npmrc"), content, "utf8");
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".npmrc bytes differ");
  });

  it.each([
    ".npmrc",
    ".pnpmfile.cjs",
    ".pnpmfile.js",
  ])("rejects nested pnpm override %s without executing it", async (filename) => {
    const root = await syntheticRepository();
    const canary = path.join(root, "PNPM_HOOK_EXECUTED");
    const nested = path.join(root, "packages", "foundation", "nested");
    await mkdir(nested);
    await writeFile(
      path.join(nested, filename),
      `require('node:fs').writeFileSync('${canary}', 'bad')`,
      "utf8",
    );
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pnpm config/hook is prohibited");
    await expect(access(canary)).rejects.toThrow();
  });

  it("ignores only the real top-level .worktrees directory without weakening symlink checks", async () => {
    const hostileConfig = "require('node:fs').writeFileSync('MUST_NOT_RUN', 'bad')";

    const opaque = await syntheticRepository();
    const opaqueNested = path.join(opaque, ".worktrees", "candidate", "nested");
    await mkdir(opaqueNested, { recursive: true });
    await writeFile(path.join(opaqueNested, ".pnpmfile.cjs"), hostileConfig, "utf8");
    const opaqueResult = run(opaque);
    expect(opaqueResult.status, opaqueResult.stderr).toBe(0);

    for (const directory of ["ordinary", ".worktrees-lookalike", "ordinary/.worktrees"]) {
      const visible = await syntheticRepository();
      const visibleNested = path.join(visible, directory, "candidate", "nested");
      await mkdir(visibleNested, { recursive: true });
      await writeFile(path.join(visibleNested, ".pnpmfile.cjs"), hostileConfig, "utf8");
      const visibleResult = run(visible);
      expect(visibleResult.status).not.toBe(0);
      expect(visibleResult.stderr).toContain("pnpm config/hook is prohibited");
    }

    const linked = await syntheticRepository();
    const external = await mkdtemp(path.join(tmpdir(), "zc-worktrees-symlink-canary-"));
    temporaryRoots.push(external);
    await symlink(external, path.join(linked, ".worktrees"), "dir");
    const linkedResult = run(linked);
    expect(linkedResult.status).not.toBe(0);
    expect(linkedResult.stderr).toContain("repository symbolic link is prohibited: .worktrees");
  });

  it("rejects a poisoned lockfile by exact reviewed digest", async () => {
    const root = await syntheticRepository();
    await writeFile(path.join(root, "pnpm-lock.yaml"), "\n# poisoned resolution\n", { flag: "a" });
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exact current reviewed lock");
  });

  it.each([
    "arbitrary-link",
    "node_modules",
  ])("first guard rejects repository symlink %s before policy reads", async (name) => {
    const root = await syntheticRepository();
    const external = await mkdtemp(path.join(tmpdir(), "zc-first-guard-canary-"));
    temporaryRoots.push(external);
    await symlink(external, path.join(root, name), "dir");
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("repository symbolic link is prohibited");
  });

  it("sanitizes package-manager and Node override environment variables", () => {
    const moduleUrl = new URL(`file://${safeInstaller}`);
    const safeOwnDataUrl = new URL("../../scripts/safe-own-data.mjs", import.meta.url);
    const source = [
      `import { sanitizeEnvironment } from ${JSON.stringify(moduleUrl.href)};`,
      "const dirty = {HOME:'/safe-home',NODE_OPTIONS:'--require=/poison',NPM_CONFIG_REGISTRY:'https://example.invalid',PATH:process.env.PATH,PNPM_HOME:'/poison',npm_config_pnpmfile:'/poison/pnpmfile.cjs'};",
      "const paths = {home:'/repo/home',temporary:'/repo/tmp',cache:'/repo/cache',config:'/repo/config',data:'/repo/data',state:'/repo/state',store:'/repo/store',virtualStore:'/repo/virtual',userConfig:'/repo/user',globalConfig:'/repo/global'};",
      `const clean = await sanitizeEnvironment(dirty, paths, import(${JSON.stringify(safeOwnDataUrl.href)}));`,
      "process.stdout.write(JSON.stringify(clean));",
    ].join("");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status, result.stderr).toBe(0);
    const clean = JSON.parse(result.stdout);
    expect(clean).not.toHaveProperty("NODE_OPTIONS");
    expect(clean).not.toHaveProperty("NPM_CONFIG_REGISTRY");
    expect(clean).not.toHaveProperty("PNPM_HOME");
    expect(clean).not.toHaveProperty("npm_config_pnpmfile");
    expect(clean.HOME).toBe("/repo/home");
    expect(clean.TMPDIR).toBe("/repo/tmp");
    expect(clean.npm_config_userconfig).toBe("/repo/user");
    expect(clean.npm_config_globalconfig).toBe("/repo/global");
  });

  it("packages pinned image inputs independently of a poisoned HOME", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zc-image-poisoned-home-"));
    temporaryRoots.push(root);
    const nonexistentHome = path.join(root, "not-created");
    const source = [
      'import { rm } from "node:fs/promises";',
      `const { packageHackathonImageContext } = await import(${JSON.stringify(pathToFileURL(imagePacker).href)});`,
      "const result = await packageHackathonImageContext();",
      "await rm(result.path, { force: true, recursive: true });",
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { HOME: nonexistentHome, PATH: process.env.PATH },
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const packaged = JSON.parse(result.stdout);
    expect(packaged.status).toBe("LOCAL_IMAGE_CONTEXT_ONLY");
    await expect(access(packaged.path)).rejects.toThrow();
    await expect(access(nonexistentHome)).rejects.toThrow();
  }, 60_000);

  it.each([
    ".zc-bootstrap",
    ".zc-pnpm-store",
  ])("rejects a repository-local %s symlink before using its external target", async (directory) => {
    const root = await mkdtemp(path.join(tmpdir(), "zc-installer-root-"));
    temporaryRoots.push(root);
    const canonicalRoot = await realpath(root);
    const external = await mkdtemp(path.join(tmpdir(), "zc-installer-canary-"));
    temporaryRoots.push(external);
    await symlink(external, path.join(root, directory), "dir");
    const moduleUrl = new URL(`file://${safeInstaller}`);
    const source = [
      `import { prepareAuthorizedPaths } from ${JSON.stringify(moduleUrl.href)};`,
      `await prepareAuthorizedPaths(${JSON.stringify(canonicalRoot)});`,
    ].join("");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("real directory");
    await expect(access(path.join(external, "store"))).rejects.toThrow();
  });

  it("creates every authorized installer path canonically inside the supplied repository", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zc-installer-paths-"));
    temporaryRoots.push(root);
    const canonicalRoot = await realpath(root);
    const moduleUrl = new URL(`file://${safeInstaller}`);
    const source = [
      `import { prepareAuthorizedPaths } from ${JSON.stringify(moduleUrl.href)};`,
      `const paths = await prepareAuthorizedPaths(${JSON.stringify(canonicalRoot)});`,
      "process.stdout.write(JSON.stringify(paths));",
    ].join("");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status, result.stderr).toBe(0);
    for (const [, value] of ownDataEntries(JSON.parse(result.stdout))) {
      expect(path.relative(canonicalRoot, String(value))).not.toMatch(/^\.\./u);
    }
  });

  it("rejects installer argument passthrough before package-manager execution", () => {
    const result = spawnSync(process.execPath, [safeInstaller, "--registry=poison"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("only the optional --offline argument is accepted");
  });

  it("rejects verifier arguments before running any stage", () => {
    const result = spawnSync(process.execPath, [safeVerifier, "--stage=poison"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("safe verification accepts no arguments");
  });

  it.each([
    ["safe-pnpm-install.mjs", "require"],
    ["safe-pnpm-install.mjs", "import"],
    ["safe-verify.mjs", "require"],
    ["safe-verify.mjs", "import"],
  ] as const)("%s excludes NODE_OPTIONS --%s and all local effects from the earliest child", async (filename, loaderKind) => {
    const fixture = await failingPreflightFixture(filename);
    const childLoaderEffect = path.join(fixture.root, "CHILD_LOADER_REACHED");
    const loader = path.join(fixture.root, loaderKind === "require" ? "loader.cjs" : "loader.mjs");
    const loaderSource = [
      loaderKind === "require"
        ? 'const { writeFileSync } = require("node:fs");'
        : 'import { writeFileSync } from "node:fs";',
      `if (process.argv[1]?.endsWith("verify-trust-preflight.mjs")) writeFileSync(${JSON.stringify(childLoaderEffect)}, "reached");`,
    ].join("\n");
    await writeFile(loader, loaderSource);
    const loaderReference = loaderKind === "require" ? loader : pathToFileURL(loader).href;
    const result = spawnSync(process.execPath, [fixture.entrypoint], {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        LANG: "C",
        LC_ALL: "C",
        NODE_OPTIONS: `--${loaderKind}=${loaderReference}`,
        NODE_PATH: "/poison/node-path",
        PATH: process.env.PATH ?? "",
        SystemRoot: "synthetic-system-root",
        npm_config_registry: "https://example.invalid",
      },
    });
    const expectedTail =
      filename === "safe-pnpm-install.mjs"
        ? `safe-pnpm-install: FAIL: ${process.execPath} failed with status 9\n`
        : "safe-verify: FAIL: earliest trust preflight failed with status 9\n";
    expect(result.status, JSON.stringify({ stderr: result.stderr, stdout: result.stdout })).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`SYNTHETIC_PREFLIGHT_FAIL\n${expectedTail}`);
    const observed = JSON.parse(await readFile(fixture.observedEnvironment, "utf8"));
    if (observed.__CF_USER_TEXT_ENCODING !== undefined) {
      expect(observed.__CF_USER_TEXT_ENCODING).toMatch(/^0x[0-9A-F]+:0x[0-9A-F]+:0x[0-9A-F]+$/u);
      delete observed.__CF_USER_TEXT_ENCODING;
    }
    expect(observed).toEqual({
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH ?? "",
      SystemRoot: "synthetic-system-root",
    });
    await expect(access(childLoaderEffect)).rejects.toThrow();
    await expect(access(fixture.localEffect)).rejects.toThrow();
    await expect(access(path.join(fixture.root, ".zc-bootstrap"))).rejects.toThrow();
  });

  it("rejects a reviewed-tool symlink that resolves outside the installed dependency tree", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-tool-root-")));
    temporaryRoots.push(root);
    const external = await realpath(await mkdtemp(path.join(tmpdir(), "zc-tool-external-")));
    temporaryRoots.push(external);
    const packageParent = path.join(
      root,
      ".zc-pnpm-store",
      "virtual-store",
      "synthetic@1.0.0",
      "node_modules",
    );
    await mkdir(packageParent, { recursive: true });
    await writeFile(
      path.join(external, "package.json"),
      JSON.stringify({ name: "synthetic", version: "1.0.0", bin: { synthetic: "./bin.js" } }),
    );
    await writeFile(path.join(external, "bin.js"), "process.exit(0)");
    await symlink(external, path.join(packageParent, "synthetic"), "dir");
    const moduleUrl = new URL(`file://${safeVerifier}`);
    const safeOwnDataUrl = new URL("../../scripts/safe-own-data.mjs", import.meta.url);
    const source = [
      `import { resolveReviewedTool } from ${JSON.stringify(moduleUrl.href)};`,
      `await resolveReviewedTool(${JSON.stringify(root)},{name:'synthetic',version:'1.0.0',packagePath:'synthetic',virtualStorePackage:'synthetic@1.0.0',bin:'synthetic'},import(${JSON.stringify(safeOwnDataUrl.href)}));`,
    ].join("");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("escapes the reviewed installed dependency tree");
  });

  it("fails closed when a fixed stage exits unsuccessfully", () => {
    const moduleUrl = new URL(`file://${safeVerifier}`);
    const source = [
      `import { runFixedProcess } from ${JSON.stringify(moduleUrl.href)};`,
      `runFixedProcess(process.execPath,['--eval','process.exit(7)'],{cwd:${JSON.stringify(repositoryRoot)},env:{},label:'synthetic stage',stdio:'pipe'});`,
    ].join("");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("synthetic stage failed with status 7");
  });

  it.each([
    "verify-cleanroom.mjs",
    "check-dependencies.mjs",
  ])("rejects local stage symlink %s without reading its external target", async (filename) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-stage-root-")));
    temporaryRoots.push(root);
    const external = await realpath(await mkdtemp(path.join(tmpdir(), "zc-stage-external-")));
    temporaryRoots.push(external);
    await mkdir(path.join(root, "scripts"));
    const canary = path.join(external, filename);
    await writeFile(canary, "DO_NOT_READ_OR_EXECUTE");
    await symlink(canary, path.join(root, "scripts", filename), "file");
    const moduleUrl = new URL(`file://${safeVerifier}`);
    const source = [
      `import { validateLocalStage } from ${JSON.stringify(moduleUrl.href)};`,
      `await validateLocalStage(${JSON.stringify(root)},${JSON.stringify(path.join(root, "scripts", filename))});`,
    ].join("");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local stage symbolic link is prohibited");
    expect(`${result.stdout}${result.stderr}`).not.toContain("DO_NOT_READ_OR_EXECUTE");
  });
});
