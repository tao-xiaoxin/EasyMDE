import type { PublishingCategory } from '../ports/publishing-port';

export type PublishingBootstrap = Readonly<{
  categoryOptions: ReadonlyArray<PublishingCategory>;
  strings: Readonly<{
    categories: string;
    close: string;
    excerpt: string;
    featuredImage: string;
    open: string;
    password: string;
    passwordRequired: string;
    privateVisibility: string;
    publicVisibility: string;
    removeFeaturedImage: string;
    schedule: string;
    selectFeaturedImage: string;
    status: string;
    sticky: string;
    submitFailed: string;
    submitting: string;
    tags: string;
    title: string;
    useFeaturedImage: string;
    visibility: string;
    passwordVisibility: string;
  }>;
  timeZone: string;
}>;

const STRING_KEYS = [
  'categories', 'close', 'excerpt', 'featuredImage', 'open', 'password',
  'passwordRequired', 'privateVisibility', 'publicVisibility', 'removeFeaturedImage',
  'schedule', 'selectFeaturedImage', 'status', 'sticky', 'submitFailed',
  'submitting', 'tags', 'title', 'useFeaturedImage', 'visibility', 'passwordVisibility'
] as const;

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error('publishing-bootstrap-invalid');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, allowEmpty = false): string {
  if ('string' !== typeof value || value.length > 512 || (!allowEmpty && !value.trim())) {
    throw new Error('publishing-bootstrap-invalid');
  }
  return value;
}

export function parsePublishingBootstrap(value: unknown): PublishingBootstrap {
  const source = objectValue(value);
  const strings = objectValue(source.strings);
  if (!Array.isArray(source.categoryOptions) || source.categoryOptions.length > 10000) {
    throw new Error('publishing-bootstrap-invalid');
  }
  const seen = new Set<string>();
  const categoryOptions = source.categoryOptions.map((value) => {
    const option = objectValue(value);
    const id = text(option.id);
    if (!/^\d{1,20}$/.test(id) || seen.has(id)) throw new Error('publishing-bootstrap-invalid');
    seen.add(id);
    const parentId = text(option.parentId, true);
    if (parentId && !/^\d{1,20}$/.test(parentId)) throw new Error('publishing-bootstrap-invalid');
    return { id, label: text(option.label), parentId };
  });
  const parsedStrings = Object.fromEntries(
    STRING_KEYS.map((key) => [key, text(strings[key])])
  ) as PublishingBootstrap['strings'];
  return {
    categoryOptions,
    strings: parsedStrings,
    timeZone: text(source.timeZone)
  };
}
