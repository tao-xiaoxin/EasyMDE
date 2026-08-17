import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import { createPreviewRequestSession } from './create-preview-request-session';

const request = (markdown: string): PreviewRequest => ({
  markdown,
  postId: 7,
  markdownTheme: 'default',
  codeTheme: 'atom-one-dark',
  customCssId: '',
  signature: `signature:${markdown}`
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function safeHtml(value: string): SafePreviewHtml {
  return value as SafePreviewHtml;
}

describe('createPreviewRequestSession', () => {
  it('debounces for 180ms and publishes only the latest result', async () => {
    vi.useFakeTimers();
    const first = deferred<PreviewResponse>();
    const second = deferred<PreviewResponse>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onState = vi.fn();
    const session = createPreviewRequestSession({ initialRevision: 4, onState, port: { render } });

    session.schedule(request('first'));
    await vi.advanceTimersByTimeAsync(180);
    session.schedule(request('second'));
    await vi.advanceTimersByTimeAsync(180);
    first.resolve({ html: safeHtml('<p>first</p>'), features: {} });
    second.resolve({ html: safeHtml('<p>second</p>'), features: {} });
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[0]?.[1].aborted).toBe(true);
    expect(onState.mock.calls.map(([state]) => [state.kind, state.revision])).toEqual([
      ['loading', 5],
      ['loading', 6],
      ['success', 6]
    ]);
    expect(session.isCurrent(6, 'signature:second')).toBe(true);
    expect(session.isCurrent(5, 'signature:first')).toBe(false);
    session.destroy();
    expect(session.isCurrent(1, 'signature:pending')).toBe(false);
    vi.useRealTimers();
  });

  it('does not start transport from a superseded queued callback', async () => {
    let queuedRun: (() => void) | undefined;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback) => {
        if ('function' !== typeof callback) {
          throw new Error('preview-test-timeout-callback-invalid');
        }
        queuedRun = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      });
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);
    const render = vi.fn().mockResolvedValue({
      html: safeHtml('<p>current</p>'),
      features: {}
    });
    const onState = vi.fn();
    const session = createPreviewRequestSession({
      initialRevision: 0,
      onState,
      port: { render }
    });

    try {
      session.schedule(request('stale'));
      const runStale = queuedRun;
      expect(runStale).toBeTypeOf('function');

      session.schedule(request('current'), true);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      runStale?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(render.mock.calls.map(([scheduledRequest]) => scheduledRequest.markdown))
        .toEqual(['current']);
      expect(onState.mock.calls.map(([state]) => [state.kind, state.revision]))
        .toEqual([
          ['loading', 1],
          ['loading', 2],
          ['success', 2]
        ]);
    } finally {
      session.destroy();
      clearTimeoutSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  });

  it('does not start transport from a queued callback after destroy', async () => {
    let queuedRun: (() => void) | undefined;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback) => {
        if ('function' !== typeof callback) {
          throw new Error('preview-test-timeout-callback-invalid');
        }
        queuedRun = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      });
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);
    const render = vi.fn().mockResolvedValue({
      html: safeHtml('<p>stale</p>'),
      features: {}
    });
    const session = createPreviewRequestSession({
      initialRevision: 0,
      onState: vi.fn(),
      port: { render }
    });

    try {
      session.schedule(request('stale'));
      const runStale = queuedRun;
      expect(runStale).toBeTypeOf('function');

      session.destroy();
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      runStale?.();
      await Promise.resolve();

      expect(render).not.toHaveBeenCalled();
    } finally {
      session.destroy();
      clearTimeoutSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  });

  it('handles empty input without transport and reports failures honestly', async () => {
    const render = vi.fn().mockRejectedValue(new Error('synthetic'));
    const onState = vi.fn();
    const session = createPreviewRequestSession({ initialRevision: 0, onState, port: { render } });

    session.schedule(request('   '), true);
    session.schedule(request('broken'), true);
    await Promise.resolve();
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls.map(([state]) => state.kind)).toEqual(['empty', 'loading', 'error']);
    session.destroy();
  });

  it('aborts in-flight work during teardown and rejects later scheduling', async () => {
    const pending = deferred<PreviewResponse>();
    const render = vi.fn().mockReturnValue(pending.promise);
    const onState = vi.fn();
    const session = createPreviewRequestSession({ initialRevision: 0, onState, port: { render } });

    session.schedule(request('pending'), true);
    const signal = render.mock.calls[0]?.[1] as AbortSignal;
    session.destroy();
    pending.resolve({ html: safeHtml('<p>late</p>'), features: {} });
    await Promise.resolve();

    expect(signal.aborted).toBe(true);
    expect(onState).toHaveBeenCalledTimes(1);
    expect(() => session.schedule(request('late'))).toThrow('preview-session-destroyed');
  });
});
