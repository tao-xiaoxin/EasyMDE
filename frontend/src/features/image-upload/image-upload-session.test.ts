import { describe, expect, it, vi } from 'vitest';

import type {
  ImageUploadDocumentSnapshot,
  ImageUploadResult
} from '../../contracts/ports/image-upload-port';
import type {
  ImageUploadInsertion,
  ImageUploadMimeType
} from '../../contracts/bootstrap/image-upload-bootstrap';
import { createImageUploadSession } from './image-upload-session';

const strings = {
  defaultAlt: 'image',
  dropFailed: 'Drop failed',
  dropTooLarge: 'Drop too large',
  dropUploaded: 'Drop uploaded',
  dropUploading: 'Drop uploading',
  pasteFailed: 'Paste failed',
  pasteTooLarge: 'Paste too large',
  pasteUploaded: 'Paste uploaded',
  pasteUploading: 'Paste uploading'
};

function transferEvent(
  type: 'drop' | 'paste',
  file: File,
  { includeFileList = true, itemType = file.type }: Readonly<{
    includeFileList?: boolean;
    itemType?: string;
  }> = {}
): Event {
  const transfer = {
    dropEffect: 'move',
    files: includeFileList ? [file] : [],
    items: [{ getAsFile: () => file, kind: 'file', type: itemType }]
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: 'paste' === type ? transfer : null });
  Object.defineProperty(event, 'dataTransfer', { value: 'drop' === type ? transfer : null });
  return event;
}

function operationIdSequence() {
  let sequence = 0;
  return () => `image-upload-${++sequence}`;
}

function setup(
  uploadResult: Promise<ImageUploadResult>,
  nextOperationId = operationIdSequence(),
  allowedMimeTypes: ReadonlyArray<ImageUploadMimeType> = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ],
  insertion: ImageUploadInsertion = {
    altSource: 'filename',
    captionMode: 'none',
    format: 'markdown'
  }
) {
  let snapshot: ImageUploadDocumentSnapshot = {
    selection: { direction: 'none', end: 5, start: 5 },
    value: 'Hello world'
  };
  const target = document.createElement('div');
  const statuses: Array<{
    message: string;
    operationId: string;
    type: string;
  }> = [];
  const diagnostics: string[] = [];
  const focus = vi.fn();
  const upload = vi.fn(() => uploadResult);
  const cleanup = createImageUploadSession({
    allowedMimeTypes,
    document: {
      applyTextChange: (value) => {
        snapshot = value;
      },
      focus,
      getSnapshot: () => snapshot
    },
    enabled: true,
    insertion,
    maxBytes: 1024,
    nextOperationId,
    onDiagnostic: (code) => diagnostics.push(code),
    onStatus: (status) => statuses.push(status),
    postId: 17,
    strings,
    target,
    upload: { upload }
  });
  return {
    cleanup,
    diagnostics,
    focus,
    getSnapshot: () => snapshot,
    setSnapshot: (value: ImageUploadDocumentSnapshot) => {
      snapshot = value;
    },
    statuses,
    target,
    upload
  };
}

describe('createImageUploadSession', () => {
  it('uploads a pasted image and inserts Markdown at the captured selection', async () => {
    const session = setup(Promise.resolve({
      alt: 'screen shot',
      status: 'uploaded',
      title: 'Uploaded title',
      url: 'https://example.test/image.png'
    }));
    const event = transferEvent('paste', new File(['image'], 'screen-shot.png', {
      type: 'image/png'
    }));

    session.target.dispatchEvent(event);
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));

    expect(event.defaultPrevented).toBe(true);
    expect(session.getSnapshot().value)
      .toBe('Hello![screen shot](https://example.test/image.png) world');
    expect(session.focus).toHaveBeenCalledOnce();
    expect(session.statuses).toEqual([
      {
        message: 'Paste uploading',
        operationId: 'image-upload-1',
        type: 'info'
      },
      {
        message: 'Paste uploaded',
        operationId: 'image-upload-1',
        type: 'success'
      }
    ]);
  });

  it('recognizes an image file when the transfer item omits its MIME type', async () => {
    const session = setup(Promise.resolve({
      alt: 'clipboard image',
      status: 'uploaded',
      title: '',
      url: 'https://example.test/clipboard.png'
    }));
    const event = transferEvent(
      'paste',
      new File(['image'], 'clipboard.png', { type: 'image/png' }),
      { includeFileList: false, itemType: '' }
    );

    session.target.dispatchEvent(event);
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));

    expect(event.defaultPrevented).toBe(true);
    expect(session.getSnapshot().value)
      .toBe('Hello![clipboard](https://example.test/clipboard.png) world');
  });

  it('rebases a pending drop after text is appended and preserves failure boundaries', async () => {
    let resolveUpload: (value: ImageUploadResult) => void = () => undefined;
    const session = setup(new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    session.target.dispatchEvent(transferEvent('drop', new File(['image'], 'drop.png', {
      type: 'image/png'
    })));
    session.setSnapshot({
      selection: { direction: 'none', end: 17, start: 17 },
      value: 'Hello world later'
    });
    resolveUpload({ alt: 'drop', status: 'uploaded', title: '', url: 'https://example.test/drop.png' });
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));
    expect(session.getSnapshot().value)
      .toBe('Hello![drop](https://example.test/drop.png) world later');

    const failed = setup(Promise.resolve({ code: 'request-failed', status: 'failed' }));
    failed.target.dispatchEvent(transferEvent('paste', new File(['image'], 'failed.png', {
      type: 'image/png'
    })));
    await vi.waitFor(() => expect(failed.statuses).toHaveLength(2));
    expect(failed.getSnapshot().value).toBe('Hello world');
    expect(failed.statuses[1]).toEqual({
      message: 'Paste failed',
      operationId: 'image-upload-1',
      type: 'error'
    });
  });

  it('rejects oversized images before upload and ignores completion after teardown', async () => {
    const oversized = setup(Promise.resolve({ alt: '', status: 'uploaded', title: '', url: '/unused' }));
    oversized.target.dispatchEvent(transferEvent('paste', new File([new Uint8Array(2048)], 'large.png', {
      type: 'image/png'
    })));
    expect(oversized.statuses).toEqual([{
      message: 'Paste too large',
      operationId: 'image-upload-1',
      type: 'error'
    }]);

    let resolveUpload: (value: ImageUploadResult) => void = () => undefined;
    const pending = setup(new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    pending.target.dispatchEvent(transferEvent('drop', new File(['image'], 'drop.png', {
      type: 'image/png'
    })));
    pending.cleanup();
    resolveUpload({ alt: 'late', status: 'uploaded', title: '', url: 'https://example.test/late.png' });
    await vi.waitFor(() => expect(pending.diagnostics)
      .toContain('image-upload-completed-after-teardown'));
    expect(pending.getSnapshot().value).toBe('Hello world');
  });

  it('rejects a disabled image format before the WordPress upload request', () => {
    const session = setup(
      Promise.resolve({ alt: '', status: 'uploaded', title: '', url: '/unused' }),
      operationIdSequence(),
      ['image/png']
    );
    const event = transferEvent('paste', new File(['image'], 'photo.jpg', {
      type: 'image/jpeg'
    }));

    session.target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(session.upload).not.toHaveBeenCalled();
    expect(session.statuses).toEqual([{
      message: 'Paste failed',
      operationId: 'image-upload-1',
      type: 'error'
    }]);
  });

  it('keeps concurrent upload statuses bound to distinct operation IDs', async () => {
    const pending: Array<(value: ImageUploadResult) => void> = [];
    let snapshot: ImageUploadDocumentSnapshot = {
      selection: { direction: 'none', end: 5, start: 5 },
      value: 'Hello world'
    };
    const statuses: Array<{
      message: string;
      operationId: string;
      type: string;
    }> = [];
    const target = document.createElement('div');
    createImageUploadSession({
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      document: {
        applyTextChange: (value) => {
          snapshot = value;
        },
        focus: vi.fn(),
        getSnapshot: () => snapshot
      },
      enabled: true,
      insertion: {
        altSource: 'filename',
        captionMode: 'none',
        format: 'markdown'
      },
      maxBytes: 1024,
      nextOperationId: operationIdSequence(),
      onDiagnostic: vi.fn(),
      onStatus: (status) => statuses.push(status),
      postId: 17,
      strings,
      target,
      upload: {
        upload: () =>
          new Promise((resolve) => {
            pending.push(resolve);
          })
      }
    });

    target.dispatchEvent(transferEvent(
      'paste',
      new File(['a'], 'a.png', { type: 'image/png' })
    ));
    target.dispatchEvent(transferEvent(
      'paste',
      new File(['b'], 'b.png', { type: 'image/png' })
    ));
    expect(statuses.map(({ operationId }) => operationId)).toEqual([
      'image-upload-1',
      'image-upload-2'
    ]);

    pending[1]?.({ code: 'request-failed', status: 'failed' });
    pending[0]?.({
      alt: 'a',
      status: 'uploaded',
      title: '',
      url: 'https://example.test/a.png'
    });
    await vi.waitFor(() => expect(statuses).toHaveLength(4));

    expect(statuses.slice(2)).toEqual([
      {
        message: 'Paste failed',
        operationId: 'image-upload-2',
        type: 'error'
      },
      {
        message: 'Paste uploaded',
        operationId: 'image-upload-1',
        type: 'success'
      }
    ]);
  });

  it('applies the selected URL, Alt, and title insertion behavior', async () => {
    const titled = setup(
      Promise.resolve({
        alt: 'WordPress alt',
        status: 'uploaded',
        title: 'WordPress title',
        url: 'https://example.test/titled.png'
      }),
      operationIdSequence(),
      ['image/png'],
      { altSource: 'empty', captionMode: 'upload', format: 'markdown' }
    );
    titled.target.dispatchEvent(transferEvent(
      'paste',
      new File(['image'], 'local-name.png', { type: 'image/png' })
    ));
    await vi.waitFor(() => expect(titled.statuses).toHaveLength(2));
    expect(titled.getSnapshot().value).toBe(
      'Hello![](https://example.test/titled.png "WordPress title") world'
    );

    const urlOnly = setup(
      Promise.resolve({
        alt: 'WordPress alt',
        status: 'uploaded',
        title: 'WordPress title',
        url: 'https://example.test/plain.png'
      }),
      operationIdSequence(),
      ['image/png'],
      { altSource: 'upload', captionMode: 'filename', format: 'url' }
    );
    urlOnly.target.dispatchEvent(transferEvent(
      'drop',
      new File(['image'], 'local-name.png', { type: 'image/png' })
    ));
    await vi.waitFor(() => expect(urlOnly.statuses).toHaveLength(2));
    expect(urlOnly.getSnapshot().value).toBe(
      'Hellohttps://example.test/plain.png world'
    );
  });
});
