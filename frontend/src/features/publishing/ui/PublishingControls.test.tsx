import { createElement } from '@wordpress/element';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PublishingPort, PublishingSnapshot } from '../../../contracts/ports/publishing-port';
import { publishingBootstrapFixture } from '../../../test/publishing-bootstrap-fixture';
import { PublishingControls } from './PublishingControls';

function snapshot(): PublishingSnapshot {
  return {
    draft: {
      capabilities: {
        categories: true,
        excerpt: true,
        featuredImage: true,
        schedule: true,
        sticky: true,
        tags: true,
        visibility: true
      },
      categories: ['7'],
      excerpt: 'Summary',
      featuredImage: null,
      password: '',
      schedule: { day: 31, hour: 9, minute: 30, month: 12, year: 2027 },
      status: 'future',
      sticky: false,
      tags: ['Alpha'],
      visibility: 'public'
    },
    primaryActionLabel: 'Schedule',
    saveDraftActionLabel: 'Save Draft',
    statusOptions: [
      { disabled: false, id: 'draft', label: 'Draft' },
      { disabled: false, id: 'future', label: 'Scheduled' }
    ]
  };
}

function fixture(overrides: Partial<PublishingPort> = {}) {
  const currentSnapshot = snapshot();
  const port: PublishingPort = {
    read: vi.fn(() => currentSnapshot),
    requestSubmit: vi.fn(() => ({ status: 'requested' as const })),
    selectFeaturedImage: vi.fn().mockResolvedValue(null),
    ...overrides
  };
  return {
    onDiagnostic: vi.fn(),
    onOpen: vi.fn(),
    port
  };
}

describe('PublishingControls', () => {
  it('opens from a read-only snapshot and closes without a native write', () => {
    const current = fixture();
    const view = render(
      <PublishingControls
        bootstrap={publishingBootstrapFixture}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    const opener = view.getByRole('button', { name: 'Publish' });
    fireEvent.click(opener);

    expect(current.port.read).toHaveBeenCalledTimes(1);
    expect(current.onOpen).toHaveBeenCalledTimes(1);
    expect(view.getByRole('dialog', { name: 'Publishing' })).not.toBeNull();
    const close = view.getByRole('button', { name: 'Close publishing controls' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(view.queryByRole('dialog', { name: 'Publishing' })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(current.port.requestSubmit).not.toHaveBeenCalled();
  });

  it('keeps edits local until one complete primary submission request', () => {
    const current = fixture();
    const view = render(
      <PublishingControls
        bootstrap={publishingBootstrapFixture}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Publish' }));
    fireEvent.click(view.getByRole('radio', { name: 'Private' }));
    fireEvent.click(view.getByRole('checkbox', { name: 'Advanced' }));
    fireEvent.change(view.getByRole('textbox', { name: 'Tags' }), { target: { value: 'Gamma, Delta' } });
    fireEvent.change(view.getByRole('textbox', { name: 'Excerpt' }), { target: { value: 'Changed summary' } });
    expect(current.port.requestSubmit).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'Schedule' }));
    expect(current.port.requestSubmit).toHaveBeenCalledWith(expect.objectContaining({
      categories: ['7', '12'],
      excerpt: 'Changed summary',
      sticky: false,
      tags: ['Gamma', 'Delta'],
      visibility: 'private'
    }), 'primary');
    expect(view.getByRole('button', { name: 'Submitting...' }).hasAttribute('disabled')).toBe(true);
    expect(view.getByRole('dialog', { name: 'Publishing' }).getAttribute('aria-busy')).toBe('true');
  });

  it('renders child categories after their parent even when bootstrap order is reversed', () => {
    const current = fixture();
    const view = render(
      <PublishingControls
        bootstrap={{
          ...publishingBootstrapFixture,
          categoryOptions: [
            { id: '12', label: 'Advanced', parentId: '7' },
            { id: '7', label: 'Guides', parentId: '' }
          ]
        }}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Publish' }));

    const labels = Array.from(
      view.container.querySelectorAll<HTMLLabelElement>('.easymde-publishing-categories label')
    );
    expect(labels.map((label) => label.textContent?.trim())).toEqual(['Guides', 'Advanced']);
    expect(labels[0]?.style.getPropertyValue('--easymde-category-depth')).toBe('0');
    expect(labels[1]?.style.getPropertyValue('--easymde-category-depth')).toBe('1');
  });

  it('announces a PHP-owned category load failure instead of presenting an empty category state', () => {
    const current = fixture();
    const view = render(
      <PublishingControls
        bootstrap={{
          ...publishingBootstrapFixture,
          categoryLoadError: 'EasyMDE could not load WordPress categories.',
          categoryOptions: []
        }}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Publish' }));

    expect(view.getByRole('alert').textContent).toBe(
      'EasyMDE could not load WordPress categories.'
    );
    expect(view.queryByRole('group', { name: 'Categories' })).toBeNull();
  });

  it('blocks an empty password before the native adapter is called', () => {
    const current = fixture();
    const view = render(
      <PublishingControls
        bootstrap={publishingBootstrapFixture}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Publish' }));
    fireEvent.click(view.getByRole('radio', { name: 'Password protected' }));
    fireEvent.click(view.getByRole('button', { name: 'Schedule' }));

    expect(current.port.requestSubmit).not.toHaveBeenCalled();
    expect(view.getByRole('alert').textContent).toBe('Enter a password before submitting.');
    expect(current.onDiagnostic).toHaveBeenCalledWith('publishing-password-required');
  });

  it('reports a native read failure without opening an empty dialog', () => {
    const current = fixture({ read: vi.fn(() => { throw new Error('publishing-native-core-unavailable'); }) });
    const view = render(
      <PublishingControls
        bootstrap={publishingBootstrapFixture}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );

    fireEvent.click(view.getByRole('button', { name: 'Publish' }));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(view.getByRole('alert').textContent).toBe('WordPress could not start the requested action.');
    expect(current.onDiagnostic).toHaveBeenCalledWith('publishing-native-core-unavailable');
  });

  it('keeps the dialog open and editable when the native submission request fails', () => {
    const current = fixture({
      requestSubmit: vi.fn(() => { throw new Error('publishing-native-action-unavailable'); })
    });
    const view = render(
      <PublishingControls
        bootstrap={publishingBootstrapFixture}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Publish' }));
    fireEvent.click(view.getByRole('button', { name: 'Schedule' }));

    expect(view.getByRole('dialog', { name: 'Publishing' })).not.toBeNull();
    expect(view.getByRole('alert').textContent).toBe('WordPress could not start the requested action.');
    expect(view.getByRole('button', { name: 'Schedule' }).hasAttribute('disabled')).toBe(false);
    expect(current.onDiagnostic).toHaveBeenCalledWith('publishing-native-action-unavailable');
  });

  it('ignores a featured-image result after the dialog closes', async () => {
    let resolveImage: ((value: { alt: string; id: number; url: string }) => void) | undefined;
    const current = fixture({
      selectFeaturedImage: vi.fn(() => new Promise<Readonly<{ alt: string; id: number; url: string }>>((resolve) => {
        resolveImage = resolve;
      }))
    });
    const view = render(
      <PublishingControls
        bootstrap={publishingBootstrapFixture}
        onDiagnostic={current.onDiagnostic}
        onOpen={current.onOpen}
        port={current.port}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Publish' }));
    fireEvent.click(view.getByRole('button', { name: 'Select featured image' }));
    fireEvent.click(view.getByRole('button', { name: 'Close publishing controls' }));
    resolveImage?.({ alt: 'Late', id: 44, url: 'https://example.test/late.jpg' });
    await waitFor(() => expect(view.queryByAltText('Late')).toBeNull());
  });
});
