import type { TenantContextService } from "./tenant-context.js";

const maximumRevision = 18_446_744_073_709_551_615n;
const objectPrototype = Object.getPrototypeOf({});
const denied = Object.freeze({ outcome: "denied" as const });

const operationPublish = "outbox.publish" as const;
const operationConsume = "outbox.consume" as const;

export interface OutboxScope {
  readonly consumerId?: string;
  readonly operation: typeof operationPublish | typeof operationConsume;
  readonly serverPurpose: string;
  readonly tenantId: string;
}

export interface OutboxMessage {
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly operationId: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly messageVersion: string;
  readonly previousMessageVersion: string;
  readonly operationName: string;
  readonly payloadRef: string;
  readonly payloadRevision: string;
  readonly requestedPurpose: string;
  readonly serverPurpose: string;
  readonly tenantId: string;
  readonly recordSchemaVersion: "zc.internal.outbox-message.v1";
  readonly recordFamily: "outbox_message";
}

export interface OutboxMessageCreateCommand {
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly operationId: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly messageVersion: string;
  readonly previousMessageVersion: string;
  readonly payloadRef: string;
  readonly payloadRevision: string;
  readonly operationName?: string;
}

export interface OutboxAppendMessageResult {
  readonly message: OutboxMessage;
  readonly outcome: "appended";
}

export interface OutboxReplayMessageResult {
  readonly message: OutboxMessage;
  readonly outcome: "replayed";
}

export type OutboxAppendResult =
  | OutboxAppendMessageResult
  | OutboxReplayMessageResult
  | Readonly<{ readonly outcome: "conflict" }>
  | typeof denied;

export interface OutboxDelivery {
  readonly attempts: number;
  readonly fence: string;
  readonly handle: object;
  readonly id: string;
}

export interface OutboxClaimResult {
  readonly delivery: OutboxDelivery;
  readonly message: OutboxMessage;
}

export type OutboxClaimResponse =
  | OutboxClaimResult
  | undefined
  | Readonly<{ readonly outcome: "denied" }>;

export interface OutboxAcknowledgeInput {
  readonly attempts: number;
  readonly fence: string;
  readonly handle: object;
  readonly id: string;
  readonly disposition: "acknowledged" | "retry";
}

export interface OutboxAcknowledgeResult {
  readonly status: "acknowledged" | "lost" | "stale";
}

export interface OutboxDeadLetter {
  readonly id: string;
  readonly messageVersion: string;
}

export interface InboxReceipt {
  readonly attempts: number;
  readonly consumerId: string;
  readonly fence: string;
  readonly messageId: string;
  readonly messageVersion: string;
  readonly receivedAt: string;
  readonly recordFamily: "inbox_receipt";
  readonly recordSchemaVersion: "zc.internal.inbox-receipt.v1";
  readonly requestedPurpose: string;
  readonly serverPurpose: string;
  readonly tenantId: string;
}

export interface InboxReceiptCommand {
  readonly attempts: number;
  readonly fence: string;
  readonly messageId: string;
  readonly messageVersion: string;
  readonly receivedAt: string;
}

export type InboxReceiptResult =
  | Readonly<{ readonly outcome: "recorded"; readonly receipt: InboxReceipt }>
  | Readonly<{ readonly outcome: "replayed"; readonly receipt: InboxReceipt }>
  | Readonly<{ readonly outcome: "conflict" }>
  | typeof denied;

export interface OutboxRepository {
  readonly append: (
    request: OutboxMessage,
    scope: OutboxScope,
    currentScope: () => boolean,
  ) => OutboxAppendResult;
  readonly claim: (
    scope: OutboxScope,
    now: number,
    currentScope: () => boolean,
  ) => OutboxClaimResponse;
  readonly acknowledge: (
    request: OutboxAcknowledgeInput,
    scope: OutboxScope,
    now: number,
    currentScope: () => boolean,
  ) => OutboxAcknowledgeResult | typeof denied;
  readonly deadLetters: (
    scope: OutboxScope,
    currentScope: () => boolean,
  ) => readonly OutboxDeadLetter[] | typeof denied;
  readonly recordInbox: (
    request: InboxReceipt,
    scope: OutboxScope,
    now: number,
    currentScope: () => boolean,
  ) => InboxReceiptResult;
}

export interface OutboxPublishService {
  readonly append: (context: unknown, command: unknown, now: unknown) => OutboxAppendResult;
}

export interface OutboxConsumeService {
  readonly claim: (context: unknown, now: unknown) => OutboxClaimResponse;
  readonly acknowledge: (
    context: unknown,
    input: unknown,
    now: unknown,
  ) => OutboxAcknowledgeResult | typeof denied;
  readonly recordInbox: (context: unknown, command: unknown, now: unknown) => InboxReceiptResult;
}

export interface OutboxDeadLetterService {
  readonly deadLetters: (context: unknown, now: unknown) => readonly OutboxDeadLetter[] | undefined;
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
  if (typeof value !== "string" || value.length > 20 || !/^[0-9]+$/u.test(value)) return false;
  if (value !== "0" && !/^[1-9][0-9]*$/u.test(value)) return false;
  try {
    return BigInt(value) <= maximumRevision;
  } catch {
    return false;
  }
}

function positiveRevision(value: unknown): value is string {
  return revision(value) && value !== "0";
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function token(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9._:-]*$/u.test(value)
  );
}

function scope(
  contexts: TenantContextService,
  context: unknown,
  now: number,
  operation: OutboxScope["operation"],
): OutboxScope | undefined {
  try {
    const result = snapshot(contexts.validate(context, now), ["context", "outcome"]);
    if (!result || result.outcome !== "issued") return undefined;
    const contextValue = result.context;
    if (contextValue === null || typeof contextValue !== "object") return undefined;
    const contextRecord = snapshot(contextValue, ["operation", "purpose", "tenantId", "workload"]);
    if (!contextRecord) return undefined;
    if (operation === operationPublish) {
      const workload = snapshot(contextRecord.workload, ["capability"]);
      if (
        !token(contextRecord.operation) ||
        contextRecord.operation !== operation ||
        !purpose(contextRecord.purpose) ||
        !identifier(contextRecord.tenantId) ||
        !token(workload?.capability) ||
        workload.capability !== "continuity.outbox.publish"
      )
        return undefined;
      return Object.freeze({
        operation,
        serverPurpose: contextRecord.purpose,
        tenantId: contextRecord.tenantId,
      });
    }
    const workload = snapshot(contextRecord.workload, ["capability", "consumerId"]);
    if (
      !token(contextRecord.operation) ||
      contextRecord.operation !== operation ||
      !purpose(contextRecord.purpose) ||
      !identifier(contextRecord.tenantId) ||
      !token(workload?.capability) ||
      workload.capability !== "continuity.outbox.consume" ||
      !identifier(workload.consumerId)
    )
      return undefined;
    return Object.freeze({
      consumerId: workload.consumerId,
      operation,
      serverPurpose: contextRecord.purpose,
      tenantId: contextRecord.tenantId,
    });
  } catch {
    return undefined;
  }
}

function command(value: unknown, context: OutboxScope): OutboxMessage | undefined {
  const source = own(value);
  if (!source) return undefined;
  const hasOperationName = Object.hasOwn(source, "operationName");
  const expected = [
    "attemptId",
    "messageId",
    "messageType",
    "messageVersion",
    "occurredAt",
    "operationId",
    ...(hasOperationName ? ["operationName"] : []),
    "payloadRef",
    "payloadRevision",
    "previousMessageVersion",
  ];
  if (
    Object.keys(source).length !== expected.length ||
    !Object.keys(source).every((key) => expected.includes(key))
  )
    return undefined;
  if (
    !identifier(source.attemptId) ||
    !timestamp(source.occurredAt) ||
    !identifier(source.operationId) ||
    !identifier(source.messageId) ||
    !token(source.messageType) ||
    !positiveRevision(source.messageVersion) ||
    !revision(source.previousMessageVersion) ||
    !identifier(source.payloadRef) ||
    !positiveRevision(source.payloadRevision)
  )
    return undefined;
  if (source.operationId === source.messageId) return undefined;
  if (BigInt(source.messageVersion) <= BigInt(source.previousMessageVersion)) return undefined;
  const requestedOperationName = hasOperationName
    ? source.operationName
    : `operation.${source.messageType}`;
  if (!token(requestedOperationName)) return undefined;
  return Object.freeze({
    attemptId: source.attemptId,
    occurredAt: source.occurredAt,
    operationId: source.operationId,
    messageId: source.messageId,
    messageType: source.messageType,
    messageVersion: source.messageVersion,
    previousMessageVersion: source.previousMessageVersion,
    operationName: requestedOperationName,
    payloadRef: source.payloadRef,
    payloadRevision: source.payloadRevision,
    requestedPurpose: context.serverPurpose,
    serverPurpose: context.serverPurpose,
    tenantId: context.tenantId,
    recordFamily: "outbox_message",
    recordSchemaVersion: "zc.internal.outbox-message.v1",
  });
}

function acknowledge(value: unknown): OutboxAcknowledgeInput | undefined {
  const record = snapshot(value, ["attempts", "disposition", "fence", "handle", "id"]);
  if (
    !record ||
    typeof record.attempts !== "number" ||
    !Number.isSafeInteger(record.attempts) ||
    record.attempts <= 0 ||
    record.attempts > 9_007_199_254_740_991 ||
    typeof record.handle !== "object" ||
    record.handle === null ||
    !identifier(record.id) ||
    !identifier(record.fence) ||
    (record.disposition !== "acknowledged" && record.disposition !== "retry")
  )
    return undefined;
  return Object.freeze({
    attempts: record.attempts,
    disposition: record.disposition,
    fence: record.fence,
    handle: record.handle,
    id: record.id,
  });
}

function inboxCommand(value: unknown, context: OutboxScope): InboxReceipt | undefined {
  if (!identifier(context.consumerId)) return undefined;
  const record = snapshot(value, [
    "attempts",
    "fence",
    "messageId",
    "messageVersion",
    "receivedAt",
  ]);
  if (
    !record ||
    typeof record.attempts !== "number" ||
    !Number.isSafeInteger(record.attempts) ||
    record.attempts <= 0 ||
    !identifier(record.fence) ||
    !identifier(record.messageId) ||
    !positiveRevision(record.messageVersion) ||
    !timestamp(record.receivedAt)
  )
    return undefined;
  return Object.freeze({
    attempts: record.attempts,
    consumerId: context.consumerId,
    fence: record.fence,
    messageId: record.messageId,
    messageVersion: record.messageVersion,
    receivedAt: record.receivedAt,
    recordFamily: "inbox_receipt",
    recordSchemaVersion: "zc.internal.inbox-receipt.v1",
    requestedPurpose: context.serverPurpose,
    serverPurpose: context.serverPurpose,
    tenantId: context.tenantId,
  });
}

function scopeGuard(
  contexts: TenantContextService,
  context: unknown,
  now: number,
  operation: OutboxScope["operation"],
) {
  const initial = scope(contexts, context, now, operation);
  return {
    initial,
    valid() {
      try {
        const current = scope(contexts, context, now, operation);
        return (
          !!initial &&
          !!current &&
          current.operation === operation &&
          current.serverPurpose === initial.serverPurpose &&
          current.tenantId === initial.tenantId &&
          current.consumerId === initial.consumerId
        );
      } catch {
        return false;
      }
    },
  };
}

export function createOutboxPublishService(
  contexts: TenantContextService,
  repository: OutboxRepository,
): OutboxPublishService {
  return Object.freeze({
    append(context: unknown, draft: unknown, now: unknown): OutboxAppendResult {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationPublish);
      if (!guard.initial) return denied;
      const request = command(draft, guard.initial);
      if (!request) return denied;
      return repository.append(request, guard.initial, guard.valid);
    },
  });
}

export function createOutboxConsumeService(
  contexts: TenantContextService,
  repository: OutboxRepository,
): OutboxConsumeService {
  return Object.freeze({
    claim(context: unknown, now: unknown): OutboxClaimResponse {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0)
        return { outcome: "denied" };
      const guard = scopeGuard(contexts, context, now, operationConsume);
      if (!guard.initial) return { outcome: "denied" };
      return repository.claim(guard.initial, now, guard.valid);
    },
    acknowledge(
      context: unknown,
      input: unknown,
      now: unknown,
    ): OutboxAcknowledgeResult | typeof denied {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationConsume);
      if (!guard.initial) return denied;
      const request = acknowledge(input);
      if (!request) return denied;
      return repository.acknowledge(request, guard.initial, now, guard.valid);
    },
    recordInbox(context: unknown, draft: unknown, now: unknown): InboxReceiptResult {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationConsume);
      if (!guard.initial) return denied;
      const request = inboxCommand(draft, guard.initial);
      if (!request) return denied;
      return repository.recordInbox(request, guard.initial, now, guard.valid);
    },
  });
}

export function createOutboxDeadLetterService(
  contexts: TenantContextService,
  repository: OutboxRepository,
): OutboxDeadLetterService {
  return Object.freeze({
    deadLetters(context: unknown, now: unknown): readonly OutboxDeadLetter[] | undefined {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return undefined;
      const guard = scopeGuard(contexts, context, now, operationConsume);
      if (!guard.initial) return undefined;
      const result = repository.deadLetters(guard.initial, guard.valid);
      if (!Array.isArray(result)) return undefined;
      return result;
    },
  });
}
