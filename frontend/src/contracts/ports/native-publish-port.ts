export type NativePublishVisibility = 'public' | 'password' | 'private';

export type NativePublishCategory = Readonly<{
  children: ReadonlyArray<NativePublishCategory>;
  id: string;
  label: string;
}>;

export type NativeFeaturedImage = Readonly<{
  alt: string;
  id: number;
  url: string;
}>;

export type NativePublishDraft = Readonly<{
  categoryIds: ReadonlyArray<string>;
  excerpt: string;
  featuredImage: NativeFeaturedImage | null;
  openPreview: boolean;
  password: string;
  sticky: boolean;
  tags: ReadonlyArray<string>;
  visibility: NativePublishVisibility;
}>;

export type NativePublishFieldAvailability = Readonly<{
  categories: boolean;
  excerpt: boolean;
  featuredImage: boolean;
  sticky: boolean;
  tags: boolean;
  visibility: boolean;
}>;

export type NativePublishSnapshot = NativePublishDraft & Readonly<{
  availableFields: NativePublishFieldAvailability;
  categories: ReadonlyArray<NativePublishCategory>;
  existing: boolean;
}>;

export interface NativePublishPort {
  apply(draft: NativePublishDraft): void;
  read(): NativePublishSnapshot;
}
