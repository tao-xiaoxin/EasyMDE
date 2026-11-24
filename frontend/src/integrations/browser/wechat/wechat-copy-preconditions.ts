import type { WechatClipboardCopyOptions } from "../../../contracts/ports/wechat-clipboard-port";

export const REFRESH_ONLY_PREVIEW_ATTRIBUTES = [
	"aria-busy",
	"data-easymde-preview-accepted",
	"data-easymde-preview-refreshing",
] as const;

export function isTaskListCheckbox(source: Element): boolean {
	if (
		"INPUT" !== source.tagName ||
		"checkbox" !== source.getAttribute("type")?.toLowerCase()
	) {
		return false;
	}
	if (
		source.hasAttribute("class") &&
		source.classList.contains("easymde-task-checkbox")
	) {
		return true;
	}
	let current: Element | null = source;
	while (current) {
		if (
			current.hasAttribute("class") &&
			(current.classList.contains("task-list-item") ||
				current.classList.contains("task-list"))
		) {
			return true;
		}
		current = current.parentElement;
	}
	return false;
}

export function clipboardTaskCheckboxState(preview: HTMLElement): string {
	return Array.from(preview.querySelectorAll("input"))
		.filter(isTaskListCheckbox)
		.map((input) => ((input as HTMLInputElement).checked ? "1" : "0"))
		.join(",");
}

export function previewReady(preview: HTMLElement): boolean {
	const refreshing =
		"1" === preview.getAttribute("data-easymde-preview-refreshing") ||
		"true" === preview.getAttribute("aria-busy");
	const acceptedDuringRefresh =
		refreshing &&
		"1" === preview.getAttribute("data-easymde-preview-accepted") &&
		!preview.querySelector("[data-easymde-preview-window-spacer]");
	return (
		(Boolean(preview.firstElementChild) || "" !== preview.innerHTML.trim()) &&
		!preview.querySelector(
			".easymde-preview-empty, .easymde-preview-error, .easymde-render-error",
		) &&
		"1" !== preview.getAttribute("data-easymde-preview-error") &&
		(!refreshing || acceptedDuringRefresh)
	);
}

export function hasValidPngCopyOptions(
	options: WechatClipboardCopyOptions,
): boolean {
	return Boolean(
		options.visualRasterizationPort &&
			options.imageUploadPort &&
			Number.isSafeInteger(options.postId) &&
			(options.postId as number) >= 0 &&
			Number.isSafeInteger(options.maxBytes) &&
			(options.maxBytes as number) >= 1,
	);
}
