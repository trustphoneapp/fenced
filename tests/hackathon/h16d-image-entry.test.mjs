import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createAsmExecHackathonRunner,
  createImageHackathonHandler,
  handler,
} from "../../apps/api/src/image-entry.js";

const secretArn =
  "arn:aws:secretsmanager:us-east-1:123456789012:secret:zc-e4-continuity-app-AbCd12";
const environment = Object.freeze({
  AWS_ACCESS_KEY_ID: "synthetic-access-key",
  AWS_SECRET_ACCESS_KEY: "synthetic-secret-key",
  AWS_SESSION_TOKEN: "synthetic-session-token",
  DATABASE_SECRET_ARN: secretArn,
  FORBIDDEN_AMBIENT: "must-not-cross",
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
const post = (body) =>
  Object.freeze({
    body,
    cookies: Object.freeze([]),
    isBase64Encoded: false,
    rawPath: "/api/demo",
    rawQueryString: "",
    requestContext: Object.freeze({
      http: Object.freeze({ method: "POST", path: "/api/demo" }),
    }),
  });
const health = Object.freeze({
  isBase64Encoded: false,
  rawPath: "/api/health",
  rawQueryString: "",
  requestContext: Object.freeze({
    http: Object.freeze({ method: "GET", path: "/api/health" }),
  }),
});

function fakeChild({ code = 0, output = '{"outcome":"unknown"}', pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = vi.fn(() => true);
  child.stdin.end = vi.fn(() =>
    queueMicrotask(() => {
      if (output !== undefined) child.stdout.emit("data", Buffer.from(output));
      child.emit("close", code, null);
    }),
  );
  return child;
}

function runner(overrides = {}) {
  const child = overrides.child ?? fakeChild();
  const spawn = overrides.spawn ?? vi.fn(() => child);
  const killGroup = overrides.killGroup ?? vi.fn();
  const readEnvironment = overrides.environment ?? vi.fn(() => environment);
  return {
    child,
    killGroup,
    readEnvironment,
    runner: createAsmExecHackathonRunner({
      environment: readEnvironment,
      killGroup,
      spawn,
    }),
    spawn,
  };
}

describe("H16D request-lazy asm-exec image entry", () => {
  it("keeps health and malformed requests entirely local", async () => {
    const composed = runner();
    const imageHandler = createImageHackathonHandler({
      environment: composed.readEnvironment,
      killGroup: composed.killGroup,
      spawn: composed.spawn,
    });
    const spies = Object.values(console).flatMap((value, index) =>
      typeof value === "function"
        ? [vi.spyOn(console, Object.keys(console)[index]).mockImplementation(() => {})]
        : [],
    );
    try {
      await expect(imageHandler(health)).resolves.toEqual({
        body: '{"outcome":"succeeded","status":"healthy"}',
        headers: responseHeaders,
        statusCode: 200,
      });
      await expect(imageHandler(post("{"))).resolves.toMatchObject({ statusCode: 400 });
      expect(composed.readEnvironment).not.toHaveBeenCalled();
      expect(composed.spawn).not.toHaveBeenCalled();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("exports the same local health behavior from the production image handler", async () => {
    await expect(handler(health)).resolves.toMatchObject({ statusCode: 200 });
  });

  it("spawns one fixed no-shell child only after valid API input", async () => {
    const composed = runner({ child: fakeChild({ output: '{"outcome":"conflict"}' }) });
    await expect(
      composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
    ).resolves.toEqual({ outcome: "conflict" });
    expect(composed.readEnvironment).toHaveBeenCalledTimes(1);
    expect(composed.spawn).toHaveBeenCalledTimes(1);
    const [command, arguments_, options] = composed.spawn.mock.calls[0];
    expect(command).toBe("/opt/python/bin/python3.13");
    expect(arguments_).toEqual([
      "/opt/zc/asm-exec",
      "--",
      "/var/lang/bin/node",
      "/var/task/one-request-worker.cjs",
    ]);
    expect(options).toMatchObject({
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(options.env).toEqual({
      AWS_ACCESS_KEY_ID: "synthetic-access-key",
      AWS_DEFAULT_REGION: "us-east-1",
      AWS_REGION: "us-east-1",
      AWS_SECRET_ACCESS_KEY: "synthetic-secret-key",
      ASM_EXEC_MCP_ENDPOINT: "disabled://not-configured",
      AWS_SECRETS_MANAGER_AGENT_ENDPOINT: "disabled://not-configured",
      AWS_SESSION_TOKEN: "synthetic-session-token",
      COCKROACH_DATABASE_URL: `{{resolve:secretsmanager:${secretArn}:SecretString}}`,
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
    });
    expect(JSON.stringify(options)).not.toContain("FORBIDDEN_AMBIENT");
    expect(composed.child.stdin.end).toHaveBeenCalledTimes(1);
    expect(Buffer.from(composed.child.stdin.end.mock.calls[0][0]).toString("utf8")).toBe(
      JSON.stringify({ sessionDigest: "a".repeat(64), step: "start" }),
    );
    expect(composed.killGroup).not.toHaveBeenCalled();
    expect(composed.child.kill).not.toHaveBeenCalled();
    expect(composed.child.listenerCount("close")).toBe(0);
    expect(composed.child.listenerCount("error")).toBe(0);
    expect(composed.child.stdin.listenerCount("error")).toBe(0);
    expect(composed.child.stdout.listenerCount("data")).toBe(0);
    expect(composed.child.stdout.listenerCount("error")).toBe(0);
  });

  it("projects required authority from a production process.env-shaped object", async () => {
    const productionEnvironment = Object.assign(
      Object.create(Object.getPrototypeOf(process.env)),
      environment,
    );
    const composed = runner({ environment: vi.fn(() => productionEnvironment) });
    await expect(
      composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(composed.spawn).toHaveBeenCalledTimes(1);
    expect(composed.spawn.mock.calls[0][2].env).not.toHaveProperty("FORBIDDEN_AMBIENT");
  });

  it("reaches the child only through a fully valid POST boundary", async () => {
    const composed = runner();
    const imageHandler = createImageHackathonHandler({
      environment: composed.readEnvironment,
      killGroup: composed.killGroup,
      spawn: composed.spawn,
    });
    await expect(imageHandler(post('{"step":"start"}'))).resolves.toEqual({
      body: '{"outcome":"denied"}',
      headers: responseHeaders,
      statusCode: 503,
    });
    expect(composed.readEnvironment).toHaveBeenCalledTimes(1);
    expect(composed.spawn).toHaveBeenCalledTimes(1);
  });

  it("rejects every other syntactically valid Secrets Manager ARN", async () => {
    for (const invalid of [
      secretArn.replace("zc-e4-continuity-app", "zc-e4-continuity-migrator"),
      secretArn.replace("-AbCd12", ""),
      `${secretArn}-extra`,
      secretArn.replace("123456789012", "12345678901"),
    ]) {
      const composed = runner({
        environment: vi.fn(() => ({ ...environment, DATABASE_SECRET_ARN: invalid })),
      });
      await expect(
        composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
      ).resolves.toEqual({ outcome: "unknown" });
      expect(composed.spawn).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["invalid request", { sessionDigest: "a", step: "start" }, environment],
    ["absent environment", { sessionDigest: "a".repeat(64), step: "start" }, undefined],
    [
      "wrong-region ARN",
      { sessionDigest: "a".repeat(64), step: "start" },
      { ...environment, DATABASE_SECRET_ARN: secretArn.replace("us-east-1", "us-west-2") },
    ],
    [
      "partial credentials",
      { sessionDigest: "a".repeat(64), step: "start" },
      { ...environment, AWS_SESSION_TOKEN: undefined },
    ],
  ])("fails closed before spawn for %s", async (_name, request, env) => {
    const composed = runner({ environment: vi.fn(() => env) });
    await expect(composed.runner.run(request)).resolves.toEqual({ outcome: "unknown" });
    expect(composed.spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["nonzero child", fakeChild({ code: 1, output: "" }), { outcome: "child_exit" }],
    ["malformed child", fakeChild({ output: "{" }), { outcome: "unknown" }],
  ])("returns a content-free failure for %s", async (_name, child, expected) => {
    const composed = runner({ child });
    await expect(
      composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
    ).resolves.toEqual(expected);
  });

  it("maps a child exit to the generic 502 response without exposing details", async () => {
    const composed = runner({ child: fakeChild({ code: 1, output: "" }) });
    const imageHandler = createImageHackathonHandler({
      environment: composed.readEnvironment,
      killGroup: composed.killGroup,
      spawn: composed.spawn,
    });
    await expect(imageHandler(post('{"step":"start"}'))).resolves.toEqual({
      body: '{"outcome":"denied"}',
      headers: responseHeaders,
      statusCode: 502,
    });
  });

  it("kills the whole process group on timeout and stops the simulated grandchild", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild({ output: undefined });
      child.stdin.end.mockImplementation(() => {});
      const lateSideEffect = vi.fn();
      const grandchild = { running: true };
      const killGroup = vi.fn(() => {
        grandchild.running = false;
        queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      });
      const composed = runner({ child, killGroup });
      const pending = composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" });
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(pending).resolves.toEqual({ outcome: "unknown" });
      if (grandchild.running) lateSideEffect();
      expect(killGroup).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
      expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
      expect(lateSideEffect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills the whole process group on oversized stdout", async () => {
    const child = fakeChild({ output: undefined });
    child.stdin.end.mockImplementation(() =>
      queueMicrotask(() => child.stdout.emit("data", Buffer.alloc(32 * 1024 + 1))),
    );
    const killGroup = vi.fn(() => queueMicrotask(() => child.emit("close", null, "SIGKILL")));
    const composed = runner({ child, killGroup });
    await expect(
      composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(killGroup).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it("handles child errors without orphaning the group or exposing the error", async () => {
    const child = fakeChild({ output: undefined });
    child.stdin.end.mockImplementation(() =>
      queueMicrotask(() => child.emit("error", new Error("secret-value-must-not-escape"))),
    );
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      return true;
    });
    const killGroup = vi.fn(() => {
      throw new Error("synthetic_group_kill_failure");
    });
    const composed = runner({ child, killGroup });
    await expect(
      composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(killGroup).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it.each([0, undefined])("never signals an unsafe process-group id %s", async (pid) => {
    const child = fakeChild({ output: undefined });
    child.pid = pid;
    child.stdin.end.mockImplementation(() =>
      queueMicrotask(() => child.emit("error", new Error("synthetic"))),
    );
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      return true;
    });
    const composed = runner({ child });
    await expect(
      composed.runner.run({ sessionDigest: "a".repeat(64), step: "start" }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(composed.killGroup).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it("contains no direct secret or network client", async () => {
    const source = await readFile(
      new URL("../../apps/api/src/image-entry.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("{{resolve:secretsmanager:");
    expect(source).toContain("AWS_SECRETS_MANAGER_AGENT_ENDPOINT: secretEndpoint");
    expect(source).toContain("detached: true");
    expect(source).toContain('killGroup(-pid, "SIGKILL")');
    expect(source).toContain("shell: false");
    expect(source).not.toMatch(/console\./u);
    expect(source).not.toMatch(
      /GetSecretValue|SecretsManagerClient|fetch\(|localhost|127\.0\.0\.1/u,
    );
  });

  it("rejects proxy-shaped composition dependencies before authority use", () => {
    const environment = vi.fn();
    const killGroup = vi.fn();
    const spawn = vi.fn();
    for (const value of [
      Object.create({ environment, killGroup, spawn }),
      { environment: new Proxy(environment, {}), killGroup, spawn },
      { environment, killGroup: new Proxy(killGroup, {}), spawn },
      { environment, killGroup, spawn: new Proxy(spawn, {}) },
      new Proxy({ environment, killGroup, spawn }, {}),
    ])
      expect(() => createAsmExecHackathonRunner(value)).toThrowError(
        "invalid_asm_exec_dependencies",
      );
    expect(environment).not.toHaveBeenCalled();
    expect(killGroup).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
