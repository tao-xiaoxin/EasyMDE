import { lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

// Shared owner for private E2E evidence directories. Every writer that stores
// private evidence below the temporary root prepares its directory here so no
// writer ever creates a path before its resolved location is proven to stay
// inside the temporary root: an existing symlinked ancestor is rejected before
// the first mkdir, and each newly created segment is resolved and re-checked
// before the next segment is created.
export function assertPrivateEvidenceContainment(
  realTempRoot,
  realDirectory,
  { errorCode, requireChild }
) {
  const realRelation = relative(realTempRoot, realDirectory);
  if (
    (requireChild && !realRelation)
    || '..' === realRelation
    || realRelation.startsWith(`..${sep}`)
    || isAbsolute(realRelation)
  ) {
    throw new Error(errorCode);
  }
}

async function assertRealDirectory(path, errorCode) {
  if (!(await stat(path)).isDirectory()) {
    throw new Error(errorCode);
  }
}

export async function preparePrivateEvidenceDirectory({
  errorCode,
  requireChild = true,
  target,
  tempRoot
}) {
  const realTempRoot = await realpath(tempRoot);
  const pathParts = relative(tempRoot, target).split(sep);
  let existingPath = tempRoot;
  let firstMissingIndex = pathParts.length;

  for (let index = 0; index < pathParts.length; index += 1) {
    const candidatePath = join(tempRoot, ...pathParts.slice(0, index + 1));
    try {
      await lstat(candidatePath);
      existingPath = candidatePath;
    } catch (error) {
      if ('ENOENT' !== error?.code) throw error;
      firstMissingIndex = index;
      break;
    }
  }

  const realExistingPath = await realpath(existingPath);
  await assertRealDirectory(existingPath, errorCode);
  assertPrivateEvidenceContainment(realTempRoot, realExistingPath, {
    errorCode,
    requireChild: false
  });

  let currentPath = existingPath;
  for (let index = firstMissingIndex; index < pathParts.length; index += 1) {
    currentPath = join(currentPath, pathParts[index]);
    await mkdir(currentPath, { mode: 0o700 });
    const realCurrentPath = await realpath(currentPath);
    await assertRealDirectory(currentPath, errorCode);
    assertPrivateEvidenceContainment(realTempRoot, realCurrentPath, {
      errorCode,
      requireChild: true
    });
  }

  const realDirectory = await realpath(target);
  await assertRealDirectory(target, errorCode);
  assertPrivateEvidenceContainment(realTempRoot, realDirectory, {
    errorCode,
    requireChild
  });
  return { realDirectory, realTempRoot };
}
