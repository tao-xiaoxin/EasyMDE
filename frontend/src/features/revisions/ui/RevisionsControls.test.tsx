import { createElement } from '@wordpress/element';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import type { RevisionsPort } from '../../../contracts/ports/revisions-port';
import { revisionsBootstrapFixture } from '../../../test/revisions-bootstrap-fixture';
import { RevisionsControls } from './RevisionsControls';

const entries = [
  { date: '2026-07-21T12:34:56+08:00', dateLabel: '2026年7月21日 12:34', id: 11, title: 'Manual version', type: 'manual' as const },
  { date: '2026-07-21T12:30:00+08:00', dateLabel: '2026年7月21日 12:30', id: 10, title: 'Autosave version', type: 'auto' as const }
];

function fixture(overrides: Partial<RevisionsPort> = {}) {
  const port: RevisionsPort = {
    confirmNavigation: vi.fn(() => true),
    getRevision: vi.fn(async (id) => ({
      features: { highlight: true },
      html: `<p>Revision ${id}</p>` as SafePreviewHtml,
      id
    })),
    listRevisions: vi.fn().mockResolvedValue(entries),
    openRevision: vi.fn(),
    ...overrides
  };
  const props = {
    bootstrap: revisionsBootstrapFixture,
    codeTheme: 'atom-one-dark',
    enhancementPort: { enhance: vi.fn().mockResolvedValue(undefined) },
    isDirty: vi.fn(() => false),
    onDiagnostic: vi.fn(),
    onOpen: vi.fn(),
    onReady: vi.fn(),
    port
  };
  return { port, props };
}

afterEach(() => vi.restoreAllMocks());

describe('RevisionsControls', () => {
  it('loads the latest revision, enhances server HTML, filters, and navigates through WordPress', async () => {
    const { port, props } = fixture();
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));

    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(view.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(view.getAllByText('Manual version')).toHaveLength(2));
    await waitFor(() => expect(props.enhancementPort.enhance).toHaveBeenCalledWith(
      expect.any(HTMLElement), { highlight: true }, expect.any(Function),
      expect.objectContaining({ codeTheme: 'atom-one-dark', signal: expect.any(AbortSignal) })
    ));
    await waitFor(() => expect((view.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(false));
    expect(view.container.querySelectorAll('[data-easymde-preview-html-sink="1"]')).toHaveLength(1);

    fireEvent.keyDown(view.getByRole('option', { name: /Manual version/ }), { key: 'ArrowDown' });
    await waitFor(() => expect(port.getRevision).toHaveBeenLastCalledWith(10, expect.any(AbortSignal)));
    expect(document.activeElement).toBe(view.getByRole('option', { name: /Autosave version/ }));

    fireEvent.change(view.getByRole('combobox', { name: 'All' }), { target: { value: 'auto' } });
    await waitFor(() => expect(port.getRevision).toHaveBeenLastCalledWith(10, expect.any(AbortSignal)));
    expect(view.queryByText('Manual version')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Restore this version' }));
    expect(port.openRevision).toHaveBeenCalledWith(10);
  });

  it('asks before abandoning dirty state and keeps the dialog when navigation is cancelled', async () => {
    const { port, props } = fixture({ confirmNavigation: vi.fn(() => false) });
    props.isDirty.mockReturnValue(true);
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await waitFor(() => expect((view.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(view.getByRole('button', { name: 'Restore this version' }));
    expect(port.confirmNavigation).toHaveBeenCalledTimes(1);
    expect(port.openRevision).not.toHaveBeenCalled();
    expect(view.getByRole('dialog')).toBeTruthy();
  });

  it('aborts list and detail requests on close and ignores late completions', async () => {
    let resolveList!: (value: typeof entries) => void;
    let resolveDetail!: (value: { features: Record<string, boolean>; html: SafePreviewHtml; id: number }) => void;
    const list = new Promise<typeof entries>((resolve) => { resolveList = resolve; });
    const detail = new Promise<{ features: Record<string, boolean>; html: SafePreviewHtml; id: number }>((resolve) => { resolveDetail = resolve; });
    const { props } = fixture({
      getRevision: vi.fn(() => detail),
      listRevisions: vi.fn(() => list)
    });
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    const listSignal = vi.mocked(props.port.listRevisions).mock.calls[0]?.[0];
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(listSignal?.aborted).toBe(true);
    await act(async () => resolveList(entries));
    expect(props.port.getRevision).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await act(async () => resolveList(entries));
    const detailSignal = vi.mocked(props.port.getRevision).mock.calls.at(-1)?.[1];
    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });
    expect(detailSignal?.aborted).toBe(true);
    await act(async () => resolveDetail({ features: {}, html: '<p>Late</p>' as SafePreviewHtml, id: 11 }));
    expect(view.queryByText('Late')).toBeNull();
  });

  it('reports list, detail, and enhancement failures without enabling restore', async () => {
    const { props } = fixture({ listRevisions: vi.fn().mockRejectedValue(new Error('revisions-network-failed')) });
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(view.getByText(revisionsBootstrapFixture.strings.failed).getAttribute('role')).toBe('alert'));
    expect(props.onDiagnostic).toHaveBeenCalledWith('revisions-network-failed');
    expect((view.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the list usable when detail loading fails', async () => {
    const { props } = fixture({ getRevision: vi.fn().mockRejectedValue(new Error('revisions-detail-invalid')) });
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(view.getByText(revisionsBootstrapFixture.strings.previewFailed).getAttribute('role')).toBe('alert'));
    expect(view.getByRole('listbox').querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(props.onDiagnostic).toHaveBeenCalledWith('revisions-detail-invalid');
  });

  it('preserves sanitized HTML but blocks navigation when preview enhancement fails', async () => {
    const { props } = fixture();
    props.enhancementPort.enhance.mockRejectedValue(new Error('preview-enhancement-runtime-unavailable'));
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(view.container.querySelector('[data-easymde-preview-error="1"]')).not.toBeNull());
    expect(view.getByText('Revision 11')).toBeTruthy();
    expect((view.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onDiagnostic).toHaveBeenCalledWith('preview-enhancement-runtime-unavailable');
  });

  it('reports native revision navigation failure without claiming restore', async () => {
    const { props } = fixture({ openRevision: vi.fn(() => { throw new Error('native-navigation-failed'); }) });
    const view = render(<RevisionsControls {...props} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await waitFor(() => expect((view.getByRole('button', { name: 'Restore this version' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(view.getByRole('button', { name: 'Restore this version' }));
    expect(props.onDiagnostic).toHaveBeenCalledWith('revisions-navigation-failed');
    expect(view.getByRole('dialog')).toBeTruthy();
  });
});
