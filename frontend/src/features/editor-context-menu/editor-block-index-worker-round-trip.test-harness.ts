import type {
	EditorBlockIndexWorkerRequest,
	EditorBlockIndexWorkerResponse,
	ReferenceLabelCaseFoldProfile,
} from "../../contracts/ports/editor-block-index-port";
import { createEditorBlockIndexWorkerHandler } from "../../entrypoints/editor-block-index-worker";
import { createBrowserEditorBlockIndexWorker } from "../../integrations/browser/editor-context-menu/create-browser-editor-block-index-worker";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";

type Listener = (event: Event | MessageEvent<unknown>) => void;

/**
 * Builds a block index through the real worker entry (`packed-v3` packing)
 * and the real browser adapter (validation and unpacking), so tests observe
 * exactly what production menu queries receive from the worker path.
 */
export async function buildWorkerRoundTripBlockIndex(
	source: string,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile = 14,
): Promise<EditorMarkdownBlockIndex> {
	class RoundTripWorker {
		private readonly listeners = new Map<string, Set<Listener>>();
		addEventListener(type: string, listener: Listener): void {
			const set = this.listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			this.listeners.set(type, set);
		}
		removeEventListener(type: string, listener: Listener): void {
			this.listeners.get(type)?.delete(listener);
		}
		postMessage(message: EditorBlockIndexWorkerRequest): void {
			const handler = createEditorBlockIndexWorkerHandler(
				(response: EditorBlockIndexWorkerResponse) => {
					setTimeout(() => {
						const event = { data: response } as MessageEvent<unknown>;
						this.listeners.get("message")?.forEach((listener) => {
							listener(event);
						});
					}, 0);
				},
			);
			handler({ data: message });
		}
		terminate(): void {
			this.listeners.clear();
		}
	}
	const port = createBrowserEditorBlockIndexWorker({
		assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
		location: {
			href: "https://example.test/wp-admin/post.php",
			origin: "https://example.test",
		},
		referenceLabelCaseFoldProfile,
		timeoutMs: 60_000,
		Worker: RoundTripWorker,
		workerUrl:
			"https://example.test/wp-content/plugins/easymde/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js",
	});
	try {
		const data = await port.build(
			{ generation: 1, revision: 1, source },
			new AbortController().signal,
		);
		return { ...data, source } as EditorMarkdownBlockIndex;
	} finally {
		port.dispose();
	}
}
