import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { ownDataKeys, readOwnData } from "./safe-own-data.mjs";

const DEFAULT_ATTEMPTS = 8;

function exactRelativePath(relative) {
  return (
    typeof relative === "string" &&
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    !path.win32.isAbsolute(relative) &&
    !relative.includes("\\") &&
    relative.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
    path.normalize(relative) === relative
  );
}

function identity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function sameIdentity(left, right) {
  return ownDataKeys(left).every(
    (key) => readOwnData(left, String(key)) === readOwnData(right, String(key)),
  );
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function canonicalDirectory(candidate, label) {
  let stat;
  try {
    stat = await lstat(candidate, { bigint: true });
  } catch {
    throw new Error(`${label} inspection failed`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`${label} must be a canonical directory`);
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new Error(`${label} inspection failed`);
  }
  if (resolved !== candidate) throw new Error(`${label} must be a canonical directory`);
  return identity(stat);
}

async function canonicalRepositoryRoot(repositoryRoot) {
  const requested = path.resolve(repositoryRoot);
  let requestedStat;
  try {
    requestedStat = await lstat(requested, { bigint: true });
  } catch {
    throw new Error("repository root inspection failed");
  }
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory())
    throw new Error("repository root must be a real directory");
  let root;
  try {
    root = await realpath(requested);
  } catch {
    throw new Error("repository root inspection failed");
  }
  await canonicalDirectory(root, "repository root");
  return root;
}

async function inspectTarget(candidate, relative) {
  let stat;
  try {
    stat = await lstat(candidate, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`${relative} target inspection failed`);
  }
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${relative} target must be a canonical regular file`);
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new Error(`${relative} target inspection failed`);
  }
  if (resolved !== candidate)
    throw new Error(`${relative} target must be a canonical regular file`);
  return identity(stat);
}

async function checkedLayout(root, relative) {
  const parents = [];
  let current = root;
  for (const component of path.dirname(relative).split("/")) {
    if (component === ".") continue;
    current = path.join(current, component);
    parents.push({
      candidate: current,
      identity: await canonicalDirectory(current, "target parent"),
    });
  }
  return parents;
}

async function revalidateLayout(parents) {
  for (const parent of parents) {
    const observed = await canonicalDirectory(parent.candidate, "target parent");
    if (!sameDirectoryIdentity(parent.identity, observed))
      throw new Error("target parent identity changed before rename");
  }
}

async function cleanupOwnedTemp(candidate, ownedIdentity) {
  let observed;
  try {
    observed = await lstat(candidate, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("temporary evidence cleanup inspection failed");
  }
  if (
    observed.isSymbolicLink() ||
    !observed.isFile() ||
    observed.dev !== ownedIdentity.dev ||
    observed.ino !== ownedIdentity.ino
  )
    throw new Error("temporary evidence identity changed; cleanup refused");
  try {
    await unlink(candidate);
  } catch {
    throw new Error("temporary evidence cleanup failed");
  }
}

async function revalidateOwnedTemp(candidate, ownedIdentity) {
  let observed;
  try {
    observed = await lstat(candidate, { bigint: true });
  } catch {
    throw new Error("temporary evidence revalidation failed");
  }
  if (
    observed.isSymbolicLink() ||
    !observed.isFile() ||
    observed.dev !== ownedIdentity.dev ||
    observed.ino !== ownedIdentity.ino
  )
    throw new Error("temporary evidence identity changed before rename");
}

async function classifyTargetAfterLinkError(candidate, ownedIdentity) {
  let observed;
  try {
    observed = await lstat(candidate, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    throw new Error("create-once link-failure target inspection failed");
  }
  if (
    !observed.isSymbolicLink() &&
    observed.isFile() &&
    observed.dev === ownedIdentity.dev &&
    observed.ino === ownedIdentity.ino
  ) {
    return "owned";
  }
  return "unowned";
}

function exactBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function requireExactOpenFile(handle, expected, ownedIdentity, expectedLinks, label) {
  const stat = await handle.stat({ bigint: true });
  if (
    !stat.isFile() ||
    stat.dev !== ownedIdentity.dev ||
    stat.ino !== ownedIdentity.ino ||
    (stat.mode & 0o777n) !== 0o644n ||
    stat.nlink !== BigInt(expectedLinks) ||
    stat.size !== BigInt(expected.length)
  ) {
    throw new Error(`${label} identity differs`);
  }
  const observed = Buffer.alloc(expected.length);
  let offset = 0;
  while (offset < observed.length) {
    const { bytesRead } = await handle.read(observed, offset, observed.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (
    offset !== expected.length ||
    !observed.equals(expected) ||
    createHash("sha256").update(observed).digest("hex") !==
      createHash("sha256").update(expected).digest("hex")
  ) {
    throw new Error(`${label} bytes differ`);
  }
  return stat;
}

async function matchingCreateTemps(parent, basename) {
  const prefix = `.${basename}.zc-create-`;
  return (await readdir(parent)).filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"));
}

async function requireExactPath(candidate, expected, ownedIdentity, expectedLinks, label) {
  const stat = await lstat(candidate, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.dev !== ownedIdentity.dev ||
    stat.ino !== ownedIdentity.ino ||
    (stat.mode & 0o777n) !== 0o644n ||
    stat.nlink !== BigInt(expectedLinks) ||
    stat.size !== BigInt(expected.length)
  ) {
    throw new Error(`${label} identity differs`);
  }
  const handle = await open(candidate, "r");
  try {
    await requireExactOpenFile(handle, expected, ownedIdentity, expectedLinks, label);
  } finally {
    await handle.close();
  }
  return stat;
}

export async function safeWriteEvidence(
  repositoryRoot,
  relative,
  content,
  allowedTargets,
  testing = {},
) {
  if (
    !exactRelativePath(relative) ||
    !(allowedTargets instanceof Set) ||
    !allowedTargets.has(relative)
  )
    throw new Error("evidence target is not exactly allowlisted");
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const parents = await checkedLayout(root, relative);
  const target = path.join(root, relative);
  const initialTarget = await inspectTarget(target, relative);
  const parent = path.dirname(target);
  const basename = path.basename(target);
  const nonceFactory = testing.nonceFactory ?? (() => randomBytes(16).toString("hex"));
  const renameOperation = testing.renameOperation ?? rename;
  let temporary;
  let handle;
  let ownedIdentity;
  for (let attempt = 0; attempt < DEFAULT_ATTEMPTS; attempt += 1) {
    const nonce = nonceFactory(attempt);
    if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error("temporary evidence nonce is invalid");
    temporary = path.join(parent, `.${basename}.zc-evidence-${nonce}.tmp`);
    try {
      handle = await open(temporary, "wx", 0o644);
      const created = await handle.stat({ bigint: true });
      ownedIdentity = { dev: created.dev, ino: created.ino };
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw new Error("temporary evidence creation failed");
    }
  }
  if (!handle || !temporary || !ownedIdentity)
    throw new Error("temporary evidence collision budget exhausted");
  let renamed = false;
  try {
    try {
      await handle.chmod(0o644);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
    } catch {
      throw new Error("temporary evidence write failed");
    }
    handle = undefined;
    await revalidateLayout(parents);
    const currentTarget = await inspectTarget(target, relative);
    if (
      (initialTarget === undefined) !== (currentTarget === undefined) ||
      (initialTarget !== undefined &&
        currentTarget !== undefined &&
        !sameIdentity(initialTarget, currentTarget))
    )
      throw new Error("evidence target identity changed before rename");
    await revalidateOwnedTemp(temporary, ownedIdentity);
    try {
      await renameOperation(temporary, target);
    } catch {
      throw new Error("atomic evidence rename failed");
    }
    renamed = true;
    const finalTarget = await inspectTarget(target, relative);
    if (
      !finalTarget ||
      finalTarget.dev !== ownedIdentity.dev ||
      finalTarget.ino !== ownedIdentity.ino ||
      (finalTarget.mode & 0o777n) !== 0o644n ||
      finalTarget.size !== BigInt(Buffer.byteLength(content))
    )
      throw new Error("evidence target verification failed");
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!renamed) await cleanupOwnedTemp(temporary, ownedIdentity);
  }
}

export async function safeCreateEvidence(
  repositoryRoot,
  relative,
  content,
  allowedTargets,
  testing = {},
) {
  if (
    !exactRelativePath(relative) ||
    !(allowedTargets instanceof Set) ||
    !allowedTargets.has(relative)
  ) {
    throw new Error("evidence target is not exactly allowlisted");
  }
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const parents = await checkedLayout(root, relative);
  const target = path.join(root, relative);
  if ((await inspectTarget(target, relative)) !== undefined) {
    throw new Error("create-once evidence target already exists");
  }
  const parent = path.dirname(target);
  const basename = path.basename(target);
  if ((await matchingCreateTemps(parent, basename)).length !== 0) {
    throw new Error("create-once evidence has an existing attempt orphan; revision is burned");
  }
  const nonceFactory = testing.nonceFactory ?? (() => randomBytes(16).toString("hex"));
  const linkOperation = testing.linkOperation ?? link;
  const writeOperation =
    testing.writeOperation ?? ((targetHandle, value) => targetHandle.writeFile(value));
  const fileSyncOperation = testing.fileSyncOperation ?? ((targetHandle) => targetHandle.sync());
  const directorySyncOperation =
    testing.directorySyncOperation ?? ((directoryHandle) => directoryHandle.sync());
  const unlinkOperation = testing.unlinkOperation ?? unlink;
  const finalVerificationOperation = testing.finalVerificationOperation ?? (() => {});
  let temporary;
  let handle;
  let directoryHandle;
  let ownedIdentity;
  const expected = exactBytes(content);
  const nonce = nonceFactory(0);
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error("temporary evidence nonce is invalid");
  temporary = path.join(parent, `.${basename}.zc-create-${nonce}.tmp`);
  try {
    try {
      directoryHandle = await open(parent, "r");
      const directoryStat = await directoryHandle.stat({ bigint: true });
      const expectedParent = parents.at(-1)?.identity;
      if (
        !directoryStat.isDirectory() ||
        !expectedParent ||
        directoryStat.dev !== expectedParent.dev ||
        directoryStat.ino !== expectedParent.ino
      ) {
        throw new Error("target parent handle identity differs");
      }
      handle = await open(
        temporary,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_RDWR,
        0o644,
      );
      const created = await handle.stat({ bigint: true });
      ownedIdentity = { dev: created.dev, ino: created.ino };
      await handle.chmod(0o644);
      await directorySyncOperation(directoryHandle, "attempt");
      await writeOperation(handle, expected);
      await fileSyncOperation(handle);
      await requireExactOpenFile(handle, expected, ownedIdentity, 1, "create-once temporary");
    } catch (error) {
      throw new Error(
        `create-once durable attempt failed; revision is burned and preserved: ${error.message}`,
        { cause: error },
      );
    }
    await revalidateLayout(parents);
    const reboundParent = await directoryHandle.stat({ bigint: true });
    const expectedParent = parents.at(-1).identity;
    if (reboundParent.dev !== expectedParent.dev || reboundParent.ino !== expectedParent.ino) {
      throw new Error("create-once parent identity changed; revision is burned and preserved");
    }
    if ((await inspectTarget(target, relative)) !== undefined) {
      throw new Error("create-once evidence target collision; revision is burned and preserved");
    }
    await revalidateOwnedTemp(temporary, ownedIdentity);
    await requireExactPath(temporary, expected, ownedIdentity, 1, "create-once temporary");
    const attempts = await matchingCreateTemps(parent, basename);
    if (attempts.length !== 1 || attempts[0] !== path.basename(temporary)) {
      throw new Error("create-once competing attempt detected; revision is burned and preserved");
    }
    try {
      await linkOperation(temporary, target);
    } catch {
      const linkFailureTarget = await classifyTargetAfterLinkError(target, ownedIdentity);
      if (linkFailureTarget === "owned") {
        throw new Error(
          "create-once publication lost acknowledgement; revision is burned and preserved",
        );
      }
      if (linkFailureTarget === "unowned") {
        throw new Error(
          "create-once evidence target collision or ambiguity; revision is burned and preserved",
        );
      }
      throw new Error(
        "create-once publication failed before effect; revision is burned and preserved",
      );
    }
    await requireExactOpenFile(handle, expected, ownedIdentity, 2, "create-once linked handle");
    await requireExactPath(target, expected, ownedIdentity, 2, "create-once linked target");
    await directorySyncOperation(directoryHandle, "publication");
    await unlinkOperation(temporary);
    await directorySyncOperation(directoryHandle, "cleanup");
    await finalVerificationOperation({ target, temporary, ownedIdentity });
    await revalidateLayout(parents);
    await requireExactOpenFile(handle, expected, ownedIdentity, 1, "create-once final handle");
    await requireExactPath(target, expected, ownedIdentity, 1, "create-once final target");
    if ((await matchingCreateTemps(parent, basename)).length !== 0) {
      throw new Error("create-once attempt remnant remains; revision is burned and preserved");
    }
  } catch (error) {
    throw new Error(`create-once evidence failed closed: ${error.message}`, { cause: error });
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (directoryHandle) await directoryHandle.close().catch(() => {});
  }
}
