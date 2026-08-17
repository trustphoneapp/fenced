import {
  createDatabaseTenantIsolationService,
  type DatabaseEventRow,
  type DatabasePayloadAnchorRow,
  type DatabaseTenantIsolationReader,
  type DatabaseTenantIsolationService,
  type TenantContextService,
} from "@zintus-continuity/application";
import {
  isOwnedJsonArray,
  isOwnedJsonObject,
  type OwnedJsonObject,
  ownedJsonAt,
  ownedJsonEntries,
  ownedJsonLength,
  parseOwnedJson,
  readOwnedJson,
} from "@zintus-continuity/foundation/owned-json";

export const localC04DatabaseLimits = Object.freeze({ events: 64, payloadAnchors: 64 });

const invalidFixture = "INVALID_C04_DATABASE_FIXTURE";
const maximumRevision = 18_446_744_073_709_551_615n;
const eventTypes = new Set<DatabaseEventRow["eventType"]>([
  "interaction.appended",
  "memory.revision.recorded",
  "response.recorded",
  "task.checkpointed",
]);

function invalid(): never {
  throw new Error(invalidFixture);
}

function exactKeys(value: OwnedJsonObject, expected: readonly string[]): boolean {
  const entries = ownedJsonEntries(value);
  return (
    entries.length === expected.length && entries.every((entry) => expected.includes(entry[0]))
  );
}

function string(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}

function identifier(value: unknown): string {
  const candidate = string(value);
  return /^[0-9a-f]{48}$/u.test(candidate) ? candidate : invalid();
}

function purpose(value: unknown): string {
  const candidate = string(value);
  return candidate.length >= 1 && candidate.length <= 96 && /^[a-z][a-z0-9._:-]*$/u.test(candidate)
    ? candidate
    : invalid();
}

function revision(value: unknown): string {
  const candidate = string(value);
  if (candidate.length > 20 || !/^[1-9][0-9]*$/u.test(candidate)) return invalid();
  try {
    return BigInt(candidate) <= maximumRevision ? candidate : invalid();
  } catch {
    return invalid();
  }
}

function object(value: unknown): OwnedJsonObject {
  return isOwnedJsonObject(value) ? value : invalid();
}

function physicalKey(tenantId: string, identity: string, rowRevision: string): string {
  return `${tenantId}\u0000${identity}\u0000${rowRevision}`;
}

function scopeKey(
  tenantId: string,
  serverPurpose: string,
  identity: string,
  rowRevision: string,
): string {
  return `${tenantId}\u0000${serverPurpose}\u0000${identity}\u0000${rowRevision}`;
}

function parseAnchor(value: unknown): DatabasePayloadAnchorRow {
  const row = object(value);
  if (!exactKeys(row, ["payloadRef", "revision", "serverPurpose", "tenantId"])) invalid();
  return Object.freeze({
    payloadRef: identifier(readOwnedJson(row, "payloadRef")),
    revision: revision(readOwnedJson(row, "revision")),
    serverPurpose: purpose(readOwnedJson(row, "serverPurpose")),
    tenantId: identifier(readOwnedJson(row, "tenantId")),
  });
}

function parseEvent(value: unknown): DatabaseEventRow {
  const row = object(value);
  const keys = ownedJsonEntries(row).map((entry) => entry[0]);
  const hasPayloadRef = keys.includes("payloadRef");
  const hasPayloadRevision = keys.includes("payloadRevision");
  if (hasPayloadRef !== hasPayloadRevision) invalid();
  if (
    !exactKeys(row, [
      "eventId",
      "eventType",
      "occurredAt",
      ...(hasPayloadRef ? ["payloadRef", "payloadRevision"] : []),
      "revision",
      "serverPurpose",
      "subjectRef",
      "tenantId",
    ])
  )
    invalid();
  const eventType = string(readOwnedJson(row, "eventType"));
  if (!eventTypes.has(eventType as DatabaseEventRow["eventType"])) invalid();
  const occurredAt = string(readOwnedJson(row, "occurredAt"));
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u.test(occurredAt))
    invalid();
  const parsedTime = Date.parse(occurredAt);
  if (!Number.isFinite(parsedTime) || new Date(parsedTime).toISOString() !== occurredAt) invalid();
  return Object.freeze({
    eventId: identifier(readOwnedJson(row, "eventId")),
    eventType: eventType as DatabaseEventRow["eventType"],
    occurredAt,
    ...(hasPayloadRef
      ? {
          payloadRef: identifier(readOwnedJson(row, "payloadRef")),
          payloadRevision: revision(readOwnedJson(row, "payloadRevision")),
        }
      : {}),
    revision: revision(readOwnedJson(row, "revision")),
    serverPurpose: purpose(readOwnedJson(row, "serverPurpose")),
    subjectRef: identifier(readOwnedJson(row, "subjectRef")),
    tenantId: identifier(readOwnedJson(row, "tenantId")),
  });
}

function encodeAnchor(row: DatabasePayloadAnchorRow): string {
  return JSON.stringify({
    payloadRef: row.payloadRef,
    revision: row.revision,
    serverPurpose: row.serverPurpose,
    tenantId: row.tenantId,
  });
}

function encodeEvent(row: DatabaseEventRow): string {
  return JSON.stringify({
    eventId: row.eventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    ...(row.payloadRef === undefined
      ? {}
      : { payloadRef: row.payloadRef, payloadRevision: row.payloadRevision }),
    revision: row.revision,
    serverPurpose: row.serverPurpose,
    subjectRef: row.subjectRef,
    tenantId: row.tenantId,
  });
}

export function createLocalC04Database(
  contexts: TenantContextService,
  fixtureJson: unknown,
): DatabaseTenantIsolationService {
  let root: OwnedJsonObject;
  try {
    root = object(parseOwnedJson(fixtureJson, "small"));
  } catch {
    return invalid();
  }
  if (!exactKeys(root, ["events", "payloadAnchors"])) invalid();
  const eventValues = readOwnedJson(root, "events");
  const anchorValues = readOwnedJson(root, "payloadAnchors");
  if (!isOwnedJsonArray(eventValues) || !isOwnedJsonArray(anchorValues)) invalid();
  if (
    ownedJsonLength(eventValues) > localC04DatabaseLimits.events ||
    ownedJsonLength(anchorValues) > localC04DatabaseLimits.payloadAnchors
  )
    invalid();

  const events = new Map<string, string>();
  const anchors = new Map<string, string>();
  const eventPhysical = new Set<string>();
  const anchorPhysical = new Map<string, DatabasePayloadAnchorRow>();

  for (let index = 0; index < ownedJsonLength(anchorValues); index += 1) {
    const row = parseAnchor(ownedJsonAt(anchorValues, index));
    const physical = physicalKey(row.tenantId, row.payloadRef, row.revision);
    if (anchorPhysical.has(physical)) invalid();
    anchorPhysical.set(physical, row);
    anchors.set(
      scopeKey(row.tenantId, row.serverPurpose, row.payloadRef, row.revision),
      encodeAnchor(row),
    );
  }

  for (let index = 0; index < ownedJsonLength(eventValues); index += 1) {
    const row = parseEvent(ownedJsonAt(eventValues, index));
    const physical = physicalKey(row.tenantId, row.eventId, row.revision);
    if (eventPhysical.has(physical)) invalid();
    eventPhysical.add(physical);
    if (row.payloadRef !== undefined && row.payloadRevision !== undefined) {
      const anchor = anchorPhysical.get(
        physicalKey(row.tenantId, row.payloadRef, row.payloadRevision),
      );
      if (!anchor || anchor.serverPurpose !== row.serverPurpose) invalid();
    }
    events.set(
      scopeKey(row.tenantId, row.serverPurpose, row.eventId, row.revision),
      encodeEvent(row),
    );
  }

  const reader: DatabaseTenantIsolationReader = Object.freeze({
    findEvent: (tenantId: string, serverPurpose: string, eventId: string, rowRevision: string) =>
      events.get(scopeKey(tenantId, serverPurpose, eventId, rowRevision)),
    findPayloadAnchor: (
      tenantId: string,
      serverPurpose: string,
      payloadRef: string,
      rowRevision: string,
    ) => anchors.get(scopeKey(tenantId, serverPurpose, payloadRef, rowRevision)),
  });
  return createDatabaseTenantIsolationService(contexts, reader);
}
