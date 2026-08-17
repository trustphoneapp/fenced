import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLocalC06EventRepository } from "../../packages/adapters-local/src/index.js";
import { createEventRevisionRequestService } from "../../packages/application/src/index.js";
import {
  validateC06EventLedgerBytesForTest,
  verifyC06EventLedger,
} from "../../scripts/verify-c06-event-ledger.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(root, "database/migrations/0005_immutable_event_links.sql");
const repositoryPath = path.join(root, "packages/adapters-local/src/local-c06-event-repository.ts");
const repositorySha256 = "9e78dafa53510dd2251ee1a87bc5fae827aa9fa864411a70c165a53e86ad49ff";
const tenantA = "a".repeat(48);
const purpose = "continuity.events";
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;

function command(overrides = {}) {
  return {
    attemptId: "1".repeat(48),
    occurredAt: "2026-08-02T00:00:00.000Z",
    operationId: "2".repeat(48),
    payload: { payloadRef: "3".repeat(48), revision: "1" },
    requestId: "4".repeat(48),
    requestRevision: "1",
    requestType: "correction.requested",
    targetEventId: "5".repeat(48),
    targetEventRevision: "1",
    ...overrides,
  };
}

function rawRequest(overrides = {}) {
  const input = command(overrides);
  return {
    attemptId: input.attemptId,
    occurredAt: input.occurredAt,
    operationId: input.operationId,
    ...(input.payload
      ? {
          payload: {
            payloadRef: input.payload.payloadRef,
            payloadRequestedPurpose: purpose,
            payloadRevision: input.payload.revision,
            payloadServerPurpose: purpose,
            payloadTenantId: tenantA,
          },
        }
      : {}),
    recordFamily: "event_revision_request",
    recordSchemaVersion: "zc.internal.event-revision-request.v1",
    requestId: input.requestId,
    requestRevision: input.requestRevision,
    requestType: input.requestType,
    requestedPurpose: purpose,
    serverPurpose: purpose,
    targetEventId: input.targetEventId,
    targetEventRevision: input.targetEventRevision,
    tenantId: tenantA,
  };
}

function service(repository, linear = () => true) {
  let calls = 0;
  return {
    calls: () => calls,
    ledger: createEventRevisionRequestService(
      {
        validate: () => {
          calls += 1;
          return calls === 1 || linear()
            ? {
                context: {
                  operation: "event.revision.request",
                  purpose,
                  tenantId: tenantA,
                  workload: { capability: "continuity.event.revision.request" },
                },
                outcome: "issued",
              }
            : { outcome: "denied" };
        },
      },
      repository,
    ),
  };
}

function appendWithTamperedIntrinsics(repository, request, callbackOutcome) {
  const originalMap = globalThis.Map;
  const originalObject = globalThis.Object;
  const originalReflect = globalThis.Reflect;
  const mapPrototype = originalMap.prototype;
  const iteratorPrototype = getPrototypeOf(mapPrototype.entries.call(new originalMap()));
  const descriptors = {
    entries: getOwnPropertyDescriptor(mapPrototype, "entries"),
    freeze: getOwnPropertyDescriptor(originalObject, "freeze"),
    get: getOwnPropertyDescriptor(mapPrototype, "get"),
    globalMap: getOwnPropertyDescriptor(globalThis, "Map"),
    globalObject: getOwnPropertyDescriptor(globalThis, "Object"),
    globalReflect: getOwnPropertyDescriptor(globalThis, "Reflect"),
    globalSymbol: getOwnPropertyDescriptor(globalThis, "Symbol"),
    has: getOwnPropertyDescriptor(mapPrototype, "has"),
    next: getOwnPropertyDescriptor(iteratorPrototype, "next"),
    reflectApply: getOwnPropertyDescriptor(originalReflect, "apply"),
    set: getOwnPropertyDescriptor(mapPrototype, "set"),
    size: getOwnPropertyDescriptor(mapPrototype, "size"),
  };
  const poison = () => {
    throw new Error("poisoned intrinsic");
  };
  const poisonedObject = function PoisonedObject() {};
  poisonedObject.freeze = () => ({ corrupted: true });

  try {
    return repository.append(request, () => {
      defineProperty(mapPrototype, "get", { ...descriptors.get, value: poison });
      defineProperty(mapPrototype, "set", { ...descriptors.set, value: poison });
      defineProperty(mapPrototype, "has", { ...descriptors.has, value: poison });
      defineProperty(mapPrototype, "entries", { ...descriptors.entries, value: poison });
      defineProperty(mapPrototype, "size", { ...descriptors.size, get: poison });
      defineProperty(iteratorPrototype, "next", { ...descriptors.next, value: poison });
      defineProperty(originalObject, "freeze", { ...descriptors.freeze, value: poison });
      defineProperty(originalReflect, "apply", {
        ...descriptors.reflectApply,
        value: poison,
      });
      defineProperty(globalThis, "Map", {
        ...descriptors.globalMap,
        value: poison,
      });
      defineProperty(globalThis, "Object", {
        ...descriptors.globalObject,
        value: poisonedObject,
      });
      defineProperty(globalThis, "Reflect", {
        ...descriptors.globalReflect,
        value: { apply: poison },
      });
      defineProperty(globalThis, "Symbol", {
        ...descriptors.globalSymbol,
        value: poison,
      });
      if (callbackOutcome === "throw") throw new Error("denied");
      return callbackOutcome;
    });
  } finally {
    defineProperty(globalThis, "Map", descriptors.globalMap);
    defineProperty(globalThis, "Object", descriptors.globalObject);
    defineProperty(globalThis, "Reflect", descriptors.globalReflect);
    defineProperty(globalThis, "Symbol", descriptors.globalSymbol);
    defineProperty(originalObject, "freeze", descriptors.freeze);
    defineProperty(originalReflect, "apply", descriptors.reflectApply);
    defineProperty(mapPrototype, "get", descriptors.get);
    defineProperty(mapPrototype, "set", descriptors.set);
    defineProperty(mapPrototype, "has", descriptors.has);
    defineProperty(mapPrototype, "entries", descriptors.entries);
    defineProperty(mapPrototype, "size", descriptors.size);
    defineProperty(iteratorPrototype, "next", descriptors.next);
  }
}

describe("C06 immutable event revision requests", () => {
  it("pins the scope-first repository source boundary", async () => {
    const bytes = await readFile(repositoryPath);
    expect(bytes).toHaveLength(10_134);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(repositorySha256);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(source.startsWith("\uFEFF")).toBe(false);
    expect(source.includes("\r")).toBe(false);
    expect(source.endsWith("\n")).toBe(true);
    expect(source.endsWith("\n\n")).toBe(false);

    const helperMarker = "function appendAuthorized(";
    const stateHelpersMarker = "function defineArrayElement<";
    const appendMarker =
      "    append(value: unknown, currentScope: () => boolean): EventRevisionRequestResult {";
    const appendEndMarker = "\n    },\n  });";
    const callbackMarker = "current = currentScope();";
    const deniedMarker = "if (!current) return denied;";
    const authorizedMarker = "return appendAuthorized(scopes, candidate);";
    const selfTargetMarker =
      "source.requestId === source.targetEventId &&\n    source.requestRevision === source.targetEventRevision";
    for (const marker of [
      helperMarker,
      stateHelpersMarker,
      appendMarker,
      callbackMarker,
      deniedMarker,
      authorizedMarker,
      selfTargetMarker,
    ])
      expect(source.split(marker), marker).toHaveLength(2);
    for (const marker of [
      "const objectCreate = Object.create;",
      "const objectDefineProperty = Object.defineProperty;",
      "const objectGetPrototypeOf = Object.getPrototypeOf;",
      "const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;",
      "const objectFreeze = Object.freeze;",
      "const objectPrototype = objectGetPrototypeOf({});",
      "return objectFreeze(value);",
    ])
      expect(source, marker).toContain(marker);
    expect(source).not.toMatch(/\bMap\b|Reflect\.apply|\breflectApply\b/u);
    expect(source.match(/Object\.freeze/gu)).toHaveLength(1);
    expect(source.indexOf(selfTargetMarker)).toBeLessThan(
      source.indexOf("JSON.stringify(request)"),
    );
    const appendStart = source.indexOf(appendMarker);
    const appendEnd = source.indexOf(appendEndMarker, appendStart);
    const appendBody = source.slice(appendStart, appendEnd);
    const callbackIndex = appendBody.indexOf(callbackMarker);
    const deniedIndex = appendBody.indexOf(deniedMarker);
    const authorizedIndex = appendBody.indexOf(authorizedMarker);
    expect(callbackIndex).toBeGreaterThanOrEqual(0);
    expect(deniedIndex).toBeGreaterThan(callbackIndex);
    expect(authorizedIndex).toBeGreaterThan(deniedIndex);
    const preAuthorized = appendBody.slice(0, authorizedIndex);
    for (const forbidden of [
      "scopes",
      "ScopeStore",
      "byRequest",
      "byOperation",
      ".size",
      ".get(",
      ".has(",
      ".values(",
      ".entries(",
    ])
      expect(preAuthorized, forbidden).not.toContain(forbidden);
    expect(appendBody.slice(authorizedIndex).indexOf("scopes")).toBe(
      authorizedMarker.indexOf("scopes"),
    );

    const stateHelpersStart = source.indexOf(stateHelpersMarker);
    const helperStart = source.indexOf(helperMarker);
    const helperEnd = source.indexOf(
      "\nexport function createLocalC06EventRepository",
      helperStart,
    );
    const helperBody = source.slice(helperStart, helperEnd);
    const stateBody = source.slice(stateHelpersStart, helperEnd);
    for (const ownedMarker of [
      "findScopeIndex(scopes, key)",
      "getIndexedValue(existingScope.byRequest, requestIdentity)",
      "getIndexedValue(existingScope.byOperation, operationIdentity)",
      "scopes.length >= 64",
      "appendIndexedValue(existingScope?.byRequest ?? [], requestIdentity, owned)",
      "existingScope?.byOperation ?? []",
    ])
      expect(helperBody).toContain(ownedMarker);
    for (const stateMarker of [
      "defineArrayElement(next, index, entries[index] as IndexedRequest);",
      "defineArrayElement(next, entries.length, freeze({ key, stored }));",
    ])
      expect(stateBody).toContain(stateMarker);
    for (const forbidden of [
      "Object.freeze",
      "Reflect.apply",
      "new Map",
      ".apply(",
      ".at(",
      ".bind(",
      ".call(",
      ".concat(",
      ".every(",
      ".filter(",
      ".find(",
      ".forEach(",
      ".get(",
      ".set(",
      ".has(",
      ".entries(",
      ".map(",
      ".push(",
      ".reduce(",
      ".slice(",
      ".some(",
      ".sort(",
      ".splice(",
      ".size",
      "Symbol.iterator",
      "...existingScope",
    ])
      expect(stateBody, forbidden).not.toContain(forbidden);
    expect(stateBody).not.toMatch(/for\s*\([^)]*\sof\s/gu);
    expect(stateBody).not.toMatch(/\[[^\]\r\n]+\]\s*=(?!>)/u);
    for (const descriptorMarker of [
      "const descriptor: PropertyDescriptor = objectCreate(null);",
      "descriptor.configurable = true;",
      "descriptor.enumerable = true;",
      "descriptor.value = value;",
      "descriptor.writable = true;",
      "objectDefineProperty(values, index, descriptor);",
    ])
      expect(stateBody).toContain(descriptorMarker);
    expect(stateBody).toContain("return freeze(next);");
    expect(helperBody).toContain(
      "defineArrayElement(scopes, scopeIndex === -1 ? scopes.length : scopeIndex, newScopeStore);\n  return result;",
    );
  });

  it("accepts exactly the frozen migration bytes", async () => {
    await expect(verifyC06EventLedger()).resolves.toEqual({
      migration: "0005_immutable_event_links.sql",
      table: "event_revision_requests",
    });
    const bytes = await readFile(migrationPath);
    for (const mutation of [
      Buffer.concat([
        bytes,
        Buffer.from(
          "GRANT UPDATE ON TABLE continuity.event_revision_requests TO zc_continuity_executor;\n",
        ),
      ]),
      Buffer.from(
        bytes.toString("utf8").replace("FORCE ROW LEVEL SECURITY", "NO FORCE ROW LEVEL SECURITY"),
      ),
      Buffer.from(
        bytes
          .toString("utf8")
          .replace("FOR SELECT\n  TO zc_continuity_reader", "FOR ALL\n  TO zc_continuity_reader"),
      ),
    ])
      expect(() => validateC06EventLedgerBytesForTest(mutation)).toThrow();
  });

  it("owns descriptors and rejects traps, symbols, accessors, and aliases", () => {
    const state = service(createLocalC06EventRepository());
    const payload = { payloadRef: "3".repeat(48), revision: "1" };
    const input = command({ payload });
    const appended = state.ledger.append({}, input, 1);
    expect(appended.outcome).toBe("appended");
    payload.revision = "2";
    input.requestRevision = "2";
    expect(appended.request?.payload?.payloadRevision).toBe("1");
    for (const malformed of [
      Object.defineProperty(command(), "requestId", { enumerable: true, get: () => "x" }),
      Object.assign(command(), { toJSON: () => ({}) }),
      Object.assign(command(), { [Symbol("x")]: 1 }),
      Object.defineProperty(command(), "hidden", { value: 1 }),
      new Proxy(command(), {
        ownKeys: () => {
          throw new Error("trap");
        },
      }),
    ])
      expect(state.ledger.append({}, malformed, 1)).toEqual({ outcome: "denied" });
  });

  it("handles payload presence, dual indexes, replay, and split conflicts", () => {
    const repository = createLocalC06EventRepository();
    expect(repository.append(rawRequest(), () => true).outcome).toBe("appended");
    expect(repository.append(rawRequest(), () => true).outcome).toBe("replayed");
    expect(repository.append(rawRequest({ payload: undefined }), () => true)).toEqual({
      outcome: "conflict",
    });
    expect(repository.append(rawRequest({ requestId: "6".repeat(48) }), () => true)).toEqual({
      outcome: "conflict",
    });
    expect(repository.append(rawRequest({ operationId: "7".repeat(48) }), () => true)).toEqual({
      outcome: "conflict",
    });
  });

  it("checks current scope before every state access and preserves state on denial", () => {
    const repository = createLocalC06EventRepository();
    expect(repository.append(rawRequest(), () => true).outcome).toBe("appended");
    const cases = [
      rawRequest({ requestId: "6".repeat(48), operationId: "7".repeat(48) }),
      rawRequest(),
      rawRequest({ occurredAt: "2026-08-02T00:00:01.000Z" }),
      rawRequest({ requestId: "8".repeat(48) }),
    ];
    for (const request of cases) {
      expect(repository.append(request, () => false)).toEqual({ outcome: "denied" });
      expect(
        repository.append(request, () => {
          throw new Error("deny");
        }),
      ).toEqual({ outcome: "denied" });
    }
    expect(repository.append(rawRequest(), () => true).outcome).toBe("replayed");
    expect(repository.append(cases[0], () => true).outcome).toBe("appended");
    expect(repository.append(cases[2], () => true)).toEqual({ outcome: "conflict" });
  });

  it("classifies replay and both split conflicts only after nested callback publication", () => {
    const cases = [
      {
        nested: rawRequest(),
        outer: rawRequest(),
        outcome: "replayed",
      },
      {
        nested: rawRequest({ operationId: "6".repeat(48) }),
        outer: rawRequest(),
        outcome: "conflict",
      },
      {
        nested: rawRequest({ requestId: "7".repeat(48) }),
        outer: rawRequest(),
        outcome: "conflict",
      },
    ];
    for (const fixture of cases) {
      const repository = createLocalC06EventRepository();
      let outerCalls = 0;
      let nestedCalls = 0;
      const result = repository.append(fixture.outer, () => {
        outerCalls += 1;
        expect(
          repository.append(fixture.nested, () => {
            nestedCalls += 1;
            return true;
          }).outcome,
        ).toBe("appended");
        return true;
      });
      expect(result.outcome).toBe(fixture.outcome);
      expect(outerCalls).toBe(1);
      expect(nestedCalls).toBe(1);
    }
  });

  it("uses captured intrinsics after adversarial callbacks and restores every descriptor", () => {
    const repository = createLocalC06EventRepository();
    expect(appendWithTamperedIntrinsics(repository, rawRequest(), true).outcome).toBe("appended");
    expect(appendWithTamperedIntrinsics(repository, rawRequest(), true).outcome).toBe("replayed");
    expect(
      appendWithTamperedIntrinsics(repository, rawRequest({ operationId: "6".repeat(48) }), true),
    ).toEqual({ outcome: "conflict" });
    expect(
      appendWithTamperedIntrinsics(repository, rawRequest({ requestId: "7".repeat(48) }), true),
    ).toEqual({ outcome: "conflict" });

    const falseRequest = rawRequest({
      attemptId: "8".repeat(48),
      operationId: "9".repeat(48),
      requestId: "a".repeat(48),
    });
    expect(appendWithTamperedIntrinsics(repository, falseRequest, false)).toEqual({
      outcome: "denied",
    });
    expect(appendWithTamperedIntrinsics(repository, falseRequest, true).outcome).toBe("appended");
    const throwRequest = rawRequest({
      attemptId: "b".repeat(48),
      operationId: "c".repeat(48),
      requestId: "d".repeat(48),
    });
    expect(appendWithTamperedIntrinsics(repository, throwRequest, "throw")).toEqual({
      outcome: "denied",
    });
    expect(appendWithTamperedIntrinsics(repository, throwRequest, true).outcome).toBe("appended");
  });

  it("does not publish private state through inherited numeric setters", () => {
    const repository = createLocalC06EventRepository();
    const arrayPrototype = Array.prototype;
    const originalZero = getOwnPropertyDescriptor(arrayPrototype, "0");
    const deniedRequest = rawRequest({
      attemptId: "8".repeat(48),
      operationId: "9".repeat(48),
      requestId: "a".repeat(48),
    });
    const throwRequest = rawRequest({
      attemptId: "b".repeat(48),
      operationId: "c".repeat(48),
      requestId: "d".repeat(48),
    });
    let setterCalls = 0;
    let leakedValue;
    let first;
    let second;
    let deniedResult;
    let throwResult;

    try {
      first = repository.append(rawRequest(), () => {
        defineProperty(arrayPrototype, "0", {
          configurable: true,
          enumerable: false,
          get: () => undefined,
          set: (value) => {
            setterCalls += 1;
            leakedValue = value;
          },
        });
        return true;
      });
      second = repository.append(rawRequest(), () => true);
      deniedResult = repository.append(deniedRequest, () => false);
      throwResult = repository.append(throwRequest, () => {
        throw new Error("denied");
      });
    } finally {
      if (originalZero) defineProperty(arrayPrototype, "0", originalZero);
      else delete arrayPrototype[0];
    }

    expect(setterCalls).toBe(0);
    expect(leakedValue).toBeUndefined();
    expect(first?.outcome).toBe("appended");
    expect(second?.outcome).toBe("replayed");
    expect(deniedResult).toEqual({ outcome: "denied" });
    expect(throwResult).toEqual({ outcome: "denied" });
    expect(repository.append(rawRequest(), () => true).outcome).toBe("replayed");
    expect(repository.append(deniedRequest, () => true).outcome).toBe("appended");
    expect(repository.append(throwRequest, () => true).outcome).toBe("appended");
  });

  it("does not invoke inherited descriptor accessors", () => {
    const repository = createLocalC06EventRepository();
    const objectPrototype = Object.prototype;
    const originalGet = getOwnPropertyDescriptor(objectPrototype, "get");
    const originalSet = getOwnPropertyDescriptor(objectPrototype, "set");
    const deniedRequest = rawRequest({
      attemptId: "8".repeat(48),
      operationId: "9".repeat(48),
      requestId: "a".repeat(48),
    });
    const throwRequest = rawRequest({
      attemptId: "b".repeat(48),
      operationId: "c".repeat(48),
      requestId: "d".repeat(48),
    });
    let getterCalls = 0;
    let setterCalls = 0;
    let leakedValue;
    const inheritedGetter = () => {
      getterCalls += 1;
      return undefined;
    };
    const inheritedSetter = (value) => {
      setterCalls += 1;
      leakedValue = value;
    };
    const getAttackDescriptor = {
      configurable: true,
      enumerable: false,
      get: inheritedGetter,
      set: inheritedSetter,
    };
    const setAttackDescriptor = {
      configurable: true,
      enumerable: false,
      get: inheritedGetter,
      set: inheritedSetter,
    };
    let first;
    let second;
    let deniedResult;
    let throwResult;
    let appendError;

    try {
      try {
        first = repository.append(rawRequest(), () => {
          defineProperty(objectPrototype, "get", getAttackDescriptor);
          defineProperty(objectPrototype, "set", setAttackDescriptor);
          return true;
        });
        second = repository.append(rawRequest(), () => true);
        deniedResult = repository.append(deniedRequest, () => false);
        throwResult = repository.append(throwRequest, () => {
          throw new Error("denied");
        });
      } catch (error) {
        appendError = error;
      }
    } finally {
      delete objectPrototype.get;
      delete objectPrototype.set;
      if (originalGet) defineProperty(objectPrototype, "get", originalGet);
      if (originalSet) defineProperty(objectPrototype, "set", originalSet);
    }

    expect(appendError).toBeUndefined();
    expect(getterCalls).toBe(0);
    expect(setterCalls).toBe(0);
    expect(leakedValue).toBeUndefined();
    expect(first?.outcome).toBe("appended");
    expect(second?.outcome).toBe("replayed");
    expect(deniedResult).toEqual({ outcome: "denied" });
    expect(throwResult).toEqual({ outcome: "denied" });
    expect(repository.append(rawRequest(), () => true).outcome).toBe("replayed");
    expect(repository.append(deniedRequest, () => true).outcome).toBe("appended");
    expect(repository.append(throwRequest, () => true).outcome).toBe("appended");
  });

  it("denies only the exact repository self-target pair before callback or indexing", () => {
    const repository = createLocalC06EventRepository();
    let callbackCalls = 0;
    expect(
      repository.append(rawRequest({ targetEventId: "4".repeat(48) }), () => {
        callbackCalls += 1;
        return true;
      }),
    ).toEqual({ outcome: "denied" });
    expect(callbackCalls).toBe(0);
    expect(
      repository.append(
        rawRequest({ targetEventId: "4".repeat(48), targetEventRevision: "2" }),
        () => true,
      ).outcome,
    ).toBe("appended");
    expect(
      repository.append(
        rawRequest({
          attemptId: "8".repeat(48),
          operationId: "7".repeat(48),
          requestId: "6".repeat(48),
        }),
        () => true,
      ).outcome,
    ).toBe("appended");
  });

  it("bounds scopes and requests without evicting or displacing replays", () => {
    const repository = createLocalC06EventRepository();
    for (let index = 0; index < 64; index += 1) {
      const request = rawRequest({
        attemptId: index.toString(16).padStart(48, "0"),
        operationId: (index + 100).toString(16).padStart(48, "0"),
        requestId: (index + 200).toString(16).padStart(48, "0"),
      });
      expect(repository.append(request, () => true).outcome).toBe("appended");
    }
    expect(
      repository.append(
        rawRequest({ requestId: "f".repeat(48), operationId: "e".repeat(48) }),
        () => true,
      ),
    ).toEqual({ outcome: "denied" });
    expect(
      repository.append(
        rawRequest({
          requestId: (200).toString(16).padStart(48, "0"),
          operationId: (100).toString(16).padStart(48, "0"),
          attemptId: "0".repeat(48),
        }),
        () => true,
      ).outcome,
    ).toBe("replayed");
    const scopes = createLocalC06EventRepository();
    for (let index = 0; index < 64; index += 1) {
      const request = rawRequest({ payload: undefined });
      request.serverPurpose = `scope-${index}`;
      request.requestedPurpose = request.serverPurpose;
      expect(scopes.append(request, () => true).outcome).toBe("appended");
    }
    const extra = rawRequest({ payload: undefined });
    extra.serverPurpose = "scope-extra";
    extra.requestedPurpose = extra.serverPurpose;
    expect(scopes.append(extra, () => true)).toEqual({ outcome: "denied" });
  });
});
