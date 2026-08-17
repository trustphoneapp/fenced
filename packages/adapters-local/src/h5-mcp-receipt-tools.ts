import type {
  DisclosureReceipt,
  MemoryPropagationEntry,
  RecallLedgerService,
} from "@zintus-continuity/application";

// H5 Managed MCP prep — local synthetic, read-only tool surface.
// Mirrors the hackathon-allowed summaries: receipt + lineage only.
// Never returns memory fact content. No network MCP runtime here (HG-5).

const denied = Object.freeze({ outcome: "denied" as const });

export type McpToolResult =
  | Readonly<{ readonly outcome: "ok"; readonly text: string }>
  | typeof denied;

export interface LocalMcpReceiptTools {
  readonly listTools: () => readonly Readonly<{
    readonly description: string;
    readonly name: string;
  }>[];
  readonly receiptSummary: (context: unknown, now: unknown) => McpToolResult;
  readonly lineageSummary: (context: unknown, now: unknown) => McpToolResult;
}

function summarizeReceipt(receipt: DisclosureReceipt): string {
  const recalled = receipt.recalled
    .map((entry) => `${entry.factId.slice(0, 8)}…@r${entry.revision} sim=${entry.similarity}`)
    .join("; ");
  const withheld = receipt.withheld
    .map((entry) => `${entry.factId.slice(0, 8)}…@r${entry.revision} (${entry.reason})`)
    .join("; ");
  return [
    `receipt ${receipt.receiptId.slice(0, 12)}…`,
    `tier=${receipt.accessTier}`,
    `policy=${receipt.policyVersion}`,
    `recalled=[${recalled || "none"}]`,
    `withheld=[${withheld || "none"}]`,
  ].join(" ");
}

function summarizePropagation(entry: MemoryPropagationEntry): string {
  return `${entry.disposition} fact ${entry.factId.slice(0, 8)}… ${entry.fromRevision}→${entry.toRevision}`;
}

export function createLocalMcpReceiptTools(ledger: RecallLedgerService): LocalMcpReceiptTools {
  return Object.freeze({
    listTools() {
      return Object.freeze([
        Object.freeze({
          name: "receipt_summary.v1",
          description: "Read-only disclosure receipt summaries for the current synthetic tenant",
        }),
        Object.freeze({
          name: "evidence_lineage_summary.v1",
          description: "Read-only correction/retraction propagation lineage (IDs only)",
        }),
      ]);
    },
    receiptSummary(context: unknown, now: unknown): McpToolResult {
      const receipts = ledger.receipts(context, now);
      if (!Array.isArray(receipts)) return denied;
      if (receipts.length === 0)
        return Object.freeze({ outcome: "ok" as const, text: "no disclosure receipts" });
      const latest = receipts[receipts.length - 1];
      if (!latest) return denied;
      const text = `count=${receipts.length}; latest: ${summarizeReceipt(latest)}`;
      if (/\bcontent\b/iu.test(JSON.stringify(latest.recalled))) return denied;
      return Object.freeze({ outcome: "ok" as const, text });
    },
    lineageSummary(context: unknown, now: unknown): McpToolResult {
      const propagations = ledger.propagations(context, now);
      if (!Array.isArray(propagations)) return denied;
      if (propagations.length === 0)
        return Object.freeze({ outcome: "ok" as const, text: "no propagation lineage" });
      const text = propagations.map(summarizePropagation).join(" | ");
      if (/monday|sunday|budget/iu.test(text)) return denied;
      return Object.freeze({ outcome: "ok" as const, text });
    },
  });
}
