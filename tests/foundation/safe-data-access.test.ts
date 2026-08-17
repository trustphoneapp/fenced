import { describe, expect, it } from "vitest";
import {
  copyOwnDataRecord,
  hasOwnDataProperty,
  ownDataEntries,
  ownDataHasNoSymbols,
  ownDataKeys,
  ownDataPropertyNames,
  readOwnData,
  readOwnDataDescriptor,
} from "../../packages/foundation/src/safe-data-access.js";
import {
  createSyntheticProxy,
  defineSyntheticProperty,
} from "../../scripts/synthetic-test-data.mjs";

describe("safe own-data access", () => {
  it("reads bounded own data without invoking inherited properties", () => {
    const value = { safe: "before" };
    expect(readOwnData<string>(value, "safe")).toBe("before");
    expect(readOwnData(value, "missing")).toBeUndefined();
  });

  it("rejects dangerous names, accessors, and callables", () => {
    const getter = Object.create(null) as Record<string, unknown>;
    let invoked = false;
    defineSyntheticProperty(getter, "safe", {
      enumerable: true,
      get() {
        invoked = true;
        return "not-read";
      },
    });
    expect(() => readOwnData(getter, "safe")).toThrow("accessor data is prohibited");
    expect(invoked).toBe(false);
    expect(() => readOwnData({}, "constructor")).toThrow("unsafe data property");
    expect(() => readOwnData({ safe: () => undefined }, "safe")).toThrow(
      "callable data is prohibited",
    );
  });

  it("rejects non-string keys before touching key hooks", () => {
    let hooks = 0;
    const proxyKey = createSyntheticProxy(
      {},
      {
        get() {
          hooks += 1;
          throw new Error("must not inspect key");
        },
        getOwnPropertyDescriptor() {
          hooks += 1;
          throw new Error("must not inspect key");
        },
        getPrototypeOf() {
          hooks += 1;
          throw new Error("must not inspect key");
        },
        ownKeys() {
          hooks += 1;
          throw new Error("must not inspect key");
        },
      },
    );
    for (const key of [0, Symbol("key"), {}, proxyKey]) {
      expect(() => readOwnData({}, key as never)).toThrow("unsafe data property");
      expect(() => readOwnDataDescriptor({}, key as never)).toThrow("unsafe data property");
      expect(() => hasOwnDataProperty({}, key as never)).toThrow("unsafe data property");
    }
    expect(hooks).toBe(0);
  });

  it("enumerates and copies only supported own plain data", () => {
    const value = { first: 1, second: "two" };
    expect(ownDataKeys(value)).toEqual(["first", "second"]);
    expect(ownDataPropertyNames(value)).toEqual(["first", "second"]);
    expect(ownDataHasNoSymbols(value)).toBe(true);
    expect(hasOwnDataProperty(value, "first")).toBe(true);
    expect(ownDataEntries(value)).toEqual([
      ["first", 1],
      ["second", "two"],
    ]);
    expect(copyOwnDataRecord(value)).toEqual(value);

    const hidden = {};
    defineSyntheticProperty(hidden, "hidden", { value: 1 });
    expect(() => ownDataKeys(hidden)).toThrow("data container has unsupported properties");
    const symbolic = { [Symbol("hidden")]: 1 };
    expect(ownDataHasNoSymbols(symbolic)).toBe(false);
  });
});
