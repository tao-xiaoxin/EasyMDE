import { expect, test } from "@playwright/test";
import { selectOrdinaryOption } from "./helpers/ordinary-select.mjs";

const postUrl = "/wp-admin/post.php?post=5&action=edit";

function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} must be set in the root .env or process environment.`,
		);
	}
	return value;
}

async function login(page) {
	await page.goto("/wp-login.php");
	await page
		.locator("#user_login")
		.fill(requiredEnvironment("WORDPRESS_ADMIN_USER"));
	await page
		.locator("#user_pass")
		.fill(requiredEnvironment("WORDPRESS_ADMIN_PASSWORD"));
	await page.locator("#wp-submit").click();
	await expect(page.locator("#wpadminbar")).toBeVisible();
}

async function waitForPreviewIdle(preview) {
	await expect(preview).toHaveAttribute("aria-busy", "false");
	await expect(preview).not.toHaveAttribute("data-easymde-preview-error", "1");
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
	await expect(page.locator(".easymde-pane-preview article")).toHaveClass(
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

const PHY_CAT_TASK_THEME_IDS = Object.freeze([
	"phycat-cherry",
	"phycat-caramel",
	"phycat-forest",
	"phycat-mint",
	"phycat-sky",
	"phycat-prussian",
	"phycat-sakura",
	"phycat-mauve",
]);
const PHY_CAT_TASK_LAYOUT_WIDTHS = Object.freeze([320, 375, 430]);
// The canonical full-capability document remains the native acceptance fixture
// in theme-layout-audit.spec.mjs. This small task-only document adds tight/loose and nested
// paragraph shapes so this focused regression reaches the adapter owner paths.
const PHY_CAT_TASK_LAYOUT_MARKDOWN = [
	"# Phycat task layout regression",
	"",
	"- [ ] PHY-TIGHT-UNCHECKED This caption intentionally wraps across several lines at narrow widths so the marker must remain beside its first line without touching the text.",
	"- [x] PHY-TIGHT-CHECKED This caption intentionally wraps across several lines at narrow widths so the marker must remain beside its first line without touching the text.",
	"",
	"### Loose task items",
	"",
	"- [ ] PHY-LOOSE-UNCHECKED This caption intentionally wraps across several lines at narrow widths so the marker must remain beside its first line without touching the text.",
	"",
	"  PHY-NESTED-PARAGRAPH This ordinary paragraph belongs to the same list item and must keep normal positioning.",
	"",
	"- [x] PHY-LOOSE-CHECKED This caption intentionally wraps across several lines at narrow widths so the marker must remain beside its first line without touching the text.",
].join("\n");
const PHY_CAT_HOST_FORM_STYLES = Object.freeze({
	light: `
		input[type="checkbox"] {
			box-sizing: content-box;
			font-size: 14px;
			line-height: 1.5;
			margin: -4px 4px 0;
			padding: 6px;
			border: 1px solid rgb(140 143 148);
			background: rgb(255 255 255);
			box-shadow: inset 0 1px 2px rgb(0 0 0 / 20%);
			opacity: .55;
		}
	`,
	tinted: `
		input[type="checkbox"] {
			box-sizing: content-box;
			font-size: 14px;
			line-height: 1.5;
			margin: -4px 4px 0;
			padding: 9px;
			border: 2px solid rgb(55 90 130);
			background: rgb(220 235 250);
			box-shadow: 0 0 0 3px rgb(55 90 130 / 28%);
			opacity: .35;
		}
	`,
});

function readPhycatTaskLayoutEvidence(root) {
	const px = (value) => {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	};
	const rect = (element) => {
		const value = element.getBoundingClientRect();
		return {
			bottom: value.bottom,
			height: value.height,
			left: value.left,
			right: value.right,
			top: value.top,
			width: value.width,
		};
	};
	const textRects = (input, owner) => {
		const ranges = [];
		const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		while (node) {
			const text = node.textContent?.trim() ?? "";
			const followsInput = Boolean(
				input.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
			);
			const isDirectCaptionText = owner.tagName !== "LI"
				|| node.parentElement === owner;
			if (text && followsInput && isDirectCaptionText) {
				const range = document.createRange();
				range.selectNodeContents(node);
				for (const value of range.getClientRects()) {
					if (value.width > 0 && value.height > 0) {
						ranges.push({
						bottom: value.bottom,
						height: value.height,
						left: value.left,
						right: value.right,
						top: value.top,
						width: value.width,
					});
					}
				}
				range.detach();
			}
			node = walker.nextNode();
		}
		return ranges.sort((first, second) => first.top - second.top || first.left - second.left);
	};
	const markerRect = (input) => {
		const inputRect = rect(input);
		const before = getComputedStyle(input, "::before");
		const width = px(before.width);
		const height = px(before.height);
		const left = px(before.left);
		const top = px(before.top);
		if (![width, height, left, top].every(Number.isFinite)) return null;
		let scaleX = 1;
		let scaleY = 1;
		const matrix = before.transform.match(/^matrix\(([^)]+)\)$/u)?.[1];
		if (matrix) {
			const [a, b, c, d] = matrix.split(",").map(Number);
			if ([a, b, c, d].every(Number.isFinite)) {
				scaleX = Math.hypot(a, b);
				scaleY = Math.hypot(c, d);
			}
		}
		const centerX = inputRect.left + left + width / 2;
		const centerY = inputRect.top + top + height / 2;
		return {
			bottom: centerY + height * scaleY / 2,
			height: height * scaleY,
			left: centerX - width * scaleX / 2,
			right: centerX + width * scaleX / 2,
			top: centerY - height * scaleY / 2,
			width: width * scaleX,
		};
	};
	const overlap = (first, second) => (
		first.left < second.right
		&& first.right > second.left
		&& first.top < second.bottom
		&& first.bottom > second.top
	);
	const expected = [
		{ id: "PHY-TIGHT-UNCHECKED", checked: false, owner: "li" },
		{ id: "PHY-TIGHT-CHECKED", checked: true, owner: "li" },
		{ id: "PHY-LOOSE-UNCHECKED", checked: false, owner: "p" },
		{ id: "PHY-LOOSE-CHECKED", checked: true, owner: "p" },
	];
	const tasks = expected.map(({ id, checked: expectedChecked, owner: expectedOwner }) => {
		const item = [...root.querySelectorAll("li.task-list-item")]
			.find((candidate) => candidate.textContent?.includes(id));
		if (!(item instanceof HTMLLIElement)) return { id, error: "task-item-missing" };
		const input = item.querySelector('input[type="checkbox"]');
		if (!(input instanceof HTMLInputElement)) return { id, error: "task-input-missing" };
		const owner = input.parentElement;
		const ownerKind = owner?.tagName.toLowerCase() ?? null;
		const captionRects = owner ? textRects(input, owner) : [];
		const firstTop = captionRects.length ? Math.min(...captionRects.map(({ top }) => top)) : null;
		const firstLineRects = firstTop === null
			? []
			: captionRects.filter(({ top }) => Math.abs(top - firstTop) <= 0.5);
		const firstLine = firstLineRects.length
			? {
				bottom: Math.max(...firstLineRects.map(({ bottom }) => bottom)),
				height: Math.max(...firstLineRects.map(({ bottom }) => bottom)) - firstTop,
				left: Math.min(...firstLineRects.map(({ left }) => left)),
				right: Math.max(...firstLineRects.map(({ right }) => right)),
				top: firstTop,
				width: Math.max(...firstLineRects.map(({ right }) => right)) - Math.min(...firstLineRects.map(({ left }) => left)),
			}
			: null;
		const marker = markerRect(input);
		const style = getComputedStyle(input);
		const before = getComputedStyle(input, "::before");
		const nestedParagraph = [...item.querySelectorAll("p")]
			.find((paragraph) => paragraph.textContent?.includes("PHY-NESTED-PARAGRAPH"));
		return {
			captionRects,
			checked: input.checked,
			firstLine,
			input: {
				backgroundColor: style.backgroundColor,
				borderTopWidth: style.borderTopWidth,
				boxShadow: style.boxShadow,
				boxSizing: style.boxSizing,
				fontSize: style.fontSize,
				lineHeight: style.lineHeight,
				marginLeft: style.marginLeft,
				marginTop: style.marginTop,
				opacity: style.opacity,
				padding: style.padding,
			},
			id,
			marker,
			markerStyle: {
				backgroundColor: before.backgroundColor,
				opacity: before.opacity,
			},
			nestedParagraphPosition: nestedParagraph
				? getComputedStyle(nestedParagraph).position
				: null,
			owner: ownerKind,
			expectedChecked,
			expectedOwner,
			overlapsCaption: marker
				? captionRects.some((caption) => overlap(marker, caption))
				: null,
		};
	});
	return {
		root: rect(root),
		tasks,
	};
}

test("keeps Phycat task markers aligned across host form styles and narrow Chromium widths", async ({ page }) => {
	test.setTimeout(20 * 60_000);
	await page.setViewportSize({ width: 430, height: 900 });
	await login(page);
	const response = await page.goto(postUrl);
	if (!response || !response.ok()) {
		throw new Error(`phycat-task-layout-post-unavailable:${response?.status() ?? "no-response"}`);
	}
	const editor = page.locator('[data-easymde-editor-owner="react"]');
	await expect(editor).toBeVisible();
	const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
	await waitForPreviewIdle(preview);
	await page.locator(".easymde-source-react .cm-content").fill(PHY_CAT_TASK_LAYOUT_MARKDOWN);
	await expect(page.locator("#easymde-source")).toHaveValue(PHY_CAT_TASK_LAYOUT_MARKDOWN);
	await waitForPreviewIdle(preview);
	await expect(preview).toContainText("PHY-NESTED-PARAGRAPH");
	const labels = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
	const themes = await page.evaluate((themeIds) => (
		window.EasyMDEEditorRootBootstrap.appearance.articleThemes
			.filter(({ id }) => themeIds.includes(id))
			.map(({ id, label, cssUrl }) => ({ cssUrl, id, label }))
	), PHY_CAT_TASK_THEME_IDS);
	expect(themes.map(({ id }) => id)).toEqual(PHY_CAT_TASK_THEME_IDS);
	const sourceSelector = '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]';
	const evidenceByCase = new Map();

	for (const theme of themes) {
		await setViewportForThemeSelection(page, 430);
		await setMode(page, "ordinary", labels);
		await chooseTheme(page, theme);
		await setMode(page, "pure-narrow", labels);
		await expect(page.locator(sourceSelector)).toBeVisible();

		for (const width of PHY_CAT_TASK_LAYOUT_WIDTHS) {
			await page.setViewportSize({ width, height: 900 });
			await expect(page.locator(sourceSelector)).toBeVisible();
			for (const [hostVariant, hostCss] of Object.entries(PHY_CAT_HOST_FORM_STYLES)) {
				const hostStyle = await page.addStyleTag({ content: hostCss });
				try {
					await settleTaskMarkerAnimations(page, sourceSelector);
					const evidence = await page.locator(sourceSelector).evaluate(readPhycatTaskLayoutEvidence);
					evidenceByCase.set(`${theme.id}/${width}/${hostVariant}`, evidence);
					assertPhycatTaskLayoutEvidence(evidence, {
						hostVariant,
						theme,
						width,
					});
				} finally {
					await hostStyle.evaluate((element) => element.remove());
				}
			}
		}
	}

	for (const theme of themes) {
		for (const width of PHY_CAT_TASK_LAYOUT_WIDTHS) {
			const light = evidenceByCase.get(`${theme.id}/${width}/light`);
			const tinted = evidenceByCase.get(`${theme.id}/${width}/tinted`);
			expect(light, `${theme.id}/${width} light evidence`).toBeDefined();
			expect(tinted, `${theme.id}/${width} tinted evidence`).toBeDefined();
			expect(
				tinted.tasks.map(({ markerStyle }) => markerStyle),
				`${theme.id}/${width} marker paint should ignore host background changes`,
			).toEqual(light.tasks.map(({ markerStyle }) => markerStyle));
			expect(
				tinted.tasks.map(({ input }) => input),
				`${theme.id}/${width} input reset should ignore host form changes`,
			).toEqual(light.tasks.map(({ input }) => input));
		}
	}
});

function assertPhycatTaskLayoutEvidence(evidence, { hostVariant, theme, width }) {
	expect(evidence.tasks, `${theme.id}/${width}/${hostVariant} task evidence`).toHaveLength(4);
	for (const task of evidence.tasks) {
		expect(task.error, `${theme.id}/${width}/${hostVariant}/${task.id}`).toBeUndefined();
		expect(task.checked, `${theme.id}/${width}/${hostVariant}/${task.id} checked state`).toBe(task.expectedChecked);
		expect(task.owner, `${theme.id}/${width}/${hostVariant}/${task.id} owner`).toBe(task.expectedOwner);
		expect(task.input.boxSizing, `${theme.id}/${width}/${hostVariant}/${task.id} box sizing`).toBe("border-box");
		expect(task.input.padding, `${theme.id}/${width}/${hostVariant}/${task.id} padding`).toBe("0px");
		expect(task.input.opacity, `${theme.id}/${width}/${hostVariant}/${task.id} input opacity`).toBe("1");
		expect(task.input.borderTopWidth, `${theme.id}/${width}/${hostVariant}/${task.id} border`).toBe("0px");
		expect(task.input.backgroundColor, `${theme.id}/${width}/${hostVariant}/${task.id} input background`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/u);
		expect(task.input.boxShadow, `${theme.id}/${width}/${hostVariant}/${task.id} input shadow`).toBe("none");
		expect(task.markerStyle.opacity, `${theme.id}/${width}/${hostVariant}/${task.id} marker opacity`).toBe("1");
		expect(task.captionRects.length, `${theme.id}/${width}/${hostVariant}/${task.id} caption rects`).toBeGreaterThan(0);
		expect(task.firstLine, `${theme.id}/${width}/${hostVariant}/${task.id} first caption line`).not.toBeNull();
		expect(task.marker, `${theme.id}/${width}/${hostVariant}/${task.id} marker geometry`).not.toBeNull();
		expect(task.overlapsCaption, `${theme.id}/${width}/${hostVariant}/${task.id} marker overlap`).toBe(false);
		const fontSize = Number.parseFloat(task.input.fontSize);
		const marginTop = Number.parseFloat(task.input.marginTop);
		const marginLeft = Number.parseFloat(task.input.marginLeft);
		expect(marginTop, `${theme.id}/${width}/${hostVariant}/${task.id} upstream top margin`).toBeCloseTo(fontSize - 10, 1);
		expect(marginLeft, `${theme.id}/${width}/${hostVariant}/${task.id} upstream left margin`).toBeCloseTo(-1.2 * fontSize, 1);
		const centerDelta = Math.abs(
			task.marker.top + task.marker.height / 2
			- (task.firstLine.top + task.firstLine.height / 2),
		);
		expect(centerDelta, `${theme.id}/${width}/${hostVariant}/${task.id} first-line center alignment`).toBeLessThanOrEqual(2);
		expect(task.captionRects.length, `${theme.id}/${width}/${hostVariant}/${task.id} wrapped caption`).toBeGreaterThan(1);
	}
	const nested = evidence.tasks.find(({ id }) => id === "PHY-LOOSE-UNCHECKED");
	expect(nested?.nestedParagraphPosition, `${theme.id}/${width}/${hostVariant} nested paragraph`).toBe("static");
}

async function setViewportForThemeSelection(page, width) {
	if (page.viewportSize()?.width !== width) {
		await page.setViewportSize({ width, height: 900 });
	}
}

async function settleTaskMarkerAnimations(page, selector) {
	await page.evaluate(async (rootSelector) => {
		const root = document.querySelector(rootSelector);
		if (!(root instanceof Element)) throw new Error("phycat-task-layout-root-unavailable");
		const animations = document.getAnimations().filter((animation) => {
			const target = animation.effect && "target" in animation.effect ? animation.effect.target : null;
			const owner = target instanceof Element ? target : target?.parentElement ?? null;
			return owner instanceof Element
				&& root.contains(owner)
				&& animation.playState !== "finished";
		});
		await Promise.all(animations.map((animation) => animation.finished));
	}, selector);
}
