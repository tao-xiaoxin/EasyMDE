import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import { blobText, declaration, installClipboardTestEnvironment } from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('retains task-list checkbox state while removing arbitrary form controls', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul class="task-list">',
      '<li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked name="secret" value="done">Done</li>',
      '<li class="task-list-item"><input type="checkbox">Todo</li>',
      '</ul>',
      '<form><input type="text" name="secret" value="private"></form>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Done\nTodo' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('INPUT' === element.tagName) return declaration({ display: 'inline-block', width: '13px', height: '13px' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const checkboxes = holder.querySelectorAll('[role="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.getAttribute('aria-checked')).toBe('true');
    expect(checkboxes[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(checkboxes[1]?.getAttribute('aria-checked')).toBe('false');
    expect(checkboxes[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(holder.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(holder.querySelector('input[type="text"]')).toBeNull();
  });

  it.each([
    { label: 'positive source geometry', rangeMode: 'normal', expectedStatus: 'copied' },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-owner-missing',
      label: 'visible text fragment owner missing',
      rangeMode: 'missing',
      expectedStatus: 'failed'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-empty',
      label: 'visible text fragment list empty',
      rangeMode: 'empty',
      expectedStatus: 'failed'
    }
  ] as const)(
    'validates the task checkbox static owner with $label',
    async ({ expectedError, expectedStatus, rangeMode }) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-geometry-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Positive</li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Positive' });
      workspace.append(preview);
      document.body.append(workspace);
      const sourceMarkup = preview.innerHTML;
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
      const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
      const scrollOffset = (element: Element): number =>
        element.closest('.easymde-wechat-task-checkbox-measurement') ? 240 : 80;
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          const element = this as HTMLElement;
          if (element.matches('.task-geometry-workspace'))
            return { bottom: 240, height: 160, left: 80, right: 480, top: 80, width: 400, x: 80, y: 80 } as DOMRect;
          if ('ARTICLE' === element.tagName) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 120,
              height: 120,
              left: offset,
              right: offset + 300,
              top: offset,
              width: 300,
              x: offset,
              y: offset
            } as DOMRect;
          }
          if ('UL' === element.tagName && element.classList.contains('task-list')) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 120,
              height: 120,
              left: offset,
              right: offset + 300,
              top: offset,
              width: 300,
              x: offset,
              y: offset
            } as DOMRect;
          }
          if ('LI' === element.tagName && element.classList.contains('task-list-item')) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 40,
              height: 40,
              left: offset,
              right: offset + 300,
              top: offset,
              width: 300,
              x: offset,
              y: offset
            } as DOMRect;
          }
          if ('INPUT' === element.tagName && element.classList.contains('easymde-task-checkbox')) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 18,
              height: 16,
              left: offset,
              right: offset + 16,
              top: offset + 2,
              width: 16,
              x: offset,
              y: offset + 2
            } as DOMRect;
          }
          return (
            originalRect?.value?.call(this) ??
            ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
          );
        }
      });
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: Range): DOMRect {
          const offset = this.startContainer.parentElement?.closest('.easymde-wechat-task-checkbox-measurement')
            ? 240
            : 80;
          return {
            bottom: offset + 18,
            height: 16,
            left: offset + 16,
            right: offset + 72,
            top: offset + 2,
            width: 56,
            x: offset + 16,
            y: offset + 2
          } as DOMRect;
        }
      });
      if ('missing' === rangeMode) {
        delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      } else {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: function (this: Range): DOMRect[] {
            if ('empty' === rangeMode) return [];
            const offset = this.startContainer.parentElement?.closest('.easymde-wechat-task-checkbox-measurement')
              ? 240
              : 80;
            return [
              {
                bottom: offset + 18,
                height: 16,
                left: offset + 16,
                right: offset + 72,
                top: offset + 2,
                width: 56,
                x: offset + 16,
                y: offset + 2
              } as DOMRect
            ];
          }
        });
      }
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if ('INPUT' === element.tagName && pseudoElement) {
          return declaration(
            '::before' === pseudoElement
              ? { content: '""', display: 'block', height: '16px', position: 'absolute', width: '16px' }
              : { content: 'none' }
          );
        }
        if ('INPUT' === element.tagName) {
          return declaration({
            appearance: 'none',
            display: 'inline-block',
            height: '16px',
            position: 'absolute',
            width: '16px'
          });
        }
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
        if (!htmlBlob) throw new Error('positive task HTML missing');
        if ('copied' === expectedStatus) {
          const holder = document.createElement('div');
          holder.innerHTML = await blobText(htmlBlob);
          const owner = holder.querySelector('[role="checkbox"]');
          expect(owner).not.toBeNull();
          expect(owner?.getAttribute('aria-checked')).toBe('true');
          expect(owner?.getAttribute('aria-disabled')).toBe('true');
          expect(owner?.getAttribute('style')).toBeTruthy();
          expect(holder.querySelectorAll('input')).toHaveLength(0);
        } else {
          if (!expectedError) throw new Error('task failure expectation missing');
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

  type HiddenTaskGeometryCase = Readonly<{
    accentColor?: string;
    borderEdge?: string;
    boxSizing?: string;
    expectedError?: string;
    expectedStatus?: 'copied' | 'failed';
    horizontalEdge?: string;
    inputDisplay?: string;
    label: string;
    maxHeight?: string;
    maxWidth?: string;
    missingListValue?: boolean;
    missingRootEdge?: boolean;
    measurementHeight: number;
    measurementWidth: number;
    minHeight?: string;
    minWidth?: string;
    measurementListWidth?: string;
    pseudoBoxSizing?: string;
    pseudoPadding?: string;
    pseudoTransformBox?: string;
    measurementPseudoTransform?: string;
    pseudoTransform?: string;
    pseudoTransformOrigin?: string;
    measurementTransform?: string;
    nonPaintText?: boolean;
    rangeMode?: 'empty' | 'missing' | 'multi' | 'normal';
    textMode?: 'content-visibility-hidden' | 'display-none-hidden' | 'none' | 'visibility-hidden-visible';
    sourceWidth: string;
    transform: string;
    verticalEdge?: string;
  }>;
  const hiddenTaskGeometryCases: HiddenTaskGeometryCase[] = [
    {
      expectedStatus: 'copied',
      label: 'quantized width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'hidden caption prefix uses ready text geometry',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-static-owner-count-mismatch',
      inputDisplay: 'none',
      label: 'task input without a static paint owner',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      horizontalEdge: '2px',
      label: 'border-box edge floor',
      measurementHeight: 16,
      measurementWidth: 4.003,
      sourceWidth: '3px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box edges',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '12px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box min clamp',
      measurementHeight: 16,
      measurementWidth: 22.003,
      minWidth: '18px',
      sourceWidth: '12px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box min clamp without edge conversion',
      measurementHeight: 16,
      measurementWidth: 18.003,
      minWidth: '18px',
      sourceWidth: '12px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box max clamp',
      maxWidth: '18px',
      measurementHeight: 16,
      measurementWidth: 22.003,
      sourceWidth: '24px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box max clamp without edge conversion',
      maxWidth: '18px',
      measurementHeight: 16,
      measurementWidth: 18.003,
      sourceWidth: '24px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      label: 'width plus 2.5px',
      measurementHeight: 16,
      measurementWidth: 18.5,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      label: 'width plus 24px',
      measurementHeight: 16,
      measurementWidth: 40,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      label: 'height plus 2.5px',
      measurementHeight: 18.5,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-checkbox-measurement-unavailable',
      label: 'zero measurement width',
      measurementHeight: 16,
      measurementWidth: 0,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-unavailable',
      label: 'auto source width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: 'auto',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-unavailable',
      label: 'percentage source width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '50%',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-unavailable',
      label: 'nonfinite source width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: 'NaNpx',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'identity matrix input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      measurementTransform: 'matrix(1, 0, 0, 1, 0, 0)',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'ready pure translation input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementTransform: 'matrix(1, 0, 0, 1, 0, 1)',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-owner-missing',
      label: 'text fragment owner missing',
      measurementHeight: 16,
      measurementWidth: 16.003,
      rangeMode: 'missing',
      sourceWidth: '16px',
      textMode: 'visibility-hidden-visible',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-empty',
      label: 'text fragment list empty',
      measurementHeight: 16,
      measurementWidth: 16.003,
      rangeMode: 'empty',
      sourceWidth: '16px',
      textMode: 'visibility-hidden-visible',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'middle text fragments use one union',
      measurementHeight: 16,
      measurementWidth: 16.003,
      rangeMode: 'multi',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'rotated input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'matrix(0, 1, -1, 0, 0, 0)'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'scaled input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'matrix(2, 0, 0, 1, 0, 0)'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'three-dimensional identity input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementTransform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'ready rotated square with source none',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementTransform: 'matrix(0, 1, -1, 0, 0, 0)',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'hidden LI auto with measured active pseudo',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementListWidth: '306.5px',
      measurementPseudoTransform: 'matrix(1.1, 0, 0, 1.1, 2, 3)',
      nonPaintText: true,
      pseudoTransformOrigin: '50% 50%',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'visible child overrides hidden visibility with fragments',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      textMode: 'visibility-hidden-visible',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'display none ancestor skips text fragments',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      textMode: 'display-none-hidden',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'content visibility ancestor skips text fragments',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      textMode: 'content-visibility-hidden',
      transform: 'none'
    },
    {
      accentColor: 'rgb(18, 52, 86)',
      expectedError: 'wechat-task-checkbox-geometry-style-mismatch',
      label: 'hidden non-layout paint mismatch',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-measurement-root-content-width-unavailable',
      label: 'measurement root edge missing',
      measurementHeight: 16,
      measurementWidth: 16.003,
      missingRootEdge: true,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-list-item-style-unavailable',
      label: 'measurement list used value missing',
      measurementHeight: 16,
      measurementWidth: 16.003,
      missingListValue: true,
      sourceWidth: '16px',
      transform: 'none'
    }
  ];
  it.each(hiddenTaskGeometryCases)(
    'uses ready hidden measurement geometry for $label',
    async ({
      accentColor,
      borderEdge = '0px',
      boxSizing = 'border-box',
      expectedError,
      expectedStatus = 'failed',
      label,
      inputDisplay = 'inline-block',
      horizontalEdge = '0px',
      maxHeight = 'none',
      maxWidth = 'none',
      missingListValue = false,
      missingRootEdge = false,
      measurementHeight,
      measurementListWidth = 'auto',
      measurementWidth,
      minHeight = 'auto',
      minWidth = 'auto',
      pseudoBoxSizing = 'border-box',
      pseudoPadding = '0px',
      pseudoTransformBox = 'border-box',
      pseudoTransform = 'none',
      measurementPseudoTransform = pseudoTransform,
      pseudoTransformOrigin = '50% 50%',
      nonPaintText = false,
      rangeMode = 'normal',
      sourceWidth,
      textMode = 'none',
      transform,
      measurementTransform = transform,
      verticalEdge = '0px'
    }) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-hidden-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      const textMarkup = nonPaintText
        ? '<span data-task-hidden>Metadata</span><svg><title>SVG title</title><defs><path d="M0 0"></path></defs></svg><math><annotation>Math metadata</annotation></math>'
        : 'visibility-hidden-visible' === textMode
          ? '<span data-task-visibility-wrapper><span data-task-visible>Visible metadata</span></span>'
          : 'display-none-hidden' === textMode
            ? '<span data-task-display-none-wrapper>Metadata</span>'
            : 'content-visibility-hidden' === textMode
              ? '<span data-task-content-hidden-wrapper>Metadata</span>'
              : '';
      const hiddenCaptionPrefix = 'hidden caption prefix uses ready text geometry' === label;
      preview.innerHTML = hiddenCaptionPrefix
        ? '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked> <strong>Caption</strong></li></ul>'
        : `<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Hidden${textMarkup}</li></ul>`;
      Object.defineProperty(preview, 'innerText', { configurable: true, value: hiddenCaptionPrefix ? ' Caption' : 'Hidden' });
      workspace.append(preview);
      document.body.append(workspace);
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
      const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
      const rect = (width: number, height: number, top = 0): DOMRect =>
        ({ bottom: top + height, height, left: 0, right: width, top, width, x: 0, y: top }) as DOMRect;
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          if (this.matches('.task-hidden-workspace')) return rect(400, 160);
          const hiddenSource = Boolean(
            this.closest('.task-hidden-workspace') &&
              !this.closest('.easymde-wechat-preview-measurement, .easymde-wechat-task-checkbox-measurement')
          );
          if (this.matches('article, ul.task-list')) return hiddenSource ? rect(0, 0) : rect(300, 120);
          if (this.matches('li.task-list-item')) return hiddenSource ? rect(0, 0) : rect(300, 40);
          if (this.matches('input.easymde-task-checkbox'))
            return hiddenSource ? rect(0, 0) : rect(measurementWidth, measurementHeight, 2);
          return originalRect?.value?.call(this) ?? rect(0, 0);
        }
      });
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(56, 16, 2)
      });
      if ('missing' === rangeMode) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          get(this: Range): (() => DOMRect[]) | undefined {
            if (this.startContainer.parentElement?.closest('[data-task-visible]')) return undefined;
            return function (this: Range): DOMRect[] {
              const sourceHidden = Boolean(
                this.startContainer.parentElement?.closest('.task-hidden-workspace') &&
                  !this.startContainer.parentElement?.closest(
                    '.easymde-wechat-preview-measurement, .easymde-wechat-task-checkbox-measurement'
                  )
              );
              return sourceHidden ? [] : [rect(56, 16, 2)];
            };
          }
        });
      } else {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: function (this: Range): DOMRect[] {
            const sourceHidden = Boolean(
              this.startContainer.parentElement?.closest('.task-hidden-workspace') &&
                !this.startContainer.parentElement?.closest(
                  '.easymde-wechat-preview-measurement, .easymde-wechat-task-checkbox-measurement'
                )
            );
            if (sourceHidden) return [];
            if (hiddenCaptionPrefix) {
              const selected = (this.startContainer.nodeValue ?? '').slice(this.startOffset, this.endOffset);
              return [rect(selected.trim() ? 56 : 0, 16, 2)];
            }
            if ('empty' === rangeMode && this.startContainer.parentElement?.closest('[data-task-visible]')) {
              return [];
            }
            if ('multi' === rangeMode) return [rect(56, 16, 2), rect(56, 16, 18)];
            return [rect(56, 16, 2)];
          }
        });
      }
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if ('DIV' === element.tagName && element.classList.contains('task-hidden-workspace')) {
          return declaration({ display: 'none' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-hidden')) {
          return declaration({ display: 'none' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-visibility-wrapper')) {
          return declaration({ display: 'block', visibility: 'hidden' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-visible')) {
          return declaration({ display: 'block', visibility: 'visible' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-display-none-wrapper')) {
          return declaration({ display: 'none' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-content-hidden-wrapper')) {
          return declaration({ 'content-visibility': 'hidden', display: 'block' });
        }
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
            'padding-left': missingRootEdge ? '' : '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'word-spacing': 'normal'
          });
        }
        if ('INPUT' === element.tagName && pseudoElement) {
          const pseudoTransformValue = element.closest('.easymde-wechat-preview-measurement')
            ? measurementPseudoTransform
            : pseudoTransform;
          return declaration(
            '::before' === pseudoElement
              ? {
                  'accent-color': accentColor ?? 'auto',
                  'box-sizing': pseudoBoxSizing,
                  'border-bottom-width': '0px',
                  'border-left-width': '0px',
                  'border-right-width': '0px',
                  'border-top-width': '0px',
                  content: '""',
                  display: 'block',
                  height: '16px',
                  left: 'auto',
                  'margin-bottom': '0px',
                  'margin-left': '0px',
                  'margin-right': '0px',
                  'margin-top': '0px',
                  'padding-bottom': pseudoPadding,
                  'padding-left': pseudoPadding,
                  'padding-right': pseudoPadding,
                  'padding-top': pseudoPadding,
                  position: 'absolute',
                  bottom: 'auto',
                  right: 'auto',
                  top: 'auto',
                  transform: pseudoTransformValue,
                  'transform-box': pseudoTransformBox,
                  'transform-origin': pseudoTransformOrigin,
                  width: '16px'
                }
              : { content: 'none' }
          );
        }
        if ('INPUT' === element.tagName) {
          return declaration({
            'accent-color': accentColor
              ? element.closest('.easymde-wechat-preview-measurement')
                ? 'rgb(101, 67, 33)'
                : accentColor
              : 'auto',
            appearance: 'none',
            'box-sizing': boxSizing,
            'border-bottom-width': borderEdge,
            'border-left-width': borderEdge,
            'border-right-width': borderEdge,
            'border-top-width': borderEdge,
            display: inputDisplay,
            height: '16px',
            'max-height': maxHeight,
            'max-width': maxWidth,
            'min-height': minHeight,
            'min-width': minWidth,
            padding: '0px',
            'padding-bottom': verticalEdge,
            'padding-left': horizontalEdge,
            'padding-right': horizontalEdge,
            'padding-top': verticalEdge,
            position: 'absolute',
            transform: element.closest('.easymde-wechat-preview-measurement') ? measurementTransform : transform,
            width: sourceWidth
          });
        }
        if ('LI' === element.tagName && element.classList.contains('task-list-item')) {
          return declaration({
            'border-bottom-width': '0px',
            'border-left-width': '0px',
            'border-right-width': '0px',
            'border-top-width': '0px',
            display: 'block',
            height: 'auto',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            'max-height': 'none',
            'max-width': 'none',
            'min-height': 'auto',
            'min-width': 'auto',
            'padding-bottom': '0px',
            'padding-left': missingListValue ? '' : '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'white-space': 'normal',
            width: element.closest('.easymde-wechat-preview-measurement') ? measurementListWidth : 'auto'
          });
        }
        if ('STRONG' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
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
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('hidden task HTML missing');
        if ('copied' === expectedStatus) {
          const holder = document.createElement('div');
          holder.innerHTML = await blobText(htmlBlob);
          const owner = holder.querySelector('[role="checkbox"]');
          expect(owner).not.toBeNull();
          expect(owner?.getAttribute('aria-checked')).toBe('true');
          expect(owner?.getAttribute('aria-disabled')).toBe('true');
          expect(owner?.getAttribute('style')).toBeTruthy();
          expect(holder.querySelectorAll('input')).toHaveLength(0);
          if (hiddenCaptionPrefix) {
            expect(holder.querySelector('strong')?.textContent).toBe('Caption');
            expect(holder.textContent).not.toContain(' Caption');
          }
        } else {
          if (!expectedError) throw new Error('hidden task failure expectation missing');
          await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
        }
        expect(preview.getBoundingClientRect().width).toBe(0);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
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
