import { describe, expect, it } from 'vitest';

import { parseEditorRootBootstrap } from './editor-root-bootstrap';

function validBootstrap() {
  return {
    appearance: {
      articleThemes: [{ id: 'default', label: 'Default' }],
      codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
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
    schemaVersion: 1,
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
    strings: {
      preview: 'Preview',
      source: 'Markdown',
      toolbar: 'Markdown toolbar'
    },
    toolbar: {
      commands: [{
        action: 'wrap',
        group: 'format',
        icon: 'editor-bold',
        id: 'bold',
        label: 'Bold',
        prefix: '**',
        suffix: '**',
        surface: 'main'
      }],
      shortcuts: { bold: { mac: 'Cmd+B', win: 'Ctrl+B' } },
      strings: { headings: 'Headings', linkText: 'link text' }
    }
  };
}

describe('parseEditorRootBootstrap', () => {
  it('validates the complete single-root bootstrap contract', () => {
    expect(parseEditorRootBootstrap(validBootstrap())).toEqual({
      appearance: validBootstrap().appearance,
      schemaVersion: 1,
      document: { editorLabel: 'Markdown source' },
      fonts: validBootstrap().fonts,
      imageUpload: validBootstrap().imageUpload,
      labels: {
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
      mediaPicker: validBootstrap().mediaPicker,
      toolbar: expect.objectContaining({
        headingsLabel: 'Headings',
        linkText: 'link text'
      })
    });
  });

  it.each([
    [null, 'editor-root-bootstrap-invalid'],
    [{ ...validBootstrap(), schemaVersion: 2 }, 'editor-root-schema-unsupported'],
    [{ ...validBootstrap(), document: null }, 'editor-root-document-invalid'],
    [{ ...validBootstrap(), appearance: null }, 'editor-root-appearance-invalid'],
    [{ ...validBootstrap(), fonts: null }, 'editor-root-fonts-invalid'],
    [{ ...validBootstrap(), imageUpload: null }, 'editor-root-image-upload-invalid'],
    [{ ...validBootstrap(), mediaPicker: null }, 'editor-root-media-picker-invalid'],
    [{ ...validBootstrap(), toolbar: null }, 'editor-root-toolbar-invalid'],
    [{ ...validBootstrap(), strings: { ...validBootstrap().strings, source: '' } }, 'editor-root-label-invalid'],
    [{ ...validBootstrap(), preview: { ...validBootstrap().preview, postId: -1 } }, 'editor-root-preview-invalid'],
    [{ ...validBootstrap(), preview: { ...validBootstrap().preview, features: { mermaid: 'yes' } } }, 'editor-root-preview-invalid'],
    [{ ...validBootstrap(), preview: { ...validBootstrap().preview, html: null } }, 'editor-root-preview-invalid']
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

      expect(() => parseEditorRootBootstrap({
        ...bootstrap,
        preview: { ...bootstrap.preview, features }
      })).toThrowError(expect.objectContaining({ code: 'editor-root-preview-invalid' }));
    }
  );
});
