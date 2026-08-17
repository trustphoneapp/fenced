import { describe, expect, it } from "vitest";
import {
  LiveAttestError,
  liveAttestTestContract,
  runLiveAttest,
} from "../../scripts/h2-crdb-live-attest.mjs";

const migrationUrl =
  "postgresql://continuity_migrator:synthetic-password@zc-demo.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";
const providerColumns = `coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8 AS public_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'public'), 0)::INT8 AS public_nova,
  coalesce(sum(usage.titan_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8 AS engineering_titan,
  coalesce(sum(usage.nova_count) FILTER (WHERE usage.audience = 'engineering'), 0)::INT8 AS engineering_nova`;
const appliedDefinition = `SELECT count(session.tenant_id) FILTER (
  WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
)::INT8 AS public_sessions,
  ${providerColumns}
FROM continuity.hackathon_session_usage AS session
FULL OUTER JOIN continuity.hackathon_provider_usage AS usage ON false`;
const readyDefinition = appliedDefinition.replace(
  `count(session.tenant_id) FILTER (
  WHERE session.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
)`,
  "count(session.tenant_id)",
);
const clone = (value) => structuredClone(value);

function catalog(overrides = {}) {
  return {
    columns: clone(liveAttestTestContract.columns),
    forbidden: [],
    memberships: clone(liveAttestTestContract.memberships),
    policies: liveAttestTestContract.policies.map((entry) => ({
      cmd: entry.command,
      permissive: entry.permissive,
      policyname: entry.name,
      qual: entry.qualifier,
      roles: [...entry.roles],
      schemaname: entry.schema,
      tablename: entry.table,
      with_check: entry.check,
    })),
    quotaDefinition: appliedDefinition,
    rls: clone(liveAttestTestContract.rls),
    roles: clone(liveAttestTestContract.roles),
    schemaGrants: clone(liveAttestTestContract.schemaGrants),
    tableGrants: clone(liveAttestTestContract.tableGrants),
    version: "v25.2.3",
    viewOwners: clone(liveAttestTestContract.viewOwners),
    ...overrides,
  };
}

function fakeClient(overrides = {}) {
  const state = catalog(overrides);
  const calls = [];
  return {
    calls,
    async connect() {
      calls.push("CONNECT");
      if (state.connectError) throw new Error("sensitive connect detail");
    },
    async end() {
      calls.push("END");
    },
    async query(sql) {
      calls.push(sql);
      if (state.errorAt && String(sql).includes(state.errorAt))
        throw new Error("sensitive catalog detail");
      if (sql.includes("node_executable_version"))
        return {
          rows: [
            {
              database_name: state.database ?? "defaultdb",
              server_version: state.version,
              sql_user: state.user ?? "continuity_migrator",
              sql_user_is_admin: state.admin ?? true,
            },
          ],
        };
      if (sql.includes("FROM pg_roles WHERE rolname")) return { rows: state.roles };
      if (sql.includes("FROM pg_auth_members")) return { rows: state.memberships };
      if (sql.includes("relrowsecurity AS rls_enabled")) return { rows: state.rls };
      if (sql.includes("FROM pg_policies")) return { rows: state.policies };
      if (sql.includes("FROM information_schema.table_privileges WHERE"))
        return { rows: state.tableGrants };
      if (sql.includes("FROM information_schema.schema_privileges"))
        return { rows: state.schemaGrants };
      if (sql.includes("FROM information_schema.table_privileges AS privileges"))
        return { rows: state.forbidden };
      if (sql.includes("relation.relname AS view_name")) return { rows: state.viewOwners };
      if (sql.includes("table_name AS view_name")) return { rows: state.columns };
      if (sql.includes("view_definition FROM information_schema.views"))
        return { rows: [{ view_definition: state.quotaDefinition }] };
      return { rows: [] };
    },
  };
}

const run = (client, arguments_ = ["--status"], url = migrationUrl) =>
  runLiveAttest({
    arguments_,
    createClient: (options) => {
      client.options = options;
      return client;
    },
    environment: { COCKROACH_MIGRATION_DATABASE_URL: url },
  });

describe("bounded live CockroachDB attestation", () => {
  it("accepts only exact status and the strict migrator URL", async () => {
    for (const arguments_ of [[], ["--status", "extra"], ["--apply"], ["--enable"]])
      await expect(run(fakeClient(), arguments_)).rejects.toEqual(
        expect.objectContaining({ code: "USAGE_REJECTED" }),
      );
    await expect(
      run(fakeClient(), ["--status"], migrationUrl.replace("verify-full", "verify-ca")),
    ).rejects.toEqual(expect.objectContaining({ code: "DATABASE_URL_REJECTED" }));
  });

  it("returns only bounded counts and a catalog digest from one read-only transaction", async () => {
    const client = fakeClient();
    const result = await run(client);
    expect(result).toEqual({
      catalogSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      database: "defaultdb",
      forceRlsTables: 10,
      grants: 51,
      memberships: 3,
      policies: 32,
      roles: 1,
      serverVersion: "v25.2.3",
      views: 4,
    });
    expect(Object.keys(result)).toEqual([
      "database",
      "serverVersion",
      "roles",
      "memberships",
      "forceRlsTables",
      "policies",
      "grants",
      "views",
      "catalogSha256",
    ]);
    expect(client.options).toEqual({
      connectionString: migrationUrl,
      connectionTimeoutMillis: 15_000,
    });
    expect(client.calls.filter((call) => call === "BEGIN")).toHaveLength(1);
    expect(client.calls.filter((call) => call === "SET TRANSACTION READ ONLY")).toHaveLength(1);
    expect(client.calls.filter((call) => call === "COMMIT")).toHaveLength(1);
    expect(client.calls.some((call) => /SELECT\s+\*/u.test(String(call)))).toBe(false);
    const rlsQuery = client.calls.find((call) => String(call).includes("relrowsecurity"));
    expect(String(rlsQuery).match(/ON namespace\.oid = relation\.relnamespace/gu)).toHaveLength(1);
    const tableGrantQuery = client.calls.find((call) =>
      String(call).includes("FROM information_schema.table_privileges WHERE"),
    );
    const schemaGrantQuery = client.calls.find((call) =>
      String(call).includes("FROM information_schema.schema_privileges"),
    );
    expect(String(tableGrantQuery)).not.toMatch(/\bgrantee\s+IN\b/iu);
    expect(String(schemaGrantQuery)).not.toMatch(/\bgrantee\s+IN\b/iu);
    expect(String(tableGrantQuery)).toContain("'evidence_lineage_summary_v1'");
  });

  it("rejects identity and non-public or unbounded server versions", async () => {
    for (const [options, code] of [
      [{ user: "root" }, "MIGRATION_IDENTITY_REJECTED"],
      [{ admin: false }, "MIGRATION_IDENTITY_REJECTED"],
      [{ version: "CockroachDB CCL v25.2.3 sensitive build" }, "SERVER_VERSION_REJECTED"],
      [{ version: `v25.2.3-${"x".repeat(40)}` }, "SERVER_VERSION_REJECTED"],
    ])
      await expect(run(fakeClient(options))).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("rejects role-option, membership, and RLS/FORCE drift", async () => {
    const membershipDrift = clone(liveAttestTestContract.memberships).slice(1);
    const rlsDrift = clone(liveAttestTestContract.rls);
    rlsDrift.find((row) => row.table_name === "hackathon_sessions").rls_forced = false;
    const rlsDisabled = clone(liveAttestTestContract.rls);
    rlsDisabled.find((row) => row.table_name === "hackathon_sessions").rls_enabled = false;
    const extraRls = clone(liveAttestTestContract.rls);
    extraRls.push({ rls_enabled: true, rls_forced: true, table_name: "hackathon_extra" });
    const roleDrifts = [
      ["rolcanlogin", false],
      ["rolsuper", true],
      ["rolbypassrls", true],
      ["rolcreaterole", true],
      ["rolcreatedb", true],
    ].map(([field, value]) => {
      const rows = clone(liveAttestTestContract.roles);
      rows[0][field] = value;
      return { roles: rows };
    });
    for (const options of [
      ...roleDrifts,
      { memberships: membershipDrift },
      { rls: rlsDrift },
      { rls: rlsDisabled },
      { rls: extraRls },
    ])
      await expect(run(fakeClient(options))).rejects.toEqual(
        expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }),
      );
  });

  it("rejects policy command, role, qualifier, and WITH CHECK drift", async () => {
    const base = catalog().policies;
    const mcpReservation = base.find(
      (row) => row.policyname === "hackathon_reservations_mcp_scope",
    );
    expect(mcpReservation).toEqual({
      cmd: "SELECT",
      permissive: "PERMISSIVE",
      policyname: "hackathon_reservations_mcp_scope",
      qual: `tenant_id = current_setting('continuity.tenant_id', true)
  AND server_purpose = current_setting('continuity.server_purpose', true)`,
      roles: ["zc_continuity_mcp_view_owner"],
      schemaname: "continuity",
      tablename: "hackathon_provider_reservations",
      with_check: null,
    });
    for (const row of base) {
      expect(row.schemaname).toBe("continuity");
      expect(row.tablename).toMatch(/^(?:tenants|hackathon_[a-z_]+)$/u);
      expect(row.policyname).toMatch(/^[a-z][a-z0-9_]+$/u);
      expect(["SELECT", "INSERT"]).toContain(row.cmd);
      expect(row.roles.length).toBeGreaterThan(0);
      expect(row.roles.every((role) => /^zc_continuity_[a-z_]+$/u.test(role))).toBe(true);
      expect(row.cmd === "SELECT" ? row.qual : row.with_check).not.toBeNull();
      expect(row.cmd === "SELECT" ? row.with_check : row.qual).toBeNull();
    }
    const command = clone(base);
    command[0].cmd = "UPDATE";
    const roles = clone(base);
    roles[0].roles = ["PUBLIC"];
    const qualifier = clone(base);
    const qualifierIndex = qualifier.findIndex((row) => row.qual !== null);
    qualifier[qualifierIndex].qual = `${qualifier[qualifierIndex].qual} AND true`;
    const check = clone(base);
    const checkIndex = check.findIndex((row) => row.with_check !== null);
    check[checkIndex].with_check = `${check[checkIndex].with_check} AND true`;
    for (const policies of [command, roles, qualifier, check])
      await expect(run(fakeClient({ policies }))).rejects.toEqual(
        expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }),
      );
  });

  it("rejects grant additions and direct app/PUBLIC base-table authority", async () => {
    const grants = clone(liveAttestTestContract.tableGrants);
    grants.push({
      grantee: "zc_continuity_mcp_reader",
      is_grantable: "NO",
      privilege_type: "SELECT",
      table_name: "hackathon_sessions",
    });
    await expect(run(fakeClient({ tableGrants: grants }))).rejects.toEqual(
      expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }),
    );
    await expect(
      run(fakeClient({ tableGrants: clone(liveAttestTestContract.tableGrants).slice(1) })),
    ).rejects.toEqual(expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }));
    const directViewGrant = clone(liveAttestTestContract.tableGrants);
    directViewGrant.push({
      grantee: "continuity_app",
      is_grantable: "NO",
      privilege_type: "SELECT",
      table_name: "receipt_summary_v1",
    });
    await expect(run(fakeClient({ tableGrants: directViewGrant }))).rejects.toEqual(
      expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }),
    );
    const unknownTableRole = clone(liveAttestTestContract.tableGrants);
    unknownTableRole.push({
      grantee: "unexpected_role",
      is_grantable: "NO",
      privilege_type: "SELECT",
      table_name: "hackathon_sessions",
    });
    await expect(run(fakeClient({ tableGrants: unknownTableRole }))).rejects.toEqual(
      expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }),
    );
    const unknownSchemaRole = clone(liveAttestTestContract.schemaGrants);
    unknownSchemaRole.push({
      grantee: "unexpected_role",
      is_grantable: "NO",
      privilege_type: "USAGE",
    });
    await expect(run(fakeClient({ schemaGrants: unknownSchemaRole }))).rejects.toEqual(
      expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }),
    );
    await expect(
      run(
        fakeClient({
          forbidden: [
            {
              grantee: "continuity_app",
              privilege_type: "SELECT",
              table_name: "hackathon_sessions",
            },
          ],
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "CATALOG_STATE_REJECTED" }));
  });

  it("rejects MCP view owner/column drift and a non-0009 quota definition", async () => {
    const owners = clone(liveAttestTestContract.viewOwners);
    owners[0].owner_name = "continuity_app";
    const columns = clone(liveAttestTestContract.columns).slice(1);
    for (const options of [
      { viewOwners: owners },
      { columns },
      { quotaDefinition: readyDefinition },
    ])
      await expect(run(fakeClient(options))).rejects.toEqual(
        expect.objectContaining({
          code: options.quotaDefinition ? "QUOTA_VIEW_REJECTED" : "CATALOG_STATE_REJECTED",
        }),
      );
  });

  it("contains raw failures, rolls back, and closes the client", async () => {
    const client = fakeClient({ errorAt: "FROM pg_policies" });
    let error;
    try {
      await run(client);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LiveAttestError);
    expect(error).toEqual(expect.objectContaining({ code: "LIVE_ATTEST_DENIED" }));
    expect(error.message).toBe("LIVE_ATTEST_DENIED");
    expect(error.message).not.toContain("sensitive catalog detail");
    expect(client.calls).toContain("ROLLBACK");
    expect(client.calls).toContain("END");
  });
});
