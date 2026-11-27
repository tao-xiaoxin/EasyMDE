import { resolve } from "node:path";
import { previewSelector } from "./environment.mjs";

export async function readCandidateSourceFingerprint(page) {
	return page.evaluate(async () => {
		const digest = async (value) => {
			const bytes = new TextEncoder().encode(value);
			const hash = await crypto.subtle.digest("SHA-256", bytes);
			return [...new Uint8Array(hash)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		};
		const source = document.querySelector("#easymde-source");
		if (!(source instanceof HTMLTextAreaElement)) {
			throw new Error("wechat-copy-candidate-source-unavailable");
		}
		const metadataIds = [
			"#easymde-enabled-field",
			"#easymde-markdown-theme-field",
			"#easymde-code-theme-field",
			"#easymde-code-theme-explicit-field",
		];
		const metadata = {};
		for (const selector of metadataIds) {
			const field = document.querySelector(selector);
			if (!(field instanceof HTMLInputElement)) {
				throw new Error("wechat-copy-candidate-source-metadata-unavailable");
			}
			metadata[selector] = {
				length: field.value.length,
				sha256: await digest(field.value),
			};
		}
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		if (!(preview instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-preview-sink-unavailable");
		}
		const previewStyle = getComputedStyle(preview);
		const contentWidth =
			preview.getBoundingClientRect().width -
			Number.parseFloat(previewStyle.borderLeftWidth) -
			Number.parseFloat(previewStyle.borderRightWidth) -
			Number.parseFloat(previewStyle.paddingLeft) -
			Number.parseFloat(previewStyle.paddingRight);
		if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
			throw new Error("wechat-copy-candidate-preview-content-width-invalid");
		}
		return {
			markdown: {
				length: source.value.length,
				sha256: await digest(source.value),
			},
			metadata,
			preview: {
				contentWidth,
				formControlCount: preview.querySelectorAll(
					"input,select,textarea,button,form",
				).length,
				inputChecked: [
					...preview.querySelectorAll('input[type="checkbox"]'),
				].map((input) => input.checked),
				markupSha256: await digest(preview.innerHTML),
				sinkSignature: {
					className: preview.className,
					dataDocumentOwner: preview.getAttribute(
						"data-easymde-document-owner",
					),
					dataEditorOwner: preview.getAttribute("data-easymde-editor-owner"),
					dataLayoutOwner: preview.getAttribute("data-easymde-layout-owner"),
					dataPreviewHtmlSink: preview.getAttribute(
						"data-easymde-preview-html-sink",
					),
					tagName: preview.tagName,
				},
			},
		};
	});
}

export async function readCandidateSourceH3Ordinal(page) {
	return page.evaluate((selector) => {
		const root = document.querySelector(selector);
		const marker = root?.querySelector('input[type="checkbox"]');
		const task = marker?.closest("li");
		const h3s = root ? [...root.querySelectorAll("h3")] : [];
		if (!(root instanceof HTMLElement) || !(task instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-source-h3-task-unavailable");
		}
		const h3 = h3s
			.filter(
				(candidate) =>
					(candidate.compareDocumentPosition(task) &
						Node.DOCUMENT_POSITION_FOLLOWING) !==
					0,
			)
			.at(-1);
		const ordinal = h3 ? h3s.indexOf(h3) + 1 : 0;
		if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
			throw new Error("wechat-copy-candidate-source-h3-ordinal-unavailable");
		}
		return { h3Count: h3s.length, ordinal };
	}, previewSelector);
}

export async function readCandidateSourceH3Sample(page, ordinal) {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
		throw new Error("wechat-copy-candidate-source-h3-ordinal-invalid");
	}
	return page.evaluate(
		(selection) => {
			const { ordinal, selector } = selection;
			const root = document.querySelector(selector);
			const canvas = document.querySelector(
				".easymde-immersive-preview-canvas",
			);
			if (!(root instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-source-h3-root-unavailable");
			}
			if (!(canvas instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-source-h3-canvas-unavailable");
			}
			const h3s = [...root.querySelectorAll("h3")];
			const h3 = h3s[ordinal - 1];
			if (!(h3 instanceof HTMLElement)) {
				throw new Error("wechat-copy-candidate-source-h3-sample-unavailable");
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
			const finiteLength = (value, code) => {
				const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(value.trim());
				if (!match) throw new Error(code);
				const parsed = Number(match[1]);
				if (!Number.isFinite(parsed)) throw new Error(code);
				return parsed;
			};
			const cssLength = (value, code) => {
				const normalized = value.trim();
				const keywordValues = ["auto", "none", "normal"];
				if (keywordValues.includes(normalized)) {
					return { kind: "keyword", value: normalized };
				}
				const match =
					/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%|em|rem|vw|vh|vmin|vmax|ch|ex)$/u.exec(
						normalized,
					);
				if (!match) throw new Error(code);
				return {
					kind: "length",
					unit: match[2],
					value: Number(match[1]),
				};
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
			const transformKind = (value) => {
				if (value === "none") return "none";
				if (value.startsWith("matrix3d(")) return "matrix3d";
				if (value.startsWith("matrix(")) return "matrix";
				return "other";
			};
			const rootRect = finiteRect(
				root,
				"wechat-copy-candidate-source-h3-root-geometry-invalid",
			);
			const rootStyle = getComputedStyle(root);
			const rootPadding = {
				bottom: finiteLength(
					rootStyle.paddingBottom,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
				left: finiteLength(
					rootStyle.paddingLeft,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
				right: finiteLength(
					rootStyle.paddingRight,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
				top: finiteLength(
					rootStyle.paddingTop,
					"wechat-copy-candidate-source-h3-root-padding-invalid",
				),
			};
			const rootContentOrigin = {
				left:
					rootRect.left +
					finiteLength(
						rootStyle.borderLeftWidth,
						"wechat-copy-candidate-source-h3-root-border-invalid",
					) +
					rootPadding.left,
				top:
					rootRect.top +
					finiteLength(
						rootStyle.borderTopWidth,
						"wechat-copy-candidate-source-h3-root-border-invalid",
					) +
					rootPadding.top,
			};
			const beforeStyle = getComputedStyle(h3, "::before");
			const beforeBackgroundAlpha = alpha(beforeStyle.backgroundColor);
			const before = {
				backgroundAlpha: beforeBackgroundAlpha,
				height: cssLength(
					beforeStyle.height,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
				left: cssLength(
					beforeStyle.left,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
				top: cssLength(
					beforeStyle.top,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
				measurement: "computed-style-only",
				transform: transformKind(beforeStyle.transform),
				width: cssLength(
					beforeStyle.width,
					"wechat-copy-candidate-source-h3-before-geometry-invalid",
				),
			};
			if (!Number.isFinite(beforeBackgroundAlpha)) {
				throw new Error("wechat-copy-candidate-source-h3-before-alpha-invalid");
			}
			const range = document.createRange();
			range.selectNodeContents(h3);
			const textRange = finiteRect(
				range,
				"wechat-copy-candidate-source-h3-text-range-invalid",
			);
			const canvasRect = finiteRect(
				canvas,
				"wechat-copy-candidate-source-h3-canvas-geometry-invalid",
			);
			const h3Rect = finiteRect(
				h3,
				"wechat-copy-candidate-source-h3-geometry-invalid",
			);
			const visibleWidth =
				Math.min(
					h3Rect.left + h3Rect.width,
					canvasRect.left + canvasRect.width,
				) - Math.max(h3Rect.left, canvasRect.left);
			const visibleHeight =
				Math.min(
					h3Rect.top + h3Rect.height,
					canvasRect.top + canvasRect.height,
				) - Math.max(h3Rect.top, canvasRect.top);
			if (
				!Number.isFinite(visibleWidth) ||
				!Number.isFinite(visibleHeight) ||
				visibleWidth <= 0 ||
				visibleHeight <= 0
			) {
				throw new Error("wechat-copy-candidate-source-h3-not-visible");
			}
			return {
				before,
				h3Count: h3s.length,
				h3Rect,
				ordinal,
				rootContentOrigin,
				rootPadding,
				status: "available",
				textRangeKind: "h3-contents-range",
				textRange,
				viewportIntersection: { height: visibleHeight, width: visibleWidth },
			};
		},
		{ ordinal, selector: previewSelector },
	);
}

export async function startCandidateSourceDiagnostic(page) {
	await page.evaluate(() => {
		const nativeSource = document.querySelector("#easymde-source");
		const cmContent = document.querySelector(
			".easymde-source-react .cm-content",
		);
		const cmScroller = document.querySelector(
			".easymde-source-react .cm-scroller",
		);
		const previewCanvas = document.querySelector(
			".easymde-immersive-preview-canvas",
		);
		const preview = document.querySelector(
			'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
		);
		const metadataFields = [
			...document.querySelectorAll(
				"#easymde-enabled-field,#easymde-markdown-theme-field," +
					"#easymde-code-theme-field,#easymde-code-theme-explicit-field",
			),
		];
		if (
			!(nativeSource instanceof HTMLElement) ||
			!(cmContent instanceof HTMLElement) ||
			!(cmScroller instanceof HTMLElement) ||
			!(previewCanvas instanceof HTMLElement) ||
			!(preview instanceof HTMLElement) ||
			metadataFields.length !== 4 ||
			metadataFields.some((field) => !(field instanceof HTMLElement))
		) {
			throw new Error(
				"wechat-copy-candidate-source-diagnostic-target-unavailable",
			);
		}
		const mutationTypeNames = ["attributes", "characterData", "childList"];
		const eventTypeNames = ["input", "beforeinput", "change"];
		const makeMutationBucket = (fixedType) => ({
			addedNodes: 0,
			cmLineGapBuckets: {
				0: 0,
				"1-3": 0,
				"4-15": 0,
				"16-plus": 0,
				unavailable: 0,
			},
			fixedType,
			mutationTypeCounts: {
				attributes: 0,
				characterData: 0,
				childList: 0,
				other: 0,
			},
			removedNodes: 0,
			total: 0,
		});
		const makeEventBucket = () => ({
			beforeinput: 0,
			change: 0,
			input: 0,
		});
		const state = {
			events: {
				cmPresentation: makeEventBucket(),
				nativeSubmission: makeEventBucket(),
			},
			mutations: {
				cmPresentation: makeMutationBucket("cm-presentation"),
				metadata: makeMutationBucket("metadata"),
				nativeSubmission: makeMutationBucket("native-submission"),
				preview: makeMutationBucket("preview"),
			},
		};
		const observers = [];
		const listeners = [];
		const bucketFor = (owner) => state.mutations[owner];
		const cmLineGapBucket = () => {
			const lineRects = [...cmContent.querySelectorAll(".cm-line")]
				.map((line) => line.getBoundingClientRect())
				.filter(
					(rect) =>
						Number.isFinite(rect.top) &&
						Number.isFinite(rect.height) &&
						rect.height > 0,
				)
				.sort((left, right) => left.top - right.top);
			if (lineRects.length < 2) return "unavailable";
			const lineHeight = lineRects[0].height;
			let maximumGap = 0;
			for (let index = 1; index < lineRects.length; index += 1) {
				const gap = Math.max(
					0,
					Math.round(
						(lineRects[index].top - lineRects[index - 1].top) / lineHeight,
					) - 1,
				);
				maximumGap = Math.max(maximumGap, gap);
			}
			if (maximumGap === 0) return "0";
			if (maximumGap <= 3) return "1-3";
			if (maximumGap <= 15) return "4-15";
			return "16-plus";
		};
		const collectRecords = (owner, records) => {
			const bucket = bucketFor(owner);
			for (const record of records) {
				const mutationType = mutationTypeNames.includes(record.type)
					? record.type
					: "other";
				bucket.mutationTypeCounts[mutationType] += 1;
				bucket.total += 1;
				bucket.addedNodes += record.addedNodes?.length ?? 0;
				bucket.removedNodes += record.removedNodes?.length ?? 0;
				if (owner === "cmPresentation") {
					const gapBucket =
						record.type === "childList" ? cmLineGapBucket() : "unavailable";
					bucket.cmLineGapBuckets[gapBucket] += 1;
				}
			}
		};
		const watch = (node, owner) => {
			const observer = new MutationObserver((records) =>
				collectRecords(owner, records),
			);
			observer.observe(node, {
				attributes: true,
				characterData: true,
				childList: true,
				subtree: true,
			});
			observers.push({ observer, owner });
		};
		watch(nativeSource, "nativeSubmission");
		watch(cmContent, "cmPresentation");
		watch(preview, "preview");
		for (const field of metadataFields) watch(field, "metadata");
		const watchEvents = (node, owner) => {
			for (const type of eventTypeNames) {
				const listener = () => {
					state.events[owner][type] += 1;
				};
				node.addEventListener(type, listener, {
					capture: true,
					passive: true,
				});
				listeners.push({ listener, node, type });
			}
		};
		watchEvents(nativeSource, "nativeSubmission");
		watchEvents(cmContent, "cmPresentation");
		const consumePending = () => {
			for (const { observer, owner } of observers) {
				collectRecords(owner, observer.takeRecords());
			}
		};
		const readScroller = (element) => ({
			clientHeight: element.clientHeight,
			clientWidth: element.clientWidth,
			scrollHeight: element.scrollHeight,
			scrollLeft: element.scrollLeft,
			scrollTop: element.scrollTop,
			scrollWidth: element.scrollWidth,
		});
		const read = () => {
			consumePending();
			const scrollers = {
				cm: readScroller(cmScroller),
				preview: readScroller(previewCanvas),
			};
			if (
				Object.values(scrollers).some((scroller) =>
					Object.values(scroller).some((value) => !Number.isFinite(value)),
				)
			) {
				throw new Error(
					"wechat-copy-candidate-source-diagnostic-scroller-invalid",
				);
			}
			return {
				events: {
					cmPresentation: { ...state.events.cmPresentation },
					nativeSubmission: { ...state.events.nativeSubmission },
				},
				mutations: {
					cmPresentation: {
						...state.mutations.cmPresentation,
						cmLineGapBuckets: {
							...state.mutations.cmPresentation.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.cmPresentation.mutationTypeCounts,
						},
					},
					nativeSubmission: {
						...state.mutations.nativeSubmission,
						cmLineGapBuckets: {
							...state.mutations.nativeSubmission.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.nativeSubmission.mutationTypeCounts,
						},
					},
					metadata: {
						...state.mutations.metadata,
						cmLineGapBuckets: {
							...state.mutations.metadata.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.metadata.mutationTypeCounts,
						},
					},
					preview: {
						...state.mutations.preview,
						cmLineGapBuckets: {
							...state.mutations.preview.cmLineGapBuckets,
						},
						mutationTypeCounts: {
							...state.mutations.preview.mutationTypeCounts,
						},
					},
				},
				cmLineCount: cmContent.querySelectorAll(".cm-line").length,
				scrollers,
				window: {
					left: window.scrollX,
					top: window.scrollY,
				},
			};
		};
		globalThis.__easymdeWechatCopySourceDiagnostic = {
			read,
			stop() {
				consumePending();
				for (const { observer } of observers) observer.disconnect();
				for (const { listener, node, type } of listeners) {
					node.removeEventListener(type, listener, { capture: true });
				}
				delete globalThis.__easymdeWechatCopySourceDiagnostic;
			},
		};
	});
}

export async function readCandidateSourceDiagnostic(page) {
	return page.evaluate(() => {
		const diagnostic = globalThis.__easymdeWechatCopySourceDiagnostic;
		if (!diagnostic)
			throw new Error("wechat-copy-candidate-source-diagnostic-unavailable");
		return diagnostic.read();
	});
}

export async function stopCandidateSourceDiagnostic(page) {
	await page.evaluate(() =>
		globalThis.__easymdeWechatCopySourceDiagnostic?.stop(),
	);
}

export async function readCandidateSourcePhase(page, phase) {
	const fingerprint = await readCandidateSourceFingerprint(page);
	const diagnostic = await readCandidateSourceDiagnostic(page);
	return { diagnostic, fingerprint, phase };
}

export function candidateMutationDelta(before, after, owner) {
	const beforeTotal = before?.mutations?.[owner]?.total;
	const afterTotal = after?.mutations?.[owner]?.total;
	if (
		!Number.isSafeInteger(beforeTotal) ||
		!Number.isSafeInteger(afterTotal) ||
		afterTotal < beforeTotal
	) {
		throw new Error("wechat-copy-candidate-source-diagnostic-nonmonotonic");
	}
	return afterTotal - beforeTotal;
}

export function assertCandidateCopyCMDelta(before, after) {
	const delta = candidateMutationDelta(before, after, "cmPresentation");
	if (delta !== 0) {
		throw new Error("wechat-copy-candidate-late-cm-mutation");
	}
	return delta;
}

export function assertCandidateRestorePeer(diagnostic, expected) {
	if (
		diagnostic?.scrollers?.cm?.scrollLeft !== expected?.cmLeft ||
		diagnostic?.scrollers?.cm?.scrollTop !== expected?.cmTop ||
		diagnostic?.scrollers?.preview?.scrollLeft !== expected?.previewLeft ||
		diagnostic?.scrollers?.preview?.scrollTop !== expected?.previewTop ||
		diagnostic?.window?.left !== expected?.windowLeft ||
		diagnostic?.window?.top !== expected?.windowTop
	) {
		throw new Error("wechat-copy-candidate-source-restore-peer-mismatch");
	}
}

export async function restoreCandidateSourceDiagnosticScroll(page, diagnostic) {
	const expected = {
		cmLeft: diagnostic?.scrollers?.cm?.scrollLeft,
		cmTop: diagnostic?.scrollers?.cm?.scrollTop,
		previewLeft: diagnostic?.scrollers?.preview?.scrollLeft,
		previewTop: diagnostic?.scrollers?.preview?.scrollTop,
		windowLeft: diagnostic?.window?.left,
		windowTop: diagnostic?.window?.top,
	};
	if (Object.values(expected).some((value) => !Number.isFinite(value))) {
		throw new Error("wechat-copy-candidate-source-scroll-baseline-invalid");
	}
	await page.evaluate((expected) => {
		const cm = document.querySelector(".easymde-source-react .cm-scroller");
		const preview = document.querySelector(".easymde-immersive-preview-canvas");
		if (!(cm instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
			throw new Error("wechat-copy-candidate-source-scroll-owner-unavailable");
		}
		cm.scrollLeft = expected.cmLeft;
		cm.scrollTop = expected.cmTop;
		preview.scrollLeft = expected.previewLeft;
		preview.scrollTop = expected.previewTop;
		window.scrollTo(expected.windowLeft, expected.windowTop);
	}, expected);
	const restored = await readCandidateSourceDiagnostic(page);
	assertCandidateRestorePeer(restored, expected);
	return { expected, restored };
}

export function assertCandidateSourceTaskFingerprints(tasks, expected) {
	if (!Array.isArray(tasks) || tasks.length !== 19) {
		throw new Error(
			"wechat-copy-candidate-source-task-fingerprint-count-invalid",
		);
	}
	const expectedSerialized = JSON.stringify(expected);
	for (const task of tasks) {
		if (JSON.stringify(task?.fingerprint) !== expectedSerialized) {
			throw new Error("wechat-copy-candidate-source-task-fingerprint-changed");
		}
	}
}

export function assertCandidateSourceFingerprintEqual(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error("wechat-copy-candidate-source-fingerprint-changed");
	}
}

export function assertCandidateSourceBaseline(diagnostic) {
	for (const owner of ["nativeSubmission", "metadata", "preview"]) {
		if (diagnostic?.mutations?.[owner]?.total !== 0) {
			const codeOwner =
				owner === "nativeSubmission" ? "native-submission" : owner;
			throw new Error(`wechat-copy-candidate-${codeOwner}-mutation-detected`);
		}
	}
	for (const owner of ["nativeSubmission", "cmPresentation"]) {
		const events = diagnostic?.events?.[owner];
		if (!events || Object.values(events).some((count) => count !== 0)) {
			throw new Error("wechat-copy-candidate-source-input-event-detected");
		}
	}
}

export async function waitForCandidateSourceStability(page, expected) {
	return page.evaluate(async (expected) => {
		const diagnostic = globalThis.__easymdeWechatCopySourceDiagnostic;
		if (!diagnostic) {
			throw new Error("wechat-copy-candidate-source-diagnostic-unavailable");
		}
		const frameLimit = 12;
		const requiredStableFrames = 3;
		const frames = [];
		let previous = null;
		let stableFrames = 0;
		const positionsEqual = (left, right) =>
			left.cmLeft === right.cmLeft &&
			left.cmTop === right.cmTop &&
			left.previewLeft === right.previewLeft &&
			left.previewTop === right.previewTop &&
			left.windowLeft === right.windowLeft &&
			left.windowTop === right.windowTop;
		const positionsMatchExpected = (positions) =>
			positions.cmLeft === expected.cmLeft &&
			positions.cmTop === expected.cmTop &&
			positions.previewLeft === expected.previewLeft &&
			positions.previewTop === expected.previewTop &&
			positions.windowLeft === expected.windowLeft &&
			positions.windowTop === expected.windowTop;
		for (let frame = 0; frame < frameLimit; frame += 1) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const sample = diagnostic.read();
			const positions = {
				cmLeft: sample.scrollers.cm.scrollLeft,
				cmTop: sample.scrollers.cm.scrollTop,
				previewLeft: sample.scrollers.preview.scrollLeft,
				previewTop: sample.scrollers.preview.scrollTop,
				windowLeft: sample.window.left,
				windowTop: sample.window.top,
			};
			if (
				Object.values(positions).some((value) => !Number.isFinite(value)) ||
				!Number.isSafeInteger(sample.cmLineCount) ||
				!Number.isSafeInteger(sample.mutations.cmPresentation.total) ||
				!positionsMatchExpected(positions)
			) {
				throw new Error(
					"wechat-copy-candidate-source-stability-position-invalid",
				);
			}
			const current = {
				cmLineCount: sample.cmLineCount,
				cmPresentationTotal: sample.mutations.cmPresentation.total,
				positions,
			};
			if (
				previous &&
				previous.cmLineCount === current.cmLineCount &&
				previous.cmPresentationTotal === current.cmPresentationTotal &&
				positionsEqual(previous.positions, current.positions)
			) {
				stableFrames += 1;
			} else {
				stableFrames = 1;
			}
			frames.push({ frame, ...current });
			previous = current;
			if (stableFrames >= requiredStableFrames) {
				return {
					frames: frames.slice(-requiredStableFrames),
					stableFrames,
				};
			}
		}
		throw new Error("wechat-copy-candidate-source-stability-timeout");
	}, expected);
}
