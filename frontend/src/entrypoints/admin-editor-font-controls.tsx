import { createElement, createRoot } from '@wordpress/element';

import { FontControlsErrorBoundary } from '../app/editor/FontControlsErrorBoundary';
import {
  parseFontControlsBootstrap,
  parseFontControlsState
} from '../contracts/bootstrap/font-controls-bootstrap';
import type { FontControlsPort } from '../contracts/ports/font-controls-port';
import {
  FontControls,
  type FontControlsSession
} from '../features/font-controls/ui/FontControls';

export type FontControlsPublicSession = Readonly<{
  close: () => void;
  replaceState: (value: unknown) => boolean;
}>;

export type FontControlsMountOptions = Readonly<{
  container: HTMLElement;
  port: FontControlsPort;
  onFailure: () => void;
  onReady: (session: FontControlsPublicSession) => void;
}>;

export type AdminEditorFontControlsBridge = Readonly<{
  mount: (options: FontControlsMountOptions) => () => void;
}>;

export function createAdminEditorFontControlsBridge(
  value: unknown
): AdminEditorFontControlsBridge {
  const bootstrap = parseFontControlsBootstrap(value);

  return {
    mount({
      container,
      port,
      onFailure,
      onReady
    }: FontControlsMountOptions): () => void {
      if (container.childNodes.length) {
        throw new Error('font-controls-container-invalid');
      }
      const root = createRoot(container);
      let active = true;

      const handleReady = (session: FontControlsSession) => {
        const publicSession: FontControlsPublicSession = {
          close: () => {
            if (active) {
              session.close();
            }
          },
          replaceState: (nextValue) => {
            if (!active) {
              return false;
            }

            try {
              return session.replaceState(
                parseFontControlsState(nextValue, bootstrap.options)
              );
            } catch {
              onFailure();
              return false;
            }
          }
        };
        onReady(publicSession);
      };

      root.render(
        <FontControlsErrorBoundary onFailure={onFailure}>
          <FontControls
            bootstrap={bootstrap}
            port={port}
            onFailure={onFailure}
            onReady={handleReady}
          />
        </FontControlsErrorBoundary>
      );

      return () => {
        if (!active) {
          return;
        }
        active = false;
        root.unmount();
      };
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactFontControls?: Readonly<{
      prepare: typeof createAdminEditorFontControlsBridge;
    }>;
  }
}

window.EasyMDEReactFontControls = {
  prepare: createAdminEditorFontControlsBridge
};
