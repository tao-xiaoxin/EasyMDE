import { createElement } from '@wordpress/element';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { FontControlsBootstrap } from '../../../contracts/bootstrap/font-controls-bootstrap';
import type { FontControlsPort } from '../../../contracts/ports/font-controls-port';
import { FontControls } from './FontControls';

const bootstrap: FontControlsBootstrap = {
  options: {
    customFonts: [
      { id: 'none', label: 'No custom font', fontFamily: '' },
      { id: 'optima', label: 'Optima', fontFamily: '"Optima"' }
    ],
    windowsFonts: [
      { id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: '"Microsoft YaHei"' }
    ],
    appleFonts: [
      { id: 'pingfang-sc-light', label: 'PingFang SC Light', fontFamily: '"PingFang SC"' }
    ],
    serifOptions: [
      { id: 'yes', label: 'Yes', fontFamily: 'serif' }
    ]
  },
  state: {
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  },
  strings: {
    font: 'Font',
    customFont: 'Custom font',
    windowsFont: 'Windows font',
    appleFont: 'Apple font',
    serifFont: 'Serif font',
    fontStackHelp: 'Fonts are applied in fallback order.'
  }
};

function createPort(applyState = vi.fn()): FontControlsPort {
  return { applyState, closeOtherPopovers: vi.fn() };
}

describe('FontControls', () => {
  it('anchors the panel to the font trigger instead of the page', async () => {
    const user = userEvent.setup();
    render(
      <FontControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Font' });

    await user.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Font' });
    const anchor = trigger.closest(
      '.easymde-toolbar-popover-anchor.easymde-toolbar-popover-font'
    );

    expect(anchor).not.toBeNull();
    expect(anchor?.contains(panel)).toBe(true);
  });

  it('opens an accessible popover without moving focus, closes on Escape, and returns focus', async () => {
    const user = userEvent.setup();
    render(
      <FontControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Font' });

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Font' }).hidden).toBe(false);
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the trigger when a pointer activation closes the popover', async () => {
    const user = userEvent.setup();
    render(
      <FontControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Font' });

    await user.click(trigger);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('applies one complete next state and preserves the last valid selection when the Port fails', async () => {
    const applyState = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('Synthetic private detail');
      });
    const onFailure = vi.fn();
    const user = userEvent.setup();
    render(
      <FontControls
        bootstrap={bootstrap}
        port={createPort(applyState)}
        onFailure={onFailure}
        onReady={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Font' }));
    const custom = screen.getByRole('combobox', { name: 'Custom font' });
    await user.selectOptions(custom, 'none');
    expect(applyState).toHaveBeenLastCalledWith({
      ...bootstrap.state,
      customFont: 'none'
    });
    expect((custom as HTMLSelectElement).value).toBe('none');

    await user.selectOptions(custom, 'optima');
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect((custom as HTMLSelectElement).value).toBe('none');
  });
});
