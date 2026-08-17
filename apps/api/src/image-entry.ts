import { spawn } from "node:child_process";
import { env, kill } from "node:process";
import { types as nodeUtilTypes } from "node:util";
import { createHackathonApi, type HttpApiV2Event } from "./index.js";

const region = "us-east-1";
const secretEndpoint = "disabled://not-configured";
const python = "/opt/python/bin/python3.13";
/**
 * The image copies the pinned Lambda python runtime to /opt/python and its libssl/libcrypto to
 * /opt/python/lib, so the interpreter only resolves libpython3.13.so.1.0 when the loader path is
 * present. The child environment is a complete replacement rather than an overlay, so this must be
 * passed explicitly; omitting it makes python exit 127 before asm-exec ever runs.
 */
const pythonLoaderPath = "/opt/python/lib";
const asmExec = "/opt/zc/asm-exec";
const worker = "/var/task/one-request-worker.cjs";
const maximumInputBytes = 1_024;
const maximumOutputBytes = 32 * 1024;
const timeoutMilliseconds = 20_000;
const steps = new Set(["start", "ask_before", "correct", "ask_after", "latest_receipt", "proofs"]);
const childExitOutcome = Object.freeze({ outcome: "child_exit" as const });
const unknownOutcome = Object.freeze({ outcome: "unknown" as const });

type RunnerInput = Readonly<{ sessionDigest: string; step: string }>;
type Listener = (...values: unknown[]) => void;
type EventPort = Readonly<{
  off: (event: string, listener: Listener) => unknown;
  on: (event: string, listener: Listener) => unknown;
}>;
type ChildPort = EventPort &
  Readonly<{
    kill: (signal: "SIGKILL") => unknown;
    pid?: number;
    stdin: EventPort & Readonly<{ end: (value: Uint8Array) => unknown }>;
    stdout: EventPort;
  }>;
type SpawnPort = (
  command: string,
  arguments_: readonly string[],
  options: Readonly<Record<string, unknown>>,
) => ChildPort;
type GroupKillPort = (processGroup: number, signal: "SIGKILL") => unknown;
function isProxy(value: unknown): boolean {
  return nodeUtilTypes.isProxy(value);
}
function own(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== keys.length ||
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== "string" ||
          !keys.includes(key) ||
          !descriptors[key]?.enumerable ||
          !("value" in (descriptors[key] ?? {})),
      )
    )
      return undefined;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return undefined;
  }
}

function string(environment: Record<string, unknown>, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  return descriptor?.enumerable && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function childEnvironment(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value))
    return undefined;
  const environment = value as Record<string, unknown>;
  const accessKey = string(environment, "AWS_ACCESS_KEY_ID");
  const secretKey = string(environment, "AWS_SECRET_ACCESS_KEY");
  const sessionToken = string(environment, "AWS_SESSION_TOKEN");
  const secretArn = string(environment, "DATABASE_SECRET_ARN");
  if (
    !accessKey ||
    !secretKey ||
    !sessionToken ||
    !secretArn ||
    !/^arn:aws:secretsmanager:us-east-1:[0-9]{12}:secret:zc-e4-continuity-app-[A-Za-z0-9]{6}$/u.test(
      secretArn,
    )
  )
    return undefined;
  return Object.freeze({
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_DEFAULT_REGION: region,
    AWS_REGION: region,
    AWS_SECRET_ACCESS_KEY: secretKey,
    ASM_EXEC_MCP_ENDPOINT: secretEndpoint,
    AWS_SECRETS_MANAGER_AGENT_ENDPOINT: secretEndpoint,
    AWS_SESSION_TOKEN: sessionToken,
    COCKROACH_DATABASE_URL: `{{resolve:secretsmanager:${secretArn}:SecretString}}`,
    LANG: "C",
    LC_ALL: "C",
    LD_LIBRARY_PATH: pythonLoaderPath,
    TZ: "UTC",
  });
}

function runnerInput(value: unknown): RunnerInput | undefined {
  const input = own(value, ["sessionDigest", "step"]);
  return input &&
    typeof input.sessionDigest === "string" &&
    /^[a-f0-9]{64}$/u.test(input.sessionDigest) &&
    typeof input.step === "string" &&
    steps.has(input.step)
    ? ({ sessionDigest: input.sessionDigest, step: input.step } as const)
    : undefined;
}

function supervise(
  child: ChildPort,
  payload: Uint8Array,
  killGroup: GroupKillPort,
): Promise<unknown> {
  return new Promise((resolve) => {
    let bytes = 0;
    let closed = false;
    let failed = false;
    let killed = false;
    const chunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      child.stdin.off("error", onError);
      child.stdout.off("data", onData);
      child.stdout.off("error", onError);
    };
    const terminate = () => {
      failed = true;
      if (killed) return;
      killed = true;
      const pid = child.pid;
      if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0)
        try {
          killGroup(-pid, "SIGKILL");
        } catch {}
      try {
        child.kill("SIGKILL");
      } catch {}
    };
    const onError = () => terminate();
    const onData = (value: unknown) => {
      if (failed) return;
      const chunk =
        typeof value === "string"
          ? Buffer.from(value)
          : value instanceof Uint8Array
            ? Buffer.from(value)
            : undefined;
      if (!chunk || bytes + chunk.byteLength > maximumOutputBytes) {
        terminate();
        return;
      }
      bytes += chunk.byteLength;
      chunks.push(chunk);
    };
    const onClose = (code: unknown) => {
      if (closed) return;
      closed = true;
      cleanup();
      if (failed) {
        resolve(unknownOutcome);
        return;
      }
      if (code !== 0) {
        resolve(childExitOutcome);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown);
      } catch {
        resolve(unknownOutcome);
      }
    };
    child.on("close", onClose);
    child.on("error", onError);
    child.stdin.on("error", onError);
    child.stdout.on("data", onData);
    child.stdout.on("error", onError);
    timer = setTimeout(terminate, timeoutMilliseconds);
    try {
      child.stdin.end(payload);
    } catch {
      terminate();
    }
  });
}

export function createAsmExecHackathonRunner(input: unknown) {
  const dependencies = own(input, ["environment", "killGroup", "spawn"]);
  if (
    !dependencies ||
    typeof dependencies.environment !== "function" ||
    isProxy(dependencies.environment) ||
    typeof dependencies.killGroup !== "function" ||
    isProxy(dependencies.killGroup) ||
    typeof dependencies.spawn !== "function" ||
    isProxy(dependencies.spawn)
  )
    throw new TypeError("invalid_asm_exec_dependencies");
  const environment = dependencies.environment as () => unknown;
  const killGroup = dependencies.killGroup as GroupKillPort;
  const spawnChild = dependencies.spawn as SpawnPort;
  return Object.freeze({
    async run(value: unknown) {
      try {
        const request = runnerInput(value);
        if (!request) return unknownOutcome;
        const payload = Buffer.from(JSON.stringify(request), "utf8");
        if (payload.byteLength > maximumInputBytes) return unknownOutcome;
        const env = childEnvironment(environment());
        if (!env) return unknownOutcome;
        const child = spawnChild(python, [asmExec, "--", "/var/lang/bin/node", worker], {
          detached: true,
          env,
          shell: false,
          stdio: ["pipe", "pipe", "inherit"],
        });
        return await supervise(child, payload, killGroup);
      } catch {
        return unknownOutcome;
      }
    },
  });
}

const productionDependencies = Object.freeze({
  environment: () => env,
  killGroup: (processGroup: number, signal: "SIGKILL") => kill(processGroup, signal),
  spawn: (
    command: string,
    arguments_: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => spawn(command, arguments_, options) as unknown as ChildPort,
});

export function createImageHackathonHandler(input: unknown) {
  return createHackathonApi(createAsmExecHackathonRunner(input)).handle;
}

const productionHandler = createImageHackathonHandler(productionDependencies);

/** Container-image-only handler. The ZIP entry remains the inert fail-closed handler. */
export const handler = (event: HttpApiV2Event) => productionHandler(event);
