import { createElement } from '@wordpress/element';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { ImageUploadResult } from '../../contracts/ports/image-upload-port';
import type { ImmersivePreferences } from '../../contracts/ports/immersive-preferences-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type {
  RevisionPreview,
  RevisionSummary
} from '../../contracts/ports/revision-port';
import type {
  EditorSessionAutosavePreparationResult,
  EditorSessionPort,
  EditorSessionStatus
} from '../../contracts/ports/editor-session-port';
import type { PreparedToolbarShortcutBinding } from '../../contracts/ports/toolbar-shortcuts-port';
import { createWordPressNativeSubmissionPort } from '../../integrations/wordpress/native-form/wordpress-native-submission';
import { EditorRoot, type EditorRootProps } from './EditorRoot';
import { EditorRootErrorBoundary } from './EditorRootErrorBoundary';

const mountedFields: Array<HTMLElement> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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
    sessionAutosave: () => EditorSessionAutosavePreparationResult;
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
  const sessionAutosaveListeners = new Set<
    () => EditorSessionAutosavePreparationResult
  >();
  let sessionSnapshot = { status: 'ready' as EditorSessionStatus };
  const sessionPort: EditorSessionPort = {
    getSnapshot: () => sessionSnapshot,
    subscribeBeforeAutosave: vi.fn((listener) => {
      sessionAutosaveListeners.add(listener);
      return () => sessionAutosaveListeners.delete(listener);
    }),
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
        customCssTheme: 'Custom CSS theme',
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
    enhancementPort: {
      dispose: vi.fn(),
      enhance: vi.fn().mockResolvedValue(undefined)
    },
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
      articleOutline: '文章大纲',
      cancel: '取消',
      close: '关闭',
      column: '列',
      edit: '编辑',
      editMode: '编辑模式',
      editorSettings: '编辑器设置',
      enter: '进入沉浸写作',
      expand: '展开',
      exit: '退出沉浸写作',
      hideOutline: '收起大纲',
      history: '历史记录',
      historyEmpty: '暂无修订版本',
      historyError: '无法加载修订版本',
      historyLoading: '正在加载修订版本',
      historyAll: '全部',
      historyVersions: '历史版本',
      immersive: '沉浸写作',
      insert: '插入',
      insertTable: '插入表格',
      line: '行',
      manualSave: '手动保存',
      moreActions: '更多操作',
      markdown: 'Markdown',
      noHeadings: '暂无标题',
      outline: '文章大纲',
      outlineDescription: '左侧显示标题层级导航',
      preview: '预览',
      previewContentLoaded: '内容已载入',
      previewChangesRecorded: '更改已记录',
      previewEditable: '可编辑',
      previewEditorLabel: '可视化文章编辑器',
      previewLockReadOnly: '锁定为只读',
      previewReadOnly: '只读',
      previewUnlockEdit: '解除锁定并编辑',
      previewMode: '预览模式',
      publish: '发布文章',
      restore: '恢复修订版本',
      restoreConfirm: '未保存的更改将会丢失',
      restoreThisVersion: '恢复到这个版本',
      resizeOutline: '调整大纲宽度',
      resizeSplit: '调整编辑区和预览区宽度',
      saved: '已保存',
      settings: '设置',
      showOutline: '展开大纲',
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
      collapse: '收起',
      continueAddingTags: '继续添加...',
      excerpt: '摘要',
      excerptPlaceholder: '撰写摘要...',
      featuredImage: '特色图片',
      imageRecommendation: '建议使用横向图片',
      imageRequirements: '支持 JPG、PNG、WebP 格式，最大 5MB',
      noWriteBeforeSubmit: '提交前不会写入 WordPress。',
      openAfterPublish: '发布后打开文章页面',
      openAfterPublishDescription: '提交完成后跳转到文章页面，正文样式与当前预览一致。',
      openAfterUpdate: '更新后打开文章页面',
      password: '密码',
      passwordPlaceholder: '输入访问密码',
      passwordRequired: '请输入访问密码后再提交。',
      preparingPublish: '准备发布',
      private: '私密',
      privateDescription: '仅站点管理员和编辑可查看此文章。',
      public: '公开',
      publishDescription: '确认文章信息后，将发布到当前 WordPress 站点。',
      publishFailed: 'WordPress 未接受发布请求，请检查页面状态后重试。',
      publishLoadingPreview: '加载预览中...',
      publishOptions: '发布选项',
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
      wechatCopied: '已复制',
      wordCount: '字数统计',
      wordCountDescription: '在文章标题旁显示词数、字符数与阅读时长'
    },
    immersiveEnvironment: {
      activeElement: () =>
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      activateFavicon: vi.fn(() => vi.fn()),
      activateFocusBoundary: vi.fn(() => vi.fn()),
      hasOpenToolbarPopover: () => false,
      schedule: (callback, delay) => {
        const timer = window.setTimeout(callback, delay);
        return () => window.clearTimeout(timer);
      },
      subscribeKeydown: (listener) => {
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
      }
    },
    immersiveI18n: {
      characters: (count) => `${count} 字符`,
      readingTime: (minutes) => `约 ${minutes} 分钟`,
      revisions: (count) => `共 ${count} 条历史版本`,
      words: (count) => `${count} 词`
    },
    immersivePreferencesPort: {
      read: vi.fn(() => ({ status: 'missing' as const })),
      write: vi.fn(() => ({ status: 'saved' as const }))
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
        availableFields: {
          categories: true,
          excerpt: true,
          featuredImage: true,
          sticky: true,
          tags: true,
          visibility: true
        },
        categories: [],
        categoryIds: [],
        excerpt: '',
        featuredImage: null,
        openPreview: false,
        password: '',
        existing: true,
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
    sessionAutosave: () => {
      for (const listener of sessionAutosaveListeners) {
        if ('blocked' === listener()) return 'blocked';
      }
      return 'continue';
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
      headingLabelFormat: 'Heading %s',
      headingLevelLabel: 'Heading level',
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
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
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
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(view.getByRole('button', { name: '进入沉浸写作' })).not.toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('.easymde-pane-preview')
    ).toHaveLength(1);
    expect(
      view.container.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    const previewPane = view.container.querySelector('.easymde-pane-preview');
    expect(
      previewPane?.classList.contains('easymde-immersive-preview-surface')
    ).toBe(true);
    expect(
      previewPane?.querySelector('.easymde-immersive-preview-canvas')
    ).not.toBeNull();
    expect(
      previewPane?.querySelector(
        '.easymde-immersive-preview-page > [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();
    const previewSink = previewPane?.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink]'
    );
    expect(
      previewSink?.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    expect(
      previewSink?.classList.contains('easymde-font-overrides')
    ).toBe(false);
    expect(
      previewPane?.querySelector('.easymde-immersive-preview-status')
    ).not.toBeNull();
    expect(
      view.queryByRole('separator', {
        name: '调整编辑区和预览区宽度'
      })
    ).toBeNull();
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).toBeNull();
    expect(view.queryByRole('button', { name: '收起大纲' })).toBeNull();
    expect(view.queryByRole('button', { name: '展开大纲' })).toBeNull();
    expect(
      view.queryByRole('separator', { name: '调整大纲宽度' })
    ).toBeNull();
    expect(
      view.container.querySelectorAll('[data-easymde-preview-html-sink]')
    ).toHaveLength(1);
    await waitFor(() =>
      expect(
        previewPane?.querySelector('[data-easymde-preview-html-sink] p')
          ?.textContent
      ).toBe('Rendered')
    );
    const scrollDisposeCount =
      props.scrollSyncBinding.dispose.mock.calls.length;
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(
      scrollDisposeCount
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    visualEditor.innerHTML = '<p>Changed visually</p><p>Body</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        'Changed visually\n\nBody'
      )
    );
    expect(view.getByText('更改已记录')).not.toBeNull();
    expect(
      view.getByRole('button', { name: '锁定为只读' })
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('[data-easymde-preview-html-sink]')
    ).toHaveLength(1);
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).toBeNull();
    expect(props.enhancementPort.dispose).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    expect(props.mediaPickerFrame?.open).toHaveBeenCalledTimes(1);
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull();
    expect(
      view.container.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();
  });

  it('keeps the themed paper visible without exposing a rendering placeholder', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation(
      () => pendingPreview.promise
    );
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Rendering')).toBeNull();
    expect(
      view.container.querySelector(
        '.easymde-immersive-preview-page [data-easymde-preview-html-sink]'
      )?.textContent
    ).toContain('Initial');
  });

  it('unlocks an empty Markdown document as an editable themed paper', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() =>
      expect(unlock.hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(unlock);

    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.innerHTML).toBe('<p><br></p>');
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);

    visualEditor.innerHTML = '<p>First visual paragraph</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('First visual paragraph')
    );

    fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
    await waitFor(() =>
      expect(
        view.getByRole('button', { name: '解除锁定并编辑' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
  });

  it('synchronizes visual typing immediately without duplicating the native submission write', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>selected</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    visualEditor.innerHTML = '<p>First visual value</p>';
    fireEvent.input(visualEditor);
    expect(props.submissionField.value).toBe('First visual value');
    expect(canonicalInput).toHaveBeenCalledOnce();

    visualEditor.innerHTML = '<p>Final visual value</p>';
    fireEvent.input(visualEditor);
    expect(props.submissionField.value).toBe('Final visual value');
    expect(canonicalInput).toHaveBeenCalledTimes(2);

    visualEditor.innerHTML = '<p>Submitted visual value</p>';
    fireEvent.input(visualEditor);
    expect(props.submissionField.value).toBe('Submitted visual value');
    expect(canonicalInput).toHaveBeenCalledTimes(3);

    const submitEvent = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true
    });
    act(() => {
      expect(props.nativeForm.dispatchEvent(submitEvent)).toBe(true);
    });
    expect(props.submissionField.value).toBe('Submitted visual value');
    expect(canonicalInput).toHaveBeenCalledTimes(3);
    props.submissionField.removeEventListener('input', canonicalInput);
  });

  it('synchronizes visual input to the canonical field before browser navigation can inspect dirty state', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>selected</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    visualEditor.innerHTML = '<p>Navigation-safe visual value</p>';
    fireEvent.input(visualEditor);

    expect(props.submissionField.value).toBe('Navigation-safe visual value');
    expect(canonicalInput).toHaveBeenCalledOnce();
    props.submissionField.removeEventListener('input', canonicalInput);
  });

  it('flushes pending visual Markdown before WordPress autosave without leaving visual editing', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>selected</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });

    vi.useFakeTimers();
    try {
      visualEditor.innerHTML = '<p>Heartbeat visual value</p>';
      fireEvent.input(visualEditor);
      expect(props.submissionField.value).toBe('Heartbeat visual value');

      expect(props.sessionAutosave()).toBe('continue');
      expect(props.submissionField.value).toBe('Heartbeat visual value');
      expect(
        view.getByRole('textbox', { name: '可视化文章编辑器' })
      ).toBe(visualEditor);
      expect(
        view.getByRole('button', { name: '锁定为只读' })
      ).not.toBeNull();

      act(() => vi.advanceTimersByTime(640));
      expect(props.submissionField.value).toBe('Heartbeat visual value');
    } finally {
      vi.useRealTimers();
    }
  });

  it('synchronizes continuous visual typing immediately and stores the latest local draft', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>selected</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    vi.useFakeTimers();
    try {
      for (let index = 0; index <= 6; index += 1) {
        visualEditor.innerHTML = `<p>Continuous value ${index}</p>`;
        fireEvent.input(visualEditor);
        if (index < 6) {
          act(() => vi.advanceTimersByTime(100));
        }
      }

      expect(props.submissionField.value).toBe('Continuous value 6');
      expect(canonicalInput).toHaveBeenCalledTimes(7);

      act(() => vi.advanceTimersByTime(499));
      expect(props.localDraftStorage.write).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(props.localDraftStorage.write).toHaveBeenCalledOnce();
      expect(props.localDraftStorage.write).toHaveBeenCalledWith(
        'Continuous value 6'
      );
      expect(canonicalInput).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
      props.submissionField.removeEventListener('input', canonicalInput);
    }
  });

  it('turns the first empty-paper heading shortcut into themed visual markup', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() =>
      expect(unlock.hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(unlock);

    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing empty visual paragraph');
    paragraph.textContent = '#';
    const marker = paragraph.firstChild;
    if (!(marker instanceof Text)) {
      throw new Error('missing empty visual heading marker');
    }
    const markerRange = document.createRange();
    markerRange.setStart(marker, marker.length);
    markerRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(markerRange);
    fireEvent.input(visualEditor);

    expect(fireEvent.keyDown(visualEditor, { key: ' ' })).toBe(false);
    const heading = visualEditor.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(visualEditor.querySelector('p')).toBeNull();
    expect(visualEditor.textContent).not.toContain('#');
    await waitFor(() =>
      expect(props.submissionField.value).toBe('#')
    );

    if (!heading) throw new Error('missing transformed visual heading');
    heading.textContent = 'First themed heading';
    const headingText = heading.firstChild;
    if (!(headingText instanceof Text)) {
      throw new Error('missing transformed visual heading text');
    }
    const headingRange = document.createRange();
    headingRange.setStart(headingText, headingText.length);
    headingRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(headingRange);
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe('# First themed heading')
    );
    expect(heading.textContent).toBe('First themed heading');
  });

  it('commits IME composition once and removes its listeners on teardown', async () => {
    const props = fixture();
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Before</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing IME visual paragraph');
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    fireEvent.compositionStart(visualEditor);
    paragraph.textContent = 'Before 中文';
    const composedText = paragraph.firstChild;
    if (!(composedText instanceof Text)) {
      throw new Error('missing IME composed text');
    }
    const composedRange = document.createRange();
    composedRange.setStart(composedText, composedText.length);
    composedRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(composedRange);
    fireEvent.input(visualEditor, {
      data: '中文',
      inputType: 'insertCompositionText',
      isComposing: true
    });

    expect(props.submissionField.value).toBe('Before');
    expect(canonicalInput).not.toHaveBeenCalled();

    fireEvent.compositionEnd(visualEditor, { data: '中文' });
    fireEvent.input(visualEditor, {
      data: '中文',
      inputType: 'insertFromComposition',
      isComposing: false
    });

    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before 中文')
    );
    expect(canonicalInput).toHaveBeenCalledTimes(1);

    fireEvent.compositionStart(visualEditor);
    paragraph.textContent = 'Before 中文 stale';
    view.unmount();
    fireEvent.compositionEnd(visualEditor, { data: 'stale' });
    fireEvent.input(visualEditor, {
      data: 'stale',
      inputType: 'insertFromComposition',
      isComposing: false
    });
    await act(async () => Promise.resolve());

    expect(props.submissionField.value).toBe('Before 中文');
    expect(canonicalInput).toHaveBeenCalledTimes(1);
    props.submissionField.removeEventListener('input', canonicalInput);
  });

  it('renders the first Markdown paste into an empty themed paper', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const pastedMarkdown = '# First heading\n\n- First item\n- Second item';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve({
        features: {},
        html: request.markdown === pastedMarkdown
          ? '<h1>First heading</h1><ul><li>First item</li><li>Second item</li></ul>' as SafePreviewHtml
          : '' as SafePreviewHtml
      })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.setStart(visualEditor, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : '<h1>unsafe</h1>'
      }
    });

    expect(props.submissionField.value).toBe(pastedMarkdown);
    expect(visualEditor.textContent).not.toContain('# First heading');
    await waitFor(() => {
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'First heading'
      );
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    });
  });

  it('keeps an empty themed paper source-free while the first Markdown paste renders', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const pastedMarkdown = '# Themed heading\n\n- First item\n- Second item';
    const props = {
      ...baseProps,
      appearance: {
        ...baseProps.appearance,
        state: {
          ...baseProps.appearance.state,
          markdownTheme: 'newsprint'
        }
      },
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === pastedMarkdown
        ? pastedPreview.promise
        : Promise.resolve({
            features: {},
            html: '' as SafePreviewHtml
          })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() =>
      expect(unlock.hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(unlock);
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.setStart(visualEditor, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : '<h1>unsafe</h1>'
      }
    });

    expect(props.submissionField.value).toBe(pastedMarkdown);
    expect(visualEditor.innerHTML).toBe('<p><br></p>');
    expect(visualEditor.textContent).not.toContain('# Themed heading');
    expect(visualEditor.querySelector('h1')).toBeNull();
    expect(visualEditor.querySelector('[onclick]')).toBeNull();
    expect(visualEditor.getAttribute('aria-busy')).toBe('true');
    expect(visualEditor.getAttribute('contenteditable')).toBe('false');
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(view.queryByText('Rendering')).toBeNull();
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({
          markdown: pastedMarkdown,
          markdownTheme: 'newsprint'
        }),
        expect.any(AbortSignal)
      )
    );

    await act(async () => {
      pastedPreview.resolve({
        features: {},
        html: [
          '<h1>Themed heading</h1>',
          '<ul><li>First item</li><li>Second item</li></ul>'
        ].join('') as SafePreviewHtml
      });
      await pastedPreview.promise;
    });

    await waitFor(() => {
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'Themed heading'
      );
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.getAttribute('aria-busy')).toBe('false');
      expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    });
    expect(visualEditor.textContent).not.toContain('# Themed heading');
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
  });

  it('renders pasted Markdown through the selected server theme without exposing source text', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const pastedMarkdown = [
      '',
      '',
      '# Pasted heading',
      '',
      '- First item',
      '- Second item',
      '',
      '**Pasted bold**'
    ].join('\n');
    const expectedMarkdown = `Before${pastedMarkdown}`;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expectedMarkdown
        ? pastedPreview.promise
        : Promise.resolve({
            features: {},
            html: '<p>Before</p>' as SafePreviewHtml
          })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph?.firstChild) {
      throw new Error('missing visual paste target');
    }
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const accepted = fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type
            ? pastedMarkdown
            : '<h1 onclick="window.__unsafePaste = true">unsafe</h1>'
      }
    });

    expect(accepted).toBe(false);
    expect(props.submissionField.value).toBe(expectedMarkdown);
    expect(visualEditor.textContent).not.toContain('# Pasted heading');
    expect(visualEditor.querySelector('[onclick]')).toBeNull();
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    await waitFor(() => {
      const [request, signal] =
        vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      expect(request?.markdown).toBe(expectedMarkdown);
      expect(request?.markdownTheme).toBe('default');
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    await act(async () => {
      pastedPreview.resolve({
        features: {},
        html: [
          '<p>Before</p>',
          '<h1>Pasted heading</h1>',
          '<ul><li>First item</li><li>Second item</li></ul>',
          '<p><strong>Pasted bold</strong></p>'
        ].join('') as SafePreviewHtml
      });
      await pastedPreview.promise;
    });

    await waitFor(() => {
      expect(props.submissionField.value).toBe(expectedMarkdown);
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'Pasted heading'
      );
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.querySelector('strong')?.textContent).toBe(
        'Pasted bold'
      );
    });
    expect(visualEditor.textContent).not.toContain('# Pasted heading');
    expect(document.activeElement).toBe(visualEditor);
  });

  it('keeps the visual caret at a middle-document Markdown paste', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before middle after';
    baseProps.submissionField.defaultValue = 'Before middle after';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before middle after</p>' as SafePreviewHtml
      }
    };
    const expectedMarkdown = 'Before **new** after';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expectedMarkdown
        ? pastedPreview.promise
        : Promise.resolve({
            features: {},
            html: '<p>Before middle after</p>' as SafePreviewHtml
          })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const text = visualEditor.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('missing middle visual paste target');
    }
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 13);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? '**new**' : ''
      }
    });
    expect(props.submissionField.value).toBe(expectedMarkdown);

    await act(async () => {
      pastedPreview.resolve({
        features: {},
        html: '<p>Before <strong>new</strong> after</p>' as SafePreviewHtml
      });
      await pastedPreview.promise;
    });
    await waitFor(() =>
      expect(visualEditor.getAttribute('contenteditable')).toBe('true')
    );

    const liveSelection = window.getSelection();
    expect(liveSelection?.isCollapsed).toBe(true);
    const liveRange = liveSelection?.getRangeAt(0);
    if (!liveRange) throw new Error('missing restored visual paste caret');
    const punctuation = document.createTextNode('!');
    liveRange.insertNode(punctuation);
    liveRange.setStartAfter(punctuation);
    liveRange.collapse(true);
    liveSelection?.removeAllRanges();
    liveSelection?.addRange(liveRange);
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        'Before **new**! after'
      )
    );
  });

  it('keeps a committed visual paste editable when caret restoration is unavailable', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const pastedMarkdown = ' **new**';
    const expectedMarkdown = `Before${pastedMarkdown}`;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expectedMarkdown
        ? pastedPreview.promise
        : Promise.resolve({
            features: {},
            html: '<p>Before</p>' as SafePreviewHtml
          })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing visual paste target');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : ''
      }
    });
    expect(props.submissionField.value).toBe(expectedMarkdown);

    const getSelection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(null);
    await act(async () => {
      pastedPreview.resolve({
        features: {},
        html: '<p>Before <strong>new</strong></p>' as SafePreviewHtml
      });
      await pastedPreview.promise;
    });
    getSelection.mockRestore();

    await waitFor(() =>
      expect(visualEditor.getAttribute('contenteditable')).toBe('true')
    );
    expect(visualEditor.querySelector('strong')?.textContent).toBe('new');
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-selection-unavailable'
    );
    expect(view.queryByText(props.preview.messages.error)).toBeNull();
  });

  it('leaves visual editing and preserves canonical Markdown when pasted Preview rendering fails', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const pastedMarkdown = ' **new**';
    const expectedMarkdown = 'Before **new**';
    let pastedPreviewRequests = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown !== expectedMarkdown) {
        return Promise.resolve({
          features: {},
          html: '<p>Before</p>' as SafePreviewHtml
        });
      }
      pastedPreviewRequests += 1;
      return 1 === pastedPreviewRequests
        ? Promise.reject(new Error('synthetic-preview-failure'))
        : Promise.resolve({
            features: {},
            html: '<p>Before <strong>new</strong></p>' as SafePreviewHtml
          });
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing failed visual paste target');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : ''
      }
    });

    expect(props.submissionField.value).toBe(expectedMarkdown);
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    await waitFor(() => {
      const preview = view.container.querySelector<HTMLElement>(
        '[data-easymde-preview-html-sink]'
      );
      expect(preview?.querySelector('strong')?.textContent).toBe('new');
    });
    expect(pastedPreviewRequests).toBe(2);
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-markdown-paste-render-failed'
    );
  });

  it('allows locking during a pending Markdown render and ignores its late response', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const expectedMarkdown = 'Before\n\n# Pending';
    let pendingRequestCount = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown !== expectedMarkdown) {
        return Promise.resolve({
          features: {},
          html: '<p>Before</p>' as SafePreviewHtml
        });
      }
      pendingRequestCount += 1;
      return 1 === pendingRequestCount
        ? pendingPreview.promise
        : Promise.resolve({
            features: {},
            html: '<p>Before</p><h1>Pending</h1>' as SafePreviewHtml
          });
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing pending paste target');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? '\n\n# Pending' : ''
      }
    });
    expect(props.submissionField.value).toBe(expectedMarkdown);
    expect(visualEditor.getAttribute('contenteditable')).toBe('false');
    const lock = view.getByRole('button', { name: '锁定为只读' });
    expect(lock.hasAttribute('disabled')).toBe(false);
    fireEvent.click(lock);

    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    const lockedPreview = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink]'
    );
    expect(lockedPreview?.getAttribute('contenteditable')).toBeNull();
    expect(lockedPreview?.getAttribute('role')).toBeNull();
    expect(lockedPreview?.getAttribute('aria-label')).toBeNull();
    expect(lockedPreview?.getAttribute('spellcheck')).toBeNull();

    await act(async () => {
      pendingPreview.resolve({
        features: {},
        html: '<h1>Stale pending response</h1>' as SafePreviewHtml
      });
      await pendingPreview.promise;
    });
    expect(view.queryByText('Stale pending response')).toBeNull();
    expect(props.submissionField.value).toBe(expectedMarkdown);
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
  });

  it('leaves visual editing before an external canonical change can be overwritten', async () => {
    const props = fixture();
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Before</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const staleVisualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });

    props.submissionField.value = 'External canonical update';
    fireEvent.input(props.submissionField);

    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-canonical-document-changed'
    );
    staleVisualEditor.innerHTML = '<p>Stale visual overwrite</p>';
    fireEvent.input(staleVisualEditor);
    expect(props.submissionField.value).toBe('External canonical update');
  });

  it('restores the last valid paper when a visual edit cannot map safely', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() =>
      expect(view.getByText('内容已载入')).not.toBeNull()
    );
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.textContent).toBe('Rendered');

    visualEditor.innerHTML = '<p>Unmapped replacement</p>';
    fireEvent.input(visualEditor);

    await waitFor(() => {
      expect(props.submissionField.value).toBe('selected');
      expect(visualEditor.textContent).toBe('Rendered');
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-markdown-merge-failed'
      );
    });
    expect(
      view.container.querySelector(
        '.easymde-immersive-preview-status .is-error'
      )?.textContent
    ).toBe('Failed');
  });

  it('accepts only plain text when rich content is pasted into visual Preview', async () => {
    const props = fixture();
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve({
        features: {},
        html:
          'Before **safe** dropped' === request.markdown
            ? '<p>Before <strong>safe</strong> dropped</p>' as SafePreviewHtml
            : 'Before **safe**' === request.markdown
              ? '<p>Before <strong>safe</strong></p>' as SafePreviewHtml
              : '<p>Before</p>' as SafePreviewHtml
      })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const text = visualEditor.querySelector('p')?.firstChild;
    if (!text) throw new Error('missing synthetic paste target');
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const accepted = fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type
            ? ' **safe**'
            : '<img src="x" onerror="window.__unsafePaste = true">'
      }
    });

    expect(accepted).toBe(false);
    expect(visualEditor.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before **safe**')
    );

    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing synthetic drop target');
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const dropped = fireEvent.drop(visualEditor, {
      dataTransfer: {
        getData: (type: string) =>
          'text/plain' === type
            ? ' dropped'
            : '<img src="x" onerror="window.__unsafeDrop = true">'
      }
    });

    expect(dropped).toBe(false);
    expect(visualEditor.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        'Before **safe** dropped'
      )
    );
  });

  it.each(['paste', 'drop'] as const)(
  'routes visual Preview image %s through the WordPress upload owner',
  async (source) => {
    const props = fixture();
    props.submissionField.value = 'Before **selected** after';
    props.submissionField.defaultValue = 'Before **selected** after';
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('missing synthetic visual image-paste target');
    }
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const transfer = imageTransferEvent(
      source,
      new File(['image'], 'visual.png', { type: 'image/png' })
    );

    visualEditor.dispatchEvent(transfer);

    expect(transfer.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(1);
      expect(props.submissionField.value).toBe(
        'Before **![uploaded image](https://example.test/upload.png)** after'
      );
    });
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
    expect(
      view.queryByText('paste' === source ? 'Paste uploaded' : 'Drop uploaded')
    ).toBeNull();
  }
  );

  it('remounts the Preview owner before applying a theme from visual Preview', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const renderPreview = vi.mocked(props.previewPort.render);
    const renderCount = renderPreview.mock.calls.length;

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    expect(props.appearancePort.applyState).toHaveBeenCalledWith(
      expect.objectContaining({ markdownTheme: 'newsprint' })
    );
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
    await waitFor(() =>
      expect(renderPreview.mock.calls.length).toBeGreaterThan(renderCount)
    );
    expect(renderPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ markdownTheme: 'newsprint' }),
      expect.any(AbortSignal)
    );
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
  });

  it('keeps the Preview owner and paper alive when entering Preview mode', async () => {
    const firstPreview = deferred<PreviewResponse>();
    const props = fixture();
    vi.mocked(props.previewPort.render)
      .mockImplementationOnce(() => firstPreview.promise);
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const previewOwner = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    expect(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    ).toBe(previewOwner);
    expect(
      view.getByRole('button', { name: '解除锁定并编辑' })
        .hasAttribute('disabled')
    ).toBe(true);
    await act(async () => {
      firstPreview.resolve({
        features: {},
        html: '<p>Current Preview</p>' as SafePreviewHtml
      });
    });
    await waitFor(() => {
      expect(view.getByText('Current Preview')).not.toBeNull();
      expect(view.getByText('内容已载入')).not.toBeNull();
    });
    expect(
      view.getByRole('button', { name: '解除锁定并编辑' })
        .hasAttribute('disabled')
    ).toBe(false);

    expect(view.getByText('Current Preview')).not.toBeNull();
  });

  it('keeps the selected article theme while Preview is locked and editable', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      appearance: {
        ...baseProps.appearance,
        state: {
          ...baseProps.appearance.state,
          markdownTheme: 'newsprint'
        }
      }
    };
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );
    const lockedPreview = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    expect(
      lockedPreview?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(
      lockedPreview?.classList.contains('easymde-immersive-reference-prose')
    ).toBe(false);

    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor).not.toBeNull();
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(props.previewPort.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ markdownTheme: 'newsprint' }),
      expect.any(AbortSignal)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑' }));
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );
  });

  it('keeps enhanced generated blocks visible and lossless while visual text is edited', async () => {
    const source = [
      'Editable paragraph',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```'
    ].join('\n');
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: { math: true, mermaid: true },
      html: [
        '<p>Editable paragraph</p>',
        '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
        '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>',
        '<section class="footnotes-sep">References</section>',
        '<section class="footnotes">Generated footnotes</section>'
      ].join('') as SafePreviewHtml
    });
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
        const mermaid = surface.querySelector(
          'pre:has(> code.language-mermaid)'
        );
        mermaid?.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'easymde-mermaid',
            innerHTML: '<svg><text>rendered diagram</text></svg>'
          })
        );
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );

    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.querySelector('.katex')?.textContent).toBe(
      'rendered math'
    );
    expect(visualEditor.querySelector('.easymde-mermaid svg')).not.toBeNull();
    for (const region of visualEditor.querySelectorAll(
      '.easymde-math, .easymde-mermaid, .footnotes-sep, .footnotes'
    )) {
      expect(region.getAttribute('contenteditable')).toBe('false');
    }

    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing synthetic visual paragraph');
    paragraph.textContent = 'Edited paragraph';
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        source.replace('Editable paragraph', 'Edited paragraph')
      )
    );
  });

  it('copies the active visual Preview after an unlocked Markdown edit', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Original paragraph</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing visual copy test paragraph');
    paragraph.textContent = 'Edited paragraph';
    fireEvent.input(visualEditor);

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));

    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledOnce()
    );
    expect(props.wechatClipboard.copy).toHaveBeenCalledWith(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Edited paragraph')
    );
  });

  it('restores generated blocks when a visual selection deletes a read-only region', async () => {
    const source = [
      'Editable paragraph',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```'
    ].join('\n');
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: { math: true, mermaid: true },
      html: [
        '<p>Editable paragraph</p>',
        '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
        '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>'
      ].join('') as SafePreviewHtml
    });
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
        const mermaid = surface.querySelector(
          'pre:has(> code.language-mermaid)'
        );
        mermaid?.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'easymde-mermaid',
            innerHTML: '<svg><text>rendered diagram</text></svg>'
          })
        );
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    visualEditor.querySelector('.easymde-mermaid')?.remove();
    fireEvent.input(visualEditor);

    await waitFor(() => {
      expect(props.submissionField.value).toBe(source);
      expect(
        visualEditor.querySelector('.easymde-mermaid svg')
      ).not.toBeNull();
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
    });
  });

  it('maps the visual caret back to CodeMirror before locking and changing mode', async () => {
    const props = fixture();
    props.submissionField.value = 'Before **selected** after';
    props.submissionField.defaultValue = 'Before **selected** after';
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('missing synthetic visual mode selection target');
    }
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const lockPreview = view.getByRole('button', { name: '锁定为只读' });
    expect(fireEvent.mouseDown(lockPreview)).toBe(false);
    expect(window.getSelection()?.toString()).toBe('selected');
    fireEvent.click(lockPreview);

    const source =
      view.container.querySelector<HTMLElement>('.cm-content');
    const editor = source ? EditorView.findFromDOM(source) : null;
    expect(editor?.state.selection.main.from).toBe(9);
    expect(editor?.state.selection.main.to).toBe(17);
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '编辑' }));

    expect(editor?.state.selection.main.from).toBe(9);
    expect(editor?.state.selection.main.to).toBe(17);
  });

  it('keeps publish editing local until confirmation then delegates to the native publisher', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(
      (view.getByRole('switch', {
        name: '更新后打开文章页面'
      }) as HTMLInputElement).checked
    ).toBe(true);
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    const excerpt = view.getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;
    fireEvent.change(excerpt, { target: { value: '尚未提交的摘要' } });
    const backdrop = view.container.querySelector('.easymde-publish-backdrop');
    if (!(backdrop instanceof HTMLElement)) {
      throw new Error('publish-backdrop-unavailable');
    }
    fireEvent.click(backdrop);
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(excerpt.value).toBe('尚未提交的摘要');

    fireEvent.click(view.getByRole('button', { name: '取消' }));
    expect(view.queryByRole('dialog', { name: '更新文章' })).toBeNull();
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      view.getByRole('switch', { name: '更新后打开文章页面' })
    );
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        { name: '更新文章' }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledOnce();
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ openPreview: false })
    );
    expect(props.publishPost).toHaveBeenCalledOnce();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'savepost',
      expect.anything()
    );
  });

  it('restores the legacy protected-post password field contract', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = view.getByRole('dialog', { name: '更新文章' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '密码' }));

    const password = within(dialog).getByPlaceholderText(
      '输入访问密码'
    ) as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.maxLength).toBe(255);

    fireEvent.click(
      within(dialog).getByRole('button', { name: '更新文章' })
    );
    expect(
      within(dialog).getByRole('alert').textContent
    ).toBe('请输入访问密码后再提交。');
    expect(document.activeElement).toBe(password);
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    fireEvent.change(password, { target: { value: 'temporary-password' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '私密' }));
    expect(
      within(dialog).queryByPlaceholderText('输入访问密码')
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: '密码' }));
    expect(
      (within(dialog).getByPlaceholderText('输入访问密码') as HTMLInputElement)
        .value
    ).toBe('');
  });

  it('renders the source-accurate publish decorations and submitting progress owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = view.getByRole('dialog', { name: '更新文章' });
    expect(
      dialog.querySelectorAll('.easymde-publish-heading-sparkle')
    ).toHaveLength(1);
    expect(
      dialog.querySelectorAll('.easymde-publish-button-sparkles svg')
    ).toHaveLength(2);
    const progress = dialog.querySelector('.easymde-publish-progress');
    expect(progress?.getAttribute('aria-live')).toBe('polite');
    expect(progress?.textContent).toBe('');

    fireEvent.click(
      within(dialog).getByRole('button', { name: '更新文章' })
    );

    expect(progress?.textContent).toBe('加载预览中...');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the reference featured-image guidance independent from the direct-upload limit', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    expect(
      within(view.getByRole('dialog', { name: '更新文章' })).getByText(
        '支持 JPG、PNG、WebP 格式，最大 5MB'
      )
    ).not.toBeNull();
  });

  it('labels the existing WordPress Post action as update throughout immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.getByRole('button', { name: '更新文章' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '发布文章' })).toBeNull();
  });

  it('labels a new WordPress Post action as publish throughout immersive mode', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      existing: false
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '发布文章' }));
    expect(view.getByRole('dialog', { name: '发布文章' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '更新文章' })).toBeNull();
  });

  it('keeps hierarchical WordPress category selections independent', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      availableFields: {
        categories: true,
        excerpt: true,
        featuredImage: true,
        sticky: true,
        tags: true,
        visibility: true
      },
      categories: [
        {
          children: [
            {
              children: [],
              id: 'child',
              label: '子分类'
            }
          ],
          id: 'parent',
          label: '父分类'
        }
      ],
      categoryIds: ['child'],
      excerpt: '',
      featuredImage: null,
      openPreview: false,
      password: '',
      existing: true,
      sticky: false,
      tags: [],
      visibility: 'public'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const parent = view.getByRole('checkbox', {
      name: '父分类'
    }) as HTMLInputElement;
    const child = view.getByRole('checkbox', {
      name: '子分类'
    }) as HTMLInputElement;
    expect(parent.checked).toBe(false);
    expect(parent.indeterminate).toBe(true);
    expect(child.checked).toBe(true);

    fireEvent.click(view.getByRole('button', { name: '收起 父分类' }));
    expect(view.queryByRole('checkbox', { name: '子分类' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开 父分类' }));
    fireEvent.click(view.getByRole('checkbox', { name: '子分类' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        { name: '更新文章' }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [] })
    );
  });

  it('omits publish controls without authoritative WordPress form owners', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      availableFields: {
        categories: false,
        excerpt: false,
        featuredImage: false,
        sticky: false,
        tags: false,
        visibility: true
      }
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = within(view.getByRole('dialog', { name: '更新文章' }));
    expect(dialog.queryByText('标签')).toBeNull();
    expect(dialog.queryByText('摘要')).toBeNull();
    expect(dialog.queryByText('分类')).toBeNull();
    expect(dialog.queryByText('封面图')).toBeNull();
    expect(dialog.queryByRole('checkbox', { name: '置于首页顶端' })).toBeNull();
    expect(dialog.getByRole('radiogroup', { name: '可见性' })).not.toBeNull();
  });

  it('restores the native publish fields when the WordPress submit command is unavailable', async () => {
    const props = fixture();
    vi.mocked(props.publishPost).mockReturnValue(false);
    const original = props.nativePublishPort.read();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        { name: '更新文章' }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledTimes(2);
    expect(props.nativePublishPort.apply).toHaveBeenLastCalledWith(original);
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-command-unavailable'
    );
    const dialog = view.getByRole('dialog', { name: '更新文章' });
    expect(
      within(dialog).getByRole('alert').textContent
    ).toBe('WordPress 未接受发布请求，请检查页面状态后重试。');
    expect(
      view.container.querySelector('.easymde-editor-flash')
    ).toBeNull();
  });

  it('reports a native publish owner that disappears before confirmation', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.apply).mockImplementationOnce(() => {
      throw new Error('native-publish-tags-owner-unavailable');
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        { name: '更新文章' }
      )
    );

    expect(props.publishPost).not.toHaveBeenCalled();
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-native-owner-unavailable'
    );
    expect(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole('alert')
        .textContent
    ).toBe('WordPress 未接受发布请求，请检查页面状态后重试。');
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
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = view.getByRole('textbox', {
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

  it('flushes an immediate visual edit before History can restore a revision', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>selected</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });

    vi.useFakeTimers();
    try {
      visualEditor.innerHTML = '<p>Immediate visual history edit</p>';
      fireEvent.input(visualEditor);
      expect(props.submissionField.value).toBe(
        'Immediate visual history edit'
      );

      fireEvent.click(view.getByRole('button', { name: '历史记录' }));

      expect(props.submissionField.value).toBe(
        'Immediate visual history edit'
      );
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }

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

  it('keeps History closed when a visual edit cannot synchronize safely', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
      name: '可视化文章编辑器'
    });

    visualEditor.innerHTML = '<p>Unmapped replacement</p>';
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    expect(view.queryByRole('dialog', { name: '历史版本' })).toBeNull();
    expect(
      view.getByRole('textbox', { name: '可视化文章编辑器' })
    ).toBe(visualEditor);
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-markdown-merge-failed'
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
      expect(revisionPort.get).toHaveBeenCalledWith(
        13,
        expect.any(AbortSignal)
      )
    );
    expect(view.getByText('Automatic revision')).not.toBeNull();
    expect(
      (view.getByRole('button', {
        name: '恢复到这个版本'
      }) as HTMLButtonElement).disabled
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
      expect(revisionPort.get).toHaveBeenCalledWith(
        12,
        expect.any(AbortSignal)
      )
    );
    fireEvent.click(view.getByRole('button', { name: '手动保存11:00' }));
    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(
        13,
        expect.any(AbortSignal)
      )
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
        (id: number) => new Promise<RevisionPreview>((resolve) => {
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
      expect(revisionPort.get).toHaveBeenCalledWith(
        12,
        expect.any(AbortSignal)
      )
    );
    const manualSignal = revisionPort.get.mock.calls[0]?.[1] as AbortSignal;
    fireEvent.change(view.getByRole('combobox', { name: '全部' }), {
      target: { value: 'auto' }
    });

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(
        13,
        expect.any(AbortSignal)
      )
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
    expect(restoreFavicon).toHaveBeenCalledOnce();
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
      view.container.querySelectorAll(
        '.easymde-immersive-formatting .easymde-toolbar-divider'
      )
    ).toHaveLength(1);
    expect(
      view.container.querySelector('.easymde-immersive-header .easymde-immersive-exit')
    ).toBeNull();
    expect(view.queryByRole('button', { name: /AI/u })).toBeNull();
    expect(view.getByRole('button', { name: '编辑器设置' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '更多操作' })).toBeNull();
    const moreActions = view.container.querySelector(
      '.easymde-immersive-more-actions'
    );
    expect(moreActions?.tagName).toBe('SPAN');
    expect(moreActions?.getAttribute('aria-hidden')).toBe('true');
    const settings = view.getByRole('button', { name: '编辑器设置' });
    settings.focus();
    fireEvent.click(moreActions as HTMLElement);
    expect(document.activeElement).toBe(settings);

    const tableIcon = view
      .getByRole('button', { name: '表格' })
      .querySelector('svg');
    expect(
      Array.from(tableIcon?.children ?? []).map((node) => ({
        d: node.getAttribute('d'),
        height: node.getAttribute('height'),
        tag: node.tagName.toLowerCase(),
        width: node.getAttribute('width'),
        x: node.getAttribute('x'),
        y: node.getAttribute('y')
      }))
    ).toEqual([
      { d: 'M12 3v18', height: null, tag: 'path', width: null, x: null, y: null },
      { d: null, height: '18', tag: 'rect', width: '18', x: '3', y: '3' },
      { d: 'M3 9h18', height: null, tag: 'path', width: null, x: null, y: null },
      { d: 'M3 15h18', height: null, tag: 'path', width: null, x: null, y: null }
    ]);

    expect(
      Array.from(
        view.container.querySelectorAll(
          '.easymde-immersive-wechat-glyph path'
        )
      ).map((path) => path.getAttribute('d'))
    ).toEqual([
      'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
      'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
      'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
    ]);

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull()
    );
    expect(
      view.container.querySelector('.easymde-editor-flash')
    ).toBeNull();
    expect(view.queryByText('Copied')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(view.getByRole('dialog', { name: '编辑器设置' })).not.toBeNull();
    for (const name of ['文章大纲', '字数统计', '分屏预览', '自动保存', '同步滚动']) {
      expect(
        (view.getByRole('checkbox', { name }) as HTMLInputElement).checked
      ).toBe(true);
    }
    expect(view.queryByText(/AI/u)).toBeNull();
  });

  it('keeps the immersive H trigger stable while updating cursor status', async () => {
    const props = fixture();
    props.submissionField.value = '# First\nBody';
    props.submissionField.defaultValue = '# First\nBody';
    props.submissionField.setSelectionRange(0, 0);
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
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    const heading = view.getByRole('button', { name: 'Headings' });
    expect(
      heading.querySelector('.easymde-toolbar-text-icon')?.textContent
    ).toBe('H');
    expect(view.getByText('行 1, 列 1')).not.toBeNull();

    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    act(() => {
      editor?.dispatch({ selection: EditorSelection.cursor(8) });
    });

    await waitFor(() => {
      expect(
        heading.querySelector('.easymde-toolbar-text-icon')?.textContent
      ).toBe('H');
      expect(view.getByText('行 2, 列 1')).not.toBeNull();
    });
  });

  it('does not resurrect immersive-only feedback after leaving the reference surface', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull()
    );
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));

    expect(view.queryByText('Copied')).toBeNull();
    expect(
      view.container.querySelector('.easymde-editor-flash')
    ).toBeNull();
  });

  it('keeps a late immersive clipboard failure visible after returning to the ordinary editor', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    let finishCopy: ((result: ClipboardResult) => void) | null = null;
    vi.mocked(props.wechatClipboard.copy).mockImplementation(
      () =>
        new Promise<ClipboardResult>((resolve) => {
          finishCopy = resolve;
        })
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    await act(async () => {
      finishCopy?.({ code: 'wechat-copy-failed', status: 'failed' });
    });

    expect(view.getByText('Copy failed')).not.toBeNull();
    expect(
      view.container.querySelector('.easymde-editor-flash')
    ).not.toBeNull();
  });

  it('keeps immersive operation failures in the existing status bar without a floating message', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('Copy failed')
    );
    expect(
      view.container.querySelector('.easymde-editor-flash')
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.queryByText('Copy failed')).toBeNull();
  });

  it('expires ordinary feedback after 3200ms without letting a stale timer clear newer feedback', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(3199);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(3199);
      });
      expect(view.queryByText('Copied')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches the reference 1800ms immersive copy-feedback duration', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1799);
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(
        view.getByRole('button', { name: '复制到公众号' })
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches the reference outline drag bounds, reset and cleanup lifecycle', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    const separator = view.getByRole('separator', {
      name: '调整大纲宽度'
    });
    const outlineActions = view.getAllByRole('button', {
      name: '收起大纲'
    });
    const footerAction = outlineActions.at(-1);
    if (!footerAction) throw new Error('outline-footer-control-unavailable');
    expect(
      Array.from(footerAction.childNodes).some(
        (node) =>
          Node.TEXT_NODE === node.nodeType &&
          '收起大纲' === node.textContent?.trim()
      )
    ).toBe(true);

    expect(separator.getAttribute('aria-valuenow')).toBe('240');
    fireEvent.pointerDown(separator, {
      clientX: 240,
      pointerId: 1,
      pointerType: 'touch'
    });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerMove(document, { clientX: 500, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    fireEvent.pointerMove(document, { clientX: -100, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('190');
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');

    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('240');

    fireEvent.pointerDown(separator, { clientX: 240, pointerId: 2 });
    const [hideOutline] = view.getAllByRole('button', {
      name: '收起大纲'
    });
    if (!hideOutline) throw new Error('hide-outline-control-unavailable');
    fireEvent.click(hideOutline);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    fireEvent.mouseMove(document, { clientX: 320 });
    fireEvent.mouseUp(document);
  });

  it('applies immersive settings to the real outline, statistics, draft and scroll owners', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    fireEvent.click(view.getByRole('checkbox', { name: '文章大纲' }));
    fireEvent.click(view.getByRole('checkbox', { name: '字数统计' }));
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    fireEvent.click(view.getByRole('checkbox', { name: '自动保存' }));
    fireEvent.click(view.getByRole('checkbox', { name: '同步滚动' }));

    expect(view.queryByRole('complementary', { name: '文章大纲' })).toBeNull();
    expect(view.container.querySelector('.easymde-immersive-stats')).toBeNull();
    expect(view.queryByText('自动保存已开启')).toBeNull();
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledOnce();
    expect(props.immersivePreferencesPort.write).toHaveBeenCalledTimes(6);
  });

  it('applies restored immersive preferences to the existing draft and scroll owners', async () => {
    const props = fixture();
    vi.mocked(props.immersivePreferencesPort.read).mockReturnValue({
      preferences: {
        autoSave: false,
        outline: true,
        splitPreview: true,
        syncScroll: false,
        wordCount: true
      },
      status: 'loaded'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(
      (view.getByRole('checkbox', { name: '自动保存' }) as HTMLInputElement)
        .checked
    ).toBe(false);
    expect(
      (view.getByRole('checkbox', { name: '同步滚动' }) as HTMLInputElement)
        .checked
    ).toBe(false);
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(props.scrollSyncPort.prepareBinding).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await act(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, 600))
    );
    expect(props.localDraftStorage.write).not.toHaveBeenCalled();
  });

  it('reads the latest immersive preferences again on every entry', async () => {
    const props = fixture();
    let savedPreferences: ImmersivePreferences | null = null;
    vi.mocked(props.immersivePreferencesPort.read).mockImplementation(() =>
      savedPreferences
        ? { preferences: savedPreferences, status: 'loaded' }
        : { status: 'missing' }
    );
    vi.mocked(props.immersivePreferencesPort.write).mockImplementation(
      (preferences) => {
        savedPreferences = preferences;
        return { status: 'saved' };
      }
    );

    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    fireEvent.click(view.getByRole('button', { name: '分屏模式' }));
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(props.immersivePreferencesPort.read).toHaveBeenCalledTimes(3);
    expect(props.immersivePreferencesPort.write).toHaveBeenCalledTimes(2);
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

  it('maps a visual Preview selection before handing Image to WordPress Media', async () => {
    const props = fixture();
    props.submissionField.value = 'Choose **this** text';
    props.submissionField.defaultValue = 'Choose **this** text';
    vi.mocked(props.previewPort.render).mockResolvedValue({
      features: {},
      html: '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: '进入沉浸写作' })
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(
      view.getByRole('button', { name: '解除锁定并编辑' })
    );
    const visualEditor = view.getByRole('textbox', {
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
        'Choose **![Selected image](https://example.test/selected.png)** text'
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
