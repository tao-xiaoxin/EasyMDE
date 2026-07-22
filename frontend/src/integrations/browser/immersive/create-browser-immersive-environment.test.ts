import { describe, expect, it } from 'vitest';

import { createBrowserImmersiveEnvironment } from './create-browser-immersive-environment';

describe('createBrowserImmersiveEnvironment', () => {
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
