import { createElement, createRoot } from '@wordpress/element';

import { AppearanceErrorBoundary } from '../app/editor/AppearanceErrorBoundary';
import {
  parseAppearanceBootstrap,
  parseAppearanceSnapshot,
  parseCustomCssSaveResult
} from '../contracts/bootstrap/appearance-bootstrap';
import type { AppearancePort } from '../contracts/ports/appearance-port';
import {
  AppearanceControls,
  type AppearanceControlsSession
} from '../features/appearance/ui/AppearanceControls';

export type AppearancePublicSession = Readonly<{
  close: () => void;
  replaceSnapshot: (value: unknown) => boolean;
}>;

export type AppearanceMountOptions = Readonly<{
  container: HTMLElement;
  port: AppearancePort;
  onFailure: () => void;
  onReady: (session: AppearancePublicSession) => void;
}>;

export type AdminEditorAppearanceBridge = Readonly<{
  mount: (options: AppearanceMountOptions) => () => void;
}>;

export function createAdminEditorAppearanceBridge(
  value: unknown
): AdminEditorAppearanceBridge {
  const bootstrap = parseAppearanceBootstrap(value);

  return {
    mount({
      container,
      port,
      onFailure,
      onReady
    }: AppearanceMountOptions): () => void {
      if (container.childNodes.length) {
        throw new Error('appearance-container-invalid');
      }
      const root = createRoot(container);
      let active = true;
      const validatedPort: AppearancePort = {
        applyState: (state) => port.applyState(state),
        closeOtherPopovers: () => port.closeOtherPopovers(),
        saveCustomCss: async (input) => parseCustomCssSaveResult(
          await port.saveCustomCss(input),
          bootstrap
        )
      };

      const handleReady = (session: AppearanceControlsSession) => {
        const publicSession: AppearancePublicSession = {
          close: () => {
            if (active) {
              session.close();
            }
          },
          replaceSnapshot: (nextValue) => {
            if (!active) {
              return false;
            }
            try {
              return session.replaceSnapshot(
                parseAppearanceSnapshot(nextValue, bootstrap)
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
        <AppearanceErrorBoundary onFailure={onFailure}>
          <AppearanceControls
            bootstrap={bootstrap}
            port={validatedPort}
            onFailure={onFailure}
            onReady={handleReady}
          />
        </AppearanceErrorBoundary>
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
    EasyMDEReactAppearance?: Readonly<{
      prepare: typeof createAdminEditorAppearanceBridge;
    }>;
  }
}

window.EasyMDEReactAppearance = {
  prepare: createAdminEditorAppearanceBridge
};
