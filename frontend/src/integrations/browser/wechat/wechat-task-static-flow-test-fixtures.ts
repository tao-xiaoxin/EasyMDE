import { expect, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import {
  blobText,
  declaration,
  declaredStylePixels,
  declaredStyleValue,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

/**
 * Integration harness for one task checkbox static-flow copy through
 * `createBrowserWechatClipboard`: it renders the settled Preview markup, runs
 * the real clipboard path, and asserts the captured allocation and optional
 * failure mode. Direct normalization cases live with the projection tests.
 */

type TaskStaticAllocationReference = Readonly<{ height: number; left: number; top: number; width: number }>;

export type TaskStaticAllocationOptions = Readonly<{
  afterContent?: string;
  assertSourceUnaffected?: boolean;
  afterRotate?: string;
  beforeContent?: string;
  beforePosition?: 'absolute' | 'relative' | 'static';
  chainSibling?: 'absolute' | 'float';
  corruptAllocation?: boolean;
  corruptClear?: boolean;
  direction?: 'ltr' | 'rtl';
  expectedError?: string;
  liOverflow?: string;
  liPaddingTop?: string;
  liRotate?: string;
  ownerDirection?: 'ltr' | 'rtl';
  ownerDisplay?: string;
  ownerRotate?: string;
  ownerTransform?: string;
  precedingSibling?: 'absolute' | 'absolute-float' | 'float' | 'hidden' | 'logical-float';
  pseudoWidth?: string;
  secondWidth?: number;
  sectionMarginTop?: string;
  sectionNonContainingBlock?: 'contain-size' | 'will-change-opacity';
  sectionPaddingTop?: string;
  sourceClear?: string;
  secondOwnerStatic?: boolean;
  taskFont?: string;
  taskLineHeight?: string;
  assertInlineCaption?: boolean;
  expectedBeforeText?: string;
  synchronousCopy?: boolean;
  width: number;
  expectedOwnerOriginTop?: number;
}>;

// Captured allocation of the settled Preview: owner at (-22, 3) with a 20x20
// border box, circle at (18, -2) with a 16x16 border box, tick at (27.6, 8)
// with a promoted 8x12 border box.
const TASK_OWNER_REFERENCE: TaskStaticAllocationReference = { height: 20, left: -22, top: 3, width: 20 };
const TASK_CIRCLE_REFERENCE: TaskStaticAllocationReference = { height: 16, left: 18, top: -2, width: 16 };
const TASK_TICK_REFERENCE: TaskStaticAllocationReference = { height: 12, left: 27.6, top: 8, width: 8 };

export async function expectTaskStaticAllocation(options: TaskStaticAllocationOptions): Promise<void> {
  const {
    afterContent = '""',
    assertSourceUnaffected = false,
    afterRotate = 'none',
    beforeContent = '""',
    beforePosition = 'absolute',
    chainSibling,
    corruptAllocation = false,
    corruptClear = false,
    direction = 'ltr',
    expectedError,
    liOverflow = 'visible',
    liPaddingTop = '0px',
    liRotate = 'none',
    ownerDirection = direction,
    ownerDisplay = 'inline-block',
    ownerRotate = 'none',
    ownerTransform = 'none',
    precedingSibling,
    pseudoWidth = '16px',
    secondWidth,
    sectionMarginTop = '0px',
    sectionNonContainingBlock,
    sectionPaddingTop = '0px',
    sourceClear,
    secondOwnerStatic = false,
    taskFont,
    taskLineHeight,
    assertInlineCaption = false,
    expectedBeforeText,
    synchronousCopy = false,
    width,
    expectedOwnerOriginTop
  } = options;
  let layoutWidth = width;
  const writes: unknown[] = [];
  let legacyHtml = '';
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  class ClipboardItemStub {
    constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {
      if (synchronousCopy) throw new Error('synchronous-clipboard-item-failure');
    }
  }
  if (synchronousCopy) {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
  }
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  const leadMarkup = precedingSibling ? '<span class="task-lead"></span>' : '';
  // The chain sibling precedes the layout parent inside the task item, so it is
  // consumed by the containing block chain rather than by the owner origin.
  const chainLeadMarkup = chainSibling ? '<span class="task-chain-lead"></span>' : '';
  preview.innerHTML = [
    '<ul class="task-list">',
    `<li class="task-list-item">${chainLeadMarkup}<section class="task-section">${leadMarkup}<input class="easymde-task-checkbox" type="checkbox" checked>Ticked</section></li>`,
    `<li class="task-list-item"><section class="task-section"><input class="easymde-task-checkbox${secondOwnerStatic ? ' ordinary-static-owner' : ''}" type="checkbox">Open</section></li>`,
    '</ul>'
  ].join('');
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Ticked\nOpen' });
  const workspace = document.createElement('div');
  workspace.className = 'task-flow-workspace';
  workspace.append(preview);
  document.body.append(workspace);
  const sourceInputs = [...preview.querySelectorAll<HTMLInputElement>('input.easymde-task-checkbox')];
  const sourceStyles = sourceInputs.map((input) => input.getAttribute('style'));
  const sourceMutations: MutationRecord[] = [];
  const sourceObserver = assertSourceUnaffected ? new MutationObserver((records) => sourceMutations.push(...records)) : null;
  sourceObserver?.observe(preview, { attributes: true, attributeFilter: ['style'], subtree: true });
  const rect = (left: number, top: number, boxWidth: number, boxHeight: number): DOMRect =>
    ({
      bottom: top + boxHeight,
      height: boxHeight,
      left,
      right: left + boxWidth,
      top,
      width: boxWidth,
      x: left,
      y: top
    }) as DOMRect;
  const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: HTMLElement): DOMRect {
      if (this.matches('.task-flow-workspace')) return rect(0, 0, layoutWidth + 100, 200);
      if (this.matches('article, ul.task-list')) return rect(50, 0, layoutWidth, 160);
      if (this.matches('li.task-list-item')) {
        return rect(50, 40 + Number.parseFloat(liPaddingTop) + Number.parseFloat(sectionMarginTop), layoutWidth, 40);
      }
      if (this.matches('section.task-section')) {
        return rect(
          50,
          40 + Number.parseFloat(liPaddingTop) + Number.parseFloat(sectionMarginTop),
          layoutWidth,
          30
        );
      }
      if (this.matches('input.easymde-task-checkbox')) {
        // The production normalizer temporarily clears an owner transform while
        // reading its settled layout slot. Model that layout read explicitly;
        // the transformed rect remains the paint-only source geometry.
        if ('none' === this.style.getPropertyValue('transform')) return rect(28, 43, 20, 20);
        return 'none' === ownerTransform
          ? rect(28, 43 + Number.parseFloat(liPaddingTop) + Number.parseFloat(sectionMarginTop) + Number.parseFloat(sectionPaddingTop), 20, 20)
          : rect(15, 20, 40, 40);
      }
      return (
        originalRect?.value?.call(this) ?? rect(0, 0, 0, 0)
      );
    }
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: (): DOMRect[] => [rect(72, 47, 48, 16)]
  });
  const originalSetAttribute = Element.prototype.setAttribute;
  if (corruptAllocation || corruptClear) {
    // Bounded negatives: corrupt a recorded allocation value after it is
    // written so the terminal layer validation has to fail explicitly.
    Object.defineProperty(Element.prototype, 'setAttribute', {
      configurable: true,
      value: function (this: Element, name: string, value: string): void {
        let corrupted = value;
        if ('style' === name && value.includes('box-sizing:border-box!important')) {
          if (corruptAllocation && corrupted.includes('margin-left:')) {
            corrupted = corrupted.replace(
              /margin-left:(-?(?:\d+(?:\.\d+)?|\.\d+))px!important/u,
              (_match: string, pixels: string) => `margin-left:${Number.parseFloat(pixels) + 4}px!important`
            );
          }
          if (corruptClear && corrupted.includes('clear:none!important')) {
            corrupted = corrupted.replace('clear:none!important', 'clear:both!important');
          }
        }
        originalSetAttribute.call(this, name, corrupted);
      }
    });
  }
  const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
    if ('INPUT' === element.tagName) {
      const checked = (element as HTMLInputElement).checked;
      const ordinaryStaticOwner = secondOwnerStatic && element.classList.contains('ordinary-static-owner');
      if (pseudoElement) {
        if (ordinaryStaticOwner) {
          return declaration({ content: 'none', display: 'none', position: 'static' });
        }
        if ('::before' === pseudoElement) {
          return declaration({
            'background-color': checked ? 'rgb(255, 192, 0)' : 'rgb(255, 255, 255)',
            'border-bottom-width': '1px',
            'border-left-width': '1px',
            'border-right-width': '1px',
            'border-radius': '50%',
            'border-top-width': '1px',
            'box-sizing': 'border-box',
            ...(sourceClear ? { clear: sourceClear } : {}),
            content: beforeContent,
            display: 'block',
            height: '16px',
            ...(undefined !== taskFont ? { font: taskFont } : {}),
            ...(undefined !== taskLineHeight ? { 'line-height': taskLineHeight } : {}),
            left: '18px',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: beforePosition,
            top: '-2px',
            width: pseudoWidth
          });
        }
        return declaration({
          'border-bottom-color': 'rgb(255, 255, 255)',
          'border-bottom-style': 'solid',
          'border-bottom-width': '2px',
          'border-right-color': 'rgb(255, 255, 255)',
          'border-right-style': 'solid',
          'border-right-width': '2px',
          'box-sizing': 'content-box',
          ...(sourceClear ? { clear: sourceClear } : {}),
          content: afterContent,
          display: 'block',
          height: '10px',
          ...(undefined !== taskFont ? { font: taskFont } : {}),
          ...(undefined !== taskLineHeight ? { 'line-height': taskLineHeight } : {}),
          left: '27.6px',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          opacity: checked ? '1' : '0',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'absolute',
          rotate: afterRotate,
          top: '8px',
          transform: 'matrix(0.707107, 0.707107, -0.707107, 0.707107, -4.05, -7.74)',
          width: '6px'
        });
      }
      return declaration({
        appearance: 'none',
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        'box-sizing': 'border-box',
        ...(sourceClear ? { clear: sourceClear } : {}),
        direction: ownerDirection,
        display: ordinaryStaticOwner ? 'inline' : ownerDisplay,
        height: '20px',
        ...(undefined !== taskFont ? { font: taskFont } : {}),
        ...(undefined !== taskLineHeight ? { 'line-height': taskLineHeight } : {}),
        left: ordinaryStaticOwner ? 'auto' : '-22px',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': '0px',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': '0px',
        position: ordinaryStaticOwner ? 'static' : 'absolute',
        rotate: ownerRotate,
        top: ordinaryStaticOwner ? 'auto' : '3px',
        transform: ownerTransform,
        width: '20px'
      });
    }
    if (element.matches('li.task-list-item')) {
      return declaration({
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        direction,
        display: 'block',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': '0px',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': liPaddingTop,
        overflow: liOverflow,
        'overflow-x': liOverflow,
        'overflow-y': liOverflow,
        position: 'relative',
        rotate: liRotate
      });
    }
    if (element.matches('span.task-chain-lead')) {
      // Float is inert on an absolutely positioned box, so only the floated
      // sibling can displace the consumed chain box.
      return 'float' === chainSibling
        ? declaration({ float: 'right', position: 'static' })
        : declaration({ position: 'absolute' });
    }
    if (element.matches('span.task-lead')) {
      if ('hidden' === precedingSibling) return declaration({ display: 'none' });
      if ('absolute' === precedingSibling) return declaration({ position: 'absolute' });
      // A logical float value constrains placement exactly like a physical one,
      // while float stays inert on an absolutely positioned box.
      if ('absolute-float' === precedingSibling) {
        return declaration({ float: 'inline-end', position: 'absolute' });
      }
      return declaration({
        float: 'logical-float' === precedingSibling ? 'inline-start' : 'left',
        position: 'static'
      });
    }
    if (element.matches('section.task-section')) {
      return declaration({
        ...(sectionNonContainingBlock === 'contain-size' ? { contain: 'size' } : {}),
        ...(sectionNonContainingBlock === 'will-change-opacity' ? { 'will-change': 'opacity' } : {}),
        direction,
        display: 'block',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': sectionMarginTop,
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': sectionPaddingTop,
        position: 'static',
        width: `${layoutWidth}px`
      });
    }
    if ('ARTICLE' === element.tagName || 'UL' === element.tagName) {
      return declaration({
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        direction,
        display: 'block',
        'font-family': 'sans-serif',
        'font-size': '16px',
        'line-height': 'normal',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': '0px',
        width: `${width}px`
      });
    }
    return declaration({ direction, display: 'block' });
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
    const result = await clipboard.copy(preview);
    if (expectedError) {
      expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const failureItem = (writes[0] as ClipboardItemStub[])[0];
      const failureBlob = failureItem?.payload['text/html'];
      if (!failureBlob) throw new Error('task flow failure payload missing');
      await expect(blobText(failureBlob)).rejects.toThrow(expectedError);
      return;
    }
    expect(result).toEqual({ method: synchronousCopy ? 'legacy' : 'clipboard', status: 'copied' });
    const item = synchronousCopy ? undefined : (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!synchronousCopy && !htmlBlob) throw new Error('task flow payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = synchronousCopy ? legacyHtml : await blobText(htmlBlob as Blob | PromiseLike<Blob>);
    expect(holder.textContent).toContain('Ticked');
    expect(holder.textContent).toContain('Open');
    if (expectedBeforeText) expect(holder.textContent).toContain(expectedBeforeText);
    const allocate = (
      element: HTMLElement,
      reference: TaskStaticAllocationReference,
      originTop: number
    ): void => {
      const top = reference.top - originTop;
      expect(declaredStyleValue(element, 'position')).toBe('static');
      ['top', 'right', 'bottom', 'left'].forEach((side) => {
        expect(declaredStyleValue(element, side)).toBe('auto');
      });
      expect(declaredStylePixels(element, 'width')).toBeCloseTo(reference.width, 6);
      expect(declaredStylePixels(element, 'height')).toBeCloseTo(reference.height, 6);
      expect(declaredStylePixels(element, 'margin-top')).toBeCloseTo(top, 6);
      expect(declaredStylePixels(element, 'margin-bottom')).toBeCloseTo(-(top + reference.height), 6);
      // Physical left anchoring keeps the allocation width and direction
      // independent, and clear must stay inert for the converted float.
      expect(declaredStyleValue(element, 'float')).toBe('left');
      expect(declaredStyleValue(element, 'clear')).toBe('none');
      expect(declaredStylePixels(element, 'margin-left')).toBeCloseTo(reference.left, 6);
      expect(declaredStylePixels(element, 'margin-right')).toBeCloseTo(-(reference.left + reference.width), 6);
    };
    const owners = [...holder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    expect(owners).toHaveLength(2);
    const transformOf = (element: HTMLElement): string =>
      declaredStyleValue(element, 'transform').replaceAll(' ', '');
    const expectedMarkers = 'none' === afterContent ? 1 : 2;
    const textPseudoContent = (content: string): boolean =>
      content.length > 2 && ((content.startsWith('"') && content.endsWith('"')) || (content.startsWith("'") && content.endsWith("'")));
    const expectedTaskFont = (isTextPseudo: boolean): string | undefined => {
      if (undefined === taskFont) return undefined;
      return '16px / 0px Arial' === taskFont && !isTextPseudo ? '16px Arial' : taskFont;
    };
    const expectedTaskLineHeight = (isTextPseudo: boolean): string => {
      if (undefined === taskLineHeight) return '';
      return '0px' === taskLineHeight && !isTextPseudo ? '' : taskLineHeight;
    };
    owners.forEach((owner, index) => {
      if (secondOwnerStatic && 1 === index) {
        expect(declaredStyleValue(owner, 'position')).toBe('static');
        const carriers = [...owner.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')];
        expect(carriers).toHaveLength(1);
        expect(carriers[0]?.getAttribute('style')).toBe('font-size:0;line-height:0');
        expect(carriers[0]?.textContent).toBe('x');
        return;
      }
      // The paint transform survives once, outside the allocation.
      expect(transformOf(owner)).toBe(ownerTransform.replaceAll(' ', ''));
      allocate(owner, TASK_OWNER_REFERENCE, expectedOwnerOriginTop ?? 0);
      if (undefined !== taskLineHeight) {
        expect(declaredStyleValue(owner, 'line-height')).toBe(expectedTaskLineHeight(false));
      }
      if (undefined !== taskFont) {
        expect(declaredStyleValue(owner, 'font')).toBe(expectedTaskFont(false));
      }
      const markers = [...owner.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')];
      expect(markers).toHaveLength(expectedMarkers);
      const circle = markers[0] as HTMLElement;
      const tick = markers[1];
      if ('static' === beforePosition) {
        // A normal flow circle stays in flow; the absolute tick still derives
        // its displacement from the origin at its own sibling slot.
        expect(declaredStyleValue(circle, 'position')).toBe('static');
        if (!tick) return;
        expect(transformOf(tick)).toBe('matrix(0.707107,0.707107,-0.707107,0.707107,-4.05,-7.74)');
        allocate(tick, TASK_TICK_REFERENCE, 0);
        return;
      }
      allocate(circle, TASK_CIRCLE_REFERENCE, 0);
      const circleHasText = textPseudoContent(beforeContent);
      if (undefined !== taskLineHeight) {
        expect(declaredStyleValue(circle, 'line-height')).toBe(expectedTaskLineHeight(circleHasText));
      }
      if (undefined !== taskFont) {
        expect(declaredStyleValue(circle, 'font')).toBe(expectedTaskFont(circleHasText));
      }
      if (circleHasText && '16px / 0px Arial' === taskFont) {
        // This fixed 16px paint box is the executable glyph-baseline contract:
        // preserving the zero line-height keeps Chromium's text glyph at its
        // authored top edge instead of shifting it by the inherited line box.
        expect(circle.textContent).toBe(expectedBeforeText);
        expect(declaredStyleValue(circle, 'font')).toBe('16px / 0px Arial');
        expect(declaredStyleValue(circle, 'line-height')).toBe('0px');
        expect(declaredStylePixels(circle, 'width')).toBeCloseTo(16, 6);
        expect(declaredStylePixels(circle, 'height')).toBeCloseTo(16, 6);
      }
      if (tick) {
        allocate(tick, TASK_TICK_REFERENCE, 0);
        const tickHasText = textPseudoContent(afterContent);
        if (undefined !== taskLineHeight) {
          expect(declaredStyleValue(tick, 'line-height')).toBe(expectedTaskLineHeight(tickHasText));
        }
        if (undefined !== taskFont) {
          expect(declaredStyleValue(tick, 'font')).toBe(expectedTaskFont(tickHasText));
        }
      }
      if (assertInlineCaption) {
        const caption = owner.nextSibling;
        expect(caption?.nodeType).toBe(Node.TEXT_NODE);
        expect(caption?.textContent).toBe(0 === index ? 'Ticked' : 'Open');
        expect(owner.nextElementSibling).toBeNull();
      }
    });
    if (assertSourceUnaffected) {
      await Promise.resolve();
      expect(sourceMutations).toHaveLength(0);
      expect(sourceInputs.map((input) => input.getAttribute('style'))).toEqual(sourceStyles);
    }
    if (secondWidth) {
      // The projected allocation must not bake the source container width.
      const allocationOf = (html: string): string => {
        const parsed = document.createElement('div');
        parsed.innerHTML = html;
        return [...parsed.querySelectorAll<HTMLElement>('[role="checkbox"], [role="checkbox"] span[aria-hidden="true"]')]
          .map((element) => element.getAttribute('style') ?? '')
          .join('\n');
      };
      const firstAllocation = allocationOf(holder.innerHTML);
      layoutWidth = secondWidth;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const secondBlob = secondItem?.payload['text/html'];
      if (!secondBlob) throw new Error('task flow cross width payload missing');
      expect(allocationOf(await blobText(secondBlob))).toBe(firstAllocation);
    }
  } finally {
    sourceObserver?.disconnect();
    workspace.remove();
    if (corruptAllocation || corruptClear) {
      Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
    }
    if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
    else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
    else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
    else delete (document as unknown as { execCommand?: unknown }).execCommand;
  }
}
