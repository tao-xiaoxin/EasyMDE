import { describe, expect, it, vi } from "vitest";

import { startMediaPickerBridge } from "../../../entrypoints/media-picker-bridge";
import { openMediaPickerSession } from "../../../features/media-picker/media-picker-session";
import { createWordPressMediaFramePort } from "./wordpress-media-frame";

const EXPECTED_FRAME_URL =
	"https://example.test/wp-admin/admin-post.php?action=easymde_media_picker&post_id=7";

type FakePort = MessagePort &
	Readonly<{
		close: ReturnType<typeof vi.fn>;
		emit: (value: unknown) => void;
		postMessage: ReturnType<typeof vi.fn>;
		start: ReturnType<typeof vi.fn>;
	}>;

type BridgeWindow = Window & { wp?: Readonly<{ media?: unknown }> };

function fakePort(): FakePort {
	let port: FakePort;
	port = {
		close: vi.fn(),
		emit(value: unknown) {
			const onmessage = port.onmessage;
			if (onmessage)
				onmessage.call(port, new MessageEvent("message", { data: value }));
		},
		onmessage: null,
		onmessageerror: null,
		postMessage: vi.fn(),
		start: vi.fn(),
	} as unknown as FakePort;
	return port;
}

function linkedPorts() {
	let first: FakePort;
	let second: FakePort;
	const create = () => {
		const port = {
			close: vi.fn(),
			onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
			postMessage: vi.fn((value: unknown) => {
				const peer = port === first ? second : first;
				peer?.onmessage?.(new MessageEvent("message", { data: value }));
			}),
			start: vi.fn(),
		} as unknown as FakePort;
		return port;
	};
	first = create();
	second = create();
	return { first, second };
}

function setup() {
	const port1 = fakePort();
	const port2 = fakePort();
	const postMessage = vi.fn();
	const contentDocument = { readyState: "loading" };
	const location = { href: "about:blank" };
	let timeout: (() => void) | null = null;
	const runtime = {
		clearTimeout: vi.fn(),
		createMessageChannel: vi.fn(
			() => ({ port1, port2 }) as unknown as MessageChannel,
		),
		locationHref: "https://example.test/wp-admin/post.php?post=7&action=edit",
		setTimeout: vi.fn((handler: () => void) => {
			timeout = handler;
			return 17;
		}),
	};
	const frame = document.createElement("iframe");
	Object.defineProperty(frame, "contentWindow", {
		configurable: true,
		value: { location, postMessage },
	});
	Object.defineProperty(frame, "contentDocument", {
		configurable: true,
		value: contentDocument,
	});
	const adapter = createWordPressMediaFramePort({
		frameUrl: "/wp-admin/admin-post.php?action=easymde_media_picker&post_id=7",
		runtime,
		window,
	});
	const options = {
		onClose: vi.fn(),
		onError: vi.fn(),
		onSelect: vi.fn(),
		title: "Insert Media",
	};

	return {
		adapter,
		contentDocument,
		frame,
		location,
		options,
		port1,
		postMessage,
		runtime,
		timeout: () => timeout?.(),
	};
}

describe("createWordPressMediaFramePort", () => {
	it("rejects a cross-origin or credential-bearing frame URL", () => {
		expect(() =>
			createWordPressMediaFramePort({
				frameUrl: "https://other.test/media",
				runtime: {
					clearTimeout: vi.fn(),
					createMessageChannel: vi.fn(),
					locationHref: "https://example.test/wp-admin/post.php",
					setTimeout: vi.fn(),
				},
				window,
			}),
		).toThrow("wordpress-media-frame-url-invalid");
	});

	it("waits for the real iframe load after an about:blank complete document", () => {
		const { adapter, contentDocument, frame, location, options, postMessage } =
			setup();
		contentDocument.readyState = "complete";

		adapter.open(options);
		adapter.attachFrame?.(frame);

		expect(postMessage).not.toHaveBeenCalled();

		location.href = EXPECTED_FRAME_URL;
		frame.dispatchEvent(new Event("load"));

		expect(postMessage).toHaveBeenCalledOnce();
		expect(options.onError).not.toHaveBeenCalled();
	});

	it("connects immediately when the complete iframe has the exact configured URL", () => {
		const { adapter, contentDocument, frame, location, options, postMessage } =
			setup();
		contentDocument.readyState = "complete";
		location.href =
			"https://example.test/wp-admin/admin-post.php?action=easymde_media_picker&post_id=7";

		adapter.open(options);
		adapter.attachFrame?.(frame);

		expect(postMessage).toHaveBeenCalledOnce();
	});

	it("waits when location is unreadable before load and fails explicitly after load", () => {
		const { adapter, contentDocument, frame, options, postMessage } = setup();
		contentDocument.readyState = "complete";
		const contentWindow = frame.contentWindow;
		if (!contentWindow) throw new Error("test-frame-window-unavailable");
		Object.defineProperty(contentWindow, "location", {
			configurable: true,
			get: () => {
				throw new DOMException("Blocked", "SecurityError");
			},
		});

		adapter.open(options);
		adapter.attachFrame?.(frame);

		expect(postMessage).not.toHaveBeenCalled();
		expect(options.onError).not.toHaveBeenCalled();

		frame.dispatchEvent(new Event("load"));

		expect(options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				message: "wordpress-media-frame-location-unavailable",
			}),
		);
		expect(options.onClose).toHaveBeenCalledOnce();
	});

	it("connects one operation after iframe load and forwards a validated selection", () => {
		const {
			adapter,
			contentDocument,
			frame,
			location,
			options,
			port1,
			postMessage,
			runtime,
			timeout,
		} = setup();

		adapter.open(options);
		adapter.attachFrame?.(frame);
		contentDocument.readyState = "complete";
		location.href = EXPECTED_FRAME_URL;
		frame.dispatchEvent(new Event("load"));
		frame.dispatchEvent(new Event("load"));

		expect(postMessage).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith(
			{
				operationId: 1,
				title: "Insert Media",
				type: "easymde-media-picker-connect",
			},
			"https://example.test",
			[expect.anything()],
		);
		expect(runtime.setTimeout).toHaveBeenCalledWith(
			expect.any(Function),
			10_000,
		);
		port1.emit({ operationId: 1, type: "ready" });
		expect(runtime.clearTimeout).toHaveBeenCalledWith(17);
		expect(options.onClose).not.toHaveBeenCalled();
		expect(options.onError).not.toHaveBeenCalled();
		timeout();
		expect(options.onClose).not.toHaveBeenCalled();
		expect(options.onError).not.toHaveBeenCalled();

		const attachment = {
			alt: "Alternative text",
			filename: "sample.png",
			id: 91,
			title: "Sample",
			url: "https://cdn.example.test/sample.png",
		};
		port1.emit({ attachment, operationId: 1, type: "selected" });
		expect(options.onSelect).toHaveBeenCalledWith(attachment);
		expect(options.onClose).toHaveBeenCalledOnce();

		port1.emit({ operationId: 1, type: "cancelled" });
		expect(options.onClose).toHaveBeenCalledOnce();
		expect(options.onError).not.toHaveBeenCalled();
		expect(port1.close).toHaveBeenCalledOnce();
	});

	it("settles a selected operation with an onSelect failure exactly once", () => {
		const { adapter, contentDocument, frame, location, options, port1 } =
			setup();
		options.onSelect.mockImplementation(() => {
			throw new Error("media-picker-document-stale");
		});
		contentDocument.readyState = "complete";
		location.href = EXPECTED_FRAME_URL;
		adapter.open(options);
		adapter.attachFrame?.(frame);
		frame.dispatchEvent(new Event("load"));

		const attachment = {
			alt: "Alternative text",
			filename: "sample.png",
			id: 91,
			title: "Sample",
			url: "https://cdn.example.test/sample.png",
		};
		port1.emit({ attachment, operationId: 1, type: "selected" });
		port1.emit({ attachment, operationId: 1, type: "selected" });
		port1.emit({ operationId: 1, type: "cancelled" });

		expect(options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "media-picker-document-stale" }),
		);
		expect(options.onError).toHaveBeenCalledOnce();
		expect(options.onClose).toHaveBeenCalledOnce();
		expect(port1.close).toHaveBeenCalledOnce();
	});

	it("resolves the media session after the native bridge selects and closes", async () => {
		const handlers = new Map<string, () => void>();
		const bridgeListeners = new Set<(event: MessageEvent<unknown>) => void>();
		const bridgeWindow = {
			addEventListener: (name: string, listener: unknown) => {
				if ("message" === name && "function" === typeof listener) {
					bridgeListeners.add(
						listener as (event: MessageEvent<unknown>) => void,
					);
				}
			},
			location: { origin: "https://example.test" },
			parent: null as unknown,
			removeEventListener: (name: string, listener: unknown) => {
				if ("message" === name && "function" === typeof listener) {
					bridgeListeners.delete(
						listener as (event: MessageEvent<unknown>) => void,
					);
				}
			},
		} as unknown as BridgeWindow;
		Object.defineProperty(bridgeWindow, "parent", {
			configurable: true,
			value: bridgeWindow,
		});
		const nativeClose = vi.fn(() => handlers.get("close")?.());
		const nativeMedia = vi.fn(() => ({
			close: nativeClose,
			on: (name: string, handler: () => void) => handlers.set(name, handler),
			open: vi.fn(),
			state: () => ({
				get: () => ({
					first: () => ({
						toJSON: () => ({
							alt: "Alternative",
							filename: "sample.png",
							id: 91,
							title: "Sample",
							url: "https://cdn.example.test/sample.png",
						}),
					}),
				}),
			}),
		}));
		bridgeWindow.wp = { media: nativeMedia };
		const teardownBridge = startMediaPickerBridge(bridgeWindow);
		const ports = linkedPorts();
		const contentDocument = { readyState: "complete" };
		const contentWindow = {
			location: { href: EXPECTED_FRAME_URL },
			postMessage: vi.fn(
				(message: unknown, origin: string, transfer: Transferable[]) => {
					const event = new MessageEvent("message", {
						data: message,
						origin,
						ports: transfer as MessagePort[],
						source: bridgeWindow,
					});
					for (const listener of bridgeListeners) listener(event);
				},
			),
		};
		const frame = document.createElement("iframe");
		Object.defineProperty(frame, "contentDocument", {
			configurable: true,
			value: contentDocument,
		});
		Object.defineProperty(frame, "contentWindow", {
			configurable: true,
			value: contentWindow,
		});
		const adapter = createWordPressMediaFramePort({
			frameUrl:
				"/wp-admin/admin-post.php?action=easymde_media_picker&post_id=7",
			runtime: {
				clearTimeout: vi.fn(),
				createMessageChannel: vi.fn(() => ({
					port1: ports.first,
					port2: ports.second,
				})),
				locationHref:
					"https://example.test/wp-admin/post.php?post=7&action=edit",
				setTimeout: vi.fn(() => 17),
			},
			window,
		});
		let currentValue = "before IMAGE after";
		const documentPort = {
			applyTextChange: vi.fn((change: { value: string }) => {
				currentValue = change.value;
			}),
			focus: vi.fn(),
			getSnapshot: () => ({
				selection: { direction: "backward" as const, end: 12, start: 7 },
				value: currentValue,
			}),
		};
		const session = openMediaPickerSession({
			document: documentPort,
			frame: adapter,
			strings: {
				canUseMedia: true,
				defaultAlt: "image",
				frameUrl: "https://example.test/media-picker",
				insertMedia: "Insert Media",
				insertion: { titleDisplay: "none" },
				placeholderAlt: "alt text",
			},
		});
		const detach = adapter.attachFrame?.(frame);
		try {
			handlers.get("select")?.();
			await expect(session).resolves.toBe("inserted");
			expect(currentValue).toBe(
				"before ![sample](https://cdn.example.test/sample.png) after",
			);
			expect(documentPort.applyTextChange).toHaveBeenCalledOnce();
			expect(documentPort.focus).toHaveBeenCalledOnce();
			expect(nativeClose).toHaveBeenCalledOnce();
		} finally {
			detach?.();
			adapter.dispose?.();
			teardownBridge();
			delete bridgeWindow.wp;
		}
	});

	it("fails a duplicate ready message instead of closing silently", () => {
		const { adapter, contentDocument, frame, location, options, port1 } =
			setup();
		contentDocument.readyState = "complete";
		location.href = EXPECTED_FRAME_URL;
		adapter.open(options);
		adapter.attachFrame?.(frame);
		frame.dispatchEvent(new Event("load"));

		port1.emit({ operationId: 1, type: "ready" });
		port1.emit({ operationId: 1, type: "ready" });

		expect(options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				message: "wordpress-media-frame-message-invalid",
			}),
		);
		expect(options.onClose).toHaveBeenCalledOnce();
	});

	it.each([
		["stale", { operationId: 2, type: "ready" }],
		["malformed", { operationId: 1, extra: true, type: "ready" }],
	])("fails a %s ready message for the active operation", (_name, message) => {
		const { adapter, contentDocument, frame, location, options, port1 } =
			setup();
		contentDocument.readyState = "complete";
		location.href = EXPECTED_FRAME_URL;
		adapter.open(options);
		adapter.attachFrame?.(frame);
		frame.dispatchEvent(new Event("load"));

		port1.emit(message);

		expect(options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				message: "wordpress-media-frame-message-invalid",
			}),
		);
		expect(options.onClose).toHaveBeenCalledOnce();
	});

	it("fails explicitly for malformed, stale, and remote failure messages", () => {
		const first = setup();
		first.adapter.open(first.options);
		first.adapter.attachFrame?.(first.frame);
		first.contentDocument.readyState = "complete";
		first.location.href = EXPECTED_FRAME_URL;
		first.frame.dispatchEvent(new Event("load"));
		first.port1.emit({ operationId: 2, type: "cancelled" });
		expect(first.options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				message: "wordpress-media-frame-message-invalid",
			}),
		);
		expect(first.options.onClose).toHaveBeenCalledOnce();

		const second = setup();
		second.adapter.open(second.options);
		second.adapter.attachFrame?.(second.frame);
		second.contentDocument.readyState = "complete";
		second.location.href = EXPECTED_FRAME_URL;
		second.frame.dispatchEvent(new Event("load"));
		second.port1.emit({
			code: "media-picker-runtime-unavailable",
			operationId: 1,
			type: "failed",
		});
		expect(second.options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "media-picker-runtime-unavailable" }),
		);
	});

	it("cancels the child operation synchronously and releases the owner", () => {
		const { adapter, contentDocument, frame, location, options, port1 } =
			setup();
		adapter.open(options);
		adapter.attachFrame?.(frame);
		contentDocument.readyState = "complete";
		location.href = EXPECTED_FRAME_URL;
		frame.dispatchEvent(new Event("load"));

		adapter.cancel?.();

		expect(port1.postMessage).toHaveBeenCalledWith({
			operationId: 1,
			type: "cancel",
		});
		expect(options.onClose).toHaveBeenCalledOnce();
		expect(options.onError).not.toHaveBeenCalled();
		expect(() => adapter.open(options)).not.toThrow();
	});

	it("reports iframe load failure, timeout, and teardown without silent fallback", () => {
		const loadFailure = setup();
		loadFailure.adapter.open(loadFailure.options);
		loadFailure.adapter.attachFrame?.(loadFailure.frame);
		loadFailure.contentDocument.readyState = "complete";
		loadFailure.frame.dispatchEvent(new Event("error"));
		expect(loadFailure.options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "wordpress-media-frame-load-failed" }),
		);

		const timedOut = setup();
		timedOut.adapter.open(timedOut.options);
		timedOut.timeout();
		expect(timedOut.options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "wordpress-media-frame-timeout" }),
		);

		const disposed = setup();
		disposed.adapter.open(disposed.options);
		disposed.adapter.dispose?.();
		expect(disposed.options.onError.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: "wordpress-media-frame-disposed" }),
		);
		expect(() => disposed.adapter.open(disposed.options)).toThrow(
			"wordpress-media-frame-disposed",
		);
	});
});
