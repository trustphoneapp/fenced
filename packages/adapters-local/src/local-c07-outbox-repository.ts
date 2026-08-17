import type {
  InboxReceipt,
  InboxReceiptResult,
  OutboxAcknowledgeInput,
  OutboxAcknowledgeResult,
  OutboxAppendResult,
  OutboxClaimResponse,
  OutboxDeadLetter,
  OutboxDelivery,
  OutboxMessage,
  OutboxRepository,
  OutboxScope,
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
const maxAttempts = 3;
const leaseMilliseconds = 30_000;

interface StoredMessage {
  readonly canonical: string;
  readonly message: OutboxMessage;
}

interface DeliveryState {
  readonly attempts: number;
  readonly consumerId: string;
  readonly fence: string;
  readonly handle: object;
  readonly key: string;
  readonly leaseExpiresAt: number;
  readonly messageId: string;
  readonly messageVersion: string;
  readonly status: "claimed" | "pending" | "acked" | "dead";
}

interface StoredReceipt {
  readonly canonical: string;
  readonly receipt: InboxReceipt;
}

interface ScopeBucket {
  readonly byMessage: Map<string, StoredMessage>;
  readonly byOperation: Map<string, StoredMessage>;
  readonly deliveries: Map<string, DeliveryState>;
  readonly deadLetters: OutboxDeadLetter[];
  readonly inbox: Map<string, StoredReceipt>;
  readonly pending: string[];
  readonly successors: Map<string, string>;
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

function normalizeMessage(value: unknown): StoredMessage | undefined {
  const source = own(value);
  if (!source) return undefined;
  const expected = [
    "attemptId",
    "messageId",
    "messageType",
    "messageVersion",
    "occurredAt",
    "operationId",
    "operationName",
    "payloadRef",
    "payloadRevision",
    "previousMessageVersion",
    "recordFamily",
    "recordSchemaVersion",
    "requestedPurpose",
    "serverPurpose",
    "tenantId",
  ];
  if (!exact(source, expected)) return undefined;
  if (
    !identifier(source.attemptId) ||
    !identifier(source.messageId) ||
    !token(source.messageType) ||
    !positiveRevision(source.messageVersion) ||
    !timestamp(source.occurredAt) ||
    !identifier(source.operationId) ||
    !token(source.operationName) ||
    !identifier(source.payloadRef) ||
    !positiveRevision(source.payloadRevision) ||
    !revision(source.previousMessageVersion) ||
    source.recordFamily !== "outbox_message" ||
    source.recordSchemaVersion !== "zc.internal.outbox-message.v1" ||
    !purpose(source.requestedPurpose) ||
    !purpose(source.serverPurpose) ||
    !identifier(source.tenantId) ||
    source.requestedPurpose !== source.serverPurpose ||
    source.operationId === source.messageId ||
    BigInt(source.messageVersion) <= BigInt(source.previousMessageVersion)
  )
    return undefined;
  const message = freeze({
    attemptId: source.attemptId,
    occurredAt: source.occurredAt,
    operationId: source.operationId,
    messageId: source.messageId,
    messageType: source.messageType,
    messageVersion: source.messageVersion,
    previousMessageVersion: source.previousMessageVersion,
    operationName: source.operationName,
    payloadRef: source.payloadRef,
    payloadRevision: source.payloadRevision,
    requestedPurpose: source.requestedPurpose,
    serverPurpose: source.serverPurpose,
    tenantId: source.tenantId,
    recordFamily: "outbox_message" as const,
    recordSchemaVersion: "zc.internal.outbox-message.v1" as const,
  });
  return freeze({
    canonical: JSON.stringify(message),
    message,
  });
}

function normalizeReceipt(value: unknown): StoredReceipt | undefined {
  const source = own(value);
  if (!source) return undefined;
  const expected = [
    "attempts",
    "consumerId",
    "fence",
    "messageId",
    "messageVersion",
    "receivedAt",
    "recordFamily",
    "recordSchemaVersion",
    "requestedPurpose",
    "serverPurpose",
    "tenantId",
  ];
  if (!exact(source, expected)) return undefined;
  if (
    typeof source.attempts !== "number" ||
    !Number.isSafeInteger(source.attempts) ||
    source.attempts <= 0 ||
    !identifier(source.consumerId) ||
    !identifier(source.fence) ||
    !identifier(source.messageId) ||
    !positiveRevision(source.messageVersion) ||
    !timestamp(source.receivedAt) ||
    source.recordFamily !== "inbox_receipt" ||
    source.recordSchemaVersion !== "zc.internal.inbox-receipt.v1" ||
    !purpose(source.requestedPurpose) ||
    !purpose(source.serverPurpose) ||
    !identifier(source.tenantId) ||
    source.requestedPurpose !== source.serverPurpose
  )
    return undefined;
  const receipt = freeze({
    attempts: source.attempts,
    consumerId: source.consumerId,
    fence: source.fence,
    messageId: source.messageId,
    messageVersion: source.messageVersion,
    receivedAt: source.receivedAt,
    recordFamily: "inbox_receipt" as const,
    recordSchemaVersion: "zc.internal.inbox-receipt.v1" as const,
    requestedPurpose: source.requestedPurpose,
    serverPurpose: source.serverPurpose,
    tenantId: source.tenantId,
  });
  return freeze({
    canonical: JSON.stringify(receipt),
    receipt,
  });
}

function scopeKey(tenantId: string, serverPurpose: string): string {
  return `${tenantId}\0${serverPurpose}`;
}

function messageKey(messageId: string, messageVersion: string): string {
  return `${messageId}\0${messageVersion}`;
}

function operationKey(operationId: string, attemptId: string): string {
  return `${operationId}\0${attemptId}`;
}

function inboxKey(
  consumerId: string,
  messageId: string,
  messageVersion: string,
  attempts: number,
  fence: string,
): string {
  return `${consumerId}\0${messageId}\0${messageVersion}\0${attempts}\0${fence}`;
}

function matchesScope(scope: OutboxScope, tenantId: string, serverPurpose: string): boolean {
  return scope.tenantId === tenantId && scope.serverPurpose === serverPurpose;
}

function bucket(store: Map<string, ScopeBucket>, key: string): ScopeBucket {
  const existing = store.get(key);
  if (existing) return existing;
  const created: ScopeBucket = {
    byMessage: new Map(),
    byOperation: new Map(),
    deliveries: new Map(),
    deadLetters: [],
    inbox: new Map(),
    pending: [],
    successors: new Map(),
  };
  store.set(key, created);
  return created;
}

function nextFence(seed: string, attempts: number): string {
  const attemptHex = attempts.toString(16).padStart(8, "0");
  if (!/^[0-9a-f]{48}$/u.test(seed)) return "0".repeat(48);
  return `${attemptHex}${seed.slice(0, 40)}`;
}

export function createLocalC07OutboxRepository(): OutboxRepository {
  const scopes = new Map<string, ScopeBucket>();

  return freeze({
    append(
      request: OutboxMessage,
      scope: OutboxScope,
      currentScope: () => boolean,
    ): OutboxAppendResult {
      if (!currentScope()) return denied;
      if (!matchesScope(scope, request.tenantId, request.serverPurpose)) return denied;
      const stored = normalizeMessage(request);
      if (!stored) return denied;
      if (!matchesScope(scope, stored.message.tenantId, stored.message.serverPurpose))
        return denied;
      const key = scopeKey(stored.message.tenantId, stored.message.serverPurpose);
      const scopeBucket = bucket(scopes, key);
      const byMessage = messageKey(stored.message.messageId, stored.message.messageVersion);
      const byOperation = operationKey(stored.message.operationId, stored.message.attemptId);
      if (stored.message.previousMessageVersion !== "0") {
        const predecessor = messageKey(
          stored.message.messageId,
          stored.message.previousMessageVersion,
        );
        if (!scopeBucket.byMessage.has(predecessor)) return conflict;
      }
      const existingMessage = scopeBucket.byMessage.get(byMessage);
      const existingOperation = scopeBucket.byOperation.get(byOperation);
      if (existingMessage || existingOperation) {
        const prior = existingMessage ?? existingOperation;
        if (!prior || prior.canonical !== stored.canonical) return conflict;
        if (!currentScope()) return denied;
        return freeze({ message: prior.message, outcome: "replayed" as const });
      }
      const predecessorKey = messageKey(
        stored.message.messageId,
        stored.message.previousMessageVersion,
      );
      if (scopeBucket.successors.has(predecessorKey)) return conflict;
      if (!currentScope()) return denied;
      scopeBucket.byMessage.set(byMessage, stored);
      scopeBucket.byOperation.set(byOperation, stored);
      scopeBucket.successors.set(predecessorKey, byMessage);
      scopeBucket.pending.push(byMessage);
      scopeBucket.deliveries.set(
        byMessage,
        freeze({
          attempts: 0,
          consumerId: "0".repeat(48),
          fence: "0".repeat(48),
          handle: freeze({}),
          key: byMessage,
          leaseExpiresAt: 0,
          messageId: stored.message.messageId,
          messageVersion: stored.message.messageVersion,
          status: "pending" as const,
        }),
      );
      return freeze({ message: stored.message, outcome: "appended" as const });
    },

    claim(scope: OutboxScope, now: number, currentScope: () => boolean): OutboxClaimResponse {
      if (!currentScope()) return freeze({ outcome: "denied" as const });
      if (!identifier(scope.consumerId)) return freeze({ outcome: "denied" as const });
      if (!Number.isSafeInteger(now) || now < 0) return freeze({ outcome: "denied" as const });
      const key = scopeKey(scope.tenantId, scope.serverPurpose);
      const scopeBucket = scopes.get(key);
      if (!scopeBucket) return undefined;
      for (const [deliveryKey, delivery] of scopeBucket.deliveries.entries()) {
        if (delivery.status !== "claimed" || delivery.leaseExpiresAt > now) continue;
        scopeBucket.deliveries.set(
          deliveryKey,
          freeze({
            ...delivery,
            consumerId: "0".repeat(48),
            fence: "0".repeat(48),
            handle: freeze({}),
            leaseExpiresAt: 0,
            status: "pending" as const,
          }),
        );
        scopeBucket.pending.push(deliveryKey);
      }
      while (scopeBucket.pending.length > 0) {
        const nextKey = scopeBucket.pending.shift();
        if (!nextKey) continue;
        const stored = scopeBucket.byMessage.get(nextKey);
        const delivery = scopeBucket.deliveries.get(nextKey);
        if (!stored || !delivery || delivery.status === "acked" || delivery.status === "dead")
          continue;
        if (delivery.status === "claimed") continue;
        if (!currentScope()) return freeze({ outcome: "denied" as const });
        const attempts = delivery.attempts + 1;
        const fence = nextFence(stored.message.messageId, attempts);
        const handle = freeze({});
        const claimed = freeze({
          attempts,
          consumerId: scope.consumerId,
          fence,
          handle,
          key: nextKey,
          leaseExpiresAt: now + leaseMilliseconds,
          messageId: stored.message.messageId,
          messageVersion: stored.message.messageVersion,
          status: "claimed" as const,
        });
        scopeBucket.deliveries.set(nextKey, claimed);
        return freeze({
          delivery: freeze({
            attempts: claimed.attempts,
            fence: claimed.fence,
            handle: claimed.handle,
            id: claimed.messageId,
          } satisfies OutboxDelivery),
          message: stored.message,
        });
      }
      return undefined;
    },

    acknowledge(
      request: OutboxAcknowledgeInput,
      scope: OutboxScope,
      now: number,
      currentScope: () => boolean,
    ): OutboxAcknowledgeResult | typeof denied {
      if (!currentScope()) return denied;
      if (
        typeof request.attempts !== "number" ||
        !Number.isSafeInteger(request.attempts) ||
        request.attempts <= 0 ||
        typeof request.handle !== "object" ||
        request.handle === null ||
        !identifier(request.id) ||
        !identifier(request.fence) ||
        (request.disposition !== "acknowledged" && request.disposition !== "retry")
      )
        return denied;
      if (!Number.isSafeInteger(now) || now < 0) return denied;

      const key = scopeKey(scope.tenantId, scope.serverPurpose);
      const scopeBucket = scopes.get(key);
      if (!scopeBucket) return freeze({ status: "lost" as const });
      if (!identifier(scope.consumerId)) return denied;

      for (const [deliveryKey, claimed] of scopeBucket.deliveries.entries()) {
        if (claimed.status !== "claimed") continue;
        if (claimed.messageId !== request.id || claimed.handle !== request.handle) continue;
        if (claimed.consumerId !== scope.consumerId) {
          if (!currentScope()) return denied;
          return freeze({ status: "stale" as const });
        }
        if (claimed.attempts !== request.attempts || claimed.fence !== request.fence) {
          if (!currentScope()) return denied;
          return freeze({ status: "stale" as const });
        }
        if (claimed.leaseExpiresAt <= now) return freeze({ status: "stale" as const });
        if (!currentScope()) return denied;
        if (request.disposition === "acknowledged") {
          const receipt = scopeBucket.inbox.get(
            inboxKey(
              scope.consumerId,
              claimed.messageId,
              claimed.messageVersion,
              claimed.attempts,
              claimed.fence,
            ),
          );
          if (!receipt) return freeze({ status: "stale" as const });
          scopeBucket.deliveries.set(
            deliveryKey,
            freeze({ ...claimed, leaseExpiresAt: 0, status: "acked" as const }),
          );
          return freeze({ status: "acknowledged" as const });
        }
        if (claimed.attempts >= maxAttempts) {
          scopeBucket.deliveries.set(
            deliveryKey,
            freeze({ ...claimed, leaseExpiresAt: 0, status: "dead" as const }),
          );
          scopeBucket.deadLetters.push(
            freeze({ id: claimed.messageId, messageVersion: claimed.messageVersion }),
          );
          return freeze({ status: "acknowledged" as const });
        }
        scopeBucket.deliveries.set(
          deliveryKey,
          freeze({
            ...claimed,
            consumerId: "0".repeat(48),
            fence: "0".repeat(48),
            handle: freeze({}),
            leaseExpiresAt: 0,
            status: "pending" as const,
          }),
        );
        scopeBucket.pending.push(deliveryKey);
        return freeze({ status: "acknowledged" as const });
      }
      if (!currentScope()) return denied;
      return freeze({ status: "lost" as const });
    },

    deadLetters(
      scope: OutboxScope,
      currentScope: () => boolean,
    ): readonly OutboxDeadLetter[] | typeof denied {
      if (!currentScope()) return denied;
      const key = scopeKey(scope.tenantId, scope.serverPurpose);
      const scopeBucket = scopes.get(key);
      if (!scopeBucket) return freeze([]);
      return freeze([...scopeBucket.deadLetters]);
    },

    recordInbox(
      request: InboxReceipt,
      scope: OutboxScope,
      now: number,
      currentScope: () => boolean,
    ): InboxReceiptResult {
      if (!currentScope()) return denied;
      if (!Number.isSafeInteger(now) || now < 0) return denied;
      if (!matchesScope(scope, request.tenantId, request.serverPurpose)) return denied;
      const stored = normalizeReceipt(request);
      if (!stored) return denied;
      if (!matchesScope(scope, stored.receipt.tenantId, stored.receipt.serverPurpose))
        return denied;
      const key = scopeKey(stored.receipt.tenantId, stored.receipt.serverPurpose);
      const scopeBucket = bucket(scopes, key);
      if (!identifier(scope.consumerId) || scope.consumerId !== stored.receipt.consumerId)
        return denied;
      const outboxKey = messageKey(stored.receipt.messageId, stored.receipt.messageVersion);
      if (!scopeBucket.byMessage.has(outboxKey)) return conflict;
      const delivery = scopeBucket.deliveries.get(outboxKey);
      if (
        !delivery ||
        delivery.status !== "claimed" ||
        delivery.leaseExpiresAt <= now ||
        delivery.consumerId !== stored.receipt.consumerId ||
        delivery.attempts !== stored.receipt.attempts ||
        delivery.fence !== stored.receipt.fence
      )
        return conflict;
      const byInbox = inboxKey(
        stored.receipt.consumerId,
        stored.receipt.messageId,
        stored.receipt.messageVersion,
        stored.receipt.attempts,
        stored.receipt.fence,
      );
      const existing = scopeBucket.inbox.get(byInbox);
      if (existing) {
        if (existing.canonical !== stored.canonical) return conflict;
        if (!currentScope()) return denied;
        return freeze({ outcome: "replayed" as const, receipt: existing.receipt });
      }
      if (!currentScope()) return denied;
      scopeBucket.inbox.set(byInbox, stored);
      return freeze({ outcome: "recorded" as const, receipt: stored.receipt });
    },
  });
}
