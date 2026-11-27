import { splitSelectorList } from '../../../shared/css/selector-list';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { supportsSpecialLayout } from './wechat-style-policy';

const SUPPORTED_PSEUDO_WIDTH = '100cqi';
const EMPTY_PSEUDO_CONTENT = new Set(['""', "''"]);
const NO_PSEUDO_CONTENT = new Set(['none', 'normal']);
const INPUT_KEY_PREFIX = 'table-native-grid:';
const WIDTH_PROPERTIES = [
  'width',
  'inline-size',
  'min-width',
  'min-inline-size',
  'max-width',
  'max-inline-size'
] as const;
const TABLE_PAINT_PROPERTIES = [
  'background-color',
  'background-image',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left'
] as const;
const GROUP_PAINT_PROPERTIES = [
  'background-color',
  'background-image',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left'
] as const;
const PSEUDO_PAINT_PROPERTIES = [
  ...TABLE_PAINT_PROPERTIES,
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left'
] as const;
const TABLE_INPUT_PROPERTIES = [
  'display',
  'width',
  'animation-name',
  'table-layout',
  'border-collapse',
  'border-spacing',
  ...TABLE_PAINT_PROPERTIES
] as const;
const PSEUDO_INPUT_PROPERTIES = [
  'content',
  'display',
  'width',
  'height',
  'animation-name',
  ...PSEUDO_PAINT_PROPERTIES
] as const;
const GROUP_INPUT_PROPERTIES = ['display', ...GROUP_PAINT_PROPERTIES] as const;
const ROW_INPUT_PROPERTIES = ['display'] as const;
const CELL_INPUT_PROPERTIES = ['display'] as const;
const FULL_WIDTH_TOLERANCE = 0.01;
const CONTENT_WIDTH_TOLERANCE = 0.000001;

type PseudoContentState = 'empty' | 'none' | 'unsupported';
type StyleSnapshot = Readonly<Record<string, string>>;

type CellInput = Readonly<{
  colspan: string | null;
  height: number;
  rowspan: string | null;
  styles: StyleSnapshot;
  tagName: string;
  width: number;
}>;

type RowInput = Readonly<{
  cells: readonly CellInput[];
  styles: StyleSnapshot;
  tagName: string;
}>;

type GroupInput = Readonly<{
  rows: readonly RowInput[];
  styles: StyleSnapshot;
  tagName: string;
}>;

type TableStructureInput = Readonly<{
  groups: readonly GroupInput[];
  hasCaptionOrColumns: boolean;
  hasNestedTable: boolean;
  nativeRowCount: number;
}>;

type AuthorWidthInput = Readonly<{
  activeValues: readonly string[];
  explicitActiveWidth: boolean;
  explicitPotentialWidth: boolean;
  potentialValues: readonly string[];
}>;

type InputSnapshot = Readonly<{
  authorWidths: AuthorWidthInput;
  parentWidth: number | null;
  pseudoStyles: StyleSnapshot;
  source: HTMLTableElement;
  specialLayout: boolean;
  structure: TableStructureInput;
  tableHeight: number;
  tableStyles: StyleSnapshot;
  tableWidth: number;
}>;

export type WechatTableNativeGridInput = Readonly<{
  issues: readonly string[];
  key: string | null;
  snapshot: InputSnapshot | null;
  state: 'non-target' | 'target' | 'unreadable';
}>;

export type WechatTableNativeGridEvidence = Readonly<{
  cells: readonly Readonly<{ height: number; width: number }>[];
  pseudoBefore: Readonly<{
    content: 'empty';
    width: '100cqi';
  }>;
  signature: string;
  source: HTMLTableElement;
  sourceKey: string;
  tableContentWidth: number;
  tableHeight: number;
  tableWidth: number;
  usedPseudoWidth: number;
}>;

export type WechatTableNativeGridPlan = Readonly<{
  declarations: readonly ['display', 'table'];
  signature: string;
  sourceKey: string;
}>;

type PseudoRuleWidths = {
  explicitWidth: boolean;
  values: string[];
};

function tableGridError(code: string): Error {
  return new Error(`wechat-table-native-grid-${code}`);
}

function normalizedValue(style: CSSStyleDeclaration, property: string): string {
  return style.getPropertyValue(property).trim().toLowerCase();
}

function readStyle(style: CSSStyleDeclaration, properties: readonly string[]): StyleSnapshot {
  return Object.freeze(
    Object.fromEntries(properties.map((property) => [property, normalizedValue(style, property)]))
  );
}

function styleValue(style: StyleSnapshot, property: string): string {
  return style[property] ?? '';
}

function styleSignature(style: StyleSnapshot, properties: readonly string[]): string {
  return properties.map((property) => `${property}=${styleValue(style, property)}`).join(',');
}

function isZero(value: string): boolean {
  return '0' === value || '0px' === value;
}

function isTransparentPaint(property: string, value: string): boolean {
  if ('background-image' === property) return 'none' === value;
  if ('background-color' === property) return ['rgba(0, 0, 0, 0)', 'rgba(0,0,0,0)', 'transparent'].includes(value);
  if (property.endsWith('-style')) return ['none', 'hidden'].includes(value);
  if (property.endsWith('-width') || property.endsWith('-radius')) return isZero(value);
  if ('box-shadow' === property) return 'none' === value;
  return isZero(value);
}

function paintIsTransparent(style: StyleSnapshot, properties: readonly string[]): boolean {
  return properties.every((property) => isTransparentPaint(property, styleValue(style, property)));
}

function pseudoContentState(style: StyleSnapshot): PseudoContentState {
  const content = styleValue(style, 'content');
  if (NO_PSEUDO_CONTENT.has(content)) return 'none';
  if (EMPTY_PSEUDO_CONTENT.has(content)) return 'empty';
  return 'unsupported';
}

function numericCssPixels(value: string): number | null {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameGeometry(left: number, right: number, tolerance: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function selectorTargetsPseudoBefore(selector: string): boolean {
  return /(?:::before|:before)\s*$/iu.test(selector);
}

function selectorWithoutPseudoBefore(selector: string): string {
  return selector.replace(/\s*(?:::before|:before)\s*$/iu, '').trim();
}

function matchingPseudoSelector(source: Element, selectorText: string): boolean {
  const selectors = splitSelectorList(selectorText);
  if (!selectors) throw tableGridError('selector-list-unreadable');
  let matched = false;
  for (const selector of selectors) {
    if (!selectorTargetsPseudoBefore(selector)) continue;
    const elementSelector = selectorWithoutPseudoBefore(selector);
    if (!elementSelector) throw tableGridError('selector-unreadable');
    try {
      if (source.matches(elementSelector)) matched = true;
    } catch {
      throw tableGridError('selector-unreadable');
    }
  }
  return matched;
}

function selectorHasPseudoBefore(selector: string): boolean {
  return /::?before(?![a-z0-9_-])/iu.test(selector);
}

function selectorListHasPseudoBefore(selectorText: string): boolean | null {
  const selectors = splitSelectorList(selectorText);
  if (!selectors) return null;
  return selectors.some(selectorHasPseudoBefore);
}

function styleDeclaresWidthOrAll(style: CSSStyleDeclaration): boolean {
  if (style.getPropertyValue('all').trim()) return true;
  for (const property of WIDTH_PROPERTIES) {
    if (style.getPropertyValue(property).trim()) return true;
  }
  return false;
}

function isRuleInstance(
  rule: CSSRule,
  defaultView: (Window & typeof globalThis) | null | undefined,
  constructorName: string,
  tagName: string
): boolean {
  const ctor =
    defaultView && constructorName in defaultView
      ? (defaultView as unknown as Record<string, unknown>)[constructorName]
      : undefined;
  return (
    ('function' === typeof ctor && rule instanceof (ctor as new () => CSSRule)) ||
    tagName === Object.prototype.toString.call(rule)
  );
}

function isSkippableNonSelectorRule(
  rule: CSSRule,
  defaultView: (Window & typeof globalThis) | null | undefined
): boolean {
  if (
    (defaultView?.CSSFontFaceRule && rule instanceof defaultView.CSSFontFaceRule) ||
    (defaultView?.CSSRule && defaultView.CSSRule.FONT_FACE_RULE === rule.type)
  ) {
    return true;
  }
  if (
    (defaultView?.CSSKeyframesRule && rule instanceof defaultView.CSSKeyframesRule) ||
    (defaultView?.CSSRule && defaultView.CSSRule.KEYFRAMES_RULE === rule.type)
  ) {
    return true;
  }
  if (isRuleInstance(rule, defaultView, 'CSSViewTransitionRule', '[object CSSViewTransitionRule]')) {
    return true;
  }
  return isRuleInstance(rule, defaultView, 'CSSLayerStatementRule', '[object CSSLayerStatementRule]');
}

function isGroupingRuleForNestedScan(
  rule: CSSRule,
  defaultView: (Window & typeof globalThis) | null | undefined
): rule is CSSGroupingRule {
  if (defaultView?.CSSMediaRule && rule instanceof defaultView.CSSMediaRule) return true;
  if (defaultView?.CSSSupportsRule && rule instanceof defaultView.CSSSupportsRule) return true;
  return isRuleInstance(rule, defaultView, 'CSSLayerBlockRule', '[object CSSLayerBlockRule]');
}

/**
 * Conservatively checks whether any rule nested inside a CSSStyleRule can
 * declare a width/inline-size/`all` rule on a `::before` pseudo-element.
 * Unrecognized rule types, unreadable selectors, or thrown CSSOM reads fail closed.
 */
function nestedSubtreeCouldAffectPseudoBeforeWidth(
  rules: CSSRuleList,
  ancestorHasPseudoBefore: boolean,
  defaultView: (Window & typeof globalThis) | null | undefined
): boolean {
  try {
    for (const rule of Array.from(rules)) {
      if (defaultView?.CSSStyleRule && rule instanceof defaultView.CSSStyleRule) {
        const styleRule = rule as CSSStyleRule;
        const selfHasPseudoBefore = selectorListHasPseudoBefore(styleRule.selectorText);
        if (null === selfHasPseudoBefore) return true;
        const hasPseudoBefore = ancestorHasPseudoBefore || selfHasPseudoBefore;
        if (hasPseudoBefore && styleDeclaresWidthOrAll(styleRule.style)) return true;
        const nested = nestedRuleContainer(styleRule);
        if (nested && nestedSubtreeCouldAffectPseudoBeforeWidth(nested, hasPseudoBefore, defaultView)) {
          return true;
        }
        continue;
      }

      if (isRuleInstance(rule, defaultView, 'CSSNestedDeclarations', '[object CSSNestedDeclarations]')) {
        const style = (rule as CSSRule & { style?: CSSStyleDeclaration }).style;
        if (!style || 'function' !== typeof style.getPropertyValue) return true;
        if (ancestorHasPseudoBefore && styleDeclaresWidthOrAll(style)) return true;
        continue;
      }

      if (isGroupingRuleForNestedScan(rule, defaultView)) {
        if (nestedSubtreeCouldAffectPseudoBeforeWidth(rule.cssRules, ancestorHasPseudoBefore, defaultView)) {
          return true;
        }
        continue;
      }

      if (isSkippableNonSelectorRule(rule, defaultView)) continue;

      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function nestedRuleContainer(rule: CSSRule): CSSRuleList | null {
  if ('object' === typeof rule && rule && 'cssRules' in rule) {
    const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
    if (nested && nested.length > 0) return nested;
  }
  return null;
}

function mediaIsActive(mediaList: MediaList | null, runtime: BrowserWechatClipboardRuntime): boolean {
  const media = mediaList?.mediaText?.trim() ?? '';
  if (!media) return true;
  const defaultView = runtime.document.defaultView;
  if (!defaultView?.matchMedia) throw tableGridError('stylesheet-unreadable');
  try {
    return defaultView.matchMedia(media).matches;
  } catch {
    throw tableGridError('stylesheet-unreadable');
  }
}

function sheetIsActive(sheet: CSSStyleSheet, runtime: BrowserWechatClipboardRuntime): boolean {
  return !sheet.disabled && mediaIsActive(sheet.media, runtime);
}

function activeMediaRule(rule: CSSMediaRule, runtime: BrowserWechatClipboardRuntime): boolean {
  if (!rule.media?.mediaText?.trim()) throw tableGridError('stylesheet-unreadable');
  return mediaIsActive(rule.media, runtime);
}

function activeSupportsRule(rule: CSSSupportsRule, runtime: BrowserWechatClipboardRuntime): boolean {
  const condition = rule.conditionText?.trim() ?? '';
  const defaultView = runtime.document.defaultView;
  if (!condition || !defaultView?.CSS?.supports) throw tableGridError('stylesheet-unreadable');
  try {
    return defaultView.CSS.supports(condition);
  } catch {
    throw tableGridError('stylesheet-unreadable');
  }
}

function styleRulePseudoWidths(source: Element, rule: CSSStyleRule): PseudoRuleWidths | null {
  if (!matchingPseudoSelector(source, rule.selectorText)) return null;
  const all = rule.style.getPropertyValue('all').trim().toLowerCase();
  const result: PseudoRuleWidths = { explicitWidth: false, values: [] };
  if (all) result.values.push(`all:${all}`);
  for (const property of WIDTH_PROPERTIES) {
    const value = rule.style.getPropertyValue(property).trim().toLowerCase();
    if (!value) continue;
    result.values.push(value);
    if ('width' === property || 'inline-size' === property) result.explicitWidth = true;
  }
  return result.values.length ? result : null;
}

/**
 * Reads every possibly participating author declaration without deciding which
 * declaration wins or whether its value is admissible. Unknown or unreadable
 * CSS remains an explicit failure to preserve fail-fast evidence.
 */
function readAuthorPseudoWidths(source: Element, runtime: BrowserWechatClipboardRuntime): AuthorWidthInput {
  const activeValues: string[] = [];
  const potentialValues: string[] = [];
  let explicitActiveWidth = false;
  let explicitPotentialWidth = false;
  const visitedSheets = new Set<CSSStyleSheet>();

  const record = (widthRule: PseudoRuleWidths, active: boolean): void => {
    potentialValues.push(...widthRule.values);
    explicitPotentialWidth ||= widthRule.explicitWidth;
    if (!active) return;
    activeValues.push(...widthRule.values);
    explicitActiveWidth ||= widthRule.explicitWidth;
  };

  const visitRules = (rules: CSSRuleList, active: boolean): void => {
    for (const rule of Array.from(rules)) {
      const defaultView = runtime.document.defaultView;
      if (defaultView?.CSSStyleRule && rule instanceof defaultView.CSSStyleRule) {
        const styleRule = rule as CSSStyleRule;
        const nested = nestedRuleContainer(styleRule);
        if (nested) {
          const parentHasPseudoBefore = selectorListHasPseudoBefore(styleRule.selectorText);
          if (
            null === parentHasPseudoBefore ||
            nestedSubtreeCouldAffectPseudoBeforeWidth(nested, parentHasPseudoBefore, defaultView)
          ) {
            throw tableGridError('nested-rule-unreadable');
          }
        }
        const widthRule = styleRulePseudoWidths(source, styleRule);
        if (widthRule) record(widthRule, active);
        continue;
      }

      if (defaultView?.CSSMediaRule && rule instanceof defaultView.CSSMediaRule) {
        visitRules(rule.cssRules, active && activeMediaRule(rule as CSSMediaRule, runtime));
        continue;
      }

      if (defaultView?.CSSSupportsRule && rule instanceof defaultView.CSSSupportsRule) {
        visitRules(rule.cssRules, active && activeSupportsRule(rule as CSSSupportsRule, runtime));
        continue;
      }

      if (isRuleInstance(rule, defaultView, 'CSSLayerBlockRule', '[object CSSLayerBlockRule]')) {
        visitRules((rule as CSSGroupingRule).cssRules, active);
        continue;
      }

      if (isSkippableNonSelectorRule(rule, defaultView)) {
        continue;
      }

      throw tableGridError('rule-unreadable');
    }
  };

  let sheets: CSSStyleSheet[];
  try {
    sheets = Array.from(runtime.document.styleSheets);
    const adopted = (runtime.document as Document & { adoptedStyleSheets?: readonly CSSStyleSheet[] }).adoptedStyleSheets;
    if (adopted) sheets.push(...Array.from(adopted));
  } catch {
    throw tableGridError('stylesheet-unreadable');
  }
  for (const sheet of sheets) {
    if (visitedSheets.has(sheet)) throw tableGridError('stylesheet-repeat');
    visitedSheets.add(sheet);
    try {
      visitRules(sheet.cssRules, sheetIsActive(sheet, runtime));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('wechat-table-native-grid-')) throw error;
      throw tableGridError('stylesheet-unreadable');
    }
  }

  return Object.freeze({
    activeValues: Object.freeze(activeValues),
    explicitActiveWidth,
    explicitPotentialWidth,
    potentialValues: Object.freeze(potentialValues)
  });
}

function readTableStructure(source: HTMLTableElement, runtime: BrowserWechatClipboardRuntime): TableStructureInput {
  const groups = Array.from(source.children).map((group): GroupInput => {
    const rows = Array.from(group.children).map((row): RowInput => {
      const cells = Array.from(row.children).map((cell): CellInput => {
        const rect = cell.getBoundingClientRect();
        if (
          !Number.isFinite(rect.width) ||
          rect.width <= 0 ||
          !Number.isFinite(rect.height) ||
          rect.height <= 0
        ) {
          throw tableGridError('cell-geometry');
        }
        return Object.freeze({
          colspan: cell.getAttribute('colspan'),
          height: rect.height,
          rowspan: cell.getAttribute('rowspan'),
          styles: readStyle(runtime.getComputedStyle(cell), CELL_INPUT_PROPERTIES),
          tagName: cell.tagName,
          width: rect.width
        });
      });
      return Object.freeze({
        cells: Object.freeze(cells),
        styles: readStyle(runtime.getComputedStyle(row), ROW_INPUT_PROPERTIES),
        tagName: row.tagName
      });
    });
    return Object.freeze({
      rows: Object.freeze(rows),
      styles: readStyle(runtime.getComputedStyle(group), GROUP_INPUT_PROPERTIES),
      tagName: group.tagName
    });
  });
  return Object.freeze({
    groups: Object.freeze(groups),
    hasCaptionOrColumns: Boolean(source.querySelector('caption, colgroup, col')),
    hasNestedTable: Boolean(source.querySelector('table')),
    nativeRowCount: source.rows.length
  });
}

function structureSignature(structure: TableStructureInput): string {
  return structure.groups
    .map(
      (group) =>
        `${group.tagName}{${styleSignature(group.styles, GROUP_INPUT_PROPERTIES)}}[${group.rows
          .map(
            (row) =>
              `${row.tagName}{${styleSignature(row.styles, ROW_INPUT_PROPERTIES)}}[${row.cells
                .map(
                  (cell) =>
                    `${cell.tagName}:${cell.colspan ?? ''}:${cell.rowspan ?? ''}:${cell.width},${cell.height}{${styleSignature(cell.styles, CELL_INPUT_PROPERTIES)}}`
                )
                .join('|')}]`
          )
          .join('|')}]`
    )
    .join(';');
}

function inputSignature(snapshot: InputSnapshot): string {
  return [
    `source=${snapshot.source.tagName}`,
    `table=${snapshot.tableWidth},${snapshot.tableHeight}`,
    `parent-width=${snapshot.parentWidth ?? 'unavailable'}`,
    `special-layout=${snapshot.specialLayout}`,
    `table-style=${styleSignature(snapshot.tableStyles, TABLE_INPUT_PROPERTIES)}`,
    `pseudo=${styleSignature(snapshot.pseudoStyles, PSEUDO_INPUT_PROPERTIES)}`,
    `structure=${structureSignature(snapshot.structure)}`,
    `native-rows=${snapshot.structure.nativeRowCount}`,
    `author-active=${snapshot.authorWidths.activeValues.join('|')}`,
    `author-potential=${snapshot.authorWidths.potentialValues.join('|')}`,
    `author-explicit-active=${snapshot.authorWidths.explicitActiveWidth}`,
    `author-explicit-potential=${snapshot.authorWidths.explicitPotentialWidth}`
  ].join(';');
}

function inputIssue(error: unknown): string {
  if (!(error instanceof Error)) return 'unreadable';
  return error.message.startsWith('wechat-table-native-grid-')
    ? error.message.slice('wechat-table-native-grid-'.length)
    : 'unreadable';
}

/**
 * Reads current source inputs without deciding admission or planning an output.
 * The returned snapshot contains primitive style/geometry values and the source
 * identity only; it performs no DOM writes and stores no cache.
 */
export function readWechatTableNativeGridInput(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): WechatTableNativeGridInput {
  if ('TABLE' !== source.tagName || 'block' !== normalizedValue(computed, 'display')) {
    return Object.freeze({ issues: Object.freeze([]), key: null, snapshot: null, state: 'non-target' });
  }
  const table = source as HTMLTableElement;
  const pseudo = runtime.getComputedStyle(table, '::before');
  if ('table-caption' !== normalizedValue(pseudo, 'display')) {
    return Object.freeze({ issues: Object.freeze([]), key: null, snapshot: null, state: 'non-target' });
  }

  try {
    const tableRect = table.getBoundingClientRect();
    if (
      !Number.isFinite(tableRect.width) ||
      tableRect.width <= 0 ||
      !Number.isFinite(tableRect.height) ||
      tableRect.height <= 0
    ) {
      throw tableGridError('table-geometry');
    }
    const parentRect = table.parentElement?.getBoundingClientRect();
    const parentWidth =
      parentRect && Number.isFinite(parentRect.width) && parentRect.width > 0 ? parentRect.width : null;
    const snapshot: InputSnapshot = Object.freeze({
      authorWidths: readAuthorPseudoWidths(table, runtime),
      parentWidth,
      pseudoStyles: readStyle(pseudo, PSEUDO_INPUT_PROPERTIES),
      source: table,
      specialLayout: supportsSpecialLayout(table),
      structure: readTableStructure(table, runtime),
      tableHeight: tableRect.height,
      tableStyles: readStyle(computed, TABLE_INPUT_PROPERTIES),
      tableWidth: tableRect.width
    });
    return Object.freeze({
      issues: Object.freeze([]),
      key: `${INPUT_KEY_PREFIX}${inputSignature(snapshot)}`,
      snapshot,
      state: 'target'
    });
  } catch (error) {
    return Object.freeze({
      issues: Object.freeze([inputIssue(error)]),
      key: null,
      snapshot: null,
      state: 'unreadable'
    });
  }
}

function requireCurrentInput(
  input: WechatTableNativeGridInput
): asserts input is WechatTableNativeGridInput & Readonly<{ snapshot: InputSnapshot }> {
  if ('unreadable' === input.state || !input.snapshot) {
    throw tableGridError(input.issues[0] ?? 'unreadable');
  }
}

function requireTransparentPaint(style: StyleSnapshot, properties: readonly string[], code: string): void {
  if (!paintIsTransparent(style, properties)) throw tableGridError(code);
}

function requireStaticSizing(style: StyleSnapshot, code: string): void {
  if ('none' !== (styleValue(style, 'animation-name') || 'none')) throw tableGridError(code);
}

function requireFullWidth(snapshot: InputSnapshot): void {
  const fullWidth =
    '100%' === styleValue(snapshot.tableStyles, 'width') ||
    (null !== snapshot.parentWidth &&
      sameGeometry(snapshot.tableWidth, snapshot.parentWidth, FULL_WIDTH_TOLERANCE));
  if (!fullWidth) throw tableGridError('table-not-full-width');
}

function tableContentWidth(style: StyleSnapshot, tableWidth: number): number {
  const edge = (property: string): number => {
    const value = styleValue(style, property);
    if (!isZero(value)) throw tableGridError('table-edge-paint');
    return 0;
  };
  const contentWidth =
    tableWidth -
    edge('padding-left') -
    edge('padding-right') -
    edge('border-left-width') -
    edge('border-right-width');
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) throw tableGridError('table-content-width');
  return contentWidth;
}

function requireCaptionGeometry(
  pseudo: StyleSnapshot,
  contentWidth: number
): Readonly<{ content: 'empty'; usedWidth: number; width: '100cqi' }> {
  const content = pseudoContentState(pseudo);
  if ('none' === content) throw tableGridError('pseudo-recognition');
  if ('unsupported' === content) throw tableGridError('pseudo-content');
  if ('table-caption' !== styleValue(pseudo, 'display')) throw tableGridError('pseudo-display');
  if (!isZero(styleValue(pseudo, 'height'))) throw tableGridError('pseudo-height');
  const usedWidth = numericCssPixels(styleValue(pseudo, 'width'));
  if (null === usedWidth || usedWidth <= 0) throw tableGridError('pseudo-used-width');
  if (!sameGeometry(usedWidth, contentWidth, CONTENT_WIDTH_TOLERANCE)) {
    throw tableGridError('pseudo-width-mismatch');
  }
  requireTransparentPaint(pseudo, PSEUDO_PAINT_PROPERTIES, 'pseudo-paint');
  requireStaticSizing(pseudo, 'pseudo-animation');
  return { content: 'empty', usedWidth, width: SUPPORTED_PSEUDO_WIDTH };
}

function validateStructure(
  source: HTMLTableElement,
  structure: TableStructureInput
): readonly Readonly<{ height: number; width: number }>[] {
  if (structure.hasNestedTable) throw tableGridError('nested-table');
  if (structure.hasCaptionOrColumns) throw tableGridError('unsupported-table-structure');
  if (!structure.groups.length) throw tableGridError('group-structure');
  let rowCount = 0;
  let cellCount = 0;
  const cells: Array<Readonly<{ height: number; width: number }>> = [];
  for (const group of structure.groups) {
    if (!['THEAD', 'TBODY', 'TFOOT'].includes(group.tagName)) throw tableGridError('group-structure');
    if ('contents' !== styleValue(group.styles, 'display')) throw tableGridError('group-display');
    requireTransparentPaint(group.styles, GROUP_PAINT_PROPERTIES, 'group-paint');
    if (!group.rows.length || group.rows.some((row) => 'TR' !== row.tagName)) {
      throw tableGridError('group-structure');
    }
    for (const row of group.rows) {
      rowCount += 1;
      if ('table-row' !== styleValue(row.styles, 'display')) throw tableGridError('row-display');
      if (!row.cells.length || row.cells.some((cell) => !['TD', 'TH'].includes(cell.tagName))) {
        throw tableGridError('row-structure');
      }
      for (const cell of row.cells) {
        cellCount += 1;
        if (
          [cell.colspan, cell.rowspan].some(
            (span) => null !== span && Boolean(span.trim()) && '1' !== span.trim()
          )
        ) {
          throw tableGridError('cell-span');
        }
        if ('table-cell' !== styleValue(cell.styles, 'display')) throw tableGridError('cell-display');
        cells.push(Object.freeze({ height: cell.height, width: cell.width }));
      }
    }
  }
  if (!rowCount || !cellCount || source.rows.length !== rowCount) throw tableGridError('row-structure');
  return Object.freeze(cells);
}

function validateNativeGridInput(input: WechatTableNativeGridInput): WechatTableNativeGridEvidence | null {
  if ('non-target' === input.state) return null;
  requireCurrentInput(input);
  const snapshot = input.snapshot;
  const { authorWidths, pseudoStyles, source, tableStyles } = snapshot;

  if (snapshot.specialLayout) throw tableGridError('special-layout');
  const pseudoContent = pseudoContentState(pseudoStyles);
  if ('none' === pseudoContent) throw tableGridError('pseudo-recognition');
  if ('unsupported' === pseudoContent) throw tableGridError('pseudo-content');
  requireStaticSizing(tableStyles, 'table-animation');
  requireFullWidth(snapshot);
  if ('auto' !== styleValue(tableStyles, 'table-layout')) throw tableGridError('table-layout');
  if ('collapse' !== styleValue(tableStyles, 'border-collapse')) throw tableGridError('table-collapse');
  if ('2px' !== styleValue(tableStyles, 'border-spacing')) throw tableGridError('table-spacing');
  requireTransparentPaint(tableStyles, TABLE_PAINT_PROPERTIES, 'table-paint');
  const cells = validateStructure(source, snapshot.structure);
  const contentWidth = tableContentWidth(tableStyles, snapshot.tableWidth);
  const caption = requireCaptionGeometry(pseudoStyles, contentWidth);

  if (authorWidths.potentialValues.some((value) => value.startsWith('all:'))) {
    throw tableGridError('width-rule-unsupported');
  }
  if (!authorWidths.explicitPotentialWidth) throw tableGridError('width-rule-missing');
  if (authorWidths.potentialValues.some((value) => SUPPORTED_PSEUDO_WIDTH !== value)) {
    throw tableGridError('width-rule-unsupported');
  }
  if (!authorWidths.explicitActiveWidth) throw tableGridError('width-rule-inactive');

  const sourceKey = input.key;
  if (!sourceKey?.startsWith(INPUT_KEY_PREFIX)) throw tableGridError('input-key-unavailable');
  return Object.freeze({
    cells,
    pseudoBefore: Object.freeze({ content: caption.content, width: caption.width }),
    signature: sourceKey.slice(INPUT_KEY_PREFIX.length),
    source,
    sourceKey,
    tableContentWidth: contentWidth,
    tableHeight: snapshot.tableHeight,
    tableWidth: snapshot.tableWidth,
    usedPseudoWidth: caption.usedWidth
  });
}

/**
 * Strict validation consumes one current-input snapshot. `null` means this is
 * not a table-caption grid shim; every recognized shim that cannot be proved
 * fails with a stable `wechat-table-native-grid-*` error.
 */
export function collectWechatTableNativeGridEvidence(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): WechatTableNativeGridEvidence | null {
  return validateNativeGridInput(readWechatTableNativeGridInput(source, computed, runtime));
}

export function planWechatTableNativeGridApply(
  evidence: WechatTableNativeGridEvidence
): WechatTableNativeGridPlan {
  if (
    !evidence.signature ||
    `${INPUT_KEY_PREFIX}${evidence.signature}` !== evidence.sourceKey ||
    SUPPORTED_PSEUDO_WIDTH !== evidence.pseudoBefore.width
  ) {
    throw tableGridError('evidence-incomplete');
  }
  return Object.freeze({
    declarations: Object.freeze(['display', 'table'] as const),
    signature: evidence.signature,
    sourceKey: evidence.sourceKey
  });
}
