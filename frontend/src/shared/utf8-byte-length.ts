/**
 * Canonical UTF-8 byte limit for Markdown Preview and source-bound editor
 * operations, matching PHP `PreviewController::MAX_MARKDOWN_BYTES` (1 MiB).
 */
export const MAX_MARKDOWN_PREVIEW_BYTES = 1_048_576;

/**
 * Counts UTF-8 encoded bytes for `text.slice(start, end)` without allocating a
 * substring or intermediate `Uint8Array`. Matches `TextEncoder` for ASCII,
 * multi-byte BMP characters, valid surrogate pairs, and unpaired surrogates.
 */
export function utf8ByteLength(
	text: string,
	start = 0,
	end = text.length,
): number {
	const from = Math.max(0, Math.min(text.length, start));
	const to = Math.max(from, Math.min(text.length, end));
	let bytes = 0;
	for (let index = from; index < to; index += 1) {
		const codeUnit = text.charCodeAt(index);
		if (codeUnit < 0x80) {
			bytes += 1;
		} else if (codeUnit < 0x800) {
			bytes += 2;
		} else if (
			codeUnit >= 0xd800 &&
			codeUnit <= 0xdbff &&
			index + 1 < to
		) {
			const nextUnit = text.charCodeAt(index + 1);
			if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) {
				bytes += 4;
				index += 1;
			} else {
				bytes += 3;
			}
		} else {
			bytes += 3;
		}
	}
	return bytes;
}
