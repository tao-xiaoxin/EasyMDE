import {
  BACKGROUND_YIELD_CHUNK_SIZE,
  type BackgroundAssetCache,
  type BrowserWechatClipboardRuntime,
  HIDDEN_NODES,
  MATH_BLOCK_ROOTS,
  MERMAID_FOREIGN_OBJECTS,
  type MarkupWalkMarkers,
  PREVIEW_MEASUREMENT_WIDTHS,
  type SerializationYield,
  type SerializedClipboardPayload,
  appendDeclarations,
  createMarkupWalkMarkers,
  forEachWithYield,
  throwIfBackgroundPreparationAborted
} from './wechat-clipboard-shared';
import {
  expandMermaidLabelGeometryForElement,
  findKaTeXMathMl,
  materializeCodeLineBreaksForCode,
  normalizeCodeFrame,
  normalizeCodeWhitespaceForCode,
  normalizeInputElement,
  normalizeMathBlockElement,
  normalizeStructure,
  normalizeStructureDiv,
  normalizeStructureRoot,
  preserveCodeLineWhitespaceForCode,
  preserveMermaidLabelWhitespaceForElement,
  referencedFragmentIds,
  retainReferencedFragmentId,
  retainReferencedFragmentIds,
  styleMediaElement,
  styleMermaidForeignObjectElement,
  styleSvgElement,
  styleTableElement,
  wrapCodeLinesForCode,
  wrapKaTeXVisualRoot,
  wrapKaTeXVisualRoots,
  wrapMermaidLabelContent,
  wrapTableScrollOwner,
  wrapTextLeafNode,
  wrapTextLeaves
} from './wechat-markup-transforms';
import {
  type WechatPngConversionContext,
  assertPngConversionCurrent,
  replaceVisualObjects
} from './wechat-png-conversion';
import {
  inlineStyles,
  inlineStylesSynchronously
} from './wechat-style-inliner';

function finalizeMarkup(
  clone: HTMLElement,
  fragmentIds: Set<string>,
  mathMlNodes: Set<Element>,
  markers?: MarkupWalkMarkers
): HTMLElement {
  mathMlNodes.forEach((element) => {
    element.remove();
  });
  wrapKaTeXVisualRoots(clone, markers);
  const hiddenNodes = markers
    ? markers.hiddenNodes.filter((element) => clone.contains(element))
    : Array.from(clone.querySelectorAll('*'))
      .filter((element) => HIDDEN_NODES.has(element));
  hiddenNodes.forEach((element) => {
    element.remove();
  });
  clone.querySelectorAll('script, style, button, textarea, select, option, form, iframe, object, embed').forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll('input').forEach(normalizeInputElement);
  const mathBlockRoots = markers
    ? markers.mathBlockRoots.filter((element) => clone.contains(element))
    : Array.from(clone.querySelectorAll('*'))
      .filter((element) => MATH_BLOCK_ROOTS.has(element));
  mathBlockRoots.forEach(normalizeMathBlockElement);
  const normalized = normalizeStructure(clone);
  retainReferencedFragmentIds(normalized, fragmentIds);
  appendDeclarations(normalized, ['max-width:100%', 'margin:0 auto']);
  normalized.querySelectorAll('img, video').forEach(styleMediaElement);
  normalized.querySelectorAll('svg').forEach(styleSvgElement);
  const foreignObjects = Array.from(normalized.querySelectorAll('foreignObject'))
    .filter((element) => MERMAID_FOREIGN_OBJECTS.has(element));
  foreignObjects.forEach(styleMermaidForeignObjectElement);
  foreignObjects.forEach(wrapMermaidLabelContent);
  foreignObjects.forEach(expandMermaidLabelGeometryForElement);
  foreignObjects.forEach(preserveMermaidLabelWhitespaceForElement);
  const tables = Array.from(normalized.querySelectorAll('table'));
  tables.forEach(styleTableElement);
  tables.forEach(wrapTableScrollOwner);
  normalized.querySelectorAll('pre').forEach(normalizeCodeFrame);
  const codeBlocks = Array.from(normalized.querySelectorAll('pre > code'));
  codeBlocks.forEach(materializeCodeLineBreaksForCode);
  codeBlocks.forEach(wrapCodeLinesForCode);
  codeBlocks.forEach(preserveCodeLineWhitespaceForCode);
  wrapTextLeaves(normalized);
  codeBlocks.forEach(normalizeCodeWhitespaceForCode);
  return normalized;
}

async function finalizeMarkupWithYield(
  clone: HTMLElement,
  fragmentIds: Set<string>,
  mathMlNodes: Set<Element>,
  markers: MarkupWalkMarkers,
  yieldToBrowser: SerializationYield,
  signal?: AbortSignal
): Promise<HTMLElement> {
  await forEachWithYield(mathMlNodes, (element) => {
    element.remove();
  }, yieldToBrowser, signal);
  await forEachWithYield(
    markers.katexVisualRoots.filter((element) => clone.contains(element)),
    wrapKaTeXVisualRoot,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    markers.hiddenNodes.filter((element) => clone.contains(element)),
    (element) => { element.remove(); },
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    clone.querySelectorAll('script, style, button, textarea, select, option, form, iframe, object, embed'),
    (node) => { node.remove(); },
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    clone.querySelectorAll('input'),
    normalizeInputElement,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    markers.mathBlockRoots.filter((element) => clone.contains(element)),
    normalizeMathBlockElement,
    yieldToBrowser,
    signal
  );
  const normalized = normalizeStructureRoot(clone);
  await forEachWithYield(
    normalized.querySelectorAll('div'),
    normalizeStructureDiv,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    normalized.querySelectorAll('[id]'),
    (element) => { retainReferencedFragmentId(element, fragmentIds); },
    yieldToBrowser,
    signal
  );
  if (normalized.id && !fragmentIds.has(normalized.id) && !normalized.closest('svg')) {
    normalized.removeAttribute('id');
  }
  appendDeclarations(normalized, ['max-width:100%', 'margin:0 auto']);
  await forEachWithYield(
    normalized.querySelectorAll('img, video'),
    styleMediaElement,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    normalized.querySelectorAll('svg'),
    styleSvgElement,
    yieldToBrowser,
    signal
  );
  const foreignObjects = Array.from(normalized.querySelectorAll('foreignObject'))
    .filter((element) => MERMAID_FOREIGN_OBJECTS.has(element));
  await forEachWithYield(
    foreignObjects,
    styleMermaidForeignObjectElement,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    foreignObjects,
    wrapMermaidLabelContent,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    foreignObjects,
    expandMermaidLabelGeometryForElement,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    foreignObjects,
    preserveMermaidLabelWhitespaceForElement,
    yieldToBrowser,
    signal
  );
  const tables = Array.from(normalized.querySelectorAll('table'));
  await forEachWithYield(tables, styleTableElement, yieldToBrowser, signal);
  await forEachWithYield(tables, wrapTableScrollOwner, yieldToBrowser, signal);
  await forEachWithYield(
    normalized.querySelectorAll('pre'),
    normalizeCodeFrame,
    yieldToBrowser,
    signal
  );
  const codeBlocks = Array.from(normalized.querySelectorAll('pre > code'));
  await forEachWithYield(
    codeBlocks,
    materializeCodeLineBreaksForCode,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    codeBlocks,
    wrapCodeLinesForCode,
    yieldToBrowser,
    signal
  );
  await forEachWithYield(
    codeBlocks,
    preserveCodeLineWhitespaceForCode,
    yieldToBrowser,
    signal
  );
  const walker = normalized.ownerDocument.createTreeWalker(normalized, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  let scanned = 0;
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
    scanned += 1;
    if (0 === scanned % (BACKGROUND_YIELD_CHUNK_SIZE * 4)) {
      throwIfBackgroundPreparationAborted(signal);
      if (yieldToBrowser.shouldYield()) {
        await yieldToBrowser();
      }
    }
  }
  await forEachWithYield(textNodes, wrapTextLeafNode, yieldToBrowser, signal);
  await forEachWithYield(
    codeBlocks,
    normalizeCodeWhitespaceForCode,
    yieldToBrowser,
    signal
  );
  return normalized;
}

async function createMarkup(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal
): Promise<HTMLElement> {
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) assertPngConversionCurrent(conversion);
  const clone = preview.cloneNode(true) as HTMLElement;
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  const markers = createMarkupWalkMarkers();
  await inlineStyles(
    preview,
    clone,
    runtime.getComputedStyle,
    true,
    runtime,
    cache,
    preview,
    yieldToBrowser,
    signal,
    markers
  );
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) {
    assertPngConversionCurrent(conversion);
    await replaceVisualObjects(clone, conversion);
    assertPngConversionCurrent(conversion);
  }
  throwIfBackgroundPreparationAborted(signal);
  const finalized = yieldToBrowser
    ? await finalizeMarkupWithYield(
      clone,
      fragmentIds,
      mathMlNodes,
      markers,
      yieldToBrowser,
      signal
    )
    : finalizeMarkup(clone, fragmentIds, mathMlNodes, markers);
  throwIfBackgroundPreparationAborted(signal);
  return finalized;
}

function createMarkupSynchronously(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): HTMLElement | null {
  const clone = preview.cloneNode(true) as HTMLElement;
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  const markers = createMarkupWalkMarkers();
  if (!inlineStylesSynchronously(
    preview,
    clone,
    runtime.getComputedStyle,
    true,
    runtime,
    preview,
    markers
  )) return null;
  return finalizeMarkup(clone, fragmentIds, mathMlNodes, markers);
}

function normalizedPlainText(value: string): string {
  return value.replaceAll('\u2060', '').replaceAll('\u00a0', ' ');
}

function previewMeasurementWidth(source: HTMLElement): number | null {
  const rectWidth = source.getBoundingClientRect().width;
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

function stripPlainTextMediaAttributes(element: Element): void {
  element.removeAttribute('src');
  element.removeAttribute('srcset');
  element.removeAttribute('poster');
}

function measureConnectedPlainText(
  textRoot: HTMLElement,
  source: HTMLElement
): string {
  const document = textRoot.ownerDocument;
  if (!document.body) throw new Error('wechat-plain-text-document-body-unavailable');
  const host = document.createElement('div');
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
  host.append(textRoot);
  try {
    const connectedText = normalizedPlainText(textRoot.innerText || textRoot.textContent || '');
    // jsdom and other non-layout DOM implementations flatten a connected
    // clone too. When the real Preview exposes line-aware `innerText`, retain
    // those source boundaries only in that no-layout case; the normalized
    // clone remains the source for browsers that can perform layout.
    const sourceText = source.innerText;
    if (!connectedText.includes('\n') && 'string' === typeof sourceText && sourceText.includes('\n')) {
      return normalizedPlainText(sourceText);
    }
    return connectedText;
  } finally {
    host.remove();
  }
}

function connectedPlainText(
  root: HTMLElement,
  source: HTMLElement,
  reuseDetachedRoot = false
): string {
  const document = root.ownerDocument;
  if (!document.body) throw new Error('wechat-plain-text-document-body-unavailable');
  const textRoot = reuseDetachedRoot ? root : root.cloneNode(true) as HTMLElement;
  // Plain text does not need media resources. Remove their fetchable
  // attributes from the temporary measurement tree while leaving the HTML
  // payload untouched.
  textRoot.querySelectorAll('img, video, source').forEach(stripPlainTextMediaAttributes);
  return measureConnectedPlainText(textRoot, source);
}

async function connectedPlainTextWithYield(
  root: HTMLElement,
  source: HTMLElement,
  yieldToBrowser: SerializationYield | null,
  signal?: AbortSignal
): Promise<string> {
  if (!yieldToBrowser) return connectedPlainText(root, source, true);
  throwIfBackgroundPreparationAborted(signal);
  const document = root.ownerDocument;
  if (!document.body) throw new Error('wechat-plain-text-document-body-unavailable');
  await forEachWithYield(
    root.querySelectorAll('img, video, source'),
    stripPlainTextMediaAttributes,
    yieldToBrowser,
    signal
  );
  throwIfBackgroundPreparationAborted(signal);
  if (yieldToBrowser.shouldYield()) {
    await yieldToBrowser();
  }
  throwIfBackgroundPreparationAborted(signal);
  return measureConnectedPlainText(root, source);
}

export async function serializeClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal
): Promise<SerializedClipboardPayload> {
  throwIfBackgroundPreparationAborted(signal);
  const clone = await createMarkup(
    preview,
    runtime,
    cache,
    yieldToBrowser,
    conversion,
    signal
  );
  throwIfBackgroundPreparationAborted(signal);
  if (yieldToBrowser?.shouldYield()) {
    await yieldToBrowser();
  }
  const html = clone.outerHTML;
  throwIfBackgroundPreparationAborted(signal);
  if (yieldToBrowser?.shouldYield()) {
    await yieldToBrowser();
  }
  const text = await connectedPlainTextWithYield(clone, preview, yieldToBrowser, signal);
  throwIfBackgroundPreparationAborted(signal);
  return {
    html,
    text
  };
}

export function serializeClipboardPayloadSynchronously(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): SerializedClipboardPayload | null {
  const clone = createMarkupSynchronously(preview, runtime);
  if (!clone) return null;
  return {
    html: clone.outerHTML,
    text: connectedPlainText(clone, preview, true)
  };
}
