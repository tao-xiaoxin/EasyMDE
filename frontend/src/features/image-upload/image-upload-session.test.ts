import { describe, expect, it, vi } from 'vitest';

import type { ImageUploadDocumentSnapshot, ImageUploadRequest, ImageUploadResult } from '../../contracts/ports/image-upload-port';
import type { ImageUploadInsertion, ImageUploadMimeType } from '../../contracts/bootstrap/image-upload-bootstrap';
import type { RemoteImageImportRequest } from '../../contracts/ports/remote-image-import-port';
import {
  createImageUploadSession,
  createRemoteImageImportCoordinator,
  remoteImageUploadEnabled,
} from './image-upload-session';

const strings = {
  defaultAlt: 'image',
  dropFailed: 'Drop failed',
  dropTooLarge: 'Drop too large',
  dropUploaded: 'Drop uploaded',
  dropUploading: 'Drop uploading',
  pasteFailed: 'Paste failed',
  pasteUploadDisabled: 'Paste upload disabled',
  pasteTooLarge: 'Paste too large',
  pasteUploaded: 'Paste uploaded',
  pasteUploading: 'Paste uploading',
};

function transferEvent(
  type: 'drop' | 'paste',
  file: File,
  {
    includeFileList = true,
    itemType = file.type,
  }: Readonly<{
    includeFileList?: boolean;
    itemType?: string;
  }> = {},
): Event {
  const transfer = {
    dropEffect: 'move',
    files: includeFileList ? [file] : [],
    items: [{ getAsFile: () => file, kind: 'file', type: itemType }],
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: 'paste' === type ? transfer : null,
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: 'drop' === type ? transfer : null,
  });
  return event;
}

function remotePaste(values: Readonly<Record<string, string>>): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      getData: (type: string) => values[type] ?? '',
      items: [],
    },
  });
  return event;
}

function operationIdSequence() {
  let sequence = 0;
  return () => `image-upload-${++sequence}`;
}

function setup(
  uploadResult: Promise<ImageUploadResult>,
  nextOperationId = operationIdSequence(),
  allowedMimeTypes: ReadonlyArray<ImageUploadMimeType> = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  insertion: ImageUploadInsertion = {
    titleDisplay: 'none',
  },
  autoUploadPastedImages = true,
  remoteImportResult:
    | Promise<ImageUploadResult>
    | ((request: RemoteImageImportRequest) => Promise<ImageUploadResult>) = uploadResult,
) {
  let snapshot: ImageUploadDocumentSnapshot = {
    selection: { direction: 'none', end: 5, start: 5 },
    value: 'Hello world',
  };
  const target = document.createElement('div');
  const statuses: Array<{
    message: string;
    operationId: string;
    type: string;
  }> = [];
  const diagnostics: string[] = [];
  const focus = vi.fn();
  const upload = vi.fn((_request: ImageUploadRequest) => uploadResult);
  const remoteImageImport = vi.fn((request: RemoteImageImportRequest) =>
    'function' === typeof remoteImportResult ? remoteImportResult(request) : remoteImportResult,
  );
  const documentPort = {
    applyTextChange: (value: ImageUploadDocumentSnapshot) => {
      snapshot = value;
    },
    focus,
    getSnapshot: () => snapshot,
  };
  const remoteImageImportCoordinator = createRemoteImageImportCoordinator({
    document: documentPort,
    insertion,
    onDiagnostic: (code) => diagnostics.push(code),
    postId: 17,
    remoteImageImport: { import: remoteImageImport },
  });
  const cleanupSurface = createImageUploadSession({
    allowedMimeTypes,
    autoUploadPastedImages,
    document: documentPort,
    enabled: true,
    insertion,
    maxBytes: 1024,
    nextOperationId,
    onDiagnostic: (code) => diagnostics.push(code),
    onStatus: (status) => statuses.push(status),
    postId: 17,
    remoteImageImportCoordinator,
    remoteImageUploadMode: 'both',
    surface: 'source',
    strings,
    target,
    upload: { upload },
  });
  return {
    cleanup: () => {
      cleanupSurface();
      remoteImageImportCoordinator.destroy();
    },
    diagnostics,
    focus,
    getSnapshot: () => snapshot,
    setSnapshot: (value: ImageUploadDocumentSnapshot) => {
      snapshot = value;
    },
    statuses,
    target,
    upload,
    remoteImageImport,
  };
}

describe('createImageUploadSession', () => {
  it('blocks pasted image data without uploading while preserving drop upload', async () => {
    const session = setup(
      Promise.resolve({
        alt: 'image',
        status: 'uploaded',
        title: '',
        url: 'https://example.test/image.png',
      }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      false,
    );
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const textPaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, 'clipboardData', {
      value: { files: [], items: [] },
    });

    session.target.dispatchEvent(textPaste);

    expect(textPaste.defaultPrevented).toBe(false);
    const paste = transferEvent('paste', file);

    session.target.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(session.upload).not.toHaveBeenCalled();
    expect(session.remoteImageImport).not.toHaveBeenCalled();
    expect(session.getSnapshot().value).toBe('Hello world');
    expect(session.statuses).toEqual([
      {
        message: 'Paste upload disabled',
        operationId: 'image-upload-1',
        type: 'info',
      },
    ]);

    const drop = transferEvent('drop', file);
    session.target.dispatchEvent(drop);
    await vi.waitFor(() => expect(session.upload).toHaveBeenCalledOnce());
    expect(drop.defaultPrevented).toBe(true);
    expect(session.getSnapshot().value).toBe('Hello![image](https://example.test/image.png) world');
  });

  it('does not insert Markdown when the server reports an exhausted backup failure', async () => {
    const session = setup(
      Promise.resolve({
        code: 'easymde_image_hosting_backup_upload_failed',
        status: 'failed',
      }),
    );

    session.target.dispatchEvent(transferEvent('drop', new File(['image'], 'image.png', { type: 'image/png' })));
    await vi.waitFor(() => expect(session.statuses.at(-1)?.type).toBe('error'));

    expect(session.getSnapshot().value).toBe('Hello world');
    expect(session.statuses.at(-1)?.message).toBe(strings.dropFailed);
  });

  it('ignores uploaded Alt and title metadata when title display is disabled', async () => {
    const session = setup(
      Promise.resolve({
        alt: 'Media alt\\',
        status: 'uploaded',
        title: 'Uploaded title',
        url: 'https://example.test/image.png',
      }),
    );
    session.target.dispatchEvent(transferEvent('paste', new File(['image'], 'image.png', { type: 'image/png' })));
    await vi.waitFor(() => {
      expect(session.getSnapshot().value).toContain('![image](https://example.test/image.png)');
    });
    session.cleanup();
  });

  it('uploads a pasted image and inserts Markdown at the captured selection', async () => {
    const session = setup(
      Promise.resolve({
        alt: 'screen shot',
        status: 'uploaded',
        title: 'Uploaded title',
        url: 'https://example.test/image.png',
      }),
    );
    const event = transferEvent(
      'paste',
      new File(['image'], 'screen-shot.png', {
        type: 'image/png',
      }),
    );

    session.target.dispatchEvent(event);
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));

    expect(event.defaultPrevented).toBe(true);
    expect(session.getSnapshot().value).toBe('Hello![screen shot](https://example.test/image.png) world');
    expect(session.focus).toHaveBeenCalledOnce();
    expect(session.statuses).toEqual([
      {
        message: 'Paste uploading',
        operationId: 'image-upload-1',
        type: 'info',
      },
      {
        message: 'Paste uploaded',
        operationId: 'image-upload-1',
        type: 'success',
      },
    ]);
  });

  it('recognizes an image file when the transfer item omits its MIME type', async () => {
    const session = setup(
      Promise.resolve({
        alt: 'clipboard image',
        status: 'uploaded',
        title: '',
        url: 'https://example.test/clipboard.png',
      }),
    );
    const event = transferEvent('paste', new File(['image'], 'clipboard.png', { type: 'image/png' }), {
      includeFileList: false,
      itemType: '',
    });

    session.target.dispatchEvent(event);
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));

    expect(event.defaultPrevented).toBe(true);
    expect(session.getSnapshot().value).toBe('Hello![clipboard](https://example.test/clipboard.png) world');
  });

  it('rebases a pending drop after text is appended and preserves failure boundaries', async () => {
    let resolveUpload: (value: ImageUploadResult) => void = () => undefined;
    const session = setup(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    session.target.dispatchEvent(
      transferEvent(
        'drop',
        new File(['image'], 'drop.png', {
          type: 'image/png',
        }),
      ),
    );
    session.setSnapshot({
      selection: { direction: 'none', end: 17, start: 17 },
      value: 'Hello world later',
    });
    resolveUpload({
      alt: 'drop',
      status: 'uploaded',
      title: '',
      url: 'https://example.test/drop.png',
    });
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));
    expect(session.getSnapshot().value).toBe('Hello![drop](https://example.test/drop.png) world later');

    const failed = setup(Promise.resolve({ code: 'request-failed', status: 'failed' }));
    failed.target.dispatchEvent(
      transferEvent(
        'paste',
        new File(['image'], 'failed.png', {
          type: 'image/png',
        }),
      ),
    );
    await vi.waitFor(() => expect(failed.statuses).toHaveLength(2));
    expect(failed.getSnapshot().value).toBe('Hello world');
    expect(failed.statuses[1]).toEqual({
      message: 'Paste failed',
      operationId: 'image-upload-1',
      type: 'error',
    });
  });

  it('rejects oversized images before upload and ignores completion after teardown', async () => {
    const oversized = setup(
      Promise.resolve({
        alt: '',
        status: 'uploaded',
        title: '',
        url: '/unused',
      }),
    );
    oversized.target.dispatchEvent(
      transferEvent(
        'paste',
        new File([new Uint8Array(2048)], 'large.png', {
          type: 'image/png',
        }),
      ),
    );
    expect(oversized.statuses).toEqual([
      {
        message: 'Paste too large',
        operationId: 'image-upload-1',
        type: 'error',
      },
    ]);

    let resolveUpload: (value: ImageUploadResult) => void = () => undefined;
    const pending = setup(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    pending.target.dispatchEvent(
      transferEvent(
        'drop',
        new File(['image'], 'drop.png', {
          type: 'image/png',
        }),
      ),
    );
    pending.cleanup();
    expect(pending.upload.mock.calls[0]?.[0].signal.aborted).toBe(true);
    resolveUpload({
      alt: 'late',
      status: 'uploaded',
      title: '',
      url: 'https://example.test/late.png',
    });
    await vi.waitFor(() => expect(pending.diagnostics).toContain('image-upload-completed-after-teardown'));
    expect(pending.getSnapshot().value).toBe('Hello world');
  });

  it('rejects a disabled image format before the WordPress upload request', () => {
    const session = setup(
      Promise.resolve({
        alt: '',
        status: 'uploaded',
        title: '',
        url: '/unused',
      }),
      operationIdSequence(),
      ['image/png'],
    );
    const event = transferEvent(
      'paste',
      new File(['image'], 'photo.jpg', {
        type: 'image/jpeg',
      }),
    );

    session.target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(session.upload).not.toHaveBeenCalled();
    expect(session.statuses).toEqual([
      {
        message: 'Paste failed',
        operationId: 'image-upload-1',
        type: 'error',
      },
    ]);
  });

  it('keeps concurrent upload statuses bound to distinct operation IDs', async () => {
    const pending: Array<(value: ImageUploadResult) => void> = [];
    let snapshot: ImageUploadDocumentSnapshot = {
      selection: { direction: 'none', end: 5, start: 5 },
      value: 'Hello world',
    };
    const statuses: Array<{
      message: string;
      operationId: string;
      type: string;
    }> = [];
    const target = document.createElement('div');
    createImageUploadSession({
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      autoUploadPastedImages: true,
      document: {
        applyTextChange: (value) => {
          snapshot = value;
        },
        focus: vi.fn(),
        getSnapshot: () => snapshot,
      },
      enabled: true,
      insertion: {
        titleDisplay: 'none',
      },
      maxBytes: 1024,
      nextOperationId: operationIdSequence(),
      onDiagnostic: vi.fn(),
      onStatus: (status) => statuses.push(status),
      postId: 17,
      remoteImageImportCoordinator: { enqueue: vi.fn() },
      remoteImageUploadMode: 'both',
      surface: 'source',
      strings,
      target,
      upload: {
        upload: () =>
          new Promise((resolve) => {
            pending.push(resolve);
          }),
      },
    });

    target.dispatchEvent(transferEvent('paste', new File(['a'], 'a.png', { type: 'image/png' })));
    target.dispatchEvent(transferEvent('paste', new File(['b'], 'b.png', { type: 'image/png' })));
    expect(statuses.map(({ operationId }) => operationId)).toEqual(['image-upload-1', 'image-upload-2']);

    pending[1]?.({ code: 'request-failed', status: 'failed' });
    pending[0]?.({
      alt: 'a',
      status: 'uploaded',
      title: '',
      url: 'https://example.test/a.png',
    });
    await vi.waitFor(() => expect(statuses).toHaveLength(4));

    expect(statuses.slice(2)).toEqual([
      {
        message: 'Paste failed',
        operationId: 'image-upload-2',
        type: 'error',
      },
      {
        message: 'Paste uploaded',
        operationId: 'image-upload-1',
        type: 'success',
      },
    ]);
  });

  it('always inserts Markdown with filename Alt and optionally displays the full filename as title', async () => {
    const titled = setup(
      Promise.resolve({
        alt: 'WordPress alt',
        status: 'uploaded',
        title: 'WordPress title',
        url: 'https://example.test/titled.png',
      }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'filename' },
    );
    titled.target.dispatchEvent(transferEvent('paste', new File(['image'], 'local-name.png', { type: 'image/png' })));
    await vi.waitFor(() => expect(titled.statuses).toHaveLength(2));
    expect(titled.getSnapshot().value).toBe(
      'Hello![local name](https://example.test/titled.png "local-name.png") world',
    );

    const untitled = setup(
      Promise.resolve({
        alt: 'WordPress alt',
        status: 'uploaded',
        title: 'WordPress title',
        url: 'https://example.test/plain.png',
      }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
    );
    untitled.target.dispatchEvent(transferEvent('drop', new File(['image'], 'local-name.png', { type: 'image/png' })));
    await vi.waitFor(() => expect(untitled.statuses).toHaveLength(2));
    expect(untitled.getSnapshot().value).toBe('Hello![local name](https://example.test/plain.png) world');
  });

  it('imports one pasted Markdown image and replaces it with the returned URL', async () => {
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      Promise.resolve({
        alt: 'Remote cover',
        status: 'uploaded',
        title: '',
        url: 'https://cdn.example.test/cover.png',
      }),
    );
    const event = remotePaste({
      'text/plain': '![Remote cover](https://origin.example.test/cover.png)',
    });

    session.target.dispatchEvent(event);
    expect(session.getSnapshot().value).toBe(
      'Hello![Remote cover](https://origin.example.test/cover.png) world',
    );
    await vi.waitFor(() => expect(session.statuses).toHaveLength(2));

    expect(event.defaultPrevented).toBe(true);
    expect(session.remoteImageImport).toHaveBeenCalledWith(expect.objectContaining({
      altText: 'Remote cover',
      postId: 17,
      url: 'https://origin.example.test/cover.png',
    }));
    expect(session.upload).not.toHaveBeenCalled();
    expect(session.getSnapshot().value).toBe('Hello![Remote cover](https://cdn.example.test/cover.png) world');
  });

  it('restores the original Markdown when remote import fails', async () => {
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      Promise.resolve({ code: 'remote-image-import-request-failed', status: 'failed' }),
    );
    const original = '![Remote cover](https://origin.example.test/cover.png)';
    const event = remotePaste({ 'text/plain': original });

    session.target.dispatchEvent(event);
    await vi.waitFor(() => expect(session.statuses.at(-1)?.type).toBe('error'));

    expect(session.getSnapshot().value).toBe(`Hello${original} world`);
    expect(session.statuses.at(-1)?.message).toBe(strings.pasteFailed);
  });

  it('replaces the owned remote paste before text typed at its trailing caret', async () => {
    let resolveImport: (result: ImageUploadResult) => void = () => undefined;
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    const fallback = '![Remote](https://origin.example.test/cover.png)';
    const uploaded = '![Remote](https://cdn.example.test/cover.png)';

    session.target.dispatchEvent(remotePaste({ 'text/plain': fallback }));
    expect(session.getSnapshot().value).toBe(`Hello${fallback} world`);
    session.setSnapshot({
      selection: {
        direction: 'none',
        end: 5 + fallback.length + 1,
        start: 5 + fallback.length + 1,
      },
      value: `Hello${fallback}X world`,
    });
    resolveImport({
      alt: 'Remote',
      status: 'uploaded',
      title: '',
      url: 'https://cdn.example.test/cover.png',
    });

    await vi.waitFor(() => expect(session.statuses.at(-1)?.type).toBe('success'));
    expect(session.getSnapshot()).toEqual({
      selection: {
        direction: 'none',
        end: 5 + uploaded.length + 1,
        start: 5 + uploaded.length + 1,
      },
      value: `Hello${uploaded}X world`,
    });
  });

  it('keeps user edits that overlap the owned remote paste instead of overwriting them', async () => {
    let resolveImport: (result: ImageUploadResult) => void = () => undefined;
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    const fallback = '![Remote](https://origin.example.test/cover.png)';
    const edited = fallback.replace('Remote', 'Edited');

    session.target.dispatchEvent(remotePaste({ 'text/plain': fallback }));
    session.setSnapshot({
      selection: { direction: 'none', end: 5 + edited.length, start: 5 + edited.length },
      value: `Hello${edited} world`,
    });
    resolveImport({
      alt: 'Remote',
      status: 'uploaded',
      title: '',
      url: 'https://cdn.example.test/cover.png',
    });

    await vi.waitFor(() => expect(session.diagnostics).toContain('remote-image-import-owned-range-stale'));
    expect(session.getSnapshot().value).toBe(`Hello${edited} world`);
    expect(session.statuses.at(-1)?.type).toBe('error');
  });

  it('imports concurrent remote pastes in paste order when the later result is ready first', async () => {
    let resolveFirst: (result: ImageUploadResult) => void = () => undefined;
    let resolveSecond: (result: ImageUploadResult) => void = () => undefined;
    const firstResult = new Promise<ImageUploadResult>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResult = new Promise<ImageUploadResult>((resolve) => {
      resolveSecond = resolve;
    });
    const firstUrl = 'https://origin.example.test/first.png';
    const secondUrl = 'https://origin.example.test/second.png';
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      (request) => request.url === firstUrl ? firstResult : secondResult,
    );

    session.target.dispatchEvent(remotePaste({ 'text/plain': `![First](${firstUrl})` }));
    session.target.dispatchEvent(remotePaste({ 'text/plain': `![Second](${secondUrl})` }));
    resolveSecond({
      alt: 'Second',
      status: 'uploaded',
      title: '',
      url: 'https://cdn.example.test/second.png',
    });

    expect(session.remoteImageImport).toHaveBeenCalledOnce();
    expect(session.remoteImageImport.mock.calls[0]?.[0].url).toBe(firstUrl);
    expect(session.getSnapshot().value).toBe(
      `Hello![First](${firstUrl})![Second](${secondUrl}) world`,
    );

    resolveFirst({
      alt: 'First',
      status: 'uploaded',
      title: '',
      url: 'https://cdn.example.test/first.png',
    });
    await vi.waitFor(() => expect(session.remoteImageImport).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(session.getSnapshot().value).toBe(
      'Hello![First](https://cdn.example.test/first.png)![Second](https://cdn.example.test/second.png) world',
    ));
    expect(session.remoteImageImport.mock.calls.map(([request]) => request.url)).toEqual([firstUrl, secondUrl]);
  });

  it('restores an intercepted remote paste before teardown aborts its import', async () => {
    let resolveImport: (result: ImageUploadResult) => void = () => undefined;
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    const original = '![Remote cover](https://origin.example.test/cover.png)';
    const event = remotePaste({ 'text/plain': original });

    session.target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(session.getSnapshot().value).toBe(`Hello${original} world`);

    session.cleanup();

    expect(session.getSnapshot().value).toBe(`Hello${original} world`);
    expect(session.remoteImageImport.mock.calls[0]?.[0].signal.aborted).toBe(true);
    resolveImport({
      alt: 'late',
      status: 'uploaded',
      title: '',
      url: 'https://cdn.example.test/late.png',
    });
    await vi.waitFor(() => expect(session.diagnostics).toContain('remote-image-import-completed-after-teardown'));
    expect(session.getSnapshot().value).toBe(`Hello${original} world`);
  });

  it('restores queued remote pastes in order on teardown without starting the queued import', async () => {
    let resolveImport: (result: ImageUploadResult) => void = () => undefined;
    const session = setup(
      Promise.resolve({ code: 'unused', status: 'failed' }),
      operationIdSequence(),
      ['image/png'],
      { titleDisplay: 'none' },
      true,
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    const first = '![First](https://origin.example.test/first.png)';
    const second = '![Second](https://origin.example.test/second.png)';

    session.target.dispatchEvent(remotePaste({ 'text/plain': first }));
    session.target.dispatchEvent(remotePaste({ 'text/plain': second }));

    expect(session.remoteImageImport).toHaveBeenCalledOnce();
    session.cleanup();

    expect(session.getSnapshot().value).toBe(`Hello${first}${second} world`);
    expect(session.remoteImageImport).toHaveBeenCalledOnce();
    expect(session.remoteImageImport.mock.calls[0]?.[0].signal.aborted).toBe(true);
    resolveImport({
      alt: 'late',
      status: 'uploaded',
      title: '',
      url: 'https://cdn.example.test/late.png',
    });
    await vi.waitFor(() => expect(session.diagnostics).toContain('remote-image-import-completed-after-teardown'));
    expect(session.remoteImageImport).toHaveBeenCalledOnce();
    expect(session.getSnapshot().value).toBe(`Hello${first}${second} world`);
  });

  it('does not claim remote paste for a mismatched surface mode or a plain URL', () => {
    const session = setup(Promise.resolve({ code: 'unused', status: 'failed' }));
    const plainUrl = remotePaste({ 'text/plain': 'https://origin.example.test/cover.png' });

    session.target.dispatchEvent(plainUrl);

    expect(plainUrl.defaultPrevented).toBe(false);
    expect(session.remoteImageImport).not.toHaveBeenCalled();
  });

  it.each([
    ['both', 'source', true],
    ['both', 'visual', true],
    ['source', 'source', true],
    ['source', 'visual', false],
    ['visual', 'source', false],
    ['visual', 'visual', true],
    ['off', 'source', false],
    ['off', 'visual', false],
  ] as const)('routes remote mode %s on %s surfaces', (mode, surface, enabled) => {
    expect(remoteImageUploadEnabled(mode, surface)).toBe(enabled);
  });
});
