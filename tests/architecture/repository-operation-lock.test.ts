import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const repositoryOperationLockName = "repository-operation.lock";
const repositoryOperationOwnerName = "owner-token";
const childScript = path.join(
  repositoryRoot,
  "tests",
  "architecture",
  "fixtures",
  "repository-operation-lock-child.mjs",
);
const temporaryRoots: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

async function syntheticRepository() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "zc-operation-lock-")));
  temporaryRoots.push(root);
  return root;
}

function waitForLine(child: ChildProcessWithoutNullStreams, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(`${expected}\n`)) {
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes(`${expected}\n`)) {
        reject(new Error(`child exited ${String(code)} before ${expected}`));
      }
    });
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
  await Promise.all(
    temporaryRoots.splice(0).map((entry) => rm(entry, { force: true, recursive: true })),
  );
});

describe("repository-scoped exclusive operation lock", () => {
  it("fails a concurrent child before shared access, then permits release and reacquisition", async () => {
    const root = await syntheticRepository();
    const holder = spawn(process.execPath, [childScript, root, "hold"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(holder);
    await waitForLine(holder, "LOCKED");

    const contender = spawnSync(process.execPath, [childScript, root, "once"], {
      encoding: "utf8",
    });
    expect(contender.status).not.toBe(0);
    expect(contender.stderr).toBe("LOCK_ERROR:repository operation is already active\n");
    expect(`${contender.stdout}${contender.stderr}`).not.toContain(root);
    await expect(access(path.join(root, ".zc-pnpm-store"))).rejects.toThrow();

    const released = waitForLine(holder, "RELEASED");
    holder.stdin.end("RELEASE\n");
    await released;
    const reacquired = spawnSync(process.execPath, [childScript, root, "once"], {
      encoding: "utf8",
    });
    expect(reacquired.status, reacquired.stderr).toBe(0);
    expect(reacquired.stdout).toBe("ACQUIRED\n");
  });

  it("never deletes an unowned preexisting lock", async () => {
    const root = await syntheticRepository();
    const lock = path.join(root, ".zc-bootstrap", repositoryOperationLockName);
    await mkdir(lock, { recursive: true });
    const owner = path.join(lock, repositoryOperationOwnerName);
    await writeFile(owner, "unowned", "utf8");

    const result = spawnSync(process.execPath, [childScript, root, "once"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe("LOCK_ERROR:repository operation is already active\n");
    await expect(readFile(owner, "utf8")).resolves.toBe("unowned");
  });

  it("rejects a symbolic-link bootstrap without changing its target", async () => {
    const root = await syntheticRepository();
    const target = await syntheticRepository();
    await symlink(target, path.join(root, ".zc-bootstrap"), "dir");

    const result = spawnSync(process.execPath, [childScript, root, "once"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(
      "LOCK_ERROR:bootstrap directory must be a canonical regular directory\n",
    );
    await expect(access(target)).resolves.toBeUndefined();
  });
});
