import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function source(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function registeredThemes(registryPath) {
  return Array.from(
    source(registryPath).matchAll(/=>\s*\$this->theme\(\s*'([^']+)'[\s\S]*?'([^']+\.css)'/g),
    ([, id, assetPath]) => ({ id, assetPath })
  );
}

function articleThemeAssociations() {
  return Array.from(
    source('src/Theme/ArticleThemeRegistry.php').matchAll(
      /=>\s*\$this->theme\(\s*'([^']+)'[\s\S]*?'(assets\/themes\/article\/[^']+\.css)'\s*,\s*'([a-z0-9-]+)'(?:\s*,\s*(?:true|false))?(?:\s*,\s*'#[0-9a-f]{6}')?\s*\)/g
    ),
    ([, id, assetPath, defaultCodeTheme]) => ({ id, assetPath, defaultCodeTheme })
  );
}

function typoraDerivedCodeAssociations() {
  return {
    inkwell: 'inkwell-code',
    'animal-island': 'animal-island-code',
    'phycat-cherry': 'phycat-code',
    'phycat-caramel': 'phycat-code',
    'phycat-forest': 'phycat-code',
    'phycat-mint': 'phycat-code',
    'phycat-sky': 'phycat-code',
    'phycat-prussian': 'phycat-code',
    'phycat-sakura': 'phycat-code',
    'phycat-mauve': 'phycat-code',
    mdmdt: 'mdmdt-code',
    'dogschoice-pink': 'dogschoice-pink-code',
    'bloom-petal': 'bloom-petal-code',
    'bloom-mist': 'bloom-mist-code',
    'bloom-verdant': 'bloom-verdant-code',
    'bloom-stone': 'bloom-stone-code',
    'bloom-wheat': 'bloom-wheat-code',
    'bloom-ink': 'bloom-ink-code',
    'bloom-amber': 'bloom-amber-code',
    'bloom-lapis': 'bloom-lapis-code',
    'bloom-ripple': 'bloom-ripple-code',
    'bloom-cinnabar': 'bloom-cinnabar-code',
    'bloom-sage': 'bloom-sage-code',
    'bloom-spring': 'bloom-spring-code',
    spring: 'spring-code'
  };
}

function codeThemeMetadata() {
  return Array.from(
    source('src/Theme/CodeThemeRegistry.php').matchAll(
      /=>\s*\$this->theme\(\s*'([^']+)'\s*,\s*__\(\s*'([^']+)'\s*,\s*'easymde'\s*\)\s*,\s*'([^']+\.css)'/g
    ),
    ([, id, label, assetPath]) => ({ id, label, assetPath })
  );
}

function stripCssComments(css) {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

function findCssBlockEnd(css, openingBrace) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingBrace; index < css.length; index += 1) {
    const character = css[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Unclosed CSS block starting at offset ${openingBrace}`);
}

function splitCssList(value, delimiter) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") quote = character;
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === delimiter && parentheses === 0 && brackets === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  const finalPart = value.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function cssRules(sourceCss) {
  const css = stripCssComments(sourceCss);
  const rules = [];

  function walk(start, end) {
    let position = start;

    while (position < end) {
      while (position < end && /[\s;]/.test(css[position])) position += 1;
      if (position >= end) break;

      let quote = null;
      let escaped = false;
      let parentheses = 0;
      let brackets = 0;
      let openingBrace = -1;
      let statementEnd = -1;

      for (let index = position; index < end; index += 1) {
        const character = css[index];

        if (quote) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === quote) quote = null;
          continue;
        }

        if (character === '"' || character === "'") quote = character;
        else if (character === '(') parentheses += 1;
        else if (character === ')') parentheses = Math.max(0, parentheses - 1);
        else if (character === '[') brackets += 1;
        else if (character === ']') brackets = Math.max(0, brackets - 1);
        else if (parentheses === 0 && brackets === 0 && character === '{') {
          openingBrace = index;
          break;
        } else if (parentheses === 0 && brackets === 0 && character === ';') {
          statementEnd = index;
          break;
        }
      }

      if (statementEnd >= 0 && (openingBrace < 0 || statementEnd < openingBrace)) {
        position = statementEnd + 1;
        continue;
      }
      if (openingBrace < 0) break;

      const prelude = css.slice(position, openingBrace).trim();
      const blockEnd = findCssBlockEnd(css, openingBrace);
      if (/^@(?:media|supports|container|layer|document|scope)\b/i.test(prelude)) {
        walk(openingBrace + 1, blockEnd);
      } else if (!prelude.startsWith('@')) {
        rules.push({
          body: css.slice(openingBrace + 1, blockEnd),
          selectors: splitCssList(prelude, ',')
        });
        // Native CSS nesting places complete rules inside a style rule. Walk
        // those blocks too so ownership checks cannot be bypassed with `&`.
        walk(openingBrace + 1, blockEnd);
      }
      position = blockEnd + 1;
    }
  }

  walk(0, css.length);
  return rules;
}

function cssDeclarations(body) {
  return splitCssList(body, ';').flatMap((segment) => {
    const match = segment.match(/^\s*(--[\w-]+|[a-zA-Z_][\w-]*)\s*:/);
    if (!match) return [];
    const property = match[1];
    return [{
      property: property.startsWith('--') ? property : property.toLowerCase(),
      value: segment.slice(match[0].length).trim()
    }];
  });
}

function cssSelectors(css) {
  return cssRules(css).flatMap(({ selectors }) => selectors);
}

function normalizeSelector(selector) {
  return selector.replaceAll(/\s+/g, ' ').trim();
}

function withoutFunctionalPseudoClass(selector, pseudoClass) {
  const marker = `:${pseudoClass}(`;
  let result = '';
  let position = 0;

  while (position < selector.length) {
    const start = selector.toLowerCase().indexOf(marker, position);
    if (start < 0) return result + selector.slice(position);

    result += selector.slice(position, start);
    let depth = 1;
    let quote = null;
    let escaped = false;
    let end = start + marker.length;

    for (; end < selector.length && depth > 0; end += 1) {
      const character = selector[end];

      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }

      if (character === '"' || character === "'") quote = character;
      else if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
    }

    if (depth > 0) throw new Error(`Unclosed :${pseudoClass}() in selector: ${selector}`);
    position = end;
  }

  return result;
}

const BLOOM_FOCUS_HOOK_THEMES = new Set([
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
]);

function unreachableTyporaClasses(selector, themeId) {
  const positiveSelector = withoutFunctionalPseudoClass(normalizeSelector(selector), 'not');
  const classes = Array.from(
    positiveSelector.matchAll(/\.((?:md)-[\w-]+)/gi),
    ([, className]) => className.toLowerCase()
  );

  return Array.from(new Set(classes.filter((className) => {
    if ('md-focus-element' === className) {
      return !(
        BLOOM_FOCUS_HOOK_THEMES.has(themeId)
        && /\.on-focus-mode\b/.test(positiveSelector)
      );
    }
    return !/^md-alert(?:-[\w-]+)?$/.test(className);
  })));
}

function legacyMathAdapterSelector(selector) {
  const positiveSelector = withoutFunctionalPseudoClass(normalizeSelector(selector), 'not');

  return /\.MathJax(?:\b|[_-])/i.test(positiveSelector)
    || /(^|[\s>+~])mjx-container(?=$|[\s>+~:.[#])/i.test(positiveSelector);
}

function blockCodeSelector(selector) {
  const normalizedSelector = normalizeSelector(selector);
  const positiveSelector = normalizedSelector
    .replaceAll(/:not\(\s*pre\s*\)/gi, '')
    .replaceAll(/:not\(\s*\.md-fencescode\s*\)/gi, '');
  const inlineOnly = /(?:^|[\s>+~])(?:p|li|h[1-6])(?:[.#:[\][\]\w-]*)?\s+(?:[^,{]+\s+)?code(?=$|[\s>+~:.[#])/i
    .test(normalizedSelector)
    || /:not\(\s*pre\s*\)\s*>\s*code(?=$|[\s>+~:.[#])/i.test(normalizedSelector)
    || /\.md-alert(?:-[\w-]+)?\s+code(?=$|[\s>+~:.[#])/i.test(normalizedSelector);
  const codeElement = /(^|[\s,(>+~])code(?=$|[\s,)>+~:.[#])/i.test(positiveSelector);

  return /#typora-source\b/i.test(positiveSelector)
    || /\.CodeMirror(?:-[\w-]+)?\b/i.test(positiveSelector)
    || /\.cm-[\w-]+\b/i.test(positiveSelector)
    || /\.md-fences(?:-[\w-]+)?\b/i.test(positiveSelector)
    || /\.hljs(?:-[\w-]+)?\b/i.test(positiveSelector)
    || /\.code-snippet__(?:fix|line-index)\b/i.test(positiveSelector)
    || /\[\s*mdtype\s*=\s*["']?fences["']?\s*\]/i.test(positiveSelector)
    || /(^|[\s,(>+~])pre(?=$|[\s,)>+~:.[#])/i.test(positiveSelector)
    || (codeElement && !inlineOnly);
}

const FENCED_CODE_ONLY_VARIABLE = /^--(?:cm-s-inner-linenumber-color|code-fences(?:-[\w-]+)?|codeblock-bg-color|color-cm-keyword|code-(?:bg|text|ink|muted-rgb|dot-(?:red|yellow|green)|token-(?:keyword|string|number|blue)))$/;

function referencedCustomProperties(value) {
  return Array.from(
    value.matchAll(/var\(\s*(--[\w-]+)/g),
    ([, variable]) => variable
  );
}

function unconsumedFencedCodeVariables(css) {
  const rules = cssRules(css);
  const declarations = rules.flatMap(({ body }) => cssDeclarations(body));
  const consumers = new Set(
    declarations.flatMap(({ value }) => referencedCustomProperties(value))
  );

  return Array.from(new Set(
    declarations
      .map(({ property }) => property)
      .filter((property) => FENCED_CODE_ONLY_VARIABLE.test(property) && !consumers.has(property))
  )).sort();
}

function orphanCustomProperties(css) {
  const declarations = cssRules(css).flatMap(({ body }) => cssDeclarations(body));
  const dependencies = new Map();
  const live = [];

  for (const declaration of declarations) {
    const references = referencedCustomProperties(declaration.value);
    if (declaration.property.startsWith('--')) {
      const existing = dependencies.get(declaration.property) ?? new Set();
      for (const reference of references) existing.add(reference);
      dependencies.set(declaration.property, existing);
    } else {
      live.push(...references);
    }
  }

  const reachable = new Set();
  while (live.length > 0) {
    const variable = live.pop();
    if (reachable.has(variable) || !dependencies.has(variable)) continue;

    reachable.add(variable);
    live.push(...dependencies.get(variable));
  }

  return Array.from(dependencies.keys())
    .filter((variable) => !reachable.has(variable))
    .sort();
}

test('every article theme declares a registered associated code theme', () => {
  const articleThemes = articleThemeAssociations();
  const codeThemes = registeredThemes('src/Theme/CodeThemeRegistry.php');
  const codeThemeIds = new Set(codeThemes.map(({ id }) => id));
  const registeredArticleAssets = articleThemes
    .map(({ assetPath }) => assetPath.replace('assets/themes/article/', ''))
    .sort();
  const articleAssets = readdirSync(join(repoRoot, 'assets/themes/article'))
    .filter((entry) => entry.endsWith('.css'))
    .sort();

  assert.deepEqual(
    registeredArticleAssets,
    articleAssets,
    'the registry must own exactly the shipped article theme stylesheets'
  );
  for (const theme of articleThemes) {
    assert.ok(codeThemeIds.has(theme.defaultCodeTheme), `${theme.defaultCodeTheme} should be registered`);
  }
  assert.equal(
    articleThemes.find(({ id }) => 'fullstack-blue' === id)?.defaultCodeTheme,
    'fullstack-blue'
  );
  const typoraAssociations = typoraDerivedCodeAssociations();
  assert.ok(
    articleThemes
      .filter(({ id }) => !typoraAssociations[id] && 'fullstack-blue' !== id)
      .every(({ defaultCodeTheme }) => 'atom-one-dark' === defaultCodeTheme),
    'legacy article themes should continue to reuse Atom One Dark'
  );
});

test('Typora-derived article themes have unique registered default code palettes', () => {
  const associations = typoraDerivedCodeAssociations();
  const articleThemes = new Map(articleThemeAssociations().map((theme) => [theme.id, theme]));
  const codeThemes = new Map(codeThemeMetadata().map((theme) => [theme.id, theme]));
  const labels = codeThemeMetadata().map(({ label }) => label);
  const css = source('assets/themes/code/typora-derived.css');
  const signatures = new Set();
  const associatedCodeIds = new Set(Object.values(associations));

  assert.equal(Object.keys(associations).length, 25);
  assert.equal(new Set(labels).size, labels.length, 'code-theme labels must be unique');
  assert.equal(associatedCodeIds.size, 18, 'native-equivalent palettes must share one code theme');

  for (const [articleId, codeId] of Object.entries(associations)) {
    assert.equal(articleThemes.get(articleId)?.defaultCodeTheme, codeId, `${articleId} association`);
    assert.equal(codeThemes.get(codeId)?.assetPath, 'assets/themes/code/typora-derived.css', `${codeId} asset`);
  }

  for (const codeId of associatedCodeIds) {
    const scope = css.match(
      new RegExp(`\\.easymde-rendered-content\\.easymde-code-theme-${codeId}\\s*\\{([^}]*)\\}`)
    );
    assert.ok(scope, `${codeId} should define an independent scope`);
    const signature = scope[1].replace(/\s+/g, ' ').trim();
    assert.ok(!signatures.has(signature), `${codeId} should not duplicate another palette`);
    signatures.add(signature);
  }
});

test('associated code-theme assets are independent from article-theme selectors', () => {
  const articleThemes = articleThemeAssociations();
  const codeThemes = new Map(
    registeredThemes('src/Theme/CodeThemeRegistry.php').map((theme) => [theme.id, theme])
  );

  for (const articleTheme of articleThemes) {
    const codeTheme = codeThemes.get(articleTheme.defaultCodeTheme);
    assert.ok(codeTheme, `${articleTheme.defaultCodeTheme} should be registered`);
    const css = source(codeTheme.assetPath);

    assert.doesNotMatch(css, /easymde-markdown-theme-/);
    assert.doesNotMatch(css, /code-snippet__fix|code-snippet__line-index|easymde-mdnice-/);
    assert.doesNotMatch(css, /--easymde-theme-font-family/);
    if (codeTheme.assetPath.startsWith('assets/themes/code/')) {
      assert.match(css, new RegExp(`easymde-code-theme-${articleTheme.defaultCodeTheme}(?:[^a-z0-9-]|$)`));
    }
  }
});

test('EasyMDE-owned code themes contain palette rules but no shared frame geometry', () => {
  const ownedThemes = registeredThemes('src/Theme/CodeThemeRegistry.php')
    .filter(({ assetPath }) => assetPath.startsWith('assets/themes/code/'));
  const geometryProperties = /\b(?:border-radius|box-shadow|display|font-family|font-size|letter-spacing|line-height|max-width|overflow(?:-[xy])?|padding(?:-(?:block|bottom|inline|left|right|top))?|position|white-space|word-break|word-spacing)\s*:/;

  assert.ok(ownedThemes.length > 0);
  for (const theme of ownedThemes) {
    assert.doesNotMatch(source(theme.assetPath), geometryProperties, theme.id);
  }
});

test('Fullstack Blue preserves its distinct token palette without content rewriting', () => {
  const css = source('assets/themes/code/fullstack-blue.css');

  assert.match(css, /\.easymde-rendered-content\.easymde-code-theme-fullstack-blue \.hljs-title,/);
  assert.match(css, /\.hljs-number\s*\{[^}]*color:\s*#abb2bf;/s);
  assert.doesNotMatch(css, /easymde-markdown-theme-|easymde-mdnice-|code-snippet__fix/);
  assert.doesNotMatch(css, /font-family|font-size|line-height|letter-spacing|padding-top|border-radius|box-shadow/);
});

test('article code ownership classifier rejects legacy fenced selectors without rejecting inline code', () => {
  const fencedSelectors = cssSelectors(`
    @media (min-width: 40rem) {
      .theme #typora-source .cm-keyword,
      .theme .CodeMirror-gutters,
      .theme .md-fences,
      .theme pre,
      .theme pre > code.hljs,
      .theme .hljs-string,
      .theme [mdtype="fences"] .code-tooltip,
      .theme .code-snippet__fix {
        color: red;
      }
    }
  `);
  const inlineSelectors = cssSelectors(`
    .theme :not(pre) > code:not(.md-fencescode),
    .theme p code,
    .theme li code:hover,
    .theme h6 code,
    .theme .md-alert-tip code {
      color: red;
    }
  `);

  assert.ok(fencedSelectors.every(blockCodeSelector));
  assert.ok(inlineSelectors.every((selector) => !blockCodeSelector(selector)));
  assert.deepEqual(
    unconsumedFencedCodeVariables(`
      .theme {
        --code-token-keyword: red;
        --code-fences-bg-color: black;
        --code-inline-bg-color: pink;
      }
      .theme :not(pre) > code {
        background: var(--code-inline-bg-color);
      }
    `),
    ['--code-fences-bg-color', '--code-token-keyword']
  );
});

test('article code ownership classifier traverses CSS nesting and functional pseudo classes', () => {
  const selectors = cssSelectors(`
    .theme {
      color: black;

      & :is(pre, .preview-fallback),
      & :where(code.hljs),
      &:has(> pre) {
        color: red;
      }
    }
  `);

  assert.deepEqual(selectors, [
    '.theme',
    '& :is(pre, .preview-fallback)',
    '& :where(code.hljs)',
    '&:has(> pre)'
  ]);
  assert.ok(selectors.slice(1).every(blockCodeSelector));
});

test('registered article themes contain no fenced-code, token, or frame selectors', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    const selectors = cssSelectors(source(theme.assetPath));
    const blockSelectors = selectors.filter(blockCodeSelector);

    assert.deepEqual(blockSelectors, [], `${theme.id} should not own block-code presentation`);
  }
});

test('registered article themes contain no unconsumed fenced-code palette variables', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    assert.deepEqual(
      unconsumedFencedCodeVariables(source(theme.assetPath)),
      [],
      `${theme.id} should not retain an unconsumed fenced-code palette`
    );
  }
});

test('article custom-property graph preserves consumed chains and rejects entire orphan trees', () => {
  const css = `
    .theme {
      --live-root: var(--live-middle);
      --live-middle: var(--live-leaf);
      --live-leaf: #123456;
      --orphan-root: var(--orphan-leaf);
      --orphan-leaf: #abcdef;
      --orphan-cycle-a: var(--orphan-cycle-b);
      --orphan-cycle-b: var(--orphan-cycle-a);
      --Case-Sensitive: #ffffff;
      --case-sensitive: #000000;
      color: var(--live-root);
      background: var(--case-sensitive);
    }
  `;

  assert.deepEqual(orphanCustomProperties(css), [
    '--Case-Sensitive',
    '--orphan-cycle-a',
    '--orphan-cycle-b',
    '--orphan-leaf',
    '--orphan-root'
  ]);
});

test('registered article themes contain no orphan custom-property dependency trees', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    assert.deepEqual(
      orphanCustomProperties(source(theme.assetPath)),
      [],
      `${theme.id} custom properties must reach a non-custom declaration`
    );
  }
});

test('legacy math classifier rejects MathJax adapters and preserves current KaTeX DOM', () => {
  const legacySelectors = [
    '.theme .MathJax',
    '.theme .MathJax_Display > span',
    '.theme .mathjax-preview',
    '.theme mjx-container[display="true"]'
  ];
  const currentSelectors = [
    '.theme .easymde-math-block',
    '.theme .easymde-math-inline',
    '.theme .katex',
    '.theme .katex-display'
  ];

  assert.ok(legacySelectors.every(legacyMathAdapterSelector));
  assert.ok(currentSelectors.every((selector) => !legacyMathAdapterSelector(selector)));
});

test('registered article themes contain no legacy MathJax adapter selectors', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    assert.deepEqual(
      cssSelectors(source(theme.assetPath)).filter(legacyMathAdapterSelector),
      [],
      `${theme.id} should target only the current EasyMDE KaTeX DOM`
    );
  }
});

test('Typora DOM classifier rejects unreachable positive md classes and preserves real article branches', () => {
  const unreachableSelectors = [
    '.theme .md-task-list-item > input',
    '.theme .md-list-item',
    '.theme .md-toc .md-toc-item.md-toc-h2',
    '.theme .md-math-block',
    '.theme .md-mathjax-midline',
    '.theme .md-diagram',
    '.theme h3.md-focus',
    '.theme .md-link .md-def-url',
    '.theme .md-image > .md-image-src-span',
    '.theme .md-meta',
    '.theme .md-tag',
    '.theme .md-footnote',
    '.theme .md-table-fig .md-table',
    '.theme .md-content .md-before',
    '.theme .md-fencescode',
    '.theme .md-future-editor-wrapper',
    '.theme.on-focus-mode > .md-focus-element'
  ];
  const reachableSelectors = [
    '.theme a:not(.md-toc-inner):hover',
    '.theme :not(pre) > code:not(.md-fencescode)',
    '.theme .easymde-toc a',
    '.theme .task-list-item input',
    '.theme blockquote.md-alert-note',
    '.theme .md-alert-title-icon',
    '.theme table > tbody',
    '.theme .footnote-ref',
    '.easymde-rendered-content.easymde-markdown-theme-bloom-petal.on-focus-mode > .md-focus-element',
    '.easymde-rendered-content.easymde-markdown-theme-bloom-petal.on-focus-mode .md-focus-element h2'
  ];

  for (const selector of unreachableSelectors) {
    assert.notDeepEqual(unreachableTyporaClasses(selector, 'inkwell'), [], selector);
  }
  for (const selector of reachableSelectors) {
    assert.deepEqual(unreachableTyporaClasses(selector, 'bloom-petal'), [], selector);
  }
});

test('registered article themes contain no unreachable positive Typora md selectors', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    const violations = cssSelectors(source(theme.assetPath)).flatMap((selector) => {
      const classes = unreachableTyporaClasses(selector, theme.id);
      return classes.length > 0 ? [{ classes, selector }] : [];
    });

    assert.deepEqual(
      violations,
      [],
      `${theme.id} should target only reachable EasyMDE or standard article DOM`
    );
  }
});

test('Typora-derived adapters keep inline code article-owned without fenced selectors', () => {
  const typoraThemes = Object.keys(typoraDerivedCodeAssociations());

  for (const theme of typoraThemes) {
    const css = source(`assets/themes/article/${theme}.css`);
    const root = `.easymde-rendered-content.easymde-markdown-theme-${theme}`;
    const selectors = cssSelectors(css);
    const inlineCodeSelectors = selectors.filter((selector) => (
      selector.startsWith(`${root} :not(pre) > code`)
    ));

    assert.ok(inlineCodeSelectors.length > 0, `${theme} should expose a scoped inline-code selector`);
    assert.deepEqual(
      selectors.filter(blockCodeSelector),
      [],
      `${theme} must leave fenced-code presentation to the independent code theme/frame`
    );
  }
});

test('Typora-derived article themes stay locally scoped and offline-safe', () => {
  const typoraThemes = Object.keys(typoraDerivedCodeAssociations());

  for (const theme of typoraThemes) {
    const css = source(`assets/themes/article/${theme}.css`);
    const root = `.easymde-rendered-content.easymde-markdown-theme-${theme}`;

    assert.match(css, new RegExp(`${root.replaceAll('.', '\\.')}\\s*\\{`), `${theme} should define its scoped root`);
    assert.doesNotMatch(css, /@import\s/);
    assert.doesNotMatch(css, /url\(\s*["']?(?:https?:)?\/\//i, `${theme} should not require remote runtime assets`);
    assert.doesNotMatch(css, /(?:^|[,{])\s*(?:html|body|:root)\s*(?:[,\{])/m, `${theme} should not leak global selectors`);
  }
});

test('article-theme inline-code rules keep using the shared neutral code font', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');
  let inlineThemeCount = 0;

  for (const theme of themes) {
    const css = source(theme.assetPath);
    if (!/(?:p code|li code|:not\(pre\)\s*>\s*code)/.test(css)) continue;

    inlineThemeCount += 1;
    assert.match(css, /font-family:\s*var\(--easymde-code-font-family\)/);
  }

  assert.ok(inlineThemeCount >= 20, 'built-in article themes should retain their inline-code rules');
});

test('the shared frame has no article-theme or code-theme branches', () => {
  const css = source('assets/css/frontend/code-frame.css');
  const articleThemes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.doesNotMatch(css, /easymde-markdown-theme-/);
  assert.doesNotMatch(css, /\.easymde-code-theme-/);
  for (const theme of articleThemes) {
    assert.doesNotMatch(css, new RegExp(`(?:^|[^a-z0-9-])${theme.id}(?:$|[^a-z0-9-])`));
  }
  assert.match(css, /\.easymde-rendered-content\.easymde-code-mac pre\s*\{[^}]*box-sizing:\s*border-box;/s);
  assert.match(css, /\.easymde-rendered-content\.easymde-code-mac pre\s*\{[^}]*padding:\s*34px 0 0;/s);
  const codeFrameCodeRule = /\.easymde-rendered-content\.easymde-code-mac pre > code:not\(\.language-mermaid\),\s*\.easymde-rendered-content\.easymde-code-mac pre\[data-easymde-mermaid-fallback\] > code\.language-mermaid\s*\{[^}]*;/s;
  assert.match(css, codeFrameCodeRule);
  assert.match(css, /pre\[data-easymde-mermaid-fallback\] > code\.language-mermaid\s*\{[^}]*display:\s*block;/s);
  assert.match(css, /pre\[data-easymde-mermaid-fallback\] > code\.language-mermaid\s*\{[^}]*white-space:\s*pre;/s);
  assert.match(css, /pre\[data-easymde-mermaid-fallback\] > code\.language-mermaid\s*\{[^}]*letter-spacing:\s*0;/s);
  assert.match(css, /pre\[data-easymde-mermaid-fallback\] > code\.language-mermaid\s*\{[^}]*word-spacing:\s*0;/s);
});

test('admin preview CSS delegates block-code presentation to the shared frame', () => {
  const selectors = cssSelectors(source('assets/css/admin/editor.css'));
  const previewBlockSelectors = selectors.filter(
    (selector) => /\.easymde-preview\b/.test(selector) && blockCodeSelector(selector)
  );

  assert.deepEqual(previewBlockSelectors, []);
});

test('production highlighting has no article-specific token rewriting', () => {
  const enhancementSource = source(
    'frontend/src/integrations/preview-runtime/frontend-enhancement-runtime.ts'
  );

  assert.doesNotMatch(enhancementSource, /fullstack-blue|normalizeFullstackBlueHighlight|easymde-mdnice-/);
  assert.match(enhancementSource, /pre > code:not\(\.language-mermaid\)/);
  assert.match(enhancementSource, /highlightElement\(element\)/);
  assert.match(enhancementSource, /--easymde-code-frame-background/);
  assert.match(enhancementSource, /dataset\.easymdeHighlighted = '1'/);
});

test('code-theme background remains authoritative without Highlight.js', () => {
  const enhancementSource = source(
    'frontend/src/integrations/preview-runtime/frontend-enhancement-runtime.ts'
  );

  assert.match(enhancementSource, /!syntaxHighlight\s*\|\|\s*!windowRef\.hljs/);
  assert.match(enhancementSource, /windowRef\.getComputedStyle\(element\)\.backgroundColor/);
  assert.match(enhancementSource, /element\.parentElement\.style\.setProperty/);
});

test('obsolete article-theme frame assets are physically absent', () => {
  for (const path of [
    'assets/images/fullstack-blue-code-window.svg',
    'assets/images/tech-blue-code-window.svg'
  ]) {
    assert.throws(() => source(path), { code: 'ENOENT' });
  }
});
