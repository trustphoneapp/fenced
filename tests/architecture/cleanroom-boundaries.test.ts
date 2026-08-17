import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { mergeOwnDataRecords, readOwnData, writeOwnData } from "../../scripts/safe-own-data.mjs";
// @ts-expect-error The executable installer module intentionally has no declaration artifact.
import { sanitizeEnvironment } from "../../scripts/safe-pnpm-install.mjs";
import {
  createSyntheticProxy,
  defineSyntheticProperty,
  mergeSyntheticRecords,
} from "../../scripts/synthetic-test-data.mjs";
import {
  discoverGovernedFiles,
  discoverSupplyChainInputs,
  formatCleanroomDiagnostic,
  readQuarantinedHistoricalSubjectIdentity,
  validatePolicy,
  validatePortablePaths,
  validateResourceLimits,
  validateSafeVerifyEnvironment,
  verifyCleanroom,
  verifyCleanroomSyntheticFixture,
  // @ts-expect-error The executable cleanroom module intentionally has no declaration artifact.
} from "../../scripts/verify-cleanroom.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const policy = JSON.parse(
  await readFile(path.join(repositoryRoot, "ci", "h11b-cleanroom-policy-r52.json"), "utf8"),
);
const b03PolicyBytes = await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"));
const roots: string[] = [];
const execFile = promisify(execFileCallback);
const privateMarker = ["synthetic-private", "boundary-marker:v1"].join("-");
const quarantinePath =
  ".c06-e0085-r45-preimage-capture-662b9ffcfe0c01bb0661da805e090bb57928fdb422c7499b310385dd25461981.bin";
const legacy = [
  "AGENTS.md",
  "docs/implementation/evidence-ledger.md",
  "docs/implementation/goal.md",
  "docs/implementation/task-manifest.yaml",
];
type MutablePolicy = {
  [key: string]: unknown;
  ephemeralOutputs: Record<string, unknown>;
  governedTopLevel: string[];
  limits: Record<string, unknown>;
  opaqueLocalOnlyRoots: string[];
  persistentGenerated: Array<Record<string, unknown>>;
  profiles: string[];
  topLevelShape: Array<Record<string, unknown>>;
};

async function fixture() {
  const rawRoot = await mkdtemp(path.join(tmpdir(), "zc-h01-"));
  const root = await realpath(rawRoot);
  roots.push(root);
  for (const entry of policy.topLevelShape) {
    if (!entry.required) continue;
    const destination = path.join(root, entry.path);
    if (entry.kind === "directory") await mkdir(destination, { recursive: true });
    else {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, `${entry.path}\n`);
    }
  }
  await writeFile(path.join(root, "ci", "b03-policy.json"), b03PolicyBytes);
  await writeFile(path.join(root, quarantinePath), "synthetic quarantine fixture\n");
  await chmod(path.join(root, quarantinePath), 0o600);
  for (const item of legacy) {
    const destination = path.join(root, item);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${item}\n`);
  }
  for (const { path: generated } of policy.persistentGenerated) {
    const destination = path.join(root, generated);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, generated.endsWith(".ts") ? "export {};\n" : "{}\n");
  }
  return root;
}

function safeEnvironment(label = "synthetic") {
  const runRoot = path.join(repositoryRoot, ".zc-bootstrap", `run-${label}`);
  const store = path.join(repositoryRoot, ".zc-pnpm-store");
  return {
    CI: "true",
    HOME: path.join(runRoot, "home"),
    LANG: "en_US.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/synthetic/bin",
    SystemRoot: "/synthetic/system-root",
    TEMP: path.join(runRoot, "tmp"),
    TMP: path.join(runRoot, "tmp"),
    TMPDIR: path.join(runRoot, "tmp"),
    XDG_CACHE_HOME: path.join(store, "cache"),
    XDG_CONFIG_HOME: path.join(runRoot, "config"),
    XDG_DATA_HOME: path.join(runRoot, "data"),
    XDG_STATE_HOME: path.join(store, "state"),
    npm_config_cache: path.join(store, "cache"),
    npm_config_globalconfig: path.join(runRoot, "config", "global.npmrc"),
    npm_config_ignore_pnpmfile: "true",
    npm_config_ignore_scripts: "true",
    npm_config_store_dir: path.join(store, "store"),
    npm_config_strict_dep_builds: "false",
    npm_config_userconfig: path.join(runRoot, "config", "user.npmrc"),
    npm_config_virtual_store_dir: path.join(store, "virtual-store"),
  };
}

function validTarHeader() {
  const header = Buffer.alloc(512, 0x20);
  header.set([0x75, 0x73, 0x74, 0x61, 0x72], 257);
  const checksum = Array.from(header).reduce((sum, byte) => sum + byte, 0);
  const octal = checksum.toString(8).padStart(6, "0");
  header.set(
    Array.from(octal).map((digit) => digit.charCodeAt(0)),
    148,
  );
  return header;
}

function validArArchive() {
  const archive = Buffer.alloc(68, 0x20);
  archive.set([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a], 0);
  archive.set(Buffer.from("file/"), 8);
  for (const offset of [24, 36, 42, 48, 56]) archive.set([0x30], offset);
  archive[66] = 0x60;
  archive[67] = 0x0a;
  return archive;
}

function validCpioArchive(crc = false) {
  const archive = Buffer.alloc(124, 0x00);
  archive.set(crc ? [0x30, 0x37, 0x30, 0x37, 0x30, 0x32] : [0x30, 0x37, 0x30, 0x37, 0x30, 0x31], 0);
  const fields = Array.from({ length: 13 }, () => 0);
  fields[11] = 11;
  fields.forEach((value, index) => {
    archive.set(Buffer.from(value.toString(16).padStart(8, "0")), 6 + index * 8);
  });
  archive.set(Buffer.from("TRAILER!!!\0"), 110);
  return archive;
}

function validPdf(offset = 0) {
  return Buffer.concat([
    Buffer.alloc(offset, 0x20),
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]),
    Buffer.from("1 0 obj\n<<>>\nendobj\n"),
    Buffer.from([0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a]),
  ]);
}

const run = (root: string, value = structuredClone(policy), profile = "local-development") =>
  root === repositoryRoot
    ? verifyCleanroom(root, value, profile)
    : verifyCleanroomSyntheticFixture(root, value, profile);

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("H02C clean-room classifier", () => {
  it("binds the optional opaque .worktrees root at the exact policy positions", () => {
    expect(createHash("sha256").update(JSON.stringify(policy)).digest("hex")).toBe(
      "3477fabde775d8e1b6721bb4e95818db4325c850c7dac19735af0642c60e064a",
    );
    expect(policy.ephemeralOutputs).toMatchObject({
      b03Policy: "ci/b03-policy.json",
      bytes: 84587,
      sha256: "5d8eb3a4af777c25661782a4b26d1ec5ad057ada071b0013251cc174fb33ef63",
    });
    expect(policy.opaqueLocalOnlyRoots).toEqual([
      ".cursor",
      ".git",
      ".worktrees",
      ".zc-bootstrap",
      ".zc-pnpm-store",
      "node_modules",
    ]);
    expect(
      policy.topLevelShape.find(({ path: relative }: { path: string }) => relative === ".git"),
    ).toEqual({ path: ".git", kind: "opaque-directory-or-file", required: false });
    const npmrc = policy.topLevelShape.findIndex(
      ({ path: relative }: { path: string }) => relative === ".npmrc",
    );
    expect(readOwnData(policy.topLevelShape, String(npmrc + 1))).toEqual({
      path: ".worktrees",
      kind: "directory",
      required: false,
    });
    expect(
      policy.topLevelShape.filter(
        ({ path: relative }: { path: string }) => relative === ".worktrees",
      ),
    ).toHaveLength(1);
    expect(validateResourceLimits({ readBytes: 2097152 })).toBe(true);
    expect(() => validateResourceLimits({ readBytes: 2097153 })).toThrow(/LIMIT_READ_BYTES$/u);
    for (const maxReadBytes of [1048576, 2097151, 2097153]) {
      const altered = structuredClone(policy);
      altered.limits.maxReadBytes = maxReadBytes;
      expect(() => validatePolicy(altered)).toThrow(/POLICY_INVALID$/u);
    }
  });

  it("binds the singleton quarantine object at the mandated policy placement", () => {
    const keys = Object.keys(policy);
    expect(
      keys.slice(keys.indexOf("opaqueLocalOnlyRoots"), keys.indexOf("topLevelShape") + 1),
    ).toEqual(["opaqueLocalOnlyRoots", "quarantinedHistoricalSubject", "topLevelShape"]);
    expect(policy.quarantinedHistoricalSubject).toEqual({
      path: quarantinePath,
      bytes: 617075,
      sha256: "31e3271246b376a825e7ea4e68700fcfbdcaac72e902179589de2cc8a65d23ea",
      mode: "0644",
      nlink: 1,
      kind: "canonical-regular-file-nonsymlink",
      gitIndexMode: "100644",
      gitBlob: "64aa3877a7a138ae2ae27aae9213983c24e8837c",
      firstTrackedCommit: "00d8c0d27127eb6cd7151f8b759b8043a450c95c",
      classification: "quarantined-opaque-historical-subject",
      contentUse: "PROHIBITED_EXCEPT_BOUNDED_IDENTITY_HASH",
      execution: "PROHIBITED",
      import: "PROHIBITED",
      parsing: "PROHIBITED",
      publicExport: "PROHIBITED",
      runtime: "PROHIBITED",
    });
  });

  it("reports limited local success and a derived public-ready block", async () => {
    const script = path.join(repositoryRoot, "scripts", "verify-cleanroom.mjs");
    const inventory = async () => {
      const repository = await execFile(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"],
        { cwd: repositoryRoot },
      );
      const localRuns = [];
      for (const relative of [".zc-bootstrap", ".zc-pnpm-store"]) {
        try {
          localRuns.push(
            (
              await execFile("find", [relative, "-print"], {
                cwd: repositoryRoot,
                maxBuffer: 64 * 1024 * 1024,
              })
            ).stdout,
          );
        } catch (error) {
          if (!String(error).includes("No such file or directory")) throw error;
        }
      }
      expect(repository.stderr).toBe("");
      return { repository: repository.stdout, localRuns: localRuns.join("") };
    };
    const expectCliFailure = async (environment: Record<string, string>) => {
      let failure: unknown;
      try {
        await execFile(process.execPath, [script], { cwd: repositoryRoot, env: environment });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: expect.not.stringMatching(/^0$/u),
        stdout: "",
        stderr: "cleanroom-error: <redacted>:AMBIENT_ENV_PROHIBITED\n",
      });
    };
    const before = await inventory();
    await expect(run(repositoryRoot)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
      publicReady: "PUBLIC_READY_BLOCKED",
      publicBlocks: [
        "LEGACY_LOCAL_BOUNDARY",
        "LOCAL_UNSIGNED_PROVENANCE",
        "QUARANTINED_TRACKED_HISTORICAL_SUBJECT",
        "OPAQUE_LOCAL_WORKTREE_ROOT_UNVERIFIED",
      ],
    });
    await expect(
      run(repositoryRoot, structuredClone(policy), "public-ready"),
    ).resolves.toMatchObject({
      publicReady: "PUBLIC_READY_BLOCKED",
    });
    await expect(
      execFile(process.execPath, [script], {
        cwd: repositoryRoot,
        env: { H02C_HARMLESS_UNKNOWN: "stripped", LANG: "C" },
      }),
    ).resolves.toEqual({
      stderr: "",
      stdout:
        "cleanroom: SAFE_VERIFY_BOUND_LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS; PUBLIC_READY_BLOCKED\n",
    });
    await expectCliFailure({ NODE_OPTIONS: "" });
    await expectCliFailure({ AWS_ACCESS_KEY_ID: "synthetic-only" });
    expect(() =>
      validateSafeVerifyEnvironment({ H02C_HARMLESS_UNKNOWN: "unsanitized" }, repositoryRoot),
    ).toThrow(/:AMBIENT_ENV_PROHIBITED$/u);

    const source = await readFile(script, "utf8");
    const builderStart = source.indexOf("function buildCliEnvironmentSnapshot");
    const mainStart = source.indexOf("async function main()");
    const execArgvCheck = source.indexOf("execArgv.length !== 0", builderStart);
    const ownKeyInspection = source.indexOf("Reflect.ownKeys(environment)", builderStart);
    const descriptorInspection = source.indexOf(
      "capturedGetOwnPropertyDescriptors(environment)",
      builderStart,
    );
    const snapshotCall = source.indexOf(
      "buildCliEnvironmentSnapshot(process.env, process.execArgv, repositoryRoot)",
      mainStart,
    );
    const ambientRead = source.indexOf("process.env", snapshotCall);
    const policyRead = source.indexOf("const bytes = await readFile(policyPath)", mainStart);
    const builderEnd = source.indexOf("\n}\n\nasync function main()", builderStart);
    const mainEnd = source.indexOf("\n}\n\nif (process.argv[1]", mainStart);
    expect(builderStart).toBeGreaterThan(-1);
    expect(execArgvCheck).toBeGreaterThan(-1);
    expect(ownKeyInspection).toBeGreaterThan(execArgvCheck);
    expect(descriptorInspection).toBeGreaterThan(ownKeyInspection);
    expect(builderEnd).toBeGreaterThan(descriptorInspection);
    expect(snapshotCall).toBeGreaterThan(mainStart);
    expect(ambientRead).toBeGreaterThan(snapshotCall);
    expect(policyRead).toBeGreaterThan(snapshotCall);
    expect(mainEnd).toBeGreaterThan(policyRead);
    const builderSource = source.slice(builderStart, builderEnd);
    expect(source.slice(0, builderStart)).toContain(
      "const capturedGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors",
    );
    expect(source.slice(0, builderStart)).toContain("const capturedObjectValues = Object.values");
    expect(source.slice(0, builderStart)).toContain("const capturedHasOwn = Object.hasOwn");
    expect(builderSource).toContain("capturedObjectValues(descriptorMap)");
    expect(builderSource).not.toContain("getOwnPropertyDescriptor(");
    expect(builderSource).not.toMatch(/\b[A-Za-z_$][\w$]*\s*\[/u);
    expect(builderSource).toContain("const descriptor = Object.create(null)");
    for (const property of [
      "LANG",
      "LC_ALL",
      "PATH",
      "SystemRoot",
      "CI",
      "HOME",
      "TEMP",
      "TMP",
      "TMPDIR",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "npm_config_cache",
      "npm_config_globalconfig",
      "npm_config_ignore_pnpmfile",
      "npm_config_ignore_scripts",
      "npm_config_store_dir",
      "npm_config_strict_dep_builds",
      "npm_config_userconfig",
      "npm_config_virtual_store_dir",
    ])
      expect(builderSource).toMatch(
        new RegExp(String.raw`defineProperty\(\s*snapshot,\s*"${property}"`, "u"),
      );
    for (const property of ["LANG", "LC_ALL", "PATH", "SystemRoot"]) {
      expect(builderSource).toContain(`capturedHasOwn(descriptorMap, "${property}")`);
      expect(builderSource).toContain(`descriptorMap.${property}.value`);
    }
    const descriptorCapture = builderSource.indexOf(
      "capturedGetOwnPropertyDescriptors(environment)",
    );
    expect(descriptorCapture).toBeGreaterThan(-1);
    expect(builderSource.slice(descriptorCapture + "environment".length)).not.toMatch(
      /\benvironment\.(?:LANG|LC_ALL|PATH|SystemRoot)\b/u,
    );
    expect(source.slice(ambientRead + "process.env".length, mainEnd)).not.toContain("process.env");
    const assertCliEnvironmentTopology = (text: string) => {
      const file = ts.createSourceFile(
        "verify-cleanroom.mjs",
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const named = file.statements.filter(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === "buildCliEnvironmentSnapshot",
      );
      const targets = named.filter((statement) => statement.body);
      expect(named).toHaveLength(1);
      expect(targets).toHaveLength(1);
      const target = targets[0];
      if (!target?.body) throw new Error("unique bodyful target missing");
      expect(target.parent).toBe(file);
      const body = target.body;
      const literal = (node: ts.Expression) => (ts.isStringLiteral(node) ? node.text : undefined);
      const isDescriptorValue = (node: ts.Expression, key: string) =>
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "value" &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === key &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "descriptorMap";
      const property = (node: ts.Expression): { key: string; value: ts.Expression } | undefined => {
        if (!ts.isCallExpression(node)) return undefined;
        const [targetArgument, keyArgument, descriptorArgument] = node.arguments;
        if (
          node.questionDotToken ||
          !ts.isIdentifier(node.expression) ||
          node.expression.text !== "defineProperty" ||
          node.arguments.length !== 3 ||
          !targetArgument ||
          !ts.isIdentifier(targetArgument) ||
          targetArgument.text !== "snapshot" ||
          !keyArgument ||
          !ts.isStringLiteral(keyArgument) ||
          !descriptorArgument ||
          !ts.isCallExpression(descriptorArgument) ||
          descriptorArgument.questionDotToken ||
          !ts.isIdentifier(descriptorArgument.expression) ||
          descriptorArgument.expression.text !== "freshDataDescriptor" ||
          descriptorArgument.arguments.length !== 1
        )
          return undefined;
        const [value] = descriptorArgument.arguments;
        if (!value) return undefined;
        return { key: keyArgument.text, value };
      };
      const calls: Array<{ key: string; value: ts.Expression; node: ts.CallExpression }> = [];
      const validationCalls: ts.CallExpression[] = [];
      const returns: ts.ReturnStatement[] = [];
      const classes: ts.Node[] = [];
      const inspect = (node: ts.Node) => {
        if (node !== target && (ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
          classes.push(node);
          return;
        }
        if (node !== target && ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) returns.push(node);
        if (ts.isCallExpression(node)) {
          const found = property(node);
          if (found) calls.push({ ...found, node });
          if (
            !node.questionDotToken &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "validateSafeVerifyEnvironment"
          )
            validationCalls.push(node);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(body);
      const allClasses: ts.Node[] = [];
      const findClasses = (node: ts.Node) => {
        if (node !== target && (ts.isClassDeclaration(node) || ts.isClassExpression(node)))
          allClasses.push(node);
        ts.forEachChild(node, findClasses);
      };
      findClasses(body);
      expect(classes).toHaveLength(0);
      expect(allClasses).toHaveLength(0);
      const optional = ["LANG", "LC_ALL", "PATH", "SystemRoot"];
      const mandatory = [
        "CI",
        "HOME",
        "TEMP",
        "TMP",
        "TMPDIR",
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "npm_config_cache",
        "npm_config_globalconfig",
        "npm_config_ignore_pnpmfile",
        "npm_config_ignore_scripts",
        "npm_config_store_dir",
        "npm_config_strict_dep_builds",
        "npm_config_userconfig",
        "npm_config_virtual_store_dir",
      ];
      const optionalStatement = (statement: ts.Statement, key: string) => {
        if (
          !ts.isIfStatement(statement) ||
          statement.elseStatement ||
          ts.isBlock(statement.thenStatement) ||
          !ts.isExpressionStatement(statement.thenStatement) ||
          !ts.isCallExpression(statement.expression)
        )
          return false;
        const condition = statement.expression;
        const [descriptorMap, propertyName] = condition.arguments;
        if (
          condition.questionDotToken ||
          !ts.isIdentifier(condition.expression) ||
          condition.expression.text !== "capturedHasOwn" ||
          condition.arguments.length !== 2 ||
          !descriptorMap ||
          !ts.isIdentifier(descriptorMap) ||
          descriptorMap.text !== "descriptorMap" ||
          !propertyName ||
          literal(propertyName) !== key
        )
          return false;
        const found = property(statement.thenStatement.expression);
        return found?.key === key && isDescriptorValue(found.value, key);
      };
      for (const key of optional)
        expect(
          body.statements.filter((statement) => optionalStatement(statement, key)),
        ).toHaveLength(1);
      const direct = body.statements.flatMap((statement) =>
        ts.isExpressionStatement(statement) ? [property(statement.expression)] : [],
      );
      expect(
        direct
          .map((entry) => entry?.key)
          .filter(Boolean)
          .sort(),
      ).toEqual([...mandatory].sort());
      expect(calls.map((entry) => entry.key).sort()).toEqual([...optional, ...mandatory].sort());
      expect(new Set(calls.map((entry) => entry.key)).size).toBe(21);
      expect(validationCalls).toHaveLength(1);
      const validation = body.statements.at(-2);
      const finalReturn = body.statements.at(-1);
      expect(validation !== undefined && ts.isExpressionStatement(validation)).toBe(true);
      expect(finalReturn !== undefined && ts.isReturnStatement(finalReturn)).toBe(true);
      if (!validation || !ts.isExpressionStatement(validation))
        throw new Error("validation statement missing");
      if (!finalReturn || !ts.isReturnStatement(finalReturn))
        throw new Error("final return missing");
      expect(returns).toEqual([finalReturn]);
      expect(finalReturn.expression?.getText(file)).toBe("snapshot");
      const validationCall = validation.expression;
      expect(ts.isCallExpression(validationCall)).toBe(true);
      if (!ts.isCallExpression(validationCall)) throw new Error("validation missing");
      expect(validationCall.questionDotToken).toBeUndefined();
      expect(ts.isIdentifier(validationCall.expression) && validationCall.expression.text).toBe(
        "validateSafeVerifyEnvironment",
      );
      expect(validationCall.arguments.map((argument) => argument.getText(file))).toEqual([
        "snapshot",
        "root",
      ]);
      for (const call of calls)
        expect(call.node.getStart(file)).toBeLessThan(validation.getStart(file));
    };
    assertCliEnvironmentTopology(source);
    const requiredLang =
      'if (capturedHasOwn(descriptorMap, "LANG"))\n    defineProperty(snapshot, "LANG", freshDataDescriptor(descriptorMap.LANG.value));';
    const langCall =
      'defineProperty(snapshot, "LANG", freshDataDescriptor(descriptorMap.LANG.value));';
    const ciCall = 'defineProperty(snapshot, "CI", freshDataDescriptor("true"));';
    const validationLine = "validateSafeVerifyEnvironment(snapshot, root);";
    const negativeSources: Array<[string, string]> = [
      ["target-ambiguity", `${source}\nfunction buildCliEnvironmentSnapshot() {}`],
      ["nested-function", source.replace(requiredLang, `function nested() { ${langCall} }`)],
      ["lexical-decoy", source.replace(requiredLang, `if (false) ${langCall}`)],
      ["class-public-field", source.replace(requiredLang, `class Decoy { field = ${langCall} }`)],
      ["class-private-field", source.replace(requiredLang, `class Decoy { #field = ${langCall} }`)],
      [
        "class-computed-field",
        source.replace(requiredLang, `class Decoy { ["field"] = ${langCall} }`),
      ],
      [
        "class-static-block",
        source.replace(requiredLang, `class Decoy { static { ${langCall} } }`),
      ],
      ["false-condition", source.replace(requiredLang, `if (false)\n    ${langCall}`)],
      ["short-circuit", source.replace(requiredLang, `false && ${langCall}`)],
      ["conditional-expression", source.replace(requiredLang, `false ? ${langCall} : undefined;`)],
      ["while-loop", source.replace(requiredLang, `while (false) ${langCall}`)],
      ["for-loop", source.replace(requiredLang, `for (;;) { ${langCall} break; }`)],
      [
        "switch",
        source.replace(requiredLang, `switch ("LANG") { case "LANG": ${langCall} break; }`),
      ],
      ["try-catch", source.replace(requiredLang, `try { ${langCall} } catch {}`)],
      ["post-return", source.replace(ciCall, `return snapshot;\n  ${ciCall}`)],
      [
        "unmatched-optional-condition",
        source.replace(
          'capturedHasOwn(descriptorMap, "LANG")',
          'capturedHasOwn(descriptorMap, "OTHER")',
        ),
      ],
      [
        "wrong-optional-key",
        source.replace(
          'capturedHasOwn(descriptorMap, "LANG")',
          'capturedHasOwn(descriptorMap, "LC_ALL")',
        ),
      ],
      ["optional-else", source.replace(requiredLang, `${requiredLang}\n  else undefined;`)],
      ["duplicate-direct-call", source.replace(ciCall, `${ciCall}\n  ${ciCall}`)],
      ["missing-direct-call", source.replace(ciCall, "")],
      ["missing-validation", source.replace(validationLine, "")],
      [
        "duplicate-validation",
        source.replace(validationLine, `${validationLine}\n  ${validationLine}`),
      ],
      [
        "indirect-validation",
        source.replace(validationLine, "validator.validateSafeVerifyEnvironment(snapshot, root);"),
      ],
      [
        "reordered-validation",
        source.replace(validationLine, "").replace(ciCall, `${validationLine}\n  ${ciCall}`),
      ],
      [
        "non-penultimate-validation",
        source.replace(validationLine, `${validationLine}\n  void 0;`),
      ],
    ];
    for (const [label, negative] of negativeSources)
      expect(() => assertCliEnvironmentTopology(negative), label).toThrow();
    await expect(inventory()).resolves.toEqual(before);
  }, 20_000);

  it("derives the strict governed provenance universe and excludes only current self output", async () => {
    const discovered = await discoverGovernedFiles(repositoryRoot, policy);
    const b03 = JSON.parse(await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"));
    expect(discovered).toEqual(b03.provenanceSubjects);
    expect(new Set(discovered).size).toBe(discovered.length);
    expect(discovered).toContain("ci/generated/provenance/B04-PROV-R5-001.json");
    expect(discovered).toContain("ci/generated/provenance/B05-PROV-R1-001.json");
    expect(discovered).toContain("ci/b05-cleanroom-policy.json");
    expect(discovered).toContain("ci/c01-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/c01-cleanroom-policy-r3.json");
    expect(discovered).toContain("ci/c01-cleanroom-policy-r4.json");
    expect(discovered).toContain("ci/c01-cleanroom-policy-r5.json");
    expect(discovered).toContain("ci/c01-cleanroom-policy-r9.json");
    expect(discovered).toContain("ci/c01-cleanroom-policy.json");
    expect(discovered).toContain("ci/c02-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/c02-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/c03-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/c03-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/c03-cleanroom-policy-r3.json");
    expect(discovered).toContain("ci/c03-cleanroom-policy-r4.json");
    expect(discovered).toContain("ci/c04-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/c04-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/c04-cleanroom-policy-r3.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r3.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r4.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r5.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r6.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r7.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r8.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r9.json");
    expect(discovered).toContain("ci/c05-cleanroom-policy-r10.json");
    expect(discovered).toContain("ci/h01-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/h01-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/h02c-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r1.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r2.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r3.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r4.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r5.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r6.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r7.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r8.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r9.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r10.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r11.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r12.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r13.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r14.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r15.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r16.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r17.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r18.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r24.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r26.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r27.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r30.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r32.json");
    expect(discovered).toContain("ci/h11b-cleanroom-policy-r35.json");
    expect(discovered).toContain("ci/generated/provenance/C01-PROV-R1-001.json");
    expect(discovered).toContain("ci/generated/provenance/C01-PROV-R2-001.json");
    expect(discovered).toContain("ci/generated/provenance/C01-PROV-R3-001.json");
    expect(discovered).toContain("ci/generated/provenance/C01-PROV-R4-001.json");
    expect(discovered).toContain("ci/generated/provenance/C01-PROV-R5-001.json");
    expect(discovered).toContain("ci/generated/provenance/C01-PROV-R9-001.json");
    expect(discovered).toContain("ci/generated/provenance/C02-PROV-R1-001.json");
    expect(discovered).toContain("ci/generated/provenance/C02-PROV-R2-001.json");
    expect(discovered).toContain("ci/generated/provenance/C03-PROV-R1-001.json");
    expect(discovered).toContain("ci/generated/provenance/C03-PROV-R2-001.json");
    expect(discovered).toContain("ci/generated/provenance/C03-PROV-R3-001.json");
    expect(discovered).toContain("ci/generated/provenance/C03-PROV-R4-001.json");
    expect(discovered).toContain("ci/generated/provenance/C04-PROV-R1-001.json");
    expect(discovered).toContain("ci/generated/provenance/C04-PROV-R2-001.json");
    expect(discovered).toContain("ci/generated/provenance/C04-PROV-R3-001.json");
    expect(discovered).toContain("ci/generated/provenance/C05-PROV-R9-001.json");
    expect(discovered).toContain("ci/generated/provenance/C05-PROV-R10-001.json");
    expect(discovered).toContain("ci/generated/provenance/H01-PROV-R1-001.json");
    expect(discovered).toContain("ci/generated/provenance/H01-PROV-R2-001.json");
    expect(discovered).toContain("ci/generated/provenance/H02C-PROV-R1-001.json");
    expect(discovered).toContain("ci/generated/provenance/H02C-PROV-R2-001.json");
    expect(discovered).toContain("ci/generated/provenance/H02C-PROV-R3-001.json");
    expect(discovered).toContain("ci/generated/provenance/H02C-PROV-R4-001.json");
    expect(discovered).toContain("ci/generated/provenance/H02C-PROV-R5-001.json");
    expect(discovered).toContain("ci/generated/provenance/H02C-PROV-R6-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R4-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R5-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R6-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R7-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R8-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R9-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R10-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R11-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R12-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R13-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R14-001.json");
    expect(discovered).toContain("ci/generated/provenance/H11B-PROV-R23-001.json");
    expect(discovered).not.toContain("ci/generated/provenance/H11B-PROV-R31-001.json");
    expect(discovered).toContain("database/README.md");
    expect(discovered).toContain("database/migrations/0001_tenant_event_ledger.sql");
    expect(discovered).toContain("docs/hackathon/h02a-empty-worktree-container-amendment.md");
    expect(discovered).toContain("docs/hackathon/h02a-read-budget-successor.md");
    expect(discovered).toContain("docs/hackathon/h02a-r8-single-quarantine-read-successor.md");
    expect(discovered).toContain("docs/hackathon/h02a-r9-minimal-single-read-successor.md");
    expect(discovered).toContain("docs/hackathon/h02a-streaming-ledger-hash-successor.md");
    expect(discovered).toContain("docs/hackathon/h02a-test-types-successor.md");
    expect(discovered).toContain("docs/hackathon/h02a-worktree-reference-successor.md");
    expect(discovered).toContain("docs/hackathon/h02b-c06-closure-contract.md");
    expect(discovered).toContain("docs/hackathon/h02b-c06-closure-contract-r2.md");
    expect(discovered).toContain("docs/hackathon/h02b-c06-executable-checkpoint-contract-r3.md");
    expect(discovered).toContain("docs/hackathon/h02c-c06-provenance-and-transition-contract.md");
    expect(discovered).toContain(
      "docs/hackathon/h02c-c06-provenance-and-transition-contract-r2.md",
    );
    expect(discovered).toContain(
      "docs/hackathon/h02c-c06-provenance-and-transition-contract-r3.md",
    );
    expect(discovered).toContain(
      "docs/hackathon/h02c-c06-provenance-and-transition-contract-r4.md",
    );
    expect(discovered).toContain(
      "docs/hackathon/h02c-c06-provenance-and-transition-contract-r5.md",
    );
    for (const revision of [
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30,
    ])
      expect(discovered).toContain(
        `docs/hackathon/h02c-c06-provenance-and-transition-contract-r${revision}.md`,
      );
    expect(discovered).toContain("scripts/h02c-ci-inventory.py");
    expect(discovered).toContain("docs/hackathon/evidence/h02c-c06-closure.json");
    expect(discovered).toContain("docs/hackathon/h02a-quarantined-historical-subject-amendment.md");
    expect(
      discovered.some(
        (relative: string) => relative === ".worktrees" || relative.startsWith(".worktrees/"),
      ),
    ).toBe(false);
    expect(discovered.filter((relative: string) => relative === quarantinePath)).toHaveLength(1);
    expect(discovered).toHaveLength(505);
  });

  it("treats optional synthetic .worktrees only as a non-symlink directory boundary", async () => {
    const absent = await fixture();
    const absentResult = await run(absent);
    expect(absentResult).toMatchObject({
      publicReady: "PUBLIC_READY_BLOCKED",
      quarantineReadEvidence: {
        allowedFullReads: 1,
        completedFullReads: 1,
        remainingFullReads: 0,
        source: "discoverSupplyChainInputsWithDescriptor",
      },
    });

    const opaque = await fixture();
    await mkdir(path.join(opaque, ".worktrees"));
    await writeFile(path.join(opaque, ".worktrees", "synthetic-child.bin"), "unverified\n");
    const opaqueResult = await run(opaque);
    expect(opaqueResult).toMatchObject({ publicReady: "PUBLIC_READY_BLOCKED" });
    expect(opaqueResult.files).toBe(absentResult.files);

    const arrangements: Array<(root: string, target: string) => Promise<void>> = [
      async (_root, target) => writeFile(target, "wrong kind\n"),
      async (root, target) => symlink(path.join(root, "scripts"), target, "dir"),
      async (_root, target) => execFile("mkfifo", [target]).then(() => undefined),
    ];
    for (const arrange of arrangements) {
      const root = await fixture();
      await arrange(root, path.join(root, ".worktrees"));
      await expect(run(root)).rejects.toThrow(/:(?:SYMLINK_PROHIBITED|TOP_LEVEL_SHAPE_INVALID)$/u);
    }
  });

  it("accepts only absent, canonical-directory, or canonical 0644 singly linked opaque .git", async () => {
    const absent = await fixture();
    const absentResult = await run(absent);

    const directory = await fixture();
    await mkdir(path.join(directory, ".git"));
    await writeFile(path.join(directory, ".git", "opaque-private-marker"), privateMarker);
    const directoryResult = await run(directory);
    expect(directoryResult.files).toBe(absentResult.files);

    const regular = await fixture();
    await writeFile(path.join(regular, ".git"), privateMarker);
    await chmod(path.join(regular, ".git"), 0o644);
    const regularResult = await run(regular);
    expect(regularResult.files).toBe(absentResult.files);

    const arrangements: Array<(root: string, target: string) => Promise<void>> = [
      async (root, target) => symlink(path.join(root, "scripts"), target, "dir"),
      async (_root, target) => execFile("mkfifo", [target]).then(() => undefined),
      async (_root, target) => {
        await writeFile(target, "wrong mode\n");
        await chmod(target, 0o600);
      },
      async (root, target) => {
        const opaque = path.join(root, ".zc-bootstrap");
        const source = path.join(opaque, "git-hardlink-source");
        await mkdir(opaque);
        await writeFile(source, "hardlink\n");
        await link(source, target);
      },
    ];
    for (const arrange of arrangements) {
      const root = await fixture();
      await arrange(root, path.join(root, ".git"));
      await expect(run(root)).rejects.toThrow(/:(?:SYMLINK_PROHIBITED|TOP_LEVEL_SHAPE_INVALID)$/u);
    }
  });

  it("exports only the exact quarantined historical subject identity", async () => {
    const expected = {
      path: quarantinePath,
      bytes: 617075,
      sha256: "31e3271246b376a825e7ea4e68700fcfbdcaac72e902179589de2cc8a65d23ea",
      mode: "0644",
      nlink: 1,
      kind: "canonical-regular-file-nonsymlink",
    };
    await expect(readQuarantinedHistoricalSubjectIdentity(repositoryRoot, policy)).resolves.toEqual(
      expected,
    );
    await expect(readQuarantinedHistoricalSubjectIdentity(repositoryRoot, policy)).resolves.toEqual(
      expected,
    );
    await expect(discoverSupplyChainInputs(repositoryRoot, policy)).resolves.toMatchObject({
      quarantinedIdentity: expected,
      quarantineReadEvidence: {
        allowedFullReads: 1,
        completedFullReads: 1,
        remainingFullReads: 0,
        source: "discoverSupplyChainInputsWithDescriptor",
      },
    });
    await expect(
      verifyCleanroomSyntheticFixture(repositoryRoot, policy, "local-development"),
    ).rejects.toThrow(/:ROOT_NOT_CANONICAL$/u);
  });

  it("structurally binds exactly two fresh-budget callers to one full-read core", async () => {
    const sourceText = await readFile(
      path.join(repositoryRoot, "scripts", "verify-cleanroom.mjs"),
      "utf8",
    );
    const source = ts.createSourceFile(
      "verify-cleanroom.mjs",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const functions = new Map<string, ts.FunctionDeclaration>();
    const coreCalls: ts.CallExpression[] = [];
    const fullReads: ts.CallExpression[] = [];
    const retiredIdentifiers: ts.Identifier[] = [];
    const inspect = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
      if (ts.isIdentifier(node) && node.text === "discoverGovernedFilesWithDescriptor")
        retiredIdentifiers.push(node);
      if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "readQuarantinedHistoricalSubjectIdentityCore"
        )
          coreCalls.push(node);
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "handle" &&
          node.expression.name.text === "read"
        )
          fullReads.push(node);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
    expect(coreCalls).toHaveLength(2);
    expect(fullReads).toHaveLength(1);
    expect(retiredIdentifiers).toHaveLength(0);
    for (const name of [
      "readQuarantinedHistoricalSubjectIdentity",
      "discoverSupplyChainInputsWithDescriptor",
    ]) {
      const body = functions.get(name)?.body;
      expect(body).toBeDefined();
      const declarations: ts.VariableDeclaration[] = [];
      const calls: ts.CallExpression[] = [];
      const inspectBody = (node: ts.Node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "readBudget"
        )
          declarations.push(node);
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "readQuarantinedHistoricalSubjectIdentityCore"
        )
          calls.push(node);
        ts.forEachChild(node, inspectBody);
      };
      if (body) inspectBody(body);
      expect(declarations).toHaveLength(1);
      expect(declarations[0]?.initializer?.getText(source)).toBe(
        "{ remainingFullReads: 1, completedFullReads: 0 }",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.arguments.at(-1)?.getText(source)).toBe("readBudget");
    }
    const core = functions.get("readQuarantinedHistoricalSubjectIdentityCore")?.body;
    expect(core).toBeDefined();
    const assignments: ts.BinaryExpression[] = [];
    const exactByteCountGuards: ts.IfStatement[] = [];
    const inspectCore = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isIdentifier(node.left.expression) &&
        node.left.expression.text === "readBudget"
      )
        assignments.push(node);
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(source) === "bytesRead !== descriptor.bytes"
      )
        exactByteCountGuards.push(node);
      ts.forEachChild(node, inspectCore);
    };
    if (core) inspectCore(core);
    const propertyName = (node: ts.BinaryExpression) =>
      ts.isPropertyAccessExpression(node.left) ? node.left.name.text : "";
    const reserve = assignments.find((node) => propertyName(node) === "remainingFullReads");
    const complete = assignments.find((node) => propertyName(node) === "completedFullReads");
    expect(exactByteCountGuards).toHaveLength(1);
    const exactByteCountGuard = exactByteCountGuards[0];
    expect(reserve?.right.getText(source)).toBe("0");
    expect(complete?.right.getText(source)).toBe("1");
    expect(exactByteCountGuard?.thenStatement.getText(source)).toBe(
      'fail(descriptor.path, "SPECIAL_FILE");',
    );
    expect(reserve?.getStart(source)).toBeLessThan(fullReads[0]?.getStart(source) ?? 0);
    expect(complete?.getStart(source)).toBeGreaterThan(exactByteCountGuard?.getEnd() ?? 0);
  });

  it("rejects every independent quarantined policy identity mutation", async () => {
    const mutations: Array<(value: typeof policy) => void> = [
      (value) => delete value.quarantinedHistoricalSubject.path,
      (value) => (value.quarantinedHistoricalSubject.extra = true),
      (value) => (value.quarantinedHistoricalSubject.path = ".different.bin"),
      (value) => (value.quarantinedHistoricalSubject.bytes += 1),
      (value) => (value.quarantinedHistoricalSubject.sha256 = "0".repeat(64)),
      (value) => (value.quarantinedHistoricalSubject.mode = "0600"),
      (value) => (value.quarantinedHistoricalSubject.nlink = 2),
      (value) => (value.quarantinedHistoricalSubject.kind = "regular-file"),
      (value) => (value.quarantinedHistoricalSubject.gitIndexMode = "100755"),
      (value) => (value.quarantinedHistoricalSubject.gitBlob = "0".repeat(40)),
      (value) => (value.quarantinedHistoricalSubject.firstTrackedCommit = "0".repeat(40)),
      (value) => (value.quarantinedHistoricalSubject.classification = "source"),
      (value) => (value.quarantinedHistoricalSubject.contentUse = "ALLOWED"),
      (value) => (value.quarantinedHistoricalSubject.execution = "ALLOWED"),
      (value) => (value.quarantinedHistoricalSubject.import = "ALLOWED"),
      (value) => (value.quarantinedHistoricalSubject.parsing = "ALLOWED"),
      (value) => (value.quarantinedHistoricalSubject.publicExport = "ALLOWED"),
      (value) => (value.quarantinedHistoricalSubject.runtime = "ALLOWED"),
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(policy);
      mutate(altered);
      await expect(
        readQuarantinedHistoricalSubjectIdentity(repositoryRoot, altered),
      ).rejects.toThrow(/:POLICY_INVALID$/u);
    }
  });

  it.each([
    ["missing", async (target: string) => rm(target)],
    ["renamed", async (target: string) => rename(target, `${target}.renamed`)],
    ["truncated", async (target: string) => writeFile(target, "synthetic quarantine")],
    [
      "extended",
      async (target: string) => writeFile(target, "synthetic quarantine fixture\nextra"),
    ],
    ["byte-mutated", async (target: string) => writeFile(target, "synthetic quarantine fixturE\n")],
    ["permission-mutated", async (target: string) => chmod(target, 0o644)],
    ["executable", async (target: string) => chmod(target, 0o700)],
    [
      "symlink",
      async (target: string) => {
        await rm(target);
        await symlink(path.join(path.dirname(target), "AGENTS.md"), target);
      },
    ],
    [
      "hard-linked",
      async (target: string) => {
        await rm(target);
        const source = `${target}.hardlink-source`;
        await writeFile(source, "synthetic quarantine fixture\n");
        await chmod(source, 0o600);
        await link(source, target);
      },
    ],
    [
      "directory",
      async (target: string) => {
        await rm(target);
        await mkdir(target);
      },
    ],
    [
      "fifo",
      async (target: string) => {
        await rm(target);
        await execFile("mkfifo", [target]);
      },
    ],
  ])("rejects a %s quarantined subject", async (_label, mutate) => {
    const root = await fixture();
    await mutate(path.join(root, quarantinePath));
    await expect(run(root)).rejects.toThrow(/:SPECIAL_FILE$/u);
  });

  it("excludes exactly the burned R1 and R4 policies while retaining frozen hashes", async () => {
    const biome = JSON.parse(await readFile(path.join(repositoryRoot, "biome.json"), "utf8"));
    expect(
      biome.files.includes.filter((entry: string) => entry.includes("c05-cleanroom-policy")),
    ).toEqual(["!ci/c05-cleanroom-policy-r1.json", "!ci/c05-cleanroom-policy-r4.json"]);
    for (const [revision, sha256] of [
      ["r1", "12891deca70f8941a6163890bc9c2c100feb844a0fc330b5f556d5435d89acbf"],
      ["r4", "0781a81ca113fa0cde9d367635eedb4ca1fe7458b1229ed5b1ccef5b0e7c3df5"],
    ]) {
      const burned = await readFile(
        path.join(repositoryRoot, "ci", `c05-cleanroom-policy-${revision}.json`),
      );
      expect(createHash("sha256").update(burned).digest("hex")).toBe(sha256);
    }
    expect(policy.identityBinding.failedPolicyHistory).toEqual([
      {
        path: "ci/c05-cleanroom-policy-r1.json",
        bytes: 13594,
        mode: "0644",
        sha256: "12891deca70f8941a6163890bc9c2c100feb844a0fc330b5f556d5435d89acbf",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r2.json",
        bytes: 13863,
        mode: "0644",
        sha256: "c40052d5b5dfaa24ca5b3b3cdbf69ed97fff79062eb4e8d6995e6d925ecb3728",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r3.json",
        bytes: 14129,
        mode: "0644",
        sha256: "9028fd60473f6a91ec30b5f86ed64a9b023d1b11d83a904ecabc586adf651050",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r4.json",
        bytes: 14427,
        mode: "0644",
        sha256: "0781a81ca113fa0cde9d367635eedb4ca1fe7458b1229ed5b1ccef5b0e7c3df5",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r5.json",
        bytes: 14661,
        mode: "0644",
        sha256: "ddff651c1269357fac3fc7235385b249786814eb563a6753ac5f5d6e12d5a44e",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r6.json",
        bytes: 14927,
        mode: "0644",
        sha256: "5245bd0fb0d20e27c2115e9d582f1d687c61baa2526c67ba9563cf800b86de98",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r7.json",
        bytes: 15193,
        mode: "0644",
        sha256: "e0759b03bc24baa46a4e79c050ddbb8e5c7f1e9c94d1738a9bab63c69be8efdf",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r8.json",
        bytes: 15459,
        mode: "0644",
        sha256: "1458bc08c460f8d7a988e44f004e3ca541576c3adf31f0bf5046dd58a16caf1a",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r9.json",
        bytes: 15725,
        mode: "0644",
        sha256: "7ad67727c6dde9e9325bfa8d26b01eed37553b3ac28b49c24158046f6b713371",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/h01-cleanroom-policy-r1.json",
        bytes: 17459,
        mode: "0644",
        sha256: "7f4128535e655e33ba82122b88cd15fc6bdce341502f1252ccaaef0f4b603309",
        disposition: "immutable-failed-prior-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r19.json",
        bytes: 25070,
        mode: "0644",
        sha256: "81e382eb7e38e975bbe169eb3a498e91cb2ce5a3802eb29b6b0b9952eee3e2b4",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r25.json",
        bytes: 29037,
        mode: "0644",
        sha256: "3f8651380fcdff48cfcd1a8cbeaaea6055dc9722a24938575e276a798d4cd8d7",
        disposition: "immutable-failed-prior-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r26.json",
        bytes: 29590,
        mode: "0644",
        sha256: "c633811945f979895d8fb8c72e250d14e617120151e2b4dcc9aaa29f39854781",
        disposition: "immutable-failed-prior-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r27.json",
        bytes: 30676,
        mode: "0644",
        sha256: "d536ed97b58c64c1c4f0f4fc10b9c90a54ede56ba14bb0eb36d46ad29f77e3ea",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r35.json",
        bytes: 36670,
        mode: "0644",
        sha256: "36ea465affda7d65022d970636a8e23a03a1d4ce691b498841184bb98b3db700",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r39.json",
        bytes: 39934,
        mode: "0644",
        sha256: "7138659fec7bccd96b7f88c377b1351e1f33df626c9d188d666f5436e3690df7",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r40.json",
        bytes: 41284,
        mode: "0644",
        sha256: "7e1f24ba6a26b5be468942eb06e276f1b2da41ea0f0fee8aa293720cb734f494",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r41.json",
        bytes: 41821,
        mode: "0644",
        sha256: "f0aa72492e24f17fa587633faf76ada30001166de3b8c7058fec6a76209fcfe5",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r42.json",
        bytes: 43195,
        mode: "0644",
        sha256: "32eceab4ff1e4b61f64dfe25205f321fdda15d070c83e419cbce3f9798219e9f",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r43.json",
        bytes: 44545,
        mode: "0644",
        sha256: "9051e8928d4929d68a8db21185cc96948d238064b45396dc60beef78b4dfb41e",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r44.json",
        bytes: 44572,
        mode: "0644",
        sha256: "9d723be836b94a23fb4a47bce7769ef4df1ec185d0e04676478355264dd550c5",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r45.json",
        bytes: 45661,
        mode: "0644",
        sha256: "cbf5fe8bb81f71c40fbf9aba0f802767397de52ff70fdf840e4dd0ef53399336",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r46.json",
        bytes: 46209,
        mode: "0644",
        sha256: "5a360114bb6fc6614beb272f0a0c02a865b4a828398a25c942a8cf5ad4f9a879",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r47.json",
        bytes: 47295,
        mode: "0644",
        sha256: "835d35892c0c36b2ca6e23f39f449c3057fdaa4de686c6e87977fd51ff30a919",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r48.json",
        bytes: 48657,
        mode: "0644",
        sha256: "33bbbd8f0330438176fa2e050c8c43e46f0889122669f96fb7a3e4f10381f2d7",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r49.json",
        bytes: 50019,
        mode: "0644",
        sha256: "d4ac35e05551e54c7e19f82f561ea0fda7d016c1f96a7f1b447a31c2ce896408",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r50.json",
        bytes: 51674,
        mode: "0644",
        sha256: "4339173d9b3b8942036d51b538ce4452dad937a2415516072a023a5af08ae9e6",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r51.json",
        bytes: 52214,
        mode: "0644",
        sha256: "96677d77de8d09f76253a858b1addc0e188eef2fd494a0b43a1363be14fd5b03",
        disposition: "immutable-failed-current-task-policy-history",
      },
    ]);
    const failedPolicy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "h01-cleanroom-policy-r1.json"), "utf8"),
    );
    const inheritedPersistentGenerated = structuredClone(
      failedPolicy.persistentGenerated.slice(0, -1),
    );
    const inheritedPredecessor = inheritedPersistentGenerated.at(-1);
    if (!inheritedPredecessor) throw new Error("missing inherited predecessor");
    inheritedPredecessor.disposition = "immutable-prior-predecessor-history";
    expect(policy.persistentGenerated.slice(0, -44)).toEqual(inheritedPersistentGenerated);
    expect(policy.persistentGenerated.slice(-44)).toEqual([
      {
        path: "ci/generated/provenance/H01-PROV-R1-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H01-SOURCE-SECURITY-R1",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H01-PROV-R2-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H01-SOURCE-SECURITY-R1",
        disposition: "immutable-prior-accepted-predecessor-history",
      },
      {
        path: "ci/generated/provenance/H02C-PROV-R1-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H02C",
        disposition: "immutable-burned-non-provenance-history",
      },
      {
        path: "ci/generated/provenance/H02C-PROV-R2-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H02C",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H02C-PROV-R3-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H02C",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H02C-PROV-R4-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H02C",
        disposition: "immutable-accepted-predecessor",
      },
      {
        path: "ci/generated/provenance/H02C-PROV-R5-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H02C",
        disposition: "immutable-failed-current-task-immediate-predecessor",
      },
      {
        path: "ci/generated/provenance/H02C-PROV-R6-001.json",
        producer: "scripts/verify-supply-chain.mjs",
        config: "ci/b03-policy.json",
        input: "H02C",
        disposition: "immutable-immediate-provenance-predecessor",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R3-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R3",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R4-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R4",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R5-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R5",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R6-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R6",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R7-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R7",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R8-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R8",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R9-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R9",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R10-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R10",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R11-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R11",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R12-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R12",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R13-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R13",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R14-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R14",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R15-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R15",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R16-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R16",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R17-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R17",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R19-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R19",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R20-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R20",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R21-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R21",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R23-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R23",
        disposition: "immutable-sealed-local-provenance-predecessor",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R24-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R24",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R28-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R28",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R30-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R30",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R32-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R32",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R34-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R34",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R37-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R37",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R38-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R38",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R40-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R40",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R41-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R41",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R42-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R42",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R43-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R43",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R44-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R44",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R46-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R46",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R47-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R47",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R48-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R48",
        disposition: "immutable-failed-current-task-candidate",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R49-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R49",
        disposition: "immutable-sealed-local-provenance-history",
      },
      {
        path: "ci/generated/provenance/H11B-PROV-R51-001.json",
        producer: "scripts/generate-b03-local-evidence.mjs",
        config: "ci/b03-policy.json",
        input: "H11B-FINALIZER-R51",
        disposition: "current-provenance",
      },
    ]);
    expect(
      policy.persistentGenerated.filter(
        ({ disposition }: { disposition: string }) => disposition === "current-provenance",
      ),
    ).toHaveLength(1);
  });

  it.each([
    ["unknown top-level", async (root: string) => writeFile(path.join(root, "unknown"), "x")],
    ["other hidden top-level", async (root: string) => writeFile(path.join(root, ".other"), "x")],
    ["other root binary", async (root: string) => writeFile(path.join(root, "other.bin"), "x")],
    [
      "unknown file",
      async (root: string) => {
        await mkdir(path.join(root, "scripts"), { recursive: true });
        await writeFile(path.join(root, "scripts", "blob.bin"), "x");
      },
    ],
    [
      "symlink leaf",
      async (root: string) => symlink(path.join(root, "ci"), path.join(root, "escape"), "dir"),
    ],
    [
      "nested git",
      async (root: string) => mkdir(path.join(root, "scripts", ".git"), { recursive: true }),
    ],
    [
      "gitmodules",
      async (root: string) => {
        await mkdir(path.join(root, "scripts"), { recursive: true });
        await writeFile(path.join(root, "scripts", ".gitmodules"), "x");
      },
    ],
    [
      "archive extension",
      async (root: string) => {
        await mkdir(path.join(root, "scripts"), { recursive: true });
        await writeFile(path.join(root, "scripts", "x.zip"), "x");
      },
    ],
  ])("rejects %s with a content-free rule code", async (_label, arrange) => {
    const root = await fixture();
    await arrange(root);
    await expect(run(root)).rejects.toThrow(/:[A-Z_]+$/u);
  });

  it.each([
    ["zip", [0x50, 0x4b, 0x03, 0x04]],
    ["gzip", [0x1f, 0x8b, 0x08]],
    ["7z", [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
    ["bzip2", [0x42, 0x5a, 0x68]],
    ["xz", [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
    ["rar", [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]],
    ["ELF", [0x7f, 0x45, 0x4c, 0x46]],
    ["Mach-O", [0xcf, 0xfa, 0xed, 0xfe]],
    ["fat", [0xca, 0xfe, 0xba, 0xbe]],
    ["PE", [0x4d, 0x5a]],
    ["Wasm", [0x00, 0x61, 0x73, 0x6d]],
    ["malformed UTF-8", [0xc3, 0x28]],
    ["non-NUL control binary", [0x01, 0x02, 0x03]],
  ])("rejects renamed %s bytes", async (_label, bytes) => {
    const root = await fixture();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "renamed.ts"), Buffer.from(bytes));
    await expect(run(root)).rejects.toThrow(/:BINARY_OR_ARCHIVE_PROHIBITED$/u);
  });

  it("rejects renamed tar signature bytes", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "renamed.ts"), validTarHeader());
    await expect(run(root)).rejects.toThrow(/:BINARY_OR_ARCHIVE_PROHIBITED$/u);
  });

  it.each([
    ["text-prefixed ZIP", [0x50, 0x4b, 0x03, 0x04]],
    ["text-prefixed 7z", [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ])("rejects %s polyglot content", async (_label, signature) => {
    const root = await fixture();
    const content = Buffer.concat([Buffer.from("valid text prefix\n"), Buffer.from(signature)]);
    await writeFile(path.join(root, "scripts/polyglot.ts"), content);
    await expect(run(root)).rejects.toThrow(/:BINARY_OR_ARCHIVE_PROHIBITED$/u);
  });

  it.each([
    ["ar member", () => validArArchive()],
    ["cpio newc", () => validCpioArchive()],
    ["cpio crc", () => validCpioArchive(true)],
    ["PDF leading", () => validPdf()],
    ["PDF shifted", () => validPdf(100)],
  ])("rejects structurally valid %s containers", async (_label, build) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/container.ts"), build());
    await expect(run(root)).rejects.toThrow(/:BINARY_OR_ARCHIVE_PROHIBITED$/u);
  });

  it("allows benign or malformed structural marker prose", async () => {
    for (const bytes of [
      Buffer.concat([
        Buffer.from("interior "),
        Buffer.from([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]),
        Buffer.from(" prose"),
      ]),
      Buffer.concat([
        Buffer.from("interior "),
        Buffer.from([0x30, 0x37, 0x30, 0x37, 0x30, 0x31]),
        Buffer.from(" prose"),
      ]),
      Buffer.concat([
        Buffer.from([0x30, 0x37, 0x30, 0x37, 0x30, 0x32]),
        Buffer.from(" malformed prose"),
      ]),
      Buffer.concat([
        Buffer.from("discussion "),
        Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
        Buffer.from(" only"),
      ]),
      Buffer.concat([
        Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
        Buffer.from(" mentioned without structure"),
      ]),
    ]) {
      const root = await fixture();
      await writeFile(path.join(root, "scripts/prose.ts"), bytes);
      await expect(run(root)).resolves.toMatchObject({
        outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
      });
    }
  });

  it("rejects shifted tar container magic at offset 769", async () => {
    const root = await fixture();
    const content = Buffer.alloc(1024, 0x20);
    validTarHeader().copy(content, 512);
    await writeFile(path.join(root, "scripts/polyglot.ts"), content);
    await expect(run(root)).rejects.toThrow(/:BINARY_OR_ARCHIVE_PROHIBITED$/u);
  });

  it("does not classify bare or invalid tar-like text as an archive", async () => {
    const proseRoot = await fixture();
    await writeFile(path.join(proseRoot, "scripts/prose.ts"), "mustard\ncustard\n");
    await expect(run(proseRoot)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });

    for (const offset of [100, 257]) {
      const markerRoot = await fixture();
      const content = Buffer.alloc(512, 0x20);
      content.set([0x75, 0x73, 0x74, 0x61, 0x72], offset);
      await writeFile(path.join(markerRoot, "scripts/prose.ts"), content);
      await expect(run(markerRoot)).resolves.toMatchObject({
        outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
      });
    }

    const checksumRoot = await fixture();
    const invalid = validTarHeader();
    invalid.fill(0x30, 148, 154);
    await writeFile(path.join(checksumRoot, "scripts/prose.ts"), invalid);
    await expect(run(checksumRoot)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it.each([
    ["unknown outer key", (value: MutablePolicy) => (value.extra = true)],
    ["top-level wildcard", (value: MutablePolicy) => value.governedTopLevel.push("*")],
    ["profile reordering", (value: MutablePolicy) => value.profiles.reverse()],
    ["ephemeral extension", (value: MutablePolicy) => (value.ephemeralOutputs.extra = "x")],
    ["ephemeral value", (value: MutablePolicy) => (value.ephemeralOutputs.field = "wrong")],
    [
      "accepted predecessor substitution",
      (value: MutablePolicy) =>
        ((
          (value.identityBinding as Record<string, unknown>).acceptedPredecessor as Record<
            string,
            unknown
          >
        ).sha256 = "0".repeat(64)),
    ],
    [
      "immediate predecessor substitution",
      (value: MutablePolicy) =>
        ((
          (value.identityBinding as Record<string, unknown>).immediatePredecessor as Record<
            string,
            unknown
          >
        ).sha256 = "0".repeat(64)),
    ],
    [
      "generated extension",
      (value: MutablePolicy) => {
        const first = value.persistentGenerated[0];
        if (first) first.extra = "x";
      },
    ],
    ["generated reordering", (value: MutablePolicy) => value.persistentGenerated.reverse()],
    [
      "generated type",
      (value: MutablePolicy) => {
        const first = value.persistentGenerated[0];
        if (first) first.input = 1;
      },
    ],
    ["limits extension", (value: MutablePolicy) => (value.limits.extra = 1)],
    ["limits type", (value: MutablePolicy) => (value.limits.maxFiles = "8192")],
    ["limits value", (value: MutablePolicy) => (value.limits.maxFiles = 8193)],
    ["top shape missing", (value: MutablePolicy) => value.topLevelShape.pop()],
    [
      "opaque worktree omission",
      (value: MutablePolicy) =>
        value.opaqueLocalOnlyRoots.splice(value.opaqueLocalOnlyRoots.indexOf(".worktrees"), 1),
    ],
    ["opaque worktree reordering", (value: MutablePolicy) => value.opaqueLocalOnlyRoots.reverse()],
    [
      "opaque worktree duplication",
      (value: MutablePolicy) => value.opaqueLocalOnlyRoots.push(".worktrees"),
    ],
    ["additional opaque root", (value: MutablePolicy) => value.opaqueLocalOnlyRoots.push(".other")],
    [
      "opaque worktree shape omission",
      (value: MutablePolicy) =>
        value.topLevelShape.splice(
          value.topLevelShape.findIndex(({ path: relative }) => relative === ".worktrees"),
          1,
        ),
    ],
    [
      "opaque worktree shape reordering",
      (value: MutablePolicy) => {
        const index = value.topLevelShape.findIndex(
          ({ path: relative }) => relative === ".worktrees",
        );
        const [entry] = value.topLevelShape.splice(index, 1);
        if (entry) value.topLevelShape.push(entry);
      },
    ],
    [
      "opaque worktree required",
      (value: MutablePolicy) => {
        const entry = value.topLevelShape.find(({ path: relative }) => relative === ".worktrees");
        if (entry) entry.required = true;
      },
    ],
    [
      "opaque worktree kind",
      (value: MutablePolicy) => {
        const entry = value.topLevelShape.find(({ path: relative }) => relative === ".worktrees");
        if (entry) entry.kind = "file";
      },
    ],
    [
      "opaque worktree shape duplication",
      (value: MutablePolicy) =>
        value.topLevelShape.push({ path: ".worktrees", kind: "directory", required: false }),
    ],
    [
      "top shape kind",
      (value: MutablePolicy) => {
        const first = value.topLevelShape[0];
        if (first) first.kind = "directory";
      },
    ],
  ])("rejects closed policy mutation: %s", async (_label, mutate) => {
    const altered = structuredClone(policy) as MutablePolicy;
    mutate(altered);
    expect(() => validatePolicy(altered)).toThrow(/POLICY_/u);
  });

  it.each([
    ["backslash", ["scripts/a\\b.ts"], "PATH_INVALID"],
    ["control", ["scripts/a\u0001.ts"], "PATH_ENCODING_INVALID"],
    ["trailing dot", ["scripts/a."], "PATH_TRAILING_INVALID"],
    ["trailing space", ["scripts/a "], "PATH_TRAILING_INVALID"],
    ["duplicate", ["scripts/a.ts", "scripts/a.ts"], "PATH_DUPLICATE"],
    ["casefold collision", ["scripts/A.ts", "scripts/a.ts"], "CASEFOLD_COLLISION"],
    ["non-NFC", ["scripts/e\u0301.ts"], "PATH_ENCODING_INVALID"],
    ["percent encoding", ["scripts/%2e%2e.ts"], "PATH_PORTABILITY_INVALID"],
    ["colon", ["scripts/C:drive.ts"], "PATH_PORTABILITY_INVALID"],
    ["replacement", ["scripts/\ufffd.ts"], "PATH_PORTABILITY_INVALID"],
    ["non-ASCII", ["scripts/café.ts"], "PATH_PORTABILITY_INVALID"],
    ["device", ["scripts/CON.ts"], "PATH_DEVICE_INVALID"],
    ["device extension", ["scripts/lpt1.json"], "PATH_DEVICE_INVALID"],
    ["ambiguous leading dot", ["scripts/.hidden.ts"], "PATH_PORTABILITY_INVALID"],
  ])("rejects portable path hazard: %s", (_label, paths, rule) => {
    expect(() => validatePortablePaths(paths)).toThrow(new RegExp(`${rule}$`, "u"));
  });

  it("rejects every configured limit at limit plus one", () => {
    expect(() => validatePortablePaths([`a/${"b/".repeat(31)}c`])).toThrow(/LIMIT_DEPTH$/u);
    expect(() => validatePortablePaths(["a".repeat(513)])).toThrow(/LIMIT_PATH_BYTES$/u);
    expect(() => validateResourceLimits({ files: 8193 })).toThrow(/LIMIT_FILES$/u);
    expect(() => validateResourceLimits({ bytes: 134217729 })).toThrow(/LIMIT_BYTES$/u);
    expect(validateResourceLimits({ readBytes: 2097152 })).toBe(true);
    expect(() => validateResourceLimits({ readBytes: 2097153 })).toThrow(/LIMIT_READ_BYTES$/u);
    for (const maxReadBytes of [1048576, 2097151, 2097153]) {
      const altered = structuredClone(policy);
      altered.limits.maxReadBytes = maxReadBytes;
      expect(() => validatePolicy(altered)).toThrow(/POLICY_INVALID$/u);
    }
  });

  it("rejects special FIFO, hard links, and executable files", async () => {
    const fifoRoot = await fixture();
    await mkdir(path.join(fifoRoot, "scripts"), { recursive: true });
    await execFile("mkfifo", [path.join(fifoRoot, "scripts", "pipe.ts")]);
    await expect(run(fifoRoot)).rejects.toThrow(/:SPECIAL_FILE$/u);

    const hardlinkRoot = await fixture();
    await mkdir(path.join(hardlinkRoot, "scripts"), { recursive: true });
    const first = path.join(hardlinkRoot, "scripts", "first.ts");
    await writeFile(first, "x");
    await link(first, path.join(hardlinkRoot, "scripts", "second.ts"));
    await expect(run(hardlinkRoot)).rejects.toThrow(/:HARDLINK_PROHIBITED$/u);

    const executableRoot = await fixture();
    await mkdir(path.join(executableRoot, "scripts"), { recursive: true });
    const executable = path.join(executableRoot, "scripts", "run.ts");
    await writeFile(executable, "x");
    await chmod(executable, 0o755);
    await expect(run(executableRoot)).rejects.toThrow(/:EXECUTABLE_PROHIBITED$/u);
  });

  it("rejects root symlinks and noncanonical root aliases", async () => {
    const root = await fixture();
    const alias = `${root}-alias`;
    await symlink(root, alias, "dir");
    try {
      await expect(run(alias)).rejects.toThrow(/ROOT_NOT_CANONICAL$/u);
    } finally {
      await rm(alias, { force: true });
    }
    await expect(run(`${root}/ci/..`)).rejects.toThrow(/ROOT_NOT_CANONICAL$/u);
  });

  it("requires every exact legacy file and rejects mispaths", async () => {
    const missingRoot = await fixture();
    await rm(path.join(missingRoot, "AGENTS.md"));
    await expect(run(missingRoot)).rejects.toThrow(/:LEGACY_BOUNDARY_MISSING$/u);

    const mispathRoot = await fixture();
    await rm(path.join(mispathRoot, "docs/implementation/goal.md"));
    await writeFile(path.join(mispathRoot, "goal.md"), "misplaced\n");
    await expect(run(mispathRoot)).rejects.toThrow(/:LEGACY_BOUNDARY_MISSING$/u);
  });

  it("requires exact top-level kinds and presence", async () => {
    const missingRoot = await fixture();
    await rm(path.join(missingRoot, "apps"), { recursive: true });
    await expect(run(missingRoot)).rejects.toThrow(/:TOP_LEVEL_REQUIRED$/u);

    const wrongKindRoot = await fixture();
    await rm(path.join(wrongKindRoot, "package.json"));
    await mkdir(path.join(wrongKindRoot, "package.json"));
    await expect(run(wrongKindRoot)).rejects.toThrow(/:TOP_LEVEL_SHAPE_INVALID$/u);
  });

  it("rejects unregistered nested node_modules and generated laundering", async () => {
    const opaqueRoot = await fixture();
    await mkdir(path.join(opaqueRoot, "scripts/node_modules"), { recursive: true });
    await writeFile(path.join(opaqueRoot, "scripts/node_modules/marker.ts"), "hidden\n");
    await expect(run(opaqueRoot)).rejects.toThrow(/:OPAQUE_NODE_MODULES_UNREGISTERED$/u);

    const generatedRoot = await fixture();
    await mkdir(path.join(generatedRoot, "scripts/generated"), { recursive: true });
    await writeFile(path.join(generatedRoot, "scripts/generated/unregistered.ts"), "hidden\n");
    await expect(run(generatedRoot)).rejects.toThrow(/:GENERATED_NAMESPACE_PROHIBITED$/u);

    for (const denied of [
      "generated-code",
      "Generated.Files",
      "generated_sources",
      "codegen",
      "code-generation",
      "CODE_GENERATED",
      "AUTO-GEN",
      "auto.generated",
      "dist",
      "distfiles",
      "DIST.Output",
      "build-output",
      "Build.Artifacts",
      "gen",
      "out",
    ]) {
      const deniedRoot = await fixture();
      await mkdir(path.join(deniedRoot, "scripts", denied), { recursive: true });
      await writeFile(path.join(deniedRoot, "scripts", denied, "hidden.ts"), "hidden\n");
      await expect(run(deniedRoot)).rejects.toThrow(/:GENERATED_NAMESPACE_PROHIBITED$/u);
    }

    const ephemeralRoot = await fixture();
    await mkdir(path.join(ephemeralRoot, "apps/api/dist/generated"), { recursive: true });
    await writeFile(path.join(ephemeralRoot, "apps/api/dist/generated/output.ts"), "export {};\n");
    await expect(run(ephemeralRoot)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });

    for (const benign of ["distribution", "builder", "general", "outbound", "code-generator"]) {
      const benignRoot = await fixture();
      await mkdir(path.join(benignRoot, "scripts", benign), { recursive: true });
      await writeFile(path.join(benignRoot, "scripts", benign, "source.ts"), "export {};\n");
      await expect(run(benignRoot)).resolves.toMatchObject({
        outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
      });
    }
  });

  it.each([
    ["directive", [["@", "gene", "rated"].join("")].join("")],
    ["code", ["CoDe", " GeNe", "RaTeD"].join("")],
    ["producer", [["gene", "rated"].join(""), "   BY tool"].join("")],
    ["hyphenated auto", ["AUTO-", "GENE", "RATED"].join("")],
    ["spaced auto", ["Auto\t -  ", "Gene", "rated"].join("")],
    ["automatic", ["Automatically ", "Gene", "rated"].join("")],
    ["machine", ["Machine ", "Gene", "rated"].join("")],
    ["code present", ["This C.o_d-e Is ", "Gene", "rated"].join("")],
    ["code past", ["This Code Was ", "Gene", "rated"].join("")],
    ["source present", ["This Source File Is ", "Gene", "rated"].join("")],
    ["source past", ["This Source File Was ", "Gene", "rated"].join("")],
    ["present file", ["This File Is ", "Gene", "rated"].join("")],
    ["past file", ["This File Was ", "Gene", "rated"].join("")],
    [
      "paired warning",
      [["DO", "NOT", "EDIT"].join("-"), "AUTO", ["GENE", "RATED"].join("")].join(" "),
    ],
    [
      "paired modify warning",
      [["Do", "Not", "Modify"].join(" "), "Machine", ["Gene", "rated"].join("")].join(" "),
    ],
  ])("rejects closed generated banner grammar: %s", async (_label, banner) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `// ${banner}\nexport {};\n`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it("does not classify benign generated-language prose as a banner", async () => {
    const root = await fixture();
    const producerProse = [
      "The report was independently ",
      ["gene", "rated"].join(""),
      " by agents from reviewed inputs.",
    ].join("");
    const precededProducer = [
      "// Reviewed banner words ",
      ["Ge.ne", "_ra", "-ted.B", "_y"].join(""),
      " tool",
    ].join("");
    const broadSubject = [
      "// This is a ",
      ["gene", "rated"].join(""),
      " file used by the fixture.",
    ].join("");
    const unseparatedPhrase = ["// auto", "gene", "rated"].join("");
    await writeFile(
      path.join(root, "scripts/banner.ts"),
      [
        "This module compares generated artifacts after runtime review.",
        producerProse,
        precededProducer,
        broadSubject,
        unseparatedPhrase,
        "export {};",
        "",
      ].join("\n"),
    );
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("recognizes shell and HTML origin comments through end of file", async () => {
    const generated = ["gene", "rated"].join("");
    const shellRoot = await fixture();
    await writeFile(path.join(shellRoot, "scripts/banner.ts"), `# ${generated}.b_y fixture tool\n`);
    await expect(run(shellRoot)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);

    const htmlRoot = await fixture();
    const htmlBanner = ["This Source File Was ", generated, " By fixture tool"].join("");
    await writeFile(
      path.join(htmlRoot, "scripts/banner.ts"),
      `${"reviewed prose\n".repeat(120)}<!-- ${htmlBanner} -->`,
    );
    await expect(run(htmlRoot)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it("allows active-voice and comparison comments that are not origin banners", async () => {
    const generated = ["gene", "rated"].join("");
    const root = await fixture();
    const active = ["// This code ", generated, " the expected fixture at runtime."].join("");
    const comparison = ["// We compare machine-", generated, " and human inputs."].join("");
    await writeFile(path.join(root, "scripts/banner.ts"), `${active}\n${comparison}\nexport {};\n`);
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it.each([
    [
      "split slash subject and copula",
      ["// This file", "// was", `// ${["gene", "rated"].join("")} by fixture tool`].join("\n"),
    ],
    [
      "split hash source subject",
      ["# This source file", `# was ${["gene", "rated"].join("")}`, "# by fixture tool"].join("\n"),
    ],
    [
      "split producer declaration",
      [`// ${["Gene", "rated"].join("")}`, "// By fixture tool"].join("\n"),
    ],
    [
      "starred C block",
      ["/* This code was", ` * ${["gene", "rated"].join("")} by fixture tool`, " */"].join("\n"),
    ],
    [
      "multiline HTML block",
      ["<!-- This source file is", `${["gene", "rated"].join("")} by fixture tool`, "-->"].join(
        "\n",
      ),
    ],
    [
      "semicolon run",
      [`; ${["Machine", " gene", "rated"].join("")}`, "; By fixture tool"].join("\n"),
    ],
    ["dash run", [`-- ${["Auto", " gene", "rated"].join("")}`, "-- By fixture tool"].join("\n")],
  ])("rejects a structurally folded origin comment: %s", async (_label, source) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `${source}\nexport {};\n`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it.each([
    ["JSDoc producer", ["/** ", "Gene", "rated by fixture tool */"].join("")],
    ["JSDoc subject", ["/** This code was ", "gene", "rated by fixture tool */"].join("")],
    ["starred multiline JSDoc", ["/**\n * ", "Gene", "rated\n * By fixture tool\n */"].join("")],
    ["bang documentation block", ["/*! ", "Gene", "rated by fixture tool */"].join("")],
    ["decorative star block", ["/******** ", "Gene", "rated by fixture tool ********/"].join("")],
    ["automatic declaration", ["/** AUTO-", "GENE", "RATED */"].join("")],
    ["code declaration", ["/** Code ", "gene", "rated */"].join("")],
    ["attributed code declaration", ["/** Code ", "gene", "rated by fixture tool */"].join("")],
    ["punctuated code declaration", ["/** Code ", "gene", "rated! */"].join("")],
    ["decorative code declaration", ["/******** Code ", "gene", "rated ********/"].join("")],
  ])("rejects a decorated C origin declaration: %s", async (_label, source) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `${source}\nexport {};\n`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it("allows decorated C active voice, comparisons, and ordinary report prose", async () => {
    const generated = ["gene", "rated"].join("");
    const root = await fixture();
    await writeFile(
      path.join(root, "scripts/banner.ts"),
      [
        `/** Code ${generated} the expected fixture at runtime. */`,
        `/** Code ${generated} bytes for the expected fixture. */`,
        `/** Machine-${generated} output remains under review. */`,
        `/*! The report was ${generated} by users. */`,
        `/******** We compare machine-${generated} and human inputs. ********/`,
        "/** !important semantic punctuation remains later in text. */",
        "export {};",
        "",
      ].join("\n"),
    );
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("fails closed when a decorative C star run exceeds its reviewed bound", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `/*${"*".repeat(65)} ordinary */`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it.each([
    " ",
    "-",
    ".",
    "_",
    "\t",
  ])("rejects token-aware code origin declarations with %j separators", async (separator) => {
    const root = await fixture();
    const source = ["// Code", separator, "gene.rated", separator, "b_y", separator, "Tool"].join(
      "",
    );
    await writeFile(path.join(root, "scripts/banner.ts"), `${source}\nexport {};\n`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it.each([
    ["hyphenated producer", ["// ", "Gene", "rated-by-Tool"].join("")],
    ["dotted producer", ["// ", "Gene", "rated.By.Tool"].join("")],
    ["underscored producer", ["// ", "Gene", "rated_By_Tool"].join("")],
    ["machine producer", ["// Machine-", "Gene", "rated-by-Tool"].join("")],
    ["automatic producer", ["// Auto_", "Gene", "rated_by.Tool"].join("")],
    ["subject producer", ["// This.Source_File-was_", "Gene", "rated-by.Tool"].join("")],
    ["decorated multiline producer", ["/**\n * Code-", "gene.rated-by-Tool\n */"].join("")],
    ["bounded prohibition target", ["// Do-not-edit Auto-", "gene", "rated output"].join("")],
  ])("rejects token-boundary origin grammar: %s", async (_label, source) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `${source}\nexport {};\n`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it.each([
    ["generated bytes", ["// ", "Gene", "rated bytes"].join("")],
    ["obfuscated bytes token", ["// ", "Gene", "rated b_ytes"].join("")],
    ["code active voice", ["// Code-", "gene", "rated-the expected fixture"].join("")],
    ["machine setting", ["// Machine-", "gene", "rated settings remain reviewed"].join("")],
    ["auto retry setting", ["// Auto-", "gene", "rated retry settings remain reviewed"].join("")],
    ["unseparated phrase", ["// code", "gene", "rated-by Tool"].join("")],
    ["unseparated machine phrase", ["// machine", "gene", "rated-by Tool"].join("")],
    ["unseparated subject phrase", ["// thisfilewas", "gene", "rated-by Tool"].join("")],
    ["machine prohibition", "// Do not edit machine settings"],
    ["learning prohibition", "// Do not modify machine learning examples"],
    ["automation prohibition", "// Do not edit automation retry settings"],
    ["autobiography prohibition", "// Do not modify autobiography notes"],
  ])("allows a bounded non-origin phrase: %s", async (_label, source) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `${source}\nexport {};\n`);
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("does not fold origin fragments across syntax or comment families", async () => {
    const generated = ["gene", "rated"].join("");
    const root = await fixture();
    await writeFile(
      path.join(root, "scripts/banner.ts"),
      [
        "// This file was",
        "export const boundary = true;",
        `// ${generated.slice(0, -1)}`,
        "# This source file was",
        `// ${generated.slice(0, -1)}`,
        "",
      ].join("\n"),
    );
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("allows ordinary past-tense report claims inside comments", async () => {
    const generated = ["gene", "rated"].join("");
    const root = await fixture();
    await writeFile(
      path.join(root, "scripts/banner.ts"),
      [
        `// The report was ${generated} by agents from reviewed inputs.`,
        `// The user report was ${generated} by users.`,
        `// This code ${generated} the expected fixture at runtime.`,
        `// We compare machine-${generated} and human inputs.`,
        "export {};",
        "",
      ].join("\n"),
    );
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("does not treat Unicode whitespace as reviewed banner folding or indentation", async () => {
    const generated = ["Gene", "rated"].join("");
    const root = await fixture();
    await writeFile(
      path.join(root, "scripts/banner.ts"),
      [
        `// ${generated}\u00a0By fixture tool`,
        `\u00a0// ${generated} By fixture tool`,
        "export {};",
        "",
      ].join("\n"),
    );
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("fails closed on partial-origin unterminated blocks but permits benign ones", async () => {
    for (const body of [
      "/* C",
      "/* Code g",
      "/* Code generat",
      "/* Code generated b",
      "/** Code gene.rat",
      "/*! C_o",
      ["/* ", "Gene"].join(""),
      ["/* Machine ", "gene", "rated b"].join(""),
      ["/* This source fi"].join(""),
      ["/* This file i"].join(""),
      ["/* This code was ", "gene"].join(""),
    ]) {
      const originRoot = await fixture();
      await writeFile(path.join(originRoot, "scripts/banner.ts"), body);
      await expect(run(originRoot)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
    }

    for (const body of [
      "/* ordinary fixture discussion",
      ["/* The report was ", "gene", "rated by users"].join(""),
      ["/* We discussed this file was ", "gene", "rated by users"].join(""),
      "/* machine learning report",
      "/* this filing remains under review",
      ["/* ", "gene", "rated reports are compared"].join(""),
      "/* Code review remains pending",
      "/* Code generated bytes for the fixture",
      "/*! Code generation notes remain pending",
    ]) {
      const benignRoot = await fixture();
      await writeFile(path.join(benignRoot, "scripts/banner.ts"), body);
      await expect(run(benignRoot)).resolves.toMatchObject({
        outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
      });
    }
  });

  it.each([
    [
      "C block then slash banner",
      ["/* benign */ // This file was ", "gene", "rated by fixture tool."].join(""),
    ],
    [
      "adjacent HTML blocks",
      ["<!-- benign --> <!-- This file was ", "gene", "rated by fixture tool. -->"].join(""),
    ],
    [
      "multiline C close then producer",
      ["/* benign\n */ // ", "Gene", "rated by fixture tool."].join(""),
    ],
    [
      "multiline HTML close then producer",
      ["<!-- benign\n --> <!-- ", "Gene", "rated by fixture tool. -->"].join(""),
    ],
  ])("re-tokenizes a same-line remainder after a block terminator: %s", async (_label, source) => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), `${source}\nexport {};\n`);
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it("permits benign adjacent tokens and stops at ordinary same-line code", async () => {
    const generated = ["gene", "rated"].join("");
    const root = await fixture();
    await writeFile(
      path.join(root, "scripts/banner.ts"),
      [
        "/* benign */ <!-- ordinary review --> // human-authored fixture",
        "<!-- benign --> /* ordinary review */",
        `/* benign */ const text = "// This file was ${generated} by a tool";`,
        "export {};",
        "",
      ].join("\n"),
    );
    await expect(run(root)).resolves.toMatchObject({
      outcome: "LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS",
    });
  });

  it("fails closed when a comment span exceeds its reviewed line bound", async () => {
    const root = await fixture();
    const body = ["/* ordinary fixture discussion"].concat(
      Array.from(Array(256).fill(" * continuation")),
      [" */"],
    );
    await writeFile(path.join(root, "scripts/banner.ts"), body.join("\n"));
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it("fails closed when adjacent comment tokens exceed the monotonic tokenizer bound", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/banner.ts"), Array(4097).fill("/**/").join(""));
    await expect(run(root)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it("scans banners after line eight, after 4 KiB, and at end of file", async () => {
    const lineRoot = await fixture();
    const token = ["@", "gene", "rated"].join("");
    await writeFile(
      path.join(lineRoot, "scripts/banner.ts"),
      `${"// reviewed\n".repeat(8)}// ${token}\nexport {};\n`,
    );
    await expect(run(lineRoot)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);

    const byteRoot = await fixture();
    await writeFile(
      path.join(byteRoot, "scripts/banner.ts"),
      `// ${"x".repeat(4096)}${token}\nexport {};\n`,
    );
    await expect(run(byteRoot)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);

    const endRoot = await fixture();
    await writeFile(
      path.join(endRoot, "scripts/banner.ts"),
      `${"reviewed content\n".repeat(100)}// ${token}`,
    );
    await expect(run(endRoot)).rejects.toThrow(/:GENERATED_UNDOCUMENTED$/u);
  });

  it.each([
    ["duplicate", ["dist-tools", "dist-tools"]],
    ["out of order", ["packages/domain/dist", "dist-tools"]],
  ])("rejects B03 output namespace %s", async (_label, outputNamespaces) => {
    const root = await fixture();
    await writeFile(
      path.join(root, "ci/b03-policy.json"),
      JSON.stringify({
        schemaVersion: 4,
        policyId: "zintus-continuity-local-ci@14",
        reproducibility: { outputNamespaces },
      }),
    );
    await expect(run(root)).rejects.toThrow(/:B03_IDENTITY_MISMATCH$/u);
  });

  it("allows the synthetic marker only in exact legacy context", async () => {
    const allowedRoot = await fixture();
    await writeFile(path.join(allowedRoot, "AGENTS.md"), `${privateMarker}\n`);
    await expect(run(allowedRoot)).resolves.toMatchObject({
      publicReady: "PUBLIC_READY_BLOCKED",
    });

    const rejectedRoot = await fixture();
    await mkdir(path.join(rejectedRoot, "scripts"), { recursive: true });
    await writeFile(path.join(rejectedRoot, "scripts", "marker.ts"), `${privateMarker}\n`);
    await expect(run(rejectedRoot)).rejects.toThrow(/:PRIVATE_MARKER_CONTEXT$/u);
  });

  it("requires documented generated files and rejects generated additions", async () => {
    const missingRoot = await fixture();
    await rm(path.join(missingRoot, "ci/generated/local-provenance.json"));
    await expect(run(missingRoot)).rejects.toThrow(/:GENERATED_MISSING$/u);

    const undocumentedRoot = await fixture();
    await writeFile(path.join(undocumentedRoot, "ci/generated/untracked.json"), "{}\n");
    await expect(run(undocumentedRoot)).rejects.toThrow(/:GENERATED_NAMESPACE_PROHIBITED$/u);
  });

  it("binds production CLI success to the exact safe-verify environment", async () => {
    const script = path.join(repositoryRoot, "scripts", "verify-cleanroom.mjs");
    const assertFailure = async (operation: Promise<unknown>, marker: string, rule: string) => {
      let failure: unknown;
      try {
        await operation;
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: expect.not.stringMatching(/^0$/u),
        stdout: "",
        stderr: `cleanroom-error: <redacted>:${rule}\n`,
      });
      const stderr = String((failure as { stderr?: unknown }).stderr);
      expect(stderr.match(/\n/gu)).toHaveLength(1);
      expect(stderr).not.toContain(" at ");
      expect(stderr).not.toContain(repositoryRoot);
      expect(stderr).not.toContain(tmpdir());
      expect(stderr).not.toContain("node:");
      expect(stderr).not.toContain(process.version);
      expect(stderr).not.toContain(marker);
    };
    await assertFailure(
      execFile(process.execPath, [script, "attacker\nmarker"], {
        cwd: repositoryRoot,
        env: safeEnvironment(),
      }),
      "attacker",
      "CLI_OVERRIDE_PROHIBITED",
    );
    await assertFailure(
      execFile(process.execPath, [script], {
        cwd: repositoryRoot,
        env: mergeSyntheticRecords(safeEnvironment(), {
          AWS_ACCESS_KEY_ID: "attacker\nmarker",
        }),
      }),
      "attacker",
      "AMBIENT_ENV_PROHIBITED",
    );
    await expect(
      execFile(process.execPath, [script], {
        cwd: repositoryRoot,
        env: safeEnvironment(),
      }),
    ).resolves.toMatchObject({
      stderr: "",
      stdout: expect.stringMatching(
        /^cleanroom: SAFE_VERIFY_BOUND_LOCAL_SYNTHETIC_EXCLUSION_PASS_WITH_LIMITATIONS; PUBLIC_READY_BLOCKED\n$/u,
      ),
    });
  });

  it("rejects preload authority after entry without claiming pre-entry containment", async () => {
    const root = await fixture();
    const preload = path.join(root, "preload.cjs");
    await writeFile(preload, 'process.stderr.write("pre-entry-attacker-marker\\\\n");\n');
    const script = path.join(repositoryRoot, "scripts", "verify-cleanroom.mjs");
    let failure: unknown;
    try {
      await execFile(process.execPath, [script], {
        cwd: repositoryRoot,
        env: mergeSyntheticRecords(safeEnvironment("preload"), {
          NODE_OPTIONS: `--require=${preload}`,
        }),
      });
    } catch (error) {
      failure = error;
    }
    const observed = failure as { code?: unknown; stderr?: unknown; stdout?: unknown };
    expect(observed.code).not.toBe(0);
    expect(String(observed.stdout)).not.toContain("EXCLUSION_PASS");
    expect(String(observed.stderr)).toContain("pre-entry-attacker-marker");
    expect(String(observed.stderr)).toContain(
      "cleanroom-error: <redacted>:AMBIENT_ENV_PROHIBITED\n",
    );
    expect(String(observed.stderr)).not.toContain(" at ");
  });

  it("validates the exact safe-verify sanitizer cross-binding", async () => {
    const safeOwnDataPromise = Promise.resolve({ mergeOwnDataRecords, readOwnData, writeOwnData });
    const runRoot = path.join(repositoryRoot, ".zc-bootstrap", "run-cross-binding");
    const store = path.join(repositoryRoot, ".zc-pnpm-store");
    const paths = {
      cache: path.join(store, "cache"),
      config: path.join(runRoot, "config"),
      data: path.join(runRoot, "data"),
      globalConfig: path.join(runRoot, "config", "global.npmrc"),
      home: path.join(runRoot, "home"),
      state: path.join(store, "state"),
      store: path.join(store, "store"),
      temporary: path.join(runRoot, "tmp"),
      userConfig: path.join(runRoot, "config", "user.npmrc"),
      virtualStore: path.join(store, "virtual-store"),
    };
    const sanitized = await sanitizeEnvironment(
      {
        AWS_ACCESS_KEY_ID: "poison",
        LANG: "en_US.UTF-8",
        LC_ALL: "C.UTF-8",
        NODE_OPTIONS: "--require=poison",
        PATH: "/synthetic/bin",
        SystemRoot: "/synthetic/system-root",
      },
      paths,
      safeOwnDataPromise,
    );
    expect(sanitized).toMatchObject({
      LANG: "en_US.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/synthetic/bin",
      SystemRoot: "/synthetic/system-root",
    });
    expect(sanitized).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    expect(sanitized).not.toHaveProperty("NODE_OPTIONS");
    expect(() => validateSafeVerifyEnvironment(sanitized, repositoryRoot)).not.toThrow();

    const { LANG, LC_ALL, PATH: executablePath, SystemRoot, ...fixed } = safeEnvironment();
    const optionalSubsets = [
      {},
      { LANG },
      { LC_ALL },
      { PATH: executablePath },
      { SystemRoot },
      { LANG, LC_ALL },
      { LANG, PATH: executablePath },
      { LANG, SystemRoot },
      { LC_ALL, PATH: executablePath },
      { LC_ALL, SystemRoot },
      { PATH: executablePath, SystemRoot },
      { LANG, LC_ALL, PATH: executablePath },
      { LANG, LC_ALL, SystemRoot },
      { LANG, PATH: executablePath, SystemRoot },
      { LC_ALL, PATH: executablePath, SystemRoot },
      { LANG, LC_ALL, PATH: executablePath, SystemRoot },
    ];
    for (const subset of optionalSubsets) {
      const environment = { ...fixed, ...subset };
      expect(() => validateSafeVerifyEnvironment(environment, repositoryRoot)).not.toThrow();
    }
    const replaceFixed = [
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "CI", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "HOME", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "TEMP", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "TMP", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "TMPDIR", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "XDG_CACHE_HOME", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "XDG_CONFIG_HOME", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "XDG_DATA_HOME", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "XDG_STATE_HOME", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_cache", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_globalconfig", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_ignore_pnpmfile", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_ignore_scripts", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_store_dir", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_strict_dep_builds", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_userconfig", descriptor),
      (environment: object, descriptor: PropertyDescriptor) =>
        defineSyntheticProperty(environment, "npm_config_virtual_store_dir", descriptor),
    ];
    for (const replace of replaceFixed) {
      let getterReads = 0;
      const getterEnvironment = safeEnvironment();
      replace(getterEnvironment, {
        enumerable: true,
        get() {
          getterReads += 1;
          return "attacker";
        },
      });
      expect(() => validateSafeVerifyEnvironment(getterEnvironment, repositoryRoot)).toThrow(
        /:AMBIENT_ENV_PROHIBITED$/u,
      );
      expect(getterReads).toBe(0);

      const hiddenEnvironment = safeEnvironment();
      replace(hiddenEnvironment, { enumerable: false, value: "attacker" });
      expect(() => validateSafeVerifyEnvironment(hiddenEnvironment, repositoryRoot)).toThrow(
        /:AMBIENT_ENV_PROHIBITED$/u,
      );

      const nonStringEnvironment = safeEnvironment();
      replace(nonStringEnvironment, { enumerable: true, value: 1 });
      expect(() => validateSafeVerifyEnvironment(nonStringEnvironment, repositoryRoot)).toThrow(
        /:AMBIENT_ENV_PROHIBITED$/u,
      );
    }
    let ownKeyTrapReads = 0;
    const hiddenTarget = safeEnvironment();
    defineSyntheticProperty(hiddenTarget, "NODE_OPTIONS", {
      enumerable: false,
      value: "--require=poison",
    });
    const hiddenOwnProxy = createSyntheticProxy(hiddenTarget, {
      ownKeys() {
        ownKeyTrapReads += 1;
        return [];
      },
    });
    expect(() => validateSafeVerifyEnvironment(hiddenOwnProxy, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    expect(ownKeyTrapReads).toBe(0);

    let descriptorTrapReads = 0;
    const descriptorProxy = createSyntheticProxy(safeEnvironment(), {
      getOwnPropertyDescriptor() {
        descriptorTrapReads += 1;
        throw new Error("descriptor trap executed");
      },
    });
    expect(() => validateSafeVerifyEnvironment(descriptorProxy, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    expect(descriptorTrapReads).toBe(0);

    let duplicateOwnKeyTrapReads = 0;
    const duplicateOwnKeyProxy = createSyntheticProxy(safeEnvironment(), {
      ownKeys() {
        duplicateOwnKeyTrapReads += 1;
        return ["CI", "CI"];
      },
    });
    expect(() => validateSafeVerifyEnvironment(duplicateOwnKeyProxy, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    expect(duplicateOwnKeyTrapReads).toBe(0);

    let proxyPrototypeTrapReads = 0;
    const proxyPrototype = createSyntheticProxy(
      {},
      {
        ownKeys() {
          proxyPrototypeTrapReads += 1;
          return [];
        },
      },
    );
    const proxyPrototypeEnvironment = Object.assign(
      Object.create(proxyPrototype),
      safeEnvironment(),
    );
    expect(() => validateSafeVerifyEnvironment(proxyPrototypeEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    expect(proxyPrototypeTrapReads).toBe(0);

    for (const inherited of [
      { NODE_OPTIONS: "--require=poison" },
      { AWS_ACCESS_KEY_ID: "credential" },
    ]) {
      const environment = Object.assign(Object.create(inherited), safeEnvironment());
      expect(() => validateSafeVerifyEnvironment(environment, repositoryRoot)).toThrow(
        /:AMBIENT_ENV_PROHIBITED$/u,
      );
    }
    let inheritedGetterReads = 0;
    const getterPrototype = {};
    defineSyntheticProperty(getterPrototype, "NODE_OPTIONS", {
      enumerable: true,
      get() {
        inheritedGetterReads += 1;
        return "--require=poison";
      },
    });
    const inheritedGetterEnvironment = Object.assign(
      Object.create(getterPrototype),
      safeEnvironment(),
    );
    expect(() => validateSafeVerifyEnvironment(inheritedGetterEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    expect(inheritedGetterReads).toBe(0);

    const symbolPrototype = {};
    defineSyntheticProperty(symbolPrototype, Symbol("inherited-authority"), {
      enumerable: true,
      value: "credential",
    });
    const symbolEnvironment = Object.assign(Object.create(symbolPrototype), safeEnvironment());
    expect(() => validateSafeVerifyEnvironment(symbolEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    const hiddenNodeOptionsPrototype = {};
    defineSyntheticProperty(hiddenNodeOptionsPrototype, "NODE_OPTIONS", {
      enumerable: false,
      value: "--require=poison",
    });
    const hiddenNodeOptionsEnvironment = Object.assign(
      Object.create(hiddenNodeOptionsPrototype),
      safeEnvironment(),
    );
    expect(() =>
      validateSafeVerifyEnvironment(hiddenNodeOptionsEnvironment, repositoryRoot),
    ).toThrow(/:AMBIENT_ENV_PROHIBITED$/u);
    const hiddenCredentialPrototype = {};
    defineSyntheticProperty(hiddenCredentialPrototype, "AWS_SECRET_ACCESS_KEY", {
      enumerable: false,
      value: "credential",
    });
    const hiddenCredentialEnvironment = Object.assign(
      Object.create(hiddenCredentialPrototype),
      safeEnvironment(),
    );
    expect(() =>
      validateSafeVerifyEnvironment(hiddenCredentialEnvironment, repositoryRoot),
    ).toThrow(/:AMBIENT_ENV_PROHIBITED$/u);
    const pollutedPrototype = {};
    defineSyntheticProperty(pollutedPrototype, "arbitraryPrototypePollution", {
      enumerable: false,
      value: "poison",
    });
    const pollutedEnvironment = Object.assign(Object.create(pollutedPrototype), safeEnvironment());
    expect(() => validateSafeVerifyEnvironment(pollutedEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    let hiddenInheritedGetterReads = 0;
    const hiddenGetterPrototype = {};
    defineSyntheticProperty(hiddenGetterPrototype, "NODE_OPTIONS", {
      enumerable: false,
      get() {
        hiddenInheritedGetterReads += 1;
        return "--require=poison";
      },
    });
    const hiddenGetterEnvironment = Object.assign(
      Object.create(hiddenGetterPrototype),
      safeEnvironment(),
    );
    expect(() => validateSafeVerifyEnvironment(hiddenGetterEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    expect(hiddenInheritedGetterReads).toBe(0);

    const nativeLikePrototype = Object.create(Object.prototype);
    defineSyntheticProperty(nativeLikePrototype, "constructor", {
      enumerable: false,
      value: class SyntheticEnvironment {},
    });
    const nativeLikeEnvironment = Object.assign(
      Object.create(nativeLikePrototype),
      safeEnvironment(),
    );
    expect(() => validateSafeVerifyEnvironment(nativeLikeEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );
    const emptyCustomEnvironment = Object.assign(Object.create({}), safeEnvironment());
    expect(() => validateSafeVerifyEnvironment(emptyCustomEnvironment, repositoryRoot)).toThrow(
      /:AMBIENT_ENV_PROHIBITED$/u,
    );

    const nullPrototypeEnvironment = Object.assign(Object.create(null), safeEnvironment());
    expect(() =>
      validateSafeVerifyEnvironment(nullPrototypeEnvironment, repositoryRoot),
    ).not.toThrow();
    expect(() => validateSafeVerifyEnvironment(safeEnvironment(), repositoryRoot)).not.toThrow();
    expect(() =>
      validateSafeVerifyEnvironment(
        mergeSyntheticRecords(safeEnvironment(), { AWS_ACCESS_KEY_ID: "attacker" }),
        repositoryRoot,
      ),
    ).toThrow(/:AMBIENT_ENV_PROHIBITED$/u);
    expect(() =>
      validateSafeVerifyEnvironment(
        mergeSyntheticRecords(safeEnvironment(), { HOME: "/tmp/attacker" }),
        repositoryRoot,
      ),
    ).toThrow(/:SAFE_VERIFY_ENV_REQUIRED$/u);
    for (const environment of [
      { ...safeEnvironment(), PATH: 1 },
      { ...safeEnvironment(), __CF_USER_TEXT_ENCODING: "" },
      { ...safeEnvironment(), __CF_USER_TEXT_ENCODING: 1 },
      { ...safeEnvironment(), __CF_USER_TEXT_ENCODING: "invalid" },
      { ...safeEnvironment(), UNKNOWN: "attacker" },
    ]) {
      expect(() => validateSafeVerifyEnvironment(environment, repositoryRoot)).toThrow(
        /:AMBIENT_ENV_PROHIBITED$/u,
      );
    }
  });

  it("formats caught and unknown errors as one bounded content-free line", () => {
    let caught: unknown;
    try {
      validatePortablePaths(["attacker\\marker"]);
    } catch (error) {
      caught = error;
    }
    expect(formatCleanroomDiagnostic(caught)).toBe("cleanroom-error: <redacted>:PATH_INVALID\n");
    const unknown = formatCleanroomDiagnostic(new Error("attacker\nsecret"));
    expect(unknown).toBe("cleanroom-error: <redacted>:INTERNAL_FAILURE\n");
    expect(unknown).not.toContain("attacker");
  });
});
