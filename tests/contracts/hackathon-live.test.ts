import { describe, expect, it } from "vitest";
import {
  hackathonLiveLimits,
  hackathonLiveProviderAllowances,
  hackathonLiveSteps,
  isMonotonicHackathonLiveTransition,
  parseHackathonLiveStep,
} from "../../packages/contracts/src/hackathon-live.js";

describe("hackathon live contract", () => {
  it("defines the exact ordered live steps", () => {
    expect(hackathonLiveSteps).toEqual([
      "start",
      "ask_before",
      "correct",
      "ask_after",
      "latest_receipt",
    ]);
    expect(Object.isFrozen(hackathonLiveSteps)).toBe(true);
  });

  it("defines frozen session and provider limits", () => {
    expect(hackathonLiveLimits).toEqual({
      sessionSeconds: 86_400,
      publicSessions: 100,
      public: { titan: 600, nova: 200 },
      engineeringReserve: { titan: 200, nova: 100 },
      absolute: { titan: 800, nova: 300 },
    });
    expect(Object.isFrozen(hackathonLiveLimits)).toBe(true);
    expect(Object.isFrozen(hackathonLiveLimits.public)).toBe(true);
    expect(Object.isFrozen(hackathonLiveLimits.engineeringReserve)).toBe(true);
    expect(Object.isFrozen(hackathonLiveLimits.absolute)).toBe(true);

    expect(hackathonLiveProviderAllowances).toEqual({
      start: { titan: 3, nova: 0 },
      ask_before: { titan: 1, nova: 1 },
      correct: { titan: 1, nova: 0 },
      ask_after: { titan: 1, nova: 1 },
      latest_receipt: { titan: 0, nova: 0 },
      // The repeatable read-only side step inspects the catalog and a plan; it never calls a provider.
      proofs: { titan: 0, nova: 0 },
    });
    expect(Object.isFrozen(hackathonLiveProviderAllowances)).toBe(true);
    for (const allowance of Object.values(hackathonLiveProviderAllowances)) {
      expect(Object.isFrozen(allowance)).toBe(true);
    }
  });

  it("parses and freezes every allowlisted exact step object", () => {
    for (const step of hackathonLiveSteps) {
      const parsed = parseHackathonLiveStep({ step });
      expect(parsed).toEqual({ step });
      expect(Object.isFrozen(parsed)).toBe(true);
    }
  });

  it("fails closed for invalid step objects", () => {
    const withAccessor = Object.defineProperty({}, "step", {
      enumerable: true,
      get: () => "start",
    });
    const withSymbol = { step: "start", [Symbol("extra")]: true };

    for (const value of [
      null,
      [],
      {},
      { step: "start", extra: true },
      { step: 1 },
      { step: "unknown" },
      withAccessor,
      withSymbol,
      () => ({ step: "start" }),
    ]) {
      expect(() => parseHackathonLiveStep(value)).toThrow();
    }
  });

  it("allows exact retry and immediate forward transition only", () => {
    for (const [from, current] of hackathonLiveSteps.entries()) {
      for (const [to, next] of hackathonLiveSteps.entries()) {
        expect(isMonotonicHackathonLiveTransition(current, next)).toBe(
          to === from || to === from + 1,
        );
      }
    }
  });
});
