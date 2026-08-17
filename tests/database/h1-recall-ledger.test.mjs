import { describe, expect, it } from "vitest";
import { createLocalH1RecallLedgerRepository } from "../../packages/adapters-local/src/index.js";
import { createRecallLedgerService } from "../../packages/application/src/index.js";

const tenantA = "a".repeat(48);
const tenantB = "b".repeat(48);
const purpose = "continuity.memory";
const sourceRef = "5".repeat(48);

function context(operation, tenantId = tenantA, workloadExtra = {}) {
  const capability = `continuity.${operation}`;
  return {
    operation,
    purpose,
    tenantId,
    workload: { capability, ...workloadExtra },
  };
}

function service(operation, repository, tenantId = tenantA, workloadExtra = {}) {
  return createRecallLedgerService(
    {
      validate: () => ({
        context: context(operation, tenantId, workloadExtra),
        outcome: "issued",
      }),
    },
    repository,
  );
}

// Deterministic local synthetic embedding: 8 dims from character-bucket counts.
function embed(text) {
  const vector = new Array(8).fill(0);
  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0);
    if (code >= 97 && code <= 122) vector[(code - 97) % 8] += 1;
  }
  if (vector.every((component) => component === 0)) vector[0] = 1;
  return vector;
}

function teachCommand(factId, text, overrides = {}) {
  return {
    content: text,
    embedding: embed(text),
    factId,
    occurredAt: "2026-08-07T00:00:00.000Z",
    sensitivity: "public",
    sourceRef,
    ...overrides,
  };
}

function askCommand(text) {
  return { askedAt: "2026-08-07T01:00:00.000Z", embedding: embed(text), topK: 4 };
}

const factPlan = "1".repeat(48);
const factSecret = "2".repeat(48);

describe("h1 recall ledger local synthetic", () => {
  it("teaches, asks, and returns a disclosure receipt with recalled facts", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, tenantA, { accessTier: "standard" });

    expect(
      teach.teach(context("memory.teach"), teachCommand(factPlan, "launch plan is august"), 1),
    ).toMatchObject({ outcome: "recorded" });
    expect(
      teach.teach(context("memory.teach"), teachCommand(factPlan, "launch plan is august"), 1),
    ).toMatchObject({ outcome: "replayed" });

    const result = ask.ask(
      context("memory.ask", tenantA, { accessTier: "standard" }),
      askCommand("what is the launch plan"),
      1,
    );
    expect(result.outcome).toBe("answered");
    expect(result.disclosed).toHaveLength(1);
    expect(result.disclosed[0]).toMatchObject({ factId: factPlan, revision: "1" });
    expect(result.receipt.recalled).toHaveLength(1);
    expect(result.receipt.withheld).toHaveLength(0);
    expect(result.receipt.policyVersion).toBe("zc.recall-policy.v1");
    expect(result.receipt.embeddingSpace).toBe("zc.local-synthetic-embedding.v1");
  });

  it("excludes restricted facts before standard-tier retrieval", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const askStandard = service("memory.ask", repository, tenantA, { accessTier: "standard" });
    const askPrivileged = service("memory.ask", repository, tenantA, {
      accessTier: "privileged",
    });

    teach.teach(
      context("memory.teach"),
      teachCommand(factSecret, "the secret budget is nine", { sensitivity: "restricted" }),
      1,
    );

    const standard = askStandard.ask(
      context("memory.ask", tenantA, { accessTier: "standard" }),
      askCommand("what is the secret budget"),
      1,
    );
    expect(standard.outcome).toBe("answered");
    expect(standard.disclosed).toHaveLength(0);
    expect(standard.receipt.withheld).toEqual([
      { factId: factSecret, reason: "sensitivity_policy", revision: "1" },
    ]);
    const receiptText = JSON.stringify(standard.receipt);
    expect(receiptText).not.toContain("secret budget");

    const privileged = askPrivileged.ask(
      context("memory.ask", tenantA, { accessTier: "privileged" }),
      askCommand("what is the secret budget"),
      1,
    );
    expect(privileged.disclosed).toHaveLength(1);
    expect(privileged.receipt.withheld).toHaveLength(0);
  });

  it("supersedes a fact and later asks recall the new revision with propagation lineage", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, tenantA, { accessTier: "standard" });
    const correct = service("memory.correct", repository);
    const audit = service("memory.audit", repository);

    teach.teach(context("memory.teach"), teachCommand(factPlan, "launch day is monday"), 1);

    const before = ask.ask(
      context("memory.ask", tenantA, { accessTier: "standard" }),
      askCommand("when is launch day"),
      1,
    );
    expect(before.disclosed[0]).toMatchObject({ revision: "1", content: "launch day is monday" });

    const corrected = correct.correct(
      context("memory.correct"),
      {
        disposition: "supersede",
        expectedRevision: "1",
        factId: factPlan,
        occurredAt: "2026-08-07T02:00:00.000Z",
        replacement: {
          content: "launch day is sunday",
          embedding: embed("launch day is sunday"),
          sensitivity: "public",
          sourceRef,
        },
      },
      1,
    );
    expect(corrected).toMatchObject({
      outcome: "corrected",
      propagation: { disposition: "supersede", fromRevision: "1", toRevision: "2" },
    });
    expect(
      correct.correct(
        context("memory.correct"),
        {
          disposition: "retract",
          expectedRevision: "1",
          factId: factPlan,
          occurredAt: "2026-08-07T02:00:01.000Z",
        },
        1,
      ),
    ).toEqual({ outcome: "conflict" });

    const after = ask.ask(
      context("memory.ask", tenantA, { accessTier: "standard" }),
      askCommand("when is launch day"),
      1,
    );
    expect(after.disclosed[0]).toMatchObject({ revision: "2", content: "launch day is sunday" });

    const propagations = audit.propagations(context("memory.audit"), 1);
    expect(propagations).toHaveLength(1);
    expect(JSON.stringify(propagations)).not.toContain("monday");
    expect(JSON.stringify(propagations)).not.toContain("sunday");
  });

  it("retracts a fact: content erased, later receipts name the retraction", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, tenantA, { accessTier: "privileged" });
    const correct = service("memory.correct", repository);

    teach.teach(context("memory.teach"), teachCommand(factPlan, "wrong claim about launch"), 1);
    expect(
      correct.correct(
        context("memory.correct"),
        {
          disposition: "retract",
          expectedRevision: "1",
          factId: factPlan,
          occurredAt: "2026-08-07T03:00:00.000Z",
        },
        1,
      ),
    ).toMatchObject({
      outcome: "corrected",
      propagation: { disposition: "retract", toRevision: "0" },
    });

    const after = ask.ask(
      context("memory.ask", tenantA, { accessTier: "privileged" }),
      askCommand("wrong claim about launch"),
      1,
    );
    expect(after.disclosed).toHaveLength(0);
    expect(after.receipt.withheld).toEqual([
      { factId: factPlan, reason: "retracted", revision: "1" },
    ]);
    expect(JSON.stringify(after)).not.toContain("wrong claim");

    expect(
      correct.correct(
        context("memory.correct"),
        {
          disposition: "retract",
          expectedRevision: "1",
          factId: factPlan,
          occurredAt: "2026-08-07T04:00:00.000Z",
        },
        1,
      ),
    ).toEqual({ outcome: "conflict" });
  });

  it("retracts a superseded fact: every revision erased, receipt names latest revision", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, tenantA, { accessTier: "privileged" });
    const correct = service("memory.correct", repository);

    teach.teach(context("memory.teach"), teachCommand(factPlan, "first wrong claim"), 1);
    correct.correct(
      context("memory.correct"),
      {
        disposition: "supersede",
        expectedRevision: "1",
        factId: factPlan,
        occurredAt: "2026-08-07T02:00:00.000Z",
        replacement: {
          content: "second wrong claim",
          embedding: embed("second wrong claim"),
          sensitivity: "public",
          sourceRef,
        },
      },
      1,
    );
    expect(
      correct.correct(
        context("memory.correct"),
        {
          disposition: "retract",
          expectedRevision: "2",
          factId: factPlan,
          occurredAt: "2026-08-07T03:00:00.000Z",
        },
        1,
      ),
    ).toMatchObject({
      outcome: "corrected",
      propagation: { disposition: "retract", fromRevision: "2", toRevision: "0" },
    });

    const after = ask.ask(
      context("memory.ask", tenantA, { accessTier: "privileged" }),
      askCommand("second wrong claim"),
      1,
    );
    expect(after.disclosed).toHaveLength(0);
    expect(after.receipt.withheld).toEqual([
      { factId: factPlan, reason: "retracted", revision: "2" },
    ]);
    expect(JSON.stringify(after)).not.toContain("wrong claim");
  });

  it("isolates tenants completely", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teachA = service("memory.teach", repository, tenantA);
    const askB = service("memory.ask", repository, tenantB, { accessTier: "privileged" });

    teachA.teach(
      context("memory.teach", tenantA),
      teachCommand(factPlan, "tenant a private launch plan"),
      1,
    );
    const result = askB.ask(
      context("memory.ask", tenantB, { accessTier: "privileged" }),
      askCommand("tenant a private launch plan"),
      1,
    );
    expect(result.outcome).toBe("answered");
    expect(result.disclosed).toHaveLength(0);
    expect(result.receipt.recalled).toHaveLength(0);
    expect(result.receipt.withheld).toHaveLength(0);
  });

  it("denies asks without an access tier and invalid commands", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const askNoTier = createRecallLedgerService(
      {
        validate: () => ({
          context: {
            operation: "memory.ask",
            purpose,
            tenantId: tenantA,
            workload: { capability: "continuity.memory.ask" },
          },
          outcome: "issued",
        }),
      },
      repository,
    );
    expect(askNoTier.ask({}, askCommand("anything"), 1)).toEqual({ outcome: "denied" });

    const teach = service("memory.teach", repository);
    expect(
      teach.teach(
        context("memory.teach"),
        teachCommand(factPlan, "x", { embedding: [0, 0, 0, 0, 0, 0, 0, 0] }),
        1,
      ),
    ).toEqual({ outcome: "denied" });
    expect(
      teach.teach(context("memory.teach"), teachCommand("not-hex", "valid content"), 1),
    ).toEqual({ outcome: "denied" });
  });

  it("keeps receipts append-only and auditable per tenant", () => {
    const repository = createLocalH1RecallLedgerRepository();
    const teach = service("memory.teach", repository);
    const ask = service("memory.ask", repository, tenantA, { accessTier: "standard" });
    const audit = service("memory.audit", repository);
    const auditB = service("memory.audit", repository, tenantB);

    teach.teach(context("memory.teach"), teachCommand(factPlan, "launch plan is august"), 1);
    ask.ask(
      context("memory.ask", tenantA, { accessTier: "standard" }),
      askCommand("what is the launch plan"),
      1,
    );
    ask.ask(
      context("memory.ask", tenantA, { accessTier: "standard" }),
      askCommand("launch plan again"),
      1,
    );

    const receipts = audit.receipts(context("memory.audit"), 1);
    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map((receipt) => receipt.receiptId)).size).toBe(2);
    expect(auditB.receipts(context("memory.audit", tenantB), 1)).toHaveLength(0);
  });
});
