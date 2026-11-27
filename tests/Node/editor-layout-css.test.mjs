import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const css = readFileSync(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');
const messageAlertCss = readFileSync(new URL('../../assets/css/admin/message-alert.css', import.meta.url), 'utf8');
const frontendCss = readFileSync(new URL('../../assets/css/frontend/base.css', import.meta.url), 'utf8');
const codeFrameCss = readFileSync(new URL('../../assets/css/frontend/code-frame.css', import.meta.url), 'utf8');
const frontendAssetsPhp = readFileSync(new URL('../../src/Frontend/FrontendAssets.php', import.meta.url), 'utf8');
const wechatExportPaperSelector = ':where(:not([data-easymde-wechat-export-style-context="1"]))';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssRule(source, selector) {
  const match = source.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  assert.ok(match?.groups?.body, `Missing CSS rule: ${selector}`);
  return match.groups.body;
}

function cssRuleAtLine(source, selector) {
  const match = source.match(new RegExp(`^${escapeRegExp(selector)}\\s*\\{(?<body>[^}]*)\\}`, 'ms'));
  assert.ok(match?.groups?.body, `Missing top-level CSS rule: ${selector}`);
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
    messageAlertCss,
    /\.easymde-editor-message-alert-host\s*\{[^}]*display:\s*flex;[^}]*width:\s*min\(560px, calc\(100vw - 32px\)\);[^}]*justify-content:\s*center;/s
  );
  assert.match(
    messageAlertCss,
    /\.easymde-editor-message-alert\s*\{[^}]*width:\s*fit-content;[^}]*min-width:\s*min\(344px, 100%\);[^}]*max-width:\s*100%;[^}]*min-height:\s*44px;[^}]*padding-block:\s*5px;[^}]*padding-inline:\s*26px 6px;[^}]*border-color:\s*rgba\(var\(--easymde-message-rgb\), \.18\);[^}]*border-radius:\s*10px;[^}]*background:\s*rgba\(var\(--easymde-message-rgb\), \.055\);[^}]*box-shadow:\s*0 6px 18px rgba\(var\(--easymde-message-rgb\), \.08\);[^}]*font-size:\s*14px;[^}]*letter-spacing:\s*\.5px;[^}]*line-height:\s*21px;/s
  );
  for (const [type, rgb] of [
    ['success', '0, 200, 2'],
    ['info', '11, 125, 255'],
    ['warning', '255, 172, 0'],
    ['error', '255, 51, 78']
  ]) {
    assert.match(
      messageAlertCss,
      new RegExp(
        `\\.easymde-editor-message-alert\\.is-${type}\\s*\\{[^}]*--easymde-message-rgb:\\s*${rgb};`,
        's'
      )
    );
  }
  assert.match(
    messageAlertCss,
    /\.easymde-editor-message-alert__icon\s*\{[^}]*width:\s*15px;[^}]*height:\s*15px;[^}]*flex:\s*0 0 15px;[^}]*background:\s*rgb\(var\(--easymde-message-rgb\)\);[^}]*font-size:\s*10px;[^}]*line-height:\s*15px;/s
  );
  assert.match(
    messageAlertCss,
    /\.easymde-editor-message-alert__message\s*\{[^}]*min-width:\s*0;[^}]*margin-inline-start:\s*11px;[^}]*flex:\s*0 1 auto;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s
  );
  assert.match(
    messageAlertCss,
    /\.easymde-editor-message-alert__close\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*margin-inline-start:\s*auto;[^}]*margin-inline-end:\s*-2px;[^}]*flex:\s*0 0 30px;/s
  );
  assert.match(
    messageAlertCss,
    /\.easymde-editor-message-alert__close svg\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;/s
  );
  const mobileAlerts = cssBlock(messageAlertCss, '@media (max-width: 600px)');
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
    messageAlertCss,
    reducedMotionPrelude,
    messageAlertCss.lastIndexOf(reducedMotionPrelude)
  );
  assertDeclaration(
    cssRule(reducedMotion, '.easymde-editor-message-alert__close'),
    'transition',
    'none'
  );
  assert.doesNotMatch(css, /\.easymde-editor-message-alert\s*\{/);
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
  assert.doesNotMatch(
    css,
    /\.easymde-workspace\.is-mode-(?:source|preview)\b/,
    'ordinary workspace must not define single-pane .is-mode-source or .is-mode-preview rules'
  );
  assert.doesNotMatch(
    css,
    /grid-template-areas:\s*"source"\s*"preview";/s,
    'ordinary and immersive split workspaces must stay side-by-side without vertical stacking'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-pane-divider\s*\{[^}]*display:\s*none;/s,
    'immersive split divider must remain visible across all viewport widths'
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width:\s*1080px\)[^{]*\{[\s\S]*?\.easymde-pane-source\s*\{[^}]*border-bottom:/s,
    'ordinary source pane must keep its inline-end split border without stacking at 1080px'
  );

  const intermediateImmersiveMedia = cssBlock(
    css,
    '@media (max-width: 1080px)',
    css.lastIndexOf('@media (max-width: 1080px)')
  );
  assertDeclaration(
    cssRule(intermediateImmersiveMedia, '.easymde-immersive-toolbar-row'),
    'grid-template-rows',
    'repeat(2, minmax(0, 1fr))'
  );
  const intermediateOutlineRule = cssRule(
    intermediateImmersiveMedia,
    '.easymde-editor.is-immersive .easymde-immersive-outline'
  );
  assertDeclaration(intermediateOutlineRule, 'min-width', '160px');
  assertDeclaration(
    intermediateOutlineRule,
    'max-width',
    'clamp(160px, 24vw, 220px)'
  );
  assert.doesNotMatch(
    intermediateImmersiveMedia,
    /\.easymde-immersive-pane-divider/,
    'intermediate immersive breakpoint must not hide the split divider'
  );

  const section17Start = css.lastIndexOf('17. Ordinary Editor & Shared Responsive Breakpoints');
  const section18Start = css.lastIndexOf('18. WordPress Media Picker Dialog');
  assert.ok(
    section17Start > -1 && section18Start > section17Start,
    'Missing Section 17/18 CSS markers'
  );
  const section17Css = css.slice(section17Start, section18Start);
  const sharedTabletPortraitMedia = cssBlock(
    section17Css,
    '@media (max-width: 782px)'
  );
  const tabletSplitPreviewPaper = cssRule(
    sharedTabletPortraitMedia,
    `#easymde-editor-root .easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector},\n    #easymde-editor-root .easymde-editor[data-easymde-preview-presentation="split"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(tabletSplitPreviewPaper, 'padding', '18px 18px 24px');

  const section19Start = css.lastIndexOf('19. Immersive Mode Responsive Breakpoints');
  const section20Start = css.lastIndexOf('20. Unified ProseMirror Immersive Visual Editor Surface');
  assert.ok(
    section19Start > -1 && section20Start > section19Start,
    'Missing Section 19/20 CSS markers'
  );
  const section19Css = css.slice(section19Start, section20Start);

  const tabletPortraitMedia = cssBlock(
    section19Css,
    '@media (max-width: 782px)'
  );
  assertDeclaration(
    cssRule(tabletPortraitMedia, '.easymde-editor.is-immersive'),
    'grid-template-columns',
    'minmax(0, 1fr)'
  );
  assertDeclaration(
    cssRule(tabletPortraitMedia, '.easymde-immersive-header'),
    'grid-template-columns',
    'auto minmax(0, 1fr) auto'
  );
  assertDeclaration(
    cssRule(tabletPortraitMedia, '.easymde-immersive-stats'),
    'display',
    'none'
  );
  assertDeclaration(
    cssRule(tabletPortraitMedia, '.easymde-editor.is-immersive > .easymde-workspace'),
    'grid-column',
    '1'
  );
  assert.doesNotMatch(
    tabletPortraitMedia,
    /\.easymde-editor:not\(\.is-immersive\)/,
    'ordinary editor preview padding belongs in Section 17 shared breakpoints, not Section 19'
  );
  assertDeclaration(
    cssRule(css, '.easymde-editor.is-immersive .easymde-immersive-pane-divider'),
    'touch-action',
    'none'
  );

  assertDeclaration(
    cssRule(
      tabletPortraitMedia,
      '.easymde-editor.is-immersive.is-immersive-split .easymde-pane-header'
    ),
    'padding-inline',
    '12px'
  );

  const tabletOutlineOverlay = cssRule(
    tabletPortraitMedia,
    '.easymde-editor.is-immersive .easymde-immersive-outline'
  );
  assertDeclaration(tabletOutlineOverlay, 'position', 'absolute');
  assertDeclaration(tabletOutlineOverlay, 'min-width', '0');
  assertDeclaration(
    tabletOutlineOverlay,
    'max-width',
    'min(240px, calc(100% - 22.5px))'
  );
  assertDeclaration(
    cssRule(
      tabletPortraitMedia,
      '.easymde-editor.is-immersive .easymde-immersive-outline-show'
    ),
    'position',
    'absolute'
  );
  assertDeclaration(
    cssRule(
      tabletPortraitMedia,
      '.easymde-editor.is-immersive .easymde-immersive-outline-resizer'
    ),
    'display',
    'none'
  );
  assert.doesNotMatch(
    tabletPortraitMedia,
    /\.easymde-immersive-pane-divider/,
    'tablet-portrait immersive breakpoint must hide only the outline resizer, never the split divider'
  );
  assert.doesNotMatch(
    section19Css,
    /@media \(max-width:\s*640px\)/,
    'Section 19 must not retain the obsolete phone-writing 640px breakpoint'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-publish\s*\{[^}]*font-size:\s*0;/s,
    'obsolete phone-only icon-only publish button rule must be removed'
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width:\s*480px\)/,
    'obsolete phone-only 480px breakpoint must be removed'
  );
});

test('editor-root preview baselines stay low-specificity and scoped', () => {
  const paragraphRule = cssRule(css, '#easymde-editor-root :where(.easymde-rendered-content p)');
  assertDeclaration(paragraphRule, 'font-size', 'inherit');
  assertDeclaration(paragraphRule, 'line-height', 'inherit');
  const headingRule = cssRule(
    css,
    '#easymde-editor-root :where(.easymde-rendered-content) :is(h1, h2, h3, h4, h5, h6)'
  );
  assertDeclaration(headingRule, 'padding', '0');
  assert.match(
    '#easymde-editor-root :where(.easymde-rendered-content p)',
    /^#easymde-editor-root :where\(/,
  );
  assert.doesNotMatch(
    css,
    /(^|\n)\s*(?:body|html|:root)\s+\.easymde-rendered-content\b/m,
    'editor baselines must not broaden into public content selectors',
  );
});

test('shared Preview task markers override WordPress checkbox geometry', () => {
  const inputRule = cssRule(
    css,
    `.easymde-editor .easymde-rendered-content :where(
  .task-list-item > input[type="checkbox"],
  .task-list-item > p > input[type="checkbox"]
)`
  );
  assertDeclaration(inputRule, 'width', '1rem');
  assertDeclaration(inputRule, 'min-width', '1rem');
  assertDeclaration(inputRule, 'height', '1rem');

  const pseudoRule = cssRule(
    css,
    `.easymde-editor .easymde-rendered-content :where(
  .task-list-item > input[type="checkbox"],
  .task-list-item > p > input[type="checkbox"]
):is(:checked, :not(:checked)):is(:disabled, :enabled)::before`
  );
  assertDeclaration(pseudoRule, 'width', '100%');
  assertDeclaration(pseudoRule, 'height', '100%');
  assertDeclaration(pseudoRule, 'margin', '0');
  assertDeclaration(pseudoRule, 'float', 'none');
  assertDeclaration(pseudoRule, 'opacity', '1');
});

test('shared rendered list baselines survive the WordPress admin reset without overriding list owners', () => {
  const wordpressReset = `
ul { list-style-type: none; }
ol { list-style-type: decimal; margin-left: 2em; }
`;
  const articleThemeCss = (id) => readFileSync(
    new URL(`../../assets/themes/article/${id}.css`, import.meta.url),
    'utf8'
  );
  const nestedListMarkup = (tag, level = 1) => {
    const child = level < 6 ? nestedListMarkup(tag, level + 1) : '';
    return `<${tag} id="${tag}-level-${level}"><li>Level ${level}${child}</li></${tag}>`;
  };
  const createListCase = ({
    theme = 'default',
    themeCss = '',
    customCss = '',
    customTheme = false
  } = {}) => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      pretendToBeVisual: true
    });
    const document = dom.window.document;
    const appendStyle = (source) => {
      const style = document.createElement('style');
      style.textContent = source;
      document.head.append(style);
    };

    appendStyle(wordpressReset);
    appendStyle(frontendCss);
    if (themeCss) appendStyle(themeCss);
    if (customCss) appendStyle(customCss);
    document.body.innerHTML = `
      <article id="article" class="easymde-rendered-content easymde-markdown-theme-${theme}${customTheme ? ' easymde-custom-css-active' : ''}">
        ${nestedListMarkup('ul')}
        ${nestedListMarkup('ol')}
        <ol id="mixed"><li id="mixed-item"><ul id="mixed-child"><li>Mixed</li></ul></li></ol>
        <ul><li><ol><li><ul id="third-nested"><li>Third nested</li></ul></li></ol></li></ul>
        <ul class="task-list" id="task-list">
          <li class="task-list-item" id="task-checked">
            <input id="task-checked-input" type="checkbox" checked>Checked task
            <ul id="task-nested"><li id="task-nested-item">Nested ordinary</li></ul>
          </li>
          <li class="task-list-item" id="task-unchecked"><p><input id="task-unchecked-input" type="checkbox">Unchecked task</p></li>
        </ul>
        <ol class="task-list" id="ordered-task-list">
          <li class="task-list-item" id="ordered-task-item"><input id="ordered-task-input" type="checkbox" checked>Ordered task</li>
        </ol>
      </article>`;
    const styleOf = (id) => dom.window.getComputedStyle(document.getElementById(id)).listStyleType;
    const customMarkerRule = customCss
      ? [...document.styleSheets]
          .flatMap((styleSheet) => [...styleSheet.cssRules])
          .find((rule) => rule.selectorText === '.easymde-rendered-content.easymde-custom-css-active ul li::marker')
      : null;
    const result = {
      ulLevels: [1, 2, 3, 4, 5, 6].map((level) => styleOf(`ul-level-${level}`)),
      olLevels: [1, 2, 3, 4, 5, 6].map((level) => styleOf(`ol-level-${level}`)),
      mixed: styleOf('mixed-child'),
      thirdNested: styleOf('third-nested'),
      taskList: styleOf('task-list'),
      taskItems: ['task-checked', 'task-unchecked', 'ordered-task-item'].map(styleOf),
      taskNested: styleOf('task-nested'),
      taskNestedItem: styleOf('task-nested-item'),
      checkedStates: [
        document.getElementById('task-checked-input').checked,
        document.getElementById('task-unchecked-input').checked,
        document.getElementById('ordered-task-input').checked
      ],
      customMarkerColor: customMarkerRule?.style.color ?? null
    };
    dom.window.close();
    return result;
  };

  const baseline = createListCase();
  assert.deepEqual(baseline.ulLevels, ['disc', 'circle', 'square', 'square', 'square', 'square']);
  assert.equal(baseline.mixed, 'circle');
  assert.equal(baseline.thirdNested, 'square');
  assert.deepEqual(baseline.taskItems, ['none', 'none', 'none']);
  assert.equal(baseline.taskNested, 'circle');
  assert.equal(baseline.taskNestedItem, 'circle');
  assert.deepEqual(baseline.checkedStates, [true, false, true]);

  const bloomInk = createListCase({
    theme: 'bloom-ink',
    themeCss: articleThemeCss('bloom-ink')
  });
  assert.equal(bloomInk.ulLevels[0], 'disc');
  assert.equal(bloomInk.ulLevels[1], 'circle');
  assert.equal(bloomInk.mixed, 'circle');
  assert.deepEqual(bloomInk.taskItems, ['none', 'none', 'none']);

  const phycat = createListCase({
    theme: 'phycat-sky',
    themeCss: articleThemeCss('phycat-sky')
  });
  assert.deepEqual(phycat.ulLevels, ['disc', 'circle', 'square', 'square', 'square', 'square']);
  assert.deepEqual(phycat.olLevels, ['decimal', 'lower-alpha', 'lower-roman', 'lower-roman', 'lower-roman', 'lower-roman']);
  assert.deepEqual(phycat.taskItems, ['none', 'none', 'none']);
  assert.equal(phycat.taskNested, 'circle');
  assert.equal(phycat.taskNestedItem, 'circle');
  assert.deepEqual(phycat.checkedStates, [true, false, true]);

  const crimsonFocus = createListCase({
    theme: 'crimson-focus',
    themeCss: articleThemeCss('crimson-focus')
  });
  assert.equal(crimsonFocus.ulLevels[0], '"—  "');
  assert.deepEqual(crimsonFocus.taskItems, ['none', 'none', 'none']);

  const mdmdt = createListCase({
    theme: 'mdmdt',
    themeCss: articleThemeCss('mdmdt')
  });
  assert.equal(mdmdt.taskList, 'none');
  assert.deepEqual(mdmdt.taskItems, ['none', 'none', 'none']);

  const ningyePurple = createListCase({
    theme: 'ningye-purple',
    themeCss: articleThemeCss('ningye-purple')
  });
  assert.equal(ningyePurple.ulLevels[0], 'circle');
  assert.deepEqual(ningyePurple.taskItems, ['none', 'none', 'none']);
  assert.equal(ningyePurple.taskNested, 'circle');
  assert.equal(ningyePurple.taskNestedItem, 'circle');

  const minimalBlack = createListCase({
    theme: 'minimal-black',
    themeCss: articleThemeCss('minimal-black')
  });
  assert.equal(minimalBlack.ulLevels[0], 'square');
  assert.deepEqual(minimalBlack.taskItems, ['none', 'none', 'none']);
  assert.equal(minimalBlack.taskNested, 'square');
  assert.equal(minimalBlack.taskNestedItem, 'circle');

  const custom = createListCase({
    customTheme: true,
    customCss: `
      .easymde-rendered-content.easymde-custom-css-active ul {
        list-style-type: none;
      }

      .easymde-rendered-content.easymde-custom-css-active ul ul {
        list-style-type: square;
      }

      .easymde-rendered-content.easymde-custom-css-active ul li::marker {
        color: rgb(1, 2, 3);
      }
    `
  });
  assert.deepEqual(custom.ulLevels, ['none', 'square', 'square', 'square', 'square', 'square']);
  assert.deepEqual(custom.taskItems, ['none', 'none', 'none']);
  assert.equal(custom.taskNested, 'square');
  assert.equal(custom.taskNestedItem, 'square');
  assert.deepEqual(custom.checkedStates, [true, false, true]);
  assert.equal(custom.customMarkerColor, 'rgb(1, 2, 3)');
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

test('ordinary Preview uses one continuous white surface and fits wide table content', () => {
  const canvasRule = cssRule(
    css,
    '.easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas'
  );
  assertDeclaration(canvasRule, 'overflow-x', 'hidden');
  assertDeclaration(canvasRule, 'overflow-y', 'auto');
  assertDeclaration(canvasRule, 'padding', '0');
  assertDeclaration(canvasRule, 'background', '#fff');
  const articleRule = cssRule(
    css,
    '.easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(articleRule, 'width', '100%');
  assertDeclaration(articleRule, 'max-width', 'none');
  const articlePaperRule = cssRule(
    css,
    `.easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(articlePaperRule, 'margin', '0');
  assertDeclaration(articlePaperRule, 'padding', '22px 28px 28px');
  assertDeclaration(articlePaperRule, 'border-radius', '0');
  assertDeclaration(articlePaperRule, 'background-color', '#fff');
  assertDeclaration(articlePaperRule, 'box-shadow', 'none');
  assert.doesNotMatch(
    articleRule,
    /(?:^|[;\n])\s*(?:margin|padding|border-radius|background-color|box-shadow)\s*:/s,
    'the export-style marker must own the paper exclusion while shared geometry remains active'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-rendered-content table\s*\{[^}]*table-layout:/s
  );
});

test('Phycat cannot override the preview surface owner', () => {
  const selector =
    '.easymde-editor .easymde-preview.easymde-rendered-content[class*="easymde-markdown-theme-phycat-"]:not(.easymde-custom-css-active)';
  assert.doesNotMatch(css, new RegExp(`${escapeRegExp(selector)}\\s*\\{`, 's'));
});

test('shared Mermaid surfaces own their intrinsic SVG boundary', () => {
  const mermaidRuleMatch = frontendCss.match(
    /\.easymde-rendered-content \.easymde-mermaid,[\s\S]*?\.wp-block-post-content \.easymde-mermaid\s*\{(?<body>[^}]*)\}/
  );
  assert.ok(mermaidRuleMatch?.groups?.body, 'Missing shared Mermaid boundary rule');
  const mermaidRule = mermaidRuleMatch.groups.body;
  assert.match(mermaidRule, /box-sizing:\s*border-box;/);
  assert.match(mermaidRule, /display:\s*block;/);
  assert.match(mermaidRule, /min-width:\s*0;/);
  assert.match(mermaidRule, /max-width:\s*100%;/);
  assert.match(mermaidRule, /overflow-x:\s*auto;/);
  assert.match(mermaidRule, /overflow-y:\s*visible;/);
  const mermaidSvgRule = cssRule(frontendCss, '.easymde-mermaid svg');
  assert.match(mermaidSvgRule, /display:\s*block;/);
  assert.match(mermaidSvgRule, /margin-inline:\s*auto;/);
  assert.match(mermaidSvgRule, /max-width:\s*100%;/);
  assert.match(mermaidSvgRule, /height:\s*auto;/);
});

test('Mermaid labels use stable geometry independent of article typography', () => {
  const labelGeometryMatch = frontendCss.match(
    /\.easymde-mermaid \.node \.label,[\s\S]*?\.easymde-mermaid foreignObject > div \*\s*\{(?<body>[^}]*)\}/
  );
  assert.ok(labelGeometryMatch?.groups?.body, 'Missing Mermaid label geometry rule');
  const labelGeometry = labelGeometryMatch.groups.body;
  assert.match(labelGeometry, /box-sizing:\s*border-box\s*!important;/);
  assert.match(labelGeometry, /font-family:\s*"trebuchet ms", verdana, arial, sans-serif\s*!important;/);
  assert.match(labelGeometry, /font-size:\s*16px\s*!important;/);
  assert.match(labelGeometry, /font-weight:\s*400\s*!important;/);
  assert.match(labelGeometry, /line-height:\s*20px\s*!important;/);
  assert.match(labelGeometry, /white-space:\s*nowrap\s*!important;/);
  assert.match(labelGeometry, /margin:\s*0\s*!important;/);
  assert.match(labelGeometry, /padding:\s*0\s*!important;/);
  assert.doesNotMatch(labelGeometry, /(?:letter|word)-spacing:/);

  const mermaidSvgTypographyRule = cssRule(frontendCss, '.easymde-mermaid > svg');
  assert.match(mermaidSvgTypographyRule, /letter-spacing:\s*normal;/);
  assert.match(mermaidSvgTypographyRule, /word-spacing:\s*normal;/);

  const foreignObjectLabelRule = cssRule(
    frontendCss,
    '.easymde-mermaid foreignObject > div'
  );
  assert.match(foreignObjectLabelRule, /display:\s*table-cell\s*!important;/);
});

test('Mdmdt preview leaves programmatic outline scrolling immediate', () => {
  const mdmdtRule = cssRule(
    frontendCss,
    '.easymde-rendered-content.easymde-markdown-theme-mdmdt'
  );
  assert.match(mdmdtRule, /scroll-behavior:\s*auto\s*!important;/);
});

test('editor and render styles invalidate the base CSS cache when it changes', () => {
  const baseStyleEnqueues = Array.from(
    frontendAssetsPhp.matchAll(/wp_enqueue_style\([\s\S]*?\n\s*\);/g),
    ([call]) => call
  ).filter((call) => /Asset::url\(\s*'assets\/css\/frontend\/base\.css'/.test(call));

  assert.ok(baseStyleEnqueues.length > 0, 'base.css should be enqueued at least once');
  for (const call of baseStyleEnqueues) {
    assert.match(
      call,
      /\$this->get_static_asset_version\(\s*'assets\/css\/frontend\/base\.css'\s*\)/,
      'every base.css enqueue call must carry its own hash version'
    );
  }
  assert.match(
    frontendAssetsPhp,
    /private function get_static_asset_version\(\s*\$asset_path\s*\)[\s\S]*?hash_file\(\s*'sha256'\s*,\s*\$path\s*\)[\s\S]*?substr\(\s*\$hash\s*,\s*0\s*,\s*16\s*\)/
  );
});

test('preview surface ownership differs between continuous and pure Preview modes', () => {
  const canvasRule = cssRule(
    css,
    '.easymde-editor .easymde-pane-preview > .easymde-immersive-preview-canvas'
  );
  assertDeclaration(canvasRule, 'display', 'flex');
  assertDeclaration(canvasRule, 'min-width', '0');
  assertDeclaration(canvasRule, 'min-height', '0');
  assertDeclaration(canvasRule, 'align-items', 'flex-start');
  assertDeclaration(canvasRule, 'overflow-x', 'hidden');
  assertDeclaration(canvasRule, 'overflow-y', 'auto');

  const ordinaryCanvasRule = cssRule(
    css,
    '.easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas'
  );
  assertDeclaration(ordinaryCanvasRule, 'padding', '0');
  assertDeclaration(ordinaryCanvasRule, 'background', '#fff');
  const ordinaryArticleRule = cssRule(
    css,
    '.easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(ordinaryArticleRule, 'max-width', 'none');
  const ordinaryPaperRule = cssRule(
    css,
    `.easymde-editor:not(.is-immersive) .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(ordinaryPaperRule, 'margin', '0');
  assertDeclaration(ordinaryPaperRule, 'padding', '22px 28px 28px');
  assertDeclaration(ordinaryPaperRule, 'border-radius', '0');
  assertDeclaration(ordinaryPaperRule, 'background-color', '#fff');
  assertDeclaration(ordinaryPaperRule, 'box-shadow', 'none');

  const splitCanvasRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="split"] .easymde-pane-preview > .easymde-immersive-preview-canvas'
  );
  assertDeclaration(splitCanvasRule, 'padding', '0');
  assertDeclaration(splitCanvasRule, 'background', '#fff');
  const splitArticleRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="split"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(splitArticleRule, 'max-width', 'none');
  const splitPaperRule = cssRule(
    css,
    `.easymde-editor[data-easymde-preview-presentation="split"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(splitPaperRule, 'margin', '0');
  assertDeclaration(splitPaperRule, 'padding', '22px 28px 28px');
  assertDeclaration(splitPaperRule, 'border-radius', '0');
  assertDeclaration(splitPaperRule, 'background-color', '#fff');
  assertDeclaration(splitPaperRule, 'box-shadow', 'none');

  const purePreviewCanvasRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas'
  );
  assertDeclaration(purePreviewCanvasRule, 'padding', '28px 20px');
  assertDeclaration(purePreviewCanvasRule, 'background', '#f6f6f8');
  const purePreviewArticleRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(purePreviewArticleRule, 'max-width', '760px');
  const purePreviewPaperRule = cssRule(
    css,
    `.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(purePreviewPaperRule, 'margin', '0 auto');
  assertDeclaration(purePreviewPaperRule, 'border-radius', '48px');
  assertDeclaration(purePreviewPaperRule, 'background-color', '#fff');
  assertDeclaration(purePreviewPaperRule, 'box-shadow', '0 8px 28px rgba(15, 23, 42, .06)');
  assert.doesNotMatch(
    purePreviewPaperRule,
    /background-image\s*:/,
    'the pure Preview paper must not erase a selected theme background image'
  );
  assert.doesNotMatch(
    purePreviewPaperRule,
    /(?:^|[;\n])\s*(?:color|font-(?:family|size|weight))\s*:/,
    'the pure Preview paper must leave typography to the selected theme'
  );

  assert.doesNotMatch(
    css,
    /\.easymde-editor\[data-easymde-preview-presentation="split"\] \.easymde-immersive-preview-canvas > \.easymde-preview\s*\{[^}]*overflow-y:\s*auto;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor \.easymde-preview\.easymde-rendered-content\[class\*="easymde-markdown-theme-phycat-"\]/s
  );
  assert.match(
    css,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-rendered-content :is\(p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, a\)\s*\{[^}]*overflow-wrap:\s*anywhere;/s
  );
});

test('the shared Preview base has no legacy gray grid or wash', () => {
  const sharedPreviewRules = Array.from(
    css.matchAll(/^\.easymde-preview\s*\{(?<body>[^}]*)\}/gm),
    (match) => match.groups?.body ?? ''
  );
  assert.ok(sharedPreviewRules.length > 0, 'Missing standalone shared Preview rule');
  const sharedPreviewDeclarations = sharedPreviewRules.join('\n');
  assertDeclaration(sharedPreviewDeclarations, 'font-size', '16px');
  assertDeclaration(sharedPreviewDeclarations, 'line-height', '1.72');
  const sharedPreviewPaperRule = cssRuleAtLine(
    css,
    `.easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(sharedPreviewPaperRule, 'padding', '22px 28px 28px');
  assertDeclaration(sharedPreviewPaperRule, 'background-color', '#fff');
  assert.doesNotMatch(
    sharedPreviewDeclarations,
    /background(?:-image)?:\s*(?:linear-gradient|radial-gradient)/,
    'the shared article base must not paint the retired gray grid or wash'
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

test('ordinary heading menu uses content-sized viewport-bounded geometry without changing immersive styles', () => {
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
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-toolbar-popover\.is-ordinary-heading-menu\s*\{[^}]*position:\s*fixed;[^}]*inset-inline-end:\s*auto;[^}]*inset-inline-start:\s*auto;[^}]*width:\s*max-content;[^}]*min-width:\s*min\(208px, calc\(100vw - 24px\)\);[^}]*max-width:\s*calc\(100vw - 24px\);[^}]*padding:\s*7px;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-toolbar-popover\.is-ordinary-heading-menu::before\s*\{[^}]*content:\s*"";[^}]*position:\s*fixed;[^}]*top:\s*var\(--easymde-heading-arrow-viewport-top\);[^}]*right:\s*auto;[^}]*left:\s*var\(--easymde-heading-arrow-viewport-left\);[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*border-top:\s*1px solid #d0d7de;[^}]*border-left:\s*1px solid #d0d7de;[^}]*background:\s*#fff;[^}]*transform:\s*rotate\(45deg\);/s
  );
  const ordinaryHeadingArrowRule = popover.match(
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-toolbar-popover\.is-ordinary-heading-menu::before\s*\{([^}]*)\}/s
  )?.[1];
  assert.ok(ordinaryHeadingArrowRule);
  assert.doesNotMatch(ordinaryHeadingArrowRule, /inset-inline-(?:start|end):/);
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-popover-item\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*30px minmax\(max-content, 1fr\) max-content;[^}]*min-height:\s*32px;[^}]*padding:\s*0 9px;[^}]*border-radius:\s*8px;/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-popover-item-label\s*\{[^}]*min-width:\s*max-content;/s
  );
  assert.match(
    popover,
    /\.easymde-editor:not\(\.is-immersive\) \.easymde-toolbar-popover-headings \.easymde-popover-item-shortcut\s*\{[^}]*min-width:\s*max-content;[^}]*justify-self:\s*end;/s
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

test('context menu CSS keeps system/CJK typography, compact items, and clipped two-level pointer tails', () => {
  const menu = cssRule(css, '.easymde-editor-context-menu');
  const viewport = cssRule(css, '.easymde-editor-context-menu__viewport');
  const item = cssRule(css, '.easymde-editor-context-menu__button');
  const shortcut = cssRule(css, '.easymde-editor-context-menu__shortcut');
  const icon = cssRule(css, '.easymde-editor-context-menu__icon');
  const submenu = cssRule(css, '.easymde-editor-context-menu__submenu');
  const frame = cssRule(css, '.easymde-editor-context-menu__submenu-frame');
  const pointer = cssRule(css, '.easymde-editor-context-menu__pointer');
  const glass = cssRule(css, '.easymde-editor-context-menu::before');
  assertDeclaration(viewport, '--easymde-context-menu-background', '#fff');
  assertDeclaration(viewport, '--easymde-context-menu-border', '#dfe4ea');
  assertDeclaration(viewport, '--easymde-context-menu-focus', '#2271b1');
  assertDeclaration(viewport, '--easymde-context-menu-foreground', '#1d2327');
  assertDeclaration(viewport, '--easymde-context-menu-muted', '#646970');
  assert.match(
    css,
    /\.easymde-editor-context-menu__button:focus-visible:not\(:disabled\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--easymde-context-menu-focus\);/s
  );
  assert.match(
    css,
    /\.easymde-editor-context-menu__button\.is-hovered:not\(:disabled\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--easymde-context-menu-focus\);/s
  );
  assert.match(
    css,
    /\.easymde-editor-context-menu__layer\.is-pointer-hovering[\s\S]*?\.easymde-editor-context-menu__button:focus-visible:not\(\.is-hovered\):not\(:disabled\)\s*\{[^}]*box-shadow:\s*none;/s
  );
  assertDeclaration(menu, 'box-sizing', 'border-box');
  assertDeclaration(menu, 'border-radius', '8px');
  assertDeclaration(menu, 'border', '1px solid #dfe4ea');
  assertDeclaration(menu, 'max-inline-size', /min\(324px, calc\(100vw - 16px\)\)/);
  assertDeclaration(menu, 'min-inline-size', /min\(198px, calc\(100vw - 16px\)\)/);
  assertDeclaration(menu, 'max-block-size', 'calc(100vh - 16px)');
  assertDeclaration(menu, 'overflow-y', 'auto');
  assertDeclaration(menu, 'overscroll-behavior', 'contain');
  assertDeclaration(menu, 'font-family', /"EasyMDE Inter"[^;]*Noto Sans CJK SC[^;]*/);
  assertDeclaration(menu, 'backdrop-filter', /blur\(18px\) saturate\(150%\)/);
  assertDeclaration(glass, 'background', 'rgba(255, 255, 255, .92)');
  assert.doesNotMatch(glass, /backdrop-filter/);
  assertDeclaration(glass, 'border', '0');
  assertDeclaration(glass, 'box-shadow', /0 14px 32px rgba\(15, 23, 42, \.18\)[^;]*/);
  assertDeclaration(item, 'border-radius', '4px');
  assertDeclaration(item, 'font-size', '13px');
  assertDeclaration(item, 'font-weight', '400');
  assertDeclaration(item, 'gap', '14.4px');
  assertDeclaration(item, 'line-height', '1.35');
  assertDeclaration(item, 'letter-spacing', '0');
  assertDeclaration(item, 'padding', '6px 10px');
  assertDeclaration(item, 'white-space', 'normal');
  assertDeclaration(shortcut, 'font-size', '12px');
  assertDeclaration(shortcut, 'font-weight', '400');
  assertDeclaration(shortcut, 'unicode-bidi', 'isolate');
  assertDeclaration(shortcut, 'white-space', 'nowrap');
  assertDeclaration(icon, 'flex', '0 0 16px');
  assertDeclaration(icon, 'inline-size', '16px');
  assertDeclaration(icon, 'block-size', '16px');
  const label = cssRule(css, '.easymde-editor-context-menu__label');
  assertDeclaration(label, 'margin-inline-start', '-4.4px');
  assertDeclaration(submenu, 'border-radius', '8px');
  assertDeclaration(submenu, 'border', '1px solid transparent');
  assertDeclaration(submenu, 'box-sizing', 'border-box');
  assertDeclaration(submenu, 'font-family', /"EasyMDE Inter"[^;]*Noto Sans CJK SC[^;]*/);
  assertDeclaration(submenu, 'max-inline-size', /min\(324px, calc\(100vw - 16px\)\)/);
  assertDeclaration(submenu, 'min-inline-size', /min\(198px, calc\(100vw - 16px\)\)/);
  assertDeclaration(frame, 'backdrop-filter', /blur\(18px\) saturate\(150%\)/);
  assertDeclaration(submenu, '--easymde-context-menu-focus', '#2271b1');
  assertDeclaration(submenu, '--easymde-context-menu-foreground', '#1d2327');
  assertDeclaration(submenu, '--easymde-context-menu-muted', '#646970');
  assertDeclaration(submenu, 'color', 'var(--easymde-context-menu-foreground)');
  assert.match(
    css,
    /\.easymde-editor-context-menu__submenu \.easymde-editor-context-menu__button:focus-visible:not\(:disabled\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--easymde-context-menu-focus\);/s
  );
  assert.doesNotMatch(css, /\.easymde-editor-context-menu__submenu\[data-easymde-context-menu-placement="(?:right|left)"\][^{]*\{[^}]*border-inline-(?:start|end)-color:\s*transparent;/s);
  assertDeclaration(viewport, '--easymde-context-menu-pointer-size', '14px');
  assertDeclaration(pointer, 'height', 'var(--easymde-context-menu-pointer-size)');
  assertDeclaration(pointer, 'width', 'var(--easymde-context-menu-pointer-size)');
  assertDeclaration(pointer, 'transform', /translate\(-50%, -50%\) rotate\(45deg\)/);
  assertDeclaration(pointer, 'background', 'rgba(255, 255, 255, .92)');
  assertDeclaration(pointer, 'pointer-events', 'none');
  assertDeclaration(pointer, 'z-index', '3');
  assert.match(css, /\.easymde-editor-context-menu__pointer\[data-easymde-context-menu-pointer-placement="right"\]\s*\{[^}]*clip-path:\s*polygon\(0 0,\s*0 100%,\s*100% 100%\);[^}]*border-left:\s*1px solid #dfe4ea;[^}]*border-bottom:\s*1px solid #dfe4ea;[^}]*border-radius:\s*0 0 0 2px;/s);
  assert.match(css, /\.easymde-editor-context-menu__pointer\[data-easymde-context-menu-pointer-placement="left"\]\s*\{[^}]*clip-path:\s*polygon\(0 0,\s*100% 0,\s*100% 100%\);[^}]*border-top:\s*1px solid #dfe4ea;[^}]*border-right:\s*1px solid #dfe4ea;[^}]*border-radius:\s*0 2px 0 0;/s);
  assertDeclaration(viewport, 'z-index', '100250');
  assert.match(css, /\.easymde-editor-context-menu__viewport\s*\{[^}]*z-index:\s*100250;/s);
  assert.match(css, /\.easymde-media-picker-backdrop\s*\{[^}]*z-index:\s*100400;/s);
  assert.match(css, /prefers-reduced-transparency:\s*reduce/);
  assert.match(
    css,
    /\.easymde-editor-context-menu__button:disabled\s*\{[^}]*color:\s*#8c8f94;[^}]*opacity:\s*1;/s
  );
});

test('context submenu border joins the clipped tail without masking its glass or scrolling surface', () => {
  const frame = cssRule(css, '.easymde-editor-context-menu__submenu-frame');
  const outline = cssRule(css, '.easymde-editor-context-menu__submenu-frame::after');
  const submenu = cssRule(css, '.easymde-editor-context-menu__submenu');
  const flipped = cssRule(css, '.easymde-editor-context-menu__submenu-frame[data-easymde-context-menu-placement="left"]');
  assertDeclaration(frame, 'position', 'fixed');
  assertDeclaration(frame, 'background', 'rgba(255, 255, 255, .92)');
  assertDeclaration(frame, 'border-radius', '8px');
  assertDeclaration(frame, 'filter', 'drop-shadow(0 14px 32px rgba(15, 23, 42, .18))');
  assert.doesNotMatch(frame, /\bmask(?:-image)?:|overflow/);
  assertDeclaration(submenu, 'border', '1px solid transparent');
  assertDeclaration(submenu, 'overflow-y', 'auto');
  assertDeclaration(submenu, 'position', 'static');
  assertDeclaration(outline, 'position', 'absolute');
  assertDeclaration(outline, 'inset', '0');
  assertDeclaration(outline, 'border', '1px solid #dfe4ea');
  assertDeclaration(outline, 'border-radius', 'inherit');
  assertDeclaration(outline, 'pointer-events', 'none');
  assertDeclaration(outline, 'mask-composite', 'exclude');
  assertDeclaration(outline, 'mask-size', '100% 100%, 1px calc(var(--easymde-context-menu-pointer-size) * sqrt(2))');
  assertDeclaration(outline, 'mask-position', '0 0, var(--easymde-context-menu-join-side) calc(var(--easymde-context-menu-pointer-top) - var(--easymde-context-menu-pointer-size) / sqrt(2))');
  assertDeclaration(frame, '--easymde-context-menu-join-side', '0%');
  assertDeclaration(flipped, '--easymde-context-menu-join-side', '100%');
});

test('context menu CSS styles overlapped submenus without phone-only breakpoints or forced-colors specificity regressions', () => {
  const overlappedFrameSelector =
    '.easymde-editor-context-menu__submenu-frame:where([data-easymde-context-menu-overlapped="true"])';
  const overlappedFrame = cssRule(css, overlappedFrameSelector);
  assertDeclaration(
    overlappedFrame,
    'filter',
    'drop-shadow(0 18px 36px rgba(15, 23, 42, .26))'
  );
  const overlappedOutline = cssRule(
    css,
    `${overlappedFrameSelector}::after`
  );
  assertDeclaration(overlappedOutline, 'mask-image', 'none');

  const section7Start = css.lastIndexOf('7. Unified Editor Context Menu');
  const section8Start = css.lastIndexOf('8. Immersive Font Selector Controls');
  assert.ok(section7Start > -1 && section8Start > section7Start, 'Missing Section 7/8 CSS markers');
  const section7Css = css.slice(section7Start, section8Start);

  const overlappedRuleIndex = section7Css.indexOf(overlappedFrameSelector);
  const forcedColorsIndex = section7Css.indexOf('@media (forced-colors: active)');
  assert.ok(
    overlappedRuleIndex > -1 && forcedColorsIndex > overlappedRuleIndex,
    'forced-colors media override must appear after the (0,1,0) overlapped submenu rule so filter: none wins'
  );
  const forcedColorsBlock = cssBlock(section7Css, '@media (forced-colors: active)');
  assertDeclaration(
    cssRule(
      forcedColorsBlock,
      '.easymde-editor-context-menu,\n    .easymde-editor-context-menu__submenu-frame'
    ),
    'filter',
    'none'
  );
  assert.doesNotMatch(
    section7Css,
    /\.easymde-editor-context-menu__submenu-frame\[data-easymde-context-menu-overlapped="true"\]/,
    'overlapped submenu frame must use :where(...) to stay at (0,1,0) specificity'
  );

  assert.doesNotMatch(
    section7Css,
    /@media \(max-width:\s*640px\)/,
    'Section 7 must not retain the obsolete phone-only 640px context-menu breakpoint'
  );
  assert.doesNotMatch(
    section7Css,
    /@media \(max-width:\s*480px\)/,
    'Section 7 must not retain the obsolete phone-only 480px context-menu breakpoint'
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

test('all preview modes use one canvas without an additional paper wrapper', () => {
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-preview-page\b/s,
    'immersive preview uses a canvas wrapper without a page wrapper'
  );
});

test('all preview table surfaces use one shared horizontal scroll owner', () => {
  const wrapperRule = cssRule(
    frontendCss,
    '.easymde-rendered-content :is(.table-container.easymde-table-container)'
  );
  assertDeclaration(wrapperRule, 'display', 'block');
  assertDeclaration(wrapperRule, 'box-sizing', 'border-box');
  assertDeclaration(wrapperRule, 'width', '100%');
  assertDeclaration(wrapperRule, 'min-width', '0');
  assertDeclaration(wrapperRule, 'max-width', '100%');
  assertDeclaration(wrapperRule, 'overflow-x', 'auto');
  assertDeclaration(wrapperRule, 'overflow-y', 'hidden');

  const tableRule = cssRule(frontendCss, '.easymde-rendered-content table');
  assertDeclaration(tableRule, 'width', '100%');
  const filledMinimumRule = cssRule(
    frontendCss,
    '.easymde-rendered-content :where(.table-container.easymde-table-container) > table'
  );
  assertDeclaration(filledMinimumRule, 'min-width', '100%');
  assert.doesNotMatch(filledMinimumRule, /!important/s, 'explicit table minimums must be able to override the fill baseline');
  const intrinsicTableRule = cssRule(
    frontendCss,
    '.easymde-rendered-content :is(.table-container.easymde-table-container) > table'
  );
  assertDeclaration(intrinsicTableRule, 'width', 'max-content');
  assertDeclaration(intrinsicTableRule, 'max-width', 'none');
  assert.doesNotMatch(
    frontendCss,
    /:is\(\.table-container\.easymde-table-container\)\s+table\s*\{/s,
    'the table owner must not rewrite nested tables such as KaTeX internals'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor[^{}]*\.easymde-rendered-content[^{}]*table\s*\{[^}]*table-layout\s*:/s,
    'editor containment must not force fixed table layout'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-editor[^{}]*\.easymde-rendered-content[^{}]*:is\(th, td\)\s*\{[^}]*overflow-wrap\s*:/s,
    'editor containment must not force theme-specific cell reflow'
  );
});

test('shared Phycat nested quotes stay portable and Custom CSS scoped', () => {
  const selector = '.easymde-rendered-content[class*="easymde-markdown-theme-phycat-"]:not(.easymde-custom-css-active) blockquote blockquote';
  const quoteRule = cssRule(frontendCss, selector);

  assertDeclaration(quoteRule, 'box-sizing', 'border-box');
  assertDeclaration(quoteRule, 'max-width', '100%');
  assertDeclaration(quoteRule, 'margin-inline', '0');
  assertDeclaration(quoteRule, '--easymde-portable-padding-left', '9%');
  assertDeclaration(quoteRule, '--easymde-portable-padding-right', '5%');
  assertDeclaration(quoteRule, 'padding-left', 'var(--easymde-portable-padding-left)');
  assertDeclaration(quoteRule, 'padding-right', 'var(--easymde-portable-padding-right)');
  assert.match(selector, /:not\(\.easymde-custom-css-active\)/);
  assert.doesNotMatch(
    css,
    /\.easymde-editor[^{}]*phycat-[^{}]*blockquote\s+blockquote[^{}]*\{[^}]*padding-inline:\s*12px;/s,
    'the removed WordPress admin quote geometry must not return'
  );
  assert.doesNotMatch(
    quoteRule,
    /padding-inline:\s*12px/,
    'the portable base quote owner must not reintroduce the old fixed runtime padding'
  );
});

test('shared frontend settings own table alignment and code line-number geometry', () => {
  const cells = cssRule(frontendCss, '.easymde-rendered-content th,\n.easymde-rendered-content td');
  const left = cssRule(
    frontendCss,
    '.easymde-rendered-content.easymde-table-align-left :is(th, td)'
  );
  const center = cssRule(
    frontendCss,
    '.easymde-rendered-content.easymde-table-align-center :is(th, td)'
  );
  const gutter = cssRule(
    codeFrameCss,
    '.easymde-rendered-content.easymde-code-mac pre > .easymde-code-line-number-gutter'
  );

  assert.doesNotMatch(cells, /text-align\s*:/, 'auto mode must preserve GFM cell alignment');
  assertDeclaration(left, 'text-align', 'left !important');
  assertDeclaration(center, 'text-align', 'center !important');
  assertDeclaration(gutter, 'color', 'var(--easymde-code-line-number-color, #94a3b8)');
  assertDeclaration(gutter, 'opacity', '0.72');
  assertDeclaration(gutter, 'pointer-events', 'none');
  assertDeclaration(gutter, 'user-select', 'none');
  assert.doesNotMatch(codeFrameCss, /easymde-code-theme-/);
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

test('pure Preview preserves its paper width while Preview becomes editable', () => {
  const previewContentRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(previewContentRule, 'box-sizing', 'border-box');
  assertDeclaration(previewContentRule, 'max-width', '760px');
  assertDeclaration(previewContentRule, 'min-height', '680px');
  assertDeclaration(previewContentRule, 'overflow', 'visible');
  const previewPaperRule = cssRule(
    css,
    `.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
  );
  assertDeclaration(previewPaperRule, 'margin', '0 auto');
  assertDeclaration(previewPaperRule, 'padding', '36px 40px');
  assertDeclaration(previewPaperRule, 'border-radius', '48px');
  const desktopImmersivePreview = cssBlock(css, '@media (min-width: 640px)');
  assertDeclaration(
    cssRule(
      desktopImmersivePreview,
      `.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
    ),
    'padding',
    '45px 52.5px'
  );
  const mobileImmersivePreview = cssBlock(
    css,
    '@media (max-width: 760px)',
    css.lastIndexOf('@media (max-width: 760px)')
  );
  const mobilePreviewGeometryRule = cssRule(
    mobileImmersivePreview,
    '.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(mobilePreviewGeometryRule, 'min-height', '520px');
  assertDeclaration(
    cssRule(
      mobileImmersivePreview,
      `.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview${wechatExportPaperSelector}`
    ),
    'padding',
    '28px 24px'
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
});

test('immersive pure Preview inherits the shared canvas scroll owner', () => {
  const previewSurfaceRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-surface'
  );
  assertDeclaration(previewSurfaceRule, 'overflow', 'hidden');

  const previewHeaderRule = cssRule(
    css,
    '.easymde-editor.is-immersive-preview .easymde-immersive-preview-surface > .easymde-pane-header'
  );
  assertDeclaration(previewHeaderRule, 'position', 'sticky');

  const previewContentRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas > .easymde-preview'
  );
  assertDeclaration(previewContentRule, 'display', 'block');
  assertDeclaration(previewContentRule, 'flex', '0 0 auto');
  assert.match(previewContentRule, /height:\s*auto\s*!important;/s);
  assertDeclaration(previewContentRule, 'max-width', '760px');
  assertDeclaration(previewContentRule, 'overflow', 'visible');

  const previewCanvasRule = cssRule(
    css,
    '.easymde-editor[data-easymde-preview-presentation="preview"] .easymde-pane-preview > .easymde-immersive-preview-canvas'
  );
  assertDeclaration(previewCanvasRule, 'overflow-y', 'auto');
  assert.doesNotMatch(
    previewCanvasRule,
    /border-radius:\s*(?!0(?:px)?;)/,
    'the existing canvas must not become a second rounded paper surface'
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
  assert.doesNotMatch(
    css,
    /\.easymde-editor\.is-immersive-split \.easymde-preview\s*\{[^}]*padding:\s*34px 48px 60px;[^}]*background:\s*#fff;/s
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

test('Preview and ProseMirror share a compact first-child top margin with zero unlock jump', () => {
  assert.match(
    css,
    /\.easymde-editor \.easymde-preview > :where\(:not\(pre\)\):first-child\s*\{[^}]*margin-top:\s*0;/s,
    'shared preview root should keep the first non-code block flush with paper padding in both locked and unlocked states'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-prosemirror-surface\.ProseMirror\s*>\s*:first-child\s*\{[^}]*margin-top\s*:/s,
    'ProseMirror surface must not define a ProseMirror-only first-child margin-top override'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-prosemirror-surface\.ProseMirror\s*>\s*:last-child\s*\{[^}]*margin-bottom\s*:/s,
    'ProseMirror surface must not zero out last-child margin-bottom (causes bottom height/scroll jump on unlock)'
  );
  assert.match(
    css,
    /\.easymde-editor \.easymde-prosemirror-surface :is\(td, th\) > p,\s*\.easymde-editor \.easymde-prosemirror-surface :is\(ul, ol\):not\(\[data-easymde-tight="false"\]\) > li > p,\s*\.easymde-editor \.easymde-prosemirror-surface ul:not\(\[data-easymde-tight="false"\]\) > li > \.easymde-task-item-content > p\s*\{[^}]*font-size:\s*inherit;[^}]*line-height:\s*inherit;[^}]*color:\s*inherit;/s,
    'ProseMirror synthetic wrapper paragraphs inside table cells and tight list items should inherit parent typography instead of WordPress admin common.css 13px p defaults'
  );
  assert.match(
    css,
    /\.easymde-prosemirror-surface :is\(td, th\) > p:first-child,\s*\.easymde-prosemirror-surface :is\(ul, ol\):not\(\[data-easymde-tight="false"\]\) > li > p:first-child\s*\{[^}]*margin-top:\s*0;/s,
    'ProseMirror table cells and tight list items should zero first paragraph top margin to match locked Preview bare-text rows'
  );
  assert.match(
    css,
    /\.easymde-prosemirror-surface :is\(td, th\) > p:last-child,\s*\.easymde-prosemirror-surface :is\(ul, ol\):not\(\[data-easymde-tight="false"\]\) > li > p:last-child\s*\{[^}]*margin-bottom:\s*0;/s,
    'ProseMirror table cells and tight list items should zero last paragraph bottom margin to match locked Preview bare-text rows'
  );
  assert.match(
    css,
    /\.easymde-prosemirror-surface ul:not\(\[data-easymde-tight="false"\]\) > li > \.easymde-task-item-content > p:first-child\s*\{[^}]*margin-top:\s*0;/s,
    'ProseMirror tight task items should zero first paragraph top margin'
  );
  assert.match(
    css,
    /\.easymde-prosemirror-surface ul:not\(\[data-easymde-tight="false"\]\) > li > \.easymde-task-item-content > p:last-child\s*\{[^}]*margin-bottom:\s*0;/s,
    'ProseMirror tight task items should zero last paragraph bottom margin'
  );
  // Loose lists render <li><p> in formal Preview with article-theme paragraph
  // styling, so no ProseMirror rule may reset unscoped list or task paragraphs.
  assert.doesNotMatch(
    css,
    /\.easymde-prosemirror-surface :is\([^)]*\bli\b[^)]*\) > p/,
    'ProseMirror paragraph reset must not match every list item, including loose lists'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-prosemirror-surface \.easymde-task-item-content > p/,
    'ProseMirror task paragraph reset must be scoped to tight task lists'
  );
  assert.doesNotMatch(
    css,
    /\.easymde-prosemirror-surface :is\(ul, ol\) > li > p/,
    'ProseMirror list paragraph reset must exclude loose lists marked data-easymde-tight="false"'
  );
});
