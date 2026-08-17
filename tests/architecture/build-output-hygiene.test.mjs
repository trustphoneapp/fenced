import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOutputRoots, removedR3OutputPaths } from "../../scripts/clean-build-outputs.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

describe("build output hygiene", () => {
  it("pins every TypeScript and web output root", () => {
    expect(Object.isFrozen(buildOutputRoots)).toBe(true);
  });

  it("keeps cleaner roots identical to the current B03 output namespace policy", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "ci", "b03-policy.json"), "utf8"),
    );
    expect(buildOutputRoots).toEqual(policy.reproducibility.outputNamespaces);
  });

  it("runs the fixed cleaner before every root build", async () => {
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    expect(manifest.scripts["clean:build"]).toBe("node scripts/safe-build.mjs --clean-only");
    expect(manifest.scripts.build).toBe("node scripts/safe-build.mjs");
    expect(manifest.scripts["verify:source-security"]).toBe(
      "node scripts/verify-source-security.mjs",
    );
    expect(manifest.scripts["verify:source-security:staged"]).toBe(
      "node scripts/verify-source-security.mjs --staged-source",
    );
    expect(manifest.scripts["lint:deps"]).toBe(
      "node scripts/check-dependencies.mjs && node scripts/verify-source-security.mjs --staged-source",
    );
  });

  it("keeps staged proof before builds and final proof after the last output writer", async () => {
    const build = await readFile(path.join(repositoryRoot, "scripts/safe-build.mjs"), "utf8");
    const verify = await readFile(path.join(repositoryRoot, "scripts/safe-verify.mjs"), "utf8");
    const ordered = (text, anchors) => {
      let previousOffset = -1;
      for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors.at(index);
        expect(anchor).toBeDefined();
        const offset = text.indexOf(anchor);
        expect(offset).toBeGreaterThan(previousOffset);
        previousOffset = offset;
      }
    };
    ordered(build, [
      "await cleanBuildOutputs()",
      '"verify:source-security:staged"',
      '"exec", "tsc"',
      '"@zintus-continuity/web", "build"',
      '"verify:source-security"',
    ]);
    ordered(verify, [
      '"staged source security validation"',
      '"same-host reproducibility"',
      '"contract schema validation"',
      '"final source and build security validation"',
      '"Vitest"',
      'label: "H20 public export"',
      '"post-test supply-chain validation"',
      '"post-verification manifest validation"',
    ]);
    expect(verify).toContain(`stage("Vitest", tools.vitest, ["run"]);
      runFixedProcess(
        process.execPath,
        ["--test", path.join(repositoryRoot, "tests", "hackathon", "h20-public-export.test.mjs")],
        {
          cwd: repositoryRoot,
          env: environment,
          label: "H20 public export",
        },
      );
      stage("post-test supply-chain validation", localStages.supplyChain, ["--verify"]);
      stage("post-verification manifest validation", localStages.manifests, []);`);
    expect(verify).toContain(
      'stage("supply-chain validation", localStages.supplyChain, ["--verify"]);',
    );
    expect(
      verify.split('stage("same-host reproducibility", localStages.reproducibility, [').length,
    ).toBe(2);
    expect(
      verify.split('stage("contract schema validation", localStages.contracts, []);').length,
    ).toBe(2);
    expect(verify).not.toContain('"--verify-sbom"');
  });

  it("keeps every removed R3 Promise-sink output absent", async () => {
    expect(Object.isFrozen(removedR3OutputPaths)).toBe(true);
    for (let index = 0; index < removedR3OutputPaths.length; index += 1) {
      const relative = removedR3OutputPaths.at(index);
      expect(relative).toBeDefined();
      let absent = false;
      try {
        await access(path.join(repositoryRoot, relative));
      } catch {
        absent = true;
      }
      expect(absent).toBe(true);
    }
  });
});
