// PNG measurement and font-readiness probe owner: installs, reads, and stops
// the page-side measurement and font event probe.

export async function installPngMeasurementProbe(page) {
  await page.evaluate(() => {
    const measurements = [];
    const fontEvents = [];
    const fontSet = document.fonts ?? null;
    const startedAt = performance.now();
    const fontStatusBeforeFirstLayout = fontSet?.status ?? 'unavailable';
    let firstLayout = null;
    const elapsedMs = (at) => {
      const durationMs = at - startedAt;
      if (!Number.isFinite(durationMs)) {
        throw new Error('wechat-png-measurement-duration-invalid');
      }
      return durationMs;
    };
    const currentFontStatus = () => fontSet?.status ?? 'unavailable';
    const onFontEvent = (event) => {
      if (!(event instanceof Event) || !['loading', 'loadingdone'].includes(event.type)) return;
      const at = performance.now();
      fontEvents.push({ atMs: elapsedMs(at), type: event.type });
    };
    fontSet?.addEventListener('loading', onFontEvent);
    fontSet?.addEventListener('loadingdone', onFontEvent);
    const recordMeasurement = () => {
      const host = document.querySelector('.easymde-wechat-preview-measurement');
      const root = host?.querySelector('article.easymde-preview');
      if (
        !(host instanceof HTMLElement)
        || !(root instanceof HTMLElement)
        || !host.isConnected
        || !root.isConnected
      ) return;
      const rootRect = root.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const at = performance.now();
      if (firstLayout === null) {
        firstLayout = {
          atMs: elapsedMs(at),
          fontStatus: currentFontStatus()
        };
      }
      measurements.push({
        hostWidth: hostRect.width,
        rootHeight: rootRect.height,
        rootWidth: rootRect.width
      });
    };
    const observer = new MutationObserver(() => {
      recordMeasurement();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    globalThis.__easymdePngMeasurementProbe = {
      disconnect() {
        observer.disconnect();
        fontSet?.removeEventListener('loading', onFontEvent);
        fontSet?.removeEventListener('loadingdone', onFontEvent);
      },
      read() {
        return {
          fontReadiness: {
            afterFirstLayout: firstLayout?.fontStatus ?? null,
            beforeFirstLayout: fontStatusBeforeFirstLayout,
            events: fontEvents.slice(),
            firstLayoutDurationMs: firstLayout?.atMs ?? null
          },
          measurements: measurements.slice()
        };
      }
    };
  });
}

export async function readPngMeasurements(page) {
  return page.evaluate(() => globalThis.__easymdePngMeasurementProbe.read().measurements);
}

export async function stopPngMeasurementProbe(page) {
  await page.evaluate(() => globalThis.__easymdePngMeasurementProbe.disconnect());
}
