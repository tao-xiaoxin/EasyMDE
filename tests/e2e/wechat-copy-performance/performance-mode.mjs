
export const performanceModeEnvironment = "EASYMDE_E2E_PERFORMANCE_MODE";
export const performanceModeDefinitions = Object.freeze({
	immersivePreview: Object.freeze({
		immersive: true,
		immersiveMode: "preview",
	}),
	immersiveSource: Object.freeze({
		immersive: true,
		immersiveMode: "source",
	}),
	immersiveSplit: Object.freeze({
		immersive: true,
		immersiveMode: "split",
	}),
	ordinarySplit: Object.freeze({
		immersive: false,
		immersiveMode: null,
	}),
});
export const performanceModeExpectations = Object.freeze({
	immersivePreview: Object.freeze({
		previewPresentation: "preview",
		previewVisible: true,
		sourceVisible: false,
	}),
	immersiveSource: Object.freeze({
		previewPresentation: "split",
		previewVisible: false,
		sourceVisible: true,
	}),
	immersiveSplit: Object.freeze({
		previewPresentation: "split",
		previewVisible: true,
		sourceVisible: true,
	}),
	ordinarySplit: Object.freeze({
		previewPresentation: "split",
		previewVisible: true,
		sourceVisible: true,
	}),
});

export function selectedPerformanceMode() {
	const configured = process.env[performanceModeEnvironment]?.trim();
	const mode = configured || "ordinarySplit";
	if (!Object.hasOwn(performanceModeDefinitions, mode)) {
		throw new Error("wechat-copy-performance-mode-invalid");
	}
	return mode;
}

export const configuredPerformanceMode = selectedPerformanceMode();
