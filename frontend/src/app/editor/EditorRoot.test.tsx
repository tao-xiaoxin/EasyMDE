import { createElement } from '@wordpress/element';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SafePreviewHtml } from '../../contracts/ports/preview-request';
import type { PreparedToolbarShortcutBinding } from '../../contracts/ports/toolbar-shortcuts-port';
import { EditorRoot, type EditorRootProps } from './EditorRoot';
import { EditorRootErrorBoundary } from './EditorRootErrorBoundary';

const mountedFields: Array<HTMLElement> = [];

function BrokenEditorRoot(): never {
  throw new Error('synthetic editor-root render failure');
}

function fixture(): EditorRootProps & Readonly<{
  shortcutBinding: PreparedToolbarShortcutBinding;
}> {
  const submissionField = document.createElement('textarea');
  const titleField = document.createElement('input');
  submissionField.value = 'selected';
  submissionField.defaultValue = 'selected';
  submissionField.setSelectionRange(0, 8);
  titleField.value = 'Synthetic title';
  document.body.append(submissionField, titleField);
  mountedFields.push(submissionField, titleField);
  const shortcutBinding = {
    activate: vi.fn(),
    dispose: vi.fn()
  };

  return {
    document: { editorLabel: 'Markdown source' },
    enhancementPort: { enhance: vi.fn().mockResolvedValue(undefined) },
    executeExternalCommand: vi.fn(),
    labels: { preview: 'Preview', source: 'Markdown', toolbar: 'Markdown toolbar' },
    onFailure: vi.fn(),
    platform: 'win',
    prepareToolbarShortcuts: vi.fn(() => ({
      prepareBinding: vi.fn(() => shortcutBinding)
    })),
    preview: {
      codeTheme: 'atom-one-dark',
      customCssId: '',
      features: {},
      html: '<p>Initial</p>' as SafePreviewHtml,
      markdownTheme: 'default',
      messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
      postId: 7,
      signature: 'initial'
    },
    previewPort: {
      render: vi.fn().mockResolvedValue({
        features: {},
        html: '<p>Rendered</p>' as SafePreviewHtml
      })
    },
    scrollPort: {
      capture: () => ({ left: 0, ratio: 0, top: 0 }),
      restore: vi.fn()
    },
    shortcutBinding,
    submissionField,
    titleField,
    toolbar: {
      commands: [{
        action: 'wrap',
        group: 'format',
        icon: 'editor-bold',
        id: 'bold',
        label: 'Bold',
        placeholder: 'bold text',
        prefix: '**',
        suffix: '**',
        surface: 'main'
      }, {
        action: 'image',
        group: 'insert',
        icon: 'format-image',
        id: 'image',
        label: 'Image',
        surface: 'main'
      }],
      headingsLabel: 'Headings',
      linkText: 'link text',
      shortcuts: { bold: { mac: 'Cmd+B', win: 'Ctrl+B' } }
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const field of mountedFields.splice(0)) {
    field.remove();
  }
});

describe('EditorRoot', () => {
  it('composes source, toolbar and preview under one React owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    expect(view.container.querySelectorAll('[data-easymde-editor-owner="react"]')).toHaveLength(1);
    expect(view.container.querySelector('.cm-editor')).not.toBeNull();
    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(view.container.querySelector('[data-easymde-preview-html-sink="1"]')?.innerHTML)
        .toBe('<p>Rendered</p>');
    });
    expect(props.shortcutBinding.activate).toHaveBeenCalledTimes(1);

    const bold = view.container.querySelector<HTMLButtonElement>('[data-easymde-command="bold"]');
    expect(bold).not.toBeNull();
    await act(async () => {
      fireEvent.click(bold as HTMLButtonElement);
    });
    expect(props.submissionField.value).toBe('**selected**');

    const image = view.container.querySelector<HTMLButtonElement>('[data-easymde-command="image"]');
    expect(image).not.toBeNull();
    vi.mocked(props.executeExternalCommand).mockReturnValue(false);
    await act(async () => {
      fireEvent.click(image as HTMLButtonElement);
    });
    expect(props.executeExternalCommand).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(props.shortcutBinding.dispose).toHaveBeenCalledTimes(1);
  });

  it('reports a render failure without leaving a partial editor owner', () => {
    const props = fixture();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const preventSyntheticError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventSyntheticError);

    try {
      const view = render(
        <EditorRootErrorBoundary onFailure={props.onFailure}>
          <BrokenEditorRoot />
        </EditorRootErrorBoundary>
      );

      expect(props.onFailure).toHaveBeenCalledWith('react-editor-render-failed');
      expect(view.container.childElementCount).toBe(0);
    } finally {
      window.removeEventListener('error', preventSyntheticError);
      consoleError.mockRestore();
    }
  });
});
