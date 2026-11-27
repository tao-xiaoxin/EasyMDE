import {
	copyTimingStages,
	timingDetailKinds,
	timingDetailModes,
	timingDetailOwners,
	timingDetailTerminals,
	traceBeginMarker,
	traceClickMarker,
	traceEndMarker,
} from "./trace-contract.mjs";

export function installPerformanceProbe(page) {
	return page.addInitScript(
		({
			beginMarker,
			clickMarker,
			copyTimingStageEntries,
			endMarker,
			timingDetailKindValues,
			timingDetailModeValues,
			timingDetailOwnerValues = [],
			timingDetailTerminalValues,
		}) => {
			const copyTimingStages = new Map(copyTimingStageEntries);
			const timingDetailModes = new Set(timingDetailModeValues);
			const timingDetailOwners = new Set(timingDetailOwnerValues);
			const timingDetailTerminals = new Set(timingDetailTerminalValues);
			const timingDetailKinds = new Set(timingDetailKindValues);
			const copyOwner = (target) => {
				if (!(target instanceof Element)) return null;
				const ordinary = target.closest(".easymde-toolbar-copy-action");
				if (ordinary instanceof HTMLElement) {
					return { element: ordinary, surface: "ordinary" };
				}
				const immersive = target.closest(".easymde-immersive-wechat");
				if (immersive instanceof HTMLElement) {
					return { element: immersive, surface: "immersive" };
				}
				return null;
			};
			const capturePreviewReadiness = () => {
				const preview = document.querySelector(
					'.easymde-pane-preview [data-easymde-preview-html-sink="1"]',
				);
				const previewAvailable = preview instanceof HTMLElement;
				const images = previewAvailable
					? [...preview.querySelectorAll("img")]
					: [];
				const completeImageCount = images.filter(
					(image) => image.complete,
				).length;
				const intrinsicImageCount = images.filter(
					(image) =>
						Number.isFinite(image.naturalWidth) && image.naturalWidth > 0,
				).length;
				return {
					completeImageCount,
					fontsReady: document.fonts?.status === "loaded",
					imageCount: images.length,
					imagesReady:
						previewAvailable &&
						images.length > 0 &&
						completeImageCount === images.length &&
						intrinsicImageCount === images.length,
					intrinsicImageCount,
					previewAccepted:
						previewAvailable &&
						preview.getAttribute("data-easymde-preview-accepted") === "1",
					previewAvailable,
					previewBusy:
						previewAvailable && preview.getAttribute("aria-busy") === "true",
					previewError:
						previewAvailable &&
						preview.getAttribute("data-easymde-preview-error") === "1",
					previewRefreshing:
						previewAvailable &&
						preview.getAttribute("data-easymde-preview-refreshing") === "1",
				};
			};
			const state = {
				active: false,
				clickAt: null,
				clickCountAtStart: 0,
				clicks: [],
				endAt: null,
				longTasks: [],
				measures: [],
				observerError: null,
				ownerChanges: [],
				rafs: [],
				status: [],
				statusSuccessAt: null,
				writes: [],
				writeCountAtStart: 0,
			};
			let nativeWrite = null;
			let originalWriteDescriptor = null;
			let clipboard = null;
			let measureObserver = null;
			let longTaskObserver = null;
			let statusObserver = null;
			let listenersInstalled = false;
			let handleClick = null;
			let handleVisibilityChange = null;
			let handleFocus = null;
			let handleBlur = null;
			let handleDomContentLoaded = null;
			let lastStatus = "";
			let earlyPhasePromise = Promise.resolve();
			let earlyPhaseResolve = null;

			const finite = (value) => Number.isFinite(value) && value >= 0;
			const captureOwner = (target = null) => {
				const ownerDocument = target?.ownerDocument ?? document;
				let topMatchesSelf = false;
				try {
					topMatchesSelf = window.top === window.self;
				} catch {
					state.observerError ??=
						"wechat-copy-performance-top-owner-unavailable";
				}
				return {
					activeElementIsTarget:
						target instanceof Element && document.activeElement === target,
					defaultViewMatches: ownerDocument.defaultView === window,
					documentHasFocus: document.hasFocus(),
					ownerDocumentMatches: ownerDocument === document,
					readiness: capturePreviewReadiness(),
					selfMatchesWindow: window.self === window,
					topMatchesSelf,
					visibilityState: document.visibilityState,
				};
			};
			const observeMeasureEntries = (entries) => {
				for (const entry of entries) {
					if (entry.entryType !== "measure") continue;
					if (!copyTimingStages.has(entry.name)) continue;
					if (!finite(entry.startTime) || !finite(entry.duration)) {
						state.observerError ??=
							"wechat-copy-performance-measure-timing-invalid";
						continue;
					}
					const detail = entry.detail;
					if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-invalid";
						continue;
					}
					const keys = Reflect.ownKeys(detail);
					const allowedKeys = [
						"candidate",
						"hidden",
						"kind",
						"mode",
						"owner",
						"pairs",
						"terminal",
					];
					if (
						keys.some(
							(key) => typeof key !== "string" || !allowedKeys.includes(key),
						)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-keys-invalid";
						continue;
					}
					const hasDetailKey = (key) => Object.hasOwn(detail, key);
					if (
						!hasDetailKey("mode") ||
						!timingDetailModes.has(detail.mode) ||
						!hasDetailKey("terminal") ||
						!timingDetailTerminals.has(detail.terminal)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-enum-invalid";
						continue;
					}
					if (hasDetailKey("kind") && !timingDetailKinds.has(detail.kind)) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-kind-invalid";
						continue;
					}
					if (
						hasDetailKey("candidate") &&
						(!Number.isInteger(detail.candidate) ||
							detail.candidate < 0 ||
							detail.candidate > 31)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-candidate-invalid";
						continue;
					}
					if (hasDetailKey("hidden") && typeof detail.hidden !== "boolean") {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-hidden-invalid";
						continue;
					}
					if (hasDetailKey("owner") && !timingDetailOwners.has(detail.owner)) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-owner-invalid";
						continue;
					}
					if (
						hasDetailKey("pairs") &&
						(!Number.isInteger(detail.pairs) || detail.pairs < 0)
					) {
						state.observerError ??=
							"wechat-copy-performance-measure-detail-pairs-invalid";
						continue;
					}
					state.measures.push({
						detail: {
							...(hasDetailKey("candidate")
								? { candidate: detail.candidate }
								: {}),
							...(hasDetailKey("hidden") ? { hidden: detail.hidden } : {}),
							...(hasDetailKey("kind") ? { kind: detail.kind } : {}),
							mode: detail.mode,
							...(hasDetailKey("owner") ? { owner: detail.owner } : {}),
							...(hasDetailKey("pairs") ? { pairs: detail.pairs } : {}),
							terminal: detail.terminal,
						},
						durationMs: entry.duration,
						name: entry.name,
						startMs: entry.startTime,
					});
				}
			};
			const observeLongTaskEntries = (entries) => {
				for (const entry of entries) {
					if (!finite(entry.startTime) || !finite(entry.duration)) {
						state.observerError ??=
							"wechat-copy-performance-longtask-timing-invalid";
						continue;
					}
					state.longTasks.push({
						durationMs: entry.duration,
						startMs: entry.startTime,
					});
				}
			};
			const drainObservers = () => {
				if (measureObserver)
					observeMeasureEntries(measureObserver.takeRecords());
				if (longTaskObserver)
					observeLongTaskEntries(longTaskObserver.takeRecords());
			};
			const emitOwnerChange = (stage) => {
				if (!state.active) return;
				const at = performance.now();
				if (!finite(at)) {
					state.observerError ??=
						"wechat-copy-performance-owner-change-timing-invalid";
					return;
				}
				state.ownerChanges.push({ at, state: captureOwner(), type: stage });
			};
			const observeStatus = () => {
				if (!state.active) return;
				const node = document.querySelector(
					'.easymde-editor > .easymde-editor-message-alert-host [role="status"],' +
						' .easymde-editor > .easymde-editor-message-alert-host [role="alert"]',
				);
				if (!(node instanceof HTMLElement)) return;
				const bootstrap = window.EasyMDEEditorRootBootstrap;
				const success = bootstrap?.wechatExport?.strings?.success;
				const failed = bootstrap?.wechatExport?.strings?.failed;
				const failedWithUploads =
					bootstrap?.wechatExport?.strings?.failedWithUploads;
				const unsupported = bootstrap?.wechatExport?.strings?.unsupported;
				const text = node.textContent ?? "";
				const code =
					text === success
						? "success"
						: text === failed ||
								text === failedWithUploads ||
								text === unsupported
							? "failed"
							: "other";
				const role = node.getAttribute("role") ?? "unknown";
				const key = `${role}:${code}`;
				if (key === lastStatus) return;
				lastStatus = key;
				const at = performance.now();
				state.status.push({ at, code });
				if (code === "success" && state.statusSuccessAt === null) {
					state.statusSuccessAt = at;
					state.endAt = at;
					performance.mark(endMarker);
				}
			};
			const scheduleEarlyPhases = () => {
				earlyPhasePromise = new Promise((resolve) => {
					earlyPhaseResolve = resolve;
				});
				let rafCount = 0;
				const nextRaf = () => {
					rafCount += 1;
					state.rafs.push({ at: performance.now(), index: rafCount });
					if (rafCount < 3) {
						requestAnimationFrame(nextRaf);
					} else if (earlyPhaseResolve) {
						earlyPhaseResolve();
						earlyPhaseResolve = null;
					}
				};
				requestAnimationFrame(nextRaf);
				setTimeout(() => {
					state.rafs.push({ at: performance.now(), index: 0 });
					if (rafCount >= 3 && earlyPhaseResolve) {
						earlyPhaseResolve();
						earlyPhaseResolve = null;
					}
				}, 0);
			};
			const attachStatusObserver = () => {
				if (statusObserver || !document.documentElement) return;
				statusObserver = new MutationObserver(observeStatus);
				statusObserver.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["class", "role"],
					characterData: true,
					childList: true,
					subtree: true,
				});
			};
			const install = () => {
				const supported = PerformanceObserver.supportedEntryTypes ?? [];
				if (!supported.includes("measure") || !supported.includes("longtask")) {
					state.observerError =
						"wechat-copy-performance-observer-type-unavailable";
				} else {
					try {
						measureObserver = new PerformanceObserver((list) =>
							observeMeasureEntries(list.getEntries()),
						);
						measureObserver.observe({ buffered: true, type: "measure" });
						longTaskObserver = new PerformanceObserver((list) =>
							observeLongTaskEntries(list.getEntries()),
						);
						longTaskObserver.observe({ buffered: true, type: "longtask" });
					} catch {
						state.observerError =
							"wechat-copy-performance-observer-install-failed";
					}
				}
				clipboard = navigator.clipboard;
				nativeWrite = clipboard?.write?.bind(clipboard) ?? null;
				if (!clipboard || !nativeWrite) {
					state.observerError ??=
						"wechat-copy-performance-native-clipboard-unavailable";
				} else {
					originalWriteDescriptor = Object.getOwnPropertyDescriptor(
						clipboard,
						"write",
					);
					Object.defineProperty(clipboard, "write", {
						configurable: true,
						enumerable: originalWriteDescriptor?.enumerable ?? false,
						writable: true,
						value: (items) => {
							const at = performance.now();
							const target = state.clicks.at(-1)?.target ?? null;
							const surface = state.clicks.at(-1)?.surface ?? null;
							const record = {
								activation: navigator.userActivation?.isActive === true,
								at,
								owner: captureOwner(target),
								surface,
								itemCount: Array.isArray(items) ? items.length : null,
								nativeState: "pending",
								settledAt: null,
							};
							state.writes.push(record);
							const result = nativeWrite(items);
							Promise.resolve(result).then(
								() => {
									record.nativeState = "fulfilled";
									record.settledAt = performance.now();
								},
								() => {
									record.nativeState = "rejected";
									record.settledAt = performance.now();
								},
							);
							return result;
						},
					});
				}
				handleClick = (event) => {
					if (!state.active) return;
					const target = copyOwner(event.target);
					if (!target) return;
					const at = performance.now();
					if (!finite(at)) {
						state.observerError ??=
							"wechat-copy-performance-click-timing-invalid";
						return;
					}
					if (state.clickAt === null) {
						state.clickAt = at;
						performance.mark(clickMarker);
						scheduleEarlyPhases();
					}
					state.clicks.push({
						at,
						owner: captureOwner(target.element),
						surface: target.surface,
						target: target.element,
					});
				};
				handleVisibilityChange = () => emitOwnerChange("visibilitychange");
				handleFocus = () => emitOwnerChange("focus");
				handleBlur = () => emitOwnerChange("blur");
				document.addEventListener("click", handleClick, true);
				document.addEventListener("visibilitychange", handleVisibilityChange);
				window.addEventListener("focus", handleFocus);
				window.addEventListener("blur", handleBlur);
				listenersInstalled = true;
				if (document.documentElement) {
					attachStatusObserver();
				} else {
					handleDomContentLoaded = () => {
						attachStatusObserver();
						observeStatus();
					};
					document.addEventListener(
						"DOMContentLoaded",
						handleDomContentLoaded,
						{
							once: true,
						},
					);
				}
			};
			install();

			globalThis.__easymdeWechatCopyPerformance = {
				async awaitEarlyPhases() {
					await earlyPhasePromise;
				},
				begin() {
					if (state.observerError) throw new Error(state.observerError);
					if (state.active)
						throw new Error("wechat-copy-performance-probe-already-active");
					state.active = true;
					state.clickAt = null;
					state.clicks = [];
					state.ownerChanges = [];
					state.rafs = [];
					state.status = [];
					state.statusSuccessAt = null;
					state.writes = [];
					state.clickCountAtStart = 0;
					state.writeCountAtStart = 0;
					performance.mark(beginMarker);
				},
				getState() {
					return {
						clickAt: state.clickAt,
						clickCount: state.clicks.length,
						endAt: state.endAt,
						observerError: state.observerError,
						ownerChanges: state.ownerChanges.map(
							({ at, state: ownerState, type }) => ({
								at,
								state: ownerState,
								type,
							}),
						),
						rafs: state.rafs.slice(),
						status: state.status.slice(),
						statusSuccessAt: state.statusSuccessAt,
						writeCount: state.writes.length,
						writes: state.writes.map((write) => ({ ...write })),
					};
				},
				end() {
					drainObservers();
					const endAt = performance.now();
					if (!finite(endAt))
						throw new Error("wechat-copy-performance-end-timing-invalid");
					state.endAt ??= endAt;
					if (state.statusSuccessAt === null) performance.mark(endMarker);
					state.active = false;
					return {
						clickAt: state.clickAt,
						clicks: state.clicks.map(({ at, owner, surface }) => ({
							at,
							owner,
							surface,
						})),
						endAt: state.endAt,
						longTasks: state.longTasks.slice(),
						measures: state.measures.slice(),
						observerError: state.observerError,
						ownerChanges: state.ownerChanges.map(
							({ at, state: ownerState, type }) => ({
								at,
								state: ownerState,
								type,
							}),
						),
						rafs: state.rafs.slice(),
						status: state.status.slice(),
						statusSuccessAt: state.statusSuccessAt,
						writes: state.writes.map((write) => ({ ...write })),
					};
				},
				stop() {
					drainObservers();
					state.active = false;
					if (measureObserver) measureObserver.disconnect();
					if (longTaskObserver) longTaskObserver.disconnect();
					if (statusObserver) statusObserver.disconnect();
					if (handleClick)
						document.removeEventListener("click", handleClick, true);
					if (handleVisibilityChange) {
						document.removeEventListener(
							"visibilitychange",
							handleVisibilityChange,
						);
					}
					if (handleFocus) window.removeEventListener("focus", handleFocus);
					if (handleBlur) window.removeEventListener("blur", handleBlur);
					if (handleDomContentLoaded) {
						document.removeEventListener(
							"DOMContentLoaded",
							handleDomContentLoaded,
						);
					}
					if (clipboard && nativeWrite) {
						if (originalWriteDescriptor) {
							Object.defineProperty(
								clipboard,
								"write",
								originalWriteDescriptor,
							);
						} else {
							delete clipboard.write;
						}
					}
					if (listenersInstalled) listenersInstalled = false;
					if (typeof performance.clearMarks === "function") {
						performance.clearMarks(beginMarker);
						performance.clearMarks(clickMarker);
						performance.clearMarks(endMarker);
					}
				},
			};
		},
		{
			beginMarker: traceBeginMarker,
			clickMarker: traceClickMarker,
			copyTimingStageEntries: [...copyTimingStages.entries()],
			endMarker: traceEndMarker,
			timingDetailKindValues: [...timingDetailKinds],
			timingDetailModeValues: [...timingDetailModes],
			timingDetailOwnerValues: [...timingDetailOwners],
			timingDetailTerminalValues: [...timingDetailTerminals],
		},
	);
}
