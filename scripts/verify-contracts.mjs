import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  validateRestrictedSchema,
  validateRestrictedSchemaWithLocalRefs,
} from "../packages/contracts/src/restricted-schema.ts";
import {
  crossValidateExecutableSemantics,
  validateSemanticProfile,
} from "../packages/contracts/src/semantic-profile.ts";
import { ownDataEntries, ownDataKeys, readOwnData, writeOwnData } from "./safe-own-data.mjs";
import { utf8Order } from "./verify-trust-preflight.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const schemaRoot = path.join(repositoryRoot, "packages", "contracts", "schemas", "v1");
const semanticProfileFile = path.join(
  repositoryRoot,
  "packages",
  "contracts",
  "semantics",
  "v1",
  "semantic-profile.json",
);
const generatedFile = path.join(
  repositoryRoot,
  "packages",
  "contracts",
  "src",
  "generated",
  "schema-catalog.ts",
);
const expectedFiles = [
  "api.schema.json",
  "envelope.schema.json",
  "event.schema.json",
  "policy.schema.json",
  "provider.schema.json",
  "receipt.schema.json",
  "registry.schema.json",
  "task.schema.json",
];
const expectedIds = new Map(
  expectedFiles.map((name) => [
    name,
    `urn:zintus-continuity:contracts:v1:${name.replace(".schema.json", "")}`,
  ]),
);
const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);

export function parseJsonWithoutDuplicateKeys(source, label = "JSON") {
  let index = 0;
  const whitespace = () => {
    while (/\s/u.test(source.at(index) ?? "")) index += 1;
  };
  const fail = (message) => {
    throw new Error(`${label}: ${message} at byte ${index}`);
  };
  const parseString = () => {
    const start = index;
    if (source.at(index++) !== '"') fail("expected string");
    while (index < source.length) {
      if (source.at(index) === "\\") {
        index += 2;
      } else if (source.at(index++) === '"') {
        return JSON.parse(source.slice(start, index));
      }
    }
    fail("unterminated string");
  };
  const value = (depth = 0) => {
    if (depth > 128) fail("nesting budget exceeded");
    whitespace();
    const character = source.at(index);
    if (character === "{") return object(depth + 1);
    if (character === "[") return array(depth + 1);
    if (character === '"') return parseString();
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
      source.slice(index),
    );
    if (!match) fail("invalid value");
    index += match[0].length;
    return JSON.parse(match[0]);
  };
  const array = (depth) => {
    const result = [];
    index += 1;
    whitespace();
    if (source.at(index) === "]") {
      index += 1;
      return result;
    }
    for (;;) {
      result.push(value(depth));
      whitespace();
      if (source.at(index) === "]") {
        index += 1;
        return result;
      }
      if (source.at(index++) !== ",") fail("expected array delimiter");
    }
  };
  const object = (depth) => {
    const result = Object.create(null);
    const keys = new Set();
    index += 1;
    whitespace();
    if (source.at(index) === "}") {
      index += 1;
      return result;
    }
    for (;;) {
      whitespace();
      const key = parseString();
      if (keys.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
      if (dangerousKeys.has(key)) fail(`pollution key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (source.at(index++) !== ":") fail("expected object delimiter");
      writeOwnData(result, key, value(depth));
      whitespace();
      if (source.at(index) === "}") {
        index += 1;
        return result;
      }
      if (source.at(index++) !== ",") fail("expected member delimiter");
    }
  };
  const result = value();
  whitespace();
  if (index !== source.length) fail("trailing input");
  return result;
}

export function validateSemanticProfileForTest(profile) {
  return validateSemanticProfile(profile);
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    const result = Object.create(null);
    const keys = ownDataKeys(value).slice().sort(utf8Order);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys.at(index);
      writeOwnData(result, key, sorted(readOwnData(value, String(key))));
    }
    return result;
  }
  return value;
}

export function validateRestrictedSchemaForTest(schema) {
  return validateRestrictedSchema(schema);
}

export function validateRestrictedSchemaWithLocalRefsForTest(schema, envelope) {
  return validateRestrictedSchemaWithLocalRefs(schema, envelope);
}

function runParserAndReferenceSelfTests() {
  for (const source of ['{"x":1,"x":2}', '{"__proto__":{}}']) {
    let rejected = false;
    try {
      parseJsonWithoutDuplicateKeys(source, "self-test");
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("strict JSON parser self-test failed");
  }
  let rejectedRemote = false;
  try {
    validateRestrictedSchema({ $ref: "https://example.invalid/schema" });
  } catch {
    rejectedRemote = true;
  }
  if (!rejectedRemote) throw new Error("remote reference self-test failed");
}

export function computeContractIdentityDigestForTest(catalog, semanticProfile) {
  validateSemanticProfileForTest(semanticProfile);
  return createHash("sha256")
    .update(JSON.stringify(sorted({ schemas: catalog, semanticProfile })))
    .digest("hex");
}

function renderCatalog(catalog, semanticProfile) {
  const body = JSON.stringify(sorted(catalog), null, 2);
  const semantics = JSON.stringify(sorted(semanticProfile), null, 2);
  const identity = computeContractIdentityDigestForTest(catalog, semanticProfile);
  return `/** Generated deterministically from schemas/v1 plus semantics/v1 by scripts/verify-contracts.mjs. */\nconst generatedSchemaCatalog = ${body} as const;\nconst generatedSemanticProfile = ${semantics} as const;\n\nfunction freezeSchemaCatalog<const Value>(value: Value): Value {\n  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {\n    for (const nested of Object.values(value)) freezeSchemaCatalog(nested);\n    Object.freeze(value);\n  }\n  return value;\n}\n\nexport const contractSchemaCatalog = freezeSchemaCatalog(generatedSchemaCatalog);\nexport const contractSemanticProfile = freezeSchemaCatalog(generatedSemanticProfile);\nexport const contractCatalogIdentitySha256 = "${identity}" as const;\n\nexport const contractSchemaNames = Object.freeze(\n  Object.keys(contractSchemaCatalog) as Array<keyof typeof contractSchemaCatalog>,\n);\n\nexport type ContractSchemaName = keyof typeof contractSchemaCatalog;\n`;
}

export function crossValidateExecutableSemanticsForTest(catalog, semanticProfile) {
  return crossValidateExecutableSemantics(catalog, semanticProfile);
}

export async function verifyContracts({ write = false } = {}) {
  runParserAndReferenceSelfTests();
  const stat = await lstat(schemaRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("schema root must be a real directory");
  const actual = (await readdir(schemaRoot)).sort(utf8Order);
  if (JSON.stringify(actual) !== JSON.stringify(expectedFiles)) {
    throw new Error("v1 schema filenames differ from the exact allowlist");
  }
  const catalog = Object.create(null);
  for (const filename of actual) {
    const candidate = path.join(schemaRoot, filename);
    const fileStat = await lstat(candidate);
    if (!fileStat.isFile() || fileStat.isSymbolicLink())
      throw new Error(`${filename} must be a real file`);
    const source = await readFile(candidate, "utf8");
    const maximumSchemaBytes = filename === "receipt.schema.json" ? 65_536 : 32_768;
    if (Buffer.byteLength(source) > maximumSchemaBytes) {
      throw new Error(`${filename} exceeds its reviewed byte bound`);
    }
    const schema = parseJsonWithoutDuplicateKeys(source, filename);
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(`${filename} uses an unpinned dialect`);
    }
    if (schema.$id !== expectedIds.get(filename))
      throw new Error(`${filename} has an unexpected $id`);
    validateRestrictedSchema(schema);
    writeOwnData(catalog, filename, schema);
  }
  const envelope = catalog["envelope.schema.json"];
  for (const [filename, schema] of ownDataEntries(catalog)) {
    try {
      validateRestrictedSchemaWithLocalRefs(schema, envelope);
    } catch (error) {
      throw new Error(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const semanticStat = await lstat(semanticProfileFile);
  if (!semanticStat.isFile() || semanticStat.isSymbolicLink()) {
    throw new Error("semantic profile must be a real file");
  }
  const semanticSource = await readFile(semanticProfileFile, "utf8");
  if (Buffer.byteLength(semanticSource) > 32_768) {
    throw new Error("semantic profile exceeds its reviewed byte bound");
  }
  const semanticProfile = parseJsonWithoutDuplicateKeys(semanticSource, "semantic-profile.json");
  validateSemanticProfileForTest(semanticProfile);
  crossValidateExecutableSemanticsForTest(catalog, semanticProfile);
  const rendered = renderCatalog(catalog, semanticProfile);
  if (write) {
    await writeFile(generatedFile, rendered, "utf8");
  } else if ((await readFile(generatedFile, "utf8")) !== rendered) {
    throw new Error(
      "generated schema catalog is stale; run node scripts/verify-contracts.mjs --write",
    );
  }
  return {
    files: actual.length,
    sha256: computeContractIdentityDigestForTest(catalog, semanticProfile),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const argument = process.argv[2];
  if (process.argv.length > 3 || (argument !== undefined && argument !== "--write")) {
    throw new Error("usage: node scripts/verify-contracts.mjs [--write]");
  }
  verifyContracts({ write: argument === "--write" })
    .then(({ files, sha256 }) => {
      process.stdout.write(`contracts: PASS (${files} schemas, catalog ${sha256})\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `contracts: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
