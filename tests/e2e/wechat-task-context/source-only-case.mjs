import { expect } from '@playwright/test';
import { chmod, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CDP_GEOMETRY_PAUSE_TIMEOUT_MS } from "./geometry-measures.mjs";
import { assertCanonicalSource } from "./editor-session.mjs";
import { collectSourceOnlyCdpEvidence } from "./stage-b-geometry.mjs";
import { middleLineInventory } from "./cdp-geometry.mjs";
import { previewSelector } from "./environment.mjs";
import { readSourceOnlyStyleCapability } from "./editor-session.mjs";
import { settleAcceptedPreviewReadiness } from "./image-readiness.mjs";
import { stableSourceOnlyCode } from "./geometry-measures.mjs";
import { taskStates } from "./environment.mjs";
import { waitForAcceptedPreview } from "./editor-session.mjs";
import { waitForLoadedArticleThemeCss } from "./editor-session.mjs";
import { waitForVisibleSelector } from "./editor-session.mjs";

export async function installSourceOnlyMutationEvidence(page, selector) {
  return page.evaluate((candidate) => {
    const root = document.querySelector(candidate);
    if (!(root instanceof HTMLElement)) throw new Error('wechat-task-context-source-only-root-missing');
    const source0 = root.querySelector('input[type="checkbox"]');
    if (!(source0 instanceof HTMLInputElement)) {
      throw new Error('wechat-task-context-source-only-input-missing');
    }
    const sourceImages = [...root.querySelectorAll('img')];
    const imageErrorEvents = sourceImages.map(() => 0);
    const imageErrorListeners = sourceImages.map((image, index) => {
      const listener = () => {
        imageErrorEvents[index] += 1;
      };
      image.addEventListener('error', listener);
      return { image, listener };
    });
    const finite = (value) => Number.isFinite(value);
    const numericCss = (value) => {
      const number = Number.parseFloat(value);
      return finite(number) ? number : null;
    };
    const matrixCss = (value) => {
      try {
        const matrix = new DOMMatrixReadOnly(value === 'none'
          ? 'matrix(1, 0, 0, 1, 0, 0)'
          : value);
        const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
        return {
          finite2d: matrix.is2D === true && values.every(finite),
          values: values.every(finite) ? values : null
        };
      } catch {
        return { finite2d: false, values: null };
      }
    };
    const imageResourceReadiness = () => {
      const images = sourceImages.map((image, index) => {
        const rect = image.getBoundingClientRect();
        const complete = image.complete === true;
        const naturalWidth = finite(image.naturalWidth) ? image.naturalWidth : null;
        const naturalHeight = finite(image.naturalHeight) ? image.naturalHeight : null;
        const intrinsic = naturalWidth !== null
          && naturalHeight !== null
          && naturalWidth > 0
          && naturalHeight > 0;
        const observedErrorCount = imageErrorEvents[index] ?? 0;
        const status = !complete
          ? 'incomplete'
          : intrinsic
            ? 'complete-intrinsic'
            : observedErrorCount > 0
              ? 'complete-error-observed'
              : 'complete-no-intrinsic';
        const flowBlock = image.closest(
          'p, figure, li, blockquote, pre, table, section, article, div'
        );
        const flowRect = flowBlock instanceof HTMLElement
          ? flowBlock.getBoundingClientRect()
          : null;
        return {
          complete,
          decodeApiAvailable: typeof image.decode === 'function',
          errorEventCount: observedErrorCount,
          index,
          naturalHeight,
          naturalWidth,
          nearestFlowBlockHeight: flowRect && finite(flowRect.height)
            ? flowRect.height
            : null,
          renderedHeight: finite(rect.height) ? rect.height : null,
          renderedWidth: finite(rect.width) ? rect.width : null,
          status
        };
      });
      return {
        completeCount: images.filter(({ complete }) => complete).length,
        completeNoIntrinsicCount: images.filter(({ status }) => (
          status === 'complete-no-intrinsic'
        )).length,
        intrinsicCount: images.filter(({ naturalWidth, naturalHeight }) => (
          naturalWidth !== null
          && naturalHeight !== null
          && naturalWidth > 0
          && naturalHeight > 0
        )).length,
        observedErrorEventCount: images.reduce(
          (total, { errorEventCount }) => total + errorEventCount,
          0
        ),
        total: images.length,
        images
      };
    };
    const fontFaceReadiness = () => {
      const fonts = document.fonts;
      if (!fonts) {
        return {
          available: false,
          counts: { error: null, loaded: null, loading: null, unloaded: null },
          status: 'unavailable'
        };
      }
      const counts = { error: 0, loaded: 0, loading: 0, unloaded: 0 };
      try {
        for (const face of fonts) {
          if (Object.prototype.hasOwnProperty.call(counts, face.status)) {
            counts[face.status] += 1;
          }
        }
        const status = ['loading', 'loaded'].includes(fonts.status)
          ? fonts.status
          : 'unavailable';
        return {
          available: status !== 'unavailable',
          counts,
          status
        };
      } catch {
        return {
          available: false,
          counts: { error: null, loaded: null, loading: null, unloaded: null },
          status: 'unavailable'
        };
      }
    };
    const animationReadiness = () => {
      if (typeof document.getAnimations !== 'function') {
        return { activeCount: null, available: false, scopedCount: null };
      }
      const nodes = new Set([root, ...root.querySelectorAll('*')]);
      try {
        const scoped = document.getAnimations().filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const owner = target instanceof Element
            ? target
            : target?.parentElement ?? target?.element ?? null;
          return owner instanceof Element
            && nodes.has(owner)
            && ['CSSAnimation', 'CSSTransition'].includes(animation.constructor?.name ?? '');
        });
        const active = scoped.filter((animation) => {
          const effect = animation.effect;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const currentTime = Number(animation.currentTime);
          const endTime = Number(timing?.endTime);
          return Number.isFinite(currentTime)
            && Number.isFinite(endTime)
            && endTime > currentTime;
        });
        return { activeCount: active.length, available: true, scopedCount: scoped.length };
      } catch {
        return { activeCount: null, available: false, scopedCount: null };
      }
    };
    const cssShape = (element, pseudo = undefined) => {
      const computed = getComputedStyle(element, pseudo);
      return {
        display: computed.display,
        float: computed.float,
        height: numericCss(computed.height),
        position: computed.position,
        transform: matrixCss(computed.transform),
        width: numericCss(computed.width),
        ...(pseudo
          ? { contentSvg: /svg/iu.test(computed.content) }
          : {})
      };
    };
    const middleLineInventory = (element) => {
      const owner = [...element.children].find((child) => (
        child !== source0
        && !child.querySelector('input[type="checkbox"]')
        && child instanceof HTMLElement
        && ['inline', 'inline-block', 'inline-flex', 'inline-grid'].includes(
          getComputedStyle(child).display
        )
        && Boolean(child.textContent?.trim())
      ));
      if (!(owner instanceof HTMLElement)) return { lineCount: null, status: 'unavailable' };
      const range = document.createRange();
      range.selectNodeContents(owner);
      const rects = [...range.getClientRects()].filter((rect) => (
        finite(rect.width)
        && finite(rect.height)
        && rect.width > 0
        && rect.height > 0
      ));
      if (!rects.length) return { lineCount: null, status: 'unavailable' };
      return { lineCount: rects.length, status: 'ready' };
    };
    const renderedSnapshot = () => {
      const checkedVector = [...root.querySelectorAll('input[type="checkbox"]')]
        .map((input) => input instanceof HTMLInputElement && input.checked === true);
      const item = source0.closest('li.task-list-item, li');
      if (!(item instanceof HTMLElement)) {
        return {
          actualCss: null,
          checkedCount: checkedVector.filter(Boolean).length,
          checkedVector,
          inputCount: root.querySelectorAll('input[type="checkbox"]').length,
          uncheckedCount: checkedVector.filter((checked) => !checked).length,
          middleLine: { lineCount: null, status: 'unavailable' }
        };
      }
      return {
        actualCss: {
          input: cssShape(source0),
          inputBefore: cssShape(source0, '::before'),
          li: cssShape(item),
          root: cssShape(root)
        },
        checkedCount: checkedVector.filter(Boolean).length,
        checkedVector,
        inputCount: root.querySelectorAll('input[type="checkbox"]').length,
        middleLine: middleLineInventory(item),
        uncheckedCount: checkedVector.filter((checked) => !checked).length
      };
    };
    const snapshot = () => ({
      accepted: root.getAttribute('data-easymde-preview-accepted'),
      busy: root.getAttribute('aria-busy'),
      error: root.getAttribute('data-easymde-preview-error'),
      inputCount: root.querySelectorAll('input[type="checkbox"]').length,
      resources: {
        animations: animationReadiness(),
        fonts: fontFaceReadiness(),
        images: imageResourceReadiness()
      },
      rootConnected: root.isConnected,
      rendered: renderedSnapshot(),
      signature: typeof root.easymdePreviewSignature === 'string'
        ? root.easymdePreviewSignature
        : null,
      source0Connected: source0.isConnected
    });
    const mutationState = () => ({
      attributeNames: [],
      attributes: 0,
      characterData: 0,
      childList: 0,
      records: 0
    });
    const state = {
      mutations: mutationState(),
      source0Mutations: mutationState()
    };
    const affectsSource0 = (record) => (
      record.target === source0
      || (record.target instanceof Node && source0.contains(record.target))
      || (record.target instanceof Node && record.target.contains(source0))
    );
    const recordMutations = (records) => {
      records.forEach((record) => {
        state.mutations.records += 1;
        if (record.type === 'attributes') {
          state.mutations.attributes += 1;
          if (record.attributeName && !state.mutations.attributeNames.includes(record.attributeName)) {
            state.mutations.attributeNames.push(record.attributeName);
          }
        } else if (record.type === 'characterData') {
          state.mutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.mutations.childList += 1;
        }
        if (affectsSource0(record)) {
          state.source0Mutations.records += 1;
          if (record.type === 'attributes') {
            state.source0Mutations.attributes += 1;
            if (record.attributeName && !state.source0Mutations.attributeNames.includes(record.attributeName)) {
              state.source0Mutations.attributeNames.push(record.attributeName);
            }
          } else if (record.type === 'characterData') {
            state.source0Mutations.characterData += 1;
          } else if (record.type === 'childList') {
            state.source0Mutations.childList += 1;
          }
        }
      });
    };
    const observer = new MutationObserver(recordMutations);
    observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
    const initial = snapshot();
    const publicSnapshot = ({ signature, ...value }) => ({
      ...value,
      signaturePresent: typeof signature === 'string'
    });
    globalThis.__wechatSourceOnlyEvidence = {
      finish() {
        try {
          recordMutations(observer.takeRecords());
          observer.disconnect();
          const final = snapshot();
          return {
            actualCssSame: JSON.stringify(initial.rendered.actualCss)
              === JSON.stringify(final.rendered.actualCss),
            final: publicSnapshot(final),
            initial: publicSnapshot(initial),
            mutations: state.mutations,
            resourceReadinessSame: JSON.stringify(initial.resources)
              === JSON.stringify(final.resources),
            rootSame: root === document.querySelector(candidate),
            renderedSame: JSON.stringify(initial.rendered) === JSON.stringify(final.rendered),
            checkedVectorSame: JSON.stringify(initial.rendered.checkedVector)
              === JSON.stringify(final.rendered.checkedVector),
            signatureSame: initial.signature === final.signature,
            source0Mutations: state.source0Mutations,
            source0Same: source0 === root.querySelector('input[type="checkbox"]')
          };
        } finally {
          imageErrorListeners.forEach(({ image, listener }) => {
            image.removeEventListener('error', listener);
          });
          delete globalThis.__wechatSourceOnlyEvidence;
        }
      }
    };
    return publicSnapshot(initial);
  }, selector);
}

export async function writeSourceOnlyEvidence(testInfo, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-source-only-evidence.json');
  const payload = {
    canonical: evidence.canonical,
    collector: evidence.collector,
    loadedThemeCss: evidence.loadedThemeCss,
    runtime: evidence.collector.runtime ?? { product: null, protocolVersion: null },
    source: evidence.source,
    status: evidence.collector.status === 'ready'
      ? 'unverified'
      : evidence.collector.status === 'failed'
        ? 'failed'
        : 'unavailable',
    style: evidence.style
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}

export async function runSourceOnlyCase(
  page,
  baseURL,
  testInfo,
  scenario,
  { createOwnedPost, login, testSlug }
) {
  const postId = createOwnedPost(
    testInfo.wechatTaskContextUser,
    testSlug(testInfo),
    testInfo,
    { markdownTheme: scenario.themeId }
  );
  await login(page, testInfo.wechatTaskContextUser, baseURL);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, { waitUntil: 'domcontentloaded' });
  await waitForVisibleSelector(page, '#easymde-editor', 'wechat-task-context-source-only-editor-unavailable');
  await waitForAcceptedPreview(page);
  await assertCanonicalSource(page);
  await waitForLoadedArticleThemeCss(page, scenario.themeId);
  await settleAcceptedPreviewReadiness(page, previewSelector, true);
  await waitForAcceptedPreview(page);
  const initial = await installSourceOnlyMutationEvidence(page, previewSelector);
  const style = await readSourceOnlyStyleCapability(page, previewSelector, scenario.themeId);
  let collector;
  let source;
  try {
    collector = await collectSourceOnlyCdpEvidence(page, previewSelector);
  } finally {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    source = await page.evaluate(() => globalThis.__wechatSourceOnlyEvidence?.finish?.());
  }
  await assertCanonicalSource(page);
  const canonical = {
    acceptedInitial: initial.accepted === '1',
    acceptedFinal: source?.final?.accepted === '1',
    inputCountInitial: initial.inputCount,
    inputCountFinal: source?.final?.inputCount ?? null,
    checkedInitial: initial.rendered?.checkedVector ?? null,
    checkedFinal: source?.final?.rendered?.checkedVector ?? null,
    checkedCountInitial: initial.rendered?.checkedCount ?? null,
    checkedCountFinal: source?.final?.rendered?.checkedCount ?? null,
    uncheckedCountInitial: initial.rendered?.uncheckedCount ?? null,
    uncheckedCountFinal: source?.final?.rendered?.uncheckedCount ?? null,
    checkedVectorSame: source?.checkedVectorSame === true,
    rootConnectedInitial: initial.rootConnected === true,
    rootConnectedFinal: source?.final?.rootConnected === true,
    renderedActualCssSame: source?.actualCssSame === true,
    renderedInitial: initial.rendered ?? null,
    renderedFinal: source?.final?.rendered ?? null,
    renderedSame: source?.renderedSame === true,
    rootSame: source?.rootSame === true,
    signatureSame: source?.signatureSame === true,
    source0ConnectedInitial: initial.source0Connected === true,
    source0ConnectedFinal: source?.final?.source0Connected === true,
    source0Same: source?.source0Same === true
  };
  const evidence = {
    canonical,
    collector,
    loadedThemeCss: true,
    source: source ?? { status: 'unavailable' },
    style
  };
  await writeSourceOnlyEvidence(testInfo, evidence);
  expect(canonical).toEqual(expect.objectContaining({
    acceptedFinal: true,
    acceptedInitial: true,
    checkedCountFinal: 16,
    checkedCountInitial: 16,
    checkedFinal: taskStates,
    checkedInitial: taskStates,
    checkedVectorSame: true,
    inputCountFinal: 19,
    inputCountInitial: 19,
    rootConnectedFinal: true,
    rootConnectedInitial: true,
    rootSame: true,
    signatureSame: true,
    source0ConnectedFinal: true,
    source0ConnectedInitial: true,
    source0Same: true
  }));
  expect(canonical.renderedInitial?.inputCount).toBe(19);
  expect(canonical.renderedFinal?.inputCount).toBe(19);
  expect(canonical.renderedInitial?.checkedCount).toBe(16);
  expect(canonical.renderedFinal?.checkedCount).toBe(16);
  expect(canonical.renderedInitial?.uncheckedCount).toBe(3);
  expect(canonical.renderedFinal?.uncheckedCount).toBe(3);
  expect(canonical.checkedFinal).toEqual(taskStates);
  expect(canonical.checkedInitial).toEqual(taskStates);
  expect(canonical.uncheckedCountInitial).toBe(3);
  expect(canonical.uncheckedCountFinal).toBe(3);
  expect(canonical.renderedActualCssSame).toBe(true);
  expect(canonical.renderedSame).toBe(true);
  expect(source?.mutations).toEqual(expect.objectContaining({
    attributes: 0,
    characterData: 0,
    childList: 0,
    records: 0
  }));
  expect(source?.source0Mutations).toEqual(expect.objectContaining({
    attributes: 0,
    characterData: 0,
    childList: 0,
    records: 0
  }));
  if (style.status !== 'ready') {
    return stableSourceOnlyCode(
      style.code,
      'wechat-task-context-source-only-style-unavailable'
    );
  }
  expect(style.matches).toBe(true);
  if (collector.status === 'failed') {
    throw new Error(stableSourceOnlyCode(collector.code));
  }
  if (collector.status !== 'ready') return collector.code;
  return null;
}

export async function awaitCdpCopyWithinBound(copyPromise) {
  let timer = null;
  try {
    return await Promise.race([
      copyPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('wechat-task-context-cdp-copy-timeout')),
          CDP_GEOMETRY_PAUSE_TIMEOUT_MS
        );
      })
    ]);
  } catch (error) {
    void copyPromise.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function awaitPageOperationWithinBound(operation, failureCode) {
  let timer = null;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(failureCode)), CDP_GEOMETRY_PAUSE_TIMEOUT_MS);
      })
    ]);
  } catch {
    void operation.catch(() => undefined);
    throw new Error(failureCode);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function awaitStageBPrepareWithinBound(
  operation,
  timeoutCode,
  timeoutMs = CDP_GEOMETRY_PAUSE_TIMEOUT_MS
) {
  let timer = null;
  let timedOut = false;
  try {
    const outcome = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(timeoutCode));
        }, timeoutMs);
      })
    ]);
    return { outcome, settled: true };
  } catch {
    void operation.catch(() => undefined);
    return {
      outcome: {
        code: timedOut ? timeoutCode : 'wechat-task-context-stage-b-prepare-failed',
        status: timedOut ? 'unavailable' : 'failed'
      },
      settled: !timedOut
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function cancelStageBPrepare(page) {
  try {
    return await awaitPageOperationWithinBound(
      page.evaluate(() => globalThis.__wechatTaskContext?.cancelPrepare?.() === true),
      'wechat-task-context-stage-b-prepare-cancel-timeout'
    ) === true;
  } catch {
    return false;
  }
}

export async function cancelAndAwaitStageBPrepare(
  operation,
  cancel,
  terminalCode,
  timeoutMs = CDP_GEOMETRY_PAUSE_TIMEOUT_MS
) {
  let cancelRequested = false;
  try {
    cancelRequested = await cancel() === true;
  } catch {
    cancelRequested = false;
  }
  const terminal = await awaitStageBPrepareWithinBound(operation, terminalCode, timeoutMs);
  return Object.freeze({ cancelRequested, terminal });
}
