import type { AuthenticationService } from "../authentication.js";

export interface TenantAuthoritySource {
  readonly kind: "tenant-authority-source";
}

export interface TenantAuthoritySourceState {
  readonly authentication: AuthenticationService;
  readonly origin: object;
  readonly readGeneration: () => unknown;
  readonly tenantLookup: (intent: unknown) => unknown;
}

export type LocalC02AuthoritySourceRecord = TenantAuthoritySourceState;

const plainObjectPrototype = Object.getPrototypeOf({});
const sourceStates = new WeakMap<object, TenantAuthoritySourceState>();
const registeredOrigins = new WeakMap<object, object>();

function invalid(): never {
  throw new Error("INVALID_LOCAL_C02_AUTHORITY_SOURCE");
}

export function lookupTenantAuthoritySourceState(
  source: unknown,
): TenantAuthoritySourceState | undefined {
  return source !== null && typeof source === "object" ? sourceStates.get(source) : undefined;
}

export function registerLocalC02AuthoritySource(
  record: LocalC02AuthoritySourceRecord,
): TenantAuthoritySource {
  let descriptors: PropertyDescriptorMap;
  try {
    if (
      !record ||
      typeof record !== "object" ||
      Object.getPrototypeOf(record) !== plainObjectPrototype ||
      !Object.isFrozen(record)
    )
      invalid();
    descriptors = Object.getOwnPropertyDescriptors(record);
  } catch {
    invalid();
  }
  const keys = Object.keys(descriptors);
  if (
    keys.length !== 4 ||
    !["authentication", "origin", "readGeneration", "tenantLookup"].every((key) =>
      keys.includes(key),
    ) ||
    keys.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
  )
    invalid();
  const authentication = descriptors.authentication?.value as AuthenticationService | undefined;
  const origin = descriptors.origin?.value as unknown;
  const readGeneration = descriptors.readGeneration?.value as unknown;
  const tenantLookup = descriptors.tenantLookup?.value as unknown;
  if (
    !authentication ||
    origin === null ||
    typeof origin !== "object" ||
    typeof readGeneration !== "function" ||
    typeof tenantLookup !== "function" ||
    registeredOrigins.has(origin)
  )
    invalid();
  const reservation = {};
  registeredOrigins.set(origin, reservation);
  try {
    const initialGeneration = readGeneration();
    if (initialGeneration === null || typeof initialGeneration !== "object") invalid();
    const source: TenantAuthoritySource = Object.freeze({ kind: "tenant-authority-source" });
    const state: TenantAuthoritySourceState = Object.freeze({
      authentication,
      origin,
      readGeneration: readGeneration as () => unknown,
      tenantLookup: tenantLookup as (intent: unknown) => unknown,
    });
    sourceStates.set(source, state);
    return source;
  } catch {
    if (registeredOrigins.get(origin) === reservation) registeredOrigins.delete(origin);
    invalid();
  }
}
