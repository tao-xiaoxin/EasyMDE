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
import {
  scopeEditorStyleElement,
  scopeEditorStylesheetLink,
  type EditorStylesheetScopeLease,
} from '../../../shared/css/editor-stylesheet-scope';

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
  editorRootSelector?: string;
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

function stableAppearanceErrorCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
    ? error.message
    : fallback;
}

function appearanceFailureWithRollback(
  error: unknown,
  fallback: string,
  rollbackError: unknown,
): Error {
  const primary =
    error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
      ? error
      : new Error(stableAppearanceErrorCode(error, fallback));
  if (!rollbackError) return primary;
  const rollback = new Error(
    stableAppearanceErrorCode(
      rollbackError,
      'appearance-article-theme-rollback-failed',
    ),
    { cause: rollbackError },
  );
  return new Error(primary.message, { cause: rollback });
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

export function resolveAppearanceArticleThemeUrl(
  bootstrap: AppearanceBootstrap,
  assetBaseUrl: string,
): string {
  const themeId =
    'custom' === bootstrap.state.markdownTheme
      ? 'default'
      : bootstrap.state.markdownTheme;
  const theme = bootstrap.articleThemes.find(({ id }) => id === themeId);
  if (!theme?.cssUrl)
    throw new Error('appearance-article-theme-asset-unavailable');
  return localAssetUrl(theme.cssUrl, assetBaseUrl);
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
  editorRootSelector = '#easymde-editor-root',
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
  let articleScopeLease: EditorStylesheetScopeLease | null = null;
  let customScopeLease: EditorStylesheetScopeLease | null = null;
  let customScopeElement: HTMLStyleElement | null = null;

  const disposeAppearanceLeases = (): Error | null => {
    let failure: Error | null = null;
    for (const dispose of [
      () => pendingArticleTheme?.cancel(),
      () => {
        const lease = articleScopeLease;
        articleScopeLease = null;
        lease?.dispose();
      },
      () => {
        const lease = customScopeLease;
        customScopeLease = null;
        customScopeElement = null;
        lease?.dispose();
      },
    ]) {
      try {
        dispose();
      } catch (error) {
        failure ??=
          error instanceof Error
            ? error
            : new Error('appearance-stylesheet-rollback-failed');
      }
    }
    pendingArticleTheme = null;
    return failure;
  };

  let stateUnverified = false;

  const captureFields = () => ({
    codeTheme: fields.codeTheme.value,
    codeThemeExplicit: fields.codeThemeExplicit.value,
    customCssId: fields.customCssId.value,
    markdownTheme: fields.markdownTheme.value
  });

  const restoreFields = (values: ReturnType<typeof captureFields>): void => {
    fields.codeTheme.value = values.codeTheme;
    fields.codeThemeExplicit.value = values.codeThemeExplicit;
    fields.customCssId.value = values.customCssId;
    fields.markdownTheme.value = values.markdownTheme;
  };

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

    const customStyle = document.getElementById('easymde-custom-css-preview');
    if (customStyle && !(customStyle instanceof HTMLStyleElement)) {
      throw new Error('appearance-custom-css-style-unavailable');
    }

    return {
      articleThemeUrl,
      customCss,
      customStyle: customStyle instanceof HTMLStyleElement ? customStyle : null
    };
  };

  const captureNode = (element: HTMLStyleElement | HTMLLinkElement | null) => ({
    element,
    id: element?.id ?? '',
    media: element?.media ?? '',
    nextSibling: element?.nextSibling ?? null,
    parent: element?.parentNode ?? null,
    sheet: element?.sheet ?? null,
    text: element instanceof HTMLStyleElement ? element.textContent ?? '' : null
  });

  const restoreNode = (
    state: ReturnType<typeof captureNode>,
    code: string
  ): boolean => {
    if (!state.element) return false;
    if (!state.element.isConnected) {
      if (!state.parent) throw new Error(code);
      state.parent.insertBefore(
        state.element,
        state.nextSibling && state.nextSibling.parentNode === state.parent
          ? state.nextSibling
          : null
      );
    }
    state.element.id = state.id;
    state.element.media = state.media;
    if (
      state.element instanceof HTMLStyleElement
      && null !== state.text
      && state.element.textContent !== state.text
    ) {
      state.element.textContent = state.text;
    }
    return state.sheet !== state.element.sheet;
  };

  const createCustomStyleCandidate = (
    previous: HTMLStyleElement | null,
    text: string
  ): HTMLStyleElement => {
    const candidate = document.createElement('style');
    candidate.media = 'not all';
    candidate.textContent = text;
    if (previous?.parentNode) previous.after(candidate);
    else document.head.append(candidate);
    return candidate;
  };

  const commitPreparedState = (
    state: AppearanceState,
    codeThemeExplicit: boolean,
    resolved: ReturnType<typeof resolveState>,
    articleLink: HTMLLinkElement,
    articleCandidate: HTMLLinkElement | null
  ): void => {
    if (stateUnverified) throw new Error('appearance-state-unverified');
    const previousFields = captureFields();
    const previousSnapshot = snapshot;
    const previousArticle = captureNode(articleLink);
    const previousCustom = captureNode(resolved.customStyle);
    const previousArticleLease = articleScopeLease;
    const previousCustomLease = customScopeLease;
    const previousCustomScopeElement = customScopeElement;
    const customText = resolved.customCss?.scopedCss ?? '';
    const reuseCustomStyle = Boolean(
      resolved.customStyle
      && previousCustomLease
      && previousCustomScopeElement === resolved.customStyle
      && previousCustom.text === customText
    );
    const customCandidate = reuseCustomStyle
      ? null
      : createCustomStyleCandidate(resolved.customStyle, customText);
    let nextArticleScope: EditorStylesheetScopeLease | null = null;
    let nextCustomScope: EditorStylesheetScopeLease | null = null;
    let articleLeaseDisposed = false;
    let customLeaseDisposed = false;
    let articleLeaseUntrusted = false;
    let customLeaseUntrusted = false;

    try {
      if (articleCandidate) {
        nextArticleScope = scopeEditorStylesheetLink(articleCandidate, {
          rootSelector: editorRootSelector
        });
      } else if (!previousArticleLease) {
        nextArticleScope = scopeEditorStylesheetLink(articleLink, {
          rootSelector: editorRootSelector
        });
      }
      if (customCandidate) {
        nextCustomScope = scopeEditorStyleElement(customCandidate, {
          rootSelector: editorRootSelector
        });
      }

      if (articleCandidate && previousArticleLease) {
        articleScopeLease = null;
        articleLeaseUntrusted = true;
        previousArticleLease.dispose();
        articleLeaseDisposed = true;
        articleLeaseUntrusted = false;
      }
      if (!reuseCustomStyle && previousCustomLease) {
        customScopeLease = null;
        customScopeElement = null;
        customLeaseUntrusted = true;
        previousCustomLease.dispose();
        customLeaseDisposed = true;
        customLeaseUntrusted = false;
      }

      if (articleCandidate) {
        articleLink.removeAttribute('id');
        articleCandidate.id = previousArticle.id;
        articleCandidate.media = previousArticle.media;
        articleLink.remove();
      }
      if (customCandidate) {
        if (resolved.customStyle) {
          resolved.customStyle.removeAttribute('id');
          customCandidate.id = previousCustom.id;
          customCandidate.media = previousCustom.media;
          resolved.customStyle.remove();
        } else {
          customCandidate.id = 'easymde-custom-css-preview';
          customCandidate.media = '';
        }
      }

      articleScopeLease = nextArticleScope ?? previousArticleLease;
      customScopeLease = customCandidate ? nextCustomScope : previousCustomLease;
      customScopeElement = customCandidate && nextCustomScope
        ? customCandidate
        : previousCustomScopeElement;
      nextArticleScope = null;
      nextCustomScope = null;
      fields.markdownTheme.value = state.markdownTheme;
      fields.codeTheme.value = state.codeTheme;
      fields.codeThemeExplicit.value = codeThemeExplicit ? '1' : '0';
      fields.customCssId.value = 'custom' === state.markdownTheme ? state.customCssId : '';
      snapshot = { ...snapshot, state };
    } catch (error) {
      let rollbackError: unknown = null;
      let articleSheetChanged = false;
      let customSheetChanged = false;
      restoreFields(previousFields);
      snapshot = previousSnapshot;
      try {
        articleSheetChanged = restoreNode(
          previousArticle,
          'appearance-article-theme-rollback-failed'
        );
      } catch (restoreArticleError) {
        rollbackError = restoreArticleError;
      }
      try {
        customSheetChanged = restoreNode(
          previousCustom,
          'appearance-custom-css-rollback-failed'
        );
      } catch (restoreCustomError) {
        rollbackError ??= restoreCustomError;
      }
      try {
        articleCandidate?.remove();
      } catch (removeCandidateError) {
        rollbackError ??= removeCandidateError;
      }
      try {
        customCandidate?.remove();
      } catch (removeCustomError) {
        rollbackError ??= removeCustomError;
      }
      try {
        nextArticleScope?.dispose();
      } catch (disposeArticleError) {
        rollbackError ??= disposeArticleError;
      }
      try {
        nextCustomScope?.dispose();
      } catch (disposeCustomError) {
        rollbackError ??= disposeCustomError;
      }
      if (
        previousArticle.element?.isConnected
        && (articleLeaseDisposed || (articleSheetChanged && previousArticleLease))
      ) {
        if (!articleLeaseDisposed && previousArticleLease) {
          articleScopeLease = null;
          articleLeaseUntrusted = true;
          try {
            previousArticleLease.dispose();
            articleLeaseUntrusted = false;
          } catch (restoreArticleLeaseError) {
            rollbackError ??= restoreArticleLeaseError;
          }
        }
        if (!articleLeaseUntrusted) {
          try {
            articleScopeLease = scopeEditorStylesheetLink(articleLink, {
              rootSelector: editorRootSelector
            });
          } catch (restoreArticleScopeError) {
            rollbackError ??= restoreArticleScopeError;
          }
        }
      } else if (!articleCandidate) {
        articleScopeLease = previousArticleLease;
      }
      if (
        previousCustom.element?.isConnected
        && (customLeaseDisposed || (customSheetChanged && previousCustomLease))
      ) {
        if (!customLeaseDisposed && previousCustomLease) {
          customScopeLease = null;
          customScopeElement = null;
          customLeaseUntrusted = true;
          try {
            previousCustomLease.dispose();
            customLeaseUntrusted = false;
          } catch (restoreCustomLeaseError) {
            rollbackError ??= restoreCustomLeaseError;
          }
        }
        if (!customLeaseUntrusted) {
          try {
            customScopeLease = scopeEditorStyleElement(previousCustom.element, {
              rootSelector: editorRootSelector
            });
            customScopeElement = previousCustom.element;
          } catch (restoreCustomScopeError) {
            rollbackError ??= restoreCustomScopeError;
          }
        }
      } else if (!previousCustom.element) {
        customScopeLease = null;
        customScopeElement = null;
      } else if (!customLeaseDisposed) {
        customScopeLease = previousCustomLease;
        customScopeElement = previousCustomScopeElement;
      }
      if (articleLeaseUntrusted || customLeaseUntrusted || rollbackError) {
        stateUnverified = true;
      }
      throw appearanceFailureWithRollback(
        error,
        'appearance-article-theme-scope-failed',
        rollbackError
      );
    }
  };

  const applyInitialState = (
    state: AppearanceState,
    codeThemeExplicit: boolean
  ): void => {
    const resolved = resolveState(state);
    const articleLink = document.getElementById('easymde-article-theme-css');
    if (!(articleLink instanceof HTMLLinkElement)) {
      throw new Error('appearance-article-theme-link-unavailable');
    }
    if (articleLink.href !== resolved.articleThemeUrl) {
      throw new Error('appearance-initial-article-theme-stylesheet-not-ready');
    }
    commitPreparedState(state, codeThemeExplicit, resolved, articleLink, null);
  };

  const applyState = async (
    state: AppearanceState,
    codeThemeExplicit: boolean
  ): Promise<boolean> => {
    if (disposed) throw new Error('appearance-port-disposed');
    if (stateUnverified) throw new Error('appearance-state-unverified');
    const resolved = resolveState(state);
    const articleLink = document.getElementById('easymde-article-theme-css');
    if (!(articleLink instanceof HTMLLinkElement)) {
      throw new Error('appearance-article-theme-link-unavailable');
    }

    pendingArticleTheme?.cancel();
    pendingArticleTheme = null;
    if (articleLink.href === resolved.articleThemeUrl) {
      commitPreparedState(state, codeThemeExplicit, resolved, articleLink, null);
      return true;
    }

    return new Promise<boolean>((resolve, reject) => {
      const candidate = articleLink.cloneNode(false) as HTMLLinkElement;
      candidate.removeAttribute('id');
      candidate.media = 'not all';
      candidate.href = resolved.articleThemeUrl;
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
        try {
          commitPreparedState(state, codeThemeExplicit, resolved, articleLink, candidate);
          resolve(true);
        } catch (error) {
          if (candidate.isConnected) candidate.remove();
          reject(error);
        }
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
      timer = setTimeout(handleTimeout, ARTICLE_THEME_STYLESHEET_LOAD_TIMEOUT_MS);
      articleLink.after(candidate);
    });
  };
  try {
    applyInitialState(snapshot.state, bootstrap.codeThemeExplicit);
  } catch (error) {
    const cleanupFailure = disposeAppearanceLeases();
    throw cleanupFailure ?? error;
  }

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
      const cleanupFailure = disposeAppearanceLeases();
      if (cleanupFailure) throw cleanupFailure;
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
