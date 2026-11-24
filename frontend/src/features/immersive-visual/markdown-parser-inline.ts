import type MarkdownIt from "markdown-it";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	decodeCommonMarkTitle,
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

function splitTextWithProtectedInlines(
	text: string,
	activeMarks: readonly Mark[],
	preScan: PreScanResult,
): ProseMirrorNode[] {
	if (text.length === 0) {
		return [];
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
							{ kind: entry.kind, rawMarkdown: entry.rawMarkdown },
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

export function mapInlineTokens(
	tokens: ReadonlyArray<MarkdownToken> | null,
	preScan: PreScanResult,
	inTableCell: boolean,
): ProseMirrorNode[] {
	if (!tokens || tokens.length === 0) {
		return [];
	}
	const output: ProseMirrorNode[] = [];
	const markStack: Mark[] = [];

	const currentMarkSet = (): readonly Mark[] =>
		markStack.reduce<readonly Mark[]>((set, mark) => mark.addToSet(set), []);

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
				output.push(
					...splitTextWithProtectedInlines(
						token.content,
						currentMarkSet(),
						preScan,
					),
				);
				break;
			case "code_inline": {
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
				output.push(visualEditorSchema.text("\n", currentMarkSet()));
				break;
			case "hardbreak":
				output.push(
					visualEditorSchema.nodes.hard_break.create(
						null,
						null,
						currentMarkSet(),
					),
				);
				break;
			case "strong_open":
				markStack.push(visualEditorSchema.marks.strong.create());
				break;
			case "strong_close":
				popMark("strong");
				break;
			case "em_open":
				markStack.push(visualEditorSchema.marks.em.create());
				break;
			case "em_close":
				popMark("em");
				break;
			case "s_open":
				markStack.push(visualEditorSchema.marks.strike.create());
				break;
			case "s_close":
				popMark("strike");
				break;
			case "link_open": {
				const rawTitle = restoreProtectedInlineSentinels(
					tokenAttrString(token, "title") ?? "",
					preScan,
				);
				markStack.push(
					visualEditorSchema.marks.link.create({
						href: restoreProtectedInlineSentinels(
							tokenAttrString(token, "href") ?? "",
							preScan,
						),
						title: rawTitle.length > 0 ? rawTitle : null,
					}),
				);
				break;
			}
			case "link_close":
				popMark("link");
				break;
			case "image": {
				const rawInlineTitle =
					token.meta &&
					typeof token.meta === "object" &&
					typeof (token.meta as Record<string, unknown>)[
						RAW_IMAGE_TITLE_META_KEY
					] === "string"
						? String(
								(token.meta as Record<string, unknown>)[
									RAW_IMAGE_TITLE_META_KEY
								],
							)
						: null;
				const effectiveTitle =
					rawInlineTitle !== null
						? decodeCommonMarkTitle(
								restoreProtectedInlineSentinels(rawInlineTitle, preScan)
									.replace(/\r\n|\r/gu, "\n")
									.replace(/\n[ \t]+/gu, "\n"),
							)
						: restoreProtectedInlineSentinels(
								tokenAttrString(token, "title") ?? "",
								preScan,
							);
				const parsed = parseImageScaleTitle(effectiveTitle);
				const rawAlt = token.children
					? token.children.map((c) => c.content).join("")
					: token.content;
				output.push(
					visualEditorSchema.nodes.image.create(
						{
							src: restoreProtectedInlineSentinels(
								tokenAttrString(token, "src") ?? "",
								preScan,
							),
							alt: restoreProtectedInlineSentinels(rawAlt, preScan),
							title: parsed.title,
							scale: parsed.scale,
						},
						null,
						currentMarkSet(),
					),
				);
				break;
			}
			default:
				if (token.content.length > 0) {
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

	// A table cell can represent a trailing break as `<br>`; a text block cannot.
	return inTableCell ? output : trimTrailingHardBreaks(output);
}
