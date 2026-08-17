import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readC05MigrationBytesAtPathForTest,
  validateC05PayloadStorageBytesForTest,
  validateC05PayloadStorageTextForTest,
  verifyC05PayloadStorage,
} from "../../scripts/verify-c05-payload-storage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseRoot = path.join(root, "database");
const migrationPath = path.join(root, "database/migrations/0004_erasable_payload_storage.sql");
const keyAnchorBinding = `FOREIGN KEY (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  ) REFERENCES continuity.payload_key_anchors (
    tenant_id,
    server_purpose,
    payload_ref,
    payload_revision,
    requested_purpose,
    key_scope_id,
    sensitivity_class,
    crypto_domain_version,
    retention_origin_created_at,
    retention_expires_at
  )`;

describe("C05 encrypted erasable payload storage", () => {
  it("accepts the bounded fail-closed four-table schema", async () => {
    await expect(verifyC05PayloadStorage()).resolves.toEqual({
      migration: "0004_erasable_payload_storage.sql",
      tables: [
        "payload_key_anchors",
        "payload_revision_material",
        "payload_wrapped_keys",
        "payload_superseded_wrapped_keys",
      ],
    });
  });

  it("rejects security and retention weakenings", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const [from, to] of [
      ["sensitivity_class = 'synthetic'", "sensitivity_class <> ''"],
      ["INTERVAL '24 hours'", "INTERVAL '30 days'"],
      ["envelope_format_version = 1", "envelope_format_version >= 1"],
      ["aead_algorithm = 'AES-256-GCM'", "aead_algorithm <> ''"],
      ["length(nonce_96) = 12", "length(nonce_96) > 0"],
      ["length(tag_128) = 16", "length(tag_128) > 0"],
      ["length(ciphertext) BETWEEN 1 AND 65536", "length(ciphertext) > 0"],
      ["expires_at = retention_expires_at", "expires_at >= retention_expires_at"],
      ["ON DELETE RESTRICT", "ON DELETE CASCADE"],
      ["REVOKE ALL PRIVILEGES", "GRANT ALL PRIVILEGES"],
      ["FORCE ROW LEVEL SECURITY", "NO FORCE ROW LEVEL SECURITY"],
      ["tenant_id, server_purpose, key_scope_id", "tenant_id, key_scope_id"],
    ]) {
      const mutated = source.replace(from, to);
      expect(mutated, from).not.toBe(source);
      expect(() => validateC05PayloadStorageTextForTest(mutated), from).toThrow();
    }
  });

  it("rejects missing exact child bindings and forbidden content-derived fields", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const [from, to] of [
      [
        "REFERENCES continuity.payload_key_anchors (\n    tenant_id,\n    server_purpose,\n    payload_ref,\n    payload_revision,\n    requested_purpose,\n    key_scope_id,\n    sensitivity_class,",
        "REFERENCES continuity.payload_key_anchors (\n    tenant_id,\n    server_purpose,\n    payload_ref,\n    payload_revision,\n    requested_purpose,\n    key_scope_id,\n    wrong_sensitivity_class,",
      ],
      [
        "  retention_expires_at TIMESTAMPTZ NOT NULL,",
        "  retention_deadline TIMESTAMPTZ NOT NULL,",
      ],
      [
        "FOREIGN KEY (tenant_id, server_purpose, payload_ref, payload_revision, requested_purpose)\n    REFERENCES continuity.payload_anchors",
        "FOREIGN KEY (tenant_id, server_purpose, payload_ref, payload_revision, server_purpose)\n    REFERENCES continuity.payload_anchors",
      ],
      [
        "CHECK (created_at >= retention_origin_created_at)",
        "CHECK (created_at >= retention_origin_created_at - INTERVAL '1 day')",
      ],
      ["  deletion_epoch DECIMAL", "  plaintext BYTES,\n  deletion_epoch DECIMAL"],
      [
        "  deletion_epoch DECIMAL",
        "  internal_body_locator STRING NOT NULL,\n  deletion_epoch DECIMAL",
      ],
      [
        "  lifecycle_state STRING NOT NULL CHECK (lifecycle_state = 'active'),",
        "  content_digest STRING,\n  lifecycle_state STRING NOT NULL CHECK (lifecycle_state = 'active'),",
      ],
    ]) {
      const mutated = source.replace(from, to);
      expect(mutated, from).not.toBe(source);
      expect(() => validateC05PayloadStorageTextForTest(mutated), from).toThrow();
    }
  });

  it("rejects controls and bindings that exist only in comments", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const [control, comment] of [
      [
        "CHECK (retention_expires_at <= retention_origin_created_at + INTERVAL '24 hours')",
        "block",
      ],
      ["REVOKE ALL PRIVILEGES ON TABLE continuity.payload_key_anchors FROM PUBLIC;", "line"],
      ["ALTER TABLE continuity.payload_key_anchors FORCE ROW LEVEL SECURITY;", "block"],
    ]) {
      const mutated = source.replace(
        control,
        comment === "line" ? `-- ${control}` : `/* ${control} */`,
      );
      expect(mutated, control).not.toBe(source);
      expect(() => validateC05PayloadStorageTextForTest(mutated), control).toThrow();
    }

    const wrongBinding = keyAnchorBinding.replace(
      "REFERENCES continuity.payload_key_anchors",
      "REFERENCES continuity.payload_anchors",
    );
    const mutated = source
      .replace(keyAnchorBinding, wrongBinding)
      .replace("\nCOMMIT;", `\n/* ${keyAnchorBinding} */\n\nCOMMIT;`);
    expect(() => validateC05PayloadStorageTextForTest(mutated)).toThrow(/stable key anchor/u);
  });

  it("rejects case and quoting bypasses that add ungoverned byte tables", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const table of ["continuity.rogue_bytes", 'continuity."rogue_bytes"']) {
      const mutated = source.replace(
        "\nCOMMIT;",
        `\n\ncreate table ${table} (\n  rogue_material bytes not null\n);\n\nCOMMIT;`,
      );
      expect(() => validateC05PayloadStorageTextForTest(mutated), table).toThrow();
    }
  });

  it("rejects post-creation constraint drops and non-strict child expiry", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const statement of [
      "ALTER TABLE continuity.payload_revision_material DROP CONSTRAINT payload_revision_material_payload_key_anchors_fkey;",
      "ALTER TABLE continuity.payload_revision_material DROP CONSTRAINT payload_revision_material_fixed_expiry_check;",
    ]) {
      const mutated = source.replace("\nCOMMIT;", `\n\n${statement}\n\nCOMMIT;`);
      expect(() => validateC05PayloadStorageTextForTest(mutated), statement).toThrow(
        /unexpected ALTER TABLE/u,
      );
    }
    for (const [from, to] of [
      ["CHECK (created_at < expires_at)", "CHECK (created_at <= expires_at)"],
      ["CHECK (superseded_at < expires_at)", "CHECK (superseded_at <= expires_at)"],
    ]) {
      const mutated = source.replace(from, to);
      expect(mutated, from).not.toBe(source);
      expect(() => validateC05PayloadStorageTextForTest(mutated), from).toThrow();
    }
  });

  it("rejects weakening clauses combined with required RLS actions", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const [from, to] of [
      [
        "ALTER TABLE continuity.payload_key_anchors ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE continuity.payload_key_anchors DROP CONSTRAINT payload_scope_fkey, ENABLE ROW LEVEL SECURITY;",
      ],
      [
        "ALTER TABLE continuity.payload_revision_material ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE continuity.payload_revision_material ADD COLUMN emergency_blob BYTES, ENABLE ROW LEVEL SECURITY;",
      ],
      [
        "ALTER TABLE continuity.payload_wrapped_keys FORCE ROW LEVEL SECURITY;",
        "ALTER TABLE continuity.payload_wrapped_keys RENAME COLUMN tenant_id TO emergency_tenant, FORCE ROW LEVEL SECURITY;",
      ],
    ]) {
      const mutated = source.replace(from, to);
      expect(mutated, from).not.toBe(source);
      expect(() => validateC05PayloadStorageTextForTest(mutated), from).toThrow(/exact RLS set/u);
    }
  });

  it("rejects every executable statement outside the closed migration inventory", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const statement of [
      "DROP TABLE continuity.payload_revision_material;",
      "DROP CONSTRAINT payload_scope_fkey;",
      "CREATE ROLE emergency_reader;",
      "COMMENT ON TABLE continuity.payload_key_anchors IS 'quoted;semicolon';",
    ]) {
      const mutated = source.replace("\nCOMMIT;", `\n\n${statement}\n\nCOMMIT;`);
      expect(() => validateC05PayloadStorageTextForTest(mutated), statement).toThrow(
        /statement inventory/u,
      );
    }
  });

  it("rejects required checks stuffed into dollar-quoted or ordinary strings", async () => {
    const source = await readFile(migrationPath, "utf8");
    for (const [from, to] of [
      [
        "sensitivity_class STRING NOT NULL CHECK (sensitivity_class = 'synthetic'),",
        "sensitivity_class STRING NOT NULL DEFAULT $$CHECK (sensitivity_class = 'synthetic')$$,",
      ],
      [
        "  CHECK (expires_at = retention_expires_at),",
        "  CHECK (TRUE),\n  bogus STRING DEFAULT 'CHECK (expires_at = retention_expires_at)',",
      ],
    ]) {
      const mutated = source.replace(from, to);
      expect(mutated, from).not.toBe(source);
      expect(() => validateC05PayloadStorageTextForTest(mutated), from).toThrow();
    }
  });

  it("binds exact canonical raw bytes before UTF-8 decoding", async () => {
    const bytes = await readFile(migrationPath);
    expect(validateC05PayloadStorageBytesForTest(bytes)).toBe(true);
    expect(() =>
      validateC05PayloadStorageBytesForTest(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
      ),
    ).toThrow(/BOM/u);

    const invalidUtf8 = Buffer.from(bytes);
    invalidUtf8[0] = 0xff;
    expect(() => validateC05PayloadStorageBytesForTest(invalidUtf8)).toThrow();
    expect(() =>
      validateC05PayloadStorageBytesForTest(
        Buffer.from(bytes.toString("utf8").replaceAll("\n", "\r\n")),
      ),
    ).toThrow(/raw bytes/u);
  });

  it("rejects pre-open and post-read pathname replacement races on temporary fixtures", async () => {
    const canonical = await readFile(migrationPath);
    for (const stage of ["after-list", "after-read"]) {
      const temporary = await mkdtemp(path.join(databaseRoot, `.c05-read-${stage}-`));
      const candidate = path.join(temporary, "0004.sql");
      const original = path.join(temporary, "0004.original.sql");
      await writeFile(candidate, canonical, { mode: 0o644 });
      try {
        await expect(
          readC05MigrationBytesAtPathForTest(candidate, async (current) => {
            if (current !== stage) return;
            await rename(candidate, original);
            await writeFile(candidate, "malicious\n", { mode: 0o644 });
          }),
          stage,
        ).rejects.toThrow(/changed/u);
      } finally {
        await rm(temporary, { recursive: true });
      }
    }
    await expect(verifyC05PayloadStorage()).resolves.toBeDefined();
  });

  it("rejects a grandparent renamed away and restored after reading", async () => {
    const temporary = await mkdtemp(path.join(databaseRoot, ".c05-ancestor-race-"));
    const grandparent = path.join(temporary, "grandparent");
    const moved = path.join(temporary, "grandparent.moved");
    const parent = path.join(grandparent, "parent");
    const candidate = path.join(parent, "0004.sql");
    await mkdir(parent, { recursive: true });
    await writeFile(candidate, await readFile(migrationPath), { mode: 0o644 });
    try {
      await expect(
        readC05MigrationBytesAtPathForTest(candidate, async (stage) => {
          if (stage !== "after-read") return;
          await rename(grandparent, moved);
          await rename(moved, grandparent);
        }),
      ).rejects.toThrow(/pathname changed/u);
    } finally {
      await rm(temporary, { recursive: true });
    }
    await expect(verifyC05PayloadStorage()).resolves.toBeDefined();
  });
});
