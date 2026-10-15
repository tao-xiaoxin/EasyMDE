import type {
	PreparedPreviewMarkup,
	PreviewCodeBodyKind,
	PreviewCodeBodyMap,
	PreviewCodeBodyMapEntry,
	PreviewCodeProjection,
	PreviewCodeProjectionEntry,
	PreviewCodeProjectionRow,
	PreviewEditMap,
	PreviewEditMapBlock,
	PreviewRequest,
	PreviewRequestPort,
	PreviewResponse,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import {
	isPreviewFeatureKey,
	MAX_PREVIEW_CODE_MAP_CONTENT_BYTES as MAX_CODE_MAP_CONTENT_BYTES,
	MAX_PREVIEW_CODE_MAP_ENTRIES as MAX_CODE_MAP_ENTRIES,
	MAX_PREVIEW_CODE_PROJECTION_BYTES as MAX_CODE_PROJECTION_BYTES,
	MAX_PREVIEW_CODE_PROJECTION_ENTRIES as MAX_CODE_PROJECTION_ENTRIES,
	MAX_PREVIEW_CODE_PROJECTION_INFO_BYTES as MAX_CODE_PROJECTION_INFO_BYTES,
	MAX_PREVIEW_CODE_PROJECTION_ROWS as MAX_CODE_PROJECTION_ROWS,
	MAX_PREVIEW_EDIT_MAP_BLOCKS as MAX_EDIT_MAP_BLOCKS,
} from "../../../contracts/ports/preview-request";
import { wordpressEndpoint } from "../shared/wordpress-endpoint";

export type WordPressApiFetch = (
	options: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export class PreviewResponseError extends Error {
	public constructor() {
		super("preview-response-invalid");
		this.name = "PreviewResponseError";
	}
}

const VISUAL_BLOCK_ATTRIBUTE = "data-easymde-visual-block-id";
const PROTOTYPE_RESERVED_KEYS = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

type UnknownRecord = Record<string, unknown>;

function invalidResponse(): never {
	throw new PreviewResponseError();
}

function isSafeRecord(value: unknown): value is UnknownRecord {
	if (!value || "object" !== typeof value || Array.isArray(value)) {
		return false;
	}

	try {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return false;
		}
		return Object.keys(value).every((key) => !PROTOTYPE_RESERVED_KEYS.has(key));
	} catch {
		return false;
	}
}

function hasOwn(record: UnknownRecord, key: string): boolean {
	return undefined !== Object.getOwnPropertyDescriptor(record, key);
}

function hasUnexpectedKey(
	record: UnknownRecord,
	allowed: ReadonlyArray<string>,
): boolean {
	return Object.keys(record).some((key) => !allowed.includes(key));
}

function lineCount(markdown: string): number {
	let count = 1;
	for (let index = 0; index < markdown.length; index += 1) {
		const character = markdown[index];
		if ("\r" === character) {
			count += 1;
			if ("\n" === markdown[index + 1]) index += 1;
		} else if ("\n" === character) {
			count += 1;
		}
	}
	return count;
}

function parseFeatures(value: unknown): Record<string, boolean> {
	if (!isSafeRecord(value)) invalidResponse();

	const features: Record<string, boolean> = {};
	for (const [key, enabled] of Object.entries(value)) {
		if (!isPreviewFeatureKey(key) || "boolean" !== typeof enabled) {
			invalidResponse();
		}
		features[key] = enabled;
	}
	return features;
}

function prepareTopLevelBlockMarkup(
	html: string,
	blocks: ReadonlyArray<PreviewEditMapBlock>,
): PreparedPreviewMarkup {
	const Parser = globalThis.DOMParser;
	if ("function" !== typeof Parser) invalidResponse();

	let parsed: Document;
	try {
		parsed = new Parser().parseFromString(html, "text/html");
	} catch {
		invalidResponse();
	}

	const topLevelElements = Array.from(parsed.body.children);
	if (topLevelElements.length !== blocks.length) invalidResponse();

	for (let index = 0; index < topLevelElements.length; index += 1) {
		const element = topLevelElements[index];
		const block = blocks[index];
		if (
			!element ||
			!block ||
			element.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id
		) {
			invalidResponse();
		}
	}

	for (const child of Array.from(parsed.body.childNodes)) {
		if (3 === child.nodeType && (child.textContent ?? "").trim()) {
			invalidResponse();
		}
	}
	return { sourceNodes: Array.from(parsed.body.childNodes) };
}

function parseEditMap(
	value: unknown,
	markdown: string,
	html: string,
	signature: string,
): Readonly<{
	editMap: PreviewEditMap;
	preparedMarkup: PreparedPreviewMarkup;
}> {
	if (!isSafeRecord(value)) invalidResponse();

	if (
		value.version !== 1 ||
		value.coordinate !== "line" ||
		hasOwn(value, "signature") ||
		!Array.isArray(value.blocks) ||
		value.blocks.length > MAX_EDIT_MAP_BLOCKS
	) {
		invalidResponse();
	}

	const maximumLine = lineCount(markdown);
	const blocks: PreviewEditMapBlock[] = [];
	const ids = new Set<string>();
	let previous: PreviewEditMapBlock | undefined;

	for (let index = 0; index < value.blocks.length; index += 1) {
		const rawBlock = value.blocks[index];
		if (!isSafeRecord(rawBlock)) invalidResponse();

		const id = rawBlock.id;
		const startLine = rawBlock.startLine;
		const endLine = rawBlock.endLine;
		const editable = rawBlock.editable;
		if (
			"string" !== typeof id ||
			!/^b\d+$/.test(id) ||
			ids.has(id) ||
			"number" !== typeof startLine ||
			"number" !== typeof endLine ||
			!Number.isSafeInteger(startLine) ||
			!Number.isSafeInteger(endLine) ||
			startLine < 0 ||
			endLine < startLine ||
			endLine > maximumLine ||
			startLine > maximumLine ||
			"boolean" !== typeof editable ||
			(editable && endLine <= startLine)
		) {
			invalidResponse();
		}

		const block: PreviewEditMapBlock = {
			id,
			startLine,
			endLine,
			editable,
		};
		if (previous && block.startLine < previous.startLine) invalidResponse();
		if (previous && block.startLine < previous.endLine) invalidResponse();
		ids.add(id);
		blocks.push(block);
		previous = block;
	}

	const preparedMarkup = prepareTopLevelBlockMarkup(html, blocks);
	return {
		editMap: {
			version: 1,
			coordinate: "line",
			signature,
			blocks,
		},
		preparedMarkup,
	};
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function parseCodeBodyKind(value: unknown): PreviewCodeBodyKind {
	if ("fenced" !== value && "indented" !== value) invalidResponse();
	return value;
}

function parseCodeMap(
	value: unknown,
	markdown: string,
	signature: string,
): PreviewCodeBodyMap {
	if (undefined === value) {
		return {
			code: "preview-code-body-unavailable",
			coordinate: "line",
			signature,
			status: "unavailable",
			version: 1,
		};
	}
	if (!isSafeRecord(value)) invalidResponse();
	if (
		value.version !== 1 ||
		value.coordinate !== "line" ||
		hasOwn(value, "signature") ||
		("available" === value.status
			? hasUnexpectedKey(value, ["coordinate", "entries", "status", "version"])
			: hasUnexpectedKey(value, ["code", "coordinate", "status", "version"])) ||
		"string" !== typeof signature ||
		("available" !== value.status && "unavailable" !== value.status)
	) {
		invalidResponse();
	}
	if ("unavailable" === value.status) {
		if (value.code !== "preview-code-body-limit" || hasOwn(value, "entries")) {
			invalidResponse();
		}
		return {
			code: "preview-code-body-limit",
			coordinate: "line",
			signature,
			status: "unavailable",
			version: 1,
		};
	}
	if (
		!Array.isArray(value.entries) ||
		value.entries.length > MAX_CODE_MAP_ENTRIES
	) {
		invalidResponse();
	}

	const maximumLine = lineCount(markdown);
	const entries: PreviewCodeBodyMapEntry[] = [];
	let previous: PreviewCodeBodyMapEntry | undefined;
	let contentBytes = 0;
	for (const rawEntry of value.entries) {
		if (!isSafeRecord(rawEntry)) invalidResponse();
		const kind = parseCodeBodyKind(rawEntry.kind);
		const startLine = rawEntry.startLine;
		const endLine = rawEntry.endLine;
		if (
			"number" !== typeof startLine ||
			"number" !== typeof endLine ||
			!Number.isSafeInteger(startLine) ||
			!Number.isSafeInteger(endLine) ||
			startLine < 0 ||
			endLine <= startLine ||
			endLine > maximumLine ||
			("available" !== rawEntry.status && "unavailable" !== rawEntry.status)
		) {
			invalidResponse();
		}
		if (
			previous &&
			(startLine < previous.endLine || startLine < previous.startLine)
		) {
			invalidResponse();
		}
		if ("available" === rawEntry.status) {
			if ("string" !== typeof rawEntry.content || hasOwn(rawEntry, "code")) {
				invalidResponse();
			}
			if (
				hasUnexpectedKey(rawEntry, [
					"content",
					"endLine",
					"kind",
					"startLine",
					"status",
				])
			)
				invalidResponse();
			contentBytes += utf8ByteLength(rawEntry.content);
			if (contentBytes > MAX_CODE_MAP_CONTENT_BYTES) invalidResponse();
			const entry: PreviewCodeBodyMapEntry = {
				content: rawEntry.content,
				endLine,
				kind,
				startLine,
				status: "available",
			};
			entries.push(entry);
			previous = entry;
			continue;
		}
		if (
			rawEntry.code !== "preview-code-body-source-unavailable" ||
			hasOwn(rawEntry, "content") ||
			hasUnexpectedKey(rawEntry, [
				"code",
				"endLine",
				"kind",
				"startLine",
				"status",
			])
		) {
			invalidResponse();
		}
		const entry: PreviewCodeBodyMapEntry = {
			code: "preview-code-body-source-unavailable",
			endLine,
			kind,
			startLine,
			status: "unavailable",
		};
		entries.push(entry);
		previous = entry;
	}

	return {
		coordinate: "line",
		entries,
		signature,
		status: "available",
		version: 1,
	};
}

function unavailableCodeProjection(
	signature: string,
	code:
		| "preview-code-projection-limit"
		| "preview-code-projection-unavailable" = "preview-code-projection-unavailable",
): PreviewCodeProjection {
	return {
		code,
		coordinate: "line",
		offsetUnit: "utf16",
		signature,
		status: "unavailable",
		version: 1,
	};
}

function splitProjectionSourceRows(source: string): string[] {
	const rows: string[] = [];
	let start = 0;
	for (let index = 0; index < source.length; index += 1) {
		if ("\r" !== source[index] && "\n" !== source[index]) continue;
		rows.push(source.slice(start, index));
		if ("\r" === source[index] && "\n" === source[index + 1]) index += 1;
		start = index + 1;
	}
	rows.push(source.slice(start));
	return rows;
}

function splitProjectionContentRows(content: string): string[] {
	const rows = splitProjectionSourceRows(content);
	if (/(?:\r\n|\r|\n)$/u.test(content)) rows.pop();
	return rows;
}

function utf16Boundary(value: string, position: number): boolean {
	if (position <= 0 || position >= value.length) return true;
	const previous = value.charCodeAt(position - 1);
	const current = value.charCodeAt(position);
	return !(
		previous >= 0xd800 &&
		previous <= 0xdbff &&
		current >= 0xdc00 &&
		current <= 0xdfff
	);
}

function safeInteger(value: unknown): number | undefined {
	return "number" === typeof value && Number.isSafeInteger(value)
		? value
		: undefined;
}

function leadingAsciiWhitespaceLength(value: string): number {
	let count = 0;
	while (" " === value[count] || "\t" === value[count]) count += 1;
	return count;
}

function projectionRowsValid(
	rows: ReadonlyArray<PreviewCodeProjectionRow>,
	entry: PreviewCodeBodyMapEntry,
	markdownRows: ReadonlyArray<string>,
): boolean {
	if ("available" !== entry.status) return false;
	const contentRows = splitProjectionContentRows(entry.content);
	const seenContent = new Set<number>();
	const seenSource = new Set<number>();
	let previousContent = -1;
	let previousSource = -1;
	for (const row of rows) {
		if (
			!Number.isSafeInteger(row.sourceLine) ||
			!Number.isSafeInteger(row.contentLine) ||
			!Number.isSafeInteger(row.prefixEnd) ||
			!Number.isSafeInteger(row.prefixTabColumns) ||
			!Number.isSafeInteger(row.literalFrom) ||
			!Number.isSafeInteger(row.literalLeadingSpaces) ||
			row.sourceLine < entry.startLine ||
			row.sourceLine >= entry.endLine ||
			row.contentLine < 0 ||
			row.contentLine >= contentRows.length ||
			row.contentLine <= previousContent ||
			row.sourceLine <= previousSource ||
			row.prefixTabColumns < 0 ||
			row.prefixTabColumns > 3 ||
			row.prefixEnd < 0 ||
			row.literalFrom < 0 ||
			row.literalLeadingSpaces < 0 ||
			row.literalLeadingSpaces > 3 ||
			seenContent.has(row.contentLine) ||
			seenSource.has(row.sourceLine)
		) {
			return false;
		}
		const sourceRow = markdownRows[row.sourceLine];
		if (undefined === sourceRow) return false;
		const oldLeading = leadingAsciiWhitespaceLength(
			contentRows[row.contentLine] ?? "",
		);
		const rawNonWspFrom =
			row.literalFrom + oldLeading - row.literalLeadingSpaces;
		if (
			row.prefixEnd > row.literalFrom ||
			row.literalFrom > sourceRow.length ||
			rawNonWspFrom < row.literalFrom ||
			rawNonWspFrom > sourceRow.length ||
			!utf16Boundary(sourceRow, row.prefixEnd) ||
			!utf16Boundary(sourceRow, row.literalFrom) ||
			!/^[ \t]*$/u.test(sourceRow.slice(row.prefixEnd, row.literalFrom)) ||
			(row.prefixTabColumns > 0 && "\t" !== sourceRow[row.prefixEnd]) ||
			(row.literalLeadingSpaces > 0 &&
				"\t" !== sourceRow[row.literalFrom - 1]) ||
			!/^[ \t]*$/u.test(sourceRow.slice(row.literalFrom, rawNonWspFrom))
		) {
			return false;
		}
		const literal =
			" ".repeat(row.literalLeadingSpaces) + sourceRow.slice(row.literalFrom);
		const contentRow = contentRows[row.contentLine];
		if (
			undefined === contentRow ||
			literal !== contentRow ||
			/^[ \t]*$/u.test(literal)
		) {
			return false;
		}
		seenContent.add(row.contentLine);
		seenSource.add(row.sourceLine);
		previousContent = row.contentLine;
		previousSource = row.sourceLine;
	}
	for (let index = 0; index < contentRows.length; index += 1) {
		if (
			!/^[ \t]*$/u.test(contentRows[index] ?? "") &&
			!seenContent.has(index)
		) {
			return false;
		}
	}
	return true;
}

function parseProjectionRows(
	value: ReadonlyArray<unknown>,
	entry: PreviewCodeBodyMapEntry,
	markdownRows: ReadonlyArray<string>,
): ReadonlyArray<PreviewCodeProjectionRow> | undefined {
	const rows: PreviewCodeProjectionRow[] = [];
	for (const rawRow of value) {
		if (
			!isSafeRecord(rawRow) ||
			hasUnexpectedKey(rawRow, [
				"contentLine",
				"literalFrom",
				"literalLeadingSpaces",
				"prefixEnd",
				"prefixTabColumns",
				"sourceLine",
			])
		) {
			return undefined;
		}
		const contentLine = safeInteger(rawRow.contentLine);
		const literalFrom = safeInteger(rawRow.literalFrom);
		const literalLeadingSpaces = safeInteger(rawRow.literalLeadingSpaces);
		const prefixEnd = safeInteger(rawRow.prefixEnd);
		const prefixTabColumns = safeInteger(rawRow.prefixTabColumns);
		const sourceLine = safeInteger(rawRow.sourceLine);
		if (
			undefined === contentLine ||
			undefined === literalFrom ||
			undefined === literalLeadingSpaces ||
			undefined === prefixEnd ||
			undefined === prefixTabColumns ||
			undefined === sourceLine
		) {
			return undefined;
		}
		rows.push({
			contentLine,
			literalFrom,
			literalLeadingSpaces,
			prefixEnd,
			prefixTabColumns,
			sourceLine,
		});
	}
	return projectionRowsValid(rows, entry, markdownRows) ? rows : undefined;
}

function parseCodeProjection(
	value: unknown,
	markdown: string,
	signature: string,
	codeMap: PreviewCodeBodyMap,
): PreviewCodeProjection {
	if (undefined === value) return unavailableCodeProjection(signature);
	if (!isSafeRecord(value)) return unavailableCodeProjection(signature);
	if ("unavailable" === value.status) {
		if (
			value.version !== 1 ||
			value.coordinate !== "line" ||
			value.offsetUnit !== "utf16" ||
			hasUnexpectedKey(value, [
				"code",
				"coordinate",
				"offsetUnit",
				"status",
				"version",
			])
		) {
			return unavailableCodeProjection(signature);
		}
		return value.code === "preview-code-projection-limit"
			? unavailableCodeProjection(signature, "preview-code-projection-limit")
			: unavailableCodeProjection(signature);
	}
	if (
		value.version !== 1 ||
		value.coordinate !== "line" ||
		value.offsetUnit !== "utf16" ||
		value.status !== "available" ||
		hasUnexpectedKey(value, [
			"coordinate",
			"entries",
			"offsetUnit",
			"status",
			"version",
		]) ||
		!Array.isArray(value.entries) ||
		"available" !== codeMap.status
	) {
		return unavailableCodeProjection(signature);
	}
	if (value.entries.length > MAX_CODE_PROJECTION_ENTRIES) {
		return unavailableCodeProjection(
			signature,
			"preview-code-projection-limit",
		);
	}
	let encodedBytes: number;
	try {
		encodedBytes = utf8ByteLength(JSON.stringify(value));
	} catch {
		return unavailableCodeProjection(signature);
	}
	if (encodedBytes > MAX_CODE_PROJECTION_BYTES) {
		return unavailableCodeProjection(
			signature,
			"preview-code-projection-limit",
		);
	}
	const markdownRows = splitProjectionSourceRows(markdown);
	const maximumLine = markdownRows.length;
	const entries: PreviewCodeProjectionEntry[] = [];
	const seenRanges = new Set<string>();
	let previousEnd = 0;
	let rowCount = 0;
	for (const rawEntry of value.entries) {
		if (!isSafeRecord(rawEntry)) return unavailableCodeProjection(signature);
		const kind = rawEntry.kind;
		const startLineValue = rawEntry.startLine;
		const endLineValue = rawEntry.endLine;
		if (
			("fenced" !== kind && "indented" !== kind) ||
			!Number.isSafeInteger(startLineValue) ||
			!Number.isSafeInteger(endLineValue) ||
			(startLineValue as number) < previousEnd ||
			(endLineValue as number) <= (startLineValue as number) ||
			(endLineValue as number) > maximumLine ||
			seenRanges.has(`${kind}:${startLineValue}:${endLineValue}`)
		) {
			return unavailableCodeProjection(signature);
		}
		const startLine = startLineValue as number;
		const endLine = endLineValue as number;
		seenRanges.add(`${kind}:${startLine}:${endLine}`);
		const mapMatches = codeMap.entries.filter(
			(entry) =>
				entry.kind === kind &&
				entry.startLine === startLine &&
				entry.endLine === endLine,
		);
		if (1 !== mapMatches.length) return unavailableCodeProjection(signature);
		const mapEntry = mapMatches[0];
		if (!mapEntry) return unavailableCodeProjection(signature);
		if ("unavailable" === rawEntry.status) {
			if (
				rawEntry.code !== "preview-code-projection-source-unavailable" &&
				rawEntry.code !== "preview-code-projection-info-limit"
			) {
				return unavailableCodeProjection(signature);
			}
			if (
				hasUnexpectedKey(rawEntry, [
					"code",
					"endLine",
					"kind",
					"startLine",
					"status",
				])
			) {
				return unavailableCodeProjection(signature);
			}
			entries.push({
				code: rawEntry.code,
				endLine,
				kind,
				startLine,
				status: "unavailable",
			});
			previousEnd = endLine;
			continue;
		}
		if ("available" !== mapEntry.status) {
			return unavailableCodeProjection(signature);
		}
		if ("available" !== rawEntry.status || !Array.isArray(rawEntry.rows)) {
			return unavailableCodeProjection(signature);
		}
		if (rawEntry.rows.length > MAX_CODE_PROJECTION_ROWS) {
			return unavailableCodeProjection(
				signature,
				"preview-code-projection-limit",
			);
		}
		const infoValue = rawEntry.info;
		const fenceOffsetValue = rawEntry.fenceOffset;
		let info: string | undefined;
		let fenceOffset: number | undefined;
		if ("fenced" === kind) {
			if (
				"string" !== typeof infoValue ||
				!Number.isSafeInteger(fenceOffsetValue) ||
				(fenceOffsetValue as number) < 0 ||
				(fenceOffsetValue as number) > 3 ||
				utf8ByteLength(infoValue) > MAX_CODE_PROJECTION_INFO_BYTES ||
				hasUnexpectedKey(rawEntry, [
					"endLine",
					"fenceOffset",
					"info",
					"kind",
					"rows",
					"startLine",
					"status",
				])
			) {
				return unavailableCodeProjection(signature);
			}
			info = infoValue;
			fenceOffset = fenceOffsetValue as number;
		} else if (
			hasUnexpectedKey(rawEntry, [
				"endLine",
				"kind",
				"rows",
				"startLine",
				"status",
			])
		) {
			return unavailableCodeProjection(signature);
		}
		const rows = parseProjectionRows(rawEntry.rows, mapEntry, markdownRows);
		if (!rows) return unavailableCodeProjection(signature);
		rowCount += rows.length;
		if (rowCount > MAX_CODE_PROJECTION_ROWS) {
			return unavailableCodeProjection(
				signature,
				"preview-code-projection-limit",
			);
		}
		entries.push(
			"fenced" === kind
				? {
						endLine,
						fenceOffset: fenceOffset as number,
						info: info as string,
						kind,
						rows,
						startLine,
						status: "available",
					}
				: { endLine, kind, rows, startLine, status: "available" },
		);
		previousEnd = endLine;
	}
	return {
		coordinate: "line",
		entries,
		offsetUnit: "utf16",
		signature,
		status: "available",
		version: 1,
	};
}

function parseResponse(
	value: unknown,
	request: PreviewRequest,
): PreviewResponse {
	try {
		if (!isSafeRecord(value)) invalidResponse();

		if (
			!hasOwn(value, "html") ||
			!hasOwn(value, "features") ||
			!hasOwn(value, "editMap") ||
			"string" !== typeof value.html ||
			"string" !== typeof request.signature ||
			"string" !== typeof request.markdown
		) {
			invalidResponse();
		}

		const features = parseFeatures(value.features);
		const { editMap, preparedMarkup } = parseEditMap(
			value.editMap,
			request.markdown,
			value.html,
			request.signature,
		);
		const codeMap = parseCodeMap(
			value.codeMap,
			request.markdown,
			request.signature,
		);
		const codeProjection = parseCodeProjection(
			value.codeProjection,
			request.markdown,
			request.signature,
			codeMap,
		);

		// The protected Preview route returns only PHP-rendered, server-sanitized HTML.
		return {
			codeMap,
			codeProjection,
			html: value.html as SafePreviewHtml,
			features,
			editMap,
			preparedMarkup,
		};
	} catch (error) {
		if (error instanceof PreviewResponseError) throw error;
		throw new PreviewResponseError();
	}
}

export function createWordPressPreviewPort(
	apiFetch: WordPressApiFetch,
	restUrl: string,
	nonce: string,
	siteUrl: string,
): PreviewRequestPort {
	if ("function" !== typeof apiFetch || !restUrl || !nonce) {
		throw new Error("preview-transport-unavailable");
	}
	const endpoint = wordpressEndpoint(
		restUrl,
		siteUrl,
		"preview-url-invalid",
	).toString();

	return {
		async render(
			request: PreviewRequest,
			signal: AbortSignal,
		): Promise<PreviewResponse> {
			const response = await apiFetch({
				url: endpoint,
				method: "POST",
				headers: { "X-WP-Nonce": nonce },
				data: {
					markdown: request.markdown,
					post_id: request.postId,
					markdown_theme: request.markdownTheme,
					code_theme: request.codeTheme,
					custom_css_id: request.customCssId,
				},
				signal,
			});

			return parseResponse(response, request);
		},
	};
}
