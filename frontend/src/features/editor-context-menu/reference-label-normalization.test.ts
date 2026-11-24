import { describe, expect, it } from 'vitest';

import { normalizeMarkdownReferenceLabel } from './reference-label-normalization';

describe('Markdown reference label normalization', () => {
  it('uses the renderer whitespace and full case-fold rules', () => {
    expect(normalizeMarkdownReferenceLabel('\0\t A  B \r\n\v', 14)).toBe('a b');
    expect(normalizeMarkdownReferenceLabel('A\u00a0B', 14)).toBe('a\u00a0b');
    expect(normalizeMarkdownReferenceLabel('A\vB', 14)).toBe('a\vb');
    expect(normalizeMarkdownReferenceLabel('Stra\u00dfe', 14)).toBe(normalizeMarkdownReferenceLabel('STRASSE', 14));
    expect(normalizeMarkdownReferenceLabel('\u03a3\u03c2', 14)).toBe('\u03c3\u03c3');
    expect(normalizeMarkdownReferenceLabel('\u0130', 14)).toBe('i\u0307');
    expect(normalizeMarkdownReferenceLabel('\u0131', 14)).not.toBe(normalizeMarkdownReferenceLabel('I', 14));
    expect(normalizeMarkdownReferenceLabel('\u13a0', 14)).toBe(normalizeMarkdownReferenceLabel('\uab70', 14));
    expect(normalizeMarkdownReferenceLabel('\u{10400}', 14)).toBe('\u{10428}');
  });

  it.each([
    { introduced: 13 as const, point: '\ua7ba', folded: '\ua7bb', previous: 11 as const },
    { introduced: 14 as const, point: '\u2c2f', folded: '\u2c5f', previous: 13 as const },
    { introduced: 16 as const, point: '\u1c89', folded: '\u1c8a', previous: 14 as const },
    { introduced: 17 as const, point: '\ua7ce', folded: '\ua7cf', previous: 16 as const },
  ])('uses the explicitly selected $introduced profile', ({ introduced, point, folded, previous }) => {
    expect(normalizeMarkdownReferenceLabel(point, introduced)).toBe(folded);
    expect(normalizeMarkdownReferenceLabel(point, previous)).toBe(point);
  });

  it('keeps ASCII labels available but refuses unproved Unicode on unsupported profiles', () => {
    expect(normalizeMarkdownReferenceLabel(' A  B ', 'unsupported')).toBe('a b');
    expect(() => normalizeMarkdownReferenceLabel('Stra\u00dfe', 'unsupported'))
      .toThrow('visual-editor-reference-label-fold-profile-unavailable');
  });
});
