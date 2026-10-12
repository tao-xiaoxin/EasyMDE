import type { ImageUploadFailureSideEffects, ImageUploadPort } from '../../../contracts/ports/image-upload-port';
import { SVGPathData } from 'svg-pathdata';
import type {
  WechatClipboardCopyOptions,
  WechatClipboardPort,
  WechatClipboardPreparationOptions,
  WechatClipboardResult
} from '../../../contracts/ports/wechat-clipboard-port';
import type {
  WechatVisualRasterizationKind,
  WechatVisualRasterizationMermaidCapture,
  WechatVisualRasterizationMermaidLayoutRole,
  WechatVisualRasterizationPort,
  WechatVisualRasterizationResult,
  WechatVisualRasterizationYield
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import { splitCssList } from './wechat-css-list';
import {
  type WechatTimingHandle,
  type WechatTimingMetadata,
  type WechatTimingMode,
  beginWechatTiming,
  runWechatSyncTiming
} from './wechat-timing';

const COPY_STYLE_PROPERTIES = [
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

const SVG_STYLE_PROPERTIES = [
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

const SPECIAL_LAYOUT_PROPERTIES = [
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
const ORDINARY_LAYOUT_PROPERTIES = [
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
const ORDINARY_DIMENSION_PROPERTIES = [
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height'
] as const;
const SEMANTIC_MARGIN_PROPERTIES = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const;
const CSS_PERCENTAGE_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%$/;
const WECHAT_TOPIC_STOP_CHARACTER = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|[\u3000-\u303F\uFF00-\uFFEF]/;
const NATIVE_LAYOUT_PROPERTIES = ['table-layout'] as const;
const TASK_LIST_CHECKBOX_STYLE_PROPERTIES = [
  'appearance',
  '-webkit-appearance',
  '-moz-appearance',
  '-ms-appearance',
  'accent-color'
] as const;

const KATEX_VISUAL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal',
  'max-width:none'
] as const;
const MERMAID_LABEL_LAYOUT_DECLARATIONS = ['white-space:nowrap', 'word-break:normal', 'overflow-wrap:normal'] as const;
const MERMAID_LABEL_WIDTH_SCALE = 1.5;
const MERMAID_LABEL_WIDTH_GUTTER = 32;
const BACKGROUND_PREPARATION_QUIET_DELAY_MS = 120;
const BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS = 8;
export const MAX_WECHAT_PNG_VISUALS = 32;
export const MAX_WECHAT_PNG_DIMENSION = 4096;
export const MAX_WECHAT_PNG_PIXELS = 16_777_216;
export const MAX_WECHAT_PNG_TOTAL_PIXELS = 33_554_432;
export const MAX_WECHAT_PNG_TOTAL_BYTES = 33_554_432;
export const MAX_WECHAT_PNG_UPLOAD_CONCURRENCY = 3;
export const WECHAT_PNG_RASTERIZATION_TIMEOUT_MS = 10_000;
export const WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS = 60_000;
export const WECHAT_PNG_TRANSACTION_TIMEOUT_MS = WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS;

const SAFE_DISPLAY_VALUES: Record<string, true> = {
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
const SVG_DEFINITION_TAGS = new Set([
  'clippath',
  'filter',
  'lineargradient',
  'marker',
  'mask',
  'pattern',
  'radialgradient',
  'symbol'
]);

const TRANSIENT_ATTRIBUTE = /^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;
const REFRESH_ONLY_PREVIEW_ATTRIBUTES = [
  'aria-busy',
  'data-easymde-preview-accepted',
  'data-easymde-preview-refreshing'
] as const;
const WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE = 'data-easymde-wechat-export-style-context';
const WECHAT_IGNORE_WIDTH_ATTRIBUTE = 'data-ignore-width';
const UNSAFE_STYLE_VALUE =
  /(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;
const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);
const SAFE_DATA_IMAGE = /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i;
const MAX_DATA_IMAGE_LENGTH = 4_000_000;
const THEME_IMAGE_PATH = /\/assets\/images\/[a-z\d._/-]+\.(?:gif|jpe?g|png|webp)$/i;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const HAS_CSS_URL = /url\s*\(/i;
const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
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
const PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES = new Set([
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
const KATEX_VISUAL_ROOTS = new WeakSet<Element>();
const KATEX_VISUAL_NODES = new WeakSet<Element>();
const MATH_BLOCK_ROOTS = new WeakSet<Element>();
const MERMAID_SVG_ROOTS = new WeakSet<Element>();
const MERMAID_FOREIGN_OBJECTS = new WeakSet<Element>();
const THEME_IMAGE_CLONES = new WeakSet<Element>();
type WechatThemeImageClone = Readonly<{
  owner: Element;
  layerIndex: number;
  slot: 'leading' | 'trailing';
}>;
const THEME_IMAGE_CLONE_OWNERS = new WeakMap<Element, WechatThemeImageClone>();
type WechatGeneratedPseudoClone = Readonly<{
  owner: Element;
  pseudo: '::before' | '::after';
}>;
const GENERATED_PSEUDO_CLONE_OWNERS = new WeakMap<Element, WechatGeneratedPseudoClone>();
const HIDDEN_NODES = new WeakSet<Element>();
const TASK_LIST_CHECKBOX_CLONES = new WeakSet<Element>();
const TASK_LIST_CHECKBOX_STATES = new WeakMap<Element, Readonly<{ checked: boolean }>>();
const TASK_LIST_CHECKBOX_PSEUDO_CLONES = new WeakMap<Element, '::before' | '::after'>();
type TaskCheckboxStaticPseudoPaintExpectation = Readonly<{
  kind: 'text' | 'svg';
  properties: readonly string[];
  requiresText: boolean;
  svgPaintSignature: string | null;
}>;
type TaskCheckboxStaticPaintExpectation = {
  baseProperties: readonly string[];
  pseudos: Map<'::before' | '::after', TaskCheckboxStaticPseudoPaintExpectation>;
};
const TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS = new WeakMap<Element, TaskCheckboxStaticPaintExpectation>();
const TASK_LIST_CHECKBOX_SVG_PAINT = new WeakMap<Element, string>();
const FULL_WIDTH_TABLE_CLONES = new WeakSet<Element>();
type TableScrollOwnerMetadata = Readonly<{
  borderCollapse: 'separate';
  overflowX: 'hidden' | 'clip';
  overflowY: 'hidden' | 'clip';
  radiusEligible: true;
}>;
const TABLE_SCROLL_OWNER_METADATA = new WeakMap<Element, TableScrollOwnerMetadata>();
const TABLE_HEADER_BACKGROUND_METADATA = new WeakMap<Element, string | null>();
const WECHAT_PNG_GENERATED_IMAGES = new WeakSet<Element>();
const GENERATED_EMPTY_HEADING_SUFFIX_CLONES = new WeakSet<Element>();
const FULL_WIDTH_TABLE_SOURCE_LAYOUT = new WeakMap<Element, boolean>();
const FULL_WIDTH_TABLE_ROOT_LAYOUT = new WeakMap<HTMLElement, Map<number, boolean>>();
const PREVIEW_MEASUREMENT_WIDTHS = new WeakMap<HTMLElement, number>();
const THEME_HEADING_SUFFIX_CLONES = new WeakSet<Element>();
const HEADING_EMPTY_PSEUDO_FLOW_CLONES = new WeakSet<Element>();
const EXPORT_TEXT_NORMALIZATIONS = new WeakMap<
  HTMLElement,
  Map<Text, Readonly<{ original: string; encoded: string }>>
>();
const LIST_MARKER_PROBE_ATTRIBUTE = 'data-easymde-wechat-list-marker-probe';
const LIST_MARKER_PROBE_ANCHOR_ATTRIBUTE = 'data-easymde-wechat-list-marker-anchor';
const LIST_MARKER_NATIVE_TYPES = new Set([
  'circle',
  'decimal',
  'decimal-leading-zero',
  'disc',
  'lower-alpha',
  'lower-latin',
  'lower-roman',
  'square',
  'upper-alpha',
  'upper-latin',
  'upper-roman'
]);
const LIST_MARKER_FONT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height'
] as const;
type ListMarkerGutterMetadata = Readonly<{ gutter: number; signature: string }>;

function clipboardTaskCheckboxState(preview: HTMLElement): string {
  return Array.from(preview.querySelectorAll('input'))
    .filter(isTaskListCheckbox)
    .map((input) => ((input as HTMLInputElement).checked ? '1' : '0'))
    .join(',');
}

function clipboardSourceMarkup(preview: HTMLElement): string {
  // Root refresh bookkeeping is not source content; descendants still are.
  // Clone only the root to avoid a full DOM clone on each long-document check.
  const source = preview.cloneNode(false) as HTMLElement;
  REFRESH_ONLY_PREVIEW_ATTRIBUTES.forEach((attribute) => {
    source.removeAttribute(attribute);
  });
  return JSON.stringify([source.outerHTML, preview.innerHTML, clipboardTaskCheckboxState(preview)]);
}

type ClipboardSourceFreshnessGuard = Readonly<{
  dispose: () => void;
  finalize: () => boolean;
  isCurrent: () => boolean;
}>;

function createClipboardSourceFreshnessGuard(preview: HTMLElement): ClipboardSourceFreshnessGuard {
  const MutationObserverConstructor =
    preview.ownerDocument.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if ('function' !== typeof MutationObserverConstructor) {
    throw new Error('wechat-copy-freshness-observer-unavailable');
  }

  let dirty = false;
  let disposed = false;
  let stale = false;
  let sourceMarkup = '';
  let sourceTaskCheckboxState = '';
  const isMeaningfulMutation = (record: MutationRecord): boolean =>
    !(
      'attributes' === record.type &&
      record.target === preview &&
      'string' === typeof record.attributeName &&
      REFRESH_ONLY_PREVIEW_ATTRIBUTES.includes(record.attributeName as (typeof REFRESH_ONLY_PREVIEW_ATTRIBUTES)[number])
    );
  const recordMutations = (records: readonly MutationRecord[]): void => {
    if (records.some(isMeaningfulMutation)) dirty = true;
  };
  const observer = new MutationObserverConstructor((records) => {
    recordMutations(records);
  });

  try {
    observer.observe(preview, { attributes: true, characterData: true, childList: true, subtree: true });
    sourceMarkup = clipboardSourceMarkup(preview);
    sourceTaskCheckboxState = clipboardTaskCheckboxState(preview);
    recordMutations(observer.takeRecords());
    if (dirty) {
      stale = clipboardSourceMarkup(preview) !== sourceMarkup;
      dirty = false;
      recordMutations(observer.takeRecords());
    }
  } catch (error: unknown) {
    observer.disconnect();
    throw error;
  }

  const refreshPendingMutations = (): void => {
    if (disposed) return;
    recordMutations(observer.takeRecords());
  };
  const isCurrent = (): boolean => {
    refreshPendingMutations();
    if (stale) return false;
    const currentTaskCheckboxState = clipboardTaskCheckboxState(preview);
    if (!dirty && currentTaskCheckboxState === sourceTaskCheckboxState) return true;
    const currentMarkup = clipboardSourceMarkup(preview);
    dirty = false;
    stale = currentMarkup !== sourceMarkup;
    return !stale;
  };
  const finalize = (): boolean => {
    refreshPendingMutations();
    if (stale) return false;
    const currentMarkup = clipboardSourceMarkup(preview);
    dirty = false;
    stale = currentMarkup !== sourceMarkup;
    return !stale;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
  };
  return { dispose, finalize, isCurrent };
}

const WECHAT_PNG_VISUAL_CLONES = new WeakMap<
  Element,
  Readonly<{ kind: WechatVisualRasterizationKind; source: Element }>
>();
const CODE_FRAME_PSEUDO_CLONES = new WeakSet<Element>();
const CODE_FRAME_HEADER_CLONES = new WeakSet<Element>();
const INLINE_TEXT_MARKER_CLONES = new WeakSet<Element>();

const PREPARED_PSEUDO_ELEMENTS = ['::before', '::after'] as const;

function uniqueStyleProperties(...groups: ReadonlyArray<ReadonlyArray<string>>): string[] {
  return [...new Set(groups.flat())];
}

const SIGNATURE_ORDINARY_ROOT_PROPERTIES = uniqueStyleProperties(COPY_STYLE_PROPERTIES, ['direction', 'position']);
const SIGNATURE_ORDINARY_PROPERTIES = uniqueStyleProperties(COPY_STYLE_PROPERTIES, ORDINARY_LAYOUT_PROPERTIES, [
  'direction'
]);
const SIGNATURE_SPECIAL_PROPERTIES = uniqueStyleProperties(COPY_STYLE_PROPERTIES, SPECIAL_LAYOUT_PROPERTIES, [
  'direction'
]);
const SIGNATURE_SVG_PROPERTIES = uniqueStyleProperties(
  COPY_STYLE_PROPERTIES,
  SVG_STYLE_PROPERTIES,
  SPECIAL_LAYOUT_PROPERTIES,
  ['direction']
);
const SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_ORDINARY_ROOT_PROPERTIES, [
  'content',
  'width',
  'height',
  'box-sizing'
]);
const SIGNATURE_ORDINARY_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_ORDINARY_PROPERTIES, [
  'content',
  'width',
  'height'
]);
const SIGNATURE_SPECIAL_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_SPECIAL_PROPERTIES, [
  'content',
  'width',
  'height'
]);
const SIGNATURE_SVG_PSEUDO_PROPERTIES = uniqueStyleProperties(SIGNATURE_SVG_PROPERTIES, ['content', 'width', 'height']);
const ROOT_EXPORT_STYLE_PROPERTIES = new Set(
  uniqueStyleProperties(
    COPY_STYLE_PROPERTIES,
    ORDINARY_LAYOUT_PROPERTIES,
    SPECIAL_LAYOUT_PROPERTIES,
    SVG_STYLE_PROPERTIES,
    ['content', 'direction', 'box-sizing', 'visibility', 'content-visibility', 'width', 'height']
  )
);

export type ClipboardItemConstructor = new (payload: Record<string, Blob>) => unknown;

export type BrowserWechatClipboardRuntime = Readonly<{
  blob: typeof Blob;
  clipboardItem: ClipboardItemConstructor | null;
  document: Document;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getComputedStyle: (element: Element, pseudoElement?: string) => CSSStyleDeclaration;
  getSelection: () => Selection | null;
  pageOffset: () => Readonly<{ x: number; y: number }>;
  scrollTo: (x: number, y: number) => void;
  write: ((items: unknown[]) => Promise<void>) | null;
}>;

type BackgroundAssetCache = Map<string, Promise<string>>;
const MAX_BACKGROUND_ASSET_CACHE_ENTRIES = 32;
const THEME_IMAGE_FETCH_TIMEOUT_MS = 10_000;
export const CLIPBOARD_COMMIT_TIMEOUT_MS = 10_000;
type ThemeImageLayer = Readonly<{ src: string; layerIndex: number }>;

type SerializedClipboardPayload = Readonly<{ html: string; text: string }>;

type WechatPngConversionState = { uploadsMayRemain: boolean };

type WechatPreviewMeasurementLease = Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  measurementFor: (source: Element) => Element | null;
  ready: Promise<void>;
  root: HTMLElement;
  sourceGeometryReference: 'measurement' | 'source';
  sourceMarkup: string;
  sourceFor: (measurement: Element) => Element | null;
  sourceRoot: HTMLElement;
  sourceWidthKey: number | null;
  wait: () => Promise<void>;
}>;

type WechatMeasurementImagePair = Readonly<{ measurement: HTMLImageElement; source: HTMLImageElement }>;

type WechatMeasurementElementPairing = Readonly<{
  byMeasurement: WeakMap<Element, Element>;
  bySource: WeakMap<Element, Element>;
  imagePairs: readonly WechatMeasurementImagePair[];
}>;

type TaskCheckboxGeometryLease = Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  measurementFor: (source: Element) => Element | null;
  ready: Promise<void>;
  root: HTMLElement;
  scopeRoot: HTMLElement;
  sourceGeometryReference: 'measurement' | 'source';
  sourceMarkup: string;
  sourceFor: (measurement: Element) => Element | null;
  sourceRoot: HTMLElement;
  sourceWidthKey: number | null;
  wait: () => Promise<void>;
}>;

type TaskCheckboxGeometryContext = Readonly<{
  cleanup: () => void;
  validate: (source: Element, clone: Element, computed: CSSStyleDeclaration) => void;
}>;

type WechatPreviewTransitionLease = Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  ready: Promise<void>;
  wait: () => Promise<void>;
}>;

type WechatDimensionSemanticsContext = Readonly<{
  cleanup: () => void;
  getComputedStyle: (source: Element, pseudoElement?: string) => CSSStyleDeclaration | null;
  getFormattingOwnerDisplay: (source: Element) => string | null;
  getRootComputedStyle: (source: Element, pseudoElement?: string) => CSSStyleDeclaration | null;
  refresh: () => void;
}>;

type WechatPngConversionContext = Readonly<{
  captureBoundary: HTMLElement;
  imageUploadPort: ImageUploadPort;
  isCurrent?: () => boolean;
  maxBytes: number;
  mermaidAutoMarginSnapshots: Map<Element, boolean>;
  mermaidCaptureChoiceSnapshots: Map<Element, WechatMermaidCaptureChoiceSnapshot>;
  mermaidResponsiveSnapshots: Map<Element, MermaidResponsiveViewportSnapshot>;
  postId: number;
  rasterizationPort: WechatVisualRasterizationPort;
  scale: number;
  signal: AbortSignal;
  state: WechatPngConversionState;
}>;

type WechatPngFailureStage =
  | 'capture'
  | 'inline-validation'
  | 'intrinsic-gate'
  | 'layout'
  | 'rasterization'
  | 'result-validation';

type WechatPngFailureDiagnostic = Readonly<{
  candidate: number;
  height: number | null;
  kind: WechatVisualRasterizationKind;
  originalCode: string;
  stage: WechatPngFailureStage;
  width: number | null;
}>;

class WechatPngConversionError extends Error {
  readonly code:
    | 'wechat-png-limit-exceeded'
    | 'wechat-png-rasterization-cancelled'
    | 'wechat-png-rasterization-failed'
    | 'wechat-png-rasterization-timeout'
    | 'wechat-png-transaction-timeout'
    | 'wechat-png-upload-failed'
    | 'wechat-png-upload-nonce-invalid';
  readonly diagnostic: WechatPngFailureDiagnostic | undefined;

  constructor(code: WechatPngConversionError['code'], diagnostic?: WechatPngFailureDiagnostic) {
    super(code);
    this.name = 'WechatPngConversionError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

type PreparedClipboardFallback = Readonly<{
  dimensionSignature: string;
  layoutSignature: string;
  payload: SerializedClipboardPayload;
  sequence: number;
  sourceMarkup: string;
}>;

type PreparedClipboardPayload = {
  backgroundCancel: (() => void) | null;
  payload: SerializedClipboardPayload | null;
  promise: Promise<SerializedClipboardPayload>;
  sequence: number;
  sourceMarkup: string;
  dimensionSignature: string;
  layoutSignature: string;
  fallback: PreparedClipboardFallback | null;
  recoveredAtLayoutSignature: string | null;
  layoutOwner: 'live' | 'measurement';
};
type PreparedClipboardPayloadCache = WeakMap<HTMLElement, PreparedClipboardPayload>;
type BackgroundPreparationWaiter = {
  reject: (error: unknown) => void;
  resolve: () => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};
type BackgroundPreparationState = {
  active: Promise<void> | null;
  activeController: AbortController | null;
  requested: boolean;
  timer: number | ReturnType<typeof setTimeout> | null;
  waiters: BackgroundPreparationWaiter[];
};
type BackgroundPreparationCache = WeakMap<HTMLElement, BackgroundPreparationState>;
type SerializationYield = (() => Promise<void>) & { shouldYield: () => boolean };

const WECHAT_COPY_TIMING_NAMES = {
  candidateCapture: 'easymde.wechat.copy.candidate.capture',
  candidateGeometry: 'easymde.wechat.copy.candidate.geometry',
  candidateRasterization: 'easymde.wechat.copy.candidate.rasterization',
  connectedPlainText: 'easymde.wechat.copy.connected-plain-text',
  finalGeometry: 'easymde.wechat.copy.final-geometry',
  finalRawContextRefresh: 'easymde.wechat.copy.final-raw-context-refresh',
  finalSourceFreshness: 'easymde.wechat.copy.final-source-freshness',
  finalizeMarkup: 'easymde.wechat.copy.finalize-markup',
  outerHtml: 'easymde.wechat.copy.outer-html',
  replacement: 'easymde.wechat.copy.replacement'
} as const;

function backgroundPreparationAbortError(): Error {
  const error = new Error('wechat-background-preparation-cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfBackgroundPreparationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw backgroundPreparationAbortError();
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutCode = 'wechat-clipboard-commit-timeout'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutCode));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (null !== timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
}

function createSerializationYield(
  runtime: BrowserWechatClipboardRuntime,
  enabled: boolean,
  signal?: AbortSignal
): SerializationYield | null {
  if (!enabled) return null;

  let lastYieldAt = Date.now();
  let firstYield = true;
  const yieldToBrowser = (async () => {
    throwIfBackgroundPreparationAborted(signal);
    if (firstYield) {
      firstYield = false;
      await waitForBrowserTask(runtime);
      lastYieldAt = Date.now();
      throwIfBackgroundPreparationAborted(signal);
      return;
    }
    if (Date.now() - lastYieldAt < BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS) {
      return;
    }
    await waitForBrowserTask(runtime);
    lastYieldAt = Date.now();
    throwIfBackgroundPreparationAborted(signal);
  }) as SerializationYield;
  yieldToBrowser.shouldYield = () => firstYield || Date.now() - lastYieldAt >= BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS;
  return yieldToBrowser;
}

async function yieldSerializationBoundary(
  yieldToBrowser: SerializationYield | null,
  conversion: WechatPngConversionContext | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (!yieldToBrowser?.shouldYield()) return;
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) assertPngConversionCurrent(conversion);
  await yieldToBrowser();
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) assertPngConversionCurrent(conversion);
}

function createRasterizationYield(
  yieldToBrowser: SerializationYield | null,
  conversion: WechatPngConversionContext
): WechatVisualRasterizationYield | undefined {
  if (!yieldToBrowser) return undefined;
  return Object.assign(
    async (): Promise<void> => {
      await yieldSerializationBoundary(yieldToBrowser, conversion, conversion.signal);
    },
    { shouldYield: () => yieldToBrowser.shouldYield() }
  );
}

function waitForBrowserTask(runtime: BrowserWechatClipboardRuntime): Promise<void> {
  const browserWindow = runtime.document.defaultView;
  return new Promise<void>((resolve) => {
    if (browserWindow) {
      browserWindow.setTimeout(resolve, 0);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function cacheBackgroundAsset(cache: BackgroundAssetCache, value: string, request: Promise<string>): void {
  while (cache.size >= MAX_BACKGROUND_ASSET_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if ('string' !== typeof oldest) break;
    cache.delete(oldest);
  }
  cache.set(value, request);
}

function isThemeImageUrl(value: string, document: Document): boolean {
  try {
    const url = new URL(value, document.baseURI);
    return url.origin === document.location.origin && THEME_IMAGE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  if (blob.size > MAX_DATA_IMAGE_LENGTH || !/^image\/(?:gif|jpe?g|png|webp)$/i.test(blob.type)) {
    return Promise.reject(new Error('wechat-theme-image-response-invalid'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if ('string' !== typeof result || !SAFE_DATA_IMAGE.test(result)) {
        reject(new Error('wechat-theme-image-data-invalid'));
        return;
      }
      resolve(result);
    });
    reader.addEventListener('error', () => reject(new Error('wechat-theme-image-read-failed')));
    reader.readAsDataURL(blob);
  });
}

function fetchThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  processResponse: (response: Response) => Promise<string>
): Promise<string> {
  if (!runtime.fetch) return Promise.reject(new Error('wechat-theme-image-fetch-unavailable'));

  const controller = 'function' === typeof AbortController ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let request: Promise<string>;
  try {
    request = Promise.resolve(runtime.fetch(value, controller ? { signal: controller.signal } : undefined)).then(
      processResponse
    );
  } catch (error: unknown) {
    return Promise.reject(error);
  }

  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('wechat-theme-image-fetch-timeout'));
    }, THEME_IMAGE_FETCH_TIMEOUT_MS);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (null !== timer) clearTimeout(timer);
  });
}

function materializeThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string> {
  const existing = cache.get(value);
  if (existing) return existing;

  let request: Promise<string>;
  request = fetchThemeImage(value, runtime, (response) => {
    if (!response.ok) throw new Error('wechat-theme-image-fetch-failed');
    const resolvedUrl = response.url || value;
    if (!isThemeImageUrl(resolvedUrl, runtime.document)) {
      throw new Error('wechat-theme-image-redirected');
    }
    return response.blob().then(dataUrlFromBlob);
  }).catch((error: unknown) => {
    if (cache.get(value) === request) cache.delete(value);
    throw error;
  });
  cacheBackgroundAsset(cache, value, request);
  return request;
}

async function materializeBackgroundValue(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  signal?: AbortSignal
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const layers = splitCssList(value);
  const materializedLayers: string[] = [];
  for (const layer of layers) {
    const matches = [...layer.matchAll(CSS_URL)];
    if (!matches.length) {
      materializedLayers.push(layer);
      continue;
    }
    let materialized = layer;
    for (const match of matches) {
      throwIfBackgroundPreparationAborted(signal);
      const source = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!source || SAFE_DATA_IMAGE.test(source)) continue;
      if (!isThemeImageUrl(source, runtime.document)) {
        // Keep the layer slot so retained gradients and longhand lists remain
        // aligned, while ensuring an unsupported URL cannot cross the paste
        // boundary.
        materialized = materialized.replace(match[0], 'none');
        continue;
      }
      const resolved = new URL(source, runtime.document.baseURI).href;
      const dataUrl = await materializeThemeImage(resolved, runtime, cache);
      throwIfBackgroundPreparationAborted(signal);
      materialized = materialized.replace(match[0], `url("${dataUrl}")`);
    }
    materializedLayers.push(materialized);
  }
  return materializedLayers.join(', ');
}

function materializeBackgroundValueSynchronously(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime
): string | null {
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const layers = splitCssList(value);
  const materializedLayers: string[] = [];
  for (const layer of layers) {
    const matches = [...layer.matchAll(CSS_URL)];
    if (!matches.length) {
      materializedLayers.push(layer);
      continue;
    }
    let materialized = layer;
    for (const match of matches) {
      const source = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!source || SAFE_DATA_IMAGE.test(source)) continue;
      // An approved same-origin theme image needs fetch/FileReader work. A
      // synchronous compatibility copy must not emit it as a remote URL or
      // claim that the decoration survived before preparation completes.
      if (isThemeImageUrl(source, runtime.document)) return null;
      materialized = materialized.replace(match[0], 'none');
    }
    materializedLayers.push(materialized);
  }
  return materializedLayers.join(', ');
}

function hasOnlySafeDataImageUrls(value: string): boolean {
  const matches = [...value.matchAll(CSS_URL)];
  return (
    matches.length > 0 &&
    matches.every((match) => SAFE_DATA_IMAGE.test((match[1] ?? match[2] ?? match[3] ?? '').trim()))
  );
}

function dataImageUrls(value: string): string[] {
  return [...value.matchAll(CSS_URL)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').trim())
    .filter((url) => SAFE_DATA_IMAGE.test(url));
}

function dataImageLayers(value: string): ThemeImageLayer[] {
  return splitCssList(value).flatMap((layer, layerIndex) =>
    dataImageUrls(layer).map((src) => ({ src, layerIndex }))
  );
}

function dataImageLayersFromDeclarations(declarations: string[]): ThemeImageLayer[] {
  // Computed `background-image` is the canonical layer list. The shorthand
  // is a fallback for test/runtime implementations that expose only it.
  let backgroundImageLayers: ThemeImageLayer[] | null = null;
  let backgroundLayers: ThemeImageLayer[] = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator);
    if (!['background', 'background-image'].includes(property)) continue;
    const layers = dataImageLayers(declaration.slice(separator + 1));
    if ('background-image' === property) {
      backgroundImageLayers = layers;
    } else {
      backgroundLayers = layers;
    }
  }
  if (null !== backgroundImageLayers && backgroundImageLayers.length > 0) {
    return backgroundImageLayers;
  }
  return backgroundLayers;
}

function nonImageBackgroundLayers(value: string): string[] {
  return splitCssList(value).filter((layer) => !HAS_CSS_URL.test(layer));
}

function dataImageLayerIndexes(value: string): ReadonlySet<number> {
  return new Set(
    splitCssList(value).flatMap((layer, layerIndex) => (dataImageUrls(layer).length > 0 ? [layerIndex] : []))
  );
}

function backgroundImageLayerInfo(
  declarations: string[]
): Readonly<{ layerCount: number; removedLayerIndexes: ReadonlySet<number> }> {
  let backgroundImageValue: string | null = null;
  let backgroundValue: string | null = null;
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    if ('background-image' === property) backgroundImageValue = value;
    if ('background' === property) backgroundValue = value;
  }
  const source =
    backgroundImageValue && dataImageUrls(backgroundImageValue).length > 0 ? backgroundImageValue : backgroundValue;
  const layers = source ? splitCssList(source) : [];
  return { layerCount: layers.length, removedLayerIndexes: source ? dataImageLayerIndexes(source) : new Set<number>() };
}

function compactBackgroundLonghandDeclarations(
  declarations: string[],
  layerCount: number,
  removedLayerIndexes: ReadonlySet<number>
): string[] {
  if (!removedLayerIndexes.size || !layerCount) return declarations;
  const longhands = new Set(['background-position', 'background-repeat', 'background-size']);
  return declarations.flatMap((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0 || !longhands.has(declaration.slice(0, separator))) return [declaration];
    const property = declaration.slice(0, separator);
    const layers = splitCssList(declaration.slice(separator + 1));
    if (!layers.length) return [declaration];
    // CSS repeats the last longhand layer when fewer values are supplied than
    // background-image layers. Expand before removing materialized layers so
    // the retained gradient/color layer keeps its original alignment.
    const expanded = Array.from({ length: layerCount }, (_, index) => layers[Math.min(index, layers.length - 1)]);
    const compacted = expanded.filter((_, index) => !removedLayerIndexes.has(index));
    return compacted.length ? [`${property}:${compacted.join(', ')}`] : [];
  });
}

function removeDataImageBackgroundDeclarations(declarations: string[], preserveRepeatingBackground: boolean): string[] {
  const hasBackgroundImageLayers = declarations.some((declaration) => {
    const separator = declaration.indexOf(':');
    return (
      separator >= 0 &&
      'background-image' === declaration.slice(0, separator) &&
      dataImageUrls(declaration.slice(separator + 1)).length > 0
    );
  });
  const layerInfo = preserveRepeatingBackground ? null : backgroundImageLayerInfo(declarations);
  let emittedBackgroundImageLayers = false;
  const normalized = declarations.flatMap((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0 || !['background', 'background-image'].includes(declaration.slice(0, separator))) {
      return [declaration];
    }
    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    if (preserveRepeatingBackground || !dataImageUrls(value).length) return [declaration];
    const layers = nonImageBackgroundLayers(value);
    if (!layers.length) return [];
    if ('background-image' === property) {
      emittedBackgroundImageLayers = true;
      return [`background-image:${layers.join(',')}`];
    }
    if (hasBackgroundImageLayers || emittedBackgroundImageLayers) return [];
    emittedBackgroundImageLayers = true;
    return [`background-image:${layers.join(',')}`];
  });
  return layerInfo
    ? compactBackgroundLonghandDeclarations(normalized, layerInfo.layerCount, layerInfo.removedLayerIndexes)
    : normalized;
}

function hasRepeatingBackground(computed: CSSStyleDeclaration): boolean {
  return /(?:^|\s)(?:repeat|repeat-x|repeat-y|space|round)(?:\s|$)/i.test(
    computed.getPropertyValue('background-repeat').trim()
  );
}

function backgroundLength(value: string): string | null {
  return /^(?:0|(?:\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh))$/.test(value) ? value : null;
}

type BackgroundImageSize = Readonly<{ fit: 'contain' | 'cover' | null; height: string | null; width: string | null }>;

function backgroundImageSize(computed: CSSStyleDeclaration, index: number): BackgroundImageSize {
  const layers = splitCssList(computed.getPropertyValue('background-size'));
  const values = (layers[Math.min(index, Math.max(0, layers.length - 1))] ?? '').split(/\s+/).filter(Boolean);
  const mode = values[0]?.toLowerCase();
  if ('cover' === mode || 'contain' === mode) {
    return { fit: mode, height: '100%', width: '100%' };
  }
  const width = backgroundLength(values[0] ?? '');
  // CSS treats a single background-size token as an explicit width with an
  // automatic height. Do not duplicate it onto the second axis: the
  // materialized image must keep its intrinsic aspect ratio.
  const height = backgroundLength(values[1] ?? '');
  return { fit: null, width, height };
}

type BackgroundImagePosition = Readonly<{ x: string; xOffset: string | null; y: string; yOffset: string | null }>;

const HORIZONTAL_POSITION_KEYWORDS = new Set(['left', 'center', 'right']);
const VERTICAL_POSITION_KEYWORDS = new Set(['top', 'center', 'bottom']);
const BACKGROUND_POSITION_OFFSET = /^-?(?:0|\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh)$/;

function isBackgroundPositionOffset(value: string): boolean {
  return BACKGROUND_POSITION_OFFSET.test(value.trim().toLowerCase());
}

function backgroundImagePosition(computed: CSSStyleDeclaration, index: number): BackgroundImagePosition {
  const layers = splitCssList(computed.getPropertyValue('background-position'));
  const values = (layers[Math.min(index, Math.max(0, layers.length - 1))] ?? '').split(/\s+/).filter(Boolean);
  const fallback: BackgroundImagePosition = {
    x: values[0] ?? '0%',
    xOffset: null,
    y: values[1] ?? '0%',
    yOffset: null
  };
  if (0 === values.length) return fallback;
  // CSS treats a single position token as an X position with a centered Y
  // axis, except for top/bottom which are Y positions with centered X.
  const normalized = values[0]?.toLowerCase();
  if (1 === values.length) {
    if ('top' === normalized || 'bottom' === normalized) {
      return { x: 'center', xOffset: null, y: values[0] ?? 'center', yOffset: null };
    }
    return { x: values[0] ?? 'center', xOffset: null, y: 'center', yOffset: null };
  }

  const first = values[0]?.toLowerCase() ?? '';
  const second = values[1] ?? '';
  const third = values[2]?.toLowerCase() ?? '';
  const fourth = values[3] ?? '';
  if (
    HORIZONTAL_POSITION_KEYWORDS.has(first) &&
    isBackgroundPositionOffset(second) &&
    VERTICAL_POSITION_KEYWORDS.has(third)
  ) {
    return { x: first, xOffset: second, y: third, yOffset: isBackgroundPositionOffset(fourth) ? fourth : null };
  }
  if (
    VERTICAL_POSITION_KEYWORDS.has(first) &&
    isBackgroundPositionOffset(second) &&
    HORIZONTAL_POSITION_KEYWORDS.has(third)
  ) {
    return { x: third, xOffset: isBackgroundPositionOffset(fourth) ? fourth : null, y: first, yOffset: second };
  }
  // In the two-value form, a keyword followed by a length is a horizontal
  // or vertical position followed by the other axis's length. Offset pairs
  // use the explicit four-value `left 10px top 20px` form below.
  if (HORIZONTAL_POSITION_KEYWORDS.has(first) && isBackgroundPositionOffset(second)) {
    return { x: first, xOffset: null, y: second, yOffset: null };
  }
  if (VERTICAL_POSITION_KEYWORDS.has(first) && isBackgroundPositionOffset(second)) {
    return { x: second, xOffset: null, y: first, yOffset: null };
  }
  if (isBackgroundPositionOffset(first) && VERTICAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: first, xOffset: null, y: second, yOffset: null };
  }
  if (isBackgroundPositionOffset(first) && HORIZONTAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: second, xOffset: null, y: first, yOffset: null };
  }
  if (HORIZONTAL_POSITION_KEYWORDS.has(first) && VERTICAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: first, xOffset: null, y: second, yOffset: null };
  }
  if (VERTICAL_POSITION_KEYWORDS.has(first) && HORIZONTAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: second, xOffset: null, y: first, yOffset: null };
  }
  return fallback;
}

function appendThemeImages(
  clone: Element,
  imageLayers: ThemeImageLayer[],
  computed: CSSStyleDeclaration,
  emptyDecoration: boolean
): void {
  if (!imageLayers.length) return;
  const document = clone.ownerDocument;
  const overlay = !emptyDecoration && Boolean(clone.textContent?.trim() || clone.children.length);

  imageLayers.forEach(({ src, layerIndex }, index) => {
    const image = document.createElement('img');
    image.setAttribute('src', src);
    THEME_IMAGE_CLONES.add(image);
    const backgroundSize = backgroundImageSize(computed, layerIndex);
    const position = backgroundImagePosition(computed, layerIndex);
    const positionX = backgroundPositionAxis(position.x, 'x');
    const positionY = backgroundPositionAxis(position.y, 'y');
    const declarations = ['display:block', 'max-width:none!important'];
    if (backgroundSize.width) declarations.push(`width:${backgroundSize.width}`);
    if (backgroundSize.height) declarations.push(`height:${backgroundSize.height}`);
    else if (backgroundSize.width) declarations.push('height:auto');
    if (!backgroundSize.width && backgroundSize.height) declarations.push('width:auto');
    if (backgroundSize.fit) declarations.push(`object-fit:${backgroundSize.fit}`);
    // A single empty-decoration image can remain in normal flow so it keeps
    // the source decoration's intrinsic footprint. Once layers are present,
    // every image must be an overlay so document flow cannot reorder or resize
    // the background stack.
    const positioned = overlay || imageLayers.length > 1 || index > 0 || Boolean(backgroundSize.fit);
    THEME_IMAGE_CLONE_OWNERS.set(image, {
      layerIndex,
      owner: clone,
      slot: positioned ? 'leading' : 'trailing'
    });
    if (positioned) {
      const sourcePosition = computed.getPropertyValue('position').trim().toLowerCase();
      const safeSourcePosition = ['relative', 'absolute'].includes(sourcePosition) ? sourcePosition : 'relative';
      const neutralizeStaticOffsets = 'static' === sourcePosition || safeSourcePosition !== sourcePosition;
      if ('static' === sourcePosition || neutralizeStaticOffsets) {
        appendDeclarations(clone, ['position:relative']);
      } else if (!clone.getAttribute('style')?.includes('position:')) {
        appendDeclarations(clone, [`position:${safeSourcePosition}`]);
      }
      // Isolate the cloned element so a negative stacking level paints above
      // its background but below normal-flow text. This preserves the source
      // background-image semantics after materializing it as an <img> child.
      appendDeclarations(clone, ['isolation:isolate']);
      if (neutralizeStaticOffsets) {
        // `top`/`left` are inert for static nodes but become active when this
        // exporter creates the relative containing block for an overlay.
        // Fixed/sticky positioning is never portable into a pasted article.
        appendDeclarations(clone, ['top:auto', 'right:auto', 'bottom:auto', 'left:auto']);
      }
      declarations.push('position:absolute', `z-index:-${layerIndex + 1}`, 'pointer-events:none');
      const transforms: string[] = [];
      if ('center' === positionX) {
        declarations.push(position.xOffset ? `left:calc(50% + ${position.xOffset})` : 'left:50%');
        transforms.push('translateX(-50%)');
      } else if ('end' === positionX) {
        declarations.push(`right:${position.xOffset ?? '0'}`);
      } else if ('start' === positionX) {
        declarations.push(`left:${position.xOffset ?? '0'}`);
      } else {
        declarations.push(`left:${positionX}`);
        if (isBackgroundPositionPercentage(positionX)) {
          // CSS background percentages are applied to the remaining free
          // space (container size minus image size), not the container origin.
          // Match that equation with an absolute left plus the inverse image
          // percentage in the transform.
          transforms.push(`translateX(${negateBackgroundPositionPercentage(positionX)})`);
        }
      }
      if ('center' === positionY) {
        declarations.push(position.yOffset ? `top:calc(50% + ${position.yOffset})` : 'top:50%');
        transforms.push('translateY(-50%)');
      } else if ('end' === positionY) {
        declarations.push(`bottom:${position.yOffset ?? '0'}`);
      } else if ('start' === positionY) {
        declarations.push(`top:${position.yOffset ?? '0'}`);
      } else {
        declarations.push(`top:${positionY}`);
        if (isBackgroundPositionPercentage(positionY)) {
          transforms.push(`translateY(${negateBackgroundPositionPercentage(positionY)})`);
        }
      }
      if (transforms.length) declarations.push(`transform:${transforms.join(' ')}`);
      clone.insertBefore(image, clone.firstChild);
    } else {
      clone.appendChild(image);
    }
    image.setAttribute('style', declarations.join(';'));
  });
}

function backgroundPositionAxis(value: string, axis: 'x' | 'y'): 'center' | 'start' | 'end' | string {
  const normalized = value.trim().toLowerCase();
  if ('center' === normalized || /^50(?:\.0+)?%$/.test(normalized)) return 'center';
  if (
    ('x' === axis && 'left' === normalized) ||
    ('y' === axis && 'top' === normalized) ||
    /^0(?:\.0+)?%$/.test(normalized)
  )
    return 'start';
  if (
    ('x' === axis && 'right' === normalized) ||
    ('y' === axis && 'bottom' === normalized) ||
    /^100(?:\.0+)?%$/.test(normalized)
  )
    return 'end';
  return value;
}

function sourceDirection(source: Element, computed: CSSStyleDeclaration): 'ltr' | 'rtl' {
  const computedDirection = computed.getPropertyValue('direction').trim().toLowerCase();
  if ('rtl' === computedDirection) return 'rtl';
  if ('ltr' === computedDirection) return 'ltr';

  const declaredDirection = source.closest('[dir]')?.getAttribute('dir')?.trim().toLowerCase();
  if ('rtl' === declaredDirection) return 'rtl';
  if ('ltr' === declaredDirection) return 'ltr';

  const documentDirection = source.ownerDocument.documentElement?.getAttribute('dir')?.trim().toLowerCase();
  return 'rtl' === documentDirection ? 'rtl' : 'ltr';
}

function finitePixelValue(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function cssomProjectedDimensionValue(property: string, semantic: string, extra: number, source: Element): string {
  const declaration = source.ownerDocument.createElement('div').style;
  const projected = `calc(${semantic} + ${extra}px)`;
  declaration.setProperty(property, projected);
  const normalized = declaration.getPropertyValue(property).trim();
  if (!normalized) throw new Error('wechat-invalid-content-box-dimension');
  return normalized;
}

const CONTENT_BOX_DIMENSION_PROPERTIES = [
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height'
] as const;
const CONTENT_BOX_PERCENTAGE_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?%$/;
const CONTENT_BOX_PIXEL_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?px$/i;
const CONTENT_BOX_DIMENSION_KEYWORDS: Readonly<
  Record<(typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number], ReadonlySet<string>>
> = {
  width: new Set(['auto']),
  'min-width': new Set(['auto']),
  'max-width': new Set(['none']),
  height: new Set(['auto']),
  'min-height': new Set(['auto']),
  'max-height': new Set(['none'])
};
const CONTENT_BOX_REPLACED_ELEMENTS = new Set([
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
const CONTENT_BOX_PROMOTED_PROPERTIES = new Set(['box-sizing', 'max-width']);
const CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS = new Set([
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

function isContentBoxTransportableDimension(
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

function contentBoxFinitePixelValue(value: string): number | null {
  const pixel = CONTENT_BOX_PIXEL_TOKEN.exec(value.trim().toLowerCase());
  if (!pixel) return null;
  const parsed = Number.parseFloat(pixel[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isContentBoxPercentageDimension(value: string): boolean {
  const match = CONTENT_BOX_PERCENTAGE_TOKEN.exec(value.trim().toLowerCase());
  if (!match) return false;
  const parsed = Number.parseFloat(match[0].slice(0, -1));
  return Number.isFinite(parsed) && parsed >= 0;
}

function hasExcludedContentBoxParent(
  source: Element,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): boolean {
  const formattingOwnerDisplay = dimensionSemantics?.getFormattingOwnerDisplay(source);
  return Boolean(formattingOwnerDisplay && CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS.has(formattingOwnerDisplay));
}

function contentBoxEdgeSum(computed: CSSStyleDeclaration, properties: readonly string[]): number | null {
  const values = properties.map((property) => contentBoxFinitePixelValue(computed.getPropertyValue(property)));
  if (values.some((value) => null === value || value < 0)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function isContentBoxPercentageProjectionCandidate(
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

function contentBoxDimensionValue(
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

function portableStyleValue(property: string, value: string, source: Element, computed: CSSStyleDeclaration): string {
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

const BACKGROUND_POSITION_PERCENTAGE = /^-?(?:0|\d+(?:\.\d+)?)%$/;

function isBackgroundPositionPercentage(value: string): boolean {
  return BACKGROUND_POSITION_PERCENTAGE.test(value.trim());
}

function negateBackgroundPositionPercentage(value: string): string {
  const normalized = value.trim();
  return normalized.startsWith('-') ? normalized.slice(1) : `-${normalized}`;
}

function keepStyle(
  property: string,
  value: string,
  source: Element,
  pseudoElement = false,
  root = false,
  sourceValue = value,
  omitDefaultValues = true
): boolean {
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

function portableStyleDeclaration(property: string, value: string, important = false): string {
  return `${property}:${value}${important || 'overflow-wrap' === property ? '!important' : ''}`;
}

function supportsSpecialLayout(source: Element): boolean {
  return Boolean(source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline'));
}

function hasSpecialLayoutAncestor(source: Element): boolean {
  let current = source.parentElement;
  while (current) {
    if (current.matches('svg, math, .katex, .easymde-math-block, .easymde-math-inline')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function semanticMarginSource(
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

function semanticMarginValue(
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

function semanticMarginSignature(
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

function rootExportComputedStyle(
  source: Element,
  computed: CSSStyleDeclaration,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElement?: string
): CSSStyleDeclaration {
  if (source.hasAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE)) return computed;
  return dimensionSemantics?.getRootComputedStyle(source, pseudoElement) ?? computed;
}

function snapshotComputedStyle(computed: CSSStyleDeclaration): CSSStyleDeclaration {
  const values = new Map<string, string>();
  ROOT_EXPORT_STYLE_PROPERTIES.forEach((property) => {
    values.set(property, computed.getPropertyValue(property));
  });
  return { getPropertyValue: (property: string) => values.get(property) ?? '' } as unknown as CSSStyleDeclaration;
}

function signatureStyleProperties(source: Element, root = false, pseudoElement = false): readonly string[] {
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

function isKaTeXVisualNode(source: Element): boolean {
  // KaTeX's MathML and visual trees share a `.katex` ancestor. Only the
  // visual root and its descendants need the non-wrapping contract; applying
  // it to `.katex-mathml` would preserve the hidden fallback we remove later.
  return source.matches('.katex') || Boolean(source.closest('.katex-html'));
}

function visualRasterizationKind(source: Element): WechatVisualRasterizationKind | null {
  if (source.matches('.easymde-mermaid') && source.querySelector('svg')) {
    return 'mermaid';
  }
  if (
    source.matches('.easymde-math, .easymde-math-block, .easymde-math-inline') &&
    (source.matches('.katex') || Boolean(source.querySelector('.katex')))
  ) {
    return 'math';
  }
  return null;
}

type MermaidScreenCtm = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;

const MERMAID_INTRINSIC_LAYOUT_ROLES: ReadonlySet<WechatVisualRasterizationMermaidLayoutRole> = new Set([
  'gantt',
  'sequence',
  'timeline'
]);

function mermaidViewBox(source: SVGSVGElement): Readonly<{ height: number; width: number }> | null {
  const values =
    source
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number) ?? [];
  if (
    4 !== values.length ||
    values.some((value) => !Number.isFinite(value)) ||
    !values[2] ||
    !values[3] ||
    values[2] <= 0 ||
    values[3] <= 0
  )
    return null;
  return { height: values[3], width: values[2] };
}

function mermaidHasPaint(source: SVGSVGElement): boolean {
  return Boolean(source.querySelector('path,rect,circle,ellipse,line,polyline,polygon,text,foreignObject,image,use'));
}

const SAFE_MERMAID_INLINE_DIMENSION_VALUES = new Set([
  'auto',
  'inherit',
  'initial',
  'max-content',
  'min-content',
  'none',
  'revert',
  'revert-layer',
  'unset'
]);

function unsafeMermaidInlineDimensionValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !SAFE_MERMAID_INLINE_DIMENSION_VALUES.has(normalized);
}

function unsafeMermaidDimensionRules(source: Element, document: Document): boolean {
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  if (
    source.hasAttribute('height') ||
    unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('height') ?? '') ||
    unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('max-height') ?? '')
  )
    return true;

  const styleMapFactory = (source as Element & { computedStyleMap?: () => MermaidStyleMap }).computedStyleMap;
  if ('function' !== typeof styleMapFactory) return true;
  let styleMap: MermaidStyleMap;
  try {
    styleMap = styleMapFactory.call(source);
  } catch {
    return true;
  }

  const keyword = (property: string): string | null => {
    const candidate = styleMap.get(property);
    if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
    const value = (candidate as { value?: unknown }).value;
    return 'string' === typeof value ? value : null;
  };
  const expectedKeywords: ReadonlyArray<readonly [string, string]> = [
    ['height', 'auto'],
    ['block-size', 'auto'],
    ['min-height', 'auto'],
    ['min-block-size', 'auto'],
    ['max-height', 'none'],
    ['max-block-size', 'none']
  ];
  try {
    if (expectedKeywords.some(([property, expected]) => keyword(property) !== expected)) return true;
  } catch {
    return true;
  }

  const getAnimations = (document as Document & { getAnimations?: () => readonly Animation[] }).getAnimations;
  if ('function' !== typeof getAnimations) return true;
  let animations: readonly Animation[];
  try {
    animations = getAnimations.call(document);
  } catch {
    return true;
  }
  for (const animation of animations) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (target instanceof Element && (target === source || target.contains(source) || source.contains(target)))
      return true;
  }
  return false;
}

const MERMAID_ASPECT_RATIO_QUANTUM = 1 / 64;
const MERMAID_BORDER_STYLE_PROPERTIES = [
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style'
] as const;
const MERMAID_BORDER_WIDTH_PROPERTIES = [
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width'
] as const;
const MERMAID_POSITION_PROPERTIES = ['top', 'right', 'bottom', 'left'] as const;

function mermaidCssPixelValue(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || '0' === normalized) return 0;
  const match = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(normalized);
  if (!match) return null;
  const parsed = Number(match[0].slice(0, -2));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mermaidHasUnsafeBorder(style: CSSStyleDeclaration, allowSolid = false): boolean {
  return MERMAID_BORDER_STYLE_PROPERTIES.some((property) => {
    const value = style.getPropertyValue(property).trim().toLowerCase();
    return Boolean(value) && !['none', 'hidden'].includes(value) && !(allowSolid && 'solid' === value);
  });
}

function mermaidHasNonZeroBorderWidth(style: CSSStyleDeclaration): boolean {
  return MERMAID_BORDER_WIDTH_PROPERTIES.some((property) => {
    const value = mermaidCssPixelValue(style.getPropertyValue(property));
    return value !== null && value > 0;
  });
}

function mermaidHasUnsafePositioning(
  element: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  const computed = getComputedStyle(element);
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style;
  const position = computed.getPropertyValue('position').trim().toLowerCase();
  const inlinePosition = inline?.getPropertyValue('position').trim().toLowerCase() ?? '';
  if (
    ['relative', 'absolute', 'fixed', 'sticky'].includes(position) ||
    ['relative', 'absolute', 'fixed', 'sticky'].includes(inlinePosition)
  )
    return true;
  const transform = computed.getPropertyValue('transform').trim().toLowerCase();
  const inlineTransform = inline?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  if ((transform && 'none' !== transform) || (inlineTransform && 'none' !== inlineTransform)) return true;
  return MERMAID_POSITION_PROPERTIES.some((property) => {
    const value = computed.getPropertyValue(property).trim().toLowerCase();
    const inlineValue = inline?.getPropertyValue(property).trim().toLowerCase() ?? '';
    return [value, inlineValue].some((candidate) => Boolean(candidate) && 'auto' !== candidate);
  });
}

function mermaidSvgRectMagnification(
  svg: SVGSVGElement,
  source: Element,
  viewBox: Readonly<{ height: number; width: number }>,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): number | null {
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ') ?? '';
  if (preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) return null;
  if (svg.hasAttribute('transform')) return null;
  const inlineStyle = (svg as Element & { style?: CSSStyleDeclaration }).style;
  const computed = getComputedStyle(svg);
  const sourceComputed = getComputedStyle(source);
  const inlineTransform = inlineStyle?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  const computedTransform = computed.getPropertyValue('transform').trim().toLowerCase();
  if ((inlineTransform && 'none' !== inlineTransform) || (computedTransform && 'none' !== computedTransform))
    return null;
  if (
    mermaidHasUnsafePositioning(svg, getComputedStyle) ||
    mermaidHasUnsafeBorder(computed) ||
    mermaidHasNonZeroBorderWidth(computed) ||
    mermaidHasUnsafeBorder(sourceComputed) ||
    mermaidHasNonZeroBorderWidth(sourceComputed)
  )
    return null;
  const edgePixels = (style: CSSStyleDeclaration, property: string, borderStyleProperty?: string): number => {
    if (
      borderStyleProperty &&
      ['none', 'hidden'].includes(style.getPropertyValue(borderStyleProperty).trim().toLowerCase())
    )
      return 0;
    return mermaidCssPixelValue(style.getPropertyValue(property)) ?? Number.NaN;
  };
  const svgEdges = [
    edgePixels(computed, 'padding-top'),
    edgePixels(computed, 'padding-right'),
    edgePixels(computed, 'padding-bottom'),
    edgePixels(computed, 'padding-left'),
    edgePixels(computed, 'border-top-width', 'border-top-style'),
    edgePixels(computed, 'border-right-width', 'border-right-style'),
    edgePixels(computed, 'border-bottom-width', 'border-bottom-style'),
    edgePixels(computed, 'border-left-width', 'border-left-style')
  ];
  if (svgEdges.some((value) => !Number.isFinite(value) || value > 0)) return null;
  let rect: DOMRect;
  let sourceRect: DOMRect;
  try {
    rect = svg.getBoundingClientRect();
    sourceRect = source.getBoundingClientRect();
  } catch {
    return null;
  }
  const sourceEdges = [
    edgePixels(sourceComputed, 'padding-top'),
    edgePixels(sourceComputed, 'padding-right'),
    edgePixels(sourceComputed, 'padding-bottom'),
    edgePixels(sourceComputed, 'padding-left'),
    edgePixels(sourceComputed, 'border-top-width', 'border-top-style'),
    edgePixels(sourceComputed, 'border-right-width', 'border-right-style'),
    edgePixels(sourceComputed, 'border-bottom-width', 'border-bottom-style'),
    edgePixels(sourceComputed, 'border-left-width', 'border-left-style')
  ];
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(sourceRect.width) ||
    !Number.isFinite(sourceRect.height) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    sourceEdges.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const [paddingTop, paddingRight, paddingBottom, paddingLeft, borderTop, borderRight, borderBottom, borderLeft] =
    sourceEdges as [number, number, number, number, number, number, number, number];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom - borderTop - borderBottom;
  if (
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    Math.abs(rect.width - sourceContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM ||
    Math.abs(rect.height - sourceContentHeight) > MERMAID_ASPECT_RATIO_QUANTUM
  )
    return null;
  const widthRatio = viewBox.width / rect.width;
  const heightRatio = viewBox.height / rect.height;
  const aspectResidual = Math.min(
    Math.abs(rect.height - (rect.width * viewBox.height) / viewBox.width),
    Math.abs(rect.width - (rect.height * viewBox.width) / viewBox.height)
  );
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio <= 0 ||
    heightRatio <= 0 ||
    !Number.isFinite(aspectResidual) ||
    aspectResidual > MERMAID_ASPECT_RATIO_QUANTUM
  )
    return null;
  const magnification = Math.min(widthRatio, heightRatio);
  return Number.isFinite(magnification) && magnification >= 1 ? magnification : 1;
}

function mermaidLayoutMagnification(source: Element, runtime: BrowserWechatClipboardRuntime): number {
  const svgs = Array.from(source.children).filter((element) => 'svg' === element.localName.toLowerCase());
  if (1 !== svgs.length || !svgs[0]) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const svg = svgs[0] as SVGSVGElement;
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  if ('function' !== typeof getScreenCTM) return 1;
  if (!source.isConnected) return 1;
  if (!mermaidHasPaint(svg)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) return 1;
  let transformOwner: Element | null = source;
  while (transformOwner) {
    const computed = runtime.getComputedStyle(transformOwner);
    const transform = computed.getPropertyValue('transform').trim().toLowerCase();
    const inlineTransform =
      (transformOwner as Element & { style?: CSSStyleDeclaration }).style
        ?.getPropertyValue('transform')
        .trim()
        .toLowerCase() ?? '';
    if ((transform && 'none' !== transform) || (inlineTransform && 'none' !== inlineTransform)) return 1;
    transformOwner = transformOwner.parentElement;
  }
  const sourceStyle = runtime.getComputedStyle(source);
  const overflow = sourceStyle.getPropertyValue('overflow').trim().toLowerCase();
  const overflowX = sourceStyle.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = sourceStyle.getPropertyValue('overflow-y').trim().toLowerCase();
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = inlineStyle?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const authoredOverflowX = inlineStyle?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const authoredOverflowY = inlineStyle?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceHeight = inlineStyle?.getPropertyValue('height').trim().toLowerCase() ?? '';
  const unsafeDimensionRules = unsafeMermaidDimensionRules(source, source.ownerDocument);
  const hasFixedSourceHeight =
    Boolean(sourceHeight && !['auto', 'max-content', 'none'].includes(sourceHeight)) ||
    source.hasAttribute('height') ||
    unsafeDimensionRules;
  const stylesheetOwnedAutoheightOwner =
    source.matches('.easymde-mermaid') &&
    !authoredOverflow &&
    !authoredOverflowX &&
    !authoredOverflowY &&
    ['auto', 'scroll'].includes(overflowX) &&
    ['auto', 'scroll'].includes(overflowY) &&
    !hasFixedSourceHeight;
  const horizontalScrollOwner =
    stylesheetOwnedAutoheightOwner ||
    (['auto', 'scroll'].includes(overflowX) &&
      ['auto', 'scroll'].includes(authoredOverflowX || overflowX) &&
      'visible' === authoredOverflowY);
  const hasClippedAxis = [overflow, overflowX, overflowY, authoredOverflowX, authoredOverflowY].some((value) =>
    ['hidden', 'clip'].includes(value)
  );
  const hasUnsupportedOverflow = overflow && !horizontalScrollOwner && ['auto', 'scroll'].includes(overflow);
  if (
    hasClippedAxis ||
    hasUnsupportedOverflow ||
    (overflowX && !['visible', 'auto', 'scroll'].includes(overflowX)) ||
    (overflowY && !['visible', 'auto', 'scroll'].includes(overflowY)) ||
    hasFixedSourceHeight
  )
    return 1;
  const matrix = getScreenCTM.call(svg);
  if (!matrix) return 1;
  if (
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6 ||
    Math.abs(matrix.a - matrix.d) > 1e-6
  )
    return 1;
  const currentScale = (matrix.a + matrix.d) / 2;
  const downscaledPixels = Math.max(viewBox.width * (1 - currentScale), viewBox.height * (1 - currentScale));
  if (currentScale >= 1 || downscaledPixels <= 1) return 1;
  const rectMagnification = mermaidSvgRectMagnification(svg, source, viewBox, runtime.getComputedStyle);
  if (rectMagnification === null) return 1;
  return rectMagnification;
}

type MermaidIntrinsicScrollDimensions = Readonly<{
  capture: WechatVisualRasterizationMermaidCapture;
  height: number;
  maxWidth?: number;
  role?: WechatVisualRasterizationMermaidLayoutRole;
  svg?: SVGSVGElement;
  width: number;
}>;

type MermaidResponsiveViewportSnapshot = Readonly<{
  bottom: number;
  cssHeight: string;
  cssMaxWidth: string;
  cssWidth: string;
  height: number;
  left: number;
  maxWidth: number;
  right: number;
  svg: SVGSVGElement;
  top: number;
  width: number;
}>;

type WechatMermaidCaptureChoiceSnapshot = Readonly<{ capture: WechatVisualRasterizationMermaidCapture | null }>;

const MERMAID_INTRINSIC_GEOMETRY_TOLERANCE = MERMAID_ASPECT_RATIO_QUANTUM;

function mermaidEdgeValues(style: CSSStyleDeclaration): readonly number[] | null {
  const edge = (property: string, borderStyleProperty?: string): number | null => {
    const pixels = mermaidCssPixelValue(style.getPropertyValue(property));
    if (pixels === null) return null;
    if (!borderStyleProperty) return pixels;
    const borderStyle = style.getPropertyValue(borderStyleProperty).trim().toLowerCase();
    if (['', 'none', 'hidden'].includes(borderStyle)) return 0;
    return 'solid' === borderStyle ? pixels : null;
  };
  const values = [
    edge('padding-top'),
    edge('padding-right'),
    edge('padding-bottom'),
    edge('padding-left'),
    edge('border-top-width', 'border-top-style'),
    edge('border-right-width', 'border-right-style'),
    edge('border-bottom-width', 'border-bottom-style'),
    edge('border-left-width', 'border-left-style')
  ];
  return values.every((value) => value !== null) ? (values as number[]) : null;
}

type MermaidStyleMap = Readonly<{ get: (property: string) => unknown }>;

function mermaidTypedCssUnitText(unit: unknown): string | null {
  if ('string' === typeof unit) return unit.trim().toLowerCase() || null;
  if (!unit || 'object' !== typeof unit) return null;
  const keys = (unit as { keys?: () => Iterator<string> }).keys;
  if ('function' !== typeof keys) return null;
  const iterator = keys.call(unit);
  const first = iterator.next();
  const second = iterator.next();
  if (first.done || !second.done || 'string' !== typeof first.value) return null;
  return first.value.trim().toLowerCase() || null;
}

function mermaidTypedCssText(element: Element, property: string): string | null {
  const factory = (element as Element & { computedStyleMap?: () => MermaidStyleMap }).computedStyleMap;
  if ('function' !== typeof factory) return null;
  try {
    const candidate = factory.call(element).get(property);
    if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
    const value = (candidate as { value?: unknown; unit?: unknown }).value;
    if ('string' === typeof value) return value.trim().toLowerCase();
    const unit = mermaidTypedCssUnitText((candidate as { unit?: unknown }).unit);
    return 'number' === typeof value && Number.isFinite(value) && unit
      ? `${value}${'percent' === unit ? '%' : unit}`.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function mermaidTypedCssKeyword(element: Element, property: string): string | null {
  const value = mermaidTypedCssText(element, property);
  return value && /^[a-z-]+$/u.test(value) ? value : null;
}

function mermaidSourceUsesAutoBlockMargins(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  const svg = mermaidDirectSvg(source);
  if (!svg) return false;
  const computed = runtime.getComputedStyle(svg);
  if ('block' !== computed.getPropertyValue('display').trim().toLowerCase()) return false;
  return ['margin-left', 'margin-right'].every(
    (property) =>
      'auto' === computed.getPropertyValue(property).trim().toLowerCase() ||
      'auto' === mermaidTypedCssKeyword(svg, property)
  );
}

type MermaidRadius = Readonly<{ horizontal: number; vertical: number }>;

const MERMAID_RADIUS_PROPERTIES = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius'
] as const;

function mermaidRadiusAxis(value: string): number[] | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length > 4) return null;
  const values = tokens.map(mermaidCssPixelValue);
  return values.every((token) => token !== null) ? (values as number[]) : null;
}

function mermaidRadiusShorthand(value: string): readonly MermaidRadius[] | null {
  if (!value.trim()) return Array.from({ length: 4 }, () => ({ horizontal: 0, vertical: 0 }));
  const groups = value.trim().split(/\s*\/\s*/u);
  if (groups.length > 2 || groups.some((group) => !group.trim())) return null;
  const horizontal = mermaidRadiusAxis(groups[0] ?? '');
  const vertical = 1 === groups.length ? horizontal : mermaidRadiusAxis(groups[1] ?? '');
  if (!horizontal || !vertical || !horizontal.length || !vertical.length) return null;
  const expand = (values: readonly number[]): readonly [number, number, number, number] => {
    const first = values[0] ?? 0;
    const second = values[1] ?? first;
    const third = values[2] ?? first;
    const fourth = values[3] ?? second;
    if (1 === values.length) return [first, first, first, first];
    if (2 === values.length) return [first, second, first, second];
    if (3 === values.length) return [first, second, third, second];
    return [first, second, third, fourth];
  };
  const horizontalCorners = expand(horizontal);
  const verticalCorners = expand(vertical);
  return horizontalCorners.map((horizontalValue, index) => ({
    horizontal: horizontalValue,
    vertical: verticalCorners[index] as number
  }));
}

function mermaidRadiusPair(value: string): MermaidRadius | null {
  const normalized = value.trim();
  if (!normalized) return { horizontal: 0, vertical: 0 };
  if (normalized.includes('/')) return null;
  const tokens = normalized.split(/\s+/u);
  if (tokens.length < 1 || tokens.length > 2) return null;
  const horizontal = mermaidCssPixelValue(tokens[0] ?? '');
  if (horizontal === null) return null;
  const vertical = 2 === tokens.length ? mermaidCssPixelValue(tokens[1] ?? '') : horizontal;
  if (vertical === null) return null;
  return { horizontal, vertical };
}

function mermaidRadiusCorners(computed: CSSStyleDeclaration): readonly MermaidRadius[] | null {
  const shorthand = computed.getPropertyValue('border-radius').trim();
  const shorthandCorners = mermaidRadiusShorthand(shorthand);
  if (!shorthandCorners) return null;
  const values = MERMAID_RADIUS_PROPERTIES.map((property) => computed.getPropertyValue(property).trim());
  const parsed = values.map((value) => mermaidRadiusPair(value));
  if (parsed.some((pair, index) => pair === null && Boolean(values[index]))) return null;
  const hasComputedPaint = parsed.some((pair) => pair !== null && (pair.horizontal > 0 || pair.vertical > 0));
  return hasComputedPaint ? (parsed as MermaidRadius[]) : shorthandCorners;
}

function mermaidRadiusIsSafe(
  computed: CSSStyleDeclaration,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number
): boolean {
  const corners = mermaidRadiusCorners(computed);
  if (
    corners?.length !== 4 ||
    ![sourceWidth, sourceHeight, canonicalWidth, canonicalHeight].every((value) => Number.isFinite(value) && value > 0)
  )
    return false;
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return false;
  const horizontalChecks = [topLeft.horizontal + topRight.horizontal, bottomLeft.horizontal + bottomRight.horizontal];
  const verticalChecks = [topLeft.vertical + bottomLeft.vertical, topRight.vertical + bottomRight.vertical];
  return (
    horizontalChecks.every((sum) => sum <= sourceWidth && sum <= canonicalWidth) &&
    verticalChecks.every((sum) => sum <= sourceHeight && sum <= canonicalHeight)
  );
}

function mermaidRootPaintIsSafe(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number
): boolean {
  const computed = runtime.getComputedStyle(source);
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  if (
    (backgroundImage && 'none' !== backgroundImage) ||
    /(?:url\(|gradient\(|image\(|paint\(|cross-fade\()/u.test(background) ||
    !['', 'none'].includes(computed.getPropertyValue('box-shadow').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('filter').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('clip-path').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('mask').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('mask-image').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('outline-style').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('border-image-source').trim().toLowerCase()) ||
    mermaidHasUnsafeBorder(computed, true)
  )
    return false;
  if (!mermaidRadiusIsSafe(computed, sourceWidth, sourceHeight, canonicalWidth, canonicalHeight)) {
    return false;
  }
  return ['::before', '::after'].every(
    (pseudoElement) =>
      null === pseudoContent(runtime.getComputedStyle(source, pseudoElement).getPropertyValue('content'))
  );
}

function mermaidWideViewportIsSafe(
  svg: SVGSVGElement,
  sourceContentLeft: number,
  sourceContentRight: number,
  svgRect: DOMRect,
  viewBox: Readonly<{ width: number; height: number }>
): boolean {
  const freeWidth = sourceContentRight - sourceContentLeft - viewBox.width;
  if (!Number.isFinite(freeWidth) || freeWidth < 0) return false;
  const leftOffset = svgRect.left - sourceContentLeft;
  const rightOffset = sourceContentRight - svgRect.right;
  if (
    Math.abs(leftOffset) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
    Math.abs(rightOffset - freeWidth) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return true;
  if (
    Math.abs(leftOffset - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(rightOffset - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return false;
  return (
    'auto' === mermaidTypedCssKeyword(svg, 'margin-left') && 'auto' === mermaidTypedCssKeyword(svg, 'margin-right')
  );
}

function mermaidHasUnsafeAncestorGeometry(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement
): boolean {
  if (!boundary.contains(source)) return true;
  const sourceRect = source.getBoundingClientRect();
  if (
    !Number.isFinite(sourceRect.left) ||
    !Number.isFinite(sourceRect.right) ||
    !Number.isFinite(sourceRect.top) ||
    !Number.isFinite(sourceRect.bottom)
  )
    return true;
  let current: Element | null = source;
  while (current && current !== boundary) {
    const computed = runtime.getComputedStyle(current);
    const overflow = [
      computed.getPropertyValue('overflow'),
      computed.getPropertyValue('overflow-x'),
      computed.getPropertyValue('overflow-y')
    ].map((value) => value.trim().toLowerCase());
    if (mermaidHasUnsafePositioning(current, runtime.getComputedStyle)) return true;
    const clipsX = ['hidden', 'clip'].includes(overflow[1] ?? '');
    const clipsY = ['hidden', 'clip'].includes(overflow[2] ?? '');
    if (current !== source && (clipsX || clipsY)) {
      const ancestorRect = current.getBoundingClientRect();
      if (
        !Number.isFinite(ancestorRect.left) ||
        !Number.isFinite(ancestorRect.right) ||
        !Number.isFinite(ancestorRect.top) ||
        !Number.isFinite(ancestorRect.bottom) ||
        (clipsX &&
          (sourceRect.left < ancestorRect.left - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
            sourceRect.right > ancestorRect.right + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE)) ||
        (clipsY &&
          (sourceRect.top < ancestorRect.top - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
            sourceRect.bottom > ancestorRect.bottom + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE))
      )
        return true;
    }
    current = current.parentElement;
  }
  return current !== boundary;
}

function mermaidResponsiveAncestorLayoutIsSafe(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement
): boolean {
  if (!boundary.contains(source)) return false;
  let current: Element | null = source;
  while (current && current !== boundary) {
    const computed = runtime.getComputedStyle(current);
    const overflow = [
      computed.getPropertyValue('overflow'),
      computed.getPropertyValue('overflow-x'),
      computed.getPropertyValue('overflow-y')
    ].map((value) => value.trim().toLowerCase());
    if (
      current === source
        ? !mermaidResponsiveSourceOverflowIsSafe(source, runtime)
        : overflow.some((value) => value && 'visible' !== value) ||
          mermaidHasUnsafePositioning(current, runtime.getComputedStyle)
    )
      return false;
    current = current.parentElement;
  }
  return current === boundary;
}

function mermaidResponsiveSourceOverflowIsSafe(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  const computed = runtime.getComputedStyle(source);
  const overflow = [
    computed.getPropertyValue('overflow'),
    computed.getPropertyValue('overflow-x'),
    computed.getPropertyValue('overflow-y')
  ].map((value) => value.trim().toLowerCase());
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = [
    inlineStyle?.getPropertyValue('overflow'),
    inlineStyle?.getPropertyValue('overflow-x'),
    inlineStyle?.getPropertyValue('overflow-y')
  ].map((value) => value?.trim().toLowerCase() ?? '');
  const hasFixedSourceHeight = Boolean(
    source.hasAttribute('height') ||
      unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('height') ?? '') ||
      unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('max-height') ?? '')
  );
  const intentionalMermaidOwner =
    source.matches('.easymde-mermaid') &&
    authoredOverflow.every((value) => !value) &&
    ['auto', 'scroll'].includes(overflow[1] ?? '') &&
    ['auto', 'scroll'].includes(overflow[2] ?? '') &&
    !hasFixedSourceHeight;
  return intentionalMermaidOwner || overflow.every((value) => !value || 'visible' === value);
}

function mermaidDirectSvg(source: Element): SVGSVGElement | null {
  const svgs = Array.from(source.children).filter((element) => 'svg' === element.localName.toLowerCase());
  return 1 === svgs.length && svgs[0] ? (svgs[0] as SVGSVGElement) : null;
}

function mermaidResponsiveCssText(element: Element, runtime: BrowserWechatClipboardRuntime, property: string): string {
  const typed = mermaidTypedCssText(element, property);
  if (typed) return typed;
  const computed = runtime.getComputedStyle(element).getPropertyValue(property).trim().toLowerCase();
  if (computed) return computed;
  return '';
}

function assertResponsiveTypedStyleMapReadable(svg: SVGSVGElement): boolean {
  const factory = (svg as SVGSVGElement & { computedStyleMap?: () => MermaidStyleMap }).computedStyleMap;
  if ('function' !== typeof factory) return true;
  try {
    factory.call(svg);
    return true;
  } catch {
    return false;
  }
}

function mermaidResponsiveViewportDimensions(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  layoutMagnification: number,
  boundary: HTMLElement
): MermaidIntrinsicScrollDimensions | null {
  if (
    !source.matches('.easymde-mermaid') ||
    source.hasAttribute('data-easymde-mermaid-layout') ||
    layoutMagnification !== 1
  )
    return null;
  const children = Array.from(source.childNodes);
  const svg = mermaidDirectSvg(source);
  if (
    !svg ||
    children.some((child) =>
      child.nodeType === Node.TEXT_NODE
        ? !/^[\s]*$/u.test(child.textContent ?? '')
        : child.nodeType !== Node.ELEMENT_NODE || child !== svg
    )
  )
    return null;
  const role = svg.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (role && MERMAID_INTRINSIC_LAYOUT_ROLES.has(role as WechatVisualRasterizationMermaidLayoutRole)) {
    return null;
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox || !mermaidHasPaint(svg)) return null;
  if (!assertResponsiveTypedStyleMapReadable(svg)) return null;
  if (
    !mermaidSourceUsesAutoBlockMargins(source, runtime) ||
    mermaidResponsiveCssText(svg, runtime, 'width') !== '100%' ||
    mermaidResponsiveCssText(svg, runtime, 'height') !== 'auto'
  )
    return null;
  const maxWidth = mermaidCssPixelValue(mermaidResponsiveCssText(svg, runtime, 'max-width'));
  if (maxWidth === null || maxWidth <= 0) return null;
  const maxHeight = mermaidResponsiveCssText(svg, runtime, 'max-height');
  if (maxHeight && !['auto', 'none'].includes(maxHeight)) return null;
  const sourceHeight = mermaidResponsiveCssText(source, runtime, 'height');
  if (sourceHeight && !['auto', 'none'].includes(sourceHeight)) return null;
  const sourceRect = source.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (
    ![
      sourceRect.width,
      sourceRect.height,
      sourceRect.left,
      sourceRect.right,
      sourceRect.top,
      sourceRect.bottom,
      svgRect.width,
      svgRect.height,
      svgRect.left,
      svgRect.right,
      svgRect.top,
      svgRect.bottom
    ].every(Number.isFinite) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    svgRect.width <= 0 ||
    svgRect.height <= 0 ||
    svgRect.width < 1 ||
    svgRect.height < 1 ||
    sourceRect.width <= svgRect.width + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(sourceRect.height - svgRect.height) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.width - maxWidth) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return null;
  const computed = runtime.getComputedStyle(source);
  const svgComputed = runtime.getComputedStyle(svg);
  const sourceDisplay = computed.getPropertyValue('display').trim().toLowerCase();
  const backgroundColor = computed.getPropertyValue('background-color').trim().toLowerCase();
  const sourceOpacity = computed.getPropertyValue('opacity').trim().toLowerCase();
  const sourceFloat = computed.getPropertyValue('float').trim().toLowerCase();
  const svgFloat = svgComputed.getPropertyValue('float').trim().toLowerCase();
  const svgMarginTop = mermaidCssPixelValue(svgComputed.getPropertyValue('margin-top'));
  const svgMarginBottom = mermaidCssPixelValue(svgComputed.getPropertyValue('margin-bottom'));
  const sourceRadii = mermaidRadiusCorners(computed);
  const formattingOwnerDisplay = source.parentElement
    ? runtime.getComputedStyle(source.parentElement).getPropertyValue('display').trim().toLowerCase()
    : '';
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  const matrix = 'function' === typeof getScreenCTM ? getScreenCTM.call(svg) : null;
  const expectedScale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height);
  const svgEffects = ['box-shadow', 'clip-path', 'filter', 'mask', 'mask-image'].map((property) =>
    svgComputed.getPropertyValue(property).trim().toLowerCase()
  );
  const sourceEdges = mermaidEdgeValues(computed);
  const svgEdges = mermaidEdgeValues(svgComputed);
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
  const expectedHeight = (svgRect.width * viewBox.height) / viewBox.width;
  const freeWidth = sourceRect.width - svgRect.width;
  const centeredLeft = svgRect.left - sourceRect.left;
  const centeredRight = sourceRect.right - svgRect.right;
  if (
    !mermaidResponsiveSourceOverflowIsSafe(source, runtime) ||
    unsafeMermaidDimensionRules(source, source.ownerDocument) ||
    mermaidHasUnsafeAncestorGeometry(source, runtime, boundary) ||
    !mermaidResponsiveAncestorLayoutIsSafe(source, runtime, boundary) ||
    (sourceDisplay && 'block' !== sourceDisplay) ||
    '1' !== sourceOpacity ||
    !['', 'none'].includes(sourceFloat) ||
    !['', 'none'].includes(svgFloat) ||
    svgMarginTop === null ||
    svgMarginBottom === null ||
    svgMarginTop > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgMarginBottom > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !sourceRadii ||
    sourceRadii.some((radius) => radius.horizontal > 0 || radius.vertical > 0) ||
    !['block', 'flow-root', 'list-item'].includes(formattingOwnerDisplay) ||
    (backgroundColor && !['transparent', 'rgba(0, 0, 0, 0)', 'rgba(0,0,0,0)'].includes(backgroundColor)) ||
    mermaidHasUnsafePositioning(source, runtime.getComputedStyle) ||
    mermaidHasUnsafePositioning(svg, runtime.getComputedStyle) ||
    svg.hasAttribute('transform') ||
    (preserveAspectRatio && 'xmidymid meet' !== preserveAspectRatio) ||
    !sourceEdges ||
    !svgEdges ||
    sourceEdges.some((value) => value > 0) ||
    svgEdges.some((value) => value > 0) ||
    mermaidHasUnsafeBorder(computed) ||
    mermaidHasUnsafeBorder(svgComputed) ||
    mermaidHasNonZeroBorderWidth(computed) ||
    mermaidHasNonZeroBorderWidth(svgComputed) ||
    svgEffects.some((value) => value && 'none' !== value) ||
    !matrix ||
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6 ||
    !Number.isFinite(expectedScale) ||
    expectedScale <= 0 ||
    Math.abs(matrix.a - expectedScale) * viewBox.width > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(matrix.d - expectedScale) * viewBox.height > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !Number.isFinite(expectedHeight) ||
    Math.abs(svgRect.height - expectedHeight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.left < sourceRect.left - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.right > sourceRect.right + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.top < sourceRect.top - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.bottom > sourceRect.bottom + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !Number.isFinite(freeWidth) ||
    freeWidth < 0 ||
    Math.abs(centeredLeft - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(centeredRight - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.top - sourceRect.top) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !mermaidRootPaintIsSafe(source, runtime, sourceRect.width, sourceRect.height, svgRect.width, svgRect.height) ||
    !mermaidRootPaintIsSafe(svg, runtime, svgRect.width, svgRect.height, svgRect.width, svgRect.height)
  )
    return null;
  if (
    svgRect.width > MAX_WECHAT_PNG_DIMENSION ||
    svgRect.height > MAX_WECHAT_PNG_DIMENSION ||
    svgRect.width * svgRect.height > MAX_WECHAT_PNG_PIXELS
  )
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  return { capture: 'responsive-viewport', height: svgRect.height, maxWidth, svg, width: svgRect.width };
}

function mermaidResponsiveSnapshotIsCurrent(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement,
  snapshot: MermaidResponsiveViewportSnapshot
): boolean {
  const dimensions = mermaidResponsiveViewportDimensions(source, runtime, 1, boundary);
  if (dimensions?.capture !== 'responsive-viewport' || dimensions?.svg !== snapshot.svg || !dimensions?.svg)
    return false;
  const rect = dimensions.svg.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const cssWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'width');
  const cssHeight = mermaidResponsiveCssText(dimensions.svg, runtime, 'height');
  const cssMaxWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'max-width');
  const maxWidth = mermaidCssPixelValue(cssMaxWidth);
  return Boolean(
    Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      Number.isFinite(sourceRect.left) &&
      Number.isFinite(sourceRect.right) &&
      Number.isFinite(sourceRect.top) &&
      Number.isFinite(sourceRect.bottom) &&
      maxWidth !== null &&
      cssWidth === snapshot.cssWidth &&
      cssHeight === snapshot.cssHeight &&
      cssMaxWidth === snapshot.cssMaxWidth &&
      Math.abs(rect.width - snapshot.width) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.height - snapshot.height) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.left - sourceRect.left - snapshot.left) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.right - sourceRect.right - snapshot.right) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.top - sourceRect.top - snapshot.top) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.bottom - sourceRect.bottom - snapshot.bottom) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs((dimensions.maxWidth as number) - snapshot.maxWidth) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  );
}

function mermaidCaptureChoiceIsCurrent(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement,
  snapshot: WechatMermaidCaptureChoiceSnapshot
): boolean {
  const layoutMagnification = mermaidLayoutMagnification(source, runtime);
  const dimensions = mermaidIntrinsicScrollDimensions(source, runtime, layoutMagnification, boundary);
  return (dimensions?.capture ?? null) === snapshot.capture;
}

function mermaidIntrinsicScrollDimensions(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  layoutMagnification: number,
  boundary: HTMLElement
): MermaidIntrinsicScrollDimensions | null {
  if (!source.matches('.easymde-mermaid')) return null;
  const marker = source.getAttribute('data-easymde-mermaid-layout')?.trim().toLowerCase();
  if (!marker) return mermaidResponsiveViewportDimensions(source, runtime, layoutMagnification, boundary);
  if (!MERMAID_INTRINSIC_LAYOUT_ROLES.has(marker as WechatVisualRasterizationMermaidLayoutRole)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const svg = mermaidDirectSvg(source);
  const role = svg?.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (
    !svg ||
    !role ||
    role !== marker ||
    !MERMAID_INTRINSIC_LAYOUT_ROLES.has(role as WechatVisualRasterizationMermaidLayoutRole)
  ) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if (viewBox.width > MAX_WECHAT_PNG_DIMENSION || viewBox.height > MAX_WECHAT_PNG_DIMENSION) {
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  }
  if (layoutMagnification !== 1) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const sourceRect = source.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (
    !Number.isFinite(sourceRect.width) ||
    !Number.isFinite(sourceRect.height) ||
    !Number.isFinite(sourceRect.left) ||
    !Number.isFinite(sourceRect.right) ||
    !Number.isFinite(sourceRect.top) ||
    !Number.isFinite(sourceRect.bottom) ||
    !Number.isFinite(svgRect.width) ||
    !Number.isFinite(svgRect.height) ||
    !Number.isFinite(svgRect.left) ||
    !Number.isFinite(svgRect.right) ||
    !Number.isFinite(svgRect.top) ||
    !Number.isFinite(svgRect.bottom) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    svgRect.width <= 0 ||
    svgRect.height <= 0
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const computed = runtime.getComputedStyle(source);
  const overflowX = computed.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = computed.getPropertyValue('overflow-y').trim().toLowerCase();
  if (
    !['auto', 'scroll'].includes(overflowX) ||
    ['hidden', 'clip'].includes(overflowX) ||
    !['visible', 'auto', 'scroll'].includes(overflowY) ||
    unsafeMermaidDimensionRules(source, source.ownerDocument) ||
    mermaidHasUnsafeAncestorGeometry(source, runtime, boundary)
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const sourceEdges = mermaidEdgeValues(computed);
  const svgComputed = runtime.getComputedStyle(svg);
  const svgEdges = mermaidEdgeValues(svgComputed);
  if (
    !sourceEdges ||
    !svgEdges ||
    mermaidHasUnsafeBorder(svgComputed) ||
    mermaidHasNonZeroBorderWidth(svgComputed) ||
    svgEdges.some((value) => value > 0) ||
    mermaidHasUnsafeBorder(computed, true)
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if (mermaidHasUnsafePositioning(svg, runtime.getComputedStyle)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ') ?? '';
  if ((preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) || svg.hasAttribute('transform'))
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  const matrix = 'function' === typeof getScreenCTM ? getScreenCTM.call(svg) : null;
  if (
    !matrix ||
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const expectedScale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height);
  if (
    !Number.isFinite(expectedScale) ||
    expectedScale <= 0 ||
    Math.abs(matrix.a - expectedScale) * viewBox.width > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(matrix.d - expectedScale) * viewBox.height > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if (
    Math.abs(svgRect.width - viewBox.width) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.height - viewBox.height) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const [paddingTop, paddingRight, paddingBottom, paddingLeft, borderTop, borderRight, borderBottom, borderLeft] =
    sourceEdges as [number, number, number, number, number, number, number, number];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom - borderTop - borderBottom;
  if (
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    Math.abs(svgRect.height - sourceContentHeight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const sourceContentLeft = sourceRect.left + paddingLeft + borderLeft;
  const sourceContentRight = sourceRect.right - paddingRight - borderRight;
  const sourceContentTop = sourceRect.top + paddingTop + borderTop;
  const width = viewBox.width + paddingLeft + paddingRight + borderLeft + borderRight;
  const height = viewBox.height + paddingTop + paddingBottom + borderTop + borderBottom;
  if (!mermaidRootPaintIsSafe(source, runtime, sourceRect.width, sourceRect.height, width, height)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const viewportFits = viewBox.width <= sourceContentWidth + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE;
  if (viewportFits) {
    if (
      Math.abs(svgRect.top - sourceContentTop) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
      (sourceContentWidth - viewBox.width > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
        !mermaidWideViewportIsSafe(svg, sourceContentLeft, sourceContentRight, svgRect, viewBox)) ||
      (sourceContentWidth - viewBox.width <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
        (Math.abs(svgRect.left - sourceContentLeft) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
          Math.abs(svgRect.right - sourceContentRight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE))
    )
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width > MAX_WECHAT_PNG_DIMENSION ||
      height > MAX_WECHAT_PNG_DIMENSION ||
      width * height > MAX_WECHAT_PNG_PIXELS
    )
      throw new WechatPngConversionError('wechat-png-limit-exceeded');
    return { capture: 'intrinsic-viewport', height, role: role as WechatVisualRasterizationMermaidLayoutRole, width };
  }
  const direction = computed.getPropertyValue('direction').trim().toLowerCase();
  const sourceBox = source as Element & { clientWidth?: number; scrollLeft?: number; scrollWidth?: number };
  if (
    !Number.isFinite(sourceBox.clientWidth) ||
    !Number.isFinite(sourceBox.scrollLeft) ||
    !Number.isFinite(sourceBox.scrollWidth) ||
    (sourceBox.scrollWidth as number) < viewBox.width - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const rawScrollLeft = sourceBox.scrollLeft as number;
  const expectedSvgLeft = 'rtl' === direction ? sourceContentRight - viewBox.width : sourceContentLeft;
  if (
    Math.abs(svgRect.top - sourceContentTop) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.left + rawScrollLeft - expectedSvgLeft) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if ((sourceBox.scrollWidth as number) <= (sourceBox.clientWidth as number) + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width > MAX_WECHAT_PNG_DIMENSION ||
    height > MAX_WECHAT_PNG_DIMENSION ||
    width * height > MAX_WECHAT_PNG_PIXELS
  )
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  return { capture: 'intrinsic-viewport', height, role: role as WechatVisualRasterizationMermaidLayoutRole, width };
}

function hasVisualRasterizationAncestor(source: Element): boolean {
  let ancestor = source.parentElement;
  while (ancestor) {
    if (null !== visualRasterizationKind(ancestor)) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

function markVisualRasterizationClone(source: Element, clone: Element): boolean {
  const kind = visualRasterizationKind(source);
  if (!kind || hasVisualRasterizationAncestor(source)) return false;
  WECHAT_PNG_VISUAL_CLONES.set(clone, { kind, source });
  return true;
}

function isKaTeXVisualClone(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (KATEX_VISUAL_NODES.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function isBlockMathClone(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    if (MATH_BLOCK_ROOTS.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function wrapKaTeXVisualRoots(root: HTMLElement): void {
  const document = root.ownerDocument;
  Array.from(root.querySelectorAll('*'))
    .filter((element) => KATEX_VISUAL_ROOTS.has(element))
    .forEach((element) => {
      const wrapper = document.createElement('nobr');
      appendDeclarations(
        wrapper,
        [
          isBlockMathClone(element) ? 'display:block' : 'display:inline-block',
          ...(isBlockMathClone(element) ? ['text-align:center'] : []),
          'word-break:normal',
          'overflow-wrap:normal'
        ],
        true
      );
      element.replaceWith(wrapper);
      wrapper.appendChild(element);
    });
}

function isSvgElement(source: Element): boolean {
  return Boolean(source.closest('svg'));
}

function isSvgDefinition(source: Element): boolean {
  const localName = source.localName.toLowerCase();
  return 'defs' === localName || Boolean(source.closest('defs')) || SVG_DEFINITION_TAGS.has(localName);
}

function isMermaidSvgRoot(source: Element): boolean {
  return 'svg' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

function isMermaidForeignObject(source: Element): boolean {
  return 'foreignobject' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

function isTaskListCheckbox(source: Element): boolean {
  return (
    'INPUT' === source.tagName &&
    'checkbox' === source.getAttribute('type')?.toLowerCase() &&
    Boolean(source.matches('.easymde-task-checkbox') || source.closest('.task-list-item, .task-list'))
  );
}

type TaskCheckboxCaptionTextBinding = {
  cloneAncestors: readonly Element[];
  cloneParent: Element;
  cloneText: Text;
  encoded: string;
  glyph: boolean;
  layoutText: Text;
  original: string;
  prefixLength: number;
  sourceText: Text | null;
  glyphOffset: number;
};

type TaskCheckboxCaptionSequenceEntry = Readonly<{
  element: Element | null;
  glyph: boolean;
  glyphOffset: number;
  kind: 'enter' | 'exit' | 'text';
  path: readonly number[];
  prefixLength: number;
  text: Text | null;
  value: string;
}>;

type TaskCheckboxCaptionSequence = Readonly<{
  captionParent: Element;
  entries: readonly TaskCheckboxCaptionSequenceEntry[];
  glyphEntry: TaskCheckboxCaptionSequenceEntry;
  prefixEntries: readonly TaskCheckboxCaptionSequenceEntry[];
  taskItem: Element;
}>;

type TaskCheckboxCaptionRunEvent =
  | Readonly<{ cloneElement: Element; kind: 'enter' | 'exit'; path: readonly number[] }>
  | Readonly<{ binding: TaskCheckboxCaptionTextBinding; kind: 'text'; path: readonly number[] }>;

type TaskCheckboxCaptionRun = {
  cloneCaptionParent: Element;
  cloneEvents: readonly TaskCheckboxCaptionRunEvent[];
  cloneOwner: Element;
  cloneTaskItem: Element;
  layoutCaptionParent: Element;
  layoutOwner: HTMLInputElement;
  layoutTaskItem: Element;
  sourceCaptionParent: Element;
  sourceOwner: HTMLInputElement;
  sourceTaskItem: Element;
  bindings: readonly TaskCheckboxCaptionTextBinding[];
};

type TaskCheckboxCaptionTextBindingRef = Readonly<{
  binding: TaskCheckboxCaptionTextBinding;
  run: TaskCheckboxCaptionRun;
}>;

type TaskCheckboxCaptionOwnerIdentity = Readonly<{
  cloneOwner: Element;
  clonePath: readonly number[];
  layoutInput: HTMLInputElement;
  layoutPath: readonly number[];
  sourceInput: HTMLInputElement;
  sourcePath: readonly number[];
}>;

const TASK_LIST_CHECKBOX_CAPTION_RUNS = new WeakMap<Element, TaskCheckboxCaptionRun>();
const TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT = new WeakMap<Text, TaskCheckboxCaptionTextBindingRef>();
const TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS = new WeakSet<Text>();
const TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS = new WeakSet<Element>();
const TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES = new WeakSet<Element>();
const TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS = new WeakMap<Element, Element>();
const TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES = new WeakMap<
  Element,
  readonly TaskCheckboxCaptionOwnerIdentity[]
>();
const TASK_CHECKBOX_CAPTION_ATOMIC_TAGS = new Set([
  'BR',
  'CANVAS',
  'EMBED',
  'IMG',
  'INPUT',
  'OBJECT',
  'SELECT',
  'SVG',
  'TEXTAREA',
  'VIDEO'
]);
const TASK_CHECKBOX_CAPTION_BOUNDARY_TAGS = new Set(['LI', 'OL', 'UL']);
const TASK_CHECKBOX_CAPTION_BOUNDARY_DISPLAYS = new Set([
  'block',
  'contents',
  'flow-root',
  'flex',
  'grid',
  'inline-flex',
  'list-item',
  'table',
  'table-cell',
  'table-row'
]);

function taskCheckboxCaptionNodePath(ancestor: Node, target: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = target;
  while (current && current !== ancestor) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === ancestor ? path : null;
}

function taskCheckboxCaptionNodeAtPath(ancestor: Node, path: readonly number[]): Node | null {
  let current: Node | null = ancestor;
  for (const index of path) {
    current = current?.childNodes.item(index) ?? null;
  }
  return current;
}

function taskCheckboxCaptionWhitespaceSupported(
  element: Element,
  boundary: Element,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  let current: Element | null = element;
  while (current) {
    const whitespace = runtime.getComputedStyle(current).getPropertyValue('white-space').trim().toLowerCase();
    if (whitespace && !['normal', 'nowrap'].includes(whitespace)) return false;
    if (current === boundary) break;
    current = current.parentElement;
  }
  return true;
}

function taskCheckboxCaptionBoundary(
  element: Element,
  boundary: Element,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  if (element !== boundary && TASK_CHECKBOX_CAPTION_BOUNDARY_TAGS.has(element.tagName)) return true;
  if (TASK_CHECKBOX_CAPTION_ATOMIC_TAGS.has(element.tagName)) return true;
  const display = runtime.getComputedStyle(element).getPropertyValue('display').trim().toLowerCase();
  return 'none' === display || TASK_CHECKBOX_CAPTION_BOUNDARY_DISPLAYS.has(display);
}

function taskCheckboxCaptionAsciiPrefixLength(value: string): number {
  let length = 0;
  while (length < value.length && [' ', '\t', '\r', '\n', '\f'].includes(value[length] ?? '')) length += 1;
  return length;
}

function taskCheckboxCaptionSequence(
  start: Element,
  runtime: BrowserWechatClipboardRuntime
): TaskCheckboxCaptionSequence | null {
  const parent = start.parentElement;
  if (!parent) return null;
  const startIndex = Array.from(parent.childNodes).indexOf(start);
  if (startIndex < 0) return null;
  const entries: TaskCheckboxCaptionSequenceEntry[] = [];
  const prefixEntries: TaskCheckboxCaptionSequenceEntry[] = [];
  let glyphEntry: TaskCheckboxCaptionSequenceEntry | null = null;

  const visit = (node: Node): 'continue' | 'found' | 'blocked' => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (text.parentElement && !taskCheckboxCaptionWhitespaceSupported(text.parentElement, parent, runtime)) {
        return 'blocked';
      }
      const value = text.nodeValue ?? '';
      if (!value) {
        const path = taskCheckboxCaptionNodePath(parent, text);
        if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
        entries.push({
          element: null,
          glyph: false,
          glyphOffset: 0,
          kind: 'text',
          path,
          prefixLength: 0,
          text,
          value
        });
        return 'continue';
      }
      const prefixLength = taskCheckboxCaptionAsciiPrefixLength(value);
      if (prefixLength === value.length) {
        if (!prefixLength) return 'continue';
        const path = taskCheckboxCaptionNodePath(parent, text);
        if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
        const entry: TaskCheckboxCaptionSequenceEntry = {
          element: null,
          glyph: false,
          glyphOffset: 0,
          kind: 'text',
          path,
          prefixLength,
          text,
          value
        };
        entries.push(entry);
        prefixEntries.push(entry);
        return 'continue';
      }
      const firstGlyph = value[prefixLength] ?? '';
      if (/\s/u.test(firstGlyph)) {
        return 'blocked';
      }
      const path = taskCheckboxCaptionNodePath(parent, text);
      if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      const entry: TaskCheckboxCaptionSequenceEntry = {
        element: null,
        glyph: true,
        glyphOffset: prefixLength,
        kind: 'text',
        path,
        prefixLength,
        text,
        value
      };
      entries.push(entry);
      if (prefixLength) prefixEntries.push(entry);
      glyphEntry = entry;
      return 'found';
    }
    if (!(node instanceof Element)) return 'continue';
    if (taskCheckboxCaptionBoundary(node, parent, runtime)) {
      return 'blocked';
    }
    if (!taskCheckboxCaptionWhitespaceSupported(node, parent, runtime)) {
      return 'blocked';
    }
    const path = taskCheckboxCaptionNodePath(parent, node);
    if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    const entryStart = entries.length;
    entries.push({
      element: node,
      glyph: false,
      glyphOffset: 0,
      kind: 'enter',
      path,
      prefixLength: 0,
      text: null,
      value: ''
    });
    let result: 'continue' | 'found' | 'blocked' = 'continue';
    for (const child of Array.from(node.childNodes)) {
      result = visit(child);
      if (result !== 'continue') break;
    }
    if ('blocked' === result) {
      entries.splice(entryStart);
      while (prefixEntries.length && !entries.includes(prefixEntries[prefixEntries.length - 1] as never)) {
        prefixEntries.pop();
      }
      return 'blocked';
    }
    entries.push({
      element: node,
      glyph: false,
      glyphOffset: 0,
      kind: 'exit',
      path,
      prefixLength: 0,
      text: null,
      value: ''
    });
    return result;
  };

  Array.from(parent.childNodes)
    .slice(startIndex + 1)
    .some((sibling) => {
      const result = visit(sibling);
      return 'found' === result || 'blocked' === result;
    });
  if (!glyphEntry) return null;
  const taskItem = start.closest('li.task-list-item, li') ?? parent;
  return { captionParent: parent, entries, glyphEntry, prefixEntries, taskItem };
}

function taskCheckboxCaptionOwnedTextNodes(start: Element, runtime: BrowserWechatClipboardRuntime): Text[] {
  const parent = start.parentElement;
  if (!parent) return [];
  const startIndex = Array.from(parent.childNodes).indexOf(start);
  if (startIndex < 0) return [];
  const textNodes: Text[] = [];
  let stopped = false;
  const visit = (node: Node): void => {
    if (stopped) return;
    if (node.nodeType === 3) {
      const text = node as Text;
      textNodes.push(text);
      if ((text.nodeValue ?? '').trim()) stopped = true;
      return;
    }
    if (!(node instanceof Element)) return;
    if (taskCheckboxCaptionBoundary(node, parent, runtime)) {
      stopped = true;
      return;
    }
    Array.from(node.childNodes).forEach(visit);
  };
  Array.from(parent.childNodes)
    .slice(startIndex + 1)
    .forEach((sibling) => {
      if (!stopped) visit(sibling);
    });
  return textNodes;
}

function taskCheckboxCaptionSourceHidden(
  source: Element,
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  let current: Element | null = source;
  while (current) {
    const computed = runtime.getComputedStyle(current);
    if (
      ['none'].includes(computed.getPropertyValue('display').trim().toLowerCase()) ||
      ['hidden'].includes(computed.getPropertyValue('content-visibility').trim().toLowerCase()) ||
      ['hidden', 'collapse'].includes(computed.getPropertyValue('visibility').trim().toLowerCase())
    ) {
      return true;
    }
    if (current === sourceRoot) break;
    current = current.parentElement;
  }
  return false;
}

function taskCheckboxCaptionRangeRects(text: Text, start: number, end: number): DOMRect[] {
  const range = text.ownerDocument.createRange();
  try {
    range.setStart(text, start);
    range.setEnd(text, end);
  } catch {
    throw new Error('wechat-task-checkbox-caption-range-unavailable');
  }
  const getClientRects = (range as unknown as { getClientRects?: () => DOMRectList }).getClientRects;
  if ('function' !== typeof getClientRects) throw new Error('wechat-task-checkbox-caption-range-unavailable');
  let rects: DOMRect[];
  try {
    rects = Array.from(getClientRects.call(range));
  } catch {
    throw new Error('wechat-task-checkbox-caption-range-unavailable');
  }
  if (
    !rects.length ||
    !rects.every((rect) =>
      [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)
    )
  ) {
    throw new Error('wechat-task-checkbox-caption-range-unavailable');
  }
  return rects;
}

function taskCheckboxCaptionValidateGeometry(sequence: TaskCheckboxCaptionSequence): boolean {
  let hasPositivePrefixAdvance = false;
  sequence.prefixEntries.forEach(({ prefixLength, text }) => {
    if (!(text instanceof Text)) throw new Error('wechat-task-checkbox-caption-range-unavailable');
    const rects = taskCheckboxCaptionRangeRects(text, 0, prefixLength);
    if (rects.some((rect) => rect.width > 0)) hasPositivePrefixAdvance = true;
  });
  if (hasPositivePrefixAdvance) return false;
  const glyph = sequence.glyphEntry.text;
  if (!(glyph instanceof Text)) throw new Error('wechat-task-checkbox-caption-glyph-geometry-unavailable');
  const codePointLength = String.fromCodePoint(glyph.nodeValue?.codePointAt(sequence.glyphEntry.glyphOffset) ?? 0).length;
  const rects = taskCheckboxCaptionRangeRects(
    glyph,
    sequence.glyphEntry.glyphOffset,
    sequence.glyphEntry.glyphOffset + codePointLength
  );
  if (rects.every((rect) => rect.width <= 0 || rect.height <= 0)) {
    throw new Error('wechat-task-checkbox-caption-glyph-geometry-unavailable');
  }
  return true;
}

function taskCheckboxCaptionSequencePath(root: Node, element: Node): readonly number[] {
  const path = taskCheckboxCaptionNodePath(root, element);
  if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  return path;
}

function taskCheckboxCaptionSequenceMatches(
  expected: TaskCheckboxCaptionSequence,
  actual: TaskCheckboxCaptionSequence,
  expectedRoot: Node,
  actualRoot: Node
): void {
  if (
    taskCheckboxCaptionSequencePath(expectedRoot, expected.captionParent).join('.') !==
      taskCheckboxCaptionSequencePath(actualRoot, actual.captionParent).join('.') ||
    taskCheckboxCaptionSequencePath(expectedRoot, expected.taskItem).join('.') !==
      taskCheckboxCaptionSequencePath(actualRoot, actual.taskItem).join('.') ||
    expected.entries.length !== actual.entries.length
  ) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  expected.entries.forEach((entry, index) => {
    const other = actual.entries[index];
    if (
      !other ||
      entry.kind !== other.kind ||
      entry.glyph !== other.glyph ||
      entry.glyphOffset !== other.glyphOffset ||
      entry.prefixLength !== other.prefixLength ||
      entry.path.join('.') !== other.path.join('.') ||
      entry.value !== other.value ||
      (entry.element?.tagName ?? '') !== (other.element?.tagName ?? '')
    ) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
  });
}

function taskCheckboxCaptionElementChain(start: Element | null, boundary: Element): readonly Element[] | null {
  const chain: Element[] = [];
  let current = start;
  while (current) {
    chain.push(current);
    if (current === boundary) return chain;
    current = current.parentElement;
  }
  return null;
}

function captureTaskCheckboxCaptionRun(
  sourceInput: HTMLInputElement,
  layoutInput: HTMLInputElement,
  cloneOwner: Element,
  sourceRoot: HTMLElement,
  layoutRoot: HTMLElement,
  cloneRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): void {
  const sourceParent = sourceInput.parentElement;
  const layoutParent = layoutInput.parentElement;
  const cloneParent = cloneOwner.parentElement;
  if (!sourceParent || !layoutParent || !cloneParent) {
    throw new Error('wechat-task-checkbox-caption-owner-missing');
  }
  const sourcePath = taskCheckboxCaptionNodePath(sourceRoot, sourceInput);
  const layoutPath = taskCheckboxCaptionNodePath(layoutRoot, layoutInput);
  const clonePath = taskCheckboxCaptionNodePath(cloneRoot, cloneOwner);
  if (
    !sourcePath ||
    !layoutPath ||
    !clonePath ||
    sourcePath.join('.') !== layoutPath.join('.') ||
    sourcePath.join('.') !== clonePath.join('.')
  ) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  taskCheckboxCaptionOwnedTextNodes(layoutInput, runtime).forEach((layoutText) => {
    const path = taskCheckboxCaptionNodePath(layoutParent, layoutText);
    const cloneText = path ? taskCheckboxCaptionNodeAtPath(cloneParent, path) : null;
    if (!(cloneText instanceof Text) || cloneText.nodeValue !== layoutText.nodeValue) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
    TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.add(cloneText);
  });
  const sourcePosition = runtime.getComputedStyle(sourceInput).getPropertyValue('position').trim().toLowerCase();
  const layoutPosition = runtime.getComputedStyle(layoutInput).getPropertyValue('position').trim().toLowerCase();
  if ('absolute' !== sourcePosition || 'absolute' !== layoutPosition) return;
  const sourceSequence = taskCheckboxCaptionSequence(sourceInput, runtime);
  const layoutSequence = taskCheckboxCaptionSequence(layoutInput, runtime);
  if (!sourceSequence && !layoutSequence) {
    return;
  }
  if (!sourceSequence || !layoutSequence) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  taskCheckboxCaptionSequenceMatches(sourceSequence, layoutSequence, sourceRoot, layoutRoot);
  const cloneTaskItem = cloneOwner.closest('li.task-list-item, li') ?? cloneParent;
  if (
    taskCheckboxCaptionSequencePath(cloneRoot, cloneParent).join('.') !==
      taskCheckboxCaptionSequencePath(layoutRoot, layoutParent).join('.') ||
    taskCheckboxCaptionSequencePath(cloneRoot, cloneTaskItem).join('.') !==
      taskCheckboxCaptionSequencePath(layoutRoot, layoutSequence.taskItem).join('.')
  ) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  layoutSequence.entries.forEach((entry) => {
    const cloneNode = taskCheckboxCaptionNodeAtPath(cloneParent, entry.path);
    if (
      (entry.kind === 'text' && (!(cloneNode instanceof Text) || cloneNode.nodeValue !== entry.value)) ||
      (entry.kind !== 'text' &&
        (!(cloneNode instanceof Element) || cloneNode.tagName !== entry.element?.tagName))
    ) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
  });
  const sourceHidden = isPreviewHidden(sourceRoot, runtime) || taskCheckboxCaptionSourceHidden(sourceInput, sourceRoot, runtime);
  if (!layoutSequence.prefixEntries.length) return;
  if (!taskCheckboxCaptionValidateGeometry(layoutSequence)) return;
  if (!sourceHidden && !taskCheckboxCaptionValidateGeometry(sourceSequence)) return;
  const bindings: TaskCheckboxCaptionTextBinding[] = [];
  const cloneEvents: TaskCheckboxCaptionRunEvent[] = [];
  layoutSequence.entries.forEach((entry, index) => {
    const sourceEntry = sourceSequence.entries[index];
    const cloneNode = taskCheckboxCaptionNodeAtPath(cloneParent, entry.path);
    if (entry.kind !== 'text') {
      if (!(cloneNode instanceof Element) || cloneNode.tagName !== entry.element?.tagName) {
        throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      }
      cloneEvents.push({ cloneElement: cloneNode, kind: entry.kind, path: entry.path });
      return;
    }
    const layoutText = entry.text;
    const sourceText = sourceEntry?.text;
    if (
      !(cloneNode instanceof Text) ||
      !(layoutText instanceof Text) ||
      !(sourceText instanceof Text) ||
      !cloneNode.parentElement
    ) {
      if (entry.kind === 'text') throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      return;
    }
    const cloneParentElement = cloneNode.parentElement;
    const cloneAncestors = taskCheckboxCaptionElementChain(cloneParentElement, cloneParent);
    if (!cloneAncestors) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    const original = cloneNode.nodeValue ?? '';
    const encoded = entry.prefixLength ? original.slice(entry.prefixLength) : original;
    if (encoded !== original) cloneNode.nodeValue = encoded;
    const binding: TaskCheckboxCaptionTextBinding = {
      cloneAncestors,
      cloneParent: cloneParentElement,
      cloneText: cloneNode,
      encoded,
      glyph: entry.glyph,
      layoutText,
      original,
      prefixLength: entry.prefixLength,
      sourceText,
      glyphOffset: entry.glyphOffset
    };
    bindings.push(binding);
    TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.add(cloneNode);
    cloneEvents.push({ binding, kind: 'text', path: entry.path });
  });
  const run: TaskCheckboxCaptionRun = {
    cloneCaptionParent: cloneParent,
    cloneEvents,
    cloneOwner,
    cloneTaskItem,
    layoutCaptionParent: layoutParent,
    layoutOwner: layoutInput,
    layoutTaskItem: layoutSequence.taskItem,
    sourceCaptionParent: sourceParent,
    sourceOwner: sourceInput,
    sourceTaskItem: sourceSequence.taskItem,
    bindings
  };
  TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.add(cloneParent);
  cloneEvents.forEach((event) => {
    if (event.kind === 'enter' || event.kind === 'exit') {
      TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.add(event.cloneElement);
    }
  });
  cloneEvents.forEach((event) => {
    if (event.kind !== 'text') return;
    TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.set(event.binding.cloneText, { binding: event.binding, run });
  });
  TASK_LIST_CHECKBOX_CAPTION_RUNS.set(cloneOwner, run);
}

function replaceTaskListCheckboxClones(
  sourceRoot: HTMLElement,
  layoutRoot: HTMLElement,
  cloneRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): HTMLInputElement[] {
  const sourceInputs = Array.from(sourceRoot.querySelectorAll('input')).filter(
    isTaskListCheckbox
  ) as HTMLInputElement[];
  const layoutInputs = Array.from(layoutRoot.querySelectorAll('input')).filter(
    isTaskListCheckbox
  ) as HTMLInputElement[];
  const cloneInputs = Array.from(cloneRoot.querySelectorAll('input')).filter(isTaskListCheckbox);
  if (sourceInputs.length !== layoutInputs.length || sourceInputs.length !== cloneInputs.length) {
    throw new Error('wechat-task-checkbox-clone-alignment-failed');
  }
  const cloneOwners: Element[] = [];
  cloneInputs.forEach((input, index) => {
    const source = sourceInputs[index];
    const layout = layoutInputs[index];
    if (!source || !layout) throw new Error('wechat-task-checkbox-source-alignment-failed');
    const owner = input.ownerDocument.createElement('span');
    TASK_LIST_CHECKBOX_STATES.set(owner, { checked: source.checked });
    input.replaceWith(owner);
    cloneOwners.push(owner);
    captureTaskCheckboxCaptionRun(source, layout, owner, sourceRoot, layoutRoot, cloneRoot, runtime);
  });
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(
    cloneRoot,
    sourceInputs.map((sourceInput, index) => {
      const layoutInput = layoutInputs[index];
      const cloneOwner = cloneOwners[index];
      if (!layoutInput || !cloneOwner) throw new Error('wechat-task-checkbox-source-alignment-failed');
      return {
        cloneOwner,
        clonePath: taskCheckboxCaptionSequencePath(cloneRoot, cloneOwner),
        layoutInput,
        layoutPath: taskCheckboxCaptionSequencePath(layoutRoot, layoutInput),
        sourceInput,
        sourcePath: taskCheckboxCaptionSequencePath(sourceRoot, sourceInput)
      };
    })
  );
  return sourceInputs;
}

function taskListCheckboxFreshnessSignature(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null
): string {
  if (!isTaskListCheckbox(source)) return '';
  const computed = runtime.getComputedStyle(source);
  const semantic = taskCheckboxDimensionOwnerStyle(source, runtime, dimensionSemantics);
  const listItem = source.closest('li.task-list-item, li');
  const listComputed = listItem ? runtime.getComputedStyle(listItem) : null;
  const semanticListComputed = listItem ? taskCheckboxDimensionOwnerStyle(listItem, runtime, dimensionSemantics) : null;
  const pseudoSignatures = (['::before', '::after'] as const).map((pseudo) => {
    const used = runtime.getComputedStyle(source, pseudo);
    const original = taskCheckboxDimensionOwnerStyle(source, runtime, dimensionSemantics, pseudo);
    return `${pseudo}:used=${taskCheckboxGeometryStyleSignature(
      used,
      TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES
    )};source=${taskCheckboxGeometryStyleSignature(original, TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES)}`;
  });
  const rect = source.getBoundingClientRect();
  const state = (source as HTMLInputElement).checked ? '1' : '0';
  const checkedAttribute = source.hasAttribute('checked') ? '1' : '0';
  const style = TASK_LIST_CHECKBOX_STYLE_PROPERTIES.map(
    (property) => `${property}=${computed.getPropertyValue(property)}`
  ).join(';');
  const sourceStyle = TASK_LIST_CHECKBOX_STYLE_PROPERTIES.map(
    (property) => `${property}=${semantic.getPropertyValue(property)}`
  ).join(';');
  const inputGeometry = taskCheckboxGeometryStyleSignature(computed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES);
  const sourceInputGeometry = taskCheckboxGeometryStyleSignature(semantic, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES);
  const inputPaint = taskCheckboxGeometryStyleSignature(computed, TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES);
  const sourceInputPaint = taskCheckboxGeometryStyleSignature(semantic, TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES);
  const listGeometry = listComputed
    ? taskCheckboxGeometryStyleSignature(listComputed, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES)
    : '';
  const sourceListGeometry = semanticListComputed
    ? taskCheckboxGeometryStyleSignature(semanticListComputed, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES)
    : '';
  const listPaint = listComputed
    ? taskCheckboxGeometryStyleSignature(listComputed, TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES)
    : '';
  const sourceListPaint = semanticListComputed
    ? taskCheckboxGeometryStyleSignature(semanticListComputed, TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES)
    : '';
  return [
    `task-checkbox:checked=${state};checked-attribute=${checkedAttribute};${style}`,
    `source=${sourceStyle}`,
    `used-input=${inputGeometry}`,
    `source-input=${sourceInputGeometry}`,
    `used-input-paint=${inputPaint}`,
    `source-input-paint=${sourceInputPaint}`,
    `used-list=${listGeometry}`,
    `source-list=${sourceListGeometry}`,
    `used-list-paint=${listPaint}`,
    `source-list-paint=${sourceListPaint}`,
    ...pseudoSignatures,
    `used-row-geometry=${taskCheckboxRowGeometrySignature(source, runtime)}`,
    `used-rect=${rect.width},${rect.height}`
  ].join(';');
}

function taskCheckboxDimensionOwnerStyle(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  pseudoElement?: '::before' | '::after'
): CSSStyleDeclaration {
  if (!dimensionSemantics) return runtime.getComputedStyle(source, pseudoElement);
  const owner = dimensionSemantics.getComputedStyle(source, pseudoElement);
  if (!owner) throw new Error('wechat-task-checkbox-geometry-dimension-owner-missing');
  return owner;
}

function taskCheckboxSourceCurrentnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if (!isTaskListCheckbox(source)) return '';
  const input = runtime.getComputedStyle(source);
  const listItem = source.closest('li.task-list-item, li');
  const list = listItem ? runtime.getComputedStyle(listItem) : null;
  const pseudo = (['::before', '::after'] as const).map(
    (pseudoElement) =>
      `${pseudoElement}=${taskCheckboxGeometryStyleSignature(
        runtime.getComputedStyle(source, pseudoElement),
        TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES
      )}`
  );
  return [
    `checked=${(source as HTMLInputElement).checked ? '1' : '0'}`,
    `checked-attribute=${source.hasAttribute('checked') ? '1' : '0'}`,
    `input=${taskCheckboxGeometryStyleSignature(input, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES)}`,
    `input-paint=${taskCheckboxGeometryStyleSignature(input, TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES)}`,
    `list=${list ? taskCheckboxGeometryStyleSignature(list, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES) : ''}`,
    `list-paint=${list ? taskCheckboxGeometryStyleSignature(list, TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES) : ''}`,
    ...pseudo
  ].join(';');
}

const TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES = [
  'display',
  'width',
  'height',
  'position',
  'box-sizing',
  'appearance',
  '-webkit-appearance',
  'accent-color',
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
  'transform',
  'transform-origin',
  'transform-box',
  'opacity',
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'font-weight'
] as const;
const TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES = [
  'content',
  'display',
  'width',
  'height',
  'position',
  'box-sizing',
  'top',
  'right',
  'bottom',
  'left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'transform',
  'transform-origin',
  'transform-box',
  'opacity',
  'font-family',
  'font-size',
  'line-height',
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style'
] as const;
const TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'opacity',
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'white-space',
  'vertical-align'
] as const;
const TASK_CHECKBOX_ROOT_STYLE_PROPERTIES = [
  'box-sizing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing'
] as const;

const TASK_CHECKBOX_INPUT_LAYOUT_STYLE_PROPERTIES = new Set([
  'width',
  'height',
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
  'transform',
  'transform-origin'
]);
const TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left'
]);
const TASK_CHECKBOX_PSEUDO_LAYOUT_STYLE_PROPERTIES = new Set([
  'width',
  'height',
  'top',
  'right',
  'bottom',
  'left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'transform',
  'transform-origin'
]);
const TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'opacity',
  'font-family',
  'font-size',
  'line-height',
  'font-weight'
] as const;
const TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'opacity',
  'font-family',
  'font-size',
  'line-height',
  'font-weight'
] as const;

const TASK_CHECKBOX_BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

function taskCheckboxPaintValueIsVisible(property: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['none', 'normal', 'transparent'].includes(normalized)) return false;
  if ('background-color' === property && /^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(normalized)) {
    return false;
  }
  return true;
}

function taskCheckboxBorderWidthIsVisible(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && !['0', '0px', 'none'].includes(normalized));
}

function taskCheckboxStaticPaintProperties(computed: CSSStyleDeclaration): string[] {
  const properties: string[] = [];
  const backgroundProperties = TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES.filter((property) =>
    ['background', 'background-color', 'background-image', 'box-shadow', 'filter'].includes(property)
  );
  backgroundProperties.forEach((property) => {
    if (taskCheckboxPaintValueIsVisible(property, computed.getPropertyValue(property))) {
      properties.push(property);
    }
  });
  TASK_CHECKBOX_BORDER_SIDES.forEach((side) => {
    const widthProperty = `border-${side}-width`;
    const styleProperty = `border-${side}-style`;
    const colorProperty = `border-${side}-color`;
    if (
      taskCheckboxBorderWidthIsVisible(computed.getPropertyValue(widthProperty)) &&
      taskCheckboxPaintValueIsVisible(styleProperty, computed.getPropertyValue(styleProperty))
    ) {
      properties.push(widthProperty, styleProperty);
      if (taskCheckboxPaintValueIsVisible(colorProperty, computed.getPropertyValue(colorProperty))) {
        properties.push(colorProperty);
      }
    }
  });
  return [...new Set(properties)];
}

function taskCheckboxStaticPaintExpectationFor(clone: Element): TaskCheckboxStaticPaintExpectation {
  let expectation = TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.get(clone);
  if (!expectation) {
    expectation = { baseProperties: [], pseudos: new Map() };
    TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.set(clone, expectation);
  }
  return expectation;
}

function taskCheckboxOutputPropertyIsVisible(owner: Element, property: string): boolean {
  const style = (owner as Element & { style?: CSSStyleDeclaration }).style;
  const value = style?.getPropertyValue(property) ?? '';
  if (property.endsWith('-width')) return taskCheckboxBorderWidthIsVisible(value);
  return taskCheckboxPaintValueIsVisible(property, value);
}

function taskCheckboxOutputMarkers(owner: Element, pseudo: '::before' | '::after'): Element[] {
  return Array.from(owner.querySelectorAll('*')).filter(
    (element) => TASK_LIST_CHECKBOX_PSEUDO_CLONES.get(element) === pseudo
  );
}

function taskCheckboxSvgPaintSignature(svg: Element): string | null {
  if ('svg' !== svg.localName.toLowerCase()) return null;
  const viewBox = svg.getAttribute('viewBox')?.trim();
  const paths = Array.from(svg.querySelectorAll('path'));
  if (!viewBox || !paths.length) return null;
  const pathSignatures = paths.map((path) => {
    const d = path.getAttribute('d')?.trim();
    if (!d) return null;
    return [
      d,
      path.getAttribute('fill')?.trim().toLowerCase() ?? 'black',
      path.getAttribute('fill-opacity')?.trim() ?? '1',
      path.getAttribute('stroke')?.trim().toLowerCase() ?? 'none',
      path.getAttribute('stroke-opacity')?.trim() ?? '1',
      path.getAttribute('stroke-width')?.trim() ?? '1'
    ].join('|');
  });
  if (pathSignatures.some((signature) => null === signature)) return null;
  return `${viewBox}|${pathSignatures.join('||')}`;
}

function taskCheckboxGeometryStyleSignature(computed: CSSStyleDeclaration, properties: readonly string[]): string {
  return properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';');
}

const TASK_CHECKBOX_DIMENSION_PROPERTIES = ['width', 'height'] as const;

function taskCheckboxGeometryStyleSignatureWithoutLayout(
  computed: CSSStyleDeclaration,
  properties: readonly string[],
  layoutProperties: ReadonlySet<string>
): string {
  return properties
    .filter((property) => !layoutProperties.has(property))
    .map((property) => `${property}=${computed.getPropertyValue(property)}`)
    .join(';');
}

function taskCheckboxDimensionStamp(computed: CSSStyleDeclaration): string {
  return [
    ...TASK_CHECKBOX_DIMENSION_PROPERTIES,
    'box-sizing',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'transform'
  ]
    .map((property) => `${property}=${computed.getPropertyValue(property).trim()}`)
    .join(';');
}

function taskCheckboxDimensionEdge(computed: CSSStyleDeclaration, property: string): number {
  const value = finiteCssPixelValue(computed.getPropertyValue(property));
  if (null === value || value < 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  return value;
}

function taskCheckboxDimensionConstraint(
  computed: CSSStyleDeclaration,
  property: 'min-width' | 'max-width' | 'min-height' | 'max-height'
): number | null {
  const value = computed.getPropertyValue(property).trim().toLowerCase();
  const unbounded = property.startsWith('min-') ? 'auto' : 'none';
  if (value === unbounded) return null;
  const pixel = finiteCssPixelValue(value);
  if (null === pixel || pixel < 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  return pixel;
}

type TaskCheckboxTransformState = Readonly<{
  format: 'literal' | 'matrix2d' | 'matrix3d';
  kind: 'literal-none' | 'identity-matrix' | 'active-matrix';
  matrix: readonly number[];
}>;

const TASK_CHECKBOX_IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

function taskCheckboxTransformState(value: string, errorCode: string): TaskCheckboxTransformState {
  const normalized = value.trim().toLowerCase();
  if ('none' === normalized) {
    return { format: 'literal', kind: 'literal-none', matrix: TASK_CHECKBOX_IDENTITY_MATRIX };
  }
  if (!normalized) throw new Error(errorCode);
  const twoDimensional = /^matrix\(([^)]+)\)$/u.exec(normalized);
  const threeDimensional = /^matrix3d\(([^)]+)\)$/u.exec(normalized);
  let matrix: number[];
  let format: 'matrix2d' | 'matrix3d';
  if (twoDimensional) {
    const rawValues = twoDimensional[1];
    if (undefined === rawValues) throw new Error(errorCode);
    const values = rawValues.split(',').map((token) => taskCheckboxStrictNumber(token.trim()));
    if (6 !== values.length || values.some((value) => null === value)) {
      throw new Error(errorCode);
    }
    const [a, b, c, d, e, f] = values;
    if (
      undefined === a ||
      undefined === b ||
      undefined === c ||
      undefined === d ||
      undefined === e ||
      undefined === f ||
      null === a ||
      null === b ||
      null === c ||
      null === d ||
      null === e ||
      null === f
    )
      throw new Error(errorCode);
    matrix = [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
    format = 'matrix2d';
  } else if (threeDimensional) {
    const rawValues = threeDimensional[1];
    if (undefined === rawValues) throw new Error(errorCode);
    const values = rawValues.split(',').map((token) => taskCheckboxStrictNumber(token.trim()));
    if (16 !== values.length || values.some((value) => null === value)) {
      throw new Error(errorCode);
    }
    matrix = values.map((value) => value as number);
    format = 'matrix3d';
  } else {
    throw new Error(errorCode);
  }
  const identity = matrix.every((value, index) => value === TASK_CHECKBOX_IDENTITY_MATRIX[index]);
  return { format, kind: identity ? 'identity-matrix' : 'active-matrix', matrix };
}

function taskCheckboxInputTransformIsAllowed(transform: TaskCheckboxTransformState): boolean {
  if ('literal-none' === transform.kind) return true;
  if ('matrix2d' !== transform.format || 16 !== transform.matrix.length) return false;
  const matrix = transform.matrix;
  return (
    1 === matrix[0] &&
    0 === matrix[1] &&
    0 === matrix[2] &&
    0 === matrix[3] &&
    0 === matrix[4] &&
    1 === matrix[5] &&
    0 === matrix[6] &&
    0 === matrix[7] &&
    0 === matrix[8] &&
    0 === matrix[9] &&
    1 === matrix[10] &&
    0 === matrix[11] &&
    0 === matrix[14] &&
    1 === matrix[15]
  );
}

function taskCheckboxStrictNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const TASK_CHECKBOX_USED_ENUM_VALUES = new Set([
  'auto',
  'border-box',
  'content-box',
  'fit-content',
  'fixed',
  'max-content',
  'min-content',
  'normal',
  'none',
  'relative',
  'static',
  'sticky',
  'stretch'
]);

function taskCheckboxValidateUsedLayoutValues(
  computed: CSSStyleDeclaration,
  properties: readonly string[],
  errorCode: string
): void {
  properties.forEach((property) => {
    const raw = computed.getPropertyValue(property).trim().toLowerCase();
    if (!raw) {
      throw new Error(errorCode);
    }
    if (finiteCssPixelValue(raw) !== null || '0' === raw || CSS_PERCENTAGE_TOKEN.test(raw)) {
      return;
    }
    if (/^(?:calc|min|max|clamp)\(/u.test(raw)) return;
    if (TASK_CHECKBOX_USED_ENUM_VALUES.has(raw)) return;
    throw new Error(errorCode);
  });
}

function taskCheckboxUntransformedBorderBoxDimension(
  computed: CSSStyleDeclaration,
  property: 'width' | 'height'
): number {
  const value = finiteCssPixelValue(computed.getPropertyValue(property));
  if (null === value || value <= 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  const boxSizing = computed.getPropertyValue('box-sizing').trim().toLowerCase();
  if (!['border-box', 'content-box'].includes(boxSizing)) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  const horizontal = 'width' === property;
  const edges = horizontal
    ? [
        taskCheckboxDimensionEdge(computed, 'padding-left'),
        taskCheckboxDimensionEdge(computed, 'padding-right'),
        taskCheckboxDimensionEdge(computed, 'border-left-width'),
        taskCheckboxDimensionEdge(computed, 'border-right-width')
      ]
    : [
        taskCheckboxDimensionEdge(computed, 'padding-top'),
        taskCheckboxDimensionEdge(computed, 'padding-bottom'),
        taskCheckboxDimensionEdge(computed, 'border-top-width'),
        taskCheckboxDimensionEdge(computed, 'border-bottom-width')
      ];
  const edgeSum = edges.reduce((sum, edge) => sum + edge, 0);
  const contentBox = 'content-box' === boxSizing;
  let borderBox = contentBox ? value + edgeSum : Math.max(value, edgeSum);
  const min = taskCheckboxDimensionConstraint(computed, horizontal ? 'min-width' : 'min-height');
  const max = taskCheckboxDimensionConstraint(computed, horizontal ? 'max-width' : 'max-height');
  const borderBoxMin = null !== min && contentBox ? min + edgeSum : min;
  const borderBoxMax = null !== max && contentBox ? max + edgeSum : max;
  if (null !== borderBoxMin && null !== borderBoxMax && borderBoxMin > borderBoxMax) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  if (null !== borderBoxMin) borderBox = Math.max(borderBox, borderBoxMin);
  if (null !== borderBoxMax) borderBox = Math.min(borderBox, borderBoxMax);
  borderBox = Math.max(borderBox, edgeSum);
  if (!Number.isFinite(borderBox) || borderBox <= 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  return borderBox;
}

type TaskCheckboxHiddenInputDimensions = Readonly<{ height: number; sourceStamp: string; width: number }>;

function taskCheckboxHiddenInputDimensions(
  measurement: Element,
  sourceComputed: CSSStyleDeclaration,
  measurementComputed: CSSStyleDeclaration,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): TaskCheckboxHiddenInputDimensions {
  const originalComputed = dimensionSemantics?.getComputedStyle(measurement);
  if (!originalComputed) {
    throw new Error('wechat-task-checkbox-geometry-dimension-owner-missing');
  }
  const sourceStamp = taskCheckboxDimensionStamp(sourceComputed);
  if (sourceStamp !== taskCheckboxDimensionStamp(originalComputed)) {
    throw new Error('wechat-task-checkbox-geometry-source-dimensions-stale');
  }
  const transform = taskCheckboxTransformState(
    measurementComputed.getPropertyValue('transform'),
    'wechat-task-checkbox-geometry-input-transform-unavailable'
  );
  if (!taskCheckboxInputTransformIsAllowed(transform)) {
    throw new Error('wechat-task-checkbox-geometry-input-transform-unavailable');
  }
  return {
    height: taskCheckboxUntransformedBorderBoxDimension(sourceComputed, 'height'),
    sourceStamp,
    width: taskCheckboxUntransformedBorderBoxDimension(sourceComputed, 'width')
  };
}

function taskCheckboxFiniteRect(element: Element, label: string): DOMRect {
  const rect = element.getBoundingClientRect();
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height];
  if (!values.every(Number.isFinite)) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  return rect;
}

function taskCheckboxPositiveRect(element: Element, label: string): DOMRect {
  const rect = taskCheckboxFiniteRect(element, label);
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  return rect;
}

function taskCheckboxPositiveDomRect(rect: DOMRect, label: string): DOMRect {
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  return rect;
}

function taskCheckboxContentWidth(element: Element, runtime: BrowserWechatClipboardRuntime, label: string): number {
  const rect = taskCheckboxFiniteRect(element, label);
  const computed = runtime.getComputedStyle(element);
  const edges = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].map((property) => {
    const value = computed.getPropertyValue(property).trim();
    if (!value) {
      throw new Error(`wechat-task-checkbox-geometry-${label}-content-width-unavailable`);
    }
    const pixel = finiteCssPixelValue(value);
    if (null === pixel || pixel < 0) {
      throw new Error(`wechat-task-checkbox-geometry-${label}-content-width-unavailable`);
    }
    return pixel;
  });
  const width = rect.width - edges.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-content-width-unavailable`);
  }
  return width;
}

function taskCheckboxTextNodeIsNonPaint(
  node: Node,
  boundary: Element,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  const owner = node.parentElement;
  if (!owner) return true;
  const ownerVisibility = runtime.getComputedStyle(owner).getPropertyValue('visibility').trim().toLowerCase();
  if ('hidden' === ownerVisibility) return true;
  let current: Element | null = owner;
  while (current) {
    const localName = current.localName.toLowerCase();
    if (['annotation', 'annotation-xml', 'defs', 'title'].includes(localName)) return true;
    const computed = runtime.getComputedStyle(current);
    if (
      ['none'].includes(computed.getPropertyValue('display').trim().toLowerCase()) ||
      ['hidden'].includes(computed.getPropertyValue('content-visibility').trim().toLowerCase())
    ) {
      return true;
    }
    if (current === boundary) break;
    current = current.parentElement;
  }
  return false;
}

function taskCheckboxTextAnchorRects(element: Element, runtime: BrowserWechatClipboardRuntime): DOMRect[] {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4);
  const rects: DOMRect[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue?.trim() && !taskCheckboxTextNodeIsNonPaint(node, element, runtime)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const getClientRects = (range as unknown as { getClientRects?: () => DOMRectList }).getClientRects;
      if ('function' !== typeof getClientRects) {
        throw new Error('wechat-task-checkbox-geometry-text-fragment-owner-missing');
      }
      const lineRects = Array.from(getClientRects.call(range));
      if (!lineRects.length) {
        throw new Error('wechat-task-checkbox-geometry-text-fragment-empty');
      }
      rects.push(...lineRects);
    }
    node = walker.nextNode();
  }
  if (
    !rects.every((rect) => {
      const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height];
      return values.every(Number.isFinite);
    })
  ) {
    throw new Error('wechat-task-checkbox-geometry-text-anchor-unavailable');
  }
  return rects;
}

function taskCheckboxTextAnchor(element: Element, runtime: BrowserWechatClipboardRuntime): DOMRect | null {
  const rects = taskCheckboxTextAnchorRects(element, runtime);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { bottom, height: bottom - top, left, right, top, width: right - left } as DOMRect;
}

function taskCheckboxRelativeRectSignature(rect: DOMRect, origin: DOMRect): string {
  const values = [
    rect.left - origin.left,
    rect.top - origin.top,
    rect.right - origin.left,
    rect.bottom - origin.top,
    rect.width,
    rect.height
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error('wechat-task-checkbox-geometry-row-unavailable');
  }
  return values.join(',');
}

function taskCheckboxRowGeometrySignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if (!taskCheckboxNeedsGeometry(source, runtime)) return 'not-required';
  const sourceParent = source.parentElement;
  if (!sourceParent) return 'source-parent=none';
  const sourceParentRect = sourceParent.getBoundingClientRect();
  const inputRect = source.getBoundingClientRect();
  const listItem = source.closest('li.task-list-item, li');
  const listParent = listItem?.parentElement ?? null;
  const listItemRect = listItem?.getBoundingClientRect() ?? null;
  const listParentRect = listParent?.getBoundingClientRect() ?? null;
  const anchor = taskCheckboxTextAnchor(sourceParent, runtime);
  const textLines = taskCheckboxTextAnchorRects(sourceParent, runtime);
  const parts = [
    `input=${taskCheckboxRelativeRectSignature(inputRect, sourceParentRect)}`,
    `source-parent=${taskCheckboxRelativeRectSignature(sourceParentRect, listItemRect ?? sourceParentRect)}`,
    `anchor=${anchor ? taskCheckboxRelativeRectSignature(anchor, sourceParentRect) : 'none'}`,
    `text-lines=${
      textLines.length
        ? textLines.map((rect) => taskCheckboxRelativeRectSignature(rect, sourceParentRect)).join('|')
        : 'none'
    }`
  ];
  if (listItemRect && listParentRect) {
    const rowParent = listParent;
    if (!rowParent) throw new Error('wechat-task-checkbox-geometry-row-unavailable');
    parts.push(`list-item=${taskCheckboxRelativeRectSignature(listItemRect, listParentRect)}`);
    parts.push(`row-owner=${rowParent.tagName}`);
  } else {
    parts.push('list-item=none', 'row-owner=none');
  }
  return parts.join(';');
}

function taskCheckboxGeometryRectMatches(
  sourceRect: DOMRect,
  measurementRect: DOMRect,
  label: string,
  sourceOrigin?: DOMRect,
  measurementOrigin?: DOMRect,
  requirePositive = true
): void {
  const sourceLeft = sourceOrigin ? sourceRect.left - sourceOrigin.left : sourceRect.left;
  const sourceRight = sourceOrigin ? sourceRect.right - sourceOrigin.left : sourceRect.right;
  const sourceTop = sourceOrigin ? sourceRect.top - sourceOrigin.top : sourceRect.top;
  const sourceBottom = sourceOrigin ? sourceRect.bottom - sourceOrigin.top : sourceRect.bottom;
  const measurementLeft = measurementOrigin ? measurementRect.left - measurementOrigin.left : measurementRect.left;
  const measurementRight = measurementOrigin ? measurementRect.right - measurementOrigin.left : measurementRect.right;
  const measurementTop = measurementOrigin ? measurementRect.top - measurementOrigin.top : measurementRect.top;
  const measurementBottom = measurementOrigin ? measurementRect.bottom - measurementOrigin.top : measurementRect.bottom;
  const values = [
    sourceLeft,
    sourceRight,
    sourceTop,
    sourceBottom,
    sourceRect.width,
    sourceRect.height,
    measurementLeft,
    measurementRight,
    measurementTop,
    measurementBottom,
    measurementRect.width,
    measurementRect.height
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  if (
    requirePositive &&
    (sourceRect.width <= 0 || sourceRect.height <= 0 || measurementRect.width <= 0 || measurementRect.height <= 0)
  ) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  const tolerance = MERMAID_ASPECT_RATIO_QUANTUM;
  if (
    Math.abs(sourceLeft - measurementLeft) > tolerance ||
    Math.abs(sourceRight - measurementRight) > tolerance ||
    Math.abs(sourceTop - measurementTop) > tolerance ||
    Math.abs(sourceBottom - measurementBottom) > tolerance ||
    Math.abs(sourceRect.width - measurementRect.width) > tolerance ||
    Math.abs(sourceRect.height - measurementRect.height) > tolerance
  ) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-mismatch`);
  }
}

function createTaskCheckboxGeometryContext(
  lease: TaskCheckboxGeometryLease | null,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): TaskCheckboxGeometryContext | null {
  if (!lease) return null;
  let rootValidated = false;
  const sourceDimensionStamps = new WeakMap<Element, string>();
  const sourceCurrentnessStamps = new WeakMap<Element, string>();
  const validate = (source: Element, clone: Element, computed: CSSStyleDeclaration): void => {
    const sourceElement = lease.sourceFor(source) ?? source;
    if (!isTaskListCheckbox(sourceElement)) return;
    const capturedState = TASK_LIST_CHECKBOX_STATES.get(clone);
    if (!capturedState || capturedState.checked !== (sourceElement as HTMLInputElement).checked) {
      throw new Error('wechat-task-checkbox-static-owner-state-mismatch');
    }
    if (!taskCheckboxNeedsGeometry(sourceElement, runtime)) return;
    if (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');
    if (clipboardSourceMarkup(lease.sourceRoot) !== lease.sourceMarkup) {
      throw new Error('wechat-task-checkbox-geometry-source-stale');
    }
    const currentSourceWidthKey = previewWorkspaceMeasurementWidth(lease.sourceRoot, runtime);
    if (
      null === currentSourceWidthKey ||
      null === lease.sourceWidthKey ||
      Math.abs(currentSourceWidthKey - lease.sourceWidthKey) > MERMAID_ASPECT_RATIO_QUANTUM
    ) {
      throw new Error('wechat-task-checkbox-geometry-source-width-stale');
    }
    const measurement = lease.measurementFor(sourceElement);
    if (!measurement) throw new Error('wechat-task-checkbox-geometry-owner-missing');
    if (!rootValidated) {
      const sourceRootComputed = runtime.getComputedStyle(lease.sourceRoot);
      const measurementRootComputed = runtime.getComputedStyle(lease.root);
      if (
        taskCheckboxGeometryStyleSignature(sourceRootComputed, TASK_CHECKBOX_ROOT_STYLE_PROPERTIES) !==
        taskCheckboxGeometryStyleSignature(measurementRootComputed, TASK_CHECKBOX_ROOT_STYLE_PROPERTIES)
      ) {
        throw new Error('wechat-task-checkbox-geometry-root-style-mismatch');
      }
      const sourceRootRect = taskCheckboxFiniteRect(lease.sourceRoot, 'root');
      const measurementRootRect = taskCheckboxFiniteRect(lease.root, 'measurement-root');
      const measurementContentWidth = taskCheckboxContentWidth(lease.root, runtime, 'measurement-root');
      if (measurementRootRect.width <= 0 || measurementContentWidth <= 0) {
        throw new Error('wechat-task-checkbox-geometry-root-content-width-unavailable');
      }
      if ('source' === lease.sourceGeometryReference) {
        if (sourceRootRect.width <= 0 || sourceRootRect.height <= 0) {
          throw new Error('wechat-task-checkbox-geometry-root-unavailable');
        }
        const sourceContentWidth = taskCheckboxContentWidth(lease.sourceRoot, runtime, 'root');
        if (Math.abs(sourceContentWidth - measurementContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM) {
          throw new Error('wechat-task-checkbox-geometry-root-content-width-mismatch');
        }
      }
      rootValidated = true;
    }
    const measurementComputed = runtime.getComputedStyle(measurement);
    const sourceComputed = runtime.getComputedStyle(sourceElement);
    const currentnessStamp = taskCheckboxSourceCurrentnessSignature(sourceElement, runtime);
    const previousCurrentnessStamp = sourceCurrentnessStamps.get(sourceElement);
    if (previousCurrentnessStamp && previousCurrentnessStamp !== currentnessStamp) {
      throw new Error('wechat-task-checkbox-geometry-source-currentness-stale');
    }
    if (!previousCurrentnessStamp) sourceCurrentnessStamps.set(sourceElement, currentnessStamp);
    let hiddenInputDimensions: TaskCheckboxHiddenInputDimensions | null = null;
    if ('measurement' === lease.sourceGeometryReference && 'INPUT' === sourceElement.tagName) {
      hiddenInputDimensions = taskCheckboxHiddenInputDimensions(
        measurement,
        sourceComputed,
        measurementComputed,
        dimensionSemantics
      );
      const previousStamp = sourceDimensionStamps.get(sourceElement);
      if (previousStamp && previousStamp !== hiddenInputDimensions.sourceStamp) {
        throw new Error('wechat-task-checkbox-geometry-source-dimensions-stale');
      }
      if (!previousStamp) {
        sourceDimensionStamps.set(sourceElement, hiddenInputDimensions.sourceStamp);
      }
    }
    const hiddenMeasurement = 'measurement' === lease.sourceGeometryReference;
    const styleSignature = hiddenMeasurement
      ? (value: CSSStyleDeclaration, properties: readonly string[]) =>
          taskCheckboxGeometryStyleSignatureWithoutLayout(
            value,
            properties,
            TASK_CHECKBOX_INPUT_LAYOUT_STYLE_PROPERTIES
          )
      : taskCheckboxGeometryStyleSignature;
    const measurementRect = taskCheckboxPositiveRect(measurement, 'checkbox-measurement');
    if (hiddenInputDimensions) {
      if (
        Math.abs(measurementRect.width - hiddenInputDimensions.width) > MERMAID_ASPECT_RATIO_QUANTUM ||
        Math.abs(measurementRect.height - hiddenInputDimensions.height) > MERMAID_ASPECT_RATIO_QUANTUM
      ) {
        throw new Error('wechat-task-checkbox-geometry-input-dimensions-mismatch');
      }
    }
    if (
      styleSignature(sourceComputed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES) !==
        styleSignature(computed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES) ||
      styleSignature(sourceComputed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES) !==
        styleSignature(measurementComputed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES)
    ) {
      throw new Error('wechat-task-checkbox-geometry-style-mismatch');
    }
    const sourceParent = sourceElement.parentElement;
    const measurementParent = measurement.parentElement;
    if (!sourceParent || !measurementParent) {
      throw new Error('wechat-task-checkbox-geometry-parent-missing');
    }
    const sourceRect = taskCheckboxFiniteRect(sourceElement, 'checkbox-source');
    if ('source' === lease.sourceGeometryReference) {
      taskCheckboxGeometryRectMatches(
        sourceRect,
        measurementRect,
        'checkbox',
        sourceParent.getBoundingClientRect(),
        measurementParent.getBoundingClientRect()
      );
    }
    const sourceParentRect = taskCheckboxFiniteRect(sourceParent, 'flow-source');
    const measurementParentRect = taskCheckboxPositiveRect(measurementParent, 'flow-measurement');
    if ('source' === lease.sourceGeometryReference) {
      taskCheckboxGeometryRectMatches(
        sourceParentRect,
        measurementParentRect,
        'flow',
        sourceParent.parentElement?.getBoundingClientRect(),
        measurementParent.parentElement?.getBoundingClientRect()
      );
    }
    const sourceListItem = sourceElement.closest('li.task-list-item, li');
    const measurementListItem = measurement.closest('li.task-list-item, li');
    if (!sourceListItem || !measurementListItem) {
      throw new Error('wechat-task-checkbox-geometry-list-item-missing');
    }
    const listItemStyleSignature = hiddenMeasurement
      ? (value: CSSStyleDeclaration) =>
          taskCheckboxGeometryStyleSignatureWithoutLayout(
            value,
            TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES,
            TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES
          )
      : (value: CSSStyleDeclaration) =>
          taskCheckboxGeometryStyleSignature(value, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES);
    if (
      listItemStyleSignature(runtime.getComputedStyle(sourceListItem)) !==
      listItemStyleSignature(runtime.getComputedStyle(measurementListItem))
    ) {
      throw new Error('wechat-task-checkbox-geometry-list-item-style-mismatch');
    }
    const sourceListParent = sourceListItem.parentElement;
    const measurementListParent = measurementListItem.parentElement;
    const sourceListItemRect = taskCheckboxFiniteRect(sourceListItem, 'list-item-source');
    const measurementListItemRect = taskCheckboxPositiveRect(measurementListItem, 'list-item-measurement');
    if (hiddenMeasurement) {
      taskCheckboxValidateUsedLayoutValues(
        runtime.getComputedStyle(measurementListItem),
        [...TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES],
        'wechat-task-checkbox-geometry-list-item-style-unavailable'
      );
    }
    if ('source' === lease.sourceGeometryReference) {
      taskCheckboxGeometryRectMatches(
        sourceListItemRect,
        measurementListItemRect,
        'list-item',
        sourceListParent?.getBoundingClientRect(),
        measurementListParent?.getBoundingClientRect()
      );
    }
    const measurementAnchor = taskCheckboxTextAnchor(measurementParent, runtime);
    if ('measurement' === lease.sourceGeometryReference) {
      if (!measurementAnchor) throw new Error('wechat-task-checkbox-geometry-text-anchor-missing');
      taskCheckboxPositiveRect(measurementParent, 'text-anchor-measurement-owner');
      taskCheckboxPositiveDomRect(measurementAnchor, 'text-anchor-measurement');
    } else {
      const sourceAnchor = taskCheckboxTextAnchor(sourceParent, runtime);
      if (sourceAnchor && measurementAnchor) {
        taskCheckboxGeometryRectMatches(
          sourceAnchor,
          measurementAnchor,
          'text-anchor',
          sourceParent.getBoundingClientRect(),
          measurementParent.getBoundingClientRect()
        );
      } else if (sourceAnchor || measurementAnchor) {
        throw new Error('wechat-task-checkbox-geometry-text-anchor-missing');
      }
    }
    (['::before', '::after'] as const).forEach((pseudo) => {
      const sourcePseudo = runtime.getComputedStyle(sourceElement, pseudo);
      const measurementPseudo = runtime.getComputedStyle(measurement, pseudo);
      const pseudoStyleSignature = hiddenMeasurement
        ? (value: CSSStyleDeclaration) =>
            taskCheckboxGeometryStyleSignatureWithoutLayout(
              value,
              TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES,
              TASK_CHECKBOX_PSEUDO_LAYOUT_STYLE_PROPERTIES
            )
        : (value: CSSStyleDeclaration) =>
            taskCheckboxGeometryStyleSignature(value, TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES);
      if (pseudoStyleSignature(sourcePseudo) !== pseudoStyleSignature(measurementPseudo)) {
        throw new Error('wechat-task-checkbox-geometry-pseudo-mismatch');
      }
    });
    if (
      hiddenInputDimensions &&
      taskCheckboxDimensionStamp(runtime.getComputedStyle(sourceElement)) !== hiddenInputDimensions.sourceStamp
    ) {
      throw new Error('wechat-task-checkbox-geometry-source-dimensions-stale');
    }
    if (taskCheckboxSourceCurrentnessSignature(sourceElement, runtime) !== currentnessStamp) {
      throw new Error('wechat-task-checkbox-geometry-source-currentness-stale');
    }
  };
  return { cleanup: () => undefined, validate };
}

function assertTaskCheckboxAppearancePortable(source: Element, computed: CSSStyleDeclaration): void {
  if (!isTaskListCheckbox(source)) return;
  const appearance =
    computed.getPropertyValue('appearance').trim().toLowerCase() ||
    computed.getPropertyValue('-webkit-appearance').trim().toLowerCase();
  if (appearance && 'none' !== appearance) {
    throw new Error('wechat-task-checkbox-native-paint-unavailable');
  }
}

type ListMarkerCandidate = Readonly<{
  direction: 'ltr' | 'rtl';
  listType: string;
  sourceWidth: number;
  items: ReadonlyArray<{ markerFont: CSSStyleDeclaration; source: Element }>;
  signature: string;
}>;

function listMarkerDirection(source: Element, computed: CSSStyleDeclaration): 'ltr' | 'rtl' | null {
  const value = computed.getPropertyValue('direction').trim().toLowerCase();
  if ('ltr' === value || 'rtl' === value) return value;
  const fallback = sourceDirection(source, computed);
  return fallback || null;
}

function listMarkerWritingMode(computed: CSSStyleDeclaration): string {
  return computed.getPropertyValue('writing-mode').trim().toLowerCase() || 'horizontal-tb';
}

function hasListMarkerCustomPseudo(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  return ['::before', '::after'].some((pseudoElement) => {
    const content = runtime.getComputedStyle(source, pseudoElement).getPropertyValue('content').trim().toLowerCase();
    return Boolean(content && !['none', 'normal'].includes(content));
  });
}

function listMarkerFontSignature(computed: CSSStyleDeclaration): string {
  return LIST_MARKER_FONT_PROPERTIES.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';');
}

function listMarkerCandidate(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): ListMarkerCandidate | null {
  if (!['OL', 'UL'].includes(source.tagName)) return null;
  if ('block' !== computed.getPropertyValue('display').trim().toLowerCase()) return null;
  if (source.closest('.task-list, .task-list-item')) return null;
  const children = Array.from(source.children);
  if (!children.length || children.some((child) => 'LI' !== child.tagName)) return null;
  if (
    children.some(
      (child) =>
        child.classList.contains('task-list-item') ||
        child.querySelector('.easymde-task-checkbox, input[type="checkbox"]')
    )
  )
    return null;
  const listPosition = computed.getPropertyValue('list-style-position').trim().toLowerCase();
  if ('outside' !== listPosition) return null;
  const listType = computed.getPropertyValue('list-style-type').trim().toLowerCase();
  if (!LIST_MARKER_NATIVE_TYPES.has(listType)) return null;
  if ('none' !== computed.getPropertyValue('list-style-image').trim().toLowerCase()) return null;
  if (
    computed.getPropertyValue('counter-reset').trim().toLowerCase() !== 'none' ||
    computed.getPropertyValue('counter-increment').trim().toLowerCase() !== 'none' ||
    computed.getPropertyValue('counter-set').trim().toLowerCase() !== 'none'
  )
    return null;
  if (hasListMarkerCustomPseudo(source, runtime)) return null;
  if (!['horizontal-tb', ''].includes(listMarkerWritingMode(computed))) return null;
  const direction = listMarkerDirection(source, computed);
  if (!direction) return null;
  const paddingLeft = finiteCssPixelValue(computed.getPropertyValue('padding-left'));
  const paddingRight = finiteCssPixelValue(computed.getPropertyValue('padding-right'));
  if (null === paddingLeft || null === paddingRight) return null;
  const logicalStartPadding = 'rtl' === direction ? paddingRight : paddingLeft;
  if (0 !== logicalStartPadding) return null;
  const items: Array<{ markerFont: CSSStyleDeclaration; source: Element }> = [];
  const fontSignatures: string[] = [];
  for (const item of children) {
    const itemComputed = runtime.getComputedStyle(item);
    if ('list-item' !== itemComputed.getPropertyValue('display').trim().toLowerCase()) return null;
    if ('outside' !== itemComputed.getPropertyValue('list-style-position').trim().toLowerCase()) return null;
    if ('none' !== itemComputed.getPropertyValue('list-style-image').trim().toLowerCase()) return null;
    if (
      itemComputed.getPropertyValue('counter-reset').trim().toLowerCase() !== 'none' ||
      itemComputed.getPropertyValue('counter-increment').trim().toLowerCase() !== 'none' ||
      itemComputed.getPropertyValue('counter-set').trim().toLowerCase() !== 'none'
    )
      return null;
    if (hasListMarkerCustomPseudo(item, runtime)) return null;
    if (!['horizontal-tb', ''].includes(listMarkerWritingMode(itemComputed))) return null;
    if (listMarkerDirection(item, itemComputed) !== direction) return null;
    if (itemComputed.getPropertyValue('list-style-type').trim().toLowerCase() !== listType) return null;
    const markerComputed = runtime.getComputedStyle(item, '::marker');
    if ('normal' !== markerComputed.getPropertyValue('content').trim().toLowerCase()) return null;
    if (listMarkerWritingMode(markerComputed) !== 'horizontal-tb') return null;
    items.push({ markerFont: markerComputed, source: item });
    fontSignatures.push(listMarkerFontSignature(markerComputed));
  }

  const sourceRect = source.getBoundingClientRect();
  if (!Number.isFinite(sourceRect.width) || sourceRect.width <= 0) {
    throw new Error('wechat-list-marker-geometry-unavailable');
  }

  const attributes = ['start', 'reversed', 'type']
    .map((attribute) => `${attribute}=${source.getAttribute(attribute) ?? ''}`)
    .join(';');
  const itemAttributes = items.map(({ source: item }) => `value=${item.getAttribute('value') ?? ''}`).join('|');
  const signature = [
    source.tagName,
    direction,
    listMarkerWritingMode(computed),
    listType,
    listPosition,
    computed.getPropertyValue('list-style-image'),
    computed.getPropertyValue('counter-reset'),
    computed.getPropertyValue('counter-increment'),
    computed.getPropertyValue('counter-set'),
    `padding-left=${paddingLeft}`,
    `padding-right=${paddingRight}`,
    `width=${sourceRect.width}`,
    attributes,
    itemAttributes,
    fontSignatures.join('|')
  ].join('\u0002');
  return { direction, items, listType, sourceWidth: sourceRect.width, signature };
}

function listMarkerGutterMetadata(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): ListMarkerGutterMetadata | null {
  const candidate = listMarkerCandidate(source, computed, runtime);
  if (!candidate) return null;
  const document = source.ownerDocument;
  if (!document.body) throw new Error('wechat-list-marker-probe-document-body-unavailable');
  const probe = document.createElement('div');
  probe.setAttribute(LIST_MARKER_PROBE_ATTRIBUTE, '');
  probe.setAttribute('aria-hidden', 'true');
  probe.setAttribute('inert', '');
  probe.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:block',
    'visibility:hidden',
    'opacity:0',
    'pointer-events:none',
    'contain:layout style',
    `width:${candidate.sourceWidth}px`,
    `max-width:${candidate.sourceWidth}px`
  ].join(';');
  const probeList = document.createElement(source.tagName.toLowerCase());
  ['start', 'reversed', 'type', 'dir'].forEach((attribute) => {
    if (source.hasAttribute(attribute)) probeList.setAttribute(attribute, source.getAttribute(attribute) ?? '');
  });
  probeList.style.cssText = [
    'display:block',
    'width:100%',
    'margin:0',
    'padding:0',
    'border:0',
    'list-style-position:inside',
    `list-style-type:${candidate.listType}`,
    'list-style-image:none',
    `direction:${candidate.direction}`,
    'writing-mode:horizontal-tb'
  ].join(';');
  probe.appendChild(probeList);
  const anchors: HTMLElement[] = [];
  try {
    candidate.items.forEach(({ markerFont, source: itemSource }) => {
      const item = document.createElement('li');
      if (itemSource.hasAttribute('value')) item.setAttribute('value', itemSource.getAttribute('value') ?? '');
      item.style.cssText = [
        'display:list-item',
        'margin:0',
        'padding:0',
        'border:0',
        'list-style-position:inside',
        `list-style-type:${candidate.listType}`,
        'list-style-image:none',
        `direction:${candidate.direction}`,
        'writing-mode:horizontal-tb'
      ].join(';');
      LIST_MARKER_FONT_PROPERTIES.forEach((property) => {
        const value = markerFont.getPropertyValue(property);
        if (value) item.style.setProperty(property, value);
      });
      const anchor = document.createElement('span');
      anchor.setAttribute(LIST_MARKER_PROBE_ANCHOR_ATTRIBUTE, '');
      anchor.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0';
      item.appendChild(anchor);
      probeList.appendChild(item);
      anchors.push(anchor);
    });
    document.body.appendChild(probe);
    const listRect = probeList.getBoundingClientRect();
    if (!Number.isFinite(listRect.width) || listRect.width <= 0) {
      throw new Error('wechat-list-marker-geometry-unavailable');
    }
    let maxAdvance = 0;
    anchors.forEach((anchor) => {
      const item = anchor.parentElement;
      if (!item) throw new Error('wechat-list-marker-geometry-unavailable');
      const itemRect = item.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const advance =
        'rtl' === candidate.direction ? itemRect.right - anchorRect.right : anchorRect.left - itemRect.left;
      if (
        !Number.isFinite(itemRect.width) ||
        itemRect.width <= 0 ||
        !Number.isFinite(advance) ||
        advance <= 0 ||
        advance > itemRect.width ||
        advance > listRect.width
      )
        throw new Error('wechat-list-marker-geometry-unavailable');
      maxAdvance = Math.max(maxAdvance, advance);
    });
    const gutter = Math.ceil(maxAdvance);
    if (!Number.isFinite(gutter) || gutter <= 0 || gutter > listRect.width) {
      throw new Error('wechat-list-marker-geometry-unavailable');
    }
    const metadata = { gutter, signature: `${candidate.signature};gutter=${gutter}` };
    return metadata;
  } finally {
    probe.remove();
  }
}

function listMarkerSignature(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): string {
  return listMarkerGutterMetadata(source, computed, runtime)?.signature ?? '';
}

function applyListMarkerGutter(clone: Element, metadata: ListMarkerGutterMetadata, direction: 'ltr' | 'rtl'): void {
  const style = (clone as HTMLElement).style;
  style.setProperty('rtl' === direction ? 'padding-right' : 'padding-left', `${metadata.gutter}px`);
}

function isFullWidthTable(source: Element, computed: CSSStyleDeclaration): boolean {
  const computedWidth = computed.getPropertyValue('width').trim();
  if (/^100(?:\.0+)?%$/.test(computedWidth)) return true;
  const tableWidth = source.getBoundingClientRect().width;
  const parentWidth = source.parentElement?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 && parentWidth > 0 && tableWidth >= parentWidth - 1;
}

function positiveTableRadius(value: string): boolean {
  return (
    value
      .split('/')[0]
      ?.trim()
      .split(/\s+/u)
      .some((token) => Number.parseFloat(token) > 0) ?? false
  );
}

function tableScrollOwnerMetadata(source: Element, computed: CSSStyleDeclaration): TableScrollOwnerMetadata | null {
  if (
    'TABLE' !== source.tagName ||
    supportsSpecialLayout(source) ||
    'table' !== computed.getPropertyValue('display').trim().toLowerCase() ||
    'separate' !== computed.getPropertyValue('border-collapse').trim().toLowerCase() ||
    !/^0px(?:\s+0px)?$/u.test(computed.getPropertyValue('border-spacing').trim().toLowerCase()) ||
    'auto' !== computed.getPropertyValue('table-layout').trim().toLowerCase()
  )
    return null;
  const overflowX = computed.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = computed.getPropertyValue('overflow-y').trim().toLowerCase();
  if (!['hidden', 'clip'].includes(overflowX) || !['hidden', 'clip'].includes(overflowY)) return null;
  const radii = [
    computed.getPropertyValue('border-radius'),
    computed.getPropertyValue('border-top-left-radius'),
    computed.getPropertyValue('border-top-right-radius'),
    computed.getPropertyValue('border-bottom-right-radius'),
    computed.getPropertyValue('border-bottom-left-radius')
  ];
  if (!radii.some(positiveTableRadius)) return null;
  return {
    borderCollapse: 'separate',
    overflowX: overflowX as 'hidden' | 'clip',
    overflowY: overflowY as 'hidden' | 'clip',
    radiusEligible: true
  };
}

function cssColorAlpha(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if ('transparent' === normalized) return 0;
  const functionMatch = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/u.exec(normalized);
  if (!functionMatch) return null;
  const body = functionMatch[1] ?? '';
  let alphaToken = '';
  if (body.includes('/')) {
    alphaToken = body.slice(body.lastIndexOf('/') + 1).trim();
  } else if (/^(?:rgba|hsla)\(/u.test(normalized)) {
    const components = body.split(',');
    alphaToken = (components[components.length - 1] ?? '').trim();
  }
  if (!alphaToken) return 1;
  const alpha = alphaToken.endsWith('%')
    ? Number.parseFloat(alphaToken.slice(0, -1)) / 100
    : Number.parseFloat(alphaToken);
  return Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 ? alpha : null;
}

function hasTablePaintImage(computed: CSSStyleDeclaration): boolean {
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  return Boolean((backgroundImage && 'none' !== backgroundImage) || /(?:url\(|gradient\()/u.test(background));
}

function transparentTablePaint(computed: CSSStyleDeclaration): boolean {
  const alpha = cssColorAlpha(computed.getPropertyValue('background-color'));
  return 0 === alpha && !hasTablePaintImage(computed);
}

function tableHeaderBackgroundMetadata(source: Element, runtime: BrowserWechatClipboardRuntime): string | null {
  if ('THEAD' !== source.tagName) return null;
  const thead = source;
  const table = thead.parentElement;
  if (
    !table ||
    'THEAD' !== thead.tagName ||
    'TABLE' !== table.tagName ||
    table.closest('math, svg') ||
    table.querySelector('math, svg')
  )
    return null;

  const tableComputed = runtime.getComputedStyle(table);
  const theadComputed = runtime.getComputedStyle(thead);
  if (
    'table' !== tableComputed.getPropertyValue('display').trim().toLowerCase() ||
    'table-header-group' !== theadComputed.getPropertyValue('display').trim().toLowerCase() ||
    '0px' !== tableComputed.getPropertyValue('border-spacing').trim().toLowerCase() ||
    hasTablePaintImage(theadComputed)
  )
    return null;

  const rows = Array.from(thead.children);
  if (!rows.length || rows.some((candidate) => 'TR' !== candidate.tagName)) return null;
  const cells = rows.flatMap((candidate) => Array.from(candidate.children));
  if (!cells.length || cells.some((cell) => 'TH' !== cell.tagName)) return null;
  if (
    cells.some((cell) => {
      const rowspan = cell.getAttribute('rowspan')?.trim();
      return Boolean(rowspan && '1' !== rowspan);
    })
  )
    return null;
  if (
    rows.some((candidate) => {
      const candidateStyle = runtime.getComputedStyle(candidate);
      return (
        'table-row' !== candidateStyle.getPropertyValue('display').trim().toLowerCase() ||
        !transparentTablePaint(candidateStyle)
      );
    })
  )
    return null;
  if (
    cells.some((cell) => {
      const cellStyle = runtime.getComputedStyle(cell);
      return (
        'table-cell' !== cellStyle.getPropertyValue('display').trim().toLowerCase() || !transparentTablePaint(cellStyle)
      );
    })
  )
    return null;

  const headerColor = theadComputed.getPropertyValue('background-color').trim();
  const alpha = cssColorAlpha(headerColor);
  if (!headerColor || 1 !== alpha) return null;
  return headerColor;
}

function tableHeaderBackgroundProjection(clone: Element): string | null {
  const thead = clone.parentElement?.parentElement;
  return thead ? (TABLE_HEADER_BACKGROUND_METADATA.get(thead) ?? null) : null;
}

function tableHeaderPaintFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if (!['TABLE', 'THEAD', 'TR', 'TH'].includes(source.tagName)) return '';
  const computed = runtime.getComputedStyle(source);
  const properties = ['display', 'background', 'background-color', 'background-image', 'border-spacing'];
  const attributes = ['rowspan', 'colspan']
    .map((attribute) => `${attribute}=${source.getAttribute(attribute) ?? ''}`)
    .join(';');
  return `${source.tagName}:${properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';')}:${attributes}`;
}

function tableScrollOwnerFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if ('TABLE' !== source.tagName) return '';
  const computed = runtime.getComputedStyle(source);
  const properties = [
    'display',
    'border-collapse',
    'border-spacing',
    'border-radius',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'overflow-x',
    'overflow-y',
    'table-layout'
  ];
  return `table-scroll:${properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';')}:special=${supportsSpecialLayout(source)}`;
}

function tableGeometryIsMeasurable(source: Element, computed: CSSStyleDeclaration): boolean {
  if (/^100(?:\.0+)?%$/.test(computed.getPropertyValue('width').trim())) return true;
  const tableWidth = source.getBoundingClientRect().width;
  const parentWidth = source.parentElement?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 && parentWidth > 0;
}

function isDisplayNoneInAncestor(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  let current: Element | null = source.parentElement;
  while (current) {
    if ('none' === getComputedStyle(current).getPropertyValue('display').trim()) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function fullWidthTableLayout(
  source: Element,
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  previewRoot: HTMLElement,
  sourceRoot: HTMLElement = previewRoot
): boolean {
  const tableIndex = Array.from(previewRoot.querySelectorAll('table')).indexOf(source as HTMLTableElement);
  const sourceTable = sourceRoot === previewRoot ? source : sourceRoot.querySelectorAll('table').item(tableIndex);
  const hidden = isDisplayNoneInAncestor(sourceTable ?? source, getComputedStyle);
  const currentIsMeasured = sourceRoot !== previewRoot;
  const currentGeometryIsUsable = tableGeometryIsMeasurable(source, computed);
  if (hidden && (!currentIsMeasured || !currentGeometryIsUsable)) {
    const cached = sourceTable ? FULL_WIDTH_TABLE_SOURCE_LAYOUT.get(sourceTable) : undefined;
    if (cached !== undefined) return cached;
    const rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(sourceRoot);
    const cachedRootLayout = rootLayout?.get(tableIndex);
    if (cachedRootLayout !== undefined) return cachedRootLayout;
  }
  const current = isFullWidthTable(source, computed);
  if (!hidden || (currentIsMeasured && currentGeometryIsUsable)) {
    FULL_WIDTH_TABLE_SOURCE_LAYOUT.set(sourceTable ?? source, current);
    let rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(sourceRoot);
    if (!rootLayout) {
      rootLayout = new Map();
      FULL_WIDTH_TABLE_ROOT_LAYOUT.set(sourceRoot, rootLayout);
    }
    if (tableIndex >= 0) rootLayout.set(tableIndex, current);
  }
  return current;
}

async function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after'
): Promise<string[]> {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isTaskListCheckbox(source) && !pseudoElement ? TASK_LIST_CHECKBOX_STYLE_PROPERTIES : []),
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : root ? [] : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
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
  for (const property of properties) {
    throwIfBackgroundPreparationAborted(signal);
    const value = style.getPropertyValue(property);
    const materializedValue =
      ('background' === property || 'background-image' === property) && value.includes('url(')
        ? await materializeBackgroundValue(property, value, runtime, cache, signal)
        : value;
    throwIfBackgroundPreparationAborted(signal);
    const semanticCandidate = semanticComputed?.getPropertyValue(property).trim() ?? '';
    const semanticMarginCandidate = semanticMarginValue(
      property,
      source,
      computed,
      dimensionSemantics ?? null,
      pseudoElement ? pseudoElementName : undefined,
      semanticMarginComputed
    );
    const isOrdinaryDimension =
      !pseudoElement &&
      !supportsSpecialLayout(source) &&
      ORDINARY_DIMENSION_PROPERTIES.includes(property as (typeof ORDINARY_DIMENSION_PROPERTIES)[number]);
    const preserveRawContentBoxTuple = promoteContentBoxBounds && ('box-sizing' === property || isOrdinaryDimension);
    const sourceValue =
      preserveRawContentBoxTuple && semanticCandidate
        ? semanticCandidate
        : (semanticMarginCandidate ??
          (isOrdinaryDimension && semanticCandidate ? semanticCandidate : materializedValue));
    const normalizedValue = preserveRawContentBoxTuple
      ? sourceValue
      : portableStyleValue(property, sourceValue, source, style);
    if (keepStyle(property, normalizedValue, source, pseudoElement, root, value)) {
      declarations.push(
        portableStyleDeclaration(
          property,
          normalizedValue,
          promoteContentBoxBounds && CONTENT_BOX_PROMOTED_PROPERTIES.has(property)
        )
      );
    }
    if (yieldToBrowser?.shouldYield()) await yieldToBrowser();
  }
  return declarations;
}

function styleDeclarationsSynchronously(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement: boolean,
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after'
): string[] | null {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isTaskListCheckbox(source) && !pseudoElement ? TASK_LIST_CHECKBOX_STYLE_PROPERTIES : []),
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : root ? [] : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
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
  for (const property of properties) {
    const value = style.getPropertyValue(property);
    const materializedValue = materializeBackgroundValueSynchronously(property, value, runtime);
    if (null === materializedValue) return null;
    const semanticCandidate = semanticComputed?.getPropertyValue(property).trim() ?? '';
    const semanticMarginCandidate = semanticMarginValue(
      property,
      source,
      computed,
      dimensionSemantics ?? null,
      pseudoElement ? pseudoElementName : undefined,
      semanticMarginComputed
    );
    const isOrdinaryDimension =
      !pseudoElement &&
      !supportsSpecialLayout(source) &&
      ORDINARY_DIMENSION_PROPERTIES.includes(property as (typeof ORDINARY_DIMENSION_PROPERTIES)[number]);
    const preserveRawContentBoxTuple = promoteContentBoxBounds && ('box-sizing' === property || isOrdinaryDimension);
    const sourceValue =
      preserveRawContentBoxTuple && semanticCandidate
        ? semanticCandidate
        : (semanticMarginCandidate ??
          (isOrdinaryDimension && semanticCandidate ? semanticCandidate : materializedValue));
    const normalizedValue = preserveRawContentBoxTuple
      ? sourceValue
      : portableStyleValue(property, sourceValue, source, style);
    if (keepStyle(property, normalizedValue, source, pseudoElement, root, value)) {
      declarations.push(
        portableStyleDeclaration(
          property,
          normalizedValue,
          promoteContentBoxBounds && CONTENT_BOX_PROMOTED_PROPERTIES.has(property)
        )
      );
    }
  }
  return declarations;
}

function removeTransientAttributes(clone: Element): void {
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
        const separator = dataMatch ? dataMatch[0].length : remainder.indexOf(',');
        const candidate = (
          dataMatch
            ? dataMatch[1] + (dataMatch[2] ? ` ${dataMatch[2].trim()}` : '')
            : separator < 0
              ? remainder
              : remainder.slice(0, separator)
        ).trim();
        const candidateUrl = candidate.split(/\s+/, 1)[0] ?? '';
        if (
          '' !== candidateUrl &&
          (!UNSAFE_URL.test(candidateUrl) ||
            (SAFE_DATA_IMAGE.test(candidateUrl) && candidateUrl.length <= MAX_DATA_IMAGE_LENGTH))
        ) {
          candidates.push(candidate);
        }
        if (separator < 0 || separator >= remainder.length) break;
        remainder = remainder.slice(separator + 1).trim();
      }
      if (candidates.length) clone.setAttribute(attribute.name, candidates.join(', '));
      else clone.removeAttribute(attribute.name);
    }
  }
}

function pseudoContent(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || 'none' === normalized || 'normal' === normalized) return null;
  const match = /^("|')([\s\S]*)\1$/.exec(normalized);
  const content = match?.[2];
  if (undefined === content) return null;
  return content.replace(/\\([\\"'])/g, '$1');
}

const PSEUDO_SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SAFE_PSEUDO_SVG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  path: new Set([
    'clip-rule',
    'd',
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-opacity',
    'stroke-width'
  ]),
  svg: new Set(['height', 'viewbox', 'viewBox', 'width', 'xmlns'])
};
const SAFE_PSEUDO_SVG_COLOR =
  /^(?:currentcolor|none|transparent|black|white|red|green|blue|yellow|gray|grey|#[\da-f]{3,8}|rgba?\([^)]{1,80}\))$/iu;
const SAFE_PSEUDO_SVG_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;
const SAFE_PSEUDO_SVG_VIEWBOX = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[\s,]+-?(?:\d+(?:\.\d+)?|\.\d+)){3}$/u;

function finitePositiveSvgNumber(value: string, maximum = 4_096): number | null {
  if (!SAFE_PSEUDO_SVG_NUMBER.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? number : null;
}

function finiteSvgOpacity(value: string): boolean {
  if (!SAFE_PSEUDO_SVG_NUMBER.test(value.trim())) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}

function pseudoSvgContent(value: string, ownerDocument: Document): SVGSVGElement | null {
  const urlMatch = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)(?:\s*\/\s*(?:""|''))?$/u.exec(value.trim());
  const source = urlMatch?.[1] ?? urlMatch?.[2] ?? urlMatch?.[3] ?? '';
  const dataMatch = /^data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,([\s\S]*)$/iu.exec(source);
  if (!dataMatch?.[1]) return null;

  let markup: string;
  try {
    markup = decodeURIComponent(dataMatch[1]).trim();
  } catch {
    return null;
  }
  if (!markup || markup.length > 16_384) return null;
  if (/<!doctype\b|<!\[cdata\[|<\?xml\b/iu.test(markup)) return null;
  const Parser =
    ownerDocument.defaultView?.DOMParser ??
    (globalThis as typeof globalThis & { DOMParser?: typeof DOMParser }).DOMParser;
  if ('function' !== typeof Parser) return null;
  const parsed = new Parser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return null;
  const root = parsed.documentElement;
  if (
    'svg' !== root?.localName.toLowerCase() ||
    PSEUDO_SVG_NAMESPACE !== root.namespaceURI ||
    parsed.childNodes.length !== 1 ||
    root.textContent?.trim()
  )
    return null;

  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  if (
    elements.length > 8 ||
    elements.slice(1).some((element) => 'svg' === element.localName.toLowerCase()) ||
    elements.some((element) => !['svg', 'path'].includes(element.localName.toLowerCase())) ||
    !elements.some((element) => 'path' === element.localName.toLowerCase())
  ) {
    return null;
  }
  const viewBox = root.getAttribute('viewBox')?.trim() ?? '';
  if (!SAFE_PSEUDO_SVG_VIEWBOX.test(viewBox)) return null;
  const viewBoxNumbers = viewBox.split(/[\s,]+/u).map(Number);
  if (
    4 !== viewBoxNumbers.length ||
    viewBoxNumbers.some((number) => !Number.isFinite(number)) ||
    viewBoxNumbers[2] === undefined ||
    viewBoxNumbers[3] === undefined ||
    viewBoxNumbers[2] <= 0 ||
    viewBoxNumbers[3] <= 0 ||
    viewBoxNumbers[2] > 4_096 ||
    viewBoxNumbers[3] > 4_096
  )
    return null;
  let hasVisiblePaint = false;
  for (const element of elements) {
    const localName = element.localName.toLowerCase();
    const allowedAttributes = SAFE_PSEUDO_SVG_ATTRIBUTES[localName];
    if (!allowedAttributes) return null;
    let pathData = '';
    let pathCommands: ReturnType<typeof SVGPathData.parse> | null = null;
    let fill = 'black';
    let fillOpacity = 1;
    let stroke = 'none';
    let strokeOpacity = 1;
    let strokeWidth = 1;
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name;
      const normalizedName = 'viewbox' === name.toLowerCase() ? 'viewbox' : name.toLowerCase();
      if (!allowedAttributes.has(name) && !allowedAttributes.has(normalizedName)) return null;
      if (attribute.value.length > 4_096 || /(?:url\(|javascript:|data:|<|>|on[a-z]+\s*=)/iu.test(attribute.value))
        return null;
      if ('svg' === localName && 'xmlns' === normalizedName && attribute.value !== PSEUDO_SVG_NAMESPACE) return null;
      if ('path' === localName && 'd' === normalizedName && !attribute.value.trim()) return null;
      if ('path' === localName && 'd' === normalizedName) {
        pathData = attribute.value.trim();
        try {
          pathCommands = SVGPathData.parse(pathData);
        } catch {
          return null;
        }
        if (!pathCommands.length) return null;
        const numericFields = pathCommands
          .flatMap((command) => Object.values(command))
          .filter((value): value is number => 'number' === typeof value);
        if (numericFields.some((number) => !Number.isFinite(number) || Math.abs(number) > 4_096)) {
          return null;
        }
      }
      if ('path' === localName && 'fill' === normalizedName) {
        if (!SAFE_PSEUDO_SVG_COLOR.test(attribute.value.trim())) return null;
        fill = attribute.value.trim().toLowerCase();
      }
      if ('path' === localName && 'fill-opacity' === normalizedName) {
        if (!finiteSvgOpacity(attribute.value)) return null;
        fillOpacity = Number(attribute.value);
      }
      if (
        'path' === localName &&
        ['fill-rule', 'clip-rule'].includes(normalizedName) &&
        !['nonzero', 'evenodd'].includes(attribute.value.trim().toLowerCase())
      )
        return null;
      if ('path' === localName && 'stroke' === normalizedName) {
        if (!SAFE_PSEUDO_SVG_COLOR.test(attribute.value.trim())) return null;
        stroke = attribute.value.trim().toLowerCase();
      }
      if ('path' === localName && 'stroke-opacity' === normalizedName) {
        if (!finiteSvgOpacity(attribute.value)) return null;
        strokeOpacity = Number(attribute.value);
      }
      if ('path' === localName && 'stroke-width' === normalizedName) {
        const parsedWidth = finitePositiveSvgNumber(attribute.value, 4_096);
        if (null === parsedWidth) return null;
        strokeWidth = parsedWidth;
      }
      if (
        'path' === localName &&
        'stroke-linecap' === normalizedName &&
        !['butt', 'round', 'square'].includes(attribute.value.trim().toLowerCase())
      )
        return null;
      if (
        'path' === localName &&
        'stroke-linejoin' === normalizedName &&
        !['arcs', 'bevel', 'miter', 'miter-clip', 'round'].includes(attribute.value.trim().toLowerCase())
      )
        return null;
      if ('svg' === localName && 'viewbox' === normalizedName && !SAFE_PSEUDO_SVG_VIEWBOX.test(attribute.value.trim()))
        return null;
      if (
        'svg' === localName &&
        ['width', 'height'].includes(normalizedName) &&
        null === finitePositiveSvgNumber(attribute.value)
      )
        return null;
    }
    if ('path' === localName) {
      if (!pathData || !pathCommands) return null;
      let bounds: ReturnType<SVGPathData['getBounds']>;
      try {
        bounds = new SVGPathData(pathCommands).getBounds();
      } catch {
        return null;
      }
      const boundsValues = [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY];
      if (
        !boundsValues.every((number) => Number.isFinite(number) && Math.abs(number) <= 4_096) ||
        bounds.maxX <= bounds.minX ||
        bounds.maxY <= bounds.minY
      )
        return null;
      const absoluteCommands = new SVGPathData(pathCommands).toAbs().commands;
      const lineOnly = absoluteCommands.every((command) =>
        [
          SVGPathData.MOVE_TO,
          SVGPathData.LINE_TO,
          SVGPathData.HORIZ_LINE_TO,
          SVGPathData.VERT_LINE_TO,
          SVGPathData.CLOSE_PATH
        ].some((type) => type === command.type)
      );
      const points = absoluteCommands.flatMap((command) => {
        if ('x' in command && 'y' in command) return [[command.x, command.y]];
        return [];
      });
      const area =
        points.reduce((total, point, index) => {
          const next = points[(index + 1) % points.length];
          return next ? total + (point[0] ?? 0) * (next[1] ?? 0) - (next[0] ?? 0) * (point[1] ?? 0) : total;
        }, 0) / 2;
      const hasNonZeroBounds = bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
      const hasNonZeroLineArea = !lineOnly || points.length < 3 || Math.abs(area) > 0.000_001;
      const hasClosedFill =
        fill !== 'none' && fillOpacity > 0 && /[Zz]/u.test(pathData) && hasNonZeroBounds && hasNonZeroLineArea;
      const hasStroke =
        stroke !== 'none' &&
        strokeOpacity > 0 &&
        strokeWidth > 0 &&
        absoluteCommands.some(
          (command) => command.type !== SVGPathData.MOVE_TO && command.type !== SVGPathData.CLOSE_PATH
        );
      if (hasClosedFill || hasStroke) hasVisiblePaint = true;
    }
  }
  if (!hasVisiblePaint) return null;
  return ownerDocument.importNode(root, true) as unknown as SVGSVGElement;
}

async function validateTaskCheckboxSvgPaint(
  source: Element,
  rawContent: string,
  svg: SVGSVGElement,
  signal?: AbortSignal
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  if (TASK_LIST_CHECKBOX_SVG_PAINT.get(source) === rawContent) return;
  const window = source.ownerDocument.defaultView;
  const ImageConstructor = window?.Image;
  if ('function' !== typeof ImageConstructor) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  const viewBox =
    svg
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number) ?? [];
  const width = viewBox[2];
  const height = viewBox[3];
  if (
    undefined === width ||
    undefined === height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 4_096 ||
    height > 4_096
  ) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  const canvas = source.ownerDocument.createElement('canvas');
  canvas.width = Math.min(512, Math.max(1, Math.ceil(width)));
  canvas.height = Math.min(512, Math.max(1, Math.ceil(height)));
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    context = null;
  }
  if (!context) throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  const image = new ImageConstructor();
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => {
      finish(new Error('wechat-background-preparation-cancelled'));
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('wechat-task-checkbox-svg-paint-unavailable'));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = dataUrl;
  });
  throwIfBackgroundPreparationAborted(signal);
  const decode = (image as HTMLImageElement & { decode?: () => Promise<void> }).decode;
  if ('function' === typeof decode) {
    try {
      await decode.call(image);
    } catch {
      throw new Error('wechat-task-checkbox-svg-paint-unavailable');
    }
  }
  try {
    throwIfBackgroundPreparationAborted(signal);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasAlpha = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 0) {
        hasAlpha = true;
        break;
      }
    }
    if (!hasAlpha) throw new Error('wechat-task-checkbox-svg-paint-empty');
  } catch (error: unknown) {
    if (error instanceof Error && 'wechat-task-checkbox-svg-paint-empty' === error.message) throw error;
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  throwIfBackgroundPreparationAborted(signal);
  TASK_LIST_CHECKBOX_SVG_PAINT.set(source, rawContent);
}

function isTaskSvgPseudoContent(source: Element, rawContent: string): boolean {
  return (
    isTaskListCheckbox(source) &&
    /^url\(\s*(?:"|')?data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,/iu.test(rawContent.trim())
  );
}

function isHiddenPseudoPaint(computed: CSSStyleDeclaration): boolean {
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

function inlineTextMarkerEligibility(
  source: Element,
  sourceComputed: CSSStyleDeclaration,
  pseudoComputed: CSSStyleDeclaration
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
      !supportsSpecialLayout(source) &&
      !hasImageOrMask(pseudoComputed) &&
      !hasImageOrMask(sourceComputed) &&
      !hasCounter
  );
}

function inlineTextMarkerFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
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

function isHiddenCodeFramePseudo(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string
): boolean {
  return 'PRE' === source.tagName && '::before' === pseudo && '' === content && isHiddenPseudoPaint(computed);
}

function isCodeFramePseudo(
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

function isVisiblePaintedThemeHeadingSuffix(source: Element, computed: CSSStyleDeclaration): boolean {
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

function isGeneratedEmptyHeadingAfter(
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
    '' !== content
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
  return /(?:url\(|gradient\()/u.test(backgroundImage) || visibleBackgroundColor;
}

type HeadingEmptyPseudoFlow = Readonly<{
  backgroundColor: string;
  borderRadius: string;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  opacity: number;
  paddingLeft: number;
  width: number;
}>;

type HeadingEmptyPseudoFlowExpectation = Readonly<{
  cloneHeading: Element;
  flow: HeadingEmptyPseudoFlow;
  marker: Element;
  source: Element;
}>;

type HeadingEmptyPseudoFlowCollector = {
  expectations: HeadingEmptyPseudoFlowExpectation[];
};

const HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS = new WeakMap<
  Element,
  HeadingEmptyPseudoFlowExpectation
>();

const HEADING_EMPTY_PSEUDO_FLOW_EPSILON = 1 / 64;

function headingEmptyPseudoPaintColorIsVisible(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || 'transparent' === normalized || 'none' === normalized) return false;
  const alpha =
    /^rgba\([^)]*,\s*([^,)]+)\s*\)$/u.exec(normalized)?.[1] ?? /\/\s*([^\s)]+)\s*\)$/u.exec(normalized)?.[1];
  return undefined === alpha || Number.parseFloat(alpha) > 0;
}

function headingEmptyPseudoFinitePixel(computed: CSSStyleDeclaration, property: string): number | null {
  return finiteCssPixelValue(computed.getPropertyValue(property));
}

function headingEmptyPseudoUsedTop(
  source: Element,
  computed: CSSStyleDeclaration,
  sourceComputed: CSSStyleDeclaration
): number | null {
  const raw = computed.getPropertyValue('top').trim();
  const pixel = finiteCssPixelValue(raw);
  if (null !== pixel) return pixel;
  const percentage = /^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u.exec(raw)?.[1];
  if (undefined === percentage) return null;
  const ratio = taskCheckboxStrictNumber(percentage);
  if (null === ratio) return null;
  const rect = source.getBoundingClientRect();
  const borderTop = headingEmptyPseudoFinitePixel(sourceComputed, 'border-top-width');
  const borderBottom = headingEmptyPseudoFinitePixel(sourceComputed, 'border-bottom-width');
  if (null === borderTop || null === borderBottom) return null;
  const containingHeight = rect.height - borderTop - borderBottom;
  if (!Number.isFinite(ratio) || !Number.isFinite(containingHeight) || containingHeight <= 0) {
    return null;
  }
  return (ratio / 100) * containingHeight;
}

function headingEmptyPseudoTransformOrNull(
  computed: CSSStyleDeclaration
): TaskCheckboxTransformState | null {
  const errorCode = 'wechat-heading-pseudo-flow-transform-unavailable';
  try {
    return taskCheckboxTransformState(computed.getPropertyValue('transform'), errorCode);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === errorCode) return null;
    throw error;
  }
}

function headingEmptyPseudoFlowFor(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean
): HeadingEmptyPseudoFlow | null {
  if (
    root ||
    '::before' !== pseudo ||
    !['H1', 'H2', 'H3', 'H4'].includes(source.tagName) ||
    source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline') ||
    '' !== content
  )
    return null;

  const pseudoPosition = computed.getPropertyValue('position').trim().toLowerCase();
  if ('absolute' !== pseudoPosition) return null;
  const sourceComputed = getComputedStyle(source);
  if ('relative' !== sourceComputed.getPropertyValue('position').trim().toLowerCase()) return null;
  if ('block' !== sourceComputed.getPropertyValue('display').trim().toLowerCase()) return null;
  if ('none' !== sourceComputed.getPropertyValue('transform').trim().toLowerCase()) return null;
  if ('visible' !== sourceComputed.getPropertyValue('visibility').trim().toLowerCase()) return null;
  const sourceOpacity = taskCheckboxStrictNumber(sourceComputed.getPropertyValue('opacity').trim());
  if (null === sourceOpacity || sourceOpacity <= 0 || sourceOpacity > 1) return null;
  if (isHiddenPseudoPaint(sourceComputed)) return null;
  if (isHiddenPseudoPaint(computed)) return null;
  if ('block' !== computed.getPropertyValue('display').trim().toLowerCase()) return null;
  if ('visible' !== computed.getPropertyValue('visibility').trim().toLowerCase()) return null;
  const pseudoOpacity = taskCheckboxStrictNumber(computed.getPropertyValue('opacity').trim());
  if (null === pseudoOpacity || pseudoOpacity <= 0 || pseudoOpacity > 1) return null;

  const declaredLeft = finiteCssPixelValue(computed.getPropertyValue('left'));
  if (null === declaredLeft) return null;

  const transform = headingEmptyPseudoTransformOrNull(computed);
  if (null === transform) return null;
  if ('literal-none' === transform.kind) {
    // The literal keyword is an accepted identity transform. Its distinction
    // from an identity matrix is retained by taskCheckboxTransformState.
  } else if ('matrix2d' !== transform.format || 16 !== transform.matrix.length) {
    return null;
  }
  const matrix = transform.matrix;
  const pureTranslation =
    ('literal-none' === transform.kind ||
      ('matrix2d' === transform.format &&
        16 === transform.matrix.length &&
        1 === matrix[0] &&
        0 === matrix[1] &&
        0 === matrix[2] &&
        0 === matrix[3] &&
        0 === matrix[4] &&
        1 === matrix[5] &&
        0 === matrix[6] &&
        0 === matrix[7] &&
        0 === matrix[8] &&
        0 === matrix[9] &&
        1 === matrix[10] &&
        0 === matrix[11] &&
        1 === matrix[15]));
  if (!pureTranslation) return null;
  const translateX = matrix[12];
  const translateY = matrix[13];
  if (
    undefined === translateX ||
    undefined === translateY ||
    !Number.isFinite(translateX) ||
    !Number.isFinite(translateY)
  ) {
    return null;
  }

  const pseudoMarginLeft = finiteCssPixelValue(computed.getPropertyValue('margin-left'));
  if (null === pseudoMarginLeft) return null;
  const paintLeft = declaredLeft + pseudoMarginLeft + translateX;
  if (!Number.isFinite(paintLeft) || paintLeft >= 0) return null;

  const backgroundColor = computed.getPropertyValue('background-color').trim();
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  if (!headingEmptyPseudoPaintColorIsVisible(backgroundColor)) return null;
  if ('none' !== backgroundImage || HAS_CSS_URL.test(background) || /gradient\(/u.test(background))
    return null;
  const boxShadow = computed.getPropertyValue('box-shadow').trim().toLowerCase();
  const filter = computed.getPropertyValue('filter').trim().toLowerCase();
  if ('none' !== boxShadow || 'none' !== filter) return null;

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const border = finiteCssPixelValue(sourceComputed.getPropertyValue(`border-${side}-width`));
    if (null === border || 0 !== border) return null;
  }
  const borderSides = ['top', 'right', 'bottom', 'left'] as const;
  for (const side of borderSides) {
    const width = headingEmptyPseudoFinitePixel(computed, `border-${side}-width`);
    const style = computed.getPropertyValue(`border-${side}-style`).trim().toLowerCase();
    if (null === width || 0 !== width || !['none', 'hidden'].includes(style)) return null;
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const padding = headingEmptyPseudoFinitePixel(computed, `padding-${side}`);
    if (null === padding || 0 !== padding) return null;
  }

  const width = headingEmptyPseudoFinitePixel(computed, 'width');
  const height = headingEmptyPseudoFinitePixel(computed, 'height');
  if (null === width || null === height || width <= 0 || height <= 0) return null;
  const top = headingEmptyPseudoUsedTop(source, computed, sourceComputed);
  const pseudoMarginTop = headingEmptyPseudoFinitePixel(computed, 'margin-top');
  const paddingLeft = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-left');
  const paddingTop = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-top');
  if (
    null === top ||
    null === pseudoMarginTop ||
    null === paddingLeft ||
    null === paddingTop ||
    paddingLeft < 0 ||
    paddingTop < 0
  )
    return null;
  const opacity = pseudoOpacity;
  const borderRadius = computed.getPropertyValue('border-radius').trim();
  if (null === opacity || opacity <= 0 || !borderRadius) return null;
  const marginTop = top + pseudoMarginTop + translateY - paddingTop;
  if (!Number.isFinite(marginTop)) return null;
  return {
    backgroundColor,
    borderRadius,
    height,
    marginLeft: paintLeft - paddingLeft,
    marginRight: paddingLeft - paintLeft - width,
    marginTop,
    opacity,
    paddingLeft: paddingLeft - paintLeft,
    width
  };
}

function applyHeadingEmptyPseudoFlow(sourceClone: Element, marker: Element, flow: HeadingEmptyPseudoFlow): void {
  appendDeclarations(sourceClone, [`padding-left:${flow.paddingLeft}px`], true);
  appendDeclarations(
    marker,
    [
      'display:block',
      'position:static',
      'top:auto',
      'right:auto',
      'bottom:auto',
      'left:auto',
      'transform:none',
      'float:left',
      `width:${flow.width}px`,
      `height:${flow.height}px`,
      `margin-left:${flow.marginLeft}px`,
      `margin-right:${flow.marginRight}px`,
      `margin-top:${flow.marginTop}px`,
      `opacity:${flow.opacity}`,
      `border-radius:${flow.borderRadius}`
    ],
    true
  );
}

async function addPseudoElement(
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
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
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
  if (null === content && !svgContent) return;
  const textContent = content ?? '';
  if (svgContent && isHiddenPseudoPaint(computed)) return;
  if (svgContent) await validateTaskCheckboxSvgPaint(source, rawContent, svgContent, signal);
  if ('' !== textContent && isHiddenPseudoPaint(computed)) return;
  if (isHiddenCodeFramePseudo(source, pseudo, computed, textContent)) return;
  if (isTaskListCheckbox(source)) {
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
    pseudo
  );
  throwIfBackgroundPreparationAborted(signal);
  if (!textContent && !declarations.length && !svgContent) return;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const appendedImageLayers = preserveRepeatingBackground ? [] : imageLayers;
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations, preserveRepeatingBackground);
  if (!textContent) portableDeclarations.push('font-size:0');
  const generatedEmptyHeadingSuffix = isGeneratedEmptyHeadingAfter(
    source,
    pseudo,
    computed,
    textContent,
    portableDeclarations,
    imageLayers,
    root
  );
  const headingEmptyPseudoFlow = headingEmptyPseudoFlowFor(
    source,
    pseudo,
    computed,
    textContent,
    getComputedStyle,
    root
  );
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  GENERATED_PSEUDO_CLONE_OWNERS.set(marker, { owner: clone, pseudo });
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, pseudo);
  }
  // WeChat drops completely empty decoration spans during paste. A zero-size
  // whitespace marker keeps CSS-only decorations while remaining invisible.
  marker.textContent = textContent || (appendedImageLayers.length || svgContent ? '' : ' ');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  if (headingEmptyPseudoFlow) {
    applyHeadingEmptyPseudoFlow(clone, marker, headingEmptyPseudoFlow);
    HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(marker);
    const expectation: HeadingEmptyPseudoFlowExpectation = {
      cloneHeading: clone,
      flow: headingEmptyPseudoFlow,
      marker,
      source
    };
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(marker, expectation);
    headingFlowCollector?.expectations.push(expectation);
  }
  if (svgContent) {
    appendDeclarations(svgContent, ['display:block', 'width:100%', 'height:100%'], true);
    marker.appendChild(svgContent);
  }
  if ('::before' === pseudo && inlineTextMarkerEligibility(source, getComputedStyle(source), computed)) {
    INLINE_TEXT_MARKER_CLONES.add(marker);
  }
  if (isCodeFramePseudo(source, pseudo, computed, textContent)) {
    CODE_FRAME_PSEUDO_CLONES.add(marker);
  }
  if (generatedEmptyHeadingSuffix || headingEmptyPseudoFlow) {
    GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(marker);
  }
  appendThemeImages(marker, appendedImageLayers, computed, !textContent);
  throwIfBackgroundPreparationAborted(signal);
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

function addPseudoElementSynchronously(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): boolean {
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
  if (null === content && !svgContent) return true;
  const textContent = content ?? '';
  if (svgContent && isHiddenPseudoPaint(computed)) return true;
  if (svgContent && TASK_LIST_CHECKBOX_SVG_PAINT.get(source) !== rawContent) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  if ('' !== textContent && isHiddenPseudoPaint(computed)) return true;
  if (isHiddenCodeFramePseudo(source, pseudo, computed, textContent)) return true;
  if (isTaskListCheckbox(source)) {
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
  const declarations = styleDeclarationsSynchronously(
    source,
    computed,
    true,
    root,
    runtime,
    dimensionSemantics,
    pseudo
  );
  if (null === declarations) return false;
  if (!textContent && !declarations.length && !svgContent) return true;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const appendedImageLayers = preserveRepeatingBackground ? [] : imageLayers;
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations, preserveRepeatingBackground);
  if (!textContent) portableDeclarations.push('font-size:0');
  const generatedEmptyHeadingSuffix = isGeneratedEmptyHeadingAfter(
    source,
    pseudo,
    computed,
    textContent,
    portableDeclarations,
    imageLayers,
    root
  );
  const headingEmptyPseudoFlow = headingEmptyPseudoFlowFor(
    source,
    pseudo,
    computed,
    textContent,
    getComputedStyle,
    root
  );
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  GENERATED_PSEUDO_CLONE_OWNERS.set(marker, { owner: clone, pseudo });
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, pseudo);
  }
  marker.textContent = textContent || (appendedImageLayers.length || svgContent ? '' : ' ');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  if (headingEmptyPseudoFlow) {
    applyHeadingEmptyPseudoFlow(clone, marker, headingEmptyPseudoFlow);
    HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(marker);
    const expectation: HeadingEmptyPseudoFlowExpectation = {
      cloneHeading: clone,
      flow: headingEmptyPseudoFlow,
      marker,
      source
    };
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(marker, expectation);
    headingFlowCollector?.expectations.push(expectation);
  }
  if (svgContent) {
    appendDeclarations(svgContent, ['display:block', 'width:100%', 'height:100%'], true);
    marker.appendChild(svgContent);
  }
  if ('::before' === pseudo && inlineTextMarkerEligibility(source, getComputedStyle(source), computed)) {
    INLINE_TEXT_MARKER_CLONES.add(marker);
  }
  if (isCodeFramePseudo(source, pseudo, computed, textContent)) {
    CODE_FRAME_PSEUDO_CLONES.add(marker);
  }
  if (generatedEmptyHeadingSuffix || headingEmptyPseudoFlow) {
    GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(marker);
  }
  appendThemeImages(marker, appendedImageLayers, computed, !textContent);
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
  return true;
}

async function inlineStyles(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  previewRoot: HTMLElement,
  sourceRoot: HTMLElement,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal,
  taskGeometry: TaskCheckboxGeometryContext | null = null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const computed = getComputedStyle(source);
  // SVG definition trees are commonly hidden by design, but visible shapes
  // still reference them through clip-path, mask, gradient, and filter URLs.
  // Preserve those reusable resources while removing unrelated hidden nodes.
  if (!root && 'none' === computed.getPropertyValue('display') && !isSvgDefinition(source)) {
    HIDDEN_NODES.add(clone);
    return;
  }
  assertTaskCheckboxAppearancePortable(source, computed);
  const declarations = await styleDeclarations(
    source,
    computed,
    false,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal,
    dimensionSemantics
  );
  throwIfBackgroundPreparationAborted(signal);
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const exportComputed = root ? rootExportComputedStyle(source, computed, dimensionSemantics) : computed;
  const preserveRepeatingBackground = hasRepeatingBackground(exportComputed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations, preserveRepeatingBackground);
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_CLONES.add(clone);
    taskCheckboxStaticPaintExpectationFor(clone).baseProperties = taskCheckboxStaticPaintProperties(computed);
  }
  assertTaskCheckboxStaticOwnerBase(source, clone);
  taskGeometry?.validate(source, clone, computed);
  if ('THEAD' === source.tagName) {
    TABLE_HEADER_BACKGROUND_METADATA.set(clone, tableHeaderBackgroundMetadata(source, runtime));
  }
  const projectedTableHeaderBackground = 'TH' === source.tagName ? tableHeaderBackgroundProjection(clone) : null;
  if (projectedTableHeaderBackground) {
    appendDeclarations(clone, [`background-color:${projectedTableHeaderBackground}`]);
  }
  if (['OL', 'UL'].includes(source.tagName)) {
    const markerGutter = listMarkerGutterMetadata(source, computed, runtime);
    const direction = listMarkerDirection(source, computed);
    if (markerGutter && direction) applyListMarkerGutter(clone, markerGutter, direction);
  }
  if (source.matches('.katex')) KATEX_VISUAL_ROOTS.add(clone);
  if (source.matches('.easymde-math-block')) MATH_BLOCK_ROOTS.add(clone);
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (
    'TABLE' === source.tagName &&
    fullWidthTableLayout(source, computed, runtime.getComputedStyle, previewRoot, sourceRoot)
  ) {
    FULL_WIDTH_TABLE_CLONES.add(clone);
  }
  if ('TABLE' === source.tagName) {
    const metadata = tableScrollOwnerMetadata(source, computed);
    if (metadata) TABLE_SCROLL_OWNER_METADATA.set(clone, metadata);
  }
  const registeredVisualRoot = markVisualRasterizationClone(source, clone);
  if (isVisiblePaintedThemeHeadingSuffix(source, computed)) {
    THEME_HEADING_SUFFIX_CLONES.add(clone);
  }
  if (isKaTeXVisualNode(source)) {
    KATEX_VISUAL_NODES.add(clone);
    // WeChat applies `white-space:pre-wrap` and `overflow-wrap:break-word`
    // to pasted spans. KaTeX's vlist/table geometry relies on these values
    // remaining non-wrapping across every visual descendant.
    appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
    if (!source.childNodes.length && !source.textContent) {
      // WeChat drops empty KaTeX structure spans such as `.pstrut`. Keep a
      // zero-width word joiner so their copied dimensions remain in the
      // visual tree; the plain-text path strips this marker before writing.
      clone.textContent = '\u2060';
    }
  }
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  if (conversion && registeredVisualRoot) {
    await yieldToBrowser?.();
    assertPngConversionCurrent(conversion);
    return;
  }
  for (const [index, child] of Array.from(source.childNodes).entries()) {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild) {
      await inlineStyles(
        child,
        cloneChild,
        getComputedStyle,
        false,
        runtime,
        cache,
        previewRoot,
        sourceRoot,
        dimensionSemantics,
        yieldToBrowser,
        conversion,
        signal,
        taskGeometry,
        headingFlowCollector
      );
    }
  }
  await addPseudoElement(
    source,
    clone,
    '::before',
    getComputedStyle,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal,
    dimensionSemantics,
    headingFlowCollector
  );
  await addPseudoElement(
    source,
    clone,
    '::after',
    getComputedStyle,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal,
    dimensionSemantics,
    headingFlowCollector
  );
  throwIfBackgroundPreparationAborted(signal);
  await yieldToBrowser?.();
  throwIfBackgroundPreparationAborted(signal);
  appendThemeImages(
    clone,
    preserveRepeatingBackground ? [] : imageLayers,
    exportComputed,
    !source.textContent?.trim() && !source.children.length
  );
}

function inlineStylesSynchronously(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  previewRoot: HTMLElement,
  sourceRoot: HTMLElement,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  taskGeometry: TaskCheckboxGeometryContext | null = null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): boolean {
  if (!(source instanceof Element) || !(clone instanceof Element)) return true;
  const computed = getComputedStyle(source);
  if (!root && 'none' === computed.getPropertyValue('display') && !isSvgDefinition(source)) {
    HIDDEN_NODES.add(clone);
    return true;
  }
  assertTaskCheckboxAppearancePortable(source, computed);
  const declarations = styleDeclarationsSynchronously(source, computed, false, root, runtime, dimensionSemantics);
  if (null === declarations) return false;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const exportComputed = root ? rootExportComputedStyle(source, computed, dimensionSemantics) : computed;
  const preserveRepeatingBackground = hasRepeatingBackground(exportComputed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations, preserveRepeatingBackground);
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_CLONES.add(clone);
    taskCheckboxStaticPaintExpectationFor(clone).baseProperties = taskCheckboxStaticPaintProperties(computed);
  }
  assertTaskCheckboxStaticOwnerBase(source, clone);
  taskGeometry?.validate(source, clone, computed);
  if ('THEAD' === source.tagName) {
    TABLE_HEADER_BACKGROUND_METADATA.set(clone, tableHeaderBackgroundMetadata(source, runtime));
  }
  const projectedTableHeaderBackground = 'TH' === source.tagName ? tableHeaderBackgroundProjection(clone) : null;
  if (projectedTableHeaderBackground) {
    appendDeclarations(clone, [`background-color:${projectedTableHeaderBackground}`]);
  }
  if (['OL', 'UL'].includes(source.tagName)) {
    const markerGutter = listMarkerGutterMetadata(source, computed, runtime);
    const direction = listMarkerDirection(source, computed);
    if (markerGutter && direction) applyListMarkerGutter(clone, markerGutter, direction);
  }
  if (source.matches('.katex')) KATEX_VISUAL_ROOTS.add(clone);
  if (source.matches('.easymde-math-block')) MATH_BLOCK_ROOTS.add(clone);
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (
    'TABLE' === source.tagName &&
    fullWidthTableLayout(source, computed, runtime.getComputedStyle, previewRoot, sourceRoot)
  ) {
    FULL_WIDTH_TABLE_CLONES.add(clone);
  }
  if ('TABLE' === source.tagName) {
    const metadata = tableScrollOwnerMetadata(source, computed);
    if (metadata) TABLE_SCROLL_OWNER_METADATA.set(clone, metadata);
  }
  markVisualRasterizationClone(source, clone);
  if (isVisiblePaintedThemeHeadingSuffix(source, computed)) {
    THEME_HEADING_SUFFIX_CLONES.add(clone);
  }
  if (isKaTeXVisualNode(source)) {
    KATEX_VISUAL_NODES.add(clone);
    appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
    if (!source.childNodes.length && !source.textContent) clone.textContent = '\u2060';
  }
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  for (const [index, child] of Array.from(source.childNodes).entries()) {
    const cloneChild = clone.childNodes.item(index);
    if (
      cloneChild &&
      !inlineStylesSynchronously(
        child,
        cloneChild,
        getComputedStyle,
        false,
        runtime,
        previewRoot,
        sourceRoot,
        dimensionSemantics,
        taskGeometry,
        headingFlowCollector
      )
    )
      return false;
  }
  if (!addPseudoElementSynchronously(
    source,
    clone,
    '::before',
    getComputedStyle,
    root,
    runtime,
    dimensionSemantics,
    headingFlowCollector
  ))
    return false;
  if (!addPseudoElementSynchronously(
    source,
    clone,
    '::after',
    getComputedStyle,
    root,
    runtime,
    dimensionSemantics,
    headingFlowCollector
  ))
    return false;
  appendThemeImages(
    clone,
    preserveRepeatingBackground ? [] : imageLayers,
    exportComputed,
    !source.textContent?.trim() && !source.children.length
  );
  return true;
}

function normalizeStructure(clone: HTMLElement): HTMLElement {
  const document = clone.ownerDocument;
  const root = ['ARTICLE', 'BLOCKQUOTE', 'DIV'].includes(clone.tagName) ? document.createElement('section') : clone;

  if (root !== clone) {
    if (TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.has(clone)) {
      TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.set(clone, root);
    }
    const ownerSequence = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(clone);
    if (ownerSequence) TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(root, ownerSequence);
    Array.from(clone.attributes).forEach((attribute) => {
      root.setAttribute(attribute.name, attribute.value);
    });
    while (clone.firstChild) root.appendChild(clone.firstChild);
  }

  root.querySelectorAll('blockquote, div').forEach((element) => {
    if (element.closest('svg')) return;
    const section = document.createElement('section');
    if (TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.has(element)) {
      TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.set(element, section);
    }
    Array.from(element.attributes).forEach((attribute) => {
      section.setAttribute(attribute.name, attribute.value);
    });
    while (element.firstChild) section.appendChild(element.firstChild);
    element.replaceWith(section);
  });

  return root;
}

function appendDeclarations(element: Element, declarations: string[], important = false): void {
  if (!declarations.length) return;
  const existing = element.getAttribute('style') ?? '';
  const normalized = important
    ? declarations.map((declaration) => (declaration.endsWith('!important') ? declaration : `${declaration}!important`))
    : declarations;
  element.setAttribute('style', [existing, ...normalized].filter(Boolean).join(';'));
}

function markWechatOwnedScrollOwner(element: Element): void {
  element.setAttribute(WECHAT_IGNORE_WIDTH_ATTRIBUTE, '');
}

function tableScrollOwnerDeclarations(metadata: TableScrollOwnerMetadata): string[] {
  return [
    `border-collapse:${metadata.borderCollapse}`,
    `overflow-x:${metadata.overflowX}`,
    `overflow-y:${metadata.overflowY}`
  ];
}

function wrapTableScrollOwners(root: HTMLElement): void {
  const document = root.ownerDocument;
  root.querySelectorAll('table').forEach((table) => {
    const parent = table.parentElement;
    if (!parent) return;
    const wrapper = document.createElement('section');
    appendDeclarations(
      wrapper,
      [
        'display:block',
        'width:100%',
        'max-width:100%',
        'min-width:0',
        'margin-left:auto',
        'margin-right:auto',
        'overflow-x:auto',
        'overflow-y:hidden',
        '-webkit-overflow-scrolling:touch',
        'box-sizing:border-box',
        'text-align:center'
      ],
      true
    );
    markWechatOwnedScrollOwner(wrapper);
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    appendDeclarations(
      table,
      FULL_WIDTH_TABLE_CLONES.has(table)
        ? [
            'width:100%',
            'max-width:100%',
            'margin-left:0',
            'margin-right:0',
            'overflow:visible',
            'overflow-x:visible',
            'overflow-y:visible'
          ]
        : [
            'width:max-content',
            'max-width:none',
            'min-width:0',
            'margin-left:auto',
            'margin-right:auto',
            'overflow:visible',
            'overflow-x:visible',
            'overflow-y:visible'
          ],
      true
    );
    const metadata = TABLE_SCROLL_OWNER_METADATA.get(table);
    if (metadata) appendDeclarations(table, tableScrollOwnerDeclarations(metadata), true);
  });
}

function normalizeCodeFrames(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach((pre) => {
    appendDeclarations(
      pre,
      [
        'display:block',
        'width:100%',
        'max-width:100%',
        'box-sizing:border-box',
        'overflow-x:auto',
        'overflow-y:hidden',
        '-webkit-overflow-scrolling:touch',
        'white-space:pre',
        'word-break:normal',
        'overflow-wrap:normal'
      ],
      true
    );
    const code = pre.querySelector(':scope > code');
    if (code) {
      appendDeclarations(
        code,
        [
          // Keep the same scroll owner as the rendered preview. WeChat preserves
          // this direct code scroll container more reliably than intrinsic widths
          // on a nested child.
          'display:block',
          'width:100%',
          'max-width:100%',
          'box-sizing:border-box',
          'overflow-x:auto',
          'overflow-y:hidden',
          '-webkit-overflow-scrolling:touch',
          'white-space:pre',
          'word-break:normal',
          'overflow-wrap:normal'
        ],
        true
      );
      markWechatOwnedScrollOwner(code);
    }

    const marker = Array.from(pre.children).find((child) => CODE_FRAME_PSEUDO_CLONES.has(child));
    if (!marker) return;
    const markerText = marker.firstChild;
    if (1 === marker.childNodes.length && markerText?.nodeType === 3 && markerText.nodeValue === ' ') {
      markerText.nodeValue = '\u2060';
    }
    const markerStyle = (marker as HTMLElement).style;
    const reservedHeight = finiteCssPixelValue(pre.style.getPropertyValue('padding-top'));
    const paddingLeft = finiteCssPixelValue(pre.style.getPropertyValue('padding-left'));
    const markerLeft = finiteCssPixelValue(markerStyle.getPropertyValue('left'));
    const markerTop = finiteCssPixelValue(markerStyle.getPropertyValue('top'));
    const markerMarginLeft = finiteCssPixelValue(markerStyle.getPropertyValue('margin-left'));
    const markerMarginTop = finiteCssPixelValue(markerStyle.getPropertyValue('margin-top'));
    if (
      null === reservedHeight ||
      null === paddingLeft ||
      null === markerLeft ||
      null === markerTop ||
      null === markerMarginLeft ||
      null === markerMarginTop
    ) {
      throw new Error('wechat-code-frame-geometry-unavailable');
    }

    const markerLeftOffset = markerLeft + markerMarginLeft - paddingLeft;
    const markerTopOffset = markerTop + markerMarginTop;
    if (reservedHeight <= 0 || markerTopOffset < 0 || markerTopOffset > reservedHeight) {
      throw new Error('wechat-code-frame-geometry-unavailable');
    }
    const header = pre.ownerDocument.createElement('div');
    header.setAttribute('aria-hidden', 'true');
    appendDeclarations(
      header,
      [
        'display:block',
        'width:100%',
        `height:${reservedHeight}px`,
        'box-sizing:border-box',
        'overflow:visible',
        'margin:0',
        `padding-top:${markerTopOffset}px`,
        'padding-right:0',
        'padding-bottom:0',
        `padding-left:${Math.max(0, markerLeftOffset)}px`
      ],
      true
    );
    appendDeclarations(pre, ['padding-top:0'], true);
    [
      'display',
      'position',
      'top',
      'left',
      'right',
      'bottom',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left'
    ].forEach((property) => {
      markerStyle.removeProperty(property);
    });
    appendDeclarations(
      marker,
      [
        'display:block',
        'margin-top:0',
        'margin-right:0',
        'margin-bottom:0',
        `margin-left:${Math.min(0, markerLeftOffset)}px`
      ],
      true
    );
    CODE_FRAME_HEADER_CLONES.add(header);
    pre.insertBefore(header, marker);
    header.appendChild(marker);
  });
}

function wrapMermaidLabelContents(root: HTMLElement): void {
  const document = root.ownerDocument;
  root.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    const label = element.firstElementChild;
    if (!label || label.matches('nobr')) return;
    const wrapper = document.createElement('nobr');
    appendDeclarations(wrapper, ['display:inline-block', ...MERMAID_LABEL_LAYOUT_DECLARATIONS], true);
    while (label.firstChild) wrapper.appendChild(label.firstChild);
    label.appendChild(wrapper);
  });
}

function expandMermaidLabelGeometry(root: HTMLElement): void {
  root.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;

    const width = Number.parseFloat(element.getAttribute('width') ?? '');
    const x = Number.parseFloat(element.getAttribute('x') ?? '');
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(x)) return;

    // Mermaid sizes foreignObject boxes using the preview font. WeChat can
    // substitute a wider fallback font and clip the final CJK glyph even when
    // the copied SVG declares visible overflow. Expand around the original
    // center so the label remains aligned with its node while the destination
    // owns enough inline space for its actual font metrics.
    const expandedWidth = Math.max(width * MERMAID_LABEL_WIDTH_SCALE, width + MERMAID_LABEL_WIDTH_GUTTER);
    const expandedX = x - (expandedWidth - width) / 2;
    element.setAttribute('x', String(expandedX));
    element.setAttribute('width', String(expandedWidth));
    appendDeclarations(
      element,
      [
        `width:${expandedWidth}px`,
        'min-width:max-content',
        'max-width:none',
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible'
      ],
      true
    );

    const label = element.firstElementChild;
    if (!label) return;
    appendDeclarations(
      label,
      [
        'width:max-content',
        'min-width:max-content',
        'max-width:none',
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible'
      ],
      true
    );
  });
}

function preserveMermaidLabelWhitespace(root: HTMLElement): void {
  root.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
      const value = textNode.nodeValue ?? '';
      if (!value || value.includes('\u2060')) return;
      textNode.nodeValue = Array.from(value)
        .map((character) => (' ' === character ? '\u2060 \u2060' : character))
        .join('\u2060');
    });
  });
}

function normalizeMathBlocks(root: HTMLElement): void {
  Array.from(root.querySelectorAll('*'))
    .filter((element) => MATH_BLOCK_ROOTS.has(element))
    .forEach((element) => {
      // Keep a formula's visual tree horizontally scrollable while preventing
      // destination editor rules from creating a second vertical scroll axis.
      appendDeclarations(
        element,
        [
          'display:block',
          'inline-size:100%',
          'max-inline-size:100%',
          'margin-left:auto',
          'margin-right:auto',
          'box-sizing:border-box',
          'overflow-x:auto',
          'overflow-y:hidden',
          'height:auto',
          'max-height:none',
          'text-align:center'
        ],
        true
      );
      markWechatOwnedScrollOwner(element);

      // The preview's computed width belongs to its original card. Copying it
      // onto the block wrapper and KaTeX visual root makes a wider WeChat card
      // center the formula against that stale width, visibly shifting it left.
      // Rebase both layout layers to the destination card without changing the
      // intrinsic, non-wrapping content that the outer card scrolls.
      const layoutRoot = element.firstElementChild;
      if (!layoutRoot) return;
      if (WECHAT_PNG_GENERATED_IMAGES.has(layoutRoot)) {
        generatedBlockImageAlignment(layoutRoot, element);
        return;
      }
      const layoutDeclarations = [
        'inline-size:100%',
        'max-inline-size:100%',
        'width:auto',
        'box-sizing:border-box',
        'text-align:center'
      ];
      appendDeclarations(layoutRoot, layoutDeclarations, true);

      const visualWrapper = layoutRoot.firstElementChild;
      if (visualWrapper?.matches('nobr')) {
        appendDeclarations(
          visualWrapper,
          ['inline-size:100%', 'max-inline-size:100%', 'width:auto', 'box-sizing:border-box'],
          true
        );
        const visualRoot = visualWrapper.firstElementChild;
        if (visualRoot) appendDeclarations(visualRoot, layoutDeclarations, true);
      }
    });
}

function wrapCodeLines(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    const document = code.ownerDocument;
    const createLine = (): HTMLElement => {
      const line = document.createElement('nobr');
      appendDeclarations(
        line,
        [
          'display:inline-block',
          'width:max-content',
          'min-width:max-content',
          'max-width:none',
          'white-space:nowrap',
          'word-break:keep-all',
          'overflow-wrap:normal'
        ],
        true
      );
      return line;
    };

    // Highlight.js can keep a multiline comment or string inside one token
    // span. Split nested breaks into cloned token segments before wrapping
    // logical lines, otherwise only direct code children become scroll-safe.
    const splitNode = (node: Node): Node[][] => {
      if (node instanceof Text) {
        return (node.nodeValue ?? '').split(/\r?\n/).map((value) => [document.createTextNode(value)]);
      }
      if (!(node instanceof Element)) return [[node.cloneNode(true)]];
      if ('BR' === node.tagName) return [[], []];
      const segments: Node[][] = [[]];
      Array.from(node.childNodes).forEach((child) => {
        if (child instanceof Element && 'BR' === child.tagName) {
          segments.push([]);
          return;
        }
        const childSegments = splitNode(child);
        segments[segments.length - 1]?.push(...(childSegments[0] ?? []));
        childSegments.slice(1).forEach((segment) => {
          segments.push(segment);
        });
      });
      return segments.map((segment) => {
        const clone = node.cloneNode(false) as Element;
        clone.append(...segment);
        return [clone];
      });
    };
    const lines: Node[][] = [[]];
    Array.from(code.childNodes).forEach((node) => {
      if (node instanceof Element && 'BR' === node.tagName) {
        lines.push([]);
        return;
      }
      const segments = splitNode(node);
      lines[lines.length - 1]?.push(...(segments[0] ?? []));
      segments.slice(1).forEach((segment) => {
        lines.push(segment);
      });
    });
    const fragment = document.createDocumentFragment();
    lines.forEach((nodes, index) => {
      const line = createLine();
      line.append(...nodes);
      fragment.append(line);
      if (index < lines.length - 1) fragment.append(document.createElement('br'));
    });
    code.replaceChildren(fragment);
  });
}

function preserveCodeLineWhitespace(root: HTMLElement): void {
  root.querySelectorAll('pre > code > nobr[style*="width:max-content"]').forEach((line) => {
    const walker = line.ownerDocument.createTreeWalker(line, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
      textNode.nodeValue = (textNode.nodeValue ?? '').replaceAll(' ', '\u2060 \u2060');
    });
  });
}

function normalizeCodeWhitespace(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    code.querySelectorAll('*').forEach((element) => {
      if ('BR' === element.tagName) return;
      if (element.parentElement === code && 'NOBR' === element.tagName) return;
      appendDeclarations(element, ['white-space:pre', 'word-break:normal', 'overflow-wrap:normal'], true);
    });

    // WeChat's topic scanner uses this stop-character set. U+2060 is not a
    // stop character, so preserve it and add a FEFF before it when the hash
    // would otherwise continue a topic; existing FEFF already stops it.
    const normalizations =
      EXPORT_TEXT_NORMALIZATIONS.get(root) ?? new Map<Text, Readonly<{ original: string; encoded: string }>>();
    EXPORT_TEXT_NORMALIZATIONS.set(root, normalizations);
    code.querySelectorAll(':scope > nobr').forEach((line) => {
      const walker = line.ownerDocument.createTreeWalker(line, 4);
      const textNodes: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
      }
      const logicalLine = textNodes.map((textNode) => textNode.nodeValue ?? '').join('');
      const insertions = new Map<Text, number[]>();
      let logicalOffset = 0;
      textNodes.forEach((textNode) => {
        const value = textNode.nodeValue ?? '';
        const offsets: number[] = [];
        for (let offset = value.indexOf('#'); offset >= 0; offset = value.indexOf('#', offset + 1)) {
          const nextCodePoint = logicalLine.codePointAt(logicalOffset + offset + 1);
          const nextCharacter = undefined === nextCodePoint ? '' : String.fromCodePoint(nextCodePoint);
          const isEmojiSuffix = ['\uFE0E', '\uFE0F', '\u20E3'].includes(nextCharacter);
          if (nextCharacter && !WECHAT_TOPIC_STOP_CHARACTER.test(nextCharacter) && !isEmojiSuffix) {
            offsets.push(offset + 1);
          }
        }
        if (offsets.length) insertions.set(textNode, offsets);
        logicalOffset += value.length;
      });
      insertions.forEach((offsets, textNode) => {
        const original = textNode.nodeValue ?? '';
        let encoded = original;
        offsets
          .sort((left, right) => right - left)
          .forEach((offset) => {
            encoded = `${encoded.slice(0, offset)}\uFEFF${encoded.slice(offset)}`;
          });
        if (encoded === original) return;
        textNode.nodeValue = encoded;
        normalizations.set(textNode, { original, encoded });
      });
    });
  });
}

function wrapCodeRows(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    // Keep normalized line nodes intact inside one intrinsic block; CODE stays
    // the only horizontal scroll owner.
    const rows = code.ownerDocument.createElement('span');
    appendDeclarations(
      rows,
      [
        'display:block',
        'width:max-content',
        'min-width:100%',
        'max-width:none',
        'white-space:pre',
        'word-break:normal',
        'overflow-wrap:normal'
      ],
      true
    );
    while (code.firstChild) rows.appendChild(code.firstChild);
    code.appendChild(rows);
  });
}

function materializeCodeLineBreaks(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    let terminalNode: Node = code;
    while (terminalNode.lastChild) terminalNode = terminalNode.lastChild;
    if (terminalNode instanceof Text) {
      const value = terminalNode.nodeValue ?? '';
      const terminalSeparator = value.endsWith('\r\n') ? 2 : value.endsWith('\n') ? 1 : 0;
      if (terminalSeparator) {
        terminalNode.nodeValue = value.slice(0, -terminalSeparator);
      }
    }
    const walker = code.ownerDocument.createTreeWalker(code, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const value = textNode.nodeValue ?? '';
      if (!/[\r\n]/.test(value)) return;
      const fragment = code.ownerDocument.createDocumentFragment();
      const lines = value.split(/\r\n?|\n/);
      lines.forEach((line, index) => {
        if (line) fragment.append(code.ownerDocument.createTextNode(line));
        if (index < lines.length - 1) fragment.append(code.ownerDocument.createElement('br'));
      });
      textNode.replaceWith(fragment);
    });
  });
}

function findKaTeXMathMl(root: HTMLElement): Set<Element> {
  // WeChat imports KaTeX's MathML and visual trees as separate text runs.
  return new Set(root.querySelectorAll('.katex-mathml'));
}

function referencedFragmentIds(preview: HTMLElement): Set<string> {
  const ids = new Set<string>();
  preview.querySelectorAll('a[href^="#"]').forEach((link) => {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    if (/^[A-Za-z][\w:.-]{0,120}$/.test(id)) ids.add(id);
  });
  return ids;
}

function retainReferencedFragmentIds(root: HTMLElement, ids: Set<string>): void {
  root.querySelectorAll('[id]').forEach((element) => {
    if (element.closest('svg') || ids.has(element.id)) return;
    element.removeAttribute('id');
  });
  if (root.id && !ids.has(root.id) && !root.closest('svg')) root.removeAttribute('id');
}

function wrapTextLeaves(root: HTMLElement): void {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const parent = textNode.parentElement;
    const value = textNode.nodeValue ?? '';
    if (
      !parent ||
      parent.closest('svg') ||
      parent.matches('span[leaf]') ||
      parent.matches('span[aria-hidden="true"]') ||
      (!value.trim() && !parent.closest('pre, code'))
    )
      return;
    const leaf = document.createElement('span');
    const previousSibling = textNode.previousSibling;
    const directTextNodes = Array.from(parent.childNodes).filter((child): child is Text => child.nodeType === 3);
    const taskCheckboxCaptionBinding = TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.get(textNode);
    const inlineMarkerLeaf = Boolean(
      'LI' === parent.tagName &&
        parent.childNodes.length === 2 &&
        previousSibling instanceof Element &&
        INLINE_TEXT_MARKER_CLONES.has(previousSibling) &&
        directTextNodes.length === 1 &&
        directTextNodes[0] === textNode
    );
    const taskCheckboxInlineLeaf = Boolean(
      taskCheckboxCaptionBinding || TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.has(textNode)
    );
    if (!inlineMarkerLeaf && !taskCheckboxInlineLeaf) leaf.setAttribute('leaf', '');
    else leaf.style.setProperty('display', 'inline');
    leaf.textContent = value;
    parent.replaceChild(leaf, textNode);
    if (taskCheckboxCaptionBinding) {
      TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS.add(leaf);
      const replacementText = leaf.firstChild;
      if (!(replacementText instanceof Text)) throw new Error('wechat-task-checkbox-caption-record-missing');
      const normalizations = EXPORT_TEXT_NORMALIZATIONS.get(root);
      const normalization = normalizations?.get(textNode);
      taskCheckboxCaptionBinding.binding.cloneText = replacementText;
      TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.delete(textNode);
      TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.set(replacementText, taskCheckboxCaptionBinding);
      if (normalizations && normalization) {
        normalizations.delete(textNode);
        normalizations.set(replacementText, normalization);
      }
    }
  });
}

function pngScale(preview: HTMLElement): number {
  const value = preview.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  return Number.isFinite(value) ? Math.min(2, Math.max(1, value)) : 1;
}

function stablePngFailureCode(error: unknown): string {
  const code = error && 'object' === typeof error ? (error as { code?: unknown }).code : null;
  return 'string' === typeof code && /^wechat-png-[a-z0-9-]+$/u.test(code) ? code : 'unknown';
}

function finitePngDiagnosticDimension(value: unknown): number | null {
  if ('number' !== typeof value || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function pngFailureDiagnostic(
  candidate: number,
  kind: WechatVisualRasterizationKind,
  stage: WechatPngFailureStage,
  error: unknown,
  dimensions?: Readonly<{ height: unknown; width: unknown }>
): WechatPngFailureDiagnostic {
  return {
    candidate,
    height: finitePngDiagnosticDimension(dimensions?.height),
    kind,
    originalCode: stablePngFailureCode(error),
    stage,
    width: finitePngDiagnosticDimension(dimensions?.width)
  };
}

function logPngFailureDiagnostic(error: WechatPngConversionError): void {
  if (!error.diagnostic || 'wechat-png-rasterization-failed' !== error.code) return;
  console.error(`[EasyMDE] ${error.code}`, error.diagnostic);
}

function pngConversionErrorCode(error: unknown): WechatPngConversionError['code'] {
  const code =
    error && 'object' === typeof error
      ? ((error as { code?: unknown }).code ?? (error instanceof Error ? error.message : null))
      : error instanceof Error
        ? error.message
        : null;
  if ('wechat-png-size-invalid' === code) return 'wechat-png-limit-exceeded';
  if ('wechat-png-limit-exceeded' === code) return 'wechat-png-limit-exceeded';
  if ('wechat-png-rasterization-cancelled' === code) return 'wechat-png-rasterization-cancelled';
  if ('wechat-png-rasterization-timeout' === code) return 'wechat-png-rasterization-timeout';
  if ('wechat-png-transaction-timeout' === code) return 'wechat-png-transaction-timeout';
  if ('wechat-png-upload-failed' === code) return 'wechat-png-upload-failed';
  if ('wechat-png-upload-nonce-invalid' === code) return 'wechat-png-upload-nonce-invalid';
  return 'wechat-png-rasterization-failed';
}

function assertPngConversionCurrent(context: WechatPngConversionContext): void {
  if (context.signal.aborted || (context.isCurrent && !context.isCurrent())) {
    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
  }
}

function safeUploadedImageUrl(value: unknown): string | null {
  if ('string' !== typeof value || '' === value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  return value;
}

function validRasterizationResult(value: WechatVisualRasterizationResult): boolean {
  const file = value?.file;
  return Boolean(
    value &&
      file &&
      'object' === typeof file &&
      'string' === typeof file.type &&
      'image/png' === file.type.toLowerCase() &&
      Number.isSafeInteger(file.size) &&
      file.size >= 1 &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height) &&
      value.width >= 1 &&
      value.width <= MAX_WECHAT_PNG_DIMENSION &&
      value.height >= 1 &&
      value.height <= MAX_WECHAT_PNG_DIMENSION &&
      Number.isSafeInteger(value.pixelCount) &&
      value.pixelCount >= 1 &&
      value.pixelCount <= MAX_WECHAT_PNG_PIXELS
  );
}

function exceedsRasterizationDimensionBudget(value: unknown): boolean {
  if (!value || 'object' !== typeof value) return false;
  const result = value as Partial<WechatVisualRasterizationResult>;
  return (
    (Number.isFinite(result.width) && (result.width as number) > MAX_WECHAT_PNG_DIMENSION) ||
    (Number.isFinite(result.height) && (result.height as number) > MAX_WECHAT_PNG_DIMENSION) ||
    (Number.isFinite(result.pixelCount) && (result.pixelCount as number) > MAX_WECHAT_PNG_PIXELS)
  );
}

function responsiveRasterizationResultMatchesRequest(
  value: WechatVisualRasterizationResult,
  width: number,
  height: number,
  scale: number
): boolean {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(scale) ||
    width <= 0 ||
    height <= 0 ||
    scale < 1 ||
    scale > 2
  )
    return false;
  const pixelWidth = Math.ceil(width * scale);
  const pixelHeight = Math.round((pixelWidth * height) / width);
  return (
    Number.isSafeInteger(pixelWidth) &&
    Number.isSafeInteger(pixelHeight) &&
    pixelWidth >= 1 &&
    pixelHeight >= 1 &&
    value.width >= 1 &&
    value.height >= 1 &&
    Math.abs(value.width - width) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
    Math.abs(value.height - height) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
    value.pixelCount === pixelWidth * pixelHeight
  );
}

function isVisualOverflowOwner(style: CSSStyleDeclaration | undefined): boolean {
  if (!style) return false;
  return ['overflow', 'overflow-x', 'overflow-y'].some((property) => {
    const value = style.getPropertyValue(property).trim().toLowerCase();
    return ['auto', 'scroll', 'hidden', 'clip'].includes(value);
  });
}

function generatedBlockImageAlignment(image: Element, owner: Element): void {
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

function centerMermaidGeneratedBlock(image: Element, sourceUsesAutoBlockMargins: boolean): void {
  if (!sourceUsesAutoBlockMargins) return;
  const imageStyle = (image as Element & { style?: CSSStyleDeclaration }).style;
  if ('block' !== imageStyle?.getPropertyValue('display').trim().toLowerCase()) return;
  appendDeclarations(image, ['margin-left:auto', 'margin-right:auto'], true);
}

function requiresInlineBaseline(kind: WechatVisualRasterizationKind, element: Element): boolean {
  if ('math' !== kind) return false;
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const display = style?.getPropertyValue('display').trim().toLowerCase() ?? '';
  return ['inline', 'inline-block', 'inline-flex'].includes(display);
}

function assertInlineRasterizationResult(
  kind: WechatVisualRasterizationKind,
  element: Element,
  rasterized: WechatVisualRasterizationResult
): void {
  if (!requiresInlineBaseline(kind, element)) return;
  const inlineLayout = rasterized.inlineLayout;
  if (
    !inlineLayout ||
    !Number.isFinite(inlineLayout.width) ||
    !Number.isFinite(inlineLayout.height) ||
    !Number.isFinite(inlineLayout.baseline) ||
    !Number.isFinite(inlineLayout.paintOffsetX) ||
    !Number.isFinite(inlineLayout.paintOffsetY) ||
    inlineLayout.width <= 0 ||
    inlineLayout.height <= 0 ||
    inlineLayout.width > MAX_WECHAT_PNG_DIMENSION ||
    inlineLayout.height > MAX_WECHAT_PNG_DIMENSION ||
    Math.abs(inlineLayout.baseline) > MAX_WECHAT_PNG_DIMENSION ||
    Math.abs(inlineLayout.paintOffsetX) > MAX_WECHAT_PNG_DIMENSION ||
    Math.abs(inlineLayout.paintOffsetY) > MAX_WECHAT_PNG_DIMENSION ||
    (inlineLayout.overflowX !== undefined && !isValidInlineOverflow(inlineLayout.overflowX)) ||
    (inlineLayout.overflowY !== undefined && !isValidInlineOverflow(inlineLayout.overflowY)) ||
    (inlineLayout.viewport !== undefined &&
      (!Number.isFinite(inlineLayout.viewport.width) ||
        !Number.isFinite(inlineLayout.viewport.height) ||
        !Number.isFinite(inlineLayout.viewport.offsetX) ||
        !Number.isFinite(inlineLayout.viewport.offsetY) ||
        inlineLayout.viewport.width <= 0 ||
        inlineLayout.viewport.height <= 0 ||
        inlineLayout.viewport.width > MAX_WECHAT_PNG_DIMENSION ||
        inlineLayout.viewport.height > MAX_WECHAT_PNG_DIMENSION ||
        Math.abs(inlineLayout.viewport.offsetX) > MAX_WECHAT_PNG_DIMENSION ||
        Math.abs(inlineLayout.viewport.offsetY) > MAX_WECHAT_PNG_DIMENSION))
  ) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
}

function isValidInlineOverflow(value: string): boolean {
  return ['auto', 'clip', 'hidden', 'scroll', 'visible'].includes(value);
}

function inlineOverflowStyleValue(
  value: string | undefined,
  sourceStyle: CSSStyleDeclaration | undefined,
  axis: 'overflow-x' | 'overflow-y'
): string {
  const fallback =
    sourceStyle?.getPropertyValue(axis).trim().toLowerCase() ||
    sourceStyle?.getPropertyValue('overflow').trim().toLowerCase() ||
    'visible';
  const candidate = value?.trim().toLowerCase() || fallback;
  return isValidInlineOverflow(candidate) ? candidate : 'visible';
}

function usesInlineOverflowViewport(overflowX: string, overflowY: string): boolean {
  return (
    ['auto', 'clip', 'hidden', 'scroll'].includes(overflowX) || ['auto', 'clip', 'hidden', 'scroll'].includes(overflowY)
  );
}

function positiveDimensionOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function inlineVerticalAlignValue(sourceStyle: CSSStyleDeclaration | undefined, measuredValue: number): string {
  const sourceValue = sourceStyle?.getPropertyValue('vertical-align').trim().toLowerCase();
  if ('top' === sourceValue || 'bottom' === sourceValue) return sourceValue;
  return `${Object.is(measuredValue, -0) ? 0 : measuredValue}px`;
}

function nativeVisualStyleProperties(source: Element, _computed: CSSStyleDeclaration): readonly string[] {
  const layoutProperties = [
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : ORDINARY_LAYOUT_PROPERTIES),
    ...NATIVE_LAYOUT_PROPERTIES
  ];
  return [
    ...new Set([...COPY_STYLE_PROPERTIES, ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []), ...layoutProperties])
  ];
}

async function nativeVisualStyleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null
): Promise<string[]> {
  const declarations: string[] = [];
  for (const property of nativeVisualStyleProperties(source, computed)) {
    const value = computed.getPropertyValue(property);
    const materializedValue =
      ('background' === property || 'background-image' === property) && value.includes('url(')
        ? await materializeBackgroundValue(property, value, runtime, cache)
        : value;
    if (null === materializedValue) continue;
    if (keepStyle(property, materializedValue, source, false, false, value, false)) {
      declarations.push(`${property}:${materializedValue}`);
    }
    if (yieldToBrowser?.shouldYield()) await yieldToBrowser();
  }
  return declarations;
}

async function createNativeVisualCaptureClone(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null,
  context: WechatPngConversionContext
): Promise<Readonly<{ cleanup: () => void; element: Element }>> {
  const clone = source.cloneNode(true) as Element;
  const walk = async (sourceNode: Node, cloneNode: Node): Promise<void> => {
    assertPngConversionCurrent(context);
    if (!(sourceNode instanceof Element) || !(cloneNode instanceof Element)) return;
    const computed = runtime.getComputedStyle(sourceNode);
    const declarations = await nativeVisualStyleDeclarations(sourceNode, computed, runtime, cache, yieldToBrowser);
    if (declarations.length) cloneNode.setAttribute('style', declarations.join(';'));
    else cloneNode.removeAttribute('style');
    removeTransientAttributes(cloneNode);
    for (const [index, child] of Array.from(sourceNode.childNodes).entries()) {
      const cloneChild = cloneNode.childNodes.item(index);
      if (cloneChild) await walk(child, cloneChild);
    }
    await yieldToBrowser?.();
  };

  await walk(source, clone);
  findKaTeXMathMl(clone as HTMLElement).forEach((element) => {
    element.remove();
  });
  clone.querySelectorAll('script, style').forEach((element) => {
    element.remove();
  });
  clone.querySelectorAll('*').forEach((element) => {
    removeTransientAttributes(element);
  });
  assertPngConversionCurrent(context);
  return { cleanup: () => undefined, element: clone };
}

function restoreVerifiedMermaidCaptureIdentity(clone: Element, role: WechatVisualRasterizationMermaidLayoutRole): void {
  if (!clone.matches('.easymde-mermaid')) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  if (!MERMAID_INTRINSIC_LAYOUT_ROLES.has(role)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const svg = mermaidDirectSvg(clone);
  if (!svg) throw new WechatPngConversionError('wechat-png-rasterization-failed');
  svg.setAttribute('aria-roledescription', role);
}

async function replaceVisualObjects(
  root: HTMLElement,
  context: WechatPngConversionContext,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null
): Promise<void> {
  const candidates: Array<Readonly<{ element: Element; kind: WechatVisualRasterizationKind; source: Element }>> = [];
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    const registration = WECHAT_PNG_VISUAL_CLONES.get(element);
    if (registration) candidates.push({ element, ...registration });
  }
  if (candidates.length > MAX_WECHAT_PNG_VISUALS) {
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  }
  if (!candidates.length) return;
  if (!Number.isSafeInteger(context.maxBytes) || context.maxBytes < 1) {
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  }
  const rasterizationYield = createRasterizationYield(yieldToBrowser, context);
  const timingPerformance = root.ownerDocument.defaultView?.performance;
  const timingMetadata = (
    candidate: number,
    kind: WechatVisualRasterizationKind,
    mode: WechatTimingMode
  ): WechatTimingMetadata => ({ candidate, kind, mode });

  let totalPixels = 0;
  let totalBytes = 0;
  type Candidate = (typeof candidates)[number];
  type CompletedUpload = Readonly<{
    candidate: Candidate;
    intrinsicMermaid?: boolean;
    layoutMagnification?: number;
    mermaidAutoMargins: boolean;
    mermaidCapture?: WechatVisualRasterizationMermaidCapture;
    mermaidMaxWidth?: number;
    rasterized: WechatVisualRasterizationResult;
    sourceRect: Readonly<{ height: number; width: number }>;
    url: string;
  }>;
  const completedUploads: Array<CompletedUpload | undefined> = [];
  const pendingUploads = new Set<Promise<void>>();
  const allUploads: Promise<void>[] = [];
  let activeUploadAttempts = 0;
  let successfulUploads = 0;
  let uncertainUploadAttempts = 0;
  const updateUploadSideEffects = (): void => {
    context.state.uploadsMayRemain = Boolean(activeUploadAttempts || successfulUploads || uncertainUploadAttempts);
  };
  const beginUploadAttempt = (): void => {
    activeUploadAttempts += 1;
    updateUploadSideEffects();
  };
  const finishUploadAttempt = (sideEffects: ImageUploadFailureSideEffects | undefined, uploaded: boolean): void => {
    activeUploadAttempts = Math.max(0, activeUploadAttempts - 1);
    if (uploaded) {
      successfulUploads += 1;
    } else if ('none' !== sideEffects) {
      uncertainUploadAttempts += 1;
    }
    updateUploadSideEffects();
  };
  let uploadFailure: unknown = null;
  let rejectUploadFailure: ((error: unknown) => void) | null = null;
  const uploadFailureGate = new Promise<never>((_resolve, reject) => {
    rejectUploadFailure = reject;
  });
  const recordUploadFailure = (error: unknown): void => {
    if (null !== uploadFailure) return;
    uploadFailure = error;
    rejectUploadFailure?.(error);
  };
  const uploadController = new AbortController();
  const forwardConversionAbort = (): void => uploadController.abort();
  if (context.signal.aborted) {
    uploadController.abort();
  } else {
    context.signal.addEventListener('abort', forwardConversionAbort, { once: true });
  }
  const removeConversionAbort = (): void => {
    context.signal.removeEventListener('abort', forwardConversionAbort);
  };

  const waitForUploadSlot = async (): Promise<void> => {
    while (pendingUploads.size >= MAX_WECHAT_PNG_UPLOAD_CONCURRENCY) {
      await Promise.race([...pendingUploads, uploadFailureGate]);
    }
    if (null !== uploadFailure) throw uploadFailure;
  };

  const uploadVisual = async (
    candidate: Candidate,
    rasterized: WechatVisualRasterizationResult,
    index: number,
    sourceRect: Readonly<{ height: number; width: number }>,
    layoutMagnification?: number,
    intrinsicMermaid = false,
    mermaidAutoMargins = false,
    mermaidCapture?: WechatVisualRasterizationMermaidCapture,
    mermaidMaxWidth?: number
  ): Promise<void> => {
    assertPngConversionCurrent(context);
    beginUploadAttempt();
    let uploadStarted = false;
    let attemptFinished = false;
    const finishAttempt = (sideEffects: ImageUploadFailureSideEffects | undefined, uploaded: boolean): void => {
      if (attemptFinished) return;
      attemptFinished = true;
      finishUploadAttempt(sideEffects, uploaded);
    };
    let uploaded: Awaited<ReturnType<ImageUploadPort['upload']>>;
    const uploadPromise = Promise.resolve().then(() => {
      if (uploadController.signal.aborted) {
        throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
      }
      uploadStarted = true;
      return context.imageUploadPort.upload({
        altText: '',
        file: rasterized.file,
        postId: context.postId,
        signal: uploadController.signal
      });
    });
    let removeUploadAbort = (): void => undefined;
    const uploadAbort = new Promise<never>((_resolve, reject) => {
      const abort = (): void => {
        reject(new WechatPngConversionError('wechat-png-rasterization-cancelled'));
      };
      if (uploadController.signal.aborted) {
        abort();
      } else {
        uploadController.signal.addEventListener('abort', abort, { once: true });
        removeUploadAbort = () => {
          uploadController.signal.removeEventListener('abort', abort);
        };
      }
    });
    try {
      uploaded = await Promise.race([uploadPromise, uploadAbort]);
      if ('failed' === uploaded.status) {
        const nonceRejected = 'easymde_rest_invalid_image_hosting_nonce' === uploaded.code;
        finishAttempt(nonceRejected && 'none' === uploaded.sideEffects ? 'none' : 'uploads-may-remain', false);
        throw new WechatPngConversionError(
          nonceRejected ? 'wechat-png-upload-nonce-invalid' : 'wechat-png-upload-failed'
        );
      }
      finishAttempt('none', true);
      const url = safeUploadedImageUrl(uploaded.url);
      if (!url) throw new WechatPngConversionError('wechat-png-upload-failed');
      assertPngConversionCurrent(context);
      completedUploads[index] = {
        candidate,
        ...(intrinsicMermaid ? { intrinsicMermaid: true } : {}),
        ...(layoutMagnification !== undefined ? { layoutMagnification } : {}),
        mermaidAutoMargins,
        ...(mermaidCapture ? { mermaidCapture } : {}),
        ...(mermaidMaxWidth !== undefined ? { mermaidMaxWidth } : {}),
        rasterized,
        sourceRect,
        url
      };
    } catch (error: unknown) {
      if (error instanceof WechatPngConversionError && 'wechat-png-upload-nonce-invalid' === error.code) {
        throw error;
      }
      if (context.signal.aborted || (context.isCurrent && !context.isCurrent())) {
        finishAttempt(uploadStarted ? 'uploads-may-remain' : 'none', false);
        throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
      }
      finishAttempt(uploadStarted ? 'uploads-may-remain' : 'none', false);
      throw new WechatPngConversionError('wechat-png-upload-failed');
    } finally {
      removeUploadAbort();
    }
  };

  const recordResponsiveSnapshot = (source: Element, dimensions: MermaidIntrinsicScrollDimensions | null): void => {
    if (dimensions?.capture !== 'responsive-viewport') return;
    if (context.mermaidResponsiveSnapshots.has(source)) return;
    if (!dimensions.svg || !Number.isFinite(dimensions.maxWidth) || (dimensions.maxWidth ?? 0) <= 0)
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    const svgRect = dimensions.svg.getBoundingClientRect();
    const cssWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'width');
    const cssHeight = mermaidResponsiveCssText(dimensions.svg, runtime, 'height');
    const cssMaxWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'max-width');
    if (
      ![svgRect.left, svgRect.right, svgRect.top, svgRect.bottom].every(Number.isFinite) ||
      !cssWidth ||
      !cssHeight ||
      !cssMaxWidth
    )
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    const sourceRect = source.getBoundingClientRect();
    if (![sourceRect.left, sourceRect.right, sourceRect.top, sourceRect.bottom].every(Number.isFinite))
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    context.mermaidResponsiveSnapshots.set(source, {
      bottom: svgRect.bottom - sourceRect.bottom,
      cssHeight,
      cssMaxWidth,
      cssWidth,
      height: dimensions.height,
      left: svgRect.left - sourceRect.left,
      maxWidth: dimensions.maxWidth as number,
      right: svgRect.right - sourceRect.right,
      svg: dimensions.svg,
      top: svgRect.top - sourceRect.top,
      width: dimensions.width
    });
  };

  try {
    for (const [index, candidate] of candidates.entries()) {
      assertPngConversionCurrent(context);
      await waitForUploadSlot();
      if (null !== uploadFailure) throw uploadFailure;
      let captureCancelled = false;
      const captureTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_COPY_TIMING_NAMES.candidateCapture,
        timingMetadata(index, candidate.kind, 'async')
      );
      if ('mermaid' === candidate.kind) {
        try {
          const preflightLayoutMagnification = mermaidLayoutMagnification(candidate.source, runtime);
          const preflightDimensions = mermaidIntrinsicScrollDimensions(
            candidate.source,
            runtime,
            preflightLayoutMagnification,
            context.captureBoundary
          );
          context.mermaidCaptureChoiceSnapshots.set(candidate.source, {
            capture: preflightDimensions?.capture ?? null
          });
          context.mermaidAutoMarginSnapshots.set(
            candidate.source,
            mermaidSourceUsesAutoBlockMargins(candidate.source, runtime)
          );
          recordResponsiveSnapshot(candidate.source, preflightDimensions);
        } catch (error: unknown) {
          captureTiming.finish('error');
          throw new WechatPngConversionError(
            pngConversionErrorCode(error),
            pngFailureDiagnostic(index, candidate.kind, 'intrinsic-gate', error)
          );
        }
      }
      let capturePromise: ReturnType<typeof createNativeVisualCaptureClone>;
      let capture: Awaited<ReturnType<typeof createNativeVisualCaptureClone>>;
      try {
        capturePromise = createNativeVisualCaptureClone(candidate.source, runtime, cache, yieldToBrowser, context);
        void capturePromise.then(
          (lateCapture) => {
            if (captureCancelled) lateCapture.cleanup();
          },
          () => undefined
        );
        capture = await Promise.race([capturePromise, uploadFailureGate]);
        captureTiming.finish('success');
      } catch (error: unknown) {
        captureTiming.finish('error');
        captureCancelled = true;
        throw new WechatPngConversionError(
          pngConversionErrorCode(error),
          pngFailureDiagnostic(index, candidate.kind, 'capture', error)
        );
      }
      const geometryTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_COPY_TIMING_NAMES.candidateGeometry,
        timingMetadata(index, candidate.kind, 'sync')
      );
      let sourceRect: Readonly<{ height: number; width: number }>;
      let captureDimensions: Readonly<{ height: number; width: number }>;
      let inlineVisual: boolean;
      let geometryParent: Element | null;
      try {
        sourceRect = candidate.source.getBoundingClientRect();
        inlineVisual = requiresInlineBaseline(candidate.kind, candidate.element);
        geometryParent = candidate.source.parentElement;
      } catch (error: unknown) {
        geometryTiming.finish('error');
        throw error;
      }
      let layoutMagnification: number | undefined;
      let intrinsicMermaid = false;
      let rasterized: WechatVisualRasterizationResult;
      let failureStage: WechatPngFailureStage = 'layout';
      let rasterizationTiming: WechatTimingHandle | null = null;
      let mermaidAutoMargins = false;
      let mermaidCapture: WechatVisualRasterizationMermaidCapture | undefined;
      let mermaidMaxWidth: number | undefined;
      try {
        layoutMagnification =
          'mermaid' === candidate.kind ? mermaidLayoutMagnification(candidate.source, runtime) : undefined;
        failureStage = 'intrinsic-gate';
        const intrinsicDimensions =
          'mermaid' === candidate.kind && layoutMagnification !== undefined
            ? mermaidIntrinsicScrollDimensions(candidate.source, runtime, layoutMagnification, context.captureBoundary)
            : null;
        if ('mermaid' === candidate.kind) {
          const capturedChoice = context.mermaidCaptureChoiceSnapshots.get(candidate.source);
          if (!capturedChoice || capturedChoice.capture !== (intrinsicDimensions?.capture ?? null)) {
            throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
          }
        }
        intrinsicMermaid = intrinsicDimensions?.capture === 'intrinsic-viewport';
        if (intrinsicDimensions?.capture === 'intrinsic-viewport' && intrinsicDimensions.role) {
          restoreVerifiedMermaidCaptureIdentity(capture.element, intrinsicDimensions.role);
        }
        geometryTiming.finish('success');
        captureDimensions = intrinsicDimensions ?? sourceRect;
        mermaidCapture = intrinsicDimensions?.capture;
        mermaidMaxWidth = intrinsicDimensions?.maxWidth;
        if ('mermaid' === candidate.kind) {
          const capturedAutoMargins = context.mermaidAutoMarginSnapshots.get(candidate.source);
          if (capturedAutoMargins === undefined) {
            throw new WechatPngConversionError('wechat-png-rasterization-failed');
          }
          mermaidAutoMargins = capturedAutoMargins;
        }
        if ('mermaid' === candidate.kind) {
          recordResponsiveSnapshot(candidate.source, intrinsicDimensions);
        }
        const rasterSource =
          intrinsicDimensions?.capture === 'responsive-viewport' ? mermaidDirectSvg(capture.element) : capture.element;
        if (!rasterSource) throw new WechatPngConversionError('wechat-png-rasterization-failed');
        failureStage = 'rasterization';
        rasterizationTiming = beginWechatTiming(
          timingPerformance,
          WECHAT_COPY_TIMING_NAMES.candidateRasterization,
          timingMetadata(index, candidate.kind, 'async')
        );
        const rasterization = withTimeout(
          context.rasterizationPort.rasterize({
            kind: candidate.kind,
            height: captureDimensions.height,
            ...(inlineVisual && geometryParent ? { inlineParent: geometryParent } : {}),
            maxPixels: MAX_WECHAT_PNG_PIXELS,
            ...(layoutMagnification !== undefined ? { layoutMagnification } : {}),
            ...(intrinsicDimensions ? { mermaidCapture: intrinsicDimensions.capture } : {}),
            scale: context.scale,
            signal: context.signal,
            source: rasterSource,
            ...(rasterizationYield ? { yieldToBrowser: rasterizationYield } : {}),
            width: captureDimensions.width
          }),
          WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
          'wechat-png-rasterization-timeout'
        );
        rasterized = await Promise.race([rasterization, uploadFailureGate]);
        rasterizationTiming.finish('success');
      } catch (error: unknown) {
        geometryTiming.finish('error');
        rasterizationTiming?.finish('error');
        throw new WechatPngConversionError(
          pngConversionErrorCode(error),
          pngFailureDiagnostic(index, candidate.kind, failureStage, error, sourceRect)
        );
      } finally {
        capture.cleanup();
      }
      if (null !== uploadFailure) throw uploadFailure;
      if (exceedsRasterizationDimensionBudget(rasterized)) {
        throw new WechatPngConversionError('wechat-png-limit-exceeded');
      }
      if (!validRasterizationResult(rasterized)) {
        throw new WechatPngConversionError(
          'wechat-png-rasterization-failed',
          pngFailureDiagnostic(
            index,
            candidate.kind,
            'result-validation',
            { code: 'wechat-png-rasterization-failed' },
            rasterized
          )
        );
      }
      if (
        'responsive-viewport' === mermaidCapture &&
        !responsiveRasterizationResultMatchesRequest(
          rasterized,
          captureDimensions.width,
          captureDimensions.height,
          context.scale
        )
      ) {
        throw new WechatPngConversionError(
          'wechat-png-rasterization-failed',
          pngFailureDiagnostic(
            index,
            candidate.kind,
            'result-validation',
            { code: 'wechat-png-rasterization-failed' },
            rasterized
          )
        );
      }
      totalPixels += rasterized.pixelCount;
      totalBytes += rasterized.file.size;
      if (
        rasterized.file.size > context.maxBytes ||
        totalPixels > MAX_WECHAT_PNG_TOTAL_PIXELS ||
        totalBytes > MAX_WECHAT_PNG_TOTAL_BYTES
      ) {
        throw new WechatPngConversionError('wechat-png-limit-exceeded');
      }
      try {
        assertInlineRasterizationResult(candidate.kind, candidate.element, rasterized);
      } catch (error: unknown) {
        throw new WechatPngConversionError(
          pngConversionErrorCode(error),
          pngFailureDiagnostic(index, candidate.kind, 'inline-validation', error, rasterized)
        );
      }

      const upload = uploadVisual(
        candidate,
        rasterized,
        index,
        sourceRect,
        layoutMagnification,
        intrinsicMermaid,
        mermaidAutoMargins,
        mermaidCapture,
        mermaidMaxWidth
      );
      pendingUploads.add(upload);
      allUploads.push(upload);
      void upload.then(
        () => pendingUploads.delete(upload),
        (error: unknown) => {
          pendingUploads.delete(upload);
          recordUploadFailure(error);
        }
      );
    }

    await Promise.all(allUploads);
    for (const [completedIndex, completed] of completedUploads.entries()) {
      if (!completed) {
        throw new WechatPngConversionError('wechat-png-upload-failed');
      }
      assertPngConversionCurrent(context);
      const image = root.ownerDocument.createElement('img');
      image.setAttribute('src', completed.url);
      image.setAttribute('alt', '');
      image.setAttribute('width', String(Math.round(completed.rasterized.width)));
      image.setAttribute('height', String(Math.round(completed.rasterized.height)));
      appendDeclarations(
        image,
        [
          `width:${Math.round(completed.rasterized.width)}px`,
          `height:${Math.round(completed.rasterized.height)}px`,
          'max-width:none'
        ],
        true
      );
      const sourceStyle = (completed.candidate.element as Element & { style?: CSSStyleDeclaration }).style;
      const sourceDisplay = sourceStyle?.getPropertyValue('display').trim().toLowerCase() ?? '';
      const inlineLayout = completed.rasterized.inlineLayout;
      const inlineVisual = requiresInlineBaseline(completed.candidate.kind, completed.candidate.element);
      const localScrollMermaid =
        'mermaid' === completed.candidate.kind &&
        (completed.intrinsicMermaid === true || (completed.layoutMagnification ?? 1) > 1 + 1e-6);
      const responsiveMermaid =
        'mermaid' === completed.candidate.kind && completed.mermaidCapture === 'responsive-viewport';
      if (responsiveMermaid) {
        const maxWidth = completed.mermaidMaxWidth;
        if (!Number.isFinite(maxWidth) || (maxWidth as number) <= 0) {
          throw new WechatPngConversionError('wechat-png-rasterization-failed');
        }
        appendDeclarations(image, ['display:block', 'width:100%', `max-width:${maxWidth}px`, 'height:auto'], true);
        WECHAT_PNG_GENERATED_IMAGES.add(image);
        centerMermaidGeneratedBlock(image, completed.mermaidAutoMargins);
        runWechatSyncTiming(
          timingPerformance,
          WECHAT_COPY_TIMING_NAMES.replacement,
          timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
          () => completed.candidate.element.replaceChildren(image)
        );
        continue;
      }
      if (localScrollMermaid) {
        const flowDeclarations = [
          'margin-top',
          'margin-right',
          'margin-bottom',
          'margin-left',
          'float',
          'clear'
        ].flatMap((property) => {
          const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
          return value ? [`${property}:${value}`] : [];
        });
        completed.candidate.element.setAttribute(
          'style',
          [
            ...flowDeclarations,
            'display:block!important',
            'width:100%!important',
            'min-width:0!important',
            'max-width:100%!important',
            'overflow-x:auto!important',
            'overflow-y:visible!important',
            'height:auto!important',
            'max-height:none!important',
            'box-sizing:border-box!important'
          ].join(';')
        );
        markWechatOwnedScrollOwner(completed.candidate.element);
        appendDeclarations(image, ['display:block'], true);
        centerMermaidGeneratedBlock(image, completed.mermaidAutoMargins);
        runWechatSyncTiming(
          timingPerformance,
          WECHAT_COPY_TIMING_NAMES.replacement,
          timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
          () => completed.candidate.element.replaceChildren(image)
        );
        continue;
      }
      if (inlineVisual) {
        if (!inlineLayout) {
          throw new WechatPngConversionError('wechat-png-rasterization-failed');
        }
        const wrapperProperties = ['margin-right', 'margin-left', 'float', 'clear'];
        const wrapperDeclarations = wrapperProperties.flatMap((property) => {
          const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
          return value ? [`${property}:${value}`] : [];
        });
        const verticalAlign = inlineVerticalAlignValue(sourceStyle, inlineLayout.baseline - inlineLayout.height);
        const overflowX = inlineOverflowStyleValue(inlineLayout.overflowX, sourceStyle, 'overflow-x');
        const overflowY = inlineOverflowStyleValue(inlineLayout.overflowY, sourceStyle, 'overflow-y');
        const preservesSourceViewport = usesInlineOverflowViewport(overflowX, overflowY);
        const hasLocalViewport = preservesSourceViewport && Boolean(inlineLayout.viewport);
        const wrapperWidth = hasLocalViewport
          ? inlineLayout.width
          : preservesSourceViewport
            ? positiveDimensionOrFallback(completed.sourceRect.width, inlineLayout.width)
            : inlineLayout.width;
        const wrapperHeight = hasLocalViewport
          ? inlineLayout.height
          : preservesSourceViewport
            ? positiveDimensionOrFallback(completed.sourceRect.height, inlineLayout.height)
            : inlineLayout.height;
        wrapperDeclarations.push(
          'display:inline-block!important',
          'position:relative!important',
          `overflow-x:${hasLocalViewport ? 'visible' : overflowX}!important`,
          `overflow-y:${hasLocalViewport ? 'visible' : overflowY}!important`,
          `width:${wrapperWidth}px!important`,
          `height:${wrapperHeight}px!important`,
          'max-width:none!important',
          'max-height:none!important',
          `vertical-align:${verticalAlign}!important`
        );
        const viewport = inlineLayout.viewport;
        const viewportElement = hasLocalViewport && viewport ? root.ownerDocument.createElement('span') : null;
        if (viewportElement && viewport) {
          appendDeclarations(
            viewportElement,
            [
              'display:block',
              'position:absolute',
              `left:${Object.is(viewport.offsetX, -0) ? 0 : viewport.offsetX}px`,
              `top:${Object.is(viewport.offsetY, -0) ? 0 : viewport.offsetY}px`,
              `width:${viewport.width}px`,
              `height:${viewport.height}px`,
              `overflow-x:${overflowX}`,
              `overflow-y:${overflowY}`,
              'max-width:none',
              'max-height:none',
              'box-sizing:border-box'
            ],
            true
          );
        }
        const imageLeft =
          viewportElement && viewport ? inlineLayout.paintOffsetX - viewport.offsetX : inlineLayout.paintOffsetX;
        const imageTop =
          viewportElement && viewport ? inlineLayout.paintOffsetY - viewport.offsetY : inlineLayout.paintOffsetY;
        appendDeclarations(
          image,
          [
            'position:absolute',
            `left:${Object.is(imageLeft, -0) ? 0 : imageLeft}px`,
            `top:${Object.is(imageTop, -0) ? 0 : imageTop}px`,
            `width:${Math.round(completed.rasterized.width)}px`,
            `height:${Math.round(completed.rasterized.height)}px`,
            'max-width:none',
            'display:block'
          ],
          true
        );
        WECHAT_PNG_GENERATED_IMAGES.add(image);
        completed.candidate.element.setAttribute('style', wrapperDeclarations.join(';'));
        if (viewportElement) {
          viewportElement.appendChild(image);
          runWechatSyncTiming(
            timingPerformance,
            WECHAT_COPY_TIMING_NAMES.replacement,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
            () => completed.candidate.element.replaceChildren(viewportElement)
          );
        } else {
          runWechatSyncTiming(
            timingPerformance,
            WECHAT_COPY_TIMING_NAMES.replacement,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
            () => completed.candidate.element.replaceChildren(image)
          );
        }
        continue;
      }
      const preserveOverflowOwner = isVisualOverflowOwner(sourceStyle);
      const outerLayoutProperties = [
        'display',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
        'vertical-align',
        'float',
        'clear'
      ];
      const overflowOwnerProperties = [
        'width',
        'min-width',
        'max-width',
        'height',
        'min-height',
        'max-height',
        'overflow',
        'overflow-x',
        'overflow-y',
        'box-sizing'
      ];
      const preservedProperties = preserveOverflowOwner
        ? [...outerLayoutProperties, ...overflowOwnerProperties]
        : outerLayoutProperties;
      const outerLayoutDeclarations = preservedProperties.flatMap((property) => {
        const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
        return value ? [`${property}:${value}`] : [];
      });
      if (
        !sourceStyle?.getPropertyValue('vertical-align').trim() &&
        ['inline', 'inline-block', 'inline-flex'].includes(sourceDisplay)
      ) {
        outerLayoutDeclarations.push('vertical-align:baseline');
      }
      WECHAT_PNG_GENERATED_IMAGES.add(image);
      if (preserveOverflowOwner) {
        // Keep a lightweight source-root owner around a wide PNG so its
        // overflow remains local to the visual instead of the article.
        if (['block', 'flow-root', 'list-item', 'table', 'flex', 'grid'].includes(sourceDisplay ?? '')) {
          appendDeclarations(image, ['display:block']);
          if ('mermaid' === completed.candidate.kind) {
            centerMermaidGeneratedBlock(image, completed.mermaidAutoMargins);
          }
        }
        completed.candidate.element.setAttribute('style', outerLayoutDeclarations.join(';'));
        runWechatSyncTiming(
          timingPerformance,
          WECHAT_COPY_TIMING_NAMES.replacement,
          timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
          () => completed.candidate.element.replaceChildren(image)
        );
      } else {
        appendDeclarations(image, outerLayoutDeclarations);
        // Keep only external flow spacing and display semantics on the PNG.
        // Padding, borders, backgrounds, and geometry are already baked into it.
        runWechatSyncTiming(
          timingPerformance,
          WECHAT_COPY_TIMING_NAMES.replacement,
          timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
          () => completed.candidate.element.replaceWith(image)
        );
      }
    }
  } catch (error: unknown) {
    uploadController.abort();
    throw error;
  } finally {
    removeConversionAbort();
  }
}

function previewReady(preview: HTMLElement): boolean {
  const refreshing =
    '1' === preview.getAttribute('data-easymde-preview-refreshing') || 'true' === preview.getAttribute('aria-busy');
  const hasWindowSpacer = Boolean(preview.querySelector('[data-easymde-preview-window-spacer]'));
  const acceptedDuringRefresh =
    refreshing && !hasWindowSpacer && '1' === preview.getAttribute('data-easymde-preview-accepted');
  return (
    '' !== preview.innerHTML.trim() &&
    !preview.querySelector('.easymde-preview-empty, .easymde-preview-error, .easymde-render-error') &&
    '1' !== preview.getAttribute('data-easymde-preview-error') &&
    (!refreshing || acceptedDuringRefresh)
  );
}

function registerTaskCheckboxCaptionNormalizations(
  root: HTMLElement,
  normalizations: Map<Text, Readonly<{ original: string; encoded: string }>>
): void {
  root.querySelectorAll('*').forEach((element) => {
    const run = TASK_LIST_CHECKBOX_CAPTION_RUNS.get(element);
    if (!run) return;
    run.bindings.forEach((binding) => {
      if (!binding.prefixLength) return;
      if (!root.contains(binding.cloneText) || binding.layoutText.nodeValue !== binding.original) {
        throw new Error('wechat-task-checkbox-caption-record-missing');
      }
      if (binding.sourceText && binding.sourceText.nodeValue !== binding.original) {
        throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      }
      normalizations.set(binding.cloneText, { encoded: binding.encoded, original: binding.original });
    });
  });
}

function taskCheckboxCaptionResolvedStructure(element: Element): Element {
  let current = element;
  const visited = new Set<Element>();
  while (true) {
    if (visited.has(current)) throw new Error('wechat-task-checkbox-caption-record-missing');
    visited.add(current);
    const replacement = TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.get(current);
    if (!replacement) return current;
    current = replacement;
  }
}

function taskCheckboxCaptionLogicalTextParent(text: Text): Element | null {
  const parent = text.parentElement;
  if (!parent) return null;
  if (!TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS.has(parent)) return parent;
  if ('inline' !== (parent as HTMLElement).style.getPropertyValue('display').trim().toLowerCase()) {
    return null;
  }
  if (1 !== parent.childNodes.length || parent.firstChild !== text) return null;
  return parent.parentElement;
}

function taskCheckboxCaptionRegisteredOwner(run: TaskCheckboxCaptionRun, owner: Element | null): boolean {
  if (!owner) return false;
  const resolvedOwner = taskCheckboxCaptionResolvedStructure(owner);
  if (resolvedOwner === taskCheckboxCaptionResolvedStructure(run.cloneOwner)) return true;
  return run.cloneEvents.some(
    (event) =>
      event.kind === 'enter' && taskCheckboxCaptionResolvedStructure(event.cloneElement) === resolvedOwner
  );
}

function taskCheckboxCaptionGeneratedOwnerBelongs(
  run: TaskCheckboxCaptionRun,
  owner: Element,
  visited = new Set<Element>()
): boolean {
  if (taskCheckboxCaptionRegisteredOwner(run, owner)) return true;
  if (visited.has(owner)) return false;
  visited.add(owner);
  const pseudo = GENERATED_PSEUDO_CLONE_OWNERS.get(owner);
  return Boolean(pseudo && taskCheckboxCaptionGeneratedOwnerBelongs(run, pseudo.owner, visited));
}

function taskCheckboxCaptionGeneratedProjection(node: Node): boolean {
  return node instanceof Element && (THEME_IMAGE_CLONES.has(node) || GENERATED_PSEUDO_CLONE_OWNERS.has(node));
}

function taskCheckboxCaptionPseudoSlotMatches(
  element: Element,
  pseudo: '::before' | '::after',
  owner: Element
): boolean {
  const index = Array.from(owner.childNodes).indexOf(element);
  if (index < 0) return false;
  const significant = (node: Node): boolean => !taskCheckboxCaptionGeneratedProjection(node);
  const before = Array.from(owner.childNodes).slice(0, index).some(significant);
  const after = Array.from(owner.childNodes).slice(index + 1).some(significant);
  return '::before' === pseudo ? !before : !after;
}

function taskCheckboxCaptionThemeImageSlotMatches(element: Element, metadata: WechatThemeImageClone): boolean {
  const parent = element.parentElement;
  if (!parent || taskCheckboxCaptionResolvedStructure(parent) !== taskCheckboxCaptionResolvedStructure(metadata.owner)) {
    return false;
  }
  const images = Array.from(parent.children).filter((child) => THEME_IMAGE_CLONES.has(child));
  const records = images.map((image) => THEME_IMAGE_CLONE_OWNERS.get(image));
  if (records.some((record) => !record || record.owner !== metadata.owner || record.slot !== metadata.slot)) return false;
  const expectedOrder = [...images].sort((left, right) => {
    const leftRecord = THEME_IMAGE_CLONE_OWNERS.get(left);
    const rightRecord = THEME_IMAGE_CLONE_OWNERS.get(right);
    if (!leftRecord || !rightRecord) return 0;
    return 'leading' === metadata.slot
      ? rightRecord.layerIndex - leftRecord.layerIndex
      : leftRecord.layerIndex - rightRecord.layerIndex;
  });
  if (expectedOrder.some((image, index) => image !== images[index])) return false;
  const imageIndex = Array.from(parent.childNodes).indexOf(element);
  if (imageIndex < 0) return false;
  const significant = (node: Node): boolean => !THEME_IMAGE_CLONES.has(node as Element);
  return 'leading' === metadata.slot
    ? !Array.from(parent.childNodes).slice(0, imageIndex).some(significant)
    : !Array.from(parent.childNodes).slice(imageIndex + 1).some(significant);
}

function taskCheckboxCaptionRegisteredGenerated(
  run: TaskCheckboxCaptionRun,
  element: Element
): boolean {
  const pseudo = GENERATED_PSEUDO_CLONE_OWNERS.get(element);
  if (pseudo) {
    const parent = element.parentElement;
    if (
      !parent ||
      taskCheckboxCaptionResolvedStructure(parent) !== taskCheckboxCaptionResolvedStructure(pseudo.owner) ||
      !taskCheckboxCaptionGeneratedOwnerBelongs(run, pseudo.owner) ||
      !taskCheckboxCaptionPseudoSlotMatches(element, pseudo.pseudo, parent)
    ) {
      return false;
    }
    return Array.from(element.querySelectorAll('*')).every((child) => {
      if (THEME_IMAGE_CLONES.has(child)) return taskCheckboxCaptionRegisteredGenerated(run, child);
      const childPseudo = GENERATED_PSEUDO_CLONE_OWNERS.get(child);
      return !childPseudo || taskCheckboxCaptionRegisteredGenerated(run, child);
    });
  }
  const metadata = THEME_IMAGE_CLONE_OWNERS.get(element);
  if (!metadata || !THEME_IMAGE_CLONES.has(element)) return false;
  return (
    taskCheckboxCaptionGeneratedOwnerBelongs(run, metadata.owner) &&
    taskCheckboxCaptionThemeImageSlotMatches(element, metadata)
  );
}

type TaskCheckboxCaptionObservedEvent =
  | TaskCheckboxCaptionRunEvent
  | Readonly<{ kind: 'unknown' }>;
type TaskCheckboxCaptionTextPhase = 'encoded' | 'original';

function taskCheckboxCaptionObservedEvents(run: TaskCheckboxCaptionRun): TaskCheckboxCaptionObservedEvent[] {
  const parent = taskCheckboxCaptionResolvedStructure(run.cloneCaptionParent);
  if (run.cloneOwner.parentElement !== parent) return [{ kind: 'unknown' }];
  const ownerIndex = Array.from(parent.childNodes).indexOf(run.cloneOwner);
  if (ownerIndex < 0) return [{ kind: 'unknown' }];
  const events: TaskCheckboxCaptionObservedEvent[] = [];
  let glyphReached = false;
  const visit = (node: Node): void => {
    if (glyphReached) return;
    if (node.nodeType === 3) {
      const reference = TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.get(node as Text);
      if (!reference || reference.run !== run) {
        events.push({ kind: 'unknown' });
        return;
      }
      events.push({ binding: reference.binding, kind: 'text', path: [] });
      if (reference.binding.glyph) glyphReached = true;
      return;
    }
    if (!(node instanceof Element)) return;
    if (taskCheckboxCaptionGeneratedProjection(node)) {
      if (taskCheckboxCaptionRegisteredGenerated(run, node)) return;
      events.push({ kind: 'unknown' });
      return;
    }
    if (TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS.has(node)) {
      if (
        'inline' !== (node as HTMLElement).style.getPropertyValue('display').trim().toLowerCase() ||
        1 !== node.childNodes.length
      ) {
        events.push({ kind: 'unknown' });
        return;
      }
      visit(node.firstChild as Node);
      return;
    }
    events.push({ cloneElement: node, kind: 'enter', path: [] });
    Array.from(node.childNodes).forEach(visit);
    events.push({ cloneElement: node, kind: 'exit', path: [] });
  };
  Array.from(parent.childNodes)
    .slice(ownerIndex + 1)
    .forEach(visit);
  return events;
}

function taskCheckboxCaptionAncestryMatches(
  run: TaskCheckboxCaptionRun,
  binding: TaskCheckboxCaptionTextBinding,
  root: HTMLElement
): boolean {
  const logicalParent = taskCheckboxCaptionLogicalTextParent(binding.cloneText);
  const captionParent = taskCheckboxCaptionResolvedStructure(run.cloneCaptionParent);
  if (!logicalParent || taskCheckboxCaptionResolvedStructure(binding.cloneParent) !== logicalParent) return false;
  const actualChain = taskCheckboxCaptionElementChain(logicalParent, captionParent);
  if (!actualChain || actualChain.length !== binding.cloneAncestors.length) return false;
  if (
    actualChain.some(
      (element, index) => element !== taskCheckboxCaptionResolvedStructure(binding.cloneAncestors[index] as Element)
    )
  ) {
    return false;
  }
  return actualChain.every((element) => root.contains(element));
}

function assertTaskCheckboxCaptionRun(
  root: HTMLElement,
  run: TaskCheckboxCaptionRun,
  normalizations: Map<Text, Readonly<{ original: string; encoded: string }>>,
  phase: TaskCheckboxCaptionTextPhase
): void {
  const captionParent = taskCheckboxCaptionResolvedStructure(run.cloneCaptionParent);
  const taskItem = taskCheckboxCaptionResolvedStructure(run.cloneTaskItem);
  if (
    !root.contains(run.cloneOwner) ||
    !root.contains(captionParent) ||
    !root.contains(taskItem) ||
    run.cloneOwner.parentElement !== captionParent ||
    !taskItem.contains(run.cloneOwner) ||
    !taskItem.contains(captionParent)
  ) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
  const firstBinding = run.bindings[0];
  if (!firstBinding || !root.contains(firstBinding.cloneText)) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
  if (
    !(run.cloneOwner.compareDocumentPosition(firstBinding.cloneText) & Node.DOCUMENT_POSITION_FOLLOWING)
  ) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
  run.bindings.forEach((binding) => {
    if (!root.contains(binding.cloneText)) {
      throw new Error('wechat-task-checkbox-caption-record-missing');
    }
    if (binding.layoutText.nodeValue !== binding.original) {
      throw new Error('wechat-task-checkbox-caption-record-missing');
    }
    if (binding.sourceText && binding.sourceText.nodeValue !== binding.original) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
    if (!taskCheckboxCaptionAncestryMatches(run, binding, root)) {
      throw new Error('wechat-task-checkbox-caption-record-missing');
    }
    const expectedText = 'original' === phase ? binding.original : binding.encoded;
    if (binding.cloneText.nodeValue !== expectedText) {
      throw new Error(
        'encoded' === phase && binding.prefixLength
          ? 'wechat-task-checkbox-caption-prefix-reinserted'
          : 'original' === phase
            ? 'wechat-task-checkbox-caption-plain-text-restore-failed'
          : 'wechat-task-checkbox-caption-record-missing'
      );
    }
    if (binding.prefixLength) {
      const normalization = normalizations.get(binding.cloneText);
      if (
        !normalization ||
        normalization.original !== binding.original ||
        normalization.encoded !== binding.encoded
      ) {
        throw new Error('wechat-task-checkbox-caption-record-missing');
      }
    }
  });
  const expectedEvents = run.cloneEvents;
  const actualEvents = taskCheckboxCaptionObservedEvents(run);
  if (
    expectedEvents.length !== actualEvents.length ||
    expectedEvents.some((expected, index) => {
      const actual = actualEvents[index];
      if (!actual || actual.kind !== expected.kind) return true;
      if (expected.kind === 'text') {
        return actual.kind !== 'text' || actual.binding !== expected.binding;
      }
      return (
        actual.kind !== expected.kind ||
        taskCheckboxCaptionResolvedStructure(actual.cloneElement) !==
          taskCheckboxCaptionResolvedStructure(expected.cloneElement)
      );
    })
  ) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
}

function assertTaskCheckboxCaptionOwnerSequence(root: HTMLElement): void {
  const expectedOwners = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root);
  if (!expectedOwners) return;
  const actualOwners = Array.from(root.querySelectorAll('*')).filter((element) =>
    TASK_LIST_CHECKBOX_CLONES.has(element)
  );
  if (actualOwners.length !== expectedOwners.length) {
    throw new Error('wechat-task-checkbox-static-owner-count-mismatch');
  }
  if (expectedOwners.some((expected, index) => actualOwners[index] !== expected.cloneOwner)) {
    throw new Error('wechat-task-checkbox-caption-owner-order-mismatch');
  }
}

function assertTaskCheckboxCaptionRuns(
  root: HTMLElement,
  normalizations: Map<Text, Readonly<{ original: string; encoded: string }>>,
  phase: TaskCheckboxCaptionTextPhase = 'encoded'
): void {
  assertTaskCheckboxCaptionOwnerSequence(root);
  root.querySelectorAll('*').forEach((element) => {
    const run = TASK_LIST_CHECKBOX_CAPTION_RUNS.get(element);
    if (run) assertTaskCheckboxCaptionRun(root, run, normalizations, phase);
  });
}

function finalizeMarkup(clone: HTMLElement, fragmentIds: Set<string>, mathMlNodes: Set<Element>): HTMLElement {
  mathMlNodes.forEach((element) => {
    element.remove();
  });
  wrapKaTeXVisualRoots(clone);
  const themeHeadingSuffixClones: Element[] = [];
  const generatedEmptyHeadingSuffixClones: Element[] = [];
  clone.querySelectorAll('*').forEach((element) => {
    if (HIDDEN_NODES.has(element)) {
      element.remove();
      return;
    }
    if (THEME_HEADING_SUFFIX_CLONES.has(element)) themeHeadingSuffixClones.push(element);
    if (GENERATED_EMPTY_HEADING_SUFFIX_CLONES.has(element)) {
      generatedEmptyHeadingSuffixClones.push(element);
    }
  });
  clone
    .querySelectorAll('script, style, button, textarea, select, option, form, iframe, object, embed')
    .forEach((node) => {
      node.remove();
    });
  clone.querySelectorAll('input').forEach((input) => {
    if (!TASK_LIST_CHECKBOX_CLONES.has(input)) {
      input.remove();
      return;
    }
    input.removeAttribute('id');
    input.removeAttribute('name');
    input.removeAttribute('value');
    input.setAttribute('disabled', '');
  });
  restoreTaskListCheckboxOwnerState(clone);
  normalizeMathBlocks(clone);
  const normalized = normalizeStructure(clone);
  retainReferencedFragmentIds(normalized, fragmentIds);
  appendDeclarations(normalized, ['max-width:100%', 'margin:0 auto']);
  normalized.querySelectorAll('img, video').forEach((element) => {
    if (THEME_IMAGE_CLONES.has(element) || WECHAT_PNG_GENERATED_IMAGES.has(element)) return;
    // Keep the preview's computed display and margins so inline media remains
    // inline after paste. Only the responsive bounds are exporter-owned.
    appendDeclarations(element, ['max-width:100%', 'height:auto']);
  });
  normalized.querySelectorAll('svg').forEach((element) => {
    // KaTeX stretchy symbols use absolutely positioned SVGs whose intrinsic
    // height is part of the visual layout. A generic `height:auto` media rule
    // collapses those SVGs after paste, while non-math SVG illustrations still
    // need the portable responsive rule.
    if (MERMAID_SVG_ROOTS.has(element)) {
      // Mermaid HTML labels are rendered in fixed-size foreignObject boxes.
      // WeChat's fallback font can be wider than the preview font, so preserve
      // the label's overflow instead of clipping its final glyphs.
      appendDeclarations(element, ['overflow:visible', 'overflow-x:visible', 'overflow-y:visible'], true);
    }
    if (isKaTeXVisualClone(element)) return;
    appendDeclarations(element, ['max-width:100%', 'height:auto']);
  });
  normalized.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    appendDeclarations(
      element,
      [...MERMAID_LABEL_LAYOUT_DECLARATIONS, 'overflow:visible', 'overflow-x:visible', 'overflow-y:visible'],
      true
    );
  });
  wrapMermaidLabelContents(normalized);
  expandMermaidLabelGeometry(normalized);
  preserveMermaidLabelWhitespace(normalized);
  let exportTextNormalizations =
    EXPORT_TEXT_NORMALIZATIONS.get(normalized) ?? new Map<Text, Readonly<{ original: string; encoded: string }>>();
  registerTaskCheckboxCaptionNormalizations(normalized, exportTextNormalizations);
  EXPORT_TEXT_NORMALIZATIONS.set(normalized, exportTextNormalizations);
  const taskPaintNormalizations = new Map<Text, Readonly<{ original: string; encoded: string }>>();
  normalized.querySelectorAll('span[aria-hidden="true"]').forEach((element) => {
    if (!TASK_LIST_CHECKBOX_PSEUDO_CLONES.has(element)) return;
    const textNodes = Array.from(element.childNodes).filter((node): node is Text => node.nodeType === 3);
    if (1 !== textNodes.length || ' ' !== textNodes[0]?.nodeValue) return;
    const textNode = textNodes[0];
    textNode.nodeValue = '\u2060';
    taskPaintNormalizations.set(textNode, { original: '', encoded: '\u2060' });
  });
  taskPaintNormalizations.forEach((value, textNode) => {
    exportTextNormalizations.set(textNode, value);
  });
  normalized.querySelectorAll('table').forEach((element) => {
    // The destination editor owns the scroll container. Keep the theme's table
    // display mode and intrinsic sizing, then wrap it in a real block scroll
    // owner because overflow on display:table is ignored by browsers.
    const preservesBlockScroll = 'block' === element.style.display;
    const preservesFullWidth = FULL_WIDTH_TABLE_CLONES.has(element);
    appendDeclarations(
      element,
      preservesFullWidth
        ? [
            preservesBlockScroll ? 'display:block' : 'display:table',
            'width:100%',
            'max-width:100%',
            'margin-left:0',
            'margin-right:0',
            ...(preservesBlockScroll ? [] : ['table-layout:auto', 'border-collapse:collapse']),
            'overflow:visible',
            'overflow-x:visible',
            'overflow-y:visible',
            'box-sizing:border-box'
          ]
        : preservesBlockScroll
          ? [
              'display:block',
              'min-width:0',
              'width:max-content',
              'max-width:none',
              'margin-left:auto',
              'margin-right:auto',
              'overflow:visible',
              'overflow-x:visible',
              'overflow-y:visible',
              'box-sizing:border-box'
            ]
          : [
              'display:table',
              'width:max-content',
              'max-width:none',
              'min-width:0',
              'margin-left:auto',
              'margin-right:auto',
              'table-layout:auto',
              'border-collapse:collapse',
              'overflow:visible',
              'overflow-x:visible',
              'overflow-y:visible',
              'box-sizing:border-box'
            ],
      true
    );
    const metadata = TABLE_SCROLL_OWNER_METADATA.get(element);
    if (metadata) appendDeclarations(element, tableScrollOwnerDeclarations(metadata), true);
  });
  wrapTableScrollOwners(normalized);
  normalizeCodeFrames(normalized);
  materializeCodeLineBreaks(normalized);
  wrapCodeLines(normalized);
  preserveCodeLineWhitespace(normalized);
  wrapTextLeaves(normalized);
  normalizeCodeWhitespace(normalized);
  wrapCodeRows(normalized);
  themeHeadingSuffixClones.forEach((element) => {
    if (!normalized.contains(element) || element.childNodes.length !== 0) return;
    const textNode = normalized.ownerDocument.createTextNode('\u2060');
    element.appendChild(textNode);
    exportTextNormalizations ??= new Map();
    exportTextNormalizations.set(textNode, { original: '', encoded: '\u2060' });
  });
  generatedEmptyHeadingSuffixClones.forEach((element) => {
    if (!normalized.contains(element)) return;
    const textNodes = Array.from(element.childNodes).filter((node): node is Text => node.nodeType === 3);
    if (1 !== textNodes.length || ' ' !== textNodes[0]?.nodeValue) return;
    const textNode = textNodes[0];
    textNode.nodeValue = '\u2060';
    exportTextNormalizations ??= new Map();
    exportTextNormalizations.set(textNode, {
      original: HEADING_EMPTY_PSEUDO_FLOW_CLONES.has(element) ? '' : ' ',
      encoded: '\u2060'
    });
  });
  if (exportTextNormalizations) EXPORT_TEXT_NORMALIZATIONS.set(normalized, exportTextNormalizations);
  assertTaskCheckboxCaptionRuns(normalized, exportTextNormalizations);
  return normalized;
}

function restoreTaskListCheckboxOwnerState(root: HTMLElement): void {
  root.querySelectorAll('*').forEach((element) => {
    if (!TASK_LIST_CHECKBOX_CLONES.has(element)) return;
    const state = TASK_LIST_CHECKBOX_STATES.get(element);
    if (!state) throw new Error('wechat-task-checkbox-state-missing');
    element.setAttribute('role', 'checkbox');
    element.setAttribute('aria-checked', state.checked ? 'true' : 'false');
    element.setAttribute('aria-disabled', 'true');
  });
}

function assertTaskCheckboxStaticOwnerBase(source: Element, clone: Element): void {
  if (!isTaskListCheckbox(source)) return;
  if ('INPUT' === clone.tagName || !TASK_LIST_CHECKBOX_CLONES.has(clone)) {
    throw new Error('wechat-task-checkbox-static-owner-missing');
  }
  if (!clone.getAttribute('style')?.trim()) {
    throw new Error('wechat-task-checkbox-static-owner-paint-unavailable');
  }
  const expectation = TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.get(clone);
  if (!expectation) throw new Error('wechat-task-checkbox-static-owner-paint-unavailable');
  if (expectation.baseProperties.some((property) => !taskCheckboxOutputPropertyIsVisible(clone, property))) {
    throw new Error('wechat-task-checkbox-static-owner-paint-mismatch');
  }
}

function assertTaskCheckboxStaticOwners(sourceInputs: readonly HTMLInputElement[], root: HTMLElement): void {
  if (!sourceInputs.length) return;
  const owners = Array.from(root.querySelectorAll('[role="checkbox"][aria-disabled="true"]')).filter((element) =>
    TASK_LIST_CHECKBOX_CLONES.has(element)
  );
  if (owners.length !== sourceInputs.length) {
    throw new Error('wechat-task-checkbox-static-owner-count-mismatch');
  }
  owners.forEach((owner, index) => {
    const source = sourceInputs[index];
    if (!source || 'SPAN' !== owner.tagName) {
      throw new Error('wechat-task-checkbox-static-owner-missing');
    }
    assertTaskCheckboxStaticOwnerBase(source, owner);
    if (owner.getAttribute('aria-checked') !== (source.checked ? 'true' : 'false')) {
      throw new Error('wechat-task-checkbox-static-owner-state-mismatch');
    }
    if (owner.querySelector('input')) {
      throw new Error('wechat-task-checkbox-static-owner-input-retained');
    }
    if (!owner.getAttribute('style')?.trim()) {
      throw new Error('wechat-task-checkbox-static-owner-paint-unavailable');
    }
    const expectation = TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.get(owner);
    if (!expectation) throw new Error('wechat-task-checkbox-static-owner-paint-unavailable');
    (['::before', '::after'] as const).forEach((pseudo) => {
      const expected = expectation.pseudos.get(pseudo);
      const markers = taskCheckboxOutputMarkers(owner, pseudo);
      if (!expected) {
        if (markers.length) throw new Error('wechat-task-checkbox-static-owner-pseudo-mismatch');
        return;
      }
      if (1 !== markers.length) {
        throw new Error('wechat-task-checkbox-static-owner-pseudo-missing');
      }
      const marker = markers[0];
      if (!marker) throw new Error('wechat-task-checkbox-static-owner-pseudo-missing');
      if (expected.properties.some((property) => !taskCheckboxOutputPropertyIsVisible(marker, property))) {
        throw new Error('wechat-task-checkbox-static-owner-pseudo-paint-mismatch');
      }
      if (expected.kind === 'svg') {
        const svg = marker.querySelector('svg');
        if (!expected.svgPaintSignature || !svg || taskCheckboxSvgPaintSignature(svg) !== expected.svgPaintSignature) {
          throw new Error('wechat-task-checkbox-static-owner-svg-paint-missing');
        }
      } else if (expected.requiresText && !marker.textContent?.trim()) {
        throw new Error('wechat-task-checkbox-static-owner-pseudo-paint-missing');
      }
    });
  });
}

function headingEmptyPseudoFlowNumberMatches(element: Element, property: string, expected: number): boolean {
  const value = finiteCssPixelValue(
    (element as Element & { style?: CSSStyleDeclaration }).style?.getPropertyValue(property) ?? ''
  );
  return null !== value && Math.abs(value - expected) <= HEADING_EMPTY_PSEUDO_FLOW_EPSILON;
}

function assertHeadingEmptyPseudoFlows(
  expectations: readonly HeadingEmptyPseudoFlowExpectation[],
  outputRoot: HTMLElement,
): void {
  expectations.forEach((expectation) => {
    const registered = HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.get(expectation.marker);
    if (
      registered !== expectation ||
      !outputRoot.contains(expectation.cloneHeading) ||
      expectation.marker.parentElement !== expectation.cloneHeading
    ) {
      throw new Error('wechat-heading-pseudo-flow-carrier-missing');
    }
    const { cloneHeading, flow, marker } = expectation;
    if ('\u2060' !== marker.textContent) {
      throw new Error('wechat-heading-pseudo-flow-carrier-missing');
    }
    const outputStyle = (marker as HTMLElement).style;
    if (!headingEmptyPseudoFlowNumberMatches(cloneHeading, 'padding-left', flow.paddingLeft)) {
      throw new Error('wechat-heading-pseudo-flow-geometry-mismatch');
    }
    if (
      'block' !== outputStyle.getPropertyValue('display').trim().toLowerCase() ||
      'static' !== outputStyle.getPropertyValue('position').trim().toLowerCase() ||
      'left' !== outputStyle.getPropertyValue('float').trim().toLowerCase() ||
      'none' !== outputStyle.getPropertyValue('transform').trim().toLowerCase() ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'width', flow.width) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'height', flow.height) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'margin-left', flow.marginLeft) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'margin-right', flow.marginRight) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'margin-top', flow.marginTop) ||
      flow.borderRadius.toLowerCase() !== outputStyle.getPropertyValue('border-radius').trim().toLowerCase()
    ) {
      throw new Error('wechat-heading-pseudo-flow-geometry-mismatch');
    }
    const backgroundColor = outputStyle.getPropertyValue('background-color').trim().toLowerCase();
    const opacity = Number.parseFloat(outputStyle.getPropertyValue('opacity').trim());
    if (
      backgroundColor !== flow.backgroundColor.trim().toLowerCase() ||
      !Number.isFinite(opacity) ||
      opacity !== flow.opacity
    ) {
      throw new Error('wechat-heading-pseudo-flow-paint-mismatch');
    }
  });
}

async function createMarkup(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal,
  sourceRoot: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  taskGeometryLease: TaskCheckboxGeometryLease | null = null
): Promise<HTMLElement> {
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) assertPngConversionCurrent(conversion);
  const clone = preview.cloneNode(true) as HTMLElement;
  const sourceTaskInputs = replaceTaskListCheckboxClones(sourceRoot, preview, clone, runtime);
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  if (taskCheckboxGeometryScopes(sourceRoot, runtime).length && !taskGeometryLease) {
    throw new Error('wechat-task-checkbox-geometry-lease-missing');
  }
  const taskGeometry = createTaskCheckboxGeometryContext(taskGeometryLease, runtime, dimensionSemantics);
  const headingFlowCollector: HeadingEmptyPseudoFlowCollector = { expectations: [] };
  try {
    await inlineStyles(
      preview,
      clone,
      runtime.getComputedStyle,
      true,
      runtime,
      cache,
      preview,
      sourceRoot,
      dimensionSemantics,
      yieldToBrowser,
      conversion,
      signal,
      taskGeometry,
      headingFlowCollector
    );
    throwIfBackgroundPreparationAborted(signal);
    if (conversion) {
      mathMlNodes.forEach((element) => {
        element.remove();
      });
      assertPngConversionCurrent(conversion);
      await replaceVisualObjects(clone, conversion, runtime, cache, yieldToBrowser);
      assertPngConversionCurrent(conversion);
    }
    throwIfBackgroundPreparationAborted(signal);
    const finalized = runWechatSyncTiming(
      clone.ownerDocument.defaultView?.performance,
      WECHAT_COPY_TIMING_NAMES.finalizeMarkup,
      { mode: 'sync' },
      () => finalizeMarkup(clone, fragmentIds, mathMlNodes)
    );
    assertTaskCheckboxStaticOwners(sourceTaskInputs, finalized);
    assertHeadingEmptyPseudoFlows(headingFlowCollector.expectations, finalized);
    throwIfBackgroundPreparationAborted(signal);
    return finalized;
  } finally {
    taskGeometry?.cleanup();
  }
}

function createMarkupSynchronously(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  sourceRoot: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  taskGeometryLease: TaskCheckboxGeometryLease | null = null
): HTMLElement | null {
  const clone = preview.cloneNode(true) as HTMLElement;
  const sourceTaskInputs = replaceTaskListCheckboxClones(sourceRoot, preview, clone, runtime);
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  if (taskCheckboxGeometryScopes(sourceRoot, runtime).length && !taskGeometryLease) {
    throw new Error('wechat-task-checkbox-geometry-lease-missing');
  }
  const taskGeometry = createTaskCheckboxGeometryContext(taskGeometryLease, runtime, dimensionSemantics);
  const headingFlowCollector: HeadingEmptyPseudoFlowCollector = { expectations: [] };
  try {
    if (
      !inlineStylesSynchronously(
        preview,
        clone,
        runtime.getComputedStyle,
        true,
        runtime,
        preview,
        sourceRoot,
        dimensionSemantics,
        taskGeometry,
        headingFlowCollector
      )
    )
      return null;
    const finalized = runWechatSyncTiming(
      clone.ownerDocument.defaultView?.performance,
      WECHAT_COPY_TIMING_NAMES.finalizeMarkup,
      { mode: 'sync' },
      () => finalizeMarkup(clone, fragmentIds, mathMlNodes)
    );
    assertTaskCheckboxStaticOwners(sourceTaskInputs, finalized);
    assertHeadingEmptyPseudoFlows(headingFlowCollector.expectations, finalized);
    return finalized;
  } finally {
    taskGeometry?.cleanup();
  }
}

function normalizedPlainText(value: string): string {
  return value.replaceAll('\u2060', '').replaceAll('\u00a0', ' ');
}

function previewMeasurementWidth(source: HTMLElement): number | null {
  const rectWidth = source.getBoundingClientRect?.()?.width ?? 0;
  const visibleWidth = rectWidth || source.clientWidth || source.offsetWidth;
  if (visibleWidth > 0) {
    PREVIEW_MEASUREMENT_WIDTHS.set(source, visibleWidth);
    return visibleWidth;
  }

  // Immersive source mode hides the Preview pane with `display:none`, so its
  // live geometry is zero even though the user can still invoke Copy. Reuse
  // the last visible Preview width to keep plain-text soft wrapping stable
  // across the mode transition instead of letting an auto-sized host flatten
  // all line boundaries.
  const lastVisibleWidth = PREVIEW_MEASUREMENT_WIDTHS.get(source);
  if (lastVisibleWidth && lastVisibleWidth > 0) return lastVisibleWidth;

  const viewport = source.ownerDocument.defaultView;
  const documentWidth = source.ownerDocument.documentElement.clientWidth;
  const viewportWidth = viewport?.innerWidth ?? 0;
  const fallbackWidth = documentWidth || viewportWidth;
  return fallbackWidth > 0 ? fallbackWidth : null;
}

function rememberPreviewWidthValue(source: HTMLElement): void {
  const width = source.getBoundingClientRect?.()?.width ?? 0;
  if (Number.isFinite(width) && width > 0) {
    PREVIEW_MEASUREMENT_WIDTHS.set(source, width);
  }
}

const PREVIEW_MEASUREMENT_INHERITED_PROPERTIES = [
  'color',
  'direction',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'list-style-position',
  'list-style-type',
  'text-align',
  'text-indent',
  'text-shadow',
  'text-transform',
  'tab-size',
  'white-space',
  'word-break',
  'word-spacing',
  'overflow-wrap'
] as const;

function cssPixelValue(value: string): number {
  const match = /^(\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteCssPixelValue(value: string): number | null {
  const match = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/i.exec(value.trim());
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function previewWorkspaceMeasurementWidth(preview: HTMLElement, runtime: BrowserWechatClipboardRuntime): number | null {
  const remembered = PREVIEW_MEASUREMENT_WIDTHS.get(preview);
  if (remembered && remembered > 0) return remembered;

  let current: Element | null = preview.parentElement;
  while (current) {
    const computed = runtime.getComputedStyle(current);
    const rectWidth = current.getBoundingClientRect?.()?.width ?? 0;
    if (Number.isFinite(rectWidth) && rectWidth > 0) {
      const horizontalEdges = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].reduce(
        (total, property) => total + cssPixelValue(computed.getPropertyValue(property)),
        0
      );
      const contentWidth = rectWidth - horizontalEdges;
      return contentWidth > 0 ? contentWidth : rectWidth;
    }
    current = current.parentElement;
  }
  return null;
}

function isPreviewHidden(preview: HTMLElement, runtime: BrowserWechatClipboardRuntime): boolean {
  let current: Element | null = preview;
  while (current) {
    const computed = runtime.getComputedStyle(current);
    if (
      ['none', 'hidden'].includes(computed.getPropertyValue('display').trim().toLowerCase()) ||
      'hidden' === computed.getPropertyValue('visibility').trim().toLowerCase() ||
      'hidden' === computed.getPropertyValue('content-visibility').trim().toLowerCase()
    )
      return true;
    current = current.parentElement;
  }
  return false;
}

function previewMeasurementAbortError(): Error {
  const error = new Error('wechat-preview-measurement-cancelled');
  error.name = 'AbortError';
  return error;
}

function previewMeasurementResourceError(kind: 'failed' | 'timeout'): Error {
  return new Error(`wechat-preview-measurement-resource-${kind}`);
}

function previewTransitionStaleError(): Error {
  return new Error('wechat-preview-transition-stale');
}

function previewTransitionCancelledError(): Error {
  return new Error('wechat-preview-transition-cancelled');
}

function activePreviewTransitions(roots: readonly Element[]): Animation[] {
  const seen = new Set<Animation>();
  const transitions: Animation[] = [];
  roots.forEach((root) => {
    const getAnimations = root.getAnimations?.bind(root);
    if ('function' !== typeof getAnimations) return;
    let animations: Animation[];
    try {
      animations = getAnimations({ subtree: true });
    } catch (error: unknown) {
      throw new Error('wechat-preview-transition-unavailable', { cause: error });
    }
    animations.forEach((animation) => {
      if (seen.has(animation)) return;
      seen.add(animation);
      const transition = animation as Animation & {
        animationName?: unknown;
        pending?: unknown;
        transitionProperty?: unknown;
      };
      const timing = animation.effect?.getComputedTiming?.();
      const hasCssTransition = 'string' === typeof transition.transitionProperty;
      const hasCssAnimation =
        'string' === typeof transition.animationName && 'none' !== transition.animationName.trim().toLowerCase();
      if (
        (!hasCssTransition && !hasCssAnimation) ||
        (true !== transition.pending && !['paused', 'running'].includes(animation.playState)) ||
        !timing ||
        !Number.isFinite(timing.endTime)
      )
        return;
      transitions.push(animation);
    });
  });
  return transitions;
}

function waitForPreviewTransitions(roots: readonly Element[], signal: AbortSignal, deadline: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => finish(previewMeasurementAbortError());
    const wait = (): void => {
      if (settled) return;
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (Date.now() >= deadline) {
        finish(previewMeasurementResourceError('timeout'));
        return;
      }
      let transitions: Animation[];
      try {
        transitions = activePreviewTransitions(roots);
      } catch (error: unknown) {
        finish(error);
        return;
      }
      if (!transitions.length) {
        finish();
        return;
      }
      Promise.all(
        transitions.map((animation) =>
          Promise.resolve(animation.finished).catch((error: unknown) => {
            if (signal.aborted) throw previewMeasurementAbortError();
            if (error instanceof Error && 'AbortError' === error.name) {
              throw previewTransitionCancelledError();
            }
            if (error && 'object' === typeof error && 'AbortError' === (error as { name?: unknown }).name) {
              throw previewTransitionCancelledError();
            }
            throw new Error('wechat-preview-transition-failed', { cause: error });
          })
        )
      ).then(wait, finish);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    wait();
  });
}

function createPreviewTransitionLease(roots: readonly Element[], signal?: AbortSignal): WechatPreviewTransitionLease {
  const controller = new AbortController();
  const deadline = Date.now() + THEME_IMAGE_FETCH_TIMEOUT_MS;
  let cleaned = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let initialReady = false;
  let initialError: unknown = null;
  let removeExternalAbort = (): void => undefined;
  const finishCleanup = (): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    removeExternalAbort();
    removeExternalAbort = () => undefined;
  };
  if (signal) {
    if (signal.aborted) controller.abort();
    else {
      const onExternalAbort = (): void => controller.abort();
      signal.addEventListener('abort', onExternalAbort, { once: true });
      removeExternalAbort = () => signal.removeEventListener('abort', onExternalAbort);
    }
  }
  const armTimeout = (): void => {
    if (timeout !== null) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      controller.abort();
      return;
    }
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remaining);
  };
  const wait = (): Promise<void> => {
    if (cleaned) return Promise.reject(previewMeasurementAbortError());
    if (initialError) return Promise.reject(initialError);
    if (initialReady) {
      try {
        if (activePreviewTransitions(roots).length) {
          return Promise.reject(previewTransitionStaleError());
        }
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    if (controller.signal.aborted) {
      return Promise.reject(timedOut ? previewMeasurementResourceError('timeout') : previewMeasurementAbortError());
    }
    let transitions: Animation[];
    try {
      transitions = activePreviewTransitions(roots);
    } catch (error: unknown) {
      initialError = error;
      return Promise.reject(error);
    }
    if (!transitions.length) return Promise.resolve();
    armTimeout();
    if (timedOut) return Promise.reject(previewMeasurementResourceError('timeout'));
    return waitForPreviewTransitions(roots, controller.signal, deadline).catch((error: unknown) => {
      if (timedOut) throw previewMeasurementResourceError('timeout');
      throw error;
    });
  };
  const ready = wait().then(
    () => {
      initialReady = true;
      finishCleanup();
    },
    (error: unknown) => {
      initialError ??= error;
      throw error;
    }
  );
  void ready.catch(() => undefined);
  return {
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      finishCleanup();
      controller.abort();
    },
    isReady: () => !cleaned && !initialError && !controller.signal.aborted && !activePreviewTransitions(roots).length,
    ready,
    wait
  };
}

function pairMeasurementElements(
  sourceRoot: HTMLElement,
  measurementRoot: HTMLElement
): WechatMeasurementElementPairing {
  const bySource = new WeakMap<Element, Element>();
  const byMeasurement = new WeakMap<Element, Element>();
  const imagePairs: WechatMeasurementImagePair[] = [];
  const pair = (source: Element, measurement: Element): void => {
    if (source.localName !== measurement.localName || source.namespaceURI !== measurement.namespaceURI) {
      throw new Error('wechat-preview-measurement-element-pair-mismatch');
    }
    bySource.set(source, measurement);
    byMeasurement.set(measurement, source);
    if (source instanceof HTMLImageElement && measurement instanceof HTMLImageElement) {
      imagePairs.push({ measurement, source });
    }
    const sourceChildren = Array.from(source.children);
    const measurementChildren = Array.from(measurement.children);
    if (sourceChildren.length !== measurementChildren.length) {
      throw new Error('wechat-preview-measurement-element-pair-mismatch');
    }
    sourceChildren.forEach((sourceChild, index) => {
      const measurementChild = measurementChildren[index];
      if (!measurementChild) throw new Error('wechat-preview-measurement-element-pair-mismatch');
      pair(sourceChild, measurementChild);
    });
  };
  pair(sourceRoot, measurementRoot);
  return { byMeasurement, bySource, imagePairs };
}

function waitForMeasuredImage(pair: WechatMeasurementImagePair, signal: AbortSignal): Promise<void> {
  const waitForImage = (image: HTMLImageElement): Promise<void> => {
    const hasSource = Boolean(image.getAttribute('src') || image.getAttribute('srcset'));
    if (!hasSource) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => finish(previewMeasurementAbortError());
      const onLoad = (): void => {
        if (image.naturalWidth < 1) {
          finish(previewMeasurementResourceError('failed'));
          return;
        }
        if ('function' !== typeof image.decode) {
          finish();
          return;
        }
        void image.decode().then(
          () => finish(),
          () => finish(previewMeasurementResourceError('failed'))
        );
      };
      const onError = (): void => finish(previewMeasurementResourceError('failed'));
      image.addEventListener('load', onLoad);
      image.addEventListener('error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (image.complete) {
        if (image.naturalWidth > 0) onLoad();
        else onError();
      }
    });
  };
  return Promise.all([waitForImage(pair.source), waitForImage(pair.measurement)]).then(() => undefined);
}

function createPreviewMeasurementReadiness(
  root: HTMLElement,
  source: HTMLElement,
  signal?: AbortSignal,
  transitionRoots: readonly Element[] = [],
  imagePairs: readonly WechatMeasurementImagePair[] | null = null
): Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  promise: Promise<void>;
  start: () => void;
  wait: () => Promise<void>;
}> {
  const controller = new AbortController();
  const images = [
    ...(root.matches('img') ? [root as unknown as HTMLImageElement] : []),
    ...Array.from(root.querySelectorAll('img'))
  ];
  const pairedImages = imagePairs ?? pairMeasurementElements(source, root).imagePairs;
  if (new Set(pairedImages.map((pair) => pair.measurement)).size !== images.length) {
    throw new Error('wechat-preview-measurement-image-pair-mismatch');
  }
  const lazyAttributes = images.map((image) => {
    const value = image.getAttribute('loading');
    if ('lazy' === value?.trim().toLowerCase()) image.setAttribute('loading', 'eager');
    return { image, value };
  });
  let ready = false;
  let cleaned = false;
  let settled = false;
  let started = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = Date.now() + THEME_IMAGE_FETCH_TIMEOUT_MS;
  let removeExternalAbort = (): void => undefined;
  const restoreLoadingAttributes = (): void => {
    lazyAttributes.forEach(({ image, value }) => {
      if (null === value) image.removeAttribute('loading');
      else image.setAttribute('loading', value);
    });
  };
  const imageReadiness = pairedImages.map((imagePair) => waitForMeasuredImage(imagePair, controller.signal));
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finish = (error?: unknown): void => {
    if (settled) return;
    settled = true;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    removeExternalAbort();
    removeExternalAbort = () => undefined;
    restoreLoadingAttributes();
    if (error) {
      controller.abort();
      rejectReady(error);
      return;
    }
    ready = true;
    resolveReady();
  };
  const onAbort = (): void => finish(previewMeasurementAbortError());
  if (signal) {
    if (signal.aborted) controller.abort();
    else {
      const onExternalAbort = (): void => {
        controller.abort();
        onAbort();
      };
      signal.addEventListener('abort', onExternalAbort, { once: true });
      removeExternalAbort = () => signal.removeEventListener('abort', onExternalAbort);
    }
  }
  const start = (): void => {
    if (started || settled || cleaned) return;
    started = true;
    try {
      // Force one layout on the attached clone so CSS Font Loading can observe
      // fonts used by this measurement owner before its ready promise is read.
      root.getBoundingClientRect();
      if (source !== root) source.getBoundingClientRect();
    } catch (error: unknown) {
      finish(error);
      return;
    }
    const fonts = root.ownerDocument.fonts;
    const fontReadiness = fonts?.ready
      ? Promise.resolve(fonts.ready).catch(() => {
          throw new Error('wechat-preview-measurement-font-failed');
        })
      : Promise.resolve();
    let initialTransitions: Animation[];
    try {
      initialTransitions = activePreviewTransitions(transitionRoots);
    } catch (error: unknown) {
      finish(error);
      return;
    }
    const transitionsReady = initialTransitions.length
      ? waitForPreviewTransitions(transitionRoots, controller.signal, deadline)
      : Promise.resolve();
    if ((!fonts || 'loaded' === fonts.status) && !images.length && !initialTransitions.length) {
      finish();
      return;
    }
    Promise.all([...imageReadiness, fontReadiness, transitionsReady])
      .then(() => waitForPreviewTransitions(transitionRoots, controller.signal, deadline))
      .then(
        () => finish(),
        (error: unknown) => finish(error)
      );
  };
  if (signal?.aborted) onAbort();
  if (!settled) {
    timeout = setTimeout(() => {
      controller.abort();
      finish(previewMeasurementResourceError('timeout'));
    }, THEME_IMAGE_FETCH_TIMEOUT_MS);
  }
  const wait = (): Promise<void> => {
    if (cleaned) return Promise.reject(previewMeasurementAbortError());
    if (settled) {
      if (!ready) return Promise.reject(previewMeasurementAbortError());
      try {
        if (activePreviewTransitions(transitionRoots).length) {
          return Promise.reject(previewTransitionStaleError());
        }
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(previewMeasurementResourceError('timeout'));
    return withTimeout(
      waitForPreviewTransitions(transitionRoots, controller.signal, deadline),
      remaining,
      'wechat-preview-measurement-resource-timeout'
    );
  };
  void promise.catch(() => undefined);

  return {
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      finish(previewMeasurementAbortError());
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      removeExternalAbort();
      removeExternalAbort = () => undefined;
      controller.abort();
      restoreLoadingAttributes();
    },
    isReady: () => ready,
    promise,
    start,
    wait
  };
}

function createHiddenPreviewGeometryMeasurement(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal
): WechatPreviewMeasurementLease {
  const document = preview.ownerDocument;
  if (!document.body) throw new Error('wechat-preview-measurement-document-body-unavailable');
  const host = document.createElement('div');
  host.className = 'easymde-wechat-preview-measurement';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:block',
    'opacity:0',
    'pointer-events:none',
    'contain:layout style'
  ].join(';');
  const width = previewWorkspaceMeasurementWidth(preview, runtime);
  if (width) {
    host.style.width = `${width}px`;
    host.style.maxWidth = `${width}px`;
  }
  const inherited = runtime.getComputedStyle(preview);
  PREVIEW_MEASUREMENT_INHERITED_PROPERTIES.forEach((property) => {
    const value = inherited.getPropertyValue(property);
    if (value) host.style.setProperty(property, value);
  });
  for (let index = 0; index < inherited.length; index += 1) {
    const property = inherited.item(index);
    if (!property?.startsWith('--')) continue;
    host.style.setProperty(property, inherited.getPropertyValue(property));
  }
  const path: Element[] = [];
  let source: Element | null = preview;
  while (source && source !== document.body && source !== document.documentElement) {
    path.unshift(source);
    source = source.parentElement;
  }
  let clone: HTMLElement | null = null;
  let cloneParent: Element | null = host;
  path.forEach((pathElement) => {
    const pathClone = (
      pathElement === preview ? pathElement.cloneNode(true) : pathElement.cloneNode(false)
    ) as HTMLElement;
    stripRawDimensionContextIdentityAttributes(pathClone);
    const computed = runtime.getComputedStyle(pathElement);
    if (pathElement !== preview) {
      pathClone.style.setProperty('display', 'block', 'important');
      pathClone.style.setProperty('position', 'static', 'important');
      pathClone.style.setProperty('inset', 'auto', 'important');
      pathClone.style.setProperty('width', '100%', 'important');
      pathClone.style.setProperty('min-width', '0', 'important');
      pathClone.style.setProperty('max-width', 'none', 'important');
      pathClone.style.setProperty('height', 'auto', 'important');
      pathClone.style.setProperty('min-height', '0', 'important');
      pathClone.style.setProperty('max-height', 'none', 'important');
      pathClone.style.setProperty('margin', '0', 'important');
      pathClone.style.setProperty('padding', '0', 'important');
      pathClone.style.setProperty('border', '0', 'important');
      pathClone.style.setProperty('transform', 'none', 'important');
    }
    if ('none' === computed.getPropertyValue('display').trim().toLowerCase()) {
      pathClone.style.setProperty('display', 'block', 'important');
    }
    if ('hidden' === computed.getPropertyValue('content-visibility').trim().toLowerCase()) {
      pathClone.style.setProperty('content-visibility', 'visible', 'important');
    }
    cloneParent?.append(pathClone);
    cloneParent = pathClone;
    if (pathElement === preview) clone = pathClone;
  });
  if (!clone) {
    host.remove();
    throw new Error('wechat-preview-measurement-preview-unavailable');
  }
  const measurementRoot = clone as HTMLElement;
  const pairing = pairMeasurementElements(preview, measurementRoot);
  const readiness = createPreviewMeasurementReadiness(
    measurementRoot,
    preview,
    signal,
    [preview, measurementRoot],
    pairing.imagePairs
  );
  document.body.append(host);
  readiness.start();
  return {
    cleanup: () => {
      readiness.cleanup();
      host.remove();
    },
    isReady: readiness.isReady,
    measurementFor: (source) => pairing.bySource.get(source) ?? null,
    ready: readiness.promise,
    root: measurementRoot,
    sourceGeometryReference: 'measurement',
    sourceMarkup: clipboardSourceMarkup(preview),
    sourceFor: (measurement) => pairing.byMeasurement.get(measurement) ?? null,
    sourceRoot: preview,
    sourceWidthKey: width,
    wait: readiness.wait
  };
}

function createPreviewMeasurementLease(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal
): WechatPreviewMeasurementLease | null {
  return isPreviewHidden(preview, runtime) ? createHiddenPreviewGeometryMeasurement(preview, runtime, signal) : null;
}

function taskCheckboxNeedsGeometry(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  if (!isTaskListCheckbox(source)) return false;
  const computed = runtime.getComputedStyle(source);
  if (['absolute', 'relative'].includes(computed.getPropertyValue('position').trim().toLowerCase())) {
    return true;
  }
  return ['::before', '::after'].some((pseudo) => {
    const pseudoComputed = runtime.getComputedStyle(source, pseudo);
    if (isHiddenPseudoPaint(pseudoComputed)) return false;
    const content = pseudoComputed.getPropertyValue('content');
    return null !== pseudoContent(content) || isTaskSvgPseudoContent(source, content);
  });
}

function taskCheckboxGeometryScopes(sourceRoot: HTMLElement, runtime: BrowserWechatClipboardRuntime): Element[] {
  const candidates = Array.from(sourceRoot.querySelectorAll('input'))
    .filter((source) => taskCheckboxNeedsGeometry(source, runtime))
    .map((source) => source.closest('li.task-list-item, li, p') ?? source.parentElement)
    .filter((scope): scope is Element => Boolean(scope));
  return candidates.filter(
    (scope, index) => !candidates.some((ancestor, ancestorIndex) => index !== ancestorIndex && ancestor.contains(scope))
  );
}

function taskCheckboxMeasurementHost(sourceRoot: HTMLElement, runtime: BrowserWechatClipboardRuntime): HTMLDivElement {
  const document = sourceRoot.ownerDocument;
  if (!document.body) throw new Error('wechat-task-checkbox-measurement-document-unavailable');
  const host = document.createElement('div');
  host.className = 'easymde-wechat-task-checkbox-measurement';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:block',
    'opacity:0',
    'pointer-events:none',
    'contain:layout style',
    'overflow:visible'
  ].join(';');
  const width = previewWorkspaceMeasurementWidth(sourceRoot, runtime);
  if (width) {
    host.style.width = `${width}px`;
    host.style.maxWidth = `${width}px`;
  }
  const inherited = runtime.getComputedStyle(sourceRoot);
  PREVIEW_MEASUREMENT_INHERITED_PROPERTIES.forEach((property) => {
    const value = inherited.getPropertyValue(property);
    if (value) host.style.setProperty(property, value);
  });
  for (let index = 0; index < inherited.length; index += 1) {
    const property = inherited.item(index);
    if (!property?.startsWith('--')) continue;
    host.style.setProperty(property, inherited.getPropertyValue(property));
  }
  return host;
}

function createBorrowedTaskCheckboxGeometryLease(
  sourceRoot: HTMLElement,
  borrowed: WechatPreviewMeasurementLease
): TaskCheckboxGeometryLease {
  if (borrowed.sourceRoot !== sourceRoot) {
    throw new Error('wechat-task-checkbox-geometry-source-root-mismatch');
  }
  return {
    cleanup: () => undefined,
    isReady: borrowed.isReady,
    measurementFor: borrowed.measurementFor,
    ready: borrowed.ready,
    root: borrowed.root,
    scopeRoot: borrowed.root,
    sourceGeometryReference: borrowed.sourceGeometryReference,
    sourceMarkup: borrowed.sourceMarkup,
    sourceFor: borrowed.sourceFor,
    sourceRoot,
    sourceWidthKey: borrowed.sourceWidthKey,
    wait: borrowed.wait
  };
}

function createVisibleTaskCheckboxGeometryLease(
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal
): TaskCheckboxGeometryLease | null {
  const scopes = taskCheckboxGeometryScopes(sourceRoot, runtime);
  if (!scopes.length) return null;
  const document = sourceRoot.ownerDocument;
  const host = taskCheckboxMeasurementHost(sourceRoot, runtime);
  const measurementBySource = new WeakMap<Element, Element>();
  const sourceByMeasurement = new WeakMap<Element, Element>();
  const imagePairsBySource = new Map<Element, WechatMeasurementImagePair>();
  const registerPair = (source: Element, measurement: Element): void => {
    if (source.localName !== measurement.localName || source.namespaceURI !== measurement.namespaceURI) {
      throw new Error('wechat-task-checkbox-geometry-element-pair-mismatch');
    }
    const previousMeasurement = measurementBySource.get(source);
    if (previousMeasurement && previousMeasurement !== measurement) {
      sourceByMeasurement.delete(previousMeasurement);
      imagePairsBySource.delete(source);
    }
    measurementBySource.set(source, measurement);
    sourceByMeasurement.set(measurement, source);
    if (source instanceof HTMLImageElement && measurement instanceof HTMLImageElement) {
      imagePairsBySource.set(source, { measurement, source });
    }
  };
  const path: Element[] = [];
  let current: Element | null = sourceRoot;
  while (current && current !== document.body && current !== document.documentElement) {
    path.unshift(current);
    current = current.parentElement;
  }
  let parent: Element = host;
  let scopeRoot: HTMLElement | null = null;
  path.forEach((source) => {
    const clone = source.cloneNode(false) as HTMLElement;
    stripRawDimensionContextIdentityAttributes(clone);
    if (source !== sourceRoot) {
      clone.style.setProperty('display', 'block', 'important');
      clone.style.setProperty('position', 'static', 'important');
      clone.style.setProperty('inset', 'auto', 'important');
      clone.style.setProperty('width', '100%', 'important');
      clone.style.setProperty('min-width', '0', 'important');
      clone.style.setProperty('max-width', 'none', 'important');
      clone.style.setProperty('height', 'auto', 'important');
      clone.style.setProperty('min-height', '0', 'important');
      clone.style.setProperty('max-height', 'none', 'important');
      clone.style.setProperty('margin', '0', 'important');
      clone.style.setProperty('padding', '0', 'important');
      clone.style.setProperty('border', '0', 'important');
      clone.style.setProperty('transform', 'none', 'important');
    }
    parent.appendChild(clone);
    parent = clone;
    registerPair(source, clone);
    if (source === sourceRoot) scopeRoot = clone;
  });
  if (!scopeRoot) {
    host.remove();
    throw new Error('wechat-task-checkbox-geometry-scope-unavailable');
  }

  const ensureShallowChildren = (sourceParent: Element, cloneParent: Element): void => {
    Array.from(sourceParent.children).forEach((sourceChild) => {
      if (measurementBySource.has(sourceChild)) return;
      const cloneChild = sourceChild.cloneNode(false) as HTMLElement;
      stripRawDimensionContextIdentityAttributes(cloneChild);
      cloneParent.appendChild(cloneChild);
      registerPair(sourceChild, cloneChild);
    });
  };
  const mapDeepScope = (sourceScope: Element, cloneScope: Element): void => {
    registerPair(sourceScope, cloneScope);
    const sourceChildren = Array.from(sourceScope.children);
    const cloneChildren = Array.from(cloneScope.children);
    if (sourceChildren.length !== cloneChildren.length) {
      throw new Error('wechat-task-checkbox-geometry-scope-alignment-failed');
    }
    sourceChildren.forEach((sourceChild, index) => {
      const cloneChild = cloneChildren[index];
      if (!cloneChild) throw new Error('wechat-task-checkbox-geometry-owner-missing');
      mapDeepScope(sourceChild, cloneChild);
    });
  };
  scopes.forEach((scope) => {
    const chain: Element[] = [];
    let source: Element | null = scope;
    while (source && source !== sourceRoot) {
      chain.unshift(source);
      source = source.parentElement;
    }
    let sourceParent: Element = sourceRoot;
    let cloneParent = scopeRoot as Element;
    ensureShallowChildren(sourceParent, cloneParent);
    chain.forEach((chainElement) => {
      const shallow = measurementBySource.get(chainElement);
      if (!shallow) throw new Error('wechat-task-checkbox-geometry-owner-missing');
      sourceParent = chainElement;
      cloneParent = shallow;
      ensureShallowChildren(sourceParent, cloneParent);
    });
    const shallowScope = measurementBySource.get(scope);
    if (!shallowScope) throw new Error('wechat-task-checkbox-geometry-owner-missing');
    const deepScope = scope.cloneNode(true) as HTMLElement;
    stripRawDimensionContextIdentityAttributes(deepScope);
    shallowScope.replaceWith(deepScope);
    mapDeepScope(scope, deepScope);
  });

  const readiness = createPreviewMeasurementReadiness(
    scopeRoot,
    sourceRoot,
    signal,
    [sourceRoot, scopeRoot],
    Array.from(imagePairsBySource.values())
  );
  document.body.appendChild(host);
  readiness.start();
  return {
    cleanup: () => {
      readiness.cleanup();
      host.remove();
    },
    isReady: readiness.isReady,
    measurementFor: (source) => measurementBySource.get(source) ?? null,
    ready: readiness.promise,
    root: scopeRoot,
    scopeRoot,
    sourceGeometryReference: 'source',
    sourceMarkup: clipboardSourceMarkup(sourceRoot),
    sourceFor: (measurement) => sourceByMeasurement.get(measurement) ?? null,
    sourceRoot,
    sourceWidthKey: previewWorkspaceMeasurementWidth(sourceRoot, runtime),
    wait: readiness.wait
  };
}

function createTaskCheckboxGeometryLease(
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal,
  borrowedMeasurement: WechatPreviewMeasurementLease | null = null
): TaskCheckboxGeometryLease | null {
  if (!taskCheckboxGeometryScopes(sourceRoot, runtime).length) return null;
  return borrowedMeasurement
    ? createBorrowedTaskCheckboxGeometryLease(sourceRoot, borrowedMeasurement)
    : createVisibleTaskCheckboxGeometryLease(sourceRoot, runtime, signal);
}

const RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES = new Set([
  'data-easymde-editor-owner',
  'data-easymde-preview-accepted',
  'data-easymde-preview-error',
  'data-easymde-preview-html-sink',
  'data-easymde-preview-refreshing'
]);

function stripRawDimensionContextIdentityAttributes(root: Element): void {
  RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.forEach((attribute) => {
    root.querySelectorAll(`[${attribute}]`).forEach((node) => {
      node.removeAttribute(attribute);
    });
    if (root.hasAttribute(attribute)) root.removeAttribute(attribute);
  });
}

function syncRawContextAttributes(source: Element, mirror: Element, suppressPreviewSinkIdentity = false): void {
  const sourceAttributes = new Map(Array.from(source.attributes, (attribute) => [attribute.name, attribute.value]));
  for (const attribute of Array.from(mirror.attributes)) {
    if (
      !sourceAttributes.has(attribute.name) ||
      (suppressPreviewSinkIdentity && RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.has(attribute.name))
    )
      mirror.removeAttribute(attribute.name);
  }
  sourceAttributes.forEach((value, name) => {
    if (suppressPreviewSinkIdentity && RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.has(name)) return;
    if (mirror.getAttribute(name) !== value) mirror.setAttribute(name, value);
  });
}

function createRawDimensionContextMirror(
  sourceRoot: HTMLElement
): Readonly<{
  cleanup: () => void;
  pairs: ReadonlyArray<Readonly<{ mirror: Element; source: Element }>>;
  root: HTMLElement;
}> {
  const document = sourceRoot.ownerDocument;
  if (!document.body) throw new Error('wechat-raw-dimension-context-document-unavailable');
  const host = document.createElement('div');
  host.className = 'easymde-wechat-raw-dimension-context';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  const originalDisplay = host.style.display;
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:none',
    'opacity:0',
    'pointer-events:none'
  ].join(';');
  const path: Element[] = [];
  let current: Element | null = sourceRoot;
  while (current && current !== document.body && current !== document.documentElement) {
    path.unshift(current);
    current = current.parentElement;
  }
  let root: HTMLElement | null = null;
  let parent: Element = host;
  const pairs: Array<{ mirror: Element; source: Element }> = [];
  path.forEach((element) => {
    const clone = (element === sourceRoot ? element.cloneNode(true) : element.cloneNode(false)) as HTMLElement;
    clone.querySelectorAll('script, style').forEach((node) => {
      node.remove();
    });
    stripRawDimensionContextIdentityAttributes(clone);
    parent.append(clone);
    parent = clone;
    pairs.push({ mirror: clone, source: element });
    if (element === sourceRoot) root = clone;
  });
  if (!root) {
    host.remove();
    throw new Error('wechat-raw-dimension-context-root-unavailable');
  }
  document.body.append(host);
  return {
    cleanup: () => {
      host.style.display = originalDisplay;
      host.remove();
    },
    pairs,
    root
  };
}

function createDimensionSemanticsContext(
  layoutRoot: HTMLElement,
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): WechatDimensionSemanticsContext {
  const rawMirror = layoutRoot === sourceRoot ? createRawDimensionContextMirror(sourceRoot) : null;
  const rawRoot = rawMirror?.root ?? sourceRoot;
  const contextElements = (root: HTMLElement): Element[] =>
    [root, ...Array.from(root.querySelectorAll('*'))].filter((element) => !element.matches('script, style'));
  const layoutElements = contextElements(layoutRoot);
  const rawElements = contextElements(rawRoot);
  const rawElementByLayout = new WeakMap<Element, Element>();
  let formattingOwnerDisplayCache = new WeakMap<Element, string>();
  const refresh = (): void => {
    formattingOwnerDisplayCache = new WeakMap<Element, string>();
    if (!rawMirror) return;
    rawMirror.pairs.forEach(({ mirror, source }) => {
      syncRawContextAttributes(source, mirror, true);
    });
    const sourceElements = contextElements(sourceRoot);
    const mirrorElements = contextElements(rawMirror.root);
    sourceElements.forEach((source, index) => {
      const mirror = mirrorElements[index];
      if (mirror) syncRawContextAttributes(source, mirror, true);
    });
    rawMirror.root.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, '1');
  };
  layoutElements.forEach((element, index) => {
    const rawElement = rawElements[index];
    if (rawElement) rawElementByLayout.set(element, rawElement);
  });
  refresh();
  const getFormattingOwnerDisplay = (source: Element): string | null => {
    let ancestor = source.parentElement;
    while (ancestor) {
      const rawAncestor = rawElementByLayout.get(ancestor);
      if (!rawAncestor) return null;
      let display = formattingOwnerDisplayCache.get(rawAncestor);
      if (undefined === display) {
        display = runtime.getComputedStyle(rawAncestor).getPropertyValue('display').trim().toLowerCase();
        formattingOwnerDisplayCache.set(rawAncestor, display);
      }
      if ('contents' !== display) return display || null;
      ancestor = ancestor.parentElement;
    }
    return null;
  };
  return {
    cleanup: () => rawMirror?.cleanup(),
    getComputedStyle: (source, pseudoElement) => {
      const rawElement = rawElementByLayout.get(source);
      return rawElement ? runtime.getComputedStyle(rawElement, pseudoElement) : null;
    },
    getFormattingOwnerDisplay,
    getRootComputedStyle: (source, pseudoElement) => {
      const rawElement = rawElementByLayout.get(source);
      if (rawMirror && rawElement) return runtime.getComputedStyle(rawElement, pseudoElement);
      const previousMarker = source.getAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE);
      source.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, '1');
      try {
        return snapshotComputedStyle(runtime.getComputedStyle(source, pseudoElement));
      } finally {
        if (null === previousMarker) {
          source.removeAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE);
        } else {
          source.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, previousMarker);
        }
      }
    },
    refresh
  };
}

function connectedPlainText(root: HTMLElement, source: HTMLElement): string {
  const document = root.ownerDocument;
  if (!document.body) throw new Error('wechat-plain-text-document-body-unavailable');
  const detachedCodeFrameHeaders: Array<Readonly<{ element: Element; parent: Node; nextSibling: ChildNode | null }>> =
    [];
  const normalizations = EXPORT_TEXT_NORMALIZATIONS.get(root) ?? new Map();
  const restoreCodeText = (property: 'original' | 'encoded'): void => {
    normalizations?.forEach((value, textNode) => {
      textNode.nodeValue = value[property];
    });
  };
  // The encoded clone is needed for the HTML Blob. Plain-text measurement must
  // see the original code bytes, while finally restoring the encoded clone
  // keeps repeated payload reads and cleanup deterministic.
  let host: HTMLDivElement | null = null;
  try {
    restoreCodeText('original');
    assertTaskCheckboxCaptionRuns(root, normalizations, 'original');
    // Plain text does not need media resources. Remove their fetchable
    // attributes from the temporary measurement tree while leaving the HTML
    // payload untouched.
    root.querySelectorAll('img, video, source').forEach((element) => {
      element.removeAttribute('src');
      element.removeAttribute('srcset');
      element.removeAttribute('poster');
    });
    // A generated code-frame header is paint-only. Keeping it in the HTML
    // payload is required for layout, but its block boundary must not become
    // a line in the separate plain-text clipboard payload.
    Array.from(root.querySelectorAll('*'))
      .filter((element) => CODE_FRAME_HEADER_CLONES.has(element))
      .forEach((element) => {
        const parent = element.parentNode;
        if (!parent) return;
        detachedCodeFrameHeaders.push({ element, parent, nextSibling: element.nextSibling });
        parent.removeChild(element);
      });
    host = document.createElement('div');
    // `innerText` uses layout only while a node is connected. Keep this host
    // outside the viewport without using `display:none` or `visibility:hidden`,
    // either of which makes `innerText` empty or loses block boundaries.
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'opacity:0',
      'pointer-events:none',
      'contain:layout'
    ].join(';');
    const sourceWidth = previewMeasurementWidth(source);
    if (sourceWidth) {
      host.style.width = `${sourceWidth}px`;
      host.style.maxWidth = `${sourceWidth}px`;
    }
    document.body.append(host);
    host.append(root);
    const connectedText = normalizedPlainText(root.innerText || root.textContent || '');
    // jsdom and other non-layout DOM implementations flatten a connected
    // clone too. When the real Preview exposes line-aware `innerText`, retain
    // those source boundaries only in that no-layout case; the normalized
    // clone remains the source for browsers that can perform layout.
    const sourceText = source.innerText;
    assertTaskCheckboxCaptionRuns(root, normalizations, 'original');
    if (!connectedText.includes('\n') && 'string' === typeof sourceText && sourceText.includes('\n')) {
      return normalizedPlainText(sourceText);
    }
    return connectedText;
  } finally {
    host?.remove();
    detachedCodeFrameHeaders.reverse().forEach(({ element, parent, nextSibling }) => {
      if (nextSibling?.parentNode === parent) parent.insertBefore(element, nextSibling);
      else parent.appendChild(element);
    });
    restoreCodeText('encoded');
    assertTaskCheckboxCaptionRuns(root, normalizations, 'encoded');
  }
}

async function serializeClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal,
  sourceRoot: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  taskGeometryLease: TaskCheckboxGeometryLease | null = null
): Promise<SerializedClipboardPayload> {
  throwIfBackgroundPreparationAborted(signal);
  const ownedDimensionSemantics = dimensionSemantics ?? createDimensionSemanticsContext(preview, sourceRoot, runtime);
  try {
    ownedDimensionSemantics.refresh();
    const clone = await createMarkup(
      preview,
      runtime,
      cache,
      yieldToBrowser,
      conversion,
      signal,
      sourceRoot,
      ownedDimensionSemantics,
      taskGeometryLease
    );
    throwIfBackgroundPreparationAborted(signal);
    assertTaskCheckboxCaptionRuns(clone, EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(), 'encoded');
    const html = runWechatSyncTiming(
      clone.ownerDocument.defaultView?.performance,
      WECHAT_COPY_TIMING_NAMES.outerHtml,
      { mode: 'sync' },
      () => {
        const html = clone.outerHTML;
        assertTaskCheckboxCaptionRuns(clone, EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(), 'encoded');
        return html;
      }
    );
    await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
    throwIfBackgroundPreparationAborted(signal);
    assertTaskCheckboxCaptionRuns(clone, EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(), 'encoded');
    const text = runWechatSyncTiming(
      clone.ownerDocument.defaultView?.performance,
      WECHAT_COPY_TIMING_NAMES.connectedPlainText,
      { mode: 'sync' },
      () => connectedPlainText(clone, preview)
    );
    await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
    throwIfBackgroundPreparationAborted(signal);
    assertTaskCheckboxCaptionRuns(clone, EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(), 'encoded');
    return { html, text };
  } finally {
    if (!dimensionSemantics) ownedDimensionSemantics.cleanup();
  }
}

function serializeClipboardPayloadSynchronously(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  sourceRoot: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  taskGeometryLease: TaskCheckboxGeometryLease | null = null
): SerializedClipboardPayload | null {
  const ownedDimensionSemantics = dimensionSemantics ?? createDimensionSemanticsContext(preview, sourceRoot, runtime);
  try {
    ownedDimensionSemantics.refresh();
    const clone = createMarkupSynchronously(preview, runtime, sourceRoot, ownedDimensionSemantics, taskGeometryLease);
    if (!clone) return null;
    assertTaskCheckboxCaptionRuns(clone, EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(), 'encoded');
    const html = runWechatSyncTiming(
      clone.ownerDocument.defaultView?.performance,
      WECHAT_COPY_TIMING_NAMES.outerHtml,
      { mode: 'sync' },
      () => {
        const html = clone.outerHTML;
        assertTaskCheckboxCaptionRuns(clone, EXPORT_TEXT_NORMALIZATIONS.get(clone) ?? new Map(), 'encoded');
        return html;
      }
    );
    const text = runWechatSyncTiming(
      clone.ownerDocument.defaultView?.performance,
      WECHAT_COPY_TIMING_NAMES.connectedPlainText,
      { mode: 'sync' },
      () => connectedPlainText(clone, preview)
    );
    return { html, text };
  } finally {
    if (!dimensionSemantics) ownedDimensionSemantics.cleanup();
  }
}

function preparedPseudoStyleSignature(
  element: Element,
  pseudoElement: (typeof PREPARED_PSEUDO_ELEMENTS)[number],
  runtime: BrowserWechatClipboardRuntime,
  root = false,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  projectRoot = false
): string {
  const computed = runtime.getComputedStyle(element, pseudoElement);
  const exported = projectRoot
    ? rootExportComputedStyle(element, computed, dimensionSemantics, pseudoElement)
    : computed;
  const rawContent = exported.getPropertyValue('content');
  if (null === pseudoContent(rawContent) && !isTaskSvgPseudoContent(element, rawContent)) {
    return `${pseudoElement}:content=${rawContent}`;
  }
  const semanticComputed =
    dimensionSemantics && semanticMarginSource(element, computed, pseudoElement)
      ? projectRoot
        ? exported
        : dimensionSemantics.getComputedStyle(element, pseudoElement)
      : null;
  const signature = `${pseudoElement}:${signatureStyleProperties(element, root, true)
    .map(
      (property) =>
        `${property}=${
          semanticMarginValue(property, element, computed, dimensionSemantics, pseudoElement, semanticComputed) ??
          exported.getPropertyValue(property)
        }`
    )
    .join(';')}`;
  const generatedHeadingVisibility =
    !root && '::after' === pseudoElement && ['H1', 'H2', 'H3', 'H4'].includes(element.tagName)
      ? `;visibility=${exported.getPropertyValue('visibility')}`
      : '';
  return `${signature}${generatedHeadingVisibility}`;
}

function preparedChildPseudoMarginSignature(
  element: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  if (!dimensionSemantics) return '';
  return PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) => {
    const computed = runtime.getComputedStyle(element, pseudoElement);
    const content = computed.getPropertyValue('content');
    if (null === pseudoContent(content)) return '';
    const semantic = dimensionSemantics.getComputedStyle(element, pseudoElement);
    const signature = semanticMarginSignature(element, computed, dimensionSemantics, pseudoElement, semantic);
    return signature ? `${pseudoElement}:${signature}` : '';
  }).join('|');
}

function preparedRootExportStyleSignature(
  element: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  const computed = rootExportComputedStyle(element, runtime.getComputedStyle(element), dimensionSemantics);
  const semanticComputed = dimensionSemantics && semanticMarginSource(element, computed) ? computed : null;
  const styles = COPY_STYLE_PROPERTIES.map(
    (property) =>
      `${property}=${
        semanticMarginValue(property, element, computed, dimensionSemantics, undefined, semanticComputed) ??
        computed.getPropertyValue(property)
      }`
  ).join(';');
  const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
    preparedPseudoStyleSignature(element, pseudoElement, runtime, true, dimensionSemantics, true)
  ).join('|');
  return `${styles}|${pseudoStyles}`;
}

function ordinaryDimensionSemanticsSignature(
  element: Element,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  if (!dimensionSemantics) return '';
  const computed = dimensionSemantics.getComputedStyle(element);
  if (!computed) return '';
  const dimensions =
    !supportsSpecialLayout(element) && !isSvgElement(element)
      ? ['box-sizing', ...ORDINARY_DIMENSION_PROPERTIES]
          .map((property) => `${property}=${computed.getPropertyValue(property)}`)
          .join(';')
      : '';
  const margins = semanticMarginSignature(element, computed, dimensionSemantics, undefined, computed);
  return `${dimensions}${dimensions && margins ? ';' : ''}${margins}`;
}

function preparedLayoutSignature(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  layoutPreview: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  dimensionSignatureSink?: { value: string }
): string {
  const viewport = layoutPreview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  const dimensionEntries: string[] = [];
  const signature = [
    viewportSignature,
    ...elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const computed = runtime.getComputedStyle(element);
      const root = 0 === index;
      const styles = signatureStyleProperties(element, root)
        .map((property) => `${property}=${computed.getPropertyValue(property)}`)
        .join(';');
      const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
        preparedPseudoStyleSignature(element, pseudoElement, runtime, root, dimensionSemantics, root)
      ).join('|');
      const dimensionSemanticsSignature = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
      const markerSignature = ['OL', 'UL'].includes(element.tagName)
        ? listMarkerSignature(element, computed, runtime)
        : '';
      const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(element, runtime);
      const taskCheckboxSignature = taskListCheckboxFreshnessSignature(element, runtime, dimensionSemantics);
      const tableHeaderSignature = tableHeaderPaintFreshnessSignature(element, runtime);
      const tableScrollSignature = tableScrollOwnerFreshnessSignature(element, runtime);
      const childPseudoMarginSignature = root
        ? ''
        : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
      const rootExportStyleSignature = root
        ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics)
        : '';
      dimensionEntries.push(
        `${index}:${dimensionSemanticsSignature}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`
      );
      // `left`/`top`/`right`/`bottom` are viewport-relative and change when
      // the user scrolls, even though the exported markup and layout did not.
      // Only retain dimensions here; they can affect wrapping and image/text
      // geometry without invalidating a prepared payload on ordinary scroll.
      return `${index}:${rect.width},${rect.height}:${styles}:${pseudoStyles}:${dimensionSemanticsSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`;
    })
  ].join('\u0001');
  if (dimensionSignatureSink) dimensionSignatureSink.value = dimensionEntries.join('\u0001');
  return signature;
}

async function preparedLayoutSignatureWithYield(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield,
  signal?: AbortSignal,
  layoutPreview: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  dimensionSignatureSink?: { value: string }
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  const viewport = layoutPreview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const entries: string[] = [];
  const dimensionEntries: string[] = [];
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  for (const [index, element] of elements.entries()) {
    throwIfBackgroundPreparationAborted(signal);
    const rect = element.getBoundingClientRect();
    const computed = runtime.getComputedStyle(element);
    const styles: string[] = [];
    for (const property of signatureStyleProperties(element, 0 === index)) {
      styles.push(`${property}=${computed.getPropertyValue(property)}`);
      if (yieldToBrowser.shouldYield()) await yieldToBrowser();
    }
    const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
      preparedPseudoStyleSignature(element, pseudoElement, runtime, 0 === index, dimensionSemantics, 0 === index)
    ).join('|');
    const dimensionSemanticsSignature = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
    const markerSignature = ['OL', 'UL'].includes(element.tagName)
      ? listMarkerSignature(element, computed, runtime)
      : '';
    const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(element, runtime);
    const taskCheckboxSignature = taskListCheckboxFreshnessSignature(element, runtime, dimensionSemantics);
    const tableHeaderSignature = tableHeaderPaintFreshnessSignature(element, runtime);
    const tableScrollSignature = tableScrollOwnerFreshnessSignature(element, runtime);
    const childPseudoMarginSignature =
      0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
    const rootExportStyleSignature =
      0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
    dimensionEntries.push(
      `${index}:${dimensionSemanticsSignature}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`
    );
    entries.push(
      `${index}:${rect.width},${rect.height}:${styles.join(';')}:${pseudoStyles}:${dimensionSemanticsSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`
    );
    await yieldToBrowser();
    throwIfBackgroundPreparationAborted(signal);
  }

  if (dimensionSignatureSink) dimensionSignatureSink.value = dimensionEntries.join('\u0001');
  return [viewportSignature, ...entries].join('\u0001');
}

async function preparedDimensionGeometrySignatureWithYield(
  layoutPreview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield,
  signal: AbortSignal | undefined,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  const viewport = layoutPreview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const entries: string[] = [];
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  for (const [index, element] of elements.entries()) {
    throwIfBackgroundPreparationAborted(signal);
    const rect = element.getBoundingClientRect?.();
    const dimensions = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
    const markerSignature = ['OL', 'UL'].includes(element.tagName)
      ? listMarkerSignature(element, runtime.getComputedStyle(element), runtime)
      : '';
    const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(element, runtime);
    const taskCheckboxSignature = taskListCheckboxFreshnessSignature(element, runtime, dimensionSemantics);
    const tableHeaderSignature = tableHeaderPaintFreshnessSignature(element, runtime);
    const tableScrollSignature = tableScrollOwnerFreshnessSignature(element, runtime);
    const childPseudoMarginSignature =
      0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
    const rootExportStyleSignature =
      0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
    entries.push(
      `${index}:${rect?.width ?? 0},${rect?.height ?? 0}:${dimensions}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`
    );
    if (yieldToBrowser.shouldYield()) await yieldToBrowser();
    throwIfBackgroundPreparationAborted(signal);
  }
  return [viewportSignature, ...entries].join('\u0001');
}

function preparedDimensionGeometrySignature(
  layoutPreview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  const viewport = layoutPreview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  const entries = elements.map((element, index) => {
    const rect = element.getBoundingClientRect?.();
    const dimensions = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
    const markerSignature = ['OL', 'UL'].includes(element.tagName)
      ? listMarkerSignature(element, runtime.getComputedStyle(element), runtime)
      : '';
    const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(element, runtime);
    const taskCheckboxSignature = taskListCheckboxFreshnessSignature(element, runtime, dimensionSemantics);
    const tableHeaderSignature = tableHeaderPaintFreshnessSignature(element, runtime);
    const tableScrollSignature = tableScrollOwnerFreshnessSignature(element, runtime);
    const childPseudoMarginSignature =
      0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
    const rootExportStyleSignature =
      0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
    return `${index}:${rect?.width ?? 0},${rect?.height ?? 0}:${dimensions}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`;
  });
  return [viewportSignature, ...entries].join('\u0001');
}

function preparedDimensionSemanticsSignature(
  layoutPreview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  return elements
    .map((element, index) => {
      const markerSignature = ['OL', 'UL'].includes(element.tagName)
        ? listMarkerSignature(element, runtime.getComputedStyle(element), runtime)
        : '';
      const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(element, runtime);
      const taskCheckboxSignature = taskListCheckboxFreshnessSignature(element, runtime, dimensionSemantics);
      const tableHeaderSignature = tableHeaderPaintFreshnessSignature(element, runtime);
      const tableScrollSignature = tableScrollOwnerFreshnessSignature(element, runtime);
      const rootExportStyleSignature =
        0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
      const childPseudoMarginSignature =
        0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
      return `${index}:${ordinaryDimensionSemanticsSignature(element, dimensionSemantics)}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`;
    })
    .join('\u0001');
}

function createPreparedClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  fallback: PreparedClipboardFallback | null,
  sequence: number,
  background = false,
  signal?: AbortSignal,
  measurement: WechatPreviewMeasurementLease | null = null,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  transition: WechatPreviewTransitionLease | null = null,
  taskGeometryLease: TaskCheckboxGeometryLease | null = null,
  isCurrent?: () => boolean,
  backgroundCancel: (() => void) | null = null
): PreparedClipboardPayload {
  let prepared: PreparedClipboardPayload;
  throwIfBackgroundPreparationAborted(signal);
  if (isCurrent && !isCurrent()) throw new Error('wechat-copy-cancelled');
  const serializationPreview = measurement?.root ?? preview;
  const readiness = Promise.all([
    measurement?.ready ?? Promise.resolve(),
    transition?.ready ?? Promise.resolve(),
    taskGeometryLease?.ready ?? Promise.resolve()
  ]);
  // Root class/style changes (font and article-theme controls) can change the
  // computed output without changing the rendered child markup. Responsive
  // breakpoints can also change computed styles and geometry without changing
  // the DOM, so keep both the full sink markup and a layout fingerprint.
  const sourceMarkup = clipboardSourceMarkup(preview);
  const yieldToBrowser = createSerializationYield(runtime, background, signal);
  let initialDimensionSignature = '';
  const initialDimensionSignatureSink = { value: '' };
  const layoutSignature =
    !background &&
    (!measurement || measurement.isReady()) &&
    (!transition || transition.isReady()) &&
    (!taskGeometryLease || taskGeometryLease.isReady())
      ? (() => {
          dimensionSemantics?.refresh();
          const signature = preparedLayoutSignature(
            preview,
            runtime,
            serializationPreview,
            dimensionSemantics,
            initialDimensionSignatureSink
          );
          initialDimensionSignature = initialDimensionSignatureSink.value;
          return signature;
        })()
      : '';
  let initialDimensionGeometrySignature = '';
  // Keep normal preparation asynchronous. A synchronous full-Preview walk is
  // only justified inside the originating click task when a browser rejects
  // Promise-backed ClipboardItem values; doing it for every background refresh
  // can monopolize the main thread on Mermaid/KaTeX-heavy articles.
  const initialLayoutSignature = readiness.then(
    async () => {
      throwIfBackgroundPreparationAborted(signal);
      if (isCurrent && !isCurrent()) throw new Error('wechat-copy-cancelled');
      dimensionSemantics?.refresh();
      if (!background) {
        initialDimensionGeometrySignature = preparedDimensionGeometrySignature(
          serializationPreview,
          runtime,
          dimensionSemantics
        );
      }
      if (!background && layoutSignature) return layoutSignature;
      if (background) {
        const signature = await preparedLayoutSignatureWithYield(
          preview,
          runtime,
          yieldToBrowser as SerializationYield,
          signal,
          serializationPreview,
          dimensionSemantics,
          initialDimensionSignatureSink
        );
        initialDimensionSignature = initialDimensionSignatureSink.value;
        return signature;
      }
      const signature = preparedLayoutSignature(
        preview,
        runtime,
        serializationPreview,
        dimensionSemantics,
        initialDimensionSignatureSink
      );
      initialDimensionSignature = initialDimensionSignatureSink.value;
      return signature;
    },
    (error: unknown) => {
      throw error;
    }
  );
  const promise = initialLayoutSignature
    .then((initialSignature) => {
      throwIfBackgroundPreparationAborted(signal);
      if (isCurrent && !isCurrent()) throw new Error('wechat-copy-cancelled');
      if (clipboardSourceMarkup(preview) !== sourceMarkup) {
        throw new Error('wechat-copy-stale');
      }
      return serializeClipboardPayload(
        serializationPreview,
        runtime,
        backgroundAssetCache,
        yieldToBrowser,
        undefined,
        signal,
        preview,
        dimensionSemantics,
        taskGeometryLease
      ).then(async (payload) => {
        throwIfBackgroundPreparationAborted(signal);
        if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
          throw new Error('wechat-copy-stale');
        }
        await measurement?.wait();
        await transition?.wait();
        await taskGeometryLease?.wait();
        runWechatSyncTiming(
          preview.ownerDocument.defaultView?.performance,
          WECHAT_COPY_TIMING_NAMES.finalRawContextRefresh,
          { mode: 'sync' },
          () => dimensionSemantics?.refresh()
        );
        const finalDimensionSignatureSink = { value: '' };
        const finalGeometryTiming = beginWechatTiming(
          preview.ownerDocument.defaultView?.performance,
          WECHAT_COPY_TIMING_NAMES.finalGeometry,
          { mode: background ? 'async' : 'sync' }
        );
        let finalSignature: string;
        try {
          finalSignature = background
            ? await preparedLayoutSignatureWithYield(
                preview,
                runtime,
                yieldToBrowser as SerializationYield,
                signal,
                serializationPreview,
                dimensionSemantics,
                finalDimensionSignatureSink
              )
            : preparedLayoutSignature(
                preview,
                runtime,
                serializationPreview,
                dimensionSemantics,
                finalDimensionSignatureSink
              );
          finalGeometryTiming.finish('success');
        } catch (error: unknown) {
          finalGeometryTiming.finish('error');
          throw error;
        }
        const finalDimensionSignature = finalDimensionSignatureSink.value;
        const finalDimensionGeometrySignature = background
          ? ''
          : preparedDimensionGeometrySignature(serializationPreview, runtime, dimensionSemantics);
        throwIfBackgroundPreparationAborted(signal);
        runWechatSyncTiming(
          preview.ownerDocument.defaultView?.performance,
          WECHAT_COPY_TIMING_NAMES.finalSourceFreshness,
          { mode: 'sync' },
          () => {
            if (clipboardSourceMarkup(preview) !== prepared.sourceMarkup) {
              throw new Error('wechat-copy-stale');
            }
          }
        );
        if (background && initialSignature !== finalSignature) {
          throw new Error('wechat-copy-stale');
        }
        if (!background && initialDimensionGeometrySignature !== finalDimensionGeometrySignature) {
          throw new Error('wechat-copy-stale');
        }
        if (isCurrent && !isCurrent()) throw new Error('wechat-copy-cancelled');
        prepared.dimensionSignature = finalDimensionSignature;
        prepared.layoutSignature = finalSignature;
        prepared.payload = payload;
        const current = preparedPayloads.get(preview);
        throwIfBackgroundPreparationAborted(signal);
        prepared.payload = payload;
        if (
          current &&
          current !== prepared &&
          current.sourceMarkup === prepared.sourceMarkup &&
          (!current.fallback || current.fallback.sequence < prepared.sequence)
        ) {
          // A replacement may have started while this serialization was waiting
          // on theme assets. Keep the most recent successful payload available
          // to that replacement if its own preparation later fails.
          current.fallback = {
            dimensionSignature: prepared.dimensionSignature,
            layoutSignature: prepared.layoutSignature,
            payload,
            sequence: prepared.sequence,
            sourceMarkup: prepared.sourceMarkup
          };
        }
        return payload;
      });
    })
    .catch((error: unknown) => {
      const current = preparedPayloads.get(preview);
      if (current === prepared) {
        const recovery = current.fallback;
        if (recovery) {
          preparedPayloads.set(preview, {
            backgroundCancel: prepared.backgroundCancel,
            fallback: recovery,
            dimensionSignature: recovery.dimensionSignature,
            layoutOwner: prepared.layoutOwner,
            layoutSignature: recovery.layoutSignature,
            payload: recovery.payload,
            promise: Promise.resolve(recovery.payload),
            sequence: prepared.sequence,
            sourceMarkup: recovery.sourceMarkup,
            recoveredAtLayoutSignature: prepared.layoutSignature
          });
        } else {
          preparedPayloads.delete(preview);
        }
      }
      throw error;
    });
  prepared = {
    backgroundCancel,
    fallback,
    dimensionSignature: initialDimensionSignature,
    layoutOwner: measurement ? 'measurement' : 'live',
    payload: null,
    promise,
    sequence,
    sourceMarkup,
    layoutSignature,
    recoveredAtLayoutSignature: null
  };
  preparedPayloads.set(preview, prepared);
  return prepared;
}

function preparedClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  nextSequence: () => number,
  replace = false,
  background = false,
  signal?: AbortSignal,
  suppliedMeasurement?: WechatPreviewMeasurementLease | null,
  suppliedDimensionSemantics?: WechatDimensionSemanticsContext | null,
  suppliedTransition?: WechatPreviewTransitionLease | null,
  suppliedTaskGeometryLease?: TaskCheckboxGeometryLease | null,
  isCurrent?: () => boolean,
  backgroundCancel: (() => void) | null = null
): PreparedClipboardPayload {
  throwIfBackgroundPreparationAborted(signal);
  const measurement =
    undefined === suppliedMeasurement ? createPreviewMeasurementLease(preview, runtime, signal) : suppliedMeasurement;
  const transition = suppliedTransition ?? (measurement ? null : createPreviewTransitionLease([preview], signal));
  let taskGeometryLease: TaskCheckboxGeometryLease | null = suppliedTaskGeometryLease ?? null;
  const serializationPreview = measurement?.root ?? preview;
  let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
  try {
    if (undefined === suppliedTaskGeometryLease) {
      taskGeometryLease = createTaskCheckboxGeometryLease(preview, runtime, signal, measurement);
    }
    dimensionSemantics =
      suppliedDimensionSemantics ?? createDimensionSemanticsContext(serializationPreview, preview, runtime);
    const existing = preparedPayloads.get(preview);
    const readinessReady = (!measurement || measurement.isReady()) && (!transition || transition.isReady());
    const taskGeometryReady = !taskGeometryLease || taskGeometryLease.isReady();
    const currentDimensionSignature =
      readinessReady && taskGeometryReady
        ? (() => {
            dimensionSemantics?.refresh();
            return preparedDimensionSemanticsSignature(serializationPreview, runtime, dimensionSemantics);
          })()
        : '';
    if (!replace && readinessReady && taskGeometryReady) {
      if (
        existing &&
        existing.sourceMarkup === clipboardSourceMarkup(preview) &&
        existing.dimensionSignature === currentDimensionSignature &&
        existing.layoutSignature === preparedLayoutSignature(preview, runtime, serializationPreview, dimensionSemantics)
      ) {
        measurement?.cleanup();
        transition?.cleanup();
        taskGeometryLease?.cleanup();
        dimensionSemantics.cleanup();
        return existing;
      }
    }
    const fallback = existing
      ? existing.payload
        ? {
            dimensionSignature: existing.dimensionSignature,
            layoutSignature: existing.layoutSignature,
            payload: existing.payload,
            sequence: existing.sequence,
            sourceMarkup: existing.sourceMarkup
          }
        : existing.fallback
      : null;
    const prepared = createPreparedClipboardPayload(
      preview,
      runtime,
      backgroundAssetCache,
      preparedPayloads,
      fallback,
      nextSequence(),
      background,
      signal,
      measurement,
      dimensionSemantics,
      transition,
      taskGeometryLease,
      isCurrent,
      backgroundCancel
    );
    if (measurement) {
      void prepared.promise.then(measurement.cleanup, measurement.cleanup);
    }
    if (transition) {
      void prepared.promise.then(transition.cleanup, transition.cleanup);
    }
    if (taskGeometryLease) {
      void prepared.promise.then(taskGeometryLease.cleanup, taskGeometryLease.cleanup);
    }
    void prepared.promise.then(dimensionSemantics.cleanup, dimensionSemantics.cleanup);
    return prepared;
  } catch (error: unknown) {
    measurement?.cleanup();
    transition?.cleanup();
    taskGeometryLease?.cleanup();
    dimensionSemantics?.cleanup();
    throw error;
  }
}

type WechatClipboardCopyGuard = Readonly<{ isCurrent?: (() => boolean) | undefined; signal?: AbortSignal | undefined }>;

type ClipboardSourceFreshnessState = Readonly<{
  current: () => ClipboardSourceFreshnessGuard | null;
  ready: Promise<void>;
}>;

function assertCopyGuardCurrent(guard: WechatClipboardCopyGuard): void {
  if (guard.signal?.aborted || (guard.isCurrent && !guard.isCurrent())) {
    throw new Error('wechat-copy-cancelled');
  }
}

function assertCopyPreviewCurrent(preview: HTMLElement, guard: WechatClipboardCopyGuard): void {
  assertCopyGuardCurrent(guard);
  if (!previewReady(preview)) throw new Error('wechat-preview-unavailable');
}

function assertPortableCopyCurrent(
  preview: HTMLElement,
  guard: WechatClipboardCopyGuard,
  sourceFreshness: ClipboardSourceFreshnessState
): void {
  assertCopyPreviewCurrent(preview, guard);
  const sourceGuard = sourceFreshness.current();
  if (!sourceGuard?.isCurrent()) {
    throw new Error('wechat-copy-stale');
  }
}

function isWechatCopyStaleError(error: unknown): boolean {
  return error instanceof Error && 'wechat-copy-stale' === error.message;
}

function isRetryableBackgroundPreparationError(error: unknown): boolean {
  return (
    isWechatCopyStaleError(error) ||
    (error instanceof Error &&
      'AbortError' === error.name &&
      'wechat-background-preparation-cancelled' === error.message)
  );
}

async function preparedClipboardPayloadAfterWrite(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  nextSequence: () => number,
  guard: WechatClipboardCopyGuard = {},
  sourceFreshness: ClipboardSourceFreshnessState,
  onMeasurementLease?: (cleanup: () => void) => void,
  onPreparedPayload?: (preview: HTMLElement, prepared: PreparedClipboardPayload) => void,
  isCurrent?: () => boolean
): Promise<PreparedClipboardPayload> {
  // Keep the click task free of computed-style and geometry work. The first
  // await is intentional: modern Clipboard write() must receive its deferred
  // payload before the freshness walk starts.
  await sourceFreshness.ready;
  assertPortableCopyCurrent(preview, guard, sourceFreshness);
  const yieldToBrowser = createSerializationYield(runtime, true);
  if (!yieldToBrowser) throw new Error('wechat-copy-yield-unavailable');
  await waitForBrowserTask(runtime);
  assertPortableCopyCurrent(preview, guard, sourceFreshness);

  let measurement: WechatPreviewMeasurementLease | null = null;
  let transition: WechatPreviewTransitionLease | null = null;
  let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
  try {
    let existing = preparedPayloads.get(preview);
    if (existing && !existing.payload) {
      if (existing.sourceMarkup !== clipboardSourceMarkup(preview)) {
        existing = undefined;
      } else if ('live' === existing.layoutOwner && existing.backgroundCancel && isPreviewHidden(preview, runtime)) {
        existing.backgroundCancel();
        assertPortableCopyCurrent(preview, guard, sourceFreshness);
        existing = undefined;
      } else {
        try {
          await existing.promise;
        } catch (error: unknown) {
          const recovered = preparedPayloads.get(preview);
          if (recovered?.payload) {
            existing = recovered;
          } else if (isRetryableBackgroundPreparationError(error)) {
            assertPortableCopyCurrent(preview, guard, sourceFreshness);
            existing = undefined;
          } else {
            throw error;
          }
        }
        assertPortableCopyCurrent(preview, guard, sourceFreshness);
        existing = preparedPayloads.get(preview);
      }
    }

    const measurementLease = createPreviewMeasurementLease(preview, runtime, guard.signal);
    measurement = measurementLease;
    if (measurementLease) onMeasurementLease?.(measurementLease.cleanup);
    transition = measurement ? null : createPreviewTransitionLease([preview], guard.signal);
    await measurementLease?.ready;
    await transition?.ready;
    assertPortableCopyCurrent(preview, guard, sourceFreshness);
    const serializationPreview = measurement?.root ?? preview;
    dimensionSemantics = createDimensionSemanticsContext(serializationPreview, preview, runtime);

    if (existing?.payload) {
      assertPortableCopyCurrent(preview, guard, sourceFreshness);
      const sourceMarkup = clipboardSourceMarkup(preview);
      const layoutSignature = await preparedLayoutSignatureWithYield(
        preview,
        runtime,
        yieldToBrowser,
        undefined,
        serializationPreview,
        dimensionSemantics
      );
      dimensionSemantics.refresh();
      const currentDimensionSignature = preparedDimensionSemanticsSignature(
        serializationPreview,
        runtime,
        dimensionSemantics
      );
      assertPortableCopyCurrent(preview, guard, sourceFreshness);
      const liveSourceMarkup = clipboardSourceMarkup(preview);
      const current = preparedPayloads.get(preview);
      if (
        current?.payload &&
        current.sourceMarkup === sourceMarkup &&
        liveSourceMarkup === sourceMarkup &&
        current.dimensionSignature === currentDimensionSignature &&
        current.layoutSignature === layoutSignature
      ) {
        measurement?.cleanup();
        measurement = null;
        transition?.cleanup();
        transition = null;
        return current;
      }
    }

    // A replacement is created only after write() has been invoked. Background
    // mode supplies the yielding serializer and preserves the latest stable
    // same-source payload as its failure fallback.
    assertPortableCopyCurrent(preview, guard, sourceFreshness);
    await yieldToBrowser();
    assertPortableCopyCurrent(preview, guard, sourceFreshness);
    const prepared = preparedClipboardPayload(
      preview,
      runtime,
      backgroundAssetCache,
      preparedPayloads,
      nextSequence,
      true,
      true,
      guard.signal,
      measurement,
      dimensionSemantics,
      transition,
      undefined,
      isCurrent
    );
    dimensionSemantics = null;
    transition = null;
    onPreparedPayload?.(preview, prepared);
    measurement = null;
    return prepared;
  } finally {
    measurement?.cleanup();
    transition?.cleanup();
    dimensionSemantics?.cleanup();
  }
}

function scheduleBackgroundPreparation(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  backgroundPreparations: BackgroundPreparationCache,
  nextSequence: () => number,
  state: BackgroundPreparationState,
  delay: number
): void {
  if (state.timer !== null) return;
  const browserWindow = runtime.document.defaultView;
  state.timer = browserWindow ? browserWindow.setTimeout(run, delay) : setTimeout(run, delay);

  function run(): void {
    state.timer = null;
    if (state.active || !state.requested) return;
    state.requested = false;

    const controller = new AbortController();
    state.activeController = controller;
    let operation: Promise<void>;
    try {
      operation = preparedClipboardPayload(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        nextSequence,
        true,
        true,
        controller.signal,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        () => {
          if (state.activeController === controller) controller.abort();
        }
      ).promise.then(() => undefined);
    } catch (error: unknown) {
      operation = Promise.reject(error);
    }

    state.active = operation;
    operation.then(
      () => finish(operation, true),
      (error: unknown) => finish(operation, false, error)
    );
  }

  function finish(operation: Promise<void>, success: boolean, error?: unknown): void {
    if (state.active !== operation) return;
    state.active = null;
    state.activeController = null;
    if (backgroundPreparations.get(preview) !== state) return;
    if (state.requested) {
      scheduleBackgroundPreparation(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        backgroundPreparations,
        nextSequence,
        state,
        BACKGROUND_PREPARATION_QUIET_DELAY_MS
      );
      return;
    }

    const waiters = state.waiters.splice(0);
    waiters.forEach((waiter) => {
      waiter.signal?.removeEventListener('abort', waiter.onAbort as EventListener);
      if (success) waiter.resolve();
      else waiter.reject(error);
    });
    if (!state.active && !state.requested && state.waiters.length === 0) {
      if (backgroundPreparations.get(preview) === state) {
        backgroundPreparations.delete(preview);
      }
    }
  }
}

function cancelBackgroundPreparationIfUnused(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundPreparations: BackgroundPreparationCache,
  state: BackgroundPreparationState
): void {
  if (state.waiters.length > 0) return;
  state.requested = false;
  if (state.timer !== null) {
    const browserWindow = runtime.document.defaultView;
    if (browserWindow) browserWindow.clearTimeout(state.timer as number);
    else clearTimeout(state.timer);
    state.timer = null;
  }
  state.activeController?.abort();
  if (!state.active && backgroundPreparations.get(preview) === state) {
    backgroundPreparations.delete(preview);
  }
}

function removeBackgroundPreparationWaiter(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundPreparations: BackgroundPreparationCache,
  state: BackgroundPreparationState,
  waiter: BackgroundPreparationWaiter
): void {
  const index = state.waiters.indexOf(waiter);
  if (index < 0) return;
  state.waiters.splice(index, 1);
  waiter.signal?.removeEventListener('abort', waiter.onAbort as EventListener);
  waiter.reject(backgroundPreparationAbortError());
  cancelBackgroundPreparationIfUnused(preview, runtime, backgroundPreparations, state);
}

function coalescedBackgroundPreparation(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  backgroundPreparations: BackgroundPreparationCache,
  nextSequence: () => number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return Promise.reject(backgroundPreparationAbortError());
  let state = backgroundPreparations.get(preview);
  if (!state) {
    state = { active: null, activeController: null, requested: false, timer: null, waiters: [] };
    backgroundPreparations.set(preview, state);
  }
  state.requested = true;
  let waiter!: BackgroundPreparationWaiter;
  const promise = new Promise<void>((resolve, reject) => {
    waiter = signal ? { reject, resolve, signal } : { reject, resolve };
    state?.waiters.push(waiter);
  });
  if (signal) {
    const onAbort = () =>
      removeBackgroundPreparationWaiter(
        preview,
        runtime,
        backgroundPreparations,
        state as BackgroundPreparationState,
        waiter
      );
    waiter.onAbort = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  if (state.requested && !state.active && state.timer === null) {
    scheduleBackgroundPreparation(
      preview,
      runtime,
      backgroundAssetCache,
      preparedPayloads,
      backgroundPreparations,
      nextSequence,
      state,
      0
    );
  }
  return promise;
}

function legacyCopy(html: string, runtime: BrowserWechatClipboardRuntime): boolean {
  const selection = runtime.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];
  const activeElement = runtime.document.activeElement as HTMLElement | null;
  const container = runtime.document.createElement('div');
  const range = runtime.document.createRange();
  const offset = runtime.pageOffset();
  container.className = 'easymde-copy-sandbox';
  container.setAttribute('contenteditable', 'true');
  container.innerHTML = html;
  runtime.document.body.appendChild(container);
  try {
    if (selection) {
      selection.removeAllRanges();
      range.selectNodeContents(container);
      selection.addRange(range);
    }
    try {
      return 'function' === typeof runtime.document.execCommand && runtime.document.execCommand('copy');
    } catch {
      return false;
    }
  } finally {
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((storedRange) => {
        selection.addRange(storedRange);
      });
    }
    container.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
    runtime.scrollTo(offset.x, offset.y);
  }
}

export function createBrowserWechatClipboard(runtime: BrowserWechatClipboardRuntime): WechatClipboardPort {
  const backgroundAssetCache: BackgroundAssetCache = new Map();
  const preparedPayloads: PreparedClipboardPayloadCache = new WeakMap();
  const backgroundPreparations: BackgroundPreparationCache = new WeakMap();
  let preparationSequence = 0;
  const nextPreparationSequence = (): number => {
    preparationSequence += 1;
    return preparationSequence;
  };

  return {
    rememberPreviewWidth(preview: HTMLElement): void {
      rememberPreviewWidthValue(preview);
    },
    async prepare(preview: HTMLElement, options: WechatClipboardPreparationOptions = {}): Promise<void> {
      if (!previewReady(preview)) return;
      if (options.background) {
        await coalescedBackgroundPreparation(
          preview,
          runtime,
          backgroundAssetCache,
          preparedPayloads,
          backgroundPreparations,
          nextPreparationSequence,
          options.signal
        );
        return;
      }
      await preparedClipboardPayload(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        nextPreparationSequence,
        true
      ).promise;
    },
    async copy(preview: HTMLElement, options: WechatClipboardCopyOptions = {}): Promise<WechatClipboardResult> {
      if (!previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }

      const pngConversionEnabled = true === options.pngConversionEnabled;
      const copyGuard: WechatClipboardCopyGuard = { isCurrent: options.isCurrent, signal: options.signal };
      const copyWasCancelled = (): boolean =>
        Boolean(options.signal?.aborted) || Boolean(options.isCurrent && !options.isCurrent());
      const requiresPreviewResolution = Boolean(
        options.resolvePreview && preview.querySelector('[data-easymde-preview-window-spacer]')
      );
      if (pngConversionEnabled && (!runtime.write || !runtime.clipboardItem)) {
        return { code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' };
      }
      if (
        pngConversionEnabled &&
        (!options.visualRasterizationPort ||
          !options.imageUploadPort ||
          !Number.isSafeInteger(options.postId) ||
          (options.postId as number) < 0 ||
          !Number.isSafeInteger(options.maxBytes) ||
          (options.maxBytes as number) < 1)
      ) {
        return { code: 'wechat-png-rasterization-failed', sideEffects: 'none', status: 'failed' };
      }
      if (copyWasCancelled()) {
        return pngConversionEnabled
          ? { code: 'wechat-png-rasterization-cancelled', sideEffects: 'none', status: 'failed' }
          : { code: 'wechat-copy-failed', status: 'failed' };
      }

      if (runtime.write && runtime.clipboardItem) {
        const readyPreview = requiresPreviewResolution
          ? Promise.resolve()
              .then(() => options.resolvePreview?.())
              .then((resolved) => {
                if (!resolved || !previewReady(resolved)) {
                  throw new Error('wechat-preview-unavailable');
                }
                return resolved;
              })
          : Promise.resolve(preview);
        const conversionState: WechatPngConversionState = { uploadsMayRemain: false };
        const conversionController = pngConversionEnabled ? new AbortController() : null;
        const propagateConversionAbort = () => conversionController?.abort();
        if (conversionController && options.signal) {
          if (options.signal.aborted) {
            conversionController.abort();
          } else {
            options.signal.addEventListener('abort', propagateConversionAbort, { once: true });
          }
        }
        const detachConversionAbort = () => {
          options.signal?.removeEventListener('abort', propagateConversionAbort);
        };
        const conversionSignal = conversionController?.signal ?? options.signal ?? new AbortController().signal;
        const conversionRasterizationPort = options.visualRasterizationPort as
          | WechatVisualRasterizationPort
          | undefined;
        const conversionImageUploadPort = options.imageUploadPort as ImageUploadPort | undefined;
        let startConversion: () => void = () => undefined;
        let conversionTerminated = false;
        let payloadPreview = preview;
        let disposeConversionFreshness = (): void => undefined;
        let disposeGeometryMeasurement = (): void => undefined;
        let disposeTaskGeometryLease = (): void => undefined;
        let disposeTransitionReadiness = (): void => undefined;
        let disposePortableMeasurement = (): void => undefined;
        let portablePreparation: { preview: HTMLElement; prepared: PreparedClipboardPayload } | null = null;
        const disposePortablePreparation = (): void => {
          const owned = portablePreparation;
          portablePreparation = null;
          if (!owned) return;
          const current = preparedPayloads.get(owned.preview);
          if (current !== owned.prepared || owned.prepared.payload) return;
          const recovery = owned.prepared.fallback;
          if (recovery) {
            preparedPayloads.set(owned.preview, {
              backgroundCancel: owned.prepared.backgroundCancel,
              fallback: recovery,
              dimensionSignature: recovery.dimensionSignature,
              layoutOwner: owned.prepared.layoutOwner,
              layoutSignature: recovery.layoutSignature,
              payload: recovery.payload,
              promise: Promise.resolve(recovery.payload),
              sequence: owned.prepared.sequence,
              sourceMarkup: recovery.sourceMarkup,
              recoveredAtLayoutSignature: owned.prepared.layoutSignature
            });
          } else {
            preparedPayloads.delete(owned.preview);
          }
        };
        const portableSourceFreshness: { current: ClipboardSourceFreshnessGuard | null } = { current: null };
        let portableFreshnessClosed = false;
        let resolvePortableFreshness: () => void = () => undefined;
        let rejectPortableFreshness: (error: unknown) => void = () => undefined;
        const portableFreshnessReady = new Promise<void>((resolve, reject) => {
          resolvePortableFreshness = resolve;
          rejectPortableFreshness = reject;
        });
        void portableFreshnessReady.catch(() => undefined);
        if (pngConversionEnabled) resolvePortableFreshness();
        const portableFreshness: ClipboardSourceFreshnessState = {
          current: () => (portableFreshnessClosed ? null : portableSourceFreshness.current),
          ready: portableFreshnessReady
        };
        const disposePortableFreshness = (): void => {
          if (portableFreshnessClosed) return;
          portableFreshnessClosed = true;
          portableSourceFreshness.current?.dispose();
          rejectPortableFreshness(new Error('wechat-copy-cancelled'));
        };
        const initializePortableFreshness = (resolvedPreview: HTMLElement): void => {
          if (portableFreshnessClosed) {
            rejectPortableFreshness(new Error('wechat-copy-cancelled'));
            return;
          }
          try {
            payloadPreview = resolvedPreview;
            rememberPreviewWidthValue(resolvedPreview);
            portableSourceFreshness.current = createClipboardSourceFreshnessGuard(resolvedPreview);
            resolvePortableFreshness();
          } catch (error: unknown) {
            rejectPortableFreshness(error);
          }
        };
        const portablePreparationIsCurrent = (): boolean =>
          !conversionTerminated && !copyWasCancelled() && null !== portableFreshness.current();
        const payload = pngConversionEnabled
          ? new Promise<SerializedClipboardPayload>((resolve, reject) => {
              startConversion = () => {
                void readyPreview
                  .then((resolvedPreview) => {
                    if (
                      conversionTerminated ||
                      conversionSignal.aborted ||
                      (options.isCurrent && !options.isCurrent())
                    ) {
                      throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                    }
                    payloadPreview = resolvedPreview;
                    rememberPreviewWidthValue(resolvedPreview);
                    const sourceFreshness = createClipboardSourceFreshnessGuard(resolvedPreview);
                    disposeConversionFreshness = sourceFreshness.dispose;
                    const geometryMeasurement = createPreviewMeasurementLease(
                      resolvedPreview,
                      runtime,
                      conversionSignal
                    );
                    disposeGeometryMeasurement = () => {
                      geometryMeasurement?.cleanup();
                      disposeGeometryMeasurement = () => undefined;
                    };
                    const taskGeometryLease = createTaskCheckboxGeometryLease(
                      resolvedPreview,
                      runtime,
                      conversionSignal,
                      geometryMeasurement
                    );
                    disposeTaskGeometryLease = () => {
                      taskGeometryLease?.cleanup();
                      disposeTaskGeometryLease = () => undefined;
                    };
                    const transitionReadiness = geometryMeasurement
                      ? null
                      : createPreviewTransitionLease([resolvedPreview], conversionSignal);
                    disposeTransitionReadiness = () => {
                      transitionReadiness?.cleanup();
                      disposeTransitionReadiness = () => undefined;
                    };
                    const serializationPreview = geometryMeasurement?.root ?? resolvedPreview;
                    return Promise.all([
                      geometryMeasurement?.ready ?? Promise.resolve(),
                      transitionReadiness?.ready ?? Promise.resolve(),
                      taskGeometryLease?.ready ?? Promise.resolve()
                    ])
                      .then(() => {
                        const conversionContext: WechatPngConversionContext = {
                          captureBoundary: serializationPreview,
                          isCurrent: () => (!options.isCurrent || options.isCurrent()) && sourceFreshness.isCurrent(),
                          imageUploadPort: conversionImageUploadPort as ImageUploadPort,
                          maxBytes: options.maxBytes as number,
                          mermaidAutoMarginSnapshots: new Map(),
                          mermaidCaptureChoiceSnapshots: new Map(),
                          mermaidResponsiveSnapshots: new Map(),
                          postId: options.postId as number,
                          rasterizationPort: conversionRasterizationPort as WechatVisualRasterizationPort,
                          scale: pngScale(resolvedPreview),
                          signal: conversionSignal,
                          state: conversionState
                        };
                        return waitForBrowserTask(runtime)
                          .then(async () => {
                            assertPngConversionCurrent(conversionContext);
                            const yieldToBrowser = createSerializationYield(runtime, true, conversionSignal);
                            if (!yieldToBrowser) throw new Error('wechat-copy-yield-unavailable');
                            const dimensionSemantics = createDimensionSemanticsContext(
                              serializationPreview,
                              resolvedPreview,
                              runtime
                            );
                            try {
                              dimensionSemantics.refresh();
                              const initialSignature = await preparedDimensionGeometrySignatureWithYield(
                                serializationPreview,
                                runtime,
                                yieldToBrowser,
                                conversionSignal,
                                dimensionSemantics
                              );
                              assertPngConversionCurrent(conversionContext);
                              const serialized = await serializeClipboardPayload(
                                serializationPreview,
                                runtime,
                                backgroundAssetCache,
                                yieldToBrowser,
                                conversionContext,
                                undefined,
                                resolvedPreview,
                                dimensionSemantics,
                                taskGeometryLease
                              );
                              assertPngConversionCurrent(conversionContext);
                              await geometryMeasurement?.wait();
                              await transitionReadiness?.wait();
                              await taskGeometryLease?.wait();
                              runWechatSyncTiming(
                                serializationPreview.ownerDocument.defaultView?.performance,
                                WECHAT_COPY_TIMING_NAMES.finalRawContextRefresh,
                                { mode: 'sync' },
                                () => dimensionSemantics.refresh()
                              );
                              const finalGeometryTiming = beginWechatTiming(
                                serializationPreview.ownerDocument.defaultView?.performance,
                                WECHAT_COPY_TIMING_NAMES.finalGeometry,
                                { mode: 'async' }
                              );
                              let finalSignature: string;
                              try {
                                finalSignature = await preparedDimensionGeometrySignatureWithYield(
                                  serializationPreview,
                                  runtime,
                                  yieldToBrowser,
                                  conversionSignal,
                                  dimensionSemantics
                                );
                                finalGeometryTiming.finish('success');
                              } catch (error: unknown) {
                                finalGeometryTiming.finish('error');
                                throw error;
                              }
                              const finalSourceTiming = beginWechatTiming(
                                serializationPreview.ownerDocument.defaultView?.performance,
                                WECHAT_COPY_TIMING_NAMES.finalSourceFreshness,
                                { mode: 'sync' }
                              );
                              try {
                                if (initialSignature !== finalSignature) {
                                  finalSourceTiming.finish('error');
                                  throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                }
                                const sourceFreshnessCurrent = sourceFreshness.finalize();
                                if (!sourceFreshnessCurrent) {
                                  finalSourceTiming.finish('error');
                                  throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                }
                                for (const [source, snapshot] of conversionContext.mermaidCaptureChoiceSnapshots) {
                                  if (
                                    !mermaidCaptureChoiceIsCurrent(
                                      source,
                                      runtime,
                                      conversionContext.captureBoundary,
                                      snapshot
                                    )
                                  ) {
                                    finalSourceTiming.finish('error');
                                    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                  }
                                }
                                for (const [
                                  source,
                                  capturedAutoMargins
                                ] of conversionContext.mermaidAutoMarginSnapshots) {
                                  if (mermaidSourceUsesAutoBlockMargins(source, runtime) !== capturedAutoMargins) {
                                    finalSourceTiming.finish('error');
                                    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                  }
                                }
                                for (const [source, snapshot] of conversionContext.mermaidResponsiveSnapshots) {
                                  if (
                                    !mermaidResponsiveSnapshotIsCurrent(
                                      source,
                                      runtime,
                                      conversionContext.captureBoundary,
                                      snapshot
                                    )
                                  ) {
                                    finalSourceTiming.finish('error');
                                    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                  }
                                }
                                finalSourceTiming.finish('success');
                              } catch (error: unknown) {
                                finalSourceTiming.finish('error');
                                throw error;
                              }
                              return serialized;
                            } finally {
                              dimensionSemantics.cleanup();
                            }
                          })
                          .finally(() => {
                            conversionContext.mermaidAutoMarginSnapshots.clear();
                            conversionContext.mermaidCaptureChoiceSnapshots.clear();
                            conversionContext.mermaidResponsiveSnapshots.clear();
                          });
                      })
                      .finally(() => {
                        disposeGeometryMeasurement();
                        disposeTaskGeometryLease();
                        disposeTransitionReadiness();
                        sourceFreshness.dispose();
                        disposeConversionFreshness = () => undefined;
                      });
                  })
                  .then(resolve, reject);
              };
            })
          : requiresPreviewResolution
            ? readyPreview.then((resolvedPreview) => {
                payloadPreview = resolvedPreview;
                return preparedClipboardPayloadAfterWrite(
                  resolvedPreview,
                  runtime,
                  backgroundAssetCache,
                  preparedPayloads,
                  nextPreparationSequence,
                  copyGuard,
                  portableFreshness,
                  (cleanup) => {
                    disposePortableMeasurement = cleanup;
                  },
                  (preparedPreview, prepared) => {
                    portablePreparation = { preview: preparedPreview, prepared };
                  },
                  portablePreparationIsCurrent
                ).then((prepared) => prepared.promise);
              })
            : preparedClipboardPayloadAfterWrite(
                preview,
                runtime,
                backgroundAssetCache,
                preparedPayloads,
                nextPreparationSequence,
                copyGuard,
                portableFreshness,
                (cleanup) => {
                  disposePortableMeasurement = cleanup;
                },
                (preparedPreview, prepared) => {
                  portablePreparation = { preview: preparedPreview, prepared };
                },
                portablePreparationIsCurrent
              ).then((prepared) => prepared.promise);
        let rejectDeferredPayload: ((error: unknown) => void) | null = null;
        const deferredPayloadFailure = new Promise<never>((_resolve, reject) => {
          rejectDeferredPayload = reject;
        });
        const abortDeferredPayload = (): void => {
          rejectDeferredPayload?.(new Error('wechat-copy-cancelled'));
        };
        const detachCopyAbort = (): void => {
          options.signal?.removeEventListener('abort', abortDeferredPayload);
        };
        if (options.signal) {
          if (options.signal.aborted) {
            abortDeferredPayload();
          } else {
            options.signal.addEventListener('abort', abortDeferredPayload, { once: true });
          }
        }
        const assertDeferredBlobCurrent = (): void => {
          if (pngConversionEnabled) {
            assertCopyPreviewCurrent(payloadPreview, copyGuard);
            return;
          }
          assertPortableCopyCurrent(payloadPreview, copyGuard, portableFreshness);
        };
        const gateBlob = (source: Promise<Blob>): Promise<Blob> =>
          Promise.race([
            source.then((blob) => {
              assertDeferredBlobCurrent();
              return blob;
            }),
            deferredPayloadFailure
          ]);
        const htmlBlob = gateBlob(payload.then(({ html }) => new runtime.blob([html], { type: 'text/html' })));
        const textBlob = gateBlob(payload.then(({ text }) => new runtime.blob([text], { type: 'text/plain' })));
        const preparedBeforeWrite =
          !pngConversionEnabled && !requiresPreviewResolution ? preparedPayloads.get(preview) : null;
        const pendingFallback =
          preparedBeforeWrite && !preparedBeforeWrite.payload ? preparedBeforeWrite.fallback : null;
        const observeBlobRejections = (): void => {
          if (htmlBlob instanceof Promise) void htmlBlob.catch(() => undefined);
          if (textBlob instanceof Promise) void textBlob.catch(() => undefined);
        };
        const fallbackAfterSynchronousModernFailure = (): WechatClipboardResult => {
          if (pngConversionEnabled) {
            return { code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' };
          }
          if (requiresPreviewResolution) {
            return { code: 'wechat-copy-failed', status: 'failed' };
          }
          // ClipboardItem construction and write invocation still happen in
          // the originating click task. A payload prepared before that task
          // may therefore use the activation-safe compatibility path.
          let measurement = createPreviewMeasurementLease(preview, runtime);
          let transition: WechatPreviewTransitionLease | null = null;
          let taskGeometryLease: TaskCheckboxGeometryLease | null = null;
          let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
          try {
            if (measurement && !measurement.isReady()) {
              const retry = preparedClipboardPayload(
                preview,
                runtime,
                backgroundAssetCache,
                preparedPayloads,
                nextPreparationSequence,
                true,
                false,
                undefined,
                measurement
              );
              void retry.promise.catch(() => undefined);
              measurement = null;
              return { code: 'wechat-copy-failed', status: 'failed' };
            }
            transition = measurement ? null : createPreviewTransitionLease([preview]);
            if (transition && !transition.isReady()) {
              return { code: 'wechat-copy-failed', status: 'failed' };
            }
            taskGeometryLease = createTaskCheckboxGeometryLease(preview, runtime, undefined, measurement);
            if (taskGeometryLease && !taskGeometryLease.isReady()) {
              return { code: 'wechat-copy-failed', status: 'failed' };
            }
            const serializationPreview = measurement?.root ?? preview;
            dimensionSemantics = createDimensionSemanticsContext(serializationPreview, preview, runtime);
            const currentMarkup = clipboardSourceMarkup(preview);
            const currentLayoutSignature = preparedLayoutSignature(
              preview,
              runtime,
              serializationPreview,
              dimensionSemantics
            );
            dimensionSemantics.refresh();
            const currentDimensionSignature = preparedDimensionSemanticsSignature(
              serializationPreview,
              runtime,
              dimensionSemantics
            );
            const prepared = preparedPayloads.get(preview);
            const preparedFallback =
              prepared?.payload &&
              prepared.sourceMarkup === currentMarkup &&
              prepared.dimensionSignature === currentDimensionSignature &&
              prepared.layoutSignature === currentLayoutSignature
                ? prepared.payload
                : prepared?.payload &&
                    prepared.recoveredAtLayoutSignature === currentLayoutSignature &&
                    prepared.fallback?.sourceMarkup === currentMarkup &&
                    prepared.fallback?.dimensionSignature === currentDimensionSignature
                  ? prepared.payload
                  : !prepared?.payload &&
                      prepared?.fallback?.sourceMarkup === currentMarkup &&
                      prepared.fallback?.dimensionSignature === currentDimensionSignature
                    ? prepared.fallback.payload
                    : null;
            // If no background payload has completed yet, the compatibility
            // path gets one synchronous attempt in the click task. A remote
            // theme image deliberately returns null here; claiming success
            // without its materialized asset would produce a partial paste.
            const fallback =
              preparedFallback ??
              (pendingFallback?.sourceMarkup === currentMarkup &&
              pendingFallback.dimensionSignature === currentDimensionSignature
                ? pendingFallback.payload
                : null) ??
              serializeClipboardPayloadSynchronously(
                serializationPreview,
                runtime,
                preview,
                dimensionSemantics,
                taskGeometryLease
              );
            if (fallback && legacyCopy(fallback.html, runtime)) {
              return { method: 'legacy', status: 'copied' };
            }
          } finally {
            dimensionSemantics?.cleanup();
            transition?.cleanup();
            taskGeometryLease?.cleanup();
            measurement?.cleanup();
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        };
        let writePromise: Promise<void>;
        try {
          const item = new runtime.clipboardItem({
            // ClipboardItem accepts PromiseLike<Blob> values. Starting the
            // write before theme-image fetches finish keeps the click's
            // transient user activation attached to the operation.
            'text/html': htmlBlob,
            'text/plain': textBlob
          } as unknown as Record<string, Blob>);
          writePromise = Promise.resolve(runtime.write([item]));
        } catch {
          conversionController?.abort();
          disposePortablePreparation();
          disposePortableMeasurement();
          disposePortableMeasurement = () => undefined;
          disposePortableFreshness();
          disposeConversionFreshness();
          detachConversionAbort();
          detachCopyAbort();
          observeBlobRejections();
          if (copyWasCancelled()) {
            return pngConversionEnabled
              ? { code: 'wechat-png-rasterization-cancelled', sideEffects: 'none', status: 'failed' }
              : { code: 'wechat-copy-failed', status: 'failed' };
          }
          return fallbackAfterSynchronousModernFailure();
        }
        if (pngConversionEnabled) {
          startConversion?.();
        } else if (requiresPreviewResolution) {
          void readyPreview.then(initializePortableFreshness, (error: unknown) => rejectPortableFreshness(error));
        } else {
          initializePortableFreshness(preview);
        }
        try {
          const writeResult = writePromise.then(
            () => ({ error: null }),
            (error: unknown) => ({ error })
          );
          const writeFailure = writeResult.then(({ error }) => {
            if (null !== error) throw error;
            return new Promise<never>(() => undefined);
          });
          if (pngConversionEnabled) {
            const completion = Promise.all([payload, htmlBlob, textBlob, writeResult]);
            const completed = await withTimeout(
              Promise.race([completion, writeFailure]),
              WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
              'wechat-png-transaction-timeout'
            );
            const { error } = completed[3];
            if (null !== error) throw error;
          } else {
            // write() must begin during the activation task, but the browser
            // cannot finish its Clipboard commit until it consumes both
            // deferred Blobs. Bound that preparation transaction separately;
            // start the real commit timeout only once the payload is ready.
            const payloadReady = withTimeout(
              Promise.all([payload, htmlBlob, textBlob]),
              WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
              'wechat-clipboard-preparation-timeout'
            );
            await Promise.race([
              payloadReady.then(async () => {
                const { error } = await withTimeout(writeResult, CLIPBOARD_COMMIT_TIMEOUT_MS);
                if (null !== error) throw error;
              }),
              writeFailure
            ]);
          }
          if (!pngConversionEnabled) {
            const sourceGuard = portableFreshness.current();
            assertCopyPreviewCurrent(payloadPreview, copyGuard);
            if (!sourceGuard?.finalize()) {
              throw new Error('wechat-copy-stale');
            }
            assertCopyPreviewCurrent(payloadPreview, copyGuard);
          }
          return { method: 'clipboard', status: 'copied' };
        } catch (error: unknown) {
          // A rejected modern write resumes after an await and cannot safely
          // enter the activation-sensitive legacy path. Report the failure
          // instead of attempting an asynchronous compatibility fallback.
          observeBlobRejections();
          const rejectPayload = rejectDeferredPayload as ((error: unknown) => void) | null;
          rejectPayload?.(error);
          if (pngConversionEnabled) {
            conversionController?.abort();
            if (error instanceof WechatPngConversionError) {
              logPngFailureDiagnostic(error);
            }
            return {
              code:
                error instanceof WechatPngConversionError
                  ? error.code
                  : copyWasCancelled()
                    ? 'wechat-png-rasterization-cancelled'
                    : error instanceof Error && 'wechat-png-transaction-timeout' === error.message
                      ? 'wechat-png-transaction-timeout'
                      : 'wechat-png-clipboard-failed',
              sideEffects: conversionState.uploadsMayRemain ? 'uploads-may-remain' : 'none',
              status: 'failed'
            };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        } finally {
          conversionTerminated = true;
          disposePortablePreparation();
          disposeTaskGeometryLease();
          disposeGeometryMeasurement();
          disposeTransitionReadiness();
          disposePortableMeasurement();
          disposePortableMeasurement = () => undefined;
          disposePortableFreshness();
          disposeConversionFreshness();
          detachConversionAbort();
          detachCopyAbort();
        }
      }

      if (pngConversionEnabled) {
        return { code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' };
      }

      if (requiresPreviewResolution) {
        return { code: 'wechat-copy-failed', status: 'failed' };
      }

      // Legacy execCommand must run synchronously in the originating click
      // task. Preview preparation owns the asynchronous serialization; a
      // click before it resolves is a truthful failure and can be retried once
      // the next stable Preview notification has completed preparation.
      let measurement = createPreviewMeasurementLease(preview, runtime);
      let transition: WechatPreviewTransitionLease | null = null;
      let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
      try {
        if (measurement && !measurement.isReady()) {
          const retry = preparedClipboardPayload(
            preview,
            runtime,
            backgroundAssetCache,
            preparedPayloads,
            nextPreparationSequence,
            true,
            false,
            undefined,
            measurement
          );
          void retry.promise.catch(() => undefined);
          measurement = null;
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        transition = measurement ? null : createPreviewTransitionLease([preview]);
        if (transition && !transition.isReady()) {
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        const serializationPreview = measurement?.root ?? preview;
        dimensionSemantics = createDimensionSemanticsContext(serializationPreview, preview, runtime);
        const prepared = preparedPayloads.get(preview);
        const currentMarkup = clipboardSourceMarkup(preview);
        const currentLayoutSignature = preparedLayoutSignature(
          preview,
          runtime,
          serializationPreview,
          dimensionSemantics
        );
        dimensionSemantics.refresh();
        const currentDimensionSignature = preparedDimensionSemanticsSignature(
          serializationPreview,
          runtime,
          dimensionSemantics
        );
        const payload =
          prepared?.payload &&
          prepared.sourceMarkup === currentMarkup &&
          prepared.dimensionSignature === currentDimensionSignature &&
          prepared.layoutSignature === currentLayoutSignature
            ? prepared.payload
            : prepared?.payload &&
                prepared.recoveredAtLayoutSignature === currentLayoutSignature &&
                prepared.fallback?.sourceMarkup === currentMarkup &&
                prepared.fallback?.dimensionSignature === currentDimensionSignature
              ? prepared.payload
              : prepared &&
                  prepared.payload === null &&
                  prepared.fallback &&
                  prepared.fallback.sourceMarkup === currentMarkup &&
                  prepared.fallback.dimensionSignature === currentDimensionSignature
                ? prepared.fallback.payload
                : null;
        if (!payload) {
          const current = preparedPayloads.get(preview);
          const preparationIsPending = Boolean(current && !current.payload);
          if (!preparationIsPending) {
            const retry = preparedClipboardPayload(
              preview,
              runtime,
              backgroundAssetCache,
              preparedPayloads,
              nextPreparationSequence,
              true,
              false,
              undefined,
              measurement,
              dimensionSemantics,
              transition
            );
            void retry.promise.catch(() => undefined);
            dimensionSemantics = null;
            measurement = null;
            transition = null;
            return { code: 'wechat-copy-failed', status: 'failed' };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        if (legacyCopy(payload.html, runtime)) {
          return { method: 'legacy', status: 'copied' };
        }
        return { code: 'wechat-clipboard-unsupported', status: 'failed' };
      } finally {
        dimensionSemantics?.cleanup();
        transition?.cleanup();
        measurement?.cleanup();
      }
    }
  };
}
