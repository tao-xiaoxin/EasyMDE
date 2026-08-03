import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    'phycat-cherry': 'phycat-cherry-code',
    'phycat-caramel': 'phycat-caramel-code',
    'phycat-forest': 'phycat-forest-code',
    'phycat-mint': 'phycat-mint-code',
    'phycat-sky': 'phycat-sky-code',
    'phycat-prussian': 'phycat-prussian-code',
    'phycat-sakura': 'phycat-sakura-code',
    'phycat-mauve': 'phycat-mauve-code',
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

function cssSelectors(css) {
  return Array.from(css.matchAll(/([^{}]+)\{[^{}]*\}/g), ([, selectors]) => (
    selectors.split(',').map((selector) => selector.trim())
  )).flat();
}

function blockCodeSelector(selector) {
  const normalizedSelector = selector.replaceAll(':not(pre)', '');
  const inlineOnly = /(?:(?:p|li|h[1-6]) code|:not\(pre\)\s*>\s*code)/.test(selector);
  const codeElement = /(^|[\s>+~])code(?=$|[\s>+~:.[#])/.test(normalizedSelector);

  return /(^|[\s>+~])pre(?=$|[\s>+~:.[#])|\.hljs(?:-|\b)|\.code-snippet__fix\b/.test(normalizedSelector)
    || (codeElement && !inlineOnly);
}

test('every article theme declares a registered associated code theme', () => {
  const articleThemes = articleThemeAssociations();
  const codeThemes = registeredThemes('src/Theme/CodeThemeRegistry.php');
  const codeThemeIds = new Set(codeThemes.map(({ id }) => id));

	assert.equal(articleThemes.length, 47);
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

  assert.equal(Object.keys(associations).length, 25);
  assert.equal(new Set(labels).size, labels.length, 'code-theme labels must be unique');

  for (const [articleId, codeId] of Object.entries(associations)) {
    assert.equal(articleThemes.get(articleId)?.defaultCodeTheme, codeId, `${articleId} association`);
    assert.equal(codeThemes.get(codeId)?.assetPath, 'assets/themes/code/typora-derived.css', `${codeId} asset`);

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

test('registered article themes contain no block-code presentation selectors', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    const selectors = cssSelectors(source(theme.assetPath));
    const blockSelectors = selectors.filter(blockCodeSelector);

    assert.deepEqual(blockSelectors, [], `${theme.id} should not own block-code presentation`);
  }
});

test('Typora-derived article themes stay locally scoped and offline-safe', () => {
  const typoraThemes = [
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
  ];

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
