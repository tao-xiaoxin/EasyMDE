import type MarkdownIt from "markdown-it";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	decodeCommonMarkTitle,
	decodeWpKsesRenderedTitle,
	parseImageScaleTitleContract,
} from "../../shared/image-scale-title";
import {
	type PreScanResult,
	restoreProtectedInlineSentinels,
} from "./markdown-prescanner";
import {
	isValidVisualImageScale,
	type VisualImageScale,
	visualEditorSchema,
} from "./visual-schema";

export const RAW_IMAGE_TITLE_META_KEY = "easymdeRawTitle";
export const RAW_LINK_TITLE_META_KEY = "easymdeRawLinkTitle";
export const RAW_REFERENCE_LINK_META_KEY = "easymdeRawReferenceLink";
export const PHP_PARTIAL_TITLE_REF_META_KEY = "easymdePhpPartialTitleRef";
export const PENDING_PARTIAL_TITLE_LABEL_META_KEY =
	"easymdePendingPartialTitleLabel";

type RawReferenceLinkMeta = Readonly<{
	kind: "shortcut" | "collapsed" | "full";
	normalizedLabel: string;
	rawRefLabel: string;
}>;

export function findFirstLinkOpenToken(
	tokens: ReadonlyArray<MarkdownToken>,
	fromIndex: number,
): MarkdownToken | undefined {
	for (let idx = fromIndex; idx < tokens.length; idx += 1) {
		if (tokens[idx]?.type === "link_open") {
			return tokens[idx];
		}
	}
	return undefined;
}

export function lineStartsQuoteOrParenTitle(
	src: string,
	startOffset: number,
	endOffset: number,
): boolean {
	if (startOffset < 0 || startOffset >= endOffset) {
		return false;
	}
	const ch = src.charCodeAt(startOffset);
	return ch === 0x22 || ch === 0x27 || ch === 0x28;
}

export function buildRawReferenceLinkMeta(
	src: string,
	startPos: number,
	labelEnd: number,
	endPos: number,
	normalizedLabel: string,
): RawReferenceLinkMeta | null {
	if (labelEnd < 0 || labelEnd >= endPos) {
		return null;
	}
	if (endPos === labelEnd + 1) {
		return {
			kind: "shortcut",
			normalizedLabel,
			rawRefLabel: src.slice(startPos + 1, labelEnd),
		};
	}
	if (
		endPos === labelEnd + 3 &&
		src.charCodeAt(labelEnd + 1) === 91 &&
		src.charCodeAt(labelEnd + 2) === 93
	) {
		return {
			kind: "collapsed",
			normalizedLabel,
			rawRefLabel: src.slice(startPos + 1, labelEnd),
		};
	}
	if (
		endPos > labelEnd + 3 &&
		src.charCodeAt(labelEnd + 1) === 91 &&
		src.charCodeAt(endPos - 1) === 93
	) {
		return {
			kind: "full",
			normalizedLabel,
			rawRefLabel: src.slice(labelEnd + 2, endPos - 1),
		};
	}
	return null;
}

export type ReferenceLinkOrigin = Readonly<{
	href: string;
	kind: "shortcut" | "collapsed" | "full";
	normalizedLabel: string;
	rawRefLabel: string;
	title: string | null;
}>;

export type ReferenceImageOrigin = Readonly<{
	kind: "shortcut" | "collapsed" | "full";
	normalizedLabel: string;
	rawRefLabel: string;
	scale: VisualImageScale | null;
	src: string;
	title: string | null;
}>;

export type InlineReferenceCollectors = Readonly<{
	referencedLabelsByNode: Map<ProseMirrorNode, ReadonlySet<string>>;
	referenceImages: Map<ProseMirrorNode, ReferenceImageOrigin>;
	referenceLinks: Map<Mark, ReferenceLinkOrigin>;
}>;

export function readRawMetaString(
	token: MarkdownToken,
	key: string,
): string | null {
	if (!token.meta || typeof token.meta !== "object") {
		return null;
	}
	const value = (token.meta as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

function readRawReferenceLinkMeta(
	token: MarkdownToken,
): RawReferenceLinkMeta | null {
	if (!token.meta || typeof token.meta !== "object") {
		return null;
	}
	const raw = (token.meta as Record<string, unknown>)[
		RAW_REFERENCE_LINK_META_KEY
	];
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const candidate = raw as Record<string, unknown>;
	const kind = candidate.kind;
	if (
		(kind !== "shortcut" && kind !== "collapsed" && kind !== "full") ||
		typeof candidate.normalizedLabel !== "string" ||
		typeof candidate.rawRefLabel !== "string"
	) {
		return null;
	}
	return {
		kind,
		normalizedLabel: candidate.normalizedLabel,
		rawRefLabel: candidate.rawRefLabel,
	};
}

/** Feature-private inline token mapping for the immersive visual parser. */
export type MarkdownToken = ReturnType<
	InstanceType<typeof MarkdownIt>["parse"]
>[number];

export type ParsedImageScaleTitle = Readonly<{
	scale: VisualImageScale | null;
	title: string | null;
}>;

export function parseImageScaleTitle(
	rawTitle: string | null | undefined,
): ParsedImageScaleTitle {
	if (typeof rawTitle !== "string" || rawTitle.length === 0) {
		return { scale: null, title: null };
	}
	const parsed = parseImageScaleTitleContract(rawTitle);
	if (parsed.status !== "valid" || !isValidVisualImageScale(parsed.scale)) {
		return { scale: null, title: rawTitle };
	}
	return {
		scale: parsed.scale,
		title:
			parsed.title !== null && parsed.title.length > 0 ? parsed.title : null,
	};
}

export function tokenAttrString(
	token: MarkdownToken,
	name: string,
): string | null {
	const value = token.attrGet(name);
	return value === null ? null : String(value);
}

const EMPTY_MARKS: readonly Mark[] = [];

function splitTextWithProtectedInlines(
	text: string,
	activeMarks: readonly Mark[],
	preScan: PreScanResult,
): ProseMirrorNode[] {
	if (text.length === 0) {
		return [];
	}
	if (!text.includes("EASYMDEPH")) {
		return [visualEditorSchema.text(text, activeMarks)];
	}
	const result: ProseMirrorNode[] = [];
	const tokenPattern = new RegExp(
		`${preScan.sentinel}(?:INL(\\d+)|BR(\\d*))END`,
		"g",
	);
	let lastPos = 0;
	let match = tokenPattern.exec(text);
	while (match !== null) {
		if (match.index > lastPos) {
			result.push(
				visualEditorSchema.text(
					restoreProtectedInlineSentinels(
						text.slice(lastPos, match.index),
						preScan,
					),
					activeMarks,
				),
			);
		}
		if (match[2] !== undefined) {
			result.push(
				visualEditorSchema.nodes.hard_break.create(null, null, activeMarks),
			);
		} else {
			const entry = preScan.protectedInlines.get(match[0]);
			result.push(
				entry
					? visualEditorSchema.nodes.protected_inline.create(
							{
								kind: entry.kind,
								rawMarkdown: entry.rawMarkdown,
								...(entry.continuationIndent === true
									? { continuationIndent: true }
									: {}),
							},
							null,
							activeMarks,
						)
					: visualEditorSchema.text(
							restoreProtectedInlineSentinels(match[0], preScan),
							activeMarks,
						),
			);
		}
		lastPos = match.index + match[0].length;
		match = tokenPattern.exec(text);
	}
	if (lastPos < text.length) {
		result.push(
			visualEditorSchema.text(
				restoreProtectedInlineSentinels(text.slice(lastPos), preScan),
				activeMarks,
			),
		);
	}
	return result;
}

/**
 * CommonMark cannot represent a hard break at the end of a text block, so
 * trailing breaks are canonicalized away instead of corrupting the paragraph.
 */
function trimTrailingHardBreaks(
	nodes: ReadonlyArray<ProseMirrorNode>,
): ProseMirrorNode[] {
	let end = nodes.length;
	while (end > 0 && nodes[end - 1]?.type.name === "hard_break") {
		end -= 1;
	}
	return nodes.slice(0, end);
}

export type TitleDecodePreScan = Pick<
	PreScanResult,
	"protectedBlocks" | "protectedInlines" | "sentinel" | "tableAlignMarkers"
>;

export function decodeTitleKeepingInlineMathSentinels(
	rawTitle: string,
	preScan?: TitleDecodePreScan,
): string {
	if (!preScan || !rawTitle.includes(preScan.sentinel)) {
		return decodeCommonMarkTitle(
			rawTitle.replace(/\r\n|\r/gu, "\n").replace(/\n[ \t]+/gu, "\n"),
		);
	}
	const tokenPattern = new RegExp(
		`${preScan.sentinel}(?:INL\\d+|BLK\\d+|TBLALIGN\\d+|BR\\d*)END`,
		"g",
	);
	const withNonMathRestored = rawTitle.replace(tokenPattern, (token) => {
		const inline = preScan.protectedInlines.get(token);
		if (inline?.kind === "math-inline") {
			return token;
		}
		return restoreProtectedInlineSentinels(token, preScan);
	});
	return decodeCommonMarkTitle(
		withNonMathRestored.replace(/\r\n|\r/gu, "\n").replace(/\n[ \t]+/gu, "\n"),
	);
}

function decodeInlineTitlePreservingMath(
	rawTitle: string,
	preScan: TitleDecodePreScan,
): string {
	const decoded = decodeTitleKeepingInlineMathSentinels(rawTitle, preScan);
	return restoreProtectedInlineSentinels(decoded, preScan);
}

export function mapInlineTokens(
	tokens: ReadonlyArray<MarkdownToken> | null,
	preScan: PreScanResult,
	inTableCell: boolean,
	collectors?: InlineReferenceCollectors,
	blockReferencedLabels?: Set<string>,
	documentLinkOccurrences?: Map<string, number>,
): ProseMirrorNode[] {
	if (!tokens || tokens.length === 0) {
		return [];
	}
	const output: ProseMirrorNode[] = [];
	const markStack: Mark[] = [];
	const linkOccurrences = documentLinkOccurrences ?? new Map<string, number>();
	let pendingPlainText = "";

	const flushPlainText = (): void => {
		if (pendingPlainText.length > 0) {
			output.push(visualEditorSchema.text(pendingPlainText, EMPTY_MARKS));
			pendingPlainText = "";
		}
	};

	const currentMarkSet = (): readonly Mark[] =>
		markStack.length === 0
			? EMPTY_MARKS
			: markStack.reduce<readonly Mark[]>(
					(set, mark) => mark.addToSet(set),
					EMPTY_MARKS,
				);

	const popMark = (markName: string): void => {
		for (let i = markStack.length - 1; i >= 0; i -= 1) {
			if (markStack[i]?.type.name === markName) {
				markStack.splice(i, 1);
				return;
			}
		}
	};

	for (const token of tokens) {
		switch (token.type) {
			case "text":
				if (markStack.length === 0 && !token.content.includes("EASYMDEPH")) {
					pendingPlainText += token.content;
				} else {
					flushPlainText();
					output.push(
						...splitTextWithProtectedInlines(
							token.content,
							currentMarkSet(),
							preScan,
						),
					);
				}
				break;
			case "code_inline": {
				flushPlainText();
				const codeText = restoreProtectedInlineSentinels(
					token.content,
					preScan,
				);
				if (codeText.length > 0) {
					const codeMarks = visualEditorSchema.marks.code
						.create()
						.addToSet(currentMarkSet());
					output.push(visualEditorSchema.text(codeText, codeMarks));
				}
				break;
			}
			case "softbreak":
				if (markStack.length === 0) {
					pendingPlainText += "\n";
				} else {
					flushPlainText();
					output.push(visualEditorSchema.text("\n", currentMarkSet()));
				}
				break;
			case "hardbreak":
				flushPlainText();
				output.push(
					visualEditorSchema.nodes.hard_break.create(
						null,
						null,
						currentMarkSet(),
					),
				);
				break;
			case "strong_open":
				flushPlainText();
				markStack.push(visualEditorSchema.marks.strong.create());
				break;
			case "strong_close":
				popMark("strong");
				break;
			case "em_open":
				flushPlainText();
				markStack.push(visualEditorSchema.marks.em.create());
				break;
			case "em_close":
				popMark("em");
				break;
			case "s_open":
				flushPlainText();
				markStack.push(visualEditorSchema.marks.strike.create());
				break;
			case "s_close":
				popMark("strike");
				break;
			case "link_open": {
				flushPlainText();
				const rawInlineTitle = readRawMetaString(
					token,
					RAW_LINK_TITLE_META_KEY,
				);
				const effectiveTitle =
					rawInlineTitle !== null
						? decodeInlineTitlePreservingMath(rawInlineTitle, preScan)
						: restoreProtectedInlineSentinels(
								tokenAttrString(token, "title") ?? "",
								preScan,
							);
				const linkHref = restoreProtectedInlineSentinels(
					tokenAttrString(token, "href") ?? "",
					preScan,
				);
				const linkTitle = effectiveTitle.length > 0 ? effectiveTitle : null;
				const occurrenceKey = JSON.stringify([linkHref, linkTitle]);
				const occurrenceIndex = linkOccurrences.get(occurrenceKey) ?? 0;
				linkOccurrences.set(occurrenceKey, occurrenceIndex + 1);
				const linkMark = visualEditorSchema.marks.link.create({
					href: linkHref,
					title: linkTitle,
					boundaryKey: occurrenceIndex > 0 ? String(occurrenceIndex) : null,
				});
				if (collectors) {
					const rawRefMeta = readRawReferenceLinkMeta(token);
					if (rawRefMeta !== null) {
						blockReferencedLabels?.add(rawRefMeta.normalizedLabel);
						collectors.referenceLinks.set(linkMark, {
							href: linkHref,
							kind: rawRefMeta.kind,
							normalizedLabel: rawRefMeta.normalizedLabel,
							rawRefLabel: restoreProtectedInlineSentinels(
								rawRefMeta.rawRefLabel,
								preScan,
							),
							title: linkTitle,
						});
					}
				}
				markStack.push(linkMark);
				break;
			}
			case "link_close":
				popMark("link");
				break;
			case "image": {
				flushPlainText();
				const rawInlineTitle = readRawMetaString(
					token,
					RAW_IMAGE_TITLE_META_KEY,
				);
				const effectiveTitle =
					rawInlineTitle !== null
						? decodeInlineTitlePreservingMath(rawInlineTitle, preScan)
						: restoreProtectedInlineSentinels(
								tokenAttrString(token, "title") ?? "",
								preScan,
							);
				const ksesParsed = parseImageScaleTitle(
					decodeWpKsesRenderedTitle(effectiveTitle),
				);
				const parsed =
					ksesParsed.scale !== null
						? ksesParsed
						: {
								scale: null,
								title: effectiveTitle.length > 0 ? effectiveTitle : null,
							};
				const rawAlt = token.children
					? token.children.map((c) => c.content).join("")
					: token.content;
				const imageSrc = restoreProtectedInlineSentinels(
					tokenAttrString(token, "src") ?? "",
					preScan,
				);
				const imageNode = visualEditorSchema.nodes.image.create(
					{
						src: imageSrc,
						alt: restoreProtectedInlineSentinels(rawAlt, preScan),
						title: parsed.title,
						scale: parsed.scale,
					},
					null,
					currentMarkSet(),
				);
				if (collectors) {
					const rawRefMeta = readRawReferenceLinkMeta(token);
					if (rawRefMeta !== null) {
						blockReferencedLabels?.add(rawRefMeta.normalizedLabel);
						collectors.referenceImages.set(imageNode, {
							kind: rawRefMeta.kind,
							normalizedLabel: rawRefMeta.normalizedLabel,
							rawRefLabel: restoreProtectedInlineSentinels(
								rawRefMeta.rawRefLabel,
								preScan,
							),
							scale: parsed.scale,
							src: imageSrc,
							title: parsed.title,
						});
					}
				}
				output.push(imageNode);
				break;
			}
			default:
				if (token.content.length > 0) {
					flushPlainText();
					output.push(
						...splitTextWithProtectedInlines(
							token.content,
							currentMarkSet(),
							preScan,
						),
					);
				}
				break;
		}
	}
	flushPlainText();

	// A table cell can represent a trailing break as `<br>`; a text block cannot.
	return inTableCell ? output : trimTrailingHardBreaks(output);
}
