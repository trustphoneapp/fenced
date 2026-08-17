import { types as nodeUtilTypes } from "node:util";

export function rejectProxy(value: unknown): void {
  if (nodeUtilTypes.isProxy(value)) throw new Error("proxy");
}
