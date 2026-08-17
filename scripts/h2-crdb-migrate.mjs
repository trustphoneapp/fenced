#!/usr/bin/env node
/**
 * Applies the reviewed Continuity migration pack to one fresh CockroachDB
 * database. This is an operator tool, never part of the request path.
 *
 * Usage: node scripts/h2-crdb-migrate.mjs --status | --apply
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromAdapter = createRequire(path.join(root, "packages/adapters-local/package.json"));
const { Client } = requireFromAdapter("pg");
const expectedMigrations = Object.freeze([
  "0001_tenant_event_ledger.sql",
  "0002_purpose_qualified_tenant_keys.sql",
  "0003_role_session_isolation.sql",
  "0004_erasable_payload_storage.sql",
  "0005_immutable_event_links.sql",
  "0006_outbox_inbox.sql",
  "0007_agent_memory.sql",
]);
const expectedMigrationHashes = Object.freeze({
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
const separatelyAppliedMigrations = Object.freeze([
  "0008_hackathon_live.sql",
  "0009_hackathon_quota_window.sql",
]);

function databaseUrl(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is missing from the process environment`);
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !/cockroachlabs\.cloud$/iu.test(url.hostname) ||
    !url.username ||
    !url.password ||
    !/^verify-(ca|full)$/iu.test(url.searchParams.get("sslmode") ?? "")
  )
    throw new Error(`${name} is not a verified CockroachDB SQL URL`);
  return value;
}

async function migrations() {
  const migrationRoot = path.join(root, "database/migrations");
  const names = (await readdir(migrationRoot)).filter((name) => name.endsWith(".sql")).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify([...expectedMigrations, ...separatelyAppliedMigrations])
  )
    throw new Error("migration inventory differs from the reviewed 0001-0007 pack");
  return Promise.all(
    expectedMigrations.map(async (name) => {
      const filename = path.join(migrationRoot, name);
      const [stat, canonical, sql] = await Promise.all([
        lstat(filename),
        realpath(filename),
        readFile(filename, "utf8"),
      ]);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        canonical !== filename ||
        (stat.mode & 0o777) !== 0o644
      )
        throw new Error(`migration file safety check failed: ${name}`);
      if (createHash("sha256").update(sql).digest("hex") !== expectedMigrationHashes[name])
        throw new Error(`migration hash differs from reviewed bytes: ${name}`);
      return Object.freeze({ name, sql });
    }),
  );
}

async function inspect(client) {
  const { rows } = await client.query(`SELECT
  current_database() AS database_name,
  current_user AS sql_user,
  EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'continuity') AS continuity_schema_exists,
  (SELECT count(*)::int FROM information_schema.tables
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'crdb_internal', 'pg_extension')) AS user_table_count,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS sql_user_is_admin`);
  const row = rows[0];
  if (!row) throw new Error("CockroachDB did not return a connection status row");
  return Object.freeze({
    database: String(row.database_name),
    schemaExists: row.continuity_schema_exists === true,
    sqlUser: String(row.sql_user),
    sqlUserIsAdmin: row.sql_user_is_admin === true,
    userTableCount: Number(row.user_table_count),
  });
}

async function exact0001Checkpoint(client) {
  const { rows } = await client.query(`SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'continuity'
ORDER BY table_name`);
  const tables = rows.map((row) => String(row.table_name));
  if (JSON.stringify(tables) !== JSON.stringify(["events", "payload_anchors", "tenants"]))
    return false;
  const counts = await client.query(`SELECT
  (SELECT count(*)::int FROM continuity.tenants) AS tenants,
  (SELECT count(*)::int FROM continuity.payload_anchors) AS payload_anchors,
  (SELECT count(*)::int FROM continuity.events) AS events`);
  const row = counts.rows[0];
  if (
    !row ||
    Number(row.tenants) !== 0 ||
    Number(row.payload_anchors) !== 0 ||
    Number(row.events) !== 0
  )
    return false;
  const definitions = await Promise.all(
    ["events", "payload_anchors", "tenants"].map(async (name) => {
      const result = await client.query(`SHOW CREATE TABLE continuity.${name}`);
      return String(result.rows[0]?.create_statement ?? "").replace(/\s+/gu, " ");
    }),
  );
  const [events, payloadAnchors, tenants] = definitions;
  if (!events || !payloadAnchors || !tenants) return false;
  const indexes = await client.query("SHOW INDEXES FROM continuity.payload_anchors");
  const indexNames = new Set(indexes.rows.map((row) => String(row.index_name)));
  const matchesLegacyKeys =
    events.includes(
      "CONSTRAINT events_pkey PRIMARY KEY (tenant_id ASC, event_id ASC, event_revision ASC)",
    ) &&
    events.includes("CONSTRAINT events_tenant_id_fkey FOREIGN KEY") &&
    payloadAnchors.includes(
      "CONSTRAINT payload_anchors_pkey PRIMARY KEY (tenant_id ASC, payload_ref ASC, payload_revision ASC)",
    ) &&
    indexNames.has(
      "payload_anchors_tenant_id_payload_ref_payload_revision_requested_purpose_server_purpose_key",
    ) &&
    tenants.includes("CONSTRAINT tenants_pkey PRIMARY KEY (tenant_id ASC)");
  const hasR2Shape = [events, payloadAnchors].some((definition) =>
    /events_purpose_pkey|events_payload_purpose_fkey|payload_anchors_purpose_pkey|payload_anchors_purpose_requested_key/u.test(
      definition,
    ),
  );
  const roles = await client.query(
    "SELECT count(*)::int AS count FROM pg_roles WHERE rolname LIKE 'zc_continuity_%'",
  );
  return matchesLegacyKeys && !hasR2Shape && Number(roles.rows[0]?.count) === 0;
}

async function exact0002Checkpoint(client) {
  const { rows } = await client.query(`SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'continuity'
ORDER BY table_name`);
  const tables = rows.map((row) => String(row.table_name));
  if (JSON.stringify(tables) !== JSON.stringify(["events", "payload_anchors", "tenants"]))
    return false;
  const counts = await client.query(`SELECT
  (SELECT count(*)::int FROM continuity.tenants) AS tenants,
  (SELECT count(*)::int FROM continuity.payload_anchors) AS payload_anchors,
  (SELECT count(*)::int FROM continuity.events) AS events`);
  const count = counts.rows[0];
  if (
    !count ||
    Number(count.tenants) !== 0 ||
    Number(count.payload_anchors) !== 0 ||
    Number(count.events) !== 0
  )
    return false;
  const definitions = await Promise.all(
    ["events", "payload_anchors"].map(async (name) => {
      const result = await client.query(`SHOW CREATE TABLE continuity.${name}`);
      return String(result.rows[0]?.create_statement ?? "").replace(/\s+/gu, " ");
    }),
  );
  const [events, payloadAnchors] = definitions;
  const anchorIndexes = await client.query("SHOW INDEXES FROM continuity.payload_anchors");
  const indexNames = new Set(anchorIndexes.rows.map((row) => String(row.index_name)));
  const roles = await client.query(
    "SELECT count(*)::int AS count FROM pg_roles WHERE rolname LIKE 'zc_continuity_%'",
  );
  return (
    Boolean(events && payloadAnchors) &&
    events.includes(
      "CONSTRAINT events_pkey PRIMARY KEY (tenant_id ASC, server_purpose ASC, event_id ASC, event_revision ASC)",
    ) &&
    events.includes("CONSTRAINT events_payload_purpose_fkey FOREIGN KEY") &&
    payloadAnchors.includes(
      "CONSTRAINT payload_anchors_pkey PRIMARY KEY (tenant_id ASC, server_purpose ASC, payload_ref ASC, payload_revision ASC)",
    ) &&
    indexNames.has("payload_anchors_purpose_requested_key") &&
    Number(roles.rows[0]?.count) === 0
  );
}

async function exact0006PostTablesCheckpoint(
  client,
  expectedRoles = ["zc_continuity_executor", "zc_continuity_reader"],
) {
  const { rows } = await client.query(`SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'continuity'
ORDER BY table_name`);
  const tables = rows.map((row) => String(row.table_name));
  const expected = [
    "event_revision_requests",
    "events",
    "inbox_receipts",
    "outbox_deliveries",
    "outbox_messages",
    "payload_anchors",
    "payload_key_anchors",
    "payload_revision_material",
    "payload_superseded_wrapped_keys",
    "payload_wrapped_keys",
    "tenants",
  ];
  if (JSON.stringify(tables) !== JSON.stringify(expected)) return false;
  for (const table of expected) {
    const count = await client.query(`SELECT count(*)::int AS count FROM continuity.${table}`);
    if (Number(count.rows[0]?.count) !== 0) return false;
  }
  const [roles, functions] = await Promise.all([
    client.query(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'zc_continuity_%' ORDER BY rolname",
    ),
    client.query(
      "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'continuity' ORDER BY routine_name",
    ),
  ]);
  return (
    JSON.stringify(roles.rows.map((row) => String(row.rolname))) ===
      JSON.stringify(expectedRoles) && functions.rows.length === 0
  );
}

async function exact0006PostPoliciesCheckpoint(client) {
  if (
    !(await exact0006PostTablesCheckpoint(client, [
      "zc_continuity_executor",
      "zc_continuity_reader",
      "zc_continuity_transition_owner",
    ]))
  )
    return false;
  const [roles, policies] = await Promise.all([
    client.query(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'zc_continuity_%' ORDER BY rolname",
    ),
    client.query(
      "SELECT policyname FROM pg_policies WHERE schemaname = 'continuity' ORDER BY policyname",
    ),
  ]);
  const expectedRoles = [
    "zc_continuity_executor",
    "zc_continuity_reader",
    "zc_continuity_transition_owner",
  ];
  const expectedPolicies = [
    "event_revision_requests_executor_insert_scope",
    "event_revision_requests_executor_select_scope",
    "event_revision_requests_reader_scope",
    "events_reader_scope",
    "inbox_receipts_executor_select_scope",
    "inbox_receipts_reader_scope",
    "inbox_receipts_transition_owner_scope",
    "outbox_deliveries_executor_select_scope",
    "outbox_deliveries_reader_scope",
    "outbox_deliveries_transition_owner_scope",
    "outbox_messages_executor_insert_scope",
    "outbox_messages_executor_select_scope",
    "outbox_messages_reader_scope",
    "payload_anchors_reader_scope",
    "tenants_reader_scope",
  ];
  return (
    JSON.stringify(roles.rows.map((row) => String(row.rolname))) ===
      JSON.stringify(expectedRoles) &&
    JSON.stringify(policies.rows.map((row) => String(row.policyname))) ===
      JSON.stringify(expectedPolicies)
  );
}

async function exact0007PostIndexCheckpoint(client) {
  const { rows } = await client.query(`SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'continuity'
ORDER BY table_name`);
  const expectedTables = [
    "event_revision_requests",
    "events",
    "inbox_receipts",
    "memory_facts",
    "outbox_deliveries",
    "outbox_messages",
    "payload_anchors",
    "payload_key_anchors",
    "payload_revision_material",
    "payload_superseded_wrapped_keys",
    "payload_wrapped_keys",
    "tenants",
  ];
  if (JSON.stringify(rows.map((row) => String(row.table_name))) !== JSON.stringify(expectedTables))
    return false;
  for (const table of expectedTables) {
    const count = await client.query(`SELECT count(*)::int AS count FROM continuity.${table}`);
    if (Number(count.rows[0]?.count) !== 0) return false;
  }
  const [roles, policies, indexes] = await Promise.all([
    client.query(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'zc_continuity_%' ORDER BY rolname",
    ),
    client.query(
      "SELECT policyname FROM pg_policies WHERE schemaname = 'continuity' ORDER BY policyname",
    ),
    client.query("SHOW INDEXES FROM continuity.memory_facts"),
  ]);
  const expectedRoles = [
    "zc_continuity_executor",
    "zc_continuity_reader",
    "zc_continuity_transition_owner",
  ];
  const expectedPolicies = [
    "event_revision_requests_executor_insert_scope",
    "event_revision_requests_executor_select_scope",
    "event_revision_requests_reader_scope",
    "events_reader_scope",
    "inbox_receipts_executor_select_scope",
    "inbox_receipts_reader_scope",
    "inbox_receipts_transition_owner_scope",
    "outbox_deliveries_executor_select_scope",
    "outbox_deliveries_reader_scope",
    "outbox_deliveries_transition_owner_scope",
    "outbox_messages_executor_insert_scope",
    "outbox_messages_executor_select_scope",
    "outbox_messages_reader_scope",
    "payload_anchors_reader_scope",
    "tenants_reader_scope",
  ];
  return (
    JSON.stringify(roles.rows.map((row) => String(row.rolname))) ===
      JSON.stringify(expectedRoles) &&
    JSON.stringify(policies.rows.map((row) => String(row.policyname))) ===
      JSON.stringify(expectedPolicies) &&
    indexes.rows.some((row) => String(row.index_name) === "memory_facts_embedding_cosine")
  );
}

function cloudCompatibleSql(migration) {
  if (migration.name === "0003_role_session_isolation.sql") {
    // CockroachDB roles are NOLOGIN and non-admin by default; NOINHERIT and
    // NOSUPERUSER are PostgreSQL-only spellings. Preserve the relevant RLS
    // invariant explicitly and leave the reviewed source bytes untouched.
    return migration.sql
      .replace(
        "CREATE ROLE zc_continuity_reader\n  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;",
        "CREATE ROLE zc_continuity_reader WITH NOBYPASSRLS;",
      )
      .replace(
        "CREATE ROLE zc_continuity_executor\n  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;",
        "CREATE ROLE zc_continuity_executor WITH NOBYPASSRLS;",
      );
  }
  if (migration.name === "0006_outbox_inbox.sql") {
    return migration.sql.replace(
      "CREATE ROLE zc_continuity_transition_owner\n  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;",
      "CREATE ROLE zc_continuity_transition_owner WITH NOBYPASSRLS;",
    );
  }
  if (migration.name !== "0002_purpose_qualified_tenant_keys.sql") return migration.sql;
  // CockroachDB Cloud omits 0001's MATCH FULL composite FK and requires its
  // native ALTER PRIMARY KEY syntax. The exact empty R1 attestation makes
  // this one Cloud-specific key transition safe; source migration bytes stay pinned.
  return `ALTER TABLE continuity.payload_anchors
  ALTER PRIMARY KEY USING COLUMNS (tenant_id, server_purpose, payload_ref, payload_revision);

ALTER TABLE continuity.payload_anchors
  ADD CONSTRAINT payload_anchors_purpose_requested_key
  UNIQUE (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose);

ALTER TABLE continuity.events
  ALTER PRIMARY KEY USING COLUMNS (tenant_id, server_purpose, event_id, event_revision);

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
  ) ON DELETE RESTRICT ON UPDATE RESTRICT;`;
}

function cloudStatements(sql) {
  const statements = [];
  let quoted = false;
  let dollarQuoted = false;
  let lineComment = false;
  let start = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (!quoted && !dollarQuoted && sql.slice(index, index + 2) === "--") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "'" && !dollarQuoted && sql[index - 1] !== "\\") quoted = !quoted;
    if (sql.slice(index, index + 2) === "$$" && !quoted) {
      dollarQuoted = !dollarQuoted;
      index += 1;
      continue;
    }
    if (character === ";" && !quoted && !dollarQuoted) {
      const statement = sql
        .slice(start, index)
        .replace(/^\s*(?:--[^\n]*\n\s*)*/gu, "")
        .trim();
      start = index + 1;
      if (statement && statement !== "BEGIN" && statement !== "COMMIT") statements.push(statement);
    }
  }
  if (sql.slice(start).trim()) throw new Error("migration has an unterminated statement");
  return statements;
}

async function waitForSchemaChanges(client) {
  let quietSeconds = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const { rows } = await client.query(`SELECT count(*)::int AS active
FROM [SHOW JOBS]
WHERE status IN ('running', 'pending', 'pause-requested')
  AND job_type = 'SCHEMA CHANGE'`);
    if (Number(rows[0]?.active) === 0) {
      quietSeconds += 1;
      if (quietSeconds >= 5) return;
    } else {
      quietSeconds = 0;
    }
  }
  throw new Error("schema changes did not settle before the migration timeout");
}

async function applyMigrations(client, selected) {
  for (const migration of selected) {
    const current = await migrations();
    if (current.find((entry) => entry.name === migration.name)?.sql !== migration.sql)
      throw new Error("migration files changed during apply");
    await waitForSchemaChanges(client);
    const statements = cloudStatements(cloudCompatibleSql(migration)).slice(
      migration.statementOffset ?? 0,
    );
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      try {
        await client.query(statement);
        await waitForSchemaChanges(client);
      } catch {
        throw Object.assign(new Error("migration statement denied"), {
          code: `MIGRATION_${migration.name.slice(0, 4)}_STATEMENT_${index + 1}_FAILED`,
        });
      }
    }
    process.stdout.write(
      `applied ${migration.name}${migration.statementOffset ? ` from statement ${migration.statementOffset + 1}` : ""}\n`,
    );
  }
  await waitForSchemaChanges(client);
}

let client;
try {
  const command = process.argv[2];
  if (
    command !== "--status" &&
    command !== "--migration-status" &&
    command !== "--apply" &&
    command !== "--resume-from-0001" &&
    command !== "--resume-from-0002" &&
    command !== "--resume-0006-post-tables" &&
    command !== "--resume-0006-schema-only" &&
    command !== "--resume-0007-post-index"
  )
    throw new Error(
      "usage: node scripts/h2-crdb-migrate.mjs --status | --migration-status | --apply | --resume-from-0001 | --resume-from-0002 | --resume-0006-post-tables | --resume-0006-schema-only | --resume-0007-post-index",
    );
  const migrationConnection =
    command === "--migration-status" ||
    command === "--apply" ||
    command === "--resume-from-0001" ||
    command === "--resume-from-0002" ||
    command === "--resume-0006-post-tables" ||
    command === "--resume-0006-schema-only" ||
    command === "--resume-0007-post-index";
  const environmentName = migrationConnection
    ? "COCKROACH_MIGRATION_DATABASE_URL"
    : "COCKROACH_DATABASE_URL";
  client = new Client({
    connectionString: databaseUrl(environmentName),
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  const before = await inspect(client);
  if (command === "--status" || command === "--migration-status") {
    process.stdout.write(
      `${JSON.stringify({ connected: true, database: before.database, migrationConnection, schemaExists: before.schemaExists, sqlUser: before.sqlUser, sqlUserIsAdmin: before.sqlUserIsAdmin, userTableCount: before.userTableCount })}\n`,
    );
  } else {
    if (!before.sqlUserIsAdmin)
      throw new Error("refusing to apply: migration URL must use an administrator identity");
    if (before.database !== "defaultdb")
      throw new Error("refusing to apply: target must be the dedicated defaultdb");
    if (command === "--apply" && (before.schemaExists || before.userTableCount !== 0))
      throw new Error(
        "refusing to apply: target must be the empty dedicated defaultdb with no continuity schema",
      );
    const reviewedMigrations = await migrations();
    const selected =
      command === "--resume-from-0001"
        ? reviewedMigrations.slice(1)
        : command === "--resume-from-0002"
          ? reviewedMigrations.slice(2)
          : command === "--resume-0006-post-tables"
            ? [{ ...reviewedMigrations[5], statementOffset: 3 }, reviewedMigrations[6]]
            : command === "--resume-0006-schema-only"
              ? [reviewedMigrations[6]]
              : command === "--resume-0007-post-index"
                ? [{ ...reviewedMigrations[6], statementOffset: 2 }]
                : reviewedMigrations;
    const checkpoint =
      command === "--resume-from-0001"
        ? exact0001Checkpoint
        : command === "--resume-from-0002"
          ? exact0002Checkpoint
          : command === "--resume-0006-post-tables"
            ? exact0006PostTablesCheckpoint
            : command === "--resume-0006-schema-only"
              ? exact0006PostPoliciesCheckpoint
              : command === "--resume-0007-post-index"
                ? exact0007PostIndexCheckpoint
                : undefined;
    if (checkpoint && !(await checkpoint(client)))
      throw new Error("refusing to resume: target does not match its exact empty checkpoint");
    if (checkpoint) {
      await waitForSchemaChanges(client);
      if (!(await checkpoint(client)))
        throw new Error("refusing to resume: target changed during checkpoint verification");
    }
    process.stdout.write(
      `migration plan: ${selected.map((migration) => migration.name).join(",")}\n`,
    );
    if (command === "--resume-0006-schema-only") {
      await client.query("REVOKE CREATE ON SCHEMA continuity FROM zc_continuity_transition_owner");
      process.stdout.write(
        "deferred 0006 SQL write-routines: CockroachDB SQL UDF bodies are SELECT-only\n",
      );
    }
    await applyMigrations(client, selected);
    const after = await inspect(client);
    if (!after.schemaExists || after.userTableCount === 0)
      throw new Error("migration completed but expected Continuity tables were not found");
    process.stdout.write(
      `${JSON.stringify({ applied: selected.length, database: after.database, schemaExists: after.schemaExists, sqlUser: after.sqlUser, userTableCount: after.userTableCount })}\n`,
    );
  }
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "CRDB_MIGRATION_DENIED";
  process.stderr.write(`crdb-migrate: FAIL: ${code}\n`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => undefined);
}
