import { createHash, randomBytes } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";

const cookieName = "__Host-zc-session";
const contentType = "application/json; charset=utf-8";
const responseHeaders = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": contentType,
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});
const sessionMaxAge = 86_400;
const maximumBodyBytes = 256;
const steps = Object.freeze([
  "start",
  "ask_before",
  "correct",
  "ask_after",
  "latest_receipt",
] as const);
/** Repeatable read-only side step; never advances the beat, never reaches a provider. */
const proofsStep = "proofs" as const;
const requestSteps = Object.freeze([...steps, proofsStep] as const);
type HackathonRequestStep = (typeof requestSteps)[number];
const restrictedSentinel = "Internal budget ceiling is nine units — restricted synthetic";
const restrictedFactId = "2".repeat(48);
const receiptProfile = Object.freeze({
  compilerVersion: "zc.hackathon-context.v1",
  embeddingModel: "amazon.titan-embed-text-v2:0",
  embeddingSpace: "zc.bedrock-titan-v2.1024",
  model: "amazon.nova-lite-v1:0",
  policyVersion: "zc.hackathon-policy.v1",
  retrievalVersion: "zc.hackathon-retrieval.v1",
});

export type HttpApiV2Event = Readonly<{
  readonly body?: unknown;
  readonly cookies?: unknown;
  readonly isBase64Encoded?: unknown;
  readonly rawPath?: unknown;
  readonly rawQueryString?: unknown;
  readonly requestContext?: unknown;
}>;
export type HttpApiV2Response = Readonly<{
  readonly body: string;
  readonly cookies?: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  readonly statusCode: number;
}>;
type LivePort = Readonly<{
  readonly run: (
    input: Readonly<{ sessionDigest: string; step: HackathonRequestStep }>,
  ) => Promise<unknown>;
}>;
function isProxy(value: unknown): boolean {
  return nodeUtilTypes.isProxy(value);
}

function object(value: unknown): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value))
      return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== "string" ||
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

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  const row = object(value);
  return row && Object.keys(row).length === keys.length && keys.every((key) => key in row)
    ? row
    : undefined;
}

function array(value: unknown, maximum: number, minimum = 0): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < minimum || length > maximum) return undefined;
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
      copy.push(descriptor.value);
    }
    return Reflect.ownKeys(descriptors).every(
      (key) => key === "length" || /^(?:0|[1-9][0-9]*)$/u.test(String(key)),
    )
      ? Object.freeze(copy)
      : undefined;
  } catch {
    return undefined;
  }
}

function utf8Length(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) count += 1;
    else if (code < 0x800) count += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      count += 4;
      index += 1;
    } else count += 3;
  }
  return count;
}

function secureBytes(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array &&
    value.byteLength === 32 &&
    value.every((byte) => byte === 0) === false
  );
}

async function digest(value: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(value, "utf8").digest("hex");
  } catch {
    return undefined;
  }
}

function token(): string | undefined {
  try {
    const bytes = randomBytes(32);
    if (!secureBytes(bytes)) return undefined;
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

function response(
  statusCode: number,
  body: Record<string, unknown>,
  cookie?: string,
): HttpApiV2Response {
  const output: HttpApiV2Response = {
    body: JSON.stringify(body),
    headers: responseHeaders,
    statusCode,
  };
  return cookie
    ? Object.freeze({ ...output, cookies: Object.freeze([cookie]) })
    : Object.freeze(output);
}

function failure(statusCode: 400 | 403 | 409 | 500 | 502 | 503): HttpApiV2Response {
  return response(statusCode, { outcome: "denied" });
}

function method(event: HttpApiV2Event): string | undefined {
  const context = object(event.requestContext);
  const http = context && object(context.http);
  return http && typeof http.method === "string" && typeof http.path === "string"
    ? http.method
    : undefined;
}

function request(event: HttpApiV2Event): Readonly<{ method: string; path: string }> | undefined {
  const currentMethod = method(event);
  const context = object(event.requestContext);
  const http = context && object(context.http);
  return currentMethod &&
    typeof event.rawPath === "string" &&
    event.rawPath === http?.path &&
    event.rawQueryString === "" &&
    event.isBase64Encoded === false
    ? Object.freeze({ method: currentMethod, path: event.rawPath })
    : undefined;
}

function parseBody(body: unknown): HackathonRequestStep | undefined {
  if (typeof body !== "string" || utf8Length(body) > maximumBodyBytes) return undefined;
  return requestSteps.find((step) => body === `{"step":"${step}"}`);
}

function session(event: HttpApiV2Event): string | undefined {
  if (
    !Array.isArray(event.cookies) ||
    event.cookies.length !== 1 ||
    typeof event.cookies[0] !== "string"
  )
    return undefined;
  const match = new RegExp(`^${cookieName}=([a-f0-9]{64})$`, "u").exec(event.cookies[0]);
  return match?.[1];
}

function id(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{48}$/u.test(value);
}

function revision(value: unknown): value is string {
  try {
    return (
      typeof value === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(value) &&
      BigInt(value) <= 18_446_744_073_709_551_615n
    );
  } catch {
    return false;
  }
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown, maximum = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function lineage(value: unknown, withheld: boolean): readonly Record<string, string>[] | undefined {
  const entries = array(value, 8, withheld ? 0 : 1)?.map((entry) =>
    exact(entry, withheld ? ["factId", "reason", "revision"] : ["factId", "revision"]),
  );
  if (!entries || entries.some((entry) => !entry)) return undefined;
  const clean = entries as readonly Record<string, unknown>[];
  if (
    clean.some(
      (entry) =>
        !id(entry.factId) ||
        !revision(entry.revision) ||
        (!withheld && entry.factId === restrictedFactId) ||
        (withheld && entry.reason !== "sensitivity_policy"),
    )
  )
    return undefined;
  return Object.freeze(
    clean.map((entry) =>
      Object.freeze(
        withheld
          ? {
              factId: entry.factId as string,
              reason: "sensitivity_policy",
              revision: entry.revision as string,
            }
          : { factId: entry.factId as string, revision: entry.revision as string },
      ),
    ),
  );
}

function receipt(value: unknown): Record<string, unknown> | undefined {
  const row = exact(value, [
    "compilerVersion",
    "embeddingModel",
    "embeddingSpace",
    "inputTokens",
    "latencyMs",
    "model",
    "outputTokens",
    "policyVersion",
    "providerRequestId",
    "receiptId",
    "retrievalVersion",
    "totalTokens",
  ]);
  if (
    !row ||
    row.compilerVersion !== receiptProfile.compilerVersion ||
    row.embeddingModel !== receiptProfile.embeddingModel ||
    row.embeddingSpace !== receiptProfile.embeddingSpace ||
    row.model !== receiptProfile.model ||
    row.policyVersion !== receiptProfile.policyVersion ||
    row.retrievalVersion !== receiptProfile.retrievalVersion ||
    !id(row.receiptId) ||
    !text(row.providerRequestId) ||
    row.providerRequestId.includes(restrictedSentinel) ||
    row.providerRequestId.includes(restrictedFactId) ||
    !count(row.inputTokens) ||
    !count(row.outputTokens) ||
    !count(row.totalTokens) ||
    !count(row.latencyMs) ||
    row.totalTokens !== row.inputTokens + row.outputTokens
  )
    return undefined;
  return Object.freeze({ ...row });
}

/** Counts only: three small non-negative integers, nothing identifying. */
function proofCounts(value: unknown): Record<string, unknown> | undefined {
  const row = exact(object(value), ["evidenceLineage", "receiptSummary", "taskStatus"]);
  if (!row) return undefined;
  return Object.values(row).every(
    (count) =>
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 1000,
  )
    ? Object.freeze({ ...row })
    : undefined;
}

/** Final gate before proofs reach the browser: refuse anything that still looks identifying. */
const forbiddenInProofs =
  /[0-9a-f]{48}|postgres(ql)?:\/\/|cockroachlabs\.cloud|continuity_(app|migrator)/u;
function proofsOutput(value: unknown): Record<string, unknown> | undefined {
  const row = exact(object(value), [
    "indexColumns",
    "indexName",
    "mcp",
    "outcome",
    "recallPlan",
    "step",
  ]);
  if (!row || row.outcome !== "succeeded" || row.step !== proofsStep) return undefined;
  const scope = exact(object(row.mcp), ["scoped", "unscoped"]);
  const unscoped = scope && proofCounts(scope.unscoped);
  const scoped = scope && proofCounts(scope.scoped);
  const plan = row.recallPlan;
  const columns = row.indexColumns;
  if (
    !unscoped ||
    !scoped ||
    !text(row.indexName, 128) ||
    !Array.isArray(plan) ||
    plan.length === 0 ||
    plan.length > 200 ||
    !plan.every((line) => typeof line === "string" && line.length <= 400) ||
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > 32 ||
    !columns.every((column) => typeof column === "string" && column.length <= 128)
  )
    return undefined;
  const joined = `${plan.join("\n")}\n${columns.join("\n")}\n${row.indexName}`;
  // The live recall plan must not name the vector index; publishing that would contradict the
  // page's own claim, so refuse rather than serve it.
  if (plan.join("\n").includes(String(row.indexName)) || forbiddenInProofs.test(joined))
    return undefined;
  return Object.freeze({
    indexColumns: Object.freeze([...columns]),
    indexName: row.indexName,
    mcp: Object.freeze({ scoped, unscoped }),
    outcome: "succeeded",
    recallPlan: Object.freeze([...plan]),
    step: proofsStep,
  });
}

function output(value: unknown, step: HackathonRequestStep): Record<string, unknown> | undefined {
  if (step === proofsStep) return proofsOutput(value);
  const row = object(value);
  if (!row || row.outcome !== "succeeded" || row.step !== step) return undefined;
  if (step === "start") return exact(row, ["outcome", "step"]);
  if (step === "correct") {
    const correct = exact(row, ["outcome", "revision", "step"]);
    return correct?.revision === "2" ? Object.freeze({ ...correct }) : undefined;
  }
  const answer = exact(row, ["answer", "outcome", "recalled", "receipt", "step", "withheld"]);
  const recalled = answer && lineage(answer.recalled, false);
  const withheld = answer && lineage(answer.withheld, true);
  const safeReceipt = answer && receipt(answer.receipt);
  const references = recalled && withheld ? [...recalled, ...withheld] : [];
  return answer &&
    text(answer.answer, 4096) &&
    !answer.answer.includes(restrictedSentinel) &&
    !answer.answer.includes(restrictedFactId) &&
    recalled &&
    withheld &&
    new Set(references.map((entry) => `${entry.factId}:${entry.revision}`)).size ===
      references.length &&
    safeReceipt
    ? Object.freeze({
        answer: answer.answer,
        outcome: "succeeded",
        recalled,
        receipt: safeReceipt,
        step,
        withheld,
      })
    : undefined;
}

function runFailure(value: unknown): HttpApiV2Response {
  const outcome = object(value)?.outcome;
  return failure(
    outcome === "conflict" || outcome === "stale"
      ? 409
      : outcome === "denied"
        ? 403
        : outcome === "unknown"
          ? 503
          : 502,
  );
}

/** Strict, fixed-operation HTTP API v2 boundary. Runtime composition is deliberately external. */
export function createHackathonApi(live: LivePort) {
  return Object.freeze({
    async handle(event: HttpApiV2Event): Promise<HttpApiV2Response> {
      try {
        const parsed = request(event);
        if (!parsed) return failure(400);
        if (parsed.method === "GET" && parsed.path === "/api/health")
          return response(200, { outcome: "succeeded", status: "healthy" });
        if (parsed.method !== "POST" || parsed.path !== "/api/demo") return failure(400);
        const step = parseBody(event.body);
        if (!step) return failure(400);
        const raw = step === "start" ? token() : session(event);
        if (!raw) return failure(step === "start" ? 500 : 403);
        const sessionDigest = await digest(raw);
        if (!sessionDigest) return failure(500);
        const result = await live.run({ sessionDigest, step });
        const safe = output(result, step);
        if (!safe) return runFailure(result);
        return response(
          200,
          safe,
          step === "start"
            ? `${cookieName}=${raw}; Path=/; Max-Age=${sessionMaxAge}; Secure; HttpOnly; SameSite=Strict`
            : undefined,
        );
      } catch {
        return failure(500);
      }
    },
  });
}

/** Fail-closed deployment placeholder. H16B must bind a reviewed runtime before any live proof. */
export async function handler(_event: HttpApiV2Event): Promise<HttpApiV2Response> {
  return failure(503);
}
