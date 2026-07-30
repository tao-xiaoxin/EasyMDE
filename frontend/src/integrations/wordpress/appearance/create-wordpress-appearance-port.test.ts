import { describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../../test/fixtures/appearance-bootstrap';
import { createWordPressAppearancePort } from './create-wordpress-appearance-port';

const assetBaseUrl = 'https://example.test/wp-content/plugins/easymde/';

function fixture() {
  document.head.innerHTML = '<link id="easymde-article-theme-css" rel="stylesheet">';
  const field = () => document.createElement('input');
  const bootstrap: AppearanceBootstrap = {
    articleThemes: [{
      cssUrl: `${assetBaseUrl}assets/themes/article/default.css`,
      id: 'default',
      label: 'Default',
      defaultCodeTheme: 'atom-one-dark'
    }],
    canManageCustomCss: true,
    codeThemeExplicit: false,
    codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
    customCss: [{
      css: '.note { color: navy; }',
      id: 'writer-css',
      name: 'Writer CSS',
      scopedCss: '.easymde-rendered-content .note { color: navy; }'
    }],
    customCssVariables,
    state: { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'default' },
    strings: {
      appearance: 'Appearance', articleTheme: 'Article theme', codeTheme: 'Code theme',
      cssName: 'CSS name', cssNameDuplicate: 'This theme name is already in use. Choose another name and try again.',
      cssSaveFailed: 'CSS save failed', cssSaved: 'CSS saved',
      customCss: 'Custom CSS', customCssTheme: 'Custom CSS theme',
      customCssDialog: customCssDialogStrings,
      namedCustomCss: 'Named CSS', saveCss: 'Save CSS'
    }
  };
  return {
    apiFetch: vi.fn(),
    assetBaseUrl,
    bootstrap,
    customCssUrl: 'https://example.test/wp-json/easymde/v1/custom-css',
    document,
    fields: {
      codeTheme: field(),
      codeThemeExplicit: field(),
      customCssId: field(),
      markdownTheme: field()
    },
    nonce: 'synthetic-nonce',
    siteUrl: 'https://example.test/wp-admin/post.php'
  };
}

describe('createWordPressAppearancePort', () => {
  it('applies the saved appearance before the first user interaction', () => {
    const options = fixture();
    options.bootstrap = {
      ...options.bootstrap,
      codeThemeExplicit: true,
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: 'writer-css',
        markdownTheme: 'custom'
      }
    };

    createWordPressAppearancePort(options);

    expect(options.fields.markdownTheme.value).toBe('custom');
    expect(options.fields.codeTheme.value).toBe('atom-one-dark');
    expect(options.fields.codeThemeExplicit.value).toBe('1');
    expect(options.fields.customCssId.value).toBe('writer-css');
    expect(document.querySelector<HTMLStyleElement>('#easymde-custom-css-preview')?.textContent)
      .toBe('.easymde-rendered-content .note { color: navy; }');
  });

  it('fails fast when Bootstrap references unavailable Custom CSS', () => {
    const options = fixture();
    options.bootstrap = {
      ...options.bootstrap,
      customCss: [],
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: 'missing-css',
        markdownTheme: 'custom'
      }
    };

    expect(() => createWordPressAppearancePort(options))
      .toThrowError('appearance-custom-css-unavailable');
  });

  it('updates only delegated fields and local preview assets', () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);

    port.applyState(
      { codeTheme: 'atom-one-dark', customCssId: 'writer-css', markdownTheme: 'custom' },
      true
    );

    expect(options.fields.markdownTheme.value).toBe('custom');
    expect(options.fields.codeTheme.value).toBe('atom-one-dark');
    expect(options.fields.codeThemeExplicit.value).toBe('1');
    expect(options.fields.customCssId.value).toBe('writer-css');
    expect(document.querySelector<HTMLLinkElement>('#easymde-article-theme-css')?.href)
      .toBe(`${assetBaseUrl}assets/themes/article/default.css`);
    expect(document.querySelector<HTMLStyleElement>('#easymde-custom-css-preview')?.textContent)
      .toBe('.easymde-rendered-content .note { color: navy; }');
  });

  it('uses the server snapshot after a successful Custom CSS mutation', async () => {
    const options = fixture();
    options.apiFetch.mockResolvedValue({
      customCss: [{
        css: '.saved { color: green; }', id: 'saved-css', name: 'Saved CSS',
        scopedCss: '.easymde-rendered-content .saved { color: green; }'
      }],
      item: { id: 'saved-css' }
    });
    const port = createWordPressAppearancePort(options);

    await expect(port.saveCustomCss({ css: '.saved { color: green; }', id: '', name: 'Saved CSS' }))
      .resolves.toMatchObject({ status: 'saved', snapshot: { state: { customCssId: 'saved-css' } } });
    expect(options.apiFetch).toHaveBeenCalledWith({
      data: { css: '.saved { color: green; }', id: '', name: 'Saved CSS' },
      headers: { 'X-WP-Nonce': 'synthetic-nonce' },
      method: 'POST',
      url: 'https://example.test/wp-json/easymde/v1/custom-css'
    });
  });

  it('maps duplicate-name failures to a controlled code without exposing the REST message', async () => {
    const options = fixture();
    options.apiFetch.mockRejectedValue({
      code: 'easymde_duplicate_custom_css_name',
      message: 'Sensitive server detail'
    });
    const port = createWordPressAppearancePort(options);

    await expect(port.saveCustomCss({
      css: '.saved { color: green; }',
      id: '',
      name: 'Saved CSS'
    })).resolves.toEqual({
      code: 'easymde_duplicate_custom_css_name',
      status: 'failed'
    });
  });

  it('does not expose messages from non-duplicate Custom CSS failures', async () => {
    const options = fixture();
    options.apiFetch.mockRejectedValue({
      code: 'rest_internal_error',
      message: 'Sensitive server detail'
    });
    const port = createWordPressAppearancePort(options);

    await expect(port.saveCustomCss({
      css: '.saved { color: green; }',
      id: '',
      name: 'Saved CSS'
    })).resolves.toEqual({
      code: 'custom-css-save-failed',
      status: 'failed'
    });
  });

  it('uses the existing server policy endpoint for scoped Custom CSS previews', async () => {
    const options = fixture();
    options.apiFetch.mockResolvedValue({
      css: '.note { color: green; }',
      scopedCss:
        '.easymde-immersive-workspace__custom-css-preview-content .note { color: green; }'
    });
    const port = createWordPressAppearancePort(options);
    const controller = new AbortController();

    await expect(
      port.previewCustomCss('.note { color: green; }', controller.signal)
    ).resolves.toMatchObject({
      scopedCss:
        expect.stringContaining(
          '.easymde-immersive-workspace__custom-css-preview-content .note'
        ),
      status: 'ready'
    });
    expect(options.apiFetch).toHaveBeenCalledWith({
      data: { css: '.note { color: green; }' },
      headers: { 'X-WP-Nonce': 'synthetic-nonce' },
      method: 'POST',
      signal: controller.signal,
      url: 'https://example.test/wp-json/easymde/v1/custom-css/preview'
    });
  });

  it('distinguishes expected CSS validation failures from transport failures', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    options.apiFetch.mockRejectedValueOnce({
      code: 'easymde_invalid_custom_css'
    });

    await expect(
      port.previewCustomCss('h2 {', new AbortController().signal)
    ).resolves.toEqual({ status: 'invalid' });

    options.apiFetch.mockRejectedValueOnce({ code: 'rest_cookie_invalid_nonce' });
    await expect(
      port.previewCustomCss('h2 {}', new AbortController().signal)
    ).rejects.toEqual({ code: 'rest_cookie_invalid_nonce' });
  });

  it.each([
    { customCssUrl: 'https://remote.test/custom-css' },
    { bootstrap: { ...fixture().bootstrap, articleThemes: [{ cssUrl: 'https://remote.test/theme.css', id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark' }] } },
    { bootstrap: { ...fixture().bootstrap, articleThemes: [{ cssUrl: `${assetBaseUrl}%2e%2e/%2e%2e/escape.css`, id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark' }] } }
  ])('rejects remote or escaping runtime URLs', (override) => {
    expect(() => createWordPressAppearancePort({ ...fixture(), ...override }))
      .toThrowError();
  });
});
