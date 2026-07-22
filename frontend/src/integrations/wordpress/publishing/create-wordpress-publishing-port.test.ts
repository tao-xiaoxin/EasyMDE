import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWordPressPublishingPort } from './create-wordpress-publishing-port';

function mountNativeEditor(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="post">
      <select id="post_status"><option value="draft">Draft</option><option value="future" selected>Scheduled</option></select>
      <input id="visibility-radio-public" name="visibility" type="radio" value="public">
      <input id="visibility-radio-password" name="visibility" type="radio" value="password" checked>
      <input id="visibility-radio-private" name="visibility" type="radio" value="private">
      <input id="post_password" value="old password"><input id="sticky" type="checkbox" checked>
      <input id="aa" value="2027"><select id="mm"><option value="12" selected>Dec</option><option value="01">Jan</option></select><input id="jj" value="31"><input id="hh" value="09"><input id="mn" value="30">
      <ul id="categorychecklist"><li><input type="checkbox" value="7" checked></li><li><input type="checkbox" value="12"></li></ul>
      <ul id="categorychecklist-pop"><li><input type="checkbox" value="7" checked></li></ul>
      <input id="tax-input-post_tag" value="Alpha, beta"><textarea id="excerpt">Old summary</textarea>
      <input id="_thumbnail_id" value="31"><div id="postimagediv"><div class="inside"><img src="https://example.test/old.jpg" alt="Old cover"></div></div>
      <input name="extension_field" value="preserve me">
      <button id="save-post" type="submit">Save Draft</button><button id="publish" type="submit">Schedule</button>
    </form>`;
  return document.querySelector<HTMLFormElement>('#post') as HTMLFormElement;
}

function port() {
  return createWordPressPublishingPort({
    document,
    selectFeaturedImage: 'Select featured image',
    useFeaturedImage: 'Use featured image'
  });
}

describe('createWordPressPublishingPort', () => {
  beforeEach(() => mountNativeEditor());

  it('reads native state and extension-backed status options without writing', () => {
    const snapshot = port().read();

    expect(snapshot.draft).toEqual(expect.objectContaining({
      categories: ['7'],
      password: 'old password',
      schedule: { day: 31, hour: 9, minute: 30, month: 12, year: 2027 },
      status: 'future',
      sticky: false,
      tags: ['Alpha', ' beta'],
      visibility: 'password'
    }));
    expect(snapshot.statusOptions).toEqual([
      { disabled: false, id: 'draft', label: 'Draft' },
      { disabled: false, id: 'future', label: 'Scheduled' }
    ]);
    expect(document.querySelector<HTMLInputElement>('[name="extension_field"]')?.value).toBe('preserve me');
  });

  it('reads visibility only from the delegated WordPress controls', () => {
    const unrelated = document.createElement('input');
    unrelated.type = 'radio';
    unrelated.name = 'visibility';
    unrelated.value = 'extension-value';
    unrelated.checked = true;
    document.body.prepend(unrelated);

    expect(port().read().draft.visibility).toBe('password');
    expect(port().read().draft.password).toBe('old password');
  });

  it('preserves disabled native status-option semantics', () => {
    const future = document.querySelector<HTMLOptionElement>('#post_status option[value="future"]');
    if (future) future.disabled = true;

    expect(port().read().statusOptions).toEqual([
      { disabled: false, id: 'draft', label: 'Draft' },
      { disabled: true, id: 'future', label: 'Scheduled' }
    ]);
  });

  it('does not advertise disabled native fields as editable capabilities', () => {
    for (const selector of [
      '#categorychecklist input', '#excerpt', '#sticky', '#tax-input-post_tag',
      '#visibility-radio-public', '#visibility-radio-password', '#visibility-radio-private', '#post_password'
    ]) {
      const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (field) field.disabled = true;
    }

    expect(port().read().draft.capabilities).toEqual(expect.objectContaining({
      categories: false,
      excerpt: false,
      sticky: false,
      tags: false,
      visibility: false
    }));
  });

  it('preflights every expected native control before mutating any field', () => {
    const current = port();
    const snapshot = current.read();
    document.querySelector('#excerpt')?.remove();

    expect(() => current.requestSubmit({ ...snapshot.draft, excerpt: 'Changed' }, 'primary'))
      .toThrowError('publishing-native-excerpt-unavailable');
    expect(document.querySelector<HTMLInputElement>('#post_password')?.value).toBe('old password');
    expect(document.querySelector<HTMLInputElement>('#tax-input-post_tag')?.value).toBe('Alpha, beta');
  });

  it('rejects a delegated field that becomes disabled before mutating any field', () => {
    const current = port();
    const snapshot = current.read();
    const tags = document.querySelector<HTMLInputElement>('#tax-input-post_tag') as HTMLInputElement;
    tags.disabled = true;

    expect(() => current.requestSubmit({ ...snapshot.draft, excerpt: 'Changed' }, 'primary'))
      .toThrowError('publishing-native-tags-unavailable');
    expect(document.querySelector<HTMLInputElement>('#post_password')?.value).toBe('old password');
    expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe('Old summary');
  });

  it('rejects a selected status option that becomes disabled before mutating any field', () => {
    const current = port();
    const snapshot = current.read();
    const future = document.querySelector<HTMLOptionElement>('#post_status option[value="future"]');
    if (future) future.disabled = true;

    expect(() => current.requestSubmit({ ...snapshot.draft, excerpt: 'Changed' }, 'primary'))
      .toThrowError('publishing-native-status-unavailable');
    expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe('Old summary');
  });

  it('does not mutate a native field that was not delegated by the snapshot', () => {
    const sticky = document.querySelector<HTMLInputElement>('#sticky') as HTMLInputElement;
    sticky.disabled = true;
    const current = port();
    const snapshot = current.read();
    const publish = document.querySelector<HTMLButtonElement>('#publish') as HTMLButtonElement;
    vi.spyOn(publish, 'click').mockImplementation(() => {
      publish.form?.dispatchEvent(new SubmitEvent('submit', {
        bubbles: true, cancelable: true, submitter: publish
      }));
    });

    current.requestSubmit({ ...snapshot.draft, visibility: 'private' }, 'primary');

    expect(snapshot.draft.capabilities.sticky).toBe(false);
    expect(sticky.checked).toBe(true);
  });

  it.each(['missing', 'disabled'] as const)(
    'rejects a %s native action before mutating any delegated field',
    (state) => {
      const current = port();
      const snapshot = current.read();
      const publish = document.querySelector<HTMLButtonElement>('#publish') as HTMLButtonElement;
      if ('missing' === state) publish.remove();
      else publish.disabled = true;

      expect(() => current.requestSubmit({
        ...snapshot.draft,
        excerpt: 'Changed',
        tags: ['Changed'],
        visibility: 'private'
      }, 'primary')).toThrowError('publishing-native-action-unavailable');
      expect(document.querySelector<HTMLInputElement>('#post_password')?.value).toBe('old password');
      expect(document.querySelector<HTMLInputElement>('#tax-input-post_tag')?.value).toBe('Alpha, beta');
      expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe('Old summary');
    }
  );

  it('applies the complete draft then requests the native action without touching unknown fields', () => {
    const current = port();
    const snapshot = current.read();
    const publish = document.querySelector<HTMLButtonElement>('#publish') as HTMLButtonElement;
    const click = vi.spyOn(publish, 'click').mockImplementation(() => {
      publish.form?.dispatchEvent(new SubmitEvent('submit', {
        bubbles: true, cancelable: true, submitter: publish
      }));
    });
    const result = current.requestSubmit({
      ...snapshot.draft,
      categories: ['12'],
      excerpt: 'New summary',
      featuredImage: null,
      password: '',
      schedule: { day: 2, hour: 8, minute: 5, month: 1, year: 2028 },
      status: 'future',
      sticky: true,
      tags: ['Gamma', 'Delta'],
      visibility: 'public'
    }, 'primary');

    expect(result).toEqual({ status: 'requested' });
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLInputElement>('#visibility-radio-public')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#sticky')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#categorychecklist input[value="12"]')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#categorychecklist-pop input[value="7"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#tax-input-post_tag')?.value).toBe('Gamma, Delta');
    expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe('New summary');
    expect(document.querySelector<HTMLInputElement>('#_thumbnail_id')?.value).toBe('-1');
    expect(document.querySelector<HTMLSelectElement>('#mm')?.value).toBe('01');
    expect(document.querySelector<HTMLInputElement>('[name="extension_field"]')?.value).toBe('preserve me');
  });

  it('uses the native save action without changing the selected status or reporting persistence success', () => {
    const current = port();
    const snapshot = current.read();
    const save = document.querySelector<HTMLButtonElement>('#save-post') as HTMLButtonElement;
    const click = vi.spyOn(save, 'click').mockImplementation(() => {
      save.form?.dispatchEvent(new SubmitEvent('submit', {
        bubbles: true, cancelable: true, submitter: save
      }));
    });

    expect(current.requestSubmit(snapshot.draft, 'save-draft')).toEqual({ status: 'requested' });
    expect(document.querySelector<HTMLSelectElement>('#post_status')?.value).toBe('future');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('rolls back delegated fields when an extension cancels native submission', () => {
    const current = port();
    const snapshot = current.read();
    const form = document.querySelector<HTMLFormElement>('#post') as HTMLFormElement;
    form.addEventListener('submit', (event) => event.preventDefault());

    expect(() => current.requestSubmit({
      ...snapshot.draft,
      excerpt: 'Changed',
      tags: ['Changed'],
      visibility: 'private'
    }, 'primary')).toThrowError('publishing-native-submit-cancelled');
    expect(document.querySelector<HTMLInputElement>('#visibility-radio-password')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#tax-input-post_tag')?.value).toBe('Alpha, beta');
    expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe('Old summary');
  });

  it('rolls back delegated fields when a change listener disables the native action', () => {
    const current = port();
    const snapshot = current.read();
    const publish = document.querySelector<HTMLButtonElement>('#publish') as HTMLButtonElement;
    const tags = document.querySelector<HTMLInputElement>('#tax-input-post_tag') as HTMLInputElement;
    tags.addEventListener('change', () => {
      publish.disabled = true;
    }, { once: true });

    expect(() => current.requestSubmit({
      ...snapshot.draft,
      excerpt: 'Changed',
      tags: ['Changed']
    }, 'primary')).toThrowError('publishing-native-action-unavailable');
    expect(tags.value).toBe('Alpha, beta');
    expect(document.querySelector<HTMLTextAreaElement>('#excerpt')?.value).toBe('Old summary');
  });

  it('selects a featured image through WordPress media without writing native state', async () => {
    const callbacks = new Map<string, () => void>();
    const media = vi.fn(() => ({
      on: (name: string, callback: () => void) => callbacks.set(name, callback),
      open: vi.fn(),
      state: () => ({
        get: () => ({ first: () => ({ toJSON: () => ({ alt: 'Cover', id: 44, url: 'https://example.test/cover.jpg' }) }) })
      })
    }));
    const current = createWordPressPublishingPort({
      document, media, selectFeaturedImage: 'Select', useFeaturedImage: 'Use'
    });
    const pending = current.selectFeaturedImage();
    callbacks.get('select')?.();

    await expect(pending).resolves.toEqual({ alt: 'Cover', id: 44, url: 'https://example.test/cover.jpg' });
    expect(document.querySelector<HTMLInputElement>('#_thumbnail_id')?.value).toBe('31');
  });
});
