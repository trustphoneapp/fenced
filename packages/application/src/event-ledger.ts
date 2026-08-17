import type { TenantContextService } from "./tenant-context.js";

const maximumRevision = 18_446_744_073_709_551_615n;
const objectPrototype = Object.getPrototypeOf({});
const denied = Object.freeze({ outcome: "denied" as const });

export interface EventRevisionRequestPayload {
  readonly payloadRef: string;
  readonly revision: string;
}

export interface EventRevisionRequestCommand {
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly operationId: string;
  readonly payload?: EventRevisionRequestPayload;
  readonly requestId: string;
  readonly requestRevision: string;
  readonly requestType: "correction.requested" | "retraction.requested";
  readonly targetEventId: string;
  readonly targetEventRevision: string;
}

export interface EventRevisionRequest {
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly operationId: string;
  readonly payload?: Readonly<{
    readonly payloadRef: string;
    readonly payloadRequestedPurpose: string;
    readonly payloadRevision: string;
    readonly payloadServerPurpose: string;
    readonly payloadTenantId: string;
  }>;
  readonly recordFamily: "event_revision_request";
  readonly recordSchemaVersion: "zc.internal.event-revision-request.v1";
  readonly requestId: string;
  readonly requestRevision: string;
  readonly requestType: "correction.requested" | "retraction.requested";
  readonly requestedPurpose: string;
  readonly serverPurpose: string;
  readonly targetEventId: string;
  readonly targetEventRevision: string;
  readonly tenantId: string;
}

export type EventRevisionRequestResult =
  | Readonly<{ readonly outcome: "appended"; readonly request: EventRevisionRequest }>
  | Readonly<{ readonly outcome: "replayed"; readonly request: EventRevisionRequest }>
  | Readonly<{ readonly outcome: "conflict" }>
  | typeof denied;

export interface EventRevisionRequestRepository {
  readonly append: (request: unknown, currentScope: () => boolean) => EventRevisionRequestResult;
}

export interface EventRevisionRequestService {
  readonly append: (
    context: unknown,
    command: unknown,
    serverNowEpochSeconds: unknown,
  ) => EventRevisionRequestResult;
}

interface Scope {
  readonly serverPurpose: string;
  readonly tenantId: string;
}

function own(value: unknown): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const copied: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      copied[key] = descriptor.value;
    }
    return copied;
  } catch {
    return undefined;
  }
}

function snapshot(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> | undefined {
  const copied = own(value);
  if (!copied) return undefined;
  const keys = Object.keys(copied);
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
    ? copied
    : undefined;
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

function scope(contexts: TenantContextService, context: unknown, now: number): Scope | undefined {
  try {
    const result = snapshot(contexts.validate(context, now), ["context", "outcome"]);
    if (!result || result.outcome !== "issued") return undefined;
    const contextValue = result.context;
    if (contextValue === null || typeof contextValue !== "object") return undefined;
    const contextRecord = snapshot(contextValue, ["operation", "purpose", "tenantId", "workload"]);
    if (!contextRecord) return undefined;
    const workload = snapshot(contextRecord.workload, ["capability"]);
    return identifier(contextRecord.tenantId) &&
      purpose(contextRecord.purpose) &&
      contextRecord.operation === "event.revision.request" &&
      workload?.capability === "continuity.event.revision.request"
      ? Object.freeze({ serverPurpose: contextRecord.purpose, tenantId: contextRecord.tenantId })
      : undefined;
  } catch {
    return undefined;
  }
}

function command(value: unknown, current: Scope): EventRevisionRequest | undefined {
  const record = own(value);
  if (!record) return undefined;
  const hasPayload = Object.hasOwn(record, "payload");
  const expected = [
    "attemptId",
    "occurredAt",
    "operationId",
    ...(hasPayload ? ["payload"] : []),
    "requestId",
    "requestRevision",
    "requestType",
    "targetEventId",
    "targetEventRevision",
  ];
  if (
    Object.keys(record).length !== expected.length ||
    !Object.keys(record).every((key) => expected.includes(key))
  )
    return undefined;
  if (
    !record ||
    !identifier(record.attemptId) ||
    !timestamp(record.occurredAt) ||
    !identifier(record.operationId) ||
    !identifier(record.requestId) ||
    !revision(record.requestRevision) ||
    (record.requestType !== "correction.requested" &&
      record.requestType !== "retraction.requested") ||
    !identifier(record.targetEventId) ||
    !revision(record.targetEventRevision) ||
    (record.targetEventId === record.requestId &&
      record.targetEventRevision === record.requestRevision)
  )
    return undefined;
  let payload: EventRevisionRequest["payload"];
  if (hasPayload) {
    const source = snapshot(record.payload, ["payloadRef", "revision"]);
    if (!source || !identifier(source.payloadRef) || !revision(source.revision)) return undefined;
    payload = Object.freeze({
      payloadRef: source.payloadRef,
      payloadRequestedPurpose: current.serverPurpose,
      payloadRevision: source.revision,
      payloadServerPurpose: current.serverPurpose,
      payloadTenantId: current.tenantId,
    });
  }
  return Object.freeze({
    attemptId: record.attemptId,
    occurredAt: record.occurredAt,
    operationId: record.operationId,
    ...(payload ? { payload } : {}),
    recordFamily: "event_revision_request",
    recordSchemaVersion: "zc.internal.event-revision-request.v1",
    requestId: record.requestId,
    requestRevision: record.requestRevision,
    requestType: record.requestType,
    requestedPurpose: current.serverPurpose,
    serverPurpose: current.serverPurpose,
    targetEventId: record.targetEventId,
    targetEventRevision: record.targetEventRevision,
    tenantId: current.tenantId,
  });
}

export function createEventRevisionRequestService(
  contexts: TenantContextService,
  repository: EventRevisionRequestRepository,
): EventRevisionRequestService {
  return Object.freeze({
    append(context: unknown, input: unknown, now: unknown): EventRevisionRequestResult {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const initial = scope(contexts, context, now);
      const request = initial && command(input, initial);
      if (!request) return denied;
      return repository.append(request, () => {
        const current = scope(contexts, context, now);
        return (
          !!current &&
          current.tenantId === initial.tenantId &&
          current.serverPurpose === initial.serverPurpose
        );
      });
    },
  });
}
