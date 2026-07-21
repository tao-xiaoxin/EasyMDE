import { createElement, createRoot } from '@wordpress/element';

import { ToolbarErrorBoundary } from '../app/editor/ToolbarErrorBoundary';
import { parseToolbarBootstrap } from '../contracts/bootstrap/toolbar-bootstrap';
import type { ToolbarCommandDocumentPort } from '../contracts/ports/toolbar-command-port';
import {
  createToolbarCommandSession,
  type ToolbarCommandSession
} from '../features/toolbar/toolbar-command-session';
import {
  EditorToolbar,
  type ToolbarPlatform
} from '../features/toolbar/ui/EditorToolbar';

export type ToolbarMountOptions = Readonly<{
  container: HTMLElement;
  document: ToolbarCommandDocumentPort;
  executeExternalCommand: (commandId: string) => unknown;
  onFailure: () => void;
  onReady: (session: ToolbarCommandSession) => void;
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
      document,
      executeExternalCommand,
      onFailure,
      onReady,
      platform
    }: ToolbarMountOptions): () => void {
      const root = createRoot(container);
      let active = true;
      const commandSession = createToolbarCommandSession({
        commands: bootstrap.commands,
        document,
        executeExternalCommand,
        linkText: bootstrap.linkText
      });

      root.render(
        <ToolbarErrorBoundary onFailure={onFailure}>
          <EditorToolbar
            bootstrap={bootstrap}
            platform={platform}
            executeCommand={commandSession.execute}
            onReady={() => onReady(commandSession)}
          />
        </ToolbarErrorBoundary>
      );

      return () => {
        if (!active) {
          return;
        }
        active = false;
        commandSession.dispose();
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
