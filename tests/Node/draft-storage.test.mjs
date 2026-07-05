import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadDraftStorage(localStorage) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/draft-storage.js'), 'utf8');
  const windowRef = {
    localStorage
  };

  vm.runInNewContext(source, {
    Date,
    JSON,
    window: windowRef
  });

  return windowRef.EasyMDEDraftStorage;
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
  draftStorage.write(normalized, 'Draft body');
  assert.equal(draftStorage.exists(normalized), true);
  assert.equal(draftStorage.read(normalized).content, 'Draft body');
  draftStorage.discard(normalized);
  assert.equal(draftStorage.exists(normalized), false);

  assert.equal(setItemCalls, 2);
  assert.equal(removeItemCalls, 2);
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
