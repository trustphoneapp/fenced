import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createHackathonApi } from "../../apps/api/src/index.js";
import { failureMessage, liveSteps, parseLiveResult, postDemo } from "../../apps/web/src/api.ts";

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
const body = (step) =>
  step === "start"
    ? { outcome: "succeeded", step }
    : step === "correct"
      ? { outcome: "succeeded", revision: "2", step }
      : {
          answer: "Safe answer",
          outcome: "succeeded",
          recalled: [{ factId: "1".repeat(48), revision: "1" }],
          receipt: receipt(),
          step,
          withheld: [{ factId: "2".repeat(48), reason: "sensitivity_policy", revision: "1" }],
        };

describe("live synthetic web flow", () => {
  it("posts all five fixed operations with exact bytes and no-store redirect-safe options", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push([url, init]);
      const step = JSON.parse(init.body).step;
      return {
        headers: { get: () => "application/json; charset=utf-8" },
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body(step)),
      };
    };
    for (const step of liveSteps)
      await expect(postDemo(step, fetcher)).resolves.toMatchObject({
        kind: "success",
        result: { step },
      });
    for (const [url, init] of calls)
      expect([url, init]).toMatchObject([
        "/api/demo",
        {
          body: expect.stringMatching(
            /^\{"step":"(?:start|ask_before|correct|ask_after|latest_receipt)"\}$/,
          ),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
          redirect: "error",
          signal: expect.any(AbortSignal),
        },
      ]);
  });

  it("rejects malformed or stale-shaped API bodies", async () => {
    const sparse = [];
    sparse.length = 1;
    const extra = [{ factId: "1".repeat(48), revision: "1" }];
    extra.extra = true;
    const bad = [
      { ...body("ask_before"), answer: "" },
      { ...body("ask_before"), answer: "x".repeat(4097) },
      { ...body("ask_before"), recalled: [] },
      { ...body("ask_before"), receipt: { ...receipt(), extra: true } },
      { ...body("ask_before"), step: "ask_after" },
      { ...body("ask_before"), recalled: sparse },
      { ...body("ask_before"), recalled: extra },
      {
        ...body("ask_before"),
        recalled: [{ factId: "1".repeat(48), revision: "18446744073709551616" }],
      },
      {
        ...body("ask_before"),
        recalled: [{ factId: "1".repeat(48), revision: "1" }],
        withheld: [{ factId: "1".repeat(48), reason: "sensitivity_policy", revision: "1" }],
      },
    ];
    for (const value of bad) expect(parseLiveResult(value, "ask_before")).toBeUndefined();
    expect(
      parseLiveResult(
        {
          ...body("ask_before"),
          answer: `Public evidence ${"1".repeat(48)}`,
          recalled: [
            { factId: "1".repeat(48), revision: "1" },
            { factId: "1".repeat(48), revision: "2" },
          ],
        },
        "ask_before",
      ),
    ).toBeDefined();
    await expect(
      postDemo("ask_before", async () => ({
        headers: { get: () => "application/json" },
        ok: true,
        status: 200,
        text: async () => "x",
      })),
    ).resolves.toEqual({ kind: "invalid" });
  });

  it("accepts the exact public projection produced by the H16 boundary", async () => {
    const token = "b".repeat(64);
    const publicResult = {
      ...body("ask_before"),
      answer: `Public evidence ${"1".repeat(48)}`,
      recalled: [
        { factId: "1".repeat(48), revision: "1" },
        { factId: "1".repeat(48), revision: "2" },
      ],
    };
    const response = await createHackathonApi({ run: async () => publicResult }).handle({
      body: '{"step":"ask_before"}',
      cookies: [`__Host-zc-session=${token}`],
      isBase64Encoded: false,
      rawPath: "/api/demo",
      rawQueryString: "",
      requestContext: { http: { method: "POST", path: "/api/demo" } },
    });
    expect(response.statusCode).toBe(200);
    expect(parseLiveResult(JSON.parse(response.body), "ask_before")).toMatchObject({
      answer: publicResult.answer,
      recalled: publicResult.recalled,
      step: "ask_before",
    });
  });

  it("maps six content-free failure categories and never reads error bodies", async () => {
    expect(
      ["denied", "conflict", "unknown", "network", "invalid", "service"].map(failureMessage),
    ).toEqual([
      "Action denied.",
      "Operation conflict. Start a new demo if it persists.",
      "Live service is not connected yet.",
      "Network connection lost.",
      "Live API returned an invalid response.",
      "Live service is unavailable.",
    ]);
    for (const [status, kind] of [
      [403, "denied"],
      [409, "conflict"],
      [503, "unknown"],
      [400, "service"],
      [502, "service"],
    ]) {
      const text = () => {
        throw new Error("must not read error");
      };
      await expect(
        postDemo("start", async () => ({ headers: { get: () => null }, ok: false, status, text })),
      ).resolves.toEqual({ kind });
    }
    await expect(
      postDemo("start", async () => {
        throw new Error("offline");
      }),
    ).resolves.toEqual({ kind: "network" });
    await expect(
      postDemo("start", async () => ({
        headers: { get: () => "text/plain" },
        ok: true,
        status: 200,
        text: async () => "{}",
      })),
    ).resolves.toEqual({ kind: "invalid" });
    await expect(
      postDemo("start", async () => ({
        headers: { get: () => "application/jsonp" },
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body("start")),
      })),
    ).resolves.toEqual({ kind: "invalid" });
    await expect(
      postDemo("start", async () => ({
        headers: { get: () => "application/json" },
        ok: true,
        status: 201,
        text: async () => JSON.stringify(body("start")),
      })),
    ).resolves.toEqual({ kind: "service" });
    await expect(
      postDemo("start", async () => ({
        headers: { get: () => "application/json" },
        ok: true,
        status: 200,
        text: async () => "x".repeat(16_385),
      })),
    ).resolves.toEqual({ kind: "invalid" });
  });

  it("has no fixture/static path and declares race, history, and accessibility guards", async () => {
    const [main, live, config] = await Promise.all([
      readFile(new URL("../../apps/web/src/main.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../apps/web/src/api.ts", import.meta.url), "utf8"),
      readFile(new URL("../../apps/web/vite.config.ts", import.meta.url), "utf8"),
    ]);
    expect(`${main}\n${live}`).not.toMatch(
      /demo-beat|localStorage|dangerouslySetInnerHTML|Monday|Sunday|restricted|__Host-zc-session|https?:\/\//i,
    );
    expect(main).toContain("if (busyRef.current) return");
    expect(main).toContain("controller.current?.abort()");
    expect(main).toContain("current !== ticket.current");
    expect(main).toContain("disabled={busy}");
    expect(main).toContain('<ol className="flow"');
    expect(main).toContain("Inspect {entry.step");
    expect(main).toContain("aria-busy={busy}");
    expect(main).toContain('role="alert"');
    expect(main).toContain("LOCAL · UNCONNECTED");
    expect(config).toContain("publicDir: false");
  });

  it("keeps the built application free of the unused fixture and known static data", async () => {
    execFileSync(
      fileURLToPath(new URL("../../node_modules/.bin/vite", import.meta.url)),
      ["build"],
      {
        cwd: new URL("../../apps/web/", import.meta.url),
        stdio: "pipe",
      },
    );
    const dist = new URL("../../apps/web/dist/", import.meta.url);
    const names = await readdir(dist, { recursive: true });
    expect(names).not.toContain("demo-beat.json");
    const assets = await Promise.all(
      names
        .filter((name) => /\.(?:css|html|js)$/u.test(name))
        .map((name) => readFile(new URL(name, dist), "utf8")),
    );
    expect(assets.join("\n")).not.toMatch(/Monday|Sunday|restricted|__Host-zc-session/i);
  });
});
