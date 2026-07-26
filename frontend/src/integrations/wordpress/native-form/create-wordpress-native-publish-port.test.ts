import { beforeEach, describe, expect, it } from 'vitest';

import { createWordPressNativePublishPort } from './create-wordpress-native-publish-port';

function fixture(): void {
  document.body.innerHTML = `
    <form id="post">
    <input id="original_post_status" value="publish">
    <textarea id="tax-input-post_tag" name="tax_input[post_tag]">EasyMDE, Markdown</textarea>
    <textarea id="excerpt" name="excerpt">Synthetic excerpt</textarea>
    <ul id="categorychecklist">
      <li><label><input type="checkbox" name="post_category[]" value="2" checked> Parent</label>
        <ul><li><label><input type="checkbox" name="post_category[]" value="3"> Child</label></li></ul>
      </li>
    </ul>
    <div id="postimagediv"><div class="inside"><img src="https://example.test/image.png" alt="Featured"></div></div>
    <input id="_thumbnail_id" name="_thumbnail_id" type="hidden" value="15">
    <input id="visibility-radio-public" name="visibility" type="radio" value="public" checked>
    <input id="visibility-radio-password" name="visibility" type="radio" value="password">
    <input id="visibility-radio-private" name="visibility" type="radio" value="private">
    <input id="post_password" name="post_password" value="">
    <input id="sticky" name="sticky" type="checkbox">
    </form>
  `;
}

describe('createWordPressNativePublishPort', () => {
  beforeEach(fixture);

  it('reads the real native publish state without mutating any field', () => {
    const before = document.body.innerHTML;
    const snapshot = createWordPressNativePublishPort(document).read();

    expect(snapshot).toEqual({
      availableFields: {
        categories: true,
        excerpt: true,
        featuredImage: true,
        sticky: true,
        tags: true,
        visibility: true
      },
      categories: [
        {
          children: [{ children: [], id: '3', label: 'Child' }],
          id: '2',
          label: 'Parent'
        }
      ],
      categoryIds: ['2'],
      excerpt: 'Synthetic excerpt',
      featuredImage: {
        alt: 'Featured',
        id: 15,
        url: 'https://example.test/image.png'
      },
      password: '',
      openPreview: false,
      existing: true,
      sticky: false,
      tags: ['EasyMDE', 'Markdown'],
      visibility: 'public'
    });
    expect(document.body.innerHTML).toBe(before);
  });

  it('distinguishes a new auto-draft from every existing WordPress Post status', () => {
    const status = document.querySelector<HTMLInputElement>(
      '#original_post_status'
    );
    if (!status) throw new Error('synthetic-post-status-unavailable');
    const port = createWordPressNativePublishPort(document);

    status.value = 'auto-draft';
    expect(port.read().existing).toBe(false);

    status.value = 'draft';
    expect(port.read().existing).toBe(true);

    status.value = 'publish';
    expect(port.read().existing).toBe(true);
  });

  it('projects a confirmed draft into the existing WordPress form fields', () => {
    const port = createWordPressNativePublishPort(document);
    port.apply({
      categoryIds: ['3'],
      excerpt: 'Changed excerpt',
      featuredImage: null,
      password: 'secret',
      openPreview: true,
      sticky: true,
      tags: ['WordPress', 'React'],
      visibility: 'password'
    });

    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="post_category[]"][value="2"]'
      )?.checked
    ).toBe(false);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="post_category[]"][value="3"]'
      )?.checked
    ).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>('#tax-input-post_tag')?.value).toBe(
      'WordPress,React'
    );
    expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe(
      'Changed excerpt'
    );
    expect(document.querySelector<HTMLInputElement>('#_thumbnail_id')?.value).toBe('-1');
    expect(
      document.querySelector<HTMLInputElement>('#visibility-radio-password')
        ?.checked
    ).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#post_password')?.value).toBe(
      'secret'
    );
    expect(document.querySelector<HTMLInputElement>('#sticky')?.checked).toBe(false);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="easymde_open_published_post"]'
      )?.value
    ).toBe('1');

    port.apply({ ...port.read(), openPreview: false });
    expect(
      document.querySelector('input[name="easymde_open_published_post"]')
    ).toBeNull();
  });

  it('preserves the localized WordPress tag delimiter', () => {
    const tagField = document.querySelector<HTMLTextAreaElement>(
      '#tax-input-post_tag'
    );
    if (!tagField) throw new Error('synthetic-tag-field-unavailable');
    tagField.value = 'EasyMDE、Markdown、WordPress';
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(snapshot.tags).toEqual(['EasyMDE', 'Markdown', 'WordPress']);
    port.apply({ ...snapshot, tags: [...snapshot.tags, 'UI'] });
    expect(
      document.querySelector<HTMLTextAreaElement>('#tax-input-post_tag')?.value
    ).toBe('EasyMDE、Markdown、WordPress、UI');
  });

  it('uses the PHP hierarchy only for categories owned by native WordPress inputs', () => {
    const authoritativeCategories = [
      {
        children: [
          {
            children: [{ children: [], id: '3', label: 'Child' }],
            id: '2',
            label: 'Parent'
          }
        ],
        id: '1',
        label: 'Root'
      }
    ];
    const port = createWordPressNativePublishPort(
      document,
      authoritativeCategories
    );

    expect(port.read().categories).toEqual([
      {
        children: [{ children: [], id: '3', label: 'Child' }],
        id: '2',
        label: 'Parent'
      }
    ]);
    expect(port.read().categoryIds).toEqual(['2']);
  });

  it('removes projected categories that the native form cannot submit', () => {
    const port = createWordPressNativePublishPort(document, [
      {
        children: [
          { children: [], id: '3', label: 'Available child' },
          { children: [], id: '4', label: 'Unavailable child' }
        ],
        id: '2',
        label: 'Available parent'
      },
      { children: [], id: '5', label: 'Unavailable root' }
    ]);

    expect(port.read().categories).toEqual([
      {
        children: [{ children: [], id: '3', label: 'Available child' }],
        id: '2',
        label: 'Available parent'
      }
    ]);
  });

  it('does not expose projected categories when WordPress has no category form owner', () => {
    document.querySelector('#categorychecklist')?.remove();
    const port = createWordPressNativePublishPort(document, [
      { children: [], id: '2', label: 'Unavailable category' }
    ]);

    expect(port.read().categories).toEqual([]);
    expect(port.read().categoryIds).toEqual([]);
  });

  it('reports unavailable native owners separately from empty native values', () => {
    document.querySelector('#categorychecklist')?.remove();
    document.querySelector('#tax-input-post_tag')?.remove();
    document.querySelector('#excerpt')?.remove();
    document.querySelector('#postimagediv')?.remove();
    document.querySelector('#_thumbnail_id')?.remove();
    document.querySelector('#sticky')?.remove();

    expect(createWordPressNativePublishPort(document).read().availableFields).toEqual({
      categories: false,
      excerpt: false,
      featuredImage: false,
      sticky: false,
      tags: false,
      visibility: true
    });
  });

  it('rejects a mutation whose native WordPress owner disappeared', () => {
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();
    document.querySelector('#tax-input-post_tag')?.remove();

    expect(() =>
      port.apply({ ...snapshot, tags: [...snapshot.tags, 'Unsaved'] })
    ).toThrowError('native-publish-tags-owner-unavailable');
  });

  it('does not expose or mutate a disabled native field that form submission omits', () => {
    const tagField = document.querySelector<HTMLTextAreaElement>(
      '#tax-input-post_tag'
    );
    if (!tagField) throw new Error('synthetic-tag-field-unavailable');
    tagField.disabled = true;
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(snapshot.availableFields.tags).toBe(false);
    expect(new FormData(document.querySelector('form') ?? undefined).has(
      'tax_input[post_tag]'
    )).toBe(false);
    expect(() => port.apply({ ...snapshot, tags: ['Unsaved'] })).toThrowError(
      'native-publish-tags-owner-unavailable'
    );
    expect(tagField.value).toBe('EasyMDE, Markdown');
  });

  it.each([
    ['categories', 'input[name="post_category[]"]', 'text', 'post_category[]'],
    ['featuredImage', '#_thumbnail_id', 'checkbox', '_thumbnail_id'],
    ['sticky', '#sticky', 'text', 'sticky'],
    ['visibility', '#visibility-radio-public', 'text', 'visibility'],
    ['visibility', '#post_password', 'checkbox', 'post_password']
  ] as const)(
    'rejects a %s owner whose input type changes native submission semantics',
    (owner, selector, type, formField) => {
      const fields = Array.from(
        document.querySelectorAll<HTMLInputElement>(selector)
      );
      const form = document.querySelector<HTMLFormElement>('#post');
      const field = fields[0];
      if (!field || !form) throw new Error('synthetic-native-field-unavailable');
      field.type = type;

      const snapshot = createWordPressNativePublishPort(document).read();
      const serialized = new FormData(form);

      expect(snapshot.availableFields[owner]).toBe(false);
      expect(serialized.has(formField)).toBe(
        'checkbox' !== type || field.checked
      );
    }
  );

  it('rejects a native owner that is replaced by a wrong input type before apply', () => {
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();
    const publicField = document.querySelector<HTMLInputElement>(
      '#visibility-radio-public'
    );
    const form = document.querySelector<HTMLFormElement>('#post');
    if (!publicField || !form) {
      throw new Error('synthetic-visibility-field-unavailable');
    }
    publicField.type = 'text';

    expect(new FormData(form).getAll('visibility')).toEqual(['public']);
    expect(() => port.apply({ ...snapshot, visibility: 'private' })).toThrowError(
      'native-publish-visibility-owner-unavailable'
    );
  });

  it('rejects a visibility radio whose serialized value changes before apply', () => {
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();
    const privateField = document.querySelector<HTMLInputElement>(
      '#visibility-radio-private'
    );
    const form = document.querySelector<HTMLFormElement>('#post');
    if (!privateField || !form) {
      throw new Error('synthetic-visibility-field-unavailable');
    }
    privateField.value = 'public';

    expect(() => port.apply({ ...snapshot, visibility: 'private' })).toThrowError(
      'native-publish-visibility-owner-unavailable'
    );
    expect(new FormData(form).getAll('visibility')).toEqual(['public']);
  });

  it('rejects a tag owner whose replacement is not a value control', () => {
    const original = document.querySelector('#tax-input-post_tag');
    const replacement = document.createElement('input');
    replacement.id = 'tax-input-post_tag';
    replacement.name = 'tax_input[post_tag]';
    replacement.type = 'checkbox';
    original?.replaceWith(replacement);
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(snapshot.availableFields.tags).toBe(false);
    expect(snapshot.tags).toEqual([]);
    expect(() => port.apply({ ...snapshot, tags: ['Unsaved'] })).toThrowError(
      'native-publish-tags-owner-unavailable'
    );
  });

  it('ignores a detached open-preview field and owns only its hidden post-form field', () => {
    const detached = document.createElement('input');
    detached.name = 'easymde_open_published_post';
    detached.value = '1';
    document.body.prepend(detached);
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(snapshot.openPreview).toBe(false);
    port.apply({ ...snapshot, openPreview: true });

    const form = document.querySelector<HTMLFormElement>('#post');
    const owned = form?.querySelector<HTMLInputElement>(
      'input[name="easymde_open_published_post"]'
    );
    expect(owned?.type).toBe('hidden');
    expect(
      new FormData(form ?? undefined).getAll('easymde_open_published_post')
    ).toEqual(['1']);

    port.apply({ ...port.read(), openPreview: false });
    expect(owned?.isConnected).toBe(false);
    expect(detached.isConnected).toBe(true);
  });

  it('rejects a submittable open-preview field with the wrong type', () => {
    const form = document.querySelector<HTMLFormElement>('#post');
    const conflicting = document.createElement('input');
    conflicting.name = 'easymde_open_published_post';
    conflicting.type = 'text';
    conflicting.value = '1';
    form?.append(conflicting);

    expect(() => createWordPressNativePublishPort(document).read()).toThrowError(
      'native-publish-open-preview-owner-invalid'
    );
  });

  it('rejects an invalid open-preview owner before changing any native field', () => {
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();
    const form = document.querySelector<HTMLFormElement>('#post');
    if (!form) throw new Error('synthetic-post-form-unavailable');
    const conflicting = document.createElement('input');
    conflicting.name = 'easymde_open_published_post';
    conflicting.type = 'text';
    conflicting.value = 'conflict';
    form.append(conflicting);
    const fieldState = () =>
      Array.from(form.elements).flatMap((element) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? [{
              checked:
                element instanceof HTMLInputElement ? element.checked : null,
              name: element.name,
              type:
                element instanceof HTMLInputElement ? element.type : 'textarea',
              value: element.value
            }]
          : []
      );
    const before = fieldState();

    expect(() =>
      port.apply({
        ...snapshot,
        categoryIds: ['3'],
        excerpt: 'Changed excerpt',
        featuredImage: null,
        openPreview: true,
        password: 'secret',
        sticky: true,
        tags: ['Changed'],
        visibility: 'password'
      })
    ).toThrowError('native-publish-open-preview-owner-invalid');
    expect(fieldState()).toEqual(before);
  });

  it('rejects controls that are detached from the owning WordPress form', () => {
    const tagField = document.querySelector<HTMLTextAreaElement>(
      '#tax-input-post_tag'
    );
    if (!tagField) throw new Error('synthetic-tag-field-unavailable');
    document.body.append(tagField);
    const snapshot = createWordPressNativePublishPort(document).read();

    expect(snapshot.availableFields.tags).toBe(false);
    expect(snapshot.tags).toEqual([]);
  });

  it('rejects a requested category ID that the current native form cannot submit', () => {
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(() =>
      port.apply({ ...snapshot, categoryIds: [...snapshot.categoryIds, '404'] })
    ).toThrowError('native-publish-categories-owner-unavailable');
  });

  it('allows unchanged defaults for fields unsupported by the current Post Type', () => {
    document.querySelector('#categorychecklist')?.remove();
    document.querySelector('#tax-input-post_tag')?.remove();
    document.querySelector('#excerpt')?.remove();
    document.querySelector('#postimagediv')?.remove();
    document.querySelector('#_thumbnail_id')?.remove();
    document.querySelector('#sticky')?.remove();
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(() => port.apply(snapshot)).not.toThrow();
  });
});
