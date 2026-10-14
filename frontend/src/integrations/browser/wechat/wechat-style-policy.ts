import {
  CODE_FRAME_HEADER_CLONES,
  CODE_FRAME_PSEUDO_CLONES,
  hasVisualRasterizationAncestor,
  isKaTeXVisualNode,
  isSvgElement,
  isTaskListCheckbox,
  THEME_HEADING_SUFFIX_CLONES,
  THEME_IMAGE_CLONES,
  visualRasterizationKind,
  WECHAT_PNG_GENERATED_IMAGES,
  WECHAT_PNG_VISUAL_CLONES
} from './wechat-clone-metadata';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import { taskCheckboxFontWithoutZeroLineHeight, taskCheckboxLineHeightIsZero } from './wechat-task-checkbox-style';

export const COPY_STYLE_PROPERTIES = [
  'display',
  'flex-direction',
  'flex-wrap',
  'flex-flow',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'order',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'gap',
  'column-gap',
  'row-gap',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-collapse',
  'border-spacing',
  'border-radius',
  'background',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'container-type',
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'font-variant',
  'font-stretch',
  'text-align',
  'text-decoration',
  'text-transform',
  'text-indent',
  'text-shadow',
  'white-space',
  'word-break',
  'overflow-wrap',
  'vertical-align',
  'list-style-type',
  'list-style-position',
  'box-shadow',
  'opacity',
  'tab-size'
] as const;

export const SVG_STYLE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'marker-start',
  'marker-mid',
  'marker-end',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'fill-rule',
  'paint-order',
  'vector-effect',
  'shape-rendering',
  'text-rendering',
  'stop-color',
  'stop-opacity',
  'dominant-baseline',
  'text-anchor'
] as const;

export const SPECIAL_LAYOUT_PROPERTIES = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'box-sizing',
  'transform',
  'transform-origin',
  'z-index'
] as const;

export const ORDINARY_LAYOUT_PROPERTIES = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'box-sizing',
  'float',
  'clear',
  'transform',
  'transform-origin',
  'z-index'
] as const;

export const ORDINARY_DIMENSION_PROPERTIES = [
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height'
] as const;

export const SEMANTIC_MARGIN_PROPERTIES = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const;

export const NATIVE_LAYOUT_PROPERTIES = ['table-layout'] as const;

export const SAFE_DISPLAY_VALUES: Record<string, true> = {
  block: true,
  inline: true,
  'inline-block': true,
  'inline-table': true,
  'inline-flex': true,
  'flow-root': true,
  flex: true,
  'list-item': true,
  table: true,
  contents: true,
  'table-caption': true,
  'table-cell': true,
  'table-column': true,
  'table-column-group': true,
  'table-footer-group': true,
  'table-header-group': true,
  'table-row': true,
  'table-row-group': true
};

export const TRANSIENT_ATTRIBUTE = /^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;

export const UNSAFE_STYLE_VALUE =
  /(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;

export const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;

export const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);

export const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
  'align-content': new Set(['normal', 'stretch']),
  'align-items': new Set(['normal', 'stretch']),
  'align-self': new Set(['auto']),
  'box-shadow': new Set(['none']),
  'column-gap': new Set(['normal', '0px']),
  'container-type': new Set(['normal']),
  display: new Set(),
  'flex-basis': new Set(['auto']),
  'flex-direction': new Set(['row']),
  'flex-flow': new Set(['row nowrap']),
  'flex-wrap': new Set(['nowrap']),
  'flex-grow': new Set(['0']),
  'flex-shrink': new Set(['1']),
  'font-stretch': new Set(['100%']),
  'font-variant': new Set(['normal']),
  gap: new Set(['normal', '0px']),
  'justify-content': new Set(['normal', 'flex-start']),
  'list-style-position': new Set(['outside']),
  opacity: new Set(['1']),
  order: new Set(['0']),
  'row-gap': new Set(['normal', '0px']),
  'tab-size': new Set(['8']),
  'text-indent': new Set(['0px']),
  'text-shadow': new Set(['none']),
  'text-transform': new Set(['none']),
  'vertical-align': new Set(['baseline']),
  'white-space': new Set(['normal'])
};

export const PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES = new Set([
  'font-style',
  'font-variant',
  'font-stretch',
  'letter-spacing',
  'text-transform',
  'white-space',
  'text-indent',
  'text-shadow',
  'tab-size',
  'list-style-position'
]);

export const PREPARED_PSEUDO_ELEMENTS = ['::before', '::after'] as const;

export function uniqueStyleProperties(...groups: ReadonlyArray<ReadonlyArray<string>>): string[] {
  return [...new Set(groups.flat())];
}

export const ROOT_EXPORT_STYLE_PROPERTIES = new Set(
  uniqueStyleProperties(
    COPY_STYLE_PROPERTIES,
    ORDINARY_LAYOUT_PROPERTIES,
    SPECIAL_LAYOUT_PROPERTIES,
    SVG_STYLE_PROPERTIES,
    ['content', 'direction', 'box-sizing', 'visibility', 'content-visibility', 'width', 'height']
  )
);

export function finitePixelValue(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cssomProjectedDimensionValue(property: string, semantic: string, extra: number, source: Element): string {
  const declaration = source.ownerDocument.createElement('div').style;
  const projected = `calc(${semantic} + ${extra}px)`;
  declaration.setProperty(property, projected);
  const normalized = declaration.getPropertyValue(property).trim();
  if (!normalized) throw new Error('wechat-invalid-content-box-dimension');
  return normalized;
}

export const CONTENT_BOX_DIMENSION_PROPERTIES = [
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height'
] as const;
export const CONTENT_BOX_PERCENTAGE_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?%$/;
export const CONTENT_BOX_PIXEL_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?px$/i;
export const CONTENT_BOX_DIMENSION_KEYWORDS: Readonly<
  Record<(typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number], ReadonlySet<string>>
> = {
  width: new Set(['auto']),
  'min-width': new Set(['auto']),
  'max-width': new Set(['none']),
  height: new Set(['auto']),
  'min-height': new Set(['auto']),
  'max-height': new Set(['none'])
};
export const CONTENT_BOX_REPLACED_ELEMENTS = new Set([
  'audio',
  'canvas',
  'embed',
  'iframe',
  'img',
  'input',
  'object',
  'picture',
  'select',
  'source',
  'textarea',
  'track',
  'video'
]);
export const CONTENT_BOX_PROMOTED_PROPERTIES = new Set(['box-sizing', 'max-width']);
export const CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS = new Set([
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'table',
  'inline-table',
  'table-caption',
  'table-cell',
  'table-column',
  'table-column-group',
  'table-footer-group',
  'table-header-group',
  'table-row',
  'table-row-group'
]);

export function isContentBoxTransportableDimension(
  property: (typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number],
  value: string
): boolean {
  const normalized = value.trim().toLowerCase();
  if (CONTENT_BOX_DIMENSION_KEYWORDS[property].has(normalized)) return true;
  if (null !== contentBoxFinitePixelValue(normalized)) return true;
  const percentage = CONTENT_BOX_PERCENTAGE_TOKEN.exec(normalized);
  if (!percentage) return false;
  const parsed = Number.parseFloat(percentage[0].slice(0, -1));
  return Number.isFinite(parsed) && parsed >= 0;
}

export function contentBoxFinitePixelValue(value: string): number | null {
  const pixel = CONTENT_BOX_PIXEL_TOKEN.exec(value.trim().toLowerCase());
  if (!pixel) return null;
  const parsed = Number.parseFloat(pixel[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isContentBoxPercentageDimension(value: string): boolean {
  const match = CONTENT_BOX_PERCENTAGE_TOKEN.exec(value.trim().toLowerCase());
  if (!match) return false;
  const parsed = Number.parseFloat(match[0].slice(0, -1));
  return Number.isFinite(parsed) && parsed >= 0;
}

export function hasExcludedContentBoxParent(
  source: Element,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): boolean {
  const formattingOwnerDisplay = dimensionSemantics?.getFormattingOwnerDisplay(source);
  return Boolean(formattingOwnerDisplay && CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS.has(formattingOwnerDisplay));
}

export function contentBoxEdgeSum(computed: CSSStyleDeclaration, properties: readonly string[]): number | null {
  const values = properties.map((property) => contentBoxFinitePixelValue(computed.getPropertyValue(property)));
  if (values.some((value) => null === value || value < 0)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function isContentBoxPercentageProjectionCandidate(
  source: Element,
  semanticComputed: CSSStyleDeclaration | null,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  pseudoElement: boolean,
  root: boolean
): boolean {
  if (root || pseudoElement || !semanticComputed) return false;
  const documentNamespace = source.ownerDocument.documentElement?.namespaceURI;
  if (!documentNamespace || documentNamespace !== source.namespaceURI) return false;
  if (CONTENT_BOX_REPLACED_ELEMENTS.has(source.localName.toLowerCase())) return false;

  const display = semanticComputed.getPropertyValue('display').trim().toLowerCase();
  const position = semanticComputed.getPropertyValue('position').trim().toLowerCase();
  const float = semanticComputed.getPropertyValue('float').trim().toLowerCase();
  if ('block' !== display || !['static', 'relative'].includes(position) || 'none' !== float) return false;
  if ('content-box' !== semanticComputed.getPropertyValue('box-sizing').trim().toLowerCase()) return false;

  const rawDimensions = CONTENT_BOX_DIMENSION_PROPERTIES.map((property) =>
    semanticComputed.getPropertyValue(property).trim()
  );
  if (
    !rawDimensions.every((value, index) =>
      isContentBoxTransportableDimension(
        CONTENT_BOX_DIMENSION_PROPERTIES[index] as (typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number],
        value
      )
    )
  )
    return false;

  const horizontalPercentage = rawDimensions.slice(0, 3).some(isContentBoxPercentageDimension);
  const verticalPercentage = rawDimensions.slice(3).some(isContentBoxPercentageDimension);
  const horizontalEdges = contentBoxEdgeSum(semanticComputed, [
    'padding-left',
    'padding-right',
    'border-left-width',
    'border-right-width'
  ]);
  const verticalEdges = contentBoxEdgeSum(semanticComputed, [
    'padding-top',
    'padding-bottom',
    'border-top-width',
    'border-bottom-width'
  ]);
  const hasPositivePercentageEdge = Boolean(
    (horizontalPercentage && null !== horizontalEdges && horizontalEdges > 0) ||
      (verticalPercentage && null !== verticalEdges && verticalEdges > 0)
  );
  if (!hasPositivePercentageEdge) return false;
  if (
    source.closest('svg, math, pre, code, table') ||
    visualRasterizationKind(source) ||
    hasVisualRasterizationAncestor(source) ||
    isKaTeXVisualNode(source) ||
    hasExcludedContentBoxParent(source, dimensionSemantics)
  )
    return false;
  return !(
    WECHAT_PNG_GENERATED_IMAGES.has(source) ||
    WECHAT_PNG_VISUAL_CLONES.has(source) ||
    THEME_IMAGE_CLONES.has(source) ||
    CODE_FRAME_PSEUDO_CLONES.has(source) ||
    CODE_FRAME_HEADER_CLONES.has(source) ||
    THEME_HEADING_SUFFIX_CLONES.has(source)
  );
}

export function contentBoxDimensionValue(
  property: string,
  value: string,
  source: Element,
  computed: CSSStyleDeclaration
): string {
  if (
    supportsSpecialLayout(source) ||
    !['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height'].includes(property) ||
    'content-box' !== computed.getPropertyValue('box-sizing').trim().toLowerCase()
  )
    return value;

  const dimension = finitePixelValue(value);
  const horizontal = property.endsWith('width');
  const extraProperties = horizontal
    ? ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']
    : ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'];
  const extra = extraProperties.reduce(
    (total, extraProperty) => total + (finitePixelValue(computed.getPropertyValue(extraProperty)) ?? 0),
    0
  );
  if (null === dimension) {
    const semantic = value.trim();
    if (!extra || 'auto' === semantic || 'none' === semantic) return value;
    if (/%|(?:^|\s)calc\(/i.test(semantic)) {
      return cssomProjectedDimensionValue(property, semantic, extra, source);
    }
    return value;
  }
  return `${dimension + extra}px`;
}

function taskCheckboxPseudoHasTextContent(pseudoElement: boolean, computedContent: string): boolean {
  if (!pseudoElement) return false;
  const content = pseudoContent(computedContent);
  return null !== content && '' !== content;
}

export function portableStyleValue(
  property: string,
  value: string,
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  computedContent = ''
): string {
  if ('font' === property)
    return taskCheckboxFontWithoutZeroLineHeight(
      source,
      value,
      taskCheckboxPseudoHasTextContent(pseudoElement, computedContent)
    );
  if ('box-sizing' === property && !supportsSpecialLayout(source) && 'content-box' === value.trim().toLowerCase())
    return 'border-box';
  if (['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height'].includes(property)) {
    return contentBoxDimensionValue(property, value, source, computed);
  }
  if ('text-align' !== property) return value;
  const normalized = value.trim().toLowerCase();
  if ('start' === normalized) return 'rtl' === sourceDirection(source, computed) ? 'right' : 'left';
  if ('end' === normalized) return 'rtl' === sourceDirection(source, computed) ? 'left' : 'right';
  return value;
}

export function keepStyle(
  property: string,
  value: string,
  source: Element,
  pseudoElement = false,
  root = false,
  sourceValue = value,
  omitDefaultValues = true,
  pseudoElementContent = ''
): boolean {
  if (
    taskCheckboxLineHeightIsZero(
      source,
      property,
      value,
      taskCheckboxPseudoHasTextContent(pseudoElement, pseudoElementContent)
    )
  )
    return false;
  const isTransparentBorderColor =
    property.endsWith('-color') &&
    property.startsWith('border-') &&
    ('rgba(0, 0, 0, 0)' === value || 'transparent' === value);
  if (!value || ('rgba(0, 0, 0, 0)' === value && 'color' !== property && !isTransparentBorderColor)) return false;
  if (root && 'display' === property && !['block', 'inline', 'table'].includes(value)) return false;
  const svgFragmentUrl = Boolean(source.closest('svg')) && /^url\(\s*["']?#[a-z\d:_.-]+["']?\s*\)$/i.test(value);
  const safeDataImageStyle = ['background', 'background-image'].includes(property) && hasOnlySafeDataImageUrls(value);
  if (UNSAFE_STYLE_VALUE.test(value) && !svgFragmentUrl && !safeDataImageStyle) return false;
  if ('display' === property && true !== SAFE_DISPLAY_VALUES[value]) return false;
  if ('container-type' === property && !['normal', 'size', 'inline-size', 'style'].includes(value)) return false;
  if ('float' === property && !['none', 'left', 'right', 'inline-start', 'inline-end'].includes(value)) return false;
  if ('clear' === property && !['none', 'left', 'right', 'both', 'inline-start', 'inline-end'].includes(value))
    return false;
  if ('position' === property && !['static', 'relative', 'absolute'].includes(value)) return false;
  const preservesInheritedDefault = PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES.has(property);
  if (omitDefaultValues && !preservesInheritedDefault && DEFAULT_STYLE_VALUES[property]?.has(value)) return false;
  if (pseudoElement && ['width', 'height'].includes(property)) {
    const sourceMatch = /^(\d+(?:\.\d+)?)(?:px|em|rem|%|cqi|cqw|cqb|cqh|cqmin|cqmax)$/.exec(sourceValue);
    const limit = 'width' === property ? 320 : 120;
    if (!sourceMatch || Number(sourceMatch[1]) > limit) return false;
    const normalizedMatch = /^(\d+(?:\.\d+)?)(?:px|em|rem|%|cqi|cqw|cqb|cqh|cqmin|cqmax)$/.exec(value);
    if (!normalizedMatch) return false;
  }
  return true;
}

export function portableStyleDeclaration(property: string, value: string, important = false): string {
  return `${property}:${value}${important || 'overflow-wrap' === property ? '!important' : ''}`;
}

export function hasSpecialLayoutAncestor(source: Element): boolean {
  let current = source.parentElement;
  while (current) {
    if (current.matches('svg, math, .katex, .easymde-math-block, .easymde-math-inline')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function semanticMarginSource(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement?: '::before' | '::after'
): boolean {
  const specialNode = source.matches('math, .katex, .easymde-math-block, .easymde-math-inline');
  if (pseudoElement) {
    return (
      !isSvgElement(source) &&
      !specialNode &&
      !hasSpecialLayoutAncestor(source) &&
      ['static', 'relative'].includes(computed.getPropertyValue('position').trim().toLowerCase())
    );
  }
  if ('svg' === source.localName.toLowerCase()) {
    return !hasSpecialLayoutAncestor(source);
  }
  return !isSvgElement(source) && !specialNode && !hasSpecialLayoutAncestor(source);
}

export function semanticMarginValue(
  property: string,
  source: Element,
  computed: CSSStyleDeclaration,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  pseudoElement?: '::before' | '::after',
  semanticComputed?: CSSStyleDeclaration | null
): string | null {
  if (!SEMANTIC_MARGIN_PROPERTIES.includes(property as (typeof SEMANTIC_MARGIN_PROPERTIES)[number])) {
    return null;
  }
  if (!dimensionSemantics || !semanticMarginSource(source, computed, pseudoElement)) return null;
  const semanticStyle =
    undefined !== semanticComputed ? semanticComputed : dimensionSemantics.getComputedStyle(source, pseudoElement);
  const semantic = semanticStyle?.getPropertyValue(property).trim();
  if ('auto' === semantic) return semantic;
  if (!semantic) return null;
  const percentage = CSS_PERCENTAGE_TOKEN.exec(semantic);
  if (!percentage || !Number.isFinite(Number(percentage[0].slice(0, -1)))) return null;
  return semantic;
}

export function semanticMarginSignature(
  source: Element,
  computed: CSSStyleDeclaration,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  pseudoElement?: '::before' | '::after',
  semanticComputed?: CSSStyleDeclaration | null
): string {
  if (!dimensionSemantics || !semanticMarginSource(source, computed, pseudoElement)) return '';
  const semantic =
    undefined !== semanticComputed ? semanticComputed : dimensionSemantics.getComputedStyle(source, pseudoElement);
  if (!semantic) return '';
  return SEMANTIC_MARGIN_PROPERTIES.map((property) => `${property}=${semantic.getPropertyValue(property).trim()}`).join(
    ';'
  );
}

export function rootExportComputedStyle(
  source: Element,
  computed: CSSStyleDeclaration,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElement?: string
): CSSStyleDeclaration {
  if (source.hasAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE)) return computed;
  return dimensionSemantics?.getRootComputedStyle(source, pseudoElement) ?? computed;
}

export function signatureStyleProperties(source: Element, root = false, pseudoElement = false): readonly string[] {
  const svg = isSvgElement(source);
  const special = supportsSpecialLayout(source);
  if (pseudoElement) {
    if (svg) return SIGNATURE_SVG_PSEUDO_PROPERTIES;
    if (special) return SIGNATURE_SPECIAL_PSEUDO_PROPERTIES;
    return root ? SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES : SIGNATURE_ORDINARY_PSEUDO_PROPERTIES;
  }
  if (svg) return SIGNATURE_SVG_PROPERTIES;
  if (special) return SIGNATURE_SPECIAL_PROPERTIES;
  return root ? SIGNATURE_ORDINARY_ROOT_PROPERTIES : SIGNATURE_ORDINARY_PROPERTIES;
}

export function removeTransientAttributes(clone: Element): void {
  for (const attribute of Array.from(clone.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim().replace(/\s+/g, '');
    const unsafeUrl =
      UNSAFE_URL.test(value) &&
      !(
        'data:' === value.slice(0, 5).toLowerCase() &&
        value.length <= MAX_DATA_IMAGE_LENGTH &&
        SAFE_DATA_IMAGE.test(value)
      );
    if (TRANSIENT_ATTRIBUTE.test(name) || (URL_ATTRIBUTES.has(name) && unsafeUrl)) {
      clone.removeAttribute(attribute.name);
    }
    if ('srcset' === name) {
      const candidates: string[] = [];
      let remainder = attribute.value.trim();
      while (remainder) {
        const dataMatch = /^(data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+)(?:\s+([^,]+))?(?:,|$)/i.exec(
          remainder
        );
        const separator = dataMatch ? -1 : remainder.indexOf(',');
        const candidate = (
          dataMatch
            ? dataMatch[1] + (dataMatch[2] ? ` ${dataMatch[2].trim()}` : '')
            : separator < 0
              ? remainder
              : remainder.slice(0, separator)
        ).trim();
        const nextOffset = dataMatch ? dataMatch[0].length : separator < 0 ? remainder.length : separator + 1;
        const candidateUrl = candidate.split(/\s+/, 1)[0] ?? '';
        if (
          '' !== candidateUrl &&
          (!UNSAFE_URL.test(candidateUrl) ||
            (SAFE_DATA_IMAGE.test(candidateUrl) && candidateUrl.length <= MAX_DATA_IMAGE_LENGTH))
        ) {
          candidates.push(candidate);
        }
        if (nextOffset >= remainder.length) break;
        remainder = remainder.slice(nextOffset).trim();
      }
      if (candidates.length) clone.setAttribute(attribute.name, candidates.join(', '));
      else clone.removeAttribute(attribute.name);
    }
  }
}

export function appendDeclarations(element: Element, declarations: string[], important = false): void {
  if (!declarations.length) return;
  const existing = element.getAttribute('style') ?? '';
  const normalized = important
    ? declarations.map((declaration) => (declaration.endsWith('!important') ? declaration : `${declaration}!important`))
    : declarations;
  element.setAttribute('style', [existing, ...normalized].filter(Boolean).join(';'));
}

export const CSS_PERCENTAGE_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%$/;

export function pseudoContent(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || 'none' === normalized || 'normal' === normalized) return null;
  const match = /^("|')([\s\S]*)\1$/.exec(normalized);
  const content = match?.[2];
  if (undefined === content) return null;
  return content.replace(/\\([\\"'])/g, '$1');
}

export function isHiddenPseudoPaint(computed: CSSStyleDeclaration): boolean {
  const display = computed.getPropertyValue('display').trim().toLowerCase();
  const visibility = computed.getPropertyValue('visibility').trim().toLowerCase();
  const contentVisibility = computed.getPropertyValue('content-visibility').trim().toLowerCase();
  const opacity = Number.parseFloat(computed.getPropertyValue('opacity'));
  return (
    'none' === display ||
    'hidden' === visibility ||
    'collapse' === visibility ||
    'hidden' === contentVisibility ||
    (Number.isFinite(opacity) && opacity <= 0)
  );
}

export function sourceDirection(source: Element, computed: CSSStyleDeclaration): 'ltr' | 'rtl' {
  const computedDirection = computed.getPropertyValue('direction').trim().toLowerCase();
  if ('rtl' === computedDirection) return 'rtl';
  if ('ltr' === computedDirection) return 'ltr';

  const declaredDirection = source.closest('[dir]')?.getAttribute('dir')?.trim().toLowerCase();
  if ('rtl' === declaredDirection) return 'rtl';
  if ('ltr' === declaredDirection) return 'ltr';

  const documentDirection = source.ownerDocument.documentElement?.getAttribute('dir')?.trim().toLowerCase();
  return 'rtl' === documentDirection ? 'rtl' : 'ltr';
}

export function supportsSpecialLayout(source: Element): boolean {
  return Boolean(source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline'));
}

export function generatedBlockImageAlignment(image: Element, owner: Element): void {
  const imageStyle = (image as Element & { style?: CSSStyleDeclaration }).style;
  const ownerStyle = (owner as Element & { style?: CSSStyleDeclaration }).style;
  if (!imageStyle || !ownerStyle || 'block' !== imageStyle.getPropertyValue('display').trim().toLowerCase()) {
    return;
  }
  const textAlign = ownerStyle.getPropertyValue('text-align').trim().toLowerCase();
  if ('center' === textAlign) {
    appendDeclarations(image, ['margin-left:auto', 'margin-right:auto'], true);
  } else if ('right' === textAlign || 'end' === textAlign) {
    appendDeclarations(image, ['margin-left:auto', 'margin-right:0'], true);
  } else if ('left' === textAlign || 'start' === textAlign) {
    appendDeclarations(image, ['margin-left:0', 'margin-right:auto'], true);
  }
}

export type PortableStyleDeclarationContext = Readonly<{
  computed: CSSStyleDeclaration;
  dimensionSemantics: WechatDimensionSemanticsContext | null;
  promoteContentBoxBounds: boolean;
  pseudoElement: boolean;
  pseudoElementName: '::before' | '::after' | undefined;
  root: boolean;
  semanticComputed: CSSStyleDeclaration | null;
  semanticMarginComputed: CSSStyleDeclaration | null;
  source: Element;
  style: CSSStyleDeclaration;
}>;

export function portableStyleProperties(source: Element, pseudoElement: boolean, root: boolean): readonly string[] {
  return [
    ...COPY_STYLE_PROPERTIES,
    ...(isTaskListCheckbox(source) && !pseudoElement ? TASK_LIST_CHECKBOX_STYLE_PROPERTIES : []),
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : root ? [] : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
}

export function createStyleDeclarationContext(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement: boolean,
  root: boolean,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after'
): PortableStyleDeclarationContext {
  const style = root && !pseudoElement ? rootExportComputedStyle(source, computed, dimensionSemantics) : computed;
  const semanticComputed =
    !pseudoElement && !supportsSpecialLayout(source)
      ? root
        ? style
        : dimensionSemantics?.getComputedStyle(source)
      : null;
  const semanticMarginComputed =
    dimensionSemantics && semanticMarginSource(source, computed, pseudoElement ? pseudoElementName : undefined)
      ? pseudoElement
        ? dimensionSemantics.getComputedStyle(source, pseudoElementName)
        : (semanticComputed ?? dimensionSemantics.getComputedStyle(source))
      : null;
  const promoteContentBoxBounds = isContentBoxPercentageProjectionCandidate(
    source,
    semanticComputed ?? null,
    dimensionSemantics ?? null,
    pseudoElement,
    root
  );
  return {
    computed,
    dimensionSemantics: dimensionSemantics ?? null,
    promoteContentBoxBounds,
    pseudoElement,
    pseudoElementName,
    root,
    semanticComputed: semanticComputed ?? null,
    semanticMarginComputed,
    source,
    style
  };
}

export function appendPortableStyleDeclaration(
  context: PortableStyleDeclarationContext,
  property: string,
  value: string,
  materializedValue: string,
  declarations: string[]
): void {
  const semanticCandidate = context.semanticComputed?.getPropertyValue(property).trim() ?? '';
  const semanticMarginCandidate = semanticMarginValue(
    property,
    context.source,
    context.computed,
    context.dimensionSemantics,
    context.pseudoElement ? context.pseudoElementName : undefined,
    context.semanticMarginComputed
  );
  const isOrdinaryDimension =
    !context.pseudoElement &&
    !supportsSpecialLayout(context.source) &&
    ORDINARY_DIMENSION_PROPERTIES.includes(property as (typeof ORDINARY_DIMENSION_PROPERTIES)[number]);
  const preserveRawContentBoxTuple = context.promoteContentBoxBounds && ('box-sizing' === property || isOrdinaryDimension);
  const sourceValue =
    preserveRawContentBoxTuple && semanticCandidate
      ? semanticCandidate
      : (semanticMarginCandidate ??
        (isOrdinaryDimension && semanticCandidate ? semanticCandidate : materializedValue));
  const pseudoElementContent = context.pseudoElement ? context.computed.getPropertyValue('content') : '';
  const normalizedValue = preserveRawContentBoxTuple
    ? sourceValue
    : portableStyleValue(
        property,
        sourceValue,
        context.source,
        context.style,
        context.pseudoElement,
        pseudoElementContent
      );
  if (
    keepStyle(
      property,
      normalizedValue,
      context.source,
      context.pseudoElement,
      context.root,
      value,
      true,
      pseudoElementContent
    )
  ) {
    declarations.push(
      portableStyleDeclaration(
        property,
        normalizedValue,
        context.promoteContentBoxBounds && CONTENT_BOX_PROMOTED_PROPERTIES.has(property)
      )
    );
  }
}

export const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

export const SAFE_DATA_IMAGE = /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i;

export const MAX_DATA_IMAGE_LENGTH = 4_000_000;

export function hasOnlySafeDataImageUrls(value: string): boolean {
  const matches = [...value.matchAll(CSS_URL)];
  return (
    matches.length > 0 &&
    matches.every((match) => SAFE_DATA_IMAGE.test((match[1] ?? match[2] ?? match[3] ?? '').trim()))
  );
}

export const WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE = 'data-easymde-wechat-export-style-context';

export const SIGNATURE_ORDINARY_ROOT_PROPERTIES = uniqueStyleProperties(COPY_STYLE_PROPERTIES, ['direction', 'position']);
export const SIGNATURE_ORDINARY_PROPERTIES = uniqueStyleProperties(COPY_STYLE_PROPERTIES, ORDINARY_LAYOUT_PROPERTIES, [
  'direction'
]);
export const SIGNATURE_SPECIAL_PROPERTIES = uniqueStyleProperties(COPY_STYLE_PROPERTIES, SPECIAL_LAYOUT_PROPERTIES, [
  'direction'
]);
export const SIGNATURE_SVG_PROPERTIES = uniqueStyleProperties(
  COPY_STYLE_PROPERTIES,
  SVG_STYLE_PROPERTIES,
  SPECIAL_LAYOUT_PROPERTIES,
  ['direction']
);
export const SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_ORDINARY_ROOT_PROPERTIES, [
  'content',
  'width',
  'height',
  'box-sizing'
]);
export const SIGNATURE_ORDINARY_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_ORDINARY_PROPERTIES, [
  'content',
  'width',
  'height'
]);
export const SIGNATURE_SPECIAL_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_SPECIAL_PROPERTIES, [
  'content',
  'width',
  'height'
]);
export const SIGNATURE_SVG_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_SVG_PROPERTIES, ['content', 'width', 'height']);

export const TASK_LIST_CHECKBOX_STYLE_PROPERTIES = [
  'appearance',
  '-webkit-appearance',
  '-moz-appearance',
  '-ms-appearance',
  'accent-color'
] as const;
