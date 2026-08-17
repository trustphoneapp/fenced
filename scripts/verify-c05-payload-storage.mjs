import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  repositoryRoot,
  "database/migrations/0004_erasable_payload_storage.sql",
);
const maxBytes = 64 * 1024;
const canonicalSha256 = "a99700c2d59500c4fe97a8d67b7a1333e935f89a7aa6bf5bbfc43783179dc279";
const tables = Object.freeze([
  "payload_key_anchors",
  "payload_revision_material",
  "payload_wrapped_keys",
  "payload_superseded_wrapped_keys",
]);
const boundColumns = Object.freeze([
  "tenant_id",
  "server_purpose",
  "payload_ref",
  "payload_revision",
  "requested_purpose",
  "key_scope_id",
  "sensitivity_class",
  "crypto_domain_version",
  "retention_origin_created_at",
  "retention_expires_at",
]);
const payloadAnchorBinding = `FOREIGN KEY (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)
    REFERENCES continuity.payload_anchors (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)`;
const keyAnchorBinding = `FOREIGN KEY (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) REFERENCES continuity.payload_key_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  )`;

const occurrences = (source, pattern) => source.match(pattern)?.length ?? 0;
const requireText = (source, text) => {
  if (!source.includes(text)) throw new Error(`C05 migration is missing: ${text}`);
};
const normalized = (statement) => statement.replace(/\s+/gu, " ").trim();

function executableStatements(sql) {
  const statements = [];
  let quote = "";
  let start = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (current === quote) {
        if (next === quote) index += 1;
        else quote = "";
      }
    } else if (current === "'" || current === '"') {
      quote = current;
    } else if (current === ";") {
      const statement = normalized(sql.slice(start, index + 1));
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (quote || sql.slice(start).trim())
    throw new Error("C05 migration has an unterminated executable statement");
  return statements;
}

function executableSql(source) {
  let blockDepth = 0;
  let quote = "";
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (blockDepth > 0) {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        result += "  ";
        index += 1;
      } else if (current === "*" && next === "/") {
        blockDepth -= 1;
        result += "  ";
        index += 1;
      } else {
        result += current === "\n" ? "\n" : " ";
      }
    } else if (quote) {
      result += current;
      if (current === quote) {
        if (next === quote) {
          result += next;
          index += 1;
        } else {
          quote = "";
        }
      }
    } else if (current === "'" || current === '"') {
      quote = current;
      result += current;
    } else if (current === "-" && next === "-") {
      result += "  ";
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n") {
        result += " ";
        index += 1;
      }
    } else if (current === "/" && next === "*") {
      blockDepth = 1;
      result += "  ";
      index += 1;
    } else {
      result += current;
    }
  }
  if (blockDepth > 0 || quote) throw new Error("C05 migration has unterminated SQL syntax");
  return result;
}

export function validateC05PayloadStorageTextForTest(source) {
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    source.length > maxBytes ||
    source.includes("\r") ||
    source.startsWith("\uFEFF") ||
    !source.endsWith("\n") ||
    source.endsWith("\n\n")
  )
    throw new Error("C05 migration has invalid size or framing");
  const sql = executableSql(source);
  if (!sql.startsWith("BEGIN;\n\n") || !sql.endsWith("\nCOMMIT;\n"))
    throw new Error("C05 migration is not one transaction");
  if (/\b(?:CASCADE|SET\s+NULL|GRANT|CREATE\s+POLICY|NO\s+FORCE)\b/iu.test(sql))
    throw new Error("C05 migration contains forbidden authority or delete behavior");
  const statements = executableStatements(sql);
  if (occurrences(sql, /^ALTER\s+TABLE\b/gimu) !== tables.length * 2)
    throw new Error("C05 migration contains an unexpected ALTER TABLE statement");
  const expectedAlterTables = tables
    .flatMap((table) =>
      ["ENABLE", "FORCE"].map(
        (action) => `ALTER TABLE continuity.${table} ${action} ROW LEVEL SECURITY;`,
      ),
    )
    .sort();
  const actualAlterTables = statements
    .filter((statement) => /^ALTER\s+TABLE\b/iu.test(statement))
    .sort();
  if (JSON.stringify(actualAlterTables) !== JSON.stringify(expectedAlterTables))
    throw new Error("C05 migration ALTER TABLE statements differ from the exact RLS set");
  const expectedRevokes = tables
    .map((table) => `REVOKE ALL PRIVILEGES ON TABLE continuity.${table} FROM PUBLIC;`)
    .sort();
  const actualRevokes = statements.filter((statement) => /^REVOKE\b/iu.test(statement)).sort();
  const statementTables = statements.flatMap((statement) => {
    const match = statement.match(
      /^CREATE\s+TABLE\s+(?:"continuity"|continuity)\.(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))\s+\(.+\);$/iu,
    );
    return match ? [(match[1] ?? match[2]).toLowerCase()] : [];
  });
  const recognizedStatements =
    2 + expectedAlterTables.length + expectedRevokes.length + statementTables.length;
  if (
    statements[0] !== "BEGIN;" ||
    statements.at(-1) !== "COMMIT;" ||
    JSON.stringify(actualRevokes) !== JSON.stringify(expectedRevokes) ||
    JSON.stringify(statementTables) !== JSON.stringify(tables) ||
    statements.length !== recognizedStatements
  )
    throw new Error("C05 migration executable statement inventory differs");

  const createdMatches = Array.from(
    sql.matchAll(
      /^CREATE\s+TABLE\s+(?:"continuity"|continuity)\.(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))\s+\($/gimu,
    ),
  );
  const created = createdMatches.map((match) => (match[1] ?? match[2]).toLowerCase());
  if (
    occurrences(sql, /\bCREATE\s+TABLE\b/giu) !== tables.length ||
    JSON.stringify(created) !== JSON.stringify(tables)
  )
    throw new Error("C05 migration table set or order differs");

  const tableSql = new Map(
    createdMatches.map((match, index) => [
      created[index],
      sql.slice(match.index, createdMatches[index + 1]?.index ?? sql.length),
    ]),
  );
  const anchor = tableSql.get("payload_key_anchors");
  if (
    /\b(?:BYTES|ciphertext|nonce_96|tag_128|wrapped_dek|[a-z0-9_]*locator[a-z0-9_]*)\b/iu.test(
      anchor,
    )
  )
    throw new Error("C05 content-free key anchor contains sensitive material");
  if (/\b(?:plaintext|digest|fingerprint|equality_token|content_(?:hash|digest))\b/iu.test(sql))
    throw new Error("C05 migration contains forbidden plaintext or content-derived material");

  for (const text of [
    "CHECK (sensitivity_class = 'synthetic')",
    "CHECK (retention_expires_at <= retention_origin_created_at + INTERVAL '24 hours')",
    "UNIQUE (tenant_id, server_purpose, key_scope_id)",
    "CHECK (envelope_format_version = 1)",
    "CHECK (aead_algorithm = 'AES-256-GCM')",
    "nonce_96 BYTES NOT NULL CHECK (length(nonce_96) = 12)",
    "ciphertext BYTES NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 65536)",
    "tag_128 BYTES NOT NULL CHECK (length(tag_128) = 16)",
    "wrapped_dek BYTES NOT NULL CHECK (length(wrapped_dek) BETWEEN 1 AND 4096)",
    "CHECK (expires_at = retention_expires_at)",
    "ON DELETE RESTRICT ON UPDATE RESTRICT",
  ])
    requireText(sql, text);

  if (
    occurrences(
      sql,
      new RegExp(payloadAnchorBinding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"),
    ) !== 1
  )
    throw new Error("C05 key anchor must bind the exact payload anchor revision");
  for (const name of ["payload_revision_material", "payload_wrapped_keys"])
    for (const check of [
      /CHECK \(created_at >= retention_origin_created_at\)/gu,
      /CHECK \(created_at < expires_at\)/gu,
    ])
      if (occurrences(tableSql.get(name), check) !== 1)
        throw new Error(`C05 ${name} must bind creation within the retention window`);
  if (
    occurrences(
      tableSql.get("payload_superseded_wrapped_keys"),
      /CHECK \(superseded_at >= retention_origin_created_at\)/gu,
    ) !== 1
  )
    throw new Error("C05 superseded key material must bind supersession to the retention origin");
  if (
    occurrences(
      tableSql.get("payload_superseded_wrapped_keys"),
      /CHECK \(superseded_at < expires_at\)/gu,
    ) !== 1
  )
    throw new Error("C05 superseded key material must precede expiry");

  for (const column of boundColumns)
    if (occurrences(sql, new RegExp(`^  ${column} `, "gmu")) !== 4)
      throw new Error(`C05 tables must bind ${column} exactly once each`);
  if (
    occurrences(sql, new RegExp(keyAnchorBinding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")) !==
    3
  )
    throw new Error("C05 material rows must bind the stable key anchor");
  if (occurrences(sql, /CHECK \(sensitivity_class = 'synthetic'\)/gu) !== 4)
    throw new Error("C05 tables must remain synthetic-only");
  if (occurrences(sql, /ON DELETE RESTRICT ON UPDATE RESTRICT/gu) !== 4)
    throw new Error("C05 foreign keys must remain restrictive");
  if (occurrences(sql, /^REVOKE ALL PRIVILEGES ON TABLE continuity\./gmu) !== 4)
    throw new Error("C05 tables must revoke PUBLIC access");
  if (occurrences(sql, / (?:ENABLE|FORCE) ROW LEVEL SECURITY;/gu) !== 8)
    throw new Error("C05 tables must enable and force RLS");
  if (occurrences(sql, /CHECK \(expires_at = retention_expires_at\)/gu) !== 3)
    throw new Error("C05 material expiry must bind the fixed revision expiry");
  if (createHash("sha256").update(source, "utf8").digest("hex") !== canonicalSha256)
    throw new Error("C05 migration differs from the exact canonical bytes");
  return true;
}

export function validateC05PayloadStorageBytesForTest(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes)
    throw new Error("C05 migration bytes are outside their bound");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    throw new Error("C05 migration bytes contain a UTF-8 BOM");
  if (createHash("sha256").update(bytes).digest("hex") !== canonicalSha256)
    throw new Error("C05 migration raw bytes differ from the exact canonical bytes");
  validateC05PayloadStorageTextForTest(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return true;
}

const snapshot = (stat) =>
  Object.freeze({
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    mtimeNs: stat.mtimeNs,
    nlink: stat.nlink,
    size: stat.size,
  });
const sameSnapshot = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;
const samePathChain = (left, right) =>
  left.length === right.length &&
  left.every(
    (entry, index) =>
      entry.path === right[index].path &&
      entry.type === right[index].type &&
      sameSnapshot(entry.stat, right[index].stat),
  );

function assertExactFile(stat, label) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    (stat.mode & 0o777n) !== 0o644n ||
    stat.size < 1n ||
    stat.size > BigInt(maxBytes)
  )
    throw new Error(`${label} is not a bounded singly-linked mode-0644 file`);
}

async function canonicalPathChain(filePath, label, targetFile) {
  const relative = path.relative(repositoryRoot, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`${label} is outside the repository root`);
  const components = [repositoryRoot];
  let current = repositoryRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    components.push(current);
  }
  const chain = [];
  for (const [index, component] of components.entries()) {
    const stat = await lstat(component, { bigint: true });
    const final = index === components.length - 1;
    const type = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
    if (
      stat.isSymbolicLink() ||
      (await realpath(component)) !== component ||
      (!final && type !== "directory") ||
      (final && type !== (targetFile ? "file" : "directory"))
    )
      throw new Error(`${label} has a non-canonical path component`);
    chain.push(Object.freeze({ path: component, stat: snapshot(stat), type }));
  }
  return Object.freeze(chain);
}

async function pathnameSnapshot(filePath, label, file = true) {
  const chain = await canonicalPathChain(filePath, label, file);
  const target = chain.at(-1);
  if (file) {
    const stat = await lstat(filePath, { bigint: true });
    assertExactFile(stat, label);
    if (!sameSnapshot(target.stat, snapshot(stat)))
      throw new Error(`${label} changed during pathname inspection`);
  }
  return Object.freeze({ chain, path: target.path, stat: target.stat });
}

async function readMigrationBytesAtPath(filePath, testHook) {
  const label = "C05 migration";
  const listed = await pathnameSnapshot(filePath, label);
  const parentPath = path.dirname(filePath);
  const parent = await pathnameSnapshot(parentPath, label, false);
  await testHook?.("after-list");
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    assertExactFile(before, label);
    if (!sameSnapshot(listed.stat, snapshot(before)))
      throw new Error("C05 migration changed before guarded read");
    const bytes = await handle.readFile();
    await testHook?.("after-read");
    const after = await handle.stat({ bigint: true });
    assertExactFile(after, label);
    if (!sameSnapshot(snapshot(before), snapshot(after)) || BigInt(bytes.length) !== after.size)
      throw new Error("C05 migration changed during verification");
    const listedAfter = await pathnameSnapshot(filePath, label);
    const parentAfter = await pathnameSnapshot(parentPath, label, false);
    if (
      listedAfter.path !== listed.path ||
      !sameSnapshot(listedAfter.stat, snapshot(after)) ||
      !samePathChain(listedAfter.chain, listed.chain) ||
      parentAfter.path !== parent.path ||
      !sameSnapshot(parentAfter.stat, parent.stat) ||
      !samePathChain(parentAfter.chain, parent.chain)
    )
      throw new Error("C05 migration pathname changed during verification");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readC05MigrationBytesAtPathForTest(candidate, testHook) {
  if (typeof testHook !== "function") throw new Error("C05 guarded-read hook must be a function");
  return readMigrationBytesAtPath(candidate, testHook);
}

export async function verifyC05PayloadStorage() {
  validateC05PayloadStorageBytesForTest(await readMigrationBytesAtPath(migrationPath));
  return Object.freeze({ migration: path.basename(migrationPath), tables });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyC05PayloadStorage()
    .then(({ migration, tables: verified }) =>
      process.stdout.write(`C05 payload storage PASS: ${migration} (${verified.join(", ")})\n`),
    )
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "C05 verification failed"}\n`,
      );
      process.exitCode = 1;
    });
}
