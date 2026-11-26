import {
  CODE_FRAME_PSEUDO_CLONES,
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
  GENERATED_PSEUDO_CLONE_OWNERS,
  HEADING_EMPTY_PSEUDO_FLOW_CLONES,
  INLINE_TEXT_MARKER_CLONES,
  TASK_LIST_CHECKBOX_PSEUDO_CLONES,
  TASK_LIST_CHECKBOX_SVG_PAINT,
  type WechatTreePredicateCache,
  isTaskListCheckbox
} from './wechat-clone-metadata';
import {
  type BackgroundAssetCache,
  appendThemeImages,
  dataImageLayersFromDeclarations,
  hasRepeatingBackground,
  materializeBackgroundValue,
  materializeBackgroundValueSynchronously,
  removeDataImageBackgroundDeclarations,
  type ThemeImageLayer
} from './wechat-background-images';
import {
  type BrowserWechatClipboardRuntime,
  type SerializationYield,
  throwIfBackgroundPreparationAborted
} from './wechat-clipboard-runtime';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import {
  HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS,
  type HeadingEmptyPseudoFlowCollector,
  type HeadingEmptyPseudoFlowExpectation,
  applyHeadingAfterEmptyPseudoFlow,
  applyHeadingEmptyPseudoFlow,
  generatedHeadingAfterBorderPaintIsVisible,
  generatedHeadingAfterContentIsEmpty,
  headingAfterEmptyPseudoFlowFor,
  headingEmptyPseudoFlowFor
} from './wechat-heading-pseudo-flow';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import {
  appendDeclarations,
  appendPortableStyleDeclaration,
  createStyleDeclarationContext,
  isHiddenPseudoPaint,
  portableStyleProperties,
  rootExportComputedStyle,
  supportsSpecialLayout
} from './wechat-style-policy';
import { pseudoContent } from './wechat-pseudo-content';
import {
  applyQuotePseudoFlow,
  captureQuotePseudoFlowSnapshot,
  type QuotePseudoFlowCollector,
  type QuotePseudoFlowPlanningSnapshot
} from './wechat-quote-pseudo-flow';
import {
  isTaskSvgPseudoContent,
  pseudoSvgContent,
  taskCheckboxStaticPaintExpectationFor,
  taskCheckboxStaticPaintProperties,
  taskCheckboxSvgPaintSignature,
  validateTaskCheckboxSvgPaint
} from './wechat-task-paint';

export {
  GENERATED_HEADING_AFTER_TRANSPORT_WHITESPACE,
  HEADING_EMPTY_PSEUDO_FLOW_EPSILON,
  HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS,
  type HeadingEmptyPseudoFlow,
  type HeadingEmptyPseudoFlowCollector,
  type HeadingEmptyPseudoFlowExpectation,
  applyHeadingEmptyPseudoFlow,
  assertHeadingEmptyPseudoFlows,
  generatedHeadingAfterBorderPaintIsVisible,
  generatedHeadingAfterContentIsEmpty,
  headingEmptyPseudoFinitePixel,
  headingEmptyPseudoFlowFor,
  headingEmptyPseudoFlowNumberMatches,
  headingEmptyPseudoPaintColorIsVisible,
  headingEmptyPseudoTransformOrNull,
  headingEmptyPseudoUsedTop,
  materializeHeadingAfterEmptyPseudoFlows
} from './wechat-heading-pseudo-flow';

export function inlineTextMarkerEligibility(
  source: Element,
  sourceComputed: CSSStyleDeclaration,
  pseudoComputed: CSSStyleDeclaration,
  predicates?: WechatTreePredicateCache
): boolean {
  if ('LI' !== source.tagName || source.closest('.task-list, .task-list-item')) return false;
  const content = pseudoContent(pseudoComputed.getPropertyValue('content'));
  const sourceDisplay = sourceComputed.getPropertyValue('display').trim().toLowerCase();
  const pseudoDisplay = pseudoComputed.getPropertyValue('display').trim().toLowerCase();
  const pseudoPosition = pseudoComputed.getPropertyValue('position').trim().toLowerCase();
  const pseudoFloat = pseudoComputed.getPropertyValue('float').trim().toLowerCase();
  const sourcePosition = sourceComputed.getPropertyValue('position').trim().toLowerCase();
  const sourceFloat = sourceComputed.getPropertyValue('float').trim().toLowerCase();
  const sourceTransform = sourceComputed.getPropertyValue('transform').trim().toLowerCase();
  const pseudoTransform = pseudoComputed.getPropertyValue('transform').trim().toLowerCase();
  const hasCounter = ['counter-reset', 'counter-increment', 'counter-set'].some((property) => {
    const value = pseudoComputed.getPropertyValue(property).trim().toLowerCase();
    return Boolean(value && 'none' !== value);
  });
  const hasImageOrMask = (computed: CSSStyleDeclaration): boolean => {
    const background = computed.getPropertyValue('background').trim().toLowerCase();
    return Boolean(
      computed.getPropertyValue('background-image').trim().toLowerCase().replace('none', '') ||
        computed.getPropertyValue('mask').trim().toLowerCase().replace('none', '') ||
        computed.getPropertyValue('mask-image').trim().toLowerCase().replace('none', '') ||
        /(?:url\(|gradient\()/u.test(background)
    );
  };
  return Boolean(
    null !== content &&
      '' !== content &&
      !isHiddenPseudoPaint(pseudoComputed) &&
      'inline' === pseudoDisplay &&
      'static' === pseudoPosition &&
      'none' === pseudoFloat &&
      'list-item' === sourceDisplay &&
      'static' === sourcePosition &&
      'none' === sourceFloat &&
      'none' === sourceTransform &&
      'none' === pseudoTransform &&
      !(predicates ? predicates.supportsSpecialLayout(source) : supportsSpecialLayout(source)) &&
      !hasImageOrMask(pseudoComputed) &&
      !hasImageOrMask(sourceComputed) &&
      !hasCounter
  );
}

export function inlineTextMarkerFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if ('LI' !== source.tagName) return '';
  const pseudo = runtime.getComputedStyle(source, '::before');
  const sourceStyle = runtime.getComputedStyle(source);
  const properties = [
    'content',
    'display',
    'position',
    'float',
    'opacity',
    'visibility',
    'content-visibility',
    'transform',
    'background',
    'background-image',
    'mask',
    'mask-image',
    'counter-reset',
    'counter-increment',
    'counter-set'
  ];
  const signature = (computed: CSSStyleDeclaration): string =>
    properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';');
  return `marker=${signature(pseudo)}:source=${signature(sourceStyle)}`;
}

export function isHiddenCodeFramePseudo(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string
): boolean {
  return 'PRE' === source.tagName && '::before' === pseudo && '' === content && isHiddenPseudoPaint(computed);
}

export function isCodeFramePseudo(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string
): boolean {
  if (isHiddenCodeFramePseudo(source, pseudo, computed, content)) return false;
  return (
    'PRE' === source.tagName &&
    '::before' === pseudo &&
    '' === content &&
    'absolute' === computed.getPropertyValue('position').trim().toLowerCase()
  );
}

export function isVisiblePaintedThemeHeadingSuffix(source: Element, computed: CSSStyleDeclaration): boolean {
  if (
    'SPAN' !== source.tagName ||
    !source.classList.contains('suffix') ||
    source.classList.length !== 1 ||
    source.childNodes.length !== 0
  )
    return false;
  const heading = source.parentElement;
  if (!heading || !['H1', 'H2', 'H3', 'H4'].includes(heading.tagName)) return false;
  const directElements = Array.from(heading.children);
  if (
    directElements.length !== 3 ||
    directElements[2] !== source ||
    directElements.some(
      (element, index) =>
        'SPAN' !== element.tagName ||
        element.classList.length !== 1 ||
        element.classList.contains(0 === index ? 'prefix' : 1 === index ? 'content' : 'suffix') === false
    )
  )
    return false;
  if (Array.from(heading.childNodes).some((node) => node.nodeType === 3 && node.nodeValue?.trim())) {
    return false;
  }
  const display = computed.getPropertyValue('display').trim().toLowerCase();
  const visibility = computed.getPropertyValue('visibility').trim().toLowerCase();
  if ('none' === display || ['hidden', 'collapse'].includes(visibility)) return false;
  const opacity = Number.parseFloat(computed.getPropertyValue('opacity'));
  if (Number.isFinite(opacity) && opacity <= 0) return false;
  const rect = source.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0)
    return false;
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const backgroundColor = computed.getPropertyValue('background-color').trim().toLowerCase();
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  const rgbaAlpha = /^rgba\([^)]*,\s*([^,)]+)\)$/u.exec(backgroundColor)?.[1];
  const slashAlpha = /\/\s*([^\s)]+)\s*\)$/u.exec(backgroundColor)?.[1];
  const alpha = rgbaAlpha ?? slashAlpha;
  const visibleBackgroundColor =
    'transparent' !== backgroundColor && (undefined === alpha || Number.parseFloat(alpha) > 0);
  return (
    (Boolean(backgroundImage) && 'none' !== backgroundImage) ||
    (Boolean(backgroundColor) && visibleBackgroundColor) ||
    /(?:url\(|gradient\()/u.test(background)
  );
}

export function isGeneratedEmptyHeadingAfter(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string,
  portableDeclarations: readonly string[],
  imageLayers: readonly ThemeImageLayer[],
  root: boolean
): boolean {
  if (
    root ||
    '::after' !== pseudo ||
    !['H1', 'H2', 'H3', 'H4'].includes(source.tagName) ||
    source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline') ||
    !generatedHeadingAfterContentIsEmpty(content)
  )
    return false;
  const display = computed.getPropertyValue('display').trim().toLowerCase();
  const position = computed.getPropertyValue('position').trim().toLowerCase();
  const visibility = computed.getPropertyValue('visibility').trim().toLowerCase();
  const opacity = Number.parseFloat(computed.getPropertyValue('opacity'));
  const width = finiteCssPixelValue(computed.getPropertyValue('width'));
  const height = finiteCssPixelValue(computed.getPropertyValue('height'));
  if (
    'block' !== display ||
    !['static', 'relative'].includes(position) ||
    'visible' !== visibility ||
    (Number.isFinite(opacity) && opacity <= 0) ||
    null === width ||
    null === height ||
    width <= 0 ||
    height <= 0
  )
    return false;
  const hasPortableDeclaration = (property: string): boolean =>
    portableDeclarations.some((declaration) => declaration.startsWith(`${property}:`));
  if (!hasPortableDeclaration('width') || !hasPortableDeclaration('height')) return false;
  if (imageLayers.length > 0) return true;
  const paint = source.ownerDocument.createElement('span').style;
  portableDeclarations.forEach((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0) return;
    const property = declaration.slice(0, separator);
    if (!['background', 'background-image', 'background-color'].includes(property)) return;
    paint.setProperty(property, declaration.slice(separator + 1));
  });
  const backgroundImage = paint.getPropertyValue('background-image').trim().toLowerCase();
  const backgroundColor = paint.getPropertyValue('background-color').trim().toLowerCase();
  const rgbaAlpha = /^rgba\([^)]*,\s*([^,)]+)\)$/u.exec(backgroundColor)?.[1];
  const slashAlpha = /\/\s*([^\s)]+)\s*\)$/u.exec(backgroundColor)?.[1];
  const alpha = rgbaAlpha ?? slashAlpha;
  const visibleBackgroundColor =
    Boolean(backgroundColor) &&
    'transparent' !== backgroundColor &&
    (undefined === alpha || Number.parseFloat(alpha) > 0);
  return (
    /(?:url\(|gradient\()/u.test(backgroundImage) ||
    visibleBackgroundColor ||
    generatedHeadingAfterBorderPaintIsVisible(computed, portableDeclarations)
  );
}

export async function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after',
  predicates?: WechatTreePredicateCache
): Promise<string[]> {
  const context = createStyleDeclarationContext(
    source,
    computed,
    pseudoElement,
    root,
    dimensionSemantics,
    pseudoElementName,
    predicates
  );
  const properties = portableStyleProperties(source, pseudoElement, root, {
    specialLayout: context.specialLayout,
    svg: context.svg,
    taskCheckbox: context.taskCheckbox
  });
  const declarations: string[] = [];
  for (const property of properties) {
    throwIfBackgroundPreparationAborted(signal);
    const value = context.style.getPropertyValue(property);
    const materializedValue =
      ('background' === property || 'background-image' === property) && value.includes('url(')
        ? await materializeBackgroundValue(property, value, runtime, cache, signal)
        : value;
    throwIfBackgroundPreparationAborted(signal);
    appendPortableStyleDeclaration(context, property, value, materializedValue, declarations);
    if (yieldToBrowser?.shouldYield()) await yieldToBrowser();
  }
  return declarations;
}

export function styleDeclarationsSynchronously(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement: boolean,
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after',
  predicates?: WechatTreePredicateCache
): string[] | null {
  const context = createStyleDeclarationContext(
    source,
    computed,
    pseudoElement,
    root,
    dimensionSemantics,
    pseudoElementName,
    predicates
  );
  const properties = portableStyleProperties(source, pseudoElement, root, {
    specialLayout: context.specialLayout,
    svg: context.svg,
    taskCheckbox: context.taskCheckbox
  });
  const declarations: string[] = [];
  for (const property of properties) {
    const value = context.style.getPropertyValue(property);
    const materializedValue = materializeBackgroundValueSynchronously(property, value, runtime);
    if (null === materializedValue) return null;
    appendPortableStyleDeclaration(context, property, value, materializedValue, declarations);
  }
  return declarations;
}

type PseudoCandidate = Readonly<{
  computed: CSSStyleDeclaration;
  hiddenSvgPaint: boolean;
  rawContent: string;
  skip: boolean;
  svgContent: SVGSVGElement | null;
  textContent: string;
}>;

export function readPseudoCandidate(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  dimensionSemantics?: WechatDimensionSemanticsContext | null
): PseudoCandidate {
  const computed = root
    ? rootExportComputedStyle(source, getComputedStyle(source, pseudo), dimensionSemantics, pseudo)
    : getComputedStyle(source, pseudo);
  const rawContent = computed.getPropertyValue('content');
  const content = pseudoContent(rawContent);
  const taskSvgPseudo = isTaskSvgPseudoContent(source, rawContent);
  const svgContent = null === content && taskSvgPseudo ? pseudoSvgContent(rawContent, clone.ownerDocument) : null;
  if (taskSvgPseudo && !svgContent && !isHiddenPseudoPaint(computed)) {
    throw new Error('wechat-task-checkbox-svg-pseudo-invalid');
  }
  if (null === content && !svgContent) {
    return { computed, hiddenSvgPaint: false, rawContent, skip: true, svgContent: null, textContent: '' };
  }
  return {
    computed,
    hiddenSvgPaint: Boolean(svgContent && isHiddenPseudoPaint(computed)),
    rawContent,
    skip: false,
    svgContent,
    textContent: content ?? ''
  };
}

export function pseudoCandidateIsPaintable(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  textContent: string
): boolean {
  if ('' !== textContent && isHiddenPseudoPaint(computed)) return false;
  return !isHiddenCodeFramePseudo(source, pseudo, computed, textContent);
}

export function registerPseudoPaintExpectation(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  svgContent: SVGSVGElement | null,
  textContent: string
): void {
  if (!isTaskListCheckbox(source)) return;
  const svgPaintSignature = svgContent ? taskCheckboxSvgPaintSignature(svgContent) : null;
  if (svgContent && !svgPaintSignature) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  taskCheckboxStaticPaintExpectationFor(clone).pseudos.set(pseudo, {
    kind: svgContent ? 'svg' : 'text',
    properties: taskCheckboxStaticPaintProperties(computed),
    requiresText: !svgContent && '' !== textContent,
    svgPaintSignature
  });
}

export function createPseudoMarker(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  textContent: string,
  svgContent: SVGSVGElement | null,
  declarations: string[],
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
  predicates?: WechatTreePredicateCache
): Element | null {
  if (!textContent && !declarations.length && !svgContent) return null;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const appendedImageLayers = preserveRepeatingBackground ? [] : imageLayers;
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations, preserveRepeatingBackground);
  const taskPaintOnlyPseudo = isTaskListCheckbox(source) && !textContent && !appendedImageLayers.length && !svgContent;
  const headingEmptyPseudoFlow =
    headingEmptyPseudoFlowFor(source, pseudo, computed, textContent, getComputedStyle, root) ??
    headingAfterEmptyPseudoFlowFor(source, pseudo, computed, textContent, getComputedStyle, portableDeclarations, root);
  if (!textContent && !taskPaintOnlyPseudo && 'after' !== headingEmptyPseudoFlow?.kind) {
    portableDeclarations.push('font-size:0');
  }
  const generatedEmptyHeadingSuffix = isGeneratedEmptyHeadingAfter(
    source,
    pseudo,
    computed,
    textContent,
    portableDeclarations,
    imageLayers,
    root
  );
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  GENERATED_PSEUDO_CLONE_OWNERS.set(marker, { owner: clone, pseudo });
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, pseudo);
  }
  // WeChat drops completely empty decoration spans during paste. A layout-time
  // whitespace marker keeps CSS-only decorations measurable and present.
  // finalizeMarkup replaces that text inside task paint-only markers with an
  // in-span U+2060 after static-flow geometry is captured; other empty
  // decorations keep their own transport policy without changing that allocation.
  marker.textContent = textContent || (appendedImageLayers.length || svgContent ? '' : ' ');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  let outputMarker: Element = marker;
  if (headingEmptyPseudoFlow) {
    if ('before' === headingEmptyPseudoFlow.kind) applyHeadingEmptyPseudoFlow(clone, marker, headingEmptyPseudoFlow);
    else outputMarker = applyHeadingAfterEmptyPseudoFlow(clone, marker, headingEmptyPseudoFlow);
    HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(marker);
    const expectation: HeadingEmptyPseudoFlowExpectation = {
      cloneHeading: clone,
      flow: headingEmptyPseudoFlow,
      marker: outputMarker,
      paint: marker,
      source
    };
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(outputMarker, expectation);
    headingFlowCollector?.expectations.push(expectation);
  }
  if (svgContent) {
    // CSS `content:url(...)` paints at the top of the source pseudo box. The
    // portable SVG is nested inside an inline marker span; pin that span to
    // the same line-box edge so the check mark does not drift onto the
    // baseline when WeChat lays out the copied tree.
    if (isTaskListCheckbox(source)) appendDeclarations(marker, ['vertical-align:top'], true);
    appendDeclarations(svgContent, ['display:block', 'width:100%', 'height:100%'], true);
    marker.appendChild(svgContent);
  }
  if ('::before' === pseudo && inlineTextMarkerEligibility(source, getComputedStyle(source), computed, predicates)) {
    INLINE_TEXT_MARKER_CLONES.add(marker);
  }
  if (isCodeFramePseudo(source, pseudo, computed, textContent)) {
    CODE_FRAME_PSEUDO_CLONES.add(marker);
  }
  if (generatedEmptyHeadingSuffix || headingEmptyPseudoFlow) {
    GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(marker);
  }
  appendThemeImages(marker, appendedImageLayers, computed, !textContent);
  return outputMarker;
}

export function insertPseudoMarker(clone: Element, marker: Element, pseudo: '::before' | '::after'): void {
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

function quoteFlowSnapshotIfEligible(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  dimensionSemantics: WechatDimensionSemanticsContext | null | undefined,
  textContent: string
): QuotePseudoFlowPlanningSnapshot | null {
  if (
    '::before' !== pseudo ||
    !['BLOCKQUOTE', 'SECTION'].includes(source.tagName) ||
    !textContent ||
    'block' !== computed.getPropertyValue('display').trim().toLowerCase() ||
    'absolute' !== computed.getPropertyValue('position').trim().toLowerCase()
  ) {
    return null;
  }
  return captureQuotePseudoFlowSnapshot({
    clone,
    dimensionSemantics: dimensionSemantics ?? null,
    getComputedStyle,
    pseudo,
    pseudoComputed: computed,
    source
  });
}

function applyQuoteFlowIfEligible(
  clone: Element,
  marker: Element,
  snapshot: QuotePseudoFlowPlanningSnapshot | null,
  collector: QuotePseudoFlowCollector | undefined
): void {
  if (!snapshot || !(marker instanceof HTMLElement)) return;
  applyQuotePseudoFlow(clone, marker, snapshot.plan(marker), collector);
}

export async function addPseudoElement(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
  quoteFlowCollector?: QuotePseudoFlowCollector,
  predicates?: WechatTreePredicateCache
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  const candidate = readPseudoCandidate(source, clone, pseudo, getComputedStyle, root, dimensionSemantics);
  if (candidate.skip || candidate.hiddenSvgPaint) return;
  const { computed, rawContent, svgContent, textContent } = candidate;
  if (!pseudoCandidateIsPaintable(source, pseudo, computed, textContent)) return;
  const quoteSnapshot = quoteFlowSnapshotIfEligible(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    dimensionSemantics,
    textContent
  );
  if (svgContent) await validateTaskCheckboxSvgPaint(source, rawContent, svgContent, signal);
  registerPseudoPaintExpectation(source, clone, pseudo, computed, svgContent, textContent);
  const declarations = await styleDeclarations(
    source,
    computed,
    true,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal,
    dimensionSemantics,
    pseudo,
    predicates
  );
  throwIfBackgroundPreparationAborted(signal);
  const marker = createPseudoMarker(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    root,
    textContent,
    svgContent,
    declarations,
    headingFlowCollector,
    predicates
  );
  if (!marker) return;
  throwIfBackgroundPreparationAborted(signal);
  insertPseudoMarker(clone, marker, pseudo);
  applyQuoteFlowIfEligible(clone, marker, quoteSnapshot, quoteFlowCollector);
}

export function addPseudoElementSynchronously(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
  quoteFlowCollector?: QuotePseudoFlowCollector,
  predicates?: WechatTreePredicateCache
): boolean {
  const candidate = readPseudoCandidate(source, clone, pseudo, getComputedStyle, root, dimensionSemantics);
  if (candidate.skip || candidate.hiddenSvgPaint) return true;
  const { computed, rawContent, svgContent, textContent } = candidate;
  if (!pseudoCandidateIsPaintable(source, pseudo, computed, textContent)) return true;
  const quoteSnapshot = quoteFlowSnapshotIfEligible(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    dimensionSemantics,
    textContent
  );
  if (svgContent && TASK_LIST_CHECKBOX_SVG_PAINT.get(source) !== rawContent) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  registerPseudoPaintExpectation(source, clone, pseudo, computed, svgContent, textContent);
  const declarations = styleDeclarationsSynchronously(
    source,
    computed,
    true,
    root,
    runtime,
    dimensionSemantics,
    pseudo,
    predicates
  );
  if (null === declarations) return false;
  const marker = createPseudoMarker(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    root,
    textContent,
    svgContent,
    declarations,
    headingFlowCollector,
    predicates
  );
  if (!marker) return true;
  insertPseudoMarker(clone, marker, pseudo);
  applyQuoteFlowIfEligible(clone, marker, quoteSnapshot, quoteFlowCollector);
  return true;
}
