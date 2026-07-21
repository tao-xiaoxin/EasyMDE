import { createElement, createRoot } from '@wordpress/element';

import { ToolbarErrorBoundary } from '../app/editor/ToolbarErrorBoundary';
import { parseToolbarBootstrap } from '../contracts/bootstrap/toolbar-bootstrap';
import type { ToolbarCommandDocumentPort } from '../contracts/ports/toolbar-command-port';
import type { PreparedToolbarShortcutBinding } from '../contracts/ports/toolbar-shortcuts-port';
import {
  createToolbarCommandSession,
  type ToolbarCommandSession
} from '../features/toolbar/toolbar-command-session';
import {
  EditorToolbar,
  type ToolbarPlatform
} from '../features/toolbar/ui/EditorToolbar';
import { createBrowserToolbarShortcuts } from '../integrations/browser/keyboard/create-browser-toolbar-shortcuts';

export type AdminEditorToolbarSession = ToolbarCommandSession & Readonly<{
  activateShortcuts: () => void;
}>;

export type ToolbarMountOptions = Readonly<{
  container: HTMLElement;
  document: ToolbarCommandDocumentPort;
  editorRoot: HTMLElement;
  executeExternalCommand: (commandId: string) => unknown;
  legacySource: HTMLElement;
  onFailure: () => void;
  onReady: (session: AdminEditorToolbarSession) => void;
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
      editorRoot,
      executeExternalCommand,
      legacySource,
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
      const shortcutBinding: PreparedToolbarShortcutBinding = createBrowserToolbarShortcuts({
        commands: bootstrap.commands,
        editorRoot,
        eventTarget: window.document,
        platform,
        shortcuts: bootstrap.shortcuts,
        source: legacySource
      }).prepareBinding((commandId) => {
        if (commandSession.owns(commandId)) {
          commandSession.execute(commandId);
          return;
        }
        executeExternalCommand(commandId);
      });
      let sessionActive = true;
      const session: AdminEditorToolbarSession = {
        activateShortcuts: shortcutBinding.activate,
        dispose() {
          if (!sessionActive) return;
          sessionActive = false;
          shortcutBinding.dispose();
          commandSession.dispose();
        },
        execute: commandSession.execute,
        owns: commandSession.owns
      };

      root.render(
        <ToolbarErrorBoundary onFailure={onFailure}>
          <EditorToolbar
            bootstrap={bootstrap}
            platform={platform}
            executeCommand={commandSession.execute}
            onReady={() => onReady(session)}
          />
        </ToolbarErrorBoundary>
      );

      return () => {
        if (!active) {
          return;
        }
        active = false;
        session.dispose();
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
