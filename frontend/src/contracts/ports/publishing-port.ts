export type PublishingVisibility = 'password' | 'private' | 'public';

export type PublishingCapabilities = Readonly<{
  categories: boolean;
  excerpt: boolean;
  featuredImage: boolean;
  schedule: boolean;
  sticky: boolean;
  tags: boolean;
  visibility: boolean;
}>;

export type PublishingCategory = Readonly<{
  id: string;
  label: string;
  parentId: string;
}>;

export type PublishingFeaturedImage = Readonly<{
  alt: string;
  id: number;
  url: string;
}>;

export type PublishingSchedule = Readonly<{
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}>;

export type PublishingStatusOption = Readonly<{
  disabled: boolean;
  id: string;
  label: string;
}>;

export type PublishingDraft = Readonly<{
  capabilities: PublishingCapabilities;
  categories: ReadonlyArray<string>;
  excerpt: string;
  featuredImage: PublishingFeaturedImage | null;
  password: string;
  schedule: PublishingSchedule | null;
  status: string;
  sticky: boolean;
  tags: ReadonlyArray<string>;
  visibility: PublishingVisibility;
}>;

export type PublishingSnapshot = Readonly<{
  draft: PublishingDraft;
  primaryActionLabel: string;
  saveDraftActionLabel: string;
  statusOptions: ReadonlyArray<PublishingStatusOption>;
}>;

export type PublishingPort = Readonly<{
  read: () => PublishingSnapshot;
  requestSubmit: (
    draft: PublishingDraft,
    action: 'primary' | 'save-draft'
  ) => Readonly<{ status: 'requested' }>;
  selectFeaturedImage: () => Promise<PublishingFeaturedImage | null>;
}>;
