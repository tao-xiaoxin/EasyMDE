import { describe, expect, it } from 'vitest';

import { parseEditorRootBootstrap } from './editor-root-bootstrap';

function validBootstrap() {
  return {
    schemaVersion: 1,
    document: { strings: { editorLabel: 'Markdown source' } },
    preview: {
      codeTheme: 'atom-one-dark',
      customCssId: '',
      features: { highlight: true, mermaid: false },
      html: '<p>Sanitized preview</p>',
      markdownTheme: 'default',
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
      schemaVersion: 1,
      document: { editorLabel: 'Markdown source' },
      labels: {
        preview: 'Preview',
        source: 'Markdown',
        toolbar: 'Markdown toolbar'
      },
      preview: {
        codeTheme: 'atom-one-dark',
        customCssId: '',
        features: { highlight: true, mermaid: false },
        html: '<p>Sanitized preview</p>',
        markdownTheme: 'default',
        messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
        postId: 7,
        signature: 'stored-signature'
      },
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
