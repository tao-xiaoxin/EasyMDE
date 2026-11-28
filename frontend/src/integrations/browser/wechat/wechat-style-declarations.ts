const STYLE_DECLARATION = /^(-{0,2}[a-z][a-z\d-]*)\s*:\s*([\s\S]+)$/iu;
const STYLE_DECLARATION_PRIORITY = /!\s*important$/iu;

function splitStyleDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let start = 0;
  let quote = '';
  let parentheses = 0;
  let escaped = false;
  for (let index = 0; index < style.length; index += 1) {
    const character = style[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if ('\\' === character) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
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
    if (';' === character && 0 === parentheses) {
      declarations.push(style.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(style.slice(start));
  return declarations;
}

/**
 * Replaces the whole declaration of each listed property instead of appending a
 * second, competing value. `appendDeclarations` keeps the earlier declaration
 * and relies on the destination honoring `!important`; a target that strips
 * declaration priority then re-applies the stale value. Replacement is
 * required whenever a stale and a corrected value must not coexist.
 */
export function replaceDeclarations(element: Element, declarations: readonly string[], important = false): void {
  if (!declarations.length) return;
  const replacements = declarations.map((declaration) => {
    const match = STYLE_DECLARATION.exec(declaration.trim());
    const property = match?.[1] ?? '';
    const rawValue = match?.[2] ?? '';
    const value = rawValue.replace(STYLE_DECLARATION_PRIORITY, '').trim();
    if (!property || !value) throw new Error('wechat-style-declaration-invalid');
    return {
      property: property.toLowerCase(),
      serialized: `${property}:${value}${important || STYLE_DECLARATION_PRIORITY.test(rawValue) ? '!important' : ''}`
    };
  });
  const properties = new Set(replacements.map(({ property }) => property));
  const existing = element.getAttribute('style') ?? '';
  const retained = splitStyleDeclarations(existing).filter((declaration) => {
    const match = STYLE_DECLARATION.exec(declaration.trim());
    return !match || !properties.has(match[1]?.toLowerCase() ?? '');
  });
  element.setAttribute(
    'style',
    [...retained, ...replacements.map(({ serialized }) => serialized)].filter((declaration) => declaration.trim()).join(';')
  );
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new Error('wechat-style-declaration-target-unavailable');
  replacements.forEach(({ property }) => {
    if (!style.getPropertyValue(property).trim()) throw new Error('wechat-style-declaration-rejected');
  });
}
