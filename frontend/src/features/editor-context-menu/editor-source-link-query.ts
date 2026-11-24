import type {
	PreviewRequest,
	PreviewRequestPort,
	PreviewResponse,
} from "../../contracts/ports/preview-request";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import type { SimplifiedFormattingDomParser } from "./editor-simplified-formatting";
import {
	type EditorSourceLinkCandidate,
	type EditorSourceLinkSelection,
	type EditorSourceLinkUnavailableCode,
	findEditorSourceLink,
} from "./editor-source-link";

export const MAX_EDITOR_SOURCE_LINK_QUERY_BYTES = 1_048_576;
export const EDITOR_SOURCE_LINK_QUERY_TIMEOUT_MS = 10_000;
const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";

export type EditorSourceLinkQuerySelection = EditorSourceLinkSelection &
	Readonly<{
		direction?: "backward" | "forward" | "none";
	}>;

export type EditorSourceLinkQueryMenuIdentity = object | string | number;

export type EditorSourceLinkQueryBinding = Readonly<{
	menuIdentity: EditorSourceLinkQueryMenuIdentity;
	revision?: number;
	selection: EditorSourceLinkQuerySelection;
	source: string;
}>;

export type EditorSourceLinkQueryState =
	| Readonly<{ status: "none" }>
	| Readonly<{ status: "pending" }>
	| Readonly<{ href: string; status: "ready" }>
	| Readonly<{
			code: EditorSourceLinkQueryUnavailableCode;
			status: "unavailable";
	  }>;

export type EditorSourceLinkQueryReadiness = EditorSourceLinkQueryState;

export type EditorSourceLinkQueryUnavailableCode =
	| EditorSourceLinkUnavailableCode
	| "editor-source-link-preview-anchor-missing"
	| "editor-source-link-preview-invalid"
	| "editor-source-link-preview-ownership-invalid"
	| "editor-source-link-preview-ownership-missing"
	| "editor-source-link-query-disposed"
	| "editor-source-link-query-failed"
	| "editor-source-link-query-current-check-failed"
	| "editor-source-link-query-timeout"
	| "editor-source-link-query-too-large"
	| "editor-source-link-request-failed"
	| "editor-source-link-request-markdown-mismatch";

export type EditorSourceLinkQueryRequestFactory = (
	input: Readonly<{
		binding: EditorSourceLinkQueryBinding;
		candidate: EditorSourceLinkCandidate;
		markdown: string;
	}>,
) => PreviewRequest;

export type EditorSourceLinkQueryEnsureInput = Readonly<{
	binding: EditorSourceLinkQueryBinding;
	blockIndex?: EditorMarkdownBlockIndex | null | undefined;
}>;

export type EditorSourceLinkQuerySession = Readonly<{
	cancel: (binding?: EditorSourceLinkQueryBinding) => void;
	dispose: () => void;
	ensure: (
		input: EditorSourceLinkQueryEnsureInput,
	) => EditorSourceLinkQueryState;
	peek: (binding: EditorSourceLinkQueryBinding) => EditorSourceLinkQueryState;
	readiness: (
		binding: EditorSourceLinkQueryBinding,
	) => EditorSourceLinkQueryReadiness;
	subscribe: (listener: () => void) => () => void;
}>;

export type EditorSourceLinkQueryOptions = Readonly<{
	isCurrent: (binding: EditorSourceLinkQueryBinding) => boolean;
	notify: () => void;
	parser: SimplifiedFormattingDomParser;
	previewPort: PreviewRequestPort;
	requestFactory: EditorSourceLinkQueryRequestFactory;
}>;

type ActiveQuery = {
	binding: EditorSourceLinkQueryBinding;
	candidate: EditorSourceLinkCandidate;
	controller: AbortController;
	state: EditorSourceLinkQueryState;
	timeoutId: ReturnType<typeof setTimeout> | null;
};

type CachedState = Readonly<{
	binding: EditorSourceLinkQueryBinding;
	state: EditorSourceLinkQueryState;
}>;

function sameSelection(
	left: EditorSourceLinkQuerySelection,
	right: EditorSourceLinkQuerySelection,
): boolean {
	return (
		left.start === right.start &&
		left.end === right.end &&
		left.direction === right.direction
	);
}

function sameBinding(
	left: EditorSourceLinkQueryBinding,
	right: EditorSourceLinkQueryBinding,
): boolean {
	return (
		left.source === right.source &&
		Object.is(left.revision, right.revision) &&
		Object.is(left.menuIdentity, right.menuIdentity) &&
		sameSelection(left.selection, right.selection)
	);
}

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const codePoint = value.codePointAt(index) ?? 0;
		if (codePoint > 0xffff) index += 1;
		bytes +=
			codePoint <= 0x7f
				? 1
				: codePoint <= 0x7ff
					? 2
					: codePoint <= 0xffff
						? 3
						: 4;
	}
	return bytes;
}

function lineCount(markdown: string): number {
	let count = 1;
	for (let index = 0; index < markdown.length; index += 1) {
		if ("\r" === markdown[index]) {
			count += 1;
			if ("\n" === markdown[index + 1]) index += 1;
		} else if ("\n" === markdown[index]) {
			count += 1;
		}
	}
	return count;
}

function topLevelElements(document: Document): ReadonlyArray<Element> {
	return Array.from(document.body.children);
}

function anchorsIn(root: Element): ReadonlyArray<HTMLAnchorElement> {
	const anchors: HTMLAnchorElement[] = [];
	if (root instanceof HTMLAnchorElement) anchors.push(root);
	anchors.push(...Array.from(root.querySelectorAll<HTMLAnchorElement>("a")));
	return anchors;
}

function hasOutsideText(root: Element, anchor: HTMLAnchorElement): boolean {
	const walker = root.ownerDocument.createTreeWalker(root, 4);
	let node = walker.nextNode();
	while (node) {
		if (!anchor.contains(node) && (node.nodeValue ?? "").trim()) return true;
		node = walker.nextNode();
	}
	return false;
}

function hasGeneratedOrImageNode(root: Element): boolean {
	return Boolean(
		root.matches(
			"img, .easymde-math, .easymde-mermaid, .easymde-toc, .footnotes, .footnotes-sep, [data-easymde-preview-window-spacer], [data-easymde-visual-source-id]",
		) ||
			root.querySelector(
				"img, .easymde-math, .easymde-mermaid, .easymde-toc, .footnotes, .footnotes-sep, [data-easymde-preview-window-spacer], [data-easymde-visual-block-id], [data-easymde-visual-source-id]",
			),
	);
}

function responseHref(
	response: PreviewResponse,
	candidate: EditorSourceLinkCandidate,
	parser: SimplifiedFormattingDomParser,
):
	| Readonly<{ href: string }>
	| Readonly<{ status: "none" }>
	| Readonly<{ code: EditorSourceLinkQueryUnavailableCode }> {
	if (
		!response ||
		"object" !== typeof response ||
		"string" !== typeof response.html
	) {
		return { code: "editor-source-link-preview-invalid" };
	}
	const editMap = response.editMap;
	if (
		editMap?.version !== 1 ||
		editMap.coordinate !== "line" ||
		!Array.isArray(editMap.blocks) ||
		!editMap.blocks.every(
			(block) =>
				Boolean(block) &&
				Number.isSafeInteger(block.startLine) &&
				Number.isSafeInteger(block.endLine) &&
				block.startLine >= 0 &&
				block.endLine >= block.startLine,
		)
	) {
		return { code: "editor-source-link-preview-ownership-missing" };
	}
	const prefixLineCount = lineCount(candidate.source);
	const matchingBlocks = editMap.blocks.filter(
		(block) =>
			block.startLine === 0 &&
			block.endLine === prefixLineCount &&
			block.editable,
	);
	if (1 !== matchingBlocks.length) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	const block = matchingBlocks[0];
	if (!block) return { code: "editor-source-link-preview-ownership-invalid" };
	const blockIndex = editMap.blocks.indexOf(block);
	if (0 !== blockIndex) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	let document: Document;
	try {
		document = parser.parseFromString(response.html, "text/html");
	} catch {
		return { code: "editor-source-link-preview-invalid" };
	}
	if (!document?.body || document.querySelector("parsererror")) {
		return { code: "editor-source-link-preview-invalid" };
	}
	const elements = topLevelElements(document);
	if (
		elements.length !== editMap.blocks.length ||
		blockIndex < 0 ||
		blockIndex >= elements.length
	) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	const owner = elements[blockIndex];
	if (!owner) return { code: "editor-source-link-preview-ownership-invalid" };
	if (owner.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	const anchors = anchorsIn(owner);
	if (1 !== anchors.length) {
		if (0 === anchors.length && candidate.reference) return { status: "none" };
		return { code: "editor-source-link-preview-anchor-missing" };
	}
	const anchor = anchors[0];
	if (!anchor) return { code: "editor-source-link-preview-anchor-missing" };
	const href = anchor.getAttribute("href");
	if (!href?.trim()) {
		return { code: "editor-source-link-preview-anchor-missing" };
	}
	if (hasGeneratedOrImageNode(owner)) {
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	if (hasOutsideText(owner, anchor)) {
		// A reference link only renders when the document defines its label.
		// Literal text beside the anchor therefore means this caret has no
		// rendered link, while generated or unexpected nodes stay a failure.
		if (candidate.reference) return { status: "none" };
		return { code: "editor-source-link-preview-ownership-invalid" };
	}
	return { href };
}

function failed(
	code: EditorSourceLinkQueryUnavailableCode,
): EditorSourceLinkQueryState {
	return { code, status: "unavailable" };
}

export function createEditorSourceLinkQuery({
	isCurrent,
	notify,
	parser,
	previewPort,
	requestFactory,
}: EditorSourceLinkQueryOptions): EditorSourceLinkQuerySession {
	let active: ActiveQuery | null = null;
	let cached: CachedState | null = null;
	let disposed = false;
	const listeners = new Set<() => void>();

	const publish = (): void => {
		if (disposed) return;
		for (const listener of listeners) listener();
		notify();
	};

	const clearActive = (candidate: ActiveQuery): void => {
		if (active !== candidate) return;
		if (null !== candidate.timeoutId) {
			clearTimeout(candidate.timeoutId);
			candidate.timeoutId = null;
		}
		candidate.controller.abort();
		active = null;
	};

	const clearQueryTimeout = (candidate: ActiveQuery): void => {
		if (null === candidate.timeoutId) return;
		clearTimeout(candidate.timeoutId);
		candidate.timeoutId = null;
	};

	const currentAndLive = (candidate: ActiveQuery): boolean => {
		if (disposed || active !== candidate || candidate.controller.signal.aborted)
			return false;
		return isCurrent(candidate.binding);
	};

	const currentQueryIsLive = (candidate: ActiveQuery): boolean => {
		let live: boolean;
		try {
			live = currentAndLive(candidate);
		} catch {
			if (!disposed && active === candidate) {
				candidate.state = failed(
					"editor-source-link-query-current-check-failed",
				);
				publish();
			}
			return false;
		}
		if (!live && "pending" === candidate.state.status) clearActive(candidate);
		return live;
	};

	const fail = (
		query: ActiveQuery,
		code: EditorSourceLinkQueryUnavailableCode,
	): void => {
		if (!currentQueryIsLive(query)) return;
		clearQueryTimeout(query);
		query.state = failed(code);
		query.controller.abort();
		publish();
	};

	const run = async (
		query: ActiveQuery,
		queryMarkdown: string,
	): Promise<void> => {
		if (!currentQueryIsLive(query)) return;
		let request: PreviewRequest;
		try {
			request = requestFactory({
				binding: query.binding,
				candidate: query.candidate,
				markdown: queryMarkdown,
			});
		} catch {
			fail(query, "editor-source-link-request-failed");
			return;
		}
		if (
			!request ||
			"object" !== typeof request ||
			"string" !== typeof request.markdown
		) {
			fail(query, "editor-source-link-request-failed");
			return;
		}
		if (request.markdown !== queryMarkdown) {
			fail(query, "editor-source-link-request-markdown-mismatch");
			return;
		}
		let response: PreviewResponse;
		try {
			response = await previewPort.render(request, query.controller.signal);
		} catch {
			fail(query, "editor-source-link-query-failed");
			return;
		}
		if (!currentQueryIsLive(query)) return;
		clearQueryTimeout(query);
		const result = responseHref(response, query.candidate, parser);
		if ("status" in result) {
			query.state = { status: "none" };
			publish();
			return;
		}
		if ("code" in result) {
			query.state = failed(result.code);
			publish();
			return;
		}
		query.state = { href: result.href, status: "ready" };
		publish();
	};

	const ensure = ({
		binding,
		blockIndex,
	}: EditorSourceLinkQueryEnsureInput): EditorSourceLinkQueryState => {
		if (disposed) return failed("editor-source-link-query-disposed");
		if (null === blockIndex) {
			if (active) clearActive(active);
			cached = null;
			return failed("editor-source-link-block-index-unavailable");
		}
		if (active && sameBinding(active.binding, binding)) return active.state;
		if (cached && sameBinding(cached.binding, binding)) return cached.state;
		if (active) clearActive(active);
		cached = null;
		const resolution = findEditorSourceLink({
			blockIndex,
			selection: binding.selection,
			source: binding.source,
		});
		if ("none" === resolution.status) {
			cached = { binding, state: { status: "none" } };
			return cached.state;
		}
		if ("unavailable" === resolution.status) {
			cached = { binding, state: failed(resolution.code) };
			return cached.state;
		}
		const queryMarkdown = `${resolution.candidate.source}\n\n${binding.source}`;
		if (utf8ByteLength(queryMarkdown) > MAX_EDITOR_SOURCE_LINK_QUERY_BYTES) {
			cached = {
				binding,
				state: failed("editor-source-link-query-too-large"),
			};
			return cached.state;
		}
		const query: ActiveQuery = {
			binding,
			candidate: resolution.candidate,
			controller: new AbortController(),
			state: { status: "pending" },
			timeoutId: null,
		};
		active = query;
		query.timeoutId = setTimeout(() => {
			if (!currentQueryIsLive(query)) return;
			clearQueryTimeout(query);
			query.state = failed("editor-source-link-query-timeout");
			query.controller.abort();
			publish();
		}, EDITOR_SOURCE_LINK_QUERY_TIMEOUT_MS);
		void run(query, queryMarkdown);
		return query.state;
	};

	return {
		cancel(binding) {
			if (active && (!binding || sameBinding(active.binding, binding))) {
				clearActive(active);
			}
			if (cached && (!binding || sameBinding(cached.binding, binding))) {
				cached = null;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			if (active) clearActive(active);
			cached = null;
			listeners.clear();
		},
		ensure,
		peek(binding) {
			if (active && sameBinding(active.binding, binding)) return active.state;
			if (cached && sameBinding(cached.binding, binding)) return cached.state;
			return { status: "none" };
		},
		readiness(binding) {
			if (active && sameBinding(active.binding, binding)) return active.state;
			if (cached && sameBinding(cached.binding, binding)) return cached.state;
			return { status: "none" };
		},
		subscribe(listener) {
			if (disposed) throw new Error("editor-source-link-query-disposed");
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
