import { describe, expect, it } from 'vitest';

import {
  type FontControlsBootstrapError,
  parseFontControlsBootstrap,
  parseFontControlsState
} from './font-controls-bootstrap';

const bootstrap = {
  options: {
    customFonts: [
      { id: 'none', label: 'No custom font', fontFamily: '' },
      { id: 'optima', label: 'Optima', fontFamily: '"Optima", Arial' }
    ],
    windowsFonts: [
      { id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: '"Microsoft YaHei", Arial' }
    ],
    appleFonts: [
      { id: 'pingfang-sc-light', label: 'PingFang SC Light', fontFamily: '"PingFang SC", Arial' }
    ],
    serifOptions: [
      { id: 'yes', label: 'Yes', fontFamily: '"Optima", Georgia, serif' }
    ]
  },
  state: {
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  },
  strings: {
    font: 'Font',
    customFont: 'Custom font',
    windowsFont: 'Windows font',
    appleFont: 'Apple font',
    serifFont: 'Serif font',
    fontStackHelp: 'Fonts are applied in fallback order.'
  }
};

describe('parseFontControlsBootstrap', () => {
  it('preserves all four option groups, ordering, selected values, and translated strings', () => {
    const parsed = parseFontControlsBootstrap(bootstrap);

    expect(parsed.options.customFonts.map(({ id }) => id)).toEqual(['none', 'optima']);
    expect(parsed.options.windowsFonts.map(({ id }) => id)).toEqual(['microsoft-yahei']);
    expect(parsed.options.appleFonts.map(({ id }) => id)).toEqual(['pingfang-sc-light']);
    expect(parsed.options.serifOptions.map(({ id }) => id)).toEqual(['yes']);
    expect(parsed.state).toEqual(bootstrap.state);
    expect(parsed.strings).toEqual(bootstrap.strings);
  });

  it.each([
    {
      name: 'duplicate option IDs',
      value: {
        ...bootstrap,
        options: {
          ...bootstrap.options,
          customFonts: [...bootstrap.options.customFonts, bootstrap.options.customFonts[1]]
        }
      },
      code: 'duplicate-font-option-id'
    },
    {
      name: 'invalid option IDs',
      value: {
        ...bootstrap,
        options: {
          ...bootstrap.options,
          customFonts: [{ id: 'Not Valid', label: 'Invalid', fontFamily: 'Arial' }]
        }
      },
      code: 'invalid-font-option-id'
    },
    {
      name: 'unsafe font family declarations',
      value: {
        ...bootstrap,
        options: {
          ...bootstrap.options,
          customFonts: [{ id: 'unsafe', label: 'Unsafe', fontFamily: 'Arial; color: red' }]
        }
      },
      code: 'invalid-font-family'
    },
    {
      name: 'missing selected values',
      value: {
        ...bootstrap,
        state: { ...bootstrap.state, customFont: 'missing' }
      },
      code: 'invalid-font-selection'
    },
    {
      name: 'missing translated labels',
      value: {
        ...bootstrap,
        strings: { ...bootstrap.strings, fontStackHelp: '' }
      },
      code: 'invalid-font-string'
    }
  ])('rejects $name', ({ value, code }) => {
    expect(() => parseFontControlsBootstrap(value)).toThrowError(
      expect.objectContaining<Partial<FontControlsBootstrapError>>({ code })
    );
  });
});

describe('parseFontControlsState', () => {
  it('validates theme-triggered replacement state against the prepared option groups', () => {
    const parsed = parseFontControlsBootstrap(bootstrap);

    expect(parseFontControlsState({
      customFont: 'none',
      windowsFont: 'microsoft-yahei',
      appleFont: 'pingfang-sc-light',
      serifFont: 'yes'
    }, parsed.options)).toEqual({
      customFont: 'none',
      windowsFont: 'microsoft-yahei',
      appleFont: 'pingfang-sc-light',
      serifFont: 'yes'
    });
  });

  it('rejects a replacement state whose selected value is absent', () => {
    const parsed = parseFontControlsBootstrap(bootstrap);

    expect(() => parseFontControlsState({
      ...bootstrap.state,
      serifFont: 'missing'
    }, parsed.options)).toThrowError(
      expect.objectContaining<Partial<FontControlsBootstrapError>>({
        code: 'invalid-font-selection'
      })
    );
  });
});
