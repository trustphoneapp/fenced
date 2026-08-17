import type {
  MemoryCorrectionCommand,
  MemoryFact,
  MemoryScope,
} from "@zintus-continuity/application";
import {
  padLocalEmbeddingToPersistent,
  persistentSyntheticEmbeddingSpace,
  recallEmbeddingDimension,
  unwrapPersistentSyntheticEmbedding,
} from "@zintus-continuity/application";

// CockroachDB SQL plans for the recall ledger. No `pg` import and no network.
// HG-5 supplies an executor that runs these statements against a live cluster.

const denied = Object.freeze({ outcome: "denied" as const });
const maximumRevision = 18_446_744_073_709_551_615n;

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface SqlExecutor {
  readonly query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ readonly rows: readonly SqlRow[] }>;
}

export type SqlPlan =
  | Readonly<{
      readonly outcome: "sql";
      readonly params: readonly unknown[];
      readonly sql: string;
      readonly toRevision?: string;
    }>
  | typeof denied;

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function revisionValue(value: string): bigint | undefined {
  try {
    const parsed = BigInt(value);
    return parsed >= 1n && parsed <= maximumRevision ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function successorRevision(value: string): string | undefined {
  const current = revisionValue(value);
  return current === undefined || current >= maximumRevision
    ? undefined
    : (current + 1n).toString();
}

function parseEmbedding(value: unknown): readonly number[] | undefined {
  if (Array.isArray(value)) {
    const numbers = value.map((entry) => Number(entry));
    if (numbers.every((entry) => Number.isFinite(entry))) return numbers;
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^\[|\]$/gu, "");
    const numbers = trimmed.split(",").map((part) => Number(part.trim()));
    if (numbers.length > 0 && numbers.every((entry) => Number.isFinite(entry))) return numbers;
  }
  return undefined;
}

export function mapCrdbFactRow(row: SqlRow): MemoryFact | typeof denied {
  const factId = asString(row.fact_id);
  const revisionRaw = row.fact_revision;
  const revision =
    typeof revisionRaw === "string"
      ? revisionRaw
      : typeof revisionRaw === "number" || typeof revisionRaw === "bigint"
        ? String(revisionRaw)
        : undefined;
  const content = asString(row.content);
  const sensitivity = asString(row.sensitivity);
  const status = asString(row.fact_status);
  const serverPurpose = asString(row.server_purpose);
  const tenantId = asString(row.tenant_id);
  const sourceRef = asString(row.source_ref);
  const occurredAt = asString(row.occurred_at);
  const embeddingSpace = asString(row.embedding_space);
  const embedding = parseEmbedding(row.embedding);
  if (
    !factId ||
    !revision ||
    content === undefined ||
    (sensitivity !== "public" && sensitivity !== "restricted") ||
    (status !== "active" && status !== "retracted") ||
    !serverPurpose ||
    !tenantId ||
    !sourceRef ||
    !occurredAt ||
    !embedding ||
    embeddingSpace !== persistentSyntheticEmbeddingSpace
  )
    return denied;
  const local = unwrapPersistentSyntheticEmbedding(embedding, embeddingSpace);
  if (!Array.isArray(local) || local.length !== recallEmbeddingDimension) return denied;
  return Object.freeze({
    content,
    embedding: local,
    embeddingSpace: "zc.local-synthetic-embedding.v1",
    factId,
    occurredAt,
    revision,
    sensitivity,
    serverPurpose,
    sourceRef,
    status,
    tenantId,
    recordFamily: "memory_fact" as const,
    recordSchemaVersion: "zc.internal.memory-fact.v1" as const,
  });
}

export function createCrdbSqlRecallLedgerPlans(
  space: typeof persistentSyntheticEmbeddingSpace = persistentSyntheticEmbeddingSpace,
) {
  return Object.freeze({
    teachInsert(fact: MemoryFact, scope: MemoryScope): SqlPlan {
      if (fact.tenantId !== scope.tenantId || fact.serverPurpose !== scope.serverPurpose)
        return denied;
      const padded = padLocalEmbeddingToPersistent(fact.embedding, fact.embeddingSpace);
      if (padded.outcome !== "padded") return denied;
      return Object.freeze({
        outcome: "sql" as const,
        sql: `INSERT INTO continuity.memory_facts (
  tenant_id, server_purpose, fact_id, fact_revision, record_schema_version, record_family,
  requested_purpose, sensitivity, fact_status, content, embedding, embedding_space, source_ref, occurred_at
) VALUES ($1,$2,$3,1,'zc.internal.memory-fact.v1','memory_fact',$2,$4,'active',$5,$6::vector,$7,$8,$9::timestamptz)`,
        params: Object.freeze([
          fact.tenantId,
          fact.serverPurpose,
          fact.factId,
          fact.sensitivity,
          fact.content,
          vectorLiteral(padded.embedding),
          space,
          fact.sourceRef,
          fact.occurredAt,
        ]),
      });
    },
    recallSelect(scope: MemoryScope, embedding: readonly number[], topK: number): SqlPlan {
      if (scope.accessTier !== "standard" && scope.accessTier !== "privileged") return denied;
      const padded = padLocalEmbeddingToPersistent(embedding);
      if (padded.outcome !== "padded") return denied;
      // Latest active revision per fact only — matches local adapter semantics.
      return Object.freeze({
        outcome: "sql" as const,
        sql: `SELECT fact_id, fact_revision::string AS fact_revision, content, sensitivity, fact_status,
  server_purpose, tenant_id, source_ref, occurred_at::string AS occurred_at, embedding_space, embedding
FROM (
  SELECT DISTINCT ON (fact_id) *
  FROM continuity.memory_facts
  WHERE tenant_id = $1 AND server_purpose = $2 AND fact_status = 'active'
    AND ($3::BOOL OR sensitivity = 'public')
  ORDER BY fact_id, fact_revision DESC
) AS latest
ORDER BY embedding <=> $4::vector
LIMIT $5`,
        params: Object.freeze([
          scope.tenantId,
          scope.serverPurpose,
          scope.accessTier === "privileged",
          vectorLiteral(padded.embedding),
          topK,
        ]),
      });
    },
    supersedeDeactivatePrior(command: MemoryCorrectionCommand, scope: MemoryScope): SqlPlan {
      return Object.freeze({
        outcome: "sql" as const,
        sql: `UPDATE continuity.memory_facts
SET fact_status = 'retracted', content = ''
WHERE tenant_id = $1 AND server_purpose = $2 AND fact_id = $3
  AND fact_revision = $4 AND fact_status = 'active'`,
        params: Object.freeze([
          scope.tenantId,
          scope.serverPurpose,
          command.factId,
          command.expectedRevision,
        ]),
      });
    },
    supersedeInsert(
      command: MemoryCorrectionCommand,
      scope: MemoryScope,
      fromRevision: string,
    ): SqlPlan {
      const toRevision = successorRevision(command.expectedRevision);
      if (!command.replacement || fromRevision !== command.expectedRevision || !toRevision)
        return denied;
      const padded = padLocalEmbeddingToPersistent(command.replacement.embedding);
      if (padded.outcome !== "padded") return denied;
      // Caller must run supersedeDeactivatePrior in the same transaction first,
      // then this insert, then propagationInsert.
      return Object.freeze({
        outcome: "sql" as const,
        toRevision,
        sql: `INSERT INTO continuity.memory_facts (
  tenant_id, server_purpose, fact_id, fact_revision, record_schema_version, record_family,
  requested_purpose, sensitivity, fact_status, content, embedding, embedding_space, source_ref, occurred_at
) VALUES ($1,$2,$3,$4,'zc.internal.memory-fact.v1','memory_fact',$2,$5,'active',$6,$7::vector,$8,$9,$10::timestamptz)`,
        params: Object.freeze([
          scope.tenantId,
          scope.serverPurpose,
          command.factId,
          toRevision,
          command.replacement.sensitivity,
          command.replacement.content,
          vectorLiteral(padded.embedding),
          space,
          command.replacement.sourceRef,
          command.occurredAt,
        ]),
      });
    },
    retractUpdate(command: MemoryCorrectionCommand, scope: MemoryScope): SqlPlan {
      return Object.freeze({
        outcome: "sql" as const,
        sql: `UPDATE continuity.memory_facts
SET fact_status = 'retracted', content = '', embedding = array_fill(0::float8, ARRAY[1024])::vector
WHERE tenant_id = $1 AND server_purpose = $2 AND fact_id = $3
  AND EXISTS (
    SELECT 1 FROM continuity.memory_facts AS current
    WHERE current.tenant_id = $1 AND current.server_purpose = $2 AND current.fact_id = $3
      AND current.fact_revision = $4 AND current.fact_status = 'active'
  )`,
        params: Object.freeze([
          scope.tenantId,
          scope.serverPurpose,
          command.factId,
          command.expectedRevision,
        ]),
      });
    },
    propagationInsert(
      command: MemoryCorrectionCommand,
      scope: MemoryScope,
      fromRevision: string,
      toRevision: string,
    ): SqlPlan {
      const expectedToRevision =
        command.disposition === "retract"
          ? revisionValue(command.expectedRevision) === undefined
            ? undefined
            : "0"
          : successorRevision(command.expectedRevision);
      if (fromRevision !== command.expectedRevision || toRevision !== expectedToRevision)
        return denied;
      return Object.freeze({
        outcome: "sql" as const,
        sql: `INSERT INTO continuity.memory_propagations (
  tenant_id, server_purpose, fact_id, from_revision, to_revision, record_schema_version, record_family,
  requested_purpose, disposition, occurred_at
) VALUES ($1,$2,$3,$4,$5,'zc.internal.memory-propagation.v1','memory_propagation',$2,$6,$7::timestamptz)`,
        params: Object.freeze([
          scope.tenantId,
          scope.serverPurpose,
          command.factId,
          fromRevision,
          toRevision,
          command.disposition,
          command.occurredAt,
        ]),
      });
    },
  });
}

/** Fail-closed handle until HG-5 injects a live SqlExecutor. */
export function createCrdbSqlExecutorHandle(environment: {
  readonly COCKROACH_DATABASE_URL?: string | undefined;
}): Readonly<{
  readonly executor: SqlExecutor | undefined;
  readonly status:
    | Readonly<{ readonly configured: false; readonly reason: "missing_database_url" }>
    | Readonly<{ readonly configured: false; readonly reason: "human_gate_pending" }>;
}> {
  const url =
    typeof environment.COCKROACH_DATABASE_URL === "string"
      ? environment.COCKROACH_DATABASE_URL.trim()
      : "";
  if (!url) {
    return Object.freeze({
      executor: undefined,
      status: Object.freeze({
        configured: false as const,
        reason: "missing_database_url" as const,
      }),
    });
  }
  return Object.freeze({
    executor: undefined,
    status: Object.freeze({
      configured: false as const,
      reason: "human_gate_pending" as const,
    }),
  });
}
