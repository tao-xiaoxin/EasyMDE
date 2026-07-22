import { describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import { createWordPressAppearancePort } from './create-wordpress-appearance-port';

const assetBaseUrl = 'https://example.test/wp-content/plugins/easymde/';

function fixture() {
  document.head.innerHTML = '<link id="easymde-article-theme-css" rel="stylesheet">';
  const field = () => document.createElement('input');
  const bootstrap: AppearanceBootstrap = {
    articleThemes: [{
      cssUrl: `${assetBaseUrl}assets/themes/article/default.css`,
      id: 'default',
      label: 'Default'
    }],
    codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
    customCss: [{
      css: '.note { color: navy; }',
      id: 'writer-css',
      name: 'Writer CSS',
      scopedCss: '.easymde-rendered-content .note { color: navy; }'
    }],
    state: { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'default' },
    strings: {
      appearance: 'Appearance', articleTheme: 'Article theme', codeTheme: 'Code theme',
      cssName: 'CSS name', cssSaveFailed: 'CSS save failed', cssSaved: 'CSS saved',
      customCss: 'Custom CSS', namedCustomCss: 'Named CSS', saveCss: 'Save CSS'
    }
  };
  return {
    apiFetch: vi.fn(),
    assetBaseUrl,
    bootstrap,
    customCssUrl: 'https://example.test/wp-json/easymde/v1/custom-css',
    document,
    fields: { codeTheme: field(), customCssId: field(), markdownTheme: field() },
    nonce: 'synthetic-nonce',
    siteUrl: 'https://example.test/wp-admin/post.php'
  };
}

describe('createWordPressAppearancePort', () => {
  it('updates only delegated fields and local preview assets', () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);

    port.applyState({ codeTheme: 'atom-one-dark', customCssId: 'writer-css', markdownTheme: 'custom' });

    expect(options.fields.markdownTheme.value).toBe('custom');
    expect(options.fields.codeTheme.value).toBe('atom-one-dark');
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

  it.each([
    { customCssUrl: 'https://remote.test/custom-css' },
    { bootstrap: { ...fixture().bootstrap, articleThemes: [{ cssUrl: 'https://remote.test/theme.css', id: 'default', label: 'Default' }] } },
    { bootstrap: { ...fixture().bootstrap, articleThemes: [{ cssUrl: `${assetBaseUrl}%2e%2e/%2e%2e/escape.css`, id: 'default', label: 'Default' }] } }
  ])('rejects remote or escaping runtime URLs', (override) => {
    expect(() => createWordPressAppearancePort({ ...fixture(), ...override }))
      .toThrowError();
  });
});
