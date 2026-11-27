import { WECHAT_STRUCTURE_REPLACEMENTS } from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import { pseudoContent } from './wechat-pseudo-content';
import { replaceDeclarations } from './wechat-style-declarations';
import { CSS_PERCENTAGE_TOKEN, sourceDirection } from './wechat-style-policy';

const OWNER_GEOMETRY_PROPERTIES = [
  'block-size',
  'border-bottom-style',
  'border-bottom-width',
  'border-left-style',
  'border-left-width',
  'border-right-style',
  'border-right-width',
  'border-top-style',
  'border-top-width',
  'direction',
  'display',
  'float',
  'height',
  'inline-size',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'transform',
  'visibility',
  'width',
  'writing-mode'
] as const;

const PSEUDO_GEOMETRY_PROPERTIES = [
  'border-bottom-style',
  'border-bottom-width',
  'border-left-style',
  'border-left-width',
  'border-right-style',
  'border-right-width',
  'border-top-style',
  'border-top-width',
  'bottom',
  'box-sizing',
  'content',
  'content-visibility',
  'counter-increment',
  'counter-reset',
  'counter-set',
  'display',
  'filter',
  'float',
  'height',
  'left',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'mask',
  'mask-image',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'opacity',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'top',
  'transform',
  'visibility',
  'width',
  'writing-mode'
] as const;

const FINAL_MARKER_PROPERTIES = [
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height'
] as const;

const REQUIRED_OWNER_MAX_NONE = ['max-block-size', 'max-height'] as const;
const REQUIRED_OWNER_MIN_ZERO_OR_AUTO = [
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width'
] as const;
const REQUIRED_OWNER_AUTO = ['block-size', 'height', 'inline-size', 'width'] as const;
const RAW_PSEUDO_MIN_SIZE = ['min-block-size', 'min-height', 'min-inline-size', 'min-width'] as const;
const RAW_PSEUDO_MAX_SIZE = ['max-block-size', 'max-height', 'max-inline-size', 'max-width'] as const;

type QuotePseudoFlowPlan = Readonly<{
  carrierPadding: readonly [string, string, string, string];
  height: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  markerText: string;
  markerPaintSignature: string;
  ownerPaintSignature: string;
  sourceMarkup: string;
  width: number;
}>;

export type QuotePseudoFlowExpectation = Readonly<{
  carrier: HTMLElement;
  marker: Element;
  markerText: string;
  markerPaintSignature: string;
  owner: Element;
  plan: QuotePseudoFlowPlan;
}>;

export type QuotePseudoFlowCollector = {
  expectations: QuotePseudoFlowExpectation[];
};

export type QuotePseudoFlowPlanningSnapshot = Readonly<{
  plan: (marker: Element) => QuotePseudoFlowPlan;
}>;

type QuotePseudoFlowPlanningBaseInput = Readonly<{
  clone: Element;
  dimensionSemantics: WechatDimensionSemanticsContext | null;
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'];
  pseudo: '::before' | '::after';
  pseudoComputed: CSSStyleDeclaration;
  source: Element;
}>;

type QuotePseudoFlowPlanningInput = QuotePseudoFlowPlanningBaseInput &
  Readonly<{
    marker: Element;
  }>;

type QuotePseudoFlowSnapshot = Readonly<{
  owner: Readonly<Record<(typeof OWNER_GEOMETRY_PROPERTIES)[number], string>>;
  pseudo: Readonly<Record<(typeof PSEUDO_GEOMETRY_PROPERTIES)[number], string>>;
  rawPseudo: CSSStyleDeclaration | null;
  after: CSSStyleDeclaration;
  transform: Readonly<{ x: number; y: number }>;
}>;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function finitePx(property: string, value: string): number {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(value.trim());
  const parsed = Number(match?.[1]);
  if (!Number.isFinite(parsed)) {
    throw new Error(`wechat-quote-pseudo-${property}-unsupported`);
  }
  return parsed;
}

function nonnegativePx(property: string, value: string): number {
  const parsed = finitePx(property, value);
  if (parsed < 0) throw new Error(`wechat-quote-pseudo-${property}-unsupported`);
  return parsed;
}

function snapshotPseudo(computed: CSSStyleDeclaration): CSSStyleDeclaration {
  const values = new Map<string, string>();
  PSEUDO_GEOMETRY_PROPERTIES.forEach((property) => {
    values.set(property, computed.getPropertyValue(property));
  });
  return { getPropertyValue: (property: string) => values.get(property) ?? '' } as unknown as CSSStyleDeclaration;
}

function pseudoBorderWidth(
  computed: CSSStyleDeclaration,
  side: 'top' | 'right' | 'bottom' | 'left'
): number {
  const styleValue = normalized(computed.getPropertyValue(`border-${side}-style`));
  if (['none', 'hidden'].includes(styleValue)) return 0;
  return nonnegativePx(`border-${side}-width`, computed.getPropertyValue(`border-${side}-width`));
}

function translatedOffset2d(value: string, property: 'left' | 'top'): number {
  const raw = value.trim();
  if (!raw || 'none' === normalized(raw)) return 0;
  const match = /^matrix\(([^)]+)\)$/u.exec(raw);
  if (!match?.[1]) throw new Error('wechat-quote-pseudo-transform-unsupported');
  const values = match[1].split(',').map((entry) => Number(entry.trim()));
  if (values.length !== 6 || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error('wechat-quote-pseudo-transform-unsupported');
  }
  const a = values[0];
  const b = values[1];
  const c = values[2];
  const d = values[3];
  const tx = values[4] ?? Number.NaN;
  const ty = values[5] ?? Number.NaN;
  if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
    throw new Error('wechat-quote-pseudo-transform-unsupported');
  }
  return 'left' === property ? tx : ty;
}

function readOwnerTransform(value: string): Readonly<{ x: number; y: number }> {
  const raw = value.trim();
  if (!raw || 'none' === normalized(raw)) return { x: 0, y: 0 };
  const match = /^matrix\(([^)]+)\)$/u.exec(raw);
  const parsed = match?.[1]
    ? match[1].split(',').map((entry) => Number(entry.trim()))
    : [];
  if (
    parsed.length !== 6 ||
    parsed.some((entry) => !Number.isFinite(entry)) ||
    parsed[0] !== 1 ||
    parsed[1] !== 0 ||
    parsed[2] !== 0 ||
    parsed[3] !== 1
  ) {
    throw new Error('wechat-quote-pseudo-owner-transform-unsupported');
  }
  return { x: parsed[4] ?? 0, y: parsed[5] ?? 0 };
}

const DECLARATION_IMPORTANT = /!\s*important\s*$/iu;

type DeclaredStyle = Readonly<{ important: boolean; value: string }>;

function declaredStyles(element: Element): ReadonlyMap<string, DeclaredStyle> {
  const declarations = new Map<string, DeclaredStyle>();
  (element.getAttribute('style') ?? '').split(';').forEach((raw) => {
    const separator = raw.indexOf(':');
    if (separator < 1) return;
    const property = raw.slice(0, separator).trim().toLowerCase();
    const rawValue = raw.slice(separator + 1).trim();
    const next = {
      important: DECLARATION_IMPORTANT.test(rawValue),
      value: rawValue.replace(DECLARATION_IMPORTANT, '').trim()
    };
    const current = declarations.get(property);
    if (current?.important && !next.important) return;
    declarations.set(property, next);
  });
  return declarations;
}

function declaredValue(element: Element, property: string): string {
  return declaredStyles(element).get(property)?.value ?? '';
}

function markerPaintSignature(marker: Element): string {
  return FINAL_MARKER_PROPERTIES.map((property) => `${property}=${declaredValue(marker, property)}`).join(';');
}

const OWNER_FLOW_MUTATED_PROPERTIES = new Set([
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top'
]);

function ownerPaintSignature(owner: Element): string {
  return [...declaredStyles(owner)]
    .filter(([property]) => !OWNER_FLOW_MUTATED_PROPERTIES.has(property))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([property, declaration]) => `${property}=${declaration.value}${declaration.important ? '!important' : ''}`)
    .join(';');
}

function captureSnapshot(input: QuotePseudoFlowPlanningBaseInput): QuotePseudoFlowSnapshot {
  const ownerComputed = input.getComputedStyle(input.source);
  const rawOwnerComputed = input.dimensionSemantics?.getComputedStyle(input.source) ?? null;
  const owner = Object.fromEntries(
    OWNER_GEOMETRY_PROPERTIES.map((property) => {
      if (!rawOwnerComputed) return [property, ownerComputed.getPropertyValue(property)];
      const rawValue = rawOwnerComputed.getPropertyValue(property);
      if (property.startsWith('padding-')) return [property, rawValue || ownerComputed.getPropertyValue(property)];
      if (
        [
          'width',
          'inline-size',
          'min-width',
          'max-width',
          'min-inline-size',
          'max-inline-size',
          'height',
          'block-size',
          'min-height',
          'max-height',
          'min-block-size',
          'max-block-size'
        ].includes(property)
      ) {
        return [property, rawValue];
      }
      return [property, ownerComputed.getPropertyValue(property)];
    })
  ) as Record<(typeof OWNER_GEOMETRY_PROPERTIES)[number], string>;
  const rawPseudo =
    input.dimensionSemantics?.getComputedStyle(input.source, input.pseudo) ?? null;
  const pseudo = Object.fromEntries(
    PSEUDO_GEOMETRY_PROPERTIES.map((property) => {
      const usedValue = input.pseudoComputed.getPropertyValue(property);
      if ('width' !== property && 'height' !== property) return [property, usedValue];
      const rawValue = normalized(rawPseudo?.getPropertyValue(property) ?? '');
      return [property, rawValue && 'auto' !== rawValue ? rawValue : usedValue];
    })
  ) as Record<(typeof PSEUDO_GEOMETRY_PROPERTIES)[number], string>;
  const transform = readOwnerTransform(owner.transform);
  return Object.freeze({
    after: snapshotPseudo(input.getComputedStyle(input.source, '::after')),
    owner: Object.freeze(owner),
    rawPseudo: rawPseudo ? snapshotPseudo(rawPseudo) : null,
    pseudo: Object.freeze(pseudo),
    transform: Object.freeze(transform)
  });
}

function constantOrPx(property: string, value: string | undefined, constants: Readonly<Record<string, string>>): void {
  if (typeof value !== 'string' || !value.trim() || constants[property] !== normalized(value)) {
    throw new Error(`wechat-quote-pseudo-${property}-unsupported`);
  }
}

function validateHorizontalGeometry(owner: Readonly<Record<(typeof OWNER_GEOMETRY_PROPERTIES)[number], string>>): void {
  (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
    const style = normalized(owner[`border-${side}-style` as keyof typeof owner]);
    if (['none', 'hidden'].includes(style)) return;
    nonnegativePx(`owner-border-${side}`, owner[`border-${side}-width` as keyof typeof owner]);
  });
  nonnegativePx('owner-margin', owner['margin-left']);
  nonnegativePx('owner-margin', owner['margin-right']);
  ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].forEach((property) => {
    const value = normalized(owner[property as keyof typeof owner]);
    if (!value || (property.startsWith('padding-') && value.startsWith('-'))) {
      throw new Error('wechat-quote-pseudo-carrier-padding-unsupported');
    }
    if (!CSS_PERCENTAGE_TOKEN.test(value) && !/^(?:0|(?:\d+(?:\.\d+)?|\.\d+))px$/u.test(value)) {
      throw new Error('wechat-quote-pseudo-carrier-padding-unsupported');
    }
  });
}

function validateRawPseudoAnchoring(computed: CSSStyleDeclaration): void {
  (['left', 'top'] as const).forEach((property) => {
    finitePx(property, computed.getPropertyValue(property));
  });
  (['right', 'bottom'] as const).forEach((property) => {
    const value = normalized(computed.getPropertyValue(property));
    if (value && 'auto' !== value) {
      throw new Error(`wechat-quote-pseudo-${property}-anchoring-unsupported`);
    }
  });
}

function validateRawPseudoSizing(computed: CSSStyleDeclaration): void {
  validateRawPseudoAnchoring(computed);
  (['width', 'height'] as const).forEach((property) => {
    const value = normalized(computed.getPropertyValue(property));
    if ('auto' !== value) nonnegativePx(property, value);
  });
  validatePseudoSizeBounds((property) => computed.getPropertyValue(property));
}

function validatePseudoSizeBounds(read: (property: string) => string): void {
  RAW_PSEUDO_MIN_SIZE.forEach((property) => {
    const value = normalized(read(property));
    if (!['auto', '0px'].includes(value)) {
      throw new Error(`wechat-quote-pseudo-${property}-unsupported`);
    }
  });
  RAW_PSEUDO_MAX_SIZE.forEach((property) => {
    const value = normalized(read(property));
    if ('none' !== value) {
      throw new Error(`wechat-quote-pseudo-${property}-unsupported`);
    }
  });
}

function validateAdmission(input: QuotePseudoFlowPlanningBaseInput, snapshot: QuotePseudoFlowSnapshot): void {
  const { owner, pseudo } = snapshot;
  if (
    !['BLOCKQUOTE', 'SECTION'].includes(input.source.tagName) ||
    '::before' !== input.pseudo ||
    input.source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline')
  ) {
    throw new Error('wechat-quote-pseudo-candidate-unsupported');
  }
  const textContent = pseudoContent(pseudo.content);
  if (null === textContent || '' === textContent) {
    throw new Error('wechat-quote-pseudo-text-content-required');
  }
  if (snapshot.rawPseudo) validateRawPseudoSizing(snapshot.rawPseudo);
  validatePseudoSizeBounds((property) => snapshot.pseudo[property as keyof typeof snapshot.pseudo] ?? '');
  constantOrPx('display', owner.display, { display: 'block' });
  constantOrPx('position', owner.position, { position: 'relative' });
  constantOrPx('float', owner.float, { float: 'none' });
  constantOrPx('writing-mode', owner['writing-mode'], {
    'writing-mode': 'horizontal-tb'
  });
  constantOrPx('visibility', owner.visibility, { visibility: 'visible' });
  constantOrPx('transform', owner.transform, { transform: 'none' });
  if (
    'ltr' !==
    sourceDirection(
      input.source,
      { getPropertyValue: (property: string) => owner[property as keyof typeof owner] ?? '' } as unknown as CSSStyleDeclaration
    )
  ) {
    throw new Error('wechat-quote-pseudo-direction-unsupported');
  }
  REQUIRED_OWNER_MAX_NONE.forEach((property) => {
    constantOrPx(property, owner[property], { [property]: 'none' });
  });
  const maxWidth = normalized(owner['max-width']);
  const maxInlineSize = normalized(owner['max-inline-size']);
  if (!['none', '100%'].includes(maxWidth) || maxInlineSize !== maxWidth) {
    throw new Error('wechat-quote-pseudo-owner-size-unsupported');
  }
  REQUIRED_OWNER_MIN_ZERO_OR_AUTO.forEach((property) => {
    if (!['auto', '0px'].includes(normalized(owner[property]))) {
      throw new Error('wechat-quote-pseudo-owner-size-unsupported');
    }
  });
  REQUIRED_OWNER_AUTO.forEach((property) => {
    constantOrPx(property, owner[property], { [property]: 'auto' });
  });
  validateHorizontalGeometry(owner);
  const paddingValues = [
    owner['padding-top'],
    owner['padding-right'],
    owner['padding-bottom'],
    owner['padding-left']
  ] as const;
  const hasPercentage = paddingValues.some((value) => CSS_PERCENTAGE_TOKEN.test(value.trim()));
  const horizontalBorder =
    finitePx('border-left-width', owner['border-left-width']) +
    finitePx('border-right-width', owner['border-right-width']);
  const horizontalMargin = finitePx('margin-left', owner['margin-left']) + finitePx('margin-right', owner['margin-right']);
  if (hasPercentage && (Math.abs(horizontalBorder) > 0 || Math.abs(horizontalMargin) > 0)) {
    throw new Error('wechat-quote-pseudo-percentage-basis-unsupported');
  }

  constantOrPx('display', pseudo.display, { display: 'block' });
  constantOrPx('position', pseudo.position, { position: 'absolute' });
  constantOrPx('float', pseudo.float, { float: 'none' });
  constantOrPx('visibility', pseudo.visibility, { visibility: 'visible' });
  if (normalized(pseudo['content-visibility']) === 'hidden') {
    throw new Error('wechat-quote-pseudo-visibility-unsupported');
  }
  const opacity = Number(pseudo.opacity);
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    throw new Error('wechat-quote-pseudo-opacity-unsupported');
  }
  if ('none' !== normalized(pseudo.mask) || 'none' !== normalized(pseudo['mask-image'])) {
    throw new Error('wechat-quote-pseudo-paint-unsupported');
  }
  if ('none' !== normalized(pseudo.filter)) {
    throw new Error('wechat-quote-pseudo-paint-unsupported');
  }
  ['counter-increment', 'counter-reset', 'counter-set'].forEach((property) => {
    const value = normalized(pseudo[property as keyof typeof pseudo]);
    if (value && 'none' !== value) throw new Error('wechat-quote-pseudo-counter-unsupported');
  });
  const afterContent = snapshot.after.getPropertyValue('content');
  const afterDisplay = normalized(snapshot.after.getPropertyValue('display'));
  const afterVisibility = normalized(snapshot.after.getPropertyValue('visibility'));
  if (
    (null !== pseudoContent(afterContent) && 'none' !== afterDisplay) ||
    ['hidden', 'collapse'].includes(afterVisibility)
  ) {
    throw new Error('wechat-quote-pseudo-after-unsupported');
  }
}

function borderBoxDimension(
  property: 'width' | 'height',
  computed: Readonly<Record<(typeof PSEUDO_GEOMETRY_PROPERTIES)[number], string>>
): number {
  const size = nonnegativePx(property, computed[property]);
  if ('none' !== normalized(computed['max-width']) && 'width' === property) {
    throw new Error('wechat-quote-pseudo-max-width-unsupported');
  }
  if ('none' !== normalized(computed['max-height']) && 'height' === property) {
    throw new Error('wechat-quote-pseudo-max-height-unsupported');
  }
  if (['auto', '0px'].includes(normalized(computed['min-width'])) === false && 'width' === property) {
    throw new Error('wechat-quote-pseudo-min-width-unsupported');
  }
  if (['auto', '0px'].includes(normalized(computed['min-height'])) === false && 'height' === property) {
    throw new Error('wechat-quote-pseudo-min-height-unsupported');
  }
  const horizontal = 'width' === property;
  const padding = horizontal
    ? nonnegativePx('padding-left', computed['padding-left']) + nonnegativePx('padding-right', computed['padding-right'])
    : nonnegativePx('padding-top', computed['padding-top']) + nonnegativePx('padding-bottom', computed['padding-bottom']);
  const border = horizontal
    ? pseudoBorderWidth({
        getPropertyValue: (name: string) => computed[name as keyof typeof computed] ?? ''
      } as unknown as CSSStyleDeclaration, 'left') +
      pseudoBorderWidth({
        getPropertyValue: (name: string) => computed[name as keyof typeof computed] ?? ''
      } as unknown as CSSStyleDeclaration, 'right')
    : pseudoBorderWidth({
        getPropertyValue: (name: string) => computed[name as keyof typeof computed] ?? ''
      } as unknown as CSSStyleDeclaration, 'top') +
      pseudoBorderWidth({
        getPropertyValue: (name: string) => computed[name as keyof typeof computed] ?? ''
      } as unknown as CSSStyleDeclaration, 'bottom');
  const boxSizing = normalized(computed['box-sizing']);
  if ('border-box' === boxSizing) return size;
  if ('content-box' !== boxSizing) throw new Error('wechat-quote-pseudo-box-sizing-unsupported');
  return size + padding + border;
}

type QuotePseudoFlowMarkerIndependentPlan = Omit<
  QuotePseudoFlowPlan,
  'markerPaintSignature' | 'markerText'
>;

function createPlanWithoutMarker(
  input: QuotePseudoFlowPlanningBaseInput,
  snapshot: QuotePseudoFlowSnapshot
): QuotePseudoFlowMarkerIndependentPlan {
  const width = borderBoxDimension('width', snapshot.pseudo);
  const height = borderBoxDimension('height', snapshot.pseudo);
  if (width <= 0 || height <= 0) throw new Error('wechat-quote-pseudo-size-unsupported');
  const left =
    finitePx('left', snapshot.pseudo.left) +
    finitePx('margin-left', snapshot.pseudo['margin-left']) +
    translatedOffset2d(snapshot.pseudo.transform, 'left') +
    snapshot.transform.x;
  const top =
    finitePx('top', snapshot.pseudo.top) +
    finitePx('margin-top', snapshot.pseudo['margin-top']) +
    translatedOffset2d(snapshot.pseudo.transform, 'top') +
    snapshot.transform.y;
  return Object.freeze({
    carrierPadding: Object.freeze([
      snapshot.owner['padding-top'],
      snapshot.owner['padding-right'],
      snapshot.owner['padding-bottom'],
      snapshot.owner['padding-left']
    ]) as readonly [string, string, string, string],
    height,
    marginBottom: -height - top,
    marginLeft: left,
    marginRight: -width - left,
    marginTop: top,
    ownerPaintSignature: ownerPaintSignature(input.clone),
    sourceMarkup: input.source.outerHTML,
    width
  });
}

function createPlan(
  input: QuotePseudoFlowPlanningInput,
  snapshot: QuotePseudoFlowSnapshot
): QuotePseudoFlowPlan {
  validateAdmission(input, snapshot);
  const markerIndependent = createPlanWithoutMarker(input, snapshot);
  return Object.freeze({
    ...markerIndependent,
    markerText: input.marker.textContent ?? '',
    markerPaintSignature: markerPaintSignature(input.marker)
  });
}

const quoteFlowSources = new WeakMap<QuotePseudoFlowPlan, Element>();

export function captureQuotePseudoFlowSnapshot(
  input: QuotePseudoFlowPlanningBaseInput
): QuotePseudoFlowPlanningSnapshot {
  const snapshot = captureSnapshot(input);
  validateAdmission(input, snapshot);
  const markerIndependentPlan = createPlanWithoutMarker(input, snapshot);
  return Object.freeze({
    plan: (marker: Element) => {
      const plan = Object.freeze({
        ...markerIndependentPlan,
        markerText: marker.textContent ?? '',
        markerPaintSignature: markerPaintSignature(marker)
      });
      quoteFlowSources.set(plan, input.source);
      return plan;
    }
  });
}

export function planQuotePseudoFlow(input: QuotePseudoFlowPlanningInput): QuotePseudoFlowPlan | null {
  const snapshot = captureSnapshot(input);
  const plan = createPlan(input, snapshot);
  quoteFlowSources.set(plan, input.source);
  return plan;
}

export function applyQuotePseudoFlow(
  owner: Element,
  marker: Element,
  plan: QuotePseudoFlowPlan,
  collector?: QuotePseudoFlowCollector
): QuotePseudoFlowExpectation {
  const document = owner.ownerDocument;
  const carrier = document.createElement('section');
  carrier.setAttribute('aria-hidden', 'false');
  replaceDeclarations(
    carrier,
    [
      'display:block',
      'box-sizing:border-box',
      'width:100%',
      'max-width:100%',
      'min-width:0',
      'margin-top:0',
      'margin-right:0',
      'margin-bottom:0',
      'margin-left:0',
      `padding-top:${plan.carrierPadding[0]}`,
      `padding-right:${plan.carrierPadding[1]}`,
      `padding-bottom:${plan.carrierPadding[2]}`,
      `padding-left:${plan.carrierPadding[3]}`,
      'border-top-width:0',
      'border-right-width:0',
      'border-bottom-width:0',
      'border-left-width:0',
      'border-top-style:none',
      'border-right-style:none',
      'border-bottom-style:none',
      'border-left-style:none',
      'background:transparent'
    ],
    true
  );
  const authored: ChildNode[] = [];
  owner.childNodes.forEach((child) => {
    if (child !== marker) authored.push(child);
  });
  authored.forEach((child) => {
    carrier.appendChild(child);
  });
  owner.appendChild(carrier);
  replaceDeclarations(owner, ['padding-top:0px', 'padding-right:0px', 'padding-bottom:0px', 'padding-left:0px'], true);
  replaceDeclarations(
    marker,
    [
      'display:block',
      'position:static',
      'float:left',
      'top:auto',
      'right:auto',
      'bottom:auto',
      'left:auto',
      'transform:none',
      'box-sizing:border-box',
      'min-width:0',
      'max-width:none',
      'min-height:0',
      'max-height:none',
      `width:${plan.width}px`,
      `height:${plan.height}px`,
      `margin-left:${plan.marginLeft}px`,
      `margin-right:${plan.marginRight}px`,
      `margin-top:${plan.marginTop}px`,
      `margin-bottom:${plan.marginBottom}px`
    ],
    true
  );
  const expectation = Object.freeze({
    carrier,
    marker,
    markerText: plan.markerText,
    markerPaintSignature: plan.markerPaintSignature,
    owner,
    plan
  });
  collector?.expectations.push(expectation);
  return expectation;
}

function resolvedOwner(owner: Element): Element {
  return WECHAT_STRUCTURE_REPLACEMENTS.get(owner) ?? owner;
}

function declaredImportantValue(element: Element, property: string): string {
  const declaration = declaredStyles(element).get(property);
  if (!declaration?.value || !declaration.important) {
    throw new Error('wechat-quote-pseudo-final-style-missing');
  }
  return normalized(declaration.value);
}

function provenance(value: number): string {
  return Object.is(value, -0) ? '0px' : `${value}px`;
}

export function assertQuotePseudoFlows(
  expectations: readonly QuotePseudoFlowExpectation[],
  finalizedRoot: Node
): void {
  expectations.forEach(({ carrier, marker, markerPaintSignature: expectedPaint, markerText, owner, plan }) => {
    const source = quoteFlowSources.get(plan);
    if (!source || source.outerHTML !== plan.sourceMarkup) {
      throw new Error('wechat-quote-pseudo-final-source-mismatch');
    }
    const outputOwner = resolvedOwner(owner);
    if (
      !finalizedRoot.contains(outputOwner) ||
      !outputOwner.contains(marker) ||
      !outputOwner.contains(carrier) ||
      marker.parentElement !== outputOwner ||
      carrier.parentElement !== outputOwner ||
      !('SECTION' === outputOwner.tagName) ||
      !('SECTION' === carrier.tagName)
    ) {
      throw new Error('wechat-quote-pseudo-final-owner-mismatch');
    }
    if (
      markerPaintSignature(marker) !== expectedPaint ||
      marker.textContent !== markerText
    ) {
      throw new Error('wechat-quote-pseudo-final-marker-mismatch');
    }
    if (ownerPaintSignature(outputOwner) !== plan.ownerPaintSignature) {
      throw new Error('wechat-quote-pseudo-final-owner-paint-mismatch');
    }
    ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].forEach((property) => {
      if ('0px' !== declaredImportantValue(outputOwner, property)) {
        throw new Error('wechat-quote-pseudo-final-owner-padding-mismatch');
      }
    });
    const expectedCarrier = new Map([
      ['display', 'block'],
      ['box-sizing', 'border-box'],
      ['width', '100%'],
      ['max-width', '100%'],
      ['min-width', '0'],
      ['margin-top', '0'],
      ['margin-right', '0'],
      ['margin-bottom', '0'],
      ['margin-left', '0'],
      ['padding-top', normalized(plan.carrierPadding[0])],
      ['padding-right', normalized(plan.carrierPadding[1])],
      ['padding-bottom', normalized(plan.carrierPadding[2])],
      ['padding-left', normalized(plan.carrierPadding[3])],
      ['border-top-width', '0'],
      ['border-right-width', '0'],
      ['border-bottom-width', '0'],
      ['border-left-width', '0'],
      ['border-top-style', 'none'],
      ['border-right-style', 'none'],
      ['border-bottom-style', 'none'],
      ['border-left-style', 'none'],
      ['background', 'transparent']
    ]);
    expectedCarrier.forEach((value, property) => {
      if (value !== declaredImportantValue(carrier, property)) {
        throw new Error('wechat-quote-pseudo-final-carrier-mismatch');
      }
    });
    const expectedMarker = new Map([
      ['display', 'block'],
      ['position', 'static'],
      ['float', 'left'],
      ['top', 'auto'],
      ['right', 'auto'],
      ['bottom', 'auto'],
      ['left', 'auto'],
      ['transform', 'none'],
      ['box-sizing', 'border-box'],
      ['min-width', '0'],
      ['max-width', 'none'],
      ['min-height', '0'],
      ['max-height', 'none'],
      ['width', provenance(plan.width)],
      ['height', provenance(plan.height)],
      ['margin-left', provenance(plan.marginLeft)],
      ['margin-right', provenance(plan.marginRight)],
      ['margin-top', provenance(plan.marginTop)],
      ['margin-bottom', provenance(plan.marginBottom)]
    ]);
    expectedMarker.forEach((value, property) => {
      const actual = declaredImportantValue(marker, property);
      if (value !== actual) {
        throw new Error('wechat-quote-pseudo-final-marker-mismatch');
      }
    });
  });
}

export function quotePseudoFlowFreshnessSignature(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null
): string {
  if (!['BLOCKQUOTE', 'SECTION'].includes(source.tagName)) return '';
  if ('SECTION' !== source.tagName && !(source instanceof HTMLElement)) return '';
  const owner = runtime.getComputedStyle(source);
  const before = runtime.getComputedStyle(source, '::before');
  const after = runtime.getComputedStyle(source, '::after');
  const rawOwner = dimensionSemantics?.getComputedStyle(source) ?? null;
  const rawBefore = dimensionSemantics?.getComputedStyle(source, '::before') ?? null;
  const rawAfter = dimensionSemantics?.getComputedStyle(source, '::after') ?? null;
  return [
    ...OWNER_GEOMETRY_PROPERTIES.map((property) => `owner:${property}=${owner.getPropertyValue(property)}`),
    ...(rawOwner
      ? OWNER_GEOMETRY_PROPERTIES.map((property) => `raw-owner:${property}=${rawOwner.getPropertyValue(property)}`)
      : []),
    ...PSEUDO_GEOMETRY_PROPERTIES.map((property) => `before:${property}=${before.getPropertyValue(property)}`),
    ...PSEUDO_GEOMETRY_PROPERTIES.map((property) => `after:${property}=${after.getPropertyValue(property)}`),
    ...(rawBefore
      ? PSEUDO_GEOMETRY_PROPERTIES.map(
          (property) => `raw-before:${property}=${rawBefore.getPropertyValue(property)}`
        )
      : []),
    ...(rawAfter
      ? PSEUDO_GEOMETRY_PROPERTIES.map(
          (property) => `raw-after:${property}=${rawAfter.getPropertyValue(property)}`
        )
      : [])
  ].join(';');
}
