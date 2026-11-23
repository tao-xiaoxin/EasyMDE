import { createElement } from '@wordpress/element';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { undoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type {
  EditorImagePixelsPort,
  EditorImagePixelsResult
} from '../../contracts/ports/editor-image-pixels-port';
import type {
  EditorMarkdownBlockIndexData,
  EditorMarkdownBlockIndexPort
} from '../../contracts/ports/editor-block-index-port';
import type { GeneratedContentExportSession } from '../../features/generated-content-export/generated-content-export-session';
import * as generatedImageTarget from '../../features/generated-content-export/generated-image-target';
import * as imageScaleContract from '../../features/image-scale/image-scale-contract';
import * as observedSourceAdapter from '../../features/document-source/adapters/code-mirror-document-session';
import {
  findEditorCodeContentTarget as observedCodeContentTarget
} from '../../features/editor-context-menu/editor-code-content-target';
import { EditorRoot } from './EditorRoot';
import {
  cleanupEditorRootTestHarness,
  contextMenuStrings,
  createCodeContentPreviewResponse,
  createCodeIndentationPreviewResponse,
  createPreviewResponse,
  createSourceLinkPreviewResponse,
  deferred,
  fixture,
  imageBlockIndexPort,
  layoutContextMenuSurface,
  observedBlockIndex,
  sourceLinkBlockIndexPort,
  sourceLinkParser
} from './editor-root-test-harness';

afterEach(cleanupEditorRootTestHarness);

describe('EditorRoot context menu', () => {
  it.each(['Ctrl+Shift+I', 'Ctrl+Alt+I', ''])(
    'projects the current image shortcut into the insertion menu (%s)',
    async (binding) => {
      const props = fixture();
      const view = render(
        <EditorRoot
          {...props}
          toolbar={{
            ...props.toolbar,
            commands: props.toolbar.commands.map((command) =>
              'image' === command.id
                ? {
                    ...command,
                    defaultShortcutMac: 'Cmd+I',
                    defaultShortcutWin: 'Ctrl+I'
                  }
                : command
            ),
            shortcuts: {
              ...props.toolbar.shortcuts,
              image: { mac: 'Cmd+Shift+I', win: binding }
            }
          }}
        />
      );
      const source = await waitFor(() => {
        const element =
          view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });
      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      fireEvent.click(
        await within(document.body).findByRole('menuitem', { name: 'Insert' })
      );
      const image = await within(document.body).findByRole('menuitem', {
        name: /^Insert image above/
      });
      const hint = image.querySelector(
        '.easymde-editor-context-menu__shortcut'
      );
      expect(hint?.textContent ?? '').toBe(binding);
      expect(props.submissionField.value).toBe('selected');
      view.unmount();
    }
  );

  it.each(['readOnly', 'disabled'] as const)(
    'fails a Source Paste whose field became %s during the Clipboard read',
    async (flag) => {
      // The action gate ran while the field was editable. The awaited Clipboard
      // read is the window: the authoritative native field changes after the
      // enabled action started. The mutation itself must re-check, fail exactly
      // once, and write neither the canonical document nor history.
      const props = fixture();
      props.submissionField.value = 'Before after';
      props.submissionField.defaultValue = 'Before after';
      props.submissionField.setSelectionRange(7, 7);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const read = props.editorClipboardPort?.read;
      if (!read) throw new Error('clipboard-read-port-missing');
      vi.mocked(read).mockImplementation(async () => {
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        return { status: 'available', text: 'PASTED' };
      });
      const view = render(<EditorRoot {...props} />);
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        const beforeSource = owner.getValue();
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        fireEvent.click(
          await within(document.body).findByRole('menuitem', { name: /^Paste$/ })
        );
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'editor-context-menu-surface-read-only'
          )
        );
        expect(view.getByRole('alert').textContent).toBe(
          contextMenuStrings.statusActionFailed
        );
        // Only the selected authoritative flag changed and is still set.
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);
        expect(owner.getValue()).toBe(beforeSource);
        expect(props.submissionField.value).toBe('Before after');
        expect(props.submissionField.value).not.toContain('PASTED');
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        // One stable owning error, not a duplicate or a generic code.
        expect(
          vi.mocked(props.onFailure).mock.calls.filter((call) =>
            call[0].startsWith('editor-context-menu-')
          )
        ).toEqual([['editor-context-menu-surface-read-only']]);

        // Restoring the exact original flag defers no insertion.
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe('Before after');
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

  it.each(['readOnly', 'disabled'] as const)(
    'fails a Source Cut whose field became %s during the Clipboard write',
    async (flag) => {
      // The Clipboard write may truthfully complete: the external write is not
      // the canonical Cut. The source deletion is the rejected half and must
      // leave the document, revision, history, and native selection untouched.
      const props = fixture();
      const initial = 'Before selected after';
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      props.submissionField.setSelectionRange(7, 15);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const write = props.editorClipboardPort?.write;
      if (!write) throw new Error('clipboard-write-port-missing');
      vi.mocked(write).mockImplementation(async () => {
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        return { status: 'written' };
      });
      const view = render(<EditorRoot {...props} />);
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        fireEvent.click(
          await within(document.body).findByRole('menuitem', { name: /^Cut$/ })
        );
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'editor-context-menu-surface-read-only'
          )
        );
        // The visible failure is the same one the action gate reports.
        expect(view.getByRole('alert').textContent).toBe(
          contextMenuStrings.statusActionFailed
        );
        // The Clipboard write itself really happened; the deletion did not.
        expect(write).toHaveBeenCalledWith(
          'selected',
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        // Only the selected authoritative flag changed and is still set.
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);
        expect(owner.getValue()).toBe(initial);
        expect(props.submissionField.value).toBe(initial);
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        expect([
          props.submissionField.selectionStart,
          props.submissionField.selectionEnd
        ]).toEqual([7, 15]);
        expect(
          vi.mocked(props.onFailure).mock.calls.filter((call) =>
            call[0].startsWith('editor-context-menu-')
          )
        ).toEqual([['editor-context-menu-surface-read-only']]);

        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe(initial);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

  it('mounts the shared context menu through the canonical Source session', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const sourceMenu = await within(document.body).findByRole('menu');
    expect(sourceMenu).toBeTruthy();
    expect(
      sourceMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.clipPath
    ).toBe('');
    expect(
      within(document.body).getByRole('menuitem', { name: /^Bold/ })
    ).toBeTruthy();
    const shortcutOwner = vi
      .mocked(props.prepareToolbarShortcuts)
      .mock.calls.slice(-1)[0]?.[0]?.isOwnedTarget;
    if (!shortcutOwner) throw new Error('context-menu-shortcut-owner-missing');
    expect(
      shortcutOwner(
        within(document.body).getByRole('menuitem', { name: 'Copy' })
      )
    ).toBe(true);
    expect(shortcutOwner(document.createElement('button'))).toBe(false);
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Copy' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith('selected')
    );
    expect(props.submissionField.value).toBe('selected');
    view.unmount();
  });

  it('opens the heading-level submenu for a Source heading and marks its current level', async () => {
    const props = fixture();
    const sourceValue = '## Heading two\n\nBody';
    const headingPosition = sourceValue.indexOf('Heading');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(headingPosition, headingPosition);
    const headingLevels = [1, 2, 3, 4, 5, 6] as const;
    const view = render(
      <EditorRoot
        {...props}
        toolbar={{
          ...props.toolbar,
          commands: [
            ...props.toolbar.commands,
            ...headingLevels.map((level) => ({
              action: 'heading' as const,
              group: 'heading',
              icon: 'heading',
              id: `heading${level}`,
              label: `Heading ${level}`,
              level,
              surface: 'heading-menu' as const
            }))
          ]
        }}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const headingLevel = await within(document.body).findByRole('menuitem', {
      name: 'Heading level'
    });
    fireEvent.mouseEnter(headingLevel);
    const currentLevel = await within(document.body).findByRole('menuitem', {
      name: 'Heading 2'
    });
    expect(
      currentLevel.getAttribute('data-easymde-context-menu-checked')
    ).toBe('true');
    expect(
      within(document.body)
        .getByRole('menuitem', { name: 'Heading 3' })
        .getAttribute('data-easymde-context-menu-checked')
    ).toBeNull();

    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Heading 3' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe('### Heading two\n\nBody')
    );
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(
      '### Heading two\n\nBody'
    );
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(props.submissionField.value).toBe(sourceValue));
    view.unmount();
  });

  it('opens the pointed Source context from a bare right-click instead of the previous caret', async () => {
    const props = fixture();
    const sourceValue = '## Heading two\n\nBody';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    // The collapsed caret is deliberately left in a different block: only the
    // pointer gesture may decide the captured context.
    props.submissionField.setSelectionRange(sourceValue.length, sourceValue.length);
    const headingLevels = [1, 2, 3, 4, 5, 6] as const;
    const view = render(
      <EditorRoot
        {...props}
        toolbar={{
          ...props.toolbar,
          commands: [
            ...props.toolbar.commands,
            ...headingLevels.map((level) => ({
              action: 'heading' as const,
              group: 'heading',
              icon: 'heading',
              id: `heading${level}`,
              label: `Heading ${level}`,
              level,
              surface: 'heading-menu' as const
            }))
          ]
        }}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editorView = EditorView.findFromDOM(source);
    if (!editorView) throw new Error('source-editor-view-missing');
    layoutContextMenuSurface(source);
    const pointer = { x: 1, y: 0 };
    const mapped = editorView.posAtCoords(pointer, false);
    if (null === mapped) throw new Error('source-pointer-unmappable');
    const headingLine = editorView.state.doc.line(1);
    expect(mapped).toBeGreaterThanOrEqual(headingLine.from);
    expect(mapped).toBeLessThanOrEqual(headingLine.to);
    expect(mapped).toBeLessThan(sourceValue.length);

    // A real right-click: the pointer gesture precedes the native context-menu
    // request, exactly as the browser dispatches it.
    fireEvent.mouseDown(source, { button: 2, clientX: pointer.x, clientY: pointer.y });
    fireEvent.contextMenu(source, { clientX: pointer.x, clientY: pointer.y });

    const headingLevel = await within(document.body).findByRole('menuitem', {
      name: 'Heading level'
    });
    fireEvent.mouseEnter(headingLevel);
    expect(
      (
        await within(document.body).findByRole('menuitem', { name: 'Heading 2' })
      ).getAttribute('data-easymde-context-menu-checked')
    ).toBe('true');
    // The canonical selection was established from the pointer before the
    // demand snapshot was captured.
    expect(editorView.state.selection.main.head).toBe(mapped);
    view.unmount();
  });

  it('opens a certified formula context from the canonical Source session', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    const blocks = [
      {
        editable: true as const,
        from: 0,
        kind: 'paragraph' as const,
        lineEnd: 0,
        lineStart: 0,
        to: 6
      },
      {
        editable: true as const,
        from: 7,
        kind: 'paragraph' as const,
        lineEnd: 1,
        lineStart: 1,
        to: 10
      },
      {
        editable: true as const,
        from: 11,
        kind: 'paragraph' as const,
        lineEnd: 2,
        lineStart: 2,
        to: sourceMarkdown.length
      }
    ];
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>' as SafePreviewHtml,
          { math: true }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks,
        imageBlocks: blocks.map(() => ({
          count: 0,
          firstImageIndex: 0,
          status: 'ready' as const
        })),
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('.easymde-math')).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );
    const formula = await within(document.body).findByRole('menuitem', {
      name: 'Formula'
    });
    fireEvent.mouseEnter(formula);
    await waitFor(() =>
      expect(formula.getAttribute('aria-expanded')).toBe('true')
    );
    const copySubmenu = within(document.body)
      .getAllByRole('menuitem', { name: 'Copy' })
      .find((item) => item.getAttribute('aria-haspopup') === 'menu');
    if (!copySubmenu) throw new Error('generated-copy-submenu-missing');
    fireEvent.mouseEnter(copySubmenu);
    await waitFor(() =>
      expect(copySubmenu.getAttribute('aria-expanded')).toBe('true')
    );
    expect(
      await within(document.body).findByRole('menuitem', {
        name: 'Copy MathML'
      })
    ).toBeTruthy();
    expect(within(document.body).queryByRole('menuitem', {
      name: 'Code block'
    })).toBeNull();
    fireEvent.mouseEnter(copySubmenu);
    const copyMathSource = await within(document.body).findByRole('menuitem', {
      name: 'Copy TeX'
    });
    fireEvent.click(copyMathSource);
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith('x')
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('fails and releases a generated Source target after the injected readiness deadline', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    const blocks = [
      {
        editable: true as const,
        from: 0,
        kind: 'paragraph' as const,
        lineEnd: 0,
        lineStart: 0,
        to: 6
      },
      {
        editable: true as const,
        from: 7,
        kind: 'paragraph' as const,
        lineEnd: 1,
        lineStart: 1,
        to: 10
      },
      {
        editable: true as const,
        from: 11,
        kind: 'paragraph' as const,
        lineEnd: 2,
        lineStart: 2,
        to: sourceMarkdown.length
      }
    ];
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p>Plain</p><p>After</p>' as SafePreviewHtml,
          {
            math: true
          }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks,
        imageBlocks: blocks.map(() => ({
          count: 0,
          firstImageIndex: 0,
          status: 'ready' as const
        })),
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    let now = 0;
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
      fired: boolean;
    }> = [];
    const immersiveEnvironment = {
      ...props.immersiveEnvironment,
      now: () => now,
      schedule: (callback: () => void, delay: number) => {
        const task = { callback, cancelled: false, delay, fired: false };
        scheduled.push(task);
        return () => {
          task.cancelled = true;
        };
      }
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={generatedContentExportSession}
        immersiveEnvironment={immersiveEnvironment}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );
    await waitFor(() =>
      expect(scheduled.some(({ delay }) => 10_000 === delay)).toBe(true)
    );
    const deadline = scheduled.find(
      ({ delay, cancelled }) => 10_000 === delay && !cancelled
    );
    if (!deadline) throw new Error('generated-readiness-deadline-missing');
    now = 10_000;
    act(() => {
      deadline.fired = true;
      deadline.callback();
    });
    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'editor-context-menu-generated-content-unavailable'
      )
    );
    const clipboardCheck = props.editorClipboardPort?.check;
    if (!clipboardCheck) throw new Error('clipboard-check-missing');
    expect(vi.mocked(clipboardCheck).mock.calls[0]?.[0]?.signal?.aborted).toBe(
      true
    );
    expect(view.queryByRole('menu')).toBeNull();
    expect(
      scheduled.filter(
        ({ delay, cancelled, fired }) =>
          10_000 === delay && !cancelled && !fired
      )
    ).toHaveLength(0);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledTimes(2));
    expect(scheduled.filter(({ delay }) => 10_000 === delay)).toHaveLength(1);
    view.unmount();
  });

  it('cancels a pending generated target deadline when the Root tears down', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p>Plain</p><p>After</p>' as SafePreviewHtml,
          {
            math: true
          }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks: [
          {
            editable: true as const,
            from: 0,
            kind: 'paragraph' as const,
            lineEnd: 2,
            lineStart: 0,
            to: sourceMarkdown.length
          }
        ],
        imageBlocks: [
          { count: 0, firstImageIndex: 0, status: 'ready' as const }
        ],
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const scheduled: Array<{ cancelled: boolean; delay: number }> = [];
    const immersiveEnvironment = {
      ...props.immersiveEnvironment,
      now: () => 0,
      schedule: (_callback: () => void, delay: number) => {
        const task = { cancelled: false, delay };
        scheduled.push(task);
        return () => {
          task.cancelled = true;
        };
      }
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={
          {
            copyAsImage: vi.fn(),
            copyMathMl: vi.fn(),
            dispose: vi.fn(),
          } as unknown as GeneratedContentExportSession
        }
        immersiveEnvironment={immersiveEnvironment}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(scheduled.some(({ delay }) => 10_000 === delay)).toBe(true)
    );
    view.unmount();
    expect(
      scheduled
        .filter(({ delay }) => 10_000 === delay)
        .every(({ cancelled }) => cancelled)
    ).toBe(true);
  });

  it('keeps a pending Source Copy-as-image lease alive when a reopened menu is dismissed', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    const blocks = [
      {
        editable: true as const,
        from: 0,
        kind: 'paragraph' as const,
        lineEnd: 0,
        lineStart: 0,
        to: 6
      },
      {
        editable: true as const,
        from: 7,
        kind: 'paragraph' as const,
        lineEnd: 1,
        lineStart: 1,
        to: 10
      },
      {
        editable: true as const,
        from: 11,
        kind: 'paragraph' as const,
        lineEnd: 2,
        lineStart: 2,
        to: sourceMarkdown.length
      }
    ];
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    const editorClipboardPort = {
      ...props.editorClipboardPort,
      supportsPngWrite: vi.fn(() => true),
      writeImageDeferred: vi.fn(async () => ({ status: 'written' as const }))
    } as EditorClipboardPort;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>' as SafePreviewHtml,
          { math: true }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks,
        imageBlocks: blocks.map(() => ({
          count: 0,
          firstImageIndex: 0,
          status: 'ready' as const
        })),
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const pendingCopy = deferred<void>();
    let leaseWasCurrentAfterResolve = false;
    const generatedContentExportSession = {
      copyAsImage: vi.fn(
        async (
          request: Parameters<GeneratedContentExportSession['copyAsImage']>[0]
        ) => {
          await pendingCopy.promise;
          const lease = request.lease as typeof request.lease & {
            isCurrent?: () => boolean;
          };
          leaseWasCurrentAfterResolve = lease.isCurrent?.() === true;
          return leaseWasCurrentAfterResolve
            ? { status: 'copied' as const }
            : {
                code: 'generated-content-export-lease-stale' as const,
                status: 'failed' as const
              };
        }
      ),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' as const }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        editorClipboardPort={editorClipboardPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('.easymde-math')).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    const openGeneratedCopyImage = async (): Promise<void> => {
      const formula = await within(document.body).findByRole('menuitem', {
        name: 'Formula'
      });
      fireEvent.mouseEnter(formula);
      const copySubmenu = within(document.body)
        .getAllByRole('menuitem', { name: 'Copy' })
        .find((item) => item.getAttribute('aria-haspopup') === 'menu');
      if (!copySubmenu) throw new Error('generated-copy-submenu-missing');
      fireEvent.mouseEnter(copySubmenu);
      const copyImage = await within(document.body).findByRole('menuitem', {
        name: 'Copy as image'
      });
      fireEvent.click(copyImage);
    };
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );
    await openGeneratedCopyImage();
    await waitFor(() =>
      expect(generatedContentExportSession.copyAsImage).toHaveBeenCalledOnce()
    );

    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    await within(document.body).findByRole('menu');
    fireEvent.contextMenu(document.body);
    pendingCopy.resolve();
    await waitFor(() => expect(leaseWasCurrentAfterResolve).toBe(true));
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'generated-content-export-lease-stale'
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('deletes only the captured Markdown image range and keeps the edit undoable', async () => {
    const props = fixture();
    const initial =
      'before ![alt](https://example.test/image.png "title") after';
    const imageStart = initial.indexOf('![');
    const imageEnd = initial.indexOf(')', imageStart) + 1;
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(imageStart, imageEnd);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menuitem', {
      name: 'Delete image'
    });
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Delete image' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe('before  after')
    );
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('deletes only a captured Source thematic break with one undoable canonical edit', async () => {
    const props = fixture();
    const initial = 'before\n\n  ---  \nafter';
    const expected = 'before\n\n\nafter';
    const markerStart = initial.indexOf('---');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(markerStart, markerStart + 3);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const sourceView = EditorView.findFromDOM(source);
    if (!sourceView) throw new Error('source-view-missing');
    const beforeHistoryDepth = undoDepth(sourceView.state);

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const deleteItem = await within(document.body).findByRole('menuitem', {
      name: 'Delete horizontal rule'
    });
    expect(deleteItem.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(deleteItem);

    await waitFor(() => expect(props.submissionField.value).toBe(expected));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(expected);
    expect(undoDepth(EditorView.findFromDOM(source)?.state ?? sourceView.state)).toBe(
      beforeHistoryDepth + 1
    );

    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(props.submissionField.value).toBe(initial));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('copies a Preview-certified same-origin image through deferred Clipboard without changing Markdown', async () => {
    const props = fixture();
    const sourceMarkdown =
      'before ![alt](https://example.test/image.png "title") after';
    const imageStart = sourceMarkdown.indexOf('![');
    const imageEnd = sourceMarkdown.indexOf(')', imageStart) + 1;
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(imageStart, imageEnd);
    const rendered =
      '<p><img src="https://example.test/image.png" alt="alt" title="title"></p>' as SafePreviewHtml;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, rendered, {}))
    );
    const editorBlockIndexPort = imageBlockIndexPort();
    const imageIndexHydrator = vi.spyOn(
      generatedImageTarget,
      'hydrateGeneratedImageTargetIndex'
    );
    const imageParser = vi.spyOn(imageScaleContract, 'parseMarkdownImageScale');
    const extracted = deferred<EditorImagePixelsResult>();
    const editorImagePixelsPort: EditorImagePixelsPort = {
      canExtract: vi.fn(() => true),
      dispose: vi.fn(),
      extractPng: vi.fn(() => extracted.promise),
      supports: vi.fn(() => true)
    };
    const writeImageDeferred = vi.fn(async (image: Promise<Blob>) => {
      await image;
      return { status: 'written' as const };
    });
    const editorClipboardPort = {
      ...props.editorClipboardPort,
      writeImageDeferred
    } as EditorClipboardPort;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        editorClipboardPort={editorClipboardPort}
        editorImagePixelsPort={editorImagePixelsPort}
        generatedContentExportSession={
          {
            copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
            copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
            dispose: vi.fn(),
          } as GeneratedContentExportSession
        }
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('img')).not.toBeNull()
    );

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(editorBlockIndexPort.build).toHaveBeenCalled());
    const copyImage = await within(document.body).findByRole('menuitem', {
      name: 'Copy image'
    });
    await waitFor(() =>
      expect(copyImage.getAttribute('aria-disabled')).toBe('false')
    );
    expect(imageIndexHydrator).toHaveBeenCalledOnce();
    const parserCallsAfterHydration = imageParser.mock.calls.length;
    fireEvent.contextMenu(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    const currentCopyImage = await within(document.body).findByRole(
      'menuitem',
      {
        name: 'Copy image'
      }
    );
    expect(imageParser).toHaveBeenCalledTimes(parserCallsAfterHydration);
    expect(imageIndexHydrator).toHaveBeenCalledOnce();
    fireEvent.click(currentCopyImage);
    await waitFor(() => expect(writeImageDeferred).toHaveBeenCalledOnce());
    expect(editorImagePixelsPort.extractPng).toHaveBeenCalledOnce();
    expect(props.submissionField.value).toBe(sourceMarkdown);

    extracted.resolve({
      blob: new Blob(['png'], { type: 'image/png' }),
      height: 2,
      pixelCount: 4,
      source: 'https://example.test/image.png',
      status: 'extracted',
      width: 2
    });
    await waitFor(() =>
      expect(writeImageDeferred).toHaveResolvedWith({ status: 'written' })
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('keeps Copy image unavailable when native pixels are denied', async () => {
    const props = fixture();
    const sourceMarkdown = '![alt](https://example.test/image.png)';
    const imageStart = sourceMarkdown.indexOf('![');
    const imageEnd = sourceMarkdown.length;
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(imageStart, imageEnd);
    const rendered =
      '<p><img src="https://example.test/image.png" alt="alt"></p>' as SafePreviewHtml;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, rendered, {}))
    );
    const editorBlockIndexPort = imageBlockIndexPort();
    const editorImagePixelsPort: EditorImagePixelsPort = {
      canExtract: vi.fn(() => false),
      dispose: vi.fn(),
      extractPng: vi.fn(),
      supports: vi.fn(() => false)
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        editorImagePixelsPort={editorImagePixelsPort}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('img')).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(editorBlockIndexPort.build).toHaveBeenCalled());
    const copyImage = await within(document.body).findByRole('menuitem', {
      name: 'Copy image'
    });
    await waitFor(() =>
      expect(copyImage.getAttribute('aria-disabled')).toBe('true')
    );
    expect(editorImagePixelsPort.extractPng).not.toHaveBeenCalled();
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('reuses hydrated image ranges for repeated dense-source menu capture', async () => {
    const props = fixture();
    const imageCount = 40_000;
    const sourceMarkdown = Array.from(
      { length: imageCount },
      () => '![](x)'
    ).join('\n');
    const lastImageStart = sourceMarkdown.lastIndexOf('![');
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(
      lastImageStart,
      lastImageStart + '![](x)'.length
    );
    const editorBlockIndexPort = imageBlockIndexPort();
    const imageParser = vi.spyOn(imageScaleContract, 'parseMarkdownImageScale');
    const imageIndexHydrator = vi.spyOn(
      generatedImageTarget,
      'hydrateGeneratedImageTargetIndex'
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(editorBlockIndexPort.build).toHaveBeenCalled());
    const hydration = imageIndexHydrator.mock.results[0]?.value;
    if (!hydration || 'function' !== typeof hydration.then) {
      throw new Error('image-index-hydration-missing');
    }
    await hydration;
    await within(document.body).findByRole('menuitem', { name: 'Copy image' });
    const parserCallsAfterHydration = imageParser.mock.calls.length;
    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    await within(document.body).findByRole('menuitem', { name: 'Copy image' });
    expect(imageParser).toHaveBeenCalledTimes(parserCallsAfterHydration);
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('keeps source structure unavailable until the async worker index is ready', async () => {
    const props = fixture();
    const sourceValue = '```\ncode\n```';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const pending = deferred<EditorMarkdownBlockIndexData>();
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(() => pending.promise),
      dispose: vi.fn()
    };
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    expect(within(document.body).queryByRole('menu')).toBeNull();
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );

    pending.resolve({
      blocks: [
        {
          editable: true,
          from: 0,
          kind: 'code',
          lineEnd: 2,
          lineStart: 0,
          to: sourceValue.length
        }
      ],
      imageBlocks: [{ count: 0, firstImageIndex: 0, status: 'ready' }],
      imageRanges: [],
      length: sourceValue.length,
      mathSpans: []
    });
    expect(
      await within(document.body).findByRole('menuitem', {
        name: 'Code block'
      })
    ).toBeTruthy();
    view.unmount();
  });

  it('keeps an exhausted block-index failure unavailable instead of pending forever', async () => {
    const props = fixture();
    const onFailure = vi.fn();
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => {
        throw new Error('worker-failed');
      }),
      dispose: vi.fn()
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        onFailure={onFailure}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledTimes(2)
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();
    const failureCount = onFailure.mock.calls.length;

    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editorBlockIndexPort.build).toHaveBeenCalledTimes(2);
    expect(onFailure.mock.calls.length).toBeGreaterThanOrEqual(
      failureCount
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();
    view.unmount();
  });

  it('opens the original menu after a same-key block-index retry resolves', async () => {
    const props = fixture();
    const sourceValue = '```\ncode\n```';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const retry = deferred<EditorMarkdownBlockIndexData>();
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi
        .fn()
        .mockRejectedValueOnce(new Error('first-failure'))
        .mockImplementationOnce(() => retry.promise),
      dispose: vi.fn()
    };
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledTimes(2)
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();

    retry.resolve({
      blocks: [
        {
          editable: true,
          from: 0,
          kind: 'code',
          lineEnd: 2,
          lineStart: 0,
          to: sourceValue.length
        }
      ],
      imageBlocks: [{ count: 0, firstImageIndex: 0, status: 'ready' }],
      imageRanges: [],
      length: sourceValue.length,
      mathSpans: []
    });
    await within(document.body).findByRole('menuitem', { name: 'Code block' });
    view.unmount();
  });

  it('does not cut an ABA-equal source range after its canonical revision changes', async () => {
    const props = fixture();
    const initial = props.submissionField.value;
    const pending = deferred<{ status: 'written' }>();
    const write = props.editorClipboardPort?.write;
    if (!write) throw new Error('clipboard-write-owner-missing');
    vi.mocked(write).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menuitem', { name: 'Cut' });
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Cut' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
        initial,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: initial.length, insert: 'x', to: initial.length }
    });
    editor.dispatch({
      changes: { from: initial.length, insert: '', to: initial.length + 1 }
    });
    pending.resolve({ status: 'written' });
    await Promise.resolve();
    expect(editor.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('does not paste an ABA-equal source range after its canonical revision changes', async () => {
    const props = fixture();
    const initial = props.submissionField.value;
    const pending = deferred<{ status: 'available'; text: string }>();
    const read = props.editorClipboardPort?.read;
    if (!read) throw new Error('clipboard-read-owner-missing');
    vi.mocked(read).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menuitem', { name: 'Paste' });
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Paste' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.read).toHaveBeenCalledOnce()
    );

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: initial.length, insert: 'x', to: initial.length }
    });
    editor.dispatch({
      changes: { from: initial.length, insert: '', to: initial.length + 1 }
    });
    pending.resolve({ status: 'available', text: 'replacement' });
    await Promise.resolve();
    expect(editor.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('starts native deferred HTML Clipboard write before the formal renderer resolves', async () => {
    const props = fixture();
    const pendingRender = deferred<PreviewResponse>();
    vi.mocked(props.previewPort.render).mockImplementation(
      () => pendingRender.promise
    );
    const writeDeferred = props.editorClipboardPort?.writeDeferred;
    if (!writeDeferred) throw new Error('deferred-clipboard-fixture-missing');
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Copy / Paste as' })
    );
    fireEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: 'Copy as HTML code'
      })
    );

    await waitFor(() => expect(writeDeferred).toHaveBeenCalledTimes(1));
    expect(props.previewPort.render).toHaveBeenCalled();
    pendingRender.resolve(
      createPreviewResponse(
        {
          codeTheme: 'dark',
          customCssId: '',
          markdown: 'selected',
          markdownTheme: 'default',
          postId: 7,
          signature: 'context-html'
        },
        '<p>Rendered HTML</p>' as SafePreviewHtml,
        {}
      )
    );
    await waitFor(() => expect(writeDeferred).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('uses the shared context-menu TableDialog with cancel no-op and one undoable insert', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    const openTableDialog = async () => {
      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      await within(document.body).findByRole('menu');
      fireEvent.click(
        within(document.body).getByRole('menuitem', { name: 'Insert' })
      );
      fireEvent.click(
        await within(document.body).findByRole('menuitem', { name: 'Insert table above' })
      );
      return within(document.body).findByRole('dialog', { name: '插入表格' });
    };

    const dialog = await openTableDialog();
    const cancelButtons = within(await dialog).getAllByRole('button', {
      name: '取消'
    });
    const cancelButton = cancelButtons[1] ?? cancelButtons[0];
    if (!cancelButton) throw new Error('table-dialog-cancel-unavailable');
    fireEvent.click(cancelButton);
    expect(props.submissionField.value).toBe('selected');

    await openTableDialog();
    fireEvent.click(
      within(document.body).getByRole('button', { name: '3 × 3' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).not.toBe('selected')
    );
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(
      'selected'
    );
    view.unmount();
  });

  it.each(['readOnly', 'disabled'] as const)(
    'fails a Source table confirmation whose field became %s while the dialog was open',
    async (flag) => {
      // The dialog stays open across an arbitrary delay, so the authoritative
      // native field can change after the enabled action started and before the
      // user confirms. Confirming must fail exactly once and write neither the
      // canonical document nor history.
      const props = fixture();
      props.submissionField.value = 'selected';
      props.submissionField.defaultValue = 'selected';
      props.submissionField.setSelectionRange(0, 8);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const view = render(<EditorRoot {...props} />);
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        await within(document.body).findByRole('menu');
        fireEvent.click(
          within(document.body).getByRole('menuitem', { name: 'Insert' })
        );
        fireEvent.click(
          await within(document.body).findByRole('menuitem', {
            name: 'Insert table above'
          })
        );
        await within(document.body).findByRole('dialog', { name: '插入表格' });
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);
        fireEvent.click(
          within(document.body).getByRole('button', { name: '2 × 2' })
        );
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'editor-context-menu-surface-read-only'
          )
        );
        expect(view.getByRole('alert').textContent).toBe(
          contextMenuStrings.statusActionFailed
        );
        expect(owner.getValue()).toBe('selected');
        expect(props.submissionField.value).toBe('selected');
        expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(
          'selected'
        );
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        expect(
          vi.mocked(props.onFailure).mock.calls.filter((call) =>
            call[0].startsWith('editor-context-menu-')
          )
        ).toEqual([['editor-context-menu-surface-read-only']]);

        // Restoring the flag schedules no deferred table insert.
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe('selected');
        expect(owner.getHistoryState()).toEqual(beforeHistory);
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

  it('formats a captured Source table through one canonical undoable edit', async () => {
    const props = fixture();
    const sourceValue = '|A|B|\n|---|---|\n|1|2|';
    const cellPosition = sourceValue.indexOf('1');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(cellPosition, cellPosition);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    const table = await within(document.body).findByRole('menuitem', { name: 'Table' });
    fireEvent.mouseEnter(table);
    const format = await within(document.body).findByRole('menuitem', {
      name: 'Format Table Source'
    });
    expect(format.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(format);

    await waitFor(() => expect(props.submissionField.value).not.toBe(sourceValue));
    const formattedValue = props.submissionField.value;
    expect(formattedValue).toContain('| A   | B   |');

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const repeatedTable = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(repeatedTable);
    const repeatedFormat = await within(document.body).findByRole('menuitem', {
      name: 'Format Table Source'
    });
    expect(repeatedFormat.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(repeatedFormat);
    await waitFor(() => expect(props.submissionField.value).toBe(formattedValue));
    expect(props.onFailure).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(sourceValue);
    view.unmount();
  });

  it('keeps block- and anchor-scoped table actions available for a mixed multi-row Source selection', async () => {
    const props = fixture();
    const sourceValue = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const firstBodyRow = sourceValue.indexOf('| 1');
    const nextRow = sourceValue.indexOf('| 3');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(firstBodyRow, nextRow + 3);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const table = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(table);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Table'
    });
    const availability = (name: string): string | null =>
      within(submenu).getByRole('menuitem', { name }).getAttribute('aria-disabled');
    // The selection cannot prove a single target row, column, or alignment, so
    // those operations stay disabled while the deterministic anchor and the
    // table block itself remain actionable.
    expect(availability('Insert row above')).toBe('false');
    expect(availability('Insert column right')).toBe('false');
    expect(availability('Copy table')).toBe('false');
    expect(availability('Delete table')).toBe('false');
    expect(availability('Insert paragraph below table')).toBe('false');
    expect(availability('Delete row')).toBe('true');
    expect(availability('Delete column')).toBe('true');
    expect(availability('Alignment')).toBe('true');
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(
      true
    );
    view.unmount();
  });

  it('keeps whole-table alignment available while row and column deletion stay unproven', async () => {
    const props = fixture();
    const sourceValue = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nTail';
    const tableEnd = sourceValue.indexOf('\n\nTail');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, tableEnd);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const table = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(table);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Table'
    });
    expect(
      within(submenu)
        .getByRole('menuitem', { name: 'Delete row' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      within(submenu)
        .getByRole('menuitem', { name: 'Delete column' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    const alignment = within(submenu).getByRole('menuitem', {
      name: 'Alignment'
    });
    expect(alignment.getAttribute('aria-disabled')).toBe('false');
    fireEvent.mouseEnter(alignment);
    fireEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Align left' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        '| A | B |\n| :--- | :--- |\n| 1 | 2 |\n| 3 | 4 |\n\nTail'
      )
    );
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('applies column alignment from a real-browser column drag selection', async () => {
    const props = fixture();
    const sourceValue = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const firstColumnStart = sourceValue.indexOf('1');
    const firstColumnEnd = sourceValue.indexOf('3') + 1;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(firstColumnStart, firstColumnEnd);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const table = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(table);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Table'
    });
    const availability = (name: string): string | null =>
      within(submenu)
        .getByRole('menuitem', { name })
        .getAttribute('aria-disabled');
    // The drag spans multiple rows inside one column: the column and the
    // anchor stay provable, while no single row is.
    expect(availability('Delete row')).toBe('true');
    expect(availability('Delete column')).toBe('false');
    expect(availability('Format Table Source')).toBe('false');
    const alignment = within(submenu).getByRole('menuitem', {
      name: 'Alignment'
    });
    expect(alignment.getAttribute('aria-disabled')).toBe('false');
    fireEvent.mouseEnter(alignment);
    fireEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Align right' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        '| A | B |\n| ---: | --- |\n| 1 | 2 |\n| 3 | 4 |'
      )
    );
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not expose table actions when the captured selection crosses the table boundary', async () => {
    const props = fixture();
    const sourceValue = '|A|B|\n|---|---|\n|1|2|\n\nTail';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    expect(within(document.body).queryByRole('menuitem', { name: 'Table' })).toBeNull();
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Insert' }));
    expect(
      within(document.body).getByRole('menuitem', { name: 'Insert paragraph above' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('copies parser-proven code content without fences or document mutation', async () => {
    const props = fixture();
    const sourceValue = [
      'before',
      '```ts',
      'const value = 1;',
      '',
      '```',
      'after'
    ].join('\n');
    const codePosition = sourceValue.indexOf('const value');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeContentPreviewResponse(
          request,
          sourceValue,
          codePosition,
          'const value = 1;\n\n'
        )
      )
    );
    const clipboard = props.editorClipboardPort;
    if (!clipboard) throw new Error('clipboard-write-owner-missing');
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeBlock = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeBlock);
    const copyContent = await within(document.body).findByRole('menuitem', {
      name: 'Copy Code Block Content'
    });
    expect(copyContent.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(copyContent);

    await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith(
      'const value = 1;\n\n',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ));
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not expose code-block actions when the captured selection crosses its boundary', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    expect(within(document.body).queryByRole('menuitem', { name: 'Code block' })).toBeNull();
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Insert' }));
    expect(
      within(document.body).getByRole('menuitem', { name: 'Insert paragraph below' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the generic menu for a real code-plus-paragraph selection', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeContentPreviewResponse(
          request,
          sourceValue,
          sourceValue.indexOf('const'),
          'const value = 1;\n'
        )
      )
    );
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    await waitFor(() =>
      expect(
        within(document.body).queryByRole('menuitem', { name: 'Code block' })
      ).toBeNull()
    );
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each(['rejected', 'pending'] as const)(
    'opens generic Copy/Cut for a mixed code selection without a %s code query',
    async (queryOutcome) => {
      const props = fixture();
      const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
      props.submissionField.value = sourceValue;
      props.submissionField.defaultValue = sourceValue;
      props.submissionField.setSelectionRange(0, sourceValue.length);
      const pendingCodeRender = deferred<PreviewResponse>();
      const codeRender = vi.fn(() => queryOutcome === 'rejected'
        ? Promise.reject(new Error('code-render-rejected'))
        : pendingCodeRender.promise);
      const renderPreview = vi.mocked(props.previewPort.render).getMockImplementation();
      if (!renderPreview) throw new Error('preview-render-fixture-missing');
      vi.mocked(props.previewPort.render).mockImplementation((request, signal) =>
        request.signature.startsWith('editor-code-content:')
          ? codeRender()
          : renderPreview(request, signal)
      );
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={sourceLinkBlockIndexPort()}
        />
      );
      const source = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });

      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      const menu = await within(document.body).findByRole('menu');
      for (const name of ['Copy', 'Cut']) {
        expect(within(menu).getByRole('menuitem', { name }).getAttribute('aria-disabled'))
          .toBe('false');
      }
      expect(within(menu).queryByRole('menuitem', { name: 'Code block' })).toBeNull();
      expect(codeRender).not.toHaveBeenCalled();
      expect(props.submissionField.value).toBe(sourceValue);
      expect(props.onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('accepts an exact code-block end boundary for a code action', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
    const codeEnd = sourceValue.indexOf('\n\nTail');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, codeEnd);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeBlock = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeBlock);
    const remove = await within(document.body).findByRole('menuitem', {
      name: 'Delete code block'
    });
    expect(remove.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(remove);

    await waitFor(() => expect(props.submissionField.value).toBe('\n\nTail'));
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('ignores a late code-content clipboard result after the source becomes stale', async () => {
    const props = fixture();
    const sourceValue = '```\nconst value = 1;\n```';
    const codePosition = sourceValue.indexOf('const value');
    const pending = deferred<{ status: 'failed'; code: 'editor-clipboard-write-failed' }>();
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeContentPreviewResponse(
          request,
          sourceValue,
          codePosition,
          'const value = 1;\n'
        )
      )
    );
    const clipboard = props.editorClipboardPort;
    if (!clipboard) throw new Error('clipboard-write-owner-missing');
    vi.mocked(clipboard.write).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Copy Code Block Content'
    }));
    await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith(
      'const value = 1;\n',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ));

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    pending.resolve({ code: 'editor-clipboard-write-failed', status: 'failed' });
    await Promise.resolve();
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    view.unmount();
  });

  it('indents an official JavaScript code block through one canonical edit', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      const candidate = request.signature.startsWith(
        'editor-code-indent-candidate:'
      );
      return Promise.resolve(
        createCodeIndentationPreviewResponse(
          request,
          candidate ? request.markdown : sourceValue,
          candidate
            ? 'function run() {\n  return 1;\n}\n'
            : 'function run() {\nreturn 1;\n}\n'
        )
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeBlock = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeBlock);
    const indent = await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    });
    expect(indent.getAttribute('aria-disabled')).toBe('false');
    expect(
      (await within(document.body).findByRole('menuitem', {
        name: 'Adjust Selected Code Indentation'
      })).getAttribute('aria-disabled')
    ).toBe('true');
    fireEvent.click(indent);

    const expected = '```js\nfunction run() {\n  return 1;\n}\n```';
    await waitFor(() => expect(editor.state.doc.toString()).toBe(expected));
    expect(props.submissionField.value).toBe(expected);
    expect(props.onFailure).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(editor.state.doc.toString()).toBe(sourceValue));
    view.unmount();
  });

  it('keeps an already-indented JavaScript block as a canonical no-op', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\n  return 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeIndentationPreviewResponse(
          request,
          request.signature.startsWith('editor-code-indent-candidate:')
            ? request.markdown
            : sourceValue,
          'function run() {\n  return 1;\n}\n'
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editor.state.doc.toString()).toBe(sourceValue);
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    expect(
      vi.mocked(props.previewPort.render).mock.calls.some(([request]) =>
        request.signature.startsWith('editor-code-indent-candidate:')
      )
    ).toBe(false);
    view.unmount();
  });

  it('routes ordinary fenced code block copy through the code owner', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```';
    const codePosition = sourceValue.indexOf('value');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);

    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Copy code block'
    }));

    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(sourceValue)
    );
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps code-block common actions grouped without duplicating root actions', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```';
    const codePosition = sourceValue.indexOf('value');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);

    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeTrigger = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeTrigger);
    const codeMenu = await within(document.body).findByRole('menu', {
      name: 'Code block'
    });

    const bold = within(codeMenu).getByRole('menuitem', { name: /^Bold/ });
    expect(bold.getAttribute('aria-disabled')).toBe('true');
    expect(within(codeMenu).getByRole('menuitem', { name: 'Delete code block' })).toBeTruthy();
    expect(within(codeMenu).getByRole('menuitem', { name: 'Copy / Paste as' })).toBeTruthy();
    expect(within(codeMenu).getByRole('menuitem', { name: 'Insert' })).toBeTruthy();
    expect(within(document.body).queryAllByRole('menuitem', { name: /^Bold/ })).toHaveLength(1);
    expect(within(document.body).queryAllByRole('menuitem', { name: 'Copy / Paste as' })).toHaveLength(1);
    expect(within(document.body).queryAllByRole('menuitem', { name: 'Insert' })).toHaveLength(1);

    fireEvent.mouseEnter(within(codeMenu).getByRole('menuitem', { name: 'Copy / Paste as' }));
    const copyPasteMenu = await within(document.body).findByRole('menu', {
      name: 'Copy / Paste as'
    });
    expect(within(copyPasteMenu).getByRole('menuitem', { name: 'Copy as HTML code' })).toBeTruthy();
    expect(within(copyPasteMenu).getByRole('menuitem', { name: 'Copy with simplified formatting' })).toBeTruthy();

    fireEvent.mouseEnter(within(codeMenu).getByRole('menuitem', { name: 'Insert' }));
    const insertMenu = await within(document.body).findByRole('menu', {
      name: 'Insert'
    });
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert table above' })).toBeTruthy();
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert table below' })).toBeTruthy();
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert image above' })).toBeTruthy();
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert image below' })).toBeTruthy();
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each([
    {
      name: 'quote',
      relative: 'above',
      source: ['> ```js', '> code', '> ```', '> tail'].join('\n'),
      expected: ['> ', '> ```js', '> code', '> ```', '> tail'].join('\n')
    },
    {
      name: 'list',
      relative: 'below',
      source: ['- ```js', '  code', '  ```', '- tail'].join('\n'),
      expected: ['- ```js', '  code', '  ```', '  ', '- tail'].join('\n')
    }
  ])(
    'keeps code-relative paragraph insertion inside a nested $name container',
    async ({ relative, source, expected }) => {
      const props = fixture();
      const codePosition = source.indexOf('code');
      props.submissionField.value = source;
      props.submissionField.defaultValue = source;
      props.submissionField.setSelectionRange(codePosition, codePosition);
      vi.mocked(props.previewPort.render).mockImplementation((request) => {
        const target = observedCodeContentTarget(
          source,
          { end: codePosition, start: codePosition },
          observedBlockIndex(source)
        );
        if ('unavailable' === target.status) {
          throw new Error(target.code);
        }
        return Promise.resolve({
          ...createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {}),
          codeMap: {
            coordinate: 'line' as const,
            entries: [{
              content: 'code\n',
              endLine: target.target.lineEnd,
              kind: target.target.kind,
              startLine: target.target.lineStart,
              status: 'available' as const
            }],
            signature: request.signature,
            status: 'available' as const,
            version: 1 as const
          }
        });
      });

      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={sourceLinkBlockIndexPort()}
        />
      );
      const sourceSurface = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });
      layoutContextMenuSurface(sourceSurface);
      fireEvent.contextMenu(sourceSurface, { clientX: 20, clientY: 24 });
      fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
        name: 'Code block'
      }));
      const action = await within(document.body).findByRole('menuitem', {
        name: 'above' === relative
          ? 'Insert paragraph above code block'
          : 'Insert paragraph below code block'
      });
      expect(action.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(action);

      await waitFor(() => expect(props.submissionField.value).toBe(expected));
      expect(props.submissionField.value).not.toBe(
        'above' === relative
          ? `\n${source}`
          : `${source}\n`
      );
      expect(props.onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('rejects a stale indentation candidate before the canonical write', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    const candidateRequestHolder: { current: PreviewRequest | null } = {
      current: null
    };
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-indent-candidate:')) {
        candidateRequestHolder.current = request;
        const response = createCodeIndentationPreviewResponse(
          request,
          request.markdown,
          'function run() {\n  return 1;\n}\n'
        );
        const projection = response.codeProjection;
        if (!projection || 'unavailable' === projection.status) {
          throw new Error('candidate-projection-fixture-missing');
        }
        return Promise.resolve({
          ...response,
          codeProjection: { ...projection, signature: 'stale-candidate' }
        });
      }
      if (request.signature.startsWith('editor-code-content:')) {
        return Promise.resolve(
          createCodeIndentationPreviewResponse(
            request,
            sourceValue,
            'function run() {\nreturn 1;\n}\n'
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-code-projection-candidate-stale'
    ));
    expect(candidateRequestHolder.current?.markdown).toBe(
      '```js\nfunction run() {\n  return 1;\n}\n```'
    );
    expect(editor.state.doc.toString()).toBe(sourceValue);
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    view.unmount();
  });

  it('reports a candidate Preview transport failure without a canonical write', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-indent-candidate:')) {
        return Promise.reject(new Error('candidate-preview-failed'));
      }
      if (request.signature.startsWith('editor-code-content:')) {
        return Promise.resolve(
          createCodeIndentationPreviewResponse(
            request,
            sourceValue,
            'function run() {\nreturn 1;\n}\n'
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-code-projection-candidate-unavailable'
    ));
    expect(editor.state.doc.toString()).toBe(sourceValue);
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    view.unmount();
  });

  it('rejects a late indentation candidate after the source becomes stale', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    const pending = deferred<PreviewResponse>();
    const candidateRequestHolder: { current: PreviewRequest | null } = {
      current: null
    };
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-indent-candidate:')) {
        candidateRequestHolder.current = request;
        return pending.promise;
      }
      if (request.signature.startsWith('editor-code-content:')) {
        return Promise.resolve(
          createCodeIndentationPreviewResponse(
            request,
            sourceValue,
            'function run() {\nreturn 1;\n}\n'
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await waitFor(() => expect(candidateRequestHolder.current).not.toBeNull());
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    const candidateRequest = candidateRequestHolder.current;
    if (!candidateRequest) throw new Error('candidate-request-missing');
    pending.resolve(
      createCodeIndentationPreviewResponse(
        candidateRequest,
        candidateRequest.markdown,
        'function run() {\n  return 1;\n}\n'
      )
    );
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-code-projection-candidate-stale'
    ));
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    expect(props.submissionField.value).toBe(`${sourceValue}x`);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(editor.state.doc.toString()).toBe(sourceValue));
    view.unmount();
  });

  it('ignores an indentation response after the source becomes stale', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const pending = deferred<PreviewResponse>();
    let codeRequest: PreviewRequest | null = null;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(sourceValue.indexOf('return'), sourceValue.indexOf('return'));
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-content:')) {
        codeRequest = request;
        return pending.promise;
      }
      return Promise.resolve(createPreviewResponse(
        request,
        '<p>Rendered</p>' as SafePreviewHtml,
        {}
      ));
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(codeRequest).not.toBeNull());
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    if (!codeRequest) throw new Error('code-content-request-missing');
    pending.resolve(
      createCodeIndentationPreviewResponse(
        codeRequest,
        sourceValue,
        'function run() {\nreturn 1;\n}\n'
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(within(document.body).queryByRole('menu')).toBeNull();
    view.unmount();
  });

  it.each([
    [
      'partial caption',
      'Before [caption](https://source.test) after',
      'caption',
      3
    ],
    [
      'reference use-site',
      '[标题][引用]\n\n[引用]: https://source.test/reference',
      '标题',
      1
    ]
  ])(
    'resolves Source %s links through the authoritative Preview href',
    async (_label, sourceValue, selectedText, selectionOffset) => {
      const props = fixture();
      const selectedStart = sourceValue.indexOf(selectedText) + selectionOffset;
      props.submissionField.value = sourceValue;
      props.submissionField.defaultValue = sourceValue;
      props.submissionField.setSelectionRange(
        selectedStart,
        selectedStart + selectedText.length - selectionOffset
      );
      const blockIndexPort = sourceLinkBlockIndexPort();
      const previewRender = vi.mocked(props.previewPort.render);
      previewRender.mockImplementation((request) =>
        Promise.resolve(
          createSourceLinkPreviewResponse(
            request,
            'https://actual.test/resolved'
          )
        )
      );
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={blockIndexPort}
          simplifiedFormattingParser={sourceLinkParser()}
        />
      );
      const source = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });

      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      const copyAddress = await within(document.body).findByRole('menuitem', {
        name: 'Copy link address'
      });
      expect(
        within(document.body).queryByRole('menuitem', { name: 'Open link' })
      ).toBeNull();
      expect(copyAddress.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(copyAddress);
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
          'https://actual.test/resolved'
        )
      );
      expect(props.submissionField.value).toBe(sourceValue);
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(
        previewRender.mock.calls.some(([request]) =>
          request.signature.startsWith('editor-source-link:')
        )
      ).toBe(true);
      view.unmount();
    }
  );

  it('reports a Source link Preview anchor failure without enabling link actions', async () => {
    const props = fixture();
    const sourceValue = '[caption](https://source.test)';
    const selectionStart = sourceValue.indexOf('caption') + 1;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(selectionStart, selectionStart + 2);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createSourceLinkPreviewResponse(
        request,
        'https://actual.test/resolved',
        false
      ))
    );
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
        simplifiedFormattingParser={sourceLinkParser()}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-source-link-preview-anchor-missing'
    ));
    expect(
      within(document.body).queryByRole('menuitem', {
        name: 'Copy link address'
      })
    ).toBeNull();
    expect(props.submissionField.value).toBe(sourceValue);
    view.unmount();
  });

  it('ignores a late Source link response after the canonical document changes', async () => {
    const props = fixture();
    const sourceValue = '[caption](https://source.test)';
    const selectionStart = sourceValue.indexOf('caption') + 1;
    const pending = deferred<PreviewResponse>();
    let linkRequest: PreviewRequest | null = null;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(selectionStart, selectionStart + 2);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-source-link:')) {
        linkRequest = request;
        return pending.promise;
      }
      return Promise.resolve(createPreviewResponse(
        request,
        '<p>Rendered</p>' as SafePreviewHtml,
        {}
      ));
    });
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
        simplifiedFormattingParser={sourceLinkParser()}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(linkRequest).not.toBeNull());

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    if (!linkRequest) throw new Error('source-link-request-missing');
    pending.resolve(
      createSourceLinkPreviewResponse(
        linkRequest,
        'https://actual.test/resolved'
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(within(document.body).queryByRole('menu')).toBeNull();
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    view.unmount();
  });

  it.each([
    [
      'https://example.test/imported.png',
      '![alt](https://example.test/imported.png "title")'
    ],
    [
      'https://example.test/original.png',
      '![alt](https://example.test/original.png "title")'
    ]
  ])(
    'replaces only an eligible image destination after authoritative upload (%s)',
    async (uploadedUrl, expected) => {
      const props = fixture();
      const initial = '![alt](https://example.test/original.png "title")';
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      props.submissionField.setSelectionRange(0, initial.length);
      vi.mocked(props.remoteImageImportPort.import).mockResolvedValue(
        uploadedUrl === 'https://example.test/original.png'
          ? {
              alt: 'remote image',
              status: 'unchanged',
              title: 'title',
              url: uploadedUrl
            }
          : {
              alt: 'remote image',
              backup: { status: 'disabled' },
              status: 'imported',
              title: 'title',
              url: uploadedUrl
            }
      );
      const editorBlockIndexPort = imageBlockIndexPort();
      const view = render(
        <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
      );
      const source = await waitFor(() => {
        const element =
          view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });
      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      await waitFor(() =>
        expect(editorBlockIndexPort.build).toHaveBeenCalled()
      );
      await within(document.body).findByRole('menu');
      fireEvent.click(
        within(document.body).getByRole('menuitem', { name: 'Upload image' })
      );
      await waitFor(() =>
        expect(props.remoteImageImportPort.import).toHaveBeenCalledOnce()
      );
      await waitFor(() => expect(props.submissionField.value).toBe(expected));
      view.unmount();
    }
  );
});
