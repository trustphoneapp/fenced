#!/usr/bin/env node
// biome-ignore-all format: keep the bounded E2 verifier below its reviewed LOC ceiling.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const hackathonLiveMigrationSha256 =
  "31507420bda0efc37ec8cbe5d9ff9ef9dd707878b3555102c0510af966d5bd32";
export const hackathonQuotaWindowMigrationSha256 =
  "41b126b4ea0ccd5d42a9e6146f12885ac63edd5062bf27908de82046bba11d79";
const predecessors = Object.freeze({
  "0001_tenant_event_ledger.sql":
    "9179c8575d6b9cb2a6ef82db2e73409a96b0de5b8bcf3d213ec12768e7d325f2",
  "0002_purpose_qualified_tenant_keys.sql":
    "8dcc5604ce1dbb6316f9aa3c4f1422e009ffcc1b75d4961df4f7d3ee1babf9af",
  "0003_role_session_isolation.sql":
    "39ee63b2f49294a4dd9e8fad0e437ab7cbba8e0e06bb9634842c80f65abf6359",
  "0004_erasable_payload_storage.sql":
    "a99700c2d59500c4fe97a8d67b7a1333e935f89a7aa6bf5bbfc43783179dc279",
  "0005_immutable_event_links.sql":
    "498ac73291c90d52000ca0c675854199b30f46dbb3f406b93c6bc16a12d747d5",
  "0006_outbox_inbox.sql": "69f040bfe5762503ab3fad31f358c52d169da1e4ca2a4ccabe93c7f2df75315d",
  "0007_agent_memory.sql": "898fd739696fb644aa8de9bc3636c1e63367587b679819a6998e4189bbbbed7a",
});

const required = [
  "UPDATE continuity.memory_facts\nSET embedding = array_fill(0::float8, ARRAY[1024])::vector\nWHERE fact_status = 'retracted';",
  "CREATE UNIQUE INDEX memory_facts_one_active_revision",
  "CREATE VECTOR INDEX memory_facts_titan_scope_l2",
  "tenant_id, server_purpose, embedding_space, fact_status, sensitivity",
  "CREATE TABLE continuity.hackathon_session_tokens",
  "CREATE TABLE continuity.hackathon_runtime_control",
  "CREATE TABLE continuity.hackathon_quota_lock",
  "provider_enabled BOOL NOT NULL DEFAULT false",
  "public_session_cap INT8 NOT NULL CHECK (public_session_cap = 100)",
  "absolute_titan_cap INT8 NOT NULL CHECK (absolute_titan_cap = 800)",
  "CREATE TABLE continuity.hackathon_session_usage",
  "CREATE TABLE continuity.hackathon_provider_usage",
  "CREATE TABLE continuity.hackathon_provider_reservations",
  "reservation_state STRING NOT NULL CHECK (reservation_state = 'reserved')",
  "CREATE TABLE continuity.hackathon_answer_receipts",
  "CREATE TABLE continuity.hackathon_receipt_withheld",
  "CREATE TABLE continuity.hackathon_response_payloads",
  "CREATE TABLE continuity.hackathon_effect_results",
  "total_tokens INT8 NOT NULL CHECK (total_tokens = input_tokens + output_tokens)",
  "CREATE VIEW continuity.hackathon_usage_summary_v1",
  "request_digest_version STRING NOT NULL CHECK (request_digest_version = 'zc.request-digest.v1')",
  "provider_outcome STRING NOT NULL CHECK (provider_outcome = 'succeeded')",
  "CREATE VIEW continuity.task_status_summary_v1",
  "CREATE VIEW continuity.receipt_summary_v1",
  "CREATE VIEW continuity.evidence_lineage_summary_v1",
  "ALTER TABLE continuity.hackathon_session_tokens FORCE ROW LEVEL SECURITY;",
  "ALTER TABLE continuity.hackathon_receipt_withheld FORCE ROW LEVEL SECURITY;",
  "CREATE POLICY hackathon_receipt_withheld_executor_insert_scope",
  "reason = 'sensitivity_policy'",
  "GRANT SELECT ON continuity.receipt_summary_v1 TO zc_continuity_mcp_reader;",
  "GRANT zc_continuity_reservation_writer TO continuity_app;",
  "CREATE POLICY hackathon_provider_usage_public_insert_scope",
  "FROM continuity.hackathon_receipt_revisions;",
];
const providerAggregates = [
  "coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8\n    AS public_titan",
  "coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8\n    AS public_nova",
  "coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8\n    AS engineering_titan",
  "coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8\n    AS engineering_nova",
];
const quotaWindowRequired = [
  "CREATE OR REPLACE VIEW continuity.hackathon_usage_summary_v1 AS SELECT",
  "count(session.tenant_id) FILTER (\n    WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'\n  )::INT8 AS public_sessions",
  "FROM continuity.hackathon_session_usage AS session\nFULL OUTER JOIN continuity.hackathon_provider_usage AS usage ON false;",
  "ALTER VIEW continuity.hackathon_usage_summary_v1 OWNER TO zc_continuity_quota_view_owner;",
  "REVOKE ALL PRIVILEGES ON continuity.hackathon_usage_summary_v1 FROM PUBLIC;",
  "GRANT SELECT ON continuity.hackathon_usage_summary_v1\n  TO zc_continuity_session_issuer, zc_continuity_reservation_writer;",
];

export function verifyHackathonLiveSql(sql) {
  if (createHash("sha256").update(sql).digest("hex") !== hackathonLiveMigrationSha256)
    throw new Error("0008 differs from the reviewed exact bytes");
  if (!sql.startsWith("BEGIN;\n") || !sql.endsWith("\nCOMMIT;\n"))
    throw new Error("0008 framing differs");
  for (const clause of required)
    if (!sql.includes(clause)) throw new Error("0008 required contract missing");
  if (
    /\b(?:IF NOT EXISTS|ON CONFLICT|CREATE USER|PASSWORD)\b/iu.test(sql) ||
    /^\s*(?:DROP|DELETE|TRUNCATE)\b/imu.test(sql)
  )
    throw new Error("0008 contains forbidden SQL");
  if (
    /\b(?:SECURITY DEFINER|EXECUTE IMMEDIATE|WITH BYPASSRLS)\b/iu.test(sql) ||
    /GRANT\s+(?:ALL|DELETE|TRUNCATE|ALTER)[^;]*TO\s+(?:PUBLIC|continuity_app|zc_continuity_)/iu.test(
      sql,
    )
  )
    throw new Error("0008 authority contract weakened");
  if (
    /GRANT[^;]*(?:memory_facts|hackathon_session_tokens|hackathon_runtime_control)[^;]*TO zc_continuity_mcp_reader/iu.test(
      sql,
    )
  )
    throw new Error("MCP reader can reach restricted base data");
}

export function verifyHackathonQuotaWindowSql(sql, predecessorSql) {
  if (createHash("sha256").update(sql).digest("hex") !== hackathonQuotaWindowMigrationSha256)
    throw new Error("0009 differs from the reviewed exact bytes");
  if (!sql.startsWith("BEGIN;\n") || !sql.endsWith("\nCOMMIT;\n"))
    throw new Error("0009 framing differs");
  for (const clause of [...quotaWindowRequired, ...providerAggregates])
    if (!sql.includes(clause)) throw new Error("0009 required contract missing");
  for (const clause of providerAggregates)
    if (!predecessorSql.includes(clause)) throw new Error("0009 provider totals differ from 0008");
  if (
    (sql.match(/INTERVAL '24 hours'/gu) ?? []).length !== 1 ||
    /^\s*(?:DROP|DELETE|TRUNCATE|INSERT|UPDATE)\b/imu.test(sql) ||
    /\b(?:CREATE ROLE|CREATE USER|PASSWORD|SECURITY DEFINER|BYPASSRLS)\b/iu.test(sql)
  )
    throw new Error("0009 quota or authority contract weakened");
}

export async function verifyHackathonLiveSchema() {
  for (const [name, hash] of Object.entries(predecessors)) {
    const bytes = await readFile(path.join(root, "database/migrations", name));
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw new Error("predecessor migration changed");
  }
  const sql = await readFile(
    path.join(root, "database/migrations/0008_hackathon_live.sql"),
    "utf8",
  );
  verifyHackathonLiveSql(sql);
  const quotaWindowSql = await readFile(
    path.join(root, "database/migrations/0009_hackathon_quota_window.sql"),
    "utf8",
  );
  verifyHackathonQuotaWindowSql(quotaWindowSql, sql);
  return Object.freeze({ migration: "0009_hackathon_quota_window.sql", predecessors: 8 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyHackathonLiveSchema().then(
    () => process.stdout.write("hackathon live schema: PASS (static only; E4 runtime unproven)\n"),
    () => {
      process.stderr.write("hackathon live schema: FAIL\n");
      process.exitCode = 1;
    },
  );
}
