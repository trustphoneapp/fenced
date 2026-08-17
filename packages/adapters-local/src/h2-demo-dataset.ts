// Synthetic hackathon demo dataset — no real/personal data.
// Script beat: teach public + restricted → ask (withhold restricted) →
// supersede launch day → ask again → retract secret → ask (retraction named).

export interface DemoDatasetFact {
  readonly content: string;
  readonly factId: string;
  readonly sensitivity: "public" | "restricted";
  readonly sourceRef: string;
}

export interface DemoDataset {
  readonly facts: readonly DemoDatasetFact[];
  readonly purpose: "continuity.memory";
  readonly supersede: Readonly<{
    readonly content: string;
    readonly factId: string;
  }>;
  readonly tenantId: string;
  readonly version: "zc.demo-dataset.v1";
}

const tenantId = "d".repeat(48);
const sourceRef = "e".repeat(48);

export const h2DemoDataset: DemoDataset = Object.freeze({
  version: "zc.demo-dataset.v1",
  purpose: "continuity.memory",
  tenantId,
  facts: Object.freeze([
    Object.freeze({
      factId: "1".repeat(48),
      content: "Fenced launch day is monday for the hackathon demo",
      sensitivity: "public" as const,
      sourceRef,
    }),
    Object.freeze({
      factId: "2".repeat(48),
      content: "Internal budget ceiling is nine units — restricted synthetic",
      sensitivity: "restricted" as const,
      sourceRef,
    }),
    Object.freeze({
      factId: "3".repeat(48),
      content: "Judges query disclosure receipts through Managed MCP read-only",
      sensitivity: "public" as const,
      sourceRef,
    }),
  ]),
  supersede: Object.freeze({
    factId: "1".repeat(48),
    content: "Fenced launch day is sunday for the hackathon demo",
  }),
});
