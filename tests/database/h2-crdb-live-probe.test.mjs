import { describe, expect, it } from "vitest";
import {
  deriveProbeIds,
  LiveProbeError,
  liveProbeTestContract,
  runLiveProbe,
} from "../../scripts/h2-crdb-live-probe.mjs";

const nonce = "a".repeat(64);
const migrationUrl =
  "postgresql://continuity_migrator:synthetic-password@zc-demo.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";
const appUrl =
  "postgresql://continuity_app:synthetic-password@zc-demo.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";
const environment = {
  COCKROACH_DATABASE_URL: appUrl,
  COCKROACH_MIGRATION_DATABASE_URL: migrationUrl,
};
const dviValues = (ids) => [
  ids.correction.tenantId,
  "hackathon-demo",
  "zc.bedrock-titan-v2.1024",
  "active",
  "public",
];
const quotedPrefix = (values) => values.map((value) => `/'${value}'`).join("");
const prefixSpan = (lower, upper = lower) =>
  `prefix spans: [${quotedPrefix(lower)} - ${quotedPrefix(upper)}]`;
const plan = (ids) => [
  { info: "└── • vector search" },
  { info: "table: memory_facts@memory_facts_titan_scope_l2" },
  { info: prefixSpan(dviValues(ids)) },
];

function countRows(value = 0) {
  return liveProbeTestContract.ownedTables.map((table_name) => ({
    row_count: String(value),
    table_name,
  }));
}

function harness(options = {}) {
  const ids = deriveProbeIds(nonce);
  const migratorCalls = [];
  const appPools = [];
  let quotaReads = 0;
  let globalReads = 0;
  let repositoryCalls = 0;
  const migrator = {
    async connect() {
      migratorCalls.push({ params: undefined, sql: "CONNECT" });
      if (options.connectError) throw new Error("raw sensitive connection failure");
    },
    async end() {
      migratorCalls.push({ params: undefined, sql: "END" });
    },
    async query(sql, params) {
      migratorCalls.push({ params, sql });
      if (options.deleteError && sql.includes(`DELETE FROM continuity.${options.deleteError}`))
        throw new Error("raw sensitive delete failure");
      if (sql.includes("current_database() AS database_name"))
        return {
          rows: [
            {
              database_name: "defaultdb",
              sql_user: "continuity_migrator",
              sql_user_is_admin: true,
            },
          ],
        };
      if (sql.includes("public_session_cap"))
        return {
          rows: [
            {
              absolute_nova_cap: 300,
              absolute_titan_cap: 800,
              engineering_nova_cap: 100,
              engineering_titan_cap: 200,
              provider_enabled: options.providerEnabled ?? false,
              public_nova_cap: 200,
              public_session_cap: 100,
              public_titan_cap: 600,
            },
          ],
        };
      if (sql.startsWith("DELETE")) return { rowCount: options.deleteCount ?? 0, rows: [] };
      if (sql.includes("WHERE tenant_id = ANY"))
        return { rows: countRows(options.canaryRows ?? 0) };
      if (sql.includes("count(*)::INT8 AS row_count") && !sql.includes("WHERE tenant_id")) {
        globalReads += 1;
        return { rows: countRows(options.globalMutation && globalReads > 1 ? 1 : 0) };
      }
      if (sql.includes("SELECT public_sessions, public_titan, public_nova")) {
        quotaReads += 1;
        if (options.agingMutation && quotaReads > 1)
          return { rows: [{ public_nova: 1, public_sessions: 1, public_titan: 1 }] };
        return {
          rows: [
            quotaReads === 1
              ? { public_nova: 0, public_sessions: 0, public_titan: 0 }
              : { public_nova: 1, public_sessions: 0, public_titan: 1 },
          ],
        };
      }
      if (sql.startsWith("EXPLAIN"))
        return {
          rows:
            options.dviPlan ?? (options.dviMutation ? [{ info: "scan other_index" }] : plan(ids)),
        };
      if (sql.includes("rollback_revision_one"))
        return {
          rows: [
            options.rollbackMutation
              ? {
                  effects: 1,
                  propagations: 1,
                  revision_two: 1,
                  rollback_effects: 1,
                  rollback_propagations: 0,
                  rollback_revision_one: 0,
                }
              : {
                  effects: 1,
                  propagations: 1,
                  revision_two: 1,
                  rollback_effects: 0,
                  rollback_propagations: 0,
                  rollback_revision_one: 1,
                },
          ],
        };
      return { rowCount: 1, rows: [] };
    },
  };

  function createAppPool(poolOptions) {
    const index = appPools.length;
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ params, sql });
        if (sql.includes("SELECT 1 / 0")) throw new Error("expected injected rollback");
        if (sql.includes("current_user AS sql_user"))
          return {
            rows: [
              options.settingsMutation
                ? {
                    purpose_setting: "hackathon-demo",
                    sql_user: "zc_continuity_executor",
                    tenant_setting: ids.correction.tenantId,
                  }
                : {
                    purpose_setting: "",
                    sql_user: "continuity_app",
                    tenant_setting: "",
                  },
            ],
          };
        if (sql.startsWith("SELECT fact_id"))
          return { rows: options.rlsMutation ? [{ fact_id: "f".repeat(48) }] : [] };
        return { rows: [] };
      },
      release() {
        calls.push({ params: undefined, sql: "RELEASE" });
      },
    };
    const pool = {
      calls,
      index,
      options: poolOptions,
      async connect() {
        calls.push({ params: undefined, sql: "CONNECT" });
        return options.poolClientReplacement &&
          calls.filter(({ sql }) => sql === "CONNECT").length > 1
          ? { ...client }
          : client;
      },
      async end() {
        calls.push({ params: undefined, sql: "END" });
      },
    };
    appPools.push(pool);
    return pool;
  }

  const dependencies = {
    createAppPool,
    createMigratorClient: (clientOptions) => {
      migrator.options = clientOptions;
      return migrator;
    },
    createRepository: ({ pool }) => ({
      async correct(input) {
        repositoryCalls += 1;
        pool.correctionInput = input;
        if (pool.index === 21)
          return options.rollbackResult ?? { outcome: "denied", reason: "database_error" };
        if (options.resultMutation) return { outcome: "replayed", revision: "2" };
        return repositoryCalls === 1
          ? { outcome: "succeeded", revision: "2" }
          : { outcome: "replayed", revision: "2" };
      },
    }),
  };
  return { appPools, dependencies, ids, migrator, migratorCalls };
}

const prove = (fixture, arguments_ = ["--prove", nonce], env = environment) =>
  runLiveProbe({ arguments_, dependencies: fixture.dependencies, environment: env });

describe("bounded destructive CockroachDB live probe", () => {
  it("accepts only exact commands, nonce, and strict URLs", async () => {
    for (const arguments_ of [
      [],
      ["--prove"],
      ["--prove", "A".repeat(64)],
      ["--prove", nonce, "extra"],
      ["--status", nonce],
    ])
      await expect(prove(harness(), arguments_)).rejects.toEqual(
        expect.objectContaining({ code: "USAGE_REJECTED" }),
      );
    await expect(
      prove(harness(), ["--prove", nonce], {
        ...environment,
        COCKROACH_DATABASE_URL: appUrl.replace("verify-full", "verify-ca"),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "APP_URL_REJECTED" }));
  });

  it("derives scoped IDs but pins the sole production dataset fact/source exception", () => {
    const first = deriveProbeIds(nonce);
    const second = deriveProbeIds("b".repeat(64));
    expect(first).toEqual(deriveProbeIds(nonce));
    expect(first.tenants).not.toEqual(second.tenants);
    expect(new Set(first.tenants)).toHaveLength(3);
    expect(first.correction.sessionDigest.startsWith(first.correction.tenantId)).toBe(true);
    expect(liveProbeTestContract.fixedFactId).toBe("1".repeat(48));
    expect(liveProbeTestContract.fixedSourceRef).toBe("e".repeat(48));
  });

  it("cleans in exact reverse-FK order, is idempotent, and rolls back on failure", async () => {
    for (const fixture of [harness(), harness({ deleteCount: 1 })]) {
      const cleanupResult = await prove(fixture, ["--cleanup", nonce], {
        COCKROACH_MIGRATION_DATABASE_URL: migrationUrl,
      });
      expect(cleanupResult).toEqual({ cleanup: true, database: "defaultdb" });
      expect(Object.keys(cleanupResult)).toEqual(["database", "cleanup"]);
      const deletes = fixture.migratorCalls.filter(({ sql }) => sql.startsWith("DELETE"));
      expect(deletes.map(({ sql }) => /continuity\.([a-z_]+)/u.exec(sql)?.[1])).toEqual(
        liveProbeTestContract.ownedTables,
      );
      expect(deletes.every(({ params }) => params[0].length === 3)).toBe(true);
      expect(fixture.migratorCalls.filter(({ sql }) => sql === "BEGIN")).toHaveLength(1);
      expect(fixture.migratorCalls.some(({ sql }) => sql === "COMMIT")).toBe(true);
    }
    const failed = harness({ deleteError: "memory_propagations" });
    await expect(
      prove(failed, ["--cleanup", nonce], {
        COCKROACH_MIGRATION_DATABASE_URL: migrationUrl,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "LIVE_PROBE_DENIED" }));
    expect(failed.migratorCalls.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(
      failed.migratorCalls.some(({ sql }) => sql.includes("DELETE FROM continuity.tenants")),
    ).toBe(false);
  });

  it("proves the full bounded path and emits only the fixed content-free result", async () => {
    const fixture = harness();
    const result = await prove(fixture);
    expect(result).toEqual({
      cleanup: true,
      correctionContenders: 20,
      correctionReplayed: 19,
      correctionSucceeded: 1,
      database: "defaultdb",
      dvi: true,
      dviPlanSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      poolReuse: true,
      rls: true,
      rollback: true,
      rollingQuota: true,
    });
    expect(Object.keys(result)).toEqual([
      "database",
      "rls",
      "poolReuse",
      "rollback",
      "rollingQuota",
      "dvi",
      "dviPlanSha256",
      "correctionContenders",
      "correctionSucceeded",
      "correctionReplayed",
      "cleanup",
    ]);
    expect(fixture.appPools).toHaveLength(22);
    for (const pool of fixture.appPools)
      expect(pool.options).toEqual({
        allowExitOnIdle: true,
        connectionString: appUrl,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
        max: 1,
        query_timeout: 5_000,
        ssl: { rejectUnauthorized: true },
        statement_timeout: 5_000,
      });
    const correctionInputs = fixture.appPools.slice(1).map((pool) => pool.correctionInput);
    expect(correctionInputs.every((input) => input.factId === "1".repeat(48))).toBe(true);
    expect(correctionInputs.every((input) => input.replacement.sourceRef === "e".repeat(48))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain(nonce);
    expect(JSON.stringify(result)).not.toContain(fixture.ids.correction.tenantId);
    expect(
      fixture.migratorCalls.some(
        ({ sql }) => sql.startsWith("EXPLAIN SELECT") && !sql.includes("EXPLAIN (OPT)"),
      ),
    ).toBe(true);
    const explain = fixture.migratorCalls.find(({ sql }) => sql.startsWith("EXPLAIN SELECT"))?.sql;
    expect(explain).toContain("WHERE tenant_id = $1 AND server_purpose = $2");
    expect(explain).toContain("embedding_space = 'zc.bedrock-titan-v2.1024'");
    expect(explain).toContain("fact_status = 'active' AND sensitivity = 'public'");
    expect(
      fixture.migratorCalls.some(
        ({ sql }) =>
          sql.includes("fact_revision,record_schema_version") && sql.includes("'retracted'"),
      ),
    ).toBe(true);
  });

  it("rejects enabled provider and RLS, reset, aging, or DVI mutations", async () => {
    const ids = deriveProbeIds(nonce);
    const values = dviValues(ids);
    const vectorPlan = (span) => [
      { info: "└── • vector search" },
      { info: "table: memory_facts@memory_facts_titan_scope_l2" },
      { info: span },
    ];
    for (const [options, code] of [
      [{ providerEnabled: true }, "PROVIDER_STATE_REJECTED"],
      [{ rlsMutation: true }, "RLS_REJECTED"],
      [{ settingsMutation: true }, "POOL_REUSE_REJECTED"],
      [{ poolClientReplacement: true }, "POOL_REUSE_REJECTED"],
      [{ agingMutation: true }, "ROLLING_QUOTA_REJECTED"],
      [{ dviMutation: true }, "DVI_PLAN_REJECTED"],
      [
        {
          dviPlan: [
            { info: "arbitrary prefix • vector search" },
            { info: "table: memory_facts@memory_facts_titan_scope_l2" },
            { info: prefixSpan(values) },
          ],
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan(values.slice(0, 4))),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan([values[1], values[0], ...values.slice(2)])),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan([values[0], "other", ...values.slice(1)])),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan([...values.slice(0, 3), "retracted", values[4]])),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan([...values.slice(0, 4), "restricted"])),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan(values, [...values.slice(0, 4), "restricted"])),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(`prefix spans: [/${values.join("/")} - /${values.join("/")}]`),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: vectorPlan(prefixSpan(values).replace("prefix spans:", "spans:")),
        },
        "DVI_PLAN_REJECTED",
      ],
      [
        {
          dviPlan: [
            { info: "└── • vector search" },
            { info: "table: memory_facts@memory_facts_titan_scope_l2" },
            {
              info: "filter: tenant_id AND server_purpose AND embedding_space AND fact_status = 'active' AND sensitivity = 'public'",
            },
          ],
        },
        "DVI_PLAN_REJECTED",
      ],
    ])
      await expect(prove(harness(options))).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("rejects contender count, rollback, and baseline mutations", async () => {
    for (const [options, code] of [
      [{ resultMutation: true }, "CORRECTION_RESULT_REJECTED"],
      [{ rollbackResult: { outcome: "succeeded", revision: "2" } }, "CORRECTION_ROLLBACK_REJECTED"],
      [{ rollbackMutation: true }, "CORRECTION_POSTSTATE_REJECTED"],
      [{ globalMutation: true }, "BASELINE_POSTSTATE_REJECTED"],
    ])
      await expect(prove(harness(options))).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("redacts raw failures and closes every opened resource", async () => {
    const fixture = harness({ connectError: true });
    let error;
    try {
      await prove(fixture);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LiveProbeError);
    expect(error).toEqual(expect.objectContaining({ code: "LIVE_PROBE_DENIED" }));
    expect(error.message).not.toContain("sensitive");
    expect(fixture.migratorCalls.some(({ sql }) => sql === "END")).toBe(true);
  });
});
