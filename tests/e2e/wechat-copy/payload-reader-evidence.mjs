// Payload reader evidence owner.
import { nativeClipboardSurfaceWidths } from "./environment.mjs";

export function taskBlockRow(element) {
  if (!element || typeof element.getAttribute !== 'function') return null;
  for (let current = element.parentElement; current; current = current.parentElement) {
    if ('LI' === current.tagName) return current;
    if ('SECTION' !== current.tagName) continue;
    const declarations = current.getAttribute('style') ?? '';
    if (
      /(?:^|;)\s*list-style-type\s*:\s*none(?:\s*!important)?\s*(?:;|$)/iu.test(declarations)
      && /(?:^|;)\s*list-style-image\s*:\s*none(?:\s*!important)?\s*(?:;|$)/iu.test(declarations)
    ) {
      return current;
    }
  }
  return null;
}

export async function readNativeCodeSurfaceEvidence(
  page,
  html = null,
  {
    signatureSentinels = [],
    sourceSelector = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
    stripPosition = false,
    widths = nativeClipboardSurfaceWidths
  } = {}
) {
  return page.evaluate(async ({ signatureSentinels, sourceHtml, sourceSelector, stripPosition, widths }) => {
    const styleProperties = [
      'color',
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'letterSpacing',
      'lineHeight',
      'textDecorationLine'
    ];
    const frameProperties = [
      'backgroundColor',
      'borderRadius',
      'boxShadow',
      'boxSizing',
      'fontFamily',
      'fontSize',
      'lineHeight',
      'margin',
      'maxWidth',
      'overflowX',
      'overflowY',
      'padding',
      'paddingBottom',
      'paddingLeft',
      'paddingRight',
      'paddingTop',
      'opacity',
      'whiteSpace',
      'wordBreak'
    ];
    const finite = (value, label) => {
      if (!Number.isFinite(value)) throw new Error(`wechat-native-${label}-invalid`);
      return value;
    };
    const normalizeText = (value) => value
      .replaceAll('\u2060', '')
      .replaceAll('\u00a0', ' ');
    const normalizeVisibleCodeText = (value) => normalizeText(value.replaceAll('\uFEFF', ''));
    const textWithBreaks = (node) => {
      if (node.nodeType === 3) return node.nodeValue ?? '';
      if (node.nodeType !== 1) return '';
      if (node.tagName === 'BR') return '\n';
      return [...node.childNodes].map(textWithBreaks).join('');
    };
    const styleVector = (element, view) => {
      const style = view.getComputedStyle(element);
      return Object.fromEntries(styleProperties.map((property) => [property, style[property]]));
    };
    const frameStyle = (element, view) => {
      const style = view.getComputedStyle(element);
      return Object.fromEntries(frameProperties.map((property) => [property, style[property]]));
    };
    const shadowPaint = (element, view) => {
      const rect = element.getBoundingClientRect();
      const shadow = view.getComputedStyle(element).boxShadow;
      let left = rect.left;
      let right = rect.right;
      let top = rect.top;
      let bottom = rect.bottom;
      let shadowCount = 0;
      const pattern = /(-?(?:\d+|\d*\.\d+)px)\s+(-?(?:\d+|\d*\.\d+)px)(?:\s+(-?(?:\d+|\d*\.\d+)px))?(?:\s+(-?(?:\d+|\d*\.\d+)px))?/gu;
      for (const match of shadow.matchAll(pattern)) {
        shadowCount += 1;
        const offsetX = Number.parseFloat(match[1]);
        const offsetY = Number.parseFloat(match[2]);
        const blur = Math.abs(Number.parseFloat(match[3] ?? '0'));
        const spread = Math.abs(Number.parseFloat(match[4] ?? '0'));
        const extent = blur + spread;
        left = Math.min(left, rect.left + offsetX - extent);
        right = Math.max(right, rect.right + offsetX + extent);
        top = Math.min(top, rect.top + offsetY - extent);
        bottom = Math.max(bottom, rect.bottom + offsetY + extent);
      }
      return {
        bottom: finite(bottom, 'marker-paint-bottom'),
        left: finite(left, 'marker-paint-left'),
        right: finite(right, 'marker-paint-right'),
        shadowCount,
        top: finite(top, 'marker-paint-top')
      };
    };
    const box = (element, label) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: finite(rect.bottom, `${label}-bottom`),
        height: finite(rect.height, `${label}-height`),
        left: finite(rect.left, `${label}-left`),
        right: finite(rect.right, `${label}-right`),
        top: finite(rect.top, `${label}-top`),
        width: finite(rect.width, `${label}-width`)
      };
    };
    const readCharacters = (code, view, documentRef) => {
      const characters = [];
      const walker = documentRef.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement ?? code;
        const style = styleVector(parent, view);
        for (const character of node.nodeValue ?? '') {
          if (character === '\u2060' || /\s/u.test(character)) continue;
          characters.push({
            character: '\u00a0' === character ? ' ' : character,
            style
          });
        }
        node = walker.nextNode();
      }
      return characters;
    };
    const readPaintedLines = (code, documentRef) => {
      const lineTops = [];
      let lastRect = null;
      const walker = documentRef.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = node.nodeValue ?? '';
        for (let offset = 0; offset < value.length; offset += 1) {
          const character = value[offset];
          if (character === '\u2060' || /\s/u.test(character)) continue;
          const range = documentRef.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          if (rect.height <= 0) continue;
          const top = finite(rect.top, 'painted-line-top');
          if (!lineTops.some((value) => Math.abs(value - top) <= 0.5)) lineTops.push(top);
          lastRect = rect;
        }
        node = walker.nextNode();
      }
      if (!lastRect) throw new Error('wechat-native-last-glyph-unavailable');
      return { lastRect, paintedLineCount: lineTops.length };
    };
    const signatureStyle = (element, view) => {
      const style = view.getComputedStyle(element);
      return Object.fromEntries([
        'color',
        'fontFamily',
        'fontSize',
        'fontStyle',
        'fontWeight',
        'letterSpacing',
        'lineHeight'
      ].map((property) => [property, style[property]]));
    };
    const inlineStyle = (element) => Object.fromEntries([
      'color',
      'font-family',
      'font-size',
      'font-style',
      'font-weight',
      'letter-spacing',
      'line-height',
      'text-decoration-line'
    ].map((property) => [property, element.style.getPropertyValue(property)]));
    const findTextRange = (root, needle, documentRef, view) => {
      if ('string' !== typeof needle || !needle) return null;
      const nodes = [];
      const walker = documentRef.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let text = '';
      while (node) {
        const value = node.nodeValue ?? '';
        nodes.push({ end: text.length + value.length, node, start: text.length });
        text += value;
        node = walker.nextNode();
      }
      const start = text.indexOf(needle);
      if (start < 0) return null;
      const end = start + needle.length;
      const startNode = nodes.find(({ end: nodeEnd }) => start < nodeEnd);
      const endNode = nodes.find(({ end: nodeEnd }) => end <= nodeEnd);
      if (!startNode || !endNode) return null;
      const range = documentRef.createRange();
      range.setStart(startNode.node, start - startNode.start);
      range.setEnd(endNode.node, end - endNode.start);
      return { range, textLength: needle.length };
    };
    const readVisualSignatures = (root, view, documentRef) => signatureSentinels.map((sentinel) => {
      if (!sentinel || 'string' !== typeof sentinel.id || 'string' !== typeof sentinel.text) {
        throw new Error('wechat-native-visual-signature-invalid');
      }
      const match = findTextRange(root, sentinel.text, documentRef, view);
      if (!match) throw new Error(`wechat-native-visual-signature-${sentinel.id}-unavailable`);
      const firstElement = match.range.startContainer.parentElement ?? root;
      const candidateAnchor = firstElement.closest('a');
      const ownerHasAnchor = Boolean(
        candidateAnchor
        && root.contains(candidateAnchor)
        && candidateAnchor.contains(match.range.startContainer)
        && candidateAnchor.contains(match.range.endContainer)
      );
      const owner = ownerHasAnchor ? candidateAnchor : firstElement;
      const rects = [...match.range.getClientRects()];
      if (!rects.length) throw new Error(`wechat-native-visual-signature-${sentinel.id}-paint-unavailable`);
      const paint = rects.reduce((bounds, rect) => ({
        bottom: Math.max(bounds.bottom, finite(rect.bottom, `visual-${sentinel.id}-bottom`)),
        left: Math.min(bounds.left, finite(rect.left, `visual-${sentinel.id}-left`)),
        right: Math.max(bounds.right, finite(rect.right, `visual-${sentinel.id}-right`)),
        top: Math.min(bounds.top, finite(rect.top, `visual-${sentinel.id}-top`))
      }), {
        bottom: Number.NEGATIVE_INFINITY,
        left: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        top: Number.POSITIVE_INFINITY
      });
      return {
        id: sentinel.id,
        kind: sentinel.kind,
        inlineStyle: inlineStyle(firstElement),
        ownerHasAnchor,
        ownerInlineStyle: inlineStyle(owner),
        ownerStyle: signatureStyle(owner, view),
        ownerTag: owner.tagName,
        paint: {
          bottom: paint.bottom,
          height: finite(paint.bottom - paint.top, `visual-${sentinel.id}-height`),
          left: paint.left,
          right: paint.right,
          top: paint.top,
          width: finite(paint.right - paint.left, `visual-${sentinel.id}-width`)
        },
        style: {
          ...signatureStyle(firstElement, view),
          textDecorationLine: view.getComputedStyle(owner).textDecorationLine
        },
        textLength: match.textLength
      };
    });
    const safeLength = (value) => {
      const normalized = value.trim();
      if (normalized === 'auto' || normalized === 'none' || normalized === 'max-content') {
        return normalized;
      }
      const parts = normalized.split(/\s+/u);
      if (!parts.length || parts.some((part) => !/^-?(?:\d+|\d*\.\d+)px$/u.test(part))) {
        return 'other';
      }
      return parts.map((part) => Number.parseFloat(part));
    };
    const safeEnum = (value, values) => values.has(value) ? value : 'other';
    const cssPixel = (style, property, label) => {
      const value = Number.parseFloat(style.getPropertyValue(property));
      if (!Number.isFinite(value)) throw new Error(`wechat-native-${label}-invalid`);
      return value;
    };
    const optionalCssPixel = (style, property) => {
      const value = style.getPropertyValue(property).trim();
      if (!value || value === 'auto' || value === 'normal' || value === 'none') return null;
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const contentBox = (element, rect, style, label) => ({
      height: finite(
        rect.height
          - cssPixel(style, 'border-top-width', `${label}-border-top`)
          - cssPixel(style, 'border-bottom-width', `${label}-border-bottom`)
          - cssPixel(style, 'padding-top', `${label}-padding-top`)
          - cssPixel(style, 'padding-bottom', `${label}-padding-bottom`),
        `${label}-height`
      ),
      width: finite(
        rect.width
          - cssPixel(style, 'border-left-width', `${label}-border-left`)
          - cssPixel(style, 'border-right-width', `${label}-border-right`)
          - cssPixel(style, 'padding-left', `${label}-padding-left`)
          - cssPixel(style, 'padding-right', `${label}-padding-right`),
        `${label}-width`
      )
    });
    const taskMarkerStyle = (element, view, pseudo = null) => {
      const style = view.getComputedStyle(element, pseudo);
      return {
        appearance: style.appearance,
        backgroundColor: style.backgroundColor,
        borderBottomColor: style.borderBottomColor,
        borderBottomStyle: style.borderBottomStyle,
        borderBottomWidth: optionalCssPixel(style, 'border-bottom-width'),
        borderLeftColor: style.borderLeftColor,
        borderLeftStyle: style.borderLeftStyle,
        borderLeftWidth: optionalCssPixel(style, 'border-left-width'),
        borderRightColor: style.borderRightColor,
        borderRightStyle: style.borderRightStyle,
        borderRightWidth: optionalCssPixel(style, 'border-right-width'),
        borderTopColor: style.borderTopColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: optionalCssPixel(style, 'border-top-width'),
        boxSizing: style.boxSizing,
        content: style.content,
        display: style.display,
        height: style.height,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        marginTop: style.marginTop,
        opacity: style.opacity,
        paddingBottom: optionalCssPixel(style, 'padding-bottom'),
        paddingLeft: optionalCssPixel(style, 'padding-left'),
        paddingRight: optionalCssPixel(style, 'padding-right'),
        paddingTop: optionalCssPixel(style, 'padding-top'),
        position: style.position,
        transform: style.transform,
        transformOrigin: style.transformOrigin,
        verticalAlign: style.verticalAlign,
        visibility: style.visibility,
        width: style.width
      };
    };
    const firstMeaningfulTextRange = (element, documentRef, view) => {
      const walker = documentRef.createTreeWalker(element, view.NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const value = node.nodeValue ?? '';
        if (
          parent
          && !parent.closest('script,style,[aria-hidden="true"]')
        ) {
          const offset = [...value].findIndex((character) => !/\s/u.test(character));
          if (offset >= 0) {
            const range = documentRef.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return {
                box: boxFromRect(rect, 'task-text-anchor'),
                connected: node.isConnected && parent.isConnected,
                text: value.slice(offset).trim().slice(0, 64)
              };
            }
          }
        }
        node = walker.nextNode();
      }
      throw new Error('wechat-native-task-text-anchor-unavailable');
    };
    const boxFromRect = (rect, label) => ({
      bottom: finite(rect.bottom, `${label}-bottom`),
      height: finite(rect.height, `${label}-height`),
      left: finite(rect.left, `${label}-left`),
      right: finite(rect.right, `${label}-right`),
      top: finite(rect.top, `${label}-top`),
      width: finite(rect.width, `${label}-width`)
    });
    // Mirrors the exported taskBlockRow: rows are native `li` elements or the
    // projected task sections that carry the replaced marker declarations.
    // Authored caption sections, nested ordinary list items, and the task list
    // container itself are not rows.
    const taskBlockRow = (element) => {
      for (let current = element.parentElement; current; current = current.parentElement) {
        if ('LI' === current.tagName) return current;
        if ('SECTION' !== current.tagName) continue;
        const declarations = current.getAttribute('style') ?? '';
        if (
          /(?:^|;)\s*list-style-type\s*:\s*none(?:\s*!important)?\s*(?:;|$)/iu.test(declarations)
          && /(?:^|;)\s*list-style-image\s*:\s*none(?:\s*!important)?\s*(?:;|$)/iu.test(declarations)
        ) {
          return current;
        }
      }
      return null;
    };
    const taskEvidence = (root, rootBox, label, view, documentRef) => {
      const sourceInputs = [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((element) => element.closest('.task-list-item, .task-list'));
      const staticOwners = [...root.querySelectorAll('[role="checkbox"]')]
        .filter((element) => Boolean(taskBlockRow(element)));
      const markerElements = sourceInputs.length ? sourceInputs : staticOwners;
      const markerType = sourceInputs.length ? 'source-input' : 'static-owner';
      const items = markerElements.map((marker, index) => {
        const li = taskBlockRow(marker);
        if (!li) throw new Error(`wechat-native-${label}-task-li-unavailable`);
        const markerRect = marker.getBoundingClientRect();
        const markerComputed = view.getComputedStyle(marker);
        const liRect = li.getBoundingClientRect();
        const liComputed = view.getComputedStyle(li);
        const text = firstMeaningfulTextRange(li, documentRef, view);
        const markerBox = boxFromRect(markerRect, `${label}-task-marker-${index}`);
        const liBox = boxFromRect(liRect, `${label}-task-li-${index}`);
        const textBox = text.box;
        const markerPseudos = sourceInputs.length
          ? ['::before', '::after']
            .map((pseudo) => ({
              pseudo,
                style: taskMarkerStyle(marker, view, pseudo)
            }))
            .filter(({ style }) => (
              style.content !== 'none'
              && style.content !== 'normal'
              && style.display !== 'none'
              && style.visibility !== 'hidden'
            ))
          : [...marker.children]
            .filter((element) => element.getAttribute('aria-hidden') === 'true')
            .map((element, markerIndex) => ({
              box: boxFromRect(
                element.getBoundingClientRect(),
                `${label}-task-static-marker-${index}-${markerIndex}`
              ),
              pseudo: `static-${markerIndex}`,
              style: taskMarkerStyle(element, view)
            }));
        const markerContentBox = contentBox(
          marker,
          markerRect,
          markerComputed,
          `${label}-task-marker-content-${index}`
        );
        const marginRight = cssPixel(
          markerComputed,
          'margin-right',
          `${label}-task-marker-margin-right-${index}`
        );
        return {
          checked: sourceInputs.length
            ? marker.checked
            : marker.getAttribute('aria-checked') === 'true',
          connected: marker.isConnected && li.isConnected && text.connected,
          flowAdvance: finite(textBox.left - markerBox.left, `${label}-task-flow-${index}`),
          index,
          li: {
            box: liBox,
            connected: li.isConnected,
            lineHeight: cssPixel(liComputed, 'line-height', `${label}-task-line-height-${index}`)
          },
          marker: {
            ariaChecked: marker.getAttribute('aria-checked'),
            ariaDisabled: marker.getAttribute('aria-disabled'),
            box: markerBox,
            connected: marker.isConnected,
            contentBox: markerContentBox,
            marginRight,
            pseudoMarkers: markerPseudos,
            style: taskMarkerStyle(marker, view)
          },
          text: {
            box: textBox,
            connected: text.connected,
            relativeToLi: {
              bottom: finite(textBox.bottom - liBox.top, `${label}-task-text-bottom-${index}`),
              left: finite(textBox.left - liBox.left, `${label}-task-text-left-${index}`),
              right: finite(textBox.right - liBox.left, `${label}-task-text-right-${index}`),
              top: finite(textBox.top - liBox.top, `${label}-task-text-top-${index}`)
            },
            text: text.text
          }
        };
      });
      return {
        checkedStates: items.map(({ checked }) => checked),
        inputCount: root.querySelectorAll('input').length,
        markerType,
        ownerCount: staticOwners.length,
        rootContentBox: contentBox(
          root,
          rootBox,
          view.getComputedStyle(root),
          `${label}-task-root-content`
        ),
        items
      };
    };
    const collect = (root, view, documentRef, label) => {
      if (!root || root.nodeType !== 1) throw new Error(`wechat-native-${label}-root-unavailable`);
      const rootBox = box(root, `${label}-root`);
      const rootStyle = frameStyle(root, view);
      const rootOverflow = {
        clientWidth: finite(root.clientWidth, `${label}-root-client-width`),
        scrollWidth: finite(root.scrollWidth, `${label}-root-scroll-width`),
        scrollHeight: finite(root.scrollHeight, `${label}-root-scroll-height`),
        clientHeight: finite(root.clientHeight, `${label}-root-client-height`)
      };
      const overflowNodes = rootOverflow.scrollWidth - rootOverflow.clientWidth > 1
        ? [root, ...root.querySelectorAll('*')]
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const style = view.getComputedStyle(element);
            const overflowDelta = finite(
              element.scrollWidth - element.clientWidth,
              `${label}-overflow-node-${index}`
            );
            const relativeLeft = finite(rect.left - rootBox.left, `${label}-overflow-left-${index}`);
            const relativeRight = finite(rect.right - rootBox.left, `${label}-overflow-right-${index}`);
            const width = finite(rect.width, `${label}-overflow-width-${index}`);
            const height = finite(rect.height, `${label}-overflow-height-${index}`);
            const outside = relativeLeft < -1 || relativeRight > rootBox.width + 1;
            return {
              candidate: overflowDelta > 1 || outside,
              geometry: {
                computedMaxWidth: safeLength(style.maxWidth),
                computedMinWidth: safeLength(style.minWidth),
                computedWidth: safeLength(style.width),
                display: safeEnum(style.display, new Set([
                  'block', 'contents', 'flex', 'grid', 'inline', 'inline-block', 'none', 'table'
                ])),
                height,
                margin: safeLength(style.margin),
                overflowDelta,
                overflowX: safeEnum(style.overflowX, new Set(['auto', 'clip', 'hidden', 'scroll', 'visible'])),
                overflowY: safeEnum(style.overflowY, new Set(['auto', 'clip', 'hidden', 'scroll', 'visible'])),
                padding: safeLength(style.padding),
                relativeLeft,
                relativeRight,
                width
              },
              index,
              score: Math.max(overflowDelta, outside ? Math.max(-relativeLeft, relativeRight - rootBox.width) : 0),
              tag: element.tagName
            };
          })
          .filter(({ candidate }) => candidate)
          .sort((first, second) => second.score - first.score)
          .slice(0, 10)
          .map(({ geometry, index, tag }) => ({ geometry, index, tag }))
        : [];
      const linkDecorations = [...root.querySelectorAll('a')]
        .filter((anchor) => normalizeText(anchor.textContent ?? '').trim() === 'STYLE-LINK')
        .map((anchor, index) => {
          const marker = [...anchor.children]
            .find((element) => element.nodeType === 1
              && element.tagName === 'SPAN'
              && element.getAttribute('aria-hidden') === 'true') ?? null;
          const image = marker
            ? [...marker.children].find((element) => element.nodeType === 1
              && element.tagName === 'IMG') ?? null
            : null;
          return {
            imageBox: image ? box(image, `${label}-link-image-${index}`) : null,
            imageNaturalHeight: image?.naturalHeight ?? 0,
            imageNaturalWidth: image?.naturalWidth ?? 0,
            markerBox: marker ? box(marker, `${label}-link-marker-${index}`) : null,
            markerImageCount: marker ? marker.querySelectorAll(':scope > img').length : 0,
            markerCount: anchor.querySelectorAll(':scope > span[aria-hidden="true"]').length,
            rootOverflow: rootOverflow.scrollWidth - rootOverflow.clientWidth,
            srcPrefix: image?.getAttribute('src')?.slice(0, 22) ?? null,
            text: normalizeText(anchor.textContent ?? '').trim()
          };
        });
      const codeBlocks = [...root.querySelectorAll('pre > code')].map((code, index) => {
        const pre = code.parentElement;
        if (!pre || pre.nodeType !== 1) throw new Error(`wechat-native-${label}-frame-unavailable`);
        const codeBox = box(code, `${label}-code-${index}`);
        const preBox = box(pre, `${label}-pre-${index}`);
        const codeText = normalizeVisibleCodeText(textWithBreaks(code));
        const rows = [...code.children].find((element) => (
          element.nodeType === 1
          && element.tagName === 'SPAN'
          && element.getAttribute('style')?.includes('display:block!important')
          && element.getAttribute('style')?.includes('width:max-content!important')
        ));
        const rowElement = rows && rows.nodeType === 1 && rows.tagName === 'SPAN'
          ? rows
          : null;
        const lineElements = rowElement ? [...rowElement.children].filter(
          (element) => element.nodeType === 1 && element.tagName === 'NOBR'
        ) : [];
        const rowBreakCount = rowElement ? [...rowElement.children].filter(
          (element) => element.nodeType === 1 && element.tagName === 'BR'
        ).length : null;
        const lastLine = [...lineElements].reverse().find(
          (element) => normalizeText(element.textContent ?? '').trim() !== ''
        ) ?? code;
        const codeStyle = view.getComputedStyle(code);
        const cssPixels = (value, property) => {
          const parsed = Number.parseFloat(value);
          if (!Number.isFinite(parsed)) throw new Error(`wechat-native-${label}-${property}-invalid`);
          return parsed;
        };
        const codeContentWidth = codeBox.width
          - cssPixels(codeStyle.borderLeftWidth, 'code-border-left')
          - cssPixels(codeStyle.borderRightWidth, 'code-border-right')
          - cssPixels(codeStyle.paddingLeft, 'code-padding-left')
          - cssPixels(codeStyle.paddingRight, 'code-padding-right');
        const paintedLines = readPaintedLines(code, documentRef);
        const headerElement = [...pre.children]
          .find((element) => element.nodeType === 1
            && element.tagName === 'DIV'
            && element.getAttribute('aria-hidden') === 'true') ?? null;
        const markerElements = headerElement
          ? [...headerElement.children]
            .filter((element) => element.nodeType === 1)
            .filter((element) => element.getAttribute('aria-hidden') === 'true')
          : [...pre.children]
            .filter((element) => element.nodeType === 1)
            .filter((element) => element.getAttribute('aria-hidden') === 'true');
        const markers = markerElements
          .map((element, markerIndex) => ({
            box: box(element, `${label}-marker-${index}-${markerIndex}`),
            paint: shadowPaint(element, view),
            style: frameStyle(element, view)
          }));
        const pseudo = view.getComputedStyle(pre, '::before');
        const pseudoMarker = documentRef.createElement('span');
        [
          'background-color',
          'border-radius',
          'box-shadow',
          'box-sizing',
          'bottom',
          'display',
          'height',
          'left',
          'margin',
          'opacity',
          'padding',
          'position',
          'right',
          'top',
          'visibility',
          'width'
        ].forEach((property) => {
          const value = pseudo.getPropertyValue(property);
          if (value) pseudoMarker.style.setProperty(property, value);
        });
        pre.append(pseudoMarker);
        const pseudoBox = box(pseudoMarker, `${label}-pseudo-${index}`);
        const pseudoPaint = shadowPaint(pseudoMarker, view);
        pseudoMarker.remove();
        return {
          code: {
            box: codeBox,
            contentWidth: codeContentWidth,
            style: frameStyle(code, view)
          },
          rows: rowElement ? {
            box: box(rowElement, `${label}-code-rows-${index}`),
            breakCount: rowBreakCount,
            lineCount: lineElements.length,
            style: {
              display: rowElement.style.display,
              maxWidth: rowElement.style.maxWidth,
              minWidth: rowElement.style.minWidth,
              overflow: rowElement.style.overflow,
              overflowWrap: rowElement.style.overflowWrap,
              overflowX: rowElement.style.overflowX,
              overflowY: rowElement.style.overflowY,
              whiteSpace: rowElement.style.whiteSpace,
              width: rowElement.style.width,
              wordBreak: rowElement.style.wordBreak
            }
          } : null,
          characters: readCharacters(code, view, documentRef),
          frame: {
            box: preBox,
            style: frameStyle(pre, view),
            pseudo: {
              backgroundColor: pseudo.backgroundColor,
              borderRadius: pseudo.borderRadius,
              boxShadow: pseudo.boxShadow,
              content: pseudo.content,
              height: pseudo.height,
              left: pseudo.left,
              opacity: pseudo.opacity,
              position: pseudo.position,
              top: pseudo.top,
              width: pseudo.width,
              box: pseudoBox,
              paint: pseudoPaint
            },
            header: headerElement
              ? {
                box: box(headerElement, `${label}-header-${index}`),
                style: frameStyle(headerElement, view)
              }
              : null
          },
          index,
          lastLine: {
            box: box(lastLine, `${label}-last-line-${index}`),
            lineCount: paintedLines.paintedLineCount,
            rect: {
              bottom: finite(paintedLines.lastRect.bottom, `${label}-last-line-bottom-${index}`),
              height: finite(paintedLines.lastRect.height, `${label}-last-line-height-${index}`),
              left: finite(paintedLines.lastRect.left, `${label}-last-line-left-${index}`),
              right: finite(paintedLines.lastRect.right, `${label}-last-line-right-${index}`),
              top: finite(paintedLines.lastRect.top, `${label}-last-line-top-${index}`),
              width: finite(paintedLines.lastRect.width, `${label}-last-line-width-${index}`)
            },
            text: [...codeText.split('\n')]
              .reverse()
              .find((line) => line.trim() !== '') ?? ''
          },
          markers,
          overflow: {
            code: finite(code.scrollWidth - code.clientWidth, `${label}-code-overflow-${index}`),
            frame: finite(pre.scrollWidth - pre.clientWidth, `${label}-frame-overflow-${index}`),
            owner: pre.scrollWidth > pre.clientWidth + 1
              ? 'pre'
              : code.scrollWidth > code.clientWidth + 1
                ? 'code'
                : 'none',
            root: finite(root.scrollWidth - root.clientWidth, `${label}-root-overflow-${index}`)
          },
          text: codeText,
          tokenClassCount: code.querySelectorAll('[class*="hljs-"]').length
        };
      });
      return {
        blocks: codeBlocks,
        elements: {
          anchors: root.querySelectorAll('a').length,
          codeBlocks: codeBlocks.length,
          headingLevels: Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [
            `h${level}`,
            root.querySelectorAll(`h${level}`).length
          ])),
          headings: root.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
          inlineCode: [...root.querySelectorAll('code')]
            .filter((element) => !element.closest('pre')).length,
          links: root.querySelectorAll('a').length,
          orderedLists: root.querySelectorAll('ol').length,
          quoteTextPresent: (
            root.textContent?.includes('A quote remains part of the same rendered article.')
            || root.textContent?.includes('STYLE-QUOTE')
          ) ?? false,
          svg: root.querySelectorAll('svg').length,
          tables: root.querySelectorAll('table').length,
          tableColumnCounts: [...root.querySelectorAll('table')].map(
            (table) => table.rows[0]?.cells.length ?? 0
          ),
          taskCheckboxes: root.querySelectorAll('input[type="checkbox"]').length,
          unorderedLists: root.querySelectorAll('ul').length
        },
        linkDecorations,
        taskLists: taskEvidence(root, rootBox, label, view, documentRef),
        visualSignatures: readVisualSignatures(root, view, documentRef),
        markers: [
          'data-easymde-editor-owner',
          'data-easymde-document-owner',
          'data-easymde-layout-owner',
          'data-easymde-preview-html-sink'
        ].filter((attribute) => root.hasAttribute(attribute)),
        root: {
          box: rootBox,
          overflowNodes,
          overflow: rootOverflow,
          style: rootStyle
        }
      };
    };

    if (typeof sourceHtml !== 'string') {
      const root = document.querySelector(sourceSelector);
      if (!root || root.nodeType !== 1) throw new Error('wechat-native-source-root-unavailable');
      return { source: collect(root, window, document, 'source') };
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'height:2400px',
      'border:0',
      'visibility:hidden',
      'pointer-events:none'
    ].join(';');
    document.body.append(iframe);
    try {
      await new Promise((resolve, reject) => {
        iframe.addEventListener('load', resolve, { once: true });
        iframe.addEventListener('error', () => reject(new Error('wechat-native-isolated-frame-load-failed')), { once: true });
        iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
      });
      const documentRef = iframe.contentDocument;
      const view = iframe.contentWindow;
      if (!documentRef?.body || !view) throw new Error('wechat-native-isolated-frame-document-unavailable');
      documentRef.documentElement.style.cssText = 'margin:0;padding:0;width:100%;';
      documentRef.body.style.cssText = 'margin:0;padding:0;width:100%;';
      documentRef.body.innerHTML = sourceHtml;
      const root = documentRef.body.firstElementChild;
      if (!root || root.nodeType !== 1) throw new Error('wechat-native-payload-root-unavailable');
      if (stripPosition) {
        root.querySelectorAll('pre > [aria-hidden="true"], pre > [aria-hidden="true"] *')
          .forEach((element) => {
            if (element.nodeType !== 1) return;
            ['position', 'top', 'right', 'bottom', 'left'].forEach((property) => {
              element.style.removeProperty(property);
            });
          });
        root.querySelectorAll('[role="checkbox"], [role="checkbox"] *')
          .forEach((element) => {
            if (element.nodeType !== 1) return;
            ['position', 'top', 'right', 'bottom', 'left'].forEach((property) => {
              element.style.removeProperty(property);
            });
          });
      }
      const payload = [];
      for (const width of widths) {
        if (!Number.isFinite(width) || width <= 0) throw new Error('wechat-native-destination-width-invalid');
        iframe.style.width = `${width}px`;
        documentRef.documentElement.style.width = `${width}px`;
        documentRef.body.style.width = `${width}px`;
        if (documentRef.fonts?.ready) await documentRef.fonts.ready;
        const images = [...documentRef.querySelectorAll('img')];
        await Promise.all(images.map(async (image) => {
          if (!image.complete) {
            await new Promise((resolve, reject) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', () => reject(new Error('wechat-native-payload-image-load-failed')), { once: true });
            });
          }
          if (typeof image.decode === 'function') await image.decode();
        }));
        await new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
        payload.push({
          destinationWidth: width,
          fontStatus: documentRef.fonts?.status ?? 'unavailable',
          surface: collect(root, view, documentRef, `payload-${width}`)
        });
      }
      return { payload };
    } finally {
      iframe.remove();
    }
  }, {
    signatureSentinels,
    sourceHtml: html,
    sourceSelector,
    stripPosition,
    widths
  });
}
