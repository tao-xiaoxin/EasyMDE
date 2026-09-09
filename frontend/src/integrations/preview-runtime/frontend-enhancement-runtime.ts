export type FrontendEnhancementConfig = unknown;

export type FrontendEnhancementScheduler = Readonly<{
  now: () => number;
  yield: () => Promise<void>;
}>;

export type FrontendEnhancementControl = Readonly<{
  isCurrent?: () => boolean;
  scheduler?: FrontendEnhancementScheduler;
  signal?: AbortSignal;
}>;

export type FrontendEnhancementRuntimeOptions = Readonly<{
  control?: FrontendEnhancementControl;
  scheduler?: FrontendEnhancementScheduler;
}>;

type HighlightRuntime = Readonly<{
  highlightElement: (code: HTMLElement) => void;
}>;

type KatexRuntime = Readonly<{
  render: (
    tex: string,
    element: HTMLElement,
    options: Readonly<{ displayMode: boolean; throwOnError: boolean; strict: string }>
  ) => void;
}>;

type MermaidRenderResult = Readonly<{ svg: string }>;

type MermaidInitializationOptions = Readonly<{
  startOnLoad: boolean;
  securityLevel: string;
  theme: string;
  fontFamily: string;
  fontSize: number;
  flowchart: Readonly<{ diagramPadding: number }>;
  themeCSS: string;
}>;

type MermaidRuntime = Readonly<{
  initialize: (options: MermaidInitializationOptions) => void;
  render: (id: string, source: string) => Promise<MermaidRenderResult>;
}>;

export type FrontendEnhancementWindow = Window & {
  EasyMDEEnhancements?: Readonly<{
    enhance: (
      root: ParentNode,
      config: FrontendEnhancementConfig,
      control?: FrontendEnhancementControl
    ) => Promise<void>;
    syncCodeFrameBackgrounds: (root: ParentNode) => void;
  }>;
  EasyMDEFrontendConfig?: FrontendEnhancementConfig;
  EasyMDEMathRenderer?: Readonly<{
    render: (
      root: ParentNode,
      config: FrontendEnhancementConfig,
      control?: FrontendEnhancementControl
    ) => void | Promise<void>;
  }>;
  EasyMDEMermaidRenderer?: Readonly<{
    render: (
      root: ParentNode,
      config: FrontendEnhancementConfig,
      control?: FrontendEnhancementControl
    ) => Promise<void>;
  }>;
  hljs?: HighlightRuntime;
  katex?: KatexRuntime;
  mermaid?: MermaidRuntime;
};

let mermaidRenderIndex = 0;

const MERMAID_LABEL_FONT_FAMILY = '"trebuchet ms", verdana, arial, sans-serif';
const MERMAID_LABEL_GEOMETRY_CSS = `
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
  letter-spacing: normal !important;
  word-spacing: normal !important;
  white-space: nowrap !important;
  margin: 0 !important;
  padding: 0 !important;
}

foreignObject > div {
  display: table-cell !important;
}`;

const ENHANCEMENT_SLICE_BUDGET_MS = 8;

function enhancementIsCurrent(
  control: FrontendEnhancementControl | undefined
): boolean {
  return !control?.signal?.aborted && (control?.isCurrent?.() ?? true);
}

function defaultEnhancementScheduler(
  windowRef: FrontendEnhancementWindow
): FrontendEnhancementScheduler {
  return {
    now: () => windowRef.performance?.now() ?? Date.now(),
    yield: () => new Promise<void>((resolve) => {
      windowRef.setTimeout(resolve, 0);
    })
  };
}

function enhancementRuntimeOptions(
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Readonly<{
  control: FrontendEnhancementControl;
  scheduler: FrontendEnhancementScheduler;
}> {
  const scheduler = options.scheduler
    ?? options.control?.scheduler
    ?? defaultEnhancementScheduler(windowRef);
  const control: FrontendEnhancementControl = {
    ...(options.control ?? {}),
    scheduler
  };
  return { control, scheduler };
}

async function runScheduled<T>(
  items: ReadonlyArray<T>,
  work: (item: T) => void | Promise<void>,
  scheduler: FrontendEnhancementScheduler,
  control: FrontendEnhancementControl
): Promise<boolean> {
  let sliceStartedAt = scheduler.now();
  for (let index = 0; index < items.length; index += 1) {
    if (!enhancementIsCurrent(control)) return false;
    const item = items[index];
    if (undefined === item) return false;
    await work(item);
    const hasMore = index < items.length - 1;
    const elapsed = scheduler.now() - sliceStartedAt;
    if (hasMore && elapsed >= ENHANCEMENT_SLICE_BUDGET_MS) {
      await scheduler.yield();
      if (!enhancementIsCurrent(control)) return false;
      sliceStartedAt = scheduler.now();
    }
  }
  return enhancementIsCurrent(control);
}

function property(value: unknown, key: string): unknown {
  if (
    !value
    || ('object' !== typeof value && 'function' !== typeof value)
  ) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function featureEnabled(config: FrontendEnhancementConfig, key: string): boolean {
  const features = property(config, 'features');
  return !features || property(features, key) !== false;
}

function isMermaidCode(element: Element): boolean {
  return [...element.classList].some(
    (className) => 'language-mermaid' === className.toLowerCase()
  );
}

function stringValue(
  config: FrontendEnhancementConfig,
  key: string,
  fallback: string
): string {
  const strings = property(config, 'strings');
  const value = property(strings, key);
  return value ? String(value) : fallback || '';
}

function normalizeMathTex(tex: string): string {
  if (!tex) return tex;

  tex = tex
    .replace(/(^|[^A-Za-z\\])(begin|end)(?=\s*\{)/g, '$1\\$2')
    .replace(/(^|[^A-Za-z\\])(frac|dfrac|tfrac|binom|sqrt)(?=\s*\{)/g, '$1\\$2')
    .replace(/(^|[^A-Za-z\\])(left|right)(?=\s*(?:[()[\]{}|.]|\\[{}]))/g, '$1\\$2')
    .replace(/(^|[^A-Za-z\\])(log|ln|exp|lim|sin|cos|tan|cot|sec|csc|min|max|sup|inf)(?![A-Za-z])/g, '$1\\$2')
    .replace(/(^|[^A-Za-z\\])(cdots|ldots|dots|vdots|ddots|cdot|times|div|pm|mp|leq|geq|neq|approx|infty)(?![A-Za-z])/g, '$1\\$2');

  return tex.replace(/\\begin\{([A-Za-z]*matrix|array)\}([\s\S]*?)\\end\{\1\}/g, (_match, environment: string, body: string) =>
    `\\begin{${environment}}${body.replace(/(^|[^\\])\\(?![\\A-Za-z{])/g, '$1\\\\')}\\end{${environment}}`
  );
}

function mathText(element: HTMLElement): string {
  const value = (element.textContent || '').trim();

  if ('$$' === value.slice(0, 2) && '$$' === value.slice(-2)) {
    return normalizeMathTex(value.slice(2, -2).trim());
  }

  if ('\\(' === value.slice(0, 2) && '\\)' === value.slice(-2)) {
    return normalizeMathTex(value.slice(2, -2).trim());
  }

  return normalizeMathTex(value);
}

export function syncCodeFrameBackgrounds(
  root: ParentNode,
  windowRef: FrontendEnhancementWindow
): void {
  root.querySelectorAll('pre > code.hljs').forEach((element) => {
    syncCodeFrameBackground(element, windowRef);
  });
}

function syncCodeFrameBackground(
  element: Element,
  windowRef: FrontendEnhancementWindow
): void {
  if (!(element instanceof HTMLElement) || !element.parentElement) {
    throw new Error('easymde-code-frame-parent-missing');
  }
  if (isMermaidCode(element)) {
    element.parentElement.setAttribute('data-easymde-mermaid-fallback', '1');
  }
  element.parentElement.style.setProperty(
    '--easymde-code-frame-background',
    windowRef.getComputedStyle(element).backgroundColor
  );
}

function syncCodeLineNumberGutter(
  element: Element,
  windowRef: FrontendEnhancementWindow
): void {
  if (!(element instanceof HTMLElement) || !element.parentElement) {
    throw new Error('easymde-code-line-number-parent-missing');
  }

  const pre = element.parentElement;
  const existingGutters = [...pre.children].filter((child) =>
    child.classList.contains('easymde-code-line-number-gutter')
  );
  const enabled = !isMermaidCode(element)
    && Boolean(element.closest('.easymde-code-line-numbers'));

  if (!enabled) {
    existingGutters.forEach((gutter) => {
      gutter.remove();
    });
    pre.classList.remove('easymde-code-with-line-numbers');
    pre.style.removeProperty('--easymde-code-line-number-gutter-width');
    pre.style.removeProperty('--easymde-code-line-number-color');
    return;
  }

  const codeText = element.textContent || '';
  const lineCount = Math.max(
    1,
    codeText.split('\n').length - (codeText.endsWith('\n') ? 1 : 0)
  );
  const gutter = existingGutters.shift() ?? element.ownerDocument.createElement('span');
  const lines = element.ownerDocument.createDocumentFragment();
  existingGutters.forEach((duplicate) => {
    duplicate.remove();
  });
  gutter.className = 'easymde-code-line-number-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < lineCount; index += 1) {
    lines.append(element.ownerDocument.createElement('span'));
  }
  gutter.replaceChildren(lines);
  pre.classList.add('easymde-code-with-line-numbers');
  pre.style.setProperty(
    '--easymde-code-line-number-gutter-width',
    `${Math.max(2, String(lineCount).length)}ch`
  );
  pre.style.setProperty(
    '--easymde-code-line-number-color',
    windowRef.getComputedStyle(element).color
  );
  pre.insertBefore(gutter, element);
}

async function highlightCode(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  scheduler: FrontendEnhancementScheduler,
  control: FrontendEnhancementControl
): Promise<boolean> {
  const syntaxHighlight = featureEnabled(config, 'syntaxHighlight');
  const codeBlocks = [...root.querySelectorAll('pre > code')].filter(
    (element) => !isMermaidCode(element) || !featureEnabled(config, 'mermaid')
  );

  if (!await runScheduled(
    codeBlocks,
    (element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('easymde-code-element-invalid');
      }

      element.classList.add('hljs');
      if (
        isMermaidCode(element)
        || !syntaxHighlight
        || !windowRef.hljs
        || element.dataset.easymdeHighlighted
      ) return;

      windowRef.hljs.highlightElement(element);
      element.dataset.easymdeHighlighted = '1';
    },
    scheduler,
    control
  )) return false;
  if (!await runScheduled(
    [...root.querySelectorAll('pre > code')],
    (element) => syncCodeLineNumberGutter(element, windowRef),
    scheduler,
    control
  )) return false;
  return runScheduled(
    [...root.querySelectorAll('pre > code.hljs')],
    (element) => syncCodeFrameBackground(element, windowRef),
    scheduler,
    control
  );
}

async function markMermaidAssetFailure(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  scheduler: FrontendEnhancementScheduler,
  control: FrontendEnhancementControl
): Promise<boolean> {
  const error = property(property(config, 'assetErrors'), 'mermaid')
    ?? property(property(config, 'features'), 'mermaidAssetError');
  if ('string' !== typeof error || !error) return true;

  return runScheduled(
    [...root.querySelectorAll('pre > code')],
    (element) => {
      if (!isMermaidCode(element)) return;
      if (!(element instanceof HTMLElement) || !element.parentElement) {
        throw new Error('easymde-mermaid-parent-missing');
      }
      element.parentElement.setAttribute('data-easymde-mermaid-error', error);
    },
    scheduler,
    control
  );
}

export function renderMathContent(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Promise<void> {
  if (!featureEnabled(config, 'math')) return Promise.resolve();
  const katex = windowRef.katex;
  if (!katex) return Promise.resolve();
  const { control, scheduler } = enhancementRuntimeOptions(windowRef, options);
  const mathNodes = [
    ...root.querySelectorAll('.easymde-math:not([data-easymde-rendered])')
  ];
  return runScheduled(
    mathNodes,
    (element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('easymde-math-element-invalid');
      }
      const displayMode = element.classList.contains('easymde-math-block');

      try {
        katex.render(mathText(element), element, {
          displayMode,
          throwOnError: false,
          strict: 'warn'
        });
        element.dataset.easymdeRendered = '1';
      } catch {
        element.classList.add('easymde-render-error');
        element.dataset.easymdeRendered = '1';
      }
    },
    scheduler,
    control
  ).then(() => undefined);
}

function initializeMermaid(windowRef: FrontendEnhancementWindow): boolean {
  if (!windowRef.mermaid) return false;

  windowRef.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: MERMAID_LABEL_FONT_FAMILY,
    fontSize: 16,
    flowchart: {
      diagramPadding: 12
    },
    themeCSS: MERMAID_LABEL_GEOMETRY_CSS
  });

  return true;
}

export function renderMermaidContent(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Promise<void> {
  const mermaid = windowRef.mermaid;
  if (!featureEnabled(config, 'mermaid') || !mermaid || !initializeMermaid(windowRef)) {
    return Promise.resolve();
  }
  const { control, scheduler } = enhancementRuntimeOptions(windowRef, options);
  const mermaidNodes = [
    ...root.querySelectorAll('pre > code:not([data-easymde-rendered])')
  ].filter((element) => isMermaidCode(element));

  return runScheduled(
    mermaidNodes,
    async (element) => {
      if (!(element instanceof HTMLElement) || !element.parentElement) {
        throw new Error('easymde-mermaid-parent-missing');
      }
      const pre = element.parentElement;
      const source = element.textContent || '';
      const container = element.ownerDocument.createElement('div');
      const renderId = `easymde-mermaid-${Date.now()}-${++mermaidRenderIndex}`;

      container.className = 'easymde-mermaid';
      element.dataset.easymdeRendered = '1';

      try {
        const result = await mermaid.render(renderId, source);
        if (!enhancementIsCurrent(control) || !pre.parentNode) return;
        container.innerHTML = result.svg;
        pre.parentNode.replaceChild(container, pre);
      } catch {
        if (!enhancementIsCurrent(control)) return;
        pre.classList.add('easymde-render-error');
        pre.setAttribute(
          'data-easymde-error',
          stringValue(config, 'renderingFailed', '')
        );
      }
    },
    scheduler,
    control
  ).then(() => undefined);
}

export function enhanceFrontendContent(
  root: ParentNode | null,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Promise<void> {
  if (!root) return Promise.resolve();
  const { control, scheduler } = enhancementRuntimeOptions(windowRef, options);
  return highlightCode(root, config, windowRef, scheduler, control)
    .then((highlighted) => {
      if (!highlighted) return false;
      return markMermaidAssetFailure(root, config, scheduler, control);
    })
    .then((marked) => {
      if (!marked || !enhancementIsCurrent(control)) return false;
      if (!windowRef.EasyMDEMathRenderer) return true;
      return Promise.resolve(
        windowRef.EasyMDEMathRenderer.render(root, config, control)
      ).then(() => enhancementIsCurrent(control));
    })
    .then((mathReady) => {
      if (!mathReady || !windowRef.EasyMDEMermaidRenderer) return;
      return windowRef.EasyMDEMermaidRenderer.render(root, config, control)
        .then(() => undefined);
    });
}
