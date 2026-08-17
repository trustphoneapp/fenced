import type { TenantContextService } from "./tenant-context.js";

// H1 hackathon demo slice: policy-gated memory recall with disclosure receipts
// and correction/retraction propagation. Local/synthetic only; the embedding
// space is an explicit versioned local space until Bedrock is human-gated in.

const maximumRevision = 18_446_744_073_709_551_615n;
const objectPrototype = Object.getPrototypeOf({});
const denied = Object.freeze({ outcome: "denied" as const });
const issuedMemoryAskResults = new WeakSet<object>();

export const recallEmbeddingDimension = 8 as const;
export const recallEmbeddingSpace = "zc.local-synthetic-embedding.v1" as const;
export const recallPolicyVersion = "zc.recall-policy.v1" as const;

const operationTeach = "memory.teach" as const;
const operationAsk = "memory.ask" as const;
const operationCorrect = "memory.correct" as const;
const operationAudit = "memory.audit" as const;

export type MemoryOperation =
  | typeof operationTeach
  | typeof operationAsk
  | typeof operationCorrect
  | typeof operationAudit;

export type MemoryAccessTier = "standard" | "privileged";

export interface MemoryScope {
  readonly accessTier?: MemoryAccessTier;
  readonly operation: MemoryOperation;
  readonly serverPurpose: string;
  readonly tenantId: string;
}

export type MemorySensitivity = "public" | "restricted";

export type MemoryFactStatus = "active" | "retracted";

export interface MemoryFact {
  readonly content: string;
  readonly embedding: readonly number[];
  readonly embeddingSpace: typeof recallEmbeddingSpace;
  readonly factId: string;
  readonly occurredAt: string;
  readonly revision: string;
  readonly sensitivity: MemorySensitivity;
  readonly serverPurpose: string;
  readonly sourceRef: string;
  readonly status: MemoryFactStatus;
  readonly tenantId: string;
  readonly recordFamily: "memory_fact";
  readonly recordSchemaVersion: "zc.internal.memory-fact.v1";
}

export interface MemoryTeachCommand {
  readonly content: string;
  readonly embedding: readonly number[];
  readonly factId: string;
  readonly occurredAt: string;
  readonly sensitivity: MemorySensitivity;
  readonly sourceRef: string;
}

export type MemoryTeachResult =
  | Readonly<{ readonly outcome: "recorded"; readonly fact: MemoryFact }>
  | Readonly<{ readonly outcome: "replayed"; readonly fact: MemoryFact }>
  | Readonly<{ readonly outcome: "conflict" }>
  | typeof denied;

export interface MemoryAskCommand {
  readonly askedAt: string;
  readonly embedding: readonly number[];
  readonly topK: number;
}

export type WithheldReason = "sensitivity_policy" | "retracted";

export interface DisclosedRecall {
  readonly content: string;
  readonly factId: string;
  readonly revision: string;
  readonly similarity: number;
}

export interface ReceiptRecalledEntry {
  readonly factId: string;
  readonly revision: string;
  readonly similarity: number;
}

export interface ReceiptWithheldEntry {
  readonly factId: string;
  readonly reason: WithheldReason;
  readonly revision: string;
}

export interface DisclosureReceipt {
  readonly accessTier: MemoryAccessTier;
  readonly askedAt: string;
  readonly embeddingSpace: typeof recallEmbeddingSpace;
  readonly policyVersion: typeof recallPolicyVersion;
  readonly recalled: readonly ReceiptRecalledEntry[];
  readonly receiptId: string;
  readonly serverPurpose: string;
  readonly tenantId: string;
  readonly withheld: readonly ReceiptWithheldEntry[];
  readonly recordFamily: "disclosure_receipt";
  readonly recordSchemaVersion: "zc.internal.disclosure-receipt.v1";
}

export type MemoryAskResult =
  | Readonly<{
      readonly disclosed: readonly DisclosedRecall[];
      readonly outcome: "answered";
      readonly receipt: DisclosureReceipt;
    }>
  | typeof denied;

export function isIssuedMemoryAskResult(value: unknown): value is MemoryAskResult {
  return typeof value === "object" && value !== null && issuedMemoryAskResults.has(value);
}

export type MemoryCorrectionDisposition = "supersede" | "retract";

export interface MemoryCorrectionReplacement {
  readonly content: string;
  readonly embedding: readonly number[];
  readonly sensitivity: MemorySensitivity;
  readonly sourceRef: string;
}

export interface MemoryCorrectionCommand {
  readonly disposition: MemoryCorrectionDisposition;
  readonly expectedRevision: string;
  readonly factId: string;
  readonly occurredAt: string;
  readonly replacement?: MemoryCorrectionReplacement;
}

export interface MemoryPropagationEntry {
  readonly disposition: MemoryCorrectionDisposition;
  readonly factId: string;
  readonly fromRevision: string;
  readonly occurredAt: string;
  readonly serverPurpose: string;
  readonly tenantId: string;
  readonly toRevision: string;
  readonly recordFamily: "memory_propagation";
  readonly recordSchemaVersion: "zc.internal.memory-propagation.v1";
}

export type MemoryCorrectionResult =
  | Readonly<{
      readonly outcome: "corrected";
      readonly propagation: MemoryPropagationEntry;
    }>
  | Readonly<{ readonly outcome: "conflict" }>
  | typeof denied;

export interface RecallLedgerRepository {
  readonly teach: (
    fact: MemoryFact,
    scope: MemoryScope,
    currentScope: () => boolean,
  ) => MemoryTeachResult;
  readonly recall: (
    embedding: readonly number[],
    topK: number,
    scope: MemoryScope,
    currentScope: () => boolean,
  ) => RecallResult | typeof denied;
  readonly correct: (
    command: MemoryCorrectionCommand,
    scope: MemoryScope,
    currentScope: () => boolean,
  ) => MemoryCorrectionResult;
  readonly storeReceipt: (
    receipt: Omit<DisclosureReceipt, "receiptId">,
    scope: MemoryScope,
    currentScope: () => boolean,
  ) => DisclosureReceipt | typeof denied;
  readonly receipts: (
    scope: MemoryScope,
    currentScope: () => boolean,
  ) => readonly DisclosureReceipt[] | typeof denied;
  readonly propagations: (
    scope: MemoryScope,
    currentScope: () => boolean,
  ) => readonly MemoryPropagationEntry[] | typeof denied;
}

export interface RecallResult {
  readonly authorized: readonly MemoryFact[];
  readonly withheld: readonly ReceiptWithheldEntry[];
}

function recallResult(value: RecallResult | typeof denied): value is RecallResult {
  return "authorized" in value && Array.isArray(value.authorized) && Array.isArray(value.withheld);
}

export interface RecallLedgerService {
  readonly ask: (context: unknown, command: unknown, now: unknown) => MemoryAskResult;
  readonly correct: (context: unknown, command: unknown, now: unknown) => MemoryCorrectionResult;
  readonly propagations: (
    context: unknown,
    now: unknown,
  ) => readonly MemoryPropagationEntry[] | typeof denied;
  readonly receipts: (
    context: unknown,
    now: unknown,
  ) => readonly DisclosureReceipt[] | typeof denied;
  readonly teach: (context: unknown, command: unknown, now: unknown) => MemoryTeachResult;
}

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

function snapshot(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> | undefined {
  const copied = own(value);
  if (!copied) return undefined;
  const keys = Object.keys(copied);
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
    ? copied
    : undefined;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{48}$/u.test(value);
}

function purpose(value: unknown): value is string {
  return typeof value === "string" && value.length <= 96 && /^[a-z][a-z0-9._:-]*$/u.test(value);
}

function token(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9._:-]*$/u.test(value)
  );
}

function revision(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 20 || !/^[0-9]+$/u.test(value)) return false;
  if (value !== "0" && !/^[1-9][0-9]*$/u.test(value)) return false;
  try {
    return BigInt(value) <= maximumRevision;
  } catch {
    return false;
  }
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sensitivity(value: unknown): value is MemorySensitivity {
  return value === "public" || value === "restricted";
}

function accessTier(value: unknown): value is MemoryAccessTier {
  return value === "standard" || value === "privileged";
}

function content(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isControl =
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
    if (isControl) return false;
  }
  return true;
}

function embedding(value: unknown): value is readonly number[] {
  if (!Array.isArray(value) || value.length !== recallEmbeddingDimension) return false;
  let norm = 0;
  for (const component of value) {
    if (typeof component !== "number" || !Number.isFinite(component)) return false;
    norm += component * component;
  }
  return norm > 0;
}

const capabilityByOperation: Readonly<Record<MemoryOperation, string>> = Object.freeze({
  [operationTeach]: "continuity.memory.teach",
  [operationAsk]: "continuity.memory.ask",
  [operationCorrect]: "continuity.memory.correct",
  [operationAudit]: "continuity.memory.audit",
});

function scope(
  contexts: TenantContextService,
  context: unknown,
  now: number,
  operation: MemoryOperation,
): MemoryScope | undefined {
  try {
    const result = snapshot(contexts.validate(context, now), ["context", "outcome"]);
    if (!result || result.outcome !== "issued") return undefined;
    const contextValue = result.context;
    if (contextValue === null || typeof contextValue !== "object") return undefined;
    const contextRecord = snapshot(contextValue, ["operation", "purpose", "tenantId", "workload"]);
    if (!contextRecord) return undefined;
    if (
      !token(contextRecord.operation) ||
      contextRecord.operation !== operation ||
      !purpose(contextRecord.purpose) ||
      !identifier(contextRecord.tenantId)
    )
      return undefined;
    if (operation === operationAsk) {
      const workload = snapshot(contextRecord.workload, ["accessTier", "capability"]);
      if (
        !token(workload?.capability) ||
        workload.capability !== capabilityByOperation[operation] ||
        !accessTier(workload.accessTier)
      )
        return undefined;
      return Object.freeze({
        accessTier: workload.accessTier,
        operation,
        serverPurpose: contextRecord.purpose,
        tenantId: contextRecord.tenantId,
      });
    }
    const workload = snapshot(contextRecord.workload, ["capability"]);
    if (!token(workload?.capability) || workload.capability !== capabilityByOperation[operation])
      return undefined;
    return Object.freeze({
      operation,
      serverPurpose: contextRecord.purpose,
      tenantId: contextRecord.tenantId,
    });
  } catch {
    return undefined;
  }
}

function scopeGuard(
  contexts: TenantContextService,
  context: unknown,
  now: number,
  operation: MemoryOperation,
) {
  const initial = scope(contexts, context, now, operation);
  return {
    initial,
    valid() {
      try {
        const current = scope(contexts, context, now, operation);
        return (
          !!initial &&
          !!current &&
          current.operation === operation &&
          current.serverPurpose === initial.serverPurpose &&
          current.tenantId === initial.tenantId &&
          current.accessTier === initial.accessTier
        );
      } catch {
        return false;
      }
    },
  };
}

function teachCommand(value: unknown, context: MemoryScope): MemoryFact | undefined {
  const record = snapshot(value, [
    "content",
    "embedding",
    "factId",
    "occurredAt",
    "sensitivity",
    "sourceRef",
  ]);
  if (
    !record ||
    !identifier(record.factId) ||
    !content(record.content) ||
    !embedding(record.embedding) ||
    !timestamp(record.occurredAt) ||
    !sensitivity(record.sensitivity) ||
    !identifier(record.sourceRef)
  )
    return undefined;
  return Object.freeze({
    content: record.content,
    embedding: Object.freeze([...record.embedding]),
    embeddingSpace: recallEmbeddingSpace,
    factId: record.factId,
    occurredAt: record.occurredAt,
    revision: "1",
    sensitivity: record.sensitivity,
    serverPurpose: context.serverPurpose,
    sourceRef: record.sourceRef,
    status: "active" as const,
    tenantId: context.tenantId,
    recordFamily: "memory_fact" as const,
    recordSchemaVersion: "zc.internal.memory-fact.v1" as const,
  });
}

function askCommand(value: unknown): MemoryAskCommand | undefined {
  const record = snapshot(value, ["askedAt", "embedding", "topK"]);
  if (
    !record ||
    !timestamp(record.askedAt) ||
    !embedding(record.embedding) ||
    typeof record.topK !== "number" ||
    !Number.isSafeInteger(record.topK) ||
    record.topK < 1 ||
    record.topK > 16
  )
    return undefined;
  return Object.freeze({
    askedAt: record.askedAt,
    embedding: Object.freeze([...record.embedding]),
    topK: record.topK,
  });
}

function correctionCommand(value: unknown): MemoryCorrectionCommand | undefined {
  const source = own(value);
  if (!source) return undefined;
  const hasReplacement = Object.hasOwn(source, "replacement");
  const expected = [
    "disposition",
    "expectedRevision",
    "factId",
    "occurredAt",
    ...(hasReplacement ? ["replacement"] : []),
  ];
  if (
    Object.keys(source).length !== expected.length ||
    !Object.keys(source).every((key) => expected.includes(key))
  )
    return undefined;
  if (
    (source.disposition !== "supersede" && source.disposition !== "retract") ||
    !revision(source.expectedRevision) ||
    source.expectedRevision === "0" ||
    !identifier(source.factId) ||
    !timestamp(source.occurredAt)
  )
    return undefined;
  if (source.disposition === "supersede") {
    const replacement = snapshot(source.replacement, [
      "content",
      "embedding",
      "sensitivity",
      "sourceRef",
    ]);
    if (
      !replacement ||
      !content(replacement.content) ||
      !embedding(replacement.embedding) ||
      !sensitivity(replacement.sensitivity) ||
      !identifier(replacement.sourceRef)
    )
      return undefined;
    return Object.freeze({
      disposition: "supersede" as const,
      expectedRevision: source.expectedRevision,
      factId: source.factId,
      occurredAt: source.occurredAt,
      replacement: Object.freeze({
        content: replacement.content,
        embedding: Object.freeze([...replacement.embedding]),
        sensitivity: replacement.sensitivity,
        sourceRef: replacement.sourceRef,
      }),
    });
  }
  if (hasReplacement) return undefined;
  return Object.freeze({
    disposition: "retract" as const,
    expectedRevision: source.expectedRevision,
    factId: source.factId,
    occurredAt: source.occurredAt,
  });
}

// The recall policy gate: runs on every candidate before any content is
// disclosed to the caller/model. Withheld entries carry identifiers and a
// reason only — never the withheld content itself.
function disclose(
  candidates: readonly MemoryFact[],
  tier: MemoryAccessTier,
  askEmbedding: readonly number[],
  topK: number,
): {
  disclosed: DisclosedRecall[];
  recalled: ReceiptRecalledEntry[];
  withheld: ReceiptWithheldEntry[];
} {
  const scored = candidates
    .map((fact) => ({ fact, similarity: cosine(askEmbedding, fact.embedding) }))
    .sort((a, b) => b.similarity - a.similarity || a.fact.factId.localeCompare(b.fact.factId))
    .slice(0, topK);
  const disclosed: DisclosedRecall[] = [];
  const recalled: ReceiptRecalledEntry[] = [];
  const withheld: ReceiptWithheldEntry[] = [];
  for (const { fact, similarity } of scored) {
    if (fact.status === "retracted") {
      withheld.push(
        Object.freeze({
          factId: fact.factId,
          reason: "retracted" as const,
          revision: fact.revision,
        }),
      );
      continue;
    }
    if (fact.sensitivity === "restricted" && tier !== "privileged") {
      withheld.push(
        Object.freeze({
          factId: fact.factId,
          reason: "sensitivity_policy" as const,
          revision: fact.revision,
        }),
      );
      continue;
    }
    const rounded = Math.round(similarity * 10_000) / 10_000;
    disclosed.push(
      Object.freeze({
        content: fact.content,
        factId: fact.factId,
        revision: fact.revision,
        similarity: rounded,
      }),
    );
    recalled.push(
      Object.freeze({ factId: fact.factId, revision: fact.revision, similarity: rounded }),
    );
  }
  return { disclosed, recalled, withheld };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < recallEmbeddingDimension; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function createRecallLedgerService(
  contexts: TenantContextService,
  repository: RecallLedgerRepository,
): RecallLedgerService {
  return Object.freeze({
    teach(context: unknown, draft: unknown, now: unknown): MemoryTeachResult {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationTeach);
      if (!guard.initial) return denied;
      const fact = teachCommand(draft, guard.initial);
      if (!fact) return denied;
      return repository.teach(fact, guard.initial, guard.valid);
    },
    ask(context: unknown, draft: unknown, now: unknown): MemoryAskResult {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationAsk);
      if (!guard.initial || !guard.initial.accessTier) return denied;
      const command = askCommand(draft);
      if (!command) return denied;
      const candidates = repository.recall(
        command.embedding,
        command.topK,
        guard.initial,
        guard.valid,
      );
      if (!recallResult(candidates)) return denied;
      const scoped = candidates.authorized.filter(
        (fact) =>
          fact &&
          fact.tenantId === guard.initial?.tenantId &&
          fact.serverPurpose === guard.initial?.serverPurpose &&
          fact.embeddingSpace === recallEmbeddingSpace,
      );
      const gate = disclose(scoped, guard.initial.accessTier, command.embedding, command.topK);
      const withheld = candidates.withheld.filter(
        (entry) =>
          entry &&
          identifier(entry.factId) &&
          revision(entry.revision) &&
          entry.reason === "sensitivity_policy",
      );
      if (!guard.valid()) return denied;
      const receipt = repository.storeReceipt(
        {
          accessTier: guard.initial.accessTier,
          askedAt: command.askedAt,
          embeddingSpace: recallEmbeddingSpace,
          policyVersion: recallPolicyVersion,
          recalled: Object.freeze(gate.recalled),
          serverPurpose: guard.initial.serverPurpose,
          tenantId: guard.initial.tenantId,
          withheld: Object.freeze([...withheld, ...gate.withheld]),
          recordFamily: "disclosure_receipt",
          recordSchemaVersion: "zc.internal.disclosure-receipt.v1",
        },
        guard.initial,
        guard.valid,
      );
      if (receipt === denied || !("receiptId" in receipt)) return denied;
      if (!guard.valid()) return denied;
      const result = Object.freeze({
        disclosed: Object.freeze(gate.disclosed),
        outcome: "answered" as const,
        receipt,
      });
      issuedMemoryAskResults.add(result);
      return result;
    },
    correct(context: unknown, draft: unknown, now: unknown): MemoryCorrectionResult {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationCorrect);
      if (!guard.initial) return denied;
      const command = correctionCommand(draft);
      if (!command) return denied;
      return repository.correct(command, guard.initial, guard.valid);
    },
    receipts(context: unknown, now: unknown): readonly DisclosureReceipt[] | typeof denied {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationAudit);
      if (!guard.initial) return denied;
      return repository.receipts(guard.initial, guard.valid);
    },
    propagations(
      context: unknown,
      now: unknown,
    ): readonly MemoryPropagationEntry[] | typeof denied {
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return denied;
      const guard = scopeGuard(contexts, context, now, operationAudit);
      if (!guard.initial) return denied;
      return repository.propagations(guard.initial, guard.valid);
    },
  });
}

export { revision as recallRevisionGuard };
