import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  installClipboardTestEnvironment
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([
    {
      expectedStatus: 'copied',
      label: 'preserves the preceding mixed-list sibling flow in the measurement owner',
      measurementTaskRowHeight: 40
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-list-item-mismatch',
      expectedStatus: 'failed',
      label: 'still rejects a mismatched measurement row box',
      measurementTaskRowHeight: 41
    }
  ] as const)(
    'clones the outer task list for visible row geometry and $label',
    async ({ expectedError, expectedStatus, measurementTaskRowHeight }) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-list-flow-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = [
        '<ul class="task-list">',
        '<li class="mixed-ordinary">Ordinary flow sibling<ul class="nested-ordinary"><li>Nested item</li></ul>',
        '<ul class="task-list nested-task-list"><li class="task-list-item"><section>',
        '<input class="easymde-task-checkbox" type="checkbox" checked>Checked nested task',
        '</section></li><li class="task-list-item"><section>',
        '<input class="easymde-task-checkbox" type="checkbox">Unchecked nested task',
        '</section></li></ul></li>',
        '</ul>'
      ].join('');
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: 'Ordinary flow sibling Nested item Checked nested task Unchecked nested task'
      });
      workspace.append(preview);
      document.body.append(workspace);
      const sourceMarkup = preview.innerHTML;
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
      const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
      // jsdom has no layout engine, so the stub advances a list row only when the
      // preceding sibling content actually survived the measurement clone.
      const flowObservations: Array<Readonly<{ measurement: boolean; preceding: boolean }>> = [];
      const inMeasurement = (element: Element): boolean =>
        Boolean(element.closest('.easymde-wechat-task-checkbox-measurement'));
      const rowOffset = (element: Element): number => (inMeasurement(element) ? 240 : 80);
      const precedingFlowHeight = (element: Element): number => {
        const list = element.parentElement;
        if (!list) return 0;
        const siblings = Array.from(list.children);
        return siblings.slice(0, Math.max(0, siblings.indexOf(element))).reduce(
          (total, sibling) => total + ((sibling.textContent ?? '').trim() ? 40 : 0),
          0
        );
      };
      const outermostList = (element: Element): Element | null => {
        let list = element.closest('ul, ol');
        while (list) {
          const parentList = list.parentElement?.closest('ul, ol') ?? null;
          if (!parentList) return list;
          list = parentList;
        }
        return null;
      };
      const listRowTop = (element: Element): number => rowOffset(element) + precedingFlowHeight(element);
      const rect = (width: number, height: number, top: number, left: number): DOMRect =>
        ({ bottom: top + height, height, left, right: left + width, top, width, x: left, y: top }) as DOMRect;
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          const element = this as HTMLElement;
          if (element.matches('.task-list-flow-workspace')) return rect(400, 160, 0, 0);
          if ('ARTICLE' === element.tagName) return rect(300, 120, rowOffset(element), rowOffset(element));
          if ('UL' === element.tagName || 'OL' === element.tagName) {
            return rect(300, 40, rowOffset(element), rowOffset(element));
          }
          if ('LI' === element.tagName) {
            const measurement = inMeasurement(element);
            const height =
              measurement && element.classList.contains('task-list-item') ? measurementTaskRowHeight : 40;
            if (element.classList.contains('task-list-item')) {
              const preceding = Boolean(outermostList(element)?.querySelector('.nested-ordinary')?.textContent?.trim());
              flowObservations.push({ measurement, preceding });
            }
            return rect(300, height, listRowTop(element), rowOffset(element));
          }
          if ('SECTION' === element.tagName) {
            const owner = element.closest('li');
            return rect(300, 40, owner ? listRowTop(owner) : rowOffset(element), rowOffset(element));
          }
          if ('INPUT' === element.tagName && element.classList.contains('easymde-task-checkbox')) {
            const owner = element.closest('section');
            const top = owner ? owner.getBoundingClientRect().top : rowOffset(element);
            return rect(16, 16, top + 2, rowOffset(element));
          }
          return (
            originalRect?.value?.call(this) ??
            ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
          );
        }
      });
      const anchorRect = (element: Element | null): DOMRect => {
        const offset = element ? rowOffset(element) : 80;
        const owner = element?.closest('section');
        const top = owner ? owner.getBoundingClientRect().top : offset;
        return rect(56, 16, top + 2, offset + 16);
      };
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: Range): DOMRect {
          return anchorRect(this.startContainer.parentElement);
        }
      });
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: function (this: Range): DOMRect[] {
          return [anchorRect(this.startContainer.parentElement)];
        }
      });
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if ('INPUT' === element.tagName && pseudoElement) {
          return declaration(
            '::before' === pseudoElement
              ? {
                  content: '""',
                  display: 'block',
                  height: '16px',
                  left: '0px',
                  position: 'absolute',
                  right: 'auto',
                  top: '0px',
                  width: '16px'
                }
              : { content: 'none' }
          );
        }
        if ('INPUT' === element.tagName) {
          return declaration({
            appearance: 'none',
            bottom: 'auto',
            display: 'inline-block',
            height: '16px',
            left: '0px',
            position: 'absolute',
            right: 'auto',
            top: '0px',
            width: '16px'
          });
        }
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('ARTICLE' === element.tagName) {
          return declaration({
            'border-bottom-width': '0px',
            'border-left-width': '0px',
            'border-right-width': '0px',
            'border-top-width': '0px',
            'box-sizing': 'content-box',
            display: 'block',
            'font-family': 'sans-serif',
            'font-size': '16px',
            'font-weight': '400',
            'letter-spacing': 'normal',
            'line-height': 'normal',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'word-spacing': 'normal'
          });
        }
        return declaration({ display: 'block' });
      };
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      try {
        if ('copied' === expectedStatus) {
          await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
        } else {
          await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        }
        expect(writes).toHaveLength(1);
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('mixed task list HTML missing');
        if ('copied' === expectedStatus) {
          const holder = document.createElement('div');
          holder.innerHTML = await blobText(htmlBlob);
          const owners = Array.from(holder.querySelectorAll('[role="checkbox"]'));
          expect(owners).toHaveLength(2);
          expect(owners.map((owner) => owner.getAttribute('aria-checked'))).toEqual(['true', 'false']);
          const ordinaryItem = holder.querySelector('ul > li');
          expect(ordinaryItem?.textContent).toContain('Ordinary flow sibling');
          expect(ordinaryItem?.querySelector('ul > li')?.textContent).toBe('Nested item');
          // The measurement owner measured the task rows with the cloned
          // preceding ordinary sibling content in place, so the contextual row
          // offset matched the source instead of collapsing to the list top.
          expect(flowObservations).toContainEqual({ measurement: true, preceding: true });
        } else {
          if (!expectedError) throw new Error('mixed task list failure expectation missing');
          await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
        }
        expect(preview.innerHTML).toBe(sourceMarkup);
        expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).toBeNull();
      } finally {
        workspace.remove();
        if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
        else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
        else delete (Range.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalRangeClientRects)
          Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
        else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      }
    }
  );

});
