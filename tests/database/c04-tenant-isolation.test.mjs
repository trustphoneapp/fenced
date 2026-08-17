import { describe, expect, it } from "vitest";
import * as localAdapter from "../../packages/adapters-local/src/index.js";
import {
  createDatabaseTenantIsolationService,
  createTenantContextService,
} from "../../packages/application/src/index.js";

const tenantA = "a".repeat(48);
const tenantB = "b".repeat(48);
const eventId = "1".repeat(48);
const absentId = "f".repeat(48);
const payloadRef = "2".repeat(48);
const subjectRef = "3".repeat(48);
const purpose = "continuity.respond";
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

const serviceRecord = {
  clientId: "continuity-worker",
  credentialRef: "fixture:workload",
  expiresAtSeconds: 1_180,
  issuedAtSeconds: 900,
  issuer: "local://continuity-services",
  provider: "service",
  revoked: false,
  subject: "workload-a",
};

const authority = (tenantId = tenantA, serverPurpose = purpose, overrides = {}) => ({
  allowedRoles: ["member"],
  expiresAtSeconds: 1_140,
  intentId: "intent-read",
  mode: "principal",
  operation: "database.read",
  purpose: serverPurpose,
  revoked: false,
  tenantAuthorizationEpoch: 11,
  tenantAuthorityRevision: 3,
  tenantFence: "fence-a",
  tenantId,
  version: "tenant-context.v1",
  workload: {
    capability: "continuity.database.read",
    classification: "synthetic",
    clientId: serviceRecord.clientId,
    issuer: serviceRecord.issuer,
    provider: "service",
    subject: serviceRecord.subject,
  },
  ...overrides,
});

const databaseDefinition = (overrides = {}) => ({
  events: [
    {
      eventId,
      eventType: "interaction.appended",
      occurredAt: "2026-08-01T00:00:00.000Z",
      payloadRef,
      payloadRevision: "1",
      revision: "1",
      serverPurpose: purpose,
      subjectRef,
      tenantId: tenantA,
    },
  ],
  payloadAnchors: [{ payloadRef, revision: "1", serverPurpose: purpose, tenantId: tenantA }],
  ...overrides,
});

function setup({
  authorityOverrides = {},
  database = databaseDefinition(),
  serverPurpose = purpose,
  tenantId = tenantA,
} = {}) {
  const plane = localAdapter.createLocalC02AuthorityPlane(
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
          roles: ["member"],
          subject: "principal-a",
          tenantId,
        },
      ],
      services: [serviceRecord],
    }),
    JSON.stringify({ authorities: [authority(tenantId, serverPurpose, authorityOverrides)] }),
    issuer,
    clientId,
    0,
  );
  const principal = plane.authentication.authenticate(
    JSON.stringify({
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
    }),
    1_000,
  );
  if (principal.outcome !== "verified") throw new Error("expected principal");
  const membership = plane.authentication.resolveMembership(
    principal.principal,
    tenantId,
    7,
    1_000,
  );
  if (membership.outcome !== "resolved") throw new Error("expected membership");
  const workload = plane.authentication.authenticateService(
    plane.identity.verifyServiceCredential("fixture:workload"),
    1_000,
  );
  if (workload.outcome !== "verified") throw new Error("expected workload");
  const contexts = createTenantContextService(plane.binder, plane.tenant.issueTenantContextIds);
  const issued = contexts.issuePrincipal(
    plane.tenant.issueIntent("intent-read"),
    membership.membership,
    workload.service,
    1_000,
  );
  if (issued.outcome !== "issued") throw new Error(`expected tenant context: ${issued.reason}`);
  return {
    context: issued.context,
    contexts,
    database: localAdapter.createLocalC04Database(contexts, canonical(database)),
    plane,
  };
}

const expectDenied = (result) => {
  expect(result).toEqual({ outcome: "denied" });
  expect(Object.isFrozen(result)).toBe(true);
};

describe("C04.1 local database tenant-isolation preflight", () => {
  it("returns only frozen content-free event and payload-anchor projections", () => {
    const state = setup();
    const event = state.database.findEvent(state.context, eventId, "1", 1_001);
    expect(event).toEqual({
      event: {
        eventId,
        eventType: "interaction.appended",
        occurredAt: "2026-08-01T00:00:00.000Z",
        payload: { payloadRef, revision: "1" },
        revision: "1",
        subjectRef,
      },
      outcome: "found",
    });
    const anchor = state.database.findPayloadAnchor(state.context, payloadRef, "1", 1_001);
    expect(anchor).toEqual({
      anchor: { payloadRef, revision: "1" },
      outcome: "found",
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.event)).toBe(true);
    expect(Object.isFrozen(event.event.payload)).toBe(true);
    expect(Object.isFrozen(anchor)).toBe(true);
    expect(Object.isFrozen(anchor.anchor)).toBe(true);
    expect(JSON.stringify([event, anchor])).not.toMatch(/tenant|purpose|payload body|sql/iu);
  });

  it("makes foreign and absent identities the same frozen not-found result", () => {
    const foreign = setup({ tenantId: tenantB });
    const foreignEvent = foreign.database.findEvent(foreign.context, eventId, "1", 1_001);
    const absentEvent = foreign.database.findEvent(foreign.context, absentId, "1", 1_001);
    const foreignAnchor = foreign.database.findPayloadAnchor(
      foreign.context,
      payloadRef,
      "1",
      1_001,
    );
    const absentAnchor = foreign.database.findPayloadAnchor(foreign.context, absentId, "1", 1_001);
    expect(foreignEvent).toBe(absentEvent);
    expect(foreignAnchor).toBe(absentAnchor);
    expect(foreignEvent).toEqual({ outcome: "not_found" });
    expect(Object.isFrozen(foreignEvent)).toBe(true);
  });

  it("denies malformed IDs, revisions, time, and derived database scope", () => {
    const state = setup();
    for (const badId of ["", "A".repeat(48), "0".repeat(47), `${"0".repeat(48)}0`]) {
      expectDenied(state.database.findEvent(state.context, badId, "1", 1_001));
      expectDenied(state.database.findPayloadAnchor(state.context, badId, "1", 1_001));
    }
    for (const badRevision of [
      0,
      1,
      "",
      "0",
      "01",
      "18446744073709551616",
      "1.0",
      "9".repeat(10_000),
    ]) {
      expectDenied(state.database.findEvent(state.context, eventId, badRevision, 1_001));
      expectDenied(state.database.findPayloadAnchor(state.context, payloadRef, badRevision, 1_001));
    }
    expectDenied(state.database.findEvent(state.context, eventId, "1", -1));
    const badTenant = setup({ tenantId: "tenant-a" });
    expectDenied(badTenant.database.findEvent(badTenant.context, eventId, "1", 1_001));
    const badPurpose = setup({ serverPurpose: "Continuity/Respond" });
    expectDenied(badPurpose.database.findEvent(badPurpose.context, eventId, "1", 1_001));
  });

  it("rejects over-bound revisions before calling either reader method", () => {
    const state = setup();
    let calls = 0;
    const database = createDatabaseTenantIsolationService(
      state.contexts,
      Object.freeze({
        findEvent: () => {
          calls += 1;
          return undefined;
        },
        findPayloadAnchor: () => {
          calls += 1;
          return undefined;
        },
      }),
    );
    const overBound = "9".repeat(10_000);
    expectDenied(database.findEvent(state.context, eventId, overBound, 1_001));
    expectDenied(database.findPayloadAnchor(state.context, payloadRef, overBound, 1_001));
    expect(calls).toBe(0);
  });

  it("requires the exact database-read operation and workload capability before reading", () => {
    const cases = [
      { operation: "database.write" },
      {
        workload: {
          ...authority().workload,
          capability: "continuity.database.write",
        },
      },
    ];
    for (const authorityOverrides of cases) {
      const state = setup({ authorityOverrides });
      let calls = 0;
      const database = createDatabaseTenantIsolationService(
        state.contexts,
        Object.freeze({
          findEvent: () => {
            calls += 1;
            return undefined;
          },
          findPayloadAnchor: () => {
            calls += 1;
            return undefined;
          },
        }),
      );
      expectDenied(database.findEvent(state.context, eventId, "1", 1_001));
      expectDenied(database.findPayloadAnchor(state.context, payloadRef, "1", 1_001));
      expect(calls).toBe(0);
    }
  });

  it("revalidates authority after every event and anchor reader attempt", () => {
    for (const method of ["event", "anchor"]) {
      for (const mutation of ["revoke", "replace"]) {
        const state = setup();
        const mutate = () => {
          if (mutation === "revoke") state.plane.tenant.revokeAuthority("intent-read");
          else
            state.plane.tenant.replaceAuthority(
              "intent-read",
              JSON.stringify(authority(tenantA, purpose, { tenantAuthorityRevision: 4 })),
            );
          return mutation === "revoke"
            ? JSON.stringify(
                method === "event"
                  ? databaseDefinition().events[0]
                  : databaseDefinition().payloadAnchors[0],
              )
            : undefined;
        };
        const database = createDatabaseTenantIsolationService(
          state.contexts,
          Object.freeze({
            findEvent: () => (method === "event" ? mutate() : undefined),
            findPayloadAnchor: () => (method === "anchor" ? mutate() : undefined),
          }),
        );
        if (method === "event")
          expectDenied(database.findEvent(state.context, eventId, "1", 1_001));
        else expectDenied(database.findPayloadAnchor(state.context, payloadRef, "1", 1_001));
      }
    }
  });

  it("contains malformed and throwing validators before either reader", () => {
    const faults = [
      () => {
        throw new Error("validator fault");
      },
      () => undefined,
      () => null,
      () => ({ context: undefined, outcome: "issued" }),
      () => ({ context: null, outcome: "issued" }),
      () => ({
        context: { operation: "database.read", purpose, tenantId: tenantA },
        outcome: "issued",
      }),
      () =>
        new Proxy(
          {},
          {
            get() {
              throw new Error("validation result trap");
            },
          },
        ),
    ];
    for (const validate of faults) {
      let calls = 0;
      const database = createDatabaseTenantIsolationService(
        { validate },
        Object.freeze({
          findEvent: () => {
            calls += 1;
            return undefined;
          },
          findPayloadAnchor: () => {
            calls += 1;
            return undefined;
          },
        }),
      );
      const event = database.findEvent(undefined, eventId, "1", 1_001);
      const anchor = database.findPayloadAnchor(null, payloadRef, "1", 1_001);
      expectDenied(event);
      expectDenied(anchor);
      expect(event).toBe(anchor);
      expect(calls).toBe(0);
    }
  });

  it("contains every post-read validator fault after found, absent, or throwing readers", () => {
    const valid = {
      context: {
        operation: "database.read",
        purpose,
        tenantId: tenantA,
        workload: { capability: "continuity.database.read" },
      },
      outcome: "issued",
    };
    const faults = [
      () => {
        throw new Error("post-read validator fault");
      },
      () => undefined,
      () => null,
      () => ({
        context: { operation: "database.read", purpose, tenantId: tenantA },
        outcome: "issued",
      }),
    ];
    let sharedDenied;
    for (const method of ["event", "anchor"]) {
      for (const readerOutcome of ["found", "absent", "throw"]) {
        for (const fault of faults) {
          let validations = 0;
          let readerCalls = 0;
          const validate = () => {
            validations += 1;
            return validations === 1 ? valid : fault();
          };
          const read = (row) => {
            readerCalls += 1;
            if (readerOutcome === "throw") throw new Error("reader fault");
            return readerOutcome === "found" ? JSON.stringify(row) : undefined;
          };
          const database = createDatabaseTenantIsolationService(
            { validate },
            Object.freeze({
              findEvent: () => read(databaseDefinition().events[0]),
              findPayloadAnchor: () => read(databaseDefinition().payloadAnchors[0]),
            }),
          );
          const result =
            method === "event"
              ? database.findEvent({}, eventId, "1", 1_001)
              : database.findPayloadAnchor({}, payloadRef, "1", 1_001);
          expectDenied(result);
          if (sharedDenied === undefined) sharedDenied = result;
          else expect(result).toBe(sharedDenied);
          expect(readerCalls).toBe(1);
          expect(validations).toBe(2);
        }
      }
    }
  });

  it("denies forged, expired, revoked, stale, and replaced C02 contexts", () => {
    const forged = setup();
    expectDenied(forged.database.findEvent({ ...forged.context }, eventId, "1", 1_001));
    expectDenied(forged.database.findEvent(null, eventId, "1", 1_001));

    const expired = setup();
    expectDenied(expired.database.findEvent(expired.context, eventId, "1", 1_140));

    const revoked = setup();
    revoked.plane.tenant.revokeAuthority("intent-read");
    expectDenied(revoked.database.findEvent(revoked.context, eventId, "1", 1_001));

    const replaced = setup();
    replaced.plane.tenant.replaceAuthority(
      "intent-read",
      JSON.stringify(authority(tenantA, purpose, { tenantAuthorityRevision: 4 })),
    );
    expectDenied(replaced.database.findEvent(replaced.context, eventId, "1", 1_001));

    const stale = setup();
    stale.plane.tenant.replaceAuthority(
      "intent-read",
      JSON.stringify(authority(tenantA, purpose, { tenantFence: "fence-b" })),
    );
    stale.plane.tenant.replaceAuthority("intent-read", JSON.stringify(authority()));
    expectDenied(stale.database.findEvent(stale.context, eventId, "1", 1_001));
  });

  it("rejects invalid, duplicate, over-bound, and cross-scope fixture rows", () => {
    const create = (definition) => setup({ database: definition });
    expect(() =>
      create({
        ...databaseDefinition(),
        events: [
          databaseDefinition().events[0],
          { ...databaseDefinition().events[0], serverPurpose: "other" },
        ],
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    expect(() =>
      create({
        ...databaseDefinition(),
        payloadAnchors: [
          databaseDefinition().payloadAnchors[0],
          { ...databaseDefinition().payloadAnchors[0], serverPurpose: "other" },
        ],
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    expect(() =>
      create({
        ...databaseDefinition(),
        events: [
          {
            ...databaseDefinition().events[0],
            serverPurpose: "other",
          },
        ],
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    expect(() =>
      create({
        ...databaseDefinition(),
        payloadAnchors: [{ ...databaseDefinition().payloadAnchors[0], revision: "0" }],
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    expect(() =>
      create({
        ...databaseDefinition(),
        events: [{ ...databaseDefinition().events[0], revision: "9".repeat(21) }],
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    for (const occurredAt of ["+010000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z"])
      expect(() =>
        create({
          ...databaseDefinition(),
          events: [{ ...databaseDefinition().events[0], occurredAt }],
        }),
      ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    expect(() =>
      create({
        ...databaseDefinition(),
        payloadAnchors: [{ ...databaseDefinition().payloadAnchors[0], revision: "9".repeat(21) }],
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
    expect(() =>
      create({
        events: [],
        payloadAnchors: Array.from(
          { length: localAdapter.localC04DatabaseLimits.payloadAnchors + 1 },
          (_, index) => ({
            payloadRef: index.toString(16).padStart(48, "0"),
            revision: "1",
            serverPurpose: purpose,
            tenantId: tenantA,
          }),
        ),
      }),
    ).toThrow("INVALID_C04_DATABASE_FIXTURE");
  });

  it("accepts payloadless events and rejects either partial payload identity", () => {
    const payloadless = { ...databaseDefinition().events[0] };
    delete payloadless.payloadRef;
    delete payloadless.payloadRevision;
    const state = setup({ database: { events: [payloadless], payloadAnchors: [] } });
    expect(state.database.findEvent(state.context, eventId, "1", 1_001)).toEqual({
      event: {
        eventId,
        eventType: "interaction.appended",
        occurredAt: "2026-08-01T00:00:00.000Z",
        revision: "1",
        subjectRef,
      },
      outcome: "found",
    });
    for (const missing of ["payloadRef", "payloadRevision"]) {
      const partial = { ...databaseDefinition().events[0] };
      delete partial[missing];
      expect(() => setup({ database: { ...databaseDefinition(), events: [partial] } })).toThrow(
        "INVALID_C04_DATABASE_FIXTURE",
      );
    }
  });

  it("denies malformed, oversized, mutable-object, and substituted encoded rows", () => {
    const state = setup();
    const validEvent = databaseDefinition().events[0];
    const validAnchor = databaseDefinition().payloadAnchors[0];
    const service = (event, anchor) =>
      createDatabaseTenantIsolationService(
        state.contexts,
        Object.freeze({ findEvent: () => event, findPayloadAnchor: () => anchor }),
      );
    const eventCases = [
      "{",
      JSON.stringify({ ...validEvent, extra: true }),
      JSON.stringify({ ...validEvent, subjectRef: undefined }),
      `${JSON.stringify(validEvent).slice(0, -1)},"__proto__":"accessor-equivalent"}`,
      `${JSON.stringify(validEvent).slice(0, -1)},"eventId":"${eventId}"}`,
      JSON.stringify(validEvent).replace('"eventId"', '"event\\u0049d"'),
      JSON.stringify(validEvent).replace("{", "{ "),
      JSON.stringify({ ...validEvent, tenantId: tenantB }),
      JSON.stringify({ ...validEvent, eventId: absentId }),
      JSON.stringify({ ...validEvent, revision: "2" }),
      JSON.stringify({ ...validEvent, revision: "9".repeat(21) }),
      JSON.stringify({ ...validEvent, serverPurpose: "other" }),
      JSON.stringify({ ...validEvent, extra: "x".repeat(3_000) }),
      JSON.stringify({ ...validEvent, occurredAt: "2026-08-01T00:00:00Z" }),
      JSON.stringify({ ...validEvent, occurredAt: "2026-02-30T00:00:00.000Z" }),
    ];
    for (const encoded of eventCases)
      expectDenied(
        service(encoded, JSON.stringify(validAnchor)).findEvent(state.context, eventId, "1", 1_001),
      );

    const anchorCases = [
      "{",
      JSON.stringify({ ...validAnchor, extra: true }),
      JSON.stringify({ ...validAnchor, tenantId: undefined }),
      `${JSON.stringify(validAnchor).slice(0, -1)},"constructor":"accessor-equivalent"}`,
      `${JSON.stringify(validAnchor).slice(0, -1)},"payloadRef":"${payloadRef}"}`,
      JSON.stringify(validAnchor).replace('"payloadRef"', '"payload\\u0052ef"'),
      JSON.stringify(validAnchor).replace("{", "{ "),
      JSON.stringify({ ...validAnchor, tenantId: tenantB }),
      JSON.stringify({ ...validAnchor, payloadRef: absentId }),
      JSON.stringify({ ...validAnchor, revision: "2" }),
      JSON.stringify({ ...validAnchor, revision: "9".repeat(21) }),
      JSON.stringify({ ...validAnchor, serverPurpose: "other" }),
      JSON.stringify({ ...validAnchor, extra: "x".repeat(1_000) }),
    ];
    for (const encoded of anchorCases)
      expectDenied(
        service(JSON.stringify(validEvent), encoded).findPayloadAnchor(
          state.context,
          payloadRef,
          "1",
          1_001,
        ),
      );

    let accessed = false;
    const proxy = new Proxy(
      {},
      {
        get() {
          accessed = true;
          throw new Error("must not inspect object rows");
        },
      },
    );
    expectDenied(service(proxy, proxy).findEvent(state.context, eventId, "1", 1_001));
    expectDenied(service(proxy, proxy).findPayloadAnchor(state.context, payloadRef, "1", 1_001));
    expect(accessed).toBe(false);
  });

  it("exposes only the two fixed read methods and no selector or mutable surface", () => {
    const state = setup();
    expect(Object.keys(state.database).sort()).toEqual(["findEvent", "findPayloadAnchor"]);
    expect(state.database.findEvent.length).toBe(4);
    expect(state.database.findPayloadAnchor.length).toBe(4);
    for (const key of [
      "count",
      "list",
      "query",
      "read",
      "register",
      "reset",
      "role",
      "runtime",
      "session",
      "setup",
      "sql",
      "table",
      "write",
    ])
      expect(key in state.database).toBe(false);
    expect(Object.isFrozen(state.database)).toBe(true);
  });
});
