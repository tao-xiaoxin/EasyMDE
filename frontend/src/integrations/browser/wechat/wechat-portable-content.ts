import {
  CODE_FRAME_HEADER_CLONES,
  CODE_FRAME_PSEUDO_CLONES,
  EXPORT_TEXT_NORMALIZATIONS,
  MATH_BLOCK_ROOTS,
  MATH_CLONE_ROLES,
  MERMAID_FOREIGN_OBJECTS,
  WECHAT_PNG_GENERATED_IMAGES
} from './wechat-clone-metadata';
import { markWechatOwnedScrollOwner } from './wechat-list-table-layout';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { appendDeclarations, generatedBlockImageAlignment } from './wechat-style-policy';
import { replaceDeclarations } from './wechat-style-declarations';

export const KATEX_VISUAL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal',
  'max-width:none'
] as const;
export const MERMAID_LABEL_LAYOUT_DECLARATIONS = ['white-space:nowrap', 'word-break:normal', 'overflow-wrap:normal'] as const;
export const MERMAID_LABEL_WIDTH_SCALE = 1.5;
export const MERMAID_LABEL_WIDTH_GUTTER = 32;

export function normalizeCodeFrames(root: HTMLElement): void {
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

export function wrapMermaidLabelContents(root: HTMLElement): void {
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

export function expandMermaidLabelGeometry(root: HTMLElement): void {
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

export function preserveMermaidLabelWhitespace(root: HTMLElement): void {
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

export function normalizeMathBlocks(root: HTMLElement): void {
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
      // Keep the outer block as the only scroll owner: the KaTeX display layer
      // spans the destination container so short formulas keep centering on the
      // destination card, while every intrinsic layer below it keeps
      // `max-content` so nothing clips an over-wide formula out of the scroll
      // range.
      const layoutRoot = element.firstElementChild;
      if (!layoutRoot) return;
      if (WECHAT_PNG_GENERATED_IMAGES.has(layoutRoot)) {
        generatedBlockImageAlignment(layoutRoot, element);
        return;
      }
      replaceDeclarations(layoutRoot, ['inline-size:100%', 'max-inline-size:100%', 'width:auto'], true);
      appendDeclarations(layoutRoot, ['box-sizing:border-box', 'text-align:center'], true);

      const intrinsicWidthDeclarations = [
        'inline-size:max-content',
        'min-inline-size:max-content',
        'max-inline-size:none',
        'width:max-content',
        'min-width:max-content',
        'max-width:none'
      ];
      const visualWrapper = layoutRoot.firstElementChild;
      if (visualWrapper?.matches('nobr')) {
        replaceDeclarations(visualWrapper, intrinsicWidthDeclarations, true);
        appendDeclarations(
          visualWrapper,
          [
            'box-sizing:border-box',
            // Auto margins center the intrinsic visual box while it fits and
            // resolve to zero once it overflows, so a long formula stays
            // reachable from either end of the outer scroll owner instead of
            // centering into unreachable inline-start overflow.
            'margin-left:auto',
            'margin-right:auto',
            'text-align:center'
          ],
          true
        );
        const visualRoot = visualWrapper.firstElementChild;
        if (visualRoot) {
          replaceDeclarations(visualRoot, intrinsicWidthDeclarations, true);
          appendDeclarations(visualRoot, ['box-sizing:border-box', 'text-align:center'], true);
          const htmlShells = Array.from(visualRoot.children).filter(
            (candidate) => 'html' === MATH_CLONE_ROLES.get(candidate)?.role
          );
          const [htmlShell] = htmlShells;
          if (1 === htmlShells.length && htmlShell && MATH_CLONE_ROLES.get(htmlShell)?.canReleaseOuterAllocation) {
            // Only the proven outer HTML shell may release the stale source
            // column width. Inner KaTeX dimensions remain untouched.
            replaceDeclarations(htmlShell, intrinsicWidthDeclarations, true);
          }
        }
      }
    });
}

export function wrapCodeLines(root: HTMLElement): void {
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

export function preserveCodeLineWhitespace(root: HTMLElement): void {
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

export function normalizeCodeWhitespace(root: HTMLElement): void {
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

export function wrapCodeRows(root: HTMLElement): void {
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

export function materializeCodeLineBreaks(root: HTMLElement): void {
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

export const WECHAT_TOPIC_STOP_CHARACTER = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|[\u3000-\u303F\uFF00-\uFFEF]/;

export function findKaTeXMathMl(root: HTMLElement): Set<Element> {
  // WeChat imports KaTeX's MathML and visual trees as separate text runs.
  return new Set(root.querySelectorAll('.katex-mathml'));
}
