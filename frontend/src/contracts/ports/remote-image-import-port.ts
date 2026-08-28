export type RemoteImageImportRequest = Readonly<{
  altText: string;
  postId: number;
  signal: AbortSignal;
  url: string;
}>;

export type RemoteImageImportResult =
  | Readonly<{
      alt: string;
      backup: Readonly<{ status: 'disabled' | 'uploaded' }>;
      status: 'imported';
      title: string;
      url: string;
    }>
  | Readonly<{
      alt: string;
      status: 'unchanged';
      title: string;
      url: string;
    }>
  | Readonly<{ code: string; status: 'failed' }>;

export type RemoteImageImportPort = Readonly<{
  import: (request: RemoteImageImportRequest) => Promise<RemoteImageImportResult>;
}>;
