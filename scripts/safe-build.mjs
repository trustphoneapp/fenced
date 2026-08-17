import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cleanBuildOutputs } from "./clean-build-outputs.mjs";
import { withRepositoryOperationLock } from "./repository-operation-lock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

function run(args, label) {
  const result = spawnSync("pnpm", args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed`);
}

async function main() {
  const cleanOnly = process.argv.length === 3 && process.argv.at(2) === "--clean-only";
  if (!cleanOnly && process.argv.length !== 2) {
    throw new Error("safe build accepts only --clean-only");
  }
  await withRepositoryOperationLock(repositoryRoot, async () => {
    await cleanBuildOutputs();
    if (cleanOnly) return;
    run(["exec", "node", "scripts/check-dependencies.mjs"], "build dependency validation");
    run(["verify:source-security:staged"], "staged source security validation");
    run(["exec", "tsc", "-b", "--pretty", "false"], "build typecheck");
    run(["--filter", "@zintus-continuity/web", "build"], "web build");
    run(["verify:source-security"], "final source and build security validation");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `safe-build: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
