import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const repositoryOperationLockName = "repository-operation.lock";
export const repositoryOperationOwnerName = "owner-token";

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalDirectory(candidate, label) {
  const lexical = path.resolve(candidate);
  const stat = await lstat(lexical);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(lexical)) !== lexical) {
    throw new Error(`${label} must be a canonical regular directory`);
  }
  return lexical;
}

async function ensureBootstrap(root) {
  const bootstrap = path.join(root, ".zc-bootstrap");
  try {
    await mkdir(bootstrap, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await canonicalDirectory(bootstrap, "bootstrap directory");
  if (!inside(root, bootstrap)) throw new Error("bootstrap directory escapes repository");
  return bootstrap;
}

export async function validateRepositoryOperationLockNamespace(root) {
  const canonicalRoot = await canonicalDirectory(root, "repository root");
  const bootstrap = path.join(canonicalRoot, ".zc-bootstrap");
  try {
    await canonicalDirectory(bootstrap, "bootstrap directory");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const name of await readdir(bootstrap)) {
    if (name.endsWith(".lock") && name !== repositoryOperationLockName) {
      throw new Error("unrecognized repository operation lock");
    }
  }
  const lockDirectory = path.join(bootstrap, repositoryOperationLockName);
  try {
    await canonicalDirectory(lockDirectory, "repository operation lock");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const entries = await readdir(lockDirectory);
  if (JSON.stringify(entries) !== JSON.stringify([repositoryOperationOwnerName])) {
    throw new Error("repository operation lock has an unrecognized shape");
  }
  const ownerFile = path.join(lockDirectory, repositoryOperationOwnerName);
  const ownerStat = await lstat(ownerFile);
  const token = await readFile(ownerFile, "utf8");
  if (
    ownerStat.isSymbolicLink() ||
    !ownerStat.isFile() ||
    (await realpath(ownerFile)) !== ownerFile ||
    !/^[0-9a-f]{48}$/u.test(token)
  ) {
    throw new Error("repository operation lock owner is invalid");
  }
}

export async function acquireRepositoryOperationLock(requestedRoot) {
  const root = await canonicalDirectory(requestedRoot, "repository root");
  const bootstrap = await ensureBootstrap(root);
  const lockDirectory = path.join(bootstrap, repositoryOperationLockName);
  try {
    await mkdir(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("repository operation is already active");
    throw error;
  }

  const token = randomBytes(24).toString("hex");
  const ownerFile = path.join(lockDirectory, repositoryOperationOwnerName);
  try {
    await canonicalDirectory(lockDirectory, "repository operation lock");
    if (!inside(root, lockDirectory))
      throw new Error("repository operation lock escapes repository");
    await writeFile(ownerFile, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    try {
      await rmdir(lockDirectory);
    } catch {
      // A nonempty or replaced directory is not ours to remove.
    }
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) throw new Error("repository operation lock was already released");
      await canonicalDirectory(lockDirectory, "repository operation lock");
      const ownerStat = await lstat(ownerFile);
      if (
        ownerStat.isSymbolicLink() ||
        !ownerStat.isFile() ||
        (await realpath(ownerFile)) !== ownerFile ||
        (await readFile(ownerFile, "utf8")) !== token
      ) {
        throw new Error("repository operation lock ownership changed");
      }
      await unlink(ownerFile);
      await rmdir(lockDirectory);
      released = true;
    },
  };
}

export async function withRepositoryOperationLock(root, operation) {
  const lock = await acquireRepositoryOperationLock(root);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}
