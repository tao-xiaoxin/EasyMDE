import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPreviewStylesheetLoader } from './browser-preview-enhancement-stylesheet-loader';

const ROOT_SELECTOR = '#easymde-editor-root';
const LINK_ID = 'easymde-test-css';
const URL_V1 = 'https://example.test/assets/v1.css';
const URL_V2 = 'https://example.test/assets/v2.css';
const URL_V3 = 'https://example.test/assets/v3.css';
const URL_V4 = 'https://example.test/assets/v4.css';

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

  it('clears authoritativeActivationUrl when loadStylesheet commits so subsequent enhancement prepares commit cleanly', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Activation commits URL_V1, setting authoritativeActivationUrl = URL_V1.
    const activation = loader.prepareStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal,
      'activation'
    );
    const v1Link = document.querySelector<HTMLLinkElement>(
      `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
    );
    if (!v1Link) throw new Error('activation link missing');
    const v1Sheet = attachStyleSheet(v1Link, '.v1 { color: red; }');
    v1Link.dispatchEvent(new Event('load'));
    const readyActivation = await activation.promise;
    readyActivation.commit();

    expect(document.getElementById(LINK_ID)).toBe(v1Link);
    expect(scopedRuleCount(v1Sheet)).toBe(1);

    // 2. loadStylesheet commits URL_V2 via handleLoad, clearing authoritativeActivationUrl.
    const loadV2 = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    const v2Link = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(v2Link).not.toBe(v1Link);
    const v2Sheet = attachStyleSheet(v2Link, '.v2 { color: blue; }');
    v2Link.dispatchEvent(new Event('load'));
    await loadV2;

    expect(v1Link.isConnected).toBe(false);
    expect(scopedRuleCount(v1Sheet)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(v2Link);
    expect(scopedRuleCount(v2Sheet)).toBe(1);

    // 3. Start an earlier pending enhancement for URL_V1, then commit a newer enhancement
    // for URL_V2. If URL_V2 genuinely commits (advancing committedEnhancementSequence),
    // the older URL_V1 enhancement must later be rejected as stale instead of winning via
    // a stale authoritativeActivationUrl === URL_V1.
    const staleEnhancementV1 = loader.prepareStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal,
      'enhancement'
    );
    const staleV1Link = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== v2Link);
    if (!staleV1Link) throw new Error('stale enhancement v1 link missing');
    const staleV1Sheet = attachStyleSheet(staleV1Link, '.v1-stale { color: gray; }');

    const enhancementV2 = loader.prepareStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal,
      'enhancement'
    );
    const readyEnhancementV2 = await enhancementV2.promise;
    readyEnhancementV2.commit();

    staleV1Link.dispatchEvent(new Event('load'));
    const readyStaleV1 = await staleEnhancementV1.promise;
    readyStaleV1.commit();

    expect(staleV1Link.isConnected).toBe(false);
    expect(scopedRuleCount(staleV1Sheet)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(v2Link);
    expect(v2Link.getAttribute('href')).toBe(URL_V2);
    expect(scopedRuleCount(v2Sheet)).toBe(1);

    // 4. A fresh enhancement for URL_V3 also commits cleanly without being discarded.
    const enhancementV3 = loader.prepareStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal,
      'enhancement'
    );
    const v3Link = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== v2Link);
    if (!v3Link) throw new Error('enhancement v3 link missing');
    const v3Sheet = attachStyleSheet(v3Link, '.v3 { color: green; }');
    v3Link.dispatchEvent(new Event('load'));
    const readyEnhancementV3 = await enhancementV3.promise;
    readyEnhancementV3.commit();

    expect(v2Link.isConnected).toBe(false);
    expect(scopedRuleCount(v2Sheet)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(v3Link);
    expect(v3Link.getAttribute('href')).toBe(URL_V3);
    expect(scopedRuleCount(v3Sheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(v3Sheet)).toBe(0);
  });

  it('clears authoritativeActivationUrl in the loadStylesheet reuse branch while preserving it on failed rollback', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Activation commits URL_V1.
    const activation = loader.prepareStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal,
      'activation'
    );
    const v1Link = document.querySelector<HTMLLinkElement>(
      `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
    );
    if (!v1Link) throw new Error('activation link missing');
    const v1Sheet = attachStyleSheet(v1Link, '.v1 { color: red; }');
    v1Link.dispatchEvent(new Event('load'));
    const readyActivation = await activation.promise;
    readyActivation.commit();

    // 2. A failed loadStylesheet(URL_V2) rolls back to URL_V1 and must NOT clear
    // authoritativeActivationUrl, so a non-matching enhancement for URL_V3 is discarded.
    const failedLoad = loader.loadStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal
    );
    const failedV2Link = document.getElementById(LINK_ID) as HTMLLinkElement;
    failedV2Link.dispatchEvent(new Event('error'));
    await expect(failedLoad).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );

    const blockedEnhancement = loader.prepareStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal,
      'enhancement'
    );
    const blockedV3Link = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== v1Link);
    if (!blockedV3Link) throw new Error('blocked enhancement link missing');
    const blockedV3Sheet = attachStyleSheet(blockedV3Link, '.v3 { color: purple; }');
    blockedV3Link.dispatchEvent(new Event('load'));
    const readyBlocked = await blockedEnhancement.promise;
    readyBlocked.commit();

    expect(blockedV3Link.isConnected).toBe(false);
    expect(scopedRuleCount(blockedV3Sheet)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(v1Link);
    expect(scopedRuleCount(v1Sheet)).toBe(1);

    // 3. Reusing an already-loaded DOM link for URL_V2 in loadStylesheet commits URL_V2
    // via the reuse branch and clears authoritativeActivationUrl.
    v1Link.remove();
    const reusedV2Link = document.createElement('link');
    reusedV2Link.id = LINK_ID;
    reusedV2Link.rel = 'stylesheet';
    reusedV2Link.href = URL_V2;
    reusedV2Link.dataset.easymdeStylesheetOwner = LINK_ID;
    reusedV2Link.dataset.easymdeLoadedHref = URL_V2;
    document.head.append(reusedV2Link);
    const reusedV2Sheet = attachStyleSheet(reusedV2Link, '.v2-reused { color: teal; }');

    await loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal);
    expect(scopedRuleCount(reusedV2Sheet)).toBe(1);

    // 4. Subsequent enhancement for URL_V3 now commits cleanly.
    const allowedEnhancement = loader.prepareStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal,
      'enhancement'
    );
    const allowedV3Link = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== reusedV2Link);
    if (!allowedV3Link) throw new Error('allowed enhancement link missing');
    const allowedV3Sheet = attachStyleSheet(allowedV3Link, '.v3-allowed { color: olive; }');
    allowedV3Link.dispatchEvent(new Event('load'));
    const readyAllowed = await allowedEnhancement.promise;
    readyAllowed.commit();

    expect(reusedV2Link.isConnected).toBe(false);
    expect(scopedRuleCount(reusedV2Sheet)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(allowedV3Link);
    expect(scopedRuleCount(allowedV3Sheet)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(allowedV3Sheet)).toBe(0);
  });

  it('suppresses prepared-slot reconciliation during loadStylesheet cancellation sweep so failed direct load rolls back to active stylesheet A, not blocked enhancement B', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Load active stylesheet A (URL_V1) on LINK_ID.
    const loadA = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const linkA = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(linkA).not.toBeNull();
    const sheetA = attachStyleSheet(linkA, '.v1 { color: red; }');
    linkA.dispatchEvent(new Event('load'));
    await loadA;
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkA.getAttribute('href')).toBe(URL_V1);
    expect(scopedRuleCount(sheetA)).toBe(1);

    // 2. Start a pending activation (URL_V4) that stays in-flight and blocks enhancements.
    const pendingActivation = loader.prepareStylesheet(
      LINK_ID,
      URL_V4,
      new AbortController().signal,
      'activation'
    );
    const activationLink = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA);
    if (!activationLink) throw new Error('pending activation link missing');

    // 3. Start enhancement B (URL_V2), complete its load, and request commit while still blocked.
    const preparedB = loader.prepareStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal,
      'enhancement'
    );
    const linkB = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA && candidate !== activationLink);
    if (!linkB) throw new Error('enhancement B link missing');
    const sheetB = attachStyleSheet(linkB, '.v2 { color: blue; }');
    linkB.dispatchEvent(new Event('load'));
    const readyB = await preparedB.promise;
    readyB.commit();

    // B must remain queued/uncommitted behind the pending activation; A remains active.
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkB.isConnected).toBe(true);
    expect(linkB.id).toBe('');
    expect(linkB.media).toBe('not all');
    expect(scopedRuleCount(sheetA)).toBe(1);
    expect(scopedRuleCount(sheetB)).toBe(1);

    // 4. Start a direct loadStylesheet for C (URL_V3). Its cancellation sweep must NOT
    // reconcile/commit B when cancelling the pending activation first.
    const loadC = loader.loadStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal
    );
    await expect(pendingActivation.promise).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );

    expect(activationLink.isConnected).toBe(false);
    expect(linkB.isConnected).toBe(false);
    expect(linkB.id).toBe('');
    expect(linkB.media).toBe('not all');
    expect(scopedRuleCount(sheetB)).toBe(0);

    // A must remain preserved as the rollback target with its scopeLease still active.
    expect(linkA.isConnected).toBe(true);
    expect(linkA.id).toBe(`${LINK_ID}-previous`);
    expect(linkA.getAttribute('href')).toBe(URL_V1);
    expect(scopedRuleCount(sheetA)).toBe(1);

    const linkC = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(linkC).not.toBeNull();
    expect(linkC).not.toBe(linkA);
    expect(linkC).not.toBe(linkB);
    expect(linkC).not.toBe(activationLink);
    expect(linkC.getAttribute('href')).toBe(URL_V3);

    // 5. Fail direct load C: rollback must restore A (NOT B) with id, href, and scopeLease intact.
    linkC.dispatchEvent(new Event('error'));
    await expect(loadC).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );

    expect(linkC.isConnected).toBe(false);
    expect(linkB.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkA.id).toBe(LINK_ID);
    expect(linkA.getAttribute('href')).toBe(URL_V1);
    expect(scopedRuleCount(sheetA)).toBe(1);
    expect(scopedRuleCount(sheetB)).toBe(0);
    expect(
      document.querySelectorAll(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).toHaveLength(1);

    // Late commit call on cancelled B must remain inert.
    readyB.commit();
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkB.isConnected).toBe(false);
    expect(scopedRuleCount(sheetA)).toBe(1);

    // styleLoads must still point to restored A (reused without re-append or double scoping).
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    await expect(
      loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal)
    ).resolves.toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(scopedRuleCount(sheetA)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(sheetA)).toBe(0);
  });

  it('suppresses prepared-slot reconciliation during dispose() so blocked enhancement B is not committed during teardown', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    const loadA = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const linkA = document.getElementById(LINK_ID) as HTMLLinkElement;
    const sheetA = attachStyleSheet(linkA, '.v1 { color: red; }');
    linkA.dispatchEvent(new Event('load'));
    await loadA;

    const pendingActivation = loader.prepareStylesheet(
      LINK_ID,
      URL_V4,
      new AbortController().signal,
      'activation'
    );
    const activationLink = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA);
    if (!activationLink) throw new Error('pending activation link missing');

    const preparedB = loader.prepareStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal,
      'enhancement'
    );
    const linkB = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA && candidate !== activationLink);
    if (!linkB) throw new Error('enhancement B link missing');
    const sheetB = attachStyleSheet(linkB, '.v2 { color: blue; }');
    linkB.dispatchEvent(new Event('load'));
    const readyB = await preparedB.promise;
    readyB.commit();

    loader.dispose();
    await expect(pendingActivation.promise).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );

    expect(activationLink.isConnected).toBe(false);
    expect(linkB.isConnected).toBe(false);
    expect(linkB.id).toBe('');
    expect(linkB.media).toBe('not all');
    expect(scopedRuleCount(sheetA)).toBe(0);
    expect(scopedRuleCount(sheetB)).toBe(0);
  });
});
