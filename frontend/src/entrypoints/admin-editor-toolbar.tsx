import { createElement, createRoot } from '@wordpress/element';

import { ToolbarErrorBoundary } from '../app/editor/ToolbarErrorBoundary';
import { parseToolbarBootstrap } from '../contracts/bootstrap/toolbar-bootstrap';
import {
  EditorToolbar,
  type ToolbarPlatform
} from '../features/toolbar/ui/EditorToolbar';

export type ToolbarMountOptions = Readonly<{
  container: HTMLElement;
  executeCommand: (commandId: string) => void;
  onFailure: () => void;
  onReady: () => void;
  platform: ToolbarPlatform;
}>;

export type AdminEditorToolbarBridge = Readonly<{
  mount: (options: ToolbarMountOptions) => () => void;
}>;

export function createAdminEditorToolbarBridge(value: unknown): AdminEditorToolbarBridge {
  const bootstrap = parseToolbarBootstrap(value);

  return {
    mount({
      container,
      executeCommand,
      onFailure,
      onReady,
      platform
    }: ToolbarMountOptions): () => void {
      const root = createRoot(container);
      let active = true;

      root.render(
        <ToolbarErrorBoundary onFailure={onFailure}>
          <EditorToolbar
            bootstrap={bootstrap}
            platform={platform}
            executeCommand={executeCommand}
            onReady={onReady}
          />
        </ToolbarErrorBoundary>
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
    EasyMDEReactToolbar?: Readonly<{
      prepare: typeof createAdminEditorToolbarBridge;
    }>;
  }
}

window.EasyMDEReactToolbar = {
  prepare: createAdminEditorToolbarBridge
};
