import type { TenantContextService } from "./tenant-context.js";

export interface DatabaseEventRow {
  readonly eventId: string;
  readonly eventType:
    | "interaction.appended"
    | "memory.revision.recorded"
    | "response.recorded"
    | "task.checkpointed";
  readonly occurredAt: string;
  readonly payloadRef?: string;
  readonly payloadRevision?: string;
  readonly revision: string;
  readonly serverPurpose: string;
  readonly subjectRef: string;
  readonly tenantId: string;
}

export interface DatabasePayloadAnchorRow {
  readonly payloadRef: string;
  readonly revision: string;
  readonly serverPurpose: string;
  readonly tenantId: string;
}

export interface DatabaseTenantIsolationReader {
  readonly findEvent: (
    tenantId: string,
    serverPurpose: string,
    eventId: string,
    revision: string,
  ) => string | undefined;
  readonly findPayloadAnchor: (
    tenantId: string,
    serverPurpose: string,
    payloadRef: string,
    revision: string,
  ) => string | undefined;
}

export interface DatabaseEventProjection {
  readonly eventId: string;
  readonly eventType: DatabaseEventRow["eventType"];
  readonly occurredAt: string;
  readonly payload?: Readonly<{ readonly payloadRef: string; readonly revision: string }>;
  readonly revision: string;
  readonly subjectRef: string;
}

export type DatabaseEventResult =
  | Readonly<{ readonly event: DatabaseEventProjection; readonly outcome: "found" }>
  | Readonly<{ readonly outcome: "denied" }>
  | Readonly<{ readonly outcome: "not_found" }>;

export type DatabasePayloadAnchorResult =
  | Readonly<{
      readonly anchor: Readonly<{ readonly payloadRef: string; readonly revision: string }>;
      readonly outcome: "found";
    }>
  | Readonly<{ readonly outcome: "denied" }>
  | Readonly<{ readonly outcome: "not_found" }>;

export interface DatabaseTenantIsolationService {
  readonly findEvent: (
    context: unknown,
    eventId: unknown,
    revision: unknown,
    serverNowEpochSeconds: unknown,
  ) => DatabaseEventResult;
  readonly findPayloadAnchor: (
    context: unknown,
    payloadRef: unknown,
    revision: unknown,
    serverNowEpochSeconds: unknown,
  ) => DatabasePayloadAnchorResult;
}

const denied = Object.freeze({ outcome: "denied" as const });
const notFound = Object.freeze({ outcome: "not_found" as const });
const maximumRevision = 18_446_744_073_709_551_615n;
const plainObjectPrototype = Object.getPrototypeOf({});
const encodedRowLimits = Object.freeze({ anchorBytes: 512, eventBytes: 2_048 });
const eventTypes = new Set<DatabaseEventRow["eventType"]>([
  "interaction.appended",
  "memory.revision.recorded",
  "response.recorded",
  "task.checkpointed",
]);

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{48}$/u.test(value);
}

function purpose(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 96 &&
    /^[a-z][a-z0-9._:-]*$/u.test(value)
  );
}

function revision(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 20 || !/^[1-9][0-9]*$/u.test(value)) return false;
  try {
    return BigInt(value) <= maximumRevision;
  } catch {
    return false;
  }
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

function exactObject(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== plainObjectPrototype
  )
    return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseEncodedObject(encoded: unknown, maximum: number): unknown {
  if (typeof encoded !== "string" || !utf8BytesWithin(encoded, maximum)) return undefined;
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    return undefined;
  }
}

function parseEventRow(encoded: unknown): DatabaseEventRow | undefined {
  if (typeof encoded !== "string") return undefined;
  const value = parseEncodedObject(encoded, encodedRowLimits.eventBytes);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  const hasPayloadRef = keys.includes("payloadRef");
  const hasPayloadRevision = keys.includes("payloadRevision");
  if (hasPayloadRef !== hasPayloadRevision) return undefined;
  const expected = [
    "eventId",
    "eventType",
    "occurredAt",
    ...(hasPayloadRef ? ["payloadRef", "payloadRevision"] : []),
    "revision",
    "serverPurpose",
    "subjectRef",
    "tenantId",
  ];
  if (!exactObject(value, expected)) return undefined;
  if (
    !identifier(value.eventId) ||
    typeof value.eventType !== "string" ||
    !eventTypes.has(value.eventType as DatabaseEventRow["eventType"]) ||
    !timestamp(value.occurredAt) ||
    !revision(value.revision) ||
    !purpose(value.serverPurpose) ||
    !identifier(value.subjectRef) ||
    !identifier(value.tenantId) ||
    (hasPayloadRef && (!identifier(value.payloadRef) || !revision(value.payloadRevision)))
  )
    return undefined;
  const projection: DatabaseEventRow = {
    eventId: value.eventId,
    eventType: value.eventType as DatabaseEventRow["eventType"],
    occurredAt: value.occurredAt,
    ...(hasPayloadRef
      ? { payloadRef: value.payloadRef as string, payloadRevision: value.payloadRevision as string }
      : {}),
    revision: value.revision,
    serverPurpose: value.serverPurpose,
    subjectRef: value.subjectRef,
    tenantId: value.tenantId,
  };
  return JSON.stringify(projection) === encoded ? Object.freeze(projection) : undefined;
}

function parseAnchorRow(encoded: unknown): DatabasePayloadAnchorRow | undefined {
  if (typeof encoded !== "string") return undefined;
  const value = parseEncodedObject(encoded, encodedRowLimits.anchorBytes);
  if (!exactObject(value, ["payloadRef", "revision", "serverPurpose", "tenantId"]))
    return undefined;
  if (
    !identifier(value.payloadRef) ||
    !revision(value.revision) ||
    !purpose(value.serverPurpose) ||
    !identifier(value.tenantId)
  )
    return undefined;
  const projection: DatabasePayloadAnchorRow = {
    payloadRef: value.payloadRef,
    revision: value.revision,
    serverPurpose: value.serverPurpose,
    tenantId: value.tenantId,
  };
  return JSON.stringify(projection) === encoded ? Object.freeze(projection) : undefined;
}

export function createDatabaseTenantIsolationService(
  contexts: TenantContextService,
  reader: DatabaseTenantIsolationReader,
): DatabaseTenantIsolationService {
  function scope(context: unknown, serverNowEpochSeconds: unknown) {
    try {
      const checked = contexts.validate(context, serverNowEpochSeconds) as unknown;
      if (checked === null || typeof checked !== "object") return undefined;
      const result = checked as Record<string, unknown>;
      if (result.outcome !== "issued") return undefined;
      const issued = result.context;
      if (issued === null || typeof issued !== "object") return undefined;
      const contextRecord = issued as Record<string, unknown>;
      const workload = contextRecord.workload;
      if (workload === null || typeof workload !== "object") return undefined;
      const capability = (workload as Record<string, unknown>).capability;
      const operation = contextRecord.operation;
      const serverPurpose = contextRecord.purpose;
      const tenantId = contextRecord.tenantId;
      return identifier(tenantId) &&
        purpose(serverPurpose) &&
        operation === "database.read" &&
        capability === "continuity.database.read"
        ? Object.freeze({ capability, operation, serverPurpose, tenantId })
        : undefined;
    } catch {
      return undefined;
    }
  }

  function scopeUnchanged(
    context: unknown,
    serverNowEpochSeconds: unknown,
    expected: Readonly<{
      readonly capability: "continuity.database.read";
      readonly operation: "database.read";
      readonly serverPurpose: string;
      readonly tenantId: string;
    }>,
  ): boolean {
    const current = scope(context, serverNowEpochSeconds);
    return (
      current !== undefined &&
      current.tenantId === expected.tenantId &&
      current.serverPurpose === expected.serverPurpose &&
      current.operation === expected.operation &&
      current.capability === expected.capability
    );
  }

  return Object.freeze({
    findEvent(
      context: unknown,
      eventId: unknown,
      eventRevision: unknown,
      serverNowEpochSeconds: unknown,
    ): DatabaseEventResult {
      const authorized = scope(context, serverNowEpochSeconds);
      if (!authorized || !identifier(eventId) || !revision(eventRevision)) return denied;
      let encoded: unknown;
      let readerFailed = false;
      try {
        encoded = reader.findEvent(
          authorized.tenantId,
          authorized.serverPurpose,
          eventId,
          eventRevision,
        );
      } catch {
        readerFailed = true;
      }
      if (!scopeUnchanged(context, serverNowEpochSeconds, authorized)) return denied;
      if (readerFailed) return denied;
      if (encoded === undefined) return notFound;
      const row = parseEventRow(encoded);
      if (!row) return denied;
      if (
        row.tenantId !== authorized.tenantId ||
        row.serverPurpose !== authorized.serverPurpose ||
        row.eventId !== eventId ||
        row.revision !== eventRevision
      )
        return denied;
      const payload =
        row.payloadRef === undefined
          ? undefined
          : Object.freeze({ payloadRef: row.payloadRef, revision: row.payloadRevision as string });
      const event = Object.freeze({
        eventId: row.eventId,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        ...(payload ? { payload } : {}),
        revision: row.revision,
        subjectRef: row.subjectRef,
      });
      return Object.freeze({ event, outcome: "found" });
    },
    findPayloadAnchor(
      context: unknown,
      payloadRef: unknown,
      payloadRevision: unknown,
      serverNowEpochSeconds: unknown,
    ): DatabasePayloadAnchorResult {
      const authorized = scope(context, serverNowEpochSeconds);
      if (!authorized || !identifier(payloadRef) || !revision(payloadRevision)) return denied;
      let encoded: unknown;
      let readerFailed = false;
      try {
        encoded = reader.findPayloadAnchor(
          authorized.tenantId,
          authorized.serverPurpose,
          payloadRef,
          payloadRevision,
        );
      } catch {
        readerFailed = true;
      }
      if (!scopeUnchanged(context, serverNowEpochSeconds, authorized)) return denied;
      if (readerFailed) return denied;
      if (encoded === undefined) return notFound;
      const row = parseAnchorRow(encoded);
      if (!row) return denied;
      if (
        row.tenantId !== authorized.tenantId ||
        row.serverPurpose !== authorized.serverPurpose ||
        row.payloadRef !== payloadRef ||
        row.revision !== payloadRevision
      )
        return denied;
      const anchor = Object.freeze({ payloadRef: row.payloadRef, revision: row.revision });
      return Object.freeze({ anchor, outcome: "found" });
    },
  });
}
