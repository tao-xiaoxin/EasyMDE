import type { WechatVisualRasterizationKind } from '../../../contracts/ports/wechat-visual-rasterization-port';

export type WechatTimingMode = 'async' | 'sync';
export type WechatTimingTerminal = 'error' | 'success';
export type WechatTimingMetadata = Readonly<{
  candidate?: number;
  hidden?: boolean;
  kind?: WechatVisualRasterizationKind;
  mode: WechatTimingMode;
  owner?: 'measurement' | 'source' | 'task-geometry';
  pairs?: number;
}>;
export type WechatTimingHandle = Readonly<{
  finish: (terminal: WechatTimingTerminal) => void;
}>;

/**
 * A handle for a diagnostic phase that the current path does not instrument.
 * Callers keep one reporting flow while an unchanged path records nothing.
 */
export const noWechatTimingHandle: WechatTimingHandle = {
  finish: () => undefined
};

export function beginWechatTiming(
  performance: Performance | undefined,
  name: string,
  metadata: WechatTimingMetadata
): WechatTimingHandle {
  let startedAt: number | null = null;
  let finished = false;
  if (
    performance &&
    'function' === typeof performance.now &&
    'function' === typeof performance.measure &&
    'function' === typeof performance.clearMeasures
  ) {
    try {
      const value = performance.now();
      if (Number.isFinite(value)) startedAt = value;
    } catch {
      startedAt = null;
    }
  }
  return {
    finish: (terminal): void => {
      if (finished) return;
      finished = true;
      if (null === startedAt || !performance) return;
      try {
        const endedAt = performance.now();
        if (!Number.isFinite(endedAt)) return;
        performance.measure(name, {
          detail: { ...metadata, terminal },
          end: endedAt,
          start: startedAt
        } as PerformanceMeasureOptions);
      } catch {
        // Timing is diagnostic-only; an unsupported UserTiming implementation
        // must not change the measured operation's result.
      } finally {
        try {
          performance.clearMeasures(name);
        } catch {
          // A missing or partial UserTiming implementation is non-fatal.
        }
      }
    }
  };
}

export function runWechatSyncTiming<T>(
  performance: Performance | undefined,
  name: string,
  metadata: WechatTimingMetadata,
  operation: () => T
): T {
  const timing = beginWechatTiming(performance, name, metadata);
  try {
    const result = operation();
    timing.finish('success');
    return result;
  } catch (error: unknown) {
    timing.finish('error');
    throw error;
  }
}
