import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHackathonCrdbRepository } from "../../packages/adapters-local/src/hackathon-crdb.js";
import {
  compileHackathonContext,
  createHackathonLive,
  hackathonLiveProfile,
} from "../../packages/application/src/hackathon-live.js";

const sessionDigest = "a".repeat(64);
const vector = Object.freeze([1, ...Array(1023).fill(0)]);
const restrictedId = "2".repeat(48);
const launchId = "1".repeat(48);
const evidenceId = "3".repeat(48);
const restrictedSentinel = "Internal budget ceiling is nine units — restricted synthetic";
const sha256 = async (value) => createHash("sha256").update(value, "utf8").digest("hex");

function embedding(scope, decisionId) {
  return {
    attemptId: scope.attemptId,
    latencyMs: 3,
    modelId: hackathonLiveProfile.titanModel,
    operation: "embedding",
    outcome: "succeeded",
    policyDecisionId: decisionId,
    policyVersion: hackathonLiveProfile.policyVersion,
    region: "us-east-1",
    requestId: `request-${decisionId}`,
    stopReason: "completed",
    usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
    vector,
  };
}

function generation(scope, decisionId, text) {
  return {
    attemptId: scope.attemptId,
    latencyMs: 7,
    modelId: hackathonLiveProfile.novaModel,
    operation: "generation",
    outcome: "succeeded",
    policyDecisionId: decisionId,
    policyVersion: hackathonLiveProfile.policyVersion,
    region: "us-east-1",
    requestId: `request-${decisionId}`,
    stopReason: "end_turn",
    text,
    usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  };
}

function replay(receiptId, step, overrides = {}) {
  return {
    contextCompilerVersion: hackathonLiveProfile.compilerVersion,
    deletionFence: "0",
    embeddingModelId: hackathonLiveProfile.titanModel,
    embeddingSpace: hackathonLiveProfile.embeddingSpace,
    inputTokens: 1,
    latencyMs: 1,
    modelId: hackathonLiveProfile.novaModel,
    outcome: "replayed",
    outputTokens: 1,
    policyVersion: hackathonLiveProfile.policyVersion,
    providerRequestId: "request",
    recalled: [{ deletionFence: "0", factId: launchId, revision: "1" }],
    receiptId,
    responseBody: "safe",
    retrievalConfigVersion: hackathonLiveProfile.retrievalVersion,
    step,
    totalTokens: 2,
    withheld: [],
    ...overrides,
  };
}

function authorizedPolicy(events) {
  return {
    authorize(request) {
      events.push({ kind: "retrieval_policy", request });
      return { ...request, decisionId: `retrieval-${events.length}`, outcome: "authorized" };
    },
  };
}

function harness(overrides = {}) {
  const events = [];
  const prompts = [];
  const embeddings = [];
  const scopes = [];
  let corrected = false;
  let latest;
  let providerDecision = 0;
  const store = {
    async startSession(input) {
      events.push({ input, kind: "start_session" });
      return { outcome: "succeeded", tenantId: sessionDigest.slice(0, 48) };
    },
    async storeInitialFacts(input) {
      events.push({ input, kind: "store_initial" });
      return { outcome: "succeeded" };
    },
    async replayAnswer(input) {
      events.push({ input, kind: "replay" });
      return { outcome: "conflict" };
    },
    async reserveOperation(input) {
      events.push({ input, kind: "reserve" });
      return {
        nova: input.step.startsWith("ask") ? 1 : 0,
        outcome: "succeeded",
        titan: input.step === "latest_receipt" ? 0 : 1,
      };
    },
    async retrieveSnapshot(input) {
      events.push({ input, kind: "retrieve" });
      return {
        authorized: [
          {
            content: "Judges query disclosure receipts through Managed MCP read-only",
            deletionFence: "0",
            factId: evidenceId,
            revision: "1",
            similarity: 0.7,
          },
          {
            content: corrected
              ? "Fenced launch day is sunday for the hackathon demo"
              : "Fenced launch day is monday for the hackathon demo",
            deletionFence: "0",
            factId: launchId,
            revision: corrected ? "2" : "1",
            similarity: 0.9,
          },
        ],
        deletionFence: "0",
        outcome: "succeeded",
        withheld: [
          {
            deletionFence: "0",
            factId: restrictedId,
            reason: "sensitivity_policy",
            revision: "1",
            similarity: 0.8,
          },
        ],
      };
    },
    async finalizeAnswerReceipt(input) {
      events.push({ input, kind: "finalize" });
      latest = {
        contextCompilerVersion: input.contextCompilerVersion,
        deletionFence: input.deletionFence,
        embeddingModelId: input.embeddingModelId,
        embeddingSpace: input.embeddingSpace,
        inputTokens: input.inputTokens,
        latencyMs: input.latencyMs,
        modelId: input.modelId,
        outcome: "succeeded",
        outputTokens: input.outputTokens,
        policyVersion: input.policyVersion,
        providerRequestId: input.providerRequestId,
        recalled: input.expectedActiveRevisions.map(({ deletionFence, factId, revision }) => ({
          deletionFence,
          factId,
          revision,
        })),
        receiptId: input.receiptId,
        responseBody: input.responseBody,
        retrievalConfigVersion: input.retrievalConfigVersion,
        step: input.step,
        totalTokens: input.totalTokens,
        withheld: input.expectedWithheld,
      };
      return overrides.stale
        ? { outcome: "conflict" }
        : { outcome: "succeeded", receiptId: input.receiptId, responseBody: input.responseBody };
    },
    async correct(input) {
      events.push({ input, kind: "correct" });
      corrected = true;
      return { outcome: "succeeded", revision: "2" };
    },
    async latestReceipt(input) {
      events.push({ input, kind: "latest" });
      return latest ?? { outcome: "conflict" };
    },
    ...overrides.store,
  };
  const retrievalPolicy = overrides.retrievalPolicy ?? authorizedPolicy(events);
  const providerFor =
    overrides.providerFor ??
    ((scope) => {
      scopes.push(scope);
      return {
        async embed(text) {
          providerDecision += 1;
          embeddings.push(text);
          events.push({ kind: "embed", text });
          return embedding(scope, `embedding-${providerDecision}`);
        },
        async generate(prompt) {
          providerDecision += 1;
          prompts.push(prompt);
          events.push({ kind: "generate", prompt });
          const answer = prompt.includes("sunday")
            ? "Launch day is Sunday; judges use read-only Managed MCP receipts."
            : "Launch day is Monday; judges use read-only Managed MCP receipts.";
          return generation(scope, `generation-${providerDecision}`, answer);
        },
      };
    });
  return {
    embeddings,
    events,
    live: createHackathonLive({ providerFor, retrievalPolicy, sha256, store }),
    prompts,
    scopes,
  };
}

async function deterministicReceiptId(step = "ask_before") {
  const test = harness();
  await test.live.run({ sessionDigest, step });
  return test.events.find(({ kind }) => kind === "finalize")?.input.receiptId;
}

describe("governed hackathon live orchestrator", () => {
  it("runs all five fixed steps with the exact provider budget and revision transition", async () => {
    const test = harness();
    await expect(test.live.run({ sessionDigest, step: "start" })).resolves.toEqual({
      outcome: "succeeded",
      step: "start",
    });
    const before = await test.live.run({ sessionDigest, step: "ask_before" });
    expect(before).toMatchObject({
      answer: expect.stringContaining("Monday"),
      outcome: "succeeded",
      recalled: [
        { factId: launchId, revision: "1" },
        { factId: evidenceId, revision: "1" },
      ],
      withheld: [{ factId: restrictedId, reason: "sensitivity_policy", revision: "1" }],
    });
    await expect(test.live.run({ sessionDigest, step: "correct" })).resolves.toEqual({
      outcome: "succeeded",
      revision: "2",
      step: "correct",
    });
    const after = await test.live.run({ sessionDigest, step: "ask_after" });
    expect(after).toMatchObject({
      answer: expect.stringContaining("Sunday"),
      recalled: [
        { factId: launchId, revision: "2" },
        { factId: evidenceId, revision: "1" },
      ],
    });
    await expect(test.live.run({ sessionDigest, step: "latest_receipt" })).resolves.toMatchObject({
      answer: expect.stringContaining("Sunday"),
      outcome: "succeeded",
      step: "latest_receipt",
    });

    expect(test.embeddings).toHaveLength(6);
    expect(test.prompts).toHaveLength(2);
    expect(test.embeddings.filter((text) => text === restrictedSentinel)).toHaveLength(1);
    expect(test.embeddings.slice(3)).not.toContain(restrictedSentinel);
    expect(test.prompts.join("\n")).not.toContain(restrictedSentinel);
    expect(JSON.stringify({ before, after })).not.toContain(restrictedSentinel);
    expect(test.events.filter(({ kind }) => kind === "retrieval_policy")).toHaveLength(2);
    expect(test.events.filter(({ kind }) => kind === "finalize")).toHaveLength(2);
  });

  it("authorizes retrieval before query embedding and searching, then binds a fresh generation scope", async () => {
    const test = harness();
    await test.live.run({ sessionDigest, step: "ask_before" });
    const kinds = test.events.map(({ kind }) => kind);
    expect(kinds.indexOf("reserve")).toBeLessThan(kinds.indexOf("retrieval_policy"));
    expect(kinds.indexOf("retrieval_policy")).toBeLessThan(kinds.indexOf("embed"));
    expect(kinds.indexOf("embed")).toBeLessThan(kinds.indexOf("retrieve"));
    expect(kinds.indexOf("retrieve")).toBeLessThan(kinds.indexOf("generate"));
    expect(kinds.indexOf("generate")).toBeLessThan(kinds.indexOf("finalize"));
    expect(test.scopes).toHaveLength(2);
    expect(test.scopes[0].activeMemoryRevisionIds).toEqual([]);
    expect(test.scopes[1].activeMemoryRevisionIds).toEqual([
      `${launchId}:1:0`,
      `${evidenceId}:1:0`,
    ]);
  });

  it("returns a durable ask replay without policy, retrieval, or provider work", async () => {
    const receiptId = await deterministicReceiptId();
    const stored = replay(receiptId, "ask_before", {
      inputTokens: 5,
      latencyMs: 7,
      outputTokens: 3,
      providerRequestId: "provider-request",
      recalled: [{ deletionFence: "0", factId: launchId, revision: "1" }],
      responseBody: "Stored answer",
      totalTokens: 8,
      withheld: [
        { deletionFence: "0", factId: restrictedId, reason: "sensitivity_policy", revision: "1" },
      ],
    });
    const test = harness({
      providerFor() {
        throw new Error("provider must not be created");
      },
      store: {
        async replayAnswer(_input) {
          return stored;
        },
      },
    });
    await expect(test.live.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
      answer: "Stored answer",
      outcome: "succeeded",
    });
    expect(test.events.filter(({ kind }) => kind === "reserve")).toHaveLength(0);
  });

  it("accepts the real CRDB replay DTO across the E2/E3 seam with zero providers", async () => {
    const probe = harness();
    await probe.live.run({ sessionDigest, step: "ask_before" });
    const replayInput = probe.events.find(({ kind }) => kind === "replay")?.input;
    const receiptId = probe.events.find(({ kind }) => kind === "finalize")?.input.receiptId;
    const calls = [];
    const pool = {
      async connect() {
        return {
          async query(sql) {
            calls.push(sql);
            if (sql.includes("FROM continuity.hackathon_session_tokens")) return { rows: [{}] };
            if (sql.includes("step_name='latest_receipt'")) return { rows: [{}] };
            if (sql.includes("FROM continuity.hackathon_receipt_revisions"))
              return { rows: [{ deletion_fence: "0", fact_id: launchId, fact_revision: "1" }] };
            if (sql.includes("FROM continuity.hackathon_receipt_withheld"))
              return {
                rows: [
                  {
                    deletion_fence: "0",
                    fact_id: restrictedId,
                    fact_revision: "1",
                    reason: "sensitivity_policy",
                  },
                ],
              };
            if (sql.includes("FROM continuity.hackathon_answer_receipts"))
              return {
                rows: [
                  {
                    context_compiler_version: hackathonLiveProfile.compilerVersion,
                    deletion_fence: "0",
                    embedding_model_id: hackathonLiveProfile.titanModel,
                    embedding_space: hackathonLiveProfile.embeddingSpace,
                    input_tokens: "5",
                    latency_ms: "7",
                    model_id: hackathonLiveProfile.novaModel,
                    output_tokens: "3",
                    policy_version: hackathonLiveProfile.policyVersion,
                    provider_request_id: "durable-provider-request",
                    receipt_id: receiptId,
                    retrieval_config_version: hackathonLiveProfile.retrievalVersion,
                    response_body: "Stored cross-seam answer",
                    step_name: "ask_before",
                    total_tokens: "8",
                  },
                ],
              };
            return { rows: [] };
          },
          release() {},
        };
      },
    };
    const store = createHackathonCrdbRepository({ pool, sleep: async () => undefined });
    const dto = await store.replayAnswer(replayInput);
    expect(dto).toEqual(expect.objectContaining({ outcome: "replayed", receiptId }));
    const live = createHackathonLive({
      providerFor() {
        throw new Error("provider must not run");
      },
      retrievalPolicy: {
        authorize: () => {
          throw new Error("policy must not run");
        },
      },
      sha256,
      store: {
        ...store,
        async reserveOperation(input) {
          return input.step === "latest_receipt"
            ? { nova: 0, outcome: "succeeded", titan: 0 }
            : store.reserveOperation(input);
        },
      },
    });
    await expect(live.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
      answer: "Stored cross-seam answer",
      recalled: [{ factId: launchId, revision: "1" }],
      withheld: [{ factId: restrictedId, reason: "sensitivity_policy", revision: "1" }],
    });
    expect(calls.some((sql) => sql.includes("FROM continuity.memory_facts"))).toBe(false);
    await expect(live.run({ sessionDigest, step: "latest_receipt" })).resolves.toMatchObject({
      answer: "Stored cross-seam answer",
      recalled: [{ factId: launchId, revision: "1" }],
      step: "latest_receipt",
    });
  });

  it.each(["start", "correct"])("fails a replayed %s step without provider work", async (step) => {
    let providers = 0;
    const method = step === "start" ? "startSession" : "reserveOperation";
    const test = harness({
      providerFor() {
        providers += 1;
        throw new Error("provider must not be created");
      },
      store: {
        async [method]() {
          return step === "start"
            ? { outcome: "replayed" }
            : { nova: 0, outcome: "replayed", titan: 1 };
        },
      },
    });
    await expect(test.live.run({ sessionDigest, step })).resolves.toEqual({
      code: "incomplete_prior_attempt",
      outcome: "conflict",
      step,
    });
    expect(providers).toBe(0);
  });

  it("fails before provider/search when retrieval policy denies", async () => {
    const test = harness({
      retrievalPolicy: { authorize: () => ({ outcome: "denied" }) },
    });
    await expect(test.live.run({ sessionDigest, step: "ask_before" })).resolves.toEqual({
      code: "policy_denied",
      outcome: "denied",
      step: "ask_before",
    });
    expect(test.embeddings).toHaveLength(0);
    expect(test.events.some(({ kind }) => kind === "retrieve")).toBe(false);
  });

  it("never releases an answer when final revision/fence validation is stale", async () => {
    const test = harness({ stale: true });
    const result = await test.live.run({ sessionDigest, step: "ask_before" });
    expect(result).toEqual({
      code: "stale_snapshot",
      outcome: "stale",
      step: "ask_before",
    });
    expect(result).not.toHaveProperty("answer");
  });

  it("resolves an ambiguous finalize only by exact re-finalization", async () => {
    let finalizes = 0;
    let replays = 0;
    let exactInput;
    const test = harness({
      store: {
        async finalizeAnswerReceipt(input) {
          finalizes += 1;
          exactInput ??= input;
          expect(input).toEqual(exactInput);
          return finalizes === 1
            ? { outcome: "unknown" }
            : { outcome: "replayed", receiptId: input.receiptId, responseBody: input.responseBody };
        },
        async replayAnswer(input) {
          replays += 1;
          return replays === 1
            ? { outcome: "conflict" }
            : {
                contextCompilerVersion: "mutated",
                outcome: "replayed",
                receiptId: input.receiptId,
                responseBody: "Launch day is Monday; judges use read-only Managed MCP receipts.",
              };
        },
      },
    });
    await expect(test.live.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
      answer: expect.stringContaining("Monday"),
      outcome: "succeeded",
    });
    expect(finalizes).toBe(2);
    expect(replays).toBe(1);
    expect(test.prompts).toHaveLength(1);
  });

  it("pins the dataset version into stable deterministic operation tuples", async () => {
    const first = harness();
    const second = harness();
    await first.live.run({ sessionDigest, step: "ask_before" });
    await second.live.run({ sessionDigest, step: "ask_before" });
    const firstCall = first.events.find(({ kind }) => kind === "reserve")?.input;
    const secondCall = second.events.find(({ kind }) => kind === "reserve")?.input;
    expect(hackathonLiveProfile.datasetVersion).toBe("zc.demo-dataset.v1");
    expect(firstCall).toEqual(secondCall);
    expect(firstCall).toMatchObject({
      attemptId: expect.stringMatching(/^[0-9a-f]{48}$/u),
      operationId: expect.stringMatching(/^[0-9a-f]{48}$/u),
      requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("does not retry an ambiguous provider transmission", async () => {
    let calls = 0;
    const test = harness({
      providerFor(scope) {
        return {
          async embed() {
            calls += 1;
            return {
              attemptId: scope.attemptId,
              code: "provider_outcome_unknown",
              modelId: hackathonLiveProfile.titanModel,
              operation: "embedding",
              outcome: "unknown",
              policyDecisionId: "decision-unknown",
              policyVersion: hackathonLiveProfile.policyVersion,
              region: "us-east-1",
            };
          },
          async generate() {
            throw new Error("generation must not run");
          },
        };
      },
    });
    await expect(test.live.run({ sessionDigest, step: "ask_before" })).resolves.toEqual({
      code: "provider_outcome_unknown",
      outcome: "unknown",
      step: "ask_before",
    });
    expect(calls).toBe(1);
  });

  it("compiles byte-identical authorized context regardless of row order", () => {
    const first = {
      content: "A",
      deletionFence: "0",
      factId: launchId,
      revision: "1",
    };
    const second = {
      content: "B",
      deletionFence: "0",
      factId: evidenceId,
      revision: "1",
    };
    expect(compileHackathonContext([second, first])).toBe(compileHackathonContext([first, second]));
  });

  it("rejects extra fields and hostile proxies with one content-free error", async () => {
    const test = harness();
    await expect(
      test.live.run({ arbitraryText: "send me", sessionDigest, step: "ask_before" }),
    ).resolves.toEqual({ code: "invalid_input", outcome: "denied", step: "start" });
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(restrictedSentinel);
        },
      },
    );
    await expect(test.live.run(hostile)).resolves.toEqual({
      code: "invalid_input",
      outcome: "denied",
      step: "start",
    });
  });

  it("binds the exact pre-retrieval request and rejects allowance drift before providers", async () => {
    let request;
    let providers = 0;
    const test = harness({
      providerFor() {
        providers += 1;
        throw new Error("not reached");
      },
      retrievalPolicy: {
        authorize(value) {
          request = value;
          return { ...value, decisionId: "decision", outcome: "authorized" };
        },
      },
      store: { reserveOperation: async () => ({ nova: 0, outcome: "succeeded", titan: 1 }) },
    });
    await expect(test.live.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
      code: "store_unavailable",
    });
    expect(providers).toBe(0);
    expect(request).toBeUndefined();

    const authorized = harness({
      retrievalPolicy: {
        authorize(value) {
          request = value;
          return { ...value, decisionId: "decision", outcome: "authorized" };
        },
      },
    });
    await authorized.live.run({ sessionDigest, step: "ask_before" });
    expect(request).toMatchObject({
      contextCompilerVersion: hackathonLiveProfile.compilerVersion,
      embeddingSpaceVersion: hackathonLiveProfile.embeddingSpace,
      query: hackathonLiveProfile.question,
      queryDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      queryProjection: "authorized-body+restricted-metadata",
      topK: 3,
    });
  });

  it.each([
    ["restricted authorized ID", { authorized: [{ factId: restrictedId }] }],
    ["bad similarity", { authorized: [{ similarity: 2 }] }],
    ["bad fence", { deletionFence: "18446744073709551616" }],
    ["duplicate tuple", { duplicate: true }],
  ])("rejects an adversarial snapshot: %s", async (_name, mutation) => {
    const test = harness({
      store: {
        async retrieveSnapshot() {
          const authorized = [
            {
              content: "Fenced launch day is monday for the hackathon demo",
              deletionFence: "0",
              factId: launchId,
              revision: "1",
              similarity: 0.9,
              ...mutation.authorized?.[0],
            },
          ];
          if (mutation.duplicate) authorized.push({ ...authorized[0] });
          return {
            authorized,
            deletionFence: mutation.deletionFence ?? "0",
            outcome: "succeeded",
            withheld: [],
          };
        },
      },
    });
    const result = await test.live.run({ sessionDigest, step: "ask_before" });
    expect(result).toMatchObject({ code: "store_unavailable" });
    expect(test.prompts).toHaveLength(0);
  });

  it("rejects replay leakage, stale versions, and a mismatched deterministic receipt", async () => {
    const receiptId = await deterministicReceiptId();
    for (const override of [
      { responseBody: restrictedSentinel },
      { responseBody: `unsafe ${restrictedId} disclosure` },
      { contextCompilerVersion: "stale" },
      { receiptId: "f".repeat(48) },
      { recalled: [{ deletionFence: "0", factId: restrictedId, revision: "1" }] },
      { recalled: [{ deletionFence: "1", factId: launchId, revision: "1" }] },
    ]) {
      const test = harness({
        providerFor() {
          throw new Error("provider must not run for replay");
        },
        store: {
          async replayAnswer(input) {
            return replay(receiptId, input.step, override);
          },
        },
      });
      await expect(test.live.run({ sessionDigest, step: "ask_before" })).resolves.toMatchObject({
        code: "store_unavailable",
      });
    }
  });
});
