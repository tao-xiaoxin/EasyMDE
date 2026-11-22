import { fireEvent, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { ImmersiveI18nPort } from '../../../contracts/ports/immersive-i18n-port';
import type { DocumentStats } from '../immersive-editor';
import { ImmersiveHeader } from './ImmersiveHeader';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

const strings = {
  edit: 'Edit',
  preview: 'Preview',
  saved: 'Saved',
  split: 'Split',
  title: 'Title',
  unsaved: 'Unsaved',
  viewModes: 'View modes'
} as unknown as ImmersiveStrings;

const i18n: ImmersiveI18nPort = {
  characters: (count: number) => `${count} chars`,
  readingTime: (minutes: number) => `${minutes} min`,
  revisions: (count: number) => `${count} revisions`,
  words: (count: number) => `${count} words`
};

const stats: DocumentStats = {
  characters: 42,
  minutes: 1,
  words: 10
};

describe('ImmersiveHeader', () => {
  it('preserves accessible names on all view-switch buttons when label spans are hidden', () => {
    const onModeChange = vi.fn();
    const view = render(
      <ImmersiveHeader
        dirty={false}
        i18n={i18n}
        mode="split"
        publishLabel="Publish"
        statusBarMode="detailed"
        stats={stats}
        strings={strings}
        title="Sample Post"
        onModeChange={onModeChange}
        onPublish={vi.fn()}
        onTitleChange={vi.fn()}
      />
    );

    // Simulate `@media (max-width: 640px)` hiding `.easymde-immersive-view-switch button span`.
    const labelSpans = view.container.querySelectorAll<HTMLSpanElement>(
      '.easymde-immersive-view-switch button span'
    );
    expect(labelSpans).toHaveLength(3);
    labelSpans.forEach((span) => {
      span.style.display = 'none';
      span.hidden = true;
    });

    const editButton = view.getByRole('button', { name: strings.edit });
    const splitButton = view.getByRole('button', { name: strings.split });
    const previewButton = view.getByRole('button', { name: strings.preview });

    expect(editButton.getAttribute('aria-label')).toBe(strings.edit);
    expect(editButton.getAttribute('title')).toBe(strings.edit);
    expect(editButton.getAttribute('aria-pressed')).toBe('false');

    expect(splitButton.getAttribute('aria-label')).toBe(strings.split);
    expect(splitButton.getAttribute('title')).toBe(strings.split);
    expect(splitButton.getAttribute('aria-pressed')).toBe('true');

    expect(previewButton.getAttribute('aria-label')).toBe(strings.preview);
    expect(previewButton.getAttribute('title')).toBe(strings.preview);
    expect(previewButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(editButton);
    fireEvent.click(previewButton);

    expect(onModeChange).toHaveBeenNthCalledWith(1, 'source');
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'preview');
  });
});
