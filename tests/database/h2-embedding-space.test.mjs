import { describe, expect, it } from "vitest";
import {
  createH2RecallLedgerCrdbStub,
  createLocalH1RecallLedgerRepository,
  h2DemoDataset,
} from "../../packages/adapters-local/src/index.js";
import {
  createRecallLedgerService,
  padLocalEmbeddingToPersistent,
  persistentEmbeddingDimension,
  persistentSyntheticEmbeddingSpace,
  recallEmbeddingDimension,
  unwrapPersistentSyntheticEmbedding,
} from "../../packages/application/src/index.js";

function embed(text) {
  const vector = new Array(8).fill(0);
  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0);
    if (code >= 97 && code <= 122) vector[(code - 97) % 8] += 1;
  }
  if (vector.every((component) => component === 0)) vector[0] = 1;
  return vector;
}

describe("h2 embedding space and crdb stub", () => {
  it("pads local 8-d embeddings to 1024-d synthetic fixture space", () => {
    const local = embed("launch day is monday");
    const padded = padLocalEmbeddingToPersistent(local);
    expect(padded.outcome).toBe("padded");
    expect(padded.embedding).toHaveLength(persistentEmbeddingDimension);
    expect(padded.embeddingSpace).toBe(persistentSyntheticEmbeddingSpace);
    expect(padded.embedding.slice(0, recallEmbeddingDimension)).toEqual(local);
    expect(padded.embedding.slice(recallEmbeddingDimension).every((n) => n === 0)).toBe(true);
    expect(unwrapPersistentSyntheticEmbedding(padded.embedding, padded.embeddingSpace)).toEqual(
      local,
    );
  });

  it("denies wrong-length or zero-norm embeddings", () => {
    expect(padLocalEmbeddingToPersistent([1, 2, 3])).toEqual({ outcome: "denied" });
    expect(padLocalEmbeddingToPersistent(new Array(8).fill(0))).toEqual({ outcome: "denied" });
    expect(padLocalEmbeddingToPersistent(embed("x"), "zc.other.space")).toEqual({
      outcome: "denied",
    });
  });

  it("preserves cosine ranking after padding", () => {
    const a = embed("launch plan august");
    const b = embed("launch plan sunday");
    const c = embed("unrelated weather report");
    const pa = padLocalEmbeddingToPersistent(a);
    const pb = padLocalEmbeddingToPersistent(b);
    const pc = padLocalEmbeddingToPersistent(c);
    const cosine = (x, y) => {
      let dot = 0;
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < x.length; i += 1) {
        dot += x[i] * y[i];
        nx += x[i] * x[i];
        ny += y[i] * y[i];
      }
      return dot / (Math.sqrt(nx) * Math.sqrt(ny));
    };
    expect(cosine(pa.embedding, pb.embedding)).toBeCloseTo(cosine(a, b), 10);
    expect(cosine(pa.embedding, pc.embedding)).toBeCloseTo(cosine(a, c), 10);
  });

  it("crdb stub is fail-closed without DATABASE_URL and never discloses", () => {
    const handle = createH2RecallLedgerCrdbStub({});
    expect(handle.status).toEqual({ configured: false, reason: "missing_database_url" });
    const service = createRecallLedgerService(
      {
        validate: () => ({
          context: {
            operation: "memory.teach",
            purpose: "continuity.memory",
            tenantId: "a".repeat(48),
            workload: { capability: "continuity.memory.teach" },
          },
          outcome: "issued",
        }),
      },
      handle.repository,
    );
    expect(
      service.teach(
        {},
        {
          content: "should never persist",
          embedding: embed("should never persist"),
          factId: "1".repeat(48),
          occurredAt: "2026-08-07T00:00:00.000Z",
          sensitivity: "public",
          sourceRef: "2".repeat(48),
        },
        1,
      ),
    ).toEqual({ outcome: "denied" });
  });

  it("crdb stub stays fail-closed when URL present without HG-5", () => {
    const handle = createH2RecallLedgerCrdbStub({
      COCKROACH_DATABASE_URL: "postgresql://example.invalid/continuity",
    });
    expect(handle.status.configured).toBe(false);
    expect(handle.status.reason).toBe("human_gate_pending");
  });

  it("demo dataset loads into local recall ledger and supports the demo beat", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = createRecallLedgerService(
      {
        validate: () => ({
          context: {
            operation: "memory.teach",
            purpose: h2DemoDataset.purpose,
            tenantId: h2DemoDataset.tenantId,
            workload: { capability: "continuity.memory.teach" },
          },
          outcome: "issued",
        }),
      },
      repository,
    );
    const ask = createRecallLedgerService(
      {
        validate: () => ({
          context: {
            operation: "memory.ask",
            purpose: h2DemoDataset.purpose,
            tenantId: h2DemoDataset.tenantId,
            workload: { accessTier: "standard", capability: "continuity.memory.ask" },
          },
          outcome: "issued",
        }),
      },
      repository,
    );
    const correct = createRecallLedgerService(
      {
        validate: () => ({
          context: {
            operation: "memory.correct",
            purpose: h2DemoDataset.purpose,
            tenantId: h2DemoDataset.tenantId,
            workload: { capability: "continuity.memory.correct" },
          },
          outcome: "issued",
        }),
      },
      repository,
    );

    for (const fact of h2DemoDataset.facts) {
      expect(
        teach.teach(
          {},
          {
            content: fact.content,
            embedding: embed(fact.content),
            factId: fact.factId,
            occurredAt: "2026-08-07T00:00:00.000Z",
            sensitivity: fact.sensitivity,
            sourceRef: fact.sourceRef,
          },
          1,
        ),
      ).toMatchObject({ outcome: "recorded" });
    }

    const firstAsk = ask.ask(
      {},
      {
        askedAt: "2026-08-07T01:00:00.000Z",
        embedding: embed("what is the launch day and budget"),
        topK: 4,
      },
      1,
    );
    expect(firstAsk.outcome).toBe("answered");
    expect(firstAsk.receipt.withheld.some((entry) => entry.reason === "sensitivity_policy")).toBe(
      true,
    );
    expect(JSON.stringify(firstAsk.receipt)).not.toContain("budget ceiling");

    expect(
      correct.correct(
        {},
        {
          disposition: "supersede",
          expectedRevision: "1",
          factId: h2DemoDataset.supersede.factId,
          occurredAt: "2026-08-07T02:00:00.000Z",
          replacement: {
            content: h2DemoDataset.supersede.content,
            embedding: embed(h2DemoDataset.supersede.content),
            sensitivity: "public",
            sourceRef: h2DemoDataset.facts[0].sourceRef,
          },
        },
        1,
      ),
    ).toMatchObject({ outcome: "corrected", propagation: { toRevision: "2" } });

    const secondAsk = ask.ask(
      {},
      {
        askedAt: "2026-08-07T03:00:00.000Z",
        embedding: embed("when is launch day"),
        topK: 4,
      },
      1,
    );
    expect(secondAsk.disclosed.some((entry) => entry.content.includes("sunday"))).toBe(true);
  });
});
