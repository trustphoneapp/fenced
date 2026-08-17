import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

export function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertPathChain(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  if (!inside(absoluteRoot, absoluteCandidate)) {
    throw new Error(`path escapes trusted root: ${absoluteCandidate}`);
  }

  const rootStat = await lstat(absoluteRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`trusted root must be a real directory: ${absoluteRoot}`);
  }

  let current = absoluteRoot;
  let stat = rootStat;
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  const components = relative === "" ? [] : relative.split(path.sep);
  for (let index = 0; index < components.length; index += 1) {
    const component = components.at(index);
    if (component === undefined) throw new Error("path component is missing");
    current = path.join(current, component);
    stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`symbolic link is not allowed: ${current}`);
    }
  }
  return { path: absoluteCandidate, stat };
}

export async function establishTrustedRoot(requestedRoot, canonicalRepository) {
  const repositoryStat = await lstat(canonicalRepository);
  if (repositoryStat.isSymbolicLink() || !repositoryStat.isDirectory()) {
    throw new Error(`repository root must be a real directory: ${canonicalRepository}`);
  }
  const repositoryRoot = await realpath(canonicalRepository);
  const candidate = path.resolve(requestedRoot ?? repositoryRoot);

  if (inside(repositoryRoot, candidate)) {
    const proof = await assertPathChain(repositoryRoot, candidate);
    if (!proof.stat.isDirectory()) {
      throw new Error(`requested root must be a directory: ${candidate}`);
    }
    return await realpath(candidate);
  }

  if (process.env.ZC_ALLOW_SYNTHETIC_TEST_ROOT !== "1") {
    throw new Error(`requested root is outside the repository: ${candidate}`);
  }

  const temporaryRoot = await realpath(tmpdir());
  const candidateStat = await lstat(candidate);
  if (candidateStat.isSymbolicLink()) {
    throw new Error(`symbolic link is not allowed: ${candidate}`);
  }
  if (!candidateStat.isDirectory()) {
    throw new Error(`synthetic trusted root must be a real directory: ${candidate}`);
  }
  const candidateRealpath = await realpath(candidate);
  if (!inside(temporaryRoot, candidateRealpath)) {
    throw new Error(`synthetic trusted root must be inside the OS temp directory: ${candidate}`);
  }
  return candidateRealpath;
}
