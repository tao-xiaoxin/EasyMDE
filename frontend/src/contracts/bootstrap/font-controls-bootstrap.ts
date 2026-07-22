export type FontOption = Readonly<{
  id: string;
  label: string;
  fontFamily: string;
}>;

export type FontControlsOptions = Readonly<{
  customFonts: ReadonlyArray<FontOption>;
  windowsFonts: ReadonlyArray<FontOption>;
  appleFonts: ReadonlyArray<FontOption>;
  serifOptions: ReadonlyArray<FontOption>;
}>;

export type FontControlsState = Readonly<{
  customFont: string;
  windowsFont: string;
  appleFont: string;
  serifFont: string;
}>;

export type FontControlsStrings = Readonly<{
  font: string;
  customFont: string;
  windowsFont: string;
  appleFont: string;
  serifFont: string;
  fontStackHelp: string;
}>;

export type FontControlsBootstrap = Readonly<{
  options: FontControlsOptions;
  state: FontControlsState;
  strings: FontControlsStrings;
}>;

export class FontControlsBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'FontControlsBootstrapError';
    this.code = code;
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new FontControlsBootstrapError(code);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if ('string' !== typeof value || '' === value.trim()) {
    throw new FontControlsBootstrapError(code);
  }

  return value;
}

function parseFontFamily(value: unknown): string {
  const containsControlCharacter = 'string' === typeof value && Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || 127 === code;
  });

  if (
    'string' !== typeof value ||
    value.length > 512 ||
    containsControlCharacter ||
    /[;{}<>]/.test(value)
  ) {
    throw new FontControlsBootstrapError('invalid-font-family');
  }

  return value;
}

function parseOptionGroup(value: unknown): ReadonlyArray<FontOption> {
  if (!Array.isArray(value) || 0 === value.length) {
    throw new FontControlsBootstrapError('invalid-font-options');
  }

  const ids = new Set<string>();
  return value.map((entry) => {
    const option = objectValue(entry, 'invalid-font-option');
    const id = requiredString(option.id, 'invalid-font-option-id');
    if (!/^[a-z0-9_-]+$/.test(id)) {
      throw new FontControlsBootstrapError('invalid-font-option-id');
    }
    if (ids.has(id)) {
      throw new FontControlsBootstrapError('duplicate-font-option-id');
    }
    ids.add(id);

    return {
      id,
      label: requiredString(option.label, 'invalid-font-option-label'),
      fontFamily: parseFontFamily(option.fontFamily)
    };
  });
}

function parseOptions(value: unknown): FontControlsOptions {
  const options = objectValue(value, 'invalid-font-options');

  return {
    customFonts: parseOptionGroup(options.customFonts),
    windowsFonts: parseOptionGroup(options.windowsFonts),
    appleFonts: parseOptionGroup(options.appleFonts),
    serifOptions: parseOptionGroup(options.serifOptions)
  };
}

export function parseFontControlsState(
  value: unknown,
  options: FontControlsOptions
): FontControlsState {
  const state = objectValue(value, 'invalid-font-state');
  const parsed = {
    customFont: requiredString(state.customFont, 'invalid-font-selection'),
    windowsFont: requiredString(state.windowsFont, 'invalid-font-selection'),
    appleFont: requiredString(state.appleFont, 'invalid-font-selection'),
    serifFont: requiredString(state.serifFont, 'invalid-font-selection')
  };
  const selections: ReadonlyArray<readonly [ReadonlyArray<FontOption>, string]> = [
    [options.customFonts, parsed.customFont],
    [options.windowsFonts, parsed.windowsFont],
    [options.appleFonts, parsed.appleFont],
    [options.serifOptions, parsed.serifFont]
  ];

  if (selections.some(([group, selected]) => !group.some(({ id }) => id === selected))) {
    throw new FontControlsBootstrapError('invalid-font-selection');
  }

  return parsed;
}

function parseStrings(value: unknown): FontControlsStrings {
  const strings = objectValue(value, 'invalid-font-strings');

  return {
    font: requiredString(strings.font, 'invalid-font-string'),
    customFont: requiredString(strings.customFont, 'invalid-font-string'),
    windowsFont: requiredString(strings.windowsFont, 'invalid-font-string'),
    appleFont: requiredString(strings.appleFont, 'invalid-font-string'),
    serifFont: requiredString(strings.serifFont, 'invalid-font-string'),
    fontStackHelp: requiredString(strings.fontStackHelp, 'invalid-font-string')
  };
}

export function parseFontControlsBootstrap(value: unknown): FontControlsBootstrap {
  const bootstrap = objectValue(value, 'invalid-font-bootstrap');
  const options = parseOptions(bootstrap.options);

  return {
    options,
    state: parseFontControlsState(bootstrap.state, options),
    strings: parseStrings(bootstrap.strings)
  };
}
