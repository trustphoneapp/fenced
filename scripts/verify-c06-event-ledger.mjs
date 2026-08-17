import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(repositoryRoot, "database", "migrations");
const migrationName = "0005_immutable_event_links.sql";
const migrationPath = path.join(migrationRoot, migrationName);
const migrationSha256 = "498ac73291c90d52000ca0c675854199b30f46dbb3f406b93c6bc16a12d747d5";
const migrationBytes = 5_656;
const expectedMigrations = Object.freeze([
  "0001_tenant_event_ledger.sql",
  "0002_purpose_qualified_tenant_keys.sql",
  "0003_role_session_isolation.sql",
  "0004_erasable_payload_storage.sql",
  migrationName,
  "0006_outbox_inbox.sql",
  "0007_agent_memory.sql",
  "0008_hackathon_live.sql",
  "0009_hackathon_quota_window.sql",
]);
const required = Object.freeze([
  "ADD CONSTRAINT events_target_candidate_key",
  "UNIQUE (tenant_id, server_purpose, event_id, event_revision, requested_purpose)",
  "CREATE TABLE continuity.event_revision_requests",
  "request_revision DECIMAL(20, 0) NOT NULL CHECK (request_revision BETWEEN 1 AND 18446744073709551615)",
  "target_event_revision DECIMAL(20, 0) NOT NULL CHECK (target_event_revision BETWEEN 1 AND 18446744073709551615)",
  "record_schema_version = 'zc.internal.event-revision-request.v1'",
  "record_family = 'event_revision_request'",
  "request_type IN ('correction.requested', 'retraction.requested')",
  "CHECK (requested_purpose = server_purpose)",
  "FOREIGN KEY (tenant_id, server_purpose, target_event_id, target_event_revision, requested_purpose)",
  "REFERENCES continuity.events (tenant_id, server_purpose, event_id, event_revision, requested_purpose)",
  "FOREIGN KEY (payload_tenant_id, payload_server_purpose, payload_ref, payload_revision, payload_requested_purpose)",
  "MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT",
  "PRIMARY KEY (tenant_id, server_purpose, request_id, request_revision)",
  "UNIQUE (tenant_id, server_purpose, operation_id, attempt_id)",
  "REVOKE ALL PRIVILEGES ON TABLE continuity.event_revision_requests FROM PUBLIC;",
  "GRANT SELECT ON TABLE continuity.event_revision_requests TO zc_continuity_reader;",
  "GRANT SELECT, INSERT ON TABLE continuity.event_revision_requests TO zc_continuity_executor;",
  "ALTER TABLE continuity.event_revision_requests FORCE ROW LEVEL SECURITY;",
  "CREATE POLICY event_revision_requests_reader_scope",
  "CREATE POLICY event_revision_requests_executor_select_scope",
  "CREATE POLICY event_revision_requests_executor_insert_scope",
]);

function failure(message) {
  throw new Error(`C06 event ledger failed: ${message}`);
}

function exactFileStat(stat) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    stat.size === 0n ||
    stat.size > 32n * 1024n ||
    (stat.mode & 0o777n) !== 0o644n
  )
    failure("migration is not a bounded singly-linked mode-0644 regular file");
}

export function validateC06EventLedgerTextForTest(source) {
  if (typeof source !== "string" || source.length === 0 || source.length > 32 * 1024)
    failure("migration text is outside its bound");
  if (
    source.includes("\r") ||
    source.startsWith("\uFEFF") ||
    !source.endsWith("\n") ||
    source.endsWith("\n\n")
  )
    failure("migration framing differs");
  if (!source.startsWith("BEGIN;\n\n") || !source.endsWith("COMMIT;\n"))
    failure("migration transaction differs");
  for (const statement of required)
    if (!source.includes(statement)) failure(`missing ${statement}`);
  if ((source.match(/CREATE TABLE continuity\.event_revision_requests/gmu) ?? []).length !== 1)
    failure("internal table inventory differs");
  if ((source.match(/CREATE POLICY event_revision_requests_/gmu) ?? []).length !== 3)
    failure("policy inventory differs");
  if (
    /\b(?:subject_ref|actor|reason|UPDATE\s+continuity\.event_revision_requests|DELETE\s+FROM\s+continuity\.event_revision_requests|GRANT\s+(?:UPDATE|DELETE|ALL)|FOR\s+(?:UPDATE|DELETE|ALL)|ON\s+DELETE\s+CASCADE|ON\s+DELETE\s+SET\s+NULL)\b/iu.test(
      source,
    )
  )
    failure("forbidden mutable or content-bearing behavior");
  const eventAlterations = source.match(/ALTER TABLE continuity\.events[\s\S]*?;/gu) ?? [];
  if (
    eventAlterations.length !== 1 ||
    !/^ALTER TABLE continuity\.events\n {2}ADD CONSTRAINT events_target_candidate_key\n {2}UNIQUE \(tenant_id, server_purpose, event_id, event_revision, requested_purpose\);$/u.test(
      eventAlterations[0],
    )
  )
    failure("public events mutation differs");
  return true;
}

export function validateC06EventLedgerBytesForTest(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== migrationBytes)
    failure("migration byte length differs");
  if (createHash("sha256").update(bytes).digest("hex") !== migrationSha256)
    failure("migration byte hash differs");
  return true;
}

export async function verifyC06EventLedger() {
  if (JSON.stringify((await readdir(migrationRoot)).sort()) !== JSON.stringify(expectedMigrations))
    failure("migration list or order differs");
  if ((await realpath(migrationPath)) !== migrationPath) failure("migration path is not canonical");
  const listed = await lstat(migrationPath, { bigint: true });
  exactFileStat(listed);
  const handle = await open(migrationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    exactFileStat(before);
    if (before.ino !== listed.ino || before.mtimeNs !== listed.mtimeNs)
      failure("migration changed");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.ino !== before.ino || after.mtimeNs !== before.mtimeNs || after.size !== before.size)
      failure("migration changed during read");
    validateC06EventLedgerBytesForTest(bytes);
    validateC06EventLedgerTextForTest(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await handle.close();
  }
  return Object.freeze({ migration: migrationName, table: "event_revision_requests" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyC06EventLedger()
    .then(({ migration, table }) =>
      process.stdout.write(`C06 event ledger PASS: ${migration} (${table})\n`),
    )
    .catch((error) => {
      process.stderr.write(`C06 event ledger FAIL: ${error.message}\n`);
      process.exitCode = 1;
    });
}
