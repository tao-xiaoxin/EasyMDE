import assert from 'node:assert/strict';
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
    const selectors = match[1].split(',').map((item) => item.trim());

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
    selectors.push(...match[1].split(',').map((item) => item.trim()));
  }

  return selectors;
}

function cssRuleBodyMatching(source, selector, predicate = () => true) {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(source)) !== null) {
    const selectors = match[1]
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((item) => item.trim());
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

test('Bloom retains source heading tracking and Petal release alert colors', () => {
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
  const alertColors = {
    note: ['#eae9f2', '#cbd6e8'],
    tip: ['#edeeea', '#d3e1d4'],
    warning: ['#f8eae3', '#efdac5'],
    important: ['#efe8f8', '#d8d3f6'],
    caution: ['#f4e0e1', '#e7c2c2']
  };
  for (const [kind, [background, border]] of Object.entries(alertColors)) {
    const rule = petal.match(
      new RegExp(
        `${escapedRegExp(scopedArticleRoot('bloom-petal'))} blockquote\\[data-type="alert-${kind}"\\]\\s*,\\s*${escapedRegExp(scopedArticleRoot('bloom-petal'))} \\.md-alert-${kind}\\s*\\{([^}]*)\\}`,
        's'
      )
    );
    assert.ok(rule, `Bloom Petal should define the pinned ${kind} alert adapter`);
    assert.match(rule[1], new RegExp(`background:\\s*${background}\\s*!important;`));
    assert.match(rule[1], new RegExp(`border-color:\\s*${border}\\s*!important;`));
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
});

test('Bloom focus-mode effects stay opt-in in EasyMDE adapters', () => {
  const bloomFiles = readdirSync(join(repoRoot, 'assets/themes/article'))
    .filter((name) => /^bloom-.*\.css$/.test(name));

  assert.equal(bloomFiles.length, 12, 'all Bloom light variants should be present');

  for (const file of bloomFiles) {
    const css = readFileSync(join(repoRoot, 'assets/themes/article', file), 'utf8');
    const themeId = file.replace(/\.css$/, '');
    const root = scopedArticleRoot(themeId);

    assert.ok(css.includes(root), `${file} should declare its own EasyMDE root`);
    const literalRoot = escapedRegExp(root);

    assert.doesNotMatch(
      css,
      new RegExp(`${literalRoot}\\s*>\\s*\\*`),
      `${file} must not blur ordinary preview children`
    );
    assert.doesNotMatch(
      css,
      new RegExp(`${literalRoot}\\s*\\{\\s*background:\\s*transparent\\s*!important`),
      `${file} must not clear the ordinary preview surface`
    );
    assert.match(css, new RegExp(`${literalRoot}\\.on-focus-mode`), `${file} focus rules should remain opt-in`);
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
      <article class="easymde-rendered-content easymde-markdown-theme-${articleTheme} easymde-code-theme-terminal-noir easymde-code-mac">
        <pre><code class="hljs"><span class="hljs-title">Title</span><span class="hljs-number">1</span></code></pre>
      </article>`
    );
    const { window } = dom;
    assert.equal(window.getComputedStyle(window.document.querySelector('pre')).backgroundColor, 'rgb(13, 16, 23)', articleTheme);
    assert.equal(window.getComputedStyle(window.document.querySelector('code')).color, 'rgb(202, 209, 217)', articleTheme);
    assert.equal(window.getComputedStyle(window.document.querySelector('.hljs-title')).color, 'rgb(221, 226, 232)', articleTheme);
    assert.equal(window.getComputedStyle(window.document.querySelector('.hljs-number')).color, 'rgb(159, 184, 208)', articleTheme);
  });
});
