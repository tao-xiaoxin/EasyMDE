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

async function expectPromiseRejectsPromptly(
  promise: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const })
    ),
    new Promise<{ status: 'pending' }>((resolve) => {
      setTimeout(() => resolve({ status: 'pending' }), 50);
    })
  ]);
  expect(outcome.status).toBe('rejected');
  if ('rejected' === outcome.status) {
    expect(outcome.error).toBeInstanceOf(Error);
    expect((outcome.error as Error).message).toBe(expectedMessage);
  }
}

function interceptSheetOnce(
  link: HTMLLinkElement,
  onRead: () => CSSStyleSheet | null
): void {
  let intercepted = false;
  Object.defineProperty(link, 'sheet', {
    configurable: true,
    get() {
      if (!intercepted) {
        intercepted = true;
        Reflect.deleteProperty(link, 'sheet');
        return onRead();
      }
      return linkSheets.get(link) ?? null;
    }
  });
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

  it('rejects a reused prepareStylesheet promise when CSSOM scoping fails (sheet === null) and preserves the active stylesheet without blocking later enhancements', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Load active stylesheet A (URL_V1) cleanly with loaded-href marker and active scopeLease.
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
    expect(linkA.dataset.easymdeLoadedHref).toBe(URL_V1);
    expect(scopedRuleCount(sheetA)).toBe(1);

    // 2. Make linkA's CSSOM unavailable (sheet === null) and reuse it via prepareStylesheet.
    linkSheets.set(linkA, null);
    const reusedActivation = loader.prepareStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal,
      'activation'
    );
    await expectPromiseRejectsPromptly(
      reusedActivation.promise,
      'editor-stylesheet-unavailable'
    );

    const reusedEnhancement = loader.prepareStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal,
      'enhancement'
    );
    await expectPromiseRejectsPromptly(
      reusedEnhancement.promise,
      'editor-stylesheet-unavailable'
    );

    // A throwing CSSOM sheet getter on the reused link must also reject promptly.
    interceptSheetOnce(linkA, () => {
      throw new Error('cross-origin-sheet-denied');
    });
    const reusedReadError = loader.prepareStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal,
      'activation'
    );
    await expectPromiseRejectsPromptly(
      reusedReadError.promise,
      'editor-stylesheet-read-failed'
    );

    // Reused scoping failure must preserve the existing active DOM link and its existing scope.
    expect(linkA.isConnected).toBe(true);
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkA.getAttribute('href')).toBe(URL_V1);
    expect(scopedRuleCount(sheetA)).toBe(1);

    // 3. Failed reused activation must not leave a stuck activation barrier blocking later enhancements.
    linkSheets.set(linkA, sheetA);
    const nextEnhancement = loader.prepareStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal,
      'enhancement'
    );
    const linkB = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA);
    if (!linkB) throw new Error('enhancement link missing');
    const sheetB = attachStyleSheet(linkB, '.v2 { color: blue; }');
    linkB.dispatchEvent(new Event('load'));
    const readyB = await nextEnhancement.promise;
    readyB.commit();

    expect(linkA.isConnected).toBe(false);
    expect(scopedRuleCount(sheetA)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(linkB);
    expect(scopedRuleCount(sheetB)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(sheetB)).toBe(0);
  });

  it('rejects a freshly loaded prepareStylesheet promise when CSSOM scoping fails while blocked behind an activation, and unblocks queued enhancements when the activation fails scoping', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Active stylesheet A (URL_V1) is loaded and scoped.
    const loadA = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const linkA = document.getElementById(LINK_ID) as HTMLLinkElement;
    const sheetA = attachStyleSheet(linkA, '.v1 { color: red; }');
    linkA.dispatchEvent(new Event('load'));
    await loadA;
    expect(scopedRuleCount(sheetA)).toBe(1);

    // 2. Pending activation (URL_V4) stays in flight, blocking enhancements.
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

    // 3. Fresh enhancement B (URL_V2) finishes loading while blocked, but its CSSOM is unavailable.
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
    linkSheets.set(linkB, null);
    linkB.dispatchEvent(new Event('load'));

    await expectPromiseRejectsPromptly(
      preparedB.promise,
      'editor-stylesheet-unavailable'
    );
    expect(linkB.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(scopedRuleCount(sheetA)).toBe(1);

    // 4. Fresh enhancement C (URL_V3) reaches ready and requests commit while still blocked.
    const preparedC = loader.prepareStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal,
      'enhancement'
    );
    const linkC = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA && candidate !== activationLink);
    if (!linkC) throw new Error('enhancement C link missing');
    const sheetC = attachStyleSheet(linkC, '.v3 { color: green; }');
    linkC.dispatchEvent(new Event('load'));
    const readyC = await preparedC.promise;
    readyC.commit();
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkC.media).toBe('not all');

    // 5. Pending activation fails during CSSOM scoping (sheet === null): it rejects cleanly,
    // removes its candidate link, and reconciles so queued enhancement C commits cleanly.
    linkSheets.set(activationLink, null);
    activationLink.dispatchEvent(new Event('load'));
    await expectPromiseRejectsPromptly(
      pendingActivation.promise,
      'editor-stylesheet-unavailable'
    );

    expect(activationLink.isConnected).toBe(false);
    expect(linkA.isConnected).toBe(false);
    expect(scopedRuleCount(sheetA)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(linkC);
    expect(linkC.media).toBe('all');
    expect(scopedRuleCount(sheetC)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(sheetC)).toBe(0);
  });

  it('rejects and releases temporary scope leases when an unsettled reused prepareStylesheet load is cancelled by abort, loadStylesheet, or dispose', async () => {
    // Scenario 1: cancelled via AbortSignal while unsettled during CSSOM scoping.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-abort { color: red; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const controller = new AbortController();
      interceptSheetOnce(linkA, () => {
        controller.abort();
        return sheetA;
      });
      const reusedPrep = loader.prepareStylesheet(
        LINK_ID,
        URL_V1,
        controller.signal,
        'activation'
      );
      await expectPromiseRejectsPromptly(
        reusedPrep.promise,
        'preview-enhancement-resource-stale'
      );

      expect(linkA.isConnected).toBe(true);
      expect(document.getElementById(LINK_ID)).toBe(linkA);
      expect(scopedRuleCount(sheetA)).toBe(1);

      // Disposing must drop the active lease back to 0 (no leaked lease from the cancelled reuse).
      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }

    // Scenario 2: cancelled via loadStylesheet() while unsettled during CSSOM scoping.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-direct { color: blue; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const directLoads: Promise<void>[] = [];
      interceptSheetOnce(linkA, () => {
        directLoads.push(
          loader.loadStylesheet(
            LINK_ID,
            URL_V2,
            new AbortController().signal
          )
        );
        return sheetA;
      });
      const reusedPrep = loader.prepareStylesheet(
        LINK_ID,
        URL_V1,
        new AbortController().signal,
        'activation'
      );
      await expectPromiseRejectsPromptly(
        reusedPrep.promise,
        'preview-enhancement-resource-stale'
      );
      const directLoad = directLoads[0];
      if (!directLoad) throw new Error('direct load missing');

      // Failing the superseding direct load rolls back cleanly to linkA with one intact lease.
      const linkV2 = document.getElementById(LINK_ID) as HTMLLinkElement;
      expect(linkV2).not.toBe(linkA);
      linkV2.dispatchEvent(new Event('error'));
      await expect(directLoad).rejects.toThrowError(
        'preview-enhancement-resource-load-failed'
      );
      expect(document.getElementById(LINK_ID)).toBe(linkA);
      expect(scopedRuleCount(sheetA)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }

    // Scenario 3: cancelled via dispose() while unsettled during CSSOM scoping.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-dispose { color: green; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      interceptSheetOnce(linkA, () => {
        loader.dispose();
        return sheetA;
      });
      const reusedPrep = loader.prepareStylesheet(
        LINK_ID,
        URL_V1,
        new AbortController().signal,
        'activation'
      );
      await expectPromiseRejectsPromptly(
        reusedPrep.promise,
        'preview-enhancement-resource-stale'
      );

      // Temporary lease returned after dispose() must be disposed immediately (0 scoped rules).
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }

    // Scenario 4: cancelling a settled reused load via cancel() before commit releases its extra lease cleanly.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-cancel { color: purple; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const reusedPrep = loader.prepareStylesheet(
        LINK_ID,
        URL_V1,
        new AbortController().signal,
        'activation'
      );
      const readyReused = await reusedPrep.promise;
      reusedPrep.cancel();
      readyReused.commit();

      expect(linkA.isConnected).toBe(true);
      expect(document.getElementById(LINK_ID)).toBe(linkA);
      expect(scopedRuleCount(sheetA)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }
  });

  it('guards loadStylesheet handleLoad against re-entrant dispose, superseding loadStylesheet, waiter abort, and previousLoad rollback throws', async () => {
    // Scenario 1: re-entrant loader.dispose() inside scopeEditorStylesheetLink during handleLoad.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-hl-dispose { color: red; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const loadB = loader.loadStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal
      );
      const linkB = document.getElementById(LINK_ID) as HTMLLinkElement;
      const sheetB = attachStyleSheet(linkB, '.v2-hl-dispose { color: blue; }');
      interceptSheetOnce(linkB, () => {
        loader.dispose();
        return sheetB;
      });
      linkB.dispatchEvent(new Event('load'));

      await expectPromiseRejectsPromptly(
        loadB,
        'preview-enhancement-resource-stale'
      );
      expect(linkB.isConnected).toBe(false);
      expect(scopedRuleCount(sheetB)).toBe(0);
      expect(scopedRuleCount(sheetA)).toBe(0);

      // styleLoads stays clean and disposed loader rejects new loads.
      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal),
        'preview-enhancement-runtime-unavailable'
      );
      expect(scopedRuleCount(sheetB)).toBe(0);
      linkA.remove();
    }

    // Scenario 2: re-entrant superseding loadStylesheet() inside scopeEditorStylesheetLink during handleLoad.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-hl-supersede { color: green; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const loadB = loader.loadStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal
      );
      const linkB = document.getElementById(LINK_ID) as HTMLLinkElement;
      const sheetB = attachStyleSheet(linkB, '.v2-hl-supersede { color: orange; }');
      const supersedingLoads: Promise<void>[] = [];
      interceptSheetOnce(linkB, () => {
        supersedingLoads.push(
          loader.loadStylesheet(LINK_ID, URL_V3, new AbortController().signal)
        );
        return sheetB;
      });
      linkB.dispatchEvent(new Event('load'));

      await expectPromiseRejectsPromptly(
        loadB,
        'preview-enhancement-resource-stale'
      );
      expect(linkB.isConnected).toBe(false);
      expect(scopedRuleCount(sheetB)).toBe(0);

      const loadC = supersedingLoads[0];
      if (!loadC) throw new Error('superseding load missing');
      const linkC = document.getElementById(LINK_ID) as HTMLLinkElement;
      expect(linkC).not.toBeNull();
      expect(linkC).not.toBe(linkA);
      expect(linkC).not.toBe(linkB);
      expect(linkC.getAttribute('href')).toBe(URL_V3);
      expect(linkA.id).toBe(`${LINK_ID}-previous`);
      expect(scopedRuleCount(sheetA)).toBe(1);

      const sheetC = attachStyleSheet(linkC, '.v3-hl-supersede { color: purple; }');
      linkC.dispatchEvent(new Event('load'));
      await loadC;

      expect(linkA.isConnected).toBe(false);
      expect(scopedRuleCount(sheetA)).toBe(0);
      expect(document.getElementById(LINK_ID)).toBe(linkC);
      expect(scopedRuleCount(sheetC)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetC)).toBe(0);
      linkC.remove();
    }

    // Scenario 3: re-entrant waiter abort inside scopeEditorStylesheetLink during handleLoad.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-hl-abort { color: teal; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;

      const controllerB = new AbortController();
      const loadB = loader.loadStylesheet(LINK_ID, URL_V2, controllerB.signal);
      const linkB = document.getElementById(LINK_ID) as HTMLLinkElement;
      const sheetB = attachStyleSheet(linkB, '.v2-hl-abort { color: gold; }');
      interceptSheetOnce(linkB, () => {
        controllerB.abort();
        return sheetB;
      });
      linkB.dispatchEvent(new Event('load'));

      await expectPromiseRejectsPromptly(
        loadB,
        'preview-enhancement-resource-stale'
      );
      expect(linkB.isConnected).toBe(false);
      expect(scopedRuleCount(sheetB)).toBe(0);
      expect(document.getElementById(LINK_ID)).toBe(linkA);
      expect(scopedRuleCount(sheetA)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }

    // Scenario 4: previousLoad.scopeLease.dispose() throws during handleLoad rollback.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-hl-rollback-err { color: navy; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const loadB = loader.loadStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal
      );
      const linkB = document.getElementById(LINK_ID) as HTMLLinkElement;
      const sheetB = attachStyleSheet(linkB, '.v2-hl-rollback-err { color: maroon; }');
      vi.spyOn(sheetA, 'deleteRule').mockImplementationOnce(() => {
        throw new Error('delete-failed');
      });
      linkB.dispatchEvent(new Event('load'));

      await expectPromiseRejectsPromptly(
        loadB,
        'editor-stylesheet-rollback-failed'
      );
      expect(linkB.isConnected).toBe(false);
      expect(scopedRuleCount(sheetB)).toBe(0);
      expect(linkA.isConnected).toBe(true);
      expect(document.getElementById(LINK_ID)).toBe(linkA);

      // styleLoads remains consistent and reuses restored linkA without re-appending.
      const appendSpy = vi.spyOn(document.head, 'appendChild');
      await expect(
        loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal)
      ).resolves.toBeUndefined();
      expect(appendSpy).not.toHaveBeenCalled();

      loader.dispose();
      linkA.remove();
    }
  });

  it('guards loadStylesheet reused link branch against re-entrant dispose, abort, and superseding loadStylesheet without repopulating styleLoads', async () => {
    const createPreloadedLink = (url: string, cssText: string) => {
      const link = document.createElement('link');
      link.id = LINK_ID;
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.easymdeStylesheetOwner = LINK_ID;
      link.dataset.easymdeLoadedHref = url;
      document.head.append(link);
      const sheet = attachStyleSheet(link, cssText);
      return { link, sheet };
    };

    // Scenario 1: re-entrant loader.dispose() inside scopeEditorStylesheetLink during reused link branch.
    {
      const loader = createPreviewStylesheetLoader(
        document,
        () => false,
        ROOT_SELECTOR
      );
      const { link, sheet } = createPreloadedLink(
        URL_V2,
        '.v2-reuse-dispose { color: crimson; }'
      );
      interceptSheetOnce(link, () => {
        loader.dispose();
        return sheet;
      });

      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal),
        'preview-enhancement-runtime-unavailable'
      );
      expect(scopedRuleCount(sheet)).toBe(0);

      // styleLoads must NOT have been repopulated after dispose().
      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal),
        'preview-enhancement-runtime-unavailable'
      );
      expect(scopedRuleCount(sheet)).toBe(0);
      link.remove();
    }

    // Scenario 2: re-entrant AbortSignal inside scopeEditorStylesheetLink during reused link branch.
    {
      const loader = createPreviewStylesheetLoader(
        document,
        () => false,
        ROOT_SELECTOR
      );
      const { link, sheet } = createPreloadedLink(
        URL_V2,
        '.v2-reuse-abort { color: olive; }'
      );
      const controller = new AbortController();
      interceptSheetOnce(link, () => {
        controller.abort();
        return sheet;
      });

      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V2, controller.signal),
        'preview-enhancement-resource-stale'
      );
      expect(scopedRuleCount(sheet)).toBe(0);

      // Because styleLoads was not populated, a subsequent valid load scopes cleanly and disposes back to 0.
      await loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal);
      expect(scopedRuleCount(sheet)).toBe(1);
      loader.dispose();
      expect(scopedRuleCount(sheet)).toBe(0);
      link.remove();
    }

    // Scenario 3: re-entrant superseding loadStylesheet() inside scopeEditorStylesheetLink during reused link branch.
    {
      const loader = createPreviewStylesheetLoader(
        document,
        () => false,
        ROOT_SELECTOR
      );
      const { link: reusedLink, sheet: reusedSheet } = createPreloadedLink(
        URL_V2,
        '.v2-reuse-supersede { color: indigo; }'
      );
      const supersedingLoads: Promise<void>[] = [];
      interceptSheetOnce(reusedLink, () => {
        supersedingLoads.push(
          loader.loadStylesheet(LINK_ID, URL_V3, new AbortController().signal)
        );
        return reusedSheet;
      });

      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal),
        'preview-enhancement-resource-stale'
      );
      expect(scopedRuleCount(reusedSheet)).toBe(0);

      const loadV3 = supersedingLoads[0];
      if (!loadV3) throw new Error('superseding load missing');
      const linkV3 = document.getElementById(LINK_ID) as HTMLLinkElement;
      expect(linkV3).not.toBeNull();
      expect(linkV3).not.toBe(reusedLink);
      expect(linkV3.getAttribute('href')).toBe(URL_V3);

      const sheetV3 = attachStyleSheet(linkV3, '.v3-reuse-supersede { color: coral; }');
      linkV3.dispatchEvent(new Event('load'));
      await loadV3;

      expect(reusedLink.isConnected).toBe(false);
      expect(document.getElementById(LINK_ID)).toBe(linkV3);
      expect(scopedRuleCount(reusedSheet)).toBe(0);
      expect(scopedRuleCount(sheetV3)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetV3)).toBe(0);
      linkV3.remove();
    }
  });

  it('releases orphanLoad scopeLease without refcount leak or CSSOM flicker when orphanLoad.link === current hits loadStylesheet reused link branch', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );
    const loadV1 = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const link = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(link).not.toBeNull();
    const sheet = attachStyleSheet(link, '.v1-orphan-same-link { color: brown; }');
    link.dispatchEvent(new Event('load'));
    await loadV1;
    expect(scopedRuleCount(sheet)).toBe(1);

    // Mutate link attributes so styleLoads.get(LINK_ID) holds an orphanLoad with
    // orphanLoad.link === current and stale cached.url !== URL_V2.
    link.setAttribute('href', URL_V2);
    link.dataset.easymdeLoadedHref = URL_V2;

    const deleteRuleSpy = vi.spyOn(sheet, 'deleteRule');
    await loader.loadStylesheet(LINK_ID, URL_V2, new AbortController().signal);

    // Disposing the old lease after acquiring the new lease keeps refcount >= 1
    // (no CSSOM flicker / deleteRule during handoff) and drops cleanly back to 1.
    expect(deleteRuleSpy).not.toHaveBeenCalled();
    expect(document.getElementById(LINK_ID)).toBe(link);
    expect(scopedRuleCount(sheet)).toBe(1);

    // Disposing the loader must roll back the stylesheet completely (refcount reaches 0).
    loader.dispose();
    expect(scopedRuleCount(sheet)).toBe(0);
    link.remove();
  });

  it('preserves current DOM link and avoids wedging slot.activeActivations when previousLoad.scopeLease.dispose() throws in applyCommit', async () => {
    const loader = createPreviewStylesheetLoader(
      document,
      () => false,
      ROOT_SELECTOR
    );

    // 1. Load active stylesheet A (URL_V1) cleanly.
    const loadA = loader.loadStylesheet(
      LINK_ID,
      URL_V1,
      new AbortController().signal
    );
    const linkA = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(linkA).not.toBeNull();
    const sheetA = attachStyleSheet(linkA, '.v1-apply-commit { color: red; }');
    linkA.dispatchEvent(new Event('load'));
    await loadA;
    expect(scopedRuleCount(sheetA)).toBe(1);

    // 2. Prepare activation B (URL_V2) so it enters slot.activeActivations.
    const activationB = loader.prepareStylesheet(
      LINK_ID,
      URL_V2,
      new AbortController().signal,
      'activation'
    );
    const linkB = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA);
    if (!linkB) throw new Error('activation B link missing');
    const sheetB = attachStyleSheet(linkB, '.v2-apply-commit { color: blue; }');
    linkB.dispatchEvent(new Event('load'));
    const readyActivationB = await activationB.promise;
    expect(scopedRuleCount(sheetB)).toBe(1);

    // 3. Prepare overlapping enhancement C (URL_V3) while activation B is active,
    // recording activation B in enhancement C's barrier.
    const enhancementC = loader.prepareStylesheet(
      LINK_ID,
      URL_V3,
      new AbortController().signal,
      'enhancement'
    );
    const linkC = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkA && candidate !== linkB);
    if (!linkC) throw new Error('enhancement C link missing');
    const sheetC = attachStyleSheet(linkC, '.v3-apply-commit { color: green; }');
    linkC.dispatchEvent(new Event('load'));
    const readyEnhancementC = await enhancementC.promise;
    expect(scopedRuleCount(sheetC)).toBe(1);

    // 4. Force previousLoad.scopeLease.dispose() to throw EditorStylesheetScopeError('editor-stylesheet-rollback-failed').
    vi.spyOn(sheetA, 'deleteRule').mockImplementationOnce(() => {
      throw new Error('delete-failed');
    });

    expect(() => readyActivationB.commit()).toThrow(
      'editor-stylesheet-rollback-failed'
    );

    // Current DOM link A must remain untouched with its original id; failed candidate B must be removed and its lease disposed.
    expect(linkA.isConnected).toBe(true);
    expect(linkA.id).toBe(LINK_ID);
    expect(linkA.getAttribute('href')).toBe(URL_V1);
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(linkB.isConnected).toBe(false);
    expect(scopedRuleCount(sheetB)).toBe(0);

    // 5. Overlapping enhancement C must NOT be wedged by slot.activeActivations and must commit cleanly.
    readyEnhancementC.commit();
    expect(linkA.isConnected).toBe(false);
    expect(document.getElementById(LINK_ID)).toBe(linkC);
    expect(linkC.id).toBe(LINK_ID);
    expect(linkC.media).toBe('all');
    expect(linkC.getAttribute('href')).toBe(URL_V3);
    expect(scopedRuleCount(sheetC)).toBe(1);

    // 6. A subsequent activation D (URL_V4) also commits cleanly and disposes back to 0.
    const activationD = loader.prepareStylesheet(
      LINK_ID,
      URL_V4,
      new AbortController().signal,
      'activation'
    );
    const linkD = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
      )
    ).find((candidate) => candidate !== linkC);
    if (!linkD) throw new Error('activation D link missing');
    const sheetD = attachStyleSheet(linkD, '.v4-apply-commit { color: purple; }');
    linkD.dispatchEvent(new Event('load'));
    const readyActivationD = await activationD.promise;
    readyActivationD.commit();

    expect(linkC.isConnected).toBe(false);
    expect(scopedRuleCount(sheetC)).toBe(0);
    expect(document.getElementById(LINK_ID)).toBe(linkD);
    expect(scopedRuleCount(sheetD)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(sheetD)).toBe(0);
    linkD.remove();

    // 7. Eviction verification: after applyCommit rollback failure strips previousLoad.scopeLease,
    // styleLoads must evict previousLoad so a subsequent loadStylesheet(LINK_ID, URL_V1)
    // re-scopes sheetA cleanly instead of hitting a lease-less cache, and dispose() cleans to 0.
    {
      const evictionLoader = createPreviewStylesheetLoader(
        document,
        () => false,
        ROOT_SELECTOR
      );
      const reloadA = evictionLoader.loadStylesheet(
        LINK_ID,
        URL_V1,
        new AbortController().signal
      );
      const evictionLinkA = document.getElementById(LINK_ID) as HTMLLinkElement;
      const evictionSheetA = attachStyleSheet(
        evictionLinkA,
        '.v1-apply-commit-evict { color: navy; }'
      );
      evictionLinkA.dispatchEvent(new Event('load'));
      await reloadA;
      expect(scopedRuleCount(evictionSheetA)).toBe(1);

      const failingActivation = evictionLoader.prepareStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal,
        'activation'
      );
      const evictionLinkB = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
        )
      ).find((candidate) => candidate !== evictionLinkA);
      if (!evictionLinkB) throw new Error('eviction activation B link missing');
      const evictionSheetB = attachStyleSheet(
        evictionLinkB,
        '.v2-apply-commit-evict { color: teal; }'
      );
      evictionLinkB.dispatchEvent(new Event('load'));
      const readyFailing = await failingActivation.promise;

      const originalDeleteRule = evictionSheetA.deleteRule.bind(evictionSheetA);
      vi.spyOn(evictionSheetA, 'deleteRule').mockImplementationOnce((index) => {
        originalDeleteRule(index);
        throw new Error('delete-failed-after-removal');
      });

      expect(() => readyFailing.commit()).toThrow(
        'editor-stylesheet-rollback-failed'
      );
      expect(evictionLinkA.isConnected).toBe(true);
      expect(document.getElementById(LINK_ID)).toBe(evictionLinkA);
      expect(evictionLinkB.isConnected).toBe(false);
      expect(scopedRuleCount(evictionSheetB)).toBe(0);
      expect(scopedRuleCount(evictionSheetA)).toBe(0);

      const appendSpy = vi.spyOn(document.head, 'appendChild');
      await evictionLoader.loadStylesheet(
        LINK_ID,
        URL_V1,
        new AbortController().signal
      );
      expect(appendSpy).not.toHaveBeenCalled();
      expect(scopedRuleCount(evictionSheetA)).toBe(1);

      evictionLoader.dispose();
      expect(scopedRuleCount(evictionSheetA)).toBe(0);
      evictionLinkA.remove();
    }
  });

  it('evicts previousLoad from styleLoads when handleLoad is cancelled re-entrantly during previousScopeLease.dispose()', async () => {
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
    const sheetA = attachStyleSheet(linkA, '.v1-hl-dispose-cancel { color: red; }');
    linkA.dispatchEvent(new Event('load'));
    await loadA;
    expect(scopedRuleCount(sheetA)).toBe(1);

    const controllerB = new AbortController();
    const loadB = loader.loadStylesheet(LINK_ID, URL_V2, controllerB.signal);
    const linkB = document.getElementById(LINK_ID) as HTMLLinkElement;
    const sheetB = attachStyleSheet(linkB, '.v2-hl-dispose-cancel { color: blue; }');
    const originalDeleteRule = sheetA.deleteRule.bind(sheetA);
    vi.spyOn(sheetA, 'deleteRule').mockImplementationOnce((index) => {
      controllerB.abort();
      originalDeleteRule(index);
    });

    linkB.dispatchEvent(new Event('load'));
    await expectPromiseRejectsPromptly(
      loadB,
      'preview-enhancement-resource-stale'
    );

    expect(linkB.isConnected).toBe(false);
    expect(scopedRuleCount(sheetB)).toBe(0);
    expect(linkA.isConnected).toBe(true);
    expect(document.getElementById(LINK_ID)).toBe(linkA);
    expect(scopedRuleCount(sheetA)).toBe(0);

    // Because previousLoad was evicted after its lease was detached, loadStylesheet(URL_V1)
    // must enter the reused-link branch and re-scope sheetA rather than hitting a stale cache.
    const appendSpy = vi.spyOn(document.head, 'appendChild');
    await loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal);
    expect(appendSpy).not.toHaveBeenCalled();
    expect(scopedRuleCount(sheetA)).toBe(1);

    loader.dispose();
    expect(scopedRuleCount(sheetA)).toBe(0);
    linkA.remove();
  });

  it('throws and evicts previousLoad when applyCommit aborts after previousScopeLease.dispose() due to link detachment or conflict', async () => {
    // Scenario 1: candidate link detached during previousScopeLease.dispose().
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-commit-detach { color: crimson; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const activationB = loader.prepareStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal,
        'activation'
      );
      const linkB = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
        )
      ).find((candidate) => candidate !== linkA);
      if (!linkB) throw new Error('detached activation B link missing');
      const sheetB = attachStyleSheet(linkB, '.v2-commit-detach { color: green; }');
      linkB.dispatchEvent(new Event('load'));
      const readyB = await activationB.promise;

      const originalDeleteRule = sheetA.deleteRule.bind(sheetA);
      vi.spyOn(sheetA, 'deleteRule').mockImplementationOnce((index) => {
        originalDeleteRule(index);
        linkB.remove();
      });

      expect(() => readyB.commit()).toThrow('preview-enhancement-resource-stale');
      expect(linkB.isConnected).toBe(false);
      expect(scopedRuleCount(sheetB)).toBe(0);
      expect(document.getElementById(LINK_ID)).toBe(linkA);
      expect(scopedRuleCount(sheetA)).toBe(0);

      await loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal);
      expect(scopedRuleCount(sheetA)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }

    // Scenario 2: non-link conflict element injected under LINK_ID during previousScopeLease.dispose().
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-commit-conflict { color: olive; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const activationB = loader.prepareStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal,
        'activation'
      );
      const linkB = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          `link[data-easymde-stylesheet-owner="${LINK_ID}"]`
        )
      ).find((candidate) => candidate !== linkA);
      if (!linkB) throw new Error('conflict activation B link missing');
      const sheetB = attachStyleSheet(linkB, '.v2-commit-conflict { color: purple; }');
      linkB.dispatchEvent(new Event('load'));
      const readyB = await activationB.promise;

      const conflict = document.createElement('div');
      const originalDeleteRule = sheetA.deleteRule.bind(sheetA);
      vi.spyOn(sheetA, 'deleteRule').mockImplementationOnce((index) => {
        originalDeleteRule(index);
        linkA.id = `${LINK_ID}-displaced`;
        conflict.id = LINK_ID;
        document.body.append(conflict);
        appended.push(conflict);
      });

      expect(() => readyB.commit()).toThrow('preview-enhancement-resource-conflict');
      expect(linkB.isConnected).toBe(false);
      expect(scopedRuleCount(sheetB)).toBe(0);
      expect(scopedRuleCount(sheetA)).toBe(0);

      conflict.remove();
      linkA.id = LINK_ID;

      await loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal);
      expect(scopedRuleCount(sheetA)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }
  });

  it('verifies DOM id identity on both cached and restored cache hits in loadStylesheet', async () => {
    // Scenario 1: cached.link remains connected under a different id while a non-link or another link owns LINK_ID.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-dom-identity { color: brown; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      linkA.id = `${LINK_ID}-displaced`;
      const conflict = document.createElement('div');
      conflict.id = LINK_ID;
      document.body.append(conflict);
      appended.push(conflict);

      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal),
        'preview-enhancement-resource-conflict'
      );

      conflict.remove();
      const foreignLink = document.createElement('link');
      foreignLink.id = LINK_ID;
      foreignLink.rel = 'stylesheet';
      foreignLink.href = URL_V2;
      document.head.append(foreignLink);
      appended.push(foreignLink);

      const reloadV1 = loader.loadStylesheet(
        LINK_ID,
        URL_V1,
        new AbortController().signal
      );
      const newLink = document.getElementById(LINK_ID) as HTMLLinkElement;
      expect(newLink).not.toBe(linkA);
      expect(newLink).not.toBe(foreignLink);
      expect(scopedRuleCount(sheetA)).toBe(0);

      const newSheet = attachStyleSheet(newLink, '.v1-dom-identity-reloaded { color: teal; }');
      newLink.dispatchEvent(new Event('load'));
      await reloadV1;

      expect(foreignLink.isConnected).toBe(false);
      expect(document.getElementById(LINK_ID)).toBe(newLink);
      expect(scopedRuleCount(newSheet)).toBe(1);

      loader.dispose();
      expect(scopedRuleCount(newSheet)).toBe(0);
      linkA.remove();
      newLink.remove();
    }

    // Scenario 2: restored.link is shadowed in document order by a non-link conflict owning LINK_ID after cancelling a pending load.
    {
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
      const sheetA = attachStyleSheet(linkA, '.v1-restored-identity { color: indigo; }');
      linkA.dispatchEvent(new Event('load'));
      await loadA;
      expect(scopedRuleCount(sheetA)).toBe(1);

      const loadV2 = loader.loadStylesheet(
        LINK_ID,
        URL_V2,
        new AbortController().signal
      );
      const linkB = document.getElementById(LINK_ID) as HTMLLinkElement;
      expect(linkA.id).toBe(`${LINK_ID}-previous`);

      // Place tree order as [linkB (id=LINK_ID), conflictDiv (id=LINK_ID), linkA (id=LINK_ID-previous)]:
      // before cancelling loadV2, getElementById(LINK_ID) is linkB (HTMLLinkElement);
      // after cancelling loadV2 removes linkB and restores linkA.id = LINK_ID,
      // getElementById(LINK_ID) resolves to conflictDiv (!== restored.link).
      const conflict = document.createElement('div');
      conflict.id = LINK_ID;
      document.head.insertBefore(linkB, linkA);
      document.head.insertBefore(conflict, linkA);
      appended.push(conflict);

      await expectPromiseRejectsPromptly(
        loader.loadStylesheet(LINK_ID, URL_V1, new AbortController().signal),
        'preview-enhancement-resource-conflict'
      );
      await expectPromiseRejectsPromptly(
        loadV2,
        'preview-enhancement-resource-stale'
      );

      conflict.remove();
      loader.dispose();
      expect(scopedRuleCount(sheetA)).toBe(0);
      linkA.remove();
    }
  });
});
