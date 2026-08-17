import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createHackathonApi } from "../../apps/api/src/index.js";
import {
  createProductionBedrockSender,
  createProductionHackathonRuntime,
} from "../../apps/api/src/production-runtime.js";
import { createBedrockPorts } from "../../packages/adapters-local/src/h4-bedrock-ports.js";

const validUrl =
  "postgresql://continuity_app:synthetic-password@zc-demo.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";
const input = Object.freeze({ sessionDigest: "a".repeat(64), step: "latest_receipt" });
const event = Object.freeze({
  body: '{"step":"latest_receipt"}',
  cookies: Object.freeze([`__Host-zc-session=${"b".repeat(64)}`]),
  isBase64Encoded: false,
  rawPath: "/api/demo",
  rawQueryString: "",
  requestContext: Object.freeze({ http: Object.freeze({ method: "POST", path: "/api/demo" }) }),
});
const responseHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function runtime(databaseUrl, createPool = vi.fn(() => ({ connect: vi.fn() }))) {
  const sender = vi.fn();
  return {
    createPool,
    runtime: createProductionHackathonRuntime({ createPool, databaseUrl, sender }),
    sender,
  };
}

describe("H16C asm-exec-compatible production composition", () => {
  it("is lazy, creates one pool, and reuses the one runtime", async () => {
    class PoolShape {
      connect() {
        throw new Error("unexpected_connect");
      }
    }
    const databaseUrl = vi.fn(() => validUrl);
    const connect = vi.spyOn(PoolShape.prototype, "connect");
    const pool = new PoolShape();
    expect(Object.hasOwn(pool, "connect")).toBe(false);
    const createPool = vi.fn(() => pool);
    const composed = runtime(databaseUrl, createPool);
    expect(databaseUrl).not.toHaveBeenCalled();
    expect(composed.createPool).not.toHaveBeenCalled();
    expect(composed.sender).not.toHaveBeenCalled();

    await expect(composed.runtime.run(input)).resolves.toMatchObject({ outcome: "denied" });
    await expect(composed.runtime.run(input)).resolves.toMatchObject({ outcome: "denied" });
    expect(databaseUrl).toHaveBeenCalledTimes(1);
    expect(composed.createPool).toHaveBeenCalledTimes(1);
    expect(composed.createPool).toHaveBeenCalledWith(validUrl);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(composed.sender).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", () => undefined],
    ["wrong scheme", () => validUrl.replace("postgresql:", "http:")],
    ["wrong role", () => validUrl.replace("continuity_app", "root")],
    ["missing password", () => validUrl.replace(":synthetic-password", "")],
    ["wrong host", () => validUrl.replace("cockroachlabs.cloud", "example.invalid")],
    ["wrong port", () => validUrl.replace("26257", "5432")],
    ["wrong database", () => validUrl.replace("/defaultdb", "/postgres")],
    ["weakened TLS", () => validUrl.replace("verify-full", "require")],
    ["extra option", () => `${validUrl}&application_name=unsafe`],
  ])("fails closed for %s without creating a client", async (_name, databaseUrl) => {
    const composed = runtime(databaseUrl);
    await expect(createHackathonApi(composed.runtime).handle(event)).resolves.toEqual({
      body: '{"outcome":"denied"}',
      headers: responseHeaders,
      statusCode: 503,
    });
    expect(composed.createPool).not.toHaveBeenCalled();
    expect(composed.sender).not.toHaveBeenCalled();
  });

  it("returns the fixed 503 response without echoing dependency failures", async () => {
    const composed = runtime(
      () => validUrl,
      vi.fn(() => {
        throw new Error("postgresql://continuity_app:do-not-echo@host token");
      }),
    );
    const response = await createHackathonApi(composed.runtime).handle(event);
    expect(response).toEqual({
      body: '{"outcome":"denied"}',
      headers: responseHeaders,
      statusCode: 503,
    });
    expect(JSON.stringify(response)).not.toMatch(/do-not-echo|postgresql|token/u);
  });

  it("forwards the exact adapter abort signal to the SDK sender", async () => {
    const send = vi.fn(async (command) =>
      command.constructor.name === "InvokeModelCommand"
        ? {
            $metadata: { requestId: "request-1" },
            body: new TextEncoder().encode(
              JSON.stringify({ embedding: Array(1024).fill(0.25), inputTextTokenCount: 1 }),
            ),
          }
        : {
            $metadata: { requestId: "request-2" },
            metrics: { latencyMs: 1 },
            output: { message: { content: [{ text: "Synthetic response." }], role: "assistant" } },
            stopReason: "end_turn",
            usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
          },
    );
    const sender = createProductionBedrockSender({ send });
    const caller = vi.fn((command, options) => sender(command, options));
    const scope = Object.freeze({
      activeMemoryRevisionIds: Object.freeze([]),
      attemptId: "attempt-1",
      contextCompilerVersion: "context.v1",
      dataClassification: "synthetic",
      deletionFence: "0",
      embeddingSpaceVersion: "zc.bedrock-titan-v2.1024",
      purpose: "hackathon-demo",
      policyVersion: "policy.v1",
      retrievalConfigVersion: "retrieval.v1",
      tenantId: "tenant-1",
    });
    const policy = Object.freeze({
      authorize: async (request) => ({
        ...request,
        decisionId: `decision-${request.operation}`,
        expiresAt: Date.now() + 30_000,
        issuedAt: Date.now() - 1,
        outcome: "authorized",
      }),
    });
    await expect(
      createBedrockPorts(scope, policy, caller).embed.embed("synthetic"),
    ).resolves.toMatchObject({ outcome: "succeeded" });
    await expect(
      createBedrockPorts(scope, policy, caller).generate.generate("synthetic"),
    ).resolves.toMatchObject({ outcome: "succeeded" });
    expect(caller).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(caller.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "InvokeModelCommand",
      "ConverseCommand",
    ]);
    for (const [index, [command, options]] of caller.mock.calls.entries()) {
      expect(send.mock.calls[index]?.[0]).toBe(command);
      expect(send.mock.calls[index]?.[1]).toBe(options);
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    }
  });

  it("contains no direct secret resolver and leaves CloudFormation secret-reference-only", async () => {
    const [source, template] = await Promise.all([
      readFile(new URL("../../apps/api/src/production-runtime.ts", import.meta.url), "utf8"),
      readFile(new URL("../../infrastructure/template.yaml", import.meta.url), "utf8"),
    ]);
    expect(source).toContain('import { env } from "node:process"');
    expect(source).toContain("env.COCKROACH_DATABASE_URL");
    expect(source).toContain("new BedrockRuntimeClient({ maxAttempts: 1, region })");
    expect(source).toContain("max: 1");
    expect(source.match(/new BedrockRuntimeClient/gu)).toHaveLength(1);
    expect(source.match(/new Pool/gu)).toHaveLength(1);
    expect(source).not.toMatch(/GetSecretValue|SecretsManager|DATABASE_SECRET_ARN|console\./u);
    expect(template).not.toContain("COCKROACH_DATABASE_URL");
    expect(template).toContain("DATABASE_SECRET_ARN: !Ref DatabaseSecretArn");
  });

  it("rejects authority-shaped composition dependencies before use", () => {
    const createPool = vi.fn();
    const databaseUrl = vi.fn();
    const sender = vi.fn();
    for (const value of [
      {},
      { createPool, databaseUrl, sender, secretArn: "forbidden" },
      Object.create({ createPool, databaseUrl, sender }),
      new Proxy({ createPool, databaseUrl, sender }, {}),
    ])
      expect(() => createProductionHackathonRuntime(value)).toThrowError(
        "invalid_production_dependencies",
      );
    expect(createPool).not.toHaveBeenCalled();
    expect(databaseUrl).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });
});
