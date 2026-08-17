#!/usr/bin/env node
/**
 * Apply only the pinned Managed MCP reader membership after 0008 through 0010 are already live.
 *
 * The grant is additive and idempotent, so re-running is safe. The script still verifies the
 * resulting membership and, just as importantly, verifies the negatives: the reader must remain
 * NOLOGIN, must not gain SELECT on continuity.memory_facts, and must not gain BYPASSRLS.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createMigrationClient, validateMigrationDatabaseUrl } from "./h2-crdb-apply-0008.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = Object.freeze({
  bytes: 1_165,
  name: "0011_mcp_reader_membership.sql",
  sha256: "3cd33554f42af897cd402ddd1491690058766a2ba71aa5efe6d1a303c5ec33ce",
});

export class Migration0011Error extends Error {
  constructor(code) {
    super(code);
    this.name = "Migration0011Error";
    this.code = code;
  }
}

async function readPinnedMigration() {
  const filename = path.join(root, "database/migrations", pin.name);
  const sql = await readFile(filename, "utf8");
  if (Buffer.byteLength(sql, "utf8") !== pin.bytes) throw new Migration0011Error("bytes");
  if (createHash("sha256").update(sql).digest("hex") !== pin.sha256)
    throw new Migration0011Error("sha256");
  return sql;
}

export async function runMigration0011({ createClient = createMigrationClient } = {}) {
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

  const failures = [];
  // applicable_roles reflects the *connected* user, so membership is read from the catalog instead.
  const member = await client.query(
    `SELECT count(*)::INT8 AS n FROM pg_auth_members m
       JOIN pg_roles grantee ON grantee.oid = m.member
       JOIN pg_roles granted ON granted.oid = m.roleid
      WHERE grantee.rolname = 'continuity_app'
        AND granted.rolname = 'zc_continuity_mcp_reader'`,
  );
  if (member.rows[0]?.n !== "1") failures.push("membership_missing");

  const attributes = await client.query(
    `SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'zc_continuity_mcp_reader'`,
  );
  if (attributes.rows[0]?.rolcanlogin !== false) failures.push("reader_gained_login");
  if (attributes.rows[0]?.rolbypassrls !== false) failures.push("reader_gained_bypassrls");

  const facts = await client.query(
    `SELECT has_table_privilege('zc_continuity_mcp_reader', 'continuity.memory_facts', 'SELECT') AS granted`,
  );
  if (facts.rows[0]?.granted !== false) failures.push("reader_gained_memory_facts");

  await client.end();
  if (failures.length > 0) throw new Migration0011Error(failures.join(","));
  return Object.freeze({ applied: pin.name, verifiedNegatives: 3 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigration0011()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`h2-crdb-apply-0011: FAIL: ${error.code ?? error.message}\n`);
      process.exitCode = 1;
    });
}
