import { describe, expect, it } from 'vitest';

import { parseWechatExportBootstrap } from './wechat-export-bootstrap';

describe('parseWechatExportBootstrap', () => {
  it('accepts the focused enabled flag and translated messages', () => {
    expect(parseWechatExportBootstrap({
      enabled: true,
      strings: {
        failed: 'Copy failed.',
        success: 'Copied.',
        unsupported: 'Clipboard unavailable.'
      }
    })).toEqual({
      enabled: true,
      strings: {
        failed: 'Copy failed.',
        success: 'Copied.',
        unsupported: 'Clipboard unavailable.'
      }
    });
  });

  it('rejects incomplete or unbounded bootstrap values', () => {
    expect(() => parseWechatExportBootstrap(null)).toThrow('wechat-export-bootstrap-invalid');
    expect(() => parseWechatExportBootstrap({ enabled: true, strings: { failed: '' } }))
      .toThrow('wechat-export-string-invalid');
    expect(() => parseWechatExportBootstrap({
      enabled: true,
      strings: { failed: 'x', success: 'x', unsupported: 'x'.repeat(513) }
    })).toThrow('wechat-export-string-invalid');
  });
});
