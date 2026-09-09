export type PreviewFeatures = Readonly<Record<string, boolean>>;

/**
 * Bound the amount of untrusted metadata the browser will retain for one
 * Preview response. This still leaves room for the supported long-document
 * editor while preventing an accidentally or maliciously oversized sidecar
 * from becoming a client-side allocation hazard.
 */
export const MAX_PREVIEW_EDIT_MAP_BLOCKS = 50_000;

export type PreviewEditMapBlock = Readonly<{
  id: string;
  startLine: number;
  endLine: number;
  editable: boolean;
}>;

export type PreviewEditMap = Readonly<{
  version: 1;
  coordinate: 'line';
  signature: string;
  blocks: ReadonlyArray<PreviewEditMapBlock>;
}>;

const PROTOTYPE_RESERVED_FEATURE_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype'
]);

export function isPreviewFeatureKey(key: string): boolean {
  return !PROTOTYPE_RESERVED_FEATURE_KEYS.has(key);
}

declare const safePreviewHtmlBrand: unique symbol;

export type SafePreviewHtml = string & Readonly<{ [safePreviewHtmlBrand]: true }>;

export type PreviewRequest = Readonly<{
  markdown: string;
  postId: number;
  markdownTheme: string;
  codeTheme: string;
  customCssId: string;
  signature: string;
}>;

export type PreviewResponse = Readonly<{
  html: SafePreviewHtml;
  features: PreviewFeatures;
  editMap?: PreviewEditMap;
}>;

export type PreviewRequestPort = Readonly<{
  render: (request: PreviewRequest, signal: AbortSignal) => Promise<PreviewResponse>;
}>;

export type PreviewRequestState =
  | Readonly<{ kind: 'loading'; request: PreviewRequest; revision: number }>
  | Readonly<{ kind: 'empty'; request: PreviewRequest; revision: number }>
  | Readonly<{
      kind: 'success';
      request: PreviewRequest;
      response: PreviewResponse;
      revision: number;
    }>
  | Readonly<{ kind: 'error'; request: PreviewRequest; revision: number }>;
