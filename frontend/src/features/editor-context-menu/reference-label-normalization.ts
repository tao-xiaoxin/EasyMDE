import { referenceCaseFoldData } from './reference-case-fold-data';
import { isReferenceLabelCaseFoldProfile, type ReferenceLabelCaseFoldProfile } from '../../contracts/ports/editor-block-index-port';

export type { ReferenceLabelCaseFoldProfile } from '../../contracts/ports/editor-block-index-port';

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

/** Match league/commonmark TextNormalizer for the explicitly reported PHP profile. */
export function normalizeMarkdownReferenceLabel(value: string, profile: ReferenceLabelCaseFoldProfile): string {
  if (!isReferenceLabelCaseFoldProfile(profile)) {
    throw new Error('visual-editor-reference-label-fold-profile-unavailable');
  }
  const trimmed = trimPhpDefaultCharacters(value)
    .replace(/[ \t\r\n]+/gu, ' ');
  let result = '';
  for (const character of trimmed) {
    const code = character.codePointAt(0);
    if (undefined === code) throw new Error('visual-editor-reference-label-fold-invalid');
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('visual-editor-reference-label-fold-invalid');
    if ('unsupported' === profile) {
      if (code > 0x7f) throw new Error('visual-editor-reference-label-fold-profile-unavailable');
      result += code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : character;
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
