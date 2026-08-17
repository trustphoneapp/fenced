#!/usr/bin/env node
/** Apply only the pinned rolling-session quota repair after exact post-0008 inspection. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createMigrationClient, validateMigrationDatabaseUrl } from "./h2-crdb-apply-0008.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pins = Object.freeze([
  Object.freeze({
    bytes: 34_968,
    mode: 0o644,
    name: "0008_hackathon_live.sql",
    sha256: "31507420bda0efc37ec8cbe5d9ff9ef9dd707878b3555102c0510af966d5bd32",
  }),
  Object.freeze({
    bytes: 1_075,
    mode: 0o644,
    name: "0009_hackathon_quota_window.sql",
    sha256: "41b126b4ea0ccd5d42a9e6146f12885ac63edd5062bf27908de82046bba11d79",
  }),
]);
const expectedColumns = Object.freeze([
  ["hackathon_provider_usage", "tenant_id"],
  ["hackathon_provider_usage", "server_purpose"],
  ["hackathon_provider_usage", "operation_id"],
  ["hackathon_provider_usage", "attempt_id"],
  ["hackathon_provider_usage", "audience"],
  ["hackathon_provider_usage", "titan_count"],
  ["hackathon_provider_usage", "nova_count"],
  ["hackathon_provider_usage", "created_at"],
  ["hackathon_session_usage", "tenant_id"],
  ["hackathon_session_usage", "server_purpose"],
  ["hackathon_session_usage", "audience"],
  ["hackathon_session_usage", "created_at"],
]);
const expectedViewColumns = Object.freeze([
  "public_sessions",
  "public_titan",
  "public_nova",
  "engineering_titan",
  "engineering_nova",
]);
const expectedGrants = Object.freeze([
  ["zc_continuity_reservation_writer", "SELECT", "NO"],
  ["zc_continuity_session_issuer", "SELECT", "NO"],
]);
const providerColumns = `coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8 AS public_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8 AS public_nova,
  coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8 AS engineering_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8 AS engineering_nova`;
const viewTail = `FROM continuity.hackathon_session_usage AS session
FULL OUTER JOIN continuity.hackathon_provider_usage AS usage ON false`;
const readyViewDefinition = `SELECT count(session.tenant_id)::INT8 AS public_sessions,
  ${providerColumns}
${viewTail}`;
const appliedViewDefinition = `SELECT count(session.tenant_id) FILTER (
  WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
)::INT8 AS public_sessions,
  ${providerColumns}
${viewTail}`;
const canonicalAppliedViewDefinition = appliedViewDefinition.replace(
  "CURRENT_TIMESTAMP - INTERVAL '24 hours'",
  "(current_timestamp() - '24:00:00':::INTERVAL)",
);
export class Migration0009Error extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new Migration0009Error(code);
};
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const compactSql = (value) =>
  String(value)
    .split(/('(?:''|[^'])*')/gu)
    .map((part, index) =>
      index % 2
        ? part === "'24:00:00'"
          ? "'24 hours'"
          : part
        : part
            .replaceAll('"', "")
            .replace(/:{2,3}(?:bool|int8|interval|string|timestamptz)\b/giu, "")
            .replace(/current_timestamp\(\)/giu, "current_timestamp")
            .replaceAll("defaultdb.", "")
            .replace(/\bfull join\b/giu, "full outer join")
            .replace(/\(\s+/gu, "(")
            .replace(/\s+\)/gu, ")"),
    )
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

export function classifyQuotaViewDefinition(value) {
  const sql = compactSql(value);
  if (sql === compactSql(readyViewDefinition)) return "ready";
  if ([appliedViewDefinition, canonicalAppliedViewDefinition].map(compactSql).includes(sql))
    return "applied";
  deny("VIEW_DEFINITION_REJECTED");
}

async function pinned(pin) {
  const filename = path.join(root, "database/migrations", pin.name);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [opened, pathname, canonical, bytes] = await Promise.all([
      handle.stat(),
      lstat(filename),
      realpath(filename),
      handle.readFile(),
    ]);
    if (
      !opened.isFile() ||
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      opened.dev !== pathname.dev ||
      opened.ino !== pathname.ino ||
      opened.nlink !== 1 ||
      canonical !== filename ||
      (opened.mode & 0o777) !== pin.mode ||
      opened.size !== pin.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== pin.sha256
    )
      deny("MIGRATION_ARTIFACT_REJECTED");
    return bytes;
  } catch (error) {
    if (error instanceof Migration0009Error) throw error;
    deny("MIGRATION_ARTIFACT_REJECTED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function artifacts() {
  const [predecessor, migration] = await Promise.all(pins.map(pinned));
  const source = new TextDecoder("utf-8", { fatal: true }).decode(migration);
  const match = /^BEGIN;\n\n([\s\S]+)\nCOMMIT;\n$/u.exec(source);
  if (!match?.[1]) deny("MIGRATION_ARTIFACT_REJECTED");
  return Object.freeze({ body: match[1], migration, predecessor });
}

const rowsOf = (result, fields) => result.rows.map((row) => fields.map((field) => row[field]));
const metric = (value) => {
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) deny("CONTENT_STATE_REJECTED");
  return text;
};

async function inspect(client) {
  const [identity, definition, owner, grants, columns, viewColumns, totals] = await Promise.all([
    client.query(`SELECT current_database() AS database_name, current_user AS sql_user,
      pg_has_role(current_user, 'admin', 'member') AS sql_user_is_admin`),
    client.query(`SELECT view_definition FROM information_schema.views
      WHERE table_schema = 'continuity' AND table_name = 'hackathon_usage_summary_v1'`),
    client.query(`SELECT owner.rolname AS owner_name FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles AS owner ON owner.oid = relation.relowner
      WHERE namespace.nspname = 'continuity'
        AND relation.relname = 'hackathon_usage_summary_v1'`),
    client.query(`SELECT grantee, privilege_type, is_grantable
      FROM information_schema.table_privileges
      WHERE table_schema = 'continuity' AND table_name = 'hackathon_usage_summary_v1'
        AND grantee NOT IN ('zc_continuity_quota_view_owner', 'admin', 'root')
      ORDER BY grantee, privilege_type`),
    client.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'continuity'
        AND table_name IN ('hackathon_provider_usage', 'hackathon_session_usage')
      ORDER BY table_name, ordinal_position`),
    client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'continuity' AND table_name = 'hackathon_usage_summary_v1'
      ORDER BY ordinal_position`),
    client.query(`SELECT
      (SELECT count(*)::INT8 FROM continuity.hackathon_session_usage) AS session_rows,
      (SELECT count(*)::INT8 FROM continuity.hackathon_provider_usage) AS provider_rows,
      coalesce(sum(titan_count) FILTER (WHERE audience = 'public'), 0)::INT8 AS public_titan,
      coalesce(sum(nova_count) FILTER (WHERE audience = 'public'), 0)::INT8 AS public_nova,
      coalesce(sum(titan_count) FILTER (WHERE audience = 'engineering'), 0)::INT8 AS engineering_titan,
      coalesce(sum(nova_count) FILTER (WHERE audience = 'engineering'), 0)::INT8 AS engineering_nova
      FROM continuity.hackathon_provider_usage`),
  ]);
  const id = identity.rows[0];
  if (
    identity.rows.length !== 1 ||
    id?.database_name !== "defaultdb" ||
    id?.sql_user !== "continuity_migrator" ||
    id?.sql_user_is_admin !== true
  )
    deny("MIGRATION_IDENTITY_REJECTED");
  if (
    definition.rows.length !== 1 ||
    owner.rows.length !== 1 ||
    owner.rows[0]?.owner_name !== "zc_continuity_quota_view_owner" ||
    !exact(rowsOf(grants, ["grantee", "privilege_type", "is_grantable"]), expectedGrants) ||
    !exact(rowsOf(columns, ["table_name", "column_name"]), expectedColumns) ||
    !exact(
      viewColumns.rows.map((row) => row.column_name),
      expectedViewColumns,
    )
  )
    deny("SCHEMA_STATE_REJECTED");
  const row = totals.rows[0];
  if (totals.rows.length !== 1 || !row) deny("CONTENT_STATE_REJECTED");
  return Object.freeze({
    metrics: Object.freeze({
      engineeringNova: metric(row.engineering_nova),
      engineeringTitan: metric(row.engineering_titan),
      providerRows: metric(row.provider_rows),
      publicNova: metric(row.public_nova),
      publicTitan: metric(row.public_titan),
      sessionRows: metric(row.session_rows),
    }),
    state: classifyQuotaViewDefinition(definition.rows[0]?.view_definition),
  });
}

export async function runMigration0009({ command, createClient, environment = process.env } = {}) {
  if (!["--status", "--preflight", "--apply"].includes(command)) deny("USAGE_REJECTED");
  let connectionString;
  try {
    connectionString = validateMigrationDatabaseUrl(environment);
  } catch {
    deny("DATABASE_URL_REJECTED");
  }
  const artifact = await artifacts();
  const client = createClient({ connectionString, connectionTimeoutMillis: 15_000 });
  let transaction = false;
  let applyStarted = false;
  try {
    await client.connect();
    if (command === "--apply") {
      const before = await inspect(client);
      if (before.state !== "ready") deny("MIGRATION_ALREADY_APPLIED");
      const confirmed = await artifacts();
      if (
        !confirmed.predecessor.equals(artifact.predecessor) ||
        !confirmed.migration.equals(artifact.migration)
      )
        deny("MIGRATION_ARTIFACT_REJECTED");
      applyStarted = true;
      await client.query(artifact.body);
      const after = await inspect(client);
      if (after.state !== "applied" || !exact(after.metrics, before.metrics))
        deny("MIGRATION_POSTSTATE_REJECTED");
      return Object.freeze({
        bytes: pins[1].bytes,
        database: "defaultdb",
        migration: pins[1].name,
        predecessorSha256: pins[0].sha256,
        sha256: pins[1].sha256,
        state: "applied",
      });
    }
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET TRANSACTION READ ONLY");
    const before = await inspect(client);
    if (command === "--preflight" && before.state !== "ready") deny("MIGRATION_ALREADY_APPLIED");
    await client.query("COMMIT");
    transaction = false;
    return Object.freeze({
      bytes: pins[1].bytes,
      database: "defaultdb",
      migration: pins[1].name,
      predecessorSha256: pins[0].sha256,
      sha256: pins[1].sha256,
      state: before.state,
    });
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    if (command === "--apply" && applyStarted) deny("MIGRATION_APPLY_UNCERTAIN");
    if (error instanceof Migration0009Error) throw error;
    deny(command === "--apply" ? "MIGRATION_APPLY_DENIED" : "MIGRATION_INSPECTION_DENIED");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const migration0009TestContract = Object.freeze({
  expectedColumns,
  expectedGrants,
  expectedViewColumns,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration0009({ command: process.argv[2], createClient: createMigrationClient })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof Migration0009Error ? error.code : "MIGRATION_0009_DENIED";
      process.stderr.write(`crdb-0009: FAIL: ${code}\n`);
      process.exitCode = 1;
    });
}
