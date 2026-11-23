import type { PreviewEnhancementBootstrap } from '../../contracts/bootstrap/preview-enhancement-bootstrap';
import type { PreviewFeatures } from '../../contracts/ports/preview-request';
import type {
  PreparedCodeTheme,
  PreviewEnhancementContext,
  PreviewEnhancementPort
} from '../../features/live-preview/ports/preview-enhancement-port';
import { resourceError } from './browser-preview-enhancement-resource-helpers';
import { createPreviewScriptLoader } from './browser-preview-enhancement-script-loader';
import {
  createPreviewStylesheetLoader,
  type PreparedStyleOwner
} from './browser-preview-enhancement-stylesheet-loader';
import type { FrontendEnhancementControl } from './frontend-enhancement-runtime';

type SharedEnhancements = Readonly<{
  enhance: (
    surface: HTMLElement,
    config: Readonly<{
      assetErrors?: Readonly<{ mermaid?: string }>;
      features: PreviewFeatures;
      strings: Readonly<{ renderingFailed: string }>;
    }>,
    control?: FrontendEnhancementControl
  ) => Promise<unknown> | unknown;
  syncCodeFrameBackgrounds: (surface: HTMLElement) => void;
}>;

export type PreviewEnhancementBrowserRuntime = Readonly<{
  getEnhancements: () => SharedEnhancements | null;
  hasHighlight: () => boolean;
  hasKatex: () => boolean;
  hasMathRenderer: () => boolean;
  hasMermaid: () => boolean;
  hasMermaidRenderer: () => boolean;
  warmHighlightAuto: (signal: AbortSignal) => Promise<boolean>;
}>;

type BrowserPreviewEnhancementOptions = Readonly<{
  documentRef: Document;
  runtime: PreviewEnhancementBrowserRuntime;
}>;

function createResourceLoader(documentRef: Document) {
  let disposed = false;
  const isDisposed = () => disposed;
  const scriptLoader = createPreviewScriptLoader(documentRef, isDisposed);
  const stylesheetLoader = createPreviewStylesheetLoader(documentRef, isDisposed);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scriptLoader.dispose();
    stylesheetLoader.dispose();
  }

  return {
    dispose,
    loadExternalScript: scriptLoader.loadExternalScript,
    loadScript: scriptLoader.loadScript,
    loadStylesheet: stylesheetLoader.loadStylesheet,
    prepareStylesheet: stylesheetLoader.prepareStylesheet
  };
}

async function loadRuntime(
  available: () => boolean,
  load: () => Promise<void>
): Promise<void> {
  if (available()) return;
  await load();
  if (!available()) {
    throw resourceError('preview-enhancement-runtime-unavailable');
  }
}

export function createBrowserPreviewEnhancementPort(
  bootstrap: PreviewEnhancementBootstrap,
  options: BrowserPreviewEnhancementOptions
): PreviewEnhancementPort {
  const loader = createResourceLoader(options.documentRef);
  const assets = bootstrap.assets;

  async function prepareCodeThemeForOwner(
    context: PreviewEnhancementContext,
    owner: PreparedStyleOwner
  ): Promise<PreparedCodeTheme> {
    const theme = bootstrap.codeThemes.find(({ id }) => id === context.codeTheme);
    if (!theme) throw resourceError('preview-enhancement-code-theme-missing');
    const preparation = loader.prepareStylesheet(
      assets.highlightThemeLinkId,
      theme.cssUrl,
      context.signal,
      owner
    );
    try {
      const [prepared] = await Promise.all([
        preparation.promise,
        loader.loadStylesheet(
          assets.codeFrameLinkId,
          assets.codeFrameCssUrl,
          context.signal
        )
      ]);
      return prepared;
    } catch (error) {
      preparation.cancel();
      throw error;
    }
  }

  async function prepareCodeTheme(
    context: PreviewEnhancementContext
  ): Promise<PreparedCodeTheme> {
    const prepared = await prepareCodeThemeForOwner(context, 'activation');
    try {
      await loadRuntime(options.runtime.hasHighlight, () =>
        loader.loadScript(
          'easymde-highlight-js',
          assets.highlightScriptUrl,
          context.signal
        ));
      const warmed = await options.runtime.warmHighlightAuto(context.signal);
      if (context.signal.aborted) {
        throw resourceError('preview-enhancement-resource-stale');
      }
      if (!warmed) {
        throw resourceError('preview-enhancement-runtime-unavailable');
      }
      return prepared;
    } catch (error) {
      prepared.cancel();
      throw error;
    }
  }

  async function prepareHighlight(codeTheme: string, signal: AbortSignal): Promise<void> {
    const preparedCodeTheme = await prepareCodeThemeForOwner(
      { codeTheme, signal },
      'enhancement'
    );
    try {
      await loadRuntime(options.runtime.hasHighlight, () =>
        loader.loadScript('easymde-highlight-js', assets.highlightScriptUrl, signal));
    } catch (error) {
      preparedCodeTheme.cancel();
      throw error;
    }
    if (signal.aborted) {
      preparedCodeTheme.cancel();
      throw resourceError('preview-enhancement-resource-stale');
    }
    preparedCodeTheme.commit();
  }

  async function prepareMath(
    signal: AbortSignal,
    sharedRuntime: Promise<void>
  ): Promise<void> {
    await Promise.all([
      loader.loadStylesheet(assets.mathCssLinkId, assets.mathCssUrl, signal),
      loader.loadStylesheet(assets.katexCssLinkId, assets.katexCssUrl, signal),
      loadRuntime(options.runtime.hasKatex, () =>
        loader.loadScript('easymde-katex-js', assets.katexScriptUrl, signal)),
      sharedRuntime
    ]);
    if (!options.runtime.hasMathRenderer()) {
      throw resourceError('preview-enhancement-runtime-unavailable');
    }
  }

  async function prepareMermaid(
    signal: AbortSignal,
    sharedRuntime: Promise<void>
  ): Promise<void> {
    const mermaidScriptUrl = assets.mermaidScriptUrl;
    if (!mermaidScriptUrl) {
      throw resourceError('preview-enhancement-mermaid-runtime-unavailable');
    }
    await Promise.all([
      loadRuntime(options.runtime.hasMermaid, () =>
        loader.loadScript('easymde-mermaid-js', mermaidScriptUrl, signal)),
      sharedRuntime
    ]);
    if (!options.runtime.hasMermaidRenderer()) {
      throw resourceError('preview-enhancement-runtime-unavailable');
    }
  }

  return {
    dispose: loader.dispose,
    prepareCodeTheme,
    syncCodeFrameBackgrounds(surface) {
      const enhancements = options.runtime.getEnhancements();
      if (!enhancements) {
        throw resourceError('preview-enhancement-runtime-unavailable');
      }
      enhancements.syncCodeFrameBackgrounds(surface);
    },
    async enhance(surface, features, isCurrent, context) {
      if (!isCurrent() || context.signal.aborted) return;
      const mermaidAssetFailure = !!assets.mermaidAssetError && !!features.mermaid;
      const fallbackFeatures = mermaidAssetFailure
        ? { ...features, mermaid: false }
        : features;
      const tasks: Promise<void>[] = [];
      const hasExecutableEnhancement = !!(
        fallbackFeatures.syntaxHighlight
        || fallbackFeatures.math
        || fallbackFeatures.mermaid
        || mermaidAssetFailure
      );
      const sharedController = hasExecutableEnhancement
        ? new AbortController()
        : null;
      let removeSharedAbortListener: (() => void) | null = null;
      if (sharedController) {
        const forwardAbort = () => sharedController.abort();
        if (context.signal.aborted) {
          sharedController.abort();
        } else {
          context.signal.addEventListener('abort', forwardAbort, { once: true });
          removeSharedAbortListener = () => {
            context.signal.removeEventListener('abort', forwardAbort);
          };
        }
      }
      const sharedRuntime = hasExecutableEnhancement
        ? loadRuntime(
          () => !!options.runtime.getEnhancements(),
          () => loader.loadExternalScript(
            'easymde-enhancements-js',
            assets.mathRendererUrl,
            sharedController?.signal ?? context.signal,
            () => !!options.runtime.getEnhancements()
          )
        )
        : null;
      if (sharedRuntime) tasks.push(sharedRuntime);

      if (fallbackFeatures.syntaxHighlight) {
        tasks.push(prepareHighlight(context.codeTheme, context.signal));
      } else if (mermaidAssetFailure) {
        tasks.push(
          prepareCodeThemeForOwner(context, 'enhancement')
            .then((prepared) => prepared.commit())
        );
      }
      if (fallbackFeatures.math) {
        if (!sharedRuntime) {
          throw resourceError('preview-enhancement-runtime-unavailable');
        }
        tasks.push(prepareMath(context.signal, sharedRuntime));
      }
      if (fallbackFeatures.mermaid) {
        if (!sharedRuntime) {
          throw resourceError('preview-enhancement-runtime-unavailable');
        }
        tasks.push(prepareMermaid(context.signal, sharedRuntime));
      }
      if (fallbackFeatures.toc) {
        tasks.push(
          loader.loadStylesheet(assets.tocCssLinkId, assets.tocCssUrl, context.signal)
        );
      }
      if (!tasks.length) return;

      try {
        await Promise.all(tasks);
      } catch (error) {
        sharedController?.abort();
        await sharedRuntime?.catch(() => undefined);
        throw error;
      } finally {
        removeSharedAbortListener?.();
      }
      if (!isCurrent() || context.signal.aborted || !hasExecutableEnhancement) return;
      const enhancements = options.runtime.getEnhancements();
      if (!enhancements) {
        throw resourceError('preview-enhancement-runtime-unavailable');
      }
      await enhancements.enhance(surface, {
        ...(mermaidAssetFailure
          ? { assetErrors: { mermaid: assets.mermaidAssetError } }
          : {}),
        features: fallbackFeatures,
        strings: bootstrap.strings
      }, { isCurrent, signal: context.signal });
      if (!isCurrent() || context.signal.aborted) return;
      if (surface.querySelector('.easymde-render-error')) {
        throw resourceError('preview-enhancement-render-failed');
      }
      if (mermaidAssetFailure) {
        throw resourceError('preview-enhancement-mermaid-asset-contract-failed');
      }
    }
  };
}

declare global {
  interface Window {
    EasyMDEEnhancements?: SharedEnhancements;
    EasyMDEMathRenderer?: unknown;
    EasyMDEMermaidRenderer?: unknown;
    hljs?: unknown;
    katex?: unknown;
    mermaid?: unknown;
  }
}

export function createWindowPreviewEnhancementRuntime(
  windowRef: Window
): PreviewEnhancementBrowserRuntime {
  type HighlightWarmRuntime = Readonly<{
    highlight: (
      code: string,
      options: Readonly<{ ignoreIllegals: boolean; language: string }>
    ) => unknown;
    listLanguages: () => string[];
  }>;
  let warmedHighlightRuntime: HighlightWarmRuntime | null = null;
  return {
    getEnhancements: () => windowRef.EasyMDEEnhancements ?? null,
    hasHighlight: () => !!windowRef.hljs,
    hasKatex: () => !!windowRef.katex,
    hasMathRenderer: () => !!windowRef.EasyMDEMathRenderer,
    hasMermaid: () => !!windowRef.mermaid,
    hasMermaidRenderer: () => !!windowRef.EasyMDEMermaidRenderer,
    async warmHighlightAuto(signal) {
      const highlight = windowRef.hljs as HighlightWarmRuntime | undefined;
      if (!highlight) return false;
      if (warmedHighlightRuntime === highlight) return true;
      const languages = highlight.listLanguages();
      for (let index = 0; index < languages.length; index += 1) {
        if (signal.aborted) return false;
        const language = languages[index];
        if (undefined === language) return false;
        highlight.highlight('', { ignoreIllegals: true, language });
        const hasMore = index < languages.length - 1;
        if (hasMore) {
          await new Promise<void>((resolve) => windowRef.setTimeout(resolve, 0));
        }
      }
      if (signal.aborted) return false;
      warmedHighlightRuntime = highlight;
      return true;
    }
  };
}
