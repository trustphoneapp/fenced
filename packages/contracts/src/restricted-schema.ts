import {
  hasOwnDataProperty,
  ownDataEntries,
  ownDataHasNoSymbols,
  ownDataKeys,
  ownDataPropertyNames,
  readOwnData,
  readOwnDataDescriptor,
} from "@zintus-continuity/foundation/safe-data-access";

type Schema = Readonly<Record<string, unknown>>;

const allowedKeywords = new Set([
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "minItems",
  "minLength",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
  "uniqueItems",
]);
const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);
const plainArrayPrototype = Object.getPrototypeOf([]);
const plainObjectPrototype = Object.getPrototypeOf({});
const reviewedLinearPatterns = new Set([
  "^(0|-?[1-9][0-9]{0,18})$",
  "^(0|[1-9][0-9]{0,19})$",
  "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
  "^[0-9a-f]{48}$",
  "^[0-9a-f]{64}$",
  "^[1-9][0-9]{0,19}$",
  "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
  "^[A-Za-z0-9_-]{128}$",
  "^[A-Za-z0-9_-]{86}$",
  "^[A-Z][A-Z0-9_.:-]*$",
  "^[a-z][a-z0-9._:-]*$",
  "^[a-z][a-z0-9._:-]*@[1-9][0-9]*$",
  "^urn:zintus-continuity:contracts:v1:[a-z]+$",
]);
const contentBearingPropertyPattern =
  /(?:content|cookie|credential|embedding|modeloutput|payload|plaintext|prompt|providermessage|secret|token|vector)/u;
const safeOpaqueContentReferences = new Set([
  "argumentbodyref",
  "contentref",
  "erasablebodyref",
  "inputref",
  "outputref",
  "payloadref",
]);

function record(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentBearing(name: string): boolean {
  const normalized = name.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
  if (
    [
      "credentialselectorid",
      "credentialselectoridandrevision",
      "credentialselectorrevision",
    ].includes(normalized) ||
    normalized === "embeddingspaceid" ||
    (normalized.startsWith("embedding") &&
      (normalized.endsWith("revision") ||
        normalized.endsWith("version") ||
        normalized.endsWith("versions"))) ||
    (normalized.includes("embedding") && normalized.endsWith("versions"))
  )
    return false;
  return (
    !safeOpaqueContentReferences.has(normalized) && contentBearingPropertyPattern.test(normalized)
  );
}

function assertPlain(
  value: unknown,
  location: string,
  budget = { remaining: 8192 },
  active = new WeakSet<object>(),
  depth = 0,
): void {
  if (depth > 64 || budget.remaining-- <= 0) throw new Error(`${location} exceeds JSON budget`);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value))
  )
    return;
  if (typeof value !== "object" || active.has(value))
    throw new Error(`${location} is not finite acyclic JSON`);
  active.add(value);
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error(`${location} exceeds structural array length cap`);
    const expectedNames = Array.from({ length: value.length }, (_, index) => String(index)).concat(
      "length",
    );
    const names = ownDataPropertyNames(value);
    if (
      Object.getPrototypeOf(value) !== plainArrayPrototype ||
      !ownDataHasNoSymbols(value) ||
      JSON.stringify(names) !== JSON.stringify(expectedNames)
    )
      throw new Error(`${location} is not a dense plain JSON array`);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = readOwnDataDescriptor(value, String(index));
      if (!descriptor?.enumerable)
        throw new Error(`${location}/${index} is not a plain array data member`);
      assertPlain(descriptor.value, `${location}/${index}`, budget, active, depth + 1);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== plainObjectPrototype && prototype !== null) || !ownDataHasNoSymbols(value))
      throw new Error(`${location} is not a plain JSON object`);
    for (const name of ownDataPropertyNames(value)) {
      const descriptor = readOwnDataDescriptor(value, name);
      if (!descriptor?.enumerable)
        throw new Error(`${location}/${name} is not an enumerable data member`);
      assertPlain(descriptor.value, `${location}/${name}`, budget, active, depth + 1);
    }
  }
  active.delete(value);
}

function inspect(schema: Schema, location: string, references: string[], depth = 0): void {
  if (depth > 64) throw new Error(`${location} exceeds schema nesting budget`);
  if (depth > 0 && (schema.$id !== undefined || schema.$schema !== undefined))
    throw new Error(`${location} contains a nested schema identity`);
  if (ownDataKeys(schema).some((key) => !allowedKeywords.has(key)))
    throw new Error(`${location} uses unsupported dialect keyword`);
  for (const key of ["$id", "$ref", "$schema", "description", "format", "pattern", "title"]) {
    if (readOwnData(schema, key) !== undefined && typeof readOwnData(schema, key) !== "string")
      throw new Error(`${location} ${key} must be a string`);
  }
  if (schema.$ref !== undefined) {
    if (
      typeof schema.$ref !== "string" ||
      ownDataKeys(schema).length !== 1 ||
      !/^\.\/envelope\.schema\.json#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/u.test(schema.$ref)
    )
      throw new Error(`${location} reference is nonlocal or has siblings`);
    references.push(schema.$ref);
    return;
  }
  const branches = [schema.oneOf, schema.anyOf].filter(Array.isArray);
  if (
    branches.length > 1 ||
    (branches.length === 1 &&
      (schema.type !== undefined || schema.const !== undefined || schema.enum !== undefined))
  )
    throw new Error(`${location} mixes restricted schema branches`);
  if (Array.isArray(schema.oneOf) && (schema.oneOf.length < 2 || schema.oneOf.length > 8))
    throw new Error(`${location} oneOf branch count is invalid`);
  if (Array.isArray(schema.anyOf) && (schema.anyOf.length < 2 || schema.anyOf.length > 4))
    throw new Error(`${location} anyOf branch count is invalid`);
  for (const branch of branches.flat()) {
    if (!record(branch)) throw new Error(`${location} branch must be an object`);
    inspect(branch, `${location}/branch`, references, depth + 1);
  }
  if (schema.type !== undefined && !["array", "object", "string"].includes(String(schema.type)))
    throw new Error(`${location} type is unsupported`);
  if (
    schema.const !== undefined &&
    schema.const !== null &&
    typeof schema.const !== "string" &&
    typeof schema.const !== "boolean"
  )
    throw new Error(`${location} const is unsupported`);
  if (Array.isArray(schema.enum)) {
    if (
      schema.enum.length === 0 ||
      schema.enum.length > 64 ||
      new Set(schema.enum).size !== schema.enum.length ||
      schema.enum.some((value) => typeof value !== "string")
    )
      throw new Error(`${location} enum is not a closed unique string set`);
  } else if (schema.enum !== undefined) throw new Error(`${location} enum must be an array`);
  if (
    schema.const !== undefined &&
    Array.isArray(schema.enum) &&
    !schema.enum.includes(schema.const)
  )
    throw new Error(`${location} const contradicts enum`);
  if (
    schema.type !== undefined &&
    schema.const !== undefined &&
    !(
      (schema.type === "string" && typeof schema.const === "string") ||
      (schema.type === "object" && record(schema.const)) ||
      (schema.type === "array" && Array.isArray(schema.const))
    )
  )
    throw new Error(`${location} type contradicts const`);
  if (schema.type === "object") {
    if (
      schema.additionalProperties !== false ||
      !record(schema.properties) ||
      !Array.isArray(schema.required) ||
      ownDataKeys(schema.properties).length > 64 ||
      new Set(schema.required).size !== schema.required.length
    )
      throw new Error(`${location} object is not closed`);
    for (const name of schema.required) {
      if (typeof name !== "string" || !hasOwnDataProperty(schema.properties, name))
        throw new Error(`${location} required member is unknown`);
    }
    for (const [name, child] of ownDataEntries(schema.properties)) {
      if (dangerousKeys.has(name) || contentBearing(name) || !record(child))
        throw new Error(`${location}/${name} property is forbidden`);
      inspect(child, `${location}/properties/${name}`, references, depth + 1);
    }
  } else if (
    schema.properties !== undefined ||
    schema.required !== undefined ||
    schema.additionalProperties !== undefined
  )
    throw new Error(`${location} uses object keywords without object type`);
  if (schema.type === "array") {
    if (
      !record(schema.items) ||
      !Number.isSafeInteger(schema.minItems) ||
      !Number.isSafeInteger(schema.maxItems) ||
      Number(schema.minItems) < 0 ||
      Number(schema.minItems) > Number(schema.maxItems) ||
      Number(schema.maxItems) > 64 ||
      schema.uniqueItems !== true
    )
      throw new Error(`${location} array is unbounded or noncanonical`);
    inspect(schema.items, `${location}/items`, references, depth + 1);
  } else if (
    schema.items !== undefined ||
    schema.minItems !== undefined ||
    schema.maxItems !== undefined ||
    schema.uniqueItems !== undefined
  )
    throw new Error(`${location} uses array keywords without array type`);
  if (schema.type === "string") {
    if (
      !Number.isSafeInteger(schema.minLength) ||
      !Number.isSafeInteger(schema.maxLength) ||
      Number(schema.minLength) < 0 ||
      Number(schema.minLength) > Number(schema.maxLength) ||
      Number(schema.maxLength) > 1024 ||
      (schema.pattern !== undefined &&
        (typeof schema.pattern !== "string" || !reviewedLinearPatterns.has(schema.pattern))) ||
      (schema.format !== undefined && schema.format !== "date-time")
    )
      throw new Error(`${location} string assertions are incomplete`);
    const values = (typeof schema.const === "string" ? [schema.const] : []).concat(
      Array.isArray(schema.enum) ? schema.enum : [],
    );
    for (const value of values) {
      if (
        value.length < Number(schema.minLength) ||
        value.length > Number(schema.maxLength) ||
        (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) ||
        (schema.format === "date-time" &&
          (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value))
      )
        throw new Error(`${location} string value contradicts assertions`);
    }
  } else if (
    schema.minLength !== undefined ||
    schema.maxLength !== undefined ||
    schema.pattern !== undefined ||
    schema.format !== undefined
  )
    throw new Error(`${location} uses string keywords without string type`);
  if (schema.$defs !== undefined) {
    if (!record(schema.$defs)) throw new Error(`${location} definitions must be an object`);
    for (const [name, child] of ownDataEntries(schema.$defs)) {
      if (dangerousKeys.has(name) || !record(child))
        throw new Error(`${location}/${name} definition is forbidden`);
      inspect(child, `${location}/$defs/${name}`, references, depth + 1);
    }
  }
  if (
    branches.length === 0 &&
    schema.type === undefined &&
    schema.const === undefined &&
    schema.enum === undefined &&
    schema.$defs === undefined
  )
    throw new Error(`${location} has no implemented assertion`);
}

export function validateRestrictedSchema(schema: unknown): readonly string[] {
  assertPlain(schema, "schema");
  if (!record(schema)) throw new Error("schema must be an object");
  const references: string[] = [];
  inspect(schema, "schema", references);
  return references;
}

function rejectDefinitionCycles(envelope: Schema): void {
  if (!record(envelope.$defs)) throw new Error("envelope definitions are missing");
  const edges = new Map<string, readonly string[]>();
  for (const [name, definition] of ownDataEntries(envelope.$defs)) {
    const refs = validateRestrictedSchema(definition);
    edges.set(
      name,
      refs.map((ref) => ref.slice(ref.lastIndexOf("/") + 1)),
    );
  }
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (name: string): void => {
    if (active.has(name)) throw new Error(`cyclic schema definition reference at ${name}`);
    if (complete.has(name)) return;
    active.add(name);
    for (const next of edges.get(name) ?? []) visit(next);
    active.delete(name);
    complete.add(name);
  };
  for (const name of edges.keys()) visit(name);
}

export function validateRestrictedSchemaWithLocalRefs(schema: unknown, envelope: unknown): unknown {
  const references = validateRestrictedSchema(schema);
  validateRestrictedSchema(envelope);
  if (!record(envelope)) throw new Error("envelope must be an object");
  rejectDefinitionCycles(envelope);
  for (const reference of references) {
    const name = reference.slice(reference.lastIndexOf("/") + 1);
    if (!record(envelope.$defs) || !readOwnData(envelope.$defs, name))
      throw new Error(`unresolved reference ${reference}`);
  }
  return schema;
}
