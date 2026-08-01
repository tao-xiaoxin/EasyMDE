import { createElement } from '@wordpress/element';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditorMessageAlert } from './EditorMessageAlert';

describe('EditorMessageAlert', () => {
  it('uses standard density by default and exposes compact density explicitly', () => {
    const { rerender } = render(
      <EditorMessageAlert
        closeLabel="Close"
        message="Saved"
        onDismiss={vi.fn()}
        type="success"
      />
    );

    expect(screen.getByRole('status').classList.contains('is-standard')).toBe(
      true
    );

    rerender(
      <EditorMessageAlert
        closeLabel="Close"
        density="compact"
        message="Theme name already exists."
        onDismiss={vi.fn()}
        type="error"
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert.classList.contains('is-compact')).toBe(true);
    expect(alert.classList.contains('is-standard')).toBe(false);
  });

  it.each([
    ['success', 'status', 'Saved'],
    ['info', 'status', 'Autosave enabled'],
    ['warning', 'alert', 'Maintenance soon'],
    ['error', 'alert', 'Save failed']
  ] as const)(
    'renders a dismissible %s notification with the correct live semantics',
    async (type, role, message) => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <EditorMessageAlert
          closeLabel="Close"
          message={message}
          onDismiss={onDismiss}
          type={type}
        />
      );

      const alert = screen.getByRole(role);
      expect(alert.textContent).toContain(message);
      expect(alert.classList.contains(`is-${type}`)).toBe(true);
      expect(alert.getAttribute('aria-atomic')).toBe('true');
      expect(
        container.querySelector('.easymde-editor-message-alert__icon')
          ?.getAttribute('aria-hidden')
      ).toBe('true');

      const returnTarget = document.createElement('button');
      document.body.append(returnTarget);
      returnTarget.focus();
      const close = screen.getByRole('button', { name: 'Close' });
      close.focus();
      await user.keyboard('{Enter}');

      expect(onDismiss).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(returnTarget);
      returnTarget.remove();
    }
  );

  it('keeps notification text on one accessible live-region owner', () => {
    render(
      <EditorMessageAlert
        closeLabel="Close"
        message="CSS theme name already exists."
        onDismiss={vi.fn()}
        type="error"
      />
    );

    expect(screen.getAllByText('CSS theme name already exists.')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('reports close-button focus so an auto-dismiss owner can pause its timer', () => {
    const onFocusChange = vi.fn();
    render(
      <EditorMessageAlert
        closeLabel="Close"
        message="Saved"
        onDismiss={vi.fn()}
        onFocusChange={onFocusChange}
        type="success"
      />
    );

    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    close.blur();

    expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
  });

  it('restores focus to the control used for the latest close-button entry', async () => {
    const user = userEvent.setup();
    render(
      <EditorMessageAlert
        closeLabel="Close"
        message="Saved"
        onDismiss={vi.fn()}
        type="success"
      />
    );
    const firstTarget = document.createElement('button');
    const latestTarget = document.createElement('button');
    document.body.append(firstTarget, latestTarget);
    const close = screen.getByRole('button', { name: 'Close' });

    firstTarget.focus();
    close.focus();
    latestTarget.focus();
    close.focus();
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(latestTarget);
    firstTarget.remove();
    latestTarget.remove();
  });

  it('keeps Escape non-destructive and dismisses with Space while restoring focus', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <EditorMessageAlert
        closeLabel="Close"
        message="Uploading"
        onDismiss={onDismiss}
        type="info"
      />
    );
    const returnTarget = document.createElement('button');
    document.body.append(returnTarget);
    returnTarget.focus();
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();

    await user.keyboard('{Escape}');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).not.toBeNull();

    await user.keyboard(' ');
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(returnTarget);
    returnTarget.remove();
  });
});
