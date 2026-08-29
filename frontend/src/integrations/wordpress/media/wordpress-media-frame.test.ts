import { describe, expect, it, vi } from "vitest";

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
		expect(options.onClose).not.toHaveBeenCalled();

		port1.emit({ operationId: 1, type: "cancelled" });
		expect(options.onClose).toHaveBeenCalledOnce();
		expect(options.onError).not.toHaveBeenCalled();
		expect(port1.close).toHaveBeenCalledOnce();
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
