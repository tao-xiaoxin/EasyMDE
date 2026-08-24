import { createElement, createRoot } from '@wordpress/element';

import { SettingsCenterRoot } from '../app/settings/SettingsCenterRoot';
import { parseSettingsCenterBootstrap } from '../contracts/bootstrap/settings-center-bootstrap';

type SettingsCenterBrowserRuntime = Readonly<{
  document: Document;
  window: Window;
}>;

export function showSettingsCenterStartupFailure(
  root: HTMLElement | null,
  message: string,
  code: string
): void {
  if (root) {
    root.replaceChildren();
    const notice = root.ownerDocument.createElement('div');
    notice.className =
      'notice notice-error easymde-settings-center-startup-error';
    notice.setAttribute('role', 'alert');
    const paragraph = root.ownerDocument.createElement('p');
    paragraph.textContent =
      message.trim() ||
      'EasyMDE Settings Center could not start. WordPress settings remain available.';
    notice.append(paragraph);
    root.append(notice);
  }
  console.error(`[EasyMDE] ${code}`);
}

function assertSameOriginUrl(value: string, windowRef: Window): void {
  const url = new URL(value, windowRef.location.href);
  if (url.origin !== windowRef.location.origin || url.username || url.password) {
    throw new Error('settings-center-url-origin-invalid');
  }
}

function assertServerStartupSurface(container: HTMLElement): void {
  if (!container.childNodes.length) return;

  const startupSurface = container.querySelector<HTMLElement>(
    ':scope > [data-settings-center-startup]'
  );
  const hasOnlyExpectedNodes = Array.from(container.childNodes).every(
    (node) =>
      node === startupSurface ||
      (node.nodeType === 3 && (node.textContent ?? '').trim() === '')
  );
  if (
    !startupSurface ||
    container.children.length !== 1 ||
    container.firstElementChild !== startupSurface ||
    !hasOnlyExpectedNodes
  ) {
    throw new Error('settings-center-root-not-empty');
  }
}

export function mountSettingsCenter(
  rawBootstrap: unknown,
  runtime: SettingsCenterBrowserRuntime
): () => void {
  const container = runtime.document.querySelector<HTMLElement>(
    '#easymde-settings-center-root'
  );
  if (!container) throw new Error('settings-center-root-unavailable');

  const bootstrap = parseSettingsCenterBootstrap(rawBootstrap);
  assertSameOriginUrl(bootstrap.closeUrl, runtime.window);
  assertServerStartupSurface(container);

  const root = createRoot(container);
  let active = true;
  root.render(<SettingsCenterRoot bootstrap={bootstrap} />);

  return () => {
    if (!active) return;
    active = false;
    root.unmount();
  };
}

declare global {
  interface Window {
    EasyMDESettingsCenterBootstrap?: unknown;
    EasyMDESettingsCenterStarted?: boolean;
  }
}

function start(): void {
  window.EasyMDESettingsCenterStarted = true;
  const root = document.querySelector<HTMLElement>(
    '#easymde-settings-center-root'
  );
  try {
    const unmount = mountSettingsCenter(window.EasyMDESettingsCenterBootstrap, {
      document,
      window
    });
    window.addEventListener('pagehide', unmount, { once: true });
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
      ? error.message
      : 'settings-center-startup-failed';
    showSettingsCenterStartupFailure(
      root,
      root?.dataset.failureMessage ?? '',
      code
    );
  }
}

start();
