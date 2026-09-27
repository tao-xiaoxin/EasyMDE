import { Component, createElement, createRef } from '@wordpress/element';
import { act, render } from '@testing-library/react';
import type { ErrorInfo, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import { SafePreviewHtmlSink } from './SafePreviewHtmlSink';

type TestErrorBoundaryProps = Readonly<{
  children: ReactNode;
  onError: (error: Error) => void;
}>;

type TestErrorBoundaryState = Readonly<{ failed: boolean }>;

class TestErrorBoundary extends Component<
  TestErrorBoundaryProps,
  TestErrorBoundaryState
> {
  public override state: TestErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): TestErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

describe('SafePreviewHtmlSink window commits', () => {
  it('keeps adopted protected references when the same staged commit reconciles again', () => {
    const surfaceRef = createRef<HTMLElement>();
    const initialHtml = '<p>Before</p><div class="easymde-toc"><ul>'
      + '<li><a href="#heading">Heading</a></li></ul></div>';
    const nextHtml = '<p>After</p><div class="easymde-toc"><ul>'
      + '<li><a href="#heading">Heading</a></li></ul></div>';
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={initialHtml as SafePreviewHtml}
        htmlRevision={1}
        surfaceRef={surfaceRef}
      />
    );
    const surface = surfaceRef.current;
    const oldToc = surface?.querySelector('.easymde-toc');
    if (!surface || !oldToc) throw new Error('test-protected-node-missing');
    oldToc.setAttribute('contenteditable', 'false');
    const template = document.createElement('template');
    template.innerHTML = nextHtml;
    const stagedCommit = {
      nodes: Array.from(template.content.childNodes),
      revision: 2
    };
    const firstCompletion = vi.fn();
    const laterCompletion = vi.fn();
    const replaceChildren = vi.spyOn(surface, 'replaceChildren');

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={nextHtml as SafePreviewHtml}
        htmlRevision={2}
        onStagedCommit={firstCompletion}
        stagedCommit={stagedCommit}
        surfaceRef={surfaceRef}
      />
    );

    expect(surface.querySelector('.easymde-toc')).toBe(oldToc);
    expect(firstCompletion).toHaveBeenCalledOnce();
    expect(replaceChildren).toHaveBeenCalledOnce();

    view.rerender(
      <SafePreviewHtmlSink
        ariaBusy
        contentEditable={false}
        html={nextHtml as SafePreviewHtml}
        htmlRevision={2}
        onStagedCommit={laterCompletion}
        stagedCommit={stagedCommit}
        statusRole="status"
        surfaceRef={surfaceRef}
      />
    );

    expect(surface.querySelector('.easymde-toc')).toBe(oldToc);
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(laterCompletion).not.toHaveBeenCalled();
  });

  it('keeps a nested protected node adopted from inert staged markup', () => {
    const surfaceRef = createRef<HTMLElement>();
    const initialHtml = '<p>Result <span class="easymde-math" '
      + 'data-easymde-rendered="1"><span>2</span></span></p>';
    const nextHtml = '<p>Updated result <span class="easymde-math" '
      + 'data-easymde-rendered="1"><span>2</span></span></p>';
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={initialHtml as SafePreviewHtml}
        htmlRevision={1}
        surfaceRef={surfaceRef}
      />
    );
    const surface = surfaceRef.current;
    const oldMath = surface?.querySelector('.easymde-math');
    if (!surface || !oldMath) throw new Error('test-protected-node-missing');
    oldMath.setAttribute('contenteditable', 'false');
    const template = document.createElement('template');
    template.innerHTML = nextHtml;
    const stagedCommit = {
      nodes: Array.from(template.content.childNodes),
      revision: 2
    };
    const replaceChildren = vi.spyOn(surface, 'replaceChildren');

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={nextHtml as SafePreviewHtml}
        htmlRevision={2}
        stagedCommit={stagedCommit}
        surfaceRef={surfaceRef}
      />
    );

    expect(surface.querySelector('.easymde-math')).toBe(oldMath);
    expect(oldMath.ownerDocument).toBe(surface.ownerDocument);
    expect(replaceChildren).toHaveBeenCalledOnce();
  });

  it('uses canonical protected attributes for staged DOM adoption', () => {
    const surfaceRef = createRef<HTMLElement>();
    const initialHtml = '<p>Start</p><div class="easymde-toc" style="">'
      + '<ul><li>Same</li></ul></div>';
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={initialHtml as SafePreviewHtml}
        htmlRevision={1}
        surfaceRef={surfaceRef}
      />
    );
    const surface = surfaceRef.current;
    const originalToc = surface?.querySelector<HTMLElement>('.easymde-toc');
    if (!surface || !originalToc) {
      throw new Error('test-protected-node-missing');
    }
    originalToc.setAttribute('contenteditable', 'false');

    const commit = (markup: string, revision: number) => {
      const template = document.createElement('template');
      template.innerHTML = markup;
      return {
        nodes: Array.from(template.content.childNodes),
        revision
      };
    };
    const renderCommit = (markup: string, revision: number): void => {
      view.rerender(
        <SafePreviewHtmlSink
          contentEditable
          html={markup as SafePreviewHtml}
          htmlRevision={revision}
          stagedCommit={commit(markup, revision)}
          surfaceRef={surfaceRef}
        />
      );
    };

    renderCommit(
      '<p>Absent style</p><div class="easymde-toc">'
        + '<ul><li>Same</li></ul></div>',
      2
    );
    expect(surface.querySelector('.easymde-toc')).toBe(originalToc);

    renderCommit(
      '<p>Whitespace style</p><div class="easymde-toc" style=" \t\n ">'
        + '<ul><li>Same</li></ul></div>',
      3
    );
    expect(surface.querySelector('.easymde-toc')).toBe(originalToc);

    renderCommit(
      '<p>Non-empty style</p><div class="easymde-toc" style="color: red">'
        + '<ul><li>Same</li></ul></div>',
      4
    );
    const styledToc = surface.querySelector<HTMLElement>('.easymde-toc');
    expect(styledToc).not.toBe(originalToc);
    expect(styledToc?.getAttribute('contenteditable')).toBe('false');

    renderCommit(
      '<p>Other attribute</p><div class="easymde-toc" '
        + 'style="color: red" aria-label="Changed">'
        + '<ul><li>Same</li></ul></div>',
      5
    );
    const changedAttributeToc = surface.querySelector<HTMLElement>('.easymde-toc');
    expect(changedAttributeToc).not.toBe(styledToc);
    expect(changedAttributeToc?.getAttribute('contenteditable')).toBe('false');
  });

  it('restores nested protected nodes when an inert staged commit fails', () => {
    const surfaceRef = createRef<HTMLElement>();
    const initialHtml = '<p>Result <span class="easymde-math" '
      + 'data-easymde-rendered="1"><span>2</span></span> after</p>';
    const nextHtml = '<p>Updated result <span class="easymde-math" '
      + 'data-easymde-rendered="1"><span>2</span></span> after</p>';
    const onError = vi.fn<(error: Error) => void>();
    const view = render(
      <TestErrorBoundary onError={onError}>
        <SafePreviewHtmlSink
          contentEditable
          html={initialHtml as SafePreviewHtml}
          htmlRevision={1}
          surfaceRef={surfaceRef}
        />
      </TestErrorBoundary>
    );
    const surface = surfaceRef.current;
    const oldMath = surface?.querySelector('.easymde-math');
    const oldParent = oldMath?.parentNode;
    const oldNextSibling = oldMath?.nextSibling;
    if (!surface || !oldMath || !oldParent) {
      throw new Error('test-protected-node-missing');
    }
    oldMath.setAttribute('contenteditable', 'false');
    const template = document.createElement('template');
    template.innerHTML = nextHtml;
    const stagedCommit = {
      nodes: Array.from(template.content.childNodes),
      revision: 2
    };
    const expectedFailure = new Error('preview-test-sink-replace-failed');
    const expectedWindowErrors: ErrorEvent[] = [];
    const unexpectedWindowErrors: unknown[] = [];
    const onWindowError = (event: ErrorEvent): void => {
      if (
        event.error === expectedFailure
        || event.message === expectedFailure.message
      ) {
        expectedWindowErrors.push(event);
        event.preventDefault();
        return;
      }
      unexpectedWindowErrors.push(event.error ?? event.message);
    };
    const replaceChildren = vi.spyOn(surface, 'replaceChildren')
      .mockImplementation(() => {
        throw expectedFailure;
      });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', onWindowError);

    try {
      view.rerender(
        <TestErrorBoundary onError={onError}>
          <SafePreviewHtmlSink
            contentEditable
            html={nextHtml as SafePreviewHtml}
            htmlRevision={2}
            stagedCommit={stagedCommit}
            surfaceRef={surfaceRef}
          />
        </TestErrorBoundary>
      );

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.lastCall?.[0]).toBe(expectedFailure);
      expect(expectedWindowErrors).toHaveLength(1);
      expect(unexpectedWindowErrors).toEqual([]);
      expect(oldMath.parentNode).toBe(oldParent);
      expect(oldMath.nextSibling).toBe(oldNextSibling);
      expect(oldMath.ownerDocument).toBe(surface.ownerDocument);
      expect(replaceChildren).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('error', onWindowError);
      replaceChildren.mockRestore();
      consoleError.mockRestore();
    }
  });

  it('preserves a root-end caret while pinning the document-end Block', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const spacer = document.createElement('div');
    const last = document.createElement('p');
    first.textContent = 'first';
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    last.textContent = 'last';
    const props = {
      contentEditable: true,
      html: '' as SafePreviewHtml,
      htmlRevision: 1,
      surfaceRef
    } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 1, nodes: [first, spacer], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-root-selection-surface-missing');
    const range = document.createRange();
    range.setStart(surface, surface.childNodes.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 2, nodes: [first, spacer, last], revision: 1 }}
      />
    );

    const selection = window.getSelection();
    expect(surface.lastChild).toBe(last);
    expect(selection?.anchorNode).toBe(surface);
    expect(selection?.anchorOffset).toBe(surface.childNodes.length);
    expect(selection?.focusNode).toBe(surface);
    expect(selection?.focusOffset).toBe(surface.childNodes.length);
  });

  it('preserves a live text selection while reconciling the bounded window', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const selected = document.createElement('p');
    const last = document.createElement('p');
    first.textContent = 'first';
    selected.textContent = 'selected';
    last.textContent = 'last';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 1, nodes: [first, selected, last], revision: 1 }}
      />
    );
    const text = selected.firstChild;
    if (!text) throw new Error('test-selection-text-missing');
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 5);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const spacer = document.createElement('div');

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 2, nodes: [spacer, selected, last], revision: 1 }}
      />
    );

    const selection = window.getSelection();
    expect(surfaceRef.current?.childNodes).toEqual(
      expect.objectContaining({ 0: spacer, 1: selected, 2: last })
    );
    expect(selection?.anchorNode).toBe(text);
    expect(selection?.anchorOffset).toBe(1);
    expect(selection?.focusNode).toBe(text);
    expect(selection?.focusOffset).toBe(5);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('restores spacer range and geometry after cancelling a partial materialization', async () => {
    const surfaceRef = createRef<HTMLElement>();
    const nodes = Array.from({ length: 520 }, (_, index) => {
      const node = document.createElement('p');
      node.textContent = `block-${index}`;
      return node;
    });
    const spacer = document.createElement('div');
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    spacer.setAttribute('data-easymde-preview-window-start', '1');
    spacer.setAttribute('data-easymde-preview-window-end', '519');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.blockSize = '12432px';
    spacer.style.margin = '0';
    const pending: Array<() => void> = [];
    const scheduler = {
      yield: () => new Promise<void>((resolve) => pending.push(resolve))
    };
    const props = {
      contentEditable: true,
      html: '' as SafePreviewHtml,
      htmlRevision: 1,
      materializeScheduler: scheduler,
      surfaceRef
    } as const;
    const windowNodes = [nodes[0] as Node, spacer, nodes[519] as Node];
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 1, nodes: windowNodes, revision: 1 }}
      />
    );

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        materializeCommit={{ key: 2, nodes, revision: 1 }}
      />
    );
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending.shift()?.();
      await Promise.resolve();
    });
    expect(spacer.getAttribute('data-easymde-preview-window-start')).toBe('513');
    expect(pending).toHaveLength(1);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 3, nodes: windowNodes, revision: 1 }}
      />
    );

    expect(spacer.getAttribute('data-easymde-preview-window-start')).toBe('1');
    expect(spacer.getAttribute('data-easymde-preview-window-end')).toBe('519');
    expect(spacer.style.blockSize).toBe('12432px');
    expect(spacer.style.margin).toBe('0px');
    expect(Array.from(surfaceRef.current?.childNodes ?? [])).toEqual(windowNodes);
  });
});
