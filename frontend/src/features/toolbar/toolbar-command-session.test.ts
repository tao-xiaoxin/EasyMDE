import { describe, expect, it, vi } from 'vitest';

import type { ToolbarCommand } from '../../contracts/bootstrap/toolbar-bootstrap';
import type { ToolbarCommandDocumentPort } from '../../contracts/ports/toolbar-command-port';
import { createToolbarCommandSession } from './toolbar-command-session';

function command(overrides: Partial<ToolbarCommand>): ToolbarCommand {
  return {
    action: 'wrap',
    group: 'format',
    icon: 'editor-code',
    id: 'fixture',
    label: 'Fixture',
    surface: 'main',
    ...overrides
  };
}

function documentPort(value: string, start: number, end: number, direction: 'backward' | 'forward' | 'none' = 'none') {
  let snapshot = { value, selection: { direction, end, start } };
  const port: ToolbarCommandDocumentPort = {
    applyTextChange(change) {
      snapshot = change;
    },
    focus: vi.fn(),
    getSnapshot: () => snapshot
  };

  return { port, snapshot: () => snapshot };
}

describe('createToolbarCommandSession', () => {
  it('wraps a backward selection and keeps the selected content active', () => {
    const document = documentPort('before text after', 7, 11, 'backward');
    const session = createToolbarCommandSession({
      commands: [command({ prefix: '**', suffix: '**' })],
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    expect(session.execute('fixture')).toBe(true);
    expect(document.snapshot()).toEqual({
      value: 'before **text** after',
      selection: { direction: 'backward', end: 13, start: 9 }
    });
    expect(document.port.focus).toHaveBeenCalledOnce();
  });

  it('transforms complete selected lines for headings, quotes, and ordered lists', () => {
    const headingDocument = documentPort('intro\n# First\n- Second\noutro', 8, 22, 'forward');
    const quoteDocument = documentPort('intro\n# First\n- Second\noutro', 8, 22, 'forward');
    const orderedDocument = documentPort('intro\n# First\n- Second\n\noutro', 8, 23, 'forward');
    let activeDocument = headingDocument.port;
    const session = createToolbarCommandSession({
      commands: [
        command({ action: 'heading', id: 'heading2', level: 2 }),
        command({ action: 'quote', id: 'quote', linePrefix: '> ' }),
        command({ action: 'orderedList', id: 'ordered' })
      ],
      document: {
        applyTextChange: (change) => activeDocument.applyTextChange(change),
        focus: () => activeDocument.focus(),
        getSnapshot: () => activeDocument.getSnapshot()
      },
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    expect(session.execute('heading2')).toBe(true);
    expect(headingDocument.snapshot().value).toBe('intro\n## First\n## Second\noutro');
    activeDocument = quoteDocument.port;
    expect(session.execute('quote')).toBe(true);
    expect(quoteDocument.snapshot().value).toBe('intro\n> First\n> Second\noutro');
    activeDocument = orderedDocument.port;
    expect(session.execute('ordered')).toBe(true);
    expect(orderedDocument.snapshot().value).toBe('intro\n1. First\n2. Second\n\noutro');
  });

  it('preserves the legacy block newline and placeholder behavior', () => {
    const document = documentPort('beforeafter', 6, 6);
    const session = createToolbarCommandSession({
      commands: [command({ action: 'codeFence', id: 'code' })],
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    expect(session.execute('code')).toBe(true);
    expect(document.snapshot()).toEqual({
      value: 'before\n```\ncode\n```\nafter',
      selection: { direction: 'none', end: 15, start: 11 }
    });
  });

  it('uses the translated link placeholder and supports extension fallbacks', () => {
    const document = documentPort('', 0, 0);
    const session = createToolbarCommandSession({
      commands: [
        command({ action: 'link', id: 'link' }),
        command({ action: 'extension', id: 'custom-wrap', placeholder: 'value', prefix: '<x>', suffix: '</x>' }),
        command({ action: 'extension', id: 'custom-line', linePrefix: ':: ' })
      ],
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'translated link'
    });

    expect(session.execute('link')).toBe(true);
    expect(document.snapshot().value).toBe('[translated link](https://)');
    document.port.applyTextChange({ value: '', selection: { direction: 'none', end: 0, start: 0 } });
    expect(session.execute('custom-wrap')).toBe(true);
    expect(document.snapshot().value).toBe('<x>value</x>');
    document.port.applyTextChange({ value: 'item', selection: { direction: 'none', end: 4, start: 0 } });
    expect(session.execute('custom-line')).toBe(true);
    expect(document.snapshot().value).toBe(':: item');
  });

  it('delegates external commands without mutating or refocusing the document', () => {
    const document = documentPort('body', 4, 4);
    const executeExternalCommand = vi.fn(() => true);
    const session = createToolbarCommandSession({
      commands: [command({ action: 'image', id: 'image' })],
      document: document.port,
      executeExternalCommand,
      linkText: 'link text'
    });

    expect(session.execute('image')).toBe(true);
    expect(document.snapshot().value).toBe('body');
    expect(document.port.focus).not.toHaveBeenCalled();
    expect(executeExternalCommand).toHaveBeenCalledWith('image');
  });

  it('claims only document mutations and the delegated image command', () => {
    const document = documentPort('body', 4, 4);
    const session = createToolbarCommandSession({
      commands: [
        command({ action: 'wrap', id: 'bold', prefix: '**', suffix: '**' }),
        command({ action: 'image', id: 'image' }),
        command({ action: 'copyWechat', group: 'export', id: 'copywechat' })
      ],
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    expect(session.owns('bold')).toBe(true);
    expect(session.owns('image')).toBe(true);
    expect(session.owns('copywechat')).toBe(false);
    expect(session.owns('missing')).toBe(false);
  });

  it('rejects unknown command identifiers without changing the document', () => {
    const document = documentPort('body', 4, 4);
    const session = createToolbarCommandSession({
      commands: [],
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    expect(session.execute('missing')).toBe(false);
    expect(document.snapshot().value).toBe('body');
  });

  it('rejects command completion after teardown', () => {
    const document = documentPort('body', 4, 4);
    const session = createToolbarCommandSession({
      commands: [command({ prefix: '**', suffix: '**' })],
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    session.dispose();
    session.dispose();
    expect(session.execute('fixture')).toBe(false);
    expect(document.snapshot().value).toBe('body');
  });
});
