import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ownerMocks = vi.hoisted(() => ({
  cleanup: vi.fn<() => void>(),
  enhance: vi.fn<() => () => void>()
}));

vi.mock('../integrations/browser/code-copy/create-browser-code-copy-owner', () => ({
  createBrowserCodeCopyOwner: () => ({ enhance: ownerMocks.enhance })
}));

async function loadEntrypoint(): Promise<void> {
  await import('./frontend-code-copy');
  if (0 === ownerMocks.enhance.mock.calls.length) {
    document.dispatchEvent(new Event('DOMContentLoaded'));
  }
}

beforeEach(() => {
  vi.resetModules();
  ownerMocks.cleanup.mockReset();
  ownerMocks.enhance.mockReset();
  ownerMocks.enhance.mockReturnValue(ownerMocks.cleanup);
  window.EasyMDEFrontendConfig = { features: { codeCopy: true } };
});

afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  delete window.EasyMDEFrontendConfig;
});

describe('frontend code-copy entrypoint', () => {
  it('restores one active owner after a bfcache page lifecycle', async () => {
    await loadEntrypoint();

    expect(ownerMocks.enhance).toHaveBeenCalledOnce();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(ownerMocks.enhance).toHaveBeenCalledOnce();

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(ownerMocks.cleanup).toHaveBeenCalledOnce();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(ownerMocks.enhance).toHaveBeenCalledTimes(2);
  });
});
