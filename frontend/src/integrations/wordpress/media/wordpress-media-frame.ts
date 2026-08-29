import type {
	MediaPickerFrameOptions,
	MediaPickerFramePort,
} from "../../../contracts/ports/media-picker-port";

const FRAME_TIMEOUT_MS = 10_000;
const MAX_OPERATION_ID = Number.MAX_SAFE_INTEGER;
const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 4096;

type BrowserRuntime = Readonly<{
	clearTimeout: (id: number) => void;
	createMessageChannel: () => MessageChannel;
	locationHref: string;
	setTimeout: (handler: () => void, timeout: number) => number;
}>;

type ActiveOperation = {
	connected: boolean;
	frame: HTMLIFrameElement | null;
	id: number;
	options: MediaPickerFrameOptions;
	port: MessagePort | null;
	ready: boolean;
	settled: boolean;
	timeout: number;
	timeoutActive: boolean;
};

type BridgeMessage =
	| Readonly<{ operationId: number; type: "cancelled" }>
	| Readonly<{ code: string; operationId: number; type: "failed" }>
	| Readonly<{ operationId: number; type: "ready" }>
	| Readonly<{ attachment: unknown; operationId: number; type: "selected" }>;

type FrameReadiness =
	| "ready"
	| "waiting"
	| "window-unavailable"
	| "location-unavailable";

type Attachment = Readonly<{
	alt: string;
	filename: string;
	id: number;
	title: string;
	url: string;
}>;

function exactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function boundedText(value: unknown): string | null {
	return "string" === typeof value && value.length <= MAX_TEXT_LENGTH
		? value
		: null;
}

function attachmentValue(value: unknown): Attachment | null {
	if (!value || "object" !== typeof value || Array.isArray(value)) return null;
	const attachment = value as Record<string, unknown>;
	if (!exactKeys(attachment, ["alt", "filename", "id", "title", "url"]))
		return null;
	const id = attachment.id;
	const url = attachment.url;
	const alt = boundedText(attachment.alt);
	const filename = boundedText(attachment.filename);
	const title = boundedText(attachment.title);
	if (
		!Number.isSafeInteger(id) ||
		Number(id) <= 0 ||
		null === alt ||
		null === filename ||
		null === title
	) {
		return null;
	}
	if ("string" !== typeof url || !url || url.length > MAX_URL_LENGTH)
		return null;
	try {
		const parsed = new URL(url);
		if (
			!["http:", "https:"].includes(parsed.protocol) ||
			parsed.username ||
			parsed.password
		)
			return null;
	} catch {
		return null;
	}
	return { alt, filename, id: Number(id), title, url };
}

function bridgeMessage(value: unknown): BridgeMessage | null {
	if (!value || "object" !== typeof value || Array.isArray(value)) return null;
	const message = value as Record<string, unknown>;
	if (
		!Number.isSafeInteger(message.operationId) ||
		Number(message.operationId) <= 0
	)
		return null;
	if (
		"cancelled" === message.type &&
		exactKeys(message, ["operationId", "type"])
	) {
		return message as BridgeMessage;
	}
	if (
		"failed" === message.type &&
		exactKeys(message, ["code", "operationId", "type"])
	) {
		const code = message.code;
		if ("string" === typeof code && /^[a-z0-9-]{1,80}$/.test(code))
			return message as BridgeMessage;
	}
	if ("ready" === message.type && exactKeys(message, ["operationId", "type"])) {
		return message as BridgeMessage;
	}
	if (
		"selected" === message.type &&
		exactKeys(message, ["attachment", "operationId", "type"])
	) {
		if (attachmentValue(message.attachment)) return message as BridgeMessage;
	}
	return null;
}

function frameUrl(value: string, locationHref: string): URL {
	const current = new URL(locationHref);
	const parsed = new URL(value, current);
	if (
		parsed.origin !== current.origin ||
		parsed.username ||
		parsed.password ||
		!["http:", "https:"].includes(parsed.protocol)
	) {
		throw new Error("wordpress-media-frame-url-invalid");
	}
	return parsed;
}

function frameReadiness(
	frame: HTMLIFrameElement,
	expectedHref: string,
): FrameReadiness {
	let contentDocument: Document | null;
	try {
		contentDocument = frame.contentDocument;
	} catch {
		return "location-unavailable";
	}
	if ("complete" !== contentDocument?.readyState) return "waiting";

	let contentWindow: Window | null;
	try {
		contentWindow = frame.contentWindow;
	} catch {
		return "location-unavailable";
	}
	if (!contentWindow) return "window-unavailable";
	try {
		return contentWindow.location.href === expectedHref ? "ready" : "waiting";
	} catch {
		return "location-unavailable";
	}
}

function defaultRuntime(windowRef: Window): BrowserRuntime {
	return {
		clearTimeout: windowRef.clearTimeout.bind(windowRef),
		createMessageChannel: () => new MessageChannel(),
		locationHref: windowRef.location.href,
		setTimeout: windowRef.setTimeout.bind(windowRef),
	};
}

export function createWordPressMediaFramePort(
	value: Readonly<{
		frameUrl: string;
		window: Window;
		runtime?: BrowserRuntime;
	}>,
): MediaPickerFramePort {
	const runtime = value.runtime ?? defaultRuntime(value.window);
	const url = frameUrl(value.frameUrl, runtime.locationHref);
	let active: ActiveOperation | null = null;
	let disposed = false;
	let nextOperationId = 1;

	const clearConnectionTimeout = (operation: ActiveOperation) => {
		if (!operation.timeoutActive) return;
		runtime.clearTimeout(operation.timeout);
		operation.timeoutActive = false;
	};

	const finish = (operation: ActiveOperation, error?: unknown) => {
		if (operation.settled) return;
		operation.settled = true;
		clearConnectionTimeout(operation);
		operation.port?.close();
		if (active === operation) active = null;
		if (error) operation.options.onError(error);
		operation.options.onClose();
	};

	const connect = (operation: ActiveOperation, afterLoad = false) => {
		const frame = operation.frame;
		if (operation.connected || operation.settled || disposed || !frame) return;
		const readiness = frameReadiness(frame, url.href);
		if ("waiting" === readiness) return;
		if ("location-unavailable" === readiness) {
			if (afterLoad)
				finish(
					operation,
					new Error("wordpress-media-frame-location-unavailable"),
				);
			return;
		}
		const contentWindow = frame.contentWindow;
		if (!contentWindow) {
			if (afterLoad)
				finish(
					operation,
					new Error("wordpress-media-frame-window-unavailable"),
				);
			return;
		}
		operation.connected = true;
		try {
			const channel = runtime.createMessageChannel();
			operation.port = channel.port1;
			channel.port1.onmessage = (event: MessageEvent<unknown>) => {
				if (disposed || active !== operation || operation.settled) return;
				const message = bridgeMessage(event.data);
				if (!message || message.operationId !== operation.id) {
					finish(operation, new Error("wordpress-media-frame-message-invalid"));
					return;
				}
				if ("ready" === message.type) {
					if (operation.ready) {
						finish(
							operation,
							new Error("wordpress-media-frame-message-invalid"),
						);
						return;
					}
					operation.ready = true;
					clearConnectionTimeout(operation);
					return;
				}
				if ("selected" === message.type) {
					const attachment = attachmentValue(message.attachment);
					if (!attachment) {
						finish(
							operation,
							new Error("wordpress-media-frame-message-invalid"),
						);
						return;
					}
					try {
						operation.options.onSelect(attachment);
					} catch (error) {
						finish(operation, error);
					}
					return;
				}
				if ("failed" === message.type) {
					finish(operation, new Error(message.code));
					return;
				}
				finish(operation);
			};
			channel.port1.start();
			contentWindow.postMessage(
				{
					operationId: operation.id,
					title: operation.options.title.slice(0, MAX_TEXT_LENGTH),
					type: "easymde-media-picker-connect",
				},
				url.origin,
				[channel.port2],
			);
		} catch (error) {
			finish(operation, error);
		}
	};

	return {
		attachFrame(frame) {
			if (disposed || !active)
				throw new Error("wordpress-media-frame-operation-unavailable");
			if (active.frame && active.frame !== frame)
				throw new Error("wordpress-media-frame-owner-conflict");
			const operation = active;
			operation.frame = frame;
			const onLoad = () => connect(operation, true);
			const onError = () =>
				finish(operation, new Error("wordpress-media-frame-load-failed"));
			frame.addEventListener("load", onLoad);
			frame.addEventListener("error", onError, { once: true });
			connect(operation);
			return () => {
				frame.removeEventListener("load", onLoad);
				frame.removeEventListener("error", onError);
				if (active === operation && operation.frame === frame)
					operation.frame = null;
			};
		},
		cancel() {
			if (!active) return;
			active.port?.postMessage({ operationId: active.id, type: "cancel" });
			finish(active);
		},
		dispose() {
			disposed = true;
			if (active) {
				active.port?.postMessage({ operationId: active.id, type: "cancel" });
				finish(active, new Error("wordpress-media-frame-disposed"));
			}
		},
		frameUrl: url.href,
		open(options) {
			if (disposed) throw new Error("wordpress-media-frame-disposed");
			if (active) throw new Error("wordpress-media-frame-busy");
			if (!options.title || options.title.length > MAX_TEXT_LENGTH) {
				throw new Error("wordpress-media-frame-title-invalid");
			}
			const id = nextOperationId;
			nextOperationId =
				nextOperationId === MAX_OPERATION_ID ? 1 : nextOperationId + 1;
			const operation = {
				connected: false,
				frame: null,
				id,
				options,
				port: null,
				ready: false,
				settled: false,
				timeout: 0,
				timeoutActive: true,
			};
			operation.timeout = runtime.setTimeout(() => {
				if (operation.timeoutActive)
					finish(operation, new Error("wordpress-media-frame-timeout"));
			}, FRAME_TIMEOUT_MS);
			active = operation;
		},
	};
}
