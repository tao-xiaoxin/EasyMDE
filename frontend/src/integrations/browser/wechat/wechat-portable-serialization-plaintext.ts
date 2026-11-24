import {
	CODE_FRAME_HEADER_CLONES,
	EXPORT_TEXT_NORMALIZATIONS,
} from "./wechat-clone-metadata";
import { previewMeasurementWidth } from "./wechat-preview-measurement";
import { assertTaskCheckboxCaptionRuns } from "./wechat-task-caption";

export function normalizedPlainText(value: string): string {
	return value.replaceAll("\u2060", "").replaceAll("\u00a0", " ");
}

const PLAIN_TEXT_MEDIA_ATTRIBUTES = ["src", "srcset", "poster"] as const;
type PlainTextMediaAttribute = (typeof PLAIN_TEXT_MEDIA_ATTRIBUTES)[number];
type PlainTextMediaAttributeSnapshot = Readonly<{
	element: Element;
	values: Readonly<Record<PlainTextMediaAttribute, string | null>>;
}>;

function snapshotPlainTextMediaAttributes(
	root: HTMLElement,
): PlainTextMediaAttributeSnapshot[] {
	const elements = [
		...(root.matches("img, video, source") ? [root] : []),
		...Array.from(root.querySelectorAll("img, video, source")),
	];
	return elements.map((element) => ({
		element,
		values: {
			src: element.getAttribute("src"),
			srcset: element.getAttribute("srcset"),
			poster: element.getAttribute("poster"),
		},
	}));
}

function stripPlainTextMediaAttributes(
	snapshots: readonly PlainTextMediaAttributeSnapshot[],
): void {
	snapshots.forEach(({ element }) => {
		PLAIN_TEXT_MEDIA_ATTRIBUTES.forEach((attribute) => {
			element.removeAttribute(attribute);
		});
	});
}

function restorePlainTextMediaAttributes(
	snapshots: readonly PlainTextMediaAttributeSnapshot[],
): void {
	snapshots.forEach(({ element, values }) => {
		PLAIN_TEXT_MEDIA_ATTRIBUTES.forEach((attribute) => {
			const value = values[attribute];
			if (value === null) element.removeAttribute(attribute);
			else element.setAttribute(attribute, value);
		});
	});
}

export function connectedPlainText(
	root: HTMLElement,
	source: HTMLElement,
): string {
	const document = root.ownerDocument;
	if (!document.body)
		throw new Error("wechat-plain-text-document-body-unavailable");
	const detachedCodeFrameHeaders: Array<
		Readonly<{ element: Element; parent: Node; nextSibling: ChildNode | null }>
	> = [];
	const mediaAttributeSnapshots = snapshotPlainTextMediaAttributes(root);
	const normalizations = EXPORT_TEXT_NORMALIZATIONS.get(root) ?? new Map();
	const restoreCodeText = (property: "original" | "encoded"): void => {
		normalizations?.forEach((value, textNode) => {
			textNode.nodeValue = value[property];
		});
	};
	// The encoded clone is needed for the HTML Blob. Plain-text measurement must
	// see the original code bytes, while finally restoring the encoded clone
	// keeps repeated payload reads and cleanup deterministic.
	let host: HTMLDivElement | null = null;
	try {
		restoreCodeText("original");
		assertTaskCheckboxCaptionRuns(root, normalizations, "original");
		// Plain text does not need media resources. Remove their fetchable
		// attributes from the temporary measurement tree while leaving the HTML
		// payload untouched.
		stripPlainTextMediaAttributes(mediaAttributeSnapshots);
		// A generated code-frame header is paint-only. Keeping it in the HTML
		// payload is required for layout, but its block boundary must not become
		// a line in the separate plain-text clipboard payload.
		Array.from(root.querySelectorAll("*"))
			.filter((element) => CODE_FRAME_HEADER_CLONES.has(element))
			.forEach((element) => {
				const parent = element.parentNode;
				if (!parent) return;
				detachedCodeFrameHeaders.push({
					element,
					parent,
					nextSibling: element.nextSibling,
				});
				parent.removeChild(element);
			});
		host = document.createElement("div");
		// `innerText` uses layout only while a node is connected. Keep this host
		// outside the viewport without using `display:none` or `visibility:hidden`,
		// either of which makes `innerText` empty or loses block boundaries.
		host.style.cssText = [
			"position:fixed",
			"left:-100000px",
			"top:0",
			"opacity:0",
			"pointer-events:none",
			"contain:layout",
		].join(";");
		const sourceWidth = previewMeasurementWidth(source);
		if (sourceWidth) {
			host.style.width = `${sourceWidth}px`;
			host.style.maxWidth = `${sourceWidth}px`;
		}
		document.body.append(host);
		host.append(root);
		const connectedText = normalizedPlainText(
			root.innerText || root.textContent || "",
		);
		// jsdom and other non-layout DOM implementations flatten a connected
		// clone too. When the real Preview exposes line-aware `innerText`, retain
		// those source boundaries only in that no-layout case; the normalized
		// clone remains the source for browsers that can perform layout.
		const sourceText = source.innerText;
		assertTaskCheckboxCaptionRuns(root, normalizations, "original");
		if (
			!connectedText.includes("\n") &&
			"string" === typeof sourceText &&
			sourceText.includes("\n")
		) {
			return normalizedPlainText(sourceText);
		}
		return connectedText;
	} finally {
		host?.remove();
		restorePlainTextMediaAttributes(mediaAttributeSnapshots);
		detachedCodeFrameHeaders
			.reverse()
			.forEach(({ element, parent, nextSibling }) => {
				if (nextSibling?.parentNode === parent)
					parent.insertBefore(element, nextSibling);
				else parent.appendChild(element);
			});
		restoreCodeText("encoded");
		assertTaskCheckboxCaptionRuns(root, normalizations, "encoded");
	}
}
