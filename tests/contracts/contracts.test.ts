import { describe, expect, it } from "vitest";
import {
  checkOldProducerToNewConsumerCompatibility,
  checkSameVersionCompatibility,
  contractSchemaCatalog,
  contractSemanticProfile,
  type OpaqueId,
  parseAndValidateContract,
  validateContract,
} from "../../packages/contracts/src/index.js";
import {
  ownDataEntries,
  ownDataKeys,
  readOwnData,
  writeOwnData,
} from "../../scripts/safe-own-data.mjs";
import { mergeSyntheticRecords } from "../../scripts/synthetic-test-data.mjs";

const id = (digit: string) => digit.repeat(48);
function requiredEntry<Value>(values: readonly Value[], index: number): Value {
  const value = values.at(index);
  if (value === undefined) throw new Error("synthetic fixture entry missing");
  return value;
}
const binding = {
  schemaVersion: "zc.contracts.v1",
  tenantId: id("1"),
  requestedPurpose: "continuity.respond",
  serverPurpose: "continuity.respond",
  operationId: id("2"),
  attemptId: id("3"),
};

const examples = {
  "api.schema.json": mergeSyntheticRecords(binding, {
    contractFamily: "api",
    variant: "server_admitted_request",
    messageId: id("4"),
    messageRevision: "1",
    route: "continuity.respond",
  }),
  "event.schema.json": mergeSyntheticRecords(binding, {
    contractFamily: "event",
    eventId: id("4"),
    eventRevision: "1",
    eventType: "interaction.appended",
    occurredAt: "2026-07-29T12:34:56.000Z",
    subjectRef: id("5"),
    payloadRef: id("6"),
  }),
  "policy.schema.json": mergeSyntheticRecords(binding, {
    contractFamily: "policy",
    decisionId: id("4"),
    decisionRevision: "1",
    stage: "pre_retrieval",
    decision: "deny",
    policyVersion: "policy@1",
    reasonCodes: ["RETRIEVAL_SCOPE_DENIED"],
    effectfulTools: "disabled",
    learning: "disabled",
    export: "disabled",
  }),
  "provider.schema.json": mergeSyntheticRecords(binding, {
    contractFamily: "provider",
    variant: "denied",
    providerRequestId: id("4"),
    providerRequestRevision: "1",
    provider: "amazon-bedrock@1",
    model: "primary-model@1",
    providerRole: "primary",
    failover: "disabled",
    operation: "generation",
    decision: "deny",
    outcome: "denied",
    outputTrust: "untrusted_data",
    policyVersion: "policy@1",
    contextCompilerVersion: "compiler@1",
    errorCode: "PROVIDER_POLICY_DENIED",
  }),
  "registry.schema.json": mergeSyntheticRecords(binding, {
    contractFamily: "registry",
    catalogId: id("4"),
    catalogRevision: "1",
    schemas: [
      ["api", "api"],
      ["event", "event"],
      ["policy", "policy"],
      ["provider", "provider"],
      ["receipt", "receipt"],
      ["registry", "registry"],
      ["task", "task"],
    ].map(([family, name], index) => ({
      family,
      schemaId: `urn:zintus-continuity:contracts:v1:${name}`,
      schemaDigest: String(index + 1).repeat(64),
    })),
  }),
  "task.schema.json": mergeSyntheticRecords(binding, {
    contractFamily: "task",
    taskId: id("4"),
    taskVersion: "1",
    messageKind: "status",
    state: "unknown",
    outcome: "denied",
    updatedAt: "2026-07-29T12:34:56.000Z",
    errorCode: "TASK_NOT_FOUND",
  }),
} as const;

function versionTuple() {
  return {
    tenant_scope: {
      tenant_id: binding.tenantId,
      tenant_authorization_epoch: "1",
    },
    purpose_scope: {
      purpose_id: binding.serverPurpose,
      purpose_policy_version: "purpose@1",
      purpose_expiry_fence: "1",
    },
    object_versions: [
      {
        object_type: "receipt",
        object_id: id("4"),
        schema_id: "receipt@3",
        revision_id: "1",
      },
    ],
    source_versions: [
      {
        source_type: "event",
        source_id: id("8"),
        revision_id: "1",
        valid_from_ms: "1785328496000",
        valid_until_ms: null,
        system_time_ms: "1785328496000",
      },
    ],
    evidence_versions: [
      {
        evidence_type: "test",
        evidence_id: id("9"),
        evidence_revision: "1",
        verifier_class: "independent",
      },
    ],
    schema_versions: [{ schema_id: "receipt@3", schema_revision: "3" }],
    receipt_format_version: {
      logical_schema: "continuity.receipt/3",
      canonical_format: "A10-CANON-01",
    },
    policy_versions: [
      {
        policy_id: id("c"),
        revision: "1",
        decision_point: "pre_retrieval",
        decision_reference: id("d"),
      },
      {
        policy_id: id("e"),
        revision: "1",
        decision_point: "pre_transmission",
        decision_reference: id("f"),
      },
    ],
    configuration_versions: null,
    compiler_version: null,
    retrieval_version: null,
    provider_model_version: {
      adapter_id: id("8"),
      adapter_revision: "1",
      provider_id: id("9"),
      provider_revision: "1",
      model_id: id("e"),
      model_revision: "1",
      parameter_bundle_revision: "1",
      destination_class: "bedrock_primary",
      destination_revision: "1",
      credential_selector_id: id("8"),
      credential_selector_revision: "1",
      effect_reservation_applicability: "typed_none",
      effect_reservation_id: null,
    },
    embedding_version: null,
    cache_version: null,
    index_version: null,
    simulation_version: null,
    operation_version: {
      operation_type: "generation",
      operation_revision: "1",
      route_id: id("e"),
      lane_id: id("f"),
      capsule_schema_id: "capsule@1",
      capsule_schema_revision: "1",
      workload_class: "api",
    },
    attempt_version: {
      attempt_id: binding.attemptId,
      attempt_ordinal: "1",
      idempotency_id: id("7"),
      claim_fence: "1",
      lease_generation: null,
      effect_fence: null,
    },
    algorithm_version: {
      canonicalization_suite: "A10-CANON-01",
      digest_suite: "sha256@1",
      signature_suite: "A10-SIG-ED25519-01",
      receipt_id_generation_suite: "csprng-192@1",
      commitment_suite: "request-commitment@1",
    },
    key_version: {
      issuer_id: id("a"),
      signing_key_id: id("0"),
      signing_key_revision: "1",
      trust_anchor_set_revision: "1",
      revocation_view_revision: "1",
      key_valid_from_ms: "1785328496000",
      key_valid_until_ms: "1785328497000",
    },
    lifecycle_version: {
      deletion_epoch: "0",
      revision_epoch: "0",
      lifecycle_fence: "1",
      hold_disposition_revision: "0",
      supersession_generation: "0",
      body_availability: "never_existed",
    },
    environment_version: {
      environment_id: id("c"),
      architecture_profile_id: "profile@1",
      deployment_manifest_revision: null,
      isolation_domain_id: id("d"),
    },
    chain_version: {
      chain_id: id("5"),
      sequence_policy_revision: "1",
      checkpoint_policy_revision: "1",
      predecessor_verification_policy: "predecessor@1",
    },
    verifier_policy_version: {
      policy_id: id("e"),
      policy_revision: "1",
      accepted_suite_set_revision: "1",
      trust_time_rule_revision: "1",
      limitation_rule_revision: "1",
      projection_rule_revision: "1",
    },
    request_version: {
      request_id: id("b"),
      request_contract_id: id("f"),
      request_contract_revision: "1",
      request_schema_revision: "1",
      authorization_context_revision: "1",
      request_commitment_suite: "A10-REQ-COMMIT-01",
      request_commitment_revision: "1",
    },
    active_memory_version: [],
    intent_approval_version: {
      tool_intent_id: null,
      tool_intent_revision: null,
      approval_fact_id: id("c"),
      approval_fact_revision: "1",
    },
    key_governance_version: {
      signing_key_owner_id: id("d"),
      verifier_id: id("e"),
      custodian_id: id("f"),
      policy_owner_id: id("1"),
      lifecycle_policy_revision: "1",
      rotation_generation: "0",
      revocation_generation: "0",
      issuance_view_id: "key_view@1",
      issuance_view_revision: "1",
      verifier_current_view_policy_revision: "1",
    },
    attempt_stage_version: {
      stage_schema_id: "continuity.attempt-stage/1",
      stage_schema_revision: "1",
      stage_discriminator: "AS2_CLAIMED_NO_LEASE",
      idempotency_mode: "IDEMPOTENCY_REQUIRED",
      operation_schema_id: "operation@1",
      operation_schema_revision: "1",
    },
  };
}

function receipt() {
  const logicalReceipt = {
    envelope_type: "receipt",
    receipt_schema: "continuity.receipt/3",
    receipt_id: id("4"),
    receipt_type: "transmission",
    profile_id: "profile@1",
    environment_id: id("c"),
    chain_id: id("5"),
    tenant_id: binding.tenantId,
    principal_id: id("6"),
    origin_mode: "principal_delegated",
    purpose_id: binding.serverPurpose,
    operation_id: binding.operationId,
    operation_type: "generation@1",
    lane_id: id("f"),
    capsule_id: null,
    attempt_id: binding.attemptId,
    attempt_ordinal: "1",
    idempotency_id: id("7"),
    semantic_class: "runtime_outcome",
    decision_code: "DENY",
    outcome_code: null,
    receipt_state: "unknown",
    limitation_codes: ["BODY_UNAVAILABLE"],
    issued_at_ms: "1785328496000",
    valid_from_ms: "1785328496000",
    valid_until_ms: null,
    source_refs: [{ source_type: "event", source_id: id("8"), source_revision: "1" }],
    evidence_refs: [{ evidence_type: "test", evidence_id: id("9"), evidence_revision: "1" }],
    version_tuple: versionTuple(),
    sequence: "1",
    predecessor_receipt_id: null,
    predecessor_signature_commitment: null,
    checkpoint: null,
    signature_suite: "A10-SIG-ED25519-01",
    signing_key_id: { key_id: id("0"), key_revision: "1" },
    issuer_id: id("a"),
    verifier_policy_id: "verifier@1",
    lifecycle_binding: {
      deletion_epoch: "0",
      revision_epoch: "0",
      lifecycle_fence: "1",
      hold_disposition_revision: "0",
      body_availability: "never_existed",
    },
    supersedes_receipt_ids: [],
    projection_hint: {
      status_class: "historical_only",
      projection_rule_version: "projection@1",
    },
    erasable_body_ref: null,
    scope_commitments: [],
    request_id: id("b"),
    request_commitment: null,
    active_memory_revisions: [],
    tool_intent_binding: null,
    approval_binding: {
      not_required: true,
      no_approval_required_fact_id: id("c"),
      fact_revision: "1",
      policy_revision: "1",
    },
    signing_key_owner_id: id("d"),
    key_lifecycle_at_issuance: {
      state: "active",
      lifecycle_policy_revision: "1",
      rotation_generation: "0",
      revocation_generation: "0",
      activated_at_ms: "1785328496000",
      verification_only_at_ms_or_null: null,
      revoked_at_ms_or_null: null,
      compromise_effective_ms_or_null: null,
    },
    issuance_key_view: "key_view@1",
    authorized_external_tuple: null,
    dispatched_external_tuple: null,
  };
  return mergeSyntheticRecords(binding, {
    contractFamily: "receipt",
    logicalReceipt,
    signatureEnvelope: {
      envelope_version: "continuity.receipt-signature/1",
      receipt_id: logicalReceipt.receipt_id,
      signature_suite: logicalReceipt.signature_suite,
      signing_key_id: logicalReceipt.signing_key_id,
      canonical_bytes_length: "4096",
      signature: "A".repeat(86),
    },
  });
}

function externalTupleFor(logicalReceipt: ReturnType<typeof receipt>["logicalReceipt"]) {
  const versions = logicalReceipt.version_tuple;
  const transmissionPolicy = versions.policy_versions.find(
    (entry) => entry.decision_point === "pre_transmission",
  );
  if (!transmissionPolicy) throw new Error("fixture lacks pre-transmission policy");
  return {
    request_id: logicalReceipt.request_id,
    request_commitment: logicalReceipt.request_commitment,
    tenant_id: logicalReceipt.tenant_id,
    tenant_authorization_epoch: versions.tenant_scope.tenant_authorization_epoch,
    principal_id_or_system_origin_id: logicalReceipt.principal_id ?? logicalReceipt.issuer_id,
    origin_mode: logicalReceipt.origin_mode,
    purpose_id: logicalReceipt.purpose_id,
    purpose_policy_revision: "1",
    operation_id: logicalReceipt.operation_id,
    operation_type_and_version: logicalReceipt.operation_type,
    lane_id: logicalReceipt.lane_id,
    capsule_id_or_none: logicalReceipt.capsule_id,
    attempt_id: logicalReceipt.attempt_id,
    attempt_ordinal: logicalReceipt.attempt_ordinal,
    idempotency_id: logicalReceipt.idempotency_id,
    claim_fence: versions.attempt_version.claim_fence,
    lease_generation: versions.attempt_version.lease_generation,
    effect_fence: versions.attempt_version.effect_fence,
    attempt_stage_version: versions.attempt_stage_version,
    workload_id_and_revision: {
      workload_id: versions.operation_version.route_id,
      workload_revision: versions.operation_version.operation_revision,
    },
    source_and_evidence_revision_sets: {
      source_revisions: logicalReceipt.source_refs.map((entry) => ({
        source_id: entry.source_id,
        revision: entry.source_revision,
      })),
      evidence_revisions: logicalReceipt.evidence_refs.map((entry) => ({
        evidence_id: entry.evidence_id,
        revision: entry.evidence_revision,
      })),
    },
    active_memory_revisions: logicalReceipt.active_memory_revisions,
    tool_intent_binding_or_none: logicalReceipt.tool_intent_binding,
    approval_binding: logicalReceipt.approval_binding,
    policy_and_configuration_versions: {
      policy_revision: transmissionPolicy.revision,
      configuration_revision: null,
    },
    compiler_retrieval_embedding_cache_index_simulation_versions: {
      compiler_revision: null,
      retrieval_revision: null,
      embedding_revision: null,
      cache_revision: null,
      index_revision: null,
      simulation_revision: null,
    },
    adapter_provider_model_destination_and_parameter_versions: {
      adapter_revision: versions.provider_model_version.adapter_revision,
      provider_revision: versions.provider_model_version.provider_revision,
      model_revision: versions.provider_model_version.model_revision,
      destination_revision: versions.provider_model_version.destination_revision,
      parameter_revision: versions.provider_model_version.parameter_bundle_revision,
    },
    request_schema_and_contract_versions: {
      request_schema_revision: versions.request_version.request_schema_revision,
      request_contract_revision: versions.request_version.request_contract_revision,
    },
    deletion_and_revision_epochs: {
      deletion_epoch: versions.lifecycle_version.deletion_epoch,
      revision_epoch: versions.lifecycle_version.revision_epoch,
    },
    lifecycle_hold_and_disposition_fences: {
      lifecycle_fence: versions.lifecycle_version.lifecycle_fence,
      hold_revision: versions.lifecycle_version.hold_disposition_revision,
      disposition_revision: versions.lifecycle_version.hold_disposition_revision,
    },
    authorization_decision_id_and_revision: {
      decision_id: transmissionPolicy.decision_reference,
      decision_revision: transmissionPolicy.revision,
    },
    credential_selector_id_and_revision: {
      selector_id: versions.provider_model_version.credential_selector_id,
      selector_revision: versions.provider_model_version.credential_selector_revision,
    },
    effect_reservation_id_or_none: versions.provider_model_version.effect_reservation_id,
  };
}

describe("closed public v1 contracts", () => {
  it.each(ownDataEntries(examples))("accepts synthetic %s metadata", (schema, value) => {
    expect(validateContract(schema as keyof typeof examples, value)).toEqual({
      valid: true,
      failures: [],
    });
  });

  it("accepts the complete content-free continuity.receipt/3 fixture", () => {
    expect(validateContract("receipt.schema.json", receipt())).toEqual({
      valid: true,
      failures: [],
    });
  });

  it("keeps untrusted ingress separate from server-admitted authority", () => {
    const ingress = {
      schemaVersion: "zc.contracts.v1",
      contractFamily: "api",
      variant: "untrusted_ingress",
      clientRequestId: "client-request-1",
      requestedPurpose: "continuity.respond",
      route: "continuity.respond",
    };
    expect(validateContract("api.schema.json", ingress).valid).toBe(true);
    expect(
      validateContract(
        "api.schema.json",
        mergeSyntheticRecords(ingress, {
          tenantId: id("1"),
          serverPurpose: "continuity.respond",
          principalId: id("2"),
          authority: "allow",
        }),
      ).valid,
    ).toBe(false);
  });

  it("accepts every disjoint API, policy, provider, and task variant", () => {
    expect(
      validateContract(
        "api.schema.json",
        mergeSyntheticRecords(examples["api.schema.json"], {
          variant: "server_response",
          outcome: "succeeded",
          errorCode: "API_NONE",
          contentRef: id("e"),
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateContract(
        "policy.schema.json",
        mergeSyntheticRecords(examples["policy.schema.json"], {
          stage: "pre_transmission",
          decision: "allow",
          reasonCodes: ["TRANSMISSION_ALLOWED"],
          provider: "amazon-bedrock@1",
          model: "primary-model@1",
          destinationClass: "bedrock_primary",
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateContract(
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], {
          variant: "result",
          decision: "invoke",
          outcome: "succeeded",
          inputRef: id("e"),
          outputRef: id("f"),
          errorCode: "PROVIDER_NONE",
        }),
      ).valid,
    ).toBe(true);
    expect(
      validateContract(
        "task.schema.json",
        mergeSyntheticRecords(binding, {
          contractFamily: "task",
          taskId: id("4"),
          taskVersion: "1",
          messageKind: "command",
          command: "inspect",
        }),
      ).valid,
    ).toBe(true);
  });

  it("rejects cross-variant field substitution", () => {
    expect(
      validateContract(
        "task.schema.json",
        mergeSyntheticRecords(examples["task.schema.json"], { command: "cancel" }),
      ).valid,
    ).toBe(false);
    expect(
      validateContract(
        "policy.schema.json",
        mergeSyntheticRecords(examples["policy.schema.json"], {
          provider: "bedrock@1",
          model: "model@1",
        }),
      ).valid,
    ).toBe(false);
    expect(
      validateContract(
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], { outputRef: id("e") }),
      ).valid,
    ).toBe(false);
  });

  it("keeps event payload content outside immutable metadata", () => {
    expect(
      validateContract(
        "event.schema.json",
        mergeSyntheticRecords(examples["event.schema.json"], { payloadRef: "raw message content" }),
      ).valid,
    ).toBe(false);
    expect(
      validateContract(
        "event.schema.json",
        mergeSyntheticRecords(examples["event.schema.json"], {
          messageBody: "raw message content",
        }),
      ).valid,
    ).toBe(false);
  });

  it("makes the denied-provider failed outcome structurally unreachable", () => {
    expect(
      validateContract(
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], { outcome: "failed" }),
      ).valid,
    ).toBe(false);
  });

  it("rejects inherited required properties and custom prototypes", () => {
    const inherited = Object.create(examples["event.schema.json"]) as Record<string, unknown>;
    inherited.eventId = id("f");
    expect(validateContract("event.schema.json", inherited).valid).toBe(false);

    const missingOwn = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of ownDataEntries(examples["event.schema.json"])) {
      writeOwnData(missingOwn, key, value);
    }
    delete missingOwn.schemaVersion;
    expect(validateContract("event.schema.json", missingOwn).failures).toEqual(
      expect.arrayContaining([{ path: "$/schemaVersion", rule: "required" }]),
    );
  });

  it("rejects required or unknown own non-enumerable properties", () => {
    const hiddenRequired = mergeSyntheticRecords(examples["event.schema.json"]);
    Object.defineProperty(hiddenRequired, "eventId", {
      value: hiddenRequired.eventId,
      enumerable: false,
    });
    expect(validateContract("event.schema.json", hiddenRequired).failures).toEqual(
      expect.arrayContaining([{ path: "$/eventId", rule: "property:non-enumerable" }]),
    );

    const hiddenUnknown = mergeSyntheticRecords(examples["event.schema.json"]);
    Object.defineProperty(hiddenUnknown, "secret", {
      value: "hidden",
      enumerable: false,
    });
    expect(validateContract("event.schema.json", hiddenUnknown).valid).toBe(false);
  });

  it("rejects cyclic direct values and oversized arrays without reading their members", () => {
    const cyclic = mergeSyntheticRecords(examples["event.schema.json"], {
      subjectRef: {} as Record<string, unknown>,
    });
    cyclic.subjectRef.self = cyclic;
    expect(validateContract("event.schema.json", cyclic)).toEqual({
      valid: false,
      failures: [{ path: "$", rule: "input:cyclic-or-overdeep" }],
    });

    let memberReads = 0;
    const oversizedSchemas = Array.from(examples["registry.schema.json"].schemas).concat([
      requiredEntry(examples["registry.schema.json"].schemas, 0),
    ]);
    Object.defineProperty(oversizedSchemas, "0", {
      enumerable: true,
      get() {
        memberReads += 1;
        return examples["registry.schema.json"].schemas[0];
      },
    });
    const result = validateContract(
      "registry.schema.json",
      mergeSyntheticRecords(examples["registry.schema.json"], { schemas: oversizedSchemas }),
    );
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([{ path: "$/schemas", rule: "maxItems" }]),
    );
    expect(memberReads).toBe(0);
  });

  it("enforces coherent dependent semantics for every public family", () => {
    const invalidValues = [
      [
        "api.schema.json",
        mergeSyntheticRecords(examples["api.schema.json"], {
          variant: "server_response",
          outcome: "succeeded",
          errorCode: "API_POLICY_DENIED",
          contentRef: id("e"),
        }),
      ],
      [
        "api.schema.json",
        mergeSyntheticRecords(examples["api.schema.json"], {
          variant: "server_response",
          outcome: "failed",
          errorCode: "API_RESULT_PARTIAL",
        }),
      ],
      [
        "policy.schema.json",
        mergeSyntheticRecords(examples["policy.schema.json"], {
          decision: "allow",
          reasonCodes: ["RETRIEVAL_SCOPE_DENIED"],
        }),
      ],
      [
        "policy.schema.json",
        mergeSyntheticRecords(examples["policy.schema.json"], {
          decision: "deny",
          reasonCodes: ["RETRIEVAL_ALLOWED"],
        }),
      ],
      [
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], {
          variant: "result",
          decision: "invoke",
          outcome: "succeeded",
          errorCode: "PROVIDER_NONE",
          inputRef: id("e"),
        }),
      ],
      [
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], {
          variant: "result",
          decision: "invoke",
          outcome: "failed",
          errorCode: "PROVIDER_TERMINAL_FAILURE",
          inputRef: id("e"),
          outputRef: id("f"),
        }),
      ],
      [
        "task.schema.json",
        mergeSyntheticRecords(examples["task.schema.json"], {
          state: "completed",
          outcome: "failed",
          errorCode: "TASK_NONE",
          checkpointRef: id("e"),
        }),
      ],
      [
        "task.schema.json",
        mergeSyntheticRecords(examples["task.schema.json"], {
          state: "completed",
          outcome: "succeeded",
          errorCode: "TASK_NONE",
        }),
      ],
    ] as const;
    for (const [schema, value] of invalidValues) {
      expect(
        validateContract(
          schema as
            | "api.schema.json"
            | "policy.schema.json"
            | "provider.schema.json"
            | "task.schema.json",
          value,
        ).valid,
      ).toBe(false);
    }
  });

  it.each([
    "prompt",
    "content",
    "secret",
    "secretCredential",
    "providerMessage",
    "modelOutput",
    "__unexpected",
  ])("rejects forbidden or unknown top-level field %s", (field) => {
    const value = mergeSyntheticRecords(examples["event.schema.json"], {
      [field]: "do-not-retain",
    });
    expect(validateContract("event.schema.json", value).valid).toBe(false);
  });

  it("rejects unknown nested receipt fields", () => {
    const value = receipt();
    const altered = mergeSyntheticRecords(value, {
      logicalReceipt: mergeSyntheticRecords(value.logicalReceipt, {
        version_tuple: mergeSyntheticRecords(value.logicalReceipt.version_tuple, {
          latest: "unsafe@1",
        }),
      }),
    });
    expect(validateContract("receipt.schema.json", altered).valid).toBe(false);
  });

  it("rejects second-provider, failover, effectful-tool, learning, and export activation", () => {
    expect(
      validateContract(
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], {
          providerRole: "secondary",
          failover: "enabled",
        }),
      ).valid,
    ).toBe(false);
    expect(
      validateContract(
        "policy.schema.json",
        mergeSyntheticRecords(examples["policy.schema.json"], {
          effectfulTools: "enabled",
          learning: "enabled",
          export: "enabled",
        }),
      ).valid,
    ).toBe(false);
  });

  it("rejects malformed IDs, version aliases, invalid calendar dates, and uint64 overflow", () => {
    expect(
      validateContract(
        "event.schema.json",
        mergeSyntheticRecords(examples["event.schema.json"], {
          eventId: "short",
          eventRevision: "18446744073709551616",
          occurredAt: "2026-02-31T12:34:56.000Z",
        }),
      ).valid,
    ).toBe(false);
    expect(
      validateContract(
        "provider.schema.json",
        mergeSyntheticRecords(examples["provider.schema.json"], { provider: "latest" }),
      ).valid,
    ).toBe(false);
  });

  it("rejects duplicate and pollution keys before JSON materialization", () => {
    const source = JSON.stringify(examples["api.schema.json"]);
    expect(
      parseAndValidateContract(
        "api.schema.json",
        source.replace('"contractFamily":"api"', '"contractFamily":"api","contractFamily":"api"'),
      ).valid,
    ).toBe(false);
    expect(
      parseAndValidateContract(
        "api.schema.json",
        source.replace('"contractFamily":"api"', '"__proto__":{},"contractFamily":"api"'),
      ).valid,
    ).toBe(false);
  });

  it("bounds parser input and validation errors", () => {
    expect(parseAndValidateContract("api.schema.json", `"${"x".repeat(70_000)}"`).failures).toEqual(
      [{ path: "$", rule: "input:maxBytes" }],
    );
    const flooded = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`unexpected${index}`, true]),
    );
    const result = validateContract("api.schema.json", flooded);
    expect(result.valid).toBe(false);
    expect(result.failures.length).toBeLessThanOrEqual(64);
  });

  it("requires the exact registry family-to-schema bijection", () => {
    const valid = examples["registry.schema.json"];
    const schemas = valid.schemas.map((entry) => mergeSyntheticRecords(entry));
    const first = schemas[0];
    const second = schemas[1];
    if (!first || !second) throw new Error("registry fixture is incomplete");
    [first.schemaId, second.schemaId] = [second.schemaId, first.schemaId];
    expect(
      validateContract("registry.schema.json", mergeSyntheticRecords(valid, { schemas })).valid,
    ).toBe(false);
  });

  it("rejects malformed A10 applicability structures", () => {
    const base = receipt();
    const mutations = [
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
          checkpoint: {
            kind: "merkle",
            range_start: "1",
            range_end: "2",
            root: "a".repeat(64),
          },
        }),
      }),
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
          erasable_body_ref: { body_ref: id("e"), body_class: "request" },
        }),
      }),
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
          request_commitment: {
            commitment: "a".repeat(64),
            suite: "A10-REQ-COMMIT-01",
          },
        }),
      }),
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
          approval_binding: {
            required: true,
            not_required: true,
            approval_decision_id: id("e"),
            approval_revision: "1",
            approval_scope_revision: "1",
            expiry_ms: "1785328496000",
          },
        }),
      }),
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
          authorized_external_tuple: { request_id: id("e") },
        }),
      }),
    ];
    for (const mutation of mutations) {
      expect(validateContract("receipt.schema.json", mutation).valid).toBe(false);
    }
  });

  it("enforces the exact attempt stage partition", () => {
    const base = receipt();
    const tuple = base.logicalReceipt.version_tuple;
    const altered = mergeSyntheticRecords(base, {
      logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
        version_tuple: mergeSyntheticRecords(tuple, {
          attempt_stage_version: mergeSyntheticRecords(tuple.attempt_stage_version, {
            stage_discriminator: "AS4_LEASE_BOUND_EFFECT_ALLOCATED",
          }),
        }),
      }),
    });
    const result = validateContract("receipt.schema.json", altered);
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/version_tuple/attempt_version",
          rule: "attempt:stage-applicability",
        },
      ]),
    );
  });

  it("binds operation_type@revision exactly to VER17", () => {
    const base = receipt();
    for (const operation_type of ["embedding@1", "generation@2"]) {
      expect(
        validateContract(
          "receipt.schema.json",
          mergeSyntheticRecords(base, {
            logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, { operation_type }),
          }),
        ).failures,
      ).toEqual(
        expect.arrayContaining([
          {
            path: "$/logicalReceipt/operation_type",
            rule: "operation:version-binding-mismatch",
          },
        ]),
      );
    }
  });

  it("requires one exact pre-transmission policy and at most one configuration source", () => {
    const base = receipt();
    const external = externalTupleFor(base.logicalReceipt);
    for (const versionTuple of [
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        policy_versions: base.logicalReceipt.version_tuple.policy_versions.filter(
          (entry) => entry.decision_point !== "pre_transmission",
        ),
      }),
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        configuration_versions: [
          { configuration_id: id("1"), revision: "1" },
          { configuration_id: id("2"), revision: "1" },
        ],
      }),
    ]) {
      const logicalReceipt = mergeSyntheticRecords(base.logicalReceipt, {
        decision_code: "ALLOW",
        outcome_code: "SUCCEEDED",
        receipt_state: "completed",
        version_tuple: versionTuple,
        authorized_external_tuple: external,
        dispatched_external_tuple: structuredClone(external),
      });
      expect(
        validateContract("receipt.schema.json", mergeSyntheticRecords(base, { logicalReceipt }))
          .valid,
      ).toBe(false);
    }
  });

  it.each([
    ["semantic_class", "decision"],
    ["decision_code", "NOT_APPLICABLE"],
    ["outcome_code", "SUCCEEDED"],
    ["receipt_state", "accepted"],
  ] as const)("rejects a transmission receipt with contradictory %s", (field, value) => {
    const base = receipt();
    const result = validateContract(
      "receipt.schema.json",
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, { [field]: value }),
      }),
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt",
          rule: "receipt:type-applicability",
        },
      ]),
    );
  });

  it("enforces active issuance, key time windows, and receipt validity windows", () => {
    const base = receipt();
    const cases = [
      mergeSyntheticRecords(base.logicalReceipt, {
        key_lifecycle_at_issuance: mergeSyntheticRecords(
          base.logicalReceipt.key_lifecycle_at_issuance,
          { state: "verification_only" },
        ),
      }),
      mergeSyntheticRecords(base.logicalReceipt, {
        key_lifecycle_at_issuance: mergeSyntheticRecords(
          base.logicalReceipt.key_lifecycle_at_issuance,
          { activated_at_ms: "1785328496001" },
        ),
      }),
      mergeSyntheticRecords(base.logicalReceipt, {
        version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
          key_version: mergeSyntheticRecords(base.logicalReceipt.version_tuple.key_version, {
            key_valid_from_ms: "1785328496001",
          }),
        }),
      }),
      mergeSyntheticRecords(base.logicalReceipt, {
        valid_from_ms: "1785328496001",
        valid_until_ms: "1785328496000",
      }),
    ];
    for (const logicalReceipt of cases) {
      expect(
        validateContract("receipt.schema.json", mergeSyntheticRecords(base, { logicalReceipt }))
          .valid,
      ).toBe(false);
    }
  });

  it("binds BIND65 and BIND66 exactly to VER28 governance", () => {
    const base = receipt();
    const lifecycleMismatch = mergeSyntheticRecords(base.logicalReceipt, {
      key_lifecycle_at_issuance: mergeSyntheticRecords(
        base.logicalReceipt.key_lifecycle_at_issuance,
        { rotation_generation: "1" },
      ),
    });
    const issuanceViewMismatch = mergeSyntheticRecords(base.logicalReceipt, {
      issuance_key_view: "other_view@1",
    });
    for (const logicalReceipt of [lifecycleMismatch, issuanceViewMismatch]) {
      expect(
        validateContract("receipt.schema.json", mergeSyntheticRecords(base, { logicalReceipt }))
          .valid,
      ).toBe(false);
    }
  });

  it("requires canonical signature encoding and exact commitment displays", () => {
    const base = receipt();
    const nonCanonicalSignature = mergeSyntheticRecords(base, {
      signatureEnvelope: mergeSyntheticRecords(base.signatureEnvelope, {
        signature: `${"A".repeat(85)}B`,
      }),
    });
    expect(validateContract("receipt.schema.json", nonCanonicalSignature).valid).toBe(false);
    const upperCommitment = mergeSyntheticRecords(base, {
      logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
        request_commitment: {
          commitment: "A".repeat(64),
          suite: "A10-REQ-COMMIT-01",
          suite_version: "1",
          commitment_key_generation: "1",
        },
      }),
    });
    expect(validateContract("receipt.schema.json", upperCommitment).valid).toBe(false);
  });

  it.each([
    ["transmitting", null],
    ["provisional_streaming", null],
    ["completed", "SUCCEEDED"],
  ] as const)("requires an exact dispatched tuple in %s state", (receiptState, outcomeCode) => {
    const base = receipt();
    expect(
      validateContract(
        "receipt.schema.json",
        mergeSyntheticRecords(base, {
          logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
            decision_code: "ALLOW",
            outcome_code: outcomeCode,
            receipt_state: receiptState,
          }),
        }),
      ).failures,
    ).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/dispatched_external_tuple",
          rule: "dispatch:required-for-state",
        },
      ]),
    );
  });

  it.each([
    "cancelled",
    "failed",
  ])("distinguishes pre-dispatch and post-dispatch terminal %s", (receiptState) => {
    const base = receipt();
    const external = externalTupleFor(base.logicalReceipt);
    const preDispatch = mergeSyntheticRecords(base, {
      logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
        receipt_state: receiptState,
        outcome_code: "NO_EFFECT",
        authorized_external_tuple: external,
        dispatched_external_tuple: null,
      }),
    });
    expect(validateContract("receipt.schema.json", preDispatch).valid).toBe(true);
    const postDispatchLogical = mergeSyntheticRecords(preDispatch.logicalReceipt, {
      version_tuple: mergeSyntheticRecords(preDispatch.logicalReceipt.version_tuple, {
        attempt_version: mergeSyntheticRecords(
          preDispatch.logicalReceipt.version_tuple.attempt_version,
          { lease_generation: "1" },
        ),
        attempt_stage_version: mergeSyntheticRecords(
          preDispatch.logicalReceipt.version_tuple.attempt_stage_version,
          { stage_discriminator: "AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT" as const },
        ),
      }),
    });
    expect(
      validateContract(
        "receipt.schema.json",
        mergeSyntheticRecords(preDispatch, {
          logicalReceipt: mergeSyntheticRecords(postDispatchLogical, {
            outcome_code: "POSSIBLE_EFFECT",
            authorized_external_tuple: externalTupleFor(
              postDispatchLogical as unknown as ReturnType<typeof receipt>["logicalReceipt"],
            ),
          }),
        }),
      ).failures,
    ).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/dispatched_external_tuple",
          rule: "dispatch:required-for-state",
        },
      ]),
    );
  });

  it("uses an AS4 attempt stage as post-dispatch evidence for a terminal receipt", () => {
    const base = receipt();
    const logicalReceipt = mergeSyntheticRecords(base.logicalReceipt, {
      receipt_state: "failed",
      outcome_code: "POSSIBLE_EFFECT",
      version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        attempt_version: mergeSyntheticRecords(base.logicalReceipt.version_tuple.attempt_version, {
          lease_generation: "1",
          effect_fence: "1",
        }),
        attempt_stage_version: mergeSyntheticRecords(
          base.logicalReceipt.version_tuple.attempt_stage_version,
          { stage_discriminator: "AS4_LEASE_BOUND_EFFECT_ALLOCATED" },
        ),
      }),
    });
    const authorized = externalTupleFor(
      logicalReceipt as unknown as ReturnType<typeof receipt>["logicalReceipt"],
    );
    const result = validateContract(
      "receipt.schema.json",
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(logicalReceipt, {
          authorized_external_tuple: authorized,
        }),
      }),
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/dispatched_external_tuple",
          rule: "dispatch:required-for-state",
        },
      ]),
    );
  });

  it("uses only the closed dispatch-attempt evidence fact, never generic runtime evidence", () => {
    const base = receipt();
    const withEvidenceType = (evidenceType: "runtime" | "dispatch_attempt") => {
      const logicalReceipt = mergeSyntheticRecords(base.logicalReceipt, {
        receipt_state: "failed",
        outcome_code: "NO_EFFECT",
        evidence_refs: base.logicalReceipt.evidence_refs.map((entry) =>
          mergeSyntheticRecords(entry, { evidence_type: evidenceType }),
        ),
        version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
          evidence_versions: base.logicalReceipt.version_tuple.evidence_versions.map((entry) =>
            mergeSyntheticRecords(entry, { evidence_type: evidenceType }),
          ),
        }),
      });
      return mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(logicalReceipt, {
          authorized_external_tuple: externalTupleFor(
            logicalReceipt as unknown as ReturnType<typeof receipt>["logicalReceipt"],
          ),
        }),
      });
    };
    expect(validateContract("receipt.schema.json", withEvidenceType("runtime")).valid).toBe(true);
    expect(
      validateContract("receipt.schema.json", withEvidenceType("dispatch_attempt")).failures,
    ).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/dispatched_external_tuple",
          rule: "dispatch:required-for-state",
        },
      ]),
    );
  });

  it("allows authorized state before dispatch with key 58 typed null", () => {
    const base = receipt();
    const external = externalTupleFor(base.logicalReceipt);
    expect(
      validateContract(
        "receipt.schema.json",
        mergeSyntheticRecords(base, {
          logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
            receipt_type: "authorization",
            semantic_class: "authority",
            decision_code: "ALLOW",
            receipt_state: "authorized",
            authorized_external_tuple: external,
            dispatched_external_tuple: null,
          }),
        }),
      ).valid,
    ).toBe(true);
  });

  it("binds the complete dispatched tuple and its duplicated version facts", () => {
    const base = receipt();
    const external = externalTupleFor(base.logicalReceipt);
    const terminal = mergeSyntheticRecords(base, {
      logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
        decision_code: "ALLOW",
        outcome_code: "SUCCEEDED",
        receipt_state: "completed",
        authorized_external_tuple: external,
        dispatched_external_tuple: structuredClone(external),
      }),
    });
    expect(validateContract("receipt.schema.json", terminal).valid).toBe(true);

    const stale = structuredClone(terminal);
    stale.logicalReceipt.authorized_external_tuple.tenant_authorization_epoch = "2";
    stale.logicalReceipt.dispatched_external_tuple.tenant_authorization_epoch = "2";
    expect(validateContract("receipt.schema.json", stale).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "external:version-binding-mismatch" }),
      ]),
    );

    const dispatchSubstitution = structuredClone(terminal);
    dispatchSubstitution.logicalReceipt.dispatched_external_tuple.credential_selector_id_and_revision.selector_revision =
      "2";
    expect(validateContract("receipt.schema.json", dispatchSubstitution).failures).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/dispatched_external_tuple",
          rule: "dispatch:authorization-mismatch",
        },
      ]),
    );
  });

  it("preserves two distinct source IDs that share one revision value", () => {
    const base = receipt();
    const secondSourceRef = {
      source_type: "event",
      source_id: id("a"),
      source_revision: "1",
    } as const;
    const secondSourceVersion = {
      source_type: "event",
      source_id: id("a"),
      revision_id: "1",
      valid_from_ms: "1785328496000",
      valid_until_ms: null,
      system_time_ms: "1785328496000",
    } as const;
    const logicalReceipt = mergeSyntheticRecords(base.logicalReceipt, {
      source_refs: Array.from(base.logicalReceipt.source_refs).concat([secondSourceRef]),
      version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        source_versions: Array.from(base.logicalReceipt.version_tuple.source_versions).concat([
          secondSourceVersion,
        ]),
      }),
    });
    const external = externalTupleFor(logicalReceipt);
    expect(external.source_and_evidence_revision_sets.source_revisions).toEqual([
      { source_id: id("8"), revision: "1" },
      { source_id: id("a"), revision: "1" },
    ]);
    expect(
      validateContract(
        "receipt.schema.json",
        mergeSyntheticRecords(base, {
          logicalReceipt: mergeSyntheticRecords(logicalReceipt, {
            decision_code: "ALLOW",
            outcome_code: "SUCCEEDED",
            receipt_state: "completed",
            authorized_external_tuple: external,
            dispatched_external_tuple: structuredClone(external),
          }),
        }),
      ).valid,
    ).toBe(true);
  });

  it("requires exact bidirectional logical-to-VER04/05 source and evidence coverage", () => {
    const base = receipt();
    const mutations = [
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, { source_versions: [] }),
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        source_versions: Array.from(base.logicalReceipt.version_tuple.source_versions).concat([
          mergeSyntheticRecords(
            requiredEntry(base.logicalReceipt.version_tuple.source_versions, 0),
            {
              source_id: id("a"),
            },
          ),
        ]),
      }),
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        source_versions: Array.from(base.logicalReceipt.version_tuple.source_versions).concat([
          mergeSyntheticRecords(
            requiredEntry(base.logicalReceipt.version_tuple.source_versions, 0),
            {
              system_time_ms: "1785328496001",
            },
          ),
        ]),
      }),
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, { evidence_versions: [] }),
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        evidence_versions: Array.from(base.logicalReceipt.version_tuple.evidence_versions).concat([
          mergeSyntheticRecords(
            requiredEntry(base.logicalReceipt.version_tuple.evidence_versions, 0),
            {
              evidence_id: id("a"),
            },
          ),
        ]),
      }),
      mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
        evidence_versions: Array.from(base.logicalReceipt.version_tuple.evidence_versions).concat([
          mergeSyntheticRecords(
            requiredEntry(base.logicalReceipt.version_tuple.evidence_versions, 0),
            {
              verifier_class: "system",
            },
          ),
        ]),
      }),
    ];
    for (const version_tuple of mutations) {
      expect(
        validateContract(
          "receipt.schema.json",
          mergeSyntheticRecords(base, {
            logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, { version_tuple }),
          }),
        ).valid,
      ).toBe(false);
    }
  });

  it("enforces independent key57 authorization applicability", () => {
    const base = receipt();
    const external = externalTupleFor(base.logicalReceipt);
    const result = validateContract(
      "receipt.schema.json",
      mergeSyntheticRecords(base, {
        logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
          receipt_type: "decision",
          semantic_class: "decision",
          decision_code: "ALLOW",
          outcome_code: null,
          receipt_state: "accepted",
          authorized_external_tuple: external,
        }),
      }),
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        {
          path: "$/logicalReceipt/authorized_external_tuple",
          rule: "authorization:forbidden-for-rule",
        },
      ]),
    );
  });

  it("makes AS3 dispatch universal for optional and forbidden dispatch rules", () => {
    const base = receipt();
    const as3 = mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
      attempt_version: mergeSyntheticRecords(base.logicalReceipt.version_tuple.attempt_version, {
        lease_generation: "1",
      }),
      attempt_stage_version: mergeSyntheticRecords(
        base.logicalReceipt.version_tuple.attempt_stage_version,
        { stage_discriminator: "AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT" as const },
      ),
    });
    const authorizationLogical = mergeSyntheticRecords(base.logicalReceipt, {
      receipt_type: "authorization",
      semantic_class: "authority",
      decision_code: "ALLOW",
      receipt_state: "authorized",
      version_tuple: as3,
    });
    const authorized = externalTupleFor(
      authorizationLogical as unknown as ReturnType<typeof receipt>["logicalReceipt"],
    );
    expect(
      validateContract(
        "receipt.schema.json",
        mergeSyntheticRecords(base, {
          logicalReceipt: mergeSyntheticRecords(authorizationLogical, {
            authorized_external_tuple: authorized,
          }),
        }),
      ).failures,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "dispatch:required-for-state" })]),
    );

    const decision = mergeSyntheticRecords(base.logicalReceipt, {
      receipt_type: "decision",
      semantic_class: "decision",
      decision_code: "ALLOW",
      receipt_state: "accepted",
      version_tuple: as3,
    });
    expect(
      validateContract(
        "receipt.schema.json",
        mergeSyntheticRecords(base, { logicalReceipt: decision }),
      ).failures,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "dispatch:stage-rule-conflict" })]),
    );
  });

  it("rejects equal authorization-and-dispatch substitution of every external field", () => {
    const base = receipt();
    const external = externalTupleFor(base.logicalReceipt);
    const activeMemoryMutation = [
      {
        memory_id: id("e"),
        memory_revision: "1",
        activation_decision_id: id("f"),
        activation_decision_revision: "1",
        source_revision_ids: [id("a")],
        deletion_epoch: "0",
        lifecycle_fence: "1",
      },
    ];
    const alternatives: Record<keyof typeof external, unknown> = {
      request_id: id("f"),
      request_commitment: {
        commitment: "a".repeat(64),
        suite: "A10-REQ-COMMIT-01",
        suite_version: "request-commitment@1",
        commitment_key_generation: "1",
      },
      tenant_id: id("f"),
      tenant_authorization_epoch: "2",
      principal_id_or_system_origin_id: id("f"),
      origin_mode: "system_originated",
      purpose_id: "continuity.status",
      purpose_policy_revision: "2",
      operation_id: id("f"),
      operation_type_and_version: "embedding@1",
      lane_id: id("e"),
      capsule_id_or_none: id("e"),
      attempt_id: id("e"),
      attempt_ordinal: "2",
      idempotency_id: id("e"),
      claim_fence: "2",
      lease_generation: "1",
      effect_fence: "1",
      attempt_stage_version: mergeSyntheticRecords(external.attempt_stage_version, {
        operation_schema_revision: "2",
      }),
      workload_id_and_revision: mergeSyntheticRecords(external.workload_id_and_revision, {
        workload_revision: "2",
      }),
      source_and_evidence_revision_sets: {
        source_revisions: [{ source_id: id("8"), revision: "2" }],
        evidence_revisions: [{ evidence_id: id("9"), revision: "1" }],
      },
      active_memory_revisions: activeMemoryMutation,
      tool_intent_binding_or_none: {
        intent_id: id("e"),
        intent_revision: "1",
        tool_class: "managed_mcp_read",
        operation_class: "receipt_summary",
        argument_body_ref: id("f"),
        argument_body_revision: "1",
        destination_class: "managed_mcp_same_tenant_read",
        risk_class: "read_only",
        scope_limit_revision: "1",
      },
      approval_binding: mergeSyntheticRecords(external.approval_binding, { policy_revision: "2" }),
      policy_and_configuration_versions: {
        policy_revision: "2",
        configuration_revision: null,
      },
      compiler_retrieval_embedding_cache_index_simulation_versions: mergeSyntheticRecords(
        external.compiler_retrieval_embedding_cache_index_simulation_versions,
        { compiler_revision: "1" },
      ),
      adapter_provider_model_destination_and_parameter_versions: mergeSyntheticRecords(
        external.adapter_provider_model_destination_and_parameter_versions,
        { provider_revision: "2", destination_revision: "2" },
      ),
      request_schema_and_contract_versions: mergeSyntheticRecords(
        external.request_schema_and_contract_versions,
        { request_schema_revision: "2" },
      ),
      deletion_and_revision_epochs: mergeSyntheticRecords(external.deletion_and_revision_epochs, {
        deletion_epoch: "1",
      }),
      lifecycle_hold_and_disposition_fences: mergeSyntheticRecords(
        external.lifecycle_hold_and_disposition_fences,
        { lifecycle_fence: "2" },
      ),
      authorization_decision_id_and_revision: mergeSyntheticRecords(
        external.authorization_decision_id_and_revision,
        { decision_revision: "2" },
      ),
      credential_selector_id_and_revision: mergeSyntheticRecords(
        external.credential_selector_id_and_revision,
        { selector_revision: "2" },
      ),
      effect_reservation_id_or_none: id("e"),
    };
    expect(ownDataKeys(alternatives)).toHaveLength(33);
    for (const [field, replacement] of ownDataEntries(alternatives)) {
      const authorized = structuredClone(external) as Record<string, unknown>;
      const dispatched = structuredClone(external) as Record<string, unknown>;
      writeOwnData(authorized, field, replacement);
      writeOwnData(dispatched, field, structuredClone(replacement));
      expect(
        validateContract(
          "receipt.schema.json",
          mergeSyntheticRecords(base, {
            logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
              receipt_state: "completed",
              authorized_external_tuple: authorized,
              dispatched_external_tuple: dispatched,
            }),
          }),
        ).valid,
        field,
      ).toBe(false);
    }
    for (const nestedField of [
      "adapter_revision",
      "provider_revision",
      "model_revision",
      "destination_revision",
      "parameter_revision",
    ] as const) {
      const authorized = structuredClone(external);
      const dispatched = structuredClone(external);
      writeOwnData(
        authorized.adapter_provider_model_destination_and_parameter_versions,
        nestedField,
        "2",
      );
      writeOwnData(
        dispatched.adapter_provider_model_destination_and_parameter_versions,
        nestedField,
        "2",
      );
      expect(
        validateContract(
          "receipt.schema.json",
          mergeSyntheticRecords(base, {
            logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
              receipt_state: "completed",
              authorized_external_tuple: authorized,
              dispatched_external_tuple: dispatched,
            }),
          }),
        ).valid,
        nestedField,
      ).toBe(false);
    }
    for (const nestedField of ["selector_id", "selector_revision"] as const) {
      const authorized = structuredClone(external);
      const dispatched = structuredClone(external);
      writeOwnData(
        authorized.credential_selector_id_and_revision,
        nestedField,
        nestedField === "selector_id" ? id("f") : "2",
      );
      writeOwnData(
        dispatched.credential_selector_id_and_revision,
        nestedField,
        nestedField === "selector_id" ? id("f") : "2",
      );
      expect(
        validateContract(
          "receipt.schema.json",
          mergeSyntheticRecords(base, {
            logicalReceipt: mergeSyntheticRecords(base.logicalReceipt, {
              receipt_state: "completed",
              authorized_external_tuple: authorized,
              dispatched_external_tuple: dispatched,
            }),
          }),
        ).valid,
        nestedField,
      ).toBe(false);
    }
  });

  it("keeps receipt identities and owner roles independent", () => {
    const base = receipt();
    const invalidLogicalReceipts: Array<Readonly<Record<string, unknown>>> = [
      mergeSyntheticRecords(base.logicalReceipt, { capsule_id: base.logicalReceipt.issuer_id }),
      mergeSyntheticRecords(base.logicalReceipt, {
        erasable_body_ref: {
          body_ref: base.logicalReceipt.request_id,
          body_revision: "1",
          body_class: "response",
        },
      }),
      mergeSyntheticRecords(base.logicalReceipt, {
        signing_key_owner_id: base.logicalReceipt.issuer_id,
        version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
          key_governance_version: mergeSyntheticRecords(
            base.logicalReceipt.version_tuple.key_governance_version,
            { signing_key_owner_id: base.logicalReceipt.issuer_id },
          ),
        }),
      }),
      mergeSyntheticRecords(base.logicalReceipt, {
        signing_key_owner_id: base.logicalReceipt.principal_id,
        version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
          key_governance_version: mergeSyntheticRecords(
            base.logicalReceipt.version_tuple.key_governance_version,
            { signing_key_owner_id: base.logicalReceipt.principal_id },
          ),
        }),
      }),
    ];
    for (const role of ["verifier_id", "custodian_id", "policy_owner_id"] as const) {
      invalidLogicalReceipts.push(
        mergeSyntheticRecords(base.logicalReceipt, {
          signing_key_owner_id: readOwnData(
            base.logicalReceipt.version_tuple.key_governance_version,
            String(role),
          ),
          version_tuple: mergeSyntheticRecords(base.logicalReceipt.version_tuple, {
            key_governance_version: mergeSyntheticRecords(
              base.logicalReceipt.version_tuple.key_governance_version,
              {
                signing_key_owner_id: readOwnData(
                  base.logicalReceipt.version_tuple.key_governance_version,
                  String(role),
                ),
              },
            ),
          }),
        }),
      );
    }
    for (const logicalReceipt of invalidLogicalReceipts) {
      expect(
        validateContract("receipt.schema.json", mergeSyntheticRecords(base, { logicalReceipt }))
          .valid,
      ).toBe(false);
    }
  });

  it("enforces receipt binding, identity, genesis, ordering, and detached-envelope rules", () => {
    const value = receipt();
    const altered = mergeSyntheticRecords(value, {
      tenantId: id("f"),
      logicalReceipt: mergeSyntheticRecords(value.logicalReceipt, {
        request_id: value.logicalReceipt.receipt_id,
        sequence: "2",
        limitation_codes: ["SCOPE_LIMITED", "BODY_UNAVAILABLE"],
      }),
      signatureEnvelope: mergeSyntheticRecords(value.signatureEnvelope, { receipt_id: id("f") }),
    });
    const result = validateContract("receipt.schema.json", altered);
    expect(result.valid).toBe(false);
    expect(result.failures.map(({ rule }) => rule)).toEqual(
      expect.arrayContaining([
        "binding:mismatch",
        "identity:reuse",
        "sequence:predecessor-required",
        "canonical:sorted-unique",
      ]),
    );
  });
});

describe("same-version compatibility", () => {
  const original = contractSchemaCatalog["event.schema.json"];
  const directionalCompatibility = (
    previous: unknown,
    candidate: unknown,
    previousSemantics: unknown = contractSemanticProfile,
    candidateSemantics: unknown = contractSemanticProfile,
  ) =>
    checkOldProducerToNewConsumerCompatibility(
      previous,
      candidate,
      previousSemantics,
      candidateSemantics,
    );

  it("exposes an immutable generated catalog", () => {
    expect(Object.isFrozen(contractSchemaCatalog)).toBe(true);
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(original.properties)).toBe(true);
  });

  it("accepts an unchanged same-version schema", () => {
    expect(
      checkSameVersionCompatibility(
        original,
        structuredClone(original),
        contractSemanticProfile,
        structuredClone(contractSemanticProfile),
      ),
    ).toEqual({
      compatible: true,
      issues: [],
    });
  });

  it("treats semantic-profile drift as same-version identity drift", () => {
    const changedSemantics = structuredClone(contractSemanticProfile) as {
      families: { event: { semanticRule: string } };
    };
    changedSemantics.families.event.semanticRule = "attacker_relaxed_metadata";
    expect(
      checkSameVersionCompatibility(
        original,
        structuredClone(original),
        contractSemanticProfile,
        changedSemantics,
      ),
    ).toEqual({
      compatible: false,
      issues: [{ path: "$semanticProfile", rule: "changed:semantic-profile" }],
    });
    expect(
      checkSameVersionCompatibility(original, structuredClone(original), undefined, undefined)
        .compatible,
    ).toBe(false);
  });

  it("forbids all directional structural additions", () => {
    const candidate = structuredClone(original) as Record<string, unknown>;
    candidate.$id = "urn:zintus-continuity:contracts:v2:event";
    const properties = candidate.properties as Record<string, unknown>;
    properties.optionalTraceCode = { const: "TRACE_V2" };
    expect(directionalCompatibility(original, candidate).compatible).toBe(false);

    candidate.required = Array.from(candidate.required as string[]).concat(["optionalTraceCode"]);
    expect(directionalCompatibility(original, candidate).compatible).toBe(false);
  });

  it("recognizes the immediate next version of every bound contract family", () => {
    for (const name of [
      "api.schema.json",
      "event.schema.json",
      "policy.schema.json",
      "provider.schema.json",
      "receipt.schema.json",
      "registry.schema.json",
      "task.schema.json",
    ] as const) {
      const previous = readOwnData(contractSchemaCatalog, String(name));
      const candidate = structuredClone(previous) as Record<string, unknown>;
      candidate.$id = String(candidate.$id).replace(":v1:", ":v2:");
      expect(directionalCompatibility(previous, candidate).compatible).toBe(true);
    }
  });

  it("requires an exact valid semantic profile for directional compatibility", () => {
    const candidate = structuredClone(original) as Record<string, unknown>;
    candidate.$id = "urn:zintus-continuity:contracts:v2:event";
    const changed = structuredClone(contractSemanticProfile) as {
      families: { event: { semanticRule: string } };
    };
    changed.families.event.semanticRule = "relaxed";
    expect(
      directionalCompatibility(original, candidate, contractSemanticProfile, changed).compatible,
    ).toBe(false);
    expect(
      checkOldProducerToNewConsumerCompatibility(original, candidate, undefined, undefined)
        .compatible,
    ).toBe(false);
  });

  it("rejects nested dialect IDs, nested schemas, and reference siblings", () => {
    for (const mutate of [
      (property: Record<string, unknown>) => {
        property.$id = "urn:attacker:nested";
      },
      (property: Record<string, unknown>) => {
        property.$schema = "https://json-schema.org/draft/2020-12/schema";
      },
      (property: Record<string, unknown>) => {
        property.description = "unchecked sibling";
      },
    ]) {
      const candidate = structuredClone(original) as Record<string, unknown>;
      candidate.$id = "urn:zintus-continuity:contracts:v2:event";
      const property = (candidate.properties as Record<string, Record<string, unknown>>).eventId;
      if (!property) throw new Error("event schema lacks eventId");
      mutate(property);
      expect(directionalCompatibility(original, candidate).compatible).toBe(false);
    }
  });

  it.each([
    ["cross-family ID", "urn:zintus-continuity:contracts:v2:policy", undefined],
    ["arbitrary ID", "https://attacker.invalid/event/v2", undefined],
    ["skipped version", "urn:zintus-continuity:contracts:v3:event", undefined],
    ["huge version", `urn:zintus-continuity:contracts:v${"9".repeat(256)}:event`, undefined],
    ["missing dialect", "urn:zintus-continuity:contracts:v2:event", null],
    [
      "attacker dialect",
      "urn:zintus-continuity:contracts:v2:event",
      "https://attacker.invalid/schema",
    ],
  ])("rejects %s during directional compatibility", (_label, nextId, nextDialect) => {
    const candidate = structuredClone(original) as Record<string, unknown>;
    candidate.$id = nextId;
    if (nextDialect === null) delete candidate.$schema;
    if (typeof nextDialect === "string") candidate.$schema = nextDialect;
    expect(directionalCompatibility(original, candidate).compatible).toBe(false);
  });

  it("rejects authority-bearing, open, referenced, and recursively unsafe additions", () => {
    for (const addition of [
      { optionalMode: { const: "admin" } },
      { optionalMode: { const: "super_admin_role" } },
      {
        optionalDetails: {
          type: "object",
          additionalProperties: true,
          properties: {},
          required: [],
        },
      },
      {
        optionalTrace: {
          $ref: "./envelope.schema.json#/$defs/identifier",
        },
      },
      {
        optionalTraceCode: {
          const: "TRACE_V2",
          attackerKeyword: "ignored-by-weak-checkers",
        },
      },
      {
        optionalTraceCode: {
          type: "string",
          minLength: 4,
          maxLength: 2,
          pattern: "^[A-Z]+$",
        },
      },
      {
        optionalTraceCode: {
          type: "string",
          minLength: 1,
          maxLength: 12,
          pattern: "[",
        },
      },
      {
        optionalTraceCode: {
          enum: ["TRACE_V2", "TRACE_V2"],
        },
      },
      {
        optionalDetails: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 32, pattern: "^[a-z]+$" },
          },
        },
      },
    ]) {
      const candidate = structuredClone(original) as Record<string, unknown>;
      candidate.$id = "urn:zintus-continuity:contracts:v2:event";
      for (const [key, value] of ownDataEntries(addition)) {
        writeOwnData(candidate.properties as Record<string, unknown>, key, value);
      }
      expect(directionalCompatibility(original, candidate).compatible).toBe(false);
    }
  });

  it("rejects candidate-only combinators, items, and nested property maps", () => {
    for (const mutate of [
      (candidate: Record<string, unknown>) => {
        const eventId = (candidate.properties as Record<string, Record<string, unknown>>).eventId;
        if (eventId) eventId.anyOf = [{ const: id("1") }, { const: id("2") }];
      },
      (candidate: Record<string, unknown>) => {
        candidate.items = { const: "attacker" };
      },
      (candidate: Record<string, unknown>) => {
        const eventType = (candidate.properties as Record<string, Record<string, unknown>>)
          .eventType;
        if (eventType) {
          eventType.properties = {
            role: { const: "admin" },
          };
        }
      },
    ]) {
      const candidate = structuredClone(original) as Record<string, unknown>;
      candidate.$id = "urn:zintus-continuity:contracts:v2:event";
      mutate(candidate);
      expect(directionalCompatibility(original, candidate).compatible).toBe(false);
    }
  });

  it("rejects a custom prototype anywhere in a candidate schema", () => {
    const candidate = structuredClone(original) as Record<string, unknown>;
    candidate.$id = "urn:zintus-continuity:contracts:v2:event";
    const properties = candidate.properties as Record<string, unknown>;
    const eventId = properties.eventId;
    if (typeof eventId !== "object" || eventId === null) throw new Error("missing event ID");
    properties.eventId = Object.create(eventId);
    expect(directionalCompatibility(original, candidate).compatible).toBe(false);
  });

  it("rejects an out-of-range previous version and apparent rollback", () => {
    const previous = structuredClone(original) as Record<string, unknown>;
    previous.$id = `urn:zintus-continuity:contracts:v${"9".repeat(256)}:event`;
    const candidate = structuredClone(original) as Record<string, unknown>;
    expect(directionalCompatibility(previous, candidate).compatible).toBe(false);
  });

  it("rejects missing, changed, or newly injected shared definitions", () => {
    const previous = structuredClone(original) as Record<string, unknown>;
    previous.$defs = { traceCode: { const: "TRACE_V1" } };
    for (const definitions of [
      undefined,
      { traceCode: { const: "TRACE_V2" } },
      { traceCode: { const: "TRACE_V1" }, attacker: { const: "ADMIN" } },
    ]) {
      const candidate = structuredClone(previous);
      candidate.$id = "urn:zintus-continuity:contracts:v2:event";
      if (definitions === undefined) delete candidate.$defs;
      else candidate.$defs = definitions;
      expect(directionalCompatibility(previous, candidate).compatible).toBe(false);
    }
  });

  it.each([
    "enum",
    "required",
    "type",
    "limit",
    "authority",
    "property",
  ])("fails closed on %s changes", (change) => {
    const candidate = structuredClone(original) as Record<string, unknown>;
    const properties = candidate.properties as Record<string, Record<string, unknown>>;
    const eventType = properties.eventType;
    const eventId = properties.eventId;
    const contractFamily = properties.contractFamily;
    if (!eventType || !eventId || !contractFamily) throw new Error("fixture schema is incomplete");
    if (change === "enum") eventType.enum = ["interaction.appended", "unsafe"];
    if (change === "required")
      candidate.required = Array.from(candidate.required as string[]).concat(["errorCode"]);
    if (change === "type") eventId.type = "integer";
    if (change === "limit") eventId.maxLength = 1024;
    if (change === "authority") contractFamily.const = "admin";
    if (change === "property") {
      properties.optionalAuthority = {
        $ref: "./envelope.schema.json#/$defs/identifier",
      };
    }
    expect(
      checkSameVersionCompatibility(
        original,
        candidate,
        contractSemanticProfile,
        contractSemanticProfile,
      ).compatible,
    ).toBe(false);
  });
});

describe("A10 receipt conformance map", () => {
  const receiptSchema = contractSchemaCatalog["receipt.schema.json"] as unknown as {
    properties: {
      logicalReceipt: {
        required: readonly string[];
        properties: Record<string, Record<string, unknown>>;
      };
    };
  };
  const logical = receiptSchema.properties.logicalReceipt;

  it("maps every A10 BIND logical field and no reserved 43-48 field", () => {
    const expected = [
      "envelope_type",
      "receipt_schema",
      "receipt_id",
      "receipt_type",
      "profile_id",
      "environment_id",
      "chain_id",
      "tenant_id",
      "principal_id",
      "origin_mode",
      "purpose_id",
      "operation_id",
      "operation_type",
      "lane_id",
      "capsule_id",
      "attempt_id",
      "attempt_ordinal",
      "idempotency_id",
      "semantic_class",
      "decision_code",
      "outcome_code",
      "receipt_state",
      "limitation_codes",
      "issued_at_ms",
      "valid_from_ms",
      "valid_until_ms",
      "source_refs",
      "evidence_refs",
      "version_tuple",
      "sequence",
      "predecessor_receipt_id",
      "predecessor_signature_commitment",
      "checkpoint",
      "signature_suite",
      "signing_key_id",
      "issuer_id",
      "verifier_policy_id",
      "lifecycle_binding",
      "supersedes_receipt_ids",
      "projection_hint",
      "erasable_body_ref",
      "scope_commitments",
      "request_id",
      "request_commitment",
      "active_memory_revisions",
      "tool_intent_binding",
      "approval_binding",
      "signing_key_owner_id",
      "key_lifecycle_at_issuance",
      "issuance_key_view",
      "authorized_external_tuple",
      "dispatched_external_tuple",
    ];
    expect(Array.from(logical.required).sort()).toEqual(expected.sort());
  });

  it("maps all VER01 through VER29 fields", () => {
    const versionTuple = logical.properties.version_tuple as unknown as {
      required: readonly string[];
    };
    expect(Array.from(versionTuple.required).sort()).toEqual(
      [
        "tenant_scope",
        "purpose_scope",
        "object_versions",
        "source_versions",
        "evidence_versions",
        "schema_versions",
        "receipt_format_version",
        "policy_versions",
        "configuration_versions",
        "compiler_version",
        "retrieval_version",
        "provider_model_version",
        "embedding_version",
        "cache_version",
        "index_version",
        "simulation_version",
        "operation_version",
        "attempt_version",
        "algorithm_version",
        "key_version",
        "lifecycle_version",
        "environment_version",
        "chain_version",
        "verifier_policy_version",
        "request_version",
        "active_memory_version",
        "intent_approval_version",
        "key_governance_version",
        "attempt_stage_version",
      ].sort(),
    );
  });

  it("uses exact A10 semantic classes, receipt states, and six-field attempt maps", () => {
    expect((logical.properties.semantic_class as { enum: readonly string[] }).enum).toEqual([
      "fact",
      "claim",
      "evidence",
      "result",
      "limitation",
      "decision",
      "authority",
      "approval",
      "capability",
      "receipt",
      "artifact",
      "runtime_outcome",
    ]);
    expect((logical.properties.receipt_state as { enum: readonly string[] }).enum).toEqual([
      "accepted",
      "supported",
      "limited",
      "unknown",
      "invalid",
      "authorized",
      "transmitting",
      "provisional_streaming",
      "completed",
      "cancelled",
      "failed",
      "superseded",
      "deleted_tombstoned",
      "body_unavailable",
    ]);
    const versionTuple = logical.properties.version_tuple as unknown as {
      properties: {
        attempt_version: { required: readonly string[] };
        attempt_stage_version: { required: readonly string[] };
        key_governance_version: { required: readonly string[] };
      };
    };
    expect(versionTuple.properties.attempt_version.required).toEqual([
      "attempt_id",
      "attempt_ordinal",
      "idempotency_id",
      "claim_fence",
      "lease_generation",
      "effect_fence",
    ]);
    expect(versionTuple.properties.attempt_stage_version.required).toEqual([
      "stage_schema_id",
      "stage_schema_revision",
      "stage_discriminator",
      "idempotency_mode",
      "operation_schema_id",
      "operation_schema_revision",
    ]);
    expect(versionTuple.properties.key_governance_version.required).toEqual([
      "signing_key_owner_id",
      "verifier_id",
      "custodian_id",
      "policy_owner_id",
      "lifecycle_policy_revision",
      "rotation_generation",
      "revocation_generation",
      "issuance_view_id",
      "issuance_view_revision",
      "verifier_current_view_policy_revision",
    ]);
  });

  it("maps the full ordered external authorization tuple", () => {
    const external = contractSchemaCatalog["envelope.schema.json"].$defs.externalTuple;
    expect(external.required).toHaveLength(33);
    expect(external.required[0]).toBe("request_id");
    expect(external.required.at(-1)).toBe("effect_reservation_id_or_none");
  });
});

describe("opaque TypeScript identities", () => {
  it("keeps independently branded ID fields non-substitutable", () => {
    const tenant = id("1") as OpaqueId<"tenantId">;
    const receiptId = id("2") as OpaqueId<"receipt_id">;
    expect(tenant).not.toBe(receiptId);
    // @ts-expect-error receipt identity is not a tenant identity
    const invalid: OpaqueId<"tenantId"> = receiptId;
    expect(invalid).toBe(receiptId);
  });
});
