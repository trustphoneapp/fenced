import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanSourceSecurity } from "../../scripts/verify-source-security.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const roots = [];
const sourceInputs = [
  "packages/foundation/src/owned-json.ts",
  "pnpm-workspace.yaml",
  "packages/foundation/package.json",
  "packages/foundation/tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.json",
  "pnpm-lock.yaml",
  "packages/adapters-local/src/local-cognito-shaped-verifier.ts",
  "packages/adapters-local/package.json",
  "packages/adapters-local/tsconfig.json",
];
const buildInputs = [
  "packages/foundation/dist/owned-json.js",
  "packages/foundation/dist/owned-json.d.ts",
  "packages/foundation/dist/owned-json.d.ts.map",
];
const consumerPath = "packages/adapters-local/src/local-cognito-shaped-verifier.ts";
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(includeBuild) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-owned-json-bridge-")));
  roots.push(root);
  for (const relative of sourceInputs.concat(includeBuild ? buildInputs : [])) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(repositoryRoot, relative)));
  }
  const link = path.join(
    root,
    "packages/adapters-local/node_modules/@zintus-continuity/foundation",
  );
  await mkdir(path.dirname(link), { recursive: true });
  await symlink("../../../foundation", link);
  const policy = JSON.parse(
    await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"),
  ).sourceSecurity;
  policy.roots = ["packages/adapters-local/src"];
  policy.excludedPaths = [];
  policy.extensions = policy.extensions.filter((extension) => extension !== ".py");
  delete policy.pythonSingleton;
  return { root, policy };
}

async function mutateConsumer(target, transform) {
  const candidate = path.join(target.root, consumerPath);
  const source = await readFile(candidate, "utf8");
  const changed = transform(source);
  expect(changed).not.toBe(source);
  await writeFile(candidate, changed);
  target.policy.ownedJsonPackageBridge.hashes.consumerSource = digest(changed);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("OwnedJson package bridge v2", () => {
  it("separates source-only proof from the runtime-bound final proof", async () => {
    const staged = await fixture(false);
    const stagedResult = await scanSourceSecurity(staged.root, staged.policy, {
      sourceOnly: true,
    });
    expect(stagedResult.bridgeStatus).toBe("STAGED_SOURCE_PASS_NOT_RUNTIME");
    expect(stagedResult.findings).toEqual([]);
    await expect(scanSourceSecurity(staged.root, staged.policy)).rejects.toThrow();

    const final = await fixture(true);
    const finalResult = await scanSourceSecurity(final.root, final.policy);
    expect(finalResult.bridgeStatus).toBe("RUNTIME_BUILD_BOUND");
    expect(finalResult.findings).toEqual([]);
  });

  it.each(buildInputs)("fails final proof when %s is missing or stale", async (relative) => {
    const missing = await fixture(true);
    await rm(path.join(missing.root, relative));
    await expect(scanSourceSecurity(missing.root, missing.policy)).rejects.toThrow();

    const stale = await fixture(true);
    await writeFile(path.join(stale.root, relative), "stale");
    await expect(scanSourceSecurity(stale.root, stale.policy)).rejects.toThrow(
      /OWNED_JSON_BRIDGE_INPUT_CHANGED/u,
    );
  });

  it("rejects an unexpected runtime source map and a redirected installed link", async () => {
    const sourceMap = await fixture(true);
    await writeFile(path.join(sourceMap.root, "packages/foundation/dist/owned-json.js.map"), "{}");
    await expect(scanSourceSecurity(sourceMap.root, sourceMap.policy)).rejects.toThrow(
      /unexpected runtime source map/u,
    );

    const redirected = await fixture(true);
    const link = path.join(
      redirected.root,
      "packages/adapters-local/node_modules/@zintus-continuity/foundation",
    );
    await rm(link);
    await symlink("../../../adapters-local", link);
    await expect(scanSourceSecurity(redirected.root, redirected.policy)).rejects.toThrow(
      /installed workspace link is invalid/u,
    );
  });

  it("rejects build outputs reached through a symlinked parent", async () => {
    const target = await fixture(true);
    const dist = path.join(target.root, "packages/foundation/dist");
    const alternate = path.join(target.root, "alternate-dist");
    await mkdir(alternate);
    for (const relative of buildInputs) {
      await writeFile(
        path.join(alternate, path.basename(relative)),
        await readFile(path.join(target.root, relative)),
      );
    }
    await rm(dist, { recursive: true });
    await symlink("../../alternate-dist", dist);
    await expect(scanSourceSecurity(target.root, target.policy)).rejects.toThrow(
      /OWNED_JSON_BRIDGE_INPUT_INVALID/u,
    );
  });

  it("binds every source, configuration, consumer, and build input hash", async () => {
    const target = await fixture(true);
    for (const key of Object.keys(target.policy.ownedJsonPackageBridge.hashes)) {
      const mutated = structuredClone(target.policy);
      mutated.ownedJsonPackageBridge.hashes[key] = "0".repeat(64);
      await expect(scanSourceSecurity(target.root, mutated)).rejects.toThrow();
    }
  });

  it("rejects reviewed-hash updates that change the frozen package semantics", async () => {
    const target = await fixture(false);
    const relative = "packages/foundation/package.json";
    const candidate = path.join(target.root, relative);
    const manifest = JSON.parse(await readFile(candidate, "utf8"));
    manifest.exports["./owned-json"].default = "./dist/alternate.js";
    const changed = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(candidate, changed);
    target.policy.ownedJsonPackageBridge.hashes.foundationManifest = digest(changed);
    await expect(
      scanSourceSecurity(target.root, target.policy, { sourceOnly: true }),
    ).rejects.toThrow(/package bridge semantics are invalid/u);
  });

  it("rejects unrelated lockfile byte drift before semantic parsing", async () => {
    const target = await fixture(false);
    const lockfile = path.join(target.root, "pnpm-lock.yaml");
    await writeFile(lockfile, `${await readFile(lockfile, "utf8")}\n`);
    await expect(
      scanSourceSecurity(target.root, target.policy, { sourceOnly: true }),
    ).rejects.toThrow(/SOURCE_SECURITY_OWNED_JSON_BRIDGE_INPUT_CHANGED/u);
  });

  it.each([
    ["workspace", "pnpm-workspace.yaml", "workspace", (text) => `${text}  - unexpected/*\n`],
    [
      "foundation compiler",
      "packages/foundation/tsconfig.json",
      "foundationTsconfig",
      (text) => text.replace('"rootDir": "src"', '"rootDir": "alternate"'),
    ],
    [
      "base compiler",
      "tsconfig.base.json",
      "baseTsconfig",
      (text) => text.replace('"module": "NodeNext"', '"module": "CommonJS"'),
    ],
    [
      "root reference",
      "tsconfig.json",
      "rootTsconfig",
      (text) => text.replace('{ "path": "packages/foundation" },', ""),
    ],
    [
      "consumer dependency",
      "packages/adapters-local/package.json",
      "consumerManifest",
      (text) =>
        text.replace(
          '"@zintus-continuity/foundation": "workspace:*"',
          '"@zintus-continuity/foundation": "1.0.0"',
        ),
    ],
    [
      "consumer reference",
      "packages/adapters-local/tsconfig.json",
      "consumerTsconfig",
      (text) => text.replace('{ "path": "../foundation" }, ', ""),
    ],
    [
      "lock importer",
      "pnpm-lock.yaml",
      "lockfile",
      (text) =>
        text.replace("version: link:../foundation", "version: link:../alternate-foundation"),
    ],
  ])("rejects an updated hash for changed %s semantics", async (_name, relative, key, transform) => {
    const target = await fixture(false);
    const candidate = path.join(target.root, relative);
    const original = await readFile(candidate, "utf8");
    const changed = transform(original);
    expect(changed).not.toBe(original);
    await writeFile(candidate, changed);
    target.policy.ownedJsonPackageBridge.hashes[key] = digest(changed);
    await expect(
      scanSourceSecurity(target.root, target.policy, { sourceOnly: true }),
    ).rejects.toThrow(/package bridge semantics are invalid/u);
  });

  it.each([
    ["runtimeJs", buildInputs[0]],
    ["declarations", buildInputs[1]],
    ["declarationMap", buildInputs[2]],
  ])("rejects changed %s bytes even when the policy hash is updated", async (key, relative) => {
    const target = await fixture(true);
    const candidate = path.join(target.root, relative);
    const changed = `${await readFile(candidate, "utf8")}\n`;
    await writeFile(candidate, changed);
    target.policy.ownedJsonPackageBridge.hashes[key] = digest(changed);
    await expect(scanSourceSecurity(target.root, target.policy)).rejects.toThrow(
      /package bridge policy is invalid/u,
    );
  });

  it("does not extend the exact consumer grant to a sibling source file", async () => {
    const target = await fixture(false);
    const sibling = "packages/adapters-local/src/sibling.ts";
    await writeFile(
      path.join(target.root, sibling),
      'import { parseOwnedJson } from "@zintus-continuity/foundation/owned-json";\nparseOwnedJson("null", "small");\n',
    );
    const result = await scanSourceSecurity(target.root, target.policy, {
      sourceOnly: true,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        {
          path: sibling,
          rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
        },
        {
          path: sibling,
          rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        },
      ]),
    );
  });

  it.each([
    [
      "aliased import",
      (source) => source.replace("parseOwnedJson,", "parseOwnedJson as parseAlias,"),
    ],
    ["mutated binding", (source) => `${source}\nparseOwnedJson = () => null;\n`],
    [
      "stored alias",
      (source) =>
        source.replace(
          'parsed = parseOwnedJson(fixtureJsonValue, "small");',
          'const parser = parseOwnedJson;\n    parsed = parser(fixtureJsonValue, "small");',
        ),
    ],
    [
      "call wrapper",
      (source) =>
        source.replace(
          'parseOwnedJson(fixtureJsonValue, "small")',
          'parseOwnedJson.call(null, fixtureJsonValue, "small")',
        ),
    ],
    [
      "bind wrapper",
      (source) =>
        source.replace(
          'parsed = parseOwnedJson(fixtureJsonValue, "small");',
          'parsed = parseOwnedJson.bind(null)(fixtureJsonValue, "small");',
        ),
    ],
    [
      "Reflect.apply wrapper",
      (source) =>
        source.replace(
          'parsed = parseOwnedJson(fixtureJsonValue, "small");',
          'parsed = Reflect.apply(parseOwnedJson, null, [fixtureJsonValue, "small"]);',
        ),
    ],
    ["local re-export", (source) => `${source}\nexport { parseOwnedJson };\n`],
    [
      "dynamic import",
      (source) => `${source}\nvoid import("@zintus-continuity/foundation/owned-json");\n`,
    ],
    [
      "import equals",
      (source) =>
        `${source}\nimport owned = require("@zintus-continuity/foundation/owned-json");\nvoid owned;\n`,
    ],
    [
      "default import",
      (source) => `import owned from "@zintus-continuity/foundation/owned-json";\n${source}`,
    ],
    [
      "namespace import",
      (source) => `import * as owned from "@zintus-continuity/foundation/owned-json";\n${source}`,
    ],
    [
      "side-effect import",
      (source) => `import "@zintus-continuity/foundation/owned-json";\n${source}`,
    ],
    [
      "spread arguments",
      (source) =>
        source.replace(
          'parseOwnedJson(fixtureJsonValue, "small")',
          'parseOwnedJson(...[fixtureJsonValue, "small"])',
        ),
    ],
    [
      "optional call",
      (source) =>
        source.replace(
          'parseOwnedJson(fixtureJsonValue, "small")',
          'parseOwnedJson?.(fixtureJsonValue, "small")',
        ),
    ],
    [
      "wrong arity",
      (source) =>
        source.replace(
          'parseOwnedJson(fixtureJsonValue, "small")',
          "parseOwnedJson(fixtureJsonValue)",
        ),
    ],
    [
      "wrong profile",
      (source) =>
        source.replace(
          'parseOwnedJson(fixtureJsonValue, "small")',
          'parseOwnedJson(fixtureJsonValue, "contract")',
        ),
    ],
    [
      "laundered profile",
      (source) =>
        source.replace(
          'parsed = parseOwnedJson(fixtureJsonValue, "small");',
          'const profile = "small";\n    parsed = parseOwnedJson(fixtureJsonValue, profile);',
        ),
    ],
  ])("rejects %s", async (name, transform) => {
    const target = await fixture(false);
    await mutateConsumer(target, transform);
    if (name === "dynamic import" || name === "import equals") {
      const result = await scanSourceSecurity(target.root, target.policy, {
        sourceOnly: true,
      });
      expect(result.findings).toEqual(
        expect.arrayContaining([
          {
            path: consumerPath,
            rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
          },
          {
            path: consumerPath,
            rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
          },
        ]),
      );
      return;
    }
    await expect(
      scanSourceSecurity(target.root, target.policy, { sourceOnly: true }),
    ).rejects.toThrow(/OWNED_JSON_BRIDGE_/u);
  });

  it.each([
    "../../foundation/src/owned-json.js",
    "../../foundation/dist/owned-json.js",
    "../node_modules/@zintus-continuity/foundation/dist/owned-json.js",
    "@zintus-continuity/foundation/dist/owned-json.js",
    "@zintus-continuity/foundation/owned-json/lookalike",
  ])("does not declassify the alternate authority route %s", async (specifier) => {
    const target = await fixture(false);
    await mutateConsumer(
      target,
      (source) => `import * as alternate from "${specifier}";\nvoid alternate;\n${source}`,
    );
    const result = await scanSourceSecurity(target.root, target.policy, {
      sourceOnly: true,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        {
          path: consumerPath,
          rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
        },
        {
          path: consumerPath,
          rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        },
      ]),
    );
  });

  it("keeps implicit-only scope: independent computed and unsupported code remains visible", async () => {
    const target = await fixture(false);
    await mutateConsumer(
      target,
      (source) => `${source}\nconst unsafe = Reflect.get(input, unknownKey);\nvoid unsafe;\n`,
    );
    const result = await scanSourceSecurity(target.root, target.policy, {
      sourceOnly: true,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        {
          path: consumerPath,
          rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
        },
        {
          path: consumerPath,
          rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        },
      ]),
    );
  });
});
