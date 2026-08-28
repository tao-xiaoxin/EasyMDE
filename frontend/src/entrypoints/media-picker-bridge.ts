type WordPressMediaFrame = Readonly<{
	close: () => void;
	on: (name: string, callback: () => void) => void;
	open: () => void;
	state: () => unknown;
}>;

type WordPressMediaFactory = (
	options: Readonly<{
		multiple: false;
		title: string;
	}>,
) => unknown;

type BridgeWindow = Window &
	Readonly<{
		wp?: Readonly<{ media?: unknown }>;
	}>;

const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 4096;

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

function frameValue(value: unknown): WordPressMediaFrame {
	if (!value || "object" !== typeof value)
		throw new Error("media-picker-frame-invalid");
	const frame = value as Partial<WordPressMediaFrame>;
	if (
		"function" !== typeof frame.close ||
		"function" !== typeof frame.on ||
		"function" !== typeof frame.open ||
		"function" !== typeof frame.state
	) {
		throw new Error("media-picker-frame-invalid");
	}
	return frame as WordPressMediaFrame;
}

function attachmentValue(frame: WordPressMediaFrame): Readonly<{
	alt: string;
	filename: string;
	id: number;
	title: string;
	url: string;
}> {
	const state = frame.state();
	const get =
		state && "object" === typeof state
			? (state as { get?: unknown }).get
			: null;
	if ("function" !== typeof get)
		throw new Error("media-picker-selection-invalid");
	const selection = get.call(state, "selection") as { first?: unknown } | null;
	const first =
		selection && "function" === typeof selection.first
			? selection.first.call(selection)
			: null;
	const toJSON =
		first && "object" === typeof first
			? (first as { toJSON?: unknown }).toJSON
			: null;
	const value = "function" === typeof toJSON ? toJSON.call(first) : null;
	if (!value || "object" !== typeof value || Array.isArray(value)) {
		throw new Error("media-picker-selection-invalid");
	}
	const attachment = value as Record<string, unknown>;
	const id = attachment.id;
	const url = attachment.url;
	if (
		!Number.isSafeInteger(id) ||
		Number(id) <= 0 ||
		"string" !== typeof url ||
		!url ||
		url.length > MAX_URL_LENGTH
	) {
		throw new Error("media-picker-selection-invalid");
	}
	const parsed = new URL(url);
	if (
		!["http:", "https:"].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password
	) {
		throw new Error("media-picker-selection-invalid");
	}
	const text = (candidate: unknown) =>
		"string" === typeof candidate ? candidate.slice(0, MAX_TEXT_LENGTH) : "";
	return {
		alt: text(attachment.alt),
		filename: text(attachment.filename),
		id: Number(id),
		title: text(attachment.title),
		url,
	};
}

function failureCode(error: unknown): string {
	return error instanceof Error &&
		/^media-picker-[a-z0-9-]+$/.test(error.message)
		? error.message
		: "media-picker-runtime-failed";
}

export function startMediaPickerBridge(windowRef: BridgeWindow): () => void {
	let active = false;
	let activeFrame: WordPressMediaFrame | null = null;
	const onMessage = (event: MessageEvent<unknown>) => {
		if (
			active ||
			event.origin !== windowRef.location.origin ||
			event.source !== windowRef.parent
		)
			return;
		if (
			!event.data ||
			"object" !== typeof event.data ||
			Array.isArray(event.data)
		)
			return;
		const message = event.data as Record<string, unknown>;
		if (!exactKeys(message, ["operationId", "title", "type"])) return;
		if (
			"easymde-media-picker-connect" !== message.type ||
			!Number.isSafeInteger(message.operationId) ||
			Number(message.operationId) <= 0 ||
			"string" !== typeof message.title ||
			!message.title ||
			message.title.length > MAX_TEXT_LENGTH ||
			1 !== event.ports.length
		) {
			return;
		}

		active = true;
		const operationId = Number(message.operationId);
		const port = event.ports[0];
		if (!port) return;
		let frame: WordPressMediaFrame | null = null;
		let selected = false;
		let closed = false;
		const finish = () => {
			if (closed) return;
			closed = true;
			port.postMessage({ operationId, type: "cancelled" });
			port.close();
		};

		port.onmessage = (portEvent: MessageEvent<unknown>) => {
			const value = portEvent.data;
			if (
				value &&
				"object" === typeof value &&
				!Array.isArray(value) &&
				exactKeys(value as Record<string, unknown>, ["operationId", "type"]) &&
				"cancel" === (value as { type?: unknown }).type &&
				operationId === (value as { operationId?: unknown }).operationId
			) {
				frame?.close();
				finish();
			}
		};
		port.start();

		try {
			const media = windowRef.wp?.media;
			if ("function" !== typeof media)
				throw new Error("media-picker-runtime-unavailable");
			frame = frameValue(
				(media as WordPressMediaFactory)({
					multiple: false,
					title: message.title,
				}),
			);
			activeFrame = frame;
			frame.on("select", () => {
				if (selected || closed || !frame) return;
				selected = true;
				try {
					port.postMessage({
						attachment: attachmentValue(frame),
						operationId,
						type: "selected",
					});
				} catch (error) {
					port.postMessage({
						code: failureCode(error),
						operationId,
						type: "failed",
					});
				}
			});
			frame.on("close", finish);
			frame.open();
			if (!closed) {
				port.postMessage({ operationId, type: "ready" });
			}
		} catch (error) {
			port.postMessage({
				code: failureCode(error),
				operationId,
				type: "failed",
			});
			port.close();
		}
	};
	windowRef.addEventListener("message", onMessage);
	return () => {
		windowRef.removeEventListener("message", onMessage);
		activeFrame?.close();
		activeFrame = null;
	};
}

if (import.meta.env.MODE !== "test") {
	startMediaPickerBridge(window as BridgeWindow);
}
