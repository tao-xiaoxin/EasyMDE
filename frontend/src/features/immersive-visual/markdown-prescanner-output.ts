import {
	isCommonMarkBlankLine,
	type LineAnalysis,
	stripBlockContainerPrefix,
} from "./markdown-prescanner-blocks";
import type { ProtectedInlineEntry } from "./markdown-prescanner-inline";
import type { ProtectedBlockKind } from "./visual-schema";

/**
 * Prescanner output assembly: collision-free internal sentinels, the output
 * line buffer with its raw-line provenance (`outputLineRanges` /
 * `outputLineSharedRanges`), protected-block and table-alignment token
 * allocation, and the inverse sentinel restoration used by the parser.
 */

export type ProtectedBlockEntry = Readonly<{
	kind: ProtectedBlockKind;
	rawMarkdown: string;
}>;

export type PrescannedLineRange = Readonly<{
	end: number;
	start: number;
}>;

type ProtectedTokenMaps = Readonly<{
	protectedBlocks: ReadonlyMap<string, ProtectedBlockEntry>;
	protectedInlines: ReadonlyMap<string, ProtectedInlineEntry>;
	tableAlignMarkers: ReadonlyMap<string, string>;
}>;

const INTERNAL_TOKEN_PATTERN = /EASYMDEPH[A-Z]*(?:INL|BLK|TBLALIGN|BR)\d*END/g;

export function createCollisionFreeSentinel(source: string): string {
	let sentinel = "EASYMDEPH";
	while (source.includes(sentinel)) {
		sentinel = `${sentinel}X`;
	}
	return sentinel;
}

/**
 * Undo every accidental internal sentinel that could otherwise reach a
 * ProseMirror node attribute or code block text.
 */
export function restoreProtectedInlineSentinels(
	text: string,
	preScan: ProtectedTokenMaps,
): string {
	if (text.length === 0 || !text.includes("EASYMDEPH")) {
		return text;
	}
	return text.replace(INTERNAL_TOKEN_PATTERN, (token) => {
		const inline = preScan.protectedInlines.get(token);
		if (inline) return inline.rawMarkdown;
		const block = preScan.protectedBlocks.get(token);
		if (block) return block.rawMarkdown;
		const marker = preScan.tableAlignMarkers.get(token);
		if (marker !== undefined) return marker;
		return token.endsWith("BREND") ? "<br>" : token;
	});
}

/** One prescanner output buffer over the normalized source `lines`. */
export function createPrescanOutput(
	lines: ReadonlyArray<string>,
	sentinel: string,
) {
	const outputLines: string[] = [];
	const outputLineRanges: Array<PrescannedLineRange | null> = [];
	const outputLineSharedRanges: Array<PrescannedLineRange | null> = [];
	const protectedBlocks = new Map<string, ProtectedBlockEntry>();
	const tableAlignMarkers = new Map<string, string>();

	const pushOutputLine = (
		text: string,
		range: PrescannedLineRange | null,
	): void => {
		outputLines.push(text);
		outputLineRanges.push(range);
		outputLineSharedRanges.push(null);
	};

	const markSharedOutputSpan = (
		outStart: number,
		rawStart: number,
		rawEnd: number,
	): void => {
		if (rawEnd <= rawStart) return;
		const span: PrescannedLineRange = { end: rawEnd, start: rawStart };
		for (let idx = outStart; idx < outputLines.length; idx += 1) {
			if (
				outputLineRanges[idx] === null &&
				!isCommonMarkBlankLine(outputLines[idx] ?? "")
			) {
				outputLineSharedRanges[idx] = span;
			}
		}
	};

	const addProtectedBlock = (
		kind: ProtectedBlockKind,
		rawBlock: string,
	): string => {
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		protectedBlocks.set(token, { kind, rawMarkdown: rawBlock });
		return token;
	};

	const addTableAlignMarker = (markerText: string): string => {
		const markerToken = `${sentinel}TBLALIGN${tableAlignMarkers.size}END`;
		tableAlignMarkers.set(markerToken, markerText);
		return markerToken;
	};

	const pushProtectedBlock = (
		kind: ProtectedBlockKind,
		{ indent, prefix }: Pick<LineAnalysis, "indent" | "prefix">,
		origStart: number,
		lastLine: number,
		sentinelIndent = indent,
		sentinelPrefix = prefix,
	): void => {
		const origEnd = lastLine + 1;
		const rawBlock = lines
			.slice(origStart, origEnd)
			.map((blockLine) => stripBlockContainerPrefix(blockLine, prefix, indent))
			.join("\n");
		const token = addProtectedBlock(kind, rawBlock);
		pushOutputLine(`${sentinelPrefix}${" ".repeat(sentinelIndent)}${token}`, {
			end: origEnd,
			start: origStart,
		});
	};

	return {
		addProtectedBlock,
		addTableAlignMarker,
		markSharedOutputSpan,
		outputLineRanges,
		outputLineSharedRanges,
		outputLines,
		protectedBlocks,
		pushOutputLine,
		pushProtectedBlock,
		tableAlignMarkers,
	};
}
