import { resolve } from 'node:path';
import { previewSelector } from "./environment.mjs";
import { sourceOnlyImageReadinessCodes } from "./environment.mjs";

export function runSourceOnlyImageReadinessContract({
  MutationObserverRef = globalThis.MutationObserver,
  clearTimeoutRef = clearTimeout,
  expectedRoot,
  getCurrentImages,
  getCurrentRoot,
  images,
  observeTarget = null,
  setTimeoutRef = setTimeout,
  timeoutMs = 10_000
}) {
  const initialImages = [...images];
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let observer = null;
    let remaining = initialImages.length;
    const states = new Map(initialImages.map((image) => [image, 'pending']));
    const listeners = [];

    const cleanup = () => {
      let cleanupFailed = false;
      if (timer !== null) {
        try {
          clearTimeoutRef(timer);
        } catch {
          cleanupFailed = true;
        }
        timer = null;
      }
      try {
        observer?.disconnect();
      } catch {
        cleanupFailed = true;
      }
      listeners.forEach(({ image, load, error }) => {
        try {
          image.removeEventListener('load', load);
        } catch {
          cleanupFailed = true;
        }
        try {
          image.removeEventListener('error', error);
        } catch {
          cleanupFailed = true;
        }
      });
      return cleanupFailed;
    };
    const finish = (code = null) => {
      if (settled) return;
      settled = true;
      const cleanupFailed = cleanup();
      const cleanupCode = cleanupFailed
        ? 'wechat-task-context-source-only-image-readiness-cleanup-failed'
        : null;
      if (code) {
        reject({ cleanupCode, primaryCode: code, status: 'failed' });
      } else if (cleanupCode) {
        reject({ cleanupCode, primaryCode: null, status: 'failed' });
      } else {
        resolve();
      }
    };
    const stableRootAndImages = () => {
      if (getCurrentRoot() !== expectedRoot) {
        throw new Error('wechat-task-context-source-only-image-readiness-root-changed');
      }
      const currentImages = [...getCurrentImages()];
      if (
        currentImages.length !== initialImages.length
        || currentImages.some((image, index) => image !== initialImages[index])
      ) {
        throw new Error('wechat-task-context-source-only-image-readiness-image-set-changed');
      }
    };
    const currentImagesReady = () => {
      initialImages.forEach((image) => {
        if (
          !image.complete
          || !Number.isFinite(image.naturalWidth)
          || !Number.isFinite(image.naturalHeight)
          || image.naturalWidth <= 0
          || image.naturalHeight <= 0
        ) {
          throw new Error('wechat-task-context-source-only-image-readiness-intrinsic-unavailable');
        }
      });
    };
    const failForStableState = () => {
      try {
        stableRootAndImages();
      } catch (error) {
        finish(error instanceof Error
          ? error.message
          : 'wechat-task-context-source-only-image-readiness-image-set-changed');
      }
    };
    const finishWhenStable = () => {
      try {
        stableRootAndImages();
        currentImagesReady();
        finish();
      } catch (error) {
        finish(error instanceof Error
          ? error.message
          : 'wechat-task-context-source-only-image-readiness-image-set-changed');
      }
    };
    const markReady = (image) => {
      if (settled || states.get(image) !== 'pending' || !image.complete) return;
      if (
        !Number.isFinite(image.naturalWidth)
        || !Number.isFinite(image.naturalHeight)
        || image.naturalWidth <= 0
        || image.naturalHeight <= 0
      ) {
        finish('wechat-task-context-source-only-image-readiness-intrinsic-unavailable');
        return;
      }
      if (typeof image.decode !== 'function') {
        states.set(image, 'ready');
        remaining -= 1;
        if (!remaining) finishWhenStable();
        return;
      }
      states.set(image, 'decoding');
      Promise.resolve()
        .then(() => image.decode())
        .then(
          () => {
            if (settled) return;
            states.set(image, 'ready');
            remaining -= 1;
            if (!remaining) finishWhenStable();
          },
          () => finish('wechat-task-context-source-only-image-readiness-decode-failed')
        );
    };
    try {
      if (MutationObserverRef && observeTarget) {
        observer = new MutationObserverRef(failForStableState);
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
      timer = setTimeoutRef(
        () => finish('wechat-task-context-source-only-image-readiness-timeout'),
        timeoutMs
      );
      initialImages.forEach((image) => {
        const load = () => markReady(image);
        const error = () => finish('wechat-task-context-source-only-image-readiness-error');
        listeners.push({ error, image, load });
        image.addEventListener('load', load);
        image.addEventListener('error', error);
      });
      initialImages.forEach(markReady);
      if (!initialImages.length) finishWhenStable();
    } catch {
      finish('wechat-task-context-source-only-image-readiness-listener-failed');
    }
  });
}

export async function settleAcceptedPreviewReadiness(
  page,
  selector = previewSelector,
  waitForImages = false
) {
  let result;
  try {
    result = await page.evaluate(async ({ selector: candidate, waitForImages: waitForImageResources, imageReadinessSource }) => {
      const preview = document.querySelector(candidate);
      if (!(preview instanceof Element)) {
        throw new Error('wechat-task-context-readiness-preview-missing');
      }
      const bounded = async (promise, timeoutCode) => {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(timeoutCode)), 10_000);
            })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      if (document.fonts?.ready) {
        await bounded(document.fonts.ready, 'wechat-task-context-font-readiness-timeout');
      }
      const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
      const finiteAnimations = () => document.getAnimations().filter((animation) => {
        const effect = animation.effect;
        const target = effect && 'target' in effect ? effect.target : null;
        const owner = target instanceof Element
          ? target
          : target?.parentElement ?? target?.element ?? null;
        const timing = effect && typeof effect.getComputedTiming === 'function'
          ? effect.getComputedTiming()
          : null;
        const currentTime = Number(animation.currentTime);
        const endTime = Number(timing?.endTime);
        return owner instanceof Element
          && nodes.has(owner)
          && Number.isFinite(currentTime)
          && Number.isFinite(endTime)
          && endTime > currentTime
          && ['CSSAnimation', 'CSSTransition'].includes(animation.constructor?.name ?? '');
      });
      const animations = finiteAnimations();
      await Promise.all(animations.map((animation) => bounded(
        animation.finished,
        'wechat-task-context-finite-animation-timeout'
      )));
      if (finiteAnimations().length) {
        throw new Error('wechat-task-context-finite-animation-not-settled');
      }
      if (waitForImageResources) {
        let imageReadinessContract;
        try {
          imageReadinessContract = (new Function(`return (${imageReadinessSource})`))();
        } catch {
          throw new Error('wechat-task-context-source-only-image-readiness-contract-unavailable');
        }
        const images = [...preview.querySelectorAll('img')];
        try {
          await imageReadinessContract({
            MutationObserverRef: globalThis.MutationObserver,
            expectedRoot: preview,
            getCurrentImages: () => [...preview.querySelectorAll('img')],
            getCurrentRoot: () => document.querySelector(candidate),
            images,
            observeTarget: preview.parentElement ?? preview
          });
          return { cleanupCode: null, primaryCode: null, status: 'ready' };
        } catch (failure) {
          const primaryCode = failure?.status === 'failed'
            ? failure.primaryCode
            : null;
          const cleanupCode = failure?.status === 'failed'
            ? failure.cleanupCode
            : null;
          if (
            failure?.status !== 'failed'
            || (primaryCode !== null && typeof primaryCode !== 'string')
            || (cleanupCode !== null && typeof cleanupCode !== 'string')
            || (primaryCode === null && cleanupCode === null)
          ) {
            throw new Error('wechat-task-context-source-only-image-readiness-result-invalid');
          }
          return { cleanupCode, primaryCode, status: 'failed' };
        }
      }
      return undefined;
    }, {
      imageReadinessSource: runSourceOnlyImageReadinessContract.toString(),
      selector,
      waitForImages
    });
  } catch {
    throw new Error('wechat-task-context-preview-readiness-failed');
  }
  if (!waitForImages) return;
  const primaryCode = result?.primaryCode;
  const cleanupCode = result?.cleanupCode;
  const validCode = (code) => code === null || sourceOnlyImageReadinessCodes.has(code);
  if (
    !result
    || !['ready', 'failed'].includes(result.status)
    || !validCode(primaryCode)
    || !validCode(cleanupCode)
    || (result.status === 'ready' && (primaryCode !== null || cleanupCode !== null))
    || (result.status === 'failed' && primaryCode === null && cleanupCode === null)
  ) {
    throw new Error('wechat-task-context-source-only-image-readiness-result-invalid');
  }
  if (result.status === 'failed') {
    const code = primaryCode && cleanupCode
      ? `${primaryCode};cleanup=${cleanupCode}`
      : primaryCode ?? cleanupCode;
    throw new Error(code);
  }
}
