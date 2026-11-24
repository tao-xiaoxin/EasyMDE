import {
  materializeBackgroundValue,
  type BackgroundAssetCache,
} from './wechat-background-images';
import type { BrowserWechatClipboardRuntime, SerializationYield } from './wechat-clipboard-runtime';
import {
  COPY_STYLE_PROPERTIES,
  NATIVE_LAYOUT_PROPERTIES,
  ORDINARY_LAYOUT_PROPERTIES,
  SPECIAL_LAYOUT_PROPERTIES,
  SVG_STYLE_PROPERTIES,
  keepStyle,
  removeTransientAttributes,
  supportsSpecialLayout,
} from './wechat-style-policy';
import type {
  ImageUploadFailureSideEffects,
  ImageUploadPort,
} from '../../../contracts/ports/image-upload-port';
import {
  MAX_WECHAT_PNG_PIXELS,
  MAX_WECHAT_PNG_TOTAL_BYTES,
  MAX_WECHAT_PNG_TOTAL_PIXELS,
  MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
  type WechatPngConversionContext,
  WechatPngConversionError,
  type WechatPngFailureStage,
  assertInlineRasterizationResult,
  assertPngConversionCurrent,
  exceedsRasterizationDimensionBudget,
  pngConversionErrorCode,
  pngFailureDiagnostic,
  requiresInlineBaseline,
  responsiveRasterizationResultMatchesRequest,
  safeUploadedImageUrl,
  validRasterizationResult,
} from './wechat-png-conversion-policy';
import {
  WECHAT_COPY_TIMING_NAMES,
  createRasterizationYield,
  withTimeout,
} from './wechat-clipboard-runtime';
import {
  WECHAT_PNG_VISUAL_CLONES,
  isSvgElement,
} from './wechat-clone-metadata';
import {
  type WechatTimingHandle,
  type WechatTimingMetadata,
  type WechatTimingMode,
  beginWechatTiming,
} from './wechat-timing';
import type {
  WechatVisualMermaidBackground,
  WechatVisualRasterizationKind,
  WechatVisualRasterizationMermaidLayoutRole,
  WechatVisualRasterizationRequest,
  WechatVisualRasterizationResult,
  WechatVisualRasterizationYield,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import { mermaidLayoutMagnification } from './wechat-mermaid-geometry';
import {
  MERMAID_INTRINSIC_LAYOUT_ROLES,
  mermaidDirectSvg,
  mermaidSourceUsesAutoBlockMargins,
} from './wechat-mermaid-geometry';
import {
  capturePlanMode,
  createCapturePlan,
  mermaidIntrinsicScrollDimensions,
  recordMermaidCaptureSnapshot,
  snapshotMathCaptureNode,
  type CompletedUpload,
  type WechatMathCaptureSnapshot,
  type VisualCandidate,
  type WechatCapturePlan,
} from './wechat-capture-plan';
import { findKaTeXMathMl } from './wechat-portable-content';
import { replaceCompletedVisuals } from './wechat-png-replacement';

const MERMAID_BACKGROUND_CANVAS_SELECTORS =
  '.easymde-immersive-preview-canvas, .easymde-preview-scroll, .easymde-immersive-surface, .easymde-immersive-preview-surface';

function hasVisibleBackgroundColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || 'transparent' === normalized || 'none' === normalized) {
    return false;
  }
  if (/^#[\da-f]{4}$/u.test(normalized)) {
    return Number.parseInt(normalized.slice(4, 5), 16) > 0;
  }
  if (/^#[\da-f]{8}$/u.test(normalized)) {
    return Number.parseInt(normalized.slice(7, 9), 16) > 0;
  }
  const fnMatch =
    /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/u.exec(normalized);
  if (!fnMatch) return true;
  const body = fnMatch[1]?.trim() ?? '';
  let alphaToken = '';
  if (body.includes('/')) {
    alphaToken = body.slice(body.lastIndexOf('/') + 1).trim();
  } else if (/^(?:rgba?|hsla?)\(/u.test(normalized)) {
    const components = body.split(',');
    if (components.length >= 4) {
      alphaToken = (components[components.length - 1] ?? '').trim();
    }
  }
  if (!alphaToken) return true;
  if ('none' === alphaToken) return false;
  const alphaMatch = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%?)$/u.exec(alphaToken);
  if (!alphaMatch) return true;
  const parsed = Number.parseFloat(alphaMatch[1] ?? '');
  return Number.isFinite(parsed) ? parsed > 0 : true;
}

function hasBackgroundImage(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
      'none' !== normalized &&
      'initial' !== normalized &&
      'inherit' !== normalized &&
      'unset' !== normalized
  );
}

function isSafeBackgroundImage(value: string): boolean {
  if (!hasBackgroundImage(value)) return false;
  return !/(?:url\s*\(|image-set\s*\(|(?:^|[\s,(])image\s*\(|src\s*\(|element\s*\()/iu.test(value);
}

function readStyleProperty(
  style: CSSStyleDeclaration,
  property:
    | 'background-color'
    | 'background-image'
    | 'background-position'
    | 'background-repeat'
    | 'background-size',
  camelProperty:
    | 'backgroundColor'
    | 'backgroundImage'
    | 'backgroundPosition'
    | 'backgroundRepeat'
    | 'backgroundSize'
): string {
  const viaMethod =
    'function' === typeof style.getPropertyValue
      ? style.getPropertyValue(property).trim()
      : '';
  if (viaMethod) return viaMethod;
  const viaField = style[camelProperty];
  return 'string' === typeof viaField ? viaField.trim() : '';
}

function isMermaidBackgroundWalkStopBefore(element: Element, doc: Document): boolean {
  if (
    element === doc.body ||
    element === doc.documentElement ||
    element.hasAttribute('data-easymde-wechat-measure-host')
  ) {
    return true;
  }
  const id = element.id.trim().toLowerCase();
  return 'wpbody' === id || 'wpwrap' === id || 'wpcontent' === id || 'wpbody-content' === id;
}

function shouldStopAfterMermaidBackgroundElement(element: Element): boolean {
  if (!element.matches(MERMAID_BACKGROUND_CANVAS_SELECTORS)) return false;
  return !element.parentElement?.matches(MERMAID_BACKGROUND_CANVAS_SELECTORS);
}

function resolveMermaidInheritedBackground(
  startElement: Element,
  runtime: BrowserWechatClipboardRuntime
): WechatVisualMermaidBackground | null {
  const doc = startElement.ownerDocument;
  for (let element: Element | null = startElement; element; element = element.parentElement) {
    if (isMermaidBackgroundWalkStopBefore(element, doc)) break;
    const computed = runtime.getComputedStyle(element);
    const color = readStyleProperty(computed, 'background-color', 'backgroundColor');
    const image = readStyleProperty(computed, 'background-image', 'backgroundImage');
    const hasColor = hasVisibleBackgroundColor(color);
    const hasImage = hasBackgroundImage(image);
    if (hasColor || hasImage) {
      const safeImage = hasImage && isSafeBackgroundImage(image);
      const position = safeImage ? readStyleProperty(computed, 'background-position', 'backgroundPosition') : '';
      const size = safeImage ? readStyleProperty(computed, 'background-size', 'backgroundSize') : '';
      const repeat = safeImage ? readStyleProperty(computed, 'background-repeat', 'backgroundRepeat') : '';
      const background: WechatVisualMermaidBackground = {
        ...(hasColor ? { color } : {}),
        ...(safeImage ? { image } : {}),
        ...(safeImage && position ? { position } : {}),
        ...(safeImage && size ? { size } : {}),
        ...(safeImage && repeat ? { repeat } : {})
      };
      return background.color || background.image ? background : null;
    }
    if (shouldStopAfterMermaidBackgroundElement(element)) break;
  }
  return null;
}

export function nativeVisualStyleProperties(source: Element, _computed: CSSStyleDeclaration): readonly string[] {
  const layoutProperties = [
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : ORDINARY_LAYOUT_PROPERTIES),
    ...NATIVE_LAYOUT_PROPERTIES
  ];
  return [
    ...new Set([...COPY_STYLE_PROPERTIES, ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []), ...layoutProperties])
  ];
}

export async function nativeVisualStyleDeclarations(
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

export async function createNativeVisualCaptureClone(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null,
  context: WechatPngConversionContext
): Promise<Readonly<{ cleanup: () => void; element: Element; mathCaptureSnapshot: WechatMathCaptureSnapshot | null }>> {
  const clone = source.cloneNode(true) as Element;
  const mathOwner = source.matches('.easymde-math-block') ? source : null;
  const mathNodes = mathOwner
    ? new Set<Element>([mathOwner, ...Array.from(mathOwner.querySelectorAll('.katex-display, .katex, .katex-html'))])
    : null;
  const mathSnapshots = new Map<Element, ReturnType<typeof snapshotMathCaptureNode>>();
  const walk = async (sourceNode: Node, cloneNode: Node): Promise<void> => {
    assertPngConversionCurrent(context);
    if (!(sourceNode instanceof Element) || !(cloneNode instanceof Element)) return;
    const computed = runtime.getComputedStyle(sourceNode);
    if (mathNodes?.has(sourceNode)) {
      mathSnapshots.set(sourceNode, snapshotMathCaptureNode(sourceNode, computed));
    }
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
  const mathCaptureSnapshot: WechatMathCaptureSnapshot | null = mathOwner
    ? {
      owner: mathSnapshots.get(mathOwner) ?? (() => {
        throw new WechatPngConversionError('wechat-png-rasterization-failed');
      })(),
      shells: Array.from(mathNodes ?? []).slice(1).flatMap((node) => {
        const snapshot = mathSnapshots.get(node);
        return snapshot ? [snapshot] : [];
      }),
    }
    : null;
  return { cleanup: () => undefined, element: clone, mathCaptureSnapshot };
}

export function restoreVerifiedMermaidCaptureIdentity(clone: Element, role: WechatVisualRasterizationMermaidLayoutRole): void {
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

function createRasterizationRequest(
  plan: WechatCapturePlan,
  source: Element,
  context: WechatPngConversionContext,
  yieldToBrowser: WechatVisualRasterizationYield | undefined,
  inheritedBackground: WechatVisualMermaidBackground | null
): WechatVisualRasterizationRequest {
  const requestBase = {
    height: plan.captureSize.height,
    maxPixels: MAX_WECHAT_PNG_PIXELS,
    scale: context.scale,
    signal: context.signal,
    source,
    width: plan.captureSize.width,
    ...(yieldToBrowser ? { yieldToBrowser } : {})
  };
  const mermaidBackground = inheritedBackground ? { inheritedBackground } : {};
  switch (plan.mode) {
    case 'math-block':
      return { ...requestBase, kind: 'math', mathCapture: plan.mathCapture };
    case 'math-inline':
      return {
        ...requestBase,
        ...(plan.inlineParent ? { inlineParent: plan.inlineParent } : {}),
        kind: 'math',
        mathCapture: plan.mathCapture,
      };
    case 'mermaid-root':
      return { ...requestBase, ...mermaidBackground, kind: 'mermaid', layoutMagnification: plan.layoutMagnification };
    case 'mermaid-intrinsic':
      return {
        ...requestBase,
        ...mermaidBackground,
        kind: 'mermaid',
        layoutMagnification: plan.layoutMagnification,
        mermaidCapture: 'intrinsic-viewport',
      };
    case 'mermaid-responsive':
      return {
        ...requestBase,
        ...mermaidBackground,
        kind: 'mermaid',
        layoutMagnification: plan.layoutMagnification,
        mermaidCapture: 'responsive-viewport',
      };
  }
}

export async function replaceVisualObjects(
  root: HTMLElement,
  context: WechatPngConversionContext,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null
): Promise<void> {
  const candidates: VisualCandidate[] = [];
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
  type Candidate = VisualCandidate;
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
    plan: WechatCapturePlan
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
      completedUploads[index] = { ...plan, candidate, rasterized, url };
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
          recordMermaidCaptureSnapshot(
            context.mermaidSnapshots,
            candidate.source,
            runtime,
            preflightDimensions,
            mermaidSourceUsesAutoBlockMargins(candidate.source, runtime)
          );
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
      let layoutMagnification: number | null = null;
      let plan: WechatCapturePlan;
      let rasterized: WechatVisualRasterizationResult;
      let failureStage: WechatPngFailureStage = 'layout';
      let rasterizationTiming: WechatTimingHandle | null = null;
      try {
        layoutMagnification =
          'mermaid' === candidate.kind ? mermaidLayoutMagnification(candidate.source, runtime) : null;
        failureStage = 'intrinsic-gate';
        const intrinsicDimensions =
          'mermaid' === candidate.kind && null !== layoutMagnification
            ? mermaidIntrinsicScrollDimensions(candidate.source, runtime, layoutMagnification, context.captureBoundary)
            : null;
        if ('mermaid' === candidate.kind) {
          const snapshot = context.mermaidSnapshots.get(candidate.source);
          if (!snapshot || snapshot.mode !== capturePlanMode(intrinsicDimensions)) {
            throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
          }
        }
        if (intrinsicDimensions?.capture === 'intrinsic-viewport') {
          restoreVerifiedMermaidCaptureIdentity(capture.element, intrinsicDimensions.role);
        }
        geometryTiming.finish('success');
        let mermaidAutoMargins = false;
        if ('mermaid' === candidate.kind) {
          const snapshot = context.mermaidSnapshots.get(candidate.source);
          if (!snapshot) throw new WechatPngConversionError('wechat-png-rasterization-failed');
          mermaidAutoMargins = snapshot.autoMargins;
        }
        plan = createCapturePlan(
          candidate,
          capture.mathCaptureSnapshot,
          sourceRect,
          inlineVisual,
          geometryParent,
          'mermaid' === candidate.kind && null !== layoutMagnification
            ? { autoMargins: mermaidAutoMargins, dimensions: intrinsicDimensions, layoutMagnification }
            : null
        );
        const rasterSource = 'mermaid-responsive' === plan.mode ? mermaidDirectSvg(capture.element) : capture.element;
        if (!rasterSource) throw new WechatPngConversionError('wechat-png-rasterization-failed');
        const inheritedBackground =
          'mermaid' === candidate.kind
            ? resolveMermaidInheritedBackground(
                'mermaid-responsive' === plan.mode
                  ? (mermaidDirectSvg(candidate.source) ?? candidate.source)
                  : candidate.source,
                runtime
              )
            : null;
        failureStage = 'rasterization';
        rasterizationTiming = beginWechatTiming(
          timingPerformance,
          WECHAT_COPY_TIMING_NAMES.candidateRasterization,
          timingMetadata(index, candidate.kind, 'async')
        );
        const rasterization = withTimeout(
          context.rasterizationPort.rasterize(
            createRasterizationRequest(plan, rasterSource, context, rasterizationYield, inheritedBackground)
          ),
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
        'mermaid-responsive' === plan.mode &&
        !responsiveRasterizationResultMatchesRequest(
          rasterized,
          plan.captureSize.width,
          plan.captureSize.height,
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

      const upload = uploadVisual(candidate, rasterized, index, plan);
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
    replaceCompletedVisuals(root, context, completedUploads);
  } catch (error: unknown) {
    uploadController.abort();
    throw error;
  } finally {
    removeConversionAbort();
  }
}
