import { SVGPathData } from 'svg-pathdata';
import {
  isTaskListCheckbox,
  TASK_LIST_CHECKBOX_CLONES,
  TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS,
  TASK_LIST_CHECKBOX_PSEUDO_CLONES,
  TASK_LIST_CHECKBOX_STATES,
  TASK_LIST_CHECKBOX_SVG_PAINT,
  taskCheckboxOutputMarkers,
  type TaskCheckboxStaticPaintExpectation } from './wechat-clone-metadata';
import { type BrowserWechatClipboardRuntime, throwIfBackgroundPreparationAborted } from './wechat-clipboard-runtime';
import {
  TASK_CHECKBOX_BORDER_SIDES,
  TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES } from './wechat-task-layout-policy';
import {
  captureTaskCheckboxCaptionRun,
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
  taskCheckboxCaptionSequencePath
} from './wechat-task-caption';

export function replaceTaskListCheckboxClones(
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

export function taskCheckboxPaintValueIsVisible(property: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['none', 'normal', 'transparent'].includes(normalized)) return false;
  if ('background-color' === property && /^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(normalized)) {
    return false;
  }
  return true;
}

export function taskCheckboxBorderWidthIsVisible(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && !['0', '0px', 'none'].includes(normalized));
}

export function taskCheckboxStaticPaintProperties(computed: CSSStyleDeclaration): string[] {
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

export function taskCheckboxStaticPaintExpectationFor(clone: Element): TaskCheckboxStaticPaintExpectation {
  let expectation = TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.get(clone);
  if (!expectation) {
    expectation = { baseProperties: [], pseudos: new Map() };
    TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.set(clone, expectation);
  }
  return expectation;
}

export function taskCheckboxOutputPropertyIsVisible(owner: Element, property: string): boolean {
  const style = (owner as Element & { style?: CSSStyleDeclaration }).style;
  const value = style?.getPropertyValue(property) ?? '';
  if (property.endsWith('-width')) return taskCheckboxBorderWidthIsVisible(value);
  return taskCheckboxPaintValueIsVisible(property, value);
}

export function taskCheckboxSvgPaintSignature(svg: Element): string | null {
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

export function assertTaskCheckboxAppearancePortable(source: Element, computed: CSSStyleDeclaration): void {
  if (!isTaskListCheckbox(source)) return;
  const appearance =
    computed.getPropertyValue('appearance').trim().toLowerCase() ||
    computed.getPropertyValue('-webkit-appearance').trim().toLowerCase();
  if (appearance && 'none' !== appearance) {
    throw new Error('wechat-task-checkbox-native-paint-unavailable');
  }
}

export const PSEUDO_SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const SAFE_PSEUDO_SVG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
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
export const SAFE_PSEUDO_SVG_COLOR =
  /^(?:currentcolor|none|transparent|black|white|red|green|blue|yellow|gray|grey|#[\da-f]{3,8}|rgba?\([^)]{1,80}\))$/iu;
export const SAFE_PSEUDO_SVG_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;
export const SAFE_PSEUDO_SVG_VIEWBOX = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[\s,]+-?(?:\d+(?:\.\d+)?|\.\d+)){3}$/u;

export function finitePositiveSvgNumber(value: string, maximum = 4_096): number | null {
  if (!SAFE_PSEUDO_SVG_NUMBER.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? number : null;
}

export function finiteSvgOpacity(value: string): boolean {
  if (!SAFE_PSEUDO_SVG_NUMBER.test(value.trim())) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}

export function pseudoSvgContent(value: string, ownerDocument: Document): SVGSVGElement | null {
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

export async function validateTaskCheckboxSvgPaint(
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

export function isTaskSvgPseudoContent(source: Element, rawContent: string): boolean {
  return (
    isTaskListCheckbox(source) &&
    /^url\(\s*(?:"|')?data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,/iu.test(rawContent.trim())
  );
}

export function restoreTaskListCheckboxOwnerState(root: HTMLElement): void {
  root.querySelectorAll('*').forEach((element) => {
    if (!TASK_LIST_CHECKBOX_CLONES.has(element)) return;
    const state = TASK_LIST_CHECKBOX_STATES.get(element);
    if (!state) throw new Error('wechat-task-checkbox-state-missing');
    element.setAttribute('role', 'checkbox');
    element.setAttribute('aria-checked', state.checked ? 'true' : 'false');
    element.setAttribute('aria-disabled', 'true');
  });
}

export function assertTaskCheckboxStaticOwnerBase(source: Element, clone: Element): void {
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

export function assertTaskCheckboxStaticOwners(sourceInputs: readonly HTMLInputElement[], root: HTMLElement): void {
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

/**
 * Keeps task paint layers and empty unchecked owners alive through native
 * WeChat Paste/Save without introducing a sibling carrier for painted pseudos.
 * The caller owns the root-scoped text normalization map used by text/plain.
 */
export function normalizeTaskCheckboxTransport(
  normalized: HTMLElement,
  exportTextNormalizations: Map<Text, Readonly<{ original: string; encoded: string }>>
): void {
  normalized.querySelectorAll('span[aria-hidden="true"]').forEach((element) => {
    const pseudo = TASK_LIST_CHECKBOX_PSEUDO_CLONES.get(element);
    if (!pseudo) return;
    const owner = element.parentElement;
    const expectation = owner ? TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.get(owner)?.pseudos.get(pseudo) : undefined;
    if (expectation?.requiresText) {
      if (!element.childNodes.length) throw new Error('wechat-task-checkbox-paint-layer-empty');
      return;
    }
    const textNodes = Array.from(element.childNodes).filter((node): node is Text => node.nodeType === 3);
    const textNode = 1 === textNodes.length ? textNodes[0] : null;
    if (textNode && ' ' === textNode.nodeValue) {
      textNode.nodeValue = '\u2060';
      exportTextNormalizations.set(textNode, { original: '', encoded: '\u2060' });
      return;
    }
    if (!element.childNodes.length) throw new Error('wechat-task-checkbox-paint-layer-empty');
  });

  normalized
    .querySelectorAll<HTMLElement>('[role="checkbox"][aria-checked="false"][aria-disabled="true"]')
    .forEach((owner) => {
      if (owner.childElementCount || owner.textContent?.trim()) return;
      const carrier = normalized.ownerDocument.createElement('span');
      carrier.setAttribute('aria-hidden', 'true');
      const textNode = normalized.ownerDocument.createTextNode('\u2060');
      carrier.appendChild(textNode);
      owner.appendChild(carrier);
      exportTextNormalizations.set(textNode, { encoded: '\u2060', original: '' });
    });
}
