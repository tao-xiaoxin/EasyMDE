import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  declaredStyleDeclarations,
  dispatchSuccessfulLegacyCopy,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

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
        return declaration({ display: 'block', 'list-style-type': 'disc' });
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
    const expectTaskMarkerSuppression = (element: Element): void => {
      // The task structure carries the replaced marker declaration only; a
      // leftover `disc` would re-appear once native Save strips `!important`.
      expect(declaredStyleDeclarations(element, 'list-style-type')).toEqual([
        { important: true, property: 'list-style-type', value: 'none' }
      ]);
      expect(declaredStyleDeclarations(element, 'list-style-image')).toEqual([
        { important: true, property: 'list-style-image', value: 'none' }
      ]);
    };
    // Destination-safe projection: the complete task list is a section whose
    // two task items are sections, so native Save cannot rebuild native list
    // items. The suppressed marker declarations travel with those sections.
    const taskList = holder.querySelector('section section');
    if (!taskList) throw new Error('task list missing');
    expectTaskMarkerSuppression(taskList);
    const taskItems = [...holder.querySelectorAll('section section')].filter(
      (element) => element !== taskList
    );
    expect(taskItems).toHaveLength(2);
    taskItems.forEach(expectTaskMarkerSuppression);
    expect(holder.querySelectorAll('[role="checkbox"]')).toHaveLength(2);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (element) => {
          if ('INPUT' === element.tagName) return declaration({ display: 'inline-block', width: '13px', height: '13px' });
          return declaration({ display: 'block', 'list-style-type': 'disc' });
        },
        getSelection: window.getSelection.bind(window),
        scrollTo: vi.fn(),
        write: null,
        pageOffset: () => ({ x: 0, y: 0 })
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    const legacyHolder = document.createElement('div');
    legacyHolder.innerHTML = legacyHtml;
    const legacyTaskList = legacyHolder.querySelector('section section');
    if (!legacyTaskList) throw new Error('legacy task list missing');
    expectTaskMarkerSuppression(legacyTaskList);
    [...legacyHolder.querySelectorAll('section section')].forEach(expectTaskMarkerSuppression);
    expect(legacyHolder.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect(preview.innerHTML).toContain('easymde-task-checkbox');
  });
});
