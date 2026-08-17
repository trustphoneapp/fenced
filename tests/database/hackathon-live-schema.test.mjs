import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  hackathonLiveMigrationSha256,
  hackathonQuotaWindowMigrationSha256,
  verifyHackathonLiveSchema,
  verifyHackathonLiveSql,
  verifyHackathonQuotaWindowSql,
} from "../../scripts/verify-hackathon-live-schema.mjs";

describe("hackathon live migration", () => {
  it("preserves predecessors and proves the additive static contract", async () => {
    await expect(verifyHackathonLiveSchema()).resolves.toEqual({
      migration: "0009_hackathon_quota_window.sql",
      predecessors: 8,
    });
  });

  it("counts only sessions newer than 24 hours and keeps provider totals lifetime-bound", async () => {
    const predecessor = await readFile("database/migrations/0008_hackathon_live.sql", "utf8");
    const sql = await readFile("database/migrations/0009_hackathon_quota_window.sql", "utf8");
    expect(hackathonQuotaWindowMigrationSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(sql).toContain("WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'");
    expect(sql).not.toContain(
      "WHERE session.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'",
    );
    for (const aggregate of [
      "sum(usage.titan_count) FILTER (WHERE usage.audience = 'public')",
      "sum(usage.nova_count) FILTER (WHERE usage.audience = 'public')",
      "sum(usage.titan_count) FILTER (WHERE usage.audience = 'engineering')",
      "sum(usage.nova_count) FILTER (WHERE usage.audience = 'engineering')",
    ]) {
      expect(sql).toContain(aggregate);
      expect(predecessor).toContain(aggregate);
    }
    expect(sql.match(/INTERVAL '24 hours'/gu)).toHaveLength(1);
  });

  it("rejects an inclusive expiry boundary, lifetime session count, or provider-window drift", async () => {
    const predecessor = await readFile("database/migrations/0008_hackathon_live.sql", "utf8");
    const sql = await readFile("database/migrations/0009_hackathon_quota_window.sql", "utf8");
    for (const mutated of [
      sql.replace(
        "session.created_at > CURRENT_TIMESTAMP",
        "session.created_at >= CURRENT_TIMESTAMP",
      ),
      sql.replace(
        "count(session.tenant_id) FILTER (\n    WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'\n  )",
        "count(session.tenant_id)",
      ),
      sql.replace(
        "sum(usage.titan_count) FILTER (WHERE usage.audience = 'public')",
        "sum(usage.titan_count) FILTER (WHERE usage.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours')",
      ),
    ])
      expect(() => verifyHackathonQuotaWindowSql(mutated, predecessor)).toThrow();
  });

  it("keeps token material and MCP summaries separated", async () => {
    const sql = await readFile("database/migrations/0008_hackathon_live.sql", "utf8");
    expect(sql.indexOf("WHERE fact_status = 'retracted';")).toBeLessThan(
      sql.indexOf("CREATE UNIQUE INDEX memory_facts_one_active_revision"),
    );
    expect(sql).toContain("CREATE TABLE continuity.hackathon_session_tokens");
    expect(sql).not.toMatch(/SELECT \*/u);
    expect(sql).not.toMatch(
      /GRANT[^;]*(?:memory_facts|hackathon_session_tokens|hackathon_runtime_control)[^;]*TO zc_continuity_mcp_reader/iu,
    );
  });

  it("rejects every byte mutation, including authority widening", async () => {
    const sql = await readFile("database/migrations/0008_hackathon_live.sql", "utf8");
    expect(hackathonLiveMigrationSha256).toMatch(/^[0-9a-f]{64}$/u);
    for (const mutated of [
      sql.replace(
        "provider_enabled BOOL NOT NULL DEFAULT false",
        "provider_enabled BOOL NOT NULL DEFAULT true",
      ),
      `${sql}GRANT SELECT ON continuity.memory_facts TO PUBLIC;\n`,
      sql.replace("NOBYPASSRLS;", "BYPASSRLS;"),
      sql.replace("FORCE ROW LEVEL SECURITY", "ENABLE ROW LEVEL SECURITY"),
    ])
      expect(() => verifyHackathonLiveSql(mutated)).toThrow();
  });
});
