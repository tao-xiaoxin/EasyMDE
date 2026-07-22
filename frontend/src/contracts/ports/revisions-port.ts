import type { PreviewFeatures, SafePreviewHtml } from './preview-request';

export type RevisionType = 'auto' | 'manual';

export type RevisionSummary = Readonly<{
  date: string;
  dateLabel: string;
  id: number;
  title: string;
  type: RevisionType;
}>;

export type RevisionPreview = Readonly<{
  features: PreviewFeatures;
  html: SafePreviewHtml;
  id: number;
}>;

export type RevisionsPort = Readonly<{
  confirmNavigation: () => boolean;
  getRevision: (revisionId: number, signal: AbortSignal) => Promise<RevisionPreview>;
  listRevisions: (signal: AbortSignal) => Promise<ReadonlyArray<RevisionSummary>>;
  openRevision: (revisionId: number) => void;
}>;
