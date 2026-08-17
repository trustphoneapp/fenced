import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageHackathonLambda } from "../../scripts/package-hackathon-lambda.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("local Lambda artifact packer", () => {
  it("creates a reproducible validated local-only artifact", async () => {
    const first = await packageHackathonLambda();
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `process.umask(0o077);import(${JSON.stringify(new URL("../../scripts/package-hackathon-lambda.mjs", import.meta.url).href)}).then(async m=>process.stdout.write(JSON.stringify(await m.packageHackathonLambda())))`,
      ],
      { cwd: new URL("../../", import.meta.url), encoding: "utf8", shell: false },
    );
    expect(child.status).toBe(0);
    const second = JSON.parse(child.stdout);
    try {
      expect(first).toMatchObject({
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        status: "LOCAL_ARTIFACT_ONLY",
      });
      expect(second.sha256).toBe(first.sha256);
      const bytes = await readFile(first.path);
      expect(sha(bytes)).toBe(first.sha256);
      expect(bytes.length).toBe(first.sizeBytes);
      const listing = spawnSync("/usr/bin/unzip", ["-Z1", first.path], {
        encoding: "utf8",
        shell: false,
      });
      expect(listing.status).toBe(0);
      expect(listing.stdout.trim().split("\n").sort()).toEqual(["index.js", "package.json"]);
      expect(listing.stdout).not.toMatch(
        /(?:^|\/)(?:src|tests?|docs?|\.env)|\.(?:ts|map|d\.ts|tsbuildinfo)$/imu,
      );
    } finally {
      await rm(path.dirname(first.path), { force: true, recursive: true });
      await rm(path.dirname(second.path), { force: true, recursive: true });
    }
  }, 60_000);

  it("uses fixed local tools and rejects arguments, env use, shell, and unsafe archive flags", async () => {
    const source = await readFile(
      new URL("../../scripts/package-hackathon-lambda.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"--bundle"');
    expect(source).toContain("esbuild@0.27.7");
    expect(source).toContain("apps/api/src/index.ts");
    expect(source).not.toContain("apps/api/dist/index.js");
    expect(source).toContain("shell: false");
    expect(source).toContain('"-X"');
    expect(source).not.toMatch(/process\.env|https?:\/\//u);
    expect(
      spawnSync(
        process.execPath,
        [new URL("../../scripts/package-hackathon-lambda.mjs", import.meta.url), "unexpected"],
        { encoding: "utf8", shell: false },
      ).status,
    ).not.toBe(0);
  });
});
