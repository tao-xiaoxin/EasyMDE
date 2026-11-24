import type {
	PreviewCodeBodyMap,
	PreviewCodeProjection,
	PreviewCodeProjectionEntry,
	PreviewResponse
} from "../../contracts/ports/preview-request";
import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import type { EditorContextMenuActionContext } from "./EditorContextMenuFeature";
import {
	findEditorCodeContentTarget,
	readEditorCodeContent,
	type EditorCodeBodyMap,
	type EditorCodeContentReadResult,
	type EditorCodeContentTarget
} from "./editor-code-content-target";
import {
	encodeEditorCodeProjection,
	type EditorCodeProjectionContentLineRange
} from "./editor-code-projection";
import { indentEditorCode } from "./editor-code-indentation";
import { findMarkdownBlock } from "./editor-context-menu-rules";

type CandidateChange = Readonly<{ from: number; insert: string; to: number }>;

type EditorCodeIndentationCandidateValidation =
	| Readonly<{ status: "available" }>
	| Readonly<{
			code:
				| "editor-code-projection-candidate-stale"
				| "editor-code-projection-candidate-unavailable";
			status: "unavailable";
	  }>;

function editorCodeProjectionEntry(
	code: NonNullable<EditorContextMenuActionContext["code"]>
): Extract<PreviewCodeProjectionEntry, { status: "available" }> | null {
	const projection = code.codeProjection;
	if ("available" !== projection?.status || !code.target) {
		return null;
	}
	return projection.entries.find(
		(entry): entry is Extract<PreviewCodeProjectionEntry, { status: "available" }> =>
			"available" === entry.status
			&& entry.kind === code.target?.kind
			&& entry.startLine === code.target?.lineStart
			&& entry.endLine === code.target?.lineEnd
	) ?? null;
}

function editorCodeContentLineRange(
	code: NonNullable<EditorContextMenuActionContext["code"]>,
	source: string,
	selection: EditorContextMenuActionSession["captured"]["selection"],
	selected: boolean
): EditorCodeProjectionContentLineRange | null {
	const entry = editorCodeProjectionEntry(code);
	if (!entry) return null;
	const contentLines = code.content?.split(/\r\n|\r|\n/u) ?? [];
	if (
		contentLines.length > 1
		&& "" === contentLines[contentLines.length - 1]
	) contentLines.pop();
	if (!contentLines.length) return null;
	if (!selected) return { end: contentLines.length, start: 0 };
	const starts = markdownLineStarts(source);
	const rows = entry.rows.filter((row) => {
		const lineStart = starts[row.sourceLine] ?? -1;
		const lineEnd = starts[row.sourceLine + 1] ?? source.length;
		return (
			lineStart >= 0
			&& selection.start < lineEnd
			&& selection.end > lineStart
			&& row.contentLine >= 0
			&& row.contentLine < contentLines.length
		);
	});
	if (!rows.length || selection.start >= selection.end) return null;
	return {
		end: Math.max(...rows.map((row) => row.contentLine)) + 1,
		start: Math.min(...rows.map((row) => row.contentLine))
	};
}

function rebaseEditorCodeBodyMap(
	codeMap: PreviewCodeBodyMap,
	lineOffset: number
): PreviewCodeBodyMap {
	if ("unavailable" === codeMap.status) return codeMap;
	return {
		...codeMap,
		entries: codeMap.entries.map((entry) => ({
			...entry,
			endLine: entry.endLine + lineOffset,
			startLine: entry.startLine + lineOffset
		}))
	};
}

function rebaseEditorCodeProjection(
	projection: PreviewCodeProjection,
	lineOffset: number
): PreviewCodeProjection {
	if ("unavailable" === projection.status) return projection;
	return {
		...projection,
		entries: projection.entries.map((entry) => ({
			...entry,
			endLine: entry.endLine + lineOffset,
			...( "available" === entry.status
				? {
						rows: entry.rows.map((row) => ({
							...row,
							sourceLine: row.sourceLine + lineOffset
						}))
					}
				: {}),
			startLine: entry.startLine + lineOffset
		}))
	};
}

function candidateEditorCodeTarget(
	source: string,
	selection: EditorContextMenuActionSession["captured"]["selection"],
	original: NonNullable<EditorContextMenuActionContext["code"]>["target"],
	changes: CandidateChange
): EditorCodeContentTarget | null {
	if (!original) return null;
	const delta = changes.insert.length - (changes.to - changes.from);
	const ownerEnd = original.ownerEnd + delta;
	if (
		original.ownerFrom < 0
		|| ownerEnd <= original.ownerFrom
		|| ownerEnd > source.length
		|| selection.start < original.ownerFrom
		|| selection.end > ownerEnd
	) return null;
	const ownerSource = source.slice(original.ownerFrom, ownerEnd);
	const target = findEditorCodeContentTarget(ownerSource, {
		end: selection.end - original.ownerFrom,
		start: selection.start - original.ownerFrom
	});
	if ("unavailable" === target.status) return null;
	return {
		...target.target,
		bodyFrom: target.target.bodyFrom + original.ownerFrom,
		bodyTo: target.target.bodyTo + original.ownerFrom,
		from: target.target.from + original.ownerFrom,
		ownerEnd,
		ownerFrom: original.ownerFrom,
		ownerLineEnd: target.target.ownerLineEnd + original.ownerLineStart,
		ownerLineStart: original.ownerLineStart,
		to: target.target.to + original.ownerFrom,
		lineEnd: target.target.lineEnd + original.ownerLineStart,
		lineStart: target.target.lineStart + original.ownerLineStart
	};
}

function sameCandidateEditorCodeTarget(
	candidate: EditorCodeContentTarget,
	original: NonNullable<EditorContextMenuActionContext["code"]>["target"],
	changes: CandidateChange
): boolean {
	if (!original) return false;
	const delta = changes.insert.length - (changes.to - changes.from);
	return candidate.kind === original.kind
		&& candidate.ownerFrom === original.ownerFrom
		&& candidate.ownerEnd === original.ownerEnd + delta
		&& candidate.from === original.from
		&& candidate.to === original.to + delta
		&& candidate.bodyFrom === original.bodyFrom
		&& candidate.bodyTo === original.bodyTo + delta
		&& candidate.lineStart === original.lineStart
		&& candidate.lineEnd === original.lineEnd
		&& candidate.ownerLineStart === original.ownerLineStart
		&& candidate.ownerLineEnd === original.ownerLineEnd;
}

function sameCandidateProjectionEntry(
	candidate: Extract<PreviewCodeProjectionEntry, { status: "available" }>,
	original: Extract<PreviewCodeProjectionEntry, { status: "available" }>
): boolean {
	if (
		candidate.kind !== original.kind
		|| candidate.startLine !== original.startLine
		|| candidate.endLine !== original.endLine
	) return false;
	if ("fenced" !== candidate.kind || "fenced" !== original.kind) return true;
	return candidate.info === original.info
		&& candidate.fenceOffset === original.fenceOffset;
}

function validateEditorCodeIndentationCandidate(input: Readonly<{
	candidateSource: string;
	changes: CandidateChange;
	contentLineRange: EditorCodeProjectionContentLineRange;
	desiredSemanticBody: string;
	originalProjectionEntry: Extract<PreviewCodeProjectionEntry, { status: "available" }>;
	originalTarget: EditorCodeContentTarget;
	response: PreviewResponse;
	selection: EditorContextMenuActionSession["captured"]["selection"];
	signature: string;
}>): EditorCodeIndentationCandidateValidation {
	const responseCodeMap = input.response.codeMap;
	const responseProjection = input.response.codeProjection;
	if (!responseCodeMap || !responseProjection) {
		return {
			code: "editor-code-projection-candidate-unavailable",
			status: "unavailable"
		};
	}
	if (
		responseCodeMap.signature !== input.signature
		|| responseProjection.signature !== input.signature
	) {
		return {
			code: "editor-code-projection-candidate-stale",
			status: "unavailable"
		};
	}
	if (
		"available" !== responseCodeMap.status
		|| "available" !== responseProjection.status
	) {
		return {
			code: "editor-code-projection-candidate-unavailable",
			status: "unavailable"
		};
	}

	const candidateTarget = candidateEditorCodeTarget(
		input.candidateSource,
		input.selection,
		input.originalTarget,
		input.changes
	);
	if (
		!candidateTarget
		|| !sameCandidateEditorCodeTarget(
			candidateTarget,
			input.originalTarget,
			input.changes
		)
	) {
		return {
			code: "editor-code-projection-candidate-stale",
			status: "unavailable"
		};
	}

	const codeMap = rebaseEditorCodeBodyMap(
		responseCodeMap,
		candidateTarget.ownerLineStart
	);
	const projection = rebaseEditorCodeProjection(
		responseProjection,
		candidateTarget.ownerLineStart
	);
	if ("available" !== codeMap.status || "available" !== projection.status) {
		return {
			code: "editor-code-projection-candidate-unavailable",
			status: "unavailable"
		};
	}
	const codeMapMatches = codeMap.entries.filter(
		(entry) =>
			entry.kind === candidateTarget.kind
			&& entry.startLine === candidateTarget.lineStart
			&& entry.endLine === candidateTarget.lineEnd
			&& "available" === entry.status
	);
	const projectionMatches = projection.entries.filter(
		(entry): entry is Extract<PreviewCodeProjectionEntry, { status: "available" }> =>
			entry.kind === candidateTarget.kind
			&& entry.startLine === candidateTarget.lineStart
			&& entry.endLine === candidateTarget.lineEnd
			&& "available" === entry.status
	);
	if (1 !== codeMapMatches.length || 1 !== projectionMatches.length) {
		return {
			code: "editor-code-projection-candidate-stale",
			status: "unavailable"
		};
	}
	const candidateProjectionEntry = projectionMatches[0];
	if (
		!candidateProjectionEntry
		|| !sameCandidateProjectionEntry(
			candidateProjectionEntry,
			input.originalProjectionEntry
		)
	) {
		return {
			code: "editor-code-projection-candidate-stale",
			status: "unavailable"
		};
	}

	const bodyMap: EditorCodeBodyMap = {
		codeMap,
		signature: input.signature,
		source: input.candidateSource
	};
	const read: EditorCodeContentReadResult = readEditorCodeContent(
		input.candidateSource,
		input.selection,
		undefined,
		bodyMap
	);
	if ("unavailable" === read.status || read.content !== input.desiredSemanticBody) {
		return {
			code: "editor-code-projection-candidate-stale",
			status: "unavailable"
		};
	}

	const encoded = encodeEditorCodeProjection({
		codeMap,
		contentLineRange: input.contentLineRange,
		desiredSemanticBody: input.desiredSemanticBody,
		projection,
		selection: input.selection,
		signature: input.signature,
		source: input.candidateSource,
		target: {
			endLine: candidateTarget.lineEnd,
			kind: candidateTarget.kind,
			startLine: candidateTarget.lineStart
		}
	});
	if ("unavailable" === encoded.status || !encoded.noop) {
		return {
			code: "editor-code-projection-candidate-stale",
			status: "unavailable"
		};
	}
	return { status: "available" };
}

/**
 * Code actions: indentation candidate validation and code block copy/delete.
 * The candidate Preview is requested through Root's existing Preview port, so
 * this owner never renders Markdown or persists the candidate.
 */
export async function runCodeContextMenuAction(
	id: string,
	session: EditorContextMenuActionSession
): Promise<void> {
	const { actionContext, capabilities, captured, report } = session;
	const strings = capabilities.contextMenuStrings;

	if (["indent-code-block", "indent-selected-code"].includes(id)) {
		if (!session.ensureCurrent()) return;
		const code = actionContext?.code;
		const selected = "indent-selected-code" === id;
		if (
			!code
			|| (selected
				? code.canIndentSelection !== true
				: code.canIndentBlock !== true)
			|| !code.codeMap
			|| !code.codeProjection
			|| !code.target
			|| !code.content
		) {
			report(
				"editor-code-projection-target-unavailable",
				strings?.unsupported
			);
			return;
		}
		const projectionEntry = editorCodeProjectionEntry(code);
		const contentLineRange = editorCodeContentLineRange(
			code,
			captured.value,
			captured.selection,
			selected
		);
		if (!projectionEntry || !contentLineRange) {
			report(
				"editor-code-projection-target-unavailable",
				strings?.unsupported
			);
			return;
		}
		const operation = session.beginOperation();
		try {
			const indentation = await indentEditorCode({
				content: code.content,
				info: "fenced" === projectionEntry.kind
					? projectionEntry.info
					: "",
				language: "",
				lineRange: {
					endLine: contentLineRange.end,
					startLine: contentLineRange.start
				},
				signal: operation.controller.signal
			});
			if (operation.controller.signal.aborted || !session.ensureCurrent()) return;
			if ("unavailable" === indentation.status) {
				report(indentation.code, strings?.statusActionFailed);
				return;
			}
			const encoded = encodeEditorCodeProjection({
				codeMap: code.codeMap,
				contentLineRange,
				desiredSemanticBody: indentation.content,
				projection: code.codeProjection,
				selection: captured.selection,
				signature: code.requestSignature ?? "",
				source: captured.value,
				target: {
					endLine: code.target.lineEnd,
					kind: code.target.kind,
					startLine: code.target.lineStart
				}
			});
			if ("unavailable" === encoded.status) {
				report(encoded.code, strings?.statusActionFailed);
				return;
			}
			if (encoded.noop || !encoded.changes) return;
			const nextValue =
				captured.value.slice(0, encoded.changes.from)
				+ encoded.changes.insert
				+ captured.value.slice(encoded.changes.to);
			const candidateTarget = candidateEditorCodeTarget(
				nextValue,
				encoded.selection,
				code.target,
				encoded.changes
			);
			if (
				!candidateTarget
				|| !sameCandidateEditorCodeTarget(
					candidateTarget,
					code.target,
					encoded.changes
				)
			) {
				report(
					"editor-code-projection-candidate-stale",
					strings?.statusActionFailed
				);
				return;
			}
			let candidateResponse: PreviewResponse;
			let candidateSignature: string;
			try {
				const rendered =
					await capabilities.preview.renderCodeIndentationCandidate(
						nextValue.slice(
							candidateTarget.ownerFrom,
							candidateTarget.ownerEnd
						),
						operation.controller.signal
					);
				if ("unavailable" === rendered.status) {
					report(rendered.code, strings?.statusActionFailed);
					return;
				}
				candidateResponse = rendered.response;
				candidateSignature = rendered.signature;
			} catch {
				if (!capabilities.isActive()) return;
				if (operation.controller.signal.aborted && !session.isCurrent()) {
					report(
						"editor-code-projection-candidate-stale",
						strings?.statusActionFailed
					);
				} else if (!operation.controller.signal.aborted) {
					report(
						"editor-code-projection-candidate-unavailable",
						strings?.statusActionFailed
					);
				}
				return;
			}
			if (operation.controller.signal.aborted) {
				if (capabilities.isActive() && !session.isCurrent()) {
					report(
						"editor-code-projection-candidate-stale",
						strings?.statusActionFailed
					);
				}
				return;
			}
			if (!session.ensureCurrent()) return;
			let candidateValidation: EditorCodeIndentationCandidateValidation;
			try {
				candidateValidation = validateEditorCodeIndentationCandidate({
					candidateSource: nextValue,
					changes: encoded.changes,
					contentLineRange,
					desiredSemanticBody: indentation.content,
					originalProjectionEntry: projectionEntry,
					originalTarget: code.target,
					response: candidateResponse,
					selection: encoded.selection,
					signature: candidateSignature
				});
			} catch {
				report(
					"editor-code-projection-candidate-unavailable",
					strings?.statusActionFailed
				);
				return;
			}
			if ("unavailable" === candidateValidation.status) {
				report(candidateValidation.code, strings?.statusActionFailed);
				return;
			}
			if (!session.ensureCurrent()) return;
			session.finishOperation(operation);
			session.applyEdit({
				changes: encoded.changes,
				selection: encoded.selection,
				...(captured.surface === "visual"
					? { selectionFallback: "reflow-caret" as const }
					: {}),
				value: nextValue
			});
		} finally {
			session.finishOperation(operation);
		}
		return;
	}

	if (["copy-code-block", "copy-code-content", "delete-code-block"].includes(id)) {
		if (!session.ensureCurrent()) return;
		const value = session.readValue();
		const codeTarget = actionContext?.code?.target;
		const codeBlock = findMarkdownBlock(
			value,
			captured.selection.start,
			session.currentBlockIndex() ?? undefined
		);
		const targetRange = codeTarget
			? { from: codeTarget.from, to: codeTarget.to }
			: codeBlock
				? { from: codeBlock.start, to: codeBlock.end }
				: null;
		if (!targetRange) {
			report(
				"editor-context-menu-code-block-unavailable",
				strings?.unsupported
			);
			return;
		}
		if (!session.ensureSelectionFitsTarget(targetRange)) return;
		if ("copy-code-content" === id) {
			const code = actionContext?.code;
			if (!code?.canCopyContent || !code.content) {
				report(
					"editor-code-content-map-unavailable",
					strings?.unsupported
				);
				return;
			}
			const operation = session.beginOperation();
			try {
				const result = await session.clipboard.write(code.content, {
					signal: operation.controller.signal
				});
				if (operation.controller.signal.aborted || !session.ensureCurrent()) return;
				if ("written" !== result.status) {
					report(result.code, strings?.statusClipboardUnavailable);
				}
			} finally {
				session.finishOperation(operation);
			}
			return;
		}
		const blockIndex = session.currentBlockIndex();
		if (null === blockIndex) {
			report(
				"editor-context-menu-block-index-unavailable",
				strings?.unsupported
			);
			return;
		}
		const block =
			undefined === blockIndex
				? findMarkdownBlock(value, captured.selection.start)
				: findMarkdownBlock(value, captured.selection.start, blockIndex);
		if ("code" !== block?.kind && !codeTarget) {
			report(
				"editor-context-menu-code-block-unavailable",
				strings?.unsupported
			);
			return;
		}
		if ("copy-code-block" === id) {
			const result = await session.clipboard.write(
				value.slice(
					codeTarget?.from ?? block?.start ?? 0,
					codeTarget?.to ?? block?.end ?? 0
				)
			);
			if ("written" !== result.status) {
				report(result.code, strings?.statusClipboardUnavailable);
			}
			return;
		}
		const blockStart = codeTarget?.from ?? block?.start;
		const blockEnd = codeTarget?.to ?? block?.end;
		if (undefined === blockStart || undefined === blockEnd) {
			report(
				"editor-context-menu-code-block-unavailable",
				strings?.unsupported
			);
			return;
		}
		const nextValue = value.slice(0, blockStart) + value.slice(blockEnd);
		session.applyEdit({
			changes: { from: blockStart, insert: "", to: blockEnd },
			selection: {
				direction: "none",
				end: blockStart,
				start: blockStart
			},
			value: nextValue
		});
	}
}
