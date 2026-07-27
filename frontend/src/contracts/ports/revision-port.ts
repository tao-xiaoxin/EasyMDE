import type { PreviewFeatures, SafePreviewHtml } from './preview-request';

export type RevisionSummary = Readonly<{
  date: string;
  dateLabel: string;
  id: number;
  restoreUrl: string;
  title: string;
  type: 'auto' | 'manual';
}>;

export type RevisionPreview = Readonly<{
  features: PreviewFeatures;
  html: SafePreviewHtml;
  id: number;
}>;

export type RevisionPort = Readonly<{
  get: (revisionId: number, signal: AbortSignal) => Promise<RevisionPreview>;
  list: (signal: AbortSignal) => Promise<ReadonlyArray<RevisionSummary>>;
}>;
