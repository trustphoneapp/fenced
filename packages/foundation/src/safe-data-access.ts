/**
 * Every exported helper in this module requires caller-validated, non-Proxy
 * plain JSON data. ECMAScript has no portable, side-effect-free Proxy test.
 */
const MAX_DATA_KEY_LENGTH = 256;
const plainObjectPrototype = Object.getPrototypeOf({});

function assertSafeKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_DATA_KEY_LENGTH ||
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

function assertDataContainer(value: object): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === plainObjectPrototype) {
    return;
  }
  if (Array.isArray(value)) return;
  throw new Error("data container must be a plain JSON object or array");
}

function assertNonCallable(value: unknown): void {
  if (typeof value === "function") throw new Error("callable data is prohibited");
}

/** All exported helpers require caller-validated, non-Proxy plain data. */
export function readOwnData<T = unknown>(container: object, key: unknown): T | undefined {
  return readOwnDataDescriptor<T>(container, key)?.value;
}

/** Requires caller-validated, non-Proxy plain data. */
export function readOwnDataDescriptor<T = unknown>(
  container: object,
  key: unknown,
): Readonly<{ enumerable: boolean; value: T }> | undefined {
  assertSafeKey(key);
  assertDataContainer(container);
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new Error("accessor data is prohibited");
  assertNonCallable(descriptor.value);
  return Object.freeze({
    enumerable: descriptor.enumerable === true,
    value: descriptor.value as T,
  });
}

/** Requires caller-validated, non-Proxy plain data. */
export function ownDataKeys(container: object): readonly string[] {
  assertDataContainer(container);
  const enumerable = Object.keys(container);
  const all = Reflect.ownKeys(container);
  if (
    all.length !== enumerable.length ||
    all.some((key, index) => typeof key !== "string" || key !== enumerable.at(index))
  ) {
    throw new Error("data container has unsupported properties");
  }
  return Object.freeze(enumerable);
}

/** Requires caller-validated, non-Proxy plain data. */
export function ownDataPropertyNames(container: object): readonly string[] {
  assertDataContainer(container);
  return Object.freeze(Object.getOwnPropertyNames(container));
}

/** Requires caller-validated, non-Proxy plain data. */
export function ownDataHasNoSymbols(container: object): boolean {
  assertDataContainer(container);
  return Object.getOwnPropertySymbols(container).length === 0;
}

/** Requires caller-validated, non-Proxy plain data. */
export function hasOwnDataProperty(container: object, key: unknown): boolean {
  assertSafeKey(key);
  assertDataContainer(container);
  return Object.hasOwn(container, key);
}

/** Requires caller-validated, non-Proxy plain data. */
export function ownDataEntries<T = unknown>(container: object): readonly (readonly [string, T])[] {
  return Object.freeze(
    ownDataKeys(container).map((key) =>
      Object.freeze([key, readOwnData<T>(container, key) as T] as const),
    ),
  );
}

/** Requires caller-validated, non-Proxy plain data. */
export function copyOwnDataRecord(container: object): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(ownDataEntries(container)));
}
