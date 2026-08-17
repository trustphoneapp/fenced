import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLocalC07OutboxRepository } from "../../packages/adapters-local/src/index.js";
import {
  createOutboxConsumeService,
  createOutboxDeadLetterService,
  createOutboxPublishService,
} from "../../packages/application/src/index.js";

const tenantA = "a".repeat(48);
const tenantB = "b".repeat(48);
const consumerA = "c".repeat(48);
const purpose = "continuity.outbox";
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../database/migrations/0006_outbox_inbox.sql",
);

function publishContext(tenantId = tenantA) {
  return {
    operation: "outbox.publish",
    purpose,
    tenantId,
    workload: { capability: "continuity.outbox.publish" },
  };
}

function consumeContext(tenantId = tenantA, consumerId = consumerA) {
  return {
    operation: "outbox.consume",
    purpose,
    tenantId,
    workload: { capability: "continuity.outbox.consume", consumerId },
  };
}

function message(overrides = {}) {
  return {
    attemptId: "1".repeat(48),
    messageId: "2".repeat(48),
    messageType: "event.corrected",
    messageVersion: "1",
    occurredAt: "2026-08-07T00:00:00.000Z",
    operationId: "3".repeat(48),
    payloadRef: "4".repeat(48),
    payloadRevision: "1",
    previousMessageVersion: "0",
    ...overrides,
  };
}

describe("c07 outbox inbox local synthetic", () => {
  it("uses a lease, single-successor key, and routine-only delivery transitions", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain(
      "UNIQUE (tenant_id, server_purpose, message_id, previous_message_revision)",
    );
    expect(migration).toContain("lease_expires_at TIMESTAMPTZ NULL");
    expect(migration).toContain("CREATE FUNCTION continuity.claim_outbox_delivery(");
    expect(migration).toContain("CREATE FUNCTION continuity.record_outbox_inbox(");
    expect(migration).toContain("CREATE FUNCTION continuity.acknowledge_outbox_delivery(");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("CREATE ROLE zc_continuity_transition_owner");
    expect(migration).toContain("NOBYPASSRLS");
    expect(migration).toContain("GRANT zc_continuity_transition_owner TO admin;");
    expect(migration).toContain(
      "GRANT CREATE ON SCHEMA continuity TO zc_continuity_transition_owner;",
    );
    expect(migration).toContain(
      "REVOKE CREATE ON SCHEMA continuity FROM zc_continuity_transition_owner;",
    );
    expect(migration).toContain("CREATE POLICY outbox_deliveries_transition_owner_scope");
    expect(migration).toContain("CREATE POLICY inbox_receipts_transition_owner_scope");
    expect(migration).toContain(
      "ALTER FUNCTION continuity.claim_outbox_delivery(INTERVAL) OWNER TO zc_continuity_transition_owner;",
    );
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain(
      "AND (delivery.delivery_status = 'pending' OR (delivery.delivery_status = 'claimed' AND delivery.lease_expires_at <= CURRENT_TIMESTAMP))",
    );
    expect(migration).toContain("claim_attempt_count DECIMAL(20, 0) NOT NULL");
    expect(migration).toContain("claim_fence_token STRING NOT NULL");
    expect(migration).toContain(
      "GRANT SELECT ON TABLE continuity.outbox_deliveries TO zc_continuity_executor;",
    );
    expect(migration).not.toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE continuity.outbox_deliveries TO zc_continuity_executor;",
    );
    expect(migration).not.toContain("CREATE POLICY outbox_deliveries_executor_write_scope");
  });

  it("records an inbox receipt before acknowledging a claimed delivery", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(), outcome: "issued" }) },
      repository,
    );
    const consume = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(), outcome: "issued" }) },
      repository,
    );

    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "appended" });
    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "replayed" });

    const claimed = consume.claim(consumeContext(), 1);
    expect(claimed && "delivery" in claimed).toBe(true);
    if (!claimed || !("delivery" in claimed)) throw new Error("expected claim");

    expect(
      consume.recordInbox(
        consumeContext(),
        {
          attempts: claimed.delivery.attempts,
          fence: claimed.delivery.fence,
          messageId: "2".repeat(48),
          messageVersion: "1",
          receivedAt: "2026-08-07T00:00:01.000Z",
        },
        1,
      ),
    ).toMatchObject({ outcome: "recorded", receipt: { consumerId: consumerA } });

    expect(
      consume.acknowledge(
        consumeContext(),
        {
          attempts: claimed.delivery.attempts,
          disposition: "acknowledged",
          fence: claimed.delivery.fence,
          handle: claimed.delivery.handle,
          id: claimed.delivery.id,
        },
        1,
      ),
    ).toEqual({ status: "acknowledged" });
  });

  it("denies cross-tenant claim", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(tenantA), outcome: "issued" }) },
      repository,
    );
    const consumeB = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(tenantB), outcome: "issued" }) },
      repository,
    );
    expect(publish.append(publishContext(tenantA), message(), 1)).toMatchObject({
      outcome: "appended",
    });
    expect(consumeB.claim(consumeContext(tenantB), 1)).toBeUndefined();
  });

  it("retries then dead-letters after max attempts", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(), outcome: "issued" }) },
      repository,
    );
    const consume = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(), outcome: "issued" }) },
      repository,
    );
    const deadLetters = createOutboxDeadLetterService(
      { validate: () => ({ context: consumeContext(), outcome: "issued" }) },
      repository,
    );

    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "appended" });

    const fences = [];
    for (let round = 1; round <= 3; round += 1) {
      const claimed = consume.claim(consumeContext(), 1);
      expect(claimed && "delivery" in claimed).toBe(true);
      if (!claimed || !("delivery" in claimed)) throw new Error("expected claim");
      expect(claimed.delivery.attempts).toBe(round);
      fences.push(claimed.delivery.fence);
      expect(
        consume.acknowledge(
          consumeContext(),
          {
            attempts: claimed.delivery.attempts,
            disposition: "retry",
            fence: claimed.delivery.fence,
            handle: claimed.delivery.handle,
            id: claimed.delivery.id,
          },
          1,
        ),
      ).toEqual({ status: "acknowledged" });
    }
    expect(new Set(fences).size).toBe(3);

    expect(consume.claim(consumeContext(), 1)).toBeUndefined();
    expect(deadLetters.deadLetters(consumeContext(), 1)).toEqual([
      { id: "2".repeat(48), messageVersion: "1" },
    ]);
  });

  it("requires a receipt before acknowledgement and rejects missing predecessors", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(), outcome: "issued" }) },
      repository,
    );
    const consume = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(), outcome: "issued" }) },
      repository,
    );

    expect(
      publish.append(
        publishContext(),
        message({ messageVersion: "2", previousMessageVersion: "1" }),
        1,
      ),
    ).toEqual({ outcome: "conflict" });

    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "appended" });
    const claimed = consume.claim(consumeContext(), 1);
    expect(claimed && "delivery" in claimed).toBe(true);
    if (!claimed || !("delivery" in claimed)) throw new Error("expected claim");
    expect(
      consume.acknowledge(
        consumeContext(),
        {
          attempts: claimed.delivery.attempts,
          disposition: "acknowledged",
          fence: claimed.delivery.fence,
          handle: claimed.delivery.handle,
          id: claimed.delivery.id,
        },
        1,
      ),
    ).toEqual({ status: "stale" });
    expect(
      consume.recordInbox(
        consumeContext(),
        {
          attempts: claimed.delivery.attempts,
          fence: claimed.delivery.fence,
          messageId: "2".repeat(48),
          messageVersion: "1",
          receivedAt: "2026-08-07T00:00:01.000Z",
        },
        1,
      ),
    ).toMatchObject({ outcome: "recorded" });
  });

  it("reclaims an expired lease and rejects a second successor", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(), outcome: "issued" }) },
      repository,
    );
    const consume = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(), outcome: "issued" }) },
      repository,
    );
    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "appended" });
    const first = consume.claim(consumeContext(), 1);
    expect(first && "delivery" in first).toBe(true);
    const reclaimed = consume.claim(consumeContext(), 30_001);
    expect(reclaimed && "delivery" in reclaimed).toBe(true);
    if (!first || !("delivery" in first) || !reclaimed || !("delivery" in reclaimed))
      throw new Error("expected claims");
    expect(reclaimed.delivery.id).toBe(first.delivery.id);
    expect(reclaimed.delivery.attempts).toBe(2);
    expect(reclaimed.delivery.fence).not.toBe(first.delivery.fence);
    expect(
      consume.recordInbox(
        consumeContext(),
        {
          attempts: first.delivery.attempts,
          fence: first.delivery.fence,
          messageId: first.delivery.id,
          messageVersion: "1",
          receivedAt: "2026-08-07T00:00:01.000Z",
        },
        30_001,
      ),
    ).toEqual({ outcome: "conflict" });
    expect(
      consume.acknowledge(
        consumeContext(),
        {
          attempts: reclaimed.delivery.attempts,
          disposition: "acknowledged",
          fence: reclaimed.delivery.fence,
          handle: reclaimed.delivery.handle,
          id: reclaimed.delivery.id,
        },
        30_001,
      ),
    ).toEqual({ status: "stale" });
    expect(
      publish.append(
        publishContext(),
        message({
          messageVersion: "2",
          previousMessageVersion: "1",
          operationId: "5".repeat(48),
          attemptId: "6".repeat(48),
        }),
        1,
      ),
    ).toMatchObject({ outcome: "appended" });
    expect(
      publish.append(
        publishContext(),
        message({
          messageVersion: "3",
          previousMessageVersion: "1",
          operationId: "7".repeat(48),
          attemptId: "8".repeat(48),
        }),
        1,
      ),
    ).toEqual({ outcome: "conflict" });
  });

  it("denies consume without server consumerId", () => {
    const repository = createLocalC07OutboxRepository();
    const consume = createOutboxConsumeService(
      {
        validate: () => ({
          context: {
            operation: "outbox.consume",
            purpose,
            tenantId: tenantA,
            workload: { capability: "continuity.outbox.consume" },
          },
          outcome: "issued",
        }),
      },
      repository,
    );
    expect(consume.claim(consumeContext(), 1)).toEqual({ outcome: "denied" });
  });

  it("denies cross-consumer acknowledgement", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(), outcome: "issued" }) },
      repository,
    );
    const consumeA = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(tenantA, consumerA), outcome: "issued" }) },
      repository,
    );
    const otherConsumer = "d".repeat(48);
    const consumeB = createOutboxConsumeService(
      {
        validate: () => ({
          context: consumeContext(tenantA, otherConsumer),
          outcome: "issued",
        }),
      },
      repository,
    );
    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "appended" });
    const claimed = consumeA.claim(consumeContext(tenantA, consumerA), 1);
    expect(claimed && "delivery" in claimed).toBe(true);
    if (!claimed || !("delivery" in claimed)) throw new Error("expected claim");
    expect(
      consumeB.acknowledge(
        consumeContext(tenantA, otherConsumer),
        {
          attempts: claimed.delivery.attempts,
          disposition: "acknowledged",
          fence: claimed.delivery.fence,
          handle: claimed.delivery.handle,
          id: claimed.delivery.id,
        },
        1,
      ),
    ).toEqual({ status: "stale" });
  });

  it("denies cross-consumer inbox receipt on another consumer ack", () => {
    const repository = createLocalC07OutboxRepository();
    const publish = createOutboxPublishService(
      { validate: () => ({ context: publishContext(), outcome: "issued" }) },
      repository,
    );
    const consumeA = createOutboxConsumeService(
      { validate: () => ({ context: consumeContext(tenantA, consumerA), outcome: "issued" }) },
      repository,
    );
    const otherConsumer = "e".repeat(48);
    const consumeB = createOutboxConsumeService(
      {
        validate: () => ({
          context: consumeContext(tenantA, otherConsumer),
          outcome: "issued",
        }),
      },
      repository,
    );
    expect(publish.append(publishContext(), message(), 1)).toMatchObject({ outcome: "appended" });
    const claimed = consumeA.claim(consumeContext(tenantA, consumerA), 1);
    expect(claimed && "delivery" in claimed).toBe(true);
    if (!claimed || !("delivery" in claimed)) throw new Error("expected claim");
    expect(
      consumeA.recordInbox(
        consumeContext(tenantA, consumerA),
        {
          attempts: claimed.delivery.attempts,
          fence: claimed.delivery.fence,
          messageId: "2".repeat(48),
          messageVersion: "1",
          receivedAt: "2026-08-07T00:00:01.000Z",
        },
        1,
      ),
    ).toMatchObject({ outcome: "recorded" });
    expect(
      consumeB.recordInbox(
        consumeContext(tenantA, otherConsumer),
        {
          attempts: claimed.delivery.attempts,
          fence: claimed.delivery.fence,
          messageId: "2".repeat(48),
          messageVersion: "1",
          receivedAt: "2026-08-07T00:00:01.000Z",
        },
        1,
      ),
    ).toEqual({ outcome: "conflict" });
  });
});
