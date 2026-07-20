import { createElement, useLayoutEffect } from '@wordpress/element';

import type {
  PreviewRequestPort,
  PreviewRequestState
} from '../../../contracts/ports/preview-request';
import {
  createPreviewRequestSession,
  type PreviewRequestSession
} from '../model/create-preview-request-session';

type PreviewRequestSessionOwnerProps = Readonly<{
  initialRevision: number;
  onReady: (session: PreviewRequestSession) => void;
  onState: (state: PreviewRequestState) => void;
  port: PreviewRequestPort;
}>;

export function PreviewRequestSessionOwner(props: PreviewRequestSessionOwnerProps) {
  useLayoutEffect(() => {
    const session = createPreviewRequestSession(props);
    try {
      props.onReady(session);
    } catch (error) {
      session.destroy();
      throw error;
    }
    return () => session.destroy();
  }, [props]);

  return <span data-easymde-react-preview-session="ready" hidden />;
}
