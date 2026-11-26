import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function cssVariable(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`));

  assert.ok(match, `${name} should be present`);

  return match[1].trim();
}

function cssRuleBodies(source, selector) {
  const bodies = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(source)) !== null) {
    const selectors = splitCssSelectors(match[1]);

    if (selectors.includes(selector)) {
      bodies.push(match[2]);
    }
  }

  return bodies;
}

function cssRuleSelectors(source) {
  const selectors = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(source)) !== null) {
    selectors.push(...splitCssSelectors(match[1]));
  }

  return selectors;
}

function cssRuleBodyMatching(source, selector, predicate = () => true) {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(source)) !== null) {
    const selectors = splitCssSelectors(
      match[1].replaceAll(/\/\*[\s\S]*?\*\//g, '')
    );
    if (selectors.includes(selector) && predicate(match[2])) return match[2];
  }

  return undefined;
}

function escapedRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function scopedArticleRoot(theme) {
  return `.easymde-rendered-content.easymde-markdown-theme-${theme}`;
}

function assertInlineCodeRule(theme, selectorSuffix, declarations) {
  const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
  const selector = `${scopedArticleRoot(theme)} ${selectorSuffix}`;
  const body = cssRuleBodyMatching(css, selector, (candidate) => (
    declarations.every((declaration) => declaration.test(candidate))
  ));

  assert.ok(body, `${theme} should preserve the pinned inline-code rule ${selectorSuffix}`);
  return css;
}

function dataImageUrlsFromRule(css, selector) {
  const body = cssRuleBodyMatching(css, selector);
  assert.ok(body, `Mdmdt should define ${selector}`);
  return [...body.matchAll(/url\(\s*["']?(data:image\/[^"')\s]+)["']?\s*\)/g)]
    .map((match) => match[1]);
}

function decodePngDataUrl(value, label) {
  assert.match(value, /^data:image\/png;base64,/i, `${label} should be a PNG data URI`);
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${label} should have a PNG signature`
  );
  assert.equal(bytes.readUInt32BE(16), 200, `${label} width`);
  assert.equal(bytes.readUInt32BE(20), 200, `${label} height`);
  assert.equal(bytes[24], 8, `${label} bit depth`);
  assert.equal(bytes[25], 6, `${label} RGBA color type`);

  const chunkTypes = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    chunkTypes.push(type);
    offset += 12 + length;
  }
  assert.equal(offset, bytes.length, `${label} should have complete PNG chunks`);
  assert.deepEqual(
    chunkTypes,
    ['IHDR', 'sRGB', 'IDAT', 'IEND'],
    `${label} should contain only the deterministic image chunks`
  );
  assert.deepEqual(
    chunkTypes.filter((type) => ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)),
    [],
    `${label} must not contain textual, EXIF, or timestamp metadata`
  );
  return bytes;
}

const TYPORA_ARTICLE_THEME_IDS = Object.freeze([
  'inkwell',
  'animal-island',
  'phycat-cherry',
  'phycat-caramel',
  'phycat-forest',
  'phycat-mint',
  'phycat-sky',
  'phycat-prussian',
  'phycat-sakura',
  'phycat-mauve',
  'mdmdt',
  'dogschoice-pink',
  'bloom-petal',
  'bloom-mist',
  'bloom-verdant',
  'bloom-stone',
  'bloom-wheat',
  'bloom-ink',
  'bloom-amber',
  'bloom-lapis',
  'bloom-ripple',
  'bloom-cinnabar',
  'bloom-sage',
  'bloom-spring',
  'spring'
]);

const ROOT_FRAME_PROPERTY_PATTERNS = Object.freeze([
  /^(?:width|min-width|max-width|height|min-height|max-height)$/,
  /^(?:margin|padding|border|background|outline|overflow|scroll-padding|scroll-behavior)(?:-|$)/,
  /^(?:box-shadow|position|z-index|inset|top|right|bottom|left)$/
]);

const ROOT_PSEUDO_SELECTORS = Object.freeze(['::before', '::after', ':before', ':after']);
const NESTED_CSS_AT_RULES = /^(?:@media|@supports|@container|@layer|@document|@scope)\b/i;

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findCssBlockEnd(source, openingBrace) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Unclosed CSS block starting at offset ${openingBrace}`);
}

function findCssStatement(source, start, end) {
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = start; index < end; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (parentheses === 0 && brackets === 0 && character === '{') {
      return { kind: 'block', index };
    } else if (parentheses === 0 && brackets === 0 && character === ';') {
      return { kind: 'statement', index };
    }
  }

  return undefined;
}

function splitCssSelectors(prelude) {
  const selectors = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(prelude.slice(start, index).trim());
      start = index + 1;
    }
  }

  const finalSelector = prelude.slice(start).trim();
  if (finalSelector) selectors.push(finalSelector);
  return selectors;
}

function parseCssRules(source) {
  const css = stripCssComments(source);
  const rules = [];

  function walk(start, end, atRules = []) {
    let position = start;

    while (position < end) {
      while (position < end && /[\s;]/.test(css[position])) position += 1;
      if (position >= end) break;

      const statement = findCssStatement(css, position, end);
      if (!statement) break;

      const prelude = css.slice(position, statement.index).trim();
      if (statement.kind === 'statement') {
        position = statement.index + 1;
        continue;
      }

      const blockEnd = findCssBlockEnd(css, statement.index);
      if (prelude.startsWith('@')) {
        if (NESTED_CSS_AT_RULES.test(prelude)) {
          walk(statement.index + 1, blockEnd, [...atRules, prelude]);
        }
      } else if (prelude) {
        rules.push({
          atRules,
          body: css.slice(statement.index + 1, blockEnd),
          selectors: splitCssSelectors(prelude)
        });
      }
      position = blockEnd + 1;
    }
  }

  walk(0, css.length);
  return rules;
}

function splitCssDeclarations(body) {
  const declarations = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  function addDeclaration(segment) {
    const match = segment.match(/^\s*([a-zA-Z_][\w-]*)\s*:/);
    if (!match) return;
    declarations.push({
      property: match[1].toLowerCase(),
      value: segment.slice(match[0].length).trim()
    });
  }

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (character === ';' && parentheses === 0 && brackets === 0) {
      addDeclaration(body.slice(start, index));
      start = index + 1;
    }
  }

  addDeclaration(body.slice(start));
  return declarations;
}

function normalizeCssSelector(selector) {
  return selector.replace(/\s+/g, ' ').trim();
}

function isRootFrameProperty(property) {
  return ROOT_FRAME_PROPERTY_PATTERNS.some((pattern) => pattern.test(property));
}

function rootPseudoSelector(root, selector) {
  const normalized = normalizeCssSelector(selector);
  return ROOT_PSEUDO_SELECTORS.some((pseudo) => normalized === `${root}${pseudo}`);
}

function rootOwnershipViolations(source, root) {
  const violations = [];

  for (const rule of parseCssRules(source)) {
    for (const selector of rule.selectors) {
      const normalizedSelector = normalizeCssSelector(selector);
      if (normalizedSelector !== root && !rootPseudoSelector(root, normalizedSelector)) continue;

      for (const declaration of splitCssDeclarations(rule.body)) {
        if (normalizedSelector === root && isRootFrameProperty(declaration.property)) {
          violations.push({
            atRules: rule.atRules,
            property: declaration.property,
            selector: normalizedSelector
          });
        }
        if (rootPseudoSelector(root, normalizedSelector) && (
          declaration.property === 'content' || isRootFrameProperty(declaration.property)
        )) {
          violations.push({
            atRules: rule.atRules,
            property: declaration.property,
            selector: normalizedSelector
          });
        }
      }
    }
  }

  return violations;
}

function rootPseudoRules(source, root) {
  return parseCssRules(source).flatMap((rule) => rule.selectors
    .map(normalizeCssSelector)
    .filter((selector) => rootPseudoSelector(root, selector)));
}

function registeredArticleThemes() {
  const registry = readFileSync(join(repoRoot, 'src/Theme/ArticleThemeRegistry.php'), 'utf8');

  return Array.from(
    registry.matchAll(
      /=>\s*\$this->theme\(\s*'([^']+)'[\s\S]*?'(assets\/themes\/article\/[^']+\.css)'/g
    ),
    ([, id, assetPath]) => ({ id, assetPath })
  );
}

function selectorPreludeFailures(css, dom) {
  const element = dom.window.document.createElement('div');
  const failures = [];

  for (const rule of parseCssRules(css)) {
    for (const selector of rule.selectors) {
      const normalized = normalizeCssSelector(selector);
      if (!normalized || /\/\*|\*\//.test(normalized)) {
        failures.push({ selector: normalized, reason: 'comment-marker-in-selector-prelude' });
        continue;
      }
      if (/[.#][-_a-zA-Z0-9]+\*/.test(normalized)) {
        failures.push({ selector: normalized, reason: 'unseparated-universal-selector' });
        continue;
      }

      try {
        element.matches(normalized);
      } catch (error) {
        // jsdom does not expose Firefox's selection pseudo-element, although it is valid CSS.
        if (normalized.endsWith('::-moz-selection')) continue;
        failures.push({ reason: String(error.message), selector: normalized });
      }
    }
  }

  return failures;
}

function targetsCodeFrame(selector) {
  const normalizedSelector = selector
    .replaceAll(/:not\(\s*pre\s*\)/g, '')
    .replaceAll(/:not\(\s*\.hljs(?:-[a-z0-9-]+)?\s*\)/g, '');

  return /(^|[\s>+~])pre(?=$|[\s>+~:.\[#])/.test(normalizedSelector)
    || /(^|[\s>+~])\.hljs(?:-|(?=$|[\s>+~:.\[#]))/.test(normalizedSelector);
}

function luminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

test('Qinghe Zhusha text and accent colors meet AA contrast on white', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qinghe-zhusha.css'), 'utf8');
  const white = '#ffffff';
  const text = cssVariable(css, '--easymde-qinghe-text');
  const green = cssVariable(css, '--easymde-qinghe-green');
  const red = cssVariable(css, '--easymde-qinghe-red');
  const soft = cssVariable(css, '--easymde-qinghe-soft');

  assert.ok(contrast(text, white) >= 4.5, 'body text should meet AA contrast on white');
  assert.ok(contrast(text, soft) >= 4.5, 'body text should meet AA contrast on soft backgrounds');
  assert.ok(contrast(green, white) >= 4.5, 'green accent should meet AA contrast on white');
  assert.ok(contrast(white, green) >= 4.5, 'white heading text should meet AA contrast on green');
  assert.ok(contrast(red, white) >= 4.5, 'red emphasis should meet AA contrast on white');
});

test('Qinghe Zhusha theme font keywords remain lint-clean', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qinghe-zhusha.css'), 'utf8');

  assert.equal(cssVariable(css, '--easymde-theme-font-family'), 'helvetica, arial, sans-serif');
});

test('Qinghe Zhusha mobile list margins can reset', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qinghe-zhusha.css'), 'utf8');

  assert.doesNotMatch(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-qinghe-zhusha li\s*\{[^}]*margin:[^;}]+!important/s,
    'list item margin should not use !important because mobile rules reset it'
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*\.easymde-rendered-content\.easymde-markdown-theme-qinghe-zhusha p,\s*\.easymde-rendered-content\.easymde-markdown-theme-qinghe-zhusha li\s*\{[\s\S]*margin-right: 0;[\s\S]*margin-left: 0;/,
    'mobile rules should reset paragraph and list item horizontal margins together'
  );
});

test('Qingbi Liujin and Qinghe Zhusha keep a compact, separated first heading', () => {
  for (const theme of ['qingbi-liujin', 'qinghe-zhusha']) {
    const css = readFileSync(
      join(repoRoot, `assets/themes/article/${theme}.css`),
      'utf8'
    );
    const root = `.easymde-rendered-content.easymde-markdown-theme-${theme}`;
    const firstChildRule = cssRuleBodies(css, `${root} > :not(pre):first-child`);
    const firstHeadingRule = cssRuleBodies(css, `${root} > h1:first-child`);
    const h1Rule = cssRuleBodies(css, `${root} h1`)
      .find((body) => /font-size:\s*24px;/.test(body));

    assert.equal(firstChildRule.length, 1);
    assert.match(firstChildRule[0], /margin-top:\s*0\s*!important;/);
    assert.equal(firstHeadingRule.length, 1);
    assert.match(firstHeadingRule[0], /margin-top:\s*30px\s*!important;/);
    assert.ok(h1Rule);
    assert.match(h1Rule, /font-size:\s*24px;/);
    assert.match(h1Rule, /line-height:\s*1\.25;/);
  }
});

test('Qingbi Liujin hr uses a pure CSS repeating-linear-gradient without data:image URIs', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qingbi-liujin.css'), 'utf8');
  const root = scopedArticleRoot('qingbi-liujin');
  const ruleTexture = cssVariable(css, '--easymde-qingbi-rule-texture');
  const hrRules = cssRuleBodies(css, `${root} hr`);

  assert.equal(
    ruleTexture,
    'repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.2) 0, rgba(0, 0, 0, 0.2) 2.12px, transparent 2.12px, transparent 4.24px)'
  );
  assert.doesNotMatch(ruleTexture, /data:image\//i);
  assert.equal(hrRules.length, 1);
  assert.match(hrRules[0], /background:\s*transparent var\(--easymde-qingbi-rule-texture\);/);
  assert.doesNotMatch(hrRules[0], /data:image\//i);
  assert.doesNotMatch(hrRules[0], /repeat-x/i);
  assert.doesNotMatch(css, /data:image\//i);
});

test('Crimson focus follows the reference light surface and preserves code-theme ownership', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/crimson-focus.css'), 'utf8');
  const root = '.easymde-rendered-content.easymde-markdown-theme-crimson-focus';
  const white = '#ffffff';
  const text = cssVariable(css, '--easymde-crimson-focus-text');
  const accent = cssVariable(css, '--easymde-crimson-focus-accent');
  const soft = cssVariable(css, '--easymde-crimson-focus-accent-soft');

  assert.equal(text, '#0f172a');
  assert.equal(accent, '#e74c3c');
  assert.equal(
    cssVariable(css, '--easymde-theme-font-family'),
    '"EasyMDE Lora", Lora, Georgia, "Times New Roman", serif'
  );
  assert.equal(cssVariable(css, '--easymde-crimson-focus-accent-text'), '#b42318');
  assert.equal(soft, '#fdedec');
  assert.equal(cssVariable(css, '--easymde-crimson-focus-muted'), '#475569');
  assert.equal(cssVariable(css, '--easymde-crimson-focus-inline'), '#fdedec');
  assert.match(
    css,
    /@font-face\s*\{[^}]*font-family:\s*"EasyMDE Lora";[^}]*font-weight:\s*400;[^}]*src:\s*url\("\.\.\/\.\.\/vendor\/fonts\/lora\/lora-latin-400-normal\.woff2"\) format\("woff2"\);/s
  );
  assert.match(
    css,
    /@font-face\s*\{[^}]*font-family:\s*"EasyMDE Inter";[^}]*font-weight:\s*400;[^}]*src:\s*url\("\.\.\/\.\.\/vendor\/fonts\/inter\/inter-latin-400-normal\.woff2"\) format\("woff2"\);/s
  );
  assert.match(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus:not\(\.easymde-preview\)\s*\{[^}]*max-width:\s*680px;[^}]*padding:\s*36px 52px 48px;/s
  );
  assert.match(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*auto;[^}]*padding:\s*0;/s,
    'the Preview root should delegate its geometry to the owning editor container'
  );
  assert.match(
    css,
    /> :not\(pre\):first-child\s*\{[\s\S]*margin-top:\s*0;/
  );
  assert.match(
    css,
    /> :not\(pre\):last-child\s*\{[\s\S]*margin-bottom:\s*0;/
  );
  assert.match(css, /font-size:\s*15px;\s*\n\s*line-height:\s*1\.85;/);
  assert.match(
    css,
    /h1\s*\{[\s\S]*padding:\s*0;[\s\S]*font-family:\s*"EasyMDE Lora", Lora, Georgia, "Times New Roman", serif !important;[\s\S]*font-size:\s*30px;[\s\S]*line-height:\s*1\.2;/
  );
  assert.match(css, /h3\s*\{[\s\S]*padding:\s*0;[\s\S]*font-family:\s*"EasyMDE Inter", Inter, system-ui, sans-serif !important;[\s\S]*font-size:\s*15px;[\s\S]*line-height:\s*1\.5;/);
  assert.match(css, /h4,[\s\S]*h6\s*\{[\s\S]*padding:\s*0;[\s\S]*font-family:\s*"EasyMDE Inter", Inter, system-ui, sans-serif !important;[\s\S]*font-size:\s*13\.5px;[\s\S]*line-height:\s*1\.5;/);
  assert.match(css, /h5,[\s\S]*h6\s*\{\s*line-height:\s*1\.85;/);
  assert.match(css, /h2\s*\{[\s\S]*padding:\s*0 0 7\.5px;[\s\S]*font-family:\s*"EasyMDE Inter", Inter, system-ui, sans-serif !important;[\s\S]*font-size:\s*16\.875px;[\s\S]*line-height:\s*1\.3;[\s\S]*text-transform:\s*uppercase;[\s\S]*letter-spacing:\s*0\.06em;/);
  assert.match(css, /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus p\s*\{[\s\S]*font-size:\s*inherit;[\s\S]*line-height:\s*inherit;/);
  assert.match(css, /#poststuff \.easymde-rendered-content\.easymde-markdown-theme-crimson-focus h2\s*\{[\s\S]*padding:\s*0 0 7\.5px;[\s\S]*font-size:\s*16\.875px;/);
  assert.match(
    css,
    /\.easymde-theme-default-fonts h1\s*\{[\s\S]*font-family:\s*"EasyMDE Lora", Lora, Georgia, "Times New Roman", serif !important;/
  );
  assert.match(
    css,
    /\.easymde-theme-default-fonts h2,[\s\S]*\.easymde-theme-default-fonts h6\s*\{[\s\S]*font-family:\s*"EasyMDE Inter", Inter, system-ui, sans-serif !important;/
  );
  assert.match(
    css,
    /\.easymde-theme-default-fonts :is\(h1, h2, h3, h4, h5, h6\) :is\(a, strong, em\)\s*\{[\s\S]*font-family:\s*inherit !important;/
  );
  assert.match(css, /h2\s*\{[\s\S]*padding:\s*0 0 7\.5px;/);
  assert.match(
    css,
    /h1 code,[\s\S]*h6 code\s*\{[\s\S]*font-size:\s*inherit;/
  );
  assert.match(
    css,
    /\.task-list-item\s*\{[\s\S]*display:\s*list-item;[\s\S]*list-style-type:\s*none;/
  );
  assert.doesNotMatch(
    css,
    /ol > \.task-list-item\s*\{[\s\S]*display:\s*block;/,
    'ordered task items must remain list items so mixed-list numbering is preserved'
  );
  assert.match(css, /@supports selector\(:has\(\*\)\)/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> \.easymde-task-checkbox\)/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> p > \.easymde-task-checkbox\)/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> input\[type="checkbox"\]\)/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> p > input\[type="checkbox"\]\)/);
  assert.match(
    css,
    /\.task-list\s*\{[\s\S]*padding-inline-start:\s*3\.75px;[\s\S]*list-style:\s*none;/
  );
  assert.doesNotMatch(
    css,
    /:is\(ul, ol\):has\(> li > \.easymde-task-checkbox\)\s*\{[\s\S]*list-style:\s*none;/
  );
  assert.match(
    css,
    /\.task-list-item::marker\s*\{[\s\S]*content:\s*none;/
  );
  assert.match(css, /:is\(ul, ol\) > li:has\(> \.easymde-task-checkbox\)::marker/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> p > \.easymde-task-checkbox\)::marker/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> input\[type="checkbox"\]\)::marker/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> p > input\[type="checkbox"\]\)::marker/);
  assert.match(
    css,
    /ul\s*\{[\s\S]*list-style-type:\s*"—\s+";[\s\S]*\}/
  );
  assert.match(
    css,
    /ul > li::marker\s*\{[\s\S]*color:\s*var\(--easymde-crimson-focus-accent\);/
  );
  assert.doesNotMatch(
    css,
    /ul > li::marker\s*\{[\s\S]*content:\s*"—\s+"/
  );
  assert.doesNotMatch(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus ul > li::before/,
    'top-level unordered markers must use the native marker box'
  );
  assert.match(
    css,
    /ul ul:not\(\.task-list\)\s*\{[\s\S]*margin-inline-start:\s*-22\.5px;[\s\S]*padding-inline-start:\s*0;[\s\S]*list-style:\s*none;/
  );
  assert.match(
    css,
    /ul ul:not\(\.task-list\) > li::before\s*\{[\s\S]*content:\s*"\*";[\s\S]*color:\s*var\(--easymde-crimson-focus-text\);/
  );
  assert.match(
    css,
    /ul ul:not\(\.task-list\) > li\s*\{[\s\S]*margin:\s*11\.25px 0;[\s\S]*list-style:\s*none;/
  );
  assert.match(
    css,
    /\.task-list-item > \.easymde-task-checkbox,[\s\S]*\.task-list-item > p > \.easymde-task-checkbox,[\s\S]*\.task-list-item > input\[type="checkbox"\],[\s\S]*\.task-list-item > p > input\[type="checkbox"\]\s*\{[\s\S]*appearance:\s*none;[\s\S]*margin-inline-end:\s*7\.5px;[\s\S]*vertical-align:\s*baseline;/
  );
  assert.match(css, /:is\(ul, ol\) > li:has\(> \.easymde-task-checkbox\) > \.easymde-task-checkbox/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> p > \.easymde-task-checkbox\) > p > \.easymde-task-checkbox/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> input\[type="checkbox"\]\) > input\[type="checkbox"\]/);
  assert.match(css, /:is\(ul, ol\) > li:has\(> p > input\[type="checkbox"\]\) > p > input\[type="checkbox"\]/);
  assert.match(css, /th\s*\{[\s\S]*text-transform:\s*uppercase;/);
  assert.match(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus th\s*\{[\s\S]*color:\s*#f8fafc;/,
    'table headers should use the exact light text color from the reference UI'
  );
  assert.match(css, /input\[type="checkbox"\]:checked\s*\{[\s\S]*color:\s*var\(--easymde-crimson-focus-accent\);/);
  assert.match(css, /input\[type="checkbox"\]:checked\s*\{[\s\S]*background:\s*var\(--easymde-crimson-focus-accent\);[\s\S]*box-shadow:/);
  assert.match(css, /input\[type="checkbox"\]:checked::after,[\s\S]*input\[type="checkbox"\]:checked::after\s*\{[\s\S]*content:\s*"✓";[\s\S]*color:\s*var\(--easymde-crimson-focus-surface\);/);
  assert.match(css, /\.easymde-task-checkbox\.is-checked\s*\{[\s\S]*background:\s*var\(--easymde-crimson-focus-accent\);[\s\S]*color:\s*var\(--easymde-crimson-focus-surface\);/);
  assert.match(css, /border-inline-start:\s*3px solid/);
  assert.match(css, /border-start-end-radius:\s*4px;/);
  assert.match(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus blockquote\s*\{[\s\S]*font-style:\s*normal;/
  );
  assert.match(
    css,
    /blockquote p,[\s\S]*blockquote li,[\s\S]*blockquote dl\s*\{[\s\S]*font-style:\s*italic;/
  );
  assert.match(
    css,
    /blockquote p code,[\s\S]*blockquote li code,[\s\S]*blockquote p tt,[\s\S]*blockquote li tt\s*\{[\s\S]*font-style:\s*normal;/
  );
  assert.match(css, /\.easymde-task-checkbox\.is-checked,[\s\S]*\{[\s\S]*color:\s*var\(--easymde-crimson-focus-accent\);/);
  assert.match(
    css,
    /blockquote > :not\(pre\):first-child\s*\{[\s\S]*margin-top:\s*0;/
  );
  assert.match(
    css,
    /blockquote > :not\(pre\):last-child\s*\{[\s\S]*margin-bottom:\s*0;/
  );
  assert.match(css, /text-align:\s*start;/);
  assert.match(css, /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus img\s*\{[\s\S]*display:\s*block;[\s\S]*margin:\s*11\.25px auto;/);
  assert.match(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus table\s*\{[\s\S]*min-width:\s*520px;/
  );
  assert.match(
    css,
    /\.table-container\s*\{[\s\S]*overflow-x:\s*auto;/
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus table\s*\{[\s\S]*display:\s*block;/
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*\.easymde-rendered-content\.easymde-markdown-theme-crimson-focus:not\(\.easymde-preview\)\s*\{[^}]*padding:\s*28px 20px 36px;/s
  );
  assert.doesNotMatch(css, /clamp\(/, 'heading sizes should remain stable across viewports');
  assert.ok(contrast(text, white) >= 7, 'body text should meet the light-theme AAA target');
  assert.ok(
    contrast(cssVariable(css, '--easymde-crimson-focus-accent-text'), white) >= 4.5,
    'accent text should meet AA contrast on white'
  );
  assert.ok(
    contrast('#f8fafc', accent) >= 3,
    'table header text should remain legible on the reference accent background'
  );
  assert.ok(contrast(text, soft) >= 4.5, 'body text should meet AA contrast on accent surfaces');
  const normalizedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    cssRuleBodies(normalizedCss, root).length,
    2,
    'base and mobile root rules should be scoped'
  );
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.deepEqual(
    cssRuleSelectors(normalizedCss).filter(targetsCodeFrame),
    [],
    'article theme must not target shared code-frame selectors'
  );

  const dom = new JSDOM(
    `<style>${css}</style>
     <article class="easymde-rendered-content easymde-markdown-theme-crimson-focus">
       <h1>普通编辑 Preview</h1><h2>沉浸式 Preview</h2><p>阅读内容</p>
     </article>`
  );
  const { window } = dom;
  const article = window.document.querySelector(root);
  const heading = window.document.querySelector('h2');

  assert.ok(article);
  assert.ok(heading);
  assert.equal(cssVariable(css, '--easymde-crimson-focus-surface'), '#ffffff');
  assert.equal(cssVariable(css, '--easymde-crimson-focus-heading'), '#0f172a');
});

test('the retired black article theme has no source or release ownership', () => {
  const retiredThemeId = ['geek', 'black'].join('-');
  const registry = readFileSync(join(repoRoot, 'src/Theme/ArticleThemeRegistry.php'), 'utf8');
  const transformer = readFileSync(join(repoRoot, 'src/Content/ThemeMarkupTransformer.php'), 'utf8');

  assert.doesNotMatch(registry, new RegExp(`['"]${retiredThemeId}['"]`));
  assert.doesNotMatch(transformer, new RegExp(`['"]${retiredThemeId}['"]`));
  assert.equal(
    existsSync(join(repoRoot, `assets/themes/article/${retiredThemeId}.css`)),
    false
  );
});

test('Cupid Busy keeps heading decorations at their declared sizes', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/cupid-busy.css'), 'utf8');
  const h1Content = cssRuleBodies(
    css,
    '.easymde-rendered-content.easymde-markdown-theme-cupid-busy h1 .content'
  )[0];
  const h2Content = cssRuleBodies(
    css,
    '.easymde-rendered-content.easymde-markdown-theme-cupid-busy h2 .content'
  )[0];
  const h1Suffix = cssRuleBodies(
    css,
    '.easymde-rendered-content.easymde-markdown-theme-cupid-busy h1 .suffix'
  )[0];
  const h2Prefix = cssRuleBodies(
    css,
    '.easymde-rendered-content.easymde-markdown-theme-cupid-busy h2 .prefix'
  )[0];
  const h2Suffix = cssRuleBodies(
    css,
    '.easymde-rendered-content.easymde-markdown-theme-cupid-busy h2 .suffix'
  )[0];

  assert.match(h1Content, /flex:\s*1 1 auto;/);
  assert.match(h1Content, /min-width:\s*0;/);
  assert.match(h1Content, /overflow-wrap:\s*anywhere;/);
  assert.match(h2Content, /flex:\s*1 1 auto;/);
  assert.match(h2Content, /min-width:\s*0;/);
  assert.match(h2Content, /overflow-wrap:\s*anywhere;/);
  assert.match(h1Suffix, /flex:\s*0 0 20px;/);
  assert.match(h2Prefix, /flex:\s*0 0 35px;/);
  assert.match(h2Suffix, /flex:\s*0 0 15px;/);
});

test('Nenqing Green is removed from the built-in article theme surface', () => {
  const registry = readFileSync(join(repoRoot, 'src/Theme/ArticleThemeRegistry.php'), 'utf8');
  const editorCss = readFileSync(join(repoRoot, 'assets/css/admin/editor.css'), 'utf8');

  assert.doesNotMatch(registry, /['"]nenqing-green['"]/);
  assert.doesNotMatch(editorCss, /\.easymde-immersive-theme-accent\[data-theme=/);
  assert.equal(
    existsSync(join(repoRoot, 'frontend/src/features/appearance/reference-article-theme.ts')),
    false
  );
  assert.equal(existsSync(join(repoRoot, 'assets/themes/article/nenqing-green.css')), false);
});

test('Grid Black and Cupid Busy fix only the first H1 top rhythm', () => {
  for (const theme of ['grid-black', 'cupid-busy']) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const root = `.easymde-rendered-content.easymde-markdown-theme-${theme}`;
    const h1Rules = cssRuleBodies(css, `${root} h1`);
    const firstH1Rules = cssRuleBodies(css, `${root} > h1:first-child`);
    const finalH1Rule = h1Rules.at(-1);
    const firstH1Rule = firstH1Rules.at(-1);

    assert.ok(finalH1Rule, `${theme} should define a final H1 rule`);
    assert.ok(firstH1Rule, `${theme} should define a first-child H1 rule`);
    assert.match(firstH1Rule, /margin-top:\s*30px;/, `${theme} first H1 should remain inside the article root`);
    assert.match(finalH1Rule, /margin-top:\s*-/i, `${theme} later H1 rhythm should remain theme-owned`);
  }
});

test('shared code typography prefers the neutral Mac terminal font stack', () => {
  const css = readFileSync(join(repoRoot, 'assets/css/frontend/base.css'), 'utf8');

  assert.equal(
    cssVariable(css, '--easymde-code-font-family'),
    'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace'
  );
  assert.doesNotMatch(css, /--easymde-code-font-family:[^;]*Operator Mono/);
});

test('Mermaid root tracking isolation is direct-root scoped and preserves descendant spacing', () => {
  const baseCss = readFileSync(join(repoRoot, 'assets/css/frontend/base.css'), 'utf8');
  const rootSelector = '.easymde-mermaid > svg';
  const rootBody = cssRuleBodyMatching(baseCss, rootSelector);

  assert.ok(rootBody, `${rootSelector} should own Mermaid typography isolation`);
  assert.match(rootBody, /letter-spacing:\s*normal;/);
  assert.match(rootBody, /word-spacing:\s*normal;/);
  const genericBody = cssRuleBodyMatching(baseCss, '.easymde-mermaid svg');
  assert.ok(genericBody, 'the shared Mermaid SVG layout rule should remain available');
  assert.doesNotMatch(genericBody, /(?:letter|word)-spacing:/);
  for (const role of ['gantt', 'sequence', 'timeline']) {
    const intrinsicBody = cssRuleBodyMatching(
      baseCss,
      `.easymde-mermaid[data-easymde-mermaid-layout="${role}"] > svg`
    );
    assert.ok(intrinsicBody, `${role} should retain its intrinsic Mermaid width`);
    assert.match(intrinsicBody, /max-width:\s*none;/);
  }

  const greenCss = readFileSync(join(repoRoot, 'assets/themes/article/green-vitality.css'), 'utf8');
  const dom = new JSDOM(`
    <style>${baseCss}\n${greenCss}
      .easymde-rendered-content.easymde-markdown-theme-green-vitality
      .easymde-mermaid .entityLabel {
        letter-spacing: 2px;
        word-spacing: 3px;
      }
    </style>
    <article class="easymde-rendered-content easymde-markdown-theme-green-vitality">
      <svg id="ordinary-svg"><text>ordinary</text></svg>
      <div class="easymde-mermaid">
        <svg id="mermaid-svg">
          <text class="entityLabel">created_at</text>
        </svg>
      </div>
    </article>
  `);
  const ordinarySvg = dom.window.document.querySelector('#ordinary-svg');
  const mermaidSvg = dom.window.document.querySelector('#mermaid-svg');
  const entityLabel = dom.window.document.querySelector('.entityLabel');

  assert.ok(ordinarySvg);
  assert.ok(mermaidSvg);
  assert.ok(entityLabel);
  assert.equal(dom.window.getComputedStyle(ordinarySvg).letterSpacing, '0.05em');
  assert.equal(dom.window.getComputedStyle(mermaidSvg).letterSpacing, 'normal');
  assert.equal(dom.window.getComputedStyle(mermaidSvg).wordSpacing, 'normal');
  assert.equal(dom.window.getComputedStyle(entityLabel).letterSpacing, '2px');
  assert.equal(dom.window.getComputedStyle(entityLabel).wordSpacing, '3px');
});

test('Inkwell light keeps its scoped palette', () => {
  const light = readFileSync(join(repoRoot, 'assets/themes/article/inkwell.css'), 'utf8');
  const root = scopedArticleRoot('inkwell');
  const rootPalette = cssRuleBodyMatching(
    light,
    root,
    (body) => /--text-color:\s*#3d4852;/.test(body)
  );
  const palette = [
    ['--text-color', '#3d4852'],
    ['--heading-color', '#1a2332'],
    ['--heading-secondary', '#2c3e50'],
    ['--link-color', '#3b82c4'],
    ['--code-bg', '#f6f8fb'],
    ['--code-text', '#c7254e'],
    ['--border-color', '#e2e8f0']
  ];

  assert.ok(rootPalette, 'Inkwell light palette must be declared on its scoped article root');
  const dom = new JSDOM(
    `<style>${light}</style><div class="easymde-rendered-content easymde-markdown-theme-inkwell"></div>`
  );
  const renderedRoot = dom.window.document.querySelector(root);
  const computedRoot = dom.window.getComputedStyle(renderedRoot);

  assert.ok(renderedRoot, 'Inkwell light root should match a rendered preview element');
  for (const [name, expected] of palette) {
    assert.equal(cssVariable(rootPalette, name), expected, `${name} should stay on the Inkwell root`);
    assert.equal(
      computedRoot.getPropertyValue(name).trim(),
      expected,
      `${name} should be reachable from the rendered Inkwell root`
    );
  }
  assert.doesNotMatch(light, /(?:^|[,{])\s*(?:html|body|:root)\s*(?:[,\{])/m);
});

test('Spring heading decoration remains contained in narrow preview panes', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/spring.css'), 'utf8');
  const rule = cssRuleBodies(
    css,
    '.easymde-rendered-content.easymde-markdown-theme-spring h2:after'
  ).at(-1);

  assert.ok(rule);
  assert.match(rule, /width:\s*min\(30rem,\s*100%\);/);
  assert.match(rule, /max-width:\s*100%;/);
  assert.match(
    rule,
    /background:\s*var\(--write-h2-after-bg\);/,
    'Spring H2 decoration should retain the source gradient variable'
  );
});

test('Typora-derived adapters preserve their pinned scoped inline-code rules', () => {
  assertInlineCodeRule('animal-island', ':not(pre) > code', [
    /font-family:\s*var\(--ai-mono\);/,
    /font-size:\s*0\.9em;/,
    /color:\s*var\(--ai-primary-active\);/,
    /background:\s*var\(--ai-primary-bg\);/,
    /padding:\s*2px 8px;/,
    /border:\s*1\.5px solid #cdeeea;/,
    /border-radius:\s*6px;/
  ]);
  assertInlineCodeRule('mdmdt', ':not(pre) > code', [
    /border-radius:\s*4px;/,
    /background:\s*var\(--color-1-0-a\);/,
    /padding:\s*3px 5px;/,
    /color:\s*var\(--text-code\);/,
    /font-size:\s*14px;/,
    /box-decoration-break:\s*clone;/
  ]);
  assertInlineCodeRule('dogschoice-pink', ':not(pre) > code', [
    /color:\s*var\(--code-inline--color\);/,
    /background-color:\s*var\(--code-inline-bg-color\);/,
    /padding:\s*2px;/,
    /font-size:\s*95%;/,
    /display:\s*inline;/,
    /vertical-align:\s*middle;/
  ]);
  assertInlineCodeRule('spring', ':not(pre) > code', [
    /background-color:\s*var\(--code-bg-color\);/,
    /color:\s*var\(--code-color\);/,
    /font-size:\s*1rem;/,
    /font-weight:\s*550;/,
    /margin:\s*0 2px;/,
    /padding:\s*3px 3px 1px;/,
    /border-radius:\s*7px;/
  ]);

  const phycatThemes = {
    'phycat-cherry': ':not(pre) > code:not(.md-fencescode)',
    'phycat-caramel': ':not(pre) > code:not(.md-fencescode)',
    'phycat-forest': ':not(pre) > code:not(.md-fencescode)',
    'phycat-mint': ':not(pre) > code:not(.md-fencescode)',
    'phycat-sky': ':not(pre) > code',
    'phycat-prussian': ':not(pre) > code',
    'phycat-sakura': ':not(pre) > code',
    'phycat-mauve': ':not(pre) > code'
  };
  for (const [theme, selector] of Object.entries(phycatThemes)) {
    assertInlineCodeRule(theme, selector, [
      /font-family:\s*var\(--easymde-code-font-family\);/,
      /font-size:\s*\.9em;/,
      /letter-spacing:\s*\.5px;/,
      /padding:\s*5px 5px;/,
      /margin:\s*0 2px;/,
      /border-radius:\s*6px;/,
      /vertical-align:\s*middle;/
    ]);
  }

  const bloomThemes = [
    'bloom-petal',
    'bloom-mist',
    'bloom-verdant',
    'bloom-stone',
    'bloom-wheat',
    'bloom-ink',
    'bloom-amber',
    'bloom-lapis',
    'bloom-ripple',
    'bloom-cinnabar',
    'bloom-sage',
    'bloom-spring'
  ];
  for (const theme of bloomThemes) {
    assertInlineCodeRule(theme, ':not(pre) > code', [
      /font-size:\s*0\.88em;/,
      /padding:\s*0\.2em 0\.45em;/,
      /border-radius:\s*7px;/,
      /background:\s*rgba\(var\(--accent-rgb\), 0\.14\);/,
      /color:\s*var\(--accent\);/,
      /font-weight:\s*600;/,
      /border:\s*1px solid rgba\(var\(--accent-rgb\), 0\.32\);/
    ]);
  }
});

test('Mdmdt retains the pinned nested-list rhythm', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/mdmdt.css'), 'utf8');
  const root = scopedArticleRoot('mdmdt');
  const expected = [
    [`${root} ul`, /padding-left:\s*36px;/],
    [`${root} ol`, /padding-left:\s*40px;/],
    [`${root} ol ol`, /margin-left:\s*-7px;/],
    [`${root} ol > li > ul`, /margin-left:\s*-7px;/],
    [`${root} ul > li > ol`, /margin-left:\s*-2px;/],
    [`${root} ul > li > p`, /margin:\s*0 0 0 -2px;/],
    [`${root} ol > li > p`, /margin:\s*0 0 0 -6px;/],
    [`${root} ul > .task-list-item > input`, /margin-left:\s*-22px;/],
    [`${root} li`, /margin-top:\s*6px;/],
    [`${root} li > p`, /margin:\s*-5px 0;/]
  ];

  for (const [selector, declaration] of expected) {
    assert.ok(
      cssRuleBodyMatching(css, selector, (body) => declaration.test(body)),
      `Mdmdt should keep ${selector} ${declaration}`
    );
  }
  assert.doesNotMatch(
    css,
    new RegExp(`${escapedRegExp(root)} ul\\s*,\\s*${escapedRegExp(root)} ul\\s*\\{`),
    'Mdmdt must not reintroduce the duplicate broad-list override'
  );
});

test('Mdmdt restores ordinary unordered-list marker semantics without task bullets', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/mdmdt.css'), 'utf8');
  const root = scopedArticleRoot('mdmdt');
  const expected = [
    [`${root} ul:not(.task-list)`, /list-style-type:\s*disc;/],
    [`${root} :is(ul, ol) ul:not(.task-list)`, /list-style-type:\s*circle;/],
    [`${root} :is(ul, ol) :is(ul, ol) ul:not(.task-list)`, /list-style-type:\s*square;/],
    [`${root} ul.task-list`, /list-style-type:\s*none;/],
    [`${root} ol.task-list`, /list-style-type:\s*none;/],
    [`${root} .task-list-item`, /list-style-type:\s*none;/],
    [`${root} .task-list-item::marker`, /content:\s*none;/]
  ];

  for (const [selector, declaration] of expected) {
    assert.ok(
      cssRuleBodyMatching(css, selector, (body) => declaration.test(body)),
      `Mdmdt should define ${selector} with ${declaration}`
    );
  }
});

test('Mdmdt link pseudo assets are deterministic 200x200 PNG data images', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/mdmdt.css'), 'utf8');
  const root = scopedArticleRoot('mdmdt');
  assert.match(css, /\* \(c\) 2024-2025/);
  assert.match(css, /\* Author: cayxc/);
  assert.match(css, /\* Homepage:\s+https:\/\/gitee\.com\/cayxc\/mdmdt\s+https:\/\/github\.com\/cayxc\/Mdmdt/);
  assert.match(css, /\* License: Apache-2\.0/);
  assert.match(css, /cayxc\/Mdmdt fixed commit a2f7d357144e38670727e876243a7fe58df2e848/);
  const normal = dataImageUrlsFromRule(css, `${root} p a::before`);
  const hover = dataImageUrlsFromRule(css, `${root} a:hover::before`);

  assert.equal(normal.length, 1, 'Mdmdt normal link pseudo should have one image');
  assert.equal(hover.length, 1, 'Mdmdt hover link pseudo should have one image');
  const normalBytes = decodePngDataUrl(normal[0], 'Mdmdt normal link icon');
  const hoverBytes = decodePngDataUrl(hover[0], 'Mdmdt hover link icon');
  assert.equal(
    createHash('sha256').update(normalBytes).digest('hex'),
    'bc3e0e6608577697dc637543cc18da1b1693885074c886f85dec8ef4827ebf0b',
    'Mdmdt normal link icon must remain deterministic'
  );
  assert.equal(
    createHash('sha256').update(hoverBytes).digest('hex'),
    'ce19afa2113e61b3e357aee067188386f5b847ac3b7e225543e33a0c6b9713d7',
    'Mdmdt hover link icon must remain deterministic'
  );
  assert.notEqual(normal[0], hover[0], 'Mdmdt normal and hover colors must differ');
  assert.doesNotMatch(css, /data:image\/svg\+xml/i, 'Mdmdt must not ship SVG link pseudo data');
});

test('Mdmdt list markers follow ancestor list depth through wrappers and mixed lists', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/mdmdt.css'), 'utf8');
  const root = scopedArticleRoot('mdmdt');
  const dom = new JSDOM(`
    <style>${css}</style>
    <article class="easymde-rendered-content easymde-markdown-theme-mdmdt">
      <ul id="root-list">
        <li>
          <blockquote>
            <ul id="blockquote-list">
              <li>
                <blockquote>
                  <ol id="mixed-list">
                    <li>
                      <blockquote>
                        <ul id="square-list"><li>Square</li></ul>
                      </blockquote>
                    </li>
                  </ol>
                </blockquote>
              </li>
            </ul>
          </blockquote>
        </li>
      </ul>
      <ul id="task-list" class="task-list">
        <li class="task-list-item"><input type="checkbox" disabled>Task</li>
        <li><blockquote><ul id="task-nested-list"><li>Nested</li></ul></blockquote></li>
      </ul>
    </article>
  `);
  const styleOf = (id) => dom.window.getComputedStyle(dom.window.document.getElementById(id));

  assert.equal(styleOf('root-list').listStyleType, 'disc');
  assert.equal(styleOf('blockquote-list').listStyleType, 'circle');
  assert.equal(styleOf('mixed-list').listStyleType, 'decimal');
  assert.equal(styleOf('square-list').listStyleType, 'square');
  assert.equal(styleOf('task-list').listStyleType, 'none');
  assert.equal(
    dom.window.getComputedStyle(dom.window.document.querySelector('.task-list-item')).listStyleType,
    'none'
  );
  assert.equal(styleOf('task-nested-list').listStyleType, 'circle');
  assert.ok(dom.window.document.querySelector(`${root} .task-list-item`));
});

test('Mdmdt shares task checkbox paint across native and visual markers', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/mdmdt.css'), 'utf8');
  const root = scopedArticleRoot('mdmdt');
  const markerSelectors = [
    `${root} .task-list-item > input[type="checkbox"]`,
    `${root} .task-list-item > p > input[type="checkbox"]`,
    `${root} .task-list-item > .easymde-task-checkbox`,
    `${root} .task-list-item > p > .easymde-task-checkbox`
  ];
  const sharedDeclarations = [
    /position:\s*relative;/,
    /display:\s*inline-block;/,
    /width:\s*14px\s*!important;/,
    /height:\s*14px\s*!important;/,
    /min-width:\s*14px\s*!important;/,
    /min-height:\s*14px\s*!important;/,
    /max-width:\s*14px\s*!important;/,
    /max-height:\s*14px\s*!important;/,
    /box-sizing:\s*border-box;/,
    /border:\s*1px\s+solid\s+var\(--border-color\)\s*!important;/
  ];

  for (const selector of markerSelectors) {
    assert.ok(
      cssRuleBodyMatching(css, selector, (body) => sharedDeclarations.every((declaration) => declaration.test(body))),
      `Mdmdt should share task marker declarations for ${selector}`
    );
  }

  for (const selector of markerSelectors) {
    assert.ok(
      cssRuleBodyMatching(css, selector, (body) => /margin-left:\s*-22px;/.test(body)),
      `Mdmdt should anchor task markers for ${selector}`
    );
  }

  const checkedSelectors = [
    `${root} .task-list-item > input[type="checkbox"]:checked`,
    `${root} .task-list-item > p > input[type="checkbox"]:checked`,
    `${root} .task-list-item > .easymde-task-checkbox.is-checked`,
    `${root} .task-list-item > p > .easymde-task-checkbox.is-checked`
  ];
  for (const selector of checkedSelectors) {
    assert.ok(
      cssRuleBodyMatching(css, selector, (body) => /background:\s*var\(--color-1\)\s*!important;/.test(body)),
      `Mdmdt should paint checked task markers for ${selector}`
    );
  }

  const checkedPseudoSelectors = [
    `${root} .task-list-item > input[type="checkbox"]:checked::after`,
    `${root} .task-list-item > p > input[type="checkbox"]:checked::after`,
    `${root} .task-list-item > .easymde-task-checkbox.is-checked::after`,
    `${root} .task-list-item > p > .easymde-task-checkbox.is-checked::after`
  ];
  for (const selector of checkedPseudoSelectors) {
    assert.ok(
      cssRuleBodyMatching(css, selector, (body) => /border:\s*2px\s+solid\s+#fff;/.test(body)),
      `Mdmdt should reuse the checked marker tick for ${selector}`
    );
  }

  assert.ok(
    cssRuleBodyMatching(
      css,
      `${root} .task-list-item > .easymde-task-checkbox.is-checked`,
      (body) => /font-size:\s*0;/.test(body)
    ),
    'Mdmdt should visually hide the span marker text while retaining its DOM/ARIA value'
  );
  assert.ok(
    cssRuleBodyMatching(
      css,
      `${root} .task-list-item > input[type="checkbox"]::before`,
      (body) => /content:\s*none\s*!important;/.test(body)
    ),
    'Mdmdt should suppress a host input before pseudo'
  );
});

test('Bloom retains source heading tracking and Petal release heading color', () => {
  const bloomThemes = [
    'bloom-petal',
    'bloom-mist',
    'bloom-verdant',
    'bloom-stone',
    'bloom-wheat',
    'bloom-ink',
    'bloom-amber',
    'bloom-lapis',
    'bloom-ripple',
    'bloom-cinnabar',
    'bloom-sage',
    'bloom-spring'
  ];

  for (const theme of bloomThemes) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const root = scopedArticleRoot(theme);
    const rootPattern = escapedRegExp(root);
    const printColorRule = cssRuleBodyMatching(
      css,
      `${root} *`,
      (body) => /(?:-webkit-)?print-color-adjust:\s*exact\s*!important;/.test(body)
    );
    assert.ok(printColorRule, `${theme} should preserve printed theme colors`);
    assert.match(printColorRule, /-webkit-print-color-adjust:\s*exact\s*!important;/);
    assert.match(printColorRule, /(?:^|\s)print-color-adjust:\s*exact\s*!important;/);
    const headingGroup = css.match(
      new RegExp(
        `${rootPattern} h1\\s*,\\s*${rootPattern} h2\\s*,\\s*${rootPattern} h3\\s*,\\s*${rootPattern} h4\\s*,\\s*${rootPattern} h5\\s*,\\s*${rootPattern} h6\\s*\\{([^}]*)\\}`,
        's'
      )
    );
    assert.ok(headingGroup, `${theme} should define the shared heading group`);
    assert.match(headingGroup[1], /letter-spacing:\s*-0\.015em;/, `${theme} heading tracking`);

    const h1Rule = cssRuleBodyMatching(
      css,
      `${root} h1`,
      (body) => /font-size:\s*2\.25em;/.test(body)
    );
    assert.ok(h1Rule, `${theme} should define its h1 rule`);
    assert.match(h1Rule, /letter-spacing:\s*-0\.02em;/, `${theme} h1 tracking`);
  }

  const petal = readFileSync(join(repoRoot, 'assets/themes/article/bloom-petal.css'), 'utf8');
  assert.match(
    petal,
    /\.easymde-rendered-content\.easymde-markdown-theme-bloom-petal h1\s*\{[^}]*border-bottom:\s*1px solid rgba\(var\(--accent-rgb\), 0\.3\);/s,
    'Bloom Petal h1 border should retain the release alpha color'
  );
});

test('registered Typora article themes contain no unreachable alert adapters', () => {
  for (const theme of TYPORA_ARTICLE_THEME_IDS) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');

    assert.doesNotMatch(css, /\.md-alert(?:[\w-]*)?|blockquote\s*\[\s*data-type/iu, theme);
  }
});

test('Typora-derived article roots delegate frame geometry to the owning preview surface', () => {
  assert.equal(TYPORA_ARTICLE_THEME_IDS.length, 25);
  const failures = [];

  for (const theme of TYPORA_ARTICLE_THEME_IDS) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const root = scopedArticleRoot(theme);
    const rootRules = parseCssRules(css).filter((rule) => rule.selectors
      .map(normalizeCssSelector)
      .includes(root));
    const violations = rootOwnershipViolations(css, root);
    const pseudoRules = rootPseudoRules(css, root);

    if (rootRules.length === 0 || violations.length > 0 || pseudoRules.length > 0) {
      failures.push({
        theme,
        violations,
        pseudoRules,
        hasExactRootRule: rootRules.length > 0
      });
    }
  }

  assert.deepEqual(failures, [], `article root contract failures: ${JSON.stringify(failures)}`);
});

test('registered article CSS has valid selector preludes and reachable scoped roots', () => {
  const themes = registeredArticleThemes();
  const dom = new JSDOM('<!doctype html><div></div>');
  const failures = [];

  assert.ok(themes.length > 0, 'article theme registry should expose CSS assets');

  for (const { id, assetPath } of themes) {
    const css = readFileSync(join(repoRoot, assetPath), 'utf8');
    const root = scopedArticleRoot(id);
    const parsedRules = parseCssRules(css);
    const rootRules = parsedRules.filter((rule) => rule.selectors
      .map(normalizeCssSelector)
      .includes(root));
    const selectorFailures = selectorPreludeFailures(css, dom);

    if (selectorFailures.length > 0 || rootRules.length === 0) {
      failures.push({
        assetPath,
        id,
        rootReachable: rootRules.length > 0,
        selectorFailures
      });
    }
  }

  assert.deepEqual(
    failures,
    [],
    `registered article CSS selector contract failures: ${JSON.stringify(failures)}`
  );
});

test('Rose Purple owns the article-scoped 20px light-gray grid while Ningye Purple remains plain', () => {
  const exactRootDeclarations = (css, root) => parseCssRules(css).flatMap((rule) => {
    if (!rule.selectors.map(normalizeCssSelector).includes(root)) return [];
    return splitCssDeclarations(rule.body);
  });
  const valuesFor = (declarations, property) => declarations
    .filter((declaration) => declaration.property === property)
    .map((declaration) => declaration.value.replace(/\s+/g, ' '));

  const roseTheme = 'rose-purple';
  const roseRoot = scopedArticleRoot(roseTheme);
  const roseCss = readFileSync(join(repoRoot, `assets/themes/article/${roseTheme}.css`), 'utf8');
  const roseDeclarations = exactRootDeclarations(roseCss, roseRoot);
  const roseRootRule = cssRuleBodyMatching(
    roseCss,
    roseRoot,
    (body) => body.includes('background-image:')
  );

  assert.ok(roseRootRule, 'Rose Purple must define its own article grid rule');
  assert.deepEqual(
    valuesFor(roseDeclarations, 'background-image'),
    [
      'linear-gradient(90deg, rgba(50, 0, 0, 0.05) 0%, rgba(0, 0, 0, 0) 6.76%), linear-gradient(360deg, rgba(50, 0, 0, 0.05) 0%, rgba(249, 247, 252, 0) 9.46%)'
    ],
    'Rose Purple must have exactly one root background-image declaration'
  );
  assert.deepEqual(valuesFor(roseDeclarations, 'background-size'), ['20px 20px, 20px 20px']);
  assert.deepEqual(valuesFor(roseDeclarations, 'background-repeat'), ['repeat, repeat']);
  assert.deepEqual(valuesFor(roseDeclarations, 'background-position'), ['0% 0%']);
  assert.deepEqual(
    valuesFor(roseDeclarations, 'background'),
    [],
    'Rose Purple must not use a root background shorthand that can erase its grid'
  );
  assert.equal(
    rootPseudoRules(roseCss, roseRoot).length,
    0,
    'the grid must not be implemented by a root pseudo-element'
  );

  const ningyeTheme = 'ningye-purple';
  const ningyeRoot = scopedArticleRoot(ningyeTheme);
  const ningyeCss = readFileSync(join(repoRoot, `assets/themes/article/${ningyeTheme}.css`), 'utf8');
  const ningyeDeclarations = exactRootDeclarations(ningyeCss, ningyeRoot);
  assert.deepEqual(
    valuesFor(ningyeDeclarations, 'background-image'),
    ['none'],
    'Ningye Purple must have exactly one root background-image declaration'
  );
  assert.deepEqual(
    valuesFor(ningyeDeclarations, 'background'),
    [],
    'Ningye Purple must not use a root background shorthand that can add a grid'
  );
  assert.deepEqual(
    ningyeDeclarations.filter((declaration) => (
      declaration.property === 'background-size'
      || declaration.property === 'background-repeat'
      || declaration.property === 'background-position'
    )),
    [],
    'Ningye Purple must not carry grid geometry on any exact root rule'
  );
});

test('article-root geometry contract catches root frames without rejecting nested decorations', () => {
  const root = scopedArticleRoot('contract-fixture');
  const invalidFixture = `
    @media (max-width: 640px) {
      ${root} {
        max-width: 680px;
        margin: 0 auto;
        padding: 24px;
        background: #eeeeee;
        border-left: 4px solid #d9d9d9;
        box-shadow: 0 4px 12px rgb(0 0 0 / 20%);
      }
      ${root}::before {
        content: "rail";
        position: absolute;
        width: 8px;
        background: #eeeeee;
      }
      ${root} blockquote {
        border-left: 3px solid #e74c3c;
      }
    }
  `;
  const violations = rootOwnershipViolations(invalidFixture, root);

  assert.ok(violations.some(({ property }) => property === 'max-width'));
  assert.ok(violations.some(({ property }) => property === 'margin'));
  assert.ok(violations.some(({ property }) => property === 'padding'));
  assert.ok(violations.some(({ property }) => property === 'background'));
  assert.ok(violations.some(({ property }) => property === 'border-left'));
  assert.ok(violations.some(({ property }) => property === 'box-shadow'));
  assert.ok(violations.some(({ selector }) => selector.endsWith('::before')));
  assert.equal(
    violations.some(({ selector }) => selector === `${root} blockquote`),
    false,
    'nested blockquote decorations must remain theme-owned'
  );

  const validFixture = `${root} blockquote { border-left: 3px solid #e74c3c; }`;
  assert.deepEqual(
    rootOwnershipViolations(validFixture, root),
    [],
    'nested blockquote decoration should not count as root geometry'
  );
});

test('DogsChoice keeps the upstream 七彩虹 pink palette in a scoped adapter', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/dogschoice-pink.css'), 'utf8');
  const root = '.easymde-rendered-content.easymde-markdown-theme-dogschoice-pink';

  assert.match(css, new RegExp(`${root.replaceAll('.', '\\.')}`));
  assert.equal(cssVariable(css, '--img-border-color'), '#FFE8F7');
  assert.equal(cssVariable(css, '--text-em-color'), '#f55066');
  assert.equal(cssVariable(css, '--h1-background-color'), '#FFE8E8');
  assert.equal(cssVariable(css, '--blockquote-bg-color'), '#E4FFEA');
  assert.doesNotMatch(css, /(^|\n)\s*(?:html|body|:root)\s*\{/m);
  assert.doesNotMatch(css, /dogs-(?:jidilan|yuanshanlv)\.css/);
  assert.doesNotMatch(
    css,
    new RegExp(`${escapedRegExp(root)}\\s+tt\\s*\\{`),
    'plain tt must not retain the upstream oversized inline box'
  );
  const ttBody = cssRuleBodyMatching(css, `${root} :not(pre) > tt`);
  assert.ok(ttBody, 'inline tt must share the scoped inline-code adapter');
  assert.match(ttBody, /padding:\s*2px;/);
  assert.match(ttBody, /font-size:\s*95%;/);
  assert.match(ttBody, /display:\s*inline;/);
  assert.match(ttBody, /vertical-align:\s*middle;/);
});

test('Bloom adapters target live Mermaid roots and contain no unreachable focus hooks', () => {
  const bloomFiles = readdirSync(join(repoRoot, 'assets/themes/article'))
    .filter((name) => /^bloom-.*\.css$/.test(name));

  assert.equal(bloomFiles.length, 12, 'all Bloom light variants should be present');

  for (const file of bloomFiles) {
    const css = readFileSync(join(repoRoot, 'assets/themes/article', file), 'utf8');
    const themeId = file.replace(/\.css$/, '');
    const root = scopedArticleRoot(themeId);

    assert.ok(css.includes(root), `${file} should declare its own EasyMDE root`);
    const literalRoot = escapedRegExp(root);

    assert.match(
      css,
      new RegExp(`${literalRoot}\\s+\\.easymde-mermaid(?:\\b|\\s)`),
      `${file} must style the live EasyMDE Mermaid root`
    );
    const articleRootBodies = cssRuleBodies(css, root);
    assert.ok(articleRootBodies.length, `${file} should preserve its scoped article root`);
    assert.ok(
      articleRootBodies.some((body) => /font-family:\s*var\(--font-sans\);/.test(body)),
      `${file} should keep the Bloom font for ordinary article text`
    );
    const mermaidTextBody = cssRuleBodyMatching(css, `${root} .easymde-mermaid text`);
    assert.ok(mermaidTextBody, `${file} should define its Mermaid text palette rule`);
    assert.match(
      mermaidTextBody,
      /fill:\s*var\(--text\)\s*!important;/,
      `${file} should preserve Mermaid text color`
    );
    assert.doesNotMatch(
      mermaidTextBody,
      /font-family\s*:/,
      `${file} must not override the Mermaid text font used during layout measurement`
    );
    assert.doesNotMatch(css, /(^|[\s,>+~])\.mermaid(?:\b|[\s>.:#[])/m, `${file} has a dead Mermaid class`);
    assert.doesNotMatch(css, /\.on-focus-mode\b|\.md-focus-element\b/, `${file} has dead Typora focus hooks`);
  }
});

test('Bloom mindmap roots pair theme text with a readable background', () => {
  const bloomFiles = readdirSync(join(repoRoot, 'assets/themes/article'))
    .filter((name) => /^bloom-.*\.css$/.test(name));
  assert.equal(bloomFiles.length, 12, 'all Bloom light variants should be present');

  const dom = new JSDOM('<span></span>');
  const probe = dom.window.document.querySelector('span');
  const toHex = (value) => {
    probe.style.color = '';
    probe.style.color = `color-mix(in srgb, ${value} 100%, black)`;
    const color = dom.window.getComputedStyle(probe).color;
    const match = color.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/);
    assert.ok(match, `expected an opaque sRGB color for ${value}`);
    return `#${match.slice(1).map((channel) => Math.round(Number(channel) * 255).toString(16).padStart(2, '0')).join('')}`;
  };

  for (const file of bloomFiles) {
    const css = readFileSync(join(repoRoot, 'assets/themes/article', file), 'utf8');
    const root = scopedArticleRoot(file.replace(/\.css$/, ''));
    const textBody = cssRuleBodyMatching(css, `${root} .easymde-mermaid text`);
    assert.match(textBody ?? '', /fill:\s*var\(--text\)\s*!important;/, `${file} should retain its Mermaid text color`);
    assert.ok(
      contrast(toHex(cssVariable(css, '--text')), toHex(cssVariable(css, '--bg'))) >= 4.5,
      `${file} text and background should meet AA contrast`
    );

    for (const shape of ['rect', 'path', 'circle', 'polygon']) {
      const selector = `${root} .easymde-mermaid .mindmap-node.section-root ${shape}`;
      const body = cssRuleBodyMatching(css, selector);
      assert.ok(body, `${file} should style the mindmap root ${shape}`);
      assert.match(body.trim(), /^fill:\s*var\(--bg\)\s*!important;$/, `${file} should only set the root background fill`);
    }
  }
});

test('Phycat and Mdmdt adapters contain no document-host numbering, scrollbar, or page rules', () => {
  const phycatThemes = [
    'phycat-cherry',
    'phycat-caramel',
    'phycat-forest',
    'phycat-mint',
    'phycat-sky',
    'phycat-prussian',
    'phycat-sakura',
    'phycat-mauve'
  ];

  for (const theme of phycatThemes) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const root = escapedRegExp(scopedArticleRoot(theme));

    assert.doesNotMatch(css, /--autonum-h[1-6]\s*:/, `${theme} has automatic heading variables`);
    assert.doesNotMatch(css, /\bcounter-(?:reset|increment)\s*:/, `${theme} has automatic heading counters`);
    assert.doesNotMatch(css, new RegExp(`${root}::\\-webkit-scrollbar`), `${theme} owns the host scrollbar`);
    assert.doesNotMatch(css, /@page\b/, `${theme} owns the global print page`);
  }

  assert.doesNotMatch(
    readFileSync(join(repoRoot, 'assets/themes/article/mdmdt.css'), 'utf8'),
    /@page\b/,
    'Mdmdt must not own the global print page'
  );
});

test('all Phycat list items anchor their task and connector decorations', () => {
  const phycatThemes = [
    'phycat-cherry',
    'phycat-caramel',
    'phycat-forest',
    'phycat-mint',
    'phycat-sky',
    'phycat-prussian',
    'phycat-sakura',
    'phycat-mauve'
  ];

  for (const theme of phycatThemes) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const body = cssRuleBodyMatching(
      css,
      `${scopedArticleRoot(theme)} li`,
      (candidate) => /(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/.test(candidate)
    );

    assert.ok(body, `${theme} list items must establish the containing block for absolute decorations`);
  }
});

test('all Phycat task adapters neutralize host checkbox rules and anchor loose rows to direct paragraphs', () => {
  const phycatThemes = [
    'phycat-cherry',
    'phycat-caramel',
    'phycat-forest',
    'phycat-mint',
    'phycat-sky',
    'phycat-prussian',
    'phycat-sakura',
    'phycat-mauve'
  ];
  const hostCheckboxCss = `
    input[type="checkbox"] {
      box-sizing: content-box;
      font-size: 14px;
      margin: -4px 4px 0;
      opacity: .4;
      padding: 6px;
      background: rgb(1 2 3);
      box-shadow: 0 0 0 2px rgb(4 5 6);
    }
  `;

  for (const theme of phycatThemes) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const root = scopedArticleRoot(theme);
    const taskItemBody = cssRuleBodyMatching(
      css,
      `${root} .task-list-item`,
      (body) => /position:\s*relative/.test(body)
        && /list-style-type:\s*none/.test(body)
        && /padding-left:\s*0/.test(body)
    );
    const inputBody = cssRuleBodyMatching(
      css,
      `${root} .task-list-item input`,
      (body) => /font:\s*inherit/.test(body)
        && /line-height:\s*normal/.test(body)
        && /box-sizing:\s*border-box/.test(body)
        && /padding:\s*0/.test(body)
        && /margin:\s*calc\(1em - 10px\)\s+0\s+0\s+-1\.2em/.test(body)
        && /border:\s*none/.test(body)
        && /background:\s*transparent/.test(body)
        && /box-shadow:\s*none/.test(body)
        && /opacity:\s*1/.test(body)
        && /width:\s*1\.3rem/.test(body)
        && /height:\s*1\.3rem/.test(body)
        && /top:\s*3px/.test(body)
        && /left:\s*-22px/.test(body)
    );
    const beforeBody = cssRuleBodyMatching(
      css,
      `${root} .task-list-item input::before`,
      (body) => /opacity:\s*1/.test(body)
        && /top:\s*-2px/.test(body)
        && /left:\s*18px/.test(body)
    );
    const afterBody = cssRuleBodyMatching(
      css,
      `${root} .task-list-item input::after`,
      (body) => /top:\s*40%/.test(body)
        && /left:\s*138%/.test(body)
        && /opacity:\s*0/.test(body)
    );
    const paragraphBody = cssRuleBodyMatching(
      css,
      `${root} .task-list-item > p:has(> input[type="checkbox"])`,
      (body) => /position:\s*relative/.test(body)
        && /line-height:\s*inherit/.test(body)
    );

    assert.ok(taskItemBody, `${theme} task rows should own list positioning and marker removal`);
    assert.ok(inputBody, `${theme} task inputs should restore the Typora base input contract`);
    assert.ok(beforeBody, `${theme} task marker circles should keep their upstream offset and isolate host pseudo-element opacity`);
    assert.ok(afterBody, `${theme} task checkmarks should keep their upstream offset`);
    assert.ok(paragraphBody, `${theme} loose task rows should anchor direct paragraph owners`);

    const dom = new JSDOM(
      `<style>${hostCheckboxCss}${css}</style>
      <article class="easymde-rendered-content easymde-markdown-theme-${theme}">
        <ul>
          <li class="task-list-item"><input id="${theme}-tight" type="checkbox">Tight</li>
          <li class="task-list-item"><p id="${theme}-owner"><input type="checkbox">Loose</p></li>
          <li class="task-list-item"><div><p id="${theme}-nested">Ordinary nested paragraph</p></div></li>
        </ul>
      </article>`
    );
    const { window } = dom;
    const inputStyle = window.getComputedStyle(
      window.document.querySelector(`#${theme}-tight`)
    );
    const ownerStyle = window.getComputedStyle(
      window.document.querySelector(`#${theme}-owner`)
    );
    const nestedStyle = window.getComputedStyle(
      window.document.querySelector(`#${theme}-nested`)
    );

    assert.equal(inputStyle.boxSizing, 'border-box', `${theme} should override host content-box sizing`);
    assert.equal(inputStyle.opacity, '1', `${theme} should override host disabled opacity`);
    assert.equal(inputStyle.padding, '0px', `${theme} should override host checkbox padding`);
    assert.equal(ownerStyle.position, 'relative', `${theme} should position loose task content from its direct paragraph`);
    assert.equal(nestedStyle.position, 'static', `${theme} should not position nested ordinary paragraphs`);
  }
});

test('all Phycat H1 decorations use normal flow and preserve neighboring declarations', () => {
  const phycatThemes = [
    'phycat-cherry',
    'phycat-caramel',
    'phycat-forest',
    'phycat-mint',
    'phycat-sky',
    'phycat-prussian',
    'phycat-sakura',
    'phycat-mauve'
  ];
  const expectedDeclarations = {
    h3: [
      ['position', 'relative'],
      ['width', 'fit-content'],
      ['margin', '20px 0'],
      ['text-align', 'left'],
      ['font-size', '1.3rem'],
      ['padding-left', '10px'],
      ['transition', 'all .3s cubic-bezier(.25, .8, .25, 1)']
    ],
    blockquote: [
      ['position', 'relative'],
      ['margin', '20px 0'],
      ['padding', '18px 20px 18px 48px'],
      ['background-color', 'var(--element-color-soo-shallow)'],
      ['border', 'none'],
      ['border-radius', '16px'],
      ['color', '#555'],
      ['line-height', '1.6'],
      ['transition', 'transform .3s cubic-bezier(.34, 1.56, .64, 1), background-color .3s ease']
    ],
    link: [
      ['color', '#333'],
      ['text-decoration', 'none'],
      ['font-weight', '500'],
      ['padding', '2px 4px'],
      ['margin', '0 -2px'],
      ['border-radius', '4px'],
      ['background', '0 0'],
      ['border-bottom', 'none'],
      ['transition', 'all .2s ease']
    ]
  };

  const normalizeDeclarations = (body, label) => {
    assert.ok(body, `${label} should be declared`);
    return splitCssDeclarations(body).map(({ property, value }) => [
      property,
      value.replace(/\s+/g, ' ').trim()
    ]);
  };

  for (const theme of phycatThemes) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${theme}.css`), 'utf8');
    const root = scopedArticleRoot(theme);
    const h1 = cssRuleBodyMatching(css, `${root} h1`);
    const after = cssRuleBodyMatching(css, `${root} h1::after`);
    const hoverAfter = cssRuleBodyMatching(css, `${root} h1:hover::after`);

    assert.ok(h1, `${theme} should define an H1 rule`);
    assert.ok(after, `${theme} should define an H1 after rule`);
    assert.ok(hoverAfter, `${theme} should define an H1 hover after rule`);

    const h1Declarations = Object.fromEntries(normalizeDeclarations(h1, `${theme} H1`));
    const afterDeclarations = Object.fromEntries(normalizeDeclarations(after, `${theme} H1 after`));
    const hoverAfterDeclarations = Object.fromEntries(
      normalizeDeclarations(hoverAfter, `${theme} H1 hover after`)
    );

    assert.equal(h1Declarations['padding-bottom'], '0', `${theme} H1 should reserve no bottom padding`);
    assert.equal(afterDeclarations.display, 'block', `${theme} H1 after should stay in normal flow`);
    assert.equal(afterDeclarations.width, '40px', `${theme} H1 after width`);
    assert.equal(afterDeclarations.height, '4px', `${theme} H1 after height`);
    assert.equal(afterDeclarations.margin, '8px auto 0', `${theme} H1 after spacing and centering`);
    assert.equal(
      Number.parseFloat(afterDeclarations.margin) + Number.parseFloat(afterDeclarations.height),
      12,
      `${theme} H1 after should retain the 12px total decoration space`
    );
    assert.equal(afterDeclarations.position, undefined, `${theme} H1 after must not be positioned`);
    assert.equal(afterDeclarations.left, undefined, `${theme} H1 after must not use left positioning`);
    assert.equal(afterDeclarations.bottom, undefined, `${theme} H1 after must not use bottom positioning`);
    assert.equal(afterDeclarations.transform, undefined, `${theme} H1 after must not translate for centering`);
    assert.equal(hoverAfterDeclarations.width, '100%', `${theme} H1 hover width`);

    const h3BeforeDeclarations = Object.fromEntries(
      normalizeDeclarations(
        cssRuleBodyMatching(css, `${root} h3::before`),
        `${theme} H3 before`
      )
    );
    assert.equal(h3BeforeDeclarations.position, 'absolute', `${theme} H3 marker positioning`);
    assert.equal(h3BeforeDeclarations.left, '-6px', `${theme} H3 marker horizontal offset`);
    assert.equal(h3BeforeDeclarations.top, '50%', `${theme} H3 marker vertical anchor`);
    assert.equal(h3BeforeDeclarations.transform, 'translateY(-50%)', `${theme} H3 marker centering`);
    assert.equal(h3BeforeDeclarations.width, '5px', `${theme} H3 marker width`);
    assert.equal(h3BeforeDeclarations.height, '61%', `${theme} H3 marker height`);

    const blockquoteBeforeDeclarations = Object.fromEntries(
      normalizeDeclarations(
        cssRuleBodyMatching(css, `${root} blockquote::before`),
        `${theme} blockquote before`
      )
    );
    assert.equal(
      blockquoteBeforeDeclarations.position,
      'absolute',
      `${theme} blockquote marker positioning`
    );
    assert.equal(
      blockquoteBeforeDeclarations.left,
      '16px',
      `${theme} blockquote marker horizontal offset`
    );
    assert.equal(
      blockquoteBeforeDeclarations.top,
      '18px',
      `${theme} blockquote marker vertical offset`
    );

    const linkBefore = cssRuleBodyMatching(
      css,
      `${root} p a:not(.md-toc-inner)::before`
    );
    assert.ok(linkBefore, `${theme} link marker should be declared`);
    assert.match(linkBefore, /display:\s*inline-block/);
    assert.match(linkBefore, /width:\s*1em/);
    assert.match(linkBefore, /height:\s*1em/);
    assert.match(linkBefore, /background-color:\s*var\(--element-color\)/);
    assert.match(
      linkBefore,
      /(?:^|;)\s*-webkit-mask:\s*url\(["']?data:image\/svg\+xml/i,
      `${theme} link marker should retain its WebKit SVG mask`
    );
    assert.match(
      linkBefore,
      /(?:^|;)\s*mask:\s*url\(["']?data:image\/svg\+xml/i,
      `${theme} link marker should retain its standard SVG mask`
    );

    assert.deepEqual(
      normalizeDeclarations(cssRuleBodyMatching(css, `${root} h3`), `${theme} H3`),
      expectedDeclarations.h3,
      `${theme} H3 declarations should remain unchanged`
    );
    assert.deepEqual(
      normalizeDeclarations(cssRuleBodyMatching(css, `${root} blockquote`), `${theme} blockquote`),
      expectedDeclarations.blockquote,
      `${theme} blockquote declarations should remain unchanged`
    );
    assert.deepEqual(
      normalizeDeclarations(cssRuleBodyMatching(css, `${root} a`), `${theme} link`),
      expectedDeclarations.link,
      `${theme} link declarations should remain unchanged`
    );
  }
});

test('Terminal Noir preserves the reference terminal palette and readable contrast', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/code/terminal-noir.css'), 'utf8');
  const macFrameSelector = '.easymde-rendered-content.easymde-code-theme-terminal-noir.easymde-code-mac pre';
  const commentSelector = [
    '.easymde-rendered-content.easymde-code-theme-terminal-noir.easymde-code-mac',
    '.hljs',
    '.hljs-comment'
  ].join(' ');
  const macFrameRuleBodies = cssRuleBodies(css, macFrameSelector);
  const commentRuleBodies = cssRuleBodies(css, commentSelector);
  const background = '#0d1017';
  const text = '#cad1d9';
  const comment = '#8d949e';
  const green = '#88c8a3';
  const orange = '#e2a974';

  assert.match(css, /pre code\.hljs\s*\{[^}]*color:\s*#cad1d9;[^}]*background:\s*#0d1017;/s);
  assert.equal(macFrameRuleBodies.length, 1, 'Terminal Noir should define one Mac-frame background rule');
  assert.match(macFrameRuleBodies[0], /--easymde-code-frame-background:\s*#0d1017;/);
  assert.match(css, /\.hljs \.hljs-comment[^}]*\{[^}]*color:\s*#8d949e;/s);
  assert.equal(commentRuleBodies.length, 1, 'Terminal Noir should define one comment rule');
  assert.doesNotMatch(
    commentRuleBodies[0],
    /font-style:\s*italic/,
    'reference terminal comments use the regular monospace face'
  );
  assert.match(css, /\.hljs \.hljs-(?:addition|meta|name)[^}]*\{[^}]*color:\s*#88c8a3;/s);
  assert.match(css, /\.hljs \.hljs-(?:built_in|string)[^}]*\{[^}]*color:\s*#e2a974;/s);
  assert.ok(contrast(text, background) >= 4.5, 'body text should meet AA contrast on the terminal background');
  assert.ok(contrast(comment, background) >= 4.5, 'comments should meet AA contrast on the terminal background');
  assert.ok(contrast(green, background) >= 4.5, 'green accents should meet AA contrast on the terminal background');
  assert.ok(contrast(orange, background) >= 4.5, 'orange accents should meet AA contrast on the terminal background');
});

test('Terminal Noir remains authoritative across every registered article theme', () => {
  const registry = readFileSync(join(repoRoot, 'src/Theme/ArticleThemeRegistry.php'), 'utf8');
  const articleThemePaths = [
    ...registry.matchAll(/'((?:assets\/themes\/article\/)[^']+\.css)'/g)
  ].map((match) => match[1]);
  const sharedCss = [
    readFileSync(join(repoRoot, 'assets/css/frontend/base.css'), 'utf8'),
    readFileSync(join(repoRoot, 'assets/css/frontend/code-frame.css'), 'utf8')
  ];
  const terminalCss = readFileSync(join(repoRoot, 'assets/themes/code/terminal-noir.css'), 'utf8');

  assert.notEqual(articleThemePaths.length, 0, 'article theme registry should expose CSS assets');

  articleThemePaths.forEach((articleThemePath) => {
    const articleTheme = articleThemePath.split('/').at(-1).replace(/\.css$/, '');
    const css = [
      sharedCss[0],
      readFileSync(join(repoRoot, articleThemePath), 'utf8'),
      sharedCss[1],
      terminalCss
    ].join('\n');
    const dom = new JSDOM(
      `<style>${css}</style>
      <article data-code-frame class="easymde-rendered-content easymde-markdown-theme-${articleTheme} easymde-code-theme-terminal-noir easymde-code-mac">
        <pre><code class="hljs"><span class="hljs-title">Title</span><span class="hljs-number">1</span></code></pre>
      </article>
      <article data-ordinary-first class="easymde-rendered-content easymde-markdown-theme-${articleTheme}">
        <p>Ordinary first child</p>
      </article>`
    );
    const { window } = dom;
    const preStyle = window.getComputedStyle(window.document.querySelector('[data-code-frame] pre'));
    assert.equal(preStyle.backgroundColor, 'rgb(13, 16, 23)', articleTheme);
    assert.equal(preStyle.margin, '16px 0px', articleTheme);
    assert.equal(window.getComputedStyle(window.document.querySelector('code')).color, 'rgb(202, 209, 217)', articleTheme);
    assert.equal(window.getComputedStyle(window.document.querySelector('.hljs-title')).color, 'rgb(221, 226, 232)', articleTheme);
    assert.equal(window.getComputedStyle(window.document.querySelector('.hljs-number')).color, 'rgb(159, 184, 208)', articleTheme);
    if (articleTheme === 'animal-island') {
      assert.equal(
        window.getComputedStyle(window.document.querySelector('[data-ordinary-first] > p')).marginTop,
        '0px',
        'Animal Island should still reset the top margin of an ordinary first child'
      );
    }
  });
});

test('shared code-block CSS preserves horizontal scrolling while hiding bottom scrollbar chrome', () => {
  const codeFrameCss = readFileSync(join(repoRoot, 'assets/css/frontend/code-frame.css'), 'utf8');
  const baseCss = readFileSync(join(repoRoot, 'assets/css/frontend/base.css'), 'utf8');

  const macPreSelector = '.easymde-rendered-content.easymde-code-mac pre';
  const macCodeSelector = '.easymde-rendered-content.easymde-code-mac pre > code:not(.language-mermaid)';
  const macMermaidFallbackSelector = '.easymde-rendered-content.easymde-code-mac pre[data-easymde-mermaid-fallback] > code.language-mermaid';

  const macPreRule = cssRuleBodyMatching(codeFrameCss, macPreSelector);
  const macCodeRule = cssRuleBodyMatching(codeFrameCss, macCodeSelector);
  const macMermaidFallbackRule = cssRuleBodyMatching(codeFrameCss, macMermaidFallbackSelector);

  assert.ok(macPreRule, 'code-frame.css must define the shared Mac pre rule');
  assert.match(macPreRule, /overflow-x:\s*auto;/);
  assert.match(macPreRule, /overflow-y:\s*hidden;/);
  assert.match(macPreRule, /scrollbar-width:\s*none;/);

  for (const [label, rule] of [
    ['code-frame pre > code', macCodeRule],
    ['code-frame mermaid fallback code', macMermaidFallbackRule]
  ]) {
    assert.ok(rule, `${label} rule must exist`);
    assert.match(rule, /overflow-x:\s*auto;/);
    assert.match(rule, /overflow-y:\s*hidden;/);
    assert.match(rule, /scrollbar-width:\s*none;/);
    assert.match(rule, /white-space:\s*pre;/);
  }

  for (const webkitSelector of [
    `${macPreSelector}::-webkit-scrollbar`,
    `${macCodeSelector}::-webkit-scrollbar`,
    `${macMermaidFallbackSelector}::-webkit-scrollbar`
  ]) {
    const webkitRule = cssRuleBodyMatching(codeFrameCss, webkitSelector);
    assert.ok(webkitRule, `code-frame.css must hide WebKit scrollbars for ${webkitSelector}`);
    assert.match(webkitRule, /display:\s*none;/);
  }

  for (const root of [
    '.easymde-rendered-content',
    '.easymde-preview',
    '.entry-content',
    '.wp-block-post-content'
  ]) {
    const basePreRule = cssRuleBodyMatching(baseCss, `${root} pre`);
    const baseCodeRule = cssRuleBodyMatching(baseCss, `${root} pre > code`);
    const basePreWebkitRule = cssRuleBodyMatching(baseCss, `${root} pre::-webkit-scrollbar`);
    const baseCodeWebkitRule = cssRuleBodyMatching(baseCss, `${root} pre > code::-webkit-scrollbar`);

    assert.ok(basePreRule, `base.css must define ${root} pre`);
    assert.match(basePreRule, /overflow:\s*auto;/);
    assert.match(basePreRule, /scrollbar-width:\s*none;/);
    assert.ok(baseCodeRule, `base.css must define ${root} pre > code`);
    assert.match(baseCodeRule, /scrollbar-width:\s*none;/);
    assert.ok(basePreWebkitRule, `base.css must hide WebKit scrollbars for ${root} pre`);
    assert.match(basePreWebkitRule, /display:\s*none;/);
    assert.ok(baseCodeWebkitRule, `base.css must hide WebKit scrollbars for ${root} pre > code`);
    assert.match(baseCodeWebkitRule, /display:\s*none;/);
  }

  const dom = new JSDOM(
    `<style>${baseCss}\n${codeFrameCss}</style>
    <article class="easymde-rendered-content easymde-code-mac">
      <pre data-preview-code><code class="hljs language-typescript">const x = "${'a'.repeat(120)}";</code></pre>
      <pre class="easymde-code-block" data-easymde-code-block="1"><code class="hljs language-javascript">const y = "${'b'.repeat(120)}";</code></pre>
    </article>`
  );
  const { window } = dom;
  for (const pre of window.document.querySelectorAll('pre')) {
    const preStyle = window.getComputedStyle(pre);
    const code = pre.querySelector('code');
    const codeStyle = window.getComputedStyle(code);
    assert.equal(preStyle.overflowX, 'auto');
    assert.equal(preStyle.overflowY, 'hidden');
    assert.equal(codeStyle.overflowX, 'auto');
    assert.equal(codeStyle.overflowY, 'hidden');
    assert.equal(codeStyle.whiteSpace, 'pre');
  }
});

function targetsHeadingTextContainer(selector) {
  const normalized = normalizeCssSelector(selector);
  if (/:{1,2}(?:before|after)\b/i.test(normalized)) {
    return false;
  }

  return /(?:^|[\s>+~])h[1-6](?:[.#][a-zA-Z0-9_-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*(?:\s*(?:>\s*)?(?:span)?\.content(?:[.#][a-zA-Z0-9_-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*)?$/i.test(
    normalized
  );
}

test('non-default article themes avoid fixed pixel heights on heading text containers', () => {
  const nonDefaultThemes = registeredArticleThemes().filter(({ id }) => id !== 'default');
  assert.ok(nonDefaultThemes.length >= 45, 'expected at least 45 non-default registered article themes');

  const violations = [];
  for (const { id, assetPath } of nonDefaultThemes) {
    const css = readFileSync(join(repoRoot, assetPath), 'utf8');
    for (const rule of parseCssRules(css)) {
      const headingSelectors = rule.selectors
        .map(normalizeCssSelector)
        .filter(targetsHeadingTextContainer);
      if (headingSelectors.length === 0) continue;

      const declarations = splitCssDeclarations(rule.body);
      const heightDeclarations = declarations.filter((declaration) => declaration.property === 'height');
      if (heightDeclarations.length === 0) continue;

      const effectiveHeight = heightDeclarations[heightDeclarations.length - 1].value;
      if (/^\d+(?:\.\d+)?px(?:\s*!important)?$/i.test(effectiveHeight)) {
        violations.push({
          assetPath,
          height: effectiveHeight,
          id,
          selectors: headingSelectors
        });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `article themes must use min-height + height: auto instead of fixed pixel height on heading text containers: ${JSON.stringify(violations)}`
  );

  for (const [themeId, headingTag] of [
    ['cute-green', 'h2'],
    ['frontend-peak', 'h2'],
    ['fullstack-blue', 'h3']
  ]) {
    const css = readFileSync(join(repoRoot, `assets/themes/article/${themeId}.css`), 'utf8');
    const dom = new JSDOM(
      `<style>${css}</style>
      <article class="easymde-rendered-content easymde-markdown-theme-${themeId}">
        <${headingTag}><span class="prefix"></span><span class="content">Wrapped heading title</span><span class="suffix"></span></${headingTag}>
      </article>`
    );
    const contentEl = dom.window.document.querySelector(`${headingTag} .content`);
    const style = dom.window.getComputedStyle(contentEl);
    assert.equal(style.minHeight, '38px', `${themeId} ${headingTag} .content should preserve min-height: 38px`);
    assert.equal(style.height, 'auto', `${themeId} ${headingTag} .content should allow height: auto wrapping`);
  }
});
