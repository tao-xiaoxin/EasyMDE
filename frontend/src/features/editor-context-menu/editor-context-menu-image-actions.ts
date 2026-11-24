import type { EditorImagePixelsLease } from "../../contracts/ports/editor-image-pixels-port";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import { contextMenuActionErrorCode } from "./editor-context-menu-action-errors";
import {
	createImageScaleReplacement,
	createMarkdownImageDestinationReplacement,
	findMarkdownImageAt,
	type MarkdownImageScaleMatch,
	parseMarkdownImageScale
} from "../image-scale/image-scale-contract";

function verifyConfirmedImageMatch(
	value: string,
	match: MarkdownImageScaleMatch
): MarkdownImageScaleMatch | null {
	if (
		!Number.isInteger(match.start)
		|| !Number.isInteger(match.end)
		|| match.start < 0
		|| match.end <= match.start
		|| match.end > value.length
		|| value.slice(match.start, match.end) !== match.raw
	) {
		return null;
	}
	const parsed = parseMarkdownImageScale(value, match.start);
	if (
		!parsed
		|| parsed.start !== match.start
		|| parsed.end !== match.end
		|| parsed.raw !== match.raw
		|| parsed.destination !== match.destination
		|| parsed.destinationAngle !== match.destinationAngle
		|| parsed.destinationStart !== match.destinationStart
		|| parsed.destinationEnd !== match.destinationEnd
		|| parsed.scale !== match.scale
	) {
		return null;
	}
	return parsed;
}

function isStaleImageContractError(error: unknown): boolean {
	return error instanceof Error
		&& (
			"image-scale-image-stale" === error.message
			|| "image-scale-range-invalid" === error.message
			|| "image-scale-syntax-invalid" === error.message
			|| "image-scale-invalid-width" === error.message
		);
}

function findImageOrReport(
	session: EditorContextMenuActionSession,
	unavailableCode: string,
	invalidFallbackCode: string
): MarkdownImageScaleMatch | null {
	const { actionContext, capabilities, captured, report } = session;
	const strings = capabilities.contextMenuStrings;
	const confirmedMatch = actionContext?.image?.match;
	if (confirmedMatch) {
		try {
			const capturedImage = verifyConfirmedImageMatch(
				captured.value,
				confirmedMatch
			);
			const currentValue = session.readValue();
			const currentImage =
				capturedImage && currentValue === captured.value
					? capturedImage
					: capturedImage
						? verifyConfirmedImageMatch(currentValue, confirmedMatch)
						: null;
			if (!currentImage) {
				report(
					"editor-context-menu-image-stale",
					strings?.statusActionFailed
				);
				return null;
			}
			return currentImage;
		} catch (error) {
			report(
				contextMenuActionErrorCode(error, invalidFallbackCode),
				strings?.statusActionFailed
			);
			return null;
		}
	}
	let image: MarkdownImageScaleMatch | null;
	try {
		image = findMarkdownImageAt(
			captured.value,
			captured.selection.start,
			captured.selection.end
		);
	} catch (error) {
		report(
			contextMenuActionErrorCode(error, invalidFallbackCode),
			strings?.statusActionFailed
		);
		return null;
	}
	if (!image) {
		report(unavailableCode, strings?.unsupported);
		return null;
	}
	return image;
}

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
	const { actionContext, capabilities, report } = session;
	const strings = capabilities.contextMenuStrings;
	const clipboard = session.clipboard;

	if (/^image-scale-(25|33|50|67|100|150|200)$/u.test(id)) {
		if (!session.ensureCurrent()) return;
		const image = findImageOrReport(
			session,
			"editor-context-menu-image-unavailable",
			"editor-context-menu-image-stale"
		);
		if (!image) return;
		const value = session.readValue();
		if (
			image.start < 0
			|| image.end > value.length
			|| value.slice(image.start, image.end) !== image.raw
		) {
			report(
				"editor-context-menu-image-stale",
				strings?.statusActionFailed
			);
			return;
		}
		let replacement: ReturnType<typeof createImageScaleReplacement>;
		let nextValue: string;
		let selection: ReturnType<typeof imageTargetSelectionAfterEdit>;
		try {
			replacement = createImageScaleReplacement(
				value,
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
			nextValue =
				value.slice(0, replacement.from)
				+ replacement.insert
				+ value.slice(replacement.to);
			selection = imageTargetSelectionAfterEdit(
				nextValue,
				image.start
			);
		} catch (error) {
			report(
				contextMenuActionErrorCode(error, "editor-context-menu-image-stale"),
				strings?.statusActionFailed
			);
			return;
		}
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
			if (
				controller.signal.aborted
				|| !session.ensureCurrent()
				|| !imageContext.lease.isCurrent()
			) return;
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
		const image = findImageOrReport(
			session,
			"editor-context-menu-image-unavailable",
			"editor-context-menu-image-stale"
		);
		if (!image) return;
		const value = session.readValue();
		let current: MarkdownImageScaleMatch | null;
		try {
			current = verifyConfirmedImageMatch(value, image);
		} catch (error) {
			report(
				contextMenuActionErrorCode(error, "editor-context-menu-image-stale"),
				strings?.statusActionFailed
			);
			return;
		}
		if (!current) {
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
		const image = findImageOrReport(
			session,
			"editor-context-menu-image-upload-unsupported",
			"editor-context-menu-image-upload-failed"
		);
		if (!image) return;
		if (
			!/^https?:\/\//iu.test(image.destination)
			|| "off" === capabilities.media.imageUpload.remoteImageUploadMode
		) {
			report(
				"editor-context-menu-image-upload-unsupported",
				strings?.unsupported
			);
			return;
		}
		const liveValue = session.readValue();
		let liveImage: MarkdownImageScaleMatch | null;
		try {
			liveImage = verifyConfirmedImageMatch(liveValue, image);
		} catch (error) {
			report(
				contextMenuActionErrorCode(error, "editor-context-menu-image-stale"),
				strings?.statusActionFailed
			);
			return;
		}
		if (!liveImage) {
			report(
				"editor-context-menu-image-stale",
				strings?.statusActionFailed
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
			if (controller.signal.aborted || !session.ensureCurrent()) return;
			if ("failed" === result.status) {
				report(result.code, strings?.statusActionFailed);
				return;
			}
			const current = session.readValue();
			let replacement: ReturnType<
				typeof createMarkdownImageDestinationReplacement
			>;
			try {
				replacement = createMarkdownImageDestinationReplacement(
					current,
					image,
					result.url
				);
			} catch (error) {
				if (isStaleImageContractError(error)) {
					report(
						"editor-context-menu-image-stale",
						strings?.statusActionFailed
					);
					return;
				}
				throw error;
			}
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
			if (controller.signal.aborted || !session.ensureCurrent()) return;
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
