import { createElement } from '@wordpress/element';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorDocumentSourceBridge } from './admin-editor-document-source';

const bootstrap = {
  strings: { editorLabel: 'Markdown source' }
};

function createFixture() {
  const container = document.createElement('div');
  const submissionField = document.createElement('textarea');
  const titleField = document.createElement('input');
  submissionField.value = '# Initial';
  submissionField.defaultValue = '# Initial';
  titleField.defaultValue = 'Saved title';
  titleField.value = 'Current title';
  document.body.append(container, submissionField, titleField);

  return { container, submissionField, titleField };
}

describe('createAdminEditorDocumentSourceBridge', () => {
  it('rejects invalid bootstrap before creating a mountable bridge', () => {
    expect(() => createAdminEditorDocumentSourceBridge(null)).toThrowError(
      expect.objectContaining({ code: 'invalid-bootstrap' })
    );
  });

  it('signals readiness after both document and title sessions exist', async () => {
    const bridge = createAdminEditorDocumentSourceBridge(bootstrap);
    const { container, submissionField, titleField } = createFixture();
    const onReady = vi.fn();

    let teardown: () => void = () => {};
    await act(async () => {
      teardown = bridge.mount({
        container,
        onFailure: vi.fn(),
        onReady,
        submissionField,
        titleField
      });
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    const session = onReady.mock.calls[0]?.[0];
    expect(session.document.getValue()).toBe('# Initial');
    expect(session.title.getSnapshot()).toEqual({
      savedValue: 'Saved title',
      value: 'Current title'
    });
    expect(session.getSnapshot()).toEqual({ dirty: true });
    titleField.value = 'Saved title';
    titleField.dispatchEvent(new InputEvent('input', { bubbles: true }));
    submissionField.value = '# Initial';
    submissionField.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(session.getSnapshot()).toEqual({ dirty: false });
    expect(container.querySelector('[data-easymde-react-document-source]')).not.toBeNull();

    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
    expect(container.childElementCount).toBe(0);
  });

  it('rejects a mount before creating a React root when required native fields are missing', () => {
    const bridge = createAdminEditorDocumentSourceBridge(bootstrap);
    const { container, titleField } = createFixture();

    expect(() =>
      bridge.mount({
        container,
        onFailure: vi.fn(),
        onReady: vi.fn(),
        submissionField: document.createElement('input') as unknown as HTMLTextAreaElement,
        titleField
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-submission-field' }));
    expect(container.childElementCount).toBe(0);
  });

  it('releases the document session when a readiness consumer rejects handoff', async () => {
    const bridge = createAdminEditorDocumentSourceBridge(bootstrap);
    const { container, submissionField, titleField } = createFixture();
    const onFailure = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventReportedError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventReportedError);

    try {
      await act(async () => {
        bridge.mount({
          container,
          onFailure,
          onReady() {
            throw new Error('synthetic handoff rejection');
          },
          submissionField,
          titleField
        });
      });

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.cm-editor')).toBeNull();
    } finally {
      window.removeEventListener('error', preventReportedError);
      consoleError.mockRestore();
    }
  });
});
