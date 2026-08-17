import {
  type DisclosedRecall,
  type DisclosureReceipt,
  isIssuedMemoryAskResult,
  type MemoryAskResult,
} from "./h1-recall-ledger.js";

// H3 demo agent: answers only from disclosed recalls. Model output never gains
// system authority. Live Bedrock is human-gated (HG-5); the port fails closed.

const denied = Object.freeze({ outcome: "denied" as const });
const objectPrototype = Object.getPrototypeOf({});

export type BedrockDenialCode =
  | "authorization_timeout"
  | "invalid_request"
  | "policy_denied"
  | "provider_error"
  | "invalid_provider_response";

export interface BedrockDenied {
  readonly code?: BedrockDenialCode;
  readonly outcome: "denied";
}

export interface BedrockUnknown {
  readonly attemptId: string;
  readonly code: "provider_outcome_unknown";
  readonly modelId: string;
  readonly operation: "embedding" | "generation";
  readonly outcome: "unknown";
  readonly policyDecisionId: string;
  readonly policyVersion: string;
  readonly region: string;
}

export interface BedrockUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

interface BedrockSucceeded {
  readonly attemptId: string;
  readonly latencyMs: number;
  readonly modelId: string;
  readonly outcome: "succeeded";
  readonly policyDecisionId: string;
  readonly policyVersion: string;
  readonly region: string;
  readonly requestId: string;
  readonly usage: BedrockUsage;
}

export interface BedrockEmbeddingSucceeded extends BedrockSucceeded {
  readonly operation: "embedding";
  readonly stopReason: "completed";
  readonly vector: readonly number[];
}

export interface BedrockGenerationSucceeded extends BedrockSucceeded {
  readonly operation: "generation";
  readonly stopReason: "end_turn";
  readonly text: string;
}

export interface BedrockEmbedPort {
  readonly embed: (
    text: string,
  ) => Promise<BedrockEmbeddingSucceeded | BedrockDenied | BedrockUnknown>;
}

export interface BedrockGeneratePort {
  readonly generate: (
    prompt: string,
  ) => Promise<BedrockGenerationSucceeded | BedrockDenied | BedrockUnknown>;
}

export interface DemoAnswer {
  readonly answerText: string;
  readonly disclosed: readonly DisclosedRecall[];
  readonly model: "local-extractive.v1" | "bedrock-pending";
  readonly outcome: "answered";
  readonly receipt: DisclosureReceipt;
  readonly recordFamily: "demo_answer";
  readonly recordSchemaVersion: "zc.internal.demo-answer.v1";
}

export type DemoAnswerResult = DemoAnswer | typeof denied;

function own(value: unknown): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const copied: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      copied[key] = descriptor.value;
    }
    return copied;
  } catch {
    return undefined;
  }
}

/**
 * Extractive local answer: concatenates disclosed contents only. Never uses
 * withheld receipt entries. It is internal so only the typed memory port can
 * invoke it. Fail-closed if the receipt does not bind each disclosed fact.
 */
function composeDemoAnswerFromAsk(askResult: unknown): DemoAnswerResult {
  const record = own(askResult);
  if (!record || record.outcome !== "answered") return denied;
  if (!Array.isArray(record.disclosed) || record.disclosed.length === 0) return denied;
  const receiptRecord = own(record.receipt);
  if (!receiptRecord || !Array.isArray(receiptRecord.recalled)) return denied;
  const disclosed = record.disclosed as DisclosedRecall[];
  for (const entry of disclosed) {
    if (
      typeof entry.content !== "string" ||
      entry.content.length === 0 ||
      typeof entry.factId !== "string" ||
      typeof entry.revision !== "string" ||
      !receiptRecord.recalled.some(
        (recalled) =>
          own(recalled)?.factId === entry.factId && own(recalled)?.revision === entry.revision,
      )
    )
      return denied;
  }
  const lines = disclosed.map(
    (entry, index) =>
      `${index + 1}. ${entry.content} (fact ${entry.factId.slice(0, 8)}… r${entry.revision})`,
  );
  return Object.freeze({
    answerText: `From authorized memory:\n${lines.join("\n")}`,
    disclosed: Object.freeze([...disclosed]),
    model: "local-extractive.v1" as const,
    outcome: "answered" as const,
    receipt: receiptRecord as unknown as DisclosureReceipt,
    recordFamily: "demo_answer" as const,
    recordSchemaVersion: "zc.internal.demo-answer.v1" as const,
  });
}

export function createFailClosedBedrockPorts(): {
  readonly embed: BedrockEmbedPort;
  readonly generate: BedrockGeneratePort;
} {
  return Object.freeze({
    embed: Object.freeze({
      async embed(
        _text: string,
      ): Promise<BedrockEmbeddingSucceeded | BedrockDenied | BedrockUnknown> {
        return denied;
      },
    }),
    generate: Object.freeze({
      async generate(
        _prompt: string,
      ): Promise<BedrockGenerationSucceeded | BedrockDenied | BedrockUnknown> {
        return denied;
      },
    }),
  });
}

/** Convenience: MemoryAskResult → DemoAnswerResult */
export function answerFromMemoryAsk(ask: MemoryAskResult): DemoAnswerResult {
  if (!isIssuedMemoryAskResult(ask)) return denied;
  return composeDemoAnswerFromAsk(ask);
}
