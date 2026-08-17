import {
  hasOwnDataProperty,
  ownDataEntries,
  ownDataHasNoSymbols,
  ownDataKeys,
  ownDataPropertyNames,
  readOwnData,
  readOwnDataDescriptor,
} from "@zintus-continuity/foundation/safe-data-access";
import {
  type ContractSchemaName,
  contractSchemaCatalog,
  contractSemanticProfile,
} from "./generated/schema-catalog.js";
import { initializeSemanticProfile } from "./semantic-profile.js";

type JsonSchema = Readonly<Record<string, unknown>>;
const semanticProfile = initializeSemanticProfile(contractSchemaCatalog, contractSemanticProfile);
const maximumFailures = 64;
const maximumJsonBytes = 65_536;
const maximumValidationNodes = 4096;
const plainObjectPrototype = Object.getPrototypeOf({});

export interface ContractValidationFailure {
  readonly path: string;
  readonly rule: string;
}

export type ContractValidationResult =
  | { readonly valid: true; readonly failures: readonly [] }
  | { readonly valid: false; readonly failures: readonly ContractValidationFailure[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === plainObjectPrototype || prototype === null;
}

function hasCyclicOrOverdeepValue(root: unknown): boolean {
  if (typeof root !== "object" || root === null) return false;
  const active = new WeakSet<object>();
  const stack: Array<{ readonly value: object; readonly depth: number; readonly exit: boolean }> = [
    { value: root, depth: 0, exit: false },
  ];
  let visited = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.exit) {
      active.delete(frame.value);
      continue;
    }
    if (frame.depth > 128 || visited++ > maximumValidationNodes) return true;
    if (active.has(frame.value)) return true;
    active.add(frame.value);
    stack.push({ value: frame.value, depth: frame.depth, exit: true });
    const names = Array.isArray(frame.value)
      ? Array.from({ length: Math.min(frame.value.length, 64) }, (_, index) => String(index))
      : ownDataPropertyNames(frame.value).slice(0, 64);
    for (const name of names) {
      let descriptor: Readonly<{ enumerable: boolean; value: unknown }> | undefined;
      try {
        descriptor = readOwnDataDescriptor(frame.value, name);
      } catch {
        continue;
      }
      if (!descriptor) continue;
      const child = descriptor.value;
      if (typeof child === "object" && child !== null) {
        stack.push({ value: child, depth: frame.depth + 1, exit: false });
      }
    }
  }
  return false;
}

function addFailure(failures: ContractValidationFailure[], path: string, rule: string): void {
  if (failures.length < maximumFailures) {
    failures.push({ path: path.slice(0, 512), rule });
  }
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Array.from(ownDataKeys(value))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(readOwnData(value, key))}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function interpretReceiptSelector(
  selector: string,
  receipt: Readonly<Record<string, unknown>>,
  versionTuple: Readonly<Record<string, unknown>>,
): unknown {
  const provider = versionTuple.provider_model_version;
  if (selector === "source_evidence.id_revision_pairs") {
    return {
      source_revisions: Array.isArray(receipt.source_refs)
        ? receipt.source_refs
            .filter(isRecord)
            .map((entry) => ({ source_id: entry.source_id, revision: entry.source_revision }))
            .sort((left, right) => canonicalValue(left).localeCompare(canonicalValue(right)))
        : [],
      evidence_revisions: Array.isArray(receipt.evidence_refs)
        ? receipt.evidence_refs
            .filter(isRecord)
            .map((entry) => ({
              evidence_id: entry.evidence_id,
              revision: entry.evidence_revision,
            }))
            .sort((left, right) => canonicalValue(left).localeCompare(canonicalValue(right)))
        : [],
    };
  }
  if (!isRecord(provider)) return undefined;
  if (selector === "provider_model_version.provider_revision") return provider.provider_revision;
  if (selector === "provider_model_version.destination_revision")
    return provider.destination_revision;
  if (selector === "provider_model_version.credential_selector_id+credential_selector_revision") {
    return {
      selector_id: provider.credential_selector_id,
      selector_revision: provider.credential_selector_revision,
    };
  }
  if (
    selector === "provider_model_version.effect_reservation_applicability+effect_reservation_id"
  ) {
    return {
      applicability: provider.effect_reservation_applicability,
      reservation_id: provider.effect_reservation_id,
    };
  }
  throw new Error(`unknown receipt selector ${selector}`);
}

function resolveReference(reference: string): JsonSchema | undefined {
  const [filename, fragment] = reference.split("#");
  if (!filename || !fragment?.startsWith("/$defs/")) return undefined;
  const catalogName = filename.startsWith("./") ? filename.slice(2) : filename;
  const source: unknown = readOwnData(contractSchemaCatalog, catalogName as ContractSchemaName);
  if (!isRecord(source)) return undefined;
  const definitions = source.$defs;
  if (!isRecord(definitions)) return undefined;
  const definition = fragment.slice("/$defs/".length);
  const resolved = readOwnData(definitions, definition);
  return isRecord(resolved) ? resolved : undefined;
}

function inspect(
  schema: JsonSchema,
  value: unknown,
  path: string,
  failures: ContractValidationFailure[],
  budget: { remaining: number },
): void {
  if (failures.length >= maximumFailures) return;
  if (budget.remaining <= 0) {
    addFailure(failures, path, "budget:nodes");
    return;
  }
  budget.remaining -= 1;
  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      if (!isRecord(branch)) continue;
      const branchFailures: ContractValidationFailure[] = [];
      const allocated = Math.min(
        512,
        Math.max(1, Math.floor(budget.remaining / schema.oneOf.length)),
      );
      const branchBudget = { remaining: allocated };
      inspect(branch, value, path, branchFailures, branchBudget);
      budget.remaining -= allocated - branchBudget.remaining;
      if (branchFailures.length === 0) matches += 1;
    }
    if (matches !== 1) addFailure(failures, path, "oneOf");
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf;
    const matched = branches.some((branch) => {
      if (!isRecord(branch)) return false;
      const branchFailures: ContractValidationFailure[] = [];
      const allocated = Math.min(512, Math.max(1, Math.floor(budget.remaining / branches.length)));
      const branchBudget = { remaining: allocated };
      inspect(branch, value, path, branchFailures, branchBudget);
      budget.remaining -= allocated - branchBudget.remaining;
      return branchFailures.length === 0;
    });
    if (!matched) addFailure(failures, path, "anyOf");
    return;
  }
  if (typeof schema.$ref === "string") {
    if (
      typeof value === "string" &&
      /^(0|[1-9][0-9]*)$/u.test(value) &&
      schema.$ref.endsWith("/uint64") &&
      BigInt(value) > 18_446_744_073_709_551_615n
    ) {
      addFailure(failures, path, "range:uint64");
      return;
    }
    if (
      typeof value === "string" &&
      /^[1-9][0-9]*$/u.test(value) &&
      schema.$ref.endsWith("/positiveUint64") &&
      BigInt(value) > 18_446_744_073_709_551_615n
    ) {
      addFailure(failures, path, "range:uint64");
      return;
    }
    if (
      typeof value === "string" &&
      /^(0|-?[1-9][0-9]*)$/u.test(value) &&
      schema.$ref.endsWith("/int64") &&
      (BigInt(value) < -9_223_372_036_854_775_808n || BigInt(value) > 9_223_372_036_854_775_807n)
    ) {
      addFailure(failures, path, "range:int64");
      return;
    }
    const resolved = resolveReference(schema.$ref);
    if (!resolved) {
      addFailure(failures, path, "unresolved-ref");
      return;
    }
    inspect(resolved, value, path, failures, budget);
    return;
  }

  if ("const" in schema && value !== schema.const) {
    addFailure(failures, path, "const");
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    addFailure(failures, path, "enum");
    return;
  }

  if (schema.type === "object") {
    if (!isRecord(value)) {
      addFailure(failures, path, "type:object");
      return;
    }
    let unsafeOwnProperty = false;
    if (!ownDataHasNoSymbols(value)) {
      addFailure(failures, path, "property:symbol");
      unsafeOwnProperty = true;
    }
    for (const key of ownDataPropertyNames(value)) {
      const descriptor = readOwnDataDescriptor(value, key);
      if (descriptor?.enumerable !== true) {
        addFailure(failures, `${path}/${key}`, "property:non-enumerable");
        unsafeOwnProperty = true;
      }
      if (!descriptor) {
        addFailure(failures, `${path}/${key}`, "property:accessor");
        unsafeOwnProperty = true;
      }
    }
    if (unsafeOwnProperty) return;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === "string" && !hasOwnDataProperty(value, key)) {
        addFailure(failures, `${path}/${key}`, "required");
      }
    }
    const entries = ownDataEntries(value);
    if (entries.length > 64) addFailure(failures, path, "maxProperties");
    for (const [key, child] of entries.slice(0, 64)) {
      const childSchema = readOwnData(properties, key);
      if (!isRecord(childSchema)) {
        if (schema.additionalProperties === false) {
          addFailure(failures, `${path}/${key}`, "additionalProperties");
        }
        continue;
      }
      inspect(childSchema, child, `${path}/${key}`, failures, budget);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      addFailure(failures, path, "type:array");
      return;
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      addFailure(failures, path, "minItems");
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      addFailure(failures, path, "maxItems");
      return;
    }
    if (!ownDataHasNoSymbols(value)) {
      addFailure(failures, path, "array:symbol");
      return;
    }
    if (
      ownDataPropertyNames(value).some(
        (name) => name !== "length" && !/^(0|[1-9][0-9]*)$/u.test(name),
      )
    ) {
      addFailure(failures, path, "array:extra-property");
      return;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = readOwnDataDescriptor(value, String(index));
      if (!descriptor || descriptor.enumerable !== true) {
        addFailure(failures, `${path}/${index}`, "array:non-json-index");
        return;
      }
    }
    if (
      schema.uniqueItems === true &&
      new Set(value.map((entry) => canonicalValue(entry))).size !== value.length
    ) {
      addFailure(failures, path, "uniqueItems");
    }
    if (isRecord(schema.items)) {
      value.slice(0, 64).forEach((entry, index) => {
        inspect(schema.items as JsonSchema, entry, `${path}/${index}`, failures, budget);
      });
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      addFailure(failures, path, "type:string");
      return;
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      addFailure(failures, path, "minLength");
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      addFailure(failures, path, "maxLength");
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      addFailure(failures, path, "pattern");
    }
    if (
      schema.format === "date-time" &&
      (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    ) {
      addFailure(failures, path, "format:date-time");
    }
    return;
  }

  if (
    schema.type !== "object" &&
    schema.type !== "array" &&
    schema.type !== "string" &&
    !("const" in schema) &&
    !Array.isArray(schema.enum)
  ) {
    addFailure(failures, path, "schema:unsupported");
  }
}

function isSortedUnique(values: readonly unknown[]): boolean {
  return values.every((value, index) => {
    if (typeof value !== "string") return false;
    if (index === 0) return true;
    const previous = values.at(index - 1);
    return typeof previous === "string" && previous < value;
  });
}

function isCanonicallySortedUnique(values: readonly unknown[]): boolean {
  const canonical = values.map(canonicalValue);
  return canonical.every((value, index) => {
    if (index === 0) return true;
    const previous = canonical.at(index - 1);
    return typeof previous === "string" && previous < value;
  });
}

function inspectRegistrySemantics(
  value: Record<string, unknown>,
  failures: ContractValidationFailure[],
): void {
  if (!Array.isArray(value.schemas)) return;
  const expected = semanticProfile.families.registry.schemas as Readonly<Record<string, string>>;
  const seen = new Set<string>();
  for (const entry of value.schemas) {
    if (!isRecord(entry) || typeof entry.family !== "string") continue;
    if (seen.has(entry.family) || readOwnData(expected, entry.family) !== entry.schemaId) {
      addFailure(failures, "$/schemas", "registry:family-schema-bijection");
    }
    seen.add(entry.family);
  }
  if (seen.size !== ownDataKeys(expected).length) {
    addFailure(failures, "$/schemas", "registry:family-schema-bijection");
  }
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function isCanonicalBase64Url(value: string, expectedBytes: number): boolean {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const digit = base64UrlAlphabet.indexOf(character);
    if (digit < 0) return false;
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && accumulator !== 0) return false;
  if (bytes.length !== expectedBytes) return false;
  let encoded = "";
  bits = 0;
  accumulator = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      encoded += base64UrlAlphabet.at((accumulator >> bits) & 0x3f) ?? "";
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) encoded += base64UrlAlphabet.at((accumulator << (6 - bits)) & 0x3f) ?? "";
  return encoded === value;
}

function isCanonicalSha256Display(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function inspectContractSemantics(
  schemaName: Exclude<ContractSchemaName, "envelope.schema.json">,
  value: Record<string, unknown>,
  failures: ContractValidationFailure[],
): void {
  if (schemaName === "api.schema.json" && value.variant === "server_response") {
    const table = semanticProfile.families.api.server_response as Readonly<
      Record<string, readonly string[]>
    >;
    const expected = readOwnData<readonly string[]>(table, String(value.outcome));
    if (!expected || value.errorCode !== expected[0]) {
      addFailure(failures, "$/errorCode", "api:outcome-error-applicability");
    }
    const contentRequired = expected?.[1] === "content_required";
    if (contentRequired !== (typeof value.contentRef === "string")) {
      addFailure(failures, "$/contentRef", "api:content-applicability");
    }
  }

  if (schemaName === "policy.schema.json") {
    const profile = semanticProfile.families.policy as Readonly<
      Record<string, Readonly<Record<string, readonly string[]>>>
    >;
    const stageProfile = readOwnData(profile, String(value.stage));
    const allowed = stageProfile
      ? readOwnData<readonly string[]>(stageProfile, String(value.decision))
      : undefined;
    const codes = Array.isArray(value.reasonCodes) ? value.reasonCodes : [];
    const coherent =
      Array.isArray(allowed) &&
      codes.length > 0 &&
      codes.every((code) => typeof code === "string" && allowed.includes(code)) &&
      (value.decision !== "allow" || canonicalValue(codes) === canonicalValue(allowed));
    if (!coherent) addFailure(failures, "$/reasonCodes", "policy:decision-code-applicability");
  }

  if (schemaName === "provider.schema.json") {
    const profile = semanticProfile.families.provider as Readonly<
      Record<string, Readonly<Record<string, readonly string[]>>>
    >;
    const hasInput = typeof value.inputRef === "string";
    const hasOutput = typeof value.outputRef === "string";
    if (value.variant === "denied") {
      const allowed =
        profile.denied == null
          ? undefined
          : readOwnData<readonly string[]>(profile.denied, String(value.outcome));
      if (
        value.decision !== "deny" ||
        !allowed?.includes(String(value.errorCode)) ||
        hasInput ||
        hasOutput
      ) {
        addFailure(failures, "$", "provider:denial-applicability");
      }
    } else if (value.variant === "result") {
      const expected =
        profile.result == null
          ? undefined
          : readOwnData<readonly string[]>(profile.result, String(value.outcome));
      const inputRequired = expected?.[1] === "input_required";
      const outputRequired = expected?.[2] === "output_required";
      if (
        value.decision !== "invoke" ||
        !expected ||
        value.errorCode !== expected[0] ||
        hasInput !== inputRequired ||
        hasOutput !== outputRequired
      ) {
        addFailure(failures, "$", "provider:result-applicability");
      }
    }
  }

  if (schemaName === "task.schema.json") {
    if (value.messageKind === "command") {
      for (const field of ["state", "outcome", "updatedAt", "checkpointRef", "errorCode"]) {
        if (hasOwnDataProperty(value, field))
          addFailure(failures, `$/${field}`, "task:command-status-separation");
      }
    } else if (value.messageKind === "status") {
      const table = semanticProfile.families.task.status as Readonly<
        Record<string, readonly string[]>
      >;
      const tuple = readOwnData<readonly string[]>(table, String(value.state));
      if (!tuple || value.outcome !== tuple[0] || value.errorCode !== tuple[1]) {
        addFailure(failures, "$", "task:state-outcome-error-applicability");
      }
      const checkpointRequired = tuple?.[2] === "checkpoint_required";
      if (checkpointRequired !== (typeof value.checkpointRef === "string")) {
        addFailure(failures, "$/checkpointRef", "task:checkpoint-applicability");
      }
    }
  }
}

function inspectReceiptSemantics(
  value: Record<string, unknown>,
  failures: ContractValidationFailure[],
): void {
  const receipt = value.logicalReceipt;
  const signature = value.signatureEnvelope;
  if (!isRecord(receipt) || !isRecord(signature)) return;
  const receiptSemantics = semanticProfile.families.receipt;
  const receiptTuple = [
    receipt.receipt_type,
    receipt.semantic_class,
    receipt.decision_code,
    receipt.outcome_code,
    receipt.receipt_state,
  ];
  const typeRules = receiptSemantics.allowedReceiptTuples.filter(
    (tuple: readonly unknown[]) =>
      canonicalValue(tuple.slice(0, 5)) === canonicalValue(receiptTuple),
  );
  const typeRule = typeRules[0];
  if (typeRules.length !== 1) {
    addFailure(failures, "$/logicalReceipt", "receipt:type-applicability");
  }
  const equalBindings = [
    ["tenantId", "tenant_id"],
    ["serverPurpose", "purpose_id"],
    ["operationId", "operation_id"],
    ["attemptId", "attempt_id"],
  ] as const;
  for (const [wrapper, logical] of equalBindings) {
    if (readOwnData(value, wrapper) !== readOwnData(receipt, logical))
      addFailure(failures, `$/logicalReceipt/${logical}`, "binding:mismatch");
  }
  for (const key of ["receipt_id", "signature_suite", "signing_key_id"] as const) {
    if (canonicalValue(readOwnData(receipt, key)) !== canonicalValue(readOwnData(signature, key)))
      addFailure(failures, `$/signatureEnvelope/${key}`, "binding:mismatch");
  }
  const sequence = receipt.sequence;
  if (sequence === "1") {
    if (
      receipt.predecessor_receipt_id !== null ||
      receipt.predecessor_signature_commitment !== null
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/predecessor_receipt_id",
        "genesis:predecessor-forbidden",
      );
    }
  } else if (
    typeof sequence === "string" &&
    (receipt.predecessor_receipt_id === null || receipt.predecessor_signature_commitment === null)
  ) {
    addFailure(
      failures,
      "$/logicalReceipt/predecessor_receipt_id",
      "sequence:predecessor-required",
    );
  }
  if ((receipt.origin_mode === "system_originated") !== (receipt.principal_id === null)) {
    addFailure(failures, "$/logicalReceipt/principal_id", "origin:principal-mismatch");
  }
  if (receipt.attempt_id === null && receipt.attempt_ordinal !== "0") {
    addFailure(failures, "$/logicalReceipt/attempt_ordinal", "attempt:ordinal-mismatch");
  }
  for (const key of ["limitation_codes", "supersedes_receipt_ids"] as const) {
    const entries = readOwnData(receipt, key);
    if (Array.isArray(entries) && !isSortedUnique(entries)) {
      addFailure(failures, `$/logicalReceipt/${key}`, "canonical:sorted-unique");
    }
  }
  for (const key of ["source_refs", "evidence_refs", "scope_commitments"] as const) {
    const entries = readOwnData(receipt, key);
    if (Array.isArray(entries) && !isCanonicallySortedUnique(entries)) {
      addFailure(failures, `$/logicalReceipt/${key}`, "canonical:sorted-unique");
    }
  }
  const versionTuple = receipt.version_tuple;
  if (isRecord(versionTuple)) {
    if (isRecord(versionTuple.operation_version) && typeof receipt.operation_type === "string") {
      const separator = receipt.operation_type.lastIndexOf("@");
      const operationType = receipt.operation_type.slice(0, separator);
      const operationRevision = receipt.operation_type.slice(separator + 1);
      if (
        separator <= 0 ||
        operationType !== versionTuple.operation_version.operation_type ||
        operationRevision !== versionTuple.operation_version.operation_revision
      ) {
        addFailure(
          failures,
          "$/logicalReceipt/operation_type",
          "operation:version-binding-mismatch",
        );
      }
    }
    const attemptVersion = versionTuple.attempt_version;
    const stageVersion = versionTuple.attempt_stage_version;
    if (isRecord(attemptVersion) && isRecord(stageVersion)) {
      for (const [top, nested] of [
        ["attempt_id", "attempt_id"],
        ["attempt_ordinal", "attempt_ordinal"],
        ["idempotency_id", "idempotency_id"],
      ] as const) {
        if (readOwnData(receipt, top) !== readOwnData(attemptVersion, nested)) {
          addFailure(
            failures,
            `$/logicalReceipt/version_tuple/attempt_version/${nested}`,
            "attempt:binding-mismatch",
          );
        }
      }
      const stage = stageVersion.stage_discriminator;
      const hasAttempt = typeof attemptVersion.attempt_id === "string";
      const ordinal = attemptVersion.attempt_ordinal;
      const claim = attemptVersion.claim_fence;
      const lease = attemptVersion.lease_generation;
      const effect = attemptVersion.effect_fence;
      const validStage =
        (stage === "AS0_LOCAL_PREATTEMPT_NO_CLAIM" &&
          !hasAttempt &&
          ordinal === "0" &&
          claim === null &&
          lease === null &&
          effect === null) ||
        (stage === "AS1_PREALLOCATED_NOT_CLAIMED" &&
          hasAttempt &&
          ordinal === "0" &&
          claim === null &&
          lease === null &&
          effect === null) ||
        (stage === "AS2_CLAIMED_NO_LEASE" &&
          hasAttempt &&
          ordinal !== "0" &&
          typeof claim === "string" &&
          lease === null &&
          effect === null) ||
        (stage === "AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT" &&
          hasAttempt &&
          ordinal !== "0" &&
          typeof claim === "string" &&
          typeof lease === "string" &&
          effect === null) ||
        (stage === "AS4_LEASE_BOUND_EFFECT_ALLOCATED" &&
          hasAttempt &&
          ordinal !== "0" &&
          typeof claim === "string" &&
          typeof lease === "string" &&
          typeof effect === "string");
      if (!validStage) {
        addFailure(
          failures,
          "$/logicalReceipt/version_tuple/attempt_version",
          "attempt:stage-applicability",
        );
      }
      const idempotencyValid =
        (stageVersion.idempotency_mode === "IDEMPOTENCY_REQUIRED" &&
          typeof attemptVersion.idempotency_id === "string") ||
        (stageVersion.idempotency_mode === "IDEMPOTENCY_SCHEMA_INAPPLICABLE" &&
          attemptVersion.idempotency_id === null);
      if (!idempotencyValid) {
        addFailure(
          failures,
          "$/logicalReceipt/version_tuple/attempt_version/idempotency_id",
          "attempt:idempotency-applicability",
        );
      }
    }
    if (
      isRecord(versionTuple.request_version) &&
      versionTuple.request_version.request_id !== receipt.request_id
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/request_version/request_id",
        "request:binding-mismatch",
      );
    }
    for (const [nested, top] of [
      ["tenant_scope", "tenant_id"],
      ["purpose_scope", "purpose_id"],
      ["chain_version", "chain_id"],
    ] as const) {
      const binding = readOwnData(versionTuple, nested);
      if (isRecord(binding) && readOwnData(binding, top) !== readOwnData(receipt, top)) {
        addFailure(
          failures,
          `$/logicalReceipt/version_tuple/${nested}/${top}`,
          "version:binding-mismatch",
        );
      }
    }
    if (
      isRecord(versionTuple.receipt_format_version) &&
      versionTuple.receipt_format_version.logical_schema !== receipt.receipt_schema
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/receipt_format_version",
        "version:binding-mismatch",
      );
    }
    if (
      isRecord(versionTuple.environment_version) &&
      (versionTuple.environment_version.architecture_profile_id !== receipt.profile_id ||
        versionTuple.environment_version.environment_id !== receipt.environment_id)
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/environment_version",
        "version:binding-mismatch",
      );
    }
    if (
      isRecord(versionTuple.operation_version) &&
      (versionTuple.operation_version.operation_type !==
        String(receipt.operation_type).split("@")[0] ||
        versionTuple.operation_version.lane_id !== receipt.lane_id)
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/operation_version",
        "version:binding-mismatch",
      );
    }
    if (
      isRecord(versionTuple.lifecycle_version) &&
      isRecord(receipt.lifecycle_binding) &&
      (versionTuple.lifecycle_version.deletion_epoch !== receipt.lifecycle_binding.deletion_epoch ||
        versionTuple.lifecycle_version.revision_epoch !==
          receipt.lifecycle_binding.revision_epoch ||
        versionTuple.lifecycle_version.lifecycle_fence !==
          receipt.lifecycle_binding.lifecycle_fence ||
        versionTuple.lifecycle_version.hold_disposition_revision !==
          receipt.lifecycle_binding.hold_disposition_revision ||
        versionTuple.lifecycle_version.body_availability !==
          receipt.lifecycle_binding.body_availability)
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/lifecycle_version",
        "version:binding-mismatch",
      );
    }
    if (isRecord(versionTuple.algorithm_version)) {
      if (versionTuple.algorithm_version.signature_suite !== receipt.signature_suite) {
        addFailure(
          failures,
          "$/logicalReceipt/version_tuple/algorithm_version/signature_suite",
          "version:binding-mismatch",
        );
      }
    }
    if (
      isRecord(versionTuple.key_version) &&
      isRecord(receipt.signing_key_id) &&
      (versionTuple.key_version.issuer_id !== receipt.issuer_id ||
        versionTuple.key_version.signing_key_id !== receipt.signing_key_id.key_id ||
        versionTuple.key_version.signing_key_revision !== receipt.signing_key_id.key_revision)
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/key_version",
        "version:binding-mismatch",
      );
    }
    if (
      isRecord(versionTuple.key_governance_version) &&
      versionTuple.key_governance_version.signing_key_owner_id !== receipt.signing_key_owner_id
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/key_governance_version",
        "version:binding-mismatch",
      );
    }
    if (isRecord(versionTuple.intent_approval_version)) {
      const intentVersion = versionTuple.intent_approval_version;
      if (isRecord(receipt.tool_intent_binding)) {
        if (
          intentVersion.tool_intent_id !== receipt.tool_intent_binding.intent_id ||
          intentVersion.tool_intent_revision !== receipt.tool_intent_binding.intent_revision
        ) {
          addFailure(
            failures,
            "$/logicalReceipt/version_tuple/intent_approval_version",
            "version:binding-mismatch",
          );
        }
      } else if (
        intentVersion.tool_intent_id !== null ||
        intentVersion.tool_intent_revision !== null
      ) {
        addFailure(
          failures,
          "$/logicalReceipt/version_tuple/intent_approval_version",
          "version:binding-mismatch",
        );
      }
      if (
        isRecord(receipt.approval_binding) &&
        (("required" in receipt.approval_binding &&
          (intentVersion.approval_fact_id !== receipt.approval_binding.approval_decision_id ||
            intentVersion.approval_fact_revision !== receipt.approval_binding.approval_revision)) ||
          ("not_required" in receipt.approval_binding &&
            (intentVersion.approval_fact_id !==
              receipt.approval_binding.no_approval_required_fact_id ||
              intentVersion.approval_fact_revision !== receipt.approval_binding.fact_revision)))
      ) {
        addFailure(
          failures,
          "$/logicalReceipt/version_tuple/intent_approval_version",
          "version:binding-mismatch",
        );
      }
    }
    if (Array.isArray(receipt.source_refs) && Array.isArray(versionTuple.source_versions)) {
      const logicalSources = receipt.source_refs
        .filter(isRecord)
        .map((source) => ({
          source_type: source.source_type,
          source_id: source.source_id,
          revision: source.source_revision,
        }))
        .sort((left, right) => canonicalValue(left).localeCompare(canonicalValue(right)));
      const versionSources = versionTuple.source_versions
        .filter(isRecord)
        .map((source) => ({
          source_type: source.source_type,
          source_id: source.source_id,
          revision: source.revision_id,
        }))
        .sort((left, right) => canonicalValue(left).localeCompare(canonicalValue(right)));
      if (
        canonicalValue(logicalSources) !== canonicalValue(versionSources) ||
        new Set(versionSources.map(canonicalValue)).size !== versionSources.length
      ) {
        addFailure(failures, "$/logicalReceipt/source_refs", "source:version-binding-mismatch");
      }
    }
    if (Array.isArray(receipt.evidence_refs) && Array.isArray(versionTuple.evidence_versions)) {
      const logicalEvidence = receipt.evidence_refs
        .filter(isRecord)
        .map((evidence) => ({
          evidence_type: evidence.evidence_type,
          evidence_id: evidence.evidence_id,
          revision: evidence.evidence_revision,
        }))
        .sort((left, right) => canonicalValue(left).localeCompare(canonicalValue(right)));
      const versionEvidence = versionTuple.evidence_versions
        .filter(isRecord)
        .map((evidence) => ({
          evidence_type: evidence.evidence_type,
          evidence_id: evidence.evidence_id,
          revision: evidence.evidence_revision,
        }))
        .sort((left, right) => canonicalValue(left).localeCompare(canonicalValue(right)));
      if (
        canonicalValue(logicalEvidence) !== canonicalValue(versionEvidence) ||
        new Set(versionEvidence.map(canonicalValue)).size !== versionEvidence.length
      ) {
        addFailure(failures, "$/logicalReceipt/evidence_refs", "evidence:version-binding-mismatch");
      }
    }
    if (isRecord(versionTuple.operation_version)) {
      const isTool = versionTuple.operation_version.operation_type === "managed_mcp_read";
      if (isTool !== (receipt.tool_intent_binding !== null)) {
        addFailure(failures, "$/logicalReceipt/tool_intent_binding", "tool:applicability");
      }
    }
    if (
      Array.isArray(versionTuple.evidence_versions) &&
      versionTuple.evidence_versions.length === 0 &&
      (receipt.decision_code !== "DENY" ||
        !Array.isArray(receipt.limitation_codes) ||
        !receipt.limitation_codes.includes("NO_EVIDENCE_ADMITTED"))
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/evidence_versions",
        "evidence:applicability",
      );
    }
    if (
      Array.isArray(versionTuple.active_memory_version) &&
      canonicalValue(versionTuple.active_memory_version) !==
        canonicalValue(receipt.active_memory_revisions)
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/version_tuple/active_memory_version",
        "memory:binding-mismatch",
      );
    }
  }
  for (const key of [
    "object_versions",
    "source_versions",
    "evidence_versions",
    "schema_versions",
    "policy_versions",
    "active_memory_version",
  ] as const) {
    const entries = isRecord(versionTuple) ? readOwnData(versionTuple, key) : undefined;
    if (Array.isArray(entries) && !isCanonicallySortedUnique(entries)) {
      addFailure(failures, `$/logicalReceipt/version_tuple/${key}`, "canonical:sorted-unique");
    }
  }
  if (Array.isArray(receipt.active_memory_revisions)) {
    if (!isCanonicallySortedUnique(receipt.active_memory_revisions)) {
      addFailure(failures, "$/logicalReceipt/active_memory_revisions", "canonical:sorted-unique");
    }
    for (const [index, memory] of receipt.active_memory_revisions.entries()) {
      if (
        isRecord(memory) &&
        Array.isArray(memory.source_revision_ids) &&
        !isSortedUnique(memory.source_revision_ids)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/active_memory_revisions/${index}/source_revision_ids`,
          "canonical:sorted-unique",
        );
      }
    }
  }
  if (
    receipt.dispatched_external_tuple !== null &&
    canonicalValue(receipt.dispatched_external_tuple) !==
      canonicalValue(receipt.authorized_external_tuple)
  ) {
    addFailure(
      failures,
      "$/logicalReceipt/dispatched_external_tuple",
      "dispatch:authorization-mismatch",
    );
  }
  const attemptStage = isRecord(receipt.version_tuple)
    ? receipt.version_tuple.attempt_stage_version
    : undefined;
  const stage = isRecord(attemptStage) ? attemptStage.stage_discriminator : undefined;
  const stageFact = readOwnData(receiptSemantics.dispatchStageFacts, String(stage));
  const evidenceVersions = isRecord(receipt.version_tuple)
    ? receipt.version_tuple.evidence_versions
    : undefined;
  const evidenceEstablishesExternalAttempt =
    Array.isArray(evidenceVersions) &&
    evidenceVersions.some(
      (evidence) =>
        isRecord(evidence) &&
        readOwnData(receiptSemantics.dispatchEvidenceFacts, String(evidence.evidence_type)) ===
          "external_attempt_possible",
    );
  const authorizationApplicability = typeRule?.[5];
  const dispatchApplicability = typeRule?.[6];
  const externalAttempt =
    stageFact === "external_attempt_possible" ||
    stageFact === "external_attempt_effect_allocated" ||
    evidenceEstablishesExternalAttempt;
  if (authorizationApplicability === "required" && receipt.authorized_external_tuple === null) {
    addFailure(
      failures,
      "$/logicalReceipt/authorized_external_tuple",
      "authorization:required-for-state",
    );
  }
  if (authorizationApplicability === "typed_none" && receipt.authorized_external_tuple !== null) {
    addFailure(
      failures,
      "$/logicalReceipt/authorized_external_tuple",
      "authorization:forbidden-for-rule",
    );
  }
  const dispatchRequired = dispatchApplicability === "required" || externalAttempt;
  if (dispatchRequired && receipt.dispatched_external_tuple === null) {
    addFailure(
      failures,
      "$/logicalReceipt/dispatched_external_tuple",
      "dispatch:required-for-state",
    );
  }
  if (
    externalAttempt &&
    (dispatchApplicability === "forbidden" || authorizationApplicability === "typed_none")
  ) {
    addFailure(
      failures,
      "$/logicalReceipt/version_tuple/attempt_stage_version/stage_discriminator",
      "dispatch:stage-rule-conflict",
    );
  }
  if (dispatchApplicability === "forbidden" && receipt.dispatched_external_tuple !== null) {
    addFailure(failures, "$/logicalReceipt/dispatched_external_tuple", "dispatch:forbidden");
  }
  if (
    isRecord(receipt.erasable_body_ref) &&
    receipt.erasable_body_ref.body_class === "request" &&
    receipt.request_commitment === null
  ) {
    addFailure(failures, "$/logicalReceipt/request_commitment", "request:commitment-required");
  }
  if (isRecord(receipt.key_lifecycle_at_issuance)) {
    const lifecycle = receipt.key_lifecycle_at_issuance;
    const keyVersion = isRecord(versionTuple) ? versionTuple.key_version : undefined;
    const governance = isRecord(versionTuple) ? versionTuple.key_governance_version : undefined;
    const issuedAt = BigInt(String(receipt.issued_at_ms));
    const activatedAt = BigInt(String(lifecycle.activated_at_ms));
    if (
      lifecycle.state !== "active" ||
      lifecycle.verification_only_at_ms_or_null !== null ||
      lifecycle.revoked_at_ms_or_null !== null ||
      lifecycle.compromise_effective_ms_or_null !== null ||
      activatedAt > issuedAt
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/key_lifecycle_at_issuance",
        "key:lifecycle-applicability",
      );
    }
    if (
      isRecord(keyVersion) &&
      (BigInt(String(keyVersion.key_valid_from_ms)) > issuedAt ||
        issuedAt > BigInt(String(keyVersion.key_valid_until_ms)) ||
        BigInt(String(keyVersion.key_valid_from_ms)) >
          BigInt(String(keyVersion.key_valid_until_ms)))
    ) {
      addFailure(failures, "$/logicalReceipt/issued_at_ms", "key:issuance-time");
    }
    if (
      !isRecord(governance) ||
      lifecycle.lifecycle_policy_revision !== governance.lifecycle_policy_revision ||
      lifecycle.rotation_generation !== governance.rotation_generation ||
      lifecycle.revocation_generation !== governance.revocation_generation
    ) {
      addFailure(
        failures,
        "$/logicalReceipt/key_lifecycle_at_issuance",
        "key:governance-binding-mismatch",
      );
    }
    if (isRecord(governance) && typeof receipt.issuance_key_view === "string") {
      const separator = receipt.issuance_key_view.lastIndexOf("@");
      if (
        separator <= 0 ||
        receipt.issuance_key_view !== governance.issuance_view_id ||
        receipt.issuance_key_view.slice(separator + 1) !== governance.issuance_view_revision
      ) {
        addFailure(
          failures,
          "$/logicalReceipt/issuance_key_view",
          "key:issuance-view-binding-mismatch",
        );
      }
    }
  }
  if (
    receipt.valid_until_ms !== null &&
    BigInt(String(receipt.valid_from_ms)) > BigInt(String(receipt.valid_until_ms))
  ) {
    addFailure(failures, "$/logicalReceipt/valid_until_ms", "validity:range-order");
  }
  if (
    typeof signature.signature === "string" &&
    ((receipt.signature_suite === "A10-SIG-ED25519-01" &&
      !isCanonicalBase64Url(signature.signature, 64)) ||
      (receipt.signature_suite === "A10-SIG-P384-01" &&
        !isCanonicalBase64Url(signature.signature, 96)))
  ) {
    addFailure(failures, "$/signatureEnvelope/signature", "signature:noncanonical-base64url");
  }
  const commitmentDisplays = [
    receipt.predecessor_signature_commitment,
    isRecord(receipt.request_commitment) ? receipt.request_commitment.commitment : null,
  ]
    .concat(
      Array.isArray(receipt.scope_commitments)
        ? receipt.scope_commitments.filter(isRecord).map((commitment) => commitment.commitment)
        : [],
    )
    .concat(isRecord(receipt.checkpoint) ? [receipt.checkpoint.root] : [])
    .filter((entry) => entry !== null);
  if (commitmentDisplays.some((entry) => !isCanonicalSha256Display(entry))) {
    addFailure(failures, "$/logicalReceipt", "commitment:noncanonical-display");
  }
  for (const key of ["authorized_external_tuple", "dispatched_external_tuple"] as const) {
    const external = readOwnData(receipt, key);
    if (!isRecord(external) || !isRecord(versionTuple)) continue;
    const attempt = versionTuple.attempt_version;
    if (!isRecord(attempt)) continue;
    for (const field of [
      "attempt_id",
      "attempt_ordinal",
      "idempotency_id",
      "claim_fence",
      "lease_generation",
      "effect_fence",
    ] as const) {
      if (readOwnData(external, field) !== readOwnData(attempt, field)) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/${field}`,
          "external:attempt-binding-mismatch",
        );
      }
    }
    for (const [externalField, receiptField] of [
      ["request_id", "request_id"],
      ["request_commitment", "request_commitment"],
      ["tenant_id", "tenant_id"],
      ["purpose_id", "purpose_id"],
      ["operation_id", "operation_id"],
      ["operation_type_and_version", "operation_type"],
      ["lane_id", "lane_id"],
      ["capsule_id_or_none", "capsule_id"],
      ["active_memory_revisions", "active_memory_revisions"],
      ["tool_intent_binding_or_none", "tool_intent_binding"],
      ["approval_binding", "approval_binding"],
      ["origin_mode", "origin_mode"],
    ] as const) {
      if (
        canonicalValue(readOwnData(external, externalField)) !==
        canonicalValue(readOwnData(receipt, receiptField))
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/${externalField}`,
          "external:binding-mismatch",
        );
      }
    }
    if (
      receipt.origin_mode === "principal_delegated" &&
      external.principal_id_or_system_origin_id !== receipt.principal_id
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/principal_id_or_system_origin_id`,
        "external:binding-mismatch",
      );
    }
    if (
      receipt.origin_mode === "system_originated" &&
      external.principal_id_or_system_origin_id !== receipt.issuer_id
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/principal_id_or_system_origin_id`,
        "external:system-origin-binding-mismatch",
      );
    }
    if (
      isRecord(versionTuple.tenant_scope) &&
      external.tenant_authorization_epoch !== versionTuple.tenant_scope.tenant_authorization_epoch
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/tenant_authorization_epoch`,
        "external:version-binding-mismatch",
      );
    }
    if (isRecord(versionTuple.purpose_scope)) {
      const purposeRevision = String(versionTuple.purpose_scope.purpose_policy_version).split(
        "@",
      )[1];
      if (external.purpose_policy_revision !== purposeRevision) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/purpose_policy_revision`,
          "external:version-binding-mismatch",
        );
      }
    }
    if (isRecord(versionTuple.operation_version)) {
      const expectedWorkload = {
        workload_id: versionTuple.operation_version.route_id,
        workload_revision: versionTuple.operation_version.operation_revision,
      };
      if (canonicalValue(external.workload_id_and_revision) !== canonicalValue(expectedWorkload)) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/workload_id_and_revision`,
          "external:version-binding-mismatch",
        );
      }
    }
    const expectedRevisionSets = interpretReceiptSelector(
      receiptSemantics.sourceEvidenceTupleMember,
      receipt,
      versionTuple,
    );
    if (
      canonicalValue(external.source_and_evidence_revision_sets) !==
      canonicalValue(expectedRevisionSets)
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/source_and_evidence_revision_sets`,
        "external:source-evidence-binding-mismatch",
      );
    }
    if (isRecord(versionTuple.request_version)) {
      const expectedRequestVersions = {
        request_schema_revision: versionTuple.request_version.request_schema_revision,
        request_contract_revision: versionTuple.request_version.request_contract_revision,
      };
      if (
        canonicalValue(external.request_schema_and_contract_versions) !==
        canonicalValue(expectedRequestVersions)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/request_schema_and_contract_versions`,
          "external:version-binding-mismatch",
        );
      }
    }
    const transmissionPolicies = Array.isArray(versionTuple.policy_versions)
      ? versionTuple.policy_versions.filter(
          (entry) => isRecord(entry) && entry.decision_point === "pre_transmission",
        )
      : [];
    const configurations = Array.isArray(versionTuple.configuration_versions)
      ? versionTuple.configuration_versions.filter(isRecord)
      : [];
    const configurationSetValid =
      versionTuple.configuration_versions === null || configurations.length === 1;
    if (transmissionPolicies.length !== 1 || !configurationSetValid) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/policy_and_configuration_versions`,
        "external:authorization-source-ambiguous",
      );
    }
    const transmissionPolicy = transmissionPolicies[0];
    const configuration = configurations[0];
    if (isRecord(transmissionPolicy) && configurationSetValid) {
      const expectedPolicyConfiguration = {
        policy_revision: transmissionPolicy.revision,
        configuration_revision: isRecord(configuration) ? configuration.revision : null,
      };
      const expectedAuthorizationDecision = {
        decision_id: transmissionPolicy.decision_reference,
        decision_revision: transmissionPolicy.revision,
      };
      if (
        canonicalValue(external.policy_and_configuration_versions) !==
        canonicalValue(expectedPolicyConfiguration)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/policy_and_configuration_versions`,
          "external:version-binding-mismatch",
        );
      }
      if (
        canonicalValue(external.authorization_decision_id_and_revision) !==
        canonicalValue(expectedAuthorizationDecision)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/authorization_decision_id_and_revision`,
          "external:authorization-binding-mismatch",
        );
      }
    }
    const expectedComponentVersions = {
      compiler_revision: isRecord(versionTuple.compiler_version)
        ? versionTuple.compiler_version.build_revision
        : null,
      retrieval_revision: isRecord(versionTuple.retrieval_version)
        ? versionTuple.retrieval_version.fusion_ranking_revision
        : null,
      embedding_revision: isRecord(versionTuple.embedding_version)
        ? versionTuple.embedding_version.embedding_space_revision
        : null,
      cache_revision: isRecord(versionTuple.cache_version)
        ? versionTuple.cache_version.schema_revision
        : null,
      index_revision: isRecord(versionTuple.index_version)
        ? versionTuple.index_version.definition_revision
        : null,
      simulation_revision: isRecord(versionTuple.simulation_version)
        ? versionTuple.simulation_version.simulator_revision
        : null,
    };
    if (
      canonicalValue(external.compiler_retrieval_embedding_cache_index_simulation_versions) !==
      canonicalValue(expectedComponentVersions)
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/compiler_retrieval_embedding_cache_index_simulation_versions`,
        "external:version-binding-mismatch",
      );
    }
    if (
      isRecord(versionTuple.provider_model_version) &&
      isRecord(external.adapter_provider_model_destination_and_parameter_versions)
    ) {
      const expectedProviderVersions = {
        adapter_revision: versionTuple.provider_model_version.adapter_revision,
        provider_revision: interpretReceiptSelector(
          receiptSemantics.providerRevisionSource,
          receipt,
          versionTuple,
        ),
        model_revision: versionTuple.provider_model_version.model_revision,
        destination_revision: interpretReceiptSelector(
          receiptSemantics.destinationRevisionSource,
          receipt,
          versionTuple,
        ),
        parameter_revision: versionTuple.provider_model_version.parameter_bundle_revision,
      };
      if (
        canonicalValue(external.adapter_provider_model_destination_and_parameter_versions) !==
        canonicalValue(expectedProviderVersions)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/adapter_provider_model_destination_and_parameter_versions`,
          "external:provider-binding-mismatch",
        );
      }
      const expectedCredentialSelector = interpretReceiptSelector(
        receiptSemantics.credentialSelectorSource,
        receipt,
        versionTuple,
      );
      if (
        canonicalValue(external.credential_selector_id_and_revision) !==
        canonicalValue(expectedCredentialSelector)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/credential_selector_id_and_revision`,
          "external:credential-selector-binding-mismatch",
        );
      }
    } else {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/adapter_provider_model_destination_and_parameter_versions`,
        "external:provider-source-required",
      );
    }
    const effectReservation = interpretReceiptSelector(
      receiptSemantics.effectReservationApplicability,
      receipt,
      versionTuple,
    );
    if (
      !isRecord(effectReservation) ||
      effectReservation.applicability !== "typed_none" ||
      external.effect_reservation_id_or_none !== effectReservation.reservation_id
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/effect_reservation_id_or_none`,
        "external:effect-reservation-forbidden",
      );
    }
    if (isRecord(versionTuple.lifecycle_version)) {
      const expectedEpochs = {
        deletion_epoch: versionTuple.lifecycle_version.deletion_epoch,
        revision_epoch: versionTuple.lifecycle_version.revision_epoch,
      };
      const expectedFences = {
        lifecycle_fence: versionTuple.lifecycle_version.lifecycle_fence,
        hold_revision: versionTuple.lifecycle_version.hold_disposition_revision,
        disposition_revision: versionTuple.lifecycle_version.hold_disposition_revision,
      };
      if (
        canonicalValue(external.deletion_and_revision_epochs) !== canonicalValue(expectedEpochs) ||
        canonicalValue(external.lifecycle_hold_and_disposition_fences) !==
          canonicalValue(expectedFences)
      ) {
        addFailure(
          failures,
          `$/logicalReceipt/${key}/deletion_and_revision_epochs`,
          "external:lifecycle-binding-mismatch",
        );
      }
    }
    if (
      canonicalValue(external.attempt_stage_version) !==
      canonicalValue(versionTuple.attempt_stage_version)
    ) {
      addFailure(
        failures,
        `$/logicalReceipt/${key}/attempt_stage_version`,
        "external:stage-binding-mismatch",
      );
    }
  }
  if (isRecord(receipt.checkpoint)) {
    const start = receipt.checkpoint.range_start;
    const end = receipt.checkpoint.range_end;
    if (typeof start === "string" && typeof end === "string" && BigInt(start) > BigInt(end)) {
      addFailure(failures, "$/logicalReceipt/checkpoint", "checkpoint:range-order");
    }
  }
  const identities = [
    receipt.receipt_id,
    receipt.chain_id,
    receipt.operation_id,
    receipt.attempt_id,
    receipt.idempotency_id,
    receipt.request_id,
    receipt.capsule_id,
    isRecord(receipt.erasable_body_ref) ? receipt.erasable_body_ref.body_ref : null,
    receipt.issuer_id,
    receipt.signing_key_owner_id,
    isRecord(receipt.signing_key_id) ? receipt.signing_key_id.key_id : null,
  ].filter((entry): entry is string => typeof entry === "string");
  if (new Set(identities).size !== identities.length) {
    addFailure(failures, "$/logicalReceipt", "identity:reuse");
  }
  const keyGovernance = isRecord(versionTuple) ? versionTuple.key_governance_version : undefined;
  const separatedOwnerRoles = isRecord(keyGovernance)
    ? [keyGovernance.verifier_id, keyGovernance.custodian_id, keyGovernance.policy_owner_id]
    : [];
  if (
    receipt.issuer_id === receipt.signing_key_owner_id ||
    receipt.principal_id === receipt.signing_key_owner_id ||
    receipt.issuer_id === receipt.principal_id ||
    separatedOwnerRoles.includes(receipt.signing_key_owner_id)
  ) {
    addFailure(failures, "$/logicalReceipt/signing_key_owner_id", "owner:role-separation");
  }
}

export function validateContract(
  schemaName: Exclude<ContractSchemaName, "envelope.schema.json">,
  value: unknown,
): ContractValidationResult {
  const failures: ContractValidationFailure[] = [];
  try {
    if (hasCyclicOrOverdeepValue(value)) {
      return {
        valid: false,
        failures: [{ path: "$", rule: "input:cyclic-or-overdeep" }],
      };
    }
    inspect(readOwnData(contractSchemaCatalog, schemaName) as JsonSchema, value, "$", failures, {
      remaining: maximumValidationNodes,
    });
    if (failures.length === 0 && isRecord(value))
      inspectContractSemantics(schemaName, value, failures);
    if (failures.length === 0 && schemaName === "receipt.schema.json" && isRecord(value)) {
      inspectReceiptSemantics(value, failures);
    }
    if (failures.length === 0 && schemaName === "registry.schema.json" && isRecord(value)) {
      inspectRegistrySemantics(value, failures);
    }
  } catch {
    return {
      valid: false,
      failures: [{ path: "$", rule: "input:non-json-value" }],
    };
  }
  return failures.length === 0 ? { valid: true, failures: [] } : { valid: false, failures };
}

export function parseAndValidateContract(
  schemaName: Exclude<ContractSchemaName, "envelope.schema.json">,
  source: string,
): ContractValidationResult {
  if (utf8Bytes(source) > maximumJsonBytes) {
    return { valid: false, failures: [{ path: "$", rule: "input:maxBytes" }] };
  }
  try {
    rejectDuplicateJsonKeys(source);
    return validateContract(schemaName, JSON.parse(source));
  } catch {
    return { valid: false, failures: [{ path: "$", rule: "input:invalid-json" }] };
  }
}

function rejectDuplicateJsonKeys(source: string): void {
  let index = 0;
  const skip = () => {
    while (/\s/u.test(source.at(index) ?? "")) index += 1;
  };
  const string = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source.at(index) === "\\") index += 2;
      else if (source.at(index++) === '"') return JSON.parse(source.slice(start, index)) as string;
    }
    throw new Error("unterminated string");
  };
  const value = (depth = 0): void => {
    if (depth > 128) throw new Error("nesting budget exceeded");
    skip();
    if (source.at(index) === "{") {
      object(depth + 1);
      return;
    }
    if (source.at(index) === "[") {
      array(depth + 1);
      return;
    }
    if (source.at(index) === '"') {
      string();
      return;
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
      source.slice(index),
    );
    if (!match) throw new Error("invalid value");
    index += match[0].length;
  };
  const array = (depth: number): void => {
    index += 1;
    skip();
    if (source.at(index) === "]") {
      index += 1;
      return;
    }
    for (;;) {
      value(depth);
      skip();
      if (source.at(index) === "]") {
        index += 1;
        return;
      }
      if (source.at(index++) !== ",") throw new Error("invalid array");
    }
  };
  const object = (depth: number): void => {
    const keys = new Set<string>();
    index += 1;
    skip();
    if (source.at(index) === "}") {
      index += 1;
      return;
    }
    for (;;) {
      skip();
      if (source.at(index) !== '"') throw new Error("invalid key");
      const key = string();
      if (keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error("duplicate or dangerous key");
      }
      keys.add(key);
      skip();
      if (source.at(index++) !== ":") throw new Error("invalid object");
      value(depth);
      skip();
      if (source.at(index) === "}") {
        index += 1;
        return;
      }
      if (source.at(index++) !== ",") throw new Error("invalid object");
    }
  };
  value();
  skip();
  if (index !== source.length) throw new Error("trailing input");
}
