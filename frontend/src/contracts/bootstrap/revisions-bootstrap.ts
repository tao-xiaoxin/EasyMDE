export type RevisionsBootstrap = Readonly<{
  enabled: boolean;
  strings: Readonly<{
    autoSave: string;
    close: string;
    confirmNavigation: string;
    count: string;
    failed: string;
    filterAll: string;
    help: string;
    loading: string;
    loadingPreview: string;
    manualSave: string;
    noRevisions: string;
    open: string;
    previewFailed: string;
    restore: string;
    title: string;
    untitled: string;
  }>;
}>;

const STRING_KEYS = [
  'autoSave', 'close', 'confirmNavigation', 'count', 'failed', 'filterAll', 'help', 'loading',
  'loadingPreview', 'manualSave', 'noRevisions', 'open', 'previewFailed',
  'restore', 'title', 'untitled'
] as const;

export function parseRevisionsBootstrap(value: unknown): RevisionsBootstrap {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('revisions-bootstrap-invalid');
  }
  const source = value as Record<string, unknown>;
  if ('boolean' !== typeof source.enabled || !source.strings || 'object' !== typeof source.strings || Array.isArray(source.strings)) {
    throw new Error('revisions-bootstrap-invalid');
  }
  const strings = source.strings as Record<string, unknown>;
  for (const key of STRING_KEYS) {
    if ('string' !== typeof strings[key] || !strings[key].trim() || strings[key].length > 512) {
      throw new Error('revisions-bootstrap-invalid');
    }
  }
  return {
    enabled: source.enabled,
    strings: Object.fromEntries(STRING_KEYS.map((key) => [key, strings[key]])) as RevisionsBootstrap['strings']
  };
}
