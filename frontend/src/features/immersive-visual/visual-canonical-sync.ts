import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	AllSelection,
	type EditorState,
	type Selection,
	TextSelection,
	type Transaction,
} from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import type { EditorView } from "prosemirror-view";
import type {
	VisualCanonicalChangeRequest,
	VisualEditorSelection,
	VisualToolbarCommandResult,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { parseMarkdownWithBlockSources } from "./markdown-parser";
import {
	createMarkdownRoundTripGuard,
	type MarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "./markdown-serializer";
import { PROTECTED_CARD_COMMIT_META } from "./node-views/protected-atom-node-view";
import {
	createVisualSourceIndex,
	deriveVisualSourceIndex,
	type VisualSourceIndex,
	type VisualSourceTextChange,
} from "./visual-source-index";
import {
	assertCanonicalChangePrecondition,
	computeVisualSelectionToMarkdownSelection,
	resolveMarkdownSelectionToVisualSelection,
} from "./visual-source-mapping";

export const CANONICAL_SYNC_TRANSACTION_META = "easymdeCanonicalSync";
export const VISUAL_SYNC_FAILED_CODE = "visual-editor-sync-failed";

export type VisualCommitResult =
	| Readonly<{ ok: true; revision: number }>
	| Readonly<{ code: typeof VISUAL_SYNC_FAILED_CODE; ok: false }>;

export type VisualHistoryDirection = "redo" | "undo";

export type VisualCanonicalSyncOptions = Readonly<{
	documentSession: EditorDocumentSession;
	isCompositionBusy: () => boolean;
	onCanonicalChange: (markdown: string) => void;
	onFailure: (code: string) => void;
	onReconciled?: () => void;
}>;

export type VisualCanonicalSync = Readonly<{
	applyCanonicalChange: (
		request: VisualCanonicalChangeRequest,
	) => VisualToolbarCommandResult;
	attach: (view: EditorView) => void;
	/** Ends any active contiguous typing run (caret move, mark toggle). */
	breakHistoryGroup: () => void;
	commit: (
		previousState: EditorState,
		nextState: EditorState,
		transaction?: Transaction,
	) => VisualCommitResult;
	commitPending: (transaction?: Transaction) => boolean;
	getAcceptedDoc: () => ProseMirrorNode;
	getInitialSelection: () => Selection;
	handleCanonicalNotification: () => void;
	hasFailed: () => boolean;
	history: (direction: VisualHistoryDirection) => VisualToolbarCommandResult;
	isEchoSuppressed: () => boolean;
	mapSelection: (selection: Selection) => VisualEditorSelection;
	notePendingBase: (previousState: EditorState) => void;
	reconcile: (
		markdown: string,
		revision: number,
		selection: VisualEditorSelection,
		context?: ReconcileViewContext | null,
	) => boolean;
	settleNow: () => boolean;
	syncSelection: (selection: Selection) => void;
	dispose: () => void;
}>;

/** Minimal bounded replacement turning `before` into `after`. */
function computeBoundedTextChange(
	before: string,
	after: string,
): VisualSourceTextChange {
	const max = Math.min(before.length, after.length);
	let start = 0;
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start))
		start += 1;
	let endBefore = before.length;
	let endAfter = after.length;
	while (
		endBefore > start &&
		endAfter > start &&
		before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
	) {
		endBefore -= 1;
		endAfter -= 1;
	}
	return { from: start, insert: after.slice(start, endAfter), to: endBefore };
}

function sameSelection(
	left: VisualEditorSelection,
	right: VisualEditorSelection,
): boolean {
	return (
		left.start === right.start &&
		left.end === right.end &&
		left.direction === right.direction
	);
}

/** CodeMirror's default `newGroupDelay`: a pause this long ends a typing run. */
const TYPING_GROUP_DELAY_MS = 500;

/** Contiguous plain-text typing run joined into one canonical undo step. */
type TypingRun = Readonly<{
	mdFrom: number;
	mdTo: number;
	pmPos: number;
	time: number;
}>;

/**
 * True only for one collapsed, single-line, plain-text insertion typed at the
 * caret: a single text-only ReplaceStep with no deletion, structure change,
 * paste/drop/cut, composition, or protected-card commit. Everything else is a
 * discrete, isolated history step.
 */
function isTypingInsertion(
	transaction: Transaction | undefined,
	previousState: EditorState,
	nextState: EditorState,
): boolean {
	if (
		transaction?.steps.length !== 1 ||
		transaction.getMeta(PROTECTED_CARD_COMMIT_META) === true ||
		transaction.getMeta("composition") !== undefined ||
		transaction.getMeta("uiEvent") !== undefined
	) {
		return false;
	}
	const step = transaction.steps[0];
	if (!(step instanceof ReplaceStep)) return false;
	const { slice } = step;
	const text = slice.content.firstChild;
	const before = previousState.selection;
	return (
		step.from === step.to &&
		slice.openStart === 0 &&
		slice.openEnd === 0 &&
		slice.content.childCount === 1 &&
		text?.isText === true &&
		(text.text ?? "").length > 0 &&
		(text.text ?? "").indexOf("\n") < 0 &&
		before instanceof TextSelection &&
		before.empty &&
		step.from === before.from &&
		nextState.selection instanceof TextSelection &&
		nextState.selection.empty &&
		previousState.doc.childCount === nextState.doc.childCount
	);
}

/** One ReplaceStep overwriting the whole document from an AllSelection. */
function isWholeDocumentReplacement(
	transaction: Transaction | undefined,
	previousState: EditorState,
): boolean {
	if (
		!transaction ||
		!(previousState.selection instanceof AllSelection) ||
		transaction.steps.length !== 1
	) {
		return false;
	}
	const step = transaction.steps[0];
	return (
		step instanceof ReplaceStep &&
		step.from === 0 &&
		step.to === previousState.doc.content.size
	);
}

type HistoryFlags = Readonly<{
	carryHistorySelectionWithoutEvent?: boolean;
	isolateHistoryBefore: boolean;
	joinPreviousHistory: boolean;
	recordHistorySelection: boolean;
}>;

type ReconcileViewContext = Readonly<{
	focused: boolean;
	scroll: ScrollSnapshot;
}>;

type ScrollSnapshot = ReadonlyArray<
	Readonly<{ element: Element; left: number; top: number }>
>;

function captureScroll(view: EditorView): ScrollSnapshot {
	const snapshot: Array<{ element: Element; left: number; top: number }> = [];
	let element: Element | null = view.dom;
	while (element) {
		if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
			snapshot.push({
				element,
				left: element.scrollLeft,
				top: element.scrollTop,
			});
		}
		element = element.parentElement;
	}
	return snapshot;
}

function restoreScroll(snapshot: ScrollSnapshot): void {
	for (const entry of snapshot) {
		if (entry.element.scrollTop !== entry.top)
			entry.element.scrollTop = entry.top;
		if (entry.element.scrollLeft !== entry.left)
			entry.element.scrollLeft = entry.left;
	}
}

/**
 * Single authoritative bridge between the ProseMirror projection and the
 * canonical CodeMirror document, which is the only history owner. Accepted
 * state advances only after the canonical document proves it accepted a
 * write; canonical undo/redo bytes are reconciled back into the projection
 * incrementally, rebuilding the round-trip guard and source index from them.
 */
export function createVisualCanonicalSync(
	options: VisualCanonicalSyncOptions,
): VisualCanonicalSync {
	const { documentSession, isCompositionBusy, onCanonicalChange, onFailure } =
		options;
	const canonical = documentSession.document;
	let view: EditorView | null = null;
	let disposed = false;
	let echoSuppressed = false;
	let lastSyncFailed = false;
	let pendingBase: EditorState | null = null;
	let typingRun: TypingRun | null = null;

	const initialMarkdown = canonical.getValue();
	const initialParsed = parseMarkdownWithBlockSources(initialMarkdown);
	let acceptedDoc: ProseMirrorNode = initialParsed.doc;
	let acceptedMarkdown = initialMarkdown;
	let acceptedRevision = canonical.getRevision();
	let roundTripGuard: MarkdownRoundTripGuard = createMarkdownRoundTripGuard(
		initialMarkdown,
		initialParsed,
	);
	let sourceIndex: VisualSourceIndex = createVisualSourceIndex(
		acceptedDoc,
		acceptedMarkdown,
		initialParsed,
	);

	const runWithEchoSuppressed = <T>(fn: () => T): T => {
		const previous = echoSuppressed;
		echoSuppressed = true;
		try {
			return fn();
		} finally {
			echoSuppressed = previous;
		}
	};

	const mapSelection = (selection: Selection): VisualEditorSelection => {
		const doc = view?.state.doc ?? acceptedDoc;
		if (doc !== acceptedDoc && !doc.eq(acceptedDoc))
			return canonical.getSelection();
		return computeVisualSelectionToMarkdownSelection(
			acceptedDoc,
			selection,
			acceptedMarkdown,
			sourceIndex,
		);
	};

	const captureViewContext = (): ReconcileViewContext | null => {
		const activeView = view;
		if (!activeView) return null;
		const activeElement = activeView.dom.ownerDocument.activeElement;
		return {
			focused:
				activeView.hasFocus() ||
				(activeElement !== null && activeView.dom.contains(activeElement)),
			scroll: captureScroll(activeView),
		};
	};

	const reconcile = (
		markdown: string,
		revision: number,
		targetSelection: VisualEditorSelection,
		context?: ReconcileViewContext | null,
	): boolean => {
		const activeView = view;
		typingRun = null;
		if (disposed || !activeView) return false;
		try {
			const parsed = parseMarkdownWithBlockSources(markdown);
			const nextDoc = parsed.doc;
			const current = activeView.state.doc;
			let prefix = 0;
			const oldCount = current.childCount;
			const newCount = nextDoc.childCount;
			while (
				prefix < oldCount &&
				prefix < newCount &&
				current.child(prefix).eq(nextDoc.child(prefix))
			)
				prefix += 1;
			let suffix = 0;
			while (
				suffix < oldCount - prefix &&
				suffix < newCount - prefix &&
				current
					.child(oldCount - 1 - suffix)
					.eq(nextDoc.child(newCount - 1 - suffix))
			) {
				suffix += 1;
			}
			const tr = activeView.state.tr;
			if (!(prefix === oldCount && prefix === newCount)) {
				let from = 0;
				for (let i = 0; i < prefix; i += 1) from += current.child(i).nodeSize;
				let to = current.content.size;
				for (let i = 0; i < suffix; i += 1)
					to -= current.child(oldCount - 1 - i).nodeSize;
				let nextFrom = 0;
				for (let i = 0; i < prefix; i += 1)
					nextFrom += nextDoc.child(i).nodeSize;
				let nextTo = nextDoc.content.size;
				for (let i = 0; i < suffix; i += 1)
					nextTo -= nextDoc.child(newCount - 1 - i).nodeSize;
				tr.replaceWith(from, to, nextDoc.content.cut(nextFrom, nextTo));
			}
			const reconciledDoc = tr.doc;
			const reconciledIndex = createVisualSourceIndex(
				reconciledDoc,
				markdown,
				parsed,
			);
			tr.setSelection(
				resolveMarkdownSelectionToVisualSelection(
					reconciledDoc,
					markdown,
					targetSelection,
					reconciledIndex,
				),
			);
			tr.setMeta(CANONICAL_SYNC_TRANSACTION_META, true).setMeta(
				"addToHistory",
				false,
			);
			roundTripGuard = createMarkdownRoundTripGuard(markdown, parsed);
			acceptedDoc = reconciledDoc;
			acceptedMarkdown = markdown;
			acceptedRevision = revision;
			sourceIndex = reconciledIndex;
			pendingBase = null;
			lastSyncFailed = false;

			const viewContext = context ?? captureViewContext();
			if (tr.docChanged || !tr.selection.eq(activeView.state.selection)) {
				activeView.dispatch(tr);
			}
			if (
				viewContext?.focused &&
				activeView.dom.isConnected &&
				!activeView.hasFocus()
			) {
				activeView.focus();
			}
			if (viewContext) restoreScroll(viewContext.scroll);
			options.onReconciled?.();
			return true;
		} catch {
			lastSyncFailed = true;
			onFailure(VISUAL_SYNC_FAILED_CODE);
			return false;
		}
	};

	const fail = (): VisualCommitResult => {
		typingRun = null;
		lastSyncFailed = true;
		onFailure(VISUAL_SYNC_FAILED_CODE);
		if (!isCompositionBusy()) {
			reconcile(
				canonical.getValue(),
				canonical.getRevision(),
				canonical.getSelection(),
			);
			lastSyncFailed = acceptedMarkdown !== canonical.getValue();
		}
		return { code: VISUAL_SYNC_FAILED_CODE, ok: false };
	};

	/**
	 * Canonical history flags for one accepted write. Contiguous plain-text
	 * typing joins CodeMirror's current event (first keystroke isolates);
	 * every other operation stays its own isolated step.
	 */
	const resolveHistoryFlags = (
		typing: boolean,
		previousState: EditorState,
		nextState: EditorState,
		change: VisualSourceTextChange,
		time: number,
	): HistoryFlags => {
		const run = typingRun;
		if (!typing || change.from !== change.to || change.insert.length === 0) {
			typingRun = null;
			return {
				isolateHistoryBefore: true,
				joinPreviousHistory: false,
				recordHistorySelection: true,
			};
		}
		const insertEnd = change.from + change.insert.length;
		const continues =
			run !== null &&
			previousState.selection.from === run.pmPos &&
			change.from >= run.mdFrom &&
			change.from <= run.mdTo &&
			time - run.time >= 0 &&
			time - run.time < TYPING_GROUP_DELAY_MS;
		typingRun = {
			mdFrom:
				continues && run ? Math.min(run.mdFrom, change.from) : change.from,
			mdTo:
				continues && run
					? Math.max(run.mdTo + change.insert.length, insertEnd)
					: insertEnd,
			pmPos: nextState.selection.from,
			time,
		};
		return {
			carryHistorySelectionWithoutEvent: true,
			isolateHistoryBefore: !continues,
			joinPreviousHistory: continues,
			recordHistorySelection: false,
		};
	};

	const commit = (
		previousState: EditorState,
		nextState: EditorState,
		transaction?: Transaction,
	): VisualCommitResult => {
		if (disposed) return { code: VISUAL_SYNC_FAILED_CODE, ok: false };
		// Zero-write-on-read invariant: untouched documents never write back.
		if (nextState.doc === acceptedDoc || nextState.doc.eq(acceptedDoc)) {
			return { ok: true, revision: acceptedRevision };
		}
		try {
			const replacesWholeDocument = isWholeDocumentReplacement(
				transaction,
				previousState,
			);
			const nextMarkdown = replacesWholeDocument
				? serializeVisualDocToMarkdown(nextState.doc)
				: roundTripGuard.serialize(nextState.doc);
			if (nextMarkdown === acceptedMarkdown) {
				typingRun = null;
				acceptedDoc = nextState.doc;
				sourceIndex = createVisualSourceIndex(acceptedDoc, acceptedMarkdown);
				return { ok: true, revision: acceptedRevision };
			}
			if (canonical.getValue() !== acceptedMarkdown) return fail();
			const change = computeBoundedTextChange(acceptedMarkdown, nextMarkdown);
			if (
				acceptedMarkdown.slice(0, change.from) +
					change.insert +
					acceptedMarkdown.slice(change.to) !==
				nextMarkdown
			) {
				return fail();
			}
			const historySelectionBefore =
				previousState.doc === acceptedDoc || previousState.doc.eq(acceptedDoc)
					? computeVisualSelectionToMarkdownSelection(
							acceptedDoc,
							previousState.selection,
							acceptedMarkdown,
							sourceIndex,
						)
					: canonical.getSelection();
			const nextIndex = deriveVisualSourceIndex(
				sourceIndex,
				nextState.doc,
				nextMarkdown,
				change,
			);
			const nextSelection = computeVisualSelectionToMarkdownSelection(
				nextState.doc,
				nextState.selection,
				nextMarkdown,
				nextIndex,
			);
			const historyFlags = resolveHistoryFlags(
				isTypingInsertion(transaction, previousState, nextState) &&
					!isCompositionBusy(),
				previousState,
				nextState,
				change,
				transaction?.time ?? Date.now(),
			);
			runWithEchoSuppressed(() =>
				canonical.applyTextChange({
					changes: { from: change.from, insert: change.insert, to: change.to },
					historySelectionBefore,
					...historyFlags,
					selection: nextSelection,
					value: nextMarkdown,
				}),
			);
			if (canonical.getValue() !== nextMarkdown) return fail();
			if (nextMarkdown.length === 0 || replacesWholeDocument) {
				// A wiped document keeps no stale baseline (trailing newlines,
				// untouched block slices): fresh content serializes exactly.
				roundTripGuard = createMarkdownRoundTripGuard(
					nextMarkdown,
					parseMarkdownWithBlockSources(nextMarkdown),
				);
			}
			acceptedDoc = nextState.doc;
			acceptedMarkdown = nextMarkdown;
			acceptedRevision = canonical.getRevision();
			sourceIndex = nextIndex;
			lastSyncFailed = false;
			onCanonicalChange(nextMarkdown);
			return { ok: true, revision: acceptedRevision };
		} catch {
			return fail();
		}
	};

	const commitPending = (transaction?: Transaction): boolean => {
		const activeView = view;
		if (disposed || !activeView) return false;
		const base = pendingBase;
		pendingBase = null;
		// Only a single transaction spanning exactly base -> current state
		// carries typing semantics; batched (composition) edits stay discrete.
		const single =
			transaction &&
			base &&
			transaction.before === base.doc &&
			transaction.doc === activeView.state.doc
				? transaction
				: undefined;
		if (!base) {
			if (
				activeView.state.doc !== acceptedDoc &&
				!activeView.state.doc.eq(acceptedDoc)
			) {
				return commit(activeView.state, activeView.state).ok && !lastSyncFailed;
			}
			return !lastSyncFailed;
		}
		return commit(base, activeView.state, single).ok;
	};

	const settleNow = (): boolean => {
		if (disposed || isCompositionBusy()) return false;
		return commitPending() && !lastSyncFailed;
	};

	const history = (
		direction: VisualHistoryDirection,
	): VisualToolbarCommandResult => {
		typingRun = null;
		if (!settleNow()) {
			onFailure(VISUAL_SYNC_FAILED_CODE);
			return "failed";
		}
		const viewContext = captureViewContext();
		let changed = false;
		try {
			changed = runWithEchoSuppressed(() =>
				direction === "undo" ? canonical.undo() : canonical.redo(),
			);
		} catch {
			lastSyncFailed = true;
			onFailure(VISUAL_SYNC_FAILED_CODE);
			return "failed";
		}
		if (!changed) return "blocked";
		const value = canonical.getValue();
		if (
			!reconcile(
				value,
				canonical.getRevision(),
				canonical.getSelection(),
				viewContext,
			)
		) {
			return "failed";
		}
		onCanonicalChange(value);
		return "handled";
	};

	const applyCanonicalChange = (
		request: VisualCanonicalChangeRequest,
	): VisualToolbarCommandResult => {
		typingRun = null;
		if (!settleNow()) return "failed";
		const precondition = assertCanonicalChangePrecondition(
			request,
			canonical.getRevision(),
			canonical.getValue(),
			canonical.getSelection(),
		);
		if (!precondition.ok) return "blocked";
		const viewContext = captureViewContext();
		try {
			runWithEchoSuppressed(() =>
				canonical.applyTextChange({
					changes: request.change.changes,
					historySelectionBefore: request.expected.selection,
					isolateHistoryBefore: true,
					joinPreviousHistory: false,
					recordHistorySelection: true,
					selection: request.change.selection,
					value: request.change.value,
				}),
			);
		} catch {
			fail();
			return "failed";
		}
		const value = canonical.getValue();
		if (value !== request.change.value) {
			fail();
			return "failed";
		}
		if (
			!reconcile(
				value,
				canonical.getRevision(),
				request.change.selection,
				viewContext,
			)
		) {
			return "failed";
		}
		onCanonicalChange(value);
		return "handled";
	};

	const syncSelection = (selection: Selection): void => {
		if (disposed) return;
		const mapped = mapSelection(selection);
		if (sameSelection(canonical.getSelection(), mapped)) return;
		const withSetter = canonical as typeof canonical & {
			setSelection?: (next: VisualEditorSelection) => void;
		};
		runWithEchoSuppressed(() => {
			if (typeof withSetter.setSelection === "function") {
				withSetter.setSelection(mapped);
				return;
			}
			canonical.applyTextChange({
				selection: mapped,
				value: canonical.getValue(),
			});
		});
	};

	return {
		applyCanonicalChange,
		attach(nextView) {
			view = nextView;
		},
		breakHistoryGroup() {
			typingRun = null;
		},
		commit,
		commitPending,
		dispose() {
			disposed = true;
			view = null;
			pendingBase = null;
			typingRun = null;
		},
		getAcceptedDoc: () => acceptedDoc,
		getInitialSelection: () =>
			resolveMarkdownSelectionToVisualSelection(
				acceptedDoc,
				acceptedMarkdown,
				canonical.getSelection(),
				sourceIndex,
			),
		handleCanonicalNotification() {
			if (disposed || echoSuppressed) return;
			const revision = canonical.getRevision();
			const value = canonical.getValue();
			if (revision === acceptedRevision && value === acceptedMarkdown) return;
			reconcile(value, revision, canonical.getSelection());
		},
		hasFailed: () => lastSyncFailed,
		history,
		isEchoSuppressed: () => echoSuppressed,
		mapSelection,
		notePendingBase(previousState) {
			if (!pendingBase) pendingBase = previousState;
		},
		reconcile,
		settleNow,
		syncSelection,
	};
}
