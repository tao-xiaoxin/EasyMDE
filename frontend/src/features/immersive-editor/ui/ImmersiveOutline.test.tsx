import { render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

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
  it('does not rebuild the outline tree when the input items are unchanged', () => {
    const view = render(<OutlineHarness tick={0} />);

    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledTimes(1);

    view.rerender(<OutlineHarness tick={1} />);

    expect(vi.mocked(buildOutlineTree)).toHaveBeenCalledTimes(1);
  });
});
