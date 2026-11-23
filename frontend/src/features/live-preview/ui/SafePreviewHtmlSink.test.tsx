import { render } from "@testing-library/react";
import { Component, createElement, createRef } from "@wordpress/element";
import type { ErrorInfo, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SafePreviewHtml } from "../../../contracts/ports/preview-request";
import { SafePreviewHtmlSink } from "./SafePreviewHtmlSink";

type TestErrorBoundaryProps = Readonly<{
	children: ReactNode;
	onError: (error: Error) => void;
}>;

type TestErrorBoundaryState = Readonly<{ failed: boolean }>;

class TestErrorBoundary extends Component<
	TestErrorBoundaryProps,
	TestErrorBoundaryState
> {
	public override state: TestErrorBoundaryState = { failed: false };

	public static getDerivedStateFromError(): TestErrorBoundaryState {
		return { failed: true };
	}

	public override componentDidCatch(error: Error, _info: ErrorInfo): void {
		this.props.onError(error);
	}

	public override render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

describe("SafePreviewHtmlSink", () => {
	it("exposes required read-only WeChat and accessibility sink attributes", () => {
		const surfaceRef = createRef<HTMLElement>();
		const view = render(
			<SafePreviewHtmlSink
				acceptedHtml
				ariaBusy={false}
				className="easymde-preview"
				html={"<p>Hello</p>" as SafePreviewHtml}
				htmlRevision={1}
				label="Live preview"
				phase="ready"
				refreshing={false}
				role="region"
				style={{ fontSize: "16px" }}
				surfaceRef={surfaceRef}
			/>,
		);
		const surface = surfaceRef.current;
		if (!surface) throw new Error("test-surface-missing");

		expect(surface.getAttribute("data-easymde-preview-html-sink")).toBe("1");
		expect(surface.getAttribute("data-easymde-preview-accepted")).toBe("1");
		expect(surface.getAttribute("data-easymde-preview-phase")).toBe("ready");
		expect(surface.getAttribute("data-easymde-preview-refreshing")).toBeNull();
		expect(surface.getAttribute("data-easymde-preview-error")).toBeNull();
		expect(surface.getAttribute("aria-busy")).toBe("false");
		expect(surface.getAttribute("aria-live")).toBe("polite");
		expect(surface.getAttribute("aria-label")).toBe("Live preview");
		expect(surface.getAttribute("role")).toBe("region");
		expect(surface.className).toBe("easymde-preview");
		expect(surface.style.fontSize).toBe("16px");
		expect(surface.innerHTML).toBe("<p>Hello</p>");

		view.rerender(
			<SafePreviewHtmlSink
				acceptedHtml
				ariaBusy
				className="easymde-preview"
				error
				html={"<p>Hello</p>" as SafePreviewHtml}
				htmlRevision={1}
				phase="loading"
				refreshing
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surface.getAttribute("aria-busy")).toBe("true");
		expect(surface.getAttribute("data-easymde-preview-refreshing")).toBe("1");
		expect(surface.getAttribute("data-easymde-preview-error")).toBe("1");
		expect(surface.getAttribute("data-easymde-preview-phase")).toBe("loading");
		expect(surface.innerHTML).toBe("<p>Hello</p>");
		view.unmount();
	});

	it("clears a read-only surface when an empty frame arrives", () => {
		const surfaceRef = createRef<HTMLElement>();
		const view = render(
			<SafePreviewHtmlSink
				html={"<p>alpha</p>" as SafePreviewHtml}
				htmlRevision={1}
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surfaceRef.current?.innerHTML).toBe("<p>alpha</p>");
		view.rerender(
			<SafePreviewHtmlSink
				html={"" as SafePreviewHtml}
				htmlRevision={2}
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surfaceRef.current?.innerHTML).toBe("");
		view.unmount();
	});

	it("renders empty, error, and loading status messages when html is null", () => {
		const surfaceRef = createRef<HTMLElement>();
		const view = render(
			<SafePreviewHtmlSink
				html={null}
				htmlRevision={1}
				statusClassName="easymde-preview-pending"
				statusMessage="Loading preview..."
				statusRole="status"
				surfaceRef={surfaceRef}
			/>,
		);
		const surface = surfaceRef.current;
		if (!surface) throw new Error("test-surface-missing");
		const statusNode = surface.querySelector("p.easymde-preview-pending");
		expect(statusNode?.getAttribute("role")).toBe("status");
		expect(statusNode?.textContent).toBe("Loading preview...");

		view.rerender(
			<SafePreviewHtmlSink
				html={null}
				htmlRevision={2}
				statusClassName="easymde-preview-empty"
				statusMessage="Empty preview."
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surface.querySelector("p.easymde-preview-empty")?.textContent).toBe(
			"Empty preview.",
		);

		view.rerender(
			<SafePreviewHtmlSink
				html={null}
				htmlRevision={3}
				statusClassName="easymde-preview-error"
				statusMessage="Preview failed."
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surface.querySelector("p.easymde-preview-error")?.textContent).toBe(
			"Preview failed.",
		);
		view.unmount();
	});

	it("installs a staged commit once, gates via beforeStagedCommit, and keeps children across rerenders", () => {
		const surfaceRef = createRef<HTMLElement>();
		const view = render(
			<SafePreviewHtmlSink
				html={"<p>Before</p>" as SafePreviewHtml}
				htmlRevision={1}
				phase="ready"
				surfaceRef={surfaceRef}
			/>,
		);
		const surface = surfaceRef.current;
		if (!surface) throw new Error("test-surface-missing");

		const blockedNode = document.createElement("p");
		blockedNode.textContent = "Blocked";
		const onStagedCommit = vi.fn();
		const beforeBlocked = vi.fn(() => false);
		view.rerender(
			<SafePreviewHtmlSink
				beforeStagedCommit={beforeBlocked}
				html={"<p>Blocked</p>" as SafePreviewHtml}
				htmlRevision={2}
				onStagedCommit={onStagedCommit}
				phase="committing"
				stagedCommit={{ nodes: [blockedNode], revision: 2 }}
				surfaceRef={surfaceRef}
			/>,
		);
		expect(beforeBlocked).toHaveBeenCalledWith(2, true);
		expect(onStagedCommit).not.toHaveBeenCalled();
		expect(surface.innerHTML).toBe("<p>Before</p>");

		const acceptedNode = document.createElement("p");
		acceptedNode.textContent = "After";
		const stagedCommit = { nodes: [acceptedNode], revision: 3 };
		const replaceChildren = vi.spyOn(surface, "replaceChildren");
		view.rerender(
			<SafePreviewHtmlSink
				beforeStagedCommit={() => true}
				html={"<p>After</p>" as SafePreviewHtml}
				htmlRevision={3}
				onStagedCommit={onStagedCommit}
				phase="committing"
				stagedCommit={stagedCommit}
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surface.firstChild).toBe(acceptedNode);
		expect(onStagedCommit).toHaveBeenCalledTimes(1);
		expect(onStagedCommit).toHaveBeenCalledWith(3);
		expect(replaceChildren).toHaveBeenCalledTimes(1);

		view.rerender(
			<SafePreviewHtmlSink
				ariaBusy={false}
				html={"<p>After</p>" as SafePreviewHtml}
				htmlRevision={3}
				onStagedCommit={onStagedCommit}
				phase="ready"
				stagedCommit={stagedCommit}
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surface.firstChild).toBe(acceptedNode);
		expect(onStagedCommit).toHaveBeenCalledTimes(1);
		expect(replaceChildren).toHaveBeenCalledTimes(1);
		replaceChildren.mockRestore();
		view.unmount();
	});

	it("retains installed HTML while loading or enhancing without a staged commit", () => {
		const surfaceRef = createRef<HTMLElement>();
		const view = render(
			<SafePreviewHtmlSink
				html={"<p>Stable</p>" as SafePreviewHtml}
				htmlRevision={1}
				phase="ready"
				surfaceRef={surfaceRef}
			/>,
		);
		const surface = surfaceRef.current;
		if (!surface) throw new Error("test-surface-missing");
		const originalParagraph = surface.querySelector("p");

		view.rerender(
			<SafePreviewHtmlSink
				ariaBusy
				html={"<p>Pending metadata</p>" as SafePreviewHtml}
				htmlRevision={2}
				phase="loading"
				refreshing
				surfaceRef={surfaceRef}
			/>,
		);
		expect(surface.querySelector("p")).toBe(originalParagraph);
		expect(surface.textContent).toBe("Stable");
		view.unmount();
	});

	it("rejects external child drift after a staged status commit", () => {
		const surfaceRef = createRef<HTMLElement>();
		const onError = vi.fn<(error: Error) => void>();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const initialHtml = "<p>Before</p>" as SafePreviewHtml;
		const nextHtml = "<p>After</p>" as SafePreviewHtml;
		const firstStagedCommit = vi.fn();
		const nextStagedCommit = vi.fn();
		const expectedWindowErrors: ErrorEvent[] = [];
		const unexpectedWindowErrors: unknown[] = [];
		const onWindowError = (event: ErrorEvent): void => {
			if (
				event.error instanceof Error &&
				"preview-staged-commit-surface-drifted" === event.error.message
			) {
				expectedWindowErrors.push(event);
				event.preventDefault();
				return;
			}
			unexpectedWindowErrors.push(event.error ?? event.message);
		};
		const template = document.createElement("template");
		template.innerHTML = nextHtml;
		const stagedCommit = {
			nodes: Array.from(template.content.childNodes),
			revision: 2,
		};
		const view = render(
			<TestErrorBoundary onError={onError}>
				<SafePreviewHtmlSink
					html={initialHtml}
					htmlRevision={1}
					surfaceRef={surfaceRef}
				/>
			</TestErrorBoundary>,
		);
		const surface = surfaceRef.current;
		if (!surface) throw new Error("preview-staged-drift-surface-missing");

		view.rerender(
			<TestErrorBoundary onError={onError}>
				<SafePreviewHtmlSink
					html={nextHtml}
					htmlRevision={2}
					onStagedCommit={firstStagedCommit}
					stagedCommit={stagedCommit}
					statusClassName="preview-status"
					statusMessage="Updating Preview"
					statusRole="status"
					surfaceRef={surfaceRef}
				/>
			</TestErrorBoundary>,
		);
		surface.append(document.createElement("span"));
		window.addEventListener("error", onWindowError);

		try {
			view.rerender(
				<TestErrorBoundary onError={onError}>
					<SafePreviewHtmlSink
						html={nextHtml}
						htmlRevision={2}
						onStagedCommit={nextStagedCommit}
						stagedCommit={stagedCommit}
						statusClassName="preview-status"
						statusMessage="Updating Preview"
						statusRole="status"
						surfaceRef={surfaceRef}
					/>
				</TestErrorBoundary>,
			);

			expect(onError).toHaveBeenCalledOnce();
			expect(onError.mock.lastCall?.[0].message).toBe(
				"preview-staged-commit-surface-drifted",
			);
			expect(expectedWindowErrors).toHaveLength(1);
			expect(unexpectedWindowErrors).toEqual([]);
		} finally {
			window.removeEventListener("error", onWindowError);
			consoleError.mockRestore();
		}
	});

	it("reinstalls the accepted raw HTML when the mounted surface was mutated externally", () => {
		const surfaceRef = createRef<HTMLElement>();
		const html = "<p>Expected read-only preview.</p>" as SafePreviewHtml;
		const props = { html, htmlRevision: 4, phase: "ready", surfaceRef };
		const view = render(<SafePreviewHtmlSink {...props} />);
		try {
			const surface = surfaceRef.current;
			if (!surface) throw new Error("test-surface-missing");
			const text = surface.querySelector("p")?.firstChild;
			if (!(text instanceof Text)) throw new Error("test-text-missing");
			text.data = "Tampered text.";
			view.rerender(<SafePreviewHtmlSink {...props} phase="stale" />);
			expect(surface.textContent).toBe("Expected read-only preview.");
		} finally {
			view.unmount();
		}
	});
});
