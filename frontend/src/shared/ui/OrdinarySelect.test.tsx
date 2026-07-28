import { createElement } from '@wordpress/element';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrdinarySelect } from './OrdinarySelect';

const options = [
  { id: 'red', label: 'Red' },
  { id: 'blue', label: 'Blue' },
  { id: 'custom', label: 'Issue58 hidden relation fixture' }
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrdinarySelect', () => {
  it('always opens below the trigger and constrains the menu to the viewport', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains('easymde-ordinary-select-trigger')) {
          return DOMRect.fromRect({
            x: 1040,
            y: 610,
            width: 210,
            height: 36
          });
        }
        return DOMRect.fromRect();
      });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720
    });

    render(
      <OrdinarySelect
        label="Article theme"
        onChange={vi.fn()}
        options={options}
        value="red"
      />
    );

    await user.click(screen.getByRole('combobox', { name: 'Article theme' }));
    const listbox = screen.getByRole('listbox', { name: 'Article theme' });
    const top = Number.parseFloat(listbox.style.top);
    const maxHeight = Number.parseFloat(listbox.style.maxHeight);

    expect(listbox.style.position).toBe('fixed');
    expect(listbox.style.width).toBe('210px');
    expect(top).toBe(652);
    expect(maxHeight).toBe(56);
    expect(top + maxHeight).toBeLessThanOrEqual(708);
    expect(listbox.textContent).not.toContain('Named custom CSS');
  });

  it('does not reposition while navigating or scrolling inside an open menu', async () => {
    const user = userEvent.setup();
    const measureTrigger = vi.fn(() => DOMRect.fromRect({
      x: 120,
      y: 160,
      width: 210,
      height: 36
    }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        return this.classList.contains('easymde-ordinary-select-trigger')
          ? measureTrigger()
          : DOMRect.fromRect();
      });

    render(
      <OrdinarySelect
        label="Apple font"
        onChange={vi.fn()}
        options={options}
        value="red"
      />
    );

    const trigger = screen.getByRole('combobox', { name: 'Apple font' });
    await user.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Apple font' });
    await waitFor(() => expect(measureTrigger).toHaveBeenCalled());
    const measurementsAfterOpen = measureTrigger.mock.calls.length;
    const initialTop = listbox.style.top;

    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    listbox.dispatchEvent(new Event('scroll'));

    await waitFor(() => {
      expect(measureTrigger).toHaveBeenCalledTimes(measurementsAfterOpen);
    });
    expect(listbox.style.top).toBe(initialTop);
  });

  it('reveals the current named custom CSS option when a long list opens', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get')
      .mockImplementation(function offsetTop(this: HTMLElement) {
        return 'option' === this.getAttribute('role')
          && this.textContent?.includes('Issue58')
          ? 96
          : 0;
      });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function offsetHeight(this: HTMLElement) {
        return 'option' === this.getAttribute('role') ? 36 : 0;
      });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function clientHeight(this: HTMLElement) {
        return 'listbox' === this.getAttribute('role') ? 72 : 0;
      });

    render(
      <OrdinarySelect
        label="Article theme"
        onChange={vi.fn()}
        options={options}
        value="custom"
      />
    );

    await user.click(screen.getByRole('combobox', { name: 'Article theme' }));
    const listbox = screen.getByRole('listbox', { name: 'Article theme' });

    await waitFor(() => expect(listbox.scrollTop).toBe(60));
    expect(screen.getByRole('option', {
      name: 'Issue58 hidden relation fixture'
    }).getAttribute('aria-selected')).toBe('true');
  });

  it('supports roving keyboard selection without moving focus into the listbox', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OrdinarySelect
        label="Article theme"
        onChange={onChange}
        options={options}
        value="red"
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Article theme' });

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-activedescendant')).toContain('blue');

    await user.keyboard('{End}{Enter}');
    expect(onChange).toHaveBeenCalledWith('custom');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape or Tab while preserving the current value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <OrdinarySelect
          label="Article theme"
          onChange={onChange}
          options={options}
          value="red"
        />
        <button type="button">After</button>
      </div>
    );
    const trigger = screen.getByRole('combobox', { name: 'Article theme' });

    trigger.focus();
    await user.keyboard('{Enter}{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard('{Enter}{Tab}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects custom options by pointer and restores trigger focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OrdinarySelect
        label="Article theme"
        onChange={onChange}
        options={options}
        value="red"
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Article theme' });

    await user.click(trigger);
    await user.click(screen.getByRole('option', {
      name: 'Issue58 hidden relation fixture'
    }));

    expect(onChange).toHaveBeenCalledWith('custom');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders optional single and split palette swatches without changing option names', async () => {
    const user = userEvent.setup();
    render(
      <OrdinarySelect
        label="Code theme"
        onChange={vi.fn()}
        options={[
          { id: 'accent', label: 'Accent', swatch: '#E74C3C' },
          {
            id: 'split',
            label: 'Split',
            swatch: ['#282C34', '#ABB2BF']
          },
          { id: 'plain', label: 'Plain' }
        ]}
        value="split"
      />
    );

    const trigger = screen.getByRole('combobox', { name: 'Code theme' });
    const triggerColors = Array.from(
      trigger.querySelectorAll<HTMLElement>(
        '.easymde-ordinary-select-swatch > span'
      )
    ).map((element) => element.style.background);
    expect(triggerColors).toEqual(['rgb(40, 44, 52)', 'rgb(171, 178, 191)']);

    await user.click(trigger);
    const accent = screen.getByRole('option', { name: 'Accent' });
    const split = screen.getByRole('option', { name: 'Split' });
    const plain = screen.getByRole('option', { name: 'Plain' });

    expect(
      accent.querySelector<HTMLElement>('.easymde-ordinary-select-swatch')
        ?.style.background
    ).toBe('rgb(231, 76, 60)');
    expect(
      Array.from(split.querySelectorAll<HTMLElement>(
        '.easymde-ordinary-select-swatch > span'
      )).map((element) => element.style.background)
    ).toEqual(['rgb(40, 44, 52)', 'rgb(171, 178, 191)']);
    expect(
      plain.querySelector('.easymde-ordinary-select-swatch')
    ).toBeNull();
  });
});
