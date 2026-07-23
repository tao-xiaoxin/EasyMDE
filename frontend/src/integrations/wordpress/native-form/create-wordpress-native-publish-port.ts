import type {
  NativeFeaturedImage,
  NativePublishCategory,
  NativePublishDraft,
  NativePublishPort,
  NativePublishSnapshot,
  NativePublishVisibility
} from '../../../contracts/ports/native-publish-port';

function inputs(documentRef: Document): ReadonlyArray<HTMLInputElement> {
  return Array.from(
    documentRef.querySelectorAll<HTMLInputElement>(
      '#categorychecklist input[name="post_category[]"]'
    )
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

function tags(documentRef: Document): ReadonlyArray<string> {
  const field = documentRef.querySelector<HTMLInputElement>(
    '#tax-input-post_tag'
  );
  if (!field?.value.trim()) return [];
  return field.value
    .split(/[,，、\n]/u)
    .map((tag) => tag.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function visibility(documentRef: Document): NativePublishVisibility {
  if (
    documentRef.querySelector<HTMLInputElement>('#visibility-radio-private')
      ?.checked
  ) {
    return 'private';
  }
  const password = documentRef.querySelector<HTMLInputElement>('#post_password');
  if (
    documentRef.querySelector<HTMLInputElement>('#visibility-radio-password')
      ?.checked ||
    password?.value
  ) {
    return 'password';
  }
  return 'public';
}

function featuredImage(documentRef: Document): NativeFeaturedImage | null {
  const field = documentRef.querySelector<HTMLInputElement>('#_thumbnail_id');
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

export function createWordPressNativePublishPort(
  documentRef: Document
): NativePublishPort {
  let tagDelimiter = ',';
  return {
    read(): NativePublishSnapshot {
      const tagField = documentRef.querySelector<HTMLInputElement>(
        '#tax-input-post_tag'
      );
      if (tagField?.value.includes('、')) tagDelimiter = '、';
      else if (tagField?.value.includes('，')) tagDelimiter = '，';
      const status =
        documentRef.querySelector<HTMLInputElement>('#original_post_status')
          ?.value ??
        documentRef.querySelector<HTMLInputElement>('#post_status')?.value ??
        '';
      return {
        categories: categories(documentRef),
        categoryIds: inputs(documentRef)
          .filter((input) => input.checked)
          .map((input) => input.value),
        excerpt:
          documentRef.querySelector<HTMLTextAreaElement>('#excerpt')?.value ?? '',
        featuredImage: featuredImage(documentRef),
        password:
          documentRef.querySelector<HTMLInputElement>('#post_password')?.value ??
          '',
        published: 'publish' === status,
        sticky:
          documentRef.querySelector<HTMLInputElement>('#sticky')?.checked ?? false,
        tags: tags(documentRef),
        visibility: visibility(documentRef)
      };
    },
    apply(draft: NativePublishDraft): void {
      const selected = new Set(draft.categoryIds);
      for (const input of inputs(documentRef)) {
        setChecked(input, selected.has(input.value));
      }
      setValue(
        documentRef.querySelector<HTMLInputElement>('#tax-input-post_tag'),
        draft.tags.join(tagDelimiter)
      );
      setValue(
        documentRef.querySelector<HTMLTextAreaElement>('#excerpt'),
        draft.excerpt
      );
      setValue(
        documentRef.querySelector<HTMLInputElement>('#_thumbnail_id'),
        draft.featuredImage ? String(draft.featuredImage.id) : '-1'
      );
      setChecked(
        documentRef.querySelector<HTMLInputElement>('#visibility-radio-public'),
        'public' === draft.visibility
      );
      setChecked(
        documentRef.querySelector<HTMLInputElement>('#visibility-radio-password'),
        'password' === draft.visibility
      );
      setChecked(
        documentRef.querySelector<HTMLInputElement>('#visibility-radio-private'),
        'private' === draft.visibility
      );
      setValue(
        documentRef.querySelector<HTMLInputElement>('#post_password'),
        'password' === draft.visibility ? draft.password : ''
      );
      setChecked(
        documentRef.querySelector<HTMLInputElement>('#sticky'),
        'public' === draft.visibility && draft.sticky
      );
    }
  };
}
