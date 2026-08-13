import {
  parseAppearanceSnapshot,
  type AppearanceBootstrap,
  type AppearanceSnapshot,
  type AppearanceState,
  type CustomCssItem
} from '../../../contracts/bootstrap/appearance-bootstrap';
import type {
  AppearancePort,
  CustomCssPreviewResult,
  CustomCssSaveInput,
  CustomCssSaveResult
} from '../../../contracts/ports/appearance-port';
import type { WordPressApiFetch } from '../preview/create-wordpress-preview-port';

type AppearanceFields = Readonly<{
  codeTheme: HTMLInputElement;
  codeThemeExplicit: HTMLInputElement;
  customCssId: HTMLInputElement;
  markdownTheme: HTMLInputElement;
}>;

type CreateWordPressAppearancePortOptions = Readonly<{
  apiFetch: WordPressApiFetch;
  assetBaseUrl: string;
  bootstrap: AppearanceBootstrap;
  customCssUrl: string;
  document: Document;
  fields: AppearanceFields;
  nonce: string;
  siteUrl: string;
}>;

type PendingArticleTheme = Readonly<{
  cancel: () => void;
}>;

const CUSTOM_CSS_VALIDATION_ERRORS = new Set([
  'easymde_blocked_custom_css',
  'easymde_custom_css_too_large',
  'easymde_invalid_custom_css'
]);
const ARTICLE_THEME_STYLESHEET_LOAD_TIMEOUT_MS = 15_000;

function restErrorCode(error: unknown): string {
  if (!error || 'object' !== typeof error || Array.isArray(error)) return '';
  const code = (error as Record<string, unknown>).code;
  return 'string' === typeof code ? code : '';
}

function sameOriginUrl(value: string, siteUrl: string, code: string): string {
  try {
    const site = new URL(siteUrl);
    const url = new URL(value, site);
    if (
      !['http:', 'https:'].includes(site.protocol)
      || url.origin !== site.origin
      || url.username
      || url.password
      || url.hash
    ) {
      throw new Error(code);
    }
    return url.href;
  } catch {
    throw new Error(code);
  }
}

function localAssetUrl(value: string, assetBaseUrl: string): string {
  const base = new URL(assetBaseUrl);
  const url = new URL(value, base);
  const basePath = decodeURIComponent(
    base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  );
  const path = decodeURIComponent(url.pathname);
  const hasTraversal = (pathname: string) => pathname.includes('\\')
    || pathname.split('/').some((segment) => '.' === segment || '..' === segment);
  if (
    !['http:', 'https:'].includes(base.protocol)
    || url.protocol !== base.protocol
    || url.origin !== base.origin
    || url.username
    || url.password
    || url.hash
    || hasTraversal(basePath)
    || hasTraversal(path)
    || !path.startsWith(basePath)
  ) {
    throw new Error('appearance-article-theme-asset-invalid');
  }
  return url.href;
}

function selectedCustomCss(
  items: ReadonlyArray<CustomCssItem>,
  state: AppearanceState
): CustomCssItem | null {
  if ('custom' !== state.markdownTheme) return null;
  return items.find(({ id }) => id === state.customCssId) ?? null;
}

export function createWordPressAppearancePort({
  apiFetch,
  assetBaseUrl,
  bootstrap,
  customCssUrl,
  document,
  fields,
  nonce,
  siteUrl
}: CreateWordPressAppearancePortOptions): AppearancePort {
  if ('function' !== typeof apiFetch || !nonce) {
    throw new Error('appearance-wordpress-runtime-unavailable');
  }
  if (Object.values(fields).some((field) => !(field instanceof HTMLInputElement))) {
    throw new Error('appearance-native-fields-unavailable');
  }
  const endpoint = sameOriginUrl(
    customCssUrl,
    siteUrl,
    'appearance-custom-css-url-invalid'
  );
  const previewEndpoint = sameOriginUrl(
    `${endpoint.replace(/\/$/, '')}/preview`,
    siteUrl,
    'appearance-custom-css-preview-url-invalid'
  );
  const articleThemeUrls = new Map(bootstrap.articleThemes.map((theme) => {
    if (!theme.cssUrl) {
      throw new Error('appearance-article-theme-asset-unavailable');
    }
    return [theme.id, localAssetUrl(theme.cssUrl, assetBaseUrl)] as const;
  }));

  let snapshot: AppearanceSnapshot = {
    customCss: bootstrap.customCss,
    state: bootstrap.state
  };

  let disposed = false;
  let pendingArticleTheme: PendingArticleTheme | null = null;

  const resolveState = (state: AppearanceState) => {
    const customCss = selectedCustomCss(snapshot.customCss, state);
    if ('custom' === state.markdownTheme && !customCss) {
      throw new Error('appearance-custom-css-unavailable');
    }
    const articleTheme = bootstrap.articleThemes.find(
      ({ id }) => id === ('custom' === state.markdownTheme ? 'default' : state.markdownTheme)
    );
    const articleThemeUrl = articleTheme ? articleThemeUrls.get(articleTheme.id) : undefined;
    if (!articleThemeUrl) {
      throw new Error('appearance-article-theme-asset-unavailable');
    }

    let customStyle = document.getElementById('easymde-custom-css-preview');
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.id = 'easymde-custom-css-preview';
      document.head.append(customStyle);
    }
    if (!(customStyle instanceof HTMLStyleElement)) {
      throw new Error('appearance-custom-css-style-unavailable');
    }

    return { articleThemeUrl, customCss, customStyle };
  };

  const commitState = (
    state: AppearanceState,
    codeThemeExplicit: boolean,
    customCss: CustomCssItem | null,
    customStyle: HTMLStyleElement
  ): void => {
    customStyle.textContent = customCss?.scopedCss ?? '';

    fields.markdownTheme.value = state.markdownTheme;
    fields.codeTheme.value = state.codeTheme;
    fields.codeThemeExplicit.value = codeThemeExplicit ? '1' : '0';
    fields.customCssId.value = 'custom' === state.markdownTheme ? state.customCssId : '';
    snapshot = { ...snapshot, state };
  };

  const applyInitialState = (
    state: AppearanceState,
    codeThemeExplicit: boolean
  ): void => {
    const { articleThemeUrl, customCss, customStyle } = resolveState(state);

    const articleLink = document.getElementById('easymde-article-theme-css');
    if (!(articleLink instanceof HTMLLinkElement)) {
      throw new Error('appearance-article-theme-link-unavailable');
    }
    articleLink.href = articleThemeUrl;
    commitState(state, codeThemeExplicit, customCss, customStyle);
  };

  const applyState = async (
    state: AppearanceState,
    codeThemeExplicit: boolean
  ): Promise<boolean> => {
    if (disposed) {
      throw new Error('appearance-port-disposed');
    }
    const { articleThemeUrl, customCss, customStyle } = resolveState(state);
    const articleLink = document.getElementById('easymde-article-theme-css');
    if (!(articleLink instanceof HTMLLinkElement)) {
      throw new Error('appearance-article-theme-link-unavailable');
    }

    pendingArticleTheme?.cancel();
    pendingArticleTheme = null;

    if (articleLink.href === articleThemeUrl) {
      commitState(state, codeThemeExplicit, customCss, customStyle);
      return true;
    }

    return new Promise<boolean>((resolve, reject) => {
      const candidate = articleLink.cloneNode(false) as HTMLLinkElement;
      const activeMedia = articleLink.media;
      candidate.removeAttribute('id');
      candidate.media = 'not all';
      candidate.href = articleThemeUrl;

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (null !== timer) {
          clearTimeout(timer);
          timer = null;
        }
        candidate.removeEventListener('load', handleLoad);
        candidate.removeEventListener('error', handleError);
        if (pendingArticleTheme?.cancel === cancel) pendingArticleTheme = null;
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        candidate.remove();
        resolve(false);
      };
      const handleLoad = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (disposed) {
          candidate.remove();
          resolve(false);
          return;
        }
        commitState(state, codeThemeExplicit, customCss, customStyle);
        candidate.id = articleLink.id;
        candidate.media = activeMedia;
        articleLink.replaceWith(candidate);
        resolve(true);
      };
      const handleError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        candidate.remove();
        reject(new Error('appearance-article-theme-stylesheet-load-failed'));
      };
      const handleTimeout = () => {
        if (settled) return;
        settled = true;
        cleanup();
        candidate.remove();
        reject(new Error('appearance-article-theme-stylesheet-load-timeout'));
      };

      pendingArticleTheme = { cancel };
      candidate.addEventListener('load', handleLoad);
      candidate.addEventListener('error', handleError);
      timer = setTimeout(
        handleTimeout,
        ARTICLE_THEME_STYLESHEET_LOAD_TIMEOUT_MS
      );
      articleLink.after(candidate);
    });
  };

  applyInitialState(snapshot.state, bootstrap.codeThemeExplicit);

  return {
    applyState,
    cancelPendingApply: () => {
      pendingArticleTheme?.cancel();
      pendingArticleTheme = null;
    },
    closeOtherPopovers: () => undefined,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      pendingArticleTheme?.cancel();
      pendingArticleTheme = null;
    },
    async previewCustomCss(
      css: string,
      signal: AbortSignal
    ): Promise<CustomCssPreviewResult> {
      let response: unknown;
      try {
        response = await apiFetch({
          data: { css },
          headers: { 'X-WP-Nonce': nonce },
          method: 'POST',
          signal,
          url: previewEndpoint
        });
      } catch (error) {
        if (CUSTOM_CSS_VALIDATION_ERRORS.has(restErrorCode(error))) {
          return { status: 'invalid' };
        }
        throw error;
      }
      if (!response || 'object' !== typeof response || Array.isArray(response)) {
        throw new Error('custom-css-preview-response-invalid');
      }
      const scopedCss = (response as Record<string, unknown>).scopedCss;
      if ('string' !== typeof scopedCss || scopedCss.length > 250_000) {
        throw new Error('custom-css-preview-response-invalid');
      }
      return { scopedCss, status: 'ready' };
    },
    async saveCustomCss(input: CustomCssSaveInput): Promise<CustomCssSaveResult> {
      let response: unknown;
      try {
        response = await apiFetch({
          data: input,
          headers: { 'X-WP-Nonce': nonce },
          method: 'POST',
          url: endpoint
        });
      } catch (error) {
        if ('easymde_duplicate_custom_css_name' === restErrorCode(error)) {
          return {
            code: 'duplicate-name',
            status: 'failed'
          };
        }
        return { code: 'custom-css-save-failed', status: 'failed' };
      }

      if (!response || 'object' !== typeof response || Array.isArray(response)) {
        throw new Error('custom-css-response-invalid');
      }
      const result = response as Record<string, unknown>;
      if (!result.item || 'object' !== typeof result.item || Array.isArray(result.item)) {
        throw new Error('custom-css-response-invalid');
      }
      const item = result.item as Record<string, unknown>;
      const saved = parseAppearanceSnapshot({
        customCss: result.customCss,
        state: {
          codeTheme: snapshot.state.codeTheme,
          customCssId: item.id,
          markdownTheme: 'custom'
        }
      }, bootstrap);
      snapshot = { ...snapshot, customCss: saved.customCss };
      return { snapshot: saved, status: 'saved' };
    }
  };
}
