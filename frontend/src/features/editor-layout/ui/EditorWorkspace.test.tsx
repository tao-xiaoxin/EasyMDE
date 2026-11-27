import { createElement } from '@wordpress/element';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditorWorkspace } from './EditorWorkspace';

describe('EditorWorkspace', () => {
  it('renders the ordinary editor as a fixed source and Preview pair', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        source={<section>Source surface</section>}
        preview={<section>Preview surface</section>}
      />
    );

    const workspace = view.container.querySelector('.easymde-workspace');
    expect(workspace).not.toBeNull();
    expect(workspace?.className).toBe('easymde-workspace');
    expect(workspace?.children).toHaveLength(2);
    expect(workspace?.children[0]?.textContent).toBe('Source surface');
    expect(workspace?.children[1]?.textContent).toBe('Preview surface');
    expect(view.container.querySelector('.easymde-editor-context-bar')).toBeNull();
    expect(view.container.querySelector('.easymde-react-workspace')).toBeNull();
    expect(view.container.querySelector('.easymde-pane-divider')).toBeNull();
    expect(view.container.querySelector('.easymde-editor-status-bar')).toBeNull();
    expect(view.queryByRole('navigation', { name: 'Outline' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Writing statistics' })).toBeNull();
  });

  it('adds a restrained ordinary footer with a live Markdown character count and WordPress edit history', () => {
    let value = 'Hello 世界\n\nNext line';
    const listeners = new Set<() => void>();
    const document = {
      getValue: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
    const view = render(
      <EditorWorkspace
        direction="ltr"
        statusBarMode="detailed"
        ordinaryStatus={{
          document,
          lastEdited: 'Last edited by Editor on July 27, 2026 at 10:00',
          locale: 'en_US',
          wordCountTemplate: 'Character count: %s'
        }}
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );

    const count = view.getByText('Character count: 19');
    expect(count).toBeTruthy();
    expect(count.getAttribute('aria-live')).toBeNull();
    expect(
      view.getByText('Last edited by Editor on July 27, 2026 at 10:00')
    ).toBeTruthy();
    expect(view.container.querySelector('.easymde-workspace-shell')).toBeNull();
    expect(count.previousElementSibling).toBeNull();
    expect(
      count
        .closest('footer')
        ?.previousElementSibling?.classList.contains('easymde-workspace')
    ).toBe(true);

    value = ' \n\t';
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(view.getByText('Character count: 3')).toBeTruthy();
  });

  it('shows only the character count in compact status mode', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        statusBarMode="compact"
        ordinaryStatus={{
          document: { getValue: () => 'Hello', subscribe: () => () => undefined },
          lastEdited: 'Last edited yesterday',
          locale: 'en_US',
          wordCountTemplate: 'Character count: %s'
        }}
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );

    expect(view.getByText('Character count: 5')).toBeTruthy();
    expect(view.queryByText('Last edited yesterday')).toBeNull();
  });

  it('removes the ordinary footer in hidden status mode', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        statusBarMode="hidden"
        ordinaryStatus={{
          document: { getValue: () => 'Hello', subscribe: () => () => undefined },
          lastEdited: 'Last edited yesterday',
          locale: 'en_US',
          wordCountTemplate: 'Character count: %s'
        }}
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );

    expect(view.container.querySelector('.easymde-editor-status-bar')).toBeNull();
  });

  it('does not add the ordinary status owner to the immersive resizable workspace', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        splitResizable
        splitResizeLabel="Resize editor and Preview"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );

    expect(view.container.querySelector('.easymde-workspace-shell')).toBeNull();
    expect(view.container.querySelector('.easymde-editor-status-bar')).toBeNull();
  });

  it('keeps WordPress direction on the single React layout owner', () => {
    const view = render(
      <EditorWorkspace
        direction="rtl"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );

    expect(
      view.container.querySelector('[data-easymde-layout-owner="react"]')?.getAttribute('dir')
    ).toBe('rtl');
  });

  it('matches the reference split divider and resizes the existing source and Preview owners', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        splitResizable
        splitResizeLabel="Resize editor and Preview"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );
    const workspace = view.container.querySelector<HTMLElement>('.easymde-workspace');
    const separator = view.getByRole('separator', {
      name: 'Resize editor and Preview'
    });
    if (!workspace) throw new Error('workspace-unavailable');
    Object.defineProperty(workspace, 'offsetWidth', {
      configurable: true,
      value: 1000
    });

    expect(
      separator.classList.contains('easymde-immersive-pane-divider')
    ).toBe(true);
    expect(separator.getAttribute('aria-valuemin')).toBe('20');
    expect(separator.getAttribute('aria-valuemax')).toBe('80');
    expect(separator.getAttribute('aria-valuenow')).toBe('50');

    fireEvent.pointerDown(separator, {
      button: 2,
      clientX: 500,
      pointerId: 9,
      pointerType: 'mouse'
    });
    fireEvent.pointerMove(document, { clientX: 700, pointerId: 9 });
    expect(separator.getAttribute('aria-valuenow')).toBe('50');

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 500,
      pointerId: 1,
      pointerType: 'mouse'
    });
    fireEvent.pointerMove(document, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('70');
    expect(workspace.style.getPropertyValue('--easymde-split-start')).toBe('70');

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 700,
      pointerId: 2,
      pointerType: 'mouse'
    });
    fireEvent.pointerMove(document, { clientX: 1200, pointerId: 2 });
    fireEvent.pointerUp(document, { pointerId: 2 });
    expect(separator.getAttribute('aria-valuenow')).toBe('80');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('79');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
  });

  it('supports touch pointer dragging with capture, pointercancel cleanup, and RTL direction', () => {
    const view = render(
      <EditorWorkspace
        direction="rtl"
        splitResizable
        splitResizeLabel="Resize editor and Preview"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );
    const workspace = view.container.querySelector<HTMLElement>('.easymde-workspace');
    const separator = view.getByRole('separator', {
      name: 'Resize editor and Preview'
    });
    if (!workspace) throw new Error('workspace-unavailable');
    Object.defineProperty(workspace, 'offsetWidth', {
      configurable: true,
      value: 1000
    });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    let capturedId: number | null = null;
    Object.defineProperty(separator, 'setPointerCapture', {
      configurable: true,
      value: (id: number) => {
        capturedId = id;
        setPointerCapture(id);
      }
    });
    Object.defineProperty(separator, 'hasPointerCapture', {
      configurable: true,
      value: (id: number) => capturedId === id
    });
    Object.defineProperty(separator, 'releasePointerCapture', {
      configurable: true,
      value: (id: number) => {
        capturedId = null;
        releasePointerCapture(id);
      }
    });

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 500,
      pointerId: 7,
      pointerType: 'touch'
    });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.userSelect).toBe('none');
    // Unrelated pointer IDs must be ignored while a touch drag is active.
    fireEvent.pointerMove(document, { clientX: 100, pointerId: 8, pointerType: 'touch' });
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
    // In RTL, dragging left increases the logical start pane.
    fireEvent.pointerMove(document, { clientX: 350, pointerId: 7, pointerType: 'touch' });
    expect(separator.getAttribute('aria-valuenow')).toBe('65');
    expect(workspace.style.getPropertyValue('--easymde-split-start')).toBe('65');
    expect(workspace.style.getPropertyValue('--easymde-split-end')).toBe('35');

    fireEvent.pointerCancel(document, { pointerId: 7, pointerType: 'touch' });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.userSelect).toBe('');

    // Moves after pointercancel must not change the split.
    fireEvent.pointerMove(document, { clientX: 200, pointerId: 7, pointerType: 'touch' });
    expect(separator.getAttribute('aria-valuenow')).toBe('65');

    // Keyboard resizing in RTL remains intact after touch interaction.
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('66');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
  });

  it('notifies the Preview owner after a split layout change', () => {
    const onLayoutChange = vi.fn();
    const view = render(
      <EditorWorkspace
        direction="ltr"
        onLayoutChange={onLayoutChange}
        splitResizable
        splitResizeLabel="Resize editor and Preview"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );
    const separator = view.getByRole('separator', {
      name: 'Resize editor and Preview'
    });

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onLayoutChange).toHaveBeenCalledOnce();
  });

  it('does not render the split divider outside immersive split mode', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        splitResizable={false}
        splitResizeLabel="Resize editor and Preview"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );
    expect(view.queryByRole('separator')).toBeNull();
  });

  it('omits mode classes on the workspace and preserves is-split-resizable only when resizable', () => {
    const fixedView = render(
      <EditorWorkspace
        direction="ltr"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );
    const fixedWorkspace = fixedView.container.querySelector('.easymde-workspace');
    expect(fixedWorkspace?.className).toBe('easymde-workspace');
    expect(
      Array.from(fixedWorkspace?.classList ?? []).some((name) =>
        name.startsWith('is-mode-')
      )
    ).toBe(false);
    fixedView.unmount();

    const resizableView = render(
      <EditorWorkspace
        direction="ltr"
        splitResizable
        splitResizeLabel="Resize editor and Preview"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );
    const resizableWorkspace =
      resizableView.container.querySelector('.easymde-workspace');
    expect(resizableWorkspace?.className).toBe(
      'easymde-workspace is-split-resizable'
    );
    expect(
      Array.from(resizableWorkspace?.classList ?? []).some((name) =>
        name.startsWith('is-mode-')
      )
    ).toBe(false);
  });
});
