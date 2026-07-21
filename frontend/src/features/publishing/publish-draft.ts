import type {
  PublishingCategory,
  PublishingDraft,
  PublishingFeaturedImage,
  PublishingSchedule,
  PublishingSnapshot,
  PublishingStatusOption,
  PublishingVisibility
} from '../../contracts/ports/publishing-port';

export type OrderedPublishingCategory = Readonly<{
  depth: number;
  option: PublishingCategory;
}>;

export type PublishingDraftError =
  | 'publishing-password-required'
  | 'publishing-schedule-invalid'
  | 'publishing-status-invalid';

function uniqueStrings(values: ReadonlyArray<string>, caseInsensitive = false): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value).trim();
    const key = caseInsensitive ? normalized.toLocaleLowerCase() : normalized;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function featuredImage(value: PublishingFeaturedImage | null): PublishingFeaturedImage | null {
  return value && Number.isInteger(value.id) && value.id > 0
    ? { alt: String(value.alt), id: value.id, url: String(value.url) }
    : null;
}

function schedule(value: PublishingSchedule | null): PublishingSchedule | null {
  return value ? { ...value } : null;
}

export function orderPublishingCategories(
  options: ReadonlyArray<PublishingCategory>
): ReadonlyArray<OrderedPublishingCategory> {
  const byId = new Map(options.map((option) => [option.id, option]));
  const children = new Map<string, PublishingCategory[]>();
  const roots: PublishingCategory[] = [];
  for (const option of options) {
    if (!option.parentId || option.parentId === option.id || !byId.has(option.parentId)) {
      roots.push(option);
      continue;
    }
    const siblings = children.get(option.parentId) ?? [];
    siblings.push(option);
    children.set(option.parentId, siblings);
  }

  const result: OrderedPublishingCategory[] = [];
  const visited = new Set<string>();
  const append = (root: PublishingCategory, depth: number) => {
    const stack: Array<OrderedPublishingCategory> = [{ depth, option: root }];
    while (stack.length) {
      const current = stack.pop();
      if (!current || visited.has(current.option.id)) continue;
      visited.add(current.option.id);
      result.push(current);
      const descendants = children.get(current.option.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child && !visited.has(child.id)) {
          stack.push({ depth: current.depth + 1, option: child });
        }
      }
    }
  };

  for (const root of roots) append(root, 0);
  for (const option of options) append(option, 0);
  return result;
}

export function createPublishingDraft(snapshot: PublishingSnapshot): PublishingDraft {
  const visibility: PublishingVisibility = snapshot.draft.visibility;
  return {
    capabilities: { ...snapshot.draft.capabilities },
    categories: uniqueStrings(snapshot.draft.categories),
    excerpt: String(snapshot.draft.excerpt),
    featuredImage: featuredImage(snapshot.draft.featuredImage),
    password: 'password' === visibility ? String(snapshot.draft.password) : '',
    schedule: schedule(snapshot.draft.schedule),
    status: String(snapshot.draft.status),
    sticky: 'public' === visibility && snapshot.draft.sticky,
    tags: uniqueStrings(snapshot.draft.tags, true),
    visibility
  };
}

function validSchedule(value: PublishingSchedule): boolean {
  const { day, hour, minute, month, year } = value;
  if (
    !Number.isInteger(year) || year < 1970 || year > 9999
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > 31
    || !Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59
  ) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validatePublishingDraft(
  draft: PublishingDraft,
  statusOptions: ReadonlyArray<PublishingStatusOption>
): PublishingDraftError | null {
  if (!statusOptions.some((option) => option.id === draft.status && !option.disabled)) {
    return 'publishing-status-invalid';
  }
  if ('password' === draft.visibility && !draft.password.trim()) {
    return 'publishing-password-required';
  }
  if (draft.schedule && !validSchedule(draft.schedule)) {
    return 'publishing-schedule-invalid';
  }
  return null;
}

export function updatePublishingVisibility(
  draft: PublishingDraft,
  visibility: PublishingVisibility
): PublishingDraft {
  return {
    ...draft,
    password: 'password' === visibility ? draft.password : '',
    sticky: 'public' === visibility && draft.sticky,
    visibility
  };
}
