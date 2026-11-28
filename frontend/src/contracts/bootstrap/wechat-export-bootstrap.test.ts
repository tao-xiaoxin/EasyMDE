import { describe, expect, it } from 'vitest';

import { parseWechatExportBootstrap } from './wechat-export-bootstrap';

const atlasContentVersion = '0123456789abcdef';
const assetBaseUrl = 'https://example.test/wp-content/plugins/easymde/';
const atlasUrl = `${assetBaseUrl}assets/math/easymde-katex-glyph-atlas.json?contentversion=${atlasContentVersion}`;

function validBootstrap() {
  return {
    enabled: true,
    pngConversionEnabled: false,
    strings: { failed: 'x', failedWithUploads: 'x', success: 'x', unsupported: 'x' },
    wechatMathAtlasContentVersion: atlasContentVersion,
    wechatMathAtlasUrl: atlasUrl
  };
}

describe('parseWechatExportBootstrap', () => {
  it('accepts the focused enabled flag and translated messages', () => {
    expect(parseWechatExportBootstrap({
      enabled: true,
      pngConversionEnabled: false,
      wechatMathAtlasContentVersion: atlasContentVersion,
      wechatMathAtlasUrl: atlasUrl,
      strings: {
        failed: 'Copy failed.',
        failedWithUploads: 'Copy failed after uploading images.',
        success: 'Copied.',
        unsupported: 'Clipboard unavailable.'
      }
    }, assetBaseUrl)).toEqual({
      enabled: true,
      pngConversionEnabled: false,
      wechatMathAtlasContentVersion: atlasContentVersion,
      wechatMathAtlasUrl: atlasUrl,
      strings: {
        failed: 'Copy failed.',
        failedWithUploads: 'Copy failed after uploading images.',
        success: 'Copied.',
        unsupported: 'Clipboard unavailable.'
      }
    });
  });

  it('requires PNG conversion enablement to be a strict boolean', () => {
    for (const value of [undefined, 'false', 0, null]) {
      expect(() => parseWechatExportBootstrap({
        ...validBootstrap(),
        pngConversionEnabled: value,
      }, assetBaseUrl)).toThrow('wechat-export-png-conversion-invalid');
    }
  });

  it('requires the export enabled flag to be a strict boolean', () => {
    for (const value of [undefined, 'true', 1, null]) {
      expect(() => parseWechatExportBootstrap({
        ...validBootstrap(),
        enabled: value,
      }, assetBaseUrl)).toThrow('wechat-export-enabled-invalid');
    }
  });

  it('requires the approved asset base as parser context', () => {
    for (const base of [undefined, null, '', ' ', 42]) {
      expect(() => parseWechatExportBootstrap(validBootstrap(), base))
        .toThrow('wechat-export-asset-base-url-invalid');
    }
  });

  it('accepts root and subdirectory WordPress asset bases with the same origin', () => {
    for (const base of [
      'https://example.test/wp-content/plugins/easymde/',
      'https://example.test/site/wp-content/plugins/easymde/'
    ]) {
      const url = `${base}assets/math/easymde-katex-glyph-atlas.json?contentversion=${atlasContentVersion}`;
      expect(parseWechatExportBootstrap({
        ...validBootstrap(),
        wechatMathAtlasUrl: url
      }, base).wechatMathAtlasUrl).toBe(url);
    }
  });

  it('requires a bounded hash-derived atlas version paired to the local atlas URL', () => {
    for (const version of [undefined, '', '0123456789abcde', '0123456789abcdef0', 'ABCDEF0123456789']) {
      expect(() => parseWechatExportBootstrap({
        ...validBootstrap(),
        wechatMathAtlasContentVersion: version
      }, assetBaseUrl)).toThrow('wechat-export-math-atlas-content-version-invalid');
    }

    for (const url of [
      undefined,
      '',
      'https://cdn.example.test/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef',
      '/wp-content/plugins/easymde/assets/math/other.json?contentversion=0123456789abcdef',
      '/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdee',
      '/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef&contentversion=0123456789abcdef',
      '/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef&cache=1',
      '/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef#fragment'
    ]) {
      expect(() => parseWechatExportBootstrap({
        ...validBootstrap(),
        wechatMathAtlasUrl: url
      }, assetBaseUrl)).toThrow('wechat-export-math-atlas-url-invalid');
    }
  });

  it('rejects incomplete or unbounded bootstrap values', () => {
    expect(() => parseWechatExportBootstrap(null, assetBaseUrl)).toThrow('wechat-export-bootstrap-invalid');
    expect(() => parseWechatExportBootstrap({ ...validBootstrap(), strings: { ...validBootstrap().strings, failed: '' } }, assetBaseUrl))
      .toThrow('wechat-export-string-invalid');
    expect(() => parseWechatExportBootstrap({
      ...validBootstrap(),
      strings: { failed: 'x', success: 'x', unsupported: 'x' }
    }, assetBaseUrl)).toThrow('wechat-export-string-invalid');
    expect(() => parseWechatExportBootstrap({
      ...validBootstrap(),
      strings: { ...validBootstrap().strings, unsupported: 'x'.repeat(513) }
    }, assetBaseUrl)).toThrow('wechat-export-string-invalid');
  });
});
