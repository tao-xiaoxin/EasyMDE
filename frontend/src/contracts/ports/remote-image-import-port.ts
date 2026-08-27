import type { ImageUploadResult } from './image-upload-port';

export type RemoteImageImportRequest = Readonly<{
  altText: string;
  postId: number;
  signal: AbortSignal;
  url: string;
}>;

export type RemoteImageImportPort = Readonly<{
  import: (request: RemoteImageImportRequest) => Promise<ImageUploadResult>;
}>;
