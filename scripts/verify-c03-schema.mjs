import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseRoot = path.join(repositoryRoot, "database");
const migrationRoot = path.join(databaseRoot, "migrations");
const migrationName = "0001_tenant_event_ledger.sql";
const purposeMigrationName = "0002_purpose_qualified_tenant_keys.sql";
const roleSessionMigrationName = "0003_role_session_isolation.sql";
const payloadStorageMigrationName = "0004_erasable_payload_storage.sql";
const eventRevisionRequestsMigrationName = "0005_immutable_event_links.sql";
const outboxInboxMigrationName = "0006_outbox_inbox.sql";
const agentMemoryMigrationName = "0007_agent_memory.sql";
const hackathonLiveMigrationName = "0008_hackathon_live.sql";
const hackathonQuotaWindowMigrationName = "0009_hackathon_quota_window.sql";
const hackathonFkReadGrantsMigrationName = "0010_hackathon_fk_read_grants.sql";
const migrationPath = path.join(migrationRoot, migrationName);
const readmePath = path.join(databaseRoot, "README.md");
const contractsRoot = path.join(repositoryRoot, "packages", "contracts", "schemas", "v1");
const eventContractPath = path.join(contractsRoot, "event.schema.json");
const envelopeContractPath = path.join(contractsRoot, "envelope.schema.json");
const maxBytes = 32 * 1024;
const maxContractStringLength = 256;
const positiveUint64Maximum = "18446744073709551615";
const exactB02Digests = Object.freeze({
  envelope: "ab8b1160381d79586d35a22ffb75d65f1a312d4e8106ffa01403d5754f124d7a",
  event: "5d205f9747274f4631318fe3163faaa8f81226b8285db6b01f1ad32c70475a48",
});

const exactB02 = Object.freeze({
  eventProperties: Object.freeze([
    "attemptId",
    "causationId",
    "contractFamily",
    "correlationId",
    "eventId",
    "eventRevision",
    "eventType",
    "occurredAt",
    "operationId",
    "payloadRef",
    "requestedPurpose",
    "schemaVersion",
    "serverPurpose",
    "subjectRef",
    "tenantId",
  ]),
  eventRequired: Object.freeze([
    "schemaVersion",
    "contractFamily",
    "tenantId",
    "requestedPurpose",
    "serverPurpose",
    "operationId",
    "attemptId",
    "eventId",
    "eventRevision",
    "eventType",
    "occurredAt",
    "subjectRef",
  ]),
  eventTypes: Object.freeze([
    "interaction.appended",
    "memory.revision.recorded",
    "response.recorded",
    "task.checkpointed",
  ]),
  identifier: Object.freeze({
    maxLength: 48,
    minLength: 48,
    pattern: "^[0-9a-f]{48}$",
    type: "string",
  }),
  purpose: Object.freeze({
    maxLength: 96,
    minLength: 1,
    pattern: "^[a-z][a-z0-9._:-]*$",
    type: "string",
  }),
  reference: Object.freeze({
    maxLength: 48,
    minLength: 48,
    pattern: "^[0-9a-f]{48}$",
    type: "string",
  }),
  revision: Object.freeze({
    maxLength: 20,
    minLength: 1,
    pattern: "^[1-9][0-9]{0,19}$",
    type: "string",
  }),
  schemaVersion: "zc.contracts.v1",
  timestamp: Object.freeze({
    format: "date-time",
    maxLength: 24,
    minLength: 24,
    pattern:
      "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
    type: "string",
  }),
});

const compact = (source) =>
  source
    .replace(/--[^\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;
const sameArray = (left, right) =>
  Array.isArray(left) &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);
const sameSet = (left, right) => sameArray([...left].sort(), [...right].sort());

function schemaError(message) {
  throw new Error(`C03 B02 contract binding failed: ${message}`);
}

function objectKeys(value, label, maximum) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    schemaError(`${label} is not an object`);
  const keys = Object.keys(value);
  if (keys.length > maximum) schemaError(`${label} exceeds its key cap`);
  return keys;
}

function exactKeys(value, expected, label) {
  if (!sameSet(objectKeys(value, label, expected.length), expected))
    schemaError(`${label} does not have its exact key set`);
}

function boundedString(value, label) {
  if (typeof value !== "string" || value.length > maxContractStringLength)
    schemaError(`${label} is not a bounded string`);
  return value;
}

function exactDefinition(definitions, name, expected) {
  const value = definitions?.[name];
  exactKeys(value, Object.keys(expected), `envelope ${name}`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actual = value[key];
    if (typeof expectedValue === "string") boundedString(actual, `envelope ${name}.${key}`);
    if (actual !== expectedValue) schemaError(`envelope ${name}.${key} differs from B02`);
  }
}

function exactRef(value, name) {
  exactKeys(value, ["$ref"], `event ref ${name}`);
  if (value.$ref !== `./envelope.schema.json#/$defs/${name}`)
    schemaError(`event property does not bind ${name}`);
}

export function deriveC03BindingsForTest(eventContract, envelopeContract) {
  exactKeys(
    eventContract,
    ["$schema", "$id", "title", "type", "additionalProperties", "required", "properties"],
    "event contract",
  );
  if (eventContract.type !== "object" || eventContract.additionalProperties !== false)
    schemaError("event contract is not closed object metadata");
  if (!sameArray(eventContract.required, exactB02.eventRequired))
    schemaError("event required list differs from B02");
  exactKeys(eventContract.properties, exactB02.eventProperties, "event properties");
  exactKeys(
    envelopeContract?.$defs,
    [
      "schemaVersion",
      "identifier",
      "purpose",
      "clientToken",
      "version",
      "reference",
      "dateTime",
      "uint64",
      "positiveUint64",
      "int64",
      "sha256",
      "externalTuple",
    ],
    "envelope definitions",
  );
  exactDefinition(envelopeContract.$defs, "schemaVersion", { const: exactB02.schemaVersion });
  exactDefinition(envelopeContract.$defs, "identifier", exactB02.identifier);
  exactDefinition(envelopeContract.$defs, "purpose", exactB02.purpose);
  exactDefinition(envelopeContract.$defs, "reference", exactB02.reference);
  exactDefinition(envelopeContract.$defs, "positiveUint64", exactB02.revision);
  exactDefinition(envelopeContract.$defs, "dateTime", exactB02.timestamp);
  for (const [property, binding] of [
    ["schemaVersion", "schemaVersion"],
    ["tenantId", "identifier"],
    ["requestedPurpose", "purpose"],
    ["serverPurpose", "purpose"],
    ["operationId", "identifier"],
    ["attemptId", "identifier"],
    ["eventId", "identifier"],
    ["eventRevision", "positiveUint64"],
    ["occurredAt", "dateTime"],
    ["subjectRef", "reference"],
    ["payloadRef", "reference"],
    ["causationId", "identifier"],
    ["correlationId", "identifier"],
  ])
    exactRef(eventContract.properties[property], binding);
  exactKeys(eventContract.properties.contractFamily, ["const"], "event contractFamily");
  if (eventContract.properties.contractFamily.const !== "event")
    schemaError("event contractFamily differs from B02");
  exactKeys(eventContract.properties.eventType, ["enum"], "event eventType");
  if (!sameArray(eventContract.properties.eventType.enum, exactB02.eventTypes))
    schemaError("eventType enum differs from B02");
  return exactB02;
}

const identifierCheck = (column, binding) => `CHECK (${column} ~ ${sqlString(binding.pattern)})`;
const optionalIdentifierCheck = (column, binding) =>
  `CHECK (${column} IS NULL OR ${column} ~ ${sqlString(binding.pattern)})`;
const purposeCheck = (column, binding) =>
  `CHECK (length(${column}) BETWEEN ${binding.minLength} AND ${binding.maxLength} AND ${column} ~ ${sqlString(binding.pattern)})`;
const optionalPurposeCheck = (column, binding) =>
  `CHECK (${column} IS NULL OR (length(${column}) BETWEEN ${binding.minLength} AND ${binding.maxLength} AND ${column} ~ ${sqlString(binding.pattern)}))`;
const positiveRevisionCheck = (column, optional = false) => {
  const condition = `${column} >= 1 AND ${column} <= ${positiveUint64Maximum}`;
  return `CHECK (${optional ? `${column} IS NULL OR (${condition})` : condition})`;
};

export function canonicalC03MigrationForTest(bindings) {
  if (bindings !== exactB02) schemaError("canonical SQL requires exact loaded B02 bindings");
  const revisionType = `DECIMAL(${bindings.revision.maxLength}, 0)`;
  const eventTypes = bindings.eventTypes.map(sqlString).join(",\n    ");
  return `BEGIN;

CREATE SCHEMA continuity;

CREATE TABLE continuity.tenants (
  tenant_id STRING NOT NULL ${identifierCheck("tenant_id", bindings.identifier)},
  PRIMARY KEY (tenant_id)
);

CREATE TABLE continuity.payload_anchors (
  tenant_id STRING NOT NULL ${identifierCheck("tenant_id", bindings.identifier)},
  payload_ref STRING NOT NULL ${identifierCheck("payload_ref", bindings.reference)},
  payload_revision ${revisionType} NOT NULL ${positiveRevisionCheck("payload_revision")},
  requested_purpose STRING NOT NULL ${purposeCheck("requested_purpose", bindings.purpose)},
  server_purpose STRING NOT NULL ${purposeCheck("server_purpose", bindings.purpose)},
  PRIMARY KEY (tenant_id, payload_ref, payload_revision),
  UNIQUE (tenant_id, payload_ref, payload_revision, requested_purpose, server_purpose),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE continuity.events (
  tenant_id STRING NOT NULL ${identifierCheck("tenant_id", bindings.identifier)},
  event_id STRING NOT NULL ${identifierCheck("event_id", bindings.identifier)},
  event_revision ${revisionType} NOT NULL ${positiveRevisionCheck("event_revision")},
  schema_version STRING NOT NULL CHECK (schema_version = ${sqlString(bindings.schemaVersion)}),
  requested_purpose STRING NOT NULL ${purposeCheck("requested_purpose", bindings.purpose)},
  server_purpose STRING NOT NULL ${purposeCheck("server_purpose", bindings.purpose)},
  operation_id STRING NOT NULL ${identifierCheck("operation_id", bindings.identifier)},
  attempt_id STRING NOT NULL ${identifierCheck("attempt_id", bindings.identifier)},
  event_type STRING NOT NULL CHECK (event_type IN (
    ${eventTypes}
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  subject_ref STRING NOT NULL ${identifierCheck("subject_ref", bindings.reference)},
  payload_tenant_id STRING,
  payload_ref STRING,
  payload_revision ${revisionType},
  payload_requested_purpose STRING,
  payload_server_purpose STRING,
  causation_id STRING,
  correlation_id STRING,
  ${optionalIdentifierCheck("payload_tenant_id", bindings.identifier)},
  ${optionalIdentifierCheck("payload_ref", bindings.reference)},
  ${positiveRevisionCheck("payload_revision", true)},
  ${optionalPurposeCheck("payload_requested_purpose", bindings.purpose)},
  ${optionalPurposeCheck("payload_server_purpose", bindings.purpose)},
  ${optionalIdentifierCheck("causation_id", bindings.identifier)},
  ${optionalIdentifierCheck("correlation_id", bindings.identifier)},
  CHECK (payload_tenant_id IS NULL OR payload_tenant_id = tenant_id),
  CHECK (payload_requested_purpose IS NULL OR payload_requested_purpose = requested_purpose),
  CHECK (payload_server_purpose IS NULL OR payload_server_purpose = server_purpose),
  CHECK ((payload_tenant_id IS NULL AND payload_ref IS NULL AND payload_revision IS NULL AND payload_requested_purpose IS NULL AND payload_server_purpose IS NULL) OR (payload_tenant_id IS NOT NULL AND payload_ref IS NOT NULL AND payload_revision IS NOT NULL AND payload_requested_purpose IS NOT NULL AND payload_server_purpose IS NOT NULL)),
  PRIMARY KEY (tenant_id, event_id, event_revision),
  FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (payload_tenant_id, payload_ref, payload_revision, payload_requested_purpose, payload_server_purpose)
    REFERENCES continuity.payload_anchors (tenant_id, payload_ref, payload_revision, requested_purpose, server_purpose)
    MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMIT;
`;
}

export function validateB02PositiveUint64ForTest(value, bindings) {
  if (bindings !== exactB02) schemaError("positive uint64 requires exact loaded B02 bindings");
  if (typeof value !== "string" || value.length > bindings.revision.maxLength)
    throw new Error("C03 positive uint64 is outside its lexical bound");
  if (!new RegExp(bindings.revision.pattern, "u").test(value))
    throw new Error("C03 positive uint64 does not match B02");
  if (BigInt(value) > BigInt(positiveUint64Maximum))
    throw new Error("C03 positive uint64 exceeds uint64 maximum");
  return true;
}

export function validateB02OccurredAtForTest(value, bindings) {
  if (bindings !== exactB02) schemaError("occurredAt requires exact loaded B02 bindings");
  if (
    typeof value !== "string" ||
    value.length < bindings.timestamp.minLength ||
    value.length > bindings.timestamp.maxLength ||
    !new RegExp(bindings.timestamp.pattern, "u").test(value)
  )
    throw new Error("C03 occurredAt does not match B02 UTC-millisecond syntax");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value)
    throw new Error("C03 occurredAt is not a calendar-valid B02 timestamp");
  return true;
}

export function validateC03MigrationTextForTest(source, bindings) {
  if (typeof source !== "string" || source.length === 0 || source.length > maxBytes)
    throw new Error("C03 migration text is outside its bound");
  if (
    source.includes("\r") ||
    source.startsWith("\uFEFF") ||
    !source.endsWith("\n") ||
    source.endsWith("\n\n")
  )
    throw new Error("C03 migration must be strict UTF-8 text with exactly one final LF");
  const sql = compact(source);
  if (/\bDELETE\s+FROM\b/iu.test(sql)) throw new Error("C03 schema rejects DELETE FROM");
  if (/\b(?:CASCADE|SET\s+NULL)\b/iu.test(sql))
    throw new Error("C03 schema rejects non-restrictive foreign-key action");
  if (sql !== compact(canonicalC03MigrationForTest(bindings)))
    throw new Error("C03 migration differs from the exact B02-bound canonical statement set");
  return true;
}

const snapshotStat = (stat) =>
  Object.freeze({
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    mtimeNs: stat.mtimeNs,
    nlink: stat.nlink,
    size: stat.size,
  });
const sameSnapshot = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

async function assertCanonicalPath(filePath, label) {
  const relative = path.relative(repositoryRoot, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`${label} is outside the repository root`);
  let current = repositoryRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (await realpath(current)) !== current)
      throw new Error(`${label} has a non-canonical path component`);
  }
}

function assertCanonicalFileStat(stat, label) {
  if (
    !stat.isFile() ||
    stat.nlink !== 1n ||
    stat.size === 0n ||
    stat.size > BigInt(maxBytes) ||
    (stat.mode & 0o777n) !== 0o644n
  )
    throw new Error(`${label} is not a bounded singly-linked mode-0644 regular file`);
}

async function pathnameSnapshot(filePath, label, file = true) {
  await assertCanonicalPath(filePath, label);
  const stat = await lstat(filePath, { bigint: true });
  if (file) assertCanonicalFileStat(stat, label);
  return Object.freeze({ path: await realpath(filePath), stat: snapshotStat(stat) });
}

async function assertSamePathnameSnapshot(filePath, expected, label, file = true) {
  const actual = await pathnameSnapshot(filePath, label, file);
  if (actual.path !== expected.path || !sameSnapshot(actual.stat, expected.stat))
    throw new Error(`${label} changed during C03 verification`);
}

async function readCanonicalBytes(filePath, label) {
  const listedBefore = await pathnameSnapshot(filePath, label);
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    assertCanonicalFileStat(before, label);
    if (!sameSnapshot(listedBefore.stat, snapshotStat(before)))
      throw new Error(`${label} changed before guarded read`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    assertCanonicalFileStat(after, label);
    if (
      !sameSnapshot(snapshotStat(before), snapshotStat(after)) ||
      BigInt(bytes.length) !== before.size
    )
      throw new Error(`${label} changed during guarded read`);
    const listedAfter = await pathnameSnapshot(filePath, label);
    if (
      !sameSnapshot(snapshotStat(after), listedAfter.stat) ||
      listedAfter.path !== listedBefore.path
    )
      throw new Error(`${label} changed after guarded read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readCanonicalFile(filePath, label) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readCanonicalBytes(filePath, label),
  );
}

function exactB02Json(bytes, label, expectedDigest) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes)
    schemaError(`${label} bytes are outside their bound`);
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== expectedDigest) schemaError(`${label} byte hash differs from exact B02`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function deriveC03BindingsFromBytesForTest(eventBytes, envelopeBytes) {
  return deriveC03BindingsForTest(
    exactB02Json(eventBytes, "event contract", exactB02Digests.event),
    exactB02Json(envelopeBytes, "envelope contract", exactB02Digests.envelope),
  );
}

export async function loadC03ContractBindingsForTest() {
  return deriveC03BindingsFromBytesForTest(
    await readCanonicalBytes(eventContractPath, "C03 B02 event contract"),
    await readCanonicalBytes(envelopeContractPath, "C03 B02 envelope contract"),
  );
}

async function verifyC03SchemaInternal(testHook) {
  const initial = Object.freeze({
    contracts: Object.freeze({
      envelope: await pathnameSnapshot(envelopeContractPath, "C03 B02 envelope contract"),
      event: await pathnameSnapshot(eventContractPath, "C03 B02 event contract"),
    }),
    migration: await pathnameSnapshot(migrationPath, "C03 migration"),
    migrationDirectory: await pathnameSnapshot(migrationRoot, "C03 migrations", false),
    readme: await pathnameSnapshot(readmePath, "C03 database README"),
  });
  const migrationDirectory = await lstat(migrationRoot, { bigint: true });
  if (!migrationDirectory.isDirectory() || migrationDirectory.isSymbolicLink())
    throw new Error("C03 migrations must be a real directory");
  const migrations = (await readdir(migrationRoot)).sort();
  if (
    JSON.stringify(migrations) !==
    JSON.stringify([
      migrationName,
      purposeMigrationName,
      roleSessionMigrationName,
      payloadStorageMigrationName,
      eventRevisionRequestsMigrationName,
      outboxInboxMigrationName,
      agentMemoryMigrationName,
      hackathonLiveMigrationName,
      hackathonQuotaWindowMigrationName,
      hackathonFkReadGrantsMigrationName,
    ])
  )
    throw new Error("C03 migration order differs from the canonical initial ledger");
  const readme = await readCanonicalFile(readmePath, "C03 database README");
  if (!readme.includes("content-free payload anchors") || !readme.includes("forward-only"))
    throw new Error("C03 database README does not state the canonical boundary");
  validateC03MigrationTextForTest(
    await readCanonicalFile(migrationPath, "C03 migration"),
    await loadC03ContractBindingsForTest(),
  );
  await testHook?.();
  await assertSamePathnameSnapshot(readmePath, initial.readme, "C03 database README");
  await assertSamePathnameSnapshot(migrationPath, initial.migration, "C03 migration");
  await assertSamePathnameSnapshot(
    eventContractPath,
    initial.contracts.event,
    "C03 B02 event contract",
  );
  await assertSamePathnameSnapshot(
    envelopeContractPath,
    initial.contracts.envelope,
    "C03 B02 envelope contract",
  );
  await assertSamePathnameSnapshot(
    migrationRoot,
    initial.migrationDirectory,
    "C03 migrations",
    false,
  );
  if (!sameArray((await readdir(migrationRoot)).sort(), migrations))
    throw new Error("C03 migration list changed during verification");
  return { migration: migrationName, tables: ["tenants", "payload_anchors", "events"] };
}

export async function verifyC03Schema() {
  return verifyC03SchemaInternal();
}

export async function verifyC03SchemaForTest(testHook) {
  if (typeof testHook !== "function") throw new Error("C03 test hook must be a function");
  return verifyC03SchemaInternal(testHook);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyC03Schema()
    .then(({ migration, tables }) =>
      process.stdout.write(`C03 schema PASS: ${migration} (${tables.join(", ")})\n`),
    )
    .catch((error) => {
      process.stderr.write(`C03 schema FAIL: ${error.message}\n`);
      process.exitCode = 1;
    });
}
