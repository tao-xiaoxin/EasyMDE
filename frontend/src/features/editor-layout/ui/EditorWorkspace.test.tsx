import { createElement } from '@wordpress/element';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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

    fireEvent.mouseDown(separator, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);
    expect(separator.getAttribute('aria-valuenow')).toBe('70');
    expect(workspace.style.getPropertyValue('--easymde-split-start')).toBe('70');

    fireEvent.mouseDown(separator, { clientX: 700 });
    fireEvent.mouseMove(document, { clientX: 1200 });
    fireEvent.mouseUp(document);
    expect(separator.getAttribute('aria-valuenow')).toBe('80');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('79');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
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
});
