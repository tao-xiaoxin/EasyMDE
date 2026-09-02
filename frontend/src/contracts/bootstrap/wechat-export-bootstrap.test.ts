import { describe, expect, it } from 'vitest';

import { parseWechatExportBootstrap } from './wechat-export-bootstrap';

describe('parseWechatExportBootstrap', () => {
  it('accepts the focused enabled flag and translated messages', () => {
    expect(parseWechatExportBootstrap({
      enabled: true,
      pngConversionEnabled: false,
      strings: {
        failed: 'Copy failed.',
        success: 'Copied.',
        unsupported: 'Clipboard unavailable.'
      }
    })).toEqual({
      enabled: true,
      pngConversionEnabled: false,
      strings: {
        failed: 'Copy failed.',
        success: 'Copied.',
        unsupported: 'Clipboard unavailable.'
      }
    });
  });

  it('requires PNG conversion enablement to be a strict boolean', () => {
    for (const value of [undefined, 'false', 0, null]) {
      expect(() => parseWechatExportBootstrap({
        enabled: true,
        pngConversionEnabled: value,
        strings: { failed: 'x', success: 'x', unsupported: 'x' },
      })).toThrow('wechat-export-png-conversion-invalid');
    }
  });

  it('requires the export enabled flag to be a strict boolean', () => {
    for (const value of [undefined, 'true', 1, null]) {
      expect(() => parseWechatExportBootstrap({
        enabled: value,
        pngConversionEnabled: false,
        strings: { failed: 'x', success: 'x', unsupported: 'x' },
      })).toThrow('wechat-export-enabled-invalid');
    }
  });

  it('rejects incomplete or unbounded bootstrap values', () => {
    expect(() => parseWechatExportBootstrap(null)).toThrow('wechat-export-bootstrap-invalid');
    expect(() => parseWechatExportBootstrap({ enabled: true, pngConversionEnabled: false, strings: { failed: '' } }))
      .toThrow('wechat-export-string-invalid');
    expect(() => parseWechatExportBootstrap({
      enabled: true,
      pngConversionEnabled: false,
      strings: { failed: 'x', success: 'x', unsupported: 'x'.repeat(513) }
    })).toThrow('wechat-export-string-invalid');
  });
});
