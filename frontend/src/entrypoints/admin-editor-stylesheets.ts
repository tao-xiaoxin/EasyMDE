import type { EditorRootBootstrap } from '../contracts/bootstrap/editor-root-bootstrap';
import { resolveAppearanceArticleThemeUrl } from '../integrations/wordpress/appearance/create-wordpress-appearance-port';
import {
  createEditorStylesheetReadiness,
  EDITOR_STYLESHEET_SCOPE,
  scopeEditorStyleElement,
  scopeEditorStylesheet,
  scopeEditorStylesheetLink,
  type EditorStylesheetElement,
  type EditorStylesheetScopeLease
} from '../shared/css/editor-stylesheet-scope';

export type PreparedInitialStylesheets = {
  provisional: () => void;
  commit: () => void;
  release: () => void;
  rollback: () => void;
};

export type InitialStylesheetPreparation = Readonly<{
  cancel: () => void;
  run: (
    onReady: (prepared: PreparedInitialStylesheets) => void,
    onError: (error: Error) => void
  ) => () => void;
}>;

export function startupFailureCode(error: unknown): string {
  return error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
    ? error.message
    : 'react-editor-startup-failed';
}

export function normalizeCleanupError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('react-editor-startup-rollback-failed');
}

export function runCleanupSteps(
  steps: ReadonlyArray<() => void>
): Error | null {
  let failure: Error | null = null;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failure ??= normalizeCleanupError(error);
    }
  }
  return failure;
}

export function disposeStylesheetLeases(
  leases: ReadonlyArray<EditorStylesheetScopeLease>
): Error | null {
  let failure: Error | null = null;
  for (const lease of [...leases].reverse()) {
    try {
      lease.dispose();
    } catch (error) {
      failure ??= error instanceof Error
        ? error
        : new Error('editor-stylesheet-rollback-failed');
    }
  }
  return failure;
}

export function editorStylesheetElement(
  value: Element | null,
  code: string
): EditorStylesheetElement {
  if (
    value instanceof HTMLLinkElement
    || value instanceof HTMLStyleElement
  ) return value;
  throw new Error(code);
}

export function scopeBaseEditorStylesheet(
  documentRef: Document
): EditorStylesheetScopeLease {
  const baseStylesheet = editorStylesheetElement(
    documentRef.getElementById('easymde-content-css'),
    'editor-content-stylesheet-unavailable'
  );
  return baseStylesheet instanceof HTMLLinkElement
    ? scopeEditorStylesheetLink(baseStylesheet, {
        rootSelector: EDITOR_STYLESHEET_SCOPE
      })
    : scopeEditorStyleElement(baseStylesheet, {
        rootSelector: EDITOR_STYLESHEET_SCOPE
      });
}

export function prepareInitialEditorStylesheets(
  bootstrap: EditorRootBootstrap,
  documentRef: Document
): InitialStylesheetPreparation {
  const base = editorStylesheetElement(
    documentRef.getElementById('easymde-content-css'),
    'editor-content-stylesheet-unavailable'
  );
  const articleElement = documentRef.querySelector('#easymde-article-theme-css');
  if (!(articleElement instanceof HTMLLinkElement)) {
    throw new Error('appearance-article-theme-link-unavailable');
  }
  const article = articleElement;
  const targetUrl = resolveAppearanceArticleThemeUrl(
    bootstrap.appearance,
    bootstrap.previewEnhancement.assetBaseUrl
  );
  const candidate = article.href === targetUrl
    ? null
    : article.cloneNode(false) as HTMLLinkElement;
  const originalId = article.id;
  const activeMedia = article.media;
  if (candidate) {
    candidate.removeAttribute('id');
    candidate.media = 'not all';
    candidate.href = targetUrl;
    article.after(candidate);
  }
  const owner = candidate ?? article;
  const gate = createEditorStylesheetReadiness([base, owner]);
  let candidateLease: EditorStylesheetScopeLease | null = null;
  let prepared: PreparedInitialStylesheets | null = null;
  let transferred = false;
  let cancelled = false;

  const disposeCandidateLease = (): void => {
    const lease = candidateLease;
    candidateLease = null;
    lease?.dispose();
  };

  const cleanupUnprepared = (): Error | null =>
    runCleanupSteps([
      disposeCandidateLease,
      () => candidate?.remove(),
      () => {
        article.id = originalId;
        article.media = activeMedia;
      }
    ]);

  const createPrepared = (): PreparedInitialStylesheets => {
    let phase: 'pending' | 'provisional' | 'committed' | 'closed' = 'pending';
    return {
      provisional: () => {
        if ('closed' === phase) return;
        if ('provisional' === phase || 'committed' === phase) return;
        try {
          if (candidate) {
            article.removeAttribute('id');
            candidate.id = originalId;
            candidate.media = activeMedia;
          }
          phase = 'provisional';
        } catch (error) {
          article.id = originalId;
          article.media = activeMedia;
          throw error;
        }
      },
      commit: () => {
        if ('closed' === phase || 'committed' === phase) return;
        if ('pending' === phase) {
          throw new Error('editor-stylesheet-provisional-required');
        }
        if (candidate) article.remove();
        phase = 'committed';
      },
      release: () => {
        if ('closed' === phase) return;
        if ('committed' !== phase) {
          throw new Error('editor-stylesheet-release-before-commit');
        }
        phase = 'closed';
        disposeCandidateLease();
      },
      rollback: () => {
        if ('closed' === phase) return;
        if ('committed' === phase) {
          phase = 'closed';
          disposeCandidateLease();
          return;
        }
        const failure = runCleanupSteps([
          disposeCandidateLease,
          () => candidate?.remove(),
          () => {
            article.id = originalId;
            article.media = activeMedia;
          }
        ]);
        phase = 'closed';
        if (failure) throw failure;
      }
    };
  };

  const rollbackPreparation = (): Error | null => {
    if (prepared) {
      try {
        if (transferred) prepared.release();
        else prepared.rollback();
      } catch (error) {
        return normalizeCleanupError(error);
      }
      return null;
    }
    return cleanupUnprepared();
  };

  const fail = (error: Error, onError: (error: Error) => void): void => {
    if (cancelled) return;
    cancelled = true;
    const cleanupFailure = rollbackPreparation();
    try {
      gate.cancel();
    } catch (cancelError) {
      onError(normalizeCleanupError(cancelError));
      return;
    }
    onError(cleanupFailure ?? error);
  };
  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      const cleanupFailure = rollbackPreparation();
      try {
        gate.cancel();
      } catch (error) {
        throw normalizeCleanupError(error);
      }
      if (cleanupFailure) throw cleanupFailure;
    },
    run: (onReady, onError) => gate.run((sheets) => {
      if (cancelled) return;
      try {
        if (candidate) {
          const sheet = sheets.get(candidate);
          if (!sheet) throw new Error('editor-article-stylesheet-unavailable');
          candidateLease = scopeEditorStylesheet(sheet, {
            rootSelector: EDITOR_STYLESHEET_SCOPE
          });
        }
        prepared = createPrepared();
        prepared.provisional();
        onReady(prepared);
        transferred = true;
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error('editor-stylesheet-startup-failed'),
          onError
        );
      }
    }, (error) => {
      if (cancelled) return;
      fail(error, onError);
    })
  };
}
