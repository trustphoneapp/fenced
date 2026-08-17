import { readFile } from "node:fs/promises";

const expected = Object.freeze({
  schemaVersion: 1,
  state: "LOCAL_PREP_BLOCKED",
  calls: Object.freeze([
    Object.freeze({
      id: "task-status",
      tool: "select_query",
      query:
        "SELECT reserved_steps, deletion_fence, expires_at FROM continuity.task_status_summary_v1 ORDER BY expires_at DESC, deletion_fence ASC LIMIT 25",
    }),
    Object.freeze({
      id: "receipt-summary",
      tool: "select_query",
      query:
        "SELECT receipt_id, attempt_id, policy_version, context_compiler_version, retrieval_config_version, embedding_space, provider, model_id, provider_request_id, created_at FROM continuity.receipt_summary_v1 ORDER BY created_at DESC, receipt_id ASC LIMIT 25",
    }),
    Object.freeze({
      id: "evidence-lineage",
      tool: "select_query",
      query:
        "SELECT receipt_id, fact_id, fact_revision, deletion_fence FROM continuity.evidence_lineage_summary_v1 ORDER BY receipt_id ASC, fact_id ASC, fact_revision ASC LIMIT 25",
    }),
    Object.freeze({
      id: "dvi-plan",
      tool: "explain_query",
      query:
        "SELECT fact_id, fact_revision FROM continuity.memory_facts@{FORCE_INDEX=memory_facts_titan_scope_l2,NO_FULL_SCAN} WHERE tenant_id = '000000000000000000000000000000000000000000000000' AND server_purpose = 'hackathon-demo' AND embedding_space = 'zc.bedrock-titan-v2.1024' AND fact_status = 'active' AND sensitivity = 'public' ORDER BY embedding <-> '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::VECTOR LIMIT 5",
    }),
  ]),
});
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const forbidden =
  /(?:;|--|\/\*|\*\/|\b(?:ALTER|CALL|COPY|CREATE|DELETE|DROP|EXECUTE|GRANT|INSERT|REVOKE|SET|TRUNCATE|UPDATE|UPSERT|current_setting)\b)/iu;

export function verifyManagedMcpPack(pack) {
  if (!exactKeys(pack, ["calls", "schemaVersion", "state"])) throw new Error("root contract");
  if (pack.schemaVersion !== 1 || pack.state !== "LOCAL_PREP_BLOCKED") throw new Error("state");
  if (!Array.isArray(pack.calls) || pack.calls.length !== expected.calls.length)
    throw new Error("call count");
  for (const [index, call] of pack.calls.entries()) {
    const wanted = expected.calls[index];
    if (!exactKeys(call, ["id", "query", "tool"])) throw new Error("call contract");
    if (call.id !== wanted.id || call.tool !== wanted.tool || call.query !== wanted.query)
      throw new Error("canonical call");
    if (typeof call.query !== "string" || call.query.length >= 16_384 || forbidden.test(call.query))
      throw new Error("unsafe statement");
    if (!/^SELECT\b/iu.test(call.query) || /SELECT\s+\*/iu.test(call.query))
      throw new Error("select shape");
    const limit = /\bLIMIT\s+(\d+)$/iu.exec(call.query);
    if (!limit || Number(limit[1]) > 25) throw new Error("limit");
  }
  const selects = pack.calls.slice(0, 3);
  const views = ["task_status_summary_v1", "receipt_summary_v1", "evidence_lineage_summary_v1"];
  selects.forEach((call, index) => {
    if (call.tool !== "select_query" || !call.query.includes(`FROM continuity.${views[index]}`))
      throw new Error("view");
    if (/\b(?:content|body|prompt|payload|embedding|vector)\b/iu.test(call.query))
      throw new Error("sensitive projection");
  });
  const explain = pack.calls[3];
  if (
    explain.tool !== "explain_query" ||
    !explain.query.includes("FROM continuity.memory_facts") ||
    !explain.query.includes("FORCE_INDEX=memory_facts_titan_scope_l2,NO_FULL_SCAN") ||
    !explain.query.includes("ORDER BY embedding <->") ||
    /\bFROM\s+continuity\.(?!memory_facts\b)/iu.test(explain.query)
  )
    throw new Error("explain boundary");
  return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const pack = JSON.parse(
    await readFile(new URL("../docs/hackathon/managed-mcp-queries.json", import.meta.url), "utf8"),
  );
  verifyManagedMcpPack(pack);
  process.stdout.write("h18-managed-mcp: PASS\n");
}
