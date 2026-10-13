import { expect } from '@playwright/test';
import { lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writePrivatePixelEvidence } from "./private-pixel-evidence.mjs";

export async function runPrivatePixelEvidenceBoundaryScenario({ _baseURL, test, testInfo }) {

  const originalTempRoot = resolve(tmpdir());
  const allowedTempRoot = await mkdtemp(join(originalTempRoot, 'easymde-private-pixel-boundary-'));
  const outsideRoot = await mkdtemp(join(originalTempRoot, 'easymde-private-pixel-outside-'));
  const tempVariables = ['TMPDIR', 'TMP', 'TEMP'];
  const previousTempVariables = Object.fromEntries(
    tempVariables.map((name) => [name, process.env[name]])
  );
  tempVariables.forEach((name) => { process.env[name] = allowedTempRoot; });
  const symlinkAncestor = join(allowedTempRoot, 'escape');
  const target = join(symlinkAncestor, 'nested');
  const outsideChild = join(outsideRoot, 'nested');

  try {
    await symlink(
      outsideRoot,
      symlinkAncestor,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(writePrivatePixelEvidence(
      testInfo,
      'symlink-escape',
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      { schemaVersion: 1 },
      target
    )).rejects.toThrow('wechat-private-pixel-evidence-directory-realpath-invalid');
    await expect(lstat(outsideChild)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    tempVariables.forEach((name) => {
      if (undefined === previousTempVariables[name]) {
        delete process.env[name];
      } else {
        process.env[name] = previousTempVariables[name];
      }
    });
    await Promise.all([
      rm(allowedTempRoot, { force: true, recursive: true }),
      rm(outsideRoot, { force: true, recursive: true })
    ]);
  }
}
