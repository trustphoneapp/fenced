import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(repositoryRoot, "database", "migrations");
const migrationPath = path.join(migrationRoot, "0003_role_session_isolation.sql");
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
]);
const acceptedMigrations = Object.freeze([
  Object.freeze({
    path: path.join(migrationRoot, expectedMigrations[0]),
    sha256: "9179c8575d6b9cb2a6ef82db2e73409a96b0de5b8bcf3d213ec12768e7d325f2",
  }),
  Object.freeze({
    path: path.join(migrationRoot, expectedMigrations[1]),
    sha256: "8dcc5604ce1dbb6316f9aa3c4f1422e009ffcc1b75d4961df4f7d3ee1babf9af",
  }),
]);
const maxBytes = 32 * 1024;

export const canonicalC04RoleSessionMigration = `BEGIN;

CREATE ROLE zc_continuity_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

CREATE ROLE zc_continuity_executor
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

REVOKE ALL PRIVILEGES ON SCHEMA continuity FROM PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE continuity.tenants FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.payload_anchors FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE continuity.events FROM PUBLIC;

GRANT USAGE ON SCHEMA continuity TO zc_continuity_reader;

GRANT SELECT ON TABLE continuity.tenants TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.payload_anchors TO zc_continuity_reader;
GRANT SELECT ON TABLE continuity.events TO zc_continuity_reader;

ALTER TABLE continuity.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE continuity.payload_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.payload_anchors FORCE ROW LEVEL SECURITY;

ALTER TABLE continuity.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity.events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_reader_scope
  ON continuity.tenants
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
  );

CREATE POLICY payload_anchors_reader_scope
  ON continuity.payload_anchors
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

CREATE POLICY events_reader_scope
  ON continuity.events
  FOR SELECT
  TO zc_continuity_reader
  USING (
    current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
    AND tenant_id = current_setting('continuity.tenant_id', true)
    AND length(current_setting('continuity.server_purpose', true)) BETWEEN 1 AND 96
    AND current_setting('continuity.server_purpose', true) ~ '^[a-z][a-z0-9._:-]*$'
    AND server_purpose = current_setting('continuity.server_purpose', true)
  );

COMMIT;
`;

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

export function validateC04RoleSessionTextForTest(source) {
  if (typeof source !== "string" || source.length === 0 || source.length > maxBytes)
    throw new Error("C04 role/session migration text is outside its bound");
  if (
    source.includes("\r") ||
    source.startsWith("\uFEFF") ||
    !source.endsWith("\n") ||
    source.endsWith("\n\n")
  )
    throw new Error("C04 role/session migration must have strict framing");
  if (source !== canonicalC04RoleSessionMigration)
    throw new Error("C04 role/session migration differs from the exact statement set");
  return true;
}

export async function readC04RoleSessionMigrationAtPathForTest(candidate) {
  if (candidate !== migrationPath) throw new Error("C04 role/session migration path is not exact");
  return (await readExactFile(candidate, "C04 role/session migration")).bytes;
}

async function verifyInternal(testHook) {
  const listedBefore = (await readdir(migrationRoot)).sort();
  if (JSON.stringify(listedBefore) !== JSON.stringify(expectedMigrations))
    throw new Error("C04 role/session migration list or order differs");
  const accepted = [];
  for (const entry of acceptedMigrations) {
    const file = await readExactFile(
      entry.path,
      `C04 accepted ${path.basename(entry.path)} migration`,
    );
    if (digest(file.bytes) !== entry.sha256)
      throw new Error(`C04 accepted ${path.basename(entry.path)} hash differs`);
    accepted.push(Object.freeze({ ...entry, stat: file.stat }));
  }
  const migration = await readExactFile(migrationPath, "C04 role/session migration");
  validateC04RoleSessionTextForTest(
    new TextDecoder("utf-8", { fatal: true }).decode(migration.bytes),
  );
  await testHook?.();
  for (const entry of accepted)
    await assertUnchanged(
      entry.path,
      entry.stat,
      `C04 accepted ${path.basename(entry.path)} migration`,
    );
  await assertUnchanged(migrationPath, migration.stat, "C04 role/session migration");
  if (JSON.stringify((await readdir(migrationRoot)).sort()) !== JSON.stringify(listedBefore))
    throw new Error("C04 role/session migration list changed during verification");
  return Object.freeze({
    migration: expectedMigrations[2],
    roles: Object.freeze(["zc_continuity_reader", "zc_continuity_executor"]),
    tables: Object.freeze(["tenants", "payload_anchors", "events"]),
  });
}

export async function verifyC04RoleSession() {
  return verifyInternal();
}

export async function verifyC04RoleSessionForTest(testHook) {
  if (typeof testHook !== "function") throw new Error("C04 role/session hook must be a function");
  return verifyInternal(testHook);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyC04RoleSession()
    .then(({ migration, roles, tables }) =>
      process.stdout.write(
        `C04 role/session PASS: ${migration} (${roles.join(", ")}; ${tables.join(", ")})\n`,
      ),
    )
    .catch((error) => {
      process.stderr.write(`C04 role/session FAIL: ${error.message}\n`);
      process.exitCode = 1;
    });
}
