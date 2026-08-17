import { describe, expect, it } from "vitest";
import {
  contractCatalogIdentitySha256,
  contractSchemaCatalog,
  contractSemanticProfile,
} from "../../packages/contracts/src/generated/schema-catalog.js";
import { readOwnData } from "../../scripts/safe-own-data.mjs";
import { defineSyntheticProperty } from "../../scripts/synthetic-test-data.mjs";
import {
  computeContractIdentityDigestForTest,
  crossValidateExecutableSemanticsForTest,
  parseJsonWithoutDuplicateKeys,
  validateRestrictedSchemaForTest,
  validateSemanticProfileForTest,
} from "../../scripts/verify-contracts.mjs";

describe("restricted schema dialect", () => {
  it.each([
    ["empty schema", {}],
    ["unknown keyword", { type: "string", minLength: 1, maxLength: 2, vendorMagic: true }],
    ["unknown type", { type: "number" }],
    [
      "wrong keyword type",
      { type: "object", properties: [], required: [], additionalProperties: false },
    ],
    ["open object", { type: "object", properties: {}, required: [], additionalProperties: true }],
    ["unbounded array", { type: "array", items: { const: "x" }, uniqueItems: true }],
    [
      "contradictory array bounds",
      {
        type: "array",
        minItems: 3,
        maxItems: 2,
        uniqueItems: true,
        items: { const: "x" },
      },
    ],
    [
      "array without uniqueness",
      {
        type: "array",
        minItems: 0,
        maxItems: 2,
        uniqueItems: false,
        items: { const: "x" },
      },
    ],
    ["contradictory string bounds", { type: "string", minLength: 3, maxLength: 2 }],
    ["contradictory type and const", { type: "string", const: null }],
    ["contradictory type and enum", { type: "object", enum: ["value"] }],
    ["contradictory const and enum", { const: "safe", enum: ["different"] }],
    ["invalid regular expression", { type: "string", minLength: 1, maxLength: 10, pattern: "[" }],
    [
      "unreviewed catastrophic regular expression",
      { type: "string", minLength: 1, maxLength: 10, pattern: "^(a+)+$" },
    ],
    [
      "const outside string assertion",
      { type: "string", minLength: 3, maxLength: 10, pattern: "^[a-z]+$", const: "X" },
    ],
    [
      "enum outside string bound",
      { type: "string", minLength: 1, maxLength: 2, pattern: "^[a-z]+$", enum: ["long"] },
    ],
    [
      "unknown required property",
      { type: "object", properties: {}, required: ["missing"], additionalProperties: false },
    ],
    ["unsupported format", { type: "string", minLength: 1, maxLength: 10, format: "uri" }],
    ["remote reference", { $ref: "https://example.invalid/schema" }],
    [
      "reference sibling",
      { $ref: "./envelope.schema.json#/$defs/identifier", description: "unchecked" },
    ],
    [
      "secret-bearing property",
      {
        type: "object",
        additionalProperties: false,
        required: ["secretCredential"],
        properties: {
          secretCredential: { type: "string", minLength: 1, maxLength: 32 },
        },
      },
    ],
    [
      "raw embedding property",
      {
        type: "object",
        additionalProperties: false,
        required: ["embedding"],
        properties: {
          embedding: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: { const: "x" },
          },
        },
      },
    ],
  ])("rejects %s", (_label, schema) => {
    expect(() => validateRestrictedSchemaForTest(schema)).toThrow();
  });

  it("rejects duplicate and prototype-pollution keys before parsing", () => {
    expect(() => parseJsonWithoutDuplicateKeys('{"type":"string","type":"object"}')).toThrow(
      /duplicate key/u,
    );
    expect(() => parseJsonWithoutDuplicateKeys('{"__proto__":{}}')).toThrow(/pollution key/u);
  });

  it("bounds JSON nesting before materialization", () => {
    const source = `${"[".repeat(130)}0${"]".repeat(130)}`;
    expect(() => parseJsonWithoutDuplicateKeys(source)).toThrow(/nesting budget/u);
  });

  it("changes deterministic catalog identity when semantics drift", () => {
    const altered = structuredClone(contractSemanticProfile);
    altered.families.receipt.allowedReceiptTuples[0][5] =
      altered.families.receipt.allowedReceiptTuples[0][5] === "required"
        ? "typed_none"
        : "required";
    expect(computeContractIdentityDigestForTest(contractSchemaCatalog, altered)).not.toBe(
      contractCatalogIdentitySha256,
    );
    expect(
      computeContractIdentityDigestForTest(contractSchemaCatalog, contractSemanticProfile),
    ).toBe(contractCatalogIdentitySha256);
  });

  it("rejects non-finite semantic metadata before identity hashing", () => {
    for (const nonFinite of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const altered = structuredClone(contractSemanticProfile);
      altered.families.event.nonFiniteMetadata = nonFinite;
      expect(() => validateSemanticProfileForTest(altered)).toThrow(/finite/u);
      expect(() => computeContractIdentityDigestForTest(contractSchemaCatalog, altered)).toThrow(
        /finite/u,
      );
    }
  });

  it("rejects prototype-bearing semantic metadata", () => {
    const altered = structuredClone(contractSemanticProfile);
    Object.setPrototypeOf(altered.families.event, { inherited: "forbidden" });
    expect(() => validateSemanticProfileForTest(altered)).toThrow(/plain JSON object/u);
  });

  it("rejects hidden and symbol semantic members", () => {
    for (const alter of [
      (profile) =>
        defineSyntheticProperty(profile.families.event, "hidden", {
          value: "forbidden",
          enumerable: false,
        }),
      (profile) => {
        defineSyntheticProperty(profile.families.event, Symbol("hidden"), {
          configurable: true,
          enumerable: true,
          value: "forbidden",
          writable: true,
        });
      },
    ]) {
      const altered = structuredClone(contractSemanticProfile);
      alter(altered);
      expect(() => validateSemanticProfileForTest(altered)).toThrow();
    }
  });

  it("rejects noncanonical array names, hidden Infinity, and array getters", () => {
    const semanticMutations = [
      (profile) =>
        defineSyntheticProperty(profile.families.receipt.allowedReceiptTuples, "hidden", {
          value: Number.POSITIVE_INFINITY,
          enumerable: false,
        }),
      (profile) =>
        defineSyntheticProperty(profile.families.receipt.allowedReceiptTuples[0], "0", {
          get: () => "decision",
          enumerable: true,
          configurable: true,
        }),
    ];
    for (const mutate of semanticMutations) {
      const altered = structuredClone(contractSemanticProfile);
      mutate(altered);
      expect(() => validateSemanticProfileForTest(altered)).toThrow();
    }

    const schema = { enum: ["SAFE"] };
    defineSyntheticProperty(schema.enum, "0", {
      get: () => "SAFE",
      enumerable: true,
      configurable: true,
    });
    expect(() => validateRestrictedSchemaForTest(schema)).toThrow();
    const hiddenSchema = { enum: ["SAFE"] };
    defineSyntheticProperty(hiddenSchema.enum, "hidden", {
      value: Number.POSITIVE_INFINITY,
      enumerable: false,
    });
    expect(() => validateRestrictedSchemaForTest(hiddenSchema)).toThrow();
  });

  it("rejects million-length sparse arrays before proportional work", () => {
    const sparse = [];
    sparse.length = 1_000_000;
    const altered = structuredClone(contractSemanticProfile);
    altered.families.receipt.allowedReceiptTuples = sparse;
    expect(() => validateSemanticProfileForTest(altered)).toThrow(/length cap/u);
    expect(() => validateRestrictedSchemaForTest({ enum: sparse })).toThrow(/length cap/u);
  });

  it("requires the exact event semantic invariant for every JSON primitive type", () => {
    for (const semanticRule of ["attacker_relaxed", 1, null, true]) {
      const altered = structuredClone(contractSemanticProfile);
      altered.families.event.semanticRule = semanticRule;
      expect(() => validateSemanticProfileForTest(altered)).toThrow(/event semantic/u);
    }
  });

  it("cross-validates the complete event allowlist, bindings, and opaque references", () => {
    const mutations = [
      (catalog) => {
        catalog["event.schema.json"].properties.messageBody = {
          type: "string",
          minLength: 1,
          maxLength: 96,
        };
      },
      (catalog) => {
        catalog["event.schema.json"].required.push("payloadRef");
      },
      (catalog) => {
        catalog["event.schema.json"].properties.payloadRef.$ref =
          "./envelope.schema.json#/$defs/identifier";
      },
      (catalog) => {
        catalog["envelope.schema.json"].$defs.reference.maxLength = 96;
      },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(contractSchemaCatalog);
      mutate(altered);
      expect(() =>
        crossValidateExecutableSemanticsForTest(altered, contractSemanticProfile),
      ).toThrow(/event schema/u);
    }
  });

  it("rejects coordinated event schema and semantic-profile expansion", () => {
    const alteredCatalog = structuredClone(contractSchemaCatalog);
    alteredCatalog["event.schema.json"].properties.messageBody = {
      const: "attacker-controlled-content",
    };
    const alteredProfile = structuredClone(contractSemanticProfile);
    alteredProfile.families.event.allowedProperties.push("messageBody");
    alteredProfile.families.event.allowedProperties.sort();
    alteredProfile.families.event.constBindings.messageBody = "attacker-controlled-content";
    expect(() => crossValidateExecutableSemanticsForTest(alteredCatalog, alteredProfile)).toThrow(
      /event semantic/u,
    );
  });

  it("cross-validates provider outcomes within each discriminator branch", () => {
    const altered = structuredClone(contractSchemaCatalog);
    altered["provider.schema.json"].oneOf[0].properties.outcome.enum.push("failed");
    expect(() => crossValidateExecutableSemanticsForTest(altered, contractSemanticProfile)).toThrow(
      /provider denied outcome/u,
    );
  });

  it("cross-validates provider error codes within each discriminator branch", () => {
    for (const [branch, injected] of [
      [0, "PROVIDER_TERMINAL_FAILURE"],
      [1, "PROVIDER_POLICY_DENIED"],
    ]) {
      const altered = structuredClone(contractSchemaCatalog);
      readOwnData(
        altered["provider.schema.json"].oneOf,
        String(branch),
      ).properties.errorCode.enum.push(injected);
      readOwnData(
        altered["provider.schema.json"].oneOf,
        String(branch),
      ).properties.errorCode.enum.sort();
      expect(() =>
        crossValidateExecutableSemanticsForTest(altered, contractSemanticProfile),
      ).toThrow(/provider (?:denied|result) error-code/u);
    }
  });

  it("requires the exact dispatch-stage fact mapping", () => {
    for (const mutate of [
      (facts) => {
        facts.AS3_LEASE_BOUND_NO_EFFECT_OR_PRE_EFFECT = "pre_dispatch";
      },
      (facts) => {
        facts.AS2_CLAIMED_NO_LEASE = "unknown_fact";
      },
    ]) {
      const altered = structuredClone(contractSemanticProfile);
      mutate(altered.families.receipt.dispatchStageFacts);
      expect(() => validateSemanticProfileForTest(altered)).toThrow(/closed table/u);
    }
  });

  it("rejects omitted non-receipt cases, extra tuple tokens, and provider directive conflicts", () => {
    const mutations = [
      (profile) => {
        delete profile.families.api.server_response.failed;
      },
      (profile) => {
        delete profile.families.provider.result.partial;
      },
      (profile) => {
        delete profile.families.policy.pre_retrieval.deny;
      },
      (profile) => {
        delete profile.families.task.status.running;
      },
      (profile) => {
        profile.families.api.server_response.succeeded.push("ignored");
      },
      (profile) => {
        profile.families.provider.result.succeeded[2] = "output_forbidden";
      },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(contractSemanticProfile);
      mutate(altered);
      expect(() =>
        crossValidateExecutableSemanticsForTest(contractSchemaCatalog, altered),
      ).toThrow();
    }
  });

  it("rejects reverse-ordered semantic sets, cross-branch overlap, and receipt row reordering", () => {
    const mutations = [
      (profile) => {
        profile.families.policy.pre_retrieval.deny.reverse();
      },
      (profile) => {
        profile.families.policy.pre_retrieval.deny[0] =
          profile.families.policy.pre_retrieval.allow[0];
      },
      (profile) => {
        profile.families.provider.denied.unknown[0] = profile.families.provider.denied.denied[0];
      },
      (profile) => {
        [
          profile.families.receipt.allowedReceiptTuples[0],
          profile.families.receipt.allowedReceiptTuples[1],
        ] = [
          profile.families.receipt.allowedReceiptTuples[1],
          profile.families.receipt.allowedReceiptTuples[0],
        ];
      },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(contractSemanticProfile);
      mutate(altered);
      expect(() =>
        crossValidateExecutableSemanticsForTest(contractSchemaCatalog, altered),
      ).toThrow();
    }
  });

  it("rejects duplicate or conflicting applicability for one five-field receipt key", () => {
    const altered = structuredClone(contractSemanticProfile);
    const duplicate = structuredClone(altered.families.receipt.allowedReceiptTuples[0]);
    duplicate[6] = "optional";
    altered.families.receipt.allowedReceiptTuples.push(duplicate);
    expect(() => validateSemanticProfileForTest(altered)).toThrow(/closed table/u);
  });

  it("rejects unknown executable selectors and unrealizable receipt tuples", () => {
    const unknownSelector = structuredClone(contractSemanticProfile);
    unknownSelector.families.receipt.providerRevisionSource = "attacker.provider_revision";
    expect(() => validateSemanticProfileForTest(unknownSelector)).toThrow(/closed table/u);

    const unrealizable = structuredClone(contractSemanticProfile);
    unrealizable.families.receipt.allowedReceiptTuples[0][1] = "administrator";
    expect(() =>
      crossValidateExecutableSemanticsForTest(contractSchemaCatalog, unrealizable),
    ).toThrow(/unrealizable/u);
  });
});
