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
    <input id="_thumbnail_id" name="_thumbnail_id" value="15">
    <input id="visibility-radio-public" name="visibility" type="radio" checked>
    <input id="visibility-radio-password" name="visibility" type="radio">
    <input id="visibility-radio-private" name="visibility" type="radio">
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
