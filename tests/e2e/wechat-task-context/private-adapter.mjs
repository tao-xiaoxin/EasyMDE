import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import { adapterSource } from "./environment.mjs";
import { previewSelector } from "./environment.mjs";

export async function buildPrivateAdapter(tempRoot) {
  const entryPath = join(tempRoot, 'entry.ts');
  const outDir = join(tempRoot, 'dist');
  const entry = `
import { createBrowserWechatClipboard } from ${JSON.stringify(adapterSource)};

class ClipboardItemStub {
  constructor(payload) { this.payload = payload; }
}

const state = {
  copyResult: null,
  htmlConsumed: false,
  writeHTMLSummary: null,
  prepareController: null,
  prepareSettled: true,
  writeCount: 0,
  writeError: null,
  writeStarted: false,
  writeGateRelease: null
};
const stableErrorCode = (error) => {
  const message = error instanceof Error ? error.message : '';
  return /^wechat-[a-z0-9-]+$/u.test(message) ? message : 'unknown';
};
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
const clipboard = createBrowserWechatClipboard({
  blob: Blob,
  clipboardItem: ClipboardItemStub,
  document,
  fetch: window.fetch.bind(window),
  getComputedStyle: (element, pseudo) => {
    const computed = nativeGetComputedStyle(element, pseudo);
    const evidence = globalThis.__wechatTaskContextHiddenEvidence
      ?? globalThis.__wechatTaskContextEvidence;
    evidence?.recordStyleRead(
      element,
      pseudo ?? null,
      computed,
      nativeGetComputedStyle
    );
    return computed;
  },
  getSelection: window.getSelection.bind(window),
  pageOffset: () => ({ x: window.scrollX, y: window.scrollY }),
  scrollTo: (x, y) => window.scrollTo(x, y),
  write: async (items) => {
    state.writeCount += 1;
    state.writeStarted = true;
    const htmlValue = items[0]?.payload?.['text/html'];
    if (!htmlValue || typeof htmlValue.then !== 'function') {
      state.writeError = 'wechat-task-context-html-payload-missing';
      throw new Error(state.writeError);
    }
    await new Promise((resolve) => { state.writeGateRelease = resolve; });
    try {
      const htmlBlob = await htmlValue;
      if (!(htmlBlob instanceof Blob) || typeof htmlBlob.text !== 'function') {
        state.writeError = 'wechat-task-context-html-payload-invalid';
        throw new Error(state.writeError);
      }
      const htmlDocument = new DOMParser().parseFromString(await htmlBlob.text(), 'text/html');
      const owners = [...htmlDocument.querySelectorAll('[role="checkbox"][aria-disabled="true"]')];
      state.writeHTMLSummary = {
        inputCount: htmlDocument.querySelectorAll('input').length,
        ownerCheckedCount: owners.filter((owner) => owner.getAttribute('aria-checked') === 'true').length,
        ownerCheckedVector: owners.map((owner) => owner.getAttribute('aria-checked') === 'true'),
        ownerCount: owners.length,
        ownerInputDescendantCount: owners.filter((owner) => owner.querySelector('input')).length,
        ownerPaintCount: owners.filter((owner) => (
          Boolean(owner.getAttribute('style')?.trim())
          && Boolean(owner.querySelector('[aria-hidden="true"], svg'))
        )).length,
        ownerStyleCount: owners.filter((owner) => Boolean(owner.getAttribute('style')?.trim())).length,
        ownerTagSpanCount: owners.filter((owner) => owner.tagName === 'SPAN').length,
        ownerUncheckedCount: owners.filter((owner) => owner.getAttribute('aria-checked') === 'false').length
      };
      state.htmlConsumed = true;
    } catch (error) {
      state.writeError = stableErrorCode(error);
      throw error;
    }
  }
});

globalThis.__wechatTaskContext = {
  copy: async (selector = ${JSON.stringify(previewSelector)}) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) throw new Error('wechat-task-context-preview-missing');
    state.copyResult = await clipboard.copy(preview, { pngConversionEnabled: false });
    return state.copyResult;
  },
  prepare: async (selector = ${JSON.stringify(previewSelector)}) => {
    const controller = new AbortController();
    state.prepareController = controller;
    state.prepareSettled = false;
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      state.prepareSettled = true;
      state.prepareController = null;
      return { code: 'wechat-task-context-stage-b-preview-missing', status: 'failed' };
    }
    if (typeof clipboard.prepare !== 'function') {
      state.prepareSettled = true;
      state.prepareController = null;
      return { code: 'wechat-task-context-stage-b-prepare-unavailable', status: 'failed' };
    }
    try {
      await clipboard.prepare(preview, { background: true, signal: controller.signal });
      return { code: null, status: 'ready' };
    } catch (error) {
      return {
        code: controller.signal.aborted
          ? 'wechat-task-context-stage-b-prepare-cancelled'
          : error instanceof Error && error.message === 'wechat-task-checkbox-bad-projection'
          ? 'wechat-task-checkbox-bad-projection'
          : 'wechat-task-context-stage-b-prepare-failed',
        status: 'failed'
      };
    } finally {
      state.prepareSettled = true;
      state.prepareController = null;
    }
  },
  cancelPrepare: () => {
    const controller = state.prepareController;
    if (!controller) return state.prepareSettled === true;
    controller.abort();
    return controller.signal.aborted === true;
  },
  getState: () => ({
    copyResult: state.copyResult,
    htmlConsumed: state.htmlConsumed,
    writeHTMLSummary: state.writeHTMLSummary,
    writeCount: state.writeCount,
    writeError: state.writeError,
    writeStarted: state.writeStarted
  }),
  ready: true,
  rememberPreviewWidth: (selector = ${JSON.stringify(previewSelector)}) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) throw new Error('wechat-task-context-preview-missing');
    clipboard.rememberPreviewWidth?.(preview);
  },
  releaseWrite: () => {
    const release = state.writeGateRelease;
    state.writeGateRelease = null;
    release?.();
  }
};
`;
  await writeFile(entryPath, entry, 'utf8');
  try {
    await viteBuild({
      configFile: false,
      logLevel: 'silent',
      root: tempRoot,
      cacheDir: join(tempRoot, 'cache'),
      build: {
        outDir,
        emptyOutDir: true,
        manifest: false,
        minify: false,
        sourcemap: false,
        rollupOptions: {
          input: entryPath,
          output: {
            format: 'es',
            entryFileNames: 'wechat-task-context-adapter.js',
            inlineDynamicImports: true
          }
        }
      }
    });
    return await readFile(join(outDir, 'wechat-task-context-adapter.js'), 'utf8');
  } catch {
    throw new Error('wechat-task-context-private-build-failed');
  }
}
