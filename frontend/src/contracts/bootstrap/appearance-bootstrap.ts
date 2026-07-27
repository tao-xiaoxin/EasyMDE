export type AppearanceOption = Readonly<{
  cssUrl?: string;
  fontDefaults?: FontDefaults;
  id: string;
  label: string;
}>;

export type FontDefaults = Readonly<{
  appleFont: string;
  customFont: string;
  serifFont: string;
  windowsFont: string;
}>;

export type CustomCssItem = Readonly<{
  id: string;
  name: string;
  css: string;
  scopedCss: string;
}>;

export type AppearanceState = Readonly<{
  markdownTheme: string;
  codeTheme: string;
  customCssId: string;
}>;

export type AppearanceSnapshot = Readonly<{
  customCss: ReadonlyArray<CustomCssItem>;
  state: AppearanceState;
}>;

export type AppearanceStrings = Readonly<{
  appearance: string;
  articleTheme: string;
  codeTheme: string;
  customCss: string;
  customCssTheme: string;
  cssName: string;
  saveCss: string;
  cssSaved: string;
  cssSaveFailed: string;
  namedCustomCss: string;
}>;

export type AppearanceBootstrap = Readonly<{
  articleThemes: ReadonlyArray<AppearanceOption>;
  codeThemes: ReadonlyArray<AppearanceOption>;
  customCss: ReadonlyArray<CustomCssItem>;
  state: AppearanceState;
  strings: AppearanceStrings;
}>;

export type ParsedCustomCssSaveResult =
  | Readonly<{ status: 'saved'; snapshot: AppearanceSnapshot }>
  | Readonly<{ status: 'failed'; code: string }>;

export class AppearanceBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'AppearanceBootstrapError';
    this.code = code;
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new AppearanceBootstrapError(code);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string, maxLength = 512): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > maxLength) {
    throw new AppearanceBootstrapError(code);
  }

  return value;
}

function requiredUnboundedString(value: unknown, code: string): string {
  if ('string' !== typeof value || '' === value.trim()) {
    throw new AppearanceBootstrapError(code);
  }

  return value;
}

function identifier(value: unknown, code: string): string {
  const id = requiredString(value, code, 200);
  if (!/^[a-z0-9_-]+$/.test(id)) {
    throw new AppearanceBootstrapError(code);
  }

  return id;
}

function parseOptions(value: unknown): ReadonlyArray<AppearanceOption> {
  if (!Array.isArray(value) || 0 === value.length) {
    throw new AppearanceBootstrapError('invalid-appearance-options');
  }

  const ids = new Set<string>();
  return value.map((entry) => {
    const option = objectValue(entry, 'invalid-appearance-option');
    const id = identifier(option.id, 'invalid-appearance-option-id');
    if (ids.has(id)) {
      throw new AppearanceBootstrapError('duplicate-appearance-option-id');
    }
    ids.add(id);

    const cssUrl = undefined === option.cssUrl
      ? undefined
      : requiredString(option.cssUrl, 'invalid-appearance-option-css-url', 4096);
    const defaults = undefined === option.fontDefaults
      ? undefined
      : objectValue(option.fontDefaults, 'invalid-appearance-font-defaults');
    const fontDefaults = defaults ? {
      appleFont: identifier(defaults.appleFont, 'invalid-appearance-font-defaults'),
      customFont: identifier(defaults.customFont, 'invalid-appearance-font-defaults'),
      serifFont: identifier(defaults.serifFont, 'invalid-appearance-font-defaults'),
      windowsFont: identifier(defaults.windowsFont, 'invalid-appearance-font-defaults')
    } : undefined;

    return {
      id,
      label: requiredString(option.label, 'invalid-appearance-option-label'),
      ...(cssUrl ? { cssUrl } : {}),
      ...(fontDefaults ? { fontDefaults } : {})
    };
  });
}

function parseCustomCss(value: unknown): ReadonlyArray<CustomCssItem> {
  if (!Array.isArray(value)) {
    throw new AppearanceBootstrapError('invalid-custom-css-library');
  }

  const ids = new Set<string>();
  return value.map((entry) => {
    const item = objectValue(entry, 'invalid-custom-css-item');
    const id = identifier(item.id, 'invalid-custom-css-id');
    if (ids.has(id)) {
      throw new AppearanceBootstrapError('duplicate-custom-css-id');
    }
    ids.add(id);
    if ('string' !== typeof item.css || item.css.length > 30_000) {
      throw new AppearanceBootstrapError('invalid-custom-css-code');
    }
    if ('string' !== typeof item.scopedCss || item.scopedCss.length > 250_000) {
      throw new AppearanceBootstrapError('invalid-scoped-custom-css');
    }

    return {
      id,
      name: requiredUnboundedString(item.name, 'invalid-custom-css-name'),
      css: item.css,
      scopedCss: item.scopedCss
    };
  });
}

function parseState(
  value: unknown,
  articleThemes: ReadonlyArray<AppearanceOption>,
  codeThemes: ReadonlyArray<AppearanceOption>
): AppearanceState {
  const state = objectValue(value, 'invalid-appearance-state');
  const markdownTheme = identifier(state.markdownTheme, 'invalid-article-theme-selection');
  const codeTheme = identifier(state.codeTheme, 'invalid-code-theme-selection');
  const customCssId = '' === state.customCssId
    ? ''
    : identifier(state.customCssId, 'invalid-custom-css-selection');

  if (!codeThemes.some(({ id }) => id === codeTheme)) {
    throw new AppearanceBootstrapError('invalid-code-theme-selection');
  }
  if ('custom' === markdownTheme) {
    if (!customCssId) {
      throw new AppearanceBootstrapError('invalid-custom-css-selection');
    }
  } else if (
    customCssId ||
    !articleThemes.some(({ id }) => id === markdownTheme)
  ) {
    throw new AppearanceBootstrapError('invalid-article-theme-selection');
  }

  return { markdownTheme, codeTheme, customCssId };
}

function parseStrings(value: unknown): AppearanceStrings {
  const strings = objectValue(value, 'invalid-appearance-strings');
  const requiredKeys: ReadonlyArray<keyof AppearanceStrings> = [
    'appearance',
    'articleTheme',
    'codeTheme',
    'customCss',
    'customCssTheme',
    'cssName',
    'saveCss',
    'cssSaved',
    'cssSaveFailed',
    'namedCustomCss'
  ];
  const result = {} as Record<keyof AppearanceStrings, string>;

  for (const key of requiredKeys) {
    result[key] = requiredString(strings[key], 'invalid-appearance-string');
  }

  return result;
}

export function parseAppearanceBootstrap(value: unknown): AppearanceBootstrap {
  const bootstrap = objectValue(value, 'invalid-appearance-bootstrap');
  const articleThemes = parseOptions(bootstrap.articleThemes);
  const codeThemes = parseOptions(bootstrap.codeThemes);
  const customCss = parseCustomCss(bootstrap.customCss);

  return {
    articleThemes,
    codeThemes,
    customCss,
    state: parseState(bootstrap.state, articleThemes, codeThemes),
    strings: parseStrings(bootstrap.strings)
  };
}

export function parseAppearanceSnapshot(
  value: unknown,
  bootstrap: Pick<AppearanceBootstrap, 'articleThemes' | 'codeThemes'>
): AppearanceSnapshot {
  const snapshot = objectValue(value, 'invalid-appearance-snapshot');
  const customCss = parseCustomCss(snapshot.customCss);

  return {
    customCss,
    state: parseState(
      snapshot.state,
      bootstrap.articleThemes,
      bootstrap.codeThemes
    )
  };
}

export function parseCustomCssSaveResult(
  value: unknown,
  bootstrap: Pick<AppearanceBootstrap, 'articleThemes' | 'codeThemes'>
): ParsedCustomCssSaveResult {
  const result = objectValue(value, 'invalid-custom-css-save-result');
  if ('failed' === result.status) {
    const code = requiredString(result.code, 'invalid-custom-css-save-error', 200);
    if (!/^[a-z0-9_-]+$/.test(code)) {
      throw new AppearanceBootstrapError('invalid-custom-css-save-error');
    }
    return { status: 'failed', code };
  }
  if ('saved' !== result.status) {
    throw new AppearanceBootstrapError('invalid-custom-css-save-result');
  }

  return {
    status: 'saved',
    snapshot: parseAppearanceSnapshot(result.snapshot, bootstrap)
  };
}
