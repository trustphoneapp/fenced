/**
 * Presentation-only surface for main.tsx. It re-exports view helpers so the reviewed
 * `./api.js` import in main.tsx stays the exact four-name binding the boundary profile pins.
 */
export {
  answerSegments,
  type DiffToken,
  type Lineage,
  type ProofCounts,
  type Proofs,
  type Receipt,
  shortId,
  stepMeta,
  wordDiff,
} from "./api.js";
