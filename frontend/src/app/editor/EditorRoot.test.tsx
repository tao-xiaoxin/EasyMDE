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

function fixture(): EditorRootProps &
  Readonly<{
    localDraftStorage: LocalDraftStoragePort;
    nativeForm: HTMLFormElement;
    scrollSyncBinding: Readonly<{
      activate: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }>;
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
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: '',
        markdownTheme: 'default'
      },
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
      saveCustomCss: vi
        .fn()
        .mockResolvedValue({ status: 'failed', code: 'synthetic' })
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
    immersiveStrings: {
      autoSave: '自动保存',
      autoSaveDescription: '自动保存本地草稿',
      autoSaveEnabled: '自动保存已开启',
      cancel: '取消',
      characters: '字符',
      close: '关闭',
      column: '列',
      edit: '编辑',
      editMode: '编辑模式',
      editorSettings: '编辑器设置',
      enter: '进入沉浸写作',
      exit: '退出沉浸写作',
      hideOutline: '隐藏大纲',
      history: '历史记录',
      historyEmpty: '暂无修订版本',
      historyError: '无法加载修订版本',
      historyLoading: '正在加载修订版本',
      historyAll: '全部',
      historyCount: '共 %s 条历史版本',
      historyVersions: '历史版本',
      immersive: '沉浸写作',
      insert: '插入',
      insertTable: '插入表格',
      line: '行',
      minutes: '分钟',
      manualSave: '手动保存',
      moreActions: '更多操作',
      markdown: 'Markdown',
      noHeadings: '暂无标题',
      outline: '文章大纲',
      outlineDescription: '左侧显示标题层级导航',
      preview: '预览',
      previewMode: '预览模式',
      publish: '发布文章',
      readingTime: '约',
      restore: '恢复修订版本',
      restoreConfirm: '未保存的更改将会丢失',
      restoreThisVersion: '恢复到这个版本',
      resizeOutline: '调整大纲宽度',
      saved: '已保存',
      settings: '设置',
      showOutline: '显示大纲',
      split: '分屏',
      splitMode: '分屏模式',
      splitPreview: '分屏预览',
      splitPreviewDescription: '默认显示实时预览区域',
      syncScroll: '同步滚动',
      syncScrollDescription: '编辑区和预览区联动',
      table: '表格',
      tableColumns: '列数',
      tableRows: '行数',
      theme: '主题',
      themeSettings: '主题设置',
      addTags: '添加标签',
      categories: '分类目录',
      categoriesDescription: '选择文章归属的栏目。',
      categoriesSelected: '已选 %s 项',
      closePublish: '关闭发布弹窗',
      continueAddingTags: '继续添加...',
      excerpt: '摘要',
      excerptPlaceholder: '撰写摘要...',
      featuredImage: '特色图片',
      imageRecommendation: '建议使用横向图片',
      imageRequirements: '支持 JPG、PNG、WebP',
      noWriteBeforeSubmit: '提交前不会写入 WordPress。',
      password: '密码',
      passwordPlaceholder: '输入访问密码',
      passwordRequired: '请输入访问密码后再提交。',
      preparingPublish: '准备发布',
      private: '私密',
      privateDescription: '仅站点管理员和编辑可查看此文章。',
      public: '公开',
      publishDescription: '确认文章信息后，将发布到当前 WordPress 站点。',
      remove: '移除',
      removeTag: '移除标签 %s',
      replace: '替换',
      selectFeaturedImage: '选择特色图片',
      sticky: '置于首页顶端',
      tags: '标签',
      tagsDescription: '输入后按 Enter 或逗号添加。',
      updateArticle: '更新文章',
      updateDescription: '确认本次修改后，将更新当前 WordPress 文章。',
      updateExisting: '更新已有文章',
      visibility: '可见性',
      title: '文章标题',
      unsaved: '未保存',
      viewModes: '视图模式',
      wechat: '复制到公众号',
      wordCount: '字数统计',
      wordCountDescription: '在文章标题旁显示词数、字符数与阅读时长',
      words: '词'
    },
    immersiveEnvironment: {
      activeElement: () =>
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      activateFocusBoundary: vi.fn(() => vi.fn()),
      hasOpenToolbarPopover: () => false,
      subscribeKeydown: (listener) => {
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
      }
    },
    labels: {
      preview: 'Preview',
      source: 'Markdown',
      toolbar: 'Markdown toolbar'
    },
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
    nativePublishPort: {
      apply: vi.fn(),
      read: vi.fn(() => ({
        categories: [],
        categoryIds: [],
        excerpt: '',
        featuredImage: null,
        password: '',
        published: true,
        sticky: false,
        tags: [],
        visibility: 'public' as const
      }))
    },
    nativeSubmissionPort: createWordPressNativeSubmissionPort(nativeForm),
    onDocumentOwnerChange: vi.fn(),
    onFailure: vi.fn(),
    platform: 'win',
    publishPost: vi.fn(() => true),
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
    revisionPort: {
      get: vi.fn().mockResolvedValue({
        author: 'Editor',
        dateLabel: 'Today',
        html: '<p>Revision</p>' as SafePreviewHtml,
        id: 12,
        restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12'
      }),
      list: vi.fn().mockResolvedValue([
        {
          author: 'Editor',
          dateLabel: 'Today',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12'
        }
      ])
    },
    restoreRevision: vi.fn(),
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
      commands: [
        {
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          placeholder: 'bold text',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        },
        {
          action: 'image',
          group: 'insert',
          icon: 'format-image',
          id: 'image',
          label: 'Image',
          surface: 'main'
        },
        {
          action: 'copyWechat',
          group: 'export',
          icon: 'clipboard',
          id: 'copywechat',
          label: 'Copy to WeChat',
          surface: 'main'
        }
      ],
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
  Object.defineProperty(event, 'clipboardData', {
    value: 'paste' === type ? transfer : null
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: 'drop' === type ? transfer : null
  });
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

    expect(
      view.container.querySelectorAll('[data-easymde-editor-owner="react"]')
    ).toHaveLength(1);
    expect(props.submissionField.hidden).toBe(true);
    expect(props.onDocumentOwnerChange).toHaveBeenCalledWith(true);
    expect(view.container.querySelector('.cm-editor')).not.toBeNull();
    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
          ?.innerHTML
      ).toBe('<p>Rendered</p>');
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
        'button[data-easymde-command], .easymde-toolbar-section-secondary > button, ' +
          '.easymde-toolbar-section-secondary > .easymde-toolbar-popover-anchor > button'
      )
    ).map((button) => button.getAttribute('aria-label'));

    expect(labels).toEqual([
      'Bold',
      'Image',
      'Copy to WeChat',
      '进入沉浸写作',
      'Font',
      'Appearance'
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

  it('recomposes the existing source and preview owners in immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(view.getByRole('button', { name: '进入沉浸写作' })).not.toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('.easymde-pane-preview')
    ).toHaveLength(1);

    fireEvent.click(view.getByRole('button', { name: '预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull();
  });

  it('keeps publish editing local until confirmation then delegates to the native publisher', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '发布文章' }));
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '取消' }));
    expect(view.queryByRole('dialog', { name: '更新文章' })).toBeNull();
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '发布文章' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    expect(props.nativePublishPort.apply).toHaveBeenCalledOnce();
    expect(props.publishPost).toHaveBeenCalledOnce();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'savepost',
      expect.anything()
    );
  });

  it('restores the native publish fields when the WordPress submit command is unavailable', async () => {
    const props = fixture();
    vi.mocked(props.publishPost).mockReturnValue(false);
    const original = props.nativePublishPort.read();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '发布文章' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    expect(props.nativePublishPort.apply).toHaveBeenCalledTimes(2);
    expect(props.nativePublishPort.apply).toHaveBeenLastCalledWith(original);
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-command-unavailable'
    );
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
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

  it('layers Escape handling and restores focus to the immersive entry after exit', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const entry = await view.findByRole('button', { name: '进入沉浸写作' });
    entry.focus();
    fireEvent.click(entry);
    expect(props.immersiveEnvironment.activateFocusBoundary).toHaveBeenCalledWith(
      view.container.querySelector('.easymde-editor')
    );
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
  });

  it('matches the reference immersive control inventory without AI controls', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.getByRole('button', { name: '编辑模式' })).not.toBeNull();
    expect(view.getByRole('button', { name: '分屏模式' })).not.toBeNull();
    expect(view.getByRole('button', { name: '预览模式' })).not.toBeNull();
    expect(view.getAllByRole('button', { name: '退出沉浸写作' })).toHaveLength(1);
    expect(
      view.container.querySelector('.easymde-immersive-header .easymde-immersive-exit')
    ).toBeNull();
    expect(view.queryByRole('button', { name: /AI/u })).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(view.getByRole('dialog', { name: '编辑器设置' })).not.toBeNull();
    for (const name of ['文章大纲', '字数统计', '分屏预览', '自动保存', '同步滚动']) {
      expect((view.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(true);
    }
    expect(view.queryByText(/AI/u)).toBeNull();
  });

  it('applies immersive settings to the real outline, statistics, draft and scroll owners', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    fireEvent.click(view.getByRole('checkbox', { name: '文章大纲' }));
    fireEvent.click(view.getByRole('checkbox', { name: '字数统计' }));
    fireEvent.click(view.getByRole('checkbox', { name: '自动保存' }));
    fireEvent.click(view.getByRole('checkbox', { name: '同步滚动' }));

    expect(view.queryByRole('complementary', { name: '文章大纲' })).toBeNull();
    expect(view.container.querySelector('.easymde-immersive-stats')).toBeNull();
    expect(view.queryByText('自动保存已开启')).toBeNull();
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledOnce();
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

  it('keeps exactly one React toolbar popover open', async () => {
    const props = fixture();
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading1',
          label: 'Heading 1',
          level: 1,
          surface: 'heading-menu'
        }
      ]
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
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

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
      expect(
        vi.mocked(props.enhancementPort.enhance).mock.calls.at(-1)?.[3]
      ).toEqual(expect.objectContaining({ codeTheme: 'github' }));
    });
  });

  it('applies theme classes and theme font defaults to the single Preview sink', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) =>
        'newsprint' === theme.id
          ? {
              fontDefaults: {
                appleFont: 'new-york',
                customFont: 'inter',
                serifFont: 'on',
                windowsFont: 'segoe-ui'
              },
              id: 'newsprint',
              label: 'Newsprint'
            }
          : theme
      )
    };
    const fonts = {
      ...props.fonts,
      options: {
        appleFonts: [
          ...props.fonts.options.appleFonts,
          {
            fontFamily: '"New York"',
            id: 'new-york',
            label: 'New York'
          }
        ],
        customFonts: [
          ...props.fonts.options.customFonts,
          {
            fontFamily: 'Inter, sans-serif',
            id: 'inter',
            label: 'Inter'
          }
        ],
        serifOptions: [
          ...props.fonts.options.serifOptions,
          {
            fontFamily: 'Georgia, serif',
            id: 'on',
            label: 'On'
          }
        ],
        windowsFonts: [
          ...props.fonts.options.windowsFonts,
          {
            fontFamily: '"Segoe UI"',
            id: 'segoe-ui',
            label: 'Segoe UI'
          }
        ]
      }
    };
    const view = render(
      <EditorRoot {...props} appearance={appearance} fonts={fonts} />
    );

    fireEvent.click(view.getByRole('button', { name: 'Appearance' }));
    fireEvent.change(view.getByLabelText('Article theme'), {
      target: { value: 'theme:newsprint' }
    });

    await waitFor(() => {
      expect(props.fontControlsPort.applyState).toHaveBeenCalledWith(
        appearance.articleThemes[1]?.fontDefaults
      );
    });
    const sink = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    expect(sink?.classList.contains('easymde-markdown-theme-newsprint')).toBe(
      true
    );
    expect(sink?.classList.contains('easymde-code-theme-atom-one-dark')).toBe(
      true
    );
    expect(sink?.style.getPropertyValue('--easymde-content-font-family')).toBe(
      'Inter, sans-serif, "Segoe UI", "New York", Georgia, serif'
    );
  });

  it('routes Preview enhancement diagnostics through the Root failure owner', async () => {
    const props = fixture();
    vi.mocked(props.enhancementPort.enhance).mockRejectedValue(
      new Error('preview-enhancement-resource-load-failed')
    );

    render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      );
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
      expect(props.submissionField.value).toBe(
        '![Selected image](https://example.test/selected.png)'
      );
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
        '![uploaded image](https://example.test/upload.png)'
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
      view.container.querySelector('[data-easymde-preview-html-sink="1"]')
    );
    expect(view.getByText('Copied')).not.toBeNull();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'copywechat',
      expect.anything()
    );
  });

  it('activates synchronized scrolling once and disposes it with the Root', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1)
    );
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledWith({
      preview: view.container.querySelector(
        '[data-easymde-preview-html-sink="1"]'
      ),
      source: view.container.querySelector('.cm-scroller')
    });

    view.unmount();
    expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1);
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(1);
  });
});
