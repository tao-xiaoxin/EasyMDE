import { afterEach, describe, expect, it, vi } from "vitest";

import { startMediaPickerBridge } from "./media-picker-bridge";

type TestWindow = Window & { wp?: Readonly<{ media?: unknown }> };

function port() {
	const value = {
		close: vi.fn(),
		onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
		postMessage: vi.fn(),
		start: vi.fn(),
	};
	return value as unknown as MessagePort & typeof value;
}

function connect(
	target: Window,
	messagePort: MessagePort,
	overrides: Record<string, unknown> = {},
) {
	target.dispatchEvent(
		new MessageEvent("message", {
			data: {
				operationId: 9,
				title: "Insert Media",
				type: "easymde-media-picker-connect",
				...overrides,
			},
			origin: target.location.origin,
			ports: [messagePort],
			source: target,
		}),
	);
}

const teardowns: Array<() => void> = [];

afterEach(() => {
	while (teardowns.length) teardowns.pop()?.();
	delete (window as TestWindow).wp;
});

describe("startMediaPickerBridge", () => {
	it("opens the native WordPress frame and sends one validated attachment", () => {
		const handlers = new Map<string, () => void>();
		const close = vi.fn();
		const open = vi.fn();
		const media = vi.fn(() => ({
			close,
			on: (name: string, handler: () => void) => handlers.set(name, handler),
			open,
			state: () => ({
				get: () => ({
					first: () => ({
						toJSON: () => ({
							alt: "Alternative",
							filename: "sample.png",
							id: 37,
							title: "Sample",
							url: "https://example.test/uploads/sample.png",
						}),
					}),
				}),
			}),
		}));
		(window as TestWindow).wp = { media };
		teardowns.push(startMediaPickerBridge(window as TestWindow));
		const messagePort = port();

		connect(window, messagePort);
		expect(media).toHaveBeenCalledWith({
			multiple: false,
			title: "Insert Media",
		});
		expect(open).toHaveBeenCalledOnce();
		expect(messagePort.postMessage).toHaveBeenCalledWith({
			operationId: 9,
			type: "ready",
		});

		handlers.get("select")?.();
		expect(messagePort.postMessage).toHaveBeenCalledWith({
			attachment: {
				alt: "Alternative",
				filename: "sample.png",
				id: 37,
				title: "Sample",
				url: "https://example.test/uploads/sample.png",
			},
			operationId: 9,
			type: "selected",
		});

		handlers.get("close")?.();
		expect(messagePort.postMessage).toHaveBeenLastCalledWith({
			operationId: 9,
			type: "cancelled",
		});
		expect(messagePort.close).toHaveBeenCalledOnce();
	});

	it("rejects foreign, malformed, and duplicate parent connections", () => {
		const media = vi.fn();
		(window as TestWindow).wp = { media };
		teardowns.push(startMediaPickerBridge(window as TestWindow));
		const messagePort = port();
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					operationId: 9,
					title: "Insert Media",
					type: "easymde-media-picker-connect",
				},
				origin: "https://other.test",
				ports: [messagePort],
				source: window,
			}),
		);
		connect(window, messagePort, { extra: true });
		expect(media).not.toHaveBeenCalled();
	});

	it("does not report ready when opening the native frame throws", () => {
		const messagePort = port();
		(window as TestWindow).wp = {
			media: () => ({
				close: vi.fn(),
				on: vi.fn(),
				open: vi.fn(() => {
					throw new Error("media-picker-open-failed");
				}),
				state: vi.fn(),
			}),
		};
		teardowns.push(startMediaPickerBridge(window as TestWindow));

		connect(window, messagePort);

		expect(messagePort.postMessage).not.toHaveBeenCalledWith({
			operationId: 9,
			type: "ready",
		});
		expect(messagePort.postMessage).toHaveBeenCalledWith({
			code: "media-picker-open-failed",
			operationId: 9,
			type: "failed",
		});
	});

	it("reports unavailable runtime and invalid selections with stable codes", () => {
		const unavailablePort = port();
		teardowns.push(startMediaPickerBridge(window as TestWindow));
		connect(window, unavailablePort);
		expect(unavailablePort.postMessage).toHaveBeenCalledWith({
			code: "media-picker-runtime-unavailable",
			operationId: 9,
			type: "failed",
		});
		teardowns.pop()?.();

		const handlers = new Map<string, () => void>();
		(window as TestWindow).wp = {
			media: () => ({
				close: vi.fn(),
				on: (name: string, handler: () => void) => handlers.set(name, handler),
				open: vi.fn(),
				state: () => ({ get: () => ({ first: () => null }) }),
			}),
		};
		const invalidPort = port();
		teardowns.push(startMediaPickerBridge(window as TestWindow));
		connect(window, invalidPort);
		handlers.get("select")?.();
		expect(invalidPort.postMessage).toHaveBeenCalledWith({
			code: "media-picker-selection-invalid",
			operationId: 9,
			type: "failed",
		});
	});

	it("closes the native frame when the parent cancels or tears down", () => {
		const close = vi.fn();
		(window as TestWindow).wp = {
			media: () => ({
				close,
				on: vi.fn(),
				open: vi.fn(),
				state: vi.fn(),
			}),
		};
		const teardown = startMediaPickerBridge(window as TestWindow);
		teardowns.push(teardown);
		const messagePort = port();
		connect(window, messagePort);
		messagePort.onmessage?.(
			new MessageEvent("message", {
				data: { operationId: 9, type: "cancel" },
			}),
		);
		expect(close).toHaveBeenCalledOnce();
		expect(messagePort.postMessage).toHaveBeenCalledWith({
			operationId: 9,
			type: "cancelled",
		});
		teardown();
	});
});
