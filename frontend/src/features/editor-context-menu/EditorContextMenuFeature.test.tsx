import { createElement } from '@wordpress/element';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import { parseMarkdownImageScale } from '../image-scale/image-scale-contract';
import { createVisualImageInteraction } from '../immersive-editor/visual-markdown';
import {
  EditorContextMenuFeature,
  type EditorContextMenuActionContext,
  type EditorContextMenuContextReadiness,
  type EditorContextMenuSurfaceSnapshot,
  type EditorContextMenuTargetLease
} from './EditorContextMenuFeature';

const labels = {
  alignCenter: 'Align center',
  alignLeft: 'Align left',
  alignRight: 'Align right',
  alignment: 'Alignment',
  ariaLabel: 'Editor context menu',
  bold: 'Bold',
  codeBlock: 'Code block',
  copy: 'Copy',
  copyAsHtml: 'Copy as HTML code',
  copyAsMarkdown: 'Copy as Markdown',
  copyCodeBlock: 'Copy code block',
  copyCodeContent: 'Copy Code Block Content',
  indentCodeBlock: 'Adjust Code Block Indentation',
  indentSelectedCode: 'Adjust Selected Code Indentation',
  copyDiagramSource: 'Copy code',
  copyGeneratedImage: 'Copy as image',
  copyGeneratedMathMl: 'Copy MathML',
  copyImage: 'Copy image',
  copyLinkAddress: 'Copy link address',
  copyPasteAs: 'Copy / Paste as',
  copyMathSource: 'Copy TeX',
  copySimplifiedFormatting: 'Copy with simplified formatting',
  copyTable: 'Copy table',
  formatTableSource: 'Format Table Source',
  cut: 'Cut',
  deleteCodeBlock: 'Delete code block',
  deleteColumn: 'Delete column',
  deleteGeneratedContent: 'Delete',
  deleteImage: 'Delete image',
  deleteRow: 'Delete row',
  deleteTable: 'Delete table',
  deleteThematicBreak: 'Delete horizontal rule',
  diagramBlock: 'Diagram',
  editGeneratedContent: 'Edit',
  image: 'Image',
  imageScale: 'Image scale',
  insert: 'Insert',
  insertAbove: 'Insert paragraph above',
  insertBelow: 'Insert paragraph below',
  insertCodeAbove: 'Insert paragraph above code block',
  insertCodeBelow: 'Insert paragraph below code block',
  insertImageAbove: 'Insert image above',
  insertImageBelow: 'Insert image below',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  insertParagraphAboveGenerated: 'Insert paragraph above',
  insertParagraphAboveTable: 'Insert paragraph above table',
  insertParagraphBelowGenerated: 'Insert paragraph below',
  insertParagraphBelowTable: 'Insert paragraph below table',
  insertTableAbove: 'Insert table above',
  insertTableBelow: 'Insert table below',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  mathBlock: 'Formula',
  paste: 'Paste',
  pastePlainText: 'Paste as plain text',
  statusActionFailed: 'The editor action could not be completed.',
  statusClipboardUnavailable: 'Clipboard text is unavailable in this browser.',
  table: 'Table',
  unsupported: 'Unsupported for this selection.',
  uploadImage: 'Upload image'
} as const;

function clipboard(): EditorClipboardPort {
  return {
    check: vi.fn().mockResolvedValue({ status: 'available', text: 'clipboard' }),
    dispose: vi.fn(),
    getState: vi.fn(() => ({ status: 'available' as const })),
    read: vi.fn().mockResolvedValue({ status: 'available', text: 'clipboard' }),
    subscribe: vi.fn(() => () => undefined),
    write: vi.fn().mockResolvedValue({ status: 'written' })
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function layoutSurface(element: HTMLElement): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
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
}

function selectBackward(element: HTMLElement): Text {
  const text = element.firstChild;
  if (!(text instanceof Text)) throw new Error('context-menu-selection-text-missing');
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('context-menu-selection-owner-missing');
  selection.removeAllRanges();
  selection.setBaseAndExtent(text, text.length, text, 0);
  return text;
}

function expectBackwardSelection(text: Text): void {
  const selection = text.ownerDocument.defaultView?.getSelection();
  expect(selection?.anchorNode).toBe(text);
  expect(selection?.anchorOffset).toBe(text.length);
  expect(selection?.focusNode).toBe(text);
  expect(selection?.focusOffset).toBe(0);
}

/**
 * A source-like surface whose menu can be retained across a refresh that
 * returns pending readiness, so retention can be exercised without a real
 * Preview or block-index owner.
 */
function retainedPendingMenu() {
  const source = document.createElement('div');
  source.contentEditable = 'true';
  layoutSurface(source);
  document.body.append(source);
  const port = clipboard();
  const listeners = {
    readiness: new Set<() => void>(),
    selection: new Set<() => void>(),
    snapshot: new Set<() => void>()
  };
  const state = {
    link: null as Readonly<{ href: string }> | null,
    ready: true,
    selection: { direction: 'none' as const, end: 0, start: 0 },
    value: 'alpha'
  };
  const subscribe = (registry: Set<() => void>) => (listener: () => void) => {
    registry.add(listener);
    return () => registry.delete(listener);
  };
  const buildSource = () => ({
    boundaryElement: source,
    element: source,
    getActionContext: () => (state.link ? { link: state.link } : null),
    // A fresh provider identity per owner replacement is what makes the
    // Feature treat this as an owner-drift refresh.
    getBlockIndex: () => null,
    getContextReadiness: () =>
      state.ready ? { status: 'ready' as const } : { status: 'pending' as const },
    getSnapshot: () => ({ selection: state.selection, value: state.value }),
    isEditable: () => true,
    kind: 'source' as const,
    subscribeReadiness: subscribe(listeners.readiness),
    subscribeSelection: subscribe(listeners.selection),
    subscribeSnapshot: subscribe(listeners.snapshot)
  });
  const renderFeature = () => (
    <EditorContextMenuFeature
      clipboard={port}
      direction="ltr"
      labels={labels}
      onAction={vi.fn()}
      onFailure={vi.fn()}
      source={buildSource()}
      visual={null}
    />
  );
  const view = render(renderFeature());
  return {
    /** Deliver one subscription's notifications, as the surface owner does. */
    fire: (name: 'readiness' | 'selection' | 'snapshot'): void => {
      for (const listener of listeners[name]) listener();
    },
    /** Open the menu, then replace its owner so the rebuilt inventory is pending. */
    retain: async (): Promise<void> => {
      fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
      await screen.findByRole('menu');
      state.ready = false;
      view.rerender(renderFeature());
      expect(screen.getByRole('menu')).toBeTruthy();
    },
    state
  };
}

describe('EditorContextMenuFeature', () => {
  it.each(['full', 'windowed'] as const)(
    'preserves a backward %s visual selection while entering a submenu',
    async (visualMode) => {
      const visual = document.createElement('div');
      visual.contentEditable = 'true';
      visual.dataset.visualMode = visualMode;
      visual.append('alpha beta');
      layoutSurface(visual);
      document.body.append(visual);
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
      await screen.findByRole('menu');

      const insert = screen.getByRole('menuitem', { name: labels.insert });
      fireEvent.pointerDown(insert, { button: 0 });
      expectBackwardSelection(text);

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expectBackwardSelection(text);
    }
  );

  it.each(['full', 'windowed'] as const)(
    'preserves a backward %s visual selection after Escape cancellation',
    async (visualMode) => {
      const visual = document.createElement('div');
      visual.contentEditable = 'true';
      visual.dataset.visualMode = visualMode;
      visual.append('alpha beta');
      layoutSurface(visual);
      document.body.append(visual);
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
            kind: 'visual',
            restoreFocus: () => visual.focus()
          }}
        />
      );

      fireEvent.pointerDown(visual, { button: 2 });
      fireEvent.contextMenu(visual, { clientX: 20, clientY: 30 });
      await screen.findByRole('menu');
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expectBackwardSelection(text);
    }
  );

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
    expect(readinessContexts.at(-1)?.generated).toBe(actionContext.generated);
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

  it('prepares the source selection from the pointer before a pending demand is captured', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    const order: string[] = [];
    const pointerPositions: Array<Readonly<{ x: number; y: number }>> = [];
    let ready = false;
    let selection = { direction: 'none' as const, end: 0, start: 0 };
    const onAction = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => {
            order.push('snapshot');
            return { selection, value: 'alpha beta' };
          },
          isEditable: () => true,
          kind: 'source',
          preparePointerSelection: (position) => {
            order.push('pointer');
            pointerPositions.push(position);
            // The preparation owns the canonical selection: it republishes the
            // selection the pointer describes.
            selection = { direction: 'none', end: 5, start: 5 };
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

    fireEvent.mouseDown(source, { button: 2, clientX: 20, clientY: 30 });
    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    // The pointer ran before the first snapshot read, so the demand that still
    // has to wait for readiness already describes the pointed position.
    expect(order[0]).toBe('pointer');
    expect(screen.queryByRole('menu')).toBeNull();

    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    // Replaying the pending demand must not reinterpret the gesture's old
    // screen coordinates: the pointer runs exactly once, for the original
    // gesture.
    expect(pointerPositions).toEqual([{ x: 20, y: 30 }]);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    expect(onAction).toHaveBeenCalledWith(
      'paste',
      expect.objectContaining({
        selection: { direction: 'none', end: 5, start: 5 }
      })
    );
  });

  it.each(['pointer', 'keyboard'] as const)(
    'runs the %s demand preflight exactly once, before capture and snapshot, across every notification',
    async (activation) => {
      // The preflight is the owner's own pending-input settlement. It must run
      // once per gesture, before the target is captured and before any document
      // is read, and a readiness, index, or snapshot notification must not run
      // it (or a second capture) again: those notifications belong to the
      // demand that already ran it.
      const source = document.createElement('div');
      source.contentEditable = 'true';
      layoutSurface(source);
      const target = document.createElement('p');
      target.textContent = 'alpha';
      source.append(target);
      document.body.append(source);
      const readinessListeners = new Set<() => void>();
      const indexListeners = new Set<() => void>();
      const snapshotListeners = new Set<() => void>();
      const log: string[] = [];
      const capturedTargets: Array<Element | null> = [];
      const released = vi.fn();
      let value = 'alpha';
      let ready = true;
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
            captureTarget: (element: Element | null) => {
              log.push('capture');
              capturedTargets.push(element);
              return {
                release: released,
                resolve: () => {
                  log.push('resolve');
                  return target;
                }
              };
            },
            getActionContext: () => null,
            getBlockIndex: () => null,
            getContextReadiness: () => {
              log.push('readiness');
              return ready
                ? { status: 'ready' as const }
                : { status: 'pending' as const };
            },
            getSnapshot: () => {
              log.push('snapshot');
              return {
                selection: { direction: 'none' as const, end: value.length, start: value.length },
                value
              };
            },
            isEditable: () => true,
            kind: 'source',
            prepare: () => {
              log.push('prepare');
              return true;
            },
            // The owner's existing pending-input flush. Each call is a real
            // settlement, so a second call is observable in the document.
            prepareDemand: () => {
              log.push('preflight');
              value = 'alpha z';
              return true;
            },
            subscribeBlockIndex: (listener: () => void) => {
              indexListeners.add(listener);
              return () => indexListeners.delete(listener);
            },
            subscribeReadiness: (listener: () => void) => {
              readinessListeners.add(listener);
              return () => readinessListeners.delete(listener);
            },
            subscribeSnapshot: (listener: () => void) => {
              snapshotListeners.add(listener);
              return () => snapshotListeners.delete(listener);
            }
          }}
          visual={null}
        />
      );

      if ('pointer' === activation) {
        fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
        fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      } else {
        fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
      }
      await screen.findByRole('menu');

      // Order: the preflight settles the input, then the gesture is captured,
      // and only then is any document read.
      expect(log.filter((entry) => entry === 'preflight')).toHaveLength(1);
      expect(log.filter((entry) => entry === 'capture')).toHaveLength(1);
      expect(log.indexOf('preflight')).toBeLessThan(log.indexOf('capture'));
      expect(log.indexOf('capture')).toBeLessThan(log.indexOf('snapshot'));
      // The captured demand carries the settled document, so the menu already
      // describes the typed bytes rather than the pre-input source.
      // A pointer activation captures the pointed element; a keyboard
      // activation captures the surface itself, because the user selected no
      // node with the menu key.
      expect(capturedTargets).toEqual([
        'pointer' === activation ? target : source
      ]);
      expect(value).toBe('alpha z');
      expect(onFailure).not.toHaveBeenCalled();

      // Owner notifications are not new gestures: readiness, index, and
      // snapshot publications rebuild the same demand without settling input
      // or capturing a second witness.
      ready = false;
      for (const listener of [...readinessListeners]) listener();
      ready = true;
      for (const listener of [...indexListeners]) listener();
      for (const listener of [...snapshotListeners]) listener();
      await act(async () => {
        await Promise.resolve();
      });
      expect(log.filter((entry) => entry === 'preflight')).toHaveLength(1);
      expect(log.filter((entry) => entry === 'capture')).toHaveLength(1);
      expect(capturedTargets).toHaveLength(1);
      expect(screen.getByRole('menu')).toBeTruthy();
      view.unmount();
      expect(released).toHaveBeenCalledOnce();
    }
  );

  it.each(['pointer', 'keyboard'] as const)(
    'ends the %s gesture at a refused preflight without capturing a target or adding an error',
    async (activation) => {
      // A visual owner may refuse its own pending-input settlement (it is busy,
      // its selection is unusable, or the surface already failed closed). The
      // gesture then ends before any target is captured: no lease is created,
      // no document is read, and no second failure is reported on top of the one
      // the owner already raised through its own failure port.
      const surfaceElement = document.createElement('div');
      surfaceElement.contentEditable = 'true';
      layoutSurface(surfaceElement);
      const target = document.createElement('p');
      target.textContent = 'alpha';
      surfaceElement.append(target);
      document.body.append(surfaceElement);
      const captured = vi.fn();
      const reads: string[] = [];
      const onFailure = vi.fn();
      const view = render(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={onFailure}
          source={null}
          visual={{
            boundaryElement: surfaceElement,
            captureTarget: (element: Element | null) => {
              captured(element);
              return { release: vi.fn(), resolve: () => target };
            },
            element: surfaceElement,
            getContextReadiness: () => {
              reads.push('readiness');
              return { status: 'ready' as const };
            },
            getSnapshot: () => {
              reads.push('snapshot');
              return {
                selection: { direction: 'none' as const, end: 5, start: 5 },
                value: 'alpha'
              };
            },
            isEditable: () => true,
            kind: 'visual',
            prepare: () => {
              reads.push('prepare');
              return true;
            },
            prepareDemand: () => false
          }}
        />
      );
      try {
        if ('pointer' === activation) {
          fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
          fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
        } else {
          fireEvent.keyDown(surfaceElement, { key: 'F10', shiftKey: true });
        }
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(captured).not.toHaveBeenCalled();
        // The demand never read the document: no snapshot, no preparation.
        expect(reads).toEqual([]);
        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    }
  );

  /**
   * A pending-demand fixture whose target lease can publish the owner's
   * accepted selection transition. The surface keeps its revision and value
   * fixed and only moves the selection, which is exactly the accepted
   * presentation normalization the receipt exists for.
   */
  function acceptedSelectionFixture(options: {
    armed?: boolean;
    initialSelection?: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
    revision?: number | undefined;
  } = {}) {
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const readinessListeners = new Set<() => void>();
    const selectionListeners = new Set<() => void>();
    const snapshotListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: options.initialSelection ?? {
        direction: 'none' as const,
        end: 9,
        start: 9
      },
      value: 'a | b\n--- | ---'
    };
    let preflights = 0;
    let captures = 0;
    let resolves = 0;
    let armed = options.armed ?? true;
    let consumed = false;
    // The owner's armed publication: it knows the exact before/after it is
    // about to publish, so the receipt is checked against that, not against
    // whatever the surface currently reports.
    const initialSelection = options.initialSelection ?? {
      direction: 'none' as const,
      end: 9,
      start: 9
    };
    // Declared with the real selection direction union: the armed publication
    // may legitimately stage a directional selection, so narrowing this to
    // 'none' would be a lie about the owner's own record.
    let armedAfter: {
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    } = { direction: 'none', end: 0, start: 0 };
    // The owner's own record of the selection it staged BEFORE its write. It is
    // independent of what the demand captured, so a mismatch is detectable.
    let armedBefore = initialSelection;
    const consumes: Array<{
      before: EditorContextMenuSurfaceSnapshot;
      after: EditorContextMenuSurfaceSnapshot;
    }> = [];
    const prepares: Array<Element | null | undefined> = [];
    const actionContexts: Array<Element | null> = [];
    const released = vi.fn();
    const onFailure = vi.fn();
    const port = clipboard();
    const surface = () => ({
      boundaryElement: surfaceElement,
      element: surfaceElement,
      captureTarget: (): EditorContextMenuTargetLease => {
        captures += 1;
        return {
          release: released,
          resolve: () => {
            resolves += 1;
            return target;
          },
          // Stands in for the owner's real closed-over publication record:
          // armed around its own canonical write, single use, and every
          // non-matching call is a plain false.
          consumeAcceptedSelectionTransition: (before, after) => {
            consumes.push({ before, after });
            if (!armed || consumed) return false;
            // Both sides must state the same known revision: a missing
            // revision is a rejection, never undefined === undefined.
            if (undefined === before.revision || before.revision !== after.revision) {
              return false;
            }
            if (before.value !== after.value) return false;
            if (
              before.selection.start !== armedBefore.start
              || before.selection.end !== armedBefore.end
              || before.selection.direction !== armedBefore.direction
            ) return false;
            if (
              after.selection.start !== armedAfter.start
              || after.selection.end !== armedAfter.end
              || after.selection.direction !== armedAfter.direction
            ) return false;
            consumed = true;
            return true;
          }
        };
      },
      getActionContext: (element: Element | null) => {
        actionContexts.push(element);
        return null;
      },
      getBlockIndex: () => null,
      getContextReadiness: () => state.ready
        ? { status: 'ready' as const }
        : { status: 'pending' as const },
      getSnapshot: () => ({
        ...(undefined === options.revision ? {} : { revision: options.revision }),
        selection: state.selection,
        value: state.value
      }),
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: (element?: Element | null) => {
        prepares.push(element);
        return true;
      },
      prepareDemand: () => {
        preflights += 1;
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      },
      subscribeSelection: (listener: () => void) => {
        selectionListeners.add(listener);
        return () => selectionListeners.delete(listener);
      },
      subscribeSnapshot: (listener: () => void) => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={surface()}
      />
    );
    return {
      actionContexts,
      arm: (next: boolean) => {
        armed = next;
      },
      /** The exact selection the armed publication will install. */
      armAcceptedAfter: (selection: {
        direction: 'backward' | 'forward' | 'none';
        end: number;
        start: number;
      }) => {
        armedAfter = { ...selection };
      },
      /** The exact selection the owner staged before its own write. */
      armAcceptedBefore: (selection: {
        direction: 'backward' | 'forward' | 'none';
        end: number;
        start: number;
      }) => {
        armedBefore = selection;
      },
      captures: () => captures,
      consumes,
      fire: (name: 'readiness' | 'selection' | 'snapshot'): void => {
        const registry = 'readiness' === name
          ? readinessListeners
          : 'selection' === name
            ? selectionListeners
            : snapshotListeners;
        for (const listener of [...registry]) listener();
      },
      /** Open the gesture on the surface element and park on readiness. */
      open: (): void => {
        fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
        fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      },
      onFailure,
      preflights: () => preflights,
      prepares,
      releases: released,
      resolves: () => resolves,
      setReady: (ready: boolean) => {
        state.ready = ready;
      },
      setSelection: (
        selection: { direction: 'backward' | 'forward' | 'none'; end: number; start: number }
      ) => {
        state.selection = selection;
      },
      setValue: (value: string) => {
        state.value = value;
      },
      state,
      surfaceElement,
      target,
      unmount: () => view.unmount()
    };
  }

  it('keeps the first pending gesture when the owner publishes its accepted selection', async () => {
    // The owner normalizes its own presentation caret inside its accepted
    // write: value and revision stay identical and only the selection moves.
    // Without the receipt the ordinary matcher retires the demand the user is
    // still making.
    const fixture = acceptedSelectionFixture({ revision: 4 });
    try {
      fixture.open();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.preflights()).toBe(1);
      expect(fixture.captures()).toBe(1);

      // Accepted publication: same value, same revision, caret 9 -> 0.
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });

      // Exactly one consumption, with the demand's own capture as `before`.
      expect(fixture.consumes).toHaveLength(1);
      expect(fixture.consumes[0]?.before).toEqual({
        revision: 4,
        selection: { direction: 'none', end: 9, start: 9 },
        value: 'a | b\n--- | ---'
      });
      expect(fixture.consumes[0]?.after.selection).toEqual({
        direction: 'none',
        end: 0,
        start: 0
      });
      // The demand survived: still no menu, still no resolve/prepare/action.
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.resolves()).toBe(0);
      expect(fixture.prepares).toHaveLength(0);
      expect(fixture.actionContexts).toHaveLength(0);
      expect(fixture.onFailure).not.toHaveBeenCalled();

      // The same gesture then completes once readiness allows the read.
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await screen.findByRole('menu');
      expect(fixture.preflights()).toBe(1);
      expect(fixture.captures()).toBe(1);
      expect(fixture.resolves()).toBe(1);
      expect(fixture.prepares).toHaveLength(1);
    } finally {
      fixture.unmount();
    }
    expect(fixture.releases).toHaveBeenCalledOnce();
  });

  it('retires the pending gesture when no receipt is available for the moved selection', async () => {
    // The same publication without a usable receipt is an ordinary user
    // selection change: the demand must be canceled, and a later equal-looking
    // readiness cannot revive it.
    const fixture = acceptedSelectionFixture({ armed: false, revision: 4 });
    try {
      fixture.open();
      expect(fixture.preflights()).toBe(1);
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(1);
      expect(screen.queryByRole('menu')).toBeNull();

      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.preflights()).toBe(1);
      expect(fixture.captures()).toBe(1);
      expect(fixture.resolves()).toBe(0);
      expect(fixture.releases).toHaveBeenCalledOnce();
    } finally {
      fixture.unmount();
    }
  });

  it('does not consume a receipt whose before or after side does not match the demand', async () => {
    // Each wrong pair is an ordinary miss, and a miss preserves nothing: the
    // demand retires through the unchanged matcher.
    const cases: ReadonlyArray<
      readonly [string, {
        armBefore?: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
        armAfter: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
        publish: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
      }]
    > = [
      // The lease staged a different caret than the user actually had: the
      // publication is real but not this gesture's, so it must not be consumed.
      [
        'staged before does not match the demand',
        {
          armBefore: { direction: 'none', end: 3, start: 3 },
          armAfter: { direction: 'none', end: 0, start: 0 },
          publish: { direction: 'none', end: 0, start: 0 }
        }
      ],
      // The surface published a different caret than the armed publication
      // staged, so the pair is not the owner's staged transition.
      [
        'published after does not match the staged transition',
        {
          armAfter: { direction: 'none', end: 0, start: 0 },
          publish: { direction: 'none', end: 1, start: 1 }
        }
      ],
      // Direction-only: the SAME endpoints and the SAME bounds, only the
      // direction differs, so this isolates direction matching rather than
      // conflating it with a different or reversed range.
      [
        'published direction does not match the staged transition',
        {
          armAfter: { direction: 'none', end: 4, start: 0 },
          publish: { direction: 'forward', end: 4, start: 0 }
        }
      ]
    ];
    for (const [label, expectation] of cases) {
      const fixture = acceptedSelectionFixture({ revision: 4 });
      try {
        if (expectation.armBefore) fixture.armAcceptedBefore(expectation.armBefore);
        fixture.armAcceptedAfter(expectation.armAfter);
        fixture.open();
        fixture.setSelection(expectation.publish);
        act(() => {
          fixture.fire('selection');
        });
        expect(fixture.consumes, label).toHaveLength(1);
        fixture.setReady(true);
        act(() => {
          fixture.fire('readiness');
        });
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.queryByRole('menu'), label).toBeNull();
        expect(fixture.resolves(), label).toBe(0);
        expect(fixture.onFailure, label).not.toHaveBeenCalled();
      } finally {
        fixture.unmount();
      }
    }
  });

  it('consumes the receipt when the owner publishes it from inside a running refresh', async () => {
    // The demand first parks on readiness, so pendingOpenRef is installed. A
    // later readiness notification re-runs the evaluation, and the owner
    // publishes its accepted selection from inside that run's preparation,
    // where the Feature's refresh guard is already active. Consuming before the
    // guard is what preserves the gesture; a guard-first implementation drops
    // the receipt and the demand dies at the next comparison.
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const readinessListeners = new Set<() => void>();
    const selectionListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    let preflights = 0;
    let captures = 0;
    let prepares = 0;
    let consumes = 0;
    const onFailure = vi.fn();
    const surface = () => ({
      boundaryElement: surfaceElement,
      element: surfaceElement,
      captureTarget: (): EditorContextMenuTargetLease => {
        captures += 1;
        return {
          release: vi.fn(),
          resolve: () => target,
          consumeAcceptedSelectionTransition: (before, after) => {
            consumes += 1;
            return before.revision === after.revision
              && before.value === after.value
              && 9 === before.selection.start
              && 0 === after.selection.start;
          }
        };
      },
      getContextReadiness: () => state.ready
        ? { status: 'ready' as const }
        : { status: 'pending' as const },
      getSnapshot: () => ({
        revision: 4,
        selection: state.selection,
        value: state.value
      }),
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: () => {
        prepares += 1;
        // The parked demand had no preparation yet, so this first one IS the
        // evaluation the readiness notification started. The owner publishes
        // from inside it, while refresh's guard is active.
        if (1 === prepares) {
          state.selection = { direction: 'none', end: 0, start: 0 };
          for (const listener of [...selectionListeners]) listener();
        }
        return true;
      },
      prepareDemand: () => {
        preflights += 1;
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      },
      subscribeSelection: (listener: () => void) => {
        selectionListeners.add(listener);
        return () => selectionListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={surface()}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      // Parked: the pending ref exists, nothing consumed yet.
      expect(screen.queryByRole('menu')).toBeNull();
      expect(preflights).toBe(1);
      expect(captures).toBe(1);
      expect(consumes).toBe(0);
      expect(prepares).toBe(0);

      // The owner becomes ready; its preparation publishes the accepted
      // selection mid-evaluation.
      state.ready = true;
      act(() => {
        for (const listener of [...readinessListeners]) listener();
      });
      await screen.findByRole('menu');
      // Exactly one consumption, no recursive preparation, one menu.
      expect(consumes).toBe(1);
      expect(prepares).toBe(1);
      expect(preflights).toBe(1);
      expect(captures).toBe(1);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(1);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('does not resurrect the demand when a replacement gesture starts during the receipt call', async () => {
    // A listener runs during the synchronous receipt and begins a NEW gesture at
    // a different anchor. If the old pending object were written back, the menu
    // it eventually opens would sit at the ORIGINAL anchor and would reuse the
    // first lease - so both are asserted, not just "one menu appeared".
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const selectionListeners = new Set<() => void>();
    const readinessListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    const leaseReleases: Array<ReturnType<typeof vi.fn>> = [];
    const preparedPositions: number[] = [];
    let replacing = true;
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surfaceElement,
          element: surfaceElement,
          captureTarget: (): EditorContextMenuTargetLease => {
            const release = vi.fn();
            leaseReleases.push(release);
            return {
              release,
              resolve: () => target,
              consumeAcceptedSelectionTransition: (before, after) => {
                if (replacing) {
                  replacing = false;
                  // A different anchor means the replacement demand is
                  // distinguishable from the one being consumed.
                  const caret = document.createRange();
                  caret.selectNodeContents(target);
                  const native = window.getSelection();
                  native?.removeAllRanges();
                  native?.addRange(caret);
                  fireEvent.pointerDown(target, {
                    button: 2,
                    clientX: 30,
                    clientY: 30
                  });
                  fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
                }
                return 9 === before.selection.start && 0 === after.selection.start;
              }
            };
          },
          getContextReadiness: () => state.ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 4,
            selection: state.selection,
            value: state.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          prepare: (_element, _block, position) => {
            preparedPositions.push(position?.x ?? -1);
            return true;
          },
          subscribeReadiness: (listener: () => void) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          },
          subscribeSelection: (listener: () => void) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(leaseReleases).toHaveLength(1);

      state.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
      // The replacement captured its OWN lease, so the first one was retired.
      expect(leaseReleases).toHaveLength(2);
      expect(leaseReleases[0]).toHaveBeenCalled();
      expect(leaseReleases[1]).not.toHaveBeenCalled();

      state.ready = true;
      act(() => {
        for (const listener of [...readinessListeners]) listener();
      });
      const menu = await screen.findByRole('menu');
      // The surviving demand is the replacement: its own anchor, its own lease,
      // and it was prepared from the replacement anchor only.
      expect(leaseReleases[1]).not.toHaveBeenCalled();
      expect(menu).toBeTruthy();
      // The replacement anchor is the one the menu was positioned from: the
      // original x=20 position never reaches preparation.
      expect(preparedPositions).toEqual([30]);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(1);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('requires the surface to still report the exact snapshot the receipt authenticated', async () => {
    // The receipt authenticates one specific after snapshot. If the surface has
    // moved again by the time the Feature re-reads it - another listener wrote
    // inside the same synchronous publication - the authenticated pair no
    // longer describes the surface and nothing may be copied.
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const selectionListeners = new Set<() => void>();
    const readinessListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    let consumes = 0;
    let resolves = 0;
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surfaceElement,
          element: surfaceElement,
          captureTarget: (): EditorContextMenuTargetLease => ({
            release: vi.fn(),
            resolve: () => {
              resolves += 1;
              return target;
            },
            consumeAcceptedSelectionTransition: (before, after) => {
              consumes += 1;
              if (9 !== before.selection.start || 0 !== after.selection.start) {
                return false;
              }
              // Successfully authenticated - and then another listener writes
              // a different selection before the Feature re-reads the surface.
              state.selection = { direction: 'none', end: 2, start: 2 };
              return true;
            }
          }),
          getContextReadiness: () => state.ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 4,
            selection: state.selection,
            value: state.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          subscribeReadiness: (listener: () => void) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          },
          subscribeSelection: (listener: () => void) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      state.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
      // The receipt reported success, so it was called; but the surface no
      // longer reports the authenticated selection, so the demand was not
      // rewritten and must not complete on it.
      expect(consumes).toBe(1);
      state.ready = true;
      act(() => {
        for (const listener of [...readinessListeners]) listener();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(resolves).toBe(0);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('does not consume a second or late accepted transition for the same demand', async () => {
    // One-shot evidence: after the receipt was used, a repeated publication,
    // an A -> B -> A return, and a post-ready notification are all ordinary
    // changes and cannot be preserved by the same capability.
    const fixture = acceptedSelectionFixture({ revision: 4 });
    try {
      fixture.open();
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(1);
      expect(fixture.resolves()).toBe(0);

      // A second identical publication is not a receipt.
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(2);
      expect(screen.queryByRole('menu')).toBeNull();

      // A real user change after that is still a user change.
      fixture.setSelection({ direction: 'none', end: 5, start: 2 });
      act(() => {
        fixture.fire('selection');
      });
      expect(screen.queryByRole('menu')).toBeNull();
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.resolves()).toBe(0);
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('does not consume a receipt when the demand has no known revision to compare', async () => {
    // `revision` is optional on the surface snapshot, but a receipt needs the
    // known canonical revision it published against. An absent revision must
    // not be treated as undefined === undefined.
    const fixture = acceptedSelectionFixture({ revision: undefined });
    try {
      fixture.open();
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(0);
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.resolves()).toBe(0);
    } finally {
      fixture.unmount();
    }
  });

  it('never consumes a receipt for a visible menu or an in-flight action', async () => {
    // The receipt is evidence for one *pending* demand. A visible menu is
    // already authenticated, and a demand that arrives while an earlier action
    // still owns its resources must not be preserved by it either.
    const fixture = acceptedSelectionFixture({ revision: 4 });
    const actionSurface = document.createElement('div');
    actionSurface.contentEditable = 'true';
    layoutSurface(actionSurface);
    const actionTarget = document.createElement('p');
    actionTarget.textContent = 'selected';
    actionSurface.append(actionTarget);
    document.body.append(actionSurface);
    const actionSelectionListeners = new Set<() => void>();
    const actionConsumes: unknown[] = [];
    const actionState = {
      ready: true,
      selection: { direction: 'none' as const, end: 8, start: 0 },
      value: 'selected'
    };
    const actionView = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        // Never settles: the action keeps owning its resources.
        onAction={() => new Promise<void>(() => undefined)}
        onFailure={vi.fn()}
        source={null}
        visual={{
          boundaryElement: actionSurface,
          element: actionSurface,
          captureTarget: (): EditorContextMenuTargetLease => ({
            release: vi.fn(),
            resolve: () => actionTarget,
            consumeAcceptedSelectionTransition: (before, after) => {
              actionConsumes.push({ before, after });
              return true;
            }
          }),
          getContextReadiness: () => actionState.ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 4,
            selection: actionState.selection,
            value: actionState.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          subscribeSelection: (listener: () => void) => {
            actionSelectionListeners.add(listener);
            return () => actionSelectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fixture.open();
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await screen.findByRole('menu');
      // The menu is now VISIBLE: the demand is no longer pending.
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(0);
      fixture.unmount();

      // Start a real action, then open a NEW gesture that parks on readiness
      // while that action is still in flight. A publication at that point must
      // not be consumed for the new demand.
      fireEvent.pointerDown(actionTarget, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(actionTarget, { clientX: 20, clientY: 30 });
      const actionMenu = await screen.findByRole('menu');
      fireEvent.click(
        within(actionMenu).getByRole('menuitem', { name: labels.paste })
      );
      expect(actionConsumes).toHaveLength(0);

      actionState.ready = false;
      fireEvent.pointerDown(actionTarget, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(actionTarget, { clientX: 20, clientY: 30 });
      expect(screen.queryByRole('menu')).toBeNull();

      // The publication arrives while the earlier action still owns its
      // resources: the new pending demand is not preserved.
      actionState.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...actionSelectionListeners]) listener();
      });
      expect(actionConsumes).toHaveLength(0);

      // Even once readiness allows a read, the demand was retired: it must not
      // open a menu for a selection it never captured.
      actionState.ready = true;
      act(() => {
        for (const listener of [...actionSelectionListeners]) listener();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      actionView.unmount();
    }
  });

  it('does not restore a canceled demand when the receipt arrives during the publication', async () => {
    // The owner's synchronous publication runs a listener that cancels the
    // demand. The receipt reports success, but the demand it belonged to is
    // already gone, so it must not be written back.
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const selectionListeners = new Set<() => void>();
    const state = {
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    let consumedDuringCall = false;
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surfaceElement,
          element: surfaceElement,
          captureTarget: (): EditorContextMenuTargetLease => ({
            release: vi.fn(),
            resolve: () => target,
            consumeAcceptedSelectionTransition: (before, after) => {
              fireEvent.keyDown(document, { key: 'Escape' });
              consumedDuringCall = true;
              return 9 === before.selection.start && 0 === after.selection.start;
            }
          }),
          getContextReadiness: () => ({ status: 'pending' as const }),
          getSnapshot: () => ({
            revision: 4,
            selection: state.selection,
            value: state.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          subscribeSelection: (listener: () => void) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      state.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
      expect(consumedDuringCall).toBe(true);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('rebuilds a parked demand when readiness is notified after the transfer settles', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let ready = false;
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
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha beta'
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
    // The demand parks because the surface is not ready yet.
    expect(screen.queryByRole('menu')).toBeNull();

    // A settle notification alone must not open the menu while still pending.
    for (const listener of readinessListeners) listener();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onFailure).not.toHaveBeenCalled();

    // The transfer settles, the owner becomes ready and notifies: the parked
    // demand is rebuilt against the newly accepted state.
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('retires a parked demand whose lease cannot authenticate the block, without borrowing the old element', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const target = document.createElement('p');
    target.textContent = 'target';
    source.append(target);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    const onFailure = vi.fn();
    const releasePending = vi.fn();
    const targetRelease = vi.fn();
    const prepared = vi.fn(() => true);
    const contextTargets: Array<Element | null> = [];
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
          // The owner accepted the gesture, but its accepted source no longer
          // contains that block: resolution is a real null, not an old-element
          // fallback.
          captureTarget: () => ({ release: targetRelease, resolve: () => null }),
          getActionContext: (contextTarget) => {
            contextTargets.push(contextTarget);
            return null;
          },
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha beta'
          }),
          isEditable: () => true,
          kind: 'source',
          prepare: prepared,
          releasePending,
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    expect(screen.queryByRole('menu')).toBeNull();
    // The accepted commit retires the element the demand was anchored to.
    target.remove();
    ready = true;
    for (const listener of readinessListeners) listener();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    // Nothing was prepared or contextualized against the retired element, and
    // a rejection the user cannot act on is not a failure worth reporting.
    expect(prepared).not.toHaveBeenCalled();
    expect(contextTargets).toHaveLength(0);
    expect(onFailure).not.toHaveBeenCalled();
    expect(releasePending).toHaveBeenCalledWith('cancelled');
    expect(targetRelease).toHaveBeenCalledOnce();
    // A late notification cannot revive the retired witness.
    for (const listener of readinessListeners) listener();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(prepared).not.toHaveBeenCalled();
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

  it('rebuilds a visible ready menu only from the element the lease authenticates', async () => {
    // An accepted render can replace the block DOM while an already-open menu
    // is on screen, and neither the canonical value, the selection, the
    // revision, the surface generation, nor the provider identity changes. The
    // rebuild must therefore re-ask the owner through this demand's own lease:
    // the element the user opened the menu on is retired, and reading it again
    // would describe a block the owner no longer stands behind.
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const oldTarget = document.createElement('p');
    oldTarget.textContent = 'alpha';
    surface.append(oldTarget);
    document.body.append(surface);
    const identity = {};
    const readinessListeners = new Set<() => void>();
    let live: Element | null = oldTarget;
    let preflights = 0;
    let captures = 0;
    const released = vi.fn();
    const preparedTargets: Array<Element | null | undefined> = [];
    const contextTargets: Array<Element | null> = [];
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => {
        captures += 1;
        return { release: released, resolve: () => live };
      },
      getActionContext: (target: Element | null) => {
        contextTargets.push(target);
        return null;
      },
      getBlockIndex: () => null,
      getContextReadiness: () => ({ status: 'ready' as const }),
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: (target?: Element | null) => {
        preparedTargets.push(target);
        return true;
      },
      prepareDemand: () => {
        preflights += 1;
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(oldTarget, { clientX: 20, clientY: 30 });
    const firstMenu = await screen.findByRole('menu');
    const anchorLeft = firstMenu
      .closest<HTMLElement>('[data-easymde-context-menu="true"]')
      ?.style.left;
    expect(preflights).toBe(1);
    expect(captures).toBe(1);
    expect(preparedTargets).toEqual([oldTarget]);
    expect(contextTargets).toEqual([oldTarget]);
    const preparesBefore = preparedTargets.length;
    const contextsBefore = contextTargets.length;

    // The accepted render replaces the pointed block. Every canonical field
    // the demand captured is unchanged, so nothing but the lease can tell the
    // retired element from the live one.
    oldTarget.remove();
    const accepted = document.createElement('p');
    accepted.textContent = 'alpha';
    surface.append(accepted);
    live = accepted;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });

    await waitFor(() =>
      expect(contextTargets.at(-1)).toBe(accepted)
    );
    // The rebuild describes ONLY the authenticated element: the retired node
    // is never handed to the context builder again.
    expect(contextTargets.slice(contextsBefore)).toEqual([accepted]);
    expect(preparedTargets.slice(preparesBefore)).toEqual([accepted]);
    // One gesture: no second preflight, no second capture, no early release.
    expect(preflights).toBe(1);
    expect(captures).toBe(1);
    expect(released).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(
      screen
        .getByRole('menu')
        .closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchorLeft);

    // Dismissal retires the same witness exactly once.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(released).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('keeps a visible ready menu off the retired context while readiness is pending again', async () => {
    // The same ready menu can be told that the owner is re-materializing its
    // inventory. While that answer is pending the demand must not resolve the
    // lease, prepare a selection, or rebuild a link/image/generated context
    // from the previous inventory; it keeps the menu the user already has.
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const target = document.createElement('p');
    target.textContent = 'alpha';
    surface.append(target);
    document.body.append(surface);
    const identity = {};
    const readinessListeners = new Set<() => void>();
    let ready = true;
    let live: Element | null = target;
    const preparedTargets: Array<Element | null | undefined> = [];
    const contextTargets: Array<Element | null> = [];
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => ({
        release: vi.fn(),
        resolve: () => live
      }),
      getActionContext: (element: Element | null) => {
        contextTargets.push(element);
        return { link: { href: 'https://example.test/docs' } };
      },
      getBlockIndex: () => null,
      getContextReadiness: () =>
        ready ? { status: 'ready' as const } : { status: 'pending' as const },
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: (element?: Element | null) => {
        preparedTargets.push(element);
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    const firstMenu = await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: labels.copyLinkAddress })).toBeTruthy();
    const anchorLeft = firstMenu
      .closest<HTMLElement>('[data-easymde-context-menu="true"]')
      ?.style.left;
    const preparesBefore = preparedTargets.length;
    const contextsBefore = contextTargets.length;

    ready = false;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: labels.copyLinkAddress })).toBeNull();
    expect(preparedTargets).toHaveLength(preparesBefore);
    expect(contextTargets).toHaveLength(contextsBefore);
    expect(
      screen
        .getByRole('menu')
        .closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchorLeft);

    // The accepted inventory then arrives with a live element: the retained
    // menu rebuilds from it, still the same demand and anchor.
    const accepted = document.createElement('p');
    accepted.textContent = 'alpha';
    target.remove();
    surface.append(accepted);
    live = accepted;
    ready = true;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: labels.copyLinkAddress })).toBeTruthy()
    );
    expect(contextTargets.at(-1)).toBe(accepted);
    expect(preparedTargets.at(-1)).toBe(accepted);
    expect(
      screen
        .getByRole('menu')
        .closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchorLeft);
    view.unmount();
  });

  it('retires a visible ready menu when the lease can no longer authenticate the block', async () => {
    // A null resolution is the owner saying the demanded block is gone. The
    // demand ends silently: no menu for a different block, no action against
    // the retired element, and no failure the user could act on.
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const target = document.createElement('p');
    target.textContent = 'alpha';
    surface.append(target);
    document.body.append(surface);
    const identity = {};
    const readinessListeners = new Set<() => void>();
    let live: Element | null = target;
    const released = vi.fn();
    const contextTargets: Array<Element | null> = [];
    const onAction = vi.fn();
    const onFailure = vi.fn();
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => ({
        release: released,
        resolve: () => live
      }),
      getActionContext: (element: Element | null) => {
        contextTargets.push(element);
        return null;
      },
      getBlockIndex: () => null,
      getContextReadiness: () => ({ status: 'ready' as const }),
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'visual' as const,
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(contextTargets).toEqual([target]);

    live = null;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(released).toHaveBeenCalledOnce();
    // The retired element is never handed to the context builder again.
    expect(contextTargets).toEqual([target]);
    expect(onAction).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    // A later notification cannot resolve the released demand or reopen it.
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(released).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('retires a visible demand and its target capability when the owner removes the surface', async () => {
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const target = document.createElement('p');
    target.textContent = 'alpha';
    surface.append(target);
    document.body.append(surface);
    const released = vi.fn();
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => ({
        release: released,
        resolve: () => target
      }),
      getBlockIndex: () => null,
      getContextReadiness: () => ({ status: 'ready' as const }),
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      isEditable: () => true,
      kind: 'visual' as const
    });
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');

    // The owner leaves the editing mode: the surface this demand was opened on
    // is gone, so the visible demand and its witness retire once.
    view.rerender(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={null}
      />
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(released).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();

    // Unmounting afterwards must not release the same capability again.
    view.unmount();
    expect(released).toHaveBeenCalledOnce();
  });

  it('keeps a visible menu while a refreshed inventory is still pending', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const port = clipboard();
    const readinessListeners = new Set<() => void>();
    let ready = true;
    const link = { href: 'https://example.test/' };
    const buildSource = () => ({
      boundaryElement: source,
      element: source,
      getActionContext: () => ({ link }),
      getBlockIndex: () => null,
      getContextReadiness: () =>
        ready ? { status: 'ready' as const } : { status: 'pending' as const },
      getSnapshot: () => ({
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      isEditable: () => true,
      kind: 'source' as const,
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
        source={buildSource()}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    const firstMenu = await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Copy link address' })).toBeTruthy();
    const anchor = firstMenu
      .closest<HTMLElement>('[data-easymde-context-menu="true"]')
      ?.style.left;

    // A benign owner replacement rebuilds the same demand while the refreshed
    // inventory is not ready yet: the visible menu must survive that
    // transition instead of dismissing itself.
    ready = false;
    view.rerender(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={buildSource()}
        visual={null}
      />
    );
    const retainedMenu = screen.getByRole('menu');
    expect(retainedMenu).toBeTruthy();
    expect(
      retainedMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchor);
    // The retired inventory's own context is not presented while the new one
    // is still building.
    expect(screen.queryByRole('menuitem', { name: 'Copy link address' })).toBeNull();

    // The refreshed inventory completes: the menu replaces its context and
    // stays anchored where the user opened it.
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menuitem', { name: 'Copy link address' })).toBeTruthy();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('dismisses a retained menu once the document no longer matches the demand', async () => {
    const retained = retainedPendingMenu();
    await retained.retain();

    // A real document change is not a benign refresh: the retained menu no
    // longer describes what the user pointed at and must dismiss.
    retained.state.value = 'beta';
    retained.fire('snapshot');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('dismisses a retained menu on a selection-only change', async () => {
    const retained = retainedPendingMenu();
    await retained.retain();

    // A selection-only change publishes through the selection subscription,
    // never through the text snapshot: the retained menu must still be
    // validated against it instead of keeping a selection the user no longer
    // has.
    retained.state.selection = { direction: 'none', end: 5, start: 2 };
    retained.fire('selection');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('does not resurrect a retained menu when a selection change returns to the captured one', async () => {
    const retained = retainedPendingMenu();
    await retained.retain();

    retained.state.selection = { direction: 'none', end: 5, start: 2 };
    retained.fire('selection');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // Back at the captured selection before the refreshed inventory resolves:
    // the retired demand must not match again and reopen.
    act(() => {
      retained.state.selection = { direction: 'none', end: 0, start: 0 };
      retained.state.ready = true;
      retained.fire('selection');
      retained.fire('readiness');
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not resurrect a retained menu when the selection returns in the same batch', async () => {
    const retained = retainedPendingMenu();
    retained.state.link = { href: 'https://example.test/' };
    await retained.retain();

    // Away and back inside one batch, with no render between the two
    // notifications: retiring the demand has to take effect synchronously, or
    // the second notification re-reads the retired state, re-matches its
    // captured snapshot and brings the menu back.
    act(() => {
      retained.state.selection = { direction: 'none', end: 5, start: 2 };
      retained.fire('selection');
      retained.state.selection = { direction: 'none', end: 0, start: 0 };
      retained.fire('selection');
    });
    expect(screen.queryByRole('menu')).toBeNull();

    // The refreshed inventory resolving later must not present the retired
    // context either.
    act(() => {
      retained.state.ready = true;
      retained.fire('readiness');
      retained.fire('selection');
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: 'Copy link address' })
    ).toBeNull();
  });

  it('closes a menu when the same visual element receives a new runtime generation', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    layoutSurface(visual);
    document.body.append(visual);
    layoutSurface(visual);
    const restoreFocus = vi.fn();
    const firstIdentity = {};
    const secondIdentity = {};
    const props = {
      clipboard: clipboard(),
      direction: 'ltr' as const,
      labels,
      onAction: vi.fn(),
      onFailure: vi.fn(),
      source: null,
      visual: {
          boundaryElement: visual,
        element: visual,
        generation: 1,
        getSnapshot: () => ({
          selection: { direction: 'none' as const, end: 0, start: 0 },
          value: 'alpha'
        }),
        identity: firstIdentity,
        isEditable: () => true,
        kind: 'visual' as const,
        restoreFocus
      }
    };
    const view = render(<EditorContextMenuFeature {...props} />);
    fireEvent.contextMenu(visual, { clientX: 4, clientY: 5 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    view.rerender(
      <EditorContextMenuFeature
        {...props}
        visual={{ ...props.visual, generation: 2, identity: secondIdentity }}
      />
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(restoreFocus).toHaveBeenCalledOnce();
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
    // The real visual owner hands every gesture to one image-interaction
    // owner; this harness mirrors that wiring with an inert hook set.
    const imageInteraction = createVisualImageInteraction(surface, {
      canActivate: () => true,
      focus: () => undefined,
      report: () => undefined,
      synchronizeSelection: () => true
    });
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
            // The interaction owner decides whether the gesture may rebind the
            // selection, exactly as the real visual runtime does.
            imageInteraction.select(target, activation ?? 'keyboard');
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
    imageInteraction.dispose();
  });
});
