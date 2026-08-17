#!/usr/bin/env node
/** Destructive-but-bounded synthetic live proof; cleanup is deterministic and separately retryable. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { h2DemoDataset } from "../packages/adapters-local/dist/h2-demo-dataset.js";
import {
  createHackathonCrdbRepository,
  hackathonDviPublicSql,
} from "../packages/adapters-local/dist/hackathon-crdb.js";
import { createMigrationClient, validateMigrationDatabaseUrl } from "./h2-crdb-apply-0008.mjs";

const requireFromAdapter = createRequire(
  new URL("../packages/adapters-local/package.json", import.meta.url),
);
const { Pool } = requireFromAdapter("pg");
const purpose = "hackathon-demo";
const titanSpace = "zc.bedrock-titan-v2.1024";
const domain = "zc.h2-crdb-live-probe.v1";
const zeroVector = `[${Array.from({ length: 1_024 }, () => "0").join(",")}]`;
const unitVector = `[1,${Array.from({ length: 1_023 }, () => "0").join(",")}]`;
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const ownedTables = Object.freeze([
  "hackathon_response_payloads",
  "hackathon_receipt_revisions",
  "hackathon_receipt_withheld",
  "hackathon_answer_receipts",
  "hackathon_effect_results",
  "memory_propagations",
  "hackathon_provider_reservations",
  "hackathon_provider_usage",
  "hackathon_session_tokens",
  "hackathon_session_usage",
  "hackathon_sessions",
  "disclosure_receipts",
  "memory_facts",
  "tenants",
]);
const expectedCaps = "false,100,600,200,200,100,800,300";

export class LiveProbeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new LiveProbeError(code);
};
const hash = (nonce, label) =>
  createHash("sha256").update(`${domain}\0${label}\0${nonce}`).digest("hex");
const identifier = (nonce, label) => hash(nonce, label).slice(0, 48);

export function deriveProbeIds(nonce) {
  if (!/^[0-9a-f]{64}$/u.test(String(nonce))) deny("USAGE_REJECTED");
  const tenant = (label) => identifier(nonce, `tenant:${label}`);
  const session = (label, tenantId) => `${tenantId}${hash(nonce, `session:${label}`).slice(0, 16)}`;
  const correctionTenant = tenant("correction");
  const rollbackTenant = tenant("rollback");
  const expiredTenant = tenant("expired");
  return Object.freeze({
    correction: Object.freeze({
      attemptId: identifier(nonce, "attempt:correction"),
      operationId: identifier(nonce, "operation:correction"),
      requestDigest: hash(nonce, "request:correction"),
      sessionDigest: session("correction", correctionTenant),
      tenantId: correctionTenant,
    }),
    expired: Object.freeze({
      attemptId: identifier(nonce, "attempt:expired"),
      operationId: identifier(nonce, "operation:expired"),
      sessionDigest: session("expired", expiredTenant),
      tenantId: expiredTenant,
    }),
    rollback: Object.freeze({
      attemptId: identifier(nonce, "attempt:rollback"),
      operationId: identifier(nonce, "operation:rollback"),
      requestDigest: hash(nonce, "request:rollback"),
      sessionDigest: session("rollback", rollbackTenant),
      tenantId: rollbackTenant,
    }),
    tenants: Object.freeze([correctionTenant, expiredTenant, rollbackTenant].sort()),
  });
}

function validateAppUrl(environment) {
  const raw = environment.COCKROACH_DATABASE_URL ?? "";
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 4_096) deny("APP_URL_REJECTED");
  let url;
  try {
    url = new URL(raw);
  } catch {
    deny("APP_URL_REJECTED");
  }
  if (
    url.protocol !== "postgresql:" ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.cockroachlabs\.cloud$/u.test(url.hostname) ||
    url.username !== "continuity_app" ||
    !url.password ||
    url.port !== "26257" ||
    url.pathname !== "/defaultdb" ||
    url.search !== "?sslmode=verify-full" ||
    url.hash !== "" ||
    raw !== raw.trim()
  )
    deny("APP_URL_REJECTED");
  return raw;
}

function appPoolOptions(connectionString) {
  return Object.freeze({
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 1,
    query_timeout: 5_000,
    ssl: Object.freeze({ rejectUnauthorized: true }),
    statement_timeout: 5_000,
  });
}

async function identity(client) {
  const result = await client.query(`SELECT current_database() AS database_name,
    current_user AS sql_user, pg_has_role(current_user, 'admin', 'member') AS sql_user_is_admin`);
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row?.database_name !== "defaultdb" ||
    row?.sql_user !== "continuity_migrator" ||
    row?.sql_user_is_admin !== true
  )
    deny("MIGRATION_IDENTITY_REJECTED");
}

async function transaction(client, operation, readOnly = false) {
  let active = false;
  try {
    await client.query("BEGIN");
    active = true;
    if (readOnly) await client.query("SET TRANSACTION READ ONLY");
    const result = await operation();
    await client.query("COMMIT");
    active = false;
    return result;
  } catch (error) {
    if (active) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function counts(client, tenants) {
  const clauses = ownedTables.map((table) =>
    table === "tenants"
      ? `SELECT '${table}' AS table_name, count(*)::INT8 AS row_count
          FROM continuity.${table} WHERE tenant_id = ANY($1::STRING[])`
      : `SELECT '${table}' AS table_name, count(*)::INT8 AS row_count
          FROM continuity.${table} WHERE tenant_id = ANY($1::STRING[]) AND server_purpose = $2`,
  );
  const result = await client.query(clauses.join(" UNION ALL "), [tenants, purpose]);
  if (result.rows.length !== ownedTables.length) deny("CANARY_STATE_REJECTED");
  const values = Object.fromEntries(
    result.rows.map((row) => [row.table_name, Number(row.row_count)]),
  );
  if (
    ownedTables.some((table) => !Number.isSafeInteger(values[table]) || Number(values[table]) < 0)
  )
    deny("CANARY_STATE_REJECTED");
  return values;
}

async function globalCounts(client) {
  const result = await client.query(
    ownedTables
      .map(
        (table) =>
          `SELECT '${table}' AS table_name, count(*)::INT8 AS row_count FROM continuity.${table}`,
      )
      .join(" UNION ALL "),
  );
  if (result.rows.length !== ownedTables.length) deny("BASELINE_STATE_REJECTED");
  const values = Object.fromEntries(
    result.rows.map((row) => [row.table_name, Number(row.row_count)]),
  );
  if (
    ownedTables.some((table) => !Number.isSafeInteger(values[table]) || Number(values[table]) < 0)
  )
    deny("BASELINE_STATE_REJECTED");
  return values;
}

async function cleanup(client, ids) {
  for (const table of ownedTables) {
    const result = await client.query(
      table === "tenants"
        ? `DELETE FROM continuity.${table} WHERE tenant_id = ANY($1::STRING[])`
        : `DELETE FROM continuity.${table}
          WHERE tenant_id = ANY($1::STRING[]) AND server_purpose = $2`,
      table === "tenants" ? [ids.tenants] : [ids.tenants, purpose],
    );
    if (!Number.isSafeInteger(result.rowCount) || result.rowCount < 0)
      deny("CLEANUP_STATE_REJECTED");
  }
  if (Object.values(await counts(client, ids.tenants)).some((value) => value !== 0))
    deny("CLEANUP_STATE_REJECTED");
}

async function providerPreflight(client) {
  const result = await client.query(`SELECT provider_enabled, public_session_cap, public_titan_cap,
    public_nova_cap, engineering_titan_cap, engineering_nova_cap, absolute_titan_cap,
    absolute_nova_cap FROM continuity.hackathon_runtime_control WHERE control_id = 'live-v1'`);
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    [
      row?.provider_enabled,
      row?.public_session_cap,
      row?.public_titan_cap,
      row?.public_nova_cap,
      row?.engineering_titan_cap,
      row?.engineering_nova_cap,
      row?.absolute_titan_cap,
      row?.absolute_nova_cap,
    ]
      .map(String)
      .join(",") !== expectedCaps
  )
    deny("PROVIDER_STATE_REJECTED");
}

async function insertSession(client, canary, expired = false) {
  await client.query("INSERT INTO continuity.tenants (tenant_id) VALUES ($1)", [canary.tenantId]);
  await client.query(
    `INSERT INTO continuity.hackathon_sessions
      (tenant_id,server_purpose,deletion_fence,created_at,expires_at)
      VALUES ($1,$2,0,CURRENT_TIMESTAMP - ${expired ? "INTERVAL '26 hours'" : "INTERVAL '1 hour'"},
        CURRENT_TIMESTAMP - ${expired ? "INTERVAL '2 hours'" : "INTERVAL '-23 hours'"})`,
    [canary.tenantId, purpose],
  );
  await client.query(
    `INSERT INTO continuity.hackathon_session_tokens
      (tenant_id,server_purpose,session_digest,created_at,expires_at)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP - INTERVAL '1 hour',CURRENT_TIMESTAMP + INTERVAL '23 hours')`,
    [canary.tenantId, purpose, canary.sessionDigest],
  );
}

async function insertCorrectionCanary(client, canary, rollback) {
  await insertSession(client, canary);
  await client.query(
    `INSERT INTO continuity.hackathon_provider_usage
      (tenant_id,server_purpose,operation_id,attempt_id,audience,titan_count,nova_count,created_at)
      VALUES ($1,$2,$3,$4,'public',1,0,CURRENT_TIMESTAMP)`,
    [canary.tenantId, purpose, canary.operationId, canary.attemptId],
  );
  await client.query(
    `INSERT INTO continuity.hackathon_provider_reservations
      (tenant_id,server_purpose,step_ordinal,step_name,request_digest,operation_id,attempt_id,
       audience,titan_count,nova_count,reservation_state,reserved_at)
      VALUES ($1,$2,2,'correct',$3,$4,$5,'public',1,0,'reserved',CURRENT_TIMESTAMP)`,
    [canary.tenantId, purpose, canary.requestDigest, canary.operationId, canary.attemptId],
  );
  // Sole fixed-ID exception: the production adapter intentionally accepts only this reviewed
  // synthetic dataset correction. Tenant scoping keeps concurrent canaries disjoint.
  const fact = h2DemoDataset.facts[0];
  if (
    h2DemoDataset.supersede.factId !== "1".repeat(48) ||
    fact?.factId !== h2DemoDataset.supersede.factId ||
    fact.sourceRef !== "e".repeat(48)
  )
    deny("DATASET_STATE_REJECTED");
  await client.query(
    `INSERT INTO continuity.memory_facts
      (tenant_id,server_purpose,fact_id,fact_revision,record_schema_version,record_family,
       requested_purpose,sensitivity,fact_status,content,embedding,embedding_space,source_ref,
       occurred_at,deletion_fence)
      VALUES ($1,$2,$3,1,'zc.internal.memory-fact.v1','memory_fact',$2,'public','active',
        $4,$5::VECTOR,$6,$7,CURRENT_TIMESTAMP,0)`,
    [canary.tenantId, purpose, fact.factId, fact.content, unitVector, titanSpace, fact.sourceRef],
  );
  if (rollback)
    await client.query(
      `INSERT INTO continuity.memory_facts
        (tenant_id,server_purpose,fact_id,fact_revision,record_schema_version,record_family,
         requested_purpose,sensitivity,fact_status,content,embedding,embedding_space,source_ref,
         occurred_at,deletion_fence)
        VALUES ($1,$2,$3,2,'zc.internal.memory-fact.v1','memory_fact',$2,'public','retracted','',
          $4::VECTOR,$5,$6,CURRENT_TIMESTAMP,0)`,
      [canary.tenantId, purpose, fact.factId, zeroVector, titanSpace, fact.sourceRef],
    );
}

async function seed(client, ids) {
  const before = await client.query(
    `SELECT public_sessions, public_titan, public_nova
      FROM continuity.hackathon_usage_summary_v1`,
  );
  if (before.rows.length !== 1) deny("QUOTA_STATE_REJECTED");
  await insertSession(client, ids.expired, true);
  await client.query(
    `INSERT INTO continuity.hackathon_session_usage
      (tenant_id,server_purpose,audience,created_at)
      VALUES ($1,$2,'public',CURRENT_TIMESTAMP - INTERVAL '26 hours')`,
    [ids.expired.tenantId, purpose],
  );
  await client.query(
    `INSERT INTO continuity.hackathon_provider_usage
      (tenant_id,server_purpose,operation_id,attempt_id,audience,titan_count,nova_count,created_at)
      VALUES ($1,$2,$3,$4,'public',1,1,CURRENT_TIMESTAMP - INTERVAL '26 hours')`,
    [ids.expired.tenantId, purpose, ids.expired.operationId, ids.expired.attemptId],
  );
  const after = await client.query(
    `SELECT public_sessions, public_titan, public_nova
      FROM continuity.hackathon_usage_summary_v1`,
  );
  const left = before.rows[0];
  const right = after.rows[0];
  if (
    after.rows.length !== 1 ||
    Number(right?.public_sessions) !== Number(left?.public_sessions) ||
    Number(right?.public_titan) !== Number(left?.public_titan) + 1 ||
    Number(right?.public_nova) !== Number(left?.public_nova) + 1
  )
    deny("ROLLING_QUOTA_REJECTED");
  await insertCorrectionCanary(client, ids.correction, false);
  await insertCorrectionCanary(client, ids.rollback, true);
}

async function provePoolReuse(pool, ids) {
  const first = await pool.connect();
  try {
    await first.query("BEGIN");
    await first.query("SET LOCAL ROLE zc_continuity_executor");
    await first.query("SELECT set_config('continuity.tenant_id', $1, true)", [
      ids.correction.tenantId,
    ]);
    await first.query("SELECT set_config('continuity.server_purpose', $1, true)", [purpose]);
    const cross = await first.query(
      `SELECT fact_id FROM continuity.memory_facts
        WHERE tenant_id=$1 AND server_purpose=$2 AND fact_status='active'`,
      [ids.rollback.tenantId, purpose],
    );
    const wrong = await first.query(
      `SELECT fact_id FROM continuity.memory_facts
        WHERE tenant_id=$1 AND server_purpose=$2 AND fact_status='active'`,
      [ids.correction.tenantId, "hackathon-wrong"],
    );
    if (cross.rows.length !== 0 || wrong.rows.length !== 0) deny("RLS_REJECTED");
    await first.query("COMMIT");
  } finally {
    first.release();
  }
  const second = await pool.connect();
  try {
    if (second !== first) deny("POOL_REUSE_REJECTED");
    const reset = await second.query(`SELECT current_user AS sql_user,
      current_setting('continuity.tenant_id', true) AS tenant_setting,
      current_setting('continuity.server_purpose', true) AS purpose_setting`);
    const row = reset.rows[0];
    if (
      reset.rows.length !== 1 ||
      row?.sql_user !== "continuity_app" ||
      !["", null].includes(row?.tenant_setting) ||
      !["", null].includes(row?.purpose_setting)
    )
      deny("POOL_REUSE_REJECTED");
    await second.query("BEGIN");
    await second.query("SET LOCAL ROLE zc_continuity_executor");
    await second.query("SELECT set_config('continuity.tenant_id', $1, true)", [
      ids.rollback.tenantId,
    ]);
    await second.query("SELECT set_config('continuity.server_purpose', $1, true)", [purpose]);
    try {
      await second.query("SELECT 1 / 0 AS injected_rollback");
      deny("ROLLBACK_PROBE_REJECTED");
    } catch (error) {
      if (error instanceof LiveProbeError) throw error;
    }
    await second.query("ROLLBACK");
    const final = await second.query(`SELECT current_user AS sql_user,
      current_setting('continuity.tenant_id', true) AS tenant_setting,
      current_setting('continuity.server_purpose', true) AS purpose_setting`);
    const finalRow = final.rows[0];
    if (
      final.rows.length !== 1 ||
      finalRow?.sql_user !== "continuity_app" ||
      !["", null].includes(finalRow?.tenant_setting) ||
      !["", null].includes(finalRow?.purpose_setting)
    )
      deny("ROLLBACK_PROBE_REJECTED");
  } finally {
    second.release();
  }
}

async function proveDvi(client, ids) {
  const result = await client.query(`EXPLAIN ${hackathonDviPublicSql}`, [
    ids.correction.tenantId,
    purpose,
    unitVector,
    5,
  ]);
  const plan = result.rows.map((row) => String(row.info ?? "")).join("\n");
  if (result.rows.length < 1 || plan.length > 65_536) deny("DVI_PLAN_REJECTED");
  const lines = plan.split("\n").map((line) => {
    const normalized = line.replace(/\s+/gu, " ").trim().toLowerCase();
    return /^[│├└─ ]*(• .*)$/u.exec(normalized)?.[1] ?? normalized;
  });
  const vectorSearches = lines.flatMap((line, index) =>
    line === "• vector search" ? [index] : [],
  );
  if (vectorSearches.length !== 1) deny("DVI_PLAN_REJECTED");
  const start = vectorSearches[0];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("• "));
  const vectorSearch = lines.slice(start + 1, end === -1 ? undefined : end);
  const indexLines = vectorSearch.filter((line) => /^(?:table|index):/u.test(line));
  if (
    indexLines.length !== 1 ||
    !/^(?:table|index): (?:continuity\.)?memory_facts@memory_facts_titan_scope_l2$/u.test(
      indexLines[0],
    )
  )
    deny("DVI_PLAN_REJECTED");
  const prefix = [ids.correction.tenantId, purpose, titanSpace, "active", "public"]
    .map((value) => `/'${value}'`)
    .join("");
  if (
    !exact(
      vectorSearch.filter((line) => line.startsWith("prefix spans:")),
      [`prefix spans: [${prefix} - ${prefix}]`],
    )
  )
    deny("DVI_PLAN_REJECTED");
  return createHash("sha256").update(plan).digest("hex");
}

function correctionInput(canary) {
  const fact = h2DemoDataset.facts[0];
  return Object.freeze({
    attemptId: canary.attemptId,
    disposition: "supersede",
    expectedRevision: "1",
    factId: h2DemoDataset.supersede.factId,
    operationId: canary.operationId,
    replacement: Object.freeze({
      content: h2DemoDataset.supersede.content,
      embedding: Object.freeze([1, ...Array.from({ length: 1_023 }, () => 0)]),
      sensitivity: "public",
      sourceRef: fact.sourceRef,
    }),
    requestDigest: canary.requestDigest,
    sessionDigest: canary.sessionDigest,
  });
}

async function proveCorrections(connectionString, ids, dependencies) {
  const pools = Array.from({ length: 20 }, () =>
    dependencies.createAppPool(appPoolOptions(connectionString)),
  );
  try {
    const results = await Promise.all(
      pools.map((pool) =>
        dependencies
          .createRepository({ pool, sleep: async () => undefined })
          .correct(correctionInput(ids.correction)),
      ),
    );
    const succeeded = results.filter((result) => result?.outcome === "succeeded").length;
    const replayed = results.filter((result) => result?.outcome === "replayed").length;
    if (succeeded !== 1 || replayed !== 19) deny("CORRECTION_RESULT_REJECTED");
  } finally {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
  }
  const rollbackPool = dependencies.createAppPool(appPoolOptions(connectionString));
  try {
    const result = await dependencies
      .createRepository({ pool: rollbackPool, sleep: async () => undefined })
      .correct(correctionInput(ids.rollback));
    if (["succeeded", "replayed"].includes(result?.outcome)) deny("CORRECTION_ROLLBACK_REJECTED");
  } finally {
    await rollbackPool.end().catch(() => undefined);
  }
}

async function verifyCorrections(client, ids) {
  const success = await client.query(
    `SELECT
    (SELECT count(*)::INT8 FROM continuity.memory_facts WHERE tenant_id=$1 AND server_purpose=$3
      AND fact_id=$4 AND fact_revision=2 AND fact_status='active') AS revision_two,
    (SELECT count(*)::INT8 FROM continuity.memory_propagations WHERE tenant_id=$1
      AND server_purpose=$3 AND fact_id=$4 AND from_revision=1 AND to_revision=2
      AND disposition='supersede') AS propagations,
    (SELECT count(*)::INT8 FROM continuity.hackathon_effect_results WHERE tenant_id=$1
      AND server_purpose=$3 AND step_name='correct') AS effects,
    (SELECT count(*)::INT8 FROM continuity.memory_facts WHERE tenant_id=$2 AND server_purpose=$3
      AND fact_id=$4 AND fact_revision=1 AND fact_status='active') AS rollback_revision_one,
    (SELECT count(*)::INT8 FROM continuity.memory_propagations WHERE tenant_id=$2
      AND server_purpose=$3 AND fact_id=$4) AS rollback_propagations,
    (SELECT count(*)::INT8 FROM continuity.hackathon_effect_results WHERE tenant_id=$2
      AND server_purpose=$3 AND step_name='correct') AS rollback_effects`,
    [ids.correction.tenantId, ids.rollback.tenantId, purpose, h2DemoDataset.supersede.factId],
  );
  const row = success.rows[0];
  if (
    success.rows.length !== 1 ||
    [
      row?.revision_two,
      row?.propagations,
      row?.effects,
      row?.rollback_revision_one,
      row?.rollback_propagations,
      row?.rollback_effects,
    ]
      .map(Number)
      .join(",") !== "1,1,1,1,0,0"
  )
    deny("CORRECTION_POSTSTATE_REJECTED");
}

const defaultDependencies = Object.freeze({
  createAppPool: (options) => new Pool(options),
  createMigratorClient: createMigrationClient,
  createRepository: createHackathonCrdbRepository,
});

export async function runLiveProbe({
  arguments_ = [],
  dependencies = defaultDependencies,
  environment = process.env,
} = {}) {
  if (
    arguments_.length !== 2 ||
    !["--prove", "--cleanup"].includes(arguments_[0]) ||
    !/^[0-9a-f]{64}$/u.test(arguments_[1] ?? "")
  )
    deny("USAGE_REJECTED");
  let migrationUrl;
  try {
    migrationUrl = validateMigrationDatabaseUrl(environment);
  } catch {
    deny("DATABASE_URL_REJECTED");
  }
  const ids = deriveProbeIds(arguments_[1]);
  let migrator;
  let reusePool;
  try {
    migrator = dependencies.createMigratorClient({
      connectionString: migrationUrl,
      connectionTimeoutMillis: 15_000,
    });
    await migrator.connect();
    if (arguments_[0] === "--cleanup") {
      await transaction(migrator, async () => {
        await identity(migrator);
        await cleanup(migrator, ids);
      });
      return Object.freeze({ database: "defaultdb", cleanup: true });
    }
    const appUrl = validateAppUrl(environment);
    let baseline;
    await transaction(
      migrator,
      async () => {
        await identity(migrator);
        await providerPreflight(migrator);
        if (Object.values(await counts(migrator, ids.tenants)).some((value) => value !== 0))
          deny("CANARY_ALREADY_EXISTS");
        baseline = await globalCounts(migrator);
      },
      true,
    );
    await transaction(migrator, () => seed(migrator, ids));
    reusePool = dependencies.createAppPool(appPoolOptions(appUrl));
    await provePoolReuse(reusePool, ids);
    await reusePool.end();
    reusePool = undefined;
    const dviPlanSha256 = await transaction(migrator, () => proveDvi(migrator, ids), true);
    await proveCorrections(appUrl, ids, dependencies);
    await transaction(
      migrator,
      async () => {
        await providerPreflight(migrator);
        await verifyCorrections(migrator, ids);
      },
      true,
    );
    await transaction(migrator, () => cleanup(migrator, ids));
    const finalCounts = await transaction(migrator, () => globalCounts(migrator), true);
    if (!exact(finalCounts, baseline)) deny("BASELINE_POSTSTATE_REJECTED");
    return Object.freeze({
      database: "defaultdb",
      rls: true,
      poolReuse: true,
      rollback: true,
      rollingQuota: true,
      dvi: true,
      dviPlanSha256,
      correctionContenders: 20,
      correctionSucceeded: 1,
      correctionReplayed: 19,
      cleanup: true,
    });
  } catch (error) {
    if (error instanceof LiveProbeError) throw error;
    deny("LIVE_PROBE_DENIED");
  } finally {
    await reusePool?.end().catch(() => undefined);
    await migrator?.end().catch(() => undefined);
  }
}

export const liveProbeTestContract = Object.freeze({
  appPoolOptions,
  fixedFactId: h2DemoDataset.supersede.factId,
  fixedSourceRef: h2DemoDataset.facts[0]?.sourceRef,
  ownedTables,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLiveProbe({ arguments_: process.argv.slice(2) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof LiveProbeError ? error.code : "LIVE_PROBE_DENIED";
      process.stderr.write(`crdb-live-probe: FAIL: ${code}\n`);
      process.exitCode = 1;
    });
}
