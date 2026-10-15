import { describe, expect, it, vi } from "vitest";

import {
	createPreviewWindowModel,
	type PreviewWindowContext,
} from "../model/preview-window-model";
import {
	capturePreviewWindowFlowBoundary,
	measurePreviewWindowBlockGeometry,
	type PreviewWindowNodeRepository,
	reconcilePreviewWindowSpacerFlow,
	windowNodes,
} from "./preview-window-dom";

const context: PreviewWindowContext = {
	revision: 2,
	signature: "flow-geometry",
	styleEpoch: 1,
	widthEpoch: 1,
};

function root(id: string): HTMLElement {
	const element = document.createElement("blockquote");
	element.setAttribute("data-easymde-visual-block-id", id);
	element.style.marginBlockStart = "0px";
	element.style.marginBlockEnd = "0px";
	return element;
}

function rect(top: number, height: number): DOMRect {
	return {
		bottom: top + height,
		height,
		left: 0,
		right: 320,
		top,
		width: 320,
		x: 0,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

function block(id: string, index: number, measuredHeight = 24) {
	return {
		id,
		startLine: index,
		endLine: index + 1,
		editable: true,
		measuredHeight,
	};
}

describe("preview-window-dom", () => {
	it("measures the signed physical gap and preserves fractional margins", () => {
		const canvas = document.createElement("div");
		const first = root("b0");
		const second = root("b1");
		canvas.append(first, second);
		document.body.append(canvas);
		first.style.marginBlockStart = "16.5px";
		first.style.marginBlockEnd = "16.5px";
		second.style.marginBlockStart = "16.5px";
		Object.defineProperty(first, "offsetHeight", {
			configurable: true,
			value: 120,
		});
		vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(100, 120));
		vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(236.5, 80));

		expect(measurePreviewWindowBlockGeometry(first, second)).toEqual({
			geometry: {
				borderHeight: 120,
				marginBefore: 16.5,
				marginAfter: 16.5,
				gapAfter: 16.5,
			},
			gapMeasured: true,
		});
		canvas.remove();
	});

	it("uses the previous complete metric while a theme transform is active", () => {
		const canvas = document.createElement("div");
		const first = root("b0");
		canvas.append(first);
		document.body.append(canvas);
		first.style.transform = "scale(1.01)";
		vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(100, 121.2));
		expect(measurePreviewWindowBlockGeometry(first, null)).toBeNull();
		canvas.remove();
	});

	it("fails closed when a flex flow gap cannot be represented by block margins", () => {
		const canvas = document.createElement("div");
		const first = root("b0");
		const second = root("b1");
		canvas.append(first, second);
		document.body.append(canvas);
		canvas.style.display = "flex";
		vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(100, 120));
		vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(232, 80));

		expect(() => measurePreviewWindowBlockGeometry(first, second)).toThrow(
			"preview-window-flow-gap-unrepresentable",
		);
		canvas.remove();
	});

	it("fails closed when computed flow margins are unavailable", () => {
		const canvas = document.createElement("div");
		const first = document.createElement("blockquote");
		first.setAttribute("data-easymde-visual-block-id", "b0");
		canvas.append(first);
		document.body.append(canvas);
		vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(100, 120));
		vi.spyOn(window, "getComputedStyle").mockReturnValueOnce({
			marginBlockStart: "",
			marginTop: "",
		} as CSSStyleDeclaration);

		expect(() => measurePreviewWindowBlockGeometry(first, null)).toThrow(
			"preview-window-flow-marginBlockStart-invalid",
		);
		canvas.remove();
	});

	it("applies edge margins and box size to a hidden run spacer", () => {
		const first = root("b0");
		const second = root("b1");
		const model = createPreviewWindowModel(
			[
				{
					...block("b0", 0, 120),
					marginBefore: 16,
					marginAfter: 32,
					gapAfter: 32,
				},
				{ ...block("b1", 1, 80), marginBefore: 24, marginAfter: 12 },
			],
			context,
			{ maxMounted: 1 },
		);
		const geometry: PreviewWindowNodeRepository["flowGeometry"] = [
			{ borderHeight: 120, marginBefore: 16, marginAfter: 32, gapAfter: 32 },
			{ borderHeight: 80, marginBefore: 24, marginAfter: 12, gapAfter: 0 },
		];
		const repository = {
			blocks: [
				{ index: 0, map: block("b0", 0), node: first },
				{ index: 1, map: block("b1", 1), node: second },
			],
			context,
			indexById: new Map([
				["b0", 0],
				["b1", 1],
			]),
			model,
			nodes: [first, second],
			flowGeometry: geometry,
			flowGeometryEpoch: [null, null],
			flowGapEpoch: [null, null],
			flowBoundary: null,
			spacerContentHeights: new Map(),
			spacers: new Map(),
		} satisfies PreviewWindowNodeRepository;
		const result = model.getWindow({
			context,
			viewport: { scrollTop: 152, height: 20 },
		});
		const nodes = windowNodes(repository, result);
		const spacer = nodes.find(
			(node): node is HTMLElement =>
				node instanceof HTMLElement &&
				node.hasAttribute("data-easymde-preview-window-spacer"),
		);
		expect(spacer?.style.blockSize).toBe("120px");
		expect(spacer?.style.marginBlockStart).toBe("16px");
		expect(spacer?.style.marginBlockEnd).toBe("32px");
	});

	it("retains the previous trailing gap until the full surface end is measured", () => {
		const canvas = document.createElement("div");
		const last = root("b0");
		last.style.marginBlockEnd = "12.5px";
		canvas.append(last);
		document.body.append(canvas);
		Object.defineProperty(last, "offsetHeight", {
			configurable: true,
			value: 120,
		});
		vi.spyOn(last, "getBoundingClientRect").mockReturnValue(rect(100, 120));

		expect(
			measurePreviewWindowBlockGeometry(last, null, {
				borderHeight: 120,
				marginBefore: 0,
				marginAfter: 0,
				gapAfter: 5,
			}),
		).toEqual({
			geometry: {
				borderHeight: 120,
				marginBefore: 0,
				marginAfter: 12.5,
				gapAfter: 5,
			},
			gapMeasured: false,
		});
		canvas.remove();
	});

	it("captures the accepted full-flow boundary in canvas coordinates", () => {
		const canvas = document.createElement("div");
		canvas.className = "easymde-immersive-preview-canvas";
		const surface = document.createElement("article");
		const first = root("b0");
		const last = root("b1");
		canvas.append(surface);
		surface.append(first, last);
		document.body.append(canvas);
		canvas.scrollTop = 120;
		vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect(50, 300));
		const surfaceRect = vi
			.spyOn(surface, "getBoundingClientRect")
			.mockReturnValue(rect(50, 307));
		vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(70, 20));
		vi.spyOn(last, "getBoundingClientRect").mockReturnValue(rect(320, 30));

		const model = createPreviewWindowModel(
			[
				{ ...block("b0", 0, 20), gapAfter: 10 },
				{ ...block("b1", 1, 30), marginAfter: 7, gapAfter: 7 },
			],
			context,
		);
		const repository = {
			blocks: [
				{ index: 0, map: block("b0", 0), node: first },
				{ index: 1, map: block("b1", 1), node: last },
			],
			context,
			indexById: new Map([
				["b0", 0],
				["b1", 1],
			]),
			model,
			nodes: [first, last],
			flowGeometry: [
				{ borderHeight: 20, marginBefore: 0, marginAfter: 0, gapAfter: 10 },
				{ borderHeight: 30, marginBefore: 0, marginAfter: 7, gapAfter: 7 },
			],
			flowGeometryEpoch: ["2:flow-geometry:1:1", "2:flow-geometry:1:1"],
			flowGapEpoch: ["2:flow-geometry:1:1", "2:flow-geometry:1:1"],
			flowBoundary: null,
			spacerContentHeights: new Map(),
			spacers: new Map(),
		} satisfies PreviewWindowNodeRepository;

		capturePreviewWindowFlowBoundary(
			repository,
			surface,
			"2:flow-geometry:1:1",
		);
		expect(repository.flowBoundary).toMatchObject({
			origin: 140,
			end: 427,
		});
		expect(repository.flowGeometry[1]?.gapAfter).toBe(7);
		surfaceRect.mockReturnValue(rect(50, 295));
		capturePreviewWindowFlowBoundary(
			repository,
			surface,
			"2:flow-geometry:1:1",
		);
		expect(repository.flowBoundary).toMatchObject({ end: 415 });
		expect(repository.flowGeometry[1]?.gapAfter).toBe(-5);
		surfaceRect.mockReturnValue(rect(50, 269));
		expect(() =>
			capturePreviewWindowFlowBoundary(
				repository,
				surface,
				"2:flow-geometry:1:1",
			),
		).toThrow("preview-window-flow-tail-invalid");
		canvas.remove();
	});

	it("derives a bounded spacer from measured incoming and outgoing edges", () => {
		const canvas = document.createElement("div");
		const surface = document.createElement("article");
		const previous = root("b0");
		const hiddenFirst = root("b1");
		const hiddenLast = root("b2");
		const next = root("b3");
		const spacer = document.createElement("div");
		spacer.setAttribute("data-easymde-preview-window-spacer", "1");
		spacer.setAttribute("data-easymde-preview-window-start", "1");
		spacer.setAttribute("data-easymde-preview-window-end", "3");
		spacer.style.blockSize = "50px";
		canvas.append(surface);
		surface.append(previous, spacer, next);
		document.body.append(canvas);
		vi.spyOn(previous, "getBoundingClientRect").mockReturnValue(rect(100, 30));
		vi.spyOn(spacer, "getBoundingClientRect").mockImplementation(() => {
			const height = Number.parseFloat(spacer.style.blockSize);
			return rect(140, height);
		});
		vi.spyOn(next, "getBoundingClientRect").mockImplementation(() => {
			const height = Number.parseFloat(spacer.style.blockSize);
			return rect(140 + height + 15, 60);
		});
		const flowEpoch = "2:flow-geometry:1:1";
		const model = createPreviewWindowModel(
			[
				{ ...block("b0", 0, 30), gapAfter: 10 },
				{ ...block("b1", 1, 40), gapAfter: 20 },
				{ ...block("b2", 2, 50), gapAfter: 30 },
				{ ...block("b3", 3, 60), gapAfter: 15 },
			],
			context,
			{ maxMounted: 1 },
		);
		const repository = {
			blocks: [
				{ index: 0, map: block("b0", 0), node: previous },
				{ index: 1, map: block("b1", 1), node: hiddenFirst },
				{ index: 2, map: block("b2", 2), node: hiddenLast },
				{ index: 3, map: block("b3", 3), node: next },
			],
			context,
			indexById: new Map([
				["b0", 0],
				["b1", 1],
				["b2", 2],
				["b3", 3],
			]),
			model,
			nodes: [previous, hiddenFirst, hiddenLast, next],
			flowGeometry: [
				{ borderHeight: 30, marginBefore: 0, marginAfter: 0, gapAfter: 10 },
				{ borderHeight: 40, marginBefore: 0, marginAfter: 0, gapAfter: 20 },
				{ borderHeight: 50, marginBefore: 0, marginAfter: 0, gapAfter: 30 },
				{ borderHeight: 60, marginBefore: 0, marginAfter: 0, gapAfter: 15 },
			],
			flowGeometryEpoch: [flowEpoch, flowEpoch, flowEpoch, flowEpoch],
			flowGapEpoch: [flowEpoch, flowEpoch, flowEpoch, flowEpoch],
			flowGapUnknownRanges: [] as Array<{ end: number; start: number }>,
			flowBoundary: null,
			spacerContentHeights: new Map(),
			spacers: new Map(),
		} satisfies PreviewWindowNodeRepository;

		repository.flowGapUnknownRanges?.push({ end: 1, start: 0 });
		expect(
			reconcilePreviewWindowSpacerFlow(repository, surface, spacer, flowEpoch),
		).toBeNull();
		expect(spacer.style.blockSize).toBe("50px");
		repository.flowGapUnknownRanges?.splice(
			0,
			repository.flowGapUnknownRanges.length,
		);
		const reconciliation = reconcilePreviewWindowSpacerFlow(
			repository,
			surface,
			spacer,
			flowEpoch,
		);
		expect(reconciliation).toEqual({
			contentHeight: 125,
			desiredSpan: 150,
			range: { start: 1, end: 3 },
		});
		expect(spacer.style.blockSize).toBe("125px");
		canvas.remove();
	});

	it("keeps a prefix spacer stable in document coordinates while scrolling", () => {
		const canvas = document.createElement("div");
		const surface = document.createElement("article");
		const hiddenFirst = root("b0");
		const hiddenLast = root("b1");
		const next = root("b2");
		const spacer = document.createElement("div");
		spacer.setAttribute("data-easymde-preview-window-spacer", "1");
		spacer.setAttribute("data-easymde-preview-window-start", "0");
		spacer.setAttribute("data-easymde-preview-window-end", "2");
		spacer.style.blockSize = "50px";
		canvas.append(surface);
		surface.append(spacer, next);
		document.body.append(canvas);
		vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect(50, 300));
		vi.spyOn(spacer, "getBoundingClientRect").mockImplementation(() => {
			const top = 70 - canvas.scrollTop;
			const height = Number.parseFloat(spacer.style.blockSize);
			return rect(top, height);
		});
		vi.spyOn(next, "getBoundingClientRect").mockImplementation(() => {
			const top = 70 - canvas.scrollTop;
			const height = Number.parseFloat(spacer.style.blockSize);
			return rect(top + height + 10, 60);
		});
		canvas.scrollTop = 40;
		const flowEpoch = "2:flow-geometry:1:1";
		const model = createPreviewWindowModel(
			[
				{ ...block("b0", 0, 30), gapAfter: 10 },
				{ ...block("b1", 1, 40), gapAfter: 20 },
				{ ...block("b2", 2, 60), gapAfter: 0 },
			],
			context,
			{ maxMounted: 1 },
		);
		const repository = {
			blocks: [
				{ index: 0, map: block("b0", 0), node: hiddenFirst },
				{ index: 1, map: block("b1", 1), node: hiddenLast },
				{ index: 2, map: block("b2", 2), node: next },
			],
			context,
			indexById: new Map([
				["b0", 0],
				["b1", 1],
				["b2", 2],
			]),
			model,
			nodes: [hiddenFirst, hiddenLast, next],
			flowGeometry: [
				{ borderHeight: 30, marginBefore: 0, marginAfter: 0, gapAfter: 10 },
				{ borderHeight: 40, marginBefore: 0, marginAfter: 0, gapAfter: 20 },
				{ borderHeight: 60, marginBefore: 0, marginAfter: 0, gapAfter: 0 },
			],
			flowGeometryEpoch: [flowEpoch, flowEpoch, flowEpoch],
			flowGapEpoch: [flowEpoch, flowEpoch, flowEpoch],
			flowBoundary: {
				epoch: flowEpoch,
				first: hiddenFirst,
				last: next,
				origin: 20,
				end: 300,
			},
			spacerContentHeights: new Map(),
			spacers: new Map(),
		} satisfies PreviewWindowNodeRepository;

		const first = reconcilePreviewWindowSpacerFlow(
			repository,
			surface,
			spacer,
			flowEpoch,
		);
		canvas.scrollTop = 120;
		const afterScroll = reconcilePreviewWindowSpacerFlow(
			repository,
			surface,
			spacer,
			flowEpoch,
		);
		expect(first?.contentHeight).toBe(90);
		expect(afterScroll?.contentHeight).toBe(90);
		expect(afterScroll?.desiredSpan).toBe(first?.desiredSpan);
		canvas.remove();
	});

	it("keeps a suffix spacer stable against the measured full-flow tail", () => {
		const canvas = document.createElement("div");
		const surface = document.createElement("article");
		const previous = root("b0");
		const hiddenFirst = root("b1");
		const hiddenLast = root("b2");
		const spacer = document.createElement("div");
		spacer.setAttribute("data-easymde-preview-window-spacer", "1");
		spacer.setAttribute("data-easymde-preview-window-start", "1");
		spacer.setAttribute("data-easymde-preview-window-end", "3");
		spacer.style.blockSize = "80px";
		canvas.append(surface);
		surface.append(previous, spacer);
		document.body.append(canvas);
		vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect(50, 300));
		vi.spyOn(previous, "getBoundingClientRect").mockImplementation(() =>
			rect(70 - canvas.scrollTop, 30),
		);
		vi.spyOn(spacer, "getBoundingClientRect").mockImplementation(() => {
			const top = 110 - canvas.scrollTop;
			const height = Number.parseFloat(spacer.style.blockSize);
			return rect(top, height);
		});
		const surfaceRect = vi
			.spyOn(surface, "getBoundingClientRect")
			.mockImplementation(() =>
				rect(0, spacer.getBoundingClientRect().bottom + 15),
			);
		canvas.scrollTop = 40;
		const flowEpoch = "2:flow-geometry:1:1";
		const model = createPreviewWindowModel(
			[
				{ ...block("b0", 0, 30), gapAfter: 10 },
				{ ...block("b1", 1, 40), gapAfter: 20 },
				{ ...block("b2", 2, 50), gapAfter: 15 },
			],
			context,
			{ maxMounted: 1 },
		);
		const repository = {
			blocks: [
				{ index: 0, map: block("b0", 0), node: previous },
				{ index: 1, map: block("b1", 1), node: hiddenFirst },
				{ index: 2, map: block("b2", 2), node: hiddenLast },
			],
			context,
			indexById: new Map([
				["b0", 0],
				["b1", 1],
				["b2", 2],
			]),
			model,
			nodes: [previous, hiddenFirst, hiddenLast],
			flowGeometry: [
				{ borderHeight: 30, marginBefore: 0, marginAfter: 0, gapAfter: 10 },
				{ borderHeight: 40, marginBefore: 0, marginAfter: 0, gapAfter: 20 },
				{ borderHeight: 50, marginBefore: 0, marginAfter: 0, gapAfter: 15 },
			],
			flowGeometryEpoch: [flowEpoch, flowEpoch, flowEpoch],
			flowGapEpoch: [flowEpoch, flowEpoch, flowEpoch],
			flowBoundary: {
				epoch: flowEpoch,
				first: previous,
				last: hiddenLast,
				origin: 20,
				end: 185,
			},
			spacerContentHeights: new Map(),
			spacers: new Map(),
		} satisfies PreviewWindowNodeRepository;

		const first = reconcilePreviewWindowSpacerFlow(
			repository,
			surface,
			spacer,
			flowEpoch,
		);
		canvas.scrollTop = 120;
		const afterScroll = reconcilePreviewWindowSpacerFlow(
			repository,
			surface,
			spacer,
			flowEpoch,
		);
		expect(first?.contentHeight).toBe(110);
		expect(afterScroll?.contentHeight).toBe(110);
		expect(afterScroll?.desiredSpan).toBe(first?.desiredSpan);
		canvas.scrollTop = 40;
		spacer.style.blockSize = "80px";
		surfaceRect.mockReturnValue(rect(0, 165));
		expect(() =>
			reconcilePreviewWindowSpacerFlow(repository, surface, spacer, flowEpoch),
		).toThrow("preview-window-flow-boundary-verification-failed");
		canvas.remove();
	});
});
