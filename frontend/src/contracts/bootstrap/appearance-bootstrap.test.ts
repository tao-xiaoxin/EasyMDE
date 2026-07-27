import { describe, expect, it } from 'vitest';

import {
  type AppearanceBootstrapError,
  parseAppearanceBootstrap,
  parseAppearanceSnapshot
} from './appearance-bootstrap';

const bootstrap = {
  articleThemes: [
    {
      cssUrl: 'https://example.test/wp-content/plugins/easymde/assets/themes/article/default.css',
      fontDefaults: {
        appleFont: 'system', customFont: 'none', serifFont: 'off', windowsFont: 'system'
      },
      id: 'default',
      label: 'Default'
    },
    { id: 'newsprint', label: 'Newsprint' }
  ],
  codeThemes: [
    { id: 'atom-one-dark', label: 'Atom One Dark' },
    { id: 'github', label: 'GitHub' }
  ],
  customCss: [
    {
      id: 'writer-css',
      name: 'Writer CSS',
      css: '.note { color: navy; }',
      scopedCss: '.easymde-rendered-content .note { color: navy; }'
    }
  ],
  state: {
    markdownTheme: 'default',
    codeTheme: 'atom-one-dark',
    customCssId: ''
  },
  strings: {
    appearance: 'Appearance',
    articleTheme: 'Article theme',
    codeTheme: 'Code theme',
    customCss: 'Custom CSS',
    customCssTheme: 'Custom CSS theme',
    cssName: 'CSS name',
    saveCss: 'Save CSS',
    cssSaved: 'CSS saved.',
    cssSaveFailed: 'CSS save failed.',
    namedCustomCss: 'Named custom CSS'
  }
};

describe('parseAppearanceBootstrap', () => {
  it('preserves registries, custom CSS library, selected state, and translated strings', () => {
    expect(parseAppearanceBootstrap(bootstrap)).toEqual(bootstrap);
  });

  it('accepts existing Custom CSS names without imposing a client-only length limit', () => {
    const name = 'n'.repeat(513);

    expect(parseAppearanceBootstrap({
      ...bootstrap,
      customCss: [{ ...bootstrap.customCss[0], name }]
    }).customCss[0]?.name).toBe(name);
  });

  it.each([
    {
      name: 'duplicate article theme IDs',
      value: {
        ...bootstrap,
        articleThemes: [...bootstrap.articleThemes, bootstrap.articleThemes[0]]
      },
      code: 'duplicate-appearance-option-id'
    },
    {
      name: 'invalid custom CSS IDs',
      value: {
        ...bootstrap,
        customCss: [{ ...bootstrap.customCss[0], id: 'Not Valid' }]
      },
      code: 'invalid-custom-css-id'
    },
    {
      name: 'oversized custom CSS',
      value: {
        ...bootstrap,
        customCss: [{ ...bootstrap.customCss[0], css: 'a'.repeat(30_001) }]
      },
      code: 'invalid-custom-css-code'
    },
    {
      name: 'unknown code theme selection',
      value: {
        ...bootstrap,
        state: { ...bootstrap.state, codeTheme: 'missing' }
      },
      code: 'invalid-code-theme-selection'
    },
    {
      name: 'missing translated string',
      value: {
        ...bootstrap,
        strings: { ...bootstrap.strings, customCssTheme: '' }
      },
      code: 'invalid-appearance-string'
    }
  ])('rejects $name', ({ value, code }) => {
    expect(() => parseAppearanceBootstrap(value)).toThrowError(
      expect.objectContaining<Partial<AppearanceBootstrapError>>({ code })
    );
  });
});

describe('parseAppearanceSnapshot', () => {
  it('accepts a selected custom CSS item from a refreshed library', () => {
    const parsed = parseAppearanceBootstrap(bootstrap);

    expect(parseAppearanceSnapshot({
      customCss: bootstrap.customCss,
      state: {
        markdownTheme: 'custom',
        codeTheme: 'github',
        customCssId: 'writer-css'
      }
    }, parsed)).toEqual({
      customCss: bootstrap.customCss,
      state: {
        markdownTheme: 'custom',
        codeTheme: 'github',
        customCssId: 'writer-css'
      }
    });
  });

  it('preserves a stored custom CSS snapshot selection absent from the current user library', () => {
    const parsed = parseAppearanceBootstrap(bootstrap);

    expect(parseAppearanceSnapshot({
      customCss: [],
      state: {
        markdownTheme: 'custom',
        codeTheme: 'atom-one-dark',
        customCssId: 'missing'
      }
    }, parsed)).toEqual({
      customCss: [],
      state: {
        markdownTheme: 'custom',
        codeTheme: 'atom-one-dark',
        customCssId: 'missing'
      }
    });
  });
});
