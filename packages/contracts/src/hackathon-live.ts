import { ownDataKeys, readOwnData } from "@zintus-continuity/foundation/safe-data-access";

export const hackathonLiveSteps = Object.freeze([
  "start",
  "ask_before",
  "correct",
  "ask_after",
  "latest_receipt",
] as const);

export type HackathonLiveStep = (typeof hackathonLiveSteps)[number];

export const hackathonLiveLimits = Object.freeze({
  sessionSeconds: 86_400,
  publicSessions: 100,
  public: Object.freeze({ titan: 600, nova: 200 }),
  engineeringReserve: Object.freeze({ titan: 200, nova: 100 }),
  absolute: Object.freeze({ titan: 800, nova: 300 }),
});

export const hackathonLiveProviderAllowances = Object.freeze({
  start: Object.freeze({ titan: 3, nova: 0 }),
  ask_before: Object.freeze({ titan: 1, nova: 1 }),
  correct: Object.freeze({ titan: 1, nova: 0 }),
  ask_after: Object.freeze({ titan: 1, nova: 1 }),
  latest_receipt: Object.freeze({ titan: 0, nova: 0 }),
}) satisfies Readonly<Record<HackathonLiveStep, Readonly<{ titan: number; nova: number }>>>;

export type HackathonLiveStepObject = Readonly<{ step: HackathonLiveStep }>;

export function parseHackathonLiveStep(value: unknown): HackathonLiveStepObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("hackathon live step must be an object");
  }

  const keys = ownDataKeys(value);
  if (keys.length !== 1 || keys[0] !== "step") {
    throw new TypeError("hackathon live step must contain exactly step");
  }

  const step = readOwnData(value, "step");
  if (typeof step !== "string" || !hackathonLiveSteps.includes(step as HackathonLiveStep)) {
    throw new TypeError("hackathon live step is not allowed");
  }

  return Object.freeze({ step: step as HackathonLiveStep });
}

export function isMonotonicHackathonLiveTransition(
  from: HackathonLiveStep,
  to: HackathonLiveStep,
): boolean {
  const fromIndex = hackathonLiveSteps.indexOf(from);
  const toIndex = hackathonLiveSteps.indexOf(to);
  return fromIndex >= 0 && (toIndex === fromIndex || toIndex === fromIndex + 1);
}
