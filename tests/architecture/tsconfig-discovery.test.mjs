import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverConfigs } from "../../scripts/check-tsconfig-paths.mjs";

const temporaryRoots = [];

async function temporaryRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "zc-tsconfig-discovery-"));
  temporaryRoots.push(root);
  await writeFile(path.join(root, "tsconfig.json"), "{}", "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((entry) => rm(entry, { force: true, recursive: true })),
  );
});

describe("deterministic tsconfig discovery", () => {
  it("excludes exact bootstrap churn before entry stat traversal", async () => {
    const root = await temporaryRepository();
    const bootstrap = path.join(root, ".zc-bootstrap");
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const churn = path.join(bootstrap, `run-${String(iteration).padStart(6, "0")}`);
      await mkdir(churn, { recursive: true });
      await writeFile(path.join(churn, "tsconfig.attacker.json"), "{", "utf8");
      const visited = [];
      const configs = new Set();
      await discoverConfigs(root, root, configs, async (candidate) => {
        visited.push(candidate);
        if (candidate.startsWith(`${bootstrap}${path.sep}`)) {
          throw new Error("bootstrap entry reached stat traversal");
        }
      });
      expect(Array.from(configs)).toEqual([path.join(root, "tsconfig.json")]);
      expect(visited.some((candidate) => candidate.startsWith(bootstrap))).toBe(false);
      await rm(churn, { recursive: true });
    }
  });

  it("propagates an ENOENT race outside the exact bootstrap namespace", async () => {
    const root = await temporaryRepository();
    const raced = path.join(root, "ordinary-directory");
    await mkdir(raced);
    const configs = new Set();
    await expect(
      discoverConfigs(root, root, configs, async (candidate) => {
        if (candidate === raced) await rm(raced, { recursive: true });
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
