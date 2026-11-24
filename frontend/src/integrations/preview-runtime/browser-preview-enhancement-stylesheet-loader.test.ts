import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPreviewStylesheetLoader } from './browser-preview-enhancement-stylesheet-loader';

const ROOT_SELECTOR = '#easymde-editor-root';
const LINK_ID = 'easymde-test-css';
const URL_V1 = 'https://example.test/assets/v1.css';
const URL_V2 = 'https://example.test/assets/v2.css';
const URL_V3 = 'https://example.test/assets/v3.css';

const appended: Element[] = [];
const linkSheets = new WeakMap<HTMLLinkElement, CSSStyleSheet | null>();
const originalLinkSheetDescriptor = Object.getOwnPropertyDescriptor(
  HTMLLinkElement.prototype,
  'sheet'
);

function attachStyleSheet(
  link: HTMLLinkElement,
  cssText: string
): CSSStyleSheet {
  const style = document.createElement('style');
  style.textContent = cssText;
  document.head.append(style);
  appended.push(style);
  if (!style.sheet) {
    throw new Error('test-style-sheet-missing');
  }
  linkSheets.set(link, style.sheet);
  return style.sheet;
}

function scopedRuleCount(sheet: CSSStyleSheet): number {
  return Array.from(sheet.cssRules).filter((rule) =>
    rule.cssText.includes(ROOT_SELECTOR)
  ).length;
}

beforeEach(() => {
  Object.defineProperty(HTMLLinkElement.prototype, 'sheet', {
    configurable: true,
    get(this: HTMLLinkElement) {
      if (linkSheets.has(this)) {
        return linkSheets.get(this) ?? null;
      }
      return originalLinkSheetDescriptor?.get?.call(this) ?? null;
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  for (const node of appended.splice(0)) node.remove();
  for (const link of document.querySelectorAll(
    `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
  )) {
    link.remove();
  }
  vi.restoreAllMocks();
  if (originalLinkSheetDescriptor) {
    Object.defineProperty(
      HTMLLinkElement.prototype,
      'sheet',
      originalLinkSheetDescriptor
    );
  } else {
    Reflect.deleteProperty(HTMLLinkElement.prototype, 'sheet');
  }
});

describe('createPreviewStylesheetLoader loadStylesheet rollback and scope preservation', () => {
  it('preserves the active stylesheet scopeLease and styleLoads registration when a replacement fails to load', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(firstLink).not.toBeNull();
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: red; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;

    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Start replacement reload: active v1 scope must stay alive while v2 is pending.
    const secondLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(secondLink).not.toBe(firstLink);
    expect(firstLink.id).toBe(`${LINK_ID}-previous`);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Replacement fails to load.
    secondLink.dispatchEvent(new Event('error'));
    await expect(secondLoad).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );

    expect(secondLink.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // styleLoads must still point to the restored v1 load (no re-append or double scoping).
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    await expect(
      loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal)
    ).resolves.toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Disposing the loader must still dispose v1's restored scopeLease cleanly.
    loader.dispose();
    expect(scopedRuleCount(firstSheet)).toBe(0);
  });

  it('preserves the active stylesheet scopeLease and styleLoads registration when a replacement times out', async () => {
    vi.useFakeTimers();
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: green; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;
    expect(scopedRuleCount(firstSheet)).toBe(1);

    const secondLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const rejection = expect(secondLoad).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;

    expect(secondLink.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(firstSheet)).toBe(0);
  });

  it('preserves the active stylesheet scopeLease and styleLoads registration when replacement CSS scoping fails', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: navy; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;

    const secondLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    // Leave secondLink.sheet as null so scopeEditorStylesheetLink throws.
    linkSheets.set(secondLink, null);
    secondLink.dispatchEvent(new Event('load'));

    await expect(secondLoad).rejects.toThrowError(
      'editor-stylesheet-unavailable'
    );
    expect(secondLink.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Calling loadStylesheet for v1 reuses the restored entry with one lease.
    await expect(
      loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal)
    ).resolves.toBeUndefined();
    expect(scopedRuleCount(firstSheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(firstSheet)).toBe(0);
  });

  it('preserves the active stylesheet scopeLease and styleLoads registration when a reload is cancelled by AbortSignal', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: purple; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;

    const controller = new AbortController();
    const secondLoad = loader.loadStylesheet(LINK_ID, URL_V2, controller.signal);
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(scopedRuleCount(firstSheet)).toBe(1);

    controller.abort();
    await expect(secondLoad).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );

    expect(secondLink.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Late load event on the cancelled candidate must remain inert.
    attachStyleSheet(secondLink, '.v2 { color: orange; }');
    secondLink.dispatchEvent(new Event('load'));
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Restored styleLoads registration is reused without double-scoping.
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    await expect(
      loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal)
    ).resolves.toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(scopedRuleCount(firstSheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(firstSheet)).toBe(0);
  });

  it('preserves the active stylesheet across superseding cancellations and keeps shared pending waiters alive', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: teal; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;

    // Two concurrent waiters on v2: aborting only one keeps v2 pending for the other.
    const waiterA = new AbortController();
    const waiterB = new AbortController();
    const loadA = loader.loadStylesheet(LINK_ID, URL_V2, waiterA.signal);
    const loadB = loader.loadStylesheet(LINK_ID, URL_V2, waiterB.signal);
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    waiterA.abort();
    await expect(loadA).rejects.toThrowError('preview-enhancement-resource-stale');
    expect(secondLink.isConnected).toBe(true);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Supersede pending v2 with v3, then fail v3: v1 must still survive intact.
    const thirdLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal
    );
    await expect(loadB).rejects.toThrowError('preview-enhancement-resource-stale');
    expect(secondLink.isConnected).toBe(false);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    const thirdLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(thirdLink).not.toBe(firstLink);
    thirdLink.dispatchEvent(new Event('error'));
    await expect(thirdLoad).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );

    expect(thirdLink.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // Superseding a pending reload back to v1 reuses v1 without leaking a second scope lease.
    const retryV2 = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    await expect(
      loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal)
    ).resolves.toBeUndefined();
    await expect(retryV2).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );
    expect(document.getElementById(LINK_ID)).toBe(firstLink);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(firstSheet)).toBe(0);
  });

  it('disposes previousLoad scopeLease only on successful commit and cleans up retained leases on dispose()', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: black; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;

    const secondLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const secondSheet = attachStyleSheet(secondLink, '.v2 { color: blue; }');
    expect(scopedRuleCount(firstSheet)).toBe(1);

    secondLink.dispatchEvent(new Event('load'));
    await secondLoad;

    expect(firstLink.isConnected).toBe(false);
    expect(scopedRuleCount(firstSheet)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(secondLink);
    expect(scopedRuleCount(secondSheet)).toBe(1);

    // Start a pending v3 reload and dispose the loader mid-flight: v2's retained lease must be disposed too.
    const thirdLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal
    );
    const thirdLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    loader.dispose();
    await expect(thirdLoad).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );
    expect(thirdLink.isConnected).toBe(false);
    expect(scopedRuleCount(secondSheet)).toBe(0);
  });

  it('cancels a pending loadStylesheet and disposes its previous lease when prepareStylesheet commits on the same id', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Load v1 cleanly so it holds an active scopeLease and canonical id.
    const firstLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const firstLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    const firstSheet = attachStyleSheet(firstLink, '.v1 { color: crimson; }');
    firstLink.dispatchEvent(new Event('load'));
    await firstLoad;
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // 2. Start pending loadStylesheet(v2), renaming v1 to `${LINK_ID}-previous`.
    const secondController = new AbortController();
    const secondLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      secondController.signal
    );
    const secondLink = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(secondLink).not.toBe(firstLink);
    expect(firstLink.id).toBe(`${LINK_ID}-previous`);
    expect(scopedRuleCount(firstSheet)).toBe(1);

    // 3. While v2 is still in flight, prepare and commit v3 on the same id.
    const prepared = loader.prepareStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal,
      'activation'
    );
    const ownerLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    );
    const thirdLink = ownerLinks.find(
      (candidate) => candidate !== firstLink && candidate !== secondLink
    );
    if (!thirdLink) throw new Error('prepared link missing');
    const thirdSheet = attachStyleSheet(thirdLink, '.v3 { color: indigo; }');
    thirdLink.dispatchEvent(new Event('load'));
    const readyPrepared = await prepared.promise;

    readyPrepared.commit();

    // Pending v2 must be cancelled; v1's lease and link must be cleaned up with exactly one canonical link.
    await expect(secondLoad).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );
    expect(scopedRuleCount(firstSheet)).toBe(0);
    expect(firstLink.isConnected).toBe(false);
    expect(secondLink.isConnected).toBe(false);
    expect(scopedRuleCount(thirdSheet)).toBe(1);

    const canonicalLinks = document.querySelectorAll(`link[id="${LINK_ID}"]`);
    expect(canonicalLinks).toHaveLength(1);
    expect(canonicalLinks[0]).toBe(thirdLink);
    expect(
      document.querySelectorAll(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).toHaveLength(1);

    // Late error/load/abort signals on the superseded v2 load must remain inert and never restore v1.
    secondLink.dispatchEvent(new Event('error'));
    attachStyleSheet(secondLink, '.v2 { color: gold; }');
    secondLink.dispatchEvent(new Event('load'));
    secondController.abort();

    expect(firstLink.isConnected).toBe(false);
    expect(secondLink.isConnected).toBe(false);
    expect(document.querySelectorAll(`link[id="${LINK_ID}"]`)).toHaveLength(1);
    expect(document.getElementById(LINK_ID)).toBe(thirdLink);
    expect(scopedRuleCount(firstSheet)).toBe(0);
    expect(scopedRuleCount(thirdSheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(thirdSheet)).toBe(0);
  });
});
