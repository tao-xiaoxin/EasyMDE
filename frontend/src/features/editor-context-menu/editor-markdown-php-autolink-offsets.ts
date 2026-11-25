import type {
	EditorMarkdownImageRange,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import { asciiLowerCase } from "../../shared/markdown/php-commonmark-block-scan";
import {
	isGfmEmailDomainFirstChar,
	isGfmEmailLocalChar,
} from "../../shared/markdown/php-commonmark-inline-html";
import type {
	MarkdownSyntaxNode,
	ParserLinkNode,
} from "./editor-markdown-link-preparation";
import {
	mergeRanges,
	type NewlineProjection,
	originalRange,
	type SourceRange,
} from "./editor-markdown-source-projection";

const GFM_WWW_GLOBAL_RE = /www\./gi;

function isGfmUrlSchemeBefore(source: string, schemeEnd: number): boolean {
	const tail = asciiLowerCase(
		source.slice(Math.max(0, schemeEnd - 5), schemeEnd),
	);
	return (
		tail.endsWith("http") || tail.endsWith("https") || tail.endsWith("ftp")
	);
}

/**
 * Collects sorted original-source offsets of potential bare GFM autolinks
 * (`@`, `http(s)|ftp://`, `www.`, or bare Lezer `URL` nodes) that fall outside
 * already-owned non-bare constructs (`Link`, `Autolink`, valid `Image`, math,
 * non-editable blocks, non-table `InlineCode`, `LinkReference`, and already
 * PHP-owned reconciled scopes) in strictly O(N) time so ordinary prose and
 * dense inline-link documents do zero PHP autolink work.
 */
export function collectUncoveredBareAutolinkOffsets(
	source: string,
	projection: NewlineProjection,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	rawLinkNodes: ReadonlyArray<ParserLinkNode>,
	syntaxNodes: ReadonlyArray<MarkdownSyntaxNode>,
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>,
	mathRanges: ReadonlyArray<SourceRange>,
	alreadyOwnedRanges?: ReadonlyArray<SourceRange>,
): number[] {
	const covered: SourceRange[] = [];
	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (
			block &&
			("code" === block.kind ||
				"math" === block.kind ||
				"unavailable" === block.kind)
		) {
			covered.push({ from: block.from, to: block.to });
		}
	}
	for (let i = 0; i < mathRanges.length; i += 1) {
		const range = mathRanges[i];
		if (range) covered.push({ from: range.from, to: range.to });
	}
	for (let i = 0; i < imageRanges.length; i += 1) {
		const range = imageRanges[i];
		if (range) covered.push({ from: range.from, to: range.to });
	}
	if (alreadyOwnedRanges) {
		for (let i = 0; i < alreadyOwnedRanges.length; i += 1) {
			const range = alreadyOwnedRanges[i];
			if (range) covered.push({ from: range.from, to: range.to });
		}
	}
	const bareLezerOffsets: number[] = [];
	for (let i = 0; i < rawLinkNodes.length; i += 1) {
		const node = rawLinkNodes[i];
		if (!node) continue;
		const orig = originalRange(projection, node);
		if (
			"autolink" === node.kind ||
			node.reference ||
			"[" === projection.text[node.from]
		) {
			// PHP GFM tables split cells on `|` before inline parsing, so a
			// Lezer construct spanning a pipe may not exist in PHP's output.
			if (!projection.text.slice(node.from, node.to).includes("|")) {
				covered.push(orig);
			}
		} else {
			bareLezerOffsets.push(orig.from);
		}
	}
	for (let i = 0; i < syntaxNodes.length; i += 1) {
		const node = syntaxNodes[i];
		if (!node) continue;
		if ("InlineCode" === node.name) {
			if (!projection.text.slice(node.from, node.to).includes("|")) {
				covered.push(originalRange(projection, node));
			}
		} else if (
			"LinkReference" === node.name &&
			0 === mathRanges.length &&
			!projection.text.slice(node.from, node.to).includes("|")
		) {
			covered.push(originalRange(projection, node));
		}
	}
	const coveredRanges = mergeRanges(covered);
	const triggers: number[] = [];

	// Always include bare Lezer URL nodes outside covered ranges so false
	// positives (e.g. `<www.example.com>`) and wrong boundaries are reconciled.
	let covIdx = 0;
	for (let i = 0; i < bareLezerOffsets.length; i += 1) {
		const offset = bareLezerOffsets[i];
		if (undefined === offset) continue;
		while (
			covIdx < coveredRanges.length &&
			(coveredRanges[covIdx]?.to ?? 0) <= offset
		) {
			covIdx += 1;
		}
		const cov = coveredRanges[covIdx];
		if (!cov || offset < cov.from) triggers.push(offset);
	}

	covIdx = 0;
	let atPos = source.indexOf("@", 0);
	while (atPos >= 0) {
		while (
			covIdx < coveredRanges.length &&
			(coveredRanges[covIdx]?.to ?? 0) <= atPos
		) {
			covIdx += 1;
		}
		const cov = coveredRanges[covIdx];
		if (cov && cov.from <= atPos) {
			atPos = source.indexOf("@", cov.to);
			continue;
		}
		if (
			atPos > 0 &&
			atPos + 3 < source.length &&
			isGfmEmailLocalChar(source.charCodeAt(atPos - 1)) &&
			isGfmEmailDomainFirstChar(source.charCodeAt(atPos + 1))
		) {
			triggers.push(atPos);
		}
		atPos = source.indexOf("@", atPos + 1);
	}

	covIdx = 0;
	let schemePos = source.indexOf("://", 0);
	while (schemePos >= 0) {
		while (
			covIdx < coveredRanges.length &&
			(coveredRanges[covIdx]?.to ?? 0) <= schemePos
		) {
			covIdx += 1;
		}
		const cov = coveredRanges[covIdx];
		if (cov && cov.from <= schemePos) {
			schemePos = source.indexOf("://", cov.to);
			continue;
		}
		if (
			schemePos + 3 < source.length &&
			isGfmUrlSchemeBefore(source, schemePos)
		) {
			triggers.push(schemePos);
		}
		schemePos = source.indexOf("://", schemePos + 3);
	}

	if (source.includes(".")) {
		GFM_WWW_GLOBAL_RE.lastIndex = 0;
		covIdx = 0;
		let match = GFM_WWW_GLOBAL_RE.exec(source);
		while (null !== match) {
			const pos = match.index;
			while (
				covIdx < coveredRanges.length &&
				(coveredRanges[covIdx]?.to ?? 0) <= pos
			) {
				covIdx += 1;
			}
			const cov = coveredRanges[covIdx];
			if (cov && cov.from <= pos) {
				GFM_WWW_GLOBAL_RE.lastIndex = cov.to;
				match = GFM_WWW_GLOBAL_RE.exec(source);
				continue;
			}
			if (pos + 4 < source.length) triggers.push(pos);
			match = GFM_WWW_GLOBAL_RE.exec(source);
		}
	}

	if (triggers.length <= 1) return triggers;
	triggers.sort((left, right) => left - right);
	const deduped: number[] = [];
	for (let i = 0; i < triggers.length; i += 1) {
		const value = triggers[i];
		if (undefined !== value && value !== deduped[deduped.length - 1]) {
			deduped.push(value);
		}
	}
	return deduped;
}
