import type {
  LocalDraft,
  LocalDraftReadResult,
  LocalDraftStoragePort,
  LocalDraftWriteResult
} from '../../../contracts/ports/local-drafts-port';
import type { LocalDraftsBootstrap } from '../../../contracts/bootstrap/local-drafts-bootstrap';
import { resolveEditorNumberLocale } from '../../../contracts/bootstrap/editor-layout-bootstrap';

type BrowserLocalDraftStorageOptions = Readonly<{
  config: Omit<LocalDraftsBootstrap, 'enabled' | 'strings'>;
  eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now: () => number;
  storage: Storage | null;
}>;

function updateFnv1a(hash: number, byte: number): number {
  const next = hash ^ byte;
  return (next + (next << 1) + (next << 4) + (next << 7) + (next << 8) + (next << 24)) >>> 0;
}

function updateCodePoint(hash: number, codePoint: number, bytes: number): Readonly<{ hash: number; bytes: number }> {
  if (codePoint < 0x80) return { hash: updateFnv1a(hash, codePoint), bytes: bytes + 1 };
  if (codePoint < 0x800) {
    return {
      hash: updateFnv1a(updateFnv1a(hash, 0xc0 | (codePoint >> 6)), 0x80 | (codePoint & 0x3f)),
      bytes: bytes + 2
    };
  }
  if (codePoint < 0x10000) {
    hash = updateFnv1a(hash, 0xe0 | (codePoint >> 12));
    hash = updateFnv1a(hash, 0x80 | ((codePoint >> 6) & 0x3f));
    return { hash: updateFnv1a(hash, 0x80 | (codePoint & 0x3f)), bytes: bytes + 3 };
  }
  hash = updateFnv1a(hash, 0xf0 | (codePoint >> 18));
  hash = updateFnv1a(hash, 0x80 | ((codePoint >> 12) & 0x3f));
  hash = updateFnv1a(hash, 0x80 | ((codePoint >> 6) & 0x3f));
  return { hash: updateFnv1a(hash, 0x80 | (codePoint & 0x3f)), bytes: bytes + 4 };
}

function fingerprintContent(content: string): Readonly<{ bytes: number; value: string }> {
  let bytes = 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    let codePoint = content.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < content.length) {
      const next = content.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) * 0x400) + (next - 0xdc00);
        index += 1;
      }
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
    ({ bytes, hash } = updateCodePoint(hash, codePoint, bytes));
  }
  return { bytes, value: `${bytes}:${hash.toString(16).padStart(8, '0')}` };
}

function parseFixedOffsetMinutes(timeZone: string): number | null {
  const match = /^([+-])(\d{2}):([0-5]\d)$/.exec(timeZone);
  const sign = match?.[1];
  const hours = match?.[2];
  const minutes = match?.[3];
  if (!sign || !hours || !minutes) return null;

  const hourValue = Number(hours);
  if (hourValue > 23) return null;

  const offset = (hourValue * 60) + Number(minutes);
  return '-' === sign ? -offset : offset;
}

function parseDraft(value: string, source: 'current' | 'legacy', maxBytes: number): LocalDraftReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { code: 'local-draft-payload-invalid', status: 'failed' };
  }
  if (!parsed || 'object' !== typeof parsed || Array.isArray(parsed)) {
    return { code: 'local-draft-payload-invalid', status: 'failed' };
  }
  const payload = parsed as Record<string, unknown>;
  if (
    'string' !== typeof payload.content
    || !Number.isInteger(payload.updatedAt)
    || Number(payload.updatedAt) <= 0
    || ('current' === source && 1 !== payload.schemaVersion)
    || ('legacy' === source && undefined !== payload.schemaVersion && 1 !== payload.schemaVersion)
  ) {
    return { code: 'local-draft-payload-invalid', status: 'failed' };
  }
  const fingerprint = fingerprintContent(payload.content);
  if (fingerprint.bytes > maxBytes) {
    return { code: 'local-draft-size-exceeded', status: 'failed' };
  }
  if (
    undefined !== payload.contentHash
    && ('string' !== typeof payload.contentHash || payload.contentHash !== fingerprint.value)
  ) {
    return { code: 'local-draft-payload-invalid', status: 'failed' };
  }
  return {
    draft: {
      content: payload.content,
      contentHash: fingerprint.value,
      schemaVersion: 1,
      updatedAt: Number(payload.updatedAt)
    },
    source,
    status: 'available'
  };
}

export function createBrowserLocalDraftStorage({
  config,
  eventTarget,
  now,
  storage
}: BrowserLocalDraftStorageOptions): LocalDraftStoragePort {
  const identity = `${config.siteKey}:${config.userId}:${config.postId || 'new'}`;
  const currentKey = `easymde:draft:v${config.schemaVersion}:${identity}`;
  const legacyKey = `easymde:draft:${identity}`;
  const currentHashKey = `${currentKey}:hash`;
  const legacyHashKey = `${legacyKey}:hash`;

  const read = (): LocalDraftReadResult => {
    if (!storage) return { code: 'local-draft-storage-unavailable', status: 'failed' };
    try {
      const current = storage.getItem(currentKey);
      const legacy = storage.getItem(legacyKey);
      const currentResult = null === current
        ? { status: 'missing' } as const
        : parseDraft(current, 'current', config.maxBytes);
      const legacyResult = null === legacy
        ? { status: 'missing' } as const
        : parseDraft(legacy, 'legacy', config.maxBytes);

      if ('available' === currentResult.status && 'available' === legacyResult.status) {
        return currentResult.draft.updatedAt >= legacyResult.draft.updatedAt
          ? currentResult
          : legacyResult;
      }
      if ('available' === currentResult.status) return currentResult;
      if ('available' === legacyResult.status) return legacyResult;
      if ('failed' === currentResult.status) return currentResult;
      if ('failed' === legacyResult.status) return legacyResult;
      return { status: 'missing' };
    } catch {
      return { code: 'local-draft-read-failed', status: 'failed' };
    }
  };

  return {
    discard() {
      if (!storage) return { code: 'local-draft-storage-unavailable', status: 'failed' };
      try {
        storage.removeItem(currentKey);
        storage.removeItem(currentHashKey);
        storage.removeItem(legacyKey);
        storage.removeItem(legacyHashKey);
        return { status: 'discarded' };
      } catch {
        return { code: 'local-draft-discard-failed', status: 'failed' };
      }
    },
    fingerprint(content) {
      return fingerprintContent(content).value;
    },
    formatTime(timestamp) {
      try {
        const fixedOffset = parseFixedOffsetMinutes(config.timeZone);
        const date = new Date(timestamp + (null === fixedOffset ? 0 : fixedOffset * 60_000));
        const value = new Intl.DateTimeFormat(resolveEditorNumberLocale(config.locale), {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: null === fixedOffset ? config.timeZone : 'UTC'
        }).format(date);
        return { status: 'formatted', value };
      } catch {
        return { code: 'local-draft-time-format-failed', status: 'failed' };
      }
    },
    read,
    subscribe(listener) {
      if (!storage) return () => undefined;
      let active = true;
      const handleStorage = (event: Event) => {
        const key = (event as StorageEvent).key;
        if (active && (key === currentKey || key === legacyKey)) listener();
      };
      eventTarget.addEventListener('storage', handleStorage);
      return () => {
        if (!active) return;
        active = false;
        eventTarget.removeEventListener('storage', handleStorage);
      };
    },
    write(content): LocalDraftWriteResult {
      const fingerprint = fingerprintContent(content);
      if (fingerprint.bytes > config.maxBytes) {
        return { code: 'local-draft-size-exceeded', status: 'failed' };
      }
      const updatedAt = now();
      const draft: LocalDraft = {
        content,
        contentHash: fingerprint.value,
        schemaVersion: 1,
        updatedAt
      };
      if (!storage) return { code: 'local-draft-storage-unavailable', status: 'failed' };
      try {
        storage.setItem(currentKey, JSON.stringify(draft));
      } catch {
        return { code: 'local-draft-write-failed', status: 'failed' };
      }
      try {
        storage.setItem(currentHashKey, fingerprint.value);
      } catch {
        return {
          diagnostic: 'local-draft-hash-sidecar-write-failed',
          status: 'saved',
          updatedAt
        };
      }
      try {
        storage.removeItem(legacyKey);
        storage.removeItem(legacyHashKey);
      } catch {
        return { diagnostic: 'local-draft-legacy-cleanup-failed', status: 'saved', updatedAt };
      }
      return { status: 'saved', updatedAt };
    }
  };
}
