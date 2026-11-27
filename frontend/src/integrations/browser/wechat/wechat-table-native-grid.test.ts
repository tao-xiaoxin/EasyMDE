import { describe, expect, it, vi } from 'vitest';

import { declaration } from './wechat-clipboard-test-fixtures';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  collectWechatTableNativeGridEvidence,
  planWechatTableNativeGridApply,
  readWechatTableNativeGridInput
} from './wechat-table-native-grid';

type StyleValues = Readonly<Record<string, string>>;

const tableStyles: StyleValues = {
  display: 'block',
  'animation-name': 'none',
  width: '335px',
  'table-layout': 'auto',
  'border-collapse': 'collapse',
  'border-spacing': '2px',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'border-top-style': 'none',
  'border-right-style': 'none',
  'border-bottom-style': 'none',
  'border-left-style': 'none',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-radius': '0px',
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-bottom-right-radius': '0px',
  'border-bottom-left-radius': '0px',
  'box-shadow': 'none',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px'
};

const groupStyles: StyleValues = {
  display: 'contents',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'border-top-style': 'none',
  'border-right-style': 'none',
  'border-bottom-style': 'none',
  'border-left-style': 'none',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-radius': '0px',
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-bottom-right-radius': '0px',
  'border-bottom-left-radius': '0px',
  'box-shadow': 'none',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px'
};

const pseudoStyles: StyleValues = {
  content: '""',
  'animation-name': 'none',
  display: 'table-caption',
  width: '335px',
  height: '0px',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'border-top-style': 'none',
  'border-right-style': 'none',
  'border-bottom-style': 'none',
  'border-left-style': 'none',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-radius': '0px',
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-bottom-right-radius': '0px',
  'border-bottom-left-radius': '0px',
  'box-shadow': 'none',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px'
};

function style(values: StyleValues): CSSStyleDeclaration {
  return declaration(values);
}

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect;
}

function cssRule(css: string, selector = '.theme table::before'): CSSRule {
  const styleElement = document.createElement('style');
  styleElement.textContent = `${selector}{${css}}`;
  document.head.append(styleElement);
  const rule = styleElement.sheet?.cssRules.item(0);
  if (!rule) throw new Error('CSS test rule missing');
  return rule;
}

function cssSheet(cssText: string, media = ''): CSSStyleSheet {
  const styleElement = document.createElement('style');
  if (media) styleElement.setAttribute('media', media);
  styleElement.textContent = cssText;
  document.head.append(styleElement);
  if (!styleElement.sheet) throw new Error('CSS test sheet missing');
  return styleElement.sheet;
}

function tableFixture(): HTMLTableElement {
  document.body.innerHTML =
    '<div class="theme"><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table></div>';
  const table = document.querySelector('table');
  if (!table) throw new Error('table fixture missing');
  const tableRect = rect(335, 133);
  Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => tableRect });
  Object.defineProperty(table.parentElement, 'getBoundingClientRect', { configurable: true, value: () => tableRect });
  table.querySelectorAll('tr').forEach((row) => {
    let right = 0;
    Array.from(row.children).forEach((cell) => {
      right += 111.6666666667;
      Object.defineProperty(cell, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          const width = 111.6666666667;
          return { ...rect(width, 33), left: right - width, right };
        }
      });
    });
  });
  return table;
}

function runtimeFor(
  table: HTMLTableElement,
  {
    rules = [cssRule('width:100cqi;')],
    styleSheets,
    pseudo = {},
    tableStyle = {},
    group = {},
    row = {},
    cell = {}
  }: Readonly<{
    rules?: readonly CSSRule[];
    styleSheets?: readonly unknown[];
    pseudo?: StyleValues;
    tableStyle?: StyleValues;
    group?: StyleValues;
    row?: StyleValues;
    cell?: StyleValues;
  }> = {}
): BrowserWechatClipboardRuntime {
  const cells = Array.from(table.querySelectorAll('th, td'));
  const documentStub = {
    defaultView: {
      CSSMediaRule: window.CSSMediaRule,
      CSSRule: window.CSSRule,
      CSSStyleRule: window.CSSStyleRule,
      CSSSupportsRule: window.CSSSupportsRule,
      matchMedia: vi.fn((query: string) => ({ matches: !query.includes('print') && !query.includes('max-width: 1px') })),
      CSS: {
        supports: vi.fn(() => true)
      }
    },
    styleSheets: styleSheets ?? [{ cssRules: rules }]
  } as unknown as Document;
  return {
    blob: Blob,
    clipboardItem: null,
    document: documentStub,
    getComputedStyle: (element, pseudoElement) => {
      if (pseudoElement) return style({ ...pseudoStyles, ...pseudo });
      if (element === table) return style({ ...tableStyles, ...tableStyle });
      if (element.parentElement === table) return style({ ...groupStyles, ...group });
      if (element.tagName === 'TR') return style({ display: 'table-row', ...row });
      if (cells.includes(element)) return style({ display: 'table-cell', ...cell });
      return style({ display: 'block' });
    },
    getSelection: () => null,
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: vi.fn(),
    write: null
  };
}

function collect(table: HTMLTableElement, options: Parameters<typeof runtimeFor>[1] = {}) {
  return collectWechatTableNativeGridEvidence(
    table,
    style({ ...tableStyles, ...options?.tableStyle }),
    runtimeFor(table, options)
  );
}

describe('collectWechatTableNativeGridEvidence', () => {
  it('admits explicit 100cqi when its used width is 335px', () => {
    const evidence = collect(tableFixture());
    expect(evidence).toMatchObject({
      tableWidth: 335,
      tableHeight: 133,
      usedPseudoWidth: 335,
      pseudoBefore: { content: 'empty', width: '100cqi' }
    });
    expect(evidence).not.toBeNull();
    if (!evidence) throw new Error('native grid evidence missing');
    expect(planWechatTableNativeGridApply(evidence)).toEqual({
      declarations: ['display', 'table'],
      signature: evidence.signature,
      sourceKey: evidence.sourceKey
    });
  });

  it('skips a real font-face rule while proving the matching table width', () => {
    const table = tableFixture();
    const sheet = cssSheet(
      '@font-face{font-family:KaTeX_Main;src:url("KaTeX_Main-Regular.woff2") format("woff2")}.theme table::before{width:100cqi}'
    );
    expect(collect(table, { styleSheets: [sheet] })).not.toBeNull();
  });

  it('rejects real nested CSSStyleRule content before a parent style-rule skip', () => {
    const table = tableFixture();
    const parent = cssSheet('.theme{}').cssRules.item(0);
    const nested = cssRule('width:335px;');
    if (!parent) throw new Error('nested parent rule missing');
    Object.defineProperty(parent, 'cssRules', {
      configurable: true,
      value: {
        [Symbol.iterator]: function* () {
          yield nested;
        },
        item: (index: number) => (0 === index ? nested : null),
        length: 1
      }
    });
    expect(() => collect(table, { styleSheets: [{ cssRules: [parent, cssRule('width:100cqi;')] }] })).toThrow(
      'wechat-table-native-grid-nested-rule-unreadable'
    );
  });

  it('does not accept disabled or print-only sheets as sole width proof', () => {
    const table = tableFixture();
    const disabled = cssSheet('.theme table::before{width:100cqi}');
    disabled.disabled = true;
    expect(() => collect(table, { styleSheets: [disabled] })).toThrow(
      'wechat-table-native-grid-width-rule-inactive'
    );

    const printOnly = cssSheet('.theme table::before{width:100cqi}', 'print');
    expect(() => collect(table, { styleSheets: [printOnly] })).toThrow(
      'wechat-table-native-grid-width-rule-inactive'
    );
  });

  it('changes the current input key for 100cqi to fixed 335px without width admission', () => {
    const table = tableFixture();
    const dynamic = readWechatTableNativeGridInput(
      table,
      style(tableStyles),
      runtimeFor(table, { rules: [cssRule('width:100cqi;')] })
    );
    const fixed = readWechatTableNativeGridInput(
      table,
      style(tableStyles),
      runtimeFor(table, { rules: [cssRule('width:335px;')] })
    );
    expect(dynamic.state).toBe('target');
    expect(fixed.state).toBe('target');
    expect(dynamic.key).toBeTypeOf('string');
    expect(fixed.key).toBeTypeOf('string');
    expect(dynamic.key).not.toBe(fixed.key);
    expect(fixed.snapshot?.authorWidths.potentialValues).toEqual(['335px']);
    expect(() => collect(table, { rules: [cssRule('width:335px;')] })).toThrow(
      'wechat-table-native-grid-width-rule-unsupported'
    );
  });

  it('represents unknown and unreadable CSS input instead of returning empty success', () => {
    const table = tableFixture();
    const unknownRule = { cssRules: [cssRule('width:100cqi;')], type: 99 } as unknown as CSSRule;
    const unknown = readWechatTableNativeGridInput(
      table,
      style(tableStyles),
      runtimeFor(table, { rules: [unknownRule] })
    );
    expect(unknown).toMatchObject({
      state: 'unreadable',
      key: null,
      issues: ['rule-unreadable']
    });

    const unreadable = readWechatTableNativeGridInput(
      table,
      style(tableStyles),
      runtimeFor(table, {
        styleSheets: [
          {
            get cssRules(): CSSRuleList {
              throw new DOMException('opaque', 'SecurityError');
            }
          }
        ]
      })
    );
    expect(unreadable).toMatchObject({
      state: 'unreadable',
      key: null,
      issues: ['stylesheet-unreadable']
    });
    expect(() => collect(table, { rules: [unknownRule] })).toThrow(
      'wechat-table-native-grid-rule-unreadable'
    );
  });

  it('ignores non-selector @view-transition rules injected by WordPress core', () => {
    const table = tableFixture();
    class FakeViewTransitionRule {
      readonly type = 0;
      readonly cssText = '@view-transition { navigation: auto; }';
      get [Symbol.toStringTag](): string {
        return 'CSSViewTransitionRule';
      }
    }
    const viewTransitionRule = new FakeViewTransitionRule() as unknown as CSSRule;
    const input = readWechatTableNativeGridInput(
      table,
      style(tableStyles),
      runtimeFor(table, { rules: [viewTransitionRule, cssRule('width:100cqi;')] })
    );
    expect(input.state).toBe('target');
    expect(input.issues).toEqual([]);
    expect(collect(table, { rules: [viewTransitionRule, cssRule('width:100cqi;')] })).not.toBeNull();
  });

  it('handles @layer statements, @layer block rules, and unrelated WP 7.1+ nested rules while failing closed on nested ::before width rules', () => {
    const table = tableFixture();
    class FakeLayerStatementRule {
      readonly type = 0;
      readonly cssText = '@layer utilities, components, compositions, overrides;';
      get [Symbol.toStringTag](): string {
        return 'CSSLayerStatementRule';
      }
    }
    class FakeLayerBlockRule {
      readonly type = 0;
      readonly cssRules: CSSRule[];
      constructor(rules: CSSRule[]) {
        this.cssRules = rules;
      }
      get [Symbol.toStringTag](): string {
        return 'CSSLayerBlockRule';
      }
    }
    class FakeNestedDeclarations {
      readonly type = 0;
      readonly style: CSSStyleDeclaration;
      constructor(values: StyleValues) {
        this.style = style(values);
      }
      get [Symbol.toStringTag](): string {
        return 'CSSNestedDeclarations';
      }
    }

    // 1. Unrelated nested rules (e.g. WP UI box-sizing ::before without width, trigger width without ::before,
    //    and CSSNestedDeclarations on non-::before parent) are safely skipped alongside @layer statements/blocks.
    const boxSizingParent = cssSheet('._wp_box_sizing{}').cssRules.item(0) as CSSStyleRule;
    const boxSizingNested = cssRule('box-sizing:inherit;', '& *, & ::after, & ::before');
    Object.defineProperty(boxSizingParent, 'cssRules', { configurable: true, value: [boxSizingNested] });

    const triggerParent = cssSheet('._wp_trigger{}').cssRules.item(0) as CSSStyleRule;
    const triggerNested = cssRule('width:fit-content;', '&.is-minimal');
    const triggerDecls = new FakeNestedDeclarations({ opacity: '1' }) as unknown as CSSRule;
    Object.defineProperty(triggerParent, 'cssRules', { configurable: true, value: [triggerNested, triggerDecls] });

    const layerStatement = new FakeLayerStatementRule() as unknown as CSSRule;
    const layerBlock = new FakeLayerBlockRule([boxSizingParent, triggerParent]) as unknown as CSSRule;
    expect(collect(table, { rules: [layerStatement, layerBlock, cssRule('width:100cqi;')] })).not.toBeNull();

    // 2. A matching width rule inside @layer is still walked and evaluated (not silently skipped).
    const layeredCompeting = new FakeLayerBlockRule([cssRule('width:335px;')]) as unknown as CSSRule;
    expect(() => collect(table, { rules: [layeredCompeting, cssRule('width:100cqi;')] })).toThrow(
      'wechat-table-native-grid-width-rule-unsupported'
    );

    // 3. A nested CSSNestedDeclarations width rule under a ::before parent still fails closed.
    const pseudoParent = cssSheet('.theme table::before{}').cssRules.item(0) as CSSStyleRule;
    const nestedWidthDecls = new FakeNestedDeclarations({ width: '335px' }) as unknown as CSSRule;
    Object.defineProperty(pseudoParent, 'cssRules', { configurable: true, value: [nestedWidthDecls] });
    expect(() => collect(table, { rules: [pseudoParent, cssRule('width:100cqi;')] })).toThrow(
      'wechat-table-native-grid-nested-rule-unreadable'
    );

    // 4. Escaped nested pseudo-elements fail closed while attribute strings and escaped classes stay benign.
    for (const escapedSelector of ['& ::\\62 efore', '& :\\62 efore']) {
      const escapedParent = cssSheet('table{}').cssRules.item(0) as CSSStyleRule;
      const escapedNested = cssRule('width:335px;', '.placeholder');
      Object.defineProperty(escapedNested, 'selectorText', { configurable: true, value: escapedSelector });
      Object.defineProperty(escapedParent, 'cssRules', { configurable: true, value: [escapedNested] });
      expect(() => collect(table, { rules: [escapedParent, cssRule('width:100cqi;')] })).toThrow(
        'wechat-table-native-grid-nested-rule-unreadable'
      );
    }

    const attrAndClassParent = cssSheet('table{}').cssRules.item(0) as CSSStyleRule;
    const attrMentioningBefore = cssRule('width:100px;', '& [data-x="::before"]');
    const escapedClassRule = cssRule('width:100px;', '.placeholder');
    Object.defineProperty(escapedClassRule, 'selectorText', { configurable: true, value: '& .foo\\:before' });
    Object.defineProperty(attrAndClassParent, 'cssRules', {
      configurable: true,
      value: [attrMentioningBefore, escapedClassRule]
    });
    expect(collect(table, { rules: [attrAndClassParent, cssRule('width:100cqi;')] })).not.toBeNull();
  });

  it('rejects fixed 335px even when the used width is identical', () => {
    const table = tableFixture();
    expect(() => collect(table, { rules: [cssRule('width:335px;')] })).toThrow(
      'wechat-table-native-grid-width-rule-unsupported'
    );
  });

  it('rejects competing width declarations and inactive matching media rules', () => {
    const table = tableFixture();
    expect(() =>
      collect(table, {
        rules: [cssRule('width:100cqi;'), cssRule('min-width:335px;')]
      })
    ).toThrow('wechat-table-native-grid-width-rule-unsupported');

    const mediaStyle = document.createElement('style');
    mediaStyle.textContent = '@media screen and (max-width: 1px){.theme table::before{width:100cqi;}}';
    document.head.append(mediaStyle);
    const inactiveMedia = mediaStyle.sheet?.cssRules.item(0);
    if (!inactiveMedia) throw new Error('inactive media rule missing');
    expect(() => collect(table, { rules: [inactiveMedia] })).toThrow(
      'wechat-table-native-grid-width-rule-inactive'
    );
  });

  it('rejects var(), calc(), and all author values explicitly', () => {
    const table = tableFixture();
    for (const value of ['var(--table-width)', 'calc(100cqi - 1px)', 'initial', 'unset', 'all:unset']) {
      const css = value.includes(':') ? value : `width:${value}`;
      expect(() => collect(table, { rules: [cssRule(`${css};`)] })).toThrow(
        'wechat-table-native-grid-width-rule-unsupported'
      );
    }
  });

  it('ignores unrelated media and keyframe containers while proving the matching width rule', () => {
    const table = tableFixture();
    const styleElement = document.createElement('style');
    styleElement.textContent = [
      '@keyframes native-grid-test { from { opacity: 0 } to { opacity: 1 } }',
      '@media print { .theme table::before { width:100cqi; } }',
      '.theme table::before { width:100cqi; }'
    ].join('\n');
    document.head.append(styleElement);
    const runtime = runtimeFor(table, { styleSheets: [{ cssRules: styleElement.sheet?.cssRules ?? [] }] });
    expect(collectWechatTableNativeGridEvidence(table, style(tableStyles), runtime)).not.toBeNull();
  });

  it('exposes a pure source key without rerunning admission in the planner', () => {
    const table = tableFixture();
    const evidence = collect(table);
    if (!evidence) throw new Error('native grid evidence missing');
    const before = table.outerHTML;
    expect(evidence.sourceKey).toBe(`table-native-grid:${evidence.signature}`);
    expect(planWechatTableNativeGridApply(evidence).sourceKey).toBe(evidence.sourceKey);
    expect(table.outerHTML).toBe(before);
  });

  it('fails explicitly for an unreadable stylesheet and an unknown nested rule', () => {
    const table = tableFixture();
    expect(() =>
      collect(table, {
        styleSheets: [
          {
            get cssRules(): CSSRuleList {
              throw new DOMException('opaque', 'SecurityError');
            }
          }
        ]
      })
    ).toThrow('wechat-table-native-grid-stylesheet-unreadable');

    const unknownRule = {
      cssRules: [cssRule('width:100cqi;')],
      type: 99
    } as unknown as CSSRule;
    expect(() => collect(table, { rules: [unknownRule] })).toThrow(
      'wechat-table-native-grid-rule-unreadable'
    );
  });

  it('rejects a table-caption shim that lost its empty pseudo content', () => {
    const table = tableFixture();
    expect(() => collect(table, { pseudo: { content: 'none' } })).toThrow(
      'wechat-table-native-grid-pseudo-recognition'
    );
  });

  it('leaves a non-target block table unchanged', () => {
    const table = tableFixture();
    const evidence = collect(table, {
      pseudo: { content: 'none', display: 'inline', width: '0px' },
      styleSheets: []
    });
    expect(evidence).toBeNull();
    expect(table.getAttribute('style')).toBeNull();
  });

  it('rejects matching pseudo width declarations that omit an explicit width', () => {
    const table = tableFixture();
    expect(() => collect(table, { rules: [cssRule('min-width:100cqi;')] })).toThrow(
      'wechat-table-native-grid-width-rule-missing'
    );
  });

  it('rejects duplicate stylesheet identities as unproved', () => {
    const table = tableFixture();
    const sheet = { cssRules: [cssRule('width:100cqi;')] };
    expect(() => collect(table, { styleSheets: [sheet, sheet] })).toThrow(
      'wechat-table-native-grid-stylesheet-repeat'
    );
  });

  it('rejects effective sizing animations on the table or caption', () => {
    const table = tableFixture();
    const animationSheet = cssSheet(
      '@keyframes table-size{from{width:100cqi}to{width:335px}}@keyframes caption-size{from{width:100cqi}to{width:335px}}'
    );
    expect(() => collect(table, { styleSheets: [animationSheet], tableStyle: { 'animation-name': 'table-size' } })).toThrow(
      'wechat-table-native-grid-table-animation'
    );
    expect(() => collect(table, { styleSheets: [animationSheet], pseudo: { 'animation-name': 'caption-size' } })).toThrow(
      'wechat-table-native-grid-pseudo-animation'
    );
  });

  it('includes admitted cell geometry in the evidence signature', () => {
    const table = tableFixture();
    const evidence = collect(table);
    if (!evidence) throw new Error('native grid evidence missing');
    expect(evidence.cells).toHaveLength(4);
    expect(evidence.cells[0]).toMatchObject({ width: 111.6666666667, height: 33 });
    expect(evidence.signature).toContain('111.6666666667,33');
  });

  it('rejects table, group, and pseudo paint instead of guessing a fallback', () => {
    const table = tableFixture();
    expect(() => collect(table, { tableStyle: { 'background-color': 'rgb(255, 0, 0)' } })).toThrow(
      'wechat-table-native-grid-table-paint'
    );
    expect(() => collect(table, { pseudo: { 'border-top-width': '1px' } })).toThrow(
      'wechat-table-native-grid-pseudo-paint'
    );
    expect(() => collect(table, { group: { 'background-color': 'rgb(255, 0, 0)' } })).toThrow(
      'wechat-table-native-grid-group-paint'
    );
    expect(() => collect(table, { group: { 'border-top-left-radius': '4px' } })).toThrow(
      'wechat-table-native-grid-group-paint'
    );
    expect(() => collect(table, { cell: { display: 'block' } })).toThrow(
      'wechat-table-native-grid-cell-display'
    );
  });

  it('rejects real captions and unsupported span or group structure', () => {
    const captionTable = tableFixture();
    captionTable.prepend(document.createElement('caption'));
    expect(() => collect(captionTable)).toThrow('wechat-table-native-grid-unsupported-table-structure');

    const spanning = tableFixture();
    spanning.rows[0]?.cells[0]?.setAttribute('colspan', '2');
    expect(() => collect(spanning)).toThrow('wechat-table-native-grid-cell-span');

    const invalidGroup = tableFixture();
    invalidGroup.querySelector('thead')?.append(document.createElement('div'));
    expect(() => collect(invalidGroup)).toThrow('wechat-table-native-grid-group-structure');
  });

  it('is repeat-idempotent and never mutates the source DOM', () => {
    const table = tableFixture();
    const before = table.outerHTML;
    const first = collect(table);
    const second = collect(table);
    expect(first?.signature).toBe(second?.signature);
    expect(table.outerHTML).toBe(before);
    expect(table.getAttribute('style')).toBeNull();
    expect(table.querySelector('caption')).toBeNull();
  });
});
