import { createRoot } from '@wordpress/element';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorClipboardPort } from '../contracts/ports/editor-clipboard-port';
import { parseEditorRootBootstrap } from '../contracts/bootstrap/editor-root-bootstrap';
import { createBrowserLocalDraftStorage } from '../integrations/browser/local-drafts/browser-local-draft-storage';
import { createBrowserEditorBlockIndexWorker } from '../integrations/browser/editor-context-menu/create-browser-editor-block-index-worker';
import { createBrowserWechatClipboard } from '../integrations/browser/wechat/create-browser-wechat-clipboard';
import { createWordPressImageUploadPort } from '../integrations/wordpress/media/wordpress-image-upload';
import { createWordPressMediaFramePort } from '../integrations/wordpress/media/wordpress-media-frame';
import { mountAdminEditor } from './admin-editor';

vi.hoisted(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

vi.mock('@wordpress/element', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wordpress/element')>()),
  createRoot: vi.fn()
}));
vi.mock('../contracts/bootstrap/editor-root-bootstrap', () => ({
  parseEditorRootBootstrap: vi.fn()
}));
vi.mock(
  '../integrations/browser/editor-layout/create-browser-scroll-sync',
  () => ({ createBrowserScrollSync: vi.fn(() => ({})) })
);
vi.mock(
  '../integrations/browser/editor-context-menu/create-browser-editor-block-index-worker',
  () => ({
    createBrowserEditorBlockIndexWorker: vi.fn(() => ({
      build: vi.fn(),
      dispose: vi.fn()
    }))
  })
);
vi.mock(
  '../integrations/browser/keyboard/create-browser-toolbar-shortcuts',
  () => ({ createBrowserToolbarShortcuts: vi.fn(() => ({})) })
);
vi.mock(
  '../integrations/browser/local-drafts/browser-local-draft-storage',
  () => ({
    createBrowserLocalDraftStorage: vi.fn(() => ({
      fingerprint: vi.fn(() => 'saved-fingerprint')
    }))
  })
);
vi.mock(
  '../integrations/browser/preview/create-browser-preview-scroll',
  () => ({ createBrowserPreviewScroll: vi.fn(() => ({})) })
);
vi.mock(
  '../integrations/browser/wechat/create-browser-wechat-clipboard',
  () => ({ createBrowserWechatClipboard: vi.fn(() => ({})) })
);
vi.mock('../integrations/preview-runtime/browser-preview-enhancement', () => ({
  createBrowserPreviewEnhancementPort: vi.fn(() => ({})),
  createWindowPreviewEnhancementRuntime: vi.fn(() => ({}))
}));
vi.mock(
  '../integrations/wordpress/appearance/create-wordpress-appearance-port',
  () => ({ createWordPressAppearancePort: vi.fn(() => ({})) })
);
vi.mock(
  '../integrations/wordpress/appearance/create-wordpress-font-controls-port',
  () => ({ createWordPressFontControlsPort: vi.fn(() => ({})) })
);
vi.mock('../integrations/wordpress/media/wordpress-image-upload', () => ({
  createWordPressImageUploadPort: vi.fn(() => ({}))
}));
vi.mock('../integrations/wordpress/media/wordpress-remote-image-import', () => ({
  createWordPressRemoteImageImportPort: vi.fn(() => ({}))
}));
vi.mock('../integrations/wordpress/media/wordpress-media-frame', () => ({
  createWordPressMediaFramePort: vi.fn(() => ({}))
}));
vi.mock(
  '../integrations/wordpress/native-form/wordpress-native-submission',
  () => ({ createWordPressNativeSubmissionPort: vi.fn(() => ({})) })
);
vi.mock(
  '../integrations/wordpress/preview/create-wordpress-preview-port',
  () => ({ createWordPressPreviewPort: vi.fn(() => ({})) })
);
vi.mock(
  '../integrations/wordpress/session/create-wordpress-editor-session-port',
  () => ({ createWordPressEditorSessionPort: vi.fn(() => ({})) })
);

const bootstrap = {
  appearance: {},
  document: {},
  editorBlockIndexWorkerUrl: 'https://example.test/wp-content/plugins/easymde/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js',
  fonts: {},
  imageUpload: {
    actionNonce: 'image-hosting-nonce',
    allowedExtensions: ['webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif'],
    endpoint: '/image-hosting/upload',
    importEndpoint: '/image-hosting/import',
    nonce: 'nonce',
    postId: 7,
    remoteImageUploadMode: 'both',
    uploadOwner: 'image-hosting'
  },
  immersiveStrings: {
    autoSave: 'Auto save',
    autoSaveEnabled: 'Auto save is enabled',
    articleOutline: 'Article outline',
    cancel: 'Cancel',
    close: 'Close',
    column: 'Column',
    edit: 'Edit',
    editMode: 'Edit mode',
    editorSettings: 'Editor settings',
    enter: 'Enter immersive writing',
    expand: 'Expand',
    exit: 'Exit immersive writing',
    hideOutline: 'Hide outline',
    history: 'History',
    historyEmpty: 'No revisions',
    historyError: 'Revision error',
    historyLoading: 'Loading revisions',
    historyAll: 'All',
    historyVersions: 'Revision history',
    immersive: 'Immersive writing',
    insert: 'Insert',
    insertTable: 'Insert table',
    line: 'Line',
    manualSave: 'Manual save',
    moreActions: 'More actions',
    markdown: 'Markdown',
    noHeadings: 'No headings',
    outline: 'Article outline',
    outlineDescription: 'Show heading navigation on the left',
    preview: 'Preview',
    previewChangesRecorded: 'Changes recorded',
    previewContentLoaded: 'Content loaded',
    previewEditable: 'Editable',
    previewEditorLabel: 'Visual article editor',
    previewLockReadOnly: 'Lock as read only',
    previewReadOnly: 'Read only',
    previewUnlockEdit: 'Unlock and edit',
    previewMode: 'Preview mode',
    publish: 'Publish article',
    restore: 'Restore revision',
    restoreConfirm: 'Unsaved changes will be lost',
    restoreThisVersion: 'Restore this revision',
    resizeOutline: 'Resize article outline',
    saved: 'Saved',
    settings: 'Settings',
    showOutline: 'Show outline',
    split: 'Split',
    splitMode: 'Split mode',
    splitPreview: 'Split preview',
    splitPreviewDescription: 'Live preview editing area (what you see is what you get)',
    table: 'Table',
    tableColumns: 'Columns',
    tableRows: 'Rows',
    theme: 'Theme',
    themeSettings: 'Theme settings',
    addTags: 'Add tags',
    categories: 'Categories',
    categoriesDescription: 'Choose categories.',
    categoriesSelected: 'Selected: %s',
    closePublish: 'Close publish dialog',
    collapse: 'Collapse',
    continueAddingTags: 'Continue adding...',
    excerpt: 'Excerpt',
    excerptPlaceholder: 'Write an excerpt...',
    featuredImage: 'Featured image',
    imageRecommendation: 'Landscape images are recommended',
    imageRequirements: 'Supports JPG, PNG, and WebP, max 5MB',
    noWriteBeforeSubmit: 'Nothing is written before submission.',
    password: 'Password',
    passwordPlaceholder: 'Enter access password',
    passwordRequired: 'Enter an access password.',
    preparingPublish: 'Ready to publish',
    private: 'Private',
    privateDescription: 'Only editors can view this article.',
    public: 'Public',
    publishDescription: 'Confirm article details.',
    publishFailed: 'WordPress did not accept the publish request. Check the page state and try again.',
    publishLoadingPreview: 'Loading preview...',
    remove: 'Remove',
    removeTag: 'Remove tag: %s',
    replace: 'Replace',
    selectFeaturedImage: 'Select featured image',
    sticky: 'Stick to the top',
    tags: 'Tags',
    tagsDescription: 'Press Enter or comma.',
    updateArticle: 'Update article',
    updateDescription: 'Confirm article changes.',
    updateExisting: 'Update existing article',
    visibility: 'Visibility',
    title: 'Article title',
    unsaved: 'Unsaved',
    viewModes: 'View modes',
    wechat: 'Copy to WeChat',
    wechatCopied: 'Copied'
  },
  labels: {
    mediaPickerFailure: 'Media failed',
    preview: 'Preview',
    source: 'Markdown',
    toolbar: 'Toolbar'
  },
  layout: {},
  localDrafts: { locale: 'en_US', postId: 7 },
  mediaPicker: {
    canUseMedia: true,
    defaultAlt: 'image',
    frameUrl: 'https://example.test/wp-admin/admin-post.php?action=easymde_media_picker',
    insertMedia: 'Insert Media',
    insertion: { titleDisplay: 'none' },
    placeholderAlt: 'alt text'
  },
  preview: { postId: 7 },
  previewEnhancement: { assetBaseUrl: 'https://example.test/plugin/' },
  toolbar: { commands: [], shortcuts: [] },
  wechatExport: {},
  wordpress: {
    customCssUrl: '/custom-css',
    isNewPost: false,
    nonce: 'nonce',
    publishCategories: [],
    previewUrl: '/preview',
    revisionsUrl: '/posts/'
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe('mountAdminEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <form id="post">
        <input id="post_ID" value="11">
        <input id="title" value="Title">
        <input id="easymde-enabled-field" value="1">
        <textarea id="easymde-source"># Markdown</textarea>
        <input id="easymde-code-theme-field">
        <input id="easymde-code-theme-explicit-field" value="0">
        <input id="easymde-custom-css-id-field">
        <input id="easymde-markdown-theme-field">
        <input id="easymde-apple-font-field">
        <input id="easymde-custom-font-field">
        <input id="easymde-serif-font-field">
        <input id="easymde-windows-font-field">
        <button id="save-post" type="button">Save Draft</button>
        <button id="publish" type="button">Publish</button>
      </form>
      <div id="postdivrich"><textarea id="content"></textarea></div>
      <div id="easymde-editor-root"></div>
    `;
    vi.mocked(parseEditorRootBootstrap).mockReturnValue(bootstrap as never);
  });

  it('mounts the production root once and returns idempotent teardown', () => {
    const render = vi.fn();
    const unmount = vi.fn();
    const saveDraft = document.querySelector<HTMLButtonElement>('#save-post');
    const publish = document.querySelector<HTMLButtonElement>('#publish');
    const saveDraftClick = vi.spyOn(saveDraft as HTMLButtonElement, 'click');
    const publishClick = vi
      .spyOn(publish as HTMLButtonElement, 'click')
      .mockImplementation(() => {
        publish?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true })
        );
        publish?.closest('form')?.dispatchEvent(
          new SubmitEvent('submit', { bubbles: true, cancelable: true })
        );
      });
    vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

    const teardown = mountAdminEditor(bootstrap, {
      document,
      failureMessage: 'Editor failed',
      window,
      wordpress: {
        apiFetch: Object.assign(vi.fn(), {
          nonceMiddleware: { nonce: 'nonce' }
        }),
        hooks: { addAction: vi.fn(), removeAction: vi.fn() }
      }
    });

    expect(createRoot).toHaveBeenCalledWith(
      document.querySelector('#easymde-editor-root')
    );
    expect(createBrowserLocalDraftStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { ...bootstrap.localDrafts, postId: 11 }
      })
    );
    expect(createBrowserEditorBlockIndexWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        workerUrl: bootstrap.editorBlockIndexWorkerUrl
      })
    );
    expect(createWordPressImageUploadPort).toHaveBeenCalledWith(
      expect.objectContaining({
        actionNonce: 'image-hosting-nonce',
        endpoint: '/image-hosting/upload',
        nonce: 'nonce',
        uploadOwner: 'image-hosting'
      })
    );
    expect(
      vi.mocked(createWordPressImageUploadPort).mock.calls[0]?.[0]
    ).not.toHaveProperty('destination');
    expect(render).toHaveBeenCalledTimes(1);
    const rendered = render.mock.calls[0]?.[0] as {
      props: {
        children: {
          props: {
            onDocumentOwnerChange: (owned: boolean) => void;
            publishPost: (session: never) => boolean;
          };
        };
      };
    };
    expect(rendered.props.children.props.publishPost({} as never)).toBe(true);
    expect(publishClick).toHaveBeenCalledOnce();
    expect(saveDraftClick).not.toHaveBeenCalled();
    const nativeEditor = document.querySelector<HTMLElement>('#postdivrich');
    expect(
      nativeEditor?.classList.contains('easymde-native-editor-hidden')
    ).toBe(false);
    rendered.props.children.props.onDocumentOwnerChange(true);
    expect(
      nativeEditor?.classList.contains('easymde-native-editor-hidden')
    ).toBe(true);
    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
    expect(unmount).toHaveBeenCalledTimes(1);
    const blockIndexPort = vi.mocked(createBrowserEditorBlockIndexWorker).mock
      .results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
    expect(blockIndexPort.dispose).toHaveBeenCalledOnce();
    expect(
      nativeEditor?.classList.contains('easymde-native-editor-hidden')
    ).toBe(false);
  });

  it('passes the native PNG ClipboardItem capability through the editor runtime', async () => {
    const render = vi.fn();
    const unmount = vi.fn();
    vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
    const nativeWrite = vi.fn().mockResolvedValue(undefined);
    const clipboard = {
      readText: vi.fn().mockResolvedValue(''),
      write: nativeWrite,
      writeText: vi.fn().mockResolvedValue(undefined)
    } as unknown as Clipboard;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'clipboard'
    );
    const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'ClipboardItem'
    );
    class ClipboardItemStub {
      static supports = vi.fn((type: string) => 'image/png' === type);

      constructor(readonly payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: clipboard
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: ClipboardItemStub
    });

    try {
      const teardown = mountAdminEditor(bootstrap, {
        document,
        failureMessage: 'Editor failed',
        window,
        wordpress: {
          apiFetch: Object.assign(vi.fn(), {
            nonceMiddleware: { nonce: 'nonce' }
          }),
          hooks: { addAction: vi.fn(), removeAction: vi.fn() }
        }
      });
      const rendered = render.mock.calls[0]?.[0] as {
        props: {
          children: {
            props: { editorClipboardPort: EditorClipboardPort };
          };
        };
      };
      const editorClipboardPort = rendered.props.children.props.editorClipboardPort;
      if (!editorClipboardPort?.writeImageDeferred) {
        throw new Error('entrypoint-png-clipboard-port-missing');
      }
      expect(editorClipboardPort.supportsPngWrite?.()).toBe(true);
      let resolvePayload!: (value: Blob) => void;
      const payload = new Promise<Blob>((resolve) => {
        resolvePayload = resolve;
      });
      const result = editorClipboardPort.writeImageDeferred(payload);
      expect(nativeWrite).toHaveBeenCalledOnce();
      expect(ClipboardItemStub.supports).toHaveBeenCalledWith('image/png');
      resolvePayload(new Blob(['png'], { type: 'image/png' }));
      await expect(result).resolves.toEqual({ status: 'written' });
      ClipboardItemStub.supports.mockReturnValue(false);
      expect(editorClipboardPort.supportsPngWrite?.()).toBe(false);
      await expect(
        editorClipboardPort.writeImageDeferred(
          Promise.resolve(new Blob(['png'], { type: 'image/png' }))
        )
      ).resolves.toEqual({ code: 'editor-clipboard-unsupported', status: 'failed' });
      expect(nativeWrite).toHaveBeenCalledOnce();
      teardown();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(window.navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
      if (clipboardItemDescriptor) {
        Object.defineProperty(window, 'ClipboardItem', clipboardItemDescriptor);
      } else {
        delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
      }
    }
  });

  it('passes native deferred rich Clipboard support through the editor runtime', async () => {
    const render = vi.fn();
    const unmount = vi.fn();
    vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
    const nativeWrite = vi.fn().mockResolvedValue(undefined);
    const clipboard = {
      readText: vi.fn().mockResolvedValue(''),
      write: nativeWrite,
      writeText: vi.fn().mockResolvedValue(undefined)
    } as unknown as Clipboard;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'clipboard'
    );
    const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'ClipboardItem'
    );
    class ClipboardItemStub {
      static supports = vi.fn((type: string) =>
        ['text/html', 'text/plain'].includes(type)
      );

      constructor(readonly payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: clipboard
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: ClipboardItemStub
    });

    try {
      const teardown = mountAdminEditor(bootstrap, {
        document,
        failureMessage: 'Editor failed',
        window,
        wordpress: {
          apiFetch: Object.assign(vi.fn(), {
            nonceMiddleware: { nonce: 'nonce' }
          }),
          hooks: { addAction: vi.fn(), removeAction: vi.fn() }
        }
      });
      const rendered = render.mock.calls[0]?.[0] as {
        props: {
          children: {
            props: { editorClipboardPort: EditorClipboardPort };
          };
        };
      };
      const editorClipboardPort = rendered.props.children.props.editorClipboardPort;
      if (!editorClipboardPort?.writeRichDeferred) {
        throw new Error('entrypoint-rich-clipboard-port-missing');
      }
      expect(editorClipboardPort.supportsRichWrite?.()).toBe(true);
      let resolvePayload!: (value: { html: string; text: string }) => void;
      const payload = new Promise<{ html: string; text: string }>((resolve) => {
        resolvePayload = resolve;
      });
      const result = editorClipboardPort.writeRichDeferred(payload);
      expect(nativeWrite).toHaveBeenCalledOnce();
      expect(ClipboardItemStub.supports).toHaveBeenCalledWith('text/html');
      expect(ClipboardItemStub.supports).toHaveBeenCalledWith('text/plain');
      resolvePayload({ html: '<p>Rendered</p>', text: 'Rendered' });
      await expect(result).resolves.toEqual({ status: 'written' });
      teardown();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(window.navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
      if (clipboardItemDescriptor) {
        Object.defineProperty(window, 'ClipboardItem', clipboardItemDescriptor);
      } else {
        delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
      }
    }
  });

  it('observes a late plain deferred payload rejection after native setup throws', async () => {
    const render = vi.fn();
    const unmount = vi.fn();
    vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
    const nativeWrite = vi.fn().mockResolvedValue(undefined);
    const clipboard = {
      readText: vi.fn().mockResolvedValue(''),
      write: nativeWrite,
      writeText: vi.fn().mockResolvedValue(undefined)
    } as unknown as Clipboard;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'clipboard'
    );
    const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'ClipboardItem'
    );
    class ThrowingClipboardItem {
      static supports = vi.fn(() => true);

      constructor(_payload: Record<string, Blob | PromiseLike<Blob>>) {
        throw new Error('native setup failed');
      }
    }
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: clipboard
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: ThrowingClipboardItem
    });

    try {
      const teardown = mountAdminEditor(bootstrap, {
        document,
        failureMessage: 'Editor failed',
        window,
        wordpress: {
          apiFetch: Object.assign(vi.fn(), {
            nonceMiddleware: { nonce: 'nonce' }
          }),
          hooks: { addAction: vi.fn(), removeAction: vi.fn() }
        }
      });
      const rendered = render.mock.calls[0]?.[0] as {
        props: {
          children: {
            props: { editorClipboardPort: EditorClipboardPort };
          };
        };
      };
      const editorClipboardPort = rendered.props.children.props.editorClipboardPort;
      if (!editorClipboardPort?.writeDeferred) {
        throw new Error('entrypoint-plain-deferred-clipboard-port-missing');
      }
      const payload = deferred<string>();
      const result = editorClipboardPort.writeDeferred(payload.promise);
      await expect(result).resolves.toEqual({
        code: 'editor-clipboard-write-failed',
        status: 'failed'
      });
      payload.reject(new Error('late renderer failure'));
      await Promise.resolve();
      teardown();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(window.navigator, 'clipboard', clipboardDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
      if (clipboardItemDescriptor) {
        Object.defineProperty(window, 'ClipboardItem', clipboardItemDescriptor);
      } else {
        delete (window as Window & { ClipboardItem?: unknown }).ClipboardItem;
      }
    }
  });

  it('creates and disposes the isolated WordPress media frame adapter', () => {
    const render = vi.fn();
    vi.mocked(createRoot).mockReturnValue({
      render,
      unmount: vi.fn()
    } as never);
    const dispose = vi.fn();
    vi.mocked(createWordPressMediaFramePort).mockReturnValue({
      dispose,
      open: vi.fn()
    });
    const wordpress = {
      apiFetch: Object.assign(vi.fn(), {
        nonceMiddleware: { nonce: 'nonce' }
      }),
      hooks: { addAction: vi.fn(), removeAction: vi.fn() }
    };

    const teardown = mountAdminEditor(bootstrap, {
      document,
      failureMessage: 'Editor failed',
      window,
      wordpress
    });

    expect(createWordPressMediaFramePort).toHaveBeenCalledWith({
      frameUrl: bootstrap.mediaPicker.frameUrl,
      window
    });
    teardown();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('forwards the clipboard fetch RequestInit, including its abort signal', async () => {
    const render = vi.fn();
    const unmount = vi.fn();
    vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
    const originalFetch = window.fetch;
    const windowFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve({} as Response)
    );
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      writable: true,
      value: windowFetch
    });

    try {
      mountAdminEditor(bootstrap, {
        document,
        failureMessage: 'Editor failed',
        window,
        wordpress: {
          apiFetch: Object.assign(vi.fn(), {
            nonceMiddleware: { nonce: 'nonce' }
          }),
          hooks: { addAction: vi.fn(), removeAction: vi.fn() }
        }
      });

      const fetchAdapter = vi.mocked(createBrowserWechatClipboard).mock
        .calls[0]?.[0]?.fetch;
      expect(fetchAdapter).toEqual(expect.any(Function));
      const signal = new AbortController().signal;
      const init: RequestInit = {
        credentials: 'same-origin',
        signal
      };

      await fetchAdapter?.('/assets/images/theme.png', init);

      expect(windowFetch).toHaveBeenCalledWith(
        '/assets/images/theme.png',
        init
      );
    } finally {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch
      });
    }
  });

  it('reports a prevented native publish as unsuccessful', () => {
    const render = vi.fn();
    vi.mocked(createRoot).mockReturnValue({
      render,
      unmount: vi.fn()
    } as never);
    const form = document.querySelector<HTMLFormElement>('#post');
    const publish = document.querySelector<HTMLButtonElement>('#publish');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    vi.spyOn(publish as HTMLButtonElement, 'click').mockImplementation(() => {
      publish?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
      form?.dispatchEvent(
        new SubmitEvent('submit', { bubbles: true, cancelable: true })
      );
    });

    mountAdminEditor(bootstrap, {
      document,
      failureMessage: 'Editor failed',
      window,
      wordpress: {
        apiFetch: Object.assign(vi.fn(), {
          nonceMiddleware: { nonce: 'nonce' }
        }),
        hooks: { addAction: vi.fn(), removeAction: vi.fn() }
      }
    });

    const rendered = render.mock.calls[0]?.[0] as {
      props: {
        children: {
          props: { publishPost: (session: never) => boolean };
        };
      };
    };
    expect(rendered.props.children.props.publishPost({} as never)).toBe(false);
  });

  it.each([
    ['title', '#title'],
    ['native editor', '#postdivrich']
  ])(
    'mounts when a supported post type has no optional %s field',
    (_label, selector) => {
      document.querySelector(selector)?.remove();
      const render = vi.fn();
      vi.mocked(createRoot).mockReturnValue({
        render,
        unmount: vi.fn()
      } as never);

      expect(() =>
        mountAdminEditor(bootstrap, {
          document,
          failureMessage: 'Editor failed',
          window,
          wordpress: {
            apiFetch: Object.assign(vi.fn(), {
              nonceMiddleware: { nonce: 'nonce' }
            }),
            hooks: { addAction: vi.fn(), removeAction: vi.fn() }
          }
        })
      ).not.toThrow();

      expect(render).toHaveBeenCalledOnce();
      const rendered = render.mock.calls[0]?.[0] as {
        props: { children: { props: { titleField: HTMLInputElement | null } } };
      };
      expect(rendered.props.children.props.titleField).toBe(
        'title' === _label ? null : document.querySelector('#title')
      );
    }
  );

  it('fails before mounting when the delegated root is not empty', () => {
    document
      .querySelector('#easymde-editor-root')
      ?.append(document.createElement('span'));
    expect(() =>
      mountAdminEditor(bootstrap, {
        document,
        failureMessage: 'Editor failed',
        window,
        wordpress: {
          apiFetch: Object.assign(vi.fn(), {
            nonceMiddleware: { nonce: 'nonce' }
          }),
          hooks: { addAction: vi.fn(), removeAction: vi.fn() }
        }
      })
    ).toThrow('react-editor-root-not-empty');
    expect(createRoot).not.toHaveBeenCalled();
  });
});
