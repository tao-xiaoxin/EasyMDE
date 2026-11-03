import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '@codemirror/lang-markdown';
import TurndownService from 'turndown';
import { markdownReferenceDefinitionQuery, type MarkdownSyntaxNode } from '../editor-context-menu/editor-markdown-link-preparation';

import type {
  PreviewEditMap,
  PreviewEditMapBlock
} from '../../contracts/ports/preview-request';
import type { VisualEmptyStructuralBodySelectionResult } from './visual-markdown';
import * as markdownLineModel from '../../shared/markdown/markdown-line-model';
import {
  isMarkdownTerminalWhitespaceSuffix,
  markdownLineStarts
} from '../../shared/markdown/markdown-line-model';

import {
  prepareVisualEmptyStructuralBodies,
  applyVisualBlockShortcut,
  visualBlockShortcutRewriteTarget,
  visualBlockShortcutRewritesEmptyBlock,
  visualEmptiedTerminalRow,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  applyVisualMarkdownEditIntent,
  captureVisualThematicBreakSelection,
  prepareVisualThematicBreakPointerSelection,
  captureVisualCodeInputSnapshot,
  classifyVisualSelectionProvenance,
  createVisualImageInteraction,
  createVisualMarkdownSourceIntervalMap,
  declaredBlockLeadingRuns,
  isDeclaredBlockLeadingRun,
  createVisualMarkdownImageSourceIntervalMap,
  mapTextBoundaryFromInterval,
  expandVisualCodeFenceForBody,
  foldVisualMarkdownSoftBreaks,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualMarkdownSourceRangeFromPreviewEditMap,
  createVisualCodeBodyIntervalForPreviewBlock,
  createVisualCodeBodyIntervalsForPreviewBlocks,
  visualCodeBodyIntervalMap,
  createVisualMarkdownWindowChange,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
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
  visualSourceRangeForRenderedImage,
  visualRetiredInlineSourceRange,
  visualBoundaryForImageSourceEdge,
  prepareVisualTaskListMarkers,
  protectVisualMarkdownReadOnlyRegions,
  projectVisualCodeBodySelection,
  projectVisualMarkdownRemovalSelection,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  shouldNormalizeVisualImageContextMenuSelection,
  serializeVisualMarkdown,
  serializeVisualMarkdownBlockFragment,
  structuralEmptyLineRemoval,
  visualSelectionSourceRangeForBlocks,
  visualSelectionSourceRange,
  visualEmptyStructuralBodySelection,
  visualThematicBreakSourceSelection,
  visualCodeBodyOrdinalForSourceRange,
  createVisualCodeBodyOrdinalsForPreviewBlocks,
  visualCodeBlockStructureSignature,
  visualStructuralBoundaryRows
} from './visual-markdown';

describe('canonical escape-unit deletion', () => {
  it.each([
    ['single delimiter', 'A `\\*` Z', 'A <code>\\*</code> Z', 1],
    ['consecutive slashes', 'A `\\\\*` Z', 'A <code>\\\\*</code> Z', 1],
    ['multiple delimiters', 'A ``\\*`` Z', 'A <code>\\*</code> Z', 1],
    ['CRLF', 'L\r\n\r\nA `\\*` Z', 'L</p><p>A <code>\\*</code> Z', 1]
  ])('maps an inline code literal boundary for %s', (_label, source, html, textOffset) => {
    const surface = editor(`<p>${html}</p>`);
    const code = surface.querySelector('code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-inline-code-body-missing');
    }
    const baseline = serializeVisualMarkdown(surface);
    const expected = source.indexOf('\\') + textOffset;
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    expect(visualBoundarySourceOffset(surface, source, baseline, text, textOffset, interval))
      .toBe(expected);
    expect(mapTextBoundaryFromInterval(surface, text, textOffset, baseline, interval))
      .toMatchObject({ sourceOffset: expected });
    const boundary = visualCaretBoundaryFromSourceOffset(surface, source, baseline, expected);
    expect(code.contains(boundary.node)).toBe(true);
    const prefix = document.createRange();
    prefix.selectNodeContents(code);
    prefix.setEnd(boundary.node, boundary.offset);
    expect(prefix.toString()).toBe(text.data.slice(0, textOffset));
    expect(visualBoundarySourceOffset(surface, source, baseline, text, 0, interval))
      .toBe(source.indexOf('\\'));
    expect(visualBoundarySourceOffset(surface, source, baseline, text, text.length, interval))
      .toBe(source.indexOf('\\') + text.length);
    expect(visualBoundarySourceOffset(surface, source, baseline, code, 0, interval))
      .toBe(source.indexOf('\\'));
    expect(visualBoundarySourceOffset(surface, source, baseline, code, code.childNodes.length, interval))
      .toBe(source.indexOf('\\') + text.length);
    const start = visualCaretBoundaryFromSourceOffset(surface, source, baseline, source.indexOf('\\'));
    expect(code.contains(start.node)).toBe(true);
    const startPrefix = document.createRange();
    startPrefix.selectNodeContents(code);
    startPrefix.setEnd(start.node, start.offset);
    expect(startPrefix.toString()).toBe('');
    if (surface.children.length === 1 && surface.firstElementChild instanceof HTMLElement) {
      const paragraph = surface.firstElementChild;
      const localBaseline = serializeVisualMarkdownBlockFragment([paragraph]);
      const localMap = createVisualMarkdownSourceIntervalMap(source, localBaseline);
      expect(visualBoundarySourceOffset(paragraph, source, localBaseline, text, textOffset, localMap))
        .toBe(expected);
      const localBoundary = visualCaretBoundaryFromSourceOffset(paragraph, source, localBaseline, expected);
      expect(code.contains(localBoundary.node)).toBe(true);
    }
  });

  it('keeps ordinary escape units and source snapshot mismatches explicit', () => {
    const source = 'A \\* Z';
    const map = createVisualMarkdownSourceIntervalMap(source, source);
    expect(map.coversSourceUnits(3, 3)).toBe(false);
    expect(map.coversSourceUnits(-1, 0)).toBe(false);
    const foreign = { ...map, source: 'A `\\*` Z' };
    expect(() => foreign.coversSourceUnits(4, 4))
      .toThrow('visual-editor-markdown-merge-failed');
  });

  it('keeps hidden delimiter insertions guarded without a code body read proof', () => {
    const surface = editor('<p>A <code>\\*</code> Z</p>');
    const source = 'A ``\\*`` Z';
    const baseline = serializeVisualMarkdown(surface);
    const marker = '\uE000\uE001\uE002\uE003';
    const position = baseline.indexOf('\\');
    expect(() => mergeVisualMarkdownChange(source, baseline,
      baseline.slice(0, position) + marker + baseline.slice(position)))
      .toThrow('visual-editor-markdown-merge-ambiguous');
  });

  it('does not certify an inline code body changed after the mapping snapshot', () => {
    const surface = editor('<p>A <code>\\*</code> Z</p>');
    const code = surface.querySelector('code');
    const text = code?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-inline-code-body-missing');
    const source = 'A ``\\*`` Z';
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownSourceIntervalMap(source, baseline);
    text.data = '\\!';
    expect(() => visualBoundarySourceOffset(surface, source, baseline, text, 0, map))
      .toThrow();
  });

  it('rejects a foreign inline code node and the interior of a multi-character delimiter', () => {
    const surface = editor('<p>A <code>\\*</code> Z</p>');
    const source = 'A ``\\*`` Z';
    const baseline = serializeVisualMarkdown(surface);
    const foreign = document.createTextNode('\\*');
    expect(() => visualBoundarySourceOffset(surface, source, baseline, foreign, 1))
      .toThrow('visual-editor-selection-map-failed');
    expect(() => visualCaretBoundaryFromSourceOffset(surface, source, baseline, 3))
      .toThrow('visual-editor-selection-map-failed');
  });

  it('maps a certified inline code endpoint in a detached accepted fragment', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>A <code>\\*</code> Z</p>';
    const code = surface.querySelector('code');
    if (!(code instanceof HTMLElement)) throw new Error('visual-inline-code-body-missing');
    const source = 'A ``\\*`` Z';
    const baseline = serializeVisualMarkdownBlockFragment([surface]);
    const boundary = visualCaretBoundaryFromSourceOffset(surface, source, baseline, 4, true, {
      acceptedEndpointBlock: true
    });
    expect(code.contains(boundary.node)).toBe(true);
    const prefix = document.createRange();
    prefix.selectNodeContents(code);
    prefix.setEnd(boundary.node, boundary.offset);
    expect(prefix.toString()).toBe('');
  });

  it.each([
    ['noneditable ancestor', '<span contenteditable="false"><code>\\*</code></span>'],
    ['opaque child', '<code>\\*<img alt="" src="x"></code>']
  ])('does not certify an inline code body with %s', (_label, html) => {
    const surface = editor(`<p>A ${html} Z</p>`);
    const text = surface.querySelector('code')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-inline-code-body-missing');
    const source = 'A ``\\*`` Z';
    const baseline = serializeVisualMarkdown(surface);
    expect(() => visualBoundarySourceOffset(surface, source, baseline, text, 0))
      .toThrow();
  });

  it('reports a controlled merge mismatch without exposing source text', () => {
    const source = 'Private source';
    const map = createVisualMarkdownSourceIntervalMap('Other source', 'Other source');
    try {
      mergeVisualMarkdownChangeDetails(source, source, '', map);
      throw new Error('merge unexpectedly succeeded');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'visual-editor-markdown-merge-failed',
        reason: 'map-snapshot-mismatch',
        details: { sourceLength: source.length, baselineLength: source.length, editedLength: 0 }
      });
      expect(JSON.stringify(error)).not.toContain(source);
      expect(JSON.stringify(error)).not.toContain('Other source');
    }
  });

  it.each(['~', '`', '*', '[', '\\'])('removes the whole single escaped %s unit', (marker) => {
    expect(mergeVisualMarkdownChangeDetails(`\\${marker}`, marker, '').value).toBe('');
  });

  it.each(['~', '`', '*', '[', '\\'])('preserves untouched escapes around a %s deletion', (marker) => {
    const source = `A\\${marker}B\\${marker}C\\${marker}D`;
    const baseline = `A${marker}B${marker}C${marker}D`;
    for (const index of [1, 3, 5]) {
      const expected = source.slice(0, index + Math.floor(index / 2))
        + source.slice(index + Math.floor(index / 2) + 2);
      const edited = baseline.slice(0, index) + baseline.slice(index + 1);
      expect(mergeVisualMarkdownChangeDetails(source, baseline, edited).value).toBe(expected);
    }
  });
});

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

/**
 * The text position Chromium resolves a collapsed visual caret to.
 *
 * A caret on an element boundary is ambiguous, and Chromium canonicalizes it to
 * the deepest text position before that boundary. Reproducing that resolution
 * is what makes a caret left "after" a closed inline unit behave like the end
 * of that unit's own text, exactly as it does in the browser; inserting blindly
 * at the raw offset would hide the defect these helpers cover.
 */
function resolvedVisualCaret(): Readonly<{ node: Text; offset: number }> {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) {
    throw new Error('visual-caret-not-collapsed');
  }
  let node: Node = selection.anchorNode;
  let offset = selection.anchorOffset;
  while (!(node instanceof Text)) {
    const child = node.childNodes[offset - 1];
    if (!child) throw new Error('visual-caret-has-no-text-position');
    node = child;
    offset = child instanceof Text ? child.length : child.childNodes.length;
  }
  return { node, offset };
}

/** Type `text` at the caret the way a native `insertText` does. */
function typeAtVisualCaret(text: string): void {
  const caret = resolvedVisualCaret();
  caret.node.insertData(caret.offset, text);
  placeCaret(caret.node, caret.offset + text.length);
}

/**
 * Press Backspace at the caret the way the browser does: the character before
 * the resolved caret position is removed, and a caret at the start of a text
 * node removes the previous text position's last character.
 */
function pressBackspaceAtVisualCaret(): void {
  const caret = resolvedVisualCaret();
  if (caret.offset > 0) {
    caret.node.deleteData(caret.offset - 1, 1);
    placeCaret(caret.node, caret.offset - 1);
    return;
  }
  const block = caret.node.parentElement;
  if (!block) throw new Error('visual-caret-block-missing');
  const texts: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) texts.push(current);
    current = walker.nextNode();
  }
  const previous = texts[texts.indexOf(caret.node) - 1];
  if (!previous || previous.length < 1) {
    throw new Error('visual-caret-previous-text-missing');
  }
  previous.deleteData(previous.length - 1, 1);
  placeCaret(previous, previous.length);
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

  it.each([
    {
      baseline: '## 清单\n\n-',
      edited: '## 清单',
      source: '## 清单\n\n*\n'
    },
    {
      baseline: '## 清单\n\n-',
      edited: '## 清单',
      source: '## 清单\n\n*'
    },
    {
      baseline: '## 清单\n\n- ',
      edited: '## 清单',
      source: '## 清单\n\n* '
    }
  ])(
    'removes a trailing empty structural row spelled differently in source (%#)',
    ({ baseline, edited, source }) => {
      // Replacing an emptied list with a paragraph removes the whole visual
      // line. Its `-` spelling and the serializer's blank separator are not
      // source bytes, so only the structural row proof can name the row.
      expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
        '## 清单\n\n'
      );
    }
  );

  it('removes a trailing empty structural row from CRLF source', () => {
    expect(
      mergeVisualMarkdownChange(
        '## 清单\r\n\r\n+\r\n',
        '## 清单\r\n\r\n-',
        '## 清单'
      )
    ).toBe('## 清单\r\n\r\n');
  });

  it.each([
    { baseline: '-\n\n## B', edited: '## B', source: '*\n\n## B', expected: '\n## B' },
    {
      baseline: '## A\n\n-\n\n## B',
      edited: '## A\n\n## B',
      source: '## A\n\n*\n\n## B',
      expected: '## A\n\n\n## B'
    }
  ])(
    'removes a whole structural row without consuming the blank lines around it (%#)',
    ({ baseline, edited, source, expected }) => {
      expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(expected);
    }
  );

  it.each([
    { baseline: '>', source: '> ' },
    { baseline: '1.', source: '1. ' }
  ])(
    'removes the separator the serializer trims from an emptied structural row ($baseline)',
    ({ baseline, source }) => {
      // The visual spelling of an empty row trims its separator; a literal
      // match would leave that separator behind as a whitespace document.
      expect(mergeVisualMarkdownChange(source, baseline, '')).toBe('');
    }
  );

  it('keeps the structural row while only its body text is deleted', () => {
    expect(mergeVisualMarkdownChange('> a', '> a', '> ')).toBe('> ');
  });

  it('refuses a structural visual removal against a non-structural source row', () => {
    expect(() =>
      mergeVisualMarkdownChange(
        '## A\n\n# heading',
        '## A\n\n-',
        '## A'
      )
    ).toThrow('visual-editor-markdown-merge-failed');
  });

  it.each([
    ['<ul>\n<li><br></li>\n</ul>', 'Backspace', true],
    ['<ul>\n<li>A</li>\n</ul>', 'Backspace', false],
    ['<blockquote>\n<p><br></p>\n</blockquote>', 'Backspace', true],
    ['<h2><br></h2>', 'Backspace', true],
    ['<p>Text</p>', 'Backspace', false]
  ])(
    'states whether a shortcut will rewrite the empty block %s',
    (markup, key, expected) => {
      const surface = editor(markup);
      const block = surface.firstElementChild;
      if (!(block instanceof HTMLElement)) {
        throw new Error('visual-empty-rewrite-block-missing');
      }
      const editable = block.querySelector('li, p') ?? block;
      placeCaret(editable, editable.childNodes.length);
      const shortcut = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
      });
      expect(visualBlockShortcutRewritesEmptyBlock(surface, shortcut)).toBe(
        expected
      );
      // The predicate is read-only: it never consumes the event or mutates DOM.
      expect(shortcut.defaultPrevented).toBe(false);
      expect(surface.firstElementChild).toBe(block);
      surface.remove();
    }
  );

  it('does not request a flush for a marker-forming space shortcut', () => {
    const surface = editor('<p>#</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-heading-marker-text-missing');
    }
    placeCaret(text, text.length);
    expect(
      visualBlockShortcutRewritesEmptyBlock(
        surface,
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' })
      )
    ).toBe(false);
    surface.remove();
  });

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

  it('keeps cached code intervals keyed by sparse Markdown code ordinals', () => {
    const markdown = [
      '    same',
      '',
      '~~~js',
      'same',
      '~~~',
      '',
      '~~~js',
      'same',
      '~~~'
    ].join('\n');
    const editMap = previewEditMap([
      previewBlock('b0', 0, 1, false),
      previewBlock('b1', 2, 5),
      previewBlock('b2', 6, 9)
    ]);
    const intervals = visualCodeBodyIntervalMap(markdown);
    const intervalsByBlock = createVisualCodeBodyIntervalsForPreviewBlocks(
      markdown,
      editMap
    );

    expect(intervals.get(0)).toBeUndefined();
    expect(intervals.get(1)?.codeOrdinal).toBe(1);
    expect(intervals.get(2)?.codeOrdinal).toBe(2);
    expect(intervalsByBlock.get('b1')?.codeOrdinal).toBe(1);
    expect(intervalsByBlock.get('b2')?.codeOrdinal).toBe(2);

    const project = (
      codeOrdinal: number,
      localSelection: Readonly<{ end: number; start: number }>,
      cached: boolean
    ) => {
      const surface = editor('<pre><code>same\n</code></pre>');
      const code = surface.querySelector('code');
      const text = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
        throw new Error('sparse-code-ordinal-fixture-missing');
      }
      const projection = projectVisualCodeBodySelection(
        code,
        markdown,
        markdown,
        codeOrdinal,
        {
          end: { node: text, offset: localSelection.end },
          start: { node: text, offset: localSelection.start }
        },
        cached ? { source: intervals, visual: intervals } : undefined
      );
      surface.remove();
      return projection;
    };

    for (const codeOrdinal of [1, 2]) {
      for (const localSelection of [
        { end: 2, label: 'typing', start: 2 },
        { end: 2, label: 'backward deletion', start: 1 },
        { end: 3, label: 'forward deletion', start: 2 }
      ]) {
        const uncached = project(codeOrdinal, localSelection, false);
        const cached = project(codeOrdinal, localSelection, true);

        // A cached interval additionally binds the source it was derived from.
        expect(cached, localSelection.label).toEqual({
          ...uncached,
          sourceInterval: { ...uncached.sourceInterval, sourceMarkdown: markdown },
          visualInterval: { ...uncached.visualInterval, sourceMarkdown: markdown }
        });
        expect(cached.sourceSelection).toEqual({
          end: cached.sourceInterval.bodyStart + localSelection.end,
          start: cached.sourceInterval.bodyStart + localSelection.start
        });
      }
    }
  });

  it('keeps accepted Preview code interval work independent of PRE count', () => {
    const createBatch = (codeBlockCount: number) => {
      const sourceLines = ['    same', ''];
      const editBlocks = [previewBlock('indented', 0, 1, false)];
      const codeBlockIds: string[] = [];
      for (let index = 0; index < codeBlockCount; index += 1) {
        const startLine = sourceLines.length;
        const id = `code-${index}`;
        codeBlockIds.push(id);
        sourceLines.push('~~~js', 'same', '~~~', '');
        editBlocks.push(previewBlock(id, startLine, startLine + 3));
      }
      return {
        codeBlockIds,
        editMap: previewEditMap(editBlocks),
        markdown: sourceLines.join('\n').replace(/\n$/u, '')
      };
    };

    const lineStartsSpy = vi.spyOn(markdownLineModel, 'markdownLineStarts');
    try {
      const runBatch = (codeBlockCount: number) => {
        const batch = createBatch(codeBlockCount);
        const callsBefore = lineStartsSpy.mock.calls.length;
        const intervals = createVisualCodeBodyIntervalsForPreviewBlocks(
          batch.markdown,
          batch.editMap
        );
        return {
          ...batch,
          intervals,
          lineStartsCalls: lineStartsSpy.mock.calls.length - callsBefore
        };
      };
      const small = runBatch(8);
      const large = runBatch(16);

      expect(small.lineStartsCalls).toBeGreaterThan(0);
      expect(large.lineStartsCalls).toBe(small.lineStartsCalls);
      for (const batch of [small, large]) {
        expect(batch.intervals.size).toBe(batch.codeBlockIds.length);
        for (const id of batch.codeBlockIds) {
          expect(batch.intervals.get(id)).toEqual({
            ...createVisualCodeBodyIntervalForPreviewBlock(
              batch.markdown,
              batch.editMap,
              id
            ),
            sourceMarkdown: batch.markdown
          });
        }
      }
    } finally {
      lineStartsSpy.mockRestore();
    }
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

  it.each(['~~~', '```'])('uses only a source-bound interval witness for %s expansion', (fence) => {
    const source = `${fence}js\r\nBefore\r\n${fence}`;
    const body = `Before\n${fence}x\n`;
    const interval = visualCodeBodyIntervalMap(source).get(0);
    if (!interval) throw new Error('code-body-witness-missing');
    const witness = { sourceMarkdown: source, codeOrdinal: 0, interval };
    expect(expandVisualCodeFenceForBody(source, 0, body, witness)).toEqual(expandVisualCodeFenceForBody(source, 0, body));
    expect(() => expandVisualCodeFenceForBody(source.replace(/\r\n/g, '\n'), 0, body, witness)).toThrow('visual-editor-code-body-map-stale');
    expect(() => expandVisualCodeFenceForBody(`    old\n\n${source}`, 0, body, witness)).toThrow('visual-editor-code-body-map-stale');
    expect(() => expandVisualCodeFenceForBody(source, 1, body, witness)).toThrow('visual-editor-code-body-map-stale');
    const unboundInterval = { ...interval, sourceMarkdown: undefined };
    expect(() => expandVisualCodeFenceForBody(source, 0, body, { ...witness, interval: unboundInterval })).toThrow('visual-editor-code-body-map-stale');
  });

  it('keeps an open-EOF fence expansion identical with a source-bound interval', () => {
    const source = '~~~js\nBefore\n';
    const body = 'Before\n~~~x\n';
    const interval = visualCodeBodyIntervalMap(source).get(0);
    if (!interval) throw new Error('code-body-witness-missing');
    expect(expandVisualCodeFenceForBody(source, 0, body, { sourceMarkdown: source, codeOrdinal: 0, interval }))
      .toEqual(expandVisualCodeFenceForBody(source, 0, body));
  });

  it('keeps an indented list fence expansion identical with a source-bound interval', () => {
    const source = '- item\n\n  ```js\n  Before\n  ```';
    const body = '  Before\n  ```x\n';
    const interval = visualCodeBodyIntervalMap(source).get(0);
    if (!interval) throw new Error('code-body-witness-missing');
    expect(expandVisualCodeFenceForBody(source, 0, body, { sourceMarkdown: source, codeOrdinal: 0, interval }))
      .toEqual(expandVisualCodeFenceForBody(source, 0, body));
  });

  it('retains the existing unsupported quote-prefixed fence behavior', () => {
    const source = '> ```js\n> Before\n> ```';
    expect(visualCodeBodyIntervalMap(source).size).toBe(0);
    expect(() => expandVisualCodeFenceForBody(source, 0, 'Before\n```x\n'))
      .toThrow('visual-editor-code-body-map-invalid');
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

  it('projects a repeated witnessed terminal space only through its matching owning prefix', () => {
    const source = 'Paragraph earlier\n\nParagraph ';
    const baseline = 'Paragraph earlier\n\nParagraph';
    const surface = editor('<p>Paragraph earlier</p><p>Paragraph\u00a0</p>');
    const node = surface.lastElementChild?.firstChild;
    if (!(node instanceof Text)) throw new Error('repeated-witness-text-missing');
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    const witness = { data: 'Paragraph ' };
    expect(mapTextBoundaryFromInterval(surface, node, node.length, baseline, interval, false, witness))
      .toEqual({ sourceOffset: source.length, visualOffset: baseline.length });
    expect(mapTextBoundaryFromInterval(surface, node, node.length - 1, baseline, interval, false, witness))
      .toEqual({ sourceOffset: source.length - 1, visualOffset: baseline.length });
    const wrongSource = createVisualMarkdownSourceIntervalMap('Paragraph earlier\n\nParagraphX', baseline);
    expect(mapTextBoundaryFromInterval(surface, node, node.length, baseline, wrongSource, false, witness)).toBeNull();

    const preceding = surface.firstElementChild;
    if (!(preceding instanceof HTMLElement)) throw new Error('repeated-witness-prefix-missing');
    preceding.textContent = 'Altered earlier';
    expect(mapTextBoundaryFromInterval(surface, node, node.length, baseline, interval, false, witness)).toBeNull();
    const foreign = document.createTextNode('Paragraph\u00a0');
    expect(mapTextBoundaryFromInterval(surface, foreign, foreign.length, baseline, interval, false, witness)).toBeNull();
    surface.remove();
  });

  // Press 153's geometry: the witnessed run ends its block and ends with a
  // space, and the serializer spelled an escape inside it. `escape()` escapes
  // `\ * - + = # ` ~ [ ] > _ .` in a non-code text node, but only five of them
  // mid-run - the rest only at a line start, and `~` not at all - so each
  // character stands in the DOM shape the serializer really writes its escape
  // in, and the raw source is read back from the serializer instead of guessed.
  // Every resolving row refused before the fix, because the pin compared the
  // DOM's rendered spelling against the baseline's raw spelling; the two refusal
  // rows below assert the hand-overs that stay refusals.
  it.each([
    ['*', 'Alpha *beta '],
    ['-', '-Alpha beta '],
    ['+', '+ Alpha beta '],
    ['=', '=Alpha beta '],
    ['#', '# Alpha beta '],
    ['`', 'Alpha `beta '],
    ['[', 'Alpha [beta '],
    [']', 'Alpha ]beta '],
    ['>', '>Alpha beta '],
    ['_', 'Alpha _beta '],
    ['.', '1. Alpha beta ']
  ])(
    'projects a witnessed terminal run the serializer escaped with %s',
    (marker, renderedBody) => {
      // The live DOM spells the run's terminal space as the NBSP artifact, so the
      // row hands the mapper the same spelling the witness establishment folds.
      const surface = editor(`<p>Lead</p><p>${renderedBody.replace(/ $/u, '\u00a0')}</p>`);
      const block = surface.lastElementChild;
      if (!(block instanceof HTMLElement)) throw new Error('escaped-witness-block-missing');
      const node = block.firstChild;
      if (!(node instanceof Text)) throw new Error('escaped-witness-text-missing');
      // The browser spells the space before a collapsed caret as an NBSP while
      // the committed source spells it as an ASCII space, so the raw spelling is
      // read back from the serializer with the same fold the witness
      // establishment makes, and the terminal space the block fragment trims is
      // put back: that is the committed source this geometry is about.
      const rawBody = `${serializeVisualMarkdownBlockFragment([block])
        .replace(/\u00a0/gu, ' ')
        .replace(/ +$/u, '')} `;
      const source = `Lead\n\n${rawBody}`;
      const renderedBlock = (block.textContent ?? '').replace(/\u00a0/gu, ' ');
      // The premises, asserted rather than assumed: the serializer really
      // spelled this character as an escape, the rendered spelling is the run
      // the witness carries, and the raw spelling is longer by exactly that one
      // escape - so a row whose geometry stops holding reds here.
      expect(rawBody).toContain(`\\${marker}`);
      expect(renderedBlock).toBe(renderedBody);
      expect(rawBody.length - renderedBlock.length).toBe(1);
      expect(
        mapTextBoundaryFromInterval(
          surface,
          node,
          node.length,
          source,
          createVisualMarkdownSourceIntervalMap(source, source),
          false,
          { data: renderedBody }
        )
      ).toEqual({ sourceOffset: source.length, visualOffset: source.length });
      surface.remove();
    }
  );

  it.each([
    ['at the start of the run', '\\*Alpha beta ', '*Alpha beta ', '*Alpha beta '],
    ['inside the run', 'Alpha \\*beta ', 'Alpha *beta ', 'Alpha *beta '],
    ['at the end of the run', 'Alpha beta\\* ', 'Alpha beta* ', 'Alpha beta* '],
    ['twice in the run', 'Alpha \\*beta\\_ ', 'Alpha *beta_ ', 'Alpha *beta_ ']
  ])(
    'projects a witnessed terminal run with an escape %s',
    (_label, rawBody, renderedBody, witnessData) => {
      const source = `Lead\n\n${rawBody}`;
      const surface = editor(`<p>Lead</p><p>${renderedBody}</p>`);
      const node = surface.lastElementChild?.firstChild;
      if (!(node instanceof Text)) throw new Error('escaped-witness-text-missing');
      const interval = createVisualMarkdownSourceIntervalMap(source, source);
      // The same premise the per-character rows assert: the rendered spelling the
      // DOM carries ends with the run the witness names, and the raw spelling is
      // longer by exactly one character per escape the run carries.
      const renderedBlock = (surface.lastElementChild?.textContent ?? '').replace(/ /gu, ' ');
      expect(renderedBlock.endsWith(witnessData)).toBe(true);
      expect(rawBody.length - renderedBlock.length).toBe(rawBody.split('\\').length - 1);
      expect(
        mapTextBoundaryFromInterval(
          surface,
          node,
          node.length,
          source,
          interval,
          false,
          { data: witnessData }
        )
      ).toEqual({ sourceOffset: source.length, visualOffset: source.length });
      surface.remove();
    }
  );

  // The one escapable character whose escape spelling is itself a backslash run:
  // the serializer writes `\\` for one rendered backslash, and which backslash a
  // rendered position came from is the owning block's literal marker's to decide,
  // so this path hands those boundaries over instead of guessing - the same
  // hand-over the fast path makes when it meets an active escape. The premises are
  // asserted as the resolving rows assert theirs, and then the refusal.
  it('refuses a witnessed terminal run whose escape is a backslash run', () => {
    const surface = editor('<p>Lead</p><p>Alpha \\beta\u00a0</p>');
    const block = surface.lastElementChild;
    if (!(block instanceof HTMLElement)) throw new Error('literal-witness-block-missing');
    const node = block.firstChild;
    if (!(node instanceof Text)) throw new Error('literal-witness-text-missing');
    const rawBody = `${serializeVisualMarkdownBlockFragment([block])
      .replace(/\u00a0/gu, ' ')
      .replace(/ +$/u, '')} `;
    const source = `Lead\n\n${rawBody}`;
    const renderedBlock = (block.textContent ?? '').replace(/\u00a0/gu, ' ');
    expect(rawBody).toContain('\\\\');
    expect(renderedBlock).toBe('Alpha \\beta ');
    expect(rawBody.length - renderedBlock.length).toBe(1);
    expect(
      mapTextBoundaryFromInterval(
        surface,
        node,
        node.length,
        source,
        createVisualMarkdownSourceIntervalMap(source, source),
        false,
        { data: 'Alpha \\beta ' }
      )
    ).toBeNull();
    surface.remove();
  });

  // The one escapable character this serializer never spells as an escape,
  // measured rather than assumed: `escape()` has no rule for `~` inside a
  // paragraph's own text, so no baseline the product produces carries a mid-run
  // `\~`. A source that does carry one therefore has no provable baseline at
  // all, and the mapping refuses it instead of guessing - which is what failing
  // closed means here. A line-start run is a different spelling: the fence
  // marker rule keeps the fence spelling there - a line-start run followed by an
  // info string is a complete opening, not a growing literal - so this refusal
  // is measured on the mid-run escape and the anchored row pins the fence
  // spelling the fence rule owes.
  it('refuses a witnessed terminal run whose escape the serializer never writes', () => {
    const midRunSurface = editor('<p>Lead</p><p>Alpha ~beta </p>');
    const midRunBlock = midRunSurface.lastElementChild;
    if (!(midRunBlock instanceof HTMLElement)) throw new Error('tilde-witness-block-missing');
    expect(serializeVisualMarkdownBlockFragment([midRunBlock])).not.toContain('\\');
    const anchoredSurface = editor('<p>Lead</p><p>~~~Alpha beta </p>');
    const anchoredBlock = anchoredSurface.lastElementChild;
    if (!(anchoredBlock instanceof HTMLElement)) throw new Error('tilde-anchored-block-missing');
    expect(serializeVisualMarkdownBlockFragment([anchoredBlock]))
      .toBe('~~~Alpha beta');
    midRunSurface.remove();
    anchoredSurface.remove();
    const source = 'Lead\n\nAlpha \\~beta ';
    const surface = editor('<p>Lead</p><p>Alpha ~beta\u00a0</p>');
    const node = surface.lastElementChild?.firstChild;
    if (!(node instanceof Text)) throw new Error('tilde-witness-text-missing');
    expect(
      mapTextBoundaryFromInterval(
        surface,
        node,
        node.length,
        source,
        createVisualMarkdownSourceIntervalMap(source, source),
        false,
        { data: 'Alpha ~beta ' }
      )
    ).toBeNull();
    surface.remove();
  });

  it('keeps a witnessed terminal run without an escape unchanged', () => {
    const rawBody = 'Alpha beta ';
    const source = `Lead\n\n${rawBody}`;
    const surface = editor('<p>Lead</p><p>Alpha beta\u00a0</p>');
    const node = surface.lastElementChild?.firstChild;
    if (!(node instanceof Text)) throw new Error('unescaped-witness-text-missing');
    const interval = createVisualMarkdownSourceIntervalMap(source, source);
    // The control's premise: no escape was written, so the rendered spelling the
    // DOM carries is the raw spelling, and the run still resolves exactly as it
    // did before the fix.
    const renderedBlock = (surface.lastElementChild?.textContent ?? '').replace(/\u00a0/gu, ' ');
    expect(renderedBlock).toBe(rawBody);
    expect(rawBody.length - renderedBlock.length).toBe(rawBody.split('\\').length - 1);
    expect(
      mapTextBoundaryFromInterval(surface, node, node.length, source, interval, false, {
        data: 'Alpha beta '
      })
    ).toEqual({ sourceOffset: source.length, visualOffset: source.length });
    surface.remove();
  });

  it('still refuses a witnessed terminal run its block cannot prove', () => {
    const source = 'Lead\n\nAlpha \\*beta ';
    const surface = editor('<p>Lead</p><p>Alpha *beta\u00a0</p>');
    const node = surface.lastElementChild?.firstChild;
    if (!(node instanceof Text)) throw new Error('unprovable-witness-text-missing');
    const interval = createVisualMarkdownSourceIntervalMap(source, source);
    expect(
      mapTextBoundaryFromInterval(surface, node, node.length, source, interval, false, {
        data: 'Alpha omega '
      })
    ).toBeNull();
    const foreign = document.createTextNode('Alpha *beta ');
    expect(
      mapTextBoundaryFromInterval(surface, foreign, foreign.length, source, interval, false, {
        data: 'Alpha *beta '
      })
    ).toBeNull();
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

  it('maps a certified plain heading tail through trailing source gaps without admitting interior newlines or gap offsets', () => {
    const surface = editor('<h1>Synthetic heading</h1>');
    const heading = surface.firstElementChild as HTMLElement;
    const source = '# Synthetic heading\n\n\n\n';
    const baseline = serializeVisualMarkdownBlockFragment([heading]);
    const tail = source.indexOf('\n');
    const boundary = visualCaretBoundaryFromSourceOffset(heading, source, baseline, tail);
    expect(boundary.node).toBe(heading.firstChild);
    expect(boundary.offset).toBe('Synthetic heading'.length);
    expect(() => visualCaretBoundaryFromSourceOffset(heading, source, baseline, tail + 1)).toThrow();
    expect(() => visualCaretBoundaryFromSourceOffset(heading, '# Synthetic\nheading\n\n', baseline, tail)).toThrow();
    surface.remove();
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

  it.each([
    { body: '   ', expected: '`   `' },
    { body: '\t\t', expected: '`\t\t`' },
    { body: ' \u00a0 ', expected: '`  \u00a0  `' },
    { body: ' a  b ', expected: '`  a  b  `' },
    { body: '`', expected: '`` ` ``' }
  ])('serializes inline code body whitespace and delimiters: $body', ({ body, expected }) => {
    const surface = editor('');
    const paragraph = document.createElement('p');
    const code = document.createElement('code');
    code.textContent = body;
    paragraph.append('Before ', code, ' after');
    surface.append(paragraph);
    expect(serializeVisualMarkdown(surface)).toBe(`Before ${expected} after`);
    surface.remove();
  });

  it('serializes whitespace-only inline code as the sole paragraph content', () => {
    const surface = editor('<p><code>   </code></p>');
    expect(serializeVisualMarkdown(surface)).toBe('`   `');
    surface.remove();
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

  it('maps both source edges of an image in a detached formal row without moving native selection', () => {
    const source = '![alt](https://example.test/image.png)';
    const surface = document.createElement('article');
    surface.innerHTML = '<p><img alt="alt" src="https://example.test/image.png"></p>';
    const paragraph = surface.firstElementChild;
    if (!(paragraph instanceof HTMLElement)) throw new Error('detached-image-row-missing');
    const baseline = serializeVisualMarkdown(surface);
    const native = window.getSelection();
    const beforeAnchor = native?.anchorNode;
    const beforeOffset = native?.anchorOffset;
    const start = visualCaretBoundaryFromSourceOffset(surface, source, baseline, 0);
    const end = visualCaretBoundaryFromSourceOffset(surface, source, baseline, source.length);
    expect(start).toEqual({ node: paragraph, offset: 0 });
    expect(end).toEqual({ node: paragraph, offset: 1 });
    expect(visualBoundarySourceOffset(surface, source, baseline, paragraph, 0)).toBe(0);
    expect(visualBoundarySourceOffset(surface, source, baseline, paragraph, 1)).toBe(source.length);
    expect(native?.anchorNode).toBe(beforeAnchor);
    expect(native?.anchorOffset).toBe(beforeOffset);
  });

  it('maps text around a rendered reference image without rewriting its source token', () => {
    const source = 'Opening ![dot][pic] tail.';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Opening <img alt="dot" src="https://example.test/image.png"> tail.</p>';
    const paragraph = surface.firstElementChild;
    if (!(paragraph instanceof HTMLElement)) throw new Error('image-projection-row-missing');
    const baseline = serializeVisualMarkdown(surface);
    const imageStart = baseline.indexOf('![dot]');
    const imageEnd = baseline.indexOf(' tail.');
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => label === 'pic');
    expect(map.resolve(imageStart)).toBe(source.indexOf('![dot]'));
    expect(map.resolve(imageEnd)).toBe(source.indexOf(' tail.'));
    expect(map.resolve(imageStart + 1)).toBeNull();
    expect(visualBoundarySourceOffset(surface, source, baseline, paragraph, paragraph.childNodes.length, map)).toBe(source.length);
    expect(mergeVisualMarkdownChangeDetails(source, baseline, `${baseline}X`, map).value).toBe(`${source}X`);
    expect(mergeVisualMarkdownChangeDetails(source, baseline, baseline.replace('Opening ', 'OpenZing '), map).value)
      .toBe(source.replace('Opening ', 'OpenZing '));
  });

  it('uses an exact image projection for generic selection and rejects stale maps even at document edges', () => {
    const source = 'Opening ![dot][pic] tail.';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Opening <img alt="dot" src="x"> tail.</p>';
    document.body.append(surface);
    const paragraph = surface.firstElementChild;
    const text = paragraph?.lastChild;
    if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) throw new Error('projected-selection-fixture-missing');
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => label === 'pic');
    try {
      window.getSelection()?.collapse(text, text.length);
      expect(visualSelectionSourceRange(surface, source, baseline, baseline, { projectedIntervalMap: map }))
        .toEqual({ direction: 'none', start: source.length, end: source.length });
      window.getSelection()?.collapse(surface, 0);
      expect(() => visualSelectionSourceRange(surface, `${source}x`, baseline, baseline, { projectedIntervalMap: map }))
        .toThrow('visual-editor-markdown-merge-failed');
      expect(() => visualSelectionSourceRange(surface, source, `${baseline}x`, `${baseline}x`, { projectedIntervalMap: map }))
        .toThrow('visual-editor-markdown-merge-failed');
    } finally { surface.remove(); }
  });

  it('maps a whole reference image but rejects partial image edits and stale snapshots', () => {
    const source = '![dot][pic]';
    const surface = document.createElement('article');
    surface.innerHTML = '<p><img alt="dot" src="https://example.test/image.png"></p>';
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => label === 'pic');
    expect(mergeVisualMarkdownChangeDetails(source, baseline, '', map).value).toBe('');
    expect(() => mergeVisualMarkdownChangeDetails(source, baseline, `${baseline.slice(0, 3)}X${baseline.slice(3)}`, map)).toThrow();
    expect(() => mergeVisualMarkdownChangeDetails(`${source}x`, baseline, '', map)).toThrow('visual-editor-markdown-merge-failed');
    expect(() => createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, () => false)).toThrow('visual-editor-image-source-map-failed');
  });

  it('binds the formal image rather than an unresolved label with different whitespace and case folding', () => {
    const source = '[a\u00a0b]: /ghost\n\n[STRASSE]: /real\n\n![x][a b] ![y][Stra\u00dfe]';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>![x][a b] <img src="/real" alt="y"></p>';
    const baseline = serializeVisualMarkdown(surface);
    const nodes: MarkdownSyntaxNode[] = [];
    markdownLanguage.parser.parse(source).iterate({ enter(node) { nodes.push({ from: node.from, name: node.name, to: node.to }); } });
    const definition = markdownReferenceDefinitionQuery(source, nodes, 14);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => definition(label) !== null);
    expect(map.resolve(baseline.indexOf('![y]'))).toBe(source.indexOf('![y]'));
  });

  it.each([
    { name: 'collapsed reference', source: 'left ![a][] right', html: '<p>left <img alt="a" src="x"> right</p>', labels: ['a'] },
    { name: 'shortcut reference', source: 'left ![a] right', html: '<p>left <img alt="a" src="x"> right</p>', labels: ['a'] },
    { name: 'repeated references', source: 'left ![a][id]![a][id] right', html: '<p>left <img alt="a" src="x"><img alt="a" src="x"> right</p>', labels: ['id'] },
    { name: 'linked reference', source: 'left [![a][id]](y) right', html: '<p>left <a href="y"><img alt="a" src="x"></a> right</p>', labels: ['id'] },
    { name: 'unresolved reference', source: 'left ![a][missing] ![b](x) right', html: '<p>left ![a][missing] <img alt="b" src="x"> right</p>', labels: [] },
    { name: 'escaped image marker', source: 'left \\![a](x) ![b](x) right', html: '<p>left ![a](x) <img alt="b" src="x"> right</p>', labels: [] },
    { name: 'literal code image', source: 'left `![a](x)` ![b](x) right', html: '<p>left <code>![a](x)</code> <img alt="b" src="x"> right</p>', labels: [] }
  ])('preserves $name source while editing neighboring text', ({ source, html, labels }) => {
    const surface = document.createElement('article'); surface.innerHTML = html;
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => labels.includes(label));
    expect(mergeVisualMarkdownChangeDetails(source, baseline, `${baseline}X`, map).value).toBe(`${source}X`);
    expect(mergeVisualMarkdownChangeDetails(source, baseline, baseline.replace(' right', ' rightX'), map).value)
      .toBe(source.replace(' right', ' rightX'));
  });

  it('returns original CRLF offsets around a projected reference image', () => {
    const source = 'Before\r\n\r\n![dot][pic]';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Before</p><p><img alt="dot" src="x"></p>';
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => label === 'pic');
    expect(map.resolve(baseline.indexOf('![dot]'))).toBe(source.indexOf('![dot]'));
    expect(map.resolve(baseline.length)).toBe(source.length);
  });

  it('preserves a CRLF reference definition when editing adjacent text', () => {
    const source = '[pic]: https://example.test/image.png\r\n\r\nOpening ![dot][pic] tail.';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Opening <img alt="dot" src="https://example.test/image.png"> tail.</p>';
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => label === 'pic');
    expect(mergeVisualMarkdownChangeDetails(source, baseline, `${baseline}X`, map).value).toBe(`${source}X`);
    expect(mergeVisualMarkdownChangeDetails(source, baseline, baseline.replace('Opening ', 'OpenZing '), map).value)
      .toBe(source.replace('Opening ', 'OpenZing '));
  });

  it('excludes protected generated images from editable image projection', () => {
    const source = '![a][id]\n\n```mermaid\ngraph TD\n```';
    const surface = document.createElement('article');
    surface.innerHTML = '<p><img alt="a" src="x"></p><div class="easymde-mermaid" contenteditable="false" data-easymde-visual-markdown-source="graph TD"><img alt="generated" src="generated.png"></div>';
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownImageSourceIntervalMap(surface, source, baseline, (label) => label === 'id');
    expect(map.resolve(0)).toBe(0);
    expect(map.resolve(baseline.indexOf('\n\n```'))).toBe(source.indexOf('\n\n```'));
  });

  it.each([
    { source: '[![a](x)](y)', html: '<p><a href="y"><img alt="a" src="x"></a></p>' },
    { source: '![a][id]', html: '<p><img alt="a" src="x"></p>' },
    { source: '[text ![a][id]](y)', html: '<p><a href="y">text <img alt="a" src="x"></a></p>' }
  ])('maps the terminal image source edge of $source to its parent boundary', ({ source, html }) => {
    const surface = document.createElement('article');
    surface.innerHTML = html;
    const paragraph = surface.querySelector('p');
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const offset = selection?.anchorOffset;
    expect(visualBoundaryForImageSourceEdge(surface, source, source.length, (label) => label === 'id')).toEqual({ node: paragraph, offset: 1 });
    expect(selection?.anchorNode).toBe(anchor);
    expect(selection?.anchorOffset).toBe(offset);
  });

  it('maps adjacent reference image edges without claiming intervening visible text', () => {
    const source = '![a][id]![b][id]x';
    const surface = document.createElement('article');
    surface.innerHTML = '<p><img alt="a" src="x"><img alt="b" src="x">x</p>';
    const paragraph = surface.querySelector('p');
    const defined = (label: string) => label === 'id';
    expect(visualBoundaryForImageSourceEdge(surface, source, 0, defined)).toEqual({ node: paragraph, offset: 0 });
    expect(visualBoundaryForImageSourceEdge(surface, source, '![a][id]'.length, defined)).toEqual({ node: paragraph, offset: 1 });
    expect(visualBoundaryForImageSourceEdge(surface, source, source.length, defined)).toBeNull();
    expect(() => visualBoundaryForImageSourceEdge(surface, source, 0, () => false)).toThrow('visual-editor-image-source-map-failed');
  });

  it('maps ordinary text on both sides of a reference image without moving selection', () => {
    const source = 'Left ![a][id] Right';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Left <img alt="a" src="x"> Right</p>';
    const paragraph = surface.querySelector('p');
    const left = paragraph?.firstChild;
    const right = paragraph?.lastChild;
    if (!(left instanceof Text) || !(right instanceof Text)) throw new Error('reference-image-adjacent-text-missing');
    const baseline = serializeVisualMarkdown(surface);
    const isDefined = (label: string) => label === 'id';
    for (const [position, expectedNode, expectedOffset] of [
      [2, left, 2],
      [source.indexOf('Right') + 2, right, 3]
    ] as const) {
      expect(visualBoundaryForImageSourceEdge(surface, source, position, isDefined)).toBeNull();
      expect(visualCaretBoundaryFromSourceOffset(surface, source, baseline, position)).toEqual({ node: expectedNode, offset: expectedOffset });
    }
  });

  it.each([
    { source: '![a](x)', html: '<p><img alt="a" src="x"></p>', index: 0, labels: [], token: '![a](x)' },
    { source: '![a](x) ![a](x)', html: '<p><img alt="a" src="x"> <img alt="a" src="x"></p>', index: 1, labels: [], token: '![a](x)', last: true },
    { source: '![a][id]', html: '<p><img alt="a" src="x"></p>', index: 0, labels: ['id'], token: '![a][id]' },
    { source: '![a][]', html: '<p><img alt="a" src="x"></p>', index: 0, labels: ['a'], token: '![a][]' },
    { source: '![a]', html: '<p><img alt="a" src="x"></p>', index: 0, labels: ['a'], token: '![a]' },
    { source: '![a][missing] ![b](x)', html: '<p>![a][missing] <img alt="b" src="x"></p>', index: 0, labels: [], token: '![b](x)' },
    { source: '[![a](x)](y)', html: '<p><a href="y"><img alt="a" src="x"></a></p>', index: 0, labels: [], token: '![a](x)' }
  ])('proves the rendered image source interval for $source', ({ source, html, index, labels, token, last }) => {
    const surface = document.createElement('article');
    surface.innerHTML = html;
    const image = surface.querySelectorAll('img')[index];
    if (!(image instanceof HTMLImageElement)) throw new Error('rendered-image-witness-missing');
    const start = last ? source.lastIndexOf(token) : source.indexOf(token);
    expect(visualSourceRangeForRenderedImage(surface, image, source, (label) => (labels as readonly string[]).includes(label))).toEqual({ start, end: start + token.length });
  });

  it.each([
    { source: '`![a](x)`', html: '<p><code>![a](x)</code><img alt="a" src="x"></p>' },
    { source: '\\![a](x)', html: '<p>![a](x)<img alt="a" src="x"></p>' },
    { source: '![a][missing]', html: '<p><img alt="a" src="x"></p>' },
    { source: '![a](x)', html: '<p><span contenteditable="false"><img alt="a" src="x"></span></p>' },
    { source: '![a](x) ![b](x)', html: '<p><img alt="a" src="x"></p>' }
  ])('rejects an unproved or protected image correspondence for $source', ({ source, html }) => {
    const surface = document.createElement('article');
    surface.innerHTML = html;
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) throw new Error('rendered-image-witness-missing');
    expect(() => visualSourceRangeForRenderedImage(surface, image, source, () => false)).toThrow('visual-editor-image-source-map-failed');
  });

  it.each([
    { source: '[![a](x)](y)', html: '<p><a href="y"><img alt="a" src="x"></a></p>', expected: '[![a](x)](y)' },
    { source: '**![a](x)**', html: '<p><strong><img alt="a" src="x"></strong></p>', expected: '**![a](x)**' },
    { source: '[x![a](x)](y)', html: '<p><a href="y">x<img alt="a" src="x"></a></p>', expected: '![a](x)' },
    { source: '[![a](x)![b](x)](y)', html: '<p><a href="y"><img alt="a" src="x"><img alt="b" src="x"></a></p>', expected: '![a](x)' },
    { source: '[![a](x)  \ny](y)', html: '<p><a href="y"><img alt="a" src="x"><br>y</a></p>', expected: '![a](x)' }
  ])('retires only empty inline ancestors for $source', ({ source, html, expected }) => {
    const surface = document.createElement('article');
    surface.innerHTML = html;
    const image = surface.querySelector('img');
    if (!(image instanceof HTMLImageElement)) throw new Error('rendered-image-witness-missing');
    const imageStart = source.indexOf('![a](x)');
    const range = visualRetiredInlineSourceRange(surface, image, source, { start: imageStart, end: imageStart + '![a](x)'.length });
    expect(source.slice(range.start, range.end)).toBe(expected);
  });

  it.each([
    { name: 'standalone', source: '![a](https://example.test/a)', html: '<p><img alt="a" src="https://example.test/a"></p>', index: 0, expected: '' },
    { name: 'adjacent prose', source: 'x![a](https://example.test/a)y', html: '<p>x<img alt="a" src="https://example.test/a">y</p>', index: 0, expected: 'xy' },
    { name: 'repeated', source: '![a](https://example.test/a)![a](https://example.test/a)', html: '<p><img alt="a" src="https://example.test/a"><img alt="a" src="https://example.test/a"></p>', index: 1, expected: '![a](https://example.test/a)' },
    { name: 'linked', source: '[![a](https://example.test/a)](https://example.test/b)', html: '<p><a href="https://example.test/b"><img alt="a" src="https://example.test/a"></a></p>', index: 0, expected: '' },
    { name: 'resolved reference', source: '![a][id]\n\n[id]: https://example.test/a', html: '<p><img alt="a" src="https://example.test/a"></p>', index: 0, expected: '\n\n[id]: https://example.test/a' }
  ])('removes only the parser-owned image and empty inline wrappers for $name', ({ source, html, index, expected }) => {
    const surface = document.createElement('article');
    surface.innerHTML = html;
    const image = surface.querySelectorAll('img')[index];
    if (!image) throw new Error('detached-image-unit-missing');
    const imageRange = visualSourceRangeForRenderedImage(surface, image, source, (label) => label === 'id');
    const range = visualRetiredInlineSourceRange(surface, image, source, imageRange);
    expect(source.slice(0, range.start) + source.slice(range.end)).toBe(expected);
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

  it('keeps the fence spelling a marker paragraph already carries, and escapes a bare run that would swallow what follows', () => {
    // Two spellings, both measured against the round trip. A paragraph whose
    // text is the fence's own marker line keeps that spelling: a run that is the
    // document's last block, or is followed by a matching closing run of the
    // same family and length with an empty info string, is the fence the surface
    // draws, and escaping it writes a source the surface never holds. A bare run
    // followed by blocks an unclosed fence would swallow is the literal case, so
    // it keeps the escaped spelling. A run carrying an info string is a complete
    // opening rather than a growing literal, and it keeps the fence spelling the
    // frozen consumer rows require while a composed character is spliced into an
    // escaped canonical source.
    const geometries = [
      ['a bare run at the end of the document', '<p>```</p>', '```'],
      ['a run with an info string', '<p>```bash</p>', '```bash'],
      ['a run before another block', '<p>```</p><p>tail</p>', '\\`\\`\\`\n\ntail'],
      ['a run with an info string before another block', '<p>```bash</p><p>tail</p>', '```bash\n\ntail'],
      ['two adjacent runs', '<p>```</p><p>```</p>', '```\n\n```'],
      ['a run with trailing text on its line', '<p>```tail</p>', '```tail']
    ] as const;
    for (const [name, html, expected] of geometries) {
      const surface = editor(html);
      const baseline = serializeVisualMarkdown(surface);
      expect(baseline, name).toBe(expected);
      surface.remove();
      const source = `${expected}\n`;
      const map = createVisualMarkdownSourceIntervalMap(source, baseline);
      expect(
        map.hiddenSourceRanges.filter(({ end, start }) =>
          '\\' === source[start] || '\\' === source[end - 1]),
        `${name}: no escape may be hidden Markdown`
      ).toEqual([]);
      for (let at = 0; at <= baseline.length; at += 1) {
        // The DOM never draws a caret between an escape and the character it
        // escapes, so the offsets inside an escaped unit are not presses; every
        // other offset is one the surface can make.
        const insideEscape = at > 0 && at < baseline.length
          && '\\' === baseline[at - 1] && '\\' !== baseline[at];
        if (insideEscape) continue;
        const inserted = `${baseline.slice(0, at)}X${baseline.slice(at)}`;
        expect(
          () => mergeVisualMarkdownChangeDetails(source, baseline, inserted, map),
          `${name}: insertion at ${at}`
        ).not.toThrow();
      }
    }
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
    // The shortcut refuses, so the row stays the paragraph the surface draws;
    // the run carries an info string, so it is a complete fence opening and the
    // serializer keeps the fence spelling rather than escaping it.
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

  it('keeps a code-body caret on the code text instead of a zero-width anchor', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code>Alpha</code></pre><p>Tail</p>'
    );
    const source = serializeVisualMarkdown(surface);
    const pre = surface.querySelector('pre');
    const code = surface.querySelector('pre > code');
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
      throw new Error('visual-anchored-code-missing');
    }

    // A fence body's own end maps to the `code` element boundary, so this used
    // to insert a U+200B caret anchor inside the code body. That anchor
    // survived serialization and reached the canonical document through the
    // code-body input intent.
    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      '~~~\nAlpha'.length
    );

    expect(code.textContent).toBe('Alpha');
    expect(captureVisualCodeInputSnapshot(pre)?.codeText).toBe('Alpha');
    expect(surface.textContent).not.toContain('\u200b');
    expect(serializeVisualMarkdown(surface)).toBe(source);
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

  /**
   * The continuation matrix for `applyVisualInlineShortcut`.
   *
   * Every row except the link failed before the neutral placement: the caret
   * was collapsed on the block boundary after the new unit, Chromium resolved
   * that boundary to the deepest text position before it - the end of the
   * unit's own text - and the continuation was typed inside the delimiters.
   * `a **bold**` + ` b` therefore canonicalized to `a **bold b**`, the em rows
   * to `a *italic b*`, the del row to `a ~~strike b~~`, and both code rows
   * swallowed the space into the code span. The link row is the case Chromium
   * already tolerated because it refuses to insert inside an anchor; it stays
   * here so the placement is covered for `<a>` exactly like every other closed
   * unit, and so a reverted placement is still visible for it.
   */
  it.each([
    {
      continuation: 'a **bold** b',
      markup: 'strong',
      typed: 'a **bold**'
    },
    {
      continuation: 'a **bold** b',
      markup: 'strong',
      typed: 'a __bold__'
    },
    {
      continuation: 'a *italic* b',
      markup: 'em',
      typed: 'a *italic*'
    },
    {
      continuation: 'a *italic* b',
      markup: 'em',
      typed: 'a _italic_'
    },
    {
      continuation: 'a ~~strike~~ b',
      markup: 'del',
      typed: 'a ~~strike~~'
    },
    {
      continuation: 'a `code` b',
      markup: 'code',
      typed: 'a `code`'
    },
    {
      continuation: 'a `co de` b',
      markup: 'code',
      typed: 'a `co de`'
    },
    {
      continuation: 'a [link](https://example.test) b',
      markup: 'a',
      typed: 'a [link](https://example.test)'
    }
  ])(
    'keeps a continued line outside the closed $markup unit typed as $typed',
    ({ continuation, markup, typed }) => {
      const surface = editor(`<p>${typed}</p>`);
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-inline-caret-text-missing');
      }
      placeCaret(text, text.length);

      expect(applyVisualInlineShortcut(surface)).toBe(true);

      const unit = surface.querySelector(markup);
      const anchor = window.getSelection()?.anchorNode;
      // The caret is the block's own text immediately after the closed unit,
      // not the ambiguous element boundary after it.
      expect(anchor).toBeInstanceOf(Text);
      if (!(anchor instanceof Text)) {
        throw new Error('visual-inline-caret-anchor-missing');
      }
      expect(anchor.parentElement?.tagName).toBe('P');
      expect(anchor.previousSibling).toBe(unit);

      typeAtVisualCaret(' b');

      expect(serializeVisualMarkdown(surface)).toBe(continuation);
    }
  );

  it('maps the caret after a closed inline unit to the source offset after its delimiters', () => {
    const surface = editor('<p>a **bold**</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-inline-anchor-text-missing');
    }
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);

    const source = serializeVisualMarkdown(surface);
    expect(source).toBe('a **bold**');
    expect(visualSelectionSourceRange(surface, source, source)).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('keeps the caret outside a closed inline unit across a Backspace on the anchor', () => {
    const surface = editor('<p>a **bold**</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-inline-anchor-text-missing');
    }
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);

    // A single zero-width anchor is consumed by this press: the node empties,
    // Chromium prunes it, and the caret resolves back to the end of the unit's
    // own text, where the `x` below would be typed inside the delimiters.
    pressBackspaceAtVisualCaret();

    const caret = window.getSelection()?.anchorNode;
    expect(caret).toBeInstanceOf(Text);
    if (!(caret instanceof Text)) {
      throw new Error('visual-inline-caret-anchor-missing');
    }
    expect(caret.parentElement?.tagName).toBe('P');
    expect(caret.previousSibling).toBe(surface.querySelector('strong'));

    typeAtVisualCaret('x');

    expect(serializeVisualMarkdown(surface)).toBe('a **bold**x');
  });

  it('keeps a typed space outside a closed inline unit across a Backspace on it', () => {
    const surface = editor('<p>a **bold**</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-inline-anchor-text-missing');
    }
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);
    typeAtVisualCaret(' ');
    // The space belongs to the paragraph, not to the unit: a trailing space of
    // a paragraph is not authored into the source, so the canonical line is
    // unchanged here, while a space typed inside the unit would show up as
    // `a **bold **`.
    expect(surface.querySelector('strong')?.textContent).toBe('bold');
    expect(serializeVisualMarkdown(surface)).toBe('a **bold**');

    pressBackspaceAtVisualCaret();
    typeAtVisualCaret('x');

    expect(serializeVisualMarkdown(surface)).toBe('a **bold**x');
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

  it.each([
    ['unordered', '<ul><li>outer\n<ul><li>inner</li><li><br></li></ul></li></ul>', '- outer\n  - inner\n  - \n', '  - \n'],
    ['ordered', '<ul><li>outer\n<ol><li>inner</li><li><br></li></ol></li></ul>', '- outer\n  1. inner\n  2. \n', '  2. \n'],
    ['quoted ordered', '<blockquote><ul><li>outer\n<ol><li>inner</li><li><br></li></ol></li></ul></blockquote>', '> - outer\n>   1. inner\n>   2. \n', '>   2. \n']
  ])('certifies an empty nested $0 body using full-document ancestry', (
    _description, markup, source, lastRow
  ) => {
    const surface = editor(markup);
    const target = surface.querySelector('li li:last-child');
    if (!(target instanceof HTMLElement)) throw new Error('visual-empty-row-target-missing');
    placeCaret(target, 0);
    const baseline = serializeVisualMarkdown(surface);
    const expected = source.indexOf(lastRow) + lastRow.length - 1;
    expect(visualEmptyStructuralBodySelection(surface, source, baseline))
      .toMatchObject({ sourceOffset: expected });
    expect(visualSelectionSourceRange(surface, source, baseline))
      .toEqual({ direction: 'none', start: expected, end: expected });
    expect(visualCaretBoundaryFromSourceOffset(surface, source, baseline, expected))
      .toEqual({ node: target, offset: 0 });
    expect(structuralEmptyLineRemoval(source, expected)).toEqual({
      start: source.indexOf(lastRow), end: source.length,
      caret: source.indexOf('inner') + 'inner'.length
    });
  });

  it('rejects an empty nested row whose list ancestry differs from the source', () => {
    const surface = editor('<ul><li>outer\n<ul><li>inner</li><li><br></li></ul></li></ul>');
    const target = surface.querySelector('li li:last-child');
    if (!(target instanceof HTMLElement)) throw new Error('visual-empty-row-target-missing');
    placeCaret(target, 0);
    const source = '- outer\n  1. inner\n  2. \n';
    const baseline = serializeVisualMarkdown(surface);
    expect(visualEmptyStructuralBodySelection(surface, source, baseline))
      .toEqual({ failure: 'visual-editor-markdown-merge-failed' });
  });

  it.each([
    ['star', '<ul><li>a</li><li><br></li></ul>', '* a\n* \n', 'li:last-child', 6, '* a\n', 3],
    ['dash', '<ul><li>a</li><li><br></li></ul>', '- a\n- \n', 'li:last-child', 6, '- a\n', 3],
    ['plus', '<ul><li>a</li><li><br></li></ul>', '+ a\n+ \n', 'li:last-child', 6, '+ a\n', 3],
    ['extra spaces', '<ul><li>a</li><li><br></li></ul>', '* a\n*   \n', 'li:last-child', 6, '* a\n', 3],
    ['middle extra spaces', '<ul><li>a</li><li><br></li><li>c</li></ul>', '- a\n-   \n- c\n', 'li:nth-child(2)', 6, '- a\n- c\n', 3],
    ['middle extra spaces CRLF', '<ul><li>a</li><li><br></li><li>c</li></ul>', '- a\r\n-   \r\n- c\r\n', 'li:nth-child(2)', 7, '- a\r\n- c\r\n', 3],
    ['CRLF', '<ul><li>a</li><li><br></li></ul>', '* a\r\n* \r\n', 'li:last-child', 7, '* a\r\n', 3],
    ['ordered', '<ol><li>a</li><li><br></li></ol>', '1. a\n2. \n', 'li:last-child', 8, '1. a\n', 4],
    ['quoted list', '<blockquote><ul><li>a</li><li><br></li></ul></blockquote>', '> * a\n> * \n', 'li:last-child', 10, '> * a\n', 5]
  ])('maps and removes the parser-owned empty $0 row', (
    _description, markup, source, selector, expectedOffset, expectedSource, expectedCaret
  ) => {
    const surface = editor(markup);
    const target = surface.querySelector(selector);
    if (!(target instanceof HTMLElement)) {
      throw new Error('visual-empty-row-target-missing');
    }
    placeCaret(target, 0);
    const baseline = serializeVisualMarkdown(surface);
    const selection = visualEmptyStructuralBodySelection(surface, source, baseline);
    expect(selection).toMatchObject({ sourceOffset: expectedOffset });
    expect(visualSelectionSourceRange(surface, source, baseline)).toEqual({
      direction: 'none', end: expectedOffset, start: expectedOffset
    });
    const removal = structuralEmptyLineRemoval(source, expectedOffset);
    expect(removal).not.toBeNull();
    if (!removal) throw new Error('visual-empty-row-removal-missing');
    expect(source.slice(0, removal.start) + source.slice(removal.end)).toBe(expectedSource);
    expect(removal.caret).toBe(expectedCaret);
  });

  it('rejects a selection marker in the source of an empty structural body', () => {
    const surface = editor('<ul><li>a</li><li><br></li></ul>');
    const target = surface.querySelector('li:last-child');
    if (!(target instanceof HTMLElement)) throw new Error('visual-empty-row-target-missing');
    placeCaret(target, 0);
    const baseline = serializeVisualMarkdown(surface);
    const source = '- a\n- \n\uE000\uE001\uE002\uE003';
    expect(() => visualEmptyStructuralBodySelection(surface, source, baseline))
      .toThrow('visual-editor-selection-marker-conflict');
    expect(() => visualSelectionSourceRange(surface, source, baseline))
      .toThrow('visual-editor-selection-marker-conflict');
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

describe('structuralEmptyLineRemoval', () => {
  it('removes a middle empty item row and keeps the caret on the previous row end', () => {
    expect(
      structuralEmptyLineRemoval('* alpha\n* \n* gamma\n', 10)
    ).toEqual({ caret: 7, end: 11, start: 8 });
  });

  it('removes a first empty item row and keeps the caret on the retained body', () => {
    expect(
      structuralEmptyLineRemoval('* \n* beta\n', 2)
    ).toEqual({ caret: 2, end: 3, start: 0 });
  });

  it('removes a last empty item row and keeps the caret on the previous row end', () => {
    expect(
      structuralEmptyLineRemoval('* alpha\n* \n', 10)
    ).toEqual({ caret: 7, end: 11, start: 8 });
  });

  it('removes a task row whose body holds only the task glyph', () => {
    expect(
      structuralEmptyLineRemoval('* [x] alpha\n* [x] \n* [x] gamma\n', 14)
    ).toEqual({ caret: 11, end: 19, start: 12 });
  });

  it('removes a sole empty item row and anchors the caret at the document start', () => {
    expect(structuralEmptyLineRemoval('* \n', 2))
      .toEqual({ caret: 0, end: 3, start: 0 });
  });

  it('refuses a body caret whose line still carries text', () => {
    expect(structuralEmptyLineRemoval('* alpha\n* beta\n', 10)).toBeNull();
  });

  it('refuses an offset that is not the line body boundary', () => {
    expect(structuralEmptyLineRemoval('* alpha\n* \n', 9)).toBeNull();
  });

  it('refuses a structural-looking line inside a fenced code body', () => {
    expect(
      structuralEmptyLineRemoval('```\n* \n```\n', 5)
    ).toBeNull();
  });

  it.each([
    ['after a heading at the document end', '## H\n\n* [x] \n\n', 12, { caret: 4, end: 13, start: 5 }],
    ['between two blocks', '## H\n\n* [x] \n\nPara\n', 12, { caret: 4, end: 13, start: 5 }],
    ['at the document start', '* [x] \n\nAfter\n', 6, { caret: 0, end: 8, start: 0 }]
  ] as const)('removes the sole row of its block with one blank separator %s', (_shape, source, offset, removal) => {
    expect(structuralEmptyLineRemoval(source, offset)).toEqual(removal);
  });

  it('removes an empty item inside a blockquote with its quote marker row', () => {
    expect(
      structuralEmptyLineRemoval('> * alpha\n> * \n> * gamma\n', 14)
    ).toEqual({ caret: 9, end: 15, start: 10 });
  });
});

describe('visualEmptiedTerminalRow', () => {
  it('names the emptied heading row a terminal block still occupies', () => {
    expect(visualEmptiedTerminalRow('Para\n\nBody.\n\n## \n\n'))
      .toEqual({ blockKind: 'ATXHeading2', end: 16, start: 13 });
  });

  it('names the terminal run, never an earlier identical marker run', () => {
    const source = 'Para\n\n## 22. Ref\n\nBody.\n\n## \n\n';
    const row = visualEmptiedTerminalRow(source);
    expect(row).toEqual({ blockKind: 'ATXHeading2', end: 28, start: 25 });
    expect(row && source.slice(row.start, row.end)).toBe('## ');
    expect(row?.start).toBe(source.lastIndexOf('## '));
    expect(row?.start).toBeGreaterThan(source.indexOf('## 22.'));
  });

  it.each([
    ['a list item', 'Para\n\n- \n', { blockKind: 'BulletList', end: 8, start: 6 }],
    ['a task item', 'Para\n\n- [x] \n', { blockKind: 'BulletList', end: 12, start: 6 }],
    ['a quote', 'Para\n\n> \n', { blockKind: 'Blockquote', end: 8, start: 6 }],
    ['an ordered item', 'Para\n\n1. \n', { blockKind: 'OrderedList', end: 9, start: 6 }],
    ['a marker without its separator', 'Para\n\n##\n', { blockKind: 'ATXHeading2', end: 8, start: 6 }],
    ['a row behind blank lines', 'Para\n\n## \n\n\n', { blockKind: 'ATXHeading2', end: 9, start: 6 }]
  ] as const)('names the emptied %s row', (_shape, source, row) => {
    expect(visualEmptiedTerminalRow(source)).toEqual(row);
  });

  it.each([
    ['a heading that carries text', 'Para\n\n## 22. Ref\n\n'],
    ['a task item that carries text', 'Para\n\n- [x] A\n'],
    ['a paragraph', 'Para\n\nBody.\n'],
    ['a thematic break', 'Para\n\n---\n\n'],
    ['an HTML block', 'Para\n\n<div>x</div>\n'],
    ['a fence opener', 'Para\n\n```\n'],
    ['a table row', 'Para\n\n| a | b |\n'],
    ['a document of blank rows', '\n\n']
  ] as const)('refuses %s', (_shape, source) => {
    expect(visualEmptiedTerminalRow(source)).toBeNull();
  });
});

describe('visualBlockShortcutRewriteTarget', () => {
  const backspace = (): KeyboardEvent =>
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('names the emptied heading a Backspace is about to discard', () => {
    const surface = editor('<h2><br></h2>');
    const heading = surface.querySelector('h2');
    if (!(heading instanceof HTMLElement)) throw new Error('emptied-heading-missing');
    placeCaret(heading, 0);
    expect(visualBlockShortcutRewriteTarget(surface, backspace())).toBe(heading);
    expect(visualBlockShortcutRewritesEmptyBlock(surface, backspace())).toBe(true);
  });

  it('names no block when the caret sits in a paragraph', () => {
    const surface = editor('<p>Body.</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('paragraph-text-missing');
    placeCaret(text, text.length);
    expect(visualBlockShortcutRewriteTarget(surface, backspace())).toBeNull();
    expect(visualBlockShortcutRewritesEmptyBlock(surface, backspace())).toBe(false);
  });
});

describe('emptied task item after respelled rows', () => {
  // The real Preview of a rule, a numbered heading and a task list. The
  // serializer respells all of them (`---` as `* * *`, `25.` as `25\.`, `*` as
  // `-` with a doubled renderer separator), so no line before the emptied row
  // is literal unchanged text an anchor could use.
  const markup = '<hr>\n<h2 id="25-t">25. T</h2>\n<ul class="task-list">\n<li class="task-list-item"><input checked disabled type="checkbox"> A</li>\n<li class="task-list-item"><input checked disabled type="checkbox"> B</li>\n</ul>\n';
  const source = '---\n\n## 25. T\n\n* [x] A\n* [x] \n\n';

  it('maps the emptied body onto its own row', () => {
    const surface = editor(markup);
    prepareVisualTaskListMarkers(surface);
    const text = surface.querySelectorAll('li')[1]?.lastChild;
    if (!(text instanceof Text) || ' B' !== text.data) {
      throw new Error('visual-respelled-task-body-missing');
    }
    // The owner's baseline is its committed serialization with the deletion
    // of B applied; Chromium then keeps the separator as NBSP.
    const committed = serializeVisualMarkdown(surface);
    expect(committed.endsWith('- [x]  A\n- [x]  B')).toBe(true);
    const baseline = committed.slice(0, -1);
    text.data = ' ';
    placeCaret(text, 1);

    const selection = visualEmptyStructuralBodySelection(surface, source, baseline);
    expect(selection && 'failure' in selection ? selection.failure : null).toBeNull();
    if (!selection || 'failure' in selection) {
      throw new Error('visual-respelled-task-selection-missing');
    }
    const removal = structuralEmptyLineRemoval(source, selection.sourceOffset);
    if (!removal) throw new Error('visual-respelled-task-removal-missing');
    expect(source.slice(0, removal.start) + source.slice(removal.end))
      .toBe('---\n\n## 25. T\n\n* [x] A\n\n');
    expect(removal.caret).toBe(source.indexOf('* [x] A') + '* [x] A'.length);
    surface.remove();
  });
});

describe('emptied structural rows spelled without their separator', () => {
  // The serializer trims the separator that trails an empty structural body, so
  // a row emptied in the visual editor reaches the canonical source as a bare
  // marker (`* a\n* b\n*`). The row the caret owns must still be nameable, and
  // only it: a bare marker sitting on another row of the run is not the row the
  // caret reads.
  const selectionAt = (
    markup: string,
    selector: string,
    source: string
  ): VisualEmptyStructuralBodySelectionResult => {
    const surface = editor(markup);
    const body = surface.querySelector(selector);
    if (!(body instanceof HTMLElement)) {
      throw new Error('visual-bare-marker-body-missing');
    }
    placeCaret(body, 0);
    const selection = visualEmptyStructuralBodySelection(
      surface,
      source,
      serializeVisualMarkdown(surface)
    );
    surface.remove();
    return selection;
  };
  const namedOffset = (selection: VisualEmptyStructuralBodySelectionResult): number => {
    if (!selection || 'failure' in selection) {
      throw new Error(selection?.failure ?? 'visual-bare-marker-selection-missing');
    }
    return selection.sourceOffset;
  };

  it.each([
    [
      'the last row of a list',
      '<ul>\n<li>a</li>\n<li>b</li>\n<li><br></li>\n</ul>\n',
      'li:last-of-type',
      '* a\n* b\n*\n',
      9
    ],
    [
      'the sole row of a list',
      '<ul>\n<li><br></li>\n</ul>\n',
      'li',
      '*\n',
      1
    ],
    [
      'an emptied middle row',
      '<ul>\n<li>a</li>\n<li><br></li>\n<li>c</li>\n</ul>\n',
      'li:nth-of-type(2)',
      '* a\n*\n* c\n',
      5
    ],
    [
      'the last row of a task list',
      '<ul>\n<li>a</li>\n<li>b</li>\n<li><br></li>\n</ul>\n',
      'li:last-of-type',
      '* [x] a\n* [x] b\n* [x]\n',
      18
    ],
    [
      'an emptied nested row',
      '<ul>\n<li>o</li>\n<li><ul>\n<li>i</li>\n<li><br></li>\n</ul></li>\n</ul>\n',
      'ul ul li:last-of-type',
      '- o\n  - i\n  -\n',
      13
    ]
  ])('names %s', (_label, markup, selector, source, expected) => {
    expect(namedOffset(selectionAt(markup, selector, source))).toBe(expected);
  });

  it('names the emptied row of a run bounded by fenced blocks', () => {
    // Regression cover for the run's edges, not proof that the two ordinal
    // spaces coincide: a fence is a code line, so both window guards — the
    // baseline's `hasOnlyStructuralMarkdownLines` and the source's
    // `hasOnlyStructuralSourceLines` — refuse it inside a run, and the run ends
    // at the fence on both sides.
    const source = '```\nbefore\n```\n\n* a\n* b\n*\n\n```\nafter\n```\n';
    const bareRow = source.indexOf('* b\n') + '* b\n'.length;
    expect(source.slice(bareRow, bareRow + 1)).toBe('*');
    const offset = namedOffset(selectionAt(
      '<pre><code>before</code></pre>\n<ul>\n<li>a</li>\n<li>b</li>\n'
      + '<li><br></li>\n</ul>\n<pre><code>after</code></pre>\n',
      'li:last-of-type',
      source
    ));
    expect(offset).toBe(bareRow + 1);
    expect(offset).toBeGreaterThan(source.indexOf('before'));
    expect(offset).toBeLessThan(source.indexOf('```\nafter'));
  });

  it.each([
    ['a blank line after the first row', '* a\n\n* b\n*'],
    ['a blank line before the emptied row', '* a\n* b\n\n*']
  ])('never names another row when the run has %s', (_label, source) => {
    // The serializer writes the tight form, so a loose list's blank line is a
    // source row the baseline does not have, the two windows stop holding the
    // same number of rows, and their ordinals no longer address the same row.
    // Naming the caret's own emptied row and refusing are both correct
    // outcomes; naming any other row is not — `structuralEmptyLineRemoval`
    // would delete that other line.
    const selection = selectionAt(
      '<ul>\n<li>a</li>\n<li>b</li>\n<li><br></li>\n</ul>\n',
      'li:last-of-type',
      source
    );
    if (selection && 'failure' in selection) return;
    expect(namedOffset(selection)).toBe(source.lastIndexOf('*') + 1);
  });

  it('removes the emptied terminal row from the canonical source', () => {
    const source = '* a\n* b\n*\n';
    const sourceOffset = namedOffset(selectionAt(
      '<ul>\n<li>a</li>\n<li>b</li>\n<li><br></li>\n</ul>\n',
      'li:last-of-type',
      source
    ));
    expect(structuralEmptyLineRemoval(source, sourceOffset))
      .toEqual({ caret: 7, end: 10, start: 8 });
  });

  it('does not adopt a bare marker that sits on another row of the run', () => {
    const selection = selectionAt(
      '<ul>\n<li>a</li>\n<li><br></li>\n<li>c</li>\n</ul>\n',
      'li:nth-of-type(2)',
      '* a\n* c\n*\n'
    );
    expect(selection && 'failure' in selection ? selection.failure : null)
      .toBe('visual-editor-markdown-merge-failed');
  });
});

describe('renderer-spelled empty structural rows', () => {
  const mounted = (html: string): HTMLElement => {
    const editor = document.createElement('article');
    editor.innerHTML = html;
    document.body.append(editor);
    return editor;
  };
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ['list', '<ul><li>a</li><li><br></li></ul>', '* a\n* \n', 6],
    ['quoted list', '<blockquote><ul><li>a</li><li><br></li></ul></blockquote>', '> * a\n> * \n', 10],
    ['CRLF list', '<ul><li>a</li><li><br></li></ul>', '* a\r\n* \r\n', 7]
  ])('maps an accepted detached %s endpoint to its empty body', (_label, html, source, offset) => {
    const fragment = document.createElement('article');
    fragment.innerHTML = html;
    const block = fragment.firstElementChild;
    if (!(block instanceof HTMLElement)) throw new Error('visual-endpoint-block-missing');
    const target = block.querySelector('li:last-child');
    if (!(target instanceof HTMLElement)) throw new Error('visual-empty-row-target-missing');
    const baseline = serializeVisualMarkdownBlockFragment([block]);
    expect(visualCaretBoundaryFromSourceOffset(block, source, baseline, offset, true, {
      acceptedEndpointBlock: true
    })).toEqual({ node: target, offset: 0 });
  });

  it('rejects an unauthenticated detached empty body endpoint', () => {
    const block = document.createElement('ul');
    block.innerHTML = '<li>a</li><li><br></li>';
    const baseline = serializeVisualMarkdownBlockFragment([block]);
    expect(() => visualCaretBoundaryFromSourceOffset(block, '* a\n* \n', baseline, 6))
      .toThrow('visual-editor-selection-map-failed');
  });

  it('rejects a foreign baseline for an accepted detached endpoint', () => {
    const block = document.createElement('ul');
    block.innerHTML = '<li>a</li><li><br></li>';
    expect(() => visualCaretBoundaryFromSourceOffset(block, '* a\n* \n', '- other\n-', 6, true, {
      acceptedEndpointBlock: true
    })).toThrow('visual-editor-selection-map-failed');
  });

  it('rejects ambiguous source owners for an accepted detached endpoint', () => {
    const block = document.createElement('blockquote');
    block.innerHTML = '<p><br></p><blockquote><p><br></p><blockquote><p>deep</p></blockquote></blockquote>';
    const baseline = serializeVisualMarkdownBlockFragment([block]);
    const source = '> \n\n> > \n> > \n> >\n> > > deep\n';
    expect(() => visualCaretBoundaryFromSourceOffset(block, source, baseline, 8, true, {
      acceptedEndpointBlock: true
    })).toThrow('visual-editor-markdown-merge-ambiguous');
  });

  it.each([
    ['read-only body', '<li contenteditable="false"><br></li>'],
    ['code body', '<li><code><br></code></li>']
  ])('rejects an accepted detached endpoint in a %s', (_label, tail) => {
    const block = document.createElement('ul');
    block.innerHTML = `<li>a</li>${tail}`;
    const baseline = serializeVisualMarkdownBlockFragment([block]);
    expect(() => visualCaretBoundaryFromSourceOffset(block, '* a\n* \n', baseline, 6, true, {
      acceptedEndpointBlock: true
    })).toThrow('visual-editor-selection-map-failed');
  });

  it.each([
    ['a list with a hard-wrapped trailing row', '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n', '* a\n* b\n'],
    ['a longer list', '<ul>\n<li>aa</li>\n<li>bb</li>\n<li>cc</li>\n</ul>\n', '- aa\n- bb\n- cc\n'],
    ['an ordered list', '<ol>\n<li>a</li>\n<li>b</li>\n</ol>\n', '1. a\n2. b\n'],
    ['a quoted list', '<blockquote>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n</blockquote>\n', '> * a\n> * b\n']
  ])('maps every row end of %s past the renderer formatting whitespace', (_shape, html, source) => {
    const editor = mounted(html);
    const items = Array.from(editor.querySelectorAll('li'));
    const visual = serializeVisualMarkdown(editor);
    const lines = source.trimEnd().split('\n');
    let offset = 0;
    lines.forEach((line, index) => {
      offset += line.length;
      const boundary = visualCaretBoundaryFromSourceOffset(editor, source, visual, offset);
      expect(items[index]?.contains(boundary.node)).toBe(true);
      offset += 1;
    });
  });

  it.each([
    ['nested unordered', '<ul>\n<li>outer\n<ul>\n<li>a</li>\n</ul>\n</li>\n</ul>', '- outer\n  - a\n', 13, 'ul > li > ul > li'],
    ['nested unordered CRLF', '<ul>\n<li>outer\n<ul>\n<li>a</li>\n</ul>\n</li>\n</ul>', '- outer\r\n  - a\r\n', 14, 'ul > li > ul > li'],
    ['quoted ordered', '<blockquote>\n<ul>\n<li>outer\n<ol>\n<li>a</li>\n</ol>\n</li>\n</ul>\n</blockquote>', '> - outer\n>   1. a\n', 18, 'blockquote > ul > li > ol > li']
  ])('restores the source row end inside its $0 body', (_description, html, source, offset, selector) => {
    const surface = mounted(html);
    const target = surface.querySelector(selector);
    if (!(target instanceof HTMLElement)) throw new Error('visual-nested-row-target-missing');
    const boundary = visualCaretBoundaryFromSourceOffset(
      surface, source, serializeVisualMarkdown(surface), offset
    );
    const owner = boundary.node instanceof Element ? boundary.node : boundary.node.parentElement;
    expect(owner?.closest('li, p')).toBe(target);
    const prefix = document.createRange();
    prefix.selectNodeContents(target);
    prefix.setEnd(boundary.node, boundary.offset);
    expect(prefix.toString()).toBe('a');
  });

  it.each([
    ['ordered list', '<ol><li>a</li><li>b</li></ol>', '1. a\n2. b\n']
  ])('restores a nonempty row in a detached %s root', (_description, html, source) => {
    const fragment = document.createElement('article');
    fragment.innerHTML = html;
    const block = fragment.firstElementChild;
    if (!(block instanceof HTMLElement)) throw new Error('visual-endpoint-block-missing');
    const target = block.querySelector('li:last-child');
    if (!(target instanceof HTMLElement)) throw new Error('visual-row-target-missing');
    const boundary = visualCaretBoundaryFromSourceOffset(
      block, source, serializeVisualMarkdownBlockFragment([block]), source.indexOf('b') + 1
    );
    const owner = boundary.node instanceof Element ? boundary.node : boundary.node.parentElement;
    expect(owner?.closest('li, p')).toBe(target);
    const prefix = document.createRange();
    prefix.selectNodeContents(target);
    prefix.setEnd(boundary.node, boundary.offset);
    expect(prefix.toString()).toBe('b');
  });

  it('restores a quoted row in its detached neutral endpoint container', () => {
    const fragment = document.createElement('article');
    fragment.innerHTML = '<blockquote><ul><li>a</li><li>b</li></ul></blockquote>';
    const block = fragment.firstElementChild;
    const target = block?.querySelector('li:last-child');
    if (!(block instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error('visual-quoted-endpoint-target-missing');
    }
    const source = '> * a\n> * b\n';
    const baseline = serializeVisualMarkdownBlockFragment([block]);
    const offset = source.indexOf('b') + 1;
    expect(() => visualCaretBoundaryFromSourceOffset(block, source, baseline, offset))
      .toThrow('visual-editor-selection-map-failed');
    expect(() => visualCaretBoundaryFromSourceOffset(block, source, baseline, offset, true, {
      acceptedEndpointBlock: true
    })).toThrow('visual-editor-selection-map-failed');
    const boundary = visualCaretBoundaryFromSourceOffset(fragment, source, baseline, offset, true, {
      acceptedEndpointBlock: true
    });
    expect(block.contains(boundary.node)).toBe(true);
    const owner = boundary.node instanceof Element ? boundary.node : boundary.node.parentElement;
    expect(owner?.closest('li, p')).toBe(target);
    const prefix = document.createRange();
    prefix.selectNodeContents(target);
    prefix.setEnd(boundary.node, boundary.offset);
    expect(prefix.toString()).toBe('b');
  });

  it.each([
    ['a marker-only last row', '<ul>\n<li>a</li>\n<li>\n</li></ul>\n', '- a\n-'],
    ['a marker-only middle row', '<ul>\n<li>a</li>\n<li>\n</li><li>c</li>\n</ul>\n', '- a\n- \n- c'],
    ['a sole marker-only row', '<ul>\n<li>\n</li></ul>\n', '-'],
    ['a quoted marker-only row', '<blockquote>\n<ul>\n<li>a</li>\n<li>\n</li></ul>\n</blockquote>\n', '> - a\n> -'],
    ['an emptied last row', '<ul>\n<li>a</li>\n<li><br></li>\n</ul>\n', '- a\n-'],
    ['an emptied middle row', '<ul>\n<li>a</li>\n<li><br></li>\n<li>c</li>\n</ul>\n', '- a\n- \n- c'],
    ['an emptied quoted row', '<blockquote>\n<ul>\n<li>a</li>\n<li><br></li>\n</ul>\n</blockquote>\n', '> - a\n> -'],
    ['a text row keeping the native placeholder', '<ul>\n<li>a<br></li>\n<li>c</li>\n</ul>\n', '- a\n- c'],
    ['an empty heading', '<p>plain</p>\n<h2></h2>\n', 'plain\n\n##'],
    ['an empty quote', '<p>plain</p>\n<blockquote>\n</blockquote>\n', 'plain\n\n>']
  ])('serializes %s by its marker alone', (_shape, html, expected) => {
    expect(serializeVisualMarkdown(mounted(html))).toBe(expected);
  });

  it.each([
    ['<ul>\n<li>\n</li></ul>\n', 'li'],
    ['<ul>\n<li>a</li>\n<li>\n</li><li>c</li>\n</ul>\n', 'li:nth-child(2)'],
    ['<h2></h2>\n', 'h2'],
    ['<blockquote>\n</blockquote>\n', 'blockquote > p']
  ])('gives %s the caret host Chromium leaves after emptying it', (html, bodySelector) => {
    const editor = mounted(html);
    const before = serializeVisualMarkdown(editor);
    prepareVisualEmptyStructuralBodies(editor);
    const body = editor.querySelector(bodySelector);
    expect(body?.childNodes.length).toBe(1);
    expect(body?.firstChild).toBeInstanceOf(HTMLBRElement);
    expect(serializeVisualMarkdown(editor)).toBe(before);
  });

  it.each([
    ['text', '<ul>\n<li>a</li>\n</ul>\n'],
    ['a nested list', '<ul>\n<li>\n<ul>\n<li>x</li>\n</ul>\n</li>\n</ul>\n'],
    ['a quoted paragraph', '<blockquote>\n<p>x</p>\n</blockquote>\n'],
    ['an image', '<ul>\n<li><img src="a.png" alt="a"></li>\n</ul>\n'],
    ['a read-only row', '<div class="easymde-toc"><ul>\n<li>\n</li></ul></div>\n']
  ])('leaves a body holding %s untouched', (_shape, html) => {
    const editor = mounted(html);
    const before = editor.innerHTML;
    prepareVisualEmptyStructuralBodies(editor);
    expect(editor.innerHTML).toBe(before);
  });

  it.each([
    ['preformatted content', '<pre><ul><li> </li></ul></pre>', 'li'],
    ['code content', '<code><ul><li> </li></ul></code>', 'li'],
    ['noneditable ancestor', '<div contenteditable="false"><ul><li> </li></ul></div>', 'li'],
    ['noneditable body', '<ul><li contenteditable="false"> </li></ul>', 'li'],
    ['noneditable quote', '<div contenteditable="false"><blockquote> </blockquote></div>', 'blockquote'],
    ['generated math', '<div class="easymde-math" data-easymde-rendered><ul><li> </li></ul></div>', 'li'],
    ['generated mermaid', '<div class="easymde-mermaid"><blockquote> </blockquote></div>', 'blockquote'],
    ['generated footnotes', '<div class="footnotes"><ul><li> </li></ul></div>', 'li']
  ])('does not prepare an empty body inside %s', (_description, html, selector) => {
    const surface = mounted(html);
    const body = surface.querySelector(selector);
    if (!(body instanceof HTMLElement)) throw new Error('visual-protected-body-missing');
    const child = body.firstChild;
    const before = surface.innerHTML;
    prepareVisualEmptyStructuralBodies(surface);
    expect(surface.innerHTML).toBe(before);
    expect(body.firstChild).toBe(child);
  });

  it.each([
    ['a sole row', '<ul>\n<li>\n</li></ul>\n', '- \n', 2, 'li'],
    ['a last row', '<ul>\n<li>a</li>\n<li>\n</li></ul>\n', '* a\n* \n', 6, 'li:nth-child(2)'],
    ['a CRLF last row', '<ul>\n<li>a</li>\n<li>\n</li></ul>\n', '* a\r\n* \r\n', 7, 'li:nth-child(2)'],
    ['a middle row', '<ul>\n<li>a</li>\n<li>\n</li><li>c</li>\n</ul>\n', '* a\n* \n* c\n', 6, 'li:nth-child(2)'],
    ['a middle row with extra spaces', '<ul>\n<li>a</li>\n<li>\n</li><li>c</li>\n</ul>\n', '- a\n-   \n- c\n', 6, 'li:nth-child(2)'],
    ['a CRLF middle row with extra spaces', '<ul>\n<li>a</li>\n<li>\n</li><li>c</li>\n</ul>\n', '- a\r\n-   \r\n- c\r\n', 7, 'li:nth-child(2)'],
    ['an ordered row', '<ol>\n<li>a</li>\n<li>\n</li></ol>\n', '1. a\n2. \n', 8, 'li:nth-child(2)'],
    ['a quoted row', '<blockquote>\n<ul>\n<li>a</li>\n<li>\n</li></ul>\n</blockquote>\n', '> * a\n> * \n', 10, 'li:nth-child(2)'],
    ['a CRLF quoted row', '<blockquote>\n<ul>\n<li>a</li>\n<li>\n</li></ul>\n</blockquote>\n', '> * a\r\n> * \r\n', 11, 'li:nth-child(2)'],
    ['a row beside a hidden reference', '<ul>\n<li>a</li>\n<li>\n</li></ul>\n', '* a\n* \n\n[ref]: /target\n', 6, 'li:nth-child(2)'],
    ['a heading', '<p>plain</p>\n<h2></h2>\n', 'plain\n\n## \n', 10, 'h2'],
    ['a quote', '<p>plain</p>\n<blockquote>\n</blockquote>\n', 'plain\n\n> \n', 9, 'blockquote > p']
  ])('places a source caret on %s into its prepared body', (_shape, html, source, offset, bodySelector) => {
    const editor = mounted(html);
    prepareVisualEmptyStructuralBodies(editor);
    const body = editor.querySelector(bodySelector);
    const boundary = visualCaretBoundaryFromSourceOffset(
      editor,
      source,
      serializeVisualMarkdown(editor),
      offset
    );
    expect(boundary.node).toBe(body);
  });

  it('preserves the hidden reference when removing its preceding empty row', () => {
    const surface = mounted('<ul>\n<li>a</li>\n<li>\n</li></ul>\n');
    prepareVisualEmptyStructuralBodies(surface);
    const body = surface.querySelector('li:nth-child(2)');
    if (!(body instanceof HTMLElement)) throw new Error('visual-empty-row-target-missing');
    const source = '* a\n* \n\n[ref]: /target\n';
    const baseline = serializeVisualMarkdown(surface);
    const boundary = visualCaretBoundaryFromSourceOffset(surface, source, baseline, 6);
    expect(boundary).toEqual({ node: body, offset: 0 });
    placeCaret(body, 0);
    expect(visualEmptyStructuralBodySelection(surface, source, baseline))
      .toMatchObject({ sourceOffset: 6 });
    const removal = structuralEmptyLineRemoval(source, 6);
    expect(removal).toEqual({ start: 4, end: 7, caret: 3 });
    if (!removal) throw new Error('visual-empty-row-removal-missing');
    const edited = source.slice(0, removal.start) + source.slice(removal.end);
    expect(edited).toBe('* a\n\n[ref]: /target\n');
    expect(edited.slice(0, removal.start) + source.slice(removal.start, removal.end)
      + edited.slice(removal.start)).toBe(source);
  });

  it.each([
    ['paragraph', 'ordinary paragraph'],
    ['fenced code', '```\n[ref]: /target\n```'],
    ['inline reference-looking text', 'text [ref]: /target']
  ])('rejects an unrendered %s after an empty structural row', (_label, tail) => {
    const surface = mounted('<ul>\n<li>a</li>\n<li>\n</li></ul>\n');
    prepareVisualEmptyStructuralBodies(surface);
    const source = `* a\n* \n\n${tail}\n`;
    expect(() => visualCaretBoundaryFromSourceOffset(
      surface, source, serializeVisualMarkdown(surface), 6
    )).toThrow('visual-editor-markdown-merge-failed');
  });
});

describe('a paragraph line that begins with an insignificant space', () => {
  // The live DOM spells the line's leading space as NBSP, and the caret proof
  // serializes the paragraph alone: the serializer trims its whole output, so
  // the unmarked spelling of that one block drops the column while the marker
  // keeps it. The proof then has to read the block's spelling as the document
  // writes it, or the caret at the paragraph's first offset is refused as
  // visual-editor-selection-map-failed.
  const source = '~~~js\nalpha\n~~~\n\n the fence.\n';
  const html = '<pre><code class="language-js">alpha\n</code></pre>'
    + '<p>\u00a0the fence.</p>';

  it('proves the caret before the column rather than past it', () => {
    const surface = editor(html);
    const paragraph = surface.lastElementChild;
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-paragraph-body-missing');
    const baseline = serializeVisualMarkdown(surface);
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    const lineStart = source.lastIndexOf('\n\n') + 2;
    // A character-wise Backspace here deletes the blank line's newline, so the
    // boundary is the paragraph line's own start, not the offset after the
    // space the renderer dropped.
    expect(mapTextBoundaryFromInterval(surface, text, 0, baseline, interval))
      .toMatchObject({ sourceOffset: lineStart });
    expect(mapTextBoundaryFromInterval(surface, text, 1, baseline, interval))
      .toMatchObject({ sourceOffset: lineStart + 1 });
  });
});

describe('the declared block-leading run', () => {
  const declared = (source: string, html: string) => {
    const surface = editor(html);
    const map = createVisualMarkdownSourceIntervalMap(
      source,
      serializeVisualMarkdown(surface)
    );
    return {
      map,
      runs: declaredBlockLeadingRuns(source, map),
      surface
    };
  };

  it('admits a dropped leading space followed by its line content', () => {
    // The map owns the source's dropped space, the line ending precedes it and
    // the line's own first character follows it, so the document declares it.
    const source = '## Heading\n\n the fence.\n';
    const { map, runs } = declared(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    expect(runs).toEqual([{ end: 13, start: 12 }]);
    expect(isDeclaredBlockLeadingRun(source, map, 12, 13)).toBe(true);
    expect(map.hiddenSourceRanges).toContainEqual({ end: 13, start: 12 });
  });

  it('refuses an indented code line, whose owned range is the whole line', () => {
    // The serializer re-spells the indented block as a fenced one, so the
    // alignment owns the line's text rather than its four spaces and the run
    // clause fails on the owned bytes. A declaration read off source line
    // starts would admit this line as a leading column.
    const source = 'Intro.\n\n    code line.\n\nTail.\n';
    const { map, runs } = declared(
      source,
      '<p>Intro.</p><pre><code>code line.\n</code></pre><p>Tail.</p>'
    );
    expect(runs).toEqual([]);
    const owned = map.hiddenSourceRanges.find(({ start }) => start === 8);
    expect(owned).toBeDefined();
    // Asked at its own offsets, the run of the same shape still answers no.
    expect(isDeclaredBlockLeadingRun(source, map, 8, owned?.end ?? -1)).toBe(false);
  });

  it('refuses a whitespace-only line, whose owned range carries its ending', () => {
    const source = 'Alpha.\n\n \nBravo.\n';
    const { runs } = declared(
      source,
      '<p>Alpha.</p><p>Bravo.</p>'
    );
    expect(runs).toEqual([]);
  });

  it('refuses a run at the document start', () => {
    // Owned and spelled as a column, but nothing precedes it, so it is not a
    // line's leading run and the document-leading offset stays unexplained.
    const source = ' lead.\n\nTail.\n';
    const { map, runs } = declared(
      source,
      '<p>lead.</p><p>Tail.</p>'
    );
    expect(runs).toEqual([]);
    expect(isDeclaredBlockLeadingRun(source, map, 0, 1)).toBe(false);
    expect(map.hiddenSourceRanges).toContainEqual({ end: 1, start: 0 });
  });

  it('refuses a real source non-breaking space as content', () => {
    const source = '## Heading\n\n\u00a0the fence.\n';
    const { map, runs } = declared(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    expect(runs).toEqual([]);
    expect(isDeclaredBlockLeadingRun(source, map, 12, 13)).toBe(false);
    expect(map.hiddenSourceRanges).toContainEqual({ end: 13, start: 12 });
  });

  it('refuses a document with no leading run at all', () => {
    const source = '## Heading\n\nthe fence.\n';
    const { runs } = declared(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    expect(runs).toEqual([]);
  });

  it('answers the per-run question for each of two leading runs', () => {
    // Two leading-space paragraph lines are an ordinary document, and the
    // project's full-capability example is exactly the kind of file that holds
    // more than one run of this shape. A document-wide answer would switch the
    // rule off in such a file, so each run is asked about on its own and
    // answered on its own.
    const source = '## Heading\n\n one\n\n two\n';
    const { map, runs } = declared(
      source,
      '<h2>Heading</h2><p>one</p><p>two</p>'
    );
    expect(runs).toEqual([
      { end: 13, start: 12 },
      { end: 19, start: 18 }
    ]);
    expect(isDeclaredBlockLeadingRun(source, map, 12, 13)).toBe(true);
    expect(isDeclaredBlockLeadingRun(source, map, 18, 19)).toBe(true);
  });

  it('refuses the same shape asked at an offset the document does not own', () => {
    // The question is about one run, so a caller holding the wrong bytes gets
    // no. The document declares [12,13) and nothing else: sliding the range by
    // one either way, asking for the whole line, asking for the empty range at
    // the run's start, and asking at the document start all refuse.
    const source = '## Heading\n\n the fence.\n';
    const { map, runs } = declared(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    expect(runs).toEqual([{ end: 13, start: 12 }]);
    const wrong = [[11, 12], [13, 14], [12, 14], [12, 12], [0, 1]] as const;
    for (const [start, end] of wrong) {
      expect(isDeclaredBlockLeadingRun(source, map, start, end)).toBe(false);
    }
    expect(isDeclaredBlockLeadingRun(source, map, 12, 13)).toBe(true);
  });
});

describe('the declared run in the correspondence layer', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // The live-DOM state the acceptance rows are about: the serializer's own
  // output for the inspected surface is the committed visual, so the baseline
  // is the surface's serialization and the hidden run is the source byte the
  // baseline does not draw.
  const correspondence = (source: string, html: string) => {
    const surface = editor(html);
    const baseline = serializeVisualMarkdown(surface);
    const map = createVisualMarkdownSourceIntervalMap(source, baseline);
    return { baseline, map, surface };
  };
  const paragraphText = (paragraph: Element): Text => {
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('declared-run-fixture-invalid');
    }
    return text;
  };
  const caretIsAtParagraphStart = (caret: Readonly<{ node: Node }>, paragraph: Element) =>
    caret.node === paragraph || caret.node.parentElement === paragraph;
  // The same visual change a Backspace at the paragraph's start makes: the line
  // ending that separates the two blocks is dropped from the visual.
  const pressBeforeParagraph = (baseline: string, paragraphAt: number): string =>
    `${baseline.slice(0, paragraphAt - 1)}${baseline.slice(paragraphAt)}`;

  it('owns a dropped leading space with no fence in front of it', () => {
    const source = '## Heading\n\n the fence.\n';
    const { baseline, map, surface } = correspondence(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    const paragraph = surface.querySelector('p');
    if (!(paragraph instanceof HTMLParagraphElement)) {
      throw new Error('declared-run-fixture-invalid');
    }
    const text = paragraphText(paragraph);
    // The state, not a coincidence: the map owns the source's space at 12 and
    // the baseline the live DOM serializes to draws the paragraph at 12.
    expect(map.hiddenSourceRanges).toContainEqual({ end: 13, start: 12 });
    expect(baseline.indexOf('the fence.')).toBe(12);
    // The caret at the paragraph's first character is the declared run's own
    // boundary, so the forward answer is the run's start, not the first
    // character after it.
    expect(mapTextBoundaryFromInterval(surface, text, 0, baseline, map))
      .toMatchObject({ sourceOffset: 12, visualOffset: 12 });
    placeCaret(text, 0);
    expect(visualSelectionSourceRange(surface, source, baseline, baseline))
      .toEqual({ direction: 'none', end: 12, start: 12 });
    const caret = visualCaretBoundaryFromSourceOffset(surface, source, baseline, 12);
    expect(caret.offset).toBe(0);
    expect(caretIsAtParagraphStart(caret, paragraph)).toBe(true);
  });

  it('resolves the press on the declared start as the blank line terminator', () => {
    const source = '## Heading\n\n the fence.\n';
    const { baseline, map } = correspondence(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    const paragraphAt = baseline.indexOf('the fence.');
    const merged = mergeVisualMarkdownChangeDetails(
      source,
      baseline,
      pressBeforeParagraph(baseline, paragraphAt),
      map
    );
    expect(merged.value).toBe('## Heading\n the fence.\n');
  });

  it('owns a dropped leading space after a closing fence', () => {
    const source = '~~~js\nalpha\n~~~\n\n the fence.\n';
    const { baseline, map, surface } = correspondence(
      source,
      '<pre><code class="language-js">alpha\n</code></pre><p>the fence.</p>'
    );
    const paragraph = surface.querySelector('p');
    if (!(paragraph instanceof HTMLParagraphElement)) {
      throw new Error('declared-run-fixture-invalid');
    }
    const text = paragraphText(paragraph);
    expect(map.hiddenSourceRanges).toContainEqual({ end: 18, start: 17 });
    expect(baseline.indexOf('the fence.')).toBe(17);
    expect(mapTextBoundaryFromInterval(surface, text, 0, baseline, map))
      .toMatchObject({ sourceOffset: 17, visualOffset: 17 });
    placeCaret(text, 0);
    expect(visualSelectionSourceRange(surface, source, baseline, baseline))
      .toEqual({ direction: 'none', end: 17, start: 17 });
    const caret = visualCaretBoundaryFromSourceOffset(surface, source, baseline, 17);
    expect(caret.offset).toBe(0);
    expect(caretIsAtParagraphStart(caret, paragraph)).toBe(true);
    const paragraphAt = baseline.indexOf('the fence.');
    const merged = mergeVisualMarkdownChangeDetails(
      source,
      baseline,
      pressBeforeParagraph(baseline, paragraphAt),
      map
    );
    expect(merged.value).toBe('~~~js\nalpha\n~~~\n the fence.\n');
  });

  it('keeps the start it already answered when the DOM spells the column', () => {
    // The state the build before this change already handled: the DOM spells
    // the dropped run as NBSP, so the baseline the serializer writes for that
    // surface draws the column. It answered the declared start then, and the
    // boundary rule must not move it.
    const source = '## Heading\n\n the fence.\n';
    const { baseline, map, surface } = correspondence(
      source,
      '<h2>Heading</h2><p>\u00a0the fence.</p>'
    );
    const paragraph = surface.querySelector('p');
    if (!(paragraph instanceof HTMLParagraphElement)) {
      throw new Error('declared-run-fixture-invalid');
    }
    const text = paragraphText(paragraph);
    expect(baseline.indexOf('\u00a0')).toBe(12);
    expect(map.hiddenSourceRanges).toContainEqual({ end: 13, start: 12 });
    expect(mapTextBoundaryFromInterval(surface, text, 0, baseline, map))
      .toMatchObject({ sourceOffset: 12 });
    placeCaret(text, 0);
    expect(visualSelectionSourceRange(surface, source, baseline, baseline))
      .toEqual({ direction: 'none', end: 12, start: 12 });
  });

  it('still refuses a hidden boundary the document does not declare', () => {
    // A real non-breaking space in the source is content, not a dropped
    // column, so the same press at the same offset stays ambiguous. This is
    // the control that keeps the excusal scoped to declared runs.
    const source = '## Heading\n\n\u00a0the fence.\n';
    const { baseline, map } = correspondence(
      source,
      '<h2>Heading</h2><p>the fence.</p>'
    );
    expect(map.hiddenSourceRanges).toContainEqual({ end: 13, start: 12 });
    expect(declaredBlockLeadingRuns(source, map)).toEqual([]);
    const insertionAt = baseline.indexOf('the fence.');
    expect(() => mergeVisualMarkdownChangeDetails(
      source,
      baseline,
      `${baseline.slice(0, insertionAt)}X${baseline.slice(insertionAt)}`,
      map
    )).toThrow('visual-editor-markdown-merge-ambiguous');
  });

  it('owns each of two declared runs independently', () => {
    const source = '## Heading\n\n one\n\n two\n';
    const { baseline, map, surface } = correspondence(
      source,
      '<h2>Heading</h2><p>one</p><p>two</p>'
    );
    const paragraphs = Array.from(surface.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(2);
    expect(declaredBlockLeadingRuns(source, map)).toEqual([
      { end: 13, start: 12 },
      { end: 19, start: 18 }
    ]);
    // Each run is asked about on its own, so the fix reaches both.
    expect(isDeclaredBlockLeadingRun(source, map, 12, 13)).toBe(true);
    expect(isDeclaredBlockLeadingRun(source, map, 18, 19)).toBe(true);
    const lineStarts = [12, 18];
    paragraphs.forEach((paragraph, index) => {
      const text = paragraphText(paragraph);
      const lineStart = lineStarts[index] ?? -1;
      expect(mapTextBoundaryFromInterval(surface, text, 0, baseline, map))
        .toMatchObject({ sourceOffset: lineStart });
      placeCaret(text, 0);
      expect(visualSelectionSourceRange(surface, source, baseline, baseline))
        .toEqual({ direction: 'none', end: lineStart, start: lineStart });
      const caret = visualCaretBoundaryFromSourceOffset(
        surface,
        source,
        baseline,
        lineStart
      );
      expect(caret.offset).toBe(0);
      expect(caretIsAtParagraphStart(caret, paragraph)).toBe(true);
    });
  });
});

describe('grapheme boundaries', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const samples = [
    'plain',
    'e\u0301x',
    '\uD83D\uDE00x',
    '\uD83C\uDDFA\uD83C\uDDF8\uD83C\uDDF7\uD83C\uDDE6!',
    '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67',
    `a${'\u0301'.repeat(100)}`
  ];
  it.each(samples)(
    'agrees with the whole-string segmentation of %j',
    (text) => {
      const starts = Array.from(segmenter.segment(text), (part) => part.index);
      expect(starts[0]).toBe(0);
      for (const [index, start] of starts.entries()) {
        if (start > 0) {
          expect(previousGraphemeBoundary(text, start)).toBe(
            starts[index - 1]
          );
        }
        if (start < text.length) {
          expect(nextGraphemeBoundary(text, start)).toBe(
            starts[index + 1] ?? text.length
          );
        }
      }
      expect(previousGraphemeBoundary(text, text.length)).toBe(starts.at(-1));
      expect(nextGraphemeBoundary(text, text.length)).toBe(text.length);
    }
  );
  it('grows past a cluster longer than its scan window', () => {
    const cluster = `a${'\u0301'.repeat(100)}`;
    const text = `x${cluster}b`;
    expect(cluster.length).toBeGreaterThan(64);
    expect(nextGraphemeBoundary(text, 0)).toBe(1);
    expect(nextGraphemeBoundary(text, 1)).toBe(1 + cluster.length);
    expect(previousGraphemeBoundary(text, 1 + cluster.length)).toBe(1);
    expect(previousGraphemeBoundary(text, text.length)).toBe(
      1 + cluster.length
    );
  });
  it('clamps at the document edges', () => {
    expect(previousGraphemeBoundary('', 0)).toBe(0);
    expect(nextGraphemeBoundary('', 0)).toBe(0);
    expect(previousGraphemeBoundary('ab', -3)).toBe(0);
    expect(previousGraphemeBoundary('ab', 9)).toBe(1);
    expect(nextGraphemeBoundary('ab', 9)).toBe(2);
  });
});

/**
 * One press projects two boundaries of the block the caret sits in: the
 * caret's own edge and the deleted edge. Both projections used to serialize
 * that block and then the whole document prefix up to it, although a character
 * deletion inside one text node is proved by the block's own spelling alone.
 * The block's fragment is now built on first use and reused within the press,
 * and the prefix is built only by a projection that reads it as a proof.
 */
describe('the block-fragment projection one press pays for', () => {
  const source = 'First paragraph.\n\nSecond paragraph here.';

  const twoParagraphs = (): Readonly<{ surface: HTMLElement; text: Text }> => {
    const surface = editor(
      '<p data-easymde-visual-block-id="b0">First paragraph.</p>'
        + '<p data-easymde-visual-block-id="b1">Second paragraph here.</p>'
    );
    const text = surface.lastElementChild?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-paragraph-body-missing');
    return { surface, text };
  };

  /**
   * How many times the markdown serializer actually ran, and what the press
   * answered. `serializeVisualMarkdown` is the one owner of the turndown call,
   * so this counts the work the fragment projections do, not the projections.
   */
  function serializedDuring<T>(run: () => T): Readonly<{ runs: number; value: T }> {
    const turndown = vi.spyOn(TurndownService.prototype, 'turndown');
    try {
      const value = run();
      return { runs: turndown.mock.calls.length, value };
    } finally {
      turndown.mockRestore();
    }
  }

  /** One projection on a surface nothing was projected on before. */
  const controlProjection = (
    offset: number,
    witness?: Readonly<{ data: string }>
  ): Readonly<{ sourceOffset: number; visualOffset: number }> | null => {
    const fresh = twoParagraphs();
    const baseline = serializeVisualMarkdown(fresh.surface);
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    return mapTextBoundaryFromInterval(
      fresh.surface,
      fresh.text,
      offset,
      baseline,
      interval,
      false,
      witness ?? { data: fresh.text.data }
    );
  };

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('serializes the owning block once for a plain in-block character deletion', () => {
    const { surface, text } = twoParagraphs();
    const baseline = serializeVisualMarkdown(surface);
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    const { runs, value } = serializedDuring(() => ({
      caret: mapTextBoundaryFromInterval(
        surface, text, text.length, baseline, interval
      ),
      deletedEdge: mapTextBoundaryFromInterval(
        surface, text, text.length - 1, baseline, interval
      )
    }));
    expect(value.caret).toEqual({ sourceOffset: 40, visualOffset: 40 });
    expect(value.deletedEdge).toEqual({ sourceOffset: 39, visualOffset: 39 });
    // The block's own spelling is serialized once and the press's second
    // projection reads it back. The prefix — the whole document up to this
    // block — is never built: this press proves its run from the block alone.
    expect(runs).toBe(1);
  });

  it('keeps the same projection for a structural press', () => {
    // A witnessed press proves the block's position through the document's own
    // prefix, which is the structural read the memo has to keep exact.
    const { surface, text } = twoParagraphs();
    const baseline = serializeVisualMarkdown(surface);
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    const witness = { data: text.data };
    const { runs, value } = serializedDuring(() => ({
      caret: mapTextBoundaryFromInterval(
        surface, text, text.length, baseline, interval, false, witness
      ),
      start: mapTextBoundaryFromInterval(
        surface, text, 0, baseline, interval, false, witness
      )
    }));
    expect(value.caret).toEqual({ sourceOffset: 40, visualOffset: 40 });
    expect(value.start).toEqual({ sourceOffset: 18, visualOffset: 18 });
    expect(value.caret).toEqual(controlProjection(text.length, witness));
    expect(value.start).toEqual(controlProjection(0, witness));
    // The block and its prefix are each serialized once for the whole press,
    // and the second projection reuses both.
    expect(runs).toBe(2);
  });

  it('still spells a block whose leading columns the trim dropped', () => {
    // The renderer keeps the paragraph's leading space as NBSP, and the block
    // serialized alone loses that column: only the prefix carries it, so the
    // block's spelling is the prefix's tail.
    const surface = editor(
      '<p data-easymde-visual-block-id="b0">First paragraph.</p>'
        + '<p data-easymde-visual-block-id="b1">\u00a0the fence.</p>'
    );
    const text = surface.lastElementChild?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-paragraph-body-missing');
    const leadingSource = 'First paragraph.\n\n the fence.';
    const baseline = serializeVisualMarkdown(surface);
    const interval = createVisualMarkdownSourceIntervalMap(leadingSource, baseline);
    const { runs, value } = serializedDuring(() => ({
      caret: mapTextBoundaryFromInterval(
        surface, text, text.length, baseline, interval
      ),
      deletedEdge: mapTextBoundaryFromInterval(
        surface, text, text.length - 1, baseline, interval
      )
    }));
    expect(value.caret).toEqual({ sourceOffset: 29, visualOffset: 29 });
    expect(value.deletedEdge).toEqual({ sourceOffset: 28, visualOffset: 28 });
    // The prefix is what this block's own spelling needs, and the press builds
    // it once.
    expect(runs).toBe(2);
  });

  it('recomputes the fragment when the block changes between presses', () => {
    const { surface, text } = twoParagraphs();
    const baseline = serializeVisualMarkdown(surface);
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    expect(
      mapTextBoundaryFromInterval(surface, text, text.length, baseline, interval)
    ).toEqual({ sourceOffset: 40, visualOffset: 40 });
    // The browser applied the deletion, so the block's own DOM moved with it.
    text.data = 'Second paragraph her!';
    const editedSource = 'First paragraph.\n\nSecond paragraph her!';
    const editedBaseline = serializeVisualMarkdown(surface);
    const editedInterval = createVisualMarkdownSourceIntervalMap(
      editedSource,
      editedBaseline
    );
    expect(
      mapTextBoundaryFromInterval(
        surface, text, text.length, editedBaseline, editedInterval
      )
    ).toEqual({ sourceOffset: 39, visualOffset: 39 });
  });

  it('recomputes the prefix when a preceding block changes', () => {
    const { surface, text } = twoParagraphs();
    const first = surface.firstElementChild?.firstChild;
    if (!(first instanceof Text)) throw new Error('visual-paragraph-body-missing');
    const baseline = serializeVisualMarkdown(surface);
    const interval = createVisualMarkdownSourceIntervalMap(source, baseline);
    const witness = { data: text.data };
    expect(
      mapTextBoundaryFromInterval(
        surface, text, text.length, baseline, interval, false, witness
      )
    ).toEqual({ sourceOffset: 40, visualOffset: 40 });
    // The caret's block is untouched, so its own fragment is still the one the
    // memo holds; the prefix that proves where that block sits is not.
    first.data = 'First paragraph, extended.';
    const grownSource = 'First paragraph, extended.\n\nSecond paragraph here.';
    const grownBaseline = serializeVisualMarkdown(surface);
    const grownInterval = createVisualMarkdownSourceIntervalMap(
      grownSource,
      grownBaseline
    );
    expect(
      mapTextBoundaryFromInterval(
        surface, text, text.length, grownBaseline, grownInterval, false, witness
      )
    ).toEqual({ sourceOffset: 50, visualOffset: 50 });
  });
});
