import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  declaredStyleDeclarations,
  declaredStylePixels,
  declaredStyleValue,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('exports every task checkbox through an aligned static owner', async () => {
    const modernWrites: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    const initialTaskStates = Array.from({ length: 19 }, (_, index) => ![2, 15].includes(index));
    const taskStates = initialTaskStates.map((checked, index) => (1 === index ? false : checked));
    const relativeOwnerIndex = 17;
    const taskText = taskStates.map((_, index) => `Task ${index + 1}`).join('\n');
    const workspace = document.createElement('div');
    workspace.className = 'task-owner-workspace';
    preview.innerHTML = [
      '<ul class="task-list">',
      ...initialTaskStates.map(
        (checked, index) =>
          `<li class="task-list-item"><section><input class="easymde-task-checkbox${18 === index ? ' native' : ''}${relativeOwnerIndex === index ? ' relative-owner' : ''}" type="checkbox"${checked ? ' checked' : ''}>Task ${index + 1}</section></li>`
      ),
      '</ul>',
      '<ul class="ordinary-list"><li class="ordinary-list-item"></li></ul>',
      '<form><input type="text" name="secret" value="private"></form>'
    ].join('');
    const propertyDivergenceInput = preview.querySelectorAll<HTMLInputElement>('input.easymde-task-checkbox')[1];
    if (!propertyDivergenceInput) throw new Error('task property divergence input missing');
    propertyDivergenceInput.checked = false;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: taskText });
    workspace.append(preview);
    document.body.append(workspace);
    const sourceMarkup = preview.innerHTML;
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName) {
        const input = element as HTMLInputElement;
        const native = input.classList.contains('native');
        const relativeOwner = input.classList.contains('relative-owner');
        if (pseudoElement && native) return declaration({ content: 'none' });
        if ('::before' === pseudoElement) {
          return declaration({
            'background-color': 'rgb(255, 255, 255)',
            'border-bottom-width': '1px',
            'border-left-width': '1px',
            'border-radius': '50%',
            'border-right-width': '1px',
            'border-top-width': '1px',
            'box-sizing': 'border-box',
            content: '""',
            display: 'block',
            height: '16px',
            left: relativeOwner ? '0px' : '18px',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: relativeOwner ? 'relative' : 'absolute',
            top: relativeOwner ? '0px' : '-2px',
            width: '16px'
          });
        }
        if ('::after' === pseudoElement) {
          return declaration({
            'border-bottom-color': 'rgb(255, 255, 255)',
            'border-bottom-style': 'solid',
            'border-bottom-width': '2px',
            'border-right-color': 'rgb(255, 255, 255)',
            'border-right-style': 'solid',
            'border-right-width': '2px',
            'box-sizing': 'content-box',
            content: '""',
            display: 'block',
            height: '10px',
            left: '27.6px',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            opacity: input.checked ? '1' : '0',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'absolute',
            top: '8px',
            width: '6px'
          });
        }
        return declaration({
          '-webkit-appearance': 'none',
          'accent-color': native ? 'rgb(52, 152, 219)' : input.checked ? 'rgb(255, 192, 0)' : 'auto',
          appearance: 'none',
          ...(native
            ? {
                'background-color': 'rgb(255, 255, 255)',
                'border-color': 'rgb(52, 152, 219)',
                'border-style': 'solid',
                'border-width': '1px'
              }
            : {}),
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'box-sizing': 'border-box',
          display: 'inline-block',
          height: '20px',
          left: relativeOwner ? '0px' : '-22px',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: relativeOwner ? 'relative' : 'absolute',
          top: relativeOwner ? '0px' : '3px',
          width: '20px'
        });
      }
      if ('UL' === element.tagName && element.classList.contains('ordinary-list')) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'block',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'padding-left': '1px',
          'padding-right': '0px',
          'writing-mode': 'horizontal-tb'
        });
      }
      if ('UL' === element.tagName) {
        // A real Preview computes the authored `disc` marker on the task list
        // (for example the phycat theme's `ul` rule), so the copied
        // declaration must be replaced, not appended.
        return declaration({ display: 'block', 'list-style-type': 'disc' });
      }
      if ('LI' === element.tagName) {
        const ordinary = element.classList.contains('ordinary-list-item');
        return declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'counter-increment': ordinary ? 'none' : '',
          'counter-reset': ordinary ? 'none' : '',
          'counter-set': ordinary ? 'none' : '',
          direction: ordinary ? 'ltr' : '',
          display: ordinary ? 'list-item' : 'block',
          'list-style-image': ordinary ? 'none' : '',
          'list-style-position': ordinary ? 'outside' : '',
          'list-style-type': 'disc',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': ordinary ? '1px' : '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'relative',
          'writing-mode': ordinary ? 'horizontal-tb' : ''
        });
      }
      if ('SECTION' === element.tagName) {
        return declaration({
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
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'static'
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.task-owner-workspace')) {
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if ('ARTICLE' === this.tagName || ('UL' === this.tagName && this.classList.contains('task-list'))) {
          return { bottom: 120, height: 120, left: 0, right: 300, top: 0, width: 300, x: 0, y: 0 } as DOMRect;
        }
        if ('SECTION' === this.tagName) {
          return { bottom: 130, height: 40, left: 80, right: 380, top: 80, width: 300, x: 80, y: 80 } as DOMRect;
        }
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 103, height: 20, left: 58, right: 78, top: 83, width: 20, x: 58, y: 83 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 40, left: 100, right: 400, top: 90, width: 300, x: 100, y: 90 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 0 === index ? 100 : 116;
          return { bottom: 116, height: 0, left, right: left, top: 116, width: 0, x: left, y: 116 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: (): DOMRect[] => [
        { bottom: 116, height: 16, left: 116, right: 172, top: 102, width: 56, x: 116, y: 102 } as DOMRect
      ]
    });
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        modernWrites.push(items);
      }
    });

    try {
      await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (modernWrites[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('task checkbox payload missing');
      const textBlob = item?.payload['text/plain'];
      if (!textBlob) throw new Error('task checkbox plain payload missing');
      await expect(blobText(textBlob)).resolves.toBe(taskText);
      const modernHtml = await blobText(htmlBlob);
      const holder = document.createElement('div');
      holder.innerHTML = modernHtml;
      const owners = [...holder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(holder.querySelectorAll('input')).toHaveLength(0);
      expect(holder.querySelector('input[type="text"]')).toBeNull();
      expect(owners).toHaveLength(taskStates.length);
      expect(owners.map((owner) => owner.getAttribute('aria-checked'))).toEqual(
        taskStates.map((checked) => (checked ? 'true' : 'false'))
      );
      expect(owners.every((owner) => owner.getAttribute('aria-disabled') === 'true')).toBe(true);
      expect(owners.every((owner) => Boolean(owner.getAttribute('style')))).toBe(true);
      expect(owners.every((owner) => owner.parentElement?.tagName === 'SECTION')).toBe(true);
      // Destination-safe projection replaces the complete task list and every
      // task item with sections. The task structure is therefore the lowest
      // common section ancestor of all owners, and its section children are the
      // projected task items.
      const commonAncestor = (elements: readonly Element[]): HTMLElement | null => {
        let current: HTMLElement | null = elements[0]?.parentElement ?? null;
        while (current && !elements.every((element) => current?.contains(element))) {
          current = current.parentElement;
        }
        return current;
      };
      const taskList = commonAncestor(owners);
      if (!taskList) throw new Error('task list missing');
      expect(taskList.getAttribute('class')).toBeNull();
      const taskItemSections = [...taskList.children].filter(
        (element): element is HTMLElement => element instanceof HTMLElement && 'SECTION' === element.tagName
      );
      expect(taskItemSections).toHaveLength(taskStates.length);
      expect(holder.querySelector('ul section, ol section')).toBeNull();
      const expectTaskMarkerSuppression = (element: Element): void => {
        // Native WeChat Save strips declaration priority, so a copied `disc`
        // left before an appended `none!important` re-appears as a second
        // marker. The task structure must carry the replaced value only.
        expect(declaredStyleDeclarations(element, 'list-style-type')).toEqual([
          { important: true, property: 'list-style-type', value: 'none' }
        ]);
        expect(declaredStyleDeclarations(element, 'list-style-image')).toEqual([
          { important: true, property: 'list-style-image', value: 'none' }
        ]);
      };
      expectTaskMarkerSuppression(taskList);
      taskItemSections.forEach(expectTaskMarkerSuppression);
      const ordinaryList = [...holder.querySelectorAll('ul')].find((list) => !list.querySelector('[role="checkbox"]'));
      if (!ordinaryList) throw new Error('ordinary list missing');
      expect(declaredStyleDeclarations(ordinaryList, 'list-style-type')).toEqual([
        { important: false, property: 'list-style-type', value: 'disc' }
      ]);
      expect(declaredStyleDeclarations(ordinaryList, 'list-style-image')).toEqual([]);
      expect(owners.filter((owner) => owner.querySelector('span[aria-hidden="true"]'))).toHaveLength(18);
      // Captured allocation of the settled Preview: owner at (-22, 3) with a
      // 20x20 border box, circle at (18, -2) with a 16x16 border box and the
      // tick at (27.6, 8) with a promoted 8x12 border box.
      const capturedOwner = { height: 20, left: -22, top: 3, width: 20 };
      const capturedCircle = { height: 16, left: 18, top: -2, width: 16 };
      const capturedTick = { height: 12, left: 27.6, top: 8, width: 8 };
      const expectStaticAllocation = (
        element: HTMLElement,
        captured: Readonly<{ height: number; left: number; top: number; width: number }>
      ): void => {
        expect(declaredStyleValue(element, 'position')).toBe('static');
        expect(declaredStyleValue(element, 'float')).toBe('left');
        ['top', 'right', 'bottom', 'left'].forEach((side) => {
          expect(declaredStyleValue(element, side)).toBe('auto');
        });
        expect(declaredStylePixels(element, 'width')).toBeCloseTo(captured.width, 6);
        expect(declaredStylePixels(element, 'height')).toBeCloseTo(captured.height, 6);
        // The float must land on the captured allocation and keep a zero net
        // advance, so neither the caption nor the row height can move.
        expect(declaredStylePixels(element, 'margin-left')).toBeCloseTo(captured.left, 6);
        expect(declaredStylePixels(element, 'margin-top')).toBeCloseTo(captured.top, 6);
        expect(declaredStylePixels(element, 'margin-right')).toBeCloseTo(-(captured.left + captured.width), 6);
        expect(declaredStylePixels(element, 'margin-bottom')).toBeCloseTo(-(captured.top + captured.height), 6);
      };
      owners.forEach((owner, index) => {
        const markers = [...owner.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')];
        if (relativeOwnerIndex === index) {
          // A relative owner stays in flow and only its absolute pseudo layers
          // are converted.
          expect(declaredStyleValue(owner, 'position')).toBe('relative');
          expect(markers).toHaveLength(2);
          expect(declaredStyleValue(markers[0] as HTMLElement, 'position')).toBe('relative');
          expectStaticAllocation(markers[1] as HTMLElement, capturedTick);
          return;
        }
        expectStaticAllocation(owner, capturedOwner);
        if (18 === index) {
          expect(markers).toHaveLength(0);
          return;
        }
        expect(markers).toHaveLength(2);
        expectStaticAllocation(markers[0] as HTMLElement, capturedCircle);
        expectStaticAllocation(markers[1] as HTMLElement, capturedTick);
      });
      expect(
        owners.filter((owner) => owner.querySelectorAll(':scope > span[aria-hidden="true"]').length > 0)
      ).toHaveLength(18);
      expect(owners[18]?.querySelectorAll(':scope > span[aria-hidden="true"]')).toHaveLength(0);
      expect(holder.querySelectorAll('li span[leaf]')).toHaveLength(0);
      expect(modernHtml).toContain('\u2060');
      expect(modernHtml).not.toContain('✓');
      expect(preview.innerHTML).toBe(sourceMarkup);

      let legacyHtml = '';
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(legacy, preview);
        await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      const strippedPreview = preview.cloneNode(true) as HTMLElement;
      Object.defineProperty(strippedPreview, 'innerText', { configurable: true, value: taskText });
      workspace.append(strippedPreview);
      const strippedInput = strippedPreview.querySelectorAll<HTMLInputElement>('input.easymde-task-checkbox')[1];
      if (!strippedInput) throw new Error('stripped task input missing');
      const strippedWrites: unknown[] = [];
      const originalSetAttribute = Element.prototype.setAttribute;
      Object.defineProperty(Element.prototype, 'setAttribute', {
        configurable: true,
        value: function (this: Element, name: string, value: string): void {
          let strippedStyle: string | null = null;
          if ('style' === name && this.matches('span') && value.includes('accent-color:')) {
            strippedStyle = value
              .split(';')
              .filter((declaration) => {
                const property = declaration.slice(0, declaration.indexOf(':')).trim().toLowerCase();
                return (
                  !property.startsWith('background') &&
                  !property.startsWith('border-') &&
                  !['box-shadow', 'filter'].includes(property)
                );
              })
              .join(';');
          }
          originalSetAttribute.call(this, name, value);
          if (strippedStyle !== null) {
            queueMicrotask(() => originalSetAttribute.call(this, name, strippedStyle as string));
          }
        }
      });
      try {
        const stripped = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: ClipboardItemStub,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: async (items) => {
            strippedWrites.push(items);
          }
        });
        strippedInput.checked = true;
        const strippedResult = await stripped.copy(strippedPreview);
        expect(strippedResult).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        const strippedItem = (strippedWrites[0] as ClipboardItemStub[])[0];
        const strippedBlob = strippedItem?.payload['text/html'];
        if (!strippedBlob) throw new Error('stripped task checkbox payload missing');
        await expect(blobText(strippedBlob)).rejects.toThrow('wechat-task-checkbox-static-owner-paint-mismatch');
      } finally {
        strippedInput.checked = false;
        Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      }

      const missingPseudoPreview = preview.cloneNode(true) as HTMLElement;
      Object.defineProperty(missingPseudoPreview, 'innerText', { configurable: true, value: taskText });
      workspace.append(missingPseudoPreview);
      const missingPseudoWrites: unknown[] = [];
      const originalInsertBefore = Element.prototype.insertBefore;
      Object.defineProperty(Element.prototype, 'insertBefore', {
        configurable: true,
        value: function (this: Element, node: Node, reference: Node | null): Node {
          if (
            node instanceof Element &&
            node.matches('span[aria-hidden="true"]') &&
            this.matches('span') &&
            this.getAttribute('style')?.includes('accent-color:')
          ) {
            return node;
          }
          return originalInsertBefore.call(this, node, reference);
        }
      });
      try {
        const missingPseudo = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: ClipboardItemStub,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: async (items) => {
            missingPseudoWrites.push(items);
          }
        });
        await expect(missingPseudo.copy(missingPseudoPreview)).resolves.toEqual({
          code: 'wechat-copy-failed',
          status: 'failed'
        });
        const missingPseudoItem = (missingPseudoWrites[0] as ClipboardItemStub[])[0];
        const missingPseudoBlob = missingPseudoItem?.payload['text/html'];
        if (!missingPseudoBlob) throw new Error('missing task pseudo payload');
        await expect(blobText(missingPseudoBlob)).rejects.toThrow('wechat-task-checkbox-static-owner-pseudo-missing');
      } finally {
        Object.defineProperty(Element.prototype, 'insertBefore', { configurable: true, value: originalInsertBefore });
      }
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      expect(legacyHtml).toBe(modernHtml);
      const legacyOwners = [...legacyHolder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(legacyOwners).toHaveLength(owners.length);
      const legacyTaskList = commonAncestor(legacyOwners);
      if (!legacyTaskList) throw new Error('legacy task list missing');
      expectTaskMarkerSuppression(legacyTaskList);
      expect(
        [...legacyTaskList.children].filter(
          (element): element is HTMLElement => element instanceof HTMLElement && 'SECTION' === element.tagName
        )
      ).toHaveLength(taskStates.length);
      const legacyOrdinaryList = [...legacyHolder.querySelectorAll('ul')].find(
        (list) => !list.querySelector('[role="checkbox"]')
      );
      if (!legacyOrdinaryList) throw new Error('legacy ordinary list missing');
      expect(declaredStyleDeclarations(legacyOrdinaryList, 'list-style-type')).toEqual([
        { important: false, property: 'list-style-type', value: 'disc' }
      ]);
      // Legacy shares the validated static allocation byte for byte.
      expect(legacyOwners.map((owner) => owner.getAttribute('style'))).toEqual(
        owners.map((owner) => owner.getAttribute('style'))
      );
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      workspace.remove();
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      }
      if (originalRangeClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      } else {
        delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      }
    }
  });

  it('regenerates a warm task payload when the source checked property changes', async () => {
    const writes: unknown[] = [];
    let accentColor = 'rgb(18, 52, 86)';
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Todo</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Todo' });
    const input = preview.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) throw new Error('warm task checkbox missing');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({
              appearance: 'none',
              'accent-color': accentColor,
              display: 'inline-block',
              height: '12px',
              width: '12px'
            })
          : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    accentColor = 'rgb(101, 67, 33)';
    input.checked = true;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[1] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('warm task payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(holder.querySelector('[role="checkbox"]')?.getAttribute('style')).toContain('accent-color:rgb(101, 67, 33)');
  });

  it('rejects a task paint change during async preparation', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/task-freshness.png', document.baseURI).href;
    let accentColor = 'rgb(18, 52, 86)';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Async task</li></ul><p>Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Async task\nDelay image' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('INPUT' === element.tagName) {
          return declaration({
            'accent-color': accentColor,
            appearance: 'none',
            display: 'inline-block',
            height: '12px',
            width: '12px'
          });
        }
        if ('P' === element.tagName) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    accentColor = 'rgb(101, 67, 33)';
    pendingImage.resolve({
      blob: async () => new Blob(['task freshness'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
  });

  it('fails explicitly when a task checkbox relies on unknown native paint', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Native</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Native' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({ appearance: 'auto', display: 'inline-block', height: '16px', width: '16px' })
          : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async () => undefined
    });

    await expect(clipboard.copy(preview)).resolves.toMatchObject({ code: 'wechat-copy-failed', status: 'failed' });
  });


  it('verifies final task SVG owner faults after a passing owner', async () => {
    const svgPath = 'M14.83 4.89l1.34.94-5.81 8.38H9.02L5.78 9.67l1.34-1.25 2.57 2.4z';
    const svgContent = `url("data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="${svgPath}" fill="#3582c4"/></svg>`
    )}") / ''`;
    type Variant = 'positive' | 'drop-svg' | 'empty-path' | 'remove-paint';
    const cases: ReadonlyArray<Readonly<{ expectedError?: string; variant: Variant }>> = [
      { variant: 'positive' },
      { expectedError: 'wechat-task-checkbox-static-owner-svg-paint-missing', variant: 'drop-svg' },
      { expectedError: 'wechat-task-checkbox-static-owner-svg-paint-missing', variant: 'empty-path' },
      { expectedError: 'wechat-task-checkbox-static-owner-svg-paint-missing', variant: 'remove-paint' }
    ];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const createPreview = (): Readonly<{ preview: HTMLElement; workspace: HTMLElement }> => {
      const workspace = document.createElement('div');
      workspace.className = 'svg-owner-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>SVG check</li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'SVG check' });
      workspace.append(preview);
      document.body.append(workspace);
      return { preview, workspace };
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          content: svgContent,
          display: 'block',
          height: '16px',
          position: 'relative',
          width: '16px'
        });
      }
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
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
      if ('ARTICLE' === element.tagName && element.closest('.svg-owner-workspace')) {
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const originalImage = window.Image;
    const originalCanvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.svg-owner-workspace')) {
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (
          this.closest('.svg-owner-workspace') &&
          ('ARTICLE' === this.tagName || ('UL' === this.tagName && this.classList.contains('task-list')))
        ) {
          return { bottom: 120, height: 120, left: 0, right: 300, top: 0, width: 300, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 116, height: 16, left: 100, right: 116, top: 100, width: 16, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 40, left: 100, right: 400, top: 90, width: 300, x: 100, y: 90 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: (): DOMRect[] => [
        { bottom: 118, height: 16, left: 116, right: 172, top: 102, width: 56, x: 116, y: 102 } as DOMRect
      ]
    });
    class ImageStub {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      decode(): Promise<void> {
        return Promise.resolve();
      }
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    Object.defineProperty(window, 'Image', { configurable: true, value: ImageStub });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement): CanvasRenderingContext2D {
        return {
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }))
        } as unknown as CanvasRenderingContext2D;
      }
    });
    try {
      for (const { expectedError, variant } of cases) {
        const { preview, workspace } = createPreview();
        const writes: unknown[] = [];
        const originalAppendChild = Node.prototype.appendChild;
        let faultHit = false;
        if (variant !== 'positive') {
          Object.defineProperty(Node.prototype, 'appendChild', {
            configurable: true,
            value: function (this: Node, node: Node): Node {
              if (this instanceof Element && this.matches('span[aria-hidden="true"]') && node instanceof SVGElement) {
                faultHit = true;
                const path = node.querySelector('path');
                if ('drop-svg' === variant) return node;
                if ('empty-path' === variant) path?.setAttribute('d', '');
                if ('remove-paint' === variant) path?.setAttribute('fill', 'none');
              }
              return originalAppendChild.call(this, node);
            }
          });
        }
        try {
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
          const result = await clipboard.copy(preview);
          if ('positive' === variant) {
            expect(result).toEqual({ method: 'clipboard', status: 'copied' });
            const item = (writes[0] as ClipboardItemStub[])[0];
            const htmlBlob = item?.payload['text/html'];
            if (!htmlBlob) throw new Error('positive SVG owner payload missing');
            const holder = document.createElement('div');
            holder.innerHTML = await blobText(htmlBlob);
            expect(holder.querySelector('[role="checkbox"] svg path')?.getAttribute('d')).toBe(svgPath);
          } else {
            expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
            expect(faultHit).toBe(true);
            if (!expectedError) throw new Error('SVG fault expectation missing');
            const item = (writes[0] as ClipboardItemStub[])[0];
            const htmlBlob = item?.payload['text/html'];
            if (!htmlBlob) throw new Error('fault SVG owner payload missing');
            await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
          }
        } finally {
          Object.defineProperty(Node.prototype, 'appendChild', { configurable: true, value: originalAppendChild });
          workspace.remove();
        }
      }
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      Object.defineProperty(window, 'Image', { configurable: true, value: originalImage });
      if (originalCanvasContext)
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalCanvasContext);
      else delete (HTMLCanvasElement.prototype as unknown as { getContext?: unknown }).getContext;
    }
  });

});
