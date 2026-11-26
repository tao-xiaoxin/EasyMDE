import { createElement } from '@wordpress/element';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorRoot } from './EditorRoot';
import {
  cleanupEditorRootTestHarness,
  deferred,
  fixture
} from './editor-root-test-harness';

afterEach(() => {
  cleanupEditorRootTestHarness();
});

describe('EditorRoot WeChat copy & preview presentation', () => {
  it('resets immersive success feedback for an accepted success-to-success Copy', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<ReturnType<typeof props.wechatClipboard.copy>>;
    const secondCopy = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy)
      .mockResolvedValueOnce({ method: 'clipboard', status: 'copied' })
      .mockReturnValueOnce(secondCopy.promise);
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      fireEvent.click(view.getByRole('button', { name: '已复制' }));
      expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();
      expect(
        view.getByRole('button', { name: '复制到公众号' }).getAttribute('aria-busy')
      ).toBe('true');

      await act(async () => {
        secondCopy.resolve({ method: 'clipboard', status: 'copied' });
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears immersive success feedback before an accepted Copy that fails', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<ReturnType<typeof props.wechatClipboard.copy>>;
    const failedCopy = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy)
      .mockResolvedValueOnce({ method: 'clipboard', status: 'copied' })
      .mockReturnValueOnce(failedCopy.promise);
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
        await Promise.resolve();
      });
      fireEvent.click(view.getByRole('button', { name: '已复制' }));
      expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();

      await act(async () => {
        failedCopy.resolve({ code: 'wechat-copy-failed', status: 'failed' });
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();
      expect(view.getByRole('alert').textContent).toBe('Copy failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows immersive success feedback to return after a failed Copy retry', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<ReturnType<typeof props.wechatClipboard.copy>>;
    const failedCopy = deferred<ClipboardResult>();
    const retryCopy = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy)
      .mockResolvedValueOnce({ method: 'clipboard', status: 'copied' })
      .mockReturnValueOnce(failedCopy.promise)
      .mockReturnValueOnce(retryCopy.promise);
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
        await Promise.resolve();
      });
      fireEvent.click(view.getByRole('button', { name: '已复制' }));
      await act(async () => {
        failedCopy.resolve({ code: 'wechat-copy-failed', status: 'failed' });
        await Promise.resolve();
      });
      fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
      expect(
        view.getByRole('button', { name: '复制到公众号' }).getAttribute('aria-busy')
      ).toBe('true');
      await act(async () => {
        retryCopy.resolve({ method: 'clipboard', status: 'copied' });
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks preview presentation across Settings Center editing modes', async () => {
    const props = fixture();
    const modes = [
      ['live-preview', 'is-immersive-split', 'split'],
      ['source', 'is-immersive-source', 'split'],
      ['preview', 'is-immersive-preview', 'preview']
    ] as const;

    for (const [editingMode, expectedClass, expectedPresentation] of modes) {
      const view = render(
        <EditorRoot
          {...props}
          settings={{
            ...props.settings,
            general: { ...props.settings.general, editingMode }
          }}
        />
      );

      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.getAttribute('data-easymde-preview-presentation')
      ).toBe('split');
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink="1"]')
          ?.classList.contains('easymde-preview-presentation-split')
      ).toBe(true);
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains(expectedClass)
      ).toBe(true);
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.getAttribute('data-easymde-preview-presentation')
      ).toBe(expectedPresentation);
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink="1"]')
          ?.classList.contains(
            `easymde-preview-presentation-${expectedPresentation}`
          )
      ).toBe(true);
      view.unmount();
    }
  });

  it('retains the last visible Preview presentation while source mode hides its pane', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    const editor = view.container.querySelector('.easymde-editor');
    const preview = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    expect(editor?.getAttribute('data-easymde-preview-presentation')).toBe(
      'preview'
    );
    expect(
      preview?.classList.contains('easymde-preview-presentation-preview')
    ).toBe(true);

    fireEvent.click(view.getByRole('button', { name: /^编辑$/u }));

    expect(editor?.classList.contains('is-immersive-source')).toBe(true);
    expect(editor?.getAttribute('data-easymde-preview-presentation')).toBe(
      'preview'
    );
    expect(
      preview?.classList.contains('easymde-preview-presentation-preview')
    ).toBe(true);

    fireEvent.click(view.getByRole('button', { name: /^分屏$/u }));
    expect(editor?.classList.contains('is-immersive-split')).toBe(true);
    expect(editor?.getAttribute('data-easymde-preview-presentation')).toBe(
      'split'
    );
    expect(
      preview?.classList.contains('easymde-preview-presentation-split')
    ).toBe(true);
  });

  it('records the visible Preview before entering persisted source mode', async () => {
    const baseProps = fixture();
    const rememberPreviewWidth = vi.fn();
    const props = {
      ...baseProps,
      settings: {
        ...baseProps.settings,
        general: {
          ...baseProps.settings.general,
          editingMode: 'source' as const
        }
      },
      wechatClipboard: {
        ...baseProps.wechatClipboard,
        rememberPreviewWidth
      }
    };
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    const preview = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    if (!preview) throw new Error('preview-sink-unavailable');

    await waitFor(() =>
      expect(rememberPreviewWidth).toHaveBeenCalledWith(preview)
    );
    rememberPreviewWidth.mockClear();
    rememberPreviewWidth.mockImplementation(() => {
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains('is-immersive-source')
      ).toBe(false);
    });

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(rememberPreviewWidth).toHaveBeenCalledOnce();
    expect(rememberPreviewWidth).toHaveBeenCalledWith(preview);
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    view.unmount();
  });

  it('records the visible Preview before a direct immersive source transition', async () => {
    const baseProps = fixture();
    const rememberPreviewWidth = vi.fn();
    const props = {
      ...baseProps,
      wechatClipboard: {
        ...baseProps.wechatClipboard,
        rememberPreviewWidth
      }
    };
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    const preview = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    if (!preview) throw new Error('preview-sink-unavailable');
    await waitFor(() =>
      expect(rememberPreviewWidth).toHaveBeenCalledWith(preview)
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    rememberPreviewWidth.mockClear();
    rememberPreviewWidth.mockImplementation(() => {
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains('is-immersive-source')
      ).toBe(false);
    });

    fireEvent.click(view.getByRole('button', { name: /^编辑$/u }));

    expect(rememberPreviewWidth).toHaveBeenCalledOnce();
    expect(rememberPreviewWidth).toHaveBeenCalledWith(preview);
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    view.unmount();
  });

  it('records the visible Preview before an async visual source transition', async () => {
    const baseProps = fixture();
    const rememberPreviewWidth = vi.fn();
    const props = {
      ...baseProps,
      wechatClipboard: {
        ...baseProps.wechatClipboard,
        rememberPreviewWidth
      }
    };
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    const preview = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    if (!preview) throw new Error('preview-sink-unavailable');
    await waitFor(() =>
      expect(rememberPreviewWidth).toHaveBeenCalledWith(preview)
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    await view.findByRole(
      'textbox',
      { name: '可视化文章编辑器' },
      { timeout: 5000 }
    );
    rememberPreviewWidth.mockClear();
    rememberPreviewWidth.mockImplementation(() => {
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains('is-immersive-source')
      ).toBe(false);
    });
    fireEvent.click(view.getByRole('button', { name: /^编辑$/u }));

    await waitFor(() =>
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains('is-immersive-source')
      ).toBe(true)
    );
    expect(rememberPreviewWidth).toHaveBeenCalledOnce();
    expect(rememberPreviewWidth).toHaveBeenCalledWith(preview);
    view.unmount();
  });

  it('uses the formal Preview sink for immersive Preview Copy after locking visual editing', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    const stableSink = view.container.querySelector(
      '[data-easymde-preview-html-sink="1"]'
    );
    if (!stableSink) throw new Error('stable-preview-sink-unavailable');

    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    await view.findByRole('textbox', { name: '可视化文章编辑器' });

    fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledOnce()
    );

    expect(stableSink.isConnected).toBe(true);
    expect(vi.mocked(props.wechatClipboard.copy).mock.calls[0]?.[0]).toBe(
      stableSink
    );
  });

  it('keeps ordinary and immersive Copy glyphs static while exposing pending ARIA and blocking duplicates', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const pending = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const ordinaryCopy = await view.findByRole('button', {
      name: 'Copy to WeChat'
    });

    fireEvent.click(ordinaryCopy);
    expect(ordinaryCopy.getAttribute('aria-disabled')).toBe('true');
    expect(ordinaryCopy.hasAttribute('disabled')).toBe(false);
    expect(ordinaryCopy.getAttribute('aria-busy')).toBe('true');
    expect(ordinaryCopy.classList.contains('is-pending')).toBe(false);
    expect(
      ordinaryCopy.querySelectorAll('.easymde-wechat-glyph path')
    ).toHaveLength(3);
    fireEvent.click(ordinaryCopy);
    expect(props.wechatClipboard.copy).toHaveBeenCalledOnce();

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    const immersiveCopy = view.getByRole('button', { name: '复制到公众号' });
    expect(immersiveCopy.getAttribute('aria-disabled')).toBe('true');
    expect(immersiveCopy.hasAttribute('disabled')).toBe(false);
    expect(immersiveCopy.getAttribute('aria-busy')).toBe('true');
    expect(immersiveCopy.classList.contains('is-pending')).toBe(false);
    expect(
      immersiveCopy.querySelectorAll('.easymde-immersive-wechat-glyph path')
    ).toHaveLength(3);

    await act(async () => {
      pending.resolve({ method: 'clipboard', status: 'copied' });
    });
    await waitFor(() => {
      const completed = view.getByRole('button', { name: '复制到公众号' });
      expect(completed.hasAttribute('aria-disabled')).toBe(false);
      expect(completed.hasAttribute('disabled')).toBe(false);
      expect(completed.hasAttribute('aria-busy')).toBe(false);
      expect(
        completed.querySelector('.easymde-immersive-wechat-glyph')
      ).not.toBeNull();
    });
    expect(view.getByRole('status').textContent).toContain('Copied');
  });

  it('keeps ordinary Source Copy glyph static while exposing pending ARIA and blocking duplicates', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const pending = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy).mockReturnValue(pending.promise);
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          ...props.settings,
          general: { ...props.settings.general, editingMode: 'source' }
        }}
      />
    );
    const ordinaryCopy = await view.findByRole('button', {
      name: 'Copy to WeChat'
    });
    const sourceEditor = view.container.querySelector(
      '.easymde-source-react .cm-editor'
    );
    expect(sourceEditor).not.toBeNull();

    fireEvent.click(ordinaryCopy);
    expect(ordinaryCopy.getAttribute('aria-disabled')).toBe('true');
    expect(ordinaryCopy.getAttribute('aria-busy')).toBe('true');
    expect(ordinaryCopy.classList.contains('is-pending')).toBe(false);
    fireEvent.click(ordinaryCopy);
    expect(props.wechatClipboard.copy).toHaveBeenCalledOnce();
    expect(
      view.container.querySelector('.easymde-source-react .cm-editor')
    ).toBe(sourceEditor);

    await act(async () => {
      pending.resolve({ method: 'clipboard', status: 'copied' });
    });
    await waitFor(() => {
      const completed = view.getByRole('button', { name: 'Copy to WeChat' });
      expect(completed.hasAttribute('aria-disabled')).toBe(false);
      expect(completed.hasAttribute('aria-busy')).toBe(false);
    });
  });

  it('silently cancels a pending Copy when an article theme replaces its owner', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const pending = deferred<ClipboardResult>();
    let copySignal: AbortSignal | undefined;
    vi.mocked(props.wechatClipboard.copy)
      .mockImplementationOnce((_preview, options) => {
        copySignal = options?.signal;
        return pending.promise;
      })
      .mockResolvedValueOnce({ method: 'clipboard', status: 'copied' });
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    fireEvent.click(copy);
    expect(copySignal?.aborted).toBe(false);

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink="1"]')
          ?.classList.contains('easymde-markdown-theme-newsprint')
      ).toBe(true)
    );
    expect(copySignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve({
        code: 'wechat-png-upload-failed',
        sideEffects: 'uploads-may-remain',
        status: 'failed'
      });
    });
    await waitFor(() => expect(copy.hasAttribute('aria-busy')).toBe(false));
    expect(view.queryByRole('alert')).toBeNull();

    fireEvent.click(copy);
    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(2)
    );
    expect(view.getByText('Copied')).not.toBeNull();
  });

  it('revalidates a Copy started during pending theme preparation before the owner commits', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const firstPending = deferred<ClipboardResult>();
    const secondPending = deferred<ClipboardResult>();
    const themePending = deferred<boolean>();
    const signals: AbortSignal[] = [];
    const clipboardCopies = [firstPending.promise, secondPending.promise];
    vi.mocked(props.wechatClipboard.copy).mockImplementation(
      (_preview, options) => {
        if (options?.signal) signals.push(options.signal);
        return (
          clipboardCopies.shift()
          ?? Promise.resolve({ method: 'clipboard', status: 'copied' })
        );
      }
    );
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      themePending.promise
    );
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    fireEvent.click(copy);
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenCalledOnce()
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(copy.hasAttribute('aria-busy')).toBe(false);

    // The first cancellation releases the old Copy, while the active theme
    // transition keeps a new Copy from observing a half-committed Preview.
    fireEvent.click(copy);
    expect(signals).toHaveLength(1);
    firstPending.resolve({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    await act(async () => undefined);

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    const immersiveCopy = view.getByRole('button', { name: '复制到公众号' });
    expect(immersiveCopy.getAttribute('aria-disabled')).toBe('true');
    expect(immersiveCopy.hasAttribute('aria-busy')).toBe(false);

    themePending.resolve(true);
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink="1"]')
          ?.classList.contains('easymde-markdown-theme-newsprint')
      ).toBe(true)
    );
    expect(immersiveCopy.hasAttribute('aria-disabled')).toBe(false);
    expect(immersiveCopy.hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(immersiveCopy);
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);

    secondPending.resolve({
      method: 'clipboard',
      status: 'copied'
    });
    await waitFor(() => expect(view.getByText('Copied')).not.toBeNull());
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('keeps keyboard focus through pending ordinary and immersive copy', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const ordinaryPending = deferred<ClipboardResult>();
    const immersivePending = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy)
      .mockReturnValueOnce(ordinaryPending.promise)
      .mockReturnValueOnce(immersivePending.promise);
    const user = userEvent.setup();
    const view = render(<EditorRoot {...props} />);
    const ordinaryCopy = await view.findByRole('button', {
      name: 'Copy to WeChat'
    });
    const sourceBeforeCopy = props.submissionField.value;

    ordinaryCopy.focus();
    await user.keyboard('{Enter}');
    expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(ordinaryCopy);
    expect(ordinaryCopy.getAttribute('aria-disabled')).toBe('true');
    expect(ordinaryCopy.hasAttribute('disabled')).toBe(false);
    expect(ordinaryCopy.getAttribute('aria-busy')).toBe('true');

    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.click(ordinaryCopy);
    expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(ordinaryCopy);

    await act(async () => {
      ordinaryPending.resolve({ method: 'clipboard', status: 'copied' });
    });
    await waitFor(() => {
      expect(ordinaryCopy.hasAttribute('aria-disabled')).toBe(false);
      expect(ordinaryCopy.hasAttribute('aria-busy')).toBe(false);
    });
    expect(document.activeElement).toBe(ordinaryCopy);
    expect(props.submissionField.value).toBe(sourceBeforeCopy);

    await user.click(view.getByRole('button', { name: '进入沉浸写作' }));
    const immersiveCopy = view.getByRole('button', { name: '复制到公众号' });
    immersiveCopy.focus();
    await user.keyboard(' ');
    expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(immersiveCopy);
    expect(immersiveCopy.getAttribute('aria-disabled')).toBe('true');
    expect(immersiveCopy.hasAttribute('disabled')).toBe(false);
    expect(immersiveCopy.getAttribute('aria-busy')).toBe('true');

    await user.keyboard('{Enter}');
    await user.click(immersiveCopy);
    expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(immersiveCopy);

    await act(async () => {
      immersivePending.resolve({ code: 'wechat-copy-failed', status: 'failed' });
    });
    await waitFor(() => {
      expect(immersiveCopy.hasAttribute('aria-disabled')).toBe(false);
      expect(immersiveCopy.hasAttribute('aria-busy')).toBe(false);
    });
    expect(document.activeElement).toBe(immersiveCopy);
    expect(props.submissionField.value).toBe(sourceBeforeCopy);
  });

  it('clears shared pending feedback after a cancellation failure', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const pending = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    fireEvent.click(copy);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      pending.resolve({
        code: 'wechat-png-rasterization-cancelled',
        status: 'failed'
      });
    });

    await waitFor(() => {
      const completed = view.getByRole('button', { name: 'Copy to WeChat' });
      expect(completed.hasAttribute('aria-disabled')).toBe(false);
      expect(completed.hasAttribute('disabled')).toBe(false);
      expect(completed.hasAttribute('aria-busy')).toBe(false);
      expect(view.getByRole('alert').textContent).toBe('Copy failed');
    });
  });

  it('releases pending feedback when the WeChat session is replaced', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const pending = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy).mockReturnValue(pending.promise);
    const replacementClipboard = {
      copy: vi
        .fn()
        .mockResolvedValue({ method: 'clipboard', status: 'copied' } as const),
      prepare: vi.fn().mockResolvedValue(undefined)
    };
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    fireEvent.click(copy);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    view.rerender(
      <EditorRoot {...props} wechatClipboard={replacementClipboard} />
    );

    await waitFor(() => {
      const replacementCopy = view.getByRole('button', {
        name: 'Copy to WeChat'
      });
      expect(replacementCopy.hasAttribute('aria-disabled')).toBe(false);
      expect(replacementCopy.hasAttribute('disabled')).toBe(false);
      expect(replacementCopy.hasAttribute('aria-busy')).toBe(false);
    });
    fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
    await waitFor(() =>
      expect(replacementClipboard.copy).toHaveBeenCalledOnce()
    );
    await act(async () => {
      pending.resolve({ method: 'clipboard', status: 'copied' });
    });
  });

  it('does not mark the live immersive surface copied from a stale success', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    const pending = deferred<ClipboardResult>();
    vi.mocked(props.wechatClipboard.copy).mockReturnValue(pending.promise);
    const replacementClipboard = {
      copy: vi
        .fn()
        .mockResolvedValue({ method: 'clipboard', status: 'copied' } as const),
      prepare: vi.fn().mockResolvedValue(undefined)
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    expect(
      view.getByRole('button', { name: '复制到公众号' }).getAttribute('aria-busy')
    ).toBe('true');

    view.rerender(
      <EditorRoot {...props} wechatClipboard={replacementClipboard} />
    );
    await waitFor(() => {
      expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();
      expect(view.queryByRole('button', { name: '已复制' })).toBeNull();
    });

    await act(async () => {
      pending.resolve({ method: 'clipboard', status: 'copied' });
    });
    expect(view.queryByRole('button', { name: '已复制' })).toBeNull();
    expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(replacementClipboard.copy).toHaveBeenCalledOnce()
    );
  });

  it('prepares only geometry in the background when PNG conversion is enabled', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const view = render(
      <EditorRoot
        {...props}
        wechatExport={{ ...props.wechatExport, pngConversionEnabled: true }}
      />
    );

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    await waitFor(() => expect(prepare).toHaveBeenCalled());
    expect(prepare).toHaveBeenCalledWith(
      view.container.querySelector('[data-easymde-preview-html-sink="1"]'),
      expect.objectContaining({ background: true, geometryOnly: true })
    );
    expect(props.getPreviewLayoutObservationCount()).toBeGreaterThan(0);
    act(() => {
      props.triggerResize();
      props.triggerPreviewLayout();
    });
    await waitFor(() =>
      expect(vi.mocked(prepare).mock.calls.length).toBeGreaterThan(1)
    );
    const lastCall = vi.mocked(prepare).mock.calls[
      vi.mocked(prepare).mock.calls.length - 1
    ];
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({ background: true, geometryOnly: true })
    );
    view.unmount();
  });

  it('cancels queued portable preparation and starts geometry preparation when PNG conversion becomes enabled', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => expect(prepare).toHaveBeenCalled());
    const callsBeforeToggle = vi.mocked(prepare).mock.calls.length;
    act(() => props.triggerResize());
    view.rerender(
      <EditorRoot
        {...props}
        wechatExport={{ ...props.wechatExport, pngConversionEnabled: true }}
      />
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    expect(vi.mocked(prepare).mock.calls.length).toBeGreaterThan(
      callsBeforeToggle
    );
    const lastCall = vi.mocked(prepare).mock.calls[
      vi.mocked(prepare).mock.calls.length - 1
    ];
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({ background: true, geometryOnly: true })
    );
    view.unmount();
  });

  it('releases completed WeChat preparation when the mode changes and the Root unmounts', async () => {
    const props = fixture();
    const releasePrepared = vi.fn();
    const wechatClipboard = { ...props.wechatClipboard, releasePrepared };
    const view = render(
      <EditorRoot {...props} wechatClipboard={wechatClipboard} />
    );
    await waitFor(() => expect(wechatClipboard.prepare).toHaveBeenCalled());
    const preview = view.container.querySelector(
      '[data-easymde-preview-html-sink="1"]'
    );
    expect(preview).not.toBeNull();
    releasePrepared.mockClear();
    view.rerender(
      <EditorRoot
        {...props}
        wechatClipboard={wechatClipboard}
        wechatExport={{ ...props.wechatExport, pngConversionEnabled: true }}
      />
    );
    await waitFor(() => expect(releasePrepared).toHaveBeenCalledWith(preview));
    releasePrepared.mockClear();
    view.unmount();
    expect(releasePrepared).toHaveBeenCalledWith(preview);
  });

  it('aborts an overlapping non-PNG background preparation on theme change and unmount even after an earlier preparation settles', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const firstPreparation = deferred<void>();
    const secondPreparation = deferred<void>();
    const thirdPreparation = deferred<void>();
    const fourthPreparation = deferred<void>();
    const pendingPreparations = [
      firstPreparation.promise,
      secondPreparation.promise,
      thirdPreparation.promise,
      fourthPreparation.promise
    ];
    const signals: Array<AbortSignal | undefined> = [];
    vi.mocked(prepare).mockImplementation((_surface, options) => {
      signals.push(options?.signal);
      return pendingPreparations.shift() ?? Promise.resolve();
    });

    const view = render(<EditorRoot {...props} />);
    await waitFor(() => expect(signals).toHaveLength(1));

    // Trigger a second overlapping preparation before the first settles.
    act(() => {
      props.triggerResize();
    });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(false);

    // Completing call #1 must not clear the shared AbortController while call #2 is still in flight.
    await act(async () => {
      firstPreparation.resolve(undefined);
      await Promise.resolve();
    });
    expect(signals[1]?.aborted).toBe(false);

    // Switching the article theme cancels background preparation and must still abort call #2.
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() => expect(signals[1]?.aborted).toBe(true));

    // Wait for post-theme preparation (call #3), overlap with call #4, settle call #3, and verify unmount aborts call #4.
    await waitFor(() => expect(signals).toHaveLength(3));
    expect(signals[2]?.aborted).toBe(false);
    act(() => {
      props.triggerPreviewLayout();
    });
    await waitFor(() => expect(signals).toHaveLength(4));
    expect(signals[2]).toBe(signals[3]);
    expect(signals[3]?.aborted).toBe(false);

    await act(async () => {
      thirdPreparation.resolve(undefined);
      await Promise.resolve();
    });
    expect(signals[3]?.aborted).toBe(false);

    view.unmount();
    expect(signals[3]?.aborted).toBe(true);
  });
});
