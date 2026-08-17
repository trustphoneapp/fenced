import { describe, expect, it } from "vitest";
import {
  createLocalH1RecallLedgerRepository,
  createLocalMcpReceiptTools,
  h2DemoDataset,
} from "../../packages/adapters-local/src/index.js";
import {
  answerFromMemoryAsk,
  createFailClosedBedrockPorts,
  createRecallLedgerService,
} from "../../packages/application/src/index.js";

function embed(text) {
  const vector = new Array(8).fill(0);
  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0);
    if (code >= 97 && code <= 122) vector[(code - 97) % 8] += 1;
  }
  if (vector.every((c) => c === 0)) vector[0] = 1;
  return vector;
}

function service(operation, repository, accessTier) {
  return createRecallLedgerService(
    {
      validate: () => ({
        context: {
          operation,
          purpose: h2DemoDataset.purpose,
          tenantId: h2DemoDataset.tenantId,
          workload:
            operation === "memory.ask"
              ? { accessTier: accessTier ?? "standard", capability: `continuity.${operation}` }
              : { capability: `continuity.${operation}` },
        },
        outcome: "issued",
      }),
    },
    repository,
  );
}

describe("h3 demo agent and h5 mcp receipt tools", () => {
  it("composes answers only from disclosed facts and never from withheld", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, "standard");
    for (const fact of h2DemoDataset.facts) {
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
      );
    }
    const asked = ask.ask(
      {},
      {
        askedAt: "2026-08-07T01:00:00.000Z",
        embedding: embed("launch day and budget"),
        topK: 4,
      },
      1,
    );
    const answer = answerFromMemoryAsk(asked);
    expect(answer.outcome).toBe("answered");
    expect(answer.answerText).toContain("launch day");
    expect(answer.answerText).not.toContain("budget");
    expect(answer.receipt.withheld.some((e) => e.reason === "sensitivity_policy")).toBe(true);
    expect(answerFromMemoryAsk({ outcome: "denied" })).toEqual({ outcome: "denied" });
    expect(
      answerFromMemoryAsk({
        outcome: "answered",
        disclosed: [{ content: "forged restricted content", factId: "x", revision: "1" }],
        receipt: { recalled: [] },
      }),
    ).toEqual({ outcome: "denied" });
    expect(
      answerFromMemoryAsk({
        outcome: "answered",
        disclosed: [{ content: "forged restricted content", factId: "x", revision: "1" }],
        receipt: { recalled: [{ factId: "x", revision: "1" }] },
      }),
    ).toEqual({ outcome: "denied" });
  });

  it("bedrock ports fail closed without HG-5", async () => {
    const ports = createFailClosedBedrockPorts();
    await expect(ports.embed.embed("hello")).resolves.toEqual({ outcome: "denied" });
    await expect(ports.generate.generate("hello")).resolves.toEqual({ outcome: "denied" });
  });

  it("mcp tools expose receipt and lineage summaries without memory bodies", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, "standard");
    const correct = service("memory.correct", repository);
    const audit = service("memory.audit", repository);
    teach.teach(
      {},
      {
        content: h2DemoDataset.facts[0].content,
        embedding: embed(h2DemoDataset.facts[0].content),
        factId: h2DemoDataset.facts[0].factId,
        occurredAt: "2026-08-07T00:00:00.000Z",
        sensitivity: "public",
        sourceRef: h2DemoDataset.facts[0].sourceRef,
      },
      1,
    );
    ask.ask(
      {},
      {
        askedAt: "2026-08-07T01:00:00.000Z",
        embedding: embed("launch day"),
        topK: 2,
      },
      1,
    );
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
    );
    const mcp = createLocalMcpReceiptTools(audit);
    expect(mcp.listTools().map((t) => t.name)).toEqual([
      "receipt_summary.v1",
      "evidence_lineage_summary.v1",
    ]);
    const receipts = mcp.receiptSummary({}, 1);
    expect(receipts.outcome).toBe("ok");
    expect(receipts.text).toContain("recalled=");
    expect(receipts.text).not.toContain("monday");
    const lineage = mcp.lineageSummary({}, 1);
    expect(lineage.outcome).toBe("ok");
    expect(lineage.text).toContain("supersede");
    expect(lineage.text).not.toContain("sunday");
  });
});
