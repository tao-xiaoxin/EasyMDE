// Preview freshness probe owner: installs and stops the page-side freshness
// instrumentation that describes Preview surface decisions.
import { copyDiagnosticsEnabled } from "./environment.mjs";

export async function installPreviewFreshnessProbe(page, { force = false } = {}) {
  if (!copyDiagnosticsEnabled && !force) return;
  await page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-freshness-probe-surface-unavailable');
    }
    const finiteNumber = (value) => Number.isFinite(value) ? value : null;
    const stringHash = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const describeElement = (element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const image = element instanceof HTMLImageElement ? element : null;
      return {
        computedHeight: style.height,
        computedWidth: style.width,
        display: style.display,
        imageComplete: image?.complete ?? null,
        imageNaturalHeight: image?.naturalHeight ?? null,
        imageNaturalWidth: image?.naturalWidth ?? null,
        index,
        numericStyle: {
          fontFamilyHash: stringHash(style.fontFamily),
          fontSize: finiteNumber(Number.parseFloat(style.fontSize)),
          fontWeight: style.fontWeight,
          height: finiteNumber(rect.height),
          lineHeight: finiteNumber(Number.parseFloat(style.lineHeight)),
          transform: style.transform,
          width: finiteNumber(rect.width)
        },
        rectHeight: rect.height,
        rectWidth: rect.width,
        tag: element.tagName,
        visibility: style.visibility
      };
    };
    const describeAnimations = () => {
      if (typeof document.getAnimations !== 'function') return { code: 'animations-unavailable' };
      const nodes = [preview, ...preview.querySelectorAll('*')];
      const allowedTransitionProperties = new Set([
        'font-family',
        'font-size',
        'font-weight',
        'height',
        'line-height',
        'transform',
        'width'
      ]);
      const animations = document.getAnimations()
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const targetNodeIndex = target instanceof Element ? nodes.indexOf(target) : -1;
          return { animation, effect, targetNodeIndex };
        })
        .filter(({ targetNodeIndex }) => targetNodeIndex >= 0);
      return {
        count: animations.length,
        items: animations.slice(0, 32).map(({ animation, effect, targetNodeIndex }) => {
          const target = effect && 'target' in effect ? effect.target : null;
          const targetStyle = target instanceof Element ? getComputedStyle(target) : null;
          const targetRect = target instanceof Element ? target.getBoundingClientRect() : null;
          const timing = effect?.getTiming?.() ?? {};
          const computedTiming = effect?.getComputedTiming?.() ?? {};
          const transitionProperty = 'transitionProperty' in animation
            && 'string' === typeof animation.transitionProperty
            && allowedTransitionProperties.has(animation.transitionProperty)
            ? animation.transitionProperty
            : 'other';
          return {
            constructorName: animation.constructor?.name ?? null,
            currentTimeMs: finiteNumber(
              'number' === typeof animation.currentTime ? animation.currentTime : null
            ),
            durationMs: finiteNumber(
              'number' === typeof timing.duration ? timing.duration : null
            ),
            effectType: effect?.constructor?.name ?? null,
            endTimeMs: finiteNumber(
              'number' === typeof computedTiming.endTime ? computedTiming.endTime : null
            ),
            playState: animation.playState,
            repeatCount: finiteNumber(
              'number' === typeof timing.iterations ? timing.iterations : null
            ),
            targetNodeIndex,
            transitionProperty,
            targetStyle: targetStyle && targetRect
              ? {
                fontFamilyHash: stringHash(targetStyle.fontFamily),
                fontSize: finiteNumber(Number.parseFloat(targetStyle.fontSize)),
                fontWeight: targetStyle.fontWeight,
                height: finiteNumber(targetRect.height),
                lineHeight: finiteNumber(Number.parseFloat(targetStyle.lineHeight)),
                transform: targetStyle.transform,
                width: finiteNumber(targetRect.width)
              }
              : null
          };
        })
      };
    };
    const describe = () => {
      const elements = [preview, ...preview.querySelectorAll('*')];
      const source = document.querySelector('#easymde-source');
      void preview.offsetHeight;
      void source?.offsetHeight;
      return {
        fontStatus: document.fonts?.status ?? 'unavailable',
        nodes: elements.map(describeElement),
        sourceHtmlHash: stringHash(preview.innerHTML),
        sourceHtmlLength: preview.innerHTML.length
      };
    };
    const baseline = describe();
    const baselineAnimations = describeAnimations();
    const cloneImageReadiness = [];
    const mutations = [];
    const nativeCloneNode = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function cloneNodeWithReadiness(deep) {
      const clone = nativeCloneNode.call(this, deep);
      const sourceImages = this instanceof Element
        ? [this, ...this.querySelectorAll('img')].filter(
          (element) => element instanceof HTMLImageElement
        )
        : [];
      const cloneImages = clone instanceof Element
        ? [clone, ...clone.querySelectorAll('img')].filter(
          (element) => element instanceof HTMLImageElement
        )
        : [];
      for (let index = 0; index < Math.min(sourceImages.length, cloneImages.length); index += 1) {
        const sourceImage = sourceImages[index];
        const cloneImage = cloneImages[index];
        if (cloneImageReadiness.length < 32) {
          cloneImageReadiness.push({
            cloneComplete: cloneImage.complete,
            cloneNaturalHeight: cloneImage.naturalHeight,
            cloneNaturalWidth: cloneImage.naturalWidth,
            sourceComplete: sourceImage.complete,
            sourceNaturalHeight: sourceImage.naturalHeight,
            sourceNaturalWidth: sourceImage.naturalWidth
          });
        }
      }
      return clone;
    };
    const nodeIndex = (element) => (
      element instanceof Element
        ? [preview, ...preview.querySelectorAll('*')].indexOf(element)
        : null
    );
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (mutations.length >= 32) break;
        const target = record.target instanceof Element
          ? record.target
          : record.target.parentElement;
        const targetIndex = nodeIndex(target);
        const targetDescription = target instanceof Element
          && targetIndex !== null
          ? describeElement(target, targetIndex)
          : null;
        mutations.push({
          addedCount: 'childList' === record.type ? record.addedNodes.length : 0,
          attributeName: 'attributes' === record.type ? record.attributeName : null,
          removedCount: 'childList' === record.type ? record.removedNodes.length : 0,
          target: targetDescription,
          type: record.type
        });
      }
    });
    observer.observe(preview, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    const sameNode = (before, after) => (
      before.tag === after.tag
      && Math.abs(before.rectWidth - after.rectWidth) <= 0.01
      && Math.abs(before.rectHeight - after.rectHeight) <= 0.01
      && before.computedWidth === after.computedWidth
      && before.computedHeight === after.computedHeight
      && before.display === after.display
      && before.visibility === after.visibility
      && before.imageComplete === after.imageComplete
      && before.imageNaturalWidth === after.imageNaturalWidth
      && before.imageNaturalHeight === after.imageNaturalHeight
    );
    const firstChangedStyle = (beforeNodes, afterNodes) => {
      const styleProperties = [
        'fontSize',
        'lineHeight',
        'fontWeight',
        'fontFamilyHash',
        'width',
        'height',
        'transform'
      ];
      const limit = Math.min(beforeNodes.length, afterNodes.length);
      for (let index = 0; index < limit; index += 1) {
        const before = beforeNodes[index]?.numericStyle;
        const after = afterNodes[index]?.numericStyle;
        if (!before || !after) continue;
        const changes = styleProperties
          .filter((property) => before[property] !== after[property])
          .map((property) => ({
            after: after[property],
            before: before[property],
            property
          }));
        if (changes.length) return { changes, index };
      }
      return null;
    };
    globalThis.__easymdePreviewFreshnessProbe = {
      awaitFiniteTransitions() {
        const nodes = [preview, ...preview.querySelectorAll('*')];
        const transitions = document.getAnimations().filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          return target instanceof Element
            && nodes.includes(target)
            && animation.constructor?.name === 'CSSTransition';
        });
        return Promise.all(transitions.map((animation) => animation.finished));
      },
      read() {
        const current = describe();
        const currentAnimations = describeAnimations();
        const limit = Math.max(baseline.nodes.length, current.nodes.length);
        let firstDifference = null;
        for (let index = 0; index < limit; index += 1) {
          const before = baseline.nodes[index] ?? null;
          const after = current.nodes[index] ?? null;
          if (before && after && sameNode(before, after)) continue;
          firstDifference = { after, before, index };
          break;
        }
        return {
          baselineFontStatus: baseline.fontStatus,
          baselineNodeCount: baseline.nodes.length,
          baselineAnimations,
          cloneImageReadiness: cloneImageReadiness.slice(),
          currentFontStatus: current.fontStatus,
          currentNodeCount: current.nodes.length,
          currentAnimations,
          firstDifference,
          firstChangedStyle: firstChangedStyle(baseline.nodes, current.nodes),
          mutations: mutations.slice(),
          sourceHtmlHash: current.sourceHtmlHash,
          sourceHtmlLength: current.sourceHtmlLength
        };
      },
      disconnect() {
        observer.disconnect();
        Node.prototype.cloneNode = nativeCloneNode;
      }
    };
  });
}

export async function stopPreviewFreshnessProbe(page, { force = false } = {}) {
  if (!copyDiagnosticsEnabled && !force) return;
  await page.evaluate(() => {
    globalThis.__easymdePreviewFreshnessProbe?.disconnect();
    delete globalThis.__easymdePreviewFreshnessProbe;
  });
}
