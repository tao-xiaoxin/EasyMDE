import { describe, expect, it } from 'vitest';

import { previewEnhancementBootstrapFixture } from '../../test/preview-enhancement-bootstrap-fixture';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../test/fixtures/appearance-bootstrap';
import { parseEditorRootBootstrap } from './editor-root-bootstrap';

function validBootstrap() {
  return {
    appearance: {
      articleThemes: [{ id: 'default', label: 'Default' }],
      codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
      customCss: [],
      customCssVariables,
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
        customCssDialog: customCssDialogStrings,
        namedCustomCss: 'Named CSS',
        saveCss: 'Save CSS'
      }
    },
    schemaVersion: 2,
    document: { strings: { editorLabel: 'Markdown source' } },
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
    imageUpload: {
      enabled: true,
      endpoint: 'https://example.test/wp-json/easymde/v1/media',
      maxBytes: 1024,
      nonce: 'synthetic-nonce',
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
    layout: {
      direction: 'ltr' as const,
      status: {
        lastEdited: 'Last edited by Editor on July 27, 2026 at 10:00',
        wordCount: 'Character count: %s'
      }
    },
    localDrafts: {
      enabled: true,
      locale: 'en_US',
      maxBytes: 1048576,
      postId: 7,
      savedFingerprint: 'saved-fingerprint',
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
    preview: {
      features: { highlight: true, mermaid: false },
      html: '<p>Sanitized preview</p>',
      messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
      postId: 7,
      signature: 'stored-signature'
    },
    previewEnhancement: previewEnhancementBootstrapFixture,
    strings: {
      immersive: {
        autoSave: 'Auto save',
        autoSaveDescription: 'Automatically save a local draft',
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
        resizeSplit: 'Resize editor and Preview',
        saved: 'Saved',
        settings: 'Settings',
        showOutline: 'Show outline',
        split: 'Split',
        splitMode: 'Split mode',
        splitPreview: 'Split preview',
        splitPreviewDescription: 'Show live preview by default',
        syncScroll: 'Synchronized scrolling',
        syncScrollDescription: 'Keep the editor and preview in sync',
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
        openAfterPublish: 'Open after publishing',
        openAfterPublishDescription: 'Open the article after submission.',
        openAfterUpdate: 'Open after updating',
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
        publishOptions: 'Publish options',
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
        wechatCopied: 'Copied',
        wordCount: 'Word count',
        wordCountDescription: 'Show words, characters, and reading time beside the title'
      },
      mediaPickerFailure: 'The media library could not open.',
      preview: 'Preview',
      source: 'Markdown',
      toolbar: 'Markdown toolbar'
    },
    toolbar: {
      commands: [
        {
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        }
      ],
      shortcuts: { bold: { mac: 'Cmd+B', win: 'Ctrl+B' } },
      strings: {
        headingLabelFormat: 'Heading %s',
        headingLevel: 'Heading level',
        headings: 'Headings',
        linkText: 'link text',
        undo: 'Undo'
      }
    },
    wechatExport: {
      enabled: true,
      strings: {
        failed: 'Copy failed',
        success: 'Copied',
        unsupported: 'Clipboard unsupported'
      }
    },
    wordpress: {
      customCssUrl: 'https://example.test/wp-json/easymde/v1/custom-css',
      nonce: 'synthetic-nonce',
      publishCategories: [
        {
          children: [{ children: [], id: '3', label: 'Child' }],
          id: '2',
          label: 'Parent'
        }
      ],
      previewUrl: 'https://example.test/wp-json/easymde/v1/preview',
      revisionsUrl: 'https://example.test/wp-json/easymde/v1/posts/'
    }
  };
}

describe('parseEditorRootBootstrap', () => {
  it('validates the complete single-root bootstrap contract', () => {
    expect(parseEditorRootBootstrap(validBootstrap())).toEqual({
      appearance: validBootstrap().appearance,
      schemaVersion: 2,
      document: { editorLabel: 'Markdown source' },
      fonts: validBootstrap().fonts,
      imageUpload: validBootstrap().imageUpload,
      immersiveStrings: validBootstrap().strings.immersive,
      layout: {
        direction: 'ltr',
        status: {
          lastEdited: 'Last edited by Editor on July 27, 2026 at 10:00',
          wordCount: 'Character count: %s'
        }
      },
      localDrafts: validBootstrap().localDrafts,
      labels: {
        mediaPickerFailure: 'The media library could not open.',
        preview: 'Preview',
        source: 'Markdown',
        toolbar: 'Markdown toolbar'
      },
      preview: {
        features: { highlight: true, mermaid: false },
        html: '<p>Sanitized preview</p>',
        messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
        postId: 7,
        signature: 'stored-signature'
      },
      previewEnhancement: previewEnhancementBootstrapFixture,
      mediaPicker: validBootstrap().mediaPicker,
      toolbar: expect.objectContaining({
        headingLabelFormat: 'Heading %s',
        headingLevelLabel: 'Heading level',
        headingsLabel: 'Headings',
        linkText: 'link text',
        undoLabel: 'Undo'
      }),
      wechatExport: validBootstrap().wechatExport,
      wordpress: validBootstrap().wordpress
    });
  });

  it.each([
    [null, 'editor-root-bootstrap-invalid'],
    [
      { ...validBootstrap(), schemaVersion: 1 },
      'editor-root-schema-unsupported'
    ],
    [{ ...validBootstrap(), document: null }, 'editor-root-document-invalid'],
    [
      { ...validBootstrap(), appearance: null },
      'editor-root-appearance-invalid'
    ],
    [
      {
        ...validBootstrap(),
        appearance: {
          ...validBootstrap().appearance,
          articleThemes: [
            {
              fontDefaults: {
                appleFont: 'missing',
                customFont: 'none',
                serifFont: 'off',
                windowsFont: 'system'
              },
              id: 'default',
              label: 'Default'
            }
          ]
        }
      },
      'editor-root-appearance-invalid'
    ],
    [{ ...validBootstrap(), fonts: null }, 'editor-root-fonts-invalid'],
    [
      { ...validBootstrap(), imageUpload: null },
      'editor-root-image-upload-invalid'
    ],
    [{ ...validBootstrap(), layout: null }, 'editor-root-layout-invalid'],
    [
      { ...validBootstrap(), localDrafts: null },
      'editor-root-local-drafts-invalid'
    ],
    [
      { ...validBootstrap(), mediaPicker: null },
      'editor-root-media-picker-invalid'
    ],
    [
      { ...validBootstrap(), previewEnhancement: null },
      'editor-root-preview-enhancement-invalid'
    ],
    [{ ...validBootstrap(), toolbar: null }, 'editor-root-toolbar-invalid'],
    [
      { ...validBootstrap(), wechatExport: null },
      'editor-root-wechat-export-invalid'
    ],
    [
      {
        ...validBootstrap(),
        strings: { ...validBootstrap().strings, source: '' }
      },
      'editor-root-label-invalid'
    ],
    [
      {
        ...validBootstrap(),
        preview: { ...validBootstrap().preview, postId: -1 }
      },
      'editor-root-preview-invalid'
    ],
    [
      {
        ...validBootstrap(),
        preview: { ...validBootstrap().preview, features: { mermaid: 'yes' } }
      },
      'editor-root-preview-invalid'
    ],
    [
      {
        ...validBootstrap(),
        preview: { ...validBootstrap().preview, html: null }
      },
      'editor-root-preview-invalid'
    ]
  ])('rejects an invalid external contract with stable code', (value, code) => {
    expect(() => parseEditorRootBootstrap(value)).toThrowError(
      expect.objectContaining({ code })
    );
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects the prototype-reserved preview feature key %s',
    (key) => {
      const features = JSON.parse(`{"${key}":true}`) as Record<string, boolean>;
      const bootstrap = validBootstrap();

      expect(() =>
        parseEditorRootBootstrap({
          ...bootstrap,
          preview: { ...bootstrap.preview, features }
        })
      ).toThrowError(
        expect.objectContaining({ code: 'editor-root-preview-invalid' })
      );
    }
  );
});
