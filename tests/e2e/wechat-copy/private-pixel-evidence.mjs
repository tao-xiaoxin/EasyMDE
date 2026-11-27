import { randomUUID } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { preparePrivateEvidenceDirectory } from '../private-evidence-directory.mjs';

export function privatePixelEvidencePath(configured = process.env.EASYMDE_E2E_PRIVATE_PIXEL_EVIDENCE_DIR) {
  const value = configured?.trim() ?? '';
  if (!value) return null;
  if (!isAbsolute(value)) {
    throw new Error('wechat-private-pixel-evidence-directory-must-be-absolute');
  }
  const tempRoot = resolve(tmpdir());
  const target = resolve(value);
  const relation = relative(tempRoot, target);
  if (
    !relation
    || '..' === relation
    || relation.startsWith(`..${sep}`)
    || isAbsolute(relation)
  ) {
    throw new Error('wechat-private-pixel-evidence-directory-must-be-temp-child');
  }
  return { target, tempRoot };
}

export async function writePrivatePixelEvidence(
  testInfo,
  role,
  pngBytes,
  evidence,
  configured = process.env.EASYMDE_E2E_PRIVATE_PIXEL_EVIDENCE_DIR
) {
  const configuredPath = privatePixelEvidencePath(configured);
  if (!configuredPath) return;
  const { realDirectory } = await preparePrivateEvidenceDirectory({
    errorCode: 'wechat-private-pixel-evidence-directory-realpath-invalid',
    target: configuredPath.target,
    tempRoot: configuredPath.tempRoot
  });
  await chmod(realDirectory, 0o700);
  const runId = testInfo.wechatPrivatePixelEvidenceRunId
    ??= randomUUID().replace(/[^a-z0-9]/giu, '').slice(0, 16);
  const stem = `wechat-${testInfo.workerIndex}-${runId}-${role}`;
  const pngPath = join(realDirectory, `${stem}-candidate.png`);
  const jsonPath = join(realDirectory, `${stem}-evidence.json`);
  await writeFile(pngPath, pngBytes, { mode: 0o600 });
  await chmod(pngPath, 0o600);
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(jsonPath, 0o600);
}
