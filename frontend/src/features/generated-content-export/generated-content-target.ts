import type { EditorMarkdownMathSpan } from "../../contracts/ports/editor-block-index-port";

export type GeneratedContentKind = "math" | "mermaid";

export type GeneratedContentAcceptedPreview = Readonly<{
	revision: number;
	signature: string;
}>;

export type GeneratedContentSourceRange = Readonly<{
	from: number;
	to: number;
}>;

export type GeneratedContentOriginal = Readonly<{
	body: string;
	bodyRange: GeneratedContentSourceRange;
	full: string;
	fullRange: GeneratedContentSourceRange;
}>;

export type GeneratedContentTarget = Readonly<{
	acceptedPreview: GeneratedContentAcceptedPreview;
	blockId: string;
	kind: GeneratedContentKind;
	ordinal: number;
	original: GeneratedContentOriginal;
	sourceRevision: number;
}>;

export type GeneratedContentTargetLease = Readonly<{
	root: Element;
	target: GeneratedContentTarget;
}>;

export type GeneratedContentTargetFailureCode =
	| "generated-content-target-accepted-preview-invalid"
	| "generated-content-target-block-id-invalid"
	| "generated-content-target-kind-invalid"
	| "generated-content-target-math-span-invalid"
	| "generated-content-target-ordinal-invalid"
	| "generated-content-target-ordinal-unavailable"
	| "generated-content-target-original-invalid"
	| "generated-content-target-original-mismatch"
	| "generated-content-target-source-invalid"
	| "generated-content-target-source-revision-invalid";

export type GeneratedContentTargetResult =
	| Readonly<{
			status: "associated";
			target: GeneratedContentTarget;
	  }>
	| Readonly<{
			code: GeneratedContentTargetFailureCode;
			status: "failed";
	  }>;

export type CreateGeneratedContentTargetInput = Readonly<{
	acceptedPreview: GeneratedContentAcceptedPreview;
	blockId: string;
	kind: GeneratedContentKind;
	ordinal: number;
	original: GeneratedContentOriginal;
	source: string;
	sourceRevision: number;
}>;

export type AssociateGeneratedContentTargetInput = Readonly<{
	acceptedPreview: GeneratedContentAcceptedPreview;
	blockId: string;
	kind: GeneratedContentKind;
	mathSpans?: ReadonlyArray<EditorMarkdownMathSpan>;
	ordinal: number;
	original?: GeneratedContentOriginal;
	source: string;
	sourceRevision: number;
}>;

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_BLOCK_ID_LENGTH = 256;
const MAX_PREVIEW_SIGNATURE_LENGTH = 512;

function sourceByteLength(source: string): number {
	let bytes = 0;
	for (let index = 0; index < source.length; index += 1) {
		const codePoint = source.codePointAt(index) ?? 0;
		if (codePoint > 0xffff) index += 1;
		bytes +=
			codePoint <= 0x7f
				? 1
				: codePoint <= 0x7ff
					? 2
					: codePoint <= 0xffff
						? 3
						: 4;
	}
	return bytes;
}

function safeNonNegativeInteger(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

function validSource(source: unknown): source is string {
	return (
		"string" === typeof source && sourceByteLength(source) <= MAX_SOURCE_BYTES
	);
}

function validAcceptedPreview(
	value: unknown,
): value is GeneratedContentAcceptedPreview {
	if (!value || "object" !== typeof value) return false;
	const candidate = value as Record<string, unknown>;
	return (
		safeNonNegativeInteger(candidate.revision) &&
		"string" === typeof candidate.signature &&
		candidate.signature.length > 0 &&
		candidate.signature.length <= MAX_PREVIEW_SIGNATURE_LENGTH
	);
}

function validRange(
	range: unknown,
	source: string,
): range is GeneratedContentSourceRange {
	if (!range || "object" !== typeof range) return false;
	const candidate = range as Record<string, unknown>;
	return (
		safeNonNegativeInteger(candidate.from) &&
		safeNonNegativeInteger(candidate.to) &&
		candidate.from < candidate.to &&
		candidate.to <= source.length
	);
}

function validOriginal(
	original: unknown,
	source: string,
): original is GeneratedContentOriginal {
	if (!original || "object" !== typeof original) return false;
	const candidate = original as Record<string, unknown>;
	if (
		"string" !== typeof candidate.full ||
		"string" !== typeof candidate.body ||
		!validRange(candidate.fullRange, source) ||
		!validRange(candidate.bodyRange, source)
	) {
		return false;
	}
	const fullRange = candidate.fullRange as GeneratedContentSourceRange;
	const bodyRange = candidate.bodyRange as GeneratedContentSourceRange;
	return bodyRange.from >= fullRange.from && bodyRange.to <= fullRange.to;
}

function validKind(value: unknown): value is GeneratedContentKind {
	return "math" === value || "mermaid" === value;
}

function validMathDelimiters(full: string): boolean {
	return (
		(full.startsWith("$$") && full.endsWith("$$") && full.length >= 4) ||
		(full.startsWith("\\[") && full.endsWith("\\]") && full.length >= 4) ||
		(full.startsWith("\\(") && full.endsWith("\\)") && full.length >= 4) ||
		(full.startsWith("$") && full.endsWith("$") && full.length >= 2)
	);
}

function expectedMathBodyRange(
	full: string,
	from: number,
	to: number,
): GeneratedContentSourceRange | null {
	if (full.startsWith("$$") && full.endsWith("$$") && full.length >= 4) {
		return { from: from + 2, to: to - 2 };
	}
	if (full.startsWith("\\[") && full.endsWith("\\]") && full.length >= 4) {
		return { from: from + 2, to: to - 2 };
	}
	if (full.startsWith("\\(") && full.endsWith("\\)") && full.length >= 4) {
		return { from: from + 2, to: to - 2 };
	}
	if (full.startsWith("$") && full.endsWith("$") && full.length >= 2) {
		return { from: from + 1, to: to - 1 };
	}
	return null;
}

function inputFailure(
	input: CreateGeneratedContentTargetInput,
): GeneratedContentTargetFailureCode | null {
	if (!validSource(input.source))
		return "generated-content-target-source-invalid";
	if (!safeNonNegativeInteger(input.sourceRevision)) {
		return "generated-content-target-source-revision-invalid";
	}
	if (!validAcceptedPreview(input.acceptedPreview)) {
		return "generated-content-target-accepted-preview-invalid";
	}
	if (!validKind(input.kind)) return "generated-content-target-kind-invalid";
	if (
		"string" !== typeof input.blockId ||
		input.blockId.length < 1 ||
		input.blockId.length > MAX_BLOCK_ID_LENGTH
	) {
		return "generated-content-target-block-id-invalid";
	}
	if (!safeNonNegativeInteger(input.ordinal)) {
		return "generated-content-target-ordinal-invalid";
	}
	if (!validOriginal(input.original, input.source)) {
		return "generated-content-target-original-invalid";
	}
	const fullRange = input.original.fullRange;
	const bodyRange = input.original.bodyRange;
	if (
		input.source.slice(fullRange.from, fullRange.to) !== input.original.full ||
		input.source.slice(bodyRange.from, bodyRange.to) !== input.original.body
	) {
		return "generated-content-target-original-mismatch";
	}
	if ("math" === input.kind) {
		const expectedBody = expectedMathBodyRange(
			input.original.full,
			fullRange.from,
			fullRange.to,
		);
		if (
			!validMathDelimiters(input.original.full) ||
			!expectedBody ||
			input.original.bodyRange.from !== expectedBody.from ||
			input.original.bodyRange.to !== expectedBody.to
		) {
			return "generated-content-target-original-mismatch";
		}
	}
	return null;
}

export function createGeneratedContentTarget(
	input: CreateGeneratedContentTargetInput,
): GeneratedContentTargetResult {
	const failure = inputFailure(input);
	if (failure) return { code: failure, status: "failed" };
	return {
		status: "associated",
		target: {
			acceptedPreview: input.acceptedPreview,
			blockId: input.blockId,
			kind: input.kind,
			ordinal: input.ordinal,
			original: input.original,
			sourceRevision: input.sourceRevision,
		},
	};
}

export function associateGeneratedContentTarget(
	input: AssociateGeneratedContentTargetInput,
): GeneratedContentTargetResult {
	if ("math" !== input.kind) {
		if (!input.original) {
			return {
				code: "generated-content-target-original-invalid",
				status: "failed",
			};
		}
		return createGeneratedContentTarget({
			acceptedPreview: input.acceptedPreview,
			blockId: input.blockId,
			kind: input.kind,
			ordinal: input.ordinal,
			original: input.original,
			source: input.source,
			sourceRevision: input.sourceRevision,
		});
	}

	if (!safeNonNegativeInteger(input.ordinal)) {
		return {
			code: "generated-content-target-ordinal-invalid",
			status: "failed",
		};
	}
	const span = input.mathSpans?.[input.ordinal];
	if (!span) {
		return {
			code: "generated-content-target-ordinal-unavailable",
			status: "failed",
		};
	}
	if (
		!safeNonNegativeInteger(span.from) ||
		!safeNonNegativeInteger(span.to) ||
		!safeNonNegativeInteger(span.bodyFrom) ||
		!safeNonNegativeInteger(span.bodyTo) ||
		"boolean" !== typeof span.displayMode ||
		span.from >= span.to ||
		span.bodyFrom < span.from ||
		span.bodyTo > span.to ||
		span.bodyFrom > span.bodyTo ||
		span.to > input.source.length
	) {
		return {
			code: "generated-content-target-math-span-invalid",
			status: "failed",
		};
	}
	const full = input.source.slice(span.from, span.to);
	const expectedBody = expectedMathBodyRange(full, span.from, span.to);
	const displayDelimiter = full.startsWith("$$") || full.startsWith("\\[");
	if (
		!expectedBody ||
		displayDelimiter !== span.displayMode ||
		span.bodyFrom !== expectedBody.from ||
		span.bodyTo !== expectedBody.to
	) {
		return {
			code: "generated-content-target-math-span-invalid",
			status: "failed",
		};
	}
	const original: GeneratedContentOriginal = {
		body: input.source.slice(span.bodyFrom, span.bodyTo),
		bodyRange: { from: span.bodyFrom, to: span.bodyTo },
		full,
		fullRange: { from: span.from, to: span.to },
	};
	return createGeneratedContentTarget({
		acceptedPreview: input.acceptedPreview,
		blockId: input.blockId,
		kind: input.kind,
		ordinal: input.ordinal,
		original,
		source: input.source,
		sourceRevision: input.sourceRevision,
	});
}

export function generatedContentTargetMatchesIdentity(
	target: GeneratedContentTarget,
	identity: Readonly<{
		acceptedPreview: GeneratedContentAcceptedPreview;
		sourceRevision: number;
	}>,
): boolean {
	return (
		target.sourceRevision === identity.sourceRevision &&
		target.acceptedPreview.revision === identity.acceptedPreview.revision &&
		target.acceptedPreview.signature === identity.acceptedPreview.signature
	);
}
