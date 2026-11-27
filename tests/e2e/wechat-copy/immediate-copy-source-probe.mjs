// Immediate copy mutation probe owner: installs and reads the page-side source
// and Preview mutation snapshot taken when the Copy trigger is activated.

export async function installImmediateCopySourceProbe(page) {
  await page.evaluate(() => {
    const source = document.querySelector('#easymde-source');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(source instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
      throw new Error('wechat-immediate-copy-source-probe-surfaces-unavailable');
    }
    const stableHash = (value) => {
      let hash = 2166136261;
      for (const character of value) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const finite = (value) => Number.isFinite(value) ? value : null;
    const describe = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const style = {
        display: computed.display,
        fontSize: computed.fontSize,
        height: computed.height,
        lineHeight: computed.lineHeight,
        position: computed.position,
        transform: computed.transform,
        width: computed.width
      };
      return {
        className: element.className,
        connected: element.isConnected,
        id: element.id || null,
        childElementCount: element.childElementCount,
        childNodeCount: element.childNodes.length,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        rect: {
          height: finite(rect.height),
          left: finite(rect.left),
          top: finite(rect.top),
          width: finite(rect.width)
        },
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        styleHash: stableHash(JSON.stringify(style)),
        tag: element.tagName,
        valueLength: element instanceof HTMLTextAreaElement ? element.value.length : null
      };
    };
    const ownerState = () => {
      const root = document.querySelector('#easymde-editor-root');
      const stage = globalThis.__easymdeWechatMatrixStage ?? null;
      const stageShape = stage && typeof stage === 'object'
        ? {
          articleThemeId: stage.articleThemeId ?? null,
          caseId: stage.caseId ?? null,
          codeThemeId: stage.codeThemeId ?? null,
          codeThemeExplicit: stage.codeThemeExplicit ?? null,
          mode: stage.mode ?? null,
          stage: stage.stage ?? null
        }
        : null;
      const ownerShape = {
        accepted: preview.getAttribute('data-easymde-preview-accepted'),
        ariaBusy: preview.getAttribute('aria-busy'),
        error: preview.getAttribute('data-easymde-preview-error'),
        previewClass: preview.className,
        refreshing: preview.getAttribute('data-easymde-preview-refreshing'),
        rootClass: root instanceof HTMLElement ? root.className : null,
        sourceClass: source.className
      };
      const anchor = preview.querySelector('a');
      return {
        anchorId: anchor ? nodeIdentity(anchor).id : null,
        ownerHash: stableHash(JSON.stringify(ownerShape)),
        preview: describe(preview),
        readiness: {
          accepted: ownerShape.accepted,
          ariaBusy: ownerShape.ariaBusy,
          error: ownerShape.error,
          refreshing: ownerShape.refreshing
        },
        root: describe(root),
        source: describe(source),
        stage: stageShape,
        stageHash: stableHash(JSON.stringify(stageShape))
      };
    };
    const nodeIds = new WeakMap();
    let nextNodeId = 1;
    const nodeIdentity = (element) => {
      let id = nodeIds.get(element);
      if (!id) {
        id = nextNodeId;
        nextNodeId += 1;
        nodeIds.set(element, id);
      }
      const path = [];
      let current = element;
      while (current && current !== preview && path.length < 12) {
        const parent = current.parentElement;
        path.unshift(parent ? [...parent.children].indexOf(current) : -1);
        current = parent;
      }
      return {
        classHash: stableHash(String(element.className ?? '')),
        id,
        path,
        tag: element.tagName
      };
    };
    const captureThemeCommit = () => {
      const expectedThemeId = globalThis.__easymdeImmediateCopyExpectedArticleTheme ?? null;
      const themeField = document.querySelector('#easymde-markdown-theme-field');
      const previewClasses = [...preview.classList]
        .filter((className) => /^easymde-markdown-theme-[a-z0-9_-]+$/iu.test(className))
        .sort();
      const previewNodes = new Set([preview, ...preview.querySelectorAll('*')]);
      const allowedProperties = new Set([
        'font-family',
        'font-size',
        'font-weight',
        'height',
        'line-height',
        'transform',
        'width'
      ]);
      const transitions = document.getAnimations()
        .filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          return target instanceof Element
            && previewNodes.has(target)
            && animation.constructor?.name === 'CSSTransition';
        })
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const record = {
            currentTime: Number.isFinite(Number(animation.currentTime))
              ? Number(animation.currentTime)
              : null,
            endTime: Number.isFinite(Number(timing?.endTime))
              ? Number(timing.endTime)
              : null,
            node: target ? nodeIdentity(target) : null,
            playState: animation.playState,
            property: allowedProperties.has(animation.transitionProperty)
              ? animation.transitionProperty
              : 'other',
            startTime: Number.isFinite(Number(animation.startTime))
              ? Number(animation.startTime)
              : null,
            status: 'active'
          };
          animation.finished.then(
            () => {
              record.status = 'finished';
              record.finishedAtMs = finite(performance.now() - startedAt);
            },
            () => {
              record.status = 'cancelled';
              record.cancelledAtMs = finite(performance.now() - startedAt);
            }
          );
          return record;
        });
      return {
        atMs: finite(performance.now() - startedAt),
        expectedThemeId,
        previewClassNames: previewClasses,
        themeFieldValue: themeField instanceof HTMLInputElement ? themeField.value : null,
        transitions
      };
    };
    let themeCommit = null;
    const mutations = [];
    const startedAt = performance.now();
    let clickAtMs = null;
    let clickMutationIndex = null;
    let clickTransitions = null;
    const appendMutations = (records, phaseOverride = null) => {
      for (const record of records) {
        if (mutations.length >= 32) break;
        const target = record.target instanceof HTMLElement
          ? record.target
          : record.target.parentElement;
        const surface = target === source || source.contains(target)
          ? 'source'
          : target === preview || preview.contains(target)
            ? 'preview'
            : 'other';
        const phase = phaseOverride ?? (clickAtMs === null ? 'pre-click' : 'post-click');
        mutations.push({
          addedCount: record.addedNodes.length,
          atMs: finite(performance.now() - startedAt),
          attributeName: record.attributeName && [
            'aria-busy',
            'class',
            'data-easymde-preview-accepted',
            'data-easymde-preview-error',
            'data-easymde-preview-refreshing',
            'style'
          ].includes(record.attributeName)
            ? record.attributeName
            : record.attributeName ? 'other' : null,
          removedCount: record.removedNodes.length,
          phase,
          relativeAtMs: phase === 'post-click' && clickAtMs !== null
            ? finite(performance.now() - clickAtMs)
            : null,
          surface,
          target: describe(target),
          type: record.type
        });
      }
    };
    const observer = new MutationObserver((records) => {
      appendMutations(records);
    });
    observer.observe(source, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    observer.observe(preview, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    globalThis.__easymdeImmediateCopySourceProbe = {
      disconnect() {
        observer.disconnect();
      },
      markClick(at) {
        appendMutations(observer.takeRecords(), 'pre-click');
        clickAtMs = at;
        clickMutationIndex = mutations.length;
        clickTransitions = captureThemeCommit();
      },
      markThemeCommit() {
        if (themeCommit === null) themeCommit = captureThemeCommit();
      },
      read() {
        return {
          after: ownerState(),
          before: globalThis.__easymdeImmediateCopySourceProbe.before,
          clickAtMs,
          clickMutationIndex,
          clickTransitions,
          themeCommit,
          mutations: mutations.slice()
        };
      },
      before: ownerState()
    };
  });
}

export async function readImmediateCopySourceProbe(page) {
  return page.evaluate(() => globalThis.__easymdeImmediateCopySourceProbe.read());
}

export async function stopImmediateCopySourceProbe(page) {
  await page.evaluate(() => {
    globalThis.__easymdeImmediateCopySourceProbe?.disconnect();
    delete globalThis.__easymdeImmediateCopySourceProbe;
  });
}
