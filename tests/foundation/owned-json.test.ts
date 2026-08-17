import { describe, expect, it } from "vitest";
import {
  isOwnedJsonArray,
  isOwnedJsonObject,
  type OwnedJson,
  type OwnedJsonArray,
  type OwnedJsonObject,
  ownedJsonAt,
  ownedJsonEntries,
  ownedJsonLength,
  parseOwnedJson,
  readOwnedJson,
} from "../../packages/foundation/src/owned-json.js";

// @ts-expect-error raw arrays are not parser-owned arrays
const forgedArray: OwnedJsonArray = [] as readonly OwnedJson[];
// @ts-expect-error raw records are not parser-owned objects
const forgedObject: OwnedJsonObject = { safe: true } as const;
void forgedArray;
void forgedObject;

describe("provider-neutral owned JSON", () => {
  it("accepts canonical primitives and deeply freezes canonical graphs", () => {
    expect(parseOwnedJson("null", "small")).toBeNull();
    expect(parseOwnedJson("true", "small")).toBe(true);
    expect(parseOwnedJson('"value"', "small")).toBe("value");

    const value = parseOwnedJson('{"array":[1,{"nested":"value"}],"then":{"safe":true}}', "small");
    expect(isOwnedJsonObject(value)).toBe(true);
    const array = readOwnedJson(value as OwnedJsonObject, "array");
    expect(isOwnedJsonArray(array)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(array)).toBe(true);
    expect(Object.isFrozen(ownedJsonAt(array as OwnedJsonArray, 1))).toBe(true);
    expect(ownedJsonLength(array as OwnedJsonArray)).toBe(2);
  });

  it.each([
    ["whitespace", '{ "safe":1}'],
    ["unsorted keys", '{"z":1,"a":2}'],
    ["duplicate keys", '{"safe":1,"safe":2}'],
    ["dangerous proto key", '{"__proto__":1}'],
    ["dangerous constructor key", '{"constructor":1}'],
    ["negative zero", "-0"],
    ["exponent spelling", "1e0"],
    ["noncanonical escape", '"\\u0061"'],
    ["noncanonical astral escape", '"\\ud83d\\ude00"'],
    ["lone surrogate", '"\\ud800"'],
  ])("rejects %s", (_name, text) => {
    expect(() => parseOwnedJson(text, "small")).toThrow();
  });

  it("enforces byte, depth, array, property, and string bounds", () => {
    expect(() => parseOwnedJson(`"${"a".repeat(4097)}"`, "small")).toThrow();
    expect(() =>
      parseOwnedJson(`[${Array.from({ length: 65 }, () => "0").join(",")}]`, "small"),
    ).toThrow();
    expect(() =>
      parseOwnedJson(
        `{${Array.from({ length: 65 }, (_, index) => `"k${String(index).padStart(2, "0")}":0`).join(
          ",",
        )}}`,
        "small",
      ),
    ).toThrow();
    expect(() => parseOwnedJson(`${"[".repeat(34)}0${"]".repeat(34)}`, "small")).toThrow();
    expect(() => parseOwnedJson(`"${"a".repeat(16_385)}"`, "small")).toThrow();
    const wide = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `k${String(index).padStart(2, "0")}`,
        Array.from({ length: 64 }, () => 0),
      ]),
    );
    expect(() => parseOwnedJson(JSON.stringify(wide), "small")).toThrow();
    expect(() =>
      parseOwnedJson(`[${Array.from({ length: 4097 }, () => "0").join(",")}]`, "contract"),
    ).toThrow();
    expect(() => parseOwnedJson("", "contract")).toThrow();
  });

  it("accepts canonical Unicode without a reviver or executable members", () => {
    const text = JSON.stringify({ emoji: "😀", text: "é" });
    const value = parseOwnedJson(text, "small") as OwnedJsonObject;
    expect(readOwnedJson(value, "emoji")).toBe("😀");
    expect(readOwnedJson(value, "text")).toBe("é");
  });

  it("does not expose mutable nested parser output", () => {
    const value = parseOwnedJson('{"nested":{"value":"before"}}', "small") as OwnedJsonObject;
    const nested = readOwnedJson(value, "nested") as OwnedJsonObject;
    expect(() => {
      (nested as unknown as Record<string, unknown>).value = "after";
    }).toThrow();
    expect(readOwnedJson(nested, "value")).toBe("before");
  });

  it("rejects inherited, unknown, and coercive profile values without hooks", () => {
    for (const profile of ["__proto__", "constructor", "toString", "unknown"]) {
      expect(() => parseOwnedJson("null", profile)).toThrow();
    }
    let hooks = 0;
    const coercive = {
      [Symbol.toPrimitive]() {
        hooks += 1;
        return "small";
      },
      toString() {
        hooks += 1;
        return "small";
      },
    };
    expect(() => parseOwnedJson("null", coercive)).toThrow();
    expect(hooks).toBe(0);
    expect(() => parseOwnedJson({ toString: () => "null" }, "small")).toThrow();
  });

  it("rejects forged containers and proxies before invoking traps", () => {
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps += 1;
          return undefined;
        },
        ownKeys() {
          traps += 1;
          return [];
        },
      },
    ) as OwnedJsonObject;
    expect(() => ownedJsonEntries(proxy)).toThrow();
    expect(() => readOwnedJson(proxy, "safe")).toThrow();
    expect(traps).toBe(0);
    expect(() => ownedJsonEntries({} as OwnedJsonObject)).toThrow();
    expect(() => ownedJsonAt([] as unknown as OwnedJsonArray, 0)).toThrow();
  });

  it("does not expose inherited keys as owned JSON values", () => {
    const value = parseOwnedJson('{"safe":true}', "small") as OwnedJsonObject;
    expect(readOwnedJson(value, "safe")).toBe(true);
    for (const key of ["toString", "valueOf", "then"]) {
      expect(readOwnedJson(value, key)).toBeUndefined();
    }
    expect(() => Object.setPrototypeOf(value, null)).toThrow();
  });
});
