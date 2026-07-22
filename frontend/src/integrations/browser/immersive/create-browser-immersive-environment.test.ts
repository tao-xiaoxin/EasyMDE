import { describe, expect, it } from 'vitest';

import { createBrowserImmersiveEnvironment } from './create-browser-immersive-environment';

describe('createBrowserImmersiveEnvironment', () => {
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
    const environment = createBrowserImmersiveEnvironment(document);
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

  it('reports only visible toolbar popovers as open', () => {
    document.body.innerHTML = `
      <div class="easymde-toolbar-popover" hidden></div>
      <div class="easymde-immersive-modal"></div>
    `;
    const environment = createBrowserImmersiveEnvironment(document);

    expect(environment.hasOpenToolbarPopover()).toBe(false);

    document.querySelector('.easymde-toolbar-popover')?.removeAttribute('hidden');
    expect(environment.hasOpenToolbarPopover()).toBe(true);
  });
});
