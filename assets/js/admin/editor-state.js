(function (window) {
    'use strict';

    function detectMacPlatform() {
        var platform = window.navigator && (window.navigator.userAgentData && window.navigator.userAgentData.platform
            ? window.navigator.userAgentData.platform
            : window.navigator.platform);

        return typeof platform === 'string' && platform.toLowerCase().indexOf('mac') !== -1;
    }

    function findById(items, id) {
        var found = null;

        (items || []).some(function (item) {
            if (item.id === id) {
                found = item;
                return true;
            }

            return false;
        });

        return found;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function focusWithoutScrolling(element) {
        if (!element || typeof element.focus !== 'function') {
            return;
        }

        try {
            element.focus({ preventScroll: true });
        } catch (error) {
            element.focus();
        }
    }

    function restoreScrollPosition(target, top, left) {
        if (!target) {
            return;
        }

        if (typeof top === 'number') {
            target.scrollTop = top;
        }

        if (typeof left === 'number') {
            target.scrollLeft = left;
        }
    }

    function replaceClassPrefix(element, prefix, className) {
        var classes = (element.className || '').split(/\s+/).filter(function (name) {
            return name && name.indexOf(prefix) !== 0;
        });

        classes.push(className);
        element.className = classes.join(' ');
    }

    function normalizeMarkdownLines(markdown) {
        return String(markdown || '').replace(/\r\n?/g, '\n');
    }

    function countCodePoints(value, ignoreLineBreaks) {
        var total = 0;
        var index;
        var codePoint;

        value = String(value || '');

        for (index = 0; index < value.length; index += 1) {
            codePoint = value.codePointAt(index);

            if (ignoreLineBreaks && 10 === codePoint) {
                if (codePoint > 0xffff) {
                    index += 1;
                }
                continue;
            }

            total += 1;

            if (codePoint > 0xffff) {
                index += 1;
            }
        }

        return total;
    }

    function isCjkCodePoint(codePoint) {
        return (
            (codePoint >= 0x1100 && codePoint <= 0x11ff)
            || (codePoint >= 0x3040 && codePoint <= 0x30ff)
            || (codePoint >= 0x3130 && codePoint <= 0x318f)
            || (codePoint >= 0x31f0 && codePoint <= 0x31ff)
            || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
            || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
            || (codePoint >= 0xac00 && codePoint <= 0xd7af)
            || (codePoint >= 0xf900 && codePoint <= 0xfaff)
            || (codePoint >= 0x20000 && codePoint <= 0x2ebef)
        );
    }

    function countCjkCharacters(value) {
        var total = 0;
        var index;
        var codePoint;

        value = String(value || '');

        for (index = 0; index < value.length; index += 1) {
            codePoint = value.codePointAt(index);

            if (isCjkCodePoint(codePoint)) {
                total += 1;
            }

            if (codePoint > 0xffff) {
                index += 1;
            }
        }

        return total;
    }

    function countWesternWords(value) {
        var matches = String(value || '').match(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g);

        return matches ? matches.length : 0;
    }

    function estimateReadingMinutes(westernWords, cjkCharacters) {
        var minutes = (westernWords / 200) + (cjkCharacters / 300);

        if (minutes <= 0) {
            return 0;
        }

        return Math.max(1, Math.ceil(minutes));
    }

    function calculateWordStatistics(markdown) {
        var normalized = normalizeMarkdownLines(markdown);
        var totalCharacters = countCodePoints(normalized, true);
        var westernWords = countWesternWords(normalized);
        var cjkCharacters = countCjkCharacters(normalized);

        return {
            normalizedMarkdown: normalized,
            lineCount: '' === normalized ? 0 : normalized.split('\n').length,
            westernWords: westernWords,
            cjkCharacters: cjkCharacters,
            totalCharacters: totalCharacters,
            readingMinutes: estimateReadingMinutes(westernWords, cjkCharacters)
        };
    }

    function stripUrlDecoration(url) {
        return String(url || '').trim().replace(/^<|>$/g, '');
    }

    function isLikelyImageUrl(url) {
        return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(String(url || ''));
    }

    function isLocalImageCandidateUrl(url, siteOrigin) {
        var normalized = stripUrlDecoration(url);
        var parsed;
        var currentOrigin;

        if (!normalized || /^data:/i.test(normalized) || /^javascript:/i.test(normalized)) {
            return false;
        }

        if (!isLikelyImageUrl(normalized)) {
            return false;
        }

        if (/^(?:https?:)?\/\//i.test(normalized)) {
            if (!siteOrigin) {
                return false;
            }

            try {
                parsed = new URL(normalized, siteOrigin);
                currentOrigin = new URL(siteOrigin).origin;
            } catch (error) {
                return false;
            }

            return parsed.origin === currentOrigin;
        }

        return '/' === normalized.charAt(0) || !/^[a-z][a-z0-9+.-]*:/i.test(normalized);
    }

    function extractMarkdownImageReferences(markdown) {
        var normalized = normalizeMarkdownLines(markdown);
        var lines = normalized.split('\n');
        var references = [];
        var inFence = false;
        var fenceMarker = '';
        var fenceLength = 0;
        var offset = 0;
        var index;
        var line;
        var fenceMatch;
        var regex;
        var match;
        var htmlRegex;
        var htmlMatch;

        for (index = 0; index < lines.length; index += 1) {
            line = lines[index];

            if (inFence) {
                fenceMatch = String(line).match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
                if (
                    fenceMatch
                    && fenceMatch[1].charAt(0) === fenceMarker
                    && fenceMatch[1].length >= fenceLength
                ) {
                    inFence = false;
                    fenceMarker = '';
                    fenceLength = 0;
                }

                offset += line.length + 1;
                continue;
            }

            fenceMatch = String(line).match(/^ {0,3}(`{3,}|~{3,})([^\n\r]*)$/);
            if (fenceMatch) {
                inFence = true;
                fenceMarker = fenceMatch[1].charAt(0);
                fenceLength = fenceMatch[1].length;
                offset += line.length + 1;
                continue;
            }

            if (isIndentedCodeLine(line)) {
                offset += line.length + 1;
                continue;
            }

            regex = /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
            while ((match = regex.exec(line))) {
                references.push({
                    alt: match[1].trim(),
                    offset: offset + match.index,
                    url: stripUrlDecoration(String(match[2]).replace(/\s+"[^"]*"$/, ''))
                });
            }

            htmlRegex = /<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
            while ((htmlMatch = htmlRegex.exec(line))) {
                references.push({
                    alt: '',
                    offset: offset + htmlMatch.index,
                    url: stripUrlDecoration(htmlMatch[1] || htmlMatch[2] || '')
                });
            }

            offset += line.length + 1;
        }

        return references;
    }

    function findFirstLocalImageCandidate(markdown, siteOrigin) {
        var references = extractMarkdownImageReferences(markdown);
        var index;

        for (index = 0; index < references.length; index += 1) {
            if (isLocalImageCandidateUrl(references[index].url, siteOrigin)) {
                return references[index];
            }
        }

        return null;
    }

    function normalizeTagList(value) {
        var seen = Object.create(null);
        var tokens;

        if (Array.isArray(value)) {
            tokens = value;
        } else {
            tokens = String(value || '').split(',');
        }

        return tokens.reduce(function (result, token) {
            var normalized = String(token || '').trim();
            var key;

            if (!normalized) {
                return result;
            }

            key = normalized.toLocaleLowerCase();
            if (seen[key]) {
                return result;
            }

            seen[key] = true;
            result.push(normalized);

            return result;
        }, []);
    }

    function serializeTagList(tags) {
        return normalizeTagList(tags).join(', ');
    }

    function derivePublishPanelMode(postStatus) {
        var status = String(postStatus || '').toLowerCase();

        if ('publish' === status || 'future' === status || 'private' === status) {
            return 'update';
        }

        return 'publish';
    }

    function normalizeCategoryIds(values) {
        var seen = Object.create(null);

        return (Array.isArray(values) ? values : [values]).reduce(function (result, value) {
            var normalized = String(value === null || value === undefined ? '' : value).trim();

            if (!normalized || seen[normalized]) {
                return result;
            }

            seen[normalized] = true;
            result.push(normalized);
            return result;
        }, []);
    }

    function createPublishPanelDraft(options) {
        options = options || {};

        return {
            categories: normalizeCategoryIds(options.categories || []),
            excerpt: String(options.excerpt || ''),
            featuredImageCandidate: options.featuredImageCandidate || null,
            featuredImageMode: String(options.featuredImageMode || (options.featuredImageCandidate ? 'candidate' : 'keep')),
            mode: derivePublishPanelMode(options.postStatus || ''),
            publishAfterPreview: !!options.publishAfterPreview,
            tags: normalizeTagList(options.tags || [])
        };
    }

    function parseFeaturedImageId(value) {
        var normalized = parseInt(String(value === null || value === undefined ? '' : value).trim(), 10);

        return isFinite(normalized) && normalized > 0 ? normalized : 0;
    }

    function createNativePublishFieldState(options) {
        options = options || {};

        return {
            categories: normalizeCategoryIds(options.categories || []),
            excerpt: String(options.excerpt || ''),
            featuredImageId: parseFeaturedImageId(options.featuredImageId),
            postStatus: String(options.postStatus || ''),
            tags: normalizeTagList(options.tags || [])
        };
    }

    function applyPublishPanelDraftToNativeState(nativeState, draft) {
        nativeState = createNativePublishFieldState(nativeState || {});
        draft = createPublishPanelDraft(draft || {});

        return {
            categories: draft.categories,
            excerpt: draft.excerpt,
            featuredImageId: 'clear' === draft.featuredImageMode
                ? 0
                : (
                    'candidate' === draft.featuredImageMode
                    && draft.featuredImageCandidate
                    && draft.featuredImageCandidate.id
                        ? parseFeaturedImageId(draft.featuredImageCandidate.id)
                        : nativeState.featuredImageId
                ),
            postStatus: nativeState.postStatus,
            tags: draft.tags,
            tagString: serializeTagList(draft.tags)
        };
    }

    function isIndentedCodeLine(line) {
        return /^( {4}|\t)/.test(String(line || ''));
    }

    function extractOutlineHeadings(markdown) {
        var normalized = normalizeMarkdownLines(markdown);
        var lines = normalized.split('\n');
        var headings = [];
        var inFence = false;
        var fenceMarker = '';
        var fenceLength = 0;
        var offset = 0;
        var index;
        var line;
        var nextLine;
        var fenceMatch;
        var atxMatch;
        var setextMatch;

        for (index = 0; index < lines.length; index += 1) {
            line = lines[index];

            if (inFence) {
                fenceMatch = String(line).match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
                if (
                    fenceMatch
                    && fenceMatch[1].charAt(0) === fenceMarker
                    && fenceMatch[1].length >= fenceLength
                ) {
                    inFence = false;
                    fenceMarker = '';
                    fenceLength = 0;
                }

                offset += line.length + 1;
                continue;
            }

            fenceMatch = String(line).match(/^ {0,3}(`{3,}|~{3,})([^\n\r]*)$/);
            if (fenceMatch) {
                inFence = true;
                fenceMarker = fenceMatch[1].charAt(0);
                fenceLength = fenceMatch[1].length;
                offset += line.length + 1;
                continue;
            }

            if (isIndentedCodeLine(line)) {
                offset += line.length + 1;
                continue;
            }

            atxMatch = String(line).match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/);
            if (atxMatch && atxMatch[2].trim()) {
                headings.push({
                    level: atxMatch[1].length,
                    offset: offset,
                    text: atxMatch[2].trim().replace(/\s+/g, ' ')
                });
                offset += line.length + 1;
                continue;
            }

            nextLine = index + 1 < lines.length ? lines[index + 1] : '';
            setextMatch = String(nextLine).match(/^ {0,3}(=+|-+)[ \t]*$/);
            if (
                setextMatch
                && String(line).trim()
                && !isIndentedCodeLine(nextLine)
            ) {
                headings.push({
                    level: setextMatch[1].charAt(0) === '=' ? 1 : 2,
                    offset: offset,
                    text: String(line).trim().replace(/\s+/g, ' ')
                });
            }

            offset += line.length + 1;
        }

        return headings;
    }

    window.EasyMDEEditorState = {
        detectMacPlatform: detectMacPlatform,
        applyPublishPanelDraftToNativeState: applyPublishPanelDraftToNativeState,
        createPublishPanelDraft: createPublishPanelDraft,
        createNativePublishFieldState: createNativePublishFieldState,
        derivePublishPanelMode: derivePublishPanelMode,
        findById: findById,
        extractMarkdownImageReferences: extractMarkdownImageReferences,
        extractOutlineHeadings: extractOutlineHeadings,
        findFirstLocalImageCandidate: findFirstLocalImageCandidate,
        calculateWordStatistics: calculateWordStatistics,
        isLocalImageCandidateUrl: isLocalImageCandidateUrl,
        normalizeCategoryIds: normalizeCategoryIds,
        normalizeTagList: normalizeTagList,
        parseFeaturedImageId: parseFeaturedImageId,
        serializeTagList: serializeTagList,
        escapeHtml: escapeHtml,
        focusWithoutScrolling: focusWithoutScrolling,
        normalizeMarkdownLines: normalizeMarkdownLines,
        restoreScrollPosition: restoreScrollPosition,
        replaceClassPrefix: replaceClassPrefix
    };
})(window);
