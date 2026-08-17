// H4 Bedrock adapter. It only turns validated provider output into the
// application ports; it does not grant model output any system authority.

import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { BedrockEmbedPort, BedrockGeneratePort } from "@zintus-continuity/application";

const embeddingDimension = 1024;
const maximumEmbeddingCharacters = 20_000;
const maximumPromptCharacters = 20_000;
const maximumResponseCharacters = 8_000;
const generationMaxTokens = 256;
const requestTimeoutMilliseconds = 12_000;
const policyLifetimeMilliseconds = 60_000;
const requestDigestVersion = "zc.bedrock-request-digest.v1";
const contentDigestVersion = "sha256-utf8.v1";

const denials = Object.freeze({
  authorizationTimeout: Object.freeze({
    code: "authorization_timeout" as const,
    outcome: "denied" as const,
  }),
  invalidRequest: Object.freeze({ code: "invalid_request" as const, outcome: "denied" as const }),
  policyDenied: Object.freeze({ code: "policy_denied" as const, outcome: "denied" as const }),
  providerError: Object.freeze({ code: "provider_error" as const, outcome: "denied" as const }),
  invalidProviderResponse: Object.freeze({
    code: "invalid_provider_response" as const,
    outcome: "denied" as const,
  }),
});

export const bedrockHackathonProfile = Object.freeze({
  destination: "https://bedrock-runtime.us-east-1.amazonaws.com",
  embeddingModelId: "amazon.titan-embed-text-v2:0",
  generationModelId: "amazon.nova-lite-v1:0",
  maximumAttempts: 1,
  region: "us-east-1",
});

export interface BedrockTransmissionRequest {
  readonly activeMemoryRevisionIds: readonly string[];
  readonly attemptId: string;
  readonly content: string;
  readonly contentDigest: string;
  readonly contentDigestVersion: typeof contentDigestVersion;
  readonly contextCompilerVersion: string;
  readonly dataClassification: "synthetic";
  readonly deletionFence: string;
  readonly destination: typeof bedrockHackathonProfile.destination;
  readonly embeddingSpaceVersion: string;
  readonly modelId: string;
  readonly operation: "embedding" | "generation";
  readonly purpose: string;
  readonly policyVersion: string;
  readonly requestDigest: string;
  readonly requestDigestVersion: typeof requestDigestVersion;
  readonly requestNonce: string;
  readonly retrievalConfigVersion: string;
  readonly region: string;
  readonly tenantId: string;
}

export interface BedrockTransmissionScope {
  readonly activeMemoryRevisionIds: readonly string[];
  readonly attemptId: string;
  readonly contextCompilerVersion: string;
  readonly dataClassification: "synthetic";
  readonly deletionFence: string;
  readonly embeddingSpaceVersion: string;
  readonly purpose: string;
  readonly policyVersion: string;
  readonly retrievalConfigVersion: string;
  readonly tenantId: string;
}

/** The policy decision must echo and bind every request field before egress. */
export interface BedrockTransmissionPolicy {
  readonly authorize: (request: BedrockTransmissionRequest) => Promise<unknown>;
}

export type BedrockRuntimeSender = (
  command: InvokeModelCommand | ConverseCommand,
  options: Readonly<{ readonly abortSignal: ProviderAbortSignal }>,
) => Promise<unknown>;

interface ProviderAbortSignal {
  readonly aborted: boolean;
  onabort: ((event: unknown) => unknown) | null;
}

interface ProviderAbortController {
  readonly signal: ProviderAbortSignal;
  abort(): void;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedIdentifier(value: unknown, maximumCharacters = 256): value is string {
  return nonempty(value) && value.length <= maximumCharacters;
}

function own(value: unknown): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

function boundedText(value: unknown, maximumCharacters: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maximumCharacters ? text : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createRequestNonce(): string {
  const nonce = randomUUID();
  if (typeof nonce !== "string" || !/^[a-f0-9-]{36}$/u.test(nonce))
    throw new Error("secure_nonce_unavailable");
  return nonce;
}

function digestRequest(request: Omit<BedrockTransmissionRequest, "requestDigest">): string {
  return sha256(
    JSON.stringify([
      request.requestDigestVersion,
      request.requestNonce,
      request.contentDigestVersion,
      request.tenantId,
      request.purpose,
      request.attemptId,
      request.policyVersion,
      request.dataClassification,
      request.deletionFence,
      request.destination,
      request.contextCompilerVersion,
      request.retrievalConfigVersion,
      request.embeddingSpaceVersion,
      request.activeMemoryRevisionIds,
      request.operation,
      request.modelId,
      request.region,
      request.contentDigest,
    ]),
  );
}

function stringArray(value: unknown): value is readonly string[] {
  try {
    return (
      Array.isArray(value) &&
      value.length <= 32 &&
      value.every((entry) => boundedIdentifier(entry, 128)) &&
      new Set(value).size === value.length
    );
  } catch {
    return false;
  }
}

function validScope(scope: BedrockTransmissionScope): boolean {
  return (
    boundedIdentifier(scope.tenantId) &&
    boundedIdentifier(scope.purpose) &&
    boundedIdentifier(scope.attemptId, 128) &&
    boundedIdentifier(scope.policyVersion, 128) &&
    boundedIdentifier(scope.deletionFence) &&
    boundedIdentifier(scope.contextCompilerVersion) &&
    boundedIdentifier(scope.retrievalConfigVersion) &&
    boundedIdentifier(scope.embeddingSpaceVersion) &&
    scope.dataClassification === "synthetic" &&
    stringArray(scope.activeMemoryRevisionIds)
  );
}

function snapshotScope(value: unknown): Readonly<BedrockTransmissionScope> | undefined {
  try {
    const record = own(value);
    if (!record) return undefined;
    const scope = {
      activeMemoryRevisionIds: record.activeMemoryRevisionIds,
      attemptId: record.attemptId,
      contextCompilerVersion: record.contextCompilerVersion,
      dataClassification: record.dataClassification,
      deletionFence: record.deletionFence,
      embeddingSpaceVersion: record.embeddingSpaceVersion,
      purpose: record.purpose,
      policyVersion: record.policyVersion,
      retrievalConfigVersion: record.retrievalConfigVersion,
      tenantId: record.tenantId,
    };
    if (!validScope(scope as BedrockTransmissionScope)) return undefined;
    const validated = scope as BedrockTransmissionScope;
    return Object.freeze({
      ...validated,
      activeMemoryRevisionIds: Object.freeze([...validated.activeMemoryRevisionIds]),
    }) as Readonly<BedrockTransmissionScope>;
  } catch {
    return undefined;
  }
}

function sameStringArray(left: unknown, right: readonly string[]): boolean {
  try {
    return (
      stringArray(left) &&
      left.length === right.length &&
      left.every((entry, index) => entry === right[index])
    );
  } catch {
    return false;
  }
}

function decodeUtf8(value: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return undefined;
  }
}

function authorizedDecisionId(
  value: unknown,
  request: BedrockTransmissionRequest,
  now: number,
): string | undefined {
  const record = own(value);
  if (!record) return undefined;
  const issuedAt = record.issuedAt;
  const expiresAt = record.expiresAt;
  const expectedKeys = new Set([
    ...Object.keys(request),
    "decisionId",
    "expiresAt",
    "issuedAt",
    "outcome",
  ]);
  if (
    Object.keys(record).length !== expectedKeys.size ||
    Object.keys(record).some((key) => !expectedKeys.has(key)) ||
    !boundedIdentifier(record.decisionId, 128) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    (issuedAt as number) > now ||
    now >= (expiresAt as number) ||
    (expiresAt as number) - (issuedAt as number) > policyLifetimeMilliseconds
  )
    return undefined;
  for (const [key, expected] of Object.entries(request)) {
    if (key === "activeMemoryRevisionIds") {
      if (!sameStringArray(record[key], request.activeMemoryRevisionIds)) return undefined;
    } else if (record[key] !== expected) return undefined;
  }
  return record.outcome === "authorized" ? (record.decisionId as string) : undefined;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function requestId(response: Record<string, unknown>): string | undefined {
  const metadata = own(response.$metadata);
  return boundedIdentifier(metadata?.requestId, 256) ? metadata.requestId : undefined;
}

function readEmbedding(response: unknown):
  | Readonly<{
      readonly inputTokens: number;
      readonly requestId: string;
      readonly vector: readonly number[];
    }>
  | undefined {
  const record = own(response);
  if (!record) return undefined;
  const id = requestId(record);
  if (!id) return undefined;
  const body = record.body;
  if (!(body instanceof Uint8Array)) return undefined;
  try {
    const text = decodeUtf8(body);
    if (text === undefined) return undefined;
    const decoded: unknown = JSON.parse(text);
    const parsed = own(decoded);
    if (!parsed) return undefined;
    const embedding = parsed.embedding;
    const inputTokens = parsed.inputTextTokenCount;
    if (!Array.isArray(embedding) || embedding.length !== embeddingDimension) return undefined;
    if (embedding.some((component) => typeof component !== "number" || !Number.isFinite(component)))
      return undefined;
    if (!nonnegativeInteger(inputTokens)) return undefined;
    return Object.freeze({ inputTokens, requestId: id, vector: Object.freeze([...embedding]) });
  } catch {
    return undefined;
  }
}

function readGeneratedText(response: unknown):
  | Readonly<{
      readonly inputTokens: number;
      readonly latencyMs: number;
      readonly outputTokens: number;
      readonly requestId: string;
      readonly text: string;
      readonly totalTokens: number;
    }>
  | undefined {
  const responseRecord = own(response);
  if (!responseRecord) return undefined;
  const id = requestId(responseRecord);
  if (!id || responseRecord.stopReason !== "end_turn") return undefined;
  const output = own(responseRecord.output);
  if (!output) return undefined;
  const message = own(output.message);
  if (!message || message.role !== "assistant") return undefined;
  const content = message.content;
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const block = own(content[0]);
  if (!block || Object.keys(block).length !== 1) return undefined;
  const text = block.text;
  if (!nonempty(text) || text.length > maximumResponseCharacters) return undefined;
  const usage = own(responseRecord.usage);
  const metrics = own(responseRecord.metrics);
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const totalTokens = usage?.totalTokens;
  const latencyMs = metrics?.latencyMs;
  if (
    !nonnegativeInteger(inputTokens) ||
    !nonnegativeInteger(outputTokens) ||
    !nonnegativeInteger(totalTokens) ||
    totalTokens !== inputTokens + outputTokens ||
    !nonnegativeInteger(latencyMs)
  )
    return undefined;
  return Object.freeze({ inputTokens, latencyMs, outputTokens, requestId: id, text, totalTokens });
}

function buildRequest(
  scope: BedrockTransmissionScope,
  content: string,
  modelId: string,
  operation: "embedding" | "generation",
): BedrockTransmissionRequest {
  const draft = Object.freeze({
    ...scope,
    content,
    contentDigest: sha256(content),
    contentDigestVersion,
    destination: bedrockHackathonProfile.destination,
    modelId,
    operation,
    region: bedrockHackathonProfile.region,
    requestDigestVersion,
    requestNonce: createRequestNonce(),
  });
  return Object.freeze({ ...draft, requestDigest: digestRequest(draft) });
}

async function transmit(
  policy: BedrockTransmissionPolicy,
  request: BedrockTransmissionRequest,
  consumedDecisionIds: Set<string>,
  send: BedrockRuntimeSender,
  command: InvokeModelCommand | ConverseCommand,
): Promise<
  | Readonly<{
      readonly elapsedMs: number;
      readonly outcome: "received";
      readonly policyDecisionId: string;
      readonly response: unknown;
    }>
  | Readonly<{
      readonly attemptId: string;
      readonly code: "provider_outcome_unknown";
      readonly modelId: string;
      readonly operation: "embedding" | "generation";
      readonly outcome: "unknown";
      readonly policyDecisionId: string;
      readonly policyVersion: string;
      readonly region: string;
    }>
  | (typeof denials)["authorizationTimeout" | "policyDenied" | "providerError"]
> {
  const controller = new AbortController() as ProviderAbortController;
  const startedAt = Date.now();
  const timeoutMarker = Object.freeze({ timeout: true });
  const deniedMarker = Object.freeze({ denied: true });
  let dispatchStarted = false;
  let policyDecisionId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutMarker);
    }, requestTimeoutMilliseconds);
  });
  try {
    const response = await Promise.race([
      (async () => {
        const decision = await policy.authorize(request);
        if (controller.signal.aborted) throw timeoutMarker;
        const decisionId = authorizedDecisionId(decision, request, Date.now());
        if (!decisionId || consumedDecisionIds.has(decisionId)) return deniedMarker;
        consumedDecisionIds.add(decisionId);
        policyDecisionId = decisionId;
        dispatchStarted = true;
        return send(command, { abortSignal: controller.signal });
      })(),
      timeout,
    ]);
    if (response === deniedMarker) return denials.policyDenied;
    if (!policyDecisionId) return denials.providerError;
    return Object.freeze({
      elapsedMs: Date.now() - startedAt,
      outcome: "received" as const,
      policyDecisionId,
      response,
    });
  } catch (error) {
    if (dispatchStarted && policyDecisionId)
      return Object.freeze({
        attemptId: request.attemptId,
        code: "provider_outcome_unknown" as const,
        modelId: request.modelId,
        operation: request.operation,
        outcome: "unknown" as const,
        policyDecisionId,
        policyVersion: request.policyVersion,
        region: request.region,
      });
    return error === timeoutMarker || controller.signal.aborted
      ? denials.authorizationTimeout
      : denials.providerError;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Creates the approved primary-provider adapter. It has no caller-selected
 * model or region, and checks policy before every external transmission.
 * The optional sender makes tests entirely local; production uses the AWS SDK
 * credential chain.
 */
export function createBedrockPorts(
  scope: BedrockTransmissionScope,
  transmissionPolicy: BedrockTransmissionPolicy,
  suppliedSender?: BedrockRuntimeSender,
): { readonly embed: BedrockEmbedPort; readonly generate: BedrockGeneratePort } {
  const frozenScope = snapshotScope(scope);
  const consumedDecisionIds = new Set<string>();
  const client = suppliedSender
    ? undefined
    : new BedrockRuntimeClient({
        endpoint: bedrockHackathonProfile.destination,
        maxAttempts: bedrockHackathonProfile.maximumAttempts,
        region: bedrockHackathonProfile.region,
      });
  const send: BedrockRuntimeSender =
    suppliedSender ??
    ((command, options) => {
      if (!client) return Promise.reject(new Error("bedrock_client_unavailable"));
      if (command instanceof InvokeModelCommand) return client.send(command, options);
      return client.send(command, options);
    });

  return Object.freeze({
    embed: Object.freeze({
      async embed(input: string) {
        const text = boundedText(input, maximumEmbeddingCharacters);
        if (!text || !frozenScope) return denials.invalidRequest;
        try {
          const request = buildRequest(
            frozenScope,
            text,
            bedrockHackathonProfile.embeddingModelId,
            "embedding",
          );
          const dispatched = await transmit(
            transmissionPolicy,
            request,
            consumedDecisionIds,
            send,
            new InvokeModelCommand({
              accept: "application/json",
              body: JSON.stringify({
                dimensions: embeddingDimension,
                inputText: text,
                normalize: true,
              }),
              contentType: "application/json",
              modelId: bedrockHackathonProfile.embeddingModelId,
            }),
          );
          if (dispatched.outcome !== "received") return dispatched;
          const parsed = readEmbedding(dispatched.response);
          if (!parsed) return denials.invalidProviderResponse;
          return Object.freeze({
            attemptId: frozenScope.attemptId,
            latencyMs: dispatched.elapsedMs,
            modelId: bedrockHackathonProfile.embeddingModelId,
            operation: "embedding" as const,
            outcome: "succeeded" as const,
            policyDecisionId: dispatched.policyDecisionId,
            policyVersion: frozenScope.policyVersion,
            region: bedrockHackathonProfile.region,
            requestId: parsed.requestId,
            stopReason: "completed" as const,
            usage: Object.freeze({
              inputTokens: parsed.inputTokens,
              outputTokens: 0,
              totalTokens: parsed.inputTokens,
            }),
            vector: parsed.vector,
          });
        } catch {
          return denials.providerError;
        }
      },
    }),
    generate: Object.freeze({
      async generate(input: string) {
        const prompt = boundedText(input, maximumPromptCharacters);
        if (!prompt || !frozenScope) return denials.invalidRequest;
        try {
          const request = buildRequest(
            frozenScope,
            prompt,
            bedrockHackathonProfile.generationModelId,
            "generation",
          );
          const dispatched = await transmit(
            transmissionPolicy,
            request,
            consumedDecisionIds,
            send,
            new ConverseCommand({
              inferenceConfig: { maxTokens: generationMaxTokens, temperature: 0 },
              messages: [{ content: [{ text: prompt }], role: "user" }],
              modelId: bedrockHackathonProfile.generationModelId,
            }),
          );
          if (dispatched.outcome !== "received") return dispatched;
          const parsed = readGeneratedText(dispatched.response);
          if (!parsed) return denials.invalidProviderResponse;
          return Object.freeze({
            attemptId: frozenScope.attemptId,
            latencyMs: parsed.latencyMs,
            modelId: bedrockHackathonProfile.generationModelId,
            operation: "generation" as const,
            outcome: "succeeded" as const,
            policyDecisionId: dispatched.policyDecisionId,
            policyVersion: frozenScope.policyVersion,
            region: bedrockHackathonProfile.region,
            requestId: parsed.requestId,
            stopReason: "end_turn" as const,
            text: parsed.text,
            usage: Object.freeze({
              inputTokens: parsed.inputTokens,
              outputTokens: parsed.outputTokens,
              totalTokens: parsed.totalTokens,
            }),
          });
        } catch {
          return denials.providerError;
        }
      },
    }),
  });
}
