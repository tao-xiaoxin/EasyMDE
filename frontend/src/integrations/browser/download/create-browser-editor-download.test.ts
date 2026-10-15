import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type BrowserEditorDownloadRuntime,
	createBrowserEditorDownload,
} from "./create-browser-editor-download";

function runtimeFixture(): {
	clicks: Array<HTMLAnchorElement>;
	cleanups: Array<() => void>;
	createObjectURL: ReturnType<typeof vi.fn>;
	revokeObjectURL: ReturnType<typeof vi.fn>;
	runtime: BrowserEditorDownloadRuntime;
} {
	const clicks: Array<HTMLAnchorElement> = [];
	const cleanups: Array<() => void> = [];
	const createObjectURL = vi.fn(() => "blob:generated-content");
	const revokeObjectURL = vi.fn();
	const runtime: BrowserEditorDownloadRuntime = {
		createObjectURL,
		document,
		revokeObjectURL,
		setTimeout: (callback, _delay) => {
			cleanups.push(callback);
			return 1;
		},
	};
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
		function click(this: HTMLAnchorElement) {
			clicks.push(this);
		},
	);
	return { clicks, cleanups, createObjectURL, revokeObjectURL, runtime };
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("createBrowserEditorDownload", () => {
	it("requests a PNG download and delays complete anchor/ObjectURL cleanup", async () => {
		const fixture = runtimeFixture();
		const port = createBrowserEditorDownload(fixture.runtime);
		const blob = new Blob(["png"], { type: "image/png" });

		await expect(port.requestPngDownload(blob, "formula.png")).resolves.toEqual(
			{
				status: "requested",
			},
		);
		expect(fixture.createObjectURL).toHaveBeenCalledWith(blob);
		expect(fixture.clicks).toHaveLength(1);
		expect(fixture.clicks[0]?.download).toBe("formula.png");
		expect(fixture.clicks[0]?.isConnected).toBe(true);
		expect(fixture.revokeObjectURL).not.toHaveBeenCalled();
		fixture.cleanups[0]?.();
		expect(fixture.clicks[0]?.isConnected).toBe(false);
		expect(fixture.revokeObjectURL).toHaveBeenCalledWith(
			"blob:generated-content",
		);
	});

	it("dispose drains a requested download cleanup and prevents a later timer double-revoke", async () => {
		const fixture = runtimeFixture();
		const port = createBrowserEditorDownload(fixture.runtime);
		await expect(
			port.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
			),
		).resolves.toEqual({ status: "requested" });
		await expect(
			port.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula-2.png",
			),
		).resolves.toEqual({ status: "requested" });

		const anchor = fixture.clicks[0];
		const secondAnchor = fixture.clicks[1];
		expect(anchor?.isConnected).toBe(true);
		expect(secondAnchor?.isConnected).toBe(true);
		port.dispose();
		expect(anchor?.isConnected).toBe(false);
		expect(secondAnchor?.isConnected).toBe(false);
		expect(fixture.revokeObjectURL).toHaveBeenCalledTimes(2);

		fixture.cleanups[0]?.();
		fixture.cleanups[1]?.();
		expect(fixture.revokeObjectURL).toHaveBeenCalledTimes(2);
		port.dispose();
		expect(fixture.revokeObjectURL).toHaveBeenCalledTimes(2);
	});

	it("rejects unsafe filenames and non-PNG payloads without creating URLs", async () => {
		const fixture = runtimeFixture();
		const port = createBrowserEditorDownload(fixture.runtime);

		await expect(
			port.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"../formula.png",
			),
		).resolves.toEqual({
			code: "editor-download-filename-invalid",
			status: "failed",
		});
		await expect(
			port.requestPngDownload(
				new Blob(["svg"], { type: "image/svg+xml" }),
				"formula.png",
			),
		).resolves.toEqual({
			code: "editor-download-invalid-png",
			status: "failed",
		});
		expect(fixture.createObjectURL).not.toHaveBeenCalled();
	});

	it("reports anchor trigger failure while retaining delayed cleanup ownership", async () => {
		const fixture = runtimeFixture();
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
			throw new Error("anchor blocked");
		});
		const port = createBrowserEditorDownload(fixture.runtime);

		await expect(
			port.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
			),
		).resolves.toEqual({
			code: "editor-download-trigger-failed",
			status: "failed",
		});
		expect(fixture.clicks).toHaveLength(0);
		expect(fixture.revokeObjectURL).not.toHaveBeenCalled();
		fixture.cleanups[0]?.();
		expect(fixture.revokeObjectURL).toHaveBeenCalledWith(
			"blob:generated-content",
		);
	});

	it("cleans resources immediately when the delayed timer cannot be scheduled", async () => {
		const fixture = runtimeFixture();
		const port = createBrowserEditorDownload({
			...fixture.runtime,
			setTimeout: () => {
				throw new Error("timer unavailable");
			},
		});

		await expect(
			port.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
			),
		).resolves.toEqual({ status: "requested" });
		expect(fixture.clicks[0]?.isConnected).toBe(false);
		expect(fixture.revokeObjectURL).toHaveBeenCalledWith(
			"blob:generated-content",
		);
	});

	it("reports unsupported, cancellation, and object URL failures explicitly", async () => {
		const unsupported = createBrowserEditorDownload({
			document,
			setTimeout: (callback) => {
				callback();
				return 1;
			},
			createObjectURL: undefined,
			revokeObjectURL: undefined,
		});
		await expect(
			unsupported.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
			),
		).resolves.toEqual({
			code: "editor-download-unsupported",
			status: "failed",
		});

		const fixture = runtimeFixture();
		const cancelled = createBrowserEditorDownload(fixture.runtime);
		const controller = new AbortController();
		controller.abort();
		await expect(
			cancelled.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
				controller.signal,
			),
		).resolves.toEqual({ code: "editor-download-cancelled", status: "failed" });

		const urlFailure = createBrowserEditorDownload({
			...fixture.runtime,
			createObjectURL: vi.fn(() => {
				throw new Error("URL unavailable");
			}),
		});
		await expect(
			urlFailure.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
			),
		).resolves.toEqual({
			code: "editor-download-object-url-failed",
			status: "failed",
		});
	});

	it("does not claim a request after teardown", async () => {
		const fixture = runtimeFixture();
		const port = createBrowserEditorDownload(fixture.runtime);
		port.dispose();

		await expect(
			port.requestPngDownload(
				new Blob(["png"], { type: "image/png" }),
				"formula.png",
			),
		).resolves.toEqual({ code: "editor-download-disposed", status: "failed" });
	});
});
