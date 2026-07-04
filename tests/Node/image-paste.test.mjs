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

function imageDropEvent(file) {
  let prevented = false;

  return {
    dataTransfer: {
      dropEffect: 'move',
      files: [file],
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

function textDropEvent() {
  let prevented = false;

  return {
    dataTransfer: {
      dropEffect: 'move',
      files: [],
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

test('image drop uploads a local image file and inserts Markdown', async () => {
  let capturedFetch = null;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch(options) {
        capturedFetch = options;

        return Promise.resolve({
          alt: 'dropped image',
          url: 'https://example.test/uploads/dropped-image.png'
        });
      }
    }
  });
  const textarea = createTextarea('Intro\n');
  const event = imageDropEvent({
    name: 'dropped-image.png',
    size: 256,
    type: 'image/png'
  });
  const { flashes, options } = createOptions();

  await imagePaste.handleDrop(event, textarea, options);

  assert.equal(event.prevented, true);
  assert.equal(capturedFetch.url, '/wp-json/easymde/v1/media');
  assert.equal(capturedFetch.method, 'POST');
  assert.equal(capturedFetch.headers['X-WP-Nonce'], 'test-nonce');
  assert.equal(capturedFetch.body.entries.find((entry) => entry.name === 'file').filename, 'dropped-image.png');
  assert.equal(capturedFetch.body.entries.find((entry) => entry.name === 'post_id').value, '17');
  assert.equal(capturedFetch.body.entries.find((entry) => entry.name === 'alt_text').value, 'dropped image');
  assert.equal(textarea.value, 'Intro\n![dropped image](https://example.test/uploads/dropped-image.png)');
  assert.equal(textarea.selectionStart, textarea.value.length);
  assert.deepEqual(flashes, [
    {
      type: 'info',
      message: 'imageDropUploading'
    },
    {
      type: 'success',
      message: 'imageDropUploaded'
    }
  ]);
});

test('image drop preserves the drop insertion point while upload is pending', async () => {
  let resolveUpload;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        return new Promise((resolve) => {
          resolveUpload = resolve;
        });
      }
    }
  });
  const textarea = createTextarea('Hello world');
  textarea.selectionStart = 5;
  textarea.selectionEnd = 5;
  const event = imageDropEvent({
    name: 'drop-cursor.png',
    size: 256,
    type: 'image/png'
  });
  const { options } = createOptions();
  const dropPromise = imagePaste.handleDrop(event, textarea, options);

  textarea.selectionStart = textarea.value.length;
  textarea.selectionEnd = textarea.value.length;
  textarea.value += ' after drop';

  resolveUpload({
    alt: 'drop cursor',
    url: 'https://example.test/uploads/drop-cursor.png'
  });
  await dropPromise;

  assert.equal(textarea.value, 'Hello![drop cursor](https://example.test/uploads/drop-cursor.png) world after drop');
  assert.equal(textarea.selectionStart, 'Hello![drop cursor](https://example.test/uploads/drop-cursor.png)'.length);
  assert.equal(textarea.selectionEnd, textarea.selectionStart);
});

test('image drop ignores non-image dragged content', () => {
  let apiFetchCalled = false;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
      }
    }
  });
  const textarea = createTextarea('Text');
  const event = textDropEvent();
  const { options } = createOptions();

  assert.equal(imagePaste.handleDrop(event, textarea, options), false);
  assert.equal(event.prevented, false);
  assert.equal(apiFetchCalled, false);
  assert.equal(textarea.value, 'Text');
});

test('image drop leaves the browser event alone when upload is disabled', () => {
  let apiFetchCalled = false;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
      }
    }
  });
  const textarea = createTextarea('Draft');
  const event = imageDropEvent({
    name: 'disabled-drop.png',
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

  assert.equal(imagePaste.handleDrop(event, textarea, options), false);
  assert.equal(event.prevented, false);
  assert.equal(apiFetchCalled, false);
  assert.equal(textarea.value, 'Draft');
  assert.deepEqual(flashes, []);
});

test('image drop rejects oversized local images before upload', async () => {
  let apiFetchCalled = false;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
      }
    }
  });
  const textarea = createTextarea('Draft');
  const event = imageDropEvent({
    name: 'large-drop.png',
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

  await imagePaste.handleDrop(event, textarea, options);

  assert.equal(event.prevented, true);
  assert.equal(apiFetchCalled, false);
  assert.equal(textarea.value, 'Draft');
  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'imageDropTooLarge'
    }
  ]);
});

test('image dragover advertises copy only for uploadable local images', () => {
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {}
    }
  });
  const imageEvent = imageDropEvent({
    name: 'drag.png',
    size: 128,
    type: 'image/png'
  });
  const textEvent = textDropEvent();
  const disabledEvent = imageDropEvent({
    name: 'disabled.png',
    size: 128,
    type: 'image/png'
  });
  const textarea = createTextarea('Draft');
  const { options } = createOptions();
  const disabledOptions = createOptions({
    config: {
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imageUpload: {
        enabled: false
      },
      nonce: 'test-nonce'
    }
  }).options;

  assert.equal(imagePaste.handleDragOver(imageEvent, textarea, options), true);
  assert.equal(imageEvent.prevented, true);
  assert.equal(imageEvent.dataTransfer.dropEffect, 'copy');

  assert.equal(imagePaste.handleDragOver(textEvent, textarea, options), false);
  assert.equal(textEvent.prevented, false);
  assert.equal(textEvent.dataTransfer.dropEffect, 'move');

  assert.equal(imagePaste.handleDragOver(disabledEvent, textarea, disabledOptions), false);
  assert.equal(disabledEvent.prevented, false);
  assert.equal(disabledEvent.dataTransfer.dropEffect, 'move');
});

test('image paste preserves the paste insertion point while upload is pending', async () => {
  let resolveUpload;
  const { imagePaste } = loadImagePaste({
    wp: {
      apiFetch() {
        return new Promise((resolve) => {
          resolveUpload = resolve;
        });
      }
    }
  });
  const textarea = createTextarea('Hello world');
  textarea.selectionStart = 5;
  textarea.selectionEnd = 5;
  const event = imagePasteEvent({
    name: 'cursor.png',
    size: 256,
    type: 'image/png'
  });
  const { options } = createOptions();
  const pastePromise = imagePaste.handlePaste(event, textarea, options);

  textarea.selectionStart = textarea.value.length;
  textarea.selectionEnd = textarea.value.length;
  textarea.value += ' after paste';

  resolveUpload({
    alt: 'cursor',
    url: 'https://example.test/uploads/cursor.png'
  });
  await pastePromise;

  assert.equal(textarea.value, 'Hello![cursor](https://example.test/uploads/cursor.png) world after paste');
  assert.equal(textarea.selectionStart, 'Hello![cursor](https://example.test/uploads/cursor.png)'.length);
  assert.equal(textarea.selectionEnd, textarea.selectionStart);
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
