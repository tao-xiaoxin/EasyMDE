import { describe, expect, it } from 'vitest';

import { parseLocalDraftsBootstrap } from './local-drafts-bootstrap';

const validBootstrap = {
  enabled: true,
  locale: 'zh_CN',
  maxBytes: 2_097_152,
  postId: 42,
  schemaVersion: 1,
  siteKey: 'a1b2c3d4e5f6',
  strings: {
    available: '有较新的本地草稿。',
    conflict: '另一个标签页中有较新的本地草稿。',
    discard: '丢弃草稿',
    discardFailed: '无法丢弃本地草稿。',
    discarded: '草稿已丢弃。',
    readFailed: '无法读取本地草稿。',
    restore: '恢复草稿',
    restored: '草稿已恢复。',
    saveFailed: '无法保存本地草稿。',
    saved: '本地草稿已保存'
  },
  timeZone: 'Asia/Shanghai',
  userId: 7
};

describe('parseLocalDraftsBootstrap', () => {
  it('parses the versioned storage identity and PHP-owned messages', () => {
    expect(parseLocalDraftsBootstrap(validBootstrap)).toEqual(validBootstrap);
  });

  it.each([
    ['schema', { ...validBootstrap, schemaVersion: 2 }],
    ['site', { ...validBootstrap, siteKey: '' }],
    ['user', { ...validBootstrap, userId: -1 }],
    ['post', { ...validBootstrap, postId: -1 }],
    ['limit', { ...validBootstrap, maxBytes: 0 }],
    ['locale', { ...validBootstrap, locale: '' }],
    ['timezone', { ...validBootstrap, timeZone: '' }],
    ['message', {
      ...validBootstrap,
      strings: { ...validBootstrap.strings, conflict: '' }
    }]
  ])('rejects an invalid %s contract', (_label, value) => {
    expect(() => parseLocalDraftsBootstrap(value)).toThrow();
  });
});
