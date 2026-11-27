export type CssDeclaration = Readonly<{ important: boolean; property: string; value: string }>;

/**
 * Splits a CSS value on top-level separators, respecting quotes, escapes, and
 * parentheses. A backslash escapes exactly the next character, so an even run of
 * backslashes leaves the following separator significant again.
 */
function splitCssTopLevel(value: string, separator: string): string[] {
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
    if (separator === character && 0 === depth) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
}

/** Splits a CSS comma-separated list on top-level commas, respecting quotes, escapes, and parentheses. */
export function splitCssList(value: string): string[] {
  return splitCssTopLevel(value, ',');
}

/**
 * Splits a declaration block on top-level semicolons and extracts the property,
 * the value, and the `!important` flag of each declaration, in source order.
 */
export function splitCssDeclarations(value: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  splitCssTopLevel(value, ';').forEach((raw) => {
    const separator = raw.indexOf(':');
    if (separator < 0) return;
    const property = raw.slice(0, separator).trim().toLowerCase();
    if (!property) return;
    const rawValue = raw.slice(separator + 1).trim();
    const important = /!\s*important$/iu.test(rawValue);
    const declarationValue = (important ? rawValue.replace(/!\s*important$/iu, '') : rawValue).trim();
    if (!declarationValue) return;
    declarations.push({ important, property, value: declarationValue });
  });
  return declarations;
}
