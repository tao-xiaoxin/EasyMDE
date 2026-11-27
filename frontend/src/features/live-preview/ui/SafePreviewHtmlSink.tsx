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

type SafePreviewHtmlSinkProps = Readonly<{
	acceptedHtml?: boolean;
	ariaBusy?: boolean;
	beforeStagedCommit?: (revision: number, hasInstalledHtml: boolean) => boolean;
	className?: string;
	error?: boolean;
	html: SafePreviewHtml | null;
	htmlRevision?: number;
	label?: string;
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

	useImperativeHandle(surfaceRef, () => {
		if (!htmlSurfaceRef.current) throw new Error("preview-surface-missing");
		return htmlSurfaceRef.current;
	}, []);

	useLayoutEffect(() => {
		const surface = htmlSurfaceRef.current;
		if (!surface) throw new Error("preview-surface-missing");

		const appliedSurfaceState = appliedSurfaceStateRef.current;
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
