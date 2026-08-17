import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";
import {
  exportPublicCandidate,
  resolvePublicNoticeBytes,
  selectedPaths,
} from "../../scripts/export-public-candidate.mjs";
import { validateNoticeDocument } from "../../scripts/verify-supply-chain.mjs";

test("selection includes exact public operators and excludes private surfaces", () => {
  assert.deepEqual(
    selectedPaths([
      "apps/web/src/main.tsx",
      "apps/web/public/demo-beat.json",
      "docs/governance/x.md",
      ".github/workflows/ci.yml",
      "AGENTS.md",
      "ci/generated/provenance/H11B-PROV-R16-001.json",
      "docs/hackathon/managed-mcp-queries.json",
      "scripts/h2-crdb-apply-0008.mjs",
      "scripts/h2-crdb-apply-0009.mjs",
      "scripts/h2-crdb-live-attest.mjs",
      "scripts/h2-crdb-live-probe.mjs",
      "scripts/h2-crdb-provider-control.mjs",
      "scripts/package-hackathon-image.mjs",
      "tests/hackathon/h19-lambda-package.test.mjs",
      "tests/hackathon/h19b-image-package.test.mjs",
    ]),
    [
      "apps/web/src/main.tsx",
      "docs/hackathon/managed-mcp-queries.json",
      "scripts/h2-crdb-apply-0008.mjs",
      "scripts/h2-crdb-apply-0009.mjs",
      "scripts/h2-crdb-live-attest.mjs",
      "scripts/h2-crdb-live-probe.mjs",
      "scripts/h2-crdb-provider-control.mjs",
      "scripts/package-hackathon-image.mjs",
      "tests/hackathon/h19-lambda-package.test.mjs",
      "tests/hackathon/h19b-image-package.test.mjs",
    ],
  );
});

test("public default tests exclude only host-bound packaging while shipping their sources", async () => {
  const source = await readFile(
    new URL("../../scripts/export-public-candidate.mjs", import.meta.url),
    "utf8",
  );
  const command = /test: "([^"]+)"/u.exec(source)?.[1];
  assert.equal(
    command,
    "vitest run --exclude tests/hackathon/h19-lambda-package.test.mjs --exclude tests/hackathon/h19b-image-package.test.mjs",
  );
  assert.equal(command?.match(/--exclude /gu)?.length, 2);
  assert.match(source, /forward-only migrations 0001 through 0009/u);
  assert.match(source, /Migrations 0008 and 0009 remain unexecuted/u);
  for (const pin of [
    "56fe92662e3cb6c93b42ff96a0babd240f675be56a786fb1e7038381ac487470",
    "e7a69ec489e3206f0cb0a50b01be099a34e023c6017fd0e895192997aed9381b",
    "93911d8e17dab87907998dbc63c945d3b66978b134779089fee44070d4d5d642",
  ])
    assert.equal(source.includes(pin), true);
});

test("public export preserves the reviewed source NOTICE", async () => {
  const notice = await readFile(new URL("../../NOTICE", import.meta.url));
  const policy = JSON.parse(
    await readFile(new URL("../../ci/b03-policy.json", import.meta.url), "utf8"),
  );
  assert.strictEqual(resolvePublicNoticeBytes(notice, notice, undefined), notice);
  const computedOverlay = { ["NOT" + "ICE"]: notice };
  assert.throws(
    () => resolvePublicNoticeBytes(notice, notice, computedOverlay.NOTICE),
    /public NOTICE differs from source/u,
  );
  assert.throws(
    () => resolvePublicNoticeBytes(notice, Buffer.concat([notice, Buffer.from("x")]), undefined),
    /public NOTICE differs from source/u,
  );
  assert.throws(
    () => resolvePublicNoticeBytes(undefined, notice, undefined),
    /public NOTICE differs from source/u,
  );
  assert.doesNotThrow(() => validateNoticeDocument(notice, policy.notice));
});

test("public export is deterministic across umasks and remains NO-GO", async () => {
  const original = process.umask();
  const outputs = [];
  try {
    process.umask(0o022);
    outputs.push(await exportPublicCandidate({ verifyBuild: false }));
    process.umask(0o077);
    outputs.push(await exportPublicCandidate({ verifyBuild: false }));
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import(${JSON.stringify(new URL("../../scripts/export-public-candidate.mjs", import.meta.url).href)}).then(async m=>process.stdout.write(JSON.stringify(await m.exportPublicCandidate({verifyBuild:false}))))`,
      ],
      { encoding: "utf8", env: { ...process.env, TZ: "Asia/Tokyo" }, shell: false },
    );
    assert.equal(child.status, 0);
    outputs.push(JSON.parse(child.stdout));
    assert.equal(outputs[0].sha256, outputs[1].sha256);
    assert.equal(outputs[0].sha256, outputs[2].sha256);
    assert.equal(outputs[0].aggregate, outputs[1].aggregate);
    assert.equal(outputs[0].status, "LOCAL_PUBLIC_EXPORT_CANDIDATE_NO_GO");
    assert.match(outputs[0].path, /^\/tmp\/zintus-public-[^/]+\/zintus-continuity-public\.zip$/);
    const manifest = JSON.parse(
      await readFile(new URL("manifest.json", `file://${outputs[0].path}`), "utf8"),
    );
    assert.equal(manifest.archiveSha256, outputs[0].sha256);
    assert.equal(manifest.archiveSizeBytes, (await readFile(outputs[0].path)).length);
    const source = await readFile(
      new URL("../../scripts/export-public-candidate.mjs", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "git init",
      "git remote",
      "curl ",
      "https.request",
      "process.env.COCKROACH",
      "process.env.AWS_",
    ])
      assert.equal(source.includes(forbidden), false);
  } finally {
    process.umask(original);
    await Promise.all(
      outputs.map(({ path }) =>
        rm(new URL(".", `file://${path}`).pathname, { recursive: true, force: true }),
      ),
    );
  }
});

test("modeled future H11B provenance does not alter selected inventory while selected mutation fails", () => {
  const digest = (paths) =>
    createHash("sha256")
      .update(`${paths.map((path) => `+${path}`).join("\n")}\n`)
      .digest("hex");
  const baseEntries = [
    "apps/web/src/main.tsx",
    "ci/generated/provenance/H11B-PROV-R16-001.json",
    "docs/hackathon/managed-mcp-queries.json",
    "scripts/h2-crdb-apply-0009.mjs",
  ];
  const withFuture = [
    ...baseEntries,
    "ci/generated/provenance/H11B-PROV-R99-001.json",
    "ci/h11b-cleanroom-policy-r21.json",
  ];
  const selectedBase = selectedPaths(baseEntries);
  const selectedFuture = selectedPaths(withFuture);
  assert.deepEqual(selectedFuture, selectedBase);
  assert.equal(digest(selectedFuture), digest(selectedBase));
  const withSelectedMutation = selectedPaths([...baseEntries, "apps/web/src/api.ts"]);
  assert.notEqual(digest(withSelectedMutation), digest(selectedBase));
});
