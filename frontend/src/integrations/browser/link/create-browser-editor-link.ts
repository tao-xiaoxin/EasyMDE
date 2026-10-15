import type {
  EditorLinkPort,
  EditorLinkResult
} from '../../../contracts/ports/editor-link-port';

export type BrowserEditorLinkRuntime = Readonly<{
  baseUrl?: string;
  open: (
    href: string,
    target: string,
    features: string
  ) => unknown;
}>;

function failed(code: Exclude<EditorLinkResult, { status: 'requested' }>['code']): EditorLinkResult {
  return { code, status: 'failed' };
}

function parsedHref(href: string, baseUrl: string | undefined): URL | null {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return null;
  try {
    const parsed = new URL(href, baseUrl);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol)
      && ('mailto:' === parsed.protocol || (!parsed.username && !parsed.password))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function createBrowserEditorLink(
  runtime: BrowserEditorLinkRuntime | null | undefined =
    'undefined' !== typeof window && 'function' === typeof window.open
      ? {
          baseUrl: window.location.href,
          open: (href, target, features) => window.open(href, target, features)
        }
      : null
): EditorLinkPort {
  let active = true;
  return {
    dispose() {
      active = false;
    },
    open(href) {
      if (!active) return failed('editor-link-disposed');
      const parsed = parsedHref(href, runtime?.baseUrl);
      if (!parsed) return failed('editor-link-invalid');
      if (!runtime) return failed('editor-link-open-failed');
      try {
        runtime.open(parsed.href, '_blank', 'noopener,noreferrer');
        return { status: 'requested' };
      } catch {
        return failed('editor-link-open-failed');
      }
    }
  };
}
