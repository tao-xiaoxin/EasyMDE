import { WECHAT_COPY_TIMING_NAMES } from './wechat-clipboard-runtime';
import {
  beginWechatTiming,
  noWechatTimingHandle,
  type WechatTimingHandle,
  type WechatTimingMetadata
} from './wechat-timing';

export type WechatReadinessOwner = NonNullable<WechatTimingMetadata['owner']>;

type ReadinessTimingInput = Readonly<{
  geometryOwner: WechatReadinessOwner;
  geometryPairs: number | null;
  geometryReadiness: Promise<void>;
  hidden: boolean;
  performance: Performance | undefined;
  taskGeometryOwner: WechatReadinessOwner;
  taskGeometryReadiness: Promise<void>;
  transitionReadiness: Promise<void>;
}>;

export type WechatReadinessTiming = Readonly<{
  fail: () => void;
  ready: Promise<void>;
}>;

function settleTiming(timing: WechatTimingHandle, settled: Promise<void>): Promise<void> {
  return settled.then(
    () => timing.finish('success'),
    (error: unknown) => {
      timing.finish('error');
      throw error;
    }
  );
}

export function createWechatReadinessTiming({
  geometryOwner,
  geometryPairs,
  geometryReadiness,
  hidden,
  performance,
  taskGeometryOwner,
  taskGeometryReadiness,
  transitionReadiness
}: ReadinessTimingInput): WechatReadinessTiming {
  const geometryTiming = beginWechatTiming(performance, WECHAT_COPY_TIMING_NAMES.geometryReadiness, {
    hidden,
    mode: 'async',
    owner: geometryOwner,
    ...(null !== geometryPairs ? { pairs: geometryPairs } : {})
  });
  const transitionTiming = beginWechatTiming(performance, WECHAT_COPY_TIMING_NAMES.transitionReadiness, {
    hidden,
    mode: 'async',
    owner: 'source'
  });
  const taskGeometryTiming = beginWechatTiming(performance, WECHAT_COPY_TIMING_NAMES.taskGeometryReadiness, {
    hidden,
    mode: 'async',
    owner: taskGeometryOwner
  });
  let failed = false;
  return {
    fail: () => {
      if (failed) return;
      failed = true;
      geometryTiming.finish('error');
      transitionTiming.finish('error');
      taskGeometryTiming.finish('error');
    },
    ready: Promise.all([
      settleTiming(geometryTiming, geometryReadiness),
      settleTiming(transitionTiming, transitionReadiness),
      settleTiming(taskGeometryTiming, taskGeometryReadiness)
    ]).then(() => undefined)
  };
}

export function createWechatCopyTotalTiming(
  performance: Performance | undefined,
  enabled: boolean
): (terminal: 'error' | 'success') => void {
  const timing = enabled
    ? beginWechatTiming(performance, WECHAT_COPY_TIMING_NAMES.copyTotal, { mode: 'async' })
    : noWechatTimingHandle;
  let finished = false;
  return (terminal) => {
    if (finished) return;
    finished = true;
    timing.finish(terminal);
  };
}

export function createWechatMarkupPreparationTimings(
  performance: Performance | undefined,
  enabled: boolean
): Readonly<{ inlineStyles: WechatTimingHandle; markupPreparation: WechatTimingHandle }> {
  return {
    inlineStyles: enabled
      ? beginWechatTiming(performance, WECHAT_COPY_TIMING_NAMES.inlineStyles, { mode: 'async' })
      : noWechatTimingHandle,
    markupPreparation: enabled
      ? beginWechatTiming(performance, WECHAT_COPY_TIMING_NAMES.markupPreparation, { mode: 'async' })
      : noWechatTimingHandle
  };
}
