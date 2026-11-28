import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
	fullCapabilityImage,
	fullCapabilityMarkdown,
	login,
	openEasyMdeNewPost,
	registerEditorWorkflowHooks,
	seedMarkdownAndWaitForPreview,
	startWordPressSessionKeepalive,
	waitForBrowserPaint,
} from "./helpers/editor-e2e-helpers.mjs";
import { selectOrdinaryOption } from "./helpers/ordinary-select.mjs";

const reportRoot = resolve(process.cwd(), "test-results/theme-layout-audit");
const auditPhase = process.env.EASYMDE_THEME_AUDIT_PHASE || "initial";
const captureScreenshots = process.env.EASYMDE_THEME_AUDIT_SCREENSHOTS === "1";
const hasIsolatedWordPressCli = Boolean(process.env.EASYMDE_E2E_WP_PATH);
const screenshotViewport = { width: 1440, height: 960 };
const narrowViewport = { width: 760, height: 900 };
const tolerance = 1.5;
const typoraCodePaletteRoles = [
	"text",
	"muted",
	"keyword",
	"string",
	"number",
	"blue",
	"link",
	"variable",
	"operator",
];
const typoraCodeRoleProbes = [
	{ className: null, role: "text" },
	{ className: "hljs-comment", role: "muted" },
	{ className: "hljs-keyword", role: "keyword" },
	{ className: "hljs-string", role: "string" },
	{ className: "hljs-number", role: "number" },
	{ className: "hljs-title", role: "blue" },
	{ className: "hljs-link", role: "link" },
	{ className: "hljs-variable", role: "variable" },
	{ className: "hljs-operator", role: "operator" },
];
const approvedSharedCodeFrameGeometry = {
	code: {
		borderRadius: "0px 0px 7px 7px",
		boxSizing: "border-box",
		display: "block",
		fontFamily:
			'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
		fontSize: "14px",
		fontWeight: "400",
		letterSpacing: "normal",
		lineHeight: "23.8px",
		maxWidth: "100%",
		margin: "0px",
		overflowX: "auto",
		overflowY: "hidden",
		padding: "16px",
		scrollbarWidth: "none",
		whiteSpace: "pre",
		wordBreak: "normal",
		wordSpacing: "0px",
	},
	dots: {
		backgroundColor: "rgb(255, 95, 86)",
		borderRadius: "50%",
		boxShadow:
			"rgb(255, 189, 46) 20px 0px 0px 0px, rgb(39, 201, 63) 40px 0px 0px 0px",
		height: "12px",
		left: "14px",
		position: "absolute",
		top: "13px",
		width: "12px",
	},
	frame: {
		borderRadius: "7px",
		boxShadow: "rgba(0, 0, 0, 0.35) 0px 2px 10px 0px",
		boxSizing: "border-box",
		margin: "16px 0px",
		maxWidth: "100%",
		overflowX: "auto",
		overflowY: "hidden",
		padding: "34px 0px 0px",
		position: "relative",
		scrollbarWidth: "none",
		wordBreak: "normal",
	},
};
const fullCapabilityImageSource =
	"https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png";
const expectedMermaidCount =
	fullCapabilityMarkdown.match(/^```mermaid$/gmu)?.length ?? 0;
if (expectedMermaidCount <= 0) {
	throw new Error("full-capability-mermaid-fixture-empty");
}
const canonicalMermaidRoles = [
	"flowchart-v2",
	"sequence",
	"pie",
	"gantt",
	"classDiagram",
	"stateDiagram",
	"er",
	"mindmap",
	"timeline",
	"xychart",
];

if (hasIsolatedWordPressCli) {
	registerEditorWorkflowHooks();
}

function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} must be set in the root .env or process environment.`,
		);
	}
	return value;
}

function safeName(value) {
	return value.replaceAll(/[^a-z0-9-]+/giu, "-").replaceAll(/^-+|-+$/gu, "");
}

async function waitForPreviewIdle(preview) {
	await expect(preview).toHaveAttribute("aria-busy", "false");
	await expect(preview).not.toHaveAttribute("data-easymde-preview-error", "1");
}

async function waitForFullCapabilityPreview(preview) {
	await waitForPreviewIdle(preview);
	await expect(preview.locator(".easymde-mermaid svg")).toHaveCount(
		expectedMermaidCount,
	);
	await expect(preview.locator(".easymde-mermaid svg").first()).toBeVisible();
}

async function chooseTheme(page, theme) {
	const labels = await page.evaluate(() => ({
		editorSettings:
			window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
		articleTheme:
			window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
	}));
	const trigger = page
		.locator(".easymde-toolbar-section-secondary")
		.getByRole("button", {
			name: labels.editorSettings,
			exact: true,
		});
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: labels.editorSettings });
	const select = dialog.getByRole("combobox", {
		name: labels.articleTheme,
		exact: true,
	});
	await selectOrdinaryOption(page, select, theme.label);
	await expect(page.locator('.easymde-pane-preview article[data-easymde-preview-html-sink="1"]')).toHaveClass(
		new RegExp(`easymde-markdown-theme-${theme.id}`),
	);
	await waitForStylesheet(
		page.locator("#easymde-article-theme-css"),
		theme.cssUrl,
		theme.id,
	);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
}

async function chooseCodeTheme(page, theme) {
	const labels = await page.evaluate(() => ({
		editorSettings:
			window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
		codeTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.codeTheme,
	}));
	const trigger = page
		.locator(".easymde-toolbar-section-secondary")
		.getByRole("button", {
			name: labels.editorSettings,
			exact: true,
		});
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: labels.editorSettings });
	const select = dialog.getByRole("combobox", {
		name: labels.codeTheme,
		exact: true,
	});
	await selectOrdinaryOption(page, select, theme.label);
	await expect(page.locator('.easymde-pane-preview article[data-easymde-preview-html-sink="1"]')).toHaveClass(
		new RegExp(`easymde-code-theme-${theme.id}`),
	);
	await waitForStylesheet(
		page.locator("#easymde-highlight-theme-css"),
		theme.cssUrl,
		theme.id,
	);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
}

async function waitForStylesheet(link, expectedUrl, label) {
	await expect
		.poll(
			() =>
				link.evaluate(
					(element, url) =>
						element instanceof HTMLLinkElement &&
						element.href === url &&
						element.sheet?.href === url,
					expectedUrl,
				),
			{
				message: `${label} stylesheet should finish loading`,
			},
		)
		.toBe(true);
}

async function setMode(page, mode, labels) {
	const editor = page.locator('[data-easymde-editor-owner="react"]');
	if ("ordinary" === mode) {
		const immersive = page.getByRole("region", {
			name: labels.immersive,
			exact: true,
		});
		if (await immersive.count()) {
			await page
				.getByRole("button", { name: labels.exit, exact: true })
				.click();
			await expect(immersive).toHaveCount(0);
		}
		return;
	}

	if (
		!(await editor.evaluate((element) =>
			element.classList.contains("is-immersive"),
		))
	) {
		await page.getByRole("button", { name: labels.enter, exact: true }).click();
		await expect(editor).toHaveClass(/is-immersive/);
	}
	const buttonName = "split" === mode ? labels.splitMode : labels.previewMode;
	await page.getByRole("button", { name: buttonName, exact: true }).click();
	await expect(editor).toHaveClass(
		new RegExp(`is-immersive-${"split" === mode ? "split" : "preview"}`),
	);
}

async function scrollToMermaid(page, mode, index) {
	await page.locator('.easymde-pane-preview article[data-easymde-preview-html-sink="1"]').evaluate(
		(root, args) => {
			const svg = root.querySelectorAll(".easymde-mermaid svg")[args.index];
			if (!(svg instanceof SVGElement))
				throw new Error("audit-mermaid-svg-unavailable");
			const owner = root.closest(".easymde-immersive-preview-canvas");
			if (!(owner instanceof HTMLElement))
				throw new Error("audit-scroll-owner-unavailable");
			const ownerBox = owner.getBoundingClientRect();
			const svgBox = svg.getBoundingClientRect();
			owner.scrollTop += svgBox.top - ownerBox.top - 24;
		},
		{ mode, index },
	);
}

async function scrollToCodeBlock(page) {
	await page.locator('.easymde-pane-preview article[data-easymde-preview-html-sink="1"]').evaluate((root) => {
		const codeBlocks = Array.from(root.querySelectorAll("pre code.hljs"));
		const code = codeBlocks.sort(
			(first, second) =>
				second.scrollWidth -
				second.clientWidth -
				(first.scrollWidth - first.clientWidth),
		)[0];
		if (!(code instanceof HTMLElement))
			throw new Error("audit-code-block-unavailable");
		const owner = root.closest(".easymde-immersive-preview-canvas");
		if (!(owner instanceof HTMLElement))
			throw new Error("audit-scroll-owner-unavailable");
		const ownerBox = owner.getBoundingClientRect();
		const codeBox = code.getBoundingClientRect();
		owner.scrollTop += codeBox.top - ownerBox.top - 24;
	});
}

function caseEvidence(root, { mode, expectedMermaidCount, expectedMermaidRoles }) {
	const geometryTolerance = 1.5;
	const intrinsicGeometryTolerance = 1 / 64;
	const near = (first, second) => Math.abs(first - second) <= geometryTolerance;
	const box = (element) => {
		const rect = element.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top,
			right: rect.right,
			bottom: rect.bottom,
			width: rect.width,
			height: rect.height,
		};
	};
	const style = (element) => {
		const computed = getComputedStyle(element);
		return {
			overflowX: computed.overflowX,
			overflowY: computed.overflowY,
			display: computed.display,
		};
	};
	const failure = (reason, selector, geometry = {}) => ({
		reason,
		selector,
		geometry,
	});
	const failures = [];
	const pane = root.closest(".easymde-pane-preview");
	const editor = root.closest('[data-easymde-editor-owner="react"]');
	const surface = root.closest(".easymde-immersive-preview-surface");
	const canvas = root.closest(".easymde-immersive-preview-canvas");
	const rootBox = box(root);
	const rootStyle = style(root);
	const pageWrappers = editor
		? editor.querySelectorAll(".easymde-immersive-preview-page").length
		: -1;
	const canvases = editor
		? editor.querySelectorAll(".easymde-immersive-preview-canvas").length
		: -1;
	const documentOverflow =
		document.documentElement.scrollWidth - document.documentElement.clientWidth;
	const paneOverflow =
		pane instanceof HTMLElement
			? pane.scrollWidth - pane.clientWidth
			: Number.NaN;
	const owner = canvas;

	if (!(pane instanceof HTMLElement))
		failures.push(failure("preview-pane-unavailable", "article"));
	if (!(owner instanceof HTMLElement))
		failures.push(failure("expected-scroll-owner-unavailable", "article"));
	if (documentOverflow > geometryTolerance)
		failures.push(
			failure("document-horizontal-overflow", "html", {
				overflow: documentOverflow,
			}),
		);
	if (paneOverflow > geometryTolerance)
		failures.push(
			failure("pane-horizontal-overflow", ".easymde-pane-preview", {
				overflow: paneOverflow,
			}),
		);
	if (root.scrollWidth - root.clientWidth > geometryTolerance)
		failures.push(
			failure("article-horizontal-overflow", "article", {
				scrollWidth: root.scrollWidth,
				clientWidth: root.clientWidth,
			}),
		);
	if (
		1 !== canvases ||
		0 !== pageWrappers ||
		!(canvas instanceof HTMLElement)
	) {
		failures.push(
			failure("preview-hierarchy-invalid", "article", {
				mode,
				canvases,
				pageWrappers,
			}),
		);
	}
	if (rootStyle.overflowY !== "visible") {
		failures.push(
			failure("article-must-not-scroll", "article", {
				mode,
				overflowY: rootStyle.overflowY,
			}),
		);
	}
	if (
		canvas instanceof HTMLElement &&
		!["auto", "scroll"].includes(style(canvas).overflowY)
	) {
		failures.push(
			failure("canvas-must-scroll", ".easymde-immersive-preview-canvas", {
				mode,
				...style(canvas),
			}),
		);
	}
	if (mode.startsWith("pure")) {
		if (
			!near(Number.parseFloat(getComputedStyle(root).borderTopLeftRadius), 48)
		)
			failures.push(
				failure("pure-article-radius-invalid", "article", {
					borderTopLeftRadius: getComputedStyle(root).borderTopLeftRadius,
				}),
			);
	}

	const verticalOwners = [];
	const verticalOwnerWalkStop =
		canvas instanceof HTMLElement ? canvas.parentElement : root.parentElement;
	for (
		let element = root;
		element instanceof HTMLElement && element !== verticalOwnerWalkStop;
		element = element.parentElement
	) {
		const computed = getComputedStyle(element);
		if (
			element.scrollHeight > element.clientHeight + geometryTolerance &&
			["auto", "scroll"].includes(computed.overflowY)
		) {
			verticalOwners.push({
				element,
				selector:
					element === root
						? "article"
						: element.className || element.tagName.toLowerCase(),
				box: box(element),
			});
		}
	}
	const ownerElement = owner instanceof HTMLElement ? owner : null;
	const unexpectedOwners = verticalOwners
		.filter(({ element }) => element !== ownerElement)
		.map(({ element: _element, ...evidence }) => evidence);
	const verticalOwnerEvidence = verticalOwners.map(
		({ element: _element, ...evidence }) => evidence,
	);
	if (unexpectedOwners.length) {
		failures.push(
			failure("unexpected-nested-vertical-scroll-owner", "article", {
				unexpectedOwners,
				verticalOwners: verticalOwnerEvidence,
			}),
		);
	}

	const keyElements = [
		["heading", "h1, h2, h3, h4, h5, h6"],
		["paragraph", "p"],
		["blockquote", "blockquote"],
		["list-item", "li"],
		[
			"task-item",
			'.task-list-item, .task-item, li:has(input[type="checkbox"])',
		],
		["table-cell", "th, td"],
		["code-block", "pre"],
		["formula", ".katex, .easymde-math-block"],
		["image", "img"],
	];
	for (const [kind, selector] of keyElements) {
		const element = root.querySelector(selector);
		if (!element) {
			failures.push(failure("fixture-element-missing", selector, { kind }));
			continue;
		}
		const rect = box(element);
		if (rect.width <= 0 || rect.height <= 0)
			failures.push(
				failure("non-positive-geometry", selector, { kind, ...rect }),
			);
		if (
			rect.left < rootBox.left - geometryTolerance ||
			rect.right > rootBox.right + geometryTolerance
		) {
			const localScroller = element.closest(
				"pre, .table-container, .easymde-table-container, .easymde-mermaid",
			);
			if (
				!localScroller ||
				localScroller.scrollWidth <=
					localScroller.clientWidth + geometryTolerance
			)
				failures.push(
					failure("element-outside-article-horizontal-boundary", selector, {
						kind,
						element: rect,
						article: rootBox,
					}),
				);
		}
	}

	const mermaids = Array.from(root.querySelectorAll(".easymde-mermaid svg"));
	if (!mermaids.length)
		failures.push(failure("mermaid-svg-missing", ".easymde-mermaid svg"));
	const mermaidRoles = mermaids.map((svg) => {
		const role = svg.getAttribute("aria-roledescription")?.trim();
		if (!role)
			failures.push(failure("mermaid-role-missing", "svg[aria-roledescription]"));
		return role ?? null;
	});
	if (
		Array.isArray(expectedMermaidRoles) &&
		JSON.stringify(mermaidRoles) !== JSON.stringify(expectedMermaidRoles)
	)
		failures.push(
			failure("mermaid-role-order-invalid", ".easymde-mermaid svg", {
				expected: expectedMermaidRoles,
				actual: mermaidRoles,
			}),
		);
	const completeCanonicalMermaidFixture =
		mermaids.length === expectedMermaidCount &&
		JSON.stringify(mermaidRoles) === JSON.stringify(expectedMermaidRoles);
	const intrinsicMermaidRoles = new Set(["gantt", "sequence", "timeline"]);
	const intrinsicMermaidOwnerEvidence = (svg, viewBoxParts, role) => {
		const owner = svg.parentElement;
		const ownerStyle = owner instanceof HTMLElement ? getComputedStyle(owner) : null;
		const ownerBox = owner instanceof HTMLElement ? box(owner) : null;
		const directSvgCount = owner instanceof HTMLElement
			? Array.from(owner.children).filter(
					(child) => child instanceof SVGSVGElement,
				).length
			: 0;
		const direct = owner instanceof HTMLElement && owner === svg.parentElement;
		const localHorizontalScroll =
			owner instanceof HTMLElement &&
			ownerStyle &&
			["auto", "scroll"].includes(ownerStyle.overflowX);
		const svgRect = svg.getBoundingClientRect();
		const sourceWidth = svgRect.width;
		const sourceHeight = svgRect.height;
		const screenCtm = svg.getScreenCTM?.() ?? null;
		const ctm = screenCtm && [
			screenCtm.a,
			screenCtm.b,
			screenCtm.c,
			screenCtm.d,
			screenCtm.e,
			screenCtm.f,
		].every(Number.isFinite)
			? {
				a: screenCtm.a,
				b: screenCtm.b,
				c: screenCtm.c,
				d: screenCtm.d,
				e: screenCtm.e,
				f: screenCtm.f,
			}
			: null;
		const expectedScale = Math.min(
			sourceWidth / viewBoxParts[2],
			sourceHeight / viewBoxParts[3],
		);
		const projectedDiagResidual = ctm && Number.isFinite(expectedScale)
			? {
				a: Math.abs(ctm.a - expectedScale) * viewBoxParts[2],
				d: Math.abs(ctm.d - expectedScale) * viewBoxParts[3],
			}
			: null;
		const intrinsicCtmComplete =
			ctm !== null &&
			Number.isFinite(expectedScale) &&
			expectedScale > 0 &&
			ctm.a > 0 &&
			ctm.d > 0 &&
			Math.abs(ctm.b) <= 1e-6 &&
			Math.abs(ctm.c) <= 1e-6 &&
			projectedDiagResidual !== null &&
			Number.isFinite(projectedDiagResidual.a) &&
			Number.isFinite(projectedDiagResidual.d) &&
			projectedDiagResidual.a <= intrinsicGeometryTolerance &&
			projectedDiagResidual.d <= intrinsicGeometryTolerance;
		let start = null;
		let end = null;
		let startScrollLeft = null;
		let endScrollLeft = null;
		let scrollRange = null;
		if (owner instanceof HTMLElement) {
			const originalScrollLeft = owner.scrollLeft;
			owner.scrollLeft = 0;
			startScrollLeft = owner.scrollLeft;
			start = box(svg);
			owner.scrollLeft = Math.max(0, owner.scrollWidth - owner.clientWidth);
			endScrollLeft = owner.scrollLeft;
			end = box(svg);
			scrollRange = Math.max(0, owner.scrollWidth - owner.clientWidth);
			owner.scrollLeft = originalScrollLeft;
		}
		const paddingLeft = ownerStyle
			? Number.parseFloat(ownerStyle.paddingLeft)
			: Number.NaN;
		const paddingRight = ownerStyle
			? Number.parseFloat(ownerStyle.paddingRight)
			: Number.NaN;
		const ownerContentLeft =
			ownerBox &&
			owner instanceof HTMLElement &&
			Number.isFinite(paddingLeft)
				? ownerBox.left + owner.clientLeft + paddingLeft
				: null;
		const ownerContentRight =
			ownerBox &&
			owner instanceof HTMLElement &&
			Number.isFinite(paddingRight)
				? ownerBox.left + owner.clientLeft + owner.clientWidth - paddingRight
				: null;
		const startLeadingEdgeOffset =
			start && ownerContentLeft !== null ? start.left - ownerContentLeft : null;
		const startTrailingEdgeOffset =
			start && ownerContentRight !== null ? start.right - ownerContentRight : null;
		const endLeadingEdgeOffset =
			end && ownerContentLeft !== null ? end.left - ownerContentLeft : null;
		const endTrailingEdgeOffset =
			end && ownerContentRight !== null ? end.right - ownerContentRight : null;
		const expectedScrollWidth =
			owner instanceof HTMLElement &&
			Number.isFinite(paddingLeft) &&
			Number.isFinite(paddingRight)
				? Math.max(owner.clientWidth, sourceWidth + paddingLeft + paddingRight)
				: Number.NaN;
		const complete =
			direct &&
			directSvgCount === 1 &&
			localHorizontalScroll &&
			owner instanceof HTMLElement &&
			ownerBox &&
			Number.isFinite(sourceWidth) &&
			Number.isFinite(sourceHeight) &&
			sourceWidth > 0 &&
			sourceHeight > 0 &&
			Math.abs(sourceWidth - viewBoxParts[2]) <= intrinsicGeometryTolerance &&
			Math.abs(sourceHeight - viewBoxParts[3]) <= intrinsicGeometryTolerance &&
			intrinsicCtmComplete &&
			Number.isFinite(owner.scrollWidth) &&
			Number.isFinite(expectedScrollWidth) &&
			Math.abs(owner.scrollWidth - expectedScrollWidth) <= geometryTolerance &&
			Number.isFinite(startLeadingEdgeOffset) &&
			Math.abs(startLeadingEdgeOffset) <= geometryTolerance &&
			Number.isFinite(startTrailingEdgeOffset) &&
			startTrailingEdgeOffset >= -geometryTolerance &&
			Number.isFinite(endLeadingEdgeOffset) &&
			endLeadingEdgeOffset <= geometryTolerance &&
			Number.isFinite(endTrailingEdgeOffset) &&
			Math.abs(endTrailingEdgeOffset) <= geometryTolerance &&
			Number.isFinite(startScrollLeft) &&
			Number.isFinite(endScrollLeft) &&
			Math.abs(startScrollLeft) <= geometryTolerance &&
			Math.abs(endScrollLeft - (scrollRange ?? 0)) <= geometryTolerance;
		return {
			complete,
			ctm,
			direct,
			directSvgCount,
			end,
			endScrollLeft,
			localHorizontalScroll,
			owner: owner instanceof HTMLElement ? box(owner) : null,
			ownerOverflowX: ownerStyle?.overflowX ?? null,
			ownerScrollRange: scrollRange,
			ownerScrollWidth: owner instanceof HTMLElement ? owner.scrollWidth : null,
			expectedScrollWidth,
			expectedScale,
			endLeadingEdgeOffset,
			endTrailingEdgeOffset,
			intrinsicCtmComplete,
			projectedDiagResidual,
			startLeadingEdgeOffset,
			startTrailingEdgeOffset,
			sourceHeight,
			sourceWidth,
			start,
			startScrollLeft,
			role,
			viewBox: { height: viewBoxParts[3], width: viewBoxParts[2] },
		};
	};
	const erLayoutEvidence = (svg) => {
		if (svg.getAttribute("aria-roledescription")?.trim() !== "er")
			return null;
		const erFailures = [];
		const attributes = Array.from(
			svg.querySelectorAll('text.entityLabel[id*="-attr-"]'),
		);
		if (!attributes.length)
			erFailures.push(
				failure("er-attribute-text-missing", "text.entityLabel"),
			);
		const attributeChecks = attributes.map((label, index) => {
			const previous = label.previousElementSibling;
			const cell =
				previous?.matches("rect.attributeBoxOdd, rect.attributeBoxEven")
					? previous
					: null;
			const labelBox = box(label);
			const cellBox = cell ? box(cell) : null;
			const outside =
				!cellBox ||
				labelBox.left < cellBox.left - geometryTolerance ||
				labelBox.right > cellBox.right + geometryTolerance ||
				labelBox.top < cellBox.top - geometryTolerance ||
				labelBox.bottom > cellBox.bottom + geometryTolerance;
			if (outside)
				erFailures.push(
					failure("er-attribute-text-outside-cell", "text.entityLabel", {
						index,
						label: labelBox,
						cell: cellBox,
					}),
				);
			return { index, label: labelBox, cell: cellBox, outside };
		});

		const relationshipLabels = Array.from(
			svg.querySelectorAll("text.relationshipLabel"),
		);
		const relationshipBackgrounds = Array.from(
			svg.querySelectorAll("rect.relationshipLabelBox"),
		);
		if (!relationshipLabels.length)
			erFailures.push(
				failure("er-relationship-label-missing", "text.relationshipLabel"),
			);
		if (relationshipLabels.length !== relationshipBackgrounds.length)
			erFailures.push(
				failure("er-relationship-background-count-mismatch", "text.relationshipLabel", {
					labels: relationshipLabels.length,
					backgrounds: relationshipBackgrounds.length,
				}),
			);
		const relationshipChecks = relationshipLabels.map((label, index) => {
			const previous = label.previousElementSibling;
			const background =
				previous?.matches("rect.relationshipLabelBox") ? previous : null;
			const labelBox = box(label);
			const backgroundBox = background ? box(background) : null;
			const outside =
				!backgroundBox ||
				labelBox.left < backgroundBox.left - geometryTolerance ||
				labelBox.right > backgroundBox.right + geometryTolerance ||
				labelBox.top < backgroundBox.top - geometryTolerance ||
				labelBox.bottom > backgroundBox.bottom + geometryTolerance;
			const sizeMismatch =
				backgroundBox !== null &&
				(Math.abs(labelBox.width - backgroundBox.width) > geometryTolerance ||
					Math.abs(labelBox.height - backgroundBox.height) > geometryTolerance);
			if (outside)
				erFailures.push(
					failure(
						"er-relationship-label-outside-background",
						"text.relationshipLabel",
						{
							index,
							label: labelBox,
							background: backgroundBox,
						},
					),
				);
			if (sizeMismatch)
				erFailures.push(
					failure(
						"er-relationship-label-background-size-mismatch",
						"text.relationshipLabel",
						{
							index,
							label: labelBox,
							background: backgroundBox,
						},
					),
				);
			return {
				index,
				label: labelBox,
				background: backgroundBox,
				sizeMismatch,
				outside,
			};
		});

		return {
			attributeCount: attributes.length,
			attributeChecks,
			relationshipCount: relationshipLabels.length,
			relationshipChecks,
			failures: erFailures,
		};
	};
	const mermaid = mermaids.map((svg, index) => {
		const role = mermaidRoles[index];
		const rect = box(svg);
		const viewBox = svg.getAttribute("viewBox") || "";
		const viewBoxParts = viewBox
			.trim()
			.split(/[\s,]+/u)
			.map(Number);
		const validViewBox =
			4 === viewBoxParts.length &&
			viewBoxParts.every(Number.isFinite) &&
			viewBoxParts[2] > 0 &&
			viewBoxParts[3] > 0;
		const labelProblems = Array.from(
			svg.querySelectorAll("foreignObject, .nodeLabel, .label, .messageText"),
		).map((label) => {
			const labelBox = box(label);
			const htmlChild = label.firstElementChild;
			return {
				selector: label.tagName.toLowerCase(),
				clipped:
					htmlChild instanceof HTMLElement &&
					(htmlChild.scrollWidth > htmlChild.clientWidth + geometryTolerance ||
						htmlChild.scrollHeight >
							htmlChild.clientHeight + geometryTolerance),
				outside:
					labelBox.left < rect.left - geometryTolerance ||
					labelBox.right > rect.right + geometryTolerance ||
					labelBox.top < rect.top - geometryTolerance ||
					labelBox.bottom > rect.bottom + geometryTolerance,
				box: labelBox,
			};
		});
		const contained =
			rect.left >= rootBox.left - geometryTolerance &&
			rect.right <= rootBox.right + geometryTolerance;
		const isIntrinsicMermaid =
			typeof role === "string" && intrinsicMermaidRoles.has(role) &&
			svg.parentElement?.matches(
				'.easymde-mermaid[data-easymde-mermaid-layout="' + role + '"]',
			) === true;
		const intrinsicOwner = isIntrinsicMermaid
			? intrinsicMermaidOwnerEvidence(svg, viewBoxParts, role)
			: null;
		const rootHasZeroHorizontalOverflow =
			root.scrollWidth - root.clientWidth <= geometryTolerance;
		const positive = rect.width > 0 && rect.height > 0;
		if (!positive)
			failures.push(
				failure(
					"mermaid-non-positive-geometry",
					`.easymde-mermaid svg:nth-of-type(${index + 1})`,
					rect,
				),
			);
		if (!validViewBox)
			failures.push(
				failure(
					"mermaid-invalid-viewbox",
					`.easymde-mermaid svg:nth-of-type(${index + 1})`,
					{ viewBox },
				),
			);
		if (
			typeof role === "string" &&
			intrinsicMermaidRoles.has(role) &&
			!intrinsicOwner?.complete
		)
			failures.push(
				failure(
					"intrinsic-mermaid-local-scroll-owner-invalid",
					'.easymde-mermaid[data-easymde-mermaid-layout="' + role + '"]',
					{ intrinsicOwner, role, rootHasZeroHorizontalOverflow },
				),
			);
		const allowedIntrinsicMermaidOverflow =
			isIntrinsicMermaid &&
			rootHasZeroHorizontalOverflow &&
			intrinsicOwner?.complete === true;
		if (!contained && !allowedIntrinsicMermaidOverflow)
			failures.push(
				failure(
					"mermaid-horizontal-overflow",
					`.easymde-mermaid svg:nth-of-type(${index + 1})`,
					{
						article: rootBox,
						intrinsicOwner,
						role,
						rootHasZeroHorizontalOverflow,
						svg: rect,
					},
				),
			);
		if (labelProblems.some((problem) => problem.clipped || problem.outside))
			failures.push(
				failure(
					"mermaid-label-clipped",
					`.easymde-mermaid svg:nth-of-type(${index + 1})`,
					{ labelProblems },
				),
				);
		const er = completeCanonicalMermaidFixture ? erLayoutEvidence(svg) : null;
		if (er?.failures.length)
			failures.push(...er.failures);
		return {
			index,
			role,
			rect,
			viewBox,
			validViewBox,
			contained,
			positive,
			labelProblems,
			intrinsicOwner,
			allowedIntrinsicMermaidOverflow,
			er,
		};
	});

	if (ownerElement) {
		ownerElement.scrollTop = ownerElement.scrollHeight;
		const finalElement = root.lastElementChild;
		const finalBox = finalElement ? box(finalElement) : null;
		const ownerBox = box(ownerElement);
		if (
			!finalBox ||
			finalBox.bottom > ownerBox.bottom + geometryTolerance ||
			finalBox.top < ownerBox.top - ownerBox.height - geometryTolerance
		) {
			failures.push(
				failure("article-bottom-unreachable", "article > :last-child", {
					finalBox,
					ownerBox,
					scrollTop: ownerElement.scrollTop,
					maxScrollTop: Math.max(
						0,
						ownerElement.scrollHeight - ownerElement.clientHeight,
					),
				}),
			);
		}
		ownerElement.scrollTop = 0;
	}

	return {
		mode,
		failures,
		root: {
			box: rootBox,
			scrollWidth: root.scrollWidth,
			clientWidth: root.clientWidth,
			scrollHeight: root.scrollHeight,
			clientHeight: root.clientHeight,
			style: rootStyle,
		},
		canvas:
			canvas instanceof HTMLElement
				? {
						box: box(canvas),
						scrollHeight: canvas.scrollHeight,
						clientHeight: canvas.clientHeight,
						style: style(canvas),
					}
				: null,
		surface:
			surface instanceof HTMLElement
				? { box: box(surface), style: style(surface) }
				: null,
		wrappers: { canvases, pageWrappers },
		documentOverflow,
		paneOverflow,
		verticalOwners: verticalOwnerEvidence,
		mermaid,
		mermaidRoles,
	};
}

function codeCaseEvidence(
	root,
	{ probes, roles, typoraDerived, approvedGeometry },
) {
	const failure = (reason, geometry = {}) => ({ reason, geometry });
	const failures = [];
	const codeBlocks = Array.from(root.querySelectorAll("pre code.hljs"));
	const code = codeBlocks.sort(
		(first, second) =>
			second.scrollWidth -
			second.clientWidth -
			(first.scrollWidth - first.clientWidth),
	)[0];
	if (
		!(code instanceof HTMLElement) ||
		!(code.parentElement instanceof HTMLElement)
	) {
		return { failures: [failure("highlighted-code-block-unavailable")] };
	}
	const frame = code.parentElement;
	const codeStyle = getComputedStyle(code);
	const frameStyle = getComputedStyle(frame);
	const dotsStyle = getComputedStyle(frame, "::before");
	const normalizeColor = (value) => {
		const probe = document.createElement("span");
		probe.style.color = value;
		if (!probe.style.color) throw new Error(`audit-color-invalid:${value}`);
		root.append(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return resolved;
	};
	const colorChannels = (value) => {
		const resolved = normalizeColor(value);
		const channels = resolved.match(/[\d.]+/gu)?.map(Number) ?? [];
		if (channels.length < 3)
			throw new Error(`audit-color-unparseable:${resolved}`);
		return channels.slice(0, 3);
	};
	const luminance = (channels) =>
		channels
			.map((channel) => channel / 255)
			.map((channel) =>
				channel <= 0.04045
					? channel / 12.92
					: ((channel + 0.055) / 1.055) ** 2.4,
			)
			.reduce(
				(sum, channel, index) =>
					sum + channel * [0.2126, 0.7152, 0.0722][index],
				0,
			);
	const contrast = (foreground, background) => {
		const first = luminance(colorChannels(foreground));
		const second = luminance(colorChannels(background));
		return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
	};
	const rootStyle = getComputedStyle(root);
	const palette = Object.fromEntries(
		["bg", ...roles].map((role) => [
			role,
			rootStyle.getPropertyValue(`--easymde-typora-code-${role}`).trim(),
		]),
	);
	const contrasts = typoraDerived
		? Object.fromEntries(
				roles.map((role) => [role, contrast(palette[role], palette.bg)]),
			)
		: {};
	if (typoraDerived) {
		const missingRoles = Object.entries(palette)
			.filter(([, value]) => "" === value)
			.map(([role]) => role);
		if (missingRoles.length)
			failures.push(failure("typora-palette-role-missing", { missingRoles }));
		const lowContrast = Object.entries(contrasts)
			.filter(([, ratio]) => ratio < 4.5 - 0.001)
			.map(([role, ratio]) => ({ role, ratio }));
		if (lowContrast.length)
			failures.push(failure("typora-palette-low-contrast", { lowContrast }));
		const finalColors = {};
		const probeElements = [];
		for (const { className, role } of probes) {
			const element = className ? document.createElement("span") : code;
			if (className) {
				element.className = className;
				element.textContent = role;
				code.append(element);
				probeElements.push(element);
			}
			finalColors[role] = getComputedStyle(element).color;
		}
		for (const element of probeElements) element.remove();
		const finalColorMismatches = probes
			.filter(({ role }) => finalColors[role] !== normalizeColor(palette[role]))
			.map(({ role }) => ({
				role,
				expected: normalizeColor(palette[role]),
				actual: finalColors[role],
			}));
		if (finalColorMismatches.length) {
			failures.push(
				failure("typora-final-token-color-changed", { finalColorMismatches }),
			);
		}
		if (codeStyle.backgroundColor !== normalizeColor(palette.bg)) {
			failures.push(
				failure("typora-final-code-background-changed", {
					expected: normalizeColor(palette.bg),
					actual: codeStyle.backgroundColor,
				}),
			);
		}
	}
	if (codeStyle.backgroundColor !== frameStyle.backgroundColor) {
		failures.push(
			failure("code-frame-background-mismatch", {
				code: codeStyle.backgroundColor,
				frame: frameStyle.backgroundColor,
			}),
		);
	}
	if ("rgba(0, 0, 0, 0)" === codeStyle.backgroundColor) {
		failures.push(failure("code-background-transparent"));
	}
	if (0 === root.querySelectorAll('[class*="hljs-"]').length) {
		failures.push(failure("highlight-token-output-missing"));
	}
	const geometry = {
		code: {
			borderRadius: codeStyle.borderRadius,
			boxSizing: codeStyle.boxSizing,
			display: codeStyle.display,
			fontFamily: codeStyle.fontFamily,
			fontSize: codeStyle.fontSize,
			fontWeight: codeStyle.fontWeight,
			letterSpacing: codeStyle.letterSpacing,
			lineHeight: codeStyle.lineHeight,
			margin: codeStyle.margin,
			maxWidth: codeStyle.maxWidth,
			overflowX: codeStyle.overflowX,
			overflowY: codeStyle.overflowY,
			padding: codeStyle.padding,
			scrollbarWidth: codeStyle.scrollbarWidth,
			whiteSpace: codeStyle.whiteSpace,
			wordBreak: codeStyle.wordBreak,
			wordSpacing: codeStyle.wordSpacing,
		},
		dots: {
			backgroundColor: dotsStyle.backgroundColor,
			borderRadius: dotsStyle.borderRadius,
			boxShadow: dotsStyle.boxShadow,
			height: dotsStyle.height,
			left: dotsStyle.left,
			position: dotsStyle.position,
			top: dotsStyle.top,
			width: dotsStyle.width,
		},
		frame: {
			borderRadius: frameStyle.borderRadius,
			boxShadow: frameStyle.boxShadow,
			boxSizing: frameStyle.boxSizing,
			margin: frameStyle.margin,
			maxWidth: frameStyle.maxWidth,
			overflowX: frameStyle.overflowX,
			overflowY: frameStyle.overflowY,
			padding: frameStyle.padding,
			position: frameStyle.position,
			scrollbarWidth: frameStyle.scrollbarWidth,
			wordBreak: frameStyle.wordBreak,
		},
	};
	const geometryMismatches = Object.entries(approvedGeometry).flatMap(
		([owner, properties]) =>
			Object.entries(properties)
				.filter(
					([property, expected]) => geometry[owner]?.[property] !== expected,
				)
				.map(([property, expected]) => ({
					owner,
					property,
					expected,
					actual: geometry[owner]?.[property] ?? null,
				})),
	);
	if (geometryMismatches.length) {
		failures.push(
			failure("shared-code-frame-contract-changed", { geometryMismatches }),
		);
	}
	return {
		failures,
		palette,
		contrasts,
		geometry,
	};
}

function printCaseEvidence(root, { phycat }) {
	const failure = (reason, geometry = {}) => ({ reason, geometry });
	const failures = [];
	const paragraph = root.querySelector("p");
	const firstHeading = root.querySelector("h1");
	const secondHeading = root.querySelector("h2");
	const listItem = root.querySelector("li");
	const table = root.querySelector("table");
	if (!matchMedia("print").matches)
		failures.push(failure("print-media-inactive"));
	if (
		!(paragraph instanceof HTMLElement) ||
		!(firstHeading instanceof HTMLElement)
	) {
		failures.push(failure("print-fixture-content-unavailable"));
		return { failures };
	}
	const rootStyle = getComputedStyle(root);
	if ("visible" !== rootStyle.overflowY) {
		failures.push(
			failure("print-article-vertical-overflow", {
				overflowY: rootStyle.overflowY,
			}),
		);
	}
	if (phycat) {
		const beforeContent = [firstHeading, secondHeading]
			.filter((heading) => heading instanceof HTMLElement)
			.map((heading) => getComputedStyle(heading, "::before").content);
		if (
			beforeContent.some(
				(content) => !["none", "normal", '""'].includes(content),
			)
		) {
			failures.push(
				failure("phycat-generated-heading-numbering", { beforeContent }),
			);
		}
		if ("24px" !== getComputedStyle(paragraph).lineHeight) {
			failures.push(
				failure("phycat-print-paragraph-rhythm", {
					lineHeight: getComputedStyle(paragraph).lineHeight,
				}),
			);
		}
		if (
			listItem instanceof HTMLElement &&
			"avoid" !== getComputedStyle(listItem).breakInside
		) {
			failures.push(
				failure("phycat-print-list-break", {
					breakInside: getComputedStyle(listItem).breakInside,
				}),
			);
		}
	} else {
		if ("32px" !== getComputedStyle(firstHeading).fontSize) {
			failures.push(
				failure("mdmdt-print-heading-size", {
					fontSize: getComputedStyle(firstHeading).fontSize,
				}),
			);
		}
		if (
			table instanceof HTMLElement &&
			"avoid" !== getComputedStyle(table).breakInside
		) {
			failures.push(
				failure("mdmdt-print-table-break", {
					breakInside: getComputedStyle(table).breakInside,
				}),
			);
		}
	}
	return {
		failures,
		root: {
			overflowY: rootStyle.overflowY,
			scrollHeight: root.scrollHeight,
			clientHeight: root.clientHeight,
		},
	};
}

test("audits all registered article themes in ordinary, immersive split, and pure preview", async ({
	page,
}, testInfo) => {
	test.setTimeout(60 * 60_000);
	expect(fullCapabilityMarkdown.length).toBe(9254);
	expect(new TextEncoder().encode(fullCapabilityMarkdown).byteLength).toBe(11959);
	expect(createHash("sha256").update(fullCapabilityMarkdown, "utf8").digest("hex")).toBe(
		"ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb",
	);
	mkdirSync(reportRoot, { recursive: true });
	const browserErrors = [];
	const reportPath = resolve(reportRoot, `${auditPhase}-report.json`);
	const report = {
		phase: auditPhase,
		screenshotsCaptured: captureScreenshots,
		completed: false,
		status: "running",
		themes: [],
		codeThemes: [],
		cases: [],
		codeCases: [],
		printCases: [],
		setupBrowserErrors: [],
		cleanupBrowserErrors: [],
		legacyImageRouteHits: 0,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	let browserErrorCursor = 0;
	const consumeBrowserErrors = () => {
		const errors = browserErrors.slice(browserErrorCursor);
		browserErrorCursor = browserErrors.length;
		return errors;
	};
	page.on("console", (message) => {
		if ("error" === message.type())
			browserErrors.push(`console:${message.text().slice(0, 300)}`);
	});
	page.on("pageerror", (error) =>
		browserErrors.push(`pageerror:${String(error.message).slice(0, 300)}`),
	);

	let originalImageRouteHits = 0;
	let legacyImageRouteHits = 0;
	let legacyImageRouteUrl = null;
	try {
		await page.setViewportSize(screenshotViewport);
		const user = hasIsolatedWordPressCli
			? testInfo.easymdeUser
			: {
					username: requiredEnvironment("WORDPRESS_ADMIN_USER"),
					password: requiredEnvironment("WORDPRESS_ADMIN_PASSWORD"),
				};
		await login(page, user);
		const sessionKeepalive = hasIsolatedWordPressCli
			? startWordPressSessionKeepalive(page, user)
			: null;
		if (sessionKeepalive) {
			testInfo.easymdeStopSessionKeepalive = sessionKeepalive.stop;
		}
		legacyImageRouteUrl = new URL(
			"/easymde-e2e-fixtures/markdown-full-capability-image.png",
			page.url(),
		).href;
		await page.route(legacyImageRouteUrl, async (route) => {
			legacyImageRouteHits += 1;
			await route.fulfill({
				status: 200,
				contentType: "image/png",
				body: fullCapabilityImage,
			});
		});
		await page.route(fullCapabilityImageSource, async (route) => {
			originalImageRouteHits += 1;
			await route.fulfill({
				status: 200,
				contentType: "image/png",
				body: fullCapabilityImage,
			});
		});
		await openEasyMdeNewPost(page);
		await expect(
			page.locator('[data-easymde-editor-owner="react"]'),
		).toBeVisible();
		const preview = page.locator('.easymde-pane-preview article[data-easymde-preview-html-sink="1"]');
		await waitForPreviewIdle(preview);
		const localCapabilityMarkdown = fullCapabilityMarkdown;
		await seedMarkdownAndWaitForPreview(page, localCapabilityMarkdown);
		await waitForFullCapabilityPreview(preview);
		const renderedMermaidRoles = await preview.locator(".easymde-mermaid svg").evaluateAll(
			(svgs) => svgs.map((svg) =>
				svg.getAttribute("aria-roledescription")?.trim() ?? null,
			),
		);
		expect(renderedMermaidRoles, "canonical Mermaid roles must come from renderer output").toEqual(
			canonicalMermaidRoles,
		);
		await expect
			.poll(
				() =>
					preview
						.locator("img")
						.evaluateAll(
							(images) =>
								images.length > 0 &&
								images.every(
									(image) =>
										image instanceof HTMLImageElement &&
										image.complete &&
										image.naturalWidth > 0 &&
										image.naturalHeight > 0,
								),
						),
				{
					message: "the local full-capability fixture images should load",
				},
			)
			.toBe(true);
		expect(originalImageRouteHits).toBeGreaterThan(0);
		const bootstrap = await page.evaluate(
			() => window.EasyMDEEditorRootBootstrap,
		);
		const themes = bootstrap.appearance.articleThemes.map(
			({ id, label, cssUrl }) => ({ id, label, cssUrl }),
		);
		const codeThemes = bootstrap.appearance.codeThemes.map(
			({ id, label, cssUrl }) => ({ id, label, cssUrl }),
		);
		expect(themes).toHaveLength(46);
		expect(codeThemes).toHaveLength(28);
		const adaptedThemes = themes.filter(
			({ id }) =>
				id.startsWith("bloom-") ||
				id.startsWith("phycat-") ||
				["dogschoice-pink", "mdmdt"].includes(id),
		);
		const printThemes = themes.filter(
			({ id }) => id.startsWith("phycat-") || "mdmdt" === id,
		);
		expect(adaptedThemes).toHaveLength(22);
		expect(printThemes).toHaveLength(9);
		const adaptedThemeIds = new Set(adaptedThemes.map(({ id }) => id));
		const printThemeIds = new Set(printThemes.map(({ id }) => id));
		const labels = bootstrap.strings.immersive;
		report.themes = themes;
		report.codeThemes = codeThemes;
		report.setupBrowserErrors = consumeBrowserErrors();

		for (const theme of themes) {
			await sessionKeepalive?.assertHealthy();
			for (const mode of ["ordinary", "split", "pure"]) {
				await setMode(page, mode, labels);
				if ("ordinary" === mode) {
					await chooseTheme(page, theme);
				}
				await waitForFullCapabilityPreview(preview);
				await expect(preview).toHaveClass(
					new RegExp(`easymde-markdown-theme-${theme.id}`),
				);
				const evidence = await preview.evaluate(caseEvidence, {
					mode,
					expectedMermaidCount,
					expectedMermaidRoles: canonicalMermaidRoles,
				});
				if (captureScreenshots) {
					const caseName = `${safeName(theme.id)}-${mode}`;
					const diagramIndex = mode === "ordinary" ? 0 : 1;
					await scrollToMermaid(page, mode, diagramIndex);
					await page.screenshot({
						path: resolve(reportRoot, `${auditPhase}-${caseName}.png`),
						fullPage: false,
					});
				}
				report.cases.push({
					theme: theme.id,
					mode,
					...evidence,
					browserErrors: consumeBrowserErrors(),
				});
				if ("ordinary" === mode && printThemeIds.has(theme.id)) {
					await page.emulateMedia({ media: "print" });
					try {
						const printEvidence = await preview.evaluate(printCaseEvidence, {
							phycat: theme.id.startsWith("phycat-"),
						});
						report.printCases.push({
							theme: theme.id,
							...printEvidence,
							browserErrors: consumeBrowserErrors(),
						});
					} finally {
						await page.emulateMedia({ media: "screen" });
					}
				}
			}

			if (adaptedThemeIds.has(theme.id)) {
				await page.setViewportSize(narrowViewport);
				try {
					await waitForBrowserPaint(page);
					await waitForFullCapabilityPreview(preview);
					await expect(preview).toHaveClass(
						new RegExp(`easymde-markdown-theme-${theme.id}`),
					);
					const narrowEvidence = await preview.evaluate(caseEvidence, {
						mode: "pure-narrow",
						expectedMermaidCount,
						expectedMermaidRoles: canonicalMermaidRoles,
					});
					if (captureScreenshots) {
						await scrollToMermaid(page, "pure-narrow", 0);
						await page.screenshot({
							path: resolve(
								reportRoot,
								`${auditPhase}-${safeName(theme.id)}-pure-narrow.png`,
							),
							fullPage: false,
						});
					}
					report.cases.push({
						theme: theme.id,
						mode: "pure-narrow",
						...narrowEvidence,
						browserErrors: consumeBrowserErrors(),
					});
				} finally {
					await page.setViewportSize(screenshotViewport);
				}
			}
		}

		await setMode(page, "ordinary", labels);
		const defaultTheme = themes.find(({ id }) => "default" === id);
		if (!defaultTheme)
			throw new Error("audit-default-article-theme-unavailable");
		await chooseTheme(page, defaultTheme);
		await waitForFullCapabilityPreview(preview);
		let sharedCodeGeometry = null;
		for (const theme of codeThemes) {
			await sessionKeepalive?.assertHealthy();
			await chooseCodeTheme(page, theme);
			const evidence = await preview.evaluate(codeCaseEvidence, {
				approvedGeometry: approvedSharedCodeFrameGeometry,
				probes: typoraCodeRoleProbes,
				roles: typoraCodePaletteRoles,
				typoraDerived: theme.cssUrl.includes("/typora-derived.css"),
			});
			if (null === sharedCodeGeometry) {
				sharedCodeGeometry = evidence.geometry;
			} else if (
				JSON.stringify(sharedCodeGeometry) !== JSON.stringify(evidence.geometry)
			) {
				evidence.failures.push({
					reason: "shared-code-frame-geometry-changed",
					geometry: { expected: sharedCodeGeometry, actual: evidence.geometry },
				});
			}
			if (captureScreenshots) {
				await scrollToCodeBlock(page);
				await page.screenshot({
					path: resolve(
						reportRoot,
						`${auditPhase}-code-${safeName(theme.id)}.png`,
					),
					fullPage: false,
				});
			}
			report.codeCases.push({
				theme: theme.id,
				...evidence,
				browserErrors: consumeBrowserErrors(),
			});
		}

		await sessionKeepalive?.assertHealthy();
		expect(report.cases).toHaveLength(themes.length * 3 + adaptedThemes.length);
		expect(report.codeCases).toHaveLength(codeThemes.length);
		expect(report.printCases).toHaveLength(printThemes.length);
		report.completed = true;
		} finally {
			try {
				if (legacyImageRouteUrl) await page.unroute(legacyImageRouteUrl);
				await page.unroute(fullCapabilityImageSource);
			} catch {
				report.cleanupBrowserErrors.push("cleanup:image-routes-failed");
			}
			try {
			if (!page.isClosed()) await page.emulateMedia({ media: "screen" });
		} catch {
			report.cleanupBrowserErrors.push("cleanup:emulate-media-screen-failed");
		}
			report.trailingBrowserErrors = consumeBrowserErrors();
			report.legacyImageRouteHits = legacyImageRouteHits;
		report.finishedAt = new Date().toISOString();
		report.caseCounts = {
			article: report.cases.length,
			code: report.codeCases.length,
			print: report.printCases.length,
		};
		report.caseCount = Object.values(report.caseCounts).reduce(
			(count, caseCount) => count + caseCount,
			0,
		);
		report.failureCount =
			report.setupBrowserErrors.length +
			report.cleanupBrowserErrors.length +
			report.trailingBrowserErrors.length +
			report.cases.reduce(
				(count, item) =>
					count + item.failures.length + item.browserErrors.length,
				0,
			) +
			report.codeCases.reduce(
				(count, item) =>
					count + item.failures.length + item.browserErrors.length,
				0,
			) +
			report.printCases.reduce(
				(count, item) =>
					count + item.failures.length + item.browserErrors.length,
				0,
			);
		report.status = report.completed
			? 0 === report.failureCount
				? "passed"
				: "failed"
			: "aborted";
		writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	}

	const failures = report.cases.flatMap((item) => [
		...item.failures.map(
			(failure) =>
				`${item.theme}/${item.mode}/${failure.reason}/${failure.selector}`,
		),
		...item.browserErrors.map((error) => `${item.theme}/${item.mode}/${error}`),
	]);
	failures.push(
		...report.codeCases.flatMap((item) => [
			...item.failures.map((failure) => `${item.theme}/code/${failure.reason}`),
			...item.browserErrors.map((error) => `${item.theme}/code/${error}`),
		]),
	);
	failures.push(
		...report.printCases.flatMap((item) => [
			...item.failures.map(
				(failure) => `${item.theme}/print/${failure.reason}`,
			),
			...item.browserErrors.map((error) => `${item.theme}/print/${error}`),
		]),
	);
	failures.unshift(
		...report.setupBrowserErrors.map((error) => `setup/${error}`),
	);
	failures.push(...report.cleanupBrowserErrors);
	failures.push(
		...report.trailingBrowserErrors.map((error) => `trailing/${error}`),
	);
	expect(failures, failures.join("\n")).toEqual([]);
});
