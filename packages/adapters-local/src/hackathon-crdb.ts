// biome-ignore-all format: keep the bounded E2 adapter below its reviewed LOC ceiling.
import { types as nodeUtilTypes } from "node:util";
import { Pool } from "pg";
import { h2DemoDataset } from "./h2-demo-dataset.js";

const purpose = "hackathon-demo";
const titanSpace = "zc.bedrock-titan-v2.1024";
const maximumRevision = 18_446_744_073_709_551_615n;
const zeroVector = `[${Array(1024).fill(0).join(",")}]`;
const denied = (reason: HackathonCrdbReason) =>
  Object.freeze({ outcome: "denied" as const, reason });
function isProxy(value: unknown): boolean {
  return nodeUtilTypes.isProxy(value);
}

export const hackathonDviPublicSql = `SELECT fact_id, fact_revision::string AS fact_revision, content,
  embedding <-> $3::vector AS distance, deletion_fence::string AS deletion_fence
FROM continuity.memory_facts@{FORCE_INDEX=memory_facts_titan_scope_l2,NO_FULL_SCAN}
WHERE tenant_id = $1 AND server_purpose = $2
  AND embedding_space = 'zc.bedrock-titan-v2.1024'
  AND fact_status = 'active' AND sensitivity = 'public'
ORDER BY embedding <-> $3::vector LIMIT $4`;

export const hackathonDviRestrictedSql = `SELECT fact_id, fact_revision::string AS fact_revision,
  embedding <-> $3::vector AS distance, deletion_fence::string AS deletion_fence,
  'sensitivity_policy'::string AS reason
FROM continuity.memory_facts@{FORCE_INDEX=memory_facts_titan_scope_l2,NO_FULL_SCAN}
WHERE tenant_id = $1 AND server_purpose = $2
  AND embedding_space = 'zc.bedrock-titan-v2.1024'
  AND fact_status = 'active' AND sensitivity = 'restricted'
ORDER BY embedding <-> $3::vector LIMIT $4`;

export type HackathonCrdbReason =
  | "conflict"
  | "database_error"
  | "invalid_input"
  | "serialization_exhausted";

interface QueryResultLike {
  readonly rowCount?: number | null;
  readonly rows: readonly unknown[];
}

interface ClientLike {
  readonly query: (sql: string, params?: readonly unknown[]) => Promise<QueryResultLike>;
  readonly release: (error?: Error | boolean) => void;
}

export interface HackathonPoolLike {
  readonly connect: () => Promise<ClientLike>;
}

export interface HackathonCrdbOptions {
  readonly connectionString?: string;
  readonly pool?: HackathonPoolLike;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface HackathonScope {
  readonly purpose: typeof purpose;
  readonly tenantId: string;
}

export interface RetrieveSnapshotInput {
  readonly accessTier: "standard";
  readonly embedding: readonly number[];
  readonly sessionDigest: string;
  readonly topK: number;
}

export interface CorrectMemoryInput {
  readonly attemptId: string;
  readonly disposition: "supersede";
  readonly expectedRevision: "1";
  readonly factId: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly replacement: Readonly<{
    readonly content: string;
    readonly embedding: readonly number[];
    readonly sensitivity: "public";
    readonly sourceRef: string;
  }>;
  readonly sessionDigest: string;
}

let productionPool: Pool | undefined;
let productionConnectionString: string | undefined;

const allowances = Object.freeze({
  start: [0, 3, 0],
  ask_before: [1, 1, 1],
  correct: [2, 1, 0],
  ask_after: [3, 1, 1],
  latest_receipt: [4, 0, 0],
} as const);

function liveUrl(value: unknown): string | undefined {
  try {
    if (typeof value !== "string") return undefined;
    const url = new URL(value);
    const allowedHost = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.cockroachlabs\.cloud$/u.test(url.hostname);
    if (
      url.protocol !== "postgresql:" ||
      !allowedHost ||
      url.username !== "continuity_app" ||
      !url.password ||
      url.port !== "26257" ||
      url.pathname !== "/defaultdb" ||
      url.hash ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode")
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function poolFor(options: HackathonCrdbOptions): HackathonPoolLike | undefined {
  if (options.pool) return options.pool;
  const connectionString = liveUrl(options.connectionString);
  if (
    !connectionString ||
    (productionConnectionString && productionConnectionString !== connectionString)
  )
    return undefined;
  productionConnectionString = connectionString;
  productionPool ??= new Pool({
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 1,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
  return productionPool;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value))
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Reflect.ownKeys(descriptors);
    if (
      names.length !== keys.length ||
      names.some((key) => typeof key !== "string" || !keys.includes(key))
    )
      return undefined;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{48}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function bounded(value: unknown, maximum = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function revision(value: unknown): value is string {
  try {
    return (
      typeof value === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(value) &&
      BigInt(value) <= maximumRevision
    );
  } catch {
    return false;
  }
}

function fence(value: unknown): value is string {
  try {
    return (
      typeof value === "string" &&
      /^(?:0|[1-9][0-9]{0,19})$/u.test(value) &&
      BigInt(value) <= maximumRevision
    );
  } catch {
    return false;
  }
}

function safeInt(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function vector(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value) || isProxy(value) || value.length !== 1024) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let norm = 0;
  const copied: number[] = [];
  for (let index = 0; index < 1024; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "number" ||
      !Number.isFinite(descriptor.value)
    )
      return undefined;
    norm += descriptor.value * descriptor.value;
    copied.push(descriptor.value);
  }
  return norm >= 0.98 && norm <= 1.02 ? Object.freeze(copied) : undefined;
}

function vectorLiteral(value: readonly number[]): string {
  return `[${value.join(",")}]`;
}

function serialization(error: unknown): boolean {
  try {
    if (error === null || typeof error !== "object" || isProxy(error)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined && "value" in descriptor && descriptor.value === "40001";
  } catch {
    return false;
  }
}

async function scoped<T>(
  pool: HackathonPoolLike,
  scope: HackathonScope,
  role: "executor" | "reservation" | "session",
  operation: (client: ClientLike) => Promise<T>,
  options: HackathonCrdbOptions,
): Promise<T | ReturnType<typeof denied> | Readonly<{ outcome: "unknown" }>> {
  type Outcome = T | ReturnType<typeof denied> | Readonly<{ outcome: "unknown" }>;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let client: ClientLike;
    try {
      client = await pool.connect();
    } catch {
      return denied("database_error");
    }
    let released = false;
    let committing = false;
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await client.query(
        role === "executor"
          ? "SET LOCAL ROLE zc_continuity_executor"
          : role === "reservation"
            ? "SET LOCAL ROLE zc_continuity_reservation_writer"
            : "SET LOCAL ROLE zc_continuity_session_issuer",
      );
      await client.query("SELECT set_config('continuity.tenant_id', $1, true)", [scope.tenantId]);
      await client.query("SELECT set_config('continuity.server_purpose', $1, true)", [
        scope.purpose,
      ]);
      const result = await operation(client);
      committing = true;
      await client.query("COMMIT");
      committing = false;
      return result;
    } catch (error) {
      let broken = false;
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      try {
        client.release(broken ? true : error instanceof Error ? error : true);
      } catch {
        broken = true;
      }
      released = true;
      if (serialization(error)) {
        if (attempt === 2) return denied("serialization_exhausted");
        const random = Math.min(1, Math.max(0, options.random?.() ?? Math.random()));
        await (
          options.sleep ??
          ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
        )(Math.floor((attempt + 1) * 5 * (1 + random)));
      } else {
        if (committing) return Object.freeze({ outcome: "unknown" as const }) as Outcome;
        return denied("database_error");
      }
    } finally {
      if (!released)
        try {
          client.release();
        } catch {
          // A post-transaction pool release failure cannot expose driver details.
        }
    }
  }
  return denied("serialization_exhausted");
}

function validScope(input: HackathonScope): boolean {
  return identifier(input.tenantId) && input.purpose === purpose;
}

async function authenticate(client: ClientLike, tenantId: string, sessionDigest: string) {
  const token = await client.query(
    `SELECT session_digest FROM continuity.hackathon_session_tokens
WHERE tenant_id=$1 AND server_purpose=$2 AND session_digest=$3 AND expires_at>CURRENT_TIMESTAMP`,
    [tenantId, purpose, sessionDigest],
  );
  return token.rows.length === 1;
}

function session(value: unknown) {
  if (!digest(value)) return undefined;
  return Object.freeze({ purpose, sessionDigest: value, tenantId: value.slice(0, 48) });
}

function numeric(left: string, right: string): number {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}

function lineageArray(value: unknown, minimum: number) {
  if (!Array.isArray(value) || isProxy(value) || value.length < minimum || value.length > 8)
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(String(key)),
    )
  )
    return undefined;
  const rows: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
    rows.push(descriptor.value);
  }
  return rows;
}

function activeRevisions(value: unknown) {
  const rows = lineageArray(value, 1);
  if (!rows) return undefined;
  const parsed = rows.map((entry) => record(entry, ["deletionFence", "factId", "revision"]));
  if (
    parsed.some(
      (entry) =>
        !entry ||
        !identifier(entry.factId) ||
        !revision(entry.revision) ||
        !fence(entry.deletionFence),
    )
  )
    return undefined;
  const exact = parsed as { deletionFence: string; factId: string; revision: string }[];
  exact.sort(
    (left, right) =>
      left.factId.localeCompare(right.factId) ||
      numeric(left.revision, right.revision) ||
      numeric(left.deletionFence, right.deletionFence),
  );
  return new Set(exact.map((entry) => `${entry.factId}:${entry.revision}`)).size === exact.length
    ? exact
    : undefined;
}

function withheldRevisions(value: unknown) {
  const rows = lineageArray(value, 0);
  if (!rows) return undefined;
  const parsed = rows.map((entry) =>
    record(entry, ["deletionFence", "factId", "reason", "revision"]),
  );
  if (
    parsed.some(
      (entry) =>
        !entry ||
        !identifier(entry.factId) ||
        !revision(entry.revision) ||
        !fence(entry.deletionFence) ||
        entry.reason !== "sensitivity_policy",
    )
  )
    return undefined;
  const exact = parsed as {
    deletionFence: string;
    factId: string;
    reason: "sensitivity_policy";
    revision: string;
  }[];
  exact.sort(
    (left, right) =>
      left.factId.localeCompare(right.factId) ||
      numeric(left.revision, right.revision) ||
      numeric(left.deletionFence, right.deletionFence),
  );
  return new Set(exact.map((entry) => `${entry.factId}:${entry.revision}:${entry.deletionFence}`))
    .size === exact.length
    ? exact
    : undefined;
}

function seedVectors(value: unknown) {
  if (!Array.isArray(value) || isProxy(value) || value.length !== 3) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const parsed = Array.from({ length: 3 }, (_, index) => {
    const descriptor = descriptors[String(index)];
    return descriptor && "value" in descriptor ? vector(descriptor.value) : undefined;
  });
  return parsed.every(Boolean) ? (parsed as readonly (readonly number[])[]) : undefined;
}

function answerRow(value: unknown) {
  const row = record(value, [
    "context_compiler_version",
    "deletion_fence",
    "embedding_model_id",
    "embedding_space",
    "input_tokens",
    "latency_ms",
    "model_id",
    "output_tokens",
    "policy_version",
    "provider_request_id",
    "receipt_id",
    "retrieval_config_version",
    "response_body",
    "step_name",
    "total_tokens",
  ]);
  if (
    !row ||
    !identifier(row.receipt_id) ||
    (row.step_name !== "ask_before" && row.step_name !== "ask_after") ||
    !bounded(row.policy_version, 96) ||
    !bounded(row.context_compiler_version, 96) ||
    !fence(row.deletion_fence) ||
    row.embedding_space !== titanSpace ||
    row.embedding_model_id !== "amazon.titan-embed-text-v2:0" ||
    !bounded(row.retrieval_config_version, 96) ||
    row.model_id !== "amazon.nova-lite-v1:0" ||
    !bounded(row.provider_request_id) ||
    !bounded(row.response_body, 4096) ||
    ![row.input_tokens, row.output_tokens, row.total_tokens, row.latency_ms].every(
      (number) => safeInt(number) !== undefined,
    ) ||
    safeInt(row.total_tokens) !==
      (safeInt(row.input_tokens) as number) + (safeInt(row.output_tokens) as number)
  )
    return undefined;
  return Object.freeze({
    contextCompilerVersion: row.context_compiler_version,
    deletionFence: row.deletion_fence,
    embeddingModelId: row.embedding_model_id,
    embeddingSpace: row.embedding_space,
    inputTokens: safeInt(row.input_tokens) as number,
    latencyMs: safeInt(row.latency_ms) as number,
    modelId: row.model_id,
    outputTokens: safeInt(row.output_tokens) as number,
    policyVersion: row.policy_version,
    providerRequestId: row.provider_request_id,
    receiptId: row.receipt_id,
    retrievalConfigVersion: row.retrieval_config_version,
    responseBody: row.response_body,
    step: row.step_name,
    totalTokens: safeInt(row.total_tokens) as number,
  });
}

function lineageRows(value: unknown, withheld: boolean) {
  const rows = lineageArray(value, withheld ? 0 : 1);
  if (!rows) return undefined;
  const parsed = rows.map((row) =>
    record(
      row,
      withheld
        ? ["deletion_fence", "fact_id", "fact_revision", "reason"]
        : ["deletion_fence", "fact_id", "fact_revision"],
    ),
  );
  if (
    parsed.some(
      (entry) =>
        !entry ||
        !identifier(entry.fact_id) ||
        !revision(entry.fact_revision) ||
        !fence(entry.deletion_fence) ||
        (withheld && entry.reason !== "sensitivity_policy"),
    )
  )
    return undefined;
  const exact = parsed as {
    deletion_fence: string;
    fact_id: string;
    fact_revision: string;
    reason?: "sensitivity_policy";
  }[];
  exact.sort(
    (left, right) =>
      left.fact_id.localeCompare(right.fact_id) ||
      numeric(left.fact_revision, right.fact_revision) ||
      numeric(left.deletion_fence, right.deletion_fence),
  );
  if (
    new Set(exact.map((entry) => `${entry.fact_id}:${entry.fact_revision}:${entry.deletion_fence}`))
      .size !== exact.length
  )
    return undefined;
  return Object.freeze(
    exact.map((entry) =>
      Object.freeze(
        withheld
          ? {
              deletionFence: entry.deletion_fence,
              factId: entry.fact_id,
              reason: "sensitivity_policy" as const,
              revision: entry.fact_revision,
            }
          : {
              deletionFence: entry.deletion_fence,
              factId: entry.fact_id,
              revision: entry.fact_revision,
            },
      ),
    ),
  );
}

async function receiptLineage(client: ClientLike, scope: HackathonScope, receiptId: string) {
  const recalled = lineageRows(
    (
      await client.query(
        `SELECT fact_id,fact_revision::string AS fact_revision,deletion_fence::string AS deletion_fence
FROM continuity.hackathon_receipt_revisions
WHERE tenant_id=$1 AND server_purpose=$2 AND receipt_id=$3 ORDER BY fact_id,fact_revision,deletion_fence`,
        [scope.tenantId, purpose, receiptId],
      )
    ).rows,
    false,
  );
  const withheld = lineageRows(
    (
      await client.query(
        `SELECT fact_id,fact_revision::string AS fact_revision,deletion_fence::string AS deletion_fence,reason
FROM continuity.hackathon_receipt_withheld
WHERE tenant_id=$1 AND server_purpose=$2 AND receipt_id=$3 ORDER BY fact_id,fact_revision,deletion_fence`,
        [scope.tenantId, purpose, receiptId],
      )
    ).rows,
    true,
  );
  return recalled && withheld ? Object.freeze({ recalled, withheld }) : undefined;
}

export function createHackathonCrdbRepository(options: HackathonCrdbOptions) {
  const pool = poolFor(options);
  return Object.freeze({
    async startSession(input: unknown) {
      const value = record(input, ["attemptId", "operationId", "requestDigest", "sessionDigest"]);
      if (
        !pool ||
        !value ||
        !identifier(value.attemptId) ||
        !identifier(value.operationId) ||
        !digest(value.requestDigest) ||
        !digest(value.sessionDigest)
      )
        return denied("invalid_input");
      const tenantId = value.sessionDigest.slice(0, 48);
      const scope = { purpose, tenantId } as const;
      return scoped(
        pool,
        scope,
        "session",
        async (client) => {
          const replay = await client.query(
            `SELECT token.session_digest FROM continuity.hackathon_session_tokens AS token
JOIN continuity.hackathon_provider_reservations AS reservation
  ON reservation.tenant_id=token.tenant_id AND reservation.server_purpose=token.server_purpose
WHERE token.tenant_id=$1 AND token.server_purpose=$2 AND token.session_digest=$3
  AND token.expires_at>CURRENT_TIMESTAMP AND reservation.step_name='start'
  AND reservation.request_digest=$4 AND reservation.operation_id=$5 AND reservation.attempt_id=$6`,
            [
              tenantId,
              purpose,
              value.sessionDigest,
              value.requestDigest,
              value.operationId,
              value.attemptId,
            ],
          );
          if (replay.rows.length === 1)
            return Object.freeze({ outcome: "replayed" as const, tenantId });
          const existing = await client.query(
            "SELECT 1 AS exists FROM continuity.hackathon_session_tokens WHERE tenant_id=$1 AND server_purpose=$2",
            [tenantId, purpose],
          );
          if (existing.rows.length > 0) return Object.freeze({ outcome: "conflict" as const });
          const locked = await client.query(
            "SELECT lock_version FROM continuity.hackathon_quota_lock WHERE lock_id='public-v1' FOR UPDATE",
          );
          if (safeInt(record(locked.rows[0], ["lock_version"])?.lock_version) === undefined)
            return Object.freeze({ outcome: "conflict" as const });
          const control = await client.query(
            "SELECT provider_enabled FROM continuity.hackathon_runtime_control WHERE control_id='live-v1'",
          );
          const quota = await client.query(
            "SELECT public_sessions,public_titan,engineering_titan FROM continuity.hackathon_usage_summary_v1",
          );
          const cap = record(quota.rows[0], [
            "engineering_titan",
            "public_titan",
            "public_sessions",
          ]);
          if (
            !cap ||
            record(control.rows[0], ["provider_enabled"])?.provider_enabled !== true ||
            safeInt(cap.public_sessions) === undefined ||
            safeInt(cap.public_titan) === undefined ||
            safeInt(cap.engineering_titan) === undefined ||
            (safeInt(cap.public_sessions) as number) >= 100 ||
            (safeInt(cap.public_titan) as number) + 3 > 600 ||
            (safeInt(cap.public_titan) as number) + (safeInt(cap.engineering_titan) as number) + 3 >
              800
          )
            return Object.freeze({ outcome: "denied" as const, reason: "conflict" as const });
          await client.query("INSERT INTO continuity.tenants (tenant_id) VALUES ($1)", [tenantId]);
          await client.query(
            `INSERT INTO continuity.hackathon_sessions
	(tenant_id,server_purpose,deletion_fence,created_at,expires_at)
	VALUES ($1,$2,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '24 hours')`,
            [tenantId, purpose],
          );
          await client.query(
            `INSERT INTO continuity.hackathon_session_tokens
(tenant_id,server_purpose,session_digest,created_at,expires_at)
VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '24 hours')`,
            [tenantId, purpose, value.sessionDigest],
          );
          await client.query(
            "INSERT INTO continuity.hackathon_session_usage (tenant_id,server_purpose,audience,created_at) VALUES ($1,$2,'public',CURRENT_TIMESTAMP)",
            [tenantId, purpose],
          );
          await client.query(
            "INSERT INTO continuity.hackathon_provider_usage (tenant_id,server_purpose,operation_id,attempt_id,audience,titan_count,nova_count,created_at) VALUES ($1,$2,$3,$4,'public',3,0,CURRENT_TIMESTAMP)",
            [tenantId, purpose, value.operationId, value.attemptId],
          );
          await client.query(
            `INSERT INTO continuity.hackathon_provider_reservations
(tenant_id,server_purpose,step_ordinal,step_name,request_digest,operation_id,attempt_id,audience,titan_count,nova_count,reservation_state,reserved_at)
VALUES ($1,$2,0,'start',$3,$4,$5,'public',3,0,'reserved',CURRENT_TIMESTAMP)`,
            [tenantId, purpose, value.requestDigest, value.operationId, value.attemptId],
          );
          return Object.freeze({ outcome: "succeeded" as const, tenantId });
        },
        options,
      );
    },
    async reserveOperation(input: unknown) {
      const value = record(input, [
        "attemptId",
        "operationId",
        "requestDigest",
        "sessionDigest",
        "step",
      ]);
      const allowance =
        typeof value?.step === "string"
          ? allowances[value.step as keyof typeof allowances]
          : undefined;
      if (
        !pool ||
        !value ||
        !digest(value.sessionDigest) ||
        !identifier(value.attemptId) ||
        !identifier(value.operationId) ||
        !digest(value.requestDigest) ||
        !allowance
      )
        return denied("invalid_input");
      const scope = session(value.sessionDigest);
      if (!scope) return denied("invalid_input");
      const [ordinal, titan, nova] = allowance;
      return scoped(
        pool,
        scope,
        "reservation",
        async (client) => {
          if (!scope || !(await authenticate(client, scope.tenantId, scope.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const prior = await client.query(
            `SELECT request_digest,operation_id,attempt_id,reservation_state
FROM continuity.hackathon_provider_reservations
WHERE tenant_id=$1 AND server_purpose=$2 AND step_ordinal=$3`,
            [scope.tenantId, purpose, ordinal],
          );
          if (prior.rows.length > 0) {
            const row = record(prior.rows[0], [
              "attempt_id",
              "operation_id",
              "request_digest",
              "reservation_state",
            ]);
            return row &&
              row.request_digest === value.requestDigest &&
              row.operation_id === value.operationId &&
              row.attempt_id === value.attemptId &&
              row.reservation_state === "reserved"
              ? Object.freeze({ outcome: "replayed" as const, nova, titan })
              : Object.freeze({ outcome: "conflict" as const });
          }
          const progress = await client.query(
            "SELECT count(*)::INT8 AS steps FROM continuity.hackathon_provider_reservations WHERE tenant_id=$1 AND server_purpose=$2",
            [scope.tenantId, purpose],
          );
          if (Number(record(progress.rows[0], ["steps"])?.steps) !== ordinal)
            return Object.freeze({ outcome: "conflict" as const });
          const locked = await client.query(
            "SELECT lock_version FROM continuity.hackathon_quota_lock WHERE lock_id='public-v1' FOR UPDATE",
          );
          if (safeInt(record(locked.rows[0], ["lock_version"])?.lock_version) === undefined)
            return Object.freeze({ outcome: "conflict" as const });
          const control = await client.query(
            "SELECT provider_enabled FROM continuity.hackathon_runtime_control WHERE control_id='live-v1'",
          );
          const quota = await client.query(
            "SELECT public_titan,public_nova,engineering_titan,engineering_nova FROM continuity.hackathon_usage_summary_v1",
          );
          const cap = record(quota.rows[0], [
            "engineering_nova",
            "engineering_titan",
            "public_nova",
            "public_titan",
          ]);
          if (
            !cap ||
            [cap.public_titan, cap.public_nova, cap.engineering_titan, cap.engineering_nova].some(
              (count) => safeInt(count) === undefined,
            ) ||
            ((titan > 0 || nova > 0) &&
              record(control.rows[0], ["provider_enabled"])?.provider_enabled !== true) ||
            (safeInt(cap.public_titan) as number) + titan > 600 ||
            (safeInt(cap.public_nova) as number) + nova > 200 ||
            (safeInt(cap.public_titan) as number) +
              (safeInt(cap.engineering_titan) as number) +
              titan >
              800 ||
            (safeInt(cap.public_nova) as number) +
              (safeInt(cap.engineering_nova) as number) +
              nova >
              300
          )
            return Object.freeze({ outcome: "denied" as const, reason: "conflict" as const });
          await client.query(
            "INSERT INTO continuity.hackathon_provider_usage (tenant_id,server_purpose,operation_id,attempt_id,audience,titan_count,nova_count,created_at) VALUES ($1,$2,$3,$4,'public',$5,$6,CURRENT_TIMESTAMP)",
            [scope.tenantId, purpose, value.operationId, value.attemptId, titan, nova],
          );
          await client.query(
            `INSERT INTO continuity.hackathon_provider_reservations
(tenant_id,server_purpose,step_ordinal,step_name,request_digest,operation_id,attempt_id,audience,titan_count,nova_count,reservation_state,reserved_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,'public',$8,$9,'reserved',CURRENT_TIMESTAMP)`,
            [
              scope.tenantId,
              purpose,
              ordinal,
              value.step,
              value.requestDigest,
              value.operationId,
              value.attemptId,
              titan,
              nova,
            ],
          );
          return Object.freeze({ nova, outcome: "succeeded" as const, titan });
        },
        options,
      );
    },
    async storeInitialFacts(input: unknown) {
      const value = record(input, [
        "attemptId",
        "embeddings",
        "operationId",
        "requestDigest",
        "sessionDigest",
      ]);
      const auth = session(value?.sessionDigest);
      const embeddings = seedVectors(value?.embeddings);
      if (
        !pool ||
        !value ||
        !auth ||
        !embeddings ||
        !identifier(value.attemptId) ||
        !identifier(value.operationId) ||
        !digest(value.requestDigest)
      )
        return denied("invalid_input");
      return scoped(
        pool,
        auth,
        "executor",
        async (client) => {
          if (!(await authenticate(client, auth.tenantId, auth.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const prior = await client.query(
            `SELECT request_digest,operation_id,attempt_id FROM continuity.hackathon_effect_results
WHERE tenant_id=$1 AND server_purpose=$2 AND step_name='start'`,
            [auth.tenantId, purpose],
          );
          if (prior.rows.length > 0) {
            const row = record(prior.rows[0], ["attempt_id", "operation_id", "request_digest"]);
            if (!row) return Object.freeze({ outcome: "conflict" as const });
            return row.request_digest === value.requestDigest &&
              row.operation_id === value.operationId &&
              row.attempt_id === value.attemptId
              ? Object.freeze({ outcome: "replayed" as const })
              : Object.freeze({ outcome: "conflict" as const });
          }
          const reservation = await client.query(
            `SELECT 1 AS allowed FROM continuity.hackathon_provider_reservations
WHERE tenant_id=$1 AND server_purpose=$2 AND step_name='start' AND request_digest=$3
  AND operation_id=$4 AND attempt_id=$5`,
            [auth.tenantId, purpose, value.requestDigest, value.operationId, value.attemptId],
          );
          if (reservation.rows.length !== 1) return Object.freeze({ outcome: "conflict" as const });
          for (const [index, fact] of h2DemoDataset.facts.entries())
            await client.query(
              `INSERT INTO continuity.memory_facts (
  tenant_id,server_purpose,fact_id,fact_revision,record_schema_version,record_family,
  requested_purpose,sensitivity,fact_status,content,embedding,embedding_space,source_ref,occurred_at
) VALUES ($1,$2,$3,1,'zc.internal.memory-fact.v1','memory_fact',$2,$4,'active',$5,$6::vector,$7,$8,CURRENT_TIMESTAMP)`,
              [
                auth.tenantId,
                purpose,
                fact.factId,
                fact.sensitivity,
                fact.content,
                vectorLiteral(embeddings[index] as readonly number[]),
                titanSpace,
                fact.sourceRef,
              ],
            );
          await client.query(
            `INSERT INTO continuity.hackathon_effect_results
(tenant_id,server_purpose,step_name,request_digest,operation_id,attempt_id,completed_at)
VALUES ($1,$2,'start',$3,$4,$5,CURRENT_TIMESTAMP)`,
            [auth.tenantId, purpose, value.requestDigest, value.operationId, value.attemptId],
          );
          return Object.freeze({ outcome: "succeeded" as const });
        },
        options,
      );
    },
    async retrieveSnapshot(input: unknown) {
      const value = record(input, ["accessTier", "embedding", "sessionDigest", "topK"]);
      const auth = session(value?.sessionDigest);
      if (!value || value.accessTier !== "standard" || !auth) return denied("invalid_input");
      const parsed = {
        accessTier: "standard",
        embedding: value.embedding,
        purpose,
        tenantId: auth.tenantId,
        topK: value.topK,
      } as const;
      const queryVector = vector(parsed.embedding);
      if (
        !pool ||
        !validScope(parsed) ||
        !queryVector ||
        !Number.isInteger(parsed.topK) ||
        (parsed.topK as number) < 1 ||
        (parsed.topK as number) > 8
      )
        return denied("invalid_input");
      return scoped(
        pool,
        parsed,
        "executor",
        async (client) => {
          if (!(await authenticate(client, auth.tenantId, auth.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const sessionFence = await client.query(
            "SELECT deletion_fence::string AS deletion_fence FROM continuity.hackathon_sessions WHERE tenant_id=$1 AND server_purpose=$2",
            [auth.tenantId, purpose],
          );
          const deletionFence = record(sessionFence.rows[0], ["deletion_fence"])?.deletion_fence;
          if (!fence(deletionFence)) throw new Error("INVALID_FENCE");
          const params = [
            parsed.tenantId,
            purpose,
            vectorLiteral(queryVector),
            parsed.topK,
          ] as const;
          const publicRows = await client.query(hackathonDviPublicSql, params);
          const restrictedRows = await client.query(hackathonDviRestrictedSql, params);
          const authorized = publicRows.rows.map((row) => {
            const value = record(row, [
              "content",
              "deletion_fence",
              "distance",
              "fact_id",
              "fact_revision",
            ]);
            if (
              !value ||
              !identifier(value.fact_id) ||
              !revision(value.fact_revision) ||
              typeof value.content !== "string" ||
              value.content.length < 1 ||
              value.content.length > 2048 ||
              typeof value.distance !== "number" ||
              !Number.isFinite(value.distance) ||
              value.distance < 0 ||
              !fence(value.deletion_fence)
            )
              throw new Error("INVALID_ROW");
            return Object.freeze({
              content: value.content,
              deletionFence: value.deletion_fence,
              factId: value.fact_id,
              revision: value.fact_revision,
              similarity: 1 / (1 + value.distance),
            });
          });
          const withheld = restrictedRows.rows.map((row) => {
            const value = record(row, [
              "deletion_fence",
              "distance",
              "fact_id",
              "fact_revision",
              "reason",
            ]);
            if (
              !value ||
              !identifier(value.fact_id) ||
              !revision(value.fact_revision) ||
              value.reason !== "sensitivity_policy" ||
              !fence(value.deletion_fence) ||
              typeof value.distance !== "number" ||
              !Number.isFinite(value.distance) ||
              value.distance < 0
            )
              throw new Error("INVALID_ROW");
            return Object.freeze({
              deletionFence: value.deletion_fence,
              factId: value.fact_id,
              reason: value.reason,
              revision: value.fact_revision,
              similarity: 1 / (1 + value.distance),
            });
          });
          return Object.freeze({
            authorized: Object.freeze(authorized),
            deletionFence,
            outcome: "succeeded" as const,
            withheld: Object.freeze(withheld),
          });
        },
        options,
      );
    },
    async finalizeAnswerReceipt(input: unknown) {
      const keys = [
        "attemptId",
        "contextCompilerVersion",
        "deletionFence",
        "embeddingSpace",
        "embeddingInputTokens",
        "embeddingLatencyMs",
        "embeddingModelId",
        "embeddingPolicyDecisionId",
        "embeddingProviderRequestId",
        "expectedActiveRevisions",
        "expectedWithheld",
        "inputTokens",
        "latencyMs",
        "modelId",
        "operationId",
        "outputTokens",
        "outcome",
        "policyDecisionId",
        "policyVersion",
        "provider",
        "providerRequestId",
        "receiptId",
        "region",
        "requestDigest",
        "requestDigestVersion",
        "responseBody",
        "retrievalConfigVersion",
        "sessionDigest",
        "step",
        "stopReason",
        "totalTokens",
      ];
      const value = record(input, keys);
      const auth = session(value?.sessionDigest);
      const expected = activeRevisions(value?.expectedActiveRevisions);
      const expectedWithheld = withheldRevisions(value?.expectedWithheld);
      if (
        !pool ||
        !value ||
        !auth ||
        !identifier(value.receiptId) ||
        !identifier(value.operationId) ||
        !identifier(value.attemptId) ||
        !digest(value.requestDigest) ||
        value.requestDigestVersion !== "zc.request-digest.v1" ||
        !bounded(value.policyDecisionId) ||
        !bounded(value.policyVersion, 96) ||
        !bounded(value.contextCompilerVersion, 96) ||
        !bounded(value.retrievalConfigVersion, 96) ||
        value.embeddingSpace !== titanSpace ||
        value.embeddingModelId !== "amazon.titan-embed-text-v2:0" ||
        !bounded(value.embeddingPolicyDecisionId) ||
        !bounded(value.embeddingProviderRequestId) ||
        value.provider !== "amazon-bedrock" ||
        value.modelId !== "amazon.nova-lite-v1:0" ||
        value.region !== "us-east-1" ||
        !bounded(value.providerRequestId) ||
        (value.step !== "ask_before" && value.step !== "ask_after") ||
        value.stopReason !== "end_turn" ||
        value.outcome !== "succeeded" ||
        !bounded(value.responseBody, 4096) ||
        !expected ||
        !expectedWithheld ||
        !fence(value.deletionFence) ||
        [...expected, ...expectedWithheld].some(
          (entry) => entry.deletionFence !== value.deletionFence,
        ) ||
        new Set(
          [...expected, ...expectedWithheld].map((entry) => `${entry.factId}:${entry.revision}`),
        ).size !==
          expected.length + expectedWithheld.length ||
        ![
          value.embeddingInputTokens,
          value.embeddingLatencyMs,
          value.inputTokens,
          value.outputTokens,
          value.totalTokens,
          value.latencyMs,
        ].every((number) => Number.isSafeInteger(number) && (number as number) >= 0) ||
        value.totalTokens !== (value.inputTokens as number) + (value.outputTokens as number)
      )
        return denied("invalid_input");
      const scope = auth;
      return scoped(
        pool,
        scope,
        "executor",
        async (client) => {
          if (!(await authenticate(client, auth.tenantId, auth.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const exactReceipt = await client.query(
            `SELECT receipt.receipt_id FROM continuity.hackathon_answer_receipts AS receipt
JOIN continuity.hackathon_response_payloads AS payload
  ON payload.tenant_id=receipt.tenant_id AND payload.server_purpose=receipt.server_purpose
  AND payload.receipt_id=receipt.receipt_id
WHERE receipt.tenant_id=$1 AND receipt.server_purpose=$2 AND receipt.receipt_id=$3
  AND receipt.step_name=$4 AND receipt.operation_id=$5 AND receipt.attempt_id=$6
  AND receipt.request_digest=$7 AND receipt.request_digest_version=$8
  AND receipt.policy_decision_id=$9 AND receipt.policy_version=$10
  AND receipt.context_compiler_version=$11 AND receipt.retrieval_config_version=$12
  AND receipt.embedding_space=$13 AND receipt.embedding_model_id=$14
  AND receipt.embedding_policy_decision_id=$15 AND receipt.embedding_provider_request_id=$16
  AND receipt.embedding_input_tokens=$17 AND receipt.embedding_latency_ms=$18
  AND receipt.provider=$19 AND receipt.model_id=$20 AND receipt.region=$21
  AND receipt.provider_request_id=$22 AND receipt.input_tokens=$23
  AND receipt.output_tokens=$24 AND receipt.total_tokens=$25 AND receipt.latency_ms=$26
  AND receipt.stop_reason=$27 AND receipt.provider_outcome=$28
  AND receipt.deletion_fence=$29 AND payload.response_body=$30`,
            [
              scope.tenantId,
              purpose,
              value.receiptId,
              value.step,
              value.operationId,
              value.attemptId,
              value.requestDigest,
              value.requestDigestVersion,
              value.policyDecisionId,
              value.policyVersion,
              value.contextCompilerVersion,
              value.retrievalConfigVersion,
              titanSpace,
              value.embeddingModelId,
              value.embeddingPolicyDecisionId,
              value.embeddingProviderRequestId,
              value.embeddingInputTokens,
              value.embeddingLatencyMs,
              value.provider,
              value.modelId,
              value.region,
              value.providerRequestId,
              value.inputTokens,
              value.outputTokens,
              value.totalTokens,
              value.latencyMs,
              value.stopReason,
              value.outcome,
              value.deletionFence,
              value.responseBody,
            ],
          );
          if (exactReceipt.rows.length === 1) {
            const lineage = await receiptLineage(client, scope, value.receiptId as string);
            const recalled = lineage?.recalled.map(
              (item) => `${item.factId}:${item.revision}:${item.deletionFence}`,
            );
            const withheld = lineage?.withheld.map(
              (item) => `${item.factId}:${item.revision}:${item.deletionFence}:${item.reason}`,
            );
            const wantedRecalled = expected.map(
              (item) => `${item.factId}:${item.revision}:${item.deletionFence}`,
            );
            const wantedWithheld = expectedWithheld.map(
              (item) => `${item.factId}:${item.revision}:${item.deletionFence}:${item.reason}`,
            );
            return recalled &&
              withheld &&
              recalled.length === wantedRecalled.length &&
              withheld.length === wantedWithheld.length &&
              recalled.every((item, index) => item === wantedRecalled[index]) &&
              withheld.every((item, index) => item === wantedWithheld[index])
              ? Object.freeze({
                  outcome: "replayed" as const,
                  receiptId: value.receiptId,
                  responseBody: value.responseBody,
                })
              : Object.freeze({ outcome: "conflict" as const });
          }
          const collision = await client.query(
            `SELECT 1 AS collision FROM continuity.hackathon_answer_receipts
WHERE tenant_id=$1 AND server_purpose=$2 AND (receipt_id=$3 OR attempt_id=$4)`,
            [scope.tenantId, purpose, value.receiptId, value.attemptId],
          );
          if (collision.rows.length > 0) return Object.freeze({ outcome: "conflict" as const });
          const reservation = await client.query(
            `SELECT request_digest,operation_id,attempt_id FROM continuity.hackathon_provider_reservations
WHERE tenant_id=$1 AND server_purpose=$2 AND step_name=$3 AND request_digest=$4 AND operation_id=$5 AND attempt_id=$6`,
            [
              scope.tenantId,
              purpose,
              value.step,
              value.requestDigest,
              value.operationId,
              value.attemptId,
            ],
          );
          if (reservation.rows.length !== 1) return Object.freeze({ outcome: "conflict" as const });
          const session = await client.query(
            "SELECT deletion_fence::string AS deletion_fence FROM continuity.hackathon_sessions WHERE tenant_id=$1 AND server_purpose=$2",
            [scope.tenantId, purpose],
          );
          if (record(session.rows[0], ["deletion_fence"])?.deletion_fence !== value.deletionFence)
            return Object.freeze({ outcome: "conflict" as const });
          for (const entry of expected) {
            const active = await client.query(
              `SELECT fact_id,fact_revision::string AS fact_revision,deletion_fence::string AS deletion_fence
FROM continuity.memory_facts WHERE tenant_id=$1 AND server_purpose=$2 AND fact_id=$3
  AND fact_revision=$4 AND fact_status='active' AND sensitivity='public'`,
              [scope.tenantId, purpose, entry.factId, entry.revision],
            );
            const row = record(active.rows[0], ["deletion_fence", "fact_id", "fact_revision"]);
            if (
              !row ||
              row.fact_id !== entry.factId ||
              row.fact_revision !== entry.revision ||
              row.deletion_fence !== entry.deletionFence
            )
              return Object.freeze({ outcome: "conflict" as const });
          }
          for (const entry of expectedWithheld) {
            const restricted = await client.query(
              `SELECT fact_id,fact_revision::string AS fact_revision,deletion_fence::string AS deletion_fence
FROM continuity.memory_facts WHERE tenant_id=$1 AND server_purpose=$2 AND fact_id=$3
  AND fact_revision=$4 AND fact_status='active' AND sensitivity='restricted'`,
              [scope.tenantId, purpose, entry.factId, entry.revision],
            );
            const row = record(restricted.rows[0], ["deletion_fence", "fact_id", "fact_revision"]);
            if (
              !row ||
              row.fact_id !== entry.factId ||
              row.fact_revision !== entry.revision ||
              row.deletion_fence !== entry.deletionFence
            )
              return Object.freeze({ outcome: "conflict" as const });
          }
          await client.query(
            `INSERT INTO continuity.hackathon_answer_receipts
(tenant_id,server_purpose,receipt_id,step_name,operation_id,attempt_id,request_digest,request_digest_version,
 policy_decision_id,policy_version,context_compiler_version,retrieval_config_version,embedding_space,
 embedding_model_id,embedding_policy_decision_id,embedding_provider_request_id,embedding_input_tokens,embedding_latency_ms,
 provider,model_id,region,provider_request_id,input_tokens,output_tokens,total_tokens,latency_ms,stop_reason,provider_outcome,deletion_fence,created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,CURRENT_TIMESTAMP)`,
            [
              scope.tenantId,
              purpose,
              value.receiptId,
              value.step,
              value.operationId,
              value.attemptId,
              value.requestDigest,
              value.requestDigestVersion,
              value.policyDecisionId,
              value.policyVersion,
              value.contextCompilerVersion,
              value.retrievalConfigVersion,
              titanSpace,
              value.embeddingModelId,
              value.embeddingPolicyDecisionId,
              value.embeddingProviderRequestId,
              value.embeddingInputTokens,
              value.embeddingLatencyMs,
              value.provider,
              value.modelId,
              value.region,
              value.providerRequestId,
              value.inputTokens,
              value.outputTokens,
              value.totalTokens,
              value.latencyMs,
              value.stopReason,
              value.outcome,
              value.deletionFence,
            ],
          );
          await client.query(
            `INSERT INTO continuity.hackathon_response_payloads
(tenant_id,server_purpose,receipt_id,response_body,created_at)
VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)`,
            [scope.tenantId, purpose, value.receiptId, value.responseBody],
          );
          for (const entry of expected)
            await client.query(
              `INSERT INTO continuity.hackathon_receipt_revisions
(tenant_id,server_purpose,receipt_id,fact_id,fact_revision,deletion_fence) VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                scope.tenantId,
                purpose,
                value.receiptId,
                entry.factId,
                entry.revision,
                entry.deletionFence,
              ],
            );
          for (const entry of expectedWithheld)
            await client.query(
              `INSERT INTO continuity.hackathon_receipt_withheld
(tenant_id,server_purpose,receipt_id,fact_id,fact_revision,deletion_fence,reason)
VALUES ($1,$2,$3,$4,$5,$6,'sensitivity_policy')`,
              [
                scope.tenantId,
                purpose,
                value.receiptId,
                entry.factId,
                entry.revision,
                entry.deletionFence,
              ],
            );
          return Object.freeze({
            outcome: "succeeded" as const,
            receiptId: value.receiptId,
            responseBody: value.responseBody,
          });
        },
        options,
      );
    },
    async replayAnswer(input: unknown) {
      const value = record(input, [
        "attemptId",
        "operationId",
        "requestDigest",
        "sessionDigest",
        "step",
      ]);
      const auth = session(value?.sessionDigest);
      if (
        !pool ||
        !value ||
        !auth ||
        !identifier(value.attemptId) ||
        !identifier(value.operationId) ||
        !digest(value.requestDigest) ||
        (value.step !== "ask_before" && value.step !== "ask_after")
      )
        return denied("invalid_input");
      return scoped(
        pool,
        auth,
        "executor",
        async (client) => {
          if (!(await authenticate(client, auth.tenantId, auth.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const result = await client.query(
            `SELECT receipt.receipt_id,receipt.step_name,receipt.policy_version,
  receipt.context_compiler_version,receipt.retrieval_config_version,receipt.embedding_space,
  receipt.embedding_model_id,receipt.deletion_fence::string AS deletion_fence,receipt.model_id,
  receipt.provider_request_id,receipt.input_tokens,receipt.output_tokens,receipt.total_tokens,
  receipt.latency_ms,payload.response_body
FROM continuity.hackathon_answer_receipts AS receipt
JOIN continuity.hackathon_response_payloads AS payload
  ON payload.tenant_id=receipt.tenant_id AND payload.server_purpose=receipt.server_purpose
  AND payload.receipt_id=receipt.receipt_id
WHERE receipt.tenant_id=$1 AND receipt.server_purpose=$2 AND receipt.step_name=$3
  AND receipt.request_digest=$4 AND receipt.operation_id=$5 AND receipt.attempt_id=$6`,
            [
              auth.tenantId,
              purpose,
              value.step,
              value.requestDigest,
              value.operationId,
              value.attemptId,
            ],
          );
          const answer = answerRow(result.rows[0]);
          const lineage = answer ? await receiptLineage(client, auth, answer.receiptId) : undefined;
          return answer && answer.step === value.step && lineage
            ? Object.freeze({ ...answer, ...lineage, outcome: "replayed" as const })
            : Object.freeze({ outcome: "conflict" as const });
        },
        options,
      );
    },
    async latestReceipt(input: unknown) {
      const value = record(input, ["attemptId", "operationId", "requestDigest", "sessionDigest"]);
      const auth = session(value?.sessionDigest);
      if (
        !pool ||
        !value ||
        !auth ||
        !identifier(value.attemptId) ||
        !identifier(value.operationId) ||
        !digest(value.requestDigest)
      )
        return denied("invalid_input");
      return scoped(
        pool,
        auth,
        "executor",
        async (client) => {
          if (!(await authenticate(client, auth.tenantId, auth.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const reservation = await client.query(
            `SELECT 1 AS allowed FROM continuity.hackathon_provider_reservations
WHERE tenant_id=$1 AND server_purpose=$2 AND step_name='latest_receipt'
  AND request_digest=$3 AND operation_id=$4 AND attempt_id=$5`,
            [auth.tenantId, purpose, value.requestDigest, value.operationId, value.attemptId],
          );
          if (reservation.rows.length !== 1) return Object.freeze({ outcome: "conflict" as const });
          const result = await client.query(
            `SELECT receipt.receipt_id,receipt.step_name,receipt.policy_version,
  receipt.context_compiler_version,receipt.retrieval_config_version,receipt.embedding_space,
  receipt.embedding_model_id,receipt.deletion_fence::string AS deletion_fence,receipt.model_id,
  receipt.provider_request_id,receipt.input_tokens,receipt.output_tokens,receipt.total_tokens,
  receipt.latency_ms,payload.response_body
FROM continuity.hackathon_answer_receipts AS receipt
JOIN continuity.hackathon_response_payloads AS payload
  ON payload.tenant_id=receipt.tenant_id AND payload.server_purpose=receipt.server_purpose
  AND payload.receipt_id=receipt.receipt_id
WHERE receipt.tenant_id=$1 AND receipt.server_purpose=$2
ORDER BY receipt.created_at DESC,receipt.receipt_id DESC LIMIT 1`,
            [auth.tenantId, purpose],
          );
          const answer = answerRow(result.rows[0]);
          const lineage = answer ? await receiptLineage(client, auth, answer.receiptId) : undefined;
          return answer && lineage
            ? Object.freeze({ ...answer, ...lineage, outcome: "succeeded" as const })
            : Object.freeze({ outcome: "conflict" as const });
        },
        options,
      );
    },
    async correct(candidate: unknown) {
      const base =
        record(candidate, [
          "disposition",
          "expectedRevision",
          "factId",
          "attemptId",
          "operationId",
          "requestDigest",
          "replacement",
          "sessionDigest",
        ]) ??
        record(candidate, [
          "disposition",
          "expectedRevision",
          "factId",
          "attemptId",
          "operationId",
          "requestDigest",
          "sessionDigest",
        ]);
      const replacement =
        base?.replacement === undefined
          ? undefined
          : record(base.replacement, ["content", "embedding", "sensitivity", "sourceRef"]);
      const auth = session(base?.sessionDigest);
      if (
        !base ||
        !auth ||
        !identifier(base.attemptId) ||
        !identifier(base.operationId) ||
        !digest(base.requestDigest) ||
        base.disposition !== "supersede"
      )
        return denied("invalid_input");
      const input = {
        disposition: base.disposition,
        expectedRevision: base.expectedRevision,
        factId: base.factId,
        purpose,
        replacement,
        tenantId: auth.tenantId,
      } as const;
      const replacementVector = replacement ? vector(replacement.embedding) : undefined;
      if (
        !pool ||
        !validScope(input) ||
        input.factId !== h2DemoDataset.supersede.factId ||
        input.expectedRevision !== "1" ||
        !replacement ||
        !replacementVector ||
        replacement.sourceRef !== h2DemoDataset.facts[0]?.sourceRef ||
        replacement.sensitivity !== "public" ||
        replacement.content !== h2DemoDataset.supersede.content
      )
        return denied("invalid_input");
      const expectedRevision = input.expectedRevision as string;
      return scoped(
        pool,
        input,
        "executor",
        async (client) => {
          if (!(await authenticate(client, auth.tenantId, auth.sessionDigest)))
            return Object.freeze({ outcome: "conflict" as const });
          const toRevision = "2";
          const prior = await client.query(
            `SELECT request_digest,operation_id,attempt_id,fact_id,from_revision::string AS from_revision,
  to_revision::string AS to_revision,disposition FROM continuity.hackathon_effect_results
WHERE tenant_id=$1 AND server_purpose=$2 AND step_name='correct'`,
            [auth.tenantId, purpose],
          );
          if (prior.rows.length > 0) {
            const row = record(prior.rows[0], [
              "attempt_id",
              "disposition",
              "fact_id",
              "from_revision",
              "operation_id",
              "request_digest",
              "to_revision",
            ]);
            if (!row) return Object.freeze({ outcome: "conflict" as const });
            return row.request_digest === base.requestDigest &&
              row.operation_id === base.operationId &&
              row.attempt_id === base.attemptId &&
              row.fact_id === input.factId &&
              row.from_revision === expectedRevision &&
              row.to_revision === toRevision &&
              row.disposition === input.disposition
              ? Object.freeze({ outcome: "replayed" as const, revision: toRevision })
              : Object.freeze({ outcome: "conflict" as const });
          }
          const reservation = await client.query(
            `SELECT 1 AS allowed FROM continuity.hackathon_provider_reservations
WHERE tenant_id=$1 AND server_purpose=$2 AND step_name='correct' AND request_digest=$3 AND operation_id=$4 AND attempt_id=$5`,
            [auth.tenantId, purpose, base.requestDigest, base.operationId, base.attemptId],
          );
          if (reservation.rows.length !== 1) return Object.freeze({ outcome: "conflict" as const });
          const updated = await client.query(
            `UPDATE continuity.memory_facts
SET fact_status = 'retracted', content = '', embedding = $5::vector
WHERE tenant_id = $1 AND server_purpose = $2 AND fact_id = $3
  AND fact_revision = $4 AND fact_status = 'active'
RETURNING fact_revision::string AS fact_revision`,
            [input.tenantId, purpose, input.factId, expectedRevision, zeroVector],
          );
          if (updated.rows.length === 0) return Object.freeze({ outcome: "conflict" as const });
          if (updated.rows.length !== 1) throw new Error("INVALID_CAS");
          if (replacement && replacementVector)
            await client.query(
              `INSERT INTO continuity.memory_facts (
  tenant_id,server_purpose,fact_id,fact_revision,record_schema_version,record_family,
  requested_purpose,sensitivity,fact_status,content,embedding,embedding_space,source_ref,occurred_at
) VALUES ($1,$2,$3,$4,'zc.internal.memory-fact.v1','memory_fact',$2,$5,'active',$6,$7::vector,$8,$9,CURRENT_TIMESTAMP)`,
              [
                input.tenantId,
                purpose,
                input.factId,
                toRevision,
                replacement.sensitivity,
                replacement.content,
                vectorLiteral(replacementVector),
                titanSpace,
                replacement.sourceRef,
              ],
            );
          await client.query(
            `INSERT INTO continuity.memory_propagations (
  tenant_id,server_purpose,fact_id,from_revision,to_revision,record_schema_version,
  record_family,requested_purpose,disposition,occurred_at
) VALUES ($1,$2,$3,$4,$5,'zc.internal.memory-propagation.v1','memory_propagation',$2,$6,CURRENT_TIMESTAMP)`,
            [
              input.tenantId,
              purpose,
              input.factId,
              expectedRevision,
              toRevision,
              input.disposition,
            ],
          );
          await client.query(
            `INSERT INTO continuity.hackathon_effect_results
(tenant_id,server_purpose,step_name,request_digest,operation_id,attempt_id,fact_id,from_revision,to_revision,disposition,completed_at)
VALUES ($1,$2,'correct',$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)`,
            [
              input.tenantId,
              purpose,
              base.requestDigest,
              base.operationId,
              base.attemptId,
              input.factId,
              expectedRevision,
              toRevision,
              input.disposition,
            ],
          );
          return Object.freeze({ outcome: "succeeded" as const, revision: toRevision });
        },
        options,
      );
    },
  });
}
