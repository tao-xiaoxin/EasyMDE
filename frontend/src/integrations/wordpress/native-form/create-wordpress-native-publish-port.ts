import type {
  NativeFeaturedImage,
  NativePublishCategory,
  NativePublishDraft,
  NativePublishFieldAvailability,
  NativePublishPort,
  NativePublishSnapshot,
  NativePublishVisibility
} from '../../../contracts/ports/native-publish-port';

const OPEN_PUBLISHED_POST_FIELD = 'easymde_open_published_post';

function postForm(documentRef: Document): HTMLFormElement | null {
  const form = documentRef.querySelector('#post');
  return form instanceof HTMLFormElement ? form : null;
}

function ownedInput(
  documentRef: Document,
  selector: string,
  name: string
): HTMLInputElement | null {
  const candidate = documentRef.querySelector(selector);
  const form = postForm(documentRef);
  return candidate instanceof HTMLInputElement &&
    form &&
    candidate.form === form &&
    !candidate.disabled &&
    candidate.name === name
    ? candidate
    : null;
}

function ownedTextarea(
  documentRef: Document,
  selector: string,
  name: string
): HTMLTextAreaElement | null {
  const candidate = documentRef.querySelector(selector);
  const form = postForm(documentRef);
  return candidate instanceof HTMLTextAreaElement &&
    form &&
    candidate.form === form &&
    !candidate.disabled &&
    candidate.name === name
    ? candidate
    : null;
}

function ownedTextControl(
  documentRef: Document,
  selector: string,
  name: string
): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    ownedInput(documentRef, selector, name) ??
    ownedTextarea(documentRef, selector, name)
  );
}

function inputs(documentRef: Document): ReadonlyArray<HTMLInputElement> {
  const form = postForm(documentRef);
  if (!form) return [];
  return Array.from(
    documentRef.querySelectorAll(
      '#categorychecklist input[name="post_category[]"]'
    )
  ).filter(
    (candidate): candidate is HTMLInputElement =>
      candidate instanceof HTMLInputElement &&
      candidate.form === form &&
      !candidate.disabled
  );
}

function labelText(input: HTMLInputElement): string {
  const label = input.closest('label');
  if (!label) throw new Error('native-publish-category-label-unavailable');
  const text = Array.from(label.childNodes)
    .filter((node) => node !== input)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) throw new Error('native-publish-category-label-unavailable');
  return text;
}

function categoryNode(item: HTMLLIElement): NativePublishCategory | null {
  const input = Array.from(item.children)
    .flatMap((child) =>
      child instanceof HTMLLabelElement
        ? Array.from(child.querySelectorAll<HTMLInputElement>('input'))
        : []
    )
    .find((candidate) => 'post_category[]' === candidate.name);
  if (!input?.value) return null;
  const childList = Array.from(item.children).find(
    (child): child is HTMLUListElement => child instanceof HTMLUListElement
  );
  const children = childList
    ? Array.from(childList.children).flatMap((child) => {
        if (!(child instanceof HTMLLIElement)) return [];
        const node = categoryNode(child);
        return node ? [node] : [];
      })
    : [];
  return { children, id: input.value, label: labelText(input) };
}

function categories(documentRef: Document): ReadonlyArray<NativePublishCategory> {
  const list = documentRef.querySelector<HTMLUListElement>('#categorychecklist');
  if (!list) return [];
  return Array.from(list.children).flatMap((child) => {
    if (!(child instanceof HTMLLIElement)) return [];
    const node = categoryNode(child);
    return node ? [node] : [];
  });
}

function availableCategories(
  projected: ReadonlyArray<NativePublishCategory>,
  availableIds: ReadonlySet<string>
): ReadonlyArray<NativePublishCategory> {
  return projected.flatMap((category) => {
    const children = availableCategories(category.children, availableIds);
    if (!availableIds.has(category.id)) return children;
    return [{ ...category, children }];
  });
}

function tags(documentRef: Document): ReadonlyArray<string> {
  const field = ownedTextControl(
    documentRef,
    '#tax-input-post_tag',
    'tax_input[post_tag]'
  );
  if (!field?.value.trim()) return [];
  return field.value
    .split(/[,，、\n]/u)
    .map((tag) => tag.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function visibility(documentRef: Document): NativePublishVisibility {
  if (
    ownedInput(
      documentRef,
      '#visibility-radio-private',
      'visibility'
    )?.checked
  ) {
    return 'private';
  }
  const password = ownedInput(
    documentRef,
    '#post_password',
    'post_password'
  );
  if (
    ownedInput(
      documentRef,
      '#visibility-radio-password',
      'visibility'
    )?.checked ||
    password?.value
  ) {
    return 'password';
  }
  return 'public';
}

function featuredImage(documentRef: Document): NativeFeaturedImage | null {
  const field = ownedInput(
    documentRef,
    '#_thumbnail_id',
    '_thumbnail_id'
  );
  const id = Number(field?.value);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const image = documentRef.querySelector<HTMLImageElement>(
    '#postimagediv .inside img'
  );
  return {
    alt: image?.alt ?? '',
    id,
    url: image?.currentSrc || image?.src || ''
  };
}

function availableFields(documentRef: Document): NativePublishFieldAvailability {
  return {
    categories: inputs(documentRef).length > 0,
    excerpt: null !== ownedTextarea(documentRef, '#excerpt', 'excerpt'),
    featuredImage:
      null !== ownedInput(documentRef, '#_thumbnail_id', '_thumbnail_id'),
    sticky: null !== ownedInput(documentRef, '#sticky', 'sticky'),
    tags:
      null !==
      ownedTextControl(
        documentRef,
        '#tax-input-post_tag',
        'tax_input[post_tag]'
      ),
    visibility:
      null !==
        ownedInput(documentRef, '#visibility-radio-public', 'visibility') &&
      null !==
        ownedInput(documentRef, '#visibility-radio-password', 'visibility') &&
      null !==
        ownedInput(documentRef, '#visibility-radio-private', 'visibility') &&
      null !== ownedInput(documentRef, '#post_password', 'post_password')
  };
}

function requireOwner(
  owner: keyof NativePublishFieldAvailability,
  available: boolean,
  previouslyAvailable: boolean,
  hasRequestedValue: boolean
): void {
  if (!available && (previouslyAvailable || hasRequestedValue)) {
    throw new Error(`native-publish-${owner}-owner-unavailable`);
  }
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string
): void {
  if (!element || element.value === value) return;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChecked(element: HTMLInputElement | null, checked: boolean): void {
  if (!element || element.checked === checked) return;
  element.checked = checked;
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setOpenPreview(documentRef: Document, enabled: boolean): void {
  const existing = documentRef.querySelector<HTMLInputElement>(
    `input[name="${OPEN_PUBLISHED_POST_FIELD}"]`
  );
  if (!enabled) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.value = '1';
    return;
  }
  const form = postForm(documentRef);
  if (!form) throw new Error('native-publish-form-unavailable');
  const field = documentRef.createElement('input');
  field.type = 'hidden';
  field.name = OPEN_PUBLISHED_POST_FIELD;
  field.value = '1';
  form.append(field);
}

export function createWordPressNativePublishPort(
  documentRef: Document,
  publishCategories?: ReadonlyArray<NativePublishCategory>
): NativePublishPort {
  let tagDelimiter = ',';
  let lastAvailableFields: NativePublishFieldAvailability | null = null;
  return {
    read(): NativePublishSnapshot {
      const tagField = ownedTextControl(
        documentRef,
        '#tax-input-post_tag',
        'tax_input[post_tag]'
      );
      if (tagField?.value.includes('、')) tagDelimiter = '、';
      else if (tagField?.value.includes('，')) tagDelimiter = '，';
      const status =
        documentRef.querySelector<HTMLInputElement>('#original_post_status')
          ?.value ??
        documentRef.querySelector<HTMLInputElement>('#post_status')?.value ??
        '';
      const categoryInputs = inputs(documentRef);
      const nativeCategories = categories(documentRef);
      const currentAvailableFields = availableFields(documentRef);
      lastAvailableFields = currentAvailableFields;
      return {
        availableFields: currentAvailableFields,
        categories: categoryInputs.length
          ? availableCategories(
              publishCategories ?? nativeCategories,
              new Set(categoryInputs.map((input) => input.value))
            )
          : [],
        categoryIds: categoryInputs
          .filter((input) => input.checked)
          .map((input) => input.value),
        excerpt:
          ownedTextarea(documentRef, '#excerpt', 'excerpt')?.value ?? '',
        featuredImage: featuredImage(documentRef),
        openPreview:
          '1' ===
          documentRef.querySelector<HTMLInputElement>(
            `input[name="${OPEN_PUBLISHED_POST_FIELD}"]`
          )?.value,
        password:
          ownedInput(documentRef, '#post_password', 'post_password')?.value ?? '',
        existing: '' !== status && 'auto-draft' !== status,
        sticky:
          ownedInput(documentRef, '#sticky', 'sticky')?.checked ?? false,
        tags: tags(documentRef),
        visibility: visibility(documentRef)
      };
    },
    apply(draft: NativePublishDraft): void {
      const currentAvailableFields = availableFields(documentRef);
      const previous = lastAvailableFields ?? currentAvailableFields;
      const categoryInputs = inputs(documentRef);
      const availableCategoryIds = new Set(
        categoryInputs.map((input) => input.value)
      );
      const hasUnavailableCategory = draft.categoryIds.some(
        (id) => !availableCategoryIds.has(id)
      );
      requireOwner(
        'categories',
        currentAvailableFields.categories && !hasUnavailableCategory,
        previous.categories,
        draft.categoryIds.length > 0 || hasUnavailableCategory
      );
      requireOwner(
        'excerpt',
        currentAvailableFields.excerpt,
        previous.excerpt,
        '' !== draft.excerpt
      );
      requireOwner(
        'featuredImage',
        currentAvailableFields.featuredImage,
        previous.featuredImage,
        null !== draft.featuredImage
      );
      requireOwner(
        'sticky',
        currentAvailableFields.sticky,
        previous.sticky,
        draft.sticky
      );
      requireOwner(
        'tags',
        currentAvailableFields.tags,
        previous.tags,
        draft.tags.length > 0
      );
      requireOwner(
        'visibility',
        currentAvailableFields.visibility,
        previous.visibility,
        'public' !== draft.visibility || '' !== draft.password
      );
      const selected = new Set(draft.categoryIds);
      for (const input of categoryInputs) {
        setChecked(input, selected.has(input.value));
      }
      setValue(
        ownedTextControl(
          documentRef,
          '#tax-input-post_tag',
          'tax_input[post_tag]'
        ),
        draft.tags.join(tagDelimiter)
      );
      setValue(
        ownedTextarea(documentRef, '#excerpt', 'excerpt'),
        draft.excerpt
      );
      setValue(
        ownedInput(documentRef, '#_thumbnail_id', '_thumbnail_id'),
        draft.featuredImage ? String(draft.featuredImage.id) : '-1'
      );
      setChecked(
        ownedInput(documentRef, '#visibility-radio-public', 'visibility'),
        'public' === draft.visibility
      );
      setChecked(
        ownedInput(documentRef, '#visibility-radio-password', 'visibility'),
        'password' === draft.visibility
      );
      setChecked(
        ownedInput(documentRef, '#visibility-radio-private', 'visibility'),
        'private' === draft.visibility
      );
      setValue(
        ownedInput(documentRef, '#post_password', 'post_password'),
        'password' === draft.visibility ? draft.password : ''
      );
      setChecked(
        ownedInput(documentRef, '#sticky', 'sticky'),
        'public' === draft.visibility && draft.sticky
      );
      setOpenPreview(documentRef, draft.openPreview);
    }
  };
}
