import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export function nativePayloadExportDirectory() {
  const directory = process.env.EASYMDE_E2E_NATIVE_THEME_PAYLOAD_DIR?.trim() ?? '';
  if (!directory) return null;
  if (!isAbsolute(directory)) {
    throw new Error('EASYMDE_E2E_NATIVE_THEME_PAYLOAD_DIR must be absolute');
  }
  return directory;
}

export function nativePayloadExportKey(kind, entry) {
  if ('code' === kind) return `${entry.codeThemeId}:${entry.mode}`;
  return `${entry.articleThemeId}:${entry.mode}`;
}

export function nativePayloadSafeStem(value, label) {
  if ('string' !== typeof value || !/^[a-z0-9_-]+$/u.test(value)) {
    throw new Error(`wechat-native-payload-export-${label}-invalid`);
  }
  return value;
}

export function nativeSurfaceFingerprint(surface) {
  return {
    blocks: surface.blocks.map((block) => ({
      characterCount: block.characters.length,
      codeBox: {
        height: block.code.box.height,
        width: block.code.box.width
      },
      frameBox: {
        height: block.frame.box.height,
        width: block.frame.box.width
      },
      frameMarkerCount: block.markers.length,
      lastLine: {
        lineCount: block.lastLine.lineCount,
        textHash: createHash('sha256').update(block.lastLine.text, 'utf8').digest('hex')
      },
      overflow: block.overflow,
      styleHash: createHash('sha256')
        .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
        .digest('hex'),
      tokenClassCount: block.tokenClassCount,
      textHash: createHash('sha256').update(block.text, 'utf8').digest('hex')
    })),
    elements: surface.elements,
    markers: surface.markers,
    root: {
      box: {
        height: surface.root.box.height,
        width: surface.root.box.width
      },
      overflow: surface.root.overflow,
      overflowNodes: surface.root.overflowNodes
    },
    visualSignatures: (surface.visualSignatures ?? []).map((signature) => ({
      id: signature.id,
      inlineStyle: signature.inlineStyle,
      kind: signature.kind,
      ownerHasAnchor: signature.ownerHasAnchor,
      ownerInlineStyle: signature.ownerInlineStyle,
      ownerStyle: signature.ownerStyle,
      ownerStyleHash: createHash('sha256')
        .update(JSON.stringify(signature.ownerStyle), 'utf8')
        .digest('hex'),
      ownerTag: signature.ownerTag,
      paint: signature.paint,
      style: signature.style,
      styleHash: createHash('sha256')
        .update(JSON.stringify(signature.style), 'utf8')
        .digest('hex'),
      textLength: signature.textLength
    }))
  };
}

export async function readEditorBuildId(page) {
  const buildId = await page.evaluate(() => {
    const bootstrap = globalThis.EasyMDEAdminEditorLoaderBootstrap;
    const root = document.querySelector('#easymde-editor-root');
    const editor = document.querySelector('#easymde-editor');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (
      !bootstrap
      || 'string' !== typeof bootstrap.mainScriptUrl
      || !root
      || !editor
      || !preview
      || root.querySelector('.easymde-editor-startup-error')
    ) {
      throw new Error('wechat-native-payload-export-build-root-unhealthy');
    }
    let mainScriptUrl;
    try {
      mainScriptUrl = new URL(bootstrap.mainScriptUrl, window.location.href);
    } catch {
      throw new Error('wechat-native-payload-export-build-url-invalid');
    }
    if (mainScriptUrl.origin !== window.location.origin) {
      throw new Error('wechat-native-payload-export-build-url-origin-invalid');
    }
    const mainScriptPath = mainScriptUrl.pathname.split('/').pop() ?? '';
    const match = /^admin-editor-(?!loader-)([a-z0-9_-]+)\.js$/iu.exec(mainScriptPath);
    const mainScript = [...document.scripts].find((script) => {
      try {
        return new URL(script.src, window.location.href).href === mainScriptUrl.href;
      } catch {
        return false;
      }
    });
    if (!match || !mainScript) {
      throw new Error('wechat-native-payload-export-build-main-script-unavailable');
    }
    return match[1];
  });
  if (!buildId) throw new Error('wechat-native-payload-export-build-id-unavailable');
  return buildId;
}

export async function createNativePayloadExportState(kind, expectedEntries) {
  const directory = nativePayloadExportDirectory();
  if (!directory) return null;
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const expected = new Set(expectedEntries.map((entry) => nativePayloadExportKey(kind, entry)));
  return {
    directory,
    entries: new Map(),
    expected,
    kind,
    runId: randomUUID()
  };
}

export async function recordNativePayloadExport(state, {
  articleThemeId = null,
  buildId,
  codeThemeId = null,
  html,
  mode,
  sourceEvidence,
  width,
  widths
}) {
  if (!state) return;
  const entry = { articleThemeId, codeThemeId, mode };
  const key = nativePayloadExportKey(state.kind, entry);
  if (!state.expected.has(key)) throw new Error(`wechat-native-payload-export-unexpected:${state.kind}`);
  if (state.entries.has(key)) throw new Error(`wechat-native-payload-export-duplicate:${state.kind}`);
  const themeId = 'code' === state.kind ? codeThemeId : articleThemeId;
  const safeThemeId = nativePayloadSafeStem(themeId, 'theme-id');
  const safeMode = nativePayloadSafeStem(mode, 'mode');
  const fileStem = `${state.kind}-${safeThemeId}-${safeMode}`;
  const htmlFile = `${fileStem}.html`;
  const evidenceFile = `${fileStem}.json`;
  const htmlPath = join(state.directory, htmlFile);
  const evidencePath = join(state.directory, evidenceFile);
  const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  const metadata = {
    articleId: articleThemeId,
    articleThemeId,
    buildId,
    codeId: codeThemeId,
    codeThemeId,
    evidenceFile,
    htmlFile,
    hash: htmlSha256,
    htmlSha256,
    id: themeId,
    mode,
    sourceEvidence: nativeSurfaceFingerprint(sourceEvidence),
    width,
    widths
  };
  await writeFile(htmlPath, html, { encoding: 'utf8', mode: 0o600 });
  await chmod(htmlPath, 0o600);
  await writeFile(evidencePath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(evidencePath, 0o600);
  state.entries.set(key, metadata);
}

export async function finalizeNativePayloadExport(state) {
  if (!state) return;
  const missing = [...state.expected].filter((key) => !state.entries.has(key));
  const unexpected = [...state.entries.keys()].filter((key) => !state.expected.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(`wechat-native-payload-export-manifest-incomplete:${state.kind}`);
  }
  const manifest = {
    entries: [...state.entries.values()],
    kind: state.kind,
    runId: state.runId,
    schemaVersion: 1,
    status: 'passed'
  };
  const manifestPath = join(state.directory, `${state.kind}-manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(manifestPath, 0o600);
}

export function multipartFileBytes(request) {
  const contentType = request.headers()['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/iu);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  const body = request.postDataBuffer();
  if (!boundary || !body) throw new Error('wechat-png-upload-body-unavailable');
  const fileHeader = Buffer.from('Content-Disposition: form-data; name="file";');
  const fileHeaderStart = body.indexOf(fileHeader);
  const fileStartMarker = Buffer.from('\r\n\r\n');
  const fileStart = body.indexOf(fileStartMarker, fileHeaderStart);
  const fileEnd = body.indexOf(
    Buffer.from(`\r\n--${boundary}`),
    fileStart + fileStartMarker.length
  );
  if (fileHeaderStart < 0 || fileStart < 0 || fileEnd < 0) {
    throw new Error('wechat-png-upload-file-part-unavailable');
  }
  return body.subarray(fileStart + fileStartMarker.length, fileEnd);
}
