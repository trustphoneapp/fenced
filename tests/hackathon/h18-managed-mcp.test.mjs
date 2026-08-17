import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { verifyManagedMcpPack } from "../../scripts/verify-h18-managed-mcp.mjs";

const load = async () =>
  JSON.parse(
    await readFile(
      new URL("../../docs/hackathon/managed-mcp-queries.json", import.meta.url),
      "utf8",
    ),
  );
const changed = async (edit) => {
  const pack = await load();
  edit(pack);
  return pack;
};

describe("H18 Managed MCP truthfulness pack", () => {
  it("accepts only the canonical local-preparation pack", async () => {
    await expect(load().then(verifyManagedMcpPack)).resolves.toBe(true);
  });

  it.each([
    ["tool", (pack) => (pack.calls[0].tool = "custom_receipt_tool")],
    ["view", (pack) => (pack.calls[0].query = pack.calls[0].query.replace("task_status", "tasks"))],
    [
      "column",
      (pack) => (pack.calls[1].query = pack.calls[1].query.replace("receipt_id", "content")),
    ],
    ["verb", (pack) => (pack.calls[0].query = pack.calls[0].query.replace("SELECT", "UPDATE"))],
    ["limit", (pack) => (pack.calls[2].query = pack.calls[2].query.replace("25", "26"))],
    ["multiple statements", (pack) => (pack.calls[0].query += "; SELECT 1")],
    ["session scope", (pack) => (pack.calls[0].query += " current_setting('x')")],
    ["comment", (pack) => (pack.calls[0].query += " -- unsafe")],
    [
      "base read",
      (pack) =>
        (pack.calls[0].query = pack.calls[0].query.replace(
          "task_status_summary_v1",
          "hackathon_sessions",
        )),
    ],
    [
      "star",
      (pack) =>
        (pack.calls[0].query = pack.calls[0].query.replace(
          "reserved_steps, deletion_fence, expires_at",
          "*",
        )),
    ],
    [
      "DVI base",
      (pack) => (pack.calls[3].query = pack.calls[3].query.replace("memory_facts", "events")),
    ],
    [
      "DVI index",
      (pack) =>
        (pack.calls[3].query = pack.calls[3].query.replace(
          "memory_facts_titan_scope_l2",
          "memory_facts_one_active_revision",
        )),
    ],
    ["extra key", (pack) => (pack.calls[0].clusterId = "not-data-only")],
  ])("rejects a changed %s", async (_name, edit) => {
    const pack = await changed(edit);
    expect(() => verifyManagedMcpPack(pack)).toThrow();
  });
});
