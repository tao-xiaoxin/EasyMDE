import {
	createElement,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
} from "@wordpress/element";
import type { CSSProperties, Ref } from "react";

import type { SafePreviewHtml } from "../../../contracts/ports/preview-request";

export type SafePreviewHtmlSinkCommit = Readonly<{
	nodes: ReadonlyArray<Node>;
	revision: number;
}>;

export type SafePreviewHtmlSinkVerifiedView = Readonly<{
	html: SafePreviewHtml | null;
	htmlRevision: number;
}>;

export type SafePreviewHtmlSinkFailureOutcome =
	| Readonly<{
			error: unknown;
			kind: "restored";
			previous: SafePreviewHtmlSinkVerifiedView | null;
	  }>
	| Readonly<{
			error: unknown;
			kind: "unverified";
			rollbackError: unknown;
	  }>;

type DomMutationCallback =
	| ((surface: HTMLElement) => undefined | Error)
	| ((surface: HTMLElement) => void)
	| undefined;

type SafePreviewHtmlSinkProps = Readonly<{
	acceptedHtml?: boolean;
	ariaBusy?: boolean;
	beforeStagedCommit?: (revision: number, hasInstalledHtml: boolean) => boolean;
	className?: string;
	error?: boolean;
	html: SafePreviewHtml | null;
	htmlRevision?: number;
	label?: string;
	onDomMutation?: DomMutationCallback;
	onDomMutationFailure?: (outcome: SafePreviewHtmlSinkFailureOutcome) => void;
	onStagedCommit?: (revision: number) => void;
	phase?: string;
	refreshing?: boolean;
	role?: string;
	stagedCommit?: SafePreviewHtmlSinkCommit | null;
	statusClassName?: string;
	statusMessage?: string;
	statusRole?: string;
	style?: CSSProperties;
	surfaceRef: Ref<HTMLElement>;
}>;

type AppliedSurfaceState = Readonly<{
	html: SafePreviewHtml | null;
	renderedHtml?: string | null;
	revision: number;
	stagedCommit?: SafePreviewHtmlSinkCommit;
	stagedCommitNodes?: ReadonlyArray<Node>;
	statusClassName: string | undefined;
	statusMessage: string | undefined;
	statusRole: string | undefined;
}>;

type SurfaceSnapshot = Readonly<{
	canvas: HTMLElement | null;
	children: ReadonlyArray<Node>;
	scrollTop: number;
}>;

function captureSurfaceSnapshot(surface: HTMLElement): SurfaceSnapshot {
	return {
		canvas: surface.parentElement,
		children: Array.from(surface.childNodes),
		scrollTop: surface.parentElement?.scrollTop ?? 0,
	};
}

function restoreSurfaceSnapshot(
	snapshot: SurfaceSnapshot,
	surface: HTMLElement,
): void {
	if (!surface.parentNode) throw new Error("preview-sink-rollback-failed");
	surface.replaceChildren(...snapshot.children);
	if (snapshot.canvas) snapshot.canvas.scrollTop = snapshot.scrollTop;
}

function notifyDomMutation(
	surface: HTMLElement,
	callback: DomMutationCallback,
): Error | null {
	try {
		const result = callback?.(surface);
		if (result instanceof Error) return result;
		return null;
	} catch (error) {
		return error instanceof Error
			? error
			: new Error("preview-sink-dom-mutation-failed");
	}
}

function clearUnverifiedSurface(
	surface: HTMLElement,
	onDomMutation: DomMutationCallback,
): void {
	surface.replaceChildren();
	const styleError = notifyDomMutation(surface, onDomMutation);
	if (styleError) throw styleError;
}

function restoreAfterDomMutationFailure(
	surface: HTMLElement,
	mutationError: Error,
	previous: SafePreviewHtmlSinkVerifiedView | null,
	restore: () => void,
	onDomMutation: DomMutationCallback,
	onFailure?: (outcome: SafePreviewHtmlSinkFailureOutcome) => void,
): void {
	let rollbackFailure: Error | null = null;
	try {
		restore();
	} catch (error) {
		rollbackFailure =
			error instanceof Error
				? error
				: new Error("preview-sink-rollback-failed");
	}
	if (!rollbackFailure) {
		const restoredError = notifyDomMutation(surface, onDomMutation);
		if (restoredError) rollbackFailure = restoredError;
	}
	if (!rollbackFailure) {
		onFailure?.({ error: mutationError, kind: "restored", previous });
		return;
	}
	try {
		clearUnverifiedSurface(surface, onDomMutation);
	} catch {
		// The first rollback error remains the causal failure; the sink is already
		// unverified and the owner will discard the corresponding View state.
	}
	onFailure?.({
		error: mutationError,
		kind: "unverified",
		rollbackError: rollbackFailure,
	});
}

function validateUniqueChildren(desiredNodes: ReadonlyArray<Node>): void {
	const desired = new Set<Node>();
	for (const node of desiredNodes) {
		if (desired.has(node)) {
			throw new Error("preview-staged-node-sequence-invalid");
		}
		desired.add(node);
	}
}

function hasExactChildren(
	surface: HTMLElement,
	nodes: ReadonlyArray<Node>,
): boolean {
	if (surface.childNodes.length !== nodes.length) return false;
	return nodes.every((node, index) => surface.childNodes[index] === node);
}

function appendStatusMessage(
	surface: HTMLElement,
	statusClassName: string | undefined,
	statusMessage: string,
	statusRole: string | undefined,
): void {
	const message = surface.ownerDocument.createElement("p");
	if (statusClassName) message.className = statusClassName;
	if (statusRole) message.setAttribute("role", statusRole);
	message.textContent = statusMessage;
	surface.append(message);
}

export function SafePreviewHtmlSink({
	acceptedHtml = false,
	ariaBusy = false,
	beforeStagedCommit,
	className,
	error = false,
	html,
	htmlRevision = 0,
	label,
	onDomMutation,
	onDomMutationFailure,
	onStagedCommit,
	phase,
	refreshing = false,
	role,
	stagedCommit,
	statusClassName,
	statusMessage,
	statusRole,
	style,
	surfaceRef,
}: SafePreviewHtmlSinkProps) {
	const htmlSurfaceRef = useRef<HTMLElement | null>(null);
	const appliedSurfaceStateRef = useRef<AppliedSurfaceState | null>(null);
	const lastVerifiedViewRef = useRef<SafePreviewHtmlSinkVerifiedView | null>(
		null,
	);

	useImperativeHandle(surfaceRef, () => {
		if (!htmlSurfaceRef.current) throw new Error("preview-surface-missing");
		return htmlSurfaceRef.current;
	}, []);

	useLayoutEffect(() => {
		const surface = htmlSurfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");

		const appliedSurfaceState = appliedSurfaceStateRef.current;
		const previousVerifiedView = lastVerifiedViewRef.current;
		const commit =
			stagedCommit?.revision === htmlRevision ? stagedCommit : null;
		if (
			commit &&
			beforeStagedCommit &&
			!beforeStagedCommit(
				htmlRevision,
				Boolean(appliedSurfaceState && appliedSurfaceState.html !== null),
			)
		) {
			return;
		}

		// Pending HTML metadata may describe a candidate that never reached this
		// sink before supersession. Only an installable staged commit can replace
		// an existing HTML presentation while loading or enhancing.
		if (
			!commit &&
			(phase === "loading" || phase === "enhancing" || phase === "retained") &&
			html !== null &&
			appliedSurfaceState &&
			appliedSurfaceState.html !== null
		) {
			return;
		}

		if (
			!commit &&
			appliedSurfaceState &&
			appliedSurfaceState.revision === htmlRevision &&
			appliedSurfaceState.html === html &&
			appliedSurfaceState.statusClassName === statusClassName &&
			appliedSurfaceState.statusMessage === statusMessage &&
			appliedSurfaceState.statusRole === statusRole &&
			("string" !== typeof appliedSurfaceState.renderedHtml ||
				appliedSurfaceState.renderedHtml === surface.innerHTML)
		) {
			return;
		}

		if (commit && appliedSurfaceState?.stagedCommit === commit) {
			const committedNodes = appliedSurfaceState.stagedCommitNodes;
			if (!committedNodes) {
				throw new Error("preview-staged-commit-state-incomplete");
			}
			if (!hasExactChildren(surface, committedNodes)) {
				throw new Error("preview-staged-commit-surface-drifted");
			}
			return;
		}

		if (commit) {
			validateUniqueChildren(commit.nodes);
			const snapshot = captureSurfaceSnapshot(surface);
			if (!hasExactChildren(surface, commit.nodes)) {
				surface.replaceChildren(...commit.nodes);
			}
			if (statusMessage) {
				appendStatusMessage(
					surface,
					statusClassName,
					statusMessage,
					statusRole,
				);
			}
			const mutationError = notifyDomMutation(surface, onDomMutation);
			if (mutationError) {
				restoreAfterDomMutationFailure(
					surface,
					mutationError,
					previousVerifiedView,
					() => restoreSurfaceSnapshot(snapshot, surface),
					onDomMutation,
					onDomMutationFailure,
				);
				return;
			}
			lastVerifiedViewRef.current = {
				html,
				htmlRevision,
			};
			appliedSurfaceStateRef.current = {
				html,
				revision: htmlRevision,
				stagedCommit: commit,
				stagedCommitNodes: Array.from(surface.childNodes),
				statusClassName,
				statusMessage,
				statusRole,
			};
			onStagedCommit?.(commit.revision);
			return;
		}

		const snapshot = captureSurfaceSnapshot(surface);
		if (null !== html) {
			// Sole sink for PHP-rendered, server-sanitized Preview HTML.
			if ("" === html) {
				surface.replaceChildren();
			} else {
				surface.innerHTML = html;
			}
		} else {
			surface.replaceChildren();
			if (statusMessage) {
				appendStatusMessage(
					surface,
					statusClassName,
					statusMessage,
					statusRole,
				);
			}
		}

		const mutationError = notifyDomMutation(surface, onDomMutation);
		if (mutationError) {
			restoreAfterDomMutationFailure(
				surface,
				mutationError,
				previousVerifiedView,
				() => restoreSurfaceSnapshot(snapshot, surface),
				onDomMutation,
				onDomMutationFailure,
			);
			return;
		}
		lastVerifiedViewRef.current = {
			html,
			htmlRevision,
		};
		appliedSurfaceStateRef.current = {
			html,
			renderedHtml: surface.innerHTML,
			revision: htmlRevision,
			statusClassName,
			statusMessage,
			statusRole,
		};
	}, [
		beforeStagedCommit,
		html,
		htmlRevision,
		onDomMutation,
		onDomMutationFailure,
		onStagedCommit,
		phase,
		stagedCommit,
		statusClassName,
		statusMessage,
		statusRole,
	]);

	return (
		<article
			aria-busy={ariaBusy ? "true" : "false"}
			aria-label={label}
			aria-live="polite"
			className={className}
			data-easymde-preview-accepted={acceptedHtml ? "1" : undefined}
			data-easymde-preview-error={error ? "1" : undefined}
			data-easymde-preview-html-sink="1"
			data-easymde-preview-phase={phase}
			data-easymde-preview-refreshing={refreshing ? "1" : undefined}
			ref={htmlSurfaceRef}
			role={role}
			style={style}
		/>
	);
}
