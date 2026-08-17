import { describe, expect, it, vi } from "vitest";
import {
  bedrockHackathonProfile,
  createBedrockPorts,
} from "../../packages/adapters-local/src/h4-bedrock-ports.js";

const scope = Object.freeze({
  activeMemoryRevisionIds: Object.freeze(["2", "5"]),
  attemptId: "attempt-1",
  contextCompilerVersion: "context.v1",
  dataClassification: "synthetic",
  deletionFence: "delete-fence.v1",
  embeddingSpaceVersion: "zc.bedrock-titan-v2.1024",
  purpose: "hackathon-demo",
  policyVersion: "synthetic-policy.v1",
  retrievalConfigVersion: "retrieval.v1",
  tenantId: "synthetic-tenant",
});

function authorizedDecision(request, overrides = {}) {
  return {
    ...request,
    decisionId: "decision-1",
    expiresAt: Date.now() + 30_000,
    issuedAt: Date.now() - 1,
    outcome: "authorized",
    ...overrides,
  };
}

const authorizedPolicy = Object.freeze({
  authorize: async (request) => authorizedDecision(request),
});

function embeddingResponse(vector = new Array(1024).fill(0.25)) {
  return {
    $metadata: { requestId: "embed-request-1" },
    body: new TextEncoder().encode(JSON.stringify({ embedding: vector, inputTextTokenCount: 3 })),
  };
}

function generationResponse(overrides = {}) {
  return {
    $metadata: { requestId: "generate-request-1" },
    metrics: { latencyMs: 12 },
    output: { message: { content: [{ text: "Synthetic response." }], role: "assistant" } },
    stopReason: "end_turn",
    usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    ...overrides,
  };
}

describe("h4 Bedrock ports", () => {
  it("pins a single physical attempt for the primary provider", () => {
    expect(bedrockHackathonProfile.maximumAttempts).toBe(1);
    expect(bedrockHackathonProfile.destination).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com",
    );
  });

  it("requests normalized Titan v2 embeddings and validates all 1024 dimensions", async () => {
    let command;
    let options;
    const ports = createBedrockPorts(scope, authorizedPolicy, async (request, sendOptions) => {
      command = request;
      options = sendOptions;
      return embeddingResponse();
    });

    const result = await ports.embed.embed("synthetic only");
    expect(result).toMatchObject({
      attemptId: "attempt-1",
      modelId: bedrockHackathonProfile.embeddingModelId,
      operation: "embedding",
      outcome: "succeeded",
      policyDecisionId: "decision-1",
      policyVersion: "synthetic-policy.v1",
      region: "us-east-1",
      requestId: "embed-request-1",
      stopReason: "completed",
      usage: { inputTokens: 3, outputTokens: 0, totalTokens: 3 },
    });
    expect(result.vector).toHaveLength(1024);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(command.constructor.name).toBe("InvokeModelCommand");
    expect(JSON.parse(command.input.body)).toEqual({
      dimensions: 1024,
      inputText: "synthetic only",
      normalize: true,
    });
    expect(command.input.modelId).toBe(bedrockHackathonProfile.embeddingModelId);
  });

  it("uses bounded deterministic Nova generation and accepts only text output", async () => {
    let command;
    const ports = createBedrockPorts(scope, authorizedPolicy, async (request) => {
      command = request;
      return generationResponse();
    });

    await expect(ports.generate.generate("summarize only disclosed facts")).resolves.toEqual({
      attemptId: "attempt-1",
      latencyMs: 12,
      modelId: bedrockHackathonProfile.generationModelId,
      operation: "generation",
      outcome: "succeeded",
      policyDecisionId: "decision-1",
      policyVersion: "synthetic-policy.v1",
      region: "us-east-1",
      requestId: "generate-request-1",
      stopReason: "end_turn",
      text: "Synthetic response.",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
    expect(command.constructor.name).toBe("ConverseCommand");
    expect(command.input.inferenceConfig).toEqual({ maxTokens: 256, temperature: 0 });
    expect(command.input.modelId).toBe(bedrockHackathonProfile.generationModelId);
  });

  it("fails closed for bad output, empty input, oversized input, and SDK errors", async () => {
    const badOutput = createBedrockPorts(scope, authorizedPolicy, async () =>
      embeddingResponse([1]),
    );
    const unavailable = createBedrockPorts(scope, authorizedPolicy, async () => {
      throw new Error("synthetic_sdk_error");
    });

    await expect(badOutput.embed.embed("synthetic only")).resolves.toEqual({
      code: "invalid_provider_response",
      outcome: "denied",
    });
    await expect(unavailable.generate.generate("prompt")).resolves.toEqual({
      attemptId: "attempt-1",
      code: "provider_outcome_unknown",
      modelId: bedrockHackathonProfile.generationModelId,
      operation: "generation",
      outcome: "unknown",
      policyDecisionId: "decision-1",
      policyVersion: "synthetic-policy.v1",
      region: "us-east-1",
    });
    await expect(unavailable.embed.embed(" ")).resolves.toEqual({
      code: "invalid_request",
      outcome: "denied",
    });
    await expect(unavailable.generate.generate("x".repeat(20_001))).resolves.toEqual({
      code: "invalid_request",
      outcome: "denied",
    });
  });

  it("requires a fresh bound policy authorization before every transmission", async () => {
    let calls = 0;
    const deniedPolicy = {
      authorize: async () => ({ outcome: "denied", policyVersion: "synthetic-policy.v1" }),
    };
    const ports = createBedrockPorts(scope, deniedPolicy, async () => {
      calls += 1;
      return embeddingResponse();
    });

    await expect(ports.embed.embed("synthetic only")).resolves.toEqual({
      code: "policy_denied",
      outcome: "denied",
    });
    expect(calls).toBe(0);
  });

  it("requires the policy decision to bind exact content and governance scope", async () => {
    let sent = 0;
    let seen;
    const alteredDecision = {
      authorize: async (request) => {
        seen = request;
        return authorizedDecision(request, { contentDigest: "0".repeat(64) });
      },
    };
    const ports = createBedrockPorts(scope, alteredDecision, async () => {
      sent += 1;
      return embeddingResponse();
    });

    await expect(ports.embed.embed("synthetic only")).resolves.toEqual({
      code: "policy_denied",
      outcome: "denied",
    });
    expect(sent).toBe(0);
    expect(seen).toMatchObject({
      activeMemoryRevisionIds: ["2", "5"],
      attemptId: "attempt-1",
      content: "synthetic only",
      contentDigestVersion: "sha256-utf8.v1",
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      requestDigestVersion: "zc.bedrock-request-digest.v1",
      requestNonce: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      dataClassification: "synthetic",
      deletionFence: "delete-fence.v1",
      destination: "https://bedrock-runtime.us-east-1.amazonaws.com",
      operation: "embedding",
      policyVersion: "synthetic-policy.v1",
      purpose: "hackathon-demo",
      tenantId: "synthetic-tenant",
    });
    expect(seen.contentDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects stale, mismatched, and structurally widened decisions before dispatch", async () => {
    let sent = 0;
    for (const overrides of [
      { expiresAt: Date.now() - 1, issuedAt: Date.now() - 2 },
      { attemptId: "other-attempt" },
      { policyVersion: "other-policy" },
      { unexpected: true },
    ]) {
      const policy = { authorize: async (request) => authorizedDecision(request, overrides) };
      const ports = createBedrockPorts(scope, policy, async () => {
        sent += 1;
        return embeddingResponse();
      });
      await expect(ports.embed.embed("synthetic only")).resolves.toEqual({
        code: "policy_denied",
        outcome: "denied",
      });
    }
    expect(sent).toBe(0);
  });

  it("rejects malformed Titan and Nova responses", async () => {
    const badEmbeddings = [
      embeddingResponse([1]),
      embeddingResponse([...new Array(1023).fill(0), Number.NaN]),
      { ...embeddingResponse(), $metadata: {} },
      {
        $metadata: { requestId: "embed-request-1" },
        body: new TextEncoder().encode(JSON.stringify({ embedding: new Array(1024).fill(0) })),
      },
    ];
    for (const response of badEmbeddings) {
      const ports = createBedrockPorts(scope, authorizedPolicy, async () => response);
      await expect(ports.embed.embed("synthetic only")).resolves.toEqual({
        code: "invalid_provider_response",
        outcome: "denied",
      });
    }

    const badGenerations = [
      generationResponse({ stopReason: "max_tokens" }),
      generationResponse({ stopReason: "guardrail_intervened" }),
      generationResponse({ output: { message: { content: [{ text: "x" }], role: "user" } } }),
      generationResponse({
        output: { message: { content: [{ text: "x" }, { text: "y" }], role: "assistant" } },
      }),
      generationResponse({ usage: { inputTokens: 4, outputTokens: 2, totalTokens: 7 } }),
      generationResponse({ $metadata: {} }),
    ];
    for (const response of badGenerations) {
      const ports = createBedrockPorts(scope, authorizedPolicy, async () => response);
      await expect(ports.generate.generate("synthetic only")).resolves.toEqual({
        code: "invalid_provider_response",
        outcome: "denied",
      });
    }
  });

  it("aborts a provider call at the bounded deadline", async () => {
    vi.useFakeTimers();
    try {
      let signal;
      const ports = createBedrockPorts(scope, authorizedPolicy, async (_command, options) => {
        signal = options.abortSignal;
        return new Promise(() => {});
      });
      const result = ports.generate.generate("synthetic only");
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(result).resolves.toEqual({
        attemptId: "attempt-1",
        code: "provider_outcome_unknown",
        modelId: bedrockHackathonProfile.generationModelId,
        operation: "generation",
        outcome: "unknown",
        policyDecisionId: "decision-1",
        policyVersion: "synthetic-policy.v1",
        region: "us-east-1",
      });
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hung policy decision without dispatching", async () => {
    vi.useFakeTimers();
    try {
      let sent = 0;
      const ports = createBedrockPorts(
        scope,
        { authorize: async () => new Promise(() => {}) },
        async () => {
          sent += 1;
          return embeddingResponse();
        },
      );
      const result = ports.embed.embed("synthetic only");
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(result).resolves.toEqual({
        code: "authorization_timeout",
        outcome: "denied",
      });
      expect(sent).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes an authorization decision only once", async () => {
    let sent = 0;
    const ports = createBedrockPorts(scope, authorizedPolicy, async () => {
      sent += 1;
      return embeddingResponse();
    });

    await expect(ports.embed.embed("synthetic only")).resolves.toMatchObject({
      outcome: "succeeded",
    });
    await expect(ports.embed.embed("synthetic only")).resolves.toEqual({
      code: "policy_denied",
      outcome: "denied",
    });
    expect(sent).toBe(1);
  });

  it("fails closed for hostile scope and non-string runtime input", async () => {
    let authorized = 0;
    let sent = 0;
    const revocable = Proxy.revocable([], {});
    revocable.revoke();
    const ports = createBedrockPorts(
      { ...scope, activeMemoryRevisionIds: revocable.proxy },
      {
        authorize: async () => {
          authorized += 1;
          return {};
        },
      },
      async () => {
        sent += 1;
        return embeddingResponse();
      },
    );

    await expect(ports.embed.embed("synthetic only")).resolves.toEqual({
      code: "invalid_request",
      outcome: "denied",
    });
    await expect(
      createBedrockPorts(scope, authorizedPolicy, async () => embeddingResponse()).embed.embed(42),
    ).resolves.toEqual({
      code: "invalid_request",
      outcome: "denied",
    });
    expect({ authorized, sent }).toEqual({ authorized: 0, sent: 0 });
  });
});
