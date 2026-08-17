#!/usr/bin/env node
/** Apply only the pinned synthetic E4 migration after an exact post-0007 attestation. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "database/migrations/0008_hackathon_live.sql");
const migrationPin = Object.freeze({
  bytes: 34_968,
  mode: 0o644,
  name: "0008_hackathon_live.sql",
  sha256: "31507420bda0efc37ec8cbe5d9ff9ef9dd707878b3555102c0510af966d5bd32",
});

const preTables = Object.freeze([
  "disclosure_receipts",
  "event_revision_requests",
  "events",
  "inbox_receipts",
  "memory_facts",
  "memory_propagations",
  "outbox_deliveries",
  "outbox_messages",
  "payload_anchors",
  "payload_key_anchors",
  "payload_revision_material",
  "payload_superseded_wrapped_keys",
  "payload_wrapped_keys",
  "tenants",
]);
const addedTables = Object.freeze([
  "hackathon_answer_receipts",
  "hackathon_effect_results",
  "hackathon_provider_reservations",
  "hackathon_provider_usage",
  "hackathon_quota_lock",
  "hackathon_receipt_revisions",
  "hackathon_receipt_withheld",
  "hackathon_response_payloads",
  "hackathon_runtime_control",
  "hackathon_session_tokens",
  "hackathon_session_usage",
  "hackathon_sessions",
]);
const postTables = Object.freeze([...preTables, ...addedTables].sort());
const preRoles = Object.freeze([
  ["continuity_app", true, false, false],
  ["zc_continuity_executor", false, false, false],
  ["zc_continuity_reader", false, false, false],
  ["zc_continuity_transition_owner", false, false, false],
]);
const addedRoles = Object.freeze([
  ["zc_continuity_mcp_reader", false, false, false],
  ["zc_continuity_mcp_view_owner", false, false, false],
  ["zc_continuity_quota_view_owner", false, false, false],
  ["zc_continuity_reservation_writer", false, false, false],
  ["zc_continuity_session_issuer", false, false, false],
]);
const postRoles = Object.freeze(
  [...preRoles, ...addedRoles].sort(([a], [b]) => a.localeCompare(b)),
);
const partialRoles = Object.freeze(
  [...preRoles, ...addedRoles.filter(([role]) => role !== "zc_continuity_mcp_reader")].sort(
    ([a], [b]) => a.localeCompare(b),
  ),
);
const partialTables = Object.freeze(
  [
    ...preTables,
    "hackathon_provider_usage",
    "hackathon_quota_lock",
    "hackathon_runtime_control",
    "hackathon_session_tokens",
    "hackathon_session_usage",
    "hackathon_sessions",
  ].sort(),
);
const prePolicies = Object.freeze(
  [
    "disclosure_receipts_executor_insert_scope",
    "disclosure_receipts_executor_select_scope",
    "disclosure_receipts_reader_scope",
    "event_revision_requests_executor_insert_scope",
    "event_revision_requests_executor_select_scope",
    "event_revision_requests_reader_scope",
    "events_reader_scope",
    "inbox_receipts_executor_select_scope",
    "inbox_receipts_reader_scope",
    "inbox_receipts_transition_owner_scope",
    "memory_facts_executor_select_scope",
    "memory_facts_executor_write_scope",
    "memory_propagations_executor_insert_scope",
    "memory_propagations_executor_select_scope",
    "memory_propagations_reader_scope",
    "outbox_deliveries_executor_select_scope",
    "outbox_deliveries_reader_scope",
    "outbox_deliveries_transition_owner_scope",
    "outbox_messages_executor_insert_scope",
    "outbox_messages_executor_select_scope",
    "outbox_messages_reader_scope",
    "payload_anchors_reader_scope",
    "tenants_reader_scope",
  ].sort(),
);
const addedPolicies = Object.freeze(
  [
    "hackathon_answer_receipts_executor_insert_scope",
    "hackathon_answer_receipts_executor_select_scope",
    "hackathon_answer_receipts_mcp_scope",
    "hackathon_effect_results_executor_insert_scope",
    "hackathon_effect_results_executor_select_scope",
    "hackathon_provider_usage_public_insert_scope",
    "hackathon_provider_usage_quota_scope",
    "hackathon_receipt_revisions_executor_insert_scope",
    "hackathon_receipt_revisions_executor_select_scope",
    "hackathon_receipt_revisions_mcp_scope",
    "hackathon_receipt_withheld_executor_insert_scope",
    "hackathon_receipt_withheld_executor_select_scope",
    "hackathon_reservations_executor_select_scope",
    "hackathon_reservations_issuer_insert_scope",
    "hackathon_reservations_issuer_select_scope",
    "hackathon_reservations_mcp_scope",
    "hackathon_reservations_writer_insert_scope",
    "hackathon_reservations_writer_select_scope",
    "hackathon_response_payloads_executor_insert_scope",
    "hackathon_response_payloads_executor_select_scope",
    "hackathon_session_tokens_executor_select_scope",
    "hackathon_session_tokens_issuer_insert_scope",
    "hackathon_session_tokens_issuer_select_scope",
    "hackathon_session_tokens_reservation_select_scope",
    "hackathon_session_usage_public_insert_scope",
    "hackathon_session_usage_quota_scope",
    "hackathon_sessions_executor_select_scope",
    "hackathon_sessions_issuer_insert_scope",
    "hackathon_sessions_issuer_select_scope",
    "hackathon_sessions_mcp_scope",
    "hackathon_sessions_reservation_select_scope",
    "tenants_session_issuer_insert_scope",
  ].sort(),
);
const preViews = Object.freeze([]);
const postViews = Object.freeze([
  "evidence_lineage_summary_v1",
  "hackathon_usage_summary_v1",
  "receipt_summary_v1",
  "task_status_summary_v1",
]);
const routines = Object.freeze([]);
const preIndexes = Object.freeze([
  "memory_facts_embedding_cosine",
  "memory_facts_pkey",
  "memory_facts_tenant_id_server_purpose_fact_id_fact_revision_fact_status_key",
]);
const postIndexes = Object.freeze(
  [...preIndexes, "memory_facts_one_active_revision", "memory_facts_titan_scope_l2"].sort(),
);
const preColumns = Object.freeze([
  "tenant_id",
  "server_purpose",
  "fact_id",
  "fact_revision",
  "record_schema_version",
  "record_family",
  "requested_purpose",
  "sensitivity",
  "fact_status",
  "content",
  "embedding",
  "embedding_space",
  "source_ref",
  "occurred_at",
]);
const postColumns = Object.freeze([...preColumns, "deletion_fence"]);
const preMemberships = Object.freeze([
  ["zc_continuity_executor", "continuity_app"],
  ["zc_continuity_transition_owner", "admin"],
]);
const postMemberships = Object.freeze(
  [
    ["zc_continuity_reservation_writer", "continuity_app"],
    ["zc_continuity_session_issuer", "continuity_app"],
    ...preMemberships,
  ].sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d)),
);
const preCounts = Object.freeze({
  disclosure_receipts: 2,
  event_revision_requests: 0,
  events: 0,
  inbox_receipts: 0,
  memory_facts: 8,
  memory_propagations: 2,
  outbox_deliveries: 0,
  outbox_messages: 0,
  payload_anchors: 0,
  payload_key_anchors: 0,
  payload_revision_material: 0,
  payload_superseded_wrapped_keys: 0,
  payload_wrapped_keys: 0,
  tenants: 6,
});
const addedCounts = Object.freeze(
  Object.fromEntries(
    addedTables.map((name) => [
      name,
      ["hackathon_quota_lock", "hackathon_runtime_control"].includes(name) ? 1 : 0,
    ]),
  ),
);
const postCounts = Object.freeze({ ...preCounts, ...addedCounts });
const partialCounts = Object.freeze(
  Object.fromEntries(partialTables.map((name) => [name, postCounts[name]])),
);

export class Migration0008Error extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new Migration0008Error(code);
};
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

export function validateMigrationDatabaseUrl(environment = process.env) {
  const raw = environment.COCKROACH_MIGRATION_DATABASE_URL ?? "";
  if (typeof raw !== "string") deny("DATABASE_URL_REJECTED");
  let url;
  try {
    url = new URL(raw);
  } catch {
    deny("DATABASE_URL_REJECTED");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".cockroachlabs.cloud") ||
    url.username !== "continuity_migrator" ||
    !url.password ||
    url.port !== "26257" ||
    url.pathname !== "/defaultdb" ||
    url.search !== "?sslmode=verify-full" ||
    url.hash !== "" ||
    raw !== raw.trim()
  )
    deny("DATABASE_URL_REJECTED");
  return raw;
}

async function pinnedMigration() {
  let handle;
  try {
    handle = await open(migrationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [opened, pathname, canonical, bytes] = await Promise.all([
      handle.stat(),
      lstat(migrationPath),
      realpath(migrationPath),
      handle.readFile(),
    ]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      !opened.isFile() ||
      !pathname.isFile() ||
      pathname.isSymbolicLink() ||
      opened.dev !== pathname.dev ||
      opened.ino !== pathname.ino ||
      opened.nlink !== 1 ||
      canonical !== migrationPath ||
      (opened.mode & 0o777) !== migrationPin.mode ||
      opened.size !== migrationPin.bytes ||
      sha256 !== migrationPin.sha256
    )
      deny("MIGRATION_ARTIFACT_REJECTED");
    return Object.freeze({ bytes, sha256 });
  } catch (error) {
    if (error instanceof Migration0008Error) throw error;
    deny("MIGRATION_ARTIFACT_REJECTED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function migrationBody(bytes) {
  const source = bytes.toString("utf8");
  let countReplacements = 0;
  let roleReplacements = 0;
  let vectorReplacements = 0;
  const cloudRoles = source.replace(
    /CREATE ROLE (zc_continuity_(?:session_issuer|reservation_writer|quota_view_owner|mcp_view_owner|mcp_reader))\n {2}NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;/gu,
    (_match, role) => {
      roleReplacements += 1;
      return `CREATE ROLE ${role} WITH NOBYPASSRLS;`;
    },
  );
  const cloudVector = cloudRoles.replace("array_fill(0::float8, ARRAY[1024])::vector", () => {
    vectorReplacements += 1;
    return `'[${Array.from({ length: 1_024 }, () => "0").join(",")}]'::vector`;
  });
  const cloudSql = cloudVector.replace(
    /(titan_count|nova_count) DECIMAL\(20, 0\)( NOT NULL CHECK \(\1 BETWEEN 0 AND [13]\),)/gu,
    (_match, name, suffix) => {
      countReplacements += 1;
      return `${name} INT8${suffix}`;
    },
  );
  const match = /^BEGIN;\n([\s\S]*)\nCOMMIT;\n$/u.exec(cloudSql);
  if (countReplacements !== 2 || roleReplacements !== 5 || vectorReplacements !== 1 || !match?.[1])
    deny("MIGRATION_ARTIFACT_REJECTED");
  return match[1];
}

function migrationStatements(bytes) {
  const statements = migrationBody(bytes)
    .split(";\n")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
  if (statements.length !== 145) deny("MIGRATION_ARTIFACT_REJECTED");
  return Object.freeze(statements);
}

const rowsOf = (result, fields) => result.rows.map((row) => fields.map((field) => row[field]));

async function inspect(client) {
  const [
    identity,
    tables,
    roles,
    policies,
    views,
    routineRows,
    columns,
    indexes,
    constraints,
    memberships,
  ] = await Promise.all([
    client.query(`SELECT current_database() AS database_name, current_user AS sql_user,
        pg_has_role(current_user, 'admin', 'member') AS sql_user_is_admin`),
    client.query(`SELECT CASE WHEN table_schema = 'continuity' THEN table_name
          ELSE table_schema || '.' || table_name END AS table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE' AND table_schema NOT IN
          ('information_schema', 'pg_catalog', 'crdb_internal', 'pg_extension')
        ORDER BY table_schema, table_name`),
    client.query(`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname = 'continuity_app' OR rolname LIKE 'zc_continuity_%' ORDER BY rolname`),
    client.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'continuity'
        ORDER BY policyname`),
    client.query(`SELECT table_name FROM information_schema.views WHERE table_schema = 'continuity'
        ORDER BY table_name`),
    client.query(`SELECT DISTINCT routine_name FROM information_schema.routines
        WHERE routine_schema = 'continuity' ORDER BY routine_name`),
    client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'continuity' AND table_name = 'memory_facts'
        ORDER BY ordinal_position`),
    client.query("SHOW INDEXES FROM continuity.memory_facts"),
    client.query(`SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = 'continuity' AND table_name = 'memory_propagations'
          AND constraint_name = 'memory_propagations_effect_result_key'`),
    client.query(`SELECT parent.rolname AS role_name, member.rolname AS member_name
        FROM pg_auth_members AS grant_row
        JOIN pg_roles AS parent ON parent.oid = grant_row.roleid
        JOIN pg_roles AS member ON member.oid = grant_row.member
        WHERE parent.rolname LIKE 'zc_continuity_%' OR member.rolname = 'continuity_app'
        ORDER BY parent.rolname, member.rolname`),
  ]);
  const row = identity.rows[0];
  if (!row || row.database_name !== "defaultdb") deny("TARGET_DATABASE_REJECTED");
  if (row.sql_user !== "continuity_migrator" || row.sql_user_is_admin !== true)
    deny("MIGRATION_IDENTITY_REJECTED");
  const shape = {
    columns: columns.rows.map((entry) => String(entry.column_name)),
    constraints: constraints.rows.map((entry) => String(entry.constraint_name)),
    indexes: [...new Set(indexes.rows.map((entry) => String(entry.index_name)))].sort(),
    memberships: rowsOf(memberships, ["role_name", "member_name"]),
    policies: policies.rows.map((entry) => String(entry.policyname)),
    roles: rowsOf(roles, ["rolname", "rolcanlogin", "rolsuper", "rolbypassrls"]),
    routines: routineRows.rows.map((entry) => String(entry.routine_name)),
    tables: tables.rows.map((entry) => String(entry.table_name)),
    views: views.rows.map((entry) => String(entry.table_name)),
  };
  const common = exact(shape.routines, routines);
  const predecessorPolicies = shape.policies.filter((name) => !addedPolicies.includes(name));
  const policiesAreBounded =
    new Set(predecessorPolicies).size === predecessorPolicies.length &&
    predecessorPolicies.every((name) => /^[a-z][a-z0-9_]{0,95}$/u.test(name));
  const ready =
    common &&
    exact(shape.tables, preTables) &&
    exact(shape.roles, preRoles) &&
    shape.policies.length === 24 &&
    policiesAreBounded &&
    predecessorPolicies.length === 24 &&
    prePolicies.every((name) => predecessorPolicies.includes(name)) &&
    exact(shape.views, preViews) &&
    exact(shape.columns, preColumns) &&
    exact(shape.memberships, preMemberships) &&
    exact(shape.indexes, preIndexes) &&
    shape.constraints.length === 0;
  const partial9 =
    common &&
    exact(shape.tables, preTables) &&
    exact(shape.roles, partialRoles) &&
    shape.policies.length === 24 &&
    policiesAreBounded &&
    predecessorPolicies.length === 24 &&
    prePolicies.every((name) => predecessorPolicies.includes(name)) &&
    exact(shape.views, preViews) &&
    exact(shape.columns, postColumns) &&
    exact(shape.memberships, preMemberships) &&
    exact(shape.indexes, postIndexes) &&
    exact(shape.constraints, ["memory_propagations_effect_result_key"]);
  const partial21 =
    common &&
    exact(shape.tables, partialTables) &&
    exact(shape.roles, postRoles) &&
    shape.policies.length === 24 &&
    policiesAreBounded &&
    predecessorPolicies.length === 24 &&
    prePolicies.every((name) => predecessorPolicies.includes(name)) &&
    exact(shape.views, preViews) &&
    exact(shape.columns, postColumns) &&
    exact(shape.memberships, postMemberships) &&
    exact(shape.indexes, postIndexes) &&
    exact(shape.constraints, ["memory_propagations_effect_result_key"]);
  const partial27 =
    common &&
    exact(shape.tables, postTables) &&
    exact(shape.roles, postRoles) &&
    shape.policies.length === 24 &&
    policiesAreBounded &&
    predecessorPolicies.length === 24 &&
    prePolicies.every((name) => predecessorPolicies.includes(name)) &&
    exact(shape.views, preViews) &&
    exact(shape.columns, postColumns) &&
    exact(shape.memberships, postMemberships) &&
    exact(shape.indexes, postIndexes) &&
    exact(shape.constraints, ["memory_propagations_effect_result_key"]);
  const applied =
    common &&
    exact(shape.tables, postTables) &&
    exact(shape.roles, postRoles) &&
    shape.policies.length === 24 + addedPolicies.length &&
    new Set(shape.policies).size === shape.policies.length &&
    policiesAreBounded &&
    predecessorPolicies.length === 24 &&
    prePolicies.every((name) => predecessorPolicies.includes(name)) &&
    addedPolicies.every((name) => shape.policies.includes(name)) &&
    exact(shape.views, postViews) &&
    exact(shape.columns, postColumns) &&
    exact(shape.memberships, postMemberships) &&
    exact(shape.indexes, postIndexes) &&
    exact(shape.constraints, ["memory_propagations_effect_result_key"]);
  if (!ready && !partial9 && !partial21 && !partial27 && !applied) deny("SCHEMA_STATE_REJECTED");
  const expectedTables = partial27 || applied ? postTables : partial21 ? partialTables : preTables;
  const countSql = expectedTables
    .map(
      (name) =>
        `SELECT '${name}' AS object_name, count(*)::INT8 AS row_count FROM continuity.${name}`,
    )
    .join(" UNION ALL ");
  const counts = await client.query(countSql);
  const expectedCounts = partial27 || applied ? postCounts : partial21 ? partialCounts : preCounts;
  const actualCounts = Object.fromEntries(
    counts.rows.map((entry) => [String(entry.object_name), Number(entry.row_count)]),
  );
  if (
    counts.rows.length !== expectedTables.length ||
    expectedTables.some((name) => expectedCounts[name] !== actualCounts[name])
  )
    deny("CONTENT_STATE_REJECTED");
  if (partial21 || partial27 || applied) {
    const [control, lock] = await Promise.all([
      client.query(`SELECT control_id, provider_enabled, public_session_cap, public_titan_cap,
        public_nova_cap, engineering_titan_cap, engineering_nova_cap, absolute_titan_cap,
        absolute_nova_cap FROM continuity.hackathon_runtime_control`),
      client.query("SELECT lock_id, lock_version FROM continuity.hackathon_quota_lock"),
    ]);
    const c = control.rows[0];
    const q = lock.rows[0];
    if (
      control.rows.length !== 1 ||
      !c ||
      c.control_id !== "live-v1" ||
      c.provider_enabled !== false ||
      [
        c.public_session_cap,
        c.public_titan_cap,
        c.public_nova_cap,
        c.engineering_titan_cap,
        c.engineering_nova_cap,
        c.absolute_titan_cap,
        c.absolute_nova_cap,
      ]
        .map(Number)
        .join(",") !== "100,600,200,200,100,800,300" ||
      lock.rows.length !== 1 ||
      !q ||
      q.lock_id !== "public-v1" ||
      Number(q.lock_version) !== 0
    )
      deny("CONTENT_STATE_REJECTED");
  }
  return Object.freeze({
    counts: Object.freeze(actualCounts),
    predecessorPolicies: Object.freeze(predecessorPolicies),
    state: ready
      ? "ready"
      : partial9
        ? "partial-9"
        : partial21
          ? "partial-21"
          : partial27
            ? "partial-27"
            : "applied",
  });
}

export async function runMigration0008({ command, createClient, environment = process.env } = {}) {
  if (!["--status", "--preflight", "--apply"].includes(command)) deny("USAGE_REJECTED");
  const connectionString = validateMigrationDatabaseUrl(environment);
  const artifact = await pinnedMigration();
  const client = createClient({ connectionString, connectionTimeoutMillis: 15_000 });
  let transaction = false;
  try {
    await client.connect();
    if (command !== "--apply") {
      await client.query("BEGIN");
      transaction = true;
      await client.query("SET TRANSACTION READ ONLY");
    }
    const before = await inspect(client);
    if (
      command === "--preflight" &&
      !["ready", "partial-9", "partial-21", "partial-27"].includes(before.state)
    )
      deny("MIGRATION_ALREADY_APPLIED");
    if (command === "--apply") {
      if (!["ready", "partial-9", "partial-21", "partial-27"].includes(before.state))
        deny("MIGRATION_ALREADY_APPLIED");
      const confirmed = await pinnedMigration();
      if (confirmed.sha256 !== artifact.sha256 || !confirmed.bytes.equals(artifact.bytes))
        deny("MIGRATION_ARTIFACT_REJECTED");
      const statements = migrationStatements(artifact.bytes);
      const start =
        before.state === "partial-9"
          ? 9
          : before.state === "partial-21"
            ? 21
            : before.state === "partial-27"
              ? 27
              : 0;
      for (const statement of statements.slice(start)) await client.query(statement);
      const after = await inspect(client);
      if (
        after.state !== "applied" ||
        preTables.some((name) => after.counts[name] !== before.counts[name]) ||
        !exact(after.predecessorPolicies, before.predecessorPolicies)
      )
        deny("MIGRATION_POSTSTATE_REJECTED");
    }
    if (transaction) {
      await client.query("COMMIT");
      transaction = false;
    }
    return Object.freeze({
      bytes: migrationPin.bytes,
      database: "defaultdb",
      migration: migrationPin.name,
      mode: "0644",
      providerEnabled: false,
      sha256: migrationPin.sha256,
      state: command === "--apply" ? "applied" : before.state,
    });
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Migration0008Error) throw error;
    deny(command === "--apply" ? "MIGRATION_APPLY_DENIED" : "MIGRATION_INSPECTION_DENIED");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function createMigrationClient(options) {
  const requireFromAdapter = createRequire(path.join(root, "packages/adapters-local/package.json"));
  const { Client } = requireFromAdapter("pg");
  return new Client(options);
}

export const migration0008TestContract = Object.freeze({
  addedPolicies,
  addedRoles,
  addedTables,
  partialRoles,
  partialCounts,
  partialTables,
  postColumns,
  postMemberships,
  postRoles,
  postCounts,
  postIndexes,
  postTables,
  postViews,
  preCounts,
  preIndexes,
  preColumns,
  preMemberships,
  prePolicies,
  preRoles,
  preTables,
  routines,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration0008({ command: process.argv[2], createClient: createMigrationClient })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof Migration0008Error ? error.code : "MIGRATION_0008_DENIED";
      process.stderr.write(`crdb-0008: FAIL: ${code}\n`);
      process.exitCode = 1;
    });
}
