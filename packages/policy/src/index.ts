import { contractsWorkspaceVersion } from "@zintus-continuity/contracts";
import { domainLayer } from "@zintus-continuity/domain";

export const policyLayer = {
  contractsWorkspaceVersion,
  domain: domainLayer.name,
  name: "policy" as const,
};
