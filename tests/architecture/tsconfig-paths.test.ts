import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const checker = path.join(repositoryRoot, "scripts", "check-tsconfig-paths.mjs");
const temporaryRoots: string[] = [];

async function temporaryRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "zc-tsconfig-security-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".git"));
  return root;
}

async function writeConfig(root: string, config: unknown) {
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify(config), "utf8");
}

function run(root: string) {
  return spawnSync(process.execPath, [checker, root], {
    encoding: "utf8",
    env: { TMPDIR: tmpdir(), ZC_ALLOW_SYNTHETIC_TEST_ROOT: "1" },
  });
}

afterEach(async () => {
  let cleanupFailed = false;
  while (temporaryRoots.length > 0) {
    const entry = temporaryRoots.pop();
    if (entry === undefined) continue;
    try {
      await rm(entry, { force: true, recursive: true });
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error("temporary repository cleanup failed");
});

describe("TypeScript configuration path boundaries", () => {
  it("accepts the checked-in configuration graph", () => {
    const result = run(repositoryRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("tsconfig-paths: PASS (13 configs)");
  });

  it("uses the exact root-only Biome worktree exclusion", async () => {
    const biome = JSON.parse(await readFile(path.join(repositoryRoot, "biome.json"), "utf8"));

    expect(biome.files.includes.slice(0, 6)).toEqual([
      "**",
      "!.worktrees",
      "!ci/h01-cleanroom-policy-r1.json",
      "!ci/h01-cleanroom-policy-r2.json",
      "!ci/h02c-cleanroom-policy-r1.json",
      "!ci/h11b-cleanroom-policy-r18.json",
    ]);
    expect(
      createHash("sha256")
        .update(await readFile(path.join(repositoryRoot, "ci/h02c-cleanroom-policy-r1.json")))
        .digest("hex"),
    ).toBe("9823ef32caadad5dbc044b408762788b2cc1721c82cd054ba7cd0ac0f1161887");
    expect(biome.files.includes.filter((entry: string) => entry.includes(".worktrees"))).toEqual([
      "!.worktrees",
    ]);
    expect(biome.files.includes).not.toContain("!**/.worktrees");
    expect(biome.files.includes).not.toContain("!.worktrees-lookalike");
    expect(biome.files.includes).not.toContain("!ordinary/.worktrees");
    expect(biome.files.includes).not.toContain(
      "!packages/adapters-local/src/local-c06-event-repository.ts",
    );
    expect(biome.files.includes).not.toContain("!scripts/generate-b03-local-evidence.mjs");
    expect(biome.files.includes).not.toContain("!tests/architecture/b03-source-security.test.mjs");
    expect(biome.files.includes).toContain("!ci/h11b-cleanroom-policy-r39.json");
  });

  it("keeps the Node-test public exporter outside Vitest collection", async () => {
    const source = await readFile(path.join(repositoryRoot, "vitest.config.ts"), "utf8");

    expect(
      source.match(/exclude: \["tests\/hackathon\/h20-public-export\.test\.mjs"\]/gu),
    ).toHaveLength(1);
  });

  it("treats only a real top-level .worktrees directory as opaque", async () => {
    const root = await temporaryRepository();
    const opaque = path.join(root, ".worktrees", "candidate", "nested");
    await mkdir(opaque, { recursive: true });
    await writeFile(path.join(opaque, "tsconfig.hostile.json"), "{", "utf8");
    await writeConfig(root, {});

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("tsconfig-paths: PASS (1 configs)");
  });

  it.each([
    "file",
    "symlink",
    "special",
  ])("rejects a top-level .worktrees %s before exclusion", async (kind) => {
    const root = await temporaryRepository();
    const target = path.join(root, ".worktrees");
    if (kind === "file") {
      await writeFile(target, "not a directory", "utf8");
    } else if (kind === "symlink") {
      const external = await temporaryRepository();
      await symlink(external, target, "dir");
    } else {
      const created = spawnSync("mkfifo", [target], { encoding: "utf8" });
      expect(created.status, created.stderr).toBe(0);
    }
    await writeConfig(root, {});

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("worktrees directory must be a canonical regular directory");
  });

  it.each([
    ".worktrees-lookalike",
    "ordinary/.worktrees",
  ])("still scans and rejects hostile config under %s", async (relative) => {
    const root = await temporaryRepository();
    const visible = path.join(root, relative);
    await mkdir(visible, { recursive: true });
    await writeFile(path.join(visible, "tsconfig.hostile.json"), "{", "utf8");
    await writeConfig(root, {});

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not valid TypeScript JSON");
  });

  it.each([
    { label: "extends", config: { extends: "../external.json" } },
    { label: "include", config: { include: ["../external/**/*.ts"] } },
    { label: "files", config: { files: ["../external.ts"] } },
    {
      label: "project reference",
      config: { references: [{ path: "../external-project" }] },
    },
    { label: "paths", config: { compilerOptions: { paths: { unsafe: ["../external/*"] } } } },
    { label: "typeRoots", config: { compilerOptions: { typeRoots: ["../external-types"] } } },
    { label: "rootDirs", config: { compilerOptions: { rootDirs: ["../external-root"] } } },
  ])("rejects external $label before reading a target", async (testCase) => {
    const container = await temporaryRepository();
    const root = path.join(container, "repository");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(container, "external.json"), "DO_NOT_READ_CANARY", "utf8");
    await writeConfig(root, testCase.config);

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("trusted repository");
    expect(`${result.stdout}${result.stderr}`).not.toContain("DO_NOT_READ_CANARY");
  });

  it("rejects a config symlink without reading its target", async () => {
    const container = await temporaryRepository();
    const root = path.join(container, "repository");
    await mkdir(path.join(root, ".git"), { recursive: true });
    const canary = path.join(container, "external-config.json");
    await writeFile(canary, "DO_NOT_READ_CANARY", "utf8");
    await symlink(canary, path.join(root, "tsconfig.json"), "file");

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("configuration symbolic link is prohibited");
    expect(`${result.stdout}${result.stderr}`).not.toContain("DO_NOT_READ_CANARY");
  });

  it("still scans and rejects a similarly named bootstrap directory", async () => {
    const root = await temporaryRepository();
    const lookalike = path.join(root, ".zc-bootstrap-attacker");
    await mkdir(lookalike);
    await writeFile(path.join(lookalike, "tsconfig.attacker.json"), "{", "utf8");

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not valid TypeScript JSON");
  });

  it("rejects a symlinked bootstrap before applying the exact exclusion", async () => {
    const root = await temporaryRepository();
    const target = await temporaryRepository();
    await symlink(target, path.join(root, ".zc-bootstrap"), "dir");
    await writeConfig(root, {});

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bootstrap directory must be a canonical regular directory");
  });

  it("rejects a malformed bootstrap lock before applying the exact exclusion", async () => {
    const root = await temporaryRepository();
    const lock = path.join(root, ".zc-bootstrap", "repository-operation.lock");
    await mkdir(lock, { recursive: true });
    await writeFile(path.join(lock, "unexpected"), "malformed", "utf8");
    await writeConfig(root, {});

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unrecognized shape");
  });
});
