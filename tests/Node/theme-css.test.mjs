import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
