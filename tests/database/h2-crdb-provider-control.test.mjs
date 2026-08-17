import { describe, expect, it } from "vitest";
import {
  ProviderControlError,
  runProviderControl,
} from "../../scripts/h2-crdb-provider-control.mjs";

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
const caps = Object.freeze({
  absolute_nova_cap: "300",
  absolute_titan_cap: "800",
  engineering_nova_cap: "100",
  engineering_titan_cap: "200",
  public_nova_cap: "200",
  public_session_cap: "100",
  public_titan_cap: "600",
});
const usage = Object.freeze({
  engineering_nova: "4",
  engineering_titan: "8",
  public_nova: "5",
  public_sessions: "7",
  public_titan: "12",
});

function fakeClient(options = {}) {
  let enabled = options.enabled ?? false;
  let controlReads = 0;
  let usageReads = 0;
  const calls = [];
  return {
    calls,
    async connect() {
      calls.push("CONNECT");
      if (options.connectError) throw new Error("sensitive connection detail");
    },
    async end() {
      calls.push("END");
    },
    async query(sql) {
      calls.push(sql);
      if (sql.includes("current_database() AS database_name"))
        return {
          rows: [
            {
              database_name: options.database ?? "defaultdb",
              sql_user: options.user ?? "continuity_migrator",
              sql_user_is_admin: options.admin ?? true,
            },
          ],
        };
      if (sql.startsWith("SELECT control_id, provider_enabled")) {
        controlReads += 1;
        return {
          rows: options.controlRows ?? [
            {
              ...caps,
              ...(controlReads > 1 ? options.postCaps : options.control),
              control_id: options.controlId ?? "live-v1",
              provider_enabled: enabled,
            },
          ],
        };
      }
      if (sql.includes("view_definition FROM information_schema.views")) {
        if (options.viewError) throw new Error("sensitive view detail");
        return { rows: [{ view_definition: options.definition ?? appliedDefinition }] };
      }
      if (sql.startsWith("SELECT public_sessions")) {
        usageReads += 1;
        return {
          rows: [
            {
              ...usage,
              ...(usageReads > 1 ? options.postUsage : options.usage),
            },
          ],
        };
      }
      if (sql.includes("SET provider_enabled = true")) {
        const rowCount = options.enableRowCount ?? (enabled ? 0 : 1);
        if (rowCount === 1) enabled = true;
        return { rowCount, rows: [] };
      }
      if (sql.includes("SET provider_enabled = false")) {
        const rowCount = options.disableRowCount ?? (enabled ? 1 : 0);
        if (rowCount === 1) enabled = false;
        return { rowCount, rows: [] };
      }
      return { rows: [] };
    },
  };
}

const run = (arguments_, client, url = migrationUrl) =>
  runProviderControl({
    arguments_,
    createClient: (options) => {
      client.options = options;
      return client;
    },
    environment: { COCKROACH_MIGRATION_DATABASE_URL: url },
  });

describe("bounded CockroachDB provider control", () => {
  it("accepts only the exact CLI and strict migrator URL", async () => {
    for (const arguments_ of [
      [],
      ["--enable"],
      ["--enable", "--confirm-synthetic-only", "extra"],
      ["--status", "extra"],
      ["--disable", "extra"],
    ])
      await expect(run(arguments_, fakeClient())).rejects.toEqual(
        expect.objectContaining({ code: "USAGE_REJECTED" }),
      );
    await expect(
      run(["--status"], fakeClient(), migrationUrl.replace("verify-full", "verify-ca")),
    ).rejects.toEqual(expect.objectContaining({ code: "DATABASE_URL_REJECTED" }));
  });

  it("reports exact status in one read-only transaction", async () => {
    const client = fakeClient({ enabled: true, viewError: true });
    const result = await run(["--status"], client);
    expect(result).toEqual({
      database: "defaultdb",
      providerEnabled: true,
      changed: false,
    });
    expect(JSON.stringify(result)).toBe(
      '{"database":"defaultdb","providerEnabled":true,"changed":false}',
    );
    expect(client.options).toEqual({
      connectionString: migrationUrl,
      connectionTimeoutMillis: 15_000,
    });
    expect(client.calls.filter((call) => call === "BEGIN")).toHaveLength(1);
    expect(client.calls.filter((call) => call === "COMMIT")).toHaveLength(1);
    expect(client.calls).toContain("SET TRANSACTION READ ONLY");
    expect(client.calls.some((call) => String(call).includes("FOR UPDATE"))).toBe(false);
    expect(client.calls.some((call) => String(call).includes("information_schema.views"))).toBe(
      false,
    );
  });

  it("enables only after exact 0009 and unchanged below-cap usage", async () => {
    const client = fakeClient();
    await expect(run(["--enable", "--confirm-synthetic-only"], client)).resolves.toEqual({
      changed: true,
      database: "defaultdb",
      providerEnabled: true,
    });
    expect(client.calls.filter((call) => call === "BEGIN")).toHaveLength(1);
    expect(client.calls.filter((call) => call === "COMMIT")).toHaveLength(1);
    expect(client.calls).not.toContain("SET TRANSACTION READ ONLY");
    expect(client.calls.some((call) => String(call).includes("FOR UPDATE"))).toBe(true);
    expect(
      client.calls.filter((call) => String(call).startsWith("SELECT public_sessions")),
    ).toHaveLength(2);
    expect(
      client.calls.filter((call) => String(call).includes("SET provider_enabled = true")),
    ).toHaveLength(1);
  });

  it("rejects enable on identity, control, view, quota, or poststate drift", async () => {
    for (const [options, code] of [
      [{ user: "root" }, "MIGRATION_IDENTITY_REJECTED"],
      [{ control: { public_session_cap: "101" } }, "CONTROL_STATE_REJECTED"],
      [{ controlRows: [] }, "CONTROL_STATE_REJECTED"],
      [{ controlRows: [{}, {}] }, "CONTROL_STATE_REJECTED"],
      [{ definition: readyDefinition }, "QUOTA_VIEW_REJECTED"],
      [{ usage: { public_sessions: "100" } }, "QUOTA_EXHAUSTED"],
      [{ usage: { public_titan: "600" } }, "QUOTA_EXHAUSTED"],
      [{ usage: { public_nova: "200" } }, "QUOTA_EXHAUSTED"],
      [{ usage: { engineering_titan: "200" } }, "QUOTA_EXHAUSTED"],
      [{ usage: { engineering_nova: "100" } }, "QUOTA_EXHAUSTED"],
      [{ usage: { engineering_titan: "200", public_titan: "600" } }, "QUOTA_EXHAUSTED"],
      [{ usage: { engineering_nova: "100", public_nova: "200" } }, "QUOTA_EXHAUSTED"],
      [{ postUsage: { public_titan: "13" } }, "CONTROL_POSTSTATE_REJECTED"],
      [{ enabled: true }, "PROVIDER_STATE_REJECTED"],
    ]) {
      const client = fakeClient(options);
      await expect(run(["--enable", "--confirm-synthetic-only"], client)).rejects.toEqual(
        expect.objectContaining({ code }),
      );
      expect(client.calls, code).toContain("ROLLBACK");
      expect(client.calls, code).toContain("END");
    }
  });

  it("disables safely and idempotently without depending on quota state", async () => {
    const enabled = fakeClient({ enabled: true, viewError: true });
    await expect(run(["--disable"], enabled)).resolves.toEqual({
      changed: true,
      database: "defaultdb",
      providerEnabled: false,
    });
    const disabled = fakeClient({ enabled: false, viewError: true });
    await expect(run(["--disable"], disabled)).resolves.toEqual({
      changed: false,
      database: "defaultdb",
      providerEnabled: false,
    });
    for (const client of [enabled, disabled]) {
      expect(client.calls.filter((call) => call === "BEGIN")).toHaveLength(1);
      expect(client.calls.some((call) => String(call).includes("FOR UPDATE"))).toBe(true);
      expect(client.calls.some((call) => String(call).includes("information_schema.views"))).toBe(
        false,
      );
      expect(client.calls.some((call) => String(call).startsWith("SELECT public_sessions"))).toBe(
        false,
      );
      expect(client.calls).toContain("COMMIT");
    }
    for (const options of [{ admin: false }, { control: { absolute_titan_cap: "801" } }]) {
      const client = fakeClient({ ...options, enabled: true, viewError: true });
      await expect(run(["--disable"], client)).rejects.toBeInstanceOf(ProviderControlError);
      expect(client.calls.some((call) => String(call).includes("information_schema.views"))).toBe(
        false,
      );
      expect(client.calls).toContain("ROLLBACK");
    }
  });

  it("redacts unexpected failures and closes the client", async () => {
    const client = fakeClient({ connectError: true });
    await expect(run(["--disable"], client)).rejects.toEqual(
      expect.objectContaining({ code: "PROVIDER_CONTROL_DENIED" }),
    );
    expect(client.calls).toContain("END");
    expect(client.calls).not.toContain("ROLLBACK");
    expect(() => {
      throw new ProviderControlError("FIXED_CODE");
    }).toThrowError("FIXED_CODE");
  });
});
