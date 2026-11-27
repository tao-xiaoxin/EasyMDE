import { createElement } from '@wordpress/element';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseMarkdownImageScale } from '../image-scale/image-scale-contract';
import type { EditorClipboardPort, EditorClipboardState } from '../../contracts/ports/editor-clipboard-port';
import * as editorContextMenuModel from './editor-context-menu-model';
import {
  EditorContextMenuFeature,
  type EditorContextMenuActionContext,
  type EditorContextMenuContextReadiness
} from './EditorContextMenuFeature';
import {
  clipboard,
  labels,
  layoutSurface
} from './editor-context-menu-feature.test-harness';

describe('EditorContextMenuFeature', () => {
  it('keeps a pending visual Preview demand silent while the surface is temporarily not editable', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'false';
    visual.textContent = 'alpha';
    layoutSurface(visual);
    document.body.append(visual);
    const readinessListeners = new Set<() => void>();
    const getBlockIndex = vi.fn(() => null);
    const prepare = vi.fn(() => true);
    let ready = false;
    let editable = false;
    const onFailure = vi.fn();
    const port = clipboard();
    render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: visual,
          element: visual,
          getBlockIndex,
          getContextReadiness: (_target, _snapshot, blockIndex) => {
            // The structural index is the input readiness itself depends on,
            // so the pending pass must still request it.
            expect(blockIndex).toBeNull();
            return ready ? { status: 'ready' as const } : { status: 'pending' as const };
          },
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => editable,
          kind: 'visual',
          prepare,
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
      />
    );

    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onFailure).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    // The pending pass requested the structural index so readiness can finish.
    expect(getBlockIndex).toHaveBeenCalledOnce();

    ready = true;
    editable = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(getBlockIndex).toHaveBeenCalledTimes(3);
    expect(prepare).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it.each(['ancestor', 'window'] as const)(
    'keeps a pending visual demand through a queued %s scroll and opens on readiness',
    async (targetKind) => {
      const canvas = document.createElement('div');
      const visual = document.createElement('div');
      visual.contentEditable = 'true';
      visual.textContent = 'alpha';
      layoutSurface(visual);
      canvas.append(visual);
      document.body.append(canvas);
      if ('ancestor' === targetKind) canvas.scrollTop = 459;
      const previousScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
      if ('window' === targetKind) {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 54 });
      }
      const readinessListeners = new Set<() => void>();
      let ready = false;
      const onFailure = vi.fn();
      const port = clipboard();
      render(
        <EditorContextMenuFeature
          clipboard={port}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={onFailure}
          source={null}
          visual={{
            boundaryElement: visual,
            element: visual,
            getBlockIndex: () => null,
            getContextReadiness: () => ready
              ? { status: 'ready' as const }
              : { status: 'pending' as const },
            getSnapshot: () => ({
              revision: 1,
              selection: { direction: 'none', end: 0, start: 0 },
              value: 'alpha'
            }),
            isEditable: () => true,
            kind: 'visual',
            subscribeReadiness: (listener) => {
              readinessListeners.add(listener);
              return () => readinessListeners.delete(listener);
            }
          }}
        />
      );
      try {
        fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
        await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.scroll(
          'ancestor' === targetKind ? canvas : window
        );
        ready = true;
        for (const listener of readinessListeners) listener();
        expect(await screen.findByRole('menu')).toBeTruthy();
        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        if (previousScrollY) {
          Object.defineProperty(window, 'scrollY', previousScrollY);
        } else {
          Reflect.deleteProperty(window, 'scrollY');
        }
        canvas.remove();
      }
    }
  );

  it.each(['ancestor', 'window'] as const)(
    'cancels a pending visual demand after a real %s scroll displacement',
    async (targetKind) => {
      const canvas = document.createElement('div');
      const visual = document.createElement('div');
      visual.contentEditable = 'true';
      visual.textContent = 'alpha';
      layoutSurface(visual);
      canvas.append(visual);
      document.body.append(canvas);
      if ('ancestor' === targetKind) canvas.scrollTop = 459;
      const previousScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
      if ('window' === targetKind) {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 54 });
      }
      const readinessListeners = new Set<() => void>();
      let ready = false;
      const onFailure = vi.fn();
      const port = clipboard();
      render(
        <EditorContextMenuFeature
          clipboard={port}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={onFailure}
          source={null}
          visual={{
            boundaryElement: visual,
            element: visual,
            getBlockIndex: () => null,
            getContextReadiness: () => ready
              ? { status: 'ready' as const }
              : { status: 'pending' as const },
            getSnapshot: () => ({
              revision: 1,
              selection: { direction: 'none', end: 0, start: 0 },
              value: 'alpha'
            }),
            isEditable: () => true,
            kind: 'visual',
            subscribeReadiness: (listener) => {
              readinessListeners.add(listener);
              return () => readinessListeners.delete(listener);
            }
          }}
        />
      );
      try {
        fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
        await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
        if ('ancestor' === targetKind) {
          canvas.scrollTop = 479;
          fireEvent.scroll(canvas);
        } else {
          Object.defineProperty(window, 'scrollY', { configurable: true, value: 84 });
          fireEvent.scroll(window);
        }
        ready = true;
        for (const listener of readinessListeners) listener();
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        if (previousScrollY) {
          Object.defineProperty(window, 'scrollY', previousScrollY);
        } else {
          Reflect.deleteProperty(window, 'scrollY');
        }
        canvas.remove();
      }
    }
  );

  it('keeps a pending demand when a non-ancestor sibling pane scrolls', async () => {
    const canvas = document.createElement('div');
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    visual.textContent = 'alpha';
    layoutSurface(visual);
    canvas.append(visual);
    document.body.append(canvas);
    const external = document.createElement('div');
    document.body.append(external);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    const onFailure = vi.fn();
    const port = clipboard();
    render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: visual,
          element: visual,
          getBlockIndex: () => null,
          getContextReadiness: () => ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'visual',
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
      await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
      external.scrollTop = 20;
      fireEvent.scroll(external);
      ready = true;
      for (const listener of readinessListeners) listener();
      // A synchronized sibling pane outside the surface's ancestor chain
      // cannot move the anchor, so the demand still opens its menu.
      expect(await screen.findByRole('menu')).not.toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
      // A real scroll of the surface's own ancestor still dismisses it.
      canvas.scrollTop = 20;
      fireEvent.scroll(canvas);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      external.remove();
      canvas.remove();
    }
  });

  it('replaces an open menu with a pending demand before promoting the new anchor', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let ready = true;
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

    fireEvent.contextMenu(source, { clientX: 100, clientY: 100 });
    const firstMenu = await screen.findByRole('menu');
    const firstLeft = firstMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')?.style.left;
    ready = false;
    fireEvent.contextMenu(source, { clientX: 300, clientY: 200 });
    expect(screen.queryByRole('menu')).toBeNull();
    ready = true;
    for (const listener of readinessListeners) listener();
    const secondMenu = await screen.findByRole('menu');
    const secondLeft = secondMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')?.style.left;
    expect(secondLeft).not.toBe(firstLeft);
    view.unmount();
  });

  it('cancels a pending Source demand on an internal selection change, including ABA', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    const selectionListeners = new Set<() => void>();
    let ready = false;
    let selection = { direction: 'none' as const, end: 0, start: 0 };
    const port = clipboard();
    const view = render(
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
          getSnapshot: () => ({ selection, value: 'alpha' }),
          isEditable: () => true,
          kind: 'source',
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          },
          subscribeSelection: (listener) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    selection = { direction: 'none', end: 3, start: 0 };
    for (const listener of selectionListeners) listener();
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    selection = { direction: 'none', end: 0, start: 0 };
    ready = true;
    for (const listener of readinessListeners) listener();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    view.unmount();
  });

  it('consumes Escape while a demand is pending so the mode owner cannot exit', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    const port = clipboard();
    const releasePending = vi.fn();
    const onAction = vi.fn();
    const onFailure = vi.fn();
    const modeEscape = vi.fn();
    const modeListener = (event: KeyboardEvent): void => {
      if ('Escape' === event.key && !event.defaultPrevented) modeEscape();
    };
    document.addEventListener('keydown', modeListener);
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () => ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none' as const, end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          releasePending,
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          },
          subscribeSelection: () => () => {}
        }}
        visual={null}
      />
    );
    try {
      fireEvent.contextMenu(source, { clientX: 100, clientY: 100 });
      await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
      // Composition and an already-owned chord must not cancel this demand.
      for (const init of [{ isComposing: true }, { keyCode: 229 }, {}]) {
        const ignored = new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'Escape', ...init
        });
        if (0 === Object.keys(init).length) ignored.preventDefault();
        source.dispatchEvent(ignored);
        expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
      }
      modeEscape.mockClear();
      const escapeEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape'
      });
      source.dispatchEvent(escapeEvent);
      expect(escapeEvent.defaultPrevented).toBe(true);
      expect(modeEscape).not.toHaveBeenCalled();
      expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
      // A late readiness notification cannot resurrect the cancelled demand.
      ready = true;
      for (const listener of readinessListeners) listener();
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      // Once the cancellation is terminal, the next ordinary Escape is not trapped.
      const nextEscape = new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Escape'
      });
      source.dispatchEvent(nextEscape);
      expect(nextEscape.defaultPrevented).toBe(false);
      expect(modeEscape).toHaveBeenCalledOnce();
      expect(releasePending).toHaveBeenCalledExactlyOnceWith('cancelled');
      expect(onAction).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      document.removeEventListener('keydown', modeListener);
    }
  });

  it('leaves ordinary Escape to the mode owner when no demand is pending', () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const modeEscape = vi.fn();
    const modeListener = (event: KeyboardEvent): void => {
      if ('Escape' === event.key && !event.defaultPrevented) modeEscape();
    };
    document.addEventListener('keydown', modeListener);
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
          getContextReadiness: () => ({ status: 'ready' as const }),
          getSnapshot: () => ({
            selection: { direction: 'none' as const, end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          subscribeReadiness: () => () => {},
          subscribeSelection: () => () => {}
        }}
        visual={null}
      />
    );
    try {
      const escapeEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape'
      });
      source.dispatchEvent(escapeEvent);
      expect(escapeEvent.defaultPrevented).toBe(false);
      expect(modeEscape).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      document.removeEventListener('keydown', modeListener);
    }
  });

  it('keeps a pending Windowed demand through the preparation-owned selection publication', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    layoutSurface(visual);
    document.body.append(visual);
    const selectionListeners = new Set<() => void>();
    const blockIndexListeners = new Set<() => void>();
    const value = '![alt](https://example.test/image.png)';
    let blockIndexReady = false;
    let selection = { direction: 'none' as const, end: 0, start: 0 };
    const port = clipboard();
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={{
          boundaryElement: visual,
          element: visual,
          getBlockIndex: () => blockIndexReady
            ? {
                blocks: [{
                  editable: true,
                  from: 0,
                  kind: 'paragraph' as const,
                  lineEnd: 0,
                  lineStart: 0,
                  to: value.length
                }],
                imageBlocks: [{ count: 1, firstImageIndex: 0, status: 'ready' as const }],
                imageRanges: [],
                length: value.length,
                mathSpans: [],
                source: value
              }
            : null,
          getContextReadiness: () => blockIndexReady
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({ selection, value }),
          isEditable: () => true,
          kind: 'visual',
          prepare: () => {
            if (0 === selection.start && 0 === selection.end) {
              selection = { direction: 'none', end: 4, start: 4 };
              // The Windowed owner establishes the caret natively and the
              // browser selection bridge publishes the normalized selection
              // after the contextmenu handler has returned.
              queueMicrotask(() => {
                for (const listener of selectionListeners) listener();
              });
            }
            return true;
          },
          subscribeBlockIndex: (listener) => {
            blockIndexListeners.add(listener);
            return () => blockIndexListeners.delete(listener);
          },
          subscribeSelection: (listener) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );

    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
    blockIndexReady = true;
    for (const listener of blockIndexListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    view.unmount();
  });

  it('still cancels a pending Windowed demand when the user changes the selection', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    layoutSurface(visual);
    document.body.append(visual);
    const selectionListeners = new Set<() => void>();
    const blockIndexListeners = new Set<() => void>();
    const value = '![alt](https://example.test/image.png)';
    let blockIndexReady = false;
    let selection = { direction: 'none' as const, end: 0, start: 0 };
    const port = clipboard();
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={{
          boundaryElement: visual,
          element: visual,
          getBlockIndex: () => blockIndexReady
            ? {
                blocks: [{
                  editable: true,
                  from: 0,
                  kind: 'paragraph' as const,
                  lineEnd: 0,
                  lineStart: 0,
                  to: value.length
                }],
                imageBlocks: [{ count: 1, firstImageIndex: 0, status: 'ready' as const }],
                imageRanges: [],
                length: value.length,
                mathSpans: [],
                source: value
              }
            : null,
          getContextReadiness: () => blockIndexReady
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({ selection, value }),
          isEditable: () => true,
          kind: 'visual',
          prepare: () => {
            if (0 === selection.start && 0 === selection.end) {
              selection = { direction: 'none', end: 4, start: 4 };
              queueMicrotask(() => {
                for (const listener of selectionListeners) listener();
              });
            }
            return true;
          },
          subscribeBlockIndex: (listener) => {
            blockIndexListeners.add(listener);
            return () => blockIndexListeners.delete(listener);
          },
          subscribeSelection: (listener) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );

    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The user moves the caret to a different document position while the
    // owner is still building the context inventory, so the pending demand no
    // longer describes what the user pointed at.
    selection = { direction: 'none', end: 5, start: 5 };
    for (const listener of selectionListeners) listener();
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    blockIndexReady = true;
    for (const listener of blockIndexListeners) listener();
    expect(screen.queryByRole('menu')).toBeNull();

    // Once the user right-clicks again on the now-ready surface, the menu must
    // open for the new demand instead of staying permanently unavailable.
    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    view.unmount();
  });

  it('rebinds a pending demand when only owner revisions advance before readiness', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    let revision = 1;
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
          getContextReadiness: () => ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision,
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

    fireEvent.contextMenu(source, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();

    // The block-index build and Preview acceptance legally advance the
    // revision while the demand waits. The first right-click must survive that
    // drift instead of being cancelled silently.
    revision = 2;
    for (const listener of readinessListeners) listener();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();

    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the first demand through the generation advance an accepted Preview causes', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    visual.textContent = 'alpha';
    layoutSurface(visual);
    document.body.append(visual);
    const readinessListeners = new Set<() => void>();
    const onFailure = vi.fn();
    const port = clipboard();
    let ready = false;
    let revision = 1;
    let generation = 1;
    const subscribeReadiness = (listener: () => void): (() => void) => {
      readinessListeners.add(listener);
      return () => readinessListeners.delete(listener);
    };
    // The owner recreates its memoized surface, including this structural
    // provider identity, whenever the Preview runtime generation advances.
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
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
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
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={visualSurface()}
      />
    );

    fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();

    // The transfer is accepted while the demand waits: generation, revision,
    // and the structural provider identity all advance without a user edit.
    // The documented rebinding contract keeps the demand alive, so the first
    // right-click still opens the menu instead of being silently dropped.
    generation = 2;
    revision = 2;
    ready = true;
    // The readiness owner may notify before React commits the replacement
    // surface. The promoted menu must survive that notification ordering too.
    for (const listener of [...readinessListeners]) listener();
    view.rerender(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={visualSurface()}
      />
    );
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each(['pending', 'open'] as const)(
    'closes a %s menu demand when owner drift also changes its value or selection',
    async (phase) => {
      const source = document.createElement('div');
      source.contentEditable = 'true';
      layoutSurface(source);
      document.body.append(source);
      const identity = {};
      const readinessListeners = new Set<() => void>();
      const prepare = vi.fn(() => true);
      const release = vi.fn();
      const getActionContext = vi.fn(() => ({
        generated: {
          canCopyImage: false,
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
      }));
      const port = clipboard();
      let generation = 1;
      let ready = 'open' === phase;
      let snapshot = {
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      };
      const surface = () => ({
        boundaryElement: source,
        element: source,
        generation,
        getActionContext,
        getContextReadiness: () => ready
          ? { status: 'ready' as const }
          : { status: 'pending' as const },
        getBlockIndex: () => null,
        getSnapshot: () => snapshot,
        identity,
        isEditable: () => true,
        kind: 'source' as const,
        prepare,
        subscribeReadiness: (listener: () => void) => {
          readinessListeners.add(listener);
          return () => readinessListeners.delete(listener);
        }
      });
      const view = render(
        <EditorContextMenuFeature
          clipboard={port}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={vi.fn()}
          source={surface()}
          visual={null}
        />
      );

      fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
      if ('open' === phase) {
        await screen.findByRole('menu');
      } else {
        await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
        expect(screen.queryByRole('menu')).toBeNull();
      }

      snapshot = {
        revision: 2,
        selection: { direction: 'none', end: 1, start: 1 },
        value: 'changed'
      };
      generation = 2;
      view.rerender(
        <EditorContextMenuFeature
          clipboard={port}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={vi.fn()}
          source={surface()}
          visual={null}
        />
      );

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(prepare).toHaveBeenCalledTimes('open' === phase ? 1 : 0);
      expect(getActionContext).toHaveBeenCalledTimes('open' === phase ? 1 : 0);
      if ('pending' === phase) {
        expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
        ready = true;
        for (const listener of [...readinessListeners]) listener();
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      } else {
        expect(release).toHaveBeenCalledOnce();
      }
      view.unmount();
    }
  );

  it('replays a pending demand after a readiness notification arrives before the new surface rerenders', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const identity = {};
    const oldReadinessListeners = new Set<() => void>();
    const newReadinessListeners = new Set<() => void>();
    const port = clipboard();
    const surface = (provider: 'old' | 'new') => ({
      boundaryElement: source,
      element: source,
      getContextReadiness: () => provider === 'new'
        ? { status: 'ready' as const }
        : { status: 'pending' as const },
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'source' as const,
      subscribeReadiness: (listener: () => void) => {
        const listeners = provider === 'new'
          ? newReadinessListeners
          : oldReadinessListeners;
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={surface('old')}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu')).toBeNull();
    for (const listener of oldReadinessListeners) listener();
    expect(screen.queryByRole('menu')).toBeNull();

    view.rerender(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={surface('new')}
        visual={null}
      />
    );

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(newReadinessListeners.size).toBeGreaterThan(0);
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
    view.unmount();
  });

  it('keeps an action lease alive when owner drift rebinds the open menu', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const identity = {};
    const release = vi.fn();
    const lease = {
      isCurrent: () => true,
      release,
      root: source,
      target: {} as never
    };
    const actionContext = {
      generated: {
        canCopyImage: false,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease,
        mode: 'immersive' as const,
        validateLease: () => true
      },
      link: { href: 'https://example.test/docs' }
    };
    const onAction = vi.fn();
    let generation = 1;
    const surface = () => ({
      boundaryElement: source,
      element: source,
      generation,
      getActionContext: () => actionContext,
      getBlockIndex: () => null,
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'source' as const
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={surface()}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    generation = 2;
    view.rerender(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={surface()}
        visual={null}
      />
    );
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    expect(release).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: labels.copyLinkAddress }));
    expect(onAction).toHaveBeenCalledWith(
      'copy-link-address',
      expect.objectContaining({ value: 'alpha' }),
      expect.objectContaining({ generated: expect.objectContaining({ lease }) })
    );
    expect(release).toHaveBeenCalled();
    view.unmount();
  });

  it.each(['same', 'replacement'] as const)(
    'does not release the refreshed image resource during %s-lease owner drift',
    async (leaseMode) => {
      const source = document.createElement('div');
      source.contentEditable = 'true';
      const imageElement = document.createElement('img');
      source.append(imageElement);
      const value = '![alt](https://example.test/image.png)';
      const image = parseMarkdownImageScale(value, 0);
      if (!image) throw new Error('image-fixture-invalid');
      layoutSurface(source);
      document.body.append(source);
      const identity = {};
      const onAction = vi.fn();
      const releasePending = vi.fn();
      let activeLease: {
        isCurrent: () => boolean;
        release: () => void;
        root: HTMLImageElement;
        target: never;
      } | null = null;
      const createLease = () => {
        const lease = {
          isCurrent: () => activeLease === lease,
          release: vi.fn(() => {
            if (activeLease === lease) activeLease = null;
          }),
          root: imageElement,
          target: {} as never
        };
        return lease;
      };
      const leaseA = createLease();
      const leaseB = 'same' === leaseMode ? leaseA : createLease();
      const actionContextFor = (lease: typeof leaseA) => ({
        image: {
          canCopyImage: true,
          lease,
          match: image
        }
      });
      releasePending.mockImplementation(() => {
        // EditorRoot's pending-release callback is global. If the feature
        // calls it while the refreshed context owns B, it invalidates B too.
        activeLease = null;
      });
      let generation = 1;
      const surface = () => ({
        boundaryElement: source,
        element: source,
        generation,
        getActionContext: () => {
          const lease = 1 === generation ? leaseA : leaseB;
          activeLease = lease;
          return actionContextFor(lease);
        },
        getSnapshot: () => ({
          revision: 1,
          selection: {
            direction: 'forward' as const,
            end: value.length,
            start: 0
          },
          value
        }),
        identity,
        isEditable: () => true,
        kind: 'source' as const,
        releasePending
      });
      const view = render(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={onAction}
          onFailure={vi.fn()}
          source={surface()}
          visual={null}
        />
      );

      fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
      await screen.findByRole('menu');
      expect(leaseA.isCurrent()).toBe(true);

      generation = 2;
      view.rerender(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={onAction}
          onFailure={vi.fn()}
          source={surface()}
          visual={null}
        />
      );

      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      expect(leaseB.isCurrent()).toBe(true);
      fireEvent.click(screen.getByRole('menuitem', { name: labels.copy }));
      expect(onAction).toHaveBeenCalledWith(
        'copy',
        expect.objectContaining({ value }),
        expect.objectContaining({
          image: expect.objectContaining({ lease: leaseB })
        })
      );
      view.unmount();
    }
  );

  it('asks the structural readiness pass without a demand context so an owned pending resource cannot hold it', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'alpha';
    layoutSurface(source);
    document.body.append(source);
    const readinessContexts: Array<
      EditorContextMenuActionContext | null | undefined
    > = [];
    const prepare = vi.fn(() => true);
    // The surface owns a generated resource that is still pending, exactly like
    // a Preview that has not certified the formula yet. The demand's own
    // generated context already owns that resource, so readiness may not report
    // it as an inventory gap once the context exists; the structural pass has
    // no context to evaluate and therefore has to stay structural.
    const actionContext = {
      generated: {
        canCopyImage: true,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease: {
          isCurrent: () => true,
          release: vi.fn(),
          root: source,
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
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getActionContext: () => actionContext,
          getContextReadiness: (
            _target,
            _snapshot,
            _blockIndex,
            actionContext
          ) => {
            readinessContexts.push(actionContext);
            return undefined === actionContext || actionContext?.generated
              ? { status: 'ready' as const }
              : { status: 'pending' as const };
          },
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          prepare
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    // The structural pass states no context, and the evaluated pass states the
    // context the demand owns.
    expect(readinessContexts[0]).toBeUndefined();
    expect(readinessContexts[readinessContexts.length - 1]?.generated).toBe(actionContext.generated);
    expect(prepare).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('rebinds a parked demand only through the lease the owner issued, and releases it on dismissal', async () => {
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const replaced = document.createElement('p');
    replaced.textContent = 'replaced';
    surface.append(replaced);
    document.body.append(surface);
    const live = document.createElement('p');
    live.textContent = 'live';
    const preparedTargets: Array<Element | null | undefined> = [];
    const contextTargets: Array<Element | null> = [];
    const readinessListeners = new Set<() => void>();
    const captureTarget = vi.fn(() => {
      const release = vi.fn();
      // The lease resolves against the owner's accepted DOM, which does not
      // contain the pointed element any more: only after the accepted window
      // commit installs `live` does resolution name a block.
      const lease = {
        release,
        resolve: () => (live.isConnected ? live : null)
      };
      return lease;
    });
    let ready = false;
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: surface,
          element: surface,
          captureTarget,
          getActionContext: (target) => {
            contextTargets.push(target);
            return null;
          },
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          prepare: (target) => {
            preparedTargets.push(target);
            return true;
          },
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(replaced, { clientX: 20, clientY: 30 });
    // The demand parks without asking the owner to resolve a target the
    // accepted Preview has not installed yet.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(captureTarget).toHaveBeenCalledOnce();
    expect(captureTarget).toHaveBeenCalledWith(replaced);
    expect(preparedTargets).toHaveLength(0);
    expect(contextTargets).toHaveLength(0);

    // The accepted commit replaces the pointed block, and the owner publishes
    // readiness. Preparation and the action context describe the live element
    // the lease authenticated, not the retired one.
    replaced.remove();
    surface.append(live);
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(preparedTargets).toEqual([live]);
    expect(contextTargets).toEqual([live]);

    // Dismissing retires that witness, so it cannot be resolved again.
    const lease = captureTarget.mock.results[0]?.value;
    expect(lease).toBeTruthy();
    fireEvent.contextMenu(surface, { clientX: 30, clientY: 40 });
    await waitFor(() => expect(lease?.release).toHaveBeenCalledOnce());

    // A later gesture captures its own lease instead of reusing the retired
    // one, and it resolves against the same owner-authenticated block.
    expect(captureTarget).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(preparedTargets).toHaveLength(2));
    expect(preparedTargets[1]).toBe(live);
    expect(contextTargets[1]).toBe(live);
    view.unmount();
  });

  it('reports a stable readiness failure instead of waiting indefinitely', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let readiness: EditorContextMenuContextReadiness = {
      code: 'editor-context-menu-structure-unavailable',
      status: 'unavailable'
    };
    const onFailure = vi.fn();
    const port = clipboard();
    const releasePending = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () => readiness,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          releasePending,
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
    expect(screen.queryByRole('menu')).toBeNull();
    readiness = { status: 'ready' };
    for (const listener of readinessListeners) listener();
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith('editor-context-menu-structure-unavailable'));
    expect(vi.mocked(port.check).mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    expect(releasePending).toHaveBeenCalledWith('unavailable');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('cancels pending demand on outside interaction and ignores late readiness', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const outside = document.createElement('div');
    document.body.append(outside);
    const readinessListeners = new Set<() => void>();
    const releasePending = vi.fn();
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
          getContextReadiness: () => ({ status: 'pending' as const }),
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source',
          releasePending,
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    fireEvent.pointerDown(outside);
    for (const listener of readinessListeners) listener();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(releasePending).toHaveBeenCalledWith('cancelled');
    view.unmount();
  });

  it('cancels a pending A context when the source changes through B and back to A', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let value = 'A';
    let ready = false;
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
          getContextReadiness: () => ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: value.length,
            selection: { direction: 'none', end: value.length, start: 0 },
            value
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
    value = 'B';
    for (const listener of readinessListeners) listener();
    value = 'A';
    ready = true;
    for (const listener of readinessListeners) listener();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    view.unmount();
  });

  it('does not fall back to a full parse when a runtime structure provider is unavailable', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const getBlockIndex = vi.fn(() => null);
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
          getBlockIndex,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 4, start: 4 },
            value: '```\ncode\n```'
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(getBlockIndex).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('menuitem', { name: 'Code block' })).toBeNull();
  });

  it('refreshes derived block state when the structure provider becomes ready', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const listeners = new Set<() => void>();
    let ready = false;
    const value = '```\ncode\n```';
    const getBlockIndex = vi.fn(() => ready
      ? {
          blocks: [{
            editable: true,
            from: 0,
            kind: 'code' as const,
            lineEnd: 2,
            lineStart: 0,
            to: value.length
          }],
          imageBlocks: [{ count: 0, firstImageIndex: 0, status: 'ready' as const }],
          imageRanges: [],
          length: value.length,
          mathSpans: [],
          source: value
        }
      : null);
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
          getBlockIndex,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 4, start: 4 },
            value
          }),
          isEditable: () => true,
          kind: 'source',
          subscribeBlockIndex: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    const menu = await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Code block' })).toBeNull();
    ready = true;
    listeners.forEach((listener) => {
      listener();
    });
    expect(await screen.findByRole('menuitem', { name: 'Code block' })).toBeTruthy();
    expect(screen.getByRole('menu')).toBe(menu);
  });

  it('retains a pending source resource until readiness and releases it on dismiss', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const outside = document.createElement('div');
    document.body.append(outside);
    const readinessListeners = new Set<() => void>();
    const pendingRelease = vi.fn();
    const generatedRelease = vi.fn();
    let ready = false;
    const actionContext = {
      generated: {
        canCopyImage: true,
        canCopyMathMl: true,
        canUseSource: true,
        identity: () => null,
        kind: 'math' as const,
        lease: {
          isCurrent: () => true,
          release: generatedRelease,
          root: source,
          target: {} as never
        },
        mode: 'ordinary' as const,
        validateLease: () => true
      }
    };
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
          getActionContext: () => ready ? actionContext : null,
          getSnapshot: () => ({
            selection: { direction: 'none', end: 3, start: 0 },
            value: '$x$'
          }),
          isEditable: () => true,
          kind: 'source',
          releasePending: pendingRelease,
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Formula' })).toBeNull();
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menuitem', { name: 'Formula' })).toBeTruthy();
    fireEvent.contextMenu(outside);
    await waitFor(() => expect(pendingRelease).toHaveBeenCalledOnce());
    expect(generatedRelease).toHaveBeenCalledOnce();
  });

  it('captures scroll baseline after prepareDemand and preparePointerSelection so synchronous scrollTop clamping does not cancel a pending menu while real post-gesture scroll still cancels it', async () => {
    const canvas = document.createElement('div');
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    visual.textContent = 'alpha';
    layoutSurface(visual);
    canvas.append(visual);
    document.body.append(canvas);
    canvas.scrollTop = 945;

    const readinessListeners = new Set<() => void>();
    let ready = false;
    let clampOnDemand = true;
    let clampOnPointer = false;
    const onFailure = vi.fn();
    const port = clipboard();
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: visual,
          element: visual,
          getBlockIndex: () => null,
          getContextReadiness: () =>
            ready
              ? { status: 'ready' as const }
              : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'visual',
          prepareDemand: () => {
            if (clampOnDemand) canvas.scrollTop = 889;
            return true;
          },
          preparePointerSelection: () => {
            if (clampOnPointer) canvas.scrollTop = 840;
            return true;
          },
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
      />
    );
    try {
      // Phase 1: synchronous scrollTop clamp inside prepareDemand (e.g. retiring
      // a detached documentEndSink) dispatches an async scroll event at the
      // clamped offset (889), which matches the post-preparation baseline and
      // must NOT cancel the pending menu.
      fireEvent.mouseDown(visual, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
      await waitFor(() => expect(port.check).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.scroll(canvas);
      ready = true;
      for (const listener of readinessListeners) listener();
      expect(await screen.findByRole('menu')).toBeTruthy();
      expect(onFailure).not.toHaveBeenCalled();

      // Dismiss and test Phase 2: synchronous clamp inside preparePointerSelection
      // also stays aligned with the baseline, while a genuine subsequent scroll
      // (840 -> 800) still cancels the pending menu.
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

      ready = false;
      clampOnDemand = false;
      clampOnPointer = true;
      fireEvent.mouseDown(visual, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
      await waitFor(() => expect(port.check).toHaveBeenCalledTimes(2));
      // Async scroll from clamping at 840 keeps pending demand alive.
      fireEvent.scroll(canvas);
      // Genuine user scroll away from 840 cancels the pending demand.
      canvas.scrollTop = 800;
      fireEvent.scroll(canvas);
      ready = true;
      for (const listener of readinessListeners) listener();
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      canvas.remove();
    }
  });

  it('does not recreate the menu model on non-substantive clipboard transitions while updating immediately when paste availability changes', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    source.textContent = 'alpha';
    layoutSurface(source);
    document.body.append(source);

    let currentClipboard: EditorClipboardState = { status: 'available' };
    const clipboardListeners = new Set<() => void>();
    const setClipboard = (next: EditorClipboardState): void => {
      currentClipboard = next;
      for (const listener of [...clipboardListeners]) listener();
    };
    const port: EditorClipboardPort = {
      check: vi.fn(async () => {
        setClipboard({ status: 'checking' });
        await Promise.resolve();
        setClipboard({ status: 'available' });
        return { status: 'available' as const, text: 'clipboard' };
      }),
      dispose: vi.fn(),
      getState: vi.fn(() => currentClipboard),
      read: vi.fn().mockResolvedValue({ status: 'available', text: 'clipboard' }),
      subscribe: vi.fn((listener: () => void) => {
        clipboardListeners.add(listener);
        return () => clipboardListeners.delete(listener);
      }),
      write: vi.fn().mockResolvedValue({ status: 'written' })
    };
    const modelSpy = vi.spyOn(editorContextMenuModel, 'createEditorContextMenuModel');

    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getSnapshot: () => ({
            revision: 1,
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha'
          }),
          isEditable: () => true,
          kind: 'source'
        }}
        visual={null}
      />
    );

    try {
      fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
      const pasteItem = await screen.findByRole('menuitem', { name: 'Paste' });
      expect(pasteItem.getAttribute('aria-disabled')).toBe('false');
      await waitFor(() => expect(port.check).toHaveBeenCalledOnce());
      const callsAfterOpen = modelSpy.mock.calls.length;
      expect(callsAfterOpen).toBe(1);

      // Non-substantive readable transitions must not rebuild the menu model.
      setClipboard({ status: 'checking' });
      setClipboard({ status: 'unknown' });
      setClipboard({ status: 'checking' });
      setClipboard({ status: 'available' });
      expect(modelSpy).toHaveBeenCalledTimes(callsAfterOpen);
      expect(pasteItem.getAttribute('aria-disabled')).toBe('false');

      // Transitioning to empty must update immediately and disable Paste.
      setClipboard({ status: 'empty' });
      await waitFor(() => expect(pasteItem.getAttribute('aria-disabled')).toBe('true'));
      expect(modelSpy).toHaveBeenCalledTimes(callsAfterOpen + 1);

      // Transient checking while empty must not flicker Paste back on or rebuild the model.
      setClipboard({ status: 'checking' });
      expect(pasteItem.getAttribute('aria-disabled')).toBe('true');
      expect(modelSpy).toHaveBeenCalledTimes(callsAfterOpen + 1);

      // Transitioning to available re-enables Paste.
      setClipboard({ status: 'available' });
      await waitFor(() => expect(pasteItem.getAttribute('aria-disabled')).toBe('false'));
      expect(modelSpy).toHaveBeenCalledTimes(callsAfterOpen + 2);

      // Transitioning to unsupported disables Paste immediately.
      setClipboard({ code: 'editor-clipboard-unsupported', status: 'unavailable' });
      await waitFor(() => expect(pasteItem.getAttribute('aria-disabled')).toBe('true'));
      expect(modelSpy).toHaveBeenCalledTimes(callsAfterOpen + 3);
    } finally {
      modelSpy.mockRestore();
      view.unmount();
      source.remove();
    }
  });
});
