import { types as nodeUtilTypes } from "node:util";

import {
  type FaultJournalEntry,
  type LocalHarnessErrorCode,
  type LocalIdentity,
  type LocalJson,
  type LocalProviderInvocation,
  type LocalScope,
  type LocalStateResult,
  type LocalSyntheticFixture,
  type LocalSyntheticFixtureDefinition,
  localHarnessBounds,
  localSyntheticFixture,
  type QueueEnqueueMessage,
} from "@zintus-continuity/application";
import {
  copyOwnDataRecord,
  hasOwnDataProperty,
  ownDataHasNoSymbols,
  ownDataKeys,
  ownDataPropertyNames,
  readOwnDataDescriptor,
} from "@zintus-continuity/foundation/safe-data-access";

const plainArrayPrototype = Object.getPrototypeOf([]);
const plainObjectPrototype = Object.getPrototypeOf({});

export class LocalHarnessError extends Error {
  constructor(readonly code: LocalHarnessErrorCode) {
    super(code);
    this.name = "LocalHarnessError";
  }
}

export function compareUtf8(left: string, right: string): number {
  const bytes = (value: string): number[] => {
    const out: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      let point = value.charCodeAt(index);
      if (point >= 0xd800 && point <= 0xdbff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (value.charCodeAt(index + 1) - 0xdc00);
        index += 1;
      }
      if (point <= 0x7f) out.push(point);
      else if (point <= 0x7ff) out.push(0xc0 | (point >> 6), 0x80 | (point & 63));
      else if (point <= 0xffff)
        out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
      else
        out.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 63),
          0x80 | ((point >> 6) & 63),
          0x80 | (point & 63),
        );
    }
    return out;
  };
  const a = bytes(left);
  const b = bytes(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const leftByte = a.at(index) ?? fail("INVALID_INPUT");
    const rightByte = b.at(index) ?? fail("INVALID_INPUT");
    const delta = leftByte - rightByte;
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

const fail = (code: LocalHarnessErrorCode): never => {
  throw new LocalHarnessError(code);
};
const safe = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,127}$/u.test(value) &&
  !value.includes("..");
const keyOf = (tenant: string, purpose: string): string => `${tenant}\u0000${purpose}`;

/** Node-local proxy detection prevents traps before any reflective validation. */
function rejectProxy(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  try {
    if (nodeUtilTypes.isProxy(value)) fail("INVALID_INPUT");
  } catch (error) {
    if (error instanceof LocalHarnessError) throw error;
    fail("INVALID_INPUT");
  }
}

/** Copies only descriptor values. No caller object is read after this boundary. */
function exactRecord<const K extends readonly string[]>(
  value: unknown,
  expected: K,
): Readonly<Record<K[number], unknown>>;
function exactRecord<const K extends readonly string[], const O extends readonly string[]>(
  value: unknown,
  expected: K,
  optional: O,
): Readonly<Record<K[number], unknown> & Partial<Record<O[number], unknown>>>;
function exactRecord<const K extends readonly string[], const O extends readonly string[]>(
  value: unknown,
  expected: K,
  optional?: O,
): Readonly<Record<string, unknown>> {
  try {
    rejectProxy(value);
    if (
      !value ||
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== plainObjectPrototype
    )
      fail("INVALID_INPUT");
    const objectValue = copyOwnDataRecord(value as object);
    const keys = ownDataKeys(objectValue);
    if (
      keys.length < expected.length ||
      keys.length > expected.length + (optional?.length ?? 0) ||
      keys.some((key) => typeof key !== "string")
    )
      fail("INVALID_INPUT");
    for (let index = 0; index < expected.length; index += 1) {
      const name = expected.at(index) ?? fail("INVALID_INPUT");
      const descriptor = readOwnDataDescriptor(objectValue, name) ?? fail("INVALID_INPUT");
      if (descriptor.enumerable !== true) fail("INVALID_INPUT");
    }
    for (const key of keys) {
      if (typeof key !== "string" || expected.includes(key) || optional?.includes(key)) continue;
      fail("INVALID_INPUT");
    }
    for (const name of optional ?? []) {
      const descriptor = readOwnDataDescriptor(objectValue, name);
      if (!descriptor) continue;
      if (descriptor.enumerable !== true) fail("INVALID_INPUT");
    }
    return objectValue as Readonly<Record<K[number], unknown>>;
  } catch (error) {
    if (error instanceof LocalHarnessError) throw error;
    return fail("INVALID_INPUT");
  }
}

function ownData<T = unknown>(
  value: object,
  key: string,
): Readonly<{ enumerable: boolean; value: T }> {
  rejectProxy(value);
  return readOwnDataDescriptor<T>(value, key) ?? fail("INVALID_INPUT");
}

function bytesOf(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("INVALID_INPUT");
      total += 4;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail("INVALID_INPUT");
    else total += unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
  }
  return total;
}

function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string" || bytesOf(value) > localHarnessBounds.stringBytes)
    fail("INVALID_INPUT");
}

function assertArray(value: unknown): asserts value is readonly unknown[] {
  rejectProxy(value);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== plainArrayPrototype)
    fail("INVALID_INPUT");
  const arrayValue = value as readonly unknown[];
  const names = ownDataPropertyNames(arrayValue);
  if (
    names.length !== arrayValue.length + 1 ||
    names.at(names.length - 1) !== "length" ||
    !ownDataHasNoSymbols(arrayValue)
  )
    fail("INVALID_INPUT");
  const length = ownData(arrayValue, "length");
  if (length.enumerable || length.value !== arrayValue.length) fail("INVALID_INPUT");
  for (let index = 0; index < arrayValue.length; index += 1) {
    if (names.at(index) !== String(index) || ownData(arrayValue, String(index)).enumerable !== true)
      fail("INVALID_INPUT");
  }
}

function validateJson(value: unknown): asserts value is LocalJson {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let payloadBytes = 0;
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 32 || nodes++ >= 256) fail("INVALID_INPUT");
    if (entry === null || typeof entry === "boolean") return;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry) || Object.is(entry, -0)) fail("INVALID_INPUT");
      return;
    }
    if (typeof entry === "string") {
      assertText(entry);
      payloadBytes += bytesOf(entry);
      if (payloadBytes > localHarnessBounds.payloadBytes) fail("INVALID_INPUT");
      return;
    }
    try {
      rejectProxy(entry);
      if (Array.isArray(entry)) {
        assertArray(entry);
        if (entry.length > 64 || seen.has(entry)) fail("INVALID_INPUT");
        seen.add(entry as object);
        for (let index = 0; index < entry.length; index += 1)
          visit(ownData(entry, String(index)).value, depth + 1);
        return;
      }
      if (!entry || typeof entry !== "object" || seen.has(entry)) fail("INVALID_INPUT");
      const objectEntry = entry as object;
      const prototype = Object.getPrototypeOf(objectEntry);
      if (prototype !== plainObjectPrototype && prototype !== null) fail("INVALID_INPUT");
      const names = ownDataPropertyNames(objectEntry);
      if (names.length > 64 || !ownDataHasNoSymbols(objectEntry)) fail("INVALID_INPUT");
      seen.add(objectEntry);
      for (const name of names) {
        assertText(name);
        payloadBytes += bytesOf(name);
        if (payloadBytes > localHarnessBounds.payloadBytes) fail("INVALID_INPUT");
        const descriptor = ownData(entry as object, name);
        if (!descriptor.enumerable) fail("INVALID_INPUT");
        visit(descriptor.value, depth + 1);
      }
    } catch (error) {
      if (error instanceof LocalHarnessError) throw error;
      fail("INVALID_INPUT");
    }
  };
  visit(value, 0);
}

function canonical(value: LocalJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    let out = "[";
    for (let index = 0; index < value.length; index += 1)
      out += `${index ? "," : ""}${canonical(ownData(value, String(index)).value as LocalJson)}`;
    return `${out}]`;
  }
  const names = Array.from(ownDataPropertyNames(value)).sort(compareUtf8);
  let out = "{";
  for (let index = 0; index < names.length; index += 1) {
    const name = names.at(index) ?? fail("INVALID_INPUT");
    out += `${index ? "," : ""}${JSON.stringify(name)}:${canonical(ownData(value, name).value as LocalJson)}`;
  }
  return `${out}}`;
}

function freezeJson(value: LocalJson): LocalJson {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      freezeJson(ownData(value, String(index)).value as LocalJson);
  } else {
    const names = ownDataPropertyNames(value);
    for (let index = 0; index < names.length; index += 1)
      freezeJson(ownData(value, names.at(index) ?? fail("INVALID_INPUT")).value as LocalJson);
  }
  return Object.freeze(value);
}

function copy(value: LocalJson): LocalJson {
  return freezeJson(JSON.parse(canonical(value)) as LocalJson);
}

function fixtureArray(value: unknown, limit: number): readonly unknown[] {
  if (value === undefined) return Object.freeze([]);
  assertArray(value);
  if (value.length > limit) fail("INVALID_INPUT");
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index += 1)
    out.push(ownData(value, String(index)).value);
  return Object.freeze(out);
}

function requiredIdentifier(value: unknown): string {
  if (identifier(value)) return value;
  return fail("INVALID_INPUT");
}

function requiredSafe(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (safe(value, maximum)) return value;
  return fail("INVALID_INPUT");
}

function jsonValue(value: unknown): LocalJson {
  validateJson(value);
  return copy(value);
}

export function createLocalSyntheticFixture(
  definition: LocalSyntheticFixtureDefinition,
): LocalSyntheticFixture {
  const setup = exactRecord(
    definition,
    ["identities"],
    [
      "faultSchedule",
      "initialTime",
      "providerFixtures",
      "queueLeaseMilliseconds",
      "queueMaxAttempts",
      "vectorDimension",
    ],
  );
  const identityDefinitions = fixtureArray(setup.identities, localHarnessBounds.identities);
  if (identityDefinitions.length === 0) fail("INVALID_INPUT");
  const providerDefinitions = fixtureArray(
    setup.providerFixtures,
    localHarnessBounds.providerFixtures,
  );
  const rules = fixtureArray(setup.faultSchedule, localHarnessBounds.faultRules);
  const initialTime = requiredSafe(setup.initialTime ?? 0);
  const lease = requiredSafe(setup.queueLeaseMilliseconds ?? 10, 1_000_000);
  const maxAttempts = requiredSafe(setup.queueMaxAttempts ?? 3, 8);
  const dimension = requiredSafe(setup.vectorDimension ?? 3, localHarnessBounds.vectorDimension);
  if (lease === 0 || maxAttempts === 0 || dimension === 0) fail("INVALID_INPUT");
  const identitiesByCredential = new Map<
    string,
    {
      readonly credential: string;
      readonly subject: string;
      readonly tenant: string;
      readonly purposes: ReadonlySet<string>;
    }
  >();
  for (const item of identityDefinitions) {
    const identity = exactRecord(item, ["credentialRef", "purposes", "subjectId", "tenantId"]);
    const credentialRef = requiredIdentifier(identity.credentialRef);
    const subjectId = requiredIdentifier(identity.subjectId);
    const tenantId = requiredIdentifier(identity.tenantId);
    if (identitiesByCredential.has(credentialRef)) fail("INVALID_INPUT");
    const purposeValues = fixtureArray(identity.purposes, localHarnessBounds.vectorSearchLimit);
    const set = new Set<string>();
    for (const itemPurpose of purposeValues) {
      const purpose = requiredIdentifier(itemPurpose);
      if (set.has(purpose)) fail("INVALID_INPUT");
      set.add(purpose);
    }
    if (set.size === 0) fail("INVALID_INPUT");
    identitiesByCredential.set(
      credentialRef,
      Object.freeze({
        credential: credentialRef,
        purposes: set,
        subject: subjectId,
        tenant: tenantId,
      }),
    );
  }
  const providerByKey = new Map<string, string>();
  const providerKey = (
    tenant: string,
    purpose: string,
    operation: string,
    attemptId: string,
    requestId: string,
    provider: string,
    model: string,
    policyVersion: string,
    contextCompilerVersion: string,
  ): string =>
    `${tenant}\u0000${purpose}\u0000${operation}\u0000${attemptId}\u0000${requestId}\u0000${provider}\u0000${model}\u0000${policyVersion}\u0000${contextCompilerVersion}`;
  for (const item of providerDefinitions) {
    const provider = exactRecord(item, [
      "tenantId",
      "purpose",
      "operation",
      "attemptId",
      "requestId",
      "provider",
      "model",
      "policyVersion",
      "contextCompilerVersion",
      "outputRef",
    ]);
    const tenantId = requiredIdentifier(provider.tenantId);
    const purpose = requiredIdentifier(provider.purpose);
    const operation = requiredIdentifier(provider.operation);
    const attemptId = requiredIdentifier(provider.attemptId);
    const requestId = requiredIdentifier(provider.requestId);
    const providerId = requiredIdentifier(provider.provider);
    const model = requiredIdentifier(provider.model);
    const policyVersion = requiredIdentifier(provider.policyVersion);
    const contextCompilerVersion = requiredIdentifier(provider.contextCompilerVersion);
    const outputRef = requiredIdentifier(provider.outputRef);
    const key = providerKey(
      tenantId,
      purpose,
      operation,
      attemptId,
      requestId,
      providerId,
      model,
      policyVersion,
      contextCompilerVersion,
    );
    if (providerByKey.has(key)) fail("INVALID_INPUT");
    providerByKey.set(key, outputRef);
  }
  const faultRulesByScope = new Map<string, readonly FaultJournalEntry[]>();
  for (const item of rules) {
    const rule = exactRecord(item, ["action", "operation", "ordinal", "purpose", "tenantId"]);
    if (rule.operation !== "queue.ack" || rule.action !== "lost_ack") fail("INVALID_INPUT");
    const ordinal = requiredSafe(rule.ordinal, 1_000_000);
    const purpose = requiredIdentifier(rule.purpose);
    const tenantId = requiredIdentifier(rule.tenantId);
    if (ordinal === 0) fail("INVALID_INPUT");
    const scopeKey = keyOf(tenantId, purpose);
    const existing = faultRulesByScope.get(scopeKey) ?? [];
    if (existing.some((existingRule) => existingRule.ordinal === ordinal)) fail("INVALID_INPUT");
    faultRulesByScope.set(
      scopeKey,
      Object.freeze(
        existing.concat(
          Object.freeze({
            action: "lost_ack" as const,
            operation: "queue.ack" as const,
            ordinal,
          }),
        ),
      ),
    );
  }

  let now = initialTime;
  let generation = 0;
  let sequences = new Map<string, bigint>();
  const identities = new WeakMap<
    object,
    {
      readonly generation: number;
      readonly definition: {
        readonly credential: string;
        readonly tenant: string;
        readonly purposes: ReadonlySet<string>;
      };
    }
  >();
  const scopes = new WeakMap<
    object,
    { readonly generation: number; readonly tenant: string; readonly purpose: string }
  >();
  let state = new Map<
    string,
    Map<string, { readonly revision: number; readonly value: LocalJson }>
  >();
  let tokens = new Map<
    string,
    Map<string, { readonly fingerprint: string; readonly result: LocalStateResult }>
  >();
  let queues = new Map<
    string,
    Array<{
      id: string;
      seq: string;
      attempts: number;
      commitment: string;
      due: number;
      lease: object | undefined;
    }>
  >();
  let dead = new Map<string, Array<{ readonly id: string }>>();
  let vectorRows = new Map<string, Map<string, readonly number[]>>();
  let journal = new Map<string, FaultJournalEntry[]>();
  const ordinals = new Map<string, number>();
  const seenMessages = new Map<string, Map<string, string>>();
  const deliveryHandles = new WeakMap<
    object,
    {
      readonly attempts: number;
      readonly deliveryId: string;
      readonly generation: number;
      readonly messageCommitment: string;
      readonly messageId: string;
      readonly scopeKey: string;
    }
  >();
  const next = (scopeKey: string): string => {
    const sequence = sequences.get(scopeKey) ?? 0n;
    if (sequence >= 1n << 192n) fail("INVALID_INPUT");
    const id = sequence.toString(16).padStart(48, "0");
    sequences.set(scopeKey, sequence + 1n);
    return id;
  };
  const scope = (
    value: LocalScope,
  ): { readonly generation: number; readonly tenant: string; readonly purpose: string } => {
    rejectProxy(value);
    const record = scopes.get(value as object);
    if (!record) return fail("INVALID_SCOPE");
    if (record.generation !== generation) fail("STALE_HANDLE");
    return record;
  };
  const scoped = (
    value: LocalScope,
  ): {
    readonly key: string;
    readonly record: {
      readonly generation: number;
      readonly tenant: string;
      readonly purpose: string;
    };
  } => {
    const record = scope(value);
    return { key: keyOf(record.tenant, record.purpose), record };
  };
  const cap = (size: number, maximum: number): void => {
    if (size >= maximum) fail("INVALID_INPUT");
  };
  const expire = (records: Array<{ due: number; lease: object | undefined }>): void => {
    for (const entry of records)
      if (entry.lease && entry.due <= now) {
        entry.lease = undefined;
      }
  };
  const vector = (values: unknown): readonly number[] => {
    assertArray(values);
    if (values.length !== dimension) fail("DIMENSION_MISMATCH");
    const out: number[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const item = ownData<number>(values, String(index)).value;
      if (
        typeof item !== "number" ||
        !Number.isFinite(item) ||
        Object.is(item, -0) ||
        Math.abs(item) > 1_000_000
      )
        fail("DIMENSION_MISMATCH");
      out.push(item);
    }
    return Object.freeze(out);
  };
  const runtime: LocalSyntheticFixture["runtime"] = Object.freeze({
    fixture: localSyntheticFixture,
    clock: Object.freeze({
      now: () => now,
      advance: (milliseconds: number) => {
        const elapsed = requiredSafe(milliseconds, 1_000_000);
        if (now > Number.MAX_SAFE_INTEGER - elapsed) fail("INVALID_INPUT");
        now += elapsed;
        return now;
      },
    }),
    identity: Object.freeze({
      resolve: (credentialRef: string) => {
        if (!identifier(credentialRef)) fail("INVALID_INPUT");
        const definition = identitiesByCredential.get(credentialRef);
        if (!definition) return undefined;
        const value = Object.freeze({ fixture: localSyntheticFixture });
        identities.set(value, Object.freeze({ definition, generation }));
        return value;
      },
      authorize: (identity: LocalIdentity, purpose: string) => {
        rejectProxy(identity);
        const record = identities.get(identity as object);
        if (!record) return fail("INVALID_SCOPE");
        if (record.generation !== generation) fail("STALE_HANDLE");
        if (!identifier(purpose) || !record.definition.purposes.has(purpose)) fail("NOT_PERMITTED");
        const value = Object.freeze({ fixture: localSyntheticFixture });
        scopes.set(value, Object.freeze({ generation, purpose, tenant: record.definition.tenant }));
        return value;
      },
    }),
    state: Object.freeze({
      write: (
        access: LocalScope,
        write: { expectedRevision?: number; idempotencyKey: string; key: string; value: LocalJson },
      ) => {
        const active = scoped(access);
        const request = exactRecord(
          write,
          ["idempotencyKey", "key", "value"],
          ["expectedRevision"],
        );
        const expectedRevision = hasOwnDataProperty(request, "expectedRevision")
          ? requiredSafe(request.expectedRevision)
          : undefined;
        const idempotencyKey = requiredIdentifier(request.idempotencyKey);
        const name = requiredIdentifier(request.key);
        const value = jsonValue(request.value);
        const fingerprintInput: LocalJson = Object.freeze({
          expectedRevision: expectedRevision ?? null,
          key: name,
          value,
        });
        const fingerprint = canonical(fingerprintInput);
        const rows = state.get(active.key) ?? new Map();
        const idem = tokens.get(active.key) ?? new Map();
        const replay = idem.get(idempotencyKey);
        if (replay) {
          if (replay.fingerprint !== fingerprint) fail("IDEMPOTENCY_MISMATCH");
          return Object.freeze({ revision: replay.result.revision, status: "replayed" as const });
        }
        const prior = rows.get(name);
        if (expectedRevision !== undefined && prior?.revision !== expectedRevision)
          fail("CONFLICT");
        if (!prior) cap(rows.size, localHarnessBounds.stateRows);
        cap(idem.size, localHarnessBounds.stateRows);
        const result = Object.freeze({
          revision: (prior?.revision ?? 0) + 1,
          status: "applied" as const,
        });
        rows.set(name, Object.freeze({ revision: result.revision, value }));
        idem.set(idempotencyKey, Object.freeze({ fingerprint, result }));
        state.set(active.key, rows);
        tokens.set(active.key, idem);
        return result;
      },
      read: (access: LocalScope, name: string) => {
        const active = scoped(access);
        if (!identifier(name)) fail("INVALID_INPUT");
        const value = state.get(active.key)?.get(name);
        return value
          ? Object.freeze({ revision: value.revision, value: copy(value.value) })
          : undefined;
      },
    }),
    queue: Object.freeze({
      enqueue: (access: LocalScope, message: QueueEnqueueMessage) => {
        const active = scoped(access);
        const request = exactRecord(message, ["commitment", "id"]);
        const commitment = requiredIdentifier(request.commitment);
        const id = requiredIdentifier(request.id);
        const seen = seenMessages.get(active.key) ?? new Map<string, string>();
        const priorCommitment = seen.get(id);
        if (priorCommitment !== undefined) {
          if (priorCommitment !== commitment) fail("CONFLICT");
          return Object.freeze({ status: "replayed" as const });
        }
        const rows = queues.get(active.key) ?? [];
        cap(seen.size, localHarnessBounds.messageCommitments);
        cap(rows.length, localHarnessBounds.queueDepth);
        rows.push({
          attempts: 0,
          commitment,
          due: now,
          id,
          lease: undefined,
          seq: next(active.key),
        });
        queues.set(active.key, rows);
        seen.set(id, commitment);
        seenMessages.set(active.key, seen);
        return Object.freeze({ status: "enqueued" as const });
      },
      claim: (access: LocalScope) => {
        const active = scoped(access);
        const rows = queues.get(active.key) ?? [];
        expire(rows);
        rows.sort((a, b) => compareUtf8(a.id, b.id) || compareUtf8(a.seq, b.seq));
        for (let index = 0; index < rows.length; index += 1) {
          const entry = rows.at(index) ?? fail("INVALID_INPUT");
          if (entry.lease || entry.due > now) continue;
          if (entry.attempts >= maxAttempts) {
            const items = dead.get(active.key) ?? [];
            cap(items.length, localHarnessBounds.queueDepth);
            rows.splice(index, 1);
            items.push(Object.freeze({ id: entry.id }));
            dead.set(active.key, items);
            index -= 1;
            continue;
          }
          if (now > Number.MAX_SAFE_INTEGER - lease) fail("INVALID_INPUT");
          entry.attempts += 1;
          entry.due = now + lease;
          const handle = Object.freeze({});
          deliveryHandles.set(
            handle,
            Object.freeze({
              attempts: entry.attempts,
              deliveryId: next(active.key),
              generation,
              messageCommitment: entry.commitment,
              messageId: entry.id,
              scopeKey: active.key,
            }),
          );
          entry.lease = handle;
          return Object.freeze({ attempts: entry.attempts, handle: entry.lease, id: entry.id });
        }
        return undefined;
      },
      acknowledge: (access: LocalScope, delivery: { id: string; handle: object }) => {
        const active = scoped(access);
        const request = exactRecord(delivery, ["attempts", "handle", "id"]);
        const attempts = requiredSafe(request.attempts);
        const id = requiredIdentifier(request.id);
        const handle = request.handle;
        if (attempts === 0 || !handle || typeof handle !== "object") return fail("INVALID_INPUT");
        const deliveryHandle = handle;
        rejectProxy(deliveryHandle);
        const binding = deliveryHandles.get(deliveryHandle);
        const rows = queues.get(active.key) ?? [];
        expire(rows);
        const entry = rows.find((item) => item.id === id);
        if (
          !entry ||
          entry.lease !== deliveryHandle ||
          !binding ||
          binding.scopeKey !== active.key ||
          binding.generation !== generation ||
          binding.messageId !== entry.id ||
          binding.messageCommitment !== entry.commitment ||
          binding.attempts !== attempts
        )
          return Object.freeze({ status: "stale" as const });
        const ordinal = (ordinals.get(active.key) ?? 0) + 1;
        ordinals.set(active.key, ordinal);
        const hit = faultRulesByScope.get(active.key)?.find((rule) => rule.ordinal === ordinal);
        if (hit) {
          const entries = journal.get(active.key) ?? [];
          cap(entries.length, localHarnessBounds.faultJournal);
          entries.push(
            Object.freeze({ action: hit.action, operation: hit.operation, ordinal: hit.ordinal }),
          );
          journal.set(active.key, entries);
          return Object.freeze({ status: "lost" as const });
        }
        rows.splice(rows.indexOf(entry), 1);
        return Object.freeze({ status: "acknowledged" as const });
      },
      deadLetters: (access: LocalScope) => {
        const active = scoped(access);
        const entries = dead.get(active.key) ?? [];
        return Object.freeze(entries.map((item) => Object.freeze({ id: item.id })));
      },
    }),
    vectors: Object.freeze({
      upsert: (access: LocalScope, id: string, coordinates: readonly number[]) => {
        const active = scoped(access);
        if (!identifier(id)) fail("INVALID_INPUT");
        const values = vector(coordinates);
        const rows = vectorRows.get(active.key) ?? new Map();
        if (!rows.has(id)) cap(rows.size, localHarnessBounds.vectorRows);
        rows.set(id, values);
        vectorRows.set(active.key, rows);
      },
      search: (access: LocalScope, query: readonly number[], limit: number) => {
        const active = scoped(access);
        const values = vector(query);
        const resultLimit = requiredSafe(limit, localHarnessBounds.vectorSearchLimit);
        const matches: Array<{ id: string; score: number }> = [];
        for (const [id, stored] of vectorRows.get(active.key) ?? []) {
          let score = 0;
          for (let index = 0; index < dimension; index += 1) {
            const storedValue = stored.at(index) ?? fail("DIMENSION_MISMATCH");
            const queryValue = values.at(index) ?? fail("DIMENSION_MISMATCH");
            const product = storedValue * queryValue;
            if (
              !Number.isFinite(product) ||
              !Number.isFinite(score + product) ||
              Math.abs(score + product) > 16_000_000_000_000
            )
              fail("DIMENSION_MISMATCH");
            score += product;
          }
          matches.push(Object.freeze({ id, score }));
        }
        matches.sort((a, b) => b.score - a.score || compareUtf8(a.id, b.id));
        return Object.freeze(
          matches
            .slice(0, resultLimit)
            .map((item) => Object.freeze({ id: item.id, score: item.score })),
        );
      },
    }),
    provider: Object.freeze({
      invoke: (access: LocalScope, invocation: LocalProviderInvocation) => {
        const active = scope(access);
        const request = exactRecord(invocation, [
          "attemptId",
          "contextCompilerVersion",
          "model",
          "operation",
          "policyVersion",
          "provider",
          "requestId",
        ]);
        const operation = requiredIdentifier(request.operation);
        const attemptId = requiredIdentifier(request.attemptId);
        const requestId = requiredIdentifier(request.requestId);
        const provider = requiredIdentifier(request.provider);
        const model = requiredIdentifier(request.model);
        const policyVersion = requiredIdentifier(request.policyVersion);
        const contextCompilerVersion = requiredIdentifier(request.contextCompilerVersion);
        const output = providerByKey.get(
          providerKey(
            active.tenant,
            active.purpose,
            operation,
            attemptId,
            requestId,
            provider,
            model,
            policyVersion,
            contextCompilerVersion,
          ),
        );
        return output
          ? Object.freeze({
              outcome: "provided" as const,
              outputRef: output,
              trust: "untrusted_data" as const,
            })
          : Object.freeze({ code: "NOT_PERMITTED" as const, outcome: "denied" as const });
      },
    }),
    tools: Object.freeze({
      catalogue: () => Object.freeze([]) as readonly [],
      execute: (access: LocalScope, toolId: string) => {
        scope(access);
        if (!identifier(toolId)) fail("INVALID_INPUT");
        return Object.freeze({ code: "NOT_PERMITTED" as const, outcome: "denied" as const });
      },
    }),
    faults: Object.freeze({
      journal: (access: LocalScope) => {
        const active = scoped(access);
        return Object.freeze(
          (journal.get(active.key) ?? []).map((item) =>
            Object.freeze({
              action: item.action,
              operation: item.operation,
              ordinal: item.ordinal,
            }),
          ),
        );
      },
    }),
  });
  const controller = Object.freeze({
    reset: () => {
      for (const records of queues.values()) {
        expire(records);
        if (records.some((item) => item.lease)) fail("BUSY");
      }
      generation += 1;
      now = initialTime;
      sequences = new Map();
      state = new Map();
      tokens = new Map();
      queues = new Map();
      dead = new Map();
      vectorRows = new Map();
      journal = new Map();
      ordinals.clear();
      seenMessages.clear();
    },
  });
  return Object.freeze({ controller, runtime });
}
