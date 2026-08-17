import type {
  DisclosureReceipt,
  MemoryCorrectionCommand,
  MemoryCorrectionResult,
  MemoryFact,
  MemoryPropagationEntry,
  MemoryScope,
  MemoryTeachResult,
  RecallLedgerRepository,
  RecallResult,
} from "@zintus-continuity/application";

// H2 CockroachDB adapter stub — fail-closed until HG-5 supplies a connection.
// Intentionally has no pg/network dependency. Calling any method returns denied
// so demo wiring can compile and test the "not configured" path without
// credentials, cloud, or provider runtime.

const denied = Object.freeze({ outcome: "denied" as const });

export type CrdbRecallLedgerStatus =
  | Readonly<{ readonly configured: false; readonly reason: "missing_database_url" }>
  | Readonly<{ readonly configured: false; readonly reason: "driver_not_installed" }>
  | Readonly<{
      readonly configured: false;
      readonly reason: "human_gate_pending";
      readonly note: "HG-5 cloud/operations required before live CockroachDB";
    }>;

export interface CrdbRecallLedgerHandle {
  readonly repository: RecallLedgerRepository;
  readonly status: CrdbRecallLedgerStatus;
}

function denyRepository(): RecallLedgerRepository {
  return Object.freeze({
    teach(_fact: MemoryFact, _scope: MemoryScope, currentScope: () => boolean): MemoryTeachResult {
      if (!currentScope()) return denied;
      return denied;
    },
    recall(
      _embedding: readonly number[],
      _topK: number,
      _scope: MemoryScope,
      currentScope: () => boolean,
    ): RecallResult | typeof denied {
      if (!currentScope()) return denied;
      return denied;
    },
    correct(
      _command: MemoryCorrectionCommand,
      _scope: MemoryScope,
      currentScope: () => boolean,
    ): MemoryCorrectionResult {
      if (!currentScope()) return denied;
      return denied;
    },
    storeReceipt(
      _receipt: Omit<DisclosureReceipt, "receiptId">,
      _scope: MemoryScope,
      currentScope: () => boolean,
    ): DisclosureReceipt | typeof denied {
      if (!currentScope()) return denied;
      return denied;
    },
    receipts(
      _scope: MemoryScope,
      currentScope: () => boolean,
    ): readonly DisclosureReceipt[] | typeof denied {
      if (!currentScope()) return denied;
      return denied;
    },
    propagations(
      _scope: MemoryScope,
      currentScope: () => boolean,
    ): readonly MemoryPropagationEntry[] | typeof denied {
      if (!currentScope()) return denied;
      return denied;
    },
  });
}

/**
 * Creates a fail-closed CRDB recall-ledger handle. Never opens a network
 * connection. Presence of COCKROACH_DATABASE_URL alone is not enough — the
 * live driver path remains human-gated (HG-5) and is not implemented here.
 */
export function createH2RecallLedgerCrdbStub(environment: {
  readonly COCKROACH_DATABASE_URL?: string | undefined;
}): CrdbRecallLedgerHandle {
  const url =
    typeof environment.COCKROACH_DATABASE_URL === "string"
      ? environment.COCKROACH_DATABASE_URL.trim()
      : "";
  if (!url) {
    return Object.freeze({
      repository: denyRepository(),
      status: Object.freeze({
        configured: false as const,
        reason: "missing_database_url" as const,
      }),
    });
  }
  // URL present but live adapter still denied until HG-5 and driver wiring.
  return Object.freeze({
    repository: denyRepository(),
    status: Object.freeze({
      configured: false as const,
      reason: "human_gate_pending" as const,
      note: "HG-5 cloud/operations required before live CockroachDB",
    }),
  });
}
