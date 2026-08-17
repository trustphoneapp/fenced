/** Principal-only authentication output. Tenant and authorization context belong elsewhere. */

export const cognitoIdentityProvider = "cognito" as const;
export const serviceIdentityProvider = "service" as const;

export type AuthenticationAssurance = "multi_factor" | "single_factor";

export interface CredentialIdentity {
  readonly clientId: string;
  readonly issuer: string;
  readonly provider: typeof cognitoIdentityProvider | typeof serviceIdentityProvider;
  readonly subject: string;
}

export interface CognitoSessionEvidence {
  readonly assurance: AuthenticationAssurance;
  readonly authenticatedAtSeconds: number;
  readonly credentialId: string;
  readonly expiresAtSeconds: number;
  readonly issuedAtSeconds: number;
}

export interface AuthenticatedPrincipal {
  readonly identity: CredentialIdentity & { readonly provider: typeof cognitoIdentityProvider };
  readonly session: CognitoSessionEvidence;
}

export interface AuthenticatedServiceIdentity {
  readonly identity: CredentialIdentity & { readonly provider: typeof serviceIdentityProvider };
  readonly kind: "service";
  readonly session: {
    readonly expiresAtSeconds: number;
    readonly issuedAtSeconds: number;
  };
}

export interface ResolvedMembership {
  readonly assurance: AuthenticationAssurance;
  readonly authorityRevision: number;
  readonly effectiveExpiresAtSeconds: number;
  readonly membershipEpoch: number;
  readonly membershipId: string;
  readonly principal: AuthenticatedPrincipal;
  readonly roles: readonly string[];
  readonly tenantId: string;
}
