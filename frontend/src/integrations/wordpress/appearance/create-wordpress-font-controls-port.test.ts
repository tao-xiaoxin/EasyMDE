import { describe, expect, it } from 'vitest';

import { createWordPressFontControlsPort } from './create-wordpress-font-controls-port';

describe('createWordPressFontControlsPort', () => {
  it('synchronizes only the four delegated native font fields', () => {
    const field = () => document.createElement('input');
    const fields = {
      appleFont: field(), customFont: field(), serifFont: field(), windowsFont: field()
    };
    const port = createWordPressFontControlsPort(fields);

    port.applyState({
      appleFont: 'new-york', customFont: 'inter', serifFont: 'on', windowsFont: 'segoe-ui'
    });

    expect(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])))
      .toEqual({ appleFont: 'new-york', customFont: 'inter', serifFont: 'on', windowsFont: 'segoe-ui' });
  });

  it('fails before activation when a delegated field is unavailable', () => {
    expect(() => createWordPressFontControlsPort({
      appleFont: document.createElement('input'),
      customFont: document.createElement('input'),
      serifFont: document.createElement('input'),
      windowsFont: document.createElement('div') as unknown as HTMLInputElement
    })).toThrowError('font-controls-native-fields-unavailable');
  });
});
