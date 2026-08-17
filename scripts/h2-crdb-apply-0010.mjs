#!/usr/bin/env node
/**
 * Apply only the pinned foreign-key read grants after 0008 and 0009 are already live.
 *
 * CockroachDB validates foreign keys inside the writing statement's query plan, so the session and
 * reservation roles need SELECT on the parents they reference. The grants are additive and
 * idempotent, so re-running is safe; the script still verifies the resulting grant set.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createMigrationClient, validateMigrationDatabaseUrl } from "./h2-crdb-apply-0008.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = Object.freeze({
  bytes: 1_207,
  name: "0010_hackathon_fk_read_grants.sql",
  sha256: "76db004d3aae42b9a788e39c6aba786d9587e2afde9c532b967e5bc8095265e6",
});

/** parent relation -> roles that must hold SELECT on it after this migration. */
const expectedGrants = Object.freeze([
  Object.freeze({ relation: "tenants", role: "zc_continuity_session_issuer" }),
  Object.freeze({ relation: "hackathon_provider_usage", role: "zc_continuity_session_issuer" }),
  Object.freeze({ relation: "hackathon_provider_usage", role: "zc_continuity_reservation_writer" }),
]);

export class Migration0010Error extends Error {
  constructor(code) {
    super(code);
    this.name = "Migration0010Error";
    this.code = code;
  }
}

async function readPinnedMigration() {
  const filename = path.join(root, "database/migrations", pin.name);
  const sql = await readFile(filename, "utf8");
  const bytes = Buffer.byteLength(sql, "utf8");
  if (bytes !== pin.bytes) throw new Migration0010Error("migration_0010_bytes");
  if (createHash("sha256").update(sql).digest("hex") !== pin.sha256)
    throw new Migration0010Error("migration_0010_sha256");
  return sql;
}

export async function runMigration0010({ createClient = createMigrationClient } = {}) {
  const url = validateMigrationDatabaseUrl();
  const sql = await readPinnedMigration();
  const client = createClient({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  }

  const missing = [];
  for (const { relation, role } of expectedGrants) {
    const result = await client.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS granted`, [
      role,
      `continuity.${relation}`,
    ]);
    if (result.rows[0]?.granted !== true) missing.push(`${role}:${relation}`);
  }
  await client.end();
  if (missing.length > 0) throw new Migration0010Error(`missing_grants:${missing.join(",")}`);
  return Object.freeze({ applied: pin.name, verified: expectedGrants.length });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigration0010()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`h2-crdb-apply-0010: FAIL: ${error.code ?? error.message}\n`);
      process.exitCode = 1;
    });
}
