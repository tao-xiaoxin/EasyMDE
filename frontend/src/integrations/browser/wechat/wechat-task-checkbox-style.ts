import { isTaskListCheckbox } from './wechat-clone-metadata';

/**
 * Remove a zero line-height component from a task checkbox font shorthand when
 * the declaration paints an owner or an empty decoration. Text pseudos keep the
 * shorthand because Chromium uses its zero line-height paint box for the glyph.
 */
export function taskCheckboxFontWithoutZeroLineHeight(
  source: Element,
  value: string,
  pseudoHasTextContent = false
): string {
  if (!isTaskListCheckbox(source) || pseudoHasTextContent) return value;
  let quote: '"' | "'" | null = null;
  let parentheses = 0;
  let escaped = false;
  let slashIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if ('\\' === character) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if ('"' === character || "'" === character) {
      quote = character;
      continue;
    }
    if ('(' === character) {
      parentheses += 1;
      continue;
    }
    if (')' === character) {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if ('/' === character && 0 === parentheses) {
      slashIndex = index;
      break;
    }
  }
  if (slashIndex < 0) return value;
  const afterSlash = value.slice(slashIndex + 1);
  const zeroLineHeight = /^\s*0(?:\.0+)?(?:px|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|cm|mm|q|in|pt|pc|%)?(?=\s|$)/iu.exec(
    afterSlash
  );
  if (!zeroLineHeight) return value;
  const fontFamily = afterSlash.slice(zeroLineHeight[0].length).trimStart();
  if (!fontFamily) return value;
  return `${value.slice(0, slashIndex).trimEnd()} ${fontFamily}`.trim();
}

export function taskCheckboxLineHeightIsZero(
  source: Element,
  property: string,
  value: string,
  pseudoHasTextContent = false
): boolean {
  if (!isTaskListCheckbox(source) || 'line-height' !== property || pseudoHasTextContent) return false;
  return /^0(?:\.0+)?(?:px)?$/u.test(value.trim().toLowerCase());
}
