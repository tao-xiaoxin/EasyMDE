import { createElement, createRef } from '@wordpress/element';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import { SafePreviewHtmlSink } from './SafePreviewHtmlSink';

describe('SafePreviewHtmlSink window commits', () => {
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
