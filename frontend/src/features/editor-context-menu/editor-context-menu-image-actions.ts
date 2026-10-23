import type { EditorImagePixelsLease } from "../../contracts/ports/editor-image-pixels-port";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { contextMenuActionErrorCode } from "./editor-context-menu-action-errors";
import {
	createImageScaleReplacement,
	createMarkdownImageDestinationReplacement,
	findMarkdownImageAt,
	parseMarkdownImageScale
} from "../image-scale/image-scale-contract";

/**
 * Image actions keep the whole updated image selected. A caret placed inside
 * image syntax, for example between a `{width=…%}` marker and the closing
 * title quote, has no representable boundary in a Visual surface, so the
 * visual owner would fail after the canonical write. Parsing the serialized
 * result also proves the replacement stayed one valid image before any write.
 */
function imageTargetSelectionAfterEdit(
	nextValue: string,
	imageStart: number
): Readonly<{ direction: "forward" | "none"; end: number; start: number }> | null {
	const image = parseMarkdownImageScale(nextValue, imageStart);
	if (!image || image.start !== imageStart) return null;
	// A non-collapsed canonical selection is normalized to a real direction by
	// the document session, so forward is the only truthful value here.
	return {
		direction: image.end > image.start ? "forward" : "none",
		end: image.end,
		start: image.start
	};
}

export async function runImageContextMenuAction(
	id: string,
	session: EditorContextMenuActionSession
): Promise<void> {
	const { actionContext, capabilities, captured, report } = session;
	const strings = capabilities.contextMenuStrings;
	const clipboard = session.clipboard;

	if (/^image-scale-(25|33|50|67|100|150|200)$/u.test(id)) {
		if (!session.ensureCurrent()) return;
		const image = findMarkdownImageAt(
			captured.value,
			captured.selection.start,
			captured.selection.end
		);
		if (!image) {
			report(
				"editor-context-menu-image-unavailable",
				strings?.unsupported
			);
			return;
		}
		const replacement = createImageScaleReplacement(
			captured.value,
			image,
			Number(id.slice("image-scale-".length)) as
				| 25
				| 33
				| 50
				| 67
				| 100
				| 150
				| 200
		);
		const value = session.readValue();
		const nextValue =
			value.slice(0, replacement.from)
			+ replacement.insert
			+ value.slice(replacement.to);
		const selection = imageTargetSelectionAfterEdit(
			nextValue,
			image.start
		);
		if (!selection) {
			report(
				"editor-context-menu-image-stale",
				strings?.statusActionFailed
			);
			return;
		}
		session.applyEdit({
			changes: replacement,
			selection,
			value: nextValue
		});
		return;
	}

	if ("copy-image" === id) {
		const imageContext = actionContext?.image;
		const imagePixels = capabilities.media.imagePixels;
		if (
			!imageContext?.canCopyImage
			|| !imageContext.lease
			|| !imagePixels
			|| !clipboard.writeImageDeferred
		) {
			report(
				"editor-context-menu-image-copy-unsupported",
				strings?.unsupported
			);
			return;
		}
		if (!session.ensureCurrent() || !imageContext.lease.isCurrent()) {
			report(
				"editor-context-menu-image-stale",
				strings?.statusActionFailed
			);
			return;
		}
		const operation = session.beginOperation();
		const controller = operation.controller;
		let extractionFailure: string | null = null;
		const imageLease: EditorImagePixelsLease = {
			image: imageContext.lease.root,
			isCurrent: imageContext.lease.isCurrent
		};
		const png = Promise.resolve()
			.then(() =>
				imagePixels.extractPng({
					lease: imageLease,
					signal: controller.signal
				})
			)
			.then((result) => {
				if ("failed" === result.status) {
					extractionFailure = result.code;
					throw new Error(result.code);
				}
				return result.blob;
			});
		void png.catch(() => undefined);
		try {
			// Start the native deferred Clipboard operation during the original click.
			const result = await clipboard.writeImageDeferred(png, {
				signal: controller.signal
			});
			if (!session.ensureCurrent() || !imageContext.lease.isCurrent()) return;
			if ("written" !== result.status) {
				controller.abort();
				report(
					extractionFailure ?? result.code,
					strings?.statusClipboardUnavailable
				);
			}
		} catch (error) {
			const wasAborted = controller.signal.aborted;
			controller.abort();
			if (!wasAborted) {
				const code =
					extractionFailure
					?? (error instanceof Error
					&& /^editor-image-pixels-[a-z0-9-]+$/u.test(error.message)
						? error.message
						: "editor-context-menu-image-copy-failed");
				report(code, strings?.statusActionFailed);
			}
		} finally {
			if (controller.signal.aborted || extractionFailure)
				controller.abort();
			session.finishOperation(operation);
		}
		return;
	}

	if ("delete-image" === id) {
		if (!session.ensureCurrent()) return;
		const image = findMarkdownImageAt(
			captured.value,
			captured.selection.start,
			captured.selection.end
		);
		if (!image) {
			report(
				"editor-context-menu-image-unavailable",
				strings?.unsupported
			);
			return;
		}
		const value = session.readValue();
		const current = parseMarkdownImageScale(value, image.start);
		if (!current || current.raw !== image.raw) {
			report(
				"editor-context-menu-image-stale",
				strings?.statusActionFailed
			);
			return;
		}
		const nextValue =
			value.slice(0, current.start) + value.slice(current.end);
		session.applyEdit({
			changes: { from: current.start, insert: "", to: current.end },
			selection: {
				direction: "none",
				end: current.start,
				start: current.start
			},
			value: nextValue
		});
		return;
	}

	if ("upload-image" === id) {
		if (!session.ensureCurrent()) return;
		const image = findMarkdownImageAt(
			captured.value,
			captured.selection.start,
			captured.selection.end
		);
		if (
			!image
			|| !/^https?:\/\//iu.test(image.destination)
			|| "off" === capabilities.media.imageUpload.remoteImageUploadMode
		) {
			report(
				"editor-context-menu-image-upload-unsupported",
				strings?.unsupported
			);
			return;
		}
		const operation = session.beginOperation();
		const controller = operation.controller;
		try {
			const result = await capabilities.media.remoteImageImport.import({
				altText: image.alt,
				postId: capabilities.media.imageUpload.postId,
				signal: controller.signal,
				url: image.destination
			});
			if ("failed" === result.status) {
				report(result.code, strings?.statusActionFailed);
				return;
			}
			if (controller.signal.aborted || !session.ensureCurrent()) return;
			const current = session.readValue();
			const parsed = parseMarkdownImageScale(current, image.start);
			if (!parsed) throw new Error("editor-context-menu-image-stale");
			const replacement = createMarkdownImageDestinationReplacement(
				current,
				parsed,
				result.url
			);
			if (!replacement) return;
			const nextValue =
				current.slice(0, replacement.from)
				+ replacement.insert
				+ current.slice(replacement.to);
			const selection = imageTargetSelectionAfterEdit(
				nextValue,
				image.start
			);
			if (!selection) {
				report(
					"editor-context-menu-image-stale",
					strings?.statusActionFailed
				);
				return;
			}
			session.applyEdit({
				changes: replacement,
				selection,
				value: nextValue
			});
		} catch (error) {
			if (!controller.signal.aborted) {
				report(
					contextMenuActionErrorCode(
						error,
						"editor-context-menu-image-upload-failed"
					),
					strings?.statusActionFailed
				);
			}
		} finally {
			session.finishOperation(operation);
		}
	}
}
