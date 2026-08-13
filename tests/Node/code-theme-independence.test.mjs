import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TYPORA_CODE_PALETTE_ROLES = [
  '--easymde-typora-code-bg',
  '--easymde-typora-code-text',
  '--easymde-typora-code-muted',
  '--easymde-typora-code-keyword',
  '--easymde-typora-code-string',
  '--easymde-typora-code-number',
  '--easymde-typora-code-blue',
  '--easymde-typora-code-link',
  '--easymde-typora-code-variable',
  '--easymde-typora-code-operator'
];
const TYPORA_CODE_ROLE_PROBES = [
  { className: 'hljs', property: 'background', role: '--easymde-typora-code-bg' },
  { className: 'hljs', property: 'color', role: '--easymde-typora-code-text' },
  { className: 'hljs-comment', property: 'color', role: '--easymde-typora-code-muted' },
  { className: 'hljs-quote', property: 'color', role: '--easymde-typora-code-muted' },
  { className: 'hljs-keyword', property: 'color', role: '--easymde-typora-code-keyword' },
  { className: 'hljs-selector-tag', property: 'color', role: '--easymde-typora-code-keyword' },
  { className: 'hljs-subst', property: 'color', role: '--easymde-typora-code-keyword' },
  { className: 'hljs-name', property: 'color', role: '--easymde-typora-code-keyword' },
  { className: 'hljs-tag', property: 'color', role: '--easymde-typora-code-keyword' },
  { className: 'hljs-string', property: 'color', role: '--easymde-typora-code-string' },
  { className: 'hljs-doctag', property: 'color', role: '--easymde-typora-code-string' },
  { className: 'hljs-number', property: 'color', role: '--easymde-typora-code-number' },
  { className: 'hljs-literal', property: 'color', role: '--easymde-typora-code-number' },
  { className: 'hljs-symbol', property: 'color', role: '--easymde-typora-code-number' },
  { className: 'hljs-title', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-section', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-type', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-built_in', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-attr', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-attribute', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-selector-class', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-selector-id', property: 'color', role: '--easymde-typora-code-blue' },
  { className: 'hljs-link', property: 'color', role: '--easymde-typora-code-link' },
  { className: 'hljs-variable', property: 'color', role: '--easymde-typora-code-variable' },
  { className: 'hljs-operator', property: 'color', role: '--easymde-typora-code-operator' },
  { className: 'hljs-emphasis', property: 'color', role: '--easymde-typora-code-text' },
  { className: 'hljs-strong', property: 'color', role: '--easymde-typora-code-text' }
];

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

function typoraCodePaletteBaseline() {
  return JSON.parse(source('tests/fixtures/typora-code-palettes.json'));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])])
    );
  }
  return value;
}

function cssColor(value) {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{6})$/);

  if (hex) {
    return {
      red: Number.parseInt(hex[1].slice(0, 2), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      alpha: 1
    };
  }

  const rgb = normalized.match(/^rgba?\((.+)\)$/);
  assert.ok(rgb, `unsupported CSS color: ${value}`);
  const [channels, slashAlpha] = rgb[1].split('/').map((part) => part.trim());
  const parts = channels.split(/[\s,]+/).filter(Boolean);
  const legacyAlpha = parts.length === 4 ? parts.pop() : undefined;
  const alphaValue = slashAlpha ?? legacyAlpha ?? '1';
  const alpha = alphaValue.endsWith('%')
    ? Number.parseFloat(alphaValue) / 100
    : Number.parseFloat(alphaValue);
  const [red, green, blue] = parts.map(Number);

  assert.ok([red, green, blue, alpha].every(Number.isFinite), `invalid CSS color: ${value}`);
  return { red, green, blue, alpha };
}

function compositeColor(foreground, background) {
  return {
    red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
    green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
    blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
    alpha: 1
  };
}

function colorLuminance(color) {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function cssContrast(foregroundValue, backgroundValue) {
  const background = cssColor(backgroundValue);
  const foreground = compositeColor(cssColor(foregroundValue), background);
  const lighter = Math.max(colorLuminance(foreground), colorLuminance(background));
  const darker = Math.min(colorLuminance(foreground), colorLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}

function normalizedComputedColor(windowRef, value) {
  const probe = windowRef.document.createElement('span');
  probe.style.color = value;
  assert.ok(probe.style.color, `browser rejected CSS color: ${value}`);
  windowRef.document.body.append(probe);
  const normalized = windowRef.getComputedStyle(probe).color;
  probe.remove();
  return normalized;
}

function resolvedComputedValue(computed, property) {
  let value = computed.getPropertyValue(property).trim();
  const visited = new Set();

  while (/^var\(\s*(--[\w-]+)\s*\)$/.test(value)) {
    const variable = value.match(/^var\(\s*(--[\w-]+)\s*\)$/)[1];
    assert.ok(!visited.has(variable), `cyclic computed custom property: ${variable}`);
    visited.add(variable);
    value = computed.getPropertyValue(variable).trim();
  }

  return value;
}

function assertTyporaCodeFinalColors(css, baseline, associations) {
  const codeIds = [...new Set(Object.values(associations))].sort();
  assert.deepEqual(
    Array.from(new Set(TYPORA_CODE_ROLE_PROBES.map(({ role }) => role))),
    baseline.roles,
    'computed palette probes must cover every canonical semantic role'
  );
  const tokenMarkup = TYPORA_CODE_ROLE_PROBES
    .filter(({ className }) => className !== 'hljs')
    .map(({ className }) => `<span class="${className}">token</span>`)
    .join('');
  const dom = new JSDOM(`<style>${css}</style><body></body>`);
  const { document } = dom.window;

  for (const codeId of codeIds) {
    const root = document.createElement('div');
    root.className = `easymde-rendered-content easymde-code-theme-${codeId}`;
    root.innerHTML = `<code class="hljs">plain${tokenMarkup}</code>`;
    document.body.append(root);

    const finalColors = TYPORA_CODE_ROLE_PROBES.map(({ className, property, role }) => {
      const element = root.querySelector(`.${className}`);
      const computed = dom.window.getComputedStyle(element);
      let value = resolvedComputedValue(computed, property);

      if (property === 'background') {
        const backgroundColor = computed.backgroundColor.trim();
        if (backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)') value = backgroundColor;
      }

      const normalized = normalizedComputedColor(dom.window, value);
      const roleIndex = baseline.roles.indexOf(role);
      assert.notEqual(roleIndex, -1, `${role} must be a canonical palette role`);
      const expected = normalizedComputedColor(dom.window, baseline.effectivePalettes[codeId][roleIndex]);
      assert.equal(normalized, expected, `${codeId} ${role} final color (${className})`);
      return { normalized, role };
    });

    const background = finalColors.find(({ role }) => role === '--easymde-typora-code-bg')?.normalized;
    assert.ok(background, `${codeId} background probe`);
    for (const { normalized, role } of finalColors) {
      if (role === '--easymde-typora-code-bg') continue;
      const contrast = cssContrast(normalized, background);
      assert.ok(
        contrast >= baseline.minimumContrast,
        `${codeId} ${role} final contrast ${contrast.toFixed(2)}`
      );
    }

    root.remove();
  }
}

function assertTyporaCodePaletteEvidence(baseline) {
  assert.equal(baseline.version, 2);
  assert.equal(baseline.minimumContrast, 4.5);
  assert.equal(
    createHash('sha256')
      .update(JSON.stringify(stableJsonValue({
        version: baseline.version,
        minimumContrast: baseline.minimumContrast,
        roles: baseline.roles,
        sources: baseline.sources,
        sourcePalettes: baseline.sourcePalettes,
        effectivePalettes: baseline.effectivePalettes
      })))
      .digest('hex'),
    '70d5d3748e4b1aa5dba8fdd415d19219bd6164cc48545027a5ddee898ab57877',
    'adapted effective palette evidence changed'
  );
  assert.deepEqual(
    baseline.roles,
    TYPORA_CODE_PALETTE_ROLES,
    'palette baseline must retain every canonical semantic role'
  );
}

function assertTyporaCodePaletteValues(css, baseline, associations) {
  const associatedCodeIds = [...new Set(Object.values(associations))].sort();
  const sourceIds = Object.keys(baseline.sources).sort();
  const sourcePaletteIds = Object.keys(baseline.sourcePalettes).sort();
  const effectivePaletteIds = Object.keys(baseline.effectivePalettes).sort();

  assert.deepEqual(sourceIds, associatedCodeIds, 'palette sources must cover the associated code themes');
  assert.deepEqual(sourcePaletteIds, associatedCodeIds, 'source palettes must cover the associated code themes');
  assert.deepEqual(effectivePaletteIds, associatedCodeIds, 'effective palettes must cover the associated code themes');

  for (const codeId of associatedCodeIds) {
    assert.match(
      baseline.sources[codeId],
      /^[^@\s]+@[0-9a-f]{40}\/\S+$/,
      `${codeId} needs a revision-pinned upstream source`
    );
    assert.equal(
      baseline.sourcePalettes[codeId].length,
      baseline.roles.length,
      `${codeId} needs one source value for every palette role`
    );
    assert.equal(
      baseline.effectivePalettes[codeId].length,
      baseline.roles.length,
      `${codeId} needs one value for every palette role`
    );
    assert.equal(
      baseline.effectivePalettes[codeId][0],
      baseline.sourcePalettes[codeId][0],
      `${codeId} must retain the source background`
    );

    const scopes = Array.from(
      css.matchAll(
        new RegExp(
          `\\.easymde-rendered-content\\.easymde-code-theme-${codeId}\\s*\\{([^}]*)\\}`,
          'g'
        )
      )
    );
    assert.equal(scopes.length, 1, `${codeId} needs exactly one CSS palette scope`);
    const declarations = new Map(
      cssDeclarations(scopes[0][1]).map(({ property, value }) => [property, value])
    );

    for (const [index, role] of baseline.roles.entries()) {
      assert.equal(declarations.get(role), baseline.effectivePalettes[codeId][index], `${codeId} ${role}`);
      if (index === 0) continue;

      const sourceContrast = cssContrast(
        baseline.sourcePalettes[codeId][index],
        baseline.sourcePalettes[codeId][0]
      );
      const effectiveContrast = cssContrast(
        baseline.effectivePalettes[codeId][index],
        baseline.effectivePalettes[codeId][0]
      );

      assert.ok(
        effectiveContrast >= baseline.minimumContrast,
        `${codeId} ${role} contrast ${effectiveContrast.toFixed(2)}`
      );
      if (sourceContrast >= baseline.minimumContrast) {
        assert.equal(
          baseline.effectivePalettes[codeId][index],
          baseline.sourcePalettes[codeId][index],
          `${codeId} ${role} must keep an already-readable source color`
        );
      }
    }
  }

  const uncommentedCss = stripCssComments(css);
  for (const role of baseline.roles) {
    const declarationCount = Array.from(
      uncommentedCss.matchAll(new RegExp(`${role}\\s*:`, 'g'))
    ).length;
    assert.equal(
      declarationCount,
      associatedCodeIds.length,
      `${role} must be declared exactly ${associatedCodeIds.length} times`
    );
  }
}

function assertTyporaCodePalettesMatch(css, baseline, associations) {
  assertTyporaCodePaletteEvidence(baseline);
  assertTyporaCodePaletteValues(css, baseline, associations);
  assertTyporaCodeFinalColors(css, baseline, associations);
}

function codeThemeMetadata() {
  return Array.from(
    source('src/Theme/CodeThemeRegistry.php').matchAll(
      /=>\s*\$this->theme\(\s*'([^']+)'\s*,\s*__\(\s*'((?:\\.|[^'])*)'\s*,\s*'easymde'\s*\)\s*,\s*'([^']+\.css)'/g
    ),
    ([, id, label, assetPath]) => ({
      id,
      label: label.replaceAll(/\\(['\\])/g, '$1'),
      assetPath
    })
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

function functionalPseudoClassBranches(selector, pseudoClass) {
  const normalized = normalizeSelector(selector);
  const marker = `:${pseudoClass}(`;
  if (!normalized.toLowerCase().startsWith(marker)) return null;

  let depth = 1;
  let quote = null;
  let escaped = false;
  let end = marker.length;

  for (; end < normalized.length && depth > 0; end += 1) {
    const character = normalized[end];

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
  return splitCssList(normalized.slice(marker.length, end - 1), ',');
}

function leadingOwnedCodeThemeIds(selector) {
  const rootPattern = /^\.easymde-rendered-content\.easymde-code-theme-([a-z0-9-]+)(?=$|[.#:[\]\s>+~])/;
  const normalized = normalizeSelector(selector);
  const branches = functionalPseudoClassBranches(normalized, 'is');

  if (branches) {
    return branches.map((branch) => normalizeSelector(branch).match(rootPattern)?.[1] ?? null);
  }

  return [normalized.match(rootPattern)?.[1] ?? null];
}

function assertOwnedCodeThemeAsset(css, themes) {
  const assetPath = themes[0]?.assetPath ?? 'unknown owned code-theme asset';
  const allowedIds = new Set(themes.map(({ id }) => id));
  const effectivePaletteIds = new Set();
  const paletteProperties = new Set(['background', 'background-color', 'color']);
  const rules = cssRules(css);

  assert.ok(rules.length > 0, `${assetPath} must contain parsed CSS rules`);
  for (const rule of rules) {
    const declarations = cssDeclarations(rule.body);
    const effectivePaletteRule = declarations.some(({ property }) => paletteProperties.has(property));

    for (const selector of rule.selectors) {
      const themeIds = leadingOwnedCodeThemeIds(selector);
      assert.ok(
        themeIds.length > 0 && themeIds.every(Boolean),
        `${assetPath} selector is not rooted in a served code theme: ${normalizeSelector(selector)}`
      );
      assert.ok(
        themeIds.every((id) => allowedIds.has(id)),
        `${assetPath} selector references an unserved code theme: ${normalizeSelector(selector)}`
      );
      if (effectivePaletteRule) {
        for (const themeId of themeIds) effectivePaletteIds.add(themeId);
      }
    }
  }

  assert.ok(effectivePaletteIds.size > 0, `${assetPath} must contain effective palette declarations`);
  for (const theme of themes) {
    assert.ok(
      effectivePaletteIds.has(theme.id),
      `${assetPath} must apply an effective palette declaration to ${theme.id}`
    );
  }
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

function unreachableTyporaClasses(selector) {
  const positiveSelector = withoutFunctionalPseudoClass(normalizeSelector(selector), 'not');
  const classes = Array.from(
    positiveSelector.matchAll(/\.((?:md)-[\w-]+)/gi),
    ([, className]) => className.toLowerCase()
  );

  return Array.from(new Set(classes));
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
    || /:not\(\s*pre\s*\)\s*>\s*code(?=$|[\s>+~:.[#])/i.test(normalizedSelector);
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
  const baseline = typoraCodePaletteBaseline();
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
    const signature = JSON.stringify(baseline.effectivePalettes[codeId]);
    assert.ok(!signatures.has(signature), `${codeId} should not duplicate another palette`);
    signatures.add(signature);
  }
});

test('every Typora-derived code palette preserves its source record and exposes readable effective colors', () => {
  assertTyporaCodePalettesMatch(
    source('assets/themes/code/typora-derived.css'),
    typoraCodePaletteBaseline(),
    typoraDerivedCodeAssociations()
  );
});

test('Typora-derived Highlight.js rules preserve Markdown emphasis and link semantics', () => {
  const context = {};
  runInNewContext(source('assets/vendor/highlight/highlight.min.js'), context);
  const highlighted = context.hljs.highlight(
    '**bold** *italic* [label](https://example.test)',
    { language: 'markdown' }
  ).value;
  const css = source('assets/themes/code/typora-derived.css');

  assert.match(highlighted, /class="hljs-strong"/);
  assert.match(highlighted, /class="hljs-emphasis"/);
  assert.match(highlighted, /class="hljs-link"/);
  assert.match(css, /\.hljs-strong\s*\{[^}]*font-weight:\s*700;/s);
  assert.match(css, /\.hljs-emphasis\s*\{[^}]*font-style:\s*italic;/s);
  assert.match(css, /\.hljs-link\s*\{[^}]*text-decoration:\s*underline;/s);

  const dom = new JSDOM(`
    <style>${css}</style>
    <div class="easymde-rendered-content easymde-code-theme-inkwell-code">
      <code class="hljs">${highlighted}</code>
    </div>
  `);
  const computed = (token) => dom.window.getComputedStyle(
    dom.window.document.querySelector(`.hljs-${token}`)
  );

  assert.equal(computed('strong').fontWeight, '700');
  assert.equal(computed('emphasis').fontStyle, 'italic');
  assert.match(computed('link').textDecoration, /underline/);
});

test('Typora-derived code palette gate rejects a changed color value', () => {
  const css = source('assets/themes/code/typora-derived.css');
  const changedCss = css.replace(
    '--easymde-typora-code-bg: #f6f8fb;',
    '--easymde-typora-code-bg: #000000;'
  );

  assert.notEqual(changedCss, css, 'the mutation must change the Inkwell background');
  assert.throws(
    () =>
      assertTyporaCodePalettesMatch(
        changedCss,
        typoraCodePaletteBaseline(),
        typoraDerivedCodeAssociations()
      ),
    /inkwell-code --easymde-typora-code-bg/
  );
});

test('Typora-derived code palette gate rejects a matching low-contrast runtime and fixture mutation', () => {
  const baseline = typoraCodePaletteBaseline();
  baseline.effectivePalettes['inkwell-code'][2] = '#ffffff';
  const css = source('assets/themes/code/typora-derived.css');
  const changedCss = css.replace(
    '--easymde-typora-code-muted: #697382;',
    '--easymde-typora-code-muted: #ffffff;'
  );

  assert.notEqual(changedCss, css, 'the mutation must change the Inkwell muted color');
  assert.throws(
    () => assertTyporaCodePaletteValues(changedCss, baseline, typoraDerivedCodeAssociations()),
    /inkwell-code --easymde-typora-code-muted contrast 1\.06/
  );
});

test('Typora-derived code palette gate rejects a matching high-contrast runtime and fixture drift', () => {
  const baseline = typoraCodePaletteBaseline();
  baseline.effectivePalettes['inkwell-code'][2] = '#000000';
  const css = source('assets/themes/code/typora-derived.css');
  const changedCss = css.replace(
    '--easymde-typora-code-muted: #697382;',
    '--easymde-typora-code-muted: #000000;'
  );

  assert.notEqual(changedCss, css, 'the mutation must change the Inkwell muted color');
  assert.throws(
    () => assertTyporaCodePalettesMatch(changedCss, baseline, typoraDerivedCodeAssociations()),
    /adapted effective palette evidence changed/
  );
});

test('Typora-derived code palette gate rejects a later duplicate scope override', () => {
  const changedCss = `${source('assets/themes/code/typora-derived.css')}
.easymde-rendered-content.easymde-code-theme-inkwell-code {
  --easymde-typora-code-bg: #000000;
}`;

  assert.throws(
    () =>
      assertTyporaCodePalettesMatch(
        changedCss,
        typoraCodePaletteBaseline(),
        typoraDerivedCodeAssociations()
      ),
    /inkwell-code needs exactly one CSS palette scope/
  );
});

test('Typora-derived code palette gate rejects a more-specific color override', () => {
  const changedCss = `${source('assets/themes/code/typora-derived.css')}
.easymde-rendered-content.easymde-code-theme-inkwell-code .hljs {
  --easymde-typora-code-bg: #000000;
}`;

  assert.throws(
    () =>
      assertTyporaCodePalettesMatch(
        changedCss,
        typoraCodePaletteBaseline(),
        typoraDerivedCodeAssociations()
      ),
    /--easymde-typora-code-bg must be declared exactly 18 times/
  );
});

test('Typora-derived code palette gate rejects a higher-specificity final token color', () => {
  const changedCss = `${source('assets/themes/code/typora-derived.css')}
.easymde-rendered-content.easymde-code-theme-inkwell-code .hljs .hljs-keyword {
  color: #ffffff;
}`;

  assert.throws(
    () =>
      assertTyporaCodePalettesMatch(
        changedCss,
        typoraCodePaletteBaseline(),
        typoraDerivedCodeAssociations()
      ),
    /inkwell-code --easymde-typora-code-keyword final color/
  );
});

test('Typora-derived code palette gate rejects a higher-specificity grouped token color', () => {
  const changedCss = `${source('assets/themes/code/typora-derived.css')}
.easymde-rendered-content.easymde-code-theme-inkwell-code .hljs .hljs-selector-tag {
  color: #ffffff;
}`;

  assert.throws(
    () =>
      assertTyporaCodePalettesMatch(
        changedCss,
        typoraCodePaletteBaseline(),
        typoraDerivedCodeAssociations()
      ),
    /inkwell-code --easymde-typora-code-keyword final color \(hljs-selector-tag\)/
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

test('every EasyMDE-owned code-theme selector is rooted in a theme served by its asset', () => {
  const themesByAsset = new Map();
  for (const theme of registeredThemes('src/Theme/CodeThemeRegistry.php')) {
    if (!theme.assetPath.startsWith('assets/themes/code/')) continue;
    themesByAsset.set(theme.assetPath, [...(themesByAsset.get(theme.assetPath) ?? []), theme]);
  }

  assert.ok(themesByAsset.size > 0);
  for (const [assetPath, themes] of themesByAsset) {
    assertOwnedCodeThemeAsset(source(assetPath), themes);
  }
});

test('owned code-theme selector gate ignores comment-only scope claims', () => {
  assert.throws(
    () => assertOwnedCodeThemeAsset(
      `/* .easymde-rendered-content.easymde-code-theme-example */
.hljs { color: #000000; }`,
      [{ id: 'example', assetPath: 'assets/themes/code/example.css' }]
    ),
    /selector is not rooted in a served code theme: \.hljs/
  );
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
    .theme h6 code {
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
    '.theme blockquote.md-alert-note',
    '.theme .md-alert-title-icon',
    '.theme .md-future-editor-wrapper',
    '.theme.on-focus-mode > .md-focus-element'
  ];
  const reachableSelectors = [
    '.theme a:not(.md-toc-inner):hover',
    '.theme :not(pre) > code:not(.md-fencescode)',
    '.theme .easymde-toc a',
    '.theme .task-list-item input',
    '.theme table > tbody',
    '.theme .footnote-ref'
  ];

  for (const selector of unreachableSelectors) {
    assert.notDeepEqual(unreachableTyporaClasses(selector), [], selector);
  }
  for (const selector of reachableSelectors) {
    assert.deepEqual(unreachableTyporaClasses(selector), [], selector);
  }
});

test('registered article themes contain no unreachable positive Typora md selectors', () => {
  const themes = registeredThemes('src/Theme/ArticleThemeRegistry.php');

  assert.ok(themes.length > 0, 'article themes should be discovered from the registry');
  for (const theme of themes) {
    const violations = cssSelectors(source(theme.assetPath)).flatMap((selector) => {
      const classes = unreachableTyporaClasses(selector);
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
