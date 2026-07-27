import { createBrowserCodeCopyOwner } from '../integrations/browser/code-copy/create-browser-code-copy-owner';

declare global {
  interface Window {
    EasyMDEFrontendConfig?: unknown;
  }
}

const owner = createBrowserCodeCopyOwner({
  clearTimeout: (timerId) => {
    window.clearTimeout(timerId);
  },
  document,
  executeCopy: () =>
    'function' === typeof document.execCommand && true === document.execCommand('copy'),
  getScrollPosition: () => ({ x: window.scrollX, y: window.scrollY }),
  getSelection: () => window.getSelection(),
  reportFailure: (code) => {
    window.console.error(`[EasyMDE code copy] ${code}`);
  },
  scrollTo: (x, y) => {
    window.scrollTo(x, y);
  },
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  writeClipboardText: window.navigator.clipboard?.writeText
    ? (text) => window.navigator.clipboard.writeText(text)
    : null
});

let cleanup = (): void => {};
let active = false;

function start(): void {
  if (active) {
    return;
  }

  cleanup = owner.enhance(document, window.EasyMDEFrontendConfig);
  active = true;
}

function stop(): void {
  if (!active) {
    return;
  }

  cleanup();
  cleanup = (): void => {};
  active = false;
}

if ('loading' === document.readyState) {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', start);
