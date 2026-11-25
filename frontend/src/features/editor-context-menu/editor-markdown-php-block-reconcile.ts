import type { EditorMarkdownSourceBlock } from "../../contracts/ports/editor-block-index-port";
import type {
	PhpMarkdownMathRange,
	ScannedMarkdownBlocks,
} from "../../shared/markdown/php-commonmark-block-scan";

/**
 * PHP GFM `TableParser` can start a table inside what Lezer reads as one
 * top-level link reference definition (for example a multiline refdef label
 * whose second line is a delimiter row). Lezer then reports the whole range as
 * a non-editable `unavailable` block, while PHP Preview renders a table with
 * links. This reclassifies only an exact match — the block's first line is a
 * PHP table header row, its second line is the non-inline delimiter row, and
 * every remaining line is a PHP table row of that same table — as an editable
 * `table` block. Blocks touching math or image syntax stay conservative
 * (`unavailable`), since math and image provenance was prepared under the
 * Lezer classification.
 */
export function reconcilePhpTableUnavailableBlocks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	phpBlockScan: ScannedMarkdownBlocks,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
): ReadonlyArray<EditorMarkdownSourceBlock> {
	let reconciled: EditorMarkdownSourceBlock[] | null = null;
	let mathIndex = 0;
	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		if (
			"unavailable" !== block?.kind ||
			block.lineEnd - block.lineStart < 2
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
		reconciled[index] = { ...block, editable: true, kind: "table" };
	}
	return reconciled ?? blocks;
}

function blockIsExactPhpTable(
	block: EditorMarkdownSourceBlock,
	phpBlockScan: ScannedMarkdownBlocks,
): boolean {
	const lines = phpBlockScan.lines;
	const header = lines[block.lineStart];
	const delimiter = lines[block.lineStart + 1];
	const previous = block.lineStart > 0 ? lines[block.lineStart - 1] : null;
	if (
		!header ||
		!delimiter ||
		header.lineStart !== block.from ||
		!header.isTableRow ||
		header.inlineBlockId < 0 ||
		previous?.isTableRow ||
		delimiter.isTableRow ||
		delimiter.inlineBlockId >= 0
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
