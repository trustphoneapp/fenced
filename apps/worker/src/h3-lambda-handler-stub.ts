/**
 * H3 Lambda handler stub — fail-closed until HG-5 cloud/operations.
 * Does not open network sockets or invoke AWS APIs.
 */

export type LambdaStubResult = Readonly<{
  readonly statusCode: 503;
  readonly body: string;
  readonly headers: Readonly<{ "content-type": "application/json" }>;
}>;

export function handleDemoAskStub(_event: unknown): LambdaStubResult {
  return Object.freeze({
    statusCode: 503 as const,
    headers: Object.freeze({ "content-type": "application/json" as const }),
    body: JSON.stringify({
      outcome: "denied",
      reason: "human_gate_pending",
      gate: "HG-5",
      note: "Live Lambda + Bedrock + CockroachDB require owner cloud authority",
    }),
  });
}
