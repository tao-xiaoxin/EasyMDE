import { createElement } from '@wordpress/element';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../contracts/ports/preview-request';
import type { ImageUploadResult } from '../../contracts/ports/image-upload-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type {
  EditorSessionPort,
  EditorSessionStatus
} from '../../contracts/ports/editor-session-port';
import type { PreparedToolbarShortcutBinding } from '../../contracts/ports/toolbar-shortcuts-port';
import { createWordPressNativeSubmissionPort } from '../../integrations/wordpress/native-form/wordpress-native-submission';
import { EditorRoot, type EditorRootProps } from './EditorRoot';
import { EditorRootErrorBoundary } from './EditorRootErrorBoundary';

const mountedFields: Array<HTMLElement> = [];

function BrokenEditorRoot(): never {
  throw new Error('synthetic editor-root render failure');
}

function fixture(): EditorRootProps & Readonly<{
  localDraftStorage: LocalDraftStoragePort;
  nativeForm: HTMLFormElement;
  scrollSyncBinding: Readonly<{ activate: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>;
  shortcutBinding: PreparedToolbarShortcutBinding;
  sessionEmit: (status: EditorSessionStatus) => void;
}> {
  const submissionField = document.createElement('textarea');
  const titleField = document.createElement('input');
  const nativeForm = document.createElement('form');
  submissionField.value = 'selected';
  submissionField.defaultValue = 'selected';
  submissionField.setSelectionRange(0, 8);
  titleField.value = 'Synthetic title';
  titleField.defaultValue = 'Synthetic title';
  nativeForm.append(submissionField, titleField);
  document.body.append(nativeForm);
  mountedFields.push(nativeForm);
  const shortcutBinding = {
    activate: vi.fn(),
    dispose: vi.fn()
  };
  const mediaFrame = {
    close: () => undefined,
    open: vi.fn(),
    select: (_attachment: unknown) => undefined
  };
  mediaFrame.open.mockImplementation((options) => {
    mediaFrame.close = options.onClose;
    mediaFrame.select = options.onSelect;
  });
  const localDraftStorage: LocalDraftStoragePort = {
    discard: vi.fn(() => ({ status: 'discarded' as const })),
    fingerprint: vi.fn((content) => `hash:${content}`),
    formatTime: vi.fn(() => ({ status: 'formatted' as const, value: '12:34' })),
    read: vi.fn(() => ({ status: 'missing' as const })),
    subscribe: vi.fn(() => vi.fn()),
    write: vi.fn(() => ({ status: 'saved' as const, updatedAt: 1234 }))
  };
  const scrollSyncBinding = { activate: vi.fn(), dispose: vi.fn() };
  const sessionListeners = new Set<() => void>();
  let sessionSnapshot = { status: 'ready' as EditorSessionStatus };
  const sessionPort: EditorSessionPort = {
    getSnapshot: () => sessionSnapshot,
    subscribe: vi.fn((listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    })
  };

  return {
    appearance: {
      articleThemes: [
        { id: 'default', label: 'Default' },
        { id: 'newsprint', label: 'Newsprint' }
      ],
      codeThemes: [
        { id: 'atom-one-dark', label: 'Atom One Dark' },
        { id: 'github', label: 'GitHub' }
      ],
      customCss: [],
      state: { codeTheme: 'atom-one-dark', customCssId: '', markdownTheme: 'default' },
      strings: {
        appearance: 'Appearance',
        articleTheme: 'Article theme',
        codeTheme: 'Code theme',
        cssName: 'CSS name',
        cssSaveFailed: 'CSS save failed',
        cssSaved: 'CSS saved',
        customCss: 'Custom CSS',
        namedCustomCss: 'Named CSS',
        saveCss: 'Save CSS'
      }
    },
    appearancePort: {
      applyState: vi.fn(),
      closeOtherPopovers: vi.fn(),
      saveCustomCss: vi.fn().mockResolvedValue({ status: 'failed', code: 'synthetic' })
    },
    document: { editorLabel: 'Markdown source' },
    enhancementPort: { enhance: vi.fn().mockResolvedValue(undefined) },
    executeExternalCommand: vi.fn(),
    fontControlsPort: { applyState: vi.fn(), closeOtherPopovers: vi.fn() },
    fonts: {
      options: {
        appleFonts: [{ fontFamily: '', id: 'system', label: 'System' }],
        customFonts: [{ fontFamily: '', id: 'none', label: 'None' }],
        serifOptions: [{ fontFamily: '', id: 'off', label: 'Off' }],
        windowsFonts: [{ fontFamily: '', id: 'system', label: 'System' }]
      },
      state: {
        appleFont: 'system',
        customFont: 'none',
        serifFont: 'off',
        windowsFont: 'system'
      },
      strings: {
        appleFont: 'Apple font',
        customFont: 'Custom font',
        font: 'Font',
        fontStackHelp: 'Font stack help',
        serifFont: 'Serif',
        windowsFont: 'Windows font'
      }
    },
    labels: { preview: 'Preview', source: 'Markdown', toolbar: 'Markdown toolbar' },
    imageUpload: {
      enabled: true,
      maxBytes: 1024,
      postId: 7,
      strings: {
        defaultAlt: 'image',
        dropFailed: 'Drop failed',
        dropTooLarge: 'Drop too large',
        dropUploaded: 'Drop uploaded',
        dropUploading: 'Drop uploading',
        pasteFailed: 'Paste failed',
        pasteTooLarge: 'Paste too large',
        pasteUploaded: 'Paste uploaded',
        pasteUploading: 'Paste uploading'
      }
    },
    imageUploadPort: {
      upload: vi.fn().mockResolvedValue({
        alt: 'uploaded image',
        status: 'uploaded',
        url: 'https://example.test/upload.png'
      } satisfies ImageUploadResult)
    },
    layout: { direction: 'ltr' },
    localDraftStorage,
    localDrafts: {
      enabled: true,
      locale: 'en_US',
      maxBytes: 1048576,
      postId: 7,
      savedFingerprint: 'hash:selected',
      schemaVersion: 1,
      siteKey: 'synthetic-site',
      strings: {
        available: 'A newer local draft is available.',
        conflict: 'A different local draft was saved in another tab.',
        discard: 'Discard draft',
        discardFailed: 'Discard failed',
        discarded: 'Draft discarded',
        readFailed: 'Draft read failed',
        restore: 'Restore draft',
        restored: 'Draft restored',
        saveFailed: 'Draft save failed',
        saved: 'Local draft saved'
      },
      timeZone: 'UTC',
      userId: 42
    },
    mediaPicker: {
      defaultAlt: 'image',
      insertMedia: 'Insert Media',
      placeholderAlt: 'alt text'
    },
    mediaPickerFailureMessage: 'The media library could not be opened.',
    mediaPickerFrame: mediaFrame,
    nativeForm,
    nativeSubmissionPort: createWordPressNativeSubmissionPort(nativeForm),
    onDocumentOwnerChange: vi.fn(),
    onFailure: vi.fn(),
    platform: 'win',
    prepareToolbarShortcuts: vi.fn(() => ({
      prepareBinding: vi.fn(() => shortcutBinding)
    })),
    preview: {
      features: {},
      html: '<p>Initial</p>' as SafePreviewHtml,
      messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
      postId: 7,
      signature: 'initial'
    },
    previewPort: {
      render: vi.fn().mockResolvedValue({
        features: {},
        html: '<p>Rendered</p>' as SafePreviewHtml
      })
    },
    scrollPort: {
      capture: () => ({ left: 0, ratio: 0, top: 0 }),
      restore: vi.fn()
    },
    scrollSyncBinding,
    scrollSyncPort: {
      prepareBinding: vi.fn(() => scrollSyncBinding)
    },
    sessionEmit: (status) => {
      sessionSnapshot = { status };
      for (const listener of sessionListeners) listener();
    },
    sessionPort,
    shortcutBinding,
    submissionField,
    titleField,
    toolbar: {
      commands: [{
        action: 'wrap',
        group: 'format',
        icon: 'editor-bold',
        id: 'bold',
        label: 'Bold',
        placeholder: 'bold text',
        prefix: '**',
        suffix: '**',
        surface: 'main'
      }, {
        action: 'image',
        group: 'insert',
        icon: 'format-image',
        id: 'image',
        label: 'Image',
        surface: 'main'
      }, {
        action: 'copyWechat',
        group: 'export',
        icon: 'clipboard',
        id: 'copywechat',
        label: 'Copy to WeChat',
        surface: 'main'
      }],
      headingsLabel: 'Headings',
      linkText: 'link text',
      shortcuts: { bold: { mac: 'Cmd+B', win: 'Ctrl+B' } }
    },
    wechatClipboard: {
      copy: vi.fn().mockResolvedValue({ method: 'clipboard', status: 'copied' })
    },
    wechatExport: {
      enabled: true,
      strings: {
        failed: 'Copy failed',
        success: 'Copied',
        unsupported: 'Clipboard unsupported'
      }
    }
  };
}

function imageTransferEvent(type: 'drop' | 'paste', file: File): Event {
  const transfer = {
    dropEffect: 'move',
    files: [file],
    items: [{ getAsFile: () => file, kind: 'file', type: file.type }]
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: 'paste' === type ? transfer : null });
  Object.defineProperty(event, 'dataTransfer', { value: 'drop' === type ? transfer : null });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const field of mountedFields.splice(0)) {
    field.remove();
  }
});

describe('EditorRoot', () => {
  it('composes source, toolbar and preview under one React owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    expect(view.container.querySelectorAll('[data-easymde-editor-owner="react"]')).toHaveLength(1);
    expect(props.submissionField.hidden).toBe(true);
    expect(props.onDocumentOwnerChange).toHaveBeenCalledWith(true);
    expect(view.container.querySelector('.cm-editor')).not.toBeNull();
    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(view.container.querySelector('[data-easymde-preview-html-sink="1"]')?.innerHTML)
        .toBe('<p>Rendered</p>');
    });
    expect(props.shortcutBinding.activate).toHaveBeenCalledTimes(1);

    const bold = view.container.querySelector<HTMLButtonElement>('[data-easymde-command="bold"]');
    expect(bold).not.toBeNull();
    await act(async () => {
      fireEvent.click(bold as HTMLButtonElement);
    });
    expect(props.submissionField.value).toBe('**selected**');

    const image = view.container.querySelector<HTMLButtonElement>('[data-easymde-command="image"]');
    expect(image).not.toBeNull();
    await act(async () => {
      fireEvent.click(image as HTMLButtonElement);
    });
    expect(props.mediaPickerFrame?.open).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(props.submissionField.hidden).toBe(false);
    expect(props.onDocumentOwnerChange).toHaveBeenLastCalledWith(false);
    expect(props.shortcutBinding.dispose).toHaveBeenCalledTimes(1);
  });

  it('matches the ordinary toolbar order without immersive, React Publish or History', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => expect(view.getByRole('button', { name: 'Bold' })).not.toBeNull());
    const toolbar = view.getByRole('toolbar', { name: 'Markdown toolbar' });
    const labels = Array.from(toolbar.querySelectorAll(
      'button[data-easymde-command], .easymde-toolbar-section-secondary > button, '
      + '.easymde-toolbar-section-secondary > .easymde-toolbar-popover-anchor > button'
    )).map(
      (button) => button.getAttribute('aria-label')
    );

    expect(labels).toEqual([
      'Bold',
      'Image',
      'Copy to WeChat',
      'Font',
      'Appearance'
    ]);
    expect(
      toolbar.querySelectorAll('.easymde-toolbar-section-secondary > .easymde-toolbar-divider')
    ).toHaveLength(1);
    expect(view.queryByRole('button', { name: 'History' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(view.container.querySelector('[data-easymde-command="immersive"]')).toBeNull();
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
      changes: { from: 0, to: editor.state.doc.length, insert: 'current editor value' }
    });
    props.submissionField.value = 'stale native value';
    props.nativeForm.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(props.submissionField.value).toBe('current editor value');

    view.unmount();
    props.submissionField.value = 'after teardown';
    props.nativeForm.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(props.submissionField.value).toBe('after teardown');
  });

  it('tracks the WordPress session and blocks new protected native and React operations', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    editor?.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: 'unsaved session value' }
    });
    props.submissionField.value = 'preserved unsaved value';

    act(() => props.sessionEmit('locked'));

    expect(view.container.querySelector('[data-easymde-editor-owner="react"]')
      ?.getAttribute('data-easymde-session-status')).toBe('locked');
    const nativeEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    expect(props.nativeForm.dispatchEvent(nativeEvent)).toBe(false);
    expect(props.submissionField.value).toBe('preserved unsaved value');

    expect(props.onFailure).toHaveBeenCalledWith('editor-session-locked');

    act(() => props.sessionEmit('authentication-required'));
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    await waitFor(() => expect(props.mediaPickerFrame?.open).not.toHaveBeenCalled());
    expect(props.submissionField.value).toBe('preserved unsaved value');
  });

  it('keeps the dirty baseline and recovery data until WordPress confirms persistence on the next bootstrap', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'not persisted' } });
    await waitFor(() => expect(props.localDraftStorage.write).toHaveBeenCalledWith('not persisted'));

    props.nativeForm.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    expect(props.localDraftStorage.discard).not.toHaveBeenCalled();
  });

  it('reports a render failure without leaving a partial editor owner', () => {
    const props = fixture();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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

      expect(props.onFailure).toHaveBeenCalledWith('react-editor-render-failed');
      expect(view.getByRole('alert').textContent).toBe('The editor could not start.');
    } finally {
      window.removeEventListener('error', preventSyntheticError);
      consoleError.mockRestore();
    }
  });

  it('keeps exactly one React toolbar popover open', async () => {
    const props = fixture();
    const toolbar = {
      ...props.toolbar,
      commands: [...props.toolbar.commands, {
        action: 'heading',
        group: 'heading',
        icon: 'heading',
        id: 'heading1',
        label: 'Heading 1',
        level: 1,
        surface: 'heading-menu'
      }]
    } as const;
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    const heading = view.getByRole('button', { name: 'Headings' });
    const appearance = view.getByRole('button', { name: 'Appearance' });
    const fonts = view.getByRole('button', { name: 'Font' });

    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(appearance);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(appearance.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(fonts);
    expect(appearance.getAttribute('aria-expanded')).toBe('false');
    expect(fonts.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(appearance);
    expect(fonts.getAttribute('aria-expanded')).toBe('false');
    expect(appearance.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(appearance);
  });

  it('renders Preview from the current Appearance state', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await waitFor(() => expect(props.previewPort.render).toHaveBeenCalledTimes(1));

    fireEvent.click(view.getByRole('button', { name: 'Appearance' }));
    fireEvent.change(view.getByLabelText('Article theme'), {
      target: { value: 'theme:newsprint' }
    });

    await waitFor(() => {
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      );
    });

    fireEvent.change(view.getByLabelText('Code theme'), {
      target: { value: 'github' }
    });
    await waitFor(() => {
      expect(vi.mocked(props.enhancementPort.enhance).mock.calls.at(-1)?.[3])
        .toEqual(expect.objectContaining({ codeTheme: 'github' }));
    });
  });

  it('applies theme classes and theme font defaults to the single Preview sink', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) =>
        'newsprint' === theme.id ? {
          fontDefaults: {
            appleFont: 'new-york',
            customFont: 'inter',
            serifFont: 'on',
            windowsFont: 'segoe-ui'
          },
          id: 'newsprint',
          label: 'Newsprint'
        } : theme
      )
    };
    const fonts = {
      ...props.fonts,
      options: {
        appleFonts: [...props.fonts.options.appleFonts, {
          fontFamily: '"New York"', id: 'new-york', label: 'New York'
        }],
        customFonts: [...props.fonts.options.customFonts, {
          fontFamily: 'Inter, sans-serif', id: 'inter', label: 'Inter'
        }],
        serifOptions: [...props.fonts.options.serifOptions, {
          fontFamily: 'Georgia, serif', id: 'on', label: 'On'
        }],
        windowsFonts: [...props.fonts.options.windowsFonts, {
          fontFamily: '"Segoe UI"', id: 'segoe-ui', label: 'Segoe UI'
        }]
      }
    };
    const view = render(<EditorRoot {...props} appearance={appearance} fonts={fonts} />);

    fireEvent.click(view.getByRole('button', { name: 'Appearance' }));
    fireEvent.change(view.getByLabelText('Article theme'), {
      target: { value: 'theme:newsprint' }
    });

    await waitFor(() => {
      expect(props.fontControlsPort.applyState).toHaveBeenCalledWith(
        appearance.articleThemes[1]?.fontDefaults
      );
    });
    const sink = view.container.querySelector<HTMLElement>('[data-easymde-preview-html-sink="1"]');
    expect(sink?.classList.contains('easymde-markdown-theme-newsprint')).toBe(true);
    expect(sink?.classList.contains('easymde-code-theme-atom-one-dark')).toBe(true);
    expect(sink?.style.getPropertyValue('--easymde-content-font-family'))
      .toBe('Inter, sans-serif, "Segoe UI", "New York", Georgia, serif');
  });

  it('routes Preview enhancement diagnostics through the Root failure owner', async () => {
    const props = fixture();
    vi.mocked(props.enhancementPort.enhance)
      .mockRejectedValue(new Error('preview-enhancement-resource-load-failed'));

    render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(props.onFailure)
        .toHaveBeenCalledWith('preview-enhancement-resource-load-failed');
    });
  });

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
      expect(props.submissionField.value)
        .toBe('![Selected image](https://example.test/selected.png)');
    });
    expect(props.executeExternalCommand).not.toHaveBeenCalled();
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
      expect(view.getByText('The media library could not be opened.')).not.toBeNull();
      expect(props.onFailure).toHaveBeenCalledWith('media-picker-operation-failed');
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
      expect(props.submissionField.value)
        .toBe('![uploaded image](https://example.test/upload.png)');
    });

    view.unmount();
    const afterUnmount = imageTransferEvent(
      'paste',
      new File(['image'], 'ignored.png', { type: 'image/png' })
    );
    source?.dispatchEvent(afterUnmount);
    expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(1);
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

    await waitFor(() => expect(props.submissionField.value).toBe('Recovered draft'));
    expect(view.getByText('Draft restored')).not.toBeNull();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('schedules local drafts from the document owner without depending on native bridge events', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => expect(view.getByRole('button', { name: 'Bold' })).not.toBeNull());
    vi.spyOn(props.submissionField, 'dispatchEvent').mockReturnValue(true);
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    await waitFor(
      () => expect(props.localDraftStorage.write).toHaveBeenCalledWith('**selected**'),
      { timeout: 1_000 }
    );
  });

  it('copies the stable Preview through the React WeChat session', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(view.container.querySelector('[data-easymde-preview-html-sink="1"]')).not.toBeNull();
    });
    fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));

    await waitFor(() => expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(1));
    expect(
      view.getByRole('button', { name: 'Copy to WeChat' })
        .querySelectorAll('.easymde-wechat-glyph path')
    ).toHaveLength(3);
    expect(props.wechatClipboard.copy).toHaveBeenCalledWith(
      view.container.querySelector('[data-easymde-preview-html-sink="1"]')
    );
    expect(view.getByText('Copied')).not.toBeNull();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith('copywechat', expect.anything());
  });

  it('activates synchronized scrolling once and disposes it with the Root', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1));
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledWith({
      preview: view.container.querySelector('[data-easymde-preview-html-sink="1"]'),
      source: view.container.querySelector('.cm-scroller')
    });

    view.unmount();
    expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1);
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(1);
  });
});
