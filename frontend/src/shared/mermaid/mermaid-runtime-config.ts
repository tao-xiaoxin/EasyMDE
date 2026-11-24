export type MermaidInitializationOptions = Readonly<{
  startOnLoad: boolean;
  securityLevel: string;
  theme: string;
  fontFamily: string;
  fontSize: number;
  flowchart: Readonly<{ diagramPadding: number }>;
  gantt: Readonly<{ useMaxWidth: boolean; useWidth: number }>;
  themeCSS: string;
}>;

export type MermaidInitializableRuntime = Readonly<{
  initialize?: (options: MermaidInitializationOptions) => void;
}>;

export const MERMAID_LABEL_FONT_FAMILY =
  '"trebuchet ms", verdana, arial, sans-serif';

export const MERMAID_LABEL_GEOMETRY_CSS = `
& {
  letter-spacing: normal;
  word-spacing: normal;
}

.node .label,
.node .label *,
.edgeLabel,
.edgeLabel *,
foreignObject > div,
foreignObject > div * {
  box-sizing: border-box !important;
  font-family: ${MERMAID_LABEL_FONT_FAMILY} !important;
  font-size: 16px !important;
  font-weight: 400 !important;
  line-height: 20px !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
}

foreignObject > div {
  display: table-cell !important;
}`;

const INITIALIZED_MERMAID_RUNTIMES_SYMBOL = Symbol.for(
  'easymde.initializedMermaidRuntimes'
);

type GlobalWithMermaidRegistry = typeof globalThis & {
  [INITIALIZED_MERMAID_RUNTIMES_SYMBOL]?: WeakSet<object>;
};

function resolveInitializedMermaidRuntimes(): WeakSet<object> {
  try {
    const scope = globalThis as GlobalWithMermaidRegistry;
    const existing = scope[INITIALIZED_MERMAID_RUNTIMES_SYMBOL];
    if (existing instanceof WeakSet) {
      return existing;
    }
    const created = new WeakSet<object>();
    scope[INITIALIZED_MERMAID_RUNTIMES_SYMBOL] = created;
    return created;
  } catch {
    return new WeakSet<object>();
  }
}

export const initializedMermaidRuntimes: WeakSet<object> =
  resolveInitializedMermaidRuntimes();

export function createMermaidInitializationOptions(): MermaidInitializationOptions {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: MERMAID_LABEL_FONT_FAMILY,
    fontSize: 16,
    flowchart: {
      diagramPadding: 12
    },
    gantt: {
      useMaxWidth: true,
      useWidth: 1200
    },
    themeCSS: MERMAID_LABEL_GEOMETRY_CSS
  };
}

export function initializeMermaidRuntime(
  mermaid: MermaidInitializableRuntime,
  options: Readonly<{ swallowErrors?: boolean }> = {}
): void {
  if (initializedMermaidRuntimes.has(mermaid)) return;
  if ('function' !== typeof mermaid.initialize) {
    initializedMermaidRuntimes.add(mermaid);
    return;
  }
  if (options.swallowErrors) {
    initializedMermaidRuntimes.add(mermaid);
    try {
      mermaid.initialize(createMermaidInitializationOptions());
    } catch {
      // Minimal runtimes or test mocks may reject re-initialization.
    }
    return;
  }
  mermaid.initialize(createMermaidInitializationOptions());
  initializedMermaidRuntimes.add(mermaid);
}

type MermaidLayoutViewBox = Readonly<{
  height: number;
  width: number;
}>;

const INTRINSIC_MERMAID_LAYOUT_ROLES = new Set([
  'gantt',
  'sequence',
  'timeline'
]);

function isSvgRootElement(
  element: Element | undefined,
  ownerDocument: Document
): element is SVGSVGElement {
  if (!element) return false;
  const viewSvgCtor = ownerDocument.defaultView?.SVGSVGElement;
  if ('function' === typeof viewSvgCtor && element instanceof viewSvgCtor) {
    return true;
  }
  return 'undefined' !== typeof SVGSVGElement && element instanceof SVGSVGElement;
}

function mermaidLayoutViewBox(source: SVGSVGElement): MermaidLayoutViewBox | null {
  const values = source.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
  const width = values[2];
  const height = values[3];
  if (
    4 !== values.length
    || values.some((value) => !Number.isFinite(value))
    || undefined === width
    || undefined === height
    || width <= 0
    || height <= 0
  ) return null;
  return { height, width };
}

export function markIntrinsicMermaidLayout(
  container: HTMLElement
): void {
  delete container.dataset.easymdeMermaidLayout;
  if (1 !== container.children.length) return;
  const svg = container.children[0];
  if (!isSvgRootElement(svg, container.ownerDocument)) return;
  const role = svg.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (!role || !INTRINSIC_MERMAID_LAYOUT_ROLES.has(role)) return;
  const viewBox = mermaidLayoutViewBox(svg);
  if (!viewBox) return;
  container.dataset.easymdeMermaidLayout = role;
  svg.style.setProperty('width', `${viewBox.width}px`);
  svg.style.setProperty('height', 'auto');
}
