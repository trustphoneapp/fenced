import {
  answerFromMemoryAsk,
  createRecallLedgerService,
  type DemoAnswerResult,
  type MemoryAskResult,
  type MemoryCorrectionResult,
  type MemoryTeachResult,
  type RecallLedgerService,
  type TenantContextService,
} from "@zintus-continuity/application";
import { h2DemoDataset } from "./h2-demo-dataset.js";
import { createLocalMcpReceiptTools, type LocalMcpReceiptTools } from "./h5-mcp-receipt-tools.js";
import { createLocalH1RecallLedgerRepository } from "./local-h1-recall-ledger-repository.js";

function embed(text: string): number[] {
  const vector = new Array(8).fill(0);
  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0);
    if (code !== undefined && code >= 97 && code <= 122) vector[(code - 97) % 8] += 1;
  }
  if (vector.every((component) => component === 0)) vector[0] = 1;
  return vector;
}

function contexts(operation: string, accessTier?: "standard" | "privileged"): TenantContextService {
  // Demo harness only — not a production TenantContextService.
  return {
    validate: () => ({
      context: {
        operation,
        purpose: h2DemoDataset.purpose,
        tenantId: h2DemoDataset.tenantId,
        workload:
          operation === "memory.ask"
            ? {
                accessTier: accessTier ?? "standard",
                capability: `continuity.${operation}`,
              }
            : { capability: `continuity.${operation}` },
      },
      outcome: "issued" as const,
    }),
    issuePrincipal: () => ({ outcome: "denied" as const }),
    issueSystem: () => ({ outcome: "denied" as const }),
  } as unknown as TenantContextService;
}

export interface DemoRuntime {
  readonly ask: (question: string) => {
    readonly answer: DemoAnswerResult;
    readonly ask: MemoryAskResult;
  };
  readonly claim: "LOCAL_SYNTHETIC_ONLY";
  readonly correctSupersedeLaunchDay: () => MemoryCorrectionResult;
  readonly mcp: LocalMcpReceiptTools;
  readonly seed: () => readonly MemoryTeachResult[];
  readonly services: Readonly<{
    readonly ask: RecallLedgerService;
    readonly audit: RecallLedgerService;
    readonly correct: RecallLedgerService;
    readonly teach: RecallLedgerService;
  }>;
}

/** One-shot local/synthetic demo runtime for scripts and tests. No network. */
export function createLocalDemoRuntime(): DemoRuntime {
  const repository = createLocalH1RecallLedgerRepository();
  const teach = createRecallLedgerService(contexts("memory.teach"), repository);
  const askService = createRecallLedgerService(contexts("memory.ask", "standard"), repository);
  const correct = createRecallLedgerService(contexts("memory.correct"), repository);
  const audit = createRecallLedgerService(contexts("memory.audit"), repository);
  const mcp = createLocalMcpReceiptTools(audit);

  return Object.freeze({
    claim: "LOCAL_SYNTHETIC_ONLY" as const,
    services: Object.freeze({ teach, ask: askService, correct, audit }),
    mcp,
    seed() {
      return h2DemoDataset.facts.map((fact) =>
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
      );
    },
    ask(question: string) {
      const askedAt = "2026-08-07T01:00:00.000Z";
      const asked = askService.ask(
        {},
        {
          askedAt,
          embedding: embed(question),
          topK: 4,
        },
        1,
      );
      return Object.freeze({ ask: asked, answer: answerFromMemoryAsk(asked) });
    },
    correctSupersedeLaunchDay() {
      return correct.correct(
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
            sourceRef: h2DemoDataset.facts[0]?.sourceRef ?? "e".repeat(48),
          },
        },
        1,
      );
    },
  });
}
