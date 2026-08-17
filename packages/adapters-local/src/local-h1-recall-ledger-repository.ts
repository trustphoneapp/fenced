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

// Local/synthetic H1 adapter. In-memory only; models the CockroachDB shape
// (tenant-scoped memory facts, receipts, ID-only propagation) without any
// network, provider, or real-data behavior.

const denied = Object.freeze({ outcome: "denied" as const });
const conflict = Object.freeze({ outcome: "conflict" as const });

interface ScopeBucket {
  history: Map<string, MemoryFact[]>;
  latest: Map<string, MemoryFact>;
  propagations: MemoryPropagationEntry[];
  receipts: DisclosureReceipt[];
  receiptCounter: bigint;
}

function bucketKey(scope: MemoryScope): string {
  return `${scope.tenantId}|${scope.serverPurpose}`;
}

function factEquals(a: MemoryFact, b: MemoryFact): boolean {
  return (
    a.content === b.content &&
    a.occurredAt === b.occurredAt &&
    a.sensitivity === b.sensitivity &&
    a.sourceRef === b.sourceRef &&
    a.embedding.length === b.embedding.length &&
    a.embedding.every((component: number, index: number) => component === b.embedding[index])
  );
}

export function createLocalH1RecallLedgerRepository(): RecallLedgerRepository {
  const buckets = new Map<string, ScopeBucket>();
  function bucket(scope: MemoryScope): ScopeBucket {
    const key = bucketKey(scope);
    let existing = buckets.get(key);
    if (!existing) {
      existing = {
        history: new Map(),
        latest: new Map(),
        propagations: [],
        receipts: [],
        receiptCounter: 0n,
      };
      buckets.set(key, existing);
    }
    return existing;
  }

  return Object.freeze({
    teach(fact: MemoryFact, scope: MemoryScope, currentScope: () => boolean): MemoryTeachResult {
      if (!currentScope()) return denied;
      if (fact.tenantId !== scope.tenantId || fact.serverPurpose !== scope.serverPurpose)
        return denied;
      const scopeBucket = bucket(scope);
      const existing = scopeBucket.latest.get(fact.factId);
      if (existing) {
        if (existing.revision === "1" && existing.status === "active" && factEquals(existing, fact))
          return Object.freeze({ outcome: "replayed" as const, fact: existing });
        return conflict;
      }
      scopeBucket.latest.set(fact.factId, fact);
      scopeBucket.history.set(fact.factId, [fact]);
      return Object.freeze({ outcome: "recorded" as const, fact });
    },

    recall(
      _embedding: readonly number[],
      _topK: number,
      scope: MemoryScope,
      currentScope: () => boolean,
    ): RecallResult | typeof denied {
      if (!currentScope()) return denied;
      const scopeBucket = bucket(scope);
      // Pre-retrieval policy: standard callers never receive restricted facts
      // (including their embeddings) from the repository boundary.
      const facts = [...scopeBucket.latest.values()];
      const withheld = facts
        .filter((fact) => scope.accessTier !== "privileged" && fact.sensitivity === "restricted")
        .map((fact) =>
          Object.freeze({
            factId: fact.factId,
            reason: "sensitivity_policy" as const,
            revision: fact.revision,
          }),
        );
      return Object.freeze({
        authorized: Object.freeze(
          facts.filter(
            (fact) => scope.accessTier === "privileged" || fact.sensitivity === "public",
          ),
        ),
        withheld: Object.freeze(withheld),
      });
    },

    correct(
      command: MemoryCorrectionCommand,
      scope: MemoryScope,
      currentScope: () => boolean,
    ): MemoryCorrectionResult {
      if (!currentScope()) return denied;
      const scopeBucket = bucket(scope);
      const latest = scopeBucket.latest.get(command.factId);
      if (!latest || latest.status === "retracted" || latest.revision !== command.expectedRevision)
        return conflict;
      const fromRevision = latest.revision;
      const maximumRevision = 18_446_744_073_709_551_615n;
      let toRevision: string;
      if (command.disposition === "supersede") {
        if (!command.replacement) return conflict;
        if (BigInt(fromRevision) >= maximumRevision) return conflict;
        toRevision = (BigInt(fromRevision) + 1n).toString();
        const replacement: MemoryFact = Object.freeze({
          content: command.replacement.content,
          embedding: Object.freeze([...command.replacement.embedding]),
          embeddingSpace: latest.embeddingSpace,
          factId: latest.factId,
          occurredAt: command.occurredAt,
          revision: toRevision,
          sensitivity: command.replacement.sensitivity,
          serverPurpose: latest.serverPurpose,
          sourceRef: command.replacement.sourceRef,
          status: "active" as const,
          tenantId: latest.tenantId,
          recordFamily: "memory_fact" as const,
          recordSchemaVersion: "zc.internal.memory-fact.v1" as const,
        });
        scopeBucket.latest.set(latest.factId, replacement);
        scopeBucket.history.get(latest.factId)?.push(replacement);
      } else {
        // Retraction erases content and embeddings across EVERY revision.
        toRevision = "0";
        const erase = (fact: MemoryFact): MemoryFact =>
          Object.freeze({
            content: "",
            embedding: Object.freeze(fact.embedding.map(() => 0)),
            embeddingSpace: fact.embeddingSpace,
            factId: fact.factId,
            occurredAt: command.occurredAt,
            revision: fact.revision,
            sensitivity: fact.sensitivity,
            serverPurpose: fact.serverPurpose,
            sourceRef: fact.sourceRef,
            status: "retracted" as const,
            tenantId: fact.tenantId,
            recordFamily: "memory_fact" as const,
            recordSchemaVersion: "zc.internal.memory-fact.v1" as const,
          });
        const history = scopeBucket.history.get(latest.factId);
        if (history)
          for (let index = 0; index < history.length; index += 1) {
            const revisionFact = history[index];
            if (revisionFact) history[index] = erase(revisionFact);
          }
        scopeBucket.latest.set(latest.factId, erase(latest));
      }
      const propagation: MemoryPropagationEntry = Object.freeze({
        disposition: command.disposition,
        factId: command.factId,
        fromRevision,
        occurredAt: command.occurredAt,
        serverPurpose: scope.serverPurpose,
        tenantId: scope.tenantId,
        toRevision,
        recordFamily: "memory_propagation" as const,
        recordSchemaVersion: "zc.internal.memory-propagation.v1" as const,
      });
      scopeBucket.propagations.push(propagation);
      return Object.freeze({ outcome: "corrected" as const, propagation });
    },

    storeReceipt(
      receipt: Omit<DisclosureReceipt, "receiptId">,
      scope: MemoryScope,
      currentScope: () => boolean,
    ): DisclosureReceipt | typeof denied {
      if (!currentScope()) return denied;
      if (receipt.tenantId !== scope.tenantId || receipt.serverPurpose !== scope.serverPurpose)
        return denied;
      // Enforce the IDs-only receipt contract at the durability boundary:
      // validate every persisted field and copy only the allowed keys so no
      // content-bearing or malformed audit metadata can persist.
      const factId = (value: string) => /^[0-9a-f]{48}$/u.test(value);
      const revision = (value: string) =>
        /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
      const stamp = (value: string) =>
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
        Number.isFinite(Date.parse(value));
      if (
        receipt.policyVersion !== "zc.recall-policy.v1" ||
        receipt.embeddingSpace !== "zc.local-synthetic-embedding.v1" ||
        (receipt.accessTier !== "standard" && receipt.accessTier !== "privileged") ||
        receipt.recordFamily !== "disclosure_receipt" ||
        receipt.recordSchemaVersion !== "zc.internal.disclosure-receipt.v1" ||
        !stamp(receipt.askedAt)
      )
        return denied;
      const recalled = receipt.recalled.map((entry) =>
        Object.freeze({
          factId: entry.factId,
          revision: entry.revision,
          similarity: entry.similarity,
        }),
      );
      const withheld = receipt.withheld.map((entry) =>
        Object.freeze({ factId: entry.factId, reason: entry.reason, revision: entry.revision }),
      );
      if (
        recalled.some(
          (entry) =>
            !factId(entry.factId) ||
            !revision(entry.revision) ||
            typeof entry.similarity !== "number" ||
            !Number.isFinite(entry.similarity) ||
            entry.similarity < -1 ||
            entry.similarity > 1,
        ) ||
        withheld.some(
          (entry) =>
            !factId(entry.factId) ||
            !revision(entry.revision) ||
            (entry.reason !== "sensitivity_policy" && entry.reason !== "retracted"),
        )
      )
        return denied;
      const scopeBucket = bucket(scope);
      scopeBucket.receiptCounter += 1n;
      const receiptId = scopeBucket.receiptCounter.toString(16).padStart(48, "0");
      const stored: DisclosureReceipt = Object.freeze({
        accessTier: receipt.accessTier,
        askedAt: receipt.askedAt,
        embeddingSpace: receipt.embeddingSpace,
        policyVersion: receipt.policyVersion,
        recalled: Object.freeze(recalled),
        receiptId,
        serverPurpose: receipt.serverPurpose,
        tenantId: receipt.tenantId,
        withheld: Object.freeze(withheld),
        recordFamily: receipt.recordFamily,
        recordSchemaVersion: receipt.recordSchemaVersion,
      });
      scopeBucket.receipts.push(stored);
      return stored;
    },

    receipts(
      scope: MemoryScope,
      currentScope: () => boolean,
    ): readonly DisclosureReceipt[] | typeof denied {
      if (!currentScope()) return denied;
      return Object.freeze([...bucket(scope).receipts]);
    },

    propagations(
      scope: MemoryScope,
      currentScope: () => boolean,
    ): readonly MemoryPropagationEntry[] | typeof denied {
      if (!currentScope()) return denied;
      return Object.freeze([...bucket(scope).propagations]);
    },
  });
}
