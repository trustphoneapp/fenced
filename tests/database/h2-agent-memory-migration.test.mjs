import { describe, expect, it } from "vitest";
import { verifyH2AgentMemory } from "../../scripts/verify-h2-agent-memory.mjs";

describe("h2 agent memory migration static gate", () => {
  it("accepts the design-only 0007 schema without database execution", async () => {
    await expect(verifyH2AgentMemory()).resolves.toMatchObject({
      migration: "0007_agent_memory.sql",
      tables: ["memory_facts", "disclosure_receipts", "memory_propagations"],
      claim: "STATIC_SCHEMA_ONLY_NO_DATABASE_EXECUTION",
    });
  });
});
