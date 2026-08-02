export type FrontendEnhancementConfig = unknown;

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

type MermaidRuntime = Readonly<{
  initialize: (options: Readonly<{ startOnLoad: boolean; securityLevel: string; theme: string }>) => void;
  render: (id: string, source: string) => Promise<MermaidRenderResult>;
}>;

export type FrontendEnhancementWindow = Window & {
  EasyMDEEnhancements?: Readonly<{
    enhance: (root: ParentNode, config: FrontendEnhancementConfig) => Promise<void>;
  }>;
  EasyMDEFrontendConfig?: FrontendEnhancementConfig;
  EasyMDEMathRenderer?: Readonly<{
    render: (root: ParentNode, config: FrontendEnhancementConfig) => void;
  }>;
  EasyMDEMermaidRenderer?: Readonly<{
    render: (root: ParentNode, config: FrontendEnhancementConfig) => Promise<void>;
  }>;
  hljs?: HighlightRuntime;
  katex?: KatexRuntime;
  mermaid?: MermaidRuntime;
};

let mermaidRenderIndex = 0;

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

function syncCodeFrameBackgrounds(root: ParentNode, windowRef: FrontendEnhancementWindow): void {
  root.querySelectorAll('pre > code:not(.language-mermaid)').forEach((element) => {
    if (!(element instanceof HTMLElement) || !element.parentElement) {
      throw new Error('easymde-code-frame-parent-missing');
    }
    element.parentElement.style.setProperty(
      '--easymde-code-frame-background',
      windowRef.getComputedStyle(element).backgroundColor
    );
  });
}

function highlightCode(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow
): void {
  const syntaxHighlight = featureEnabled(config, 'syntaxHighlight');

  root.querySelectorAll('pre > code').forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('easymde-code-element-invalid');
    }
    if (element.classList.contains('language-mermaid')) return;

    element.classList.add('hljs');
    if (!syntaxHighlight || !windowRef.hljs || element.dataset.easymdeHighlighted) return;

    windowRef.hljs.highlightElement(element);
    element.dataset.easymdeHighlighted = '1';
  });
  syncCodeFrameBackgrounds(root, windowRef);
}

export function renderMathContent(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow
): void {
  if (!featureEnabled(config, 'math')) return;
  const katex = windowRef.katex;
  if (!katex) return;

  root.querySelectorAll('.easymde-math:not([data-easymde-rendered])').forEach((element) => {
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
  });
}

function initializeMermaid(windowRef: FrontendEnhancementWindow): boolean {
  if (!windowRef.mermaid) return false;

  windowRef.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default'
  });

  return true;
}

export function renderMermaidContent(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow
): Promise<void> {
  const tasks: Promise<void>[] = [];

  const mermaid = windowRef.mermaid;
  if (!featureEnabled(config, 'mermaid') || !mermaid || !initializeMermaid(windowRef)) {
    return Promise.resolve();
  }

  root.querySelectorAll('pre > code.language-mermaid:not([data-easymde-rendered])').forEach((element) => {
    if (!(element instanceof HTMLElement) || !element.parentElement) {
      throw new Error('easymde-mermaid-parent-missing');
    }
    const pre = element.parentElement;
    const source = element.textContent || '';
    const container = element.ownerDocument.createElement('div');
    const renderId = `easymde-mermaid-${Date.now()}-${++mermaidRenderIndex}`;

    container.className = 'easymde-mermaid';
    element.dataset.easymdeRendered = '1';

    tasks.push(
      mermaid.render(renderId, source)
        .then((result) => {
          if (!pre.parentNode) return;

          container.innerHTML = result.svg;
          pre.parentNode.replaceChild(container, pre);
        })
        .catch(() => {
          pre.classList.add('easymde-render-error');
          pre.setAttribute(
            'data-easymde-error',
            stringValue(config, 'renderingFailed', '')
          );
        })
    );
  });

  return Promise.all(tasks).then(() => undefined);
}

export function enhanceFrontendContent(
  root: ParentNode | null,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow
): Promise<void> {
  if (!root) return Promise.resolve();

  highlightCode(root, config, windowRef);
  const tasks: Array<Promise<void> | void> = [];
  if (windowRef.EasyMDEMathRenderer) {
    tasks.push(windowRef.EasyMDEMathRenderer.render(root, config));
  }
  if (windowRef.EasyMDEMermaidRenderer) {
    tasks.push(windowRef.EasyMDEMermaidRenderer.render(root, config));
  }

  return Promise.all(tasks).then(() => undefined);
}
