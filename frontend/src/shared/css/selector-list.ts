/**
 * Splits a CSS selector list without treating commas inside functional
 * selectors, attribute values, or quoted strings as list separators.
 *
 * A malformed list is rejected so callers can roll back a whole stylesheet
 * transaction instead of silently dropping one selector.
 */
export function splitSelectorList(selectorList: string): string[] | null {
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if ("\\" === character) {
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
    if ("(" === character || "[" === character) {
      depth += 1;
      continue;
    }
    if (")" === character || "]" === character) {
      if (depth === 0) return null;
      depth -= 1;
      continue;
    }
    if ("," === character && depth === 0) {
      const candidate = selectorList.slice(start, index).trim();
      if (!candidate) return null;
      selectors.push(candidate);
      start = index + 1;
    }
  }

  if (escaped || quote || depth !== 0) return null;
  const finalSelector = selectorList.slice(start).trim();
  if (!finalSelector) return null;
  selectors.push(finalSelector);
  return selectors;
}
