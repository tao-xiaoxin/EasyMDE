import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

class FormDataStub {
  constructor() {
    this.entries = [];
  }

  append(name, value, filename) {
    this.entries.push({ name, value, filename });
  }
}

function loadImagePaste(windowOverrides = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/image-paste.js'), 'utf8');
  const windowRef = {
    FormData: FormDataStub,
    ...windowOverrides
  };
  const context = {
    window: windowRef
  };

  vm.runInNewContext(source, context);

  return {
    imagePaste: context.window.EasyMDEImagePaste,
    window: context.window
  };
}

function imagePasteEvent(file) {
  let prevented = false;

  return {
    clipboardData: {
      items: [
        {
          kind: 'file',
          type: file.type,
          getAsFile() {
            return file;
          }
        }
      ]
    },
    get prevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    }
  };
}

function textPasteEvent() {
  let prevented = false;

  return {
    clipboardData: {
      items: [
        {
          kind: 'string',
          type: 'text/plain'
        }
      ]
    },
    get prevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    }
  };
}

function createTextarea(value = '') {
  return {
    value,
    selectionStart: value.length,
    selectionEnd: value.length
  };
}

function createOptions(overrides = {}) {
  const flashes = [];
  const options = {
    config: {
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imageUpload: {
        enabled: true,
        maxBytes: 1024 * 1024
      },
      nonce: 'test-nonce'
    },
    flash: {},
    getString(key, fallback) {
      return fallback || key;
    },
    postId: 17,
    showFlash(flash, type, message) {
      flashes.push({ type, message });
    },
    applyTextChange(textarea, value, selectionStart, selectionEnd) {
      textarea.value = value;
      textarea.selectionStart = selectionStart;
      textarea.selectionEnd = selectionEnd;
    },
    ...overrides
  };

  return {
    flashes,
    options
  };
}

test('image paste uploads a local clipboard image and inserts Markdown', async () => {
  let capturedFetch = null;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch(options) {
        capturedFetch = options;

        return Promise.resolve({
          alt: 'screen shot',
          url: 'https://example.test/uploads/screen.png'
        });
      }
    }
  });
  const textarea = createTextarea('Intro\n');
  const event = imagePasteEvent({
    name: 'screen-shot',
    size: 256,
    type: 'image/png'
  });
  const { flashes, options } = createOptions();

  await imagePaste.handlePaste(event, textarea, options);

  assert.equal(event.prevented, true);
  assert.equal(capturedFetch.url, '/wp-json/easymde/v1/media');
  assert.equal(capturedFetch.method, 'POST');
  assert.equal(capturedFetch.headers['X-WP-Nonce'], 'test-nonce');
  assert.equal(capturedFetch.body.entries.find((entry) => entry.name === 'file').filename, 'screen-shot.png');
  assert.equal(capturedFetch.body.entries.find((entry) => entry.name === 'post_id').value, '17');
  assert.equal(capturedFetch.body.entries.find((entry) => entry.name === 'alt_text').value, 'screen shot');
  assert.equal(textarea.value, 'Intro\n![screen shot](https://example.test/uploads/screen.png)');
  assert.equal(textarea.selectionStart, textarea.value.length);
  assert.deepEqual(flashes, [
    {
      type: 'info',
      message: 'imagePasteUploading'
    },
    {
      type: 'success',
      message: 'imagePasteUploaded'
    }
  ]);
});

test('image paste ignores non-image clipboard content', () => {
  let apiFetchCalled = false;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
      }
    }
  });
  const textarea = createTextarea('Text');
  const event = textPasteEvent();
  const { options } = createOptions();

  assert.equal(imagePaste.handlePaste(event, textarea, options), false);
  assert.equal(event.prevented, false);
  assert.equal(apiFetchCalled, false);
  assert.equal(textarea.value, 'Text');
});

test('image paste leaves the clipboard alone when upload is disabled', () => {
  let apiFetchCalled = false;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
      }
    }
  });
  const textarea = createTextarea('Draft');
  const event = imagePasteEvent({
    name: 'disabled.png',
    size: 128,
    type: 'image/png'
  });
  const { flashes, options } = createOptions({
    config: {
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imageUpload: {
        enabled: false
      },
      nonce: 'test-nonce'
    }
  });

  assert.equal(imagePaste.handlePaste(event, textarea, options), false);
  assert.equal(event.prevented, false);
  assert.equal(apiFetchCalled, false);
  assert.equal(textarea.value, 'Draft');
  assert.deepEqual(flashes, []);
});

test('image paste rejects oversized clipboard images before upload', async () => {
  let apiFetchCalled = false;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
      }
    }
  });
  const textarea = createTextarea('Draft');
  const event = imagePasteEvent({
    name: 'large.png',
    size: 4096,
    type: 'image/png'
  });
  const { flashes, options } = createOptions({
    config: {
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imageUpload: {
        enabled: true,
        maxBytes: 1024
      },
      nonce: 'test-nonce'
    }
  });

  await imagePaste.handlePaste(event, textarea, options);

  assert.equal(event.prevented, true);
  assert.equal(apiFetchCalled, false);
  assert.equal(textarea.value, 'Draft');
  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'imagePasteTooLarge'
    }
  ]);
});

test('image paste reports upload failure without mutating Markdown', async () => {
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        return Promise.reject(new Error('upload failed'));
      }
    }
  });
  const textarea = createTextarea('Before');
  const event = imagePasteEvent({
    name: 'broken.png',
    size: 128,
    type: 'image/png'
  });
  const { flashes, options } = createOptions();

  await imagePaste.handlePaste(event, textarea, options);

  assert.equal(event.prevented, true);
  assert.equal(textarea.value, 'Before');
  assert.deepEqual(flashes, [
    {
      type: 'info',
      message: 'imagePasteUploading'
    },
    {
      type: 'error',
      message: 'imagePasteFailed'
    }
  ]);
});
