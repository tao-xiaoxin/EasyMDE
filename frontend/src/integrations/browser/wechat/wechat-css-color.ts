export const NON_COLOR_KEYWORDS = new Set([
  'inherit',
  'initial',
  'none',
  'revert',
  'revert-layer',
  'unset',
]);

export type RgbaColor = Readonly<{
  a: number;
  b: number;
  g: number;
  r: number;
}>;

const NAMED_CSS_COLOR_HEX: ReadonlyMap<string, string> = new Map([
  ['aliceblue', '#f0f8ff'],
  ['aqua', '#00ffff'],
  ['beige', '#f5f5dc'],
  ['black', '#000000'],
  ['blue', '#0000ff'],
  ['cyan', '#00ffff'],
  ['darkgray', '#a9a9a9'],
  ['darkgrey', '#a9a9a9'],
  ['dimgray', '#696969'],
  ['dimgrey', '#696969'],
  ['fuchsia', '#ff00ff'],
  ['gainsboro', '#dcdcdc'],
  ['ghostwhite', '#f8f8ff'],
  ['gray', '#808080'],
  ['green', '#008000'],
  ['grey', '#808080'],
  ['ivory', '#fffff0'],
  ['lightgray', '#d3d3d3'],
  ['lightgrey', '#d3d3d3'],
  ['lime', '#00ff00'],
  ['linen', '#faf0e6'],
  ['magenta', '#ff00ff'],
  ['maroon', '#800000'],
  ['navy', '#000080'],
  ['olive', '#808000'],
  ['orange', '#ffa500'],
  ['purple', '#800080'],
  ['rebeccapurple', '#663399'],
  ['red', '#ff0000'],
  ['seashell', '#fff5ee'],
  ['silver', '#c0c0c0'],
  ['snow', '#fffafa'],
  ['teal', '#008080'],
  ['white', '#ffffff'],
  ['whitesmoke', '#f5f5f5'],
  ['yellow', '#ffff00'],
]);

function findTopLevelSlashIndex(body: string): number {
  let depth = 0;
  let lastSlash = -1;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if ('(' === ch) depth += 1;
    else if (')' === ch) depth = Math.max(0, depth - 1);
    else if ('/' === ch && 0 === depth) lastSlash = index;
  }
  return lastSlash;
}

export function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if ('(' === ch) depth += 1;
    else if (')' === ch) depth = Math.max(0, depth - 1);
    else if (',' === ch && 0 === depth) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Parses the numeric alpha channel `[0, 1]` of a CSS color string, or returns
 * `null` when the value is empty, a non-color keyword, or an expression whose
 * alpha cannot be determined statically.
 */
export function parseCssColorAlpha(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized)) {
    return null;
  }
  if ('transparent' === normalized) {
    return 0;
  }
  if (/^#[\da-f]{3}$/u.test(normalized) || /^#[\da-f]{6}$/u.test(normalized)) {
    return 1;
  }
  if (/^#[\da-f]{4}$/u.test(normalized)) {
    return Number.parseInt(normalized.slice(4, 5), 16) / 15;
  }
  if (/^#[\da-f]{8}$/u.test(normalized)) {
    return Number.parseInt(normalized.slice(7, 9), 16) / 255;
  }
  const fnMatch =
    /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/u.exec(normalized);
  if (fnMatch) {
    const body = fnMatch[1]?.trim() ?? '';
    let alphaToken = '';
    const slashIndex = findTopLevelSlashIndex(body);
    if (slashIndex >= 0) {
      alphaToken = body.slice(slashIndex + 1).trim();
    } else if (/^(?:rgba?|hsla?)\(/u.test(normalized)) {
      const components = splitTopLevelCommas(body);
      if (components.length >= 4) {
        alphaToken = (components[components.length - 1] ?? '').trim();
      }
    }
    if (!alphaToken) return 1;
    if ('none' === alphaToken) return 0;
    const alphaMatch = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%?)$/iu.exec(alphaToken);
    if (!alphaMatch) return null;
    const parsed = Number.parseFloat(alphaMatch[1] ?? '');
    if (!Number.isFinite(parsed)) return null;
    const scaled = '%' === alphaMatch[2] ? parsed / 100 : parsed;
    return Math.min(1, Math.max(0, scaled));
  }
  if ('currentcolor' === normalized) {
    return null;
  }
  if (/^[a-z]+$/u.test(normalized)) {
    return 1;
  }
  return null;
}

function parseAlphaToken(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%?)$/iu.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) return null;
  const scaled = '%' === match[2] ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, scaled));
}

function parseRgbChannel(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%?)$/iu.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) return null;
  const scaled = '%' === match[2] ? (parsed / 100) * 255 : parsed;
  return Math.min(255, Math.max(0, scaled));
}

function parseHueDegrees(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/iu.exec(
    normalized,
  );
  if (!match) return null;
  const value = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? 'deg').toLowerCase();
  const degrees =
    'rad' === unit
      ? (value * 180) / Math.PI
      : 'grad' === unit
        ? value * 0.9
        : 'turn' === unit
          ? value * 360
          : value;
  return ((degrees % 360) + 360) % 360;
}

function parseHslPercent(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)%$/iu.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed / 100));
}

function hslToRgb(h: number, s: number, l: number): readonly [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l - chroma / 2;
  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h < 60) [rPrime, gPrime, bPrime] = [chroma, secondary, 0];
  else if (h < 120) [rPrime, gPrime, bPrime] = [secondary, chroma, 0];
  else if (h < 180) [rPrime, gPrime, bPrime] = [0, chroma, secondary];
  else if (h < 240) [rPrime, gPrime, bPrime] = [0, secondary, chroma];
  else if (h < 300) [rPrime, gPrime, bPrime] = [secondary, 0, chroma];
  else [rPrime, gPrime, bPrime] = [chroma, 0, secondary];
  return [(rPrime + match) * 255, (gPrime + match) * 255, (bPrime + match) * 255];
}

function parseHexColor(normalized: string): RgbaColor | null {
  if (/^#[\da-f]{3}$/u.test(normalized) || /^#[\da-f]{4}$/u.test(normalized)) {
    const rHex = normalized.slice(1, 2);
    const gHex = normalized.slice(2, 3);
    const bHex = normalized.slice(3, 4);
    const aHex = normalized.slice(4, 5);
    return {
      a: aHex ? Number.parseInt(aHex, 16) / 15 : 1,
      b: Number.parseInt(bHex + bHex, 16),
      g: Number.parseInt(gHex + gHex, 16),
      r: Number.parseInt(rHex + rHex, 16),
    };
  }
  if (/^#[\da-f]{6}$/u.test(normalized) || /^#[\da-f]{8}$/u.test(normalized)) {
    const aHex = normalized.slice(7, 9);
    return {
      a: aHex ? Number.parseInt(aHex, 16) / 255 : 1,
      b: Number.parseInt(normalized.slice(5, 7), 16),
      g: Number.parseInt(normalized.slice(3, 5), 16),
      r: Number.parseInt(normalized.slice(1, 3), 16),
    };
  }
  return null;
}

/**
 * Parses sRGB CSS solid colors (`rgb()`, `rgba()`, `hsl()`, `hsla()`, hex,
 * `transparent`, and standard named colors) into `{ r, g, b, a }`, or returns
 * `null` for non-color keywords or unsupported color expressions.
 */
export function parseCssSolidColor(value: string): RgbaColor | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized) || 'currentcolor' === normalized) {
    return null;
  }
  if ('transparent' === normalized) {
    return { a: 0, b: 0, g: 0, r: 0 };
  }
  if (normalized.startsWith('#')) {
    return parseHexColor(normalized);
  }
  const namedHex = NAMED_CSS_COLOR_HEX.get(normalized);
  if (namedHex) {
    return parseHexColor(namedHex);
  }
  const fnMatch = /^(rgba?|hsla?)\((.*)\)$/u.exec(normalized);
  if (!fnMatch) return null;
  const fnName = fnMatch[1] ?? '';
  const body = (fnMatch[2] ?? '').trim();
  if (!body) return null;

  const slashIndex = findTopLevelSlashIndex(body);
  let channelTokens: string[];
  let alpha = 1;
  let allowNone = false;
  if (slashIndex >= 0) {
    allowNone = true;
    const colorPart = body.slice(0, slashIndex).trim();
    const alphaPart = body.slice(slashIndex + 1).trim();
    if (!colorPart || colorPart.includes(',') || !alphaPart) return null;
    channelTokens = colorPart.split(/\s+/u).filter(Boolean);
    const parsedAlpha = parseAlphaToken(alphaPart, true);
    if (parsedAlpha === null) return null;
    alpha = parsedAlpha;
  } else {
    const commaParts = splitTopLevelCommas(body).map((part) => part.trim());
    if (3 === commaParts.length || 4 === commaParts.length) {
      channelTokens = commaParts.slice(0, 3);
      if (4 === commaParts.length) {
        const parsedAlpha = parseAlphaToken(commaParts[3] ?? '', false);
        if (parsedAlpha === null) return null;
        alpha = parsedAlpha;
      }
    } else if (1 === commaParts.length) {
      allowNone = true;
      channelTokens = body.split(/\s+/u).filter(Boolean);
    } else {
      return null;
    }
  }
  if (3 !== channelTokens.length) return null;

  if ('rgb' === fnName || 'rgba' === fnName) {
    const r = parseRgbChannel(channelTokens[0] ?? '', allowNone);
    const g = parseRgbChannel(channelTokens[1] ?? '', allowNone);
    const b = parseRgbChannel(channelTokens[2] ?? '', allowNone);
    if (r === null || g === null || b === null) return null;
    return { a: alpha, b, g, r };
  }
  const h = parseHueDegrees(channelTokens[0] ?? '', allowNone);
  const s = parseHslPercent(channelTokens[1] ?? '', allowNone);
  const l = parseHslPercent(channelTokens[2] ?? '', allowNone);
  if (h === null || s === null || l === null) return null;
  const [r, g, b] = hslToRgb(h, s, l);
  return { a: alpha, b, g, r };
}

export function parseCssOpacity(value: string): number | null {
  return parseAlphaToken(value, false);
}

export function compositeSourceOver(src: RgbaColor, dst: RgbaColor): RgbaColor {
  if (src.a <= 0) return dst;
  if (dst.a <= 0) return src;
  if (src.a >= 1) return { a: 1, b: src.b, g: src.g, r: src.r };
  const outA = dst.a >= 1 ? 1 : Math.min(1, src.a + dst.a * (1 - src.a));
  if (outA <= 0) return { a: 0, b: 0, g: 0, r: 0 };
  const invSrcA = 1 - src.a;
  return {
    a: outA,
    b: (src.b * src.a + dst.b * dst.a * invSrcA) / outA,
    g: (src.g * src.a + dst.g * dst.a * invSrcA) / outA,
    r: (src.r * src.a + dst.r * dst.a * invSrcA) / outA,
  };
}

export function formatCompositedColor(color: RgbaColor): string {
  if (color.a <= 0) return '';
  const r = Math.min(255, Math.max(0, Math.round(color.r)));
  const g = Math.min(255, Math.max(0, Math.round(color.g)));
  const b = Math.min(255, Math.max(0, Math.round(color.b)));
  if (color.a >= 1 - 1e-6) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const roundedAlpha = Math.round(color.a * 10_000) / 10_000;
  if (roundedAlpha >= 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const alpha =
    roundedAlpha > 0 ? roundedAlpha : Math.round(color.a * 1_000_000) / 1_000_000;
  if (alpha <= 0) return '';
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hasVisibleBackgroundColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized)) {
    return false;
  }
  const alpha = parseCssColorAlpha(normalized);
  return alpha !== null ? alpha > 0 : true;
}

export function isOpaqueBackgroundColor(value: string): boolean {
  const alpha = parseCssColorAlpha(value);
  return alpha !== null && alpha >= 1;
}
