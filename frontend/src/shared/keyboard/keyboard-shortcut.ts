export type KeyboardShortcutPlatform = 'mac' | 'win';

export type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'code'
  | 'ctrlKey'
  | 'isComposing'
  | 'key'
  | 'keyCode'
  | 'metaKey'
  | 'repeat'
  | 'shiftKey'
>;

const PUNCTUATION_CODES = [
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash'
] as const;

const PUNCTUATION_LABELS: Readonly<Record<string, string>> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/'
};

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ' ': 'Space',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  delete: 'Delete',
  end: 'End',
  enter: 'Enter',
  home: 'Home',
  insert: 'Insert',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  space: 'Space',
  spacebar: 'Space'
};

function canonicalKey(value: string): string | null {
  if (' ' === value) return 'Space';
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^F(?:[1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  const named = NAMED_KEYS[lower];
  if (named) return named;
  return PUNCTUATION_CODES.find((key) => key.toLowerCase() === lower) ?? null;
}

function keyFromEvent(event: KeyboardShortcutEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if ((PUNCTUATION_CODES as ReadonlyArray<string>).includes(event.code)) {
    return event.code;
  }
  if (event.code) return canonicalKey(event.code);
  return canonicalKey(event.key);
}

function canonicalModifier(
  value: string,
  platform: KeyboardShortcutPlatform
): string | null {
  const lower = value.trim().toLowerCase();
  if ('shift' === lower) return 'Shift';
  if ('ctrl' === lower || 'control' === lower) return 'Ctrl';
  if ('alt' === lower || 'option' === lower) {
    return 'mac' === platform ? 'Option' : 'Alt';
  }
  if ('mod' === lower) return 'mac' === platform ? 'Cmd' : 'Ctrl';
  if (['cmd', 'command', 'meta'].includes(lower)) {
    return 'mac' === platform ? 'Cmd' : 'Meta';
  }
  return null;
}

function orderedModifiers(
  modifiers: ReadonlySet<string>,
  platform: KeyboardShortcutPlatform
): ReadonlyArray<string> {
  const order = 'mac' === platform
    ? ['Cmd', 'Ctrl', 'Option', 'Shift']
    : ['Ctrl', 'Alt', 'Shift', 'Meta'];
  return order.filter((modifier) => modifiers.has(modifier));
}

function combineShortcut(
  modifiers: ReadonlySet<string>,
  key: string,
  platform: KeyboardShortcutPlatform
): string | null {
  if (![...modifiers].some((modifier) => 'Shift' !== modifier)) return null;
  return [...orderedModifiers(modifiers, platform), key].join('+');
}

export function canonicalizeKeyboardShortcut(
  value: string,
  platform: KeyboardShortcutPlatform
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s*\+\s*/u);
  if (parts.length < 2 || parts.length > 5 || parts.some((part) => !part)) {
    return null;
  }
  const key = canonicalKey(parts[parts.length - 1] ?? '');
  if (!key) return null;
  const modifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const modifier = canonicalModifier(part, platform);
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  return combineShortcut(modifiers, key, platform);
}

export function keyboardShortcutFromEvent(
  event: KeyboardShortcutEvent,
  platform: KeyboardShortcutPlatform
): string | null {
  if (
    event.isComposing
    || 229 === event.keyCode
    || event.repeat
    || ['Dead', 'Process', 'Unidentified'].includes(event.key)
  ) {
    return null;
  }
  const key = keyFromEvent(event);
  if (!key) return null;
  const modifiers = new Set<string>();
  if ('mac' === platform) {
    if (event.metaKey) modifiers.add('Cmd');
    if (event.ctrlKey) modifiers.add('Ctrl');
    if (event.altKey) modifiers.add('Option');
    if (event.shiftKey) modifiers.add('Shift');
  } else {
    if (event.ctrlKey) modifiers.add('Ctrl');
    if (event.altKey) modifiers.add('Alt');
    if (event.shiftKey) modifiers.add('Shift');
    if (event.metaKey) modifiers.add('Meta');
  }
  return combineShortcut(modifiers, key, platform);
}

export function formatKeyboardShortcut(value: string): string {
  return value
    .split('+')
    .map((part) => PUNCTUATION_LABELS[part] ?? part)
    .join('+');
}
