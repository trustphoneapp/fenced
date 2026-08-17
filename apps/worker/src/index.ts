import { localAdapterLayer } from "@zintus-continuity/adapters-local";

export { handleDemoAskStub, type LambdaStubResult } from "./h3-lambda-handler-stub.js";

/**
 * Composition marker only. B01 intentionally starts no queue consumer.
 * Live Lambda path remains HG-5 (see handleDemoAskStub).
 */
export const workerCompositionRoot = {
  adapter: localAdapterLayer.name,
  name: "worker" as const,
};
