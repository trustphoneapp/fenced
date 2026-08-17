import { describe, expect, it } from "vitest";
import { createLocalC02AuthorityPlane } from "../../packages/adapters-local/src/index.js";
import {
  createTenantAuthorityBinder,
  createTenantContextService,
  tenantContextLimits,
} from "../../packages/application/src/index.js";
import { registerLocalC02AuthoritySource } from "../../packages/application/src/internal/local-c02-authority-registrar.js";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_synthetic";
const clientId = "synthetic-client";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const principalProjection = JSON.stringify({
  authenticationMethods: ["mfa", "pwd"],
  authenticatedAtSeconds: 900,
  clientId,
  credentialId: "session-a",
  expiresAtSeconds: 1_200,
  issuedAtSeconds: 950,
  issuer,
  provider: "cognito",
  subject: "principal-a",
  tokenUse: "access",
});

const serviceRecord = (credentialRef, subject, overrides = {}) => ({
  clientId: "continuity-worker",
  credentialRef,
  expiresAtSeconds: 1_180,
  issuedAtSeconds: 900,
  issuer: "local://continuity-services",
  provider: "service",
  revoked: false,
  subject,
  ...overrides,
});

const identityFixtureJson = () =>
  canonical({
    credentials: [
      {
        clientId,
        credentialId: "session-a",
        issuer,
        provider: "cognito",
        revoked: false,
        subject: "principal-a",
        validAfterSeconds: 0,
      },
    ],
    memberships: [
      {
        clientId,
        expiresAtSeconds: 1_150,
        issuer,
        membershipEpoch: 7,
        membershipId: "membership-a",
        provider: "cognito",
        revoked: false,
        roles: ["member", "operator"],
        subject: "principal-a",
        tenantId: "tenant-a",
      },
    ],
    services: [
      serviceRecord("fixture:workload", "workload-a"),
      serviceRecord("fixture:origin", "origin-a"),
      serviceRecord("fixture:other", "other-a"),
    ],
  });

function authenticatedPlane(authorities) {
  const plane = createLocalC02AuthorityPlane(
    identityFixtureJson(),
    JSON.stringify({ authorities }),
    issuer,
    clientId,
    0,
  );
  const { authentication, identity: authority } = plane;
  const principalResult = authentication.authenticate(principalProjection, 1_000);
  if (principalResult.outcome !== "verified") throw new Error("expected principal");
  const membershipResult = authentication.resolveMembership(
    principalResult.principal,
    "tenant-a",
    7,
    1_000,
  );
  if (membershipResult.outcome !== "resolved") throw new Error("expected membership");
  const authenticateService = (credentialRef) => {
    const result = authentication.authenticateService(
      authority.verifyServiceCredential(credentialRef),
      1_000,
    );
    if (result.outcome !== "verified") throw new Error("expected service");
    return result.service;
  };
  return {
    ...plane,
    authority,
    membership: membershipResult.membership,
    origin: authenticateService("fixture:origin"),
    other: authenticateService("fixture:other"),
    workload: authenticateService("fixture:workload"),
  };
}

const serviceProjection = (subject) => ({
  clientId: "continuity-worker",
  issuer: "local://continuity-services",
  provider: "service",
  subject,
});

const workloadProjection = (overrides = {}) => ({
  capability: "continuity.respond",
  classification: "synthetic",
  ...serviceProjection("workload-a"),
  ...overrides,
});

const principalAuthority = (overrides = {}) => ({
  allowedRoles: ["member"],
  expiresAtSeconds: 1_140,
  intentId: "intent-principal",
  mode: "principal",
  operation: "respond",
  purpose: "continuity",
  revoked: false,
  tenantAuthorizationEpoch: 11,
  tenantAuthorityRevision: 3,
  tenantFence: "fence-a",
  tenantId: "tenant-a",
  version: "tenant-context.v1",
  workload: workloadProjection(),
  ...overrides,
});

const systemAuthority = (overrides = {}) => ({
  expiresAtSeconds: 1_140,
  intentId: "intent-system",
  mode: "system",
  operation: "checkpoint",
  purpose: "continuity",
  revoked: false,
  systemOrigin: serviceProjection("origin-a"),
  tenantAuthorizationEpoch: 11,
  tenantAuthorityRevision: 3,
  tenantFence: "fence-a",
  tenantId: "tenant-a",
  version: "tenant-context.v1",
  workload: workloadProjection({ capability: "continuity.checkpoint" }),
  ...overrides,
});

function setup(authorities = [principalAuthority(), systemAuthority()], idIssuerOverride) {
  const identity = authenticatedPlane(authorities);
  const fixture = identity.tenant;
  return {
    ...identity,
    fixture,
    tenant: createTenantContextService(
      identity.binder,
      idIssuerOverride ?? fixture.issueTenantContextIds,
    ),
  };
}

function intent(fixture, id) {
  return fixture.issueIntent(id);
}

function issuePrincipal(state) {
  return state.tenant.issuePrincipal(
    intent(state.fixture, "intent-principal"),
    state.membership,
    state.workload,
    1_000,
  );
}

const reusableIds = () =>
  '{"decisionId":"decision-reusable","requestId":"request-reusable","traceId":"trace-reusable"}';

const authoritySourceRecord = (authentication, origin, readGeneration, tenantLookup) =>
  Object.freeze({ authentication, origin, readGeneration, tenantLookup });

function reentrantTenant(state, idIssuer) {
  let callback;
  const source = registerLocalC02AuthoritySource(
    authoritySourceRecord(
      state.authentication,
      {},
      () => {
        const current = state.fixture.readAuthorityGeneration();
        const run = callback;
        callback = undefined;
        run?.();
        return current;
      },
      state.fixture.lookupTenantAuthority,
    ),
  );
  return {
    arm(run) {
      callback = run;
    },
    tenant: createTenantContextService(createTenantAuthorityBinder(source), idIssuer),
  };
}

describe("C02 server-owned tenant context", () => {
  it("issues and validates one deeply frozen principal context from server authority", () => {
    const state = setup();
    const result = issuePrincipal(state);
    expect(result.outcome).toBe("issued");
    if (result.outcome !== "issued") throw new Error("expected context");
    expect(result.context).toMatchObject({
      decisionId: "local-decision-1",
      effectiveExpiresAtSeconds: 1_140,
      issuedAtSeconds: 1_000,
      mode: "principal",
      operation: "respond",
      purpose: "continuity",
      requestId: "local-request-1",
      tenantAuthorizationEpoch: 11,
      tenantAuthorityRevision: 3,
      tenantFence: "fence-a",
      tenantId: "tenant-a",
      traceId: "local-trace-1",
      version: "tenant-context.v1",
      workload: {
        capability: "continuity.respond",
        classification: "synthetic",
        service: state.workload,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(Object.isFrozen(result.context.workload)).toBe(true);
    expect(state.tenant.validate(result.context, 1_001)).toEqual(result);
  });

  it("rejects forged, cloned, and proxied intent, context, and membership without traps", () => {
    const state = setup();
    const validIntent = intent(state.fixture, "intent-principal");
    expect(
      state.tenant.issuePrincipal("intent-principal", state.membership, state.workload, 1_000),
    ).toEqual({ outcome: "denied", reason: "FORGED_INTENT" });
    expect(
      state.tenant.issuePrincipal({ ...validIntent }, state.membership, state.workload, 1_000),
    ).toEqual({ outcome: "denied", reason: "FORGED_INTENT" });
    let traps = 0;
    const hostileIntent = new Proxy(validIntent, {
      get() {
        traps += 1;
        throw new Error("must not inspect");
      },
    });
    expect(
      state.tenant.issuePrincipal(hostileIntent, state.membership, state.workload, 1_000),
    ).toEqual({ outcome: "denied", reason: "FORGED_INTENT" });
    const issued = issuePrincipal(state);
    if (issued.outcome !== "issued") throw new Error("expected context");
    expect(state.tenant.validate({ ...issued.context }, 1_001)).toEqual({
      outcome: "denied",
      reason: "FORGED_CONTEXT",
    });
    const hostileContext = new Proxy(issued.context, {
      get() {
        traps += 1;
        throw new Error("must not inspect");
      },
    });
    expect(state.tenant.validate(hostileContext, 1_001)).toEqual({
      outcome: "denied",
      reason: "FORGED_CONTEXT",
    });
    expect(
      state.tenant.issuePrincipal(validIntent, { ...state.membership }, state.workload, 1_000),
    ).toEqual({ outcome: "denied", reason: "ACTOR_DENIED" });
    expect(traps).toBe(0);
  });

  it("takes no caller tenant, purpose, mode, or operation hints and denies scope or role mismatch", () => {
    const state = setup([principalAuthority({ tenantId: "tenant-b" })]);
    expect(issuePrincipal(state)).toEqual({ outcome: "denied", reason: "ROLE_DENIED" });

    const roleState = setup([principalAuthority({ allowedRoles: ["tenant_admin"] })]);
    expect(issuePrincipal(roleState)).toEqual({ outcome: "denied", reason: "ROLE_DENIED" });

    const normal = setup();
    expect(
      normal.tenant.issuePrincipal(
        intent(normal.fixture, "intent-principal"),
        normal.membership,
        normal.workload,
        { tenantId: "tenant-b", purpose: "other", mode: "system", operation: "admin" },
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "INVALID_REQUEST" });
  });

  it("invalidates old contexts on C01 revision, epoch, revocation, or workload revocation", () => {
    for (const mutate of [
      (state) => state.authority.reactivateCredential("session-a", 0),
      (state) => state.authority.setMembershipEpoch("membership-a", 8),
      (state) => state.authority.revokeMembership("membership-a"),
      (state) => state.authority.revokeCredential("session-a"),
      (state) => state.authority.revokeService("fixture:workload"),
    ]) {
      const state = setup();
      const issued = issuePrincipal(state);
      if (issued.outcome !== "issued") throw new Error("expected context");
      mutate(state);
      expect(state.tenant.validate(issued.context, 1_001).outcome).toBe("denied");
    }
  });

  it("invalidates every C02 decision input change and never refreshes an old context", () => {
    const changes = [
      { tenantAuthorityRevision: 4 },
      { tenantAuthorizationEpoch: 12 },
      { tenantFence: "fence-b" },
      { purpose: "other" },
      { operation: "other" },
      { version: "tenant-context.v2" },
      { workload: workloadProjection({ classification: "restricted" }) },
    ];
    for (const change of changes) {
      const original = principalAuthority();
      const state = setup([original]);
      const issued = issuePrincipal(state);
      if (issued.outcome !== "issued") throw new Error("expected context");
      state.fixture.replaceAuthority(
        "intent-principal",
        JSON.stringify({ ...original, ...change }),
      );
      expect(state.tenant.validate(issued.context, 1_001).outcome).toBe("denied");
      state.fixture.replaceAuthority("intent-principal", JSON.stringify(original));
      expect(state.tenant.validate(issued.context, 1_001).outcome).toBe("denied");
    }
  });

  it("invalidates on same-byte mutation and does not advance generation for invalid operations", () => {
    const state = setup();
    const issued = issuePrincipal(state);
    if (issued.outcome !== "issued") throw new Error("expected context");
    const beforeInvalid = state.fixture.readAuthorityGeneration();
    expect(() =>
      state.fixture.replaceAuthority("unknown", JSON.stringify(principalAuthority())),
    ).toThrow("INVALID_LOCAL_TENANT_AUTHORITY_OPERATION");
    expect(state.fixture.readAuthorityGeneration()).toBe(beforeInvalid);
    state.fixture.replaceAuthority("intent-principal", JSON.stringify(principalAuthority()));
    expect(state.fixture.readAuthorityGeneration()).not.toBe(beforeInvalid);
    expect(state.tenant.validate(issued.context, 1_001).outcome).toBe("denied");
    expect(state.tenant.validate(issued.context, 1_001).outcome).toBe("denied");
  });

  it("binds system origin and separately current workload with exact class and capability", () => {
    const state = setup();
    const systemIntent = intent(state.fixture, "intent-system");
    const issued = state.tenant.issueSystem(systemIntent, state.origin, state.workload, 1_000);
    expect(issued.outcome).toBe("issued");
    expect(state.tenant.issueSystem(systemIntent, state.other, state.workload, 1_000)).toEqual({
      outcome: "denied",
      reason: "ACTOR_DENIED",
    });
    expect(state.tenant.issueSystem(systemIntent, state.origin, state.other, 1_000)).toEqual({
      outcome: "denied",
      reason: "WORKLOAD_DENIED",
    });

    expect(
      state.tenant.issueSystem(
        systemIntent,
        state.origin,
        { classification: "restricted", service: state.workload },
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "WORKLOAD_DENIED" });
    expect(state.tenant.issueSystem(systemIntent, undefined, state.workload, 1_000)).toEqual({
      outcome: "denied",
      reason: "ACTOR_DENIED",
    });
  });

  it("rejects server-issued identifier collisions without replay authority", () => {
    for (const duplicate of ["decisionId", "requestId", "traceId"]) {
      let call = 0;
      const repeatedId = () => {
        call += 1;
        return JSON.stringify({
          decisionId: duplicate === "decisionId" ? "decision-same" : `decision-${call}`,
          requestId: duplicate === "requestId" ? "request-same" : `request-${call}`,
          traceId: duplicate === "traceId" ? "trace-same" : `trace-${call}`,
        });
      };
      const state = setup(undefined, repeatedId);
      expect(issuePrincipal(state).outcome).toBe("issued");
      expect(issuePrincipal(state)).toEqual({ outcome: "denied", reason: "REPLAY" });
    }
  });

  it("shares replay protection across services created from one binder", () => {
    const state = setup(undefined, reusableIds);
    const second = createTenantContextService(state.binder, reusableIds);
    expect(issuePrincipal(state).outcome).toBe("issued");
    expect(
      second.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "REPLAY" });
  });

  it("treats every identifier as one binder-wide replay namespace", () => {
    const state = setup(
      undefined,
      () => '{"decisionId":"decision-first","requestId":"cross-field","traceId":"trace-first"}',
    );
    const second = createTenantContextService(
      state.binder,
      () => '{"decisionId":"decision-second","requestId":"request-second","traceId":"cross-field"}',
    );
    expect(issuePrincipal(state).outcome).toBe("issued");
    expect(
      second.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "REPLAY" });
  });

  it("rejects equal identifiers within one tuple without reserving them", () => {
    const state = setup(
      undefined,
      () => '{"decisionId":"decision-equal","requestId":"equal-id","traceId":"equal-id"}',
    );
    const second = createTenantContextService(
      state.binder,
      () =>
        '{"decisionId":"decision-after-equal","requestId":"equal-id","traceId":"trace-after-equal"}',
    );
    expect(issuePrincipal(state)).toEqual({ outcome: "denied", reason: "INVALID_REQUEST" });
    expect(
      second.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      ).outcome,
    ).toBe("issued");
  });

  it("shares the issued-context cap across services created from one binder", () => {
    const state = setup();
    const second = createTenantContextService(state.binder, state.fixture.issueTenantContextIds);
    for (let index = 1; index < tenantContextLimits.issuedContexts; index += 1) {
      expect(issuePrincipal(state).outcome).toBe("issued");
    }
    expect(
      second.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      ).outcome,
    ).toBe("issued");
    expect(issuePrincipal(state)).toEqual({ outcome: "denied", reason: "INVALID_REQUEST" });
  });

  it("isolates replay namespaces between unrelated binders", () => {
    const first = setup(undefined, reusableIds);
    const second = setup(undefined, reusableIds);
    expect(issuePrincipal(first).outcome).toBe("issued");
    expect(issuePrincipal(second).outcome).toBe("issued");
  });

  it("denies an outer issuance when a generation callback commits its three IDs", () => {
    const state = setup();
    const ids = () =>
      '{"decisionId":"decision-reentrant","requestId":"request-reentrant","traceId":"trace-reentrant"}';
    const reentrant = reentrantTenant(state, ids);
    let nested;
    reentrant.arm(() => {
      nested = reentrant.tenant.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      );
    });
    const outer = reentrant.tenant.issuePrincipal(
      intent(state.fixture, "intent-principal"),
      state.membership,
      state.workload,
      1_000,
    );
    expect(nested?.outcome).toBe("issued");
    expect(outer).toEqual({ outcome: "denied", reason: "REPLAY" });
    expect("context" in outer).toBe(false);
    expect(reentrant.tenant.validate(outer, 1_001)).toEqual({
      outcome: "denied",
      reason: "FORGED_CONTEXT",
    });
    expect(reentrant.tenant.validate(nested.context, 1_001)).toEqual(nested);
    expect(
      reentrant.tenant.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "REPLAY" });
  });

  it("denies an outer issuance when a reentrant issuance consumes final capacity", () => {
    const state = setup();
    let id = 0;
    const reentrant = reentrantTenant(state, () => {
      id += 1;
      return JSON.stringify({
        decisionId: `decision-capacity-${id}`,
        requestId: `request-capacity-${id}`,
        traceId: `trace-capacity-${id}`,
      });
    });
    for (let index = 1; index < tenantContextLimits.issuedContexts; index += 1) {
      expect(
        reentrant.tenant.issuePrincipal(
          intent(state.fixture, "intent-principal"),
          state.membership,
          state.workload,
          1_000,
        ).outcome,
      ).toBe("issued");
    }
    let nested;
    reentrant.arm(() => {
      nested = reentrant.tenant.issuePrincipal(
        intent(state.fixture, "intent-principal"),
        state.membership,
        state.workload,
        1_000,
      );
    });
    const outer = reentrant.tenant.issuePrincipal(
      intent(state.fixture, "intent-principal"),
      state.membership,
      state.workload,
      1_000,
    );
    expect(nested?.outcome).toBe("issued");
    expect(outer).toEqual({ outcome: "denied", reason: "INVALID_REQUEST" });
    expect("context" in outer).toBe(false);
    expect(reentrant.tenant.validate(outer, 1_001)).toEqual({
      outcome: "denied",
      reason: "FORGED_CONTEXT",
    });
    expect(reentrant.tenant.validate(nested.context, 1_001)).toEqual(nested);
  });

  it("bounds retained replay identifiers", () => {
    const state = setup();
    for (let index = 0; index < tenantContextLimits.issuedContexts; index += 1) {
      expect(issuePrincipal(state).outcome).toBe("issued");
    }
    expect(issuePrincipal(state)).toEqual({
      outcome: "denied",
      reason: "INVALID_REQUEST",
    });
  });

  it("fails closed on malformed, oversized, proxied, or throwing server ID issuance", () => {
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps += 1;
          throw new Error("must not inspect");
        },
      },
    );
    for (const issuer of [
      () => undefined,
      () => "{}",
      () => ' {"decisionId":"d","requestId":"r","traceId":"t"}',
      () => "x".repeat(tenantContextLimits.idsJsonBytes + 1),
      () => proxy,
      () => {
        throw new Error("secret issuer failure");
      },
    ]) {
      const state = setup(undefined, issuer);
      const result = issuePrincipal(state);
      expect(result).toEqual({ outcome: "denied", reason: "INVALID_REQUEST" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
    expect(traps).toBe(0);
  });

  it("rechecks principal authority after every mutation performed during ID issuance", () => {
    const cases = [
      (state) =>
        state.fixture.replaceAuthority(
          "intent-principal",
          JSON.stringify(principalAuthority({ tenantAuthorityRevision: 4, tenantId: "tenant-b" })),
        ),
      (state) => state.authority.setMembershipEpoch("membership-a", 8),
      (state) => state.authority.reactivateCredential("session-a", 0),
      (state) => state.authority.revokeMembership("membership-a"),
      (state) => state.authority.revokeCredential("session-a"),
      (state) => state.authority.revokeService("fixture:workload"),
    ];
    for (const mutate of cases) {
      let state;
      const issuer = () => {
        mutate(state);
        return '{"decisionId":"decision-window","requestId":"request-window","traceId":"trace-window"}';
      };
      state = setup(undefined, issuer);
      const result = issuePrincipal(state);
      expect(result.outcome).toBe("denied");
      expect("context" in result).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });

  it("rechecks system authority, origin, and workload after ID issuance callbacks", () => {
    const cases = [
      (state) =>
        state.fixture.replaceAuthority(
          "intent-system",
          JSON.stringify(
            systemAuthority({
              systemOrigin: serviceProjection("other-a"),
              tenantAuthorityRevision: 4,
            }),
          ),
        ),
      (state) => state.authority.revokeService("fixture:origin"),
      (state) => state.authority.revokeService("fixture:workload"),
    ];
    for (const mutate of cases) {
      let state;
      const issuer = () => {
        mutate(state);
        return '{"decisionId":"decision-window","requestId":"request-window","traceId":"trace-window"}';
      };
      state = setup(undefined, issuer);
      const result = state.tenant.issueSystem(
        intent(state.fixture, "intent-system"),
        state.origin,
        state.workload,
        1_000,
      );
      expect(result.outcome).toBe("denied");
      expect("context" in result).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });

  it("does not reserve server IDs when later authorization denies", () => {
    const repeatedIds = () =>
      '{"decisionId":"decision-retry","requestId":"request-retry","traceId":"trace-retry"}';
    const state = setup([principalAuthority({ tenantId: "tenant-b" })], repeatedIds);
    const denied = issuePrincipal(state);
    expect(denied).toEqual({ outcome: "denied", reason: "ROLE_DENIED" });
    expect("context" in denied).toBe(false);
    state.fixture.replaceAuthority("intent-principal", JSON.stringify(principalAuthority()));
    expect(issuePrincipal(state).outcome).toBe("issued");
  });

  it("makes loose, wrapped, captured, and cross-wired authority construction unrepresentable", () => {
    const first = setup();
    const second = setup();
    const structuralSources = [
      Object.freeze({
        authentication: first.authentication,
        kind: "tenant-authority-source",
        readGeneration: first.authority.readAuthorityGeneration,
        tenantLookup: first.fixture.lookupTenantAuthority,
      }),
      Object.freeze({
        authentication: first.authentication,
        kind: "tenant-authority-source",
        readGeneration: () => first.authority.readAuthorityGeneration(),
        tenantLookup: (capability) => first.fixture.lookupTenantAuthority(capability),
      }),
      Object.freeze({
        authentication: first.authentication,
        kind: "tenant-authority-source",
        readGeneration: second.fixture.readAuthorityGeneration,
        tenantLookup: second.fixture.lookupTenantAuthority,
      }),
    ];
    expect(createTenantAuthorityBinder.length).toBe(1);
    for (const source of structuralSources)
      expect(() => createTenantAuthorityBinder(source)).toThrow(
        "INVALID_TENANT_AUTHORITY_BINDER_CONFIGURATION",
      );
    expect(() =>
      createTenantAuthorityBinder(
        first.authentication,
        second.fixture.lookupTenantAuthority,
        first.authority.readAuthorityGeneration,
        second.fixture.readAuthorityGeneration,
      ),
    ).toThrow("INVALID_TENANT_AUTHORITY_BINDER_CONFIGURATION");
  });

  it("reserves an origin before recursive registration can invoke nested callbacks", () => {
    const first = setup();
    const second = setup();
    const origin = {};
    const generation = {};
    let nestedGenerationCalls = 0;
    let nestedLookupCalls = 0;
    let nestedSource;
    const nested = authoritySourceRecord(
      second.authentication,
      origin,
      () => {
        nestedGenerationCalls += 1;
        return {};
      },
      () => {
        nestedLookupCalls += 1;
      },
    );
    const source = registerLocalC02AuthoritySource(
      authoritySourceRecord(
        first.authentication,
        origin,
        () => {
          expect(() => {
            nestedSource = registerLocalC02AuthoritySource(nested);
          }).toThrow("INVALID_LOCAL_C02_AUTHORITY_SOURCE");
          return generation;
        },
        first.fixture.lookupTenantAuthority,
      ),
    );
    expect(nestedSource).toBeUndefined();
    expect(nestedGenerationCalls).toBe(0);
    expect(nestedLookupCalls).toBe(0);
    expect(() => createTenantAuthorityBinder(source)).not.toThrow();
    expect(() => registerLocalC02AuthoritySource(nested)).toThrow(
      "INVALID_LOCAL_C02_AUTHORITY_SOURCE",
    );
    expect(nestedGenerationCalls).toBe(0);
  });

  it("rolls back only a failed outer reservation and permits one later registration", () => {
    const state = setup();
    const origin = {};
    expect(() =>
      registerLocalC02AuthoritySource(
        authoritySourceRecord(
          state.authentication,
          origin,
          () => {
            throw new Error("synthetic generation failure");
          },
          state.fixture.lookupTenantAuthority,
        ),
      ),
    ).toThrow("INVALID_LOCAL_C02_AUTHORITY_SOURCE");
    let generationCalls = 0;
    const valid = authoritySourceRecord(
      state.authentication,
      origin,
      () => {
        generationCalls += 1;
        return {};
      },
      state.fixture.lookupTenantAuthority,
    );
    const source = registerLocalC02AuthoritySource(valid);
    expect(generationCalls).toBe(1);
    expect(() => createTenantAuthorityBinder(source)).not.toThrow();
    expect(generationCalls).toBe(2);
    expect(() => registerLocalC02AuthoritySource(valid)).toThrow(
      "INVALID_LOCAL_C02_AUTHORITY_SOURCE",
    );
    expect(generationCalls).toBe(2);
  });

  it("rejects cloned, accessor, and proxied registration records without invoking accessors", () => {
    const state = setup();
    const valid = authoritySourceRecord(
      state.authentication,
      {},
      () => ({}),
      state.fixture.lookupTenantAuthority,
    );
    expect(() => registerLocalC02AuthoritySource({ ...valid })).toThrow(
      "INVALID_LOCAL_C02_AUTHORITY_SOURCE",
    );
    let accessorCalls = 0;
    const accessor = Object.freeze(
      Object.defineProperties(
        {},
        {
          authentication: { enumerable: true, value: state.authentication },
          origin: { enumerable: true, value: {} },
          readGeneration: {
            enumerable: true,
            get() {
              accessorCalls += 1;
              return () => ({});
            },
          },
          tenantLookup: { enumerable: true, value: state.fixture.lookupTenantAuthority },
        },
      ),
    );
    expect(() => registerLocalC02AuthoritySource(accessor)).toThrow(
      "INVALID_LOCAL_C02_AUTHORITY_SOURCE",
    );
    expect(accessorCalls).toBe(0);
    const proxy = new Proxy(valid, {
      getPrototypeOf() {
        throw new Error("secret proxy failure");
      },
    });
    expect(() => registerLocalC02AuthoritySource(proxy)).toThrow(
      "INVALID_LOCAL_C02_AUTHORITY_SOURCE",
    );
  });

  it("fails closed on absent or revoked authority and rejects malformed fixture state", () => {
    for (const mutate of [
      (state) => state.fixture.revokeAuthority("intent-principal"),
      (state) => state.fixture.deleteAuthority("intent-principal"),
    ]) {
      const state = setup();
      const capability = intent(state.fixture, "intent-principal");
      mutate(state);
      const result = state.tenant.issuePrincipal(
        capability,
        state.membership,
        state.workload,
        1_000,
      );
      expect(result.outcome).toBe("denied");
      expect("context" in result).toBe(false);
    }
    for (const fixtureJson of [
      "{}",
      ` ${JSON.stringify({ authorities: [principalAuthority()] })}`,
      "x".repeat(tenantContextLimits.authorityJsonBytes + 1),
    ])
      expect(() =>
        createLocalC02AuthorityPlane(identityFixtureJson(), fixtureJson, issuer, clientId, 0),
      ).toThrow();
  });

  it("returns one frozen composite plane with no authority source or loose registrar", () => {
    const plane = createLocalC02AuthorityPlane(
      identityFixtureJson(),
      JSON.stringify({ authorities: [principalAuthority()] }),
      issuer,
      clientId,
      0,
    );
    expect(Object.isFrozen(plane)).toBe(true);
    expect(Object.keys(plane).sort()).toEqual(["authentication", "binder", "identity", "tenant"]);
    expect(plane.source).toBeUndefined();
    expect(plane.registerLocalC02AuthoritySource).toBeUndefined();
  });

  it("exposes only tenant-context operations and no B04 effect port", () => {
    const state = setup();
    expect(Object.keys(state.tenant).sort()).toEqual(["issuePrincipal", "issueSystem", "validate"]);
    expect(state.tenant.issueServerIntent).toBeUndefined();
    expect(state.tenant.issuePrincipal.length).toBe(4);
    expect(state.tenant.issueSystem.length).toBe(4);
    expect(JSON.stringify(state.tenant)).not.toMatch(/queue|state|provider|vector|clock|scope/i);
  });

  it("rejects cloned or proxied binders and authority sources without traps", () => {
    const state = setup();
    expect(() => createTenantContextService({ ...state.binder }, reusableIds)).toThrow(
      "INVALID_TENANT_CONTEXT_CONFIGURATION",
    );
    let traps = 0;
    const proxy = new Proxy(state.binder, {
      get() {
        traps += 1;
        throw new Error("must not inspect");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("must not inspect");
      },
    });
    expect(() => createTenantContextService(proxy, reusableIds)).toThrow(
      "INVALID_TENANT_CONTEXT_CONFIGURATION",
    );
    const sourceProxy = new Proxy(
      { kind: "tenant-authority-source" },
      {
        get() {
          traps += 1;
          throw new Error("must not inspect");
        },
        getPrototypeOf() {
          traps += 1;
          throw new Error("must not inspect");
        },
      },
    );
    expect(() => createTenantAuthorityBinder(sourceProxy)).toThrow(
      "INVALID_TENANT_AUTHORITY_BINDER_CONFIGURATION",
    );
    expect(traps).toBe(0);
  });
});
