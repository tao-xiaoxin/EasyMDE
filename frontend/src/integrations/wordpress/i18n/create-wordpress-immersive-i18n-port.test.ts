import { describe, expect, it, vi } from 'vitest';

import { createWordPressImmersiveI18nPort } from './create-wordpress-immersive-i18n-port';

describe('createWordPressImmersiveI18nPort', () => {
  it('uses WordPress plural selection with the raw count and locale-formatted number', () => {
    const plural = vi.fn(
      (singular: string, multiple: string, count: number) =>
        1 === count ? singular : multiple
    );
    const port = createWordPressImmersiveI18nPort({
      i18n: {
        _n: plural,
        sprintf: (template: string, value: string) =>
          template.replace('%s', value)
      },
      locale: 'en_US'
    });

    expect(port.words(1)).toBe('1 word');
    expect(port.words(1234)).toBe('1,234 words');
    expect(port.characters(1)).toBe('1 character');
    expect(port.readingTime(1)).toBe('About 1 minute');
    expect(port.revisions(22)).toBe('22 revisions');
    expect(plural).toHaveBeenLastCalledWith(
      '%s revision',
      '%s revisions',
      22,
      'easymde'
    );
  });

  it('fails clearly when the WordPress locale is invalid', () => {
    expect(() =>
      createWordPressImmersiveI18nPort({
        i18n: {
          _n: (singular) => singular,
          sprintf: (template, value) => template.replace('%s', value)
        },
        locale: 'not_a_locale_!'
      })
    ).toThrowError('wordpress-immersive-i18n-locale-invalid');
  });
});
