import process from "node:process";
import { acquireRepositoryOperationLock } from "../../../scripts/repository-operation-lock.mjs";

try {
  const [root, mode] = process.argv.slice(2);
  if (!root || !["hold", "once"].includes(mode)) throw new Error("invalid child arguments");
  const lock = await acquireRepositoryOperationLock(root);
  if (mode === "once") {
    await lock.release();
    process.stdout.write("ACQUIRED\n");
  } else {
    process.stdout.write("LOCKED\n");
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", async (value) => {
      try {
        if (value !== "RELEASE\n") throw new Error("invalid release command");
        await lock.release();
        process.stdout.write("RELEASED\n");
        process.exit(0);
      } catch (error) {
        process.stderr.write(
          `LOCK_ERROR:${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      }
    });
  }
} catch (error) {
  process.stderr.write(`LOCK_ERROR:${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
