// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  canonicalizeKeyboardShortcut,
  formatKeyboardShortcut,
  keyboardShortcutFromEvent
} from './keyboard-shortcut';

function keyboardEvent(
  init: KeyboardEventInit & Readonly<{ keyCode?: number }>
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', init);
  if (undefined !== init.keyCode) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode });
  }
  return event;
}

describe('canonicalizeKeyboardShortcut', () => {
  it('canonicalizes aliases and modifier order for each target platform', () => {
    expect(canonicalizeKeyboardShortcut(' Shift + control + b ', 'win'))
      .toBe('Ctrl+Shift+B');
    expect(canonicalizeKeyboardShortcut('option+command+q', 'mac'))
      .toBe('Cmd+Option+Q');
    expect(canonicalizeKeyboardShortcut('Ctrl+Meta+Alt+Shift+K', 'win'))
      .toBe('Ctrl+Alt+Shift+Meta+K');
    expect(canonicalizeKeyboardShortcut('Shift+Option+Ctrl+Cmd+K', 'mac'))
      .toBe('Cmd+Ctrl+Option+Shift+K');
  });

  it('supports the Typora strike defaults without platform-specific exceptions', () => {
    expect(canonicalizeKeyboardShortcut('Alt+Shift+5', 'win'))
      .toBe('Alt+Shift+5');
    expect(canonicalizeKeyboardShortcut('Ctrl+Shift+Backquote', 'mac'))
      .toBe('Ctrl+Shift+Backquote');
  });

  it('keeps an empty binding disabled and rejects invalid chords', () => {
    expect(canonicalizeKeyboardShortcut('', 'win')).toBe('');
    expect(canonicalizeKeyboardShortcut('Shift+B', 'win')).toBeNull();
    expect(canonicalizeKeyboardShortcut('B', 'mac')).toBeNull();
    expect(canonicalizeKeyboardShortcut('Ctrl+Escape', 'win')).toBeNull();
    expect(canonicalizeKeyboardShortcut('Cmd+Tab', 'mac')).toBeNull();
    expect(canonicalizeKeyboardShortcut('Ctrl+AB', 'win')).toBeNull();
    expect(canonicalizeKeyboardShortcut('Ctrl+Ctrl+B', 'win')).toBeNull();
    expect(canonicalizeKeyboardShortcut('Ctrl+B+I', 'win')).toBeNull();
  });
});

describe('keyboardShortcutFromEvent', () => {
  it('uses event.code so shifted punctuation retains its physical key', () => {
    expect(keyboardShortcutFromEvent(keyboardEvent({
      code: 'BracketLeft',
      ctrlKey: true,
      key: '{',
      shiftKey: true
    }), 'win')).toBe('Ctrl+Shift+BracketLeft');
    expect(keyboardShortcutFromEvent(keyboardEvent({
      code: 'BracketRight',
      ctrlKey: true,
      key: '}',
      shiftKey: true
    }), 'win')).toBe('Ctrl+Shift+BracketRight');
    expect(keyboardShortcutFromEvent(keyboardEvent({
      code: 'Backquote',
      key: '~',
      metaKey: true,
      shiftKey: true
    }), 'mac')).toBe('Cmd+Shift+Backquote');
  });

  it('normalizes printable, function, arrow, and editing keys', () => {
    const cases = [
      ['KeyB', 'b', 'B'],
      ['Digit2', '@', '2'],
      ['Semicolon', ':', 'Semicolon'],
      ['Quote', '"', 'Quote'],
      ['Equal', '+', 'Equal'],
      ['', 'F12', 'F12'],
      ['', 'ArrowUp', 'ArrowUp'],
      ['', 'Insert', 'Insert'],
      ['', ' ', 'Space']
    ] as const;

    for (const [code, key, expected] of cases) {
      expect(keyboardShortcutFromEvent(keyboardEvent({
        code,
        ctrlKey: true,
        key
      }), 'win')).toBe(`Ctrl+${expected}`);
    }
  });

  it('ignores IME, repeated, modifier-only, unknown, reserved, and incomplete chords', () => {
    const ignoredEvents = [
      keyboardEvent({ code: 'KeyB', ctrlKey: true, isComposing: true, key: 'b' }),
      keyboardEvent({ code: 'KeyB', ctrlKey: true, key: 'b', keyCode: 229 }),
      keyboardEvent({ code: 'KeyB', ctrlKey: true, key: 'b', repeat: true }),
      keyboardEvent({ code: 'ControlLeft', ctrlKey: true, key: 'Control' }),
      keyboardEvent({ code: '', ctrlKey: true, key: 'Dead' }),
      keyboardEvent({ code: 'Unidentified', ctrlKey: true, key: 'b' }),
      keyboardEvent({ code: 'Escape', ctrlKey: true, key: 'Escape' }),
      keyboardEvent({ code: 'Tab', ctrlKey: true, key: 'Tab' }),
      keyboardEvent({ code: 'KeyB', key: 'b' }),
      keyboardEvent({ code: 'KeyB', key: 'B', shiftKey: true })
    ];

    for (const event of ignoredEvents) {
      expect(keyboardShortcutFromEvent(event, 'win')).toBeNull();
    }
  });

  it.each(['Dead', 'Process', 'Unidentified'])(
    'rejects %s key events even when their physical punctuation code is allowed',
    (key) => {
      expect(keyboardShortcutFromEvent(keyboardEvent({
        code: 'Quote',
        ctrlKey: true,
        key
      }), 'win')).toBeNull();
    }
  );
});

describe('formatKeyboardShortcut', () => {
  it.each([
    ['Ctrl+Shift+Backquote', 'Ctrl+Shift+`'],
    ['Ctrl+Shift+BracketLeft', 'Ctrl+Shift+['],
    ['Ctrl+Shift+BracketRight', 'Ctrl+Shift+]'],
    ['Ctrl+Backslash', 'Ctrl+\\'],
    ['Cmd+Option+Semicolon', 'Cmd+Option+;'],
    ['Ctrl+Quote', "Ctrl+'"],
    ['Ctrl+Comma', 'Ctrl+,'],
    ['Ctrl+Period', 'Ctrl+.'],
    ['Ctrl+Slash', 'Ctrl+/'],
    ['Ctrl+Minus', 'Ctrl+-'],
    ['Ctrl+Equal', 'Ctrl+='],
    ['', '']
  ])('formats %s as %s', (value, expected) => {
    expect(formatKeyboardShortcut(value)).toBe(expected);
  });
});
