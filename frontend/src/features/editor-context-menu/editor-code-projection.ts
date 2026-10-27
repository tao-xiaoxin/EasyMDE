import type {
	PreviewCodeBodyMap,
	PreviewCodeBodyMapEntry,
	PreviewCodeProjection,
	PreviewCodeProjectionEntry,
	PreviewCodeProjectionRow,
} from "../../contracts/ports/preview-request";
import type {
	EditorSelection,
	EditorSelectionDirection,
} from "./editor-context-menu-rules";

export type EditorCodeProjectionTarget = Readonly<{
	endLine: number;
	kind: "fenced" | "indented";
	startLine: number;
}>;

export type EditorCodeProjectionContentLineRange = Readonly<{
	end: number;
	start: number;
}>;

export type EditorCodeProjectionEncodeInput = Readonly<{
	codeMap: PreviewCodeBodyMap;
	contentLineRange: EditorCodeProjectionContentLineRange;
	desiredSemanticBody: string;
	projection: PreviewCodeProjection;
	selection: EditorSelection;
	signature: string;
	source: string;
	target: EditorCodeProjectionTarget;
}>;

export type EditorCodeProjectionChange = Readonly<{
	from: number;
	insert: string;
	to: number;
}>;

export type EditorCodeProjectionUnavailableCode =
	| "editor-code-projection-input-invalid"
	| "editor-code-projection-map-stale"
	| "editor-code-projection-source-stale"
	| "editor-code-projection-target-unavailable"
	| "editor-code-projection-unsupported";

export type EditorCodeProjectionEncodeResult =
	| Readonly<{
			changes: EditorCodeProjectionChange | null;
			noop: boolean;
			selection: EditorSelection;
			status: "available";
	  }>
	| Readonly<{
			code: EditorCodeProjectionUnavailableCode;
			status: "unavailable";
	  }>;

type SourceLine = Readonly<{
	start: number;
	text: string;
}>;

type ProjectionRowProof = Readonly<{
	contentLine: number;
	literalFrom: number;
	literalLeadingSpaces: number;
	prefixEnd: number;
	prefixTabColumns: number;
	rawNonWspFrom: number;
	sourceLine: number;
}>;

type ValidatedTarget = Readonly<{
	codeEntry: Extract<PreviewCodeBodyMapEntry, { status: "available" }>;
	projectionEntry: Extract<PreviewCodeProjectionEntry, { status: "available" }>;
	rows: ReadonlyArray<ProjectionRowProof>;
}>;

function unavailable(
	code: EditorCodeProjectionUnavailableCode,
): EditorCodeProjectionEncodeResult {
	return { code, status: "unavailable" };
}

function splitSourceLines(source: string): SourceLine[] {
	const lines: SourceLine[] = [];
	let start = 0;
	for (let index = 0; index < source.length; index += 1) {
		if ("\r" !== source[index] && "\n" !== source[index]) continue;
		const contentEnd = index;
		const end =
			"\r" === source[index] && "\n" === source[index + 1]
				? index + 2
				: index + 1;
		lines.push({
			start,
			text: source.slice(start, contentEnd),
		});
		start = end;
		if (end !== index + 1) index += 1;
	}
	lines.push({
		start,
		text: source.slice(start),
	});
	return lines;
}

function splitBodyRows(body: string): string[] {
	const rows: string[] = [];
	let start = 0;
	for (let index = 0; index < body.length; index += 1) {
		if ("\r" !== body[index] && "\n" !== body[index]) continue;
		rows.push(body.slice(start, index));
		if ("\r" === body[index] && "\n" === body[index + 1]) index += 1;
		start = index + 1;
	}
	rows.push(body.slice(start));
	if (/(?:\r\n|\r|\n)$/u.test(body)) rows.pop();
	return rows;
}

function hasOnlyAsciiWhitespace(value: string): boolean {
	return /^[ \t]*$/u.test(value);
}

function isBlankSemanticRow(value: string): boolean {
	return hasOnlyAsciiWhitespace(value);
}

function leadingAsciiWhitespaceLength(value: string): number {
	let count = 0;
	while (" " === value[count] || "\t" === value[count]) count += 1;
	return count;
}

function isUtf16Boundary(value: string, position: number): boolean {
	if (position <= 0 || position >= value.length) return true;
	const previous = value.charCodeAt(position - 1);
	const current = value.charCodeAt(position);
	return !(
		previous >= 0xd800 &&
		previous <= 0xdbff &&
		current >= 0xdc00 &&
		current <= 0xdfff
	);
}

function validDirection(value: unknown): value is EditorSelectionDirection {
	return "backward" === value || "forward" === value || "none" === value;
}

function validSelection(
	selection: EditorSelection,
	sourceLength: number,
): boolean {
	return (
		Number.isSafeInteger(selection.start) &&
		Number.isSafeInteger(selection.end) &&
		selection.start >= 0 &&
		selection.start <= selection.end &&
		selection.end <= sourceLength &&
		validDirection(selection.direction)
	);
}

function sameTarget(
	entry: Readonly<{
		endLine: number;
		kind: "fenced" | "indented";
		startLine: number;
	}>,
	target: EditorCodeProjectionTarget,
): boolean {
	return (
		entry.kind === target.kind &&
		entry.startLine === target.startLine &&
		entry.endLine === target.endLine
	);
}

function validateRows(
	rows: ReadonlyArray<PreviewCodeProjectionRow>,
	codeEntry: Extract<PreviewCodeBodyMapEntry, { status: "available" }>,
	lines: ReadonlyArray<SourceLine>,
): ReadonlyArray<ProjectionRowProof> | undefined {
	const contentRows = splitBodyRows(codeEntry.content);
	const seenContent = new Set<number>();
	const seenSource = new Set<number>();
	let previousContent = -1;
	let previousSource = -1;
	const proofs: ProjectionRowProof[] = [];

	for (const row of rows) {
		if (
			!Number.isSafeInteger(row.contentLine) ||
			!Number.isSafeInteger(row.literalFrom) ||
			!Number.isSafeInteger(row.literalLeadingSpaces) ||
			!Number.isSafeInteger(row.prefixEnd) ||
			!Number.isSafeInteger(row.prefixTabColumns) ||
			!Number.isSafeInteger(row.sourceLine) ||
			row.contentLine < 0 ||
			row.contentLine >= contentRows.length ||
			row.contentLine <= previousContent ||
			row.sourceLine < codeEntry.startLine ||
			row.sourceLine >= codeEntry.endLine ||
			row.sourceLine <= previousSource ||
			row.prefixTabColumns < 0 ||
			row.prefixTabColumns > 3 ||
			row.prefixEnd < 0 ||
			row.literalFrom < 0 ||
			row.literalLeadingSpaces < 0 ||
			row.literalLeadingSpaces > 3 ||
			seenContent.has(row.contentLine) ||
			seenSource.has(row.sourceLine)
		) {
			return undefined;
		}
		const sourceLine = lines[row.sourceLine];
		const contentRow = contentRows[row.contentLine];
		if (undefined === sourceLine || undefined === contentRow) return undefined;
		const oldLeading = leadingAsciiWhitespaceLength(contentRow);
		const rawNonWspFrom =
			row.literalFrom + oldLeading - row.literalLeadingSpaces;
		if (
			row.prefixEnd > row.literalFrom ||
			row.literalFrom > sourceLine.text.length ||
			rawNonWspFrom < row.literalFrom ||
			rawNonWspFrom > sourceLine.text.length ||
			!isUtf16Boundary(sourceLine.text, row.prefixEnd) ||
			!isUtf16Boundary(sourceLine.text, row.literalFrom) ||
			!hasOnlyAsciiWhitespace(
				sourceLine.text.slice(row.prefixEnd, row.literalFrom),
			) ||
			(row.prefixTabColumns > 0 && "\t" !== sourceLine.text[row.prefixEnd]) ||
			(row.literalLeadingSpaces > 0 &&
				"\t" !== sourceLine.text[row.literalFrom - 1]) ||
			!hasOnlyAsciiWhitespace(
				sourceLine.text.slice(row.literalFrom, rawNonWspFrom),
			) ||
			" ".repeat(row.literalLeadingSpaces) +
				sourceLine.text.slice(row.literalFrom) !==
				contentRow ||
			isBlankSemanticRow(contentRow)
		) {
			return undefined;
		}
		proofs.push({
			contentLine: row.contentLine,
			literalFrom: row.literalFrom,
			literalLeadingSpaces: row.literalLeadingSpaces,
			prefixEnd: row.prefixEnd,
			prefixTabColumns: row.prefixTabColumns,
			rawNonWspFrom,
			sourceLine: row.sourceLine,
		});
		seenContent.add(row.contentLine);
		seenSource.add(row.sourceLine);
		previousContent = row.contentLine;
		previousSource = row.sourceLine;
	}

	for (let index = 0; index < contentRows.length; index += 1) {
		if (
			!isBlankSemanticRow(contentRows[index] ?? "") &&
			!seenContent.has(index)
		) {
			return undefined;
		}
	}
	return proofs;
}

function findValidatedTarget(
	input: EditorCodeProjectionEncodeInput,
	lines: ReadonlyArray<SourceLine>,
): ValidatedTarget | undefined {
	if ("available" !== input.codeMap.status) return undefined;
	if ("available" !== input.projection.status) return undefined;
	const codeMatches = input.codeMap.entries.filter((entry) =>
		sameTarget(entry, input.target),
	);
	const projectionMatches = input.projection.entries.filter((entry) =>
		sameTarget(entry, input.target),
	);
	if (1 !== codeMatches.length || 1 !== projectionMatches.length) {
		return undefined;
	}
	const codeEntry = codeMatches[0];
	const projectionEntry = projectionMatches[0];
	if (
		!codeEntry ||
		!projectionEntry ||
		"available" !== codeEntry.status ||
		"available" !== projectionEntry.status
	) {
		return undefined;
	}
	if (
		"fenced" === projectionEntry.kind &&
		(!Number.isSafeInteger(projectionEntry.fenceOffset) ||
			projectionEntry.fenceOffset < 0 ||
			projectionEntry.fenceOffset > 3 ||
			typeof projectionEntry.info !== "string")
	) {
		return undefined;
	}
	const rows = validateRows(projectionEntry.rows, codeEntry, lines);
	return undefined === rows ? undefined : { codeEntry, projectionEntry, rows };
}

function mapSelectionOffset(
	position: number,
	changes: ReadonlyArray<EditorCodeProjectionChange>,
): number {
	let mapped = position;
	for (const change of changes) {
		const delta = change.insert.length - (change.to - change.from);
		if (change.from === change.to) {
			if (position < change.from) break;
			mapped += delta;
			continue;
		}
		if (position <= change.from) break;
		if (position >= change.to) {
			mapped += delta;
			continue;
		}
		return (
			change.from +
			(mapped - position) +
			Math.min(position - change.from, change.insert.length)
		);
	}
	return mapped;
}

function mappedSelection(
	selection: EditorSelection,
	changes: ReadonlyArray<EditorCodeProjectionChange>,
): EditorSelection {
	if (0 === changes.length) return selection;
	return {
		direction: selection.direction,
		end: mapSelectionOffset(selection.end, changes),
		start: mapSelectionOffset(selection.start, changes),
	};
}

function compactChange(
	source: string,
	changes: ReadonlyArray<EditorCodeProjectionChange>,
): EditorCodeProjectionChange {
	const from = changes[0]?.from ?? 0;
	const to = changes[changes.length - 1]?.to ?? from;
	let cursor = from;
	let insert = "";
	for (const change of changes) {
		insert += source.slice(cursor, change.from) + change.insert;
		cursor = change.to;
	}
	return { from, insert: insert + source.slice(cursor, to), to };
}

export function encodeEditorCodeProjection(
	input: EditorCodeProjectionEncodeInput,
): EditorCodeProjectionEncodeResult {
	if (
		!input ||
		"string" !== typeof input.source ||
		"string" !== typeof input.signature ||
		!input.signature ||
		"string" !== typeof input.desiredSemanticBody ||
		!validSelection(input.selection, input.source.length) ||
		!Number.isSafeInteger(input.target.startLine) ||
		!Number.isSafeInteger(input.target.endLine) ||
		input.target.startLine < 0 ||
		input.target.endLine <= input.target.startLine ||
		!Number.isSafeInteger(input.contentLineRange.start) ||
		!Number.isSafeInteger(input.contentLineRange.end) ||
		input.contentLineRange.start < 0 ||
		input.contentLineRange.end < input.contentLineRange.start
	) {
		return unavailable("editor-code-projection-input-invalid");
	}
	if (
		input.codeMap.signature !== input.signature ||
		input.projection.signature !== input.signature
	) {
		return unavailable("editor-code-projection-map-stale");
	}
	const lines = splitSourceLines(input.source);
	if (input.target.endLine > lines.length) {
		return unavailable("editor-code-projection-source-stale");
	}
	const hasAvailableTarget =
		"available" === input.codeMap.status &&
		"available" === input.projection.status &&
		1 ===
			input.codeMap.entries.filter(
				(entry) =>
					sameTarget(entry, input.target) && "available" === entry.status,
			).length &&
		1 ===
			input.projection.entries.filter(
				(entry) =>
					sameTarget(entry, input.target) && "available" === entry.status,
			).length;
	const target = findValidatedTarget(input, lines);
	if (!target) {
		return unavailable(
			hasAvailableTarget
				? "editor-code-projection-source-stale"
				: "editor-code-projection-target-unavailable",
		);
	}
	const contentRows = splitBodyRows(target.codeEntry.content);
	if (
		input.contentLineRange.start > contentRows.length ||
		input.contentLineRange.end > contentRows.length
	) {
		return unavailable("editor-code-projection-input-invalid");
	}
	const desiredRows = splitBodyRows(input.desiredSemanticBody);
	if (desiredRows.length !== contentRows.length) {
		return unavailable("editor-code-projection-input-invalid");
	}

	const edits: EditorCodeProjectionChange[] = [];
	for (const row of target.rows) {
		const sourceLine = lines[row.sourceLine];
		const formalRow = contentRows[row.contentLine];
		const desiredRow = desiredRows[row.contentLine];
		if (
			undefined === sourceLine ||
			undefined === formalRow ||
			undefined === desiredRow
		) {
			return unavailable("editor-code-projection-source-stale");
		}
		if (desiredRow === formalRow) continue;
		if (
			row.contentLine < input.contentLineRange.start ||
			row.contentLine >= input.contentLineRange.end
		) {
			continue;
		}
		if (isBlankSemanticRow(formalRow)) {
			if (desiredRow !== formalRow) {
				return unavailable("editor-code-projection-unsupported");
			}
			continue;
		}
		const formalLeading = leadingAsciiWhitespaceLength(formalRow);
		const desiredLeading = leadingAsciiWhitespaceLength(desiredRow);
		if (desiredRow.slice(desiredLeading) !== formalRow.slice(formalLeading)) {
			return unavailable("editor-code-projection-unsupported");
		}
		const expectedPrefix = " ".repeat(
			row.prefixTabColumns +
				("fenced" === target.projectionEntry.kind
					? target.projectionEntry.fenceOffset
					: 4) +
				desiredLeading,
		);
		const currentPrefix = sourceLine.text.slice(
			row.prefixEnd,
			row.rawNonWspFrom,
		);
		if (currentPrefix === expectedPrefix) continue;
		edits.push({
			from: sourceLine.start + row.prefixEnd,
			insert: expectedPrefix,
			to: sourceLine.start + row.rawNonWspFrom,
		});
	}

	if (0 === edits.length) {
		return {
			changes: null,
			noop: true,
			selection: input.selection,
			status: "available",
		};
	}
	const change = compactChange(input.source, edits);
	return {
		changes: change,
		noop: false,
		selection: mappedSelection(input.selection, edits),
		status: "available",
	};
}
