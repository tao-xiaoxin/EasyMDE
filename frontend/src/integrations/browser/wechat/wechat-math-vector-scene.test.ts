import { SVGPathData } from "svg-pathdata";
import { describe, expect, it, vi } from "vitest";

import {
	buildWechatMathVectorScenes,
	type WechatMathVectorAtlas,
	type WechatMathVectorFrozenScene,
	type WechatMathVectorFrozenSvgChild,
	type WechatMathVectorFrozenSvgFragment,
	type WechatMathVectorResolvedPaint,
} from "./wechat-math-vector-scene";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function atlas(
	overrides: Partial<WechatMathVectorAtlas> = {},
): WechatMathVectorAtlas {
	return {
		schema: "easymde-katex-glyph-atlas/1",
		serialization: {
			coordinateSystem: "font-units-y-up",
			decimalPlaces: 6,
			flipY: false,
			optimize: false,
		},
		fonts: [
			{
				file: "KaTeX_Main-Regular.ttf",
				unitsPerEm: 1000,
				cmap: [
					{ codepoint: 0, glyphId: 0 },
					{ codepoint: 65, glyphId: 1 },
				],
				glyphs: [
					{ id: 0, advanceWidth: 0, outline: { pathData: "" } },
					{
						id: 1,
						advanceWidth: 500,
						outline: {
							pathData:
								"M0.123456 0L500.654321 0L500.654321 700.123456L0.123456 700.123456Z",
						},
					},
				],
			},
		],
		...overrides,
	};
}

function scene(
	overrides: Partial<WechatMathVectorFrozenScene> = {},
): WechatMathVectorFrozenScene {
	return {
		viewport: {
			height: 40,
			viewBox: { height: 40, width: 100, x: 0, y: 0 },
			width: 100,
		},
		runs: [
			{
				baselineY: 20,
				fill: "#123456",
				fontFile: "KaTeX_Main-Regular.ttf",
				fontSize: 10,
				glyphs: [
					{ codepoint: 65, x: 10 },
					{ codepoint: 0, x: 20 },
				],
			},
		],
		rulePaint: [
			{ fill: "#000000", height: 1, opacity: 1, width: 30, x: 0, y: 19 },
		],
		svgFragments: [],
		...overrides,
	};
}

function paint(
	overrides: Partial<WechatMathVectorResolvedPaint> = {},
): WechatMathVectorResolvedPaint {
	return {
		fill: "none",
		opacity: 1,
		stroke: "none",
		strokeWidth: 0,
		...overrides,
	};
}

function fragmentWithChildren(
	children: readonly unknown[],
): WechatMathVectorFrozenSvgFragment {
	return {
		nestedClipViewportRects: [],
		children: children as readonly WechatMathVectorFrozenSvgChild[],
		relativeCtm: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	};
}

describe("buildWechatMathVectorScenes", () => {
	it("builds detached scenes from the actual atlas schema and uses a y-up baseline transform", () => {
		const beforeBody = document.body.innerHTML;
		const scenes = buildWechatMathVectorScenes(document, [scene()], atlas());

		expect(scenes).toHaveLength(1);
		expect(scenes[0]?.isConnected).toBe(false);
		expect(document.body.innerHTML).toBe(beforeBody);
		expect(scenes[0]?.namespaceURI).toBe(SVG_NAMESPACE);
		expect(scenes[0]?.getAttribute("viewBox")).toBe("0 0 100 40");
		expect(scenes[0]?.getAttribute("width")).toBe("100");
		expect(scenes[0]?.getAttribute("height")).toBe("40");
		expect(scenes[0]?.getAttribute("style")).toContain(
			"max-width:none!important",
		);

		const path = scenes[0]?.querySelector("path");
		expect(path?.getAttribute("d")).toBe(
			"M0.123456 0L500.654321 0L500.654321 700.123456L0.123456 700.123456Z",
		);
		expect(path?.getAttribute("transform")).toBe(
			"translate(10 20) scale(0.01 -0.01)",
		);
		expect(path?.getAttribute("fill")).toBe("#123456");
		expect(scenes[0]?.querySelectorAll("path")).toHaveLength(1);
		expect(scenes[0]?.querySelectorAll("rect")).toHaveLength(1);
	});

	it("round-trips large coordinates, tiny positive dimensions, and small nonzero CTM", () => {
		const tiny = 0.0000123456789;
		const large = 400000.123456789;
		const [result] = buildWechatMathVectorScenes(
			document,
			[
				scene({
					viewport: {
						height: tiny,
						viewBox: { height: tiny, width: large, x: -large, y: -tiny },
						width: large,
					},
					runs: [
						{
							baselineY: tiny,
							fill: "#123456",
							fontFile: "KaTeX_Main-Regular.ttf",
							fontSize: 10,
							glyphs: [{ codepoint: 65, x: tiny }],
						},
					],
					rulePaint: [
						{ fill: "#000000", height: tiny, width: tiny, x: large, y: -large },
					],
					svgFragments: [
						{
							children: [
								{
									kind: "path",
									paint: paint({ fill: "#abcdef" }),
									pathData: "M0 0L1 1",
								},
							],
							nestedClipViewportRects: [
								{
									height: tiny,
									transform: "none",
									unit: "userSpaceOnUse",
									width: tiny,
									x: tiny,
									y: -tiny,
								},
							],
							relativeCtm: { a: tiny, b: 0, c: 0, d: 1, e: large, f: -tiny },
						},
					],
				}),
			],
			atlas(),
		);

		expect(result?.getAttribute("width")).toBe(String(large));
		expect(result?.getAttribute("height")).toBe(String(tiny));
		expect(result?.querySelector("path[transform]")?.getAttribute("d")).toBe(
			"M0.123456 0L500.654321 0L500.654321 700.123456L0.123456 700.123456Z",
		);
		expect(
			result?.querySelector("path[transform]")?.getAttribute("transform"),
		).toBe(`translate(${String(tiny)} ${String(tiny)}) scale(0.01 -0.01)`);
		expect(result?.querySelector("rect")?.getAttribute("x")).toBe(
			String(large),
		);
		expect(result?.querySelector("g")?.getAttribute("transform")).toBe(
			`matrix(${String(tiny)} 0 0 1 ${String(large)} ${String(-tiny)})`,
		);
		expect(result?.querySelector("g svg")?.getAttribute("viewBox")).toBe(
			`${String(tiny)} ${String(-tiny)} ${String(tiny)} ${String(tiny)}`,
		);
	});

	it("validates a repeated glyph path once per batch and keeps output identity", () => {
		const parseSpy = vi.spyOn(SVGPathData, "parse");
		try {
			const scenes = buildWechatMathVectorScenes(
				document,
				[scene(), scene()],
				atlas(),
			);
			const paths = scenes.map((candidate) => candidate.querySelector("path"));

			expect(parseSpy).toHaveBeenCalledTimes(1);
			expect(paths[0]?.outerHTML).toBe(paths[1]?.outerHTML);
			expect(paths[0]?.getAttribute("d")).toBe(
				"M0.123456 0L500.654321 0L500.654321 700.123456L0.123456 700.123456Z",
			);
		} finally {
			parseSpy.mockRestore();
		}
	});

	it("preserves blank glyph advances without installing a blank path", () => {
		const [result] = buildWechatMathVectorScenes(
			document,
			[
				scene({
					runs: [
						{
							baselineY: 20,
							fill: "black",
							fontFile: "KaTeX_Main-Regular.ttf",
							fontSize: 10,
							glyphs: [{ codepoint: 0, x: 10 }],
						},
					],
				}),
			],
			atlas(),
		);

		expect(result?.querySelector("path")).toBeNull();
	});

	it("creates static KaTeX paint with precomputed local-basis clip and full CTM fidelity", () => {
		const [result] = buildWechatMathVectorScenes(
			document,
			[
				scene({
					svgFragments: [
						{
							nestedClipViewportRects: [
								{
									height: 5.25,
									transform: "none",
									unit: "userSpaceOnUse",
									width: 6.5,
									x: 1.125,
									y: -2.5,
								},
							],
							children: [
								{
									kind: "path",
									paint: paint({ fill: "#abcdef" }),
									pathData: "M0 0L5 0L5 5Z",
								},
								{
									kind: "line",
									paint: paint({
										fill: "none",
										opacity: 0.5,
										stroke: "#ff0000",
										strokeWidth: 2,
									}),
									x1: 0.25,
									x2: 4.75,
									y1: 1.5,
									y2: 3.25,
								},
							],
							relativeCtm: {
								a: 1.25,
								b: 0.125,
								c: -0.25,
								d: 0.75,
								e: 10.5,
								f: -2.25,
							},
						},
					],
				}),
			],
			atlas(),
		);

		const nestedViewport = result?.querySelector("g svg");
		const staticPath = result?.querySelector("g svg g path");
		const staticLine = result?.querySelector("g svg g line");
		expect(nestedViewport?.getAttribute("viewBox")).toBe("1.125 -2.5 6.5 5.25");
		expect(nestedViewport?.getAttribute("style")).toBe(
			"overflow:hidden!important;max-width:none!important",
		);
		expect(result?.querySelector("g")?.getAttribute("transform")).toBe(
			"matrix(1.25 0.125 -0.25 0.75 10.5 -2.25)",
		);
		expect(staticPath?.getAttribute("d")).toBe("M0 0L5 0L5 5Z");
		expect(staticPath?.getAttribute("fill")).toBe("#abcdef");
		expect(staticLine?.getAttribute("x1")).toBe("0.25");
		expect(staticLine?.getAttribute("y1")).toBe("1.5");
		expect(staticLine?.getAttribute("x2")).toBe("4.75");
		expect(staticLine?.getAttribute("y2")).toBe("3.25");
		expect(staticLine?.getAttribute("stroke")).toBe("#ff0000");
		expect(staticLine?.getAttribute("stroke-width")).toBe("2");
		expect(staticLine?.getAttribute("opacity")).toBe("0.5");
		expect(result?.querySelectorAll("[id]")).toHaveLength(0);
		expect(result?.querySelectorAll("text")).toHaveLength(0);
	});

	it("rejects active content, foreign namespaces, connected nodes, and unknown fields", () => {
		const runtimeNodes = [
			document.createElementNS(SVG_NAMESPACE, "script"),
			document.createElementNS(SVG_NAMESPACE, "style"),
			document.createElementNS(SVG_NAMESPACE, "foreignObject"),
			document.createElement("iframe"),
			document.createElementNS("http://www.w3.org/1999/xhtml", "div"),
		];
		for (const node of runtimeNodes) {
			expect(() =>
				buildWechatMathVectorScenes(
					document,
					[scene({ svgFragments: [fragmentWithChildren([node])] })],
					atlas(),
				),
			).toThrowError("wechat-math-vector-scene-fragment-invalid");
		}

		const connectedSvg = document.createElementNS(SVG_NAMESPACE, "svg");
		document.body.append(connectedSvg);
		try {
			expect(() =>
				buildWechatMathVectorScenes(
					document,
					[
						scene({
							svgFragments: [
								connectedSvg as unknown as WechatMathVectorFrozenSvgFragment,
							],
						}),
					],
					atlas(),
				),
			).toThrowError("wechat-math-vector-scene-fragment-invalid");
			expect(connectedSvg.isConnected).toBe(true);
		} finally {
			connectedSvg.remove();
		}

		const unknownChild = {
			kind: "path",
			paint: paint(),
			pathData: "M0 0L1 1",
			extra: "reject",
		};
		expect(() =>
			buildWechatMathVectorScenes(
				document,
				[scene({ svgFragments: [fragmentWithChildren([unknownChild])] })],
				atlas(),
			),
		).toThrowError("wechat-math-vector-scene-fragment-invalid");
	});

	it("rejects unresolved or escaped resolved paint", () => {
		for (const value of [
			"var(--color)",
			"currentColor",
			"context-fill",
			"url(#paint)",
			"\\31 23",
		]) {
			const child = {
				kind: "path",
				paint: paint({ fill: value }),
				pathData: "M0 0L1 1",
			};
			expect(() =>
				buildWechatMathVectorScenes(
					document,
					[scene({ svgFragments: [fragmentWithChildren([child])] })],
					atlas(),
				),
			).toThrowError("wechat-math-vector-scene-paint-invalid");
		}
	});

	it("rejects wrong clip metadata, singular CTM, and nonfinite CTM", () => {
		const child = {
			kind: "path",
			paint: paint({ fill: "#abcdef" }),
			pathData: "M0 0L1 1",
		};
		const base = fragmentWithChildren([child]);

		for (const clip of [
			{
				height: 1,
				transform: "none",
				unit: "objectBoundingBox",
				width: 1,
				x: 0,
				y: 0,
			},
			{
				height: 1,
				transform: "translate(1)",
				unit: "userSpaceOnUse",
				width: 1,
				x: 0,
				y: 0,
			},
		]) {
			const invalid = {
				...base,
				nestedClipViewportRects: [clip],
			} as unknown as WechatMathVectorFrozenSvgFragment;
			expect(() =>
				buildWechatMathVectorScenes(
					document,
					[scene({ svgFragments: [invalid] })],
					atlas(),
				),
			).toThrowError("wechat-math-vector-scene-clip-invalid");
		}

		for (const relativeCtm of [
			{ a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 },
			{ a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 },
		]) {
			const invalid = { ...base, relativeCtm };
			expect(() =>
				buildWechatMathVectorScenes(
					document,
					[scene({ svgFragments: [invalid] })],
					atlas(),
				),
			).toThrowError("wechat-math-vector-scene-matrix-invalid");
		}
	});

	it("rejects unknown glyphs, invalid paths, and malformed actual schema before returning any scene", () => {
		const baseRun = scene().runs[0];
		if (!baseRun) throw new Error("test fixture missing run");
		const baseFont = atlas().fonts[0];
		if (!baseFont) throw new Error("test fixture missing font");

		expect(() =>
			buildWechatMathVectorScenes(
				document,
				[
					scene({
						runs: [{ ...baseRun, glyphs: [{ codepoint: 66, x: 10 }] }],
					}),
				],
				atlas(),
			),
		).toThrowError("wechat-math-vector-scene-unknown-glyph");

		expect(() =>
			buildWechatMathVectorScenes(
				document,
				[scene()],
				atlas({
					fonts: [
						{
							...baseFont,
							glyphs: [
								{ id: 0, advanceWidth: 0, outline: { pathData: "" } },
								{
									id: 1,
									advanceWidth: 500,
									outline: { pathData: "M0 0LNaN 1" },
								},
							],
						},
					],
				}),
			),
		).toThrowError("wechat-math-vector-scene-glyph-path-invalid");

		const malformed = atlas({
			serialization: {
				coordinateSystem: "font-units-y-down",
				decimalPlaces: 6,
				flipY: false,
				optimize: false,
			},
		});
		expect(() =>
			buildWechatMathVectorScenes(document, [scene()], malformed),
		).toThrowError("wechat-math-vector-scene-atlas-schema-invalid");
	});

	it("does not install a partial batch when a later scene fails", () => {
		const valid = scene();
		const invalid = scene({
			viewport: {
				height: 0,
				viewBox: { height: 0, width: 100, x: 0, y: 0 },
				width: 100,
			},
		});
		const bodyBefore = document.body.innerHTML;

		expect(() =>
			buildWechatMathVectorScenes(document, [valid, invalid], atlas()),
		).toThrowError("wechat-math-vector-scene-viewport-invalid");
		expect(document.body.innerHTML).toBe(bodyBefore);
	});
});
