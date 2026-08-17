import { describe, expect, it } from "vitest";
import {
  classifyQuotaViewDefinition,
  migration0009TestContract as contract,
  Migration0009Error,
  runMigration0009,
} from "../../scripts/h2-crdb-apply-0009.mjs";

const migrationUrl =
  "postgresql://continuity_migrator:synthetic-password@zc-demo.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";
const providerColumns = `coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8 AS public_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8 AS public_nova,
  coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8 AS engineering_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8 AS engineering_nova`;
const viewTail = `FROM continuity.hackathon_session_usage AS session
FULL OUTER JOIN continuity.hackathon_provider_usage AS usage ON false`;
const oldDefinition = `SELECT count(session.tenant_id)::INT8 AS public_sessions,
  ${providerColumns}
${viewTail}`;
const newDefinition = `SELECT count(session.tenant_id) FILTER (
  WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
)::INT8 AS public_sessions,
  ${providerColumns}
${viewTail}`;

const baseMetrics = Object.freeze({
  engineering_nova: "4",
  engineering_titan: "8",
  provider_rows: "13",
  public_nova: "5",
  public_titan: "12",
  session_rows: "7",
});

function fakeClient(initialState = "ready", mutate = (rows) => rows) {
  let state = initialState;
  const calls = [];
  return {
    calls,
    async connect() {
      calls.push("CONNECT");
    },
    async end() {
      calls.push("END");
    },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("CREATE OR REPLACE VIEW continuity.hackathon_usage_summary_v1")) {
        state = "applied";
        return { rows: [] };
      }
      if (sql.includes("current_database() AS database_name"))
        return {
          rows: mutate(
            [
              {
                database_name: "defaultdb",
                sql_user: "continuity_migrator",
                sql_user_is_admin: true,
              },
            ],
            "identity",
          ),
        };
      if (sql.includes("view_definition FROM information_schema.views"))
        return {
          rows: mutate(
            [{ view_definition: state === "ready" ? oldDefinition : newDefinition }],
            `definition:${state}`,
          ),
        };
      if (sql.includes("owner.rolname AS owner_name"))
        return {
          rows: mutate([{ owner_name: "zc_continuity_quota_view_owner" }], `owner:${state}`),
        };
      if (sql.includes("FROM information_schema.table_privileges"))
        return {
          rows: mutate(
            contract.expectedGrants.map(([grantee, privilege_type, is_grantable]) => ({
              grantee,
              is_grantable,
              privilege_type,
            })),
            `grants:${state}`,
          ),
        };
      if (sql.includes("table_name IN ('hackathon_provider_usage'"))
        return {
          rows: mutate(
            contract.expectedColumns.map(([table_name, column_name]) => ({
              column_name,
              table_name,
            })),
            `columns:${state}`,
          ),
        };
      if (sql.includes("table_name = 'hackathon_usage_summary_v1'"))
        return {
          rows: mutate(
            contract.expectedViewColumns.map((column_name) => ({ column_name })),
            `viewColumns:${state}`,
          ),
        };
      if (sql.includes("AS session_rows"))
        return { rows: mutate([{ ...baseMetrics }], `metrics:${state}`) };
      return { rows: [] };
    },
  };
}

const run = (command, client, url = migrationUrl) =>
  runMigration0009({
    command,
    createClient: () => client,
    environment: { COCKROACH_MIGRATION_DATABASE_URL: url },
  });

describe("bounded CockroachDB migration 0009 operator", () => {
  it("classifies only the old lifetime or strict rolling view definitions", () => {
    expect(classifyQuotaViewDefinition(oldDefinition)).toBe("ready");
    expect(
      classifyQuotaViewDefinition(
        oldDefinition
          .replaceAll("continuity.", "defaultdb.continuity.")
          .replace("FULL OUTER JOIN", "FULL JOIN"),
      ),
    ).toBe("ready");
    expect(classifyQuotaViewDefinition(newDefinition)).toBe("applied");
    expect(
      classifyQuotaViewDefinition(
        newDefinition
          .replaceAll("::INT8", ":::INT8")
          .replace(
            "CURRENT_TIMESTAMP - INTERVAL '24 hours'",
            "(current_timestamp() - '24:00:00':::INTERVAL)",
          )
          .replaceAll("'public'", "'public':::STRING")
          .replace("ON false", "ON false:::BOOL"),
      ),
    ).toBe("applied");
    expect(
      classifyQuotaViewDefinition(
        newDefinition
          .replace(
            "CURRENT_TIMESTAMP - INTERVAL '24 hours'",
            "(current_timestamp():::TIMESTAMPTZ - '24:00:00':::INTERVAL)",
          )
          .replaceAll("continuity.", "defaultdb.continuity.")
          .replace("FULL OUTER JOIN", "FULL JOIN"),
      ),
    ).toBe("applied");
    expect(
      classifyQuotaViewDefinition(
        newDefinition
          .replace("FILTER (\n  WHERE", "FILTER (WHERE")
          .replace(")\n)::INT8 AS public_sessions", ")::INT8 AS public_sessions"),
      ),
    ).toBe("applied");
    for (const drifted of [
      newDefinition.replace("session.created_at >", "session.created_at >="),
      newDefinition.replace(
        "usage.audience = 'public'",
        "usage.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'",
      ),
      oldDefinition.replace("count(session.tenant_id)", "count(DISTINCT session.tenant_id)"),
      oldDefinition.replace("count(session.tenant_id)::INT8", "count(session.tenant_id)::INT8 + 1"),
      oldDefinition.replace(
        "count(session.tenant_id)::INT8",
        "count(session.tenant_id)::INT8 + (SELECT 0)",
      ),
      newDefinition.replace(")::INT8 AS public_sessions", ")::INT8 + 1 AS public_sessions"),
      newDefinition.replace(
        ")::INT8 AS public_sessions",
        ")::INT8 + (SELECT 0) AS public_sessions",
      ),
      newDefinition.replace("'public'", "'defaultdb.public'"),
      newDefinition.replace("'public'", "'public:::STRING'"),
    ])
      expect(() => classifyQuotaViewDefinition(drifted)).toThrowError(
        expect.objectContaining({ code: "VIEW_DEFINITION_REJECTED" }),
      );
  });

  it("keeps status read-only, proves both states, and rejects invalid credentials", async () => {
    const ready = fakeClient();
    await expect(run("--status", ready)).resolves.toMatchObject({ state: "ready" });
    expect(ready.calls).toContain("SET TRANSACTION READ ONLY");
    expect(ready.calls).toContain("COMMIT");
    expect(
      ready.calls.some((call) =>
        call.includes("grantee NOT IN ('zc_continuity_quota_view_owner', 'admin', 'root')"),
      ),
    ).toBe(true);

    const applied = fakeClient("applied");
    await expect(run("--status", applied)).resolves.toMatchObject({ state: "applied" });

    const preflight = fakeClient();
    await expect(run("--preflight", preflight)).resolves.toMatchObject({ state: "ready" });
    await expect(run("--preflight", fakeClient("applied"))).rejects.toEqual(
      expect.objectContaining({ code: "MIGRATION_ALREADY_APPLIED" }),
    );

    await expect(
      run("--status", fakeClient(), migrationUrl.replace("verify-full", "verify-ca")),
    ).rejects.toEqual(expect.objectContaining({ code: "DATABASE_URL_REJECTED" }));
  });

  it("applies the exact body without promising DDL rollback and preserves rows and provider totals", async () => {
    const client = fakeClient();
    await expect(run("--apply", client)).resolves.toEqual({
      bytes: 1_075,
      database: "defaultdb",
      migration: "0009_hackathon_quota_window.sql",
      predecessorSha256: "31507420bda0efc37ec8cbe5d9ff9ef9dd707878b3555102c0510af966d5bd32",
      sha256: "41b126b4ea0ccd5d42a9e6146f12885ac63edd5062bf27908de82046bba11d79",
      state: "applied",
    });
    expect(client.calls).not.toContain("BEGIN");
    expect(client.calls).not.toContain("COMMIT");
    expect(client.calls).not.toContain("ROLLBACK");
    expect(client.calls).not.toContain("SET TRANSACTION READ ONLY");
    const bodies = client.calls.filter(
      (call) =>
        typeof call === "string" &&
        call.startsWith("CREATE OR REPLACE VIEW continuity.hackathon_usage_summary_v1"),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/(?:^|\n)(?:BEGIN|COMMIT);/u);
    expect(bodies[0]).toContain("ALTER VIEW continuity.hackathon_usage_summary_v1 OWNER TO");
    expect(bodies[0]).toContain("REVOKE ALL PRIVILEGES");
    expect(bodies[0]).toContain("GRANT SELECT");
  });

  it("fails closed on applied, partial, grant, column, owner, and post-content drift", async () => {
    const alreadyApplied = fakeClient("applied");
    await expect(run("--apply", alreadyApplied)).rejects.toBeInstanceOf(Migration0009Error);
    expect(
      alreadyApplied.calls.some(
        (call) => typeof call === "string" && call.startsWith("CREATE OR REPLACE VIEW continuity."),
      ),
    ).toBe(false);
    expect(alreadyApplied.calls).not.toContain("ROLLBACK");

    for (const [kind, mutate] of [
      [
        "definition:ready",
        (rows, current) =>
          current === "definition:ready"
            ? [{ view_definition: oldDefinition.replace("count(session.tenant_id)", "count(*)") }]
            : rows,
      ],
      [
        "owner:ready",
        (rows, current) =>
          current === "owner:ready" ? [{ owner_name: "continuity_migrator" }] : rows,
      ],
      [
        "grants:ready",
        (rows, current) =>
          current === "grants:ready"
            ? [...rows, { grantee: "PUBLIC", is_grantable: "NO", privilege_type: "SELECT" }]
            : rows,
      ],
      ["columns:ready", (rows, current) => (current === "columns:ready" ? rows.slice(1) : rows)],
      [
        "metrics:applied",
        (rows, current) =>
          current === "metrics:applied"
            ? [{ ...rows[0], public_titan: String(Number(rows[0].public_titan) + 1) }]
            : rows,
      ],
    ]) {
      const client = fakeClient("ready", mutate);
      const result = expect(run("--apply", client), kind).rejects;
      if (kind === "metrics:applied")
        await result.toEqual(expect.objectContaining({ code: "MIGRATION_APPLY_UNCERTAIN" }));
      else await result.toBeInstanceOf(Migration0009Error);
      expect(client.calls, kind).not.toContain("ROLLBACK");
    }
  });
});
