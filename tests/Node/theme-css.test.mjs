import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

  assert.ok(contrast(text, white) >= 7, 'body text should meet the light-theme AAA target');
  assert.ok(contrast(accent, white) >= 4.5, 'accent text should meet AA contrast on white');
  assert.ok(contrast(text, soft) >= 4.5, 'body text should meet AA contrast on accent surfaces');
  const normalizedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    cssRuleBodies(normalizedCss, root).length,
    2,
    'base and mobile root rules should be scoped'
  );
  assert.match(css, /@media \(max-width: 700px\)/);
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

test('Geek Black changes only its final H1 top rhythm', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/geek-black.css'), 'utf8');
  const selector = '.easymde-rendered-content.easymde-markdown-theme-geek-black h1';
  const h1Rules = cssRuleBodies(css, selector);
  const fontRule = h1Rules.find((body) => /font-size:\s*24px;/.test(body));
  const finalH1Rule = h1Rules.at(-1);

  assert.ok(fontRule);
  assert.ok(finalH1Rule);
  assert.match(finalH1Rule, /margin-top:\s*30px;/);
  assert.doesNotMatch(css, /margin-top:\s*-0\.46em;/);
});

test('shared code typography prefers the neutral Mac terminal font stack', () => {
  const css = readFileSync(join(repoRoot, 'assets/css/frontend/base.css'), 'utf8');

  assert.equal(
    cssVariable(css, '--easymde-code-font-family'),
    'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace'
  );
  assert.doesNotMatch(css, /--easymde-code-font-family:[^;]*Operator Mono/);
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
