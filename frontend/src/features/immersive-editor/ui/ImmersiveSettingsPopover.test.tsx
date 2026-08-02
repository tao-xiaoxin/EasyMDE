import { fireEvent, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type {
  ImmersiveSettings,
  ImmersiveStrings
} from './immersive-editor-ui-types';
import { ImmersiveSettingsPopover } from './ImmersiveSettingsPopover';

const strings = {
  articleOutline: '文章大纲',
  autoSave: '自动保存',
  autoSaveDescription: '自动保存本地草稿',
  editorSettings: '编辑器设置',
  close: '关闭',
  outlineDescription: '左侧显示标题层级导航',
  settings: '设置',
  splitPreview: '分屏预览',
  splitPreviewDescription: '默认显示实时预览区域',
  syncScroll: '同步滚动',
  syncScrollDescription: '编辑区和预览区联动',
  wordCount: '字数统计',
  wordCountDescription: '在文章标题旁显示词数、字符数与阅读时长'
} as ImmersiveStrings;

const settings: ImmersiveSettings = {
  autoSave: true,
  outline: true,
  splitPreview: true,
  syncScroll: true,
  wordCount: true
};

describe('ImmersiveSettingsPopover', () => {
  it('exposes reference-style checkbox buttons and toggles the complete row', () => {
    const onChange = vi.fn();
    const view = render(
      <div data-easymde-editor-owner="react">
        <ImmersiveSettingsPopover
          settings={settings}
          strings={strings}
          onChange={onChange}
        />
      </div>
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    const outline = view.getByRole('checkbox', { name: '文章大纲' });
    expect(outline.getAttribute('aria-checked')).toBe('true');
    expect(outline.getAttribute('aria-describedby')).toBe(
      'immersive-setting-outline-description'
    );
    expect(
      document.getElementById('immersive-setting-outline-description')
        ?.textContent
    ).toBe(strings.outlineDescription);
    expect(document.activeElement).toBe(outline);

    fireEvent.click(outline);

    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      outline: false
    });
  });
});
