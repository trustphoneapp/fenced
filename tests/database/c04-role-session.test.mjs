import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalC04RoleSessionMigration,
  readC04RoleSessionMigrationAtPathForTest,
  validateC04RoleSessionTextForTest,
  verifyC04RoleSession,
  verifyC04RoleSessionForTest,
} from "../../scripts/verify-c04-role-session.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const databaseRoot = path.join(repositoryRoot, "database");
const migrationRoot = path.join(databaseRoot, "migrations");
const migrationPath = path.join(migrationRoot, "0003_role_session_isolation.sql");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileTuple = async () => {
  const bytes = await readFile(migrationPath);
  const stat = await lstat(migrationPath);
  return {
    bytes: bytes.length,
    mode: (stat.mode & 0o777).toString(8).padStart(4, "0"),
    nlink: stat.nlink,
    sha256: digest(bytes),
  };
};

describe("C04 role and session isolation migration", () => {
  it("matches the exact canonical migration and accepted predecessor hashes", async () => {
    expect(await readFile(migrationPath, "utf8")).toBe(canonicalC04RoleSessionMigration);
    expect(validateC04RoleSessionTextForTest(canonicalC04RoleSessionMigration)).toBe(true);
    expect(digest(await readFile(path.join(migrationRoot, "0001_tenant_event_ledger.sql")))).toBe(
      "9179c8575d6b9cb2a6ef82db2e73409a96b0de5b8bcf3d213ec12768e7d325f2",
    );
    expect(
      digest(await readFile(path.join(migrationRoot, "0002_purpose_qualified_tenant_keys.sql"))),
    ).toBe("8dcc5604ce1dbb6316f9aa3c4f1422e009ffcc1b75d4961df4f7d3ee1babf9af");
    await expect(verifyC04RoleSession()).resolves.toEqual({
      migration: "0003_role_session_isolation.sql",
      roles: ["zc_continuity_reader", "zc_continuity_executor"],
      tables: ["tenants", "payload_anchors", "events"],
    });
  });

  it("creates only the exact inert roles and grants the reader only current read scope", () => {
    const sql = canonicalC04RoleSessionMigration;
    expect(Array.from(sql.matchAll(/^CREATE ROLE (\S+)$/gmu), (match) => match[1])).toEqual([
      "zc_continuity_reader",
      "zc_continuity_executor",
    ]);
    expect(
      sql.match(/NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;/gu),
    ).toHaveLength(2);
    expect(Array.from(sql.matchAll(/^GRANT .+$/gmu), (match) => match[0])).toEqual([
      "GRANT USAGE ON SCHEMA continuity TO zc_continuity_reader;",
      "GRANT SELECT ON TABLE continuity.tenants TO zc_continuity_reader;",
      "GRANT SELECT ON TABLE continuity.payload_anchors TO zc_continuity_reader;",
      "GRANT SELECT ON TABLE continuity.events TO zc_continuity_reader;",
    ]);
    expect(sql).not.toMatch(/^GRANT .+ TO zc_continuity_executor;$/mu);
  });

  it("revokes PUBLIC and enables and forces RLS on exactly the current tables", () => {
    const sql = canonicalC04RoleSessionMigration;
    expect(
      Array.from(sql.matchAll(/^REVOKE ALL PRIVILEGES ON (.+) FROM PUBLIC;$/gmu), (m) => m[1]),
    ).toEqual([
      "SCHEMA continuity",
      "TABLE continuity.tenants",
      "TABLE continuity.payload_anchors",
      "TABLE continuity.events",
    ]);
    for (const action of ["ENABLE", "FORCE"])
      expect(
        Array.from(
          sql.matchAll(
            new RegExp(`^ALTER TABLE continuity\\.(\\w+) ${action} ROW LEVEL SECURITY;$`, "gmu"),
          ),
          (match) => match[1],
        ),
      ).toEqual(["tenants", "payload_anchors", "events"]);
  });

  it("binds exact fail-closed tenant and server-purpose settings in SELECT-only policies", () => {
    const sql = canonicalC04RoleSessionMigration;
    expect(Array.from(sql.matchAll(/^CREATE POLICY (\S+)$/gmu), (match) => match[1])).toEqual([
      "tenants_reader_scope",
      "payload_anchors_reader_scope",
      "events_reader_scope",
    ]);
    expect(sql.match(/current_setting\('continuity\.tenant_id', true\)/gu)).toHaveLength(6);
    expect(sql.match(/current_setting\('continuity\.server_purpose', true\)/gu)).toHaveLength(6);
    expect(sql.match(/FOR SELECT\n {2}TO zc_continuity_reader/gu)).toHaveLength(3);
    expect(sql.match(/'\^\[0-9a-f\]\{48\}\$'/gu)).toHaveLength(3);
    expect(sql.match(/'\^\[a-z\]\[a-z0-9\._:-\]\*\$'/gu)).toHaveLength(2);
  });

  it("rejects every role, grant, RLS, policy, setting, and pattern weakening", () => {
    const mutations = [
      ["zc_continuity_reader", "zc_reader"],
      ["zc_continuity_executor", "zc_executor"],
      ["NOLOGIN", "LOGIN"],
      ["NOINHERIT", "INHERIT"],
      ["NOSUPERUSER", "SUPERUSER"],
      ["NOCREATEROLE", "CREATEROLE"],
      ["NOCREATEDB", "CREATEDB"],
      ["NOBYPASSRLS", "BYPASSRLS"],
      ["REVOKE ALL PRIVILEGES ON SCHEMA continuity FROM PUBLIC;", ""],
      ["REVOKE ALL PRIVILEGES ON TABLE continuity.events FROM PUBLIC;", ""],
      ["GRANT SELECT ON TABLE continuity.events", "GRANT INSERT ON TABLE continuity.events"],
      ["GRANT SELECT ON TABLE continuity.events TO zc_continuity_reader;", ""],
      ["ENABLE ROW LEVEL SECURITY", "DISABLE ROW LEVEL SECURITY"],
      ["FORCE ROW LEVEL SECURITY", "NO FORCE ROW LEVEL SECURITY"],
      ["tenants_reader_scope", "tenant_reader_scope"],
      ["FOR SELECT", "FOR ALL"],
      ["TO zc_continuity_reader", "TO PUBLIC"],
      ["'continuity.tenant_id'", "'continuity.requested_tenant_id'"],
      ["'continuity.server_purpose'", "'continuity.requested_purpose'"],
      ["'^[0-9a-f]{48}$'", "'.*'"],
      ["'^[a-z][a-z0-9._:-]*$'", "'.*'"],
      ["tenant_id = current_setting", "tenant_id <> current_setting"],
      ["server_purpose = current_setting", "server_purpose <> current_setting"],
      ["    AND tenant_id = current_setting", "    OR tenant_id = current_setting"],
      [
        "current_setting('continuity.tenant_id', true) ~",
        "COALESCE(current_setting('continuity.tenant_id', true), tenant_id) ~",
      ],
      ["tenant_id = current_setting('continuity.tenant_id', true)", "tenant_id = current_user"],
      ["tenant_id = current_setting('continuity.tenant_id', true)", "TRUE"],
    ];
    for (const [from, to] of mutations) {
      const mutated = canonicalC04RoleSessionMigration.replace(from, to);
      expect(mutated, from).not.toBe(canonicalC04RoleSessionMigration);
      expect(() => validateC04RoleSessionTextForTest(mutated), from).toThrow(
        /exact statement set/u,
      );
    }
  });

  it("rejects functions, writes, session statements, membership, ownership, defaults, and future objects", () => {
    const statements = [
      "CREATE FUNCTION continuity.unsafe() RETURNS BOOL LANGUAGE SQL AS 'SELECT true';",
      "CREATE PROCEDURE continuity.unsafe() LANGUAGE SQL AS 'SELECT true';",
      "CREATE VIEW continuity.unsafe_view AS SELECT * FROM continuity.events;",
      "CREATE SCHEMA continuity_future;",
      "CREATE SEQUENCE continuity.unsafe_sequence;",
      "INSERT INTO continuity.events DEFAULT VALUES;",
      "UPDATE continuity.events SET event_id = event_id;",
      "DELETE FROM continuity.events;",
      "TRUNCATE continuity.events;",
      "SET ROLE zc_continuity_reader;",
      "SET SESSION continuity.tenant_id = '000000000000000000000000000000000000000000000000';",
      "RESET ROLE;",
      "PREPARE unsafe AS SELECT * FROM continuity.events;",
      "EXECUTE unsafe;",
      "DO $$ BEGIN EXECUTE 'SELECT 1'; END $$;",
      "GRANT zc_continuity_reader TO zc_continuity_executor;",
      "ALTER TABLE continuity.events OWNER TO zc_continuity_executor;",
      "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO zc_continuity_reader;",
      "CREATE TABLE continuity.future_table (id INT);",
      "GRANT SELECT ON TABLE continuity.future_table TO zc_continuity_reader;",
      "DROP TABLE continuity.events CASCADE;",
      "ALTER TABLE continuity.events ADD CONSTRAINT unsafe_fk FOREIGN KEY (tenant_id) REFERENCES continuity.tenants (tenant_id) ON DELETE SET NULL;",
      "CREATE POLICY extra_reader_scope ON continuity.events FOR SELECT TO zc_continuity_reader USING (TRUE);",
      "CREATE POLICY future_reader_scope ON continuity.future_table FOR SELECT TO zc_continuity_reader USING (TRUE);",
    ];
    for (const statement of statements)
      expect(() =>
        validateC04RoleSessionTextForTest(
          canonicalC04RoleSessionMigration.replace("COMMIT;", `${statement}\n\nCOMMIT;`),
        ),
      ).toThrow(/exact statement set/u);
  });

  it("rejects migration-list entries that are added, removed, or reordered and restores exactly", async () => {
    const migrationNames = [
      "0001_tenant_event_ledger.sql",
      "0002_purpose_qualified_tenant_keys.sql",
      "0003_role_session_isolation.sql",
      "0004_erasable_payload_storage.sql",
      "0005_immutable_event_links.sql",
      "0006_outbox_inbox.sql",
      "0007_agent_memory.sql",
      "0008_hackathon_live.sql",
      "0009_hackathon_quota_window.sql",
      "0010_hackathon_fk_read_grants.sql",

      "0011_mcp_reader_membership.sql",
    ];
    const beforeNames = await readdir(databaseRoot);
    const beforeMigrations = await Promise.all(
      migrationNames.map(async (name) => digest(await readFile(path.join(migrationRoot, name)))),
    );
    const cases = [
      {
        name: "added",
        mutate: async () => {
          const unexpected = path.join(migrationRoot, "0004_unexpected.sql");
          await writeFile(unexpected, "SELECT 1;\n", { encoding: "utf8", mode: 0o644 });
          return () => rm(unexpected, { force: true });
        },
      },
      {
        name: "removed",
        mutate: async (temporary) => {
          const original = path.join(migrationRoot, migrationNames[1]);
          const backup = path.join(temporary, migrationNames[1]);
          await rename(original, backup);
          return () => rename(backup, original);
        },
      },
      {
        name: "reordered",
        mutate: async () => {
          const reordered = path.join(migrationRoot, "0000_role_session_isolation.sql");
          await rename(migrationPath, reordered);
          return () => rename(reordered, migrationPath);
        },
      },
    ];
    for (const fixture of cases) {
      const temporary = await mkdtemp(path.join(databaseRoot, `.c04-role-list-${fixture.name}-`));
      let restore;
      try {
        restore = await fixture.mutate(temporary);
        await expect(verifyC04RoleSession(), fixture.name).rejects.toThrow(
          /migration list or order differs/u,
        );
      } finally {
        await restore?.();
        await rm(temporary, { recursive: true });
      }
      expect((await readdir(migrationRoot)).sort(), fixture.name).toEqual(migrationNames);
      expect(
        await Promise.all(
          migrationNames.map(async (name) =>
            digest(await readFile(path.join(migrationRoot, name))),
          ),
        ),
        fixture.name,
      ).toEqual(beforeMigrations);
    }
    expect((await readdir(databaseRoot)).sort()).toEqual(beforeNames.sort());
  });

  it("rejects malformed framing, oversized input, and path aliases", async () => {
    for (const source of [
      canonicalC04RoleSessionMigration.slice(0, -1),
      `${canonicalC04RoleSessionMigration}\n`,
      canonicalC04RoleSessionMigration.replaceAll("\n", "\r\n"),
      `\uFEFF${canonicalC04RoleSessionMigration}`,
    ])
      expect(() => validateC04RoleSessionTextForTest(source)).toThrow(/framing/u);
    expect(() => validateC04RoleSessionTextForTest(" ".repeat(32 * 1024 + 1))).toThrow(
      /outside its bound/u,
    );
    for (const alias of [
      path.relative(repositoryRoot, migrationPath),
      `${path.dirname(migrationPath)}/./${path.basename(migrationPath)}`,
      `${migrationPath}/..`,
    ])
      await expect(readC04RoleSessionMigrationAtPathForTest(alias)).rejects.toThrow(
        /path is not exact/u,
      );
    await expect(readC04RoleSessionMigrationAtPathForTest(migrationPath)).resolves.toBeInstanceOf(
      Buffer,
    );
  });

  it("rejects wrong mode, hardlink, symlink, and a symlinked path component without residue", async () => {
    const expected = await fileTuple();
    const beforeNames = await readdir(databaseRoot);
    await chmod(migrationPath, 0o600);
    try {
      await expect(verifyC04RoleSession()).rejects.toThrow(/mode-0644/u);
    } finally {
      await chmod(migrationPath, 0o644);
    }
    expect(await fileTuple()).toEqual(expected);

    for (const kind of ["hardlink", "symlink"]) {
      const temporary = await mkdtemp(path.join(databaseRoot, `.c04-role-${kind}-`));
      const backup = path.join(temporary, "0003.sql");
      await rename(migrationPath, backup);
      try {
        if (kind === "hardlink") await link(backup, migrationPath);
        else await symlink(backup, migrationPath);
        await expect(verifyC04RoleSession()).rejects.toThrow();
      } finally {
        await rm(migrationPath, { force: true });
        await rename(backup, migrationPath);
        await rm(temporary, { recursive: true });
      }
      expect(await fileTuple(), kind).toEqual(expected);
    }

    const backupRoot = await mkdtemp(path.join(databaseRoot, ".c04-role-component-"));
    await rm(backupRoot, { recursive: true });
    await rename(migrationRoot, backupRoot);
    try {
      await symlink(backupRoot, migrationRoot);
      await expect(verifyC04RoleSession()).rejects.toThrow(/canonical/u);
    } finally {
      await rm(migrationRoot, { force: true });
      await rename(backupRoot, migrationRoot);
    }
    expect(await fileTuple()).toEqual(expected);
    expect((await readdir(databaseRoot)).sort()).toEqual(beforeNames.sort());
  });

  it("detects a guarded-read race and restores the exact file without residue", async () => {
    const original = await readFile(migrationPath, "utf8");
    const expected = await fileTuple();
    const beforeNames = await readdir(databaseRoot);
    try {
      await expect(
        verifyC04RoleSessionForTest(async () => {
          await writeFile(migrationPath, original.replace("COMMIT;", "COMMIT; -- raced"), "utf8");
        }),
      ).rejects.toThrow(/changed during verification/u);
    } finally {
      await writeFile(migrationPath, original, { encoding: "utf8", mode: 0o644 });
      await chmod(migrationPath, 0o644);
    }
    expect(await fileTuple()).toEqual(expected);
    expect((await readdir(databaseRoot)).sort()).toEqual(beforeNames.sort());
    await expect(verifyC04RoleSession()).resolves.toBeDefined();
  });
});
