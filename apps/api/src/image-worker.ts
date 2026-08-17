import { stdin, stdout } from "node:process";
import { types as nodeUtilTypes } from "node:util";
import { runProductionHackathon } from "./production-runtime.js";

const maximumInputBytes = 1_024;
const steps = new Set(["start", "ask_before", "correct", "ask_after", "latest_receipt", "proofs"]);
function isProxy(value: unknown): boolean {
  return nodeUtilTypes.isProxy(value);
}

function input(value: unknown) {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      JSON.stringify(Reflect.ownKeys(descriptors).sort()) !==
        JSON.stringify(["sessionDigest", "step"]) ||
      Object.values(descriptors).some(
        (descriptor) => !descriptor.enumerable || !("value" in descriptor),
      )
    )
      return undefined;
    const sessionDigest = descriptors.sessionDigest?.value;
    const step = descriptors.step?.value;
    return typeof sessionDigest === "string" &&
      /^[a-f0-9]{64}$/u.test(sessionDigest) &&
      typeof step === "string" &&
      steps.has(step)
      ? Object.freeze({ sessionDigest, step })
      : undefined;
  } catch {
    return undefined;
  }
}

async function readInput(): Promise<string | undefined> {
  let bytes = 0;
  let value = "";
  for await (const chunk of stdin) {
    if (!(chunk instanceof Uint8Array)) return undefined;
    bytes += chunk.byteLength;
    if (bytes > maximumInputBytes) return undefined;
    value += Buffer.from(chunk).toString("utf8");
  }
  return Buffer.byteLength(value, "utf8") === bytes ? value : undefined;
}

async function main() {
  try {
    const source = await readInput();
    const request = source === undefined ? undefined : input(JSON.parse(source));
    return request ? await runProductionHackathon(request) : Object.freeze({ outcome: "unknown" });
  } catch {
    return Object.freeze({ outcome: "unknown" });
  }
}

main()
  .then((result) => stdout.write(JSON.stringify(result)))
  .catch(() => stdout.write('{"outcome":"unknown"}'));
