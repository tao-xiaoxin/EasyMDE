// Clipboard instrumentation owner: installs the page-side native clipboard
// write instrumentation used by the WeChat copy diagnostics.

export async function installClipboardInstrumentation(page) {
  await page.addInitScript(() => {
    const clipboard = navigator.clipboard;
    const nativeWrite = clipboard?.write?.bind(clipboard);
    const trace = {
      clicks: [],
      lastItems: null,
      mode: 'success',
      pendingFrameAt: null,
      release: null,
      reject: null,
      statusObserverInstalled: false,
      statusEventCountAtStart: 0,
      statusEvents: [],
      successAt: null,
      startedWriteCount: 0,
      writes: []
    };

    if (!clipboard || !nativeWrite) {
      throw new Error('native-clipboard-write-unavailable');
    }

    const inspectPending = (control) => {
      const busy = control.getAttribute('aria-busy') === 'true'
        || control.getAttribute('aria-disabled') === 'true'
        || control.matches(':disabled')
        || control.dataset.easymdeWechatState === 'pending';
      return {
        busy,
        pending: busy
      };
    };
    const readPreviewTransitionsAtWrite = () => {
      const preview = document.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      if (!(preview instanceof Element)) return { code: 'preview-unavailable', transitions: [] };
      const expectedThemeId = globalThis.__easymdeImmediateCopyExpectedArticleTheme ?? null;
      const themeField = document.querySelector('#easymde-markdown-theme-field');
      const previewClasses = [...preview.classList]
        .filter((className) => /^easymde-markdown-theme-[a-z0-9_-]+$/iu.test(className))
        .sort();
      const previewState = {
        accepted: preview.getAttribute('data-easymde-preview-accepted'),
        ariaBusy: preview.getAttribute('aria-busy'),
        error: preview.getAttribute('data-easymde-preview-error'),
        expectedThemeId,
        refreshing: preview.getAttribute('data-easymde-preview-refreshing'),
        themeClassMatches: expectedThemeId
          ? preview.classList.contains(`easymde-markdown-theme-${expectedThemeId}`)
          : null,
        themeFieldValue: themeField instanceof HTMLInputElement ? themeField.value : null,
        themeClasses: previewClasses
      };
      const previewNodes = new Set([preview, ...preview.querySelectorAll('*')]);
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
          const currentTime = Number(animation.currentTime);
          const endTime = Number(timing?.endTime);
          const transitionProperty = animation.transitionProperty;
          const allowedProperties = new Set([
            'font-family',
            'font-size',
            'font-weight',
            'height',
            'line-height',
            'transform',
            'width'
          ]);
          return {
            currentTime: Number.isFinite(currentTime) ? currentTime : null,
            endTime: Number.isFinite(endTime) ? endTime : null,
            finite: Number.isFinite(currentTime)
              && Number.isFinite(endTime)
              && endTime > currentTime,
            playState: animation.playState,
            property: allowedProperties.has(transitionProperty) ? transitionProperty : 'other',
            targetIndex: target ? [...previewNodes].indexOf(target) : -1
          };
        });
      const animations = document.getAnimations()
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const owner = target instanceof Element
            ? target
            : target?.parentElement ?? target?.element ?? null;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const rawTiming = effect && typeof effect.getTiming === 'function'
            ? effect.getTiming()
            : null;
          const currentTime = Number(animation.currentTime);
          const endTime = Number(timing?.endTime);
          const duration = Number(rawTiming?.duration);
          const iterations = Number(rawTiming?.iterations);
          return {
            animation,
            currentTime,
            duration,
            endTime,
            finite: Number.isFinite(currentTime)
              && Number.isFinite(endTime)
              && Number.isFinite(duration)
              && Number.isFinite(iterations)
              && endTime > currentTime,
            iterations,
            owner,
            pseudoOwner: Boolean(target && !(target instanceof Element)),
            type: animation.constructor?.name ?? 'unknown'
          };
        })
        .filter(({ owner, finite, type }) => (
          owner instanceof Element
          && previewNodes.has(owner)
          && finite
          && type === 'CSSAnimation'
        ))
        .map(({ animation, currentTime, endTime, owner, pseudoOwner, type }) => ({
          currentTimeMs: currentTime,
          endTimeMs: endTime,
          nodeIndex: [...previewNodes].indexOf(owner),
          playState: animation.playState,
          pseudoOwner,
          type
        }));
      return { animations, code: null, preview: previewState, transitions };
    };
    const stableErrorCode = (error) => {
      const message = error instanceof Error ? error.message : '';
      return /^wechat-[a-z0-9-]+$/u.test(message) ? message : 'unknown';
    };
    let lastStatusCode = '';

    trace.begin = (mode) => {
      trace.clicks = [];
      trace.lastItems = null;
      trace.mode = mode;
      trace.pendingFrameAt = null;
      trace.release = null;
      trace.reject = null;
      trace.statusEventCountAtStart = trace.statusEvents.length;
      trace.successAt = null;
      lastStatusCode = '';
      trace.startedAt = performance.now();
      trace.startedWriteCount = trace.writes.length;
    };
    trace.metrics = () => {
      const click = trace.clicks[0];
      const write = trace.writes[trace.startedWriteCount];
      if (!click || !write) throw new Error('wechat-copy-timing-sample-missing');
      return {
        clickCount: trace.clicks.length,
        clickToPendingFrameMs: trace.pendingFrameAt === null
          ? null
          : trace.pendingFrameAt - click.at,
        clickToWriteMs: write.at - click.at,
        writeActivation: write.activation,
        writeCount: trace.writes.length - trace.startedWriteCount,
        writeIndex: trace.startedWriteCount,
        writeNativeState: write.nativeState
      };
    };
    trace.diagnostics = () => ({
      clickActivations: trace.clicks.map(({ active }) => active),
      clickCount: trace.clicks.length,
      clickTransitionsAtClick: trace.clicks.map(({ previewTransitionsAtClick }) => (
        previewTransitionsAtClick ?? { code: 'not-captured', transitions: [] }
      )),
      mode: trace.mode,
      pendingFrameObserved: trace.pendingFrameAt !== null,
      pendingState: trace.pendingState ?? null,
      statusObserverInstalled: trace.statusObserverInstalled,
      statusCodes: trace.statusEvents.slice(trace.statusEventCountAtStart),
      startedWriteCount: trace.startedWriteCount,
      writeCount: trace.writes.length,
      writeStates: trace.writes.map(({
        activation,
        documentHasFocus,
        htmlBlobDurationMs,
        htmlBlobFailureCode,
        htmlBlobState,
        itemCount,
        nativeState,
        previewTransitionsAtWrite,
        visibilityState
      }) => ({
        activation,
        documentHasFocus,
        htmlBlobDurationMs,
        htmlBlobFailureCode,
        htmlBlobState,
        itemCount,
        nativeState,
        previewTransitionsAtWrite,
        visibilityState
      }))
    });
    trace.releaseCopy = () => {
      if (!trace.release) throw new Error('wechat-copy-release-unavailable');
      trace.release();
      trace.release = null;
    };
    trace.rejectCopy = () => {
      if (!trace.reject) throw new Error('wechat-copy-reject-unavailable');
      trace.reject(new DOMException('Synthetic clipboard rejection', 'NotAllowedError'));
      trace.reject = null;
    };
    trace.readPayload = async () => {
      const item = trace.lastItems?.[0];
      if (!item || typeof item.getType !== 'function') {
        throw new Error('clipboard-item-payload-unavailable');
      }
      const blob = await item.getType('text/html');
      const html = await blob.text();
      const normalized = html.toLowerCase();
      return {
        hasCode: normalized.includes('<pre'),
        hasEditorChrome: normalized.includes('easymde-toolbar')
          || normalized.includes('cm-content'),
        hasFormula: normalized.includes('katex'),
        imageCount: (normalized.match(/<img\b/gu) ?? []).length,
        hasMermaid: normalized.includes('easymde-mermaid'),
        hasScript: normalized.includes('<script'),
        hasTable: normalized.includes('<table')
      };
    };

    globalThis.__easymdeWechatCopyTrace = trace;
    const observeStatus = () => {
      const host = document.querySelector(
        '[data-easymde-editor-owner="react"] > .easymde-editor-message-alert-host'
      );
      const node = host?.querySelector('[role="status"], [role="alert"]');
      if (!(node instanceof HTMLElement)) return;
      const bootstrap = globalThis.EasyMDEEditorRootBootstrap;
      const success = bootstrap?.wechatExport?.strings?.success;
      const failed = bootstrap?.wechatExport?.strings?.failed;
      const failedWithUploads = bootstrap?.wechatExport?.strings?.failedWithUploads;
      const unsupported = bootstrap?.wechatExport?.strings?.unsupported;
      const text = node.textContent ?? '';
      const code = text === success
        ? 'wechat-success'
        : text === failed || text === failedWithUploads || text === unsupported
          ? 'wechat-failed'
          : 'other';
      const eventCode = `${node.getAttribute('role') ?? 'unknown'}:${code}`;
      if (eventCode === lastStatusCode) return;
      lastStatusCode = eventCode;
      trace.statusEvents.push(code);
      if (code === 'wechat-success') trace.successAt = performance.now();
    };
    const installStatusObserver = () => {
      if (trace.statusObserverInstalled) return true;
      if (!document.documentElement) return false;
      const statusObserver = new MutationObserver(observeStatus);
      statusObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'role'],
        characterData: true,
        childList: true,
        subtree: true
      });
      trace.statusObserverInstalled = true;
      return true;
    };
    if (!installStatusObserver()) {
      document.addEventListener('DOMContentLoaded', installStatusObserver, { once: true });
    }
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('.easymde-toolbar-copy-action, .easymde-immersive-wechat')
        : null;
      if (!(target instanceof HTMLElement)) return;

      const clickAt = performance.now();
      globalThis.__easymdeImmediateCopySourceProbe?.markClick?.(clickAt);
      globalThis.__easymdeWechatZeroWrite?.captureAtClick?.();
      trace.clicks.push({
        active: navigator.userActivation?.isActive === true,
        at: clickAt,
        copyAvailabilityAtClick: {
          ariaBusy: target.getAttribute('aria-busy'),
          ariaDisabled: target.getAttribute('aria-disabled'),
          nativeDisabled: target instanceof HTMLButtonElement ? target.disabled : null
        },
        previewTransitionsAtClick: readPreviewTransitionsAtWrite()
      });
      const samplePendingFrame = () => {
        if (trace.pendingFrameAt === null && inspectPending(target).pending) {
          trace.pendingFrameAt = performance.now();
          trace.pendingState = inspectPending(target);
          return;
        }
        if (performance.now() - clickAt < 500) requestAnimationFrame(samplePendingFrame);
      };
      requestAnimationFrame(samplePendingFrame);
    }, true);

    Object.defineProperty(clipboard, 'write', {
      configurable: true,
      writable: true,
      value: (items) => {
        const record = {
          activation: navigator.userActivation?.isActive === true,
          at: performance.now(),
          documentHasFocus: document.hasFocus(),
          htmlBlobDurationMs: null,
          htmlBlobFailureCode: null,
          htmlBlobState: 'unavailable',
          itemCount: items?.length ?? null,
          nativeState: 'pending',
          previewTransitionsAtWrite: { code: 'not-captured', transitions: [] },
          visibilityState: document.visibilityState
        };
        trace.lastItems = items;
        trace.writes.push(record);
        if (trace.mode === 'reject') {
          record.htmlBlobState = 'synthetic-reject';
          record.nativeState = 'rejected';
          return Promise.reject(new DOMException('Synthetic clipboard rejection', 'NotAllowedError'));
        }

        const nativeResult = Promise.resolve(nativeWrite(items));
        record.previewTransitionsAtWrite = readPreviewTransitionsAtWrite();
        const htmlItem = items?.[0];
        if (htmlItem && typeof htmlItem.getType === 'function') {
          const startedAt = performance.now();
          record.htmlBlobState = 'pending';
          try {
            Promise.resolve(htmlItem.getType('text/html')).then(
              () => {
                record.htmlBlobState = 'fulfilled';
                record.htmlBlobDurationMs = performance.now() - startedAt;
              },
              (error) => {
                record.htmlBlobState = 'rejected';
                record.htmlBlobDurationMs = performance.now() - startedAt;
                record.htmlBlobFailureCode = stableErrorCode(error);
              }
            );
          } catch (error) {
            record.htmlBlobState = 'rejected';
            record.htmlBlobDurationMs = performance.now() - startedAt;
            record.htmlBlobFailureCode = stableErrorCode(error);
          }
        }
        nativeResult.then(
          () => { record.nativeState = 'fulfilled'; },
          () => { record.nativeState = 'rejected'; }
        );
        if (trace.mode !== 'deferred') return nativeResult;

        const gate = new Promise((resolve, reject) => {
          trace.release = resolve;
          trace.reject = reject;
        });
        return Promise.all([nativeResult, gate]).then(([result]) => result);
      }
    });
  });
}
