export { mergeOwnDataRecords as mergeSyntheticRecords } from "./safe-own-data.mjs";

/** Test-only adversarial descriptor constructor; never used by product code. */
export function defineSyntheticProperty(target, key, descriptor) {
  Object.defineProperty(target, key, descriptor);
}

/** Test-only hostile proxy constructor kept out of data validators. */
export function createSyntheticProxy(target, handler) {
  return new Proxy(target, handler);
}

/** Test-only proxy forwarding seam kept out of verifier consumers. */
export function forwardSyntheticGet(target, key, receiver) {
  return Reflect.get(target, key, receiver);
}

/** Test-only proxy descriptor forwarding seam kept out of verifier consumers. */
export function forwardSyntheticDescriptor(target, key) {
  return Reflect.getOwnPropertyDescriptor(target, key);
}

/** Test-only proxy own-key forwarding seam kept out of verifier consumers. */
export function forwardSyntheticOwnKeys(target) {
  return Reflect.ownKeys(target);
}
