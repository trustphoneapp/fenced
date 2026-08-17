/** Immutable local-synthetic DTOs and ports only. Adapter behavior belongs in adapters-local. */

export const localSyntheticFixture = "local_synthetic_fixture" as const;

export const localHarnessBounds = Object.freeze({
  faultJournal: 16,
  faultRules: 16,
  identities: 16,
  messageCommitments: 64,
  payloadBytes: 4096,
  providerFixtures: 16,
  queueDepth: 64,
  stateRows: 64,
  stringBytes: 128,
  vectorDimension: 16,
  vectorRows: 64,
  vectorSearchLimit: 16,
});

export type LocalHarnessErrorCode =
  | "BUSY"
  | "CONFLICT"
  | "DIMENSION_MISMATCH"
  | "IDEMPOTENCY_MISMATCH"
  | "INVALID_INPUT"
  | "INVALID_SCOPE"
  | "NOT_PERMITTED"
  | "STALE_HANDLE";

type JsonScalar = string | number | boolean | null;
export interface LocalJsonArray extends ReadonlyArray<LocalJson> {}
export interface LocalJsonObject {
  readonly [key: string]: LocalJson;
}
export type LocalJson = JsonScalar | LocalJsonArray | LocalJsonObject;

export interface LocalFixtureIdentityDefinition {
  readonly credentialRef: string;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly purposes: readonly string[];
}

export interface LocalProviderFixture {
  readonly attemptId: string;
  readonly contextCompilerVersion: string;
  readonly model: string;
  readonly operation: string;
  readonly outputRef: string;
  readonly policyVersion: string;
  readonly provider: string;
  readonly purpose: string;
  readonly requestId: string;
  readonly tenantId: string;
}

export interface LocalProviderInvocation {
  readonly attemptId: string;
  readonly contextCompilerVersion: string;
  readonly model: string;
  readonly operation: string;
  readonly policyVersion: string;
  readonly provider: string;
  readonly requestId: string;
}

export interface FaultRule {
  readonly action: "lost_ack";
  readonly operation: "queue.ack";
  readonly ordinal: number;
  readonly purpose: string;
  readonly tenantId: string;
}

/** Scope identifiers remain internal; journal entries are content-free. */
export interface FaultJournalEntry {
  readonly action: "lost_ack";
  readonly operation: "queue.ack";
  readonly ordinal: number;
}

export interface LocalSyntheticFixtureDefinition {
  readonly faultSchedule?: readonly FaultRule[];
  readonly identities: readonly LocalFixtureIdentityDefinition[];
  readonly initialTime?: number;
  readonly providerFixtures?: readonly LocalProviderFixture[];
  readonly queueLeaseMilliseconds?: number;
  readonly queueMaxAttempts?: number;
  readonly vectorDimension?: number;
}

/** Opaque runtime identities are issued only by a composed local adapter. */
export interface LocalIdentity {
  readonly fixture: typeof localSyntheticFixture;
}

/** Opaque runtime scopes are issued only by a composed local adapter. */
export interface LocalScope {
  readonly fixture: typeof localSyntheticFixture;
}

export interface ManualClockPort {
  readonly advance: (milliseconds: number) => number;
  readonly now: () => number;
}

export interface LocalStateWrite {
  readonly expectedRevision?: number;
  readonly idempotencyKey: string;
  readonly key: string;
  readonly value: LocalJson;
}

export interface LocalStateResult {
  readonly revision: number;
  readonly status: "applied" | "replayed";
}

export interface LocalStateRead {
  readonly revision: number;
  readonly value: LocalJson;
}

export interface QueueMessage {
  readonly id: string;
}

export interface QueueEnqueueMessage extends QueueMessage {
  readonly commitment: string;
}

export interface QueueEnqueueResult {
  readonly status: "enqueued" | "replayed";
}

export interface QueueDelivery {
  readonly attempts: number;
  readonly handle: object;
  readonly id: string;
}

export interface QueueResult {
  readonly status: "acknowledged" | "lost" | "stale";
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
}

export interface ProviderResult {
  readonly code?: "NOT_PERMITTED";
  readonly outcome: "denied" | "provided";
  readonly outputRef?: string;
  readonly trust?: "untrusted_data";
}

export interface LocalSyntheticRuntime {
  readonly clock: ManualClockPort;
  readonly faults: { readonly journal: (scope: LocalScope) => readonly FaultJournalEntry[] };
  readonly fixture: typeof localSyntheticFixture;
  readonly identity: {
    readonly authorize: (identity: LocalIdentity, purpose: string) => LocalScope;
    readonly resolve: (credentialRef: string) => LocalIdentity | undefined;
  };
  readonly provider: {
    readonly invoke: (scope: LocalScope, invocation: LocalProviderInvocation) => ProviderResult;
  };
  readonly queue: {
    readonly acknowledge: (scope: LocalScope, delivery: QueueDelivery) => QueueResult;
    readonly claim: (scope: LocalScope) => QueueDelivery | undefined;
    readonly deadLetters: (scope: LocalScope) => readonly QueueMessage[];
    readonly enqueue: (scope: LocalScope, message: QueueEnqueueMessage) => QueueEnqueueResult;
  };
  readonly state: {
    readonly read: (scope: LocalScope, key: string) => LocalStateRead | undefined;
    readonly write: (scope: LocalScope, write: LocalStateWrite) => LocalStateResult;
  };
  readonly tools: {
    readonly catalogue: () => readonly [];
    readonly execute: (
      scope: LocalScope,
      toolId: string,
    ) => {
      readonly code: "NOT_PERMITTED";
      readonly outcome: "denied";
    };
  };
  readonly vectors: {
    readonly search: (
      scope: LocalScope,
      query: readonly number[],
      limit: number,
    ) => readonly VectorMatch[];
    readonly upsert: (scope: LocalScope, id: string, coordinates: readonly number[]) => void;
  };
}

/** Separate controller capability; it is intentionally not reachable through runtime. */
export interface LocalSyntheticController {
  readonly reset: () => void;
}

export interface LocalSyntheticFixture {
  readonly controller: LocalSyntheticController;
  readonly runtime: LocalSyntheticRuntime;
}
