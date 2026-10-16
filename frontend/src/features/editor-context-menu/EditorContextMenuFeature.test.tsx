import { createElement } from '@wordpress/element';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import { parseMarkdownImageScale } from '../image-scale/image-scale-contract';
import {
  EditorContextMenuFeature,
  type EditorContextMenuActionContext,
  type EditorContextMenuContextReadiness
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
    expect(prepare).toHaveBeenCalledWith(math, undefined, { x: 20, y: 30 });
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

  it('re-anchors a replayed demand target through the owner before preparing it', async () => {
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const replayed = document.createElement('p');
    replayed.textContent = 'replayed';
    const live = document.createElement('p');
    live.textContent = 'live';
    surface.append(replayed, live);
    document.body.append(surface);
    const preparedTargets: Array<Element | null | undefined> = [];
    const contextTargets: Array<Element | null> = [];
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
          getActionContext: (target) => {
            contextTargets.push(target);
            return null;
          },
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
          resolveTarget: (target) => (target === replayed ? live : null)
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(replayed, { clientX: 20, clientY: 30 });
    // The owner retired the replayed element, so both the preparation and the
    // action context describe the live element instead.
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(preparedTargets).toHaveLength(1);
    expect(preparedTargets[0]).toBe(live);
    expect(contextTargets).toHaveLength(1);
    expect(contextTargets[0]).toBe(live);

    // A target the owner cannot re-anchor keeps its original element.
    fireEvent.contextMenu(live, { clientX: 24, clientY: 34 });
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
});
