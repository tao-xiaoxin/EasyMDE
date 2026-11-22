import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type EditorState,
	Plugin,
	PluginKey,
	type Transaction,
} from "prosemirror-state";
import {
	Decoration,
	DecorationSet,
	type EditorView,
	type NodeView,
	type NodeViewConstructor,
	type ViewMutationRecord,
} from "prosemirror-view";

export type HighlightJsResult = Readonly<{ value: string }>;

export type HighlightJsRuntime = Readonly<{
	getLanguage?: (languageName: string) => unknown;
	highlight?: (
		code: string,
		options: Readonly<{ ignoreIllegals?: boolean; language: string }>,
	) => HighlightJsResult;
}>;

export type CodeBlockNodeViewOptions = Readonly<{
	syncFrameBackground?: boolean;
}>;

export type CodeHighlightPluginOptions = Readonly<{
	getHljs?: () => HighlightJsRuntime | null | undefined;
	maxCodeLength?: number;
}>;

type CodeHighlightPluginMeta = Readonly<{ refresh?: boolean }>;
type CodeHighlightPluginState = Readonly<{
	decorations: DecorationSet;
	hljsRef: HighlightJsRuntime | null;
}>;
type HighlightTokenRange = Readonly<{
	className: string;
	from: number;
	to: number;
}>;
type DocumentRange = Readonly<{ from: number; to: number }>;
type HighlightWindow = Window & { hljs?: HighlightJsRuntime };

const DEFAULT_MAX_HIGHLIGHT_CODE_LENGTH = 64 * 1024;
const SAFE_CLASS_TOKEN_PATTERN = /^[a-zA-Z_-][a-zA-Z0-9_-]*$/;

export const codeHighlightPluginKey = new PluginKey<CodeHighlightPluginState>(
	"easymdeVisualCodeHighlight",
);

function normalizeCodeLanguage(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function buildCodeClassName(language: string): string {
	const token = (language.split(/\s+/)[0] ?? "").replace(
		/[^a-zA-Z0-9_+#.-]/g,
		"",
	);
	return token.length > 0 ? `hljs language-${token}` : "hljs";
}

function resolveHljs(
	options?: CodeHighlightPluginOptions,
): HighlightJsRuntime | null {
	const candidate = options?.getHljs
		? options.getHljs()
		: typeof window !== "undefined"
			? (window as HighlightWindow).hljs
			: null;
	return candidate && typeof candidate.highlight === "function"
		? candidate
		: null;
}

function mergeTokenClasses(
	inherited: ReadonlyArray<string>,
	rawClassAttr: string | null,
): string[] {
	if (!rawClassAttr) {
		return [...inherited];
	}
	const merged = [...inherited];
	for (const part of rawClassAttr.split(/\s+/)) {
		if (
			part.length > 0 &&
			SAFE_CLASS_TOKEN_PATTERN.test(part) &&
			merged.indexOf(part) < 0
		) {
			merged.push(part);
		}
	}
	return merged;
}

function walkHighlightedTree(
	node: Node,
	cursor: { offset: number },
	maxLength: number,
	activeClasses: ReadonlyArray<string>,
	output: HighlightTokenRange[],
): void {
	if (node.nodeType === 3) {
		const text = node.textContent ?? "";
		if (text.length > 0) {
			const from = cursor.offset;
			const to = Math.min(maxLength, from + text.length);
			cursor.offset += text.length;
			if (activeClasses.length > 0 && to > from) {
				output.push({ from, to, className: activeClasses.join(" ") });
			}
		}
		return;
	}
	if (node.nodeType !== 1) {
		return;
	}
	const element = node as Element;
	const nextClasses = mergeTokenClasses(
		activeClasses,
		element.getAttribute("class"),
	);
	for (
		let child = element.firstChild;
		child !== null;
		child = child.nextSibling
	) {
		walkHighlightedTree(child, cursor, maxLength, nextClasses, output);
	}
}

export function parseHighlightedHtmlToTokenRanges(
	highlightedHtml: string,
	codeLength: number,
): ReadonlyArray<HighlightTokenRange> {
	if (
		highlightedHtml.length === 0 ||
		codeLength <= 0 ||
		typeof DOMParser === "undefined"
	) {
		return [];
	}
	const parsed = new DOMParser().parseFromString(
		`<body>${highlightedHtml}</body>`,
		"text/html",
	);
	const ranges: HighlightTokenRange[] = [];
	walkHighlightedTree(parsed.body, { offset: 0 }, codeLength, [], ranges);
	return ranges;
}

function buildCodeBlockDecorations(
	node: ProseMirrorNode,
	blockPos: number,
	hljs: HighlightJsRuntime,
	maxCodeLength: number,
): Decoration[] {
	const language = normalizeCodeLanguage(node.attrs.language);
	const codeText = node.textContent;
	if (
		typeof hljs.highlight !== "function" ||
		language.length === 0 ||
		codeText.length === 0 ||
		codeText.length > maxCodeLength ||
		(typeof hljs.getLanguage === "function" && !hljs.getLanguage(language))
	) {
		return [];
	}

	let highlightedHtml = "";
	try {
		const result = hljs.highlight(codeText, { language, ignoreIllegals: true });
		highlightedHtml = typeof result?.value === "string" ? result.value : "";
	} catch {
		return [];
	}

	const contentStart = blockPos + 1;
	return parseHighlightedHtmlToTokenRanges(
		highlightedHtml,
		codeText.length,
	).map((range) =>
		Decoration.inline(contentStart + range.from, contentStart + range.to, {
			class: range.className,
		}),
	);
}

function buildAllCodeBlockDecorations(
	doc: ProseMirrorNode,
	hljs: HighlightJsRuntime,
	maxCodeLength: number,
): DecorationSet {
	const decorations: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === "code_block") {
			decorations.push(
				...buildCodeBlockDecorations(node, pos, hljs, maxCodeLength),
			);
			return false;
		}
		return true;
	});
	return decorations.length > 0
		? DecorationSet.create(doc, decorations)
		: DecorationSet.empty;
}

function collectChangedRanges(tr: Transaction): DocumentRange[] {
	const ranges: DocumentRange[] = [];
	const docSize = tr.doc.content.size;
	const clamp = (pos: number): number => Math.max(0, Math.min(docSize, pos));

	for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex += 1) {
		const step = tr.steps[stepIndex];
		const stepMap = tr.mapping.maps[stepIndex];
		const tailMapping = tr.mapping.slice(stepIndex + 1);
		stepMap?.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
			const from = clamp(tailMapping.map(newStart, -1));
			ranges.push({
				from,
				to: Math.max(from, clamp(tailMapping.map(newEnd, 1))),
			});
		});
		// Attribute-only steps (e.g. AttrStep for language change) emit an empty StepMap.
		if (step && "pos" in step && typeof step.pos === "number") {
			const from = clamp(tailMapping.map(step.pos, -1));
			ranges.push({
				from,
				to: Math.max(from, clamp(tailMapping.map(step.pos + 1, 1))),
			});
		}
	}
	return ranges;
}

function rangesTouchCodeBlock(
	blockFrom: number,
	blockEnd: number,
	changedRanges: ReadonlyArray<DocumentRange>,
): boolean {
	for (const range of changedRanges) {
		if (range.from < range.to) {
			if (range.from < blockEnd && range.to > blockFrom) {
				return true;
			}
		} else if (range.from > blockFrom && range.from < blockEnd) {
			return true;
		}
	}
	return false;
}

function updateDecorationsIncrementally(
	tr: Transaction,
	prevDecorations: DecorationSet,
	newDoc: ProseMirrorNode,
	hljs: HighlightJsRuntime,
	maxCodeLength: number,
): DecorationSet {
	let decorations = prevDecorations.map(tr.mapping, newDoc);
	const changedRanges = collectChangedRanges(tr);
	if (changedRanges.length === 0) {
		return decorations;
	}

	const added: Decoration[] = [];
	newDoc.descendants((node, pos) => {
		if (node.type.name !== "code_block") {
			return true;
		}
		const blockEnd = pos + node.nodeSize;
		if (rangesTouchCodeBlock(pos, blockEnd, changedRanges)) {
			const stale = decorations.find(pos, blockEnd);
			if (stale.length > 0) {
				decorations = decorations.remove(stale);
			}
			added.push(...buildCodeBlockDecorations(node, pos, hljs, maxCodeLength));
		}
		return false;
	});
	return added.length > 0 ? decorations.add(newDoc, added) : decorations;
}

export function createCodeHighlightPlugin(
	options: CodeHighlightPluginOptions = {},
): Plugin<CodeHighlightPluginState> {
	const maxCodeLength =
		options.maxCodeLength ?? DEFAULT_MAX_HIGHLIGHT_CODE_LENGTH;

	return new Plugin<CodeHighlightPluginState>({
		key: codeHighlightPluginKey,
		state: {
			init(_config, state: EditorState): CodeHighlightPluginState {
				const hljs = resolveHljs(options);
				return hljs
					? {
							decorations: buildAllCodeBlockDecorations(
								state.doc,
								hljs,
								maxCodeLength,
							),
							hljsRef: hljs,
						}
					: { decorations: DecorationSet.empty, hljsRef: null };
			},
			apply(tr, prev, _oldState, newState): CodeHighlightPluginState {
				const hljs = resolveHljs(options);
				const meta = tr.getMeta(codeHighlightPluginKey) as
					| CodeHighlightPluginMeta
					| undefined;
				if (!hljs) {
					return prev.decorations === DecorationSet.empty &&
						prev.hljsRef === null
						? prev
						: { decorations: DecorationSet.empty, hljsRef: null };
				}
				if (hljs !== prev.hljsRef || meta?.refresh === true) {
					return {
						decorations: buildAllCodeBlockDecorations(
							newState.doc,
							hljs,
							maxCodeLength,
						),
						hljsRef: hljs,
					};
				}
				if (!tr.docChanged) {
					return prev;
				}
				return {
					decorations: updateDecorationsIncrementally(
						tr,
						prev.decorations,
						newState.doc,
						hljs,
						maxCodeLength,
					),
					hljsRef: hljs,
				};
			},
		},
		props: {
			decorations(state: EditorState): DecorationSet {
				return (
					codeHighlightPluginKey.getState(state)?.decorations ??
					DecorationSet.empty
				);
			},
		},
	});
}

function createLanguageBadgeElement(doc: Document): HTMLSpanElement {
	const badge = doc.createElement("span");
	badge.className = "easymde-visual-code-lang";
	badge.setAttribute("contenteditable", "false");
	badge.setAttribute("aria-hidden", "true");
	Object.assign(badge.style, {
		position: "absolute",
		top: "8px",
		right: "14px",
		fontSize: "11px",
		lineHeight: "18px",
		opacity: "0.72",
		pointerEvents: "none",
		userSelect: "none",
	});
	return badge;
}

class CodeBlockNodeView implements NodeView {
	readonly dom: HTMLPreElement;
	readonly contentDOM: HTMLElement;
	private node: ProseMirrorNode;
	private language = "";
	private badge: HTMLSpanElement | null = null;
	private frameSyncRafId: number | null = null;
	private readonly syncFrameBackground: boolean;

	constructor(
		node: ProseMirrorNode,
		view: EditorView,
		options: CodeBlockNodeViewOptions,
	) {
		this.node = node;
		this.syncFrameBackground = options.syncFrameBackground ?? true;
		const doc = view.dom.ownerDocument;
		this.dom = doc.createElement("pre");
		this.dom.className = "easymde-code-block";
		this.dom.setAttribute("data-easymde-code-block", "1");
		this.contentDOM = doc.createElement("code");
		this.dom.appendChild(this.contentDOM);
		this.applyLanguage(normalizeCodeLanguage(node.attrs.language));
		this.scheduleFrameBackgroundSync();
	}

	private applyLanguage(nextLanguage: string): void {
		this.language = nextLanguage;
		if (nextLanguage.length > 0) {
			this.dom.setAttribute("data-language", nextLanguage);
			if (!this.badge) {
				this.badge = createLanguageBadgeElement(this.dom.ownerDocument);
				this.dom.appendChild(this.badge);
			}
			this.badge.textContent = nextLanguage;
		} else {
			this.dom.removeAttribute("data-language");
			this.badge?.remove();
			this.badge = null;
		}
		this.contentDOM.className = buildCodeClassName(nextLanguage);
	}

	private scheduleFrameBackgroundSync(): void {
		const win = this.syncFrameBackground
			? this.dom.ownerDocument.defaultView
			: null;
		if (
			!win ||
			typeof win.requestAnimationFrame !== "function" ||
			typeof win.getComputedStyle !== "function"
		) {
			return;
		}
		if (
			this.frameSyncRafId !== null &&
			typeof win.cancelAnimationFrame === "function"
		) {
			win.cancelAnimationFrame(this.frameSyncRafId);
		}
		this.frameSyncRafId = win.requestAnimationFrame(() => {
			this.frameSyncRafId = null;
			if (!this.dom.isConnected) {
				return;
			}
			const bg = win.getComputedStyle(this.contentDOM).backgroundColor;
			if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
				this.dom.style.setProperty("--easymde-code-frame-background", bg);
			}
		});
	}

	update(nextNode: ProseMirrorNode): boolean {
		if (nextNode.type !== this.node.type) {
			return false;
		}
		this.node = nextNode;
		const nextLanguage = normalizeCodeLanguage(nextNode.attrs.language);
		if (nextLanguage !== this.language) {
			this.applyLanguage(nextLanguage);
			this.scheduleFrameBackgroundSync();
		}
		return true;
	}

	ignoreMutation(mutation: ViewMutationRecord): boolean {
		if (mutation.type === "selection") {
			return false;
		}
		if (mutation.target === this.dom) {
			return true;
		}
		if (
			this.badge &&
			(mutation.target === this.badge || this.badge.contains(mutation.target))
		) {
			return true;
		}
		return (
			mutation.type === "attributes" && mutation.target === this.contentDOM
		);
	}

	destroy(): void {
		if (this.frameSyncRafId !== null) {
			const win = this.dom.ownerDocument.defaultView;
			if (win && typeof win.cancelAnimationFrame === "function") {
				win.cancelAnimationFrame(this.frameSyncRafId);
			}
			this.frameSyncRafId = null;
		}
	}
}

export function createCodeBlockNodeView(
	options: CodeBlockNodeViewOptions = {},
): NodeViewConstructor {
	return (node, view) => new CodeBlockNodeView(node, view, options);
}
