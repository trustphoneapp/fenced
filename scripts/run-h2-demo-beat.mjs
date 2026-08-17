#!/usr/bin/env node
/**
 * Local/synthetic demo beat — no network, no credentials, no cloud.
 */
import { createLocalDemoRuntime } from "../packages/adapters-local/dist/index.js";

const runtime = createLocalDemoRuntime();
process.stdout.write("=== Continuity Recall Ledger — local demo beat ===\n");
process.stdout.write(`claim: ${runtime.claim}\n\n`);

for (const result of runtime.seed()) {
  process.stdout.write(`teach → ${result.outcome}\n`);
}

const ask1 = runtime.ask("what is the launch day and budget");
process.stdout.write("\nask #1 answer\n");
process.stdout.write(`${JSON.stringify(ask1.answer, null, 2)}\n`);
process.stdout.write("\nask #1 receipt withheld\n");
process.stdout.write(
  `${JSON.stringify(ask1.ask.outcome === "answered" ? ask1.ask.receipt.withheld : ask1.ask, null, 2)}\n`,
);

const corrected = runtime.correctSupersedeLaunchDay();
process.stdout.write("\ncorrect supersede\n");
process.stdout.write(`${JSON.stringify(corrected, null, 2)}\n`);

const ask2 = runtime.ask("when is launch day");
process.stdout.write("\nask #2 answer\n");
process.stdout.write(`${JSON.stringify(ask2.answer, null, 2)}\n`);

process.stdout.write("\nmcp receipt_summary\n");
process.stdout.write(`${JSON.stringify(runtime.mcp.receiptSummary({}, 1), null, 2)}\n`);
process.stdout.write("\nmcp lineage_summary\n");
process.stdout.write(`${JSON.stringify(runtime.mcp.lineageSummary({}, 1), null, 2)}\n`);
process.stdout.write("\n=== beat complete ===\n");
