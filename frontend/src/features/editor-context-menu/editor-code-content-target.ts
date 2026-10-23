import { markdownLanguage } from "@codemirror/lang-markdown";

import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import type {
	PreviewCodeBodyMap,
	PreviewCodeBodyMapEntry,
} from "../../contracts/ports/preview-request";
import {
	type EditorMarkdownBlockIndex,
	findEditorMarkdownBlock,
} from "./editor-markdown-block-index";
import {
	originalOffsetAt,
	projectNewlines,
	type NewlineProjection,
} from "./editor-markdown-source-projection";

export type EditorCodeContentSelection = Readonly<{
	end: number;
	start: number;
}>;

export type EditorCodeContentTarget = Readonly<{
	bodyFrom: number;
	bodyTo: number;
	from: number;
	kind: "fenced" | "indented";
	lineEnd: number;
	lineStart: number;
	ownerEnd: number;
	ownerLineEnd: number;
	ownerLineStart: number;
	ownerFrom: number;
	to: number;
}>;

export type EditorCodeContentUnavailableCode =
	| "editor-code-content-input-invalid"
	| "editor-code-content-map-invalid"
	| "editor-code-content-map-stale"
	| "editor-code-content-map-unavailable"
	| "editor-code-content-selection-ambiguous"
	| "editor-code-content-selection-invalid"
	| "editor-code-content-selection-not-code"
	| "editor-code-content-block-index-stale"
	| "editor-code-content-body-unavailable";

export type EditorCodeContentReadResult =
	| Readonly<{
			content: string;
			status: "available";
			target: EditorCodeContentTarget;
	  }>
	| Readonly<{
			code: EditorCodeContentUnavailableCode;
			status: "unavailable";
	  }>;

type ParsedCodeCandidate = Readonly<{
	bodyFrom: number;
	bodyTo: number;
	from: number;
	kind: "fenced" | "indented";
	to: number;
}>;

export type EditorCodeBodyMap = Readonly<{
	codeMap: PreviewCodeBodyMap;
	signature: string;
	source: string;
}>;

function projectedLineBodyEnd(text: string, from: number, to: number): number {
	for (let index = from; index < to; index += 1) {
		if ("\n" === text[index]) return index + 1;
	}
	return to;
}

function parserCodeCandidates(
	projection: NewlineProjection,
): ParsedCodeCandidate[] {
	const projectedStarts = markdownLineStarts(projection.text);
	const tree = markdownLanguage.parser.parse(projection.text);
	const candidates: ParsedCodeCandidate[] = [];
	const stack: Array<{
		codeMarks: Array<Readonly<{ from: number; to: number }>>;
		from: number;
		kind: "fenced" | "indented";
		to: number;
	}> = [];

	tree.iterate({
		enter: (node) => {
			if ("FencedCode" === node.name || "CodeBlock" === node.name) {
				stack.push({
					codeMarks: [],
					from: node.from,
					kind: "FencedCode" === node.name ? "fenced" : "indented",
					to: node.to,
				});
				return;
			}
			const current = stack[stack.length - 1];
			if (!current) return;
			if ("CodeMark" === node.name) {
				current.codeMarks.push({ from: node.from, to: node.to });
			}
		},
		leave: (node) => {
			if ("FencedCode" !== node.name && "CodeBlock" !== node.name) return;
			const current = stack.pop();
			if (!current) return;
			const openingMark = current.codeMarks[0];
			const closingMark =
				current.kind === "fenced" && current.codeMarks.length > 1
					? current.codeMarks[current.codeMarks.length - 1]
					: undefined;
			const bodyStart =
				current.kind === "fenced" && openingMark
					? projectedLineBodyEnd(projection.text, openingMark.to, current.to)
					: current.from;
			const bodyEnd = closingMark?.from ?? current.to;
			if (bodyStart > bodyEnd) return;
			const lineStart =
				projectedStarts[lineIndexAtOffsets(projectedStarts, current.from)] ??
				current.from;
			candidates.push({
				bodyFrom: originalOffsetAt(projection, bodyStart),
				bodyTo: originalOffsetAt(projection, bodyEnd),
				from: originalOffsetAt(projection, lineStart),
				kind: current.kind,
				to: originalOffsetAt(projection, current.to),
			});
		},
	});

	return candidates.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
}

function codeCandidateMatchesSelection(
	candidate: ParsedCodeCandidate,
	selection: EditorCodeContentSelection,
): boolean {
	return (
		(selection.start >= candidate.bodyFrom && selection.end <= candidate.bodyTo)
		|| (selection.start <= candidate.from && selection.end >= candidate.to)
	);
}

function sourceLineRange(
	source: string,
	range: Readonly<{ from: number; to: number }>,
): Readonly<{ endLine: number; startLine: number }> {
	const starts = markdownLineStarts(source);
	const startLine = lineIndexAtOffsets(starts, range.from);
	const lastOffset = Math.max(range.from, range.to - 1);
	return {
		endLine: lineIndexAtOffsets(starts, lastOffset) + 1,
		startLine,
	};
}

function codeMapEntriesAreValid(
	source: string,
	codeMap: PreviewCodeBodyMap,
): boolean {
	if (codeMap.version !== 1 || codeMap.coordinate !== "line") return false;
	if ("unavailable" === codeMap.status) {
		return (
			"preview-code-body-limit" === codeMap.code ||
			"preview-code-body-unavailable" === codeMap.code
		);
	}
	if (!Array.isArray(codeMap.entries)) return false;
	const maximumLine = markdownLineStarts(source).length;
	let previousEnd = 0;
	for (const entry of codeMap.entries) {
		if (
			("fenced" !== entry.kind && "indented" !== entry.kind) ||
			!Number.isSafeInteger(entry.startLine) ||
			!Number.isSafeInteger(entry.endLine) ||
			entry.startLine < previousEnd ||
			entry.endLine <= entry.startLine ||
			entry.endLine > maximumLine
		)
			return false;
		if ("available" === entry.status) {
			if ("string" !== typeof entry.content) return false;
		} else if ("preview-code-body-source-unavailable" !== entry.code) {
			return false;
		}
		previousEnd = entry.endLine;
	}
	return true;
}

function codeMapEntryForCandidate(
	source: string,
	candidate: Readonly<{
		from: number;
		kind: "fenced" | "indented";
		to: number;
	}>,
	codeMap: PreviewCodeBodyMap,
): PreviewCodeBodyMapEntry | null {
	if ("available" !== codeMap.status) return null;
	const lines = sourceLineRange(source, candidate);
	const matches = codeMap.entries.filter(
		(entry) =>
			entry.kind === candidate.kind &&
			entry.startLine === lines.startLine &&
			entry.endLine === lines.endLine,
	);
	return 1 === matches.length ? (matches[0] ?? null) : null;
}

const CODE_OWNER_KINDS: Readonly<Record<string, true>> = {
	code: true,
	list: true,
	quote: true,
};

function sourceBlockEndWithLineEnding(
	source: string,
	block: Readonly<{ to: number }>,
): number {
	if ("\r" === source[block.to])
		return block.to + ("\n" === source[block.to + 1] ? 2 : 1);
	if ("\n" === source[block.to]) return block.to + 1;
	return block.to;
}

function preparedCodeOwner(
	index: EditorMarkdownBlockIndex,
	value: string,
	selection: EditorCodeContentSelection,
): Readonly<{ from: number; to: number }> | null {
	const selected = findEditorMarkdownBlock(index, selection.start, value);
	if (!selected || !CODE_OWNER_KINDS[selected.kind]) return null;
	let from = selected.from;
	let to = selected.to;
	for (const block of index.blocks) {
		if (block.kind === selected.kind && block.lineEnd === selected.lineEnd) {
			from = Math.min(from, block.from);
			to = Math.max(to, block.to);
		}
	}
	return {
		from,
		to: sourceBlockEndWithLineEnding(value, { to }),
	};
}

type ParsedCodeTargetContext = Readonly<{
	candidate: ParsedCodeCandidate;
	owner: Readonly<{ from: number; to: number }> | null;
	parseFrom: number;
}>;

type EditorCodeContentTargetReadResult =
	| Readonly<{ status: "available"; target: EditorCodeContentTarget }>
	| Readonly<{
			code: EditorCodeContentUnavailableCode;
			status: "unavailable";
	  }>;

function parseCodeTargetContext(
	value: string,
	selection: EditorCodeContentSelection,
	blockIndex?: EditorMarkdownBlockIndex,
): ParsedCodeTargetContext | EditorCodeContentTargetReadResult {
	if (
		"string" !== typeof value ||
		!selection ||
		!Number.isInteger(selection.start) ||
		!Number.isInteger(selection.end)
	) {
		return {
			code: "editor-code-content-input-invalid",
			status: "unavailable",
		};
	}
	if (
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end > value.length
	) {
		return {
			code: "editor-code-content-selection-invalid",
			status: "unavailable",
		};
	}
	if (
		blockIndex &&
		(blockIndex.source !== value || blockIndex.length !== value.length)
	) {
		return {
			code: "editor-code-content-block-index-stale",
			status: "unavailable",
		};
	}

	const owner = blockIndex
		? preparedCodeOwner(blockIndex, value, selection)
		: null;
	if (blockIndex && !owner) {
		return {
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		};
	}
	const parseFrom = owner?.from ?? 0;
	const parseSource = value.slice(parseFrom, owner?.to ?? value.length);
	const parseSelection = {
		end: selection.end - parseFrom,
		start: selection.start - parseFrom,
	};
	const projection = projectNewlines(parseSource);
	const matches = parserCodeCandidates(projection).filter((candidate) =>
		codeCandidateMatchesSelection(candidate, parseSelection),
	);
	if (0 === matches.length) {
		return {
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		};
	}
	if (1 !== matches.length || !matches[0]) {
		return {
			code: "editor-code-content-selection-ambiguous",
			status: "unavailable",
		};
	}
	return { candidate: matches[0], owner, parseFrom };
}

export function findEditorCodeContentTarget(
	value: string,
	selection: EditorCodeContentSelection,
	blockIndex?: EditorMarkdownBlockIndex,
): EditorCodeContentTargetReadResult {
	const parsed = parseCodeTargetContext(value, selection, blockIndex);
	if ("candidate" in parsed) {
		const targetRange = {
			from: parsed.candidate.from + parsed.parseFrom,
			to: parsed.candidate.to + parsed.parseFrom,
		};
		const ownerRange = parsed.owner ?? { from: 0, to: value.length };
		const leafLines = sourceLineRange(value, targetRange);
		const ownerLines = sourceLineRange(value, ownerRange);
		return {
			status: "available",
			target: {
				bodyFrom: parsed.candidate.bodyFrom + parsed.parseFrom,
				bodyTo: parsed.candidate.bodyTo + parsed.parseFrom,
				from: targetRange.from,
				kind: parsed.candidate.kind,
				lineEnd: leafLines.endLine,
				lineStart: leafLines.startLine,
				ownerEnd: ownerRange.to,
				ownerLineEnd: ownerLines.endLine,
				ownerLineStart: ownerLines.startLine,
				ownerFrom: ownerRange.from,
				to: targetRange.to,
			},
		};
	}
	return parsed;
}

export function readEditorCodeContent(
	value: string,
	selection: EditorCodeContentSelection,
	blockIndex?: EditorMarkdownBlockIndex,
	currentCodeMap?: EditorCodeBodyMap,
): EditorCodeContentReadResult {
	if (
		"string" !== typeof value ||
		!selection ||
		!Number.isInteger(selection.start) ||
		!Number.isInteger(selection.end)
	) {
		return {
			code: "editor-code-content-input-invalid",
			status: "unavailable",
		};
	}
	if (
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end > value.length
	) {
		return {
			code: "editor-code-content-selection-invalid",
			status: "unavailable",
		};
	}
	if (
		blockIndex &&
		(blockIndex.source !== value || blockIndex.length !== value.length)
	) {
		return {
			code: "editor-code-content-block-index-stale",
			status: "unavailable",
		};
	}
	if (!currentCodeMap) {
		return {
			code: "editor-code-content-map-unavailable",
			status: "unavailable",
		};
	}
	if (
		currentCodeMap.source !== value ||
		!currentCodeMap.signature ||
		currentCodeMap.codeMap.signature !== currentCodeMap.signature
	) {
		return {
			code: "editor-code-content-map-stale",
			status: "unavailable",
		};
	}
	if (!codeMapEntriesAreValid(value, currentCodeMap.codeMap)) {
		return {
			code: "editor-code-content-map-invalid",
			status: "unavailable",
		};
	}
	if ("unavailable" === currentCodeMap.codeMap.status) {
		return {
			code: "editor-code-content-map-unavailable",
			status: "unavailable",
		};
	}

	const targetResult = findEditorCodeContentTarget(
		value,
		selection,
		blockIndex,
	);
	if ("unavailable" === targetResult.status) return targetResult;
	const entry = codeMapEntryForCandidate(
		value,
		targetResult.target,
		currentCodeMap.codeMap,
	);
	if (!entry) {
		return {
			code: "editor-code-content-body-unavailable",
			status: "unavailable",
		};
	}
	if ("unavailable" === entry.status) {
		return {
			code: "editor-code-content-body-unavailable",
			status: "unavailable",
		};
	}
	return {
		content: entry.content,
		status: "available",
		target: targetResult.target,
	};
}
