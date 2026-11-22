import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewEditMap } from '../../contracts/ports/preview-request';
import {
  emptiedStructuralRowRetirement,
  visualJoinRowAtCaret
} from './visual-structural-row';

function makeSurface(html: string): HTMLDivElement {
  const surface = document.createElement('div');
  surface.setAttribute('contenteditable', 'true');
  surface.innerHTML = html;
  document.body.append(surface);
  return surface;
}

function makeEditMap(
  blocks: ReadonlyArray<Readonly<{ endLine: number; id: string; startLine: number }>>
): PreviewEditMap {
  return {
    blocks: blocks.map((block) => ({
      editable: true,
      endLine: block.endLine,
      id: block.id,
      kind: 'block',
      startLine: block.startLine
    })),
    coordinate: 'line',
    signature: 'test-sig',
    version: 1
  };
}

describe('visual-structural-row', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it.each([1, 2, 3, 4, 5, 6] as const)(
    'retires quoted H%d sole child with editMap and with null/stale editMap',
    (level) => {
      const hashes = '#'.repeat(level);
      const source = `# Title\n\nLead.\n\n> ${hashes} `;
      const surface = makeSurface(
        `<h1 data-easymde-visual-block-id="b0">Title</h1>`
        + `<p data-easymde-visual-block-id="b1">Lead.</p>`
        + `<blockquote data-easymde-visual-block-id="b2"><h${level}><br></h${level}></blockquote>`
      );
      const heading = surface.querySelector(`blockquote h${level}`) as HTMLElement;
      const editMap = makeEditMap([
        { endLine: 2, id: 'b0', startLine: 0 },
        { endLine: 4, id: 'b1', startLine: 2 },
        { endLine: 5, id: 'b2', startLine: 4 }
      ]);
      const staleMap = makeEditMap([
        { endLine: 1, id: 'b0', startLine: 0 },
        { endLine: 2, id: 'b1', startLine: 1 },
        { endLine: 3, id: 'b2', startLine: 2 }
      ]);

      for (const map of [editMap, null, staleMap]) {
        const removal = emptiedStructuralRowRetirement(surface, heading, source, map);
        expect(removal).toEqual({
          caret: 14,
          end: source.length,
          lineContentEnd: source.length,
          start: 15
        });
        expect(source.slice(0, removal!.start) + source.slice(removal!.end)).toBe(
          '# Title\n\nLead.\n'
        );
      }
    }
  );

  it('retires nested quoted heading, bullet, ordered, task, and bare quote rows across editMap and fallback modes', () => {
    const cases: ReadonlyArray<Readonly<{
      expected: string;
      expectedCaret: number;
      html: string;
      name: string;
      selector: string;
      source: string;
    }>> = [
      {
        expected: '> Outer\n',
        expectedCaret: 7,
        html: '<blockquote data-easymde-visual-block-id="b0"><p>Outer</p><blockquote><h2><br></h2></blockquote></blockquote>',
        name: 'nested > > ## with inner-quote pruning',
        selector: 'h2',
        source: '> Outer\n>\n> > ## '
      },
      {
        expected: '> Para\n',
        expectedCaret: 6,
        html: '<blockquote data-easymde-visual-block-id="b0"><p>Para</p><ul><li><br></li></ul></blockquote>',
        name: 'quoted > - ',
        selector: 'li',
        source: '> Para\n>\n> - '
      },
      {
        expected: '> Para\n',
        expectedCaret: 6,
        html: '<blockquote data-easymde-visual-block-id="b0"><p>Para</p><ol><li><br></li></ol></blockquote>',
        name: 'quoted > 1. ',
        selector: 'li',
        source: '> Para\n>\n> 1. '
      },
      {
        expected: '> Para\n',
        expectedCaret: 6,
        html: '<blockquote data-easymde-visual-block-id="b0"><p>Para</p><ul class="task-list"><li class="task-list-item"><input type="checkbox"><span><br></span></li></ul></blockquote>',
        name: 'quoted > - [ ] ',
        selector: 'li',
        source: '> Para\n>\n> - [ ] '
      },
      {
        expected: '# Title\n\nLead.\n',
        expectedCaret: 14,
        html: '<h1 data-easymde-visual-block-id="b0">Title</h1><p data-easymde-visual-block-id="b1">Lead.</p><blockquote data-easymde-visual-block-id="b2"><p><br></p></blockquote>',
        name: 'bare single quote <p>',
        selector: 'blockquote p',
        source: '# Title\n\nLead.\n\n> '
      },
      {
        expected: '# Title\n\nLead.\n',
        expectedCaret: 14,
        html: '<h1 data-easymde-visual-block-id="b0">Title</h1><p data-easymde-visual-block-id="b1">Lead.</p><blockquote data-easymde-visual-block-id="b2"><br></blockquote>',
        name: 'bare top-level <blockquote>',
        selector: 'blockquote',
        source: '# Title\n\nLead.\n\n> '
      },
      {
        expected: '> Outer\n',
        expectedCaret: 7,
        html: '<blockquote data-easymde-visual-block-id="b0"><p>Outer</p><blockquote><p><br></p></blockquote></blockquote>',
        name: 'bare nested > > ',
        selector: 'blockquote blockquote p',
        source: '> Outer\n>\n> > '
      },
      {
        expected: '> Para',
        expectedCaret: 0,
        html: '<blockquote data-easymde-visual-block-id="b0"><h2><br></h2><p>Para</p></blockquote>',
        name: 'leading > ## in quote',
        selector: 'h2',
        source: '> ## \n>\n> Para'
      },
      {
        expected: '> Para\n>\n> After',
        expectedCaret: 6,
        html: '<blockquote data-easymde-visual-block-id="b0"><p>Para</p><h2><br></h2><p>After</p></blockquote>',
        name: 'mid-quote > ## ',
        selector: 'h2',
        source: '> Para\n>\n> ## \n>\n> After'
      },
      {
        expected: '',
        expectedCaret: 0,
        html: '<blockquote data-easymde-visual-block-id="b0"><h2><br></h2></blockquote>',
        name: 'doc-only > ## ',
        selector: 'h2',
        source: '> ## '
      }
    ];

    for (const testCase of cases) {
      document.body.innerHTML = '';
      const surface = makeSurface(testCase.html);
      const row = surface.querySelector(testCase.selector) as HTMLElement;
      expect(row, testCase.name).toBeInstanceOf(HTMLElement);
      const removal = emptiedStructuralRowRetirement(
        surface,
        row,
        testCase.source,
        null
      );
      expect(removal, testCase.name).not.toBeNull();
      expect(
        testCase.source.slice(0, removal!.start) + testCase.source.slice(removal!.end),
        testCase.name
      ).toBe(testCase.expected);
      expect(removal!.caret, testCase.name).toBe(testCase.expectedCaret);
    }
  });

  it('refuses non-empty quoted heading with closing hashes and fenced code', () => {
    const surface = makeSurface(
      '<blockquote data-easymde-visual-block-id="b0"><h2><br></h2></blockquote>'
    );
    const h2 = surface.querySelector('h2') as HTMLElement;
    expect(
      emptiedStructuralRowRetirement(surface, h2, '> ## text ##', null)
    ).toBeNull();
    expect(
      emptiedStructuralRowRetirement(surface, h2, '```\n> ## \n```', null)
    ).toBeNull();
  });

  it('visualJoinRowAtCaret matches a bare emptied top-level BLOCKQUOTE and refuses non-empty BLOCKQUOTE', () => {
    const surface = makeSurface(
      '<p>Lead.</p><blockquote><br></blockquote>'
    );
    const blockquote = surface.querySelector('blockquote') as HTMLElement;
    const selection = window.getSelection();
    selection?.collapse(blockquote, 0);
    expect(visualJoinRowAtCaret(surface)).toEqual({
      markerBearing: true,
      row: blockquote
    });

    const populated = makeSurface('<blockquote><p>Text</p></blockquote>');
    const populatedQuote = populated.querySelector('blockquote') as HTMLElement;
    selection?.collapse(populatedQuote, 0);
    expect(visualJoinRowAtCaret(populated)).toBeNull();
  });

  it('resolves targeted emptied row via its own block id when editMap has stale trailing lines past source end', () => {
    const source = 'Para\n\n---\n\n## \n\n## \n';
    const surface = makeSurface(
      '<p data-easymde-visual-block-id="b0">Para</p>\n'
      + '<hr data-easymde-visual-block-id="b1">\n'
      + '<h2 data-easymde-visual-block-id="b2"><br></h2>\n'
      + '<h2 data-easymde-visual-block-id="b3"><br></h2>'
    );
    const targetedHeading = surface.querySelector(
      '[data-easymde-visual-block-id="b2"]'
    ) as HTMLElement;
    // Simulates fast bottom-up deletions that shortened `source` before formal
    // Preview refreshed `editMap`, leaving trailing blocks past lineStarts.length.
    const staleLongerMap = makeEditMap([
      { endLine: 1, id: 'b0', startLine: 0 },
      { endLine: 3, id: 'b1', startLine: 2 },
      { endLine: 5, id: 'b2', startLine: 4 },
      { endLine: 7, id: 'b3', startLine: 6 },
      { endLine: 12, id: 'b4', startLine: 10 }
    ]);

    const removal = emptiedStructuralRowRetirement(
      surface,
      targetedHeading,
      source,
      staleLongerMap
    );
    expect(removal).not.toBeNull();
    expect(source.slice(0, removal!.start) + source.slice(removal!.end)).toBe(
      'Para\n\n---\n\n## \n'
    );
    expect(removal!.caret).toBe(9);
  });

  it('Fix 4.1 (Bug F): retires emptied paragraph in a multi-paragraph blockquote when editMap is null and refuses multi-container ambiguity', () => {
    const source = '# Title\n\n> Intro.\n\n## 4. 引用块\n\n> 这是一级引用。\n>\n> \n\n## \n\n[^1]: Note';
    const surface = makeSurface(
      '<h1>Title</h1>'
      + '<blockquote><p>Intro.</p></blockquote>'
      + '<h2>4. 引用块</h2>'
      + '<blockquote><p>这是一级引用。</p><p><br></p></blockquote>'
      + '<h2><br></h2>'
    );
    const quoteParagraphs = surface.querySelectorAll('blockquote')[1]?.querySelectorAll('p');
    const emptySecondParagraph = quoteParagraphs?.[1] as HTMLElement;
    expect(emptySecondParagraph).toBeInstanceOf(HTMLElement);

    const removal = emptiedStructuralRowRetirement(
      surface,
      emptySecondParagraph,
      source,
      null
    );
    expect(removal).not.toBeNull();
    expect(source.slice(0, removal!.start) + source.slice(removal!.end)).toBe(
      '# Title\n\n> Intro.\n\n## 4. 引用块\n\n> 这是一级引用。\n\n## \n\n[^1]: Note'
    );

    // Fail-closed: when two separate multi-paragraph blockquotes exist and
    // editMap is null, do not guess across separate containers.
    const ambiguousSource = '> A\n>\n> \n\n> B\n>\n> C';
    const ambiguousSurface = makeSurface(
      '<blockquote><p>A</p><p><br></p></blockquote>'
      + '<blockquote><p>B</p><p>C</p></blockquote>'
    );
    const ambiguousEmpty = ambiguousSurface
      .querySelectorAll('blockquote')[0]
      ?.querySelectorAll('p')[1] as HTMLElement;
    expect(
      emptiedStructuralRowRetirement(
        ambiguousSurface,
        ambiguousEmpty,
        ambiguousSource,
        null
      )
    ).toBeNull();
  });
});
