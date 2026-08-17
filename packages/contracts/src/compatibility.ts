import {
  ownDataHasNoSymbols,
  ownDataKeys,
  ownDataPropertyNames,
  readOwnData,
  readOwnDataDescriptor,
} from "@zintus-continuity/foundation/safe-data-access";
import { contractSchemaCatalog, contractSemanticProfile } from "./generated/schema-catalog.js";
import { validateRestrictedSchemaWithLocalRefs } from "./restricted-schema.js";
import {
  canonicalSemanticProfileBytes,
  crossValidateExecutableSemantics,
} from "./semantic-profile.js";

export interface CompatibilityIssue {
  readonly path: string;
  readonly rule: string;
}

export interface CompatibilityResult {
  readonly compatible: boolean;
  readonly issues: readonly CompatibilityIssue[];
}

const dialect = "https://json-schema.org/draft/2020-12/schema";
const plainObjectPrototype = Object.getPrototypeOf({});
const schemaId =
  /^urn:zintus-continuity:contracts:v([1-9][0-9]*):(api|event|policy|provider|receipt|registry|task)$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === plainObjectPrototype || prototype === null) &&
    ownDataHasNoSymbols(value) &&
    ownDataPropertyNames(value).every(
      (key) => readOwnDataDescriptor(value, key)?.enumerable === true,
    )
  );
}

function canonical(value: unknown, omittedRootKey?: string): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Array.from(ownDataKeys(value))
      .filter((key) => key !== omittedRootKey)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(readOwnData(value, key))}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function identity(
  schema: Readonly<Record<string, unknown>>,
): { readonly version: bigint; readonly family: string } | undefined {
  if (schema.$schema !== dialect || typeof schema.$id !== "string") return undefined;
  const match = schemaId.exec(schema.$id);
  if (!match || !match[1] || !match[2] || match[1].length > 20) return undefined;
  const version = BigInt(match[1]);
  if (version > 18_446_744_073_709_551_615n) return undefined;
  return { version, family: match[2] };
}

function validSchema(schema: unknown): schema is Readonly<Record<string, unknown>> {
  if (!isRecord(schema)) return false;
  try {
    validateRestrictedSchemaWithLocalRefs(schema, contractSchemaCatalog["envelope.schema.json"]);
    return true;
  } catch {
    return false;
  }
}

function validSemantics(profile: unknown): boolean {
  try {
    crossValidateExecutableSemantics(contractSchemaCatalog, profile);
    return (
      canonicalSemanticProfileBytes(profile) ===
      canonicalSemanticProfileBytes(contractSemanticProfile)
    );
  } catch {
    return false;
  }
}

/** Same-ID schemas and their executable semantic profiles are immutable. */
export function checkSameVersionCompatibility(
  previous: unknown,
  candidate: unknown,
  previousSemantics: unknown,
  candidateSemantics: unknown,
): CompatibilityResult {
  if (!validSchema(previous) || !validSchema(candidate)) {
    return { compatible: false, issues: [{ path: "$", rule: "schema:restricted-validation" }] };
  }
  const issues: CompatibilityIssue[] = [];
  if (!validSemantics(previousSemantics) || !validSemantics(candidateSemantics)) {
    issues.push({ path: "$semanticProfile", rule: "changed:semantic-profile" });
  }
  if (previous.$id !== candidate.$id) issues.push({ path: "$", rule: "changed:$id" });
  if (canonical(previous) !== canonical(candidate)) {
    issues.push({ path: "$", rule: "changed:same-version-schema" });
  }
  return { compatible: issues.length === 0, issues };
}

/**
 * Directional v1 compatibility is deliberately conservative. The candidate
 * must be the immediately successive ID of the same family, while every other
 * schema assertion and the complete executable semantic profile remain exact.
 */
export function checkOldProducerToNewConsumerCompatibility(
  previous: unknown,
  candidate: unknown,
  previousSemantics: unknown,
  candidateSemantics: unknown,
): CompatibilityResult {
  if (!validSchema(previous) || !validSchema(candidate)) {
    return { compatible: false, issues: [{ path: "$", rule: "schema:restricted-validation" }] };
  }
  const issues: CompatibilityIssue[] = [];
  if (!validSemantics(previousSemantics) || !validSemantics(candidateSemantics)) {
    issues.push({ path: "$semanticProfile", rule: "changed:semantic-profile" });
  }
  const oldIdentity = identity(previous);
  const newIdentity = identity(candidate);
  if (!oldIdentity || !newIdentity) {
    issues.push({ path: "$", rule: "schema:id-or-dialect-unsupported" });
  } else {
    if (oldIdentity.family !== newIdentity.family) {
      issues.push({ path: "$", rule: "schema:family-mismatch" });
    }
    if (newIdentity.version !== oldIdentity.version + 1n) {
      issues.push({ path: "$", rule: "schema:next-version-required" });
    }
  }
  if (canonical(previous, "$id") !== canonical(candidate, "$id")) {
    issues.push({ path: "$", rule: "schema:structural-change-forbidden" });
  }
  return { compatible: issues.length === 0, issues };
}
