#!/usr/bin/env node
/** Read-only, content-free attestation of the reviewed hackathon catalog. */
import { createHash } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createMigrationClient, validateMigrationDatabaseUrl } from "./h2-crdb-apply-0008.mjs";
import { classifyQuotaViewDefinition, migration0009TestContract } from "./h2-crdb-apply-0009.mjs";

const executor = "zc_continuity_executor";
const issuer = "zc_continuity_session_issuer";
const writer = "zc_continuity_reservation_writer";
const quotaOwner = "zc_continuity_quota_view_owner";
const mcpOwner = "zc_continuity_mcp_view_owner";
const mcpReader = "zc_continuity_mcp_reader";
const targetedRoles = Object.freeze([executor, issuer, mcpOwner, mcpReader, quotaOwner, writer]);
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const byJson = (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right));

export class LiveAttestError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new LiveAttestError(code);
};

function stripOuterParentheses(value) {
  let text = value.trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let closesAtEnd = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === "'" && text[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (character === "'") quoted = !quoted;
      if (quoted) continue;
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0) {
        closesAtEnd = index === text.length - 1;
        break;
      }
      if (depth < 0) deny("CATALOG_STATE_REJECTED");
    }
    if (!closesAtEnd || quoted || depth !== 0) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function splitConjunction(value) {
  const text = stripOuterParentheses(value);
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "'" && text[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === "'") quoted = !quoted;
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (
      depth === 0 &&
      text.slice(index, index + 3).toLowerCase() === "and" &&
      /\s/u.test(text[index - 1] ?? "") &&
      /\s/u.test(text[index + 3] ?? "")
    ) {
      parts.push(text.slice(start, index));
      start = index + 3;
      index += 2;
    }
  }
  if (quoted || depth !== 0) deny("CATALOG_STATE_REJECTED");
  if (parts.length === 0) return [text];
  parts.push(text.slice(start));
  return parts.flatMap(splitConjunction);
}

function normalizePredicate(value) {
  if (value === null) return null;
  const text = String(value)
    .replaceAll('"', "")
    .replace(/:{2,3}(?:bool|string)\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  if (!text || text.length > 2_048 || /(?:--|\/\*|\*\/|;)/u.test(text))
    deny("CATALOG_STATE_REJECTED");
  return splitConjunction(text).map(stripOuterParentheses).sort().join(" && ");
}

const tenantPair = `tenant_id = current_setting('continuity.tenant_id', true)
  AND server_purpose = current_setting('continuity.server_purpose', true)`;
const tenantStrict = `current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
  AND current_setting('continuity.server_purpose', true) = 'hackathon-demo'
  AND ${tenantPair}`;
const publicPair = `audience = 'public' AND ${tenantPair}`;
const tenantInsert = `current_setting('continuity.tenant_id', true) ~ '^[0-9a-f]{48}$'
  AND tenant_id = current_setting('continuity.tenant_id', true)`;
const startInsert = `${tenantPair} AND step_ordinal = 0 AND step_name = 'start'`;
const withheldInsert = `${tenantStrict} AND reason = 'sensitivity_policy'`;
const policy = (table, name, command, roles, qualifier, check) =>
  Object.freeze({
    check,
    command,
    name,
    permissive: "PERMISSIVE",
    qualifier,
    roles: Object.freeze([...roles]),
    schema: "continuity",
    table,
  });
const select = (table, name, roles, qualifier) =>
  policy(table, name, "SELECT", roles, qualifier, null);
const insert = (table, name, roles, check) => policy(table, name, "INSERT", roles, null, check);

const expectedPolicies = Object.freeze(
  [
    insert("tenants", "tenants_session_issuer_insert_scope", [issuer], tenantInsert),
    select("hackathon_sessions", "hackathon_sessions_issuer_select_scope", [issuer], tenantPair),
    insert("hackathon_sessions", "hackathon_sessions_issuer_insert_scope", [issuer], tenantStrict),
    select(
      "hackathon_sessions",
      "hackathon_sessions_executor_select_scope",
      [executor],
      tenantStrict,
    ),
    select(
      "hackathon_sessions",
      "hackathon_sessions_reservation_select_scope",
      [writer],
      tenantStrict,
    ),
    select("hackathon_sessions", "hackathon_sessions_mcp_scope", [mcpOwner], tenantStrict),
    select(
      "hackathon_session_tokens",
      "hackathon_session_tokens_issuer_select_scope",
      [issuer],
      tenantPair,
    ),
    insert(
      "hackathon_session_tokens",
      "hackathon_session_tokens_issuer_insert_scope",
      [issuer],
      tenantStrict,
    ),
    select(
      "hackathon_session_tokens",
      "hackathon_session_tokens_executor_select_scope",
      [executor],
      tenantPair,
    ),
    select(
      "hackathon_session_tokens",
      "hackathon_session_tokens_reservation_select_scope",
      [writer],
      tenantPair,
    ),
    insert(
      "hackathon_session_usage",
      "hackathon_session_usage_public_insert_scope",
      [issuer],
      publicPair,
    ),
    select("hackathon_session_usage", "hackathon_session_usage_quota_scope", [quotaOwner], "true"),
    insert(
      "hackathon_provider_usage",
      "hackathon_provider_usage_public_insert_scope",
      [issuer, writer],
      publicPair,
    ),
    select(
      "hackathon_provider_usage",
      "hackathon_provider_usage_quota_scope",
      [quotaOwner],
      "true",
    ),
    select(
      "hackathon_provider_reservations",
      "hackathon_reservations_writer_select_scope",
      [writer],
      tenantStrict,
    ),
    insert(
      "hackathon_provider_reservations",
      "hackathon_reservations_writer_insert_scope",
      [writer],
      tenantStrict,
    ),
    select(
      "hackathon_provider_reservations",
      "hackathon_reservations_issuer_select_scope",
      [issuer],
      tenantPair,
    ),
    insert(
      "hackathon_provider_reservations",
      "hackathon_reservations_issuer_insert_scope",
      [issuer],
      startInsert,
    ),
    select(
      "hackathon_provider_reservations",
      "hackathon_reservations_executor_select_scope",
      [executor],
      tenantPair,
    ),
    select(
      "hackathon_provider_reservations",
      "hackathon_reservations_mcp_scope",
      [mcpOwner],
      tenantPair,
    ),
    select(
      "hackathon_answer_receipts",
      "hackathon_answer_receipts_executor_select_scope",
      [executor],
      tenantStrict,
    ),
    insert(
      "hackathon_answer_receipts",
      "hackathon_answer_receipts_executor_insert_scope",
      [executor],
      tenantStrict,
    ),
    select(
      "hackathon_answer_receipts",
      "hackathon_answer_receipts_mcp_scope",
      [mcpOwner],
      tenantStrict,
    ),
    select(
      "hackathon_receipt_revisions",
      "hackathon_receipt_revisions_executor_select_scope",
      [executor],
      tenantStrict,
    ),
    insert(
      "hackathon_receipt_revisions",
      "hackathon_receipt_revisions_executor_insert_scope",
      [executor],
      tenantStrict,
    ),
    select(
      "hackathon_receipt_revisions",
      "hackathon_receipt_revisions_mcp_scope",
      [mcpOwner],
      tenantStrict,
    ),
    select(
      "hackathon_receipt_withheld",
      "hackathon_receipt_withheld_executor_select_scope",
      [executor],
      tenantStrict,
    ),
    insert(
      "hackathon_receipt_withheld",
      "hackathon_receipt_withheld_executor_insert_scope",
      [executor],
      withheldInsert,
    ),
    select(
      "hackathon_response_payloads",
      "hackathon_response_payloads_executor_select_scope",
      [executor],
      tenantPair,
    ),
    insert(
      "hackathon_response_payloads",
      "hackathon_response_payloads_executor_insert_scope",
      [executor],
      tenantPair,
    ),
    select(
      "hackathon_effect_results",
      "hackathon_effect_results_executor_select_scope",
      [executor],
      tenantPair,
    ),
    insert(
      "hackathon_effect_results",
      "hackathon_effect_results_executor_insert_scope",
      [executor],
      tenantPair,
    ),
  ].sort((left, right) =>
    `${left.table}\0${left.name}`.localeCompare(`${right.table}\0${right.name}`),
  ),
);

const expectedRoleRows = Object.freeze([
  Object.freeze({
    rolbypassrls: false,
    rolcanlogin: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolname: "continuity_app",
    rolsuper: false,
  }),
]);
const expectedMembershipRows = Object.freeze(
  [executor, issuer, writer].map((role_name) =>
    Object.freeze({ member_name: "continuity_app", role_name }),
  ),
);
const forcedTables = Object.freeze([
  "hackathon_answer_receipts",
  "hackathon_effect_results",
  "hackathon_provider_reservations",
  "hackathon_provider_usage",
  "hackathon_receipt_revisions",
  "hackathon_receipt_withheld",
  "hackathon_response_payloads",
  "hackathon_session_tokens",
  "hackathon_session_usage",
  "hackathon_sessions",
]);
const expectedRlsRows = Object.freeze(
  [
    ...forcedTables.map((table_name) => ({ rls_enabled: true, rls_forced: true, table_name })),
    { rls_enabled: false, rls_forced: false, table_name: "hackathon_quota_lock" },
    { rls_enabled: false, rls_forced: false, table_name: "hackathon_runtime_control" },
  ]
    .sort((left, right) => left.table_name.localeCompare(right.table_name))
    .map(Object.freeze),
);

const tableGrant = (grantee, table_name, ...privileges) =>
  privileges.map((privilege_type) =>
    Object.freeze({ grantee, is_grantable: "NO", privilege_type, table_name }),
  );
const expectedTableGrantRows = Object.freeze(
  [
    ...tableGrant(issuer, "hackathon_runtime_control", "SELECT"),
    ...tableGrant(issuer, "hackathon_quota_lock", "SELECT", "UPDATE"),
    ...tableGrant(issuer, "hackathon_session_usage", "INSERT"),
    ...tableGrant(issuer, "hackathon_provider_usage", "INSERT"),
    ...tableGrant(issuer, "tenants", "INSERT"),
    ...tableGrant(issuer, "hackathon_sessions", "INSERT", "SELECT"),
    ...tableGrant(issuer, "hackathon_session_tokens", "INSERT", "SELECT"),
    ...tableGrant(issuer, "hackathon_provider_reservations", "INSERT", "SELECT"),
    ...tableGrant(executor, "hackathon_runtime_control", "SELECT"),
    ...tableGrant(executor, "hackathon_sessions", "SELECT"),
    ...tableGrant(executor, "hackathon_session_tokens", "SELECT"),
    ...tableGrant(executor, "hackathon_provider_reservations", "SELECT"),
    ...tableGrant(executor, "hackathon_answer_receipts", "INSERT", "SELECT"),
    ...tableGrant(executor, "hackathon_receipt_revisions", "INSERT", "SELECT"),
    ...tableGrant(executor, "hackathon_receipt_withheld", "INSERT", "SELECT"),
    ...tableGrant(executor, "hackathon_response_payloads", "INSERT", "SELECT"),
    ...tableGrant(executor, "hackathon_effect_results", "INSERT", "SELECT"),
    ...tableGrant(writer, "hackathon_runtime_control", "SELECT"),
    ...tableGrant(writer, "hackathon_quota_lock", "SELECT", "UPDATE"),
    ...tableGrant(writer, "hackathon_sessions", "SELECT"),
    ...tableGrant(writer, "hackathon_session_tokens", "SELECT"),
    ...tableGrant(writer, "hackathon_provider_usage", "INSERT"),
    ...tableGrant(writer, "hackathon_provider_reservations", "INSERT", "SELECT"),
    ...tableGrant(quotaOwner, "hackathon_session_usage", "SELECT"),
    ...tableGrant(quotaOwner, "hackathon_provider_usage", "SELECT"),
    ...tableGrant(mcpOwner, "hackathon_sessions", "SELECT"),
    ...tableGrant(mcpOwner, "hackathon_provider_reservations", "SELECT"),
    ...tableGrant(mcpOwner, "hackathon_answer_receipts", "SELECT"),
    ...tableGrant(mcpOwner, "hackathon_receipt_revisions", "SELECT"),
    ...tableGrant(issuer, "hackathon_usage_summary_v1", "SELECT"),
    ...tableGrant(writer, "hackathon_usage_summary_v1", "SELECT"),
    ...tableGrant(mcpReader, "task_status_summary_v1", "SELECT"),
    ...tableGrant(mcpReader, "receipt_summary_v1", "SELECT"),
    ...tableGrant(mcpReader, "evidence_lineage_summary_v1", "SELECT"),
  ].sort((left, right) =>
    `${left.table_name}\0${left.grantee}\0${left.privilege_type}`.localeCompare(
      `${right.table_name}\0${right.grantee}\0${right.privilege_type}`,
    ),
  ),
);
const expectedSchemaGrantRows = Object.freeze(
  targetedRoles
    .map((grantee) => Object.freeze({ grantee, is_grantable: "NO", privilege_type: "USAGE" }))
    .sort(byJson),
);
const expectedViewOwnerRows = Object.freeze(
  [
    { owner_name: mcpOwner, view_name: "evidence_lineage_summary_v1" },
    { owner_name: quotaOwner, view_name: "hackathon_usage_summary_v1" },
    { owner_name: mcpOwner, view_name: "receipt_summary_v1" },
    { owner_name: mcpOwner, view_name: "task_status_summary_v1" },
  ].map(Object.freeze),
);
const expectedViewColumnRows = Object.freeze(
  [
    ...[
      "tenant_id",
      "server_purpose",
      "receipt_id",
      "fact_id",
      "fact_revision",
      "deletion_fence",
    ].map((column_name) => ({ column_name, view_name: "evidence_lineage_summary_v1" })),
    ...migration0009TestContract.expectedViewColumns.map((column_name) => ({
      column_name,
      view_name: "hackathon_usage_summary_v1",
    })),
    ...[
      "tenant_id",
      "server_purpose",
      "receipt_id",
      "attempt_id",
      "policy_version",
      "context_compiler_version",
      "retrieval_config_version",
      "embedding_space",
      "provider",
      "model_id",
      "provider_request_id",
      "created_at",
    ].map((column_name) => ({ column_name, view_name: "receipt_summary_v1" })),
    ...["tenant_id", "server_purpose", "reserved_steps", "deletion_fence", "expires_at"].map(
      (column_name) => ({ column_name, view_name: "task_status_summary_v1" }),
    ),
  ].map(Object.freeze),
);

const canonicalPolicy = (row) => [
  row.schema ?? row.schemaname,
  row.table ?? row.tablename,
  row.name ?? row.policyname,
  String(row.permissive).toUpperCase(),
  Array.isArray(row.roles) ? [...row.roles].sort() : deny("CATALOG_STATE_REJECTED"),
  String(row.command ?? row.cmd).toUpperCase(),
  normalizePredicate(row.qualifier ?? row.qual ?? null),
  normalizePredicate(row.check ?? row.with_check ?? null),
];
const expectedCatalog = Object.freeze({
  grants: Object.freeze([
    ...expectedTableGrantRows.map((row) => [
      "TABLE",
      row.table_name,
      row.grantee,
      row.privilege_type,
      row.is_grantable,
    ]),
    ...expectedSchemaGrantRows.map((row) => [
      "SCHEMA",
      "continuity",
      row.grantee,
      row.privilege_type,
      row.is_grantable,
    ]),
  ]),
  memberships: expectedMembershipRows.map((row) => [row.role_name, row.member_name]),
  policies: expectedPolicies.map(canonicalPolicy),
  quotaState: "applied",
  rls: expectedRlsRows.map((row) => [row.table_name, row.rls_enabled, row.rls_forced]),
  roles: expectedRoleRows.map((row) => [
    row.rolname,
    row.rolcanlogin,
    row.rolsuper,
    row.rolbypassrls,
    row.rolcreaterole,
    row.rolcreatedb,
  ]),
  viewColumns: expectedViewColumnRows.map((row) => [row.view_name, row.column_name]),
  viewOwners: expectedViewOwnerRows.map((row) => [row.view_name, row.owner_name]),
});

function version(value) {
  const text = String(value);
  if (
    text.length > 32 ||
    !/^v[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,3}(?:-(?:alpha|beta|rc)\.?[0-9]{1,3})?$/u.test(text)
  )
    deny("SERVER_VERSION_REJECTED");
  return text;
}

async function inspect(client) {
  const identity = await client.query(`SELECT current_database() AS database_name,
    current_user AS sql_user, pg_has_role(current_user, 'admin', 'member') AS sql_user_is_admin,
    crdb_internal.node_executable_version() AS server_version`);
  const id = identity.rows[0];
  if (
    identity.rows.length !== 1 ||
    id?.database_name !== "defaultdb" ||
    id?.sql_user !== "continuity_migrator" ||
    id?.sql_user_is_admin !== true
  )
    deny("MIGRATION_IDENTITY_REJECTED");
  const serverVersion = version(id.server_version);
  const [
    roles,
    memberships,
    rls,
    policies,
    tableGrants,
    schemaGrants,
    forbidden,
    owners,
    columns,
    quota,
  ] = await Promise.all([
    client.query(`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
        FROM pg_roles WHERE rolname = 'continuity_app' ORDER BY rolname`),
    client.query(`SELECT parent.rolname AS role_name, member.rolname AS member_name
        FROM pg_auth_members AS membership JOIN pg_roles AS parent
          ON parent.oid = membership.roleid JOIN pg_roles AS member
          ON member.oid = membership.member WHERE member.rolname = 'continuity_app'
        ORDER BY parent.rolname, member.rolname`),
    client.query(`SELECT relation.relname AS table_name,
          relation.relrowsecurity AS rls_enabled, relation.relforcerowsecurity AS rls_forced
        FROM pg_class AS relation JOIN pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'continuity' AND relation.relkind = 'r'
          AND relation.relname LIKE 'hackathon_%' ORDER BY relation.relname`),
    client.query(`SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'continuity'
          AND (tablename LIKE 'hackathon_%' OR policyname = 'tenants_session_issuer_insert_scope')
        ORDER BY tablename, policyname`),
    client.query(`SELECT table_name, grantee, privilege_type, is_grantable
        FROM information_schema.table_privileges WHERE table_schema = 'continuity'
          AND table_name IN ('tenants', 'hackathon_runtime_control', 'hackathon_quota_lock',
            'hackathon_sessions', 'hackathon_session_usage', 'hackathon_provider_usage',
            'hackathon_session_tokens', 'hackathon_provider_reservations',
            'hackathon_answer_receipts', 'hackathon_receipt_revisions',
            'hackathon_receipt_withheld', 'hackathon_response_payloads',
            'hackathon_effect_results', 'hackathon_usage_summary_v1',
            'task_status_summary_v1', 'receipt_summary_v1', 'evidence_lineage_summary_v1')
        ORDER BY table_name, grantee, privilege_type`),
    client.query(`SELECT grantee, privilege_type, is_grantable
        FROM information_schema.schema_privileges WHERE schema_name = 'continuity'
        ORDER BY grantee, privilege_type`),
    client.query(`SELECT privileges.grantee, privileges.table_name, privileges.privilege_type
        FROM information_schema.table_privileges AS privileges
        JOIN information_schema.tables AS tables ON tables.table_schema = privileges.table_schema
          AND tables.table_name = privileges.table_name
        WHERE privileges.table_schema = 'continuity' AND tables.table_type = 'BASE TABLE'
          AND privileges.grantee IN ('PUBLIC', 'continuity_app')
        ORDER BY privileges.grantee, privileges.table_name, privileges.privilege_type`),
    client.query(`SELECT relation.relname AS view_name, owner.rolname AS owner_name
        FROM pg_class AS relation JOIN pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace JOIN pg_roles AS owner
          ON owner.oid = relation.relowner WHERE namespace.nspname = 'continuity'
          AND relation.relname IN ('hackathon_usage_summary_v1', 'task_status_summary_v1',
            'receipt_summary_v1', 'evidence_lineage_summary_v1')
        ORDER BY relation.relname`),
    client.query(`SELECT table_name AS view_name, column_name
        FROM information_schema.columns WHERE table_schema = 'continuity'
          AND table_name IN ('hackathon_usage_summary_v1', 'task_status_summary_v1',
            'receipt_summary_v1', 'evidence_lineage_summary_v1')
        ORDER BY table_name, ordinal_position`),
    client.query(`SELECT view_definition FROM information_schema.views
        WHERE table_schema = 'continuity' AND table_name = 'hackathon_usage_summary_v1'`),
  ]);
  let quotaState;
  try {
    if (quota.rows.length !== 1) deny("QUOTA_VIEW_REJECTED");
    quotaState = classifyQuotaViewDefinition(quota.rows[0]?.view_definition);
    if (quotaState !== "applied") deny("QUOTA_VIEW_REJECTED");
  } catch {
    deny("QUOTA_VIEW_REJECTED");
  }
  const catalog = {
    grants: [
      ...tableGrants.rows.map((row) => [
        "TABLE",
        row.table_name,
        row.grantee,
        row.privilege_type,
        row.is_grantable,
      ]),
      ...schemaGrants.rows.map((row) => [
        "SCHEMA",
        "continuity",
        row.grantee,
        row.privilege_type,
        row.is_grantable,
      ]),
    ],
    memberships: memberships.rows.map((row) => [row.role_name, row.member_name]),
    policies: policies.rows.map(canonicalPolicy),
    quotaState,
    rls: rls.rows.map((row) => [row.table_name, row.rls_enabled, row.rls_forced]),
    roles: roles.rows.map((row) => [
      row.rolname,
      row.rolcanlogin,
      row.rolsuper,
      row.rolbypassrls,
      row.rolcreaterole,
      row.rolcreatedb,
    ]),
    viewColumns: columns.rows.map((row) => [row.view_name, row.column_name]),
    viewOwners: owners.rows.map((row) => [row.view_name, row.owner_name]),
  };
  if (forbidden.rows.length !== 0 || !exact(catalog, expectedCatalog))
    deny("CATALOG_STATE_REJECTED");
  return Object.freeze({
    catalogSha256: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
    serverVersion,
  });
}

export async function runLiveAttest({
  arguments_ = [],
  createClient = createMigrationClient,
  environment = process.env,
} = {}) {
  if (!exact(arguments_, ["--status"])) deny("USAGE_REJECTED");
  let connectionString;
  try {
    connectionString = validateMigrationDatabaseUrl(environment);
  } catch {
    deny("DATABASE_URL_REJECTED");
  }
  let client;
  let transaction = false;
  try {
    client = createClient({ connectionString, connectionTimeoutMillis: 15_000 });
    await client.connect();
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET TRANSACTION READ ONLY");
    const attestation = await inspect(client);
    await client.query("COMMIT");
    transaction = false;
    return Object.freeze({
      database: "defaultdb",
      serverVersion: attestation.serverVersion,
      roles: expectedCatalog.roles.length,
      memberships: expectedCatalog.memberships.length,
      forceRlsTables: forcedTables.length,
      policies: expectedCatalog.policies.length,
      grants: expectedCatalog.grants.length,
      views: expectedCatalog.viewOwners.length,
      catalogSha256: attestation.catalogSha256,
    });
  } catch (error) {
    if (transaction) await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LiveAttestError) throw error;
    deny("LIVE_ATTEST_DENIED");
  } finally {
    await client?.end().catch(() => undefined);
  }
}

export const liveAttestTestContract = Object.freeze({
  columns: expectedViewColumnRows,
  memberships: expectedMembershipRows,
  policies: expectedPolicies,
  rls: expectedRlsRows,
  roles: expectedRoleRows,
  schemaGrants: expectedSchemaGrantRows,
  tableGrants: expectedTableGrantRows,
  viewOwners: expectedViewOwnerRows,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLiveAttest({ arguments_: process.argv.slice(2) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof LiveAttestError ? error.code : "LIVE_ATTEST_DENIED";
      process.stderr.write(`crdb-live-attest: FAIL: ${code}\n`);
      process.exitCode = 1;
    });
}
