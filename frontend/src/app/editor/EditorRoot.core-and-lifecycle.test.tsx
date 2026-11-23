import { createElement } from '@wordpress/element';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within
} from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type {
  RevisionPreview,
  RevisionSummary
} from '../../contracts/ports/revision-port';
import * as observedSourceAdapter from '../../features/document-source/adapters/code-mirror-document-session';
import { EditorRoot } from './EditorRoot';
import { EditorRootErrorBoundary } from './EditorRootErrorBoundary';
import {
  BrokenEditorRoot,
  cleanupEditorRootTestHarness,
  createPreviewResponse,
  createQueuedAnimationFrames,
  deferred,
  drainAnimationFrameBatch,
  fixture,
  imageTransferEvent,
  layoutContextMenuSurface,
  sourceLinkBlockIndexPort
} from './editor-root-test-harness';

afterEach(cleanupEditorRootTestHarness);

describe('EditorRoot core and lifecycle', () => {
  it('does not deliver a queued frame canceled by an earlier callback', async () => {
    const frameQueue = createQueuedAnimationFrames();
    const delivered: string[] = [];
    let secondId = 0;
    try {
      window.requestAnimationFrame(() => {
        delivered.push('first');
        window.cancelAnimationFrame(secondId);
      });
      secondId = window.requestAnimationFrame(() => delivered.push('second'));
      await drainAnimationFrameBatch(frameQueue, 0);
      expect(delivered).toEqual(['first']);
      expect(frameQueue.callbacks.size).toBe(0);
    } finally {
      frameQueue.restore();
    }
  });

  it('focuses new editable posts by default without stealing focus for existing posts', async () => {
    const existingProps = fixture();
    const sentinel = document.createElement('button');
    sentinel.type = 'button';
    sentinel.textContent = 'Focus sentinel';
    document.body.append(sentinel);
    sentinel.focus();
    const existingView = render(<EditorRoot {...existingProps} />);

    expect(document.activeElement).toBe(sentinel);
    existingView.unmount();

    const newProps = { ...fixture(), isNewPost: true };
    sentinel.focus();
    const newView = render(<EditorRoot {...newProps} />);

    await waitFor(() =>
      expect(document.activeElement?.closest('.cm-editor')).not.toBeNull()
    );
    newView.unmount();

    const previewFixture = fixture();
    const previewProps = {
      ...previewFixture,
      isNewPost: true,
      settings: {
        ...previewFixture.settings,
        general: {
          ...previewFixture.settings.general,
          editingMode: 'preview'
        }
      }
    };
    sentinel.focus();
    const previewView = render(<EditorRoot {...previewProps} />);

    expect(document.activeElement).toBe(sentinel);
    previewView.unmount();
    sentinel.remove();
  });

  it('composes source, toolbar and preview under one React owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    expect(
      view.container.querySelectorAll('[data-easymde-editor-owner="react"]')
    ).toHaveLength(1);
    expect(props.submissionField.hidden).toBe(true);
    expect(props.onDocumentOwnerChange).toHaveBeenCalledWith(true);
    expect(view.container.querySelector('.cm-editor')).not.toBeNull();
    expect(
      view.container.querySelectorAll('.easymde-pane-header')
    ).toHaveLength(0);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
          ?.innerHTML
      ).toBe('<p data-easymde-visual-block-id="b0">Rendered</p>');
    });
    expect(props.shortcutBinding.activate).toHaveBeenCalledTimes(1);

    const bold = view.container.querySelector<HTMLButtonElement>(
      '[data-easymde-command="bold"]'
    );
    expect(bold).not.toBeNull();
    await act(async () => {
      fireEvent.click(bold as HTMLButtonElement);
    });
    expect(props.submissionField.value).toBe('**selected**');

    const image = view.container.querySelector<HTMLButtonElement>(
      '[data-easymde-command="image"]'
    );
    expect(image).not.toBeNull();
    await act(async () => {
      fireEvent.click(image as HTMLButtonElement);
    });
    expect(props.mediaPickerFrame?.open).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(props.submissionField.hidden).toBe(false);
    expect(props.onDocumentOwnerChange).toHaveBeenLastCalledWith(false);
    expect(props.shortcutBinding.dispose).toHaveBeenCalledTimes(1);
    expect(props.enhancementPort.dispose).toHaveBeenCalledTimes(1);
  });

  it('adds the immersive entry while leaving publish and revisions with WordPress', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Bold' })).not.toBeNull()
    );
    const toolbar = view.getByRole('toolbar', { name: 'Markdown toolbar' });
    const labels = Array.from(
      toolbar.querySelectorAll(
        'button[data-easymde-command], .easymde-toolbar-section-secondary > button, '
          + '.easymde-toolbar-section-secondary > .easymde-toolbar-popover-anchor > button'
      )
    ).map((button) => button.getAttribute('aria-label'));

    expect(labels).toEqual([
      'Bold',
      'Image',
      'Copy to WeChat',
      '进入沉浸写作',
      '编辑器设置'
    ]);
    expect(
      toolbar.querySelectorAll(
        '.easymde-toolbar-section-secondary > .easymde-toolbar-divider'
      )
    ).toHaveLength(1);
    expect(view.queryByRole('button', { name: 'History' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Publish' })).toBeNull();
    const immersiveEntry = view.getByRole('button', {
      name: '进入沉浸写作'
    });
    expect(immersiveEntry.getAttribute('aria-pressed')).toBe('false');
    expect(
      immersiveEntry.classList.contains('easymde-toolbar-immersive-toggle')
    ).toBe(true);
    expect(immersiveEntry.firstElementChild?.className).toBe(
      'dashicons dashicons-fullscreen-alt'
    );
  });

  it('formats canonical punctuation tokens in export command titles', async () => {
    const props = fixture();
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'extensionExport',
          group: 'export',
          icon: 'admin-generic',
          id: 'extension-export',
          label: 'Extension export',
          surface: 'main'
        }
      ],
      shortcuts: {
        ...props.toolbar.shortcuts,
        'extension-export': {
          mac: 'Cmd+Backquote',
          win: 'Ctrl+Backquote'
        }
      }
    };
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);

    const button = await view.findByRole('button', {
      name: 'Extension export'
    });
    expect(button.title).toBe('Extension export (Ctrl+`)');
  });

  it('uses the existing title and document owners for immersive edits and table insertion', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.change(view.getByRole('textbox', { name: '文章标题' }), {
      target: { value: '沉浸标题' }
    });
    expect(props.titleField?.value).toBe('沉浸标题');
    expect(view.getByText('未保存')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '表格' }));
    fireEvent.click(view.getByRole('button', { name: '2 × 2' }));
    expect(props.submissionField.value).toContain(
      '|  |  |\n| --- | --- |\n|  |  |'
    );
    expect(props.submissionField.value).not.toMatch(/[一-鿿]/u);
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
  });

  it('leaves visual Preview before a table mutates the Markdown owner', async () => {
    const props = fixture();
    props.submissionField.value = 'Choose **this** text';
    props.submissionField.defaultValue = 'Choose **this** text';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('p')?.lastChild;
    if (!selectedText || Node.TEXT_NODE !== selectedText.nodeType) {
      throw new Error('missing synthetic visual table selection target');
    }
    const range = document.createRange();
    range.setStart(selectedText, selectedText.textContent?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(view.getByRole('button', { name: '表格' }));
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '2 × 2' }));

    expect(props.submissionField.value).toBe(
      'Choose **this** text\n|  |  |\n| --- | --- |\n|  |  |\n'
    );
  });

  it('loads WordPress revisions, confirms dirty restoration and reports through the native handoff', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.change(view.getByRole('textbox', { name: '文章标题' }), {
      target: { value: 'Changed title' }
    });

    fireEvent.click(view.getByRole('button', { name: '历史记录' }));
    await waitFor(() =>
      expect(props.revisionPort?.list).toHaveBeenCalledOnce()
    );
    await waitFor(() =>
      expect(props.revisionPort?.get).toHaveBeenCalledWith(
        12,
        expect.any(AbortSignal)
      )
    );
    expect(view.getByText('共 1 条历史版本')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));
    expect(props.restoreRevision).not.toHaveBeenCalled();
    expect(view.getByRole('alert').textContent).toContain(
      '未保存的更改将会丢失'
    );
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));
    expect(props.restoreRevision).toHaveBeenCalledWith(
      'https://example.test/wp-admin/revision.php?revision=12'
    );
  });

  it('flushes a pending visual edit before History can restore a revision', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>selected</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    visualEditor.innerHTML = '<p>Immediate visual history edit</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Immediate visual history edit')
    );

    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    expect(props.submissionField.value).toBe('Immediate visual history edit');
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();

    await waitFor(() =>
      expect(props.revisionPort?.get).toHaveBeenCalledWith(
        12,
        expect.any(AbortSignal)
      )
    );
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));

    expect(props.restoreRevision).not.toHaveBeenCalled();
    expect(view.getByRole('alert').textContent).toContain(
      '未保存的更改将会丢失'
    );
  });

  it('keeps the History filter inside the modal focus loop while revisions load', async () => {
    const props = fixture();
    const revisionPort = {
      get: vi.fn(),
      list: vi.fn(() => new Promise<never>(() => undefined))
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));
    const dialog = view.getByRole('dialog', { name: '历史版本' });
    const filter = within(dialog).getByRole('combobox', { name: '全部' });
    const close = within(dialog).getByRole('button', { name: '取消' });
    filter.focus();

    expect(fireEvent.keyDown(filter, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it('selects the first matching revision when History is filtered before loading completes', async () => {
    const revisions = deferred<ReadonlyArray<RevisionSummary>>();
    const props = fixture();
    const revisionPort = {
      get: vi.fn().mockResolvedValue({
        features: {},
        html: '<p>Automatic revision</p>' as SafePreviewHtml,
        id: 13
      }),
      list: vi.fn(() => revisions.promise)
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));
    fireEvent.change(view.getByRole('combobox', { name: '全部' }), {
      target: { value: 'auto' }
    });

    await act(async () => {
      revisions.resolve([
        {
          date: '2026-07-23T10:00:00Z',
          dateLabel: '10:00',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12',
          title: 'Manual revision',
          type: 'manual'
        },
        {
          date: '2026-07-23T11:00:00Z',
          dateLabel: '11:00',
          id: 13,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=13',
          title: 'Automatic revision',
          type: 'auto'
        }
      ]);
    });

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(13, expect.any(AbortSignal))
    );
    expect(view.getByText('Automatic revision')).not.toBeNull();
    expect(
      (
        view.getByRole('button', {
          name: '恢复到这个版本'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it('ignores a stale revision preview that resolves after the current selection', async () => {
    const firstPreview = deferred<RevisionPreview>();
    const secondPreview = deferred<RevisionPreview>();
    const props = fixture();
    const revisionPort = {
      get: vi.fn((id: number) =>
        12 === id ? firstPreview.promise : secondPreview.promise
      ),
      list: vi.fn().mockResolvedValue([
        {
          date: '2026-07-23T10:00:00Z',
          dateLabel: '10:00',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12',
          title: 'First',
          type: 'manual'
        },
        {
          date: '2026-07-23T11:00:00Z',
          dateLabel: '11:00',
          id: 13,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=13',
          title: 'Second',
          type: 'manual'
        }
      ])
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(12, expect.any(AbortSignal))
    );
    fireEvent.click(view.getByRole('button', { name: '手动保存11:00' }));
    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(13, expect.any(AbortSignal))
    );

    await act(async () => {
      secondPreview.resolve({
        features: {},
        html: '<p>Current revision</p>' as SafePreviewHtml,
        id: 13
      });
    });
    expect(view.getByText('Current revision')).not.toBeNull();

    await act(async () => {
      firstPreview.resolve({
        features: {},
        html: '<p>Stale revision</p>' as SafePreviewHtml,
        id: 12
      });
    });
    expect(view.getByText('Current revision')).not.toBeNull();
    expect(view.queryByText('Stale revision')).toBeNull();
  });

  it('moves History selection into the active filter and aborts the hidden preview', async () => {
    const props = fixture();
    const revisionPort = {
      get: vi.fn().mockImplementation(
        (id: number) =>
          new Promise<RevisionPreview>((resolve) => {
            if (13 === id) {
              resolve({
                features: {},
                html: '<p>Automatic revision</p>' as SafePreviewHtml,
                id: 13
              });
            }
          })
      ),
      list: vi.fn().mockResolvedValue([
        {
          date: '2026-07-23T10:00:00Z',
          dateLabel: '10:00',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12',
          title: 'Manual revision',
          type: 'manual' as const
        },
        {
          date: '2026-07-23T11:00:00Z',
          dateLabel: '11:00',
          id: 13,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=13',
          title: 'Automatic revision',
          type: 'auto' as const
        }
      ])
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(12, expect.any(AbortSignal))
    );
    const manualSignal = revisionPort.get.mock.calls[0]?.[1] as AbortSignal;
    fireEvent.change(view.getByRole('combobox', { name: '全部' }), {
      target: { value: 'auto' }
    });

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(13, expect.any(AbortSignal))
    );
    expect(manualSignal.aborted).toBe(true);
    expect(view.queryByRole('button', { name: '手动保存10:00' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));
    expect(props.restoreRevision).toHaveBeenCalledWith(
      'https://example.test/wp-admin/revision.php?revision=13'
    );
  });

  it('layers Escape handling and restores focus to the immersive entry after exit', async () => {
    const props = fixture();
    const restoreFavicon = vi.fn();
    vi.mocked(props.immersiveEnvironment.activateFavicon).mockReturnValue(
      restoreFavicon
    );
    const view = render(<EditorRoot {...props} />);
    const entry = await view.findByRole('button', { name: '进入沉浸写作' });
    entry.focus();
    fireEvent.click(entry);
    expect(props.immersiveEnvironment.activateFavicon).toHaveBeenCalledOnce();
    expect(
      props.immersiveEnvironment.activateFocusBoundary
    ).toHaveBeenCalledWith(view.container.querySelector('.easymde-editor'));
    expect(document.activeElement).toBe(
      view.container.querySelector('.cm-content')
    );
    fireEvent.click(view.getByRole('button', { name: '表格' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog', { name: '表格' })).toBeNull();
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog', { name: '编辑器设置' })).toBeNull();
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: '编辑器设置' })
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: '进入沉浸写作' })
      )
    );
    expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull();
    expect(restoreFavicon).toHaveBeenCalledOnce();
  });

  it('lets the user discard an unreadable local draft and unblock storage ownership', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.read).mockReturnValue({
      code: 'local-draft-payload-invalid',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    expect(view.getByText('Draft read failed')).not.toBeNull();
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Discard draft' }));
    });

    expect(props.localDraftStorage.discard).toHaveBeenCalledOnce();
    expect(view.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });

  it('flushes the React document before native form serialization and releases the bridge', () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    expect(editor).not.toBeNull();

    editor?.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'current editor value'
      }
    });
    props.submissionField.value = 'stale native value';
    props.nativeForm.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );
    expect(props.submissionField.value).toBe('current editor value');

    view.unmount();
    props.submissionField.value = 'after teardown';
    props.nativeForm.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );
    expect(props.submissionField.value).toBe('after teardown');
  });

  it('tracks the WordPress session and blocks new protected native and React operations', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    editor?.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'unsaved session value'
      }
    });
    props.submissionField.value = 'preserved unsaved value';

    act(() => props.sessionEmit('locked'));

    expect(
      view.container
        .querySelector('[data-easymde-editor-owner="react"]')
        ?.getAttribute('data-easymde-session-status')
    ).toBe('locked');
    const nativeEvent = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true
    });
    expect(props.nativeForm.dispatchEvent(nativeEvent)).toBe(false);
    expect(props.submissionField.value).toBe('preserved unsaved value');

    expect(props.onFailure).toHaveBeenCalledWith('editor-session-locked');

    act(() => props.sessionEmit('authentication-required'));
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    await waitFor(() =>
      expect(props.mediaPickerFrame?.open).not.toHaveBeenCalled()
    );
    expect(props.submissionField.value).toBe('preserved unsaved value');
  });

  it('keeps the dirty baseline and recovery data until WordPress confirms persistence on the next bootstrap', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    editor?.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'not persisted'
      }
    });
    await waitFor(() =>
      expect(props.localDraftStorage.write).toHaveBeenCalledWith(
        'not persisted'
      )
    );

    props.nativeForm.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );

    expect(props.localDraftStorage.discard).not.toHaveBeenCalled();
  });

  it('reports a render failure without leaving a partial editor owner', () => {
    const props = fixture();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const preventSyntheticError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventSyntheticError);

    try {
      const view = render(
        <EditorRootErrorBoundary
          failureMessage="The editor could not start."
          onFailure={props.onFailure}
        >
          <BrokenEditorRoot />
        </EditorRootErrorBoundary>
      );

      expect(props.onFailure).toHaveBeenCalledWith(
        'react-editor-render-failed'
      );
      expect(view.getByRole('alert').textContent).toBe(
        'The editor could not start.'
      );
    } finally {
      window.removeEventListener('error', preventSyntheticError);
      consoleError.mockRestore();
    }
  });

  it('fails a Source media insertion when the field became read-only while the picker was open', async () => {
    // The media picker is a user gesture that can stay open indefinitely, so the
    // authoritative Source field may turn read-only before the user selects an
    // attachment. The insertion must then fail explicitly and write neither the
    // canonical document nor history.
    const props = fixture();
    props.submissionField.value = 'Before after';
    props.submissionField.defaultValue = 'Before after';
    props.submissionField.setSelectionRange(7, 7);
    const before = props.submissionField.value;
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      const frame = props.mediaPickerFrame;
      if (!frame) throw new Error('media-frame-missing');
      const open = vi.mocked(frame.open).mock.calls[0]?.[0];
      if (!open) throw new Error('media-frame-open-missing');
      // The picker was opened while editable; the field turns read-only now.
      props.submissionField.readOnly = true;
      open.onSelect({
        alt: 'Selected image',
        url: 'https://example.test/readonly.png'
      });
      open.onClose();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(props.submissionField.value).toBe(before);
      expect(props.submissionField.value).not.toContain('readonly.png');
      expect(props.onFailure).toHaveBeenCalledWith(
        'media-picker-document-read-only'
      );
    } finally {
      props.submissionField.readOnly = false;
      view.unmount();
    }
  });

  it('fails a Source media insertion when the field became disabled while the picker was open', async () => {
    // The authoritative field can also be disabled rather than read-only. The
    // adapter reads both, so the mutation must reject either transition without
    // touching the canonical document or history.
    const props = fixture();
    props.submissionField.value = 'Before after';
    props.submissionField.defaultValue = 'Before after';
    props.submissionField.setSelectionRange(7, 7);
    const before = props.submissionField.value;
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      const frame = props.mediaPickerFrame;
      if (!frame) throw new Error('media-frame-missing');
      const open = vi.mocked(frame.open).mock.calls[0]?.[0];
      if (!open) throw new Error('media-frame-open-missing');
      props.submissionField.disabled = true;
      open.onSelect({
        alt: 'Selected image',
        url: 'https://example.test/disabled.png'
      });
      open.onClose();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(props.submissionField.value).toBe(before);
      expect(props.submissionField.value).not.toContain('disabled.png');
      expect(props.onFailure).toHaveBeenCalledWith(
        'media-picker-document-read-only'
      );
    } finally {
      props.submissionField.disabled = false;
      view.unmount();
    }
  });

  it.each([
    ['readOnly', 'above'],
    ['readOnly', 'below'],
    ['disabled', 'above'],
    ['disabled', 'below']
  ] as const)(
    'rejects formatted Source context media insertion after %s permission loss in position %s without changing history',
    async (flag, direction) => {
      // The picker opens while the field is editable, so the formatted
      // context-menu insertion (Insert -> image above / below) is genuinely
      // enabled on the relative-insertion branch. The authoritative native flag
      // then changes before confirmation: the mutation itself must reject, keep
      // the exact source and selection, and leave no history entry or deferred
      // insertion behind.
      const props = fixture();
      const initial = 'Before after\n\nTail';
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      const caret = initial.indexOf('after');
      props.submissionField.setSelectionRange(caret, caret);
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
      const view = render(
        <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
      );
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
        const relativeInsert = await within(document.body).findByRole('menuitem', {
          name: `Insert image ${direction}`
        });
        expect(relativeInsert.getAttribute('aria-disabled')).toBe('false');
        fireEvent.click(relativeInsert);

        const frame = props.mediaPickerFrame;
        if (!frame) throw new Error('media-frame-missing');
        const open = vi.mocked(frame.open).mock.calls.at(-1)?.[0];
        if (!open) throw new Error('media-frame-open-missing');
        // Everything is still editable while the user works in the picker.
        const beforeSource = owner.getValue();
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();

        // Only the authoritative native field changes, immediately before the
        // real confirmation.
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        // Read the authoritative native field back: exactly the selected flag
        // changed, while the other one still permits nothing extra.
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);

        open.onSelect({
          alt: 'Selected image',
          url: `https://example.test/${flag}.png`
        });
        open.onClose();

        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'media-picker-document-read-only'
          )
        );
        // Exactly one stable failure: not the generic fallback, no duplicate.
        expect(
          vi.mocked(props.onFailure).mock.calls.filter(
            (call) => call[0].startsWith('media-picker-')
          )
        ).toEqual([['media-picker-document-read-only']]);
        expect(view.getByRole('alert').textContent).toBe(
          'The media library could not be opened.'
        );
        // Byte-identical source, identical native and canonical selection,
        // identical revision and history: the failed insertion wrote nothing.
        expect(owner.getValue()).toBe(beforeSource);
        expect(props.submissionField.value).toBe(initial);
        // The authoritative native field keeps the user's own caret exactly:
        // a rejected insertion never moves the native selection either.
        expect([
          props.submissionField.selectionStart,
          props.submissionField.selectionEnd
        ]).toEqual([caret, caret]);
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        expect(props.submissionField.value).not.toContain(`${flag}.png`);
        expect(source.querySelector('img')).toBeNull();

        // Restore the exact original flag and prove no insertion is deferred.
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe(initial);
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(source.querySelector('img')).toBeNull();
        expect(view.queryByRole('dialog')).toBeNull();
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

  it('opens WordPress Media from the Image command and inserts the selected attachment', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    const frame = props.mediaPickerFrame;
    expect(frame).not.toBeNull();
    if (!frame) {
      throw new Error('missing synthetic media frame');
    }
    expect(frame.open).toHaveBeenCalledTimes(1);
    vi.mocked(frame.open).mock.calls[0]?.[0].onSelect({
      alt: 'Selected image',
      url: 'https://example.test/selected.png'
    });
    vi.mocked(frame.open).mock.calls[0]?.[0].onClose();

    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        '![image](https://example.test/selected.png)'
      );
    });
    expect(props.executeExternalCommand).not.toHaveBeenCalled();
  });

  it('maps a visual Preview selection before handing Image to WordPress Media', async () => {
    const props = fixture();
    props.submissionField.value = 'Choose **this** text';
    props.submissionField.defaultValue = 'Choose **this** text';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('missing synthetic visual selection target');
    }
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    const frame = props.mediaPickerFrame;
    if (!frame) {
      throw new Error('missing synthetic media frame');
    }
    vi.mocked(frame.open).mock.calls[0]?.[0].onSelect({
      alt: 'Selected image',
      url: 'https://example.test/selected.png'
    });
    vi.mocked(frame.open).mock.calls[0]?.[0].onClose();

    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        'Choose **![image](https://example.test/selected.png)** text'
      );
    });
  });

  it('reports a stable visible Media failure without mutating Markdown', async () => {
    const props = fixture();
    const frame = props.mediaPickerFrame;
    if (!frame) {
      throw new Error('missing synthetic media frame');
    }
    vi.mocked(frame.open).mockImplementation(() => {
      throw new Error('private WordPress frame failure');
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(view.getByRole('button', { name: 'Image' }));

    await waitFor(() => {
      expect(
        view.getByText('The media library could not be opened.')
      ).not.toBeNull();
      expect(props.onFailure).toHaveBeenCalledWith(
        'media-picker-operation-failed'
      );
    });
    expect(props.submissionField.value).toBe('selected');
  });

  it('owns image Paste upload status and releases the Source listener on teardown', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();
    const paste = imageTransferEvent(
      'paste',
      new File(['image'], 'screen-shot.png', { type: 'image/png' })
    );

    source?.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(view.getByText('Paste uploaded')).not.toBeNull();
      expect(props.submissionField.value).toBe(
        '![screen shot](https://example.test/upload.png)'
      );
    });

    view.unmount();
    const afterUnmount = imageTransferEvent(
      'paste',
      new File(['image'], 'ignored.png', { type: 'image/png' })
    );
    source?.dispatchEvent(afterUnmount);
    expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(1);
  });

  it('imports one remote Markdown image from the source surface', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) =>
          'text/plain' === type
            ? '![remote](https://images.example.test/remote.png)'
            : '',
        items: []
      }
    });

    source?.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.remoteImageImportPort.import).toHaveBeenCalledWith(
        expect.objectContaining({
          altText: 'remote',
          postId: 7,
          url: 'https://images.example.test/remote.png'
        })
      );
      expect(props.submissionField.value).toBe(
        '![remote image](https://example.test/imported.png)'
      );
    });
    expect(props.imageUploadPort.upload).not.toHaveBeenCalled();
  });

  it('blocks automatic image paste while preserving drag-and-drop upload', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      imageUpload: {
        ...baseProps.imageUpload,
        autoUploadPastedImages: false
      }
    };
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();
    const file = new File(['image'], 'screen-shot.png', {
      type: 'image/png'
    });
    const paste = imageTransferEvent('paste', file);

    source?.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(props.imageUploadPort.upload).not.toHaveBeenCalled();
    expect(props.submissionField.value).toBe('selected');
    await waitFor(() => {
      expect(view.getByText('Paste upload disabled')).not.toBeNull();
    });

    const drop = imageTransferEvent('drop', file);
    source?.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.imageUploadPort.upload).toHaveBeenCalledOnce();
      expect(props.submissionField.value).toBe(
        '![screen shot](https://example.test/upload.png)'
      );
    });
  });

  it('shows a dismissible error alert without inserting Markdown when backup retries are exhausted', async () => {
    const props = fixture();
    vi.mocked(props.imageUploadPort.upload).mockResolvedValue({
      code: 'easymde_image_hosting_backup_upload_failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();

    source?.dispatchEvent(
      imageTransferEvent(
        'paste',
        new File(['image'], 'screen-shot.png', { type: 'image/png' })
      )
    );

    const alert = await view.findByRole('alert');
    expect(alert.textContent).toContain('Paste failed');
    expect(props.submissionField.value).not.toContain('![');
    fireEvent.click(within(alert).getByRole('button', { name: '关闭' }));
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('preserves an upload error when the upload session remounts', async () => {
    const props = fixture();
    let uploadCount = 0;
    vi.mocked(props.imageUploadPort.upload).mockImplementation(() => {
      uploadCount += 1;
      if (1 === uploadCount) {
        return Promise.resolve({ code: 'request-failed', status: 'failed' });
      }
      return new Promise(() => undefined);
    });
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();

    source?.dispatchEvent(
      imageTransferEvent(
        'paste',
        new File(['first'], 'first.png', { type: 'image/png' })
      )
    );
    await waitFor(() => expect(view.getByText('Paste failed')).not.toBeNull());

    view.rerender(
      <EditorRoot {...props} imageUpload={{ ...props.imageUpload }} />
    );
    source?.dispatchEvent(
      imageTransferEvent(
        'paste',
        new File(['second'], 'second.png', { type: 'image/png' })
      )
    );

    await waitFor(() =>
      expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(2)
    );
    expect(view.getByText('Paste failed')).not.toBeNull();
    expect(view.queryByText('Paste uploading')).toBeNull();
  });

  it('restores an available local draft and releases its storage subscription', async () => {
    const props = fixture();
    const unsubscribe = vi.fn();
    vi.mocked(props.localDraftStorage.subscribe).mockReturnValue(unsubscribe);
    vi.mocked(props.localDraftStorage.read).mockReturnValue({
      draft: {
        content: 'Recovered draft',
        contentHash: 'hash:Recovered draft',
        schemaVersion: 1,
        updatedAt: 2000
      },
      source: 'current',
      status: 'available'
    });
    const view = render(<EditorRoot {...props} />);

    expect(view.getByText('A newer local draft is available.')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Restore draft' }));

    await waitFor(() =>
      expect(props.submissionField.value).toBe('Recovered draft')
    );
    expect(view.getByText('Draft restored')).not.toBeNull();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps local draft recovery notices out of the immersive surface', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.read).mockReturnValue({
      draft: {
        content: 'Recovered draft',
        contentHash: 'hash:Recovered draft',
        schemaVersion: 1,
        updatedAt: 2000
      },
      source: 'current',
      status: 'available'
    });
    const view = render(<EditorRoot {...props} />);

    expect(view.getByText('A newer local draft is available.')).not.toBeNull();
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.queryByText('A newer local draft is available.')).toBeNull();
    expect(view.queryByRole('button', { name: 'Restore draft' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Discard draft' })).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.getByText('A newer local draft is available.')).not.toBeNull();
    expect(view.getByRole('button', { name: 'Restore draft' })).not.toBeNull();
    expect(view.getByRole('button', { name: 'Discard draft' })).not.toBeNull();
  });

  it('keeps local draft save flashes out of the immersive surface', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(view.getByText('Local draft saved 12:34')).not.toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.queryByText('Local draft saved 12:34')).toBeNull();
    expect(view.getByText('自动保存已开启')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(props.localDraftStorage.write).toHaveBeenCalledTimes(2)
    );
    expect(view.queryByText('Local draft saved 12:34')).toBeNull();
  });

  it('keeps local draft failures visible in the immersive surface', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.write).mockReturnValue({
      code: 'local-draft-write-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        props.localDrafts.strings.saveFailed
      )
    );
  });

  it('does not clear an existing local draft failure when entering immersive mode', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.write).mockReturnValue({
      code: 'local-draft-write-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        props.localDrafts.strings.saveFailed
      )
    );

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByRole('alert').textContent).toBe(
      props.localDrafts.strings.saveFailed
    );
  });

  it('schedules local drafts from the document owner without depending on native bridge events', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Bold' })).not.toBeNull()
    );
    vi.spyOn(props.submissionField, 'dispatchEvent').mockReturnValue(true);
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    await waitFor(
      () =>
        expect(props.localDraftStorage.write).toHaveBeenCalledWith(
          '**selected**'
        ),
      { timeout: 1_000 }
    );
  });

  it('copies the stable Preview through the React WeChat session', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull();
    });
    fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));

    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(1)
    );
    expect(
      view
        .getByRole('button', { name: 'Copy to WeChat' })
        .querySelectorAll('.easymde-wechat-glyph path')
    ).toHaveLength(3);
    expect(props.wechatClipboard.copy).toHaveBeenCalledWith(
      view.container.querySelector('[data-easymde-preview-html-sink="1"]'),
      expect.objectContaining({
        pngConversionEnabled: false,
        postId: props.imageUpload.postId,
        maxBytes: props.imageUpload.maxBytes
      })
    );
    expect(view.getByText('Copied')).not.toBeNull();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'copywechat',
      expect.anything()
    );
  });

  it('passes PNG export through the protected image upload owner', async () => {
    const props = fixture();
    const rasterizationPort = {
      rasterize: vi.fn()
    };
    const view = render(
      <EditorRoot
        {...props}
        wechatExport={{ ...props.wechatExport, pngConversionEnabled: true }}
        wechatVisualRasterizationPort={rasterizationPort}
      />
    );

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledOnce()
    );

    const options = vi.mocked(props.wechatClipboard.copy).mock.calls[0]?.[1];
    expect(options?.pngConversionEnabled).toBe(true);
    expect(options?.postId).toBe(props.imageUpload.postId);
    expect(options?.maxBytes).toBe(props.imageUpload.maxBytes);
    expect(options?.visualRasterizationPort).toBe(rasterizationPort);
    expect(options?.imageUploadPort).toBeDefined();

    const rawUpload = vi.mocked(props.imageUploadPort.upload);
    const uploadResult = await options?.imageUploadPort?.upload({
      altText: '',
      file: new File(['png'], 'wechat.png', { type: 'image/png' }),
      postId: props.imageUpload.postId,
      signal: new AbortController().signal
    });
    expect(uploadResult?.status).toBe('uploaded');
    expect(rawUpload).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('re-prepares the WeChat payload after a browser resize', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    await waitFor(() => expect(preparation).toHaveBeenCalled());
    const callsBeforeResize = preparation.mock.calls.length;
    act(() => props.triggerResize());

    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(callsBeforeResize)
    );
    view.unmount();
  });

  it('re-prepares the WeChat payload after preview media or font layout changes', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    await waitFor(() => expect(preparation).toHaveBeenCalled());
    const callsBeforeLayoutChange = preparation.mock.calls.length;
    act(() => props.triggerPreviewLayout());

    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(
        callsBeforeLayoutChange
      )
    );
    view.unmount();
  });

  it('re-prepares the WeChat payload after immersive layout mode changes', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    await waitFor(() => expect(preparation).toHaveBeenCalled());
    const callsBeforeImmersive = preparation.mock.calls.length;
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(
        callsBeforeImmersive
      )
    );

    const callsBeforePreview = preparation.mock.calls.length;
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(callsBeforePreview)
    );
    view.unmount();
  });

  it('prepares WeChat after an immersive article theme change only once Preview is ready', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    let pendingPreviewRequest: PreviewRequest | null = null;
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const callsBeforeThemeChange = preparation.mock.calls.length;

    // Keep the refreshed Preview unresolved until explicitly completed. The
    // old ordinary DOM must not be prepared while this request is pending.
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      pendingPreviewRequest = request;
      return pendingPreview.promise;
    });
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(preparation.mock.calls.length).toBe(callsBeforeThemeChange);
    await act(async () => {
      if (!pendingPreviewRequest)
        throw new Error('missing theme preview request');
      pendingPreview.resolve(
        createPreviewResponse(
          pendingPreviewRequest,
          '<p>Theme Preview</p>' as SafePreviewHtml,
          {}
        )
      );
    });
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(
        callsBeforeThemeChange
      )
    );
    expect(preparation.mock.calls.at(-1)?.[0]).toBe(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    );
    view.unmount();
  });

  it('prepares WeChat after an immersive Custom CSS save only once Preview is ready', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    let pendingPreviewRequest: PreviewRequest | null = null;
    const savedSnapshot = {
      customCss: [
        {
          articleThemeName: 'Writer Article',
          codeThemeName: 'Writer Code',
          css: '.note { color: navy; }',
          id: 'writer-css',
          scopedCss: '.easymde-rendered-content .note { color: navy; }'
        }
      ],
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: 'writer-css',
        markdownTheme: 'custom'
      }
    } as const;
    const appearancePort = {
      ...props.appearancePort,
      saveCustomCss: vi.fn().mockResolvedValue({
        snapshot: savedSnapshot,
        status: 'saved' as const
      })
    };
    const view = render(
      <EditorRoot {...props} appearancePort={appearancePort} />
    );
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const callsBeforeSave = preparation.mock.calls.length;

    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      pendingPreviewRequest = request;
      return pendingPreview.promise;
    });
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Custom CSS theme' }));
    fireEvent.change(
      await view.findByRole('textbox', {
        name: 'Article theme name'
      }),
      {
        target: { value: 'Writer Article' }
      }
    );
    fireEvent.click(view.getByRole('button', { name: /Custom CSS code/ }));
    fireEvent.change(view.getByRole('textbox', { name: 'Custom CSS code' }), {
      target: { value: '.note { color: navy; }' }
    });
    fireEvent.click(view.getByRole('button', { name: 'Apply theme' }));

    await waitFor(() =>
      expect(appearancePort.saveCustomCss).toHaveBeenCalled()
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(preparation.mock.calls.length).toBe(callsBeforeSave);
    await act(async () => {
      if (!pendingPreviewRequest)
        throw new Error('missing custom CSS preview request');
      pendingPreview.resolve(
        createPreviewResponse(
          pendingPreviewRequest,
          '<p>Custom CSS Preview</p>' as SafePreviewHtml,
          {}
        )
      );
    });
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(callsBeforeSave)
    );
    expect(preparation.mock.calls.at(-1)?.[0]).toBe(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    );
    view.unmount();
  });

  it('does not report background WeChat preparation as a copy failure', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    vi.mocked(prepare).mockRejectedValue(new Error('theme image unavailable'));
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => expect(prepare).toHaveBeenCalled());
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'wechat-theme-image-prepare-failed'
    );
    view.unmount();
  });

  it('does not prepare WeChat in the background when export is disabled', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const view = render(
      <EditorRoot
        {...props}
        wechatExport={{ ...props.wechatExport, enabled: false }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(props.getPreviewLayoutObservationCount()).toBe(0);
    view.unmount();
  });

  it('binds synchronized scrolling to the preview canvas and disposes it with the Root', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1)
    );
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledWith({
      preview: view.container.querySelector(
        '.easymde-immersive-preview-canvas'
      ),
      source: view.container.querySelector('.cm-scroller')
    });

    view.unmount();
    expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1);
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes pending appearance work with the Root', () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    view.unmount();

    expect(props.appearancePort.dispose).toHaveBeenCalledTimes(1);
  });

  it('rebinds a single canvas scroll owner across ordinary, split and preview modes', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(2)
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(3)
    );

    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledTimes(3);
    for (const [options] of vi.mocked(props.scrollSyncPort.prepareBinding).mock
      .calls) {
      expect(options.preview).toBe(
        view.container.querySelector('.easymde-immersive-preview-canvas')
      );
    }
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(3);
  });
});
