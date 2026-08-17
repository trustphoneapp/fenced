import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { ownDataEntries, readOwnData, writeOwnData } from "../../scripts/safe-own-data.mjs";
import { mergeSyntheticRecords } from "../../scripts/synthetic-test-data.mjs";
import { scanSourceSecurity } from "../../scripts/verify-source-security.mjs";

const roots = [];
const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const replaceExactly = (source, before, after) => {
  if (source.split(before).length !== 2) throw new Error("mutation anchor must occur exactly once");
  const mutated = source.replace(before, after);
  if (mutated === source) throw new Error("mutation must change source");
  return mutated;
};
const configuration = {
  roots: ["src"],
  excludedPaths: ["src/generated"],
  extensions: [".cjs", ".cts", ".html", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"],
  maxDirectories: 64,
  maxEntries: 256,
  maxFiles: 8,
  maxFileBytes: 1024,
  maxTotalBytes: 4096,
  astBudgets: {
    maxAstDepth: 64,
    maxNodesPerFile: 2048,
    maxResolveStepsPerFile: 8192,
    maxTokenNesting: 64,
    maxTokensPerFile: 2048,
  },
  enumeratedNetworkSurface: {
    browser: [
      "EventSource",
      "WebSocket",
      "XMLHttpRequest",
      "XMLHttpRequest.open",
      "XMLHttpRequest.send",
      "fetch",
      "globalThis.fetch",
      "navigator.sendBeacon",
      "window.fetch",
    ],
    loaders: ["createRequire", "getBuiltinModule"],
    nodeBuiltins: ["dgram", "dns", "http", "https", "net", "tls"],
  },
  privilegedStaticImports: [
    {
      runtimeImporters: [{ path: "src/approved-a.ts", runtimeNames: ["approvedA"], typeNames: [] }],
      sourcePath: "src/internal/protected-a.ts",
      specifier: "@synthetic/application/internal/protected-a",
      testImporters: [],
    },
    {
      runtimeImporters: [{ path: "src/approved-b.ts", runtimeNames: ["approvedB"], typeNames: [] }],
      sourcePath: "src/internal/protected-b.ts",
      specifier: "@synthetic/application/internal/protected-b",
      testImporters: [],
    },
  ],
  htmlLexicalGate: {
    schemaVersion: 2,
    maxTagsPerFile: 64,
    maxAttributesPerTag: 16,
    maxTagCharacters: 2048,
    maxDecodePasses: 3,
    documentRoots: [{ pathPrefix: "src", assetRoot: "src" }],
    normalizedVariants: [
      "ascii-case-insensitive-names",
      "ascii-whitespace",
      "common-html-entities",
      "percent-decoding",
      "backslash-rejection",
      "ascii-control-scheme-folding",
      "decoded-rel-tokenization",
    ],
    rules: [
      "HTML_ACTIVE_URL_SCHEME",
      "HTML_EXTERNAL_RESOURCE_URL",
      "HTML_INLINE_EVENT_HANDLER",
      "HTML_INLINE_SCRIPT_BODY",
      "HTML_LOCAL_ASSET_POLICY",
      "HTML_SRCDOC",
      "HTML_UNSUPPORTED_HTML",
    ],
  },
  capabilityAllowlists: {
    child_process: [],
    computed_data_access: [],
    implicit_data_access: [],
    dynamic_code: [],
    dynamic_import: [],
    filesystem: [],
    network: [],
    process_env: [],
    unsupported_authority: [],
  },
};

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-b03-source-")));
  roots.push(root);
  await mkdir(path.join(root, "src"));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("B03 bounded source security", () => {
  const pythonFixture = async (source) => {
    const root = await fixture();
    await mkdir(path.join(root, "scripts"));
    const configured = structuredClone(configuration);
    configured.roots = ["scripts"];
    configured.excludedPaths = [];
    configured.extensions = configured.extensions.concat([".py"]);
    configured.maxFiles = 8;
    configured.maxFileBytes = 65536;
    configured.maxTotalBytes = 131072;
    configured.pythonSingleton = {
      path: "scripts/h02c-ci-inventory.py",
      sha256: createHash("sha256").update(source).digest("hex"),
    };
    await writeFile(path.join(root, configured.pythonSingleton.path), source);
    return { configured, root };
  };

  it("accepts only the exact reviewed singleton Python collector", async () => {
    const source = await readFile(path.join(repositoryRoot, "scripts/h02c-ci-inventory.py"));
    const { configured, root } = await pythonFixture(source);
    await expect(scanSourceSecurity(root, configured)).resolves.toMatchObject({
      files: 1,
      findings: [],
    });
  });

  it("denies a one-byte Python collector mutation", async () => {
    const source = await readFile(path.join(repositoryRoot, "scripts/h02c-ci-inventory.py"));
    const { configured, root } = await pythonFixture(source);
    await writeFile(
      path.join(root, configured.pythonSingleton.path),
      Buffer.concat([source, Buffer.from("\n")]),
    );
    expect((await scanSourceSecurity(root, configured)).findings).toContainEqual({
      path: "scripts/h02c-ci-inventory.py",
      rule: "PYTHON_SINGLETON_IDENTITY",
    });
  });

  it("denies a second discovered Python source", async () => {
    const source = await readFile(path.join(repositoryRoot, "scripts/h02c-ci-inventory.py"));
    const { configured, root } = await pythonFixture(source);
    await writeFile(path.join(root, "scripts/second.py"), "value = 1\n");
    const findings = (await scanSourceSecurity(root, configured)).findings;
    expect(findings).toContainEqual({
      path: "scripts/second.py",
      rule: "PYTHON_SINGLETON_IDENTITY",
    });
    expect(findings).toContainEqual({ path: "<root>", rule: "PYTHON_SINGLETON_CARDINALITY" });
  });

  it("retains lexical secret findings for the reviewed Python singleton", async () => {
    const secret = `A${"KIA"}${"A".repeat(16)}`;
    const source = Buffer.from(`value = "${secret}"\n`);
    const { configured, root } = await pythonFixture(source);
    const result = await scanSourceSecurity(root, configured);
    expect(result.findings).toEqual([
      { path: "scripts/h02c-ci-inventory.py", rule: "SECRET_AWS_ACCESS_KEY" },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("requires the single verify-supply-chain child-process allowance", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"),
    );
    const exact = policy.sourceSecurity.capabilityAllowlists.child_process;
    expect(exact.filter((entry) => entry === "scripts/verify-supply-chain.mjs")).toHaveLength(1);
    const accepted = await scanSourceSecurity(repositoryRoot, policy.sourceSecurity, {
      sourceOnly: true,
    });
    expect(accepted.findings).not.toContainEqual({
      path: "scripts/verify-supply-chain.mjs",
      rule: "SAST_CAPABILITY_CHILD_PROCESS",
    });
    const removed = structuredClone(policy.sourceSecurity);
    removed.capabilityAllowlists.child_process = exact.filter(
      (entry) => entry !== "scripts/verify-supply-chain.mjs",
    );
    expect(
      (await scanSourceSecurity(repositoryRoot, removed, { sourceOnly: true })).findings,
    ).toContainEqual({
      path: "scripts/verify-supply-chain.mjs",
      rule: "SAST_CAPABILITY_CHILD_PROCESS",
    });
  }, 30_000);

  it("accepts clean source and returns only content-free findings for a secret", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "src", "clean.js"), "export const safe = true;\n");
    expect((await scanSourceSecurity(root, configuration)).findings).toEqual([]);

    const secret = `A${"KIA"}${"A".repeat(16)}`;
    await writeFile(path.join(root, "src", "bad.js"), `export const value = "${secret}";\n`);
    const result = await scanSourceSecurity(root, configuration);
    expect(result.findings).toEqual([{ path: "src/bad.js", rule: "SECRET_AWS_ACCESS_KEY" }]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("discovers SQL as bounded non-executable text and scans secrets", async () => {
    const root = await fixture();
    const sqlConfiguration = structuredClone(configuration);
    sqlConfiguration.extensions = [...sqlConfiguration.extensions, ".sql"].sort();
    const sqlPath = path.join(root, "src", "schema.sql");
    await writeFile(sqlPath, "SELECT 'fetch(unsafe)' AS inert_text;\n");
    const clean = await scanSourceSecurity(root, sqlConfiguration);
    expect(clean).toMatchObject({ files: 1, findings: [] });

    const secret = `A${"KIA"}${"A".repeat(16)}`;
    await writeFile(sqlPath, `SELECT '${secret}';\n`);
    const secretResult = await scanSourceSecurity(root, sqlConfiguration);
    expect(secretResult.findings).toEqual([
      { path: "src/schema.sql", rule: "SECRET_AWS_ACCESS_KEY" },
    ]);
    expect(JSON.stringify(secretResult)).not.toContain(secret);

    sqlConfiguration.maxFileBytes = 8;
    await expect(scanSourceSecurity(root, sqlConfiguration)).rejects.toThrow(
      /^src\/schema\.sql:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED$/u,
    );
  });

  it("permits only the exact runtime and test C02 authority edges", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "src", "internal"));
    await mkdir(path.join(root, "tests"));
    const wrapper = "@zintus-continuity/application/internal/local-c02-authority-registrar";
    const registry = "@zintus-continuity/application/internal/tenant-authority-source-registry";
    const configured = structuredClone(configuration);
    configured.roots = ["src", "tests", "vitest.config.ts"];
    configured.maxDirectories = 128;
    configured.maxEntries = 512;
    configured.maxFiles = 96;
    configured.maxFileBytes = 4096;
    configured.maxTotalBytes = 65_536;
    configured.privilegedStaticImports = [
      {
        runtimeImporters: [
          {
            path: "src/adapter.ts",
            runtimeNames: ["registerLocalC02AuthoritySource"],
            typeNames: [],
          },
        ],
        sourcePath: "src/internal/local-c02-authority-registrar.ts",
        specifier: wrapper,
        testImporters: [
          {
            path: "tests/security.test.ts",
            runtimeNames: ["registerLocalC02AuthoritySource"],
            typeNames: [],
          },
        ],
      },
      {
        runtimeImporters: [
          {
            path: "src/tenant.ts",
            runtimeNames: ["lookupTenantAuthoritySourceState"],
            typeNames: ["TenantAuthoritySource", "TenantAuthoritySourceState"],
          },
          {
            path: "src/internal/local-c02-authority-registrar.ts",
            runtimeNames: ["registerLocalC02AuthoritySource"],
            typeNames: ["LocalC02AuthoritySourceRecord"],
          },
        ],
        sourcePath: "src/internal/tenant-authority-source-registry.ts",
        specifier: registry,
        testImporters: [],
      },
    ];
    await writeFile(
      path.join(root, "src", "adapter.ts"),
      `import { registerLocalC02AuthoritySource } from "${wrapper}";\nvoid registerLocalC02AuthoritySource;\n`,
    );
    await writeFile(
      path.join(root, "tests", "security.test.ts"),
      'import { registerLocalC02AuthoritySource } from "../src/internal/local-c02-authority-registrar.js";\nvoid registerLocalC02AuthoritySource;\n',
    );
    await writeFile(
      path.join(root, "src", "tenant.ts"),
      `import { lookupTenantAuthoritySourceState, type TenantAuthoritySource, type TenantAuthoritySourceState } from "${registry}";\nvoid lookupTenantAuthoritySourceState;\nvoid (undefined as unknown as TenantAuthoritySource);\nvoid (undefined as unknown as TenantAuthoritySourceState);\n`,
    );
    await writeFile(
      path.join(root, "src", "internal", "local-c02-authority-registrar.ts"),
      'import { type LocalC02AuthoritySourceRecord, registerLocalC02AuthoritySource } from "./tenant-authority-source-registry.js";\nexport { registerLocalC02AuthoritySource };\nexport type { LocalC02AuthoritySourceRecord };\n',
    );
    await writeFile(
      path.join(root, "src", "internal", "tenant-authority-source-registry.ts"),
      "export {};\n",
    );
    const exactVitestAlias = `import { fileURLToPath, URL } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default defineConfig({ resolve: { alias: { "${wrapper}": fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`;
    await writeFile(path.join(root, "vitest.config.ts"), exactVitestAlias);
    expect(
      (await scanSourceSecurity(root, configured)).findings.filter(
        ({ rule }) => rule === "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
      ),
    ).toEqual([]);

    const cleanroomTestPath = "tests/architecture/cleanroom-boundaries.test.ts";
    const cleanroomTest = path.join(root, cleanroomTestPath);
    await mkdir(path.dirname(cleanroomTest), { recursive: true });
    const cleanroomConfigured = structuredClone(configured);
    cleanroomConfigured.capabilityAllowlists.dynamic_import = [cleanroomTestPath];
    const cleanroomUrlLoads = [
      'void import(new URL("../../scripts/verify-cleanroom.mjs", import.meta.url).href);\n',
      `Reflect.set(globalThis, "URL", class { constructor() { return { href: "${wrapper}" }; } });\nvoid import(new URL("../../scripts/verify-cleanroom.mjs", import.meta.url).href);\n`,
      `Reflect.defineProperty(globalThis, "URL", { value: class { constructor() { return { href: "${wrapper}" }; } } });\nvoid import(new URL("../../scripts/verify-cleanroom.mjs", import.meta.url).href);\n`,
    ];
    for (const source of cleanroomUrlLoads) {
      await writeFile(cleanroomTest, source);
      expect((await scanSourceSecurity(root, cleanroomConfigured)).findings).toContainEqual({
        path: cleanroomTestPath,
        rule: "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
      });
    }
    await rm(cleanroomTest);

    const absoluteWrapper = path.join(root, "src", "internal", "local-c02-authority-registrar.js");
    const absoluteRegistry = path.join(
      root,
      "src",
      "internal",
      "tenant-authority-source-registry.js",
    );
    const wrapperFile = pathToFileURL(absoluteWrapper).href;
    const registryFile = pathToFileURL(absoluteRegistry).href;
    const wrapperDistFile = pathToFileURL(
      path.join(root, "dist", "internal", "local-c02-authority-registrar.js"),
    ).href;
    const registryDistFile = pathToFileURL(
      path.join(root, "dist", "internal", "tenant-authority-source-registry.js"),
    ).href;
    const localhostWrapper = wrapperFile.replace("file:///", "file://localhost/");
    const traversalWrapper = `${pathToFileURL(path.join(root, "src", "internal")).href}/../internal/local-c02-authority-registrar.js`;
    const violations = {
      "absolute.ts": `import { registerLocalC02AuthoritySource } from ${JSON.stringify(absoluteWrapper)};\nvoid registerLocalC02AuthoritySource;\n`,
      "aliased.ts": `import { registerLocalC02AuthoritySource as register } from "${wrapper}";\nvoid register;\n`,
      "computed.ts": `const registrar = "${wrapper}";\nvoid import(registrar);\n`,
      "direct-registry.ts": `import { registerLocalC02AuthoritySource } from "${registry}";\nvoid registerLocalC02AuthoritySource;\n`,
      "file-call-registry.ts": `const load = (value) => value;\nload("${registryFile}");\n`,
      "file-dynamic-wrapper.ts": `const registrar = "${wrapperFile}";\nvoid import(registrar);\n`,
      "file-localhost.ts": `void import("${localhostWrapper}");\n`,
      "file-malformed.ts": 'void import("file://%/local-c02-authority-registrar.js");\n',
      "file-noncanonical.ts": `void import("${wrapperFile.replace("file:///", "file:/")}");\n`,
      "file-outside.ts": `void import("${pathToFileURL(path.join(tmpdir(), "local-c02-authority-registrar.js")).href}");\n`,
      "file-percent.ts": `void import("${wrapperFile.replace("/internal/", "/%2e/internal/")}");\n`,
      "file-registry.ts": `import { registerLocalC02AuthoritySource } from "${registryDistFile}";\nvoid registerLocalC02AuthoritySource;\n`,
      "file-require-wrapper.ts": `require("${wrapperFile}");\n`,
      "file-reexport-registry.ts": `export { registerLocalC02AuthoritySource } from "${registryFile}";\n`,
      "file-traversal.ts": `void import("${traversalWrapper}");\n`,
      "file-wrapper.ts": `import { registerLocalC02AuthoritySource } from "${wrapperDistFile}";\nvoid registerLocalC02AuthoritySource;\n`,
      "file-excess-slashes.ts": `void import("${wrapperFile.replace("file:///", "file://///")}");\n`,
      "file-url-object.ts": `void import(new URL("${wrapperFile}"));\n`,
      "file-url-object-call.ts": `const load = (value) => value;\nload(new URL("${registryFile}"));\n`,
      "file-url-object-require.ts": `require(new URL("${wrapperFile}"));\n`,
      "import-equals.ts": `import registrar = require("${wrapper}");\nvoid registrar;\n`,
      "import-equals-query.ts": `import registrar = require("${wrapper}?bypass");\nvoid registrar;\n`,
      "loader.ts": `const load = (value) => value;\nload("${wrapper}");\n`,
      "namespace.ts": `import * as registrar from "${wrapper}";\nvoid registrar;\n`,
      "package-case.ts": `import { registerLocalC02AuthoritySource } from "${wrapper.toUpperCase()}";\nvoid registerLocalC02AuthoritySource;\n`,
      "package-fragment.ts": `export { registerLocalC02AuthoritySource } from "${registry}#bypass";\n`,
      "package-percent.ts": `void import("${wrapper.replace("local-c02", "%6cocal-c02")}");\n`,
      "package-query.ts": `import { registerLocalC02AuthoritySource } from "${registry}?bypass";\nvoid registerLocalC02AuthoritySource;\n`,
      "percent-malformed-call.ts": `const load = (value) => value;\nload("${registry.replaceAll("-", "%2d")}?%");\n`,
      "percent-malformed-dynamic.ts": `void import("${wrapper.replaceAll("-", "%2d")}?%");\n`,
      "percent-malformed-export.ts": `export { registerLocalC02AuthoritySource } from "${registry.replaceAll("-", "%2d")}#%";\n`,
      "percent-malformed-file.ts": `import "${registryFile.replaceAll("-", "%2d")}?%";\n`,
      "percent-malformed-file-hash.ts": `void import("${wrapperFile.replaceAll("-", "%2d")}#%");\n`,
      "percent-malformed-require.ts": `require("${wrapper.replaceAll("-", "%2d")}#%");\n`,
      "percent-residual-double.ts": `void import("${registry.replaceAll("-", "%252d")}?%");\n`,
      "percent-four-layer.ts": `void import("${registry.replaceAll("-", "%2525252d")}");\n`,
      "percent-malformed-sibling.ts":
        'void import("./%/internal/tenant%2dauthority%2dsource%2dregistry.js");\n',
      "relative.ts":
        'import { registerLocalC02AuthoritySource } from "./internal/local-c02-authority-registrar.js";\nvoid registerLocalC02AuthoritySource;\n',
      "relative-backslash.ts": 'require(".\\\\internal\\\\tenant-authority-source-registry.js");\n',
      "relative-case.ts":
        'import { registerLocalC02AuthoritySource } from "./INTERNAL/TENANT-AUTHORITY-SOURCE-REGISTRY.js";\nvoid registerLocalC02AuthoritySource;\n',
      "relative-fragment.ts":
        'export { registerLocalC02AuthoritySource } from "./internal/tenant-authority-source-registry.js#bypass";\n',
      "relative-percent-dot.ts":
        'void import("./internal/%2e/tenant-authority-source-registry.js");\n',
      "relative-percent-slash.ts":
        'void import("./internal%2ftenant-authority-source-registry.js");\n',
      "relative-query.ts":
        'import { registerLocalC02AuthoritySource } from "./internal/tenant-authority-source-registry.js?bypass";\nvoid registerLocalC02AuthoritySource;\n',
      "sequence-dynamic.ts": `void import((0, "${registry}"));\n`,
      "sequence-require.ts": `require(("ignored", "${wrapper}"));\n`,
      "conditional-dynamic.ts": `declare const choose: boolean;\nvoid import(choose ? "./safe.js" : "${registry}");\n`,
      "logical-loader.ts": `declare const choose: string;\nconst load = (value) => value;\nload(choose || "${wrapper}");\n`,
      "coercion-object.ts": `void import({ toString() { return "${wrapper}"; } } as unknown as string);\n`,
      "coercion-primitive.ts": `void import({ [Symbol.toPrimitive]() { return "${registry}"; } } as unknown as string);\n`,
      "coercion-array.ts": `void import(["${wrapper}"] as unknown as string);\n`,
      "coercion-call.ts": `declare function specifier(): string;\nvoid import(specifier());\n`,
      "coercion-new.ts": `declare class Specifier { toString(): string; }\nvoid import(new Specifier() as unknown as string);\n`,
      "coercion-property.ts": `declare const holder: { value: string };\nvoid import(holder.value);\n`,
      "coercion-element.ts": `declare const holder: Record<string, string>;\nvoid import(holder["value"]);\n`,
      "mutable-let.ts": `let target = "./safe.js";\ntarget = "${wrapper}";\nvoid import(target);\n`,
      "mutable-var.ts": `var target = "./safe.js";\ntarget = "${registry}";\nvoid import(target);\n`,
      "mutable-object.ts": `const target = { value: "./safe.js" };\ntarget.value = "${wrapper}";\nvoid import(target.value);\n`,
      "late-logical-branch.ts": `declare const alternatives: string[];\nvoid import(${Array.from({ length: 20 }, (_, index) => `alternatives[${index}]`).join(" || ")} || "${registry}");\n`,
      "unknown-loader-object.ts": `const load = (value) => value;\nload({ toString() { return "${wrapper}"; } });\n`,
      "template-identifier.ts": `const name = "tenant-authority-source-registry";\nvoid import(\`@zintus-continuity/application/internal/\${name}\`);\n`,
      "concat-identifier.ts": `const name = "tenant-authority-source-";\nrequire("@zintus-continuity/application/internal/" + name + "registry");\n`,
      "reexport.ts": `export type { LocalC02AuthoritySourceRecord } from "${wrapper}";\n`,
      "require.ts": `require("${wrapper}");\n`,
      "subpath.ts":
        'import { registerLocalC02AuthoritySource } from "@zintus-continuity/application/src/internal/local-c02-authority-registrar.js";\nvoid registerLocalC02AuthoritySource;\n',
    };
    for (const [name, source] of Object.entries(violations))
      await writeFile(path.join(root, "src", name), source);
    await writeFile(
      path.join(root, "tests", "direct-registry.test.ts"),
      `import { registerLocalC02AuthoritySource } from "${registry}";\nvoid registerLocalC02AuthoritySource;\n`,
    );
    const boundaryFindings = (await scanSourceSecurity(root, configured)).findings.filter(
      ({ rule }) => rule === "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
    );
    expect(boundaryFindings).toEqual(
      [...Object.keys(violations).map((name) => `src/${name}`), "tests/direct-registry.test.ts"]
        .sort()
        .map((name) => ({
          path: name,
          rule: "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
        })),
    );

    const vitestLaundering = [
      `import { fileURLToPath, URL as NativeURL } from "node:url";\nimport { defineConfig } from "vitest/config";\nclass URL { constructor(_approved, base) { return new NativeURL("./src/internal/tenant-authority-source-registry.ts", base); } }\nexport default defineConfig({ resolve: { alias: { "${wrapper}": fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default defineConfig({ resolve: { alias: { "${wrapper}": fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath, URL as NativeURL } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default defineConfig({ resolve: { alias: { "${wrapper}": fileURLToPath(new NativeURL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath as convert, URL } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default defineConfig({ resolve: { alias: { "${wrapper}": convert(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath, URL } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default { resolve: { alias: { "${wrapper}": fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } };\n`,
      `import { fileURLToPath, URL } from "node:url";\nimport { defineConfig } from "vitest/config";\nconst extra = {};\nexport default defineConfig({ resolve: { alias: { ...extra, "${wrapper}": fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath, URL } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default defineConfig({ resolve: { alias: { ["${wrapper}"]: fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath, URL } from "node:url";\nimport { defineConfig } from "vitest/config";\nexport default defineConfig({ resolve: { alias: { "${wrapper}": "safe", "${wrapper}": fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) } } });\n`,
      `import { fileURLToPath } from "node:url";\nvoid import(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url));\n`,
      `import { fileURLToPath } from "node:url";\nrequire(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url));\n`,
      `import { fileURLToPath } from "node:url";\nconst load = (value) => value;\nload(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url));\n`,
      `import { fileURLToPath } from "node:url";\nconst target = new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url);\nfileURLToPath(target);\n`,
      `import { fileURLToPath } from "node:url";\nconst wrap = (value) => value;\nwrap(fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)));\n`,
      `import { fileURLToPath } from "node:url";\nvoid [fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url))];\n`,
      `import { fileURLToPath } from "node:url";\nexport default { value: fileURLToPath(new URL("./src/internal/local-c02-authority-registrar.ts", import.meta.url)) };\n`,
      `import { fileURLToPath } from "node:url";\nexport default { resolve: { alias: { "${wrapper}": fileURLToPath(new URL(\`./src/internal/local-c02-authority-registrar.ts\`, import.meta.url)) } } };\n`,
      `import { fileURLToPath } from "node:url";\nexport default { resolve: { alias: { "${wrapper}": fileURLToPath(new URL("./src/internal/" + "local-c02-authority-registrar.ts", import.meta.url)) } } };\n`,
    ];
    for (const source of vitestLaundering) {
      await writeFile(path.join(root, "vitest.config.ts"), source);
      expect((await scanSourceSecurity(root, configured)).findings).toContainEqual({
        path: "vitest.config.ts",
        rule: "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
      });
    }
    await writeFile(path.join(root, "vitest.config.ts"), exactVitestAlias);

    await writeFile(
      path.join(root, "src", "adapter.ts"),
      `import { registerLocalC02AuthoritySource as register } from "${wrapper}";\nvoid register;\n`,
    );
    expect(
      (await scanSourceSecurity(root, configured)).findings.filter(
        ({ path: relative, rule }) =>
          relative === "src/adapter.ts" && rule === "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
      ),
    ).toEqual([{ path: "src/adapter.ts", rule: "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY" }]);

    const invalidPolicies = [
      (policy) => {
        delete policy.privilegedStaticImports;
      },
      (policy) => {
        policy.privilegedStaticImports = undefined;
      },
      (policy) => {
        policy.privilegedStaticImports = [];
      },
      (policy) => {
        policy.privilegedStaticImports[0].sourcePath =
          "src/internal/../internal/local-c02-authority-registrar.ts";
      },
      (policy) => {
        policy.privilegedStaticImports[0].sourcePath =
          "src\\internal\\local-c02-authority-registrar.ts";
      },
      (policy) => {
        policy.privilegedStaticImports[0].sourcePath = absoluteWrapper;
      },
      (policy) => {
        policy.privilegedStaticImports[0].sourcePath = wrapperFile;
      },
      (policy) => {
        policy.privilegedStaticImports[0].sourcePath =
          "src/internal/%2e/local-c02-authority-registrar.ts";
      },
      (policy) => {
        policy.privilegedStaticImports.push(structuredClone(policy.privilegedStaticImports[0]));
      },
      (policy) => {
        policy.privilegedStaticImports[0].specifier =
          "@zintus-continuity/application/internal/../internal/local-c02-authority-registrar";
      },
      (policy) => {
        policy.privilegedStaticImports[0].specifier =
          "@zintus-continuity\\application\\internal\\local-c02-authority-registrar";
      },
      (policy) => {
        policy.privilegedStaticImports[0].specifier = "/absolute/registrar";
      },
      (policy) => {
        policy.privilegedStaticImports[0].specifier = wrapperFile;
      },
      (policy) => {
        policy.privilegedStaticImports[0].specifier =
          "@zintus-continuity/application/internal/%2e/registrar";
      },
      (policy) => {
        policy.privilegedStaticImports[1].specifier = policy.privilegedStaticImports[0].specifier;
      },
      (policy) => {
        policy.privilegedStaticImports[1].specifier =
          "@zintus-continuity/application/src/internal/local-c02-authority-registrar";
      },
      (policy) => {
        policy.privilegedStaticImports[0].specifier =
          "@zintus-continuity/application/internal/foobar";
        policy.privilegedStaticImports[0].sourcePath = "src/bar.ts";
      },
      (policy) => {
        policy.privilegedStaticImports[0].sourcePath =
          "src/internal/src/local-c02-authority-registrar.ts";
      },
      (policy) => {
        policy.privilegedStaticImports[1].sourcePath =
          "SRC/internal/local-c02-authority-registrar.ts";
        policy.privilegedStaticImports[1].specifier =
          "@independent/package/internal/local-c02-authority-registrar";
      },
      (policy) => {
        policy.privilegedStaticImports[1].sourcePath =
          "@zintus-continuity/application/src/internal/local-c02-authority-registrar.ts";
        policy.privilegedStaticImports[1].specifier =
          "@independent/package/internal/local-c02-authority-registrar";
      },
    ];
    for (const mutate of invalidPolicies) {
      const invalid = structuredClone(configured);
      mutate(invalid);
      await expect(scanSourceSecurity(root, invalid)).rejects.toThrow(
        "source-security privileged static import policy is invalid",
      );
    }
  });

  it("rejects symlinks before exclusion and enforces file budgets", async () => {
    const root = await fixture();
    const external = await fixture();
    await symlink(path.join(external, "src"), path.join(root, "src", "generated"), "dir");
    await expect(scanSourceSecurity(root, configuration)).rejects.toThrow(
      /^src\/generated:SOURCE_SECURITY_SYMLINK_PROHIBITED$/u,
    );

    await rm(path.join(root, "src", "generated"), { recursive: true });
    await writeFile(path.join(root, "src", "large.js"), "x".repeat(1025));
    await expect(scanSourceSecurity(root, configuration)).rejects.toThrow(
      /^src\/large\.js:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED$/u,
    );

    const missingFailure = await scanSourceSecurity(
      root,
      mergeSyntheticRecords(configuration, { roots: ["missing"] }),
    ).catch((error) => error);
    expect(missingFailure.message).toBe("missing:SOURCE_SECURITY_LSTAT_FAILED");
    expect(missingFailure.message).not.toContain(root);
  });

  it("stops the exact invocation-owned .worktrees exclusion after boundary lstat", async () => {
    const root = await fixture();
    const worktrees = path.join(root, ".worktrees");
    await mkdir(worktrees);
    const secret = `A${"KIA"}${"A".repeat(16)}`;
    await writeFile(
      path.join(worktrees, "synthetic-child.js"),
      `export const value = "${secret}";\n`,
    );
    const exact = structuredClone(configuration);
    exact.roots = ["."];
    exact.excludedPaths = [".worktrees"];

    const excluded = await scanSourceSecurity(root, exact);
    expect(excluded.findings).toEqual([]);
    expect(excluded.files).toBe(0);

    for (const excludedPaths of [[], [".worktree"]]) {
      const visible = structuredClone(exact);
      visible.excludedPaths = excludedPaths;
      expect((await scanSourceSecurity(root, visible)).findings).toContainEqual({
        path: ".worktrees/synthetic-child.js",
        rule: "SECRET_AWS_ACCESS_KEY",
      });
    }

    await rm(worktrees, { recursive: true });
    const external = await fixture();
    await symlink(path.join(external, "src"), worktrees, "dir");
    await expect(scanSourceSecurity(root, exact)).rejects.toThrow(
      /^\.worktrees:SOURCE_SECURITY_SYMLINK_PROHIBITED$/u,
    );
  });

  it("detects bounded AST capabilities without exposing source content", async () => {
    const cases = [
      {
        name: "baseline",
        source: [
          'import child = require("node:child_process");',
          "const req = require;",
          'const { writeFile } = req("node:fs/promises");',
          'import("dynamic-module");',
          "const environment = process['env'];",
          "const authority = process;",
          "authority[computedProperty];",
          "const networkAlias = fetch;",
          "const { fetch: destructuredFetch } = globalThis;",
          'networkAlias("https://example.invalid");',
          'destructuredFetch("https://example.invalid");',
          "const evaluator = eval;",
          "(0, evaluator)('synthetic');",
          "const constructorAlias = Function;",
          "constructorAlias('return 1');",
          "new constructorAlias('return 1');",
          "child.spawn('synthetic');",
          "writeFile('synthetic', 'value');",
          "void environment;",
        ].join("\n"),
        rules: [
          "SAST_CAPABILITY_CHILD_PROCESS",
          "SAST_CAPABILITY_DYNAMIC_IMPORT",
          "SAST_CAPABILITY_FILESYSTEM",
          "SAST_CAPABILITY_NETWORK",
          "SAST_CAPABILITY_PROCESS_ENV",
          "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        ],
      },
      {
        name: "higher-order",
        source: "const capture = (value) => () => value;\ncapture(eval);\n",
        rules: ["SAST_CAPABILITY_DYNAMIC_CODE", "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
      },
      {
        name: "reflect-get",
        source: 'Reflect.get(globalThis, "fetch");\n',
        rules: ["SAST_CAPABILITY_NETWORK", "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
      },
      {
        name: "reflect-apply",
        source: 'Reflect.apply(eval, null, ["synthetic"]);\n',
        rules: ["SAST_CAPABILITY_DYNAMIC_CODE", "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
      },
      {
        name: "array-global",
        source: "const carried = [globalThis];\nvoid carried;\n",
        rules: ["SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
      },
      {
        name: "process-get-builtin",
        source: 'process.getBuiltinModule("node:fs");\n',
        rules: ["SAST_CAPABILITY_FILESYSTEM"],
      },
      {
        name: "global-this-process-get-builtin",
        source: 'globalThis.process.getBuiltinModule("node:child_process");\n',
        rules: ["SAST_CAPABILITY_CHILD_PROCESS"],
      },
      {
        name: "aliased-global-process-get-builtin",
        source: [
          "const globalAlias = global;",
          "const processAlias = globalAlias.process;",
          "const builtinAlias = processAlias.getBuiltinModule;",
          'builtinAlias("node:https");',
        ].join("\n"),
        rules: ["SAST_CAPABILITY_NETWORK"],
      },
      {
        name: "create-require",
        source: [
          'import { createRequire as makeRequire } from "node:module";',
          "const localRequire = makeRequire(import.meta.url);",
          'localRequire("node:fs");',
        ].join("\n"),
        rules: ["SAST_CAPABILITY_FILESYSTEM", "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
      },
      {
        name: "property-and-element-assignment",
        source: [
          "const holder = {};",
          "holder.callback = fetch;",
          'holder.callback("https://example.invalid");',
          "holder['evaluator'] = eval;",
          "holder.evaluator('synthetic');",
          "holder.authorityName = 'fetch';",
        ].join("\n"),
        rules: [
          "SAST_CAPABILITY_DYNAMIC_CODE",
          "SAST_CAPABILITY_NETWORK",
          "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        ],
      },
      {
        name: "parameter-defaults",
        source: [
          'function invoke(callback = fetch) { callback("https://example.invalid"); }',
          "const construct = (builder = Function) => builder('return 1');",
          "function named(value = 'fetch') { return value; }",
          "void invoke;",
          "void construct;",
          "void named;",
        ].join("\n"),
        rules: [
          "SAST_CAPABILITY_DYNAMIC_CODE",
          "SAST_CAPABILITY_NETWORK",
          "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        ],
      },
      {
        name: "xml-http-request",
        source: [
          "const request = new XMLHttpRequest();",
          'request.open("POST", "https://example.invalid");',
          "request.send('synthetic');",
          "const WindowRequest = window['XMLHttpRequest'];",
          "new WindowRequest();",
        ].join("\n"),
        rules: ["SAST_CAPABILITY_NETWORK", "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
      },
      {
        name: "enumerated-browser-network",
        source: [
          'new EventSource("https://example.invalid");',
          'new WebSocket("wss://example.invalid");',
          'navigator.sendBeacon("https://example.invalid", "synthetic");',
          'window.fetch("https://example.invalid");',
          'globalThis.fetch("https://example.invalid");',
        ].join("\n"),
        rules: ["SAST_CAPABILITY_NETWORK"],
      },
    ];
    for (const testCase of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${testCase.name}.ts`), testCase.source);
      const result = await scanSourceSecurity(root, configuration);
      expect(result.findings.map(({ rule }) => rule)).toEqual(
        expect.arrayContaining(testCase.rules),
      );
      expect(JSON.stringify(result)).not.toContain("example.invalid");
    }
  });

  it("fails closed across transported dynamic-authority families", async () => {
    const cases = [
      [
        "extracted-alias",
        'const keyBox = { key: "constructor" }; const Dynamic = (() => {})[keyBox.key]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "assigned-alias",
        'let Dynamic; Dynamic = (() => {})[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "stored-carrier",
        'const box = { value: (() => {})[unknownKey] }; box.value("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "array-carrier",
        'const box = [(() => {})[unknownKey]]; box[0]("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "returned-authority",
        'const get = () => (() => {})[unknownKey]; get()("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "descriptor-method-alias",
        'const O = Object; const descriptor = O.getOwnPropertyDescriptor; const key = holder.key; const Dynamic = descriptor(Object.getPrototypeOf(() => {}), key).value; Dynamic("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "function-constructor",
        'const Dynamic = (() => {})["con" + "structor"]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "async-function-constructor",
        'const Dynamic = (async () => {})[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "generator-constructor",
        'const Dynamic = (function* () {})[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "async-generator-constructor",
        'const Dynamic = (async function* () {})[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "prototype-chain",
        'const Dynamic = Object.getPrototypeOf(() => {})[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "dunder-prototype-chain",
        'const Dynamic = (() => {}).__proto__[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "call-apply-bind-chain",
        'const Dynamic = (() => {}).bind[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "reflect-unknown",
        'const Dynamic = Reflect.get(() => {}, unknownKey); Dynamic("x")();',
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
      [
        "wrapped-call",
        '((((() => {})[unknownKey]) as unknown)!)("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "wrapped-new",
        'new (((() => {})[unknownKey]) satisfies unknown)("x");',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      ["wrapped-tag", "((0, (() => {})[unknownKey]))`x`;", "SAST_CAPABILITY_DYNAMIC_CODE"],
      [
        "conditional-wrapper",
        'const Dynamic = flag ? (() => {})[unknownKey] : (() => {}); Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "logical-wrapper",
        'const Dynamic = flag && (() => {})[unknownKey]; Dynamic("x")();',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "catch-does-not-shadow-outer-ambient",
        "try {} catch (process) { void process; } void process.env;",
        "SAST_CAPABILITY_PROCESS_ENV",
      ],
    ];
    for (const [name, source, rule] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const result = await scanSourceSecurity(root, configuration);
      expect(result.findings).toContainEqual({ path: `src/${name}.ts`, rule });
      expect(JSON.stringify(result)).not.toContain("unknownKey");
    }
  });

  it("fails closed on R8 mutable, laundered, and receiver-independent computed keys", async () => {
    const cases = [
      ["index-mutation", 'const keys = ["safe"]; keys[0] = "constructor"; target[keys[0]];'],
      [
        "destructure-mutation",
        'const box = { key: "safe" }; ({ key: box.key } = { key: "constructor" }); target[box.key];',
      ],
      [
        "reflect-set-mutation",
        'const box = { key: "safe" }; Reflect.set(box, "key", "constructor"); target[box.key];',
      ],
      [
        "object-assign-mutation",
        'const box = { key: "safe" }; Object.assign(box, { key: "constructor" }); target[box.key];',
      ],
      ["class-receiver", "class Box {} new Box()[unknownKey];"],
      ["container-receiver", "({ safe: 1 })[unknownKey]; [1][unknownKey];"],
      ["call-return-receiver", "makeValue()[unknownKey];"],
      ["import-receiver", 'import("synthetic")[unknownKey];'],
      ["proxy-revocable-receiver", "Proxy.revocable({}, {})[unknownKey];"],
      ["dangerous-wrapper-return", 'const key = () => "constructor"; (() => {})[key()];'],
    ];
    for (const [name, source] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const result = await scanSourceSecurity(root, configuration);
      expect(result.findings).toContainEqual({
        path: `src/${name}.ts`,
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      });
    }

    const root = await fixture();
    await writeFile(
      path.join(root, "src", "benign.ts"),
      'const direct = "safe"; const alias = direct; target[alias]; target[`sa$' +
        '{"fe"}`]; target[1];',
    );
    expect((await scanSourceSecurity(root, configuration)).findings).toEqual([]);
  });

  it("classifies R10 unknown property and implicit-read families independently", async () => {
    const cases = [
      [
        "reflect-get",
        "Reflect.get(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "reflect-descriptor",
        "Reflect.getOwnPropertyDescriptor(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "reflect-define",
        "Reflect.defineProperty(target, unknownKey, { value: 1 });",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "reflect-set",
        "Reflect.set(target, unknownKey, 1);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "reflect-delete",
        "Reflect.deleteProperty(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "reflect-has",
        "Reflect.has(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "object-descriptor",
        "Object.getOwnPropertyDescriptor(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "object-define",
        "Object.defineProperty(target, unknownKey, { value: 1 });",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "optional-reflect",
        "Reflect.get?.(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "wrapped-reflect",
        "(Reflect.get)(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "aliased-reflect",
        "const read = Reflect.get; read(target, unknownKey);",
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      ["plural-descriptor", "Object.getOwnPropertyDescriptors(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["plural-define", "Object.defineProperties(target, descriptors);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-values", "Object.values(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-entries", "Object.entries(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-assign", "Object.assign(target, source);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-keys", "Object.keys(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-names", "Object.getOwnPropertyNames(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-symbols", "Object.getOwnPropertySymbols(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["reflect-own-keys", "Reflect.ownKeys(target);", ["IMPLICIT_DATA_ACCESS"]],
      ["object-has-own", 'Object.hasOwn(target, "safe");', ["IMPLICIT_DATA_ACCESS"]],
      [
        "object-has-own-unknown",
        "Object.hasOwn(target, unknownKey);",
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "aliased-has-own-unknown",
        "const has = Object.hasOwn; has(target, unknownKey);",
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      ["object-spread", "const copied = { ...target }; void copied;", ["IMPLICIT_DATA_ACCESS"]],
      ["array-spread", "const copied = [...target]; void copied;", ["IMPLICIT_DATA_ACCESS"]],
      [
        "external-object-spread",
        "const source = external(); const copied = { ...source }; void copied;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "aliased-external-array-spread",
        "const source = external(); const alias = source; const copied = [...alias]; void copied;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "conditional-object-accessor-injection",
        "const source = flag ? {} : {}; Object.defineProperty(source, 'x', { get: external }); const copied = { ...source }; void copied;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "object-rest",
        "const { safe, ...rest } = target; void safe; void rest;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "array-rest",
        "const [safe, ...rest] = target; void safe; void rest;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      ["for-in", "for (const key in target) void key;", ["IMPLICIT_DATA_ACCESS"]],
    ];
    for (const [name, source, capabilities] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const rules = (await scanSourceSecurity(root, configuration)).findings.map(
        ({ rule }) => rule,
      );
      for (const capability of capabilities) {
        expect(rules, name).toContain(`SAST_CAPABILITY_${capability}`);
      }
    }
  });

  it("classifies R11 JSX spreads and computed names without extension gaps", async () => {
    for (const extension of [".jsx", ".tsx"]) {
      const root = await fixture();
      await writeFile(
        path.join(root, "src", `jsx-spread${extension}`),
        "export const x = <div {...incoming} />;",
      );
      expect((await scanSourceSecurity(root, configuration)).findings).toContainEqual({
        path: `src/jsx-spread${extension}`,
        rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      });
    }

    const extensionSource =
      "const incoming = external(); const key = incoming; void ({ [key]: 1 });";
    for (const extension of [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `computed${extension}`), extensionSource);
      const rules = (await scanSourceSecurity(root, configuration)).findings.map(
        ({ rule }) => rule,
      );
      expect(rules).toContain("SAST_CAPABILITY_COMPUTED_DATA_ACCESS");
      expect(rules).toContain("SAST_CAPABILITY_UNSUPPORTED_AUTHORITY");
    }

    const forms = [
      "void ({ [key]: 1 });",
      "void ({ [key]() { return 1; } });",
      "void ({ get [key]() { return 1; } });",
      "void ({ set [key](value) { void value; } });",
      "class Property { [key] = 1; } void Property;",
      "class Method { [key]() { return 1; } } void Method;",
      "class Getter { get [key]() { return 1; } } void Getter;",
      "class Setter { set [key](value) { void value; } } void Setter;",
      "let target; ({ [key]: target } = source); void target;",
    ];
    for (const [index, form] of forms.entries()) {
      const root = await fixture();
      const source = `declare const incoming: object; const alias = incoming; const key = (alias as object); ${form}`;
      await writeFile(path.join(root, "src", `form-${index}.ts`), source);
      const rules = (await scanSourceSecurity(root, configuration)).findings.map(
        ({ rule }) => rule,
      );
      expect(rules).toContain("SAST_CAPABILITY_COMPUTED_DATA_ACCESS");
      expect(rules).toContain("SAST_CAPABILITY_UNSUPPORTED_AUTHORITY");
    }

    const root = await fixture();
    await writeFile(
      path.join(root, "src", "coercion.ts"),
      'void ({ [{ toString() { return "key"; } }]: 1 });',
    );
    const coercionRules = (await scanSourceSecurity(root, configuration)).findings.map(
      ({ rule }) => rule,
    );
    expect(coercionRules).toContain("SAST_CAPABILITY_COMPUTED_DATA_ACCESS");
    expect(coercionRules).toContain("SAST_CAPABILITY_UNSUPPORTED_AUTHORITY");

    const safeRoot = await fixture();
    await writeFile(
      path.join(safeRoot, "src", "safe-computed.ts"),
      'declare const brand: unique symbol; type Branded = { readonly [brand]: "safe" }; interface Signature { [brand](): void; } const direct = "safe"; const alias = (direct as string); void ({ [alias]: 1 }); class Safe { [`field`] = 1; } void Safe; void (0 as unknown as Branded); void (0 as unknown as Signature);',
    );
    expect((await scanSourceSecurity(safeRoot, configuration)).findings).toEqual([]);
  });

  it("classifies R11 implicit iterator consumers through direct, aliased, and wrapped calls", async () => {
    const cases = [
      ["yield-star", "function* values() { yield* input; } void values;", ["IMPLICIT_DATA_ACCESS"]],
      ["array-from", "Array.from(input);", ["IMPLICIT_DATA_ACCESS"]],
      ["array-from-alias", "const consume = Array.from; consume(input);", ["IMPLICIT_DATA_ACCESS"]],
      [
        "object-from-entries",
        "Object.fromEntries(input);",
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "object-from-entries-wrapped",
        "(Object.fromEntries)(input);",
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "array-from-holder",
        "const holder = { consume: Array.from }; holder.consume(input);",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "array-from-call",
        "Array.from.call(null, input);",
        ["IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "object-from-entries-holder",
        "const holder = [Object.fromEntries]; holder[0](input);",
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "object-from-entries-reflect-apply",
        "Reflect.apply(Object.fromEntries, null, [input]);",
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "safe-own-package-alias",
        'import { ownDataKeys } from "@zintus-continuity/foundation/safe-data-access"; const consume = ownDataKeys; consume(input);',
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "safe-own-mutated-import",
        'import { ownDataKeys } from "@zintus-continuity/foundation/safe-data-access"; if (false) ownDataKeys = () => []; ownDataKeys(input);',
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "safe-own-call-wrapper",
        'import { ownDataKeys } from "@zintus-continuity/foundation/safe-data-access"; ownDataKeys.call(null, input);',
        ["IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "safe-own-namespace",
        'import * as safe from "@zintus-continuity/foundation/safe-data-access"; safe.ownDataKeys(input);',
        ["IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "safe-own-dynamic-namespace",
        'async function consume() { const safe = await import("@zintus-continuity/foundation/safe-data-access"); safe.ownDataKeys(input); }',
        ["DYNAMIC_IMPORT", "IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "safe-own-reexport",
        'export { ownDataKeys } from "@zintus-continuity/foundation/safe-data-access";',
        ["UNSUPPORTED_AUTHORITY"],
      ],
      [
        "owned-json-static-import",
        'import { parseOwnedJson } from "@zintus-continuity/foundation/owned-json"; parseOwnedJson(input, "small");',
        ["IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "owned-json-dynamic-import",
        'async function consume() { await import("@zintus-continuity/foundation/owned-json"); }',
        ["DYNAMIC_IMPORT", "IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "owned-json-reexport",
        'export { parseOwnedJson } from "@zintus-continuity/foundation/owned-json";',
        ["IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "owned-json-import-equals",
        'import owned = require("@zintus-continuity/foundation/owned-json"); void owned;',
        ["IMPLICIT_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
    ];
    for (const [name, source, capabilities] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const rules = (await scanSourceSecurity(root, configuration)).findings.map(
        ({ rule }) => rule,
      );
      for (const capability of capabilities) {
        expect(rules, name).toContain(`SAST_CAPABILITY_${capability}`);
      }
    }
    const typeOnlyRoot = await fixture();
    await writeFile(
      path.join(typeOnlyRoot, "src", "owned-json-type-only.ts"),
      'import type { OwnedJson } from "@zintus-continuity/foundation/owned-json"; type Alias = OwnedJson;',
    );
    expect((await scanSourceSecurity(typeOnlyRoot, configuration)).findings).toEqual([]);
  });

  it("classifies R11 adjacent iterator, thenable, destructuring, and key-coercion execution", async () => {
    const cases = [
      ["for-of", "for (const value of input) void value;", ["IMPLICIT_DATA_ACCESS"]],
      [
        "for-await-of",
        "async function consume() { for await (const value of input) void value; }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-external",
        "async function consume() { await external(); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-method-thenable",
        "async function consume() { await { then() {} }; }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-property-thenable",
        "async function consume() { await { then: external }; }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-getter-thenable",
        "async function consume() { await { get then() { return external; } }; }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-mutated-async-alias",
        "async function local() { return 1; } let selected = local; selected = external; async function consume() { await selected(); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-mixed-conditional",
        "async function consume() { await (flag ? Promise.resolve(1) : external()); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-poisoned-promise-static",
        "Promise.resolve = external; async function consume() { await Promise.resolve(1); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-defined-promise-static",
        'Object.defineProperty(Promise, "resolve", { value: external }); async function consume() { await Promise.resolve(1); }',
        ["IMPLICIT_DATA_ACCESS"],
      ],
      ["new-promise-executor", "new Promise(external);", ["IMPLICIT_DATA_ACCESS"]],
      ["promise-try-callback", "Promise.try(external);", ["IMPLICIT_DATA_ACCESS"]],
      [
        "await-promise-with-resolvers",
        "async function consume() { await Promise.withResolvers(); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-escaped-promise",
        "const box = { Promise }; async function consume() { await Promise.resolve(1); } void box;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-deleted-promise-static",
        "delete Promise.resolve; async function consume() { await Promise.resolve(1); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-set-promise-prototype",
        "Object.setPrototypeOf(Promise, external); async function consume() { await Promise.resolve(1); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-aliased-promise-mutator",
        'const mutate = Object.defineProperty; mutate(Promise, "resolve", { value: external }); async function consume() { await Promise.resolve(1); }',
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "async-return-thenable",
        "async function consume() { return external(); } void consume;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "async-concise-return-thenable",
        "const consume = async () => external(); void consume;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "await-proof-lost-wrapper",
        "function wrapped() { return Promise.resolve(1); } async function consume() { await wrapped(); }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      ["array-binding", "const [value] = input; void value;", ["IMPLICIT_DATA_ACCESS"]],
      ["object-binding", "const { value } = input; void value;", ["IMPLICIT_DATA_ACCESS"]],
      ["array-assignment", "let value; [value] = input; void value;", ["IMPLICIT_DATA_ACCESS"]],
      [
        "object-assignment",
        "let value; ({ value } = input); void value;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      ["promise-all", "Promise.all(input);", ["IMPLICIT_DATA_ACCESS"]],
      ["promise-resolve", "Promise.resolve(input);", ["IMPLICIT_DATA_ACCESS"]],
      ["promise-resolve-thenable", "Promise.resolve({ then() {} });", ["IMPLICIT_DATA_ACCESS"]],
      [
        "promise-all-thenable",
        "Promise.all([{ then() {} }]); Promise.allSettled([{ get then() { return external; } }]); Promise.any([{ then: external }]); Promise.race([{ then() {} }]);",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      ["map-constructor", "new Map(input);", ["IMPLICIT_DATA_ACCESS"]],
      ["set-constructor", "new Set(input);", ["IMPLICIT_DATA_ACCESS"]],
      ["weak-map-constructor", "new WeakMap(input);", ["IMPLICIT_DATA_ACCESS"]],
      ["weak-set-constructor", "new WeakSet(input);", ["IMPLICIT_DATA_ACCESS"]],
      [
        "array-parameter",
        "function consume([value]) { return value; } void consume;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "object-parameter",
        "const consume = ({ value }) => value; void consume;",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "catch-pattern",
        "try { external(); } catch ({ message }) { void message; }",
        ["IMPLICIT_DATA_ACCESS"],
      ],
      [
        "from-entries-coercive-key",
        'Object.fromEntries([[{ toString() { return "x"; } }, 1]]);',
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "from-entries-value-of-key",
        'Object.fromEntries([[{ valueOf() { return "x"; } }, 1]]);',
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "from-entries-symbol-coercion-key",
        'Object.fromEntries([[{ [Symbol.toPrimitive]() { return "x"; } }, 1]]);',
        ["IMPLICIT_DATA_ACCESS", "COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      [
        "yield-throw-authority",
        "function* values() { yield globalThis; } function fail() { throw globalThis; } void values; void fail;",
        ["UNSUPPORTED_AUTHORITY"],
      ],
      [
        "in-coercive-key",
        'const key = { toString() { return "x"; } }; void (key in {});',
        ["COMPUTED_DATA_ACCESS", "UNSUPPORTED_AUTHORITY"],
      ],
      ["in-unknown-target", 'void ("safe" in input);', ["IMPLICIT_DATA_ACCESS"]],
    ];
    for (const [name, source, capabilities] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const rules = (await scanSourceSecurity(root, configuration)).findings.map(
        ({ rule }) => rule,
      );
      for (const capability of capabilities) {
        expect(rules).toContain(`SAST_CAPABILITY_${capability}`);
      }
    }

    const safeRoot = await fixture();
    await writeFile(
      path.join(safeRoot, "src", "safe-adjacent.ts"),
      'import { Promise as LocalPromise } from "./types.js"; type PromiseType = typeof Promise; async function settled() { return 1; } async function safe() { await 1; await settled(); await Promise.resolve(1); } const record = { Promise: 1 }; Promise.resolve(); Promise.resolve(1); Object.fromEntries([["key", 1]]); new Map([["key", 1]]); new Set([1]); void ("key" in {}); void LocalPromise; void record; void safe; type Use = PromiseType;',
    );
    expect((await scanSourceSecurity(safeRoot, configuration)).findings).toEqual([]);
  });

  it("classifies R11 JSX implicit execution and authority transport", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "src", "jsx-transport.tsx"),
      "const a = <X>{...input}</X>; const b = <X>{globalThis}</X>; const c = <X value={globalThis} />; void a; void b; void c;",
    );
    const rules = (await scanSourceSecurity(root, configuration)).findings.map(({ rule }) => rule);
    expect(rules).toContain("SAST_CAPABILITY_IMPLICIT_DATA_ACCESS");
    expect(rules).toContain("SAST_CAPABILITY_UNSUPPORTED_AUTHORITY");
  });

  it("classifies R11 executing decorators without blocking ordinary local decorators", async () => {
    for (const extension of [".ts", ".mts"]) {
      const root = await fixture();
      await writeFile(
        path.join(root, "src", `decorators${extension}`),
        "@globalThis class Global {} @Reflect class Reflection {} @Array.from class Iterator {} @Object.fromEntries class Keys {} void Global; void Reflection; void Iterator; void Keys;",
      );
      const rules = (await scanSourceSecurity(root, configuration)).findings.map(
        ({ rule }) => rule,
      );
      expect(rules).toContain("SAST_CAPABILITY_IMPLICIT_DATA_ACCESS");
      expect(rules).toContain("SAST_CAPABILITY_COMPUTED_DATA_ACCESS");
      expect(rules).toContain("SAST_CAPABILITY_UNSUPPORTED_AUTHORITY");
    }

    const safeRoot = await fixture();
    await writeFile(
      path.join(safeRoot, "src", "safe-decorator.ts"),
      "function local(value) { return value; } @local class Safe {} void Safe;",
    );
    expect((await scanSourceSecurity(safeRoot, configuration)).findings).toEqual([]);
  });

  it("rejects malformed capability allowlists before membership checks", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "src", "computed.ts"), "target[unknownKey];");
    const malformed = mergeSyntheticRecords(configuration, {
      capabilityAllowlists: mergeSyntheticRecords(configuration.capabilityAllowlists, {
        computed_data_access: "src/computed.ts",
      }),
    });
    await expect(scanSourceSecurity(root, malformed)).rejects.toThrow(
      /^source-security capability allowlists are invalid$/u,
    );
  });

  it("rejects parse diagnostics for every executable source extension", async () => {
    for (const extension of [
      ".cjs",
      ".cts",
      ".d.cts",
      ".d.mts",
      ".d.ts",
      ".js",
      ".jsx",
      ".mjs",
      ".mts",
      ".ts",
      ".tsx",
    ]) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `invalid${extension}`), "export const = ;");
      const failure = await scanSourceSecurity(root, configuration).catch((error) => error);
      expect(failure.message).toBe(`src/invalid${extension}:SOURCE_SECURITY_PARSE_FAILED`);
    }
  });

  it("requires the complete executable extension policy", async () => {
    const root = await fixture();
    const missingMts = mergeSyntheticRecords(configuration, {
      extensions: configuration.extensions.filter((extension) => extension !== ".mts"),
    });
    await expect(scanSourceSecurity(root, missingMts)).rejects.toThrow(
      /^source-security extension policy is invalid$/u,
    );
  });

  it("preserves dangerous outer bindings across every relevant lexical shadow", async () => {
    const cases = [
      [
        "terra-shadow",
        `
declare const unknownKey: string;
const Dynamic = (() => {})[unknownKey];
{ const Dynamic = (value: string) => value; void Dynamic; }
void Dynamic("return process")();
`,
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "parameter-shadow",
        `
const Dynamic = (() => {})[unknownKey];
function safe(Dynamic = (value) => value) { return Dynamic("safe"); }
void safe;
Dynamic("return process")();
`,
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "catch-shadow",
        `
const Dynamic = (() => {})[unknownKey];
try { throw "safe"; } catch (Dynamic) { void Dynamic; }
Dynamic("return process")();
`,
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "for-and-case-shadow",
        `
const Dynamic = (() => {})[unknownKey];
for (let Dynamic = 0; Dynamic < 1; Dynamic += 1) { void Dynamic; }
switch (0) { case 0: { const Dynamic = "safe"; void Dynamic; break; } }
Dynamic("return process")();
`,
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "property-carrier-shadow",
        `
const holder = {};
holder.run = (() => {})[unknownKey];
{ const holder = { run: (value) => value }; void holder.run("safe"); }
holder.run("return process")();
`,
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "reflection-shadow",
        `
const read = Reflect.get;
{ const read = (value) => value; void read("safe"); }
read(globalThis, "eval")("synthetic");
`,
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
    ];
    for (const [name, source, rule] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const result = await scanSourceSecurity(root, configuration);
      expect(result.findings).toContainEqual({ path: `src/${name}.ts`, rule });
    }
  });

  it("detects exact dangerous properties independent of receiver and keeps names inert as data", async () => {
    const dangerous = [
      ["plain-object", 'void ({})["constructor"];', "SAST_CAPABILITY_DYNAMIC_CODE"],
      ["date-instance", "void new Date().constructor;", "SAST_CAPABILITY_DYNAMIC_CODE"],
      [
        "class-instance",
        "class Safe {} const value = new Safe(); void value.constructor;",
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "name-carrier",
        'const keys = ["constructor"]; const value = {}; void value[keys[0]];',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      [
        "reflected-name",
        'const key = { value: "constructor" }; Reflect.get({}, key.value);',
        "SAST_CAPABILITY_DYNAMIC_CODE",
      ],
      ["prototype-property", "void ({}).prototype;", "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY"],
    ];
    for (const [name, source, rule] of dangerous) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      expect((await scanSourceSecurity(root, configuration)).findings).toContainEqual({
        path: `src/${name}.ts`,
        rule,
      });
    }

    const safeRoot = await fixture();
    await writeFile(
      path.join(safeRoot, "src", "inert-names.ts"),
      `
const names = ["constructor", "__proto__", "prototype"];
function encode(value) { return JSON.stringify(value); }
const result = encode(names);
void result;
`,
    );
    expect((await scanSourceSecurity(safeRoot, configuration)).findings).toEqual([]);
  });

  it("classifies builtin and local authority re-exports while accepting type-only and relative exports", async () => {
    const cases = [
      ["builtin-star", 'export * from "node:fs";', "SAST_CAPABILITY_FILESYSTEM"],
      [
        "builtin-named",
        'export { readFile as read } from "node:fs";',
        "SAST_CAPABILITY_FILESYSTEM",
      ],
      [
        "local-tagged",
        "const authority = process; export { authority };",
        "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      ],
    ];
    for (const [name, source, rule] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      expect((await scanSourceSecurity(root, configuration)).findings).toContainEqual({
        path: `src/${name}.ts`,
        rule,
      });
    }

    const safeRoot = await fixture();
    await writeFile(
      path.join(safeRoot, "src", "safe-exports.ts"),
      `
export type { Stats } from "node:fs";
export type { LocalType } from "./types.js";
export { localValue } from "./values.js";
`,
    );
    expect((await scanSourceSecurity(safeRoot, configuration)).findings).toEqual([]);
  });

  it("fails closed with content-free token, nesting, node, and resolve budgets", async () => {
    const cases = [
      ["tokens", "const one = 1; const two = 2;", { maxTokensPerFile: 3 }],
      ["nesting", "void (((1)));", { maxTokenNesting: 2 }],
      ["nodes", "const value = { nested: 1 };", { maxNodesPerFile: 3 }],
      ["resolve", "const value = 1; void value;", { maxResolveStepsPerFile: 1 }],
    ];
    for (const [name, source, override] of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${name}.ts`), source);
      const bounded = mergeSyntheticRecords(configuration, {
        astBudgets: mergeSyntheticRecords(configuration.astBudgets, override),
      });
      const failure = await scanSourceSecurity(root, bounded).catch((error) => error);
      expect(failure.message).toBe(`src/${name}.ts:SOURCE_SECURITY_AST_BUDGET_EXCEEDED`);
      expect(failure.message).not.toContain(source);
    }
  });

  it("counts the first token for every script kind and applies JSX nesting budgets", async () => {
    for (const extension of [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `first${extension}`), "a;");
      const bounded = mergeSyntheticRecords(configuration, {
        astBudgets: mergeSyntheticRecords(configuration.astBudgets, { maxTokensPerFile: 1 }),
      });
      await expect(scanSourceSecurity(root, bounded)).rejects.toThrow(
        new RegExp(`^src/first\\${extension}:SOURCE_SECURITY_AST_BUDGET_EXCEEDED$`, "u"),
      );
    }
    for (const extension of [".jsx", ".tsx"]) {
      const root = await fixture();
      await writeFile(
        path.join(root, "src", `nested${extension}`),
        "export const node = <A>{((1))}</A>;",
      );
      const bounded = mergeSyntheticRecords(configuration, {
        astBudgets: mergeSyntheticRecords(configuration.astBudgets, { maxTokenNesting: 1 }),
      });
      await expect(scanSourceSecurity(root, bounded)).rejects.toThrow(
        new RegExp(`^src/nested\\${extension}:SOURCE_SECURITY_AST_BUDGET_EXCEEDED$`, "u"),
      );
    }
  });

  it("bounds empty deep and wide directory trees iteratively", async () => {
    const deep = await fixture();
    await mkdir(path.join(deep, "src", "a", "b", "c"), { recursive: true });
    await expect(
      scanSourceSecurity(deep, mergeSyntheticRecords(configuration, { maxDirectories: 3 })),
    ).rejects.toThrow(/SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED$/u);

    const wide = await fixture();
    await Promise.all(["a", "b", "c", "d"].map((name) => mkdir(path.join(wide, "src", name))));
    await expect(
      scanSourceSecurity(wide, mergeSyntheticRecords(configuration, { maxEntries: 3 })),
    ).rejects.toThrow(/^src:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED$/u);
  });

  it("accepts ordinary data indexing, lexical shadows, and benign catch bindings", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "src", "benign.ts"),
      `
export function read(
  process: { readonly label: string },
  Function: (value: string) => string,
  fetch: (value: string) => string,
) {
  const data = { key: "value", nested: { value: 1 } };
  try {
    throw data;
  } catch (process) {
    return fetch(Function(process.key)) + String(data.nested["value"]);
  }
}`,
    );

    expect((await scanSourceSecurity(root, configuration)).findings).toEqual([]);
  });

  it("binds trusted reflection to exact files, functions, parameters, guards, and bodies", async () => {
    const exactRoot = await fixture();
    for (const relative of [
      "packages/foundation/src/owned-json.ts",
      "packages/foundation/src/safe-data-access.ts",
      "scripts/safe-own-data.mjs",
      "scripts/synthetic-test-data.mjs",
    ]) {
      const target = path.join(exactRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(repositoryRoot, relative)));
    }
    const exactConfiguration = mergeSyntheticRecords(configuration, {
      maxFileBytes: 65_536,
      maxFiles: 16,
      maxTotalBytes: 262_144,
      roots: ["packages", "scripts"],
    });
    const before = await Promise.all(
      [
        "packages/foundation/src/owned-json.ts",
        "packages/foundation/src/safe-data-access.ts",
        "scripts/safe-own-data.mjs",
        "scripts/synthetic-test-data.mjs",
      ].map(async (relative) => {
        const bytes = await readFile(path.join(exactRoot, relative));
        return {
          relative,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
    );
    expect((await scanSourceSecurity(exactRoot, exactConfiguration)).findings).toEqual([]);
    const after = await Promise.all(
      before.map(async ({ relative }) => {
        const bytes = await readFile(path.join(exactRoot, relative));
        return {
          relative,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
    );
    expect(after).toEqual(before);

    const cases = [
      {
        name: "owned-json-body-injection",
        relative: "packages/foundation/src/owned-json.ts",
        source: replaceExactly(
          await readFile(
            path.join(repositoryRoot, "packages/foundation/src/owned-json.ts"),
            "utf8",
          ),
          "    for (const child of Object.values(value)) {",
          "    Object.values(value);\n    for (const child of Object.values(value)) {",
        ),
        rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      },
      {
        name: "wrong-file",
        relative: "src/safe-data-access.ts",
        source: "export function ownDataKeys(container) { return Object.keys(container); }",
        rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      },
      {
        name: "shadowed-root",
        relative: "packages/foundation/src/safe-data-access.ts",
        source:
          "export function ownDataKeys(container) { const Object = { keys: () => [] }; return Object.keys(container); }",
        rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      },
      {
        name: "nested-parameter-shadow",
        relative: "packages/foundation/src/safe-data-access.ts",
        source:
          "export function ownDataKeys(container) { function nested(container) { return Object.keys(container); } return nested(container); }",
        rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      },
      {
        name: "missing-key-guard",
        relative: "packages/foundation/src/safe-data-access.ts",
        source:
          "export function hasOwnDataProperty(container, key) { return Object.hasOwn(container, key); }",
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "descriptor-missing-key-guard",
        relative: "packages/foundation/src/safe-data-access.ts",
        source: (
          await readFile(
            path.join(repositoryRoot, "packages/foundation/src/safe-data-access.ts"),
            "utf8",
          )
        ).replace(
          "  assertSafeKey(key);\n  assertDataContainer(container);",
          "  assertDataContainer(container);",
        ),
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "no-op-guard-implementation",
        relative: "packages/foundation/src/safe-data-access.ts",
        source: (
          await readFile(
            path.join(repositoryRoot, "packages/foundation/src/safe-data-access.ts"),
            "utf8",
          )
        )
          .replace(
            '  if (\n    typeof key !== "string" ||',
            '  if (\n    false && (typeof key !== "string" ||',
          )
          .replace('    key === "prototype"\n  ) {', '    key === "prototype")\n  ) {'),
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "descriptor-missing-container-guard",
        relative: "packages/foundation/src/safe-data-access.ts",
        source: (
          await readFile(
            path.join(repositoryRoot, "packages/foundation/src/safe-data-access.ts"),
            "utf8",
          )
        ).replace(
          "  assertDataContainer(container);\n  const descriptor =",
          "  const descriptor =",
        ),
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "key-reassignment-after-guard",
        relative: "packages/foundation/src/safe-data-access.ts",
        source: (
          await readFile(
            path.join(repositoryRoot, "packages/foundation/src/safe-data-access.ts"),
            "utf8",
          )
        ).replace(
          "  assertDataContainer(container);\n  return Object.hasOwn(container, key);",
          '  assertDataContainer(container);\n  key = "safe";\n  return Object.hasOwn(container, key);',
        ),
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "container-reassignment-after-guard",
        relative: "packages/foundation/src/safe-data-access.ts",
        source: (
          await readFile(
            path.join(repositoryRoot, "packages/foundation/src/safe-data-access.ts"),
            "utf8",
          )
        ).replace(
          "  assertDataContainer(container);\n  return Object.hasOwn(container, key);",
          "  assertDataContainer(container);\n  container = {};\n  return Object.hasOwn(container, key);",
        ),
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "descriptor-body-mutation",
        relative: "scripts/safe-own-data.mjs",
        source: (
          await readFile(path.join(repositoryRoot, "scripts/safe-own-data.mjs"), "utf8")
        ).replace("writable: current?.writable ?? true,", "get writable() { return true; },"),
        rule: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      },
      {
        name: "approved-body-injection",
        relative: "scripts/safe-own-data.mjs",
        source: replaceExactly(
          await readFile(path.join(repositoryRoot, "scripts/safe-own-data.mjs"), "utf8"),
          "return Object.freeze(Object.keys(container));",
          "Object.values(container); return Object.freeze(Object.keys(container));",
        ),
        rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      },
      {
        name: "proxy-parameter-swap",
        relative: "scripts/synthetic-test-data.mjs",
        source: (
          await readFile(path.join(repositoryRoot, "scripts/synthetic-test-data.mjs"), "utf8")
        ).replace("new Proxy(target, handler)", "new Proxy(handler, target)"),
        rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
      },
      {
        name: "import-alias-laundering",
        relative: "src/consumer.ts",
        source:
          'import { ownDataKeys as keys } from "../packages/foundation/src/safe-data-access.js"; const copied = [...keys(target)]; void copied;',
        rule: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      },
    ];
    for (const { name, relative, source, rule } of cases) {
      const root = await fixture();
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
      const scan = scanSourceSecurity(
        root,
        mergeSyntheticRecords(exactConfiguration, { roots: [relative.split("/")[0]] }),
      );
      if (
        [
          "packages/foundation/src/owned-json.ts",
          "packages/foundation/src/safe-data-access.ts",
          "scripts/safe-own-data.mjs",
          "scripts/synthetic-test-data.mjs",
        ].includes(relative)
      ) {
        await expect(scan, name).rejects.toThrow("SOURCE_SECURITY_TRUSTED_MODULE_CHANGED");
      } else {
        expect((await scan).findings, name).toContainEqual({ path: relative, rule });
      }
    }
  });

  it("fails trust closed for BOM, CRLF, and invalid UTF-8 bytes", async () => {
    const original = await readFile(path.join(repositoryRoot, "scripts/safe-own-data.mjs"));
    for (const [name, bytes] of [
      ["bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original])],
      ["crlf", Buffer.from(original.toString("utf8").replaceAll("\n", "\r\n"), "utf8")],
      ["invalid", Buffer.concat([original, Buffer.from([0xff])])],
    ]) {
      expect(bytes.equals(original), name).toBe(false);
      const root = await fixture();
      const target = path.join(root, "scripts", "safe-own-data.mjs");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      await expect(
        scanSourceSecurity(
          root,
          mergeSyntheticRecords(configuration, {
            maxFileBytes: 65_536,
            maxTotalBytes: 65_536,
            roots: ["scripts"],
          }),
        ),
        name,
      ).rejects.toThrow(/^scripts\/safe-own-data\.mjs:SOURCE_SECURITY_TRUSTED_MODULE_CHANGED$/u);
    }

    const invalid = await fixture();
    await writeFile(path.join(invalid, "src", "invalid.ts"), Buffer.from([0xff]));
    await expect(scanSourceSecurity(invalid, configuration)).rejects.toThrow(
      /^src\/invalid\.ts:SOURCE_SECURITY_UTF8_INVALID$/u,
    );
  });

  it("does not execute a trusted helper through the scanner bootstrap import graph", async () => {
    const pending = ["scripts/verify-source-security.mjs"];
    const visited = new Set();
    const loaderRoutes = [];
    while (pending.length > 0) {
      const relative = pending.pop();
      if (relative === undefined || visited.has(relative)) continue;
      visited.add(relative);
      const text = await readFile(path.join(repositoryRoot, relative), "utf8");
      const source = ts.createSourceFile(
        relative,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      const inspectLoader = (node) => {
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
            (ts.isPropertyAccessExpression(node.expression) &&
              ["createRequire", "getBuiltinModule"].includes(node.expression.name.text)))
        ) {
          loaderRoutes.push(`${relative}:${node.getStart(source)}`);
        }
        ts.forEachChild(node, inspectLoader);
      };
      inspectLoader(source);
      const imports = text.matchAll(/^\s*import(?:[\s\S]*?\sfrom\s*)?["'](\.[^"']+)["'];?\s*$/gmu);
      for (const match of imports) {
        const resolved = path
          .relative(repositoryRoot, path.resolve(repositoryRoot, path.dirname(relative), match[1]))
          .replaceAll(path.sep, "/");
        if (resolved.endsWith(".mjs")) pending.push(resolved);
      }
    }
    expect(Array.from(visited).sort()).not.toContain("scripts/safe-own-data.mjs");
    expect(loaderRoutes).toEqual([]);
    expect(Array.from(visited).sort()).toEqual([
      "scripts/bounded-typescript-ast.mjs",
      "scripts/lexical-bindings.mjs",
      "scripts/verify-source-security.mjs",
    ]);
  });

  it("pins R5 own-data reconstruction and the accessor-safe pre-import environment", async () => {
    const membershipSources = await Promise.all(
      [
        "scripts/check-dependencies.mjs",
        "scripts/check-manifests.mjs",
        "scripts/check-tsconfig-paths.mjs",
      ].map(async (relative) => [
        relative,
        await readFile(path.join(repositoryRoot, relative), "utf8"),
      ]),
    );
    for (const [relative, source] of membershipSources) {
      expect(source, relative).not.toMatch(
        /\b(?:field|denied|target|capability\.layer)\s+in\s+(?:manifest|options|config|layers)\b/u,
      );
    }

    for (const relative of [
      "scripts/verify-contracts.mjs",
      "scripts/verify-supply-chain.mjs",
      "scripts/verify-trust-preflight.mjs",
    ]) {
      const source = await readFile(path.join(repositoryRoot, relative), "utf8");
      expect(source, relative).not.toContain("Object.fromEntries(");
      expect(source, relative).toContain("const result = Object.create(null);");
      expect(source, relative).toContain("writeOwnData(result, key,");
    }

    for (const relative of ["scripts/safe-pnpm-install.mjs", "scripts/safe-verify.mjs"]) {
      const source = await readFile(path.join(repositoryRoot, relative), "utf8");
      const parsed = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
      const earliest = parsed.statements.find(
        (statement) =>
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === "earliestChildEnvironment",
      );
      expect(earliest && ts.isFunctionDeclaration(earliest), relative).toBe(true);
      const earliestText = earliest.getText(parsed);
      expect(earliestText).toContain(
        'if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return;',
      );
      expect(earliestText).not.toMatch(/NODE_OPTIONS|NODE_PATH|npm_config_/u);
      const descriptorProperties = [];
      const definitionProperties = [];
      const inspect = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "Object" &&
          node.expression.name.text === "getOwnPropertyDescriptor"
        ) {
          descriptorProperties.push(
            node.arguments[1] && ts.isStringLiteral(node.arguments[1])
              ? node.arguments[1].text
              : "<computed>",
          );
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "Object" &&
          node.expression.name.text === "defineProperty"
        ) {
          definitionProperties.push(
            node.arguments[1] && ts.isStringLiteral(node.arguments[1])
              ? node.arguments[1].text
              : "<computed>",
          );
        }
        ts.forEachChild(node, inspect);
      };
      inspect(earliest);
      const environmentKeys = ["LANG", "LC_ALL", "PATH", "SystemRoot"];
      expect(descriptorProperties).toEqual(environmentKeys);
      expect(definitionProperties).toEqual(environmentKeys);
      expect(source.indexOf("function earliestChildEnvironment")).toBeLessThan(
        source.indexOf('import("./safe-own-data.mjs")'),
      );
    }
  });

  it("proves every production capability allowance is live by isolated removal", async () => {
    const productionPolicy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const productionConfiguration = productionPolicy.sourceSecurity;
    const expectedCounts = {
      child_process: 18,
      computed_data_access: 48,
      dynamic_code: 4,
      dynamic_import: 2,
      filesystem: 58,
      implicit_data_access: 113,
      network: 1,
      process_env: 22,
      unsupported_authority: 45,
    };
    expect(productionConfiguration.capabilityAllowlists.computed_data_access).toContain(
      "scripts/verify-c05-payload-storage.mjs",
    );
    const exactLocalCapabilityBoundaries = {
      "apps/web/src/api.ts": ["computed_data_access", "implicit_data_access"],
      "apps/web/src/main.tsx": [
        "computed_data_access",
        "implicit_data_access",
        "network",
        "unsupported_authority",
      ],
      "packages/adapters-local/src/h-demo-runtime.ts": [
        "computed_data_access",
        "implicit_data_access",
      ],
      "packages/adapters-local/src/h5-mcp-receipt-tools.ts": ["computed_data_access"],
      "packages/adapters-local/src/local-c07-outbox-repository.ts": [
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ],
      "packages/adapters-local/src/local-h1-recall-ledger-repository.ts": [
        "computed_data_access",
        "implicit_data_access",
      ],
      "packages/application/src/c07-outbox-inbox.ts": [
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ],
      "packages/application/src/h1-recall-ledger.ts": [
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ],
      "packages/application/src/h2-embedding-space.ts": [
        "computed_data_access",
        "implicit_data_access",
      ],
      "packages/application/src/h3-demo-agent.ts": [
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ],
      "scripts/h2-crdb-apply-0009.mjs": [
        "computed_data_access",
        "filesystem",
        "implicit_data_access",
        "process_env",
      ],
      "scripts/h2-crdb-live-attest.mjs": [
        "computed_data_access",
        "implicit_data_access",
        "process_env",
      ],
      "scripts/h2-crdb-live-probe.mjs": [
        "computed_data_access",
        "implicit_data_access",
        "process_env",
        "unsupported_authority",
      ],
      "scripts/h2-crdb-provider-control.mjs": ["implicit_data_access", "process_env"],
      "tests/database/h2-crdb-apply-0009.test.mjs": ["implicit_data_access"],
      "tests/database/h2-crdb-live-attest.test.mjs": [
        "computed_data_access",
        "implicit_data_access",
      ],
      "tests/database/h2-crdb-live-probe.test.mjs": ["implicit_data_access"],
      "tests/database/h2-crdb-provider-control.test.mjs": ["implicit_data_access"],
    };
    for (const [relative, expected] of ownDataEntries(exactLocalCapabilityBoundaries)) {
      const actual = ownDataEntries(productionConfiguration.capabilityAllowlists)
        .filter(([, paths]) => paths.includes(relative))
        .map(([capability]) => capability)
        .sort();
      expect(actual, relative).toEqual(expected);
    }
    for (const capability of ["filesystem", "implicit_data_access"]) {
      expect(readOwnData(productionConfiguration.capabilityAllowlists, String(capability))).toEqual(
        expect.arrayContaining([
          "scripts/verify-c05-payload-storage.mjs",
          "tests/database/c05-payload-storage.test.mjs",
        ]),
      );
    }
    for (const [capability, count] of ownDataEntries(expectedCounts)) {
      const entries = readOwnData(productionConfiguration.capabilityAllowlists, String(capability));
      expect(entries, capability).toHaveLength(count);
      expect(entries, capability).toEqual(entries.slice().sort());
    }
    const c03Readers = [
      "scripts/verify-c03-schema.mjs",
      "scripts/verify-c04-role-session.mjs",
      "tests/database/c03-canonical-schema.test.mjs",
      "tests/database/c04-role-session.test.mjs",
    ];
    const expectedC03Capabilities = (relative) =>
      relative === "scripts/verify-c03-schema.mjs"
        ? ["computed_data_access", "filesystem", "implicit_data_access"]
        : ["filesystem", "implicit_data_access"];
    expect(productionConfiguration.extensions).toContain(".sql");
    for (const relative of c03Readers) {
      const capabilities = ownDataEntries(productionConfiguration.capabilityAllowlists)
        .filter(([, paths]) => paths.includes(relative))
        .map(([capability]) => capability)
        .sort();
      expect(capabilities, relative).toEqual(expectedC03Capabilities(relative));
    }
    const assertC03PolicyBoundary = (candidate) => {
      if (!candidate.extensions.includes(".sql")) throw new Error("C03 SQL extension missing");
      for (const relative of c03Readers) {
        const capabilities = ownDataEntries(candidate.capabilityAllowlists)
          .filter(([, paths]) => paths.includes(relative))
          .map(([capability]) => capability)
          .sort();
        if (JSON.stringify(capabilities) !== JSON.stringify(expectedC03Capabilities(relative)))
          throw new Error("C03 capability boundary changed");
      }
      for (const [, paths] of ownDataEntries(candidate.capabilityAllowlists)) {
        if (
          paths.some(
            (relative) =>
              relative === "database" || relative.startsWith("database/") || relative.includes("*"),
          )
        )
          throw new Error("C03 broad database authority prohibited");
      }
    };
    assertC03PolicyBoundary(productionConfiguration);
    for (const mutate of [
      (candidate) =>
        (candidate.extensions = candidate.extensions.filter((value) => value !== ".sql")),
      (candidate) => candidate.capabilityAllowlists.filesystem.push("database/**"),
      (candidate) => candidate.capabilityAllowlists.filesystem.push("database"),
      (candidate) =>
        (candidate.capabilityAllowlists.computed_data_access =
          candidate.capabilityAllowlists.computed_data_access.filter(
            (value) => value !== "scripts/verify-c03-schema.mjs",
          )),
      (candidate) =>
        candidate.capabilityAllowlists.computed_data_access.push(
          "tests/database/c03-canonical-schema.test.mjs",
        ),
      (candidate) => candidate.capabilityAllowlists.network.push(c03Readers[0]),
    ]) {
      const mutated = structuredClone(productionConfiguration);
      mutate(mutated);
      expect(() => assertC03PolicyBoundary(mutated)).toThrow(/C03/u);
    }
    const cleanroomVerifier = "scripts/verify-cleanroom.mjs";
    const expectedCleanroomCapabilities = [
      "filesystem",
      "implicit_data_access",
      "process_env",
      "unsupported_authority",
    ];
    const assertCleanroomCapabilityBoundary = (candidate) => {
      const capabilities = ownDataEntries(candidate.capabilityAllowlists)
        .filter(([, paths]) => paths.includes(cleanroomVerifier))
        .map(([capability]) => capability)
        .sort();
      if (JSON.stringify(capabilities) !== JSON.stringify(expectedCleanroomCapabilities)) {
        throw new Error("cleanroom verifier capability boundary changed");
      }
    };
    assertCleanroomCapabilityBoundary(productionConfiguration);
    for (const capability of Object.keys(productionConfiguration.capabilityAllowlists).filter(
      (value) => !expectedCleanroomCapabilities.includes(value),
    )) {
      const mutated = structuredClone(productionConfiguration);
      writeOwnData(
        mutated.capabilityAllowlists,
        capability,
        readOwnData(mutated.capabilityAllowlists, capability).concat(cleanroomVerifier),
      );
      expect(() => assertCleanroomCapabilityBoundary(mutated)).toThrow(/cleanroom verifier/u);
    }
    const pairs = ownDataEntries(productionConfiguration.capabilityAllowlists).flatMap(
      ([capability, paths]) => paths.map((relative) => ({ capability, relative })),
    );
    const c06Paths = [
      "packages/adapters-local/src/local-c06-event-repository.ts",
      "packages/application/src/event-ledger.ts",
      "scripts/verify-c06-event-ledger.mjs",
      "tests/database/c06-event-ledger.test.mjs",
    ];
    const expectedC06Pairs = [
      { capability: "computed_data_access", relative: c06Paths[0] },
      { capability: "implicit_data_access", relative: c06Paths[0] },
      { capability: "unsupported_authority", relative: c06Paths[0] },
      { capability: "computed_data_access", relative: c06Paths[1] },
      { capability: "implicit_data_access", relative: c06Paths[1] },
      { capability: "unsupported_authority", relative: c06Paths[1] },
      { capability: "filesystem", relative: c06Paths[2] },
      { capability: "implicit_data_access", relative: c06Paths[2] },
      { capability: "computed_data_access", relative: c06Paths[3] },
      { capability: "dynamic_code", relative: c06Paths[3] },
      { capability: "filesystem", relative: c06Paths[3] },
      { capability: "implicit_data_access", relative: c06Paths[3] },
      { capability: "unsupported_authority", relative: c06Paths[3] },
    ];
    const pairOrder = (left, right) =>
      `${left.relative}\u0000${left.capability}` < `${right.relative}\u0000${right.capability}`
        ? -1
        : 1;
    expect(pairs.filter(({ relative }) => c06Paths.includes(relative)).sort(pairOrder)).toEqual(
      expectedC06Pairs.sort(pairOrder),
    );
    const syntheticRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "zc-b03-allowlist-liveness-")),
    );
    roots.push(syntheticRoot);
    const isolatedPaths = new Set(pairs.map(({ relative }) => relative));
    isolatedPaths.add("scripts/safe-own-data.mjs");
    isolatedPaths.add("scripts/synthetic-test-data.mjs");
    isolatedPaths.add("packages/foundation/src/owned-json.ts");
    isolatedPaths.add("packages/foundation/src/safe-data-access.ts");
    isolatedPaths.add(productionConfiguration.pythonSingleton.path);
    for (const relative of isolatedPaths) {
      const target = path.join(syntheticRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(repositoryRoot, relative)));
    }
    const isolatedConfiguration = mergeSyntheticRecords(structuredClone(productionConfiguration), {
      roots: ["."],
      excludedPaths: [],
    });
    delete isolatedConfiguration.ownedJsonPackageBridge;
    expect((await scanSourceSecurity(syntheticRoot, isolatedConfiguration)).findings).toEqual([]);
    const withoutCleanroomUnsupported = structuredClone(isolatedConfiguration);
    withoutCleanroomUnsupported.capabilityAllowlists.unsupported_authority =
      withoutCleanroomUnsupported.capabilityAllowlists.unsupported_authority.filter(
        (relative) => relative !== cleanroomVerifier,
      );
    expect((await scanSourceSecurity(syntheticRoot, withoutCleanroomUnsupported)).findings).toEqual(
      [
        {
          path: cleanroomVerifier,
          rule: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
        },
      ],
    );
    const rules = {
      child_process: "SAST_CAPABILITY_CHILD_PROCESS",
      computed_data_access: "SAST_CAPABILITY_COMPUTED_DATA_ACCESS",
      implicit_data_access: "SAST_CAPABILITY_IMPLICIT_DATA_ACCESS",
      dynamic_code: "SAST_CAPABILITY_DYNAMIC_CODE",
      dynamic_import: "SAST_CAPABILITY_DYNAMIC_IMPORT",
      filesystem: "SAST_CAPABILITY_FILESYSTEM",
      network: "SAST_CAPABILITY_NETWORK",
      process_env: "SAST_CAPABILITY_PROCESS_ENV",
      unsupported_authority: "SAST_CAPABILITY_UNSUPPORTED_AUTHORITY",
    };
    for (const { capability, relative } of pairs) {
      const mutated = structuredClone(isolatedConfiguration);
      mutated.roots = [
        relative,
        productionConfiguration.pythonSingleton.path,
        "packages/foundation/src/owned-json.ts",
        "packages/foundation/src/safe-data-access.ts",
        "scripts/safe-own-data.mjs",
        "scripts/synthetic-test-data.mjs",
      ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort();
      writeOwnData(
        mutated.capabilityAllowlists,
        capability,
        readOwnData(mutated.capabilityAllowlists, String(capability)).filter(
          (entry) => entry !== relative,
        ),
      );
      const result = await scanSourceSecurity(syntheticRoot, mutated);
      expect(result.findings).toContainEqual({
        path: relative,
        rule: readOwnData(rules, String(capability)),
      });
    }
  }, 600_000);

  it("does not exempt a shadowed adapter-manifest createRequire lookalike", async () => {
    const root = await fixture();
    const configured = structuredClone(configuration);
    configured.roots = ["scripts/h2-crdb-smoke.mjs"];
    await mkdir(path.join(root, "scripts"));
    await writeFile(
      path.join(root, "scripts/h2-crdb-smoke.mjs"),
      'const root = ".";\nconst path = { join: (...parts) => parts.join("/") };\nfunction createRequire() {}\ncreateRequire(path.join(root, "packages/adapters-local/package.json"));\n',
    );
    expect((await scanSourceSecurity(root, configured)).findings).toContainEqual({
      path: "scripts/h2-crdb-smoke.mjs",
      rule: "SAST_CAPABILITY_LOCAL_C02_REGISTRAR_BOUNDARY",
    });
  });

  it("fails closed on active HTML while accepting exact local static assets", async () => {
    const cleanRoot = await fixture();
    await writeFile(
      path.join(cleanRoot, "src", "index.html"),
      '<!doctype html><script type="module" src="/main.js"></script><img src="assets/a.png" /   >',
    );
    expect((await scanSourceSecurity(cleanRoot, configuration)).findings).toEqual([]);

    const productionPolicy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const productionResult = await scanSourceSecurity(
      repositoryRoot,
      productionPolicy.sourceSecurity,
    );
    expect(
      productionResult.findings.filter(({ path: relative }) => relative === "apps/web/index.html"),
    ).toEqual([]);

    const secret = `A${"KIA"}${"A".repeat(16)}`;
    const cases = [
      {
        name: "inline-network",
        html: [
          "<ScRiPt>",
          'fetch("https://example.invalid");',
          "new XMLHttpRequest();",
          'new WebSocket("wss://example.invalid");',
          'navigator.sendBeacon("https://example.invalid", "x");',
          "</sCrIpT>",
        ].join(""),
        rules: ["HTML_INLINE_SCRIPT_BODY"],
      },
      {
        name: "event-handler",
        html: '<button \n OnClIcK = "fetch(&quot;/x&quot;)">x</button>',
        rules: ["HTML_INLINE_EVENT_HANDLER"],
      },
      {
        name: "active-schemes",
        html: [
          '<a href="java&#x73;cript:alert(1)">a</a>',
          '<a href="java%73cript:alert(1)">b</a>',
          '<a href="java&#10;script:alert(1)">c</a>',
          '<iframe src="data%3Atext%2Fhtml%2Cbad"></iframe>',
          '<a href="java\\script:alert(1)">d</a>',
        ].join(""),
        rules: ["HTML_ACTIVE_URL_SCHEME", "HTML_LOCAL_ASSET_POLICY"],
      },
      {
        name: "external-resources",
        html: [
          '<script src="https://example.invalid/x.js"></script>',
          '<iframe src="//example.invalid/x"></iframe>',
          '<object data="http&#x3a;//example.invalid/x"></object>',
          '<embed src="https%3A%2F%2Fexample.invalid/x">',
          '<link rel="StyleSheet" href="https://example.invalid/x.css">',
          '<img src="https://example.invalid/x.png">',
          '<source srcset="https://example.invalid/x.webp 1x">',
          '<audio src="https://example.invalid/x.mp3"></audio>',
          '<video poster="https://example.invalid/x.jpg"></video>',
          '<form action="../escape"></form>',
        ].join(""),
        rules: ["HTML_EXTERNAL_RESOURCE_URL", "HTML_LOCAL_ASSET_POLICY"],
      },
      {
        name: "srcdoc-and-malformed",
        html: '<iframe srcdoc="<script>bad()</script>"><script src="/main.js"',
        rules: ["HTML_SRCDOC", "HTML_UNSUPPORTED_HTML"],
      },
      {
        name: "slash-attribute-prefix",
        html: ['<script/src="/main.js"></script>', '<img/onload="fetch(&quot;/x&quot;)">'].join(""),
        rules: ["HTML_UNSUPPORTED_HTML"],
      },
      {
        name: "entity-stylesheet-rel",
        html: '<link rel="style&#x73;heet" href="https://example.invalid/x.css">',
        rules: ["HTML_EXTERNAL_RESOURCE_URL"],
      },
      {
        name: "percent-stylesheet-rel",
        html: '<link rel="%73tylesheet" href="//example.invalid/x.css">',
        rules: ["HTML_EXTERNAL_RESOURCE_URL"],
      },
      {
        name: "malformed-slash-before-attribute",
        html: '<img / onload="bad()">',
        rules: ["HTML_UNSUPPORTED_HTML"],
      },
      {
        name: "malformed-double-slash",
        html: "<img //>",
        rules: ["HTML_UNSUPPORTED_HTML"],
      },
      {
        name: "malformed-slash-name",
        html: '<img /src="/x.png">',
        rules: ["HTML_UNSUPPORTED_HTML"],
      },
      {
        name: "malformed-slash-nbsp",
        html: "<img /\u00a0>",
        rules: ["HTML_UNSUPPORTED_HTML"],
      },
      {
        name: "secret-canary",
        html: `<meta name="synthetic" content="${secret}">`,
        rules: ["SECRET_AWS_ACCESS_KEY"],
      },
    ];
    for (const testCase of cases) {
      const root = await fixture();
      await writeFile(path.join(root, "src", `${testCase.name}.html`), testCase.html);
      const result = await scanSourceSecurity(root, configuration);
      expect(result.findings.map(({ rule }) => rule)).toEqual(
        expect.arrayContaining(testCase.rules),
      );
      expect(JSON.stringify(result)).not.toContain("example.invalid");
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  }, 30_000);
});
