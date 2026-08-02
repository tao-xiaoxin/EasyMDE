import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserImmersiveEnvironment } from './create-browser-immersive-environment';

const faviconUrl =
  'https://example.test/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';

describe('createBrowserImmersiveEnvironment', () => {
  afterEach(() => vi.useRealTimers());

  it('isolates the host, cycles focus, and restores the previous inert state', () => {
    document.body.innerHTML = `
      <header id="existing" inert></header>
      <main>
        <aside id="sidebar"></aside>
        <section id="boundary">
          <button id="first">First</button>
          <button id="last">Last</button>
        </section>
      </main>
      <footer id="footer"></footer>
    `;
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const boundary = document.querySelector<HTMLElement>('#boundary');
    const first = document.querySelector<HTMLButtonElement>('#first');
    const last = document.querySelector<HTMLButtonElement>('#last');
    if (!boundary || !first || !last) throw new Error('test-fixture-invalid');

    const release = environment.activateFocusBoundary(boundary);

    expect(document.querySelector('#sidebar')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('#footer')?.hasAttribute('inert')).toBe(true);
    expect(boundary.hasAttribute('inert')).toBe(false);
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
        shiftKey: true
      })
    );
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Tab'
      })
    );
    expect(document.activeElement).toBe(first);

    release();

    expect(document.querySelector('#sidebar')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('#footer')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('#existing')?.hasAttribute('inert')).toBe(true);
  });

  it('leaves keyboard navigation inside a WordPress media modal to WordPress', () => {
    document.body.innerHTML = `
      <main>
        <section id="boundary">
          <button id="editor-first">Editor first</button>
          <button id="editor-last">Editor last</button>
        </section>
      </main>
    `;
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const boundary = document.querySelector<HTMLElement>('#boundary');
    if (!boundary) throw new Error('test-fixture-invalid');
    const release = environment.activateFocusBoundary(boundary);
    document.body.insertAdjacentHTML(
      'beforeend',
      `
        <div class="media-modal">
          <button id="media-first">Media first</button>
          <button id="media-middle">Media middle</button>
          <button id="media-last">Media last</button>
        </div>
      `
    );
    const mediaMiddle = document.querySelector<HTMLButtonElement>('#media-middle');
    if (!mediaMiddle) throw new Error('test-fixture-invalid');
    mediaMiddle.focus();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab'
    });

    mediaMiddle.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(mediaMiddle);
    release();
  });

  it('reports only visible toolbar popovers as open', () => {
    document.body.innerHTML = `
      <div class="easymde-toolbar-popover" hidden></div>
      <div class="easymde-immersive-modal"></div>
    `;
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);

    expect(environment.hasOpenToolbarPopover()).toBe(false);

    document.querySelector('.easymde-toolbar-popover')?.removeAttribute('hidden');
    expect(environment.hasOpenToolbarPopover()).toBe(true);
  });

  it('overrides the tab favicon only while immersive writing is active', () => {
    document.head.innerHTML = `
      <link id="wordpress-icon" rel="icon" href="https://example.test/wp-icon.png">
    `;
    const environment = createBrowserImmersiveEnvironment(
      document,
      faviconUrl
    );

    const restore = environment.activateFavicon();
    const icons = document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"]'
    );
    expect(icons).toHaveLength(2);
    expect(icons[0]?.id).toBe('wordpress-icon');
    expect(icons[1]?.href).toBe(
      'https://example.test/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png'
    );
    expect(icons[1]?.type).toBe('image/png');

    restore();

    expect(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    ).toHaveLength(1);
    expect(document.querySelector<HTMLLinkElement>('#wordpress-icon')?.href).toBe(
      'https://example.test/wp-icon.png'
    );
  });

  it('schedules and cancels browser-owned callbacks', () => {
    vi.useFakeTimers();
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const callback = vi.fn();

    const cancel = environment.schedule(callback, 2000);
    vi.advanceTimersByTime(1999);
    expect(callback).not.toHaveBeenCalled();
    cancel();
    vi.advanceTimersByTime(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it('subscribes and unsubscribes viewport resize notifications', () => {
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const listener = vi.fn();
    const unsubscribe = environment.subscribeResize(listener);

    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('observes preview media and font layout changes and cleans up listeners', () => {
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const surface = document.createElement('article');
    const image = document.createElement('img');
    surface.append(image);
    const listener = vi.fn();
    const unsubscribe = environment.observePreviewLayout(surface, listener);

    image.dispatchEvent(new Event('load'));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    image.dispatchEvent(new Event('error'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('reconciles preview media listeners when rendered nodes are replaced', async () => {
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const surface = document.createElement('article');
    const firstImage = document.createElement('img');
    surface.append(firstImage);
    const listener = vi.fn();
    const unsubscribe = environment.observePreviewLayout(surface, listener);

    firstImage.dispatchEvent(new Event('load'));
    expect(listener).toHaveBeenCalledOnce();

    firstImage.remove();
    await Promise.resolve();
    const callsAfterRemoval = listener.mock.calls.length;
    firstImage.dispatchEvent(new Event('load'));
    expect(listener).toHaveBeenCalledTimes(callsAfterRemoval);

    const secondImage = document.createElement('img');
    surface.append(secondImage);
    await Promise.resolve();
    const callsAfterInsertion = listener.mock.calls.length;
    secondImage.dispatchEvent(new Event('load'));
    expect(listener).toHaveBeenCalledTimes(callsAfterInsertion + 1);

    unsubscribe();
  });

  it('refreshes for video media layout events and releases removed video listeners', async () => {
    const environment = createBrowserImmersiveEnvironment(document, faviconUrl);
    const surface = document.createElement('article');
    const video = document.createElement('video');
    surface.append(video);
    const listener = vi.fn();
    const unsubscribe = environment.observePreviewLayout(surface, listener);

    video.dispatchEvent(new Event('loadedmetadata'));
    expect(listener).toHaveBeenCalledOnce();

    video.remove();
    await Promise.resolve();
    const callsAfterRemoval = listener.mock.calls.length;
    video.dispatchEvent(new Event('resize'));
    video.dispatchEvent(new Event('loadeddata'));
    expect(listener).toHaveBeenCalledTimes(callsAfterRemoval);

    unsubscribe();
  });
});
