import type {
  PreparedScrollSyncBinding,
  ScrollSyncBindingOptions
} from '../contracts/ports/scroll-sync-port';
import { createBrowserScrollSync } from '../integrations/browser/editor-layout/create-browser-scroll-sync';

export type AdminEditorScrollSyncBridge = Readonly<{
  prepareBinding: (value: unknown) => PreparedScrollSyncBinding;
}>;

function parseBindingOptions(value: unknown): ScrollSyncBindingOptions {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('scroll-sync-binding-options-invalid');
  }
  const options = value as Record<string, unknown>;
  if (!(options.source instanceof HTMLElement) || !(options.preview instanceof HTMLElement)) {
    throw new Error('scroll-sync-binding-options-invalid');
  }
  return { preview: options.preview, source: options.source };
}

export function createAdminEditorScrollSyncBridge(
  runtime: Pick<Window, 'clearTimeout' | 'setTimeout'>
): AdminEditorScrollSyncBridge {
  const scrollSync = createBrowserScrollSync(runtime);
  return {
    prepareBinding(value) {
      return scrollSync.prepareBinding(parseBindingOptions(value));
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactScrollSync?: Readonly<{
      prepare: () => AdminEditorScrollSyncBridge;
    }>;
  }
}

window.EasyMDEReactScrollSync = {
  prepare: () => createAdminEditorScrollSyncBridge(window)
};
