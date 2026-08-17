// H2 embedding-space bridge (local/synthetic prep).
// Local H1 recall uses an 8-d deterministic space that never touches CockroachDB.
// Persistence uses an explicit 1024-d space that matches migration 0007 and
// preserves cosine similarity by zero-padding (or truncating fail-closed).

import { recallEmbeddingDimension, recallEmbeddingSpace } from "./h1-recall-ledger.js";

export const persistentEmbeddingDimension = 1024 as const;
export const persistentSyntheticEmbeddingSpace = "zc.synthetic-fixture.v2.1024" as const;
export const persistentBedrockEmbeddingSpace = "zc.bedrock-titan-v2.1024" as const;

export type PersistentEmbeddingSpace =
  | typeof persistentSyntheticEmbeddingSpace
  | typeof persistentBedrockEmbeddingSpace;

const denied = Object.freeze({ outcome: "denied" as const });

export type EmbeddingPadResult =
  | Readonly<{
      readonly embedding: readonly number[];
      readonly embeddingSpace: typeof persistentSyntheticEmbeddingSpace;
      readonly outcome: "padded";
      readonly sourceSpace: typeof recallEmbeddingSpace;
    }>
  | typeof denied;

function finiteVector(value: unknown, expected: number): value is readonly number[] {
  if (!Array.isArray(value) || value.length !== expected) return false;
  let norm = 0;
  for (const component of value) {
    if (typeof component !== "number" || !Number.isFinite(component)) return false;
    norm += component * component;
  }
  return norm > 0;
}

/**
 * Maps a local H1 embedding into the 1024-d synthetic fixture space for H2
 * persistence. Zero-padding preserves cosine similarity among local vectors.
 * Returns denied (never throws) on wrong length or non-finite components.
 */
export function padLocalEmbeddingToPersistent(
  embedding: unknown,
  sourceSpace: unknown = recallEmbeddingSpace,
): EmbeddingPadResult {
  if (sourceSpace !== recallEmbeddingSpace) return denied;
  if (!finiteVector(embedding, recallEmbeddingDimension)) return denied;
  const padded = new Array<number>(persistentEmbeddingDimension).fill(0);
  for (let index = 0; index < recallEmbeddingDimension; index += 1)
    padded[index] = embedding[index] ?? 0;
  return Object.freeze({
    embedding: Object.freeze(padded),
    embeddingSpace: persistentSyntheticEmbeddingSpace,
    outcome: "padded" as const,
    sourceSpace: recallEmbeddingSpace,
  });
}

/**
 * Inverse of pad for local-only tests: reject if trailing dimensions are not
 * zero (proves the fixture space was not mixed with Bedrock vectors).
 */
export function unwrapPersistentSyntheticEmbedding(
  embedding: unknown,
  embeddingSpace: unknown,
): readonly number[] | typeof denied {
  if (embeddingSpace !== persistentSyntheticEmbeddingSpace) return denied;
  if (!finiteVector(embedding, persistentEmbeddingDimension)) return denied;
  for (let index = recallEmbeddingDimension; index < persistentEmbeddingDimension; index += 1)
    if ((embedding[index] ?? 0) !== 0) return denied;
  return Object.freeze(embedding.slice(0, recallEmbeddingDimension));
}
