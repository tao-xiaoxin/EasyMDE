// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import { registerMathCloneRole } from "./wechat-clone-metadata";
import type { WechatMathVectorCapturedScene } from "./wechat-math-vector-capture";
import {
	bindWechatMathVectorScenes,
	createWechatMathVectorAtlasCache,
	createWechatMathVectorAtlasLoader,
	createWechatMathVectorAtlasLoaderIfConfigured,
	eligibleWechatMathVectorOwners,
	materializeWechatMathVectorScenes,
	WechatMathVectorAtlasError,
	type WechatMathVectorBoundPlan,
	type WechatMathVectorPortableCapture,
} from "./wechat-math-vector-portable";
import type { WechatMathVectorAtlas } from "./wechat-math-vector-scene";
import type { AcquiredPreviewGeometryMeasurement } from "./wechat-preview-geometry-cache";

const atlas = (): WechatMathVectorAtlas => ({
	fonts: [
		{
			cmap: [{ codepoint: 65, glyphId: 1 }],
			file: "KaTeX_Main-Regular.ttf",
			glyphs: [
				{ advanceWidth: 500, id: 1, outline: { pathData: "M0 0L1 0L1 1Z" } },
			],
			unitsPerEm: 1000,
		},
	],
	schema: "easymde-katex-glyph-atlas/1",
	serialization: {
		coordinateSystem: "font-units-y-up",
		decimalPlaces: 6,
		flipY: false,
		optimize: false,
	},
});

function style(values: Record<string, string> = {}): CSSStyleDeclaration {
	return {
		getPropertyValue: (property: string) => values[property] ?? "",
	} as CSSStyleDeclaration;
}

function runtime(
	overrides: Partial<BrowserWechatClipboardRuntime> = {},
): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: () => style({ display: "block" }),
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write: null,
		...overrides,
	};
}

function preview(markup: string): HTMLElement {
	const root = document.createElement("article");
	root.innerHTML = markup;
	document.body.append(root);
	return root;
}

function capturedScene(sourceOwner: Element): WechatMathVectorCapturedScene {
	return {
		allocation: {
			baselineHeight: null,
			edges: {
				borderBottom: 0,
				borderLeft: 0,
				borderRight: 0,
				borderTop: 0,
				marginLeft: 0,
				marginRight: 0,
				paddingBottom: 0,
				paddingLeft: 0,
				paddingRight: 0,
				paddingTop: 0,
			},
			geometry: {
				height: 40,
				inlineLayout: null,
				inlineOverflow: null,
				originX: 0,
				originY: 0,
				preservesInlineConstraints: false,
				requiresBaseline: false,
				typography: [],
				width: 100,
			},
			ownerRect: { height: 40, width: 100, x: 0, y: 0 },
			visualRect: { height: 40, width: 100, x: 0, y: 0 },
		},
		replacementShell: sourceOwner,
		scene: {
			rulePaint: [],
			runs: [
				{
					baselineY: 20,
					fill: "#111111",
					fontFile: "KaTeX_Main-Regular.ttf",
					fontSize: 10,
					glyphs: [{ codepoint: 65, x: 0 }],
				},
			],
			svgFragments: [],
			viewport: {
				height: 40,
				viewBox: { height: 40, width: 100, x: 0, y: 0 },
				width: 100,
			},
		},
		sourceOwner,
	};
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("eligibleWechatMathVectorOwners", () => {
	it.each(["inline-block", "inline-flex"])(
		"admits %s math owners",
		(display) => {
			const root = preview(
				'<span class="easymde-math-block"><span class="katex">A</span></span>',
			);
			const owner = root.querySelector(".easymde-math-block");
			if (!owner) throw new Error("owner missing");
			const owners = eligibleWechatMathVectorOwners(
				root,
				runtime({
					getComputedStyle: () => style({ display }),
				}),
			);
			expect(owners).toEqual([owner]);
		},
	);

	it("keeps true inline math portable and does not allocate an atlas capture", () => {
		const root = preview(
			'<span class="easymde-math-block"><span class="katex">A</span></span>',
		);
		expect(
			eligibleWechatMathVectorOwners(
				root,
				runtime({
					getComputedStyle: () => style({ display: "inline" }),
				}),
			),
		).toEqual([]);
	});

	it("returns no eligible owner for a PNG-only visual root", () => {
		const root = preview('<div class="easymde-mermaid"><svg></svg></div>');
		const owners = eligibleWechatMathVectorOwners(root, runtime());
		expect(owners).toEqual([]);
	});

	it("excludes nested math allocations and keeps the outermost owner", () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="easymde-math-inline">A</span></span></div>',
		);
		const owners = eligibleWechatMathVectorOwners(
			root,
			runtime({
				getComputedStyle: () => style({ display: "inline-block" }),
			}),
		);
		expect(owners).toHaveLength(1);
		expect(owners[0]).toBe(root.firstElementChild);
	});

	it("requires a neutral authored block shell before adding a block owner", () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex">A</span></div>',
		);
		const owner = root.firstElementChild;
		if (!(owner instanceof HTMLElement)) throw new Error("owner missing");
		registerMathCloneRole(
			owner,
			owner.cloneNode(true) as Element,
			style({ display: "block" }),
			() => style({ display: "block" }),
			"block",
		);
		owner.style.width = "100px";
		expect(eligibleWechatMathVectorOwners(root, runtime())).toEqual([]);
		owner.style.removeProperty("width");
		expect(eligibleWechatMathVectorOwners(root, runtime())).toEqual([owner]);
	});
});

describe("createWechatMathVectorAtlasLoader", () => {
	const url = new URL(
		"/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef",
		document.baseURI,
	).href;
	const version = "0123456789abcdef";

	function response(
		body: unknown,
		overrides: Partial<Response> = {},
	): Response {
		const bytes =
			typeof body === "string"
				? new TextEncoder().encode(body)
				: new TextEncoder().encode(JSON.stringify(body));
		return {
			arrayBuffer: async () => bytes.buffer,
			headers: new Headers(),
			ok: true,
			...overrides,
		} as Response;
	}

	it("activates only when both optional atlas fields are omitted", async () => {
		expect(
			createWechatMathVectorAtlasLoaderIfConfigured(
				runtime(),
				createWechatMathVectorAtlasCache(),
			),
		).toBeUndefined();
		expect(
			createWechatMathVectorAtlasLoaderIfConfigured(
				runtime({ wechatMathAtlasContentVersion: version }),
				createWechatMathVectorAtlasCache(),
			),
		).toEqual(expect.any(Function));
		expect(
			createWechatMathVectorAtlasLoaderIfConfigured(
				runtime({ wechatMathAtlasUrl: url }),
				createWechatMathVectorAtlasCache(),
			),
		).toEqual(expect.any(Function));
	});

	it("caches only a validated exact URL/version result and returns one frozen graph", async () => {
		const fetch = vi.fn(async () => response(atlas()));
		const cache = createWechatMathVectorAtlasCache();
		const load = createWechatMathVectorAtlasLoader(
			runtime({
				fetch,
				wechatMathAtlasContentVersion: version,
				wechatMathAtlasUrl: url,
			}),
			cache,
		);
		const first = await load();
		const second = await load();
		expect(fetch).toHaveBeenCalledOnce();
		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.fonts[0])).toBe(true);
	});

	it("does not let a failed or wrong-version response poison the cache", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response(atlas(), { ok: false, status: 503 }))
			.mockResolvedValueOnce(response({ ...atlas(), schema: "wrong" }))
			.mockResolvedValueOnce(response(atlas()));
		const cache = createWechatMathVectorAtlasCache();
		const load = createWechatMathVectorAtlasLoader(
			runtime({
				fetch,
				wechatMathAtlasContentVersion: version,
				wechatMathAtlasUrl: url,
			}),
			cache,
		);
		await expect(load()).rejects.toMatchObject({
			code: "atlas-response-invalid",
		});
		expect(cache.atlas).toBeNull();
		await expect(load()).rejects.toMatchObject({ code: "atlas-invalid" });
		expect(cache.atlas).toBeNull();
		await expect(load()).resolves.toMatchObject({ schema: atlas().schema });
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("refetches when the exact content version changes", async () => {
		const fetch = vi.fn(async () => response(atlas()));
		const cache = createWechatMathVectorAtlasCache();
		const first = createWechatMathVectorAtlasLoader(
			runtime({
				fetch,
				wechatMathAtlasContentVersion: version,
				wechatMathAtlasUrl: url,
			}),
			cache,
		);
		await first();
		const second = createWechatMathVectorAtlasLoader(
			runtime({
				fetch,
				wechatMathAtlasContentVersion: "fedcba9876543210",
				wechatMathAtlasUrl: new URL(
					"/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=fedcba9876543210",
					document.baseURI,
				).href,
			}),
			cache,
		);
		await second();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("rejects aborted and stale work before caching", async () => {
		const controller = new AbortController();
		const fetch = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					controller.signal.addEventListener(
						"abort",
						() => resolve(response(atlas())),
						{ once: true },
					);
				}),
		);
		const cache = createWechatMathVectorAtlasCache();
		const load = createWechatMathVectorAtlasLoader(
			runtime({
				fetch,
				wechatMathAtlasContentVersion: version,
				wechatMathAtlasUrl: url,
			}),
			cache,
		);
		const promise = load(controller.signal);
		controller.abort();
		await expect(promise).rejects.toThrow("wechat-copy-cancelled");
		expect(cache.atlas).toBeNull();
		await expect(load(undefined, () => false)).rejects.toThrow(
			"wechat-copy-cancelled",
		);
		expect(cache.atlas).toBeNull();
	});

	it("validates URL, version, fetch, byte length, and graph schema explicitly", async () => {
		await expect(
			createWechatMathVectorAtlasLoader(
				runtime(),
				createWechatMathVectorAtlasCache(),
			)(),
		).rejects.toMatchObject({ code: "atlas-url-invalid" });
		await expect(
			createWechatMathVectorAtlasLoader(
				runtime({
					wechatMathAtlasUrl: url,
				}),
				createWechatMathVectorAtlasCache(),
			)(),
		).rejects.toMatchObject({ code: "atlas-version-missing" });
		await expect(
			createWechatMathVectorAtlasLoader(
				runtime({
					wechatMathAtlasContentVersion: version,
					wechatMathAtlasUrl: "https://cdn.example.test/atlas.json",
				}),
				createWechatMathVectorAtlasCache(),
			)(),
		).rejects.toMatchObject({ code: "atlas-url-invalid" });
		await expect(
			createWechatMathVectorAtlasLoader(
				runtime({
					wechatMathAtlasContentVersion: version,
					wechatMathAtlasUrl: url,
				}),
				createWechatMathVectorAtlasCache(),
			)(),
		).rejects.toBeInstanceOf(WechatMathVectorAtlasError);
	});
});

describe("bindWechatMathVectorScenes", () => {
	function bindingFixture() {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex">A</span></div>',
		);
		const source = root.querySelector(".easymde-math-block");
		if (!source) throw new Error("source missing");
		const measurementRoot = root.cloneNode(true) as HTMLElement;
		const measurement = measurementRoot.querySelector(".easymde-math-block");
		if (!measurement) throw new Error("measurement missing");
		const cloneRoot = root.cloneNode(true) as HTMLElement;
		const clone = cloneRoot.querySelector(".easymde-math-block");
		if (!clone) throw new Error("clone missing");
		const lease = {
			measurementFor: (candidate: Element) =>
				candidate === source ? measurement : null,
			sourceFor: (candidate: Element) =>
				candidate === measurement ? source : null,
		};
		return {
			clone,
			cloneRoot,
			lease,
			measurement,
			measurementRoot,
			root,
			source,
		};
	}

	it("binds source -> measurement -> clone identities and excludes exactly those measurement owners", () => {
		const fixture = bindingFixture();
		const capture: WechatMathVectorPortableCapture = {
			atlas: atlas(),
			measurement: {
				cleanup: vi.fn(),
				lease: fixture.lease,
			} as unknown as AcquiredPreviewGeometryMeasurement,
			scenes: [capturedScene(fixture.source)],
		};
		const plan = bindWechatMathVectorScenes(
			fixture.root,
			fixture.cloneRoot,
			{ lease: fixture.lease },
			new Map([[fixture.measurement, fixture.clone]]),
			capture,
		);
		expect(plan.entries).toHaveLength(1);
		expect(plan.entries[0]?.sourceOwner).toBe(fixture.source);
		expect(plan.entries[0]?.scene.sourceOwner).toBe(fixture.source);
		expect(plan.entries[0]?.cloneOwner).toBe(fixture.clone);
		expect(plan.measurementOwners).toEqual(new Set([fixture.measurement]));
		expect(plan.sourceOwners).toEqual(new Set([fixture.source]));
	});

	it("rejects a captured shell that is not its source identity", () => {
		const fixture = bindingFixture();
		const capture: WechatMathVectorPortableCapture = {
			atlas: atlas(),
			measurement: {
				cleanup: vi.fn(),
				lease: fixture.lease,
			} as unknown as AcquiredPreviewGeometryMeasurement,
			scenes: [
				{
					...capturedScene(fixture.source),
					replacementShell: fixture.root,
				},
			],
		};
		expect(() =>
			bindWechatMathVectorScenes(
				fixture.root,
				fixture.cloneRoot,
				{ lease: fixture.lease },
				new Map([[fixture.measurement, fixture.clone]]),
				capture,
			),
		).toThrow("wechat-math-vector-source-identity-invalid");
	});
});

describe("materializeWechatMathVectorScenes", () => {
	function materializationFixture(): {
		clone: Element;
		finalized: HTMLElement;
		plan: WechatMathVectorBoundPlan;
		source: Element;
	} {
		const finalized = preview(
			'<div class="easymde-math-block"><span class="katex">A</span></div>',
		);
		const source = finalized.firstElementChild;
		if (!source) throw new Error("source missing");
		const clone = source;
		const plan: WechatMathVectorBoundPlan = {
			atlas: atlas(),
			entries: [
				{
					cloneOwner: clone,
					scene: capturedScene(source),
					sourceOwner: source,
				},
			],
			measurementOwners: new Set([source]),
			sourceOwners: new Set([source]),
		};
		return { clone, finalized, plan, source };
	}

	it("materializes a detached final SVG scene with one canonical text owner", async () => {
		const fixture = materializationFixture();
		materializeWechatMathVectorScenes(
			fixture.finalized,
			fixture.plan,
			document,
		);
		const carrier = fixture.clone.firstElementChild;
		const svg = carrier?.firstElementChild;
		expect(carrier?.hasAttribute("data-easymde-wechat-math-vector-carrier")).toBe(
			true,
		);
		expect(svg?.localName).toBe("svg");
		expect(fixture.clone.getAttribute("style")).not.toContain(
			"position:relative!important",
		);
	});

	it("creates the block carrier as a section with a preserved static SVG", () => {
		const fixture = materializationFixture();
		const target = fixture.clone as HTMLElement;
		const entry = fixture.plan.entries[0];
		if (!entry) throw new Error("materialization-entry-missing");
		target.style.cssText = [
			"display:block",
			"padding:2px 3px 4px 5px",
			"border-top:1px solid",
			"background-color:rgb(1, 2, 3)",
		].join(";");
		const originalCreateElement = document.createElement.bind(document);
		const created: string[] = [];
		const createElement = vi
			.spyOn(document, "createElement")
			.mockImplementation((localName: string) => {
				created.push(localName);
				return originalCreateElement(localName);
			});
		try {
			materializeWechatMathVectorScenes(
				fixture.finalized,
				{
					...fixture.plan,
					entries: [
						{
							...entry,
							scene: {
								...entry.scene,
								allocation: {
									...entry.scene.allocation,
									edges: {
										borderBottom: 0,
										borderLeft: 0,
										borderRight: 0,
										borderTop: 1,
										marginLeft: 0,
										marginRight: 0,
										paddingBottom: 4,
										paddingLeft: 5,
										paddingRight: 3,
										paddingTop: 2,
									},
									ownerRect: { height: 52, width: 120, x: 0, y: 0 },
									visualRect: { height: 40, width: 100, x: 8, y: 4 },
								},
								scene: {
									...entry.scene.scene,
									viewport: {
										height: 40,
										viewBox: { height: 40, width: 100, x: 8, y: 4 },
										width: 100,
									},
								},
							},
						},
					],
				},
				document,
			);
		} finally {
			createElement.mockRestore();
		}
		const carrier = target.firstElementChild;
		const scene = carrier?.firstElementChild;
		if (!(carrier instanceof HTMLElement) || !(scene instanceof SVGSVGElement))
			throw new Error("section-carrier-missing");
		expect(created).toContain("section");
		expect(created).not.toContain("div");
		expect(carrier.localName).toBe("section");
		expect(carrier.getAttribute("data-easymde-wechat-math-vector-carrier")).toBe(
			"",
		);
		expect(carrier.getAttribute("data-ignore-width")).toBe("");
		expect(carrier.style.width).toBe("100px");
		expect(carrier.style.marginLeft).toBe("auto");
		expect(carrier.style.marginRight).toBe("auto");
		expect(carrier.style.paddingTop).toBe("1px");
		expect(carrier.style.paddingBottom).toBe("4px");
		expect(carrier.style.boxSizing).toBe("content-box");
		expect(scene.style.position).toBe("static");
		expect(scene.style.left).toBe("auto");
		expect(scene.style.top).toBe("auto");
		expect(scene.getAttribute("viewBox")).toBe("8 4 100 40");
		expect(target.style.width).toBe("100%");
		expect(target.style.overflowX).toBe("auto");
		expect(target.style.paddingTop).toBe("2px");
		expect(target.style.borderTopWidth).toBe("1px");
		expect(target.style.backgroundColor).toBe("rgb(1, 2, 3)");
		expect(target.firstElementChild).toBe(carrier);
	});

	it("materializes a true-inline viewport only when its overflow layout requires one", () => {
		const fixture = materializationFixture();
		const entry = fixture.plan.entries[0];
		if (!entry) throw new Error("materialization-entry-missing");
		materializeWechatMathVectorScenes(
			fixture.finalized,
			{
				...fixture.plan,
				entries: [
					{
						...entry,
						scene: {
							...entry.scene,
							allocation: {
								...entry.scene.allocation,
								geometry: {
									...entry.scene.allocation.geometry,
									inlineLayout: {
										baseline: 20,
										height: 40,
										overflowX: "hidden",
										overflowY: "hidden",
										paintOffsetX: 2,
										paintOffsetY: 3,
										viewport: { height: 30, offsetX: 1, offsetY: 2, width: 80 },
										width: 100,
									},
								},
							},
						},
					},
				],
			},
			document,
		);
		const viewport = fixture.clone.parentElement;
		expect(viewport?.localName).toBe("span");
		expect(viewport?.firstElementChild).toBe(fixture.clone);
		expect(fixture.clone.firstElementChild?.localName).toBe("svg");
	});

	it.each(
		["inline-block", "inline-flex"].flatMap((display) =>
			["content-box", "border-box"].flatMap((boxSizing) =>
				[
					{
						marginBottom: 3,
						marginTop: 2,
						overflow: "visible" as const,
					},
					{ marginBottom: -3, marginTop: -4, overflow: "hidden" as const },
				].map((allocation) => ({ ...allocation, boxSizing, display })),
			),
		),
	)(
		"allocates $display $boxSizing geometry once for $overflow overflow",
		({ boxSizing, display, marginBottom, marginTop, overflow }) => {
			const fixture = materializationFixture();
			const entry = fixture.plan.entries[0];
			if (!entry) throw new Error("materialization-entry-missing");
			const target = fixture.clone as HTMLElement;
			target.style.cssText = [
				`display:${display}`,
				`box-sizing:${boxSizing}`,
				`margin:${marginTop}px 5px ${marginBottom}px 4px`,
				"padding:6px 7px",
				"border-style:solid",
				"border-color:rgb(1, 2, 3)",
				"border-right-width:2px",
				"border-bottom-width:2px",
				"border-left-width:3px",
				"border-top-width:4px",
				"background-color:rgb(4, 5, 6)",
				"min-width:200px",
				"min-height:90px",
				"max-width:10px",
				"max-height:10px",
				`overflow-x:${overflow}`,
				`overflow-y:${overflow}`,
			].join(";");
			const allocationHeight = 40 + marginTop + marginBottom;
			const baseline = marginTop + 30;
			materializeWechatMathVectorScenes(
				fixture.finalized,
				{
					...fixture.plan,
					entries: [
						{
							...entry,
							scene: {
								...entry.scene,
								allocation: {
									...entry.scene.allocation,
									baselineHeight: baseline - allocationHeight,
									edges: {
										borderBottom: 2,
										borderLeft: 3,
										borderRight: 2,
										borderTop: 4,
										marginLeft: 4,
										marginRight: 5,
										paddingBottom: 6,
										paddingLeft: 7,
										paddingRight: 7,
										paddingTop: 6,
									},
									geometry: {
										...entry.scene.allocation.geometry,
										inlineLayout: {
											baseline,
											height: allocationHeight,
											overflowX: overflow,
											overflowY: overflow,
											paintOffsetX: 8,
											paintOffsetY: marginTop + 9,
											viewport: {
												height: 40,
												offsetX: 0,
												offsetY: marginTop,
												width: 100,
											},
											width: 100,
										},
									},
									visualRect: {
										height: 22,
										width: 84,
										x: 8,
										y: 9,
									},
								},
							},
						},
					],
				},
				document,
			);

			const wrapper = target.parentElement;
			if (!(wrapper instanceof HTMLElement))
				throw new Error("allocation-wrapper-missing");
			expect(wrapper.localName).toBe("span");
			expect(wrapper.style.display).toBe("inline-block");
			expect(wrapper.style.position).toBe("relative");
			expect(wrapper.style.width).toBe("100px");
			expect(wrapper.style.height).toBe(`${allocationHeight}px`);
			expect(wrapper.style.boxSizing).toBe("border-box");
			expect(wrapper.style.minWidth).toBe("0px");
			expect(wrapper.style.minHeight).toBe("0px");
			expect(wrapper.style.maxWidth).toBe("none");
			expect(wrapper.style.maxHeight).toBe("none");
			expect(wrapper.style.marginTop).toBe("0px");
			expect(wrapper.style.marginRight).toBe("5px");
			expect(wrapper.style.marginBottom).toBe("0px");
			expect(wrapper.style.marginLeft).toBe("4px");
			expect(wrapper.style.paddingTop).toBe("0px");
			expect(wrapper.style.paddingRight).toBe("0px");
			expect(wrapper.style.paddingBottom).toBe("0px");
			expect(wrapper.style.paddingLeft).toBe("0px");
			expect(wrapper.style.borderTopWidth).toBe("0px");
			expect(wrapper.style.borderRightWidth).toBe("0px");
			expect(wrapper.style.borderBottomWidth).toBe("0px");
			expect(wrapper.style.borderLeftWidth).toBe("0px");
			expect(wrapper.style.overflowX).toBe("visible");
			expect(wrapper.style.overflowY).toBe("visible");
			expect(wrapper.style.verticalAlign).toBe(
				`${baseline - allocationHeight}px`,
			);

			expect(target.style.position).toBe("absolute");
			expect(target.style.left).toBe("0px");
			expect(target.style.top).toBe(`${marginTop}px`);
			expect(target.style.width).toBe("100px");
			expect(target.style.height).toBe("40px");
			expect(target.style.boxSizing).toBe("border-box");
			expect(target.style.minWidth).toBe("0px");
			expect(target.style.minHeight).toBe("0px");
			expect(target.style.maxWidth).toBe("none");
			expect(target.style.maxHeight).toBe("none");
			expect(target.style.marginTop).toBe("0px");
			expect(target.style.marginRight).toBe("0px");
			expect(target.style.marginBottom).toBe("0px");
			expect(target.style.marginLeft).toBe("0px");
			expect(target.style.paddingTop).toBe("6px");
			expect(target.style.paddingRight).toBe("7px");
			expect(target.style.paddingBottom).toBe("6px");
			expect(target.style.paddingLeft).toBe("7px");
			expect(target.style.borderTopWidth).toBe("4px");
			expect(target.style.borderRightWidth).toBe("2px");
			expect(target.style.borderBottomWidth).toBe("2px");
			expect(target.style.borderLeftWidth).toBe("3px");
			expect(target.style.backgroundColor).toBe("rgb(4, 5, 6)");

			if (overflow !== "visible") {
				expect(target.style.overflowX).toBe("hidden");
				expect(target.style.overflowY).toBe("hidden");
			}
			const scene = target.firstElementChild;
			if (!(scene instanceof SVGSVGElement))
				throw new Error("materialized-scene-missing");
			expect(scene.style.left).toBe("5px");
			expect(scene.style.top).toBe("5px");
			expect(wrapper.children).toHaveLength(1);
			expect(wrapper.firstElementChild).toBe(target);
			expect(target.children).toHaveLength(1);
			expect(
				wrapper.querySelectorAll('[style*="background-color"]'),
			).toHaveLength(1);
			expect(wrapper.querySelectorAll('[style*="padding:"]')).toHaveLength(1);
			expect(wrapper.querySelectorAll('[style*="border"]')).toHaveLength(1);
		},
	);

	it("splits inline and clipped overflow into one allocation wrapper with border-adjusted paint", () => {
		const fixture = materializationFixture();
		const entry = fixture.plan.entries[0];
		if (!entry) throw new Error("materialization-entry-missing");
		const target = fixture.clone as HTMLElement;
		target.style.cssText = [
			"display:inline-flex",
			"box-sizing:content-box",
			"margin:5px 8px 6px 7px",
			"padding:4px 5px",
			"border-style:solid",
			"border-width:6px 2px 3px 4px",
			"background-color:rgb(10, 11, 12)",
		].join(";");
		materializeWechatMathVectorScenes(
			fixture.finalized,
			{
				...fixture.plan,
				entries: [
					{
						...entry,
						scene: {
							...entry.scene,
							allocation: {
								...entry.scene.allocation,
								edges: {
									borderBottom: 3,
									borderLeft: 4,
									borderRight: 2,
									borderTop: 6,
									marginLeft: 7,
									marginRight: 8,
									paddingBottom: 4,
									paddingLeft: 5,
									paddingRight: 5,
									paddingTop: 4,
								},
								geometry: {
									...entry.scene.allocation.geometry,
									inlineLayout: {
										baseline: 45,
										height: 51,
										overflowX: "hidden",
										overflowY: "visible",
										paintOffsetX: 11,
										paintOffsetY: 17,
										viewport: {
											height: 40,
											offsetX: 2,
											offsetY: 5,
											width: 100,
										},
										width: 100,
									},
								},
							},
						},
					},
				],
			},
			document,
		);
		const wrapper = target.parentElement;
		const scene = target.firstElementChild;
		if (!(wrapper instanceof HTMLElement) || !(scene instanceof SVGSVGElement))
			throw new Error("inline-viewport-missing");
		expect(wrapper.style.height).toBe("51px");
		expect(wrapper.style.padding).toBe("0px");
		expect(wrapper.style.marginLeft).toBe("7px");
		expect(wrapper.style.marginRight).toBe("8px");
		expect(target.style.left).toBe("2px");
		expect(target.style.top).toBe("5px");
		expect(target.style.overflowX).toBe("hidden");
		expect(target.style.overflowY).toBe("visible");
		expect(target.style.borderLeftWidth).toBe("4px");
		expect(target.style.borderTopWidth).toBe("6px");
		expect(scene.style.left).toBe("5px");
		expect(scene.style.top).toBe("6px");
	});

	it.each(["content-box", "border-box"])(
		"keeps the responsive decorated owner with %s source sizing",
		(boxSizing) => {
			const fixture = materializationFixture();
			const target = fixture.clone as HTMLElement;
			target.style.cssText = [
				"display:block",
				`box-sizing:${boxSizing}`,
				"inline-size:100%",
				"max-inline-size:100%",
				"padding:6px 7px",
				"border:2px solid rgb(1, 2, 3)",
				"background-color:rgb(4, 5, 6)",
			].join(";");
			materializeWechatMathVectorScenes(
				fixture.finalized,
				fixture.plan,
				document,
			);
			expect(target.style.boxSizing).toBe("border-box");
			expect(target.style.width).toBe("100%");
			expect(target.style.maxWidth).toBe("100%");
			expect(target.style.height).toBe("auto");
			expect(target.style.overflowX).toBe("auto");
			expect(target.style.overflowY).toBe("hidden");
			expect(target.style.paddingTop).toBe("6px");
			expect(target.style.paddingRight).toBe("7px");
			expect(target.style.paddingBottom).toBe("6px");
			expect(target.style.paddingLeft).toBe("7px");
			expect(target.style.borderTopWidth).toBe("2px");
			expect(target.style.backgroundColor).toBe("rgb(4, 5, 6)");
		},
	);

	it("uses a normal-flow intrinsic carrier for a short nonzero-origin scene", () => {
		const fixture = materializationFixture();
		const target = fixture.clone as HTMLElement;
		const entry = fixture.plan.entries[0];
		if (!entry) throw new Error("materialization-entry-missing");
		materializeWechatMathVectorScenes(
			fixture.finalized,
			{
				...fixture.plan,
				entries: [
					{
						...entry,
						scene: {
							...entry.scene,
							allocation: {
								...entry.scene.allocation,
								ownerRect: { height: 50, width: 100, x: 0, y: 0 },
								visualRect: { height: 40, width: 100, x: 12.5, y: 4 },
								geometry: {
									...entry.scene.allocation.geometry,
									originX: 12.5,
									originY: 4,
								},
							},
							scene: {
								...entry.scene.scene,
								viewport: {
									height: 40,
									viewBox: { height: 40, width: 100, x: 12.5, y: 4 },
									width: 100,
								},
							},
						},
					},
				],
			},
			document,
		);
		const carrier = target.firstElementChild;
		const scene = carrier?.firstElementChild;
		if (!(carrier instanceof HTMLElement) || !(scene instanceof SVGSVGElement))
			throw new Error("normal-flow-carrier-missing");
		expect(carrier.style.width).toBe("100px");
		expect(carrier.style.marginLeft).toBe("auto");
		expect(carrier.style.marginRight).toBe("auto");
		expect(scene.style.position).toBe("static");
		expect(scene.style.left).toBe("auto");
		expect(scene.style.top).toBe("auto");
		expect(scene.getAttribute("viewBox")).toBe("12.5 4 100 40");
	});

	it("preserves asymmetric edges and vertical spaces once", () => {
		const fixture = materializationFixture();
		const target = fixture.clone as HTMLElement;
		const entry = fixture.plan.entries[0];
		if (!entry) throw new Error("materialization-entry-missing");
		target.style.cssText = [
			"display:block",
			"box-sizing:border-box",
			"padding:6px 7px 8px 9px",
			"border-style:solid",
			"border-width:3px 2px 5px 7px",
			"background-color:rgb(4, 5, 6)",
		].join(";");
		materializeWechatMathVectorScenes(
			fixture.finalized,
			{
				...fixture.plan,
				entries: [
					{
						...entry,
						scene: {
							...entry.scene,
							allocation: {
								...entry.scene.allocation,
								edges: {
									borderBottom: 5,
									borderLeft: 7,
									borderRight: 2,
									borderTop: 3,
									marginLeft: 0,
									marginRight: 0,
									paddingBottom: 8,
									paddingLeft: 9,
									paddingRight: 7,
									paddingTop: 6,
								},
								ownerRect: { height: 70, width: 125, x: 0, y: 0 },
								visualRect: { height: 40, width: 100, x: 16, y: 12 },
							},
						},
					},
				],
			},
			document,
		);
		const carrier = target.firstElementChild;
		const scene = carrier?.firstElementChild;
		if (!(carrier instanceof HTMLElement) || !(scene instanceof SVGSVGElement))
			throw new Error("carrier-missing");
		// contentHeight=70-3-5-6-8=48; leading=12-3-6=3;
		// trailing=48-3-40=5.
		expect(carrier.style.height).toBe("auto");
		expect(carrier.style.marginTop).toBe("0px");
		expect(carrier.style.marginBottom).toBe("0px");
		expect(carrier.style.paddingTop).toBe("3px");
		expect(carrier.style.paddingBottom).toBe("5px");
		expect(carrier.style.boxSizing).toBe("content-box");
		expect(scene.style.position).toBe("static");
		expect(scene.style.left).toBe("auto");
		expect(scene.style.top).toBe("auto");
		expect(target.style.paddingTop).toBe("6px");
		expect(target.style.paddingLeft).toBe("9px");
		expect(target.style.borderLeftWidth).toBe("7px");
		expect(target.style.backgroundColor).toBe("rgb(4, 5, 6)");
	});

	it("rejects materially negative vertical allocation before changing the target", () => {
		const fixture = materializationFixture();
		const target = fixture.clone as HTMLElement;
		const entry = fixture.plan.entries[0];
		if (!entry) throw new Error("materialization-entry-missing");
		target.setAttribute("style", "display:block");
		const before = fixture.finalized.innerHTML;
		expect(() =>
			materializeWechatMathVectorScenes(
				fixture.finalized,
				{
					...fixture.plan,
					entries: [
						{
							...entry,
							scene: {
								...entry.scene,
								allocation: {
									...entry.scene.allocation,
									visualRect: { height: 41, width: 100, x: 0, y: 0 },
								},
							},
						},
					],
				},
				document,
			),
		).toThrow("wechat-math-vector-block-allocation-invalid");
		expect(fixture.finalized.innerHTML).toBe(before);
	});

	it("keeps canonical math plaintext when scene materialization replaces the visible nodes", () => {
		const finalized = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html">A + B</span></span></div>',
		);
		const source = finalized.firstElementChild;
		if (!source) throw new Error("source missing");
		const sourceOwner = source;
		const entry = {
			cloneOwner: source,
			scene: capturedScene(sourceOwner),
			sourceOwner,
		};
		const canonicalText = { value: null as string | null };
		const textBeforeReplacement = finalized.textContent;
		canonicalText.value = textBeforeReplacement;
		materializeWechatMathVectorScenes(
			finalized,
			{
				atlas: atlas(),
				entries: [entry],
				measurementOwners: new Set([source]),
				sourceOwners: new Set([source]),
			},
			document,
		);
		expect(finalized.textContent).toBe("");
		expect(canonicalText.value).toBe("A + B");
	});

	it("restores every changed target and removes the carrier when a later block installation fails", () => {
		const finalized = preview(
			'<div class="math-a"><span class="katex"><span class="katex-html">A</span></span></div><div class="math-b"><span class="katex"><span class="katex-html">B</span></span></div>',
		);
		const first = finalized.children[0];
		const second = finalized.children[1];
		if (!first || !second) throw new Error("materialization-target-missing");
		first.setAttribute("style", "color:red");
		second.setAttribute("style", "color:blue");
		const before = finalized.innerHTML;
		const originalCreateElement = document.createElement.bind(document);
		let carrierCreations = 0;
		const observation: {
			carrier: HTMLElement | null;
			targetWasWrapped: boolean;
		} = { carrier: null, targetWasWrapped: false };
		const createElement = vi
			.spyOn(document, "createElement")
			.mockImplementation((localName: string) => {
				if (localName === "section" && ++carrierCreations === 2) {
					observation.carrier = first.querySelector<HTMLElement>(
						"[data-easymde-wechat-math-vector-carrier]",
					);
					observation.targetWasWrapped =
						observation.carrier?.parentElement === first;
					throw new Error(
						"wechat-math-vector-test-second-block-install-failed",
					);
				}
				return originalCreateElement(localName);
			});
		try {
			expect(() =>
				materializeWechatMathVectorScenes(
					finalized,
					{
						atlas: atlas(),
						entries: [
							{
								cloneOwner: first,
								scene: capturedScene(first),
								sourceOwner: first,
							},
							{
								cloneOwner: second,
								scene: capturedScene(second),
								sourceOwner: second,
							},
						],
						measurementOwners: new Set([first, second]),
						sourceOwners: new Set([first, second]),
					},
					document,
				),
			).toThrow("wechat-math-vector-test-second-block-install-failed");
		} finally {
			createElement.mockRestore();
		}
		if (!observation.carrier) throw new Error("first-carrier-not-observed");
		expect(carrierCreations).toBe(2);
		expect(observation.targetWasWrapped).toBe(true);
		expect(observation.carrier.isConnected).toBe(false);
		expect(finalized.innerHTML).toBe(before);
		expect(
			finalized.querySelectorAll("[data-easymde-wechat-math-vector-carrier]"),
		).toHaveLength(0);
		expect(finalized.children[0]).toBe(first);
		expect(finalized.children[1]).toBe(second);
	});

	it("restores every target and removes the wrapper when a later inline installation fails", () => {
		const finalized = preview(
			'<div class="math-a"><span class="katex"><span class="katex-html">A</span></span></div><div class="math-b"><span class="katex"><span class="katex-html">B</span></span></div>',
		);
		const first = finalized.children[0];
		const second = finalized.children[1];
		if (!first || !second) throw new Error("materialization-target-missing");
		first.setAttribute("style", "color:red");
		second.setAttribute("style", "color:blue");
		const inlineScene = capturedScene(first);
		const inlineLayout = {
			baseline: 20,
			height: 45,
			overflowX: "visible" as const,
			overflowY: "visible" as const,
			paintOffsetX: 0,
			paintOffsetY: 2,
			viewport: { height: 40, offsetX: 0, offsetY: 2, width: 100 },
			width: 100,
		};
		const before = finalized.innerHTML;
		const originalCreateElement = document.createElement.bind(document);
		let wrapperCreations = 0;
		const observation: {
			targetWasWrapped: boolean;
			wrapper: HTMLElement | null;
		} = { targetWasWrapped: false, wrapper: null };
		const createElement = vi
			.spyOn(document, "createElement")
			.mockImplementation((localName: string) => {
				if (localName === "span" && ++wrapperCreations === 2) {
					observation.wrapper =
						first.parentElement instanceof HTMLElement
							? first.parentElement
							: null;
					observation.targetWasWrapped =
						observation.wrapper?.firstElementChild === first;
					throw new Error(
						"wechat-math-vector-test-second-inline-install-failed",
					);
				}
				return originalCreateElement(localName);
			});
		try {
			expect(() =>
				materializeWechatMathVectorScenes(
					finalized,
					{
						atlas: atlas(),
						entries: [
							{
								cloneOwner: first,
								scene: {
									...inlineScene,
									allocation: {
										...inlineScene.allocation,
										geometry: {
											...inlineScene.allocation.geometry,
											inlineLayout,
										},
									},
								},
								sourceOwner: first,
							},
							{
								cloneOwner: second,
								scene: {
									...capturedScene(second),
									allocation: {
										...capturedScene(second).allocation,
										geometry: {
											...capturedScene(second).allocation.geometry,
											inlineLayout,
										},
									},
								},
								sourceOwner: second,
							},
						],
						measurementOwners: new Set([first, second]),
						sourceOwners: new Set([first, second]),
					},
					document,
				),
			).toThrow("wechat-math-vector-test-second-inline-install-failed");
		} finally {
			createElement.mockRestore();
		}
		if (!observation.wrapper) throw new Error("first-wrapper-not-observed");
		expect(wrapperCreations).toBe(2);
		expect(observation.targetWasWrapped).toBe(true);
		expect(observation.wrapper.isConnected).toBe(false);
		expect(observation.wrapper.children).toHaveLength(0);
		expect(finalized.innerHTML).toBe(before);
		expect(finalized.children[0]).toBe(first);
		expect(finalized.children[1]).toBe(second);
	});

	it("rejects a final root missing the bound target before changing any node", () => {
		const fixture = materializationFixture();
		const detached = document.createElement("article");
		expect(() =>
			materializeWechatMathVectorScenes(detached, fixture.plan, document),
		).toThrow("wechat-math-vector-final-target-missing");
	});
});
