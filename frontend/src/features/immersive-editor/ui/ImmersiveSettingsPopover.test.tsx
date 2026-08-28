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
  editorSettings: '编辑器设置',
  close: '关闭',
  outlineDescription: '左侧显示标题层级导航',
  settings: '设置',
  splitPreview: '分屏预览',
  splitPreviewDescription: '默认显示实时预览区域'
} as unknown as ImmersiveStrings;

const settings: ImmersiveSettings = {
  outline: true,
  splitPreview: true
} as ImmersiveSettings;

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

    expect(view.getAllByRole('checkbox')).toHaveLength(2);
    expect(
      view.queryByRole('checkbox', { name: '自动保存' })
    ).toBeNull();
    expect(
      view.queryByRole('checkbox', { name: '字数统计' })
    ).toBeNull();
    expect(
      view.queryByRole('checkbox', { name: '同步滚动' })
    ).toBeNull();

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
