import { env } from "node:process";
import { types as nodeUtilTypes } from "node:util";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { BedrockRuntimeSender, HackathonPoolLike } from "@zintus-continuity/adapters-local";
import { Pool } from "pg";
import { createLocalHackathonRuntimeCandidate } from "./live-runtime.js";

const region = "us-east-1";
const bedrockClient = new BedrockRuntimeClient({ maxAttempts: 1, region });

type RuntimePort = ReturnType<typeof createLocalHackathonRuntimeCandidate>;
type RuntimeInput = Parameters<RuntimePort["run"]>[0];
type ProductionRuntimeDependencies = Readonly<{
  createPool: (connectionString: string) => HackathonPoolLike;
  databaseUrl: () => unknown;
  sender: BedrockRuntimeSender;
}>;
function isProxy(value: unknown): boolean {
  return nodeUtilTypes.isProxy(value);
}

function own(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value))
      return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== keys.length ||
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== "string" ||
          !keys.includes(key) ||
          !descriptors[key]?.enumerable ||
          !("value" in descriptors[key]),
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

function databaseUrl(value: unknown): string | undefined {
  try {
    if (typeof value !== "string" || value.length < 1 || value.length > 4_096) return undefined;
    const url = new URL(value);
    if (
      url.protocol !== "postgresql:" ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.cockroachlabs\.cloud$/u.test(url.hostname) ||
      url.username !== "continuity_app" ||
      url.password.length < 1 ||
      url.port !== "26257" ||
      url.pathname !== "/defaultdb" ||
      url.search !== "?sslmode=verify-full" ||
      url.hash !== ""
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function poolPort(value: unknown): HackathonPoolLike | undefined {
  try {
    if (value === null || typeof value !== "object" || isProxy(value)) return undefined;
    /**
     * `pg` exports a subclass: `pg.Pool` is a `BoundPool extends Pool`, so `connect` is two
     * prototype levels above the instance. Walk a bounded chain and stop before Object.prototype so
     * a polluted Object.prototype can never satisfy the port.
     */
    let connect: unknown;
    let candidate: object | null = value;
    for (
      let depth = 0;
      depth < 8 && candidate !== null && candidate !== Object.prototype;
      depth += 1
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, "connect");
      if (descriptor && "value" in descriptor) {
        connect = descriptor.value;
        break;
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
    if (typeof connect !== "function") return undefined;
    const pool = value as HackathonPoolLike;
    return Object.freeze({ connect: () => pool.connect() });
  } catch {
    return undefined;
  }
}

export function createProductionHackathonRuntime(input: unknown) {
  const dependencies = own(input, ["createPool", "databaseUrl", "sender"]);
  if (
    !dependencies ||
    typeof dependencies.createPool !== "function" ||
    typeof dependencies.databaseUrl !== "function" ||
    typeof dependencies.sender !== "function"
  )
    throw new TypeError("invalid_production_dependencies");

  const ports = dependencies as ProductionRuntimeDependencies;
  let runtime: Promise<RuntimePort> | undefined;
  const initialize = async () => {
    const connectionString = databaseUrl(ports.databaseUrl());
    if (!connectionString) throw new Error("production_runtime_unavailable");
    const pool = poolPort(ports.createPool(connectionString));
    if (!pool) throw new Error("production_runtime_unavailable");
    return createLocalHackathonRuntimeCandidate({
      pool,
      sender: ports.sender,
    });
  };
  return Object.freeze({
    async run(value: RuntimeInput) {
      try {
        runtime ??= initialize();
        return await (await runtime).run(value);
      } catch {
        // Drop the memoized runtime so a transient initialization failure cannot poison the
        // container for the rest of its life; the next request retries initialization.
        runtime = undefined;
        return Object.freeze({ outcome: "unknown" as const });
      }
    },
  });
}

export function createProductionBedrockSender(
  client: Pick<BedrockRuntimeClient, "send">,
): BedrockRuntimeSender {
  return (command, options) =>
    command instanceof InvokeModelCommand
      ? client.send(command, options)
      : command instanceof ConverseCommand
        ? client.send(command, options)
        : Promise.reject(new TypeError("invalid_bedrock_command"));
}

const productionRuntime = createProductionHackathonRuntime({
  createPool: (connectionString: string) =>
    new Pool({
      allowExitOnIdle: true,
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      max: 1,
      query_timeout: 5_000,
      ssl: { rejectUnauthorized: true },
      statement_timeout: 5_000,
    }),
  databaseUrl: () => env.COCKROACH_DATABASE_URL,
  sender: createProductionBedrockSender(bedrockClient),
});

/** Reserved for a fixed Lambda entry launched through asm-exec; the ZIP handler stays unbound. */
export const runProductionHackathon = (input: RuntimeInput) => productionRuntime.run(input);
