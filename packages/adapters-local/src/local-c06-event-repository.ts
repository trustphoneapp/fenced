import type {
  EventRevisionRequest,
  EventRevisionRequestRepository,
  EventRevisionRequestResult,
} from "@zintus-continuity/application";

const maximumRevision = 18_446_744_073_709_551_615n;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectFreeze = Object.freeze;

if (
  typeof objectCreate !== "function" ||
  typeof objectDefineProperty !== "function" ||
  typeof objectGetPrototypeOf !== "function" ||
  typeof objectGetOwnPropertyDescriptor !== "function" ||
  typeof objectFreeze !== "function"
)
  throw new TypeError("Trusted intrinsics unavailable");

const objectPrototype = objectGetPrototypeOf({});

function freeze<T extends object>(value: T): Readonly<T> {
  return objectFreeze(value);
}

const denied = freeze({ outcome: "denied" as const });
const conflict = freeze({ outcome: "conflict" as const });

interface StoredRequest {
  readonly canonical: string;
  readonly request: EventRevisionRequest;
}

interface IndexedRequest {
  readonly key: string;
  readonly stored: StoredRequest;
}

interface ScopeStore {
  readonly byOperation: readonly IndexedRequest[];
  readonly byRequest: readonly IndexedRequest[];
  readonly key: string;
}

function own(value: unknown): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = objectGetPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") return undefined;
      const descriptor = objectGetOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

function exact(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{48}$/u.test(value);
}

function purpose(value: unknown): value is string {
  return typeof value === "string" && value.length <= 96 && /^[a-z][a-z0-9._:-]*$/u.test(value);
}

function revision(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 20 || !/^[1-9][0-9]*$/u.test(value)) return false;
  try {
    return BigInt(value) <= maximumRevision;
  } catch {
    return false;
  }
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function normalize(value: unknown): StoredRequest | undefined {
  const source = own(value);
  if (!source) return undefined;
  const hasPayload = Object.hasOwn(source, "payload");
  if (
    !exact(source, [
      "attemptId",
      "occurredAt",
      "operationId",
      ...(hasPayload ? ["payload"] : []),
      "recordFamily",
      "recordSchemaVersion",
      "requestId",
      "requestRevision",
      "requestType",
      "requestedPurpose",
      "serverPurpose",
      "targetEventId",
      "targetEventRevision",
      "tenantId",
    ]) ||
    !identifier(source.attemptId) ||
    !timestamp(source.occurredAt) ||
    !identifier(source.operationId) ||
    source.recordFamily !== "event_revision_request" ||
    source.recordSchemaVersion !== "zc.internal.event-revision-request.v1" ||
    !identifier(source.requestId) ||
    !revision(source.requestRevision) ||
    (source.requestType !== "correction.requested" &&
      source.requestType !== "retraction.requested") ||
    !purpose(source.requestedPurpose) ||
    source.requestedPurpose !== source.serverPurpose ||
    !purpose(source.serverPurpose) ||
    !identifier(source.targetEventId) ||
    !revision(source.targetEventRevision) ||
    !identifier(source.tenantId)
  )
    return undefined;
  const requestType: EventRevisionRequest["requestType"] =
    source.requestType === "correction.requested" ? "correction.requested" : "retraction.requested";
  let payload: EventRevisionRequest["payload"];
  if (hasPayload) {
    const rawPayload = own(source.payload);
    if (
      !rawPayload ||
      !exact(rawPayload, [
        "payloadRef",
        "payloadRequestedPurpose",
        "payloadRevision",
        "payloadServerPurpose",
        "payloadTenantId",
      ]) ||
      !identifier(rawPayload.payloadRef) ||
      !revision(rawPayload.payloadRevision) ||
      rawPayload.payloadRequestedPurpose !== source.requestedPurpose ||
      rawPayload.payloadServerPurpose !== source.serverPurpose ||
      rawPayload.payloadTenantId !== source.tenantId
    )
      return undefined;
    payload = freeze({
      payloadRef: rawPayload.payloadRef,
      payloadRequestedPurpose: rawPayload.payloadRequestedPurpose,
      payloadRevision: rawPayload.payloadRevision,
      payloadServerPurpose: rawPayload.payloadServerPurpose,
      payloadTenantId: rawPayload.payloadTenantId,
    });
  }
  if (
    source.requestId === source.targetEventId &&
    source.requestRevision === source.targetEventRevision
  )
    return undefined;
  const request = freeze({
    attemptId: source.attemptId,
    occurredAt: source.occurredAt,
    operationId: source.operationId,
    ...(payload ? { payload } : {}),
    recordFamily: "event_revision_request" as const,
    recordSchemaVersion: "zc.internal.event-revision-request.v1" as const,
    requestId: source.requestId,
    requestRevision: source.requestRevision,
    requestType,
    requestedPurpose: source.requestedPurpose,
    serverPurpose: source.serverPurpose,
    targetEventId: source.targetEventId,
    targetEventRevision: source.targetEventRevision,
    tenantId: source.tenantId,
  });
  return freeze({ canonical: JSON.stringify(request), request });
}

function scopeKey(request: EventRevisionRequest): string {
  return `${request.tenantId}\u0000${request.serverPurpose}`;
}

function requestKey(request: EventRevisionRequest): string {
  return `${request.requestId}\u0000${request.requestRevision}`;
}

function operationKey(request: EventRevisionRequest): string {
  return `${request.operationId}\u0000${request.attemptId}`;
}

function defineArrayElement<T>(values: T[], index: number, value: T): void {
  const descriptor: PropertyDescriptor = objectCreate(null);
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  objectDefineProperty(values, index, descriptor);
}

function getIndexedValue(
  entries: readonly IndexedRequest[],
  key: string,
): StoredRequest | undefined {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.key === key) return entry.stored;
  }
  return undefined;
}

function appendIndexedValue(
  entries: readonly IndexedRequest[],
  key: string,
  stored: StoredRequest,
): readonly IndexedRequest[] {
  const next: IndexedRequest[] = [];
  for (let index = 0; index < entries.length; index += 1)
    defineArrayElement(next, index, entries[index] as IndexedRequest);
  defineArrayElement(next, entries.length, freeze({ key, stored }));
  return freeze(next);
}

function findScopeIndex(scopes: readonly ScopeStore[], key: string): number {
  for (let index = 0; index < scopes.length; index += 1)
    if (scopes[index]?.key === key) return index;
  return -1;
}

function appendAuthorized(scopes: ScopeStore[], owned: StoredRequest): EventRevisionRequestResult {
  const key = scopeKey(owned.request);
  const scopeIndex = findScopeIndex(scopes, key);
  const existingScope = scopeIndex === -1 ? undefined : scopes[scopeIndex];
  const requestIdentity = requestKey(owned.request);
  const operationIdentity = operationKey(owned.request);
  const byRequest = existingScope
    ? getIndexedValue(existingScope.byRequest, requestIdentity)
    : undefined;
  const byOperation = existingScope
    ? getIndexedValue(existingScope.byOperation, operationIdentity)
    : undefined;
  const hasRequest = byRequest !== undefined;
  const hasOperation = byOperation !== undefined;
  if (hasRequest || hasOperation) {
    if (
      !hasRequest ||
      !hasOperation ||
      byRequest !== byOperation ||
      byRequest?.canonical !== owned.canonical
    )
      return conflict;
    return freeze({ outcome: "replayed" as const, request: byRequest.request });
  }
  if (
    (!existingScope && scopes.length >= 64) ||
    (existingScope && existingScope.byRequest.length >= 64)
  )
    return denied;

  const nextByRequest = appendIndexedValue(existingScope?.byRequest ?? [], requestIdentity, owned);
  const nextByOperation = appendIndexedValue(
    existingScope?.byOperation ?? [],
    operationIdentity,
    owned,
  );
  const newScopeStore = freeze({
    byOperation: nextByOperation,
    byRequest: nextByRequest,
    key,
  });
  const result = freeze({ outcome: "appended" as const, request: owned.request });
  defineArrayElement(scopes, scopeIndex === -1 ? scopes.length : scopeIndex, newScopeStore);
  return result;
}

export function createLocalC06EventRepository(): EventRevisionRequestRepository {
  const scopes: ScopeStore[] = [];
  return freeze({
    append(value: unknown, currentScope: () => boolean): EventRevisionRequestResult {
      const candidate = normalize(value);
      if (!candidate) return denied;
      let current: boolean;
      try {
        current = currentScope();
      } catch {
        return denied;
      }
      if (!current) return denied;
      return appendAuthorized(scopes, candidate);
    },
  });
}
