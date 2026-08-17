import { createHash, randomUUID } from "node:crypto";
import { types as nodeTypes } from "node:util";
import {
  type BedrockRuntimeSender,
  type BedrockTransmissionRequest,
  bedrockHackathonProfile,
  createBedrockPorts,
  createHackathonCrdbRepository,
  type HackathonPoolLike,
} from "@zintus-continuity/adapters-local";
import {
  compileHackathonContext,
  createHackathonLive,
  type HackathonRetrievalPolicyRequest,
  hackathonLiveProfile,
} from "@zintus-continuity/application";

const question = "What is Continuity's launch day, and how can judges inspect the evidence?";
const embeddingInputs = new Set([
  "Continuity launch day is monday for the hackathon demo",
  "Internal budget ceiling is nine units — restricted synthetic",
  "Judges query disclosure receipts through Managed MCP read-only",
  "Continuity launch day is sunday for the hackathon demo",
  question,
]);
const launchFactId = "1".repeat(48);
const restrictedFactId = "2".repeat(48);
const evidenceFactId = "3".repeat(48);
const monday = "Continuity launch day is monday for the hackathon demo";
const sunday = "Continuity launch day is sunday for the hackathon demo";
const evidence = "Judges query disclosure receipts through Managed MCP read-only";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function isProxy(value: unknown): boolean {
  return nodeTypes.isProxy(value);
}
const identifier = (value: unknown, size = 48): value is string =>
  typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`, "u").test(value);
const uint64 = (value: unknown, zero = true): value is string =>
  typeof value === "string" &&
  /^(?:0|[1-9][0-9]{0,19})$/u.test(value) &&
  (zero || value !== "0") &&
  BigInt(value) <= 18_446_744_073_709_551_615n;
function own(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== keys.length ||
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== "string" ||
          !keys.includes(key) ||
          !descriptors[key]?.enumerable ||
          !("value" in descriptors[key]),
      )
    )
      return;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return;
  }
}
function retrievalPolicy() {
  return Object.freeze({
    authorize(request: HackathonRetrievalPolicyRequest) {
      const keys = [
        "accessTier",
        "attemptId",
        "contextCompilerVersion",
        "dataClassification",
        "embeddingSpaceVersion",
        "operationId",
        "policyVersion",
        "purpose",
        "query",
        "queryDigest",
        "queryProjection",
        "requestDigest",
        "retrievalConfigVersion",
        "step",
        "tenantId",
        "topK",
      ];
      const row = own(request, keys);
      const expectedDigest = digest(
        JSON.stringify([
          "zc.hackathon-query.v1",
          question,
          "authorized-body+restricted-metadata",
          3,
          hackathonLiveProfile.compilerVersion,
          hackathonLiveProfile.retrievalVersion,
          hackathonLiveProfile.embeddingSpace,
        ]),
      );
      return row &&
        row.accessTier === "standard" &&
        identifier(row.attemptId) &&
        row.contextCompilerVersion === hackathonLiveProfile.compilerVersion &&
        row.dataClassification === "synthetic" &&
        row.embeddingSpaceVersion === hackathonLiveProfile.embeddingSpace &&
        identifier(row.operationId) &&
        row.policyVersion === hackathonLiveProfile.policyVersion &&
        row.purpose === hackathonLiveProfile.purpose &&
        row.query === question &&
        row.queryDigest === expectedDigest &&
        row.queryProjection === "authorized-body+restricted-metadata" &&
        identifier(row.requestDigest, 64) &&
        row.retrievalConfigVersion === hackathonLiveProfile.retrievalVersion &&
        (row.step === "ask_before" || row.step === "ask_after") &&
        identifier(row.tenantId) &&
        row.topK === 3
        ? Object.freeze({
            ...row,
            decisionId: `retrieval-${digest(
              `zc.hackathon-retrieval-decision.v1:${JSON.stringify(keys.map((key) => row[key]))}`,
            )}`,
            outcome: "authorized",
          })
        : Object.freeze({ outcome: "denied" });
    },
  });
}
function generationRevisionIds(value: string, fence: string): readonly string[] | undefined {
  if (!value.startsWith("ZINTUS_CONTINUITY_CONTEXT_V1\n")) return;
  try {
    const marker = "\nAUTHORIZED_MEMORY_JSON=";
    const encoded = value.slice(value.indexOf(marker) + marker.length);
    const facts: unknown = JSON.parse(encoded);
    if (!Array.isArray(facts) || facts.length < 1 || facts.length > 8) return;
    const rows = facts.map((fact) => own(fact, ["content", "factId", "revision"]));
    if (
      rows.some(
        (fact) =>
          !fact ||
          typeof fact.content !== "string" ||
          fact.content.length < 1 ||
          fact.content.length > 2_048 ||
          fact.content.includes("Internal budget ceiling is nine units — restricted synthetic") ||
          fact.factId === restrictedFactId ||
          !identifier(fact.factId) ||
          !uint64(fact.revision, false),
      ) ||
      value !== compileHackathonContext(rows as never)
    )
      return;
    const reviewed = rows
      .map((fact) => `${fact?.factId}:${fact?.revision}:${fact?.content}`)
      .sort();
    const before = [`${launchFactId}:1:${monday}`, `${evidenceFactId}:1:${evidence}`].sort();
    const after = [`${launchFactId}:2:${sunday}`, `${evidenceFactId}:1:${evidence}`].sort();
    if (
      reviewed.length !== 2 ||
      ![before, after].some((allowed) => allowed.every((entry, index) => entry === reviewed[index]))
    )
      return;
    return Object.freeze(rows.map((fact) => `${fact?.factId}:${fact?.revision}:${fence}`).sort());
  } catch {
    return;
  }
}

function activeIds(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value) || isProxy(value) || value.length > 8) return;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const copy: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return;
      if (typeof descriptor.value !== "string") return;
      copy.push(descriptor.value);
    }
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(String(key)),
      ) ||
      new Set(copy).size !== copy.length ||
      [...copy].sort().some((entry, index) => entry !== copy[index])
    )
      return;
    return Object.freeze(copy);
  } catch {
    return;
  }
}
function requestDigest(request: Omit<BedrockTransmissionRequest, "requestDigest">) {
  return digest(
    JSON.stringify([
      request.requestDigestVersion,
      request.requestNonce,
      request.contentDigestVersion,
      request.tenantId,
      request.purpose,
      request.attemptId,
      request.policyVersion,
      request.dataClassification,
      request.deletionFence,
      request.destination,
      request.contextCompilerVersion,
      request.retrievalConfigVersion,
      request.embeddingSpaceVersion,
      request.activeMemoryRevisionIds,
      request.operation,
      request.modelId,
      request.region,
      request.contentDigest,
    ]),
  );
}
function transmissionPolicy() {
  const used = new Set<string>();
  return Object.freeze({
    async authorize(request: BedrockTransmissionRequest) {
      const row = own(request, [
        "activeMemoryRevisionIds",
        "attemptId",
        "content",
        "contentDigest",
        "contentDigestVersion",
        "contextCompilerVersion",
        "dataClassification",
        "deletionFence",
        "destination",
        "embeddingSpaceVersion",
        "modelId",
        "operation",
        "policyVersion",
        "purpose",
        "region",
        "requestDigest",
        "requestDigestVersion",
        "requestNonce",
        "retrievalConfigVersion",
        "tenantId",
      ]);
      const active = activeIds(row?.activeMemoryRevisionIds);
      const operation = row?.operation;
      const content = row?.content;
      const generationIds =
        operation === "generation" &&
        typeof content === "string" &&
        typeof row?.deletionFence === "string"
          ? generationRevisionIds(content, row.deletionFence)
          : undefined;
      const validEmbeddingScope =
        operation === "embedding" &&
        typeof content === "string" &&
        embeddingInputs.has(content) &&
        row?.deletionFence === "0" &&
        (content === sunday
          ? active?.length === 1 && active[0] === `${launchFactId}:1:0`
          : active?.length === 0);
      const validGenerationScope =
        operation === "generation" &&
        active !== undefined &&
        active.length > 0 &&
        generationIds !== undefined &&
        generationIds.length === active.length &&
        generationIds.every((entry, index) => entry === active[index]);
      const model =
        operation === "embedding"
          ? bedrockHackathonProfile.embeddingModelId
          : bedrockHackathonProfile.generationModelId;
      if (
        !row ||
        !active ||
        active.some((id) => {
          const [factId, revision, deletionFence] = id.split(":");
          return (
            !identifier(factId) ||
            !uint64(revision, false) ||
            !uint64(deletionFence) ||
            deletionFence !== row.deletionFence
          );
        }) ||
        !identifier(row.attemptId) ||
        !identifier(row.tenantId) ||
        !uint64(row.deletionFence) ||
        row.contextCompilerVersion !== hackathonLiveProfile.compilerVersion ||
        row.dataClassification !== "synthetic" ||
        row.destination !== bedrockHackathonProfile.destination ||
        row.embeddingSpaceVersion !== hackathonLiveProfile.embeddingSpace ||
        row.modelId !== model ||
        row.policyVersion !== hackathonLiveProfile.policyVersion ||
        row.purpose !== hackathonLiveProfile.purpose ||
        row.region !== bedrockHackathonProfile.region ||
        row.retrievalConfigVersion !== hackathonLiveProfile.retrievalVersion ||
        row.contentDigestVersion !== "sha256-utf8.v1" ||
        row.requestDigestVersion !== "zc.bedrock-request-digest.v1" ||
        typeof content !== "string" ||
        row.contentDigest !== digest(content) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          String(row.requestNonce),
        ) ||
        row.requestDigest !==
          requestDigest(row as unknown as Omit<BedrockTransmissionRequest, "requestDigest">) ||
        (!validEmbeddingScope && !validGenerationScope)
      )
        return Object.freeze({ outcome: "denied" });
      const decisionId = `transmission-${randomUUID()}`;
      if (used.has(decisionId)) return Object.freeze({ outcome: "denied" });
      used.add(decisionId);
      const issuedAt = Date.now();
      return Object.freeze({
        ...row,
        decisionId,
        expiresAt: issuedAt + 30_000,
        issuedAt,
        outcome: "authorized",
      });
    },
  });
}

export function createLocalHackathonRuntimeCandidate(input: unknown) {
  const row = own(input, ["pool", "sender"]);
  const poolPrototype =
    row?.pool && typeof row.pool === "object" ? Object.getPrototypeOf(row.pool) : undefined;
  const poolConnect =
    row?.pool && typeof row.pool === "object"
      ? Object.getOwnPropertyDescriptor(row.pool, "connect")
      : undefined;
  if (
    !row ||
    !row.pool ||
    typeof row.pool !== "object" ||
    isProxy(row.pool) ||
    (poolPrototype !== Object.prototype && poolPrototype !== null) ||
    !poolConnect?.enumerable ||
    !("value" in poolConnect) ||
    typeof poolConnect.value !== "function" ||
    typeof row.sender !== "function" ||
    isProxy(row.sender)
  )
    throw new TypeError("invalid_runtime_dependencies");
  const store = createHackathonCrdbRepository({ pool: row.pool as HackathonPoolLike });
  return createHackathonLive({
    providerFor(scope) {
      const ports = createBedrockPorts(
        scope,
        transmissionPolicy(),
        row.sender as BedrockRuntimeSender,
      );
      return Object.freeze({
        embed: (text: string) => ports.embed.embed(text),
        generate: (prompt: string) => ports.generate.generate(prompt),
      });
    },
    retrievalPolicy: retrievalPolicy(),
    sha256: async (value) => digest(value),
    store,
  });
}
