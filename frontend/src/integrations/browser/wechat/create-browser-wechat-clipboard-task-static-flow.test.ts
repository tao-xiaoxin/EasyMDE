import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const phycatSkyCss = readFileSync(
  resolve(process.cwd(), 'assets/themes/article/phycat-sky.css'),
  'utf8'
);

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  declaredStylePixels,
  declaredStyleValue,
  installClipboardTestEnvironment
} from './wechat-clipboard-test-fixtures';
import {
  TASK_LIST_CHECKBOX_CLONES,
  TASK_LIST_CHECKBOX_PSEUDO_CLONES
} from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime, SerializationYield } from './wechat-clipboard-runtime';
import type { TaskCheckboxGeometryLease } from './wechat-task-geometry';
import { taskCheckboxStaticPaintExpectationFor } from './wechat-task-paint';
import type { WechatPngConversionContext } from './wechat-png-conversion-policy';
import {
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
  type TaskCheckboxCaptionOwnerIdentity
} from './wechat-task-caption';
import { keepStyle, portableStyleValue } from './wechat-style-policy';
import {
  assertTaskCheckboxStaticFlowAllocations,
  normalizeTaskCheckboxStaticFlow,
  normalizeTaskCheckboxStaticFlowSynchronously
} from './wechat-task-static-flow';

type TaskStaticAllocationReference = Readonly<{ height: number; left: number; top: number; width: number }>;

describe('task checkbox style policy', () => {
  it('leaves an ordinary zero line-height font shorthand unchanged', () => {
    const ordinary = document.createElement('span');
    const font = '16px / 0px Arial';
    expect(portableStyleValue('font', font, ordinary, declaration({}))).toBe(font);
    expect(keepStyle('font', font, ordinary)).toBe(true);
  });
});

type TaskStaticAllocationOptions = Readonly<{
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

async function expectTaskStaticAllocation(options: TaskStaticAllocationOptions): Promise<void> {
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
        expect([...owner.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')]).toHaveLength(0);
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
        const caption = owner.nextElementSibling;
        expect(caption?.textContent).toBe(0 === index ? 'Ticked' : 'Open');
        expect((caption as HTMLElement | null)?.style.display).toBe('inline');
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

// The direct cases below drive the owner module itself, so they own the
// projected declaration of every recorded layer instead of the Clipboard path.
const DIRECT_OWNER_PROJECTION = [
  'appearance:none',
  'border-bottom-width:0px',
  'border-left-width:0px',
  'border-right-width:0px',
  'border-top-width:0px',
  'box-sizing:border-box',
  'display:inline-block',
  'height:20px',
  'left:-22px',
  'padding-bottom:0px',
  'padding-left:0px',
  'padding-right:0px',
  'padding-top:0px',
  'position:absolute',
  'top:3px',
  'width:20px'
].join(';');

type DirectStaticFlowOwner = Readonly<{
  layoutInput: HTMLInputElement;
  layoutParent: HTMLElement;
  owner: HTMLElement;
  sourceInput: HTMLInputElement;
}>;

type DirectStaticFlowCase = Readonly<{
  owners: readonly DirectStaticFlowOwner[];
  root: HTMLElement;
  runtime: BrowserWechatClipboardRuntime;
  visited: Element[];
}>;

type DirectStaticFlowOptions = Readonly<{
  ancestorRotate?: string;
  ancestorScale?: string;
  ancestorTransform?: string;
  ancestorTranslate?: string;
  layoutParentPaddingLeft?: string;
  layoutParentPaddingTop?: string;
  layoutParentPosition?: 'relative' | 'static';
  ownerZIndex?: string;
}>;

function directStaticFlowCase(
  offsets: readonly Readonly<{ left: string; top: string }>[] = [{ left: '-22px', top: '3px' }],
  options: DirectStaticFlowOptions = {}
): DirectStaticFlowCase {
  const root = document.createElement('div');
  const styles = new Map<Element, CSSStyleDeclaration>();
  const visited: Element[] = [];
  const {
    ancestorRotate,
    ancestorScale,
    ancestorTransform,
    ancestorTranslate,
    layoutParentPaddingLeft = '0px',
    layoutParentPaddingTop = '0px',
    layoutParentPosition = ancestorTransform || ancestorRotate || ancestorScale || ancestorTranslate ? 'static' : 'relative',
    ownerZIndex
  } = options;
  const owners = offsets.map(({ left, top }) => {
    const layoutParent = document.createElement('li');
    const layoutAncestor =
      ancestorTransform || ancestorRotate || ancestorScale || ancestorTranslate ? document.createElement('div') : null;
    const layoutInput = document.createElement('input');
    layoutParent.append(layoutInput);
    const owner = document.createElement('span');
    owner.setAttribute(
      'style',
      [DIRECT_OWNER_PROJECTION, ownerZIndex ? `z-index:${ownerZIndex}` : ''].filter(Boolean).join(';')
    );
    // The production walk only normalizes owners the clone pipeline registered.
    TASK_LIST_CHECKBOX_CLONES.add(owner);
    const ownerSlot = document.createElement('div');
    ownerSlot.append(owner);
    root.append(ownerSlot);
    if (layoutAncestor) layoutAncestor.append(layoutParent);
    styles.set(
      layoutParent,
      declaration({
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        display: 'block',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': '0px',
        'padding-bottom': '0px',
        'padding-left': layoutParentPaddingLeft,
        'padding-right': '0px',
        'padding-top': layoutParentPaddingTop,
        position: layoutParentPosition,
        width: '300px',
        ...(ancestorTransform ? { transform: 'none' } : {}),
        ...(ancestorRotate ? { rotate: 'none' } : {}),
        ...(ancestorScale ? { scale: 'none' } : {}),
        ...(ancestorTranslate ? { translate: 'none' } : {})
      })
    );
    if (layoutAncestor) {
      styles.set(
        layoutAncestor,
        declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          display: 'block',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'static',
          transform: ancestorTransform ?? 'none',
          ...(ancestorRotate ? { rotate: ancestorRotate } : {}),
          ...(ancestorScale ? { scale: ancestorScale } : {}),
          ...(ancestorTranslate ? { translate: ancestorTranslate } : {}),
          width: '400px'
        })
      );
    }
    styles.set(
      layoutInput,
      declaration({
        appearance: 'none',
        'border-bottom-width': '0px',
        'border-left-width': '0px',
        'border-right-width': '0px',
        'border-top-width': '0px',
        'box-sizing': 'border-box',
        display: 'inline-block',
        height: '20px',
        left,
        'margin-bottom': '0px',
        'margin-left': '0px',
        'margin-right': '0px',
        'margin-top': '0px',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': '0px',
        position: 'absolute',
        top,
        width: '20px',
        'z-index': ownerZIndex ?? 'auto'
      })
    );
    return { layoutInput, layoutParent, owner, sourceInput: document.createElement('input') };
  });
  const sequence: TaskCheckboxCaptionOwnerIdentity[] = owners.map(({ layoutInput, owner, sourceInput }) => ({
    cloneOwner: owner,
    clonePath: [],
    layoutInput,
    layoutPath: [],
    sourceInput,
    sourcePath: []
  }));
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, sequence);
  return {
    owners,
    root,
    runtime: {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (!pseudoElement) visited.push(element);
        return styles.get(element) ?? declaration({});
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    },
    visited
  };
}

type RelativeOwnerAbsolutePseudoCase = Readonly<{
  marker: HTMLElement;
  owner: HTMLElement;
  root: HTMLElement;
  runtime: BrowserWechatClipboardRuntime;
}>;

type RelativeOwnerAbsolutePseudoOptions = Readonly<{
  beforePosition?: 'absolute' | 'static';
  beforeZIndex?: string;
  afterZIndex?: string;
  ownerZIndex?: string;
}>;

function relativeOwnerAbsolutePseudoCase(
  options: RelativeOwnerAbsolutePseudoOptions = {}
): RelativeOwnerAbsolutePseudoCase {
  const root = document.createElement('div');
  const layoutParent = document.createElement('li');
  const layoutInput = document.createElement('input');
  const owner = document.createElement('span');
  const marker = document.createElement('span');
  const styles = new Map<Element, CSSStyleDeclaration>();
  const pseudoStyles = new Map<string, CSSStyleDeclaration>();
  const { beforePosition = 'static', beforeZIndex, afterZIndex, ownerZIndex } = options;

  owner.setAttribute(
    'style',
    [
      'box-sizing:border-box',
      'display:inline-block',
      'height:20px',
      'left:0px',
      'position:relative',
      'top:0px',
      'width:20px',
      ...(ownerZIndex ? [`z-index:${ownerZIndex}`] : [])
    ].join(';')
  );
  marker.setAttribute(
    'style',
    [
      'box-sizing:border-box',
      'display:block',
      'height:12px',
      'left:auto',
      'position:absolute',
      'right:-15.6px',
      'top:auto',
      'bottom:0px',
      'width:8px',
      ...(afterZIndex ? [`z-index:${afterZIndex}`] : [])
    ].join(';')
  );
  marker.setAttribute('aria-hidden', 'true');
  owner.append(marker);
  root.append(owner);
  layoutParent.append(layoutInput);
  TASK_LIST_CHECKBOX_CLONES.add(owner);
  TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, '::after');
  styles.set(
    layoutParent,
    declaration({
      'border-bottom-width': '0px',
      'border-left-width': '0px',
      'border-right-width': '0px',
      'border-top-width': '0px',
      'box-sizing': 'border-box',
      display: 'block',
      height: '40px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'relative',
      width: '300px'
    })
  );
  styles.set(owner, declaration({ position: 'relative', 'z-index': ownerZIndex ?? 'auto' }));
  styles.set(
    layoutInput,
    declaration({
      'border-bottom-width': '0px',
      'border-left-width': '0px',
      'border-right-width': '0px',
      'border-top-width': '0px',
      'box-sizing': 'border-box',
      display: 'inline-block',
      height: '20px',
      left: '0px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'relative',
      top: '0px',
      width: '20px'
    })
  );
  pseudoStyles.set(
    `${layoutInput}:before`,
    declaration({
      content: 'none',
      position: beforePosition,
      ...(beforeZIndex ? { 'z-index': beforeZIndex } : {})
    })
  );
  pseudoStyles.set(
    `${layoutInput}:after`,
    declaration({
      bottom: '0px',
      'box-sizing': 'border-box',
      content: '""',
      display: 'block',
      height: '12px',
      left: 'auto',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'margin-right': '0px',
      'margin-top': '0px',
      position: 'absolute',
      ...(afterZIndex ? { 'z-index': afterZIndex } : {}),
      right: '-15.6px',
      top: 'auto',
      width: '8px'
    })
  );
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [
    {
      cloneOwner: owner,
      clonePath: [],
      layoutInput,
      layoutPath: [],
      sourceInput: document.createElement('input'),
      sourcePath: []
    }
  ]);
  return {
    marker,
    owner,
    root,
    runtime: {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (pseudoElement) return pseudoStyles.get(`${element}:${pseudoElement.slice(2)}`) ?? declaration({});
        return styles.get(element) ?? declaration({});
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    }
  };
}

const conversionContext = (
  isCurrent: () => boolean,
  signal: AbortSignal = new AbortController().signal
): WechatPngConversionContext => ({
  captureBoundary: document.createElement('article'),
  imageUploadPort: {
    upload: async () => ({ code: 'wechat-test-upload-unavailable', status: 'failed' })
  },
  isCurrent,
  maxBytes: 1024,
  mermaidSnapshots: new Map(),
  postId: 17,
  rasterizationPort: {
    rasterize: async () => {
      throw new Error('wechat-test-rasterization-unavailable');
    }
  },
  scale: 1,
  signal,
  state: { uploadsMayRemain: false }
});

describe('normalizeTaskCheckboxStaticFlow', () => {
  it('does not subtract layout-parent padding twice in the measured-geometry fallback', () => {
    const { owners, root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
      layoutParentPaddingLeft: '8px',
      layoutParentPaddingTop: '6px'
    });
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');

    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);

    // jsdom exposes zero-sized rectangles, so this exercises the inset fallback.
    // The containing-block offset already contains the layout-parent padding;
    // each axis must be removed exactly once.
    expect(declaredStylePixels(recorded.owner, 'margin-left')).toBeCloseTo(-30, 6);
    expect(declaredStylePixels(recorded.owner, 'margin-top')).toBeCloseTo(-3, 6);
  });

  it('rejects an ancestor transform instead of mixing transformed and layout planes', () => {
    const { root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
      ancestorTransform: 'matrix(1, 0, 0, 1, 12, 4)'
    });

    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime)).toThrow(
      'wechat-task-checkbox-static-flow-transform-unavailable'
    );
  });

  it.each([
    ['rotate', { ancestorRotate: '90deg' }],
    ['scale', { ancestorScale: '1.2' }],
    ['translate', { ancestorTranslate: '12px' }]
  ] as const)('rejects an ancestor %s property instead of mixing transformed and layout planes', (_name, options) => {
    const { root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
      ...options,
      layoutParentPosition: 'relative'
    });

    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime)).toThrow(
      'wechat-task-checkbox-static-flow-transform-unavailable'
    );
  });

  it('keeps valid measured coordinates when the content parent has zero height', () => {
    const { owners, root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }]);
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
        x: left,
        y: top
      }) as DOMRect;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this === recorded.layoutParent) return rect(10, 20, 300, 0);
        if (this === recorded.layoutInput) return rect(15, 26, 20, 20);
        return originalRect?.value?.call(this) ?? rect(0, 0, 0, 0);
      }
    });
    try {
      normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
      expect(declaredStylePixels(recorded.owner, 'margin-left')).toBeCloseTo(5, 6);
      expect(declaredStylePixels(recorded.owner, 'margin-top')).toBeCloseTo(6, 6);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it('projects an absolute owner z-index into a relative float using the real Phycat rule', () => {
    const style = document.createElement('style');
    style.textContent = phycatSkyCss;
    const preview = document.createElement('article');
    preview.className = 'easymde-rendered-content easymde-markdown-theme-phycat-sky';
    preview.innerHTML = '<ul><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"></li></ul>';
    document.head.append(style);
    document.body.append(preview);
    try {
      const taskRule = /\.task-list-item input\s*\{[^}]*z-index\s*:\s*([^;}]+)/u.exec(phycatSkyCss);
      expect(taskRule?.[1]?.trim()).toBe('1');
      const zIndex = taskRule?.[1]?.trim() ?? '';
      const { owners, root, runtime } = directStaticFlowCase([{ left: '-22px', top: '3px' }], {
        ownerZIndex: zIndex
      });
      const [recorded] = owners;
      if (!recorded) throw new Error('direct static flow owner missing');
      normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
      expect(declaredStyleValue(recorded.owner, 'position')).toBe('relative');
      expect(declaredStyleValue(recorded.owner, 'z-index')).toBe('1');
      assertTaskCheckboxStaticFlowAllocations(recorded.owner);
    } finally {
      preview.remove();
      style.remove();
    }
  });

  it('projects z-index only for emitted absolute pseudo layers and reports missing registered markers', () => {
    const absent = relativeOwnerAbsolutePseudoCase({ beforePosition: 'absolute', beforeZIndex: '10' });
    // content:none has no output marker, so its authored z-index is irrelevant.
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(absent.root, absent.runtime)).not.toThrow();

    const emitted = relativeOwnerAbsolutePseudoCase({ afterZIndex: '2' });
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(emitted.root, emitted.runtime)).not.toThrow();
    expect(declaredStyleValue(emitted.marker, 'position')).toBe('relative');
    expect(declaredStyleValue(emitted.marker, 'z-index')).toBe('2');

    const missing = relativeOwnerAbsolutePseudoCase({ afterZIndex: '2' });
    taskCheckboxStaticPaintExpectationFor(missing.owner).pseudos.set('::after', {
      kind: 'text',
      properties: [],
      requiresText: false,
      svgPaintSignature: null
    });
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.delete(missing.marker);
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(missing.root, missing.runtime)).toThrow(
      'wechat-task-checkbox-static-owner-pseudo-missing'
    );
  });

  it('keeps a relative owner in flow while normalizing its absolute after pseudo from right and bottom insets', () => {
    const { marker, owner, root, runtime } = relativeOwnerAbsolutePseudoCase();

    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);

    expect(declaredStyleValue(owner, 'position')).toBe('relative');
    expect(declaredStyleValue(marker, 'position')).toBe('static');
    expect(declaredStyleValue(marker, 'float')).toBe('left');
    expect(declaredStylePixels(marker, 'width')).toBeCloseTo(8, 6);
    expect(declaredStylePixels(marker, 'height')).toBeCloseTo(12, 6);
    expect(declaredStylePixels(marker, 'margin-left')).toBeCloseTo(27.6, 6);
    expect(declaredStylePixels(marker, 'margin-top')).toBeCloseTo(8, 6);
    expect(declaredStylePixels(marker, 'margin-right')).toBeCloseTo(-35.6, 6);
    expect(declaredStylePixels(marker, 'margin-bottom')).toBeCloseTo(-20, 6);
    assertTaskCheckboxStaticFlowAllocations(owner);
  });

  it('preserves stacking for a relative owner and its absolute pseudo marker', () => {
    const { marker, owner, root, runtime } = relativeOwnerAbsolutePseudoCase({
      afterZIndex: '2',
      ownerZIndex: '4'
    });

    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);

    expect(declaredStyleValue(owner, 'position')).toBe('relative');
    expect(declaredStyleValue(owner, 'z-index')).toBe('4');
    expect(declaredStyleValue(marker, 'position')).toBe('relative');
    expect(declaredStyleValue(marker, 'z-index')).toBe('2');
    assertTaskCheckboxStaticFlowAllocations(owner);
  });

  it('normalizes the recorded owner sequence without querying the serialized root', () => {
    const { owners, root, runtime, visited } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const [first, second] = owners;
    if (!first || !second) throw new Error('direct static flow owners missing');
    // The inventory owns the sequence: a root-wide discovery lookup would throw.
    Object.defineProperty(root, 'querySelectorAll', {
      configurable: true,
      value: () => {
        throw new Error('wechat-test-root-query');
      }
    });
    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
    const visitedInputs = visited.filter(
      (element): element is HTMLInputElement => element instanceof HTMLInputElement
    );
    // Each owner reads its layout input several times, so the sequence is the
    // first-occurrence order of the recorded inventory.
    expect([...new Set(visitedInputs)]).toEqual([
      ...owners.map(({ layoutInput }) => layoutInput),
      ...owners.map(({ sourceInput }) => sourceInput)
    ]);
    expect(declaredStylePixels(first.owner, 'margin-left')).toBeCloseTo(-22, 6);
    expect(declaredStylePixels(first.owner, 'margin-top')).toBeCloseTo(3, 6);
    expect(declaredStylePixels(second.owner, 'margin-left')).toBeCloseTo(10, 6);
    expect(declaredStylePixels(second.owner, 'margin-top')).toBeCloseTo(30, 6);
    owners.forEach(({ owner }) => {
      expect(declaredStyleValue(owner, 'position')).toBe('static');
      expect(declaredStyleValue(owner, 'float')).toBe('left');
      assertTaskCheckboxStaticFlowAllocations(owner);
    });
  });

  it('rejects a recorded owner that is no longer part of the serialized root', () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    const known = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root)?.[0];
    if (!recorded || !known) throw new Error('direct static flow recording missing');
    const stranger = document.createElement('span');
    TASK_LIST_CHECKBOX_CLONES.add(stranger);
    TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [{ ...known, cloneOwner: stranger }]);
    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime)).toThrow(
      'wechat-task-checkbox-static-flow-owner-missing'
    );
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('absolute');
  });

  it('skips a recorded owner that was never registered as a projected clone', () => {
    // A hidden source control returns before paint registration, so its owner
    // keeps the projected declarations and the terminal validation owns it.
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    const known = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root)?.[0];
    if (!recorded || !known) throw new Error('direct static flow recording missing');
    const unprojected = document.createElement('span');
    unprojected.setAttribute('style', DIRECT_OWNER_PROJECTION);
    root.append(unprojected);
    TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [known, { ...known, cloneOwner: unprojected }]);
    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('static');
    expect(declaredStyleValue(unprojected, 'position')).toBe('absolute');
    expect(unprojected.getAttribute('style')).toBe(DIRECT_OWNER_PROJECTION);
  });

  it('re-derives the recorded allocation from the final declarations', () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    normalizeTaskCheckboxStaticFlowSynchronously(root, runtime);
    const { owner } = recorded;
    const allocation = owner.getAttribute('style') ?? '';
    assertTaskCheckboxStaticFlowAllocations(owner);
    // Later declarations win, so an overwritten allocation has to fail here.
    owner.setAttribute('style', `${allocation};margin-left:-18px!important`);
    expect(() => assertTaskCheckboxStaticFlowAllocations(owner)).toThrow(
      'wechat-task-checkbox-static-flow-allocation-mismatch'
    );
  });

  it('keeps the run synchronous while the serialization budget is unexhausted', async () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    const yields: number[] = [];
    const yieldToBrowser: SerializationYield = Object.assign(
      async (): Promise<void> => {
        yields.push(1);
      },
      { shouldYield: () => false }
    );
    await expect(normalizeTaskCheckboxStaticFlow(root, runtime, yieldToBrowser)).resolves.toBeUndefined();
    expect(yields).toHaveLength(0);
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('static');
  });

  it('suspends between owners only while the serialization budget is due', async () => {
    const { owners, root, runtime } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const allocatedAtYield: string[] = [];
    const yieldToBrowser: SerializationYield = Object.assign(
      async (): Promise<void> => {
        allocatedAtYield.push(owners.map(({ owner }) => declaredStyleValue(owner, 'position')).join(','));
      },
      { shouldYield: () => true }
    );
    await normalizeTaskCheckboxStaticFlow(root, runtime, yieldToBrowser);
    // The boundary runs after each owner, so the second owner is still
    // projected while the first boundary is observed.
    expect(allocatedAtYield).toEqual(['static,absolute', 'static,static']);
  });

  it('stops before the first owner when the caller is already aborted', async () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    const controller = new AbortController();
    controller.abort();
    await expect(normalizeTaskCheckboxStaticFlow(root, runtime, null, undefined, controller.signal)).rejects.toThrow(
      'wechat-background-preparation-cancelled'
    );
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('absolute');
  });

  it('stops before the next owner when the caller aborts during a boundary', async () => {
    const { owners, root, runtime } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const [first, second] = owners;
    if (!first || !second) throw new Error('direct static flow owners missing');
    const controller = new AbortController();
    const yieldToBrowser: SerializationYield = Object.assign(
      async (): Promise<void> => {
        controller.abort();
      },
      { shouldYield: () => true }
    );
    await expect(
      normalizeTaskCheckboxStaticFlow(root, runtime, yieldToBrowser, undefined, controller.signal)
    ).rejects.toThrow('wechat-background-preparation-cancelled');
    expect(declaredStyleValue(first.owner, 'position')).toBe('static');
    expect(declaredStyleValue(second.owner, 'position')).toBe('absolute');
  });

  it('stops when the conversion is no longer current', async () => {
    const { owners, root, runtime } = directStaticFlowCase();
    const [recorded] = owners;
    if (!recorded) throw new Error('direct static flow owner missing');
    await expect(normalizeTaskCheckboxStaticFlow(root, runtime, null, conversionContext(() => false))).rejects.toThrow(
      'wechat-png-rasterization-cancelled'
    );
    expect(declaredStyleValue(recorded.owner, 'position')).toBe('absolute');
  });

  it('checks conversion currentness around every owner', async () => {
    const { owners, root, runtime } = directStaticFlowCase([
      { left: '-22px', top: '3px' },
      { left: '10px', top: '30px' }
    ]);
    const [first, second] = owners;
    if (!first || !second) throw new Error('direct static flow owners missing');
    let checks = 0;
    // The first owner passes both of its boundary checks, so a stale conversion
    // has to stop the run before the second owner is normalized.
    await expect(
      normalizeTaskCheckboxStaticFlow(root, runtime, null, conversionContext(() => 3 > ++checks))
    ).rejects.toThrow('wechat-png-rasterization-cancelled');
    expect(declaredStyleValue(first.owner, 'position')).toBe('static');
    expect(declaredStyleValue(second.owner, 'position')).toBe('absolute');
  });
});

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([335, 677] as const)(
    'derives the static task allocation from the measured formatting context at %ipx',
    async (width) => {
      await expectTaskStaticAllocation({ width });
    }
  );

  it('keeps the untransformed static allocation while the owner paints through a transform', async () => {
    await expectTaskStaticAllocation({
      assertSourceUnaffected: true,
      ownerTransform: 'matrix(1.05, 0, 0, 1.05, 0, 0)',
      width: 335
    });
  });

  it('derives an absolute pseudo allocation from the origin at its sibling slot', async () => {
    await expectTaskStaticAllocation({ beforePosition: 'static', width: 335 });
  });

  it.each([false, true] as const)('omits task zero line-height from static paint and keeps text/caption flow intact (%s path)', async (synchronousCopy) => {
    await expectTaskStaticAllocation({
      assertInlineCaption: true,
      assertSourceUnaffected: true,
      beforeContent: '"✓"',
      expectedBeforeText: '✓',
      synchronousCopy,
      taskFont: '16px / 0px Arial',
      taskLineHeight: '0px',
      width: 335
    });
  });

  it.each([false, true] as const)('preserves non-zero task line-height for text pseudo paint (%s path)', async (synchronousCopy) => {
    await expectTaskStaticAllocation({
      beforeContent: '"✓"',
      expectedBeforeText: '✓',
      synchronousCopy,
      taskFont: '16px / 18px Arial',
      taskLineHeight: '18px',
      width: 335
    });
  });

  it('derives the task owner allocation from its containing block padding box', async () => {
    await expectTaskStaticAllocation({ sectionPaddingTop: '4px', width: 335 });
  });

  it('copies a mixed task list with one geometry owner and one ordinary static owner', async () => {
    await expectTaskStaticAllocation({
      assertSourceUnaffected: true,
      ownerTransform: 'matrix(1.05, 0, 0, 1.05, 0, 0)',
      secondOwnerStatic: true,
      width: 335
    });
  });

  it('fails explicitly when a geometry lease has no source measurement', () => {
    const { root, runtime } = directStaticFlowCase();
    const identity = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root)?.[0];
    if (!identity) throw new Error('static flow identity missing');
    const sourceInput = identity.layoutInput;
    sourceInput.classList.add('easymde-task-checkbox');
    sourceInput.setAttribute('type', 'checkbox');
    const sourceStyle = sourceInput.getAttribute('style');
    TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, [{ ...identity, sourceInput }]);
    const geometryLease: TaskCheckboxGeometryLease = {
      cleanup: vi.fn(),
      isReady: () => true,
      measurementFor: () => null,
      ready: Promise.resolve(),
      root: document.createElement('div'),
      scopeRoot: document.createElement('div'),
      sourceGeometryReference: 'source',
      sourceMarkup: '',
      sourceFor: () => null,
      sourceRoot: document.createElement('div'),
      sourceWidthKey: null,
      wait: () => Promise.resolve()
    };

    expect(() => normalizeTaskCheckboxStaticFlowSynchronously(root, runtime, geometryLease)).toThrow(
      'wechat-task-checkbox-static-flow-measurement-missing'
    );
    expect(sourceInput.getAttribute('style')).toBe(sourceStyle);
  });

  it('fails explicitly when a painted task pseudo has no measurable allocation', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-dimensions-unavailable',
      pseudoWidth: 'auto',
      width: 335
    });
  });

  it('fails explicitly when a flex owner cannot host the static task allocation', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-container-unavailable',
      ownerDisplay: 'flex',
      width: 335
    });
  });

  it('fails explicitly when the normalized allocation is corrupted before the final assertion', async () => {
    await expectTaskStaticAllocation({
      corruptAllocation: true,
      expectedError: 'wechat-task-checkbox-static-flow-allocation-mismatch',
      width: 335
    });
  });

  it('ignores a CSS hidden source sibling before the owner', async () => {
    // The computed layout style decides flow participation, not the projected
    // attribute of a source sibling.
    await expectTaskStaticAllocation({ precedingSibling: 'hidden', width: 335 });
  });

  it('ignores an out of flow source sibling before the owner', async () => {
    await expectTaskStaticAllocation({ precedingSibling: 'absolute', width: 335 });
  });

  it('fails explicitly when a floated source sibling constrains the static task allocation', async () => {
    // A prior float in the same formatting context can displace the normalized
    // float, and the captured projection does not prove that offset.
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      precedingSibling: 'float',
      width: 335
    });
  });

  it('fails explicitly when a logical floated source sibling constrains the static task allocation', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      precedingSibling: 'logical-float',
      width: 335
    });
  });

  it('ignores an absolutely positioned floated source sibling before the owner', async () => {
    // Float is inert on an absolutely positioned box, so the prior sibling stays
    // out of flow and the prospective origin remains provable.
    await expectTaskStaticAllocation({ precedingSibling: 'absolute-float', width: 335 });
  });

  it('fails explicitly when a floated sibling of a consumed chain box constrains the static task allocation', async () => {
    // The float can displace the chain box that owns the layout slot, so the
    // consumed containing block offset is no longer provable.
    await expectTaskStaticAllocation({
      chainSibling: 'float',
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      width: 335
    });
  });

  it('ignores an absolutely positioned sibling of a consumed chain box', async () => {
    // Float is inert on an absolutely positioned box, so the chain offset stays
    // provable and the sibling stays out of flow.
    await expectTaskStaticAllocation({ chainSibling: 'absolute', width: 335 });
  });

  it('keeps the physical task allocation across source widths', async () => {
    // The captured source width must not leak into the emitted allocation.
    await expectTaskStaticAllocation({ secondWidth: 677, width: 335 });
  });

  it('fails explicitly when an emitted in flow pseudo keeps active offsets', async () => {
    await expectTaskStaticAllocation({
      beforePosition: 'relative',
      expectedError: 'wechat-task-checkbox-static-flow-position-unavailable',
      width: 335
    });
  });

  it('keeps inert source clear on the converted static task layers', async () => {
    await expectTaskStaticAllocation({ sourceClear: 'both', width: 335 });
  });

  it('fails explicitly when the projected clear value is tampered with', async () => {
    await expectTaskStaticAllocation({
      corruptClear: true,
      expectedError: 'wechat-task-checkbox-static-flow-allocation-mismatch',
      width: 335
    });
  });

  it('fails explicitly when a normal flow pseudo produces line boxes', async () => {
    await expectTaskStaticAllocation({
      beforeContent: '"★"',
      beforePosition: 'static',
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      width: 335
    });
  });

  it('keeps the containing block plane when an intermediate box only contains size', async () => {
    await expectTaskStaticAllocation({
      liPaddingTop: '4px',
      sectionMarginTop: '8px',
      sectionNonContainingBlock: 'contain-size',
      width: 335
    });
  });

  it('keeps the containing block plane when an intermediate box only will changes opacity', async () => {
    await expectTaskStaticAllocation({
      liPaddingTop: '4px',
      sectionMarginTop: '8px',
      sectionNonContainingBlock: 'will-change-opacity',
      width: 335
    });
  });

  it('keeps the margin collapse context when an intermediate box clips overflow', async () => {
    // Clipping overflow is not a block formatting context, so the section's
    // first-child margin collapses through the list item and still moves the
    // layout-parent content plane by the collapsed margin.
    await expectTaskStaticAllocation({ liOverflow: 'clip', sectionMarginTop: '8px', width: 335 });
  });

  it('preserves a 20px first-child margin collapse in the static allocation', async () => {
    await expectTaskStaticAllocation({ liOverflow: 'clip', sectionMarginTop: '20px', width: 335 });
  });

  it('uses the settled layout position when outer margin collapse differs from the owner slot', async () => {
    await expectTaskStaticAllocation({
      expectedOwnerOriginTop: 0,
      liOverflow: 'clip',
      sectionMarginTop: '20px',
      width: 335
    });
  });

  it('ignores an absent pseudo that authors a non portable effect', async () => {
    // The tick is not emitted, so its authored rotate must not fail the copy.
    await expectTaskStaticAllocation({ afterContent: 'none', afterRotate: '90deg', width: 335 });
  });

  it('fails explicitly when a consumed ancestor paints through a non portable rotate', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-transform-unavailable',
      liRotate: '90deg',
      width: 335
    });
  });

  it('fails explicitly when the owner paints through a non portable rotate', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-transform-unavailable',
      ownerRotate: '90deg',
      width: 335
    });
  });

  it('keeps the physical task allocation for a right to left owner', async () => {
    // The physical anchor keeps the allocation direction independent, so an
    // RTL owner inside an LTR section keeps the same left anchored margins.
    await expectTaskStaticAllocation({ ownerDirection: 'rtl', width: 335 });
  });

  it('keeps the physical task allocation for a right to left formatting context', async () => {
    await expectTaskStaticAllocation({ direction: 'rtl', width: 335 });
  });
});
