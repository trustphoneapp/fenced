import { describe, expect, it } from "vitest";
// biome-ignore lint/suspicious/noTsIgnore: TypeScript does not consistently report this JSON import.
// @ts-ignore -- The exact policy JSON is intentionally outside tsconfig.tools include.
import policy from "../../ci/b03-policy.json" with { type: "json" };

describe("H01 source-security baseline", () => {
  it("binds the four C06 paths to exactly thirteen capability pairs", () => {
    expect(
      [
        policy.sourceSecurity.capabilityAllowlists.child_process.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.computed_data_access.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.implicit_data_access.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_import.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_code.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.filesystem.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.network.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.process_env.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.unsupported_authority.includes(
          "packages/adapters-local/src/local-c06-event-repository.ts",
        ),
      ],
      "packages/adapters-local/src/local-c06-event-repository.ts",
    ).toEqual([false, true, true, false, false, false, false, false, true]);

    expect(
      [
        policy.sourceSecurity.capabilityAllowlists.child_process.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.computed_data_access.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.implicit_data_access.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_import.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_code.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.filesystem.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.network.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.process_env.includes(
          "packages/application/src/event-ledger.ts",
        ),
        policy.sourceSecurity.capabilityAllowlists.unsupported_authority.includes(
          "packages/application/src/event-ledger.ts",
        ),
      ],
      "packages/application/src/event-ledger.ts",
    ).toEqual([false, true, true, false, false, false, false, false, true]);

    expect(
      [
        policy.sourceSecurity.capabilityAllowlists.child_process.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.computed_data_access.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.implicit_data_access.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_import.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_code.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.filesystem.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.network.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.process_env.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.unsupported_authority.includes(
          "scripts/verify-c06-event-ledger.mjs",
        ),
      ],
      "scripts/verify-c06-event-ledger.mjs",
    ).toEqual([false, false, true, false, false, true, false, false, false]);

    expect(
      [
        policy.sourceSecurity.capabilityAllowlists.child_process.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.computed_data_access.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.implicit_data_access.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_import.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.dynamic_code.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.filesystem.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.network.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.process_env.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
        policy.sourceSecurity.capabilityAllowlists.unsupported_authority.includes(
          "tests/database/c06-event-ledger.test.mjs",
        ),
      ],
      "tests/database/c06-event-ledger.test.mjs",
    ).toEqual([false, true, true, false, true, true, false, false, true]);
  });
});
