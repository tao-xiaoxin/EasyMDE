import { Fragment, createElement } from '@wordpress/element';
import type { ReactNode } from 'react';

import { Check, Lock } from '../../../generated/lucide-icons';
import type { PreviewSurfaceStatus } from '../../live-preview/ui/PreviewSurfaceOwner';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

type Props = Readonly<{
  active: boolean;
  children: ReactNode;
  ordinaryLabel: string;
  onRequestEdit: () => void;
  status: PreviewSurfaceStatus;
  statusMessages: Readonly<{
    empty: string;
    error: string;
    loading: string;
  }>;
  strings: ImmersiveStrings;
}>;

/**
 * Presents the existing server Preview owner in the reference Preview-mode
 * frame. The content stays read-only because Markdown remains authoritative.
 */
export function ImmersivePreviewSurface({
  active,
  children,
  ordinaryLabel,
  onRequestEdit,
  status,
  statusMessages,
  strings
}: Props) {
  const statusLabel =
    'ready' === status
      ? strings.previewContentLoaded
      : statusMessages[status];

  if (!active) {
    return (
      <section className="easymde-pane easymde-pane-preview">
        <header className="easymde-pane-header">{ordinaryLabel}</header>
        {children}
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
            <span>{strings.previewReadOnly}</span>
          </div>
          <div className="easymde-immersive-preview-status">
            <span
              className={`is-${status}`}
              role={'error' === status ? 'alert' : 'status'}
            >
              {'ready' === status ? (
                <Check aria-hidden="true" size={13} strokeWidth={2.4} />
              ) : null}
              {statusLabel}
            </span>
            <button
              type="button"
              className="easymde-immersive-preview-lock"
              aria-label={strings.previewUnlockEdit}
              title={strings.previewUnlockEdit}
              onClick={onRequestEdit}
            >
              <Lock aria-hidden="true" size={13} />
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
