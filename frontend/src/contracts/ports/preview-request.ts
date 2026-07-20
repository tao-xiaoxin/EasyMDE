export type PreviewFeatures = Readonly<Record<string, boolean>>;

export type PreviewRequest = Readonly<{
  markdown: string;
  postId: number;
  markdownTheme: string;
  codeTheme: string;
  customCssId: string;
  signature: string;
}>;

export type PreviewResponse = Readonly<{
  html: string;
  features: PreviewFeatures;
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
