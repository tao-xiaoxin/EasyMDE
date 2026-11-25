import type { EditorMarkdownSourceBlock } from "../../contracts/ports/editor-block-index-port";
import type {
	PhpMarkdownMathRange,
	ScannedMarkdownBlocks,
} from "../../shared/markdown/php-commonmark-block-scan";

export type ReconciledPhpTableBlocks = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	reconciledTableBlocks: ReadonlyArray<EditorMarkdownSourceBlock>;
}>;

/**
 * PHP GFM `TableParser` can start a table inside what Lezer reads as one
 * top-level link reference definition (for example a 2-line refdef or
 * multiline refdef label whose second line is a delimiter row). Lezer then
 * reports the whole range as a non-editable `unavailable` block, while PHP
 * Preview renders a table with links. This reclassifies only an exact match —
 * the block's first line is a PHP table header row (not preceded by a table
 * row or delimiter), its second line is an explicit PHP table delimiter row,
 * every remaining line is a PHP table row of that same table, and the
 * following line is neither a table row nor a delimiter — as an editable
 * `table` block. Blocks touching math or image syntax stay conservative
 * (`unavailable`), since math and image provenance was prepared under the
 * Lezer classification.
 */
export function reconcilePhpTableUnavailableBlocks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	phpBlockScan: ScannedMarkdownBlocks,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
): ReconciledPhpTableBlocks {
	let reconciled: EditorMarkdownSourceBlock[] | null = null;
	const reconciledTableBlocks: EditorMarkdownSourceBlock[] = [];
	let mathIndex = 0;
	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		if (
			"unavailable" !== block?.kind ||
			block.lineEnd - block.lineStart < 1
		) {
			continue;
		}
		while (
			mathIndex < phpMathRanges.length &&
			(phpMathRanges[mathIndex]?.to ?? 0) <= block.from
		) {
			mathIndex += 1;
		}
		const math = phpMathRanges[mathIndex];
		if (
			(math && math.from < block.to) ||
			source.slice(block.from, block.to).includes("![") ||
			!blockIsExactPhpTable(block, phpBlockScan)
		) {
			continue;
		}
		if (!reconciled) reconciled = blocks.slice();
		const tableBlock: EditorMarkdownSourceBlock = {
			...block,
			editable: true,
			kind: "table",
		};
		reconciled[index] = tableBlock;
		reconciledTableBlocks.push(tableBlock);
	}
	return {
		blocks: reconciled ?? blocks,
		reconciledTableBlocks,
	};
}

function blockIsExactPhpTable(
	block: EditorMarkdownSourceBlock,
	phpBlockScan: ScannedMarkdownBlocks,
): boolean {
	const lines = phpBlockScan.lines;
	const header = lines[block.lineStart];
	const delimiter = lines[block.lineStart + 1];
	const previous = block.lineStart > 0 ? lines[block.lineStart - 1] : null;
	const next =
		block.lineEnd + 1 < lines.length ? lines[block.lineEnd + 1] : null;
	if (
		!header ||
		!delimiter ||
		header.lineStart !== block.from ||
		!header.isTableRow ||
		header.inlineBlockId < 0 ||
		previous?.isTableRow ||
		previous?.isTableDelimiter ||
		!delimiter.isTableDelimiter ||
		delimiter.isTableRow ||
		delimiter.inlineBlockId >= 0 ||
		next?.isTableRow ||
		next?.isTableDelimiter
	) {
		return false;
	}
	for (let line = block.lineStart + 2; line <= block.lineEnd; line += 1) {
		const row = lines[line];
		if (
			!row?.isTableRow ||
			row.inlineBlockId < 0 ||
			row.tableColumnCount !== header.tableColumnCount
		) {
			return false;
		}
	}
	return lines[block.lineEnd]?.lineEnd === block.to;
}
