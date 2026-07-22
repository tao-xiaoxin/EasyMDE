import { createElement } from '@wordpress/element';
import type { ReactNode } from 'react';

type EditorWorkspaceProps = Readonly<{
  direction: 'ltr' | 'rtl';
  preview: ReactNode;
  source: ReactNode;
}>;

/**
 * Owns the ordinary editor's fixed Source/Preview composition.
 *
 * WordPress remains responsible for publishing and revisions outside this
 * Root. The two surfaces deliberately stay mounted in their historical order
 * so CodeMirror, Preview and synchronized scrolling keep one stable lifecycle.
 */
export function EditorWorkspace({
  direction,
  preview,
  source
}: EditorWorkspaceProps) {
  return (
    <div
      className="easymde-workspace"
      data-easymde-layout-owner="react"
      dir={direction}
    >
      {source}
      {preview}
    </div>
  );
}
