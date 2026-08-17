import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageHackathonImageContext } from "../../scripts/package-hackathon-image.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("H19B deterministic Lambda image context", () => {
  it("stages only pinned, licensed, content-safe inputs", async () => {
    const first = await packageHackathonImageContext();
    const second = await packageHackathonImageContext();
    try {
      expect(second.aggregateSha256).toBe(first.aggregateSha256);
      expect(second.sizeBytes).toBe(first.sizeBytes);
      expect(first).toMatchObject({
        files: [
          "Dockerfile",
          "LICENSE",
          "THIRD_PARTY_NOTICES.txt",
          "asm-exec",
          "asm-exec.provenance.json",
          "aws-core-plugin.json",
          "index.js",
          "one-request-worker.cjs",
          "package.json",
        ],
        status: "LOCAL_IMAGE_CONTEXT_ONLY",
      });
      expect((await readdir(first.path)).sort()).toEqual(first.files);
      const [dockerfile, provenance, asmExec, manifest, sourceAsmExec, stagedAsmExec] =
        await Promise.all([
          readFile(path.join(first.path, "Dockerfile"), "utf8"),
          readFile(path.join(first.path, "asm-exec.provenance.json"), "utf8"),
          readFile(path.join(first.path, "asm-exec")),
          readFile(path.join(first.path, "aws-core-plugin.json")),
          lstat(new URL("../../third_party/asm-exec", import.meta.url)),
          lstat(path.join(first.path, "asm-exec")),
        ]);
      expect(dockerfile).toContain(
        "public.ecr.aws/lambda/nodejs@sha256:e9e3a91b772514a6a1cac26f89785d89182ae31c97c5ec1a119d8c70c49ac00e",
      );
      expect(dockerfile).toContain(
        "public.ecr.aws/lambda/python@sha256:ca6a04dd52f69be3fdf09ae9c97701742710154fa326440aea549bf709ce30c9",
      );
      expect(dockerfile).toContain("COPY --from=python /var/lang/ /opt/python/");
      expect(dockerfile).toContain(
        "COPY --from=python /lib64/libssl.so.3 /lib64/libssl.so.3.5.7 /lib64/libcrypto.so.3 /lib64/libcrypto.so.3.5.7 /opt/python/lib/",
      );
      expect(dockerfile).toContain("ENV LD_LIBRARY_PATH=/opt/python/lib");
      expect(dockerfile).toContain(
        'RUN ["/bin/rm", "-rf", "/var/lang/lib/node_modules/npm", "/opt/python/lib/python3.13/site-packages"]',
      );
      expect(dockerfile).toContain(
        'RUN ["/opt/python/bin/python3.13", "-I", "-S", "-B", "-c", "import ssl,urllib.request"]',
      );
      expect(dockerfile).not.toContain("COPY --from=python /var/lang/ /var/lang/");
      expect(JSON.parse(provenance)).toMatchObject({
        artifactBytes: 17_320,
        artifactSha256: "359417b7dda3382a1fa601b4a6c0cb07fc370290b340fd1c6affa739897e1607",
        author: "Amazon Web Services",
        continuityPatch: "direct-secretsmanager-https-fallback",
        license: "Apache-2.0",
        plugin: "aws-core",
        pluginManifestSha256: "71f45fc56da35444e887525b710709e71d4af674fb3d1b16c9a1ba5f1f01fbb5",
        pluginVersion: "1.1.0",
        sourcePath: "third_party/asm-exec",
      });
      expect(asmExec).toHaveLength(17_320);
      expect(hash(asmExec)).toBe(
        "359417b7dda3382a1fa601b4a6c0cb07fc370290b340fd1c6affa739897e1607",
      );
      expect(sourceAsmExec.mode & 0o777).toBe(0o644);
      expect(stagedAsmExec.mode & 0o777).toBe(0o555);
      expect(manifest).toHaveLength(4_217);
      expect(hash(manifest)).toBe(
        "71f45fc56da35444e887525b710709e71d4af674fb3d1b16c9a1ba5f1f01fbb5",
      );
    } finally {
      await rm(first.path, { force: true, recursive: true });
      await rm(second.path, { force: true, recursive: true });
    }
  }, 60_000);

  it("pins local tools and performs no Docker, network, cloud, or secret operation", async () => {
    const source = await readFile(
      new URL("../../scripts/package-hackathon-image.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain("third_party/asm-exec");
    expect(source).toContain("(metadata.mode & 0o777) !== 0o644");
    expect(source).toContain("disabled://not-configured");
    expect(source).toContain("shell: false");
    expect(source).not.toMatch(/\bdocker\b.*\b(?:build|pull|push)\b|secretsmanager get/u);
  });
});
