import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  executableSourceExtensions,
  isExecutableSourcePath,
  preparseExecutableSource,
} from "./bounded-typescript-ast.mjs";
import { createLexicalBindings, isNameOnlyIdentifier } from "./lexical-bindings.mjs";
import { assertPathChain, establishTrustedRoot, inside } from "./path-safety.mjs";
import {
  mergeOwnDataRecords,
  ownDataEntries,
  ownDataKeys,
  readOwnData,
  writeOwnData,
} from "./safe-own-data.mjs";
import {
  postPreflightValidatorBootstrapProfile,
  trustAnchorPaths,
  utf8Order,
  verifyTrustPreflight,
} from "./verify-trust-preflight.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const canonicalRepository = path.dirname(path.dirname(scriptPath));
const workspacePrefix = "@zintus-continuity/";
const sourceExtensions = new Set(executableSourceExtensions);
const checkerAstBudgets = Object.freeze({
  maxAstDepth: 512,
  maxNodesPerFile: 262_144,
  maxResolveStepsPerFile: 1_048_576,
  maxTokenNesting: 512,
  maxTokensPerFile: 262_144,
});
const traversalLimits = Object.freeze({ directories: 4096, entries: 16_384 });
const builtins = new Set(
  builtinModules.flatMap((specifier) => [specifier, specifier.replace(/^node:/u, "")]),
);
const prohibitedCoreIdentifiers = new Set([
  "process",
  "require",
  "module",
  "__dirname",
  "__filename",
  "fetch",
  "WebSocket",
  "EventSource",
  "Deno",
  "Bun",
  "eval",
  "Function",
  "AsyncFunction",
  "GeneratorFunction",
  "AsyncGeneratorFunction",
]);
const prohibitedGlobalProperties = new Set(
  Array.from(prohibitedCoreIdentifiers).concat("global", "globalThis"),
);
const dynamicCodeProperties = new Set([
  "constructor",
  "eval",
  "Function",
  "AsyncFunction",
  "GeneratorFunction",
  "AsyncGeneratorFunction",
]);
const authorityBearingProperties = new Set(
  Array.from(dynamicCodeProperties).concat([
    "__proto__",
    "prototype",
    "caller",
    "callee",
    "arguments",
    "call",
    "apply",
    "bind",
  ]),
);
const alwaysProhibitedProperties = new Set(
  Array.from(dynamicCodeProperties).concat(["__proto__", "caller", "callee", "arguments"]),
);

function fail(message) {
  process.stderr.write(`dependency-boundary: ${message}\n`);
  process.exitCode = 1;
}

async function sourceFiles(root, directory) {
  await assertPathChain(root, directory);
  const files = [];
  const pending = [directory];
  let directories = 0;
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    directories += 1;
    if (directories > traversalLimits.directories) {
      throw new Error("dependency source traversal exceeds directory budget");
    }
    for (const entry of await readdir(current)) {
      entries += 1;
      if (entries > traversalLimits.entries) {
        throw new Error("dependency source traversal exceeds entry budget");
      }
      const candidate = path.join(current, entry);
      const proof = await assertPathChain(root, candidate);
      if (proof.stat.isDirectory()) {
        pending.push(candidate);
      } else if (proof.stat.isFile() && isExecutableSourcePath(candidate)) {
        files.push(candidate);
      }
    }
  }
  return files;
}

function owningLayer(layers, filename) {
  return ownDataEntries(layers).find(([, layer]) => inside(layer.sourceRoot, filename))?.[0];
}

function packageName(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function literalText(expression) {
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
}

function isLoaderCall(node) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "require" &&
    node.expression.name.text === "resolve"
  ) {
    return true;
  }
  return (
    ts.isElementAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "require" &&
    literalText(node.expression.argumentExpression) === "resolve"
  );
}

function moduleReferences(sourceFile, filename) {
  const issues = [];
  const references = [];
  const routes = [];

  function add(expression, kind) {
    const specifier = literalText(expression);
    if (specifier === undefined) {
      issues.push(`${filename} uses a non-literal or computed ${kind} module specifier`);
    } else {
      references.push(specifier);
      routes.push({ kind, specifier });
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        add(node.moduleSpecifier, ts.isImportDeclaration(node) ? "import" : "export");
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, "import-equals");
    } else if (isLoaderCall(node)) {
      if (node.arguments.length !== 1) {
        issues.push(`${filename} uses a module loader without exactly one literal argument`);
      } else {
        add(node.arguments[0], "dynamic");
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { issues, references, routes };
}

function bootstrapLoaderIssues(sourceFile, filename) {
  const issues = [];
  const lexical = createLexicalBindings(sourceFile);
  const authorityImports = new Set();
  for (const statement of sourceFile.statements) {
    const specifier = ts.isImportDeclaration(statement)
      ? literalText(statement.moduleSpecifier)
      : undefined;
    if (
      !ts.isImportDeclaration(statement) ||
      !["node:module", "module", "node:process", "process"].includes(specifier) ||
      !statement.importClause
    ) {
      continue;
    }
    if (statement.importClause.name) {
      authorityImports.add(lexical.bindingOf(statement.importClause.name));
    }
    if (
      statement.importClause.namedBindings &&
      ts.isNamespaceImport(statement.importClause.namedBindings)
    ) {
      authorityImports.add(lexical.bindingOf(statement.importClause.namedBindings.name));
    }
  }
  const dangerous = new Set(["createRequire", "getBuiltinModule", "register", "registerHooks"]);
  function authorityRoot(node, active = new Set()) {
    const current = lexical.unwrap(node);
    if (
      ts.isMetaProperty(current) &&
      current.keywordToken === ts.SyntaxKind.ImportKeyword &&
      current.name.text === "meta"
    ) {
      return true;
    }
    if (!ts.isIdentifier(current)) return false;
    const binding = lexical.bindingOf(current);
    if (!binding) return ["process", "module"].includes(current.text);
    if (authorityImports.has(binding)) return true;
    if (!binding.isConst || binding.mutated || !binding.initializer || active.has(binding)) {
      return false;
    }
    active.add(binding);
    const result = authorityRoot(binding.initializer, active);
    active.delete(binding);
    return result;
  }
  function directlyInspected(node) {
    let current = node;
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isTypeAssertionExpression(current.parent) ||
        ts.isSatisfiesExpression(current.parent) ||
        ts.isNonNullExpression(current.parent)) &&
      current.parent.expression === current
    ) {
      current = current.parent;
    }
    return (
      (ts.isPropertyAccessExpression(current.parent) ||
        ts.isElementAccessExpression(current.parent)) &&
      current.parent.expression === current
    );
  }
  function visit(node) {
    const member = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
    const property = member
      ? ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression
          ? lexical.constantString(node.argumentExpression, () => {})
          : undefined
      : undefined;
    const assignmentAliasesRoot =
      ((ts.isVariableDeclaration(node) && node.initializer) ||
        (ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          node.right)) &&
      authorityRoot(ts.isVariableDeclaration(node) ? node.initializer : node.right);
    const reflectGet =
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Reflect" &&
        !lexical.bindingOf(node.expression.expression) &&
        node.expression.name.text === "get") ||
        (ts.isElementAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "Reflect" &&
          !lexical.bindingOf(node.expression.expression) &&
          lexical.constantString(node.expression.argumentExpression, () => {}) === "get")) &&
      node.arguments.length > 0 &&
      authorityRoot(node.arguments[0]);
    const authorityEscape =
      (ts.isIdentifier(node) || ts.isMetaProperty(node)) &&
      !(ts.isIdentifier(node) && isNameOnlyIdentifier(node)) &&
      authorityRoot(node) &&
      !directlyInspected(node) &&
      !(
        ts.isIdentifier(node) &&
        (ts.isImportClause(node.parent) || ts.isNamespaceImport(node.parent)) &&
        node.parent.name === node
      );
    const ambientGlobal =
      ts.isIdentifier(node) &&
      ["globalThis", "global"].includes(node.text) &&
      !isNameOnlyIdentifier(node) &&
      !lexical.bindingOf(node);
    if (
      ts.isImportTypeNode(node) ||
      (ts.isIdentifier(node) &&
        ["require", "createRequire", "getBuiltinModule", "register", "registerHooks"].includes(
          node.text,
        )) ||
      (member && dangerous.has(property)) ||
      (member &&
        authorityRoot(node.expression) &&
        (property === undefined || property === "resolve")) ||
      assignmentAliasesRoot ||
      reflectGet ||
      authorityEscape ||
      ambientGlobal
    ) {
      issues.push(`${filename} uses a prohibited bootstrap loader authority`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return issues;
}

async function bootstrapNodeSnapshot(root, relative, profile, readCap) {
  const filename = path.join(root, relative);
  await assertPathChain(root, filename);
  const stat = await lstat(filename, { bigint: true });
  const approved = Math.min(profile.maxNodeBytes, readCap);
  if (
    !stat.isFile() ||
    (stat.mode & 0o7777n) !== 0o644n ||
    stat.nlink !== 1n ||
    stat.size < 1n ||
    stat.size > BigInt(approved)
  ) {
    throw new Error(`bootstrap topology node has invalid file identity: ${relative}`);
  }
  let handle;
  let bytes;
  try {
    handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    const sameIdentity = (value) =>
      value.isFile() &&
      value.dev === stat.dev &&
      value.ino === stat.ino &&
      value.mode === stat.mode &&
      value.nlink === stat.nlink &&
      value.size === stat.size;
    if (!sameIdentity(opened))
      throw new Error(`bootstrap topology node changed before read: ${relative}`);
    const bounded = Buffer.alloc(Number(stat.size) + 1);
    let offset = 0;
    while (offset < bounded.length) {
      const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (BigInt(offset) !== stat.size || !sameIdentity(await handle.stat({ bigint: true }))) {
      throw new Error(`bootstrap topology node changed while read: ${relative}`);
    }
    bytes = bounded.subarray(0, offset);
  } finally {
    await handle?.close();
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`bootstrap topology node is not strict UTF-8: ${relative}`);
  }
  if (
    bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ||
    source.includes("\r") ||
    !source.endsWith("\n")
  ) {
    throw new Error(`bootstrap topology node violates the source encoding profile: ${relative}`);
  }
  return {
    bytes,
    identity: `${stat.dev}:${stat.ino}`,
    snapshot: {
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      mode: Number(stat.mode & 0o777n),
      nlink: Number(stat.nlink),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    source,
  };
}

export async function derivePostPreflightValidatorBootstrapTopology(root) {
  const profile = postPreflightValidatorBootstrapProfile;
  const jsonDigest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (jsonDigest(profile) !== "190f91b74eed91d35f8893bed1c8f17400abb037f51adc02967b5f5ab4bb7956") {
    throw new Error("bootstrap topology R18 profile identity differs");
  }
  const canonicalRoot = await establishTrustedRoot(root, canonicalRepository);
  const anchors = new Set(trustAnchorPaths);
  const pending = [...profile.roots];
  const snapshots = new Map();
  const identities = new Set();
  let totalNodeBytes = 0;
  const edges = [];
  while (pending.length > 0) {
    const importer = pending.pop();
    if (snapshots.has(importer)) continue;
    if (!profile.nodes.includes(importer) || !anchors.has(importer)) {
      throw new Error(`bootstrap topology node is not reviewed and anchored: ${importer}`);
    }
    const filename = path.join(canonicalRoot, importer);
    const initial = await bootstrapNodeSnapshot(
      canonicalRoot,
      importer,
      profile,
      profile.maxTotalNodeBytes - totalNodeBytes,
    );
    if (identities.has(initial.identity))
      throw new Error("bootstrap topology repeats a file identity");
    identities.add(initial.identity);
    totalNodeBytes += initial.bytes.length;
    snapshots.set(importer, initial.snapshot);
    const { sourceFile } = preparseExecutableSource(initial.source, filename, checkerAstBudgets, {
      budget: "DEPENDENCY_AST_BUDGET_EXCEEDED",
      parse: "DEPENDENCY_PARSE_FAILED",
    });
    const modules = moduleReferences(sourceFile, filename);
    if (modules.issues.length > 0) throw new Error(modules.issues[0]);
    const loaderIssues = bootstrapLoaderIssues(sourceFile, filename);
    if (loaderIssues.length > 0) throw new Error(loaderIssues[0]);
    for (const { kind, specifier } of modules.routes) {
      if (kind !== "import") throw new Error(`bootstrap topology route is not static: ${importer}`);
      if (!specifier.startsWith(".")) continue;
      if (!/^\.\/[A-Za-z0-9-]+\.mjs$/u.test(specifier)) {
        throw new Error(`bootstrap topology route is not exact: ${importer} -> ${specifier}`);
      }
      const target = relativePath(canonicalRoot, path.resolve(path.dirname(filename), specifier));
      if (!/^scripts\/[^/]+\.mjs$/u.test(target) || !profile.nodes.includes(target)) {
        throw new Error(
          `bootstrap topology route is outside the fixed profile: ${importer} -> ${specifier}`,
        );
      }
      edges.push({ importer, kind, specifier, target });
      pending.push(target);
    }
  }
  const nodes = [...snapshots.keys()].sort(utf8Order);
  if (JSON.stringify(nodes) !== JSON.stringify([...profile.nodes])) {
    throw new Error("bootstrap topology nodes differ from the fixed profile");
  }
  const indegrees = new Map(nodes.map((node) => [node, 0]));
  for (const { target } of edges) indegrees.set(target, indegrees.get(target) + 1);
  const ready = nodes.filter((node) => indegrees.get(node) === 0);
  let visited = 0;
  while (ready.length > 0) {
    const importer = ready.pop();
    visited += 1;
    for (const { target } of edges.filter((edge) => edge.importer === importer)) {
      indegrees.set(target, indegrees.get(target) - 1);
      if (indegrees.get(target) === 0) ready.push(target);
    }
  }
  if (visited !== nodes.length) throw new Error("bootstrap topology contains a cycle");
  for (const [relative, expected] of snapshots) {
    const final = await bootstrapNodeSnapshot(canonicalRoot, relative, profile, expected.size);
    if (JSON.stringify(final.snapshot) !== JSON.stringify(expected)) {
      throw new Error(`bootstrap topology node changed during derivation: ${relative}`);
    }
  }
  edges.sort((left, right) => utf8Order(JSON.stringify(left), JSON.stringify(right)));
  const edgeJson = JSON.stringify(edges);
  const domain = profile.edgeDigestPrefix;
  const edgeSha256 = createHash("sha256").update(domain).update(edgeJson).digest("hex");
  if (
    edges.length !== profile.edgeCount ||
    Buffer.byteLength(domain) !== profile.edgeDigestPrefixBytes ||
    Buffer.byteLength(edgeJson) !== profile.edgeJsonBytes ||
    edgeSha256 !== profile.edgeSha256
  ) {
    throw new Error("bootstrap topology does not match the exact R5 derivation profile");
  }
  return Object.freeze({
    edgeCount: edges.length,
    edgeJsonBytes: Buffer.byteLength(edgeJson),
    edgeSha256,
    limitations: Object.freeze([...profile.limitations]),
    nodeCount: nodes.length,
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    rootCount: profile.roots.length,
    status: profile.derivationMatchLabel,
  });
}

function compilerDirectiveIssues(sourceFile, filename) {
  const issues = [];
  for (const directive of sourceFile.referencedFiles) {
    issues.push(`${filename} uses prohibited triple-slash path directive ${directive.fileName}`);
  }
  for (const directive of sourceFile.typeReferenceDirectives) {
    issues.push(`${filename} uses prohibited triple-slash types directive ${directive.fileName}`);
  }
  for (const directive of sourceFile.libReferenceDirectives) {
    issues.push(`${filename} uses prohibited triple-slash lib directive ${directive.fileName}`);
  }
  for (const dependency of sourceFile.amdDependencies) {
    issues.push(`${filename} uses prohibited AMD dependency ${dependency.path}`);
  }
  if (sourceFile.moduleName) {
    issues.push(`${filename} uses prohibited AMD module declaration ${sourceFile.moduleName}`);
  }
  return issues;
}

function authorityIssues(sourceFile, filename, step, allowedGlobals = new Set()) {
  const issues = [];
  const { bindingOf: resolveBinding, constantString, unwrap } = createLexicalBindings(sourceFile);

  function isUnboundNamed(node, names) {
    return ts.isIdentifier(node) && names.has(node.text) && resolveBinding(node) === undefined;
  }

  function isGlobalRoot(node, active = new Set()) {
    step();
    const current = unwrap(node);
    if (
      ts.isIdentifier(current) &&
      ["global", "globalThis"].includes(current.text) &&
      resolveBinding(current) === undefined
    ) {
      return true;
    }
    if (ts.isIdentifier(current)) {
      const binding = resolveBinding(current);
      if (
        !binding ||
        !binding.isConst ||
        binding.mutated ||
        !binding.initializer ||
        active.has(binding)
      ) {
        return false;
      }
      active.add(binding);
      try {
        return isGlobalRoot(binding.initializer, active);
      } finally {
        active.delete(binding);
      }
    }
    return false;
  }

  function propertyText(node) {
    return ts.isPropertyAccessExpression(node)
      ? node.name.text
      : constantString(node.argumentExpression, step);
  }

  function isSensitiveUse(node) {
    const parent = node.parent;
    return (
      (ts.isCallExpression(parent) && parent.expression === node) ||
      (ts.isNewExpression(parent) && parent.expression === node) ||
      (ts.isTaggedTemplateExpression(parent) && parent.tag === node)
    );
  }

  function isAmbientRoot(node, name) {
    return ts.isIdentifier(node) && node.text === name && resolveBinding(node) === undefined;
  }

  function visit(node) {
    if (ts.isTypeNode(node)) return;

    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isGlobalRoot(node.expression)
    ) {
      const property = propertyText(node);
      if (property === undefined) {
        issues.push(`${filename} uses computed access through a global authority root`);
      } else if (prohibitedGlobalProperties.has(property)) {
        issues.push(`${filename} accesses prohibited global authority property ${property}`);
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = propertyText(node);
      const sensitive = isSensitiveUse(node);
      if (
        property !== undefined &&
        (alwaysProhibitedProperties.has(property) ||
          (authorityBearingProperties.has(property) && sensitive))
      ) {
        issues.push(`${filename} accesses prohibited authority-bearing property ${property}`);
      } else if (ts.isElementAccessExpression(node) && property === undefined && sensitive) {
        issues.push(`${filename} invokes, constructs, tags, or chains unknown computed property`);
      }

      if (isAmbientRoot(node.expression, "Reflect")) {
        const parent = node.parent;
        const exactOwnKeysCall =
          property === "ownKeys" &&
          ts.isCallExpression(parent) &&
          parent.expression === node &&
          !parent.questionDotToken &&
          parent.arguments.length === 1;
        if (!exactOwnKeysCall) issues.push(`${filename} uses prohibited Reflect authority route`);
      }

      if (
        isAmbientRoot(node.expression, "Object") &&
        ["defineProperty", "getOwnPropertyDescriptor"].includes(property ?? "") &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        const key = node.parent.arguments[1]
          ? constantString(node.parent.arguments[1], step)
          : undefined;
        if (key !== undefined && authorityBearingProperties.has(key)) {
          issues.push(
            `${filename} uses Object.${property} for prohibited authority-bearing property ${key}`,
          );
        }
      }
    }

    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const property = node.propertyName ?? node.name;
      const text =
        ts.isIdentifier(property) || ts.isStringLiteralLike(property) ? property.text : undefined;
      if (text !== undefined && authorityBearingProperties.has(text)) {
        issues.push(`${filename} destructures prohibited authority-bearing property ${text}`);
      }
      const declaration = node.parent.parent;
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isGlobalRoot(declaration.initializer) &&
        (text === undefined || prohibitedGlobalProperties.has(text))
      ) {
        issues.push(`${filename} destructures prohibited or computed global authority`);
      }
    }

    if (
      ts.isTaggedTemplateExpression(node) &&
      (isUnboundNamed(node.tag, prohibitedCoreIdentifiers) ||
        ((ts.isPropertyAccessExpression(node.tag) || ts.isElementAccessExpression(node.tag)) &&
          authorityBearingProperties.has(propertyText(node.tag) ?? "")))
    ) {
      issues.push(`${filename} uses a prohibited dynamic-code tag`);
    }

    if (
      ts.isNewExpression(node) &&
      (isUnboundNamed(node.expression, prohibitedCoreIdentifiers) ||
        ((ts.isPropertyAccessExpression(node.expression) ||
          ts.isElementAccessExpression(node.expression)) &&
          authorityBearingProperties.has(propertyText(node.expression) ?? "")))
    ) {
      issues.push(`${filename} constructs prohibited dynamic code`);
    }

    if (
      ts.isIdentifier(node) &&
      prohibitedCoreIdentifiers.has(node.text) &&
      !allowedGlobals.has(node.text) &&
      resolveBinding(node) === undefined &&
      !isNameOnlyIdentifier(node)
    ) {
      issues.push(`${filename} references prohibited core authority ${node.text}`);
    }

    if (
      ts.isIdentifier(node) &&
      ["global", "globalThis"].includes(node.text) &&
      resolveBinding(node) === undefined
    ) {
      const parent = node.parent;
      const controlled =
        ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === node) ||
        (ts.isVariableDeclaration(parent) && parent.initializer === node);
      if (!controlled) issues.push(`${filename} escapes an uncontrolled global authority root`);
    }

    if (
      ts.isIdentifier(node) &&
      isGlobalRoot(node) &&
      !["global", "globalThis"].includes(node.text)
    ) {
      const parent = node.parent;
      const controlled =
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === node) ||
        (ts.isVariableDeclaration(parent) && parent.initializer === node);
      if (!controlled) {
        issues.push(`${filename} escapes an aliased global authority root ${node.text}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(new Set(issues));
}

function globalContractIssues(sourceFile, filename, allowedGlobals) {
  if (allowedGlobals.size === 0) return [];
  const lexical = createLexicalBindings(sourceFile);
  const apiImports = sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) && literalText(statement.moduleSpecifier) === "./api.js",
  );
  const apiImport = apiImports.at(0);
  const postDemoImports =
    apiImports.length === 1 &&
    apiImport?.importClause &&
    !apiImport.importClause.isTypeOnly &&
    apiImport.importClause.namedBindings &&
    ts.isNamedImports(apiImport.importClause.namedBindings)
      ? apiImport.importClause.namedBindings.elements.filter(
          (element) =>
            !element.isTypeOnly && !element.propertyName && element.name.text === "postDemo",
        )
      : [];
  const postDemoImport = postDemoImports.at(0);
  const postDemoBinding =
    postDemoImports.length === 1 && postDemoImport
      ? lexical.bindingOf(postDemoImport.name)
      : undefined;
  let fetchUses = 0;
  const issues = [];
  if (!postDemoBinding)
    issues.push(`${filename} lacks the reviewed ./api.js postDemo import binding`);
  function visit(node) {
    if (
      ts.isIdentifier(node) &&
      node.text === "fetch" &&
      lexical.bindingOf(node) === undefined &&
      !isNameOnlyIdentifier(node)
    ) {
      fetchUses += 1;
      const call = node.parent;
      if (
        !allowedGlobals.has("fetch") ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== "postDemo" ||
        lexical.bindingOf(call.expression) !== postDemoBinding ||
        call.arguments.at(1) !== node ||
        enclosingFunctionName(call) !== "run"
      )
        issues.push(`${filename} escapes or mutates the reviewed global fetch capability`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (fetchUses !== 1)
    issues.push(`${filename} must contain exactly one reviewed global fetch capability use`);
  return issues;
}

function resolutionCandidates(filename, specifier) {
  const base = path.resolve(path.dirname(filename), specifier);
  const extension = path.extname(base);
  const candidates = [base];
  if (extension === "") {
    for (const candidateExtension of sourceExtensions) {
      candidates.push(`${base}${candidateExtension}`);
      candidates.push(path.join(base, `index${candidateExtension}`));
    }
  } else if (extension === ".js") {
    candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  } else if (extension === ".mjs") {
    candidates.push(`${base.slice(0, -4)}.mts`);
  } else if (extension === ".cjs") {
    candidates.push(`${base.slice(0, -4)}.cts`);
  }
  return Array.from(new Set(candidates));
}

async function resolveRelativeImport(root, layers, filename, specifier) {
  for (const candidate of resolutionCandidates(filename, specifier)) {
    if (!inside(root, candidate)) {
      throw new Error(`import escapes the checked repository: ${filename} -> ${specifier}`);
    }
    try {
      const proof = await assertPathChain(root, candidate);
      if (!proof.stat.isFile()) {
        continue;
      }
      const owner = owningLayer(layers, candidate);
      if (!owner) {
        throw new Error(
          `import resolves outside every declared layer source: ${filename} -> ${specifier}`,
        );
      }
      return owner;
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`relative import is unresolved: ${filename} -> ${specifier}`);
}

function detectCycles(graph) {
  const visited = new Set();
  const active = [];
  function visit(layer) {
    const cycleStart = active.indexOf(layer);
    if (cycleStart !== -1) {
      fail(`cycle detected: ${active.slice(cycleStart).concat(layer).join(" -> ")}`);
      return;
    }
    if (visited.has(layer)) {
      return;
    }
    active.push(layer);
    for (const dependency of graph.get(layer) ?? []) {
      visit(dependency);
    }
    active.pop();
    visited.add(layer);
  }
  for (const layer of graph.keys()) {
    visit(layer);
  }
}

const capabilityKeys = new Set([
  "layer",
  "source",
  "declaration",
  "specifier",
  "imported",
  "local",
  "member",
  "callee",
  "function",
  "purpose",
]);
const reviewedCapabilities = Object.freeze([
  {
    callee: "nodeUtilTypes.isProxy",
    declaration: "apps/api/src/node-util-is-proxy.d.ts",
    function: "isProxy",
    imported: "types",
    layer: "api",
    local: "nodeUtilTypes",
    member: "isProxy",
    purpose: "Reject proxy-backed runtime results before public serialization",
    source: "apps/api/src/index.ts",
    specifier: "node:util",
  },
  {
    callee: "nodeUtilTypes.isProxy",
    declaration: "packages/adapters-local/src/node-util-is-proxy.d.ts",
    function: "rejectProxy",
    imported: "types",
    layer: "adapters-local",
    local: "nodeUtilTypes",
    member: "isProxy",
    purpose: "Node-local proxy rejection before reflective validation",
    source: "packages/adapters-local/src/local-synthetic-fixture.ts",
    specifier: "node:util",
  },
  {
    callee: "createHash",
    declaration: "packages/adapters-local/src/node-crypto-create-hash.d.ts",
    function: "sha256",
    imported: "createHash",
    layer: "adapters-local",
    local: "createHash",
    member: "createHash",
    purpose: "Bind each pre-transmission policy decision to exact outbound bytes",
    source: "packages/adapters-local/src/h4-bedrock-ports.ts",
    specifier: "node:crypto",
  },
  {
    callee: "nodeUtilTypes.isProxy",
    declaration: "packages/adapters-local/src/node-util-is-proxy.d.ts",
    function: "isProxy",
    imported: "types",
    layer: "adapters-local",
    local: "nodeUtilTypes",
    member: "isProxy",
    purpose:
      "Reject proxy-backed request, vector, row, and error values before reflective validation",
    source: "packages/adapters-local/src/hackathon-crdb.ts",
    specifier: "node:util",
  },
  ...[
    [
      "image-entry.ts",
      "nodeUtilTypes",
      "Reject proxy-backed image-runner values before reflective validation",
    ],
    [
      "image-worker.ts",
      "nodeUtilTypes",
      "Reject proxy-backed worker input before reflective validation",
    ],
    [
      "live-runtime.ts",
      "nodeTypes",
      "Reject proxy-backed live-runtime inputs before reflective validation",
    ],
    [
      "production-runtime.ts",
      "nodeUtilTypes",
      "Reject proxy-backed production composition inputs before validation",
    ],
  ].map(([source, local, purpose]) => ({
    callee: `${local}.isProxy`,
    declaration: "apps/api/src/node-util-is-proxy.d.ts",
    function: "isProxy",
    imported: "types",
    layer: "api",
    local,
    member: "isProxy",
    purpose,
    source: `apps/api/src/${source}`,
    specifier: "node:util",
  })),
]);
const reviewedImportBindings = Object.freeze({
  "apps/api/src/image-entry.ts": {
    "node:child_process": ["spawn"],
    "node:process": ["env", "kill"],
  },
  "apps/api/src/image-worker.ts": { "node:process": ["stdin", "stdout"] },
  "apps/api/src/index.ts": { "node:crypto": ["createHash", "randomBytes"] },
  "apps/api/src/live-runtime.ts": { "node:crypto": ["createHash", "randomUUID"] },
  "apps/api/src/production-runtime.ts": {
    "node:process": ["env"],
    "@aws-sdk/client-bedrock-runtime": [
      "BedrockRuntimeClient",
      "ConverseCommand",
      "InvokeModelCommand",
    ],
    pg: ["Pool"],
  },
  "packages/adapters-local/src/h4-bedrock-ports.ts": {
    "node:util": ["TextDecoder"],
    "@aws-sdk/client-bedrock-runtime": [
      "BedrockRuntimeClient",
      "ConverseCommand",
      "InvokeModelCommand",
    ],
  },
  "packages/adapters-local/src/hackathon-crdb.ts": { pg: ["Pool"] },
});
const reviewedImports = Object.freeze({
  "apps/api/src/image-entry.ts": ["node:child_process", "node:process"],
  "apps/api/src/image-worker.ts": ["node:process"],
  "apps/api/src/index.ts": ["node:crypto"],
  "apps/api/src/live-runtime.ts": ["node:crypto"],
  "apps/api/src/production-runtime.ts": ["node:process", "@aws-sdk/client-bedrock-runtime", "pg"],
  "packages/adapters-local/src/h4-bedrock-ports.ts": [
    "node:util",
    "@aws-sdk/client-bedrock-runtime",
  ],
  "packages/adapters-local/src/hackathon-crdb.ts": ["pg"],
});
const reviewedGlobals = Object.freeze({ "apps/web/src/main.tsx": ["fetch"] });

function exactImportIssues(sourceFile, source, specifiers) {
  const reviewed = readOwnData(reviewedImportBindings, source);
  const issues = [];
  for (const specifier of specifiers) {
    const expected = readOwnData(reviewed ?? {}, specifier);
    const declarations = sourceFile.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) && literalText(statement.moduleSpecifier) === specifier,
    );
    const declaration = declarations.at(0);
    const clause = declaration?.importClause;
    const bindings =
      declarations.length === 1 &&
      clause &&
      !clause.isTypeOnly &&
      !clause.name &&
      clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      !declaration?.attributes
        ? clause.namedBindings.elements.map((element) =>
            element.isTypeOnly || element.propertyName ? undefined : element.name.text,
          )
        : [];
    if (!expected || JSON.stringify(bindings) !== JSON.stringify(expected))
      issues.push(`${source} has expanded or reordered reviewed bindings for ${specifier}`);
  }
  return issues;
}

function relativePath(root, filename) {
  return path.relative(root, filename).split(path.sep).join("/");
}

function hasExactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    ownDataKeys(value).length === keys.size &&
    ownDataKeys(value).every((key) => keys.has(key))
  );
}

function capabilityField(capability, key) {
  switch (key) {
    case "callee":
      return capability.callee;
    case "declaration":
      return capability.declaration;
    case "function":
      return capability.function;
    case "imported":
      return capability.imported;
    case "layer":
      return capability.layer;
    case "local":
      return capability.local;
    case "member":
      return capability.member;
    case "purpose":
      return capability.purpose;
    case "source":
      return capability.source;
    case "specifier":
      return capability.specifier;
    default:
      return undefined;
  }
}

function capabilitySchemaIssues(root, layers, config) {
  const issues = [];
  const fullProfile = ownDataKeys(layers).length === 10;
  const expectedCapabilities = fullProfile ? reviewedCapabilities : [reviewedCapabilities.at(1)];
  if (fullProfile && JSON.stringify(config.imports) !== JSON.stringify(reviewedImports))
    issues.push("exact source import contracts differ from the reviewed value");
  if (fullProfile && JSON.stringify(config.globals) !== JSON.stringify(reviewedGlobals))
    issues.push("exact global capability contracts differ from the reviewed value");
  if (config.capabilities === undefined) {
    return readOwnData(layers, "adapters-local") !== undefined
      ? [`capabilities must contain exactly ${expectedCapabilities.length} reviewed capabilities`]
      : issues;
  }
  if (
    !Array.isArray(config.capabilities) ||
    config.capabilities.length !== expectedCapabilities.length
  ) {
    return [
      `capabilities must contain exactly ${expectedCapabilities.length} reviewed capabilities`,
    ];
  }
  for (const [index, capability] of config.capabilities.entries()) {
    const reviewed = expectedCapabilities.at(index);
    if (!hasExactKeys(capability, capabilityKeys)) {
      issues.push(`capability ${index} has an invalid schema`);
      continue;
    }
    for (const key of capabilityKeys) {
      if (
        typeof capabilityField(capability, key) !== "string" ||
        capabilityField(capability, key).length === 0
      ) {
        issues.push(`capability ${index} field ${key} must be a non-empty string`);
      }
    }
    for (const key of capabilityKeys) {
      if (capabilityField(capability, key) !== capabilityField(reviewed, key)) {
        issues.push(`capability ${index} field ${key} is not the reviewed value`);
      }
    }
    if (readOwnData(layers, String(capability.layer)) === undefined) {
      issues.push(`capability ${index} names an unknown layer ${capability.layer}`);
    } else {
      const layer = readOwnData(layers, String(capability.layer));
      for (const field of ["source", "declaration"]) {
        const candidate = path.resolve(root, readOwnData(capability, String(field)));
        if (!inside(layer.sourceRoot, candidate)) {
          issues.push(`capability ${index} ${field} is outside its layer source root`);
        }
      }
    }
  }
  return issues;
}

function importShapeMatches(node, capability) {
  const clause = node.importClause;
  const expectedElements =
    capability.callee === "createHash"
      ? ["createHash:createHash", "randomUUID:randomUUID"]
      : [`${capability.imported}:${capability.local}`];
  if (
    !clause ||
    clause.isTypeOnly ||
    clause.name ||
    !clause.namedBindings ||
    !ts.isNamedImports(clause.namedBindings) ||
    clause.namedBindings.elements.length !== expectedElements.length ||
    node.attributes
  ) {
    return false;
  }
  return clause.namedBindings.elements.every(
    (element, index) =>
      !element.isTypeOnly &&
      `${element.propertyName?.text ?? element.name.text}:${element.name.text}` ===
        expectedElements.at(index),
  );
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text;
    current = current.parent;
  }
  return undefined;
}

function capabilitySourceIssues(sourceFile, filename, capability, moduleReferencesForFile) {
  const issues = [];
  if (
    moduleReferencesForFile.filter((specifier) => specifier === capability.specifier).length !== 1
  ) {
    issues.push(`${filename} must contain exactly one module reference to ${capability.specifier}`);
  }
  const imports = sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      literalText(statement.moduleSpecifier) === capability.specifier,
  );
  if (imports.length !== 1 || !importShapeMatches(imports[0], capability)) {
    issues.push(`${filename} lacks the exact reviewed capability import`);
  }
  let calls = 0;
  function visit(node) {
    if (
      ts.isIdentifier(node) &&
      node.text === capability.local &&
      !(ts.isImportSpecifier(node.parent) && node.parent.name === node)
    ) {
      const property = node.parent;
      const memberCall =
        ts.isPropertyAccessExpression(property) && property.expression === node
          ? property.parent
          : undefined;
      const call =
        memberCall && ts.isCallExpression(memberCall)
          ? memberCall
          : ts.isCallExpression(property)
            ? property
            : undefined;
      const directCall =
        call !== undefined &&
        !call.questionDotToken &&
        enclosingFunctionName(call) === capability.function &&
        ((call.expression === node &&
          capability.callee === capability.local &&
          call.arguments.length === 1 &&
          literalText(call.arguments.at(0)) === "sha256") ||
          (ts.isPropertyAccessExpression(property) &&
            property.expression === node &&
            property.name.text === capability.member &&
            !property.questionDotToken &&
            call.expression === property &&
            call.arguments.length === 1 &&
            ts.isIdentifier(call.arguments.at(0)) &&
            call.arguments.at(0)?.text === "value"));
      if (!directCall) {
        issues.push(`${filename} escapes or mutates the reviewed capability binding`);
      } else {
        calls += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (calls !== 1) {
    issues.push(
      `${filename} must contain exactly one direct ${capability.callee} call in ${capability.function}`,
    );
  }
  return issues;
}

function isExactNodeUtilDeclaration(sourceFile, capability) {
  if (sourceFile.statements.length !== 1) return false;
  const [statement] = sourceFile.statements;
  if (
    !ts.isModuleDeclaration(statement) ||
    !ts.isStringLiteral(statement.name) ||
    statement.name.text !== capability.specifier ||
    !statement.body ||
    !ts.isModuleBlock(statement.body) ||
    statement.body.statements.length !== 1 ||
    !(statement.flags & ts.NodeFlags.Ambient)
  ) {
    return false;
  }
  const [bodyStatement] = statement.body.statements;
  if (
    !ts.isVariableStatement(bodyStatement) ||
    !bodyStatement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
    !(bodyStatement.declarationList.flags & ts.NodeFlags.Const) ||
    bodyStatement.declarationList.declarations.length !== 1
  ) {
    return false;
  }
  const [declaration] = bodyStatement.declarationList.declarations;
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== capability.imported ||
    declaration.initializer ||
    !declaration.type ||
    !ts.isTypeLiteralNode(declaration.type) ||
    declaration.type.members.length !== 1
  ) {
    return false;
  }
  const expectedMembers = [capability.member];
  return declaration.type.members.every((member, index) => {
    const expectedMember = expectedMembers.at(index);
    if (
      !ts.isPropertySignature(member) ||
      !member.type ||
      !ts.isFunctionTypeNode(member.type) ||
      member.type.parameters.length !== 1 ||
      member.questionToken ||
      !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
    ) {
      return false;
    }
    const [parameter] = member.type.parameters;
    return (
      ts.isIdentifier(member.name) &&
      member.name.text === expectedMember &&
      ts.isIdentifier(parameter.name) &&
      parameter.name.text === "value" &&
      parameter.type?.kind === ts.SyntaxKind.UnknownKeyword &&
      member.type.type.kind === ts.SyntaxKind.BooleanKeyword
    );
  });
}

function ambientModuleIssues(sourceFile, filename, capability) {
  const declarations = [];
  function visit(node) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) declarations.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (declarations.length === 0) return [];
  if (
    capability &&
    relativePath(capability.root, filename) === capability.declaration &&
    (isExactNodeUtilDeclaration(sourceFile, capability) ||
      (capability.callee === "createHash" &&
        sourceFile.text ===
          'declare module "node:crypto" {\n  export function createHash(algorithm: "sha256"): {\n    update(value: string, encoding: "utf8"): { digest(encoding: "hex"): string };\n  };\n}\n'))
  ) {
    return [];
  }
  return [`${filename} declares a prohibited ambient external module`];
}

export async function main(requestedRoot = process.argv[2]) {
  try {
    const root = await establishTrustedRoot(requestedRoot, canonicalRepository);
    const canonicalRoot = await realpath(canonicalRepository);
    let validationStatus = "NOT_APPLICABLE_NONCANONICAL_FIXTURE";
    if (root === canonicalRoot) {
      await verifyTrustPreflight(root, process.env);
      const summary = await derivePostPreflightValidatorBootstrapTopology(root);
      if (
        summary.status !== postPreflightValidatorBootstrapProfile.derivationMatchLabel ||
        JSON.stringify(summary.limitations) !==
          JSON.stringify(postPreflightValidatorBootstrapProfile.limitations)
      ) {
        throw new Error("post-preflight bootstrap derivation summary is invalid");
      }
      validationStatus = `${postPreflightValidatorBootstrapProfile.closurePassLabel}; limitations=${summary.limitations.join(",")}`;
    }
    const configPath = path.join(root, "architecture-boundaries.json");
    await assertPathChain(root, configPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const layers = {};

    for (const [name, layer] of ownDataEntries(config.layers)) {
      const absolutePath = path.resolve(root, layer.path);
      const sourceRoot = path.join(absolutePath, "src");
      if (!inside(root, absolutePath)) {
        throw new Error(`declared layer escapes trusted root: ${name}`);
      }
      await assertPathChain(root, absolutePath);
      await assertPathChain(root, sourceRoot);
      writeOwnData(layers, name, mergeOwnDataRecords(layer, { absolutePath, sourceRoot }));
    }

    for (const issue of capabilitySchemaIssues(root, layers, config)) {
      fail(issue);
    }
    const capabilities = (config.capabilities ?? []).map((capability) => ({
      callee: capability.callee,
      declaration: capability.declaration,
      function: capability.function,
      imported: capability.imported,
      layer: capability.layer,
      local: capability.local,
      member: capability.member,
      purpose: capability.purpose,
      root,
      source: capability.source,
      specifier: capability.specifier,
    }));
    const seenCapabilitySources = new Set();
    const seenCapabilityDeclarations = new Set();
    const seenGlobalSources = new Set();
    const seenImportSources = new Set();

    const graph = new Map(ownDataKeys(layers).map((name) => [name, new Set()]));

    for (const [name, layer] of ownDataEntries(layers)) {
      const manifestPath = path.join(layer.absolutePath, "package.json");
      try {
        await assertPathChain(root, manifestPath);
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const declared = mergeOwnDataRecords(
          manifest.dependencies,
          manifest.optionalDependencies,
          manifest.peerDependencies,
        );
        for (const dependency of ownDataKeys(declared)) {
          if (dependency.startsWith(workspacePrefix)) {
            const target = dependency.slice(workspacePrefix.length).split("/")[0];
            if (!layer.allow.includes(target)) {
              fail(`${name} declares forbidden workspace dependency: ${dependency}`);
            }
          } else if (
            !(layer.external ?? []).includes(dependency) &&
            !ownDataEntries(config.imports ?? {}).some(
              ([source, specifiers]) =>
                owningLayer(layers, path.join(root, source)) === name &&
                specifiers.some((specifier) => packageName(specifier) === dependency),
            )
          ) {
            fail(`${name} declares forbidden production dependency: ${dependency}`);
          }
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }

      for (const filename of await sourceFiles(root, layer.sourceRoot)) {
        let prepared;
        try {
          prepared = preparseExecutableSource(
            await readFile(filename, "utf8"),
            filename,
            checkerAstBudgets,
            {
              budget: "DEPENDENCY_AST_BUDGET_EXCEEDED",
              parse: "DEPENDENCY_PARSE_FAILED",
            },
          );
        } catch (error) {
          fail(`${name} ${error instanceof Error ? error.message : "dependency source rejected"}`);
          continue;
        }
        const { sourceFile, step } = prepared;
        const modules = moduleReferences(sourceFile, filename);
        const relative = relativePath(root, filename);
        const exactImports = readOwnData(config.imports ?? {}, relative) ?? [];
        const exactGlobals = new Set(readOwnData(config.globals ?? {}, relative) ?? []);
        if (exactImports.length > 0) {
          seenImportSources.add(relative);
          for (const specifier of exactImports) {
            if (modules.references.filter((reference) => reference === specifier).length !== 1)
              fail(`${name} ${filename} lacks the exact reviewed import ${specifier}`);
          }
          for (const issue of exactImportIssues(sourceFile, relative, exactImports))
            fail(`${name} ${issue}`);
        }
        if (exactGlobals.size > 0) {
          seenGlobalSources.add(relative);
          for (const issue of globalContractIssues(sourceFile, filename, exactGlobals))
            fail(`${name} ${issue}`);
        }
        const capability = capabilities.find(
          (candidate) =>
            candidate.layer === name && relativePath(root, filename) === candidate.source,
        );
        if (capability) {
          seenCapabilitySources.add(capability.source);
          for (const issue of capabilitySourceIssues(
            sourceFile,
            filename,
            capability,
            modules.references,
          )) {
            fail(`${name} ${issue}`);
          }
        }
        const declarationCapability = capabilities.find(
          (candidate) =>
            candidate.layer === name && relativePath(root, filename) === candidate.declaration,
        );
        if (declarationCapability)
          seenCapabilityDeclarations.add(declarationCapability.declaration);
        for (const issue of ambientModuleIssues(sourceFile, filename, declarationCapability)) {
          fail(`${name} ${issue}`);
        }
        for (const issue of compilerDirectiveIssues(sourceFile, filename)) {
          fail(`${name} ${issue}`);
        }
        for (const issue of modules.issues) {
          fail(`${name} ${issue}`);
        }
        for (const issue of authorityIssues(sourceFile, filename, step, exactGlobals)) {
          fail(`${name} ${issue}`);
        }

        for (const specifier of modules.references) {
          let target;
          const normalizedSpecifier = specifier.replace(/^node:/u, "");
          if (
            specifier.startsWith("node:") ||
            builtins.has(normalizedSpecifier) ||
            specifier.startsWith("@aws-sdk/") ||
            specifier.startsWith("@google-cloud/") ||
            specifier.startsWith("@azure/")
          ) {
            if (
              !(capability && specifier === capability.specifier) &&
              !exactImports.includes(specifier)
            ) {
              fail(`${name} ${filename} imports prohibited builtin or provider SDK: ${specifier}`);
            }
            continue;
          }
          if (specifier.startsWith(".")) {
            try {
              target = await resolveRelativeImport(root, layers, filename, specifier);
            } catch (error) {
              fail(`${name} ${error.message}`);
              continue;
            }
          } else if (specifier.startsWith(workspacePrefix)) {
            target = specifier.slice(workspacePrefix.length).split("/")[0];
            if (readOwnData(layers, String(target)) === undefined) {
              fail(`${name} imports unknown workspace package: ${specifier}`);
              continue;
            }
          } else {
            const external = packageName(specifier);
            const pathScoped = ownDataEntries(config.imports ?? {}).some(
              ([source, specifiers]) =>
                owningLayer(layers, path.join(root, source)) === name &&
                specifiers.some((reviewed) => packageName(reviewed) === external),
            );
            if (
              (pathScoped && !exactImports.includes(specifier)) ||
              (!pathScoped && !(layer.external ?? []).includes(external))
            ) {
              fail(`${name} imports forbidden external package: ${specifier}`);
            }
            continue;
          }
          if (target !== name) {
            graph.get(name).add(target);
            if (!layer.allow.includes(target)) {
              fail(`${name} cannot depend on ${target}: ${filename} -> ${specifier}`);
            }
          }
        }
      }
    }

    for (const capability of capabilities) {
      if (!seenCapabilitySources.has(capability.source)) {
        fail(`capability source is absent: ${capability.source}`);
      }
      if (!seenCapabilityDeclarations.has(capability.declaration)) {
        fail(`capability declaration is absent: ${capability.declaration}`);
      }
    }
    for (const source of ownDataKeys(config.imports ?? {})) {
      if (!seenImportSources.has(source)) fail(`exact import source is absent: ${source}`);
    }
    for (const source of ownDataKeys(config.globals ?? {})) {
      if (!seenGlobalSources.has(source)) fail(`global capability source is absent: ${source}`);
    }

    detectCycles(graph);
    if (!process.exitCode) {
      process.stdout.write(
        `dependency-boundary: PASS (${ownDataKeys(layers).length} layers; status=${validationStatus})\n`,
      );
    }
  } catch (error) {
    fail(error.message);
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
