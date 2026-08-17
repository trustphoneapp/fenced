import { applicationLayer } from "@zintus-continuity/application";

export type {
  FaultJournalEntry,
  FaultRule,
  LocalFixtureIdentityDefinition,
  LocalHarnessErrorCode,
  LocalIdentity,
  LocalJson,
  LocalProviderFixture,
  LocalProviderInvocation,
  LocalScope,
  LocalSyntheticController,
  LocalSyntheticFixture,
  LocalSyntheticFixtureDefinition,
  LocalSyntheticRuntime,
} from "@zintus-continuity/application";
export { localSyntheticFixture } from "@zintus-continuity/application";
export { createLocalDemoRuntime, type DemoRuntime } from "./h-demo-runtime.js";
export {
  createCrdbSqlExecutorHandle,
  createCrdbSqlRecallLedgerPlans,
  mapCrdbFactRow,
  type SqlExecutor,
  type SqlPlan,
  type SqlRow,
} from "./h2-crdb-sql-recall-ledger.js";
export { type DemoDataset, type DemoDatasetFact, h2DemoDataset } from "./h2-demo-dataset.js";
export {
  type CrdbRecallLedgerHandle,
  type CrdbRecallLedgerStatus,
  createH2RecallLedgerCrdbStub,
} from "./h2-recall-ledger-crdb-stub.js";
export {
  type BedrockRuntimeSender,
  type BedrockTransmissionPolicy,
  type BedrockTransmissionRequest,
  type BedrockTransmissionScope,
  bedrockHackathonProfile,
  createBedrockPorts,
} from "./h4-bedrock-ports.js";
export {
  createLocalMcpReceiptTools,
  type LocalMcpReceiptTools,
  type McpToolResult,
} from "./h5-mcp-receipt-tools.js";
export {
  createHackathonCrdbRepository,
  type HackathonCrdbOptions,
  type HackathonCrdbReason,
  type HackathonPoolLike,
  hackathonDviPublicSql,
  hackathonDviRestrictedSql,
} from "./hackathon-crdb.js";
export {
  createLocalC02AuthorityPlane,
  type LocalC02AuthorityPlane,
} from "./local-c02-authority-plane.js";
export {
  createLocalC04Database,
  localC04DatabaseLimits,
} from "./local-c04-database.js";
export { createLocalC06EventRepository } from "./local-c06-event-repository.js";
export { createLocalC07OutboxRepository } from "./local-c07-outbox-repository.js";
export {
  createLocalCognitoShapedSyntheticVerifier,
  createLocalIdentityAuthorityFixture,
  type LocalCognitoShapedSyntheticVerifier,
  type LocalIdentityAuthorityFixture,
  localCognitoSyntheticLimits,
} from "./local-cognito-shaped-verifier.js";
export { createLocalH1RecallLedgerRepository } from "./local-h1-recall-ledger-repository.js";
export {
  compareUtf8,
  createLocalSyntheticFixture,
  LocalHarnessError,
} from "./local-synthetic-fixture.js";
export {
  createLocalTenantAuthorityCoordinator,
  createLocalTenantAuthorityFixture,
  type LocalTenantAuthorityCoordinator,
  type LocalTenantAuthorityFixture,
  type LocalTenantIntentCapability,
  localTenantAuthorityFixtureLimits,
} from "./local-tenant-authority-fixture.js";

export const localAdapterLayer = {
  application: applicationLayer.name,
  name: "adapters-local" as const,
};
