import type {
  AuthenticatedServiceIdentity,
  ResolvedMembership,
} from "./authenticated-principal.js";

export const tenantContextVersion = "tenant-context.v1" as const;

export interface TenantWorkload {
  readonly capability: string;
  readonly classification: string;
  readonly service: AuthenticatedServiceIdentity;
}

interface TenantContextCommon {
  readonly decisionId: string;
  readonly effectiveExpiresAtSeconds: number;
  readonly issuedAtSeconds: number;
  readonly operation: string;
  readonly purpose: string;
  readonly requestId: string;
  readonly tenantAuthorizationEpoch: number;
  readonly tenantAuthorityRevision: number;
  readonly tenantFence: string;
  readonly tenantId: string;
  readonly traceId: string;
  readonly version: typeof tenantContextVersion;
  readonly workload: TenantWorkload;
}

export interface PrincipalTenantContext extends TenantContextCommon {
  readonly membership: ResolvedMembership;
  readonly mode: "principal";
}

export interface SystemTenantContext extends TenantContextCommon {
  readonly mode: "system";
  readonly origin: AuthenticatedServiceIdentity;
}

export type TenantContext = PrincipalTenantContext | SystemTenantContext;
