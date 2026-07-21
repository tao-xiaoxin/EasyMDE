export type PreviewEnhancementAssets = Readonly<{
  codeFrameCssUrl: string;
  highlightScriptUrl: string;
  highlightThemeLinkId: string;
  codeFrameLinkId: string;
  katexCssLinkId: string;
  katexCssUrl: string;
  katexScriptUrl: string;
  mathCssLinkId: string;
  mathCssUrl: string;
  mathRendererUrl: string;
  mermaidRendererUrl: string;
  mermaidScriptUrl: string;
  tocCssLinkId: string;
  tocCssUrl: string;
}>;

export type PreviewEnhancementCodeTheme = Readonly<{
  cssUrl: string;
  id: string;
}>;

export type PreviewEnhancementBootstrap = Readonly<{
  assetBaseUrl: string;
  assets: PreviewEnhancementAssets;
  codeThemes: ReadonlyArray<PreviewEnhancementCodeTheme>;
  strings: Readonly<{ renderingFailed: string }>;
}>;

export class PreviewEnhancementBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'PreviewEnhancementBootstrapError';
    this.code = code;
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new PreviewEnhancementBootstrapError(code);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string, maxLength = 4096): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > maxLength) {
    throw new PreviewEnhancementBootstrapError(code);
  }
  return value;
}

function identifier(value: unknown, code: string): string {
  const result = requiredString(value, code, 200);
  if (!/^[a-z0-9_-]+$/.test(result)) {
    throw new PreviewEnhancementBootstrapError(code);
  }
  return result;
}

function localAssetUrl(value: unknown, assetBaseUrl: string, code: string): string {
  const raw = requiredString(value, code);
  try {
    const base = new URL(assetBaseUrl);
    const url = new URL(raw, base);
    const basePath = decodeURIComponent(
      base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
    );
    const path = decodeURIComponent(url.pathname);
    const hasTraversal = (pathname: string) =>
      pathname.includes('\\')
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
      throw new Error('invalid local asset URL');
    }
    return url.href;
  } catch {
    throw new PreviewEnhancementBootstrapError(code);
  }
}

function parseAssets(value: unknown, assetBaseUrl: string): PreviewEnhancementAssets {
  const assets = objectValue(value, 'preview-enhancement-assets-invalid');
  const urlKeys: ReadonlyArray<keyof PreviewEnhancementAssets> = [
    'codeFrameCssUrl',
    'highlightScriptUrl',
    'katexCssUrl',
    'katexScriptUrl',
    'mathCssUrl',
    'mathRendererUrl',
    'mermaidRendererUrl',
    'mermaidScriptUrl',
    'tocCssUrl'
  ];
  const idKeys: ReadonlyArray<keyof PreviewEnhancementAssets> = [
    'highlightThemeLinkId',
    'codeFrameLinkId',
    'katexCssLinkId',
    'mathCssLinkId',
    'tocCssLinkId'
  ];
  const parsed = {} as Record<keyof PreviewEnhancementAssets, string>;
  const ids = new Set<string>();

  for (const key of urlKeys) {
    parsed[key] = localAssetUrl(
      assets[key],
      assetBaseUrl,
      'preview-enhancement-assets-invalid'
    );
  }
  for (const key of idKeys) {
    const id = identifier(assets[key], 'preview-enhancement-assets-invalid');
    if (ids.has(id)) {
      throw new PreviewEnhancementBootstrapError('preview-enhancement-assets-invalid');
    }
    ids.add(id);
    parsed[key] = id;
  }
  return parsed;
}

function parseCodeThemes(
  value: unknown,
  assetBaseUrl: string
): ReadonlyArray<PreviewEnhancementCodeTheme> {
  if (!Array.isArray(value) || 0 === value.length) {
    throw new PreviewEnhancementBootstrapError('preview-enhancement-code-themes-invalid');
  }
  const ids = new Set<string>();
  return value.map((entry) => {
    const theme = objectValue(entry, 'preview-enhancement-code-theme-invalid');
    const id = identifier(theme.id, 'preview-enhancement-code-theme-invalid');
    if (ids.has(id)) {
      throw new PreviewEnhancementBootstrapError('preview-enhancement-code-themes-invalid');
    }
    ids.add(id);
    return {
      cssUrl: localAssetUrl(
        theme.cssUrl,
        assetBaseUrl,
        'preview-enhancement-code-theme-invalid'
      ),
      id
    };
  });
}

export function parsePreviewEnhancementBootstrap(
  value: unknown
): PreviewEnhancementBootstrap {
  const bootstrap = objectValue(value, 'preview-enhancement-bootstrap-invalid');
  const strings = objectValue(
    bootstrap.strings,
    'preview-enhancement-strings-invalid'
  );
  const assetBaseUrl = requiredString(
    bootstrap.assetBaseUrl,
    'preview-enhancement-asset-base-invalid'
  );

  try {
    const base = new URL(assetBaseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol)
      || base.username
      || base.password
      || base.search
      || base.hash
    ) {
      throw new Error('invalid asset base URL');
    }
  } catch {
    throw new PreviewEnhancementBootstrapError('preview-enhancement-asset-base-invalid');
  }

  return {
    assetBaseUrl,
    assets: parseAssets(bootstrap.assets, assetBaseUrl),
    codeThemes: parseCodeThemes(bootstrap.codeThemes, assetBaseUrl),
    strings: {
      renderingFailed: requiredString(
        strings.renderingFailed,
        'preview-enhancement-strings-invalid',
        512
      )
    }
  };
}
