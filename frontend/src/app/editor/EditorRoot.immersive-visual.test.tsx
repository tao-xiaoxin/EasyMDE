import { createElement } from '@wordpress/element';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within
} from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { RemoteImageImportResult } from '../../contracts/ports/remote-image-import-port';
import type { ImmersiveVisualEditorRuntime } from '../../contracts/visual-editor';
import { EditorRoot, focusVisualPreviewRuntime } from './EditorRoot';
import {
  cleanupEditorRootTestHarness,
  createPreviewResponse,
  deferred,
  fixture,
  imageTransferEvent
} from './editor-root-test-harness';

afterEach(cleanupEditorRootTestHarness);

describe('EditorRoot immersive and visual editing', () => {
  it('focuses only the current visual runtime across disposal and replacement', () => {
    const createSurface = () => {
      const surface = document.createElement('div');
      surface.tabIndex = -1;
      surface.setAttribute('contenteditable', 'true');
      Object.defineProperty(surface, 'isContentEditable', { value: true });
      document.body.append(surface);
      return surface;
    };
    const surfaceA = createSurface();
    const surfaceB = createSurface();
    const runtimeA: ImmersiveVisualEditorRuntime = {
      applyCanonicalChange: () => 'blocked',
      captureContextMenuTarget: () => null,
      executeCommand: () => 'blocked',
      getGeneratedPreviewIdentity: () => null,
      isEditable: () => true,
      isTransferPending: () => false,
      prepareContextMenuDemand: () => true,
      prepareGeneratedContentTarget: () => null,
      prepareGeneratedContentTargetForSelection: () => null,
      prepareImageTarget: () => null,
      prepareImageTargetBySelection: () => null,
      prepareMediaSelection: () => false,
      prepareSourceNavigation: () => false,
      prepareToolbarFallback: () => false,
      surface: surfaceA
    };
    const runtimeB: ImmersiveVisualEditorRuntime = {
      applyCanonicalChange: () => 'blocked',
      captureContextMenuTarget: () => null,
      executeCommand: () => 'blocked',
      getGeneratedPreviewIdentity: () => null,
      isEditable: () => true,
      isTransferPending: () => false,
      prepareContextMenuDemand: () => true,
      prepareGeneratedContentTarget: () => null,
      prepareGeneratedContentTargetForSelection: () => null,
      prepareImageTarget: () => null,
      prepareImageTargetBySelection: () => null,
      prepareMediaSelection: () => false,
      prepareSourceNavigation: () => false,
      prepareToolbarFallback: () => false,
      surface: surfaceB
    };
    const neutralControl = document.createElement('button');
    document.body.append(neutralControl);
    const activeElement = () =>
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onFailure = vi.fn();

    try {
      expect(
        focusVisualPreviewRuntime(runtimeA, activeElement, onFailure)
      ).toBe(true);
      expect(document.activeElement).toBe(surfaceA);

      neutralControl.focus();
      expect(document.activeElement).toBe(neutralControl);

      expect(focusVisualPreviewRuntime(null, activeElement, onFailure)).toBe(
        false
      );
      expect(document.activeElement).toBe(neutralControl);
      expect(onFailure).toHaveBeenLastCalledWith(
        'visual-editor-focus-surface-unavailable'
      );

      expect(
        focusVisualPreviewRuntime(runtimeB, activeElement, onFailure)
      ).toBe(true);
      expect(document.activeElement).toBe(surfaceB);
      expect(onFailure).toHaveBeenCalledOnce();
    } finally {
      neutralControl.remove();
      surfaceA.remove();
      surfaceB.remove();
    }
  });

  it('recomposes the existing source and preview owners in immersive mode', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(view.getByRole('button', { name: '进入沉浸写作' })).not.toBeNull()
    );
    const assertPreviewPaperFrame = (pane: Element | null) => {
      expect(pane).not.toBeNull();
      expect(
        pane?.querySelectorAll(':scope > .easymde-immersive-preview-canvas')
      ).toHaveLength(1);
      expect(
        pane?.querySelectorAll(
          ':scope > .easymde-immersive-preview-canvas > [data-easymde-preview-html-sink]'
        )
      ).toHaveLength(1);
      expect(
        pane?.querySelectorAll(
          ':scope > .easymde-immersive-preview-canvas .easymde-immersive-preview-canvas'
        )
      ).toHaveLength(0);
    };
    assertPreviewPaperFrame(
      view.container.querySelector('.easymde-pane-preview')
    );
    expect(
      view.container.querySelector('.easymde-immersive-preview-page')
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('.easymde-pane-preview')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('.easymde-pane-header')
    ).toHaveLength(2);
    expect(
      view.container.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();
    assertPreviewPaperFrame(
      view.container.querySelector('.easymde-pane-preview')
    );

    fireEvent.click(view.getByRole('button', { name: '预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    const previewPane = view.container.querySelector('.easymde-pane-preview');
    expect(
      previewPane?.classList.contains('easymde-immersive-preview-surface')
    ).toBe(true);
    assertPreviewPaperFrame(previewPane);
    expect(
      previewPane?.querySelector('.easymde-immersive-preview-page')
    ).toBeNull();
    const previewSink = previewPane?.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink]'
    );
    expect(
      previewSink?.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    expect(previewSink?.classList.contains('easymde-font-overrides')).toBe(
      false
    );
    expect(
      previewPane?.querySelector('.easymde-immersive-preview-status')
    ).not.toBeNull();
    expect(
      view.queryByRole('separator', {
        name: '调整编辑区和预览区宽度'
      })
    ).toBeNull();
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).not.toBeNull();
    expect(view.getAllByRole('button', { name: '收起大纲' })).toHaveLength(2);
    expect(
      view.queryByRole('separator', { name: '调整大纲宽度' })
    ).not.toBeNull();
    const previewHideOutline = view.getAllByRole('button', {
      name: '收起大纲'
    })[0];
    if (!previewHideOutline)
      throw new Error('preview-outline-close-unavailable');
    fireEvent.click(previewHideOutline);
    expect(view.queryByRole('complementary', { name: '文章大纲' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开大纲' }));
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll('[data-easymde-preview-html-sink]')
    ).toHaveLength(1);
    await waitFor(() =>
      expect(
        previewPane?.querySelector('[data-easymde-preview-html-sink] p')
          ?.textContent
      ).toBe('Rendered')
    );
    const scrollDisposeCount =
      props.scrollSyncBinding.dispose.mock.calls.length;
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(
      scrollDisposeCount
    );
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    visualEditor.innerHTML = '<p>Changed visually</p><p>Body</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Changed visually\n\nBody')
    );
    expect(view.getByText('更改已记录')).not.toBeNull();
    expect(view.getByRole('button', { name: '锁定为只读' })).not.toBeNull();
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('[data-easymde-preview-html-sink]')
    ).toHaveLength(1);
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).not.toBeNull();
    expect(props.enhancementPort.dispose).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    expect(props.mediaPickerFrame?.open).toHaveBeenCalledTimes(1);
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).not.toBeNull();
    const mediaFrame = props.mediaPickerFrame;
    const mediaOpen = mediaFrame
      ? vi.mocked(mediaFrame.open).mock.calls[0]?.[0]
      : undefined;
    mediaOpen?.onClose();
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    await waitFor(() =>
      expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull()
    );
    expect(
      view.container.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();
  });

  it('keeps the themed paper visible without exposing a rendering placeholder', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation(
      () => pendingPreview.promise
    );
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Rendering')).toBeNull();
    expect(
      view.container.querySelector(
        '.easymde-pane-preview > .easymde-immersive-preview-canvas > [data-easymde-preview-html-sink]'
      )?.textContent
    ).toContain('Initial');
  });

  it('unlocks an empty Markdown document as an editable themed paper', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.querySelector('p')).not.toBeNull();
    expect(
      visualEditor
        .closest('.easymde-prosemirror-surface')
        ?.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);

    visualEditor.innerHTML = '<p>First visual paragraph</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('First visual paragraph')
    );

    fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
    await waitFor(() =>
      expect(
        view
          .getByRole('button', { name: '解除锁定并编辑' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
  });

  it('prepares the current code theme before unlocking a fresh visual document', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const preparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      preparation.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));

    unlock.focus();
    expect(document.activeElement).toBe(unlock);
    fireEvent.click(unlock);

    expect(unlock.getAttribute('aria-label')).toBe('解除锁定并编辑');
    expect(unlock.getAttribute('aria-busy')).toBe('true');
    expect(unlock.getAttribute('aria-disabled')).toBe('true');
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(unlock);
    expect(unlock.classList.contains('is-unlocking')).toBe(true);
    expect(
      unlock.querySelector('.easymde-immersive-preview-unlock-spinner')
    ).not.toBeNull();
    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          codeTheme: 'atom-one-dark',
          signal: expect.any(AbortSignal)
        })
      )
    );
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    expect(props.submissionField.value).toBe('');

    await act(async () => preparation.resolve(prepared));

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.querySelector('p')).not.toBeNull();
    const lock = view.getByRole('button', { name: '锁定为只读' });
    expect(lock.hasAttribute('aria-busy')).toBe(false);
    expect(lock.hasAttribute('disabled')).toBe(false);
    expect(prepared.commit).toHaveBeenCalledOnce();
    expect(props.submissionField.value).toBe('');
  });

  it('waits for the visual surface before handing compact Outline focus to Preview', async () => {
    const baseProps = fixture();
    const markdown = '# Heading';
    baseProps.submissionField.value = markdown;
    baseProps.submissionField.defaultValue = markdown;
    const previewHtml = '<h1>Heading</h1>' as SafePreviewHtml;
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: previewHtml,
        signature: 'compact-focus'
      }
    };
    const preparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, previewHtml, {}))
    );
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      preparation.promise
    );
    vi.spyOn(props.immersiveEnvironment, 'viewportWidth').mockReturnValue(390);
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const outlineControl = view.container.querySelector<HTMLButtonElement>(
      '.easymde-immersive-outline button'
    );
    if (!outlineControl)
      throw new Error('compact-test-outline-control-unavailable');
    outlineControl.focus();
    expect(document.activeElement).toBe(outlineControl);

    const unlock = view.getByRole('button', { name: '解除锁定并编辑' });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    const nativeFocus = HTMLElement.prototype.focus;
    let visualSurfaceFocusAttempts = 0;
    const focusSpy = vi
      .spyOn(HTMLElement.prototype, 'focus')
      .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
        if (this.classList.contains('easymde-immersive-visual-editor')) {
          visualSurfaceFocusAttempts += 1;
        }
        nativeFocus.call(this, options);
      });

    try {
      fireEvent.click(unlock);
      await waitFor(() =>
        expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledOnce()
      );
      expect(unlock.getAttribute('aria-busy')).toBe('true');
      expect(
        view.container.querySelector('.easymde-immersive-outline')
      ).not.toBeNull();
      expect(document.activeElement).toBe(outlineControl);

      await act(async () => preparation.resolve(prepared));

      expect(prepared.commit).toHaveBeenCalledOnce();
      const visualSurface = view.container.querySelector<HTMLElement>(
        '.easymde-immersive-visual-editor'
      );
      if (!visualSurface)
        throw new Error('compact-test-visual-surface-unavailable');
      expect(visualSurface.getAttribute('contenteditable')).toBe('true');
      expect(visualSurface.getAttribute('role')).toBe('textbox');
      expect(visualSurface.getAttribute('aria-label')).toBe('可视化文章编辑器');
      await waitFor(() =>
        expect(
          view.container.querySelector('.easymde-immersive-outline')
        ).toBeNull()
      );
      expect(visualSurfaceFocusAttempts).toBe(1);
      expect(document.activeElement).toBe(visualSurface);
      expect(props.onFailure).not.toHaveBeenCalledWith(
        'visual-editor-focus-surface-unavailable'
      );
      expect(props.onFailure).not.toHaveBeenCalledWith(
        'visual-editor-focus-surface-failed'
      );
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('prepares code resources for a non-empty visual document and syncs each new code frame once', async () => {
    const props = fixture();
    const preparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      preparation.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          codeTheme: 'atom-one-dark',
          signal: expect.any(AbortSignal)
        })
      )
    );
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();

    await act(async () => preparation.resolve(prepared));

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(prepared.commit).toHaveBeenCalledOnce();
    const syncBaseline = vi.mocked(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).mock.calls.length;

    visualEditor.innerHTML =
      '<pre data-language="js"><code class="hljs language-js">const x = 1;</code></pre>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toContain('const x = 1;')
    );
    await waitFor(() =>
      expect(
        vi.mocked(props.enhancementPort.syncCodeFrameBackgrounds).mock.calls
          .length
      ).toBeGreaterThanOrEqual(syncBaseline)
    );
  });

  it('ignores a repeated fresh unlock and abandons it when the code theme changes', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    const githubPrepared = { cancel: vi.fn(), commit: vi.fn() };
    let unlockSignal: AbortSignal | null = null;
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ codeTheme, signal }) => {
        if ('atom-one-dark' === codeTheme) {
          unlockSignal = signal;
          return pendingPreparation.promise;
        }
        return Promise.resolve(githubPrepared);
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    fireEvent.click(unlock);

    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledTimes(1)
    );
    expect(unlock.getAttribute('aria-busy')).toBe('true');
    expect(unlock.getAttribute('aria-disabled')).toBe('true');
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));
    await waitFor(() => expect(unlockSignal?.aborted).toBe(true));
    expect(unlock.hasAttribute('aria-busy')).toBe(false);
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(unlock.classList.contains('is-unlocking')).toBe(false);

    await act(async () => pendingPreparation.resolve(prepared));
    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenCalledWith(
        {
          codeTheme: 'github',
          customCssId: '',
          markdownTheme: 'default'
        },
        true
      )
    );
  });

  it('reports a fresh unlock preparation failure and allows a later retry', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme)
      .mockRejectedValueOnce(
        new Error('preview-enhancement-resource-load-failed')
      )
      .mockResolvedValueOnce(prepared);
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      )
    );
    expect(unlock.hasAttribute('aria-busy')).toBe(false);
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(unlock.classList.contains('is-unlocking')).toBe(false);
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    fireEvent.click(unlock);
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    expect(prepared.commit).toHaveBeenCalledOnce();
  });

  it('aborts a pending fresh unlock when immersive mode changes', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    let unlockSignal: AbortSignal | null = null;
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ signal }) => {
        unlockSignal = signal;
        return pendingPreparation.promise;
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    await waitFor(() => expect(unlockSignal).not.toBeNull());

    fireEvent.click(view.getByRole('button', { name: '分屏模式' }));
    await waitFor(() => expect(unlockSignal?.aborted).toBe(true));
    await act(async () => pendingPreparation.resolve(prepared));

    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const relockedPreview = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    expect(relockedPreview.hasAttribute('aria-busy')).toBe(false);
    expect(relockedPreview.hasAttribute('disabled')).toBe(false);
  });

  it('does not enable a fresh unlock after its Preview snapshot becomes stale', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      pendingPreparation.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledOnce()
    );

    const source = view.getByRole('textbox', { name: 'Markdown source' });
    const sourceView = EditorView.findFromDOM(source);
    if (!sourceView) throw new Error('markdown-source-view-unavailable');
    act(() => {
      sourceView.dispatch({
        changes: { from: 0, insert: 'Snapshot changed' }
      });
    });
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Snapshot changed')
    );
    expect(unlock.hasAttribute('aria-busy')).toBe(false);
    expect(unlock.classList.contains('is-unlocking')).toBe(false);
    expect(
      vi.mocked(props.enhancementPort.prepareCodeTheme).mock.calls[0]?.[0]
        .signal.aborted
    ).toBe(true);

    await act(async () => pendingPreparation.resolve(prepared));
    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
  });

  it('cancels a pending fresh unlock on unmount and ignores its late result', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    let unlockSignal: AbortSignal | null = null;
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ signal }) => {
        unlockSignal = signal;
        return pendingPreparation.promise;
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    await waitFor(() => expect(unlockSignal).not.toBeNull());

    view.unmount();
    expect((unlockSignal as AbortSignal | null)?.aborted).toBe(true);
    await act(async () => pendingPreparation.resolve(prepared));
    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
  });

  it('preserves the plain visual paste path for a remote image when image hosting is disabled', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      imageUpload: { ...baseProps.imageUpload, enabled: false }
    };
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          'Before **safe** dropped' === request.markdown
            ? ('<p>Before <strong>safe</strong> dropped</p>' as SafePreviewHtml)
            : 'Before **safe**' === request.markdown
              ? ('<p>Before <strong>safe</strong></p>' as SafePreviewHtml)
              : ('<p>Before</p>' as SafePreviewHtml),
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const text = visualEditor.querySelector('p')?.firstChild;
    if (!text) throw new Error('missing synthetic paste target');
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const accepted = fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type
            ? ' **safe**'
            : '<img alt="remote" src="https://images.example.test/remote.png">'
      }
    });

    expect(accepted).toBe(false);
    expect(visualEditor.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before **safe**')
    );
    expect(props.remoteImageImportPort.import).not.toHaveBeenCalled();

    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing synthetic drop target');
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const dropped = fireEvent.drop(visualEditor, {
      dataTransfer: {
        getData: (type: string) =>
          'text/plain' === type
            ? ' dropped'
            : '<img src="x" onerror="window.__unsafeDrop = true">'
      }
    });

    expect(dropped).toBe(false);
    expect(visualEditor.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before **safe** dropped')
    );
  });

  it.each(['paste', 'drop'] as const)(
    'routes visual Preview image %s through the WordPress upload owner',
    async (source) => {
      const props = fixture();
      props.submissionField.value = 'Before **selected** after';
      props.submissionField.defaultValue = 'Before **selected** after';
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(
            request,
            '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
            {}
          )
        )
      );
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visualEditor = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const selectedText = visualEditor.querySelector('strong')?.firstChild;
      if (!selectedText) {
        throw new Error('missing synthetic visual image-paste target');
      }
      const range = document.createRange();
      range.selectNodeContents(selectedText);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const transfer = imageTransferEvent(
        source,
        new File(['image'], 'visual.png', { type: 'image/png' })
      );

      visualEditor.dispatchEvent(transfer);

      expect(transfer.defaultPrevented).toBe(true);
      await waitFor(() => {
        expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(1);
        expect(props.submissionField.value).toBe(
          'Before **![visual](https://example.test/upload.png)** after'
        );
      });
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBe(visualEditor);
      expect(
        visualEditor.querySelector('img[src="https://example.test/upload.png"]')
      ).not.toBeNull();
      const messageHost = view.container.querySelector(
        '.easymde-editor-message-alert-host'
      );
      expect(messageHost).not.toBeNull();
      expect(
        within(messageHost as HTMLElement).getByRole('status').textContent
      ).toContain('paste' === source ? 'Paste uploaded' : 'Drop uploaded');
    }
  );

  it('completes a deferred remote image import after visual editing switches to read-only', async () => {
    const props = fixture();
    props.submissionField.value = 'Before **selected** after';
    props.submissionField.defaultValue = 'Before **selected** after';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    let resolveImport: (result: RemoteImageImportResult) => void = () =>
      undefined;
    vi.mocked(props.remoteImageImportPort.import).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) throw new Error('missing remote image paste target');
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) =>
          'text/html' === type
            ? '<img alt="remote" src="https://images.example.test/remote.png">'
            : '',
        items: []
      }
    });

    visualEditor.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.remoteImageImportPort.import).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        'Before **![remote](https://images.example.test/remote.png)** after'
      );
    });
    fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
    await waitFor(() =>
      expect(
        view.getByRole('button', { name: '解除锁定并编辑' })
      ).not.toBeNull()
    );
    expect(
      vi.mocked(props.remoteImageImportPort.import).mock.calls[0]?.[0].signal
        .aborted
    ).toBe(false);
    resolveImport({
      alt: 'remote',
      backup: { status: 'disabled' },
      status: 'imported',
      title: '',
      url: 'https://example.test/imported.png'
    });
    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        'Before **![remote](https://example.test/imported.png)** after'
      );
    });
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'remote-image-import-completed-after-teardown'
    );
  });

  it('remounts the Preview owner before applying a theme from visual Preview', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const renderPreview = vi.mocked(props.previewPort.render);
    const renderCount = renderPreview.mock.calls.length;

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() => {
      expect(props.appearancePort.applyState).toHaveBeenCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        false
      );
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull();
    });
    await waitFor(() => {
      expect(renderPreview.mock.calls.length).toBeGreaterThan(renderCount);
      expect(renderPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      );
    });
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
  });

  it('keeps the visible article theme unchanged until its stylesheet is ready', async () => {
    const props = fixture();
    const pending = deferred<boolean>();
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      pending.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(false);

    pending.resolve(true);

    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink]')
          ?.classList.contains('easymde-markdown-theme-newsprint')
      ).toBe(true)
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByText('未保存')).not.toBeNull();
  });

  it.each([
    { control: 'Article theme', option: 'Newsprint' },
    { control: 'Code theme', option: 'GitHub' }
  ])(
    'blocks native submission and autosave until the pending $control transaction settles',
    async ({ control, option }) => {
      const props = fixture();
      const pending = deferred<boolean>();
      vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
        pending.promise
      );
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', {
          name: '编辑器设置'
        })
      );
      fireEvent.click(view.getByRole('combobox', { name: control }));
      fireEvent.click(view.getByRole('option', { name: option }));

      const pendingSubmit = new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true
      });
      expect(props.nativeForm.dispatchEvent(pendingSubmit)).toBe(false);
      expect(props.sessionAutosave()).toBe('blocked');
      expect(props.onFailure).toHaveBeenCalledWith('editor-appearance-pending');

      pending.resolve(true);
      await waitFor(() => {
        expect(props.appearancePort.applyState).toHaveResolvedTimes(1);
      });

      const settledSubmit = new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true
      });
      expect(props.nativeForm.dispatchEvent(settledSubmit)).toBe(true);
      expect(props.sessionAutosave()).toBe('continue');
    }
  );

  it('synchronizes a committed pending theme into Appearance after a mode remount', async () => {
    const props = fixture();
    const pending = deferred<boolean>();
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      pending.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));

    expect(
      view.getByRole('button', { name: 'Article theme' }).textContent
    ).toContain('Default');

    pending.resolve(true);

    await waitFor(() =>
      expect(
        view.getByRole('button', { name: 'Article theme' }).textContent
      ).toContain('Newsprint')
    );
  });

  it('reports a pending appearance failure after its initiating control remounts', async () => {
    const props = fixture();
    const pending = deferred<boolean>();
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      pending.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));

    pending.reject(
      new Error('appearance-article-theme-stylesheet-load-failed')
    );

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'react-editor-appearance-failed'
      )
    );
  });

  it('keeps the Preview owner and paper alive when entering Preview mode', async () => {
    const firstPreview = deferred<PreviewResponse>();
    const props = fixture();
    let firstPreviewRequest: PreviewRequest | null = null;
    vi.mocked(props.previewPort.render).mockImplementationOnce((request) => {
      firstPreviewRequest = request;
      return firstPreview.promise;
    });
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const previewOwner = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    expect(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    ).toBe(previewOwner);
    await act(async () => {
      if (!firstPreviewRequest)
        throw new Error('missing first preview request');
      firstPreview.resolve(
        createPreviewResponse(
          firstPreviewRequest,
          '<p>Current Preview</p>' as SafePreviewHtml,
          {}
        )
      );
    });
    await waitFor(() => {
      expect(view.getByText('Current Preview')).not.toBeNull();
      expect(view.getByText('内容已载入')).not.toBeNull();
    });
    expect(
      view
        .getByRole('button', { name: '解除锁定并编辑' })
        .hasAttribute('disabled')
    ).toBe(false);

    expect(view.getByText('Current Preview')).not.toBeNull();
  });

  it('keeps the selected article theme while Preview is locked and editable', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      appearance: {
        ...baseProps.appearance,
        state: {
          ...baseProps.appearance.state,
          markdownTheme: 'newsprint'
        }
      }
    };
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );
    const lockedPreview = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    expect(
      lockedPreview?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(
      lockedPreview?.classList.contains('easymde-immersive-reference-prose')
    ).toBe(false);

    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor).not.toBeNull();
    expect(
      visualEditor
        .closest('.easymde-prosemirror-surface')
        ?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(props.previewPort.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ markdownTheme: 'newsprint' }),
      expect.any(AbortSignal)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑' }));
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );
  });

  it('keeps enhanced generated blocks visible and lossless while visual text is edited', async () => {
    const source = [
      'Editable paragraph',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```'
    ].join('\n');
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          [
            '<p>Editable paragraph</p>',
            '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
            '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>'
          ].join('') as SafePreviewHtml,
          { math: true, mermaid: true }
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const protectedBlocks = visualEditor.querySelectorAll(
      '[data-easymde-protected-block]'
    );
    expect(protectedBlocks.length).toBeGreaterThanOrEqual(2);
    for (const region of protectedBlocks) {
      expect(region.getAttribute('contenteditable')).toBe('false');
    }

    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing synthetic visual paragraph');
    paragraph.textContent = 'Edited paragraph';
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        source.replace('Editable paragraph', 'Edited paragraph')
      )
    );
  });

  it('copies the formal PHP Preview after an unlocked ProseMirror visual edit', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          `<p>${request.markdown}</p>` as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing visual copy test paragraph');
    paragraph.textContent = 'Edited paragraph';
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    const preparationCallsBeforeEdit = preparation.mock.calls.length;
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Edited paragraph')
    );

    let resolvedCopySurface: HTMLElement | null = null;
    vi.mocked(props.wechatClipboard.copy).mockImplementation(
      async (surface, options) => {
        resolvedCopySurface = options?.resolvePreview
          ? await options.resolvePreview()
          : surface;
        return { method: 'clipboard', status: 'copied' };
      }
    );

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));

    const formalPreviewSink = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledOnce()
    );
    await waitFor(() => expect(resolvedCopySurface).toBe(formalPreviewSink));
    expect(props.wechatClipboard.copy).toHaveBeenCalledWith(
      formalPreviewSink,
      expect.objectContaining({
        pngConversionEnabled: false,
        postId: props.imageUpload.postId,
        maxBytes: props.imageUpload.maxBytes
      })
    );
    expect(vi.mocked(props.wechatClipboard.copy).mock.calls[0]?.[0]).not.toBe(
      visualEditor
    );
    expect(formalPreviewSink?.textContent).toContain('Edited paragraph');
    expect(preparation.mock.calls.length).toBeGreaterThanOrEqual(
      preparationCallsBeforeEdit
    );
  });

  it('does not prepare WeChat during an active visual Preview edit', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Original paragraph</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    preparation.mockClear();

    visualEditor.innerHTML = '<p>Rendered visual edit</p>';
    fireEvent.input(visualEditor);

    expect(preparation).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels a queued WeChat layout preparation when visual editing starts', async () => {
    const baseProps = fixture();
    const markdown = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index}`
    ).join('\n');
    const html = Array.from(
      { length: 200 },
      (_, index) => `<p>Paragraph ${index}</p>`
    ).join('') as SafePreviewHtml;
    const scheduled: Array<{ active: boolean; callback: () => void }> = [];
    const props = {
      ...baseProps,
      immersiveEnvironment: {
        ...baseProps.immersiveEnvironment,
        schedule: (callback: () => void) => {
          const task = { active: true, callback };
          scheduled.push(task);
          return () => {
            task.active = false;
          };
        }
      }
    };
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, html, {}))
    );
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull(), {
      timeout: 5_000
    });

    preparation.mockClear();
    scheduled.length = 0;
    act(() => props.triggerPreviewLayout());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    act(() => {
      scheduled
        .filter(({ active }) => active)
        .forEach(({ callback }) => {
          callback();
        });
    });
    expect(preparation).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels an active WeChat background preparation when visual editing starts', async () => {
    const baseProps = fixture();
    const pendingPreparation = deferred<void>();
    const scheduled: Array<{ active: boolean; callback: () => void }> = [];
    let activeSignal: AbortSignal | null = null;
    const prepare = vi.fn(
      (
        _surface: HTMLElement,
        options?: { background?: boolean; signal?: AbortSignal }
      ) => {
        if (options?.background) {
          activeSignal = options.signal ?? null;
          return pendingPreparation.promise;
        }
        return Promise.resolve();
      }
    );
    const props = {
      ...baseProps,
      immersiveEnvironment: {
        ...baseProps.immersiveEnvironment,
        schedule: (callback: () => void) => {
          const task = { active: true, callback };
          scheduled.push(task);
          return () => {
            task.active = false;
          };
        }
      },
      wechatClipboard: {
        ...baseProps.wechatClipboard,
        prepare
      }
    };
    const view = render(<EditorRoot {...props} />);

    try {
      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull(), {
        timeout: 5_000
      });

      scheduled.length = 0;
      act(() => props.triggerPreviewLayout());
      const task = scheduled.find(({ active }) => active);
      if (!task) throw new Error('missing WeChat background preparation task');
      act(() => task.callback());
      await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      expect(prepare.mock.calls[0]?.[1]).toMatchObject({ background: true });

      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      await view.findByRole('textbox', { name: '可视化文章编辑器' });

      expect(activeSignal).not.toBeNull();
      expect((activeSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      pendingPreparation.resolve();
      view.unmount();
    }
  });

  it('does not schedule WeChat preparation during rapid immersive visual edits', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Original paragraph</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    const preparationCallsBeforeEdit = preparation.mock.calls.length;

    vi.useFakeTimers();
    try {
      visualEditor.innerHTML = '<p>Rapid edit 1</p>';
      fireEvent.input(visualEditor);
      act(() => vi.advanceTimersByTime(100));
      visualEditor.innerHTML = '<p>Rapid edit 2</p>';
      fireEvent.input(visualEditor);
      act(() => vi.advanceTimersByTime(100));
      visualEditor.innerHTML = '<p>Rapid edit 3</p>';
      fireEvent.input(visualEditor);

      expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
      act(() => vi.advanceTimersByTime(259));
      expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
      act(() => vi.advanceTimersByTime(1));
      expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an unchanged visual Preview lock transition independent of selection mapping', async () => {
    const props = fixture();
    props.submissionField.value = 'Before **selected** after';
    props.submissionField.defaultValue = 'Before **selected** after';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('missing synthetic visual mode selection target');
    }
    const source = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = source ? EditorView.findFromDOM(source) : null;
    const selectionBeforeLock = editor?.state.selection.main;
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const lockPreview = view.getByRole('button', { name: '锁定为只读' });
    expect(fireEvent.mouseDown(lockPreview)).toBe(false);
    expect(window.getSelection()?.toString()).toBe('selected');
    fireEvent.click(lockPreview);

    expect(editor?.state.selection.main).toEqual(selectionBeforeLock);
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '编辑' }));

    expect(editor?.state.selection.main).toEqual(selectionBeforeLock);
  });
});

describe('ProseMirror immersive visual editor switchover', () => {
  it('mounts ProseMirror on unlock, keeps PreviewSurfaceOwner strictly read-only and hidden, and writes zero changes on read', async () => {
    const props = fixture();
    const initial = '# Visual Title\n\nParagraph body';
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<h1>Visual Title</h1><p>Paragraph body</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());

      const previewSink = view.container.querySelector<HTMLElement>(
        '[data-easymde-preview-html-sink]'
      );
      expect(previewSink).not.toBeNull();
      expect(previewSink?.getAttribute('contenteditable')).toBeNull();
      expect(
        previewSink?.classList.contains('easymde-preview-surface-hidden')
      ).toBe(false);

      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visualEditor = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });

      // ProseMirror owns editing inside its own scoped surface.
      expect(visualEditor.classList.contains('easymde-prosemirror-editor')).toBe(
        true
      );
      expect(visualEditor.getAttribute('contenteditable')).toBe('true');
      expect(
        visualEditor.closest('.easymde-prosemirror-surface')
      ).not.toBeNull();

      // PreviewSurfaceOwner stays strictly read-only and hidden while unlocked.
      expect(previewSink?.getAttribute('contenteditable')).toBeNull();
      expect(
        previewSink?.classList.contains('easymde-preview-surface-hidden')
      ).toBe(true);

      // Zero write-on-read invariant: unlocking and locking without edits leaves canonical Markdown untouched.
      expect(props.submissionField.value).toBe(initial);
      const renderCountBeforeLock = vi.mocked(props.previewPort.render).mock
        .calls.length;
      fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
      await waitFor(() =>
        expect(
          view.queryByRole('textbox', { name: '可视化文章编辑器' })
        ).toBeNull()
      );
      expect(
        previewSink?.classList.contains('easymde-preview-surface-hidden')
      ).toBe(false);
      expect(props.submissionField.value).toBe(initial);
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        renderCountBeforeLock
      );
    } finally {
      view.unmount();
    }
  });

  it('syncs ProseMirror edits to canonical Markdown and refreshes formal PHP Preview on lock', async () => {
    const props = fixture();
    props.submissionField.value = 'Before edit';
    props.submissionField.defaultValue = 'Before edit';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          `<p>${request.markdown}</p>` as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());

      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visualEditor = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const renderCountWhileUnlocked = vi.mocked(props.previewPort.render).mock
        .calls.length;

      visualEditor.innerHTML = '<p>After ProseMirror edit</p>';
      fireEvent.input(visualEditor);

      await waitFor(() =>
        expect(props.submissionField.value).toBe('After ProseMirror edit')
      );
      // Keystrokes stay local in ProseMirror without firing preview requests per edit.
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        renderCountWhileUnlocked
      );

      // Locking refreshes formal PHP Preview with the updated canonical Markdown.
      fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
      await waitFor(() =>
        expect(props.previewPort.render).toHaveBeenLastCalledWith(
          expect.objectContaining({ markdown: 'After ProseMirror edit' }),
          expect.any(AbortSignal)
        )
      );
      const previewSink = view.container.querySelector<HTMLElement>(
        '[data-easymde-preview-html-sink]'
      );
      await waitFor(() =>
        expect(previewSink?.textContent).toContain('After ProseMirror edit')
      );
      expect(
        previewSink?.classList.contains('easymde-preview-surface-hidden')
      ).toBe(false);
    } finally {
      view.unmount();
    }
  });

  it('unlocks large >160-block documents in one unified ProseMirror surface without requiring an editMap', async () => {
    const props = fixture();
    const blocks = Array.from({ length: 180 }, (_, index) => `Block ${index}`);
    const largeMarkdown = blocks.join('\n\n');
    props.submissionField.value = largeMarkdown;
    props.submissionField.defaultValue = largeMarkdown;
    vi.mocked(props.previewPort.render).mockImplementation(() =>
      Promise.resolve({
        features: {},
        html: blocks.map((line) => `<p>${line}</p>`).join('') as SafePreviewHtml
      })
    );
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());

      const unlock = view.getByRole('button', { name: '解除锁定并编辑' });
      expect(unlock.hasAttribute('disabled')).toBe(false);
      fireEvent.click(unlock);

      const visualEditor = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      expect(visualEditor.querySelectorAll('p').length).toBe(180);
      expect(
        view.container.querySelector('[data-easymde-preview-window-spacer]')
      ).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
