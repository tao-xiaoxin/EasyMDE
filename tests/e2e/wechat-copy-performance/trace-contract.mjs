
export const copyTimingStages = new Map([
	["easymde.wechat.copy.candidate.capture", "copy-candidate-capture"],
	["easymde.wechat.copy.candidate.geometry", "copy-candidate-geometry"],
	[
		"easymde.wechat.copy.candidate.rasterization",
		"copy-candidate-rasterization",
	],
	["easymde.wechat.copy.connected-plain-text", "copy-connected-plain-text"],
	["easymde.wechat.copy.final-geometry", "copy-final-geometry"],
	["easymde.wechat.copy.final-raw-context-refresh", "copy-final-raw-context"],
	["easymde.wechat.copy.final-source-freshness", "copy-final-source-freshness"],
	["easymde.wechat.copy.finalize-markup", "copy-finalize-markup"],
	["easymde.wechat.copy.outer-html", "copy-outer-html"],
	["easymde.wechat.copy.replacement", "copy-replacement"],
	["easymde.wechat.rasterizer.canvas-draw-encode", "rasterizer-canvas-encode"],
	["easymde.wechat.rasterizer.decode-wait", "rasterizer-decode-wait"],
	["easymde.wechat.rasterizer.digest-wait", "rasterizer-digest-wait"],
	["easymde.wechat.rasterizer.file", "rasterizer-file"],
	["easymde.wechat.rasterizer.geometry-cleanup", "rasterizer-geometry-cleanup"],
	["easymde.wechat.rasterizer.serialize-svg", "rasterizer-serialize-svg"],
	["easymde.wechat.rasterizer.uri-generation", "rasterizer-uri-generation"],
]);

export const timingDetailModes = new Set(["async", "sync"]);
export const timingDetailTerminals = new Set(["error", "success"]);
export const timingDetailKinds = new Set(["math", "mermaid"]);
export const genericTraceStageByName = new Map([
	["RunTask", "main-task"],
	["ThreadControllerImpl::RunTask", "main-task"],
	["RecalculateStyles", "main-style"],
	["UpdateLayoutTree", "main-layout"],
	["Layout", "main-layout"],
	["LayoutInvalidationTracking", "main-layout"],
	["PrePaint", "main-paint"],
	["Paint", "main-paint"],
	["UpdateLayerTree", "main-paint"],
	["CompositeLayers", "main-composite"],
]);
export const traceBeginMarker = "easymde.wechat.performance.begin";
export const traceClickMarker = "easymde.wechat.performance.click";
export const traceEndMarker = "easymde.wechat.performance.end";
export const uploadPathSuffix = "/image-hosting/upload";
