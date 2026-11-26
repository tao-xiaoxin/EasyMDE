import { isSvgElement, isTaskListCheckbox } from './wechat-clone-metadata';

const ZERO_LINE_HEIGHT_TOKEN =
  '(?:0+(?:\\.0+)?|\\.0+)(?:px|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc|%)?';
const FONT_SHORTHAND_ZERO_LINE_HEIGHT = new RegExp(`^\\s*${ZERO_LINE_HEIGHT_TOKEN}(?=\\s|$)`, 'iu');
const ZERO_LINE_HEIGHT_VALUE = new RegExp(`^${ZERO_LINE_HEIGHT_TOKEN}$`, 'iu');

function isInlineScriptElement(source: Element, pseudoElement: boolean): boolean {
  return !pseudoElement && !isSvgElement(source) && ('SUB' === source.tagName || 'SUP' === source.tagName);
}

/**
 * Determine whether zero line-height declarations should be stripped from an
 * element's portable WeChat styles:
 * - Task checkbox owners and empty decoration pseudos (text pseudos keep their
 *   zero line-height paint box because Chromium uses it for glyph alignment).
 * - Non-SVG, non-pseudo inline `<sub>` and `<sup>` elements, whose Normalize-style
 *   `line-height: 0` otherwise triggers WeChat's `#1.3 line-height` check.
 */
function shouldStripZeroLineHeight(
  source: Element,
  pseudoElement = false,
  pseudoHasTextContent = false
): boolean {
  if (isTaskListCheckbox(source)) return !pseudoHasTextContent;
  return isInlineScriptElement(source, pseudoElement);
}

/**
 * Strip a zero line-height segment (e.g. `/ 0px`, `/ 0`, `/ 0em`, `/ 0%`) from a
 * CSS `font` shorthand value while respecting quoted font names and parentheses.
 */
export function stripZeroLineHeightFromFontShorthand(value: string): string {
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
  const zeroLineHeight = FONT_SHORTHAND_ZERO_LINE_HEIGHT.exec(afterSlash);
  if (!zeroLineHeight) return value;
  const fontFamily = afterSlash.slice(zeroLineHeight[0].length).trimStart();
  if (!fontFamily) return value;
  return `${value.slice(0, slashIndex).trimEnd()} ${fontFamily}`.trim();
}

export function isZeroLineHeightValue(value: string): boolean {
  return ZERO_LINE_HEIGHT_VALUE.test(value.trim());
}

/**
 * Remove a zero line-height component from a `font` shorthand when the
 * declaration belongs to a task checkbox owner/empty decoration pseudo or a
 * non-SVG, non-pseudo inline `<sub>`/`<sup>` element.
 */
export function fontWithoutZeroLineHeight(
  source: Element,
  value: string,
  pseudoElement = false,
  pseudoHasTextContent = false
): string {
  if (!shouldStripZeroLineHeight(source, pseudoElement, pseudoHasTextContent)) return value;
  return stripZeroLineHeightFromFontShorthand(value);
}

/**
 * Return true when a `line-height` declaration has a zero value on an element
 * whose zero line-height must be omitted for WeChat compatibility.
 */
export function shouldOmitZeroLineHeight(
  source: Element,
  property: string,
  value: string,
  pseudoElement = false,
  pseudoHasTextContent = false
): boolean {
  if ('line-height' !== property) return false;
  if (!shouldStripZeroLineHeight(source, pseudoElement, pseudoHasTextContent)) return false;
  return isZeroLineHeightValue(value);
}
