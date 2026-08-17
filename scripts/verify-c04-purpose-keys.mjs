import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(repositoryRoot, "database", "migrations");
const initialPath = path.join(migrationRoot, "0001_tenant_event_ledger.sql");
const migrationPath = path.join(migrationRoot, "0002_purpose_qualified_tenant_keys.sql");
const expectedMigrations = Object.freeze([
  "0001_tenant_event_ledger.sql",
  "0002_purpose_qualified_tenant_keys.sql",
  "0003_role_session_isolation.sql",
  "0004_erasable_payload_storage.sql",
  "0005_immutable_event_links.sql",
  "0006_outbox_inbox.sql",
  "0007_agent_memory.sql",
  "0008_hackathon_live.sql",
  "0009_hackathon_quota_window.sql",

  "0010_hackathon_fk_read_grants.sql",

  "0011_mcp_reader_membership.sql",
]);
const initialSha256 = "9179c8575d6b9cb2a6ef82db2e73409a96b0de5b8bcf3d213ec12768e7d325f2";
const maxBytes = 16 * 1024;

export const canonicalC04PurposeKeysMigration = `BEGIN;

ALTER TABLE continuity.events
  DROP CONSTRAINT events_payload_tenant_id_payload_ref_payload_revision_payload_requested_purpose_payload_server_purpose_fkey;

ALTER TABLE continuity.events
  DROP CONSTRAINT events_pkey;

ALTER TABLE continuity.payload_anchors
  DROP CONSTRAINT payload_anchors_pkey;

ALTER TABLE continuity.payload_anchors
  DROP CONSTRAINT payload_anchors_tenant_id_payload_ref_payload_revision_requested_purpose_server_purpose_key;

ALTER TABLE continuity.payload_anchors
  ADD CONSTRAINT payload_anchors_purpose_pkey
  PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision);

ALTER TABLE continuity.payload_anchors
  ADD CONSTRAINT payload_anchors_purpose_requested_key
  UNIQUE (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose);

ALTER TABLE continuity.events
  ADD CONSTRAINT events_purpose_pkey
  PRIMARY KEY (tenant_id, server_purpose, event_id, event_revision);

ALTER TABLE continuity.events
  ADD CONSTRAINT events_payload_purpose_fkey
  FOREIGN KEY (
    payload_tenant_id,
    payload_server_purpose,
    payload_ref,
    payload_revision,
    payload_requested_purpose
  ) REFERENCES continuity.payload_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose
  ) MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
`;

const compact = (source) =>
  source
    .replace(/--[^\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const snapshot = (stat) =>
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
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs &&
  left.nlink === right.nlink &&
  left.size === right.size;

function exactFileStat(stat, label) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    stat.size === 0n ||
    stat.size > BigInt(maxBytes) ||
    (stat.mode & 0o777n) !== 0o644n
  )
    throw new Error(`${label} is not a bounded singly-linked mode-0644 regular file`);
}

async function readExactFile(filePath, label) {
  if ((await realpath(filePath)) !== filePath) throw new Error(`${label} path is not canonical`);
  const listed = await lstat(filePath, { bigint: true });
  exactFileStat(listed, label);
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    exactFileStat(before, label);
    if (!sameSnapshot(snapshot(listed), snapshot(before))) throw new Error(`${label} changed`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameSnapshot(snapshot(before), snapshot(after)) || BigInt(bytes.length) !== after.size)
      throw new Error(`${label} changed during guarded read`);
    return Object.freeze({ bytes, stat: snapshot(after) });
  } finally {
    await handle.close();
  }
}

async function assertUnchanged(filePath, expected, label) {
  const actual = await lstat(filePath, { bigint: true });
  exactFileStat(actual, label);
  if ((await realpath(filePath)) !== filePath || !sameSnapshot(expected, snapshot(actual)))
    throw new Error(`${label} changed during verification`);
}

export function validateC04PurposeKeysTextForTest(source) {
  if (typeof source !== "string" || source.length === 0 || source.length > maxBytes)
    throw new Error("C04 purpose-key migration text is outside its bound");
  if (
    source.includes("\r") ||
    source.startsWith("\uFEFF") ||
    !source.endsWith("\n") ||
    source.endsWith("\n\n")
  )
    throw new Error("C04 purpose-key migration must have strict framing");
  const sql = compact(source);
  if (
    /\b(?:INSERT\s+INTO|UPSERT\s+INTO|DELETE\s+FROM|TRUNCATE|CREATE\s+(?:TABLE|SCHEMA|ROLE|USER)|GRANT|REVOKE|SET\s+(?:ROLE|SESSION|LOCAL)|RESET\s+ROLE|EXECUTE|PREPARE)\b/iu.test(
      sql,
    ) ||
    /\bUPDATE\s+\S+\s+SET\b/iu.test(sql)
  )
    throw new Error("C04 purpose-key migration contains forbidden SQL");
  if (/\b(?:CASCADE|SET\s+NULL)\b/iu.test(sql))
    throw new Error("C04 purpose-key migration contains a non-restrictive action");
  if (sql !== compact(canonicalC04PurposeKeysMigration))
    throw new Error("C04 purpose-key migration differs from the exact statement set");
  return true;
}

export async function readC04PurposeMigrationAtPathForTest(candidate) {
  if (candidate !== migrationPath) throw new Error("C04 purpose-key migration path is not exact");
  return (await readExactFile(candidate, "C04 purpose-key migration")).bytes;
}

async function verifyInternal(testHook) {
  const listedBefore = (await readdir(migrationRoot)).sort();
  if (JSON.stringify(listedBefore) !== JSON.stringify(expectedMigrations))
    throw new Error("C04 purpose-key migration list or order differs");
  const initial = await readExactFile(initialPath, "C04 accepted 0001 migration");
  if (digest(initial.bytes) !== initialSha256) throw new Error("C04 accepted 0001 hash differs");
  const migration = await readExactFile(migrationPath, "C04 purpose-key migration");
  validateC04PurposeKeysTextForTest(
    new TextDecoder("utf-8", { fatal: true }).decode(migration.bytes),
  );
  await testHook?.();
  await assertUnchanged(initialPath, initial.stat, "C04 accepted 0001 migration");
  await assertUnchanged(migrationPath, migration.stat, "C04 purpose-key migration");
  if (JSON.stringify((await readdir(migrationRoot)).sort()) !== JSON.stringify(listedBefore))
    throw new Error("C04 purpose-key migration list changed during verification");
  return Object.freeze({
    migration: "0002_purpose_qualified_tenant_keys.sql",
    tables: Object.freeze(["tenants", "payload_anchors", "events"]),
  });
}

export async function verifyC04PurposeKeys() {
  return verifyInternal();
}

export async function verifyC04PurposeKeysForTest(testHook) {
  if (typeof testHook !== "function") throw new Error("C04 purpose-key hook must be a function");
  return verifyInternal(testHook);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyC04PurposeKeys()
    .then(({ migration, tables }) =>
      process.stdout.write(`C04 purpose keys PASS: ${migration} (${tables.join(", ")})\n`),
    )
    .catch((error) => {
      process.stderr.write(`C04 purpose keys FAIL: ${error.message}\n`);
      process.exitCode = 1;
    });
}
