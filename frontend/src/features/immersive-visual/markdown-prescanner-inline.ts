import type { ProtectedInlineKind } from "./visual-schema";

export type ProtectedInlineEntry = Readonly<{
	kind: ProtectedInlineKind;
	rawMarkdown: string;
}>;

/** Feature-private inline protected-syntax scanner for the prescanner. */
function isEscapedAt(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
		slashes += 1;
	}
	return slashes % 2 === 1;
}

export function extractInlineProtectedSyntax(
	line: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
): string {
	let result = "";
	let index = 0;
	const length = line.length;

	const allocateToken = (
		kind: ProtectedInlineKind,
		rawMarkdown: string,
	): string => {
		const token = `${sentinel}INL${protectedInlines.size}END`;
		protectedInlines.set(token, { kind, rawMarkdown });
		return token;
	};

	while (index < length) {
		const ch = line[index] ?? "";

		// Preserve inline code spans verbatim so math/footnotes inside backticks
		// stay literal and never allocate sentinels.
		if (ch === "`" && !isEscapedAt(line, index)) {
			let tickEnd = index;
			while (tickEnd < length && line[tickEnd] === "`") {
				tickEnd += 1;
			}
			const tickLen = tickEnd - index;
			const delimiter = "`".repeat(tickLen);
			let searchFrom = tickEnd;
			let closePos = -1;
			while (searchFrom < length) {
				const found = line.indexOf(delimiter, searchFrom);
				if (found < 0) {
					break;
				}
				const beforeIsTick = found > 0 && line[found - 1] === "`";
				const afterIsTick =
					found + tickLen < length && line[found + tickLen] === "`";
				if (!beforeIsTick && !afterIsTick) {
					closePos = found;
					break;
				}
				searchFrom = found + 1;
			}
			if (closePos >= 0) {
				result += line.slice(index, closePos + tickLen);
				index = closePos + tickLen;
				continue;
			}
			result += delimiter;
			index = tickEnd;
			continue;
		}

		// Link/image destinations and titles are never inline-protected here;
		// sentinels inside `(...)` would leak into ProseMirror attributes.
		if (ch === "]" && line[index + 1] === "(" && !isEscapedAt(line, index)) {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < length && depth > 0) {
				const cur = line[cursor] ?? "";
				if (cur === "\\") {
					cursor += 2;
					continue;
				}
				if (cur === "(") {
					depth += 1;
				} else if (cur === ")") {
					depth -= 1;
				}
				cursor += 1;
			}
			if (depth === 0) {
				result += line.slice(index, cursor);
				index = cursor;
				continue;
			}
		}

		// GFM table cells: a literal `<br>` is a visual hard break, while an
		// escaped `\<br\>` stays literal text (matching TableCellBreakParser).
		if (isTableRow && ch === "<" && !isEscapedAt(line, index)) {
			const brMatch = /^<br[ \t]*\/?>/i.exec(line.slice(index));
			if (brMatch) {
				result += `${sentinel}BREND`;
				index += brMatch[0].length;
				continue;
			}
		}

		// Inline LaTeX math: \(...\)
		if (ch === "\\" && line[index + 1] === "(" && !isEscapedAt(line, index)) {
			let closePos = -1;
			for (let j = index + 2; j < length - 1; j += 1) {
				if (line[j] === "\\" && line[j + 1] === ")" && !isEscapedAt(line, j)) {
					closePos = j;
					break;
				}
			}
			if (closePos > index + 2) {
				result += allocateToken("math-inline", line.slice(index, closePos + 2));
				index = closePos + 2;
				continue;
			}
		}

		// Inline LaTeX math: \[...\]
		if (ch === "\\" && line[index + 1] === "[" && !isEscapedAt(line, index)) {
			let closePos = -1;
			for (let j = index + 2; j < length - 1; j += 1) {
				if (line[j] === "\\" && line[j + 1] === "]" && !isEscapedAt(line, j)) {
					closePos = j;
					break;
				}
			}
			if (closePos > index + 2) {
				result += allocateToken("math-inline", line.slice(index, closePos + 2));
				index = closePos + 2;
				continue;
			}
		}

		if (ch === "$" && !isEscapedAt(line, index)) {
			// Mid-line display math `$$...$$` stays one protected atom, while an
			// empty `$$$$` and an unclosed `$$` never start a single-dollar scan.
			if (line[index + 1] === "$") {
				const closeDisplay = line.indexOf("$$", index + 2);
				if (closeDisplay > index + 2) {
					result += allocateToken(
						"math-inline",
						line.slice(index, closeDisplay + 2),
					);
					index = closeDisplay + 2;
					continue;
				}
				result += "$$";
				index += 2;
				continue;
			}
			const openFollow = line[index + 1] ?? "";
			if (openFollow.length > 0 && !/\s/.test(openFollow)) {
				let closePos = -1;
				for (let j = index + 1; j < length; j += 1) {
					const cur = line[j] ?? "";
					if (isTableRow && cur === "|" && !isEscapedAt(line, j)) {
						break;
					}
					if (cur !== "$" || isEscapedAt(line, j)) {
						continue;
					}
					if (line[j + 1] === "$") {
						break;
					}
					const before = line[j - 1] ?? "";
					const after = line[j + 1] ?? "";
					if (/\s/.test(before) || /[0-9]/.test(after)) {
						break;
					}
					closePos = j;
					break;
				}
				if (closePos > index + 1) {
					result += allocateToken(
						"math-inline",
						line.slice(index, closePos + 1),
					);
					index = closePos + 1;
					continue;
				}
			}
		}

		// Footnote reference: [^label]
		if (ch === "[" && line[index + 1] === "^" && !isEscapedAt(line, index)) {
			const rest = line.slice(index);
			const match = /^\[\^([^\s\]]+)\]/.exec(rest);
			if (match) {
				const afterChar = rest[match[0].length];
				if (afterChar !== ":" && afterChar !== "(" && afterChar !== "[") {
					result += allocateToken("footnote-ref", match[0]);
					index += match[0].length;
					continue;
				}
			}
		}

		// Inline HTML comment: <!-- ... -->
		if (ch === "<" && line.startsWith("<!--", index)) {
			const closeComment = line.indexOf("-->", index + 4);
			if (closeComment >= 0) {
				result += allocateToken(
					"raw-inline",
					line.slice(index, closeComment + 3),
				);
				index = closeComment + 3;
				continue;
			}
		}

		result += ch;
		index += 1;
	}

	return result;
}
