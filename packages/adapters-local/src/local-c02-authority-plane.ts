import {
  type AuthenticationService,
  createAuthenticationService,
  createTenantAuthorityBinder,
  type TenantAuthorityBinder,
} from "@zintus-continuity/application";
import { registerLocalC02AuthoritySource } from "@zintus-continuity/application/internal/local-c02-authority-registrar";
import {
  createLocalIdentityAuthorityFixture,
  type LocalIdentityAuthorityFixture,
} from "./local-cognito-shaped-verifier.js";
import {
  createLocalTenantAuthorityCoordinator,
  createLocalTenantAuthorityFixture,
  type LocalTenantAuthorityFixture,
} from "./local-tenant-authority-fixture.js";

export interface LocalC02AuthorityPlane {
  readonly authentication: AuthenticationService;
  readonly binder: TenantAuthorityBinder;
  readonly identity: LocalIdentityAuthorityFixture;
  readonly tenant: LocalTenantAuthorityFixture;
}

export function createLocalC02AuthorityPlane(
  identityFixtureJson: unknown,
  tenantFixtureJson: unknown,
  expectedIssuer: unknown,
  expectedClientId: unknown,
  clockSkewSeconds: unknown,
): LocalC02AuthorityPlane {
  const coordinator = createLocalTenantAuthorityCoordinator();
  const identity = createLocalIdentityAuthorityFixture(identityFixtureJson, coordinator);
  const tenant = createLocalTenantAuthorityFixture(tenantFixtureJson, coordinator);
  const authentication = createAuthenticationService(
    expectedIssuer,
    expectedClientId,
    clockSkewSeconds,
    identity.lookupIdentityAuthority,
    identity.lookupService,
  );
  const source = registerLocalC02AuthoritySource(
    Object.freeze({
      authentication,
      origin: Object.freeze({}),
      readGeneration: identity.readAuthorityGeneration,
      tenantLookup: tenant.lookupTenantAuthority,
    }),
  );
  return Object.freeze({
    authentication,
    binder: createTenantAuthorityBinder(source),
    identity,
    tenant,
  });
}
