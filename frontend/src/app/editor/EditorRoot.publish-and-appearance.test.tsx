import { createElement } from '@wordpress/element';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within
} from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../contracts/ports/preview-request';
import { EditorRoot } from './EditorRoot';
import {
  cleanupEditorRootTestHarness,
  createPreviewResponse,
  deferred,
  fixture,
  imageTransferEvent
} from './editor-root-test-harness';

afterEach(cleanupEditorRootTestHarness);

describe('EditorRoot publish and appearance', () => {
  it('keeps publish editing local until confirmation then delegates to the native publisher', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    expect(await view.findByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(
      (
        view.getByRole('switch', {
          name: '更新后打开文章页面'
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    const excerpt = view.getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;
    fireEvent.change(excerpt, { target: { value: '尚未提交的摘要' } });
    const backdrop = view.container.querySelector('.easymde-publish-backdrop');
    if (!(backdrop instanceof HTMLElement)) {
      throw new Error('publish-backdrop-unavailable');
    }
    fireEvent.click(backdrop);
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(excerpt.value).toBe('尚未提交的摘要');

    fireEvent.click(view.getByRole('button', { name: '取消' }));
    expect(view.queryByRole('dialog', { name: '更新文章' })).toBeNull();
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    const reopenedDialog = await view.findByRole('dialog', { name: '更新文章' });
    fireEvent.click(view.getByRole('switch', { name: '更新后打开文章页面' }));
    fireEvent.click(
      within(reopenedDialog).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledOnce();
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ openPreview: false })
    );
    expect(props.publishPost).toHaveBeenCalledOnce();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'savepost',
      expect.anything()
    );
  });

  it('synchronizes pending visual input before deriving the publish excerpt', async () => {
    const props = fixture();
    const original = 'Original excerpt';
    const edited = 'Latest visual excerpt';
    props.submissionField.value = original;
    props.submissionField.defaultValue = original;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          `<p>${original}</p>` as SafePreviewHtml,
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
    if (!paragraph) throw new Error('publish-pending-native-text-missing');
    paragraph.textContent = edited;
    fireEvent.input(visualEditor);
    await waitFor(() => expect(props.submissionField.value).toBe(edited));

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = await view.findByRole('dialog', { name: '更新文章' });
    expect(
      (
        within(dialog).getByPlaceholderText(
          '撰写摘要...'
        ) as HTMLTextAreaElement
      ).value
    ).toBe(edited);
    expect(props.submissionField.value).toBe(edited);
  });

  it.each([
    ['auto-55', 55],
    ['auto-100', 100]
  ] as const)(
    'derives the %s publish excerpt from the current Markdown without writing before confirmation',
    async (summaryMode, characterLimit) => {
      const props = fixture();
      const markdown = '摘😀'.repeat(60);
      const expected = Array.from(markdown).slice(0, characterLimit).join('');
      props.submissionField.value = markdown;
      props.submissionField.defaultValue = markdown;
      vi.mocked(props.nativePublishPort.read).mockReturnValue({
        ...props.nativePublishPort.read(),
        excerpt: 'WordPress 原生摘要'
      });
      const view = render(
        <EditorRoot
          {...props}
          settings={{
            general: { ...props.settings.general, summaryMode },
            markdown: props.settings.markdown
          }}
        />
      );

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '更新文章' }));
      const dialog = await view.findByRole('dialog', { name: '更新文章' });
      expect(
        (
          within(dialog).getByPlaceholderText(
            '撰写摘要...'
          ) as HTMLTextAreaElement
        ).value
      ).toBe(expected);
      expect(
        within(dialog).getByText(`${characterLimit} / 160`)
      ).not.toBeNull();
      expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
      expect(props.publishPost).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));
      expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
        expect.objectContaining({ excerpt: expected })
      );
    }
  );

  it('keeps the native WordPress excerpt in manual mode and discards a cancelled dialog draft', async () => {
    const props = fixture();
    props.submissionField.value = '当前 Markdown 正文与原生摘要不同';
    props.submissionField.defaultValue = props.submissionField.value;
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      excerpt: 'WordPress 原生摘要'
    });
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          general: { ...props.settings.general, summaryMode: 'manual' },
          markdown: props.settings.markdown
        }}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    let dialog = await view.findByRole('dialog', { name: '更新文章' });
    const firstDraft = within(dialog).getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;

    expect(firstDraft.value).toBe('WordPress 原生摘要');
    fireEvent.change(firstDraft, { target: { value: '取消的手工摘要' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    dialog = await view.findByRole('dialog', { name: '更新文章' });
    const confirmedDraft = within(dialog).getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;
    expect(confirmedDraft.value).toBe('WordPress 原生摘要');
    fireEvent.change(confirmedDraft, { target: { value: '确认的手工摘要' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));

    expect(props.nativePublishPort.apply).toHaveBeenCalledOnce();
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: '确认的手工摘要' })
    );
  });

  it('limits manual publish excerpts to 160 Unicode code points before submission', async () => {
    const props = fixture();
    const entered = '摘😀'.repeat(100);
    const expected = Array.from(entered).slice(0, 160).join('');
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          general: { ...props.settings.general, summaryMode: 'manual' },
          markdown: props.settings.markdown
        }}
      />
    );

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    const dialog = await view.findByRole('dialog', { name: '更新文章' });
    const excerpt = within(dialog).getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;

    fireEvent.change(excerpt, { target: { value: entered } });
    expect(excerpt.value).toBe(expected);
    expect(Array.from(excerpt.value)).toHaveLength(160);
    expect(within(dialog).getByText('160 / 160')).not.toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: expected })
    );
  });

  it('restores the legacy protected-post password field contract', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = await view.findByRole('dialog', { name: '更新文章' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '密码' }));

    const password = within(dialog).getByPlaceholderText(
      '输入访问密码'
    ) as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.maxLength).toBe(255);

    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));
    expect(within(dialog).getByRole('alert').textContent).toBe(
      '请输入访问密码后再提交。'
    );
    expect(document.activeElement).toBe(password);
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    fireEvent.change(password, { target: { value: 'temporary-password' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '私密' }));
    expect(within(dialog).queryByPlaceholderText('输入访问密码')).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: '密码' }));
    expect(
      (within(dialog).getByPlaceholderText('输入访问密码') as HTMLInputElement)
        .value
    ).toBe('');
  });

  it('renders the source-accurate publish decorations and submitting progress owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = await view.findByRole('dialog', { name: '更新文章' });
    expect(
      dialog.querySelectorAll('.easymde-publish-heading-sparkle')
    ).toHaveLength(1);
    expect(
      dialog.querySelectorAll('.easymde-publish-button-sparkles svg')
    ).toHaveLength(2);
    expect(
      dialog.querySelector('.easymde-publish-featured-placeholder')
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: /选择特色图片/u })
    ).not.toBeNull();
    expect(within(dialog).getByText('建议使用横向图片')).not.toBeNull();
    expect(
      within(dialog).getByText('支持 JPG、PNG、WebP 格式，最大 5MB')
    ).not.toBeNull();
    const progress = dialog.querySelector('.easymde-publish-progress');
    expect(progress?.getAttribute('aria-live')).toBe('polite');
    expect(progress?.textContent).toBe('');

    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));

    expect(progress?.textContent).toBe('加载预览中...');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the effective image-upload guidance supplied by WordPress', async () => {
    const props = fixture();
    const view = render(
      <EditorRoot
        {...props}
        immersiveStrings={{
          ...props.immersiveStrings,
          imageRequirements: '支持 JPG、PNG、WebP 格式，最大 3 MB'
        }}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    expect(
      within(await view.findByRole('dialog', { name: '更新文章' })).getByText(
        '支持 JPG、PNG、WebP 格式，最大 3 MB'
      )
    ).not.toBeNull();
  });

  it('labels the existing WordPress Post action as update throughout immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.getByRole('button', { name: '更新文章' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '发布文章' })).toBeNull();
  });

  it('labels a new WordPress Post action as publish throughout immersive mode', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      categories: [
        {
          children: [],
          id: 'current-category',
          label: '当前分类'
        }
      ],
      categoryIds: ['current-category'],
      existing: false,
      openPreview: true
    });
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          general: {
            ...props.settings.general,
            openPreviewAfterPublish: false,
            publishVisibility: 'private'
          },
          markdown: props.settings.markdown
        }}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '发布文章' }));
    const dialog = await view.findByRole('dialog', { name: '发布文章' });
    expect(dialog).not.toBeNull();
    expect(view.queryByRole('button', { name: '更新文章' })).toBeNull();
    expect(
      (within(dialog).getByRole('radio', { name: '私密' }) as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(
      (
        within(dialog).getByRole('switch', {
          name: '发布后打开文章页面'
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (
        within(dialog).getByRole('checkbox', {
          name: '当前分类'
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      dialog.querySelector('.easymde-publish-featured-placeholder')
    ).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: '发布文章' }));
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['current-category'] })
    );
  });

  it('keeps hierarchical WordPress category selections independent', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      availableFields: {
        categories: true,
        excerpt: true,
        featuredImage: true,
        sticky: true,
        tags: true,
        visibility: true
      },
      categories: [
        {
          children: [
            {
              children: [],
              id: 'child',
              label: '子分类'
            }
          ],
          id: 'parent',
          label: '父分类'
        }
      ],
      categoryIds: ['child'],
      excerpt: '',
      featuredImage: null,
      openPreview: false,
      password: '',
      existing: true,
      sticky: false,
      tags: [],
      visibility: 'public'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    await view.findByRole('dialog', { name: '更新文章' });

    const parent = view.getByRole('checkbox', {
      name: '父分类'
    }) as HTMLInputElement;
    const child = view.getByRole('checkbox', {
      name: '子分类'
    }) as HTMLInputElement;
    expect(parent.checked).toBe(false);
    expect(parent.indeterminate).toBe(true);
    expect(child.checked).toBe(true);

    fireEvent.click(view.getByRole('button', { name: '收起 父分类' }));
    expect(view.queryByRole('checkbox', { name: '子分类' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开 父分类' }));
    fireEvent.click(view.getByRole('checkbox', { name: '子分类' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [] })
    );
  });

  it('omits publish controls without authoritative WordPress form owners', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      availableFields: {
        categories: false,
        excerpt: false,
        featuredImage: false,
        sticky: false,
        tags: false,
        visibility: true
      }
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = within(await view.findByRole('dialog', { name: '更新文章' }));
    expect(dialog.queryByText('标签')).toBeNull();
    expect(dialog.queryByText('摘要')).toBeNull();
    expect(dialog.queryByText('分类')).toBeNull();
    expect(dialog.queryByText('封面图')).toBeNull();
    expect(dialog.queryByRole('checkbox', { name: '置于首页顶端' })).toBeNull();
    expect(dialog.getByRole('radiogroup', { name: '可见性' })).not.toBeNull();
  });

  it('restores the native publish fields when the WordPress submit command is unavailable', async () => {
    const props = fixture();
    vi.mocked(props.publishPost).mockReturnValue(false);
    const original = props.nativePublishPort.read();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      within(await view.findByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledTimes(2);
    expect(props.nativePublishPort.apply).toHaveBeenLastCalledWith(original);
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-command-unavailable'
    );
    const dialog = view.getByRole('dialog', { name: '更新文章' });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'WordPress 未接受发布请求，请检查页面状态后重试。'
    );
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).toBeNull();
  });

  it('reports a native publish owner that disappears before confirmation', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.apply).mockImplementationOnce(() => {
      throw new Error('native-publish-tags-owner-unavailable');
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      within(await view.findByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.publishPost).not.toHaveBeenCalled();
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-native-owner-unavailable'
    );
    expect(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole('alert')
        .textContent
    ).toBe('WordPress 未接受发布请求，请检查页面状态后重试。');
  });

  it('matches the reference immersive control inventory without AI controls', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.getByRole('button', { name: '编辑模式' })).not.toBeNull();
    expect(view.getByRole('button', { name: '分屏模式' })).not.toBeNull();
    expect(view.getByRole('button', { name: '预览模式' })).not.toBeNull();
    expect(view.getAllByRole('button', { name: '退出沉浸写作' })).toHaveLength(
      1
    );
    expect(
      view.container.querySelectorAll(
        '.easymde-immersive-formatting .easymde-toolbar-divider'
      )
    ).toHaveLength(1);
    expect(
      view.container.querySelector(
        '.easymde-immersive-header .easymde-immersive-exit'
      )
    ).toBeNull();
    expect(view.queryByRole('button', { name: /AI/u })).toBeNull();
    expect(view.getByRole('button', { name: '编辑器设置' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '更多操作' })).toBeNull();
    const moreActions = view.container.querySelector(
      '.easymde-immersive-more-actions'
    );
    expect(moreActions?.tagName).toBe('SPAN');
    expect(moreActions?.getAttribute('aria-hidden')).toBe('true');
    const settings = view.getByRole('button', { name: '编辑器设置' });
    settings.focus();
    fireEvent.click(moreActions as HTMLElement);
    expect(document.activeElement).toBe(settings);

    const tableIcon = view
      .getByRole('button', { name: '表格' })
      .querySelector('svg');
    expect(
      Array.from(tableIcon?.children ?? []).map((node) => ({
        d: node.getAttribute('d'),
        height: node.getAttribute('height'),
        tag: node.tagName.toLowerCase(),
        width: node.getAttribute('width'),
        x: node.getAttribute('x'),
        y: node.getAttribute('y')
      }))
    ).toEqual([
      {
        d: 'M12 3v18',
        height: null,
        tag: 'path',
        width: null,
        x: null,
        y: null
      },
      { d: null, height: '18', tag: 'rect', width: '18', x: '3', y: '3' },
      {
        d: 'M3 9h18',
        height: null,
        tag: 'path',
        width: null,
        x: null,
        y: null
      },
      {
        d: 'M3 15h18',
        height: null,
        tag: 'path',
        width: null,
        x: null,
        y: null
      }
    ]);

    expect(
      Array.from(
        view.container.querySelectorAll('.easymde-immersive-wechat-glyph path')
      ).map((path) => path.getAttribute('d'))
    ).toEqual([
      'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
      'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
      'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
    ]);

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull()
    );
    expect(view.getByRole('status').textContent).toContain('Copied');
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(view.getByRole('dialog', { name: '编辑器设置' })).not.toBeNull();
    for (const name of ['文章大纲', '分屏预览']) {
      expect(
        view.getByRole('checkbox', { name }).getAttribute('aria-checked')
      ).toBe('true');
    }
    expect(view.queryByRole('checkbox', { name: '自动保存' })).toBeNull();
    expect(view.queryByText(/AI/u)).toBeNull();
  });

  it('keeps the immersive H trigger stable while updating cursor status', async () => {
    const props = fixture();
    props.submissionField.value = '# First\nBody';
    props.submissionField.defaultValue = '# First\nBody';
    props.submissionField.setSelectionRange(0, 0);
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading1',
          label: 'Heading 1',
          level: 1,
          surface: 'heading-menu'
        }
      ]
    } as const;
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    const heading = view.getByRole('button', { name: 'Headings' });
    expect(
      heading.querySelector('.easymde-toolbar-text-icon')?.textContent
    ).toBe('H');
    expect(view.getByText('行 1, 列 1')).not.toBeNull();

    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    act(() => {
      editor?.dispatch({ selection: EditorSelection.cursor(8) });
    });

    await waitFor(() => {
      expect(
        heading.querySelector('.easymde-toolbar-text-icon')?.textContent
      ).toBe('H');
      expect(view.getByText('行 2, 列 1')).not.toBeNull();
    });
  });

  it('keeps unified operation feedback stable while leaving immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull()
    );
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));

    expect(view.getByRole('status').textContent).toContain('Copied');
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();
  });

  it('keeps a late immersive clipboard failure visible after returning to the ordinary editor', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    let finishCopy: ((result: ClipboardResult) => void) | null = null;
    vi.mocked(props.wechatClipboard.copy).mockImplementation(
      () =>
        new Promise<ClipboardResult>((resolve) => {
          finishCopy = resolve;
        })
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    await act(async () => {
      finishCopy?.({ code: 'wechat-copy-failed', status: 'failed' });
    });

    expect(view.getByText('Copy failed')).not.toBeNull();
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();
  });

  it('renders immersive operation failures in the shared top alert', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('Copy failed')
    );
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.getByRole('alert').textContent).toBe('Copy failed');
  });

  it('expires ordinary feedback after 3000ms without letting a stale timer clear newer feedback', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(view.queryByText('Copied')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a stale close action clear newer feedback queued in the same turn', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    fireEvent.click(copy);
    await waitFor(() => expect(view.getByText('Copied')).not.toBeNull());
    const staleClose = view.getByRole('button', { name: '关闭' });
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();

    act(() => {
      source?.dispatchEvent(
        imageTransferEvent(
          'paste',
          new File(['x'.repeat(1025)], 'too-large.png', { type: 'image/png' })
        )
      );
      staleClose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.getByRole('alert').textContent).toBe('Paste too large');
  });

  it('resumes replacement feedback expiry after a focused stale close restores focus', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copy);
        await Promise.resolve();
      });
      const staleClose = view.getByRole('button', { name: '关闭' });
      const source = view.container.querySelector('.cm-content');
      expect(source).not.toBeNull();
      copy.focus();
      staleClose.focus();

      act(() => {
        source?.dispatchEvent(
          imageTransferEvent(
            'paste',
            new File(['x'.repeat(1025)], 'too-large.png', {
              type: 'image/png'
            })
          )
        );
        staleClose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(view.getByRole('alert').textContent).toBe('Paste too large');
      expect(document.activeElement).toBe(copy);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes auto-dismiss with only the remaining time after focus leaves', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      const close = view.getByRole('button', { name: '关闭' });

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      fireEvent.focus(close);

      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      fireEvent.blur(close);
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.queryByText('Copied')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('automatically dismisses an error after 3000ms', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copy);
        await Promise.resolve();
      });
      expect(view.getByRole('alert').textContent).toBe('Copy failed');

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(view.getByRole('alert').textContent).toBe('Copy failed');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let unrelated success feedback overwrite an error before auto-dismiss', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: 'Copy to WeChat' })
    );
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('Copy failed')
    );

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(props.localDraftStorage.write).toHaveBeenCalledOnce()
    );
    expect(view.getByRole('alert').textContent).toBe('Copy failed');
  });

  it('matches the reference 1800ms immersive copy-feedback duration', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1799);
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches the reference outline drag bounds, reset and cleanup lifecycle', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    const separator = view.getByRole('separator', {
      name: '调整大纲宽度'
    });
    const outlineActions = view.getAllByRole('button', {
      name: '收起大纲'
    });
    const footerAction = outlineActions.at(-1);
    if (!footerAction) throw new Error('outline-footer-control-unavailable');
    expect(
      Array.from(footerAction.childNodes).some(
        (node) =>
          Node.TEXT_NODE === node.nodeType
          && '收起大纲' === node.textContent?.trim()
      )
    ).toBe(true);

    expect(separator.getAttribute('aria-valuenow')).toBe('240');
    fireEvent.pointerDown(separator, {
      clientX: 240,
      pointerId: 1,
      pointerType: 'touch'
    });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerMove(document, { clientX: 500, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    fireEvent.pointerMove(document, { clientX: -100, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('190');
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');

    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('240');

    fireEvent.pointerDown(separator, { clientX: 240, pointerId: 2 });
    const [hideOutline] = view.getAllByRole('button', {
      name: '收起大纲'
    });
    if (!hideOutline) throw new Error('hide-outline-control-unavailable');
    fireEvent.click(hideOutline);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    fireEvent.mouseMove(document, { clientX: 320 });
    fireEvent.mouseUp(document);
  });

  it('applies immersive presentation settings to the real outline and scroll owners', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    fireEvent.click(view.getByRole('checkbox', { name: '文章大纲' }));
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(view.queryByRole('complementary', { name: '文章大纲' })).toBeNull();
    expect(
      view.container.querySelector('.easymde-immersive-stats')
    ).not.toBeNull();
    expect(view.getByText('自动保存已开启')).not.toBeNull();
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledTimes(4);
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(3);
    expect(props.immersivePreferencesPort.write).toHaveBeenCalledTimes(1);
    expect(props.immersivePreferencesPort.write).toHaveBeenCalledWith({
      outline: false
    });
  });

  it.each([
    {
      characters: true,
      minutes: true,
      mode: 'detailed',
      words: true
    },
    {
      characters: true,
      minutes: false,
      mode: 'compact',
      words: false
    },
    {
      characters: false,
      minutes: false,
      mode: 'hidden',
      words: false
    }
  ] as const)(
    'links immersive statistics to the $mode global status mode',
    async ({ characters, minutes, mode, words }) => {
      const baseProps = fixture();
      const props = {
        ...baseProps,
        settings: {
          general: { ...baseProps.settings.general, statusBarMode: mode },
          markdown: baseProps.settings.markdown
        }
      };
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );

      expect(null !== view.queryByText('8 字符')).toBe(characters);
      expect(null !== view.queryByText('1 词')).toBe(words);
      expect(null !== view.queryByText('约 1 分钟')).toBe(minutes);
    }
  );

  it('keeps the disabled global auto-save setting authoritative in immersive mode', async () => {
    const baseProps = fixture();
    vi.mocked(baseProps.immersivePreferencesPort.read).mockReturnValue({
      preferences: {
        outline: true
      },
      status: 'loaded'
    });
    const props = {
      ...baseProps,
      settings: {
        general: {
          ...baseProps.settings.general,
          autoSave: false,
          syncScroll: false
        },
        markdown: baseProps.settings.markdown
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    expect(view.queryByRole('checkbox', { name: '自动保存' })).toBeNull();
    expect(view.queryByText('自动保存已开启')).toBeNull();
    expect(view.queryByRole('checkbox', { name: '同步滚动' })).toBeNull();
    expect(props.scrollSyncPort.prepareBinding).not.toHaveBeenCalled();
    expect(baseProps.immersivePreferencesPort.write).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('checkbox', { name: '文章大纲' }));
    expect(baseProps.immersivePreferencesPort.write).toHaveBeenCalledWith({
      outline: false
    });
    expect(baseProps.immersivePreferencesPort.write).toHaveBeenCalledTimes(1);
  });

  it('keeps global auto save authoritative when retired immersive preferences are absent', async () => {
    const props = fixture();
    vi.mocked(props.immersivePreferencesPort.read).mockReturnValue({
      preferences: {
        outline: true
      },
      status: 'loaded'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(view.getByText('自动保存已开启')).not.toBeNull();
    expect(view.queryByRole('checkbox', { name: '同步滚动' })).toBeNull();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await act(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, 600))
    );
    expect(props.localDraftStorage.write).toHaveBeenCalled();
  });

  it('maps Settings Center editing modes to immersive modes and rereads only outline preferences', async () => {
    const props = fixture();
    const modes = [
      ['live-preview', 'is-immersive-split'],
      ['source', 'is-immersive-source'],
      ['preview', 'is-immersive-preview']
    ] as const;

    for (const [editingMode, expectedClass] of modes) {
      const view = render(
        <EditorRoot
          {...props}
          settings={{
            ...props.settings,
            general: { ...props.settings.general, editingMode }
          }}
        />
      );

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains(expectedClass)
      ).toBe(true);
      expect(props.immersivePreferencesPort.read).toHaveBeenCalled();
      view.unmount();
    }
  });

  it('keeps the split preview control synchronized with top mode buttons without persisting it', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    const splitPreview = view.getByRole('checkbox', { name: '分屏预览' });
    expect(splitPreview.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(view.getByRole('button', { name: /^编辑$/u }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    expect(splitPreview.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(view.getByRole('button', { name: /^分屏$/u }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(splitPreview.getAttribute('aria-checked')).toBe('true');
    expect(props.immersivePreferencesPort.write).not.toHaveBeenCalled();
  });

  it('retains a temporary immersive mode across same-page exit and re-entry', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: /^预览$/u }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
  });

  it('closes ordinary Settings when the heading menu opens and runs its command', async () => {
    const props = fixture();
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading1',
          label: 'Heading 1',
          level: 1,
          surface: 'heading-menu'
        }
      ]
    } as const;
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    const headings = view.getByRole('button', { name: 'Headings' });
    const settings = view.getByRole('button', { name: '编辑器设置' });

    fireEvent.click(settings);
    expect(settings.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseDown(headings);
    fireEvent.click(headings, { detail: 1 });
    expect(settings.getAttribute('aria-expanded')).toBe('false');
    const headingItem = view.getByRole('menuitem', { name: 'Heading 1' });
    expect(document.activeElement).toBe(headings);
    fireEvent.click(headingItem);
  });

  it('reuses Preview HTML for equivalent article markup and prepares code CSS without enhancing', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const renderCount = vi.mocked(props.previewPort.render).mock.calls.length;
    const enhanceCount = vi.mocked(props.enhancementPort.enhance).mock.calls
      .length;
    const sink = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink]')
          ?.classList.contains('easymde-markdown-theme-newsprint')
      ).toBe(true)
    );
    expect(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    ).toBe(sink);
    expect(props.previewPort.render).toHaveBeenCalledTimes(renderCount);

    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));
    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          codeTheme: 'github',
          signal: expect.any(AbortSignal)
        })
      )
    );
    await waitFor(() =>
      expect(
        props.enhancementPort.syncCodeFrameBackgrounds
      ).toHaveBeenCalledWith(sink)
    );
    expect(props.previewPort.render).toHaveBeenCalledTimes(renderCount);
    expect(props.enhancementPort.enhance).toHaveBeenCalledTimes(enhanceCount);
  });

  it('keeps code theme authority unchanged after preparation failure and retries the same theme', async () => {
    const props = fixture();
    const nativeFields = {
      codeTheme: 'atom-one-dark',
      codeThemeExplicit: '0'
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (state, explicit) => {
        nativeFields.codeTheme = state.codeTheme;
        nativeFields.codeThemeExplicit = explicit ? '1' : '0';
        return true;
      }
    );
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockRejectedValueOnce(
      new Error('preview-enhancement-resource-load-failed')
    );
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockResolvedValueOnce(
      prepared
    );
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      )
    );
    const sink = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    expect(sink?.classList.contains('easymde-code-theme-atom-one-dark')).toBe(
      true
    );
    expect(sink?.classList.contains('easymde-code-theme-github')).toBe(false);
    expect(props.appearancePort.applyState).not.toHaveBeenCalled();
    expect(nativeFields).toEqual({
      codeTheme: 'atom-one-dark',
      codeThemeExplicit: '0'
    });
    expect(
      view.getByRole('combobox', { name: 'Code theme' }).textContent
    ).toContain('Atom One Dark');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByText('已保存')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));

    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledTimes(2)
    );
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
    await waitFor(() =>
      expect(sink?.classList.contains('easymde-code-theme-github')).toBe(true)
    );
    expect(nativeFields).toEqual({
      codeTheme: 'github',
      codeThemeExplicit: '1'
    });
    expect(prepared.commit).toHaveBeenCalledTimes(1);
    expect(prepared.cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByText('未保存')).not.toBeNull();
  });

  it('cancels superseded code CSS preparation and commits only the latest theme', async () => {
    const props = fixture();
    const github =
      deferred<Readonly<{ cancel: () => void; commit: () => void }>>();
    const terminal =
      deferred<Readonly<{ cancel: () => void; commit: () => void }>>();
    const githubTransaction = { cancel: vi.fn(), commit: vi.fn() };
    const terminalTransaction = { cancel: vi.fn(), commit: vi.fn() };
    const signals = new Map<string, AbortSignal>();
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ codeTheme, signal }) => {
        signals.set(codeTheme, signal);
        return 'github' === codeTheme ? github.promise : terminal.promise;
      }
    );
    const appearance = {
      ...props.appearance,
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const renderCount = vi.mocked(props.previewPort.render).mock.calls.length;

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));
    await waitFor(() => expect(signals.has('github')).toBe(true));

    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));
    await waitFor(() => expect(signals.has('terminal-noir')).toBe(true));
    expect(signals.get('github')?.aborted).toBe(true);
    expect(props.appearancePort.cancelPendingApply).toHaveBeenCalledTimes(2);

    await act(async () => github.resolve(githubTransaction));
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-code-theme-github')
    ).toBe(false);
    expect(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).not.toHaveBeenCalled();
    expect(githubTransaction.cancel).toHaveBeenCalledTimes(1);
    expect(githubTransaction.commit).not.toHaveBeenCalled();

    await act(async () => terminal.resolve(terminalTransaction));
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink]')
          ?.classList.contains('easymde-code-theme-terminal-noir')
      ).toBe(true)
    );
    await waitFor(() =>
      expect(
        props.enhancementPort.syncCodeFrameBackgrounds
      ).toHaveBeenCalledWith(
        view.container.querySelector('[data-easymde-preview-html-sink]')
      )
    );
    expect(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).toHaveBeenCalledTimes(1);
    expect(terminalTransaction.commit).toHaveBeenCalledTimes(1);
    expect(terminalTransaction.cancel).not.toHaveBeenCalled();
    expect(props.previewPort.render).toHaveBeenCalledTimes(renderCount);
  });

  it('rerenders Preview when the article markup profile changes', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        markupProfile:
          'newsprint' === theme.id ? 'markdown2html-v1' : 'common-v1'
      }))
    };
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() => {
      expect(props.previewPort.render).toHaveBeenCalledTimes(2);
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      );
    });
  });

  it('does not let a late native bridge event duplicate an article theme refresh', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        markupProfile:
          'newsprint' === theme.id ? 'markdown2html-v1' : 'common-v1'
      }))
    };
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(2)
    );

    vi.useFakeTimers();
    try {
      props.submissionField.dispatchEvent(
        new Event('input', { bubbles: true })
      );
      act(() => vi.advanceTimersByTime(180));
      expect(props.previewPort.render).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves an explicit code theme when Appearance remounts in immersive mode', async () => {
    const props = fixture();
    const codeThemeExplicitField = document.createElement('input');
    codeThemeExplicitField.value = '0';
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        defaultCodeTheme:
          'newsprint' === theme.id ? 'github' : theme.defaultCodeTheme
      })),
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (_state, explicit) => {
        codeThemeExplicitField.value = explicit ? '1' : '0';
        return true;
      }
    );
    const view = render(<EditorRoot {...props} appearance={appearance} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));
    await waitFor(() => expect(codeThemeExplicitField.value).toBe('1'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          codeTheme: 'terminal-noir',
          markdownTheme: 'newsprint'
        }),
        true
      )
    );
    expect(codeThemeExplicitField.value).toBe('1');
  });

  it('preserves an explicit code theme when Appearance remounts in ordinary mode', async () => {
    const props = fixture();
    const codeThemeExplicitField = document.createElement('input');
    codeThemeExplicitField.value = '0';
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        defaultCodeTheme:
          'newsprint' === theme.id ? 'github' : theme.defaultCodeTheme
      })),
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (_state, explicit) => {
        codeThemeExplicitField.value = explicit ? '1' : '0';
        return true;
      }
    );
    const view = render(<EditorRoot {...props} appearance={appearance} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));
    await waitFor(() => expect(codeThemeExplicitField.value).toBe('1'));
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          codeTheme: 'terminal-noir',
          markdownTheme: 'newsprint'
        }),
        true
      )
    );
    expect(codeThemeExplicitField.value).toBe('1');
  });

  it('preserves a named CSS theme saved in immersive mode after returning to the ordinary editor', async () => {
    const props = fixture();
    const savedSnapshot = {
      customCss: [
        {
          articleThemeName: 'Writer Article',
          codeThemeName: 'Writer Code',
          css: '.note { color: navy; }',
          id: 'writer-css',
          scopedCss: '.easymde-rendered-content .note { color: navy; }'
        }
      ],
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: 'writer-css',
        markdownTheme: 'custom'
      }
    } as const;
    const appearancePort = {
      ...props.appearancePort,
      saveCustomCss: vi.fn().mockResolvedValue({
        snapshot: savedSnapshot,
        status: 'saved' as const
      })
    };
    const view = render(
      <EditorRoot {...props} appearancePort={appearancePort} />
    );

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Custom CSS theme' }));
    fireEvent.change(
      await view.findByRole('textbox', {
        name: 'Article theme name'
      }),
      {
        target: { value: 'Writer Article' }
      }
    );
    fireEvent.click(view.getByRole('button', { name: /Custom CSS code/ }));
    fireEvent.change(view.getByRole('textbox', { name: 'Custom CSS code' }), {
      target: { value: '.note { color: navy; }' }
    });
    fireEvent.click(view.getByRole('button', { name: 'Apply theme' }));
    await waitFor(() => {
      expect(appearancePort.saveCustomCss).toHaveBeenCalledOnce();
      expect(appearancePort.saveCustomCss).toHaveBeenCalledWith(
        expect.objectContaining({
          articleThemeName: 'Writer Article',
          codeThemeName: 'EasyMDE Blue Code'
        })
      );
      expect(appearancePort.applyState).toHaveBeenCalledOnce();
      expect(
        view.queryByRole('dialog', { name: 'Custom CSS theme' })
      ).toBeNull();
    });

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    const articleTheme = view.getByRole('combobox', {
      name: 'Article theme'
    });
    expect(articleTheme.textContent).toContain('Writer Article');
    fireEvent.click(articleTheme);
    expect(
      view
        .getByRole('option', { name: 'Writer Article' })
        .getAttribute('aria-selected')
    ).toBe('true');
  });

  it('carries an ordinary appearance choice into immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        false
      )
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));

    expect(
      view.getByRole('button', { name: 'Article theme' }).textContent
    ).toContain('Newsprint');
  });

  it('carries an ordinary font choice into immersive mode', async () => {
    const props = fixture();
    const fonts = {
      ...props.fonts,
      options: {
        ...props.fonts.options,
        customFonts: [
          ...props.fonts.options.customFonts,
          {
            fontFamily: 'Optima, sans-serif',
            id: 'optima',
            label: 'Optima'
          }
        ]
      }
    };
    const view = render(<EditorRoot {...props} fonts={fonts} />);

    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    const preparationCallsBeforeFontChange = preparation.mock.calls.length;
    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Custom font' }));
    fireEvent.click(view.getByRole('option', { name: 'Optima' }));
    await waitFor(() =>
      expect(
        preparation.mock.calls
          .slice(preparationCallsBeforeFontChange)
          .some(
            ([surface]) =>
              surface
              === view.container.querySelector(
                '[data-easymde-preview-html-sink="1"]'
              )
          )
      ).toBe(true)
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: 'Font' }));

    expect(
      view.getByRole('button', { name: 'Custom font' }).textContent
    ).toContain('Optima');
  });

  it('applies theme classes and theme font defaults to the single Preview sink', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) =>
        'newsprint' === theme.id
          ? {
              fontDefaults: {
                appleFont: 'new-york',
                customFont: 'inter',
                serifFont: 'on',
                windowsFont: 'segoe-ui'
              },
              defaultCodeTheme: theme.defaultCodeTheme,
              id: 'newsprint',
              label: 'Newsprint',
              markupProfile: theme.markupProfile
            }
          : theme
      )
    };
    const fonts = {
      ...props.fonts,
      options: {
        appleFonts: [
          ...props.fonts.options.appleFonts,
          {
            fontFamily: '"New York"',
            id: 'new-york',
            label: 'New York'
          }
        ],
        customFonts: [
          ...props.fonts.options.customFonts,
          {
            fontFamily: 'Inter, sans-serif',
            id: 'inter',
            label: 'Inter'
          }
        ],
        serifOptions: [
          ...props.fonts.options.serifOptions,
          {
            fontFamily: 'Georgia, serif',
            id: 'on',
            label: 'On'
          }
        ],
        windowsFonts: [
          ...props.fonts.options.windowsFonts,
          {
            fontFamily: '"Segoe UI"',
            id: 'segoe-ui',
            label: 'Segoe UI'
          }
        ]
      }
    };
    const view = render(
      <EditorRoot {...props} appearance={appearance} fonts={fonts} />
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() => {
      expect(props.fontControlsPort.applyState).toHaveBeenCalledWith(
        appearance.articleThemes[1]?.fontDefaults
      );
    });
    const sink = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    expect(sink?.classList.contains('easymde-markdown-theme-newsprint')).toBe(
      true
    );
    expect(sink?.classList.contains('easymde-code-theme-atom-one-dark')).toBe(
      true
    );
    expect(sink?.style.getPropertyValue('--easymde-content-font-family')).toBe(
      'Inter, sans-serif, "Segoe UI", "New York", Georgia, serif'
    );
  });

  it('routes Preview enhancement diagnostics through the Root failure owner', async () => {
    const props = fixture();
    vi.mocked(props.enhancementPort.enhance).mockRejectedValue(
      new Error('preview-enhancement-resource-load-failed')
    );

    render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      );
    });
  });
});
