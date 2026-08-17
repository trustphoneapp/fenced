export {
  type CompatibilityIssue,
  type CompatibilityResult,
  checkOldProducerToNewConsumerCompatibility,
  checkSameVersionCompatibility,
} from "./compatibility.js";
export {
  type ContractSchemaName,
  contractCatalogIdentitySha256,
  contractSchemaCatalog,
  contractSchemaNames,
  contractSemanticProfile,
} from "./generated/schema-catalog.js";
export {
  type HackathonLiveStep,
  type HackathonLiveStepObject,
  hackathonLiveLimits,
  hackathonLiveProviderAllowances,
  hackathonLiveSteps,
  isMonotonicHackathonLiveTransition,
  parseHackathonLiveStep,
} from "./hackathon-live.js";
export type {
  ApiContractV1,
  CanonicalInt64,
  CanonicalUint64,
  EventContractV1,
  InferSchema,
  OpaqueId,
  OpaqueReference,
  PolicyContractV1,
  ProviderContractV1,
  ReceiptContractV1,
  RegistryContractV1,
  Sha256Hex,
  TaskContractV1,
} from "./types.js";
export {
  type ContractValidationFailure,
  type ContractValidationResult,
  parseAndValidateContract,
  validateContract,
} from "./validation.js";

export const contractsWorkspaceVersion = "b02-v1" as const;
