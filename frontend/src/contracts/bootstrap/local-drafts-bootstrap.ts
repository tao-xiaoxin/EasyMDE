export type LocalDraftStrings = Readonly<{
  available: string;
  conflict: string;
  discard: string;
  discardFailed: string;
  discarded: string;
  readFailed: string;
  restore: string;
  restored: string;
  saveFailed: string;
  saved: string;
}>;

export type LocalDraftsBootstrap = Readonly<{
  enabled: boolean;
  locale: string;
  maxBytes: number;
  postId: number;
  schemaVersion: 1;
  siteKey: string;
  strings: LocalDraftStrings;
  timeZone: string;
  userId: number;
}>;

function requiredString(value: unknown, code: string): string {
  if ('string' !== typeof value || '' === value.trim() || value.length > 512) {
    throw new Error(code);
  }
  return value;
}

function integer(value: unknown, minimum: number, code: string): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new Error(code);
  }
  return Number(value);
}

export function parseLocalDraftsBootstrap(value: unknown): LocalDraftsBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('local-drafts-bootstrap-invalid');
  }
  const config = value as Record<string, unknown>;
  if (!config.strings || 'object' !== typeof config.strings || Array.isArray(config.strings)) {
    throw new Error('local-drafts-strings-invalid');
  }
  const strings = config.strings as Record<string, unknown>;
  if (1 !== config.schemaVersion) {
    throw new Error('local-drafts-schema-version-invalid');
  }

  return {
    enabled: true === config.enabled,
    locale: requiredString(config.locale, 'local-drafts-locale-invalid'),
    maxBytes: integer(config.maxBytes, 1, 'local-drafts-max-bytes-invalid'),
    postId: integer(config.postId, 0, 'local-drafts-post-id-invalid'),
    schemaVersion: 1,
    siteKey: requiredString(config.siteKey, 'local-drafts-site-key-invalid'),
    strings: {
      available: requiredString(strings.available, 'local-drafts-string-invalid'),
      conflict: requiredString(strings.conflict, 'local-drafts-string-invalid'),
      discard: requiredString(strings.discard, 'local-drafts-string-invalid'),
      discardFailed: requiredString(strings.discardFailed, 'local-drafts-string-invalid'),
      discarded: requiredString(strings.discarded, 'local-drafts-string-invalid'),
      readFailed: requiredString(strings.readFailed, 'local-drafts-string-invalid'),
      restore: requiredString(strings.restore, 'local-drafts-string-invalid'),
      restored: requiredString(strings.restored, 'local-drafts-string-invalid'),
      saveFailed: requiredString(strings.saveFailed, 'local-drafts-string-invalid'),
      saved: requiredString(strings.saved, 'local-drafts-string-invalid')
    },
    timeZone: requiredString(config.timeZone, 'local-drafts-time-zone-invalid'),
    userId: integer(config.userId, 0, 'local-drafts-user-id-invalid')
  };
}
