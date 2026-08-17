import { describe, expect, it } from "vitest";
import * as adapter from "../../packages/adapters-local/src/index.ts";
import { ownDataKeys } from "../../scripts/safe-own-data.mjs";
import {
  defineSyntheticProperty,
  forwardSyntheticDescriptor,
  forwardSyntheticGet,
  forwardSyntheticOwnKeys,
  mergeSyntheticRecords,
} from "../../scripts/synthetic-test-data.mjs";

// This binds the authored adapters-local source seam; it never imports application dist.

const definition = (overrides = {}) =>
  mergeSyntheticRecords(
    {
      faultSchedule: undefined,
      identities: [
        {
          credentialRef: "credential-a",
          purposes: ["continuity.respond"],
          subjectId: "user-a",
          tenantId: "tenant-a",
        },
        {
          credentialRef: "credential-b",
          purposes: ["continuity.respond"],
          subjectId: "user-b",
          tenantId: "tenant-b",
        },
      ],
      initialTime: undefined,
      providerFixtures: [
        {
          attemptId: "attempt-1",
          contextCompilerVersion: "compiler-1",
          model: "model-1",
          operation: "generation",
          outputRef: "output-a",
          policyVersion: "policy-1",
          provider: "primary-1",
          purpose: "continuity.respond",
          requestId: "request-1",
          tenantId: "tenant-a",
        },
      ],
      queueLeaseMilliseconds: undefined,
      queueMaxAttempts: undefined,
      vectorDimension: undefined,
    },
    overrides,
  );
const setup = (overrides) => {
  const fixture = adapter.createLocalSyntheticFixture(definition(overrides));
  const identity = fixture.runtime.identity.resolve("credential-a");
  return { fixture, scope: fixture.runtime.identity.authorize(identity, "continuity.respond") };
};
const denied = (run) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(adapter.LocalHarnessError);
    return error.code;
  }
  throw new Error("expected content-free failure");
};
const message = (id, commitment = id) => ({ commitment, id });

describe("B04 R2 local fixture", () => {
  it("accepts an identities-only descriptor and applies deterministic optional defaults", () => {
    const identities = [
      {
        credentialRef: "credential-a",
        purposes: ["continuity.respond"],
        subjectId: "user-a",
        tenantId: "tenant-a",
      },
    ];
    const omitted = adapter.createLocalSyntheticFixture({ identities });
    const explicitUndefined = adapter.createLocalSyntheticFixture({
      faultSchedule: undefined,
      identities,
      initialTime: undefined,
      providerFixtures: undefined,
      queueLeaseMilliseconds: undefined,
      queueMaxAttempts: undefined,
      vectorDimension: undefined,
    });
    const scopeFor = (fixture) =>
      fixture.runtime.identity.authorize(
        fixture.runtime.identity.resolve("credential-a"),
        "continuity.respond",
      );
    const omittedScope = scopeFor(omitted);
    const explicitScope = scopeFor(explicitUndefined);
    expect([omitted.runtime.clock.now(), explicitUndefined.runtime.clock.now()]).toEqual([0, 0]);
    omitted.runtime.vectors.upsert(omittedScope, "vector", [1, 0, 0]);
    explicitUndefined.runtime.vectors.upsert(explicitScope, "vector", [1, 0, 0]);
    expect(omitted.runtime.vectors.search(omittedScope, [1, 0, 0], 1)).toEqual(
      explicitUndefined.runtime.vectors.search(explicitScope, [1, 0, 0], 1),
    );
    for (const fixture of [omitted, explicitUndefined]) {
      const scope = scopeFor(fixture);
      fixture.runtime.queue.enqueue(scope, message("message"));
      expect(fixture.runtime.queue.claim(scope)?.attempts).toBe(1);
      fixture.runtime.clock.advance(10);
      expect(fixture.runtime.queue.claim(scope)?.attempts).toBe(2);
      fixture.runtime.clock.advance(10);
      expect(fixture.runtime.queue.claim(scope)?.attempts).toBe(3);
      fixture.runtime.clock.advance(10);
      expect(fixture.runtime.queue.claim(scope)).toBeUndefined();
      expect(fixture.runtime.queue.deadLetters(scope)).toEqual([{ id: "message" }]);
    }
    let getterCalls = 0;
    const hostileOptional = {
      identities,
      get initialTime() {
        getterCalls += 1;
        return 1;
      },
    };
    expect(denied(() => adapter.createLocalSyntheticFixture(hostileOptional))).toBe(
      "INVALID_INPUT",
    );
    expect(getterCalls).toBe(0);
  });

  it("binds the adapters-local source seam and exposes no runtime registration or reset", () => {
    expect(typeof adapter.createLocalSyntheticFixture).toBe("function");
    const { fixture } = setup();
    expect("register" in fixture.runtime.identity).toBe(false);
    expect("reset" in fixture.runtime).toBe(false);
    expect(adapter.compareUtf8("z", "é")).toBeLessThan(0);
  });

  it("rejects every external proxy before it can execute a trap or mutate the fixture", () => {
    const { fixture, scope } = setup();
    const calls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
    const proxy = (value) =>
      new Proxy(value, {
        get(target, key, receiver) {
          calls.get += 1;
          return forwardSyntheticGet(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          calls.getOwnPropertyDescriptor += 1;
          return forwardSyntheticDescriptor(target, key);
        },
        getPrototypeOf(target) {
          calls.getPrototypeOf += 1;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          calls.ownKeys += 1;
          return forwardSyntheticOwnKeys(target);
        },
      });
    expect(denied(() => adapter.createLocalSyntheticFixture(proxy(definition())))).toBe(
      "INVALID_INPUT",
    );
    expect(
      denied(() =>
        fixture.runtime.state.write(
          scope,
          proxy({ idempotencyKey: "proxy", key: "proxy", value: null }),
        ),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      denied(() =>
        fixture.runtime.provider.invoke(
          scope,
          proxy({
            attemptId: "attempt-1",
            contextCompilerVersion: "compiler-1",
            model: "model-1",
            operation: "generation",
            policyVersion: "policy-1",
            provider: "primary-1",
            requestId: "request-1",
          }),
        ),
      ),
    ).toBe("INVALID_INPUT");
    expect(denied(() => fixture.runtime.queue.enqueue(scope, proxy(message("proxy"))))).toBe(
      "INVALID_INPUT",
    );
    expect(denied(() => fixture.runtime.vectors.upsert(scope, "proxy", proxy([1, 0, 0])))).toBe(
      "INVALID_INPUT",
    );
    let reentrantAttempts = 0;
    const reentrant = new Proxy(message("reentrant"), {
      ownKeys(target) {
        reentrantAttempts += 1;
        fixture.runtime.queue.enqueue(scope, message("nested"));
        return forwardSyntheticOwnKeys(target);
      },
    });
    expect(denied(() => fixture.runtime.queue.enqueue(scope, reentrant))).toBe("INVALID_INPUT");
    expect(calls).toEqual({ get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });
    expect(reentrantAttempts).toBe(0);
    expect(fixture.runtime.state.read(scope, "proxy")).toBeUndefined();
    expect(fixture.runtime.queue.claim(scope)).toBeUndefined();
  });

  it("uses fixed server-owned credentials and generation-fences identities, scopes, and deliveries", () => {
    const { fixture, scope } = setup({ initialTime: 5, queueLeaseMilliseconds: 2 });
    const identity = fixture.runtime.identity.resolve("credential-a");
    expect(fixture.runtime.identity.resolve("unknown")).toBeUndefined();
    expect(
      denied(() =>
        fixture.runtime.identity.authorize(
          { fixture: adapter.localSyntheticFixture },
          "continuity.respond",
        ),
      ),
    ).toBe("INVALID_SCOPE");
    fixture.runtime.queue.enqueue(scope, message("item"));
    fixture.runtime.queue.claim(scope);
    expect(denied(() => fixture.controller.reset())).toBe("BUSY");
    fixture.runtime.clock.advance(2);
    fixture.controller.reset();
    expect(fixture.runtime.clock.now()).toBe(5);
    expect(denied(() => fixture.runtime.identity.authorize(identity, "continuity.respond"))).toBe(
      "STALE_HANDLE",
    );
    expect(denied(() => fixture.runtime.state.read(scope, "item"))).toBe("STALE_HANDLE");
    const second = setup();
    expect(second.fixture.runtime.clock.now()).toBe(0);
  });

  it("keeps all state/provider/vector paths tenant-and-purpose exact and deterministic", () => {
    const { fixture, scope } = setup();
    const identityB = fixture.runtime.identity.resolve("credential-b");
    const scopeB = fixture.runtime.identity.authorize(identityB, "continuity.respond");
    fixture.runtime.state.write(scope, {
      idempotencyKey: "one",
      key: "state",
      value: { safe: true },
    });
    expect(
      fixture.runtime.state.write(scope, {
        idempotencyKey: "one",
        key: "state",
        value: { safe: true },
      }),
    ).toEqual({ revision: 1, status: "replayed" });
    expect(fixture.runtime.state.read(scopeB, "state")).toBeUndefined();
    expect(
      fixture.runtime.provider.invoke(scopeB, {
        attemptId: "attempt-1",
        contextCompilerVersion: "compiler-1",
        model: "model-1",
        operation: "generation",
        policyVersion: "policy-1",
        provider: "primary-1",
        requestId: "request-1",
      }),
    ).toEqual({ code: "NOT_PERMITTED", outcome: "denied" });
    expect(
      fixture.runtime.provider.invoke(scope, {
        attemptId: "attempt-1",
        contextCompilerVersion: "compiler-1",
        model: "model-1",
        operation: "generation",
        policyVersion: "policy-1",
        provider: "primary-1",
        requestId: "request-1",
      }),
    ).toEqual({ outcome: "provided", outputRef: "output-a", trust: "untrusted_data" });
    fixture.runtime.vectors.upsert(scope, "zeta", [1, 0, 0]);
    fixture.runtime.vectors.upsert(scope, "alpha", [1, 0, 0]);
    fixture.runtime.vectors.upsert(scopeB, "private", [9, 0, 0]);
    expect(fixture.runtime.vectors.search(scope, [1, 0, 0], 2)).toEqual([
      { id: "alpha", score: 1 },
      { id: "zeta", score: 1 },
    ]);
    expect(denied(() => fixture.runtime.vectors.upsert(scope, "overflow", [1_000_001, 0, 0]))).toBe(
      "DIMENSION_MISMATCH",
    );
  });

  it("partitions queue sequence, faults, acknowledgements, and journals by tenant-purpose scope", () => {
    const fixture = adapter.createLocalSyntheticFixture(
      definition({
        faultSchedule: [
          {
            action: "lost_ack",
            operation: "queue.ack",
            ordinal: 1,
            purpose: "continuity.respond",
            tenantId: "tenant-a",
          },
        ],
      }),
    );
    const scopeA = fixture.runtime.identity.authorize(
      fixture.runtime.identity.resolve("credential-a"),
      "continuity.respond",
    );
    const scopeB = fixture.runtime.identity.authorize(
      fixture.runtime.identity.resolve("credential-b"),
      "continuity.respond",
    );
    fixture.runtime.queue.enqueue(scopeA, message("target"));
    fixture.runtime.queue.enqueue(scopeB, message("foreign"));
    const foreign = fixture.runtime.queue.claim(scopeB);
    expect(fixture.runtime.queue.acknowledge(scopeB, foreign)).toEqual({ status: "acknowledged" });
    const target = fixture.runtime.queue.claim(scopeA);
    expect(ownDataKeys(target.handle)).toEqual([]);
    expect(Object.isFrozen(target.handle)).toBe(true);
    expect(fixture.runtime.queue.acknowledge(scopeA, target)).toEqual({ status: "lost" });
    expect(fixture.runtime.faults.journal(scopeA)).toEqual([
      { action: "lost_ack", operation: "queue.ack", ordinal: 1 },
    ]);
    expect(fixture.runtime.faults.journal(scopeB)).toEqual([]);
    expect(
      denied(() => fixture.runtime.faults.journal({ fixture: adapter.localSyntheticFixture })),
    ).toBe("INVALID_SCOPE");
  });

  it("is metamorphically unchanged by foreign-scope queue activity", () => {
    const transcript = (includeForeign) => {
      const fixture = adapter.createLocalSyntheticFixture(
        definition({
          faultSchedule: [
            {
              action: "lost_ack",
              operation: "queue.ack",
              ordinal: 1,
              purpose: "continuity.respond",
              tenantId: "tenant-a",
            },
          ],
        }),
      );
      const scopeA = fixture.runtime.identity.authorize(
        fixture.runtime.identity.resolve("credential-a"),
        "continuity.respond",
      );
      const scopeB = fixture.runtime.identity.authorize(
        fixture.runtime.identity.resolve("credential-b"),
        "continuity.respond",
      );
      if (includeForeign) {
        fixture.runtime.queue.enqueue(scopeB, message("foreign"));
        fixture.runtime.queue.acknowledge(scopeB, fixture.runtime.queue.claim(scopeB));
      }
      fixture.runtime.queue.enqueue(scopeA, message("target"));
      return {
        acknowledgement: fixture.runtime.queue.acknowledge(
          scopeA,
          fixture.runtime.queue.claim(scopeA),
        ),
        journal: fixture.runtime.faults.journal(scopeA),
      };
    };
    expect(transcript(true)).toEqual(transcript(false));
  });

  it("keeps message commitments terminal through acknowledgement, lost-ack, and DLQ", () => {
    const { fixture, scope } = setup();
    expect(fixture.runtime.queue.enqueue(scope, message("acknowledged", "c1"))).toEqual({
      status: "enqueued",
    });
    const acknowledged = fixture.runtime.queue.claim(scope);
    expect(fixture.runtime.queue.acknowledge(scope, acknowledged)).toEqual({
      status: "acknowledged",
    });
    expect(fixture.runtime.queue.enqueue(scope, message("acknowledged", "c1"))).toEqual({
      status: "replayed",
    });
    expect(denied(() => fixture.runtime.queue.enqueue(scope, message("acknowledged", "c2")))).toBe(
      "CONFLICT",
    );

    const lostFixture = adapter.createLocalSyntheticFixture(
      definition({
        faultSchedule: [
          {
            action: "lost_ack",
            operation: "queue.ack",
            ordinal: 1,
            purpose: "continuity.respond",
            tenantId: "tenant-a",
          },
        ],
      }),
    );
    const lostScope = lostFixture.runtime.identity.authorize(
      lostFixture.runtime.identity.resolve("credential-a"),
      "continuity.respond",
    );
    lostFixture.runtime.queue.enqueue(lostScope, message("lost", "c1"));
    expect(
      lostFixture.runtime.queue.acknowledge(lostScope, lostFixture.runtime.queue.claim(lostScope)),
    ).toEqual({ status: "lost" });
    expect(lostFixture.runtime.queue.enqueue(lostScope, message("lost", "c1"))).toEqual({
      status: "replayed",
    });
    expect(denied(() => lostFixture.runtime.queue.enqueue(lostScope, message("lost", "c2")))).toBe(
      "CONFLICT",
    );

    fixture.runtime.queue.enqueue(scope, message("dead", "c1"));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(fixture.runtime.queue.claim(scope)?.id).toBe("dead");
      fixture.runtime.clock.advance(10);
    }
    expect(fixture.runtime.queue.claim(scope)).toBeUndefined();
    expect(fixture.runtime.queue.deadLetters(scope)).toEqual([{ id: "dead" }]);
    expect(fixture.runtime.queue.enqueue(scope, message("dead", "c1"))).toEqual({
      status: "replayed",
    });
    expect(denied(() => fixture.runtime.queue.enqueue(scope, message("dead", "c2")))).toBe(
      "CONFLICT",
    );
  });

  it("bounds terminal commitments per scope before queue capacity and clears them only on reset", () => {
    const fixture = adapter.createLocalSyntheticFixture(definition());
    const scopeA = fixture.runtime.identity.authorize(
      fixture.runtime.identity.resolve("credential-a"),
      "continuity.respond",
    );
    const scopeB = fixture.runtime.identity.authorize(
      fixture.runtime.identity.resolve("credential-b"),
      "continuity.respond",
    );
    for (let index = 0; index < 64; index += 1) {
      fixture.runtime.queue.enqueue(scopeA, message(`terminal-${index}`, `commitment-${index}`));
      expect(
        fixture.runtime.queue.acknowledge(scopeA, fixture.runtime.queue.claim(scopeA)),
      ).toEqual({
        status: "acknowledged",
      });
    }
    expect(fixture.runtime.queue.enqueue(scopeA, message("terminal-0", "commitment-0"))).toEqual({
      status: "replayed",
    });
    expect(
      denied(() => fixture.runtime.queue.enqueue(scopeA, message("terminal-0", "mismatch"))),
    ).toBe("CONFLICT");
    expect(denied(() => fixture.runtime.queue.enqueue(scopeA, message("terminal-64")))).toBe(
      "INVALID_INPUT",
    );
    expect(fixture.runtime.queue.enqueue(scopeB, message("terminal-0", "scope-b"))).toEqual({
      status: "enqueued",
    });
    expect(fixture.runtime.queue.acknowledge(scopeB, fixture.runtime.queue.claim(scopeB))).toEqual({
      status: "acknowledged",
    });
    fixture.controller.reset();
    const resetScope = fixture.runtime.identity.authorize(
      fixture.runtime.identity.resolve("credential-a"),
      "continuity.respond",
    );
    expect(fixture.runtime.queue.enqueue(resetScope, message("terminal-64"))).toEqual({
      status: "enqueued",
    });
  });

  it("rejects hostile descriptors, arithmetic edges, and every bounded capacity before mutation", () => {
    const { fixture, scope } = setup();
    let calls = 0;
    const hostile = {
      map: () => {
        calls += 1;
        return [];
      },
    };
    expect(
      denied(() =>
        fixture.runtime.state.write(scope, {
          idempotencyKey: "hostile",
          key: "value",
          value: hostile,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(calls).toBe(0);
    const array = ["safe"];
    defineSyntheticProperty(array, "map", {
      enumerable: true,
      value: () => {
        calls += 1;
      },
    });
    expect(
      denied(() =>
        fixture.runtime.state.write(scope, { idempotencyKey: "array", key: "value", value: array }),
      ),
    ).toBe("INVALID_INPUT");
    expect(calls).toBe(0);
    expect(denied(() => fixture.runtime.vectors.search(scope, [-0, 0, 0], 1))).toBe(
      "DIMENSION_MISMATCH",
    );
    for (let index = 0; index < 64; index += 1)
      fixture.runtime.state.write(scope, {
        idempotencyKey: `id-${index}`,
        key: `key-${index}`,
        value: null,
      });
    expect(
      denied(() =>
        fixture.runtime.state.write(scope, {
          idempotencyKey: "id-extra",
          key: "key-extra",
          value: null,
        }),
      ),
    ).toBe("INVALID_INPUT");
    for (let index = 0; index < 64; index += 1)
      fixture.runtime.queue.enqueue(scope, message(`q-${index}`));
    expect(denied(() => fixture.runtime.queue.enqueue(scope, message("q-extra")))).toBe(
      "INVALID_INPUT",
    );
    for (let index = 0; index < 64; index += 1)
      fixture.runtime.vectors.upsert(scope, `v-${index}`, [1, 0, 0]);
    expect(denied(() => fixture.runtime.vectors.upsert(scope, "v-extra", [1, 0, 0]))).toBe(
      "INVALID_INPUT",
    );
    expect(denied(() => fixture.runtime.vectors.search(scope, [1, 0, 0], 17))).toBe(
      "INVALID_INPUT",
    );
    expect(denied(() => fixture.runtime.clock.advance(Number.MAX_SAFE_INTEGER))).toBe(
      "INVALID_INPUT",
    );
  });
});
