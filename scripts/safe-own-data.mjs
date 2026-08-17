const MAX_KEY_LENGTH = 512;

function assertSafeDataKey(key) {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    key === "__proto__" ||
    key === "apply" ||
    key === "arguments" ||
    key === "bind" ||
    key === "call" ||
    key === "callee" ||
    key === "caller" ||
    key === "constructor" ||
    key === "prototype"
  ) {
    throw new Error("unsafe data property");
  }
}

function dataTarget(container) {
  if (container === null || (typeof container !== "object" && typeof container !== "string")) {
    throw new Error("data container is invalid");
  }
  return typeof container === "string" ? Object(container) : container;
}

function readOwnDataDescriptor(container, key) {
  assertSafeDataKey(key);
  const descriptor = Object.getOwnPropertyDescriptor(dataTarget(container), key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new Error("accessor data is prohibited");
  if (typeof descriptor.value === "function") throw new Error("callable data is prohibited");
  return descriptor;
}

export function readOwnData(container, key) {
  return readOwnDataDescriptor(container, key)?.value;
}

export function ownDataKeys(container) {
  return Object.freeze(Object.keys(container));
}

export function ownDataEntries(container) {
  return Object.freeze(
    ownDataKeys(container).map((key) => Object.freeze([key, readOwnData(container, key)])),
  );
}

export function mergeOwnDataRecords(...records) {
  const output = {};
  for (const record of records) {
    for (const [key, value] of ownDataEntries(record ?? {})) {
      writeOwnData(output, key, value);
    }
  }
  return output;
}

function defineOwnDataProperty(target, key, value, current) {
  assertSafeDataKey(key);
  Object.defineProperty(target, key, {
    configurable: current?.configurable ?? true,
    enumerable: current?.enumerable ?? true,
    value,
    writable: current?.writable ?? true,
  });
}

export function writeOwnData(container, key, value) {
  if (typeof value === "function") throw new Error("callable data is prohibited");
  const target = dataTarget(container);
  const current = readOwnDataDescriptor(target, key);
  defineOwnDataProperty(target, key, value, current);
}
