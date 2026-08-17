#!/usr/bin/env node
/** Inspect or change only the synthetic hackathon provider kill switch. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createMigrationClient, validateMigrationDatabaseUrl } from "./h2-crdb-apply-0008.mjs";
import { classifyQuotaViewDefinition } from "./h2-crdb-apply-0009.mjs";

const expectedCaps = Object.freeze({
  absoluteNova: 300,
  absoluteTitan: 800,
  engineeringNova: 100,
  engineeringTitan: 200,
  publicNova: 200,
  publicSessions: 100,
  publicTitan: 600,
});

export class ProviderControlError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const deny = (code) => {
  throw new ProviderControlError(code);
};
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const count = (value) => {
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) deny("CONTROL_STATE_REJECTED");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) deny("CONTROL_STATE_REJECTED");
  return parsed;
};

function command(arguments_) {
  if (exact(arguments_, ["--status"])) return "status";
  if (exact(arguments_, ["--enable", "--confirm-synthetic-only"])) return "enable";
  if (exact(arguments_, ["--disable"])) return "disable";
  deny("USAGE_REJECTED");
}

async function inspectIdentity(client) {
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

async function inspectControl(client, lock = false) {
  const result = await client.query(`SELECT control_id, provider_enabled, public_session_cap,
    public_titan_cap, public_nova_cap, engineering_titan_cap, engineering_nova_cap,
    absolute_titan_cap, absolute_nova_cap FROM continuity.hackathon_runtime_control${
      lock ? " FOR UPDATE" : ""
    }`);
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row?.control_id !== "live-v1" ||
    typeof row.provider_enabled !== "boolean"
  )
    deny("CONTROL_STATE_REJECTED");
  const caps = Object.freeze({
    absoluteNova: count(row.absolute_nova_cap),
    absoluteTitan: count(row.absolute_titan_cap),
    engineeringNova: count(row.engineering_nova_cap),
    engineeringTitan: count(row.engineering_titan_cap),
    publicNova: count(row.public_nova_cap),
    publicSessions: count(row.public_session_cap),
    publicTitan: count(row.public_titan_cap),
  });
  if (!exact(caps, expectedCaps)) deny("CONTROL_STATE_REJECTED");
  return Object.freeze({ caps, providerEnabled: row.provider_enabled });
}

async function inspectUsage(client) {
  const definition = await client.query(`SELECT view_definition FROM information_schema.views
    WHERE table_schema = 'continuity' AND table_name = 'hackathon_usage_summary_v1'`);
  try {
    if (
      definition.rows.length !== 1 ||
      classifyQuotaViewDefinition(definition.rows[0]?.view_definition) !== "applied"
    )
      deny("QUOTA_VIEW_REJECTED");
  } catch {
    deny("QUOTA_VIEW_REJECTED");
  }
  const result = await client.query(`SELECT public_sessions, public_titan, public_nova,
    engineering_titan, engineering_nova FROM continuity.hackathon_usage_summary_v1`);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) deny("QUOTA_STATE_REJECTED");
  return Object.freeze({
    engineeringNova: count(row.engineering_nova),
    engineeringTitan: count(row.engineering_titan),
    publicNova: count(row.public_nova),
    publicSessions: count(row.public_sessions),
    publicTitan: count(row.public_titan),
  });
}

function requireHeadroom(usage, caps) {
  if (
    usage.publicSessions >= caps.publicSessions ||
    usage.publicTitan >= caps.publicTitan ||
    usage.publicNova >= caps.publicNova ||
    usage.engineeringTitan >= caps.engineeringTitan ||
    usage.engineeringNova >= caps.engineeringNova ||
    usage.publicTitan + usage.engineeringTitan >= caps.absoluteTitan ||
    usage.publicNova + usage.engineeringNova >= caps.absoluteNova
  )
    deny("QUOTA_EXHAUSTED");
}

export async function runProviderControl({
  arguments_ = [],
  createClient = createMigrationClient,
  environment = process.env,
} = {}) {
  const operation = command(arguments_);
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
    if (operation === "status") await client.query("SET TRANSACTION READ ONLY");
    await inspectIdentity(client);
    const before = await inspectControl(client, operation !== "status");
    let changed = false;
    if (operation === "enable") {
      if (before.providerEnabled) deny("PROVIDER_STATE_REJECTED");
      const usage = await inspectUsage(client);
      requireHeadroom(usage, before.caps);
      const update = await client.query(`UPDATE continuity.hackathon_runtime_control
        SET provider_enabled = true WHERE control_id = 'live-v1' AND provider_enabled = false`);
      if (update.rowCount !== 1) deny("CONTROL_UPDATE_REJECTED");
      const after = await inspectControl(client);
      const finalUsage = await inspectUsage(client);
      if (!after.providerEnabled || !exact(after.caps, before.caps) || !exact(finalUsage, usage))
        deny("CONTROL_POSTSTATE_REJECTED");
      changed = true;
    } else if (operation === "disable") {
      const update = await client.query(`UPDATE continuity.hackathon_runtime_control
        SET provider_enabled = false WHERE control_id = 'live-v1' AND provider_enabled = true`);
      changed = before.providerEnabled;
      if (update.rowCount !== (changed ? 1 : 0)) deny("CONTROL_UPDATE_REJECTED");
      const after = await inspectControl(client);
      if (after.providerEnabled || !exact(after.caps, before.caps))
        deny("CONTROL_POSTSTATE_REJECTED");
    }
    await client.query("COMMIT");
    transaction = false;
    return Object.freeze({
      database: "defaultdb",
      providerEnabled:
        operation === "enable" ? true : operation === "disable" ? false : before.providerEnabled,
      changed,
    });
  } catch (error) {
    if (transaction) await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ProviderControlError) throw error;
    deny("PROVIDER_CONTROL_DENIED");
  } finally {
    await client?.end().catch(() => undefined);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runProviderControl({ arguments_: process.argv.slice(2) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof ProviderControlError ? error.code : "PROVIDER_CONTROL_DENIED";
      process.stderr.write(`crdb-provider-control: FAIL: ${code}\n`);
      process.exitCode = 1;
    });
}
