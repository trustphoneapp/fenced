import { describe, expect, it } from "vitest";
import {
  migration0008TestContract as contract,
  Migration0008Error,
  runMigration0008,
  validateMigrationDatabaseUrl,
} from "../../scripts/h2-crdb-apply-0008.mjs";

const migrationUrl =
  "postgresql://continuity_migrator:synthetic-password@zc-demo.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";

const row = (fields, values) =>
  Object.fromEntries(fields.map((field, index) => [field, values[index]]));
const operatorPolicy = "synthetic_live_extra_scope";
const livePolicies = Object.freeze([...contract.prePolicies, operatorPolicy].sort());
const livePostPolicies = Object.freeze([...livePolicies, ...contract.addedPolicies].sort());

function fakeClient(initialState = "ready", mutate = (value) => value) {
  let state = initialState;
  const beforeApplied = () => state !== "applied";
  const calls = [];
  const client = {
    calls,
    async connect() {
      calls.push("CONNECT");
    },
    async end() {
      calls.push("END");
    },
    async query(sql) {
      calls.push(sql);
      if (
        sql.includes(
          "GRANT SELECT ON continuity.evidence_lineage_summary_v1 TO zc_continuity_mcp_reader",
        )
      ) {
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
      if (sql.includes("FROM information_schema.tables"))
        return {
          rows: mutate(
            (state === "applied" || state === "partial-27"
              ? contract.postTables
              : state === "partial-21"
                ? contract.partialTables
                : contract.preTables
            ).map((table_name) => ({ table_name })),
            "tables",
          ),
        };
      if (sql.includes("rolcanlogin")) {
        const roles =
          state === "ready"
            ? contract.preRoles
            : state === "partial-9"
              ? contract.partialRoles
              : contract.postRoles;
        return {
          rows: mutate(
            roles.map((values) =>
              row(["rolname", "rolcanlogin", "rolsuper", "rolbypassrls"], values),
            ),
            "roles",
          ),
        };
      }
      if (sql.includes("FROM pg_policies")) {
        const policies = beforeApplied() ? livePolicies : livePostPolicies;
        return {
          rows: mutate(
            policies.map((policyname) => ({ policyname })),
            `policies:${state}`,
          ),
        };
      }
      if (sql.includes("FROM information_schema.views")) {
        const views = beforeApplied() ? [] : contract.postViews;
        return {
          rows: mutate(
            views.map((table_name) => ({ table_name })),
            "views",
          ),
        };
      }
      if (sql.includes("FROM information_schema.routines"))
        return { rows: contract.routines.map((routine_name) => ({ routine_name })) };
      if (sql.includes("FROM information_schema.columns")) {
        const columns = state === "ready" ? contract.preColumns : contract.postColumns;
        return { rows: columns.map((column_name) => ({ column_name })) };
      }
      if (sql === "SHOW INDEXES FROM continuity.memory_facts") {
        const names = state === "ready" ? contract.preIndexes : contract.postIndexes;
        return {
          rows: mutate(
            [...names, "memory_facts_pkey"].map((index_name) => ({ index_name })),
            "indexes",
          ),
        };
      }
      if (sql.includes("FROM information_schema.table_constraints"))
        return {
          rows:
            state === "ready" ? [] : [{ constraint_name: "memory_propagations_effect_result_key" }],
        };
      if (sql.includes("FROM pg_auth_members")) {
        const memberships =
          state === "ready" || state === "partial-9"
            ? contract.preMemberships
            : contract.postMemberships;
        return { rows: memberships.map((values) => row(["role_name", "member_name"], values)) };
      }
      if (sql.includes("AS object_name, count(*)::INT8 AS row_count")) {
        const tables =
          state === "applied" || state === "partial-27"
            ? contract.postTables
            : state === "partial-21"
              ? contract.partialTables
              : contract.preTables;
        const counts =
          state === "applied" || state === "partial-27"
            ? contract.postCounts
            : state === "partial-21"
              ? contract.partialCounts
              : contract.preCounts;
        return {
          rows: mutate(
            tables.map((object_name) => ({
              object_name,
              row_count: String(counts[object_name]),
            })),
            `counts:${state}`,
          ),
        };
      }
      if (sql.includes("FROM continuity.hackathon_runtime_control"))
        return {
          rows: [
            {
              absolute_nova_cap: "300",
              absolute_titan_cap: "800",
              control_id: "live-v1",
              engineering_nova_cap: "100",
              engineering_titan_cap: "200",
              provider_enabled: false,
              public_nova_cap: "200",
              public_session_cap: "100",
              public_titan_cap: "600",
            },
          ],
        };
      if (sql.includes("FROM continuity.hackathon_quota_lock"))
        return { rows: [{ lock_id: "public-v1", lock_version: "0" }] };
      return { rows: [] };
    },
  };
  return client;
}

const run = (command, client) =>
  runMigration0008({
    command,
    createClient: () => client,
    environment: { COCKROACH_MIGRATION_DATABASE_URL: migrationUrl },
  });

describe("bounded CockroachDB migration 0008 operator", () => {
  it("requires the exact Cloud, defaultdb, credential, and verify-full URL shape", () => {
    expect(validateMigrationDatabaseUrl({ COCKROACH_MIGRATION_DATABASE_URL: migrationUrl })).toBe(
      migrationUrl,
    );
    for (const rejected of [
      "",
      migrationUrl.replace(".cockroachlabs.cloud", ".example.invalid"),
      migrationUrl.replace("/defaultdb", "/otherdb"),
      migrationUrl.replace("verify-full", "verify-ca"),
      migrationUrl.replace("continuity_migrator:synthetic-password@", ""),
      migrationUrl.replace("continuity_migrator", "other_admin"),
      migrationUrl.replace(":26257", ""),
      `${migrationUrl}&application_name=operator`,
      `${migrationUrl}#fragment`,
      ` ${migrationUrl}`,
    ])
      expect(() =>
        validateMigrationDatabaseUrl({ COCKROACH_MIGRATION_DATABASE_URL: rejected }),
      ).toThrowError(expect.objectContaining({ code: "DATABASE_URL_REJECTED" }));
  });

  it("keeps status read-only and rejects a partial or drifted prestate", async () => {
    const ready = fakeClient();
    await expect(run("--status", ready)).resolves.toMatchObject({ state: "ready" });
    expect(ready.calls).toContain("SET TRANSACTION READ ONLY");
    expect(
      ready.calls.some(
        (sql) =>
          typeof sql === "string" &&
          sql.includes("CREATE TABLE continuity.hackathon_runtime_control"),
      ),
    ).toBe(false);

    const drifted = fakeClient("ready", (rows, kind) =>
      kind === "policies:ready" ? rows.slice(1) : rows,
    );
    await expect(run("--preflight", drifted)).rejects.toEqual(
      expect.objectContaining({ code: "SCHEMA_STATE_REJECTED" }),
    );
    expect(drifted.calls).toContain("ROLLBACK");

    const extraIndex = fakeClient("ready", (rows, kind) =>
      kind === "indexes" ? [...rows, { index_name: "unexpected_index" }] : rows,
    );
    await expect(run("--preflight", extraIndex)).rejects.toEqual(
      expect.objectContaining({ code: "SCHEMA_STATE_REJECTED" }),
    );

    const wrongIdentity = fakeClient("ready", (rows, kind) =>
      kind === "identity" ? [{ ...rows[0], sql_user: "other_admin" }] : rows,
    );
    await expect(run("--status", wrongIdentity)).rejects.toEqual(
      expect.objectContaining({ code: "MIGRATION_IDENTITY_REJECTED" }),
    );
  });

  it("applies the pinned body exactly once and verifies the disabled content-free poststate", async () => {
    const client = fakeClient();
    await expect(run("--apply", client)).resolves.toEqual({
      bytes: 34_968,
      database: "defaultdb",
      migration: "0008_hackathon_live.sql",
      mode: "0644",
      providerEnabled: false,
      sha256: "31507420bda0efc37ec8cbe5d9ff9ef9dd707878b3555102c0510af966d5bd32",
      state: "applied",
    });
    const migrationCalls = client.calls.filter(
      (sql) => typeof sql === "string" && sql.trimEnd().endsWith(";"),
    );
    expect(migrationCalls).toHaveLength(145);
    expect(client.calls.filter((sql) => sql === "BEGIN" || sql === "COMMIT")).toHaveLength(0);
    expect(migrationCalls.join("\n")).not.toMatch(
      /NOLOGIN|NOINHERIT|NOSUPERUSER|NOCREATEROLE|NOCREATEDB/u,
    );
    expect(
      migrationCalls.join("\n").match(/CREATE ROLE zc_continuity_[a-z_]+ WITH NOBYPASSRLS;/gu),
    ).toHaveLength(5);
    expect(migrationCalls.join("\n")).not.toContain("array_fill");
    expect(migrationCalls.join("\n")).not.toMatch(/(?:titan|nova)_count DECIMAL/u);
    expect(migrationCalls.join("\n").match(/(?:titan|nova)_count INT8 NOT NULL/gu)).toHaveLength(4);
    const zeroVector = /SET embedding = '\[([0,]+)\]'::vector/u.exec(migrationCalls[0]);
    expect(zeroVector?.[1].split(",")).toHaveLength(1_024);
    expect(new Set(zeroVector?.[1].split(","))).toEqual(new Set(["0"]));

    const partial9 = fakeClient("partial-9");
    await expect(run("--apply", partial9)).resolves.toMatchObject({ state: "applied" });
    expect(partial9.calls.some((sql) => String(sql).includes("ADD COLUMN deletion_fence"))).toBe(
      false,
    );
    expect(partial9.calls).not.toContain(
      "CREATE ROLE zc_continuity_mcp_view_owner WITH NOBYPASSRLS;",
    );
    expect(partial9.calls).toContain("CREATE ROLE zc_continuity_mcp_reader WITH NOBYPASSRLS;");

    const partial21 = fakeClient("partial-21");
    await expect(run("--apply", partial21)).resolves.toMatchObject({ state: "applied" });
    expect(partial21.calls.some((sql) => String(sql).includes("hackathon_session_tokens ("))).toBe(
      false,
    );
    expect(
      partial21.calls.some((sql) =>
        String(sql).includes("CREATE TABLE continuity.hackathon_provider_reservations"),
      ),
    ).toBe(true);

    const partial27 = fakeClient("partial-27");
    await expect(run("--apply", partial27)).resolves.toMatchObject({ state: "applied" });
    expect(partial27.calls.some((sql) => String(sql).includes("CREATE TABLE"))).toBe(false);
    expect(partial27.calls).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE continuity.hackathon_runtime_control FROM PUBLIC;",
    );

    const changedPredecessorCount = fakeClient("ready", (rows, kind) => {
      if (kind !== "counts:applied") return rows;
      return rows.map((entry) =>
        entry.object_name === "memory_facts"
          ? { ...entry, row_count: String(Number(entry.row_count) + 1) }
          : entry,
      );
    });
    await expect(run("--apply", changedPredecessorCount)).rejects.toEqual(
      expect.objectContaining({ code: "CONTENT_STATE_REJECTED" }),
    );
    expect(changedPredecessorCount.calls).not.toContain("ROLLBACK");

    const alreadyApplied = fakeClient("applied");
    await expect(run("--apply", alreadyApplied)).rejects.toBeInstanceOf(Migration0008Error);
    expect(
      alreadyApplied.calls.some(
        (sql) =>
          typeof sql === "string" &&
          sql.includes("CREATE TABLE continuity.hackathon_runtime_control"),
      ),
    ).toBe(false);
  });
});
