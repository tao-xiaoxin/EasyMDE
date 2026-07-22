import { createRoot } from '@wordpress/element';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEditorRootBootstrap } from '../contracts/bootstrap/editor-root-bootstrap';
import { createBrowserLocalDraftStorage } from '../integrations/browser/local-drafts/browser-local-draft-storage';
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
  fonts: {},
  imageUpload: { endpoint: '/media', nonce: 'nonce', postId: 7 },
  immersiveStrings: {
    cancel: 'Cancel',
    characters: 'characters',
    edit: 'Edit',
    exit: 'Exit immersive writing',
    hideOutline: 'Hide outline',
    history: 'History',
    historyEmpty: 'No revisions',
    historyError: 'Revision error',
    historyLoading: 'Loading revisions',
    immersive: 'Immersive writing',
    insert: 'Insert',
    minutes: 'minutes',
    noHeadings: 'No headings',
    outline: 'Article outline',
    preview: 'Preview',
    publish: 'Publish article',
    readingTime: 'About',
    restore: 'Restore revision',
    restoreConfirm: 'Unsaved changes will be lost',
    saved: 'Saved',
    showOutline: 'Show outline',
    split: 'Split',
    table: 'Table',
    tableColumns: 'Columns',
    tableRows: 'Rows',
    title: 'Article title',
    unsaved: 'Unsaved',
    viewModes: 'View modes',
    wechat: 'Copy to WeChat',
    words: 'words'
  },
  labels: {
    mediaPickerFailure: 'Media failed',
    preview: 'Preview',
    source: 'Markdown',
    toolbar: 'Toolbar'
  },
  layout: {},
  localDrafts: { postId: 7 },
  mediaPicker: {},
  preview: { postId: 7 },
  previewEnhancement: { assetBaseUrl: 'https://example.test/plugin/' },
  toolbar: { commands: [], shortcuts: [] },
  wechatExport: {},
  wordpress: {
    customCssUrl: '/custom-css',
    nonce: 'nonce',
    previewUrl: '/preview',
    revisionsUrl: '/posts/'
  }
};

describe('mountAdminEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <form id="post">
        <input id="post_ID" value="11">
        <input id="title" value="Title">
        <textarea id="easymde-source"># Markdown</textarea>
        <input id="easymde-code-theme-field">
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
    const publishClick = vi.spyOn(publish as HTMLButtonElement, 'click');
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
    expect(
      nativeEditor?.classList.contains('easymde-native-editor-hidden')
    ).toBe(false);
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
