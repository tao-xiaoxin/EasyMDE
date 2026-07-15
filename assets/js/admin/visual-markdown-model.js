(function (window) {
    'use strict';

    var SAFE_URL_PROTOCOL = /^(?:https?:|mailto:|tel:)/i;
    var UNSAFE_URL_PROTOCOL = /^(?:javascript:|data:|vbscript:)/i;

    function scanLines(source) {
        var lines = [];
        var position = 0;
        var lineEnd;
        var ending;

        while (position < source.length) {
            lineEnd = position;
            while (lineEnd < source.length && source.charAt(lineEnd) !== '\n' && source.charAt(lineEnd) !== '\r') {
                lineEnd += 1;
            }
            ending = '';
            if (source.slice(lineEnd, lineEnd + 2) === '\r\n') {
                ending = '\r\n';
            } else if (source.charAt(lineEnd) === '\n' || source.charAt(lineEnd) === '\r') {
                ending = source.charAt(lineEnd);
            }
            lines.push({
                start: position,
                contentEnd: lineEnd,
                end: lineEnd + ending.length,
                content: source.slice(position, lineEnd),
                ending: ending
            });
            position = lineEnd + ending.length;
        }

        return lines;
    }

    function firstLineEnding(source) {
        var match = String(source || '').match(/\r\n|\r|\n/);
        return match ? match[0] : '\n';
    }

    function stripOneLineEnding(raw) {
        return String(raw || '').replace(/(?:\r\n|\r|\n)$/, '');
    }

    function trailingLineEnding(raw) {
        var match = String(raw || '').match(/(\r\n|\r|\n)$/);
        return match ? match[1] : '';
    }

    function isBlank(line) {
        return !line || /^[\t ]*$/.test(line.content);
    }

    function isSafeUrl(url) {
        var normalized = String(url || '').trim();

        if (!normalized || UNSAFE_URL_PROTOCOL.test(normalized)) {
            return false;
        }
        if (/^(?:#|\/|\.\/|\.\.\/)/.test(normalized)) {
            return true;
        }
        return SAFE_URL_PROTOCOL.test(normalized);
    }

    function isWordLikeCharacter(character) {
        return !!character && !/[\t\n\r !"#$%&'()*+,\-./:;<=>?@[\\\]^`{|}~]/.test(character);
    }

    function isIntrawordUnderscore(value, match, start, end) {
        var delimiter = match[1] || '';

        if (delimiter.charAt(0) !== '_') {
            return false;
        }
        return (
            isWordLikeCharacter(value.charAt(start - 1))
            && isWordLikeCharacter(value.charAt(start + delimiter.length))
        ) || (
            isWordLikeCharacter(value.charAt(end - delimiter.length - 1))
            && isWordLikeCharacter(value.charAt(end))
        );
    }

    function findInlineCandidate(value, offset) {
        var patterns = [
            { type: 'code', regex: /(`+)([^\n]*?)\1/g },
            { type: 'link', regex: /\[([^\]\n]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g },
            { type: 'strong', regex: /(\*\*|__)([^\n]+?)\1/g },
            { type: 'strike', regex: /~~([^\n]+?)~~/g },
            { type: 'emphasis', regex: /(\*|_)([^*_\n]+?)\1/g }
        ];
        var candidate = null;

        patterns.forEach(function (pattern) {
            var match;
            pattern.regex.lastIndex = offset;
            match = pattern.regex.exec(value);
            while (
                match
                && (pattern.type === 'strong' || pattern.type === 'emphasis')
                && isIntrawordUnderscore(value, match, match.index, pattern.regex.lastIndex)
            ) {
                match = pattern.regex.exec(value);
            }
            if (!match || (candidate && match.index >= candidate.index)) {
                return;
            }
            candidate = {
                index: match.index,
                end: pattern.regex.lastIndex,
                match: match,
                type: pattern.type
            };
        });

        return candidate;
    }

    function parseAtxHeading(value) {
        var match = String(value || '').match(/^ {0,3}(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/);
        var text;

        if (!match) {
            return null;
        }
        text = typeof match[2] === 'string' ? match[2] : '';
        text = text.replace(/[\t ]+#+[\t ]*$/, '').replace(/[\t ]+$/, '');
        return {
            level: match[1].length,
            text: text
        };
    }

    function normalizeCodeSpanValue(value) {
        var normalized = String(value || '');
        if (/^ .* $/.test(normalized) && !/^ +$/.test(normalized)) {
            return normalized.slice(1, -1);
        }
        return normalized;
    }

    function serializeCodeSpan(value) {
        var content = String(value || '');
        var runs = content.match(/`+/g) || [];
        var fenceLength = runs.reduce(function (length, run) {
            return Math.max(length, run.length + 1);
        }, 1);
        var fence = new Array(fenceLength + 1).join('`');
        var needsPadding = /^`|`$/.test(content)
            || (/^ .* $/.test(content) && !/^ +$/.test(content));
        var padding = needsPadding ? ' ' : '';
        return fence + padding + content + padding + fence;
    }

    function parseInline(value) {
        var source = String(value || '');
        var tokens = [];
        var offset = 0;
        var candidate;
        var match;
        var href;

        while (offset < source.length) {
            candidate = findInlineCandidate(source, offset);
            if (!candidate) {
                tokens.push({ type: 'text', value: source.slice(offset) });
                break;
            }
            if (candidate.index > offset) {
                tokens.push({ type: 'text', value: source.slice(offset, candidate.index) });
            }
            match = candidate.match;
            if (candidate.type === 'code') {
                tokens.push({ type: 'code', value: normalizeCodeSpanValue(match[2]) });
            } else if (candidate.type === 'link') {
                href = match[2];
                if (!isSafeUrl(href)) {
                    tokens.push({ type: 'text', value: match[0] });
                } else {
                    tokens.push({
                        type: 'link',
                        href: href,
                        title: match[3] || '',
                        children: parseInline(match[1])
                    });
                }
            } else if (candidate.type === 'strong') {
                tokens.push({ type: 'strong', children: parseInline(match[2]) });
            } else if (candidate.type === 'strike') {
                tokens.push({ type: 'strike', children: parseInline(match[1]) });
            } else {
                tokens.push({ type: 'emphasis', children: parseInline(match[2]) });
            }
            offset = candidate.end;
        }

        return tokens;
    }

    function serializeInline(tokens) {
        return (tokens || []).map(function (token) {
            if (!token || typeof token.type !== 'string') {
                throw new Error('Invalid visual Markdown inline token.');
            }
            if (token.type === 'text') {
                return token.literal
                    ? String(token.value || '').replace(/([\\*_~`\[\]<>])/g, '\\$1')
                    : String(token.value || '');
            }
            if (token.type === 'code') {
                return serializeCodeSpan(token.value);
            }
            if (token.type === 'strong') {
                return '**' + serializeInline(token.children) + '**';
            }
            if (token.type === 'emphasis') {
                return '*' + serializeInline(token.children) + '*';
            }
            if (token.type === 'strike') {
                return '~~' + serializeInline(token.children) + '~~';
            }
            if (token.type === 'link') {
                if (!isSafeUrl(token.href)) {
                    throw new Error('Unsafe visual Markdown link URL.');
                }
                return '[' + serializeInline(token.children) + '](' + String(token.href) + (
                    token.title ? ' "' + String(token.title).replace(/"/g, '\\"') + '"' : ''
                ) + ')';
            }
            throw new Error('Unsupported visual Markdown inline token: ' + token.type);
        }).join('');
    }

    function hasUnsupportedInlineSyntax(value) {
        var source = String(value || '');
        var sourceWithoutCode = source.replace(/(`+)([^\n]*?)\1/g, function (match) {
            return match.replace(/./g, ' ');
        });
        var inlineTokens = parseInline(source);

        function tokenIsUnsupported(token) {
            if (token.type === 'text') {
                return /<[^>\r\n]+>/.test(token.value)
                    || /\[[^\]\r\n]+\]/.test(token.value)
                    || /\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(token.value);
            }
            return (token.children || []).some(tokenIsUnsupported);
        }

        function hasNestedEmphasis(token, parentType) {
            var emphasisTypes = ['strong', 'emphasis'];
            if (emphasisTypes.indexOf(parentType) !== -1 && emphasisTypes.indexOf(token.type) !== -1) {
                return true;
            }
            return (token.children || []).some(function (child) {
                return hasNestedEmphasis(child, token.type);
            });
        }

        function hasDelimiterTextNextToEmphasis(tokens) {
            return (tokens || []).some(function (token, index) {
                var previous = tokens[index - 1];
                var next = tokens[index + 1];
                var emphasisTypes = ['strong', 'emphasis'];
                if (
                    token.type === 'text'
                    && /[*_]/.test(token.value)
                    && (
                        (previous && emphasisTypes.indexOf(previous.type) !== -1)
                        || (next && emphasisTypes.indexOf(next.type) !== -1)
                    )
                ) {
                    return true;
                }
                return token.children && hasDelimiterTextNextToEmphasis(token.children);
            });
        }

        return hasInlineMath(source)
            || isFenceStart(source)
            || /^\s*\$\$\s*$/.test(source)
            || /\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(sourceWithoutCode)
            || /\*{3,}|_{3,}/.test(sourceWithoutCode)
            || inlineTokens.some(tokenIsUnsupported)
            || inlineTokens.some(function (token) {
                return hasNestedEmphasis(token, '');
            })
            || hasDelimiterTextNextToEmphasis(inlineTokens);
    }

    function isFenceStart(content) {
        return String(content || '').match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
    }

    function isFenceClose(content, marker, length) {
        var match = String(content || '').match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
        return !!match && match[1].charAt(0) === marker && match[1].length >= length;
    }

    function listMatch(content) {
        return String(content || '').match(/^(\s*)([-+*]|\d{1,9}[.)])([\t ]+)(?:\[([ xX])\]([\t ]+))?(.*)$/);
    }

    function isHorizontalRule(content) {
        return /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/.test(String(content || ''));
    }

    function isSetextDelimiter(content) {
        return /^ {0,3}(?:=+|-+)[\t ]*$/.test(String(content || ''));
    }

    function isIndentedCode(content) {
        return /^(?: {4}|\t)/.test(String(content || ''));
    }

    function isTableDelimiter(content) {
        return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(String(content || ''));
    }

    function hasInlineMath(content) {
        return /(^|[^\\$])\$(?!\$)(?:\\.|[^$\n])+\$/.test(String(content || ''));
    }

    function startsKnownBlock(lines, index) {
        var content = lines[index] ? lines[index].content : '';
        var next = lines[index + 1] ? lines[index + 1].content : '';

        return isBlank(lines[index])
            || !!isFenceStart(content)
            || /^ {0,3}#{1,6}(?:[\t ]+|$)/.test(content)
            || isHorizontalRule(content)
            || !!listMatch(content)
            || /^ {0,3}>/.test(content)
            || /^\s*\$\$\s*$/.test(content)
            || /^\s*\[TOC\]\s*$/i.test(content)
            || /^ {0,3}:::[\w-]*/.test(content)
            || /^\s*</.test(content)
            || isIndentedCode(content)
            || isSetextDelimiter(next)
            || isTableDelimiter(next);
    }

    function protectedTypeForParagraph(raw) {
        if (/!\[[^\]]*\]\([^)]+\)/.test(raw)) {
            return 'image';
        }
        if (hasInlineMath(raw)) {
            return 'inlineMath';
        }
        if (hasUnsupportedInlineSyntax(raw)) {
            return 'unknown';
        }
        return '';
    }

    function createNode(documentState, type, start, end, fields) {
        var occurrence = documentState.typeCounts[type] || 0;
        var node = fields || {};

        documentState.typeCounts[type] = occurrence + 1;
        node.id = type + '-' + occurrence;
        node.type = type;
        node.start = start;
        node.end = end;
        node.raw = documentState.source.slice(start, end);
        node.dirty = false;
        return node;
    }

    function pushGap(documentState, lines, startIndex, endIndex) {
        documentState.nodes.push(createNode(
            documentState,
            'gap',
            lines[startIndex].start,
            lines[endIndex - 1].end,
            { editable: false }
        ));
    }

    function parseFence(documentState, lines, index, opening) {
        var marker = opening[1].charAt(0);
        var length = opening[1].length;
        var language = opening[2].trim();
        var closeIndex = index + 1;
        var bodyStart = lines[index].end;
        var bodyEnd;
        var type;
        var node;

        while (closeIndex < lines.length && !isFenceClose(lines[closeIndex].content, marker, length)) {
            closeIndex += 1;
        }
        if (closeIndex >= lines.length) {
            closeIndex = lines.length - 1;
            type = 'protected';
            node = createNode(documentState, type, lines[index].start, lines[closeIndex].end, {
                editable: false,
                protectedType: language.toLowerCase() === 'mermaid' ? 'mermaid' : 'unknown'
            });
            documentState.nodes.push(node);
            return closeIndex + 1;
        }
        if (language.toLowerCase() === 'mermaid') {
            documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[closeIndex].end, {
                editable: false,
                protectedType: 'mermaid'
            }));
            return closeIndex + 1;
        }
        bodyEnd = lines[closeIndex].start;
        node = createNode(documentState, 'code', lines[index].start, lines[closeIndex].end, {
            editable: true,
            fenceMarker: marker,
            fenceLength: length,
            language: language,
            content: stripOneLineEnding(documentState.source.slice(bodyStart, bodyEnd))
        });
        documentState.nodes.push(node);
        return closeIndex + 1;
    }

    function parseList(documentState, lines, index) {
        var endIndex = index;
        var items = [];
        var unsupported = false;
        var match;
        var indent;

        while (endIndex < lines.length && !isBlank(lines[endIndex])) {
            match = listMatch(lines[endIndex].content);
            if (!match) {
                break;
            }
            indent = match[1].replace(/\t/g, '    ').length;
            unsupported = unsupported || hasUnsupportedInlineSyntax(match[6]);
            items.push({
                depth: indent ? Math.max(1, Math.ceil(indent / 4)) : 0,
                indent: match[1],
                ordered: /^\d/.test(match[2]),
                marker: match[2],
                markerSpacing: match[3],
                task: typeof match[4] === 'string',
                taskMarker: match[4] || '',
                taskSpacing: match[5] || '',
                checked: typeof match[4] === 'string' && match[4].toLowerCase() === 'x',
                inline: parseInline(match[6])
            });
            endIndex += 1;
        }
        if (unsupported) {
            documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[endIndex - 1].end, {
                editable: false,
                protectedType: 'unknown'
            }));
            return endIndex;
        }
        documentState.nodes.push(createNode(documentState, 'list', lines[index].start, lines[endIndex - 1].end, {
            editable: true,
            items: items
        }));
        return endIndex;
    }

    function parseBlockquote(documentState, lines, index) {
        var endIndex = index;
        var quoteLines = [];
        var unsupported = false;
        var content;

        while (endIndex < lines.length && /^ {0,3}>/.test(lines[endIndex].content)) {
            content = lines[endIndex].content.replace(/^ {0,3}>[\t ]?/, '');
            unsupported = unsupported || hasUnsupportedInlineSyntax(content);
            quoteLines.push({ inline: parseInline(content), blank: !content });
            endIndex += 1;
        }
        if (unsupported) {
            documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[endIndex - 1].end, {
                editable: false,
                protectedType: 'unknown'
            }));
            return endIndex;
        }
        documentState.nodes.push(createNode(documentState, 'blockquote', lines[index].start, lines[endIndex - 1].end, {
            editable: true,
            lines: quoteLines
        }));
        return endIndex;
    }

    function parseProtectedDelimited(documentState, lines, index, type, closingPattern) {
        var endIndex = index + 1;

        while (endIndex < lines.length && !closingPattern.test(lines[endIndex].content)) {
            endIndex += 1;
        }
        if (endIndex < lines.length) {
            endIndex += 1;
        }
        documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[endIndex - 1].end, {
            editable: false,
            protectedType: type
        }));
        return endIndex;
    }

    function parseParagraph(documentState, lines, index) {
        var endIndex = index + 1;
        var raw;
        var body;
        var protectedType;

        while (endIndex < lines.length && !startsKnownBlock(lines, endIndex)) {
            endIndex += 1;
        }
        raw = documentState.source.slice(lines[index].start, lines[endIndex - 1].end);
        body = stripOneLineEnding(raw);
        protectedType = protectedTypeForParagraph(body);
        documentState.nodes.push(createNode(documentState, protectedType ? 'protected' : 'paragraph', lines[index].start, lines[endIndex - 1].end, protectedType ? {
            editable: false,
            protectedType: protectedType
        } : {
            editable: true,
            inline: parseInline(body)
        }));
        return endIndex;
    }

    function rebuildHeadings(documentState) {
        var textCounts = {};
        var headings = [];

        documentState.nodes.forEach(function (node) {
            var text;
            var key;
            var occurrence;
            if (node.type !== 'heading') {
                return;
            }
            text = serializeInline(node.inline).replace(/\s+/g, ' ').trim();
            key = text.toLocaleLowerCase();
            occurrence = textCounts[key] || 0;
            textCounts[key] = occurrence + 1;
            headings.push({
                id: 'heading-' + headings.length,
                nodeId: node.id,
                level: node.level,
                text: text,
                occurrence: occurrence
            });
        });
        documentState.headings = headings;
        return documentState;
    }

    function parse(markdown) {
        var source = String(markdown || '');
        var lines = scanLines(source);
        var documentState = {
            source: source,
            lineEnding: firstLineEnding(source),
            nodes: [],
            headings: [],
            typeCounts: {},
            dirty: false
        };
        var index = 0;
        var endIndex;
        var content;
        var opening;
        var heading;
        var raw;
        var unsupportedInline;

        while (index < lines.length) {
            content = lines[index].content;
            if (isBlank(lines[index])) {
                endIndex = index + 1;
                while (endIndex < lines.length && isBlank(lines[endIndex])) {
                    endIndex += 1;
                }
                pushGap(documentState, lines, index, endIndex);
                index = endIndex;
                continue;
            }
            opening = isFenceStart(content);
            if (opening) {
                index = parseFence(documentState, lines, index, opening);
                continue;
            }
            if (/^\s*\$\$\s*$/.test(content)) {
                index = parseProtectedDelimited(documentState, lines, index, 'math', /^\s*\$\$\s*$/);
                continue;
            }
            if (/^ {0,3}:::[\w-]*/.test(content)) {
                index = parseProtectedDelimited(documentState, lines, index, 'unknown', /^ {0,3}:::[\t ]*$/);
                continue;
            }
            if (/^\s*\[TOC\]\s*$/i.test(content)) {
                documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[index].end, {
                    editable: false,
                    protectedType: 'toc'
                }));
                index += 1;
                continue;
            }
            if (lines[index + 1] && content.trim() && isSetextDelimiter(lines[index + 1].content)) {
                documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[index + 1].end, {
                    editable: false,
                    protectedType: 'unknown'
                }));
                index += 2;
                continue;
            }
            if (isIndentedCode(content)) {
                endIndex = index + 1;
                while (endIndex < lines.length) {
                    if (isIndentedCode(lines[endIndex].content)) {
                        endIndex += 1;
                        continue;
                    }
                    if (
                        isBlank(lines[endIndex])
                        && lines[endIndex + 1]
                        && isIndentedCode(lines[endIndex + 1].content)
                    ) {
                        endIndex += 1;
                        continue;
                    }
                    break;
                }
                documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[endIndex - 1].end, {
                    editable: false,
                    protectedType: 'unknown'
                }));
                index = endIndex;
                continue;
            }
            if (lines[index + 1] && isTableDelimiter(lines[index + 1].content)) {
                endIndex = index + 2;
                while (endIndex < lines.length && !isBlank(lines[endIndex]) && /\|/.test(lines[endIndex].content)) {
                    endIndex += 1;
                }
                documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[endIndex - 1].end, {
                    editable: false,
                    protectedType: 'table'
                }));
                index = endIndex;
                continue;
            }
            if (/^\s*</.test(content)) {
                endIndex = index + 1;
                while (endIndex < lines.length && !isBlank(lines[endIndex])) {
                    endIndex += 1;
                }
                documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[endIndex - 1].end, {
                    editable: false,
                    protectedType: 'unknown'
                }));
                index = endIndex;
                continue;
            }
            heading = parseAtxHeading(content);
            if (heading) {
                unsupportedInline = hasUnsupportedInlineSyntax(heading.text);
                documentState.nodes.push(createNode(
                    documentState,
                    unsupportedInline ? 'protected' : 'heading',
                    lines[index].start,
                    lines[index].end,
                    unsupportedInline ? {
                        editable: false,
                        protectedType: 'unknown'
                    } : {
                        editable: true,
                        level: heading.level,
                        inline: parseInline(heading.text)
                    }
                ));
                index += 1;
                continue;
            }
            if (isHorizontalRule(content)) {
                documentState.nodes.push(createNode(documentState, 'horizontalRule', lines[index].start, lines[index].end, {
                    editable: true
                }));
                index += 1;
                continue;
            }
            if (listMatch(content)) {
                index = parseList(documentState, lines, index);
                continue;
            }
            if (/^ {0,3}>/.test(content)) {
                index = parseBlockquote(documentState, lines, index);
                continue;
            }
            raw = stripOneLineEnding(documentState.source.slice(lines[index].start, lines[index].end));
            if (/!\[[^\]]*\]\([^)]+\)/.test(raw)) {
                documentState.nodes.push(createNode(documentState, 'protected', lines[index].start, lines[index].end, {
                    editable: false,
                    protectedType: 'image'
                }));
                index += 1;
                continue;
            }
            index = parseParagraph(documentState, lines, index);
        }

        if (/^[\t\r\n ]*$/.test(source)) {
            documentState.nodes.push(createNode(documentState, 'paragraph', source.length, source.length, {
                editable: true,
                inline: [],
                synthetic: true
            }));
        } else if (/(?:\r\n|\r|\n)[\t ]*(?:\r\n|\r|\n)$/.test(source)) {
            documentState.nodes.push(createNode(documentState, 'paragraph', source.length, source.length, {
                editable: true,
                inline: [],
                synthetic: true
            }));
        }

        delete documentState.typeCounts;
        return rebuildHeadings(documentState);
    }

    function cloneInline(tokens) {
        return (tokens || []).map(function (token) {
            var clone = Object.assign({}, token);
            if (token.children) {
                clone.children = cloneInline(token.children);
            }
            return clone;
        });
    }

    function cloneNode(node) {
        var clone = Object.assign({}, node);
        if (node.inline) {
            clone.inline = cloneInline(node.inline);
        }
        if (node.lines) {
            clone.lines = node.lines.map(function (line) {
                return { blank: !!line.blank, inline: cloneInline(line.inline) };
            });
        }
        if (node.items) {
            clone.items = node.items.map(function (item) {
                return Object.assign({}, item, { inline: cloneInline(item.inline) });
            });
        }
        return clone;
    }

    function updateNode(documentState, nodeId, changes) {
        var found = false;
        var updated = {
            source: documentState.source,
            lineEnding: documentState.lineEnding,
            nodes: documentState.nodes.map(function (node) {
                var clone = cloneNode(node);
                if (node.id !== nodeId) {
                    return clone;
                }
                found = true;
                if (!node.editable || node.type === 'protected' || node.type === 'gap') {
                    throw new Error('Protected visual Markdown nodes cannot be edited.');
                }
                Object.keys(changes || {}).forEach(function (key) {
                    if (['id', 'type', 'raw', 'start', 'end', 'editable', 'protectedType'].indexOf(key) !== -1) {
                        throw new Error('Immutable visual Markdown node field: ' + key);
                    }
                    clone[key] = changes[key];
                });
                clone.dirty = true;
                return clone;
            }),
            headings: [],
            dirty: true
        };

        if (!found) {
            throw new Error('Visual Markdown node not found: ' + nodeId);
        }
        return synchronizeDocumentSource(updated);
    }

    function replaceNodeSource(documentState, nodeId, replacement) {
        var current = serialize(documentState);
        var currentDocument = parse(current);
        var node = currentDocument.nodes.find(function (candidate) {
            return candidate.id === nodeId;
        });

        if (!node) {
            throw new Error('Visual Markdown node not found: ' + nodeId);
        }
        if (!node.editable || node.type === 'protected' || node.type === 'gap') {
            throw new Error('Protected visual Markdown nodes cannot be replaced.');
        }
        return parse(current.slice(0, node.start) + String(replacement || '') + current.slice(node.end));
    }

    function serializeList(node, lineEnding) {
        return node.items.map(function (item) {
            var indent = typeof item.indent === 'string'
                ? item.indent
                : new Array(Math.max(0, Number(item.depth) || 0) + 1).join('  ');
            var marker = String(item.marker || '');
            var markerSpacing = typeof item.markerSpacing === 'string' ? item.markerSpacing : ' ';
            var taskSpacing = typeof item.taskSpacing === 'string' ? item.taskSpacing : ' ';
            var taskMarker = String(item.taskMarker || '');
            var task = item.task
                ? '[' + (item.checked && taskMarker === 'X' ? 'X' : (item.checked ? 'x' : ' ')) + ']' + taskSpacing
                : '';
            if (
                (item.ordered && !/^\d{1,9}[.)]$/.test(marker))
                || (!item.ordered && !/^[-+*]$/.test(marker))
            ) {
                throw new Error('Invalid visual Markdown list marker.');
            }
            if (!/^[\t ]*$/.test(indent) || !/^[\t ]+$/.test(markerSpacing) || (item.task && !/^[\t ]+$/.test(taskSpacing))) {
                throw new Error('Invalid visual Markdown list spacing.');
            }
            return indent + marker + markerSpacing + task + serializeInline(item.inline);
        }).join(lineEnding);
    }

    function serializeNode(node, lineEnding) {
        var body;
        var marker;
        var fenceLength;
        var language;

        if (!node.dirty) {
            return node.raw;
        }
        if (node.type === 'paragraph') {
            body = serializeInline(node.inline);
        } else if (node.type === 'heading') {
            if (!Number.isInteger(node.level) || node.level < 1 || node.level > 6) {
                throw new Error('Visual Markdown heading level must be between 1 and 6.');
            }
            body = new Array(node.level + 1).join('#') + ' ' + serializeInline(node.inline);
        } else if (node.type === 'horizontalRule') {
            body = '---';
        } else if (node.type === 'code') {
            language = String(node.language || '');
            if (/[\r\n]/.test(language)) {
                throw new Error('Visual Markdown code language must not contain line breaks.');
            }
            marker = node.fenceMarker === '~' ? '~' : '`';
            if (marker === '`' && language.indexOf('`') !== -1) {
                marker = '~';
            }
            fenceLength = Math.max(3, Number(node.fenceLength) || 3);
            while (String(node.content || '').indexOf(new Array(fenceLength + 1).join(marker)) !== -1) {
                fenceLength += 1;
            }
            marker = new Array(fenceLength + 1).join(marker);
            body = marker + language + lineEnding
                + String(node.content || '') + lineEnding + marker;
        } else if (node.type === 'list') {
            body = serializeList(node, lineEnding);
        } else if (node.type === 'blockquote') {
            body = node.lines.map(function (line) {
                return line.blank ? '>' : '> ' + serializeInline(line.inline);
            }).join(lineEnding);
        } else {
            throw new Error('Unsupported dirty visual Markdown node: ' + node.type);
        }
        return body + trailingLineEnding(node.raw);
    }

    function synchronizeDocumentSource(documentState) {
        var lineEnding = documentState.lineEnding || '\n';
        var source = '';

        documentState.nodes.forEach(function (node) {
            var raw = serializeNode(node, lineEnding);
            node.start = source.length;
            source += raw;
            node.end = source.length;
            node.raw = raw;
            node.dirty = false;
        });
        documentState.source = source;
        documentState.dirty = false;
        return rebuildHeadings(documentState);
    }

    function serialize(documentState) {
        if (!documentState || !Array.isArray(documentState.nodes)) {
            throw new Error('Invalid visual Markdown document.');
        }
        if (!documentState.dirty) {
            return String(documentState.source || '');
        }
        return documentState.nodes.map(function (node) {
            return serializeNode(node, documentState.lineEnding || '\n');
        }).join('');
    }

    window.EasyMDEVisualMarkdownModel = {
        isSafeUrl: isSafeUrl,
        parse: parse,
        parseInline: parseInline,
        replaceNodeSource: replaceNodeSource,
        serialize: serialize,
        serializeInline: serializeInline,
        updateNode: updateNode
    };
}(window));
