import { beforeEach, describe, expect, it } from 'vitest';

import { createWordPressNativePublishPort } from './create-wordpress-native-publish-port';

function fixture(): void {
  document.body.innerHTML = `
    <input id="original_post_status" value="publish">
    <input id="tax-input-post_tag" value="EasyMDE, Markdown">
    <textarea id="excerpt">Synthetic excerpt</textarea>
    <ul id="categorychecklist">
      <li><label><input type="checkbox" name="post_category[]" value="2" checked> Parent</label>
        <ul><li><label><input type="checkbox" name="post_category[]" value="3"> Child</label></li></ul>
      </li>
    </ul>
    <div id="postimagediv"><div class="inside"><img src="https://example.test/image.png" alt="Featured"></div></div>
    <input id="_thumbnail_id" value="15">
    <input id="visibility-radio-public" name="visibility" type="radio" checked>
    <input id="visibility-radio-password" name="visibility" type="radio">
    <input id="visibility-radio-private" name="visibility" type="radio">
    <input id="post_password" value="">
    <input id="sticky" type="checkbox">
  `;
}

describe('createWordPressNativePublishPort', () => {
  beforeEach(fixture);

  it('reads the real native publish state without mutating any field', () => {
    const before = document.body.innerHTML;
    const snapshot = createWordPressNativePublishPort(document).read();

    expect(snapshot).toEqual({
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
      published: true,
      sticky: false,
      tags: ['EasyMDE', 'Markdown'],
      visibility: 'public'
    });
    expect(document.body.innerHTML).toBe(before);
  });

  it('projects a confirmed draft into the existing WordPress form fields', () => {
    const port = createWordPressNativePublishPort(document);
    port.apply({
      categoryIds: ['3'],
      excerpt: 'Changed excerpt',
      featuredImage: null,
      password: 'secret',
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
    expect(document.querySelector<HTMLInputElement>('#tax-input-post_tag')?.value).toBe(
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
  });

  it('preserves the localized WordPress tag delimiter', () => {
    const tagField = document.querySelector<HTMLInputElement>(
      '#tax-input-post_tag'
    );
    if (!tagField) throw new Error('synthetic-tag-field-unavailable');
    tagField.value = 'EasyMDE、Markdown、WordPress';
    const port = createWordPressNativePublishPort(document);
    const snapshot = port.read();

    expect(snapshot.tags).toEqual(['EasyMDE', 'Markdown', 'WordPress']);
    port.apply({ ...snapshot, tags: [...snapshot.tags, 'UI'] });
    expect(
      document.querySelector<HTMLInputElement>('#tax-input-post_tag')?.value
    ).toBe('EasyMDE、Markdown、WordPress、UI');
  });
});
