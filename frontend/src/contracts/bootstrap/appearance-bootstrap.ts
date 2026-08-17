export type AppearanceOption = Readonly<{
  cssUrl?: string;
  fontDefaults?: FontDefaults;
  id: string;
  label: string;
  usesThemeFontFamily?: boolean;
}>;

export type ArticleThemeOption = AppearanceOption & Readonly<{
  defaultCodeTheme: string;
  markupProfile: string;
  swatch?: string;
}>;

export type FontDefaults = Readonly<{
  appleFont: string;
  customFont: string;
  serifFont: string;
  windowsFont: string;
}>;

export type CustomCssItem = Readonly<{
  id: string;
  articleThemeName: string;
  codeThemeName: string;
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
  customCssDialog: CustomCssDialogStrings;
  customCssTheme: string;
  cssName: string;
  saveCss: string;
  cssSaved: string;
  cssSaveFailed: string;
  themeApplyFailed: string;
  cssNameDuplicate: string;
  namedCustomCss: string;
}>;

const CUSTOM_CSS_DIALOG_STRING_KEYS = [
  'description',
  'close',
  'closeTitle',
  'articleThemeName',
  'codeThemeName',
  'articleNamePlaceholder',
  'codeNamePlaceholder',
  'unsavedChanges',
  'invalidColor',
  'missingName',
  'previewTitle',
  'livePreview',
  'previewHelp',
  'previewInvalid',
  'previewUnavailable',
  'themeVariables',
  'themeVariableCategories',
  'themeVariablePanelLabel',
  'customCssCodeTitle',
  'reset',
  'expandCode',
  'shrinkCode',
  'backToVariables',
  'saveTarget',
  'articleCss',
  'codeCss',
  'articleCssHelp',
  'codeCssHelp',
  'foundationCategory',
  'blocksCategory',
  'codeCategory',
  'alertsCategory',
  'customCssCode',
  'customCssCodeHelp',
  'backToThemeVariables',
  'cancel',
  'resetAll',
  'applyCustomTheme',
  'defaultArticleName',
  'defaultCodeName',
  'colorPickerLabel',
  'currentThemeVariablesComment',
  'addCustomRulesComment',
  'previewHeadingOne',
  'previewHeadingTwo',
  'previewBodyText',
  'previewParagraph',
  'previewBoldText',
  'previewItalicText',
  'previewDeletedText',
  'previewHighlight',
  'previewInlineCode',
  'previewCodeComment',
  'previewBlockquote',
  'previewUnorderedItem',
  'previewCompletedTask',
  'previewOrderedItem',
  'previewSecondStep',
  'previewTableHeader',
  'previewTableContent',
  'previewLink',
  'previewNoteLabel',
  'previewTipLabel',
  'previewWarningLabel',
  'previewCautionLabel',
  'previewInformation',
  'previewSuccess',
  'previewWarning',
  'previewDanger',
  'previewDetails',
  'previewDetailsContent',
  'previewDefinitionTerm',
  'previewDefinitionDescription',
  'previewSupplementalHeading',
  'previewSupplementalText',
  'previewFootnote',
  'previewInlineSeparator',
  'previewInlineConjunction',
  'previewSentenceEnd'
] as const;

export type CustomCssDialogStringKey =
  typeof CUSTOM_CSS_DIALOG_STRING_KEYS[number];

export type CustomCssDialogStrings = Readonly<
  Record<CustomCssDialogStringKey, string>
>;

export type CustomCssVariable = Readonly<{
  category: 'foundation' | 'blocks' | 'code' | 'alerts';
  description: string;
  id: string;
  label: string;
}>;

export const CUSTOM_CSS_VARIABLE_IDS = [
  'primaryColor',
  'headingColor',
  'textColor',
  'mutedColor',
  'linkColor',
  'backgroundColor',
  'borderColor',
  'emphasisBackground',
  'selectionBackground',
  'quoteColor',
  'quoteBackground',
  'tableHeaderBackground',
  'tableStripeBackground',
  'inlineCodeColor',
  'inlineCodeBackground',
  'codeBlockTextColor',
  'codeBlockBackground',
  'codeKeywordColor',
  'codeStringColor',
  'codeCommentColor',
  'infoColor',
  'infoBackground',
  'successColor',
  'successBackground',
  'warningColor',
  'warningBackground',
  'dangerColor',
  'dangerBackground'
] as const;

export type CustomCssVariableId = typeof CUSTOM_CSS_VARIABLE_IDS[number];

export type AppearanceBootstrap = Readonly<{
  articleThemes: ReadonlyArray<ArticleThemeOption>;
  canManageCustomCss: boolean;
  codeThemeExplicit: boolean;
  codeThemes: ReadonlyArray<AppearanceOption>;
  customCss: ReadonlyArray<CustomCssItem>;
  customMarkupProfile: string;
  customCssVariables: ReadonlyArray<CustomCssVariable>;
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

function optionalHexColor(value: unknown, code: string): string | undefined {
  if (undefined === value) {
    return undefined;
  }

  const color = requiredString(value, code, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new AppearanceBootstrapError(code);
  }

  return color;
}

function customCssThemeName(value: unknown, code: string): string {
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
    if (undefined !== option.usesThemeFontFamily && true !== option.usesThemeFontFamily) {
      throw new AppearanceBootstrapError('invalid-appearance-theme-font-family');
    }
    const usesThemeFontFamily = true === option.usesThemeFontFamily;

    return {
      id,
      label: requiredString(option.label, 'invalid-appearance-option-label'),
      ...(cssUrl ? { cssUrl } : {}),
      ...(fontDefaults ? { fontDefaults } : {}),
      ...(usesThemeFontFamily ? { usesThemeFontFamily: true } : {})
    };
  });
}

function parseArticleOptions(
  value: unknown,
  codeThemes: ReadonlyArray<AppearanceOption>
): ReadonlyArray<ArticleThemeOption> {
  const options = parseOptions(value);

  return options.map((option, index) => {
    const source = objectValue((value as ReadonlyArray<unknown>)[index], 'invalid-appearance-option');
    const defaultCodeTheme = undefined === source.defaultCodeTheme
      ? 'atom-one-dark'
      : identifier(source.defaultCodeTheme, 'invalid-associated-code-theme');
    const markupProfile = identifier(
      source.markupProfile,
      'invalid-article-theme-markup-profile'
    );

    if (!codeThemes.some(({ id }) => id === defaultCodeTheme)) {
      throw new AppearanceBootstrapError('invalid-associated-code-theme');
    }

    const swatch = optionalHexColor(source.swatch, 'invalid-article-theme-swatch');

    return {
      ...option,
      defaultCodeTheme,
      markupProfile,
      ...(swatch ? { swatch } : {})
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
      articleThemeName: customCssThemeName(
        item.articleThemeName,
        'invalid-custom-css-article-theme-name'
      ),
      codeThemeName: customCssThemeName(
        item.codeThemeName,
        'invalid-custom-css-code-theme-name'
      ),
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
  const requiredKeys: ReadonlyArray<Exclude<
    keyof AppearanceStrings,
    'customCssDialog'
  >> = [
    'appearance',
    'articleTheme',
    'codeTheme',
    'customCss',
    'customCssTheme',
    'cssName',
    'saveCss',
    'cssSaved',
    'cssSaveFailed',
    'themeApplyFailed',
    'cssNameDuplicate',
    'namedCustomCss'
  ];
  const result = {} as Record<
    Exclude<keyof AppearanceStrings, 'customCssDialog'>,
    string
  >;

  for (const key of requiredKeys) {
    result[key] = requiredString(strings[key], 'invalid-appearance-string');
  }

  const dialog = objectValue(
    strings.customCssDialog,
    'invalid-custom-css-dialog-strings'
  );
  const customCssDialog = {} as Record<CustomCssDialogStringKey, string>;
  for (const key of CUSTOM_CSS_DIALOG_STRING_KEYS) {
    customCssDialog[key] = requiredString(
      dialog[key],
      'invalid-custom-css-dialog-string'
    );
  }

  return { ...result, customCssDialog };
}

function parseCustomCssVariables(value: unknown): ReadonlyArray<CustomCssVariable> {
  if (!Array.isArray(value) || 0 === value.length) {
    throw new AppearanceBootstrapError('invalid-custom-css-variables');
  }

  const ids = new Set<string>();
  const variables = value.map((entry) => {
    const variable = objectValue(entry, 'invalid-custom-css-variable');
    const id = requiredString(
      variable.id,
      'invalid-custom-css-variable-id',
      64
    );
    if (!CUSTOM_CSS_VARIABLE_IDS.includes(id as CustomCssVariableId)) {
      throw new AppearanceBootstrapError('invalid-custom-css-variable-id');
    }
    if (ids.has(id)) {
      throw new AppearanceBootstrapError('duplicate-custom-css-variable-id');
    }
    ids.add(id);
    const category = requiredString(
      variable.category,
      'invalid-custom-css-variable-category'
    );
    if (!['foundation', 'blocks', 'code', 'alerts'].includes(category)) {
      throw new AppearanceBootstrapError('invalid-custom-css-variable-category');
    }

    return {
      id,
      category: category as CustomCssVariable['category'],
      label: requiredString(
        variable.label,
        'invalid-custom-css-variable-label'
      ),
      description: requiredString(
        variable.description,
        'invalid-custom-css-variable-description'
      )
    };
  });
  if (ids.size !== CUSTOM_CSS_VARIABLE_IDS.length) {
    throw new AppearanceBootstrapError('invalid-custom-css-variables');
  }
  return variables;
}

export function parseAppearanceBootstrap(value: unknown): AppearanceBootstrap {
  const bootstrap = objectValue(value, 'invalid-appearance-bootstrap');
  const codeThemes = parseOptions(bootstrap.codeThemes);
  const articleThemes = parseArticleOptions(bootstrap.articleThemes, codeThemes);
  const customCss = parseCustomCss(bootstrap.customCss);
  if ('boolean' !== typeof bootstrap.canManageCustomCss) {
    throw new AppearanceBootstrapError('invalid-custom-css-capability');
  }
  if ('boolean' !== typeof bootstrap.codeThemeExplicit) {
    throw new AppearanceBootstrapError('invalid-code-theme-explicit-state');
  }

  return {
    articleThemes,
    canManageCustomCss: bootstrap.canManageCustomCss,
    codeThemeExplicit: bootstrap.codeThemeExplicit,
    codeThemes,
    customCss,
    customMarkupProfile: identifier(
      bootstrap.customMarkupProfile,
      'invalid-custom-markup-profile'
    ),
    customCssVariables: parseCustomCssVariables(bootstrap.customCssVariables),
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
