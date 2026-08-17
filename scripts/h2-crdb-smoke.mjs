#!/usr/bin/env node
// Synthetic-only CockroachDB proof: scoped executor writes and vector recall.
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromAdapter = createRequire(path.join(root, "packages/adapters-local/package.json"));
const { Client } = requireFromAdapter("pg");
const id = () => randomBytes(24).toString("hex");
const vector = (first) => `[${[first, ...Array(1023).fill(0)].join(",")}]`;

function databaseUrl(name) {
  const value = process.env[name]?.trim() ?? "";
  const url = new URL(value);
  if (
    !value ||
    !/^postgres(?:ql)?:$/u.test(url.protocol) ||
    !/cockroachlabs\.cloud$/iu.test(url.hostname) ||
    !url.username ||
    !url.password ||
    !/^verify-(ca|full)$/iu.test(url.searchParams.get("sslmode") ?? "")
  )
    throw new Error("missing verified CockroachDB URL");
  return value;
}

async function scoped(client, tenantId, purpose, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE zc_continuity_executor");
    await client.query("SELECT set_config('continuity.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('continuity.server_purpose', $1, true)", [purpose]);
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

let migrator;
let app;
try {
  const tenantId = id();
  const purpose = "hackathon-demo";
  const publicFactId = id();
  const restrictedFactId = id();
  const receiptId = id();
  migrator = new Client({ connectionString: databaseUrl("COCKROACH_MIGRATION_DATABASE_URL") });
  app = new Client({ connectionString: databaseUrl("COCKROACH_DATABASE_URL") });
  await migrator.connect();
  await app.connect();
  await migrator.query("INSERT INTO continuity.tenants (tenant_id) VALUES ($1)", [tenantId]);

  const direct = await app.query("SELECT count(*)::int AS count FROM continuity.memory_facts");
  if (Number(direct.rows[0]?.count) !== 0)
    throw new Error("unscoped application access was not denied");

  const recall = await scoped(app, tenantId, purpose, async () => {
    const insert = `INSERT INTO continuity.memory_facts (
      tenant_id, server_purpose, fact_id, fact_revision, record_schema_version, record_family,
      requested_purpose, sensitivity, fact_status, content, embedding, embedding_space, source_ref, occurred_at
    ) VALUES ($1,$2,$3,$4,'zc.internal.memory-fact.v1','memory_fact',$2,$5,'active',$6,$7::vector,
      'zc.synthetic-fixture.v2.1024',$8,now())`;
    await app.query(insert, [
      tenantId,
      purpose,
      publicFactId,
      1,
      "public",
      "synthetic public memory",
      vector(1),
      id(),
    ]);
    await app.query(insert, [
      tenantId,
      purpose,
      restrictedFactId,
      1,
      "restricted",
      "synthetic restricted memory",
      vector(0.5),
      id(),
    ]);
    const result = await app.query(
      `SELECT fact_id, sensitivity
      FROM continuity.memory_facts
      WHERE tenant_id = $1 AND server_purpose = $2 AND fact_status = 'active' AND sensitivity = 'public'
      ORDER BY embedding <=> $3::vector LIMIT 2`,
      [tenantId, purpose, vector(1)],
    );
    await app.query(
      `INSERT INTO continuity.disclosure_receipts (
      tenant_id, server_purpose, receipt_id, record_schema_version, record_family, requested_purpose,
      access_tier, policy_version, embedding_space, recalled_entries, withheld_entries, asked_at
    ) VALUES ($1,$2,$3,'zc.internal.disclosure-receipt.v1','disclosure_receipt',$2,'standard',
      'zc.recall-policy.v1','zc.synthetic-fixture.v2.1024',$4::jsonb,$5::jsonb,now())`,
      [
        tenantId,
        purpose,
        receiptId,
        JSON.stringify([{ fact_id: publicFactId }]),
        JSON.stringify([{ fact_id: restrictedFactId }]),
      ],
    );
    await app.query(
      "UPDATE continuity.memory_facts SET fact_status = 'retracted', content = '', embedding = $4::vector WHERE tenant_id = $1 AND server_purpose = $2 AND fact_id = $3 AND fact_revision = 1",
      [tenantId, purpose, publicFactId, vector(0)],
    );
    await app.query(insert, [
      tenantId,
      purpose,
      publicFactId,
      2,
      "public",
      "synthetic corrected memory",
      vector(1),
      id(),
    ]);
    await app.query(
      `INSERT INTO continuity.memory_propagations (
      tenant_id, server_purpose, fact_id, from_revision, to_revision, record_schema_version,
      record_family, requested_purpose, disposition, occurred_at
    ) VALUES ($1,$2,$3,1,2,'zc.internal.memory-propagation.v1','memory_propagation',$2,'supersede',now())`,
      [tenantId, purpose, publicFactId],
    );
    const corrected = await app.query(
      `SELECT fact_revision::int AS revision, content
      FROM continuity.memory_facts WHERE tenant_id = $1 AND server_purpose = $2 AND fact_id = $3 AND fact_status = 'active'`,
      [tenantId, purpose, publicFactId],
    );
    return { rows: result.rows, corrected: corrected.rows };
  });
  if (
    recall.rows.length !== 1 ||
    recall.rows[0]?.fact_id !== publicFactId ||
    recall.rows[0]?.sensitivity !== "public"
  )
    throw new Error("standard recall did not exclude restricted synthetic memory");
  if (
    recall.corrected.length !== 1 ||
    Number(recall.corrected[0]?.revision) !== 2 ||
    recall.corrected[0]?.content !== "synthetic corrected memory"
  )
    throw new Error("memory correction did not atomically retain revision two");
  const crossPurpose = await scoped(app, tenantId, "other-purpose", async () =>
    app.query("SELECT count(*)::int AS count FROM continuity.memory_facts"),
  );
  if (Number(crossPurpose.rows[0]?.count) !== 0)
    throw new Error("cross-purpose scope was not denied");
  process.stdout.write(
    `${JSON.stringify({
      smoke: "passed",
      syntheticOnly: true,
      vectorIndex: true,
      rls: true,
      receipt: "issued",
      correction: "passed",
    })}\n`,
  );
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "CRDB_SMOKE_DENIED";
  process.stderr.write(`crdb-smoke: FAIL: ${code}\n`);
  process.exitCode = 1;
} finally {
  await app?.end().catch(() => undefined);
  await migrator?.end().catch(() => undefined);
}
