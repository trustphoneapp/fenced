export const localTenantAuthorityFixtureLimits = Object.freeze({
  authorityCount: 16,
  fixtureJsonBytes: 65_536,
});

export interface LocalTenantAuthorityFixture {
  readonly deleteAuthority: (intentId: unknown) => void;
  readonly issueIntent: (intentId: unknown) => LocalTenantIntentCapability;
  readonly issueTenantContextIds: () => string;
  readonly lookupTenantAuthority: (intent: unknown) => string | undefined;
  readonly readAuthorityGeneration: () => object;
  readonly replaceAuthority: (intentId: unknown, canonicalAuthorityJson: unknown) => void;
  readonly revokeAuthority: (intentId: unknown) => void;
}

export interface LocalTenantAuthorityCoordinator {
  readonly kind: "local-tenant-authority-coordinator";
}

export interface LocalTenantIntentCapability {
  readonly kind: "local-tenant-intent";
}

const plainObjectPrototype = Object.getPrototypeOf({});
const coordinatorStates = new WeakMap<object, { generation: object }>();

export function createLocalTenantAuthorityCoordinator(): LocalTenantAuthorityCoordinator {
  const coordinator: LocalTenantAuthorityCoordinator = Object.freeze({
    kind: "local-tenant-authority-coordinator",
  });
  coordinatorStates.set(coordinator, { generation: Object.freeze({}) });
  return coordinator;
}

export function readLocalTenantAuthorityGeneration(
  coordinator: LocalTenantAuthorityCoordinator,
): object {
  return coordinatorStates.get(coordinator)?.generation ?? operationFail();
}

export function advanceLocalTenantAuthorityGeneration(
  coordinator: LocalTenantAuthorityCoordinator,
): void {
  const state = coordinatorStates.get(coordinator);
  if (!state) operationFail();
  state.generation = Object.freeze({});
}

function fail(): never {
  throw new Error("INVALID_LOCAL_TENANT_AUTHORITY_FIXTURE");
}

function operationFail(): never {
  throw new Error("INVALID_LOCAL_TENANT_AUTHORITY_OPERATION");
}

function utf8BytesWithin(value: string, maximum: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      bytes += 4;
      index += 1;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) return false;
      bytes += 3;
    }
    if (bytes > maximum) return false;
  }
  return true;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === plainObjectPrototype
  );
}

function parseCanonicalRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !utf8BytesWithin(value, localTenantAuthorityFixtureLimits.fixtureJsonBytes)
  )
    fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail();
  }
  if (!plainRecord(parsed) || JSON.stringify(parsed) !== value) fail();
  return parsed;
}

function authorityRecord(value: unknown): Record<string, unknown> {
  const record = parseCanonicalRecord(value);
  if (typeof record.intentId !== "string" || record.intentId.length === 0) fail();
  return record;
}

export function createLocalTenantAuthorityFixture(
  fixtureJsonValue: unknown,
  coordinator: LocalTenantAuthorityCoordinator,
): LocalTenantAuthorityFixture {
  readLocalTenantAuthorityGeneration(coordinator);
  const root = parseCanonicalRecord(fixtureJsonValue);
  if (Object.keys(root).length !== 1 || !Object.hasOwn(root, "authorities")) fail();
  const values = root.authorities;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > localTenantAuthorityFixtureLimits.authorityCount
  )
    fail();
  const authorities = new Map<string, Record<string, unknown>>();
  const intents = new WeakMap<object, string>();
  for (const value of values) {
    if (!plainRecord(value)) fail();
    const authority = authorityRecord(JSON.stringify(value));
    const intentId = authority.intentId as string;
    if (authorities.has(intentId)) fail();
    authorities.set(intentId, authority);
  }

  function current(intentId: unknown): Record<string, unknown> {
    if (typeof intentId !== "string") operationFail();
    return authorities.get(intentId) ?? operationFail();
  }
  let nextId = 1;

  return Object.freeze({
    deleteAuthority(intentId: unknown) {
      current(intentId);
      authorities.delete(intentId as string);
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    issueIntent(intentId: unknown) {
      current(intentId);
      const capability: LocalTenantIntentCapability = Object.freeze({
        kind: "local-tenant-intent",
      });
      intents.set(capability, intentId as string);
      return capability;
    },
    issueTenantContextIds() {
      const suffix = String(nextId);
      nextId += 1;
      return JSON.stringify({
        decisionId: `local-decision-${suffix}`,
        requestId: `local-request-${suffix}`,
        traceId: `local-trace-${suffix}`,
      });
    },
    lookupTenantAuthority(intent: unknown) {
      if (intent === null || typeof intent !== "object") return undefined;
      const intentId = intents.get(intent);
      if (!intentId) return undefined;
      const authority = authorities.get(intentId);
      return authority ? JSON.stringify(authority) : undefined;
    },
    readAuthorityGeneration: () => readLocalTenantAuthorityGeneration(coordinator),
    replaceAuthority(intentId: unknown, canonicalAuthorityJson: unknown) {
      const old = current(intentId);
      const replacement = authorityRecord(canonicalAuthorityJson);
      if (replacement.intentId !== old.intentId) operationFail();
      authorities.set(intentId as string, replacement);
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    revokeAuthority(intentId: unknown) {
      const authority = current(intentId);
      if (typeof authority.revoked !== "boolean") operationFail();
      authority.revoked = true;
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
  });
}
