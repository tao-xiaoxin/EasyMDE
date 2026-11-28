import { createElement } from '@wordpress/element';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseMarkdownImageScale } from '../image-scale/image-scale-contract';
import { createEditorContextMenuOperationOwner } from './editor-context-menu-operation';
import { useEditorContextMenuDemand } from './editor-context-menu-demand';
import {
  EditorContextMenuFeature
} from './EditorContextMenuFeature';
import {
  clipboard,
  deferred,
  expectBackwardSelection,
  labels,
  layoutSurface,
  selectBackward
} from './editor-context-menu-feature.test-harness';

it('aborts and cleans the action operation when its transferred lifetime is cancelled or becomes stale', () => {
  for (const mode of ['cancelled', 'stale'] as const) {
    const listeners = new Set<() => void>();
    const owner = createEditorContextMenuOperationOwner({
      subscribeDocument: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      subscribeSelection: listener => { listeners.add(listener); return () => listeners.delete(listener); }
    });
    const lifetime = new AbortController();
    const cancel = vi.fn();
    let current = true;
    const operation = owner.begin({
      direction: 'ltr', position: { x: 0, y: 0 }, selection: { direction: 'none', start: 0, end: 0 },
      surface: 'visual', surfaceIdentity: {}, value: ''
    }, () => current, { signal: lifetime.signal, cancel });
    if (mode === 'cancelled') lifetime.abort();
    else {
      current = false;
      for (const listener of [...listeners]) listener();
    }
    expect(operation.controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    owner.finish(operation);
    owner.dispose();
    expect(cancel).toHaveBeenCalledOnce();
  }
});

it('releases the target and retires the menu when an action throws synchronously', () => {
  const visual = document.createElement('div');
  visual.contentEditable = 'true';
  visual.textContent = 'alpha';
  layoutSurface(visual);
  document.body.append(visual);
  const release = vi.fn();
  const { result, unmount } = renderHook(() => useEditorContextMenuDemand({
    clipboard: clipboard(), direction: 'ltr', onAction: () => { throw new Error('synthetic-action-failed'); }, onFailure: vi.fn()
  }));
  act(() => result.current.openSurface({
    boundaryElement: visual, element: visual,
    captureTarget: () => ({ release, resolve: () => visual }),
    getSnapshot: () => ({ selection: { direction: 'forward', start: 0, end: 5 }, value: 'alpha' }),
    isEditable: () => true, kind: 'visual'
  }, { x: 1, y: 1 }, visual, 'pointer'));
  expect(result.current.readOpen()).not.toBeNull();
  expect(() => act(() => result.current.invokeAction('cut'))).toThrow('synthetic-action-failed');
  expect(result.current.readOpen()).toBeNull();
  expect(release).toHaveBeenCalledOnce();
  unmount();
  expect(release).toHaveBeenCalledOnce();
  visual.remove();
});

describe('EditorContextMenuFeature', () => {
  it.each(['full', 'windowed'] as const)(
    'preserves a backward %s visual selection while entering a submenu',
    async (visualMode) => {
      const { container } = render(<div data-visual-mode={visualMode}>alpha beta</div>);
      const visual = container.firstElementChild;
      if (!(visual instanceof HTMLElement)) throw new Error('visual-fixture-missing');
      visual.contentEditable = 'true';
      layoutSurface(visual);
      const text = selectBackward(visual);

      render(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={vi.fn()}
          source={null}
          visual={{
            boundaryElement: visual,
            element: visual,
            getSnapshot: () => ({
              selection: { direction: 'backward', end: text.length, start: 0 },
              value: text.data
            }),
            isEditable: () => true,
            kind: 'visual'
          }}
        />
      );

      fireEvent.pointerDown(visual, { button: 2 });
      fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
      const menu = await screen.findByRole('menu');
      const root = menu.closest<HTMLElement>('[data-easymde-context-menu]');
      if (!root) throw new Error('context-menu-root-missing');
      // jsdom collapses the document Selection on HTMLElement.focus(), unlike
      // Chromium. Settle menu focus before testing our pointer restoration.
      root.focus();
      expect(root).toBe(document.activeElement);
      expect(document.getSelection()?.isCollapsed).toBe(true);

      const insert = screen.getByRole('menuitem', { name: labels.insert });
      fireEvent.pointerDown(insert, { button: 0 });
      expectBackwardSelection(text);

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expectBackwardSelection(text);
    }
  );

  // Real menu focus and native Escape selection return are covered in
  // tests/e2e/context-menu/visual-menu-and-thematic-breaks.spec.mjs.

  it('keeps providerless mixed text copyable while disabling relative insertion', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'table\n\nTail';
    layoutSurface(source);
    document.body.append(source);
    const value = '|A|B|\n|---|---|\n|1|2|\n\nTail';
    const onAction = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'forward', end: value.length, start: 0 },
            value
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert' }));
    expect(
      screen.getByRole('menuitem', { name: 'Insert paragraph above' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      screen.getByRole('menuitem', { name: 'Insert table above' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      screen.getByRole('menuitem', { name: 'Insert image above' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy / Paste as' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as Markdown' }));
    expect(onAction).toHaveBeenCalledWith(
      'copy-as-markdown',
      expect.objectContaining({
        selection: { direction: 'forward', end: value.length, start: 0 },
        value
      })
    );
    view.unmount();
  });

  it('renders invalid table operations as disabled while keeping generic copy and new-table insertion enabled', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'table';
    layoutSurface(source);
    document.body.append(source);
    const value = '<!-- easymde-table-align:v1 {bad} -->\n| A |\n| --- |\n| 1 |';
    const cellStart = value.lastIndexOf('1');
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'forward', end: cellStart + 1, start: cellStart },
            value
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Table' }));
    for (const name of [
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      'Delete row',
      'Delete column',
      'Copy table',
      'Format Table Source',
      'Delete table',
      'Insert paragraph above table',
      'Insert paragraph below table'
    ]) {
      expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
    }
    view.unmount();
  });

  it('forwards validated generated and link contexts and retains a lease until the action settles', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'alpha';
    layoutSurface(source);
    document.body.append(source);
    const release = vi.fn();
    const pending = deferred<void>();
    const actionContext = {
      generated: {
        canCopyImage: true,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease: {
          isCurrent: () => true,
          release,
          root: source,
          target: {} as never
        },
        mode: 'immersive' as const,
        validateLease: () => true
      },
      link: { href: 'https://example.test/docs' }
    };
    const onAction = vi.fn(() => pending.promise);
    const view = render(
      <EditorContextMenuFeature
        canCopySimplified
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => actionContext,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Formula' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Copy link address' })
    );

    expect(onAction).toHaveBeenCalledWith(
      'copy-link-address',
      expect.objectContaining({ value: 'alpha' }),
      actionContext
    );
    expect(release).not.toHaveBeenCalled();
    pending.resolve();
    await waitFor(() => expect(release).toHaveBeenCalledOnce());
    view.unmount();
  });

  it('does not render a code-block submenu when a generated block owns the source selection', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'flowchart TD';
    layoutSurface(source);
    document.body.append(source);
    const release = vi.fn();
    const value = '```mermaid\nflowchart TD\n```';
    const flowchart = value.indexOf('flowchart');
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => ({
            generated: {
              canCopyImage: true,
              canCopyMathMl: false,
              canUseSource: true,
              filename: 'diagram.png',
              identity: () => null,
              kind: 'mermaid' as const,
              lease: {
                isCurrent: () => true,
                release,
                root: source,
                target: {} as never
              },
              mode: 'ordinary' as const,
              validateLease: () => true
            }
          }),
          getSnapshot: () => ({
            selection: { direction: 'none', end: flowchart, start: flowchart },
            value
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(screen.queryAllByRole('menuitem', { name: 'Code block' })).toHaveLength(0);
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: 'Diagram' }));
    expect(screen.queryAllByRole('menuitem', { name: 'Code block' })).toHaveLength(0);
    view.unmount();
  });

  it('releases a replacement menu lease while an earlier action is still pending', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const outside = document.createElement('div');
    document.body.append(outside);
    const firstRelease = vi.fn();
    const secondRelease = vi.fn();
    const firstPending = deferred<void>();
    const context = (release: () => void) => ({
      generated: {
        canCopyImage: true,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease: {
          isCurrent: () => true,
          release,
          root: source,
          target: {} as never
        },
        mode: 'immersive' as const,
        validateLease: () => true
      },
      link: { href: 'https://example.test/docs' }
    });
    const contexts = [context(firstRelease), context(secondRelease)];
    let contextIndex = 0;
    let actionCount = 0;
    const onAction = vi.fn(() => {
      actionCount += 1;
      return 1 === actionCount ? firstPending.promise : undefined;
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => contexts[Math.min(contextIndex++, 1)] ?? null,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Copy link address' })
    );
    fireEvent.contextMenu(source, { clientX: 30, clientY: 40 });
    fireEvent.contextMenu(outside);
    expect(secondRelease).toHaveBeenCalledOnce();
    expect(firstRelease).not.toHaveBeenCalled();
    firstPending.resolve();
    await waitFor(() => expect(firstRelease).toHaveBeenCalledOnce());
    view.unmount();
  });

  it('keeps the pending resource owned by an action across automatic dismissal', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const outside = document.createElement('div');
    document.body.append(outside);
    const pendingResourceRelease = vi.fn();
    const leaseRelease = vi.fn();
    const actionPending = deferred<void>();
    const actionContext = {
      generated: {
        canCopyImage: true,
        canCopyMathMl: false,
        canUseSource: true,
        filename: 'diagram.png',
        identity: () => null,
        kind: 'mermaid' as const,
        lease: {
          isCurrent: () => true,
          release: leaseRelease,
          root: source,
          target: {} as never
        },
        mode: 'ordinary' as const,
        validateLease: () => true
      }
    };
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn(() => actionPending.promise)}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => actionContext,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 3, start: 0 },
            value: '```mermaid\nflowchart\n```'
          }),
          isEditable: () => true,
          kind: 'source',
          releasePending: pendingResourceRelease
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: 'Diagram' }));
    const copyMenu = await waitFor(() => {
      const candidate = screen
        .getAllByRole('menuitem', { name: 'Copy' })
        .find((item) => item.getAttribute('aria-haspopup') === 'menu');
      if (!candidate) throw new Error('generated-copy-menu-missing');
      return candidate;
    });
    fireEvent.mouseEnter(copyMenu);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy as image' }));
    fireEvent.contextMenu(outside);
    expect(pendingResourceRelease).not.toHaveBeenCalled();
    expect(leaseRelease).not.toHaveBeenCalled();
    actionPending.resolve();
    await waitFor(() => expect(leaseRelease).toHaveBeenCalledOnce());
    view.unmount();
  });

  it('transfers a shared lease to a reopened menu before the first action settles', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const outside = document.createElement('div');
    document.body.append(outside);
    const release = vi.fn();
    const firstPending = deferred<void>();
    const actionContext = {
      generated: {
        canCopyImage: true,
        canCopyMathMl: false,
        canUseSource: true,
        filename: 'diagram.png',
        identity: () => null,
        kind: 'mermaid' as const,
        lease: {
          isCurrent: () => true,
          release,
          root: source,
          target: {} as never
        },
        mode: 'ordinary' as const,
        validateLease: () => true
      }
    };
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn(() => firstPending.promise)}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => actionContext,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 3, start: 0 },
            value: '```mermaid\nflowchart\n```'
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    const clickCopyImage = async (): Promise<void> => {
      fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: 'Diagram' }));
      const copyMenu = await waitFor(() => {
        const candidate = screen
          .getAllByRole('menuitem', { name: 'Copy' })
          .find((item) => item.getAttribute('aria-haspopup') === 'menu');
        if (!candidate) throw new Error('generated-copy-menu-missing');
        return candidate;
      });
      fireEvent.mouseEnter(copyMenu);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy as image' }));
    };
    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    await clickCopyImage();
    fireEvent.contextMenu(source, { clientX: 30, clientY: 40 });
    await screen.findByRole('menu');
    fireEvent.contextMenu(outside);
    expect(release).not.toHaveBeenCalled();
    firstPending.resolve();
    await waitFor(() => expect(release).toHaveBeenCalledOnce());
    view.unmount();
  });

  it('closes a captured menu before readiness can rebuild it for a changed source', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const listeners = new Set<() => void>();
    const releasePending = vi.fn();
    const releaseA = vi.fn();
    const releaseB = vi.fn();
    const getActionContext = vi.fn();
    let current = {
      revision: 1,
      selection: { direction: 'none' as const, end: 3, start: 0 },
      value: 'A$x$'
    };
    getActionContext.mockImplementation(() => ({
      generated: {
        canCopyImage: true,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease: {
          isCurrent: () => true,
          release: 1 === current.revision ? releaseA : releaseB,
          root: source,
          target: {} as never
        },
        mode: 'ordinary' as const,
        validateLease: () => true
      }
    }));
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext,
          getSnapshot: () => current,
          isEditable: () => true,
          kind: 'source',
          releasePending,
          subscribeReadiness: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(getActionContext).toHaveBeenCalledOnce();
    current = {
      revision: 2,
      selection: { direction: 'none', end: 4, start: 1 },
      value: 'B$y$'
    };
    for (const listener of listeners) listener();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(getActionContext).toHaveBeenCalledOnce();
    expect(releasePending).toHaveBeenCalledOnce();
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseB).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('passes a protected generated target to preparation before capturing a collapsed context', async () => {
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    const math = document.createElement('span');
    math.className = 'easymde-math';
    surface.append(math);
    layoutSurface(surface);
    document.body.append(surface);
    const prepare = vi.fn(() => true);
    const onFailure = vi.fn();
    const actionContext = {
      generated: {
        canCopyImage: false,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease: {
          isCurrent: () => true,
          release: vi.fn(),
          root: math,
          target: {} as never
        },
        mode: 'immersive' as const,
        validateLease: () => true
      }
    };
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surface,
          element: surface,
          getActionContext: () => actionContext,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: '$x$'
          }),
          isEditable: () => true,
          kind: 'visual',
          prepare
        }}
      />
    );

    fireEvent.contextMenu(math, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    // A context-menu request without a preceding pointer gesture is a keyboard
    // activation, and preparation receives that activation explicitly.
    expect(prepare).toHaveBeenCalledWith(
      math,
      undefined,
      { x: 20, y: 30 },
      'keyboard'
    );
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens only from the editable source surface and captures a right-click context', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'alpha beta';
    layoutSurface(source);
    document.body.append(source);
    const onAction = vi.fn();
    const port = clipboard();
    render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'forward', end: 5, start: 0 },
            value: 'alpha beta'
          }),
          isEditable: () => true,
          kind: 'source',
          restoreFocus: vi.fn()
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Bold' })).toBeTruthy();
    expect(port.check).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(onAction).toHaveBeenCalledWith(
      'copy',
      expect.objectContaining({ surface: 'source', value: 'alpha beta' })
    );
  });

  it('omits text-formatting groups from the rendered resolved image context', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = '![alt](https://example.test/image.png)';
    layoutSurface(source);
    document.body.append(source);
    const value = '![alt](https://example.test/image.png)';
    const image = parseMarkdownImageScale(value, 0);
    if (!image) throw new Error('image-fixture-invalid');

    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => ({
            image: { canCopyImage: true, match: image }
          }),
          getSnapshot: () => ({
            selection: { direction: 'forward', end: value.length, start: 0 },
            value
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Bold' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Copy / Paste as' })).toBeNull();
    expect(document.querySelector('[data-easymde-context-menu-item="bold"]')).toBeNull();
    expect(document.querySelector('[data-easymde-context-menu-item="copy-paste-as"]')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Cut' }).getAttribute('aria-disabled')).toBe('false');
    expect(screen.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBe('false');
    expect(screen.getByRole('menuitem', { name: 'Paste' }).getAttribute('aria-disabled')).toBe('false');
    expect(screen.getByRole('menuitem', { name: 'Image scale' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Upload image' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete image' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy image' })).toBeTruthy();
  });

  it('starts Clipboard demand immediately but mounts only after context inventory readiness', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    const port = clipboard();
    render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () => ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('opens the menu again after a failed preparation instead of staying unavailable', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'alpha';
    layoutSurface(source);
    document.body.append(source);
    let attempts = 0;
    const onFailure = vi.fn();
    const port = clipboard();
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () => ({ status: 'ready' as const }),
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'none' as const, end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          prepare: () => {
            attempts += 1;
            if (1 === attempts) {
              throw new Error('editor-block-index-selection-map-failed');
            }
            return true;
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith('editor-block-index-selection-map-failed'));
    expect(screen.queryByRole('menu')).toBeNull();

    // The failed attempt must not leave the surface permanently unavailable:
    // the next right-click opens the menu again.
    fireEvent.contextMenu(source, { clientX: 100, clientY: 100 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(attempts).toBe(2);
    view.unmount();
  });

  it('returns focus to the visual surface when a successful command dismisses the menu', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    visual.tabIndex = -1;
    visual.textContent = 'alpha beta';
    layoutSurface(visual);
    document.body.append(visual);
    const action = deferred<void>();
    const onAction = vi.fn(() => action.promise);
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: visual,
          element: visual,
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'forward', end: 5, start: 0 },
            value: 'alpha beta'
          }),
          isEditable: () => true,
          kind: 'visual',
          restoreFocus: () => visual.focus()
        }}
      />
    );

    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    fireEvent.click(await screen.findByRole('menuitem', { name: labels.cut }));
    expect(onAction).toHaveBeenCalledWith(
      'cut',
      expect.objectContaining({ value: 'alpha beta' })
    );
    // The visual command is still settling, but the menu must already have
    // handed focus back to the canvas, so an immediate Cmd+Z reaches the
    // editor's undo history instead of a detached body.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(visual);
    expect(onFailure).not.toHaveBeenCalled();
    action.resolve();
    view.unmount();
  });

  it.each(['resolve', 'reject', 'dispose'] as const)(
    'retains the visual target lease for a deferred action until %s',
    async (outcome) => {
      const visual = document.createElement('div');
      visual.contentEditable = 'true';
      visual.tabIndex = -1;
      visual.textContent = 'alpha beta';
      layoutSurface(visual);
      document.body.append(visual);
      const release = vi.fn();
      let settle!: () => void;
      const action = new Promise<void>((resolve, reject) => {
        settle = outcome === 'reject' ? () => reject(new Error('action-failed')) : resolve;
      });
      const view = render(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={() => action}
          onFailure={vi.fn()}
          source={null}
          visual={{
            boundaryElement: visual,
            captureTarget: () => ({ release, resolve: () => visual }),
            element: visual,
            getSnapshot: () => ({
              revision: 1,
              selection: { direction: 'forward', end: 5, start: 0 },
              value: 'alpha beta'
            }),
            isEditable: () => true,
            kind: 'visual'
          }}
        />
      );
      fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
      fireEvent.click(await screen.findByRole('menuitem', { name: labels.cut }));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(release).not.toHaveBeenCalled();
      if (outcome === 'dispose') view.unmount();
      if (outcome === 'dispose') expect(release).toHaveBeenCalledOnce();
      settle();
      await waitFor(() => expect(release).toHaveBeenCalledOnce());
      if (outcome !== 'dispose') view.unmount();
    }
  );

  it('invalidates a pending target when a new gesture replaces it', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    visual.textContent = 'alpha beta';
    layoutSurface(visual);
    document.body.append(visual);
    const firstRelease = vi.fn();
    const secondRelease = vi.fn();
    const generatedRelease = vi.fn();
    const action = deferred<void>();
    let captures = 0;
    let signal: AbortSignal | undefined;
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={(_id, _captured, context) => {
          signal = context?.operation?.signal;
          return action.promise;
        }}
        onFailure={vi.fn()}
        source={null}
        visual={{
          boundaryElement: visual,
          captureTarget: () => ({ release: captures++ === 0 ? firstRelease : secondRelease, resolve: () => visual }),
          element: visual,
          getActionContext: () => captures === 1 ? {
            generated: {
              canCopyImage: true, canCopyMathMl: true, canUseSource: true,
              identity: () => null, kind: 'math', mode: 'immersive',
              lease: { isCurrent: () => true, release: generatedRelease, root: visual, target: {} as never },
              validateLease: () => true
            }
          } : null,
          getSnapshot: () => ({
            revision: 1, selection: { direction: 'forward', end: 5, start: 0 }, value: 'alpha beta'
          }),
          isEditable: () => true,
          kind: 'visual'
        }}
      />
    );
    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    fireEvent.click(await screen.findByRole('menuitem', { name: labels.cut }));
    expect(signal?.aborted).toBe(false);
    fireEvent.contextMenu(visual, { clientX: 40, clientY: 50 });
    await screen.findByRole('menu');
    expect(signal?.aborted).toBe(true);
    expect(firstRelease).toHaveBeenCalledOnce();
    expect(generatedRelease).toHaveBeenCalledOnce();
    expect(secondRelease).not.toHaveBeenCalled();
    action.resolve();
    await act(async () => { await action.promise; });
    expect(generatedRelease).toHaveBeenCalledOnce();
    expect(secondRelease).not.toHaveBeenCalled();
    view.unmount();
    expect(secondRelease).toHaveBeenCalledOnce();
  });

  it('opens the menu again after a failed visual command retires the runtime generation', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    visual.textContent = 'alpha beta';
    layoutSurface(visual);
    document.body.append(visual);
    const readinessListeners = new Set<() => void>();
    const onFailure = vi.fn();
    const port = clipboard();
    let ready = true;
    let revision = 1;
    let generation = 1;
    const onAction = vi.fn(() =>
      Promise.reject(new Error('editor-visual-command-failed'))
    );
    const subscribeReadiness = (listener: () => void): (() => void) => {
      readinessListeners.add(listener);
      return () => readinessListeners.delete(listener);
    };
    const visualSurface = () => ({
      boundaryElement: visual,
      element: visual,
      generation,
      getBlockIndex: () => null,
      getContextReadiness: () =>
        ready
          ? { status: 'ready' as const }
          : { status: 'pending' as const },
      getSnapshot: () => ({
        revision,
        selection: { direction: 'forward' as const, end: 5, start: 0 },
        value: 'alpha beta'
      }),
      isEditable: () => true,
      kind: 'visual' as const,
      subscribeReadiness
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={null}
        visual={visualSurface()}
      />
    );

    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    fireEvent.click(await screen.findByRole('menuitem', { name: labels.cut }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // The owner reported the command as failed and retired the surface
    // generation while a fresh right-click waits for readiness. That demand
    // must survive the retirement and open once the new Preview is accepted.
    generation = 2;
    revision = 2;
    ready = false;
    view.rerender(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={null}
        visual={visualSurface()}
      />
    );
    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    expect(screen.queryByRole('menu')).toBeNull();

    generation = 3;
    revision = 3;
    ready = true;
    view.rerender(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={null}
        visual={visualSurface()}
      />
    );
    for (const listener of [...readinessListeners]) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens from keyboard context-menu keys and rejects a read-only visual surface', () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const visual = document.createElement('div');
    visual.contentEditable = 'false';
    layoutSurface(visual);
    document.body.append(visual);
    const onFailure = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="rtl"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        shortcut="Ctrl+B"
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={{
          boundaryElement: visual,
          element: visual,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => false,
          kind: 'visual'
        }}
      />
    );

    fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu').getAttribute('dir')).toBe('rtl');
    fireEvent.contextMenu(visual, { clientX: 4, clientY: 5 });
    expect(onFailure).toHaveBeenCalledWith('editor-context-menu-visual-surface-read-only');
  });

  it('does not open a menu for a readonly source owner', () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const onFailure = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => false,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 4, clientY: 5 });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('editor-context-menu-source-read-only');
  });

  it('keeps keyboard activation from preparing a pointer selection', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const preparePointerSelection = vi.fn(() => true);
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 2, start: 2 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          preparePointerSelection
        }}
        visual={null}
      />
    );

    fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(preparePointerSelection).not.toHaveBeenCalled();

    // Some browsers fire their own `contextmenu` event for the Context Menu
    // key. Without a preceding pointer gesture that request must keep the
    // user's selection instead of mapping the menu anchor as a pointer.
    fireEvent.contextMenu(source, { clientX: 300, clientY: 40 });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    expect(preparePointerSelection).not.toHaveBeenCalled();
  });

  it('fails explicitly when the pointer selection cannot be established', () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const onFailure = vi.fn();
    const preparePointerSelection = vi.fn(() => false);
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          preparePointerSelection
        }}
        visual={null}
      />
    );

    fireEvent.mouseDown(source, { button: 2, clientX: 20, clientY: 30 });
    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(preparePointerSelection).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onFailure).toHaveBeenCalledWith('editor-context-menu-selection-map-failed');
  });

  it('keeps the read-only failure code for a read-only source pointer', () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const onFailure = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => false,
          kind: 'source',
          preparePointerSelection: () => false
        }}
        visual={null}
      />
    );

    fireEvent.mouseDown(source, { button: 2, clientX: 20, clientY: 30 });
    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(onFailure).toHaveBeenCalledWith('editor-context-menu-source-read-only');
  });

  it('dismisses an outside contextmenu without preventing the native event and ignores menu contextmenu', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const outside = document.createElement('div');
    document.body.append(outside);
    const restoreFocus = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          restoreFocus
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 4, clientY: 5 });
    const menu = await screen.findByRole('menu');
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    menu.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(false);
    expect(screen.getByRole('menu')).toBe(menu);

    const outsideEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    outside.dispatchEvent(outsideEvent);
    expect(outsideEvent.defaultPrevented).toBe(false);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(restoreFocus).toHaveBeenCalledOnce();
  });

  it('retargets a visual image demand to the pointed image while the previous menu is open', async () => {
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    surface.innerHTML =
      '<p><img alt="first" src="https://example.test/first.png"></p>'
      + '<p><img alt="second" src="https://example.test/second.png"></p>';
    document.body.append(surface);
    const paragraphs = Array.from(surface.querySelectorAll('p'));
    const images = Array.from(surface.querySelectorAll('img'));
    const firstImage = images[0];
    const secondImage = images[1];
    const firstParagraph = paragraphs[0];
    const secondParagraph = paragraphs[1];
    if (!firstImage || !secondImage || !firstParagraph || !secondParagraph) {
      throw new Error('context-menu-visual-image-fixture-missing');
    }
    window.getSelection()?.removeAllRanges();
    const activations: Array<string | undefined> = [];
    const selectPointedImage = (
      target: Element | null | undefined,
      activation: 'keyboard' | 'pointer'
    ): void => {
      if ('pointer' !== activation || !target) return;
      const image = target instanceof HTMLImageElement ? target : target.closest('img');
      if (!image || !surface.contains(image)) return;
      const range = document.createRange();
      range.selectNode(image);
      const live = window.getSelection();
      live?.removeAllRanges();
      live?.addRange(range);
    };
    let selection: {
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    } = { direction: 'none', end: 0, start: 0 };
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={{
          boundaryElement: surface,
          element: surface,
          getSnapshot: () => ({ selection, value: 'markdown' }),
          isEditable: () => true,
          kind: 'visual',
          prepare: (target, _blockIndex, _position, activation) => {
            activations.push(activation);
            selectPointedImage(target, activation ?? 'keyboard');
            const live = window.getSelection();
            if (!live?.anchorNode || !live.focusNode) return false;
            selection = live.isCollapsed
              ? { direction: 'none', end: 0, start: 0 }
              : { direction: 'forward', end: 1, start: 0 };
            return true;
          }
        }}
      />
    );

    // Pointer activation on the first image describes that image.
    fireEvent.mouseDown(firstImage, { button: 2, clientX: 40, clientY: 20 });
    fireEvent.contextMenu(firstImage, { clientX: 40, clientY: 20 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(activations).toEqual(['pointer']);
    expect(window.getSelection()?.anchorNode).toBe(firstParagraph);

    // A second pointer demand replaces the open menu and rebinds the retained
    // image range to the image under the pointer instead of reusing the range
    // the first menu left behind.
    fireEvent.mouseDown(secondImage, { button: 2, clientX: 40, clientY: 80 });
    fireEvent.contextMenu(secondImage, { clientX: 40, clientY: 80 });
    await waitFor(() =>
      expect(activations).toEqual(['pointer', 'pointer'])
    );
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(window.getSelection()?.isCollapsed).toBe(false);
    expect(window.getSelection()?.anchorNode).toBe(secondParagraph);

    // Keyboard activation keeps the current selection and never re-anchors it.
    fireEvent.keyDown(surface, { key: 'F10', shiftKey: true });
    await waitFor(() =>
      expect(activations).toEqual(['pointer', 'pointer', 'keyboard'])
    );
    expect(window.getSelection()?.anchorNode).toBe(secondParagraph);
  });
});
