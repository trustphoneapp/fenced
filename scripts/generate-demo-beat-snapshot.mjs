#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalDemoRuntime } from "../packages/adapters-local/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPublicPath = path.join(root, "apps", "web", "public", "demo-beat.json");
const outSourcePath = path.join(root, "apps", "web", "src", "demo-beat.json");

const runtime = createLocalDemoRuntime();
runtime.seed();
const ask1 = runtime.ask("what is the launch day and budget");
runtime.correctSupersedeLaunchDay();
const ask2 = runtime.ask("when is launch day");

const snapshot = {
  claim: runtime.claim,
  concept: "Continuity Recall Ledger — the memory layer that shows its work",
  steps: [
    {
      id: "ask1",
      title: "Ask (standard tier)",
      question: "What is the launch day and budget?",
      answer: ask1.answer.outcome === "answered" ? ask1.answer.answerText : null,
      receipt: ask1.ask.outcome === "answered" ? ask1.ask.receipt : null,
      note: "Restricted budget is withheld before the model; receipt names the reason.",
    },
    {
      id: "correct",
      title: "Correct launch day",
      question: "Supersede monday → sunday",
      answer: null,
      receipt: null,
      note: "Propagation is ID-only (no memory body on the wire).",
    },
    {
      id: "ask2",
      title: "Ask after correction",
      question: "When is launch day?",
      answer: ask2.answer.outcome === "answered" ? ask2.answer.answerText : null,
      receipt: ask2.ask.outcome === "answered" ? ask2.ask.receipt : null,
      note: "Answer and receipt now bind revision 2.",
    },
  ],
  mcp: {
    tools: runtime.mcp.listTools(),
    receiptSummary: runtime.mcp.receiptSummary({}, 1),
    lineageSummary: runtime.mcp.lineageSummary({}, 1),
  },
};

await mkdir(path.dirname(outPublicPath), { recursive: true });
await mkdir(path.dirname(outSourcePath), { recursive: true });
const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile(outPublicPath, rendered, "utf8");
await writeFile(outSourcePath, rendered, "utf8");
process.stdout.write(`wrote ${path.relative(root, outPublicPath)}\n`);
process.stdout.write(`wrote ${path.relative(root, outSourcePath)}\n`);
