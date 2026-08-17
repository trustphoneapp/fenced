import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Static H2 migration gate — proves 0007 shape without database execution,
// credentials, or network. Live cluster apply remains HG-5.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(repositoryRoot, "database", "migrations");
const migrationName = "0007_agent_memory.sql";
const migrationPath = path.join(migrationRoot, migrationName);

const required = Object.freeze([
  "CREATE TABLE continuity.memory_facts",
  "CREATE TABLE continuity.disclosure_receipts",
  "CREATE TABLE continuity.memory_propagations",
  "embedding VECTOR(1024) NOT NULL",
  "CREATE VECTOR INDEX memory_facts_embedding_cosine",
  "embedding_space IN ('zc.bedrock-titan-v2.1024', 'zc.synthetic-fixture.v2.1024')",
  "fact_status IN ('active', 'retracted')",
  "sensitivity IN ('public', 'restricted')",
  "(fact_status = 'retracted' AND content = '')",
  "to_revision = from_revision + 1",
  "UNIQUE (tenant_id, server_purpose, fact_id, fact_revision, fact_status)",
  "FORCE ROW LEVEL SECURITY",
  "GRANT SELECT ON TABLE continuity.disclosure_receipts TO zc_continuity_reader",
  "GRANT SELECT ON TABLE continuity.memory_propagations TO zc_continuity_reader",
  "GRANT SELECT, INSERT, UPDATE ON TABLE continuity.memory_facts TO zc_continuity_executor",
]);

const forbidden = Object.freeze([
  "zc.local-synthetic-embedding.v1",
  "ON DELETE CASCADE",
  "GRANT DELETE",
  "FOR DELETE",
  "GRANT SELECT ON TABLE continuity.memory_facts TO zc_continuity_reader",
]);

function failure(message) {
  throw new Error(`H2 agent memory failed: ${message}`);
}

export function validateH2AgentMemoryTextForTest(source) {
  if (typeof source !== "string" || source.length === 0 || source.length > 64 * 1024)
    failure("migration text is outside its bound");
  if (
    source.includes("\r") ||
    source.startsWith("\uFEFF") ||
    !source.endsWith("\n") ||
    source.endsWith("\n\n")
  )
    failure("migration framing differs");
  if (!source.startsWith("BEGIN;\n") || !source.endsWith("COMMIT;\n"))
    failure("migration transaction differs");
  for (const statement of required)
    if (!source.includes(statement)) failure(`missing ${statement}`);
  for (const statement of forbidden)
    if (source.includes(statement)) failure(`forbidden ${statement}`);
  if ((source.match(/CREATE TABLE continuity\./gmu) ?? []).length !== 3)
    failure("table inventory differs");
  return true;
}

export async function verifyH2AgentMemory() {
  const listed = (await readdir(migrationRoot)).sort();
  if (!listed.includes(migrationName)) failure("migration missing from list");
  if ((await realpath(migrationPath)) !== migrationPath) failure("path not canonical");
  const listedStat = await lstat(migrationPath, { bigint: true });
  if (
    !listedStat.isFile() ||
    listedStat.isSymbolicLink() ||
    listedStat.nlink !== 1n ||
    (listedStat.mode & 0o777n) !== 0o644n
  )
    failure("migration file shape differs");
  const handle = await open(migrationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    validateH2AgentMemoryTextForTest(text);
    return Object.freeze({
      migration: migrationName,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      tables: Object.freeze(["memory_facts", "disclosure_receipts", "memory_propagations"]),
      claim: "STATIC_SCHEMA_ONLY_NO_DATABASE_EXECUTION",
    });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyH2AgentMemory()
    .then((result) => process.stdout.write(`H2 agent memory PASS: ${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`H2 agent memory FAIL: ${error.message}\n`);
      process.exitCode = 1;
    });
}
