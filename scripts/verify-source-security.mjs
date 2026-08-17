import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  assertAstBudgets,
  executableSourceExtensions,
  isExecutableSourcePath,
  preparseExecutableSource,
} from "./bounded-typescript-ast.mjs";
import { createLexicalBindings, isNameOnlyIdentifier } from "./lexical-bindings.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const secretRules = [
  ["SECRET_AWS_ACCESS_KEY", new RegExp(`A${"KIA"}[0-9A-Z]{16}`, "u")],
  ["SECRET_PRIVATE_KEY", new RegExp(`${"-----BEGIN"} (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`, "u")],
  [
    "SECRET_LITERAL_ASSIGNMENT",
    /\b(?:password|passwd|api_key|access_token|client_secret)\b\s*[:=]\s*["'][^"'\r\n]{16,}["']/iu,
  ],
];
const sastRules = [["SAST_SHELL_EXECUTION", /\bshell\s*:\s*true\b/u]];
const utf8Order = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ownedJsonTypeExports = Object.freeze(["OwnedJson", "OwnedJsonArray", "OwnedJsonObject"]);
const ownedJsonCallArities = new Map([
  ["isOwnedJsonArray", 1],
  ["isOwnedJsonObject", 1],
  ["ownedJsonAt", 2],
  ["ownedJsonEntries", 1],
  ["ownedJsonLength", 1],
  ["parseOwnedJson", 2],
  ["readOwnedJson", 2],
]);
const ownedJsonRuntimeExports = Object.freeze(Array.from(ownedJsonCallArities.keys()));
const ownedJsonReviewedBuildDigests = Object.freeze({
  runtimeJs: "eddc6412c76cedb0418553abb02256aff2ce818fe814492a69cc22737dae4843",
  declarations: "f51e3f08271d6d2ca229921ad89210fcdf1f7652a9b81495b8bb950d3acfcadb",
  declarationMap: "00c3c22ca1fb7955a394dae03daff75644c5df23290d880320963fa02ff32480",
});
const trustedReflectionPolicy = Object.freeze({
  schemaVersion: 1,
  modules: Object.freeze([
    Object.freeze({
      path: "packages/foundation/src/owned-json.ts",
      sha256: "b381840938518ab96f7bb9f1c8aa502a8f9fe06163b66e5022adaa3cf56ea3f2",
      capabilities: Object.freeze(["implicit_data_access"]),
    }),
    Object.freeze({
      path: "packages/foundation/src/safe-data-access.ts",
      sha256: "58f5782127ef3e4fc533f786805bc0ac18a64cc4fe3287a31a41c5ab734d014f",
      capabilities: Object.freeze([
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ]),
    }),
    Object.freeze({
      path: "scripts/safe-own-data.mjs",
      sha256: "c96676a734471f8598b9ddd00a22f5aadf14cfc0bbfdfe147bbc2ddaa900ba51",
      capabilities: Object.freeze([
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ]),
    }),
    Object.freeze({
      path: "scripts/synthetic-test-data.mjs",
      sha256: "146dbcb9161c72c81841dee6149db65ea1e9d03ba4d4236afed0b4c876549faf",
      capabilities: Object.freeze([
        "computed_data_access",
        "implicit_data_access",
        "unsupported_authority",
      ]),
    }),
  ]),
});
const trustedReflectionCapabilities = Object.freeze([
  "computed_data_access",
  "implicit_data_access",
  "unsupported_authority",
]);
function assertTrustedReflectionPolicy() {
  const paths = trustedReflectionPolicy.modules.map((entry) => entry.path);
  if (
    trustedReflectionPolicy.schemaVersion !== 1 ||
    trustedReflectionPolicy.modules.length !== 4 ||
    new Set(paths).size !== paths.length ||
    trustedReflectionPolicy.modules.some(
      (entry) =>
        !/^[0-9a-f]{64}$/u.test(entry.sha256) ||
        JSON.stringify(entry.capabilities) !==
          JSON.stringify(
            entry.path === "packages/foundation/src/owned-json.ts"
              ? ["implicit_data_access"]
              : trustedReflectionCapabilities,
          ),
    )
  ) {
    throw new Error("source-security trusted reflection policy is invalid");
  }
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const htmlRuleIds = [
  "HTML_ACTIVE_URL_SCHEME",
  "HTML_EXTERNAL_RESOURCE_URL",
  "HTML_INLINE_EVENT_HANDLER",
  "HTML_INLINE_SCRIPT_BODY",
  "HTML_LOCAL_ASSET_POLICY",
  "HTML_SRCDOC",
  "HTML_UNSUPPORTED_HTML",
];

function htmlLexicalFindings(text, relative, root, configuration) {
  const findings = new Set();
  const add = (rule) => findings.add(rule);
  const expectedVariants = [
    "ascii-case-insensitive-names",
    "ascii-whitespace",
    "common-html-entities",
    "percent-decoding",
    "backslash-rejection",
    "ascii-control-scheme-folding",
    "decoded-rel-tokenization",
  ];
  if (
    configuration.schemaVersion !== 2 ||
    JSON.stringify(configuration.rules) !== JSON.stringify(htmlRuleIds) ||
    JSON.stringify(configuration.normalizedVariants) !== JSON.stringify(expectedVariants) ||
    !Number.isInteger(configuration.maxTagsPerFile) ||
    !Number.isInteger(configuration.maxAttributesPerTag) ||
    !Number.isInteger(configuration.maxTagCharacters) ||
    !Number.isInteger(configuration.maxDecodePasses) ||
    configuration.maxTagsPerFile < 1 ||
    configuration.maxAttributesPerTag < 1 ||
    configuration.maxTagCharacters < 64 ||
    configuration.maxDecodePasses < 1 ||
    configuration.maxDecodePasses > 4
  )
    throw new Error("source-security HTML lexical policy is invalid");
  const rootRules = configuration.documentRoots.filter(
    ({ pathPrefix }) => relative === pathPrefix || relative.startsWith(`${pathPrefix}/`),
  );
  if (rootRules.length !== 1) {
    add("HTML_UNSUPPORTED_HTML");
    return findings;
  }
  const rootRule = rootRules[0];
  for (const value of [rootRule.pathPrefix, rootRule.assetRoot]) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      path.isAbsolute(value) ||
      value.includes("\\") ||
      value.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      add("HTML_UNSUPPORTED_HTML");
      return findings;
    }
  }
  const assetRoot = path.resolve(root, rootRule.assetRoot);
  if (!inside(root, assetRoot)) {
    add("HTML_UNSUPPORTED_HTML");
    return findings;
  }
  const namedEntities = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["bsol", "\\"],
    ["colon", ":"],
    ["newline", "\n"],
    ["quot", '"'],
    ["sol", "/"],
    ["tab", "\t"],
  ]);
  const foldAsciiControls = (value) =>
    Array.from(value)
      .filter((character) => {
        const code = character.codePointAt(0);
        return code > 0x20 && code !== 0x7f;
      })
      .join("")
      .toLowerCase();
  const decodeValue = (input) => {
    let value = input;
    for (let pass = 0; pass < configuration.maxDecodePasses; pass += 1) {
      const prior = value;
      value = value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (_match, hexadecimal, decimal) => {
        const point = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : "\u0000";
      });
      value = value.replace(/&([a-z]+);?/giu, (match, name) =>
        namedEntities.has(name.toLowerCase()) ? namedEntities.get(name.toLowerCase()) : match,
      );
      if (/%(?![0-9a-f]{2})/iu.test(value)) throw new Error("ambiguous percent escape");
      if (/%[0-9a-f]{2}/iu.test(value)) {
        try {
          value = decodeURIComponent(value);
        } catch {
          throw new Error("ambiguous percent escape");
        }
      }
      if (value === prior) break;
    }
    if (
      /&#|&(?!amp;|apos;|bsol;|colon;|newline;|quot;|sol;|tab;)[a-z]+;/iu.test(value) ||
      /%[0-9a-f]{2}/iu.test(value) ||
      value.includes("\u0000")
    )
      throw new Error("ambiguous encoded value");
    return value;
  };
  const classifyUrl = (raw) => {
    let value;
    try {
      value = decodeValue(raw).trim();
    } catch {
      add("HTML_UNSUPPORTED_HTML");
      return;
    }
    const folded = foldAsciiControls(value);
    if (folded.startsWith("javascript:") || folded.startsWith("data:text/html")) {
      add("HTML_ACTIVE_URL_SCHEME");
      return;
    }
    if (
      value.length === 0 ||
      value.includes("\\") ||
      value.startsWith("//") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(folded)
    ) {
      add(
        value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(folded)
          ? "HTML_EXTERNAL_RESOURCE_URL"
          : "HTML_LOCAL_ASSET_POLICY",
      );
      return;
    }
    const pathname = value.split(/[?#]/u, 1)[0];
    if (pathname.length === 0) return;
    const segments = pathname.replace(/^\/+/u, "").split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      add("HTML_LOCAL_ASSET_POLICY");
      return;
    }
    const candidate = pathname.startsWith("/")
      ? path.resolve(assetRoot, pathname.slice(1))
      : path.resolve(path.dirname(path.join(root, relative)), pathname);
    if (!inside(assetRoot, candidate)) add("HTML_LOCAL_ASSET_POLICY");
  };
  const classifySrcset = (raw) => {
    const entries = raw.split(",");
    if (entries.length === 0 || entries.some((entry) => entry.trim().length === 0)) {
      add("HTML_UNSUPPORTED_HTML");
      return;
    }
    for (const entry of entries) {
      const parts = entry.trim().split(/[\t\n\f\r ]+/u);
      const url = parts.at(0);
      const descriptor = parts.slice(1);
      if (descriptor.length > 1) {
        add("HTML_UNSUPPORTED_HTML");
        continue;
      }
      classifyUrl(url);
    }
  };
  const parseAttributes = (raw) => {
    const attributes = new Map();
    let index = 0;
    while (index < raw.length) {
      while (/[\t\n\f\r ]/u.test(raw.at(index) ?? "")) index += 1;
      if (index >= raw.length) break;
      if (raw.at(index) === "/") {
        if (/^[\t\n\f\r ]*$/u.test(raw.slice(index + 1))) break;
        return undefined;
      }
      const nameMatch = raw.slice(index).match(/^[^\t\n\f\r "'<>=/]+/u);
      if (!nameMatch) return undefined;
      const name = nameMatch[0].toLowerCase();
      if (name.includes("&") || attributes.has(name)) return undefined;
      index += nameMatch[0].length;
      while (/[\t\n\f\r ]/u.test(raw.at(index) ?? "")) index += 1;
      let value;
      if (raw.at(index) === "=") {
        index += 1;
        while (/[\t\n\f\r ]/u.test(raw.at(index) ?? "")) index += 1;
        const quote = raw.at(index);
        if (quote === '"' || quote === "'") {
          index += 1;
          const end = raw.indexOf(quote, index);
          if (end < 0) return undefined;
          value = raw.slice(index, end);
          index = end + 1;
        } else {
          const valueMatch = raw.slice(index).match(/^[^\t\n\f\r "'<>=`]+/u);
          if (!valueMatch) return undefined;
          value = valueMatch[0];
          index += value.length;
        }
      }
      attributes.set(name, value);
      if (attributes.size > configuration.maxAttributesPerTag) return undefined;
    }
    return attributes;
  };
  const tagEnd = (start) => {
    let quote;
    for (let index = start; index < text.length; index += 1) {
      const character = text.at(index);
      if (quote) {
        if (character === quote) quote = undefined;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === ">") return index;
      else if (character === "<") return -1;
      if (index - start > configuration.maxTagCharacters) return -1;
    }
    return -1;
  };
  const urlAttributes = new Set([
    "action",
    "data",
    "formaction",
    "href",
    "poster",
    "src",
    "srcset",
    "xlink:href",
  ]);
  let cursor = 0;
  let tags = 0;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) break;
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end < 0) {
        add("HTML_UNSUPPORTED_HTML");
        break;
      }
      cursor = end + 3;
      continue;
    }
    const end = tagEnd(start + 1);
    if (end < 0) {
      add("HTML_UNSUPPORTED_HTML");
      break;
    }
    tags += 1;
    if (tags > configuration.maxTagsPerFile) {
      add("HTML_UNSUPPORTED_HTML");
      break;
    }
    const token = text.slice(start + 1, end);
    const leftTrimmed = token.replace(/^[\t\n\f\r ]+/u, "");
    const boundaryTrimmed = leftTrimmed.replace(/[\t\n\f\r ]+$/u, "");
    if (
      /^!doctype(?:[\t\n\f\r ]|$)/iu.test(boundaryTrimmed) ||
      /^\/[a-z][a-z0-9:-]*$/iu.test(boundaryTrimmed)
    ) {
      cursor = end + 1;
      continue;
    }
    const match = leftTrimmed.match(/^([a-z][a-z0-9:-]*)([\s\S]*)$/iu);
    if (!match || leftTrimmed.startsWith("!") || leftTrimmed.startsWith("?")) {
      add("HTML_UNSUPPORTED_HTML");
      cursor = end + 1;
      continue;
    }
    const name = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    if (!attributes) {
      add("HTML_UNSUPPORTED_HTML");
      cursor = end + 1;
      continue;
    }
    if (Array.from(attributes.keys()).some((attribute) => /^on[a-z0-9_:-]+$/iu.test(attribute)))
      add("HTML_INLINE_EVENT_HANDLER");
    if (attributes.has("srcdoc")) add("HTML_SRCDOC");
    for (const [attribute, value] of attributes) {
      if (value !== undefined && urlAttributes.has(attribute)) {
        let decoded;
        try {
          decoded = decodeValue(value);
        } catch {
          add("HTML_UNSUPPORTED_HTML");
        }
        if (decoded?.includes("\\")) add("HTML_LOCAL_ASSET_POLICY");
        const folded = decoded === undefined ? undefined : foldAsciiControls(decoded);
        if (folded?.startsWith("javascript:") || folded?.startsWith("data:text/html"))
          add("HTML_ACTIVE_URL_SCHEME");
      }
    }
    const active = [];
    if (name === "script") active.push("src");
    if (name === "iframe") active.push("src");
    if (name === "object") active.push("data");
    if (name === "embed") active.push("src");
    let relTokens = [];
    if (name === "link" && attributes.has("rel")) {
      try {
        const decodedRel = decodeValue(attributes.get("rel") ?? "");
        if (
          Array.from(decodedRel).some((character) => {
            const code = character.codePointAt(0);
            return (code < 0x20 && !["\t", "\n", "\f", "\r"].includes(character)) || code === 0x7f;
          })
        )
          throw new Error("ambiguous rel control");
        relTokens = decodedRel
          .trim()
          .split(/[\t\n\f\r ]+/u)
          .filter(Boolean)
          .map((token) => token.toLowerCase());
      } catch {
        add("HTML_UNSUPPORTED_HTML");
      }
    }
    if (name === "link" && relTokens.includes("stylesheet")) active.push("href");
    if (["img", "source"].includes(name)) active.push("src", "srcset");
    if (name === "audio") active.push("src");
    if (name === "video") active.push("src", "poster");
    if (name === "form") active.push("action");
    for (const attribute of active) {
      if (!attributes.has(attribute)) continue;
      const value = attributes.get(attribute);
      if (value === undefined) add("HTML_UNSUPPORTED_HTML");
      else if (attribute === "srcset") classifySrcset(value);
      else classifyUrl(value);
    }
    if (name === "script") {
      const closeExpression = /<\s*\/\s*script\s*>/giu;
      closeExpression.lastIndex = end + 1;
      const close = closeExpression.exec(text);
      if (!close) {
        add("HTML_UNSUPPORTED_HTML");
        break;
      }
      if (text.slice(end + 1, close.index).trim().length > 0) add("HTML_INLINE_SCRIPT_BODY");
      cursor = closeExpression.lastIndex;
      continue;
    }
    cursor = end + 1;
  }
  return findings;
}

function exactObjectKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys)
  );
}

function bridgeDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function ownedJsonBridgeHash(hashes, key) {
  switch (key) {
    case "source":
      return hashes.source;
    case "workspace":
      return hashes.workspace;
    case "foundationManifest":
      return hashes.foundationManifest;
    case "foundationTsconfig":
      return hashes.foundationTsconfig;
    case "baseTsconfig":
      return hashes.baseTsconfig;
    case "rootTsconfig":
      return hashes.rootTsconfig;
    case "lockfile":
      return hashes.lockfile;
    case "consumerSource":
      return hashes.consumerSource;
    case "consumerManifest":
      return hashes.consumerManifest;
    case "consumerTsconfig":
      return hashes.consumerTsconfig;
    case "runtimeJs":
      return hashes.runtimeJs;
    case "declarations":
      return hashes.declarations;
    case "declarationMap":
      return hashes.declarationMap;
    default:
      return undefined;
  }
}

function assertOwnedJsonBridgeShape(bridge) {
  const hashKeys = [
    "source",
    "workspace",
    "foundationManifest",
    "foundationTsconfig",
    "baseTsconfig",
    "rootTsconfig",
    "lockfile",
    "consumerSource",
    "consumerManifest",
    "consumerTsconfig",
    "runtimeJs",
    "declarations",
    "declarationMap",
  ];
  if (
    !exactObjectKeys(bridge, ["schemaVersion", "capability", "hashes"]) ||
    bridge.schemaVersion !== 2 ||
    bridge.capability !== "implicit_data_access" ||
    !exactObjectKeys(bridge.hashes, hashKeys) ||
    hashKeys.some((key) => !bridgeDigest(ownedJsonBridgeHash(bridge.hashes, key))) ||
    bridge.hashes.source !==
      trustedReflectionPolicy.modules.find(
        ({ path: relative }) => relative === "packages/foundation/src/owned-json.ts",
      )?.sha256 ||
    bridge.hashes.runtimeJs !== ownedJsonReviewedBuildDigests.runtimeJs ||
    bridge.hashes.declarations !== ownedJsonReviewedBuildDigests.declarations ||
    bridge.hashes.declarationMap !== ownedJsonReviewedBuildDigests.declarationMap
  )
    throw new Error("source-security owned JSON package bridge policy is invalid");
}

function parsePnpmImporterDependencies(text, importer) {
  if (typeof text !== "string" || !text.startsWith("lockfileVersion: '9.0'\n"))
    throw new Error("source-security owned JSON package bridge semantics are invalid");
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${importer}:`);
  if (start < 0 || lines.indexOf(`  ${importer}:`, start + 1) >= 0)
    throw new Error("source-security owned JSON package bridge semantics are invalid");
  const boundary = lines.findIndex((line, index) => index > start && /^ {2}\S/u.test(line));
  const block = lines.slice(start + 1, boundary < 0 ? lines.length : boundary);
  const dependencies = block.indexOf("    dependencies:");
  if (dependencies < 0)
    throw new Error("source-security owned JSON package bridge semantics are invalid");
  let application;
  let foundation;
  let pending;
  for (const line of block.slice(dependencies + 1)) {
    const name = /^ {6}'?(?<value>[^']+)'?:$/u.exec(line)?.groups?.value;
    if (name) pending = { name };
    const specifier = /^ {8}specifier: (?<value>.+)$/u.exec(line)?.groups?.value;
    if (specifier && pending) pending.specifier = specifier;
    const version = /^ {8}version: (?<value>.+)$/u.exec(line)?.groups?.value;
    if (!version || !pending?.specifier) continue;
    const dependency = { specifier: pending.specifier, version };
    if (pending.name === "@zintus-continuity/application") {
      if (application)
        throw new Error("source-security owned JSON package bridge semantics are invalid");
      application = dependency;
    }
    if (pending.name === "@zintus-continuity/foundation") {
      if (foundation)
        throw new Error("source-security owned JSON package bridge semantics are invalid");
      foundation = dependency;
    }
    pending = undefined;
  }
  return { application, foundation };
}

function assertOwnedJsonConsumerAst(text, filename, astBudgets) {
  const { sourceFile } = preparseExecutableSource(text, filename, astBudgets, {
    budget: "SOURCE_SECURITY_AST_BUDGET_EXCEEDED",
    parse: "SOURCE_SECURITY_PARSE_FAILED",
  });
  const lexical = createLexicalBindings(sourceFile);
  const runtimeBindings = new Map();
  let bridgeImportCount = 0;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@zintus-continuity/foundation/owned-json"
    )
      continue;
    bridgeImportCount += 1;
    const clause = statement.importClause;
    if (
      !clause ||
      clause.isTypeOnly ||
      clause.name ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    )
      throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_IMPORT_INVALID`);
    const seen = new Set();
    for (const element of clause.namedBindings.elements) {
      if (element.propertyName || seen.has(element.name.text))
        throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_IMPORT_INVALID`);
      seen.add(element.name.text);
      if (element.isTypeOnly) {
        if (!ownedJsonTypeExports.includes(element.name.text))
          throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_IMPORT_INVALID`);
        continue;
      }
      if (!ownedJsonRuntimeExports.includes(element.name.text))
        throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_IMPORT_INVALID`);
      const binding = lexical.bindingOf(element.name);
      if (!binding || binding.mutated)
        throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_BINDING_INVALID`);
      runtimeBindings.set(binding, element.name.text);
    }
    if (
      JSON.stringify(Array.from(runtimeBindings.values()).sort(utf8Order)) !==
      JSON.stringify(Array.from(ownedJsonRuntimeExports).sort(utf8Order))
    )
      throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_IMPORT_INVALID`);
  }
  if (bridgeImportCount !== 1)
    throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_IMPORT_INVALID`);

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const binding = lexical.bindingOf(node);
      const imported = runtimeBindings.get(binding);
      if (imported !== undefined && node !== binding.declaration.name) {
        const call = node.parent;
        if (
          !ts.isCallExpression(call) ||
          call.expression !== node ||
          call.questionDotToken !== undefined ||
          call.typeArguments !== undefined ||
          call.arguments.length !== ownedJsonCallArities.get(imported) ||
          call.arguments.some((argument) => ts.isSpreadElement(argument)) ||
          (imported === "parseOwnedJson" &&
            (!ts.isStringLiteral(call.arguments[1]) || call.arguments[1].text !== "small"))
        )
          throw new Error(`${filename}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_CALL_INVALID`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

async function prepareOwnedJsonBridge(canonicalRoot, configuration, consumeReadBudget, sourceOnly) {
  const bridge = configuration.ownedJsonPackageBridge;
  if (bridge === undefined) return undefined;
  assertOwnedJsonBridgeShape(bridge);
  const snapshots = [];
  const read = async (relative, expectedDigest) => {
    const candidate = path.resolve(canonicalRoot, relative);
    if (!inside(canonicalRoot, candidate))
      throw new Error(`${relative}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_PATH_INVALID`);
    const stat = await lstat(candidate);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > configuration.maxFileBytes ||
      (await realpath(candidate)) !== candidate
    )
      throw new Error(`${relative}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_INPUT_INVALID`);
    consumeReadBudget(relative, stat.size);
    const content = await readFile(candidate);
    const digest = sha256(content);
    if (content.length !== stat.size || digest !== expectedDigest)
      throw new Error(`${relative}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_INPUT_CHANGED`);
    snapshots.push({ candidate, digest, relative, size: stat.size });
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  };
  const paths = {
    source: "packages/foundation/src/owned-json.ts",
    workspace: "pnpm-workspace.yaml",
    foundationManifest: "packages/foundation/package.json",
    foundationTsconfig: "packages/foundation/tsconfig.json",
    baseTsconfig: "tsconfig.base.json",
    rootTsconfig: "tsconfig.json",
    lockfile: "pnpm-lock.yaml",
    consumerSource: "packages/adapters-local/src/local-cognito-shaped-verifier.ts",
    consumerManifest: "packages/adapters-local/package.json",
    consumerTsconfig: "packages/adapters-local/tsconfig.json",
    runtimeJs: "packages/foundation/dist/owned-json.js",
    declarations: "packages/foundation/dist/owned-json.d.ts",
    declarationMap: "packages/foundation/dist/owned-json.d.ts.map",
  };
  const pathEntries = [
    ["source", paths.source],
    ["workspace", paths.workspace],
    ["foundationManifest", paths.foundationManifest],
    ["foundationTsconfig", paths.foundationTsconfig],
    ["baseTsconfig", paths.baseTsconfig],
    ["rootTsconfig", paths.rootTsconfig],
    ["lockfile", paths.lockfile],
    ["consumerSource", paths.consumerSource],
    ["consumerManifest", paths.consumerManifest],
    ["consumerTsconfig", paths.consumerTsconfig],
    ["runtimeJs", paths.runtimeJs],
    ["declarations", paths.declarations],
    ["declarationMap", paths.declarationMap],
  ];
  const text = new Map();
  const jsMapPath = path.resolve(canonicalRoot, "packages/foundation/dist/owned-json.js.map");
  for (const [name, relative] of pathEntries) {
    if (sourceOnly && ["runtimeJs", "declarations", "declarationMap"].includes(name)) continue;
    text.set(name, await read(relative, ownedJsonBridgeHash(bridge.hashes, name)));
  }
  preparseExecutableSource(text.get("source"), paths.source, configuration.astBudgets, {
    budget: "SOURCE_SECURITY_AST_BUDGET_EXCEEDED",
    parse: "SOURCE_SECURITY_PARSE_FAILED",
  });
  const parse = (text, relative) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${relative}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_JSON_INVALID`);
    }
  };
  const foundationManifest = parse(text.get("foundationManifest"), paths.foundationManifest);
  const foundationTsconfig = parse(text.get("foundationTsconfig"), paths.foundationTsconfig);
  const baseTsconfig = parse(text.get("baseTsconfig"), paths.baseTsconfig);
  const rootTsconfig = parse(text.get("rootTsconfig"), paths.rootTsconfig);
  const consumerManifest = parse(text.get("consumerManifest"), paths.consumerManifest);
  const consumerTsconfig = parse(text.get("consumerTsconfig"), paths.consumerTsconfig);
  const adapterDependencies = parsePnpmImporterDependencies(
    text.get("lockfile"),
    "packages/adapters-local",
  );
  if (
    text.get("workspace") !== "packages:\n  - packages/*\n  - apps/*\n  - infrastructure\n" ||
    foundationManifest.name !== "@zintus-continuity/foundation" ||
    foundationManifest.private !== true ||
    foundationManifest.type !== "module" ||
    JSON.stringify(foundationManifest.exports?.["./owned-json"]) !==
      JSON.stringify({
        types: "./dist/owned-json.d.ts",
        default: "./dist/owned-json.js",
      }) ||
    foundationTsconfig.compilerOptions?.rootDir !== "src" ||
    foundationTsconfig.compilerOptions?.outDir !== "dist" ||
    baseTsconfig.compilerOptions?.module !== "NodeNext" ||
    baseTsconfig.compilerOptions?.moduleResolution !== "NodeNext" ||
    !rootTsconfig.references?.some((reference) => reference?.path === "packages/foundation") ||
    consumerManifest.name !== "@zintus-continuity/adapters-local" ||
    consumerManifest.dependencies?.["@zintus-continuity/foundation"] !== "workspace:*" ||
    JSON.stringify(consumerTsconfig.references) !==
      JSON.stringify([{ path: "../foundation" }, { path: "../application" }]) ||
    JSON.stringify(adapterDependencies.application) !==
      JSON.stringify({ specifier: "workspace:*", version: "link:../application" }) ||
    JSON.stringify(adapterDependencies.foundation) !==
      JSON.stringify({ specifier: "workspace:*", version: "link:../foundation" }) ||
    ts.version !== "5.9.3"
  )
    throw new Error("source-security owned JSON package bridge semantics are invalid");
  if (!sourceOnly) {
    const syntacticEmit = ts.transpileModule(text.get("source"), {
      fileName: "owned-json.ts",
      reportDiagnostics: true,
      compilerOptions: {
        isolatedModules: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2024,
        verbatimModuleSyntax: true,
      },
    });
    if (
      syntacticEmit.diagnostics?.length !== 0 ||
      syntacticEmit.outputText !== text.get("runtimeJs")
    )
      throw new Error("source-security owned JSON build bridge is invalid");
    try {
      await lstat(jsMapPath);
      throw new Error("source-security owned JSON unexpected runtime source map");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  assertOwnedJsonConsumerAst(
    text.get("consumerSource"),
    paths.consumerSource,
    configuration.astBudgets,
  );

  const linkPath = path.resolve(
    canonicalRoot,
    "packages/adapters-local/node_modules/@zintus-continuity/foundation",
  );
  const linkStat = await lstat(linkPath);
  const linkText = await readlink(linkPath);
  const expectedPackageRoot = path.resolve(canonicalRoot, "packages/foundation");
  if (
    !linkStat.isSymbolicLink() ||
    linkText !== "../../../foundation" ||
    (await realpath(linkPath)) !== expectedPackageRoot
  )
    throw new Error("source-security owned JSON installed workspace link is invalid");
  const recheck = async () => {
    for (const snapshot of snapshots) {
      const stat = await lstat(snapshot.candidate);
      const content = await readFile(snapshot.candidate);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size !== snapshot.size ||
        (await realpath(snapshot.candidate)) !== snapshot.candidate ||
        content.length !== snapshot.size ||
        sha256(content) !== snapshot.digest
      )
        throw new Error(`${snapshot.relative}:SOURCE_SECURITY_OWNED_JSON_BRIDGE_INPUT_CHANGED`);
    }
    const finalLinkStat = await lstat(linkPath);
    if (
      !finalLinkStat.isSymbolicLink() ||
      (await readlink(linkPath)) !== "../../../foundation" ||
      (await realpath(linkPath)) !== expectedPackageRoot
    )
      throw new Error("source-security owned JSON installed workspace link changed");
    if (!sourceOnly) {
      try {
        await lstat(jsMapPath);
        throw new Error("source-security owned JSON unexpected runtime source map");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  };
  return {
    consumerPath: paths.consumerSource,
    consumerSha256: bridge.hashes.consumerSource,
    recheck,
    status: sourceOnly ? "STAGED_SOURCE_PASS_NOT_RUNTIME" : "RUNTIME_BUILD_BOUND",
  };
}

export async function scanSourceSecurity(root, configuration, options = {}) {
  if (!exactObjectKeys(options, ["sourceOnly"]) && !exactObjectKeys(options, []))
    throw new Error("source-security scan options are invalid");
  const sourceOnly = options.sourceOnly === true;
  assertTrustedReflectionPolicy();
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    throw new Error("<root>:SOURCE_SECURITY_ROOT_READ_FAILED");
  }
  if (canonicalRoot !== path.resolve(root)) throw new Error("scan root must be canonical");
  const findings = [];
  let files = 0;
  let totalBytes = 0;
  const configuredExtensions = configuration.extensions;
  const permittedExtensions = new Set(
    executableSourceExtensions.concat([".html", ".json", ".py", ".sql", ".yaml", ".yml"]),
  );
  if (
    !Array.isArray(configuredExtensions) ||
    new Set(configuredExtensions).size !== configuredExtensions.length ||
    configuredExtensions.some(
      (extension) => typeof extension !== "string" || !permittedExtensions.has(extension),
    ) ||
    executableSourceExtensions.some((extension) => !configuredExtensions.includes(extension))
  ) {
    throw new Error("source-security extension policy is invalid");
  }
  const pythonPolicy = configuration.pythonSingleton;
  const pythonEnabled = configuredExtensions.includes(".py");
  if (
    pythonEnabled !== Object.hasOwn(configuration, "pythonSingleton") ||
    (pythonEnabled &&
      (pythonPolicy === null ||
        typeof pythonPolicy !== "object" ||
        Array.isArray(pythonPolicy) ||
        JSON.stringify(Object.keys(pythonPolicy)) !== JSON.stringify(["path", "sha256"]) ||
        pythonPolicy.path !== "scripts/h02c-ci-inventory.py" ||
        !/^[0-9a-f]{64}$/u.test(pythonPolicy.sha256)))
  )
    throw new Error("source-security Python singleton policy is invalid");
  const pythonSources = [];
  for (const value of [
    configuration.maxDirectories,
    configuration.maxEntries,
    configuration.maxFiles,
    configuration.maxFileBytes,
    configuration.maxTotalBytes,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("source-security scan budget policy is invalid");
    }
  }
  const extensions = new Set(configuration.extensions);
  const excluded = new Set(
    configuration.excludedPaths.map((relative) => {
      if (
        typeof relative !== "string" ||
        path.isAbsolute(relative) ||
        relative.includes("\\") ||
        relative.split("/").some((part) => part === "" || part === "." || part === "..") ||
        path.normalize(relative) !== relative
      )
        throw new Error("source-security exclusion path is invalid");
      return relative;
    }),
  );
  const capabilities = configuration.capabilityAllowlists;
  const capabilityKeys = [
    "child_process",
    "computed_data_access",
    "dynamic_code",
    "dynamic_import",
    "filesystem",
    "implicit_data_access",
    "network",
    "process_env",
    "unsupported_authority",
  ];
  const capabilityEntries = (capability) => {
    switch (capability) {
      case "child_process":
        return capabilities.child_process;
      case "computed_data_access":
        return capabilities.computed_data_access;
      case "dynamic_code":
        return capabilities.dynamic_code;
      case "dynamic_import":
        return capabilities.dynamic_import;
      case "filesystem":
        return capabilities.filesystem;
      case "implicit_data_access":
        return capabilities.implicit_data_access;
      case "network":
        return capabilities.network;
      case "process_env":
        return capabilities.process_env;
      case "unsupported_authority":
        return capabilities.unsupported_authority;
      default:
        return undefined;
    }
  };
  if (
    capabilities === null ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities) ||
    JSON.stringify(Object.keys(capabilities).sort(utf8Order)) !== JSON.stringify(capabilityKeys)
  )
    throw new Error("source-security capability allowlists are invalid");
  for (const capability of capabilityKeys) {
    const entries = capabilityEntries(capability);
    if (
      !Array.isArray(entries) ||
      new Set(entries).size !== entries.length ||
      entries.some(
        (relative) =>
          typeof relative !== "string" ||
          relative.length === 0 ||
          path.isAbsolute(relative) ||
          path.win32.isAbsolute(relative) ||
          relative.includes("\\") ||
          relative.split("/").some((part) => part === "" || part === "." || part === "..") ||
          path.posix.normalize(relative) !== relative,
      )
    )
      throw new Error("source-security capability allowlists are invalid");
  }
  const expectedNetworkSurface = {
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
  };
  if (
    JSON.stringify(configuration.enumeratedNetworkSurface) !==
    JSON.stringify(expectedNetworkSurface)
  )
    throw new Error("source-security enumerated network surface is invalid");
  const astBudgets = configuration.astBudgets;
  assertAstBudgets(astBudgets);
  const privilegedPolicyPresent = Object.hasOwn(configuration, "privilegedStaticImports");
  const privilegedStaticImports = configuration.privilegedStaticImports ?? [];
  const canonicalPolicyPath = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes("%") &&
    !value.includes(":") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..") &&
    path.posix.normalize(value) === value;
  const privilegedSourceParts = (sourcePath) => {
    const parts = sourcePath.replace(/\.ts$/u, "").split("/");
    const sourceIndexes = parts.flatMap((part, index) => (part === "src" ? [index] : []));
    if (sourceIndexes.length !== 1 || sourceIndexes[0] === parts.length - 1) return undefined;
    const sourceIndex = sourceIndexes[0];
    return {
      root: parts.slice(0, sourceIndex).join("/"),
      subpath: parts.slice(sourceIndex + 1).join("/"),
    };
  };
  const canonicalPackageSpecifier = (value) =>
    typeof value === "string" &&
    /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/u.test(value) &&
    !/\.(?:js|ts)$/u.test(value) &&
    !value.includes("%") &&
    !value.split("/").some((part) => part === "." || part === "..");
  const validPrivilegedImporter = (value, testOnly) =>
    exactObjectKeys(value, ["path", "runtimeNames", "typeNames"]) &&
    canonicalPolicyPath(value.path) &&
    (testOnly ? value.path.startsWith("tests/") : !value.path.startsWith("tests/")) &&
    [value.runtimeNames, value.typeNames].every(
      (names) =>
        Array.isArray(names) &&
        new Set(names).size === names.length &&
        names.every((name) => typeof name === "string" && /^[A-Za-z_$][\w$]*$/u.test(name)),
    ) &&
    value.runtimeNames.length + value.typeNames.length > 0;
  const privilegedAliases = Array.isArray(privilegedStaticImports)
    ? privilegedStaticImports.flatMap((entry) => {
        if (!entry || typeof entry.sourcePath !== "string" || typeof entry.specifier !== "string")
          return [];
        const source = privilegedSourceParts(entry.sourcePath);
        if (!source || !entry.specifier.endsWith(`/${source.subpath}`)) return [];
        const packageRoot = entry.specifier.slice(0, -source.subpath.length);
        return [
          entry.sourcePath,
          entry.sourcePath.replace(/\.ts$/u, ""),
          `${source.root ? `${source.root}/` : ""}dist/${source.subpath}`,
          entry.specifier,
          `${entry.specifier}.js`,
          `${entry.specifier}.ts`,
          `${packageRoot}src/${source.subpath}`,
          `${packageRoot}dist/${source.subpath}`,
        ];
      })
    : [];
  const normalizedPrivilegedAliases = privilegedAliases.map((value) => path.posix.normalize(value));
  const casefoldPrivilegedAliases = normalizedPrivilegedAliases.map((value) => value.toLowerCase());
  const validPrivilegedPolicy =
    Array.isArray(privilegedStaticImports) &&
    privilegedStaticImports.length === 2 &&
    new Set(privilegedStaticImports.map((entry) => entry?.sourcePath)).size ===
      privilegedStaticImports.length &&
    new Set(privilegedStaticImports.map((entry) => entry?.specifier)).size ===
      privilegedStaticImports.length &&
    new Set(privilegedAliases).size === privilegedAliases.length &&
    new Set(normalizedPrivilegedAliases).size === normalizedPrivilegedAliases.length &&
    new Set(casefoldPrivilegedAliases).size === casefoldPrivilegedAliases.length &&
    !privilegedStaticImports.some(
      (entry) =>
        !exactObjectKeys(entry, ["runtimeImporters", "sourcePath", "specifier", "testImporters"]) ||
        !canonicalPolicyPath(entry.sourcePath) ||
        !entry.sourcePath.endsWith(".ts") ||
        !privilegedSourceParts(entry.sourcePath) ||
        !canonicalPackageSpecifier(entry.specifier) ||
        !entry.specifier.endsWith(`/${privilegedSourceParts(entry.sourcePath)?.subpath}`) ||
        !Array.isArray(entry.runtimeImporters) ||
        !Array.isArray(entry.testImporters) ||
        entry.runtimeImporters.some((value) => !validPrivilegedImporter(value, false)) ||
        entry.testImporters.some((value) => !validPrivilegedImporter(value, true)) ||
        new Set([...entry.runtimeImporters, ...entry.testImporters].map((value) => value.path))
          .size !==
          entry.runtimeImporters.length + entry.testImporters.length,
    );
  if (!privilegedPolicyPresent || !validPrivilegedPolicy)
    throw new Error("source-security privileged static import policy is invalid");
  const privilegedSurfaces = privilegedStaticImports.map((policy) => {
    const source = privilegedSourceParts(policy.sourcePath);
    const sourceWithoutExtension = policy.sourcePath.replace(/\.ts$/u, "");
    const packageRoot = policy.specifier.slice(0, -source.subpath.length);
    return {
      aliases: [
        sourceWithoutExtension,
        `${source.root ? `${source.root}/` : ""}dist/${source.subpath}`,
        policy.specifier,
        `${packageRoot}src/${source.subpath}`,
        `${packageRoot}dist/${source.subpath}`,
      ],
      policy,
      sourceWithoutExtension,
    };
  });
  const budgetedReadPaths = new Set();
  let readBudgetBytes = 0;
  const consumeReadBudget = (relative, size) => {
    if (!budgetedReadPaths.has(relative)) {
      readBudgetBytes += size;
      budgetedReadPaths.add(relative);
    }
    if (readBudgetBytes > configuration.maxTotalBytes)
      throw new Error(`${relative}:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED`);
  };
  const ownedJsonBridge = await prepareOwnedJsonBridge(
    canonicalRoot,
    configuration,
    consumeReadBudget,
    sourceOnly,
  );
  const allow = (capability, relative) =>
    capabilityEntries(capability)?.includes(relative) === true;
  const trustedPathCovered = (relative) => {
    const candidate = path.resolve(canonicalRoot, relative);
    const included = configuration.roots.some((root) =>
      inside(path.resolve(canonicalRoot, root), candidate),
    );
    return (
      included &&
      !Array.from(excluded).some((entry) => inside(path.resolve(canonicalRoot, entry), candidate))
    );
  };
  const trustedModuleDigests = new Map();
  const readTrustedFile = async (relative) => {
    const candidate = path.join(canonicalRoot, relative);
    const stat = await lstat(candidate);
    consumeReadBudget(relative, stat.size);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > configuration.maxFileBytes
    )
      throw new Error(`${relative}:SOURCE_SECURITY_TRUSTED_MODULE_INVALID`);
    const bytes = await readFile(candidate);
    if (bytes.length !== stat.size)
      throw new Error(`${relative}:SOURCE_SECURITY_TRUSTED_MODULE_CHANGED`);
    return bytes;
  };
  for (const module of trustedReflectionPolicy.modules) {
    if (!trustedPathCovered(module.path)) continue;
    try {
      const bytes = await readTrustedFile(module.path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== module.sha256)
        throw new Error(`${module.path}:SOURCE_SECURITY_TRUSTED_MODULE_CHANGED`);
      trustedModuleDigests.set(module.path, digest);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  const trustedModulesUsed = new Set();
  const astCapabilities = (text, filename, contentSha256) => {
    const found = new Set();
    const prepared = preparseExecutableSource(text, filename, astBudgets, {
      budget: "SOURCE_SECURITY_AST_BUDGET_EXCEEDED",
      parse: "SOURCE_SECURITY_PARSE_FAILED",
    });
    const { sourceFile: source, step } = prepared;
    const trustedModule = trustedReflectionPolicy.modules.find(
      (candidate) => candidate.path === filename,
    );
    const trustedModuleDigest =
      trustedReflectionPolicy.schemaVersion === 1 &&
      trustedModule !== undefined &&
      trustedModule.sha256 === contentSha256 &&
      !text.startsWith("\uFEFF") &&
      !text.includes("\r");
    const approvedOwnedJsonConsumer =
      ownedJsonBridge?.consumerPath === filename &&
      ownedJsonBridge.consumerSha256 === contentSha256;
    const lexical = createLexicalBindings(source);
    const aliases = new Map();
    const propertyAliases = new Map();
    const { bindingOf, constantString, referenceKey, unwrap } = lexical;
    const invalidPrivilegedSpecifier = Object.freeze({});
    const unknownCoercibleSpecifier = Object.freeze({});
    const stripModuleExtension = (value) => value.replace(/\.(?:js|ts)$/iu, "");
    const inspectSpecifier = (specifier) => {
      const suffixIndex = specifier.search(/[?#]/u);
      const rawPath = suffixIndex < 0 ? specifier : specifier.slice(0, suffixIndex);
      const suffix = suffixIndex < 0 ? "" : specifier.slice(suffixIndex);
      let decodeError = false;
      let repeatedEncoding = false;
      let encodedSeparator = false;
      let encodedDot = false;
      let residualEncoding = false;
      const decodedPath = rawPath
        .split("/")
        .map((rawComponent) => {
          let component = rawComponent;
          for (let pass = 0; pass <= rawComponent.length && component.includes("%"); pass += 1) {
            try {
              const next = decodeURIComponent(component);
              if (next === component) break;
              repeatedEncoding ||= pass > 0;
              encodedSeparator ||= next.includes("/") || next.includes("\\");
              encodedDot ||= (next === "." || next === "..") && next !== rawComponent;
              component = next;
            } catch {
              decodeError = true;
              break;
            }
          }
          residualEncoding ||= component.includes("%");
          return component;
        })
        .join("/");
      return {
        ambiguous:
          decodeError ||
          repeatedEncoding ||
          residualEncoding ||
          encodedSeparator ||
          encodedDot ||
          rawPath.includes("%") ||
          rawPath.includes("\\"),
        decodedPath: decodedPath.replaceAll("\\", "/"),
        rawPath,
        suffix,
      };
    };
    const moduleLikeSpecifier = (value) => !/[\s"'`(){};]/u.test(value);
    const protectedLikeSpecifier = ({ ambiguous, decodedPath, rawPath }) => {
      const lower = decodedPath.toLowerCase();
      if (
        (/^file:/iu.test(decodedPath) || (ambiguous && moduleLikeSpecifier(rawPath))) &&
        privilegedSurfaces.some(({ aliases }) =>
          aliases.some((alias) => lower.includes(path.posix.basename(alias).toLowerCase())),
        )
      )
        return true;
      let candidate = decodedPath;
      if (path.isAbsolute(candidate))
        candidate = path.relative(canonicalRoot, candidate).split(path.sep).join("/");
      else if (candidate.startsWith("."))
        candidate = path.posix.normalize(path.posix.join(path.posix.dirname(filename), candidate));
      const identity = stripModuleExtension(candidate).replace(/\/+$/u, "").toLowerCase();
      return privilegedSurfaces.some(({ aliases }) =>
        aliases.some(
          (alias) => stripModuleExtension(alias).replace(/\/+$/u, "").toLowerCase() === identity,
        ),
      );
    };
    const privilegedPolicyForSpecifier = (specifier) => {
      if (specifier === invalidPrivilegedSpecifier) return invalidPrivilegedSpecifier;
      if (typeof specifier !== "string") return undefined;
      const inspected = inspectSpecifier(specifier);
      const protectedLike = protectedLikeSpecifier(inspected);
      if (!inspected.ambiguous && inspected.suffix === "" && !/^file:/iu.test(inspected.rawPath)) {
        for (const surface of privilegedSurfaces) {
          if (inspected.rawPath === surface.policy.specifier) return surface.policy;
          let expectedRelative = path.posix.relative(
            path.posix.dirname(filename),
            surface.sourceWithoutExtension,
          );
          if (!expectedRelative.startsWith(".")) expectedRelative = `./${expectedRelative}`;
          if (inspected.rawPath === `${expectedRelative}.js`) return surface.policy;
        }
      }
      return protectedLike ? invalidPrivilegedSpecifier : undefined;
    };
    const moduleSpecifierAlternatives = (
      expression,
      active = new Set(),
      budget = { steps: 128 },
    ) => {
      budget.steps -= 1;
      if (budget.steps < 0) return [unknownCoercibleSpecifier];
      const constant = constantString(expression, step);
      if (constant !== undefined) return [constant];
      const candidate = unwrap(expression);
      if (ts.isIdentifier(candidate)) {
        const binding = bindingOf(candidate);
        if (binding?.isConst && !binding.mutated && binding.initializer && !active.has(binding)) {
          active.add(binding);
          try {
            return moduleSpecifierAlternatives(binding.initializer, active, budget);
          } finally {
            active.delete(binding);
          }
        }
        return [unknownCoercibleSpecifier];
      }
      if (ts.isConditionalExpression(candidate)) {
        const alternatives = [
          ...moduleSpecifierAlternatives(candidate.whenTrue, active, budget),
          ...moduleSpecifierAlternatives(candidate.whenFalse, active, budget),
        ];
        return alternatives.length > 64 ? [unknownCoercibleSpecifier] : alternatives;
      }
      if (ts.isBinaryExpression(candidate)) {
        if (candidate.operatorToken.kind === ts.SyntaxKind.CommaToken)
          return moduleSpecifierAlternatives(candidate.right, active, budget);
        if (
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(candidate.operatorToken.kind)
        ) {
          const alternatives = [
            ...moduleSpecifierAlternatives(candidate.left, active, budget),
            ...moduleSpecifierAlternatives(candidate.right, active, budget),
          ];
          return alternatives.length > 64 ? [unknownCoercibleSpecifier] : alternatives;
        }
        if (candidate.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          const left = moduleSpecifierAlternatives(candidate.left, active, budget);
          const right = moduleSpecifierAlternatives(candidate.right, active, budget);
          const combined = left.flatMap((a) =>
            right.map((b) =>
              typeof a === "string" && typeof b === "string"
                ? `${a}${b}`
                : unknownCoercibleSpecifier,
            ),
          );
          return combined.length > 64 ? [unknownCoercibleSpecifier] : combined;
        }
      }
      if (ts.isTemplateExpression(candidate)) {
        let values = [candidate.head.text];
        for (const span of candidate.templateSpans) {
          const parts = moduleSpecifierAlternatives(span.expression, active, budget);
          values = values.flatMap((value) =>
            parts.map((part) =>
              typeof part === "string"
                ? `${value}${part}${span.literal.text}`
                : unknownCoercibleSpecifier,
            ),
          );
          if (values.length > 64) return [unknownCoercibleSpecifier];
        }
        return values;
      }
      if (
        ts.isNewExpression(candidate) &&
        ts.isIdentifier(unwrap(candidate.expression)) &&
        unwrap(candidate.expression).text === "URL" &&
        candidate.arguments?.[0]
      )
        return moduleSpecifierAlternatives(candidate.arguments[0], active, budget);
      return [unknownCoercibleSpecifier];
    };
    const privilegedPolicyForExpression = (expression) => {
      const alternatives = moduleSpecifierAlternatives(expression);
      if (alternatives.includes(unknownCoercibleSpecifier)) return unknownCoercibleSpecifier;
      const policies = alternatives.map(privilegedPolicyForSpecifier).filter(Boolean);
      if (policies.length === 0) return undefined;
      if (policies.includes(invalidPrivilegedSpecifier) || new Set(policies).size !== 1)
        return invalidPrivilegedSpecifier;
      return policies[0];
    };
    const approvedPrivilegedUrlReference = (policy, call, expression) => {
      const candidate = unwrap(expression);
      const mappingProperty = call.parent;
      const aliasesObject = mappingProperty?.parent;
      const aliasProperty = aliasesObject?.parent;
      const resolveObject = aliasProperty?.parent;
      const resolveProperty = resolveObject?.parent;
      const configObject = resolveProperty?.parent;
      const defineCall = configObject?.parent;
      const exportAssignment = defineCall?.parent;
      const plainObjectKeys = (object) => {
        if (!ts.isObjectLiteralExpression(object)) return undefined;
        const keys = [];
        for (const property of object.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
          )
            return undefined;
          keys.push(property.name.text);
        }
        return new Set(keys).size === keys.length ? keys : undefined;
      };
      if (
        filename !== "vitest.config.ts" ||
        call.arguments.length !== 1 ||
        !ts.isIdentifier(unwrap(call.expression)) ||
        unwrap(call.expression).text !== "fileURLToPath" ||
        !ts.isPropertyAssignment(mappingProperty) ||
        mappingProperty.initializer !== call ||
        !ts.isStringLiteral(mappingProperty.name) ||
        !ts.isObjectLiteralExpression(aliasesObject) ||
        !ts.isPropertyAssignment(aliasProperty) ||
        aliasProperty.initializer !== aliasesObject ||
        !ts.isIdentifier(aliasProperty.name) ||
        aliasProperty.name.text !== "alias" ||
        !plainObjectKeys(aliasesObject) ||
        !ts.isObjectLiteralExpression(resolveObject) ||
        !ts.isPropertyAssignment(resolveProperty) ||
        resolveProperty.initializer !== resolveObject ||
        !ts.isIdentifier(resolveProperty.name) ||
        resolveProperty.name.text !== "resolve" ||
        !plainObjectKeys(resolveObject) ||
        !ts.isObjectLiteralExpression(configObject) ||
        !plainObjectKeys(configObject) ||
        !ts.isCallExpression(defineCall) ||
        defineCall.arguments.length !== 1 ||
        defineCall.arguments[0] !== configObject ||
        !ts.isIdentifier(defineCall.expression) ||
        defineCall.expression.text !== "defineConfig" ||
        !ts.isExportAssignment(exportAssignment) ||
        exportAssignment.expression !== defineCall ||
        !ts.isNewExpression(candidate) ||
        !ts.isIdentifier(unwrap(candidate.expression)) ||
        unwrap(candidate.expression).text !== "URL" ||
        candidate.arguments?.length !== 2 ||
        !ts.isStringLiteral(candidate.arguments[0]) ||
        candidate.arguments[1].getText(source) !== "import.meta.url"
      )
        return false;
      const importedNamedBinding = (moduleName, name) =>
        source.statements
          .filter(ts.isImportDeclaration)
          .filter(
            (statement) =>
              ts.isStringLiteral(statement.moduleSpecifier) &&
              statement.moduleSpecifier.text === moduleName,
          )
          .flatMap((statement) =>
            statement.importClause?.namedBindings &&
            ts.isNamedImports(statement.importClause.namedBindings)
              ? [...statement.importClause.namedBindings.elements]
              : [],
          )
          .find(
            (element) => !element.propertyName && element.name.text === name && !element.isTypeOnly,
          );
      const importedFileUrlBinding = importedNamedBinding("node:url", "fileURLToPath");
      const importedUrlBinding = importedNamedBinding("node:url", "URL");
      const importedDefineBinding = importedNamedBinding("vitest/config", "defineConfig");
      if (
        !importedFileUrlBinding ||
        !importedUrlBinding ||
        !importedDefineBinding ||
        bindingOf(unwrap(call.expression)) !== bindingOf(importedFileUrlBinding.name) ||
        bindingOf(unwrap(candidate.expression)) !== bindingOf(importedUrlBinding.name) ||
        bindingOf(defineCall.expression) !== bindingOf(importedDefineBinding.name)
      )
        return false;
      const actual = candidate.arguments[0].text;
      const policies = policy === invalidPrivilegedSpecifier ? privilegedStaticImports : [policy];
      return policies.some((candidatePolicy) => {
        if (
          candidatePolicy.specifier !==
          "@zintus-continuity/application/internal/local-c02-authority-registrar"
        )
          return false;
        let expected = path.posix.relative(
          path.posix.dirname(filename),
          candidatePolicy.sourcePath,
        );
        if (!expected.startsWith(".")) expected = `./${expected}`;
        return actual === expected && mappingProperty.name.text === candidatePolicy.specifier;
      });
    };
    const approvedPrivilegedImport = (policy, node) => {
      if (policy === invalidPrivilegedSpecifier) return false;
      const approved = [...policy.runtimeImporters, ...policy.testImporters].find(
        (entry) => entry.path === filename,
      );
      const clause = node.importClause;
      if (
        !approved ||
        !clause ||
        clause.name ||
        !clause.namedBindings ||
        !ts.isNamedImports(clause.namedBindings)
      )
        return false;
      const runtimeNames = [];
      const typeNames = [];
      for (const element of clause.namedBindings.elements) {
        if (element.propertyName) return false;
        (clause.isTypeOnly || element.isTypeOnly ? typeNames : runtimeNames).push(
          element.name.text,
        );
      }
      return (
        JSON.stringify(runtimeNames.sort(utf8Order)) ===
          JSON.stringify([...approved.runtimeNames].sort(utf8Order)) &&
        JSON.stringify(typeNames.sort(utf8Order)) ===
          JSON.stringify([...approved.typeNames].sort(utf8Order))
      );
    };
    const privilegedImportViolation = () => found.add("local_c02_registrar_boundary");
    const fsPromiseFunctions = new Set([
      "access",
      "appendFile",
      "chmod",
      "chown",
      "copyFile",
      "cp",
      "lchmod",
      "lchown",
      "link",
      "lstat",
      "lutimes",
      "mkdir",
      "mkdtemp",
      "open",
      "opendir",
      "readFile",
      "readdir",
      "readlink",
      "realpath",
      "rename",
      "rm",
      "rmdir",
      "stat",
      "statfs",
      "symlink",
      "truncate",
      "unlink",
      "utimes",
      "writeFile",
    ]);
    const promiseStaticFunctions = new Set([
      "all",
      "allSettled",
      "any",
      "race",
      "reject",
      "resolve",
    ]);
    const importIdentityCache = new WeakMap();
    const importIdentity = (binding) => {
      step();
      if (importIdentityCache.has(binding)) return importIdentityCache.get(binding);
      const declaration = binding?.declaration;
      if (!declaration) return undefined;
      let current = declaration;
      while (current && !ts.isImportDeclaration(current)) {
        step();
        current = current.parent;
      }
      if (!current || !ts.isStringLiteral(current.moduleSpecifier)) {
        importIdentityCache.set(binding, undefined);
        return undefined;
      }
      let identity;
      if (ts.isImportSpecifier(declaration))
        identity = {
          imported: declaration.propertyName?.text ?? declaration.name.text,
          module: current.moduleSpecifier.text,
        };
      importIdentityCache.set(binding, identity);
      return identity;
    };
    const isDirectAmbientPromise = (node) => {
      const current = unwrap(node);
      return (
        ts.isIdentifier(current) && current.text === "Promise" && bindingOf(current) === undefined
      );
    };
    const isRuntimeReferenceIdentifier = (node) => {
      if (isNameOnlyIdentifier(node)) return false;
      let current = node.parent;
      while (current) {
        step();
        if (ts.isTypeNode(current)) return false;
        if (ts.isStatement(current) || ts.isExpression(current)) break;
        current = current.parent;
      }
      return true;
    };
    let ambientPromisePoisoned = false;
    const collectPromisePoison = (node) => {
      if (
        ts.isIdentifier(node) &&
        node.text === "Promise" &&
        bindingOf(node) === undefined &&
        isRuntimeReferenceIdentifier(node)
      ) {
        const access = node.parent;
        const call = ts.isPropertyAccessExpression(access) ? access.parent : undefined;
        const exactStaticCall =
          ts.isPropertyAccessExpression(access) &&
          access.expression === node &&
          promiseStaticFunctions.has(access.name.text) &&
          call !== undefined &&
          ts.isCallExpression(call) &&
          call.expression === access;
        if (!exactStaticCall) ambientPromisePoisoned = true;
      }
      ts.forEachChild(node, collectPromisePoison);
    };
    collectPromisePoison(source);
    const trustedOwnDataOperation = (capability) => {
      const trusted = trustedModuleDigest && trustedModule.capabilities.includes(capability);
      if (trusted) trustedModulesUsed.add(filename);
      return trusted;
    };
    const addUnlessTrusted = (capability) => {
      if (!trustedOwnDataOperation(capability)) found.add(capability);
    };
    const authorityTags = new Set([
      "authority_container",
      "browser_network_constructor",
      "child_process_authority",
      "create_require_callable",
      "dynamic_code_callable",
      "filesystem_authority",
      "global_object",
      "module_api_object",
      "module_loader_callable",
      "network_callable",
      "network_authority",
      "network_instance",
      "navigator_object",
      "property_descriptor",
      "prototype_object",
      "process_object",
      "reflection_callable",
      "reflection_object",
      "require_callable",
      "unresolved_authority",
    ]);
    const protectedNames = new Set([
      "Function",
      "EventSource",
      "XMLHttpRequest",
      "WebSocket",
      "child_process",
      "createRequire",
      "dgram",
      "dns",
      "eval",
      "fetch",
      "fs",
      "fs/promises",
      "getBuiltinModule",
      "global",
      "globalThis",
      "http",
      "https",
      "module",
      "navigator",
      "net",
      "node:child_process",
      "node:dgram",
      "node:dns",
      "node:fs",
      "node:fs/promises",
      "node:http",
      "node:https",
      "node:module",
      "node:net",
      "node:process",
      "node:tls",
      "process",
      "sendBeacon",
      "tls",
      "window",
    ]);
    const moduleAuthority = (name) => {
      if (/^(?:node:)?child_process$/u.test(name)) {
        found.add("child_process");
        return new Set(["child_process_authority"]);
      }
      if (/^(?:node:)?(?:fs|fs\/promises)$/u.test(name)) {
        found.add("filesystem");
        return new Set(["filesystem_authority"]);
      }
      if (/^(?:node:)?(?:http|https|net|tls|dns|dgram)$/u.test(name)) {
        found.add("network");
        return new Set(["network_authority"]);
      }
      if (/^(?:node:)?module$/u.test(name)) return new Set(["module_api_object"]);
      if (/^(?:node:)?process$/u.test(name)) return new Set(["process_object"]);
      return new Set();
    };
    const literalProperty = (node) => (node ? constantString(node, step) : undefined);
    const staticallyPrimitivePropertyKey = (node, active = new Set()) => {
      step();
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallyPrimitivePropertyKey(current, active);
      if (
        ts.isStringLiteralLike(node) ||
        ts.isNumericLiteral(node) ||
        ts.isBigIntLiteral(node) ||
        [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
          node.kind,
        )
      )
        return true;
      if (
        (ts.isTemplateExpression(node) ||
          (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)) &&
        literalProperty(node) !== undefined
      )
        return true;
      if (ts.isIdentifier(node)) {
        const binding = bindingOf(node);
        if (
          !binding ||
          !binding.isConst ||
          binding.mutated ||
          !binding.initializer ||
          active.has(binding)
        )
          return false;
        active.add(binding);
        try {
          return staticallyPrimitivePropertyKey(binding.initializer, active);
        } finally {
          active.delete(binding);
        }
      }
      if (ts.isConditionalExpression(node))
        return (
          staticallyPrimitivePropertyKey(node.whenTrue, active) &&
          staticallyPrimitivePropertyKey(node.whenFalse, active)
        );
      return false;
    };
    const staticallySafePropertyName = (name) =>
      !ts.isComputedPropertyName(name) || staticallyPrimitivePropertyKey(name.expression);
    const staticallyPlain = (node, active = new Set()) => {
      step();
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallyPlain(current, active);
      if (
        ts.isStringLiteralLike(node) ||
        ts.isNumericLiteral(node) ||
        [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
          node.kind,
        )
      )
        return true;
      if (ts.isArrayLiteralExpression(node)) {
        return node.elements.every((element) =>
          staticallyPlain(ts.isSpreadElement(element) ? element.expression : element, active),
        );
      }
      if (ts.isObjectLiteralExpression(node)) {
        return node.properties.every((property) => {
          if (ts.isSpreadAssignment(property)) return staticallyPlain(property.expression, active);
          if (ts.isPropertyAssignment(property)) {
            return (
              staticallySafePropertyName(property.name) &&
              staticallyPlain(property.initializer, active)
            );
          }
          return ts.isShorthandPropertyAssignment(property)
            ? staticallyPlain(property.name, active)
            : ts.isMethodDeclaration(property) && staticallySafePropertyName(property.name);
        });
      }
      if (ts.isIdentifier(node)) {
        const binding = bindingOf(node);
        if (
          !binding ||
          !binding.isConst ||
          binding.mutated ||
          !binding.initializer ||
          active.has(binding)
        )
          return false;
        active.add(binding);
        try {
          const initializer = unwrap(binding.initializer);
          const immutablePrimitive = (value) => {
            const plain = unwrap(value);
            if (
              ts.isStringLiteralLike(plain) ||
              ts.isNumericLiteral(plain) ||
              [
                ts.SyntaxKind.TrueKeyword,
                ts.SyntaxKind.FalseKeyword,
                ts.SyntaxKind.NullKeyword,
              ].includes(plain.kind)
            )
              return true;
            if (ts.isIdentifier(plain)) return staticallyPlain(plain, active);
            return (
              ts.isConditionalExpression(plain) &&
              immutablePrimitive(plain.whenTrue) &&
              immutablePrimitive(plain.whenFalse)
            );
          };
          return immutablePrimitive(initializer);
        } finally {
          active.delete(binding);
        }
      }
      if (ts.isConditionalExpression(node))
        return staticallyPlain(node.whenTrue, active) && staticallyPlain(node.whenFalse, active);
      return false;
    };
    const staticallyNonThenable = (node) => {
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallyNonThenable(current);
      if (staticallyPrimitivePropertyKey(node) || ts.isArrayLiteralExpression(node)) return true;
      if (ts.isConditionalExpression(node))
        return staticallyNonThenable(node.whenTrue) && staticallyNonThenable(node.whenFalse);
      if (!ts.isObjectLiteralExpression(node)) return false;
      return node.properties.every((property) => {
        if (ts.isSpreadAssignment(property)) return false;
        if (!("name" in property) || !property.name) return false;
        const name = ts.isComputedPropertyName(property.name)
          ? literalProperty(property.name.expression)
          : ts.isIdentifier(property.name) ||
              ts.isStringLiteralLike(property.name) ||
              ts.isNumericLiteral(property.name)
            ? property.name.text
            : undefined;
        return name !== undefined && name !== "then" && name !== "__proto__";
      });
    };
    const staticallySafeEntries = (node) => {
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallySafeEntries(current);
      if (ts.isConditionalExpression(node))
        return staticallySafeEntries(node.whenTrue) && staticallySafeEntries(node.whenFalse);
      return (
        ts.isArrayLiteralExpression(node) &&
        node.elements.every(
          (entry) =>
            !ts.isSpreadElement(entry) &&
            ts.isArrayLiteralExpression(unwrap(entry)) &&
            unwrap(entry).elements.length >= 1 &&
            !ts.isSpreadElement(unwrap(entry).elements[0]) &&
            staticallyPrimitivePropertyKey(unwrap(entry).elements[0]),
        )
      );
    };
    const staticallySafePromiseIterable = (node) => {
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallySafePromiseIterable(current);
      return (
        ts.isArrayLiteralExpression(node) &&
        node.elements.every((entry) => !ts.isSpreadElement(entry) && staticallyNonThenable(entry))
      );
    };
    const hasAsyncModifier = (node) =>
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;
    const proofInProgress = Symbol("proof-in-progress");
    const callableBindingProofs = new WeakMap();
    const expressionBindingProofs = new WeakMap();
    const asyncFunctionProofs = new WeakMap();
    const safeIterableBindingProofs = new WeakMap();
    const memoizedProof = (cache, key, evaluate) => {
      step();
      const prior = cache.get(key);
      if (prior === proofInProgress) return false;
      if (prior !== undefined) return prior;
      cache.set(key, proofInProgress);
      try {
        const result = evaluate();
        cache.set(key, result);
        return result;
      } catch (error) {
        cache.delete(key);
        throw error;
      }
    };
    const safeOwnIterableFunctions = new Set([
      "ownDataEntries",
      "ownDataKeys",
      "ownDataPropertyNames",
    ]);
    const ownIterableModule = (specifier) => {
      if (specifier === "@zintus-continuity/foundation/safe-data-access") return "foundation";
      if (specifier.startsWith("/") || !specifier.startsWith(".")) return undefined;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filename), specifier),
      );
      if (
        resolved === "packages/foundation/src/safe-data-access.js" ||
        resolved === "packages/foundation/src/safe-data-access.ts"
      )
        return "foundation";
      return resolved === "scripts/safe-own-data.mjs" ? "script" : undefined;
    };
    const ownedJsonModule = (specifier) => {
      if (
        specifier === "@zintus-continuity/foundation/owned-json" ||
        (specifier.startsWith("@zintus-continuity/foundation/") &&
          specifier.includes("owned-json")) ||
        (specifier.startsWith("/") &&
          specifier.includes("/packages/foundation/") &&
          specifier.includes("owned-json"))
      )
        return true;
      if (!specifier.startsWith(".")) return false;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filename), specifier),
      );
      return [
        "packages/foundation/src/owned-json.js",
        "packages/foundation/src/owned-json.ts",
        "packages/foundation/dist/owned-json.js",
        "packages/foundation/dist/owned-json.d.ts",
        "packages/adapters-local/node_modules/@zintus-continuity/foundation/dist/owned-json.js",
        "packages/adapters-local/node_modules/@zintus-continuity/foundation/dist/owned-json.d.ts",
      ].includes(resolved);
    };
    const ownIterableImport = (binding) => {
      const imported = importIdentity(binding);
      if (!imported || !safeOwnIterableFunctions.has(imported.imported)) return undefined;
      const module = ownIterableModule(imported.module);
      return module === "script" && imported.imported === "ownDataPropertyNames"
        ? undefined
        : module;
    };
    const isSafeOwnIterableImport = (binding) => {
      if (binding.mutated || ownIterableImport(binding) !== "script") return false;
      const approved = trustedModuleDigests.has("scripts/safe-own-data.mjs");
      if (approved) trustedModulesUsed.add("scripts/safe-own-data.mjs");
      return approved;
    };
    const safeOwnIterableCall = (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(unwrap(node.expression))) return false;
      const binding = bindingOf(unwrap(node.expression));
      return binding !== undefined && isSafeOwnIterableImport(binding);
    };
    const staticallySafeOwnArgument = (node, active = new Set()) => {
      step();
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallySafeOwnArgument(current, active);
      if (staticallyPrimitivePropertyKey(node)) return true;
      if (ts.isConditionalExpression(node))
        return (
          staticallySafeOwnArgument(node.whenTrue, active) &&
          staticallySafeOwnArgument(node.whenFalse, active)
        );
      if (ts.isArrayLiteralExpression(node))
        return node.elements.every(
          (entry) => !ts.isSpreadElement(entry) && staticallySafeOwnArgument(entry, active),
        );
      if (ts.isObjectLiteralExpression(node))
        return node.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            staticallySafePropertyName(property.name) &&
            staticallySafeOwnArgument(property.initializer, active),
        );
      if (!ts.isIdentifier(node)) return false;
      const binding = bindingOf(node);
      if (
        !binding ||
        !binding.isConst ||
        binding.mutated ||
        !binding.initializer ||
        active.has(binding)
      )
        return false;
      active.add(binding);
      try {
        return staticallySafeOwnArgument(binding.initializer, active);
      } finally {
        active.delete(binding);
      }
    };
    const staticallySafeIterable = (node) => {
      step();
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallySafeIterable(current);
      if (ts.isConditionalExpression(node))
        return staticallySafeIterable(node.whenTrue) && staticallySafeIterable(node.whenFalse);
      if (ts.isIdentifier(node)) {
        const binding = bindingOf(node);
        if (!binding || !binding.isConst || binding.mutated || !binding.initializer) return false;
        return memoizedProof(safeIterableBindingProofs, binding, () =>
          staticallySafeIterable(binding.initializer),
        );
      }
      if (safeOwnIterableCall(node)) {
        return node.arguments.length === 1 && staticallySafeOwnArgument(node.arguments[0]);
      }
      return staticallyPlain(node);
    };
    const staticallyNativePromiseCallable = (node) => {
      step();
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallyNativePromiseCallable(current);
      if (ts.isConditionalExpression(node))
        return (
          staticallyNativePromiseCallable(node.whenTrue) &&
          staticallyNativePromiseCallable(node.whenFalse)
        );
      if (ts.isIdentifier(node)) {
        const binding = bindingOf(node);
        if (!binding || binding.mutated) return false;
        return memoizedProof(callableBindingProofs, binding, () => {
          const imported = importIdentity(binding);
          if (
            imported &&
            /^(?:node:)?fs\/promises$/u.test(imported.module) &&
            fsPromiseFunctions.has(imported.imported)
          )
            return true;
          if (
            binding.declaration &&
            ts.isFunctionLike(binding.declaration) &&
            hasAsyncModifier(binding.declaration)
          )
            return staticallySafeAsyncFunction(binding.declaration);
          if (!binding.isConst || !binding.initializer) return false;
          return staticallyNativePromiseCallable(binding.initializer);
        });
      }
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && hasAsyncModifier(node))
        return staticallySafeAsyncFunction(node);
      if (ts.isPropertyAccessExpression(node)) {
        return (
          !ambientPromisePoisoned &&
          isDirectAmbientPromise(node.expression) &&
          promiseStaticFunctions.has(node.name.text)
        );
      }
      return false;
    };
    const staticallyNativePromiseExpression = (node) => {
      step();
      if (!node) return false;
      const current = unwrap(node);
      if (current !== node) return staticallyNativePromiseExpression(current);
      if (ts.isAwaitExpression(node) || node.kind === ts.SyntaxKind.ImportCall) return true;
      if (ts.isConditionalExpression(node))
        return (
          staticallyNativePromiseExpression(node.whenTrue) &&
          staticallyNativePromiseExpression(node.whenFalse)
        );
      if (ts.isIdentifier(node)) {
        const binding = bindingOf(node);
        if (!binding || !binding.isConst || binding.mutated || !binding.initializer) return false;
        return memoizedProof(expressionBindingProofs, binding, () =>
          staticallyNativePromiseExpression(binding.initializer),
        );
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
        return staticallyNativePromiseCallable(node.expression);
      }
      return false;
    };
    function staticallySafeAsyncFunction(node) {
      step();
      return memoizedProof(asyncFunctionProofs, node, () => {
        if (ts.isArrowFunction(node) && !ts.isBlock(node.body))
          return staticallySafeAsyncResult(node.body);
        let safe = true;
        const inspect = (child) => {
          step();
          if (!safe) return;
          if (child !== node && ts.isFunctionLike(child)) return;
          if (
            ts.isReturnStatement(child) &&
            child.expression &&
            !staticallySafeAsyncResult(child.expression)
          ) {
            safe = false;
            return;
          }
          ts.forEachChild(child, inspect);
        };
        if (node.body) inspect(node.body);
        return safe;
      });
    }
    const staticallySafeAsyncResult = (node) =>
      staticallyNonThenable(node) || staticallyNativePromiseExpression(node);
    const propertyKey = (node) => {
      const current = unwrap(node);
      if (current !== node) return propertyKey(current);
      if (ts.isIdentifier(node)) return referenceKey(node);
      if (ts.isPropertyAccessExpression(node)) {
        const base = propertyKey(node.expression);
        return base === undefined ? undefined : `${base}.${node.name.text}`;
      }
      if (ts.isElementAccessExpression(node)) {
        const base = propertyKey(node.expression);
        const property = literalProperty(node.argumentExpression);
        return base === undefined || property === undefined ? undefined : `${base}.${property}`;
      }
      return undefined;
    };
    const merge = (sets) => new Set(sets.flatMap((set) => Array.from(set)));
    const implicitTags = (tags) =>
      new Set(Array.from(tags).filter((tag) => tag.startsWith("implicit_")));
    const isJsxSpreadChild = (node) =>
      ts.isJsxExpression(node) && node.dotDotDotToken !== undefined;
    const isTypeOnlyComputedName = (node) =>
      ts.isPropertySignature(node.parent) || ts.isMethodSignature(node.parent);
    const isTransportedAuthority = (tags) =>
      Array.from(tags).some((tag) => authorityTags.has(tag) || tag === "protected_authority_name");
    const reflectionMethods = new Set([
      "apply",
      "construct",
      "defineProperty",
      "deleteProperty",
      "get",
      "getOwnPropertyDescriptor",
      "getPrototypeOf",
      "has",
      "ownKeys",
      "preventExtensions",
      "set",
      "setPrototypeOf",
    ]);
    const propertyKeyReflectionMethods = new Set([
      "defineProperty",
      "deleteProperty",
      "get",
      "getOwnPropertyDescriptor",
      "has",
      "set",
    ]);
    const objectPropertyKeyMethods = new Set([
      "defineProperty",
      "getOwnPropertyDescriptor",
      "hasOwn",
    ]);
    const implicitObjectMethods = new Set([
      "assign",
      "defineProperties",
      "entries",
      "fromEntries",
      "getOwnPropertyNames",
      "getOwnPropertyDescriptors",
      "getOwnPropertySymbols",
      "hasOwn",
      "keys",
      "values",
    ]);
    const implicitPromiseMethods = new Set(["all", "allSettled", "any", "race", "resolve", "try"]);
    const dangerousCallableProperties = new Set([
      "__proto__",
      "apply",
      "arguments",
      "bind",
      "call",
      "callee",
      "caller",
      "constructor",
      "prototype",
    ]);
    const dangerousPrototypeProperties = new Set([
      "__proto__",
      "apply",
      "arguments",
      "bind",
      "call",
      "callee",
      "caller",
      "prototype",
    ]);
    const resolve = (node) => {
      step();
      if (!node) return new Set();
      const current = unwrap(node);
      if (current !== node) return resolve(current);
      if (ts.isAwaitExpression(node)) return resolve(node.expression);
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        dangerousCallableProperties.has(node.text)
      )
        return new Set(["dangerous_property_name"]);
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        protectedNames.has(node.text)
      )
        return new Set(["protected_authority_name"]);
      if (ts.isIdentifier(node)) {
        if (isNameOnlyIdentifier(node)) return new Set();
        const binding = bindingOf(node);
        if (binding) {
          const ownModule = ownIterableImport(binding);
          if (ownModule)
            return new Set([
              "implicit_data_callable",
              ownModule === "script"
                ? "implicit_safeOwnData_callable"
                : "implicit_untrustedSafeOwnData_callable",
            ]);
          if (aliases.has(binding)) return new Set(aliases.get(binding));
          if (binding.kind === "function") return new Set(["callable_object"]);
          return new Set();
        }
        if (node.text === "Object") return new Set(["object_reflection_object"]);
        if (node.text === "Array") return new Set(["array_reflection_object"]);
        if (node.text === "Promise") return new Set(["promise_reflection_object"]);
        if (["Map", "Set", "WeakMap", "WeakSet"].includes(node.text))
          return new Set(["iterable_constructor"]);
        if (node.text === "process") return new Set(["process_object"]);
        if (["global", "globalThis", "window"].includes(node.text))
          return new Set(["global_object"]);
        if (node.text === "navigator") return new Set(["navigator_object"]);
        if (node.text === "require") return new Set(["require_callable"]);
        if (node.text === "Reflect") return new Set(["reflection_object"]);
        if (node.text === "Proxy") return new Set(["reflection_callable"]);
        if (node.text === "fetch") {
          found.add("network");
          return new Set(["network_callable"]);
        }
        if (["EventSource", "WebSocket", "XMLHttpRequest"].includes(node.text)) {
          found.add("network");
          return new Set(["browser_network_constructor"]);
        }
        if (["eval", "Function"].includes(node.text)) {
          found.add("dynamic_code");
          return new Set(["dynamic_code_callable"]);
        }
        return new Set();
      }
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node)
      )
        return new Set(["callable_object"]);
      if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) return resolve(node.right);
        if (
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(node.operatorToken.kind)
        )
          return merge([resolve(node.left), resolve(node.right)]);
      }
      if (ts.isArrayLiteralExpression(node)) {
        const tags = merge(
          node.elements.map((element) =>
            ts.isSpreadElement(element) ? resolve(element.expression) : resolve(element),
          ),
        );
        if (isTransportedAuthority(tags)) found.add("unsupported_authority");
        if (tags.has("dangerous_property_name") || tags.has("property_name_container"))
          return new Set(["property_name_container"]);
        const transportedImplicitTags = implicitTags(tags);
        if (transportedImplicitTags.size > 0) return transportedImplicitTags;
        return isTransportedAuthority(tags) ? new Set(["authority_container"]) : new Set();
      }
      if (ts.isObjectLiteralExpression(node)) {
        const tags = merge(
          node.properties.map((property) => {
            if (ts.isSpreadAssignment(property)) return resolve(property.expression);
            if (ts.isPropertyAssignment(property)) return resolve(property.initializer);
            if (ts.isShorthandPropertyAssignment(property)) return resolve(property.name);
            if (ts.isMethodDeclaration(property)) return new Set();
            return new Set();
          }),
        );
        if (isTransportedAuthority(tags)) found.add("unsupported_authority");
        if (tags.has("dangerous_property_name") || tags.has("property_name_container"))
          return new Set(["property_name_container"]);
        const transportedImplicitTags = implicitTags(tags);
        if (transportedImplicitTags.size > 0) return transportedImplicitTags;
        return isTransportedAuthority(tags) ? new Set(["authority_container"]) : new Set();
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const tracked = propertyKey(node);
        if (tracked !== undefined && propertyAliases.has(tracked))
          return new Set(propertyAliases.get(tracked));
        const base = resolve(node.expression);
        const property = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : literalProperty(node.argumentExpression);
        const propertyTags = ts.isElementAccessExpression(node)
          ? resolve(node.argumentExpression)
          : new Set();
        if (property === "constructor" || propertyTags.has("dangerous_property_name")) {
          found.add("dynamic_code");
          return new Set(["dynamic_code_callable"]);
        }
        if (base.has("reflection_object") && reflectionMethods.has(property))
          return new Set(["reflection_callable", `reflection_${property}_callable`]);
        if (base.has("object_reflection_object") && reflectionMethods.has(property))
          return new Set(["reflection_callable", `reflection_${property}_callable`]);
        const transportedImplicitTags = implicitTags(base);
        if (
          transportedImplicitTags.size > 0 &&
          property !== undefined &&
          dangerousPrototypeProperties.has(property)
        ) {
          found.add("unsupported_authority");
          return merge([transportedImplicitTags, new Set([`implicit_${property}_wrapper`])]);
        }
        if (
          (property !== undefined && dangerousPrototypeProperties.has(property)) ||
          propertyTags.has("property_name_container")
        ) {
          found.add("unsupported_authority");
          return new Set(["unresolved_authority"]);
        }
        if (ts.isElementAccessExpression(node) && isTransportedAuthority(base))
          found.add("unsupported_authority");
        if (property === undefined && isTransportedAuthority(base)) {
          found.add("unsupported_authority");
          return new Set();
        }
        if (base.has("process_object") && property === "env") {
          found.add("process_env");
          return new Set(["environment_object"]);
        }
        if (base.has("process_object") && property === "getBuiltinModule")
          return new Set(["module_loader_callable"]);
        if (base.has("module_api_object") && property === "createRequire")
          return new Set(["create_require_callable"]);
        if (base.has("object_reflection_object") && implicitObjectMethods.has(property))
          return new Set(["implicit_data_callable", `implicit_${property}_callable`]);
        if (base.has("array_reflection_object") && property === "from")
          return new Set(["implicit_data_callable", "implicit_Array.from_callable"]);
        if (base.has("promise_reflection_object") && implicitPromiseMethods.has(property))
          return new Set(["implicit_data_callable", `implicit_Promise.${property}_callable`]);
        if (transportedImplicitTags.size > 0) return transportedImplicitTags;
        if (base.has("property_descriptor")) {
          if (property === "value" || property === undefined)
            return new Set(["unresolved_authority"]);
          return new Set();
        }
        if (base.has("prototype_object")) {
          if (property === undefined || dangerousCallableProperties.has(property))
            return new Set(["dynamic_code_callable"]);
          return new Set(["unresolved_authority"]);
        }
        if (base.has("unresolved_authority") || base.has("authority_container")) {
          found.add("unsupported_authority");
          return new Set(["unresolved_authority"]);
        }
        if (base.has("property_name_container")) return new Set(["dangerous_property_name"]);
        if (base.has("callable_object")) {
          if (property === undefined || property === "constructor")
            return new Set(["dynamic_code_callable"]);
          if (["__proto__", "prototype"].includes(property)) return new Set(["prototype_object"]);
          if (["apply", "arguments", "bind", "call", "callee", "caller"].includes(property))
            return new Set(["unresolved_authority"]);
        }
        if (base.has("navigator_object") && property === "sendBeacon") {
          found.add("network");
          return new Set(["network_callable"]);
        }
        if (base.has("network_instance") && ["open", "send"].includes(property)) {
          found.add("network");
          return new Set(["network_callable"]);
        }
        if (base.has("global_object")) {
          if (property === "process") return new Set(["process_object"]);
          if (property === "navigator") return new Set(["navigator_object"]);
          if (property === "fetch") {
            found.add("network");
            return new Set(["network_callable"]);
          }
          if (["EventSource", "WebSocket", "XMLHttpRequest"].includes(property)) {
            found.add("network");
            return new Set(["browser_network_constructor"]);
          }
          if (["eval", "Function"].includes(property)) {
            found.add("dynamic_code");
            return new Set(["dynamic_code_callable"]);
          }
          if (property !== undefined) found.add("unsupported_authority");
        }
        for (const tag of ["child_process_authority", "filesystem_authority", "network_authority"])
          if (base.has(tag)) return new Set([tag]);
        if (
          Array.from(base).some((tag) =>
            [
              "create_require_callable",
              "dynamic_code_callable",
              "module_loader_callable",
              "network_callable",
              "require_callable",
            ].includes(tag),
          )
        )
          found.add("unsupported_authority");
        return new Set();
      }
      if (ts.isCallExpression(node)) {
        const target = resolve(node.expression);
        const argumentTags = node.arguments.map((argument) => resolve(argument));
        if (target.has("implicit_bind_wrapper"))
          return new Set(
            Array.from(target).filter(
              (tag) => tag.startsWith("implicit_") && !tag.endsWith("_wrapper"),
            ),
          );
        const effectiveArguments = target.has("implicit_call_wrapper")
          ? node.arguments.slice(1)
          : node.arguments;
        const promiseIterableConsumer = Array.from(target).some(
          (tag) =>
            tag.startsWith("implicit_Promise.") && tag !== "implicit_Promise.resolve_callable",
        );
        const unsafeImplicitArguments =
          target.has("implicit_data_callable") &&
          (target.has("implicit_apply_wrapper")
            ? true
            : target.has("implicit_untrustedSafeOwnData_callable")
              ? true
              : target.has("implicit_safeOwnData_callable")
                ? effectiveArguments.length !== 1 ||
                  !staticallySafeOwnArgument(effectiveArguments[0])
                : target.has("implicit_fromEntries_callable")
                  ? !staticallySafeEntries(effectiveArguments[0])
                  : target.has("implicit_Promise.resolve_callable")
                    ? effectiveArguments.length > 0 && !staticallyNonThenable(effectiveArguments[0])
                    : target.has("implicit_Array.from_callable")
                      ? !staticallySafeIterable(effectiveArguments[0])
                      : promiseIterableConsumer
                        ? !staticallySafePromiseIterable(effectiveArguments[0])
                        : !effectiveArguments.every((argument) => staticallyPlain(argument)));
        if (
          target.has("implicit_data_callable") &&
          !trustedOwnDataOperation("implicit_data_access") &&
          unsafeImplicitArguments
        )
          found.add("implicit_data_access");
        if (target.has("implicit_fromEntries_callable") && unsafeImplicitArguments) {
          addUnlessTrusted("computed_data_access");
          addUnlessTrusted("unsupported_authority");
        }
        if (
          target.has("implicit_hasOwn_callable") &&
          (node.arguments.length < 2 || literalProperty(node.arguments[1]) === undefined)
        ) {
          addUnlessTrusted("computed_data_access");
          addUnlessTrusted("unsupported_authority");
        }
        const moduleCall = target.has("require_callable") || target.has("module_loader_callable");
        if (moduleCall) {
          if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
            const tags = moduleAuthority(node.arguments[0].text);
            if (tags.size === 0) found.add("unsupported_authority");
            return tags;
          }
          found.add("unsupported_authority");
          return new Set();
        }
        if (target.has("create_require_callable")) {
          found.add("unsupported_authority");
          return new Set(["require_callable"]);
        }
        if (target.has("reflection_callable")) {
          const reflectedProperty = node.arguments[1]
            ? literalProperty(node.arguments[1])
            : undefined;
          const reflectedPropertyTags = argumentTags[1] ?? new Set();
          const reflectionMethod = Array.from(target)
            .find((tag) => /^reflection_.+_callable$/u.test(tag))
            ?.slice("reflection_".length, -"_callable".length);
          if (
            reflectionMethod === "ownKeys" &&
            !trustedOwnDataOperation("implicit_data_access") &&
            !node.arguments.every((argument) => staticallyPlain(argument))
          ) {
            found.add("implicit_data_access");
          }
          if (
            reflectionMethod &&
            propertyKeyReflectionMethods.has(reflectionMethod) &&
            (node.arguments.length < 2 || reflectedProperty === undefined)
          ) {
            addUnlessTrusted("computed_data_access");
            addUnlessTrusted("unsupported_authority");
          }
          if (
            reflectedProperty === "constructor" ||
            reflectedPropertyTags.has("dangerous_property_name")
          ) {
            found.add("dynamic_code");
          } else if (
            (reflectedProperty !== undefined &&
              dangerousPrototypeProperties.has(reflectedProperty)) ||
            reflectedPropertyTags.has("property_name_container")
          ) {
            found.add("unsupported_authority");
          }
          const sensitiveReflectionInput = argumentTags.some(
            (tags) =>
              isTransportedAuthority(tags) ||
              tags.has("callable_object") ||
              tags.has("object_reflection_object"),
          );
          const reflectedImplicitTags = implicitTags(argumentTags[0] ?? new Set());
          if (
            reflectionMethod === "apply" &&
            reflectedImplicitTags.has("implicit_data_callable") &&
            !trustedOwnDataOperation("implicit_data_access")
          ) {
            found.add("implicit_data_access");
            if (reflectedImplicitTags.has("implicit_fromEntries_callable")) {
              addUnlessTrusted("computed_data_access");
              addUnlessTrusted("unsupported_authority");
            }
          }
          if (sensitiveReflectionInput) found.add("unsupported_authority");
          if (target.has("reflection_ownKeys_callable")) return new Set();
          if (target.has("reflection_getOwnPropertyDescriptor_callable"))
            return sensitiveReflectionInput ? new Set(["property_descriptor"]) : new Set();
          if (target.has("reflection_getPrototypeOf_callable"))
            return sensitiveReflectionInput ? new Set(["prototype_object"]) : new Set();
          if (
            target.has("reflection_get_callable") &&
            sensitiveReflectionInput &&
            node.arguments.length >= 2 &&
            literalProperty(node.arguments[1]) !== undefined
          ) {
            return resolve(
              ts.factory.createElementAccessExpression(
                node.arguments[0],
                ts.factory.createStringLiteral(literalProperty(node.arguments[1])),
              ),
            );
          }
          return sensitiveReflectionInput ? new Set(["unresolved_authority"]) : new Set();
        }
        if (target.has("network_callable")) found.add("network");
        if (target.has("dynamic_code_callable")) found.add("dynamic_code");
        if (
          target.has("unresolved_authority") ||
          target.has("authority_container") ||
          target.has("property_descriptor") ||
          target.has("prototype_object")
        )
          found.add("unsupported_authority");
        if (
          !Array.from(target).some((tag) =>
            ["dynamic_code_callable", "network_callable"].includes(tag),
          ) &&
          argumentTags.some(isTransportedAuthority)
        )
          found.add("unsupported_authority");
        return new Set();
      }
      if (ts.isNewExpression(node)) {
        const target = resolve(node.expression);
        const argumentTags = (node.arguments ?? []).map((argument) => resolve(argument));
        if (
          target.has("iterable_constructor") &&
          (node.arguments?.length ?? 0) > 0 &&
          !(node.arguments ?? []).every((argument) => staticallySafeIterable(argument))
        )
          found.add("implicit_data_access");
        if (target.has("browser_network_constructor")) {
          found.add("network");
          return new Set(["network_instance"]);
        }
        if (target.has("network_callable")) found.add("network");
        if (target.has("dynamic_code_callable")) found.add("dynamic_code");
        if (
          target.has("reflection_callable") ||
          target.has("unresolved_authority") ||
          target.has("authority_container") ||
          target.has("property_descriptor") ||
          target.has("prototype_object") ||
          (!target.has("network_callable") &&
            !target.has("dynamic_code_callable") &&
            argumentTags.some(isTransportedAuthority))
        ) {
          addUnlessTrusted("unsupported_authority");
        }
        return new Set();
      }
      if (ts.isTaggedTemplateExpression(node)) {
        const target = resolve(node.tag);
        if (target.has("dynamic_code_callable")) found.add("dynamic_code");
        if (
          target.has("reflection_callable") ||
          target.has("unresolved_authority") ||
          target.has("authority_container") ||
          target.has("property_descriptor") ||
          target.has("prototype_object")
        )
          found.add("unsupported_authority");
        return new Set();
      }
      if (ts.isConditionalExpression(node))
        return merge([resolve(node.whenTrue), resolve(node.whenFalse)]);
      return new Set();
    };
    const bind = (identifier, tags) => {
      const binding = bindingOf(identifier);
      if (!binding || tags.size === 0) return;
      aliases.set(binding, merge([aliases.get(binding) ?? new Set(), tags]));
    };
    const bindPattern = (binding, initializer) => {
      const tags = resolve(initializer);
      if (ts.isIdentifier(binding)) {
        bind(binding, tags);
        return;
      }
      if (isTransportedAuthority(tags)) found.add("unsupported_authority");
      if (ts.isArrayBindingPattern(binding)) {
        for (const [index, element] of binding.elements.entries()) {
          if (!ts.isBindingElement(element)) continue;
          const synthetic = ts.factory.createElementAccessExpression(
            initializer,
            ts.factory.createNumericLiteral(index),
          );
          bindPattern(element.name, element.initializer ?? synthetic);
        }
        return;
      }
      if (!ts.isObjectBindingPattern(binding)) {
        return;
      }
      for (const element of binding.elements) {
        const property = element.propertyName
          ? (literalProperty(element.propertyName) ??
            (ts.isIdentifier(element.propertyName) ? element.propertyName.text : undefined))
          : ts.isIdentifier(element.name)
            ? element.name.text
            : undefined;
        if (property === undefined) {
          found.add("unsupported_authority");
          continue;
        }
        const synthetic = ts.factory.createElementAccessExpression(
          initializer,
          ts.factory.createStringLiteral(property),
        );
        bindPattern(element.name, element.initializer ?? synthetic);
      }
    };
    const bindAssignmentPattern = (target, initializer) => {
      const current = unwrap(target);
      if (ts.isIdentifier(current)) {
        bind(current, resolve(initializer));
        return;
      }
      if (ts.isArrayLiteralExpression(current)) {
        for (const [index, element] of current.elements.entries()) {
          if (ts.isOmittedExpression(element)) continue;
          const targetElement = ts.isSpreadElement(element) ? element.expression : element;
          bindAssignmentPattern(
            targetElement,
            ts.factory.createElementAccessExpression(
              initializer,
              ts.factory.createNumericLiteral(index),
            ),
          );
        }
        return;
      }
      if (ts.isObjectLiteralExpression(current)) {
        for (const property of current.properties) {
          if (ts.isShorthandPropertyAssignment(property)) {
            bindAssignmentPattern(
              property.name,
              ts.factory.createElementAccessExpression(
                initializer,
                ts.factory.createStringLiteral(property.name.text),
              ),
            );
          } else if (ts.isPropertyAssignment(property)) {
            const key =
              ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
                ? property.name.text
                : literalProperty(property.name);
            if (key === undefined) {
              found.add("unsupported_authority");
            } else {
              bindAssignmentPattern(
                property.initializer,
                ts.factory.createElementAccessExpression(
                  initializer,
                  ts.factory.createStringLiteral(key),
                ),
              );
            }
          } else {
            found.add("unsupported_authority");
          }
        }
      }
    };
    const visit = (node) => {
      if (
        ts.isComputedPropertyName(node) &&
        !isTypeOnlyComputedName(node) &&
        !staticallyPrimitivePropertyKey(node.expression)
      ) {
        found.add("computed_data_access");
        found.add("unsupported_authority");
      }
      if (ts.isNewExpression(node) && isDirectAmbientPromise(node.expression))
        found.add("implicit_data_access");
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        isDirectAmbientPromise(node.expression.expression) &&
        node.expression.name.text === "try"
      )
        found.add("implicit_data_access");
      if (
        ts.isYieldExpression(node) &&
        node.asteriskToken &&
        !staticallySafeIterable(node.expression)
      ) {
        addUnlessTrusted("implicit_data_access");
        if (isTransportedAuthority(resolve(node.expression)))
          addUnlessTrusted("unsupported_authority");
      }
      if (ts.isJsxSpreadAttribute(node) && isTransportedAuthority(resolve(node.expression)))
        found.add("unsupported_authority");
      if (
        ts.isJsxExpression(node) &&
        node.expression &&
        isTransportedAuthority(resolve(node.expression))
      )
        found.add("unsupported_authority");
      if (ts.isForOfStatement(node) && !staticallySafeIterable(node.expression)) {
        addUnlessTrusted("implicit_data_access");
        if (isTransportedAuthority(resolve(node.expression)))
          addUnlessTrusted("unsupported_authority");
      }
      if (ts.isAwaitExpression(node) && !staticallySafeAsyncResult(node.expression))
        found.add("implicit_data_access");
      if (ts.isReturnStatement(node) && node.expression) {
        let owner = node.parent;
        while (owner && !ts.isFunctionLike(owner)) {
          step();
          owner = owner.parent;
        }
        if (owner && hasAsyncModifier(owner) && !staticallySafeAsyncResult(node.expression))
          found.add("implicit_data_access");
      }
      if (
        ts.isArrowFunction(node) &&
        hasAsyncModifier(node) &&
        !ts.isBlock(node.body) &&
        !staticallySafeAsyncResult(node.body)
      )
        found.add("implicit_data_access");
      if (
        ((ts.isYieldExpression(node) && !node.asteriskToken) || ts.isThrowStatement(node)) &&
        isTransportedAuthority(resolve(node.expression))
      )
        found.add("unsupported_authority");
      if (
        ts.isParameter(node) &&
        (ts.isArrayBindingPattern(node.name) || ts.isObjectBindingPattern(node.name)) &&
        !trustedOwnDataOperation("implicit_data_access")
      )
        found.add("implicit_data_access");
      if (
        ts.isCatchClause(node) &&
        node.variableDeclaration &&
        (ts.isArrayBindingPattern(node.variableDeclaration.name) ||
          ts.isObjectBindingPattern(node.variableDeclaration.name)) &&
        !trustedOwnDataOperation("implicit_data_access")
      )
        found.add("implicit_data_access");
      if (ts.isDecorator(node)) {
        const tags = resolve(node.expression);
        const transportedImplicitTags = implicitTags(tags);
        if (transportedImplicitTags.has("implicit_data_callable")) {
          found.add("implicit_data_access");
          found.add("unsupported_authority");
          if (transportedImplicitTags.has("implicit_fromEntries_callable"))
            found.add("computed_data_access");
        }
        if (isTransportedAuthority(tags) || tags.has("reflection_object"))
          found.add("unsupported_authority");
      }
      if (ts.isElementAccessExpression(node)) {
        const key = literalProperty(node.argumentExpression);
        const numericLiteral = ts.isNumericLiteral(unwrap(node.argumentExpression));
        if (!numericLiteral && key === undefined) {
          found.add("computed_data_access");
        }
        if (key !== undefined && dangerousCallableProperties.has(key)) {
          found.add("unsupported_authority");
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword) {
        if (!staticallyPrimitivePropertyKey(node.left)) {
          addUnlessTrusted("computed_data_access");
          addUnlessTrusted("unsupported_authority");
        }
        if (!staticallyPlain(node.right)) addUnlessTrusted("implicit_data_access");
        if (isTransportedAuthority(resolve(node.right))) addUnlessTrusted("unsupported_authority");
      }
      if (
        (ts.isSpreadAssignment(node) ||
          ts.isSpreadElement(node) ||
          ts.isJsxSpreadAttribute(node) ||
          isJsxSpreadChild(node)) &&
        !(ts.isSpreadElement(node) || isJsxSpreadChild(node)
          ? staticallySafeIterable(node.expression)
          : staticallyPlain(node.expression))
      ) {
        found.add("implicit_data_access");
      }
      if (
        ts.isBindingElement(node) &&
        node.dotDotDotToken &&
        !trustedOwnDataOperation("implicit_data_access")
      ) {
        found.add("implicit_data_access");
      }
      if (ts.isForInStatement(node)) {
        found.add("implicit_data_access");
      }
      if (
        ts.isCallExpression(node) &&
        (ts.isPropertyAccessExpression(unwrap(node.expression)) ||
          ts.isElementAccessExpression(unwrap(node.expression)))
      ) {
        const callable = unwrap(node.expression);
        const receiver = unwrap(callable.expression);
        const method = ts.isPropertyAccessExpression(callable)
          ? callable.name.text
          : literalProperty(callable.argumentExpression);
        const key = node.arguments[1] ? literalProperty(node.arguments[1]) : undefined;
        if (
          ts.isIdentifier(receiver) &&
          bindingOf(receiver) !== undefined &&
          ((receiver.text === "Object" &&
            (reflectionMethods.has(method) || implicitObjectMethods.has(method))) ||
            (receiver.text === "Reflect" && reflectionMethods.has(method)))
        ) {
          found.add("unsupported_authority");
        }
        if (
          ts.isIdentifier(receiver) &&
          receiver.text === "Object" &&
          objectPropertyKeyMethods.has(method) &&
          key === undefined
        ) {
          addUnlessTrusted("computed_data_access");
          addUnlessTrusted("unsupported_authority");
        }
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(unwrap(node.expression)) &&
        unwrap(node.expression).text === "Proxy" &&
        bindingOf(unwrap(node.expression)) !== undefined
      ) {
        found.add("unsupported_authority");
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const privilegedPolicy = privilegedPolicyForSpecifier(node.moduleSpecifier.text);
        if (privilegedPolicy && !approvedPrivilegedImport(privilegedPolicy, node))
          privilegedImportViolation();
        const tags = moduleAuthority(node.moduleSpecifier.text);
        const clause = node.importClause;
        if (
          ownedJsonModule(node.moduleSpecifier.text) &&
          !(
            approvedOwnedJsonConsumer &&
            node.moduleSpecifier.text === "@zintus-continuity/foundation/owned-json"
          )
        ) {
          const hasRuntimeAuthority =
            clause === undefined ||
            (!clause.isTypeOnly &&
              (clause.name !== undefined ||
                clause.namedBindings === undefined ||
                ts.isNamespaceImport(clause.namedBindings) ||
                (ts.isNamedImports(clause.namedBindings) &&
                  clause.namedBindings.elements.some((element) => !element.isTypeOnly))));
          if (hasRuntimeAuthority) {
            found.add("implicit_data_access");
            found.add("unsupported_authority");
          }
        }
        if (
          ownIterableModule(node.moduleSpecifier.text) &&
          (clause?.name !== undefined ||
            (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)))
        ) {
          found.add("implicit_data_access");
          found.add("unsupported_authority");
        }
        if (clause?.name) bind(clause.name, tags);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
          bind(clause.namedBindings.name, tags);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if (clause.isTypeOnly || element.isTypeOnly) continue;
            const imported = element.propertyName?.text ?? element.name.text;
            if (tags.has("module_api_object") && imported === "createRequire")
              bind(element.name, new Set(["create_require_callable"]));
            else if (tags.has("process_object") && imported === "getBuiltinModule")
              bind(element.name, new Set(["module_loader_callable"]));
            else bind(element.name, tags);
          }
        }
      }
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        if (privilegedPolicyForSpecifier(node.moduleReference.expression.text))
          privilegedImportViolation();
        if (!node.isTypeOnly && ownedJsonModule(node.moduleReference.expression.text)) {
          found.add("implicit_data_access");
          found.add("unsupported_authority");
        }
        bind(node.name, moduleAuthority(node.moduleReference.expression.text));
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        found.add("dynamic_import");
        const specifier = node.arguments[0];
        if (specifier && privilegedPolicyForExpression(specifier)) privilegedImportViolation();
        if (
          specifier &&
          ts.isStringLiteralLike(unwrap(specifier)) &&
          ownIterableModule(unwrap(specifier).text)
        ) {
          found.add("implicit_data_access");
          found.add("unsupported_authority");
        }
        if (
          specifier &&
          ts.isStringLiteralLike(unwrap(specifier)) &&
          ownedJsonModule(unwrap(specifier).text)
        ) {
          found.add("implicit_data_access");
          found.add("unsupported_authority");
        }
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        privilegedPolicyForSpecifier(node.moduleSpecifier.text)
      )
        privilegedImportViolation();
      if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
        const exportedElements =
          node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.filter((element) => !element.isTypeOnly)
            : undefined;
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          if (
            ownedJsonModule(node.moduleSpecifier.text) &&
            (exportedElements === undefined || exportedElements.length > 0)
          ) {
            found.add("implicit_data_access");
            found.add("unsupported_authority");
          }
          const resolvedExport = node.moduleSpecifier.text.startsWith(".")
            ? path.posix.normalize(
                path.posix.join(path.posix.dirname(filename), node.moduleSpecifier.text),
              )
            : node.moduleSpecifier.text;
          if (
            !trustedModuleDigest &&
            (resolvedExport === "packages/foundation/src/safe-data-access.js" ||
              resolvedExport === "scripts/safe-own-data.mjs" ||
              resolvedExport === "@zintus-continuity/foundation/safe-data-access") &&
            (exportedElements === undefined ||
              exportedElements.some((element) =>
                safeOwnIterableFunctions.has((element.propertyName ?? element.name).text),
              ))
          )
            found.add("unsupported_authority");
          if (exportedElements === undefined || exportedElements.length > 0)
            moduleAuthority(node.moduleSpecifier.text);
        } else if (exportedElements) {
          for (const element of exportedElements) {
            const local = element.propertyName ?? element.name;
            const binding = bindingOf(local);
            if (binding && ownIterableImport(binding)) found.add("unsupported_authority");
            const tags = binding
              ? (aliases.get(binding) ??
                (binding.kind === "function" ? new Set(["callable_object"]) : new Set()))
              : new Set();
            if (isTransportedAuthority(tags)) found.add("unsupported_authority");
          }
        }
      }
      if (ts.isNewExpression(node)) {
        const parentCall = node.parent;
        const policy = node.arguments?.[0]
          ? privilegedPolicyForExpression(node.arguments[0])
          : undefined;
        const exactApprovedAlias =
          policy &&
          ts.isCallExpression(parentCall) &&
          approvedPrivilegedUrlReference(policy, parentCall, node);
        if (!exactApprovedAlias) {
          for (const argument of node.arguments ?? []) {
            const argumentPolicy = privilegedPolicyForExpression(argument);
            if (argumentPolicy && argumentPolicy !== unknownCoercibleSpecifier) {
              privilegedImportViolation();
              break;
            }
          }
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
        const callable = unwrap(node.expression);
        const callableName = ts.isIdentifier(callable)
          ? callable.text
          : ts.isPropertyAccessExpression(callable)
            ? callable.name.text
            : undefined;
        const callableTags = resolve(node.expression);
        const moduleLoadSink =
          (callableName !== undefined &&
            ["importModule", "load", "loader", "loadModule", "require", "resolveModule"].includes(
              callableName,
            )) ||
          callableTags.has("create_require_callable") ||
          callableTags.has("module_loader_callable");
        const exactAdapterManifestCall =
          (filename === "scripts/h2-crdb-apply-0008.mjs" ||
            filename === "scripts/h2-crdb-migrate.mjs" ||
            filename === "scripts/h2-crdb-smoke.mjs") &&
          callableName === "createRequire" &&
          node.arguments.length === 1 &&
          node.arguments[0].getText(source) ===
            'path.join(root, "packages/adapters-local/package.json")';
        const exactAdapterManifestLoader =
          exactAdapterManifestCall && callableTags.has("create_require_callable");
        if (exactAdapterManifestCall && !exactAdapterManifestLoader) privilegedImportViolation();
        for (const argument of exactAdapterManifestLoader ? [] : node.arguments) {
          const policy = privilegedPolicyForExpression(argument);
          if (
            policy &&
            (policy !== unknownCoercibleSpecifier || moduleLoadSink) &&
            !approvedPrivilegedUrlReference(policy, node, argument)
          ) {
            privilegedImportViolation();
            break;
          }
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name)
        bind(node.name, new Set(["callable_object"]));
      if (ts.isVariableDeclaration(node) && node.initializer)
        bindPattern(node.name, node.initializer);
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ((ts.isArrayBindingPattern(node.name) && !staticallySafeIterable(node.initializer)) ||
          (ts.isObjectBindingPattern(node.name) && !staticallyPlain(node.initializer)))
      )
        found.add("implicit_data_access");
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const tags = resolve(node.right);
        if (
          (ts.isArrayLiteralExpression(unwrap(node.left)) ||
            ts.isObjectLiteralExpression(unwrap(node.left))) &&
          !(ts.isArrayLiteralExpression(unwrap(node.left))
            ? staticallySafeIterable(node.right)
            : staticallyPlain(node.right))
        )
          found.add("implicit_data_access");
        if (
          ts.isIdentifier(node.left) ||
          ts.isArrayLiteralExpression(unwrap(node.left)) ||
          ts.isObjectLiteralExpression(unwrap(node.left))
        )
          bindAssignmentPattern(node.left, node.right);
        if (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) {
          if (isTransportedAuthority(tags)) found.add("unsupported_authority");
          const tracked = propertyKey(node.left);
          if (tracked !== undefined && tags.size > 0) propertyAliases.set(tracked, tags);
        }
      }
      if (ts.isParameter(node) && node.initializer) {
        const tags = resolve(node.initializer);
        if (isTransportedAuthority(tags)) found.add("unsupported_authority");
        bindPattern(node.name, node.initializer);
      }
      if (ts.isBindingElement(node) && node.initializer) {
        const tags = resolve(node.initializer);
        if (isTransportedAuthority(tags)) found.add("unsupported_authority");
        if (ts.isIdentifier(node.name)) bind(node.name, tags);
      }
      if (ts.isReturnStatement(node) && isTransportedAuthority(resolve(node.expression)))
        found.add("unsupported_authority");
      if (ts.isExportAssignment(node) && isTransportedAuthority(resolve(node.expression)))
        found.add("unsupported_authority");
      if (
        ts.isVariableStatement(node) &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
        node.declarationList.declarations.some(
          (declaration) =>
            declaration.initializer && isTransportedAuthority(resolve(declaration.initializer)),
        )
      )
        found.add("unsupported_authority");
      if (
        ts.isArrowFunction(node) &&
        !ts.isBlock(node.body) &&
        isTransportedAuthority(resolve(node.body))
      )
        found.add("unsupported_authority");
      resolve(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };
  const display = (candidate) => {
    const relative = path.relative(canonicalRoot, candidate);
    return relative === "" ? "<root>" : inside(canonicalRoot, candidate) ? relative : "<root>";
  };
  const filesystem = async (candidate, rule, operation) => {
    try {
      return await operation();
    } catch {
      throw new Error(`${display(candidate)}:${rule}`);
    }
  };
  let directories = 0;
  let entriesSeen = 0;
  const walk = async (rootCandidate) => {
    const pending = [rootCandidate];
    while (pending.length > 0) {
      const candidate = pending.pop();
      if (candidate === undefined) break;
      const stat = await filesystem(candidate, "SOURCE_SECURITY_LSTAT_FAILED", () =>
        lstat(candidate),
      );
      if (stat.isSymbolicLink())
        throw new Error(`${display(candidate)}:SOURCE_SECURITY_SYMLINK_PROHIBITED`);
      const relative = path.relative(canonicalRoot, candidate);
      if (stat.isDirectory()) {
        if (candidate !== canonicalRoot && excluded.has(relative)) continue;
        directories += 1;
        if (directories > configuration.maxDirectories)
          throw new Error(`${display(candidate)}:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED`);
        const entries = await filesystem(candidate, "SOURCE_SECURITY_READDIR_FAILED", () =>
          readdir(candidate),
        );
        entriesSeen += entries.length;
        if (entriesSeen > configuration.maxEntries)
          throw new Error(`${display(candidate)}:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED`);
        for (const entry of entries.sort(utf8Order).reverse()) {
          pending.push(path.join(candidate, entry));
        }
        continue;
      }
      if (!stat.isFile())
        throw new Error(`${display(candidate)}:SOURCE_SECURITY_SPECIAL_FILE_PROHIBITED`);
      if (!extensions.has(path.extname(candidate))) continue;
      files += 1;
      totalBytes += stat.size;
      consumeReadBudget(relative, stat.size);
      if (
        files > configuration.maxFiles ||
        stat.size > configuration.maxFileBytes ||
        totalBytes > configuration.maxTotalBytes
      ) {
        throw new Error(`${display(candidate)}:SOURCE_SECURITY_SCAN_BUDGET_EXCEEDED`);
      }
      const bytes = await filesystem(candidate, "SOURCE_SECURITY_READ_FAILED", () =>
        readFile(candidate),
      );
      if (bytes.length !== stat.size)
        throw new Error(`${display(candidate)}:SOURCE_SECURITY_FILE_CHANGED_DURING_SCAN`);
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`${display(candidate)}:SOURCE_SECURITY_UTF8_INVALID`);
      }
      if (path.extname(candidate) === ".py") {
        pythonSources.push(relative);
        if (relative !== pythonPolicy.path || sha256(bytes) !== pythonPolicy.sha256)
          findings.push({ path: relative, rule: "PYTHON_SINGLETON_IDENTITY" });
      }
      if (isExecutableSourcePath(candidate)) {
        const contentSha256 = createHash("sha256").update(bytes).digest("hex");
        for (const capability of astCapabilities(text, relative, contentSha256)) {
          if (!allow(capability, relative))
            findings.push({ path: relative, rule: `SAST_CAPABILITY_${capability.toUpperCase()}` });
        }
      }
      if (path.extname(candidate) === ".html") {
        for (const rule of htmlLexicalFindings(
          text,
          relative,
          canonicalRoot,
          configuration.htmlLexicalGate,
        ))
          findings.push({ path: relative, rule });
      }
      for (const [rule, expression] of secretRules.concat(sastRules)) {
        if (expression.test(text)) {
          findings.push({ path: relative, rule });
        }
      }
    }
  };
  for (const relative of configuration.roots) {
    const candidate = path.resolve(canonicalRoot, relative);
    if (!inside(canonicalRoot, candidate)) throw new Error("source-security root escapes");
    await walk(candidate);
  }
  if (pythonEnabled && JSON.stringify(pythonSources) !== JSON.stringify([pythonPolicy.path]))
    findings.push({ path: "<root>", rule: "PYTHON_SINGLETON_CARDINALITY" });
  await ownedJsonBridge?.recheck();
  for (const relative of trustedModulesUsed) {
    const digest = createHash("sha256")
      .update(await readTrustedFile(relative))
      .digest("hex");
    if (digest !== trustedModuleDigests.get(relative))
      throw new Error(`${relative}:SOURCE_SECURITY_TRUSTED_MODULE_CHANGED`);
  }
  findings.sort(
    (left, right) => utf8Order(left.path, right.path) || utf8Order(left.rule, right.rule),
  );
  return {
    files,
    totalBytes,
    findings,
    bridgeStatus: ownedJsonBridge?.status,
  };
}

async function main() {
  const sourceOnly = process.argv.length === 3 && process.argv[2] === "--staged-source";
  if (!sourceOnly && process.argv.length !== 2)
    throw new Error("source-security accepts only --staged-source");
  let policy;
  try {
    policy = JSON.parse(await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"));
  } catch {
    throw new Error("ci/b03-policy.json:SOURCE_SECURITY_POLICY_READ_OR_PARSE_FAILED");
  }
  const result = await scanSourceSecurity(repositoryRoot, policy.sourceSecurity, {
    sourceOnly,
  });
  if (result.findings.length > 0) {
    const summary = result.findings
      .map(({ path: relative, rule }) => `${relative}:${rule}`)
      .join(",");
    throw new Error(`content-free findings: ${summary}`);
  }
  const label = sourceOnly ? "STAGED_SOURCE_PASS_NOT_RUNTIME" : (result.bridgeStatus ?? "PASS");
  process.stdout.write(
    `source-security: ${label} (${result.files} files, ${result.totalBytes} bytes; content-free)\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `source-security: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
