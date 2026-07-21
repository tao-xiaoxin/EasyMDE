import { describe, expect, it } from 'vitest';

import type { PublishingSnapshot } from '../../contracts/ports/publishing-port';
import {
  createPublishingDraft,
  orderPublishingCategories,
  updatePublishingVisibility,
  validatePublishingDraft
} from './publish-draft';

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
      categories: ['7', '7', '12'],
      excerpt: 'Summary',
      featuredImage: { alt: 'Cover', id: 31, url: 'https://example.test/cover.jpg' },
      password: 'secret phrase',
      schedule: { day: 31, hour: 9, minute: 30, month: 12, year: 2027 },
      status: 'future',
      sticky: true,
      tags: ['Alpha', 'beta', 'alpha'],
      visibility: 'password'
    },
    primaryActionLabel: 'Schedule',
    saveDraftActionLabel: 'Save Draft',
    statusOptions: [
      { disabled: false, id: 'draft', label: 'Draft' },
      { disabled: false, id: 'future', label: 'Scheduled' }
    ]
  };
}

describe('publishing draft', () => {
  it('copies and normalizes a native snapshot without mutating it', () => {
    const source = snapshot();
    const draft = createPublishingDraft(source);

    expect(draft.categories).toEqual(['7', '12']);
    expect(draft.tags).toEqual(['Alpha', 'beta']);
    expect(draft.sticky).toBe(false);
    expect(source.draft.categories).toEqual(['7', '7', '12']);
  });

  it('keeps visibility, password and sticky state internally consistent', () => {
    const source = createPublishingDraft(snapshot());
    const publicDraft = updatePublishingVisibility(source, 'public');
    const privateDraft = updatePublishingVisibility({ ...publicDraft, sticky: true }, 'private');

    expect(publicDraft.password).toBe('');
    expect(privateDraft.sticky).toBe(false);
    expect(privateDraft.password).toBe('');
  });

  it('orders a maximum-sized category hierarchy without recursive stack growth', () => {
    const categories = Array.from({ length: 10000 }, (_, index) => ({
      id: String(index + 1),
      label: `Category ${index + 1}`,
      parentId: 0 === index ? '' : String(index)
    })).reverse();

    const ordered = orderPublishingCategories(categories);

    expect(ordered).toHaveLength(10000);
    expect(ordered[0]).toEqual(expect.objectContaining({ depth: 0, option: categories[9999] }));
    expect(ordered[9999]).toEqual(expect.objectContaining({ depth: 9999, option: categories[0] }));
  });

  it('keeps cyclic and orphaned category records visible exactly once', () => {
    const ordered = orderPublishingCategories([
      { id: '1', label: 'Cycle A', parentId: '2' },
      { id: '2', label: 'Cycle B', parentId: '1' },
      { id: '3', label: 'Orphan', parentId: '999' }
    ]);

    expect(ordered.map(({ option }) => option.id)).toEqual(['3', '1', '2']);
    expect(new Set(ordered.map(({ option }) => option.id)).size).toBe(3);
  });

  it('validates status identity, password and real calendar dates', () => {
    const source = snapshot();
    const draft = createPublishingDraft(source);

    expect(validatePublishingDraft(draft, source.statusOptions)).toBeNull();
    expect(validatePublishingDraft({ ...draft, status: 'deleted-status' }, source.statusOptions))
      .toBe('publishing-status-invalid');
    expect(validatePublishingDraft(draft, source.statusOptions.map((option) => ({
      ...option,
      disabled: option.id === draft.status
    })))).toBe('publishing-status-invalid');
    expect(validatePublishingDraft({ ...draft, password: '  ' }, source.statusOptions))
      .toBe('publishing-password-required');
    expect(validatePublishingDraft({
      ...draft,
      schedule: { day: 30, hour: 9, minute: 30, month: 2, year: 2027 }
    }, source.statusOptions)).toBe('publishing-schedule-invalid');
  });
});
