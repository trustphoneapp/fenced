import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { handler } from "../../apps/api/src/index.js";
import { createLocalHackathonRuntimeCandidate } from "../../apps/api/src/live-runtime.js";

const sessionDigest = `${"a".repeat(48)}${"b".repeat(16)}`;
const publicRows = [
  {
    content: "Continuity launch day is monday for the hackathon demo",
    deletion_fence: "0",
    distance: 0,
    fact_id: "1".repeat(48),
    fact_revision: "1",
  },
  {
    content: "Judges query disclosure receipts through Managed MCP read-only",
    deletion_fence: "0",
    distance: 0.1,
    fact_id: "3".repeat(48),
    fact_revision: "1",
  },
];

function poolForAsk(rows = publicRows) {
  const calls = [];
  return {
    calls,
    async connect() {
      return {
        async query(sql, params = []) {
          calls.push({ params, sql });
          if (sql.includes("FROM continuity.hackathon_session_tokens"))
            return { rows: [{ session_digest: sessionDigest }] };
          if (sql.includes("hackathon_quota_lock")) return { rows: [{ lock_version: "1" }] };
          if (sql.includes("hackathon_runtime_control"))
            return { rows: [{ provider_enabled: true }] };
          if (sql.includes("hackathon_usage_summary_v1"))
            return {
              rows: [
                { engineering_nova: 0, engineering_titan: 0, public_nova: 0, public_titan: 3 },
              ],
            };
          if (sql.includes("count(*)::INT8 AS steps")) return { rows: [{ steps: "1" }] };
          if (
            sql.includes(
              "deletion_fence::string AS deletion_fence FROM continuity.hackathon_sessions",
            )
          )
            return { rows: [{ deletion_fence: "0" }] };
          if (sql.includes("FORCE_INDEX=memory_facts_titan_scope_l2"))
            return sql.includes("sensitivity = 'public'")
              ? { rows }
              : {
                  rows: [
                    {
                      deletion_fence: "0",
                      distance: 0.2,
                      fact_id: "2".repeat(48),
                      fact_revision: "1",
                      reason: "sensitivity_policy",
                    },
                  ],
                };
          if (
            sql.includes("FROM continuity.hackathon_provider_reservations") &&
            sql.includes("request_digest=$4")
          )
            return {
              rows: [{ attempt_id: params[5], operation_id: params[4], request_digest: params[3] }],
            };
          if (
            sql.includes("FROM continuity.memory_facts WHERE") &&
            sql.includes("sensitivity='public'")
          )
            return {
              rows: [{ deletion_fence: "0", fact_id: params[2], fact_revision: params[3] }],
            };
          if (
            sql.includes("FROM continuity.memory_facts WHERE") &&
            sql.includes("sensitivity='restricted'")
          )
            return {
              rows: [{ deletion_fence: "0", fact_id: params[2], fact_revision: params[3] }],
            };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

function poolForStart() {
  return {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes("JOIN continuity.hackathon_provider_reservations")) return { rows: [] };
          if (sql.startsWith("SELECT 1 AS exists")) return { rows: [] };
          if (sql.includes("hackathon_quota_lock")) return { rows: [{ lock_version: "1" }] };
          if (sql.includes("hackathon_runtime_control"))
            return { rows: [{ provider_enabled: true }] };
          if (sql.includes("hackathon_usage_summary_v1"))
            return { rows: [{ engineering_titan: 0, public_sessions: 0, public_titan: 0 }] };
          if (sql.includes("FROM continuity.hackathon_session_tokens"))
            return { rows: [{ session_digest: sessionDigest }] };
          if (sql.includes("step_name='start' AND request_digest")) return { rows: [{}] };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

function sender(calls) {
  return async (command) => {
    calls.push(command);
    if (command.constructor.name === "InvokeModelCommand")
      return {
        $metadata: { requestId: "embed-request" },
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: [1, ...Array(1023).fill(0)], inputTextTokenCount: 4 }),
        ),
      };
    return {
      $metadata: { requestId: "generation-request" },
      metrics: { latencyMs: 5 },
      output: {
        message: {
          content: [{ text: "Monday; inspect the read-only receipt." }],
          role: "assistant",
        },
      },
      stopReason: "end_turn",
      usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 },
    };
  };
}

describe("H16B local composition candidate", () => {
  it("is inert until run and composes the governed ask path with injected ports", async () => {
    const pool = poolForAsk();
    const sent = [];
    const runtime = createLocalHackathonRuntimeCandidate({ pool, sender: sender(sent) });
    expect(pool.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);

    await expect(runtime.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
      answer: "Monday; inspect the read-only receipt.",
      outcome: "succeeded",
      step: "ask_before",
      withheld: [{ factId: "2".repeat(48), reason: "sensitivity_policy", revision: "1" }],
    });
    expect(sent.map((command) => command.constructor.name)).toEqual([
      "InvokeModelCommand",
      "ConverseCommand",
    ]);
    const prompt = sent[1].input.messages[0].content[0].text;
    expect(prompt).not.toContain("Internal budget ceiling");
    expect(prompt).not.toContain("2".repeat(48));
  });

  it("permits the restricted synthetic seed only for initial Titan ingestion", async () => {
    const sent = [];
    const runtime = createLocalHackathonRuntimeCandidate({
      pool: poolForStart(),
      sender: sender(sent),
    });
    await expect(runtime.run({ sessionDigest, step: "start" })).resolves.toEqual({
      outcome: "succeeded",
      step: "start",
    });
    expect(sent).toHaveLength(3);
    expect(sent.every((command) => command.constructor.name === "InvokeModelCommand")).toBe(true);
    expect(sent.map((command) => JSON.parse(command.input.body).inputText)).toContain(
      "Internal budget ceiling is nine units — restricted synthetic",
    );
  });

  it.each([
    [
      "unknown public memory",
      [
        ...publicRows,
        {
          ...publicRows[0],
          content: "arbitrary synthetic outbound text",
          fact_id: "4".repeat(48),
          fact_revision: "999",
        },
      ],
    ],
    [
      "wrong reviewed tuple",
      publicRows.map((row, index) =>
        index === 0 ? { ...row, content: publicRows[1].content } : row,
      ),
    ],
    ["fence drift", publicRows.map((row) => ({ ...row, deletion_fence: "1" }))],
  ])("denies %s before Nova transmission", async (_name, rows) => {
    const sent = [];
    const runtime = createLocalHackathonRuntimeCandidate({
      pool: poolForAsk(rows),
      sender: sender(sent),
    });
    await expect(runtime.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
      outcome: "denied",
    });
    expect(sent.map((command) => command.constructor.name)).toEqual(["InvokeModelCommand"]);
  });

  it("contains provider failures without echoing their content", async () => {
    const embed = sender([]);
    const runtime = createLocalHackathonRuntimeCandidate({
      pool: poolForAsk(),
      sender: async (command) => {
        if (command.constructor.name === "ConverseCommand")
          throw new Error("postgresql://user:password@host restricted-body token");
        return embed(command);
      },
    });
    const result = await runtime.run({ sessionDigest, step: "ask_before" });
    expect(result).toMatchObject({ outcome: "unknown", step: "ask_before" });
    expect(JSON.stringify(result)).not.toMatch(/password|restricted-body|postgresql/u);
  });

  it("rejects authority-shaped dependency injection and leaves the Lambda handler closed", async () => {
    const connect = vi.fn();
    const send = vi.fn();
    for (const value of [
      {},
      { pool: { connect }, sender: send, connectionString: "postgresql://secret" },
      Object.create({ pool: { connect }, sender: send }),
      new Proxy({ pool: { connect }, sender: send }, {}),
    ])
      expect(() => createLocalHackathonRuntimeCandidate(value)).toThrowError(
        "invalid_runtime_dependencies",
      );
    expect(connect).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await expect(handler({})).resolves.toMatchObject({ statusCode: 503 });
  });

  it("contains no secret, environment, logging, or default-client path", async () => {
    const source = await readFile(
      new URL("../../apps/api/src/live-runtime.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "process.env",
      "console.",
      "connectionString",
      "BedrockRuntimeClient",
      "SecretsManager",
    ])
      expect(source).not.toContain(forbidden);
  });
});
