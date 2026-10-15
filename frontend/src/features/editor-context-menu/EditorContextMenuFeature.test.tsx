import { createElement } from '@wordpress/element';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import {
  EditorContextMenuFeature,
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
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  insertParagraphAboveGenerated: 'Insert paragraph above',
  insertParagraphAboveTable: 'Insert paragraph above table',
  insertParagraphBelowGenerated: 'Insert paragraph below',
  insertParagraphBelowTable: 'Insert paragraph below table',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  mathBlock: 'Formula',
  openLink: 'Open link',
  paste: 'Paste',
  pastePlainText: 'Paste as plain text',
  saveGeneratedImage: 'Save as image',
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

describe('EditorContextMenuFeature', () => {
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
      screen.getByRole('menuitem', { name: 'Table' })
        .getAttribute('aria-disabled')
    ).toBe('false');
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
        canSaveImage: true,
        canUseSource: true,
        filename: 'formula.png',
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
      link: { canOpen: true, href: 'https://example.test/docs' }
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
    expect(screen.getByRole('menuitem', { name: 'Open link' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open link' }));

    expect(onAction).toHaveBeenCalledWith(
      'open-link',
      expect.objectContaining({ value: 'alpha' }),
      actionContext
    );
    expect(release).not.toHaveBeenCalled();
    pending.resolve();
    await waitFor(() => expect(release).toHaveBeenCalledOnce());
    view.unmount();
  });

  it('renders one code-block submenu when a generated block owns the source selection', async () => {
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
              canSaveImage: true,
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
    expect(await screen.findByRole('menuitem', { name: 'Code block' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem', { name: 'Code block' })).toHaveLength(1);
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
        canSaveImage: true,
        canUseSource: true,
        filename: 'formula.png',
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
      link: { canOpen: true, href: 'https://example.test/docs' }
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
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open link' }));
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
        canSaveImage: true,
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
        canSaveImage: true,
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
        canSaveImage: true,
        canUseSource: true,
        filename: 'formula.png',
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
        canSaveImage: false,
        canUseSource: true,
        filename: 'formula.png',
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
    expect(prepare).toHaveBeenCalledWith(math, undefined);
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
        canSaveImage: true,
        canUseSource: true,
        filename: 'formula.png',
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
