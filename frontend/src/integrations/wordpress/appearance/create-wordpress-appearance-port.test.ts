import { describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../../test/fixtures/appearance-bootstrap';
import { createWordPressAppearancePort } from './create-wordpress-appearance-port';

const assetBaseUrl = 'https://example.test/wp-content/plugins/easymde/';

function attachStylesheet(link: HTMLLinkElement | null | undefined): void {
  if (!link) return;
  const style = document.createElement('style');
  style.textContent = '.easymde-rendered-content { color: black; }';
  document.head.append(style);
  Object.defineProperty(link, 'sheet', {
    configurable: true,
    value: style.sheet
  });
}

function fixture() {
  document.head.innerHTML = `<link id="easymde-article-theme-css" rel="stylesheet" href="${assetBaseUrl}assets/themes/article/default.css">`;
  attachStylesheet(document.querySelector<HTMLLinkElement>('#easymde-article-theme-css'));
  const field = () => document.createElement('input');
  const bootstrap: AppearanceBootstrap = {
    articleThemes: [{
      cssUrl: `${assetBaseUrl}assets/themes/article/default.css`,
      id: 'default',
      label: 'Default',
      defaultCodeTheme: 'atom-one-dark',
      markupProfile: 'common-v1'
    }, {
      cssUrl: `${assetBaseUrl}assets/themes/article/newsprint.css`,
      id: 'newsprint',
      label: 'Newsprint',
      defaultCodeTheme: 'atom-one-dark',
      markupProfile: 'common-v1'
    }],
    canManageCustomCss: true,
    codeThemeExplicit: false,
    customMarkupProfile: 'common-v1',
    codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
    customCss: [{
      articleThemeName: 'Writer Article',
      codeThemeName: 'Writer Code',
      css: '.note { color: navy; }',
      id: 'writer-css',
      scopedCss: '.easymde-rendered-content .note { color: navy; }'
    }],
    customCssVariables,
    state: { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'default' },
    strings: {
      appearance: 'Appearance', articleTheme: 'Article theme', codeTheme: 'Code theme',
      cssName: 'CSS name', cssNameDuplicate: 'This theme name is already in use. Choose another name and try again.',
      cssSaveFailed: 'CSS save failed', cssSaved: 'CSS saved',
      themeApplyFailed: 'Theme could not be applied. The saved theme is still available.',
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

function fixtureWithInitialCustomCss() {
  const options = fixture();
  const customCss = options.bootstrap.customCss[0];
  if (!customCss) throw new Error('test-custom-css-missing');
  const customStyle = document.createElement('style');
  customStyle.id = 'easymde-custom-css-preview';
  customStyle.textContent = customCss.scopedCss;
  document.head.append(customStyle);
  options.bootstrap = {
    ...options.bootstrap,
    state: {
      codeTheme: 'atom-one-dark',
      customCssId: customCss.id,
      markdownTheme: 'custom'
    }
  };
  return options;
}

function editorAliasCount(style: HTMLStyleElement): number {
  const sheet = style.sheet;
  if (!sheet) throw new Error('test-custom-style-sheet-missing');
  return Array.from(sheet.cssRules).filter(({ cssText }) =>
    cssText.includes('#easymde-editor-root')
  ).length;
}

describe('createWordPressAppearancePort', () => {
  it('cancels a pending article stylesheet without committing hidden fields', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    const pending = port.applyState(
      { codeTheme: 'github', customCssId: '', markdownTheme: 'newsprint' },
      true
    );

    port.cancelPendingApply();

    await expect(pending).resolves.toBe(false);
    expect(options.fields.markdownTheme.value).toBe('default');
    expect(options.fields.codeTheme.value).toBe('atom-one-dark');
    expect(document.querySelector(
      'link[href*="newsprint"]:not(#easymde-article-theme-css)'
    )).toBeNull();
  });

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

  it('reuses a valid scoped custom style for code-only changes', async () => {
    const options = fixtureWithInitialCustomCss();
    const port = createWordPressAppearancePort(options);
    const customStyle = document.querySelector<HTMLStyleElement>(
      '#easymde-custom-css-preview'
    );
    const customSheet = customStyle?.sheet;
    if (!customStyle || !customSheet) throw new Error('test-custom-style-missing');
    const originalText = customStyle.textContent;
    const originalAliasCount = editorAliasCount(customStyle);
    if (0 === originalAliasCount) throw new Error('test-custom-style-alias-missing');

    await expect(port.applyState({
      codeTheme: 'atom-one-dark',
      customCssId: 'writer-css',
      markdownTheme: 'custom'
    }, true)).resolves.toBe(true);

    expect(document.querySelector('#easymde-custom-css-preview')).toBe(customStyle);
    expect(customStyle.textContent).toBe(originalText);
    expect(customStyle.sheet).toBe(customSheet);
    expect(editorAliasCount(customStyle)).toBe(originalAliasCount);
    expect(options.fields.codeThemeExplicit.value).toBe('1');
    port.dispose();
  });

  it('commits a changed article theme only after its stylesheet loads', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    const activeLink = document.querySelector<HTMLLinkElement>(
      '#easymde-article-theme-css'
    );
    if (!activeLink) throw new Error('test-active-article-link-missing');
    const activeParent = activeLink.parentElement;
    const applied = port.applyState(
      { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
      false
    );
    const candidate = Array.from(document.head.querySelectorAll('link'))
      .find((link) => link.id !== 'easymde-article-theme-css');

    expect(candidate?.href).toBe(`${assetBaseUrl}assets/themes/article/newsprint.css`);
    expect(options.fields.markdownTheme.value).toBe('default');

    attachStylesheet(candidate);
    attachStylesheet(candidate);
    candidate?.dispatchEvent(new Event('load'));

    await expect(applied).resolves.toBe(true);
    expect(options.fields.markdownTheme.value).toBe('newsprint');
    expect(document.querySelector<HTMLLinkElement>('#easymde-article-theme-css'))
      .toBe(candidate);
    expect(activeLink.isConnected).toBe(false);
    expect(candidate?.parentElement).toBe(activeParent);
    expect(candidate?.href)
      .toBe(`${assetBaseUrl}assets/themes/article/newsprint.css`);
  });

  it('rejects a commit failure even when candidate lease cleanup fails', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    const activeLink = document.querySelector<HTMLLinkElement>(
      '#easymde-article-theme-css'
    );
    const activeSheet = activeLink?.sheet;
    const customStyle = document.querySelector<HTMLStyleElement>(
      '#easymde-custom-css-preview'
    );
    if (!activeLink || !activeSheet || !customStyle) {
      throw new Error('test-active-article-link-missing');
    }
    const originalCustomText = customStyle.textContent;
    const removeArticleLink = vi.spyOn(activeLink, 'remove').mockImplementation(() => {
      throw new Error('appearance-article-theme-dom-handoff-failed');
    });
    const candidateStyle = document.createElement('style');
    candidateStyle.textContent = '.easymde-rendered-content { color: green; }';
    document.head.append(candidateStyle);
    const candidateSheet = candidateStyle.sheet;
    if (!candidateSheet) throw new Error('test-candidate-style-missing');
    const candidateDispose = vi.fn(() => {
      throw new Error('appearance-candidate-dispose-failed');
    });
    Object.defineProperty(candidateSheet, 'deleteRule', {
      configurable: true,
      value: candidateDispose
    });

    try {
      const applied = port.applyState(
        { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
        false
      );
      const candidate = Array.from(document.head.querySelectorAll('link'))
        .find((link) => link !== activeLink);
      if (!candidate) throw new Error('test-article-candidate-missing');
      Object.defineProperty(candidate, 'sheet', {
        configurable: true,
        value: candidateSheet
      });
      candidate.dispatchEvent(new Event('load'));

      const error = await applied.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message)
        .toBe('appearance-article-theme-dom-handoff-failed');
      expect((error as Error & { cause?: Error }).cause?.message)
        .toBe('editor-stylesheet-rollback-failed');
      expect(candidateDispose).toHaveBeenCalledOnce();
      expect(candidate.isConnected).toBe(false);
      expect(document.querySelector('#easymde-article-theme-css')).toBe(activeLink);
      expect(customStyle.isConnected).toBe(true);
      expect(customStyle.textContent).toBe(originalCustomText);
      expect(options.fields.codeTheme.value).toBe('atom-one-dark');
      expect(options.fields.codeThemeExplicit.value).toBe('0');
      expect(options.fields.customCssId.value).toBe('');
      expect(options.fields.markdownTheme.value).toBe('default');
    } finally {
      removeArticleLink.mockRestore();
      try {
        port.dispose();
      } catch {
        // The injected lease intentionally fails on disposal.
      }
    }
  });

  it('preserves a scoped custom style when article preparation fails', async () => {
    const options = fixtureWithInitialCustomCss();
    const port = createWordPressAppearancePort(options);
    const customStyle = document.querySelector<HTMLStyleElement>(
      '#easymde-custom-css-preview'
    );
    const customSheet = customStyle?.sheet;
    if (!customStyle || !customSheet) throw new Error('test-custom-style-missing');
    const originalText = customStyle.textContent;
    const originalAliasCount = editorAliasCount(customStyle);
    if (0 === originalAliasCount) throw new Error('test-custom-style-alias-missing');

    const applied = port.applyState(
      { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
      false
    );
    const candidate = Array.from(document.head.querySelectorAll('link'))
      .find((link) => 'easymde-article-theme-css' !== link.id);
    if (!candidate) throw new Error('test-article-candidate-missing');
    Object.defineProperty(candidate, 'sheet', {
      configurable: true,
      value: {
        get cssRules(): CSSRuleList {
          throw new Error('synthetic-article-sheet-read-failed');
        }
      }
    });
    candidate.dispatchEvent(new Event('load'));

    await expect(applied).rejects.toThrowError('editor-stylesheet-read-failed');
    expect(customStyle).toBe(document.querySelector('#easymde-custom-css-preview'));
    expect(customStyle.isConnected).toBe(true);
    expect(customStyle.textContent).toBe(originalText);
    expect(customStyle.sheet).toBe(customSheet);
    expect(editorAliasCount(customStyle)).toBe(originalAliasCount);
    expect(candidate.isConnected).toBe(false);
    port.dispose();
  });

  it('keeps the old canonical link when its lease disposal fails', async () => {
    const options = fixtureWithInitialCustomCss();
    const port = createWordPressAppearancePort(options);
    const activeLink = document.querySelector<HTMLLinkElement>(
      '#easymde-article-theme-css'
    );
    const activeSheet = activeLink?.sheet;
    if (!activeLink || !activeSheet) throw new Error('test-active-article-link-missing');
    const originalMedia = activeLink.media;
    const customStyle = document.querySelector<HTMLStyleElement>(
      '#easymde-custom-css-preview'
    );
    if (!customStyle) throw new Error('test-custom-style-missing');
    const originalCustomText = customStyle.textContent;
    const activeDispose = vi.fn(() => {
      throw new Error('appearance-old-lease-dispose-failed');
    });
    Object.defineProperty(activeSheet, 'deleteRule', {
      configurable: true,
      value: activeDispose
    });

    try {
      const applied = port.applyState(
        { codeTheme: 'github', customCssId: '', markdownTheme: 'newsprint' },
        true
      );
      const candidate = Array.from(document.head.querySelectorAll('link'))
        .find((link) => link !== activeLink);
      if (!candidate) throw new Error('test-article-candidate-missing');
      attachStylesheet(candidate);
      candidate.dispatchEvent(new Event('load'));

      await expect(applied).rejects.toThrowError(
        'editor-stylesheet-rollback-failed'
      );
      expect(activeDispose).toHaveBeenCalledOnce();
      expect(candidate.isConnected).toBe(false);
      expect(document.querySelector('#easymde-article-theme-css')).toBe(activeLink);
      expect(activeLink.isConnected).toBe(true);
      expect(activeLink.media).toBe(originalMedia);
      expect(document.querySelector('#easymde-custom-css-preview')).toBe(customStyle);
      expect(customStyle.isConnected).toBe(true);
      expect(customStyle.textContent).toBe(originalCustomText);
      expect(options.fields.codeTheme.value).toBe('atom-one-dark');
      expect(options.fields.codeThemeExplicit.value).toBe('0');
      expect(options.fields.customCssId.value).toBe('writer-css');
      expect(options.fields.markdownTheme.value).toBe('custom');
      options.apiFetch.mockResolvedValueOnce({
        customCss: options.bootstrap.customCss,
        item: { id: 'writer-css' }
      });
      await expect(port.saveCustomCss({
        articleThemeName: 'Writer Article',
        codeThemeName: 'Writer Code',
        css: '.note { color: navy; }',
        id: 'writer-css'
      })).resolves.toMatchObject({
        snapshot: { state: { codeTheme: 'atom-one-dark', markdownTheme: 'custom' } },
        status: 'saved'
      });
      await expect(
        port.applyState(
          { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'default' },
          false
        )
      ).rejects.toThrowError('appearance-state-unverified');
    } finally {
      try {
        port.dispose();
      } catch {
        // The injected lease intentionally fails on disposal.
      }
    }
  });

  it('rejects stylesheet load failure without replacing the active theme', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    const activeLink = document.querySelector<HTMLLinkElement>(
      '#easymde-article-theme-css'
    );
    const applied = port.applyState(
      { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
      false
    );
    const candidate = Array.from(document.head.querySelectorAll('link'))
      .find((link) => link !== activeLink);

    attachStylesheet(candidate);
    candidate?.dispatchEvent(new Event('error'));

    await expect(applied).rejects.toThrowError(
      'appearance-article-theme-stylesheet-load-failed'
    );
    expect(document.querySelector('#easymde-article-theme-css')).toBe(activeLink);
    expect(options.fields.markdownTheme.value).toBe('default');
  });

  it('times out a stalled stylesheet without replacing the active theme', async () => {
    vi.useFakeTimers();
    try {
      const options = fixture();
      const port = createWordPressAppearancePort(options);
      const activeLink = document.querySelector<HTMLLinkElement>(
        '#easymde-article-theme-css'
      );
      const applied = port.applyState(
        { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
        false
      );
      const rejection = expect(applied).rejects.toThrowError(
        'appearance-article-theme-stylesheet-load-timeout'
      );

      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;

      expect(document.querySelector('#easymde-article-theme-css')).toBe(activeLink);
      expect(document.head.querySelectorAll('link')).toHaveLength(1);
      expect(options.fields.markdownTheme.value).toBe('default');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['load', 'error', 'cancel', 'dispose'] as const)(
    'clears the stylesheet timeout after %s',
    async (exit) => {
      vi.useFakeTimers();
      try {
        const options = fixture();
        const port = createWordPressAppearancePort(options);
        const applied = port.applyState(
          { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
          false
        );
        const candidate = Array.from(document.head.querySelectorAll('link'))
          .find((link) => link.id !== 'easymde-article-theme-css');

        if ('load' === exit) { attachStylesheet(candidate); candidate?.dispatchEvent(new Event('load')); }
        if ('error' === exit) candidate?.dispatchEvent(new Event('error'));
        if ('cancel' === exit) {
          await port.applyState(
            { codeTheme: 'github', customCssId: '', markdownTheme: 'default' },
            true
          );
        }
        if ('dispose' === exit) port.dispose();

        if ('error' === exit) {
          await expect(applied).rejects.toThrowError(
            'appearance-article-theme-stylesheet-load-failed'
          );
        } else {
          await expect(applied).resolves.toBe('load' === exit);
        }
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('lets only the latest rapid article-theme request commit', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    const first = port.applyState(
      { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
      false
    );
    const firstCandidate = Array.from(document.head.querySelectorAll('link'))
      .find((link) => link.id !== 'easymde-article-theme-css');
    const second = port.applyState(
      { codeTheme: 'github', customCssId: '', markdownTheme: 'default' },
      true
    );

    attachStylesheet(firstCandidate);
    firstCandidate?.dispatchEvent(new Event('load'));

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(options.fields.markdownTheme.value).toBe('default');
    expect(options.fields.codeTheme.value).toBe('github');
    expect(options.fields.codeThemeExplicit.value).toBe('1');
  });

  it('cancels a pending stylesheet without a late commit when disposed', async () => {
    const options = fixture();
    const port = createWordPressAppearancePort(options);
    const applied = port.applyState(
      { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'newsprint' },
      false
    );
    const candidate = Array.from(document.head.querySelectorAll('link'))
      .find((link) => link.id !== 'easymde-article-theme-css');

    port.dispose();
    candidate?.dispatchEvent(new Event('load'));

    await expect(applied).resolves.toBe(false);
    expect(candidate?.isConnected).toBe(false);
    expect(options.fields.markdownTheme.value).toBe('default');
  });

  it('uses the server snapshot after a successful Custom CSS mutation', async () => {
    const options = fixture();
    options.apiFetch.mockResolvedValue({
      customCss: [{
        articleThemeName: 'Saved Article', codeThemeName: 'Saved Code',
        css: '.saved { color: green; }', id: 'saved-css',
        scopedCss: '.easymde-rendered-content .saved { color: green; }'
      }],
      item: { id: 'saved-css' }
    });
    const port = createWordPressAppearancePort(options);

    await expect(port.saveCustomCss({
      articleThemeName: 'Saved Article',
      codeThemeName: 'Saved Code',
      css: '.saved { color: green; }',
      id: ''
    }))
      .resolves.toMatchObject({ status: 'saved', snapshot: { state: { customCssId: 'saved-css' } } });
    expect(options.apiFetch).toHaveBeenCalledWith({
      data: {
        articleThemeName: 'Saved Article',
        codeThemeName: 'Saved Code',
        css: '.saved { color: green; }',
        id: ''
      },
      headers: { 'X-WP-Nonce': 'synthetic-nonce' },
      method: 'POST',
      url: 'https://example.test/wp-json/easymde/v1/custom-css'
    });

    await expect(port.applyState({
      markdownTheme: 'custom',
      codeTheme: 'atom-one-dark',
      customCssId: 'saved-css'
    }, false)).resolves.toBe(true);
  });

  it('maps duplicate-name failures to a controlled code without exposing the REST message', async () => {
    const options = fixture();
    options.apiFetch.mockRejectedValue({
      code: 'easymde_duplicate_custom_css_name',
      message: 'Sensitive server detail'
    });
    const port = createWordPressAppearancePort(options);

    await expect(port.saveCustomCss({
      articleThemeName: 'Saved Article',
      codeThemeName: 'Saved Code',
      css: '.saved { color: green; }',
      id: ''
    })).resolves.toEqual({
      code: 'duplicate-name',
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
      articleThemeName: 'Saved Article',
      codeThemeName: 'Saved Code',
      css: '.saved { color: green; }',
      id: ''
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
    { bootstrap: { ...fixture().bootstrap, articleThemes: [{ cssUrl: 'https://remote.test/theme.css', id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark', markupProfile: 'common-v1' }] } },
    { bootstrap: { ...fixture().bootstrap, articleThemes: [{ cssUrl: `${assetBaseUrl}%2e%2e/%2e%2e/escape.css`, id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark', markupProfile: 'common-v1' }] } }
  ])('rejects remote or escaping runtime URLs', (override) => {
    expect(() => createWordPressAppearancePort({ ...fixture(), ...override }))
      .toThrowError();
  });
});
