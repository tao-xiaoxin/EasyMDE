import type {
  LocalDraft,
  LocalDraftDocumentPort,
  LocalDraftStoragePort
} from '../../contracts/ports/local-drafts-port';

export type LocalDraftSessionStatus = Readonly<{
  code: 'conflict' | 'discard-failed' | 'discarded' | 'read-failed' | 'restored' | 'save-failed' | 'saved';
  message: string;
  type: 'error' | 'info' | 'success';
}>;

export type LocalDraftSessionStrings = Readonly<{
  conflict: string;
  discardFailed: string;
  discarded: string;
  readFailed: string;
  restored: string;
  saveFailed: string;
  saved: string;
}>;

type CreateLocalDraftSessionOptions = Readonly<{
  delayMs: number;
  document: LocalDraftDocumentPort;
  enabled: boolean;
  onCandidate: (available: boolean) => void;
  onDiagnostic: (code: string) => void;
  onStatus: (status: LocalDraftSessionStatus) => void;
  savedFingerprint?: string;
  storage: LocalDraftStoragePort;
  strings: LocalDraftSessionStrings;
}>;

export type LocalDraftSession = Readonly<{
  discard(): boolean;
  dispose(): void;
  getEnabled(): boolean;
  reconcileSavedDraft(): boolean;
  restore(): boolean;
  schedule(markdown?: string): boolean;
  setEnabled(enabled: boolean): boolean;
}>;

export function createLocalDraftSession({
  delayMs,
  document,
  enabled: initialEnabled,
  onCandidate,
  onDiagnostic,
  onStatus,
  savedFingerprint = '',
  storage,
  strings
}: CreateLocalDraftSessionOptions): LocalDraftSession {
  let active = true;
  let blockedByReadFailure = false;
  let candidate: LocalDraft | null = null;
  let conflicted = false;
  let enabled = initialEnabled;
  let pendingMarkdown: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (null === timer) return;
    clearTimeout(timer);
    timer = null;
    pendingMarkdown = null;
  };

  const clearCandidate = () => {
    candidate = null;
    conflicted = false;
    onCandidate(false);
  };

  const readCandidate = (external: boolean) => {
    const result = storage.read();
    if ('failed' === result.status) {
      blockedByReadFailure = true;
      cancelTimer();
      onDiagnostic(result.code);
      onStatus({ code: 'read-failed', message: strings.readFailed, type: 'error' });
      return;
    }
    blockedByReadFailure = false;
    if ('missing' === result.status) {
      clearCandidate();
      return;
    }
    if (savedFingerprint && result.draft.contentHash === savedFingerprint) {
      clearCandidate();
      return;
    }
    if (result.draft.content === document.getValue()) {
      clearCandidate();
      return;
    }
    candidate = result.draft;
    conflicted = true;
    cancelTimer();
    onCandidate(true);
    if (external) onStatus({ code: 'conflict', message: strings.conflict, type: 'error' });
  };

  const unsubscribe = storage.subscribe(() => {
    if (active) readCandidate(true);
  });
  readCandidate(false);

  return {
    discard() {
      if (!active || !candidate) return false;
      const result = storage.discard();
      if ('failed' === result.status) {
        onDiagnostic(result.code);
        onStatus({ code: 'discard-failed', message: strings.discardFailed, type: 'error' });
        return false;
      }
      clearCandidate();
      onStatus({ code: 'discarded', message: strings.discarded, type: 'info' });
      return true;
    },
    dispose() {
      if (!active) return;
      active = false;
      cancelTimer();
      unsubscribe();
    },
    getEnabled() {
      return enabled;
    },
    reconcileSavedDraft() {
      if (!active || !savedFingerprint) return false;
      const available = storage.read();
      if ('failed' === available.status) {
        blockedByReadFailure = true;
        cancelTimer();
        onDiagnostic(available.code);
        onStatus({ code: 'read-failed', message: strings.readFailed, type: 'error' });
        return false;
      }
      if ('missing' === available.status || available.draft.contentHash !== savedFingerprint) return false;
      const discarded = storage.discard();
      if ('failed' === discarded.status) {
        onDiagnostic(discarded.code);
        onStatus({ code: 'discard-failed', message: strings.discardFailed, type: 'error' });
        return false;
      }
      clearCandidate();
      return true;
    },
    restore() {
      if (!active || !candidate) return false;
      const content = candidate.content;
      document.applyTextChange({
        selection: { direction: 'none', end: content.length, start: content.length },
        value: content
      });
      document.focus();
      clearCandidate();
      onStatus({ code: 'restored', message: strings.restored, type: 'success' });
      return true;
    },
    schedule(markdown) {
      if (!active || !enabled || conflicted || blockedByReadFailure) return false;
      cancelTimer();
      pendingMarkdown = markdown ?? null;
      timer = setTimeout(() => {
        const content = pendingMarkdown ?? document.getValue();
        timer = null;
        pendingMarkdown = null;
        if (!active || !enabled || conflicted) return;
        const result = storage.write(content);
        if ('failed' === result.status) {
          onDiagnostic(result.code);
          onStatus({ code: 'save-failed', message: strings.saveFailed, type: 'error' });
          return;
        }
        if (result.diagnostic) onDiagnostic(result.diagnostic);
        const formatted = storage.formatTime(result.updatedAt);
        if ('failed' === formatted.status) {
          onDiagnostic(formatted.code);
          onStatus({ code: 'saved', message: strings.saved, type: 'success' });
          return;
        }
        onStatus({ code: 'saved', message: `${strings.saved} ${formatted.value}`, type: 'success' });
      }, delayMs);
      return true;
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
      if (!enabled) cancelTimer();
      return enabled;
    }
  };
}
