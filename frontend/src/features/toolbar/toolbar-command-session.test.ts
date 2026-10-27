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

    expect(session.plan('fixture')).toEqual({
      change: {
        changes: { from: 7, insert: '**text**', to: 11 },
        selection: { direction: 'backward', end: 13, start: 9 },
        value: 'before **text** after'
      },
      expected: {
        selection: { direction: 'backward', end: 11, start: 7 },
        value: 'before text after'
      }
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

describe('toolbar heading blocks', () => {
  const headingCommands = [
    ...[1, 2, 3, 4, 5, 6].map((level) =>
      command({ action: 'heading', id: `heading${level}`, level })
    ),
    command({ action: 'paragraph', id: 'paragraph' })
  ];

  function headingSession(
    value: string,
    start: number,
    end: number,
    direction: 'backward' | 'forward' | 'none' = 'none'
  ) {
    const document = documentPort(value, start, end, direction);
    const session = createToolbarCommandSession({
      commands: headingCommands,
      document: document.port,
      executeExternalCommand: vi.fn(),
      linkText: 'link text'
    });

    return { session, snapshot: document.snapshot };
  }

  it('converts a Setext heading body into the target ATX level', () => {
    const document = headingSession('Intro\nTitle\n=====\nOutro', 8, 8);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot()).toEqual({
      selection: { direction: 'none', end: 14, start: 6 },
      value: 'Intro\n## Title\nOutro'
    });
  });

  it('converts a fully selected Setext heading into the target ATX level', () => {
    const document = headingSession('Intro\nTitle\n=====\nOutro', 6, 17);
    expect(document.session.execute('heading3')).toBe(true);
    expect(document.snapshot().value).toBe('Intro\n### Title\nOutro');
  });

  it('converts a Setext heading selected at its underline', () => {
    const document = headingSession('Intro\nTitle\n=====\nOutro', 14, 14);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('Intro\n## Title\nOutro');
  });

  it('converts a Setext H2 underline and a Setext heading at end of file', () => {
    const h2 = headingSession('Title\n-----\nbody', 2, 2);
    expect(h2.session.execute('heading1')).toBe(true);
    expect(h2.snapshot().value).toBe('# Title\nbody');
    const last = headingSession('Title\n=====', 2, 2);
    expect(last.session.execute('heading3')).toBe(true);
    expect(last.snapshot().value).toBe('### Title');
  });

  it('converts a Setext heading into a paragraph without the underline', () => {
    const document = headingSession('Intro\nTitle\n=====\nOutro', 8, 8);
    expect(document.session.execute('paragraph')).toBe(true);
    expect(document.snapshot().value).toBe('Intro\nTitle\nOutro');
  });

  it('keeps a thematic break that follows a list item inside the selection', () => {
    const document = headingSession('- item\n---\nnext', 3, 3);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('## item\n---\nnext');
  });

  it('keeps underline-like text after an ATX heading as its own block', () => {
    const document = headingSession('##\n=====', 1, 1);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('##\n=====');
  });

  it('converts an empty ATX heading into the target level for every level', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const document = headingSession('body\n## \ntail', 7, 7);
      expect(document.session.execute(`heading${level}`)).toBe(true);
      expect(document.snapshot().value).toBe(`body\n${'#'.repeat(level)}\ntail`);
    }
    const spaced = headingSession('## ', 2, 2);
    expect(spaced.session.execute('heading4')).toBe(true);
    expect(spaced.snapshot().value).toBe('####');
    const markerless = headingSession('##', 2, 2);
    expect(markerless.session.execute('heading6')).toBe(true);
    expect(markerless.snapshot().value).toBe('######');
  });

  it('converts an empty ATX heading into an empty paragraph line', () => {
    const document = headingSession('body\n##\ntail', 6, 6);
    expect(document.session.execute('paragraph')).toBe(true);
    expect(document.snapshot().value).toBe('body\n\ntail');
  });
  it('keeps an underline-like line inside a fenced code block', () => {
    const document = headingSession('```\nalpha\n---\n```', 6, 6);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot()).toEqual({
      selection: { direction: 'none', end: 12, start: 4 },
      value: '```\n## alpha\n---\n```'
    });
  });

  it('keeps an underline-like line inside a CRLF fenced code block', () => {
    const document = headingSession('```\r\nalpha\r\n---\r\n```', 7, 7);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('```\r\n## alpha\r\n---\r\n```');
  });

  it('keeps a tab-indented line that is not a Setext underline', () => {
    const document = headingSession('alpha\n\t---', 1, 1);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('## alpha\n\t---');
  });

  it('converts a multi-line Setext heading selected at its first body line', () => {
    const document = headingSession('First line\nsecond line\n---', 2, 2);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot()).toEqual({
      selection: { direction: 'none', end: 13, start: 0 },
      value: '## First line\nsecond line'
    });
  });

  it('converts a multi-line Setext heading selected at its second body line', () => {
    const document = headingSession('First line\nsecond line\n---', 15, 15);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot()).toEqual({
      selection: { direction: 'none', end: 25, start: 11 },
      value: 'First line\n## second line'
    });
  });

  it('converts a fully selected multi-line Setext heading', () => {
    const document = headingSession('First line\nsecond line\n---', 0, 26);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('## First line\n## second line');
  });

  it('converts a multi-line Setext heading selected at its underline', () => {
    const document = headingSession('First line\nsecond line\n---', 24, 24);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('First line\n## second line');
  });

  it('keeps the following block when a multi-line Setext heading loses its underline', () => {
    const document = headingSession('First line\nsecond line\n---\nTail', 2, 2);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('## First line\nsecond line\nTail');
  });

  it('converts a CRLF Setext heading body without mixing line endings', () => {
    const document = headingSession('Intro\r\nTitle\r\n=====\r\nOutro', 8, 8);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot()).toEqual({
      selection: { direction: 'none', end: 15, start: 7 },
      value: 'Intro\r\n## Title\r\nOutro'
    });
  });

  it('converts a fully selected CRLF Setext heading without mixing line endings', () => {
    const document = headingSession('Intro\r\nTitle\r\n=====\r\nOutro', 7, 19);
    expect(document.session.execute('heading3')).toBe(true);
    expect(document.snapshot().value).toBe('Intro\r\n### Title\r\nOutro');
  });

  it('converts a CRLF Setext heading selected at its underline', () => {
    const document = headingSession('Intro\r\nTitle\r\n=====\r\nOutro', 16, 16);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('Intro\r\n## Title\r\nOutro');
  });

  it('removes a CRLF multi-line Setext underline for the paragraph command', () => {
    const document = headingSession('First line\r\nsecond line\r\n---\r\nTail', 2, 2);
    expect(document.session.execute('paragraph')).toBe(true);
    expect(document.snapshot().value).toBe('First line\r\nsecond line\r\nTail');
  });

  it('converts a CRLF empty ATX heading into the target level', () => {
    const document = headingSession('body\r\n## \r\ntail', 7, 7);
    expect(document.session.execute('heading4')).toBe(true);
    expect(document.snapshot().value).toBe('body\r\n####\r\ntail');
  });

  it('preserves standalone CR boundaries while converting an ATX heading', () => {
    const document = headingSession('# Head\rTail', 2, 2);
    expect(document.session.execute('heading2')).toBe(true);
    expect(document.snapshot().value).toBe('## Head\rTail');
  });

  it('converts standalone CR Setext headings without swallowing the underline', () => {
    const heading = headingSession('Title\r===\rAfter', 2, 2);
    expect(heading.session.execute('heading2')).toBe(true);
    expect(heading.snapshot().value).toBe('## Title\rAfter');

    const paragraph = headingSession('Title\r===\rAfter', 2, 2);
    expect(paragraph.session.execute('paragraph')).toBe(true);
    expect(paragraph.snapshot().value).toBe('Title\rAfter');
  });
});
