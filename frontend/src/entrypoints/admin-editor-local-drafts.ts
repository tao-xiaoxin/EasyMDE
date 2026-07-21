import { parseLocalDraftsBootstrap } from '../contracts/bootstrap/local-drafts-bootstrap';
import type { LocalDraftDocumentPort } from '../contracts/ports/local-drafts-port';
import {
  createLocalDraftSession,
  type LocalDraftSession,
  type LocalDraftSessionStatus
} from '../features/local-drafts/local-draft-session';
import { createBrowserLocalDraftStorage } from '../integrations/browser/local-drafts/browser-local-draft-storage';

export type LocalDraftStartupInspection =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'available'; differentFromSaved: boolean }>
  | Readonly<{ status: 'failed'; code: string }>;

export type LocalDraftActivateOptions = Readonly<{
  document: LocalDraftDocumentPort;
  onCandidate: (available: boolean) => void;
  onDiagnostic: (code: string) => void;
  onStatus: (status: LocalDraftSessionStatus) => void;
  savedFingerprint: string;
}>;

export type AdminEditorLocalDraftsBridge = Readonly<{
  activate: (options: LocalDraftActivateOptions) => LocalDraftSession;
  inspect: (savedFingerprint: string) => LocalDraftStartupInspection;
}>;

type LocalDraftBrowserRuntime = Readonly<{
  eventTarget: unknown;
  now: unknown;
  storage: unknown;
}>;

function validDocumentPort(value: unknown): value is LocalDraftDocumentPort {
  if (!value || 'object' !== typeof value) return false;
  const port = value as Partial<LocalDraftDocumentPort>;
  return 'function' === typeof port.applyTextChange
    && 'function' === typeof port.focus
    && 'function' === typeof port.getValue;
}

function validStorage(value: unknown): value is Storage {
  if (!value || 'object' !== typeof value) return false;
  const storage = value as Partial<Storage>;
  return 'function' === typeof storage.getItem
    && 'function' === typeof storage.removeItem
    && 'function' === typeof storage.setItem;
}

function validEventTarget(
  value: unknown
): value is Pick<Window, 'addEventListener' | 'removeEventListener'> {
  if (!value || 'object' !== typeof value) return false;
  const target = value as Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>;
  return 'function' === typeof target.addEventListener
    && 'function' === typeof target.removeEventListener;
}

export function createAdminEditorLocalDraftsBridge(
  value: unknown,
  runtime: LocalDraftBrowserRuntime
): AdminEditorLocalDraftsBridge {
  const bootstrap = parseLocalDraftsBootstrap(value);
  if (!validStorage(runtime.storage)) {
    throw new Error('local-drafts-storage-unavailable');
  }
  if (!validEventTarget(runtime.eventTarget) || 'function' !== typeof runtime.now) {
    throw new Error('local-drafts-browser-runtime-unavailable');
  }
  const storage = createBrowserLocalDraftStorage({
    config: bootstrap,
    eventTarget: runtime.eventTarget,
    now: runtime.now as () => number,
    storage: runtime.storage
  });

  return {
    activate(options) {
      if (
        !options
        || !validDocumentPort(options.document)
        || 'function' !== typeof options.onCandidate
        || 'function' !== typeof options.onDiagnostic
        || 'function' !== typeof options.onStatus
        || 'string' !== typeof options.savedFingerprint
      ) {
        throw new Error('local-drafts-activation-invalid');
      }
      return createLocalDraftSession({
        delayMs: 500,
        document: options.document,
        enabled: bootstrap.enabled,
        onCandidate: options.onCandidate,
        onDiagnostic: options.onDiagnostic,
        onStatus: options.onStatus,
        savedFingerprint: options.savedFingerprint,
        storage,
        strings: {
          conflict: bootstrap.strings.conflict,
          discardFailed: bootstrap.strings.discardFailed,
          discarded: bootstrap.strings.discarded,
          readFailed: bootstrap.strings.readFailed,
          restored: bootstrap.strings.restored,
          saveFailed: bootstrap.strings.saveFailed,
          saved: bootstrap.strings.saved
        }
      });
    },
    inspect(savedFingerprint) {
      if ('string' !== typeof savedFingerprint) {
        throw new Error('local-drafts-saved-fingerprint-invalid');
      }
      const result = storage.read();
      if ('failed' === result.status) return result;
      if ('missing' === result.status) return result;
      return {
        differentFromSaved: !savedFingerprint || result.draft.contentHash !== savedFingerprint,
        status: 'available'
      };
    }
  };
}

declare global {
  interface Window {
    EasyMDEReactLocalDrafts?: Readonly<{
      prepare: (value: unknown) => AdminEditorLocalDraftsBridge;
    }>;
  }
}

window.EasyMDEReactLocalDrafts = {
  prepare(value) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    return createAdminEditorLocalDraftsBridge(value, {
      eventTarget: window,
      now: Date.now,
      storage
    });
  }
};
