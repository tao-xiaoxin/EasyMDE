import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

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
      /=>\s*\$this->theme\(\s*'([^']+)'[\s\S]*?'(assets\/themes\/article\/[^']+\.css)'\s*,\s*'([a-z0-9-]+)'(?:\s*,\s*(?:true|false))?\s*\)/g
    ),
    ([, id, assetPath, defaultCodeTheme]) => ({ id, assetPath, defaultCodeTheme })
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

  assert.equal(articleThemes.length, 23);
  for (const theme of articleThemes) {
    assert.ok(codeThemeIds.has(theme.defaultCodeTheme), `${theme.defaultCodeTheme} should be registered`);
  }
  assert.equal(
    articleThemes.find(({ id }) => 'fullstack-blue' === id)?.defaultCodeTheme,
    'fullstack-blue'
  );
  assert.ok(
    articleThemes
      .filter(({ id }) => 'fullstack-blue' !== id)
      .every(({ defaultCodeTheme }) => 'atom-one-dark' === defaultCodeTheme),
    'article themes with the same effective palette should reuse Atom One Dark'
  );
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
  assert.match(css, /\.easymde-rendered-content\.easymde-code-mac pre > code:not\(\.language-mermaid\)\s*\{[^}]*display:\s*block;/s);
  assert.match(css, /\.easymde-rendered-content\.easymde-code-mac pre > code:not\(\.language-mermaid\)\s*\{[^}]*white-space:\s*pre;/s);
  assert.match(css, /\.easymde-rendered-content\.easymde-code-mac pre > code:not\(\.language-mermaid\)\s*\{[^}]*letter-spacing:\s*0;/s);
  assert.match(css, /\.easymde-rendered-content\.easymde-code-mac pre > code:not\(\.language-mermaid\)\s*\{[^}]*word-spacing:\s*0;/s);
});

test('admin preview CSS delegates block-code presentation to the shared frame', () => {
  const selectors = cssSelectors(source('assets/css/admin/editor.css'));
  const previewBlockSelectors = selectors.filter(
    (selector) => /\.easymde-preview\b/.test(selector) && blockCodeSelector(selector)
  );

  assert.deepEqual(previewBlockSelectors, []);
});

test('production highlighting has no article-specific token rewriting', async () => {
  const highlighted = [];
  const frameVariables = new Map();
  const codeClasses = new Set();
  const frame = {
    style: {
      setProperty(name, value) {
        frameVariables.set(name, value);
      }
    }
  };
  const code = {
    classList: {
      add(className) {
        codeClasses.add(className);
      },
      contains(className) {
        return codeClasses.has(className);
      }
    },
    dataset: {},
    parentElement: frame
  };
  const mermaidCode = {
    classList: {
      contains(className) {
        return 'language-mermaid' === className;
      }
    },
    dataset: {},
    parentElement: frame
  };
  const root = {
    querySelectorAll(selector) {
      if ('pre > code' === selector) return [code, mermaidCode];
      if ('pre > code:not(.language-mermaid)' === selector) return [code];
      assert.fail(`unexpected code-block selector: ${selector}`);
    }
  };
  const window = {
    getComputedStyle() {
      return { backgroundColor: 'rgb(12, 34, 56)' };
    },
    hljs: {
      highlightElement(node) {
        highlighted.push(node);
      }
    }
  };
  const highlightSource = source('assets/js/frontend/code-highlight.js');

  assert.doesNotMatch(highlightSource, /fullstack-blue|normalizeFullstackBlueHighlight|easymde-mdnice-/);
  vm.runInNewContext(highlightSource, { document: {}, window });
  await window.EasyMDEEnhancements.enhance(root, { features: { syntaxHighlight: true } });

  assert.deepEqual(highlighted, [code]);
  assert.equal(codeClasses.has('hljs'), true);
  assert.equal(code.dataset.easymdeHighlighted, '1');
  assert.equal(frameVariables.get('--easymde-code-frame-background'), 'rgb(12, 34, 56)');
  assert.equal(mermaidCode.dataset.easymdeHighlighted, undefined);
});

test('code-theme background remains authoritative without Highlight.js', async () => {
  const frameVariables = new Map();
  const codeClasses = new Set();
  const frame = {
    style: {
      setProperty(name, value) {
        frameVariables.set(name, value);
      }
    }
  };
  const code = {
    classList: {
      add(className) {
        codeClasses.add(className);
      },
      contains(className) {
        return codeClasses.has(className);
      }
    },
    dataset: {},
    parentElement: frame
  };
  const root = {
    querySelectorAll(selector) {
      if ('pre > code' === selector || 'pre > code:not(.language-mermaid)' === selector) {
        return [code];
      }
      assert.fail(`unexpected code-block selector: ${selector}`);
    }
  };
  const window = {
    getComputedStyle(node) {
      assert.equal(node.classList.contains('hljs'), true);
      return { backgroundColor: 'rgb(250, 250, 250)' };
    }
  };

  vm.runInNewContext(source('assets/js/frontend/code-highlight.js'), { document: {}, window });
  await window.EasyMDEEnhancements.enhance(root, {
    features: { syntaxHighlight: false }
  });

  assert.equal(codeClasses.has('hljs'), true);
  assert.equal(code.dataset.easymdeHighlighted, undefined);
  assert.equal(
    frameVariables.get('--easymde-code-frame-background'),
    'rgb(250, 250, 250)'
  );
});

test('obsolete article-theme frame assets are physically absent', () => {
  for (const path of [
    'assets/images/fullstack-blue-code-window.svg',
    'assets/images/tech-blue-code-window.svg'
  ]) {
    assert.throws(() => source(path), { code: 'ENOENT' });
  }
});
