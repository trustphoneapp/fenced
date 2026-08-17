import { describe, expect, it } from "vitest";
import {
  createCrdbSqlExecutorHandle,
  createCrdbSqlRecallLedgerPlans,
  mapCrdbFactRow,
} from "../../packages/adapters-local/src/index.js";
import {
  padLocalEmbeddingToPersistent,
  persistentSyntheticEmbeddingSpace,
} from "../../packages/application/src/index.js";

const tenantId = "a".repeat(48);
const purpose = "continuity.memory";
const factId = "1".repeat(48);
const sourceRef = "2".repeat(48);
const scope = {
  accessTier: "standard",
  operation: "memory.teach",
  serverPurpose: purpose,
  tenantId,
};

function embed(text) {
  const vector = new Array(8).fill(0);
  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0);
    if (code >= 97 && code <= 122) vector[(code - 97) % 8] += 1;
  }
  if (vector.every((c) => c === 0)) vector[0] = 1;
  return vector;
}

describe("h2 crdb sql plans", () => {
  it("builds teach/recall/retract SQL without a database", () => {
    const plans = createCrdbSqlRecallLedgerPlans();
    const fact = {
      content: "launch day is monday",
      embedding: embed("launch day is monday"),
      embeddingSpace: "zc.local-synthetic-embedding.v1",
      factId,
      occurredAt: "2026-08-07T00:00:00.000Z",
      revision: "1",
      sensitivity: "public",
      serverPurpose: purpose,
      sourceRef,
      status: "active",
      tenantId,
      recordFamily: "memory_fact",
      recordSchemaVersion: "zc.internal.memory-fact.v1",
    };
    const teach = plans.teachInsert(fact, scope);
    expect(teach.outcome).toBe("sql");
    expect(teach.sql).toContain("INSERT INTO continuity.memory_facts");
    expect(teach.params[6]).toBe(persistentSyntheticEmbeddingSpace);

    const recall = plans.recallSelect(scope, embed("launch day"), 4);
    expect(recall.outcome).toBe("sql");
    expect(recall.sql).toContain("DISTINCT ON (fact_id)");
    expect(recall.sql).toContain("fact_status = 'active'");
    expect(recall.sql).toContain("sensitivity = 'public'");
    expect(recall.params[2]).toBe(false);
    expect(recall.sql).toContain("ORDER BY embedding <=>");
    expect(plans.recallSelect({ ...scope, accessTier: undefined }, embed("launch day"), 4)).toEqual(
      { outcome: "denied" },
    );
    expect(
      plans.recallSelect({ ...scope, accessTier: "privileged" }, embed("launch day"), 4).params[2],
    ).toBe(true);
    expect(
      plans.supersedeDeactivatePrior(
        {
          disposition: "supersede",
          expectedRevision: "1",
          factId,
          occurredAt: "2026-08-07T01:00:00.000Z",
          replacement: {
            content: "x",
            embedding: embed("x"),
            sensitivity: "public",
            sourceRef,
          },
        },
        scope,
      ).sql,
    ).toContain("fact_revision = $4");

    const retract = plans.retractUpdate(
      {
        disposition: "retract",
        expectedRevision: "1",
        factId,
        occurredAt: "2026-08-07T01:00:00.000Z",
      },
      scope,
    );
    expect(retract.sql).toContain("fact_status = 'retracted'");
    expect(retract.sql).toContain("current.fact_revision = $4");
    // CockroachDB has no array_fill(); the zero vector is built with generate_series instead.
    expect(retract.sql).toContain("ARRAY(SELECT 0::float8 FROM generate_series(1, 1024))::vector");
    const supersede = {
      disposition: "supersede",
      expectedRevision: "1",
      factId,
      occurredAt: "2026-08-07T01:00:00.000Z",
      replacement: { content: "x", embedding: embed("x"), sensitivity: "public", sourceRef },
    };
    expect(plans.supersedeInsert(supersede, scope, "2")).toEqual({ outcome: "denied" });
    expect(plans.propagationInsert(supersede, scope, "1", "3")).toEqual({ outcome: "denied" });
    expect(plans.supersedeInsert({ ...supersede, expectedRevision: "bad" }, scope, "bad")).toEqual({
      outcome: "denied",
    });
    expect(
      plans.supersedeInsert(
        { ...supersede, expectedRevision: "18446744073709551615" },
        scope,
        "18446744073709551615",
      ),
    ).toEqual({ outcome: "denied" });
  });

  it("maps padded CRDB rows back to local 8-d facts", () => {
    const local = embed("launch day is sunday");
    const padded = padLocalEmbeddingToPersistent(local);
    const fact = mapCrdbFactRow({
      fact_id: factId,
      fact_revision: "2",
      content: "launch day is sunday",
      sensitivity: "public",
      fact_status: "active",
      server_purpose: purpose,
      tenant_id: tenantId,
      source_ref: sourceRef,
      occurred_at: "2026-08-07T00:00:00.000Z",
      embedding_space: persistentSyntheticEmbeddingSpace,
      embedding: padded.embedding,
    });
    expect(fact).toMatchObject({ revision: "2", content: "launch day is sunday" });
    expect(fact.embedding).toEqual(local);
  });

  it("executor handle stays fail-closed without HG-5 driver", () => {
    expect(createCrdbSqlExecutorHandle({}).status.reason).toBe("missing_database_url");
    expect(
      createCrdbSqlExecutorHandle({
        COCKROACH_DATABASE_URL: "postgresql://example.invalid/db",
      }).status.reason,
    ).toBe("human_gate_pending");
  });
});
