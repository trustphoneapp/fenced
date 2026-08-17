// @ts-nocheck -- This module validates hostile unknown JSON before narrowing it.
import {
  hasOwnDataProperty,
  ownDataEntries,
  ownDataHasNoSymbols,
  ownDataKeys,
  ownDataPropertyNames,
  readOwnData,
  readOwnDataDescriptor,
} from "@zintus-continuity/foundation/safe-data-access";

const dataEntries = ownDataEntries;
const dataValues = (value) => ownDataEntries(value).map((entry) => entry[1]);

const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);
const plainArrayPrototype = Object.getPrototypeOf([]);
const plainObjectPrototype = Object.getPrototypeOf({});
const familyNames = ["api", "event", "policy", "provider", "receipt", "registry", "task"];
const reviewedEventContract = Object.freeze({
  allowedProperties: Object.freeze([
    "attemptId",
    "causationId",
    "contractFamily",
    "correlationId",
    "eventId",
    "eventRevision",
    "eventType",
    "occurredAt",
    "operationId",
    "payloadRef",
    "requestedPurpose",
    "schemaVersion",
    "serverPurpose",
    "subjectRef",
    "tenantId",
  ]),
  constBindings: Object.freeze({
    contractFamily: "event",
  }),
  enumBindings: Object.freeze({
    eventType: Object.freeze([
      "interaction.appended",
      "memory.revision.recorded",
      "response.recorded",
      "task.checkpointed",
    ]),
  }),
  opaqueReference: Object.freeze({
    maxLength: 48,
    minLength: 48,
    pattern: "^[0-9a-f]{48}$",
    type: "string",
  }),
  refBindings: Object.freeze({
    attemptId: "./envelope.schema.json#/$defs/identifier",
    causationId: "./envelope.schema.json#/$defs/identifier",
    correlationId: "./envelope.schema.json#/$defs/identifier",
    eventId: "./envelope.schema.json#/$defs/identifier",
    eventRevision: "./envelope.schema.json#/$defs/positiveUint64",
    occurredAt: "./envelope.schema.json#/$defs/dateTime",
    operationId: "./envelope.schema.json#/$defs/identifier",
    payloadRef: "./envelope.schema.json#/$defs/reference",
    requestedPurpose: "./envelope.schema.json#/$defs/purpose",
    schemaVersion: "./envelope.schema.json#/$defs/schemaVersion",
    serverPurpose: "./envelope.schema.json#/$defs/purpose",
    subjectRef: "./envelope.schema.json#/$defs/reference",
    tenantId: "./envelope.schema.json#/$defs/identifier",
  }),
  requiredProperties: Object.freeze([
    "attemptId",
    "contractFamily",
    "eventId",
    "eventRevision",
    "eventType",
    "occurredAt",
    "operationId",
    "requestedPurpose",
    "schemaVersion",
    "serverPurpose",
    "subjectRef",
    "tenantId",
  ]),
});

function canonicalize(value) {
  if (Array.isArray(value)) {
    let output = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) output += ",";
      output += canonicalize(readOwnDataDescriptor(value, String(index)).value);
    }
    return `${output}]`;
  }
  if (value && typeof value === "object") {
    const names = Array.from(ownDataPropertyNames(value)).sort();
    let output = "{";
    for (let index = 0; index < names.length; index += 1) {
      const key = names.at(index);
      if (index > 0) output += ",";
      output += `${JSON.stringify(key)}:${canonicalize(readOwnDataDescriptor(value, key).value)}`;
    }
    return `${output}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSemanticProfileBytes(profile) {
  validateSemanticProfile(profile);
  return canonicalize(profile);
}

export function validateSemanticProfile(profile) {
  const active = new WeakSet();
  const budget = { remaining: 4096 };
  const inspect = (value, location, depth = 0) => {
    if (depth > 32 || budget.remaining-- <= 0)
      throw new Error(`${location} exceeds semantic-profile budget`);
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      if (value.length > 256) throw new Error(`${location} string exceeds bound`);
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isSafeInteger(value))
        throw new Error(`${location} number is nonfinite or noncanonical`);
      return;
    }
    if (typeof value !== "object" || active.has(value))
      throw new Error(`${location} is not finite acyclic JSON`);
    active.add(value);
    if (Array.isArray(value)) {
      if (value.length > 64) throw new Error(`${location} exceeds semantic array length cap`);
      const expectedNames = Array.from({ length: value.length }, (_, index) =>
        String(index),
      ).concat("length");
      const names = ownDataPropertyNames(value);
      if (
        Object.getPrototypeOf(value) !== plainArrayPrototype ||
        !ownDataHasNoSymbols(value) ||
        JSON.stringify(names) !== JSON.stringify(expectedNames)
      )
        throw new Error(`${location} is not a bounded dense JSON array`);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = readOwnDataDescriptor(value, String(index));
        if (!descriptor?.enumerable)
          throw new Error(`${location}/${index} is not a plain array data member`);
        inspect(descriptor.value, `${location}/${index}`, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      const names = ownDataPropertyNames(value);
      if (
        (prototype !== plainObjectPrototype && prototype !== null) ||
        !ownDataHasNoSymbols(value) ||
        names.length > 64
      )
        throw new Error(`${location} is not a finite plain JSON object`);
      for (const name of names) {
        const descriptor = readOwnDataDescriptor(value, name);
        if (
          dangerousKeys.has(name) ||
          !/^\$?[A-Za-z][A-Za-z0-9_]*$/u.test(name) ||
          !descriptor?.enumerable
        )
          throw new Error(`${location}/${name} is not a canonical semantic member`);
        inspect(descriptor.value, `${location}/${name}`, depth + 1);
      }
    }
    active.delete(value);
  };
  inspect(profile, "semantic-profile");
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    JSON.stringify(Array.from(ownDataKeys(profile)).sort()) !==
      JSON.stringify(["$id", "families", "profileVersion", "schemaVersion"]) ||
    profile.$id !== "urn:zintus-continuity:contracts:semantics:v1" ||
    profile.schemaVersion !== "zc.contracts.v1" ||
    profile.profileVersion !== "continuity.contract-semantics@1" ||
    JSON.stringify(Array.from(ownDataKeys(profile.families ?? {})).sort()) !==
      JSON.stringify(familyNames)
  )
    throw new Error("semantic profile identity or family coverage is invalid");
  const requiredFamilyKeys = {
    api: ["server_response"],
    event: [
      "allowedProperties",
      "constBindings",
      "enumBindings",
      "opaqueReference",
      "refBindings",
      "requiredProperties",
      "semanticRule",
    ],
    policy: ["pre_retrieval", "pre_transmission"],
    provider: ["denied", "result"],
    receipt: [
      "allowedReceiptTuples",
      "credentialSelectorSource",
      "destinationRevisionSource",
      "dispatchEvidenceFacts",
      "dispatchStageFacts",
      "effectReservationApplicability",
      "providerRevisionSource",
      "sourceEvidenceTupleMember",
    ],
    registry: ["schemas"],
    task: ["status"],
  };
  for (const [family, keys] of dataEntries(requiredFamilyKeys)) {
    const definition = readOwnData(profile.families, family);
    if (
      !definition ||
      typeof definition !== "object" ||
      Array.isArray(definition) ||
      JSON.stringify(Array.from(ownDataKeys(definition)).sort()) !== JSON.stringify(keys)
    )
      throw new Error(`semantic profile ${family} shape is invalid`);
  }
  const exactKeys = (value, keys) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Array.from(ownDataKeys(value)).sort()) ===
      JSON.stringify(Array.from(keys).sort());
  const exactTuple = (value, length) => Array.isArray(value) && value.length === length;
  const canonicalStringSet = (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string") &&
    JSON.stringify(value) === JSON.stringify(Array.from(new Set(value)).sort());
  const event = profile.families.event;
  const eventBindingProperties = ownDataKeys(event.constBindings ?? {})
    .concat(ownDataKeys(event.enumBindings ?? {}))
    .concat(ownDataKeys(event.refBindings ?? {}));
  if (
    event.semanticRule !== "closed_metadata_only" ||
    !canonicalStringSet(event.allowedProperties) ||
    !canonicalStringSet(event.requiredProperties) ||
    JSON.stringify(event.allowedProperties) !==
      JSON.stringify(reviewedEventContract.allowedProperties) ||
    JSON.stringify(event.requiredProperties) !==
      JSON.stringify(reviewedEventContract.requiredProperties) ||
    JSON.stringify(event.constBindings) !== JSON.stringify(reviewedEventContract.constBindings) ||
    JSON.stringify(event.enumBindings) !== JSON.stringify(reviewedEventContract.enumBindings) ||
    JSON.stringify(event.refBindings) !== JSON.stringify(reviewedEventContract.refBindings) ||
    eventBindingProperties.length !== event.allowedProperties.length ||
    new Set(eventBindingProperties).size !== eventBindingProperties.length ||
    JSON.stringify(Array.from(eventBindingProperties).sort()) !==
      JSON.stringify(event.allowedProperties) ||
    !canonicalStringSet(event.enumBindings.eventType) ||
    dataValues(event.constBindings).some((value) => typeof value !== "string") ||
    dataValues(event.refBindings).some((value) => typeof value !== "string") ||
    JSON.stringify(event.opaqueReference) !== JSON.stringify(reviewedEventContract.opaqueReference)
  )
    throw new Error("event semantic allowlist or binding map is invalid");
  const api = profile.families.api.server_response;
  if (
    !exactKeys(api, ["denied", "failed", "partial", "succeeded", "unknown"]) ||
    dataValues(api).some(
      (tuple) =>
        !exactTuple(tuple, 2) ||
        typeof tuple[0] !== "string" ||
        !["content_required", "content_forbidden"].includes(tuple[1]),
    ) ||
    ["succeeded", "partial"].some(
      (outcome) => readOwnData(api, outcome)?.at(1) !== "content_required",
    ) ||
    ["denied", "failed", "unknown"].some(
      (outcome) => readOwnData(api, outcome)?.at(1) !== "content_forbidden",
    )
  )
    throw new Error("api semantic table is incomplete or malformed");
  const policy = profile.families.policy;
  if (
    dataValues(policy).some(
      (decisions) =>
        !exactKeys(decisions, ["allow", "deny"]) ||
        dataValues(decisions).some((reasons) => !canonicalStringSet(reasons)),
    )
  )
    throw new Error("policy semantic table is incomplete or malformed");
  const provider = profile.families.provider;
  if (
    !exactKeys(provider.denied, ["denied", "unknown"]) ||
    !exactKeys(provider.result, ["failed", "partial", "succeeded", "unknown"]) ||
    dataValues(provider.denied).some((errors) => !canonicalStringSet(errors)) ||
    dataValues(provider.result).some(
      (tuple) =>
        !exactTuple(tuple, 3) ||
        typeof tuple[0] !== "string" ||
        tuple[1] !== "input_required" ||
        !["output_required", "output_forbidden"].includes(tuple[2]),
    ) ||
    ["succeeded", "partial"].some(
      (outcome) => readOwnData(provider.result, outcome)?.at(2) !== "output_required",
    ) ||
    ["failed", "unknown"].some(
      (outcome) => readOwnData(provider.result, outcome)?.at(2) !== "output_forbidden",
    )
  )
    throw new Error("provider semantic table is incomplete or malformed");
  const task = profile.families.task.status;
  if (
    !exactKeys(task, ["cancelled", "completed", "failed", "pending", "running", "unknown"]) ||
    dataValues(task).some(
      (tuple) =>
        !exactTuple(tuple, 3) ||
        typeof tuple[0] !== "string" ||
        typeof tuple[1] !== "string" ||
        !["checkpoint_required", "checkpoint_forbidden"].includes(tuple[2]),
    ) ||
    task.completed[2] !== "checkpoint_required" ||
    ["cancelled", "failed", "pending", "running", "unknown"].some(
      (state) => readOwnData(task, state)?.at(2) !== "checkpoint_forbidden",
    )
  )
    throw new Error("task semantic table is incomplete or malformed");
  const receipt = profile.families.receipt;
  const selectors = {
    sourceEvidenceTupleMember: "source_evidence.id_revision_pairs",
    providerRevisionSource: "provider_model_version.provider_revision",
    destinationRevisionSource: "provider_model_version.destination_revision",
    credentialSelectorSource:
      "provider_model_version.credential_selector_id+credential_selector_revision",
    effectReservationApplicability:
      "provider_model_version.effect_reservation_applicability+effect_reservation_id",
  };
  const stageFacts = {
    AS0_LOCAL_PREATTEMPT_NO_CLAIM: "no_external_attempt",
    AS1_PREALLOCATED_NOT_CLAIMED: "no_external_attempt",
    AS2_CLAIMED_NO_LEASE: "pre_dispatch",
    AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT: "external_attempt_possible",
    AS4_LEASE_BOUND_EFFECT_ALLOCATED: "external_attempt_effect_allocated",
  };
  const tuples = receipt.allowedReceiptTuples;
  const fiveFieldKeys = Array.isArray(tuples)
    ? tuples.map((tuple) => JSON.stringify(tuple.slice(0, 5)))
    : [];
  const tupleSortKeys = Array.isArray(tuples)
    ? tuples.map(
        (tuple) => `${JSON.stringify(tuple.slice(0, 5))}\u0000${JSON.stringify(tuple.slice(5))}`,
      )
    : [];
  if (
    dataEntries(selectors).some(([key, value]) => readOwnData(receipt, key) !== value) ||
    JSON.stringify(receipt.dispatchStageFacts) !== JSON.stringify(stageFacts) ||
    JSON.stringify(receipt.dispatchEvidenceFacts) !==
      JSON.stringify({ dispatch_attempt: "external_attempt_possible" }) ||
    !Array.isArray(tuples) ||
    tuples.length === 0 ||
    new Set(fiveFieldKeys).size !== tuples.length ||
    JSON.stringify(tupleSortKeys) !== JSON.stringify(Array.from(tupleSortKeys).sort()) ||
    tuples.some(
      (tuple) =>
        !Array.isArray(tuple) ||
        tuple.length !== 7 ||
        tuple.some((value, index) =>
          index === 3 ? value !== null && typeof value !== "string" : typeof value !== "string",
        ) ||
        !["required", "typed_none"].includes(tuple[5]) ||
        !["forbidden", "optional", "required", "terminal_stage_fact"].includes(tuple[6]),
    ) ||
    JSON.stringify(Array.from(ownDataKeys(profile.families.registry.schemas)).sort()) !==
      JSON.stringify(familyNames)
  )
    throw new Error("semantic profile closed table coverage is invalid");
  return profile;
}

export function crossValidateExecutableSemantics(catalog, semanticProfile) {
  validateSemanticProfile(semanticProfile);
  const eventSchema = catalog["event.schema.json"];
  const eventSemantics = semanticProfile.families.event;
  const eventProperties = eventSchema?.properties ?? {};
  const exactObject = (left, right) =>
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
  if (
    eventSemantics.semanticRule !== "closed_metadata_only" ||
    eventSchema?.additionalProperties !== false ||
    !exactObject(
      Array.from(ownDataKeys(eventProperties)).sort(),
      eventSemantics.allowedProperties,
    ) ||
    !exactObject(
      Array.from(eventSchema?.required ?? []).sort(),
      eventSemantics.requiredProperties,
    ) ||
    dataEntries(eventSemantics.constBindings).some(
      ([property, value]) => !exactObject(readOwnData(eventProperties, property), { const: value }),
    ) ||
    dataEntries(eventSemantics.enumBindings).some(
      ([property, values]) =>
        !exactObject(readOwnData(eventProperties, property), { enum: values }),
    ) ||
    dataEntries(eventSemantics.refBindings).some(
      ([property, reference]) =>
        !exactObject(readOwnData(eventProperties, property), { $ref: reference }),
    ) ||
    !exactObject(
      catalog["envelope.schema.json"]?.$defs?.reference,
      eventSemantics.opaqueReference,
    ) ||
    eventSemantics.refBindings.payloadRef !== "./envelope.schema.json#/$defs/reference" ||
    eventSemantics.refBindings.subjectRef !== "./envelope.schema.json#/$defs/reference"
  )
    throw new Error("event schema does not realize closed metadata semantics");
  const schemaValues = (schema, propertyName) => {
    const found = new Set();
    const visited = new WeakSet();
    const collect = (definition) => {
      if (!definition || typeof definition !== "object") return;
      if (Array.isArray(definition.enum)) {
        definition.enum.forEach((value) => {
          found.add(value);
        });
      }
      if (hasOwnDataProperty(definition, "const")) found.add(definition.const);
      for (const key of ["anyOf", "oneOf"]) {
        const branch = readOwnData(definition, key);
        if (Array.isArray(branch)) branch.forEach(collect);
      }
      if (definition.items) collect(definition.items);
    };
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);
      collect(node.properties ? readOwnData(node.properties, propertyName) : undefined);
      for (const key of ["anyOf", "oneOf"]) {
        const branch = readOwnData(node, key);
        if (Array.isArray(branch)) branch.forEach(visit);
      }
      if (node.properties) dataValues(node.properties).forEach(visit);
      if (node.items) visit(node.items);
    };
    visit(schema);
    return found;
  };
  const branchValues = (schema, discriminator, discriminatorValue, propertyName) => {
    const found = new Set();
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (
        (node.properties ? readOwnData(node.properties, discriminator) : undefined)?.const ===
        discriminatorValue
      ) {
        for (const value of schemaValues(node, propertyName)) found.add(value);
      }
      for (const key of ["anyOf", "oneOf"]) {
        const branch = readOwnData(node, key);
        if (Array.isArray(branch)) branch.forEach(visit);
      }
    };
    visit(schema);
    return found;
  };
  const requireValue = (schemaName, propertyName, value) => {
    if (!schemaValues(readOwnData(catalog, schemaName), propertyName).has(value))
      throw new Error(`${schemaName} ${propertyName} semantic is unrealizable`);
  };
  const equalSets = (left, right) =>
    JSON.stringify(Array.from(new Set(left)).sort()) ===
    JSON.stringify(Array.from(new Set(right)).sort());
  const assertCoverage = (actual, schemaName, propertyName) => {
    if (!equalSets(actual, schemaValues(readOwnData(catalog, schemaName), propertyName)))
      throw new Error(`${schemaName} ${propertyName} semantic coverage is incomplete`);
  };
  for (const [outcome, [errorCode, directive]] of dataEntries(
    semanticProfile.families.api.server_response,
  )) {
    requireValue("api.schema.json", "outcome", outcome);
    requireValue("api.schema.json", "errorCode", errorCode);
    if (!["content_required", "content_forbidden"].includes(directive))
      throw new Error("api directive is unknown");
  }
  assertCoverage(
    ownDataKeys(semanticProfile.families.api.server_response),
    "api.schema.json",
    "outcome",
  );
  assertCoverage(
    dataValues(semanticProfile.families.api.server_response).map((tuple) => tuple[0]),
    "api.schema.json",
    "errorCode",
  );
  for (const [stage, decisions] of dataEntries(semanticProfile.families.policy)) {
    requireValue("policy.schema.json", "stage", stage);
    for (const [decision, reasons] of dataEntries(decisions)) {
      requireValue("policy.schema.json", "decision", decision);
      reasons.forEach((reason) => {
        requireValue("policy.schema.json", "reasonCodes", reason);
      });
    }
    const allow = decisions.allow;
    const deny = decisions.deny;
    if (
      allow.some((reason) => deny.includes(reason)) ||
      !equalSets(
        allow.concat(deny),
        branchValues(catalog["policy.schema.json"], "stage", stage, "reasonCodes"),
      )
    )
      throw new Error("policy stage reason partition is not disjoint and exhaustive");
  }
  assertCoverage(ownDataKeys(semanticProfile.families.policy), "policy.schema.json", "stage");
  assertCoverage(
    dataValues(semanticProfile.families.policy).flatMap((decisions) => ownDataKeys(decisions)),
    "policy.schema.json",
    "decision",
  );
  assertCoverage(
    dataValues(semanticProfile.families.policy).flatMap((decisions) =>
      dataValues(decisions).flat(),
    ),
    "policy.schema.json",
    "reasonCodes",
  );
  for (const [variant, outcomes] of dataEntries(semanticProfile.families.provider)) {
    requireValue("provider.schema.json", "variant", variant);
    if (
      !equalSets(
        ownDataKeys(outcomes),
        branchValues(catalog["provider.schema.json"], "variant", variant, "outcome"),
      )
    )
      throw new Error(`provider ${variant} outcome coverage is incomplete`);
    const semanticErrors =
      variant === "denied"
        ? dataValues(outcomes).flat()
        : dataValues(outcomes).map((tuple) => tuple[0]);
    if (
      !equalSets(
        semanticErrors,
        branchValues(catalog["provider.schema.json"], "variant", variant, "errorCode"),
      )
    )
      throw new Error(`provider ${variant} error-code coverage is incomplete`);
    for (const [outcome, tokens] of dataEntries(outcomes)) {
      requireValue("provider.schema.json", "outcome", outcome);
      const errors = variant === "denied" ? tokens : tokens.slice(0, 1);
      errors.forEach((error) => {
        requireValue("provider.schema.json", "errorCode", error);
      });
      (variant === "denied" ? [] : tokens.slice(1)).forEach((directive) => {
        if (
          !["input_required", "input_forbidden", "output_required", "output_forbidden"].includes(
            directive,
          )
        )
          throw new Error("provider directive is unknown");
      });
    }
    if (variant === "denied") {
      const deniedErrors = outcomes.denied;
      const unknownErrors = outcomes.unknown;
      if (
        deniedErrors.some((error) => unknownErrors.includes(error)) ||
        !equalSets(
          deniedErrors.concat(unknownErrors),
          branchValues(catalog["provider.schema.json"], "variant", variant, "errorCode"),
        )
      )
        throw new Error("provider denial partition is not disjoint and exhaustive");
    }
  }
  assertCoverage(ownDataKeys(semanticProfile.families.provider), "provider.schema.json", "variant");
  assertCoverage(
    dataValues(semanticProfile.families.provider).flatMap((outcomes) => ownDataKeys(outcomes)),
    "provider.schema.json",
    "outcome",
  );
  assertCoverage(
    dataValues(semanticProfile.families.provider.denied)
      .flat()
      .concat(dataValues(semanticProfile.families.provider.result).map((tuple) => tuple[0])),
    "provider.schema.json",
    "errorCode",
  );
  for (const [state, [outcome, errorCode, directive]] of dataEntries(
    semanticProfile.families.task.status,
  )) {
    requireValue("task.schema.json", "state", state);
    requireValue("task.schema.json", "outcome", outcome);
    requireValue("task.schema.json", "errorCode", errorCode);
    if (!["checkpoint_required", "checkpoint_forbidden"].includes(directive))
      throw new Error("task directive is unknown");
  }
  assertCoverage(ownDataKeys(semanticProfile.families.task.status), "task.schema.json", "state");
  assertCoverage(
    dataValues(semanticProfile.families.task.status).map((tuple) => tuple[0]),
    "task.schema.json",
    "outcome",
  );
  assertCoverage(
    dataValues(semanticProfile.families.task.status).map((tuple) => tuple[1]),
    "task.schema.json",
    "errorCode",
  );
  const logical = catalog["receipt.schema.json"]?.properties?.logicalReceipt?.properties;
  const values = (name) => {
    const definition = logical ? readOwnData(logical, name) : undefined;
    if (Array.isArray(definition?.enum)) return definition.enum;
    if (Array.isArray(definition?.anyOf))
      return definition.anyOf.flatMap((branch) =>
        Array.isArray(branch.enum)
          ? branch.enum
          : hasOwnDataProperty(branch, "const")
            ? [branch.const]
            : [],
      );
    throw new Error(`receipt semantic field ${name} has no closed values`);
  };
  const columns = [
    values("receipt_type"),
    values("semantic_class"),
    values("decision_code"),
    values("outcome_code"),
    values("receipt_state"),
    ["required", "typed_none"],
    ["forbidden", "optional", "required", "terminal_stage_fact"],
  ];
  for (const tuple of semanticProfile.families.receipt.allowedReceiptTuples) {
    tuple.forEach((value, index) => {
      if (!columns.at(index)?.some((allowed) => Object.is(allowed, value)))
        throw new Error(`unrealizable receipt semantic tuple ${JSON.stringify(tuple)}`);
    });
  }
  const stageValues =
    logical?.version_tuple?.properties?.attempt_stage_version?.properties?.stage_discriminator
      ?.enum;
  if (
    !Array.isArray(stageValues) ||
    JSON.stringify(Array.from(stageValues).sort()) !==
      JSON.stringify(
        Array.from(ownDataKeys(semanticProfile.families.receipt.dispatchStageFacts)).sort(),
      ) ||
    ownDataKeys(semanticProfile.families.receipt.dispatchEvidenceFacts).some(
      (type) => !schemaValues(catalog["receipt.schema.json"], "evidence_type").has(type),
    ) ||
    dataEntries(semanticProfile.families.registry.schemas).some(
      ([family, id]) => readOwnData(catalog, `${family}.schema.json`)?.$id !== id,
    )
  )
    throw new Error("semantic closed coverage does not match schemas");
  return semanticProfile;
}

export function initializeSemanticProfile(catalog, profile) {
  return Object.freeze(crossValidateExecutableSemantics(catalog, profile));
}
