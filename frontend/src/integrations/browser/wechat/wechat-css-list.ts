/** Splits a CSS comma-separated list on top-level commas, respecting quotes, escapes, and parentheses. */
export function splitCssList(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
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
      depth += 1;
      continue;
    }
    if (')' === character) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (',' === character && 0 === depth) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
}
