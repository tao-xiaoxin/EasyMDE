export type PreviewWindowBlock = Readonly<{
  id: string;
  startLine: number;
  endLine: number;
  editable: boolean;
  measuredHeight: number;
}>;

export type PreviewWindowContext = Readonly<{
  revision: number;
  signature: string;
  styleEpoch: number;
  widthEpoch: number;
}>;

export type PreviewWindowViewport = Readonly<{
  scrollTop: number;
  height: number;
}>;

export type PreviewWindowModelOptions = Readonly<{
  overscanMultiplier?: number;
  maxMounted?: number;
  pinnedMax?: number;
  estimatedHeight?: number;
}>;

export type PreviewWindowRange = Readonly<{
  start: number;
  end: number;
}>;

export type PreviewWindowSpacer = Readonly<{
  range: PreviewWindowRange;
  height: number;
}>;

export type PreviewWindowLayoutRun = Readonly<{
  kind: 'materialized' | 'spacer';
  range: PreviewWindowRange;
  height: number;
}>;

export type PreviewWindowRequest = Readonly<{
  context: PreviewWindowContext;
  viewport: PreviewWindowViewport;
  pinnedIndices?: readonly number[];
}>;

export type PreviewWindowResult = Readonly<{
  context: PreviewWindowContext;
  visibleIndexRange: PreviewWindowRange;
  overscanIndexRange: PreviewWindowRange;
  mountedIndexRange: PreviewWindowRange;
  mountedHeight: number;
  prefix: PreviewWindowSpacer;
  suffix: PreviewWindowSpacer;
  totalHeight: number;
  pinnedIndices: readonly number[];
  materializedIndices: readonly number[];
  materializedRanges: readonly PreviewWindowRange[];
  materializedCount: number;
  layoutRuns: readonly PreviewWindowLayoutRun[];
}>;

export type PreviewWindowHeightUpdateRequest = Readonly<{
  context: PreviewWindowContext;
  index: number;
  measuredHeight: number;
  anchorIndex: number;
}>;

export type PreviewWindowHeightUpdateResult = Readonly<{
  context: PreviewWindowContext;
  index: number;
  previousHeight: number;
  measuredHeight: number;
  delta: number;
  anchorCorrection: number;
  totalHeight: number;
}>;

export type PreviewWindowEpochReset = Readonly<{
  styleEpoch: number;
  widthEpoch: number;
  estimatedHeight?: number;
}>;

export type PreviewWindowErrorCode =
  | 'preview-window-block-invalid'
  | 'preview-window-duplicate-id'
  | 'preview-window-height-invalid'
  | 'preview-window-range-not-monotonic'
  | 'preview-window-range-overlap'
  | 'preview-window-viewport-invalid'
  | 'preview-window-index-out-of-bounds'
  | 'preview-window-pin-out-of-bounds'
  | 'preview-window-duplicate-pin'
  | 'preview-window-pinned-cap-exceeded'
  | 'preview-window-cap-invalid'
  | 'preview-window-epoch-invalid'
  | 'preview-window-stale'
  | 'preview-window-anchor-invalid';

type ResolvedPreviewWindowModelOptions = {
  overscanMultiplier: number;
  maxMounted: number;
  pinnedMax: number;
  estimatedHeight: number;
};

export class PreviewWindowModelError extends Error {
  readonly code: PreviewWindowErrorCode;

  constructor(code: PreviewWindowErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PreviewWindowModelError';
    this.code = code;
  }
}

const DEFAULT_OVERSCAN_MULTIPLIER = 2;
export const DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED = 160;
const DEFAULT_PINNED_MAX = 192;
const DEFAULT_ESTIMATED_HEIGHT = 24;

class FenwickTree {
  private readonly tree: number[];

  constructor(values: readonly number[]) {
    this.tree = Array.from({ length: values.length + 1 }, () => 0);
    values.forEach((value, index) => {
      this.add(index, value);
    });
  }

  get size(): number {
    return this.tree.length - 1;
  }

  add(index: number, delta: number): void {
    for (let cursor = index + 1; cursor <= this.size; cursor += cursor & -cursor) {
      this.tree[cursor] = (this.tree[cursor] ?? 0) + delta;
    }
  }

  sum(count: number): number {
    let result = 0;
    for (let cursor = count; cursor > 0; cursor -= cursor & -cursor) {
      result += this.tree[cursor] ?? 0;
    }
    return result;
  }

  total(): number {
    return this.sum(this.size);
  }

  /** Returns the first zero-based index whose bottom is greater than target. */
  firstPrefixGreaterThan(target: number): number {
    let index = 0;
    let prefix = 0;
    let step = 1;
    while (step < this.size) {
      step *= 2;
    }

    for (; step > 0; step = Math.floor(step / 2)) {
      const next = index + step;
      const nextPrefix = prefix + (this.tree[next] ?? 0);
      if (next <= this.size && nextPrefix <= target) {
        index = next;
        prefix = nextPrefix;
      }
    }

    return Math.min(index, Math.max(0, this.size - 1));
  }
}

function fail(code: PreviewWindowErrorCode, detail?: string): never {
  throw new PreviewWindowModelError(code, detail);
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function assertContextShape(context: PreviewWindowContext): void {
  if (
    !context
    || !Number.isInteger(context.revision)
    || context.revision < 0
    || 'string' !== typeof context.signature
    || !Number.isInteger(context.styleEpoch)
    || context.styleEpoch < 0
    || !Number.isInteger(context.widthEpoch)
    || context.widthEpoch < 0
  ) {
    fail('preview-window-stale', 'context shape is invalid');
  }
}

function copyContext(context: PreviewWindowContext): PreviewWindowContext {
  return {
    revision: context.revision,
    signature: context.signature,
    styleEpoch: context.styleEpoch,
    widthEpoch: context.widthEpoch
  };
}

function isSameContext(left: PreviewWindowContext, right: PreviewWindowContext): boolean {
  return left.revision === right.revision
    && left.signature === right.signature
    && left.styleEpoch === right.styleEpoch
    && left.widthEpoch === right.widthEpoch;
}

function validateBlock(block: PreviewWindowBlock, index: number, previous: PreviewWindowBlock | undefined): void {
  if (
    !block
    || 'string' !== typeof block.id
    || 'boolean' !== typeof block.editable
    || !Number.isInteger(block.startLine)
    || !Number.isInteger(block.endLine)
  ) {
    fail('preview-window-block-invalid', `invalid block at index ${index}`);
  }
  if (!Number.isFinite(block.measuredHeight) || block.measuredHeight < 0) {
    fail('preview-window-height-invalid', `invalid height at index ${index}`);
  }
  if (
    block.startLine < 0
    || block.endLine < block.startLine
    || (block.editable && block.endLine <= block.startLine)
  ) {
    fail('preview-window-range-not-monotonic', `invalid line range at index ${index}`);
  }
  if (previous && block.startLine < previous.startLine) {
    fail('preview-window-range-not-monotonic', `line range moved backwards at index ${index}`);
  }
  if (previous && block.startLine < previous.endLine) {
    fail('preview-window-range-overlap', `line range overlaps at index ${index}`);
  }
}

function validateOptions(options: ResolvedPreviewWindowModelOptions): void {
  if (!Number.isFinite(options.overscanMultiplier) || options.overscanMultiplier < 0) {
    fail('preview-window-cap-invalid', 'overscanMultiplier must be finite and non-negative');
  }
  if (!Number.isInteger(options.maxMounted) || options.maxMounted < 1) {
    fail('preview-window-cap-invalid', 'maxMounted must be a positive integer');
  }
  if (!Number.isInteger(options.pinnedMax) || options.pinnedMax < 0) {
    fail('preview-window-cap-invalid', 'pinnedMax must be a non-negative integer');
  }
  if (!isFiniteNonNegative(options.estimatedHeight)) {
    fail('preview-window-height-invalid', 'estimatedHeight must be finite and non-negative');
  }
}

function validateViewport(viewport: PreviewWindowViewport): void {
  if (!viewport || !isFiniteNonNegative(viewport.scrollTop) || !isFiniteNonNegative(viewport.height)) {
    fail('preview-window-viewport-invalid');
  }
}

function validateIndex(index: number, size: number, code: PreviewWindowErrorCode): void {
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    fail(code, `index ${index} is outside [0, ${size})`);
  }
}

function emptyRange(at: number): PreviewWindowRange {
  return { start: at, end: at };
}

export class PreviewWindowModel {
  private readonly blockValues: readonly PreviewWindowBlock[];
  private readonly options: ResolvedPreviewWindowModelOptions;
  private heights: number[];
  private tree: FenwickTree;
  private contextValue: PreviewWindowContext;

  constructor(
    blocks: readonly PreviewWindowBlock[],
    context: PreviewWindowContext,
    options: PreviewWindowModelOptions = {}
  ) {
    assertContextShape(context);
    const resolvedOptions: ResolvedPreviewWindowModelOptions = {
      overscanMultiplier: options.overscanMultiplier ?? DEFAULT_OVERSCAN_MULTIPLIER,
      maxMounted: options.maxMounted ?? DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED,
      pinnedMax: options.pinnedMax ?? DEFAULT_PINNED_MAX,
      estimatedHeight: options.estimatedHeight ?? DEFAULT_ESTIMATED_HEIGHT
    };
    validateOptions(resolvedOptions);

    const seenIds = new Set<string>();
    blocks.forEach((block, index) => {
      validateBlock(block, index, blocks[index - 1]);
      if (seenIds.has(block.id)) {
        fail('preview-window-duplicate-id', `duplicate id ${block.id}`);
      }
      seenIds.add(block.id);
    });

    this.blockValues = blocks.map((block) => ({ ...block }));
    this.options = resolvedOptions;
    this.heights = this.blockValues.map((block) => block.measuredHeight);
    this.tree = new FenwickTree(this.heights);
    this.contextValue = copyContext(context);
  }

  get blocks(): readonly PreviewWindowBlock[] {
    return this.blockValues;
  }

  get blockCount(): number {
    return this.blockValues.length;
  }

  get totalHeight(): number {
    return this.tree.total();
  }

  get currentContext(): PreviewWindowContext {
    return copyContext(this.contextValue);
  }

  get measuredHeights(): readonly number[] {
    return [...this.heights];
  }

  isCurrent(context: PreviewWindowContext): boolean {
    assertContextShape(context);
    return isSameContext(this.contextValue, context);
  }

  assertCurrent(context: PreviewWindowContext): void {
    assertContextShape(context);
    if (!isSameContext(this.contextValue, context)) {
      fail('preview-window-stale');
    }
  }

  findIndexAtOffset(offset: number, context: PreviewWindowContext): number | null {
    this.assertCurrent(context);
    if (!isFiniteNonNegative(offset)) {
      fail('preview-window-viewport-invalid', 'offset must be finite and non-negative');
    }
    if (0 === this.blockValues.length) {
      return null;
    }
    if (offset <= 0 || 0 === this.totalHeight) {
      return 0;
    }
    if (offset >= this.totalHeight) {
      return this.blockValues.length - 1;
    }
    return this.tree.firstPrefixGreaterThan(offset);
  }

  getPrefixHeight(end: number, context: PreviewWindowContext): number {
    this.assertCurrent(context);
    if (!Number.isInteger(end) || end < 0 || end > this.blockValues.length) {
      fail('preview-window-index-out-of-bounds', `range end ${end} is outside [0, ${this.blockValues.length}]`);
    }
    return this.tree.sum(end);
  }

  getBlockTop(index: number, context: PreviewWindowContext): number {
    this.assertCurrent(context);
    validateIndex(index, this.blockValues.length, 'preview-window-index-out-of-bounds');
    return this.tree.sum(index);
  }

  getBlockHeight(index: number, context: PreviewWindowContext): number {
    this.assertCurrent(context);
    validateIndex(index, this.blockValues.length, 'preview-window-index-out-of-bounds');
    return this.heights[index] ?? fail('preview-window-index-out-of-bounds');
  }

  private materializedCountForRange(range: PreviewWindowRange, pinnedIndices: readonly number[]): number {
    return range.end - range.start + pinnedIndices.filter(
      (index) => index < range.start || index >= range.end
    ).length;
  }

  private materializedRanges(
    mountedIndexRange: PreviewWindowRange,
    pinnedIndices: readonly number[]
  ): PreviewWindowRange[] {
    const candidates: PreviewWindowRange[] = [];
    if (mountedIndexRange.start < mountedIndexRange.end) {
      candidates.push(mountedIndexRange);
    }
    pinnedIndices.forEach((index) => {
      candidates.push({ start: index, end: index + 1 });
    });
    candidates.sort((left, right) => left.start - right.start || left.end - right.end);

    const merged: PreviewWindowRange[] = [];
    candidates.forEach((candidate) => {
      const previous = merged[merged.length - 1];
      if (!previous || candidate.start > previous.end) {
        merged.push({ ...candidate });
        return;
      }
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, candidate.end)
      };
    });
    return merged;
  }

  private rangeHeight(range: PreviewWindowRange): number {
    return this.tree.sum(range.end) - this.tree.sum(range.start);
  }

  private layoutRuns(ranges: readonly PreviewWindowRange[]): PreviewWindowLayoutRun[] {
    const runs: PreviewWindowLayoutRun[] = [];
    let cursor = 0;
    ranges.forEach((range) => {
      if (cursor < range.start) {
        runs.push({
          kind: 'spacer',
          range: { start: cursor, end: range.start },
          height: this.rangeHeight({ start: cursor, end: range.start })
        });
      }
      runs.push({
        kind: 'materialized',
        range: { ...range },
        height: this.rangeHeight(range)
      });
      cursor = range.end;
    });
    if (cursor < this.blockValues.length) {
      runs.push({
        kind: 'spacer',
        range: { start: cursor, end: this.blockValues.length },
        height: this.rangeHeight({ start: cursor, end: this.blockValues.length })
      });
    }
    return runs;
  }

  private materializedIndices(ranges: readonly PreviewWindowRange[]): number[] {
    const indices: number[] = [];
    ranges.forEach((range) => {
      for (let index = range.start; index < range.end; index += 1) {
        indices.push(index);
      }
    });
    return indices;
  }

  getWindow(request: PreviewWindowRequest): PreviewWindowResult {
    this.assertCurrent(request.context);
    validateViewport(request.viewport);
    const pinnedIndices = this.normalizePinnedIndices(request.pinnedIndices ?? []);
    const blockCount = this.blockValues.length;
    const materializedLimit = pinnedIndices.length > 0
      ? this.options.pinnedMax
      : this.options.maxMounted;

    if (0 === blockCount) {
      const zeroRange = emptyRange(0);
      return {
        context: copyContext(this.contextValue),
        visibleIndexRange: zeroRange,
        overscanIndexRange: zeroRange,
        mountedIndexRange: zeroRange,
        mountedHeight: 0,
        prefix: { range: zeroRange, height: 0 },
        suffix: { range: zeroRange, height: 0 },
        totalHeight: 0,
        pinnedIndices,
        materializedIndices: [],
        materializedRanges: [],
        materializedCount: 0,
        layoutRuns: []
      };
    }

    const totalHeight = this.totalHeight;
    const scrollTop = Math.min(request.viewport.scrollTop, totalHeight);
    const viewportEndOffset = Math.min(totalHeight, scrollTop + request.viewport.height);
    const visibleStart = this.findIndexAtOffset(scrollTop, this.contextValue) ?? 0;
    const visibleEndIndex = this.findIndexAtOffset(viewportEndOffset, this.contextValue) ?? visibleStart;
    const visibleEnd = Math.min(blockCount, visibleEndIndex + 1);
    const visibleIndexRange: PreviewWindowRange = { start: visibleStart, end: visibleEnd };
    const visibleFits = visibleEnd - visibleStart <= materializedLimit;

    const overscanDistance = request.viewport.height * this.options.overscanMultiplier;
    const overscanStartOffset = Math.max(0, scrollTop - overscanDistance);
    const overscanEndOffset = Math.min(totalHeight, viewportEndOffset + overscanDistance);
    const overscanStart = this.findIndexAtOffset(overscanStartOffset, this.contextValue) ?? 0;
    const overscanEndIndex = this.findIndexAtOffset(overscanEndOffset, this.contextValue) ?? overscanStart;
    const overscanEnd = Math.min(blockCount, overscanEndIndex + 1);
    const overscanIndexRange: PreviewWindowRange = { start: overscanStart, end: overscanEnd };

    let mountedStart = Math.min(overscanStart, Math.max(0, visibleStart - 1));
    let mountedEnd = Math.max(overscanEnd, Math.min(blockCount, visibleEnd + 1));
    if (mountedEnd <= mountedStart) {
      mountedEnd = Math.min(blockCount, mountedStart + 1);
    }

    if (mountedEnd - mountedStart > materializedLimit) {
      const centerOffset = Math.min(totalHeight, scrollTop + request.viewport.height / 2);
      const centerIndex = this.findIndexAtOffset(centerOffset, this.contextValue) ?? mountedStart;
      mountedStart = centerIndex - Math.floor(materializedLimit / 2);
      mountedStart = Math.max(0, Math.min(mountedStart, blockCount - materializedLimit));
      mountedEnd = Math.min(blockCount, mountedStart + materializedLimit);
    }

    while (
      this.materializedCountForRange({ start: mountedStart, end: mountedEnd }, pinnedIndices)
      > materializedLimit
    ) {
      const canRemoveStart = !visibleFits || mountedStart < visibleIndexRange.start;
      const canRemoveEnd = !visibleFits || mountedEnd > visibleIndexRange.end;
      if (!canRemoveStart && !canRemoveEnd) {
        fail('preview-window-pinned-cap-exceeded', 'visible window cannot fit the materialized cap');
      }
      if (!canRemoveEnd) {
        mountedStart += 1;
        continue;
      }
      if (!canRemoveStart) {
        mountedEnd -= 1;
        continue;
      }

      const withoutStart = this.materializedCountForRange(
        { start: mountedStart + 1, end: mountedEnd },
        pinnedIndices
      );
      const withoutEnd = this.materializedCountForRange(
        { start: mountedStart, end: mountedEnd - 1 },
        pinnedIndices
      );
      if (withoutStart <= withoutEnd) {
        mountedStart += 1;
      } else {
        mountedEnd -= 1;
      }
    }

    const mountedIndexRange: PreviewWindowRange = { start: mountedStart, end: mountedEnd };
    const mountedHeight = this.tree.sum(mountedEnd) - this.tree.sum(mountedStart);
    const materializedRanges = this.materializedRanges(mountedIndexRange, pinnedIndices);
    const materializedIndices = this.materializedIndices(materializedRanges);
    if (materializedIndices.length > materializedLimit) {
      fail('preview-window-pinned-cap-exceeded', 'materialized ranges exceed the hard cap');
    }
    const layoutRuns = this.layoutRuns(materializedRanges);
    const firstRun = layoutRuns[0];
    const lastRun = layoutRuns[layoutRuns.length - 1];
    const prefix: PreviewWindowSpacer = firstRun && 'spacer' === firstRun.kind
      ? firstRun
      : { range: emptyRange(0), height: 0 };
    const suffix: PreviewWindowSpacer = lastRun && 'spacer' === lastRun.kind
      ? lastRun
      : { range: emptyRange(blockCount), height: 0 };

    return {
      context: copyContext(this.contextValue),
      visibleIndexRange,
      overscanIndexRange,
      mountedIndexRange,
      mountedHeight,
      prefix,
      suffix,
      totalHeight,
      pinnedIndices,
      materializedIndices,
      materializedRanges,
      materializedCount: materializedIndices.length,
      layoutRuns
    };
  }

  updateMeasuredHeight({
    context,
    index,
    measuredHeight,
    anchorIndex
  }: PreviewWindowHeightUpdateRequest): PreviewWindowHeightUpdateResult {
    this.assertCurrent(context);
    validateIndex(index, this.blockValues.length, 'preview-window-index-out-of-bounds');
    if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex > this.blockValues.length) {
      fail('preview-window-anchor-invalid', `anchor ${anchorIndex} is outside [0, ${this.blockValues.length}]`);
    }
    if (!isFiniteNonNegative(measuredHeight)) {
      fail('preview-window-height-invalid', `invalid height at index ${index}`);
    }

    const previousHeight = this.heights[index] ?? fail('preview-window-index-out-of-bounds');
    const delta = measuredHeight - previousHeight;
    if (0 !== delta) {
      this.heights[index] = measuredHeight;
      this.tree.add(index, delta);
    }

    return {
      context: copyContext(this.contextValue),
      index,
      previousHeight,
      measuredHeight,
      delta,
      anchorCorrection: index < anchorIndex ? delta : 0,
      totalHeight: this.totalHeight
    };
  }

  resetEpochs(context: PreviewWindowContext, next: PreviewWindowEpochReset): PreviewWindowContext {
    this.assertCurrent(context);
    if (
      !Number.isInteger(next.styleEpoch)
      || next.styleEpoch < this.contextValue.styleEpoch
      || !Number.isInteger(next.widthEpoch)
      || next.widthEpoch < this.contextValue.widthEpoch
      || (next.styleEpoch === this.contextValue.styleEpoch && next.widthEpoch === this.contextValue.widthEpoch)
    ) {
      fail('preview-window-epoch-invalid');
    }
    const estimatedHeight = next.estimatedHeight ?? this.options.estimatedHeight;
    if (!isFiniteNonNegative(estimatedHeight)) {
      fail('preview-window-height-invalid', 'estimatedHeight must be finite and non-negative');
    }

    this.options.estimatedHeight = estimatedHeight;
    this.heights = this.blockValues.map(() => estimatedHeight);
    this.tree = new FenwickTree(this.heights);
    this.contextValue = {
      revision: this.contextValue.revision,
      signature: this.contextValue.signature,
      styleEpoch: next.styleEpoch,
      widthEpoch: next.widthEpoch
    };
    return copyContext(this.contextValue);
  }

  private normalizePinnedIndices(indices: readonly number[]): readonly number[] {
    if (indices.length > this.options.pinnedMax) {
      fail('preview-window-pinned-cap-exceeded');
    }
    const seen = new Set<number>();
    indices.forEach((index) => {
      if (!Number.isInteger(index) || index < 0 || index >= this.blockValues.length) {
        fail('preview-window-pin-out-of-bounds', `pin ${index} is outside [0, ${this.blockValues.length})`);
      }
      if (seen.has(index)) {
        fail('preview-window-duplicate-pin', `pin ${index} appears more than once`);
      }
      seen.add(index);
    });
    return [...seen].sort((left, right) => left - right);
  }
}

export function createPreviewWindowModel(
  blocks: readonly PreviewWindowBlock[],
  context: PreviewWindowContext,
  options: PreviewWindowModelOptions = {}
): PreviewWindowModel {
  return new PreviewWindowModel(blocks, context, options);
}
