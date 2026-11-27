import { expect } from "@playwright/test";
import { resolve } from "node:path";
import { canonicalMarkdownLength } from "./environment.mjs";
import { canonicalMarkdownSha256 } from "./environment.mjs";
import { performanceModeDefinitions } from "./performance-mode.mjs";
import { previewSelector } from "./environment.mjs";
import { sourceSelector } from "./environment.mjs";
import { assertCanonicalSourceText } from '../wechat-canonical-fixture.mjs';

export async function assertCanonicalSource(page) {
	await assertCanonicalSourceText(page, {
		expectedLength: canonicalMarkdownLength,
		expectedSha256: canonicalMarkdownSha256,
		selector: sourceSelector,
	});
}

export async function waitForPreviewReady(
	page,
	{ requireImages, visible = true } = {},
) {
	const shouldRequireImages = requireImages ?? visible;
	const preview = page.locator(previewSelector);
	if (visible) await expect(preview).toBeVisible();
	else await expect(preview).toBeAttached();
	await expect(preview).toHaveAttribute("aria-busy", "false");
	await expect(preview).toHaveAttribute("data-easymde-preview-accepted", "1");
	await expect(preview).not.toHaveAttribute("data-easymde-preview-error", "1");
	await page.evaluate(
		async ({ requireImages: shouldRequireImages }) => {
			if (document.fonts?.ready) await document.fonts.ready;
			if (document.fonts?.status !== "loaded") {
				throw new Error("wechat-copy-performance-font-readiness-failed");
			}
			const root = document.querySelector(
				'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
			);
			if (!(root instanceof HTMLElement)) {
				throw new Error("wechat-copy-performance-preview-root-unavailable");
			}
			const images = [...root.querySelectorAll("img")];
			if (!shouldRequireImages) return;
			if (images.length < 1)
				throw new Error("wechat-copy-performance-preview-images-unavailable");
			await Promise.all(
				images.map(async (image) => {
					if (!image.complete) {
						await new Promise((resolve, reject) => {
							const onLoad = () => {
								image.removeEventListener("load", onLoad);
								image.removeEventListener("error", onError);
								resolve();
							};
							const onError = () => {
								image.removeEventListener("load", onLoad);
								image.removeEventListener("error", onError);
								reject(
									new Error("wechat-copy-performance-preview-image-failed"),
								);
							};
							image.addEventListener("load", onLoad, { once: true });
							image.addEventListener("error", onError, { once: true });
						});
					}
					if (typeof image.decode === "function") await image.decode();
					if (!Number.isFinite(image.naturalWidth) || image.naturalWidth < 1) {
						throw new Error(
							"wechat-copy-performance-preview-image-intrinsic-invalid",
						);
					}
				}),
			);
		},
		{ requireImages: shouldRequireImages },
	);
}

export async function installPerformanceModeOverride(page, mode) {
	const definition = performanceModeDefinitions[mode];
	if (!definition || mode === "ordinarySplit") return;
	await page.addInitScript(
		({ editingMode }) => {
			let loaderBootstrap;
			Object.defineProperty(window, "EasyMDEAdminEditorLoaderBootstrap", {
				configurable: true,
				get: () => loaderBootstrap,
				set: (value) => {
					const editorBootstrap =
						value &&
						typeof value === "object" &&
						value.editorBootstrap &&
						typeof value.editorBootstrap === "object"
							? value.editorBootstrap
							: null;
					if (!editorBootstrap) {
						loaderBootstrap = value;
						return;
					}
					loaderBootstrap = {
						...value,
						editorBootstrap: {
							...editorBootstrap,
							settings: {
								...editorBootstrap.settings,
								general: {
									...editorBootstrap.settings?.general,
									editingMode,
								},
							},
						},
					};
				},
			});
		},
		{ editingMode: definition.editingMode },
	);
}

export async function configurePerformanceMode(page, mode) {
	const definition = performanceModeDefinitions[mode];
	if (!definition) throw new Error("wechat-copy-performance-mode-invalid");
	await waitForPreviewReady(page);
	if (!definition.immersive) {
		await expect(
			page.locator(".easymde-source-react .cm-content"),
		).toBeVisible();
		return;
	}

	const immersiveLabels = await page.evaluate(
		() => window.EasyMDEEditorRootBootstrap.strings.immersive,
	);
	await page.locator(".easymde-toolbar-immersive-toggle").click();
	await expect(
		page.getByRole("region", { name: immersiveLabels.immersive }),
	).toBeVisible();
	const immersivePreview = page.locator(
		'.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]',
	);
	if (definition.immersiveMode === "preview") {
		await page
			.getByRole("button", { name: immersiveLabels.previewMode, exact: true })
			.click();
		await expect(
			page.getByText(immersiveLabels.previewContentLoaded),
		).toBeVisible();
		await waitForPreviewReady(page);
		return;
	}
	if (definition.immersiveMode === "source") {
		await page
			.getByRole("button", { name: immersiveLabels.editMode, exact: true })
			.click();
		await expect(
			page.locator(".easymde-source-react .cm-content"),
		).toBeVisible();
		await expect(immersivePreview).toBeHidden();
		await waitForPreviewReady(page, { visible: false });
		return;
	}
	await expect(immersivePreview).toBeVisible();
	await waitForPreviewReady(page);
}

export async function readPerformanceModeState(page) {
	return page.evaluate(() => {
		const bootstrap = window.EasyMDEEditorRootBootstrap;
		const editor = document.querySelector(".easymde-editor");
		const workspace = document.querySelector(".easymde-workspace");
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		const source = document.querySelector(".easymde-pane-source");
		if (!(editor instanceof HTMLElement)) {
			throw new Error("wechat-copy-performance-editor-owner-unavailable");
		}
		if (!(workspace instanceof HTMLElement)) {
			throw new Error("wechat-copy-performance-workspace-owner-unavailable");
		}
		if (!(preview instanceof HTMLElement) || !(source instanceof HTMLElement)) {
			throw new Error("wechat-copy-performance-surface-owner-unavailable");
		}
		const visible = (element) =>
			element instanceof HTMLElement && element.getClientRects().length > 0;
		const workspaceModeOwners = [...workspace.classList].filter((className) =>
			className.startsWith("is-mode-"),
		);
		if (workspaceModeOwners.length !== 0) {
			throw new Error("wechat-copy-performance-workspace-mode-owner-invalid");
		}
		const immersiveModeOwners = ["split", "preview", "source"].filter((mode) =>
			editor.classList.contains(`is-immersive-${mode}`),
		);
		const immersive = editor.classList.contains("is-immersive");
		if (
			(immersive && immersiveModeOwners.length !== 1) ||
			(!immersive && immersiveModeOwners.length !== 0)
		) {
			throw new Error("wechat-copy-performance-immersive-mode-owner-invalid");
		}
		const immersiveMode = immersive ? immersiveModeOwners[0] : null;
		const workspaceMode = "split";
		const editingMode = bootstrap?.settings?.general?.editingMode ?? null;
		const actualMode = immersive
			? `immersive${immersiveMode[0].toUpperCase()}${immersiveMode.slice(1)}`
			: "ordinarySplit";
		return {
			actualMode,
			editingMode,
			immersiveMode,
			previewPresentation:
				editor?.getAttribute("data-easymde-preview-presentation") ?? null,
			previewVisible: visible(preview),
			sourceVisible: visible(source),
			surface: immersiveMode ? "immersive" : "ordinary",
			workspaceMode,
		};
	});
}

export async function readBrowserConfiguration(page) {
	return page.evaluate(() => {
		const bootstrap = window.EasyMDEEditorRootBootstrap;
		if (!bootstrap || typeof bootstrap !== "object") {
			throw new Error("wechat-copy-performance-editor-bootstrap-unavailable");
		}
		const articleTheme = document.querySelector(
			"#easymde-markdown-theme-field",
		);
		const codeTheme = document.querySelector("#easymde-code-theme-field");
		const codeThemeExplicit = document.querySelector(
			"#easymde-code-theme-explicit-field",
		);
		const articleStylesheet = document.querySelector(
			"#easymde-article-theme-css",
		);
		const codeStylesheet = document.querySelector(
			"#easymde-highlight-theme-css",
		);
		const editor = document.querySelector(".easymde-editor");
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		const imageUpload = bootstrap.imageUpload;
		const endpointPath =
			typeof imageUpload?.endpoint === "string"
				? new URL(imageUpload.endpoint, location.href).pathname
				: "";
		const visible = (element) =>
			element instanceof HTMLElement && element.getClientRects().length > 0;
		return {
			articleStylesheetReady:
				articleStylesheet instanceof HTMLLinkElement &&
				Boolean(articleStylesheet.sheet?.href),
			articleTheme:
				articleTheme instanceof HTMLInputElement ? articleTheme.value : null,
			codeStylesheetReady:
				codeStylesheet instanceof HTMLLinkElement &&
				Boolean(codeStylesheet.sheet?.href),
			codeTheme: codeTheme instanceof HTMLInputElement ? codeTheme.value : null,
			codeThemeExplicit:
				codeThemeExplicit instanceof HTMLInputElement
					? codeThemeExplicit.value
					: null,
			endpointIsImageHosting: endpointPath.endsWith("/image-hosting/upload"),
			imageUploadEnabled: imageUpload?.enabled === true,
			imageUploadOwner: imageUpload?.uploadOwner ?? null,
			pngConversionEnabled:
				bootstrap.wechatExport?.pngConversionEnabled === true,
			previewVisible: visible(preview),
			previewPresentation:
				editor?.getAttribute("data-easymde-preview-presentation") ?? null,
			sourceVisible: visible(document.querySelector(".easymde-pane-source")),
		};
	});
}
