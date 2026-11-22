import { Component, createElement, createRef } from '@wordpress/element';
import { act, render } from '@testing-library/react';
import type { ErrorInfo, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import {
  consumeDeferredWindowRootEndAtomicTail,
  SafePreviewHtmlSink,
  type SafePreviewHtmlSinkWindowController
} from './SafePreviewHtmlSink';

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
  it('keeps a synchronously revealed window and its selected gap across a stale render', () => {
    const surfaceRef = createRef<HTMLElement>();
    const controllerRef = createRef<SafePreviewHtmlSinkWindowController>();
    const oldRow = document.createElement('p');
    const newRow = document.createElement('p');
    const gap = document.createElement('p');
    gap.append(document.createElement('br'));
    const oldCommit = { key: 1, nodes: [oldRow, gap], revision: 1 };
    const nextCommit = { key: 2, nodes: [newRow, oldRow, gap], revision: 1 };
    const props = { contentEditable: true, html: '' as SafePreviewHtml,
      htmlRevision: 1, surfaceRef, windowControllerRef: controllerRef };
    const view = render(<SafePreviewHtmlSink {...props} windowedCommit={oldCommit} />);
    const surface = surfaceRef.current;
    if (!surface || !controllerRef.current) throw new Error('test-window-controller-missing');
    surface.tabIndex = 0;
    surface.focus();
    window.getSelection()?.collapse(gap, 0);
    expect(controllerRef.current.commit(oldCommit, nextCommit)).toBe(true);
    expect(Array.from(surface.childNodes)).toEqual(nextCommit.nodes);
    expect(window.getSelection()?.anchorNode).toBe(gap);
    expect(controllerRef.current.commit(oldCommit, nextCommit)).toBe(false);
    view.rerender(<SafePreviewHtmlSink {...props} windowedCommit={oldCommit} ariaBusy />);
    expect(Array.from(surface.childNodes)).toEqual(nextCommit.nodes);
    view.rerender(<SafePreviewHtmlSink {...props} windowedCommit={nextCommit} />);
    expect(Array.from(surface.childNodes)).toEqual(nextCommit.nodes);
    expect(window.getSelection()?.anchorNode).toBe(gap);
  });
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
        statusClassName="preview-status"
        statusMessage="Updating Preview"
        statusRole="status"
        surfaceRef={surfaceRef}
      />
    );

    expect(surface.querySelector('.easymde-toc')).toBe(oldToc);
    const statusNode = surface.querySelector('.preview-status');
    expect(statusNode?.textContent).toBe('Updating Preview');
    expect(surface.querySelectorAll('.preview-status')).toHaveLength(1);
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
        statusClassName="preview-status"
        statusMessage="Updating Preview"
        statusRole="status"
        surfaceRef={surfaceRef}
      />
    );

    expect(surface.querySelector('.easymde-toc')).toBe(oldToc);
    expect(surface.querySelector('.preview-status')).toBe(statusNode);
    expect(surface.querySelectorAll('.preview-status')).toHaveLength(1);
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(laterCompletion).not.toHaveBeenCalled();
  });

  it('rejects external child drift after a staged status commit', () => {
    const surfaceRef = createRef<HTMLElement>();
    const onError = vi.fn<(error: Error) => void>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initialHtml = '<p>Before</p>' as SafePreviewHtml;
    const nextHtml = '<p>After</p>' as SafePreviewHtml;
    const firstStagedCommit = vi.fn();
    const nextStagedCommit = vi.fn();
    const expectedWindowErrors: ErrorEvent[] = [];
    const unexpectedWindowErrors: unknown[] = [];
    const onWindowError = (event: ErrorEvent): void => {
      if (
        event.error instanceof Error
        && 'preview-staged-commit-surface-drifted' === event.error.message
      ) {
        expectedWindowErrors.push(event);
        event.preventDefault();
        return;
      }
      unexpectedWindowErrors.push(event.error ?? event.message);
    };
    const template = document.createElement('template');
    template.innerHTML = nextHtml;
    const stagedCommit = {
      nodes: Array.from(template.content.childNodes),
      revision: 2
    };
    const view = render(
      <TestErrorBoundary onError={onError}>
        <SafePreviewHtmlSink
          html={initialHtml}
          htmlRevision={1}
          surfaceRef={surfaceRef}
        />
      </TestErrorBoundary>
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('preview-staged-drift-surface-missing');

    view.rerender(
      <TestErrorBoundary onError={onError}>
        <SafePreviewHtmlSink
          html={nextHtml}
          htmlRevision={2}
          onStagedCommit={firstStagedCommit}
          stagedCommit={stagedCommit}
          statusClassName="preview-status"
          statusMessage="Updating Preview"
          statusRole="status"
          surfaceRef={surfaceRef}
        />
      </TestErrorBoundary>
    );
    surface.append(document.createElement('span'));
    window.addEventListener('error', onWindowError);

    try {
      view.rerender(
        <TestErrorBoundary onError={onError}>
          <SafePreviewHtmlSink
            html={nextHtml}
            htmlRevision={2}
            onStagedCommit={nextStagedCommit}
            stagedCommit={stagedCommit}
            statusClassName="preview-status"
            statusMessage="Updating Preview"
            statusRole="status"
            surfaceRef={surfaceRef}
          />
        </TestErrorBoundary>
      );

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.lastCall?.[0].message)
        .toBe('preview-staged-commit-surface-drifted');
      expect(expectedWindowErrors).toHaveLength(1);
      expect(unexpectedWindowErrors).toEqual([]);
    } finally {
      window.removeEventListener('error', onWindowError);
      consoleError.mockRestore();
    }
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

  it('avoids collapsing a root-end caret to block 0 when committing a contenteditable=false .easymde-mermaid tail', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('h1');
    const spacer = document.createElement('div');
    const mermaid = document.createElement('div');
    first.textContent = 'Head';
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    spacer.setAttribute('contenteditable', 'false');
    mermaid.className = 'easymde-mermaid';
    mermaid.setAttribute('data-easymde-visual-block-id', 'b2');
    mermaid.setAttribute('contenteditable', 'false');
    mermaid.textContent = 'diagram';
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
    if (!surface) throw new Error('test-mermaid-tail-surface-missing');
    surface.tabIndex = 0;
    surface.focus();
    const range = document.createRange();
    range.setStart(surface, surface.childNodes.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 2, nodes: [spacer, mermaid], revision: 1 }}
      />
    );

    const selection = window.getSelection();
    expect(surface.lastChild).toBe(mermaid);
    const collapsedToStart = selection?.anchorNode === surface
      && selection.anchorOffset === 0;
    expect(collapsedToStart).toBe(false);
    expect(selection?.rangeCount).toBe(0);
    expect(consumeDeferredWindowRootEndAtomicTail(surface)).toBe(true);
    expect(consumeDeferredWindowRootEndAtomicTail(surface)).toBe(false);
    view.unmount();
  });

  it('hands a root-end caret into a document-end editable sink mounted after .easymde-mermaid', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('h1');
    const spacer = document.createElement('div');
    const mermaid = document.createElement('div');
    const sink = document.createElement('p');
    first.textContent = 'Head';
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    spacer.setAttribute('contenteditable', 'false');
    mermaid.className = 'easymde-mermaid';
    mermaid.setAttribute('data-easymde-visual-block-id', 'b2');
    mermaid.setAttribute('contenteditable', 'false');
    mermaid.textContent = 'diagram';
    sink.append(document.createElement('br'));
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
    if (!surface) throw new Error('test-mermaid-sink-surface-missing');
    surface.tabIndex = 0;
    surface.focus();
    const range = document.createRange();
    range.setStart(surface, surface.childNodes.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 2, nodes: [spacer, mermaid, sink], revision: 1 }}
      />
    );

    const selection = window.getSelection();
    expect(surface.lastChild).toBe(sink);
    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.anchorNode).toBe(sink);
    expect(selection?.anchorOffset).toBe(0);
    expect(consumeDeferredWindowRootEndAtomicTail(surface)).toBe(false);
    view.unmount();
  });

  it.each([
    { anchorOffset: 0, direction: 'forward', focusOffset: 2 },
    { anchorOffset: 2, direction: 'backward', focusOffset: 0 }
  ] as const)(
    'preserves a focused full-root $direction selection during replacement',
    ({ anchorOffset, focusOffset }) => {
      const surfaceRef = createRef<HTMLElement>();
      const first = document.createElement('p');
      const second = document.createElement('p');
      const third = document.createElement('p');
      first.textContent = 'first';
      second.textContent = 'second';
      third.textContent = 'third';
      const props = {
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 1,
        surfaceRef
      } as const;
      const view = render(
        <SafePreviewHtmlSink
          {...props}
          windowedCommit={{ key: 1, nodes: [first, second], revision: 1 }}
        />
      );
      const surface = surfaceRef.current;
      if (!surface) throw new Error('test-full-root-selection-surface-missing');
      surface.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error('test-full-root-selection-missing');
      selection.setBaseAndExtent(
        surface,
        anchorOffset,
        surface,
        focusOffset
      );
      expect(document.activeElement).toBe(surface);

      view.rerender(
        <SafePreviewHtmlSink
          {...props}
          windowedCommit={{
            key: 2,
            nodes: [first, second, third],
            revision: 1
          }}
        />
      );

      expect(Array.from(surface.childNodes)).toEqual([first, second, third]);
      expect(selection.anchorNode).toBe(surface);
      expect(selection.anchorOffset).toBe(
        'forward' === (anchorOffset < focusOffset ? 'forward' : 'backward')
          ? 0
          : surface.childNodes.length
      );
      expect(selection.focusNode).toBe(surface);
      expect(selection.focusOffset).toBe(
        'forward' === (anchorOffset < focusOffset ? 'forward' : 'backward')
          ? surface.childNodes.length
          : 0
      );
      view.unmount();
    }
  );

  it('does not expand a partial root selection during replacement', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const second = document.createElement('p');
    const third = document.createElement('p');
    const props = {
      contentEditable: true,
      html: '' as SafePreviewHtml,
      htmlRevision: 1,
      surfaceRef
    } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 1, nodes: [first, second], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-partial-root-surface-missing');
    surface.focus();
    const selection = window.getSelection();
    if (!selection) throw new Error('test-partial-root-selection-missing');
    selection.setBaseAndExtent(surface, 1, surface, 2);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 2, nodes: [first, second, third], revision: 1 }}
      />
    );

    const expanded = selection.anchorNode === surface
      && selection.focusNode === surface
      && selection.anchorOffset === 0
      && selection.focusOffset === surface.childNodes.length;
    expect(expanded).toBe(false);
    view.unmount();
  });

  it('does not restore a full-root range after focus leaves the surface', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const second = document.createElement('p');
    const third = document.createElement('p');
    const outside = document.createElement('button');
    const props = {
      contentEditable: true,
      html: '' as SafePreviewHtml,
      htmlRevision: 1,
      surfaceRef
    } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 1, nodes: [first, second], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-blurred-root-surface-missing');
    surface.focus();
    const selection = window.getSelection();
    if (!selection) throw new Error('test-blurred-root-selection-missing');
    selection.setBaseAndExtent(surface, 0, surface, 2);
    document.body.append(outside);
    outside.focus();

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        windowedCommit={{ key: 2, nodes: [first, second, third], revision: 1 }}
      />
    );

    expect(document.activeElement).toBe(outside);
    const expanded = selection.anchorNode === surface
      && selection.focusNode === surface
      && selection.anchorOffset === 0
      && selection.focusOffset === surface.childNodes.length;
    expect(expanded).toBe(false);
    outside.remove();
    view.unmount();
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

  it('does not restore a semantic handoff over a newer native selection', () => {
    const surfaceRef = createRef<HTMLElement>();
    const previous = document.createElement('p');
    const anchor = document.createElement('p');
    const replacement = document.createElement('p');
    previous.textContent = 'previous';
    anchor.textContent = 'anchor';
    replacement.textContent = 'replacement';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 1, nodes: [previous, anchor], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    const previousText = previous.firstChild;
    const anchorText = anchor.firstChild;
    const replacementText = replacement.firstChild;
    if (!surface || !(previousText instanceof Text) || !(anchorText instanceof Text)
      || !(replacementText instanceof Text)) {
      throw new Error('semantic-handoff-selection-fixture-missing');
    }
    surface.focus();
    window.getSelection()?.collapse(previousText, 2);
    window.getSelection()?.collapse(anchorText, 3);

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 2,
          nodes: [replacement, anchor],
          revision: 1,
          selectionHandoff: {
            previous: { node: previousText, offset: 2 },
            next: { node: replacementText, offset: 2 },
            isCurrent: () => true
          }
        }}
      />
    );

    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(anchorText);
    expect(selection?.anchorOffset).toBe(3);
    expect(selection?.focusNode).toBe(anchorText);
    expect(selection?.focusOffset).toBe(3);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('does not restore a semantic handoff whose current proof is false', () => {
    const surfaceRef = createRef<HTMLElement>();
    const previous = document.createElement('p');
    const anchor = document.createElement('p');
    const replacement = document.createElement('p');
    previous.textContent = 'previous';
    anchor.textContent = 'anchor';
    replacement.textContent = 'replacement';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 1, nodes: [previous, anchor], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    const previousText = previous.firstChild;
    const replacementText = replacement.firstChild;
    if (!surface || !(previousText instanceof Text) || !(replacementText instanceof Text)) {
      throw new Error('stale-semantic-handoff-fixture-missing');
    }
    surface.focus();
    window.getSelection()?.collapse(previousText, 2);

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 2,
          nodes: [replacement, anchor],
          revision: 1,
          selectionHandoff: {
            previous: { node: previousText, offset: 2 },
            next: { node: replacementText, offset: 2 },
            isCurrent: () => false
          }
        }}
      />
    );

    const selection = window.getSelection();
    expect(selection?.anchorNode === replacementText
      && selection.anchorOffset === 2).toBe(false);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
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

  it('drops a root selection whose selected child an identity commit replaced', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const witness = document.createElement('hr');
    first.textContent = 'first';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 1, nodes: [first, witness], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-identity-commit-surface-missing');
    surface.focus();
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.setBaseAndExtent(surface, 1, surface, 2);
    const replacement = document.createElement('p');
    replacement.textContent = 'replacement';

    expect(() => view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 2, nodes: [first, replacement], revision: 1 }}
      />
    )).not.toThrow();

    expect(Array.from(surface.childNodes)).toEqual([first, replacement]);
    // The selected identity is gone, so no offset is reused to invent a caret.
    const selection = window.getSelection();
    const stillSelectsReplacement = selection?.anchorNode === surface
      && selection?.focusNode === surface
      && Math.min(selection.anchorOffset, selection.focusOffset) === 1
      && Math.max(selection.anchorOffset, selection.focusOffset) === 2;
    expect(stillSelectsReplacement).toBe(false);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('reuses the recorded offset of an unrestorable root selection without failing the commit', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const witness = document.createElement('hr');
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 1, nodes: [first, witness], revision: 1 }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-dropped-selection-surface-missing');
    surface.focus();
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.setBaseAndExtent(surface, 1, surface, 2);
    const replacement = document.createElement('p');
    replacement.textContent = 'replacement';
    const extra = document.createElement('p');
    extra.textContent = 'extra';

    // The commit changes the child count, so the recorded interval no longer
    // names the same surface position. The commit still lands; only the
    // unprovable caret is dropped.
    expect(() => view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{ key: 2, nodes: [first, replacement, extra], revision: 1 }}
      />
    )).not.toThrow();

    expect(Array.from(surface.childNodes)).toEqual([first, replacement, extra]);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('keeps a retained contiguous node interval at its new positions', () => {
    const surfaceRef = createRef<HTMLElement>();
    const head = document.createElement('p');
    const selectedFirst = document.createElement('p');
    const selectedLast = document.createElement('p');
    const tail = document.createElement('p');
    head.textContent = 'head';
    selectedFirst.textContent = 'selected-first';
    selectedLast.textContent = 'selected-last';
    tail.textContent = 'tail';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 1,
          nodes: [head, selectedFirst, selectedLast, tail],
          revision: 1
        }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-retained-interval-surface-missing');
    surface.focus();
    window.getSelection()?.removeAllRanges();
    // Backward root selection covering the two middle children.
    window.getSelection()?.setBaseAndExtent(surface, 3, surface, 1);
    const prefix = document.createElement('p');
    prefix.textContent = 'prefix';

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 2,
          nodes: [prefix, head, selectedFirst, selectedLast, tail],
          revision: 1
        }}
      />
    );

    const selection = window.getSelection();
    expect(Array.from(surface.childNodes)).toEqual([
      prefix, head, selectedFirst, selectedLast, tail
    ]);
    // The interval moved by one but still selects exactly the retained nodes,
    // and its backward direction is preserved.
    expect(selection?.anchorNode).toBe(surface);
    expect(selection?.focusNode).toBe(surface);
    expect(selection?.anchorOffset).toBe(4);
    expect(selection?.focusOffset).toBe(2);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('does not select a fresh same-index node when the selected identity is replaced', () => {
    const surfaceRef = createRef<HTMLElement>();
    const previousFirst = document.createElement('p');
    const selected = document.createElement('hr');
    const previousLast = document.createElement('p');
    previousFirst.textContent = 'previous-first';
    previousLast.textContent = 'previous-last';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 1,
          nodes: [previousFirst, selected, previousLast],
          revision: 1
        }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-same-index-surface-missing');
    surface.focus();
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.setBaseAndExtent(surface, 1, surface, 2);
    // Same child count as before, entirely fresh identities: the old index 1
    // now names a different node, so no offset may be reused.
    const freshFirst = document.createElement('p');
    const freshSecond = document.createElement('p');
    const freshHr = document.createElement('hr');
    freshFirst.textContent = 'fresh-first';
    freshSecond.textContent = 'fresh-second';

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 2,
          nodes: [freshFirst, freshSecond, freshHr],
          revision: 1
        }}
      />
    );

    expect(Array.from(surface.childNodes)).toEqual([freshFirst, freshSecond, freshHr]);
    const selection = window.getSelection();
    const selectsFreshNode = selection?.anchorNode === surface
      && selection?.focusNode === surface
      && Math.min(selection.anchorOffset, selection.focusOffset) === 1
      && Math.max(selection.anchorOffset, selection.focusOffset) === 2;
    expect(selectsFreshNode).toBe(false);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('does not collapse a retained interval whose neighbours shifted', () => {
    const surfaceRef = createRef<HTMLElement>();
    const head = document.createElement('p');
    const selected = document.createElement('hr');
    const oldSpacer = document.createElement('div');
    const tail = document.createElement('p');
    oldSpacer.setAttribute('data-easymde-preview-window-spacer', '1');
    head.textContent = 'head';
    tail.textContent = 'tail';
    const onCommit = vi.fn();
    const view = render(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 1,
          nodes: [head, selected, oldSpacer, tail],
          revision: 1
        }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-shifted-neighbour-surface-missing');
    surface.focus();
    window.getSelection()?.removeAllRanges();
    // The selection names the HR only, with the spacer and tail after it.
    window.getSelection()?.setBaseAndExtent(surface, 1, surface, 2);
    const prefix = document.createElement('p');
    prefix.textContent = 'prefix';
    const newSpacer = document.createElement('div');
    newSpacer.setAttribute('data-easymde-preview-window-spacer', '1');

    view.rerender(
      <SafePreviewHtmlSink
        contentEditable
        html={'' as SafePreviewHtml}
        htmlRevision={1}
        onStagedCommit={onCommit}
        surfaceRef={surfaceRef}
        windowedCommit={{
          key: 2,
          nodes: [prefix, head, selected, newSpacer, tail],
          revision: 1
        }}
      />
    );

    expect(Array.from(surface.childNodes)).toEqual([
      prefix, head, selected, newSpacer, tail
    ]);
    const selection = window.getSelection();
    // The retained HR is now at index 2; the interval must track the node, not
    // the stale numeric offset.
    expect(selection?.anchorNode).toBe(surface);
    expect(selection?.focusNode).toBe(surface);
    expect(selection?.anchorOffset).toBe(2);
    expect(selection?.focusOffset).toBe(3);
    expect(onCommit).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
describe('SafePreviewHtmlSink composition gate', () => {
  const gate = (held: boolean, version: number) => ({
    isHeld: () => held,
    version
  });
  const commitNodes = (html: string): Node[] => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const nodes = Array.from(host.childNodes);
    host.replaceChildren();
    return nodes;
  };

  it('defers a raw HTML revision while held and installs the current frame after release', () => {
    const surfaceRef = createRef<HTMLElement>();
    const before = '<p>before</p>' as SafePreviewHtml;
    const after = '<p>after</p>' as SafePreviewHtml;
    const props = { contentEditable: true, surfaceRef } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 0)}
        html={before}
        htmlRevision={1}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-gate-surface-missing');

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(true, 1)}
        html={after}
        htmlRevision={2}
      />
    );
    expect(surface.innerHTML).toBe(before);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 2)}
        html={after}
        htmlRevision={2}
      />
    );
    expect(surface.innerHTML).toBe(after);
    view.unmount();
  });

  it('defers a staged commit while held and publishes it exactly once after release', () => {
    const surfaceRef = createRef<HTMLElement>();
    const onStagedCommit = vi.fn();
    const before = '<p>before</p>' as SafePreviewHtml;
    const after = '<p>after</p>' as SafePreviewHtml;
    const stagedCommit = { nodes: commitNodes(after), revision: 2 };
    const props = { contentEditable: true, surfaceRef } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 0)}
        html={before}
        htmlRevision={1}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-gate-surface-missing');

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(true, 1)}
        html={after}
        htmlRevision={2}
        onStagedCommit={onStagedCommit}
        stagedCommit={stagedCommit}
      />
    );
    expect(onStagedCommit).not.toHaveBeenCalled();
    expect(Array.from(surface.childNodes).map((node) => node.textContent)).toEqual([
      'before'
    ]);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 2)}
        html={after}
        htmlRevision={2}
        onStagedCommit={onStagedCommit}
        stagedCommit={stagedCommit}
      />
    );
    expect(onStagedCommit).toHaveBeenCalledOnce();
    expect(Array.from(surface.childNodes).map((node) => node.textContent)).toEqual([
      'after'
    ]);
    view.unmount();
  });

  it('defers a window commit while held and installs it after release', () => {
    const surfaceRef = createRef<HTMLElement>();
    const onStagedCommit = vi.fn();
    const before = '<p>before</p>' as SafePreviewHtml;
    const after = '<p>after</p>' as SafePreviewHtml;
    const windowedCommit = { key: 1, nodes: commitNodes(after), revision: 2 };
    const props = { contentEditable: true, surfaceRef } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 0)}
        html={before}
        htmlRevision={1}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-gate-surface-missing');

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(true, 1)}
        html={after}
        htmlRevision={2}
        onStagedCommit={onStagedCommit}
        windowedCommit={windowedCommit}
      />
    );
    expect(onStagedCommit).not.toHaveBeenCalled();
    expect(Array.from(surface.childNodes).map((node) => node.textContent)).toEqual([
      'before'
    ]);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 2)}
        html={after}
        htmlRevision={2}
        onStagedCommit={onStagedCommit}
        windowedCommit={windowedCommit}
      />
    );
    expect(onStagedCommit).toHaveBeenCalledOnce();
    expect(Array.from(surface.childNodes).map((node) => node.textContent)).toEqual([
      'after'
    ]);
    view.unmount();
  });

  it('does not start a materialization while held and completes the current one after release', async () => {
    const surfaceRef = createRef<HTMLElement>();
    const onMaterializeComplete = vi.fn();
    const pending: Array<() => void> = [];
    const scheduler = {
      yield: () => new Promise<void>((resolve) => pending.push(resolve))
    };
    const nodes = Array.from({ length: 4 }, (_, index) => {
      const node = document.createElement('p');
      node.textContent = `materialized-${index}`;
      return node;
    });
    const spacer = document.createElement('div');
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    spacer.setAttribute('data-easymde-preview-window-start', '1');
    spacer.setAttribute('data-easymde-preview-window-end', '3');
    spacer.style.blockSize = '48px';
    const windowNodes = [nodes[0] as Node, spacer, nodes[3] as Node];
    const props = {
      contentEditable: true,
      html: '' as SafePreviewHtml,
      htmlRevision: 2,
      materializeScheduler: scheduler,
      surfaceRef
    } as const;
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 0)}
        windowedCommit={{ key: 1, nodes: windowNodes, revision: 2 }}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-gate-surface-missing');
    expect(Array.from(surface.childNodes)).toEqual(windowNodes);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(true, 1)}
        materializeCommit={{ key: 3, nodes, revision: 2 }}
        onMaterializeComplete={onMaterializeComplete}
      />
    );
    expect(pending).toHaveLength(0);
    expect(onMaterializeComplete).not.toHaveBeenCalled();
    expect(Array.from(surface.childNodes)).toEqual(windowNodes);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 2)}
        materializeCommit={{ key: 3, nodes, revision: 2 }}
        onMaterializeComplete={onMaterializeComplete}
      />
    );
    for (let slice = 0; slice < 12 && pending.length > 0; slice += 1) {
      await act(async () => {
        pending.shift()?.();
        await Promise.resolve();
      });
    }
    expect(onMaterializeComplete).toHaveBeenCalledOnce();
    expect(Array.from(surface.childNodes)).toEqual(nodes);
    view.unmount();
  });

  it('keeps the last applied surface for an uninstalled editable revision after a held deferral', () => {
    const surfaceRef = createRef<HTMLElement>();
    const applied = '<p>applied</p>' as SafePreviewHtml;
    const obsolete = '<p>obsolete</p>' as SafePreviewHtml;
    const props = { contentEditable: true, phase: 'ready' as const, surfaceRef };
    const view = render(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 0)}
        html={applied}
        htmlRevision={1}
      />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-gate-surface-missing');
    expect(surface.innerHTML).toBe(applied);

    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(true, 1)}
        html={obsolete}
        htmlRevision={2}
        phase="loading"
      />
    );
    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 2)}
        html={obsolete}
        htmlRevision={2}
        phase="loading"
      />
    );
    expect(surface.innerHTML).toBe(applied);
    expect(surface.getAttribute('data-easymde-preview-phase')).toBe('loading');

    // A failed state still publishes; the continuity rule never hides errors.
    view.rerender(
      <SafePreviewHtmlSink
        {...props}
        compositionGate={gate(false, 2)}
        error
        html={'<p>failed frame</p>' as SafePreviewHtml}
        htmlRevision={3}
        phase="failed"
      />
    );
    expect(surface.innerHTML).toBe('<p>failed frame</p>');
    view.unmount();
  });
});

describe('test-first SafePreviewHtmlSink live draft retention', () => {
  it.each(['staged', 'window'] as const)(
    'keeps native IME text and caret through props-only rerenders and superseded %s frames',
    (kind) => {
      const surfaceRef = createRef<HTMLElement>();
      const before = '<p data-easymde-visual-block-id="b0">left right</p>' as SafePreviewHtml;
      const obsolete = '<p data-easymde-visual-block-id="b0">obsolete</p>' as SafePreviewHtml;
      const accepted = '<p data-easymde-visual-block-id="b0">left 文right</p>' as SafePreviewHtml;
      let held = false;
      const compositionGate = { isHeld: () => held, version: 0 };
      const props = { contentEditable: true, surfaceRef } as const;
      const obsoleteCompletion = vi.fn();
      const latestCompletion = vi.fn();
      const view = render(<SafePreviewHtmlSink {...props} compositionGate={compositionGate} html={before} htmlRevision={1} />);
      const surface = surfaceRef.current;
      const paragraph = surface?.firstElementChild;
      const text = paragraph?.firstChild;
      if (!surface || !(paragraph instanceof HTMLElement) || !(text instanceof Text)) throw new Error('test-first-live-draft-prerequisite-missing');
      surface.tabIndex = 0;
      surface.focus();
      const native = window.getSelection();
      native?.collapse(text, 5);
      held = true;
      act(() => {
        surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        surface.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: '文' }));
        text.insertData(5, '文');
        native?.collapse(text, 6);
        surface.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: '文' }));
      });
      const obsoleteTemplate = document.createElement('template');
      obsoleteTemplate.innerHTML = obsolete;
      const obsoleteNodes = Array.from(obsoleteTemplate.content.childNodes);
      const acceptedTemplate = document.createElement('template');
      acceptedTemplate.innerHTML = accepted;
      const acceptedNodes = kind === 'window' ? [paragraph] : Array.from(acceptedTemplate.content.childNodes);
      const obsoleteCommit = kind === 'window'
        ? { windowedCommit: { key: 2, nodes: obsoleteNodes, revision: 2 } }
        : { stagedCommit: { nodes: obsoleteNodes, revision: 2 } };
      const latestCommit = kind === 'window'
        ? { windowedCommit: { key: 3, nodes: acceptedNodes, revision: 3 } }
        : { stagedCommit: { nodes: acceptedNodes, revision: 3 } };
      const replaceChildren = vi.spyOn(surface, 'replaceChildren');
      try {
        view.rerender(<SafePreviewHtmlSink {...props} {...obsoleteCommit} ariaBusy compositionGate={{ ...compositionGate, version: 1 }} html={obsolete} htmlRevision={2} onStagedCommit={obsoleteCompletion} phase="committing" />);
        view.rerender(<SafePreviewHtmlSink {...props} {...latestCommit} ariaBusy className="props-only-update" compositionGate={{ ...compositionGate, version: 1 }} html={accepted} htmlRevision={3} onStagedCommit={latestCompletion} phase="committing" />);
        expect(surface.firstElementChild).toBe(paragraph);
        expect(text.data).toBe('left 文right');
        expect(text.isConnected).toBe(true);
        expect(native?.anchorNode).toBe(text);
        expect(native?.anchorOffset).toBe(6);
        expect(native?.isCollapsed).toBe(true);
        expect(document.activeElement).toBe(surface);
        expect(replaceChildren).not.toHaveBeenCalled();
        expect(obsoleteCompletion).not.toHaveBeenCalled();
        expect(latestCompletion).not.toHaveBeenCalled();
        held = false;
        view.rerender(<SafePreviewHtmlSink {...props} {...latestCommit} compositionGate={{ ...compositionGate, version: 2 }} html={accepted} htmlRevision={3} onStagedCommit={latestCompletion} phase="ready" />);
        expect(surface.textContent).toBe('left 文right');
        expect(latestCompletion).toHaveBeenCalledExactlyOnceWith(3);
        expect(obsoleteCompletion).not.toHaveBeenCalled();
        view.rerender(<SafePreviewHtmlSink {...props} {...latestCommit} className="second-props-only-update" compositionGate={{ ...compositionGate, version: 2 }} html={accepted} htmlRevision={3} onStagedCommit={latestCompletion} phase="ready" />);
        expect(latestCompletion).toHaveBeenCalledOnce();
        expect(surface.textContent).toBe('left 文right');
        if (kind === 'window') {
          expect(text.isConnected).toBe(true);
          expect(native?.anchorNode).toBe(text);
          expect(native?.anchorOffset).toBe(6);
        }
      } finally { view.unmount(); }
    }
  );
});

describe('SafePreviewHtmlSink identical HTML', () => {
  it('reinstalls the accepted HTML when a native edit mutated the mounted surface', () => {
    const surfaceRef = createRef<HTMLElement>();
    const html = '<p>Para after protected PARA-PROTECTED-AFTER.</p>' as SafePreviewHtml;
    const props = { contentEditable: true, html, htmlRevision: 4, phase: 'ready', surfaceRef };
    const view = render(<SafePreviewHtmlSink {...props} />);
    try {
      const surface = surfaceRef.current;
      if (!surface) throw new Error('test-surface-missing');
      expect(surface.textContent).toBe('Para after protected PARA-PROTECTED-AFTER.');
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('test-text-missing');
      // A native Backspace removed the space, while the source and therefore
      // the requested HTML still describe the original render.
      text.data = 'Para after protectedPARA-PROTECTED-AFTER.';
      view.rerender(<SafePreviewHtmlSink {...props} phase="stale" />);
      expect(surface.textContent).toBe('Para after protected PARA-PROTECTED-AFTER.');
    } finally {
      view.unmount();
    }
  });
});

describe('SafePreviewHtmlSink accepted install gate', () => {
  it('defers an accepted render while a visual intent is pending', () => {
    const surfaceRef = createRef<HTMLElement>();
    const initial = '<p><a href="/x">link text</a> </p>' as SafePreviewHtml;
    const stale = '<p><a href="/x">link text</a></p>' as SafePreviewHtml;
    const view = render(
      <SafePreviewHtmlSink contentEditable html={initial} htmlRevision={1} surfaceRef={surfaceRef} />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-surface-missing');
    try {
      surface.innerHTML = '<p><a href="/x">link</a></p>';
      let witness = { pending: true, sourceLinkLabelLength: 5 };
      const registry = new WeakMap<HTMLElement, () => typeof witness>();
      registry.set(surface, () => witness);
      (globalThis as typeof globalThis & { __VISUAL_WITNESS?: unknown }).__VISUAL_WITNESS = registry;
      view.rerender(
        <SafePreviewHtmlSink contentEditable html={stale} htmlRevision={2} surfaceRef={surfaceRef} />
      );
      expect(surface.querySelector('a')?.textContent).toBe('link');
      witness = { pending: false, sourceLinkLabelLength: 9 };
      view.rerender(
        <SafePreviewHtmlSink contentEditable html={stale} htmlRevision={3} surfaceRef={surfaceRef} />
      );
      expect(surface.querySelector('a')?.textContent).toBe('link text');
    } finally {
      delete (globalThis as typeof globalThis & { __VISUAL_WITNESS?: unknown }).__VISUAL_WITNESS;
      view.unmount();
    }
  });

  it('defers an accepted render whose last link label lags the source', () => {
    const surfaceRef = createRef<HTMLElement>();
    const initial = '<p><a href="/x">link text</a></p>' as SafePreviewHtml;
    const view = render(
      <SafePreviewHtmlSink contentEditable html={initial} htmlRevision={1} surfaceRef={surfaceRef} />
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-surface-missing');
    try {
      surface.innerHTML = '<p><a href="/x">link</a></p>';
      let witness = { pending: false, sourceLinkLabelLength: 5 };
      const registry = new WeakMap<HTMLElement, () => typeof witness>();
      registry.set(surface, () => witness);
      (globalThis as typeof globalThis & { __VISUAL_WITNESS?: unknown }).__VISUAL_WITNESS = registry;
      view.rerender(
        <SafePreviewHtmlSink contentEditable html={initial} htmlRevision={2} surfaceRef={surfaceRef} />
      );
      expect(surface.querySelector('a')?.textContent).toBe('link');
      witness = { pending: false, sourceLinkLabelLength: 9 };
      view.rerender(
        <SafePreviewHtmlSink contentEditable html={initial} htmlRevision={3} surfaceRef={surfaceRef} />
      );
      expect(surface.querySelector('a')?.textContent).toBe('link text');
    } finally {
      delete (globalThis as typeof globalThis & { __VISUAL_WITNESS?: unknown }).__VISUAL_WITNESS;
      view.unmount();
    }
  });
});

describe('SafePreviewHtmlSink editable surfaces', () => {
  it('keeps the Editor-owned content when an empty frame arrives', () => {
    const surfaceRef = createRef<HTMLElement>();
    const view = render(
      createElement(SafePreviewHtmlSink, {
        contentEditable: true,
        html: '<p>alpha</p>' as SafePreviewHtml,
        htmlRevision: 1,
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('<p>alpha</p>');
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('<p>alpha</p>');
    view.unmount();
  });

  it('still clears a Preview-only surface when an empty frame arrives', () => {
    const surfaceRef = createRef<HTMLElement>();
    const view = render(
      createElement(SafePreviewHtmlSink, {
        html: '<p>alpha</p>' as SafePreviewHtml,
        htmlRevision: 1,
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('<p>alpha</p>');
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('');
    view.unmount();
  });

  it('synchronously clears stale windowed blocks and spacers on an accepted empty ready state', () => {
    const surfaceRef = createRef<HTMLElement>();
    const first = document.createElement('p');
    const spacer = document.createElement('div');
    const last = document.createElement('p');
    first.setAttribute('data-easymde-visual-block-id', 'b0');
    first.textContent = 'first';
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    last.setAttribute('data-easymde-visual-block-id', 'b165');
    last.textContent = 'last';
    const view = render(
      createElement(SafePreviewHtmlSink, {
        contentEditable: true,
        html: '<p>first</p><p>last</p>' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef,
        windowedCommit: { key: 1, nodes: [first, spacer, last], revision: 1 }
      })
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-accepted-empty-surface-missing');
    expect(surface.childNodes).toHaveLength(3);
    expect(surface.querySelector('[data-easymde-preview-window-spacer]')).toBe(spacer);

    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'ready',
        surfaceRef,
        windowedCommit: null
      })
    );
    expect(surface.childNodes).toHaveLength(0);
    expect(surface.innerHTML).toBe('');
    expect(surface.querySelector('[data-easymde-preview-window-spacer]')).toBeNull();

    // Subsequent props-only rerenders at the same revision must not discard
    // fresh input typed into the accepted empty paper surface.
    surface.innerHTML = '<p>typed</p>';
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        className: 'props-only-rerender',
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'ready',
        surfaceRef,
        windowedCommit: null
      })
    );
    expect(surface.innerHTML).toBe('<p>typed</p>');
    view.unmount();
  });

  it('keeps editable content when empty HTML arrives during loading or without acceptedEmpty', () => {
    const surfaceRef = createRef<HTMLElement>();
    const view = render(
      createElement(SafePreviewHtmlSink, {
        contentEditable: true,
        html: '<p>alpha</p>' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('<p>alpha</p>');

    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'loading',
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('<p>alpha</p>');

    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: false,
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'ready',
        surfaceRef
      })
    );
    expect(surfaceRef.current?.innerHTML).toBe('<p>alpha</p>');
    view.unmount();
  });

  it('preserves local edits after unlocking an accepted-empty preview-only blank post on the same revision', () => {
    const surfaceRef = createRef<HTMLElement>();
    const gate = (held: boolean, version: number) => ({
      isHeld: () => held,
      version
    });
    const view = render(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(false, 0),
        contentEditable: false,
        html: '' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef
      })
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-blank-unlock-surface-missing');
    expect(surface.innerHTML).toBe('');

    // Unlocking flips contentEditable false -> true on the same empty revision.
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(false, 0),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef
      })
    );

    // Local typing mutates the blank DOM and bumps compositionGate on the same
    // empty revision before any newer Preview revision arrives.
    surface.innerHTML = '<p>可视化首字</p>';
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(true, 1),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef
      })
    );
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(false, 2),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef
      })
    );
    expect(surface.innerHTML).toBe('<p>可视化首字</p>');

    // Even if a non-HTML prop changes on the same already-applied empty
    // revision, clearsAcceptedEmpty must not wipe the local editable DOM.
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(false, 3),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        statusClassName: 'status-rerender',
        surfaceRef
      })
    );
    expect(surface.innerHTML).toBe('<p>可视化首字</p>');
    view.unmount();
  });

  it('clears a windowed surface on accepted-empty transition then preserves subsequent local edits on the same revision', () => {
    const surfaceRef = createRef<HTMLElement>();
    const gate = (held: boolean, version: number) => ({
      isHeld: () => held,
      version
    });
    const first = document.createElement('p');
    const spacer = document.createElement('div');
    const last = document.createElement('p');
    first.setAttribute('data-easymde-visual-block-id', 'b0');
    first.textContent = 'first';
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    last.setAttribute('data-easymde-visual-block-id', 'b165');
    last.textContent = 'last';

    const view = render(
      createElement(SafePreviewHtmlSink, {
        compositionGate: gate(false, 0),
        contentEditable: true,
        html: '<p>first</p><p>last</p>' as SafePreviewHtml,
        htmlRevision: 1,
        phase: 'ready',
        surfaceRef,
        windowedCommit: { key: 1, nodes: [first, spacer, last], revision: 1 }
      })
    );
    const surface = surfaceRef.current;
    if (!surface) throw new Error('test-windowed-clear-then-type-surface-missing');
    expect(surface.childNodes).toHaveLength(3);
    expect(surface.querySelector('[data-easymde-preview-window-spacer]')).toBe(spacer);

    // Transition R1 -> R2 accepted-empty synchronously clears stale windowed nodes and spacer.
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(false, 0),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'ready',
        surfaceRef,
        windowedCommit: null
      })
    );
    expect(surface.childNodes).toHaveLength(0);
    expect(surface.innerHTML).toBe('');
    expect(surface.querySelector('[data-easymde-preview-window-spacer]')).toBeNull();

    // Immediately typing on R2 and bumping compositionGate must preserve the new local DOM.
    surface.innerHTML = '<p>新字</p>';
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(true, 1),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'ready',
        surfaceRef,
        windowedCommit: null
      })
    );
    view.rerender(
      createElement(SafePreviewHtmlSink, {
        acceptedEmpty: true,
        compositionGate: gate(false, 2),
        contentEditable: true,
        html: '' as SafePreviewHtml,
        htmlRevision: 2,
        phase: 'ready',
        surfaceRef,
        windowedCommit: null
      })
    );
    expect(surface.innerHTML).toBe('<p>新字</p>');
    view.unmount();
  });
});
