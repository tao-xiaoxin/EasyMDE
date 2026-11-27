import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finiteTransitionsProbeEnabled } from "./environment.mjs";
import { installPreviewFreshnessProbe } from "./preview-freshness-probe.mjs";
import { nativePayloadExportDirectory } from "./native-payload-export.mjs";
import { nativePayloadSafeStem } from "./native-payload-export.mjs";
import { nativeSurfaceFingerprint } from "./native-payload-export.mjs";
import { stopPreviewFreshnessProbe } from "./preview-freshness-probe.mjs";

export function summarizeFiniteTransitionSnapshot(snapshot) {
  return {
    animations: snapshot.currentAnimations,
    firstChangedStyle: snapshot.firstChangedStyle,
    fontStatus: snapshot.currentFontStatus,
    nodeCount: snapshot.currentNodeCount,
    sourceHtmlHash: snapshot.sourceHtmlHash,
    sourceHtmlLength: snapshot.sourceHtmlLength
  };
}

export async function probeFiniteTransitions(page, caseId) {
  if (!finiteTransitionsProbeEnabled) return null;
  await installPreviewFreshnessProbe(page, { force: true });
  const before = await page.evaluate(() => (
    globalThis.__easymdePreviewFreshnessProbe.read()
  ));
  await page.evaluate(() => globalThis.__easymdePreviewFreshnessProbe.awaitFiniteTransitions());
  const after = await page.evaluate(() => (
    globalThis.__easymdePreviewFreshnessProbe.read()
  ));
  await stopPreviewFreshnessProbe(page, { force: true });
  return {
    after: summarizeFiniteTransitionSnapshot(after),
    before: summarizeFiniteTransitionSnapshot(before),
    caseId,
    sourceHtmlStable: before.sourceHtmlHash === after.sourceHtmlHash
  };
}

export async function recordFiniteTransitionProbeCase(testInfo, probeCase, articleThemeId) {
  if (!finiteTransitionsProbeEnabled || !probeCase) return;
  testInfo.wechatFiniteTransitionProbeCases ??= [];
  testInfo.wechatFiniteTransitionProbeCases.push(probeCase);
  const directory = nativePayloadExportDirectory();
  if (!directory) return;
  const safeThemeId = nativePayloadSafeStem(articleThemeId, 'finite-transition-theme-id');
  const path = join(directory, `finite-transition-${safeThemeId}.json`);
  await writeFile(path, `${JSON.stringify(probeCase, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(path, 0o600);
}

export async function recordFiniteTransitionFailurePayload({
  articleThemeId,
  caseId,
  codeThemeId,
  html,
  isolated,
  sourceEvidence,
  width
}) {
  if (!finiteTransitionsProbeEnabled) return;
  const directory = nativePayloadExportDirectory();
  if (!directory) return;
  const safeThemeId = nativePayloadSafeStem(articleThemeId, 'finite-transition-failure-theme-id');
  const htmlFile = `finite-transition-failure-${safeThemeId}.html`;
  const evidenceFile = `finite-transition-failure-${safeThemeId}.json`;
  const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  await writeFile(join(directory, htmlFile), html, { encoding: 'utf8', mode: 0o600 });
  await chmod(join(directory, htmlFile), 0o600);
  await writeFile(join(directory, evidenceFile), `${JSON.stringify({
    articleThemeId,
    caseId,
    codeThemeId,
    htmlFile,
    htmlSha256,
    isolated: isolated.payload.map(({ destinationWidth, surface }) => ({
      destinationWidth,
      surface: nativeSurfaceFingerprint(surface)
    })),
    source: nativeSurfaceFingerprint(sourceEvidence),
    status: 'failure-diagnostic',
    width
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(join(directory, evidenceFile), 0o600);
}

export async function recordNativeVisualSignatureFailure({
  articleThemeId,
  destinationWidth,
  html,
  sourceEvidence,
  targetEvidence
}) {
  const directory = nativePayloadExportDirectory();
  if (!directory) return;
  if (!Number.isFinite(destinationWidth) || destinationWidth <= 0) {
    throw new Error('wechat-visual-signature-failure-width-invalid');
  }
  const safeThemeId = nativePayloadSafeStem(articleThemeId, 'visual-signature-failure-theme-id');
  const widthStem = String(Math.round(destinationWidth));
  const htmlFile = `article-visual-signature-failure-${safeThemeId}-${widthStem}.html`;
  const evidenceFile = `article-visual-signature-failure-${safeThemeId}-${widthStem}.json`;
  const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  const signature = (surface) => {
    const candidate = (surface.visualSignatures ?? []).find(({ id }) => id === 'link');
    if (!candidate) return null;
    return {
      id: candidate.id,
      inlineStyle: candidate.inlineStyle,
      kind: candidate.kind,
      ownerHasAnchor: candidate.ownerHasAnchor,
      ownerInlineStyle: candidate.ownerInlineStyle,
      ownerStyle: candidate.ownerStyle,
      ownerStyleHash: createHash('sha256')
        .update(JSON.stringify(candidate.ownerStyle), 'utf8')
        .digest('hex'),
      ownerTag: candidate.ownerTag,
      paint: candidate.paint,
      style: candidate.style,
      styleHash: createHash('sha256')
        .update(JSON.stringify(candidate.style), 'utf8')
        .digest('hex'),
      textLength: candidate.textLength
    };
  };
  const htmlPath = join(directory, htmlFile);
  const evidencePath = join(directory, evidenceFile);
  await writeFile(htmlPath, html, { encoding: 'utf8', mode: 0o600 });
  await chmod(htmlPath, 0o600);
  await writeFile(evidencePath, `${JSON.stringify({
    articleThemeId,
    destinationWidth,
    htmlFile,
    htmlSha256,
    source: signature(sourceEvidence),
    status: 'failure-diagnostic',
    target: signature(targetEvidence)
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(evidencePath, 0o600);
}
