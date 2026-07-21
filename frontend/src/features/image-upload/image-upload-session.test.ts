import { describe, expect, it, vi } from 'vitest';

import type {
  ImageUploadDocumentSnapshot,
  ImageUploadResult
} from '../../contracts/ports/image-upload-port';
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

function setup(uploadResult: Promise<ImageUploadResult>) {
  let snapshot: ImageUploadDocumentSnapshot = {
    selection: { direction: 'none', end: 5, start: 5 },
    value: 'Hello world'
  };
  const target = document.createElement('div');
  const statuses: Array<{ message: string; type: string }> = [];
  const diagnostics: string[] = [];
  const focus = vi.fn();
  const cleanup = createImageUploadSession({
    document: {
      applyTextChange: (value) => {
        snapshot = value;
      },
      focus,
      getSnapshot: () => snapshot
    },
    enabled: true,
    maxBytes: 1024,
    onDiagnostic: (code) => diagnostics.push(code),
    onStatus: (status) => statuses.push(status),
    postId: 17,
    strings,
    target,
    upload: { upload: () => uploadResult }
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
    target
  };
}

describe('createImageUploadSession', () => {
  it('uploads a pasted image and inserts Markdown at the captured selection', async () => {
    const session = setup(Promise.resolve({
      alt: 'screen shot',
      status: 'uploaded',
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
      { message: 'Paste uploading', type: 'info' },
      { message: 'Paste uploaded', type: 'success' }
    ]);
  });

  it('recognizes an image file when the transfer item omits its MIME type', async () => {
    const session = setup(Promise.resolve({
      alt: 'clipboard image',
      status: 'uploaded',
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
      .toBe('Hello![clipboard image](https://example.test/clipboard.png) world');
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
    resolveUpload({ alt: 'drop', status: 'uploaded', url: 'https://example.test/drop.png' });
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));
    expect(session.getSnapshot().value)
      .toBe('Hello![drop](https://example.test/drop.png) world later');

    const failed = setup(Promise.resolve({ code: 'request-failed', status: 'failed' }));
    failed.target.dispatchEvent(transferEvent('paste', new File(['image'], 'failed.png', {
      type: 'image/png'
    })));
    await vi.waitFor(() => expect(failed.statuses).toHaveLength(2));
    expect(failed.getSnapshot().value).toBe('Hello world');
    expect(failed.statuses[1]).toEqual({ message: 'Paste failed', type: 'error' });
  });

  it('rejects oversized images before upload and ignores completion after teardown', async () => {
    const oversized = setup(Promise.resolve({ alt: '', status: 'uploaded', url: '/unused' }));
    oversized.target.dispatchEvent(transferEvent('paste', new File([new Uint8Array(2048)], 'large.png', {
      type: 'image/png'
    })));
    expect(oversized.statuses).toEqual([{ message: 'Paste too large', type: 'error' }]);

    let resolveUpload: (value: ImageUploadResult) => void = () => undefined;
    const pending = setup(new Promise((resolve) => {
      resolveUpload = resolve;
    }));
    pending.target.dispatchEvent(transferEvent('drop', new File(['image'], 'drop.png', {
      type: 'image/png'
    })));
    pending.cleanup();
    resolveUpload({ alt: 'late', status: 'uploaded', url: 'https://example.test/late.png' });
    await vi.waitFor(() => expect(pending.diagnostics)
      .toContain('image-upload-completed-after-teardown'));
    expect(pending.getSnapshot().value).toBe('Hello world');
  });
});
