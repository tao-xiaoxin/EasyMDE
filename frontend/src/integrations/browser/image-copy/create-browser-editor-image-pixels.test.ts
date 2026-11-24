// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	EDITOR_IMAGE_PIXELS_MAX_BYTES,
	EDITOR_IMAGE_PIXELS_MAX_DIMENSION,
	EDITOR_IMAGE_PIXELS_TIMEOUT_MS,
	type EditorImagePixelsLease,
} from "../../../contracts/ports/editor-image-pixels-port";
import {
	type BrowserEditorImagePixelsRuntime,
	createBrowserEditorImagePixels,
} from "./create-browser-editor-image-pixels";

type ImageLeaseFixture = Readonly<{
	image: HTMLImageElement;
	lease: EditorImagePixelsLease;
	setCurrent: (current: boolean) => void;
	setSource: (source: string) => void;
}>;

const origin = window.location.origin;

function runtime(
	overrides: Partial<BrowserEditorImagePixelsRuntime> = {},
): BrowserEditorImagePixelsRuntime {
	return {
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
		document,
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		...overrides,
	};
}

function imageLease(
	overrides: Readonly<{
		height?: number;
		source?: string;
		width?: number;
	}> = {},
): ImageLeaseFixture {
	const image = document.createElement("img");
	let current = true;
	let source = overrides.source ?? `${origin}/image.png`;
	Object.defineProperties(image, {
		currentSrc: {
			configurable: true,
			get: () => source,
		},
		naturalHeight: {
			configurable: true,
			value: overrides.height ?? 40,
		},
		naturalWidth: {
			configurable: true,
			value: overrides.width ?? 80,
		},
		sizes: {
			configurable: true,
			value: "",
		},
		src: {
			configurable: true,
			get: () => source,
		},
		srcset: {
			configurable: true,
			value: "",
		},
	});
	document.body.append(image);
	return {
		image,
		lease: {
			image,
			isCurrent: () => current,
		},
		setCurrent: (value) => {
			current = value;
		},
		setSource: (value) => {
			source = value;
		},
	};
}

function mockCanvas(
	blob: Blob | null = new Blob(["png"], { type: "image/png" }),
): Readonly<{ drawImage: ReturnType<typeof vi.fn> }> {
	const context = { drawImage: vi.fn() };
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
		context as unknown as CanvasRenderingContext2D,
	);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
		(callback) => {
			callback(blob);
		},
	);
	return context;
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("createBrowserEditorImagePixels", () => {
	it("reports truthful capability and extracts existing native pixels without resizing", async () => {
		const context = mockCanvas();
		const fixture = imageLease();
		const port = createBrowserEditorImagePixels(runtime());

		expect(port.supports()).toBe(true);
		expect(port.canExtract(fixture.lease)).toBe(true);
		const result = await port.extractPng({ lease: fixture.lease });

		expect(result).toMatchObject({
			height: 40,
			pixelCount: 3_200,
			source: `${origin}/image.png`,
			status: "extracted",
			width: 80,
		});
		expect((result as { blob: Blob }).blob.type).toBe("image/png");
		expect(context.drawImage).toHaveBeenCalledWith(fixture.image, 0, 0);
	});

	it.each([
		[
			"cross-origin",
			"https://other.example/image.png",
			"editor-image-pixels-origin-invalid",
		],
		[
			"data URL",
			"data:image/png;base64,AAAA",
			"editor-image-pixels-origin-invalid",
		],
		[
			"oversized dimension",
			`${origin}/image.png`,
			"editor-image-pixels-dimensions-invalid",
		],
	] as const)("rejects %s before drawing", async (name, source, code) => {
		const context = mockCanvas();
		const fixture = imageLease(
			"oversized dimension" === name
				? { height: EDITOR_IMAGE_PIXELS_MAX_DIMENSION + 1 }
				: { source },
		);
		const port = createBrowserEditorImagePixels(runtime());

		expect(port.canExtract(fixture.lease)).toBe(false);
		expect(await port.extractPng({ lease: fixture.lease })).toEqual({
			code,
			status: "failed",
		});
		expect(context.drawImage).not.toHaveBeenCalled();
	});

	it("rejects the total pixel budget before creating a canvas draw", async () => {
		const context = mockCanvas();
		const fixture = imageLease({
			height: 3907,
			width: 4096,
		});
		const port = createBrowserEditorImagePixels(runtime());

		expect(await port.extractPng({ lease: fixture.lease })).toEqual({
			code: "editor-image-pixels-pixel-limit",
			status: "failed",
		});
		expect(context.drawImage).not.toHaveBeenCalled();
	});

	it("invalidates a lease when source or loaded dimensions change", async () => {
		const context = mockCanvas();
		const fixture = imageLease();
		let checks = 0;
		const lease: EditorImagePixelsLease = {
			image: fixture.image,
			isCurrent: () => {
				checks += 1;
				if (2 === checks) fixture.setSource(`${origin}/changed.png`);
				return true;
			},
		};
		const port = createBrowserEditorImagePixels(runtime());

		expect(await port.extractPng({ lease })).toEqual({
			code: "editor-image-pixels-lease-stale",
			status: "failed",
		});
		expect(context.drawImage).not.toHaveBeenCalled();
	});

	it("rejects a source change after drawing and before publishing PNG bytes", async () => {
		let callback: ((blob: Blob | null) => void) | null = null;
		const context = { drawImage: vi.fn() };
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as CanvasRenderingContext2D,
		);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(next) => {
				callback = next;
			},
		);
		const fixture = imageLease();
		let checks = 0;
		const lease: EditorImagePixelsLease = {
			image: fixture.image,
			isCurrent: () => {
				checks += 1;
				if (3 === checks) fixture.setSource(`${origin}/changed.png`);
				return true;
			},
		};
		const pending = createBrowserEditorImagePixels(runtime()).extractPng({
			lease,
		});
		await Promise.resolve();
		(callback as ((blob: Blob | null) => void) | null)?.(
			new Blob(["png"], { type: "image/png" }),
		);

		expect(await pending).toEqual({
			code: "editor-image-pixels-lease-stale",
			status: "failed",
		});
	});

	it("rejects tainted draws, empty PNGs, wrong MIME, and oversized PNGs explicitly", async () => {
		const fixture = imageLease();
		const context = mockCanvas();
		context.drawImage.mockImplementation(() => {
			throw new DOMException("tainted", "SecurityError");
		});
		const port = createBrowserEditorImagePixels(runtime());
		expect(await port.extractPng({ lease: fixture.lease })).toEqual({
			code: "editor-image-pixels-tainted",
			status: "failed",
		});

		vi.restoreAllMocks();
		document.body.replaceChildren();
		const empty = imageLease();
		mockCanvas(null);
		const emptyResult = await createBrowserEditorImagePixels(
			runtime(),
		).extractPng({
			lease: empty.lease,
		});
		expect(emptyResult).toEqual({
			code: "editor-image-pixels-empty",
			status: "failed",
		});

		vi.restoreAllMocks();
		document.body.replaceChildren();
		const wrongMime = imageLease();
		mockCanvas(new Blob(["webp"], { type: "image/webp" }));
		const wrongMimeResult = await createBrowserEditorImagePixels(
			runtime(),
		).extractPng({
			lease: wrongMime.lease,
		});
		expect(wrongMimeResult).toEqual({
			code: "editor-image-pixels-mime-invalid",
			status: "failed",
		});

		vi.restoreAllMocks();
		document.body.replaceChildren();
		const oversized = imageLease();
		mockCanvas({
			size: EDITOR_IMAGE_PIXELS_MAX_BYTES + 1,
			type: "image/png",
		} as Blob);
		const oversizedResult = await createBrowserEditorImagePixels(
			runtime(),
		).extractPng({
			lease: oversized.lease,
		});
		expect(oversizedResult).toEqual({
			code: "editor-image-pixels-output-too-large",
			status: "failed",
		});
	});

	it("maps a PNG encoder SecurityError to the explicit tainted result", async () => {
		const context = { drawImage: vi.fn() };
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as CanvasRenderingContext2D,
		);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {
			throw new DOMException("tainted", "SecurityError");
		});
		const fixture = imageLease();

		expect(
			await createBrowserEditorImagePixels(runtime()).extractPng({
				lease: fixture.lease,
			}),
		).toEqual({
			code: "editor-image-pixels-tainted",
			status: "failed",
		});
	});

	it("cancels and disposes pending native callbacks without publishing late results", async () => {
		let callback: ((blob: Blob | null) => void) | null = null;
		const context = { drawImage: vi.fn() };
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as CanvasRenderingContext2D,
		);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(next) => {
				callback = next;
			},
		);
		const fixture = imageLease();
		const controller = new AbortController();
		const port = createBrowserEditorImagePixels(runtime());
		const pending = port.extractPng({
			lease: fixture.lease,
			signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort();
		expect(await pending).toEqual({
			code: "editor-image-pixels-cancelled",
			status: "failed",
		});
		(callback as ((blob: Blob | null) => void) | null)?.(
			new Blob(["late"], { type: "image/png" }),
		);

		const second = imageLease();
		const secondPending = port.extractPng({ lease: second.lease });
		await Promise.resolve();
		port.dispose();
		expect(await secondPending).toEqual({
			code: "editor-image-pixels-disposed",
			status: "failed",
		});
	});

	it("times out an encoder that never calls back and cleans its canvas", async () => {
		vi.useFakeTimers();
		try {
			const canvas = document.createElement("canvas");
			const context = { drawImage: vi.fn() };
			vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
				context as unknown as CanvasRenderingContext2D,
			);
			vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
				() => undefined,
			);
			const fixture = imageLease();
			const port = createBrowserEditorImagePixels(
				runtime({ createCanvas: () => canvas }),
			);
			const pending = port.extractPng({ lease: fixture.lease });
			await vi.advanceTimersByTimeAsync(EDITOR_IMAGE_PIXELS_TIMEOUT_MS);
			expect(await pending).toEqual({
				code: "editor-image-pixels-timeout",
				status: "failed",
			});
			expect(canvas.width).toBe(0);
			expect(canvas.height).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
