export type ImageUploadSelection = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;
export type ImageUploadDocumentSnapshot = Readonly<{
  selection: ImageUploadSelection;
  value: string;
}>;

export type ImageUploadDocumentPort = Readonly<{
  applyTextChange: (change: ImageUploadDocumentSnapshot) => void;
  focus: () => void;
  getSnapshot: () => ImageUploadDocumentSnapshot;
}>;

export type ImageUploadRequest = Readonly<{
  altText: string;
  file: File;
  postId: number;
  signal: AbortSignal;
}>;

export type ImageUploadFailureSideEffects = 'none' | 'uploads-may-remain';
export type ImageUploadTransportCategory = 'abort' | 'http' | 'network' | 'unknown';
export type ImageUploadFailureDiagnostic = Readonly<{
  cancelled: boolean;
  durationMs: number;
  operationId: number;
  status: number | null;
  transportCategory: ImageUploadTransportCategory;
}>;

export type ImageUploadResult =
  | Readonly<{
      alt: string;
      status: 'uploaded';
      title: string;
      url: string;
    }>
  | Readonly<{
      code: string;
      diagnostic?: ImageUploadFailureDiagnostic;
      sideEffects?: ImageUploadFailureSideEffects;
      status: 'failed';
    }>;

export type ImageUploadPort = Readonly<{
  upload: (request: ImageUploadRequest) => Promise<ImageUploadResult>;
}>;
