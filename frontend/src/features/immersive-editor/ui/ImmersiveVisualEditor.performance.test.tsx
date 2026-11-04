import { act, render as testingLibraryRender } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import {
  createCodeMirrorDocumentSession,
  type CodeMirrorDocumentSession
} from '../../document-source/adapters/code-mirror-document-session';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import type { PreviewSurfaceStatus } from '../../live-preview/ui/PreviewSurfaceOwner';
import {
  resetVisualEditorPerformanceCounters,
  serializeVisualMarkdown,
  visualEditorPerformanceCounters,
  type VisualEditorPerformanceCounters
} from '../visual-markdown';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

/**
 * The reported document size: one block below the 160-block windowing
 * threshold, so this is the non-windowed owner the profile was taken on.
 */
const FIXTURE_BLOCK_COUNT = 159;
/** The debounce the editor commits a visual edit on. */
const VISUAL_INPUT_DEBOUNCE_MS = 80;
/** How many ordinary character deletions a run presses. */
const MEASURED_KEY_COUNT = 20;
/**
 * The budget an ordinary character deletion must stay inside. A keypress that
 * re-derives the whole document costs one Turndown run per rendered image plus
 * one per block fragment plus the whole-document alignment; the accepted
 * behaviour is at most the one block fragment that actually changed, no
 * whole-document source map and no diff.
 */
const PER_KEY_BUDGET = {
  blockSerializations: 1,
  diffCalls: 0,
  directSourceMapBuilds: 0,
  sourceMapBuilds: 0,
  turndownRuns: 1
} as const;

type FixtureBlock = Readonly<{ html: string; markdown: string }>;

function fixtureBlock(html: string, markdown: string, id: string): FixtureBlock {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('performance-fixture-block-invalid');
  root.setAttribute('data-easymde-visual-block-id', id);
  return { html: template.innerHTML, markdown };
}

/**
 * A near-threshold document of the reported shape: prose rows carrying the
 * caret, plus the headings, lists, quotes, fences, tables and images a real
 * post mixes in. Each block's HTML is the renderer's shape, so the accepted
 * surface spells exactly the source it was rendered from.
 */
function performanceFixtureBlocks(count: number): ReadonlyArray<FixtureBlock> {
  const blocks: FixtureBlock[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `b${index}`;
    if (0 === index % 17) {
      blocks.push(fixtureBlock(
        `<pre><code class="language-js">const row${index} = ${index};\n</code></pre>`,
        `\`\`\`js\nconst row${index} = ${index};\n\`\`\``,
        id
      ));
      continue;
    }
    if (0 === index % 13) {
      blocks.push(fixtureBlock(
        '<section class="table-container easymde-table-container">'
        + `<table><thead><tr><th>name</th><th>value</th></tr></thead>`
        + `<tbody><tr><td>row${index}</td><td>${index}</td></tr></tbody></table></section>`,
        `| name | value |\n| --- | --- |\n| row${index} | ${index} |`,
        id
      ));
      continue;
    }
    if (0 === index % 11) {
      blocks.push(fixtureBlock(
        `<h2>Section ${index}</h2>`,
        `## Section ${index}`,
        id
      ));
      continue;
    }
    if (0 === index % 7) {
      blocks.push(fixtureBlock(
        `<ul>\n<li>alpha ${index}</li>\n<li>beta ${index}</li>\n<li>gamma ${index}</li>\n</ul>`,
        `- alpha ${index}\n- beta ${index}\n- gamma ${index}`,
        id
      ));
      continue;
    }
    if (0 === index % 5) {
      blocks.push(fixtureBlock(
        `<blockquote>\n<p>quoted row ${index} keeps its own line of prose</p>\n</blockquote>`,
        `> quoted row ${index} keeps its own line of prose`,
        id
      ));
      continue;
    }
    if (0 === index % 4) {
      // A source spelling the serializer normalizes (`__weight__` comes back
      // as `**weight**`). The accepted render therefore differs from the
      // canonical source in many blocks, which is what makes the whole-document
      // alignment run a character diff per differing block.
      blocks.push(fixtureBlock(
        `<p>row ${index} carries <em>emphasis</em> and <strong>weight</strong> inline</p>`,
        `row ${index} carries *emphasis* and __weight__ inline`,
        id
      ));
      continue;
    }
    if (0 === index % 31) {
      blocks.push(fixtureBlock(
        `<p><img src="https://example.test/${index}.png" alt="figure ${index}"></p>`,
        `![figure ${index}](https://example.test/${index}.png)`,
        id
      ));
      continue;
    }
    const words = Array.from(
      { length: 24 },
      (_, word) => `word${index}-${word}`
    ).join(' ');
    blocks.push(fixtureBlock(
      `<p>${words}</p>`,
      words,
      id
    ));
  }
  return blocks;
}

function performanceFixture(
  blocks: ReadonlyArray<FixtureBlock>
): Readonly<{
  blockStarts: ReadonlyArray<number>;
  editMap: PreviewEditMap;
  html: string;
  markdown: string;
}> {
  const lines: string[] = [];
  const blockStarts: number[] = [];
  const editMapBlocks: PreviewEditMap['blocks'][number][] = [];
  for (const block of blocks) {
    const startLine = lines.length;
    blockStarts.push(lines.join('\n').length + (0 === lines.length ? 0 : 1));
    lines.push(...block.markdown.split('\n'));
    editMapBlocks.push({
      editable: true,
      endLine: lines.length,
      id: block.html.match(/data-easymde-visual-block-id="([^"]+)"/u)?.[1] ?? '',
      startLine
    });
    lines.push('');
  }
  // The trailing separator belongs to no block: the renderer never claims the
  // blank line it writes between two rows.
  lines.pop();
  return {
    blockStarts,
    editMap: {
      blocks: editMapBlocks,
      coordinate: 'line',
      signature: 'performance-fixture',
      version: 1
    },
    html: blocks.map((block) => block.html).join('\n'),
    markdown: lines.join('\n')
  };
}

function placeCaretInText(text: Text, offset = text.length): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function deleteTextRange(text: Text, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  range.deleteContents();
}

function createPerformanceFixture(blocks: ReadonlyArray<FixtureBlock>) {
  const accepted = performanceFixture(blocks);
  const surface = document.createElement('article');
  surface.contentEditable = 'true';
  surface.tabIndex = 0;
  surface.innerHTML = accepted.html;
  const container = document.createElement('div');
  const submissionField = document.createElement('textarea');
  submissionField.value = accepted.markdown;
  submissionField.defaultValue = accepted.markdown;
  document.body.append(surface, container, submissionField);
  const history: CodeMirrorDocumentSession = createCodeMirrorDocumentSession({
    container,
    label: 'Markdown source',
    submissionField
  });
  history.setVisualEditingActive(true);
  const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
    current: null
  };
  const onFailure = vi.fn();
  const props = {
    documentSession: { document: history } as unknown as EditorDocumentSession,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic: vi.fn(),
    onDispose: vi.fn(),
    onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange: vi.fn(),
    onReady: (runtime: ImmersiveVisualEditorRuntime) => {
      runtimeHolder.current = runtime;
    },
    onTransferFailure: vi.fn(),
    pending: false,
    previewSnapshot: {
      editMap: accepted.editMap,
      revision: 1,
      signature: 'performance-fixture'
    },
    previewStatus: 'ready' as PreviewSurfaceStatus,
    retainCompositionSurface: () => ({ release: () => undefined }),
    requestPreview: vi.fn(() => 'performance-fixture-request'),
    surface
  };
  const view = testingLibraryRender(
    createElement(ImmersiveVisualEditor, {
      referenceLabelCaseFoldProfile: 14,
      ...props
    })
  );
  return {
    accepted,
    history,
    onFailure,
    surface,
    unmount: (): void => {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      surface.remove();
    }
  };
}

type KeyMeasurement = Readonly<{
  /** Work the press itself performed, before its commit debounce. */
  press: VisualEditorPerformanceCounters;
  /** Milliseconds the press handler spent, as a task would. */
  pressMs: number;
  /** Work the debounced commit performed. */
  commit: VisualEditorPerformanceCounters;
  /** Milliseconds the debounced commit spent. */
  commitMs: number;
}>;

function counterDelta(
  after: VisualEditorPerformanceCounters,
  before: VisualEditorPerformanceCounters
): VisualEditorPerformanceCounters {
  return {
    blockSerializations: after.blockSerializations - before.blockSerializations,
    diffCalls: after.diffCalls - before.diffCalls,
    directSourceMapBuilds: after.directSourceMapBuilds - before.directSourceMapBuilds,
    sourceMapBuilds: after.sourceMapBuilds - before.sourceMapBuilds,
    turndownRuns: after.turndownRuns - before.turndownRuns
  };
}

/**
 * One native Backspace on the collapsed caret: `beforeinput` first, the
 * browser's own default mutation only when the owner did not consume the
 * press, the real caret moved, then the matching `input`, then the debounce
 * that commits the edit.
 */
function pressBackspace(
  fixture: ReturnType<typeof createPerformanceFixture>
): KeyMeasurement {
  const { surface } = fixture;
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!(selection?.isCollapsed) || !(anchor instanceof Text)) {
    throw new Error('performance-fixture-caret-missing');
  }
  const offset = selection.anchorOffset;
  resetVisualEditorPerformanceCounters();
  const pressStartedAt = performance.now();
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'deleteContentBackward'
  });
  Object.defineProperty(beforeInput, 'getTargetRanges', {
    configurable: true,
    value: () => [{
      endContainer: anchor,
      endOffset: offset,
      startContainer: anchor,
      startOffset: offset - 1
    }]
  });
  surface.dispatchEvent(beforeInput);
  if (!beforeInput.defaultPrevented) {
    deleteTextRange(anchor, offset - 1, offset);
    placeCaretInText(anchor, offset - 1);
    surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward'
    }));
  }
  const pressMs = performance.now() - pressStartedAt;
  const press = visualEditorPerformanceCounters();
  const commitStartedAt = performance.now();
  act(() => {
    vi.advanceTimersByTime(VISUAL_INPUT_DEBOUNCE_MS);
  });
  return {
    commit: counterDelta(visualEditorPerformanceCounters(), press),
    commitMs: performance.now() - commitStartedAt,
    press,
    pressMs
  };
}

function total(
  measurements: ReadonlyArray<KeyMeasurement>,
  key: 'press' | 'commit'
): VisualEditorPerformanceCounters {
  return measurements.reduce<VisualEditorPerformanceCounters>(
    (sum, measurement) => {
      const counters = measurement[key];
      return {
        blockSerializations: sum.blockSerializations + counters.blockSerializations,
        diffCalls: sum.diffCalls + counters.diffCalls,
        directSourceMapBuilds: sum.directSourceMapBuilds + counters.directSourceMapBuilds,
        sourceMapBuilds: sum.sourceMapBuilds + counters.sourceMapBuilds,
        turndownRuns: sum.turndownRuns + counters.turndownRuns
      };
    },
    {
      blockSerializations: 0,
      diffCalls: 0,
      directSourceMapBuilds: 0,
      sourceMapBuilds: 0,
      turndownRuns: 0
    }
  );
}

describe('visual editor per-key cost', () => {
  it('keeps an ordinary Backspace inside one block projection and no document map', () => {
    vi.useFakeTimers({
      toFake: [
        'clearImmediate',
        'clearInterval',
        'clearTimeout',
        'setImmediate',
        'setInterval',
        'setTimeout'
      ]
    });
    const blocks = performanceFixtureBlocks(FIXTURE_BLOCK_COUNT);
    const fixture = createPerformanceFixture(blocks);
    try {
      expect(blocks).toHaveLength(FIXTURE_BLOCK_COUNT);
      // The mount itself must be accepted: a refused or diverged surface would
      // make every measurement below describe something else.
      expect(fixture.onFailure.mock.calls).toEqual([]);
      expect(fixture.history.getValue()).toBe(fixture.accepted.markdown);
      // The accepted surface spells the same bytes as the source: the fixture's
      // two spellings of emphasis are the same length, so a whole-surface
      // serialization must agree with the canonical source byte for byte in
      // length even though the two spaces differ in punctuation.
      expect(serializeVisualMarkdown(fixture.surface))
        .toHaveLength(fixture.accepted.markdown.length);
      const caretBlock = Array.from(fixture.surface.children)[94];
      const caretText = caretBlock?.firstChild;
      if (!(caretText instanceof Text)) {
        throw new Error('performance-fixture-caret-block-missing');
      }
      const caretOffset = caretText.length - 4;
      fixture.surface.focus();
      placeCaretInText(caretText, caretOffset);

      // The first press adopts the accepted render: it may prove each image
      // once and project its own block. Every press after it is an ordinary
      // press in a run, which is what the per-key budget describes.
      const adoption = pressBackspace(fixture);
      const measurements: KeyMeasurement[] = [];
      for (let key = 0; key < MEASURED_KEY_COUNT; key += 1) {
        measurements.push(pressBackspace(fixture));
      }

      // The canonical bytes are the document minus exactly the pressed run.
      const blockStart = fixture.accepted.blockStarts[94];
      if (undefined === blockStart) throw new Error('performance-fixture-block-start-missing');
      const pressedCount = MEASURED_KEY_COUNT + 1;
      const removedAt = blockStart + caretOffset - pressedCount;
      expect(fixture.history.getValue()).toBe(
        fixture.accepted.markdown.slice(0, removedAt)
        + fixture.accepted.markdown.slice(removedAt + pressedCount)
      );
      expect(fixture.onFailure.mock.calls).toEqual([]);
      expect(fixture.surface.querySelectorAll('p, h2, ul, pre, blockquote').length)
        .toBeGreaterThan(0);

      const steadyTotal = total(measurements, 'press');
      const commitTotal = total(measurements, 'commit');
      const report = {
        adoption: adoption.press,
        adoptionMs: Math.round(adoption.pressMs * 100) / 100,
        commitTotal,
        maxCommitMs: Math.max(...measurements.map(({ commitMs }) => commitMs)),
        maxPressMs: Math.max(...measurements.map(({ pressMs }) => pressMs)),
        steadyKeys: measurements.length,
        steadyTotal,
        steadyWorst: measurements.reduce<VisualEditorPerformanceCounters>(
          (worst, measurement) => ({
            blockSerializations: Math.max(worst.blockSerializations, measurement.press.blockSerializations),
            diffCalls: Math.max(worst.diffCalls, measurement.press.diffCalls),
            directSourceMapBuilds: Math.max(worst.directSourceMapBuilds, measurement.press.directSourceMapBuilds),
            sourceMapBuilds: Math.max(worst.sourceMapBuilds, measurement.press.sourceMapBuilds),
            turndownRuns: Math.max(worst.turndownRuns, measurement.press.turndownRuns)
          }),
          {
            blockSerializations: 0,
            diffCalls: 0,
            directSourceMapBuilds: 0,
            sourceMapBuilds: 0,
            turndownRuns: 0
          }
        )
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report));

      // The adoption press is the one press that has no selection memory yet,
      // so it proves each rendered image once and builds the alignment its own
      // projection reads. It must still never serialize the whole surface: one
      // spelling per image plus the one block that changed is the ceiling.
      const renderedImages = fixture.surface.querySelectorAll('img').length;
      expect(renderedImages).toBeGreaterThan(0);
      expect(adoption.press.blockSerializations)
        .toBeLessThanOrEqual(renderedImages + 1);
      expect(adoption.press.turndownRuns)
        .toBeLessThanOrEqual(renderedImages + 1);
      // Every ordinary press in a run stays inside the per-key budget.
      for (const measurement of measurements) {
        expect(measurement.press.blockSerializations)
          .toBeLessThanOrEqual(PER_KEY_BUDGET.blockSerializations);
        expect(measurement.press.turndownRuns)
          .toBeLessThanOrEqual(PER_KEY_BUDGET.turndownRuns);
        expect(measurement.press.sourceMapBuilds)
          .toBeLessThanOrEqual(PER_KEY_BUDGET.sourceMapBuilds);
        expect(measurement.press.directSourceMapBuilds)
          .toBeLessThanOrEqual(PER_KEY_BUDGET.directSourceMapBuilds);
        expect(measurement.press.diffCalls)
          .toBeLessThanOrEqual(PER_KEY_BUDGET.diffCalls);
      }
      // And the steady state — an ordinary press in a run of them — does none
      // of that work at all.
      expect(steadyTotal).toEqual({
        blockSerializations: 0,
        diffCalls: 0,
        directSourceMapBuilds: 0,
        sourceMapBuilds: 0,
        turndownRuns: 0
      });
      // The debounced commit must never serialize or align the document
      // either: it commits the arithmetic the press already proved.
      expect(commitTotal).toEqual({
        blockSerializations: 0,
        diffCalls: 0,
        directSourceMapBuilds: 0,
        sourceMapBuilds: 0,
        turndownRuns: 0
      });
      // A single keypress must not become a long task. The measured press and
      // commit are the whole synchronous cost of the key in this environment.
      expect(report.maxPressMs).toBeLessThan(100);
      expect(report.maxCommitMs).toBeLessThan(100);
    } finally {
      fixture.unmount();
      vi.useRealTimers();
    }
  });
});
