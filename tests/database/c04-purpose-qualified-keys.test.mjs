import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
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
  canonicalC04PurposeKeysMigration,
  readC04PurposeMigrationAtPathForTest,
  validateC04PurposeKeysTextForTest,
  verifyC04PurposeKeys,
  verifyC04PurposeKeysForTest,
} from "../../scripts/verify-c04-purpose-keys.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(
  repositoryRoot,
  "database",
  "migrations",
  "0002_purpose_qualified_tenant_keys.sql",
);
const databaseRoot = path.dirname(path.dirname(migrationPath));

async function fileTuple() {
  const bytes = await readFile(migrationPath);
  const stat = await lstat(migrationPath);
  return {
    bytes: bytes.length,
    lines: bytes.toString("utf8").split("\n").length - 1,
    mode: (stat.mode & 0o777).toString(8).padStart(4, "0"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

describe("C04.2 purpose-qualified structural keys", () => {
  it("accepts exactly three existing tables and the additive migration", async () => {
    await expect(verifyC04PurposeKeys()).resolves.toEqual({
      migration: "0002_purpose_qualified_tenant_keys.sql",
      tables: ["tenants", "payload_anchors", "events"],
    });
  });

  it("binds the exact purpose-qualified identities and optional relationship", () => {
    const sql = canonicalC04PurposeKeysMigration.replace(/\s+/gu, " ");
    expect(sql).toContain("PRIMARY KEY (tenant_id, server_purpose, payload_ref, payload_revision)");
    expect(sql).toContain(
      "UNIQUE (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)",
    );
    expect(sql).toContain("PRIMARY KEY (tenant_id, server_purpose, event_id, event_revision)");
    expect(sql).toContain(
      "FOREIGN KEY ( payload_tenant_id, payload_server_purpose, payload_ref, payload_revision, payload_requested_purpose )",
    );
    expect(sql).toContain(
      "REFERENCES continuity.payload_anchors ( tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose ) MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT",
    );
  });

  it("drops dependent legacy constraints before adding replacements", () => {
    const sql = canonicalC04PurposeKeysMigration;
    const add = sql.indexOf("ADD CONSTRAINT payload_anchors_purpose_pkey");
    for (const name of [
      "events_payload_tenant_id_payload_ref_payload_revision_payload_requested_purpose_payload_server_purpose_fkey",
      "events_pkey",
      "payload_anchors_pkey",
      "payload_anchors_tenant_id_payload_ref_payload_revision_requested_purpose_server_purpose_key",
    ])
      expect(sql.indexOf(`DROP CONSTRAINT ${name}`), name).toBeLessThan(add);
  });

  it("rejects every identity or relationship weakening", () => {
    for (const [from, to] of [
      ["tenant_id, server_purpose, payload_ref", "tenant_id, payload_ref"],
      ["tenant_id, server_purpose, event_id", "tenant_id, event_id"],
      [
        "tenant_id, server_purpose, payload_ref, payload_revision",
        "server_purpose, tenant_id, payload_ref, payload_revision",
      ],
      [
        "tenant_id, server_purpose, event_id, event_revision",
        "server_purpose, tenant_id, event_id, event_revision",
      ],
      ["server_purpose,\n    payload_ref", "requested_purpose,\n    payload_ref"],
      ["payload_server_purpose,\n    payload_ref", "payload_ref"],
      ["payload_server_purpose,\n    payload_ref", "payload_requested_purpose,\n    payload_ref"],
      [
        "payload_requested_purpose\n  ) REFERENCES",
        "payload_requested_purpose\n  ) MATCH SIMPLE REFERENCES",
      ],
      ["REFERENCES continuity.payload_anchors", "REFERENCES continuity.events"],
      [
        "payload_ref,\n    payload_revision,\n    requested_purpose\n  ) MATCH FULL",
        "payload_ref,\n    event_revision,\n    requested_purpose\n  ) MATCH FULL",
      ],
      ["MATCH FULL", "MATCH SIMPLE"],
      ["ON DELETE RESTRICT", "ON DELETE CASCADE"],
      ["ON UPDATE RESTRICT", "ON UPDATE CASCADE"],
    ])
      expect(() =>
        validateC04PurposeKeysTextForTest(canonicalC04PurposeKeysMigration.replace(from, to)),
      ).toThrow();
  });

  it("rejects an oversized migration and residual legacy unqualified uniqueness", () => {
    expect(() => validateC04PurposeKeysTextForTest(" ".repeat(16 * 1024 + 1))).toThrow(
      /outside its bound/u,
    );
    expect(() =>
      validateC04PurposeKeysTextForTest(
        canonicalC04PurposeKeysMigration.replace(
          "COMMIT;",
          "ALTER TABLE continuity.payload_anchors ADD CONSTRAINT legacy_unqualified_key UNIQUE (tenant_id, payload_ref, payload_revision);\n\nCOMMIT;",
        ),
      ),
    ).toThrow(/exact statement set/u);
  });

  it("rejects data writes, role/session SQL, dynamic SQL, and future tables", () => {
    for (const statement of [
      "INSERT INTO continuity.tenants VALUES ('x');",
      "UPDATE continuity.events SET event_id = event_id;",
      "DELETE FROM continuity.events;",
      "GRANT SELECT ON continuity.events TO unsafe;",
      "SET ROLE unsafe;",
      "SET SESSION application_name = 'unsafe';",
      "PREPARE unsafe AS SELECT 1;",
      "EXECUTE unsafe;",
      "CREATE TABLE continuity.future_table (id INT);",
      "CREATE ROLE unsafe;",
    ])
      expect(() =>
        validateC04PurposeKeysTextForTest(
          canonicalC04PurposeKeysMigration.replace("COMMIT;", `${statement}\n\nCOMMIT;`),
        ),
      ).toThrow(/forbidden SQL/u);
  });

  it("rejects wrong mode, hardlink, symlink, and symlinked path component", async () => {
    const expected = await fileTuple();
    await chmod(migrationPath, 0o600);
    try {
      await expect(verifyC04PurposeKeys()).rejects.toThrow(/mode-0644/u);
    } finally {
      await chmod(migrationPath, 0o644);
    }
    expect(await fileTuple()).toEqual(expected);

    for (const kind of ["hardlink", "symlink"]) {
      const temporary = await mkdtemp(path.join(databaseRoot, `.c04-purpose-${kind}-`));
      const backup = path.join(temporary, "0002.sql");
      await rename(migrationPath, backup);
      try {
        if (kind === "hardlink") await link(backup, migrationPath);
        else await symlink(backup, migrationPath);
        await expect(verifyC04PurposeKeys()).rejects.toThrow();
      } finally {
        await rm(migrationPath, { force: true });
        await rename(backup, migrationPath);
        await rm(temporary, { recursive: true });
      }
      expect(await fileTuple(), kind).toEqual(expected);
    }

    const migrationRoot = path.dirname(migrationPath);
    const backupRoot = await mkdtemp(path.join(databaseRoot, ".c04-purpose-component-"));
    await rm(backupRoot, { recursive: true });
    await rename(migrationRoot, backupRoot);
    try {
      await symlink(backupRoot, migrationRoot);
      await expect(verifyC04PurposeKeys()).rejects.toThrow(/canonical/u);
    } finally {
      await rm(migrationRoot, { force: true });
      await rename(backupRoot, migrationRoot);
    }
    expect(await fileTuple()).toEqual(expected);
  });

  it("rejects malformed framing and non-exact statement text", () => {
    for (const source of [
      canonicalC04PurposeKeysMigration.slice(0, -1),
      `${canonicalC04PurposeKeysMigration}\n`,
      canonicalC04PurposeKeysMigration.replaceAll("\n", "\r\n"),
      `\uFEFF${canonicalC04PurposeKeysMigration}`,
      canonicalC04PurposeKeysMigration.replace("BEGIN;", "BEGIN TRANSACTION;"),
    ])
      expect(() => validateC04PurposeKeysTextForTest(source)).toThrow();
  });

  it("rejects dot, relative, and normalized path aliases", async () => {
    for (const alias of [
      path.relative(repositoryRoot, migrationPath),
      `${path.dirname(migrationPath)}/./${path.basename(migrationPath)}`,
      `${migrationPath}/..`,
    ])
      await expect(readC04PurposeMigrationAtPathForTest(alias)).rejects.toThrow(
        /path is not exact/u,
      );
    await expect(readC04PurposeMigrationAtPathForTest(migrationPath)).resolves.toBeInstanceOf(
      Buffer,
    );
  });

  it("fails if 0002 changes during guarded verification", async () => {
    const original = await readFile(migrationPath, "utf8");
    try {
      await expect(
        verifyC04PurposeKeysForTest(async () => {
          await writeFile(migrationPath, original.replace("COMMIT;", "COMMIT; -- raced"), "utf8");
        }),
      ).rejects.toThrow(/changed during verification/u);
    } finally {
      await writeFile(migrationPath, original, "utf8");
    }
    await expect(verifyC04PurposeKeys()).resolves.toBeDefined();
  });
});
