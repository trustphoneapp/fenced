import { describe, expect, it } from "vitest";
import {
  createLocalCognitoShapedSyntheticVerifier,
  createLocalIdentityAuthorityFixture,
  localCognitoSyntheticLimits,
} from "../../packages/adapters-local/src/index.js";
import {
  authenticationLimits,
  createAuthenticationService,
} from "../../packages/application/src/index.js";
import {
  ownDataEntries,
  ownDataKeys,
  readOwnData,
  writeOwnData,
} from "../../scripts/safe-own-data.mjs";
import {
  defineSyntheticProperty,
  mergeSyntheticRecords,
} from "../../scripts/synthetic-test-data.mjs";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_synthetic";
const clientId = "synthetic-client";
const credential = "fixture:principal-a";
const baseClaims = Object.freeze({
  amr: ["pwd"],
  auth_time: 900,
  client_id: clientId,
  exp: 1_100,
  iat: 950,
  iss: issuer,
  jti: "session-a",
  sub: "principal-a",
  token_use: "access",
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${ownDataKeys(value)
    .slice()
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(readOwnData(value, String(key)))}`)
    .join(",")}}`;
}

const fixtureDocument = (fixtures) => canonical({ fixtures });
const fixture = (rawClaims = baseClaims, credentialRef = credential) => ({
  credentialRef,
  rawClaims,
});
const projection = (overrides = {}) =>
  JSON.stringify(
    mergeSyntheticRecords(
      {
        authenticationMethods: ["pwd"],
        authenticatedAtSeconds: 900,
        clientId,
        credentialId: "session-a",
        expiresAtSeconds: 1_100,
        issuedAtSeconds: 950,
        issuer,
        provider: "cognito",
        subject: "principal-a",
        tokenUse: "access",
      },
      overrides,
    ),
  );
const serviceFor = ({
  authority,
  expectedIssuer = issuer,
  expectedClientId = clientId,
  skew = 0,
} = {}) =>
  createAuthenticationService(
    expectedIssuer,
    expectedClientId,
    skew,
    authority?.lookupIdentityAuthority,
    authority?.lookupService,
  );
const resultFor = (verifiedProjection, options = {}) => {
  const { expectedIssuer = issuer, expectedClientId = clientId, skew = 0 } = options;
  const now = "now" in options ? options.now : 1_000;
  return serviceFor({ expectedIssuer, expectedClientId, skew }).authenticate(
    verifiedProjection,
    now,
  );
};
const deniedReason = (verifiedProjection, expected, options) => {
  const result = resultFor(verifiedProjection, options);
  expect(result).toEqual({ outcome: "denied", reason: expected });
  return result;
};
const localVerifier = (fixtures = [fixture()]) =>
  createLocalCognitoShapedSyntheticVerifier(fixtureDocument(fixtures));
const verifiedProjectionFor = (verifier, credentialValue = credential) => verifier(credentialValue);

const membership = (overrides = {}) =>
  mergeSyntheticRecords(
    {
      clientId,
      expiresAtSeconds: 1_080,
      issuer,
      membershipEpoch: 7,
      membershipId: "membership-a",
      provider: "cognito",
      revoked: false,
      roles: ["member", "operator"],
      subject: "principal-a",
      tenantId: "tenant-synthetic",
    },
    overrides,
  );
const credentialAuthority = (overrides = {}) =>
  mergeSyntheticRecords(
    {
      clientId,
      credentialId: "session-a",
      issuer,
      provider: "cognito",
      revoked: false,
      subject: "principal-a",
      validAfterSeconds: 0,
    },
    overrides,
  );
const serviceIdentity = (overrides = {}) =>
  mergeSyntheticRecords(
    {
      clientId: "worker-client",
      credentialRef: "fixture:worker-a",
      expiresAtSeconds: 1_080,
      issuedAtSeconds: 900,
      issuer: "local://synthetic-workloads",
      provider: "service",
      revoked: false,
      subject: "worker-a",
    },
    overrides,
  );
const authorityFixture = ({
  credentials = [credentialAuthority()],
  memberships = [membership()],
  services = [serviceIdentity()],
} = {}) => createLocalIdentityAuthorityFixture(canonical({ credentials, memberships, services }));
const authenticatedPrincipal = (service, projectionValue = projection()) => {
  const result = service.authenticate(projectionValue, 1_000);
  if (result.outcome !== "verified") throw new Error("expected authenticated principal");
  return result.principal;
};

function rawClaimsAtBytes(target, subject = "principal-a") {
  for (let count = 1; count <= 9; count += 1) {
    for (let tail = 0; tail <= localCognitoSyntheticLimits.stringBytes; tail += 1) {
      const value = mergeSyntheticRecords(baseClaims, { sub: subject });
      for (let index = 0; index < count; index += 1) {
        writeOwnData(
          value,
          `p${String(index).padStart(2, "0")}`,
          "x".repeat(index === count - 1 ? tail : localCognitoSyntheticLimits.stringBytes),
        );
      }
      if (canonical(value).length === target) return value;
    }
  }
  throw new Error(`unable to construct ${String(target)}-byte raw claims`);
}

function fixtureAtBytes(target) {
  const fixtures = [];
  for (let index = 0; index < localCognitoSyntheticLimits.credentialCount - 1; index += 1) {
    fixtures.push(
      fixture(
        rawClaimsAtBytes(localCognitoSyntheticLimits.rawClaimsBytes, `principal-${index}`),
        `fixture:${index}`,
      ),
    );
  }
  const baseline = fixtureDocument(fixtures.concat(fixture(baseClaims, "fixture:last"))).length;
  const baselineRaw = canonical(baseClaims).length;
  const requiredRaw = baselineRaw + (target - baseline);
  fixtures.push(fixture(rawClaimsAtBytes(requiredRaw, "principal-last"), "fixture:last"));
  const result = fixtureDocument(fixtures);
  if (result.length !== target) throw new Error("fixture boundary construction failed");
  return result;
}

describe("C01 R11 primitive identity and claims boundary", () => {
  it("returns a deterministic deeply frozen principal and strips authority-shaped raw claims", () => {
    const verifier = localVerifier([
      fixture(
        mergeSyntheticRecords(baseClaims, {
          "custom:tenant": "tenant-must-not-cross",
          email: "ignored@example.invalid",
          groups: ["admin"],
          profile: { display: "ignored" },
          purpose: "continuity.respond",
          role: "owner",
          scope: "openid privileged",
        }),
      ),
    ]);
    const settledProjection = verifiedProjectionFor(verifier);
    const first = resultFor(settledProjection);
    const second = resultFor(settledProjection);
    expect(first).toEqual({
      outcome: "verified",
      principal: {
        identity: {
          clientId,
          issuer,
          provider: "cognito",
          subject: "principal-a",
        },
        session: {
          assurance: "single_factor",
          authenticatedAtSeconds: 900,
          credentialId: "session-a",
          expiresAtSeconds: 1_100,
          issuedAtSeconds: 950,
        },
      },
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(
      /raw|custom|tenant|role|purpose|groups|scope|email|profile|token/i,
    );
    expect(Object.isFrozen(first)).toBe(true);
    if (first.outcome !== "verified") throw new Error("expected verified");
    expect(Object.isFrozen(first.principal)).toBe(true);
    expect(Object.isFrozen(first.principal.session)).toBe(true);
  });

  it("rejects nonprimitive settled projections without inspection or execution", () => {
    let traps = 0;
    let calls = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps += 1;
          throw new Error("must not inspect");
        },
        getOwnPropertyDescriptor() {
          traps += 1;
          throw new Error("must not inspect");
        },
        getPrototypeOf() {
          traps += 1;
          throw new Error("must not inspect");
        },
        ownKeys() {
          traps += 1;
          throw new Error("must not inspect");
        },
      },
    );
    const thenable = {};
    defineSyntheticProperty(thenable, "then", {
      get() {
        traps += 1;
        throw new Error("must not inspect thenable");
      },
    });
    const basePromise = Promise.resolve(projection());
    class HostilePromise extends Promise {
      static get [Symbol.species]() {
        traps += 1;
        throw new Error("must not inspect species");
      }
    }
    const subclass = new HostilePromise((resolve) => resolve(projection()));
    const rejectedPromise = Promise.reject(new Error("already-handled-outside-validator"));
    void rejectedPromise.catch(() => undefined);
    const wrappedPromise = new Proxy(Promise.resolve(projection()), {
      get() {
        traps += 1;
        throw new Error("must not inspect wrapped promise");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("must not inspect wrapped promise");
      },
    });
    const executable = () => {
      calls += 1;
      return projection();
    };
    for (const output of [
      proxy,
      {},
      [],
      Promise.resolve(projection()),
      rejectedPromise,
      basePromise,
      subclass,
      wrappedPromise,
      thenable,
      1,
      1n,
      Symbol("x"),
      executable,
    ]) {
      deniedReason(output, "MALFORMED_PROJECTION");
    }
    expect(traps).toBe(0);
    expect(calls).toBe(0);
  });

  it("rejects nonnumber server time without inspection or execution", () => {
    let traps = 0;
    let calls = 0;
    const timeProxy = new Proxy(
      {},
      {
        get() {
          traps += 1;
          throw new Error("must not inspect");
        },
        ownKeys() {
          traps += 1;
          throw new Error("must not inspect");
        },
      },
    );
    const executableTime = () => {
      calls += 1;
      return 1_000;
    };
    for (const now of [timeProxy, executableTime, "1000", 1_000n, null, undefined]) {
      deniedReason(projection(), "INVALID_SERVER_CONFIGURATION", { now });
    }
    expect(traps).toBe(0);
    expect(calls).toBe(0);
  });

  it.each([
    ["issuer", { issuer: `${issuer}-wrong` }, "ISSUER_MISMATCH"],
    ["client", { clientId: `${clientId}-wrong` }, "CLIENT_ID_MISMATCH"],
    ["ID token", { tokenUse: "id" }, "TOKEN_USE_MISMATCH"],
    ["expired", { expiresAtSeconds: 1_000 }, "EXPIRED"],
    ["future issued", { issuedAtSeconds: 1_001 }, "NOT_YET_ACTIVE"],
    [
      "future authentication",
      { authenticatedAtSeconds: 1_001, issuedAtSeconds: 1_001 },
      "NOT_YET_ACTIVE",
    ],
    ["reversed authentication", { authenticatedAtSeconds: 951 }, "MALFORMED_PROJECTION"],
    ["empty lifetime", { expiresAtSeconds: 950 }, "MALFORMED_PROJECTION"],
  ])("denies %s with a closed reason", (_name, overrides, reason) => {
    deniedReason(projection(overrides), reason);
  });

  it.each([
    ["expiry equality", 0, { expiresAtSeconds: 1_000 }, "EXPIRED"],
    ["after expiry boundary", 0, { expiresAtSeconds: 1_001 }, "verified"],
    ["skewed expiry equality", 5, { expiresAtSeconds: 995 }, "EXPIRED"],
    ["after skewed expiry", 5, { expiresAtSeconds: 996 }, "verified"],
    ["issued at skew boundary", 5, { issuedAtSeconds: 1_005 }, "verified"],
    ["issued beyond skew", 5, { issuedAtSeconds: 1_006 }, "NOT_YET_ACTIVE"],
  ])("applies exact time boundary: %s", (_name, skew, overrides, outcome) => {
    const result = resultFor(projection(overrides), { skew });
    expect(result.outcome === "verified" ? "verified" : result.reason).toBe(outcome);
  });

  it("rejects duplicate, reordered, whitespace, escaped, and unknown projection JSON", () => {
    const valid = projection();
    const duplicate = valid.replace(
      `"clientId":"${clientId}"`,
      `"clientId":"duplicate","clientId":"${clientId}"`,
    );
    const reordered = `{"tokenUse":"access",${valid.slice(1, valid.lastIndexOf(',"tokenUse"'))}}`;
    const escaped = valid.replace("principal-a", "principal-\\u0061");
    const alternateNumber = valid.replace('"issuedAtSeconds":950', '"issuedAtSeconds":9.5e2');
    const unknown = valid.replace('"tokenUse":"access"', '"tenantId":"x","tokenUse":"access"');
    for (const value of [` ${valid}`, duplicate, reordered, escaped, alternateNumber, unknown]) {
      deniedReason(value, "MALFORMED_PROJECTION");
    }
    expect(resultFor(valid).outcome).toBe("verified");
  });

  it("enforces settled verification and projection primitive byte boundaries", () => {
    const first = deniedReason(undefined, "VERIFICATION_FAILED");
    const second = deniedReason(undefined, "VERIFICATION_FAILED");
    expect(first).toEqual(second);
    const maximumIssuer = "i".repeat(authenticationLimits.issuerBytes);
    const maximumClient = "c".repeat(authenticationLimits.clientIdBytes);
    const exactProjection = projection({
      authenticatedAtSeconds: Number.MAX_SAFE_INTEGER - 2,
      clientId: maximumClient,
      expiresAtSeconds: Number.MAX_SAFE_INTEGER,
      issuedAtSeconds: Number.MAX_SAFE_INTEGER - 1,
      issuer: maximumIssuer,
      subject: "s".repeat(authenticationLimits.subjectBytes),
    });
    expect(exactProjection.length).toBe(authenticationLimits.projectionJsonBytes);
    deniedReason(exactProjection, "NOT_YET_ACTIVE", {
      expectedClientId: maximumClient,
      expectedIssuer: maximumIssuer,
    });
    deniedReason("x".repeat(authenticationLimits.projectionJsonBytes + 1), "MALFORMED_PROJECTION");
  });

  it("returns stable content-free denials for settled verification failure and invalid time", () => {
    const secret = "external-secret-that-must-not-echo";
    const verificationFailure = deniedReason(undefined, "VERIFICATION_FAILED");
    const invalidTime = deniedReason(projection(), "INVALID_SERVER_CONFIGURATION", {
      now: Number.NaN,
    });
    expect(JSON.stringify([verificationFailure, invalidTime])).not.toContain(secret);
    expect(verificationFailure).toEqual(deniedReason(undefined, "VERIFICATION_FAILED"));
    expect(invalidTime).toEqual(
      deniedReason(projection(), "INVALID_SERVER_CONFIGURATION", { now: Number.NaN }),
    );
  });

  it("validates server primitives before capture", () => {
    for (const args of [
      ["", clientId, 0],
      [issuer, "", 0],
      [issuer, clientId, authenticationLimits.clockSkewSeconds + 1],
    ]) {
      expect(() => createAuthenticationService(args[0], args[1], args[2])).toThrow(
        "INVALID_AUTHENTICATION_CONFIGURATION",
      );
    }
  });

  it("keeps subjects separated across opaque fixture credentials", () => {
    const verifier = localVerifier([
      fixture(baseClaims, "fixture:a"),
      fixture(mergeSyntheticRecords(baseClaims, { sub: "principal-b" }), "fixture:b"),
    ]);
    const a = resultFor(verifiedProjectionFor(verifier, "fixture:a"));
    const b = resultFor(verifiedProjectionFor(verifier, "fixture:b"));
    expect(a.outcome === "verified" && a.principal.identity.subject).toBe("principal-a");
    expect(b.outcome === "verified" && b.principal.identity.subject).toBe("principal-b");
  });

  it("maps an externally settled unknown credential to verification failure without disclosure", () => {
    const result = resultFor(verifiedProjectionFor(localVerifier(), "fixture:unknown-secret"));
    expect(result).toEqual({ outcome: "denied", reason: "VERIFICATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("unknown-secret");
  });

  it("rejects non-string fixture values without proxy or getter inspection", () => {
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps += 1;
          throw new Error("must not inspect");
        },
        ownKeys() {
          traps += 1;
          throw new Error("must not inspect");
        },
      },
    );
    const getter = {};
    defineSyntheticProperty(getter, "fixtures", {
      enumerable: true,
      get() {
        traps += 1;
        throw new Error("must not inspect");
      },
    });
    for (const value of [proxy, getter, {}, [], 1, 1n, Symbol("x"), () => "x"]) {
      expect(() => createLocalCognitoShapedSyntheticVerifier(value)).toThrow(
        "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
      );
    }
    expect(traps).toBe(0);
  });

  it("requires exact canonical fixture JSON", () => {
    const valid = fixtureDocument([fixture()]);
    const duplicate = valid.replace('{"fixtures":', '{"fixtures":[],"fixtures":');
    const reordered = `{"fixtures":[{"rawClaims":${canonical(baseClaims)},"credentialRef":"${credential}"}]}`;
    const escaped = valid.replace("principal-a", "principal-\\u0061");
    for (const value of [` ${valid}`, `${valid}\n`, duplicate, reordered, escaped]) {
      expect(() => createLocalCognitoShapedSyntheticVerifier(value)).toThrow(
        "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
      );
    }
    expect(typeof createLocalCognitoShapedSyntheticVerifier(valid)).toBe("function");
  });

  it("enforces fixture JSON and credential-count boundaries", () => {
    const exact = fixtureAtBytes(localCognitoSyntheticLimits.fixtureJsonBytes);
    expect(exact.length).toBe(localCognitoSyntheticLimits.fixtureJsonBytes);
    expect(typeof createLocalCognitoShapedSyntheticVerifier(exact)).toBe("function");
    expect(() => createLocalCognitoShapedSyntheticVerifier(`${exact} `)).toThrow(
      "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
    );
    const exactCount = Array.from(
      { length: localCognitoSyntheticLimits.credentialCount },
      (_entry, index) =>
        fixture(
          mergeSyntheticRecords(baseClaims, { sub: `principal-${index}` }),
          `fixture:${index}`,
        ),
    );
    expect(typeof localVerifier(exactCount)).toBe("function");
    expect(() =>
      localVerifier(
        Array.from(exactCount).concat([
          fixture(mergeSyntheticRecords(baseClaims, { sub: "over" }), "fixture:over"),
        ]),
      ),
    ).toThrow("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
  });

  it("enforces raw string, array, property, and raw-byte boundaries", () => {
    expect(
      typeof localVerifier([
        fixture(mergeSyntheticRecords(baseClaims, { extra: "x".repeat(256) })),
      ]),
    ).toBe("function");
    expect(() =>
      localVerifier([fixture(mergeSyntheticRecords(baseClaims, { extra: "x".repeat(257) }))]),
    ).toThrow("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
    expect(
      typeof localVerifier([
        fixture(mergeSyntheticRecords(baseClaims, { list: Array.from({ length: 16 }, () => 0) })),
      ]),
    ).toBe("function");
    expect(() =>
      localVerifier([
        fixture(mergeSyntheticRecords(baseClaims, { list: Array.from({ length: 17 }, () => 0) })),
      ]),
    ).toThrow("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
    const sixteenProperties = mergeSyntheticRecords(
      baseClaims,
      Object.fromEntries(Array.from({ length: 7 }, (_entry, index) => [`x${index}`, index])),
    );
    expect(typeof localVerifier([fixture(sixteenProperties)])).toBe("function");
    expect(() =>
      localVerifier([fixture(mergeSyntheticRecords(sixteenProperties, { over: true }))]),
    ).toThrow("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
    expect(
      typeof localVerifier([fixture(rawClaimsAtBytes(localCognitoSyntheticLimits.rawClaimsBytes))]),
    ).toBe("function");
    expect(() =>
      localVerifier([fixture(rawClaimsAtBytes(localCognitoSyntheticLimits.rawClaimsBytes + 1))]),
    ).toThrow("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
  });

  it("enforces raw and total node counts including primitives", () => {
    const arrays = Object.fromEntries(
      Array.from({ length: 7 }, (_entry, index) => [
        `a${index}`,
        Array.from({ length: 16 }, () => 0),
      ]),
    );
    const rawAt128 = mergeSyntheticRecords(arrays, {
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
      p4: 0,
      p5: 0,
      p6: 0,
      p7: 0,
    });
    expect(typeof localVerifier([fixture(rawAt128)])).toBe("function");
    expect(() => localVerifier([fixture(mergeSyntheticRecords(rawAt128, { over: 0 }))])).toThrow(
      "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
    );

    const rawAt81 = mergeSyntheticRecords(
      Object.fromEntries(
        Array.from({ length: 5 }, (_entry, index) => [
          `a${index}`,
          Array.from({ length: index === 4 ? 11 : 16 }, () => 0),
        ]),
      ),
    );
    expect(
      typeof localVerifier([fixture(rawAt81, "fixture:a"), fixture(rawAt81, "fixture:b")]),
    ).toBe("function");
    expect(() =>
      localVerifier([
        fixture(mergeSyntheticRecords(rawAt81, { over: 0 }), "fixture:a"),
        fixture(rawAt81, "fixture:b"),
      ]),
    ).toThrow("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
  });

  it("enforces exact raw nesting depth", () => {
    const atBoundary = { level1: { level2: { level3: { value: "x" } } } };
    const overBoundary = { level1: { level2: { level3: { level4: { value: "x" } } } } };
    expect(typeof localVerifier([fixture(atBoundary)])).toBe("function");
    expect(() => localVerifier([fixture(overBoundary)])).toThrow(
      "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
    );
  });

  it("rejects huge strings and arrays before any parsed traversal can be accepted", () => {
    expect(() => createLocalCognitoShapedSyntheticVerifier("x".repeat(1_048_576))).toThrow(
      "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
    );
    const hugeArray = `{"fixtures":[${"0,".repeat(99_999)}0]}`;
    expect(hugeArray.length).toBeGreaterThan(localCognitoSyntheticLimits.fixtureJsonBytes);
    expect(() => createLocalCognitoShapedSyntheticVerifier(hugeArray)).toThrow(
      "INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE",
    );
  });

  it("derives assurance only from the exact normalized verified AMR", () => {
    expect(resultFor(projection()).principal.session.assurance).toBe("single_factor");
    const multi = resultFor(projection({ authenticationMethods: ["mfa", "pwd"] }));
    expect(multi.outcome === "verified" && multi.principal.session.assurance).toBe("multi_factor");
    const verifier = localVerifier([
      fixture(mergeSyntheticRecords(baseClaims, { amr: ["pwd", "mfa"] })),
    ]);
    expect(resultFor(verifiedProjectionFor(verifier))).toEqual(multi);
    for (const methods of [[], ["mfa"], ["pwd", "pwd"], ["sms_mfa", "pwd"]]) {
      deniedReason(projection({ authenticationMethods: methods }), "MALFORMED_PROJECTION");
    }
  });

  it("resolves one live server-owned membership with bounded roles and effective expiry", () => {
    const authority = authorityFixture();
    const service = serviceFor({ authority });
    const principal = authenticatedPrincipal(service);
    const result = service.resolveMembership(principal, "tenant-synthetic", 7, 1_000);
    expect(result).toEqual({
      membership: {
        assurance: "single_factor",
        authorityRevision: 1,
        effectiveExpiresAtSeconds: 1_080,
        membershipEpoch: 7,
        membershipId: "membership-a",
        principal,
        roles: ["member", "operator"],
        tenantId: "tenant-synthetic",
      },
      outcome: "resolved",
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome !== "resolved") throw new Error("expected membership");
    expect(Object.isFrozen(result.membership)).toBe(true);
    expect(Object.isFrozen(result.membership.roles)).toBe(true);
    expect(result.membership.effectiveExpiresAtSeconds).toBeLessThan(
      principal.session.expiresAtSeconds,
    );
  });

  it("brands memberships and revalidates the exact live authority snapshot", () => {
    const authority = authorityFixture();
    const service = serviceFor({ authority });
    const principal = authenticatedPrincipal(service);
    const resolved = service.resolveMembership(principal, "tenant-synthetic", 7, 1_000);
    if (resolved.outcome !== "resolved") throw new Error("expected membership");
    expect(service.validateMembership(resolved.membership, 1_000)).toEqual(resolved);
    expect(service.validateMembership({ ...resolved.membership }, 1_000)).toEqual({
      outcome: "denied",
      reason: "FORGED_IDENTITY",
    });
    let traps = 0;
    const proxy = new Proxy(resolved.membership, {
      get() {
        traps += 1;
        throw new Error("must not inspect");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("must not inspect");
      },
    });
    expect(service.validateMembership(proxy, 1_000)).toEqual({
      outcome: "denied",
      reason: "FORGED_IDENTITY",
    });
    expect(traps).toBe(0);
    authority.setMembershipEpoch("membership-a", 8);
    expect(service.validateMembership(resolved.membership, 1_000).outcome).toBe("denied");

    const revokedAuthority = authorityFixture();
    const revokedService = serviceFor({ authority: revokedAuthority });
    const current = revokedService.resolveMembership(
      authenticatedPrincipal(revokedService),
      "tenant-synthetic",
      7,
      1_000,
    );
    if (current.outcome !== "resolved") throw new Error("expected membership");
    revokedAuthority.revokeMembership("membership-a");
    expect(revokedService.validateMembership(current.membership, 1_000)).toEqual({
      outcome: "denied",
      reason: "MEMBERSHIP_REVOKED",
    });
  });

  it("rechecks live credential revocation and valid-after state before membership", () => {
    const missingAuthority = authorityFixture({ credentials: [] });
    const missingService = serviceFor({ authority: missingAuthority });
    expect(
      missingService.resolveMembership(authenticatedPrincipal(missingService), undefined, 7, 1_000),
    ).toEqual({ outcome: "denied", reason: "CREDENTIAL_UNKNOWN" });

    const authority = authorityFixture();
    const service = serviceFor({ authority });
    const principal = authenticatedPrincipal(service);
    expect(service.resolveMembership(principal, undefined, 7, 1_000).outcome).toBe("resolved");

    authority.revokeCredential("session-a");
    expect(service.resolveMembership(principal, undefined, 7, 1_000)).toEqual({
      outcome: "denied",
      reason: "CREDENTIAL_REVOKED",
    });
    authority.reactivateCredential("session-a", 951);
    expect(service.resolveMembership(principal, undefined, 7, 1_000)).toEqual({
      outcome: "denied",
      reason: "CREDENTIAL_STALE",
    });
    expect(service.resolveMembership(principal, "tenant-synthetic", 7, 1_000)).toEqual({
      outcome: "denied",
      reason: "CREDENTIAL_STALE",
    });
  });

  it("revokes one concurrent same-subject session without affecting another", () => {
    const authority = authorityFixture({
      credentials: [credentialAuthority(), credentialAuthority({ credentialId: "session-b" })],
    });
    const service = serviceFor({ authority });
    const first = authenticatedPrincipal(service);
    const second = authenticatedPrincipal(service, projection({ credentialId: "session-b" }));
    expect(service.resolveMembership(first, undefined, 7, 1_000).outcome).toBe("resolved");
    expect(service.resolveMembership(second, undefined, 7, 1_000).outcome).toBe("resolved");
    authority.revokeCredential("session-a");
    expect(service.resolveMembership(first, undefined, 7, 1_000)).toEqual({
      outcome: "denied",
      reason: "CREDENTIAL_REVOKED",
    });
    expect(service.resolveMembership(second, undefined, 7, 1_000).outcome).toBe("resolved");
  });

  it("returns no stale authority when state changes before the atomic snapshot", () => {
    const credentialAuthorityFixture = authorityFixture();
    const credentialService = createAuthenticationService(
      issuer,
      clientId,
      0,
      (key) => {
        credentialAuthorityFixture.revokeCredential("session-a");
        return credentialAuthorityFixture.lookupIdentityAuthority(key);
      },
      credentialAuthorityFixture.lookupService,
    );
    const credentialResult = credentialService.resolveMembership(
      authenticatedPrincipal(credentialService),
      "tenant-synthetic",
      7,
      1_000,
    );
    expect(credentialResult).toEqual({ outcome: "denied", reason: "CREDENTIAL_REVOKED" });
    expect("membership" in credentialResult).toBe(false);

    const membershipAuthorityFixture = authorityFixture();
    const membershipService = createAuthenticationService(
      issuer,
      clientId,
      0,
      (key) => {
        membershipAuthorityFixture.setMembershipEpoch("membership-a", 8);
        return membershipAuthorityFixture.lookupIdentityAuthority(key);
      },
      membershipAuthorityFixture.lookupService,
    );
    const membershipResult = membershipService.resolveMembership(
      authenticatedPrincipal(membershipService),
      "tenant-synthetic",
      7,
      1_000,
    );
    expect(membershipResult).toEqual({
      outcome: "denied",
      reason: "MEMBERSHIP_EPOCH_MISMATCH",
    });
    expect("membership" in membershipResult).toBe(false);
  });

  it("binds authority lookup to provider, issuer, client, and subject without collisions", () => {
    for (const changed of [
      { issuer: `${issuer}-other` },
      { clientId: `${clientId}-other` },
      { subject: "principal-b" },
    ]) {
      const authority = authorityFixture({ memberships: [membership(changed)] });
      const service = serviceFor({ authority });
      expect(
        service.resolveMembership(authenticatedPrincipal(service), undefined, undefined, 1_000),
      ).toEqual({ outcome: "denied", reason: "MEMBERSHIP_UNKNOWN" });
    }
  });

  it("fails closed for unknown, ambiguous, mismatched, expired, revoked, and stale epochs", () => {
    const unknownAuthority = authorityFixture({ memberships: [] });
    const unknownService = serviceFor({ authority: unknownAuthority });
    expect(
      unknownService.resolveMembership(
        authenticatedPrincipal(unknownService),
        undefined,
        undefined,
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "MEMBERSHIP_UNKNOWN" });

    const ambiguousAuthority = authorityFixture({
      memberships: [membership(), membership({ membershipId: "membership-b" })],
    });
    const ambiguousService = serviceFor({ authority: ambiguousAuthority });
    expect(
      ambiguousService.resolveMembership(
        authenticatedPrincipal(ambiguousService),
        "tenant-synthetic",
        undefined,
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "MEMBERSHIP_AMBIGUOUS" });

    const authority = authorityFixture();
    const service = serviceFor({ authority });
    const principal = authenticatedPrincipal(service);
    expect(service.resolveMembership(principal, "tenant-other", undefined, 1_000)).toEqual({
      outcome: "denied",
      reason: "HINT_MISMATCH",
    });
    authority.setMembershipEpoch("membership-a", 8);
    expect(service.resolveMembership(principal, undefined, 7, 1_000)).toEqual({
      outcome: "denied",
      reason: "MEMBERSHIP_EPOCH_MISMATCH",
    });
    authority.revokeMembership("membership-a");
    expect(service.resolveMembership(principal, undefined, 8, 1_000)).toEqual({
      outcome: "denied",
      reason: "MEMBERSHIP_REVOKED",
    });

    const expiredAuthority = authorityFixture({
      memberships: [membership({ expiresAtSeconds: 1_000 })],
    });
    const expiredService = serviceFor({ authority: expiredAuthority });
    expect(
      expiredService.resolveMembership(
        authenticatedPrincipal(expiredService),
        undefined,
        undefined,
        1_000,
      ),
    ).toEqual({ outcome: "denied", reason: "EXPIRED" });
  });

  it("rejects noncanonical, excessive, duplicate, unsorted, and unknown roles", () => {
    for (const roles of [
      [],
      ["member", "operator", "tenant_admin", "member"],
      ["operator", "member"],
      ["member", "member"],
      ["admin"],
    ]) {
      const authority = {
        lookupIdentityAuthority: () =>
          canonical({
            authorityRevision: 1,
            credential: credentialAuthority(),
            memberships: [membership({ roles })],
          }),
      };
      const service = serviceFor({ authority });
      expect(
        service.resolveMembership(authenticatedPrincipal(service), undefined, undefined, 1_000),
      ).toEqual({ outcome: "denied", reason: "MALFORMED_AUTHORITY" });
    }
  });

  it("separates human and service identities and rechecks live service revocation", () => {
    const authority = authorityFixture({
      services: [
        serviceIdentity(),
        serviceIdentity({
          clientId: "worker-client-b",
          credentialRef: "fixture:worker-b",
          issuer: "local://synthetic-workloads-b",
        }),
      ],
    });
    const service = serviceFor({ authority });
    const principal = authenticatedPrincipal(service);
    const authenticated = service.authenticateService(
      authority.verifyServiceCredential("fixture:worker-a"),
      1_000,
    );
    expect(authenticated).toEqual({
      outcome: "verified",
      service: {
        identity: {
          clientId: "worker-client",
          issuer: "local://synthetic-workloads",
          provider: "service",
          subject: "worker-a",
        },
        kind: "service",
        session: { expiresAtSeconds: 1_080, issuedAtSeconds: 900 },
      },
    });
    if (authenticated.outcome !== "verified") throw new Error("expected service identity");
    const secondService = service.authenticateService(
      authority.verifyServiceCredential("fixture:worker-b"),
      1_000,
    );
    if (secondService.outcome !== "verified") throw new Error("expected second service identity");
    expect(service.resolveMembership(authenticated.service, undefined, undefined, 1_000)).toEqual({
      outcome: "denied",
      reason: "FORGED_IDENTITY",
    });
    expect(service.validateService({ ...authenticated.service }, 1_000)).toEqual({
      outcome: "denied",
      reason: "FORGED_IDENTITY",
    });
    expect(service.resolveMembership({ ...principal }, undefined, undefined, 1_000)).toEqual({
      outcome: "denied",
      reason: "FORGED_IDENTITY",
    });
    expect(JSON.stringify(authenticated)).not.toMatch(
      /credential|tenant|role|purpose|scope|operation|mode/i,
    );
    authority.revokeService("fixture:worker-a");
    expect(service.validateService(authenticated.service, 1_000)).toEqual({
      outcome: "denied",
      reason: "SERVICE_REVOKED",
    });
    expect(service.validateService(secondService.service, 1_000).outcome).toBe("verified");
  });

  it("bounds hostile authority output and returns frozen content-free denials", () => {
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps += 1;
          throw new Error("must not inspect");
        },
        ownKeys() {
          traps += 1;
          throw new Error("must not inspect");
        },
      },
    );
    const hostileService = createAuthenticationService(issuer, clientId, 0, () => proxy, undefined);
    const principal = authenticatedPrincipal(hostileService);
    const malformed = hostileService.resolveMembership(principal, undefined, undefined, 1_000);
    expect(malformed).toEqual({ outcome: "denied", reason: "MALFORMED_AUTHORITY" });
    expect(traps).toBe(0);
    expect(Object.isFrozen(malformed)).toBe(true);

    for (const authorityValue of [
      "x".repeat(authenticationLimits.authorityJsonBytes + 1),
      ' {"memberships":[]}',
      '{"memberships":[],"unknown":true}',
    ]) {
      const bounded = createAuthenticationService(
        issuer,
        clientId,
        0,
        () => authorityValue,
        undefined,
      );
      expect(
        bounded.resolveMembership(authenticatedPrincipal(bounded), undefined, undefined, 1_000),
      ).toEqual({ outcome: "denied", reason: "MALFORMED_AUTHORITY" });
    }
    const unavailable = createAuthenticationService(
      issuer,
      clientId,
      0,
      () => {
        throw new Error("secret authority failure");
      },
      undefined,
    );
    const denied = unavailable.resolveMembership(
      authenticatedPrincipal(unavailable),
      undefined,
      undefined,
      1_000,
    );
    expect(denied).toEqual({ outcome: "denied", reason: "AUTHORITY_UNAVAILABLE" });
    expect(JSON.stringify(denied)).not.toContain("secret");
  });

  it("exposes no tenant or authorization field or callable result authority", () => {
    const result = resultFor(verifiedProjectionFor(localVerifier()));
    const keys = [];
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of ownDataEntries(value)) {
        keys.push(key);
        expect(typeof child).not.toBe("function");
        visit(child);
      }
    };
    visit(result);
    expect(keys.sort()).toEqual(
      [
        "authenticatedAtSeconds",
        "assurance",
        "clientId",
        "credentialId",
        "expiresAtSeconds",
        "identity",
        "issuedAtSeconds",
        "issuer",
        "outcome",
        "principal",
        "provider",
        "session",
        "subject",
      ].sort(),
    );
    expect(keys.join(" ")).not.toMatch(
      /tenant|purpose|role|scope|operation|origin|workload|membership|authorize/i,
    );
  });
});
