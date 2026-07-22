import { createElement } from '@wordpress/element';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EditorWorkspace } from './EditorWorkspace';

describe('EditorWorkspace', () => {
  it('renders the ordinary editor as a fixed source and Preview pair', () => {
    const view = render(
      <EditorWorkspace
        direction="ltr"
        source={<section>Source surface</section>}
        preview={<section>Preview surface</section>}
      />
    );

    const workspace = view.container.querySelector('.easymde-workspace');
    expect(workspace).not.toBeNull();
    expect(workspace?.children).toHaveLength(2);
    expect(workspace?.children[0]?.textContent).toBe('Source surface');
    expect(workspace?.children[1]?.textContent).toBe('Preview surface');
    expect(view.container.querySelector('.easymde-editor-context-bar')).toBeNull();
    expect(view.container.querySelector('.easymde-react-workspace')).toBeNull();
    expect(view.container.querySelector('.easymde-pane-divider')).toBeNull();
    expect(view.container.querySelector('.easymde-editor-status-bar')).toBeNull();
    expect(view.queryByRole('navigation', { name: 'Outline' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Writing statistics' })).toBeNull();
  });

  it('keeps WordPress direction on the single React layout owner', () => {
    const view = render(
      <EditorWorkspace
        direction="rtl"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
      />
    );

    expect(
      view.container.querySelector('[data-easymde-layout-owner="react"]')?.getAttribute('dir')
    ).toBe('rtl');
  });
});
