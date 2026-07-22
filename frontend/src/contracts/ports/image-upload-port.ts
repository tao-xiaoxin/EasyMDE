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
}>;

export type ImageUploadResult =
  | Readonly<{ alt: string; status: 'uploaded'; url: string }>
  | Readonly<{ code: string; status: 'failed' }>;

export type ImageUploadPort = Readonly<{
  upload: (request: ImageUploadRequest) => Promise<ImageUploadResult>;
}>;
