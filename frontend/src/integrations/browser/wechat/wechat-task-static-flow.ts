import { TASK_LIST_CHECKBOX_CLONES } from './wechat-clone-metadata';
import {
  throwIfBackgroundPreparationAborted,
  yieldSerializationBoundary,
  type BrowserWechatClipboardRuntime,
  type SerializationYield,
} from './wechat-clipboard-runtime';
import {
  assertPngConversionCurrent,
  type WechatPngConversionContext,
} from './wechat-png-conversion-policy';
import {
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
  type TaskCheckboxCaptionOwnerIdentity,
} from './wechat-task-caption';
import type { TaskCheckboxGeometryLease } from './wechat-task-geometry';
import {
  normalizeTaskCheckboxStaticFlowOwner,
  taskCheckboxStaticFlowAllocation,
  taskCheckboxStaticFlowAssertAllocation,
  taskCheckboxStaticFlowRun,
} from './wechat-task-static-flow-projection';

/**
 * Public entry point for task checkbox static-flow normalization. The emitted
 * owner inventory recorded by `replaceTaskListCheckboxClones` owns the
 * normalization sequence, the projection module owns per-layer DOM geometry
 * and the allocation registry, and the policy module owns pure CSS
 * classification and allocation arithmetic.
 */

/**
 * The emitted owner inventory recorded by `replaceTaskListCheckboxClones` owns
 * the normalization sequence and every owner and layout input it needs, so
 * normalization never re-discovers owners by querying the serialized root. An
 * identity whose owner was never registered as a projected clone, such as a
 * hidden source control the serializer returned before applying paint, keeps no
 * allocation and stays with the terminal owner validation.
 */
function taskCheckboxStaticFlowOwnerSequence(root: HTMLElement): readonly TaskCheckboxCaptionOwnerIdentity[] {
  return (TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root) ?? []).filter(({ cloneOwner }) =>
    TASK_LIST_CHECKBOX_CLONES.has(cloneOwner)
  );
}

export function normalizeTaskCheckboxStaticFlowSynchronously(
  root: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  geometryLease: TaskCheckboxGeometryLease | null = null
): void {
  const run = taskCheckboxStaticFlowRun();
  taskCheckboxStaticFlowOwnerSequence(root).forEach((identity) => {
    normalizeTaskCheckboxStaticFlowOwner(identity, root, runtime, run, geometryLease);
  });
}

/**
 * Normalizes one owner per iteration and keeps the caller's serialization
 * budget: abort and conversion currentness are checked around every owner,
 * and only a due budget suspends the run between owners.
 */
export async function normalizeTaskCheckboxStaticFlow(
  root: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal,
  geometryLease: TaskCheckboxGeometryLease | null = null
): Promise<void> {
  const run = taskCheckboxStaticFlowRun();
  for (const identity of taskCheckboxStaticFlowOwnerSequence(root)) {
    throwIfBackgroundPreparationAborted(signal);
    if (conversion) assertPngConversionCurrent(conversion);
    normalizeTaskCheckboxStaticFlowOwner(identity, root, runtime, run, geometryLease);
    throwIfBackgroundPreparationAborted(signal);
    if (conversion) assertPngConversionCurrent(conversion);
    if (yieldToBrowser?.shouldYield()) {
      await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
    }
  }
}

export function assertTaskCheckboxStaticFlowAllocations(owner: Element): void {
  [owner, ...Array.from(owner.querySelectorAll('*'))].forEach((element) => {
    const allocation = taskCheckboxStaticFlowAllocation(element);
    if (allocation) taskCheckboxStaticFlowAssertAllocation(element, allocation);
  });
}

/**
 * Validates every recorded allocation after the serialized root has reached its
 * terminal paint state. Keeping this check in the static-flow owner lets the
 * serialization orchestrator compose it after paint validation without making
 * the paint module depend back on this geometry module.
 */
export function assertTaskCheckboxStaticFlowAllocationsForRoot(root: HTMLElement): void {
  taskCheckboxStaticFlowOwnerSequence(root).forEach(({ cloneOwner }) => {
    assertTaskCheckboxStaticFlowAllocations(cloneOwner);
  });
}
