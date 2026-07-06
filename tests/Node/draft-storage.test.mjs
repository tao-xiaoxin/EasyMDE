import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadDraftStorageForWindow(windowRef) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/draft-storage.js'), 'utf8');

  vm.runInNewContext(source, {
    Date,
    JSON,
    window: windowRef
  });

  return windowRef.EasyMDEDraftStorage;
}

function loadDraftStorage(localStorage) {
  return loadDraftStorageForWindow({
    localStorage
  });
}

test('draft storage caches localStorage availability checks', () => {
  const store = new Map();
  let setItemCalls = 0;
  let removeItemCalls = 0;
  const storage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    removeItem(key) {
      removeItemCalls += 1;
      store.delete(key);
    },
    setItem(key, value) {
      setItemCalls += 1;
      store.set(key, String(value));
    }
  };
  const draftStorage = loadDraftStorage(storage);
  const config = {
    storage: {
      siteKey: 'site',
      userId: 7
    }
  };
  const normalized = draftStorage.normalizeStorage(config, 123);

  assert.equal(draftStorage.exists(normalized), false);
  assert.equal(draftStorage.read(normalized), null);
  assert.equal(setItemCalls, 0);
  assert.equal(removeItemCalls, 0);
  draftStorage.write(normalized, 'Draft body');
  assert.equal(draftStorage.exists(normalized), true);
  assert.equal(draftStorage.read(normalized).content, 'Draft body');
  assert.equal(draftStorage.read(normalized).contentHash, draftStorage.contentFingerprint('Draft body'));
  assert.equal(draftStorage.readContentHash(normalized), draftStorage.contentFingerprint('Draft body'));
  draftStorage.discard(normalized);
  assert.equal(draftStorage.exists(normalized), false);
  assert.equal(draftStorage.readContentHash(normalized), '');

  assert.equal(setItemCalls, 3);
  assert.equal(removeItemCalls, 4);
});

test('draft content fingerprints use stable UTF-8 FNV-1a values', () => {
  const draftStorage = loadDraftStorage({});

  assert.equal(draftStorage.contentFingerprint(''), '0:811c9dc5');
  assert.equal(draftStorage.contentFingerprint('hello'), '5:4f9f2cab');
});

test('draft content fingerprints match TextEncoder and fallback paths', () => {
  const fallbackDraftStorage = loadDraftStorage({});
  const acceleratedDraftStorage = loadDraftStorageForWindow({
    localStorage: {},
    TextEncoder
  });
  const markdown = '# Title\n\nPlain **Markdown**, CJK text, and emoji: 中文 😀';

  assert.equal(
    acceleratedDraftStorage.contentFingerprint(markdown),
    fallbackDraftStorage.contentFingerprint(markdown)
  );
});

test('draft content fingerprints encode isolated surrogates like TextEncoder', () => {
  const fallbackDraftStorage = loadDraftStorage({});
  const acceleratedDraftStorage = loadDraftStorageForWindow({
    localStorage: {},
    TextEncoder
  });
  const markdown = 'Broken surrogate pair: \uD83D text \uDE00';

  assert.equal(
    acceleratedDraftStorage.contentFingerprint(markdown),
    fallbackDraftStorage.contentFingerprint(markdown)
  );
});

test('draft existence check avoids parsing draft JSON or probing storage writes', () => {
  const storage = {
    getItem() {
      return '{not valid json';
    },
    removeItem() {
      throw new Error('removeItem should not be called');
    },
    setItem() {
      throw new Error('setItem should not be called');
    }
  };
  const draftStorage = loadDraftStorage(storage);
  const normalized = {
    draftKey: 'easymde:draft:test'
  };

  assert.equal(draftStorage.exists(normalized), true);
});

test('draft storage treats blocked localStorage getters as unavailable', () => {
  const windowRef = {};

  Object.defineProperty(windowRef, 'localStorage', {
    get() {
      throw new Error('localStorage is blocked');
    }
  });

  const draftStorage = loadDraftStorageForWindow(windowRef);
  const normalized = {
    draftKey: 'easymde:draft:test'
  };

  assert.equal(draftStorage.exists(normalized), false);
  assert.equal(draftStorage.read(normalized), null);
  assert.doesNotThrow(() => draftStorage.write(normalized, 'Draft body'));
  assert.doesNotThrow(() => draftStorage.discard(normalized));
});
