import {
  parseAppearanceSnapshot,
  type AppearanceBootstrap,
  type AppearanceSnapshot,
  type AppearanceState,
  type CustomCssItem
} from '../../../contracts/bootstrap/appearance-bootstrap';
import type {
  AppearancePort,
  CustomCssSaveInput,
  CustomCssSaveResult
} from '../../../contracts/ports/appearance-port';
import type { WordPressApiFetch } from '../preview/create-wordpress-preview-port';

type AppearanceFields = Readonly<{
  codeTheme: HTMLInputElement;
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

  const applyState = (state: AppearanceState): void => {
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

    const articleLink = document.getElementById('easymde-article-theme-css');
    if (!(articleLink instanceof HTMLLinkElement)) {
      throw new Error('appearance-article-theme-link-unavailable');
    }
    articleLink.href = articleThemeUrl;

    let customStyle = document.getElementById('easymde-custom-css-preview');
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.id = 'easymde-custom-css-preview';
      document.head.append(customStyle);
    }
    if (!(customStyle instanceof HTMLStyleElement)) {
      throw new Error('appearance-custom-css-style-unavailable');
    }
    customStyle.textContent = customCss?.scopedCss ?? '';

    fields.markdownTheme.value = state.markdownTheme;
    fields.codeTheme.value = state.codeTheme;
    fields.customCssId.value = 'custom' === state.markdownTheme ? state.customCssId : '';
    snapshot = { ...snapshot, state };
  };

  return {
    applyState,
    closeOtherPopovers: () => undefined,
    async saveCustomCss(input: CustomCssSaveInput): Promise<CustomCssSaveResult> {
      let response: unknown;
      try {
        response = await apiFetch({
          data: input,
          headers: { 'X-WP-Nonce': nonce },
          method: 'POST',
          url: endpoint
        });
      } catch {
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
      const next = parseAppearanceSnapshot({
        customCss: result.customCss,
        state: {
          codeTheme: snapshot.state.codeTheme,
          customCssId: item.id,
          markdownTheme: 'custom'
        }
      }, bootstrap);
      snapshot = next;
      return { snapshot: next, status: 'saved' };
    }
  };
}
