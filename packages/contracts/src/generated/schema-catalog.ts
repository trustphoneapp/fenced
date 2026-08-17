/** Generated deterministically from schemas/v1 plus semantics/v1 by scripts/verify-contracts.mjs. */
const generatedSchemaCatalog = {
  "api.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:api",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "clientRequestId": {
            "$ref": "./envelope.schema.json#/$defs/clientToken"
          },
          "contractFamily": {
            "const": "api"
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "route": {
            "enum": [
              "continuity.respond",
              "continuity.status"
            ]
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "variant": {
            "const": "untrusted_ingress"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "variant",
          "clientRequestId",
          "requestedPurpose",
          "route"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "contractFamily": {
            "const": "api"
          },
          "messageId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "messageRevision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "route": {
            "enum": [
              "continuity.respond",
              "continuity.status"
            ]
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "variant": {
            "const": "server_admitted_request"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "variant",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "messageId",
          "messageRevision",
          "route"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "contentRef": {
            "$ref": "./envelope.schema.json#/$defs/reference"
          },
          "contractFamily": {
            "const": "api"
          },
          "errorCode": {
            "enum": [
              "API_NONE",
              "API_POLICY_DENIED",
              "API_REQUEST_INVALID",
              "API_RESULT_PARTIAL",
              "API_RESULT_UNAVAILABLE"
            ]
          },
          "messageId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "messageRevision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "outcome": {
            "enum": [
              "denied",
              "failed",
              "partial",
              "succeeded",
              "unknown"
            ]
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "route": {
            "enum": [
              "continuity.respond",
              "continuity.status"
            ]
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "variant": {
            "const": "server_response"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "variant",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "messageId",
          "messageRevision",
          "route",
          "outcome",
          "errorCode"
        ],
        "type": "object"
      }
    ],
    "title": "Continuity disjoint public API metadata v1"
  },
  "envelope.schema.json": {
    "$defs": {
      "clientToken": {
        "maxLength": 96,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        "type": "string"
      },
      "dateTime": {
        "format": "date-time",
        "maxLength": 24,
        "minLength": 24,
        "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
        "type": "string"
      },
      "externalTuple": {
        "additionalProperties": false,
        "properties": {
          "active_memory_revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "activation_decision_id": {
                  "$ref": "./envelope.schema.json#/$defs/identifier"
                },
                "activation_decision_revision": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "deletion_epoch": {
                  "$ref": "./envelope.schema.json#/$defs/uint64"
                },
                "lifecycle_fence": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "memory_id": {
                  "$ref": "./envelope.schema.json#/$defs/identifier"
                },
                "memory_revision": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "source_revision_ids": {
                  "items": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "maxItems": 64,
                  "minItems": 1,
                  "type": "array",
                  "uniqueItems": true
                }
              },
              "required": [
                "memory_id",
                "memory_revision",
                "activation_decision_id",
                "activation_decision_revision",
                "source_revision_ids",
                "deletion_epoch",
                "lifecycle_fence"
              ],
              "type": "object"
            },
            "maxItems": 64,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "adapter_provider_model_destination_and_parameter_versions": {
            "additionalProperties": false,
            "properties": {
              "adapter_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "destination_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "model_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "parameter_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "provider_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "adapter_revision",
              "provider_revision",
              "model_revision",
              "destination_revision",
              "parameter_revision"
            ],
            "type": "object"
          },
          "approval_binding": {
            "oneOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "approval_decision_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "approval_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "approval_scope_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "expiry_ms": {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  "required": {
                    "const": true
                  }
                },
                "required": [
                  "required",
                  "approval_decision_id",
                  "approval_revision",
                  "approval_scope_revision",
                  "expiry_ms"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "fact_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "no_approval_required_fact_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "not_required": {
                    "const": true
                  },
                  "policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "not_required",
                  "no_approval_required_fact_id",
                  "fact_revision",
                  "policy_revision"
                ],
                "type": "object"
              }
            ]
          },
          "attempt_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "attempt_ordinal": {
            "$ref": "./envelope.schema.json#/$defs/uint64"
          },
          "attempt_stage_version": {
            "additionalProperties": false,
            "properties": {
              "idempotency_mode": {
                "enum": [
                  "IDEMPOTENCY_REQUIRED",
                  "IDEMPOTENCY_SCHEMA_INAPPLICABLE"
                ]
              },
              "operation_schema_id": {
                "$ref": "./envelope.schema.json#/$defs/version"
              },
              "operation_schema_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "stage_discriminator": {
                "enum": [
                  "AS0_LOCAL_PREATTEMPT_NO_CLAIM",
                  "AS1_PREALLOCATED_NOT_CLAIMED",
                  "AS2_CLAIMED_NO_LEASE",
                  "AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT",
                  "AS4_LEASE_BOUND_EFFECT_ALLOCATED"
                ]
              },
              "stage_schema_id": {
                "const": "continuity.attempt-stage/1"
              },
              "stage_schema_revision": {
                "const": "1"
              }
            },
            "required": [
              "stage_schema_id",
              "stage_schema_revision",
              "stage_discriminator",
              "idempotency_mode",
              "operation_schema_id",
              "operation_schema_revision"
            ],
            "type": "object"
          },
          "authorization_decision_id_and_revision": {
            "additionalProperties": false,
            "properties": {
              "decision_id": {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              "decision_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "decision_id",
              "decision_revision"
            ],
            "type": "object"
          },
          "capsule_id_or_none": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "claim_fence": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              {
                "const": null
              }
            ]
          },
          "compiler_retrieval_embedding_cache_index_simulation_versions": {
            "additionalProperties": false,
            "properties": {
              "cache_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "compiler_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "embedding_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "index_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "retrieval_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "simulation_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              }
            },
            "required": [
              "compiler_revision",
              "retrieval_revision",
              "embedding_revision",
              "cache_revision",
              "index_revision",
              "simulation_revision"
            ],
            "type": "object"
          },
          "credential_selector_id_and_revision": {
            "additionalProperties": false,
            "properties": {
              "selector_id": {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              "selector_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "selector_id",
              "selector_revision"
            ],
            "type": "object"
          },
          "deletion_and_revision_epochs": {
            "additionalProperties": false,
            "properties": {
              "deletion_epoch": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "revision_epoch": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              }
            },
            "required": [
              "deletion_epoch",
              "revision_epoch"
            ],
            "type": "object"
          },
          "effect_fence": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              {
                "const": null
              }
            ]
          },
          "effect_reservation_id_or_none": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "idempotency_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "lane_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "lease_generation": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              {
                "const": null
              }
            ]
          },
          "lifecycle_hold_and_disposition_fences": {
            "additionalProperties": false,
            "properties": {
              "disposition_revision": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "hold_revision": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "lifecycle_fence": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "lifecycle_fence",
              "hold_revision",
              "disposition_revision"
            ],
            "type": "object"
          },
          "operation_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "operation_type_and_version": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "origin_mode": {
            "enum": [
              "principal_delegated",
              "system_originated"
            ]
          },
          "policy_and_configuration_versions": {
            "additionalProperties": false,
            "properties": {
              "configuration_revision": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "policy_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "policy_revision",
              "configuration_revision"
            ],
            "type": "object"
          },
          "principal_id_or_system_origin_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "purpose_id": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "purpose_policy_revision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "request_commitment": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "commitment": {
                    "$ref": "./envelope.schema.json#/$defs/sha256"
                  },
                  "commitment_key_generation": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "suite": {
                    "const": "A10-REQ-COMMIT-01"
                  },
                  "suite_version": {
                    "const": "request-commitment@1"
                  }
                },
                "required": [
                  "commitment",
                  "suite",
                  "suite_version",
                  "commitment_key_generation"
                ],
                "type": "object"
              },
              {
                "const": null
              }
            ]
          },
          "request_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "request_schema_and_contract_versions": {
            "additionalProperties": false,
            "properties": {
              "request_contract_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "request_schema_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "request_schema_revision",
              "request_contract_revision"
            ],
            "type": "object"
          },
          "source_and_evidence_revision_sets": {
            "additionalProperties": false,
            "properties": {
              "evidence_revisions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "evidence_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    }
                  },
                  "required": [
                    "evidence_id",
                    "revision"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 0,
                "type": "array",
                "uniqueItems": true
              },
              "source_revisions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "source_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    }
                  },
                  "required": [
                    "source_id",
                    "revision"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 1,
                "type": "array",
                "uniqueItems": true
              }
            },
            "required": [
              "source_revisions",
              "evidence_revisions"
            ],
            "type": "object"
          },
          "tenant_authorization_epoch": {
            "$ref": "./envelope.schema.json#/$defs/uint64"
          },
          "tenant_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "tool_intent_binding_or_none": {
            "anyOf": [
              {
                "const": null
              },
              {
                "additionalProperties": false,
                "properties": {
                  "argument_body_ref": {
                    "$ref": "./envelope.schema.json#/$defs/reference"
                  },
                  "argument_body_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "destination_class": {
                    "const": "managed_mcp_same_tenant_read"
                  },
                  "intent_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "intent_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "operation_class": {
                    "enum": [
                      "evidence_lineage_summary",
                      "receipt_summary",
                      "task_status_summary"
                    ]
                  },
                  "risk_class": {
                    "const": "read_only"
                  },
                  "scope_limit_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "tool_class": {
                    "const": "managed_mcp_read"
                  }
                },
                "required": [
                  "intent_id",
                  "intent_revision",
                  "tool_class",
                  "operation_class",
                  "argument_body_ref",
                  "argument_body_revision",
                  "destination_class",
                  "risk_class",
                  "scope_limit_revision"
                ],
                "type": "object"
              }
            ]
          },
          "workload_id_and_revision": {
            "additionalProperties": false,
            "properties": {
              "workload_id": {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              "workload_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "workload_id",
              "workload_revision"
            ],
            "type": "object"
          }
        },
        "required": [
          "request_id",
          "request_commitment",
          "tenant_id",
          "tenant_authorization_epoch",
          "principal_id_or_system_origin_id",
          "origin_mode",
          "purpose_id",
          "purpose_policy_revision",
          "operation_id",
          "operation_type_and_version",
          "lane_id",
          "capsule_id_or_none",
          "attempt_id",
          "attempt_ordinal",
          "idempotency_id",
          "claim_fence",
          "lease_generation",
          "effect_fence",
          "attempt_stage_version",
          "workload_id_and_revision",
          "source_and_evidence_revision_sets",
          "active_memory_revisions",
          "tool_intent_binding_or_none",
          "approval_binding",
          "policy_and_configuration_versions",
          "compiler_retrieval_embedding_cache_index_simulation_versions",
          "adapter_provider_model_destination_and_parameter_versions",
          "request_schema_and_contract_versions",
          "deletion_and_revision_epochs",
          "lifecycle_hold_and_disposition_fences",
          "authorization_decision_id_and_revision",
          "credential_selector_id_and_revision",
          "effect_reservation_id_or_none"
        ],
        "type": "object"
      },
      "identifier": {
        "maxLength": 48,
        "minLength": 48,
        "pattern": "^[0-9a-f]{48}$",
        "type": "string"
      },
      "int64": {
        "maxLength": 20,
        "minLength": 1,
        "pattern": "^(0|-?[1-9][0-9]{0,18})$",
        "type": "string"
      },
      "positiveUint64": {
        "maxLength": 20,
        "minLength": 1,
        "pattern": "^[1-9][0-9]{0,19}$",
        "type": "string"
      },
      "purpose": {
        "maxLength": 96,
        "minLength": 1,
        "pattern": "^[a-z][a-z0-9._:-]*$",
        "type": "string"
      },
      "reference": {
        "maxLength": 48,
        "minLength": 48,
        "pattern": "^[0-9a-f]{48}$",
        "type": "string"
      },
      "schemaVersion": {
        "const": "zc.contracts.v1"
      },
      "sha256": {
        "maxLength": 64,
        "minLength": 64,
        "pattern": "^[0-9a-f]{64}$",
        "type": "string"
      },
      "uint64": {
        "maxLength": 20,
        "minLength": 1,
        "pattern": "^(0|[1-9][0-9]{0,19})$",
        "type": "string"
      },
      "version": {
        "maxLength": 96,
        "minLength": 3,
        "pattern": "^[a-z][a-z0-9._:-]*@[1-9][0-9]*$",
        "type": "string"
      }
    },
    "$id": "urn:zintus-continuity:contracts:v1:envelope",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Continuity contract reusable bindings v1"
  },
  "event.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:event",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "additionalProperties": false,
    "properties": {
      "attemptId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "causationId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "contractFamily": {
        "const": "event"
      },
      "correlationId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "eventId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "eventRevision": {
        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
      },
      "eventType": {
        "enum": [
          "interaction.appended",
          "memory.revision.recorded",
          "response.recorded",
          "task.checkpointed"
        ]
      },
      "occurredAt": {
        "$ref": "./envelope.schema.json#/$defs/dateTime"
      },
      "operationId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "payloadRef": {
        "$ref": "./envelope.schema.json#/$defs/reference"
      },
      "requestedPurpose": {
        "$ref": "./envelope.schema.json#/$defs/purpose"
      },
      "schemaVersion": {
        "$ref": "./envelope.schema.json#/$defs/schemaVersion"
      },
      "serverPurpose": {
        "$ref": "./envelope.schema.json#/$defs/purpose"
      },
      "subjectRef": {
        "$ref": "./envelope.schema.json#/$defs/reference"
      },
      "tenantId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      }
    },
    "required": [
      "schemaVersion",
      "contractFamily",
      "tenantId",
      "requestedPurpose",
      "serverPurpose",
      "operationId",
      "attemptId",
      "eventId",
      "eventRevision",
      "eventType",
      "occurredAt",
      "subjectRef"
    ],
    "title": "Continuity immutable event metadata v1",
    "type": "object"
  },
  "policy.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:policy",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "contractFamily": {
            "const": "policy"
          },
          "decision": {
            "enum": [
              "allow",
              "deny"
            ]
          },
          "decisionId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "decisionRevision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "effectfulTools": {
            "const": "disabled"
          },
          "export": {
            "const": "disabled"
          },
          "learning": {
            "const": "disabled"
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "policyVersion": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "reasonCodes": {
            "items": {
              "enum": [
                "RETRIEVAL_ALLOWED",
                "RETRIEVAL_PURPOSE_DENIED",
                "RETRIEVAL_SCOPE_DENIED",
                "RETRIEVAL_VERSION_UNKNOWN"
              ]
            },
            "maxItems": 16,
            "minItems": 1,
            "type": "array",
            "uniqueItems": true
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "stage": {
            "const": "pre_retrieval"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "stage",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "decisionId",
          "decisionRevision",
          "decision",
          "policyVersion",
          "reasonCodes",
          "effectfulTools",
          "learning",
          "export"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "contractFamily": {
            "const": "policy"
          },
          "decision": {
            "enum": [
              "allow",
              "deny"
            ]
          },
          "decisionId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "decisionRevision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "destinationClass": {
            "const": "bedrock_primary"
          },
          "effectfulTools": {
            "const": "disabled"
          },
          "export": {
            "const": "disabled"
          },
          "learning": {
            "const": "disabled"
          },
          "model": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "policyVersion": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "provider": {
            "const": "amazon-bedrock@1"
          },
          "reasonCodes": {
            "items": {
              "enum": [
                "TRANSMISSION_ALLOWED",
                "TRANSMISSION_DESTINATION_DENIED",
                "TRANSMISSION_POLICY_DENIED",
                "TRANSMISSION_SCOPE_CHANGED",
                "TRANSMISSION_VERSION_UNKNOWN"
              ]
            },
            "maxItems": 16,
            "minItems": 1,
            "type": "array",
            "uniqueItems": true
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "stage": {
            "const": "pre_transmission"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "stage",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "decisionId",
          "decisionRevision",
          "decision",
          "policyVersion",
          "reasonCodes",
          "provider",
          "model",
          "destinationClass",
          "effectfulTools",
          "learning",
          "export"
        ],
        "type": "object"
      }
    ],
    "title": "Continuity disjoint policy decisions v1"
  },
  "provider.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:provider",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "contextCompilerVersion": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "contractFamily": {
            "const": "provider"
          },
          "decision": {
            "const": "deny"
          },
          "errorCode": {
            "enum": [
              "PROVIDER_POLICY_DENIED",
              "PROVIDER_SCOPE_CHANGED",
              "PROVIDER_VERSION_UNKNOWN"
            ]
          },
          "failover": {
            "const": "disabled"
          },
          "model": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "operation": {
            "enum": [
              "embedding",
              "generation"
            ]
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "outcome": {
            "enum": [
              "denied",
              "unknown"
            ]
          },
          "outputTrust": {
            "const": "untrusted_data"
          },
          "policyVersion": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "provider": {
            "const": "amazon-bedrock@1"
          },
          "providerRequestId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "providerRequestRevision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "providerRole": {
            "const": "primary"
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "variant": {
            "const": "denied"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "variant",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "providerRequestId",
          "providerRequestRevision",
          "provider",
          "model",
          "providerRole",
          "failover",
          "operation",
          "decision",
          "outcome",
          "outputTrust",
          "policyVersion",
          "contextCompilerVersion",
          "errorCode"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "contextCompilerVersion": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "contractFamily": {
            "const": "provider"
          },
          "decision": {
            "const": "invoke"
          },
          "errorCode": {
            "enum": [
              "PROVIDER_NONE",
              "PROVIDER_PARTIAL",
              "PROVIDER_RESULT_UNAVAILABLE",
              "PROVIDER_TERMINAL_FAILURE"
            ]
          },
          "failover": {
            "const": "disabled"
          },
          "inputRef": {
            "$ref": "./envelope.schema.json#/$defs/reference"
          },
          "model": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "operation": {
            "enum": [
              "embedding",
              "generation"
            ]
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "outcome": {
            "enum": [
              "failed",
              "partial",
              "succeeded",
              "unknown"
            ]
          },
          "outputRef": {
            "$ref": "./envelope.schema.json#/$defs/reference"
          },
          "outputTrust": {
            "const": "untrusted_data"
          },
          "policyVersion": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "provider": {
            "const": "amazon-bedrock@1"
          },
          "providerRequestId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "providerRequestRevision": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "providerRole": {
            "const": "primary"
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "variant": {
            "const": "result"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "variant",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "providerRequestId",
          "providerRequestRevision",
          "provider",
          "model",
          "providerRole",
          "failover",
          "operation",
          "decision",
          "outcome",
          "outputTrust",
          "policyVersion",
          "contextCompilerVersion",
          "errorCode"
        ],
        "type": "object"
      }
    ],
    "title": "Continuity disjoint provider metadata v1"
  },
  "receipt.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:receipt",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "additionalProperties": false,
    "properties": {
      "attemptId": {
        "anyOf": [
          {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          {
            "const": null
          }
        ]
      },
      "contractFamily": {
        "const": "receipt"
      },
      "logicalReceipt": {
        "additionalProperties": false,
        "properties": {
          "active_memory_revisions": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "activation_decision_id": {
                  "$ref": "./envelope.schema.json#/$defs/identifier"
                },
                "activation_decision_revision": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "deletion_epoch": {
                  "$ref": "./envelope.schema.json#/$defs/uint64"
                },
                "lifecycle_fence": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "memory_id": {
                  "$ref": "./envelope.schema.json#/$defs/identifier"
                },
                "memory_revision": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "source_revision_ids": {
                  "items": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "maxItems": 64,
                  "minItems": 1,
                  "type": "array",
                  "uniqueItems": true
                }
              },
              "required": [
                "memory_id",
                "memory_revision",
                "activation_decision_id",
                "activation_decision_revision",
                "source_revision_ids",
                "deletion_epoch",
                "lifecycle_fence"
              ],
              "type": "object"
            },
            "maxItems": 64,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "approval_binding": {
            "oneOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "approval_decision_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "approval_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "approval_scope_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "expiry_ms": {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  "required": {
                    "const": true
                  }
                },
                "required": [
                  "required",
                  "approval_decision_id",
                  "approval_revision",
                  "approval_scope_revision",
                  "expiry_ms"
                ],
                "type": "object"
              },
              {
                "additionalProperties": false,
                "properties": {
                  "fact_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "no_approval_required_fact_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "not_required": {
                    "const": true
                  },
                  "policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "not_required",
                  "no_approval_required_fact_id",
                  "fact_revision",
                  "policy_revision"
                ],
                "type": "object"
              }
            ]
          },
          "attempt_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "attempt_ordinal": {
            "$ref": "./envelope.schema.json#/$defs/uint64"
          },
          "authorized_external_tuple": {
            "anyOf": [
              {
                "const": null
              },
              {
                "$ref": "./envelope.schema.json#/$defs/externalTuple"
              }
            ]
          },
          "capsule_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "chain_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "checkpoint": {
            "anyOf": [
              {
                "const": null
              },
              {
                "additionalProperties": false,
                "properties": {
                  "kind": {
                    "const": "merkle_sha256_v1"
                  },
                  "range_end": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "range_start": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "root": {
                    "$ref": "./envelope.schema.json#/$defs/sha256"
                  }
                },
                "required": [
                  "kind",
                  "range_start",
                  "range_end",
                  "root"
                ],
                "type": "object"
              }
            ]
          },
          "decision_code": {
            "enum": [
              "ALLOW",
              "DENY",
              "NOT_APPLICABLE"
            ]
          },
          "dispatched_external_tuple": {
            "anyOf": [
              {
                "const": null
              },
              {
                "$ref": "./envelope.schema.json#/$defs/externalTuple"
              }
            ]
          },
          "envelope_type": {
            "const": "receipt"
          },
          "environment_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "erasable_body_ref": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "body_class": {
                    "enum": [
                      "request",
                      "response",
                      "receipt_detail"
                    ]
                  },
                  "body_ref": {
                    "$ref": "./envelope.schema.json#/$defs/reference"
                  },
                  "body_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "body_ref",
                  "body_revision",
                  "body_class"
                ],
                "type": "object"
              },
              {
                "const": null
              }
            ]
          },
          "evidence_refs": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "evidence_id": {
                  "$ref": "./envelope.schema.json#/$defs/identifier"
                },
                "evidence_revision": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "evidence_type": {
                  "enum": [
                    "dispatch_attempt",
                    "policy",
                    "review",
                    "runtime",
                    "test"
                  ]
                }
              },
              "required": [
                "evidence_type",
                "evidence_id",
                "evidence_revision"
              ],
              "type": "object"
            },
            "maxItems": 64,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "idempotency_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "issuance_key_view": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "issued_at_ms": {
            "$ref": "./envelope.schema.json#/$defs/int64"
          },
          "issuer_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "key_lifecycle_at_issuance": {
            "additionalProperties": false,
            "properties": {
              "activated_at_ms": {
                "$ref": "./envelope.schema.json#/$defs/int64"
              },
              "compromise_effective_ms_or_null": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "lifecycle_policy_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "revocation_generation": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "revoked_at_ms_or_null": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  {
                    "const": null
                  }
                ]
              },
              "rotation_generation": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "state": {
                "const": "active"
              },
              "verification_only_at_ms_or_null": {
                "anyOf": [
                  {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  {
                    "const": null
                  }
                ]
              }
            },
            "required": [
              "state",
              "lifecycle_policy_revision",
              "rotation_generation",
              "revocation_generation",
              "activated_at_ms",
              "verification_only_at_ms_or_null",
              "revoked_at_ms_or_null",
              "compromise_effective_ms_or_null"
            ],
            "type": "object"
          },
          "lane_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "lifecycle_binding": {
            "additionalProperties": false,
            "properties": {
              "body_availability": {
                "enum": [
                  "available",
                  "never_existed",
                  "retired",
                  "unknown"
                ]
              },
              "deletion_epoch": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "hold_disposition_revision": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              },
              "lifecycle_fence": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              },
              "revision_epoch": {
                "$ref": "./envelope.schema.json#/$defs/uint64"
              }
            },
            "required": [
              "deletion_epoch",
              "revision_epoch",
              "lifecycle_fence",
              "hold_disposition_revision",
              "body_availability"
            ],
            "type": "object"
          },
          "limitation_codes": {
            "items": {
              "enum": [
                "BODY_UNAVAILABLE",
                "CURRENT_TRUST_UNKNOWN",
                "NO_EVIDENCE_ADMITTED",
                "PARTIAL_SUPPORT",
                "SCOPE_LIMITED"
              ]
            },
            "maxItems": 64,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "operation_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "operation_type": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "origin_mode": {
            "enum": [
              "principal_delegated",
              "system_originated"
            ]
          },
          "outcome_code": {
            "anyOf": [
              {
                "enum": [
                  "FAILED",
                  "NO_EFFECT",
                  "POSSIBLE_EFFECT",
                  "SUCCEEDED",
                  "UNKNOWN"
                ]
              },
              {
                "const": null
              }
            ]
          },
          "predecessor_receipt_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "predecessor_signature_commitment": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/sha256"
              },
              {
                "const": null
              }
            ]
          },
          "principal_id": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              {
                "const": null
              }
            ]
          },
          "profile_id": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "projection_hint": {
            "additionalProperties": false,
            "properties": {
              "projection_rule_version": {
                "$ref": "./envelope.schema.json#/$defs/version"
              },
              "status_class": {
                "enum": [
                  "current_candidate",
                  "historical_only",
                  "not_projectable"
                ]
              }
            },
            "required": [
              "status_class",
              "projection_rule_version"
            ],
            "type": "object"
          },
          "purpose_id": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "receipt_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "receipt_schema": {
            "const": "continuity.receipt/3"
          },
          "receipt_state": {
            "enum": [
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
              "body_unavailable"
            ]
          },
          "receipt_type": {
            "enum": [
              "decision",
              "authorization",
              "transmission",
              "result_admission",
              "effect_settlement",
              "lifecycle",
              "verification",
              "supersession"
            ]
          },
          "request_commitment": {
            "anyOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "commitment": {
                    "$ref": "./envelope.schema.json#/$defs/sha256"
                  },
                  "commitment_key_generation": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "suite": {
                    "const": "A10-REQ-COMMIT-01"
                  },
                  "suite_version": {
                    "const": "request-commitment@1"
                  }
                },
                "required": [
                  "commitment",
                  "suite",
                  "suite_version",
                  "commitment_key_generation"
                ],
                "type": "object"
              },
              {
                "const": null
              }
            ]
          },
          "request_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "scope_commitments": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "commitment": {
                  "$ref": "./envelope.schema.json#/$defs/sha256"
                },
                "domain": {
                  "enum": [
                    "chain_checkpoint",
                    "scope_binding"
                  ]
                },
                "suite": {
                  "const": "sha256@1"
                }
              },
              "required": [
                "domain",
                "suite",
                "commitment"
              ],
              "type": "object"
            },
            "maxItems": 16,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "semantic_class": {
            "enum": [
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
              "runtime_outcome"
            ]
          },
          "sequence": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "signature_suite": {
            "enum": [
              "A10-SIG-ED25519-01",
              "A10-SIG-P384-01"
            ]
          },
          "signing_key_id": {
            "additionalProperties": false,
            "properties": {
              "key_id": {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              "key_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "key_id",
              "key_revision"
            ],
            "type": "object"
          },
          "signing_key_owner_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "source_refs": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "source_id": {
                  "$ref": "./envelope.schema.json#/$defs/identifier"
                },
                "source_revision": {
                  "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                },
                "source_type": {
                  "enum": [
                    "artifact",
                    "event",
                    "memory",
                    "observation",
                    "result"
                  ]
                }
              },
              "required": [
                "source_type",
                "source_id",
                "source_revision"
              ],
              "type": "object"
            },
            "maxItems": 64,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "supersedes_receipt_ids": {
            "items": {
              "$ref": "./envelope.schema.json#/$defs/identifier"
            },
            "maxItems": 64,
            "minItems": 0,
            "type": "array",
            "uniqueItems": true
          },
          "tenant_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "tool_intent_binding": {
            "anyOf": [
              {
                "const": null
              },
              {
                "additionalProperties": false,
                "properties": {
                  "argument_body_ref": {
                    "$ref": "./envelope.schema.json#/$defs/reference"
                  },
                  "argument_body_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "destination_class": {
                    "const": "managed_mcp_same_tenant_read"
                  },
                  "intent_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "intent_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "operation_class": {
                    "enum": [
                      "evidence_lineage_summary",
                      "receipt_summary",
                      "task_status_summary"
                    ]
                  },
                  "risk_class": {
                    "const": "read_only"
                  },
                  "scope_limit_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "tool_class": {
                    "enum": [
                      "managed_mcp_read"
                    ]
                  }
                },
                "required": [
                  "intent_id",
                  "intent_revision",
                  "tool_class",
                  "operation_class",
                  "argument_body_ref",
                  "argument_body_revision",
                  "destination_class",
                  "risk_class",
                  "scope_limit_revision"
                ],
                "type": "object"
              }
            ]
          },
          "valid_from_ms": {
            "$ref": "./envelope.schema.json#/$defs/int64"
          },
          "valid_until_ms": {
            "anyOf": [
              {
                "$ref": "./envelope.schema.json#/$defs/int64"
              },
              {
                "const": null
              }
            ]
          },
          "verifier_policy_id": {
            "$ref": "./envelope.schema.json#/$defs/version"
          },
          "version_tuple": {
            "additionalProperties": false,
            "properties": {
              "active_memory_version": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "activation_decision_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "activation_decision_revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "deletion_epoch": {
                      "$ref": "./envelope.schema.json#/$defs/uint64"
                    },
                    "lifecycle_fence": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "memory_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "memory_revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "source_revision_ids": {
                      "items": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "maxItems": 64,
                      "minItems": 1,
                      "type": "array",
                      "uniqueItems": true
                    }
                  },
                  "required": [
                    "memory_id",
                    "memory_revision",
                    "activation_decision_id",
                    "activation_decision_revision",
                    "source_revision_ids",
                    "deletion_epoch",
                    "lifecycle_fence"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 0,
                "type": "array",
                "uniqueItems": true
              },
              "algorithm_version": {
                "additionalProperties": false,
                "properties": {
                  "canonicalization_suite": {
                    "const": "A10-CANON-01"
                  },
                  "commitment_suite": {
                    "const": "request-commitment@1"
                  },
                  "digest_suite": {
                    "const": "sha256@1"
                  },
                  "receipt_id_generation_suite": {
                    "const": "csprng-192@1"
                  },
                  "signature_suite": {
                    "enum": [
                      "A10-SIG-ED25519-01",
                      "A10-SIG-P384-01"
                    ]
                  }
                },
                "required": [
                  "canonicalization_suite",
                  "digest_suite",
                  "signature_suite",
                  "receipt_id_generation_suite",
                  "commitment_suite"
                ],
                "type": "object"
              },
              "attempt_stage_version": {
                "additionalProperties": false,
                "properties": {
                  "idempotency_mode": {
                    "enum": [
                      "IDEMPOTENCY_REQUIRED",
                      "IDEMPOTENCY_SCHEMA_INAPPLICABLE"
                    ]
                  },
                  "operation_schema_id": {
                    "$ref": "./envelope.schema.json#/$defs/version"
                  },
                  "operation_schema_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "stage_discriminator": {
                    "enum": [
                      "AS0_LOCAL_PREATTEMPT_NO_CLAIM",
                      "AS1_PREALLOCATED_NOT_CLAIMED",
                      "AS2_CLAIMED_NO_LEASE",
                      "AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT",
                      "AS4_LEASE_BOUND_EFFECT_ALLOCATED"
                    ]
                  },
                  "stage_schema_id": {
                    "const": "continuity.attempt-stage/1"
                  },
                  "stage_schema_revision": {
                    "const": "1"
                  }
                },
                "required": [
                  "stage_schema_id",
                  "stage_schema_revision",
                  "stage_discriminator",
                  "idempotency_mode",
                  "operation_schema_id",
                  "operation_schema_revision"
                ],
                "type": "object"
              },
              "attempt_version": {
                "additionalProperties": false,
                "properties": {
                  "attempt_id": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      {
                        "const": null
                      }
                    ]
                  },
                  "attempt_ordinal": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "claim_fence": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      {
                        "const": null
                      }
                    ]
                  },
                  "effect_fence": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      {
                        "const": null
                      }
                    ]
                  },
                  "idempotency_id": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      {
                        "const": null
                      }
                    ]
                  },
                  "lease_generation": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      {
                        "const": null
                      }
                    ]
                  }
                },
                "required": [
                  "attempt_id",
                  "attempt_ordinal",
                  "idempotency_id",
                  "claim_fence",
                  "lease_generation",
                  "effect_fence"
                ],
                "type": "object"
              },
              "cache_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "entry_generation": {
                        "$ref": "./envelope.schema.json#/$defs/uint64"
                      },
                      "key_derivation_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "namespace_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "schema_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "source_fence_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      }
                    },
                    "required": [
                      "schema_revision",
                      "namespace_revision",
                      "key_derivation_revision",
                      "source_fence_revision",
                      "entry_generation"
                    ],
                    "type": "object"
                  }
                ]
              },
              "chain_version": {
                "additionalProperties": false,
                "properties": {
                  "chain_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "checkpoint_policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "predecessor_verification_policy": {
                    "$ref": "./envelope.schema.json#/$defs/version"
                  },
                  "sequence_policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "chain_id",
                  "sequence_policy_revision",
                  "checkpoint_policy_revision",
                  "predecessor_verification_policy"
                ],
                "type": "object"
              },
              "compiler_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "build_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "compiler_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "normalization_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "template_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      }
                    },
                    "required": [
                      "compiler_id",
                      "build_revision",
                      "template_revision",
                      "normalization_revision"
                    ],
                    "type": "object"
                  }
                ]
              },
              "configuration_versions": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "items": {
                      "additionalProperties": false,
                      "properties": {
                        "configuration_id": {
                          "$ref": "./envelope.schema.json#/$defs/identifier"
                        },
                        "revision": {
                          "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                        }
                      },
                      "required": [
                        "configuration_id",
                        "revision"
                      ],
                      "type": "object"
                    },
                    "maxItems": 32,
                    "minItems": 1,
                    "type": "array",
                    "uniqueItems": true
                  }
                ]
              },
              "embedding_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "adapter_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "dimension": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "distance_metric": {
                        "enum": [
                          "cosine",
                          "inner_product",
                          "l2"
                        ]
                      },
                      "embedding_space_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "embedding_space_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "model_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "normalization": {
                        "enum": [
                          "l2",
                          "none"
                        ]
                      },
                      "provider_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      }
                    },
                    "required": [
                      "provider_id",
                      "adapter_revision",
                      "model_revision",
                      "dimension",
                      "distance_metric",
                      "normalization",
                      "embedding_space_id",
                      "embedding_space_revision"
                    ],
                    "type": "object"
                  }
                ]
              },
              "environment_version": {
                "additionalProperties": false,
                "properties": {
                  "architecture_profile_id": {
                    "$ref": "./envelope.schema.json#/$defs/version"
                  },
                  "deployment_manifest_revision": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      {
                        "const": null
                      }
                    ]
                  },
                  "environment_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "isolation_domain_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  }
                },
                "required": [
                  "environment_id",
                  "architecture_profile_id",
                  "deployment_manifest_revision",
                  "isolation_domain_id"
                ],
                "type": "object"
              },
              "evidence_versions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "evidence_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "evidence_revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "evidence_type": {
                      "enum": [
                        "dispatch_attempt",
                        "policy",
                        "review",
                        "runtime",
                        "test"
                      ]
                    },
                    "verifier_class": {
                      "enum": [
                        "automated",
                        "human",
                        "independent"
                      ]
                    }
                  },
                  "required": [
                    "evidence_type",
                    "evidence_id",
                    "evidence_revision",
                    "verifier_class"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 0,
                "type": "array",
                "uniqueItems": true
              },
              "index_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "build_generation": {
                        "$ref": "./envelope.schema.json#/$defs/uint64"
                      },
                      "definition_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "index_class": {
                        "enum": [
                          "entity",
                          "temporal",
                          "vector"
                        ]
                      },
                      "snapshot_read_ms": {
                        "$ref": "./envelope.schema.json#/$defs/int64"
                      },
                      "source_fence": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      }
                    },
                    "required": [
                      "index_class",
                      "definition_revision",
                      "build_generation",
                      "snapshot_read_ms",
                      "source_fence"
                    ],
                    "type": "object"
                  }
                ]
              },
              "intent_approval_version": {
                "additionalProperties": false,
                "properties": {
                  "approval_fact_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "approval_fact_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "tool_intent_id": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      {
                        "const": null
                      }
                    ]
                  },
                  "tool_intent_revision": {
                    "anyOf": [
                      {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      {
                        "const": null
                      }
                    ]
                  }
                },
                "required": [
                  "tool_intent_id",
                  "tool_intent_revision",
                  "approval_fact_id",
                  "approval_fact_revision"
                ],
                "type": "object"
              },
              "key_governance_version": {
                "additionalProperties": false,
                "properties": {
                  "custodian_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "issuance_view_id": {
                    "$ref": "./envelope.schema.json#/$defs/version"
                  },
                  "issuance_view_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "lifecycle_policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "policy_owner_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "revocation_generation": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "rotation_generation": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "signing_key_owner_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "verifier_current_view_policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "verifier_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  }
                },
                "required": [
                  "signing_key_owner_id",
                  "verifier_id",
                  "custodian_id",
                  "policy_owner_id",
                  "lifecycle_policy_revision",
                  "rotation_generation",
                  "revocation_generation",
                  "issuance_view_id",
                  "issuance_view_revision",
                  "verifier_current_view_policy_revision"
                ],
                "type": "object"
              },
              "key_version": {
                "additionalProperties": false,
                "properties": {
                  "issuer_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "key_valid_from_ms": {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  "key_valid_until_ms": {
                    "$ref": "./envelope.schema.json#/$defs/int64"
                  },
                  "revocation_view_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "signing_key_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "signing_key_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "trust_anchor_set_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "issuer_id",
                  "signing_key_id",
                  "signing_key_revision",
                  "trust_anchor_set_revision",
                  "revocation_view_revision",
                  "key_valid_from_ms",
                  "key_valid_until_ms"
                ],
                "type": "object"
              },
              "lifecycle_version": {
                "additionalProperties": false,
                "properties": {
                  "body_availability": {
                    "enum": [
                      "available",
                      "never_existed",
                      "retired",
                      "unknown"
                    ]
                  },
                  "deletion_epoch": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "hold_disposition_revision": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "lifecycle_fence": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "revision_epoch": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "supersession_generation": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  }
                },
                "required": [
                  "deletion_epoch",
                  "revision_epoch",
                  "lifecycle_fence",
                  "hold_disposition_revision",
                  "supersession_generation",
                  "body_availability"
                ],
                "type": "object"
              },
              "object_versions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "object_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "object_type": {
                      "enum": [
                        "artifact",
                        "belief",
                        "candidate",
                        "current_status",
                        "event",
                        "memory",
                        "observation",
                        "receipt",
                        "result"
                      ]
                    },
                    "revision_id": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "schema_id": {
                      "$ref": "./envelope.schema.json#/$defs/version"
                    }
                  },
                  "required": [
                    "object_type",
                    "object_id",
                    "schema_id",
                    "revision_id"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 1,
                "type": "array",
                "uniqueItems": true
              },
              "operation_version": {
                "additionalProperties": false,
                "properties": {
                  "capsule_schema_id": {
                    "$ref": "./envelope.schema.json#/$defs/version"
                  },
                  "capsule_schema_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "lane_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "operation_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "operation_type": {
                    "enum": [
                      "embedding",
                      "generation",
                      "managed_mcp_read",
                      "status"
                    ]
                  },
                  "route_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "workload_class": {
                    "enum": [
                      "api",
                      "background",
                      "mcp_read"
                    ]
                  }
                },
                "required": [
                  "operation_type",
                  "operation_revision",
                  "route_id",
                  "lane_id",
                  "capsule_schema_id",
                  "capsule_schema_revision",
                  "workload_class"
                ],
                "type": "object"
              },
              "policy_versions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "decision_point": {
                      "enum": [
                        "pre_retrieval",
                        "pre_transmission"
                      ]
                    },
                    "decision_reference": {
                      "$ref": "./envelope.schema.json#/$defs/reference"
                    },
                    "policy_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    }
                  },
                  "required": [
                    "policy_id",
                    "revision",
                    "decision_point",
                    "decision_reference"
                  ],
                  "type": "object"
                },
                "maxItems": 32,
                "minItems": 1,
                "type": "array",
                "uniqueItems": true
              },
              "provider_model_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "adapter_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "adapter_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "credential_selector_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "credential_selector_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "destination_class": {
                        "const": "bedrock_primary"
                      },
                      "destination_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "effect_reservation_applicability": {
                        "const": "typed_none"
                      },
                      "effect_reservation_id": {
                        "const": null
                      },
                      "model_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "model_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "parameter_bundle_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "provider_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      },
                      "provider_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      }
                    },
                    "required": [
                      "adapter_id",
                      "adapter_revision",
                      "provider_id",
                      "provider_revision",
                      "model_id",
                      "model_revision",
                      "parameter_bundle_revision",
                      "destination_class",
                      "destination_revision",
                      "credential_selector_id",
                      "credential_selector_revision",
                      "effect_reservation_applicability",
                      "effect_reservation_id"
                    ],
                    "type": "object"
                  }
                ]
              },
              "purpose_scope": {
                "additionalProperties": false,
                "properties": {
                  "purpose_expiry_fence": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "purpose_id": {
                    "$ref": "./envelope.schema.json#/$defs/purpose"
                  },
                  "purpose_policy_version": {
                    "$ref": "./envelope.schema.json#/$defs/version"
                  }
                },
                "required": [
                  "purpose_id",
                  "purpose_policy_version",
                  "purpose_expiry_fence"
                ],
                "type": "object"
              },
              "receipt_format_version": {
                "additionalProperties": false,
                "properties": {
                  "canonical_format": {
                    "const": "A10-CANON-01"
                  },
                  "logical_schema": {
                    "const": "continuity.receipt/3"
                  }
                },
                "required": [
                  "logical_schema",
                  "canonical_format"
                ],
                "type": "object"
              },
              "request_version": {
                "additionalProperties": false,
                "properties": {
                  "authorization_context_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "request_commitment_revision": {
                    "const": "1"
                  },
                  "request_commitment_suite": {
                    "const": "A10-REQ-COMMIT-01"
                  },
                  "request_contract_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "request_contract_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "request_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "request_schema_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "request_id",
                  "request_contract_id",
                  "request_contract_revision",
                  "request_schema_revision",
                  "authorization_context_revision",
                  "request_commitment_suite",
                  "request_commitment_revision"
                ],
                "type": "object"
              },
              "retrieval_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "filter_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "fusion_ranking_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "limit_budget": {
                        "$ref": "./envelope.schema.json#/$defs/uint64"
                      },
                      "plan_id": {
                        "$ref": "./envelope.schema.json#/$defs/identifier"
                      }
                    },
                    "required": [
                      "plan_id",
                      "fusion_ranking_revision",
                      "filter_revision",
                      "limit_budget"
                    ],
                    "type": "object"
                  }
                ]
              },
              "schema_versions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "schema_id": {
                      "$ref": "./envelope.schema.json#/$defs/version"
                    },
                    "schema_revision": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    }
                  },
                  "required": [
                    "schema_id",
                    "schema_revision"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 1,
                "type": "array",
                "uniqueItems": true
              },
              "simulation_version": {
                "anyOf": [
                  {
                    "const": null
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "branch_policy_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "counterfactual_budget": {
                        "$ref": "./envelope.schema.json#/$defs/uint64"
                      },
                      "scoring_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "simulator_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      },
                      "world_state_revision": {
                        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                      }
                    },
                    "required": [
                      "simulator_revision",
                      "world_state_revision",
                      "branch_policy_revision",
                      "scoring_revision",
                      "counterfactual_budget"
                    ],
                    "type": "object"
                  }
                ]
              },
              "source_versions": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "revision_id": {
                      "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                    },
                    "source_id": {
                      "$ref": "./envelope.schema.json#/$defs/identifier"
                    },
                    "source_type": {
                      "enum": [
                        "artifact",
                        "event",
                        "memory",
                        "observation",
                        "result"
                      ]
                    },
                    "system_time_ms": {
                      "$ref": "./envelope.schema.json#/$defs/int64"
                    },
                    "valid_from_ms": {
                      "$ref": "./envelope.schema.json#/$defs/int64"
                    },
                    "valid_until_ms": {
                      "anyOf": [
                        {
                          "$ref": "./envelope.schema.json#/$defs/int64"
                        },
                        {
                          "const": null
                        }
                      ]
                    }
                  },
                  "required": [
                    "source_type",
                    "source_id",
                    "revision_id",
                    "valid_from_ms",
                    "valid_until_ms",
                    "system_time_ms"
                  ],
                  "type": "object"
                },
                "maxItems": 64,
                "minItems": 1,
                "type": "array",
                "uniqueItems": true
              },
              "tenant_scope": {
                "additionalProperties": false,
                "properties": {
                  "tenant_authorization_epoch": {
                    "$ref": "./envelope.schema.json#/$defs/uint64"
                  },
                  "tenant_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  }
                },
                "required": [
                  "tenant_id",
                  "tenant_authorization_epoch"
                ],
                "type": "object"
              },
              "verifier_policy_version": {
                "additionalProperties": false,
                "properties": {
                  "accepted_suite_set_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "limitation_rule_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "policy_id": {
                    "$ref": "./envelope.schema.json#/$defs/identifier"
                  },
                  "policy_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "projection_rule_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  },
                  "trust_time_rule_revision": {
                    "$ref": "./envelope.schema.json#/$defs/positiveUint64"
                  }
                },
                "required": [
                  "policy_id",
                  "policy_revision",
                  "accepted_suite_set_revision",
                  "trust_time_rule_revision",
                  "limitation_rule_revision",
                  "projection_rule_revision"
                ],
                "type": "object"
              }
            },
            "required": [
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
              "attempt_stage_version"
            ],
            "type": "object"
          }
        },
        "required": [
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
          "dispatched_external_tuple"
        ],
        "type": "object"
      },
      "operationId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "requestedPurpose": {
        "$ref": "./envelope.schema.json#/$defs/purpose"
      },
      "schemaVersion": {
        "$ref": "./envelope.schema.json#/$defs/schemaVersion"
      },
      "serverPurpose": {
        "$ref": "./envelope.schema.json#/$defs/purpose"
      },
      "signatureEnvelope": {
        "additionalProperties": false,
        "properties": {
          "canonical_bytes_length": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "envelope_version": {
            "const": "continuity.receipt-signature/1"
          },
          "receipt_id": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "signature": {
            "anyOf": [
              {
                "maxLength": 86,
                "minLength": 86,
                "pattern": "^[A-Za-z0-9_-]{86}$",
                "type": "string"
              },
              {
                "maxLength": 128,
                "minLength": 128,
                "pattern": "^[A-Za-z0-9_-]{128}$",
                "type": "string"
              }
            ]
          },
          "signature_suite": {
            "enum": [
              "A10-SIG-ED25519-01",
              "A10-SIG-P384-01"
            ]
          },
          "signing_key_id": {
            "additionalProperties": false,
            "properties": {
              "key_id": {
                "$ref": "./envelope.schema.json#/$defs/identifier"
              },
              "key_revision": {
                "$ref": "./envelope.schema.json#/$defs/positiveUint64"
              }
            },
            "required": [
              "key_id",
              "key_revision"
            ],
            "type": "object"
          }
        },
        "required": [
          "envelope_version",
          "receipt_id",
          "signature_suite",
          "signing_key_id",
          "canonical_bytes_length",
          "signature"
        ],
        "type": "object"
      },
      "tenantId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      }
    },
    "required": [
      "schemaVersion",
      "contractFamily",
      "tenantId",
      "requestedPurpose",
      "serverPurpose",
      "operationId",
      "attemptId",
      "logicalReceipt",
      "signatureEnvelope"
    ],
    "title": "Continuity receipt/3 with detached signature envelope",
    "type": "object"
  },
  "registry.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:registry",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "additionalProperties": false,
    "properties": {
      "attemptId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "catalogId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "catalogRevision": {
        "$ref": "./envelope.schema.json#/$defs/positiveUint64"
      },
      "contractFamily": {
        "const": "registry"
      },
      "operationId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      },
      "requestedPurpose": {
        "$ref": "./envelope.schema.json#/$defs/purpose"
      },
      "schemaVersion": {
        "$ref": "./envelope.schema.json#/$defs/schemaVersion"
      },
      "schemas": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "family": {
              "enum": [
                "api",
                "event",
                "policy",
                "provider",
                "receipt",
                "registry",
                "task"
              ]
            },
            "schemaDigest": {
              "$ref": "./envelope.schema.json#/$defs/sha256"
            },
            "schemaId": {
              "maxLength": 96,
              "minLength": 37,
              "pattern": "^urn:zintus-continuity:contracts:v1:[a-z]+$",
              "type": "string"
            }
          },
          "required": [
            "family",
            "schemaId",
            "schemaDigest"
          ],
          "type": "object"
        },
        "maxItems": 7,
        "minItems": 7,
        "type": "array",
        "uniqueItems": true
      },
      "serverPurpose": {
        "$ref": "./envelope.schema.json#/$defs/purpose"
      },
      "tenantId": {
        "$ref": "./envelope.schema.json#/$defs/identifier"
      }
    },
    "required": [
      "schemaVersion",
      "contractFamily",
      "tenantId",
      "requestedPurpose",
      "serverPurpose",
      "operationId",
      "attemptId",
      "catalogId",
      "catalogRevision",
      "schemas"
    ],
    "title": "Continuity schema catalog manifest v1",
    "type": "object"
  },
  "task.schema.json": {
    "$id": "urn:zintus-continuity:contracts:v1:task",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "command": {
            "enum": [
              "cancel",
              "inspect"
            ]
          },
          "contractFamily": {
            "const": "task"
          },
          "messageKind": {
            "const": "command"
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "taskId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "taskVersion": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "messageKind",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "taskId",
          "taskVersion",
          "command"
        ],
        "type": "object"
      },
      {
        "additionalProperties": false,
        "properties": {
          "attemptId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "checkpointRef": {
            "$ref": "./envelope.schema.json#/$defs/reference"
          },
          "contractFamily": {
            "const": "task"
          },
          "errorCode": {
            "enum": [
              "TASK_NONE",
              "TASK_CANCELLED",
              "TASK_NOT_FOUND",
              "TASK_RESULT_PARTIAL",
              "TASK_RESULT_UNKNOWN",
              "TASK_TERMINAL_FAILURE"
            ]
          },
          "messageKind": {
            "const": "status"
          },
          "operationId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "outcome": {
            "enum": [
              "denied",
              "failed",
              "partial",
              "succeeded",
              "unknown"
            ]
          },
          "requestedPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "schemaVersion": {
            "$ref": "./envelope.schema.json#/$defs/schemaVersion"
          },
          "serverPurpose": {
            "$ref": "./envelope.schema.json#/$defs/purpose"
          },
          "state": {
            "enum": [
              "cancelled",
              "completed",
              "failed",
              "pending",
              "running",
              "unknown"
            ]
          },
          "taskId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "taskVersion": {
            "$ref": "./envelope.schema.json#/$defs/positiveUint64"
          },
          "tenantId": {
            "$ref": "./envelope.schema.json#/$defs/identifier"
          },
          "updatedAt": {
            "$ref": "./envelope.schema.json#/$defs/dateTime"
          }
        },
        "required": [
          "schemaVersion",
          "contractFamily",
          "messageKind",
          "tenantId",
          "requestedPurpose",
          "serverPurpose",
          "operationId",
          "attemptId",
          "taskId",
          "taskVersion",
          "state",
          "outcome",
          "updatedAt",
          "errorCode"
        ],
        "type": "object"
      }
    ],
    "title": "Continuity disjoint task command and status metadata v1"
  }
} as const;
const generatedSemanticProfile = {
  "$id": "urn:zintus-continuity:contracts:semantics:v1",
  "families": {
    "api": {
      "server_response": {
        "denied": [
          "API_POLICY_DENIED",
          "content_forbidden"
        ],
        "failed": [
          "API_REQUEST_INVALID",
          "content_forbidden"
        ],
        "partial": [
          "API_RESULT_PARTIAL",
          "content_required"
        ],
        "succeeded": [
          "API_NONE",
          "content_required"
        ],
        "unknown": [
          "API_RESULT_UNAVAILABLE",
          "content_forbidden"
        ]
      }
    },
    "event": {
      "allowedProperties": [
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
        "tenantId"
      ],
      "constBindings": {
        "contractFamily": "event"
      },
      "enumBindings": {
        "eventType": [
          "interaction.appended",
          "memory.revision.recorded",
          "response.recorded",
          "task.checkpointed"
        ]
      },
      "opaqueReference": {
        "maxLength": 48,
        "minLength": 48,
        "pattern": "^[0-9a-f]{48}$",
        "type": "string"
      },
      "refBindings": {
        "attemptId": "./envelope.schema.json#/$defs/identifier",
        "causationId": "./envelope.schema.json#/$defs/identifier",
        "correlationId": "./envelope.schema.json#/$defs/identifier",
        "eventId": "./envelope.schema.json#/$defs/identifier",
        "eventRevision": "./envelope.schema.json#/$defs/positiveUint64",
        "occurredAt": "./envelope.schema.json#/$defs/dateTime",
        "operationId": "./envelope.schema.json#/$defs/identifier",
        "payloadRef": "./envelope.schema.json#/$defs/reference",
        "requestedPurpose": "./envelope.schema.json#/$defs/purpose",
        "schemaVersion": "./envelope.schema.json#/$defs/schemaVersion",
        "serverPurpose": "./envelope.schema.json#/$defs/purpose",
        "subjectRef": "./envelope.schema.json#/$defs/reference",
        "tenantId": "./envelope.schema.json#/$defs/identifier"
      },
      "requiredProperties": [
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
        "tenantId"
      ],
      "semanticRule": "closed_metadata_only"
    },
    "policy": {
      "pre_retrieval": {
        "allow": [
          "RETRIEVAL_ALLOWED"
        ],
        "deny": [
          "RETRIEVAL_PURPOSE_DENIED",
          "RETRIEVAL_SCOPE_DENIED",
          "RETRIEVAL_VERSION_UNKNOWN"
        ]
      },
      "pre_transmission": {
        "allow": [
          "TRANSMISSION_ALLOWED"
        ],
        "deny": [
          "TRANSMISSION_DESTINATION_DENIED",
          "TRANSMISSION_POLICY_DENIED",
          "TRANSMISSION_SCOPE_CHANGED",
          "TRANSMISSION_VERSION_UNKNOWN"
        ]
      }
    },
    "provider": {
      "denied": {
        "denied": [
          "PROVIDER_POLICY_DENIED",
          "PROVIDER_SCOPE_CHANGED"
        ],
        "unknown": [
          "PROVIDER_VERSION_UNKNOWN"
        ]
      },
      "result": {
        "failed": [
          "PROVIDER_TERMINAL_FAILURE",
          "input_required",
          "output_forbidden"
        ],
        "partial": [
          "PROVIDER_PARTIAL",
          "input_required",
          "output_required"
        ],
        "succeeded": [
          "PROVIDER_NONE",
          "input_required",
          "output_required"
        ],
        "unknown": [
          "PROVIDER_RESULT_UNAVAILABLE",
          "input_required",
          "output_forbidden"
        ]
      }
    },
    "receipt": {
      "allowedReceiptTuples": [
        [
          "authorization",
          "approval",
          "ALLOW",
          null,
          "authorized",
          "required",
          "optional"
        ],
        [
          "authorization",
          "approval",
          "DENY",
          null,
          "cancelled",
          "typed_none",
          "terminal_stage_fact"
        ],
        [
          "authorization",
          "authority",
          "ALLOW",
          null,
          "authorized",
          "required",
          "optional"
        ],
        [
          "authorization",
          "authority",
          "DENY",
          null,
          "failed",
          "typed_none",
          "terminal_stage_fact"
        ],
        [
          "authorization",
          "capability",
          "ALLOW",
          null,
          "authorized",
          "required",
          "optional"
        ],
        [
          "authorization",
          "capability",
          "DENY",
          null,
          "invalid",
          "typed_none",
          "forbidden"
        ],
        [
          "decision",
          "decision",
          "ALLOW",
          null,
          "accepted",
          "typed_none",
          "forbidden"
        ],
        [
          "decision",
          "decision",
          "ALLOW",
          null,
          "supported",
          "typed_none",
          "forbidden"
        ],
        [
          "decision",
          "decision",
          "DENY",
          null,
          "invalid",
          "typed_none",
          "forbidden"
        ],
        [
          "decision",
          "decision",
          "DENY",
          null,
          "limited",
          "typed_none",
          "forbidden"
        ],
        [
          "decision",
          "decision",
          "DENY",
          null,
          "unknown",
          "typed_none",
          "forbidden"
        ],
        [
          "effect_settlement",
          "runtime_outcome",
          "NOT_APPLICABLE",
          "FAILED",
          "failed",
          "required",
          "terminal_stage_fact"
        ],
        [
          "effect_settlement",
          "runtime_outcome",
          "NOT_APPLICABLE",
          "NO_EFFECT",
          "cancelled",
          "required",
          "terminal_stage_fact"
        ],
        [
          "effect_settlement",
          "runtime_outcome",
          "NOT_APPLICABLE",
          "SUCCEEDED",
          "completed",
          "required",
          "required"
        ],
        [
          "effect_settlement",
          "runtime_outcome",
          "NOT_APPLICABLE",
          "UNKNOWN",
          "unknown",
          "typed_none",
          "optional"
        ],
        [
          "lifecycle",
          "artifact",
          "NOT_APPLICABLE",
          null,
          "body_unavailable",
          "typed_none",
          "forbidden"
        ],
        [
          "lifecycle",
          "fact",
          "NOT_APPLICABLE",
          "NO_EFFECT",
          "deleted_tombstoned",
          "typed_none",
          "forbidden"
        ],
        [
          "lifecycle",
          "receipt",
          "NOT_APPLICABLE",
          "NO_EFFECT",
          "superseded",
          "typed_none",
          "forbidden"
        ],
        [
          "result_admission",
          "evidence",
          "DENY",
          "FAILED",
          "failed",
          "required",
          "terminal_stage_fact"
        ],
        [
          "result_admission",
          "result",
          "ALLOW",
          "SUCCEEDED",
          "completed",
          "required",
          "required"
        ],
        [
          "result_admission",
          "runtime_outcome",
          "DENY",
          "UNKNOWN",
          "unknown",
          "typed_none",
          "optional"
        ],
        [
          "supersession",
          "receipt",
          "NOT_APPLICABLE",
          "NO_EFFECT",
          "superseded",
          "typed_none",
          "forbidden"
        ],
        [
          "transmission",
          "runtime_outcome",
          "ALLOW",
          "SUCCEEDED",
          "completed",
          "required",
          "required"
        ],
        [
          "transmission",
          "runtime_outcome",
          "ALLOW",
          null,
          "provisional_streaming",
          "required",
          "required"
        ],
        [
          "transmission",
          "runtime_outcome",
          "ALLOW",
          null,
          "transmitting",
          "required",
          "required"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "FAILED",
          "failed",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "NO_EFFECT",
          "cancelled",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "NO_EFFECT",
          "failed",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "POSSIBLE_EFFECT",
          "cancelled",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "POSSIBLE_EFFECT",
          "failed",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "UNKNOWN",
          "cancelled",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          "UNKNOWN",
          "failed",
          "required",
          "terminal_stage_fact"
        ],
        [
          "transmission",
          "runtime_outcome",
          "DENY",
          null,
          "unknown",
          "typed_none",
          "optional"
        ],
        [
          "verification",
          "claim",
          "ALLOW",
          null,
          "supported",
          "typed_none",
          "forbidden"
        ],
        [
          "verification",
          "claim",
          "DENY",
          null,
          "unknown",
          "typed_none",
          "forbidden"
        ],
        [
          "verification",
          "evidence",
          "DENY",
          null,
          "limited",
          "typed_none",
          "forbidden"
        ],
        [
          "verification",
          "receipt",
          "DENY",
          null,
          "invalid",
          "typed_none",
          "forbidden"
        ]
      ],
      "credentialSelectorSource": "provider_model_version.credential_selector_id+credential_selector_revision",
      "destinationRevisionSource": "provider_model_version.destination_revision",
      "dispatchEvidenceFacts": {
        "dispatch_attempt": "external_attempt_possible"
      },
      "dispatchStageFacts": {
        "AS0_LOCAL_PREATTEMPT_NO_CLAIM": "no_external_attempt",
        "AS1_PREALLOCATED_NOT_CLAIMED": "no_external_attempt",
        "AS2_CLAIMED_NO_LEASE": "pre_dispatch",
        "AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT": "external_attempt_possible",
        "AS4_LEASE_BOUND_EFFECT_ALLOCATED": "external_attempt_effect_allocated"
      },
      "effectReservationApplicability": "provider_model_version.effect_reservation_applicability+effect_reservation_id",
      "providerRevisionSource": "provider_model_version.provider_revision",
      "sourceEvidenceTupleMember": "source_evidence.id_revision_pairs"
    },
    "registry": {
      "schemas": {
        "api": "urn:zintus-continuity:contracts:v1:api",
        "event": "urn:zintus-continuity:contracts:v1:event",
        "policy": "urn:zintus-continuity:contracts:v1:policy",
        "provider": "urn:zintus-continuity:contracts:v1:provider",
        "receipt": "urn:zintus-continuity:contracts:v1:receipt",
        "registry": "urn:zintus-continuity:contracts:v1:registry",
        "task": "urn:zintus-continuity:contracts:v1:task"
      }
    },
    "task": {
      "status": {
        "cancelled": [
          "denied",
          "TASK_CANCELLED",
          "checkpoint_forbidden"
        ],
        "completed": [
          "succeeded",
          "TASK_NONE",
          "checkpoint_required"
        ],
        "failed": [
          "failed",
          "TASK_TERMINAL_FAILURE",
          "checkpoint_forbidden"
        ],
        "pending": [
          "unknown",
          "TASK_RESULT_UNKNOWN",
          "checkpoint_forbidden"
        ],
        "running": [
          "partial",
          "TASK_RESULT_PARTIAL",
          "checkpoint_forbidden"
        ],
        "unknown": [
          "denied",
          "TASK_NOT_FOUND",
          "checkpoint_forbidden"
        ]
      }
    }
  },
  "profileVersion": "continuity.contract-semantics@1",
  "schemaVersion": "zc.contracts.v1"
} as const;

function freezeSchemaCatalog<const Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeSchemaCatalog(nested);
    Object.freeze(value);
  }
  return value;
}

export const contractSchemaCatalog = freezeSchemaCatalog(generatedSchemaCatalog);
export const contractSemanticProfile = freezeSchemaCatalog(generatedSemanticProfile);
export const contractCatalogIdentitySha256 = "fce956c24dd20203a19e663bd00cd4fd50b90bf0ba20f554e42554ae43d3f1e6" as const;

export const contractSchemaNames = Object.freeze(
  Object.keys(contractSchemaCatalog) as Array<keyof typeof contractSchemaCatalog>,
);

export type ContractSchemaName = keyof typeof contractSchemaCatalog;
