import { referenceCaseFoldData } from './reference-case-fold-data';
import { isReferenceLabelCaseFoldProfile, type ReferenceLabelCaseFoldProfile } from '../../contracts/ports/editor-block-index-port';

export type { ReferenceLabelCaseFoldProfile } from '../../contracts/ports/editor-block-index-port';

type UnsupportedReferenceLabelKey = Readonly<{
  hasNonAscii: boolean;
  key: string;
}>;

export type UnsupportedNonAsciiReferenceInfo = Readonly<{
  allFold17Keys: ReadonlySet<string>;
  collidingFold17Keys: ReadonlySet<string>;
  exactLabels: ReadonlySet<string>;
  hasNonAsciiDefinitions: boolean;
}>;

/** PHP trim()'s default charlist: NUL, TAB, LF, VT, CR, SPACE. */
function isPhpDefaultTrimCharacter(code: number): boolean {
  return code === 0x00 || code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0d || code === 0x20;
}

/** Strip one leading and one trailing run of PHP's default trim charlist. */
function trimPhpDefaultCharacters(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isPhpDefaultTrimCharacter(value.charCodeAt(start))) start += 1;
  while (end > start && isPhpDefaultTrimCharacter(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

function prepareReferenceLabel(value: string): string {
  return trimPhpDefaultCharacters(value).replace(/[ \t\r\n]+/gu, ' ');
}

function foldAsciiCodePoint(code: number, character: string): string {
  return code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : character;
}

/**
 * Computes the Unicode-version-independent canonical form of a reference label:
 * PHP `trim()` default charlist, `[ \t\r\n]+` collapsed to `" "`, and ASCII
 * `A-Z` folded to `a-z` while leaving every non-ASCII code point exact.
 */
export function canonicalizeUnsupportedReferenceLabel(
  value: string,
): UnsupportedReferenceLabelKey | null {
  const trimmed = prepareReferenceLabel(value);
  if (0 === trimmed.length) return null;
  let key = '';
  let hasNonAscii = false;
  for (const character of trimmed) {
    const code = character.codePointAt(0);
    if (undefined === code || (code >= 0xd800 && code <= 0xdfff)) return null;
    if (code > 0x7f) {
      hasNonAscii = true;
      key += character;
    } else {
      key += foldAsciiCodePoint(code, character);
    }
  }
  return key.length > 0 ? { hasNonAscii, key } : null;
}

/** Match league/commonmark TextNormalizer for the explicitly reported PHP profile. */
export function normalizeMarkdownReferenceLabel(value: string, profile: ReferenceLabelCaseFoldProfile): string {
  if (!isReferenceLabelCaseFoldProfile(profile)) {
    throw new Error('visual-editor-reference-label-fold-profile-unavailable');
  }
  const trimmed = prepareReferenceLabel(value);
  let result = '';
  for (const character of trimmed) {
    const code = character.codePointAt(0);
    if (undefined === code) throw new Error('visual-editor-reference-label-fold-invalid');
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('visual-editor-reference-label-fold-invalid');
    if ('unsupported' === profile) {
      if (code > 0x7f) throw new Error('visual-editor-reference-label-fold-profile-unavailable');
      result += foldAsciiCodePoint(code, character);
      continue;
    }
    let start = 0;
    let end = referenceCaseFoldData.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      const entry = referenceCaseFoldData[middle];
      if (!entry) throw new Error('visual-editor-reference-label-fold-invalid');
      if (entry[0] < code) start = middle + 1;
      else end = middle;
    }
    const entry = referenceCaseFoldData[start];
    result += entry && entry[0] === code && entry[2] <= profile
      ? String.fromCodePoint(...entry[1]) : character;
  }
  return result;
}
