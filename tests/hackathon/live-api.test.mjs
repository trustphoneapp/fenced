import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createHackathonApi, handler } from "../../apps/api/src/index.js";
import {
  createHackathonLive,
  hackathonLiveProfile,
} from "../../packages/application/src/hackathon-live.js";

const event = (body, overrides = {}) => ({
  body,
  cookies: [],
  isBase64Encoded: false,
  rawPath: "/api/demo",
  rawQueryString: "",
  requestContext: { http: { method: "POST", path: "/api/demo" } },
  ...overrides,
});
const receipt = () => ({
  compilerVersion: "zc.hackathon-context.v1",
  embeddingModel: "amazon.titan-embed-text-v2:0",
  embeddingSpace: "zc.bedrock-titan-v2.1024",
  inputTokens: 2,
  latencyMs: 3,
  model: "amazon.nova-lite-v1:0",
  outputTokens: 1,
  policyVersion: "zc.hackathon-policy.v1",
  providerRequestId: "request-1",
  receiptId: "1".repeat(48),
  retrievalVersion: "zc.hackathon-retrieval.v1",
  totalTokens: 3,
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
const sha256 = async (value) => createHash("sha256").update(value, "utf8").digest("hex");
const answer = (step) =>
  step === "start"
    ? { outcome: "succeeded", step }
    : step === "correct"
      ? { outcome: "succeeded", revision: "2", step }
      : {
          answer: "safe synthetic answer",
          outcome: "succeeded",
          recalled: [{ factId: "1".repeat(48), revision: "1" }],
          receipt: receipt(),
          step,
          withheld: [],
        };

describe("hackathon HTTP API v2 boundary", () => {
  it("mints a replacement host cookie and hashes it before invoking the live port", async () => {
    const run = vi.fn(async (input) => answer(input.step));
    const api = createHackathonApi({ run });
    const response = await api.handle(
      event('{"step":"start"}', { cookies: [`__Host-zc-session=${"a".repeat(64)}`] }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.cookies).toHaveLength(1);
    expect(response.cookies[0]).toMatch(
      /^__Host-zc-session=[a-f0-9]{64}; Path=\/; Max-Age=86400; Secure; HttpOnly; SameSite=Strict$/,
    );
    expect(response.headers).toEqual(responseHeaders);
    expect(run.mock.calls[0][0]).toMatchObject({
      step: "start",
      sessionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(response.body).not.toContain(run.mock.calls[0][0].sessionDigest);
  });

  it("uses exactly one valid later cookie and exposes no caller-controlled authority", async () => {
    const run = vi.fn(async (input) => answer(input.step));
    const api = createHackathonApi({ run });
    const token = "b".repeat(64);
    await expect(
      api.handle(event('{"step":"ask_before"}', { cookies: [`__Host-zc-session=${token}`] })),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(run.mock.calls[0][0]).toEqual({ sessionDigest: expect.any(String), step: "ask_before" });
    await expect(
      api.handle(
        event('{"step":"ask_before"}', {
          cookies: [`__Host-zc-session=${token}`, `__Host-zc-session=${token}`],
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      api.handle(event('{"step":"ask_before"}', { cookies: [`zc-session=${token}`] })),
    ).resolves.toMatchObject({ statusCode: 403 });
  });

  it("projects every fixed step without exposing internal authority", async () => {
    const run = vi.fn(async (input) => answer(input.step));
    const api = createHackathonApi({ run });
    const cookie = [`__Host-zc-session=${"b".repeat(64)}`];
    for (const step of ["ask_before", "correct", "ask_after", "latest_receipt"])
      await expect(
        api.handle(event(`{"step":"${step}"}`, { cookies: cookie })),
      ).resolves.toMatchObject({
        statusCode: 200,
      });
    expect(run.mock.calls.map(([input]) => input.step)).toEqual([
      "ask_before",
      "correct",
      "ask_after",
      "latest_receipt",
    ]);
  });

  it("accepts the real H15 latest-receipt DTO with zero provider work", async () => {
    const forbidden = () => {
      throw new Error("provider-or-policy-called");
    };
    const live = createHackathonLive({
      providerFor: forbidden,
      retrievalPolicy: { authorize: forbidden },
      sha256,
      store: {
        reserveOperation: async () => ({ nova: 0, outcome: "succeeded", titan: 0 }),
        latestReceipt: async () => ({
          contextCompilerVersion: hackathonLiveProfile.compilerVersion,
          deletionFence: "0",
          embeddingModelId: hackathonLiveProfile.titanModel,
          embeddingSpace: hackathonLiveProfile.embeddingSpace,
          inputTokens: 2,
          latencyMs: 3,
          modelId: hackathonLiveProfile.novaModel,
          outcome: "succeeded",
          outputTokens: 1,
          policyVersion: hackathonLiveProfile.policyVersion,
          providerRequestId: "request-1",
          recalled: [{ deletionFence: "0", factId: "1".repeat(48), revision: "1" }],
          receiptId: "1".repeat(48),
          responseBody: "safe synthetic answer",
          retrievalConfigVersion: hackathonLiveProfile.retrievalVersion,
          step: "ask_before",
          totalTokens: 3,
          withheld: [],
        }),
      },
    });
    const response = await createHackathonApi(live).handle(
      event('{"step":"latest_receipt"}', {
        cookies: [`__Host-zc-session=${"b".repeat(64)}`],
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      outcome: "succeeded",
      step: "latest_receipt",
    });
  });

  it("rejects hostile HTTP shapes before the live port", async () => {
    const run = vi.fn(async (input) => answer(input.step));
    const api = createHackathonApi({ run });
    const hostile = [
      event('{"step":"start","tenant":"x"}'),
      event('{"step":"start","step":"start"}'),
      event('{"step":"start","st\\u0065p":"ask_before"}'),
      event('{ "step":"start"}'),
      event('{"step":"unknown"}'),
      event('{"step":"start"}', { rawQueryString: "x=1" }),
      event('{"step":"start"}', { isBase64Encoded: true }),
      event('{"step":"start"}', { rawPath: "/api/demo/" }),
      event('{"step":"start"}', { requestContext: { http: { method: "GET", path: "/api/demo" } } }),
      event("{"),
      event(`{"step":"${"x".repeat(300)}"}`),
    ];
    for (const input of hostile)
      await expect(api.handle(input)).resolves.toMatchObject({ statusCode: 400 });
    expect(run).not.toHaveBeenCalled();
  });

  it("projects only safe, complete nested live output", async () => {
    const malformed = Object.assign([], { unexpected: true });
    const getterReceipt = Object.defineProperty(receipt(), "receiptId", {
      get: () => "unsafe",
      enumerable: true,
    });
    const hostile = [
      { ...answer("ask_before"), extra: true },
      {
        ...answer("ask_before"),
        answer: "Internal budget ceiling is nine units — restricted synthetic",
      },
      { ...answer("ask_before"), answer: `safe ${"2".repeat(48)}` },
      { ...answer("ask_before"), recalled: [{ factId: "1".repeat(48), revision: "01" }] },
      { ...answer("ask_before"), recalled: [{ factId: "2".repeat(48), revision: "1" }] },
      { ...answer("ask_before"), recalled: [] },
      {
        ...answer("ask_before"),
        withheld: [{ factId: "1".repeat(48), reason: "sensitivity_policy", revision: "1" }],
      },
      {
        ...answer("ask_before"),
        withheld: [{ factId: "1".repeat(48), reason: "other", revision: "1" }],
      },
      { ...answer("ask_before"), recalled: malformed },
      { ...answer("ask_before"), receipt: { ...receipt(), extra: true } },
      {
        ...answer("ask_before"),
        receipt: {
          ...receipt(),
          providerRequestId: "Internal budget ceiling is nine units — restricted synthetic",
        },
      },
      { ...answer("ask_before"), recalled: [{ factId: "1".repeat(48), revision: "0" }] },
      { ...answer("ask_before"), receipt: getterReceipt },
      { ...answer("ask_before"), recalled: new Proxy(answer("ask_before").recalled, {}) },
      {
        ...answer("ask_before"),
        recalled: [new Proxy({ factId: "1".repeat(48), revision: "1" }, {})],
      },
      {
        ...answer("ask_before"),
        withheld: new Proxy([], {
          getPrototypeOf: () => {
            throw new Error("nested-proxy");
          },
        }),
      },
      Object.defineProperty(answer("ask_before"), "answer", {
        get: () => "unsafe",
        enumerable: true,
      }),
      new Proxy(answer("ask_before"), {
        getPrototypeOf: () => {
          throw new Error("proxy");
        },
      }),
    ];
    for (const result of hostile) {
      const run = vi.fn(async () => result);
      const response = await createHackathonApi({ run }).handle(
        event('{"step":"ask_before"}', { cookies: [`__Host-zc-session=${"b".repeat(64)}`] }),
      );
      expect(response.statusCode).not.toBe(200);
      expect(response.body).toBe('{"outcome":"denied"}');
    }
  });

  it("does not delegate entropy or digest authority to replaceable globals", async () => {
    const run = vi.fn(async (input) => answer(input.step));
    try {
      vi.stubGlobal("crypto", {
        getRandomValues: (value) => new Uint8Array(value.length),
        subtle: { digest: async () => new ArrayBuffer(31) },
      });
      await expect(
        createHackathonApi({ run }).handle(event('{"step":"start"}')),
      ).resolves.toMatchObject({ statusCode: 200 });
      expect(run).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exports a mechanically invocable but non-live Lambda handler", async () => {
    await expect(handler(event('{"step":"start"}'))).resolves.toEqual({
      body: '{"outcome":"denied"}',
      headers: responseHeaders,
      statusCode: 503,
    });
  });

  it("adds the direct-API security headers to every generated status", async () => {
    const cookie = { cookies: [`__Host-zc-session=${"b".repeat(64)}`] };
    const responses = await Promise.all([
      createHackathonApi({ run: vi.fn() }).handle(
        event(undefined, {
          rawPath: "/api/health",
          requestContext: { http: { method: "GET", path: "/api/health" } },
        }),
      ),
      createHackathonApi({ run: vi.fn() }).handle(event("{")),
      createHackathonApi({ run: vi.fn() }).handle(event('{"step":"ask_before"}')),
      createHackathonApi({ run: async () => ({ outcome: "conflict" }) }).handle(
        event('{"step":"ask_before"}', cookie),
      ),
      createHackathonApi({
        run: async () => {
          throw new Error("synthetic_failure");
        },
      }).handle(event('{"step":"ask_before"}', cookie)),
      createHackathonApi({ run: async () => ({ outcome: "unexpected" }) }).handle(
        event('{"step":"ask_before"}', cookie),
      ),
      createHackathonApi({ run: async () => ({ outcome: "unknown" }) }).handle(
        event('{"step":"ask_before"}', cookie),
      ),
      handler({}),
    ]);
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([
      200, 400, 403, 409, 500, 502, 503, 503,
    ]);
    for (const response of responses) expect(response.headers).toEqual(responseHeaders);
  });

  it("keeps health local and failures content-free without token or log output", async () => {
    const run = vi.fn(async () => ({ outcome: "unknown" }));
    const api = createHackathonApi({ run });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      api.handle(
        event(undefined, {
          rawPath: "/api/health",
          requestContext: { http: { method: "GET", path: "/api/health" } },
        }),
      ),
    ).resolves.toEqual({
      body: '{"outcome":"succeeded","status":"healthy"}',
      headers: responseHeaders,
      statusCode: 200,
    });
    const response = await api.handle(event('{"step":"start"}'));
    expect(response).toMatchObject({ body: '{"outcome":"denied"}', statusCode: 503 });
    expect(response.body).not.toContain("__Host-zc-session");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
