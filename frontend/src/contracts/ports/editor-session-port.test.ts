import { describe, expect, it } from 'vitest';

import { protectedEditorOperationError } from './editor-session-port';

describe('protectedEditorOperationError', () => {
  it('limits a post lock to post writes while preserving authenticated reads', () => {
    expect(protectedEditorOperationError({ status: 'locked' }, 'post-write')?.message)
      .toBe('editor-session-locked');
    expect(protectedEditorOperationError({ status: 'locked' }, 'post-read')).toBeNull();
    expect(protectedEditorOperationError({ status: 'locked' }, 'authenticated')).toBeNull();
  });

  it('limits edit-post capability loss without inventing unrelated capability state', () => {
    expect(protectedEditorOperationError({ status: 'capability-lost' }, 'post-read')?.message)
      .toBe('editor-session-capability-lost');
    expect(protectedEditorOperationError({ status: 'capability-lost' }, 'post-write')?.message)
      .toBe('editor-session-capability-lost');
    expect(protectedEditorOperationError({ status: 'capability-lost' }, 'authenticated')).toBeNull();
  });

  it.each(['authentication-required', 'connection-lost', 'nonce-expired'] as const)(
    'blocks every protected operation when the session is %s',
    (status) => {
      expect(protectedEditorOperationError({ status }, 'authenticated')?.message)
        .toBe(`editor-session-${status}`);
      expect(protectedEditorOperationError({ status }, 'post-read')?.message)
        .toBe(`editor-session-${status}`);
      expect(protectedEditorOperationError({ status }, 'post-write')?.message)
        .toBe(`editor-session-${status}`);
    }
  );
});
