export type LocalDraft = Readonly<{
  content: string;
  contentHash: string;
  schemaVersion: 1;
  updatedAt: number;
}>;

export type LocalDraftReadResult =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'available'; draft: LocalDraft; source: 'current' | 'legacy' }>
  | Readonly<{ status: 'failed'; code: string }>;

export type LocalDraftWriteResult =
  | Readonly<{ status: 'saved'; updatedAt: number; diagnostic?: string }>
  | Readonly<{ status: 'failed'; code: string }>;

export type LocalDraftDiscardResult =
  | Readonly<{ status: 'discarded' }>
  | Readonly<{ status: 'failed'; code: string }>;

export type LocalDraftTimeResult =
  | Readonly<{ status: 'formatted'; value: string }>
  | Readonly<{ status: 'failed'; code: string }>;

export interface LocalDraftStoragePort {
  discard(): LocalDraftDiscardResult;
  fingerprint(content: string): string;
  formatTime(timestamp: number): LocalDraftTimeResult;
  read(): LocalDraftReadResult;
  subscribe(listener: () => void): () => void;
  write(content: string): LocalDraftWriteResult;
}

export interface LocalDraftDocumentPort {
  applyTextChange(change: Readonly<{
    selection: Readonly<{
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }>;
    value: string;
  }>): void;
  focus(): void;
  getValue(): string;
}
