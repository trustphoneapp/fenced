import { types as nodeUtilTypes } from "node:util";

const escaped = nodeUtilTypes;
void escaped;

export function rejectProxy(value: unknown): void {
  if (nodeUtilTypes.isProxy(value)) throw new Error("proxy");
}
