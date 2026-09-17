import { fireEvent, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../immersive-editor', async () => {
  const actual = await vi.importActual<typeof import('../immersive-editor')>(
    '../immersive-editor'
  );
  return {
    ...actual,
    buildOutlineTree: vi.fn(actual.buildOutlineTree)
  };
});

import {
  buildOutlineTree,
  type ImmersiveOutlineItem
} from '../immersive-editor';
import { ImmersiveOutline } from './ImmersiveOutline';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

const strings = {
  hideOutline: 'Hide outline',
  noHeadings: 'No headings',
  outline: 'Outline',
  resizeOutline: 'Resize outline',
  showOutline: 'Show outline'
} as unknown as ImmersiveStrings;

const items: ReadonlyArray<ImmersiveOutlineItem> = [
  { index: 0, level: 1, line: 0, position: 0, text: 'First' },
  { index: 1, level: 2, line: 2, position: 8, text: 'Second' }
];

function OutlineHarness({ tick }: Readonly<{ tick: number }>) {
  return (
    <div data-tick={tick}>
      <ImmersiveOutline
        activeIndex={null}
        direction="ltr"
        items={items}
        onOpenChange={() => {}}
        onSelect={() => {}}
        open
        strings={strings}
      />
    </div>
  );
}

describe('ImmersiveOutline', () => {
  beforeEach(() => {
    vi.mocked(buildOutlineTree).mockClear();
  });

  it('does not build the outline tree while the outline is collapsed', () => {
    const props = {
      activeIndex: null,
      direction: 'ltr' as const,
      items,
      onOpenChange: () => {},
      onSelect: () => {},
      strings
    };
    const view = render(<ImmersiveOutline {...props} open={false} />);

    expect(vi.mocked(buildOutlineTree)).not.toHaveBeenCalled();
    view.rerender(<ImmersiveOutline {...props} open />);
    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledOnce();
    view.rerender(
      <ImmersiveOutline
        {...props}
        items={items.map((item) => ({ ...item, position: item.position + 4 }))}
        open={false}
      />
    );
    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledOnce();
  });

  it('does not rebuild the outline tree when the input items are unchanged', () => {
    const view = render(<OutlineHarness tick={0} />);

    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledTimes(1);

    view.rerender(<OutlineHarness tick={1} />);

    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledTimes(1);
  });

  it('preserves heading button identity when only source positions change', () => {
    const onSelect = vi.fn();
    const view = render(<ImmersiveOutline
      activeIndex={null}
      direction="ltr"
      items={items}
      onOpenChange={() => {}}
      onSelect={onSelect}
      open
      strings={strings}
    />);
    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledOnce();
    const buttonsBefore = Array.from(
      view.container.querySelectorAll('.easymde-immersive-outline-tree button')
    );
    const updatedItems = items.map((item) => ({
      ...item,
      position: item.position + 11
    }));

    view.rerender(<ImmersiveOutline
      activeIndex={null}
      direction="ltr"
      items={updatedItems}
      onOpenChange={() => {}}
      onSelect={onSelect}
      open
      strings={strings}
    />);
    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledOnce();

    const buttonsAfter = Array.from(
      view.container.querySelectorAll('.easymde-immersive-outline-tree button')
    );
    expect(buttonsAfter).toHaveLength(buttonsBefore.length);
    buttonsAfter.forEach((button, index) => {
      expect(button).toBe(buttonsBefore[index]);
    });
    const firstButton = buttonsAfter[0];
    if (!firstButton) throw new Error('immersive-outline-first-button-missing');
    fireEvent.click(firstButton);
    expect(onSelect).toHaveBeenCalledWith(updatedItems[0]);
  });

  it('keeps existing headings stable when a heading is prepended and selects current items', () => {
    const initialItems: ReadonlyArray<ImmersiveOutlineItem> = [
      { index: 0, level: 1, line: 0, position: 0, text: 'First' },
      { index: 1, level: 1, line: 2, position: 8, text: 'Repeated' },
      { index: 2, level: 1, line: 4, position: 20, text: 'Repeated' }
    ];
    const updatedItems: ReadonlyArray<ImmersiveOutlineItem> = [
      { index: 0, level: 1, line: 0, position: 0, text: 'Repeated' },
      { index: 1, level: 1, line: 2, position: 19, text: 'First' },
      { index: 2, level: 1, line: 4, position: 27, text: 'Repeated' },
      { index: 3, level: 1, line: 6, position: 39, text: 'Repeated' }
    ];
    const onSelect = vi.fn();
    const view = render(<ImmersiveOutline
      activeIndex={null}
      direction="ltr"
      items={initialItems}
      onOpenChange={() => {}}
      onSelect={onSelect}
      open
      strings={strings}
    />);
    const buttonsBefore = Array.from(
      view.container.querySelectorAll('.easymde-immersive-outline-tree button')
    );

    view.rerender(<ImmersiveOutline
      activeIndex={null}
      direction="ltr"
      items={updatedItems}
      onOpenChange={() => {}}
      onSelect={onSelect}
      open
      strings={strings}
    />);

    const buttonsAfter = Array.from(
      view.container.querySelectorAll('.easymde-immersive-outline-tree button')
    );
    expect(buttonsAfter).toHaveLength(updatedItems.length);
    expect(buttonsAfter[1]).toBe(buttonsBefore[0]);
    expect(buttonsAfter[2]).toBe(buttonsBefore[1]);
    expect(buttonsAfter[3]).toBe(buttonsBefore[2]);

    buttonsAfter.slice(2).forEach((button) => {
      fireEvent.click(button);
    });
    expect(onSelect.mock.calls).toEqual([
      [updatedItems[2]],
      [updatedItems[3]]
    ]);
  });
});
