function isCssHexDigit(value: string | undefined): boolean {
  return undefined !== value && /^[0-9a-f]$/iu.test(value);
}

function isCssWhitespace(value: string | undefined): boolean {
  return undefined !== value && /^[ \t\n\r\f]$/u.test(value);
}

/**
 * Decodes the CSS character escapes used by CSSOM string serialization.
 * Hex escapes consume up to six digits and one following CSS whitespace code
 * point, so a serialized tab such as `\\9 ` becomes a real tab before the
 * generated-pseudo policy evaluates its whitespace boundary.
 */
function decodeCssString(value: string): string {
  let decoded = '';
  let index = 0;
  while (index < value.length) {
    if ('\\' !== value[index]) {
      decoded += value[index];
      index += 1;
      continue;
    }

    const escaped = value[index + 1];
    if (undefined === escaped) {
      decoded += '\\';
      index += 1;
      continue;
    }
    if ('\n' === escaped) {
      index += 2;
      continue;
    }
    if ('\r' === escaped) {
      index += '\n' === value[index + 2] ? 3 : 2;
      continue;
    }
    if ('\f' === escaped) {
      index += 2;
      continue;
    }
    if (!isCssHexDigit(escaped)) {
      decoded += escaped;
      index += 2;
      continue;
    }

    let end = index + 1;
    while (end < value.length && end - (index + 1) < 6 && isCssHexDigit(value[end])) end += 1;
    const codePoint = Number.parseInt(value.slice(index + 1, end), 16);
    if (0 === codePoint || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      decoded += '\ufffd';
    } else {
      decoded += String.fromCodePoint(codePoint);
    }
    if (isCssWhitespace(value[end])) {
      end += '\r' === value[end] && '\n' === value[end + 1] ? 2 : 1;
    }
    index = end;
  }
  return decoded;
}

export function pseudoContent(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || 'none' === normalized || 'normal' === normalized) return null;
  const match = /^("|')([\s\S]*)\1$/.exec(normalized);
  const content = match?.[2];
  if (undefined === content) return null;
  return decodeCssString(content);
}
