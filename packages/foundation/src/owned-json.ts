declare const ownedJsonBrand: unique symbol;

export interface OwnedJsonArray extends ReadonlyArray<OwnedJson> {
  readonly [ownedJsonBrand]: true;
}

export interface OwnedJsonObject {
  readonly [ownedJsonBrand]: true;
}

export type OwnedJson = boolean | number | string | null | OwnedJsonArray | OwnedJsonObject;

export type OwnedJsonProfile = "contract" | "small";

const profiles = Object.freeze({
  contract: Object.freeze({
    arrayLength: 4096,
    bytes: 1_048_576,
    depth: 64,
    nodes: 65_536,
    properties: 512,
    stringBytes: 262_144,
  }),
  small: Object.freeze({
    arrayLength: 64,
    bytes: 16_384,
    depth: 32,
    nodes: 4096,
    properties: 64,
    stringBytes: 4096,
  }),
});

const dangerousKeys = new Set([
  "__proto__",
  "apply",
  "arguments",
  "bind",
  "call",
  "callee",
  "caller",
  "constructor",
  "prototype",
]);
const plainObjectPrototype = Object.getPrototypeOf({});
const ownedContainers = new WeakSet<object>();

function utf8BytesWithin(value: string, maximum: number): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      bytes += 4;
      index += 1;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
      bytes += 3;
    }
    if (bytes > maximum) return undefined;
  }
  return bytes;
}

function canonical(value: OwnedJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    let output = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) output += ",";
      output += canonical(value.at(index) as OwnedJson);
    }
    return `${output}]`;
  }
  const entries = Object.entries(value as object).sort((left, right) => {
    const leftKey = left.at(0) as string;
    const rightKey = right.at(0) as string;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  let output = "{";
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries.at(index) as [string, OwnedJson];
    const key = entry.at(0) as string;
    if (index > 0) output += ",";
    output += `${JSON.stringify(key)}:${canonical(entry.at(1) as OwnedJson)}`;
  }
  return `${output}}`;
}

export function ownedJsonEntries(
  value: OwnedJsonObject,
): readonly (readonly [string, OwnedJson])[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !ownedContainers.has(value) ||
    Array.isArray(value)
  )
    throw new Error("owned JSON object is invalid");
  return Object.freeze(
    Object.entries(value as object).map((entry) =>
      Object.freeze([entry.at(0) as string, entry.at(1) as OwnedJson] as const),
    ),
  );
}

export function readOwnedJson(value: OwnedJsonObject, key: unknown): OwnedJson | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !ownedContainers.has(value) ||
    Array.isArray(value)
  )
    throw new Error("owned JSON object is invalid");
  if (typeof key !== "string" || dangerousKeys.has(key))
    throw new Error("owned JSON key is invalid");
  const entry = Object.entries(value as object).find((candidate) => candidate.at(0) === key);
  return entry?.at(1) as OwnedJson | undefined;
}

export function isOwnedJsonArray(value: unknown): value is OwnedJsonArray {
  return (
    typeof value === "object" &&
    value !== null &&
    ownedContainers.has(value) &&
    Array.isArray(value)
  );
}

export function isOwnedJsonObject(value: unknown): value is OwnedJsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    ownedContainers.has(value) &&
    !Array.isArray(value)
  );
}

export function ownedJsonLength(value: OwnedJsonArray): number {
  if (!isOwnedJsonArray(value)) throw new Error("owned JSON array is invalid");
  return (value as unknown as readonly unknown[]).length;
}

export function ownedJsonAt(value: OwnedJsonArray, index: unknown): OwnedJson | undefined {
  if (!isOwnedJsonArray(value) || !Number.isSafeInteger(index) || (index as number) < 0)
    throw new Error("owned JSON array index is invalid");
  return (value as unknown as readonly unknown[]).at(index as number) as OwnedJson | undefined;
}

export function parseOwnedJson(text: unknown, profile: unknown): OwnedJson {
  const limits =
    profile === "contract" ? profiles.contract : profile === "small" ? profiles.small : undefined;
  if (
    limits === undefined ||
    typeof text !== "string" ||
    utf8BytesWithin(text, limits.bytes) === undefined
  )
    throw new Error("owned JSON input is invalid");

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("owned JSON input is invalid");
  }

  const stack: Array<{ readonly depth: number; readonly value: unknown }> = [
    { depth: 0, value: root },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame || frame.depth > limits.depth || ++nodes > limits.nodes)
      throw new Error("owned JSON bounds exceeded");
    const value = frame.value;
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("owned JSON number is invalid");
      continue;
    }
    if (typeof value === "string") {
      if (utf8BytesWithin(value, limits.stringBytes) === undefined)
        throw new Error("owned JSON string is invalid");
      continue;
    }
    if (typeof value !== "object") throw new Error("owned JSON member is invalid");

    if (Array.isArray(value)) {
      if (value.length > limits.arrayLength) throw new Error("owned JSON array is too large");
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ depth: frame.depth + 1, value: value.at(index) });
      }
      continue;
    }

    if (Object.getPrototypeOf(value) !== plainObjectPrototype)
      throw new Error("owned JSON object is invalid");
    const entries = Object.entries(value);
    if (entries.length > limits.properties) throw new Error("owned JSON object is too large");
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries.at(index) as [string, unknown];
      const key = entry.at(0) as string;
      if (dangerousKeys.has(key) || utf8BytesWithin(key, limits.stringBytes) === undefined)
        throw new Error("owned JSON key is invalid");
      stack.push({ depth: frame.depth + 1, value: entry.at(1) });
    }
  }

  if (canonical(root as OwnedJson) !== text) throw new Error("owned JSON must use canonical bytes");

  const freezeStack: object[] = root !== null && typeof root === "object" ? [root] : [];
  while (freezeStack.length > 0) {
    const value = freezeStack.pop();
    if (!value) continue;
    ownedContainers.add(value);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") freezeStack.push(child);
    }
    Object.freeze(value);
  }
  return root as OwnedJson;
}
