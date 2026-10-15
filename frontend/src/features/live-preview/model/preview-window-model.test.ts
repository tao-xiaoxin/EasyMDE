import { describe, expect, it } from "vitest";

import {
	createPreviewWindowModel,
	type PreviewWindowBlock,
	type PreviewWindowContext,
	type PreviewWindowViewport,
} from "./preview-window-model";

const context: PreviewWindowContext = {
	revision: 7,
	signature: "signature-7",
	styleEpoch: 2,
	widthEpoch: 3,
};

const viewport = (
	scrollTop: number,
	height: number,
): PreviewWindowViewport => ({
	scrollTop,
	height,
});

const block = (
	index: number,
	measuredHeight = 20,
	editable = true,
): PreviewWindowBlock => ({
	id: `block-${index}`,
	startLine: index * 2,
	endLine: index * 2 + 2,
	editable,
	measuredHeight,
});

const blocks = (count: number, measuredHeight = 20): PreviewWindowBlock[] =>
	Array.from({ length: count }, (_, index) => block(index, measuredHeight));

describe("PreviewWindowModel", () => {
	it("keeps the top, middle, and bottom windows within overscan and preserves neighbors", () => {
		const model = createPreviewWindowModel(blocks(20), context);

		const top = model.getWindow({ context, viewport: viewport(0, 40) });
		const middle = model.getWindow({ context, viewport: viewport(180, 40) });
		const bottom = model.getWindow({ context, viewport: viewport(360, 40) });

		expect(top.mountedIndexRange).toEqual({ start: 0, end: 7 });
		expect(top.prefix).toEqual({ range: { start: 0, end: 0 }, height: 0 });
		expect(top.suffix).toEqual({
			kind: "spacer",
			range: { start: 7, end: 20 },
			height: 260,
		});

		expect(middle.mountedIndexRange).toEqual({ start: 5, end: 16 });
		expect(middle.visibleIndexRange).toEqual({ start: 9, end: 12 });
		expect(middle.mountedIndexRange.start).toBeLessThan(
			middle.visibleIndexRange.start,
		);
		expect(middle.mountedIndexRange.end).toBeGreaterThan(
			middle.visibleIndexRange.end,
		);

		expect(bottom.mountedIndexRange).toEqual({ start: 14, end: 20 });
		expect(bottom.suffix).toEqual({ range: { start: 20, end: 20 }, height: 0 });
	});

	it("uses Fenwick prefix sums to locate offsets in a 10,000-block document", () => {
		const model = createPreviewWindowModel(blocks(10_000, 3), context);

		expect(model.findIndexAtOffset(0, context)).toBe(0);
		expect(model.findIndexAtOffset(3, context)).toBe(1);
		expect(model.findIndexAtOffset(15_000, context)).toBe(5000);
		expect(model.findIndexAtOffset(model.totalHeight - 1, context)).toBe(9999);
		expect(model.totalHeight).toBe(30_000);
	});

	it("applies the 160-block cap normally and the 192-block cap while pinned", () => {
		const model = createPreviewWindowModel(blocks(600), context, {
			maxMounted: 160,
			pinnedMax: 192,
		});

		const ordinary = model.getWindow({
			context,
			viewport: viewport(0, 10_000),
		});
		const result = model.getWindow({
			context,
			viewport: viewport(0, 10_000),
			pinnedIndices: [3, 250, 599],
		});
		const boundedPinned = model.getWindow({
			context,
			maxMaterialized: 160,
			viewport: viewport(0, 10_000),
			pinnedIndices: [3, 250, 599],
		});

		expect(
			ordinary.mountedIndexRange.end - ordinary.mountedIndexRange.start,
		).toBe(160);
		expect(
			result.mountedIndexRange.end - result.mountedIndexRange.start,
		).toBeLessThanOrEqual(192);
		expect(result.pinnedIndices).toEqual([3, 250, 599]);
		const expectedMaterialized = new Set<number>(result.pinnedIndices);
		for (
			let index = result.mountedIndexRange.start;
			index < result.mountedIndexRange.end;
			index += 1
		) {
			expectedMaterialized.add(index);
		}
		expect(result.materializedIndices).toEqual(
			[...expectedMaterialized].sort((left, right) => left - right),
		);
		expect(result.materializedCount).toBe(result.materializedIndices.length);
		expect(result.materializedCount).toBe(192);
		expect(boundedPinned.materializedCount).toBe(160);
		expect(
			model.getWindow({
				context,
				viewport: viewport(0, 10_000),
				pinnedIndices: [3, 250, 599],
			}).materializedCount,
		).toBe(192);
		expect(
			result.layoutRuns
				.filter((run) => "materialized" === run.kind)
				.reduce((count, run) => count + (run.range.end - run.range.start), 0),
		).toBe(result.materializedCount);
	});

	it("keeps distant pins in document order with exact spacer gaps", () => {
		const model = createPreviewWindowModel(blocks(10_000), context);
		const result = model.getWindow({
			context,
			viewport: viewport(0, 40),
			pinnedIndices: [5_000, 9_999],
		});

		expect(result.materializedCount).toBeLessThanOrEqual(192);
		expect(result.layoutRuns.map((run) => [run.kind, run.range])).toEqual([
			["materialized", { start: 0, end: 7 }],
			["spacer", { start: 7, end: 5_000 }],
			["materialized", { start: 5_000, end: 5_001 }],
			["spacer", { start: 5_001, end: 9_999 }],
			["materialized", { start: 9_999, end: 10_000 }],
		]);
		expect(result.layoutRuns.map((run) => run.height)).toEqual([
			140, 99_860, 20, 99_960, 20,
		]);
		expect(
			result.layoutRuns.reduce((height, run) => height + run.height, 0),
		).toBe(result.totalHeight);
	});

	it("merges adjacent materialized ranges and exposes every internal gap", () => {
		const model = createPreviewWindowModel(blocks(20), context);
		const result = model.getWindow({
			context,
			viewport: viewport(0, 40),
			pinnedIndices: [7, 10, 15],
		});

		expect(result.layoutRuns.map((run) => [run.kind, run.range])).toEqual([
			["materialized", { start: 0, end: 8 }],
			["spacer", { start: 8, end: 10 }],
			["materialized", { start: 10, end: 11 }],
			["spacer", { start: 11, end: 15 }],
			["materialized", { start: 15, end: 16 }],
			["spacer", { start: 16, end: 20 }],
		]);
		expect(
			result.layoutRuns
				.filter((run) => "spacer" === run.kind)
				.map((run) => run.height),
		).toEqual([40, 80, 80]);
	});

	it("rejects a pin count above the hard cap and out-of-bounds pins", () => {
		const model = createPreviewWindowModel(blocks(4), context, {
			pinnedMax: 2,
		});

		expect(() =>
			model.getWindow({
				context,
				viewport: viewport(0, 20),
				pinnedIndices: [0, 1, 2],
			}),
		).toThrow("preview-window-pinned-cap-exceeded");
		expect(() =>
			model.getWindow({
				context,
				viewport: viewport(0, 20),
				pinnedIndices: [-1],
			}),
		).toThrow("preview-window-pin-out-of-bounds");
		expect(() =>
			model.getWindow({
				context,
				viewport: viewport(0, 20),
				pinnedIndices: [4],
			}),
		).toThrow("preview-window-pin-out-of-bounds");
		expect(() =>
			model.getWindow({
				context,
				maxMaterialized: 0,
				viewport: viewport(0, 20),
			}),
		).toThrow("preview-window-cap-invalid");
	});

	it("returns exact anchor correction for dynamic height updates", () => {
		const model = createPreviewWindowModel(blocks(5, 20), context);

		const beforeAnchor = model.updateMeasuredHeight({
			context,
			index: 1,
			measuredHeight: 35,
			anchorIndex: 4,
		});
		const afterAnchor = model.updateMeasuredHeight({
			context,
			index: 4,
			measuredHeight: 30,
			anchorIndex: 4,
		});

		expect(beforeAnchor).toMatchObject({
			previousHeight: 20,
			measuredHeight: 35,
			delta: 15,
			anchorCorrection: 15,
			totalHeight: 115,
		});
		expect(afterAnchor).toMatchObject({
			previousHeight: 20,
			measuredHeight: 30,
			delta: 10,
			anchorCorrection: 0,
			totalHeight: 125,
		});
		expect(model.getPrefixHeight(4, context)).toBe(95);
	});

	it("resets measured heights when style or width epochs change", () => {
		const model = createPreviewWindowModel(blocks(3, 20), context, {
			estimatedHeight: 24,
		});

		model.updateMeasuredHeight({
			context,
			index: 1,
			measuredHeight: 40,
			anchorIndex: 2,
		});
		const nextContext = model.resetEpochs(context, {
			styleEpoch: 3,
			widthEpoch: 3,
		});

		expect(nextContext).toEqual({ ...context, styleEpoch: 3 });
		expect(model.totalHeight).toBe(72);
		expect(model.getPrefixHeight(2, nextContext)).toBe(48);
		expect(() =>
			model.getWindow({ context, viewport: viewport(0, 20) }),
		).toThrow("preview-window-stale");
	});

	it("fails fast for stale identity, duplicate IDs, invalid ranges, and negative heights", () => {
		const model = createPreviewWindowModel(blocks(2), context);
		const stale = { ...context, revision: 8 };

		expect(() =>
			model.getWindow({ context: stale, viewport: viewport(0, 20) }),
		).toThrow("preview-window-stale");
		expect(() =>
			model.findIndexAtOffset(0, { ...context, signature: "old" }),
		).toThrow("preview-window-stale");
		expect(() =>
			model.updateMeasuredHeight({
				context: stale,
				index: 0,
				measuredHeight: 22,
				anchorIndex: 1,
			}),
		).toThrow("preview-window-stale");

		expect(() =>
			createPreviewWindowModel(
				[block(0), { ...block(1), id: "block-0" }],
				context,
			),
		).toThrow("preview-window-duplicate-id");
		expect(() =>
			createPreviewWindowModel(
				[block(0), { ...block(1), startLine: 1 }],
				context,
			),
		).toThrow("preview-window-range-overlap");
		expect(() =>
			createPreviewWindowModel(
				[block(0), { ...block(1), startLine: 1, endLine: 1 }],
				context,
			),
		).toThrow("preview-window-range-not-monotonic");
		expect(() =>
			createPreviewWindowModel([{ ...block(0), measuredHeight: -1 }], context),
		).toThrow("preview-window-height-invalid");
	});

	it("allows non-editable generated zero-length blocks but rejects editable zero-length blocks", () => {
		expect(() =>
			createPreviewWindowModel(
				[{ ...block(0, 20, false), endLine: 0 }, block(1)],
				context,
			),
		).not.toThrow();
		expect(() =>
			createPreviewWindowModel(
				[{ ...block(0), endLine: 0 }, block(1)],
				context,
			),
		).toThrow("preview-window-range-not-monotonic");
		expect(() =>
			createPreviewWindowModel(
				[{ ...block(0, 20, false), startLine: 2, endLine: 1 }],
				context,
			),
		).toThrow("preview-window-range-not-monotonic");
	});

	it("represents collapsed edge margins with a signed gap and a shorter spacer box", () => {
		const model = createPreviewWindowModel(
			[
				{
					...block(0, 120),
					marginBefore: 16,
					marginAfter: 32,
					gapAfter: 32,
				},
				{
					...block(1, 80),
					marginBefore: 24,
					marginAfter: 12,
				},
			],
			context,
			{ maxMounted: 1 },
		);

		const result = model.getWindow({
			context,
			viewport: viewport(152, 20),
		});
		const prefix = result.layoutRuns[0];
		expect(prefix).toMatchObject({
			kind: "spacer",
			range: { start: 0, end: 1 },
			height: 120,
			flowHeight: 152,
			marginBefore: 16,
			marginAfter: 32,
		});
		expect(result.totalHeight).toBe(232);
	});

	it("fails closed for a negative forward advance and clears flow metrics on an epoch reset", () => {
		expect(() =>
			createPreviewWindowModel([{ ...block(0, 20), gapAfter: -21 }], context),
		).toThrow("preview-window-flow-geometry-invalid");

		const model = createPreviewWindowModel(
			[{ ...block(0, 20), marginBefore: 8, marginAfter: 9, gapAfter: 4 }],
			context,
		);
		const measured = model.updateMeasuredHeight({
			context,
			index: 0,
			measuredHeight: 30,
			anchorIndex: 1,
			geometry: {
				borderHeight: 30,
				marginBefore: 8,
				marginAfter: 9,
				gapAfter: 4,
			},
		});
		expect(measured).toMatchObject({
			previousFlowAdvance: 24,
			measuredFlowAdvance: 34,
			delta: 10,
		});

		const nextContext = model.resetEpochs(context, {
			styleEpoch: 3,
			widthEpoch: 4,
		});
		expect(model.flowGeometries).toEqual([
			{ borderHeight: 24, marginBefore: 0, marginAfter: 0, gapAfter: 0 },
		]);
		expect(model.getBlockFlowAdvance(0, nextContext)).toBe(24);
	});

	it("converges without a second anchor correction when the observed flow is stationary", () => {
		const model = createPreviewWindowModel(
			[block(0, 24), block(1, 24), block(2, 24)],
			context,
		);
		const geometry = {
			borderHeight: 120,
			marginBefore: 16,
			marginAfter: 32,
			gapAfter: 32,
		};
		const first = model.updateMeasuredHeight({
			context,
			index: 0,
			measuredHeight: geometry.borderHeight,
			anchorIndex: 2,
			geometry,
		});
		const second = model.updateMeasuredHeight({
			context,
			index: 0,
			measuredHeight: geometry.borderHeight,
			anchorIndex: 2,
			geometry,
		});

		expect(first).toMatchObject({ delta: 128, anchorCorrection: 128 });
		expect(second).toMatchObject({ delta: 0, anchorCorrection: 0 });
	});
});
