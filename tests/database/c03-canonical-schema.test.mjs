import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveC03BindingsForTest,
  deriveC03BindingsFromBytesForTest,
  loadC03ContractBindingsForTest,
  validateB02OccurredAtForTest,
  validateB02PositiveUint64ForTest,
  validateC03MigrationTextForTest,
  verifyC03Schema,
  verifyC03SchemaForTest,
} from "../../scripts/verify-c03-schema.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractsRoot = path.join(repositoryRoot, "packages/contracts/schemas/v1");
const migrationPath = path.join(repositoryRoot, "database/migrations/0001_tenant_event_ledger.sql");

const clone = (value) => JSON.parse(JSON.stringify(value));

describe("C03 canonical tenant event ledger", () => {
  it("accepts the bounded canonical schema without a database connection", async () => {
    await expect(verifyC03Schema()).resolves.toEqual({
      migration: "0001_tenant_event_ledger.sql",
      tables: ["tenants", "payload_anchors", "events"],
    });
  });

  it("binds a closed exact B02 event and envelope contract", async () => {
    const eventContract = JSON.parse(
      await readFile(path.join(contractsRoot, "event.schema.json"), "utf8"),
    );
    const envelopeContract = JSON.parse(
      await readFile(path.join(contractsRoot, "envelope.schema.json"), "utf8"),
    );
    const bindings = await loadC03ContractBindingsForTest();
    expect(bindings.schemaVersion).toBe("zc.contracts.v1");
    expect(bindings.eventTypes).toEqual([
      "interaction.appended",
      "memory.revision.recorded",
      "response.recorded",
      "task.checkpointed",
    ]);
    for (const mutate of [
      (event) => (event.not = {}),
      (event) => (event.$ref = "https://example.invalid/unsafe.json"),
      (event) => event.required.shift(),
      (event) => delete event.properties.payloadRef,
      (event) => (event.properties.contractFamily.const = "unsafe"),
      (_event, envelope) => (envelope.$defs.dateTime.format = "unsafe"),
      (_event, envelope) => (envelope.$defs.identifier.maxLength = 1_000),
    ]) {
      const event = clone(eventContract);
      const envelope = clone(envelopeContract);
      mutate(event, envelope);
      expect(() => deriveC03BindingsForTest(event, envelope)).toThrow(/contract binding failed/u);
    }
  });

  it("rejects byte-level B02 source substitution before parsing", async () => {
    const eventBytes = await readFile(path.join(contractsRoot, "event.schema.json"));
    const envelopeBytes = await readFile(path.join(contractsRoot, "envelope.schema.json"));
    expect(deriveC03BindingsFromBytesForTest(eventBytes, envelopeBytes)).toBeDefined();
    const eventSource = eventBytes.toString("utf8");
    const envelopeSource = envelopeBytes.toString("utf8");
    const substitutions = [
      [
        eventSource.replace("urn:zintus-continuity:contracts:v1:event", "urn:unsafe:event"),
        envelopeSource,
      ],
      [
        eventSource.replace(
          "https://json-schema.org/draft/2020-12/schema",
          "https://example.invalid/schema",
        ),
        envelopeSource,
      ],
      [
        eventSource.replace("Continuity immutable event metadata v1", "Unsafe event metadata"),
        envelopeSource,
      ],
      [
        eventSource,
        envelopeSource.replace(
          "https://json-schema.org/draft/2020-12/schema",
          "https://example.invalid/schema",
        ),
      ],
      [
        eventSource,
        envelopeSource.replace(
          "urn:zintus-continuity:contracts:v1:envelope",
          "urn:unsafe:envelope",
        ),
      ],
      [
        eventSource,
        envelopeSource.replace("Continuity contract reusable bindings v1", "Unsafe envelope"),
      ],
      [eventSource, envelopeSource.replace('"$defs": {', '"not": {},\n  "$defs": {')],
      [eventSource, envelopeSource.replace('"externalTuple": {', '"externalTuple": { "not": {},')],
    ];
    for (const [event, envelope] of substitutions)
      expect(() =>
        deriveC03BindingsFromBytesForTest(Buffer.from(event), Buffer.from(envelope)),
      ).toThrow(/byte hash differs from exact B02/u);
  });

  it("enforces uint64 and calendar-valid B02 pre-write values", async () => {
    const bindings = await loadC03ContractBindingsForTest();
    expect(validateB02PositiveUint64ForTest("18446744073709551615", bindings)).toBe(true);
    expect(() => validateB02PositiveUint64ForTest("18446744073709551616", bindings)).toThrow(
      /exceeds uint64 maximum/u,
    );
    expect(validateB02OccurredAtForTest("2026-07-31T21:36:04.123Z", bindings)).toBe(true);
    expect(() => validateB02OccurredAtForTest("2026-02-30T21:36:04.123Z", bindings)).toThrow(
      /calendar-valid/u,
    );
  });

  it("rejects in-memory transaction, tuple, encoding, and FK regressions", async () => {
    const source = await readFile(migrationPath, "utf8");
    const bindings = await loadC03ContractBindingsForTest();
    const mutations = [
      `${source}${" ".repeat(32 * 1024)}`,
      source.replace("18446744073709551615", "18446744073709551616"),
      source.replace("TIMESTAMPTZ NOT NULL", "STRING NOT NULL"),
      source.replace("payload_tenant_id = tenant_id", "payload_tenant_id <> tenant_id"),
      source.replace(
        "payload_requested_purpose = requested_purpose",
        "payload_requested_purpose <> requested_purpose",
      ),
      source.replace(
        "payload_server_purpose = server_purpose",
        "payload_server_purpose <> server_purpose",
      ),
      source.replace(
        "payload_tenant_id IS NULL AND payload_ref IS NULL AND payload_revision IS NULL AND payload_requested_purpose IS NULL AND payload_server_purpose IS NULL",
        "payload_tenant_id IS NULL",
      ),
      source.replace("MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT", "MATCH FULL"),
      source.replace(
        "ON DELETE RESTRICT ON UPDATE RESTRICT",
        "ON DELETE SET NULL ON UPDATE RESTRICT",
      ),
      source.replace("COMMIT;", "COMMIT;\nGRANT SELECT ON continuity.events TO public;"),
      source.replace("\n", "\r\n"),
      source.slice(0, -1),
      `${source}\n`,
    ];
    for (const mutation of mutations)
      expect(() => validateC03MigrationTextForTest(mutation, bindings)).toThrow(
        /C03 schema|C03 migration/u,
      );
    expect(source).toContain(
      "payload_tenant_id IS NULL AND payload_ref IS NULL AND payload_revision IS NULL AND payload_requested_purpose IS NULL AND payload_server_purpose IS NULL",
    );
    expect(validateC03MigrationTextForTest(source, bindings)).toBe(true);
  });

  it("detects same-size mutation after reads and migration addition after discovery", async () => {
    const original = await readFile(migrationPath, "utf8");
    const extraMigration = path.join(path.dirname(migrationPath), "0002_test_only.sql");
    try {
      await expect(
        verifyC03SchemaForTest(async () => {
          await writeFile(migrationPath, original.replace("TIMESTAMPTZ", "TIMESTAMPA"), "utf8");
        }),
      ).rejects.toThrow(/changed during C03 verification/u);
    } finally {
      await writeFile(migrationPath, original, "utf8");
    }
    try {
      await expect(
        verifyC03SchemaForTest(async () => {
          await writeFile(extraMigration, "SELECT 1;\n", "utf8");
        }),
      ).rejects.toThrow(/changed during C03 verification|migration list changed/u);
    } finally {
      await rm(extraMigration, { force: true });
    }
    await expect(verifyC03Schema()).resolves.toBeDefined();
  });
});
