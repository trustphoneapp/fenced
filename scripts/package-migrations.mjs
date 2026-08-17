#!/usr/bin/env node
/**
 * Prints concatenated migrations 0001-0007 to stdout for owner apply.
 * Does not write into the repository (cleanroom forbids undocumented generated packs).
 * Usage:
 *   node scripts/package-migrations.mjs > /tmp/continuity-migrations.sql
 *   cockroach sql --url "$COCKROACH_DATABASE_URL" < /tmp/continuity-migrations.sql
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(root, "database", "migrations");

const names = (await readdir(migrationRoot)).filter((name) => name.endsWith(".sql")).sort();
const expected = [
  "0001_tenant_event_ledger.sql",
  "0002_purpose_qualified_tenant_keys.sql",
  "0003_role_session_isolation.sql",
  "0004_erasable_payload_storage.sql",
  "0005_immutable_event_links.sql",
  "0006_outbox_inbox.sql",
  "0007_agent_memory.sql",
];
if (
  JSON.stringify(names) !==
  JSON.stringify([...expected, "0008_hackathon_live.sql", "0009_hackathon_quota_window.sql"])
) {
  throw new Error(`migration list differs: ${names.join(",")}`);
}

process.stdout.write(`-- Continuity migration pack 0001-0007\n`);
process.stdout.write(`-- Owner applies under HG-5; not a repo artifact\n\n`);
for (const name of expected) {
  const body = await readFile(path.join(migrationRoot, name), "utf8");
  process.stdout.write(`-- ===== ${name} =====\n`);
  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
  process.stdout.write("\n");
}
