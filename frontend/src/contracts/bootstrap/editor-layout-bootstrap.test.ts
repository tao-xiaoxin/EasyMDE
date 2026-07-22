import { describe, expect, it } from 'vitest';

import { editorLayoutBootstrapFixture } from '../../test/editor-layout-bootstrap-fixture';
import {
  type EditorLayoutBootstrapError,
  parseEditorLayoutBootstrap,
  resolveEditorNumberLocale
} from './editor-layout-bootstrap';

describe('parseEditorLayoutBootstrap', () => {
  it('validates every visible layout and insight string', () => {
    expect(parseEditorLayoutBootstrap(editorLayoutBootstrapFixture))
      .toEqual(editorLayoutBootstrapFixture);
  });

  it.each([
    ['pt_PT_ao90', 'pt-PT'],
    ['sr_RS_latin', 'sr-Latn-RS']
  ])('accepts WordPress locale variants and resolves %s for Intl', (locale, expected) => {
    expect(parseEditorLayoutBootstrap({ ...editorLayoutBootstrapFixture, locale }).locale)
      .toBe(locale);
    expect(resolveEditorNumberLocale(locale)).toBe(expected);
  });

  it('uses a deterministic source-locale fallback when Intl cannot format a WordPress locale', () => {
    expect(parseEditorLayoutBootstrap({ ...editorLayoutBootstrapFixture, locale: 'zzz_ZZ' }).locale)
      .toBe('zzz_ZZ');
    expect(resolveEditorNumberLocale('zzz_ZZ')).toBe('en-US');
  });

  it.each([
    'Line %1$s',
    'Line %1$s, Column %2$s, Page %3$s',
    'Line %s, Column %2$s',
    '%%1$s / %2$s'
  ])('rejects the incomplete or unsupported cursor template %s', (cursorPosition) => {
    expect(() => parseEditorLayoutBootstrap({
      ...editorLayoutBootstrapFixture,
      strings: { ...editorLayoutBootstrapFixture.strings, cursorPosition }
    })).toThrowError(
      expect.objectContaining<Partial<EditorLayoutBootstrapError>>({
        code: 'editor-layout-cursor-position-invalid'
      })
    );
  });

  it.each([
    [null, 'editor-layout-bootstrap-invalid'],
    [{ ...editorLayoutBootstrapFixture, strings: null }, 'editor-layout-bootstrap-invalid'],
    [{ ...editorLayoutBootstrapFixture, direction: 'auto' }, 'editor-layout-direction-invalid'],
    [{ ...editorLayoutBootstrapFixture, locale: '../../locale' }, 'editor-layout-locale-invalid'],
    [{
      ...editorLayoutBootstrapFixture,
      strings: { ...editorLayoutBootstrapFixture.strings, resizePanes: '' }
    }, 'editor-layout-string-invalid']
  ])('rejects an invalid contract', (value, code) => {
    expect(() => parseEditorLayoutBootstrap(value)).toThrowError(
      expect.objectContaining<Partial<EditorLayoutBootstrapError>>({ code })
    );
  });
});
