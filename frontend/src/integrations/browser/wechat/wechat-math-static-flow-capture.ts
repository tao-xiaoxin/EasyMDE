import {
  CAPTURE_STYLE_PROPERTIES,
  evaluateWechatMathSourceAdmission,
  PSEUDO_ELEMENTS,
  TYPED_DIMENSION_PROPERTIES,
  typedToken,
  type WechatMathFrozenNode,
  type WechatMathRectEvidence,
  type WechatMathSourceAdmissionResult,
  type WechatMathSourceAdmissionWitness,
  type WechatMathStaticFlowRect,
  type WechatMathStaticFlowRuntime,
  type WechatMathStaticFlowTypedStyleMap,
  type WechatMathTopologyContext
} from './wechat-math-static-flow';

/**
 * Incremental source-side capture owner for R1 OFF math static flow.
 *
 * During the clipboard serializer walk, `observe()` is called on each visited
 * source element with its computed style and optional bounding rect. Only R1-
 * relevant math nodes read Typed OM, pseudo-element content, and animations,
 * and each read is performed at most once.
 *
 * `seal()` requires the observed `sourceRoot` and then produces:
 * 1. A clone-independent, relative `sourceFingerprint` normalized to the root
 *    origin and canonicalized onto `RELATIVE_COORDINATE_GRID`, reusable across
 *    ordinary page scrolls and invalidated by relative layout or admission
 *    changes.
 * 2. An immutable `capturedRuntime` that satisfies `WechatMathStaticFlowRuntime`
 *    from the frozen captured maps and the animation descriptors captured while
 *    observing, performing zero new DOM style, rect, or animation reads and
 *    failing explicitly if an unobserved element is accessed.
 */

export type WechatMathStaticFlowBaseRuntime = Readonly<{
  document?: Document;
  getAnimations: () => readonly Animation[];
  getComputedStyle: (element: Element, pseudoElement?: string) => CSSStyleDeclaration;
}>;

export type WechatMathStaticFlowSourceCaptureOptions = Readonly<{
  enabled: boolean;
  runtime: WechatMathStaticFlowBaseRuntime;
  sourceRoot: Element;
}>;

export type WechatMathStaticFlowSealedCapture = Readonly<{
  capturedRuntime: WechatMathStaticFlowRuntime;
  observedElements: ReadonlySet<Element>;
  sourceAdmission: WechatMathSourceAdmissionResult;
  sourceFingerprint: string;
  sourceRoot: Element;
  witness: WechatMathSourceAdmissionWitness;
}>;

export type WechatMathStaticFlowSourceCapture = Readonly<{
  observe: (source: Element, computed?: CSSStyleDeclaration, rect?: WechatMathStaticFlowRect | DOMRect) => void;
  seal: () => WechatMathStaticFlowSealedCapture | null;
  updateCoordinateEpoch: (freshRootRect?: DOMRect | WechatMathStaticFlowRect) => void;
}>;

/**
 * Canonical grid for every root-relative coordinate, in CSS pixels.
 *
 * Subtracting two viewport-scale doubles reintroduces low-bit noise
 * (110.2 - 100.1 = 10.100000000000009 while 610.2 - 600.1 = 10.100000000000023),
 * so an unchanged layout under an ordinary uniform fractional translation would
 * otherwise change `sourceFingerprint` by noise alone. Rounding each relative
 * result onto this grid bounds the correction at 5e-7 px: far above
 * double-subtraction noise for page-scale coordinates (about 1e-10 px at
 * 1e6 px) and 31,250 times smaller than the 1/64 px `GEOMETRY_QUANTUM` every
 * downstream admission comparison resolves. A planner decision can therefore
 * only change when a compared difference sits within 5e-7 px of that
 * threshold -- a 1e-6 px halo, 15,625 times narrower than the quantum itself.
 */
const RELATIVE_COORDINATE_GRID = 1e-6;

const RELATIVE_COORDINATE_STEPS_PER_PIXEL = 1 / RELATIVE_COORDINATE_GRID;

function canonicalRelativeCoordinate(value: number): number {
  const snapped = Math.round(value * RELATIVE_COORDINATE_STEPS_PER_PIXEL) / RELATIVE_COORDINATE_STEPS_PER_PIXEL;
  return 0 === snapped ? 0 : snapped;
}

function isR1RelevantNode(element: Element, sourceRoot: Element): boolean {
  if (element === sourceRoot) return true;
  if ('http://www.w3.org/2000/svg' === element.namespaceURI || 'svg' === element.localName.toLowerCase()) {
    return true;
  }
  const className = (element as HTMLElement).className;
  if (typeof className === 'string') {
    if (
      className.includes('vlist') ||
      className.includes('base') ||
      className.includes('pstrut') ||
      className.includes('svg-align') ||
      className.includes('katex') ||
      className.includes('mord') ||
      className.includes('mtable')
    ) {
      return true;
    }
  }
  return Boolean(element.closest?.('.katex-html, .vlist, .easymde-math-block'));
}

function captureError(code: string, cause?: unknown): Error {
  const error = new Error(`wechat-math-static-flow-${code}`);
  if (cause) (error as { cause?: unknown }).cause = cause;
  return error;
}

function freezeSet<T>(source: Set<T>): ReadonlySet<T> {
  const copy = new Set(source);
  Object.defineProperties(copy, {
    add: {
      configurable: false,
      enumerable: false,
      value: () => {
        throw new TypeError('Set is read-only');
      }
    },
    clear: {
      configurable: false,
      enumerable: false,
      value: () => {
        throw new TypeError('Set is read-only');
      }
    },
    delete: {
      configurable: false,
      enumerable: false,
      value: () => {
        throw new TypeError('Set is read-only');
      }
    }
  });
  return Object.freeze(copy);
}

export function createWechatMathStaticFlowSourceCapture(
  options: WechatMathStaticFlowSourceCaptureOptions
): WechatMathStaticFlowSourceCapture {
  if (!options.enabled) {
    return {
      observe: () => undefined,
      seal: () => null,
      updateCoordinateEpoch: () => undefined
    };
  }

  const { runtime, sourceRoot } = options;
  if (typeof runtime.getAnimations !== 'function') {
    throw captureError('animation-reader-missing');
  }

  let isSealed = false;
  let cachedSealedResult: WechatMathStaticFlowSealedCapture | null = null;
  const observedSequence: Element[] = [];
  const observedSet = new Set<Element>();
  const capturedData = new Map<Element, WechatMathFrozenNode>();
  const ancestorClassLists = new Map<Element, ReadonlySet<string>>();
  const ancestorParents = new Map<Element, Element | null>();
  let currentEpochId = 0;
  let initialRootRect: WechatMathStaticFlowRect | null = null;
  let currentRootRect: WechatMathStaticFlowRect | null = null;
  let cachedFrozenAnimations: readonly Animation[] | null = null;

  const getAnimationsOnce = (): readonly Animation[] => {
    if (null === cachedFrozenAnimations) {
      if (typeof runtime.getAnimations !== 'function') {
        throw captureError('animation-reader-missing');
      }
      let rawAnimations: readonly Animation[];
      try {
        rawAnimations = runtime.getAnimations();
      } catch (error: unknown) {
        throw captureError('animation-read-failed', error);
      }
      const frozenList: Animation[] = [];
      for (const anim of rawAnimations) {
        let target: Element | null = null;
        try {
          const effect = anim.effect;
          if (effect && typeof effect === 'object') {
            const rawTarget = (effect as KeyframeEffect).target;
            if (rawTarget instanceof Element) {
              target = rawTarget;
            }
          }
        } catch (error: unknown) {
          throw captureError('animation-read-failed', error);
        }
        frozenList.push(
          Object.freeze({
            effect: Object.freeze({
              target
            })
          }) as unknown as Animation
        );
      }
      cachedFrozenAnimations = Object.freeze(frozenList);
    }
    return cachedFrozenAnimations;
  };

  const capturedAnimations = (): readonly Animation[] => {
    if (null === cachedFrozenAnimations) {
      throw captureError('animation-snapshot-missing');
    }
    return cachedFrozenAnimations;
  };

  const animationIntersects = (element: Element): boolean => {
    const animations = getAnimationsOnce();
    return animations.some((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return Boolean(target && (target === element || target.contains(element) || element.contains(target)));
    });
  };

  const updateCoordinateEpoch = (freshRootRect?: DOMRect | WechatMathStaticFlowRect): void => {
    if (isSealed) {
      throw captureError('observe-after-seal');
    }
    currentEpochId += 1;
    const r = freshRootRect ?? sourceRoot.getBoundingClientRect();
    currentRootRect = Object.freeze({
      bottom: r.bottom,
      height: r.height,
      left: r.left,
      right: r.right,
      top: r.top,
      width: r.width
    });
  };

  const observe = (
    source: Element,
    computed?: CSSStyleDeclaration,
    rect?: WechatMathStaticFlowRect | DOMRect
  ): void => {
    if (isSealed) {
      throw captureError('observe-after-seal');
    }
    if (observedSet.has(source)) return;

    if (source === sourceRoot && rect && !initialRootRect) {
      initialRootRect = Object.freeze({
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      });
      currentRootRect = initialRootRect;
      if (sourceRoot.parentElement) {
        ancestorParents.set(sourceRoot, sourceRoot.parentElement);
        ancestorClassLists.set(sourceRoot.parentElement, Object.freeze(new Set(Array.from(sourceRoot.parentElement.classList ?? []))));
        if (sourceRoot.parentElement.parentElement) {
          ancestorParents.set(sourceRoot.parentElement, sourceRoot.parentElement.parentElement);
          ancestorClassLists.set(
            sourceRoot.parentElement.parentElement,
            Object.freeze(new Set(Array.from(sourceRoot.parentElement.parentElement.classList ?? [])))
          );
        }
      }
    } else if (null === currentRootRect) {
      const r = sourceRoot.getBoundingClientRect();
      initialRootRect = Object.freeze({
        bottom: r.bottom,
        height: r.height,
        left: r.left,
        right: r.right,
        top: r.top,
        width: r.width
      });
      currentRootRect = initialRootRect;
      if (sourceRoot.parentElement) {
        ancestorParents.set(sourceRoot, sourceRoot.parentElement);
        ancestorClassLists.set(sourceRoot.parentElement, Object.freeze(new Set(Array.from(sourceRoot.parentElement.classList ?? []))));
        if (sourceRoot.parentElement.parentElement) {
          ancestorParents.set(sourceRoot.parentElement, sourceRoot.parentElement.parentElement);
          ancestorClassLists.set(
            sourceRoot.parentElement.parentElement,
            Object.freeze(new Set(Array.from(sourceRoot.parentElement.parentElement.classList ?? [])))
          );
        }
      }
    }

    const raw = rect ?? source.getBoundingClientRect();
    const rawRect: WechatMathStaticFlowRect = Object.freeze({
      bottom: raw.bottom,
      height: raw.height,
      left: raw.left,
      right: raw.right,
      top: raw.top,
      width: raw.width
    });
    const rectEvidence: WechatMathRectEvidence = Object.freeze({
      epochId: currentEpochId,
      rawRect,
      rootRectAtEpoch: currentRootRect ?? initialRootRect ?? rawRect
    });

    // Co-sample holder ONCE if SVG is observed in a newer epoch than its holder
    if ('http://www.w3.org/2000/svg' === source.namespaceURI || 'svg' === source.localName.toLowerCase()) {
      const parentEl = source.parentElement;
      if (parentEl) {
        const holderNode = capturedData.get(parentEl);
        if (holderNode && holderNode.rectEvidence.epochId < currentEpochId) {
          const refreshed = parentEl.getBoundingClientRect();
          const refreshedRaw: WechatMathStaticFlowRect = Object.freeze({
            bottom: refreshed.bottom,
            height: refreshed.height,
            left: refreshed.left,
            right: refreshed.right,
            top: refreshed.top,
            width: refreshed.width
          });
          const updatedHolder: WechatMathFrozenNode = Object.freeze({
            ...holderNode,
            rectEvidence: Object.freeze({
              epochId: currentEpochId,
              rawRect: refreshedRaw,
              rootRectAtEpoch: currentRootRect ?? initialRootRect ?? rawRect
            })
          });
          capturedData.set(parentEl, updatedHolder);
        }
      }
    }

    const style = computed ?? runtime.getComputedStyle(source);
    const styles = Object.freeze(
      Object.fromEntries(
        CAPTURE_STYLE_PROPERTIES.map((property) => [
          property,
          style.getPropertyValue(property).trim().toLowerCase()
        ])
      )
    );

    const relevant = isR1RelevantNode(source, sourceRoot);
    let typedTokens: Readonly<Record<string, string>> = Object.freeze({});
    let pseudos: Readonly<Record<(typeof PSEUDO_ELEMENTS)[number], Readonly<{ content: string; position: string }>>> = Object.freeze({
      '::before': Object.freeze({ content: 'none', position: 'static' }),
      '::after': Object.freeze({ content: 'none', position: 'static' })
    });
    let hasAnimation = false;

    if (relevant) {
      const styleMapFactory = (source as Element & {
        computedStyleMap?: () => { get: (property: string) => unknown };
      }).computedStyleMap;
      if ('function' === typeof styleMapFactory) {
        let styleMap: { get: (property: string) => unknown };
        try {
          styleMap = styleMapFactory.call(source);
        } catch (error: unknown) {
          throw captureError('typed-om-read-failed', error);
        }
        try {
          typedTokens = Object.freeze(
            Object.fromEntries(
              TYPED_DIMENSION_PROPERTIES.map((property) => [
                property,
                typedToken(styleMap.get(property))
              ])
            )
          );
        } catch (error: unknown) {
          throw captureError('typed-om-read-failed', error);
        }
      }

      pseudos = Object.freeze(
        Object.fromEntries(
          PSEUDO_ELEMENTS.map((pseudo) => {
            const pseudoStyle = runtime.getComputedStyle(source, pseudo);
            const content = pseudoStyle.getPropertyValue('content').trim();
            const position = pseudoStyle.getPropertyValue('position').trim().toLowerCase() || 'static';
            return [pseudo, Object.freeze({ content, position })];
          })
        ) as Record<(typeof PSEUDO_ELEMENTS)[number], Readonly<{ content: string; position: string }>>
      );

      hasAnimation = animationIntersects(source);
    }

    const holderTextFlag = Array.from(source.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
    );

    const node: WechatMathFrozenNode = Object.freeze({
      animationIntersects: hasAnimation,
      key: elementKey(source),
      classList: Object.freeze(new Set(Array.from(source.classList ?? []))),
      element: source,
      holderTextFlag,
      localName: source.localName.toLowerCase(),
      namespaceURI: source.namespaceURI ?? '',
      orderedChildren: Object.freeze(Array.from(source.children)),
      parent: source.parentElement,
      pseudos,
      rectEvidence,
      styles,
      typedTokens
    });

    capturedData.set(source, node);
    observedSet.add(source);
    observedSequence.push(source);
  };

  const seal = (): WechatMathStaticFlowSealedCapture => {
    if (cachedSealedResult) {
      return cachedSealedResult;
    }
    if (!observedSet.has(sourceRoot)) {
      throw captureError('root-unobserved');
    }
    const frozenAnimations = capturedAnimations();
    for (const element of observedSequence) {
      const data = capturedData.get(element);
      if (!data) throw captureError('node-unobserved');
      for (const child of data.orderedChildren) {
        if (!observedSet.has(child) || !capturedData.has(child)) {
          throw captureError('node-unobserved');
        }
      }
    }
    isSealed = true;

    const parentIndices = new Map<Element, number>();
    observedSequence.forEach((element, index) => {
      parentIndices.set(element, index);
    });

    const entries = observedSequence.map((element, index) => {
      const data = capturedData.get(element);
      if (!data) throw captureError('node-unobserved');

      const parentIndex = data.parent ? parentIndices.get(data.parent) ?? -1 : -1;

      return {
        animation: data.animationIntersects,
        index,
        localName: data.localName,
        namespaceURI: data.namespaceURI,
        parentIndex,
        pseudos: data.pseudos,
        rect: {
          height: data.rectEvidence.rawRect.height,
          left: canonicalRelativeCoordinate(data.rectEvidence.rawRect.left - data.rectEvidence.rootRectAtEpoch.left),
          top: canonicalRelativeCoordinate(data.rectEvidence.rawRect.top - data.rectEvidence.rootRectAtEpoch.top),
          width: data.rectEvidence.rawRect.width
        },
        styles: data.styles,
        typed: data.typedTokens
      };
    });

    const capturedRuntime: WechatMathStaticFlowRuntime = Object.freeze({
      getAnimations: () => frozenAnimations,
      getComputedStyle: (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        const data = capturedData.get(element);
        if (!data) throw captureError('node-unobserved');
        if (pseudoElement) {
          const pseudoData = data.pseudos[pseudoElement as (typeof PSEUDO_ELEMENTS)[number]];
          return {
            getPropertyPriority: () => '',
            getPropertyValue: (prop: string) => {
              if ('content' === prop) return pseudoData?.content ?? 'none';
              if ('position' === prop) return pseudoData?.position ?? 'static';
              return '';
            }
          } as unknown as CSSStyleDeclaration;
        }
        return {
          getPropertyPriority: () => '',
          getPropertyValue: (prop: string) => data.styles[prop] ?? ''
        } as unknown as CSSStyleDeclaration;
      },
      getRect: (element: Element): WechatMathStaticFlowRect => {
        const data = capturedData.get(element);
        if (!data) throw captureError('node-unobserved');
        return data.rectEvidence.rawRect;
      },
      getTypedStyleMap: (element: Element): WechatMathStaticFlowTypedStyleMap => {
        const data = capturedData.get(element);
        if (!data) throw captureError('node-unobserved');
        return {
          get: (property: string) => {
            const token = data.typedTokens[property];
            if (!token || 'unknown' === token) return { value: 'auto' };
            if (token.startsWith('keyword:')) return { value: token.slice('keyword:'.length) };
            if (token.startsWith('px:')) {
              const val = Number(token.slice('px:'.length));
              return {
                text: `${val}px`,
                toString: () => `${val}px`,
                unit: 'px',
                value: val
              };
            }
            if (token.startsWith('percent:')) {
              const val = Number(token.slice('percent:'.length));
              return {
                text: `${val}%`,
                toString: () => `${val}%`,
                unit: 'percent',
                value: val
              };
            }
            return { value: token };
          }
        };
      }
    });

    const topologyContext: WechatMathTopologyContext = Object.freeze({
      ancestorClassLists: Object.freeze(ancestorClassLists),
      ancestorParents: Object.freeze(ancestorParents),
      getNode: (el) => capturedData.get(el),
      observedSequence: Object.freeze(observedSequence),
      sourceRoot
    });

    const sourceAdmission = evaluateWechatMathSourceAdmission(topologyContext);

    const sourceFingerprint = JSON.stringify({
      entries,
      root: capturedData.get(sourceRoot)?.key ?? 'unobserved',
      version: 1,
      witness: sourceAdmission.witness
    });

    cachedSealedResult = Object.freeze({
      capturedRuntime,
      observedElements: freezeSet(observedSet),
      sourceAdmission,
      sourceFingerprint,
      sourceRoot,
      witness: sourceAdmission.witness
    });
    return cachedSealedResult;
  };

  return { observe, seal, updateCoordinateEpoch };
}

function elementKey(element: Element): string {
  const className =
    'svg' === element.localName.toLowerCase()
      ? (element as SVGElement).className.baseVal
      : (element as HTMLElement).className;
  return `${element.namespaceURI ?? ''}|${element.localName.toLowerCase()}|${className}`;
}
