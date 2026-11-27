import { createElement } from '@wordpress/element';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditorContextMenu } from './EditorContextMenu';
import type { EditorContextMenuModel } from '../editor-context-menu-model';

const model: EditorContextMenuModel = {
  items: [
    { id: 'copy', kind: 'item', label: 'Copy', disabled: false },
    {
      id: 'insert',
      kind: 'submenu',
      label: 'Insert',
      children: [
        { id: 'table', kind: 'item', label: 'Table', disabled: false },
        { id: 'image', kind: 'item', label: 'Image', disabled: true }
      ]
    }
  ]
};

const nestedModel: EditorContextMenuModel = {
	items: [{
		children: [{
			children: [{ disabled: false, id: 'leaf', kind: 'item', label: 'Leaf' }],
			id: 'more',
			kind: 'submenu',
			label: 'More'
		}],
		id: 'insert',
		kind: 'submenu',
		label: 'Insert'
	}]
};

const fourLevelModel: EditorContextMenuModel = {
	items: [{
		children: [{
			children: [{
				children: [{ disabled: false, id: 'leaf', kind: 'item', label: 'Leaf' }],
				id: 'deep',
				kind: 'submenu',
				label: 'Deep'
			}],
			id: 'more',
			kind: 'submenu',
			label: 'More'
		}],
		id: 'insert',
		kind: 'submenu',
		label: 'Insert'
	}]
};

const multiLevelTableModel: EditorContextMenuModel = {
  items: [
    { disabled: false, id: 'copy', kind: 'item', label: 'Copy' },
    {
      children: [
        { disabled: false, id: 'insert-row-above', kind: 'item', label: 'Insert row above' },
        { disabled: false, id: 'insert-row-below', kind: 'item', label: 'Insert row below' },
        {
          children: [
            { disabled: false, id: 'align-left', kind: 'item', label: 'Align left' },
            { disabled: false, id: 'align-center', kind: 'item', label: 'Align center' },
            { disabled: false, id: 'align-right', kind: 'item', label: 'Align right' }
          ],
          id: 'table-alignment',
          kind: 'submenu',
          label: 'Alignment'
        }
      ],
      id: 'table',
      kind: 'submenu',
      label: 'Table'
    }
  ]
};

const siblingSubmenusModel: EditorContextMenuModel = {
  items: [
    { disabled: false, id: 'copy', kind: 'item', label: 'Copy' },
    {
      children: [
        { disabled: false, id: 'table', kind: 'item', label: 'Table' },
        { disabled: false, id: 'image', kind: 'item', label: 'Image' }
      ],
      id: 'insert',
      kind: 'submenu',
      label: 'Insert'
    },
    {
      children: [
        { disabled: false, id: 'bold', kind: 'item', label: 'Bold' },
        { disabled: false, id: 'cut', kind: 'item', label: 'Cut' }
      ],
      id: 'format',
      kind: 'submenu',
      label: 'Format'
    }
  ]
};

async function withManualRafAndExternalFocus(
  run: (context: Readonly<{
    external: HTMLButtonElement;
    flushFrame: () => void;
  }>) => void | Promise<void>
): Promise<void> {
  const external = document.createElement('button');
  external.type = 'button';
  external.textContent = 'External editor';
  document.body.append(external);
  external.focus();

  let frame: FrameRequestCallback | null = null;
  const rafSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });

  try {
    await run({
      external,
      flushFrame: () => {
        act(() => {
          const pending = frame;
          frame = null;
          pending?.(0);
        });
      }
    });
  } finally {
    rafSpy.mockRestore();
    external.remove();
  }
}

const iconCoverageModel: EditorContextMenuModel = {
  items: [
    { disabled: false, id: 'bold', kind: 'item', label: 'Bold' },
    { disabled: false, id: 'cut', kind: 'item', label: 'Cut' },
    { disabled: false, id: 'copy', kind: 'item', label: 'Copy' },
    { disabled: false, id: 'paste', kind: 'item', label: 'Paste' },
    { disabled: false, id: 'copy-paste-as', kind: 'item', label: 'Copy / Paste as' },
    { disabled: false, id: 'copy-as-markdown', kind: 'item', label: 'Copy as Markdown' },
    { disabled: false, id: 'copy-as-html', kind: 'item', label: 'Copy as HTML' },
    { disabled: false, id: 'copy-simplified-formatting', kind: 'item', label: 'Copy simplified' },
    { disabled: false, id: 'paste-plain-text', kind: 'item', label: 'Paste plain text' },
    { disabled: false, id: 'insert', kind: 'item', label: 'Insert' },
    { disabled: false, id: 'insert-table-above', kind: 'item', label: 'Insert table above' },
    { disabled: false, id: 'insert-table-below', kind: 'item', label: 'Insert table below' },
    { disabled: false, id: 'insert-image-above', kind: 'item', label: 'Insert image above' },
    { disabled: false, id: 'insert-image-below', kind: 'item', label: 'Insert image below' },
    { disabled: false, id: 'insert-paragraph-above', kind: 'item', label: 'Insert paragraph above' },
    { disabled: false, id: 'insert-paragraph-below', kind: 'item', label: 'Insert paragraph below' },
    { disabled: false, id: 'image-scale', kind: 'item', label: 'Image scale' },
    ...[25, 33, 50, 67, 100, 150, 200].map((scale) => ({
      disabled: false,
      id: `image-scale-${scale}`,
      kind: 'item' as const,
      label: `${scale}%`
    })),
    { disabled: false, id: 'upload-image', kind: 'item', label: 'Upload image' },
    { disabled: false, id: 'delete-image', kind: 'item', label: 'Delete image' },
    { disabled: false, id: 'copy-image', kind: 'item', label: 'Copy image' },
    { disabled: false, id: 'copy-link-address', kind: 'item', label: 'Copy link address' },
    { disabled: false, id: 'table', kind: 'item', label: 'Table' },
    { disabled: false, id: 'insert-row-above', kind: 'item', label: 'Insert row above' },
    { disabled: false, id: 'insert-row-below', kind: 'item', label: 'Insert row below' },
    { disabled: false, id: 'insert-column-left', kind: 'item', label: 'Insert column left' },
    { disabled: false, id: 'insert-column-right', kind: 'item', label: 'Insert column right' },
    { disabled: false, id: 'delete-row', kind: 'item', label: 'Delete row' },
    { disabled: false, id: 'delete-column', kind: 'item', label: 'Delete column' },
    { disabled: false, id: 'copy-table', kind: 'item', label: 'Copy table' },
    { disabled: false, id: 'format-table-source', kind: 'item', label: 'Format table source' },
    { disabled: false, id: 'delete-table', kind: 'item', label: 'Delete table' },
    { disabled: false, id: 'insert-paragraph-above-table', kind: 'item', label: 'Insert above table' },
    { disabled: false, id: 'insert-paragraph-below-table', kind: 'item', label: 'Insert below table' },
    { disabled: false, id: 'table-alignment', kind: 'item', label: 'Alignment' },
    { disabled: false, id: 'align-left', kind: 'item', label: 'Align left' },
    { disabled: false, id: 'align-center', kind: 'item', label: 'Align center' },
    { disabled: false, id: 'align-right', kind: 'item', label: 'Align right' },
    { disabled: false, id: 'code-block', kind: 'item', label: 'Code block' },
    { disabled: false, id: 'copy-code-block', kind: 'item', label: 'Copy code block' },
    { disabled: false, id: 'copy-code-content', kind: 'item', label: 'Copy code content' },
    { disabled: false, id: 'indent-code-block', kind: 'item', label: 'Indent code block' },
    { disabled: false, id: 'indent-selected-code', kind: 'item', label: 'Indent selected code' },
    { disabled: false, id: 'insert-paragraph-above-code', kind: 'item', label: 'Insert above code' },
    { disabled: false, id: 'insert-paragraph-below-code', kind: 'item', label: 'Insert below code' },
    { disabled: false, id: 'delete-code-block', kind: 'item', label: 'Delete code block' },
    {
      children: [
        { disabled: false, id: 'edit-generated-content', kind: 'item', label: 'Edit generated' },
        {
          children: [
            { disabled: false, id: 'copy-generated-image', kind: 'item', label: 'Copy generated image' },
            { disabled: false, id: 'copy-generated-source', kind: 'item', label: 'Copy generated source' },
            { disabled: false, id: 'copy-generated-mathml', kind: 'item', label: 'Copy generated MathML' }
          ],
          id: 'copy-generated',
          kind: 'submenu',
          label: 'Copy generated'
        },
        {
          disabled: false,
          id: 'insert-paragraph-above-generated',
          kind: 'item',
          label: 'Insert paragraph above generated'
        },
        {
          disabled: false,
          id: 'insert-paragraph-below-generated',
          kind: 'item',
          label: 'Insert paragraph below generated'
        },
        {
          disabled: false,
          id: 'delete-generated-content',
          kind: 'item',
          label: 'Delete generated'
        }
      ],
      id: 'generated-content',
      kind: 'submenu',
      label: 'Generated content'
    }
  ]
};

describe('EditorContextMenu', () => {
  it('maps action ids to generated Lucide icons without adding accessible names', () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    expect(copy.querySelector('.easymde-editor-context-menu__icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(insert.querySelector('.easymde-editor-context-menu__icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders real Lucide SVGs for every allowed existing action', () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={iconCoverageModel}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const generated = screen.getByRole('menuitem', { name: 'Generated content' });
    fireEvent.keyDown(generated, { key: 'ArrowRight' });
    expect(screen.getByRole('menu', { name: 'Generated content' })).toBeTruthy();
    const copyGenerated = screen.getByRole('menuitem', { name: 'Copy generated' });
    fireEvent.keyDown(copyGenerated, { key: 'ArrowRight' });
    expect(screen.getByRole('menu', { name: 'Copy generated' })).toBeTruthy();

    for (const id of [
      'bold',
      'cut',
      'copy',
      'paste',
      'copy-paste-as',
      'copy-as-markdown',
      'copy-as-html',
      'copy-simplified-formatting',
      'paste-plain-text',
      'insert',
      'insert-table-above',
      'insert-table-below',
      'insert-image-above',
      'insert-image-below',
      'insert-paragraph-above',
      'insert-paragraph-below',
      'image-scale',
      'image-scale-25',
      'image-scale-33',
      'image-scale-50',
      'image-scale-67',
      'image-scale-100',
      'image-scale-150',
      'image-scale-200',
      'upload-image',
      'delete-image',
      'copy-image',
      'copy-link-address',
      'table',
      'insert-row-above',
      'insert-row-below',
      'insert-column-left',
      'insert-column-right',
      'delete-row',
      'delete-column',
      'copy-table',
      'format-table-source',
      'delete-table',
      'insert-paragraph-above-table',
      'insert-paragraph-below-table',
      'table-alignment',
      'align-left',
      'align-center',
      'align-right',
      'code-block',
      'copy-code-block',
      'copy-code-content',
      'indent-code-block',
      'indent-selected-code',
      'insert-paragraph-above-code',
      'insert-paragraph-below-code',
      'delete-code-block',
      'generated-content',
      'edit-generated-content',
      'copy-generated',
      'copy-generated-image',
      'copy-generated-source',
      'copy-generated-mathml',
      'insert-paragraph-above-generated',
      'insert-paragraph-below-generated',
      'delete-generated-content'
    ]) {
      expect(
        document.querySelector(`[data-easymde-context-menu-item="${id}"] svg`)
      ).not.toBeNull();
    }

  });

  it('focuses the first enabled child when a submenu starts with a disabled action', () => {
    const disabledFirstModel: EditorContextMenuModel = {
      items: [{
        children: [
          { disabled: true, id: 'disabled-first', kind: 'item', label: 'Disabled first' },
          { disabled: false, id: 'enabled-second', kind: 'item', label: 'Enabled second' }
        ],
        id: 'parent',
        kind: 'submenu',
        label: 'Parent'
      }]
    };

    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={disabledFirstModel}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const parent = screen.getByRole('menuitem', { name: 'Parent' });
    parent.focus();
    fireEvent.keyDown(parent, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Enabled second' })
    );
  });

  it('moves the visible selection frame with the pointer through nested menus', async () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={fourLevelModel}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    fireEvent.mouseEnter(insert);
    await waitFor(() => expect(insert.classList.contains('is-hovered')).toBe(true));

    const more = await screen.findByRole('menuitem', { name: 'More' });
    fireEvent.mouseEnter(more);
    await waitFor(() => {
      expect(insert.classList.contains('is-hovered')).toBe(false);
      expect(more.classList.contains('is-hovered')).toBe(true);
    });

    const deep = await screen.findByRole('menuitem', { name: 'Deep' });
    fireEvent.mouseEnter(deep);
    await waitFor(() => {
      expect(more.classList.contains('is-hovered')).toBe(false);
      expect(deep.classList.contains('is-hovered')).toBe(true);
    });

    const leaf = await screen.findByRole('menuitem', { name: 'Leaf' });
    fireEvent.mouseEnter(leaf);
    await waitFor(() => {
      expect(deep.classList.contains('is-hovered')).toBe(false);
      expect(leaf.classList.contains('is-hovered')).toBe(true);
    });

    fireEvent.mouseLeave(leaf, { relatedTarget: document.body });
    await waitFor(() => expect(leaf.classList.contains('is-hovered')).toBe(false));
  });

  it('keeps root focus when the opening pointer hovers the menu before Escape', () => {
    let frame: FrameRequestCallback | null = null;
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
    const onDismiss = vi.fn();
    const rootOnlyModel: EditorContextMenuModel = {
      items: [{ disabled: false, id: 'copy', kind: 'item', label: 'Copy' }]
    };

    try {
      render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={rootOnlyModel}
          onAction={vi.fn()}
          onDismiss={onDismiss}
          open
        />
      );

      const copy = screen.getByRole('menuitem', { name: 'Copy' });
      fireEvent.mouseEnter(copy);
      act(() => frame?.(0));
      expect(document.activeElement).toBe(copy);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onDismiss).toHaveBeenCalledWith({ restoreFocus: true });
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('restores the captured editor selection for portal pointer interactions', () => {
    const onMenuPointerDown = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onMenuPointerDown={onMenuPointerDown}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    fireEvent.pointerDown(insert, { button: 0 });
    fireEvent.click(insert);

    expect(onMenuPointerDown).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu', { name: 'Insert' })).toBeTruthy();
  });

  it('renders semantic menus, exposes disabled items, and opens submenus by keyboard', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
      model={model}
      onAction={onAction}
      onDismiss={onDismiss}
      open
      />
    );

    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('dir')).toBe('ltr');

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    insert.focus();
    fireEvent.keyDown(insert, { key: 'ArrowRight' });
    expect(screen.getByRole('menu', { name: 'Insert' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Table' }));
    expect(screen.getByRole('menuitem', { name: 'Image' }).getAttribute('aria-disabled')).toBe('true');
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) throw new Error('context-menu-focus-missing');
    fireEvent.keyDown(activeElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(insert);
    expect(insert.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledWith({ restoreFocus: true });
  });

  it('reverses submenu forward/backward behavior in RTL', async () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="rtl"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    insert.focus();
    fireEvent.keyDown(insert, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Table' }));
  });

  it('closes a nested submenu on Escape before dismissing the root menu', () => {
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    insert.focus();
    fireEvent.keyDown(insert, { key: 'ArrowRight' });
    const table = screen.getByRole('menuitem', { name: 'Table' });
    fireEvent.keyDown(table, { key: 'Escape' });

    expect(insert.getAttribute('aria-expanded')).toBe('false');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses the root menu when Escape arrives after focus leaves the menu', () => {
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    insert.focus();
    fireEvent.keyDown(insert, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Table' }), { key: 'Escape' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledWith({ restoreFocus: true });
  });

  it('keeps the root coordinate stable on resize and does not activate disabled actions', () => {
    const onAction = vi.fn();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    render(
      <EditorContextMenu
        anchor={{ x: 1000, y: 800 }}
        direction="ltr"
        model={model}
        onAction={onAction}
        onDismiss={vi.fn()}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 180 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 120 });
    const initialLeft = menu.style.left;
    const initialTop = menu.style.top;
    fireEvent(window, new Event('resize'));

    expect(menu.style.left).toBe(initialLeft);
    expect(menu.style.top).toBe(initialTop);
    expect(menu.style.clipPath).toBe('');
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    fireEvent.click(insert);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Image' }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('reclips model growth and boundary changes without moving the root panel', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const resizeCallbacks: Array<() => void> = [];
    const observedElements: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }

      disconnect(): void {}

      observe(element: Element): void {
        observedElements.push(element);
      }
    });
    const boundary = document.createElement('div');
    let boundaryRect = {
      bottom: 400,
      height: 400,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    };
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => boundaryRect
    });
    document.body.append(boundary);
    const onDismiss = vi.fn();
    const { rerender } = render(
      <EditorContextMenu
        anchor={{ x: 100, y: 100 }}
        boundaryElement={boundary}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 180 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 180 });
    expect(observedElements).toContain(boundary);
    const initialTop = menu.style.top;
    const expandedModel: EditorContextMenuModel = {
      items: [
        ...model.items,
        ...Array.from({ length: 12 }, (_, index) => ({
          disabled: false,
          id: `async-item-${index}`,
          kind: 'item' as const,
          label: `Async item ${index}`
        }))
      ]
    };
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 320 });
    rerender(
      <EditorContextMenu
        anchor={{ x: 100, y: 100 }}
        boundaryElement={boundary}
        direction="ltr"
        model={expandedModel}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );
    expect(menu.style.top).toBe(initialTop);
    expect(menu.style.clipPath).toBe('');
    expect(menu.style.maxBlockSize).toBe('300px');

    boundaryRect = { ...boundaryRect, bottom: 220 };
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(menu.style.top).toBe(initialTop);
    expect(menu.style.clipPath).toBe('');
    expect(menu.style.maxBlockSize).toBe('120px');

    boundaryRect = { ...boundaryRect, bottom: 400 };
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(menu.style.top).toBe(initialTop);
    expect(menu.style.clipPath).toBe('');

    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 180 });
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(menu.style.top).toBe(initialTop);
    expect(menu.style.clipPath).toBe('');
    expect(onDismiss).not.toHaveBeenCalled();
    boundary.remove();
    vi.unstubAllGlobals();
  });

  it('reclamps the root panel when its right edge crosses a narrowed boundary', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }

      disconnect(): void {}

      observe(): void {}
    });
    const boundary = document.createElement('div');
    let boundaryRect = {
      bottom: 400,
      height: 400,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    };
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => boundaryRect
    });
    document.body.append(boundary);

    try {
      render(
        <EditorContextMenu
          anchor={{ x: 100, y: 100 }}
          boundaryElement={boundary}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
        />
      );
      const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
      if (!menu) throw new Error('context-menu-missing');
      Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 180 });
      Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 56 });
      const initialLeft = menu.style.left;
      boundaryRect = { ...boundaryRect, right: 220, width: 220 };

      act(() => {
        for (const callback of resizeCallbacks) callback();
      });

      expect(initialLeft).toBe('100px');
      expect(menu.style.left).toBe('40px');
      expect(Number.parseFloat(menu.style.left) + 180).toBeLessThanOrEqual(220);
    } finally {
      boundary.remove();
      vi.unstubAllGlobals();
    }
  });

  it('uses the space below the root panel for model growth so the bottom remains scrollable', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const boundary = document.createElement('div');
    const boundaryRect = {
      bottom: 400,
      height: 400,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    };
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => boundaryRect
    });
    document.body.append(boundary);

    const expandedModel: EditorContextMenuModel = {
      items: [
        ...model.items,
        ...Array.from({ length: 12 }, (_, index) => ({
          disabled: false,
          id: `grown-item-${index}`,
          kind: 'item' as const,
          label: `Grown item ${index}`
        }))
      ]
    };

    try {
      const { rerender } = render(
        <EditorContextMenu
          anchor={{ x: 100, y: 100 }}
          boundaryElement={boundary}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
        />
      );
      const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
      if (!menu) throw new Error('context-menu-missing');
      Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 180 });
      Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 320 });

      rerender(
        <EditorContextMenu
          anchor={{ x: 100, y: 100 }}
          boundaryElement={boundary}
          direction="ltr"
          model={expandedModel}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
        />
      );

      expect(menu.style.top).toBe('100px');
      expect(menu.style.maxBlockSize).toBe('300px');
      expect(menu.style.clipPath).toBe('');
    } finally {
      boundary.remove();
    }
  });

  it('reclamps the root panel when the viewport shrinks after opening', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    render(
      <EditorContextMenu
        anchor={{ x: 650, y: 450 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 198 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 56 });
    const initialLeft = menu.style.left;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 540 });
    fireEvent(window, new Event('resize'));
    expect(menu.style.left).toBe('334px');
    expect(menu.style.left).not.toBe(initialLeft);
  });

  it.each(['scrollTop', 'scrollLeft'] as const)(
    'keeps the menu for a queued ancestor scroll but dismisses a new %s displacement',
    (coordinate) => {
      const canvas = document.createElement('div');
      const surface = document.createElement('article');
      canvas.append(surface);
      document.body.append(canvas);
      canvas[coordinate] = 240;
      const onDismiss = vi.fn();
      const view = render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={onDismiss}
          open
          surfaceElement={surface}
        />
      );

      try {
        fireEvent.scroll(canvas);
        expect(onDismiss).not.toHaveBeenCalled();
        expect(screen.getByRole('menuitem', { name: 'Insert' })).toBeTruthy();

        canvas[coordinate] += 20;
        fireEvent.scroll(canvas);
        expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
      } finally {
        view.unmount();
        canvas.remove();
      }
    }
  );

  it.each(['document', 'window'] as const)(
    'ignores queued %s scrolls without suppressing a later viewport displacement',
    (target) => {
      const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
      const onDismiss = vi.fn();
      const view = render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={onDismiss}
          open
        />
      );
      const scrollTarget = target === 'document' ? document : window;

      try {
        fireEvent.scroll(scrollTarget);
        expect(onDismiss).not.toHaveBeenCalled();

        Object.defineProperty(window, 'scrollY', { configurable: true, value: 160 });
        fireEvent.scroll(scrollTarget);
        expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
      } finally {
        view.unmount();
        if (scrollY) Object.defineProperty(window, 'scrollY', scrollY);
      }
      onDismiss.mockClear();
      fireEvent.scroll(scrollTarget);
      expect(onDismiss).not.toHaveBeenCalled();
    }
  );

  it('keeps menu-owned scrolling active but dismisses an editor/page scroll', () => {
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    fireEvent.click(insert);
    const table = screen.getByRole('menuitem', { name: 'Table' });
    const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!submenu) throw new Error('context-menu-submenu-missing');

    fireEvent.scroll(submenu);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.scroll(document.body);
    expect(onDismiss).toHaveBeenCalledWith({ restoreFocus: true });
  });

  it('closes a top-level submenu when root-menu scrolling hides its trigger', async () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 198 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 120 });
    Object.defineProperty(menu, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 220, height: 120, left: 100, right: 298, top: 100, width: 198, x: 100, y: 100, toJSON: () => ({}) })
    });
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    let triggerRect = { bottom: 180, height: 30, left: 120, right: 280, top: 150, width: 160, x: 120, y: 150, toJSON: () => ({}) };
    Object.defineProperty(insert, 'getBoundingClientRect', {
      configurable: true,
      value: () => triggerRect
    });
    fireEvent.mouseEnter(insert);
    await screen.findByRole('menuitem', { name: 'Table' });
    triggerRect = { ...triggerRect, bottom: -40, top: -70 };
    fireEvent.scroll(menu);
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Table' })).toBeNull();
    });
    expect(document.activeElement).toBe(insert);
  });

  it('closes an open submenu when the pointer enters a normal sibling item', async () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    fireEvent.mouseEnter(insert);
    await screen.findByRole('menuitem', { name: 'Table' });
    fireEvent.mouseEnter(copy);
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Table' })).toBeNull();
    });
  });

  it('omits a zero-area clip when the panel is fully inside its boundary', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 100 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    expect(menu.style.clipPath).toBe('');
  });

  it('places the pointer on the actual flipped submenu side', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(insert, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 320,
        height: 30,
        left: 320,
        right: 380,
        top: 290,
        width: 60,
        x: 320,
        y: 290,
        toJSON: () => ({})
      })
    });
    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    await waitFor(() => {
      const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
      expect(submenu?.style.left).toBe('64px');
    });
    const pointer = document.body.querySelector<HTMLElement>('[data-easymde-context-menu-pointer="true"]');
    expect(pointer?.dataset.easymdeContextMenuPointerPlacement).toBe('left');
    expect(pointer?.style.left).toBe('304px');
    const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    const frame = submenu?.parentElement;
    expect(frame?.className).toBe('easymde-editor-context-menu__submenu-frame');
    expect(frame?.dataset.easymdeContextMenuPlacement).toBe('left');
    expect(frame?.style.left).toBe(submenu?.style.left);
    expect(frame?.style.top).toBe(submenu?.style.top);
    expect(Number.parseFloat(frame?.style.getPropertyValue('--easymde-context-menu-pointer-top') ?? '')).toBe(
      Number.parseFloat(pointer?.style.top ?? '') - Number.parseFloat(submenu?.style.top ?? '')
    );
  });

  it('places a forward-opening pointer in the gap before the submenu', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(insert, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 130,
        height: 30,
        left: 100,
        right: 160,
        top: 100,
        width: 60,
        x: 100,
        y: 100,
        toJSON: () => ({})
      })
    });
    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    await waitFor(() => {
      const pointer = document.body.querySelector<HTMLElement>('[data-easymde-context-menu-pointer="true"]');
      expect(pointer?.dataset.easymdeContextMenuPointerPlacement).toBe('right');
      expect(pointer?.style.left).toBe('176px');
      const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
      const frame = submenu?.parentElement;
      expect(frame?.className).toBe('easymde-editor-context-menu__submenu-frame');
      expect(frame?.dataset.easymdeContextMenuPlacement).toBe('right');
      expect(frame?.style.left).toBe(submenu?.style.left);
      expect(frame?.style.top).toBe(submenu?.style.top);
      expect(Number.parseFloat(frame?.style.getPropertyValue('--easymde-context-menu-pointer-top') ?? '')).toBe(
        Number.parseFloat(pointer?.style.top ?? '') - Number.parseFloat(submenu?.style.top ?? '')
      );
    });
  });

  it('repositions the root and an open submenu when the viewport shrinks', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    const initialLeft = menu.style.left;
    const initialTop = menu.style.top;
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(insert, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 130,
        height: 30,
        left: 200,
        right: 260,
        top: 100,
        width: 60,
        x: 200,
        y: 100,
        toJSON: () => ({})
      })
    });

    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!submenu) throw new Error('context-menu-submenu-missing');
    Object.defineProperty(submenu, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 220,
        height: 120,
        left: 276,
        right: 376,
        top: 100,
        width: 100,
        x: 276,
        y: 100,
        toJSON: () => ({})
      })
    });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(submenu.style.left).toBe('276px');
      expect(submenu.dataset.easymdeContextMenuPlacement).toBe('right');
    });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(submenu.style.left).toBe('84px');
      expect(submenu.dataset.easymdeContextMenuPlacement).toBe('left');
    });
    expect(menu.style.left).toBe('52px');
    expect(menu.style.left).not.toBe(initialLeft);
    expect(menu.style.top).toBe(initialTop);
  });

  it('repositions nested submenus from the updated parent geometry', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 18 }}
        direction="ltr"
        model={nestedModel}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );
    const rootMenu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!rootMenu) throw new Error('nested-root-menu-missing');
    Object.defineProperty(rootMenu, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 400, height: 300, left: 500, right: 760, top: 100, width: 260, x: 500, y: 100, toJSON: () => ({}) })
    });
    const rootTrigger = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(rootTrigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 150,
        height: 30,
        left: 520,
        right: 580,
        top: 120,
        width: 60,
        x: 520,
        y: 120,
        toJSON: () => ({})
      })
    });
    fireEvent.mouseEnter(rootTrigger);
    const parentTrigger = await screen.findByRole('menuitem', { name: 'More' });
    const parentMenu = parentTrigger.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!parentMenu) throw new Error('nested-parent-menu-missing');
    let parentTriggerVisible = true;
    Object.defineProperty(parentMenu, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = Number.parseFloat(parentMenu.style.left) || 0;
        return {
          bottom: 220,
          height: 100,
          left,
          right: left + 180,
          top: 120,
          width: 180,
          x: left,
          y: 120,
          toJSON: () => ({})
        };
      }
    });
    Object.defineProperty(parentTrigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = Number.parseFloat(parentMenu.style.left) || 0;
        const top = parentTriggerVisible ? 140 : -80;
        return {
          bottom: top + 30,
          height: 30,
          left: left + 20,
          right: left + 140,
          top,
          width: 120,
          x: left + 20,
          y: top,
          toJSON: () => ({})
        };
      }
    });
    fireEvent.mouseEnter(parentTrigger);
    const leaf = await screen.findByRole('menuitem', { name: 'Leaf' });
    const childMenu = leaf.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!childMenu) throw new Error('nested-child-menu-missing');
    Object.defineProperty(childMenu, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = Number.parseFloat(childMenu.style.left) || 0;
        return {
          bottom: 220,
          height: 100,
          left,
          right: left + 180,
          top: 120,
          width: 180,
          x: left,
          y: 120,
          toJSON: () => ({})
        };
      }
    });
    const initialChildLeft = childMenu.style.left;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(parentMenu.dataset.easymdeContextMenuPlacement).toBe('left');
      expect(childMenu.dataset.easymdeContextMenuPlacement).toBe('right');
      expect(childMenu.style.left).toBe('480px');
      expect(childMenu.style.left).not.toBe(initialChildLeft);
    });
    parentTriggerVisible = false;
    fireEvent.scroll(parentMenu);
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Leaf' })).toBeNull();
    });
    expect(document.activeElement).toBe(parentTrigger);
    fireEvent.keyDown(parentTrigger, { key: 'Escape' });
    fireEvent.keyDown(rootTrigger, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledWith({ restoreFocus: true });
  });

  it('uses only the direct parent delta for a four-level resize', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 18 }}
        direction="ltr"
        model={fourLevelModel}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const rootTrigger = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(rootTrigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 150, height: 30, left: 520, right: 580, top: 120, width: 60, x: 520, y: 120, toJSON: () => ({}) })
    });
    fireEvent.mouseEnter(rootTrigger);
    const parentTrigger = await screen.findByRole('menuitem', { name: 'More' });
    const parentMenu = parentTrigger.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!parentMenu) throw new Error('four-level-parent-missing');
    const rectFor = (menu: HTMLElement, width = 180) => {
      const left = Number.parseFloat(menu.style.left) || 0;
      return { bottom: 220, height: 100, left, right: left + width, top: 120, width, x: left, y: 120, toJSON: () => ({}) };
    };
    Object.defineProperty(parentMenu, 'getBoundingClientRect', { configurable: true, value: () => rectFor(parentMenu) });
    Object.defineProperty(parentTrigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = Number.parseFloat(parentMenu.style.left) || 0;
        return { bottom: 170, height: 30, left: left + 20, right: left + 140, top: 140, width: 120, x: left + 20, y: 140, toJSON: () => ({}) };
      }
    });
    fireEvent.mouseEnter(parentTrigger);
    const deepTrigger = await screen.findByRole('menuitem', { name: 'Deep' });
    const secondMenu = deepTrigger.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!secondMenu) throw new Error('four-level-second-missing');
    Object.defineProperty(secondMenu, 'getBoundingClientRect', { configurable: true, value: () => rectFor(secondMenu) });
    Object.defineProperty(deepTrigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = Number.parseFloat(secondMenu.style.left) || 0;
        return { bottom: 170, height: 30, left: left + 20, right: left + 140, top: 140, width: 120, x: left + 20, y: 140, toJSON: () => ({}) };
      }
    });
    fireEvent.mouseEnter(deepTrigger);
    const leaf = await screen.findByRole('menuitem', { name: 'Leaf' });
    const thirdMenu = leaf.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!thirdMenu) throw new Error('four-level-third-missing');
    Object.defineProperty(thirdMenu, 'getBoundingClientRect', { configurable: true, value: () => rectFor(thirdMenu) });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(parentMenu.dataset.easymdeContextMenuPlacement).toBe('left');
      expect(secondMenu.dataset.easymdeContextMenuPlacement).toBe('right');
      expect(thirdMenu.dataset.easymdeContextMenuPlacement).toBe('left');
      expect(thirdMenu.style.left).toBe('304px');
    });
  });

  it('flips an open submenu on window resize without waiting for ResizeObserver delivery', async () => {
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }

      disconnect(): void {}

      observe(): void {}
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const boundary = document.createElement('div');
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 300,
        height: 300,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({})
      })
    });
    document.body.append(boundary);
    render(
      <EditorContextMenu
        anchor={{ x: 100, y: 100 }}
        boundaryElement={boundary}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );
    const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!menu) throw new Error('context-menu-missing');
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 198 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 56 });
    const initialLeft = menu.style.left;
    const initialTop = menu.style.top;
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(insert, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 300,
        height: 28,
        left: 370,
        right: 400,
        top: 272,
        width: 30,
        x: 370,
        y: 272,
        toJSON: () => ({})
      })
    });
    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!submenu) throw new Error('context-menu-submenu-missing');
    Object.defineProperty(submenu, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 328,
        height: 56,
        left: 416,
        right: 614,
        top: 272,
        width: 198,
        x: 416,
        y: 272,
        toJSON: () => ({})
      })
    });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(submenu.style.left).toBe('416px');
      expect(submenu.dataset.easymdeContextMenuPlacement).toBe('right');
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(submenu.style.left).toBe('156px');
      expect(submenu.dataset.easymdeContextMenuPlacement).toBe('left');
    });
    expect(menu.style.left).toBe(initialLeft);
    expect(menu.style.top).toBe(initialTop);
    expect(resizeCallbacks.length).toBeGreaterThan(0);
    boundary.remove();
    vi.unstubAllGlobals();
  });

  it('opens nested submenus on pointer hover without focusing child item 0 and tracks hover cleanly across levels', async () => {
    await withManualRafAndExternalFocus(async ({ flushFrame }) => {
      render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={multiLevelTableModel}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
        />
      );

      const copy = screen.getByRole('menuitem', { name: 'Copy' });
      const table = screen.getByRole('menuitem', { name: 'Table' });
      const rootLayer = copy.closest<HTMLElement>('[data-easymde-context-menu-layer="root"]');
      if (!rootLayer) throw new Error('context-menu-root-layer-missing');

      flushFrame();
      expect(document.activeElement).toBe(copy);

      fireEvent.mouseEnter(table);
      const rowAbove = await screen.findByRole('menuitem', { name: 'Insert row above' });
      const rowBelow = screen.getByRole('menuitem', { name: 'Insert row below' });
      const alignment = screen.getByRole('menuitem', { name: 'Alignment' });
      const level1Layer = rowAbove.closest<HTMLElement>('[data-easymde-context-menu-layer]');
      if (!level1Layer) throw new Error('context-menu-level1-layer-missing');

      expect(document.activeElement).toBe(copy);
      expect(document.activeElement).not.toBe(rowAbove);
      expect(rootLayer.classList.contains('is-pointer-hovering')).toBe(true);
      expect(level1Layer.classList.contains('is-pointer-hovering')).toBe(true);
      expect(table.classList.contains('is-hovered')).toBe(true);
      expect(table.parentElement?.classList.contains('is-expanded')).toBe(true);
      expect(copy.classList.contains('is-hovered')).toBe(false);
      expect(rowAbove.classList.contains('is-hovered')).toBe(false);

      // Crossing the gap between root menu and submenu keeps pointer-hovering
      // mode active so root item 0 does not flash its focus ring.
      fireEvent.mouseLeave(table, { relatedTarget: document.body });
      expect(table.classList.contains('is-hovered')).toBe(false);
      expect(table.parentElement?.classList.contains('is-expanded')).toBe(true);
      expect(rootLayer.classList.contains('is-pointer-hovering')).toBe(true);

      // Move pointer item 0 -> item 1 -> item 2 inside 2nd-level submenu.
      fireEvent.mouseEnter(rowAbove);
      expect(rowAbove.classList.contains('is-hovered')).toBe(true);
      expect(rowBelow.classList.contains('is-hovered')).toBe(false);
      expect(alignment.classList.contains('is-hovered')).toBe(false);
      expect(document.activeElement).toBe(copy);

      fireEvent.mouseEnter(rowBelow);
      expect(rowAbove.classList.contains('is-hovered')).toBe(false);
      expect(rowBelow.classList.contains('is-hovered')).toBe(true);
      expect(alignment.classList.contains('is-hovered')).toBe(false);
      expect(document.activeElement).toBe(copy);

      fireEvent.mouseEnter(alignment);
      const alignLeft = await screen.findByRole('menuitem', { name: 'Align left' });
      const alignCenter = screen.getByRole('menuitem', { name: 'Align center' });
      const alignRight = screen.getByRole('menuitem', { name: 'Align right' });

      expect(document.activeElement).toBe(copy);
      expect(document.activeElement).not.toBe(alignLeft);
      expect(rowBelow.classList.contains('is-hovered')).toBe(false);
      expect(alignment.classList.contains('is-hovered')).toBe(true);
      expect(alignment.parentElement?.classList.contains('is-expanded')).toBe(true);
      expect(table.parentElement?.classList.contains('is-expanded')).toBe(true);
      expect(alignLeft.classList.contains('is-hovered')).toBe(false);

      // Move pointer item 0 -> item 1 -> item 2 inside 3rd-level submenu.
      fireEvent.mouseEnter(alignLeft);
      expect(alignLeft.classList.contains('is-hovered')).toBe(true);
      expect(alignCenter.classList.contains('is-hovered')).toBe(false);
      expect(alignRight.classList.contains('is-hovered')).toBe(false);
      expect(document.activeElement).toBe(copy);

      fireEvent.mouseEnter(alignCenter);
      expect(alignLeft.classList.contains('is-hovered')).toBe(false);
      expect(alignCenter.classList.contains('is-hovered')).toBe(true);
      expect(alignRight.classList.contains('is-hovered')).toBe(false);
      expect(document.activeElement).toBe(copy);

      fireEvent.mouseEnter(alignRight);
      expect(alignLeft.classList.contains('is-hovered')).toBe(false);
      expect(alignCenter.classList.contains('is-hovered')).toBe(false);
      expect(alignRight.classList.contains('is-hovered')).toBe(true);
      expect(table.parentElement?.classList.contains('is-expanded')).toBe(true);
      expect(alignment.parentElement?.classList.contains('is-expanded')).toBe(true);
      expect(document.activeElement).toBe(copy);
    });
  });

  it.each([
    ['ArrowRight', 'ArrowLeft', (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: 'ArrowRight' })],
    ['Enter', 'Escape', (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: 'Enter' })],
    ['Space', 'Escape', (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: ' ' })],
    ['click', 'Escape', (trigger: HTMLElement) => fireEvent.click(trigger)]
  ] as const)(
    'focuses child item 0 when opening a submenu via %s and returns focus on %s',
    (_activation, closeKey, activate) => {
      const onDismiss = vi.fn();
      render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={onDismiss}
          open
        />
      );

      const insert = screen.getByRole('menuitem', { name: 'Insert' });
      insert.focus();
      activate(insert);

      const table = screen.getByRole('menuitem', { name: 'Table' });
      expect(document.activeElement).toBe(table);

      fireEvent.keyDown(table, { key: closeKey });
      expect(document.activeElement).toBe(insert);
      expect(insert.getAttribute('aria-expanded')).toBe('false');
      expect(onDismiss).not.toHaveBeenCalled();
    }
  );

  it('focuses child item 0 when clicking a submenu trigger that was already hovered open', async () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    copy.focus();

    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    expect(document.activeElement).toBe(copy);

    fireEvent.click(insert);
    expect(document.activeElement).toBe(table);
  });

  it('closes only one hovered submenu layer at a time on Escape and supports keyboard takeover after hover', async () => {
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={multiLevelTableModel}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );

    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    const table = screen.getByRole('menuitem', { name: 'Table' });
    const rootLayer = copy.closest<HTMLElement>('[data-easymde-context-menu-layer="root"]');
    if (!rootLayer) throw new Error('context-menu-root-layer-missing');
    copy.focus();

    // Hover 1st-level -> 2nd-level -> item inside 2nd-level submenu.
    fireEvent.mouseEnter(table);
    const alignment = await screen.findByRole('menuitem', { name: 'Alignment' });
    fireEvent.mouseEnter(alignment);
    const alignCenter = await screen.findByRole('menuitem', { name: 'Align center' });
    const alignRight = screen.getByRole('menuitem', { name: 'Align right' });
    fireEvent.mouseEnter(alignCenter);

    // ArrowDown from hovered item in 2nd-level submenu moves focus inside that
    // submenu (not the root menu) and exits pointer-hovering mode.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(alignRight);
    expect(rootLayer.classList.contains('is-pointer-hovering')).toBe(false);

    // Re-hover alignment to verify Escape closes only one submenu layer at a time.
    fireEvent.mouseEnter(alignment);
    await screen.findByRole('menuitem', { name: 'Align left' });
    expect(rootLayer.classList.contains('is-pointer-hovering')).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Align left' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Alignment' })).toBeTruthy();
    expect(document.activeElement).toBe(alignment);
    expect(rootLayer.classList.contains('is-pointer-hovering')).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Alignment' })).toBeNull();
    expect(document.activeElement).toBe(table);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
  });

  it('transitions ArrowRight from a hovered submenu trigger directly into its first enabled child', async () => {
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    copy.focus();

    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    expect(document.activeElement).toBe(copy);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(table);
  });

  it('keeps focus contained on the menu container when pointer hover opens a submenu before rAF and preserves keyboard takeover', async () => {
    const onDismiss = vi.fn();
    await withManualRafAndExternalFocus(async ({ external, flushFrame }) => {
      expect(document.activeElement).toBe(external);

      render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={onDismiss}
          open
        />
      );

      const viewport = document.body.querySelector<HTMLElement>('[data-easymde-context-menu-viewport="true"]');
      const rootContainer = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
      if (!viewport || !rootContainer) throw new Error('context-menu-container-missing');

      const insert = screen.getByRole('menuitem', { name: 'Insert' });
      fireEvent.mouseEnter(insert);
      const table = await screen.findByRole('menuitem', { name: 'Table' });

      expect(viewport.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(rootContainer);
      expect(document.activeElement).not.toBe(external);
      expect(document.activeElement).not.toBe(table);

      flushFrame();
      expect(viewport.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(rootContainer);
      expect(document.activeElement).not.toBe(table);

      // Moving the pointer out clears hoverPath while focus stays on rootContainer;
      // ArrowDown must still take over keyboard navigation into the open submenu layer.
      fireEvent.mouseLeave(insert, { relatedTarget: document.body });
      expect(insert.classList.contains('is-hovered')).toBe(false);
      expect(document.activeElement).toBe(rootContainer);

      fireEvent.keyDown(rootContainer, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(table);

      fireEvent.keyDown(table, { key: 'Escape' });
      expect(screen.queryByRole('menuitem', { name: 'Table' })).toBeNull();
      expect(document.activeElement).toBe(insert);
      expect(onDismiss).not.toHaveBeenCalled();

      fireEvent.keyDown(insert, { key: 'Escape' });
      expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
    });
  });

  it('closes an open hovered submenu on Escape and dismisses on second Escape directly from menu container focus', async () => {
    const onDismiss = vi.fn();
    await withManualRafAndExternalFocus(async ({ flushFrame }) => {
      render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={onDismiss}
          open
        />
      );

      const viewport = document.body.querySelector<HTMLElement>('[data-easymde-context-menu-viewport="true"]');
      const rootContainer = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
      if (!viewport || !rootContainer) throw new Error('context-menu-container-missing');

      const insert = screen.getByRole('menuitem', { name: 'Insert' });
      fireEvent.mouseEnter(insert);
      await screen.findByRole('menuitem', { name: 'Table' });
      flushFrame();

      expect(viewport.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(rootContainer);

      fireEvent.keyDown(rootContainer, { key: 'Escape' });
      expect(screen.queryByRole('menuitem', { name: 'Table' })).toBeNull();
      expect(document.activeElement).toBe(insert);
      expect(onDismiss).not.toHaveBeenCalled();

      fireEvent.keyDown(insert, { key: 'Escape' });
      expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
    });
  });

  it('still focuses root item 0 after rAF when opened without early pointer hover', async () => {
    await withManualRafAndExternalFocus(({ external, flushFrame }) => {
      expect(document.activeElement).toBe(external);

      render(
        <EditorContextMenu
          anchor={{ x: 12, y: 18 }}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
        />
      );

      const copy = screen.getByRole('menuitem', { name: 'Copy' });
      flushFrame();
      expect(document.activeElement).toBe(copy);
    });
  });

  it('preserves focus inside the menu container without focusing the new child when hovering a sibling submenu while focus is in an open submenu', async () => {
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={siblingSubmenusModel}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );

    const viewport = document.body.querySelector<HTMLElement>('[data-easymde-context-menu-viewport="true"]');
    const rootContainer = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!viewport || !rootContainer) throw new Error('context-menu-container-missing');

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    const format = screen.getByRole('menuitem', { name: 'Format' });
    insert.focus();
    fireEvent.keyDown(insert, { key: 'ArrowRight' });

    const table = screen.getByRole('menuitem', { name: 'Table' });
    expect(document.activeElement).toBe(table);

    fireEvent.mouseEnter(format);
    const bold = await screen.findByRole('menuitem', { name: 'Bold' });
    expect(screen.queryByRole('menuitem', { name: 'Table' })).toBeNull();
    expect(viewport.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(rootContainer);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(bold);
    expect(bold.classList.contains('is-hovered')).toBe(false);
    expect(bold.tabIndex).toBe(-1);

    fireEvent.keyDown(rootContainer, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Bold' })).toBeNull();
    expect(document.activeElement).toBe(format);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(format, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
  });

  it('preserves focus inside the menu container when hovering a non-submenu root sibling while focus is in an open submenu', async () => {
    const onDismiss = vi.fn();
    render(
      <EditorContextMenu
        anchor={{ x: 12, y: 18 }}
        direction="ltr"
        model={siblingSubmenusModel}
        onAction={vi.fn()}
        onDismiss={onDismiss}
        open
      />
    );

    const viewport = document.body.querySelector<HTMLElement>('[data-easymde-context-menu-viewport="true"]');
    const rootContainer = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
    if (!viewport || !rootContainer) throw new Error('context-menu-container-missing');

    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    insert.focus();
    fireEvent.keyDown(insert, { key: 'ArrowRight' });

    const table = screen.getByRole('menuitem', { name: 'Table' });
    expect(document.activeElement).toBe(table);

    fireEvent.mouseEnter(copy);
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Table' })).toBeNull());
    expect(viewport.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(rootContainer);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(copy);
    expect(copy.classList.contains('is-hovered')).toBe(true);

    fireEvent.keyDown(rootContainer, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith({ restoreFocus: true });
  });

  it('keeps ResizeObserver and global listeners stable across submenu open, switch, and close transitions', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe = observe;
      disconnect = disconnect;
    });
    const docAddSpy = vi.spyOn(document, 'addEventListener');
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
    const winAddSpy = vi.spyOn(window, 'addEventListener');
    const winRemoveSpy = vi.spyOn(window, 'removeEventListener');
    const boundary = document.createElement('div');
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 500,
        height: 500,
        left: 0,
        right: 600,
        top: 0,
        width: 600,
        x: 0,
        y: 0,
        toJSON: () => ({})
      })
    });
    document.body.append(boundary);

    try {
      const view = render(
        <EditorContextMenu
          anchor={{ x: 20, y: 20 }}
          boundaryElement={boundary}
          direction="ltr"
          model={fourLevelModel}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
          surfaceElement={boundary}
        />
      );

      const menuDocEvents = new Set(['pointerdown', 'contextmenu', 'keydown']);
      const menuWinEvents = new Set(['resize', 'scroll']);
      const countEvents = (
        spy: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } },
        types: ReadonlySet<string>
      ): number =>
        spy.mock.calls.filter(([type]) => 'string' === typeof type && types.has(type)).length;

      const initialObserveCount = observe.mock.calls.length;
      const initialDisconnectCount = disconnect.mock.calls.length;
      const initialDocAddCount = countEvents(docAddSpy, menuDocEvents);
      const initialDocRemoveCount = countEvents(docRemoveSpy, menuDocEvents);
      const initialWinAddCount = countEvents(winAddSpy, menuWinEvents);
      const initialWinRemoveCount = countEvents(winRemoveSpy, menuWinEvents);
      expect(initialObserveCount).toBe(2);
      expect(initialDisconnectCount).toBe(0);
      expect(initialDocAddCount).toBe(3);
      expect(initialWinAddCount).toBe(2);

      const insert = screen.getByRole('menuitem', { name: 'Insert' });
      fireEvent.mouseEnter(insert);
      const more = await screen.findByRole('menuitem', { name: 'More' });
      fireEvent.mouseEnter(more);
      const deep = await screen.findByRole('menuitem', { name: 'Deep' });
      fireEvent.mouseEnter(deep);
      await screen.findByRole('menuitem', { name: 'Leaf' });

      // Collapse nested layers via Escape back to root
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(observe).toHaveBeenCalledTimes(initialObserveCount);
      expect(disconnect).toHaveBeenCalledTimes(initialDisconnectCount);
      expect(countEvents(docAddSpy, menuDocEvents)).toBe(initialDocAddCount);
      expect(countEvents(docRemoveSpy, menuDocEvents)).toBe(initialDocRemoveCount);
      expect(countEvents(winAddSpy, menuWinEvents)).toBe(initialWinAddCount);
      expect(countEvents(winRemoveSpy, menuWinEvents)).toBe(initialWinRemoveCount);

      view.unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(countEvents(docRemoveSpy, menuDocEvents)).toBe(3);
      expect(countEvents(winRemoveSpy, menuWinEvents)).toBe(2);
    } finally {
      docAddSpy.mockRestore();
      docRemoveSpy.mockRestore();
      winAddSpy.mockRestore();
      winRemoveSpy.mockRestore();
      boundary.remove();
      vi.unstubAllGlobals();
    }
  });

  it('hides the submenu pointer and marks the frame overlapped on narrow viewports', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    render(
      <EditorContextMenu
        anchor={{ x: 20, y: 18 }}
        direction="ltr"
        model={model}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        open
      />
    );

    const insert = screen.getByRole('menuitem', { name: 'Insert' });
    Object.defineProperty(insert, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 130,
        height: 30,
        left: 26,
        right: 234,
        top: 100,
        width: 208,
        x: 26,
        y: 100,
        toJSON: () => ({})
      })
    });

    fireEvent.mouseEnter(insert);
    const table = await screen.findByRole('menuitem', { name: 'Table' });
    const submenu = table.closest<HTMLElement>('[data-easymde-context-menu-layer]');
    if (!submenu) throw new Error('context-menu-submenu-missing');
    Object.defineProperty(submenu, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 220,
        height: 120,
        left: 0,
        right: 220,
        top: 100,
        width: 220,
        x: 0,
        y: 100,
        toJSON: () => ({})
      })
    });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      const frame = submenu.parentElement;
      expect(frame?.className).toBe('easymde-editor-context-menu__submenu-frame');
      expect(frame?.dataset.easymdeContextMenuOverlapped).toBe('true');
      expect(frame?.dataset.easymdeContextMenuPlacement).toBe('right');
      expect(submenu.style.left).toBe('162px');
      expect(
        document.body.querySelector('[data-easymde-context-menu-pointer="true"]')
      ).toBeNull();
    });
  });

  it('keeps a root menu inside the viewport without horizontal clip-path when the boundary is narrower than the menu', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }

      disconnect(): void {}

      observe(): void {}
    });
    const boundary = document.createElement('div');
    Object.defineProperty(boundary, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 400,
        height: 340,
        left: 20,
        right: 180,
        top: 60,
        width: 160,
        x: 20,
        y: 60,
        toJSON: () => ({})
      })
    });
    document.body.append(boundary);

    try {
      render(
        <EditorContextMenu
          anchor={{ x: 100, y: 100 }}
          boundaryElement={boundary}
          direction="ltr"
          model={model}
          onAction={vi.fn()}
          onDismiss={vi.fn()}
          open
        />
      );
      const menu = document.body.querySelector<HTMLElement>('[data-easymde-context-menu="true"]');
      if (!menu) throw new Error('context-menu-missing');
      Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 220 });
      Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 120 });

      act(() => {
        for (const callback of resizeCallbacks) callback();
      });

      const left = Number.parseFloat(menu.style.left);
      expect(left).toBe(100);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(left + 220).toBeLessThanOrEqual(632);
      expect(menu.style.clipPath).toBe('');
      expect(menu.style.maxBlockSize).toBe('300px');
    } finally {
      boundary.remove();
      vi.unstubAllGlobals();
    }
  });
});
