import { foundationLayer } from "@zintus-continuity/foundation";

export {
  type AuthenticatedPrincipal,
  type AuthenticatedServiceIdentity,
  type AuthenticationAssurance,
  type CognitoSessionEvidence,
  type CredentialIdentity,
  cognitoIdentityProvider,
  type ResolvedMembership,
  serviceIdentityProvider,
} from "./authenticated-principal.js";
export {
  type PrincipalTenantContext,
  type SystemTenantContext,
  type TenantContext,
  type TenantWorkload,
  tenantContextVersion,
} from "./tenant-context.js";

export const domainLayer = { foundationLayer, name: "domain" as const };
