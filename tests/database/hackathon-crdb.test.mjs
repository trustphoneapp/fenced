// biome-ignore-all format: keep the bounded E2 fake-pool proof below its reviewed LOC ceiling.
import { describe, expect, it } from "vitest";
import {
  createHackathonCrdbRepository,
  hackathonDviPublicSql,
  hackathonDviRestrictedSql,
} from "../../packages/adapters-local/src/hackathon-crdb.js";

const tenantId = "a".repeat(48);
const sessionDigest = `${tenantId}${"d".repeat(16)}`;
const attemptId = "1".repeat(48);
const operationId = "2".repeat(48);
const requestDigest = "3".repeat(64);
const receiptId = "4".repeat(48);
const factId = "1".repeat(48);
const withheldFactId = "b".repeat(48);
const sourceRef = "e".repeat(48);
const embedding = Object.freeze([1, ...Array(1023).fill(0)]);
const ids = { attemptId, operationId, requestDigest, sessionDigest };
const tokenRow = { session_digest: sessionDigest };
const empty = { rows: [] };

function fakePool(handler = () => empty, options = {}) {
  const calls = [];
  let connects = 0;
  let releases = 0;
  return {
    calls,
    get connects() {
      return connects;
    },
    get releases() {
      return releases;
    },
    async connect() {
      connects += 1;
      if (options.connectError) throw options.connectError;
      return {
        async query(sql, params) {
          calls.push({ params, sql });
          return handler(sql, params, calls.length);
        },
        release() {
          releases += 1;
          if (options.releaseError) throw options.releaseError;
        },
      };
    },
  };
}

const isAuth = (sql) => sql.includes("FROM continuity.hackathon_session_tokens");
const writes = (pool) =>
  pool.calls.filter(({ sql }) => /^(?:INSERT|UPDATE|DELETE|TRUNCATE) /u.test(sql));
const repository = (pool, options = {}) =>
  createHackathonCrdbRepository({ pool, sleep: async () => undefined, ...options });

function startRows(sql, state = {}) {
  if (sql.includes("JOIN continuity.hackathon_provider_reservations"))
    return { rows: state.replay ? [tokenRow] : [] };
  if (sql.startsWith("SELECT 1 AS exists")) return { rows: state.existing ? [{}] : [] };
  if (sql.includes("hackathon_quota_lock"))
    return { rows: state.missingLock ? [] : [{ lock_version: "1" }] };
  if (sql.includes("hackathon_runtime_control"))
    return { rows: [{ provider_enabled: state.enabled ?? true }] };
  if (sql.includes("hackathon_usage_summary_v1"))
    return {
      rows: [
        {
          engineering_titan: state.engineeringTitan ?? 0,
          public_sessions: state.sessions ?? 0,
          public_titan: state.publicTitan ?? 0,
        },
      ],
    };
  return empty;
}

function reserveRows(sql, state = {}) {
  if (isAuth(sql)) return { rows: state.auth === false ? [] : [tokenRow] };
  if (sql.includes("step_ordinal=$3"))
    return {
      rows: state.prior
        ? [
            {
              attempt_id: state.conflict ? "9".repeat(48) : attemptId,
              operation_id: operationId,
              request_digest: requestDigest,
              reservation_state: "reserved",
            },
          ]
        : [],
    };
  if (sql.includes("count(*)::INT8 AS steps")) return { rows: [{ steps: state.steps ?? "1" }] };
  if (sql.includes("hackathon_quota_lock"))
    return { rows: state.missingLock ? [] : [{ lock_version: "1" }] };
  if (sql.includes("hackathon_runtime_control"))
    return { rows: [{ provider_enabled: state.enabled ?? true }] };
  if (sql.includes("hackathon_usage_summary_v1"))
    return {
      rows: [
        {
          engineering_nova: state.engineeringNova ?? 0,
          engineering_titan: state.engineeringTitan ?? 0,
          public_nova: state.publicNova ?? 0,
          public_titan: state.publicTitan ?? 3,
        },
      ],
    };
  return empty;
}

const reserveInput = (step = "ask_before") => ({ ...ids, step });
const correctionInput = {
  ...ids,
  disposition: "supersede",
  expectedRevision: "1",
  factId,
  replacement: {
    content: "Fenced launch day is sunday for the hackathon demo",
    embedding,
    sensitivity: "public",
    sourceRef,
  },
};
const receiptInput = {
  ...ids,
  contextCompilerVersion: "compiler-v1",
  deletionFence: "0",
  embeddingInputTokens: 1,
  embeddingLatencyMs: 2,
  embeddingModelId: "amazon.titan-embed-text-v2:0",
  embeddingPolicyDecisionId: "embed-allow-v1",
  embeddingProviderRequestId: "embedding-request",
  embeddingSpace: "zc.bedrock-titan-v2.1024",
  expectedActiveRevisions: [{ deletionFence: "0", factId, revision: "1" }],
  expectedWithheld: [
    { deletionFence: "0", factId: withheldFactId, reason: "sensitivity_policy", revision: "2" },
  ],
  inputTokens: 2,
  latencyMs: 7,
  modelId: "amazon.nova-lite-v1:0",
  outcome: "succeeded",
  outputTokens: 3,
  policyDecisionId: "allow-v1",
  policyVersion: "policy-v1",
  provider: "amazon-bedrock",
  providerRequestId: "provider-request",
  receiptId,
  region: "us-east-1",
  requestDigestVersion: "zc.request-digest.v1",
  responseBody: "synthetic answer",
  retrievalConfigVersion: "retrieval-v1",
  step: "ask_before",
  stopReason: "end_turn",
  totalTokens: 5,
};

describe("hackathon CRDB lifecycle", () => {
  it("starts once, replays the exact tuple, and conflicts on an existing session", async () => {
    const success = fakePool((sql) => startRows(sql));
    await expect(repository(success).startSession(ids)).resolves.toEqual({
      outcome: "succeeded",
      tenantId,
    });
    expect(writes(success).map(({ sql }) => sql)).toHaveLength(6);
    expect(
      success.calls.some(({ sql }) =>
        sql.includes("hackathon_quota_lock WHERE lock_id='public-v1' FOR UPDATE"),
      ),
    ).toBe(true);
    expect(success.calls.at(-1)?.sql).toBe("COMMIT");

    const replay = fakePool((sql) => startRows(sql, { replay: true }));
    await expect(repository(replay).startSession(ids)).resolves.toEqual({
      outcome: "replayed",
      tenantId,
    });
    expect(writes(replay)).toHaveLength(0);

    const conflict = fakePool((sql) => startRows(sql, { existing: true }));
    await expect(repository(conflict).startSession(ids)).resolves.toEqual({ outcome: "conflict" });
    expect(writes(conflict)).toHaveLength(0);
  });

  it.each([
    ["provider disabled", { enabled: false }],
    ["100-session lifetime cap", { sessions: 100 }],
    ["missing quota lock", { missingLock: true }],
  ])("denies start when %s without writing usage", async (_name, state) => {
    const pool = fakePool((sql) => startRows(sql, state));
    await expect(repository(pool).startSession(ids)).resolves.toEqual(
      state.missingLock ? { outcome: "conflict" } : { outcome: "denied", reason: "conflict" },
    );
    expect(writes(pool)).toHaveLength(0);
  });

  it("reserves only the next step and exactly replays without extra usage", async () => {
    const success = fakePool((sql) => reserveRows(sql));
    await expect(repository(success).reserveOperation(reserveInput())).resolves.toEqual({
      nova: 1,
      outcome: "succeeded",
      titan: 1,
    });
    expect(writes(success)).toHaveLength(2);
    expect(
      success.calls.some(({ sql }) =>
        sql.includes("hackathon_quota_lock WHERE lock_id='public-v1' FOR UPDATE"),
      ),
    ).toBe(true);
    expect(writes(success)[0]?.sql).toContain("hackathon_provider_usage");

    const replay = fakePool((sql) => reserveRows(sql, { prior: true }));
    await expect(repository(replay).reserveOperation(reserveInput())).resolves.toEqual({
      nova: 1,
      outcome: "replayed",
      titan: 1,
    });
    expect(writes(replay)).toHaveLength(0);

    const outOfOrder = fakePool((sql) => reserveRows(sql, { steps: "0" }));
    await expect(repository(outOfOrder).reserveOperation(reserveInput())).resolves.toEqual({
      outcome: "conflict",
    });
    expect(writes(outOfOrder)).toHaveLength(0);
  });

  it.each([
    ["provider disabled", { enabled: false }],
    ["missing quota lock", { missingLock: true }],
    ["public Titan limit", { publicTitan: 600 }],
    ["public Nova limit", { publicNova: 200 }],
    ["absolute Titan limit", { engineeringTitan: 797, publicTitan: 3 }],
    ["absolute Nova limit", { engineeringNova: 299, publicNova: 1 }],
  ])("denies reservation at %s without writing usage", async (_name, state) => {
    const pool = fakePool((sql) => reserveRows(sql, state));
    await expect(repository(pool).reserveOperation(reserveInput())).resolves.toEqual(
      state.missingLock ? { outcome: "conflict" } : { outcome: "denied", reason: "conflict" },
    );
    expect(writes(pool)).toHaveLength(0);
  });

  it("stores the three fixed initial facts once and exactly replays", async () => {
    const input = { ...ids, embeddings: [embedding, embedding, embedding] };
    const success = fakePool((sql) => {
      if (isAuth(sql) || sql.includes("step_name='start' AND request_digest"))
        return { rows: [tokenRow] };
      return empty;
    });
    await expect(repository(success).storeInitialFacts(input)).resolves.toEqual({
      outcome: "succeeded",
    });
    expect(
      success.calls.filter(({ sql }) => sql.startsWith("INSERT INTO continuity.memory_facts")),
    ).toHaveLength(3);
    expect(success.calls.some(({ sql }) => sql.includes("hackathon_effect_results"))).toBe(true);

    const replay = fakePool((sql) =>
      isAuth(sql)
        ? { rows: [tokenRow] }
        : sql.includes("FROM continuity.hackathon_effect_results")
          ? {
              rows: [
                { attempt_id: attemptId, operation_id: operationId, request_digest: requestDigest },
              ],
            }
          : empty,
    );
    await expect(repository(replay).storeInitialFacts(input)).resolves.toEqual({
      outcome: "replayed",
    });
    expect(writes(replay)).toHaveLength(0);
  });
});

describe("hackathon CRDB retrieval and transaction failures", () => {
  it("authenticates before DVI and denies missing or expired tokens", async () => {
    const pool = fakePool();
    await expect(
      repository(pool).retrieveSnapshot({
        accessTier: "standard",
        embedding,
        sessionDigest,
        topK: 4,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    expect(pool.calls.some(({ sql }) => sql === hackathonDviPublicSql)).toBe(false);
  });

  it("uses one scoped DVI snapshot and withholds restricted bodies", async () => {
    const restrictedId = "b".repeat(48);
    const pool = fakePool((sql) => {
      if (isAuth(sql)) return { rows: [tokenRow] };
      if (sql.includes("FROM continuity.hackathon_sessions"))
        return { rows: [{ deletion_fence: "0" }] };
      if (sql === hackathonDviPublicSql)
        return {
          rows: [
            {
              content: "synthetic memory",
              deletion_fence: "0",
              distance: 0,
              fact_id: factId,
              fact_revision: "1",
            },
          ],
        };
      if (sql === hackathonDviRestrictedSql)
        return {
          rows: [
            {
              deletion_fence: "0",
              distance: 1,
              fact_id: restrictedId,
              fact_revision: "2",
              reason: "sensitivity_policy",
            },
          ],
        };
      return empty;
    });
    const result = await repository(pool).retrieveSnapshot({
      accessTier: "standard",
      embedding,
      sessionDigest,
      topK: 4,
    });
    expect(result).toEqual({
      authorized: [
        { content: "synthetic memory", deletionFence: "0", factId, revision: "1", similarity: 1 },
      ],
      deletionFence: "0",
      outcome: "succeeded",
      withheld: [
        {
          deletionFence: "0",
          factId: restrictedId,
          reason: "sensitivity_policy",
          revision: "2",
          similarity: 0.5,
        },
      ],
    });
    expect(JSON.stringify(result.withheld)).not.toMatch(/content|embedding/u);
    expect(pool.calls.map(({ sql }) => sql).slice(0, 6)).toEqual([
      "BEGIN",
      "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL ROLE zc_continuity_executor",
      "SELECT set_config('continuity.tenant_id', $1, true)",
      "SELECT set_config('continuity.server_purpose', $1, true)",
      expect.stringContaining("hackathon_session_tokens"),
    ]);
  });

  it("retries the entire transaction for a COMMIT 40001", async () => {
    let commits = 0;
    const pool = fakePool((sql) => {
      if (isAuth(sql)) return { rows: [tokenRow] };
      if (sql.includes("FROM continuity.hackathon_sessions"))
        return { rows: [{ deletion_fence: "0" }] };
      if (sql === "COMMIT" && commits++ === 0) throw { code: "40001" };
      return empty;
    });
    await expect(
      repository(pool, { random: () => 0 }).retrieveSnapshot({
        accessTier: "standard",
        embedding,
        sessionDigest,
        topK: 1,
      }),
    ).resolves.toMatchObject({ outcome: "succeeded" });
    expect(pool.connects).toBe(2);
    expect(pool.calls.filter(({ sql }) => sql === "BEGIN")).toHaveLength(2);
    expect(pool.calls.filter(({ sql }) => sql.includes("set_config"))).toHaveLength(4);
  });

  it("returns unknown for non-40001 COMMIT ambiguity", async () => {
    const pool = fakePool((sql) => {
      if (isAuth(sql)) return { rows: [tokenRow] };
      if (sql.includes("FROM continuity.hackathon_sessions"))
        return { rows: [{ deletion_fence: "0" }] };
      if (sql === "COMMIT") throw new Error("driver-secret");
      return empty;
    });
    await expect(
      repository(pool).retrieveSnapshot({
        accessTier: "standard",
        embedding,
        sessionDigest,
        topK: 1,
      }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(pool.connects).toBe(1);
  });

  it("contains checkout, rollback, and release failures", async () => {
    const checkout = fakePool(undefined, { connectError: new Error("url-secret") });
    const denied = await repository(checkout).retrieveSnapshot({
      accessTier: "standard",
      embedding,
      sessionDigest,
      topK: 1,
    });
    expect(denied).toEqual({ outcome: "denied", reason: "database_error" });
    expect(JSON.stringify(denied)).not.toMatch(/secret|url/u);

    const broken = fakePool(
      (sql) => {
        if (isAuth(sql)) return { rows: [tokenRow] };
        if (sql === hackathonDviPublicSql) throw new Error("sql-body-token-secret");
        if (sql === "ROLLBACK") throw new Error("rollback-secret");
        return empty;
      },
      { releaseError: new Error("release-secret") },
    );
    const result = await repository(broken).retrieveSnapshot({
      accessTier: "standard",
      embedding,
      sessionDigest,
      topK: 1,
    });
    expect(result).toEqual({ outcome: "denied", reason: "database_error" });
    expect(JSON.stringify(result)).not.toMatch(/secret|token|body/u);
  });
});

describe("hackathon CRDB receipts and correction", () => {
  function finalizeRows(sql, state = {}) {
    if (isAuth(sql)) return { rows: [tokenRow] };
    if (sql.includes("SELECT receipt.receipt_id"))
      return { rows: state.replay ? [{ receipt_id: receiptId }] : [] };
    if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
      return { rows: [{ deletion_fence: "0", fact_id: factId, fact_revision: "1" }] };
    if (sql.includes("FROM continuity.hackathon_receipt_withheld"))
      return {
        rows: [
          {
            deletion_fence: "0",
            fact_id: withheldFactId,
            fact_revision: "2",
            reason: "sensitivity_policy",
          },
        ],
      };
    if (sql.includes("SELECT 1 AS collision")) return empty;
    if (sql.includes("FROM continuity.hackathon_provider_reservations")) return { rows: [{}] };
    if (sql.includes("FROM continuity.hackathon_sessions"))
      return { rows: [{ deletion_fence: state.fence ?? "0" }] };
    if (sql.includes("FROM continuity.memory_facts"))
      return {
        rows: [
          sql.includes("sensitivity='restricted'")
            ? { deletion_fence: "0", fact_id: withheldFactId, fact_revision: "2" }
            : { deletion_fence: "0", fact_id: factId, fact_revision: "1" },
        ],
      };
    return empty;
  }

  it("atomically persists receipt metadata, response payload, and lineage", async () => {
    const pool = fakePool((sql) => finalizeRows(sql));
    await expect(repository(pool).finalizeAnswerReceipt(receiptInput)).resolves.toEqual({
      outcome: "succeeded",
      receiptId,
      responseBody: "synthetic answer",
    });
    const inserts = writes(pool).map(({ sql }) => sql);
    expect(inserts.some((sql) => sql.includes("hackathon_answer_receipts"))).toBe(true);
    expect(inserts.some((sql) => sql.includes("hackathon_response_payloads"))).toBe(true);
    expect(inserts.some((sql) => sql.includes("hackathon_receipt_revisions"))).toBe(true);
    expect(inserts.some((sql) => sql.includes("hackathon_receipt_withheld"))).toBe(true);
    expect(inserts.findIndex((sql) => sql.includes("answer_receipts"))).toBeLessThan(
      inserts.findIndex((sql) => sql.includes("response_payloads")),
    );
  });

  it("exactly replays a receipt and blocks fence drift without inserts", async () => {
    const replay = fakePool((sql) => finalizeRows(sql, { replay: true }));
    await expect(repository(replay).finalizeAnswerReceipt(receiptInput)).resolves.toEqual({
      outcome: "replayed",
      receiptId,
      responseBody: "synthetic answer",
    });
    expect(writes(replay)).toHaveLength(0);

    const drift = fakePool((sql) => finalizeRows(sql, { fence: "1" }));
    await expect(repository(drift).finalizeAnswerReceipt(receiptInput)).resolves.toEqual({
      outcome: "conflict",
    });
    expect(writes(drift)).toHaveLength(0);
  });

  it("rejects cross-lineage duplicates and fence mismatch before checkout", async () => {
    for (const input of [
      {
        ...receiptInput,
        expectedWithheld: [
          { deletionFence: "0", factId, reason: "sensitivity_policy", revision: "1" },
        ],
      },
      {
        ...receiptInput,
        expectedActiveRevisions: [{ deletionFence: "1", factId, revision: "1" }],
      },
    ]) {
      const pool = fakePool();
      await expect(repository(pool).finalizeAnswerReceipt(input)).resolves.toEqual({
        outcome: "denied",
        reason: "invalid_input",
      });
      expect(pool.connects).toBe(0);
    }
  });

  it("compares receipt revisions numerically for exact 2/10 replay", async () => {
    const expectedActiveRevisions = [
      { deletionFence: "0", factId, revision: "10" },
      { deletionFence: "0", factId, revision: "2" },
    ];
    const pool = fakePool((sql) => {
      if (isAuth(sql)) return { rows: [tokenRow] };
      if (sql.includes("SELECT receipt.receipt_id")) return { rows: [{ receipt_id: receiptId }] };
      if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
        return {
          rows: [
            { deletion_fence: "0", fact_id: factId, fact_revision: "10" },
            { deletion_fence: "0", fact_id: factId, fact_revision: "2" },
          ],
        };
      if (sql.includes("FROM continuity.hackathon_receipt_withheld")) return empty;
      return empty;
    });
    await expect(
      repository(pool).finalizeAnswerReceipt({
        ...receiptInput,
        expectedActiveRevisions,
        expectedWithheld: [],
      }),
    ).resolves.toEqual({ outcome: "replayed", receiptId, responseBody: "synthetic answer" });
  });

  it("runs fixed correction once, exactly replays, and rejects a conflicting tuple", async () => {
    const success = fakePool((sql) => {
      if (isAuth(sql) || sql.includes("step_name='correct' AND request_digest"))
        return { rows: [{}] };
      if (sql.startsWith("UPDATE continuity.memory_facts"))
        return { rows: [{ fact_revision: "1" }] };
      return empty;
    });
    await expect(repository(success).correct(correctionInput)).resolves.toEqual({
      outcome: "succeeded",
      revision: "2",
    });
    expect(writes(success)).toHaveLength(4);

    const effect = {
      attempt_id: attemptId,
      disposition: "supersede",
      fact_id: factId,
      from_revision: "1",
      operation_id: operationId,
      request_digest: requestDigest,
      to_revision: "2",
    };
    const replay = fakePool((sql) =>
      isAuth(sql)
        ? { rows: [tokenRow] }
        : sql.includes("FROM continuity.hackathon_effect_results")
          ? { rows: [effect] }
          : empty,
    );
    await expect(repository(replay).correct(correctionInput)).resolves.toEqual({
      outcome: "replayed",
      revision: "2",
    });
    expect(writes(replay)).toHaveLength(0);

    const conflict = fakePool((sql) =>
      isAuth(sql)
        ? { rows: [tokenRow] }
        : sql.includes("FROM continuity.hackathon_effect_results")
          ? { rows: [{ ...effect, attempt_id: "9".repeat(48) }] }
          : empty,
    );
    await expect(repository(conflict).correct(correctionInput)).resolves.toEqual({
      outcome: "conflict",
    });
    expect(writes(conflict)).toHaveLength(0);
  });

  it("returns the latest separately stored response for an exact reservation", async () => {
    const pool = fakePool((sql) => {
      if (isAuth(sql) || sql.includes("step_name='latest_receipt'")) return { rows: [{}] };
      if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
        return { rows: [{ deletion_fence: "0", fact_id: factId, fact_revision: "1" }] };
      if (sql.includes("FROM continuity.hackathon_receipt_withheld"))
        return {
          rows: [
            {
              deletion_fence: "0",
              fact_id: withheldFactId,
              fact_revision: "2",
              reason: "sensitivity_policy",
            },
          ],
        };
      if (sql.includes("ORDER BY receipt.created_at DESC"))
        return {
          rows: [
            {
              context_compiler_version: "compiler-v1",
              deletion_fence: "0",
              embedding_model_id: "amazon.titan-embed-text-v2:0",
              embedding_space: "zc.bedrock-titan-v2.1024",
              input_tokens: "2",
              latency_ms: "7",
              model_id: "amazon.nova-lite-v1:0",
              output_tokens: "3",
              policy_version: "policy-v1",
              provider_request_id: "provider-request",
              receipt_id: receiptId,
              retrieval_config_version: "retrieval-v1",
              response_body: "synthetic answer",
              step_name: "ask_before",
              total_tokens: "5",
            },
          ],
        };
      return empty;
    });
    await expect(repository(pool).latestReceipt(ids)).resolves.toEqual({
      inputTokens: 2,
      latencyMs: 7,
      contextCompilerVersion: "compiler-v1",
      deletionFence: "0",
      embeddingModelId: "amazon.titan-embed-text-v2:0",
      embeddingSpace: "zc.bedrock-titan-v2.1024",
      modelId: "amazon.nova-lite-v1:0",
      outcome: "succeeded",
      outputTokens: 3,
      policyVersion: "policy-v1",
      providerRequestId: "provider-request",
      receiptId,
      recalled: [{ deletionFence: "0", factId, revision: "1" }],
      retrievalConfigVersion: "retrieval-v1",
      responseBody: "synthetic answer",
      step: "ask_before",
      totalTokens: 5,
      withheld: [
        { deletionFence: "0", factId: withheldFactId, reason: "sensitivity_policy", revision: "2" },
      ],
    });
  });

  it("replays only stored receipt versions and content-free lineage", async () => {
    const pool = fakePool((sql) => {
      if (isAuth(sql)) return { rows: [tokenRow] };
      if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
        return { rows: [{ deletion_fence: "0", fact_id: factId, fact_revision: "1" }] };
      if (sql.includes("FROM continuity.hackathon_receipt_withheld"))
        return {
          rows: [
            {
              deletion_fence: "0",
              fact_id: withheldFactId,
              fact_revision: "2",
              reason: "sensitivity_policy",
            },
          ],
        };
      if (sql.includes("FROM continuity.hackathon_answer_receipts"))
        return {
          rows: [
            {
              context_compiler_version: "compiler-v1",
              deletion_fence: "0",
              embedding_model_id: "amazon.titan-embed-text-v2:0",
              embedding_space: "zc.bedrock-titan-v2.1024",
              input_tokens: "2",
              latency_ms: "7",
              model_id: "amazon.nova-lite-v1:0",
              output_tokens: "3",
              policy_version: "policy-v1",
              provider_request_id: "provider-request",
              receipt_id: receiptId,
              retrieval_config_version: "retrieval-v1",
              response_body: "synthetic answer",
              step_name: "ask_before",
              total_tokens: "5",
            },
          ],
        };
      return empty;
    });
    const result = await repository(pool).replayAnswer({ ...ids, step: "ask_before" });
    expect(result).toMatchObject({
      contextCompilerVersion: "compiler-v1",
      deletionFence: "0",
      embeddingSpace: "zc.bedrock-titan-v2.1024",
      outcome: "replayed",
      recalled: [{ deletionFence: "0", factId, revision: "1" }],
      retrievalConfigVersion: "retrieval-v1",
      withheld: [
        { deletionFence: "0", factId: withheldFactId, reason: "sensitivity_policy", revision: "2" },
      ],
    });
    expect(pool.calls.some(({ sql }) => sql.includes("FROM continuity.memory_facts"))).toBe(false);
    expect(JSON.stringify(result.withheld)).not.toMatch(/content|embedding/u);
  });

  it("fails closed on proxy and sparse driver lineage, and canonicalizes numeric row order", async () => {
    const answer = {
      context_compiler_version: "compiler-v1",
      deletion_fence: "0",
      embedding_model_id: "amazon.titan-embed-text-v2:0",
      embedding_space: "zc.bedrock-titan-v2.1024",
      input_tokens: "2",
      latency_ms: "7",
      model_id: "amazon.nova-lite-v1:0",
      output_tokens: "3",
      policy_version: "policy-v1",
      provider_request_id: "provider-request",
      receipt_id: receiptId,
      retrieval_config_version: "retrieval-v1",
      response_body: "synthetic answer",
      step_name: "ask_before",
      total_tokens: "5",
    };
    for (const hostileRows of [new Proxy([{}], {}), Object.assign(Array(1), {})]) {
      const pool = fakePool((sql) => {
        if (isAuth(sql)) return { rows: [tokenRow] };
        if (sql.includes("FROM continuity.hackathon_answer_receipts")) return { rows: [answer] };
        if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
          return { rows: hostileRows };
        return empty;
      });
      await expect(repository(pool).replayAnswer({ ...ids, step: "ask_before" })).resolves.toEqual({
        outcome: "conflict",
      });
    }

    const pool = fakePool((sql) => {
      if (isAuth(sql)) return { rows: [tokenRow] };
      if (sql.includes("FROM continuity.hackathon_answer_receipts")) return { rows: [answer] };
      if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
        return {
          rows: [
            { deletion_fence: "0", fact_id: factId, fact_revision: "10" },
            { deletion_fence: "0", fact_id: factId, fact_revision: "2" },
          ],
        };
      return empty;
    });
    await expect(
      repository(pool).replayAnswer({ ...ids, step: "ask_before" }),
    ).resolves.toMatchObject({
      recalled: [
        { deletionFence: "0", factId, revision: "2" },
        { deletionFence: "0", factId, revision: "10" },
      ],
    });
  });

  it("rejects sparse, proxy, and accessor inputs before pool checkout", async () => {
    const pool = fakePool();
    const sparse = Array(1024);
    sparse[0] = 1;
    const proxy = new Proxy([embedding, embedding, embedding], {});
    const accessor = {};
    Object.defineProperty(accessor, "factId", { enumerable: true, get: () => factId });
    Object.assign(accessor, { deletionFence: "0", revision: "1" });

    const outcomes = await Promise.all([
      repository(pool).retrieveSnapshot({
        accessTier: "standard",
        embedding: sparse,
        sessionDigest,
        topK: 1,
      }),
      repository(pool).storeInitialFacts({ ...ids, embeddings: proxy }),
      repository(pool).finalizeAnswerReceipt({
        ...receiptInput,
        expectedActiveRevisions: [accessor],
      }),
    ]);
    expect(outcomes).toEqual(Array(3).fill({ outcome: "denied", reason: "invalid_input" }));
    expect(pool.connects).toBe(0);
  });
});
