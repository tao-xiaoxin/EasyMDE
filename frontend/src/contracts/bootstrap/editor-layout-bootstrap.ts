export type EditorLayoutStrings = Readonly<{
  cjkCharacters: string;
  closeOutline: string;
  cursorPosition: string;
  editMode: string;
  lines: string;
  noOutline: string;
  openOutline: string;
  outline: string;
  previewMode: string;
  readingTime: string;
  resizePanes: string;
  saved: string;
  showMoreHeadings: string;
  splitMode: string;
  statistics: string;
  statisticsHelp: string;
  totalCharacters: string;
  unsaved: string;
  viewMode: string;
  westernWords: string;
}>;

export type EditorLayoutBootstrap = Readonly<{
  direction: 'ltr' | 'rtl';
  locale: string;
  strings: EditorLayoutStrings;
}>;

export class EditorLayoutBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'EditorLayoutBootstrapError';
    this.code = code;
  }
}

const WORDPRESS_SCRIPT_ALIASES: Readonly<Record<string, string>> = {
  latin: 'Latn'
};

export function resolveEditorNumberLocale(locale: string): string {
  const parts = locale.split(/[_-]/);
  const language = parts[0]?.toLowerCase();
  if (!language) return 'en-US';

  const fullLocale = parts.join('-');
  const scriptPart = parts.slice(1).find((part) => (
    /^[A-Za-z]{4}$/.test(part) || undefined !== WORDPRESS_SCRIPT_ALIASES[part.toLowerCase()]
  ));
  const regionPart = parts.slice(1).find((part) => /^(?:[A-Za-z]{2}|\d{3})$/.test(part));
  const script = scriptPart
    ? WORDPRESS_SCRIPT_ALIASES[scriptPart.toLowerCase()]
      ?? `${scriptPart[0]?.toUpperCase()}${scriptPart.slice(1).toLowerCase()}`
    : undefined;
  const region = regionPart?.toUpperCase();
  const structuredLocale = [language, script, region].filter(Boolean).join('-');
  const candidates = [
    scriptPart && WORDPRESS_SCRIPT_ALIASES[scriptPart.toLowerCase()]
      ? structuredLocale
      : fullLocale,
    structuredLocale,
    [language, region].filter(Boolean).join('-'),
    language
  ];

  for (const candidate of new Set(candidates)) {
    try {
      if (Intl.NumberFormat.supportedLocalesOf(candidate).length > 0) return candidate;
    } catch {
      // WordPress locale variants are not always valid BCP 47 tags; try the reduced candidate.
    }
  }

  return 'en-US';
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new EditorLayoutBootstrapError('editor-layout-bootstrap-invalid');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > 512) {
    throw new EditorLayoutBootstrapError('editor-layout-string-invalid');
  }
  return value;
}

function cursorPositionString(value: unknown): string {
  const template = requiredString(value);
  const placeholders: string[] = [];
  const unsupportedPlaceholder = template.replace(
    /%%|%([12])\$s/g,
    (_placeholder, index: string | undefined) => {
      if (index) placeholders.push(index);
      return '';
    }
  ).includes('%');
  placeholders.sort();
  if (unsupportedPlaceholder || '1,2' !== placeholders.join(',')) {
    throw new EditorLayoutBootstrapError('editor-layout-cursor-position-invalid');
  }
  return template;
}

export function parseEditorLayoutBootstrap(value: unknown): EditorLayoutBootstrap {
  const bootstrap = objectValue(value);
  const strings = objectValue(bootstrap.strings);
  if ('ltr' !== bootstrap.direction && 'rtl' !== bootstrap.direction) {
    throw new EditorLayoutBootstrapError('editor-layout-direction-invalid');
  }
  const locale = requiredString(bootstrap.locale);
  if (!/^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})*$/.test(locale)) {
    throw new EditorLayoutBootstrapError('editor-layout-locale-invalid');
  }

  return {
    direction: bootstrap.direction,
    locale,
    strings: {
      cjkCharacters: requiredString(strings.cjkCharacters),
      closeOutline: requiredString(strings.closeOutline),
      cursorPosition: cursorPositionString(strings.cursorPosition),
      editMode: requiredString(strings.editMode),
      lines: requiredString(strings.lines),
      noOutline: requiredString(strings.noOutline),
      openOutline: requiredString(strings.openOutline),
      outline: requiredString(strings.outline),
      previewMode: requiredString(strings.previewMode),
      readingTime: requiredString(strings.readingTime),
      resizePanes: requiredString(strings.resizePanes),
      saved: requiredString(strings.saved),
      showMoreHeadings: requiredString(strings.showMoreHeadings),
      splitMode: requiredString(strings.splitMode),
      statistics: requiredString(strings.statistics),
      statisticsHelp: requiredString(strings.statisticsHelp),
      totalCharacters: requiredString(strings.totalCharacters),
      unsaved: requiredString(strings.unsaved),
      viewMode: requiredString(strings.viewMode),
      westernWords: requiredString(strings.westernWords)
    }
  };
}
