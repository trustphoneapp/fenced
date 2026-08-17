import {
  hackathonLiveProviderAllowances as allowances,
  type HackathonLiveStep as LiveStep,
  hackathonLiveSteps as liveSteps,
} from "@zintus-continuity/contracts";

export { liveSteps };
export type { LiveStep };

/** Judge-facing copy for each fixed step. Allowances come from the shared contract, never typed here. */
export type StepMeta = Readonly<{
  label: string;
  nova: number;
  server: string;
  titan: number;
}>;
export const stepMeta: Readonly<Record<LiveStep, StepMeta>> = Object.freeze({
  start: Object.freeze({
    label: "Start",
    server: "Mint an opaque session, seed three synthetic facts, embed them with Titan v2",
    ...allowances.start,
  }),
  ask_before: Object.freeze({
    label: "Ask (before)",
    server: "Policy-filtered recall under row-level security, then Nova Lite answers",
    ...allowances.ask_before,
  }),
  correct: Object.freeze({
    label: "Correct",
    server: "Supersede the launch-day fact, revision 1 to 2, in one SERIALIZABLE transaction",
    ...allowances.correct,
  }),
  ask_after: Object.freeze({
    label: "Ask (after)",
    server: "Same fixed question; recall now binds revision 2",
    ...allowances.ask_after,
  }),
  latest_receipt: Object.freeze({
    label: "Latest receipt",
    server: "Replay the durable answer and receipt from CockroachDB; no provider call",
    ...allowances.latest_receipt,
  }),
});

/** 48-hex fact ids are unreadable in full; show head and tail, keep the full value in a title. */
export const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

/** Split model output on `**` pairs so emphasis renders as elements, never as injected HTML. */
export function answerSegments(text: string): readonly Readonly<{ bold: boolean; text: string }>[] {
  const parts = text.split("**");
  return parts
    .map((part, index) => ({ bold: index % 2 === 1, text: part }))
    .filter((segment) => segment.text.length > 0);
}

export type DiffToken = Readonly<{ kind: "same" | "del" | "ins"; text: string }>;
/** Small word-level LCS diff; both inputs are live answers, never literals from this bundle. */
export function wordDiff(before: string, after: string): readonly DiffToken[] {
  const a = before.split(/(\s+)/u).filter((t) => t.length > 0);
  const b = after.split(/(\s+)/u).filter((t) => t.length > 0);
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      (table[i] as number[])[j] =
        a[i] === b[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (table[i + 1] as number[])[j] as number,
              (table[i] as number[])[j + 1] as number,
            );
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] as string });
      i += 1;
      j += 1;
    } else if (
      ((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)
    ) {
      out.push({ kind: "del", text: a[i] as string });
      i += 1;
    } else {
      out.push({ kind: "ins", text: b[j] as string });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: "del", text: a[i] as string });
  for (; j < b.length; j += 1) out.push({ kind: "ins", text: b[j] as string });
  return out;
}
export type Lineage = Readonly<{ factId: string; revision: string; reason?: "sensitivity_policy" }>;
export type Receipt = Readonly<{
  compilerVersion: string;
  embeddingModel: string;
  embeddingSpace: string;
  inputTokens: number;
  latencyMs: number;
  model: string;
  outputTokens: number;
  policyVersion: string;
  providerRequestId: string;
  receiptId: string;
  retrievalVersion: string;
  totalTokens: number;
}>;
export type LiveResult = Readonly<{
  answer?: string;
  recalled?: readonly Lineage[];
  receipt?: Receipt;
  revision?: "2";
  step: LiveStep;
  withheld?: readonly Lineage[];
}>;
export type ApiFailure = "conflict" | "denied" | "invalid" | "network" | "service" | "unknown";
export type ApiOutcome = { kind: "success"; result: LiveResult } | { kind: ApiFailure };
type Fetcher = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "headers" | "ok" | "status" | "text">>;

const profile = {
  compilerVersion: "zc.hackathon-context.v1",
  embeddingModel: "amazon.titan-embed-text-v2:0",
  embeddingSpace: "zc.bedrock-titan-v2.1024",
  model: "amazon.nova-lite-v1:0",
  policyVersion: "zc.hackathon-policy.v1",
  retrievalVersion: "zc.hackathon-retrieval.v1",
} as const;
const receiptKeys = [
  ...Object.keys(profile),
  "inputTokens",
  "latencyMs",
  "outputTokens",
  "providerRequestId",
  "receiptId",
  "totalTokens",
].sort();
const messages: Record<ApiFailure, string> = {
  conflict: "A step is still finishing or was replayed. Retry, or restart the session.",
  denied: "Session expired or missing. Restart the session.",
  invalid: "The response failed the browser's strict shape validation and was rejected.",
  network: "Network connection lost. Retry.",
  service: "Live service is unavailable. Try again shortly.",
  unknown: "The live provider is paused by the operator's runtime control. Try again shortly.",
};

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? (value as Record<string, unknown>)
    : undefined;
}
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{48}$/u.test(value);
const revision = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,19}$/u.test(value) &&
  BigInt(value) <= 18_446_744_073_709_551_615n;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, maximum = 256): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

function lineage(value: unknown, withheld: boolean): readonly Lineage[] | undefined {
  if (
    !Array.isArray(value) ||
    Object.keys(value).length !== value.length ||
    value.length > 8 ||
    (!withheld && value.length === 0)
  )
    return;
  const keys = withheld ? ["factId", "reason", "revision"] : ["factId", "revision"];
  const entries = value.map((item) => record(item, keys));
  if (
    entries.some(
      (item) =>
        !item ||
        !id(item.factId) ||
        !revision(item.revision) ||
        (withheld && item.reason !== "sensitivity_policy"),
    )
  )
    return;
  const result = entries as unknown as readonly Lineage[];
  return new Set(result.map(({ factId, revision: rev }) => `${factId}:${rev}`)).size ===
    result.length
    ? result
    : undefined;
}

function receipt(value: unknown): Receipt | undefined {
  const item = record(value, receiptKeys);
  if (!item || Object.entries(profile).some(([key, expected]) => item[key] !== expected)) return;
  const { inputTokens, outputTokens, totalTokens } = item;
  return id(item.receiptId) &&
    text(item.providerRequestId) &&
    count(inputTokens) &&
    count(outputTokens) &&
    count(totalTokens) &&
    count(item.latencyMs) &&
    totalTokens === inputTokens + outputTokens
    ? (item as Receipt)
    : undefined;
}

export function parseLiveResult(value: unknown, step: LiveStep): LiveResult | undefined {
  try {
    const root = record(
      value,
      step === "start"
        ? ["outcome", "step"]
        : step === "correct"
          ? ["outcome", "revision", "step"]
          : ["answer", "outcome", "recalled", "receipt", "step", "withheld"],
    );
    if (!root || root.outcome !== "succeeded" || root.step !== step) return;
    if (step === "start") return { step };
    if (step === "correct") return root.revision === "2" ? { revision: "2", step } : undefined;
    const recalled = lineage(root.recalled, false);
    const withheld = lineage(root.withheld, true);
    const safeReceipt = receipt(root.receipt);
    const overlap = withheld?.some((item) =>
      recalled?.some(
        ({ factId, revision: rev }) => factId === item.factId && rev === item.revision,
      ),
    );
    return text(root.answer, 4096) && recalled && withheld && !overlap && safeReceipt
      ? { answer: root.answer, recalled, receipt: safeReceipt, step, withheld }
      : undefined;
  } catch {
    return undefined;
  }
}

export const failureMessage = (failure: ApiFailure) => messages[failure];
const statusFailure = (status: number): ApiFailure =>
  status === 403 ? "denied" : status === 409 ? "conflict" : status === 503 ? "unknown" : "service";

export async function postDemo(
  step: LiveStep,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<ApiOutcome> {
  let response: Awaited<ReturnType<Fetcher>>;
  try {
    response = await fetcher("/api/demo", {
      body: `{"step":"${step}"}`,
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    return { kind: "network" };
  }
  if (!response.ok || response.status !== 200) return { kind: statusFailure(response.status) };
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""))
    return { kind: "invalid" };
  try {
    const body = await response.text();
    if (body.length > 16_384 || new TextEncoder().encode(body).byteLength > 16_384)
      return { kind: "invalid" };
    const result = parseLiveResult(JSON.parse(body), step);
    return result ? { kind: "success", result } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}
