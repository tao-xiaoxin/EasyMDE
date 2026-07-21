import type {
  PublishingCapabilities,
  PublishingDraft,
  PublishingFeaturedImage,
  PublishingPort,
  PublishingSchedule,
  PublishingVisibility
} from '../../../contracts/ports/publishing-port';

type WordPressMediaFrame = Readonly<{
  on: (name: string, callback: () => void) => void;
  open: () => void;
  state: () => unknown;
}>;

type WordPressMediaFactory = (options: Readonly<{
  button: Readonly<{ text: string }>;
  library: Readonly<{ type: 'image' }>;
  multiple: false;
  title: string;
}>) => unknown;

type PublishingPortOptions = Readonly<{
  document: Document;
  media?: unknown;
  selectFeaturedImage: string;
  useFeaturedImage: string;
}>;

function input(doc: Document, selector: string): HTMLInputElement | null {
  const node = doc.querySelector(selector);
  return node instanceof HTMLInputElement ? node : null;
}

function textField(doc: Document, selector: string): HTMLInputElement | HTMLTextAreaElement | null {
  const node = doc.querySelector(selector);
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node : null;
}

function select(doc: Document, selector: string): HTMLSelectElement | null {
  const node = doc.querySelector(selector);
  return node instanceof HTMLSelectElement ? node : null;
}

function dateField(doc: Document, selector: string): HTMLInputElement | HTMLSelectElement | null {
  return input(doc, selector) ?? select(doc, selector);
}

function isWritable(
  field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
): field is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return Boolean(field && !field.disabled && !(
    (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.readOnly
  ));
}

function actionLabel(node: HTMLElement | null): string {
  if (node instanceof HTMLInputElement) return node.value.trim();
  return node?.textContent?.trim() ?? '';
}

function capabilities(doc: Document): PublishingCapabilities {
  const categoryFields = Array.from(
    doc.querySelectorAll<HTMLInputElement>('#categorychecklist input[type="checkbox"]')
  );
  return {
    categories: 0 < categoryFields.length && categoryFields.every(isWritable),
    excerpt: isWritable(textField(doc, '#excerpt')),
    featuredImage: isWritable(input(doc, '#_thumbnail_id')),
    schedule: ['#aa', '#mm', '#jj', '#hh', '#mn'].every((selector) => isWritable(dateField(doc, selector))),
    sticky: isWritable(input(doc, '#sticky')),
    tags: isWritable(textField(doc, '#tax-input-post_tag')),
    visibility: ['#visibility-radio-public', '#visibility-radio-password', '#visibility-radio-private', '#post_password']
      .every((selector) => isWritable(input(doc, selector)))
  };
}

function visibility(doc: Document): Readonly<{
  password: string;
  sticky: boolean;
  visibility: PublishingVisibility;
}> {
  const current: PublishingVisibility = input(doc, '#visibility-radio-password')?.checked
    ? 'password'
    : input(doc, '#visibility-radio-private')?.checked ? 'private' : 'public';
  return {
    password: 'password' === current ? input(doc, '#post_password')?.value ?? '' : '',
    sticky: 'public' === current && Boolean(input(doc, '#sticky')?.checked),
    visibility: current
  };
}

function integerValue(field: HTMLInputElement | HTMLSelectElement | null, code: string): number {
  const value = Number(field?.value);
  if (!Number.isInteger(value)) throw new Error(code);
  return value;
}

function schedule(doc: Document, available: boolean): PublishingSchedule | null {
  if (!available) return null;
  return {
    day: integerValue(dateField(doc, '#jj'), 'publishing-native-schedule-invalid'),
    hour: integerValue(dateField(doc, '#hh'), 'publishing-native-schedule-invalid'),
    minute: integerValue(dateField(doc, '#mn'), 'publishing-native-schedule-invalid'),
    month: integerValue(dateField(doc, '#mm'), 'publishing-native-schedule-invalid'),
    year: integerValue(dateField(doc, '#aa'), 'publishing-native-schedule-invalid')
  };
}

function dispatchChange(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function assertCapabilities(expected: PublishingCapabilities, current: PublishingCapabilities): void {
  for (const name of Object.keys(expected) as Array<keyof PublishingCapabilities>) {
    if (expected[name] && !current[name]) {
      throw new Error(`publishing-native-${name}-unavailable`);
    }
  }
}

function applyVisibility(doc: Document, draft: PublishingDraft): HTMLInputElement {
  const fields = {
    password: input(doc, '#visibility-radio-password'),
    private: input(doc, '#visibility-radio-private'),
    public: input(doc, '#visibility-radio-public')
  };
  const password = input(doc, '#post_password');
  if (!fields.password || !fields.private || !fields.public || !password) {
    throw new Error('publishing-native-visibility-unavailable');
  }
  const availableFields: Record<PublishingVisibility, HTMLInputElement> = {
    password: fields.password,
    private: fields.private,
    public: fields.public
  };
  for (const [name, field] of Object.entries(availableFields)) {
    field.checked = name === draft.visibility;
  }
  password.value = 'password' === draft.visibility ? draft.password : '';
  const sticky = input(doc, '#sticky');
  if (draft.capabilities.sticky && sticky) {
    sticky.checked = 'public' === draft.visibility && draft.sticky;
  }
  return availableFields[draft.visibility];
}

function frameValue(value: unknown): WordPressMediaFrame {
  if (!value || 'object' !== typeof value) throw new Error('publishing-media-frame-invalid');
  const frame = value as Partial<WordPressMediaFrame>;
  if ('function' !== typeof frame.on || 'function' !== typeof frame.open || 'function' !== typeof frame.state) {
    throw new Error('publishing-media-frame-invalid');
  }
  return frame as WordPressMediaFrame;
}

function selectedImage(frame: WordPressMediaFrame): PublishingFeaturedImage {
  const state = frame.state() as { get?: unknown } | null;
  const selection = state && 'function' === typeof state.get
    ? state.get.call(state, 'selection') as { first?: unknown } | null
    : null;
  const attachment = selection && 'function' === typeof selection.first
    ? selection.first.call(selection) as { toJSON?: unknown } | null
    : null;
  const raw = attachment && 'function' === typeof attachment.toJSON
    ? attachment.toJSON.call(attachment) as Record<string, unknown>
    : null;
  if (!raw || !Number.isInteger(raw.id) || Number(raw.id) <= 0) {
    throw new Error('publishing-media-selection-invalid');
  }
  return {
    alt: 'string' === typeof raw.alt ? raw.alt : 'string' === typeof raw.title ? raw.title : '',
    id: Number(raw.id),
    url: 'string' === typeof raw.url ? raw.url : ''
  };
}

export function createWordPressPublishingPort(options: PublishingPortOptions): PublishingPort {
  const doc = options.document;
  if (!(doc instanceof Document)) throw new Error('publishing-document-invalid');

  return {
    read() {
      const status = select(doc, '#post_status');
      const primary = doc.querySelector<HTMLElement>('#publish');
      if (!status || !primary) throw new Error('publishing-native-core-unavailable');
      const currentCapabilities = capabilities(doc);
      const currentVisibility = visibility(doc);
      const featuredId = Number(input(doc, '#_thumbnail_id')?.value);
      const featuredPreview = doc.querySelector<HTMLImageElement>('#postimagediv .inside img');
      return {
        draft: {
          capabilities: currentCapabilities,
          categories: Array.from(doc.querySelectorAll<HTMLInputElement>('#categorychecklist input[type="checkbox"]:checked'))
            .map((field) => field.value).filter(Boolean),
          excerpt: textField(doc, '#excerpt')?.value ?? '',
          featuredImage: Number.isInteger(featuredId) && featuredId > 0 ? {
            alt: featuredPreview?.alt ?? '', id: featuredId, url: featuredPreview?.src ?? ''
          } : null,
          password: currentVisibility.password,
          schedule: schedule(doc, currentCapabilities.schedule),
          status: status.value,
          sticky: currentVisibility.sticky,
          tags: (textField(doc, '#tax-input-post_tag')?.value ?? '').split(/[,，\n]+/),
          visibility: currentVisibility.visibility
        },
        primaryActionLabel: actionLabel(primary),
        saveDraftActionLabel: actionLabel(doc.querySelector<HTMLElement>('#save-post')),
        statusOptions: Array.from(status.options).map((option) => ({
          disabled: option.disabled,
          id: option.value,
          label: option.textContent?.trim() || option.value
        }))
      };
    },

    requestSubmit(draft, action) {
      const currentCapabilities = capabilities(doc);
      const status = select(doc, '#post_status');
      const button = doc.querySelector<HTMLElement>('save-draft' === action ? '#save-post' : '#publish');
      assertCapabilities(draft.capabilities, currentCapabilities);
      if (!isWritable(status) || !Array.from(status.options).some(
        (option) => option.value === draft.status && !option.disabled
      )) {
        throw new Error('publishing-native-status-unavailable');
      }
      if (!button || button.matches(':disabled, [aria-disabled="true"]')) {
        throw new Error('publishing-native-action-unavailable');
      }
      if (draft.capabilities.schedule && !draft.schedule) {
        throw new Error('publishing-native-schedule-unavailable');
      }

      const changedFields: Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = [];
      if (draft.capabilities.visibility) changedFields.push(applyVisibility(doc, draft));
      status.value = draft.status;
      changedFields.push(status);
      if (draft.capabilities.schedule && draft.schedule) {
        const values = {
          '#aa': draft.schedule.year,
          '#mm': draft.schedule.month,
          '#jj': draft.schedule.day,
          '#hh': draft.schedule.hour,
          '#mn': draft.schedule.minute
        } as const;
        for (const [selector, value] of Object.entries(values)) {
          const field = dateField(doc, selector);
          if (!field) throw new Error('publishing-native-schedule-unavailable');
          field.value = String(value).padStart(2, '0');
          changedFields.push(field);
        }
      }
      if (draft.capabilities.categories) {
        const selected = new Set(draft.categories);
        for (const field of doc.querySelectorAll<HTMLInputElement>('#categorychecklist input[type="checkbox"], #categorychecklist-pop input[type="checkbox"]')) {
          field.checked = selected.has(field.value);
        }
      }
      const tags = textField(doc, '#tax-input-post_tag');
      if (draft.capabilities.tags && tags) {
        tags.value = draft.tags.join(', ');
        changedFields.push(tags);
      }
      const excerpt = textField(doc, '#excerpt');
      if (draft.capabilities.excerpt && excerpt) {
        excerpt.value = draft.excerpt;
        changedFields.push(excerpt);
      }
      const featured = input(doc, '#_thumbnail_id');
      if (draft.capabilities.featuredImage && featured) {
        featured.value = draft.featuredImage ? String(draft.featuredImage.id) : '-1';
        changedFields.push(featured);
      }

      for (const field of changedFields) dispatchChange(field);
      if (!button.isConnected || button.matches(':disabled, [aria-disabled="true"]')) {
        throw new Error('publishing-native-action-unavailable');
      }
      button.click();
      return { status: 'requested' };
    },

    selectFeaturedImage() {
      if ('function' !== typeof options.media) {
        return Promise.reject(new Error('publishing-featured-image-unavailable'));
      }
      const media = options.media as WordPressMediaFactory;
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (value: PublishingFeaturedImage | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        try {
          const frame = frameValue(media({
            button: { text: options.useFeaturedImage },
            library: { type: 'image' },
            multiple: false,
            title: options.selectFeaturedImage
          }));
          frame.on('select', () => {
            try {
              settle(selectedImage(frame));
            } catch (error) {
              if (!settled) {
                settled = true;
                reject(error);
              }
            }
          });
          frame.on('close', () => settle(null));
          frame.open();
        } catch (error) {
          reject(error);
        }
      });
    }
  };
}
