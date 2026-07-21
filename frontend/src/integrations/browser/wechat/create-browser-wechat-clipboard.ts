import type {
  WechatClipboardPort,
  WechatClipboardResult
} from '../../../contracts/ports/wechat-clipboard-port';

const COPY_STYLE_PROPERTIES = [
  'display', 'position', 'float', 'clear', 'box-sizing', 'overflow', 'overflow-x',
  'overflow-y', 'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style',
  'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color', 'border-collapse',
  'border-spacing', 'border-radius', 'background', 'background-color', 'color', 'font',
  'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-transform', 'text-indent', 'white-space',
  'word-break', 'overflow-wrap', 'vertical-align', 'list-style-type',
  'list-style-position', 'box-shadow', 'tab-size'
] as const;

export type ClipboardItemConstructor = new (payload: Record<string, Blob>) => unknown;

export type BrowserWechatClipboardRuntime = Readonly<{
  blob: typeof Blob;
  clipboardItem: ClipboardItemConstructor | null;
  document: Document;
  getComputedStyle: (element: Element) => CSSStyleDeclaration;
  getSelection: () => Selection | null;
  pageOffset: () => Readonly<{ x: number; y: number }>;
  scrollTo: (x: number, y: number) => void;
  write: ((items: unknown[]) => Promise<void>) | null;
}>;

function keepStyle(property: string, value: string, source: Element): boolean {
  if (!value || ('rgba(0, 0, 0, 0)' === value && 'color' !== property)) return false;
  if ('normal' === value && ['font-style', 'letter-spacing', 'text-transform'].includes(property)) {
    return false;
  }
  if ('auto' === value && ['height', 'width'].includes(property)) return false;
  return !('A' === source.tagName && 'text-decoration' === property && 'none' === value);
}

function inlineStyles(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): void {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const computed = getComputedStyle(source);
  const declarations = COPY_STYLE_PROPERTIES.flatMap((property) => {
    const value = computed.getPropertyValue(property);
    return keepStyle(property, value, source) ? [`${property}:${value}`] : [];
  });
  if (declarations.length) clone.setAttribute('style', declarations.join(';'));
  clone.removeAttribute('class');
  clone.removeAttribute('id');
  clone.removeAttribute('aria-live');
  for (const attribute of Array.from(clone.attributes)) {
    if (/^on/i.test(attribute.name) || /^data-easymde-/i.test(attribute.name)) {
      clone.removeAttribute(attribute.name);
    }
  }
  source.childNodes.forEach((child, index) => {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild) inlineStyles(child, cloneChild, getComputedStyle);
  });
}

function previewReady(preview: HTMLElement): boolean {
  return '' !== preview.innerHTML.trim()
    && !preview.querySelector(
      '.easymde-preview-empty, .easymde-preview-pending, .easymde-preview-error, .easymde-render-error'
    )
    && '1' !== preview.getAttribute('data-easymde-preview-error')
    && '1' !== preview.getAttribute('data-easymde-preview-refreshing')
    && 'true' !== preview.getAttribute('aria-busy');
}

function createMarkup(
  preview: HTMLElement,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): HTMLElement {
  const clone = preview.cloneNode(true) as HTMLElement;
  inlineStyles(preview, clone, getComputedStyle);
  clone.querySelectorAll('script, style').forEach((node) => {
    node.remove();
  });
  clone.setAttribute('style', `${clone.getAttribute('style') ?? ''};max-width:100%;margin:0 auto;`);
  return clone;
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
      return 'function' === typeof runtime.document.execCommand
        && runtime.document.execCommand('copy');
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

export function createBrowserWechatClipboard(
  runtime: BrowserWechatClipboardRuntime
): WechatClipboardPort {
  return {
    async copy(preview: HTMLElement): Promise<WechatClipboardResult> {
      if (!previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }
      const clone = createMarkup(preview, runtime.getComputedStyle);
      const html = clone.outerHTML;
      const text = preview.innerText || preview.textContent || '';

      if (runtime.write && runtime.clipboardItem) {
        try {
          const item = new runtime.clipboardItem({
            'text/html': new runtime.blob([html], { type: 'text/html' }),
            'text/plain': new runtime.blob([text], { type: 'text/plain' })
          });
          await runtime.write([item]);
          return { method: 'clipboard', status: 'copied' };
        } catch {
          if (legacyCopy(html, runtime)) return { method: 'legacy', status: 'copied' };
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
      }

      if (legacyCopy(html, runtime)) return { method: 'legacy', status: 'copied' };
      return { code: 'wechat-clipboard-unsupported', status: 'failed' };
    }
  };
}
