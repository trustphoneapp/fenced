import { createHash } from "node:crypto";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  predecessorTargets,
  provenanceTarget,
  requireFinalizerPrestate,
  sameBoundIdentity,
} from "../../scripts/generate-b03-local-evidence.mjs";
import { safeCreateEvidence, safeWriteEvidence } from "../../scripts/safe-evidence-writer.mjs";
import {
  acceptedB05Predecessor,
  acceptedC01R9,
  acceptedH01R2,
  acceptedH02CR4,
  acceptedR12,
  buildSupplyChainArtifacts,
  burnedC05R1Policy,
  burnedC05R2Policy,
  candidateHistory,
  collectInstalledLicenseEvidence,
  failedH01R1,
  failedH02CR5,
  failedH11bR11,
  failedH11bR21,
  failedH11bR24,
  failedH11bR28,
  failedH11bR30,
  immutableC05R10,
  licenseFor,
  lockComponents,
  lockIdentities,
  parseSupplyChainOperation,
  provenanceOutputAllowlist,
  requireAllowedInstalledNotices,
  requireExactInventoryTransition,
  reviewedNoticeAllowlist,
  runH02cCiInventory,
  sbomOutputAllowlist,
  scanInstalledPackageTextEvidence,
  sealedH11bR23,
  validateAcceptedC01R5,
  validateAcceptedC01R9,
  validateAcceptedC02R2,
  validateAcceptedC03R2,
  validateAcceptedC03R3,
  validateAcceptedC03R4,
  validateAcceptedC04R1,
  validateAcceptedC04R2,
  validateAcceptedC04R3,
  validateAcceptedH01R2,
  validateAcceptedH02CR4,
  validateAcceptedR12,
  validateCandidateHistory,
  validateFailedC01R6,
  validateFailedC01R7,
  validateFailedC01R8,
  validateFailedC02R1,
  validateFailedC03R1,
  validateFailedH01R1,
  validateFailedH02CR5,
  validateGovernedUniverse,
  validateH02CProvenancePolicy,
  validateHistoricalB05Predecessor,
  validateImmutableC05R10,
  validateLicenseDecision,
  validateLicenseRules,
  validateNoticeDocument,
  validatePolicyRelativePath,
  validatePredecessorMeanings,
  validateSealedH11bHistory,
} from "../../scripts/verify-supply-chain.mjs";
import {
  collectToolPayloadInventory,
  collectTrustBaseline,
  postPreflightValidatorBootstrapProfile,
  requireStrictUtf8Order,
  trustAnchorPaths,
  utf8Order,
  validateTrustBaselineIdentity,
  verifyTrustPreflight,
} from "../../scripts/verify-trust-preflight.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const quarantinePath =
  ".c06-e0085-r45-preimage-capture-662b9ffcfe0c01bb0661da805e090bb57928fdb422c7499b310385dd25461981.bin";
const opaqueWorktreeRoot = ".worktrees";
const finalizerState = async (root = repositoryRoot) => {
  const target = path.join(root, provenanceTarget);
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return "preseal";
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o644 ||
    stat.nlink !== 1 ||
    (await realpath(target)) !== target
  )
    throw new Error("finalizer state target is not canonical");
  const record = JSON.parse(await readFile(target, "utf8"));
  if (
    record.record_id !== "H11B-PROV-R51-001" ||
    record.task_id !== "H11B" ||
    record.operational_actor?.public_id !== "codex-h11b-finalizer-r51-worker" ||
    record.predicate?.predicate_type !== "zintus-continuity.local-unsigned-provenance@85"
  )
    throw new Error("finalizer state record differs");
  return "postseal";
};

describe("H02C deterministic supply-chain successor", () => {
  it("accepts only the exact four one-argument operations", () => {
    for (const operation of [
      "--verify",
      "--verify-sbom",
      "--create-provenance",
      "--h02c-ci-inventory",
    ])
      expect(parseSupplyChainOperation(["node", "verify-supply-chain.mjs", operation])).toBe(
        operation,
      );
    for (const argv of [
      ["node", "verify-supply-chain.mjs"],
      ["node", "verify-supply-chain.mjs", "--unknown"],
      ["node", "verify-supply-chain.mjs", "--verify", "extra"],
    ])
      expect(() => parseSupplyChainOperation(argv)).toThrow(/exactly one/u);
  });

  it("binds the separate C06 completion state and the owner-selected C07 continuation transition", async () => {
    const [manifest, status, closure] = await Promise.all([
      readFile(path.join(repositoryRoot, "docs/implementation/task-manifest.yaml"), "utf8"),
      readFile(path.join(repositoryRoot, "docs/implementation/status.md"), "utf8"),
      readFile(
        path.join(repositoryRoot, "docs/hackathon/evidence/h02c-c06-closure.json"),
        "utf8",
      ).then(JSON.parse),
    ]);
    expect(manifest).toContain("effective_counts: 26/0/67");
    expect(manifest).toContain("effective_pending: none");
    expect(manifest).toContain(
      "id: C06, title: Immutable event metadata and corrections, dependencies: [C04, C05], risk: high, gates: [], owner_role: sol, status: complete",
    );
    expect(manifest).toContain(
      "id: C07, title: Transactional outbox inbox and consumers, dependencies: [C03, C06], risk: critical, gates: [], owner_role: sol/architect, status: complete",
    );
    expect(status).toContain("`26 complete / 0 pending / 67 blocked`");
    expect(closure.authoritativeCompletionState).toEqual(
      expect.objectContaining({
        C06: "complete",
        C07: "blocked",
        totals: "25/0/68",
        pending: "NONE",
        c07Selection: "NOT_SELECTED_SEPARATE_ACTION_REQUIRED",
      }),
    );
    expect(closure.acceptedR4ProvenanceCheckpoint).toEqual(
      expect.objectContaining({
        recordId: acceptedH02CR4.recordId,
        path: acceptedH02CR4.path,
        bytes: acceptedH02CR4.bytes,
        sha256: acceptedH02CR4.sha256,
        aggregate: acceptedH02CR4.aggregate,
        subjectCount: 337,
      }),
    );
    expect(closure.failedR5Review).toEqual(
      expect.objectContaining({
        recordId: failedH02CR5.recordId,
        path: failedH02CR5.path,
        bytes: failedH02CR5.bytes,
        sha256: failedH02CR5.sha256,
        aggregate: failedH02CR5.aggregate,
        subjectCount: 338,
        disposition: "IMMUTABLE_FAILED_REVIEW_IMMEDIATE_PREDECESSOR",
      }),
    );
    expect(closure.provenanceCandidate).toEqual(
      expect.objectContaining({ recordId: "H02C-PROV-R6-001", subjectCount: 339 }),
    );
    expect(manifest).toContain("No C08+ work starts automatically");
    expect(status).toContain("Current tasks: no successor is activated automatically");
    expect(status).toContain("C08+ remain blocked");
  });

  it("binds one bounded held-source inventory controller and the open hostile-host risk", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts/verify-supply-chain.mjs"),
      "utf8",
    );
    expect(source.match(/from "node:child_process"/gu)).toHaveLength(1);
    expect(source.match(/\bspawn\(/gu)).toHaveLength(1);
    expect(source).toContain("source: 65536");
    expect(source).toContain("stdin: 1048576");
    expect(source).toContain("stdout: 1048576");
    expect(source).toContain("stderr: 65536");
    expect(source).toContain("timeout: 30000");
    expect(source).toContain('"LOCAL_UNSIGNED_UNAUTHENTICATED_BUILD_EVIDENCE_ONLY"');
    expect(source).toContain('"HOSTILE_LOCAL_ACTOR_RISK_OPEN"');
    expect(source).toContain('"FABRICATED_STRUCTURALLY_VALID_STDIN_MAY_PASS"');
    expect(source).toContain('"PREIMAGE_CAPTURE_SESSION_AUTHENTICITY_UNPROVEN"');
    expect(source).toContain('"__CF_USER_TEXT_ENCODING=0x1F5:0x0:0x0"');
    expect(source).toContain('"-c",\n      sourceText,\n      "--",\n      sourceSha256');
    expect(source).toContain("env: {},\n      shell: false");
    expect(source).not.toContain("HOSTILE_LOCAL_ACTOR_RISK_CLOSED");
    expect(source).not.toContain("AUTHENTICATED_PROVENANCE");
    await expect(runH02cCiInventory("not-a-buffer")).rejects.toThrow(/bounded Buffer/u);
    const capture = JSON.parse(await runH02cCiInventory());
    expect(capture.schema).toBe("H02C_CI_INVENTORY_V1");
    expect(capture.mode).toBe("capture");
    expect(capture).not.toHaveProperty("changedTargets");
    expect(capture.inventory.count).toBe(capture.inventory.records.length);
  });

  it("requires the exact ordered three-target inventory delta and rejects every non-exact case", async () => {
    const targets = [
      "ci/installed-license-evidence.json",
      "ci/tool-payload-inventory.json",
      "ci/trust-baseline.json",
    ];
    const record = (relative, index, type = "regular") => ({
      path: relative,
      type,
      dev: "1",
      ino: String(index + 10),
      mode: type === "directory" ? "0755" : "0644",
      nlink: "1",
      size: String(index + 100),
      mtimeNs: String(index + 1000),
      ctimeNs: String(index + 2000),
      sha256: type === "directory" ? null : String(index).padStart(64, "0"),
    });
    const inventory = (records) => ({
      records,
      count: records.length,
      aggregate: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    });
    const currentRecords = [
      record("ci", 0, "directory"),
      record(targets[0], 1),
      record("ci/non-target.json", 2),
      record(targets[1], 3),
      record(targets[2], 4),
    ];
    const current = inventory(currentRecords);
    const delta = (count) => {
      const records = structuredClone(currentRecords);
      for (const target of targets.slice(0, count)) {
        const item = records.find(({ path: relative }) => relative === target);
        item.size = String(Number(item.size) + 1);
        item.mtimeNs = String(Number(item.mtimeNs) + 1);
        item.ctimeNs = String(Number(item.ctimeNs) + 1);
        item.sha256 = "f".repeat(64);
      }
      return inventory(records);
    };
    for (const count of [0, 1, 2])
      expect(() => requireExactInventoryTransition(current, delta(count))).toThrow();
    expect(requireExactInventoryTransition(current, delta(3))).toEqual(targets);

    const reordered = delta(3);
    [reordered.records[1], reordered.records[3]] = [reordered.records[3], reordered.records[1]];
    expect(() => requireExactInventoryTransition(current, reordered)).toThrow();
    const duplicated = delta(3);
    duplicated.records[3] = structuredClone(duplicated.records[1]);
    expect(() => requireExactInventoryTransition(current, duplicated)).toThrow();
    const extra = delta(3);
    extra.records.push(record("ci/extra.json", 5));
    extra.count += 1;
    expect(() => requireExactInventoryTransition(current, extra)).toThrow();
    const structural = delta(3);
    delete structural.records[1].sha256;
    expect(() => requireExactInventoryTransition(current, structural)).toThrow();
    const directory = delta(3);
    directory.records[0].mtimeNs = "9999";
    expect(() => requireExactInventoryTransition(current, directory)).toThrow();
    const nonTarget = delta(3);
    nonTarget.records[2].sha256 = "e".repeat(64);
    expect(() => requireExactInventoryTransition(current, nonTarget)).toThrow();

    const [nodeSource, pythonSource] = await Promise.all([
      readFile(path.join(repositoryRoot, "scripts/verify-supply-chain.mjs"), "utf8"),
      readFile(path.join(repositoryRoot, "scripts/h02c-ci-inventory.py"), "utf8"),
    ]);
    expect(nodeSource).toContain("JSON.stringify(changed) !== JSON.stringify(expectedTargets)");
    expect(nodeSource).toContain(
      "JSON.stringify(value.changedTargets) !== JSON.stringify(expectedTargets)",
    );
    expect(pythonSource).toContain("if changed != expected:");
    expect(nodeSource).toContain("await buildSupplyChainArtifacts()");
  });

  it("structurally uses one combined quarantine discovery in the supply builder", async () => {
    const text = await readFile(
      path.join(repositoryRoot, "scripts", "verify-supply-chain.mjs"),
      "utf8",
    );
    const source = ts.createSourceFile(
      "verify-supply-chain.mjs",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const cleanroomImports = source.statements
      .filter(ts.isImportDeclaration)
      .filter((node) => node.moduleSpecifier.getText(source) === '"./verify-cleanroom.mjs"')
      .flatMap((node) => node.importClause?.namedBindings?.elements ?? [])
      .map((node) => node.name.text);
    expect(cleanroomImports).toEqual(["discoverSupplyChainInputs"]);
    const builder = source.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === "buildSupplyChainArtifacts",
    );
    expect(builder && ts.isFunctionDeclaration(builder) ? builder.body : undefined).toBeDefined();
    const calls = [];
    const inspect = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        calls.push(node.expression.text);
      ts.forEachChild(node, inspect);
    };
    if (builder && ts.isFunctionDeclaration(builder) && builder.body) inspect(builder.body);
    expect(calls.filter((name) => name === "discoverSupplyChainInputs")).toHaveLength(1);
    expect(calls).not.toContain("readQuarantinedHistoricalSubjectIdentity");
    expect(calls).not.toContain("discoverGovernedFiles");
  });

  it("defines the exact limited post-preflight validator bootstrap R19 profile", () => {
    const profile = postPreflightValidatorBootstrapProfile;
    const exactNewAnchors = [
      "scripts/bounded-typescript-ast.mjs",
      "scripts/lexical-bindings.mjs",
      "scripts/path-safety.mjs",
      "scripts/safe-own-data.mjs",
    ];
    const strictlyOrderedUnique = (values) => {
      expect(Array.from(new Set(values))).toHaveLength(values.length);
      expect(Array.from(values).sort(utf8Order)).toEqual(values);
    };
    const historicalAnchorPaths = trustAnchorPaths.filter(
      (relative) =>
        ![
          "ci/h11b-cleanroom-policy-r2.json",
          "ci/h11b-cleanroom-policy-r3.json",
          "ci/h11b-cleanroom-policy-r4.json",
          "ci/h11b-cleanroom-policy-r5.json",
          "ci/h11b-cleanroom-policy-r6.json",
          "ci/h11b-cleanroom-policy-r7.json",
          "ci/h11b-cleanroom-policy-r8.json",
          "ci/h11b-cleanroom-policy-r9.json",
          "ci/h11b-cleanroom-policy-r10.json",
          "ci/h11b-cleanroom-policy-r11.json",
          "ci/h11b-cleanroom-policy-r12.json",
          "ci/h11b-cleanroom-policy-r13.json",
          "ci/h11b-cleanroom-policy-r14.json",
          "ci/h11b-cleanroom-policy-r15.json",
          "ci/h11b-cleanroom-policy-r16.json",
          "ci/h11b-cleanroom-policy-r17.json",
          "ci/h11b-cleanroom-policy-r18.json",
          "ci/h11b-cleanroom-policy-r19.json",
          "ci/h11b-cleanroom-policy-r20.json",
          "ci/h11b-cleanroom-policy-r24.json",
          "ci/h11b-cleanroom-policy-r27.json",
          "ci/h11b-cleanroom-policy-r28.json",
          "ci/h11b-cleanroom-policy-r29.json",
          "ci/h11b-cleanroom-policy-r30.json",
          "ci/h11b-cleanroom-policy-r31.json",
          "ci/h11b-cleanroom-policy-r32.json",
          "ci/h11b-cleanroom-policy-r36.json",
          "ci/h11b-cleanroom-policy-r37.json",
          "ci/h11b-cleanroom-policy-r38.json",
          "ci/h11b-cleanroom-policy-r39.json",
          "ci/h11b-cleanroom-policy-r40.json",
          "ci/h11b-cleanroom-policy-r41.json",
          "ci/h11b-cleanroom-policy-r42.json",
          "ci/h11b-cleanroom-policy-r43.json",
          "ci/h11b-cleanroom-policy-r44.json",
          "scripts/generate-b03-local-evidence.mjs",
        ].includes(relative),
    );
    const anchorBytes = Buffer.from(JSON.stringify(historicalAnchorPaths), "utf8");
    const profileBytes = Buffer.from(JSON.stringify(profile), "utf8");

    expect(anchorBytes).toHaveLength(1794);
    expect(createHash("sha256").update(anchorBytes).digest("hex")).toBe(
      "be0952f4c51d06c65eba52f945ce81fcafd65bd9e2ddb136501a23eae91eff0b",
    );
    expect(profileBytes).toHaveLength(1291);
    expect(createHash("sha256").update(profileBytes).digest("hex")).toBe(
      "190f91b74eed91d35f8893bed1c8f17400abb037f51adc02967b5f5ab4bb7956",
    );
    expect(historicalAnchorPaths).toHaveLength(53);
    expect(trustAnchorPaths).toHaveLength(87);
    expect(profile.nodes).toHaveLength(10);
    expect(profile.roots).toHaveLength(5);
    expect(profile.limitations).toHaveLength(2);
    strictlyOrderedUnique(historicalAnchorPaths);
    strictlyOrderedUnique(trustAnchorPaths);
    strictlyOrderedUnique(profile.nodes);
    strictlyOrderedUnique(profile.roots);
    strictlyOrderedUnique(profile.limitations);
    expect(trustAnchorPaths.filter((entry) => exactNewAnchors.includes(entry))).toEqual(
      exactNewAnchors,
    );
    expect(profile.profileId).toBe("POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_V1");
    expect(profile.profileRevision).toBe(18);
    expect(profile.closurePassLabel).toBe("POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_CLOSURE_PASS");
    expect(profile.derivationMatchLabel).toBe(
      "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_DERIVATION_MATCH",
    );
    expect(profile.maxNodeBytes).toBe(131_072);
    expect(profile.maxTotalNodeBytes).toBe(262_144);
    expect(profile.sourceEncodingProfile).toBe("STRICT_UTF8_NO_BOM_LF_FINAL_V1");
    expect(profile.fileIdentityProfile).toBe("CANONICAL_REGULAR_0644_NLINK1_UNIQUE_DEV_INO_V1");
    expect(profile.edgeCount).toBe(15);
    expect(profile.edgeDigestPrefix).toBe(
      "POST_PREFLIGHT_VALIDATOR_BOOTSTRAP_V1\0EDGE_TOPOLOGY_V1\0",
    );
    expect(Buffer.byteLength(profile.edgeDigestPrefix, "utf8")).toBe(55);
    expect(profile.edgeDigestPrefixBytes).toBe(55);
    expect(profile.edgeDigestVersion).toBe("EDGE_TOPOLOGY_V1");
    expect(profile.edgeJsonBytes).toBe(2149);
    expect(profile.edgeSha256).toBe(
      "4be5f6dc5bcb4d3bea8206bd338f021be2da3e1080d9011504fa4faebe1093b6",
    );
    expect(profile.limitations).toEqual([
      "FULL_TRUST_ANCHOR_RUNTIME_CLOSURE_UNPROVEN",
      "PHASE0_PREEXECUTION_TRUST_UNPROVEN",
    ]);
    for (const root of profile.roots) expect(profile.nodes).toContain(root);
    for (const node of profile.nodes) expect(trustAnchorPaths).toContain(node);
    expect(Object.isFrozen(trustAnchorPaths)).toBe(true);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.limitations)).toBe(true);
    expect(Object.isFrozen(profile.nodes)).toBe(true);
    expect(Object.isFrozen(profile.roots)).toBe(true);
  });

  it("preserves immutable H02C history while rejecting stale sealed artifacts", async () => {
    const [sbomBytes, provenanceBytes] = await Promise.all([
      readFile(path.join(repositoryRoot, "ci/generated/sbom.cdx.json")),
      readFile(path.join(repositoryRoot, "ci/generated/provenance/H02C-PROV-R6-001.json")),
    ]);
    expect(createHash("sha256").update(sbomBytes).digest("hex")).toBe(
      "6ca1a287410c200cbb3cd76a38a459d15527febadecdab5943eb414f4a855c03",
    );
    expect(createHash("sha256").update(provenanceBytes).digest("hex")).toBe(
      "59b7960eca4ca6613c088f61a3513307b7ce26a40d6381f362f9872c081acbdc",
    );
    const historical = JSON.parse(provenanceBytes);
    expect(historical.record_id).toBe("H02C-PROV-R6-001");
    expect(historical.task_id).toBe("H02C");
    if ((await finalizerState()) === "preseal")
      await expect(buildSupplyChainArtifacts()).rejects.toThrow();
    else await expect(buildSupplyChainArtifacts()).resolves.toBeDefined();
  });

  it("enforces bidirectional governed-subject and artifact equality", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const exact = Array.from(policy.provenanceSubjects);
    expect(exact).toHaveLength(505);
    for (const revision of [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
      expect(exact).toContain(
        `docs/hackathon/h02c-c06-provenance-and-transition-contract-r${revision}.md`,
      );
    expect(exact).toContain("scripts/h02c-ci-inventory.py");
    expect(() => validateGovernedUniverse(policy, exact, exact)).not.toThrow();
    for (const [discovered, artifacts] of [
      [exact.slice(1), exact.slice(1)],
      [Array.from(exact).concat(["z-extra"]), Array.from(exact).concat(["z-extra"])],
      [Array.from(exact).concat([exact.at(-1)]), Array.from(exact).concat([exact.at(-1)])],
      [Array.from(exact).reverse(), Array.from(exact).reverse()],
      [exact, exact.slice(1)],
      [exact, Array.from(exact.slice(0, -1)).concat(["./alias"])],
    ]) {
      expect(() => validateGovernedUniverse(policy, discovered, artifacts)).toThrow();
    }
  });

  it("preserves exact quarantine disclosure in immutable H02C provenance", async () => {
    const provenance = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "ci/generated/provenance/H02C-PROV-R6-001.json"),
        "utf8",
      ),
    );
    expect(
      provenance.artifacts.filter(
        ({ repository_relative_path }) => repository_relative_path === quarantinePath,
      ),
    ).toHaveLength(1);
    if ((await finalizerState()) === "preseal")
      await expect(buildSupplyChainArtifacts()).rejects.toThrow();
    else await expect(buildSupplyChainArtifacts()).resolves.toBeDefined();
  });

  it("keeps .worktrees outside successor policy and output authority", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci/b03-policy.json"), "utf8"),
    );
    const namesPath = (relative) =>
      relative === opaqueWorktreeRoot || relative.startsWith(`${opaqueWorktreeRoot}/`);
    expect(policy.sourceSecurity.excludedPaths.filter(namesPath)).toEqual([opaqueWorktreeRoot]);
    expect(policy.provenanceSubjects.some(namesPath)).toBe(false);
    expect(provenanceOutputAllowlist.concat(sbomOutputAllowlist).some(namesPath)).toBe(false);
  });

  it("keeps the quarantined path out of every unapproved code and configuration file", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const allowed = new Set([
      "scripts/verify-cleanroom.mjs",
      "scripts/verify-supply-chain.mjs",
      "tests/architecture/b03-supply-chain.test.mjs",
      "tests/architecture/cleanroom-boundaries.test.ts",
    ]);
    const codeOrConfiguration = policy.provenanceSubjects.filter(
      (relative) =>
        relative === "package.json" ||
        relative.startsWith("apps/") ||
        relative.startsWith("infrastructure/") ||
        relative.startsWith("packages/") ||
        relative.startsWith("scripts/") ||
        relative.startsWith("tests/") ||
        relative.includes("tsconfig") ||
        relative.endsWith("package.json"),
    );
    for (const relative of codeOrConfiguration) {
      const source = await readFile(path.join(repositoryRoot, relative), "utf8");
      if (source.includes(quarantinePath)) expect(allowed.has(relative), relative).toBe(true);
    }
  });

  it("rejects governed runtime, source, or configuration use of .worktrees outside its boundary", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const allowed = new Set([
      ".gitignore",
      "biome.json",
      "ci/b03-policy.json",
      "ci/h01-cleanroom-policy-r1.json",
      "ci/h01-cleanroom-policy-r2.json",
      "ci/h02c-cleanroom-policy-r1.json",
      "ci/h11b-cleanroom-policy-r1.json",
      "ci/h11b-cleanroom-policy-r2.json",
      "ci/h11b-cleanroom-policy-r3.json",
      "ci/h11b-cleanroom-policy-r4.json",
      "ci/h11b-cleanroom-policy-r5.json",
      "ci/h11b-cleanroom-policy-r6.json",
      "ci/h11b-cleanroom-policy-r7.json",
      "ci/h11b-cleanroom-policy-r8.json",
      "ci/h11b-cleanroom-policy-r9.json",
      "ci/h11b-cleanroom-policy-r10.json",
      "ci/h11b-cleanroom-policy-r11.json",
      "ci/h11b-cleanroom-policy-r12.json",
      "ci/h11b-cleanroom-policy-r13.json",
      "ci/h11b-cleanroom-policy-r14.json",
      "ci/h11b-cleanroom-policy-r15.json",
      "ci/h11b-cleanroom-policy-r16.json",
      "ci/h11b-cleanroom-policy-r17.json",
      "ci/h11b-cleanroom-policy-r18.json",
      "ci/h11b-cleanroom-policy-r19.json",
      "ci/h11b-cleanroom-policy-r20.json",
      "ci/h11b-cleanroom-policy-r21.json",
      "ci/h11b-cleanroom-policy-r22.json",
      "ci/h11b-cleanroom-policy-r23.json",
      "ci/h11b-cleanroom-policy-r24.json",
      "ci/h11b-cleanroom-policy-r25.json",
      "ci/h11b-cleanroom-policy-r26.json",
      "ci/h11b-cleanroom-policy-r27.json",
      "ci/h11b-cleanroom-policy-r28.json",
      "ci/h11b-cleanroom-policy-r29.json",
      "ci/h11b-cleanroom-policy-r30.json",
      "ci/h11b-cleanroom-policy-r31.json",
      "ci/h11b-cleanroom-policy-r32.json",
      "ci/h11b-cleanroom-policy-r33.json",
      "ci/h11b-cleanroom-policy-r34.json",
      "ci/h11b-cleanroom-policy-r36.json",
      "ci/h11b-cleanroom-policy-r37.json",
      "ci/h11b-cleanroom-policy-r38.json",
      "ci/h11b-cleanroom-policy-r39.json",
      "ci/h11b-cleanroom-policy-r40.json",
      "ci/h11b-cleanroom-policy-r41.json",
      "ci/h11b-cleanroom-policy-r42.json",
      "ci/h11b-cleanroom-policy-r43.json",
      "ci/h11b-cleanroom-policy-r44.json",
      "ci/h11b-cleanroom-policy-r45.json",
      "ci/h11b-cleanroom-policy-r46.json",
      "ci/h11b-cleanroom-policy-r47.json",
      "ci/h11b-cleanroom-policy-r48.json",
      "ci/h11b-cleanroom-policy-r49.json",
      "ci/h11b-cleanroom-policy-r50.json",
      "ci/h11b-cleanroom-policy-r51.json",
      "ci/h11b-cleanroom-policy-r52.json",
      "ci/h11b-cleanroom-policy-r35.json",
      "scripts/check-manifests.mjs",
      "scripts/check-tsconfig-paths.mjs",
      "scripts/verify-supply-chain.mjs",
      "tests/architecture/b03-source-security.test.mjs",
      "tests/architecture/b03-supply-chain.test.mjs",
      "tests/architecture/cleanroom-boundaries.test.ts",
      "tests/architecture/manifest-boundaries.test.ts",
      "tests/architecture/tsconfig-paths.test.ts",
    ]);
    const codeOrConfiguration = policy.provenanceSubjects.filter(
      (relative) =>
        relative === ".gitignore" ||
        relative === "biome.json" ||
        relative.startsWith("ci/") ||
        relative.startsWith("apps/") ||
        relative.startsWith("infrastructure/") ||
        relative.startsWith("packages/") ||
        relative.startsWith("scripts/") ||
        relative.startsWith("tests/") ||
        relative.includes("tsconfig") ||
        relative.endsWith("package.json"),
    );
    const observed = [];
    for (const relative of codeOrConfiguration) {
      const source = await readFile(path.join(repositoryRoot, relative), "utf8");
      if (source.includes(opaqueWorktreeRoot)) observed.push(relative);
    }
    expect(observed).toEqual(Array.from(allowed).sort(utf8Order));
  });

  it("binds cleanroom and envelope accepted and historical predecessor meanings exactly", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const cleanroom = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "h11b-cleanroom-policy-r52.json"), "utf8"),
    );
    expect(() => validatePredecessorMeanings(policy, cleanroom)).not.toThrow();
    const supplySource = await readFile(
      path.join(repositoryRoot, "scripts", "verify-supply-chain.mjs"),
      "utf8",
    );
    const cleanroomSource = await readFile(
      path.join(repositoryRoot, "scripts", "verify-cleanroom.mjs"),
      "utf8",
    );
    expect(supplySource).toContain('safeFile("ci/h11b-cleanroom-policy-r52.json")');
    expect(supplySource).toContain("trust.trustAnchors.length !== 87");
    expect(supplySource).toMatch(
      /artifact_type === "immutable-sealed-local-provenance-history",\s*\)\.length !== 16/u,
    );
    expect(supplySource).toMatch(
      /artifact_type === "failed-prior-task-candidate-history",\s*\)\.length !== 24/u,
    );
    expect(supplySource).toMatch(
      /artifact_type === "failed-current-task-candidate-history",\s*\)\.length !== 3/u,
    );
    expect(supplySource).toMatch(
      /relative === failedH11bR30\.path \|\|\s*relative === failedH11bR32\.path \|\|\s*relative === failedH11bR34\.path/u,
    );
    expect(supplySource).toContain("const failedPolicyArtifactCounts = new Map()");
    expect(supplySource).toContain("failedPolicyArtifactTypes.size !== failedPolicyHistory.length");
    expect(supplySource).toContain("Array.from(failedPolicyArtifactTypes).some(");
    expect(supplySource).toContain('"immutable-failed-current-task-policy-history"');
    expect(supplySource).toMatch(
      /relative === sealedH11bR23\.path\s*\? "immutable-sealed-local-provenance-predecessor"/u,
    );
    expect(supplySource).toMatch(
      /sealed_local_predecessor:\s*\{\s*record_id: sealedH11bR23\.recordId,/u,
    );
    expect(supplySource).not.toMatch(
      /relative === sealedH11bR17\.path\s*\? "immutable-sealed-local-provenance-predecessor"/u,
    );
    expect(supplySource).toContain('path: "ci/generated/provenance/C05-PROV-R9-001.json"');
    expect({
      candidate: candidateHistory.find(
        ({ path: candidatePath }) => candidatePath === failedH01R1.path,
      ),
      policy: cleanroom.identityBinding.failedPolicyHistory.find(
        ({ path: policyPath }) => policyPath === "ci/h01-cleanroom-policy-r1.json",
      ),
    }).toEqual({
      candidate: failedH01R1,
      policy: {
        path: "ci/h01-cleanroom-policy-r1.json",
        bytes: 17459,
        mode: "0644",
        sha256: "7f4128535e655e33ba82122b88cd15fc6bdce341502f1252ccaaef0f4b603309",
        disposition: "immutable-failed-prior-task-policy-history",
      },
    });
    expect(supplySource).toContain('path: "ci/c05-cleanroom-policy-r1.json"');
    expect(supplySource).not.toContain('safeFile("ci/c01-cleanroom-policy-r9.json")');
    expect(cleanroomSource).toContain('"ci/h11b-cleanroom-policy-r52.json"');
    expect(cleanroom.identityBinding.failedPolicyHistory).toEqual([
      burnedC05R1Policy,
      burnedC05R2Policy,
      {
        path: "ci/c05-cleanroom-policy-r3.json",
        bytes: 14129,
        mode: "0644",
        sha256: "9028fd60473f6a91ec30b5f86ed64a9b023d1b11d83a904ecabc586adf651050",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r4.json",
        bytes: 14427,
        mode: "0644",
        sha256: "0781a81ca113fa0cde9d367635eedb4ca1fe7458b1229ed5b1ccef5b0e7c3df5",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r5.json",
        bytes: 14661,
        mode: "0644",
        sha256: "ddff651c1269357fac3fc7235385b249786814eb563a6753ac5f5d6e12d5a44e",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r6.json",
        bytes: 14927,
        mode: "0644",
        sha256: "5245bd0fb0d20e27c2115e9d582f1d687c61baa2526c67ba9563cf800b86de98",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r7.json",
        bytes: 15193,
        mode: "0644",
        sha256: "e0759b03bc24baa46a4e79c050ddbb8e5c7f1e9c94d1738a9bab63c69be8efdf",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r8.json",
        bytes: 15459,
        mode: "0644",
        sha256: "1458bc08c460f8d7a988e44f004e3ca541576c3adf31f0bf5046dd58a16caf1a",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/c05-cleanroom-policy-r9.json",
        bytes: 15725,
        mode: "0644",
        sha256: "7ad67727c6dde9e9325bfa8d26b01eed37553b3ac28b49c24158046f6b713371",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/h01-cleanroom-policy-r1.json",
        bytes: 17459,
        mode: "0644",
        sha256: "7f4128535e655e33ba82122b88cd15fc6bdce341502f1252ccaaef0f4b603309",
        disposition: "immutable-failed-prior-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r19.json",
        bytes: 25070,
        mode: "0644",
        sha256: "81e382eb7e38e975bbe169eb3a498e91cb2ce5a3802eb29b6b0b9952eee3e2b4",
        disposition: "immutable-burned-failed-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r25.json",
        bytes: 29037,
        mode: "0644",
        sha256: "3f8651380fcdff48cfcd1a8cbeaaea6055dc9722a24938575e276a798d4cd8d7",
        disposition: "immutable-failed-prior-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r26.json",
        bytes: 29590,
        mode: "0644",
        sha256: "c633811945f979895d8fb8c72e250d14e617120151e2b4dcc9aaa29f39854781",
        disposition: "immutable-failed-prior-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r27.json",
        bytes: 30676,
        mode: "0644",
        sha256: "d536ed97b58c64c1c4f0f4fc10b9c90a54ede56ba14bb0eb36d46ad29f77e3ea",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r35.json",
        bytes: 36670,
        mode: "0644",
        sha256: "36ea465affda7d65022d970636a8e23a03a1d4ce691b498841184bb98b3db700",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r39.json",
        bytes: 39934,
        mode: "0644",
        sha256: "7138659fec7bccd96b7f88c377b1351e1f33df626c9d188d666f5436e3690df7",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r40.json",
        bytes: 41284,
        mode: "0644",
        sha256: "7e1f24ba6a26b5be468942eb06e276f1b2da41ea0f0fee8aa293720cb734f494",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r41.json",
        bytes: 41821,
        mode: "0644",
        sha256: "f0aa72492e24f17fa587633faf76ada30001166de3b8c7058fec6a76209fcfe5",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r42.json",
        bytes: 43195,
        mode: "0644",
        sha256: "32eceab4ff1e4b61f64dfe25205f321fdda15d070c83e419cbce3f9798219e9f",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r43.json",
        bytes: 44545,
        mode: "0644",
        sha256: "9051e8928d4929d68a8db21185cc96948d238064b45396dc60beef78b4dfb41e",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r44.json",
        bytes: 44572,
        mode: "0644",
        sha256: "9d723be836b94a23fb4a47bce7769ef4df1ec185d0e04676478355264dd550c5",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r45.json",
        bytes: 45661,
        mode: "0644",
        sha256: "cbf5fe8bb81f71c40fbf9aba0f802767397de52ff70fdf840e4dd0ef53399336",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r46.json",
        bytes: 46209,
        mode: "0644",
        sha256: "5a360114bb6fc6614beb272f0a0c02a865b4a828398a25c942a8cf5ad4f9a879",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r47.json",
        bytes: 47295,
        mode: "0644",
        sha256: "835d35892c0c36b2ca6e23f39f449c3057fdaa4de686c6e87977fd51ff30a919",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r48.json",
        bytes: 48657,
        mode: "0644",
        sha256: "33bbbd8f0330438176fa2e050c8c43e46f0889122669f96fb7a3e4f10381f2d7",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r49.json",
        bytes: 50019,
        mode: "0644",
        sha256: "d4ac35e05551e54c7e19f82f561ea0fda7d016c1f96a7f1b447a31c2ce896408",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r50.json",
        bytes: 51674,
        mode: "0644",
        sha256: "4339173d9b3b8942036d51b538ce4452dad937a2415516072a023a5af08ae9e6",
        disposition: "immutable-failed-current-task-policy-history",
      },
      {
        path: "ci/h11b-cleanroom-policy-r51.json",
        bytes: 52214,
        mode: "0644",
        sha256: "96677d77de8d09f76253a858b1addc0e188eef2fd494a0b43a1363be14fd5b03",
        disposition: "immutable-failed-current-task-policy-history",
      },
    ]);
    const countByDisposition = (value) => ({
      "immutable-burned-failed-policy-history": value.identityBinding.failedPolicyHistory.filter(
        ({ disposition }) => disposition === "immutable-burned-failed-policy-history",
      ).length,
      "immutable-failed-prior-task-policy-history":
        value.identityBinding.failedPolicyHistory.filter(
          ({ disposition }) => disposition === "immutable-failed-prior-task-policy-history",
        ).length,
      "immutable-failed-current-task-policy-history":
        value.identityBinding.failedPolicyHistory.filter(
          ({ disposition }) => disposition === "immutable-failed-current-task-policy-history",
        ).length,
    });
    const r48 = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "h11b-cleanroom-policy-r48.json"), "utf8"),
    );
    expect(countByDisposition(r48)).toEqual({
      "immutable-burned-failed-policy-history": 10,
      "immutable-failed-prior-task-policy-history": 3,
      "immutable-failed-current-task-policy-history": 11,
    });
    expect(countByDisposition(cleanroom)).toEqual({
      "immutable-burned-failed-policy-history": 10,
      "immutable-failed-prior-task-policy-history": 3,
      "immutable-failed-current-task-policy-history": 15,
    });
    expect(cleanroom).toMatchObject({
      policyId: "zintus-continuity-h11b-cleanroom@52",
      identityBinding: {
        trustBaselineId: "zintus-continuity-local-trust@65",
        toolPayloadInventoryId: "zintus-continuity-tool-payloads@21",
        currentProvenancePath: "ci/generated/provenance/H11B-PROV-R51-001.json",
        currentProvenanceRecordId: "H11B-PROV-R51-001",
        predicateType: "zintus-continuity.local-unsigned-provenance@85",
        acceptanceLabel:
          "H11B_FINALIZER_LOCAL_SYNTHETIC_UNSIGNED_PROVENANCE_PENDING_EXTERNAL_REVIEW",
        policyPredecessor: {
          path: "ci/h11b-cleanroom-policy-r51.json",
          bytes: 52214,
          mode: "0644",
          sha256: "96677d77de8d09f76253a858b1addc0e188eef2fd494a0b43a1363be14fd5b03",
          disposition: "immutable-failed-current-task-policy-history",
        },
        sealedProvenancePredecessor: sealedH11bR23,
        immediatePredecessor: expect.objectContaining({
          path: "ci/generated/provenance/H02C-PROV-R6-001.json",
          recordId: "H02C-PROV-R6-001",
        }),
        acceptedPredecessor: acceptedH02CR4,
        priorAcceptedPredecessor: acceptedH01R2,
        historicalPredecessor: acceptedB05Predecessor,
      },
    });
    expect(policy.toolPayloadInventory).toMatchObject({ maxFiles: 4371, maxTrees: 139 });
    expect(supplySource).toContain(
      "H11B R1 failed; R2 uncommitted; R3-R10, R12-R17, R19, and R20 sealed locally; R11 failed exact local review; R18 burned after partial finalizer without provenance; R1-R28 policies immutable; H02C R6 predecessor; R21 create-once pending external review.",
    );
    const wrongToolLimit = structuredClone(policy);
    wrongToolLimit.toolPayloadInventory.maxFiles = 4372;
    await expect(
      collectToolPayloadInventory(repositoryRoot, wrongToolLimit, Buffer.from("fixture"), {}),
    ).rejects.toThrow(/configuration is invalid/u);
    const contradictory = structuredClone(cleanroom);
    contradictory.identityBinding.acceptedPredecessor = structuredClone(
      contradictory.identityBinding.historicalPredecessor,
    );
    expect(() => validatePredecessorMeanings(policy, contradictory)).toThrow(
      /predecessor meanings differ/u,
    );
    for (const mutate of [
      (value) => value.persistentGenerated.pop(),
      (value) => value.persistentGenerated.push(structuredClone(value.persistentGenerated.at(-1))),
      (value) => value.persistentGenerated.reverse(),
      (value) => (value.persistentGenerated.at(-2).disposition = "current-provenance"),
      (value) => value.identityBinding.failedPolicyHistory.pop(),
      (value) =>
        value.identityBinding.failedPolicyHistory.push(
          structuredClone(value.identityBinding.failedPolicyHistory.at(-1)),
        ),
      (value) => value.identityBinding.failedPolicyHistory.reverse(),
      (value) =>
        (value.identityBinding.failedPolicyHistory.at(-1).disposition =
          "immutable-failed-prior-task-policy-history"),
      (value) => (value.identityBinding.failedPolicyHistory.at(-1).semanticSha256 = "0".repeat(64)),
    ]) {
      const altered = structuredClone(cleanroom);
      mutate(altered);
      expect(() => validatePredecessorMeanings(policy, altered)).toThrow(
        /predecessor meanings differ/u,
      );
    }
  });

  it("fails closed on predecessor, identity, subject-cycle, and output-allowlist mutations", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const successorCleanroom = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci/h11b-cleanroom-policy-r29.json"), "utf8"),
    );
    expect(() => validateH02CProvenancePolicy(policy)).not.toThrow();
    await expect(validateHistoricalB05Predecessor(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC01R5(policy)).resolves.toBeUndefined();
    await expect(validateFailedC01R6(policy)).resolves.toBeUndefined();
    await expect(validateFailedC01R7(policy)).resolves.toBeUndefined();
    await expect(validateFailedC01R8(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC01R9(policy)).resolves.toBeUndefined();
    await expect(validateFailedC02R1(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC02R2(policy)).resolves.toBeUndefined();
    await expect(validateFailedC03R1(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC03R2(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC03R3(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC03R4(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC04R1(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC04R2(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedC04R3(policy)).resolves.toBeUndefined();
    await expect(validateSealedH11bHistory(policy)).resolves.toBeUndefined();
    await expect(validateImmutableC05R10(policy)).resolves.toBeUndefined();
    await expect(validateFailedH01R1(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedH01R2(policy)).resolves.toBeUndefined();
    await expect(validateAcceptedH02CR4(policy)).resolves.toBeUndefined();
    await expect(validateFailedH02CR5(policy)).resolves.toBeUndefined();
    await expect(validateCandidateHistory(policy)).resolves.toBeUndefined();
    for (const [label, mutate, validate] of [
      [
        "current/immediate",
        (value) => (value.currentProvenance = structuredClone(value.provenancePredecessor)),
        async (value) => validateH02CProvenancePolicy(value),
      ],
      [
        "immediate/historical",
        (value) =>
          (value.provenancePredecessor = structuredClone(value.historicalProvenancePredecessor)),
        async (value) => validatePredecessorMeanings(value, successorCleanroom),
      ],
      [
        "accepted/historical",
        (value) =>
          (value.acceptedProvenancePredecessor = structuredClone(
            value.historicalProvenancePredecessor,
          )),
        validateAcceptedH02CR4,
      ],
      [
        "historical/accepted",
        (value) =>
          (value.historicalProvenancePredecessor = structuredClone(
            value.acceptedProvenancePredecessor,
          )),
        validateHistoricalB05Predecessor,
      ],
      [
        "root/accepted",
        (value) => (value.acceptedProvenanceAnchors[0] = structuredClone(acceptedC01R9)),
        validateAcceptedR12,
      ],
      [
        "failed/accepted",
        (value) => (value.candidateHistory[0] = structuredClone(acceptedC01R9)),
        validateCandidateHistory,
      ],
    ]) {
      const altered = structuredClone(policy);
      mutate(altered);
      await expect(validate(altered), label).rejects.toThrow();
    }
    for (const mutate of [
      (value) => delete value.provenancePredecessor.sha256,
      (value) => (value.provenancePredecessor.bytes += 1),
      (value) => (value.provenancePredecessor.mode = "0600"),
      (value) => (value.provenancePredecessor.recordId = "H01-PROV-R2-FORGED"),
      (value) => (value.provenancePredecessor.aggregate = "0".repeat(64)),
    ]) {
      const altered = structuredClone(policy);
      mutate(altered);
      expect(() => validatePredecessorMeanings(altered, successorCleanroom)).toThrow();
    }
    for (const mutate of [
      (value) => (value.sealedProvenancePredecessor.bytes += 1),
      (value) => (value.sealedProvenancePredecessor.mode = "0600"),
      (value) => (value.sealedProvenancePredecessor.recordId = "H11B-PROV-R10-FORGED"),
      (value) => (value.sealedProvenancePredecessor.sha256 = "0".repeat(64)),
      (value) => (value.sealedProvenancePredecessor.aggregate = "0".repeat(64)),
    ]) {
      const altered = structuredClone(policy);
      mutate(altered);
      expect(() => validateH02CProvenancePolicy(altered)).toThrow();
    }
    for (const mutate of [
      (value) => (value.identityBinding.sealedProvenancePredecessor.bytes += 1),
      (value) => (value.identityBinding.sealedProvenancePredecessor.mode = "0600"),
      (value) => (value.identityBinding.sealedProvenancePredecessor.recordId = "FORGED"),
      (value) => (value.identityBinding.sealedProvenancePredecessor.sha256 = "0".repeat(64)),
      (value) => (value.identityBinding.sealedProvenancePredecessor.aggregate = "0".repeat(64)),
    ]) {
      const altered = structuredClone(successorCleanroom);
      mutate(altered);
      expect(() => validatePredecessorMeanings(policy, altered)).toThrow(
        /predecessor meanings differ/u,
      );
    }
    const forgedAnchor = structuredClone(policy);
    forgedAnchor.acceptedProvenanceAnchors[0].sha256 = "0".repeat(64);
    await expect(validateAcceptedR12(forgedAnchor)).rejects.toThrow(/anchor tuple/u);
    const forgedPredecessor = structuredClone(policy);
    forgedPredecessor.historicalProvenancePredecessor.sha256 = "0".repeat(64);
    await expect(validateHistoricalB05Predecessor(forgedPredecessor)).rejects.toThrow(
      /predecessor tuple/u,
    );
    const forgedImmediate = structuredClone(policy);
    forgedImmediate.provenancePredecessor.sha256 = "0".repeat(64);
    expect(() => validatePredecessorMeanings(forgedImmediate, successorCleanroom)).toThrow();
    const invalidRecord = structuredClone(policy);
    invalidRecord.currentProvenance.recordId = "INVALID";
    expect(invalidRecord.currentProvenance.recordId).not.toBe(policy.currentProvenance.recordId);
    expect(() => validateH02CProvenancePolicy(invalidRecord)).toThrow();
    for (const mutate of [
      (value) => (value.candidateHistory[0].sha256 = "0".repeat(64)),
      (value) => value.candidateHistory.shift(),
      (value) => value.candidateHistory.reverse(),
      (value) => value.candidateHistory.push(structuredClone(value.candidateHistory[0])),
    ]) {
      const altered = structuredClone(policy);
      mutate(altered);
      await expect(validateCandidateHistory(altered)).rejects.toThrow(/candidate history/u);
    }
    for (const mutate of [
      (value) => value.provenanceSubjects.push(value.provenancePath),
      (value) =>
        value.provenanceSubjects.splice(value.provenanceSubjects.indexOf(quarantinePath), 1),
      (value) => value.provenanceSubjects.push(quarantinePath),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf(
            "docs/hackathon/h02a-empty-worktree-container-amendment.md",
          ),
          1,
        ),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf("docs/hackathon/h02a-read-budget-successor.md"),
          1,
        ),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf("docs/hackathon/h02a-safe-index-access-successor.md"),
          1,
        ),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf(
            "docs/hackathon/h02a-streaming-ledger-hash-successor.md",
          ),
          1,
        ),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf("docs/hackathon/h02a-test-types-successor.md"),
          1,
        ),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf("docs/hackathon/h02a-worktree-reference-successor.md"),
          1,
        ),
      (value) =>
        value.sourceSecurity.excludedPaths.splice(
          value.sourceSecurity.excludedPaths.indexOf(opaqueWorktreeRoot),
          1,
        ),
      (value) =>
        value.provenanceSubjects.splice(
          value.provenanceSubjects.indexOf(value.provenancePredecessor.path),
          1,
        ),
      (value) => (value.provenanceSubjects = Array.from(value.provenanceSubjects).reverse()),
      (value) => (value.currentProvenance = structuredClone(value.provenancePredecessor)),
      (value) => (value.extra = true),
      (value) =>
        (value.installedLicenseEvidence.evidenceId =
          "zintus-continuity-b03-installed-license-evidence@1"),
      (value) => value.limitations.pop(),
      (value) => value.limitations.push("SAFE_EVIDENCE_WRITER_RENAME_TOCTOU_REMAINS"),
    ]) {
      const altered = structuredClone(policy);
      mutate(altered);
      expect(() => validateH02CProvenancePolicy(altered)).toThrow();
    }
    expect(provenanceOutputAllowlist).toEqual(["ci/generated/provenance/H11B-PROV-R51-001.json"]);
    expect(sbomOutputAllowlist).toEqual([
      "ci/generated/sbom.cdx.json",
      "ci/installed-license-evidence.json",
      "ci/tool-payload-inventory.json",
      "ci/trust-baseline.json",
    ]);
    expect(provenanceOutputAllowlist.some((entry) => sbomOutputAllowlist.includes(entry))).toBe(
      false,
    );
    expect(provenanceOutputAllowlist).not.toContain(immutableC05R10.path);
    expect(sbomOutputAllowlist).not.toContain(immutableC05R10.path);
    expect(provenanceOutputAllowlist.includes(acceptedR12.path)).toBe(false);
    expect(provenanceOutputAllowlist.includes(acceptedB05Predecessor.path)).toBe(false);
    expect(provenanceOutputAllowlist.includes(acceptedC01R9.path)).toBe(false);
    expect(candidateHistory.at(-8)).toEqual(failedH11bR11);
    expect(candidateHistory.at(-7)).toEqual(failedH11bR21);
    expect(candidateHistory.at(-6)).toEqual(failedH11bR24);
    expect(candidateHistory.at(-5)).toEqual(failedH11bR28);
    expect(candidateHistory.at(-4)).toEqual(failedH11bR30);
    for (const entry of candidateHistory)
      expect(provenanceOutputAllowlist.includes(entry.path)).toBe(false);

    const r12 = await readFile(path.join(repositoryRoot, acceptedR12.path));
    const r12Stat = await lstat(path.join(repositoryRoot, acceptedR12.path));
    expect(r12.length).toBe(acceptedR12.bytes);
    expect((r12Stat.mode & 0o777).toString(8).padStart(4, "0")).toBe(acceptedR12.mode);
    expect(createHash("sha256").update(r12).digest("hex")).toBe(acceptedR12.sha256);
    expect(JSON.parse(r12).batch_integrity.aggregate_digest).toBe(acceptedR12.aggregate);
    for (const entry of candidateHistory) {
      const bytes = await readFile(path.join(repositoryRoot, entry.path));
      const stat = await lstat(path.join(repositoryRoot, entry.path));
      expect(bytes.length).toBe(entry.bytes);
      expect((stat.mode & 0o777).toString(8).padStart(4, "0")).toBe(entry.mode);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      const record = JSON.parse(bytes);
      expect(record.record_id).toBe(entry.recordId);
      expect(record.batch_integrity.aggregate_digest).toBe(entry.aggregate);
    }
    const b05 = await readFile(path.join(repositoryRoot, acceptedB05Predecessor.path));
    const b05Stat = await lstat(path.join(repositoryRoot, acceptedB05Predecessor.path));
    expect(b05.length).toBe(acceptedB05Predecessor.bytes);
    expect((b05Stat.mode & 0o777).toString(8).padStart(4, "0")).toBe(acceptedB05Predecessor.mode);
    expect(createHash("sha256").update(b05).digest("hex")).toBe(acceptedB05Predecessor.sha256);
    expect(JSON.parse(b05).batch_integrity.aggregate_digest).toBe(acceptedB05Predecessor.aggregate);
    const c01R9 = await readFile(path.join(repositoryRoot, acceptedC01R9.path));
    const c01R9Stat = await lstat(path.join(repositoryRoot, acceptedC01R9.path));
    expect(c01R9.length).toBe(acceptedC01R9.bytes);
    expect((c01R9Stat.mode & 0o777).toString(8).padStart(4, "0")).toBe(acceptedC01R9.mode);
    expect(createHash("sha256").update(c01R9).digest("hex")).toBe(acceptedC01R9.sha256);
    expect(JSON.parse(c01R9).record_id).toBe(acceptedC01R9.recordId);
    expect(JSON.parse(c01R9).batch_integrity.aggregate_digest).toBe(acceptedC01R9.aggregate);
    const r1Policy = await readFile(path.join(repositoryRoot, "ci/c01-cleanroom-policy.json"));
    const r1PolicyStat = await lstat(path.join(repositoryRoot, "ci/c01-cleanroom-policy.json"));
    expect(r1Policy.length).toBe(7436);
    expect((r1PolicyStat.mode & 0o777).toString(8).padStart(4, "0")).toBe("0644");
    expect(createHash("sha256").update(r1Policy).digest("hex")).toBe(
      "77e75e51c7fcb32a2a903e613636b738187cb6631c89a9d80a6dc71c6febd8b6",
    );
  });

  it("rejects malformed locks and ambiguous or missing license coverage", () => {
    expect(() => lockIdentities("packages:\n")).toThrow(/packages section/u);
    expect(() =>
      lockComponents("\npackages:\n  package@1.0.0:\n    resolution: {}\nsnapshots:\n"),
    ).toThrow(/strict SRI/u);
    expect(() => licenseFor("unknown", [])).toThrow(/not exact/u);
    expect(() =>
      licenseFor("duplicate", [
        { kind: "exact", value: "duplicate" },
        { kind: "prefix", value: "dup" },
      ]),
    ).toThrow(/not exact/u);
    expect(() =>
      licenseFor(
        "synthetic",
        [
          {
            kind: "identity",
            value: "synthetic@1.0.0",
            license: "MIT",
            noticeRequired: false,
          },
        ],
        "2.0.0",
      ),
    ).toThrow(/not exact/u);
    expect(() => licenseFor("synthetic", [{ kind: "unknown", value: "synthetic" }])).toThrow(
      /kind is invalid/u,
    );
    for (const unsafe of ["../escape", "/absolute", "nested\\\\escape", "./alias"]) {
      expect(() => validatePolicyRelativePath(unsafe)).toThrow(/policy path/u);
    }
  });

  it("covers the exact current lock with reviewed identity license rules", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const locked = lockComponents(
      await readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
    );
    expect(locked).toHaveLength(195);
    expect(policy.licenseRules).toHaveLength(139);
    expect(() =>
      validateLicenseRules(locked, policy.licenseRules, policy.notice.allowlist),
    ).not.toThrow();
    expect(policy.licenseDecision.version).toBe("b03-license-notice-review@5");
    const licenses = locked.map(({ identity }) => {
      const bare = identity.replace(/\(.*/u, "");
      const separator = bare.lastIndexOf("@");
      return licenseFor(bare.slice(0, separator), policy.licenseRules, bare.slice(separator + 1))
        .license;
    });
    expect(
      ["0BSD", "Apache-2.0", "BSD-3-Clause", "ISC", "MIT", "MIT OR Apache-2.0"].map(
        (license) => licenses.filter((value) => value === license).length,
      ),
    ).toEqual([1, 71, 1, 4, 109, 9]);
    const identityRules = policy.licenseRules.filter(({ kind }) => kind === "identity");
    expect(identityRules).toHaveLength(86);
    expect(createHash("sha256").update(JSON.stringify(identityRules)).digest("hex")).toBe(
      "de806312b5d5ddfdefbe3a41c9266ed2b79ca9e2f0a2aaca65c8117f456d783e",
    );
    expect(licenseFor("tslib", policy.licenseRules, "2.8.1").license).toBe("0BSD");
    expect(licenseFor("tslib", policy.licenseRules, "2.8.1").noticeRequired).toBe(true);
    expect(licenseFor("typescript", policy.licenseRules, "5.9.3").noticeRequired).toBe(true);
    expect(licenseFor("pg-int8", policy.licenseRules, "1.0.1").license).toBe("ISC");
    expect(licenseFor("split2", policy.licenseRules, "4.2.0").license).toBe("ISC");
    expect(policy.licenseDecision.evidence).toContain(
      "TypeScript 5.9.3 ThirdPartyNoticeText.txt and tslib 2.8.1 CopyrightNotice.txt exact installed bytes copied to root NOTICE",
    );
    expect(policy.licenseDecision.evidence).toContain(
      "manifest-only without license file: @aws-sdk/credential-provider-http@3.972.69, @aws-sdk/credential-provider-login@3.972.74, @aws-sdk/nested-clients@3.997.41, pg-types@2.2.0, pgpass@1.0.5",
    );
    expect(() => validateLicenseDecision(policy.licenseDecision)).not.toThrow();
    const decisionMutation = structuredClone(policy.licenseDecision);
    decisionMutation.version = "b03-license-notice-review@6";
    expect(() => validateLicenseDecision(decisionMutation)).toThrow(/decision differs/u);

    const spdxMutation = structuredClone(policy.licenseRules);
    spdxMutation.find(({ value }) => value === "tslib@2.8.1").license = "MIT";
    expect(() => validateLicenseRules(locked, spdxMutation)).toThrow(/mapping differs/u);
    const overlap = structuredClone(policy.licenseRules);
    overlap.splice(
      overlap.findIndex(({ kind, value }) => kind === "exact" && value > "@aws-sdk/core"),
      0,
      {
        kind: "exact",
        value: "@aws-sdk/core",
        license: "Apache-2.0",
        noticeRequired: false,
      },
    );
    expect(() => validateLicenseRules(locked, overlap)).toThrow(/not exact/u);
    const wrongVersion = structuredClone(locked);
    wrongVersion.find(({ identity }) => identity.startsWith("@aws-sdk/core@")).identity =
      "@aws-sdk/core@0.0.0";
    expect(() => validateLicenseRules(wrongVersion, policy.licenseRules)).toThrow(/not exact/u);
    const sriMutation = structuredClone(locked);
    sriMutation.at(0).integrity = "sha512-AA==";
    expect(() => validateLicenseRules(sriMutation, policy.licenseRules)).toThrow(
      /mapping differs/u,
    );
    expect(() =>
      validateLicenseRules(locked, [
        ...policy.licenseRules,
        { kind: "identity", value: "zz-unused@1.0.0", license: "MIT", noticeRequired: false },
      ]),
    ).toThrow(/mapping differs/u);
    const licenseSwap = structuredClone(policy.licenseRules);
    const tslib = licenseSwap.find(({ value }) => value === "tslib@2.8.1");
    const xtend = licenseSwap.find(({ value }) => value === "xtend@4.0.2");
    [tslib.license, xtend.license] = [xtend.license, tslib.license];
    expect(() => validateLicenseRules(locked, licenseSwap)).toThrow(/mapping differs/u);
    const noticeMismatch = structuredClone(policy.licenseRules);
    noticeMismatch.find(({ value }) => value === "tslib@2.8.1").noticeRequired = false;
    expect(() => validateLicenseRules(locked, noticeMismatch, policy.notice.allowlist)).toThrow(
      /NOTICE mapping differs/u,
    );
  });

  it("accepts only the two reviewed installed NOTICE files and exact root copies", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const noticeBytes = await readFile(path.join(repositoryRoot, "NOTICE"));
    expect(policy.notice.allowlist).toEqual(reviewedNoticeAllowlist);
    expect(() => validateNoticeDocument(noticeBytes, policy.notice)).not.toThrow();
    expect(() => validateNoticeDocument(noticeBytes.subarray(0, -1), policy.notice)).toThrow(
      /root NOTICE differs/u,
    );

    let virtualStore = path.dirname(fileURLToPath(import.meta.resolve("typescript")));
    while (path.basename(virtualStore) !== ".pnpm" && virtualStore !== path.dirname(virtualStore))
      virtualStore = path.dirname(virtualStore);
    if (path.basename(virtualStore) !== ".pnpm")
      throw new Error("diagnostic installed package store is missing");
    const installedRoot = async ({ identity }) => {
      const separator = identity.lastIndexOf("@");
      const name = identity.slice(0, separator);
      const version = identity.slice(separator + 1);
      for (const entry of await readdir(virtualStore)) {
        const candidate = path.join(virtualStore, entry, "node_modules", name);
        try {
          const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8"));
          if (manifest.name === name && manifest.version === version) return realpath(candidate);
        } catch (error) {
          if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
        }
      }
      throw new Error(`reviewed installed package is missing: ${identity}`);
    };

    for (const allowed of policy.notice.allowlist) {
      const packageRoot = await installedRoot(allowed);
      const relativeRoot = path.relative(repositoryRoot, packageRoot).split(path.sep).join("/");
      const evidence = await scanInstalledPackageTextEvidence(
        repositoryRoot,
        packageRoot,
        allowed.identity,
      );
      expect(evidence.noticeFiles).toEqual([
        {
          path: `${relativeRoot}/${allowed.sourceFilename}`,
          bytes: allowed.bytes,
          sha256: allowed.sha256,
        },
      ]);
      expect(() =>
        requireAllowedInstalledNotices(
          evidence.noticeFiles,
          allowed.identity,
          policy.notice.allowlist,
          relativeRoot,
        ),
      ).not.toThrow();
      expect(() =>
        requireAllowedInstalledNotices([], allowed.identity, policy.notice.allowlist, relativeRoot),
      ).toThrow(/differs from reviewed allowlist/u);
      expect(() =>
        requireAllowedInstalledNotices(
          [{ ...evidence.noticeFiles[0], bytes: evidence.noticeFiles[0].bytes + 1 }],
          allowed.identity,
          policy.notice.allowlist,
          relativeRoot,
        ),
      ).toThrow(/differs from reviewed allowlist/u);
      expect(() =>
        requireAllowedInstalledNotices(
          [
            {
              ...evidence.noticeFiles[0],
              sha256: `${evidence.noticeFiles[0].sha256[0] === "0" ? "1" : "0"}${evidence.noticeFiles[0].sha256.slice(1)}`,
            },
          ],
          allowed.identity,
          policy.notice.allowlist,
          relativeRoot,
        ),
      ).toThrow(/differs from reviewed allowlist/u);
      expect(() =>
        requireAllowedInstalledNotices(
          [
            ...evidence.noticeFiles,
            { path: `${relativeRoot}/NOTICE.txt`, bytes: 1, sha256: "0".repeat(64) },
          ],
          allowed.identity,
          policy.notice.allowlist,
          relativeRoot,
        ),
      ).toThrow(/differs from reviewed allowlist/u);
      expect(() =>
        requireAllowedInstalledNotices(
          evidence.noticeFiles,
          "wrong-package@1.0.0",
          policy.notice.allowlist,
          relativeRoot,
        ),
      ).toThrow(/differs from reviewed allowlist/u);
    }

    expect(() =>
      validateLicenseRules(
        [],
        [],
        [
          ...policy.notice.allowlist,
          {
            identity: "unreviewed@1.0.0",
            sourceFilename: "NOTICE.txt",
            bytes: 1,
            sha256: "0".repeat(64),
          },
        ],
      ),
    ).toThrow(/allowlist differs/u);
    const wrongIdentity = structuredClone(policy.notice.allowlist);
    wrongIdentity[0].identity = "wrong-package@2.8.1";
    expect(() => validateLicenseRules([], [], wrongIdentity)).toThrow(/allowlist differs/u);
  });

  it("requires installed evidence for every identity license rule", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-license-missing-")));
    try {
      await mkdir(path.join(root, ".zc-pnpm-store/virtual-store"), { recursive: true });
      await writeFile(
        path.join(root, "NOTICE"),
        await readFile(path.join(repositoryRoot, "NOTICE")),
      );
      const policy = JSON.parse(
        await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
      );
      const locked = lockComponents(
        await readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
      );
      await expect(
        collectInstalledLicenseEvidence(root, policy, Buffer.from("policy"), locked),
      ).rejects.toThrow(/required installed package evidence is missing/u);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("uses strict UTF-8 bytes for canonical order and rejects an order mutation", () => {
    expect(["ä", "z"].sort(utf8Order)).toEqual(["z", "ä"]);
    expect(() => requireStrictUtf8Order(["z", "ä"], "synthetic order")).not.toThrow();
    expect(() => requireStrictUtf8Order(["ä", "z"], "synthetic order")).toThrow(
      /strict deterministic UTF-8 byte order/u,
    );
  });

  it("rejects trust identity, version, membership, and order mutations", async () => {
    const trust = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "trust-baseline.json"), "utf8"),
    );
    const state = await finalizerState();
    expect(() => validateTrustBaselineIdentity(trust, state)).not.toThrow();
    const successor = trust;
    expect(() => validateTrustBaselineIdentity(successor, state)).not.toThrow();
    for (const mutate of [
      (value) => (value.schemaVersion = 10),
      (value) => (value.baselineId = "zintus-continuity-local-trust@9"),
      (value) => value.trustAnchors.pop(),
      (value) => value.trustAnchors.reverse(),
      (value) => value.trustAnchors.push(structuredClone(value.trustAnchors[0])),
    ]) {
      const altered = structuredClone(successor);
      mutate(altered);
      expect(() => validateTrustBaselineIdentity(altered, state)).toThrow(/identity or ordering/u);
    }
  });

  it("renders the reviewed trust baseline identity in both generated artifacts", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    const [inventory, baseline] = await Promise.all([
      collectToolPayloadInventory(repositoryRoot, policy, Buffer.from(JSON.stringify(policy))),
      collectTrustBaseline(repositoryRoot, { PATH: "/usr/local/bin:/usr/bin:/bin" }),
    ]);
    expect(inventory.baselineId).toBe("zintus-continuity-local-trust@65");
    expect(baseline.baselineId).toBe("zintus-continuity-local-trust@65");
  });

  it("keeps both safe entrypoints builtins-only until earliest preflight passes", async () => {
    const earliestBuilders = [];
    for (const filename of ["safe-pnpm-install.mjs", "safe-verify.mjs"]) {
      const source = await readFile(path.join(repositoryRoot, "scripts", filename), "utf8");
      const preflightOffset = source.indexOf("[trustPreflight]");
      const downstreamImportOffset = source.indexOf('import("./repository-operation-lock.mjs")');
      const staticSpecifiers = Array.from(
        source.matchAll(/^import(?:[\s\S]*?from\s+)?["']([^"']+)["'];$/gmu),
        (match) => match[1],
      );
      expect(source).not.toMatch(/from\s+["']\.\//u);
      expect(staticSpecifiers.length).toBeGreaterThan(0);
      expect(staticSpecifiers.every((specifier) => specifier.startsWith("node:"))).toBe(true);
      expect(preflightOffset).toBeGreaterThan(0);
      expect(downstreamImportOffset).toBeGreaterThan(preflightOffset);
      const builderStart = source.indexOf("function earliestChildEnvironment(source) {");
      const builderEnd = source.indexOf("\n\nfunction inside", builderStart);
      expect(builderStart).toBeGreaterThan(0);
      expect(builderEnd).toBeGreaterThan(builderStart);
      earliestBuilders.push(source.slice(builderStart, builderEnd));
    }
    expect(earliestBuilders[1]).toBe(earliestBuilders[0]);
  });

  it("structurally binds the H02C no-delete evidence writers", async () => {
    const generatorSource = await readFile(
      path.join(repositoryRoot, "scripts", "generate-b03-local-evidence.mjs"),
      "utf8",
    );
    const supplySource = await readFile(
      path.join(repositoryRoot, "scripts", "verify-supply-chain.mjs"),
      "utf8",
    );
    for (const [name, source] of [
      ["generator", generatorSource],
      ["publisher", supplySource],
    ]) {
      const parsed = ts.createSourceFile(
        name,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      const imported = parsed.statements
        .filter(ts.isImportDeclaration)
        .flatMap((node) => node.importClause?.namedBindings?.elements ?? [])
        .map((node) => node.name.text);
      expect(imported, name).not.toEqual(
        expect.arrayContaining(["link", "rename", "rm", "unlink"]),
      );
    }
    expect(generatorSource).not.toContain("safeWriteEvidence");
    expect(generatorSource).toContain("constants.O_NOFOLLOW | constants.O_RDWR");
    const inventoryCapture = generatorSource.indexOf(
      "const inventoryBefore = await perform.captureInventory();",
    );
    const firstEvidenceWrite = generatorSource.indexOf("for (const [index, [relative, bytes]]");
    const lastEvidenceWrite = generatorSource.indexOf(
      "await perform.create(canonicalRoot, policy.provenancePath, provenanceBytes, createTargets);",
    );
    const inventoryCompare = generatorSource.indexOf(
      "await perform.compareInventory(inventoryBefore)",
    );
    expect(inventoryCapture).toBeGreaterThan(-1);
    expect(inventoryCapture).toBeLessThan(firstEvidenceWrite);
    expect(firstEvidenceWrite).toBeLessThan(lastEvidenceWrite);
    expect(lastEvidenceWrite).toBeLessThan(inventoryCompare);
    expect(generatorSource.indexOf("await revalidateParents(parents)")).toBeLessThan(
      generatorSource.indexOf("await handle.truncate(expected.length)"),
    );
    expect(supplySource).not.toContain("safeCreateEvidence");
    expect(supplySource).toContain(
      "constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR",
    );
    const identity = { dev: 1n, ino: 2n, mode: 0o100644n, nlink: 1n, size: 3n, type: "regular" };
    expect(sameBoundIdentity(identity, { ...identity })).toBe(true);
    for (const changed of [
      { ...identity, ino: 3n },
      { ...identity, mode: 0o100600n },
      { ...identity, nlink: 2n },
      { ...identity, size: 4n },
      { ...identity, type: "other" },
    ])
      expect(sameBoundIdentity(identity, changed)).toBe(false);
  });

  it("binds the portable R2 create diagnostics and full acquisition-close matrix in memory", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts", "verify-supply-chain.mjs"),
      "utf8",
    );
    const codes = [
      "AUTH",
      "ROOT_CANONICAL",
      "PARENT_CANONICAL",
      "TARGET_AVAILABILITY",
      "TARGET_PREEXISTING",
      "TARGET_REMNANT",
      "PARENT_OPEN",
      "PARENT_REVALIDATE_PRE_OPEN",
      "EXCLUSIVE_OPEN",
      "PARENT_REVALIDATE_POST_OPEN",
      "CHMOD",
      "HANDLE_IDENTITY",
      "PATH_LSTAT_1",
      "PARENT_REVALIDATE_POST_LSTAT_1",
      "REALPATH",
      "PARENT_REVALIDATE_POST_REALPATH",
      "PATH_LSTAT_2",
      "PARENT_REVALIDATE_POST_LSTAT_2",
      "TARGET_CROSS_OBSERVATION",
      "PARENT_REVALIDATE_PRE_WRITE",
      "WRITE",
      "WRITE_NO_PROGRESS",
      "FILE_SYNC",
      "PARENT_SYNC",
      "PARENT_REVALIDATE_POST_SYNC",
      "POST_VERIFY",
      "POST_READ",
      "TARGET_CLOSE_FAILED",
      "PARENT_CLOSE_FAILED",
      "INTERNAL",
    ];
    for (const code of codes) {
      expect(source, code).toContain(`"${code}"`);
      expect(`H11B_CREATE_R4_FAILED:${code}`).toMatch(/^H11B_CREATE_R4_FAILED:[A-Z0-9_]+$/u);
    }
    expect(source).toContain(
      ["process.stderr.write(`H11B_CREATE_R4_FAILED:$", "{createCode(error)}`)"].join(""),
    );
    expect(source).not.toContain(["H11B_CREATE_R4_FAILED:$", "{error"].join(""));
    expect(source).not.toContain('"TARGET_CLOSE"');
    expect(source).not.toContain('"PARENT_CLOSE"');
    for (const boundary of [
      "PARENT_REVALIDATE_PRE_OPEN",
      "PARENT_REVALIDATE_POST_OPEN",
      "PARENT_REVALIDATE_POST_LSTAT_1",
      "PARENT_REVALIDATE_POST_REALPATH",
      "PARENT_REVALIDATE_POST_LSTAT_2",
      "PARENT_REVALIDATE_PRE_WRITE",
      "PARENT_REVALIDATE_POST_SYNC",
    ])
      expect(source).toContain(`"${boundary}"`);
    expect(source).toContain("(left.mode & 0o7777n) === (right.mode & 0o7777n)");
    expect(source).not.toMatch(/sameDirectoryIdentity[\s\S]{0,300}nlink/u);

    const parent = { dev: 1n, ino: 2n, mode: 0o40755n, type: "directory" };
    const sameParent = (left, right) =>
      left.dev === right.dev &&
      left.ino === right.ino &&
      (left.mode & 0o7777n) === (right.mode & 0o7777n) &&
      left.type === "directory" &&
      right.type === "directory";
    expect(sameParent({ ...parent, nlink: 2n }, { ...parent, nlink: 99n })).toBe(true);
    for (const changed of [
      { ...parent, dev: 9n },
      { ...parent, ino: 9n },
      { ...parent, mode: 0o40700n },
      { ...parent, type: "regular" },
    ])
      expect(sameParent(parent, changed)).toBe(false);

    const settle = async (state, primary, targetBehavior, parentBehavior) => {
      const order = [];
      const failures = [];
      const close = async (name, behavior, code) => {
        order.push(name);
        if (behavior === "sync") throw new Error("raw secret");
        if (behavior === "reject") await Promise.reject(new Error("raw secret"));
        return code;
      };
      if (state === "PARENT_AND_TARGET") {
        try {
          await close("target", targetBehavior, "TARGET_CLOSE_FAILED");
        } catch {
          failures.push("TARGET_CLOSE_FAILED");
        }
      }
      if (state === "PARENT" || state === "PARENT_AND_TARGET") {
        try {
          await close("parent", parentBehavior, "PARENT_CLOSE_FAILED");
        } catch {
          failures.push("PARENT_CLOSE_FAILED");
        }
      }
      return {
        order,
        failures,
        code: primary ?? failures.at(0),
        burned: primary !== undefined || failures.length !== 0,
      };
    };
    for (const primary of [undefined, "WRITE"]) {
      expect(await settle("NONE", primary, "ok", "ok")).toEqual({
        order: [],
        failures: [],
        code: primary,
        burned: primary !== undefined,
      });
      for (const parentBehavior of ["ok", "sync", "reject"]) {
        const result = await settle("PARENT", primary, "ok", parentBehavior);
        expect(result.order).toEqual(["parent"]);
        expect(result.code).toBe(
          primary ?? (parentBehavior === "ok" ? undefined : "PARENT_CLOSE_FAILED"),
        );
      }
      for (const targetBehavior of ["ok", "sync", "reject"])
        for (const parentBehavior of ["ok", "sync", "reject"]) {
          const result = await settle("PARENT_AND_TARGET", primary, targetBehavior, parentBehavior);
          expect(result.order).toEqual(["target", "parent"]);
          expect(result.code).toBe(
            primary ??
              (targetBehavior === "ok"
                ? parentBehavior === "ok"
                  ? undefined
                  : "PARENT_CLOSE_FAILED"
                : "TARGET_CLOSE_FAILED"),
          );
          expect(JSON.stringify(result)).not.toContain("raw secret");
        }
    }
    expect(source).toContain('let state = "NONE"');
    expect(source).toContain('state = "PARENT"');
    expect(source).toContain('state = "PARENT_AND_TARGET"');
    const transition = (state, event) => {
      if (state === "NONE" && event === "parent-success") return "PARENT";
      if (state === "PARENT" && event === "target-success") return "PARENT_AND_TARGET";
      if (state === "NONE" && event === "parent-failure") return "NONE";
      if (state === "PARENT" && event === "target-failure") return "PARENT";
      throw new Error("invalid transition");
    };
    expect(transition("NONE", "parent-success")).toBe("PARENT");
    expect(transition("PARENT", "target-success")).toBe("PARENT_AND_TARGET");
    expect(transition("NONE", "parent-failure")).toBe("NONE");
    expect(transition("PARENT", "target-failure")).toBe("PARENT");
    expect(source.indexOf("await handles.target.close()")).toBeLessThan(
      source.indexOf("await handles.parent.close()"),
    );
  });

  it("rejects stale canonical trust before a forged PATH pnpm can execute", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zc-forged-pnpm-"));
    const forged = path.join(directory, "pnpm");
    const canary = path.join(directory, "EXECUTED");
    await writeFile(
      forged,
      `#!/bin/sh\nprintf bad > ${JSON.stringify(canary)}\nprintf '11.9.0\\n'\n`,
    );
    await chmod(forged, 0o755);
    const { phase } = await verifyTrustPreflight(repositoryRoot, process.env);
    if (phase === "preseal") {
      await expect(
        verifyTrustPreflight(repositoryRoot, { PATH: directory }),
      ).resolves.toMatchObject({
        phase: "preseal",
      });
    } else {
      await expect(verifyTrustPreflight(repositoryRoot, { PATH: directory })).rejects.toThrow(
        /host pnpm identity differs/u,
      );
    }
    await expect(readFile(canary)).rejects.toThrow();
    await rm(directory, { recursive: true, force: true });
  });

  it("writes only exact canonical evidence targets through checked parents", async () => {
    const roots = [];
    const fixture = async () => {
      const root = await mkdtemp(path.join(tmpdir(), "zc-evidence-writer-"));
      roots.push(root);
      await mkdir(path.join(root, "ci", "generated"), { recursive: true });
      return root;
    };
    const allowed = new Set([
      "ci/generated/absent.json",
      "ci/generated/existing.json",
      "ci/generated/output.json",
      "ci/missing/output.json",
      "blocked/output.json",
    ]);
    const external = await mkdtemp(path.join(tmpdir(), "zc-evidence-canary-"));
    roots.push(external);
    const canary = path.join(external, "canary.json");
    await writeFile(canary, "unchanged");

    try {
      const success = await fixture();
      await writeFile(path.join(success, "ci", "generated", "existing.json"), "old");
      await safeWriteEvidence(success, "ci/generated/existing.json", "new", allowed);
      await safeWriteEvidence(success, "ci/generated/absent.json", "created", allowed);
      expect(await readFile(path.join(success, "ci", "generated", "existing.json"), "utf8")).toBe(
        "new",
      );
      expect(await readFile(path.join(success, "ci", "generated", "absent.json"), "utf8")).toBe(
        "created",
      );

      const createOnce = await fixture();
      const order = [];
      await safeCreateEvidence(createOnce, "ci/generated/absent.json", "first", allowed, {
        nonceFactory: () => "0".repeat(32),
        writeOperation: async (handle, value) => {
          order.push("write");
          await handle.writeFile(value);
        },
        fileSyncOperation: async (handle) => {
          order.push("file-sync");
          await handle.sync();
        },
        directorySyncOperation: async (handle, phase) => {
          order.push(`directory-sync-${phase}`);
          await handle.sync();
        },
        linkOperation: async (temporary, target) => {
          order.push("link");
          await link(temporary, target);
        },
        unlinkOperation: async (temporary) => {
          order.push("unlink-temp");
          await rm(temporary);
        },
        finalVerificationOperation: () => order.push("final-verify"),
      });
      expect(order).toEqual([
        "directory-sync-attempt",
        "write",
        "file-sync",
        "link",
        "directory-sync-publication",
        "unlink-temp",
        "directory-sync-cleanup",
        "final-verify",
      ]);
      await expect(
        safeCreateEvidence(createOnce, "ci/generated/absent.json", "second", allowed),
      ).rejects.toThrow(/already exists/u);
      expect(await readFile(path.join(createOnce, "ci/generated/absent.json"), "utf8")).toBe(
        "first",
      );
      expect((await lstat(path.join(createOnce, "ci/generated/absent.json"))).nlink).toBe(1);
      expect((await lstat(path.join(createOnce, "ci/generated/absent.json"))).mode & 0o777).toBe(
        0o644,
      );
      expect(
        createHash("sha256")
          .update(await readFile(path.join(createOnce, "ci/generated/absent.json")))
          .digest("hex"),
      ).toBe(createHash("sha256").update("first").digest("hex"));

      for (const kind of ["regular", "symlink", "hardlink", "directory"]) {
        const occupied = await fixture();
        const target = path.join(occupied, "ci", "generated", "absent.json");
        const source = path.join(occupied, "ci", "generated", "existing.json");
        await writeFile(source, "unchanged");
        if (kind === "regular") await writeFile(target, "unchanged");
        if (kind === "symlink") await symlink(source, target);
        if (kind === "hardlink") await link(source, target);
        if (kind === "directory") await mkdir(target);
        await expect(safeCreateEvidence(occupied, "ci/generated/absent.json", "ours", allowed), {
          showPrefix: false,
        }).rejects.toThrow();
        expect(await readFile(source, "utf8")).toBe("unchanged");
        expect((await lstat(target)).isDirectory()).toBe(kind === "directory");
      }

      const preexistingOrphan = await fixture();
      const orphan = path.join(
        preexistingOrphan,
        "ci",
        "generated",
        `.absent.json.zc-create-${"1".repeat(32)}.tmp`,
      );
      await writeFile(orphan, "orphan");
      await expect(
        safeCreateEvidence(preexistingOrphan, "ci/generated/absent.json", "ours", allowed),
      ).rejects.toThrow(/attempt orphan; revision is burned/u);
      expect(await readFile(orphan, "utf8")).toBe("orphan");

      const competingAttempt = await fixture();
      const ownerNonce = "2".repeat(32);
      const competing = path.join(
        competingAttempt,
        "ci",
        "generated",
        `.absent.json.zc-create-${"3".repeat(32)}.tmp`,
      );
      await expect(
        safeCreateEvidence(competingAttempt, "ci/generated/absent.json", "ours", allowed, {
          nonceFactory: () => ownerNonce,
          writeOperation: async (handle, value) => {
            await handle.writeFile(value);
            await writeFile(competing, "competitor", { flag: "wx", mode: 0o644 });
          },
        }),
      ).rejects.toThrow(/competing attempt detected; revision is burned and preserved/u);
      expect(
        (await readdir(path.join(competingAttempt, "ci", "generated"))).filter((name) =>
          name.includes(".zc-create-"),
        ),
      ).toHaveLength(2);
      await expect(
        safeCreateEvidence(competingAttempt, "ci/generated/absent.json", "retry", allowed),
      ).rejects.toThrow(/attempt orphan/u);

      const lostAcknowledgement = await fixture();
      await expect(
        safeCreateEvidence(lostAcknowledgement, "ci/generated/absent.json", "ours", allowed, {
          linkOperation: async (temporary, target) => {
            await link(temporary, target);
            throw new Error("synthetic success-then-throw");
          },
        }),
      ).rejects.toThrow(/lost acknowledgement; revision is burned and preserved/u);
      expect(
        await readFile(path.join(lostAcknowledgement, "ci", "generated", "absent.json"), "utf8"),
      ).toBe("ours");
      expect(
        (await readdir(path.join(lostAcknowledgement, "ci", "generated"))).filter((name) =>
          name.includes(".zc-create-"),
        ),
      ).toHaveLength(1);
      await expect(
        safeCreateEvidence(lostAcknowledgement, "ci/generated/absent.json", "retry", allowed),
      ).rejects.toThrow(/already exists/u);

      const ambiguousUnowned = await fixture();
      await expect(
        safeCreateEvidence(ambiguousUnowned, "ci/generated/absent.json", "ours", allowed, {
          linkOperation: async (_temporary, target) => {
            await writeFile(target, "unowned", { flag: "wx", mode: 0o644 });
            throw new Error("synthetic unowned ambiguity");
          },
        }),
      ).rejects.toThrow(/collision or ambiguity/u);
      expect(
        await readFile(path.join(ambiguousUnowned, "ci", "generated", "absent.json"), "utf8"),
      ).toBe("unowned");
      expect(
        (await readdir(path.join(ambiguousUnowned, "ci", "generated"))).filter((name) =>
          name.includes(".zc-create-"),
        ),
      ).toHaveLength(1);

      const replacedAfterAcknowledgement = await fixture();
      await expect(
        safeCreateEvidence(
          replacedAfterAcknowledgement,
          "ci/generated/absent.json",
          "ours",
          allowed,
          {
            linkOperation: async (temporary, target) => {
              await link(temporary, target);
              await rm(target);
              await writeFile(target, "unowned-after-ack", { flag: "wx", mode: 0o644 });
            },
          },
        ),
      ).rejects.toThrow(/failed closed/u);
      expect(
        await readFile(
          path.join(replacedAfterAcknowledgement, "ci", "generated", "absent.json"),
          "utf8",
        ),
      ).toBe("unowned-after-ack");
      expect(
        (await readdir(path.join(replacedAfterAcknowledgement, "ci", "generated"))).filter((name) =>
          name.includes(".zc-create-"),
        ),
      ).toHaveLength(1);

      for (const [label, testing, expectedTemps] of [
        [
          "write",
          {
            writeOperation: async () => {
              throw new Error("synthetic write failure");
            },
          },
          1,
        ],
        [
          "file-sync",
          {
            fileSyncOperation: async () => {
              throw new Error("synthetic file sync failure");
            },
          },
          1,
        ],
        [
          "link",
          {
            linkOperation: async () => {
              throw new Error("synthetic link failure");
            },
          },
          1,
        ],
        [
          "first-parent-sync",
          {
            directorySyncOperation: async (_handle, phase) => {
              if (phase === "attempt") throw new Error("synthetic parent sync failure");
            },
          },
          1,
        ],
      ]) {
        const failedCreate = await fixture();
        await expect(
          safeCreateEvidence(failedCreate, "ci/generated/absent.json", "blocked", allowed, testing),
        ).rejects.toThrow();
        await expect(
          access(path.join(failedCreate, "ci", "generated", "absent.json")),
        ).rejects.toThrow();
        expect(
          (await readdir(path.join(failedCreate, "ci", "generated"))).filter((name) =>
            name.includes(".zc-create-"),
          ),
          label,
        ).toHaveLength(expectedTemps);
      }

      const sameLengthTamper = await fixture();
      await expect(
        safeCreateEvidence(sameLengthTamper, "ci/generated/absent.json", "good", allowed, {
          writeOperation: (handle) => handle.writeFile("evil"),
        }),
      ).rejects.toThrow(/temporary bytes differ/u);

      const extraTempHardlink = await fixture();
      const hardlinkNonce = "4".repeat(32);
      const ownedTemp = path.join(
        extraTempHardlink,
        "ci",
        "generated",
        `.absent.json.zc-create-${hardlinkNonce}.tmp`,
      );
      await expect(
        safeCreateEvidence(extraTempHardlink, "ci/generated/absent.json", "good", allowed, {
          nonceFactory: () => hardlinkNonce,
          writeOperation: async (handle, value) => {
            await handle.writeFile(value);
            await link(ownedTemp, `${ownedTemp}.extra`);
          },
        }),
      ).rejects.toThrow(/temporary identity differs/u);

      for (const phase of ["publication", "cleanup"]) {
        const syncFailure = await fixture();
        await expect(
          safeCreateEvidence(syncFailure, "ci/generated/absent.json", "ours", allowed, {
            directorySyncOperation: async (handle, observed) => {
              if (observed === phase) throw new Error(`synthetic ${phase} sync failure`);
              await handle.sync();
            },
          }),
        ).rejects.toThrow(/revision is burned and preserved|failed closed/u);
        expect(
          await readFile(path.join(syncFailure, "ci", "generated", "absent.json"), "utf8"),
        ).toBe("ours");
      }

      const unlinkFailure = await fixture();
      await expect(
        safeCreateEvidence(unlinkFailure, "ci/generated/absent.json", "ours", allowed, {
          unlinkOperation: async () => {
            throw new Error("synthetic unlink failure");
          },
        }),
      ).rejects.toThrow(/failed closed/u);
      expect(
        (await readdir(path.join(unlinkFailure, "ci", "generated"))).filter((name) =>
          name.includes(".zc-create-"),
        ),
      ).toHaveLength(1);

      const finalFailure = await fixture();
      await expect(
        safeCreateEvidence(finalFailure, "ci/generated/absent.json", "ours", allowed, {
          finalVerificationOperation: async ({ target }) => {
            await rm(target);
            await writeFile(target, "evil", { flag: "wx", mode: 0o644 });
          },
        }),
      ).rejects.toThrow(/failed closed/u);
      expect(
        await readFile(path.join(finalFailure, "ci", "generated", "absent.json"), "utf8"),
      ).toBe("evil");

      const supplySource = await readFile(
        path.join(repositoryRoot, "scripts", "verify-supply-chain.mjs"),
        "utf8",
      );
      const createCall = supplySource.indexOf(
        "await createProvenanceOnce(policy.provenancePath, renderedProvenance, createTargets)",
      );
      expect(createCall).toBeGreaterThan(-1);
      expect(supplySource.indexOf("await validateImmutableC05R10(policy)")).toBeLessThan(
        createCall,
      );
      expect(
        supplySource.indexOf('safeFile(policy.sbomPath))).toString("utf8") !== renderedSbom'),
      ).toBeLessThan(createCall);

      const linkedCi = await fixture();
      await rm(path.join(linkedCi, "ci"), { recursive: true });
      await symlink(external, path.join(linkedCi, "ci"));
      await expect(
        safeWriteEvidence(linkedCi, "ci/generated/output.json", "blocked", allowed),
      ).rejects.toThrow(/canonical directory/u);

      const linkedGenerated = await fixture();
      await rm(path.join(linkedGenerated, "ci", "generated"), { recursive: true });
      await symlink(external, path.join(linkedGenerated, "ci", "generated"));
      await expect(
        safeWriteEvidence(linkedGenerated, "ci/generated/output.json", "blocked", allowed),
      ).rejects.toThrow(/canonical directory/u);

      const linkedTarget = await fixture();
      await symlink(canary, path.join(linkedTarget, "ci", "generated", "output.json"));
      await expect(
        safeWriteEvidence(linkedTarget, "ci/generated/output.json", "blocked", allowed),
      ).rejects.toThrow(/canonical regular file/u);

      const specialTarget = await fixture();
      await mkdir(path.join(specialTarget, "ci", "generated", "output.json"));
      await expect(
        safeWriteEvidence(specialTarget, "ci/generated/output.json", "blocked", allowed),
      ).rejects.toThrow(/canonical regular file/u);

      const missingParent = await fixture();
      await expect(
        safeWriteEvidence(missingParent, "ci/missing/output.json", "blocked", allowed),
      ).rejects.toThrow();

      const unexpectedParent = await fixture();
      await writeFile(path.join(unexpectedParent, "blocked"), "not-a-directory");
      await expect(
        safeWriteEvidence(unexpectedParent, "blocked/output.json", "blocked", allowed),
      ).rejects.toThrow();

      const collision = await fixture();
      const occupiedNonce = "0".repeat(32);
      const availableNonce = "1".repeat(32);
      const collisionName = `.output.json.zc-evidence-${occupiedNonce}.tmp`;
      await writeFile(path.join(collision, "ci", "generated", collisionName), "occupied");
      await safeWriteEvidence(collision, "ci/generated/output.json", "written", allowed, {
        nonceFactory: (attempt) => (attempt === 0 ? occupiedNonce : availableNonce),
      });
      expect(await readFile(path.join(collision, "ci", "generated", collisionName), "utf8")).toBe(
        "occupied",
      );

      const renameFailure = await fixture();
      await expect(
        safeWriteEvidence(renameFailure, "ci/generated/output.json", "blocked", allowed, {
          nonceFactory: () => "2".repeat(32),
          renameOperation: async () => {
            throw new Error("synthetic rename failure");
          },
        }),
      ).rejects.toThrow(/atomic evidence rename failed/u);
      expect(
        (await readdir(path.join(renameFailure, "ci", "generated"))).filter((name) =>
          name.includes(".zc-evidence-"),
        ),
      ).toEqual([]);
      expect(await readFile(canary, "utf8")).toBe("unchanged");
    } finally {
      for (const root of roots.reverse()) await rm(root, { recursive: true, force: true });
    }
  });
});

describe("H11B authored finalizer source contract", () => {
  const expectedChangedTargets = [
    "ci/generated/provenance/H11B-PROV-R51-001.json",
    "ci/generated/sbom.cdx.json",
    "ci/installed-license-evidence.json",
    "ci/tool-payload-inventory.json",
    "ci/trust-baseline.json",
  ];

  it("pins the consumed finalizer bytes and accepts the sealed predecessor", async () => {
    if ((await finalizerState()) === "preseal")
      await expect(requireFinalizerPrestate(repositoryRoot)).resolves.toBeUndefined();
    else await expect(requireFinalizerPrestate(repositoryRoot)).rejects.toThrow();
    const source = await readFile(
      path.join(repositoryRoot, "scripts/generate-b03-local-evidence.mjs"),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "94a94471f39e451dcffa2e248f21d5f33dd4db46671babfda47f07171bf330b1",
    );
    expect(expectedChangedTargets).toEqual([
      provenanceTarget,
      "ci/generated/sbom.cdx.json",
      "ci/installed-license-evidence.json",
      "ci/tool-payload-inventory.json",
      "ci/trust-baseline.json",
    ]);
  });

  it("pins the exact preseal inputs or consumed postseal record", async () => {
    expect(Object.isFrozen(predecessorTargets)).toBe(true);
    const state = await finalizerState();
    if (state === "preseal") {
      for (const expected of predecessorTargets) {
        expect(Object.isFrozen(expected)).toBe(true);
        const current = await readFile(path.join(repositoryRoot, expected.path));
        expect(current).toHaveLength(expected.bytes);
        expect(createHash("sha256").update(current).digest("hex")).toBe(expected.sha256);
        const stat = await lstat(path.join(repositoryRoot, expected.path));
        expect(stat.mode & 0o777).toBe(0o644);
        expect(stat.nlink).toBe(1);
      }
      await expect(access(path.join(repositoryRoot, provenanceTarget))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } else {
      expect(state).toBe("postseal");
      await expect(access(path.join(repositoryRoot, provenanceTarget))).resolves.toBeUndefined();
    }
  });

  it("denies every incoherent finalizer state", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-finalizer-state-")));
    const target = path.join(root, provenanceTarget);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await expect(finalizerState(root)).resolves.toBe("preseal");
      await writeFile(target, "{}\n", { mode: 0o644 });
      await expect(finalizerState(root)).rejects.toThrow(/record differs/u);
      await writeFile(
        target,
        `${JSON.stringify({
          record_id: "H11B-PROV-R51-001",
          task_id: "H11B",
          operational_actor: { public_id: "codex-h11b-finalizer-r51-worker" },
          predicate: {
            predicate_type: "zintus-continuity.local-unsigned-provenance@85",
          },
          recorded_at: "2026-08-17T08:00:00.000Z",
        })}\n`,
      );
      await expect(finalizerState(root)).resolves.toBe("postseal");
      await chmod(target, 0o600);
      await expect(finalizerState(root)).rejects.toThrow(/not canonical/u);
      await chmod(target, 0o644);
      await link(target, `${target}.extra`);
      await expect(finalizerState(root)).rejects.toThrow(/not canonical/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pins the exact H11B inventory delta, trust closure, and immutable predecessors", async () => {
    const record = (relative, index, overrides = {}) => ({
      path: relative,
      type: "regular",
      dev: "1",
      ino: String(index + 10),
      mode: "0644",
      nlink: "1",
      size: "1",
      mtimeNs: "1",
      ctimeNs: "1",
      sha256: "0".repeat(64),
      ...overrides,
    });
    const paths = [
      "ci/generated/provenance",
      "ci/generated/sbom.cdx.json",
      "ci/installed-license-evidence.json",
      "ci/tool-payload-inventory.json",
      "ci/trust-baseline.json",
    ];
    const before = {
      records: paths.map((relative, index) =>
        record(
          relative,
          index,
          relative.endsWith("provenance")
            ? { type: "directory", mode: "0755", nlink: "37", sha256: null, size: "1184" }
            : {},
        ),
      ),
      count: paths.length,
    };
    const after = structuredClone(before);
    for (const item of after.records.filter(
      ({ path: relative }) => relative !== "ci/generated/provenance",
    )) {
      item.size = "2";
      item.sha256 = "1".repeat(64);
    }
    after.records[0].nlink = "38";
    after.records[0].size = "1216";
    after.records[0].mtimeNs = "2";
    after.records[0].ctimeNs = "2";
    after.records.push(record(provenanceTarget, 99));
    after.records.sort((left, right) => utf8Order(left.path, right.path));
    after.count += 1;
    expect(requireExactInventoryTransition(before, after, "h11b")).toEqual(expectedChangedTargets);
    expect(() =>
      requireExactInventoryTransition(
        before,
        { ...after, records: Array.from(after.records).reverse() },
        "h11b",
      ),
    ).toThrow(/strict deterministic UTF-8 byte order/u);
    expect(() =>
      requireExactInventoryTransition(
        before,
        {
          ...after,
          records: after.records.map((item) =>
            item.path === provenanceTarget ? { ...item, mode: "0600" } : item,
          ),
        },
        "h11b",
      ),
    ).toThrow();
    for (const mutate of [
      (item) => (item.nlink = "37"),
      (item) => (item.nlink = "39"),
      (item) => (item.size = "1215"),
      (item) => (item.size = "1217"),
      (item) => (item.mtimeNs = "1"),
      (item) => (item.ctimeNs = "1"),
      (item) => (item.dev = "2"),
    ]) {
      const changedParent = structuredClone(after);
      mutate(changedParent.records[0]);
      expect(() => requireExactInventoryTransition(before, changedParent, "h11b")).toThrow(
        /inventory create parent identity differs/u,
      );
    }
    const pythonSource = await readFile(
      path.join(repositoryRoot, "scripts/h02c-ci-inventory.py"),
      "utf8",
    );
    expect(pythonSource).toContain(
      'int(right[relative]["nlink"]) != int(left[relative]["nlink"]) + 1',
    );
    expect(pythonSource).toContain(
      'int(right[relative]["size"]) != int(left[relative]["size"]) + 32',
    );
    expect(pythonSource).toContain('left[relative]["mtimeNs"] == right[relative]["mtimeNs"]');
    expect(pythonSource).toContain('left[relative]["ctimeNs"] == right[relative]["ctimeNs"]');

    expect(trustAnchorPaths).toHaveLength(87);
    expect(trustAnchorPaths).toContain("scripts/generate-b03-local-evidence.mjs");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r2.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r3.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r4.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r6.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r7.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r8.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r9.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r10.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r11.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r12.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r13.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r14.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r15.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r16.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r29.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r30.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r31.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r32.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r35.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r36.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r37.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r38.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r39.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r40.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r41.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r42.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r43.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r44.json");
    expect(trustAnchorPaths).toContain("ci/h11b-cleanroom-policy-r45.json");
    expect(trustAnchorPaths).not.toContain("ci/h11b-cleanroom-policy-r24.json");
    expect(trustAnchorPaths).not.toContain("ci/trust-baseline.json");
    expect(trustAnchorPaths).not.toContain("ci/generated/sbom.cdx.json");
    expect(trustAnchorPaths).not.toContain(provenanceTarget);
    const trustSource = await readFile(
      path.join(repositoryRoot, "scripts/verify-trust-preflight.mjs"),
      "utf8",
    );
    expect(trustSource).not.toContain("trustBaselineSha256");
    for (const [relative, bytes, sha256] of [
      [
        "ci/h11b-cleanroom-policy-r1.json",
        19896,
        "d583c0848494d27bef97343f59260e399bc96c9a71b59b6d6b447d7363e99c5f",
      ],
      [
        "ci/h11b-cleanroom-policy-r2.json",
        20529,
        "a4d984c2436cd52b0d2026d7411d7736cfaafa1315b2568b56288e06b3540362",
      ],
      [
        "ci/h11b-cleanroom-policy-r3.json",
        20539,
        "f8ff0a6099f0534011f500585030e6d0f02cbc99dfa9ee2b190675658e84b01b",
      ],
      [
        "ci/h11b-cleanroom-policy-r4.json",
        20545,
        "656971161f3a658f6e80e9374db26f6aaec08ff34f07c50c897a8bf246ffa9fe",
      ],
      [
        "ci/generated/provenance/H02C-PROV-R6-001.json",
        537498,
        "59b7960eca4ca6613c088f61a3513307b7ce26a40d6381f362f9872c081acbdc",
      ],
    ]) {
      const content = await readFile(path.join(repositoryRoot, relative));
      expect(content).toHaveLength(bytes);
      expect(createHash("sha256").update(content).digest("hex")).toBe(sha256);
    }
  });
});
