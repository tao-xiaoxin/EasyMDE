import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	collectNodeRefDefLabels,
	endsWithBlankBlockquoteLine,
	isListSwallowingFollowingBlock,
	recordMatchedNodeRefDefs,
	wouldBeLazilyAbsorbedByPrevious,
} from "./markdown-container-preservation";
import {
	type BlockSerializer,
	createMathNewlineSentinelForNode,
	LEADING_FOUR_COLUMN_INDENT,
	nodeCanLazilyContinue,
	nodePreventsFollowingIndentedCode,
	refDefContinuationMode,
	restoreMathNewlineSentinel,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type BuiltVisualBlockSources,
	inspectReferenceDefinitionBlock,
	type ParsedVisualDocument,
	type ParsedVisualSharedGroup,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import {
	measureIndentColumns,
	readBlockquotePrefix,
	stripBlockquoteDepth,
} from "./markdown-prescanner-containers";

/**
 * Granular child preservation and intact partial-title reference-definition
 * collection for edited top-level (and nested) blockquotes.
 */

function prefixAtBlockquoteDepth(text: string, depth: number): string {
	const quotePrefix = "> ".repeat(depth);
	const blankLine = `${"> ".repeat(depth - 1)}>`;
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `${quotePrefix}${line}` : blankLine))
		.join("\n");
}

function stripAtBlockquoteDepth(text: string, depth: number): string {
	return text
		.split("\n")
		.map((line) => stripBlockquoteDepth(line, depth) ?? line)
		.join("\n");
}

function leadingIndentInQuotedLine(quotedText: string, depth: number): number {
	const nl = quotedText.indexOf("\n");
	const firstLine = nl === -1 ? quotedText : quotedText.slice(0, nl);
	const bq = readBlockquotePrefix(firstLine);
	if (bq.depth === depth) {
		return measureIndentColumns(bq.rest, bq.column);
	}
	const stripped = stripBlockquoteDepth(firstLine, depth);
	return measureIndentColumns(stripped ?? firstLine);
}

function serializeChildAtBlockquoteDepth(
	child: ProseMirrorNode,
	depth: number,
	serializeBlock: BlockSerializer,
): Readonly<{ inner: string; quoted: string }> {
	const token = createMathNewlineSentinelForNode(child);
	const innerRaw = serializeBlock(child, token ?? undefined);
	const prefixed = prefixAtBlockquoteDepth(innerRaw, depth);
	return {
		inner:
			token !== null ? restoreMathNewlineSentinel(innerRaw, token) : innerRaw,
		quoted:
			token !== null ? restoreMathNewlineSentinel(prefixed, token) : prefixed,
	};
}

/**
 * Serializes an edited top-level (or nested top-level) blockquote while
 * reusing untouched child slices and original inter-child separators (such as
 * tight `> [r]: /u\n> "a` partial-title refdef followers).
 */
export function serializeBlockquotePreservingChildren(
	bqNode: ProseMirrorNode,
	origBqNode: ProseMirrorNode,
	depth: number,
	blockquoteSources: ReadonlyMap<ProseMirrorNode, BuiltVisualBlockSources>,
	serializeBlock: BlockSerializer,
): string | null {
	const source = blockquoteSources.get(origBqNode);
	if (!source || source.blocks.length !== origBqNode.childCount) {
		return null;
	}
	const baselineBlocks = source.blocks;
	const newLen = bqNode.childCount;
	const origLen = baselineBlocks.length;
	const matchedOrigIndex = alignNodes(
		childrenOf(bqNode),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(matchedOrigIndex, origLen);
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);
	const blankLine = `${"> ".repeat(depth - 1)}>`;
	const blankQuoteSep = `\n${blankLine}\n`;
	const quotePrefix = "> ".repeat(depth);

	const parts: string[] = [];
	if (matchedOrigIndex[0] === 0 && source.leadingPrefix.length > 0) {
		parts.push(source.leadingPrefix);
	}

	const isIntactSharedGroupAt = (
		childIdx: number,
		group: ParsedVisualSharedGroup,
	): boolean => {
		const len = group.endIndex - group.startIndex;
		if (childIdx + len > newLen) return false;
		for (let offset = 0; offset < len; offset += 1) {
			if (matchedOrigIndex[childIdx + offset] !== group.startIndex + offset) {
				return false;
			}
		}
		return true;
	};
	const isTightRightNeighborIntact = (() => {
		const memo = new Map<number, boolean>();
		return (
			startIdx: number,
			startGroup: ParsedVisualSharedGroup,
		): boolean => {
			const cachedStart = memo.get(startGroup.startIndex);
			if (cachedStart !== undefined) return cachedStart;
			const chain: number[] = [];
			let curIdx = startIdx;
			let curGroup = startGroup;
			let intact = true;
			while (true) {
				const cached = memo.get(curGroup.startIndex);
				if (cached !== undefined) {
					intact = cached;
					break;
				}
				chain.push(curGroup.startIndex);
				const nextOrig = baselineBlocks[curGroup.endIndex];
				if (!nextOrig) break;
				const nextGroup =
					nextOrig.sharedGroup?.startIndex === curGroup.endIndex
						? nextOrig.sharedGroup
						: undefined;
				const nextSep = nextGroup
					? nextGroup.separatorBefore
					: nextOrig.separatorBefore;
				if (nextSep !== "\n") break;
				const afterIdx = curIdx + (curGroup.endIndex - curGroup.startIndex);
				if (
					afterIdx >= newLen ||
					matchedOrigIndex[afterIdx] !== curGroup.endIndex
				) {
					intact = false;
					break;
				}
				if (!nextGroup) break;
				if (!isIntactSharedGroupAt(afterIdx, nextGroup)) {
					intact = false;
					break;
				}
				curIdx = afterIdx;
				curGroup = nextGroup;
			}
			for (let k = 0; k < chain.length; k += 1) {
				const key = chain[k];
				if (key !== undefined) memo.set(key, intact);
			}
			return intact;
		};
	})();

	let prevInnerText = "";
	for (let idx = 0; idx < newLen; idx += 1) {
		const child = bqNode.child(idx);
		const origIdx = matchedOrigIndex[idx] ?? -1;
		const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
		const sharedGroup = origBlock?.sharedGroup;
		let intactGroup =
			sharedGroup &&
			origIdx === sharedGroup.startIndex &&
			isIntactSharedGroupAt(idx, sharedGroup) &&
			isTightRightNeighborIntact(idx, sharedGroup)
				? sharedGroup
				: undefined;
		let serialized: string | null = intactGroup
			? intactGroup.raw
			: origBlock && origBlock.raw !== null
				? origBlock.raw
				: null;
		if (intactGroup || (origBlock && !sharedGroup)) {
			effectiveOrigIndex[idx] = origIdx;
		} else if (!origBlock && child.type.name === "blockquote") {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
			if (pairedBlock && pairedBlock.node.type.name === "blockquote") {
				serialized = serializeBlockquotePreservingChildren(
					child,
					pairedBlock.node,
					depth + 1,
					blockquoteSources,
					serializeBlock,
				);
				if (serialized !== null) effectiveOrigIndex[idx] = pairedIdx;
			}
		}

		const prevNode = idx > 0 ? bqNode.child(idx - 1) : null;
		const prevMatched = idx > 0 ? (matchedOrigIndex[idx - 1] ?? -1) : -1;
		const prevWasMatchedAdjacent =
			prevMatched >= 0 && origIdx >= 0 && origIdx === prevMatched + 1;

		let generated: Readonly<{ inner: string; quoted: string }> | null = null;
		const ensureGenerated = (): Readonly<{ inner: string; quoted: string }> => {
			if (generated === null) {
				generated = serializeChildAtBlockquoteDepth(
					child,
					depth,
					serializeBlock,
				);
			}
			return generated;
		};

		const resolveJoin = (
			innerText: string,
			effIdx: number,
			groupSep?: string,
		): Readonly<{
			refDefMode: ReturnType<typeof refDefContinuationMode>;
			separator: string;
		}> => {
			const mode = prevNode
				? refDefContinuationMode(prevNode, child, innerText)
				: "none";
			if (!prevNode) return { refDefMode: mode, separator: "" };
			const prevEffIdx = effectiveOrigIndex[idx - 1] ?? -1;
			const inheritedSep =
				effIdx >= 0 && prevEffIdx >= 0 && effIdx === prevEffIdx + 1
					? (groupSep ?? baselineBlocks[effIdx]?.separatorBefore)
					: undefined;
			let sep = mode !== "none" ? "\n" : (inheritedSep ?? blankQuoteSep);
			if (mode === "none" && sep === "\n" && !prevWasMatchedAdjacent) {
				const prevRef =
					prevNode.type.name === "protected_block" &&
					prevNode.attrs.kind === "raw" &&
					typeof prevNode.attrs.rawMarkdown === "string"
						? inspectReferenceDefinitionBlock(prevNode.attrs.rawMarkdown)
						: null;
				if (prevRef?.isRefDef) {
					if (
						!prevRef.lastHasTitle &&
						wouldReferenceDefinitionAbsorbFollowingBlock(
							prevRef.lastRaw,
							innerText,
						)
					) {
						sep = blankQuoteSep;
					}
				} else if (
					isListSwallowingFollowingBlock(
						prevNode,
						prevInnerText,
						innerText,
						false,
					) ||
					(nodeCanLazilyContinue(prevNode) &&
						!endsWithBlankBlockquoteLine(prevInnerText) &&
						wouldBeLazilyAbsorbedByPrevious(child, innerText))
				) {
					sep = blankQuoteSep;
				}
			}
			return { refDefMode: mode, separator: sep };
		};

		let candidateQuoted =
			serialized !== null ? serialized : ensureGenerated().quoted;
		let candidateInner =
			serialized !== null
				? stripAtBlockquoteDepth(serialized, depth)
				: ensureGenerated().inner;
		let { refDefMode, separator } = resolveJoin(
			candidateInner,
			effectiveOrigIndex[idx] ?? -1,
			intactGroup?.separatorBefore,
		);
		const isIndentedRisk = (quotedText: string, sep: string): boolean =>
			child.type.name !== "code_block" &&
			leadingIndentInQuotedLine(quotedText, depth) >= 4 &&
			(sep !== "\n" ||
				!prevNode ||
				!nodePreventsFollowingIndentedCode(prevNode) ||
				endsWithBlankBlockquoteLine(prevInnerText));
		const isSwallowRisk = (innerText: string): boolean =>
			isListSwallowingFollowingBlock(
				prevNode,
				prevInnerText,
				innerText,
				prevWasMatchedAdjacent,
			);
		const brokenTightLeft =
			intactGroup !== undefined &&
			intactGroup.separatorBefore === "\n" &&
			(separator !== "\n" ||
				(effectiveOrigIndex[idx - 1] ?? -1) !== intactGroup.startIndex - 1);
		if (
			intactGroup &&
			(brokenTightLeft ||
				isIndentedRisk(intactGroup.raw, separator) ||
				isSwallowRisk(candidateInner))
		) {
			intactGroup = undefined;
			serialized = null;
			effectiveOrigIndex[idx] = -1;
			candidateQuoted = ensureGenerated().quoted;
			candidateInner = ensureGenerated().inner;
			({ refDefMode, separator } = resolveJoin(candidateInner, -1));
		}
		if (prevNode) parts.push(separator);
		let blockQuoted = candidateQuoted;
		let blockInner = candidateInner;
		if (
			!intactGroup &&
			serialized !== null &&
			(isIndentedRisk(serialized, separator) || isSwallowRisk(candidateInner))
		) {
			if (child.type.name === "protected_block") {
				const dedentedInner = candidateInner.replace(/^[ \t]+/, "");
				const nl = candidateQuoted.indexOf("\n");
				const firstDedented = `${quotePrefix}${dedentedInner.split("\n")[0] ?? ""}`;
				blockQuoted =
					nl === -1
						? firstDedented
						: `${firstDedented}${candidateQuoted.slice(nl)}`;
				blockInner = dedentedInner;
			} else {
				blockQuoted = ensureGenerated().quoted;
				blockInner = ensureGenerated().inner;
			}
		} else if (
			!intactGroup &&
			serialized === null &&
			child.type.name === "protected_block" &&
			isSwallowRisk(candidateInner)
		) {
			const dedentedInner = candidateInner.replace(/^[ \t]+/, "");
			const nl = candidateQuoted.indexOf("\n");
			const firstDedented = `${quotePrefix}${dedentedInner.split("\n")[0] ?? ""}`;
			blockQuoted =
				nl === -1
					? firstDedented
					: `${firstDedented}${candidateQuoted.slice(nl)}`;
			blockInner = dedentedInner;
		}
		if (
			refDefMode === "indented" &&
			!LEADING_FOUR_COLUMN_INDENT.test(blockInner)
		) {
			const nl = blockQuoted.indexOf("\n");
			const firstLine = `${quotePrefix}    ${blockInner.split("\n")[0] ?? ""}`;
			blockQuoted =
				nl === -1 ? firstLine : `${firstLine}${blockQuoted.slice(nl)}`;
			blockInner = `    ${blockInner}`;
		}
		parts.push(blockQuoted);
		prevInnerText = blockInner;
		if (intactGroup) {
			const groupLen = intactGroup.endIndex - intactGroup.startIndex;
			for (let offset = 1; offset < groupLen; offset += 1) {
				effectiveOrigIndex[idx + offset] = intactGroup.startIndex + offset;
			}
			idx += groupLen - 1;
		}
	}

	let output = parts.join("");
	const keepTrailingSuffix =
		origLen === 1 || matchedOrigIndex.some((origIdx) => origIdx >= 0);
	if (output.length > 0 && keepTrailingSuffix) {
		output += source.trailingSuffix;
	}
	return output;
}

export function collectIntactRefDefLabelsInBlockquote(
	bqNode: ProseMirrorNode,
	origBqNode: ProseMirrorNode,
	topOrigIdx: number,
	parsed: ParsedVisualDocument,
	seenLabels: Set<string>,
	intactRefDefLabels: Set<string>,
): void {
	const source = parsed.blockquoteSources?.get(origBqNode);
	if (!source || source.blocks.length !== origBqNode.childCount) {
		collectNodeRefDefLabels(bqNode, seenLabels);
		return;
	}
	const matched = alignNodes(
		childrenOf(bqNode),
		source.blocks.map((block) => block.node),
		structurallyEqual,
	);
	const paired = pairUnmatched(matched, origBqNode.childCount);
	for (let k = 0; k < bqNode.childCount; k += 1) {
		const origChildIdx = matched[k] ?? -1;
		if (origChildIdx >= 0) {
			recordMatchedNodeRefDefs(
				origBqNode.child(origChildIdx),
				topOrigIdx,
				parsed,
				seenLabels,
				intactRefDefLabels,
			);
			continue;
		}
		const childNode = bqNode.child(k);
		const pairedIdx = paired[k] ?? -1;
		const pairedOrig =
			pairedIdx >= 0 ? origBqNode.child(pairedIdx) : undefined;
		if (
			childNode.type.name === "blockquote" &&
			pairedOrig?.type.name === "blockquote" &&
			parsed.blockquoteSources?.has(pairedOrig)
		) {
			collectIntactRefDefLabelsInBlockquote(
				childNode,
				pairedOrig,
				topOrigIdx,
				parsed,
				seenLabels,
				intactRefDefLabels,
			);
		} else {
			collectNodeRefDefLabels(childNode, seenLabels);
		}
	}
}
