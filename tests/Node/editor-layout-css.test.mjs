import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssRule(source, selector) {
  const match = source.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  assert.ok(match?.groups?.body, `Missing CSS rule: ${selector}`);
  return match.groups.body;
}

function cssBlock(source, prelude, fromIndex = 0) {
  const preludeIndex = source.indexOf(prelude, fromIndex);
  assert.notEqual(preludeIndex, -1, `Missing CSS block: ${prelude}`);
  const openingBrace = source.indexOf('{', preludeIndex + prelude.length);
  assert.notEqual(openingBrace, -1, `Missing opening brace: ${prelude}`);

  let depth = 1;
  let quote = null;
  let inComment = false;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inComment) {
      if ('*' === character && '/' === next) {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if ('\\' === character) {
        index += 1;
      } else if (quote === character) {
        quote = null;
      }
      continue;
    }
    if ('/' === character && '*' === next) {
      inComment = true;
      index += 1;
    } else if ('"' === character || "'" === character) {
      quote = character;
    } else if ('{' === character) {
      depth += 1;
    } else if ('}' === character) {
      depth -= 1;
      if (0 === depth) return source.slice(openingBrace + 1, index);
    }
  }

  assert.fail(`Missing closing brace: ${prelude}`);
}

function assertDeclaration(rule, property, valuePattern) {
  const pattern = valuePattern instanceof RegExp
    ? valuePattern.source
    : escapeRegExp(valuePattern);
  assert.match(
    rule,
    new RegExp(`${escapeRegExp(property)}:\\s*${pattern};`, 's')
  );
}

test('immersive Custom CSS expanded editor is anchored to its dialog', () => {
  assert.match(
    css,
    /\.easymde-immersive-custom-css-dialog\s*\{[^}]*position:\s*relative;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-dialog\.is-code-expanded \.easymde-immersive-custom-css-controls\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*36px;/s
  );
});

test('immersive Custom CSS tabs own their geometry and interaction states', () => {
  assert.match(
    css,
    /@font-face\s*\{[^}]*font-family:\s*"EasyMDE Inter Variable";[^}]*font-style:\s*normal;[^}]*font-weight:\s*100 900;[^}]*src:\s*url\("\.\.\/\.\.\/vendor\/fonts\/inter-variable\/inter-latin-wght-normal\.woff2"\) format\("woff2"\);/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-secondary-actions button\s*\{/,
    'toolbar button geometry must not leak into descendant dialogs'
  );
  assert.match(
    css,
    /\.easymde-immersive-secondary-actions > button\s*\{[^}]*height:\s*30px;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-categories button,[\s\S]*?\.easymde-immersive-custom-css-targets button\s*\{[^}]*display:\s*block;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*5px;[^}]*color:\s*#69778e;[^}]*font-family:\s*"EasyMDE Inter Variable", system-ui, sans-serif;[^}]*font-size:\s*12px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18px;[^}]*cursor:\s*default;[^}]*transition-property:\s*background-color, color, box-shadow;[^}]*transition-duration:\s*150ms;[^}]*transition-timing-function:\s*cubic-bezier\(\.4, 0, \.2, 1\);/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-categories button\[aria-selected="false"\]:hover\s*\{[^}]*background:\s*rgba\(255, 255, 255, \.6\);[^}]*color:\s*#3e4d65;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-targets button\[aria-selected="false"\]:hover\s*\{[^}]*background:\s*rgba\(255, 255, 255, \.6\);/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-categories button:focus-visible,[\s\S]*?\.easymde-immersive-custom-css-targets button:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #cfe0ff;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-categories button\[aria-selected="true"\]:focus-visible,[\s\S]*?\.easymde-immersive-custom-css-targets button\[aria-selected="true"\]:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 2px #cfe0ff,\s*0 1px 3px rgba\(38, 53, 78, \.1\);/s
  );
});

test('immersive Custom CSS toggle separates its label from help text', () => {
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-custom-css-code-toggle\s*>\s*span\s*\{/
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-code-toggle-label\s*\{[^}]*box-sizing:\s*border-box;[^}]*display:\s*inline-flex;[^}]*height:\s*34px;[^}]*gap:\s*8px;[^}]*padding:\s*0 10px;[^}]*border:\s*1px solid #d5e0f5;[^}]*border-radius:\s*7px;[^}]*font-size:\s*13px;[^}]*font-weight:\s*500;[^}]*line-height:\s*19\.5px;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-custom-css-code-toggle-help\s*\{[^}]*box-sizing:\s*border-box;[^}]*min-width:\s*0;[^}]*margin-inline-start:\s*14px;[^}]*overflow:\s*hidden;[^}]*color:\s*#78859a;[^}]*font-size:\s*12px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18px;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s
  );
});

test('immersive Custom CSS preview isolates the native task checkbox', () => {
  assert.match(
    css,
    /\.easymde-custom-theme-preview \.task-item input\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*margin:\s*0;[^}]*appearance:\s*auto;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--easymde-text-color\);[^}]*accent-color:\s*var\(--easymde-success-color\);[^}]*font-size:\s*15px;[^}]*line-height:\s*22\.5px;[^}]*vertical-align:\s*baseline;/s
  );
  assert.match(
    css,
    /\.easymde-custom-theme-preview \.task-item input::before,[\s\S]*?\.easymde-custom-theme-preview \.task-item input::after\s*\{[^}]*display:\s*inline;[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*margin:\s*0;[^}]*float:\s*none;[^}]*content:\s*none;[^}]*vertical-align:\s*baseline;/s
  );
  assert.match(
    css,
    /\.easymde-custom-theme-preview \.task-item input\[type="checkbox"\]:checked::before\s*\{[^}]*display:\s*inline;/s
  );
});

test('immersive Custom CSS preview owns the reference blockquote border composition', () => {
  assert.match(
    css,
    /\.easymde-custom-theme-preview blockquote\s*\{[^}]*border:\s*0 solid rgba\(15, 23, 42, \.07\);[^}]*border-left:\s*4px solid var\(--easymde-quote-color\);/s
  );
});

test('immersive Custom CSS typography preserves the reference tracking', () => {
  assert.match(
    css,
    /#wpbody-content \.easymde-immersive-custom-css-dialog > header h1\s*\{[^}]*font-size:\s*24px;[^}]*letter-spacing:\s*-\.02em;/s
  );
  assert.match(
    css,
    /\.easymde-custom-theme-preview th\s*\{[^}]*font-size:\s*12px;[^}]*letter-spacing:\s*\.04em;/s
  );
});

test('shared editor message alerts use one compact semantic treatment', () => {
  assert.match(
    css,
    /\.easymde-editor-message-alert-host\s*\{[^}]*display:\s*flex;[^}]*width:\s*min\(560px, calc\(100vw - 32px\)\);[^}]*justify-content:\s*center;/s
  );
  assert.match(
    css,
    /\.easymde-editor-message-alert\s*\{[^}]*width:\s*fit-content;[^}]*min-width:\s*min\(344px, 100%\);[^}]*max-width:\s*100%;[^}]*min-height:\s*44px;[^}]*padding-block:\s*5px;[^}]*padding-inline:\s*26px 6px;[^}]*border-color:\s*rgba\(var\(--easymde-message-rgb\), \.18\);[^}]*border-radius:\s*10px;[^}]*background:\s*rgba\(var\(--easymde-message-rgb\), \.055\);[^}]*box-shadow:\s*0 6px 18px rgba\(var\(--easymde-message-rgb\), \.08\);[^}]*font-size:\s*14px;[^}]*letter-spacing:\s*\.5px;[^}]*line-height:\s*21px;/s
  );
  for (const [type, rgb] of [
    ['success', '0, 200, 2'],
    ['info', '11, 125, 255'],
    ['warning', '255, 172, 0'],
    ['error', '255, 51, 78']
  ]) {
    assert.match(
      css,
      new RegExp(
        `\\.easymde-editor-message-alert\\.is-${type}\\s*\\{[^}]*--easymde-message-rgb:\\s*${rgb};`,
        's'
      )
    );
  }
  assert.match(
    css,
    /\.easymde-editor-message-alert__icon\s*\{[^}]*width:\s*15px;[^}]*height:\s*15px;[^}]*flex:\s*0 0 15px;[^}]*background:\s*rgb\(var\(--easymde-message-rgb\)\);[^}]*font-size:\s*10px;[^}]*line-height:\s*15px;/s
  );
  assert.match(
    css,
    /\.easymde-editor-message-alert__message\s*\{[^}]*min-width:\s*0;[^}]*margin-inline-start:\s*11px;[^}]*flex:\s*0 1 auto;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s
  );
  assert.match(
    css,
    /\.easymde-editor-message-alert__close\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*margin-inline-start:\s*auto;[^}]*margin-inline-end:\s*-2px;[^}]*flex:\s*0 0 30px;/s
  );
  assert.match(
    css,
    /\.easymde-editor-message-alert__close svg\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;/s
  );
  const mobileAlerts = cssBlock(css, '@media (max-width: 600px)');
  assertDeclaration(
    cssRule(mobileAlerts, '.easymde-editor-message-alert-host'),
    'width',
    'calc(100vw - 24px)'
  );
  const mobileAlert = cssRule(
    mobileAlerts,
    '.easymde-editor-message-alert'
  );
  assertDeclaration(mobileAlert, 'width', '100%');
  assertDeclaration(mobileAlert, 'min-width', '0');

  const reducedMotionPrelude = '@media (prefers-reduced-motion: reduce)';
  const reducedMotion = cssBlock(
    css,
    reducedMotionPrelude,
    css.lastIndexOf(reducedMotionPrelude)
  );
  assertDeclaration(
    cssRule(reducedMotion, '.easymde-editor-message-alert__close'),
    'transition',
    'none'
  );
});

test('immersive Custom CSS duplicate error keeps the approved centered width', () => {
  const header = cssRule(
    css,
    '.easymde-immersive-custom-css-dialog > header.has-message-alert'
  );
  assertDeclaration(
    header,
    'grid-template-columns',
    'minmax(0, 1fr) 344px minmax(0, 1fr)'
  );
  const host = cssRule(
    css,
    '.easymde-immersive-custom-css-dialog > header > .easymde-editor-message-alert-host.is-dialog-compact'
  );
  assertDeclaration(host, 'grid-column', '2');
  assertDeclaration(host, 'grid-row', '1 / 3');
  assertDeclaration(host, 'width', '344px');
  assertDeclaration(host, 'max-width', '344px');
  assertDeclaration(host, 'justify-self', 'center');
  assertDeclaration(
    cssRule(
      css,
      '.easymde-immersive-custom-css-dialog .easymde-editor-message-alert.is-error.is-compact'
    ),
    'width',
    '344px'
  );
});

test('ordinary React editor CSS owns the historical fixed 50/50 workspace', () => {
  assert.doesNotMatch(css, /\.easymde-workspace-shell(?:[^a-z0-9_-]|$)/i);
  assert.match(
    css,
    /\.easymde-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"source preview";/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1080px\)[\s\S]*?\.easymde-workspace\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-areas:\s*"source"\s*"preview";/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1080px\)[\s\S]*?\.easymde-preview-react-root\s*\{[^}]*flex:\s*0 1 auto;[^}]*height:\s*420px;[^}]*min-height:\s*360px;[^}]*max-height:\s*58vh;/s
  );
});

test('ordinary CodeMirror shows a stable scroll-synchronized line-number gutter', () => {
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-source-react \.cm-scroller\s*\{[^}]*line-height:\s*inherit;/s
  );
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-source-react \.cm-gutters\s*\{[^}]*display:\s*flex;[^}]*width:\s*40px;[^}]*min-width:\s*40px;[^}]*background:\s*#f7f8fa;/s
  );
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-source-react \.cm-lineNumbers \.cm-gutterElement\s*\{[^}]*width:\s*40px;[^}]*min-width:\s*40px;[^}]*font-size:\s*12\.5px;/s
  );
});

test('ordinary Preview owns vertical scrolling and fits wide table content', () => {
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-preview\s*\{[^}]*overflow-x:\s*hidden;/s
  );
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-rendered-content table\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-rendered-content table\s*\{[^}]*table-layout:/s
  );
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-rendered-content :is\(th, td\)\s*\{[^}]*overflow-wrap:\s*anywhere;/s
  );
});

test('ordinary Preview provides an editorial reading rhythm without changing immersive Preview', () => {
  const previewRule = cssRule(
    css,
    '.easymde-editor:not(.is-immersive) .easymde-preview'
  );
  assertDeclaration(previewRule, 'padding-block', '0');
  assertDeclaration(
    previewRule,
    'padding-inline',
    'calc(max(clamp(14px, 4.5%, 22px), calc((100% - 680px) / 4)) - 5px)'
  );
  assertDeclaration(previewRule, 'background-image', 'none');
  assertDeclaration(previewRule, 'scroll-padding-block', '0');
  assertDeclaration(
    previewRule,
    'scroll-padding-inline',
    'calc(max(clamp(14px, 4.5%, 22px), calc((100% - 680px) / 4)) - 5px)'
  );
  assert.match(
    css,
    /@media \(max-width:\s*782px\)[\s\S]*?\.easymde-editor:not\(\.is-immersive\) \.easymde-preview\s*\{[^}]*padding-block:\s*0;[^}]*padding-inline:\s*5px;[^}]*scroll-padding-block:\s*0;[^}]*scroll-padding-inline:\s*5px;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor\.is-immersive(?:-split|-preview)? \.easymde-preview\s*\{[^}]*background-image:\s*none;/s
  );
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-rendered-content :is\(p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, a\)\s*\{[^}]*overflow-wrap:\s*anywhere;/s
  );
  const crimsonPreviewRule = css.match(
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-preview\.easymde-markdown-theme-crimson-focus:not\(\.easymde-custom-css-active\),\s*\.easymde-editor\.is-immersive-split \.easymde-preview\.easymde-markdown-theme-crimson-focus:not\(\.easymde-custom-css-active\)\s*\{(?<body>[^}]*)\}/s
  );
  assert.ok(crimsonPreviewRule?.groups?.body, 'Missing Crimson preview geometry rule');
  assertDeclaration(crimsonPreviewRule.groups.body, 'width', '100%');
  assertDeclaration(crimsonPreviewRule.groups.body, 'max-width', 'none');
  assertDeclaration(crimsonPreviewRule.groups.body, 'margin-inline', '0');
  assertDeclaration(crimsonPreviewRule.groups.body, 'padding', '36px max(20px, calc((100% - 576px) / 2)) 48px');
  assertDeclaration(crimsonPreviewRule.groups.body, 'background', '#fff');
  assertDeclaration(crimsonPreviewRule.groups.body, 'background-image', 'none');
  const mobileCrimsonLayout = cssBlock(css, '@media (max-width: 782px)');
  assertDeclaration(
    mobileCrimsonLayout.match(
      /\.easymde-editor:not\(\.is-immersive\) \.easymde-preview\.easymde-markdown-theme-crimson-focus:not\(\.easymde-custom-css-active\),\s*\.easymde-editor\.is-immersive-split \.easymde-preview\.easymde-markdown-theme-crimson-focus:not\(\.easymde-custom-css-active\)\s*\{(?<body>[^}]*)\}/s
    )?.groups?.body ?? '',
    'padding',
    '28px max(20px, calc((100% - 576px) / 2)) 36px'
  );
});

test('ordinary editor settings combines theme and font controls in one responsive popover', () => {
  const popover = readFileSync(
    new URL('../../assets/css/admin/popover.css', import.meta.url),
    'utf8'
  );
  assert.match(
    popover,
    /\.easymde-editor-settings-tail\s*\{[^}]*position:\s*fixed;[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*transform:\s*rotate\(45deg\);/s
  );
  assert.match(
    popover,
    /\.easymde-toolbar-popover-settings-panel\s*\{[^}]*width:\s*min\(468px, calc\(100vw - 32px\)\);[^}]*border-radius:\s*12px;/s
  );
  assert.match(
    popover,
    /\.easymde-editor-settings-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s
  );
  assert.match(
    popover,
    /\.easymde-editor-settings-tail\.is-below\s*\{[^}]*border-top:\s*1px solid #dfe4ea;[^}]*border-left:\s*1px solid #dfe4ea;/s
  );
  assert.match(
    popover,
    /\.easymde-editor-settings-tail\.is-above\s*\{[^}]*border-right:\s*1px solid #dfe4ea;[^}]*border-bottom:\s*1px solid #dfe4ea;/s
  );
  const optionsRule = cssRule(
    popover,
    '.easymde-ordinary-select-options'
  );
  assertDeclaration(
    optionsRule,
    'border',
    '1px solid rgba(255, 255, 255, .72)'
  );
  assertDeclaration(
    optionsRule,
    'background',
    'rgba(255, 255, 255, .78)'
  );
  assertDeclaration(
    optionsRule,
    '-webkit-backdrop-filter',
    'blur(18px) saturate(150%)'
  );
  assertDeclaration(
    optionsRule,
    'backdrop-filter',
    'blur(18px) saturate(150%)'
  );
  assertDeclaration(
    optionsRule,
    'box-shadow',
    '0 14px 32px rgba(15, 23, 42, .18), inset 0 1px 0 rgba(255, 255, 255, .85)'
  );
  assert.match(
    popover,
    /\.easymde-ordinary-select-options \[role="option"\]\.is-active\s*\{[^}]*background:\s*rgba\(226, 239, 249, \.82\);/s
  );
  assert.match(
    popover,
    /\.easymde-ordinary-select-options \[role="option"\]\.has-swatch\s*\{[^}]*grid-template-columns:\s*18px 11px minmax\(0, 1fr\);[^}]*gap:\s*8px;/s
  );
  assert.match(
    popover,
    /\.easymde-ordinary-select-swatch\s*\{[^}]*width:\s*11px;[^}]*height:\s*11px;[^}]*border:\s*1px solid rgba\(0, 0, 0, \.1\);[^}]*border-radius:\s*50%;[^}]*box-shadow:\s*0 1px 2px rgba\(15, 23, 42, \.12\);/s
  );
});

test('ordinary heading menu uses compact geometry without changing immersive styles', () => {
  const toolbar = readFileSync(
    new URL('../../assets/css/admin/toolbar.css', import.meta.url),
    'utf8'
  );
  const popover = readFileSync(
    new URL('../../assets/css/admin/popover.css', import.meta.url),
    'utf8'
  );
  assert.match(
    toolbar,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-button-menu\.easymde-toolbar-button-compact\s*\{[^}]*width:\s*54px;[^}]*min-width:\s*54px;/s
  );
  assert.match(
    toolbar,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-glyph-heading\s*\{[^}]*flex:\s*0 0 24px;[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*border-radius:\s*7px;[^}]*background:\s*#f1f4f7;[^}]*font-size:\s*16px;[^}]*font-weight:\s*750;/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-toolbar-popover\s*\{[^}]*inset-inline-end:\s*auto;[^}]*inset-inline-start:\s*0;[^}]*width:\s*208px;[^}]*padding:\s*7px;/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-toolbar-popover::before\s*\{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*top:\s*-8px;[^}]*inset-inline-start:\s*20px;[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*border-top:\s*1px solid #d0d7de;[^}]*border-left:\s*1px solid #d0d7de;[^}]*background:\s*#fff;[^}]*transform:\s*rotate\(45deg\);/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-popover-item\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*30px minmax\(0, 1fr\) auto;[^}]*min-height:\s*32px;[^}]*padding:\s*0 9px;[^}]*border-radius:\s*8px;/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-heading-menu-badge\s*\{[^}]*width:\s*30px;[^}]*height:\s*24px;[^}]*justify-content:\s*center;[^}]*border:\s*1px solid #cbd5e1;[^}]*border-radius:\s*6px;[^}]*background:\s*#fbfcfe;[^}]*color:\s*#526987;/s
  );
  for (const [level, markSize, markWeight] of [
    [1, 16, 700],
    [2, 15, 680],
    [3, 14, 650],
    [4, 13, 620],
    [5, 12, 600],
    [6, 11, 580]
  ]) {
    assert.match(
      popover,
      new RegExp(
        `\\.easymde-editor:not\\(\\.is-immersive\\) \\.easymde-heading-menu-badge\\[data-heading-level="${level}"\\]\\s*\\{[^}]*font-size:\\s*${markSize}px;[^}]*font-weight:\\s*${markWeight};`,
        's'
      )
    );
  }
  assert.doesNotMatch(
    popover,
    /\.is-immersive-heading-menu[^}]*easymde-heading-menu-badge/s
  );
});

test('withdrawn ordinary editor surfaces have no retained CSS runtime', () => {
  for (const className of [
    'easymde-editor-context-bar',
    'easymde-draft-status',
    'easymde-editor-panes',
    'easymde-outline-panel',
    'easymde-pane-divider',
    'easymde-publishing-dialog',
    'easymde-react-workspace',
    'easymde-revisions-dialog',
    'easymde-side-action',
    'easymde-statistics-panel',
    'easymde-view-switch'
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${className}(?:[^a-z0-9_-]|$)`, 'i'));
  }
  assert.match(
    css,
    /\.easymde-editor-status-bar\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*38px;/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*782px\)[\s\S]*?\.easymde-editor-status-bar\s*\{[^}]*align-items:\s*flex-start;[^}]*flex-direction:\s*column;/s
  );
});

test('immersive publish CSS preserves reference geometry without hiding the password field', () => {
  assert.match(
    css,
    /\.easymde-publish-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 32px\);[^}]*flex-direction:\s*column;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-publish-dialog\s*\{[^}]*\bheight:\s*min\(728\.25px,/s
  );
  assert.match(
    css,
    /\.easymde-publish-field\s*\{[^}]*margin:\s*0;[^}]*\}\s*\.easymde-publish-field \+ \.easymde-publish-field\s*\{[^}]*margin-top:\s*22px;/s
  );
  assert.match(
    css,
    /\.easymde-publish-visibility > div\[role="radiogroup"\] input,[\s\S]*?\.easymde-publish-sticky input\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*margin:\s*-1px;[^}]*overflow:\s*hidden;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*clip-path:\s*inset\(50%\);[^}]*white-space:\s*nowrap;[^}]*appearance:\s*auto;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-publish-visibility input(?:\s*,|\s*\{)/
  );
  assert.match(
    css,
    /\.easymde-publish-password input\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*height:\s*38px;[^}]*min-height:\s*0;[^}]*margin:\s*0;/s
  );
  assert.match(
    css,
    /\.easymde-publish-visibility > div\[role="radiogroup"\]\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s
  );
  assert.match(
    css,
    /\.easymde-publish-visibility > div\[role="radiogroup"\] label > span\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*flex:\s*0 0 14px;/s
  );
  assert.match(
    css,
    /\.easymde-publish-password input:focus\s*\{[^}]*border-color:\s*#e2e8f0;[^}]*box-shadow:\s*0 0 0 2px #dbeafe;[^}]*outline:\s*0;/s
  );
  assert.match(
    css,
    /\.easymde-publish-visibility > div\[role="radiogroup"\] input:focus-visible \+ span,[\s\S]*?\.easymde-publish-sticky input:focus-visible \+ span\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(37, 99, 235, 0\.18\);/s
  );
  assert.match(
    css,
    /\.easymde-publish-checkbox\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*flex:\s*0 0 18px;/s
  );
  assert.match(
    css,
    /\.easymde-publish-sticky > span\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;[^}]*flex:\s*0 0 17px;/s
  );
});

test('immersive header view controls preserve the reference text baseline', () => {
  assert.match(
    css,
    /\.easymde-immersive-view-switch button\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18\.75px;[^}]*transition:\s*all 150ms cubic-bezier\(\.4, 0, \.2, 1\);/s
  );
});

test('immersive Markdown pane preserves the reference header and source rhythm', () => {
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-pane-header\s*\{[^}]*padding:\s*10px 15px;[^}]*border-bottom:\s*1px solid #e8ebef;[^}]*font-family:\s*"EasyMDE Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;[^}]*letter-spacing:\s*0;[^}]*line-height:\s*22\.5px;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-pane-source > \.easymde-pane-header > span:first-child\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*\.3px;[^}]*line-height:\s*19\.5px;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-source-react \.cm-content\s*\{[^}]*padding:\s*14px 14px 14px 0;[^}]*line-height:\s*28px;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-source-react \.cm-line\s*\{[^}]*min-height:\s*28px;[^}]*line-height:\s*28px;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-source-react \.cm-gutters\s*\{[^}]*display:\s*flex;[^}]*box-sizing:\s*border-box;[^}]*width:\s*36px;[^}]*min-width:\s*36px;[^}]*flex:\s*0 0 36px;[^}]*border:\s*0;[^}]*background:\s*#f2f2f2;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-source-react \.cm-lineNumbers \.cm-gutterElement\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*36px;[^}]*min-width:\s*36px;[^}]*padding:\s*0;[^}]*padding-inline-end:\s*14px;[^}]*font-size:\s*13\.5px;[^}]*line-height:\s*28px;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-source-react \.cm-gutters\s*\{[^}]*display:\s*none;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor\.is-immersive \.easymde-source-react \.cm-line::before/
  );
});

test('immersive header preserves the reference flex geometry without decimal truncation', () => {
  assert.match(
    css,
    /\.easymde-immersive-header\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-brand\s*\{[^}]*width:\s*auto;[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-brand-mark\s*\{[^}]*gap:\s*5\.625px;[^}]*margin-inline-start:\s*3\.75px;[^}]*flex:\s*0 0 auto;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-brand-mark\s*\{[^}]*(?:width|flex-basis):\s*77\.766px;/s,
    'desktop brand width must be owned by its icon, gap, and text content'
  );
  assert.match(
    css,
    /\.easymde-immersive-brand-name\s*\{[^}]*color:\s*oklch\(37\.2% \.044 257\.287\);[^}]*font-size:\s*13px;[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*-\.025em;[^}]*line-height:\s*19\.5px;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-brand-mark > svg\s*\{[^}]*color:\s*oklch\(62\.3% \.214 259\.815\);/s
  );
  assert.match(
    css,
    /\.easymde-immersive-title-wrap\s*\{[^}]*gap:\s*5\.625px;[^}]*flex:\s*0 1 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-save-state\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-stats\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-view-switch\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-header-spacer\.is-primary\s*\{[^}]*flex:\s*1 1 0%;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-header-spacer\.is-secondary\s*\{[^}]*flex:\s*3 1 0%;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-header-actions\s*\{[^}]*width:\s*230\.421875px;[^}]*flex:\s*0 0 auto;/s
  );
});

test('immersive heading trigger preserves the reference text box and weight', () => {
  assert.match(
    css,
    /\.easymde-immersive-formatting \.easymde-toolbar-popover-headings \.easymde-toolbar-text-icon\s*\{[^}]*height:\s*12px;[^}]*font-size:\s*12px;[^}]*font-weight:\s*600;[^}]*line-height:\s*1;/s
  );
});

test('immersive outline footer keeps the reference content-sized action', () => {
  assert.match(
    css,
    /\.easymde-immersive-outline-footer\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*padding:\s*0 15px;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-outline-footer\s*\{[^}]*background:/s
  );
  assert.match(
    css,
    /\.easymde-immersive-outline-footer button\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*gap:\s*5\.625px;[^}]*padding:\s*0;[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18\.75px;/s
  );
});

test('collapsed immersive outline preserves the reference full-height rail', () => {
  assert.match(
    css,
    /\.easymde-immersive-outline-show\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*3;[^}]*width:\s*33\.75px;[^}]*margin-block:\s*11\.25px;[^}]*margin-inline:\s*11\.25px 0;[^}]*border:\s*1px solid #e8ebef;[^}]*border-radius:\s*16px;[^}]*background:\s*#fff;[^}]*color:\s*#94a3b8;[^}]*box-shadow:\s*none;/s,
    'the collapsed outline control should be the full-height reference rail',
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-outline-show\s*\{[^}]*position:\s*fixed;/s,
    'the collapsed outline rail must remain in the immersive workspace grid',
  );
  assert.match(
    css,
    /\.easymde-immersive-outline-show:hover\s*\{[^}]*background:\s*#f8fafc;[^}]*color:\s*#334155;/s,
    'the collapsed outline rail should preserve the reference hover treatment',
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive:not\(:has\(\.easymde-immersive-outline\)\):not\(:has\(\.easymde-immersive-outline-show\)\)\s*\{\s*grid-template-columns:\s*1fr;\s*\}/,
    'the workspace should collapse to one column only when both outline surfaces are absent',
  );
});

test('immersive outline and editor panes use the reference 16px card radius', () => {
  assert.match(
    css,
    /\.easymde-immersive-outline\s*\{[^}]*border-radius:\s*16px;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive \.easymde-pane\s*\{[^}]*border-radius:\s*16px;/s
  );
});

test('immersive Preview mode owns the reference canvas and article page geometry', () => {
  assert.match(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-canvas\s*\{[^}]*display:\s*block;[^}]*overflow-y:\s*auto;[^}]*padding:\s*28px 20px;[^}]*border:\s*0 solid rgba\(15, 23, 42, \.07\);[^}]*background:\s*#fff;[^}]*color:\s*#0f172a;[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-page\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-width:\s*760px;[^}]*min-height:\s*680px;[^}]*margin:\s*0 auto;[^}]*padding:\s*36px 40px;[^}]*border:\s*1px solid #e1e5eb;[^}]*background:\s*#fff;[^}]*box-shadow:\s*0 8px 28px rgba\(15, 23, 42, \.06\);[^}]*color:\s*#0f172a;[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;/s
  );
  const immersivePreviewContentRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus:not(.easymde-custom-css-active)'
  );
  assertDeclaration(immersivePreviewContentRule, 'background', '#fff');
  assertDeclaration(immersivePreviewContentRule, 'background-image', 'none');
  const readonlyPreviewPageRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page:has(> .easymde-preview.easymde-markdown-theme-crimson-focus:not(.easymde-custom-css-active):not(.easymde-immersive-visual-editor))'
  );
  assertDeclaration(readonlyPreviewPageRule, 'padding', '0');
  const readonlyPreviewContentRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus:not(.easymde-custom-css-active):not(.easymde-immersive-visual-editor)'
  );
  assertDeclaration(readonlyPreviewContentRule, 'padding', '36px 40px');
  const editablePreviewPageRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page:has(> .easymde-preview.easymde-markdown-theme-crimson-focus.easymde-immersive-visual-editor)'
  );
  assertDeclaration(editablePreviewPageRule, 'padding', '0');
  const editablePreviewContentRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus.easymde-immersive-visual-editor'
  );
  assertDeclaration(editablePreviewContentRule, 'width', '100%');
  assertDeclaration(editablePreviewContentRule, 'max-width', 'none');
  assertDeclaration(editablePreviewContentRule, 'padding', '36px 40px');
  const desktopImmersivePreview = cssBlock(css, '@media (min-width: 640px)');
  assertDeclaration(
    cssRule(
      desktopImmersivePreview,
      '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus:not(.easymde-custom-css-active):not(.easymde-immersive-visual-editor)'
    ),
    'padding',
    '45px 52.5px'
  );
  assertDeclaration(
    cssRule(
      desktopImmersivePreview,
      '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus.easymde-immersive-visual-editor'
    ),
    'padding',
    '45px 52.5px'
  );
  const mobileImmersivePreview = cssBlock(css, '@media (max-width: 760px)');
  assertDeclaration(
    cssRule(
      mobileImmersivePreview,
      '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus:not(.easymde-custom-css-active):not(.easymde-immersive-visual-editor)'
    ),
    'padding',
    '28px 24px'
  );
  assertDeclaration(
    cssRule(
      mobileImmersivePreview,
      '.easymde-editor.is-immersive-preview .easymde-immersive-preview-page > .easymde-preview.easymde-markdown-theme-crimson-focus.easymde-immersive-visual-editor'
    ),
    'padding',
    '28px 24px'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-page > \.easymde-preview\s*\{/
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-status > \.easymde-immersive-preview-lock\s*\{[^}]*display:\s*grid;[^}]*width:\s*26\.25px;[^}]*height:\s*26\.25px;[^}]*border:\s*1px solid #d8dee8;[^}]*border-radius:\s*3\.625px;[^}]*background:\s*#fff;[^}]*color:\s*#64748b;[^}]*font-size:\s*15px;[^}]*font-weight:\s*500;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-status > \.easymde-immersive-preview-lock\.is-editable\s*\{[^}]*border-color:\s*#c9d7fa;[^}]*background:\s*#f4f7ff;[^}]*color:\s*#356ae6;/s
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-visual-editor\s*\{[^}]*outline:\s*0;[^}]*cursor:\s*text;[^}]*caret-color:\s*var\(--accent, #4c6ef5\);/s
  );
  assert.match(
    css,
    /@media \(min-width:\s*640px\)\s*\{[^}]*\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-canvas\s*\{[^}]*padding:\s*26\.25px 37\.5px;/s
  );
  assert.match(
    css,
    /@media \(min-width:\s*640px\)\s*\{[\s\S]*?\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-page\s*\{[^}]*padding:\s*45px 52\.5px;/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-page\s*\{[^}]*padding:\s*28px 24px;[^}]*min-height:\s*520px;/s
  );
});

test('immersive Preview leaves article typography to the selected theme', () => {
  assert.match(
    css,
    /@font-face\s*\{[^}]*font-family:\s*"EasyMDE Lora";[^}]*font-style:\s*normal;[^}]*font-weight:\s*600;[^}]*src:\s*url\("\.\.\/\.\.\/vendor\/fonts\/lora\/lora-latin-600-normal\.woff2"\) format\("woff2"\);/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-reference-prose/
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive-split \.easymde-preview\s*\{[^}]*padding:\s*34px 48px 60px;[^}]*background:\s*#fff;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor(?:\.is-immersive|\.is-immersive-preview) \.easymde-preview\s*\{[^}]*padding:\s*34px 48px 60px;[^}]*background:\s*#fff;/s
  );
});

test('immersive Preview header owns the reference typography and divider', () => {
  assert.match(
    css,
    /\.easymde-immersive-preview-heading \{ gap: 7\.5px; \}/u
  );
  assert.match(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-surface > \.easymde-pane-header\s*\{[^}]*border-bottom:\s*1px solid #e8ebef;[^}]*font-family:\s*"EasyMDE Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;[^}]*letter-spacing:\s*0;[^}]*line-height:\s*22\.5px;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-heading > span:first-child\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*0;[^}]*line-height:\s*19\.5px;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-heading > span:nth-child\(2\)\s*\{[^}]*width:\s*1px;[^}]*height:\s*11\.25px;[^}]*background:\s*#dde2e9;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-heading > span:last-child\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*400;[^}]*letter-spacing:\s*0;[^}]*line-height:\s*18px;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-status \{ gap: 9\.375px; \}/u
  );
  assert.match(
    css,
    /\.easymde-immersive-preview-status > span:first-child\s*\{[^}]*gap:\s*5\.625px;[^}]*font-size:\s*12px;[^}]*font-weight:\s*400;[^}]*letter-spacing:\s*0;[^}]*line-height:\s*18px;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor\.is-immersive-preview \.easymde-immersive-preview-canvas\s*\{[^}]*scrollbar-width:/s
  );
});
