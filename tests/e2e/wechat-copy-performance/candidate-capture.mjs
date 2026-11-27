import { expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { previewSelector } from "./environment.mjs";
import { writePrivateArtifact } from "./private-evidence.mjs";

export async function captureCandidateTaskScreenshots(
	page,
	testInfo,
	{
		capture,
		markers,
		onMarker = null,
		onRestore = null,
		peer = null,
		scrollRootSelector,
		stem,
	},
) {
	const markerCount = await markers.count();
	if (markerCount !== 19) {
		throw new Error("wechat-copy-candidate-task-marker-count-invalid");
	}
	const scrollState = await page.evaluate(
		({ peerSelector, selector }) => {
			const root = document.querySelector(selector);
			if (!(root instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-task-scroll-root-unavailable");
			}
			const peerRoot = peerSelector
				? document.querySelector(peerSelector)
				: null;
			if (peerSelector && !(peerRoot instanceof HTMLElement)) {
				throw new Error(
					"wechat-copy-candidate-task-peer-scroll-root-unavailable",
				);
			}
			const values = {
				rootClientHeight: root.clientHeight,
				rootClientWidth: root.clientWidth,
				rootLeft: root.scrollLeft,
				rootScrollHeight: root.scrollHeight,
				rootScrollWidth: root.scrollWidth,
				rootTop: root.scrollTop,
				windowLeft: window.scrollX,
				windowTop: window.scrollY,
			};
			const peerState = peerRoot
				? {
						left: peerRoot.scrollLeft,
						top: peerRoot.scrollTop,
					}
				: null;
			if (
				Object.values(values).some((value) => !Number.isFinite(value)) ||
				values.rootClientWidth <= 0 ||
				values.rootClientHeight <= 0 ||
				(peerState &&
					Object.values(peerState).some((value) => !Number.isFinite(value)))
			) {
				throw new Error(
					"wechat-copy-candidate-task-scroll-root-geometry-invalid",
				);
			}
			return { ...values, peer: peerState, peerSelector };
		},
		{ peerSelector: peer?.selector ?? null, selector: scrollRootSelector },
	);
	const screenshots = [];
	let primaryError = null;
	try {
		for (let index = 0; index < markerCount; index += 1) {
			const marker = markers.nth(index);
			await marker.scrollIntoViewIfNeeded();
			const captureBox = await capture.boundingBox();
			const markerBox = await marker.boundingBox();
			const scrollMetrics = await page.evaluate((selector) => {
				const root = document.querySelector(selector);
				if (!(root instanceof HTMLElement)) {
					throw new Error("wechat-copy-candidate-task-scroll-root-unavailable");
				}
				return {
					clientHeight: root.clientHeight,
					clientWidth: root.clientWidth,
					maxLeft: Math.max(0, root.scrollWidth - root.clientWidth),
					maxTop: Math.max(0, root.scrollHeight - root.clientHeight),
					scrollLeft: root.scrollLeft,
					scrollTop: root.scrollTop,
				};
			}, scrollRootSelector);
			if (
				!captureBox ||
				!markerBox ||
				!Number.isFinite(captureBox.width) ||
				captureBox.width <= 0 ||
				!Number.isFinite(captureBox.height) ||
				captureBox.height <= 0 ||
				!Object.values(scrollMetrics).every(Number.isFinite) ||
				scrollMetrics.clientWidth <= 0 ||
				scrollMetrics.clientHeight <= 0 ||
				scrollMetrics.scrollLeft < 0 ||
				scrollMetrics.scrollLeft > scrollMetrics.maxLeft ||
				scrollMetrics.scrollTop < 0 ||
				scrollMetrics.scrollTop > scrollMetrics.maxTop
			) {
				throw new Error(
					"wechat-copy-candidate-task-screenshot-geometry-invalid",
				);
			}
			const visibleWidth =
				Math.min(
					markerBox.x + markerBox.width,
					captureBox.x + captureBox.width,
				) - Math.max(markerBox.x, captureBox.x);
			const visibleHeight =
				Math.min(
					markerBox.y + markerBox.height,
					captureBox.y + captureBox.height,
				) - Math.max(markerBox.y, captureBox.y);
			if (
				!Number.isFinite(visibleWidth) ||
				!Number.isFinite(visibleHeight) ||
				visibleWidth <= 0 ||
				visibleHeight <= 0
			) {
				throw new Error("wechat-copy-candidate-task-marker-not-visible");
			}
			const bytes = await capture.screenshot({
				animations: "allow",
				caret: "initial",
			});
			if (onMarker) {
				await onMarker({
					captureBox,
					index,
					markerBox,
					scrollMetrics,
					visibleHeight,
					visibleWidth,
				});
			}
			screenshots.push({
				captureHeight: captureBox.height,
				captureWidth: captureBox.width,
				file: await writePrivateArtifact(testInfo, `${stem}-${index}`, bytes),
				index,
				markerLeft: markerBox.x - captureBox.x,
				markerRight: markerBox.x + markerBox.width - captureBox.x,
				overhangLeft: Math.max(0, captureBox.x - markerBox.x),
				overhangRight: Math.max(
					0,
					markerBox.x + markerBox.width - captureBox.x - captureBox.width,
				),
				rootMaxScrollLeft: scrollMetrics.maxLeft,
				rootMaxScrollTop: scrollMetrics.maxTop,
				scrollLeft: scrollMetrics.scrollLeft,
				scrollTop: scrollMetrics.scrollTop,
				visibleHeight,
				visibleWidth,
			});
		}
	} catch (error) {
		primaryError = error;
	}
	let restoreError = null;
	let restoredState = null;
	try {
		restoredState = await page.evaluate(
			({ selector, state }) => {
				const root = document.querySelector(selector);
				if (!(root instanceof HTMLElement)) {
					throw new Error("wechat-copy-candidate-task-scroll-root-unavailable");
				}
				const peerRoot = state.peerSelector
					? document.querySelector(state.peerSelector)
					: null;
				if (state.peerSelector && !(peerRoot instanceof HTMLElement)) {
					throw new Error(
						"wechat-copy-candidate-task-peer-scroll-root-unavailable",
					);
				}
				if (peerRoot && state.peer) {
					peerRoot.scrollTop = state.peer.top;
					peerRoot.scrollLeft = state.peer.left;
				}
				root.scrollTop = state.rootTop;
				root.scrollLeft = state.rootLeft;
				window.scrollTo(state.windowLeft, state.windowTop);
				return {
					expected: {
						cmLeft: state.peer?.left ?? null,
						cmTop: state.peer?.top ?? null,
						previewLeft: state.rootLeft,
						previewTop: state.rootTop,
						windowLeft: state.windowLeft,
						windowTop: state.windowTop,
					},
					peer: peerRoot
						? {
								left: peerRoot.scrollLeft,
								top: peerRoot.scrollTop,
							}
						: null,
					rootLeft: root.scrollLeft,
					rootTop: root.scrollTop,
					windowLeft: window.scrollX,
					windowTop: window.scrollY,
				};
			},
			{ selector: scrollRootSelector, state: scrollState },
		);
		if (
			restoredState.rootLeft !== scrollState.rootLeft ||
			restoredState.rootTop !== scrollState.rootTop ||
			restoredState.windowLeft !== scrollState.windowLeft ||
			restoredState.windowTop !== scrollState.windowTop ||
			(scrollState.peer &&
				(restoredState.peer?.left !== scrollState.peer.left ||
					restoredState.peer?.top !== scrollState.peer.top))
		) {
			restoreError = new Error(
				scrollState.peer
					? "wechat-copy-candidate-task-peer-scroll-restore-failed"
					: "wechat-copy-candidate-task-scroll-restore-failed",
			);
		}
	} catch {
		restoreError = new Error(
			"wechat-copy-candidate-task-scroll-restore-failed",
		);
	}
	if (primaryError) {
		if (restoreError) testInfo.errors.push({ message: restoreError.message });
		throw primaryError;
	}
	if (restoreError) throw restoreError;
	if (onRestore) await onRestore({ restored: restoredState });
	return screenshots;
}

export function readCandidatePostFingerprint(runWp, postId) {
	let entries;
	try {
		entries = JSON.parse(
			runWp(["post", "meta", "list", String(postId), "--format=json"]),
		);
	} catch {
		throw new Error("wechat-copy-candidate-post-metadata-unavailable");
	}
	if (!Array.isArray(entries)) {
		throw new Error("wechat-copy-candidate-post-metadata-invalid");
	}
	return entries
		.filter(
			(entry) =>
				typeof entry?.meta_key === "string" &&
				entry.meta_key.startsWith("_easymde_"),
		)
		.map((entry) => {
			const value = String(entry.meta_value ?? "");
			return {
				key: entry.meta_key,
				length: value.length,
				sha256: createHash("sha256").update(value, "utf8").digest("hex"),
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

export async function readCandidateRichClipboard(page) {
	return page.evaluate(async () => {
		if (
			!navigator.clipboard ||
			typeof navigator.clipboard.read !== "function"
		) {
			throw new Error("wechat-copy-candidate-clipboard-read-unavailable");
		}
		const items = await navigator.clipboard.read();
		if (items.length !== 1) {
			throw new Error("wechat-copy-candidate-clipboard-item-count-invalid");
		}
		const [item] = items;
		if (
			!item.types.includes("text/html") ||
			!item.types.includes("text/plain")
		) {
			throw new Error("wechat-copy-candidate-rich-clipboard-types-invalid");
		}
		const html = await (await item.getType("text/html")).text();
		const plainText = await (await item.getType("text/plain")).text();
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const roles = [...parsed.querySelectorAll('[role="checkbox"]')];
		const owners = roles.filter((element) => element.closest("li"));
		const checkedTrue = owners.filter(
			(element) => element.getAttribute("aria-checked") === "true",
		).length;
		const checkedFalse = owners.filter(
			(element) => element.getAttribute("aria-checked") === "false",
		).length;
		const checkedStates = owners.map(
			(element) => element.getAttribute("aria-checked") === "true",
		);
		return {
			html,
			itemCount: items.length,
			hasHtml: true,
			hasPlainText: plainText.length > 0,
			markerType:
				owners.length === roles.length && roles.length > 0
					? "static-owner"
					: "other",
			roleCount: roles.length,
			ownerCount: owners.length,
			checkedTrue,
			checkedFalse,
			checkedStates,
			inputCount: parsed.querySelectorAll("input").length,
			formControlCount: parsed.querySelectorAll(
				"input,select,textarea,button,form",
			).length,
			allDisabled: owners.every(
				(element) => element.getAttribute("aria-disabled") === "true",
			),
		};
	});
}

export async function readCandidateSerializedH3Sample(page, ordinal) {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
		throw new Error("wechat-copy-candidate-serialized-h3-ordinal-invalid");
	}
	return page.evaluate((selectedOrdinal) => {
		const mount = document.querySelector(
			'[data-easymde-candidate-render="serialized-output-mount"]',
		);
		const wrapper = mount?.firstElementChild;
		const root = wrapper?.firstElementChild;
		if (
			!(mount instanceof HTMLElement) ||
			!(wrapper instanceof HTMLElement) ||
			wrapper.dataset.easymdeCandidateRender !== "serialized-output" ||
			!(root instanceof HTMLElement)
		) {
			throw new Error("wechat-copy-candidate-serialized-h3-root-unavailable");
		}
		if (mount.children.length !== 1) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-mount-child-count-invalid",
			);
		}
		if (wrapper.children.length !== 1 || root.parentElement !== wrapper) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-export-root-child-count-invalid",
			);
		}
		const h3s = [...root.querySelectorAll("h3")];
		const h3 = h3s[selectedOrdinal - 1];
		if (!(h3 instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-serialized-h3-sample-unavailable");
		}
		const finiteRect = (value, code) => {
			const rect = value.getBoundingClientRect();
			const result = {
				height: rect.height,
				left: rect.left,
				top: rect.top,
				width: rect.width,
			};
			if (
				Object.values(result).some((entry) => !Number.isFinite(entry)) ||
				result.width <= 0 ||
				result.height <= 0
			) {
				throw new Error(code);
			}
			return result;
		};
		const finiteBox = (value, code) => {
			const rect = value.getBoundingClientRect();
			const result = {
				height: rect.height,
				left: rect.left,
				top: rect.top,
				width: rect.width,
			};
			if (
				Object.values(result).some((entry) => !Number.isFinite(entry)) ||
				result.width < 0 ||
				result.height < 0
			) {
				throw new Error(code);
			}
			return result;
		};
		const alpha = (value) => {
			if (value === "transparent") return 0;
			const match = value.match(/^rgba?\((.*)\)$/u);
			if (!match) return null;
			const parts = match[1].split(/[\s,/]+/u).filter(Boolean);
			if (parts.length === 3) return 1;
			if (parts.length !== 4) return null;
			const parsed = Number.parseFloat(parts[3]);
			return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
				? parsed
				: null;
		};
		const enumValue = (value, values) =>
			values.includes(value) ? value : "other";
		const finiteAlpha = (value, code) => {
			const parsed = Number(value);
			if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
				throw new Error(code);
			}
			return parsed;
		};
		const describeElement = (element, geometryCode) => {
			const style = getComputedStyle(element);
			const backgroundAlpha = alpha(style.backgroundColor);
			if (!Number.isFinite(backgroundAlpha)) {
				throw new Error("wechat-copy-candidate-serialized-h3-alpha-invalid");
			}
			return {
				backgroundAlpha,
				computedInlinePosition: {
					display: enumValue(style.display, [
						"block",
						"inline",
						"inline-block",
						"inline-flex",
						"none",
					]),
					position: enumValue(style.position, [
						"absolute",
						"fixed",
						"relative",
						"static",
						"sticky",
					]),
				},
				...finiteRect(element, geometryCode),
			};
		};
		const range = document.createRange();
		range.selectNodeContents(h3);
		const h3Rect = finiteRect(
			h3,
			"wechat-copy-candidate-serialized-h3-geometry-invalid",
		);
		const generated = [...h3.children].filter(
			(child) =>
				child instanceof HTMLSpanElement &&
				child.getAttribute("aria-hidden") === "true",
		);
		const generatedTextKinds = { other: 0, space: 0, wordJoiner: 0 };
		const generatedSpanNodes = generated.map((span) => {
			const value = span.textContent ?? "";
			let textKind = "other";
			if (value && [...value].every((character) => character === "\u2060")) {
				generatedTextKinds.wordJoiner += 1;
				textKind = "wordJoiner";
			} else if (value && /^\s+$/u.test(value)) {
				generatedTextKinds.space += 1;
				textKind = "space";
			}
			if (textKind === "other") generatedTextKinds.other += 1;
			const style = getComputedStyle(span);
			const actualBBox = finiteBox(
				span,
				"wechat-copy-candidate-serialized-h3-generated-span-bbox-invalid",
			);
			const inlineOffsets = [...span.getClientRects()].map((rect) => {
				const offset = {
					height: rect.height,
					left: rect.left - h3Rect.left,
					top: rect.top - h3Rect.top,
					width: rect.width,
				};
				if (
					Object.values(offset).some((entry) => !Number.isFinite(entry)) ||
					offset.width < 0 ||
					offset.height < 0
				) {
					throw new Error(
						"wechat-copy-candidate-serialized-h3-generated-span-inline-offset-invalid",
					);
				}
				return offset;
			});
			if (
				actualBBox.width > 0 &&
				actualBBox.height > 0 &&
				inlineOffsets.length === 0
			) {
				throw new Error(
					"wechat-copy-candidate-serialized-h3-generated-span-inline-offset-unavailable",
				);
			}
			return {
				actualBBox,
				inlineOffsets,
				backgroundAlpha: (() => {
					const value = alpha(style.backgroundColor);
					if (!Number.isFinite(value)) {
						throw new Error(
							"wechat-copy-candidate-serialized-h3-generated-span-background-alpha-invalid",
						);
					}
					return value;
				})(),
				opacity: finiteAlpha(
					style.opacity,
					"wechat-copy-candidate-serialized-h3-generated-span-opacity-invalid",
				),
				textKind,
			};
		});
		const mountRect = finiteRect(
			mount,
			"wechat-copy-candidate-serialized-h3-mount-geometry-invalid",
		);
		const mountClientClipRect = {
			height: mount.clientHeight,
			left: mountRect.left + mount.clientLeft,
			top: mountRect.top + mount.clientTop,
			width: mount.clientWidth,
		};
		if (
			Object.values(mountClientClipRect).some(
				(value) => !Number.isFinite(value),
			) ||
			mountClientClipRect.width <= 0 ||
			mountClientClipRect.height <= 0
		) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-mount-client-clip-invalid",
			);
		}
		const rootRect = finiteRect(
			root,
			"wechat-copy-candidate-serialized-h3-root-geometry-invalid",
		);
		const wrapperRect = finiteRect(
			wrapper,
			"wechat-copy-candidate-serialized-h3-wrapper-geometry-invalid",
		);
		const mountOverflowStyle = getComputedStyle(mount);
		const overflowValues = ["auto", "clip", "hidden", "scroll", "visible"];
		const mountOverflow = {
			overflow: enumValue(mountOverflowStyle.overflow, overflowValues),
			overflowX: enumValue(mountOverflowStyle.overflowX, overflowValues),
			overflowY: enumValue(mountOverflowStyle.overflowY, overflowValues),
		};
		const wrapperOverflowStyle = getComputedStyle(wrapper);
		const wrapperOverflow = {
			overflow: enumValue(wrapperOverflowStyle.overflow, overflowValues),
			overflowX: enumValue(wrapperOverflowStyle.overflowX, overflowValues),
			overflowY: enumValue(wrapperOverflowStyle.overflowY, overflowValues),
		};
		const rootOverflowStyle = getComputedStyle(root);
		const rootOverflow = {
			overflow: enumValue(rootOverflowStyle.overflow, overflowValues),
			overflowX: enumValue(rootOverflowStyle.overflowX, overflowValues),
			overflowY: enumValue(rootOverflowStyle.overflowY, overflowValues),
		};
		const rootClipAxes = {
			horizontal: rootOverflow.overflowX !== "visible",
			vertical: rootOverflow.overflowY !== "visible",
		};
		const rootClientClipRect = {
			height: root.clientHeight,
			left: rootRect.left + root.clientLeft,
			top: rootRect.top + root.clientTop,
			width: root.clientWidth,
		};
		const rootClipRect =
			rootClipAxes.horizontal || rootClipAxes.vertical
				? rootClientClipRect
				: null;
		if (
			rootClipRect &&
			(Object.values(rootClipRect).some((value) => !Number.isFinite(value)) ||
				rootClipRect.width <= 0 ||
				rootClipRect.height <= 0)
		) {
			throw new Error(
				"wechat-copy-candidate-serialized-h3-root-client-clip-invalid",
			);
		}
		return {
			directH3ChildCount: h3.children.length,
			generatedAriaHiddenSpanCount: generated.length,
			generatedAriaHiddenSpanState: generated.length ? "present" : "absent",
			generatedAriaHiddenSpans: generatedSpanNodes,
			generatedTextKinds,
			h3: describeElement(
				h3,
				"wechat-copy-candidate-serialized-h3-geometry-invalid",
			),
			h3Count: h3s.length,
			mountClientClipRect,
			mountOverflow,
			ordinal: selectedOrdinal,
			rootProvenance: "wrapper-first-element-child",
			rootRect,
			rootClipRect,
			rootClipAxes,
			rootClipState:
				rootClipRect === null
					? "unclipped-overflow-visible"
					: "computed-overflow-clip",
			rootOverflow,
			status: "available",
			textRangeKind: "h3-contents-range",
			textRange: finiteRect(
				range,
				"wechat-copy-candidate-serialized-h3-text-range-invalid",
			),
			wrapperChildElementCount: wrapper.children.length,
			wrapperOverflow,
			wrapperRect,
		};
	}, ordinal);
}

export async function renderCandidateSerializedOutput(page, html) {
	const width = await page.locator(previewSelector).evaluate((element) => {
		const style = getComputedStyle(element);
		const value =
			element.getBoundingClientRect().width -
			Number.parseFloat(style.borderLeftWidth) -
			Number.parseFloat(style.borderRightWidth) -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(
				"wechat-copy-candidate-preview-content-width-unavailable",
			);
		}
		return value;
	});
	if (!Number.isFinite(width) || width <= 0) {
		throw new Error("wechat-copy-candidate-serialized-content-width-invalid");
	}
	const viewportHeight = await page
		.locator('[data-easymde-editor-owner="react"] .easymde-immersive-preview-canvas')
		.evaluate((element) => {
			const value = element.clientHeight;
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error(
					"wechat-copy-candidate-preview-viewport-height-unavailable",
				);
			}
			return value;
		});
	await page.evaluate(
		({
			html: serializedHtml,
			height: serializedHeight,
			width: serializedWidth,
		}) => {
			document
				.querySelector(
					'[data-easymde-candidate-render="serialized-output-mount"]',
				)
				?.remove();
			const existing = document.querySelector(
				'[data-easymde-candidate-render="serialized-output"]',
			);
			existing?.remove();
			const mount = document.createElement("div");
			mount.dataset.easymdeCandidateRender = "serialized-output-mount";
			mount.style.cssText = [
				"background-color:#fff",
				`height:${serializedHeight}px`,
				`width:${serializedWidth}px`,
				"overflow:auto",
				"position:fixed",
				"left:0",
				"top:0",
				"z-index:2147483647",
				"pointer-events:none",
			].join(";");
			const root = document.createElement("div");
			root.dataset.easymdeCandidateRender = "serialized-output";
			root.innerHTML = serializedHtml;
			mount.append(root);
			document.body.append(mount);
		},
		{ html, height: viewportHeight, width },
	);
	const output = page.locator(
		'[data-easymde-candidate-render="serialized-output"] > *',
	);
	await expect(output).toHaveCount(1);
	await output.evaluate(async (element) => {
		if (document.fonts?.ready) await document.fonts.ready;
		const images = [...element.querySelectorAll("img")];
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
							reject(new Error("wechat-copy-candidate-output-image-failed"));
						};
						image.addEventListener("load", onLoad, { once: true });
						image.addEventListener("error", onError, { once: true });
					});
				}
				if (typeof image.decode === "function") await image.decode();
				if (image.naturalWidth < 1 || image.naturalHeight < 1) {
					throw new Error(
						"wechat-copy-candidate-output-image-intrinsic-invalid",
					);
				}
			}),
		);
	});
	const mount = page.locator(
		'[data-easymde-candidate-render="serialized-output-mount"]',
	);
	let measured = null;
	let parentWidth = width;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await mount.evaluate((element, nextWidth) => {
			element.style.width = `${nextWidth}px`;
		}, parentWidth);
		measured = await output.evaluate((element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			const contentWidth =
				rect.width -
				Number.parseFloat(style.borderLeftWidth) -
				Number.parseFloat(style.borderRightWidth) -
				Number.parseFloat(style.paddingLeft) -
				Number.parseFloat(style.paddingRight);
			return {
				contentWidth,
				height: rect.height,
				outsideEditor: element.closest(".easymde-editor") === null,
				width: rect.width,
			};
		});
		if (
			measured.outsideEditor === true &&
			Number.isFinite(measured.contentWidth) &&
			measured.contentWidth > 0 &&
			Number.isFinite(measured.width) &&
			measured.width > 0 &&
			Number.isFinite(measured.height) &&
			measured.height > 0 &&
			Math.abs(measured.contentWidth - width) <= 1 / 64
		) {
			return {
				mount,
				output,
				viewportHeight,
				width: parentWidth,
				contentWidth: measured.contentWidth,
			};
		}
		if (
			!Number.isFinite(measured.contentWidth) ||
			measured.contentWidth <= 0 ||
			!Number.isFinite(measured.width) ||
			measured.width <= 0 ||
			!Number.isFinite(measured.height) ||
			measured.height <= 0
		) {
			throw new Error("wechat-copy-candidate-serialized-geometry-invalid");
		}
		parentWidth += width - measured.contentWidth;
		if (!Number.isFinite(parentWidth) || parentWidth <= 0) {
			throw new Error("wechat-copy-candidate-serialized-parent-width-invalid");
		}
	}
	throw new Error("wechat-copy-candidate-serialized-content-width-invalid");
}

export async function captureCandidateSerializedTaskScreenshots(
	page,
	testInfo,
	html,
	h3Ordinal = null,
) {
	let rendered = null;
	let screenshots = null;
	let h3Sample = null;
	let primaryError = null;
	try {
		rendered = await renderCandidateSerializedOutput(page, html);
		screenshots = await captureCandidateTaskScreenshots(page, testInfo, {
			capture: rendered.mount,
			markers: rendered.output.locator('[role="checkbox"]'),
			onMarker:
				h3Ordinal === null
					? null
					: async ({ index }) => {
							if (index === 0) {
								h3Sample = await readCandidateSerializedH3Sample(
									page,
									h3Ordinal,
								);
							}
						},
			scrollRootSelector:
				'[data-easymde-candidate-render="serialized-output-mount"]',
			stem: "serialized-output-task",
		});
	} catch (error) {
		primaryError = error;
	}
	let cleanupError = null;
	try {
		await page.evaluate(() => {
			document
				.querySelector(
					'[data-easymde-candidate-render="serialized-output-mount"]',
				)
				?.remove();
		});
	} catch {
		cleanupError = new Error("wechat-copy-candidate-output-cleanup-failed");
	}
	if (primaryError) {
		if (cleanupError) testInfo.errors.push({ message: cleanupError.message });
		throw primaryError;
	}
	if (cleanupError) throw cleanupError;
	if (h3Ordinal !== null && !h3Sample) {
		throw new Error("wechat-copy-candidate-serialized-h3-sample-unavailable");
	}
	return {
		screenshots,
		width: rendered.width,
		contentWidth: rendered.contentWidth,
		h3Sample,
		viewportHeight: rendered.viewportHeight,
	};
}
