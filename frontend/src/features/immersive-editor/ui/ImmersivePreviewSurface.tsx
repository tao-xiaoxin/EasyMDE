import { Fragment, createElement } from '@wordpress/element';
import type { ReactNode } from 'react';

import { Check, Lock, Unlock } from '../../../generated/lucide-icons';
import type { PreviewSurfaceStatus } from '../../live-preview/ui/PreviewSurfaceOwner';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

type Props = Readonly<{
  active: boolean;
  canEdit: boolean;
  children: ReactNode;
  changed: boolean;
  editable: boolean;
  hasSnapshot: boolean;
  ordinaryLabel: string;
  onToggleEditable: () => void;
  status: PreviewSurfaceStatus;
  statusMessages: Readonly<{
    empty: string;
    error: string;
  }>;
  strings: ImmersiveStrings;
}>;

/**
 * Presents the existing server Preview owner in the reference Preview-mode
 * frame. Editable content still synchronizes into the authoritative Markdown
 * document session owned by the Editor Root.
 */
export function ImmersivePreviewSurface({
  active,
  canEdit,
  children,
  changed,
  editable,
  hasSnapshot,
  ordinaryLabel,
  onToggleEditable,
  status,
  statusMessages,
  strings
}: Props) {
  const hasCompletedPaper =
    'ready' === status || ('loading' === status && hasSnapshot);
  const statusLabel =
    'error' === status
      ? statusMessages.error
      : hasCompletedPaper
        ? changed
          ? strings.previewChangesRecorded
          : strings.previewContentLoaded
        : null;

  if (!active) {
    return (
      <section className="easymde-pane easymde-pane-preview">
        <header className="easymde-pane-header">{ordinaryLabel}</header>
        <div className="easymde-immersive-preview-canvas">
          <div className="easymde-immersive-preview-page">{children}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="easymde-pane easymde-pane-preview easymde-immersive-preview-surface">
      <header className="easymde-pane-header">
        <Fragment>
          <div className="easymde-immersive-preview-heading">
            <span>{strings.preview}</span>
            <span aria-hidden="true" />
            <span>
              {editable ? strings.previewEditable : strings.previewReadOnly}
            </span>
          </div>
          <div className="easymde-immersive-preview-status">
            {statusLabel ? (
              <span
                className={`is-${status}`}
                role={'error' === status ? 'alert' : 'status'}
              >
              {hasCompletedPaper ? (
                <Check aria-hidden="true" size={13} strokeWidth={2.4} />
              ) : null}
              {statusLabel}
              </span>
            ) : null}
            <button
              type="button"
              className={`easymde-immersive-preview-lock${editable ? ' is-editable' : ''}`}
              aria-label={
                editable
                  ? strings.previewLockReadOnly
                  : strings.previewUnlockEdit
              }
              aria-pressed={!editable}
              disabled={!editable && !canEdit}
              title={
                editable
                  ? strings.previewLockReadOnly
                  : strings.previewUnlockEdit
              }
              onMouseDown={(event) => {
                if (editable) event.preventDefault();
              }}
              onClick={onToggleEditable}
            >
              {editable ? (
                <Unlock aria-hidden="true" size={13} />
              ) : (
                <Lock aria-hidden="true" size={13} />
              )}
            </button>
          </div>
        </Fragment>
      </header>
      <div className="easymde-immersive-preview-canvas">
        <div className="easymde-immersive-preview-page">{children}</div>
      </div>
    </section>
  );
}
