import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewEditMap,
  PreviewEditMapBlock
} from '../../contracts/ports/preview-request';
import {
  isMarkdownTerminalWhitespaceSuffix,
  markdownLineStarts
} from '../../shared/markdown/markdown-line-model';

import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  applyVisualMarkdownEditIntent,
  captureVisualThematicBreakSelection,
  prepareVisualThematicBreakPointerSelection,
  captureVisualCodeInputSnapshot,
  classifyVisualSelectionProvenance,
  createVisualImageInteraction,
  createVisualMarkdownSourceIntervalMap,
  mapTextBoundaryFromInterval,
  expandVisualCodeFenceForBody,
  foldVisualMarkdownSoftBreaks,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualMarkdownSourceRangeFromPreviewEditMap,
  createVisualCodeBodyIntervalForPreviewBlock,
  createVisualMarkdownWindowChange,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChange,
  mergeVisualMarkdownChangeDetails,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  placeVisualCaretAtAcceptedPasteDocumentBoundary,
  placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd,
  placeVisualCaretFromSourceOffset,
  visualCaretBoundaryFromSourceOffset,
  visualCodeFenceRootSourceOffset,
  visualBoundarySourceOffset,
  prepareVisualTaskListMarkers,
  protectVisualMarkdownReadOnlyRegions,
  projectVisualCodeBodySelection,
  projectVisualMarkdownRemovalSelection,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  shouldNormalizeVisualImageContextMenuSelection,
  serializeVisualMarkdown,
  serializeVisualMarkdownBlockFragment,
  visualSelectionSourceRangeForBlocks,
  visualSelectionSourceRange,
  visualEmptyStructuralBodySelection,
  visualThematicBreakSourceSelection,
  visualCodeBodyOrdinalForSourceRange,
  createVisualCodeBodyOrdinalsForPreviewBlocks,
  visualCodeBlockStructureSignature,
  visualStructuralBoundaryRows
} from './visual-markdown';

function editor(html: string): HTMLElement {
  const element = document.createElement('article');
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

function placeCaret(element: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(element, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** One inert image-interaction owner for tests that drive it directly. */
function imageInteraction(surface: HTMLElement) {
  return createVisualImageInteraction(surface, {
    canActivate: () => true,
    focus: () => undefined,
    report: () => undefined,
    synchronizeSelection: () => true
  });
}

/** Select once through a throwaway owner, as a single demand would. */
function selectImage(
  surface: HTMLElement,
  target: Element | null | undefined,
  gesture: 'activation' | 'keyboard' | 'pointer' = 'keyboard'
): boolean {
  const interaction = imageInteraction(surface);
  try {
    return interaction.select(target, gesture);
  } finally {
    interaction.dispose();
  }
}

function previewEditMap(
  blocks: ReadonlyArray<PreviewEditMapBlock>
): PreviewEditMap {
  return {
    blocks,
    coordinate: 'line',
    signature: 'test-signature',
    version: 1
  };
}

function previewBlock(
  id: string,
  startLine: number,
  endLine: number,
  editable = true
): PreviewEditMapBlock {
  return { editable, endLine, id, startLine };
}

describe('visual Markdown editing', () => {
  it('reports empty structural serialization shapes', () => {
    const list = editor('<ul><li><br></li></ul>');
    const quote = editor('<blockquote><p><br></p></blockquote>');
    expect({
      list: serializeVisualMarkdown(list),
      quote: serializeVisualMarkdown(quote)
    }).toEqual({ list: '-', quote: '>' });
    list.remove();
    quote.remove();
  });

  it.each([
    ['<ul>\n<li><br></li>\n</ul>', 'UL'],
    ['<blockquote>\n<p><br></p>\n</blockquote>', 'BLOCKQUOTE']
  ])(
    'recognizes formatted empty %s as a structural Backspace boundary',
    (markup, tagName) => {
      const surface = editor(markup);
      const block = surface.firstElementChild;
      if (!(block instanceof HTMLElement)) {
        throw new Error('visual-empty-structural-block-missing');
      }
      const editable = block.querySelector('li, p') ?? block;
      placeCaret(editable, editable.childNodes.length);
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      });
      expect(applyVisualBlockShortcut(surface, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(surface.firstElementChild?.tagName).toBe('P');
      expect(block.tagName).toBe(tagName);
      // The replacement paragraph carries only the renderer's BR placeholder, so
      // the native caret must sit at the block start rather than after it.
      const replacement = surface.firstElementChild;
      if (!(replacement instanceof HTMLParagraphElement)) {
        throw new Error('visual-empty-structural-replacement-missing');
      }
      expect(replacement.childNodes).toHaveLength(1);
      expect(replacement.firstChild).toBeInstanceOf(HTMLBRElement);
      const caret = window.getSelection();
      expect(caret?.isCollapsed).toBe(true);
      expect(caret?.anchorNode).toBe(replacement);
      expect(caret?.anchorOffset).toBe(0);
      surface.remove();
    }
  );

  it('preserves a literal space inside a list item as content', () => {
    const surface = editor('<ul>\n<li> </li>\n</ul>');
    const item = surface.querySelector('li');
    if (!(item instanceof HTMLElement)) {
      throw new Error('visual-space-list-item-missing');
    }
    const text = item.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-space-list-text-missing');
    }
    placeCaret(text, text.length);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });
    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    surface.remove();
  });

  it('preserves direct quote content beside an empty structural paragraph', () => {
    const surface = editor('<blockquote>\n<p><br></p>Direct\n</blockquote>');
    const paragraph = surface.querySelector('blockquote > p');
    if (!(paragraph instanceof HTMLElement)) {
      throw new Error('visual-direct-quote-paragraph-missing');
    }
    placeCaret(paragraph, paragraph.childNodes.length);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });
    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    surface.remove();
  });

  it.each([
    '- \n\n[ref]: https://example.test',
    '> \n\n[ref]: https://example.test'
  ])(
    'preserves reference definitions when a visible structural marker is removed',
    (sourceMarkdown) => {
      const result = mergeVisualMarkdownChangeDetails(
        sourceMarkdown,
        sourceMarkdown.slice(0, 2),
        ''
      );
      expect(result.value).toBe('\n\n[ref]: https://example.test');
    }
  );

  it.each([
    {
      baseline: '-',
      boundary: 2,
      source: '- ',
      expected: '- ~x'
    },
    {
      baseline: '-',
      boundary: 2,
      source: '-  ',
      expected: '- ~x '
    },
    {
      baseline: '>',
      boundary: 2,
      source: '> ',
      expected: '> ~x'
    },
    {
      baseline: '>',
      boundary: 2,
      source: '>  ',
      expected: '> ~x '
    },
    {
      baseline: '> -',
      boundary: 4,
      source: '> - ',
      expected: '> - ~x'
    },
    {
      baseline: '#',
      boundary: 2,
      source: '# ',
      expected: '# ~x'
    }
  ])(
    'maps an empty structural body after its parser-owned separator',
    ({ baseline, boundary, expected, source }) => {
      const map = createVisualMarkdownSourceIntervalMap(source, baseline);
      expect(map.resolve(baseline.length)).toBe(boundary);
      expect(mergeVisualMarkdownChange(source, baseline, `${baseline} ~x`)).toBe(expected);
    }
  );

  it('does not classify a code-body separator as a structural body boundary', () => {
    const map = createVisualMarkdownSourceIntervalMap(
      '```\n- ',
      '```\n-'
    );
    expect(map.structuralSourceBoundary).toBeNull();
  });

  it.each([
    ['- ', '-'],
    ['> ', '>']
  ])(
    'retains hidden reference definitions after empty structural insertion',
    (markerSource, markerVisual) => {
      const source = `${markerSource}\n\n[ref]: https://example.test`;
      const edited = `${markerVisual} ~x`;
      expect(mergeVisualMarkdownChange(source, markerVisual, edited)).toBe(
        `${markerSource}~x\n\n[ref]: https://example.test`
      );
    }
  );

  it('maps CRLF, lone-CR, and LF line starts with the same UTF-16 offsets', () => {
    expect(markdownLineStarts('A\r\nB\rC\n')).toEqual([0, 3, 5, 7]);
  });

  it.each([
    { accepted: true, suffix: '' },
    { accepted: true, suffix: ' \t' },
    { accepted: true, suffix: '\r \t' },
    { accepted: true, suffix: '\r\n\t\r\n' },
    { accepted: true, suffix: '\n\r' },
    { accepted: false, suffix: '\r visible' },
    { accepted: false, suffix: '\u00a0' },
    { accepted: false, suffix: '\r\u00a0\r' },
    { accepted: false, suffix: '\u2028' },
    { accepted: false, suffix: '\r\u2028\r' }
  ])('recognizes only mapped terminal Markdown whitespace suffixes', ({
    accepted,
    suffix
  }) => {
    expect(isMarkdownTerminalWhitespaceSuffix(suffix)).toBe(accepted);
  });

  it.each([
    { blankLineCount: 0, fence: '~~~' },
    { blankLineCount: 1, fence: '~~~' },
    { blankLineCount: 2, fence: '```' },
    { blankLineCount: 3, fence: '~~~' }
  ])(
    'projects $blankLineCount blank body lines from the Preview block for $fence',
    ({ blankLineCount, fence }) => {
      const markdown = `Before\n\n${fence}\n${'\n'.repeat(blankLineCount)}${fence}\n\nAfter`;
      const closingLine = 3 + blankLineCount;
      const editMap = previewEditMap([
        previewBlock('b0', 0, 1),
        previewBlock('b1', 2, closingLine + 1),
        previewBlock('b2', closingLine + 2, closingLine + 3)
      ]);

      const projection = createVisualCodeBodyIntervalForPreviewBlock(
        markdown,
        editMap,
        'b1'
      );

      expect(markdown.slice(projection.bodyStart, projection.bodyEnd))
        .toBe('\n'.repeat(blankLineCount));
      expect(projection.codeOrdinal).toBe(0);
      expect(projection.fence).toBe(fence);
      expect(projection.emptyBodyLineCount).toBe(blankLineCount);
    }
  );

  it('maps CRLF code body offsets without changing the source line ending', () => {
    const markdown = 'Before\r\n\r\n~~~\r\n\r\n\r\n~~~\r\n\r\nAfter';
    const editMap = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 6),
      previewBlock('b2', 7, 8)
    ]);
    const projection = createVisualCodeBodyIntervalForPreviewBlock(
      markdown,
      editMap,
      'b1'
    );

    expect(markdown.slice(projection.bodyStart, projection.bodyEnd))
      .toBe('\r\n\r\n');
    expect(projection.lineEnding).toBe('\r\n');
    expect(projection.emptyBodyLineCount).toBe(2);
  });

  it.each(['~~~', '```'])(
    'restores a lone-CR %s fence from canonical Markdown',
    (fence) => {
      const markdown = `${fence}js\rAlpha\r${fence}`;
      const surface = editor('<pre><code class="language-js">Alpha\n</code></pre>');

      restoreVisualCodeFenceFamilies(surface, markdown);

      expect(surface.querySelector('pre')?.getAttribute(
        'data-easymde-visual-fence'
      )).toBe(fence);
      expect(serializeVisualMarkdown(surface)).toBe(
        markdown.replace(/\r\n|\r/g, '\n')
      );
    }
  );

  it('maps lone-CR code body offsets without changing the source line ending', () => {
    const markdown = 'Before\r\r~~~\r\r\r~~~\r\rAfter';
    const editMap = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 6),
      previewBlock('b2', 7, 8)
    ]);
    const projection = createVisualCodeBodyIntervalForPreviewBlock(
      markdown,
      editMap,
      'b1'
    );

    expect(createVisualMarkdownSourceRangeFromPreviewEditMap(
      markdown,
      editMap,
      { end: 2, start: 1 }
    )).toEqual({ end: 18, start: 8 });
    expect(markdown.slice(projection.bodyStart, projection.bodyEnd))
      .toBe('\r\r');
    expect(projection.lineEnding).toBe('\r');
    expect(projection.emptyBodyLineCount).toBe(2);
  });

  it.each([
    {
      codeBody: 'Alpha\n',
      label: 'closed backtick with LF',
      markdown: '```js\nAlpha\n```'
    },
    {
      codeBody: 'Alpha\n',
      label: 'open backtick without a final LF',
      markdown: '```js\nAlpha'
    },
    {
      codeBody: 'Alpha\n',
      label: 'open tilde with CRLF',
      markdown: '~~~js\r\nAlpha\r\n'
    },
    {
      codeBody: 'Alpha \n',
      label: 'open tilde with trailing body space',
      markdown: '~~~js\nAlpha \n'
    },
    {
      codeBody: '',
      label: 'bare open tilde',
      markdown: '~~~'
    },
    {
      codeBody: '\n',
      label: 'open empty code body after one blank line',
      markdown: '~~~js\n\n'
    }
  ])('serializes the $label from accepted EOF topology', ({
    codeBody,
    markdown
  }) => {
    const surface = editor('');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-js';
    code.textContent = codeBody;
    pre.append(code);
    surface.append(pre);
    restoreVisualCodeFenceFamilies(surface, markdown);

    expect(serializeVisualMarkdown(surface)).toBe(
      markdown.replace(/\r\n|\r/g, '\n')
    );
  });

  it.each(['~~~', '```'])(
    'keeps an expanded literal %s run open at EOF in both source and DOM serialization',
    (fence) => {
      const body = `Alpha\n${fence}x\n`;
      const base = `${fence}\nAlpha\n\n`;
      const outerFence = fence[0]?.repeat(fence.length + 1);
      const expected = `${outerFence}\n${body}`;
      const expanded = expandVisualCodeFenceForBody(base, 0, body);
      const surface = editor('');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = body;
      pre.append(code);
      surface.append(pre);
      restoreVisualCodeFenceFamilies(surface, expected);

      expect(expanded?.markdown).toBe(expected);
      expect(serializeVisualMarkdown(surface)).toBe(expected);
    }
  );

  it('discards forged open-EOF metadata when restoring a closed source fence', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence-open-eof="999999"><code class="language-js">Alpha\n</code></pre>'
    );
    const markdown = '~~~js\nAlpha\n~~~';

    restoreVisualCodeFenceFamilies(surface, markdown);

    expect(surface.querySelector('pre')?.hasAttribute(
      'data-easymde-visual-fence-open-eof'
    )).toBe(false);
    expect(serializeVisualMarkdown(surface)).toBe(markdown);
  });

  it.each(['~~~', '```'])(
    'expands the %s outer fence around a literal body run',
    (fence) => {
      const source = `${fence}js\nBefore\n\nAfter\n${fence}`;
      const body = `Before\n${fence}x\nAfter\n`;
      const expanded = expandVisualCodeFenceForBody(source, 0, body);
      const outerFence = fence[0]?.repeat(fence.length + 1);

      expect(expanded).toEqual({
        fence: outerFence,
        markdown: `${outerFence}js\n${body}${outerFence}`,
        openingFenceDelta: 1,
        unexpandedMarkdown: `${fence}js\n${body}${fence}`
      });
    }
  );

  it('expands a fenced code body while retaining surrounding CRLF source', () => {
    const before = '# Before\r\n\r\n';
    const after = '\r\n\r\n# After';
    const fence = '~~~';
    const source = `${before}${fence}js\r\nBefore\r\n\r\nAfter\r\n${fence}\r\n${after}`;
    const body = `Before\n${fence}\nAfter\n`;
    const expanded = expandVisualCodeFenceForBody(source, 0, body);
    const outerFence = '~~~~';

    expect(expanded?.markdown).toBe(
      `${before}${outerFence}js\r\nBefore\r\n${fence}\r\nAfter\r\n${outerFence}\r\n${after}`
    );
    expect(expanded?.openingFenceDelta).toBe(1);
  });

  it('resolves a source selection to its unique closed fenced code body', () => {
    const markdown = [
      'Before',
      '',
      '~~~js',
      'First',
      '~~~',
      '',
      '```py',
      'Second',
      '```',
      '',
      'After'
    ].join('\n');
    const secondBody = markdown.indexOf('Second');

    expect(visualCodeBodyOrdinalForSourceRange(markdown, {
      end: secondBody + 'Second'.length,
      start: secondBody
    })).toBe(1);
    expect(() => visualCodeBodyOrdinalForSourceRange(markdown, {
      end: markdown.length,
      start: markdown.length
    })).toThrow('visual-editor-code-body-map-ambiguous');
  });

  it.each(['~~~', '```'])(
    'maps an editable unclosed %s fence at EOF from its Preview edit range',
    (fence) => {
      const markdown = fence;
      const editMap = previewEditMap([previewBlock('b0', 0, 1)]);

      expect(createVisualCodeBodyOrdinalsForPreviewBlocks(
        markdown,
        editMap
      ).get('b0')).toBe(0);
      expect(createVisualCodeBodyIntervalForPreviewBlock(
        markdown,
        editMap,
        'b0'
      )).toEqual({
        bodyEnd: markdown.length,
        bodyStart: markdown.length,
        closed: false,
        codeOrdinal: 0,
        emptyBodyLineCount: 0,
        fence,
        info: '',
        lineEnding: '',
        sourceBlockEnd: markdown.length,
        sourceBlockStart: 0
      });
      expect(visualCodeBodyOrdinalForSourceRange(markdown, {
        end: markdown.length,
        start: markdown.length
      })).toBe(0);
    }
  );

  it('maps source-backed code after a leading zero-line generated Preview root', () => {
    const markdown = '~~~js\nAlpha\n~~~';
    const editMap = previewEditMap([
      previewBlock('b0', 0, 0, false),
      previewBlock('b1', 0, 3)
    ]);

    expect(createVisualCodeBodyOrdinalsForPreviewBlocks(
      markdown,
      editMap
    )).toEqual(new Map([['b1', 0]]));
  });

  it('skips a trailing generated root at the one-past-final source line', () => {
    const markdown = '~~~js\nAlpha\n~~~';
    const editMap = previewEditMap([
      previewBlock('b0', 0, 3),
      previewBlock('b1', 3, 3, false)
    ]);

    expect(createVisualCodeBodyOrdinalsForPreviewBlocks(
      markdown,
      editMap
    )).toEqual(new Map([['b0', 0]]));
  });

  it.each([
    {
      blocks: [previewBlock('b0', 0, 3), previewBlock('b1', 4, 4, false)],
      name: 'a generated range beyond the final line'
    },
    {
      blocks: [previewBlock('b0', 0, 3), previewBlock('b1', 2, 2, false)],
      name: 'an out-of-order generated range'
    },
    {
      blocks: [previewBlock('b0', 3, 3)],
      name: 'an editable zero-width range'
    }
  ])('rejects $name while mapping code body ordinals', ({ blocks }) => {
    expect(() => createVisualCodeBodyOrdinalsForPreviewBlocks(
      '~~~js\nAlpha\n~~~',
      previewEditMap(blocks)
    )).toThrow('visual-editor-code-block-map-invalid');
  });

  it('anchors a trailing noneditable generated row at end of file', () => {
    // The formal renderer places a generated root after a final block that has
    // no terminal newline, so its exclusive line coordinate is one past the
    // last line start. That sentinel is a real zero-width anchor at the end of
    // the source, not an out-of-range row.
    const markdown = '~~~js\nAlpha\n~~~';
    const rows = visualStructuralBoundaryRows(
      markdown,
      previewEditMap([
        previewBlock('b0', 0, 3, false),
        previewBlock('b1', 3, 3, false)
      ])
    );

    expect(rows).toEqual([
      { editable: false, end: markdown.length, id: 'b0', start: 0 },
      { editable: false, end: markdown.length, id: 'b1', start: markdown.length }
    ]);
  });

  it('keeps repeated zero-width EOF anchors in their own order', () => {
    const markdown = 'Beta';
    const rows = visualStructuralBoundaryRows(
      markdown,
      previewEditMap([
        previewBlock('b0', 0, 1),
        previewBlock('b1', 1, 1, false),
        previewBlock('b2', 1, 1, false)
      ])
    );

    expect(rows).toEqual([
      { editable: true, end: 4, id: 'b0', start: 0 },
      { editable: false, end: 4, id: 'b1', start: 4 },
      { editable: false, end: 4, id: 'b2', start: 4 }
    ]);
  });

  it.each([
    {
      blocks: [previewBlock('b0', 0, 1), previewBlock('b1', 1, 1)],
      name: 'an editable EOF sentinel',
      source: 'Beta'
    },
    {
      blocks: [previewBlock('b0', 0, 1), previewBlock('b1', 2, 2, false)],
      name: 'an EOF row past the sentinel line',
      source: 'Beta'
    },
    {
      blocks: [previewBlock('b0', 0, 1), previewBlock('b1', 1, 2, false)],
      name: 'a positive-width EOF row',
      source: 'Beta'
    },
    {
      blocks: [previewBlock('b0', 1, 0, false)],
      name: 'a descending EOF row',
      source: ''
    },
    {
      blocks: [previewBlock('b0', -1, 0, false)],
      name: 'a negative EOF row',
      source: ''
    }
  ])('rejects $name in the structural row projection', ({ blocks, source }) => {
    expect(visualStructuralBoundaryRows(source, previewEditMap(blocks)))
      .toEqual([]);
  });

  it('anchors a generated row at the end of an empty document', () => {
    expect(visualStructuralBoundaryRows(
      '',
      previewEditMap([previewBlock('b0', 1, 1, false)])
    )).toEqual([{ editable: false, end: 0, id: 'b0', start: 0 }]);
  });

  it.each(['~~~', '```'])(
    'widens an open EOF %s fence around a literal body fence and stays open',
    (fence) => {
      const source = `${fence}\nAlpha\n`;
      const body = `Alpha\n${fence}\nAfter\n`;
      const expanded = expandVisualCodeFenceForBody(source, 0, body);
      const outerFence = fence[0]?.repeat(fence.length + 1);

      expect(expanded).toEqual({
        fence: outerFence,
        markdown: `${outerFence}\n${body}`,
        openingFenceDelta: 1,
        unexpandedMarkdown: `${fence}\n${body}`
      });
      expect(createVisualCodeBodyIntervalForPreviewBlock(
        expanded?.markdown ?? '',
        previewEditMap([previewBlock('b0', 0, 4)]),
        'b0'
      ).closed).toBe(false);
    }
  );

  it('maps source offsets through an accepted Highlight.js token span', () => {
    const markdown = '~~~js\nAlpha\n~~~';
    const surface = editor(
      '<pre><code><span class="hljs-keyword">Al</span>pha\n</code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const token = code?.querySelector('span')?.firstChild;
    if (!(code instanceof HTMLElement) || !(token instanceof Text)) {
      throw new Error('visual-code-highlight-token-fixture-missing');
    }
    placeCaret(token, 1);

    const projection = projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: token, offset: 1 },
        start: { node: token, offset: 1 }
      }
    );

    expect(projection.sourceSelection).toEqual({ end: 7, start: 7 });
    expect(projection.localSelection).toEqual({ end: 1, start: 1 });
  });

  it('projects a caret through a plain single-text browser span', () => {
    const markdown = '~~~js\nAlpha\n~~~';
    const surface = editor('<pre><code>A<span>l</span>pha\n</code></pre>');
    const code = surface.querySelector('pre > code');
    const wrapper = code?.querySelector('span');
    const text = wrapper?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(wrapper instanceof HTMLSpanElement)
      || !(text instanceof Text)
    ) {
      throw new Error('visual-browser-text-span-fixture-missing');
    }
    placeCaret(text, 1);

    const projection = projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: text, offset: 1 },
        start: { node: text, offset: 1 }
      }
    );

    expect(projection.localSelection).toEqual({ end: 2, start: 2 });
    expect(projection.sourceSelection).toEqual({ end: 8, start: 8 });
    expect(wrapper.isConnected).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(1);
  });

  it('projects lone-CR code body source offsets through an LF Preview DOM', () => {
    const sourceMarkdown = '~~~js\rAlpha\r~~~';
    const visualMarkdown = '~~~js\nAlpha\n~~~';
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code>Alpha\n</code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-lone-cr-code-projection-fixture-missing');
    }
    placeCaret(text, 6);

    const projection = projectVisualCodeBodySelection(
      code,
      sourceMarkdown,
      visualMarkdown,
      0,
      {
        end: { node: text, offset: 6 },
        start: { node: text, offset: 6 }
      }
    );

    expect(projection.sourceText).toBe('Alpha\r');
    expect(projection.visualText).toBe('Alpha\n');
    expect(projection.localSelection).toEqual({ end: 6, start: 6 });
    expect(projection.sourceSelection).toEqual({
      end: projection.sourceInterval.bodyStart + 6,
      start: projection.sourceInterval.bodyStart + 6
    });
    expect(projection.visualSelection).toEqual({
      end: projection.visualInterval.bodyStart + 6,
      start: projection.visualInterval.bodyStart + 6
    });
  });

  it('returns a caret boundary for a detached region without changing Selection', () => {
    const detached = document.createElement('article');
    detached.innerHTML = '<p>Markdown content</p>';
    const selectedText = document.createTextNode('unrelated selection');
    document.body.append(selectedText);
    placeCaret(selectedText, 4);

    const boundary = visualCaretBoundaryFromSourceOffset(
      detached,
      'Markdown content',
      'Markdown content',
      4
    );

    expect(boundary.node).toBe(detached.querySelector('p')?.firstChild);
    expect(boundary.offset).toBe(4);
    expect(window.getSelection()?.anchorNode).toBe(selectedText);
    expect(window.getSelection()?.anchorOffset).toBe(4);
    selectedText.remove();
  });

  it('maps code text when serialization contributes its terminal newline', () => {
    const markdown = '~~~js\nAlpha\n~~~';
    const surface = editor('<pre><code>Alpha</code></pre>');
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-code-terminal-newline-fixture-missing');
    }
    placeCaret(text, 2);

    const projection = projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: text, offset: 2 },
        start: { node: text, offset: 2 }
      }
    );

    expect(projection.localSelection).toEqual({ end: 2, start: 2 });
    expect(projection.sourceSelection).toEqual({ end: 8, start: 8 });
  });

  it('maps an open EOF code body when rendered code adds a terminal newline after blank lines', () => {
    const sourceMarkdown = '~~~\n\n\n\n';
    const visualMarkdown = '~~~\n\n\n\n\n';
    const surface = editor('<pre><code>\n\n\n\n</code></pre>');
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-open-code-terminal-newline-fixture-missing');
    }
    placeCaret(text, 3);

    const projection = projectVisualCodeBodySelection(
      code,
      sourceMarkdown,
      visualMarkdown,
      0,
      {
        end: { node: text, offset: 3 },
        start: { node: text, offset: 3 }
      }
    );

    expect(projection.sourceText).toBe('\n\n\n');
    expect(projection.visualText).toBe('\n\n\n\n');
    expect(projection.localSelection).toEqual({ end: 3, start: 3 });
    expect(projection.sourceSelection).toEqual({ end: 7, start: 7 });
    expect(projection.visualSelection).toEqual({ end: 7, start: 7 });
    expect(() => projectVisualCodeBodySelection(
      code,
      sourceMarkdown,
      '~~~\n\n\n\n\n\n\n',
      0,
      {
        end: { node: text, offset: 3 },
        start: { node: text, offset: 3 }
      }
    )).toThrow('visual-editor-code-body-projection-mismatch');
    expect(() => projectVisualCodeBodySelection(
      code,
      sourceMarkdown,
      '~~~\n\nX\n',
      0,
      {
        end: { node: text, offset: 3 },
        start: { node: text, offset: 3 }
      }
    )).toThrow('visual-editor-code-body-projection-mismatch');
  });

  it.each([
    {
      markdown: '~~~\n~~~',
      sourceBody: '',
      visualMarkdown: '~~~\n\n~~~'
    },
    {
      markdown: '~~~\n\n~~~',
      sourceBody: '\n',
      visualMarkdown: '~~~\n\n~~~'
    },
    {
      markdown: '```js\n```',
      sourceBody: '',
      visualMarkdown: '```js\n\n```'
    },
    {
      markdown: '```js\n\n```',
      sourceBody: '\n',
      visualMarkdown: '```js\n\n```'
    },
    {
      markdown: '~~~\r\r~~~',
      sourceBody: '\r',
      visualMarkdown: '~~~\n\n~~~'
    }
  ])('maps an accepted empty $markdown code placeholder to its source body', ({
    markdown,
    sourceBody,
    visualMarkdown
  }) => {
    const surface = editor(
      '<pre><code><span data-easymde-visual-code-placeholder=""></span></code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const placeholder = code?.querySelector(
      '[data-easymde-visual-code-placeholder]'
    );
    if (!(code instanceof HTMLElement) || !(placeholder instanceof HTMLSpanElement)) {
      throw new Error('visual-code-empty-placeholder-projection-fixture-missing');
    }
    placeholder.append(document.createTextNode(''));
    const marker = placeholder.firstChild;
    if (!(marker instanceof Text)) {
      throw new Error('visual-code-empty-placeholder-text-missing');
    }
    placeCaret(marker, 0);

    const projection = projectVisualCodeBodySelection(
      code,
      markdown,
      visualMarkdown,
      0,
      {
        end: { node: marker, offset: 0 },
        start: { node: marker, offset: 0 }
      }
    );

    expect(markdown.slice(
      projection.sourceInterval.bodyStart,
      projection.sourceInterval.bodyEnd
    )).toBe(sourceBody);
    expect(projection.visualText).toBe('\n');
    expect(projection.sourceSelection).toEqual({
      end: projection.sourceInterval.bodyStart,
      start: projection.sourceInterval.bodyStart
    });
    expect(projection.visualSelection).toEqual({
      end: projection.visualInterval.bodyStart,
      start: projection.visualInterval.bodyStart
    });
  });

  it('maps Chromium collapsed CODE@0 input to the exact empty placeholder', () => {
    const markdown = '~~~\n\n~~~';
    const surface = editor(
      '<pre><code><span data-easymde-visual-code-placeholder=""></span></code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const placeholder = code?.querySelector(
      '[data-easymde-visual-code-placeholder]'
    );
    if (!(code instanceof HTMLElement) || !(placeholder instanceof HTMLSpanElement)) {
      throw new Error('visual-code-chromium-boundary-fixture-missing');
    }
    placeholder.append(document.createTextNode(''));

    const projection = projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: code, offset: 0 },
        start: { node: code, offset: 0 }
      }
    );

    expect(projection.sourceSelection).toEqual({
      end: projection.sourceInterval.bodyStart,
      start: projection.sourceInterval.bodyStart
    });
    expect(projection.localSelection).toEqual({ end: 0, start: 0 });
    expect(() => projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: code, offset: 1 },
        start: { node: code, offset: 0 }
      }
    )).toThrow('visual-editor-code-body-selection-invalid');
    expect(() => projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: code, offset: 1 },
        start: { node: code, offset: 1 }
      }
    )).toThrow('visual-editor-code-body-selection-invalid');
  });

  it.each([
    { body: '', markdown: '~~~\n~~~' },
    { body: '\n', markdown: '~~~\n\n~~~' },
    { body: '\n\n', markdown: '~~~\n\n\n~~~' },
    { body: ' \n', markdown: '~~~\n \n~~~' },
    { body: 'Alpha\n', markdown: '~~~\nAlpha\n~~~' },
    { body: 'Alpha', markdown: '~~~\nAlpha\n~~~' }
  ])('serializes code body $body without adding a structural newline', ({ body, markdown }) => {
    const surface = editor(
      `<pre data-easymde-visual-fence="~~~"><code>${body}</code></pre>`
    );

    expect(serializeVisualMarkdown(surface)).toBe(markdown);
  });

  it.each([
    { body: 'A', caretOffset: 1, expected: 'A\n' },
    { body: '\nA', caretOffset: 2, expected: '\nA\n' },
    { body: 'A\n\n', caretOffset: 1, expected: 'A\n\n' }
  ])('restores only missing terminal newlines from the source body', ({ body, caretOffset, expected }) => {
    const surface = editor(`<pre><code>${body}</code></pre>`);
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-code-body-text-fixture-missing');
    }
    placeCaret(text, Math.min(caretOffset, text.length));

    reconcileVisualCodeBodyDom(code, expected, caretOffset);

    expect(code.textContent).toBe(expected);
    expect(code.childNodes).toHaveLength(1);
    expect(code.firstChild).toBe(text);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(caretOffset);
  });

  it('normalizes one renderer-only terminal newline after a code-body deletion', () => {
    const surface = editor('<pre><code>\n\n\n\n</code></pre>');
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-code-body-terminal-newline-fixture-missing');
    }
    placeCaret(text, 3);

    reconcileVisualCodeBodyDom(code, '\n\n\n', 3);

    expect(code.textContent).toBe('\n\n\n');
    expect(code.childNodes).toHaveLength(1);
    expect(code.firstChild).toBe(text);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });

  it('reconciles lone-CR source code through syntax spans and retains the LF DOM caret', () => {
    const surface = editor(
      '<pre><code><span class="hljs-keyword">Alpha</span>\nBeta\n</code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const syntax = code?.querySelector('span.hljs-keyword');
    const syntaxText = syntax?.firstChild;
    const trailingText = syntax?.nextSibling;
    if (
      !(code instanceof HTMLElement)
      || !(syntax instanceof HTMLSpanElement)
      || !(syntaxText instanceof Text)
      || !(trailingText instanceof Text)
    ) {
      throw new Error('visual-lone-cr-code-reconcile-fixture-missing');
    }
    placeCaret(trailingText, 2);

    reconcileVisualCodeBodyDom(code, 'Alpha\rBeta\r', 7);

    expect(code.textContent).toBe('Alpha\nBeta\n');
    expect(code.firstChild).toBe(syntax);
    expect(syntax.firstChild).toBe(syntaxText);
    expect(syntax.textContent).toBe('Alpha');
    expect(window.getSelection()?.anchorNode).toBe(trailingText);
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it('reconciles a plain LF DOM from CRLF source with a normalized caret offset', () => {
    const surface = editor('<pre><code>Alpha\nBeta\n</code></pre>');
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-crlf-plain-code-reconcile-fixture-missing');
    }
    placeCaret(text, 6);

    reconcileVisualCodeBodyDom(code, 'Alpha\r\nBeta\r\n', 6);

    expect(code.textContent).toBe('Alpha\nBeta\n');
    expect(code.childNodes).toHaveLength(1);
    expect(code.firstChild).toBe(text);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(6);
  });

  it('normalizes CRLF after browser color FONT unwraps to plain code text', () => {
    const surface = editor(
      '<pre><code><font color="#c678dd">Alpha</font>\nBeta\n</code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const font = code?.querySelector('font');
    const trailingText = font?.nextSibling;
    if (
      !(code instanceof HTMLElement)
      || !(font instanceof HTMLElement)
      || !(trailingText instanceof Text)
    ) {
      throw new Error('visual-crlf-browser-font-reconcile-fixture-missing');
    }
    placeCaret(trailingText, 1);

    reconcileVisualCodeBodyDom(code, 'Alpha\r\nBeta\r\n', 6);

    expect(code.textContent).toBe('Alpha\nBeta\n');
    expect(code.querySelector('font')).toBeNull();
    expect(code.childNodes).toHaveLength(1);
    expect(code.firstChild).toBe(trailingText);
    expect(window.getSelection()?.anchorNode).toBe(trailingText);
    expect(window.getSelection()?.anchorOffset).toBe(6);
  });

  it('removes the renderer-only terminal newline while retaining syntax markup', () => {
    const surface = editor(
      '<pre><code><span class="hljs-keyword">\n\n</span>\n</code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const syntax = code?.querySelector('span.hljs-keyword');
    const text = syntax?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(syntax instanceof HTMLSpanElement)
      || !(text instanceof Text)
    ) {
      throw new Error('visual-highlighted-terminal-newline-fixture-missing');
    }
    placeCaret(text, 2);

    reconcileVisualCodeBodyDom(code, '\n\n', 2);

    expect(code.textContent).toBe('\n\n');
    expect(code.contains(syntax)).toBe(true);
    expect(syntax.textContent).toBe('\n\n');
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it.each([
    { body: '\n\n\n\n\n', label: 'two trailing newlines' },
    { body: '\n\nX\n', label: 'non-newline content drift' }
  ])('rejects $label while reconciling code-body text', ({ body }) => {
    const surface = editor(`<pre><code>${body}</code></pre>`);
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-code-body-reconcile-negative-fixture-missing');
    }

    expect(() => reconcileVisualCodeBodyDom(code, '\n\n\n', 3)).toThrow(
      'visual-editor-code-body-dom-mismatch'
    );
  });

  it('unwraps a mutated empty marker while retaining the browser Text node', () => {
    const surface = editor(
      '<pre><code><span data-easymde-visual-code-placeholder=""></span></code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const marker = code?.firstElementChild;
    if (
      !(code instanceof HTMLElement)
      || !(marker instanceof HTMLSpanElement)
    ) {
      throw new Error('visual-code-placeholder-reconcile-fixture-missing');
    }
    marker.append(document.createTextNode(''));
    const activeText = marker.firstChild;
    if (!(activeText instanceof Text)) {
      throw new Error('visual-code-placeholder-reconcile-text-missing');
    }
    activeText.data = 'A';
    placeCaret(activeText, 1);

    reconcileVisualCodeBodyDom(code, 'A\n', 1);

    expect(code.firstChild).toBe(activeText);
    expect(activeText.isConnected).toBe(true);
    expect(activeText.data).toBe('A\n');
    expect(code.querySelector('[data-easymde-visual-code-placeholder]'))
      .toBeNull();
    expect(window.getSelection()?.anchorNode).toBe(activeText);
    expect(window.getSelection()?.anchorOffset).toBe(1);
  });

  it('unwraps a plain single-text browser span and retains its Text caret', () => {
    const surface = editor('<pre><code>A<span>l</span></code></pre>');
    const code = surface.querySelector('pre > code');
    const wrapper = code?.querySelector('span');
    const text = wrapper?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(wrapper instanceof HTMLSpanElement)
      || !(text instanceof Text)
    ) {
      throw new Error('visual-browser-text-span-reconcile-fixture-missing');
    }
    placeCaret(text, 1);

    reconcileVisualCodeBodyDom(code, 'Al\n', 2);

    expect(wrapper.isConnected).toBe(false);
    expect(code.children).toHaveLength(0);
    expect(code.childNodes).toHaveLength(1);
    expect(code.firstChild).toBe(text);
    expect(text.data).toBe('Al\n');
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it('unwraps browser font formatting while preserving syntax spans and caret identity', () => {
    const surface = editor(
      '<pre><code><span class="hljs-keyword">let </span><font color="#c678dd">x</font></code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const syntaxSpan = code?.querySelector('span.hljs-keyword');
    const font = code?.querySelector('font');
    const typedText = font?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(syntaxSpan instanceof HTMLSpanElement)
      || !(font instanceof HTMLElement)
      || !(typedText instanceof Text)
    ) {
      throw new Error('visual-code-browser-font-fixture-missing');
    }
    placeCaret(typedText, typedText.length);

    reconcileVisualCodeBodyDom(code, 'let x\n', 5);

    expect(code.textContent).toBe('let x\n');
    expect(code.querySelector('font')).toBeNull();
    expect(code.querySelector('span.hljs-keyword')).toBe(syntaxSpan);
    expect(code.querySelector('span.hljs-keyword')?.textContent).toBe('let ');
    expect(typedText.isConnected).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(typedText);
    expect(window.getSelection()?.anchorOffset).toBe(1);
  });

  it.each([
    '<strong>A</strong>',
    '<font color="#c678dd" onclick="x()">A</font>',
    '<span title="not-neutral">A</span>',
    '<span><span>A</span></span>',
    '<span>A<strong></strong></span>'
  ])('rejects unsupported code descendants: %s', (markup) => {
    const surface = editor(`<pre><code>${markup}</code></pre>`);
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-code-semantic-node-fixture-missing');
    }

    expect(() => reconcileVisualCodeBodyDom(code, 'A\n', 1)).toThrow(
      'visual-editor-code-body-dom-shape-invalid'
    );
  });

  it('rejects code text that differs before the missing terminal newline', () => {
    const surface = editor('<pre><code>A\n</code></pre>');
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-code-body-code-fixture-missing');
    }

    expect(() => reconcileVisualCodeBodyDom(code, '\nA\n', 2)).toThrow(
      'visual-editor-code-body-dom-mismatch'
    );
  });

  it('fails closed when a Preview block range does not identify one fenced source block', () => {
    const markdown = '~~~\nA\n~~~\n\n~~~\nB\n~~~';
    const editMap = previewEditMap([previewBlock('b0', 0, 7)]);

    expect(() => createVisualCodeBodyIntervalForPreviewBlock(
      markdown,
      editMap,
      'b0'
    )).toThrow('visual-editor-code-body-map-ambiguous');
  });

  it('keeps code-block structure stable across line shifts and detects inserted fences', () => {
    const accepted = 'Above\n\n~~~js\nA\n~~~\n\n~~~py\nB\n~~~';
    const shifted = 'Above\nAdded line\n\n~~~js\nAx\n~~~\n\n~~~py\nB\n~~~';
    const inserted = `~~~\n\n~~~\n\n${shifted}`;

    expect(visualCodeBlockStructureSignature(accepted)).toBe(
      visualCodeBlockStructureSignature(shifted)
    );
    expect(visualCodeBlockStructureSignature(accepted)).not.toBe(
      visualCodeBlockStructureSignature(inserted)
    );
  });

  it.each([
    { boundary: 'start' as const, offset: 0 },
    { boundary: 'end' as const, offset: 1 }
  ])('normalizes a collapsed root $boundary boundary to an editable leaf', ({ boundary, offset }) => {
    const surface = editor('<p>Before</p>');
    placeCaret(surface, offset);

    expect(normalizeVisualCaretAtDocumentBoundary(surface)).toBe(boundary);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBeInstanceOf(Text);
    expect(selection?.anchorNode?.parentElement?.tagName).toBe('P');
    expect(selection?.anchorOffset).toBe('start' === boundary ? 0 : 6);
  });

  it('rejects a root boundary that still ends at an unmounted window spacer', () => {
    const surface = editor(
      '<p>Visible</p><div data-easymde-preview-window-spacer="1"></div>'
    );
    placeCaret(surface, surface.childNodes.length);

    expect(() => normalizeVisualCaretAtDocumentBoundary(surface)).toThrow(
      'visual-editor-selection-map-failed'
    );
  });

  it('maps a canonical source directly without cloning or diffing the visual surface', () => {
    const map = createVisualMarkdownDirectSourceIntervalMap(
      'Before **Visible**\r\n\r\nTail'
    );

    expect(map.source).toBe('Before **Visible**\n\nTail');
    expect(map.hiddenSourceRanges).toEqual([]);
    expect(map.resolve(map.source.indexOf('Visible'))).toBe(
      'Before **Visible**\r\n\r\nTail'.indexOf('Visible')
    );
    expect(map.resolve(map.source.length)).toBe(
      'Before **Visible**\r\n\r\nTail'.length
    );
  });
  it('serializes the supported server HTML back to Markdown without theme markup', () => {
    const surface = editor(`
      <h1 id="heading">Heading</h1>
      <blockquote><p>Quote</p></blockquote>
      <ul class="task-list">
        <li class="task-list-item"><input type="checkbox" checked disabled>Done</li>
        <li class="task-list-item"><input type="checkbox" disabled>Todo</li>
      </ul>
      <table>
        <thead><tr><th>Name</th><th>State</th></tr></thead>
        <tbody><tr><td>Editor</td><td>Ready</td></tr></tbody>
      </table>
      <div class="easymde-math easymde-math-block">$$x^2$$</div>
      <pre><code class="language-mermaid">flowchart TD
A--&gt;B</code></pre>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      [
        '# Heading',
        '',
        '> Quote',
        '',
        '- [x] Done',
        '- [ ] Todo',
        '',
        '| Name | State |',
        '| --- | --- |',
        '| Editor | Ready |',
        '',
        '$$',
        'x^2',
        '$$',
        '',
        '```mermaid',
        'flowchart TD',
        'A-->B',
        '```'
      ].join('\n')
    );
  });

  it('maps interior boundaries across adjacent headings', () => {
    const source = '# 一级标题 Heading 1\n\n## 二级标题 Heading 2';
    const surface = editor(
      '<h1>一级标题 Heading 1</h1><h2>二级标题 Heading 2</h2>'
    );
    const baseline = serializeVisualMarkdown(surface);
    const firstOffset = source.indexOf('一级标题') + 1;
    const secondOffset = source.indexOf('二级标题') + '二级标题'.length - 1;

    expect(serializeVisualMarkdownBlockFragment([surface.firstElementChild as HTMLElement])).toBe(
      '# 一级标题 Heading 1'
    );
    expect(serializeVisualMarkdownBlockFragment([surface.lastElementChild as HTMLElement])).toBe(
      '## 二级标题 Heading 2'
    );

    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        firstOffset
      )
    ).not.toThrow();
    const firstBoundary = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      source.indexOf('一级标题')
    );
    expect(firstBoundary.node.textContent).toBe('一级标题 Heading 1');
    expect(firstBoundary.offset).toBe(0);
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        source.indexOf('二级标题') + '二级标题 Heading 2'.length
      )
    ).not.toThrow();
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        secondOffset
      )
    ).not.toThrow();
    surface.remove();
  });

  it('maps a code-fence delimiter line to its code body boundary', () => {
    const source = 'Before\n\n```text\ncode\n```\n\nAfter';
    const surface = editor(
      '<p>Before</p><pre><code>code</code></pre><p>After</p>'
    );
    restoreVisualCodeFenceFamilies(surface, source);
    const baseline = serializeVisualMarkdown(surface);
    expect(baseline).toBe(source);
    const surfaceBlock = surface.querySelector('pre');
    if (!surfaceBlock) throw new Error('visual-fence-missing');
    const openingOffset = source.indexOf('```text');
    const closingOffset = source.indexOf('```', openingOffset + 3);
    if (openingOffset < 0 || closingOffset <= openingOffset) {
      throw new Error('visual-fence-delimiter-missing');
    }

    // The undo history selection spans the whole fence, so its end lands on the
    // closing delimiter line, which the surface keeps as metadata instead of
    // DOM text. The recovery has to map that offset into the code body instead
    // of failing the restore.
    const closing = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      closingOffset
    );
    expect(surfaceBlock.contains(closing.node)).toBe(true);

    const opening = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      openingOffset
    );
    expect(surfaceBlock.contains(opening.node)).toBe(false);

    const insideBody = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      source.indexOf('code') + 1
    );
    expect(insideBody.node.textContent).toBe('code');
    expect(insideBody.offset).toBe(1);

    // The recovery proves the delimiter from the fence metadata: without that
    // metadata the offset keeps its explicit failure.
    surfaceBlock.removeAttribute('data-easymde-visual-fence');
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        closingOffset
      )
    ).toThrow('visual-editor-selection-map-failed');
    surface.remove();
  });

  it('maps an escaped boundary on a detached endpoint-block clone', () => {
    const source = 'ab\\`c';
    const surface = editor('<p>ab`c</p>');
    const block = surface.firstElementChild;
    if (!(block instanceof HTMLElement)) {
      throw new Error('detached-endpoint-block-missing');
    }
    const clone = block.cloneNode(true) as HTMLElement;
    surface.remove();
    const node = clone.firstChild;
    if (!(node instanceof Text)) {
      throw new Error('detached-endpoint-text-missing');
    }
    const baseline = serializeVisualMarkdownBlockFragment([clone]);
    expect(baseline).toBe(source);
    // The accepted-adoption path maps each endpoint on a clone of the
    // endpoint block, so the root handed to the mapper is detached: the
    // block-local literal-marker projection still owns its own boundaries.
    const beforeEscape = visualCaretBoundaryFromSourceOffset(
      clone,
      source,
      baseline,
      source.indexOf('\\')
    );
    const afterEscape = visualCaretBoundaryFromSourceOffset(
      clone,
      source,
      baseline,
      source.length
    );
    expect(beforeEscape.node).toBe(node);
    expect(beforeEscape.offset).toBe(2);
    // The end of the block's own text is the boundary after its last child.
    expect(afterEscape.node).toBe(clone);
    expect(afterEscape.offset).toBe(clone.childNodes.length);

    // The proven endpoint-block scope is what admits the detached root: the
    // same boundaries project through the raw boundary mapper only while the
    // root is the clone's own block.
    const intervalMap = createVisualMarkdownSourceIntervalMap(source, baseline);
    expect(
      mapTextBoundaryFromInterval(clone, node, 2, baseline, intervalMap)
    ).toEqual({ sourceOffset: 2, visualOffset: 2 });
    expect(
      mapTextBoundaryFromInterval(clone, node, 3, baseline, intervalMap)
    ).toEqual({ sourceOffset: 4, visualOffset: 4 });
  });

  it('maps only the requested fence when two fences carry their own metadata', () => {
    const source = [
      'Before',
      '',
      '~~~',
      'code',
      '~~~',
      '',
      '~~~',
      'second',
      '~~~',
      '',
      'After'
    ].join('\n');
    const surface = editor(
      '<p>Before</p><pre><code>code</code></pre>'
        + '<pre><code>second</code></pre><p>After</p>'
    );
    restoreVisualCodeFenceFamilies(surface, source);
    const baseline = serializeVisualMarkdown(surface);
    expect(baseline).toBe(source);
    const pres = Array.from(surface.querySelectorAll('pre'));
    if (pres.length !== 2) throw new Error('visual-fences-missing');
    const firstOpening = source.indexOf('~~~');
    const firstClosing = source.indexOf('~~~', firstOpening + 3);
    const secondOpening = source.indexOf('~~~', firstClosing + 3);
    const secondClosing = source.indexOf('~~~', secondOpening + 3);

    // Each valid delimiter offset stays inside its own fence block.
    const fromFirst = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      firstClosing
    );
    expect(pres[0]?.contains(fromFirst.node)).toBe(true);
    const fromSecond = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      secondClosing
    );
    expect(pres[1]?.contains(fromSecond.node)).toBe(true);

    // One fence's metadata may not authorize another fence's delimiter: the
    // requested first fence loses its metadata while the second keeps its own,
    // so the recovery is closed and the requested delimiter may never land in
    // the second fence's own block.
    const mapsIntoSecondFence = (): boolean => {
      try {
        const boundary = visualCaretBoundaryFromSourceOffset(
          surface,
          source,
          baseline,
          firstClosing
        );
        return Boolean(pres[1]?.contains(boundary.node));
      } catch {
        return false;
      }
    };
    const firstPre = pres[0];
    if (!firstPre) throw new Error('visual-fence-missing');
    firstPre.removeAttribute('data-easymde-visual-fence');
    expect(mapsIntoSecondFence()).toBe(false);
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        firstClosing
      )
    ).toThrow('visual-editor-selection-map-failed');
    restoreVisualCodeFenceFamilies(surface, source);

    // An equal number of owners is not association either: a wrong family or a
    // wrong info string on the requested fence keeps its recovery closed.
    firstPre.setAttribute('data-easymde-visual-fence', '```');
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        firstClosing
      )
    ).toThrow('visual-editor-selection-map-failed');
    expect(mapsIntoSecondFence()).toBe(false);
    restoreVisualCodeFenceFamilies(surface, source);
    firstPre.setAttribute('data-easymde-visual-fence-info', 'other');
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        firstClosing
      )
    ).toThrow('visual-editor-selection-map-failed');
    expect(mapsIntoSecondFence()).toBe(false);
    restoreVisualCodeFenceFamilies(surface, source);
    // The intact pair keeps both delimiters mapped to their own fence.
    expect(mapsIntoSecondFence()).toBe(false);
    const restored = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      firstClosing
    );
    expect(pres[0]?.contains(restored.node)).toBe(true);
    surface.remove();
  });

  it('maps a short fence body whose recovery offset overlaps the opening line', () => {
    const blockSource = '~~~\nA\n~~~\n';
    const surface = editor('<pre><code>A\n</code></pre>');
    restoreVisualCodeFenceFamilies(surface, blockSource);
    const block = surface.querySelector('pre');
    if (!block) throw new Error('visual-short-fence-missing');
    const blockBaseline = serializeVisualMarkdownBlockFragment([block]);
    const code = block.querySelector('code');
    if (!code) throw new Error('visual-short-code-missing');
    const requested = blockSource.indexOf('~~~', blockSource.indexOf('~~~') + 3);
    // The requested closing-delimiter offset recovers to this root's code-text
    // length, which in the original Markdown is itself on the opening line, so
    // the recovery's second, non-recursive step must still accept the owner's
    // own metadata.
    const closing = visualCaretBoundaryFromSourceOffset(
      block,
      blockSource,
      blockBaseline,
      requested
    );
    expect(closing.node).toBe(code);
    expect(closing.offset).toBe(code.childNodes.length);
    block.removeAttribute('data-easymde-visual-fence');
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        block,
        blockSource,
        blockBaseline,
        requested
      )
    ).toThrow('visual-editor-selection-map-failed');
    surface.remove();
  });

  it('maps a closing delimiter offset when the mapped root is the fence block itself', () => {
    const blockSource = [
      '```bash',
      '#!/usr/bin/env bash',
      '',
      'set -euo pipefail',
      '',
      'echo "Hello, Markdown!"',
      'mkdir -p ./dist',
      'npm install',
      'npm run build',
      '```',
      ''
    ].join('\n');
    const surface = editor(
      '<pre><code>#!/usr/bin/env bash\n\nset -euo pipefail\n\necho "Hello, Markdown!"\nmkdir -p ./dist\nnpm install\nnpm run build\n</code></pre>'
    );
    restoreVisualCodeFenceFamilies(surface, blockSource);
    const block = surface.querySelector('pre');
    if (!block) throw new Error('visual-fence-missing');
    const blockBaseline = serializeVisualMarkdownBlockFragment([block]);
    const code = block.querySelector('code');
    if (!code) throw new Error('visual-code-missing');
    // The windowed restore maps each endpoint on a clone of that endpoint
    // block, so the root handed to the mapper is the fence `<pre>` itself. The
    // history selection ends on the closing delimiter line terminator.
    const opening = visualCaretBoundaryFromSourceOffset(
      block,
      blockSource,
      blockBaseline,
      0
    );
    expect(block.contains(opening.node)).toBe(true);
    const closing = visualCaretBoundaryFromSourceOffset(
      block,
      blockSource,
      blockBaseline,
      blockSource.length - 1
    );
    expect(closing.node).toBe(code);
    expect(closing.offset).toBe(code.childNodes.length);

    block.removeAttribute('data-easymde-visual-fence');
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        block,
        blockSource,
        blockBaseline,
        blockSource.length - 1
      )
    ).toThrow('visual-editor-selection-map-failed');
    surface.remove();
  });

  it('maps heading boundaries when each window block includes its source newline', () => {
    const blocks = [
      { source: '# 一级标题 Heading 1\n', html: '<h1>一级标题 Heading 1</h1>' },
      { source: '## 二级标题 Heading 2\n', html: '<h2>二级标题 Heading 2</h2>' }
    ];
    for (const block of blocks) {
      const surface = editor(block.html);
      const baseline = serializeVisualMarkdownBlockFragment([
        surface.firstElementChild as HTMLElement
      ]);
      const body = block.html.replace(/<[^>]+>/gu, '');
      const contentOffset = block.source.indexOf(body) + 1;
      expect(() =>
        visualCaretBoundaryFromSourceOffset(
          surface,
          block.source,
          baseline,
          contentOffset
        )
      ).not.toThrow();
      const startBoundary = visualCaretBoundaryFromSourceOffset(
        surface,
        block.source,
        baseline,
        block.source.indexOf(body)
      );
      const endBoundary = visualCaretBoundaryFromSourceOffset(
        surface,
        block.source,
        baseline,
        block.source.length - 1
      );
      expect(startBoundary.offset).toBe(0);
      expect(endBoundary.node.textContent).toBe(block.html.replace(/<[^>]+>/gu, ''));
      expect(() =>
        visualCaretBoundaryFromSourceOffset(
          surface,
          block.source,
          baseline,
          block.source.length - 1
        )
      ).not.toThrow();
      surface.remove();
    }
    const attributed = editor(
      '<h1 data-easymde-visual-block-id="b4">一级标题 Heading 1</h1>'
    );
    const attributedBoundary = visualCaretBoundaryFromSourceOffset(
      attributed,
      '# 一级标题 Heading 1\n',
      '# 一级标题 Heading 1',
      2
    );
    expect(attributedBoundary.offset).toBe(0);
    attributed.remove();
  });

  it('keeps formatted heading prefix boundaries source-aware', () => {
    const surface = editor('<h1><strong>一级标题</strong> Heading 1</h1>');
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        '# **一级标题** Heading 1\n',
        '# **一级标题** Heading 1',
        2
      )
    ).not.toThrow();
    surface.remove();
  });

  it('preserves literal code-body whitespace and zero-width characters', () => {
    const surface = editor('');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const body = '-  value\n\u200b literal';
    code.append(document.createTextNode(body));
    pre.append(code);
    surface.append(pre);

    expect(serializeVisualMarkdown(surface)).toBe(
      `\`\`\`\n${body}\n\`\`\``
    );
  });

  it('keeps hard-break spacing after an inline image with surrounding text', () => {
    const surface = editor('');
    const paragraph = document.createElement('p');
    const image = document.createElement('img');
    image.src = 'https://example.test/x';
    paragraph.append(
      document.createTextNode('Text'),
      image,
      document.createTextNode('  '),
      document.createElement('br'),
      document.createTextNode('Next')
    );
    surface.append(paragraph);

    expect(serializeVisualMarkdown(surface)).toBe(
      'Text![](https://example.test/x)  \nNext'
    );
  });

  it('normalizes an image context-menu caret to the complete image node', () => {
    const surface = editor('<p>Before <img src="https://example.test/x.png"> after</p>');
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-image-context-target-missing');
    }
    placeCaret(image, 0);

    expect(selectImage(surface, image)).toBe(true);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(surface.querySelector('p'));
    expect(selection?.focusNode).toBe(surface.querySelector('p'));
    expect(selection?.isCollapsed).toBe(false);
  });

  it('classifies selection provenance before image or caret recovery', () => {
    const surface = editor(
      '<p id="inside">Inside <img src="https://example.test/x.png"></p>'
    );
    const outside = document.createElement('p');
    outside.textContent = 'Outside';
    document.body.append(outside);
    const insideText = surface.querySelector('p')?.firstChild;
    const outsideText = outside.firstChild;
    if (!(insideText instanceof Text) || !(outsideText instanceof Text)) {
      throw new Error('visual-selection-provenance-fixture-missing');
    }
    const selection = window.getSelection();
    if (!selection) throw new Error('visual-selection-owner-missing');

    selection.removeAllRanges();
    expect(classifyVisualSelectionProvenance(surface, selection)).toBe('absent');
    expect(classifyVisualSelectionProvenance(surface, null)).toBe('absent');

    const owned = document.createRange();
    owned.setStart(insideText, 0);
    owned.setEnd(insideText, 3);
    selection.removeAllRanges();
    selection.addRange(owned);
    expect(classifyVisualSelectionProvenance(surface, selection)).toBe('owned');

    const foreign = document.createRange();
    foreign.selectNodeContents(outside);
    selection.removeAllRanges();
    selection.addRange(foreign);
    expect(classifyVisualSelectionProvenance(surface, selection)).toBe(
      'wholly-foreign'
    );

    const straddling = document.createRange();
    straddling.setStart(insideText, 0);
    straddling.setEnd(outsideText, 3);
    selection.removeAllRanges();
    selection.addRange(straddling);
    expect(classifyVisualSelectionProvenance(surface, selection)).toBe(
      'straddling'
    );

    // A reversed selection keeps the same provenance.
    selection.removeAllRanges();
    selection.setBaseAndExtent(outsideText, 3, insideText, 0);
    expect(classifyVisualSelectionProvenance(surface, selection)).toBe(
      'straddling'
    );

    // A range that encloses the whole surface has both endpoints outside but
    // still intersects the editable surface.
    const enclosing = document.createRange();
    enclosing.selectNodeContents(document.body);
    selection.removeAllRanges();
    selection.addRange(enclosing);
    expect(classifyVisualSelectionProvenance(surface, selection)).toBe(
      'straddling'
    );

    // A multi-range selection that reaches into the surface is never owned.
    // jsdom keeps a single range per selection, so the additional range is
    // supplied structurally; real browsers report every range here.
    const first = document.createRange();
    first.selectNodeContents(outside);
    const second = document.createRange();
    second.setStart(insideText, 0);
    second.setEnd(insideText, 3);
    expect(
      classifyVisualSelectionProvenance(surface, {
        anchorNode: outsideText,
        focusNode: outsideText,
        getRangeAt: (index: number) => (0 === index ? first : second),
        rangeCount: 2
      })
    ).toBe('straddling');
  });

  it.each([
    { expected: true, name: 'an absent selection', setup: 'absent' },
    {
      expected: true,
      name: 'an owned collapsed image caret',
      setup: 'owned-collapsed'
    },
    {
      expected: true,
      name: 'a wholly foreign selection',
      setup: 'foreign'
    },
    {
      expected: false,
      name: 'an owned deliberate selection',
      setup: 'owned-ranged'
    },
    { expected: false, name: 'a straddling selection', setup: 'straddling' }
  ] as const)(
    'decides image context-menu normalization for $name: $expected',
    ({ expected, setup }) => {
      const surface = editor(
        '<p>Before <img src="https://example.test/x.png"> after</p>'
      );
      const outside = document.createElement('p');
      outside.textContent = 'Outside';
      document.body.append(outside);
      const image = surface.querySelector('img');
      const insideText = surface.querySelector('p')?.firstChild;
      const outsideText = outside.firstChild;
      const paragraph = surface.querySelector('p');
      if (
        !(image instanceof HTMLImageElement)
        || !(insideText instanceof Text)
        || !(outsideText instanceof Text)
        || !(paragraph instanceof HTMLElement)
      ) {
        throw new Error('visual-image-normalization-fixture-missing');
      }
      const selection = window.getSelection();
      if (!selection) throw new Error('visual-selection-owner-missing');

      selection.removeAllRanges();
      if ('owned-collapsed' === setup) {
        const caret = document.createRange();
        caret.setStart(insideText, 0);
        caret.collapse(true);
        selection.addRange(caret);
      }
      if ('owned-ranged' === setup) {
        const owned = document.createRange();
        owned.setStart(insideText, 0);
        owned.setEnd(insideText, 3);
        selection.addRange(owned);
      }
      if ('foreign' === setup) {
        const foreign = document.createRange();
        foreign.selectNodeContents(outside);
        selection.addRange(foreign);
      }
      if ('straddling' === setup) {
        const straddling = document.createRange();
        straddling.setStart(insideText, 0);
        straddling.setEnd(outsideText, 3);
        selection.addRange(straddling);
      }

      expect(selectImage(surface, image)).toBe(expected);
      if (expected) {
        expect(selection.isCollapsed).toBe(false);
        expect(selection.anchorNode).toBe(paragraph);
        expect(selection.focusNode).toBe(paragraph);
      } else if ('straddling' === setup) {
        expect(selection.anchorNode).toBe(insideText);
        expect(selection.focusNode).toBe(outsideText);
      }
      selection.removeAllRanges();
    }
  );

  it('keeps straddling and enclosing selections instead of rebinding them', () => {
    const surface = editor(
      '<p id="inside">Before <img src="https://example.test/x.png"> after</p>'
    );
    const outside = document.createElement('p');
    outside.textContent = 'Outside';
    document.body.append(outside);
    const image = surface.querySelector('img');
    const insideText = surface.querySelector('p')?.firstChild;
    const outsideText = outside.firstChild;
    if (
      !(image instanceof HTMLImageElement)
      || !(insideText instanceof Text)
      || !(outsideText instanceof Text)
    ) {
      throw new Error('visual-selection-preservation-fixture-missing');
    }
    const selection = window.getSelection();
    if (!selection) throw new Error('visual-selection-owner-missing');

    const straddling = document.createRange();
    straddling.setStart(insideText, 0);
    straddling.setEnd(outsideText, 3);
    selection.removeAllRanges();
    selection.addRange(straddling);
    expect(selectImage(surface, image)).toBe(false);
    expect(selection.rangeCount).toBe(1);
    expect(selection.anchorNode).toBe(insideText);
    expect(selection.focusNode).toBe(outsideText);
    expect(selection.getRangeAt(0).startContainer).toBe(insideText);
    expect(selection.getRangeAt(0).endContainer).toBe(outsideText);

    const enclosing = document.createRange();
    enclosing.selectNodeContents(document.body);
    selection.removeAllRanges();
    selection.addRange(enclosing);
    expect(selectImage(surface, image)).toBe(false);
    expect(selection.rangeCount).toBe(1);
    expect(selection.getRangeAt(0).startContainer).toBe(document.body);

    // Only an absent or wholly foreign selection is recovered onto the hit
    // image.
    const foreign = document.createRange();
    foreign.selectNodeContents(outside);
    selection.removeAllRanges();
    selection.addRange(foreign);
    expect(selectImage(surface, image)).toBe(true);
    const paragraph = surface.querySelector('p');
    expect(selection.anchorNode).toBe(paragraph);
    expect(selection.focusNode).toBe(paragraph);
    expect(selection.isCollapsed).toBe(false);

    selection.removeAllRanges();
    expect(selectImage(surface, image)).toBe(true);
    expect(selection.isCollapsed).toBe(false);
  });

  it.each([
    {
      isCollapsed: true,
      rangeCount: 0,
      expected: true,
      name: 'an empty selection'
    },
    {
      isCollapsed: true,
      rangeCount: 1,
      expected: true,
      name: 'a collapsed selection'
    },
    {
      isCollapsed: false,
      rangeCount: 1,
      expected: false,
      name: 'a non-empty selection'
    },
    {
      isCollapsed: true,
      rangeCount: 2,
      expected: false,
      name: 'multiple ranges'
    }
  ])('classifies $name for image context-menu normalization', ({
    expected,
    isCollapsed,
    rangeCount
  }) => {
    expect(
      shouldNormalizeVisualImageContextMenuSelection({
        isCollapsed,
        rangeCount
      })
    ).toBe(expected);
  });

  it('normalizes an image target when the collapsed caret remains in text', () => {
    const surface = editor('<p>Before <img src="https://example.test/x.png"> after</p>');
    const paragraph = surface.querySelector('p');
    const text = paragraph?.firstChild;
    const image = surface.querySelector('img');
    if (
      !(paragraph instanceof HTMLElement)
      || !(text instanceof Text)
      || !(image instanceof HTMLImageElement)
    ) {
      throw new Error('visual-collapsed-image-context-fixture-missing');
    }
    placeCaret(text, 0);

    expect(selectImage(surface, image)).toBe(true);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(paragraph);
    expect(selection?.focusNode).toBe(paragraph);
    expect(selection?.isCollapsed).toBe(false);
  });

  it('normalizes an image target when no native range is present', () => {
    const surface = editor('<p>Before <img src="https://example.test/x.png"> after</p>');
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-empty-image-context-fixture-missing');
    }
    window.getSelection()?.removeAllRanges();

    expect(selectImage(surface, image)).toBe(true);
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it('preserves a non-empty mixed selection when the image is the context target', () => {
    const surface = editor(
      '<p>Before <img src="https://example.test/x.png"> after</p>'
    );
    const paragraph = surface.querySelector('p');
    const before = paragraph?.firstChild;
    const after = paragraph?.lastChild;
    const image = surface.querySelector('img');
    if (
      !(paragraph instanceof HTMLElement)
      || !(before instanceof Text)
      || !(after instanceof Text)
      || !(image instanceof HTMLImageElement)
    ) {
      throw new Error('visual-mixed-image-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(after, after.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selectImage(surface, image)).toBe(false);
    expect(selection?.anchorNode).toBe(before);
    expect(selection?.anchorOffset).toBe(0);
    expect(selection?.focusNode).toBe(after);
    expect(selection?.focusOffset).toBe(after.length);
    expect(selection?.isCollapsed).toBe(false);
  });

  it('normalizes an image target when a stale selection belongs outside the visual surface', () => {
    const surface = editor(
      '<p>Before <img src="https://example.test/x.png"> after</p>'
    );
    const image = surface.querySelector('img');
    const foreign = document.createElement('p');
    foreign.append('stale toolbar selection');
    document.body.append(foreign);
    if (!(image instanceof HTMLImageElement) || !(foreign.firstChild instanceof Text)) {
      throw new Error('visual-foreign-image-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(foreign.firstChild, 0);
    range.setEnd(foreign.firstChild, foreign.firstChild.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(selectImage(surface, image)).toBe(true);
    expect(selection?.anchorNode).toBe(surface.querySelector('p'));
    expect(selection?.focusNode).toBe(surface.querySelector('p'));
    expect(selection?.isCollapsed).toBe(false);
  });

  it('rebinds the remembered image selection for a pointer demand on a second image', () => {
    const surface = editor(
      '<p><img alt="first" src="https://example.test/first.png"></p>'
      + '<p><img alt="second" src="https://example.test/second.png"></p>'
    );
    const [firstParagraph, secondParagraph] = Array.from(
      surface.querySelectorAll('p')
    );
    const [first, second] = Array.from(surface.querySelectorAll('img'));
    const selection = window.getSelection();
    if (
      !(first instanceof HTMLImageElement)
      || !(second instanceof HTMLImageElement)
      || !selection
    ) {
      throw new Error('visual-image-rebind-fixture-missing');
    }

    // The first demand remembers the exact range it placed for the first
    // image. Nothing replaces the DOM, clears a range, or refreshes the
    // surface between the two gestures, and one owner owns that range.
    const interaction = imageInteraction(surface);
    try {
      expect(interaction.select(first, 'keyboard')).toBe(true);
      expect(selection.anchorNode).toBe(firstParagraph);
      expect(interaction.select(second, 'pointer')).toBe(true);
      expect(selection.anchorNode).toBe(secondParagraph);
      expect(selection.focusNode).toBe(secondParagraph);
      expect(selection.isCollapsed).toBe(false);
      // The rebound range replaces the remembered one, so the next demand can
      // move back to the first image.
      expect(interaction.select(first, 'pointer')).toBe(true);
      expect(selection.anchorNode).toBe(firstParagraph);
      // Keyboard activation never rebinds: the retained image range stays.
      expect(interaction.select(second, 'keyboard')).toBe(false);
      expect(selection.anchorNode).toBe(firstParagraph);
    } finally {
      interaction.dispose();
    }
  });

  it('keeps a deliberate selection that no image demand placed', () => {
    const surface = editor(
      '<p>Before <img alt="first" src="https://example.test/first.png"></p>'
      + '<p>After <img alt="second" src="https://example.test/second.png"></p>'
    );
    const [firstParagraph, secondParagraph] = Array.from(
      surface.querySelectorAll('p')
    );
    const [firstText, secondText] = [firstParagraph, secondParagraph].map(
      (paragraph) => paragraph?.firstChild
    );
    const second = surface.querySelectorAll('img')[1];
    const selection = window.getSelection();
    if (
      !(second instanceof HTMLImageElement)
      || !(firstText instanceof Text)
      || !(secondText instanceof Text)
      || !selection
    ) {
      throw new Error('visual-image-deliberate-selection-fixture-missing');
    }
    const mixed = document.createRange();
    mixed.setStart(firstText, 0);
    mixed.setEnd(secondText, 5);
    selection.removeAllRanges();
    selection.addRange(mixed);

    // A pointer demand cannot own a range this helper never placed.
    expect(selectImage(surface, second, 'pointer')).toBe(false);
    expect(selection.anchorNode).toBe(firstText);
    expect(selection.focusNode).toBe(secondText);

    // The primary button states that the image is the target the user chose,
    // so that gesture does replace the deliberate selection.
    expect(selectImage(surface, second, 'activation')).toBe(true);
    expect(selection.anchorNode).toBe(secondParagraph);
    expect(selection.isCollapsed).toBe(false);
  });

  it('replaces only an owner-placed selection for a pointer image demand', () => {
    const surface = editor(
      '<p>Before <img alt="first" src="https://example.test/first.png"> after</p>'
    );
    const paragraph = surface.querySelector('p');
    const before = paragraph?.firstChild;
    const after = paragraph?.lastChild;
    const image = surface.querySelector('img');
    const selection = window.getSelection();
    if (
      !(paragraph instanceof HTMLElement)
      || !(before instanceof Text)
      || !(after instanceof Text)
      || !(image instanceof HTMLImageElement)
      || !selection
    ) {
      throw new Error('visual-image-owner-selection-fixture-missing');
    }
    // An owner-placed range is a non-collapsed range inside the surface, which
    // is exactly the shape a history restore publishes: a code-block or text
    // range the user never made.
    let ownerPlaced = true;
    const interaction = createVisualImageInteraction(surface, {
      canActivate: () => true,
      focus: () => undefined,
      ownsSelection: () => ownerPlaced,
      report: () => undefined,
      synchronizeSelection: () => true
    });
    try {
      const owned = document.createRange();
      owned.setStart(before, 0);
      owned.setEnd(after, after.length);
      selection.removeAllRanges();
      selection.addRange(owned);

      // The owner states this exact range is its own publication, so a pointer
      // demand on the image replaces it and resolves an image target.
      expect(interaction.select(image, 'pointer')).toBe(true);
      expect(selection.anchorNode).toBe(paragraph);
      expect(selection.isCollapsed).toBe(false);

      // Once the selection drifts from what the owner published, the same
      // pointer demand is a deliberate user selection and keeps it.
      const deliberate = document.createRange();
      deliberate.setStart(before, 1);
      deliberate.setEnd(after, after.length);
      selection.removeAllRanges();
      selection.addRange(deliberate);
      ownerPlaced = false;
      expect(interaction.select(image, 'pointer')).toBe(false);
      expect(selection.anchorNode).toBe(before);
      expect(selection.anchorOffset).toBe(1);
      expect(selection.focusNode).toBe(after);
    } finally {
      interaction.dispose();
    }
  });

  it('marks the selected image outside the editable DOM and clears the marker on drift', () => {
    const surface = editor(
      '<p><img alt="first" src="https://example.test/first.png"></p>'
      + '<p><img alt="second" src="https://example.test/second.png"></p>'
    );
    const [first, second] = Array.from(surface.querySelectorAll('img'));
    if (
      !(first instanceof HTMLImageElement)
      || !(second instanceof HTMLImageElement)
    ) {
      throw new Error('visual-image-feedback-fixture-missing');
    }
    const interaction = imageInteraction(surface);
    const marker = (): HTMLElement | null =>
      document.querySelector('.easymde-visual-image-selection-feedback');
    const editableMarkup = surface.innerHTML;

    try {
      expect(marker()).toBeNull();
      expect(interaction.select(first, 'activation')).toBe(true);
      const firstRect = first.getBoundingClientRect();
      expect(marker()?.style.left).toBe(`${firstRect.left}px`);
      expect(marker()?.style.top).toBe(`${firstRect.top}px`);
      expect(marker()?.style.width).toBe(`${firstRect.width}px`);
      // The marker lives outside the editable DOM, so serialization, export,
      // and the accepted-window comparison never observe it.
      expect(surface.contains(marker())).toBe(false);
      expect(surface.innerHTML).toBe(editableMarkup);

      expect(interaction.select(second, 'activation')).toBe(true);
      expect(marker()?.style.top).toBe(
        `${second.getBoundingClientRect().top}px`
      );

      // A drift drops the remembered range and the marker on the browser's own
      // selectionchange event without touching the document.
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      expect(marker()).toBeNull();
      expect(surface.innerHTML).toBe(editableMarkup);
    } finally {
      interaction.dispose();
    }
  });

  it('drops image feedback on lock, replaced images, and disposal', () => {
    const surface = editor(
      '<p><img alt="first" src="https://example.test/first.png"></p>'
    );
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-image-feedback-lifecycle-fixture-missing');
    }
    const interaction = imageInteraction(surface);
    const marker = (): HTMLElement | null =>
      document.querySelector('.easymde-visual-image-selection-feedback');

    expect(interaction.select(image, 'activation')).toBe(true);
    expect(marker()).not.toBeNull();

    // Locking removes the editable state the marker describes.
    surface.setAttribute('contenteditable', 'false');
    window.dispatchEvent(new Event('resize'));
    expect(marker()).toBeNull();

    // A replaced image node detaches the remembered target.
    surface.setAttribute('contenteditable', 'true');
    expect(interaction.select(image, 'activation')).toBe(true);
    expect(marker()).not.toBeNull();
    image.outerHTML = '<img alt="first" src="https://example.test/first.png">';
    window.dispatchEvent(new Event('resize'));
    expect(marker()).toBeNull();

    // Disposal drops this owner's marker and remembered range, and it owns no
    // state another owner could inherit.
    const replacement = surface.querySelector('img');
    if (!(replacement instanceof HTMLImageElement)) {
      throw new Error('visual-image-feedback-replacement-missing');
    }
    expect(interaction.select(replacement, 'activation')).toBe(true);
    expect(marker()).not.toBeNull();
    interaction.dispose();
    expect(marker()).toBeNull();
    const fresh = imageInteraction(surface);
    try {
      expect(fresh.select(replacement, 'activation')).toBe(true);
      expect(marker()).not.toBeNull();
    } finally {
      fresh.dispose();
    }
    expect(marker()).toBeNull();
  });

  it('clamps the outline to the visible band instead of painting outside it', () => {
    const wrapper = document.createElement('div');
    wrapper.style.setProperty('overflow', 'hidden');
    wrapper.style.setProperty('overflow-x', 'hidden');
    wrapper.style.setProperty('overflow-y', 'hidden');
    const surface = document.createElement('article');
    surface.innerHTML =
      '<p><img alt="first" src="https://example.test/first.png"></p>';
    wrapper.append(surface);
    document.body.append(wrapper);
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-image-clip-fixture-missing');
    }
    let bandTop = 100;
    wrapper.getBoundingClientRect = (() => ({
      bottom: bandTop + 200,
      height: 200,
      left: 40,
      right: 640,
      top: bandTop,
      width: 600,
      x: 40,
      y: bandTop,
      toJSON: () => ({})
    })) as unknown as () => DOMRect;
    let imageTop = 140;
    image.getBoundingClientRect = (() => ({
      bottom: imageTop + 80,
      height: 80,
      left: 100,
      right: 500,
      top: imageTop,
      width: 400,
      x: 100,
      y: imageTop,
      toJSON: () => ({})
    })) as unknown as () => DOMRect;
    const interaction = imageInteraction(surface);
    const marker = (): HTMLElement | null =>
      document.querySelector('.easymde-visual-image-selection-feedback');
    try {
      expect(interaction.select(image, 'activation')).toBe(true);
      // The image sits inside the band: the outline is the image's own box, so
      // the visible appearance is unchanged.
      expect(marker()?.style.left).toBe('100px');
      expect(marker()?.style.top).toBe('140px');
      expect(marker()?.style.width).toBe('400px');
      expect(marker()?.style.height).toBe('80px');
      expect(marker()?.style.visibility).toBe('visible');

      // Partly scrolled out: the outline stops at the band's edge and stays
      // visible.
      imageTop = 60;
      window.dispatchEvent(new Event('resize'));
      expect(marker()?.style.top).toBe('100px');
      expect(marker()?.style.height).toBe('40px');
      expect(marker()?.style.visibility).toBe('visible');

      // Fully scrolled out: the empty intersection is hidden, because a
      // zero-sized border box would still paint its 2 + 2 px of border.
      imageTop = -40;
      window.dispatchEvent(new Event('resize'));
      expect(marker()?.style.height).toBe('0px');
      expect(marker()?.style.visibility).toBe('hidden');

      // A band change (a resized pane) is picked up as well, and the outline
      // becomes visible again.
      imageTop = 140;
      bandTop = 160;
      window.dispatchEvent(new Event('resize'));
      expect(marker()?.style.top).toBe('160px');
      expect(marker()?.style.height).toBe('60px');
      expect(marker()?.style.visibility).toBe('visible');
    } finally {
      interaction.dispose();
      wrapper.remove();
    }
  });

  it('tracks image geometry through observed layout, not only scroll or resize', () => {
    const surface = editor(
      '<p><img alt="first" src="https://example.test/first.png"></p>'
    );
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-image-tracking-fixture-missing');
    }
    const observed = new Set<Element>();
    const observeCallbacks: Array<() => void> = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    // jsdom has no layout engine, so the geometry observation is stubbed: the
    // test states which boxes the owner observes and that its callback moves
    // the marker onto the box the image reports.
    globalThis.ResizeObserver = class StubResizeObserver {
      constructor(callback: () => void) {
        observeCallbacks.push(callback);
      }
      public disconnect(): void {
        observed.clear();
      }
      public observe(target: Element): void {
        observed.add(target);
      }
      public unobserve(target: Element): void {
        observed.delete(target);
      }
    } as unknown as typeof ResizeObserver;
    try {
      const interaction = imageInteraction(surface);
      try {
        expect(interaction.select(image, 'activation')).toBe(true);
        expect(Array.from(observed)).toEqual([image, surface]);
        image.getBoundingClientRect = (() => ({
          bottom: 40,
          height: 30,
          left: 7,
          right: 107,
          top: 10,
          width: 100,
          x: 7,
          y: 10,
          toJSON: () => ({})
        })) as unknown as () => DOMRect;
        for (const callback of observeCallbacks) callback();
        const marker = document.querySelector<HTMLElement>(
          '.easymde-visual-image-selection-feedback'
        );
        expect(marker?.style.left).toBe('7px');
        expect(marker?.style.top).toBe('10px');
        expect(marker?.style.width).toBe('100px');
        expect(marker?.style.height).toBe('30px');
      } finally {
        interaction.dispose();
      }
      expect(observed.size).toBe(0);
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  it('serializes selected image scale while preserving alt, title, and URL', () => {
    const surface = editor(
      '<p><img src="https://example.test/a.png" alt="Alt text" title="Image title" width="67%"></p>'
    );

    expect(serializeVisualMarkdown(surface)).toBe(
      '![Alt text](https://example.test/a.png "Image title {width=67%}")'
    );
  });

  it('preserves a historical visual image width outside the new scale contract', () => {
    const surface = editor(
      '<p><img src="https://example.test/a.png" alt="Alt text" width="68%"></p>'
    );

    expect(serializeVisualMarkdown(surface)).toBe(
      '![Alt text](https://example.test/a.png =68%x)'
    );
  });

  it('still rejects a malformed visual width attribute', () => {
    const surface = editor(
      '<p><img src="https://example.test/a.png" alt="Alt text" width="68.0%"></p>'
    );

    expect(() => serializeVisualMarkdown(surface)).toThrow(
      'image-scale-invalid-width'
    );
  });

  it('keeps literal code-body spacing inside unordered and ordered list items', () => {
    const surface = editor(
      '<ul><li><pre><code>-  value\n</code></pre></li></ul>'
      + '<ol start="10"><li><pre><code>-  value\n</code></pre></li></ol>'
    );

    expect(serializeVisualMarkdown(surface)).toBe(
      '- ```\n  -  value\n  ```\n  \n\n10. ```\n    -  value\n    ```'
    );
  });

  it('restores fenced code families after a rendered Preview replaces the visual DOM', () => {
    const surface = editor(`
      <pre><code class="language-js">tilde</code></pre>
      <pre><code class="language-python">backtick</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '~~~js\ntilde\n~~~\n\n```python\nbacktick\n```'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual(['~~~', '```']);
    expect(serializeVisualMarkdown(surface)).toBe(
      '~~~js\ntilde\n~~~\n\n```python\nbacktick\n```'
    );
  });

  it('restores arbitrary fence lengths and keeps shorter closing runs in the body', () => {
    const surface = editor(`
      <pre><code class="language-bash">echo tilde
~~~~
still tilde</code></pre>
      <pre><code class="language-js">const value = 1;
&#96;&#96;&#96;&#96;
~~~~~~</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      [
        '~~~~~bash  linenos=true  ',
        'echo tilde',
        '~~~~',
        'still tilde',
        '~~~~~~~',
        '',
        '`````js linenos=true',
        'const value = 1;',
        '````',
        '~~~~~~',
        '``````'
      ].join('\n')
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual(['~~~~~', '`````']);
    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence-info')
      )
    ).toEqual(['bash  linenos=true  ', 'js linenos=true']);
    expect(serializeVisualMarkdown(surface)).toBe(
      [
        '~~~~~bash  linenos=true  ',
        'echo tilde',
        '~~~~',
        'still tilde',
        '~~~~~',
        '',
        '`````js linenos=true',
        'const value = 1;',
        '````',
        '~~~~~~',
        '`````'
      ].join('\n')
    );
  });

  it('keeps a backtick in an info string from becoming a source fence', () => {
    const surface = editor('<pre><code>body</code></pre>');

    restoreVisualCodeFenceFamilies(
      surface,
      '`````js`invalid\nbody'
    );

    expect(surface.querySelector('pre')?.getAttribute(
      'data-easymde-visual-fence'
    )).toBeNull();
  });

  it('keeps Mermaid fence alignment when the renderer leaves Mermaid as code', () => {
    const surface = editor(`
      <pre><code class="language-Mermaid">flowchart TD
A--&gt;B</code></pre>
      <pre><code class="language-js">const value = 1;</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '~~~mermaid\nflowchart TD\nA-->B\n~~~\n\n```js\nconst value = 1;\n```'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual(['~~~', '```']);
    expect(serializeVisualMarkdown(surface)).toContain(
      '~~~mermaid\nflowchart TD\nA-->B\n~~~'
    );
  });

  it('serializes a direct code child when a line-number gutter comes first', () => {
    const surface = editor(`
      <pre data-easymde-visual-fence="~~~">
        <span class="easymde-code-line-number-gutter" aria-hidden="true">1</span>
        <code class="language-bash">echo ready</code>
      </pre>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      '~~~bash\necho ready\n~~~'
    );
  });

  it.each([
    [
      'an unknown direct element',
      '<pre><span>user-visible</span><code>body</code></pre>'
    ],
    [
      'duplicate direct code children',
      '<pre><code>first</code><code>second</code></pre>'
    ],
    [
      'non-empty direct text',
      '<pre>user-visible<code>body</code></pre>'
    ],
    [
      'duplicate line-number gutters',
      '<pre><span class="easymde-code-line-number-gutter">1</span><span class="easymde-code-line-number-gutter">2</span><code>body</code></pre>'
    ]
  ])('fails closed for %s in the serializer', (_description, markup) => {
    expect(() => serializeVisualMarkdown(editor(markup)))
      .toThrow('visual-editor-code-shape-invalid');
  });

  it('fails closed for an unsupported PRE shape while restoring fence families', () => {
    const surface = editor(
      '<pre><span>user-visible</span><code>body</code></pre>'
    );

    expect(() => restoreVisualCodeFenceFamilies(surface, '~~~\nbody\n~~~'))
      .toThrow('visual-editor-code-shape-invalid');
  });

  it('maps valid PRE boundaries through CODE content boundaries', () => {
    const source = 'Before\n\n~~~js\nAlpha\n~~~\n\nAfter';
    const surface = editor(
      '<p>Before</p>'
      + '<pre data-easymde-visual-fence="~~~" '
      + 'data-easymde-visual-fence-info="js"><code>Alpha</code></pre>'
      + '<p>After</p>'
    );
    const pre = surface.querySelector('pre');
    const codeText = surface.querySelector('pre > code')?.firstChild;
    const afterText = surface.querySelector('p:last-child')?.firstChild;
    if (!(pre instanceof HTMLElement)
      || !(codeText instanceof Text)
      || !(afterText instanceof Text)) {
      throw new Error('visual-pre-boundary-fixture-invalid');
    }
    const codeStart = source.indexOf('Alpha');
    const codeEnd = codeStart + 'Alpha'.length;
    const selection = window.getSelection();

    selection?.setBaseAndExtent(pre, 0, codeText, 2);
    expect(visualSelectionSourceRange(surface, source, source)).toEqual({
      direction: 'forward',
      end: codeStart + 2,
      start: codeStart
    });

    selection?.setBaseAndExtent(pre, pre.childNodes.length, codeText, 2);
    expect(visualSelectionSourceRange(surface, source, source)).toEqual({
      direction: 'backward',
      end: codeEnd,
      start: codeStart + 2
    });

    selection?.setBaseAndExtent(afterText, 2, pre, 0);
    expect(visualSelectionSourceRange(surface, source, source)).toEqual({
      direction: 'backward',
      end: source.indexOf('After') + 2,
      start: codeStart
    });
    surface.remove();
  });

  it('keeps malformed PRE boundaries rejected by directCodeChild', () => {
    const source = '~~~\nAlpha\n~~~';
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~">'
      + '<span>unexpected</span><code>Alpha</code></pre>'
    );
    const pre = surface.querySelector('pre');
    if (!(pre instanceof HTMLElement)) {
      throw new Error('visual-malformed-pre-boundary-fixture-invalid');
    }
    placeCaret(pre, 0);

    expect(() => visualSelectionSourceRange(surface, source, source))
      .toThrow('visual-editor-code-shape-invalid');
    surface.remove();
  });

  it('keeps Markdown-looking tokens literal inside a fenced code block', () => {
    const surface = editor(`
      <pre data-easymde-visual-fence="~~~">
        <code class="language-bash">**literal** [link](https://example.test)</code>
      </pre>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      '~~~bash\n**literal** [link](https://example.test)\n~~~'
    );
  });

  it('does not attach a fence family to an earlier indented code block', () => {
    const surface = editor(`
      <pre><code>indented code</code></pre>
      <pre><code class="language-bash">echo ready</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '    indented code\n\n~~~bash\necho ready\n~~~'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual([null, '~~~']);
  });

  it('maps duplicate no-language content to the later fenced code block', () => {
    const surface = editor(`
      <pre><code>duplicate</code></pre>
      <pre><code>duplicate</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '    duplicate\n\n~~~\nduplicate\n~~~'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual([null, '~~~']);
  });

  it('does not treat an indented paragraph continuation as a code block ordinal', () => {
    const surface = editor('<pre><code>code</code></pre>');

    restoreVisualCodeFenceFamilies(
      surface,
      'paragraph\n    continuation\n\n~~~\ncode\n~~~'
    );

    expect(
      surface.querySelector('pre')?.getAttribute('data-easymde-visual-fence')
    ).toBe('~~~');
  });

  it('counts an eight-space indented code block before a fenced block', () => {
    const surface = editor(`
      <pre><code>code</code></pre>
      <pre><code>code</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '        code\n\n~~~\ncode\n~~~'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual([null, '~~~']);
  });

  it.each([
    ['~~~', 2],
    ['```', 2],
    ['~~~', 3],
    ['```', 3]
  ])(
    'keeps an indented block together across %s fence with %s blank lines',
    (fence, blankLineCount) => {
      const blanks = '\n'.repeat(Number(blankLineCount) + 1);
      const surface = editor(
        '<pre><code>first\n\nsecond</code></pre><pre><code class="language-bash">x</code></pre>'
      );

      restoreVisualCodeFenceFamilies(
        surface,
        `    first${blanks}    second\n\n${fence}bash\nx\n${fence}`
      );

      expect(
        Array.from(surface.querySelectorAll('pre')).map((pre) =>
          pre.getAttribute('data-easymde-visual-fence')
        )
      ).toEqual([null, fence]);
    }
  );

  it('fails closed when the visual surface contains an incomplete Preview window', () => {
    const surface = editor(
      '<p>Visible block</p><div data-easymde-preview-window-spacer="1"></div>'
    );

    expect(() => serializeVisualMarkdown(surface)).toThrow(
      'visual-editor-window-incomplete'
    );
  });

  it('maps a contiguous editable Preview block range to raw CRLF source offsets', () => {
    const source = 'First\r\n\r\nSecond\r\nLast';
    const map = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 3),
      previewBlock('b2', 3, 4)
    ]);

    expect(
      createVisualMarkdownSourceRangeFromPreviewEditMap(
        source,
        map,
        { end: 3, start: 1 }
      )
    ).toEqual({
      end: source.length,
      start: 'First\r\n\r\n'.length
    });
  });

  it('ignores a zero-length generated block outside the selected editable run', () => {
    const source = 'Generated\r\n\r\nEditable\r\nTail';
    const map = previewEditMap([
      previewBlock('b0', 0, 0, false),
      previewBlock('b1', 2, 3),
      previewBlock('b2', 3, 4)
    ]);

    expect(
      createVisualMarkdownSourceRangeFromPreviewEditMap(
        source,
        map,
        { end: 3, start: 1 }
      )
    ).toEqual({
      end: source.length,
      start: 'Generated\r\n\r\n'.length
    });
  });

  it.each([
    {
      name: 'selected range is empty',
      map: previewEditMap([previewBlock('b0', 0, 1)]),
      range: { end: 0, start: 0 }
    },
    {
      name: 'selected range exceeds the map',
      map: previewEditMap([previewBlock('b0', 0, 1)]),
      range: { end: 2, start: 0 }
    },
    {
      name: 'line range exceeds the source',
      map: previewEditMap([previewBlock('b0', 0, 4)]),
      range: { end: 1, start: 0 }
    },
    {
      name: 'selected block is generated',
      map: previewEditMap([previewBlock('b0', 0, 0, false)]),
      range: { end: 1, start: 0 }
    },
    {
      name: 'selected blocks overlap',
      map: previewEditMap([
        previewBlock('b0', 0, 2),
        previewBlock('b1', 1, 3)
      ]),
      range: { end: 2, start: 0 }
    },
    {
      name: 'selected blocks are out of order',
      map: previewEditMap([
        previewBlock('b0', 2, 3),
        previewBlock('b1', 0, 1)
      ]),
      range: { end: 2, start: 0 }
    }
  ])('rejects $name while mapping Preview source ranges', ({ map, range }) => {
    expect(() =>
      createVisualMarkdownSourceRangeFromPreviewEditMap(
        'First\n\nSecond',
        map,
        range
      )
    ).toThrow('visual-editor-window-source-range-invalid');
  });

  it('serializes only the selected editable Block fragment', () => {
    const surface = editor(
      '<p data-easymde-visual-block-id="b0">Before</p>'
      + '<p data-easymde-visual-block-id="b1">Middle <strong>bold</strong></p>'
      + '<p data-easymde-visual-block-id="b2">After</p>'
    );
    const middle = surface.children[1];
    if (!(middle instanceof HTMLElement)) {
      throw new Error('visual-window-middle-block-missing');
    }

    expect(serializeVisualMarkdownBlockFragment([middle])).toBe(
      'Middle **bold**'
    );
  });

  it('merges one edited Block fragment without changing CRLF content outside it', () => {
    const source = 'Before\r\n\r\nMiddle **bold**\r\n\r\nAfter';
    const map = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 3),
      previewBlock('b2', 4, 5)
    ]);

    expect(
      createVisualMarkdownWindowChange(
        source,
        map,
        { end: 2, start: 1 },
        'Middle **bold**',
        'Middle **bolder**'
      )
    ).toEqual({
      changes: {
        from: 'Before\r\n\r\n'.length,
        insert: 'Middle **bolder**\r\n',
        to: 'Before\r\n\r\nMiddle **bold**\r\n'.length
      },
      sourceRange: {
        end: 'Before\r\n\r\nMiddle **bold**\r\n'.length,
        start: 'Before\r\n\r\n'.length
      },
      value: 'Before\r\n\r\nMiddle **bolder**\r\n\r\nAfter'
    });
  });

  it('maps a backward selection inside a Block fragment to its source slice', () => {
    const surface = editor(
      '<p data-easymde-visual-block-id="b1">Middle <strong>bold</strong></p>'
    );
    const block = surface.firstElementChild;
    const text = block?.querySelector('strong')?.firstChild;
    if (!(block instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-window-selection-fixture-invalid');
    }
    const selection = window.getSelection();
    selection?.setBaseAndExtent(text, 4, text, 0);

    expect(
      visualSelectionSourceRangeForBlocks(
        [block],
        'Middle **bold**\r\n',
        'Middle **bold**'
      )
    ).toEqual({
      direction: 'backward',
      end: 'Middle **bold'.length,
      start: 'Middle **'.length
    });
  });

  it('round-trips static Crimson task markers through the visual editor', () => {
    const surface = editor(`
      <ul class="task-list">
        <li class="task-list-item"><span class="easymde-task-checkbox is-checked" role="checkbox" aria-checked="true" aria-disabled="true">✓</span>Done</li>
        <li class="task-list-item"><span class="easymde-task-checkbox" role="checkbox" aria-checked="false" aria-disabled="true"></span>Todo</li>
      </ul>
    `);

    expect(serializeVisualMarkdown(surface)).toBe('- [x] Done\n- [ ] Todo');
  });

  it('prepares native Crimson task inputs only for the visual editor', () => {
    const surface = editor(`
      <ul class="task-list">
        <li class="task-list-item"><input type="checkbox" checked disabled>Done</li>
        <li class="task-list-item"><p><input type="checkbox" disabled>Todo</p></li>
      </ul>
    `);

    prepareVisualTaskListMarkers(surface);

    expect(surface.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(surface.querySelectorAll('.easymde-task-checkbox')).toHaveLength(2);
    expect(serializeVisualMarkdown(surface)).toBe('- [x] Done\n- [ ] Todo');
  });

  it('treats a checked empty task marker as empty without relying on execCommand', () => {
    const surface = editor('<ul class="task-list"><li class="task-list-item"><span class="easymde-task-checkbox is-checked">✓</span></li></ul>');
    const item = surface.querySelector('li') as HTMLLIElement;
    placeCaret(item, item.childNodes.length);
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    try {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      });

      expect(applyVisualBlockShortcut(surface, event)).toBe(true);
      expect(execCommand).not.toHaveBeenCalled();
      expect(surface.querySelector('p')).not.toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(document, 'execCommand', original);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  it.each([
    '~~~',
    '~~~js',
    '~~~~',
    '~~~~bash',
    '~~~~~',
    '~~~~~bash',
    '````',
    '````bash',
    '`````',
    '`````bash',
    '```',
    '```bash'
  ])('forms the supported %s fence only after Enter and canonicalizes it to backticks', (fence) => {
    const surface = editor(`<p>${fence}</p>`);
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-fence-text-missing');
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(true);
    const code = surface.querySelector('pre > code');
    expect(code).not.toBeNull();
    expect(code?.classList.contains('hljs')).toBe(true);
    const placeholder = code?.firstElementChild;
    expect(code?.childNodes).toHaveLength(1);
    expect(placeholder).toBeInstanceOf(HTMLSpanElement);
    expect(placeholder?.getAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe('');
    expect(placeholder?.childNodes).toHaveLength(1);
    expect(placeholder?.firstChild).toBeInstanceOf(Text);
    expect(placeholder?.textContent).toBe('');
    expect(window.getSelection()?.anchorNode).toBe(placeholder?.firstChild);
    expect(window.getSelection()?.focusNode).toBe(placeholder?.firstChild);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(window.getSelection()?.focusOffset).toBe(0);
    const inputFence = fence.match(/^(`{3,}|~{3,})/)?.[1];
    const closingFence = inputFence ? '`'.repeat(inputFence.length) : null;
    const info = fence.slice(inputFence?.length ?? 0);
    if (!closingFence) throw new Error('visual-canonical-fence-missing');
    expect(surface.querySelector('pre')?.getAttribute(
      'data-easymde-visual-fence'
    )).toBe(closingFence);
    expect(
      visualSelectionSourceRange(
        surface,
        `${closingFence}${info}`,
        `${closingFence}${info}`,
        `${closingFence}${info}\n\n${closingFence}`
      )
    ).toEqual({
      direction: 'none',
      end: closingFence.length + info.length + 1,
      start: closingFence.length + info.length + 1
    });
    expect(serializeVisualMarkdown(surface)).toBe(
      `${closingFence}${info}\n\n${closingFence}`
    );
  });

  it.each([
    { fence: '```c++', info: 'c++', languageClass: null },
    { fence: '```c#', info: 'c#', languageClass: null },
    { fence: '``` json', info: ' json', languageClass: 'language-json' },
    { fence: '```json title=test', info: 'json title=test', languageClass: 'language-json' },
    { fence: '~~~json title=test', info: 'json title=test', languageClass: 'language-json' }
  ])('accepts a valid fence info string for $fence', ({ fence, info, languageClass }) => {
    const surface = editor(`<p>${fence}</p>`);
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-fence-info-text-missing');
    placeCaret(text, text.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);

    const pre = surface.querySelector('pre');
    const code = pre?.querySelector(':scope > code');
    expect(pre?.getAttribute('data-easymde-visual-fence-info')).toBe(info);
    if (languageClass) {
      expect(code?.classList.contains(languageClass)).toBe(true);
    } else {
      expect(code?.className).toBe('hljs');
    }
    const inputFamily = fence.match(/^(`{3,}|~{3,})/)?.[1];
    const canonicalFamily = inputFamily
      ? '`'.repeat(inputFamily.length)
      : '';
    expect(serializeVisualMarkdown(surface)).toBe(
      `${canonicalFamily}${info}\n\n${canonicalFamily}`
    );
  });

  it('rejects a backtick fence with an embedded backtick in its info string', () => {
    const surface = editor('<p>`````js`invalid</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-invalid-fence-text-missing');
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(surface.innerHTML).toBe('<p>`````js`invalid</p>');
  });

  it('leaves a tilde shortcut with a backtick info string literal', () => {
    const surface = editor('<p>~~~j`s</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-tilde-info-text-missing');
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(surface.innerHTML).toBe('<p>~~~j`s</p>');
    expect(serializeVisualMarkdown(surface)).toBe('~~~j`s');
  });

  it.each([
    { body: 'before\n~~~\nafter', expectedFence: '~~~~', fence: '~~~' },
    { body: 'before\n~~~~~\nafter', expectedFence: '~~~~~~', fence: '~~~' },
    { body: 'before\n```\nafter', expectedFence: '````', fence: '```' },
    { body: 'before\n`````\nafter', expectedFence: '``````', fence: '```' }
  ])(
    'expands a $fence fence beyond an equal or longer body run and allows deletion',
    ({ body, expectedFence, fence }) => {
      const surface = editor(
        `<pre data-easymde-visual-fence="${fence}" data-easymde-visual-fence-info="js linenos=true"><code class="language-rendered">${body}</code></pre>`
      );
      const code = surface.querySelector('pre > code');
      if (!(code instanceof HTMLElement)) throw new Error('visual-body-run-code-missing');

      expect(serializeVisualMarkdown(surface)).toBe(
        `${expectedFence}js linenos=true\n${body}\n${expectedFence}`
      );

      code.textContent = 'before\nafter';
      expect(serializeVisualMarkdown(surface)).toBe(
        `${fence}js linenos=true\nbefore\nafter\n${fence}`
      );
    }
  );

  it.each(['~~~~~', '~~~~~bash', '`````', '`````bash'])(
    'serializes an unformed arbitrary-length %s marker literally',
    (marker) => {
      expect(serializeVisualMarkdown(editor(`<p>${marker}</p>`))).toBe(marker);
    }
  );

  it('keeps an arbitrary-length fence through placeholder editing and deletion', () => {
    const surface = editor('<p>`````bash</p>');
    const paragraph = surface.querySelector('p');
    const source = paragraph?.firstChild;
    if (!(source instanceof Text)) throw new Error('visual-long-fence-source-missing');
    placeCaret(source, source.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);

    const code = surface.querySelector('pre > code');
    const placeholder = code?.firstElementChild;
    const placeholderText = placeholder?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(placeholder instanceof HTMLSpanElement)
      || !(placeholderText instanceof Text)
    ) throw new Error('visual-long-fence-placeholder-missing');

    expect(serializeVisualMarkdown(surface)).toBe('`````bash\n\n`````');
    placeholderText.data = 'echo ready';
    expect(serializeVisualMarkdown(surface)).toBe('`````bash\necho ready\n`````');
    placeholderText.data = '';
    normalizeVisualCodePlaceholders(surface, 'deleteContentBackward', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('`````bash\n\n`````');
  });

  it('keeps the source info string when deletion rebuilds a code child', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="`````" data-easymde-visual-fence-info="js linenos=true"><code>body</code></pre>'
    );
    const pre = surface.querySelector('pre');
    if (!(pre instanceof HTMLElement)) throw new Error('visual-info-pre-missing');
    const code = pre.querySelector(':scope > code');
    if (!(code instanceof HTMLElement)) throw new Error('visual-info-code-missing');
    const snapshot = captureVisualCodeInputSnapshot(pre);
    if (!snapshot) throw new Error('visual-info-snapshot-missing');

    code.remove();
    pre.append(document.createElement('br'));
    normalizeVisualCodePlaceholders(surface, 'deleteContentBackward', snapshot);

    expect(pre.getAttribute('data-easymde-visual-fence-info')).toBe('js linenos=true');
    expect(serializeVisualMarkdown(surface)).toBe('`````js linenos=true\n\n`````');
  });

  it('preserves the empty code text node across native history and deletion', () => {
    const surface = editor('<p>~~~bash</p>');
    const paragraph = surface.querySelector('p');
    const source = paragraph?.firstChild;
    if (!(source instanceof Text)) throw new Error('visual-empty-fence-source-missing');
    placeCaret(source, source.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);
    const code = surface.querySelector('pre > code');
    const placeholder = code?.firstElementChild;
    const placeholderText = placeholder?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(placeholder instanceof HTMLSpanElement)
      || !(placeholderText instanceof Text)
    ) {
      throw new Error('visual-empty-fence-code-missing');
    }

    placeholderText.data = 'x';
    expect(serializeVisualMarkdown(surface)).toBe('```bash\nx\n```');
    placeholder.removeAttribute('data-easymde-visual-code-placeholder');
    placeCaret(placeholderText, placeholderText.length);
    expect(serializeVisualMarkdown(surface)).toBe('```bash\nx\n```');

    placeholderText.data = '';
    normalizeVisualCodePlaceholders(surface, 'historyUndo', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('```bash\n\n```');
    expect(code.firstChild).toBe(placeholder);
    expect(placeholder.firstChild).toBe(placeholderText);
    expect(placeholder.hasAttribute('data-easymde-visual-code-placeholder')).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(placeholderText);

    placeholderText.data = 'x';
    normalizeVisualCodePlaceholders(surface, 'historyRedo', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('```bash\nx\n```');
    expect(code.firstChild).toBe(placeholder);
    expect(placeholder.firstChild).toBe(placeholderText);
    expect(placeholder.hasAttribute('data-easymde-visual-code-placeholder')).toBe(false);

    placeholderText.data = '';
    normalizeVisualCodePlaceholders(surface, 'deleteContentBackward', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('```bash\n\n```');
    expect(code.firstChild).toBe(placeholder);
    expect(placeholder.firstChild).toBe(placeholderText);

    const backspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });
    expect(applyVisualBlockShortcut(surface, backspace)).toBe(true);
    expect(surface.querySelector('pre')).toBeNull();
    expect(surface.querySelector('p')).not.toBeNull();
  });

  it.each([
    { body: '\n', empty: true, label: 'one LF terminal line ending' },
    { body: '\r\n', empty: true, label: 'one CRLF terminal line ending' },
    { body: '\n\n', empty: false, label: 'two blank body lines' },
    { body: ' \n', empty: false, label: 'body space before a line ending' }
  ])('treats only $label as an empty code body for Backspace', ({
    body,
    empty
  }) => {
    const surface = editor('');
    const pre = document.createElement('pre');
    pre.setAttribute('data-easymde-visual-fence', '~~~');
    const code = document.createElement('code');
    const source = document.createTextNode(`A${body}`);
    code.append(source);
    pre.append(code);
    surface.append(pre);
    placeCaret(source, 1);
    const snapshot = captureVisualCodeInputSnapshot(pre);
    if (!snapshot) throw new Error('visual-empty-body-snapshot-missing');

    source.data = body;
    placeCaret(source, 0);
    normalizeVisualCodePlaceholders(
      surface,
      'deleteContentBackward',
      snapshot
    );
    const backspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });

    expect(applyVisualBlockShortcut(surface, backspace)).toBe(empty);
    expect(backspace.defaultPrevented).toBe(empty);
    expect(surface.querySelector('pre')).toBe(empty ? null : pre);
  });

  it('does not flush pending input for a nonempty code-body Backspace', () => {
    const surface = editor('<pre><code>body</code></pre>');
    const codeText = surface.querySelector('pre > code')?.firstChild;
    if (!(codeText instanceof Text)) {
      throw new Error('visual-code-body-flush-guard-text-missing');
    }
    placeCaret(codeText, 2);
    const beforeEmptyCodeFenceRemoval = vi.fn(() => true);
    const backspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });

    expect(applyVisualBlockShortcut(
      surface,
      backspace,
      beforeEmptyCodeFenceRemoval
    )).toBe(false);
    expect(beforeEmptyCodeFenceRemoval).not.toHaveBeenCalled();
    expect(backspace.defaultPrevented).toBe(false);
    expect(surface.querySelector('pre > code')?.textContent).toBe('body');
  });

  it('leaves a strict empty code fence on Enter and then forms a list marker', () => {
    const surface = editor('<p>```js</p>');
    const source = surface.querySelector('p')?.firstChild;
    if (!(source instanceof Text)) throw new Error('visual-second-enter-source-missing');
    placeCaret(source, source.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);
    const emptyCode = surface.querySelector('pre > code');
    if (!(emptyCode instanceof HTMLElement)) throw new Error('visual-second-enter-code-missing');
    const secondEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });
    expect(applyVisualBlockShortcut(surface, secondEnter)).toBe(true);
    expect(secondEnter.defaultPrevented).toBe(true);
    expect(surface.querySelector('pre')).toBeNull();
    const paragraph = surface.querySelector('p');
    expect(paragraph).not.toBeNull();
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(paragraph);
    expect(serializeVisualMarkdown(surface)).toBe('');

    const marker = document.createTextNode('-');
    paragraph?.replaceChildren(marker);
    placeCaret(marker, marker.length);
    const space = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' '
    });
    expect(applyVisualBlockShortcut(surface, space)).toBe(true);
    expect(surface.querySelector('ul > li')).not.toBeNull();
  });

  it('keeps a non-empty code block in CODE when Enter is pressed', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code>echo hi</code></pre>'
    );
    const codeText = surface.querySelector('pre > code')?.firstChild;
    if (!(codeText instanceof Text)) throw new Error('visual-non-empty-code-text-missing');
    placeCaret(codeText, codeText.length);
    const enter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, enter)).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(surface.querySelector('pre > code')?.textContent).toBe('echo hi');
  });

  it('does not treat an unmarked single-space code body as the empty placeholder', () => {
    const surface = editor('<pre><code> </code></pre>');

    expect(serializeVisualMarkdown(surface)).toBe('```\n \n```');
  });

  it.each(['insertText', 'deleteContentBackward'])(
    'does not scan unrelated code placeholders when the input block is null (%s)',
    (inputType) => {
      const surface = editor(
        '<pre data-easymde-visual-fence="~~~"><code></code></pre><p>Paragraph</p>'
      );
      const placeholder = surface.ownerDocument.createElement('span');
      placeholder.setAttribute('data-easymde-visual-code-placeholder', '');
      placeholder.append(surface.ownerDocument.createTextNode(''));
      const code = surface.querySelector('code');
      if (!code) throw new Error('visual-code-placeholder-fixture-missing');
      code.append(placeholder);
      const before = surface.innerHTML;

      normalizeVisualCodePlaceholders(surface, inputType, null);

      expect(surface.innerHTML).toBe(before);
      expect(surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      )).not.toBeNull();
      expect(serializeVisualMarkdown(surface)).toBe(
        '~~~\n\n~~~\n\nParagraph'
      );
    }
  );

  it('does not form a fence when Enter is pressed before the caret reaches block end', () => {
    const surface = editor('<p>~~~js</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-fence-middle-text-missing');
    placeCaret(text, 3);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(surface.innerHTML).toBe('<p>~~~js</p>');
  });

  it('does not depend on execCommand when converting an unordered list marker', () => {
    const surface = editor('<p>-</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-list-marker-text-missing');
    placeCaret(text, text.length);
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    try {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' '
      });

      expect(applyVisualBlockShortcut(surface, event)).toBe(true);
      expect(execCommand).not.toHaveBeenCalled();
      expect(surface.querySelector('ul > li')).not.toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(document, 'execCommand', original);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  it('removes theme presentation wrappers from the Markdown serialization clone', () => {
    const surface = editor(`
      <h2>
        <span class="prefix"></span>
        <span class="content">Theme heading</span>
        <span class="suffix"></span>
      </h2>
      <blockquote class="multiquote-1">
        <span>“</span>
        <p>Theme quote</p>
      </blockquote>
      <ul><li><section>Theme item</section></li></ul>
      <figure>
        <img src="https://example.test/image.png" alt="Theme image">
        <figcaption>Theme image</figcaption>
      </figure>
      <section class="table-container easymde-table-container">
        <table>
          <thead><tr><th>Name</th></tr></thead>
          <tbody><tr><td>EasyMDE</td></tr></tbody>
        </table>
      </section>
      <p>
        <span class="footnote-word">Project</span><sup class="footnote-ref">[1]</sup>
      </p>
      <section class="footnotes-sep"><span>Reference</span></section>
      <section class="footnotes">
        <span id="fn1" class="footnote-item">
          <span class="footnote-num">[1] </span>
          <p>Project docs: <em>https://example.test/docs</em></p>
        </span>
      </section>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      [
        '## Theme heading',
        '',
        '> Theme quote',
        '',
        '- Theme item',
        '',
        '![Theme image](https://example.test/image.png)',
        '',
        '| Name |',
        '| --- |',
        '| EasyMDE |',
        '',
        '[Project](https://example.test/docs "Project docs")'
      ].join('\n')
    );
    expect(surface.querySelector('h2 > .prefix')).not.toBeNull();
    expect(surface.querySelector('figcaption')).not.toBeNull();
    expect(surface.querySelector('.footnotes')).not.toBeNull();
  });

  it('preserves enhanced math and Mermaid source while protecting generated regions', () => {
    const surface = editor(`
      <p>Editable paragraph</p>
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
      <span
        class="easymde-math easymde-math-inline"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="\\(y^3\\)"
      ><span class="katex">rendered inline math</span></span>
      <div
        class="easymde-mermaid"
        data-easymde-visual-markdown-source="flowchart TD&#10;A--&gt;B"
      ><svg><text>rendered diagram</text></svg></div>
      <section class="footnotes-sep">References</section>
      <section class="footnotes">Generated footnotes</section>
    `);

    protectVisualMarkdownReadOnlyRegions(surface);

    expect(surface.getAttribute('contenteditable')).toBeNull();
    for (const region of surface.querySelectorAll(
      '.easymde-math, .easymde-mermaid, .footnotes-sep, .footnotes'
    )) {
      expect(region.getAttribute('contenteditable')).toBe('false');
    }
    expect(serializeVisualMarkdown(surface)).toBe(
      [
        'Editable paragraph',
        '',
        '$$',
        'x^2',
        '$$',
        '',
        '$y^3$',
        '',
        '```mermaid',
        'flowchart TD',
        'A-->B',
        '```'
      ].join('\n')
    );
  });

  it('protects generated table-of-contents markup from visual editing', () => {
    const surface = editor(`
      <p>Editable paragraph</p>
      <div class="easymde-toc">
        <ul><li><a href="#heading">Generated heading link</a></li></ul>
      </div>
    `);

    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);
    const toc = surface.querySelector<HTMLElement>('.easymde-toc');

    expect(toc?.getAttribute('contenteditable')).toBe('false');
    expect(snapshot).toHaveLength(1);
    toc?.querySelector('a')?.replaceChildren('Changed generated link');
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');
  });

  it('allows responsive layout to add or remove an empty root style attribute', () => {
    const surface = editor(`
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
    `);
    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);
    const math = snapshot[0]?.node;
    if (!math) throw new Error('missing protected test region');

    math.setAttribute('style', '');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).not.toThrow();

    math.setAttribute('style', '  \t\n');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).not.toThrow();

    math.removeAttribute('style');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).not.toThrow();
  });

  it('rejects non-empty root style and other root attribute mutations', () => {
    const surface = editor(`
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
    `);
    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);
    const math = snapshot[0]?.node;
    if (!math) throw new Error('missing protected test region');

    math.setAttribute('style', 'display: block');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).toThrow(
      'visual-editor-read-only-region-mutated'
    );

    math.removeAttribute('style');
    math.setAttribute('data-easymde-probe', '1');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).toThrow(
      'visual-editor-read-only-region-mutated'
    );
  });

  it('rejects deletion, replacement and mutation of generated read-only regions', () => {
    const surface = editor(`
      <p>Editable paragraph</p>
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
      <div
        class="easymde-mermaid"
        data-easymde-visual-markdown-source="flowchart TD&#10;A--&gt;B"
      ><svg><text>rendered diagram</text></svg></div>
    `);
    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);

    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).not.toThrow();

    const math = snapshot[0]?.node;
    const mermaid = snapshot[1]?.node;
    if (!math || !mermaid) throw new Error('missing protected test region');

    math.remove();
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');

    surface.insertBefore(math, mermaid);
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).not.toThrow();

    const replacement = mermaid.cloneNode(true) as HTMLElement;
    mermaid.replaceWith(replacement);
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');

    replacement.replaceWith(mermaid);
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).not.toThrow();

    mermaid.querySelector('text')?.replaceChildren('changed');
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');
  });

  it('maps edits made inside theme-generated link and image markup to Markdown', () => {
    const source = [
      '# Theme document',
      '',
      '[Project](https://example.test/docs "Project docs")',
      '',
      '![Original image](https://example.test/image.png)'
    ].join('\r\n');
    const surface = editor(`
      <h1>
        <span class="prefix"></span>
        <span class="content">Theme document</span>
        <span class="suffix"></span>
      </h1>
      <p>
        <span class="footnote-word">Project</span><sup class="footnote-ref">[1]</sup>
      </p>
      <figure>
        <img src="https://example.test/image.png" alt="Original image">
        <figcaption>Original image</figcaption>
      </figure>
      <section class="footnotes-sep"><span>Reference</span></section>
      <section class="footnotes">
        <span id="fn1" class="footnote-item">
          <span class="footnote-num">[1] </span>
          <p>Project docs: <em>https://example.test/docs</em></p>
        </span>
      </section>
    `);
    const baseline = serializeVisualMarkdown(surface);
    const word = surface.querySelector('.footnote-word');
    const caption = surface.querySelector('figcaption');
    if (!word || !caption) throw new Error('missing themed edit target');
    word.textContent = 'Edited project';
    caption.textContent = 'Edited image';
    const edited = serializeVisualMarkdown(surface);

    expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
      [
        '# Theme document',
        '',
        '[Edited project](https://example.test/docs "Project docs")',
        '',
        '![Edited image](https://example.test/image.png)'
      ].join('\r\n')
    );
  });

  it('applies isolated visual edits across a large CRLF Markdown document', () => {
    const blocks = Array.from({ length: 120 }, (_, index) => [
      `## Section ${index}`,
      '',
      `Unique token ${index}: **value-${index}** and 重复文本.`,
      '',
      `[hidden-${index}]: https://example.test/${index}`
    ].join('\r\n'));
    const source = `${blocks.join('\r\n\r\n')}\r\n`;
    const visible = blocks
      .map((block) => block.split('\r\n').slice(0, 3).join('\n'))
      .join('\n\n');

    for (const index of [0, 1, 37, 78, 119]) {
      const edited = visible.replace(`value-${index}`, `edited-${index}`);
      const merged = mergeVisualMarkdownChange(source, visible, edited);
      expect(merged).toContain(`**edited-${index}**`);
      expect(merged).toContain(
        `[hidden-${index}]: https://example.test/${index}`
      );
      expect(merged.endsWith('\r\n')).toBe(true);
      expect(merged.replace(`edited-${index}`, `value-${index}`)).toBe(
        source
      );
    }
  });

  it('preserves untouched mixed line endings during a visual edit', () => {
    const source = [
      '# Original title\r\n',
      'Visible paragraph\n',
      '[hidden]: https://example.test\r\n',
      '<!-- hidden comment -->\n'
    ].join('');
    const baselineVisual = '# Original title\n\nVisible paragraph';
    const editedVisual = '# Edited title\n\nVisible paragraph';

    expect(
      mergeVisualMarkdownChange(source, baselineVisual, editedVisual)
    ).toBe(
      [
        '# Edited title\r\n',
        'Visible paragraph\n',
        '[hidden]: https://example.test\r\n',
        '<!-- hidden comment -->\n'
      ].join('')
    );
  });

  it.each(['\n', '\r\n', '\r'])(
    'preserves table alignment markers and duplicate table identity across a cell edit (%s)',
    (newline) => {
      const markerOne = '<!-- easymde-table-align:v1 [[1,"center"]] -->';
      const markerTwo = '<!-- easymde-table-align:v1 [[1,"right"]] -->';
      const table = [
        '| A | B |',
        '| --- | ---: |',
        '| 1 | escaped \\| pipe |',
        '| 3 | 4 |'
      ].join(newline);
      const source = [
        markerOne,
        table,
        '',
        markerTwo,
        table,
        '',
        'Neighbor'
      ].join(newline);
      const baseline = [table, '', table, '', 'Neighbor'].join('\n');
      const editedSecondTable = table.replace('escaped \\| pipe', 'edited \\| pipe');
      const edited = [table, '', editedSecondTable, '', 'Neighbor'].join('\n');

      expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
        [
          markerOne,
          table,
          '',
          markerTwo,
          editedSecondTable,
          '',
          'Neighbor'
        ].join(newline)
      );
    }
  );

  it('keeps the raw GFM base delimiter when rendered row overrides change effective alignment', () => {
    const marker = '<!-- easymde-table-align:v1 [[0,"center"],[1,"center"],[1,0,"right"]] -->';
    const sourceTable = [
      '| A | B |',
      '| --- | ---: |',
      '| 1 | 2 |',
      '| 3 | 4 |'
    ].join('\n');
    const source = `${marker}\n${sourceTable}`;
    const surface = editor(`
      <section class="table-container easymde-table-container">
        <table>
          <thead><tr><th align="center">A</th><th align="center">B</th></tr></thead>
          <tbody>
            <tr><td align="right">1</td><td align="center">2</td></tr>
            <tr><td>3</td><td align="right">4</td></tr>
          </tbody>
        </table>
      </section>
    `);
    const baseline = serializeVisualMarkdown(surface);
    const editedCell = surface.querySelector('tbody tr td');
    if (!(editedCell instanceof HTMLElement)) throw new Error('visual-table-cell-missing');
    editedCell.textContent = '1 edited';
    const edited = serializeVisualMarkdown(surface);

    expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
      `${marker}\n${sourceTable.replace('| 1 |', '| 1 edited |')}`
    );
  });

  it('keeps duplicate rendered tables attached to their own annotation marker', () => {
    const markerOne = '<!-- easymde-table-align:v1 [[0,"center"]] -->';
    const markerTwo = '<!-- easymde-table-align:v1 [[0,"right"]] -->';
    const sourceTable = [
      '| A | B |',
      '| --- | ---: |',
      '| 1 | 2 |'
    ].join('\n');
    const source = [
      markerOne,
      sourceTable,
      '',
      markerTwo,
      sourceTable
    ].join('\n');
    const surface = editor(`
      <section class="table-container easymde-table-container">
        <table>
          <thead><tr><th align="center">A</th><th align="center">B</th></tr></thead>
          <tbody><tr><td>1</td><td>2</td></tr></tbody>
        </table>
      </section>
      <section class="table-container easymde-table-container">
        <table>
          <thead><tr><th align="right">A</th><th align="right">B</th></tr></thead>
          <tbody><tr><td>1</td><td>2</td></tr></tbody>
        </table>
      </section>
    `);
    const baseline = serializeVisualMarkdown(surface);
    const secondCell = surface.querySelectorAll('tbody tr td')[3];
    if (!(secondCell instanceof HTMLElement)) throw new Error('duplicate-table-cell-missing');
    secondCell.textContent = 'second edited';
    const edited = serializeVisualMarkdown(surface);

    expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
      [
        markerOne,
        sourceTable,
        '',
        markerTwo,
        sourceTable.replace('| 1 | 2 |', '| 1 | second edited |')
      ].join('\n')
    );
  });

  it('turns a heading prefix into a heading block and keeps the caret editable', () => {
    const surface = editor('<p>#</p>');
    const paragraph = surface.firstElementChild as HTMLParagraphElement;
    const text = paragraph.firstChild as Text;
    placeCaret(text, 1);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' '
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(true);
    expect(surface.innerHTML).toContain('<h1');
    expect(serializeVisualMarkdown(surface)).toBe('#');
  });

  it('turns completed inline Markdown into semantic editable markup', () => {
    const surface = editor('<p>Use **bold**</p>');
    const text = surface.querySelector('p')?.firstChild as Text;
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);
    expect(surface.querySelector('strong')?.textContent).toBe('bold');
    expect(serializeVisualMarkdown(surface)).toBe('Use **bold**');
  });

  it.each(['**bold**', '~~deleted~~', '`literal`'])(
    'leaves inline Markdown syntax literal inside a fenced code body: %s',
    (value) => {
      const surface = editor(`<pre><code>${value}</code></pre>`);
      const text = surface.querySelector('pre > code')?.firstChild;
      if (!(text instanceof Text)) throw new Error('visual-code-inline-text-missing');
      placeCaret(text, text.length);

      expect(applyVisualInlineShortcut(surface)).toBe(false);
      expect(surface.querySelector('pre > code')?.innerHTML).toBe(value);
      expect(surface.querySelector('pre > code strong, pre > code em, pre > code del, pre > code code')).toBeNull();
    }
  );

  it('leaves block shortcut markers literal inside a fenced code body', () => {
    const surface = editor('<pre><code>#</code></pre>');
    const pre = surface.querySelector('pre');
    if (!(pre instanceof HTMLElement)) throw new Error('visual-code-block-pre-missing');
    const cloneNode = vi.spyOn(pre, 'cloneNode');
    const text = surface.querySelector('pre > code')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-code-block-text-missing');
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' '
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(surface.innerHTML).toBe('<pre><code>#</code></pre>');
    expect(cloneNode).not.toHaveBeenCalled();
  });

  it('accepts valid emphasis content containing underscores', () => {
    const strongSurface = editor('<p>Use __bold_value__</p>');
    const strongText = strongSurface.querySelector('p')?.firstChild;
    if (!(strongText instanceof Text)) throw new Error('visual-inline-underscore-strong-text-missing');
    placeCaret(strongText, strongText.length);
    expect(applyVisualInlineShortcut(strongSurface)).toBe(true);
    expect(strongSurface.querySelector('strong')?.textContent).toBe('bold_value');
    expect(serializeVisualMarkdown(strongSurface)).toBe('Use **bold\\_value**');

    const emSurface = editor('<p>Use *italic_value*</p>');
    const emText = emSurface.querySelector('p')?.firstChild;
    if (!(emText instanceof Text)) throw new Error('visual-inline-underscore-em-text-missing');
    placeCaret(emText, emText.length);
    expect(applyVisualInlineShortcut(emSurface)).toBe(true);
    expect(emSurface.querySelector('em')?.textContent).toBe('italic_value');
    expect(serializeVisualMarkdown(emSurface)).toBe('Use *italic\\_value*');
  });

  it.each([
    'Use **bold**x',
    'Use **bold',
    'Use **bold*',
    'Use __bold_',
    'Use ~~deleted~~x',
    'Use `code`x',
    'Use [link](https://example.test)x'
  ])('leaves incomplete or boundary-delimited inline Markdown unchanged: %s', (value) => {
    const surface = editor(`<p>${value}</p>`);
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-inline-negative-text-missing');
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(false);
    expect(surface.querySelector('strong, em, del, code, a')).toBeNull();
    expect(surface.textContent).toBe(value);
  });

  it('retains the existing shortcut marker class on converted inline elements', () => {
    const surface = editor('<p>Use **bold**</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-marker-text-missing');
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);
    expect(surface.querySelector('strong.markdown-inline-applied')).not.toBeNull();
  });

  it('applies reference heading toolbar commands to the visual document', () => {
    const surface = editor('<p>Toolbar heading</p>');
    const text = surface.querySelector('p')?.firstChild as Text;
    placeCaret(text, 7);

    applyVisualToolbarCommand(surface, {
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    });

    expect(surface.querySelector('h2')?.textContent).toBe('Toolbar heading');
    expect(serializeVisualMarkdown(surface)).toBe('## Toolbar heading');
  });

  it.each([
    { expected: '**Toolbar** bold', id: 'bold', prefix: '**', tag: 'strong' },
    { expected: '*Toolbar* bold', id: 'italic', prefix: '*', tag: 'em' },
    { expected: '~~Toolbar~~ bold', id: 'strike', prefix: '~~', tag: 'del' },
    { expected: '`Toolbar` bold', id: 'inlinecode', prefix: '`', tag: 'code' }
  ])('applies the $id toolbar wrap locally and preserves the visual selection', ({ expected, id, prefix, tag }) => {
    const surface = editor('<p>Toolbar bold</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-wrap-text-missing');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'wrap',
      group: 'format',
      icon: 'editor-code',
      id,
      label: id,
      prefix,
      suffix: prefix,
      surface: 'main'
    })).toBe(true);
    expect(serializeVisualMarkdown(surface)).toBe(expected);
    expect(surface.querySelector(`p > ${tag}`)?.textContent).toBe('Toolbar');
    expect(selection?.toString()).toBe('Toolbar');
    expect(selection?.anchorNode).toBe(surface.querySelector(tag)?.firstChild);
    expect(selection?.focusNode).toBe(surface.querySelector(tag)?.firstChild);
    expect(selection?.anchorOffset).toBe(0);
    expect(selection?.focusOffset).toBe(7);
  });

  it('inserts an empty local inline wrapper at a collapsed selection', () => {
    const surface = editor('<p>Toolbar bold</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-collapsed-text-missing');
    placeCaret(text, 7);

    expect(applyVisualToolbarCommand(surface, {
      action: 'wrap',
      group: 'format',
      icon: 'editor-bold',
      id: 'bold',
      label: 'Bold',
      prefix: '**',
      suffix: '**',
      surface: 'main'
    })).toBe(true);
    const strong = surface.querySelector('p > strong');
    expect(strong).not.toBeNull();
    expect(serializeVisualMarkdown(surface)).toBe('Toolbar**** bold');
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(window.getSelection()?.anchorNode?.parentElement).toBe(strong);
  });

  it('preserves a backward visual selection for a local inline wrap', () => {
    const surface = editor('<p>Toolbar bold</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-backward-text-missing');
    const selection = window.getSelection();
    selection?.setBaseAndExtent(text, 7, text, 0);

    expect(applyVisualToolbarCommand(surface, {
      action: 'wrap',
      group: 'format',
      icon: 'editor-bold',
      id: 'bold',
      label: 'Bold',
      prefix: '**',
      suffix: '**',
      surface: 'main'
    })).toBe(true);
    expect(serializeVisualMarkdown(surface)).toBe('**Toolbar** bold');
    expect(selection?.toString()).toBe('Toolbar');
    expect(selection?.anchorNode).toBe(surface.querySelector('strong'));
    expect(selection?.focusNode).toBe(surface.querySelector('strong'));
    expect(selection?.anchorOffset).toBe(1);
    expect(selection?.focusOffset).toBe(0);
  });

  it('creates a local highlighted code fence for a selected paragraph', () => {
    const surface = editor('<p>Alpha</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-code-fence-text-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'codeFence',
      group: 'insert',
      icon: 'media-code',
      id: 'codefence',
      label: 'Code fence',
      surface: 'main'
    })).toBe(true);
    const code = surface.querySelector('pre > code');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.textContent).toBe('Alpha');
    expect(serializeVisualMarkdown(surface)).toBe('```\nAlpha\n```');
    const codeText = code?.firstChild;
    expect(codeText).toBeInstanceOf(Text);
    expect(selection?.anchorNode).toBe(codeText);
    expect(selection?.focusNode).toBe(codeText);
  });

  it('flattens formatted children when fencing a middle visual selection', () => {
    const surface = editor('<p>Al<strong>pha</strong>!</p>');
    const selected = surface.querySelector('strong')?.firstChild;
    if (!(selected instanceof Text)) {
      throw new Error('visual-toolbar-formatted-code-fence-text-missing');
    }
    const range = document.createRange();
    range.selectNodeContents(selected);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'codeFence',
      group: 'insert',
      icon: 'media-code',
      id: 'codefence',
      label: 'Code fence',
      surface: 'main'
    })).toBe(true);
    const code = surface.querySelector('pre > code');
    const codeText = code?.firstChild;
    expect(code?.children).toHaveLength(0);
    expect(codeText).toBeInstanceOf(Text);
    expect(surface.querySelector('p')?.textContent).toBe('Al');
    expect(code?.textContent).toBe('pha');
    expect(surface.querySelectorAll('p')).toHaveLength(2);
    expect(surface.querySelectorAll('p')[1]?.textContent).toBe('!');
    expect(serializeVisualMarkdown(surface)).toBe(
      'Al\n\n```\npha\n```\n\n!'
    );
    expect(selection?.toString()).toBe('pha');
    expect(selection?.anchorOffset).toBe(0);
    expect(selection?.focusOffset).toBe(3);
  });

  it('uses the canonical code placeholder for an empty code-fence command', () => {
    const surface = editor('<p><br></p>');
    const paragraph = surface.querySelector('p');
    if (!paragraph) throw new Error('visual-empty-code-fence-paragraph-missing');
    placeCaret(paragraph, paragraph.childNodes.length);

    expect(applyVisualToolbarCommand(surface, {
      action: 'codeFence',
      group: 'insert',
      icon: 'media-code',
      id: 'codefence',
      label: 'Code fence',
      surface: 'main'
    })).toBe(true);
    expect(surface.querySelector('pre > code')?.textContent).toBe('code');
    expect(serializeVisualMarkdown(surface)).toBe('```\ncode\n```');
    expect(window.getSelection()?.toString()).toBe('code');
  });

  it('handles toolbar code commands inside an existing code block without nesting or leaving visual editing', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code class="hljs language-bash">test</code></pre>'
    );
    const text = surface.querySelector('pre > code')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-code-context-text-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const before = surface.innerHTML;

    for (const command of [
      { id: 'inlinecode', prefix: '`', suffix: '`' },
      { id: 'codefence', prefix: undefined, suffix: undefined }
    ]) {
      expect(applyVisualToolbarCommand(surface, {
        action: 'inlinecode' === command.id ? 'wrap' : 'codeFence',
        group: 'insert',
        icon: 'media-code',
        id: command.id,
        label: command.id,
        ...(undefined !== command.prefix ? { prefix: command.prefix } : {}),
        ...(undefined !== command.suffix ? { suffix: command.suffix } : {}),
        surface: 'main'
      })).toBe(true);
    }
    expect(surface.innerHTML).toBe(before);
    expect(selection?.anchorNode).toBe(text);
    expect(selection?.focusNode).toBe(text);
  });

  it('fails closed for a cross-block heading selection', () => {
    const surface = editor('<p>First block</p><p>Second block</p>');
    const first = surface.children[0]?.firstChild;
    const second = surface.children[1]?.firstChild;
    if (!(first instanceof Text) || !(second instanceof Text)) {
      throw new Error('visual-cross-block-heading-text-missing');
    }
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, second.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    })).toBe(false);
    expect(surface.querySelectorAll('h2')).toHaveLength(0);
    expect(surface.textContent).toBe('First blockSecond block');
  });

  it('applies only the visual delta and preserves untouched Markdown syntax', () => {
    const source = [
      '# Original title',
      '',
      'Raw <u>underlined</u> text and an [OpenAI][openai] reference.',
      '',
      '[openai]: https://openai.com "OpenAI"',
      ''
    ].join('\r\n');
    const baselineVisual = [
      '# Original title',
      '',
      'Raw underlined text and an [OpenAI](https://openai.com "OpenAI") reference.'
    ].join('\n');
    const editedVisual = baselineVisual.replace(
      '# Original title',
      '# Edited title'
    );

    expect(
      mergeVisualMarkdownChange(source, baselineVisual, editedVisual)
    ).toBe(
      [
        '# Edited title',
        '',
        'Raw <u>underlined</u> text and an [OpenAI][openai] reference.',
        '',
        '[openai]: https://openai.com "OpenAI"',
        ''
      ].join('\r\n')
    );
  });

  it('maps the first visual input into an empty canonical document', () => {
    expect(mergeVisualMarkdownChange('', '', 'First paragraph')).toBe(
      'First paragraph'
    );
  });

  it('appends visual text before an untouched trailing source newline', () => {
    expect(
      mergeVisualMarkdownChange('Paragraph\n', 'Paragraph', 'Paragraph!')
    ).toBe('Paragraph!\n');
    expect(
      mergeVisualMarkdownChange('Paragraph\r\n', 'Paragraph', 'Paragraph!')
    ).toBe('Paragraph!\r\n');
  });

  it('preserves terminal spaces and newlines when inserting at their visual boundary', () => {
    expect(mergeVisualMarkdownChange(' ', '', '~')).toBe('~ ');
    expect(mergeVisualMarkdownChange('one ', 'one', 'one~')).toBe('one~ ');
    expect(mergeVisualMarkdownChange('one\n\n', 'one', 'one~')).toBe('one~\n\n');
  });

  it('edits visible link text without rewriting reference links or raw HTML', () => {
    const source = [
      'Raw <u>underlined</u> text and an [OpenAI][openai] reference.',
      '',
      '[openai]: https://openai.com "OpenAI"',
      ''
    ].join('\r\n');
    const baselineVisual =
      'Raw underlined text and an [OpenAI](https://openai.com "OpenAI") reference.';
    const editedVisual = baselineVisual.replace('OpenAI]', 'OpenAI edited]');

    expect(
      mergeVisualMarkdownChange(source, baselineVisual, editedVisual)
    ).toBe(
      [
        'Raw <u>underlined</u> text and an [OpenAI edited][openai] reference.',
        '',
        '[openai]: https://openai.com "OpenAI"',
        ''
      ].join('\r\n')
    );
  });

  it('fails instead of rewriting visual syntax that cannot map to source text', () => {
    expect(() =>
      mergeVisualMarkdownChange(
        'entirely different source',
        'unmapped visual content',
        'changed visual content'
      )
    ).toThrow('visual-editor-markdown-merge-failed');
  });

  it('maps a visible edit even when hidden Markdown repeats the same text', () => {
    const source = [
      'foo',
      '',
      '[//]: # (foo)',
      '',
      'foo'
    ].join('\n');

    expect(
      mergeVisualMarkdownChange(source, 'foo\n\nfoo', 'foo\n\nbar')
    ).toBe('foo\n\n[//]: # (foo)\n\nbar');
    expect(source).toBe('foo\n\n[//]: # (foo)\n\nfoo');
  });

  it('deletes the visible duplicate without scanning hidden Markdown text globally', () => {
    const source = [
      'foo',
      '',
      '[//]: # (foo)',
      '',
      'foo'
    ].join('\n');

    expect(
      mergeVisualMarkdownChange(source, 'foo\n\nfoo', 'foo\n\n')
    ).toBe('foo\n\n[//]: # (foo)\n\n');
  });

  it('keeps a visible repeated block edit attached to its mapped source range', () => {
    const source = [
      'Before',
      '',
      'repeat',
      '',
      'repeat',
      '',
      'After'
    ].join('\n');
    const baseline = source;
    const edited = [
      'Before',
      '',
      'repeat',
      '',
      '',
      'After'
    ].join('\n');

    expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
      [
        'Before',
        '',
        'repeat',
        '',
        '',
        'After'
      ].join('\n')
    );
  });

  it('maps source offsets inside formatting without consuming a hidden trailing line ending', () => {
    const source = 'Before **Formatted**\n';
    const visual = 'Before **Formatted**';
    const map = createVisualMarkdownSourceIntervalMap(source, visual);
    const start = visual.indexOf('Formatted');

    expect(map.resolve(start)).toBe(source.indexOf('Formatted'));
    expect(map.resolve(start + 'Formatted'.length)).toBe(
      source.indexOf('Formatted') + 'Formatted'.length
    );
    expect(map.resolve(visual.length)).toBe(source.length - 1);
  });

  it('maps visible text around hidden references and generated math/Mermaid syntax', () => {
    const source = [
      'Before **Visible**',
      '',
      '[ref]: https://example.test',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      'Tail'
    ].join('\n');
    const visual = [
      'Before **Visible**',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      'Tail'
    ].join('\n');
    const map = createVisualMarkdownSourceIntervalMap(source, visual);
    const start = visual.indexOf('Tail');

    expect(map.resolve(start)).toBe(source.indexOf('Tail'));
    expect(map.resolve(start + 'Tail'.length)).toBe(
      source.indexOf('Tail') + 'Tail'.length
    );
  });

  it.each([
    {
      data: '!',
      inputType: 'insertText' as const,
      sourceSelection: { direction: 'none' as const, end: 6, start: 6 },
      visualSelection: { end: 6, start: 6 },
      expected: {
        visualSelection: { end: 7, start: 7 },
        sourceMarkdown: 'Before! after',
        visualMarkdown: 'Before! after',
        selection: { direction: 'none' as const, end: 7, start: 7 }
      }
    },
    {
      data: null,
      inputType: 'deleteContentBackward' as const,
      sourceSelection: { direction: 'none' as const, end: 7, start: 6 },
      visualSelection: { end: 7, start: 6 },
      expected: {
        visualSelection: { end: 6, start: 6 },
        sourceMarkdown: 'Beforeafter',
        visualMarkdown: 'Beforeafter',
        selection: { direction: 'none' as const, end: 6, start: 6 }
      }
    },
    {
      data: 'new',
      inputType: 'insertReplacementText' as const,
      sourceSelection: { direction: 'forward' as const, end: 12, start: 7 },
      visualSelection: { end: 12, start: 7 },
      expected: {
        visualSelection: { end: 10, start: 10 },
        sourceMarkdown: 'Before new',
        visualMarkdown: 'Before new',
        selection: { direction: 'none' as const, end: 10, start: 10 }
      }
    },
    {
      data: null,
      inputType: 'deleteByCut' as const,
      sourceSelection: { direction: 'forward' as const, end: 12, start: 6 },
      visualSelection: { end: 12, start: 6 },
      expected: {
        visualSelection: { end: 6, start: 6 },
        sourceMarkdown: 'Before',
        visualMarkdown: 'Before',
        selection: { direction: 'none' as const, end: 6, start: 6 }
      }
    }
  ])(
    'applies a safe $inputType intent to source and visual Markdown once',
    ({ data, expected, inputType, sourceSelection, visualSelection }) => {
      expect(
        applyVisualMarkdownEditIntent(
          'Before after',
          'Before after',
          sourceSelection,
          visualSelection,
          inputType,
          data
        )
      ).toEqual(expected);
    }
  );

  it('rejects history and paste input intents from the direct editor path', () => {
    expect(
      applyVisualMarkdownEditIntent(
        'Before',
        'Before',
        { end: 6, start: 6 },
        { end: 6, start: 6 },
        'historyUndo',
        null
      )
    ).toBeNull();
    expect(
      applyVisualMarkdownEditIntent(
        'Before',
        'Before',
        { end: 6, start: 6 },
        { end: 6, start: 6 },
        'insertFromPaste',
        'pasted'
      )
    ).toBeNull();
  });

  it('adds the first zero-body code line while keeping the caret before its delimiter newline', () => {
    expect(applyVisualMarkdownEditIntent(
      '~~~\n~~~',
      '~~~\n~~~',
      { end: 4, start: 4 },
      { end: 4, start: 4 },
      'insertText',
      'A',
      {
        sourceCaretLength: 1,
        sourceReplacement: 'A\n',
        visualCaretLength: 1,
        visualReplacement: 'A\n'
      }
    )).toEqual({
      selection: { direction: 'none', end: 5, start: 5 },
      sourceMarkdown: '~~~\nA\n~~~',
      visualMarkdown: '~~~\nA\n~~~',
      visualSelection: { end: 5, start: 5 }
    });
  });

  it('maps a visual selection back to the canonical Markdown range', () => {
    const surface = editor('<p>Choose <strong>this</strong> text</p>');
    const text = surface.querySelector('strong')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(
      visualSelectionSourceRange(
        surface,
        'Choose **this** text',
        'Choose **this** text'
      )
    ).toEqual({ direction: 'forward', end: 13, start: 9 });
  });

  it.each([
    {
      expected: { direction: 'forward', end: 9, start: 6 },
      markdown: 'Lead\n\n---\n\nTail',
      range: { end: 10, start: 6 },
      newline: 'LF'
    },
    {
      expected: { direction: 'forward', end: 11, start: 8 },
      markdown: 'Lead\r\n\r\n---\r\n\r\nTail',
      range: { end: 13, start: 8 },
      newline: 'CRLF'
    },
    {
      expected: { direction: 'forward', end: 3, start: 0 },
      markdown: '---\r',
      range: { end: 4, start: 0 },
      newline: 'CR'
    },
    {
      expected: { direction: 'forward', end: 3, start: 0 },
      markdown: '---',
      range: { end: 3, start: 0 },
      newline: 'EOF'
    }
  ])('maps a native thematic-break selection for $newline', ({
    expected,
    markdown,
    range
  }) => {
    const surface = editor(
      '<p>Lead</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const thematicBreak = surface.querySelector('hr');
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-thematic-break-test-node-missing');
    }
    const nativeRange = document.createRange();
    nativeRange.selectNode(thematicBreak);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nativeRange);

    expect(captureVisualThematicBreakSelection(surface)).toMatchObject({
      block: thematicBreak,
      direction: 'forward'
    });
    expect(
      visualThematicBreakSourceSelection(
        markdown,
        range,
        'forward'
      )
    ).toEqual(expected);
    surface.remove();
  });

  it('preserves a backward native thematic-break direction', () => {
    const surface = editor(
      '<p>Lead</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const thematicBreak = surface.querySelector('hr');
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-thematic-break-backward-node-missing');
    }
    const nativeRange = document.createRange();
    nativeRange.selectNode(thematicBreak);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nativeRange);
    selection?.setBaseAndExtent(
      surface,
      nativeRange.endOffset,
      surface,
      nativeRange.startOffset
    );

    expect(captureVisualThematicBreakSelection(surface)).toMatchObject({
      block: thematicBreak,
      direction: 'backward'
    });
    expect(
      visualThematicBreakSourceSelection(
        'Lead\n\n---\n\nTail',
        { end: 10, start: 6 },
        'backward'
      )
    ).toEqual({ direction: 'backward', end: 9, start: 6 });
    surface.remove();
  });
  it.each([
    { label: 'too few markers', markdown: '--\n', range: { end: 3, start: 0 } },
    { label: 'mixed markers', markdown: '-*-\n', range: { end: 4, start: 0 } },
    { label: 'partial CRLF', markdown: '---\r\n', range: { end: 4, start: 0 } }
  ])('rejects a $label thematic-break source range', ({ markdown, range }) => {
    expect(() =>
      visualThematicBreakSourceSelection(markdown, range, 'forward')
    ).toThrow('visual-editor-selection-map-failed');
  });

  it.each(['- - -', '_ _ _', '* * *'])(
    'maps the spaced thematic-break token %s in both directions',
    (marker) => {
      const source = `Lead\n\n${marker}\n\nTail`;
      const start = source.indexOf(marker);
      expect(start).toBe('Lead\n\n'.length);
      const range = { end: start + marker.length + 1, start };
      expect(
        visualThematicBreakSourceSelection(source, range, 'forward')
      ).toEqual({ direction: 'forward', end: start + marker.length, start });
      expect(
        visualThematicBreakSourceSelection(source, range, 'backward')
      ).toEqual({ direction: 'backward', end: start + marker.length, start });
    }
  );

  it.each([
    {
      expected: 'one two',
      label: 'a soft-wrapped paragraph',
      markdown: 'one\ntwo'
    },
    {
      expected: '- one\n- two',
      label: 'populated list items',
      markdown: '- one\n- two'
    },
    {
      expected: '> one\n> two',
      label: 'populated quote lines',
      markdown: '> one\n> two'
    },
    {
      expected: '```\nconst a = 1;\nconst b = 2;\n```',
      label: 'a fenced code body',
      markdown: '```\nconst a = 1;\nconst b = 2;\n```'
    },
    {
      expected: 'one  \ntwo',
      label: 'a hard break',
      markdown: 'one  \ntwo'
    },
    {
      expected: '普通```bash echo hi ```文本',
      label: 'a renderer-joined fence-looking run',
      markdown: '普通```bash\necho hi\n```文本'
    }
  ])('folds only rendered text runs for $label', ({ expected, markdown }) => {
    expect(foldVisualMarkdownSoftBreaks(markdown)).toBe(expected);
  });

  it('does not renormalize a repeated pointer hit', () => {
    const surface = editor(
      '<p>Lead</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const thematicBreak = surface.querySelector('hr');
    const text = surface.querySelector('p')?.firstChild;
    if (!(thematicBreak instanceof HTMLHRElement) || !(text instanceof Text)) {
      throw new Error('visual-repeated-thematic-break-fixture-missing');
    }
    placeCaret(text, 2);
    const first = prepareVisualThematicBreakPointerSelection(
      surface,
      thematicBreak
    );
    expect(first?.normalized).toBe(true);
    const second = prepareVisualThematicBreakPointerSelection(
      surface,
      thematicBreak
    );
    expect(second).toMatchObject({
      block: thematicBreak,
      direction: 'forward',
      normalized: false
    });
    first?.restore();
    surface.remove();
  });

  it('normalizes a collapsed pointer hit to the exact HR node and restores it', () => {
    const surface = editor(
      '<p>Lead</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const paragraph = surface.querySelector('p');
    const text = paragraph?.firstChild;
    const thematicBreak = surface.querySelector('hr');
    if (!(text instanceof Text) || !(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-thematic-break-pointer-fixture-missing');
    }
    placeCaret(text, 2);
    const before = window.getSelection();
    const beforeSnapshot = {
      anchorNode: before?.anchorNode,
      anchorOffset: before?.anchorOffset,
      focusNode: before?.focusNode,
      focusOffset: before?.focusOffset
    };
    const preparation = prepareVisualThematicBreakPointerSelection(
      surface,
      thematicBreak
    );
    expect(preparation).toMatchObject({
      block: thematicBreak,
      direction: 'forward',
      normalized: true
    });
    expect(captureVisualThematicBreakSelection(surface)).toMatchObject({
      block: thematicBreak,
      direction: 'forward'
    });
    preparation?.restore();
    const restored = window.getSelection();
    expect(restored?.anchorNode).toBe(beforeSnapshot.anchorNode);
    expect(restored?.anchorOffset).toBe(beforeSnapshot.anchorOffset);
    expect(restored?.focusNode).toBe(beforeSnapshot.focusNode);
    expect(restored?.focusOffset).toBe(beforeSnapshot.focusOffset);
    surface.remove();
  });

  it('does not retarget a deliberate owned range or a foreign/stale HR', () => {
    const surface = editor(
      '<p>Lead text</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const paragraph = surface.querySelector('p');
    const text = paragraph?.firstChild;
    const thematicBreak = surface.querySelector('hr');
    if (!(text instanceof Text) || !(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-thematic-break-pointer-negative-fixture-missing');
    }
    const selection = window.getSelection();
    const deliberate = document.createRange();
    deliberate.setStart(text, 0);
    deliberate.setEnd(text, 4);
    selection?.removeAllRanges();
    selection?.addRange(deliberate);
    expect(
      prepareVisualThematicBreakPointerSelection(surface, thematicBreak)
    ).toBeNull();
    expect(selection?.toString()).toBe('Lead');
    selection?.removeAllRanges();
    selection?.collapse(text, 1);
    thematicBreak.setAttribute('data-easymde-preview-window-spacer', '1');
    expect(
      prepareVisualThematicBreakPointerSelection(surface, thematicBreak)
    ).toBeNull();
    thematicBreak.remove();
    expect(
      prepareVisualThematicBreakPointerSelection(surface, thematicBreak)
    ).toBeNull();
    surface.remove();
  });

  it('preserves forward and backward native HR ranges', () => {
    const surface = editor(
      '<p>Lead</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const thematicBreak = surface.querySelector('hr');
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-thematic-break-pointer-direction-fixture-missing');
    }
    const range = document.createRange();
    range.selectNode(thematicBreak);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const forward = prepareVisualThematicBreakPointerSelection(
      surface,
      thematicBreak
    );
    expect(forward).toMatchObject({ direction: 'forward', normalized: false });
    selection?.setBaseAndExtent(
      surface,
      range.endOffset,
      surface,
      range.startOffset
    );
    const backward = prepareVisualThematicBreakPointerSelection(
      surface,
      thematicBreak
    );
    expect(backward).toMatchObject({ direction: 'backward', normalized: false });
    surface.remove();
  });

  it.each([
    'mixed range',
    'spacer',
    'read-only'
  ])('rejects a nonmatching thematic-break shape: %s', (kind) => {
    const surface = editor(
      '<p>Lead</p><hr data-easymde-visual-block-id="hr"><p>Tail</p>'
    );
    const thematicBreak = surface.querySelector('hr');
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-thematic-break-rejection-node-missing');
    }
    const selection = window.getSelection();
    if ('mixed range' === kind) {
      const range = document.createRange();
      range.setStart(surface, 1);
      range.setEnd(surface, 3);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      if ('spacer' === kind) {
        thematicBreak.setAttribute('data-easymde-preview-window-spacer', '1');
      } else {
        thematicBreak.setAttribute('contenteditable', 'false');
      }
      const range = document.createRange();
      range.selectNode(thematicBreak);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    expect(captureVisualThematicBreakSelection(surface)).toBeNull();
    surface.remove();
  });

  it.each([
    { end: 0, start: 0 },
    { end: 11, start: 6 }
  ])('rejects a missing or stale thematic-break source line', (range) => {
    expect(() =>
      visualThematicBreakSourceSelection(
        'Lead\n\n---\n\nTail',
        range,
        'forward'
      )
    ).toThrow('visual-editor-selection-map-failed');
  });

  it('maps an empty list body boundary without reading the document Selection', () => {
    const surface = editor(
      '<p>before</p><ul><li><br></li></ul><p>after</p>'
    );
    const source = 'before\n\n- \n\nafter';
    const baseline = serializeVisualMarkdown(surface);
    const body = surface.querySelector('li');
    if (!(body instanceof HTMLElement)) {
      throw new Error('visual-empty-list-boundary-body-missing');
    }

    expect(
      visualBoundarySourceOffset(surface, source, baseline, body, 0)
    ).toBe(10);
  });


  it('maps a native empty nested quote caret to its unique canonical body boundary', () => {
    const surface = editor([
      '<blockquote>\n',
      '  <p><br></p>\n',
      '  <blockquote>\n',
      '    <p><br></p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-empty-nested-quote-target-missing');
    }
    placeCaret(target, 0);
    const source = '> \n\n> > \n> >\n> > > deep\n\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(
      visualSelectionSourceRange(surface, source, baseline, baseline)
    ).toEqual({ direction: 'none', end: 8, start: 8 });
  });

  it('keeps the canonical separator boundary for a non-empty outer quote', () => {
    const surface = editor([
      '<blockquote>\n',
      '  <p>x</p>\n',
      '  <blockquote>\n',
      '    <p><br></p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-nested-quote-source-nine-target-missing');
    }
    placeCaret(target, 0);
    const source = '> x\n\n> > \n> >\n> > > deep\n\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(
      visualSelectionSourceRange(surface, source, baseline, baseline)
    ).toEqual({ direction: 'none', end: 9, start: 9 });
  });

  it('preserves CRLF source offsets for an empty nested quote boundary', () => {
    const surface = editor([
      '<blockquote>\n',
      '  <p><br></p>\n',
      '  <blockquote>\n',
      '    <p><br></p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-nested-quote-crlf-target-missing');
    }
    placeCaret(target, 0);
    const source = '> \r\n\r\n> > \r\n> >\r\n> > > deep\r\n\r\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(
      visualSelectionSourceRange(surface, source, baseline, baseline)
    ).toEqual({ direction: 'none', end: 10, start: 10 });
  });

  it('keeps the original mapper for already-resolved empty nested bodies', () => {
    const surface = editor([
      '<blockquote>\n',
      '<p><br></p>\n',
      '<blockquote>\n',
      '<p><br></p>\n',
      '<p><br></p>\n',
      '<blockquote><p>deep</p></blockquote>\n',
      '</blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>'
    ].join(''));
    const source = serializeVisualMarkdown(surface);
    const targets = Array.from(surface.querySelectorAll('blockquote p'))
      .filter((paragraph): paragraph is HTMLElement => paragraph instanceof HTMLElement)
      .slice(0, 3);
    expect(targets).toHaveLength(3);
    for (const [index, target] of targets.entries()) {
      placeCaret(target, 0);
      const expected = [2, 12, 24][index];
      expect(expected).toBeDefined();
      expect(
        visualSelectionSourceRange(surface, source, source, source)
      ).toEqual({ direction: 'none', end: expected, start: expected });
    }
  });

  it.each([
    [
      'nested unordered lists',
      '<ul>\n<li><p><br></p>\n<ul>\n<li><p><br></p>\n</li>\n</ul>\n</li>\n</ul>\n<p>Tail</p>',
      'ul > li > ul > li > p',
      '- parent\n- - ',
      13
    ],
    [
      'nested ordered lists',
      '<ol>\n<li><p><br></p>\n<ol>\n<li><p><br></p>\n</li>\n</ol>\n</li>\n</ol>\n<p>Tail</p>',
      'ol > li > ol > li > p',
      '1.   \n   \n1. 1. \n\nTail',
      16
    ]
  ])('exports an already-mapped boundary for %s', (
    _description,
    markup,
    selector,
    source,
    expectedSourceOffset
  ) => {
    const surface = editor(markup);
    const baseline = serializeVisualMarkdown(surface);
    const target = surface.querySelector(selector);
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-nested-list-boundary-target-missing');
    }
    placeCaret(target, 0);

    const exported = visualEmptyStructuralBodySelection(
      surface,
      source,
      baseline,
      baseline
    );
    if (!exported || 'failure' in exported) {
      throw new Error(
        exported?.failure ?? 'visual-nested-list-boundary-export-failed'
      );
    }
    expect(exported.sourceOffset).toBe(expectedSourceOffset);
    expect(
      visualSelectionSourceRange(surface, source, baseline, baseline)
    ).toEqual({
      direction: 'none',
      end: expectedSourceOffset,
      start: expectedSourceOffset
    });
  });

  it('does not promote a nonempty structural element into the empty-body owner', () => {
    const surface = editor('<blockquote><p>text</p></blockquote><p>Tail</p>');
    const target = surface.querySelector('blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-nonempty-structural-target-missing');
    }
    placeCaret(target, 0);
    const source = serializeVisualMarkdown(surface);

    expect(
      visualEmptyStructuralBodySelection(surface, source, source, source)
    ).toBeNull();
  });

  it('maps an empty structural body after one separator while preserving extra source space', () => {
    const surface = editor('<blockquote><p><br></p></blockquote><p>Tail</p>');
    const target = surface.querySelector('blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-empty-quote-extra-space-target-missing');
    }
    placeCaret(target, 0);
    const source = '>  \n\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(
      visualSelectionSourceRange(surface, source, baseline, baseline)
    ).toEqual({ direction: 'none', end: 2, start: 2 });
  });

  it.each([
    [
      'quote',
      '<blockquote><p><br></p></blockquote>',
      '> ',
      'blockquote > p'
    ],
    [
      'unordered list',
      '<ul><li><br></li></ul>',
      '- ',
      'ul > li'
    ]
  ])('keeps the existing EOF mapping for a sole empty %s body', (
    _description,
    markup,
    source,
    selector
  ) => {
    const surface = editor(markup);
    const target = surface.querySelector(selector);
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-empty-eof-compatibility-target-missing');
    }
    placeCaret(target, 0);
    const baseline = serializeVisualMarkdown(surface);

    expect(
      visualSelectionSourceRange(surface, source, baseline, baseline)
    ).toEqual({ direction: 'none', end: 2, start: 2 });
  });

  it('rejects a quote-looking source line inside a fenced code block', () => {
    const surface = editor([
      '<blockquote>',
      '  <p><br></p>',
      '  <blockquote>',
      '    <p><br></p>',
      '    <blockquote><p>deep</p></blockquote>',
      '  </blockquote>',
      '</blockquote>',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-fenced-quote-target-missing');
    }
    placeCaret(target, 0);
    const source = '~~~\n> >   \n~~~\n\n> \n\n> >\n> > > deep\n\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(() => visualSelectionSourceRange(
      surface,
      source,
      baseline,
      baseline
    )).toThrow('visual-editor-markdown-merge-failed');
  });

  it.each([
    [
      'an indented code block',
      '    > >   \n\n> \n\n> >\n> > > deep\n\nTail'
    ],
    [
      'inline code',
      '`> >   `\n\n> \n\n> >\n> > > deep\n\nTail'
    ],
    [
      'an ordered marker for an unordered list body',
      '> \n\n> 1.  \n> >\n> > > deep\n\nTail'
    ]
  ])('rejects %s as an incompatible structural source owner', (
    _description,
    source
  ) => {
    const surface = editor([
      '<blockquote>',
      '  <p><br></p>',
      '  <blockquote>',
      '    <p><br></p>',
      '    <blockquote><p>deep</p></blockquote>',
      '  </blockquote>',
      '</blockquote>',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-incompatible-structural-owner-target-missing');
    }
    placeCaret(target, 0);
    const baseline = serializeVisualMarkdown(surface);

    expect(() => visualSelectionSourceRange(
      surface,
      source,
      baseline,
      baseline
    )).toThrow('visual-editor-markdown-merge-failed');
  });

  it('rejects an unmatched visible source prefix before an empty structural body', () => {
    const surface = editor([
      '<blockquote>',
      '  <p><br></p>',
      '  <blockquote>',
      '    <p><br></p>',
      '    <blockquote><p>deep</p></blockquote>',
      '  </blockquote>',
      '</blockquote>',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-unmatched-prefix-target-missing');
    }
    placeCaret(target, 0);
    const source = 'Different text\n\n> \n\n> >\n> > > deep\n\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(() => visualSelectionSourceRange(
      surface,
      source,
      baseline,
      baseline
    )).toThrow('visual-editor-markdown-merge-failed');
  });

  it('rejects multiple compatible source owners for one empty structural body', () => {
    const surface = editor([
      '<blockquote>',
      '  <p><br></p>',
      '  <blockquote>',
      '    <p><br></p>',
      '    <blockquote><p>deep</p></blockquote>',
      '  </blockquote>',
      '</blockquote>',
      '<p>Tail</p>'
    ].join(''));
    const target = surface.querySelector('blockquote > blockquote > p');
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-ambiguous-quote-target-missing');
    }
    placeCaret(target, 0);
    const source = '> \n\n> > \n> > \n> >\n> > > deep\n\nTail';
    const baseline = serializeVisualMarkdown(surface);

    expect(() => visualSelectionSourceRange(
      surface,
      source,
      baseline,
      baseline
    )).toThrow('visual-editor-markdown-merge-ambiguous');
  });

  it('maps the non-empty paper root start to canonical offset zero', () => {
    const surface = editor('<h1>Heading</h1><p>Body</p>');
    placeCaret(surface, 0);

    expect(
      visualSelectionSourceRange(
        surface,
        '# Heading\n\nBody',
        '# Heading\n\nBody'
      )
    ).toEqual({ direction: 'none', end: 0, start: 0 });
  });

  it('maps an unchanged root-end selection directly to the canonical source end', () => {
    const surface = editor('<p>One</p><h1>Two</h1>');
    const source = 'One\n\n# Two';
    placeCaret(surface, surface.childNodes.length);

    expect(
      visualSelectionSourceRange(surface, source, source, source)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('keeps a changed root-end selection mapped to the new source position', () => {
    const surface = editor('<p>Before changed</p>');
    const source = 'Before';
    const baselineVisual = 'Before';
    const currentVisual = 'Before changed';
    placeCaret(surface, surface.childNodes.length);

    const selection = visualSelectionSourceRange(
      surface,
      source,
      baselineVisual,
      currentVisual
    );
    expect(selection.direction).toBe('none');
    expect(selection.end).toBeGreaterThan(source.length);
    expect(selection.start).toBe(selection.end);
  });

  it('keeps consecutive paste root-end targets within each canonical source length', () => {
    const firstSource = 'Before\n\n# Heading\n\n**Bold**';
    const firstSurface = editor(
      '<p>Before</p><h1>Heading</h1><p><strong>Bold</strong></p>'
    );
    placeCaret(firstSurface, firstSurface.childNodes.length);
    expect(
      visualSelectionSourceRange(
        firstSurface,
        firstSource,
        firstSource,
        firstSource
      ).end
    ).toBe(firstSource.length);

    const secondSource = `${firstSource}\n\n- One\n- Two\n\n\`inline\``;
    const secondSurface = editor([
      '<p>Before</p>',
      '<h1>Heading</h1>',
      '<p><strong>Bold</strong></p>',
      '<ul><li>One</li><li>Two</li></ul>',
      '<p><code>inline</code></p>'
    ].join(''));
    placeCaret(secondSurface, secondSurface.childNodes.length);
    expect(
      visualSelectionSourceRange(
        secondSurface,
        secondSource,
        secondSource,
        secondSource
      ).end
    ).toBe(secondSource.length);
  });

  it('fails explicitly when a changed visual selection is unavailable', () => {
    const surface = editor('<p>Changed visual text</p>');
    const getSelection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(null);

    try {
      expect(() =>
        visualSelectionSourceRange(
          surface,
          'Original canonical text',
          'Original canonical text'
        )
      ).toThrow('visual-editor-selection-unavailable');
    } finally {
      getSelection.mockRestore();
    }
  });

  it.each([
    {
      html: '',
      target: ''
    },
    {
      html: '<p>Before <strong>new</strong> after</p>',
      target: 'Before **new**'
    },
    {
      html: '<h1>Heading</h1><ul><li>One</li><li>Two</li></ul>',
      target: 'One'
    },
    {
      html: '<pre><code>const x = 1;</code></pre>',
      target: 'const x'
    },
    {
      html: [
        '<table><thead><tr><th>Name</th><th>State</th></tr></thead>',
        '<tbody><tr><td>Editor</td><td>Ready</td></tr></tbody></table>'
      ].join(''),
      target: 'Ready'
    }
  ])(
    'places a visual caret at a canonical source boundary for $target',
    ({ html, target }) => {
      const surface = editor(html);
      const source = serializeVisualMarkdown(surface);
      const sourceOffset = target
        ? source.indexOf(target) + target.length
        : 0;

      placeVisualCaretFromSourceOffset(
        surface,
        source,
        source,
        sourceOffset
      );

      expect(
        visualSelectionSourceRange(surface, source, source)
      ).toEqual({
        direction: 'none',
        end: sourceOffset,
        start: sourceOffset
      });
    }
  );

  it('places an end-of-document caret after completed inline formatting', () => {
    const surface = editor('<p><strong>Bold</strong></p>');
    const source = '**Bold**';

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      source.length
    );
    const selection = window.getSelection();
    const caret = selection?.anchorNode;
    if (!(caret instanceof Text)) {
      throw new Error('missing neutral visual caret');
    }
    expect(caret.parentElement?.tagName).toBe('P');
    expect(caret.previousSibling).toBe(surface.querySelector('strong'));
    expect(caret.data).toBe('\u200b');
    expect(selection?.anchorOffset).toBe(1);
    caret.insertData(1, '!');

    expect(serializeVisualMarkdown(surface)).toBe('**Bold**!');
  });

  it('restores the exact source-end caret across a multi-block pasted Markdown Preview', () => {
    const surface = editor([
      '<p>Typed three</p>',
      '<h1>Pasted heading</h1>',
      '<p><strong>Pasted bold</strong></p>',
      '<ul><li>First item</li><li>Second item</li></ul>',
      '<p><code>inline</code></p>'
    ].join(''));
    const source = serializeVisualMarkdown(surface);

    expect(source).toBe([
      'Typed three',
      '',
      '# Pasted heading',
      '',
      '**Pasted bold**',
      '',
      '- First item',
      '- Second item',
      '',
      '`inline`'
    ].join('\n'));

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      source.length
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it.each([
    '\n',
    '\r\n',
    '\n\n',
    '\r\n\n\r\n'
  ])(
    'maps a canonical document-end caret across trailing line endings (%j)',
    (trailingLineEndings) => {
      const surface = editor('<p>Markdown content</p><div class="footnotes">Generated</div>');
      const acceptedVisualMarkdown = 'Markdown content';
      const source = `${acceptedVisualMarkdown}${trailingLineEndings}`;
      protectVisualMarkdownReadOnlyRegions(surface);

      placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');

      expect(
        visualSelectionSourceRange(
          surface,
          source,
          acceptedVisualMarkdown,
          acceptedVisualMarkdown,
          { acceptedPasteDocumentBoundary: 'end' }
        )
      ).toEqual({
        direction: 'none',
        end: source.length,
        start: source.length
      });
      expect(window.getSelection()?.anchorNode?.parentElement?.tagName).toBe(
        'P'
      );
    }
  );

  it('maps an accepted paste transaction at canonical offset zero to the first editable boundary', () => {
    const surface = editor(
      '<div class="easymde-toc">Generated outline</div><p>Markdown content</p>'
    );
    protectVisualMarkdownReadOnlyRegions(surface);
    placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'start');

    expect(
      visualSelectionSourceRange(
        surface,
        'Markdown content',
        'Markdown content',
        'Markdown content',
        { acceptedPasteDocumentBoundary: 'start' }
      )
    ).toEqual({ direction: 'none', end: 0, start: 0 });
    expect(window.getSelection()?.anchorNode?.textContent).toBe(
      'Markdown content'
    );
  });

  it.each([
    { fence: '```', source: '```\nAlpha\n```' },
    { fence: '~~~~~', source: '~~~~~\nAlpha\n~~~~~' },
    { fence: '~~~', source: '~~~\rAlpha\r~~~' }
  ])(
    'places an accepted document-end caret after a closed $fence fence without changing serialization',
    ({ fence, source }) => {
      const surface = editor(
        `<pre data-easymde-visual-fence="${fence}"><code>Alpha</code></pre>`
      );
      placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');

      expect(
        placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
          surface,
          source,
          'end'
        )
      ).toBe(true);

      const paragraph = surface.querySelector('pre + p');
      const caret = paragraph?.firstChild;
      expect(caret).toBeInstanceOf(Text);
      expect(caret?.textContent).toBe('\u200b');
      expect(serializeVisualMarkdown(surface)).toBe(
        source.replace(/\r\n|\r/g, '\n')
      );
      expect(window.getSelection()?.anchorNode).toBe(caret);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(window.getSelection()?.isCollapsed).toBe(true);
    }
  );

  it('keeps an accepted end caret inside an unclosed final fence', () => {
    const source = '~~~\nAlpha';
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code>Alpha</code></pre>'
    );
    placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');

    expect(
      placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
        surface,
        source,
        'end'
      )
    ).toBe(false);
    expect(surface.querySelector('pre + p')).toBeNull();
    expect(window.getSelection()?.anchorNode).toBe(
      surface.querySelector('pre > code')?.firstChild
    );
  });

  it.each([
    [' ', false],
    ['\u00a0', true]
  ])(
    'applies the terminal whitespace contract to source-end mapping (%j)',
    (suffix, rejects) => {
      const surface = editor('<p>Markdown content</p>');
      const source = `Markdown content${suffix}\n`;

      const place = () =>
        placeVisualCaretFromSourceOffset(
          surface,
          source,
          'Markdown content',
          source.length
        );
      if (rejects) {
        expect(place).toThrow('visual-editor-selection-map-failed');
      } else {
        expect(place).not.toThrow();
      }
    }
  );

  it('restores source-end carets after consecutive paste Preview replacements', () => {
    const generatedTail = Array.from(
      { length: 40 },
      (_, index) =>
        `<section class="footnotes-sep">References ${index}</section><section class="footnotes"><p>Generated note ${index}</p></section>`
    ).join('');
    const firstVisual = [
      'Before',
      '',
      '# Pasted heading',
      '',
      '**Pasted bold**'
    ].join('\n');
    const firstSource = firstVisual;
    const firstSurface = editor(`${[
      '<p>Before</p>',
      '<h1>Pasted heading</h1>',
      '<p><strong>Pasted bold</strong></p>',
      '<section class="footnotes-sep">References</section>',
      '<section class="footnotes"><p>Generated note</p></section>',
      generatedTail
    ].join('')}\n`);
    protectVisualMarkdownReadOnlyRegions(firstSurface);

    expect(serializeVisualMarkdown(firstSurface)).toBe(firstVisual);
    placeVisualCaretFromSourceOffset(
      firstSurface,
      firstSource,
      firstVisual,
      firstSource.length
    );
    expect(
      visualSelectionSourceRange(firstSurface, firstSource, firstVisual)
    ).toEqual({
      direction: 'none',
      end: firstSource.length,
      start: firstSource.length
    });
    const firstCaret = window.getSelection()?.anchorNode;
    expect(firstCaret).toBeInstanceOf(Text);
    expect(firstCaret?.parentElement?.tagName).toBe('P');
    expect(firstCaret?.previousSibling).toBe(
      firstSurface.querySelector('strong')
    );
    expect(firstCaret?.textContent).toBe('\u200b');

    const secondVisual = [
      firstVisual,
      '',
      '- First item',
      '- Second item',
      '',
      '`inline`'
    ].join('\n');
    const secondSource = secondVisual;
    const secondSurface = editor(`${[
      '<p>Before</p>',
      '<h1>Pasted heading</h1>',
      '<p><strong>Pasted bold</strong></p>',
      '<ul><li>First item</li><li>Second item</li></ul>',
      '<p><code>inline</code></p>',
      '<section class="footnotes-sep">References</section>',
      '<section class="footnotes"><p>Generated note</p></section>',
      generatedTail
    ].join('')}\n`);
    protectVisualMarkdownReadOnlyRegions(secondSurface);
    expect(serializeVisualMarkdown(secondSurface)).toBe(secondVisual);
    placeVisualCaretFromSourceOffset(
      secondSurface,
      secondSource,
      secondVisual,
      secondSource.length
    );
    expect(
      visualSelectionSourceRange(secondSurface, secondSource, secondVisual)
    ).toEqual({
      direction: 'none',
      end: secondSource.length,
      start: secondSource.length
    });
    const secondCaret = window.getSelection()?.anchorNode;
    expect(secondCaret).toBeInstanceOf(Text);
    expect(secondCaret?.parentElement?.tagName).toBe('P');
    expect(secondCaret?.previousSibling).toBe(
      secondSurface.querySelector('code')
    );
    expect(secondCaret?.textContent).toBe('\u200b');
  });

  it('restores a block-boundary caret without entering themed or read-only descendants', () => {
    const svgLabels = Array.from(
      { length: 40 },
      (_, index) => `<text>Generated ${index}</text>`
    ).join('');
    const voidNodes = Array.from(
      { length: 40 },
      (_, index) =>
        '<img src="https://example.test/'
        + index
        + '.png" alt="Generated image">'
    ).join('');
    const tableRows = Array.from(
      { length: 40 },
      (_, index) => `<tr><td>Row ${index}</td><td>Value ${index}</td></tr>`
    ).join('');
    const surface = editor([
      '<h1><span class="prefix"></span><span class="content">Pasted heading</span><span class="suffix"></span></h1>',
      '<p>Existing body</p>',
      `<table><tbody>${tableRows}</tbody></table>`,
      voidNodes,
      `<div class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD&#10;A--&gt;B"><svg>${svgLabels}</svg></div>`
    ].join(''));
    protectVisualMarkdownReadOnlyRegions(surface);
    const source = serializeVisualMarkdown(surface);
    const sourceOffset = '# Pasted heading\n\n'.length;

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      sourceOffset
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'none',
      end: sourceOffset,
      start: sourceOffset
    });
  });

  it('continues past an unmappable generated candidate to the exact canonical boundary', () => {
    const generated = Array.from(
      { length: 40 },
      (_, index) =>
        `<div class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD&#10;A${index}--&gt;B${index}"><svg><text>Generated ${index}</text></svg></div>`
    ).join('');
    const surface = editor(
      `<h1>Pasted heading</h1><p>Existing body</p>${generated}`
    );
    const source = serializeVisualMarkdown(surface);
    const sourceOffset = '# Pasted heading\n\n'.length;

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      sourceOffset
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({ direction: 'none', end: sourceOffset, start: sourceOffset });
  });

  it('skips a removed serialization candidate while locating an exact caret boundary', () => {
    const surface = editor(
      '<p>A</p><div class="footnotes">Generated note</div><p>B</p>'
    );
    const source = serializeVisualMarkdown(surface);

    expect(source).toBe('A\n\nB');
    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      source.length
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('skips a visual-only candidate whose synthetic marker cannot merge to source', () => {
    const surface = editor(
      '<p>A</p><p>Theme decoration</p><p>B</p>'
    );
    const source = 'A\n\nB';
    const baseline = serializeVisualMarkdown(surface);

    expect(baseline).toBe('A\n\nTheme decoration\n\nB');
    placeVisualCaretFromSourceOffset(
      surface,
      source,
      baseline,
      source.length
    );

    expect(
      visualSelectionSourceRange(surface, source, baseline)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('bounds caret mapping work across a large visual-only text segment', () => {
    const decoration = 'Visual only '.repeat(5_000);
    const surface = editor(
      `<p>A</p><p>${decoration}</p><p>B</p>`
    );
    const source = 'A\n\nB';
    const baseline = serializeVisualMarkdown(surface);
    const cloneSpy = vi.spyOn(surface, 'cloneNode');

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      baseline,
      source.length
    );

    expect(cloneSpy.mock.calls.length).toBeLessThanOrEqual(32);
    expect(
      visualSelectionSourceRange(surface, source, baseline)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('projects only proved whole-block removal carets to surviving editable boundaries', () => {
    const source = 'One\n\nTwo\n\nThree\n';
    const sourceRanges = [
      { editable: true, end: 4, start: 0 },
      { editable: true, end: 9, start: 5 },
      { editable: true, end: source.length, start: 10 }
    ];
    const caret = (offset: number): Readonly<{
      direction: 'none';
      end: number;
      start: number;
    }> => ({ direction: 'none', end: offset, start: offset });
    // A removal in the middle commits the following editable owner's start.
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 5, insert: '', to: 9 },
        caret(5),
        'One\n\n\nThree\n'
      )
    ).toEqual(caret(6));
    // At the end only the preceding editable owner is left, and its trailing
    // blank separator is not part of the caret's text.
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 10, insert: '', to: source.length },
        caret(10),
        'One\n\nTwo\n\n'
      )
    ).toEqual(caret(8));
    // At the start the following editable owner wins.
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 0, insert: '', to: 4 },
        caret(0),
        '\nTwo\n\nThree\n'
      )
    ).toEqual(caret(1));
    // Every other change keeps the requested selection exactly.
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 5, insert: '', to: 9 },
        { direction: 'forward', end: 8, start: 6 },
        'One\n\n\nThree\n'
      )
    ).toEqual({ direction: 'forward', end: 8, start: 6 });
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 5, insert: 'x', to: 9 },
        caret(5),
        'One\n\nxThree\n'
      )
    ).toEqual(caret(5));
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 5, insert: '', to: 9 },
        caret(99),
        'One\n\n\nThree\n'
      )
    ).toEqual(caret(99));
    // A caret the removal left inside a surviving range is committed as is.
    expect(
      projectVisualMarkdownRemovalSelection(
        sourceRanges,
        source,
        { from: 5, insert: '', to: 9 },
        caret(7),
        'One\n\n\nThree\n'
      )
    ).toEqual(caret(7));
    // A generated range that is not editable owns no projected boundary.
    expect(
      projectVisualMarkdownRemovalSelection(
        [{ editable: false, end: 9, start: 5 }],
        source,
        { from: 5, insert: '', to: 9 },
        caret(5),
        'One\n\n\nThree\n'
      )
    ).toEqual(caret(5));
  });

  it('maps a fence block endpoint in the root space that omits its opening delimiter', () => {
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre data-easymde-visual-fence="~~~" ',
      'data-easymde-visual-fence-info="js"><code>alpha\n</code></pre>'
    ].join('');
    const pre = surface.firstElementChild;
    const paragraph = document.createElement('p');
    if (!(pre instanceof HTMLElement)) {
      throw new Error('fence-root-offset-fixture-missing');
    }
    const slice = '~~~js\nalpha\n~~~';
    // The code body starts after the opening delimiter line, so the body's own
    // first offset is the root offset 0 and body offset 5 is the root offset 5.
    // The opening delimiter line and the closing one clamp to the body's edges.
    expect(visualCodeFenceRootSourceOffset(pre, slice, 6)).toBe(0);
    expect(visualCodeFenceRootSourceOffset(pre, slice, 11)).toBe(5);
    expect(visualCodeFenceRootSourceOffset(pre, slice, 2)).toBe(0);
    expect(visualCodeFenceRootSourceOffset(pre, slice, 12)).toBe(6);
    expect(visualCodeFenceRootSourceOffset(pre, slice, 15)).toBe(6);
    expect(visualCodeFenceRootSourceOffset(paragraph, 'text', 3)).toBe(3);
  });

  it('maps an open fence endpoint through its body to EOF', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<pre data-easymde-visual-fence="~~~"><code></code></pre>';
    const pre = surface.firstElementChild;
    if (!(pre instanceof HTMLElement)) {
      throw new Error('open-fence-root-offset-fixture-missing');
    }
    // A legal unclosed fence has no closing delimiter: its body runs to EOF,
    // so every in-body offset keeps its own distance from the body start and
    // nothing clamps to a phantom last line.
    expect(visualCodeFenceRootSourceOffset(pre, '~~~\n', 4)).toBe(0);
    const withBody = '```js\nAlpha\nBeta';
    const bodyStart = 6;
    expect(visualCodeFenceRootSourceOffset(pre, withBody, bodyStart)).toBe(0);
    expect(
      visualCodeFenceRootSourceOffset(pre, withBody, bodyStart + 1)
    ).toBe(1);
    // The caret on the internal final line is inside the body, not clamped.
    const betaStart = withBody.indexOf('Beta');
    expect(
      visualCodeFenceRootSourceOffset(pre, withBody, betaStart + 2)
    ).toBe(betaStart + 2 - bodyStart);
    // Past EOF clamps to the body's end.
    expect(
      visualCodeFenceRootSourceOffset(pre, withBody, withBody.length)
    ).toBe(withBody.length - bodyStart);
  });

  it('resolves a post-fence paragraph caret without exhausting the candidate budget', () => {
    const surface = document.createElement('article');
    // The accepted placement maps one block: this paragraph holds inline
    // Markdown, so its rendered text is not a prefix of its source, and the
    // pasted fence stays plain paragraph text — the post-paste caret lands on
    // source the paragraph DOM cannot represent.
    surface.innerHTML =
      '<p data-easymde-visual-block-id="b13">普通文本、粗体文本、普通```bash\necho hi</p>';
    const block = surface.firstElementChild;
    if (!(block instanceof HTMLElement)) {
      throw new Error('post-fence-paragraph-missing');
    }
    const source =
      '普通文本、**粗体文本**、普通```bash\necho hi\n```后续文本、粗体文本、普通文本、粗体文本';
    const baseline = serializeVisualMarkdownBlockFragment([block]);
    // Right after the pasted fence's closing delimiter.
    const requestedOffset =
      source.indexOf('echo hi') + 'echo hi'.length + '\n```'.length;
    const boundary = visualCaretBoundaryFromSourceOffset(
      block,
      source,
      baseline,
      requestedOffset
    );
    const text = block.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('post-fence-paragraph-text-missing');
    }
    expect(boundary).toEqual({ node: text, offset: text.data.length });
  });

  it('resolves a post-fence paragraph caret owned by its block when the whole surface is the root', () => {
    const surface = document.createElement('article');
    const before = Array.from(
      { length: 13 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="b${index}">第${index}段<b>加粗</b>正文，普通文本。</p>`
    ).join('');
    const target =
      '<p data-easymde-visual-block-id="b13">普通文本、粗体文本、普通```bash\necho hi</p>';
    const after = Array.from(
      { length: 100 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="a${index}">第${index}段<i>斜体</i>后续正文，普通文本。</p>`
    ).join('');
    surface.innerHTML = `${before}${target}${after}`;
    const paragraph = surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b13"]'
    );
    if (!paragraph) throw new Error('post-fence-paragraph-missing');
    const beforeSource = Array.from(
      { length: 13 },
      (_value, index) => `第${index}段**加粗**正文，普通文本。`
    ).join('\n\n');
    const targetSource =
      '普通文本、**粗体文本**、普通```bash\necho hi\n```后续文本、粗体文本、普通文本、粗体文本';
    const afterSource = Array.from(
      { length: 100 },
      (_value, index) => `第${index}段*斜体*后续正文，普通文本。`
    ).join('\n\n');
    const source = `${beforeSource}\n\n${targetSource}\n\n${afterSource}`;
    // The restored caret sits right after the pasted fence text, inside the
    // source-only run the paragraph DOM cannot represent. The whole-surface
    // root cannot map it, so the owning block has to be proved from source.
    const requestedOffset =
      source.indexOf('echo hi') + 'echo hi'.length + '\n```'.length;
    const boundary = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      serializeVisualMarkdown(surface),
      requestedOffset
    );
    expect(boundary).toEqual({
      node: paragraph.firstChild,
      offset: (paragraph.firstChild as Text).data.length
    });
  });

  it('preserves LF and CRLF parity for an interior source-only caret forcing exhausted-walk recovery after preceding CRLFs', () => {
    const surface = document.createElement('article');
    const before = Array.from(
      { length: 13 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="b${index}">第${index}段<b>加粗</b>正文，普通文本。</p>`
    ).join('');
    const target =
      '<p data-easymde-visual-block-id="b13">普通文本、粗体文本、普通```bash\necho hi</p>';
    const after = Array.from(
      { length: 100 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="a${index}">第${index}段<i>斜体</i>后续正文，普通文本。</p>`
    ).join('');
    surface.innerHTML = `${before}${target}${after}`;
    const paragraph = surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b13"]'
    );
    if (!paragraph) throw new Error('post-fence-paragraph-missing');
    const beforeSource = Array.from(
      { length: 13 },
      (_value, index) => `第${index}段**加粗**正文，普通文本。`
    ).join('\n\n');
    const targetSource =
      '普通文本、**粗体文本**、普通```bash\necho hi\n```后续文本、粗体文本、普通文本、粗体文本';
    const afterSource = Array.from(
      { length: 100 },
      (_value, index) => `第${index}段*斜体*后续正文，普通文本。`
    ).join('\n\n');
    const source = `${beforeSource}\n\n${targetSource}\n\n${afterSource}`;
    const baseline = serializeVisualMarkdown(surface);
    const textNode = paragraph.firstChild as Text;
    const expected = { node: textNode, offset: textNode.data.length };

    // Interior source-only caret inside the unrepresented hidden run
    const lfOffset = source.indexOf('echo hi') + 'echo hi'.length + '\n```后续'.length;
    const lfBoundary = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      baseline,
      lfOffset
    );
    expect(lfBoundary).toEqual(expected);

    const crlfSource = source.replace(/\n/gu, '\r\n');
    const crlfOffset = crlfSource.indexOf('echo hi') + 'echo hi'.length + '\r\n```后续'.length;
    const crlfBoundary = visualCaretBoundaryFromSourceOffset(
      surface,
      crlfSource,
      baseline,
      crlfOffset
    );
    expect(crlfBoundary).toEqual(expected);
  });

  it('resolves a wide nested list caret past the attempt constant', () => {
    // The real full-capability fixture renders this list as one 87-segment
    // block. The attempt constant is 32, so a Cut inside it used to exhaust the
    // walk before the row was covered and the whole visual surface was torn
    // down. The walk's second pass uses the row's own segment count.
    const surface = document.createElement('article');
    surface.innerHTML =
      '<ul data-easymde-visual-block-id="b36">'
      + '<li>前端开发</li>'
      + '<li>后端开发<ul><li>Python</li><li>Node.js</li><li>Go</li></ul></li>'
      + '<li>运维部署<ul><li>Docker</li><li>Nginx</li><li>Kubernetes</li></ul></li>'
      + '</ul>';
    const source = '* 前端开发\n* 后端开发\n\n  * Python\n  * Node.js\n  * Go'
      + '\n* 运维部署\n\n  * Docker\n  * Nginx\n  * Kubernetes';
    const list = surface.querySelector('ul');
    if (!(list instanceof HTMLElement)) {
      throw new Error('wide-list-fixture-missing');
    }
    const visual = serializeVisualMarkdownBlockFragment([list]);
    // Offsets 12, 79, 80 and 87 sit at the boundaries this row could not reach
    // within the constant; each one now resolves to the list item it belongs
    // to instead of tearing the surface down.
    expect(visualCaretBoundaryFromSourceOffset(list, source, visual, 12))
      .toEqual({ node: expect.any(Text), offset: 3 });
    expect(visualCaretBoundaryFromSourceOffset(list, source, visual, 87))
      .toEqual({ node: expect.any(Text), offset: 9 });
    // An offset with no representable caret still keeps the budget failure: the
    // second pass is a larger budget, never a weakened proof.
    expect(() =>
      visualCaretBoundaryFromSourceOffset(list, source, visual, 55)
    ).toThrowError('visual-editor-selection-map-budget-exceeded');
  });

  it('keeps the budget failure for an offset no source proof owns', () => {
    const surface = document.createElement('article');
    const before = Array.from(
      { length: 40 },
      (_value, index) => `<p data-easymde-visual-block-id="b${index}">第${index}段正文。</p>`
    ).join('');
    const paragraphText = `${'普通文本、粗体文本、'.repeat(6)}普通\`\`\`bash\necho hi`;
    surface.innerHTML =
      `${before}<p data-easymde-visual-block-id="b13">${paragraphText}</p>`;
    // The hidden region sits before the root's visible text instead of after it,
    // so no proved boundary owns it and the walk's own failure must survive.
    const source = `\`\`\`中间文本\n${surface.textContent}`;
    const baseline = serializeVisualMarkdownBlockFragment(
      Array.from(surface.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      )
    );
    const requestedOffset = source.indexOf('中间文本') + 2;
    expect(() =>
      visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        requestedOffset
      )
    ).toThrowError('visual-editor-selection-map-budget-exceeded');
  });
  it('resolves a mid-paragraph pasted fence caret with rich trailing content', () => {
    const surface = document.createElement('article');
    const before = Array.from(
      { length: 13 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="b${index}">第${index}段<b>加粗</b>正文，普通文本。</p>`
    ).join('');
    const target = [
      '<p data-easymde-visual-block-id="b13">',
      '普通文本、<strong>粗体文本</strong>、普通```bash\necho hi\n```后续文本、',
      '<em>斜体文本</em>、<strong><em>粗斜体文本</em></strong>。</p>'
    ].join('');
    const after = Array.from(
      { length: 100 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="a${index}">第${index}段<i>斜体</i>后续正文，普通文本。</p>`
    ).join('');
    surface.innerHTML = `${before}${target}${after}`;
    const paragraph = surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b13"]'
    );
    if (!paragraph) throw new Error('mid-fence-paragraph-missing');
    const beforeSource = Array.from(
      { length: 13 },
      (_value, index) => `第${index}段**加粗**正文，普通文本。`
    ).join('\n\n');
    const targetSource =
      '普通文本、**粗体文本**、普通```bash\necho hi\n```后续文本、*斜体文本*、***粗斜体文本***。';
    const afterSource = Array.from(
      { length: 100 },
      (_value, index) => `第${index}段*斜体*后续正文，普通文本。`
    ).join('\n\n');
    const source = `${beforeSource}\n\n${targetSource}\n\n${afterSource}`;
    const requestedOffset =
      source.indexOf('echo hi') + 'echo hi'.length + '\n```'.length;
    const boundary = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      serializeVisualMarkdown(surface),
      requestedOffset
    );
    expect(paragraph.contains(boundary.node)).toBe(true);
  });

  it('keeps a post-paste caret in its paragraph when the surface carries fence metadata', () => {
    const surface = document.createElement('article');
    const before = Array.from(
      { length: 13 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="b${index}">第${index}段<b>加粗</b>正文，普通文本。</p>`
    ).join('');
    const target = [
      '<p data-easymde-visual-block-id="b13">',
      '普通文本、<strong>粗体文本</strong>、普通```bash\necho hi\n```后续文本、',
      '<em>斜体文本</em>、<strong><em>粗斜体文本</em></strong>。</p>'
    ].join('');
    const fence =
      '<pre data-easymde-visual-block-id="f0" data-easymde-visual-fence="~~~" '
      + 'data-easymde-visual-fence-info="js"><code>alpha\n</code></pre>';
    const after = Array.from(
      { length: 100 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="a${index}">第${index}段<i>斜体</i>后续正文，普通文本。</p>`
    ).join('');
    surface.innerHTML = `${before}${target}${fence}${after}`;
    const paragraph = surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b13"]'
    );
    if (!paragraph) throw new Error('fence-metadata-paragraph-missing');
    const beforeSource = Array.from(
      { length: 13 },
      (_value, index) => `第${index}段**加粗**正文，普通文本。`
    ).join('\n\n');
    const targetSource =
      '普通文本、**粗体文本**、普通```bash\necho hi\n```后续文本、*斜体文本*、***粗斜体文本***。';
    const fenceSource = '~~~js\nalpha\n~~~';
    const afterSource = Array.from(
      { length: 100 },
      (_value, index) => `第${index}段*斜体*后续正文，普通文本。`
    ).join('\n\n');
    const source = `${beforeSource}\n\n${targetSource}\n\n${fenceSource}\n\n${afterSource}`;
    const requestedOffset =
      source.indexOf('echo hi') + 'echo hi'.length + '\n```'.length;
    const boundary = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      serializeVisualMarkdown(surface),
      requestedOffset
    );
    expect(paragraph.contains(boundary.node)).toBe(true);
  });
  it.each([1, 2])('maps the full-capability browser paste at local caret %i', (localCaret) => {
    const surface = document.createElement('article');
    const before = [
      '<h1 data-easymde-visual-block-id="b0">Markdown 全量能力测试文档</h1>',
      '<blockquote data-easymde-visual-block-id="b1"><p>用于测试标题、排版、表格、代码、数学公式、Mermaid 图表、HTML、脚注、任务列表等 Markdown 渲染能力。</p></blockquote>',
      '<hr data-easymde-visual-block-id="b2">',
      '<h2 data-easymde-visual-block-id="b3">1. 标题层级</h2>',
      '<h1 data-easymde-visual-block-id="b4">一级标题 Heading 1</h1>',
      '<h2 data-easymde-visual-block-id="b5">二级标题 Heading 2</h2>',
      '<h3 data-easymde-visual-block-id="b6">三级标题 Heading 3</h3>',
      '<h4 data-easymde-visual-block-id="b7">四级标题 Heading 4</h4>',
      '<h5 data-easymde-visual-block-id="b8">五级标题 Heading 5</h5>',
      '<h6 data-easymde-visual-block-id="b9">六级标题 Heading 6</h6>',
      '<h2 data-easymde-visual-block-id="b10">超长中英文标题用于验证狭窄预览容器中的正常换行、完整可读性以及主题前后缀装饰仍然保持可见 This intentionally long bilingual heading verifies wrapping and complete readability without clipping in narrow preview panes</h2>',
      '<hr data-easymde-visual-block-id="b11">',
      '<h2 data-easymde-visual-block-id="b12">2. 文本样式</h2>'
    ].join('');
    const visiblePrefix = '普通文本、';
    const pasted = '```bash\necho hi\n```';
    const targetSource =
      `${visiblePrefix.slice(0, localCaret)}${pasted}`
      + `${visiblePrefix.slice(localCaret)}**粗体文本**、*斜体文本*、***粗斜体文本***。`;
    const target = [
      '<p data-easymde-visual-block-id="b13">',
      `${visiblePrefix.slice(0, localCaret)}${pasted}${visiblePrefix.slice(localCaret)}<strong>粗体文本</strong>、`,
      '<em>斜体文本</em>、<strong><em>粗斜体文本</em></strong>。</p>'
    ].join('');
    const after = Array.from(
      { length: 100 },
      (_value, index) =>
        `<p data-easymde-visual-block-id="a${index}">第${index}段<i>斜体</i>后续正文，普通文本。</p>`
    ).join('');
    surface.innerHTML = `${before}${target}${after}`;
    const paragraph = surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b13"]'
    );
    if (!paragraph) throw new Error('browser-shaped-paragraph-missing');
    const beforeSource = [
      '# Markdown 全量能力测试文档',
      '> 用于测试标题、排版、表格、代码、数学公式、Mermaid 图表、HTML、脚注、任务列表等 Markdown 渲染能力。',
      '---',
      '## 1. 标题层级',
      '# 一级标题 Heading 1',
      '## 二级标题 Heading 2',
      '### 三级标题 Heading 3',
      '#### 四级标题 Heading 4',
      '##### 五级标题 Heading 5',
      '###### 六级标题 Heading 6',
      '## 超长中英文标题用于验证狭窄预览容器中的正常换行、完整可读性以及主题前后缀装饰仍然保持可见 This intentionally long bilingual heading verifies wrapping and complete readability without clipping in narrow preview panes',
      '---',
      '## 2. 文本样式'
    ].join('\n\n');
    const afterSource = Array.from(
      { length: 100 },
      (_value, index) => `第${index}段*斜体*后续正文，普通文本。`
    ).join('\n\n');
    const source = `${beforeSource}\n\n${targetSource}\n\n${afterSource}`;
    const requestedOffset =
      source.indexOf('echo hi') + 'echo hi'.length + '\n```'.length;
    const boundary = visualCaretBoundaryFromSourceOffset(
      surface,
      source,
      serializeVisualMarkdown(surface),
      requestedOffset
    );
    const firstText = paragraph.firstChild;
    if (!(firstText instanceof Text)) {
      throw new Error('browser-shaped-first-text-missing');
    }
    const localOffset =
      targetSource.indexOf('echo hi') + 'echo hi'.length + '\n```'.length;
    const localBoundary = visualCaretBoundaryFromSourceOffset(
      paragraph,
      targetSource,
      serializeVisualMarkdownBlockFragment([paragraph]),
      localOffset
    );
    expect(localBoundary).toEqual({
      node: firstText,
      offset: firstText.data.indexOf(visiblePrefix.slice(localCaret))
    });
    expect(boundary).toEqual({
      node: firstText,
      offset: firstText.data.indexOf(visiblePrefix.slice(localCaret))
    });
    const crlfSource = source.replace(/\n/gu, '\r\n');
    const crlfOffset =
      crlfSource.indexOf('echo hi') + 'echo hi'.length + '\r\n```'.length;
    const crlfBoundary = visualCaretBoundaryFromSourceOffset(
      surface,
      crlfSource,
      serializeVisualMarkdown(surface),
      crlfOffset
    );
    expect(crlfBoundary).toEqual({
      node: firstText,
      offset: firstText.data.indexOf(visiblePrefix.slice(localCaret))
    });
  });
  it.each([1, 2])('maps block-local CRLF fence caret at local offset %i', (localCaret) => {
    const surface = document.createElement('article');
    const visiblePrefix = '普通文本、';
    const pasted = '```bash\necho hi\n```';
    const targetSource = `${visiblePrefix.slice(0, localCaret)}${pasted}`
      + `${visiblePrefix.slice(localCaret)}**粗体文本**、*斜体文本*、***粗斜体文本***。`;
    const target = [
      '<p data-easymde-visual-block-id="b13">',
      `${visiblePrefix.slice(0, localCaret)}${pasted}${visiblePrefix.slice(localCaret)}<strong>粗体文本</strong>、`,
      '<em>斜体文本</em>、<strong><em>粗斜体文本</em></strong>。</p>'
    ].join('');
    const before = Array.from(
      { length: 13 },
      (_value, index) => `<p data-easymde-visual-block-id="b${index}">前${index}段<b>加粗</b>正文。</p>`
    ).join('');
    const after = Array.from(
      { length: 100 },
      (_value, index) => `<p data-easymde-visual-block-id="a${index}">后${index}段<i>斜体</i>正文。</p>`
    ).join('');
    surface.innerHTML = `${before}${target}${after}`;
    const paragraph = surface.querySelector<HTMLElement>('[data-easymde-visual-block-id="b13"]');
    const firstText = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLElement) || !(firstText instanceof Text)) {
      throw new Error('block-local-crlf-fence-fixture-missing');
    }
    const beforeSource = Array.from(
      { length: 13 },
      (_value, index) => `前${index}段**加粗**正文。`
    ).join('\n\n');
    const afterSource = Array.from(
      { length: 100 },
      (_value, index) => `后${index}段*斜体*正文。`
    ).join('\n\n');
    const source = `${beforeSource}\n\n${targetSource}\n\n${afterSource}`;
    const crlfSource = source.replace(/\n/gu, '\r\n');
    const crlfTarget = targetSource.replace(/\n/gu, '\r\n');
    const crlfOffset = crlfSource.indexOf('echo hi')
      + 'echo hi'.length + '\r\n```'.length;
    const localOffset = crlfTarget.indexOf('echo hi')
      + 'echo hi'.length + '\r\n```'.length;
    const baseline = serializeVisualMarkdownBlockFragment([paragraph]);
    const localBoundary = visualCaretBoundaryFromSourceOffset(
      paragraph,
      crlfTarget,
      baseline,
      localOffset
    );
    const rootBoundary = visualCaretBoundaryFromSourceOffset(
      surface,
      crlfSource,
      serializeVisualMarkdown(surface),
      crlfOffset
    );
    const expectedOffset = firstText.data.indexOf(visiblePrefix.slice(localCaret));
    expect(localBoundary).toEqual({ node: firstText, offset: expectedOffset });
    expect(rootBoundary).toEqual({ node: firstText, offset: expectedOffset });
  });
});
